import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { ImageContent } from "@oh-my-pi/pi-ai";

import type { SessionOwnershipHandle } from "./session-ownership";

const QUEUE_VERSION = 2 as const;
const HEAD_FILE = "head.json";
const HEADS_DIR = "heads";
const SEGMENTS_DIR = "segments";
const WRITER_LOCK_DIR = "writer.lock";
const WRITER_LOCK_OWNER_FILE = "owner.json";
const WRITER_LOCK_RECLAIM_MS = 30_000;

const NEXT_STATES: Record<DurableInputState, readonly DurableInputState[]> = {
	queued: ["admitted", "cancelled"],
	admitted: ["running", "cancelled", "queued"],
	running: ["completed", "failed-rate-limit", "cancelled", "uncertain"],
	uncertain: ["completed", "failed-rate-limit", "queued", "cancelled"],
	completed: [],
	"failed-rate-limit": ["queued", "cancelled"],
	cancelled: [],
};

export type DurableInputState =
	| "queued"
	| "admitted"
	| "running"
	| "uncertain"
	| "completed"
	| "failed-rate-limit"
	| "cancelled";

export type DurableInputDeliveryClass = "steer" | "followUp";

export interface DurableInputPayload {
	readonly text: string;
	readonly images: readonly ImageContent[] | undefined;
}

export interface DurableInputAttempt {
	readonly id: string;
	readonly inputId: string;
	readonly revision: number;
	readonly state: "admitted" | "started" | "completed" | "failed-rate-limit";
	readonly retryAt?: number;
}

export interface DurableQueuedInput {
	readonly inputId: string;
	readonly sequence: number;
	readonly deliveryClass: DurableInputDeliveryClass;
	readonly revision: number;
	readonly payload: DurableInputPayload;
	readonly state: DurableInputState;
	readonly retryAt?: number;
	readonly attempts: readonly DurableInputAttempt[];
}

interface QueueHead {
	readonly version: typeof QUEUE_VERSION;
	readonly epoch: string;
	readonly ownershipEpoch?: string;
	readonly predecessor?: string;
	readonly predecessorBytes?: number;
	readonly adoptedAt: number;
}

export class SessionOwnershipLostError extends Error {
	readonly sessionId: string;
	readonly ownerEpoch: string;

	constructor(sessionId: string, ownerEpoch: string) {
		super(
			`Session ${sessionId} is active in another process; this view is read-only. Resume or return to the active session.`,
		);
		this.name = "SessionOwnershipLostError";
		this.sessionId = sessionId;
		this.ownerEpoch = ownerEpoch;
	}
}

export class DurableInputQueueConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DurableInputQueueConflictError";
	}
}

type WriterLockIdentity = { readonly kind: "fingerprint"; readonly value: string } | { readonly kind: "pid" };

interface WriterLock {
	readonly version: 1;
	readonly token: string;
	readonly pid: number;
	readonly identity: WriterLockIdentity;
	readonly ownerEpoch: string;
	readonly createdAt: number;
}

type QueueRecord =
	| {
			readonly version: typeof QUEUE_VERSION;
			readonly type: "enqueue";
			readonly id: string;
			readonly text: string;
			readonly images: readonly ImageContent[] | undefined;
			readonly sequence?: number;
			readonly deliveryClass?: DurableInputDeliveryClass;
			readonly revision?: number;
			readonly ownerEpoch: string;
	  }
	| {
			readonly version: typeof QUEUE_VERSION;
			readonly type: "revision";
			readonly inputId: string;
			readonly revision: number;
			readonly payload: DurableInputPayload;
			readonly ownerEpoch: string;
	  }
	| {
			readonly version: typeof QUEUE_VERSION;
			readonly type: "state";
			readonly id: string;
			readonly state: DurableInputState;
			readonly ownerEpoch: string;
	  }
	| {
			readonly version: typeof QUEUE_VERSION;
			readonly type: "attempt";
			readonly id: string;
			readonly inputId: string;
			readonly revision?: number;
			readonly ownerEpoch: string;
	  }
	| {
			readonly version: typeof QUEUE_VERSION;
			readonly type: "request-start";
			readonly attemptId: string;
			readonly inputId: string;
			readonly ownerEpoch: string;
	  }
	| {
			readonly version: typeof QUEUE_VERSION;
			readonly type: "terminal";
			readonly attemptId: string;
			readonly inputId: string;
			readonly state: "completed" | "failed-rate-limit";
			readonly retryAt?: number;
			readonly ownerEpoch: string;
	  }
	| {
			readonly version: typeof QUEUE_VERSION;
			readonly type: "requeue";
			readonly inputId: string;
			readonly ownerEpoch: string;
	  }
	| {
			readonly version: typeof QUEUE_VERSION;
			readonly type: "adopt";
			readonly ownerEpoch: string;
			readonly previousEpoch: string | undefined;
	  };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidState(value: unknown): value is DurableInputState {
	return (
		typeof value === "string" &&
		["queued", "admitted", "running", "uncertain", "completed", "failed-rate-limit", "cancelled"].includes(value)
	);
}

function processStartFingerprint(pid: number): string | undefined {
	const result = Bun.spawnSync({
		cmd: ["/bin/ps", "-o", "lstart=", "-p", String(pid)],
		stdout: "pipe",
		stderr: "ignore",
	});
	if (result.exitCode !== 0) return undefined;
	const value = new TextDecoder().decode(result.stdout).trim().replace(/\s+/g, " ");
	return value || undefined;
}

function pidIsLive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

function writerLockOwnerIsLive(lock: WriterLock | undefined): boolean {
	if (!lock) return false;
	if (lock.identity.kind === "pid") return pidIsLive(lock.pid);
	const fingerprint = processStartFingerprint(lock.pid);
	return fingerprint !== undefined && fingerprint === lock.identity.value;
}
function decodeWriterLock(value: unknown): WriterLock | undefined {
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		typeof value.token !== "string" ||
		typeof value.pid !== "number" ||
		!Number.isInteger(value.pid) ||
		typeof value.ownerEpoch !== "string" ||
		typeof value.createdAt !== "number"
	) {
		return undefined;
	}
	const identity =
		isRecord(value.identity) && value.identity.kind === "fingerprint" && typeof value.identity.value === "string"
			? { kind: "fingerprint" as const, value: value.identity.value }
			: isRecord(value.identity) && value.identity.kind === "pid"
				? { kind: "pid" as const }
				: typeof value.startFingerprint === "string"
					? { kind: "fingerprint" as const, value: value.startFingerprint }
					: undefined;
	if (!identity) return undefined;
	return {
		version: 1,
		token: value.token,
		pid: value.pid,
		identity,
		ownerEpoch: value.ownerEpoch,
		createdAt: value.createdAt,
	};
}

function isPositiveSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isDeliveryClass(value: unknown): value is DurableInputDeliveryClass {
	return value === "steer" || value === "followUp";
}

function decodePayload(value: unknown): DurableInputPayload | undefined {
	if (!isRecord(value) || typeof value.text !== "string") return undefined;
	return {
		text: value.text,
		images: Array.isArray(value.images) ? (value.images as ImageContent[]) : undefined,
	};
}

function decodeRecord(value: unknown): QueueRecord | undefined {
	if (
		!isRecord(value) ||
		value.version !== QUEUE_VERSION ||
		typeof value.type !== "string" ||
		typeof value.ownerEpoch !== "string"
	) {
		return undefined;
	}
	switch (value.type) {
		case "enqueue": {
			if (
				typeof value.id !== "string" ||
				typeof value.text !== "string" ||
				(value.sequence !== undefined && !isPositiveSafeInteger(value.sequence)) ||
				(value.deliveryClass !== undefined && !isDeliveryClass(value.deliveryClass)) ||
				(value.revision !== undefined && !isPositiveSafeInteger(value.revision))
			) {
				return undefined;
			}
			return {
				version: QUEUE_VERSION,
				type: "enqueue",
				id: value.id,
				text: value.text,
				images: Array.isArray(value.images) ? (value.images as ImageContent[]) : undefined,
				...(value.sequence === undefined ? {} : { sequence: value.sequence as number }),
				...(value.deliveryClass === undefined
					? {}
					: { deliveryClass: value.deliveryClass as DurableInputDeliveryClass }),
				...(value.revision === undefined ? {} : { revision: value.revision as number }),
				ownerEpoch: value.ownerEpoch,
			};
		}
		case "revision": {
			const payload = decodePayload(value.payload);
			if (typeof value.inputId !== "string" || !isPositiveSafeInteger(value.revision) || !payload) {
				return undefined;
			}
			return {
				version: QUEUE_VERSION,
				type: "revision",
				inputId: value.inputId,
				revision: value.revision,
				payload,
				ownerEpoch: value.ownerEpoch,
			};
		}
		case "state":
			if (typeof value.id !== "string" || !isValidState(value.state)) return undefined;
			return {
				version: QUEUE_VERSION,
				type: "state",
				id: value.id,
				state: value.state,
				ownerEpoch: value.ownerEpoch,
			};
		case "attempt":
			if (
				typeof value.id !== "string" ||
				typeof value.inputId !== "string" ||
				(value.revision !== undefined && !isPositiveSafeInteger(value.revision))
			) {
				return undefined;
			}
			return {
				version: QUEUE_VERSION,
				type: "attempt",
				id: value.id,
				inputId: value.inputId,
				...(value.revision === undefined ? {} : { revision: value.revision as number }),
				ownerEpoch: value.ownerEpoch,
			};
		case "request-start":
			if (typeof value.attemptId !== "string" || typeof value.inputId !== "string") return undefined;
			return {
				version: QUEUE_VERSION,
				type: "request-start",
				attemptId: value.attemptId,
				inputId: value.inputId,
				ownerEpoch: value.ownerEpoch,
			};
		case "terminal":
			if (
				typeof value.attemptId !== "string" ||
				typeof value.inputId !== "string" ||
				(value.state !== "completed" && value.state !== "failed-rate-limit")
			) {
				return undefined;
			}
			return {
				version: QUEUE_VERSION,
				type: "terminal",
				attemptId: value.attemptId,
				inputId: value.inputId,
				state: value.state,
				retryAt: typeof value.retryAt === "number" && Number.isFinite(value.retryAt) ? value.retryAt : undefined,
				ownerEpoch: value.ownerEpoch,
			};
		case "requeue":
			if (typeof value.inputId !== "string") return undefined;
			return { version: QUEUE_VERSION, type: "requeue", inputId: value.inputId, ownerEpoch: value.ownerEpoch };
		case "adopt":
			return {
				version: QUEUE_VERSION,
				type: "adopt",
				ownerEpoch: value.ownerEpoch,
				previousEpoch: typeof value.previousEpoch === "string" ? value.previousEpoch : undefined,
			};
		default:
			return undefined;
	}
}

function decodeHead(value: unknown): QueueHead | undefined {
	if (
		!isRecord(value) ||
		value.version !== QUEUE_VERSION ||
		typeof value.epoch !== "string" ||
		(typeof value.predecessor !== "string" && value.predecessor !== undefined) ||
		(typeof value.predecessorBytes !== "number" && value.predecessorBytes !== undefined) ||
		typeof value.adoptedAt !== "number"
	) {
		return undefined;
	}
	return {
		version: QUEUE_VERSION,
		epoch: value.epoch,
		ownershipEpoch: typeof value.ownershipEpoch === "string" ? value.ownershipEpoch : undefined,
		predecessor: typeof value.predecessor === "string" ? value.predecessor : undefined,
		predecessorBytes: typeof value.predecessorBytes === "number" ? value.predecessorBytes : undefined,
		adoptedAt: value.adoptedAt,
	};
}

async function canonicalSessionFile(sessionFile: string): Promise<string> {
	return path.join(await fs.realpath(path.dirname(sessionFile)), path.basename(sessionFile));
}

function queueKey(sessionFile: string, sessionId: string): string {
	return createHash("sha256").update(sessionFile).update("\0").update(sessionId).digest("hex");
}

/**
 * Append-only editor input queue protected by the session ownership lease.
 * Each owner epoch writes to its own segment; adoption atomically publishes a
 * new head pointing to a frozen predecessor byte boundary. Stale owners may
 * finish appending to their old segment, but those bytes are never read again.
 */
export class DurableInputQueue {
	readonly #root: string;
	readonly #ownership: SessionOwnershipHandle;
	#activeEpoch: string;
	#tail: Promise<void> = Promise.resolve();
	#adopted = false;

	private constructor(root: string, ownership: SessionOwnershipHandle, activeEpoch: string) {
		this.#root = root;
		this.#ownership = ownership;
		this.#activeEpoch = activeEpoch;
	}

	static async open(
		ownership: SessionOwnershipHandle,
		root = path.join(os.homedir(), ".agent-mux"),
	): Promise<DurableInputQueue> {
		const sessionFile = await canonicalSessionFile(ownership.sessionFile);
		const queueRoot = path.join(root, "owners-v1", queueKey(sessionFile, ownership.sessionId), "queue-v2");
		await fs.mkdir(path.join(queueRoot, SEGMENTS_DIR), { recursive: true });
		await fs.mkdir(path.join(queueRoot, HEADS_DIR), { recursive: true });
		const initialEpoch = randomUUID();
		const queue = new DurableInputQueue(queueRoot, ownership, initialEpoch);
		await queue.#withWriterLock(async () => {
			await queue.#assertCurrentOwner();
			const head = await DurableInputQueue.#readHead(queueRoot);
			if (head) {
				queue.#activeEpoch = head.epoch;
				return;
			}
			await DurableInputQueue.#writeHead(queueRoot, {
				version: QUEUE_VERSION,
				epoch: initialEpoch,
				ownershipEpoch: ownership.ownerEpoch,
				adoptedAt: Date.now(),
			});
		});
		return queue;
	}

	async enqueue(input: {
		readonly text: string;
		readonly images?: readonly ImageContent[];
		readonly deliveryClass: DurableInputDeliveryClass;
	}): Promise<DurableQueuedInput> {
		return this.#exclusive(() =>
			this.#withWriterLock(async () => {
				await this.#assertOwner();
				if (typeof input.text !== "string" || !isDeliveryClass(input.deliveryClass)) {
					throw new DurableInputQueueConflictError("Invalid durable input queue enqueue payload");
				}
				const sequence =
					(await this.#items()).reduce((lastSequence, item) => Math.max(lastSequence, item.sequence), 0) + 1;
				const item: DurableQueuedInput = {
					inputId: randomUUID(),
					sequence,
					deliveryClass: input.deliveryClass,
					revision: 1,
					payload: { text: input.text, images: input.images },
					state: "queued",
					attempts: [],
				};
				await this.#appendLocked({
					version: QUEUE_VERSION,
					type: "enqueue",
					id: item.inputId,
					text: item.payload.text,
					images: item.payload.images,
					sequence: item.sequence,
					deliveryClass: item.deliveryClass,
					revision: item.revision,
					ownerEpoch: this.#activeEpoch,
				});
				return item;
			}),
		);
	}

	async #acquireWriterLock(): Promise<WriterLock> {
		const lockPath = path.join(this.#root, WRITER_LOCK_DIR);
		const ownerPath = path.join(lockPath, WRITER_LOCK_OWNER_FILE);
		const fingerprint = processStartFingerprint(process.pid);
		const lock: WriterLock = {
			version: 1,
			token: randomUUID(),
			pid: process.pid,
			identity: fingerprint ? { kind: "fingerprint", value: fingerprint } : { kind: "pid" },
			ownerEpoch: this.#ownership.ownerEpoch,
			createdAt: Date.now(),
		};
		while (true) {
			if (await this.#hasWriterQuarantine()) {
				await new Promise(resolve => setTimeout(resolve, 20));
				continue;
			}
			try {
				await fs.mkdir(lockPath);
				await DurableInputQueue.#writeAndSync(ownerPath, JSON.stringify(lock));
				await DurableInputQueue.#syncDirectory(lockPath);
				await DurableInputQueue.#syncDirectory(this.#root);
				return lock;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				if (await this.#tryQuarantineStaleWriterLock(lockPath)) continue;
				await new Promise(resolve => setTimeout(resolve, 20));
			}
		}
	}

	async #hasWriterQuarantine(): Promise<boolean> {
		const entries = (await fs.readdir(this.#root)).filter(entry => entry.startsWith(`${WRITER_LOCK_DIR}.reclaim-`));
		for (const entry of entries) {
			const quarantinePath = path.join(this.#root, entry);
			const owner = await this.#readWriterLock(quarantinePath);
			const stat = await fs.stat(quarantinePath).catch(() => undefined);
			const ownerIsLive = writerLockOwnerIsLive(owner);
			if (ownerIsLive || !stat || Date.now() - stat.mtimeMs < WRITER_LOCK_RECLAIM_MS) return true;
			await fs.rm(quarantinePath, { recursive: true, force: true });
			await DurableInputQueue.#syncDirectory(this.#root);
		}
		return false;
	}

	async #tryQuarantineStaleWriterLock(lockPath: string): Promise<boolean> {
		const snapshot = await this.#readWriterLock();
		const stat = await fs.stat(lockPath).catch(() => undefined);
		const holderIsLive = writerLockOwnerIsLive(snapshot);
		if (holderIsLive || !stat || Date.now() - stat.mtimeMs < WRITER_LOCK_RECLAIM_MS) return false;
		const quarantinePath = path.join(this.#root, `${WRITER_LOCK_DIR}.reclaim-${randomUUID()}`);
		try {
			await fs.rename(lockPath, quarantinePath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
		const moved = await this.#readWriterLock(quarantinePath);
		const movedStat = await fs.stat(quarantinePath).catch(() => undefined);
		const movedHolderIsLive = writerLockOwnerIsLive(moved);
		const movedExpectedLock =
			movedStat !== undefined && movedStat.ino === stat.ino && moved?.token === snapshot?.token;
		if (!movedExpectedLock || movedHolderIsLive) {
			await fs.rename(quarantinePath, lockPath).catch(() => undefined);
			return false;
		}
		await fs.rm(quarantinePath, { recursive: true, force: true });
		await DurableInputQueue.#syncDirectory(this.#root);
		return true;
	}

	async #readWriterLock(lockPath = path.join(this.#root, WRITER_LOCK_DIR)): Promise<WriterLock | undefined> {
		try {
			const text = await fs.readFile(path.join(lockPath, WRITER_LOCK_OWNER_FILE), "utf8");
			return decodeWriterLock(JSON.parse(text));
		} catch {
			return undefined;
		}
	}

	async #releaseWriterLock(lock: WriterLock): Promise<void> {
		const current = await this.#readWriterLock();
		if (current?.token !== lock.token) return;
		await fs.rm(path.join(this.#root, WRITER_LOCK_DIR), { recursive: true, force: true });
		await DurableInputQueue.#syncDirectory(this.#root);
	}

	async #withWriterLock<T>(operation: () => Promise<T>): Promise<T> {
		const lock = await this.#acquireWriterLock();
		try {
			return await operation();
		} finally {
			await this.#releaseWriterLock(lock);
		}
	}

	/** Records a replacement owner once; repeated adoption by the current owner is a no-op. */
	async adopt(): Promise<readonly DurableQueuedInput[]> {
		return this.#exclusive(() =>
			this.#withWriterLock(async () => {
				await this.#assertCurrentOwner();
				const head = await DurableInputQueue.#readHead(this.#root);
				if (head?.ownershipEpoch === this.#ownership.ownerEpoch) {
					this.#activeEpoch = head.epoch;
					if (this.#adopted) return [];
					this.#adopted = true;
					return (await this.#items()).filter(item => item.state === "queued");
				}

				const previousEpoch = head?.epoch ?? this.#activeEpoch;
				const newEpoch = randomUUID();
				const predecessorBytes = await this.#predecessorBytes(previousEpoch);
				const newHead: QueueHead = {
					version: QUEUE_VERSION,
					epoch: newEpoch,
					ownershipEpoch: this.#ownership.ownerEpoch,
					predecessor: previousEpoch,
					predecessorBytes,
					adoptedAt: Date.now(),
				};
				await DurableInputQueue.#writeHead(this.#root, newHead);
				this.#activeEpoch = newEpoch;
				this.#adopted = true;
				await this.#appendLocked({
					version: QUEUE_VERSION,
					type: "adopt",
					ownerEpoch: newEpoch,
					previousEpoch,
				});

				return (await this.#items()).filter(item => item.state === "queued");
			}),
		);
	}

	/** Returns queued items in durable arrival order without changing their state. */
	async replayQueued(): Promise<readonly DurableQueuedInput[]> {
		return this.#exclusive(async () => {
			await this.#assertOwner();
			return (await this.#items()).filter(item => item.state === "queued");
		});
	}

	async get(inputId: string): Promise<DurableQueuedInput | undefined> {
		return this.#exclusive(async () => {
			await this.#assertOwner();
			return (await this.#items()).find(item => item.inputId === inputId);
		});
	}

	async list(options?: { readonly states?: readonly DurableInputState[] }): Promise<readonly DurableQueuedInput[]> {
		return this.#exclusive(async () => {
			await this.#assertOwner();
			const items = await this.#items();
			return options?.states === undefined ? items : items.filter(item => options.states?.includes(item.state));
		});
	}

	async sequenceBoundary(): Promise<number> {
		return this.#exclusive(async () => {
			await this.#assertOwner();
			return (await this.#items()).reduce((lastSequence, item) => Math.max(lastSequence, item.sequence), 0);
		});
	}

	async edit(inputId: string, expectedRevision: number, payload: DurableInputPayload): Promise<DurableQueuedInput> {
		return this.#exclusive(() =>
			this.#withWriterLock(async () => {
				await this.#assertOwner();
				if (typeof payload.text !== "string") {
					throw new DurableInputQueueConflictError(`Invalid durable input queue revision payload: ${inputId}`);
				}
				const item = (await this.#items()).find(candidate => candidate.inputId === inputId);
				if (!item) throw new DurableInputQueueConflictError(`Durable input queue item not found: ${inputId}`);
				if (item.state !== "queued" || item.revision !== expectedRevision) {
					throw new DurableInputQueueConflictError(`Durable input queue edit conflict: ${inputId}`);
				}
				const revision = item.revision + 1;
				await this.#appendLocked({
					version: QUEUE_VERSION,
					type: "revision",
					inputId,
					revision,
					payload,
					ownerEpoch: this.#activeEpoch,
				});
				return { ...item, revision, payload };
			}),
		);
	}

	async cancel(inputId: string): Promise<DurableQueuedInput> {
		return this.#exclusive(() =>
			this.#withWriterLock(async () => {
				await this.#assertOwner();
				const item = (await this.#items()).find(candidate => candidate.inputId === inputId);
				if (!item) throw new DurableInputQueueConflictError(`Durable input queue item not found: ${inputId}`);
				if (item.state !== "queued" && item.state !== "admitted") {
					throw new DurableInputQueueConflictError(`Durable input queue cancellation conflict: ${inputId}`);
				}
				if (item.attempts.some(attempt => attempt.state === "started")) {
					throw new DurableInputQueueConflictError(`Durable input queue request already started: ${inputId}`);
				}
				await this.#appendLocked({
					version: QUEUE_VERSION,
					type: "state",
					id: inputId,
					state: "cancelled",
					ownerEpoch: this.#activeEpoch,
				});
				return { ...item, state: "cancelled" };
			}),
		);
	}
	async admitNext(
		boundary: "tool" | "terminal" = "terminal",
		now: number = Date.now(),
	): Promise<DurableQueuedInput | undefined> {
		return this.#exclusive(() =>
			this.#withWriterLock(async () => {
				await this.#assertOwner();
				const items = await this.#items();
				if (
					items.some(
						candidate =>
							candidate.state === "admitted" || candidate.state === "running" || candidate.state === "uncertain",
					)
				) {
					return undefined;
				}
				let item: DurableQueuedInput | undefined;
				for (const candidate of items) {
					if (
						candidate.state !== "queued" ||
						(boundary === "tool" && candidate.deliveryClass !== "steer") ||
						(candidate.retryAt !== undefined && now < candidate.retryAt) ||
						(item !== undefined && item.sequence < candidate.sequence)
					) {
						continue;
					}
					item = candidate;
				}
				if (!item) return undefined;
				const attemptId = randomUUID();
				await this.#appendLocked({
					version: QUEUE_VERSION,
					type: "attempt",
					id: attemptId,
					inputId: item.inputId,
					revision: item.revision,
					ownerEpoch: this.#activeEpoch,
				});
				return {
					...item,
					state: "admitted",
					attempts: [
						...item.attempts,
						{ id: attemptId, inputId: item.inputId, revision: item.revision, state: "admitted" },
					],
				};
			}),
		);
	}

	/** Fsyncs the request-start boundary for the attempt created by admitNext(). */
	async markRunning(inputId: string): Promise<DurableInputAttempt> {
		const item = (await this.#items()).find(candidate => candidate.inputId === inputId);
		if (!item) throw new Error(`Durable input queue item not found: ${inputId}`);
		const attempt = [...item.attempts].reverse().find(candidate => candidate.state === "admitted");
		if (!attempt) throw new Error(`No admitted attempt to start for input: ${inputId}`);
		await this.markRequestStarted(inputId, attempt.id);
		return { ...attempt, state: "started" };
	}

	/** Fsynced boundary written before the provider call. */
	async markRequestStarted(inputId: string, attemptId: string): Promise<void> {
		await this.#exclusive(() =>
			this.#withWriterLock(async () => {
				await this.#assertOwner();
				const item = (await this.#items()).find(candidate => candidate.inputId === inputId);
				if (!item) throw new DurableInputQueueConflictError(`Durable input queue item not found: ${inputId}`);
				const attempt = item.attempts.find(a => a.id === attemptId);
				if (!attempt || item.state !== "admitted") {
					throw new DurableInputQueueConflictError(`Durable input queue attempt not admitted: ${attemptId}`);
				}
				await this.#appendLocked({
					version: QUEUE_VERSION,
					type: "state",
					id: inputId,
					state: "running",
					ownerEpoch: this.#activeEpoch,
				});
				await this.#appendLocked({
					version: QUEUE_VERSION,
					type: "request-start",
					attemptId,
					inputId,
					ownerEpoch: this.#activeEpoch,
				});
			}),
		);
	}

	async completeAttempt(inputId: string, attemptId: string): Promise<void> {
		await this.#exclusive(async () => {
			await this.#assertOwner();
			const item = (await this.#items()).find(candidate => candidate.inputId === inputId);
			if (!item) throw new Error(`Durable input queue item not found: ${inputId}`);
			const attempt = item.attempts.find(a => a.id === attemptId);
			if (!attempt) throw new Error(`Durable input queue attempt not found: ${attemptId}`);
			await this.#append({
				version: QUEUE_VERSION,
				type: "terminal",
				attemptId,
				inputId,
				state: "completed",
				ownerEpoch: this.#activeEpoch,
			});
			await this.#transitionItem(item, "completed");
		});
	}

	/** Legacy compatibility: completes the latest running/started attempt. */
	async complete(inputId: string): Promise<void> {
		await this.#exclusive(async () => {
			await this.#assertOwner();
			const item = (await this.#items()).find(candidate => candidate.inputId === inputId);
			if (!item) throw new Error(`Durable input queue item not found: ${inputId}`);
			const attempt = [...item.attempts].reverse().find(a => a.state === "started" || a.state === "admitted");
			if (!attempt) throw new Error(`No running attempt to complete for input: ${inputId}`);
			await this.#append({
				version: QUEUE_VERSION,
				type: "terminal",
				attemptId: attempt.id,
				inputId,
				state: "completed",
				ownerEpoch: this.#activeEpoch,
			});
			await this.#transitionItem(item, "completed");
		});
	}

	async failRateLimit(inputId: string, attemptId: string, retryAt: number): Promise<void> {
		await this.#exclusive(async () => {
			await this.#assertOwner();
			const item = (await this.#items()).find(candidate => candidate.inputId === inputId);
			if (!item) throw new Error(`Durable input queue item not found: ${inputId}`);
			const attempt = item.attempts.find(a => a.id === attemptId);
			if (!attempt) throw new Error(`Durable input queue attempt not found: ${attemptId}`);
			await this.#append({
				version: QUEUE_VERSION,
				type: "terminal",
				attemptId,
				inputId,
				state: "failed-rate-limit",
				retryAt,
				ownerEpoch: this.#activeEpoch,
			});
			await this.#transitionItem(item, "failed-rate-limit");
		});
	}

	async retryRateLimit(inputId: string): Promise<void> {
		await this.#exclusive(async () => {
			await this.#assertOwner();
			const item = (await this.#items()).find(candidate => candidate.inputId === inputId);
			if (!item) throw new Error(`Durable input queue item not found: ${inputId}`);
			await this.#append({
				version: QUEUE_VERSION,
				type: "requeue",
				inputId,
				ownerEpoch: this.#activeEpoch,
			});
			await this.#transitionItem(item, "queued");
		});
	}

	async retryDue(now: number = Date.now()): Promise<readonly DurableQueuedInput[]> {
		return this.#exclusive(async () => {
			await this.#assertOwner();
			const due = (await this.#items()).filter(
				item => item.state === "failed-rate-limit" && item.retryAt !== undefined && now >= item.retryAt,
			);
			for (const item of due) {
				await this.#append({
					version: QUEUE_VERSION,
					type: "requeue",
					inputId: item.inputId,
					ownerEpoch: this.#activeEpoch,
				});
			}
			return due.map(item => ({ ...item, state: "queued" as const, retryAt: undefined }));
		});
	}

	async requeueUnstarted(inputId: string, attemptId: string): Promise<void> {
		await this.#exclusive(async () => {
			await this.#assertOwner();
			const item = (await this.#items()).find(candidate => candidate.inputId === inputId);
			if (!item) throw new Error(`Durable input queue item not found: ${inputId}`);
			const attempt = item.attempts.find(candidate => candidate.id === attemptId);
			if (attempt?.state !== "admitted" || item.state !== "admitted") {
				throw new Error(`Durable input queue attempt is not safely requeueable: ${attemptId}`);
			}
			await this.#append({
				version: QUEUE_VERSION,
				type: "requeue",
				inputId,
				ownerEpoch: this.#activeEpoch,
			});
			await this.#transitionItem(item, "queued");
		});
	}

	async markUncertain(inputId: string, attemptId: string): Promise<void> {
		await this.#exclusive(async () => {
			await this.#assertOwner();
			const item = (await this.#items()).find(candidate => candidate.inputId === inputId);
			if (!item) throw new Error(`Durable input queue item not found: ${inputId}`);
			const attempt = item.attempts.find(candidate => candidate.id === attemptId);
			if (attempt?.state !== "started" || item.state !== "running") {
				throw new Error(`Durable input queue attempt is not running: ${attemptId}`);
			}
			await this.#transitionItem(item, "uncertain");
		});
	}

	async listUncertain(): Promise<readonly DurableQueuedInput[]> {
		return this.#exclusive(async () => {
			await this.#assertOwner();
			return (await this.#items()).filter(item => item.state === "uncertain");
		});
	}

	async reconcile(
		attemptId: string,
		resolution: "completed" | "failed-rate-limit" | "not-executed",
		retryAt?: number,
	): Promise<void> {
		await this.#exclusive(async () => {
			await this.#assertOwner();
			const items = await this.#items();
			const item = items.find(candidate => candidate.attempts.some(a => a.id === attemptId));
			if (!item) throw new Error(`Durable input queue item not found for attempt: ${attemptId}`);
			const attempt = item.attempts.find(a => a.id === attemptId);
			if (!attempt) throw new Error(`Durable input queue attempt not found: ${attemptId}`);
			if (item.state !== "uncertain") {
				throw new Error(`Cannot reconcile attempt ${attemptId}: input state is ${item.state}, expected uncertain`);
			}
			if (resolution === "completed") {
				await this.#append({
					version: QUEUE_VERSION,
					type: "terminal",
					attemptId,
					inputId: item.inputId,
					state: "completed",
					ownerEpoch: this.#activeEpoch,
				});
				await this.#transitionItem(item, "completed");
			} else if (resolution === "failed-rate-limit") {
				if (retryAt === undefined || !Number.isFinite(retryAt)) {
					throw new Error(`Rate-limit reconciliation requires retryAt: ${attemptId}`);
				}
				await this.#append({
					version: QUEUE_VERSION,
					type: "terminal",
					attemptId,
					inputId: item.inputId,
					state: "failed-rate-limit",
					retryAt,
					ownerEpoch: this.#activeEpoch,
				});
				await this.#transitionItem(item, "failed-rate-limit");
			} else {
				await this.#append({
					version: QUEUE_VERSION,
					type: "requeue",
					inputId: item.inputId,
					ownerEpoch: this.#activeEpoch,
				});
				await this.#transitionItem(item, "queued");
			}
		});
	}

	async nextRetryAt(): Promise<number | undefined> {
		return this.#exclusive(async () => {
			await this.#assertOwner();
			const retryTimes = (await this.#items())
				.filter(item => item.state === "failed-rate-limit" && item.retryAt !== undefined)
				.map(item => item.retryAt as number);
			return retryTimes.length > 0 ? Math.min(...retryTimes) : undefined;
		});
	}

	async getStatus(): Promise<{ activeEpoch: string; queuedCount: number }> {
		return this.#exclusive(async () => {
			await this.#assertOwner();
			const items = await this.#items();
			return { activeEpoch: this.#activeEpoch, queuedCount: items.filter(item => item.state === "queued").length };
		});
	}

	async #transitionItem(item: DurableQueuedInput, state: DurableInputState): Promise<void> {
		if (item.state === state) return;
		if (!NEXT_STATES[item.state].includes(state)) {
			throw new Error(`Invalid durable input queue transition: ${item.state} -> ${state}`);
		}
		await this.#append({
			version: QUEUE_VERSION,
			type: "state",
			id: item.inputId,
			state,
			ownerEpoch: this.#activeEpoch,
		});
	}

	async #assertCurrentOwner(): Promise<void> {
		const current = !this.#ownership.isFenced?.() && (await this.#ownership.isCurrent());
		if (!current) throw new SessionOwnershipLostError(this.#ownership.sessionId, this.#ownership.ownerEpoch);
	}

	async #assertOwner(): Promise<void> {
		await this.#assertCurrentOwner();
		const head = await DurableInputQueue.#readHead(this.#root);
		if (
			head === undefined ||
			head.ownershipEpoch !== this.#ownership.ownerEpoch ||
			head.epoch !== this.#activeEpoch
		) {
			throw new SessionOwnershipLostError(this.#ownership.sessionId, this.#ownership.ownerEpoch);
		}
	}

	async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
		const previous = this.#tail;
		const completion = Promise.withResolvers<void>();
		this.#tail = previous.then(
			() => completion.promise,
			() => completion.promise,
		);
		await previous.catch(() => undefined);
		try {
			return await operation();
		} finally {
			completion.resolve();
		}
	}

	async #append(record: QueueRecord): Promise<void> {
		await this.#withWriterLock(async () => {
			await this.#assertOwner();
			await this.#appendLocked(record);
		});
	}

	async #appendLocked(record: QueueRecord): Promise<void> {
		const segment = this.#segmentPath(this.#activeEpoch);
		await fs.mkdir(path.dirname(segment), { recursive: true });
		const handle = await fs.open(segment, "a");
		try {
			await handle.write(`${JSON.stringify(record)}\n`);
			await handle.sync();
		} finally {
			await handle.close();
		}
	}

	async #predecessorBytes(epoch: string): Promise<number> {
		try {
			const { size } = await fs.stat(this.#segmentPath(epoch));
			return size;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
			throw error;
		}
	}

	#segmentPath(epoch: string): string {
		return path.join(this.#root, SEGMENTS_DIR, `${epoch}.jsonl`);
	}

	async #readSegment(epoch: string, maxBytes?: number): Promise<readonly QueueRecord[]> {
		let content: string;
		try {
			content = await fs.readFile(this.#segmentPath(epoch), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
		if (maxBytes !== undefined && maxBytes >= 0) {
			content = content.slice(0, maxBytes);
		}
		const hasPartialTail = !content.endsWith("\n");
		const lines = content.split("\n");
		const records: QueueRecord[] = [];
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			let record: QueueRecord | undefined;
			try {
				record = decodeRecord(JSON.parse(line));
			} catch {}
			if (!record) {
				if (hasPartialTail && i === lines.length - 1) {
					continue;
				}
				throw new Error(`Corrupt durable input queue segment at ${epoch}.jsonl line ${i + 1}`);
			}
			records.push(record);
		}
		return records;
	}

	static async #readHead(root: string): Promise<QueueHead | undefined> {
		try {
			const text = await fs.readFile(path.join(root, HEAD_FILE), "utf8");
			return decodeHead(JSON.parse(text));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
	}

	static async #writeHead(root: string, head: QueueHead): Promise<void> {
		const headsDir = path.join(root, HEADS_DIR);
		const headsPath = path.join(headsDir, `${head.epoch}.json`);
		const tmpHead = path.join(root, `.head-${head.epoch}.tmp`);
		const finalHead = path.join(root, HEAD_FILE);
		const text = JSON.stringify(head);
		await DurableInputQueue.#writeAndSync(headsPath, text);
		await DurableInputQueue.#syncDirectory(headsDir);
		await DurableInputQueue.#writeAndSync(tmpHead, text);
		await fs.rename(tmpHead, finalHead);
		await DurableInputQueue.#syncDirectory(root);
	}

	static async #writeAndSync(file: string, text: string): Promise<void> {
		const handle = await fs.open(file, "w", 0o600);
		try {
			await handle.writeFile(text);
			await handle.sync();
		} finally {
			await handle.close();
		}
	}

	static async #syncDirectory(directory: string): Promise<void> {
		const handle = await fs.open(directory, "r");
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	}

	async #readAllRecords(): Promise<readonly QueueRecord[]> {
		const records: QueueRecord[] = [];
		const epochs: { epoch: string; boundary?: number }[] = [];
		let head = await DurableInputQueue.#readHead(this.#root);
		if (!head) return records;
		let currentBoundary: number | undefined;
		while (head) {
			epochs.unshift({ epoch: head.epoch, boundary: currentBoundary });
			currentBoundary = head.predecessorBytes;
			if (!head.predecessor) break;
			head = await this.#readEpochHead(head.predecessor);
		}
		for (const { epoch, boundary } of epochs) {
			records.push(...(await this.#readSegment(epoch, boundary)));
		}
		return records;
	}

	async #readEpochHead(epoch: string): Promise<QueueHead | undefined> {
		try {
			const text = await fs.readFile(path.join(this.#root, HEADS_DIR, `${epoch}.json`), "utf8");
			return decodeHead(JSON.parse(text));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
	}

	async #items(): Promise<DurableQueuedInput[]> {
		const items = new Map<string, DurableQueuedInput>();
		const attempts = new Map<string, DurableInputAttempt>();
		const currentEpoch = this.#activeEpoch;
		const records = await this.#readAllRecords();
		let lastSequence = 0;
		for (const record of records) {
			if (record.type === "adopt") continue;
			if (record.type === "enqueue") {
				const hasSchemaFields =
					record.sequence !== undefined || record.deliveryClass !== undefined || record.revision !== undefined;
				if (
					hasSchemaFields &&
					(record.sequence === undefined || record.deliveryClass === undefined || record.revision === undefined)
				) {
					throw new Error(`Corrupt durable input queue enqueue schema: ${record.id}`);
				}
				const sequence = record.sequence ?? lastSequence + 1;
				if (!isPositiveSafeInteger(sequence) || sequence <= lastSequence) {
					throw new Error(`Corrupt durable input queue sequence: ${record.id}`);
				}
				lastSequence = sequence;
				if (!items.has(record.id)) {
					items.set(record.id, {
						inputId: record.id,
						sequence,
						deliveryClass: record.deliveryClass ?? "followUp",
						revision: record.revision ?? 1,
						payload: { text: record.text, images: record.images },
						state: "queued",
						attempts: [],
					});
				}
				continue;
			}
			if (record.type === "revision") {
				const item = items.get(record.inputId);
				if (!item) throw new Error(`Durable input queue revision references unknown input: ${record.inputId}`);
				if (item.state !== "queued" || record.revision !== item.revision + 1) {
					throw new Error(`Invalid durable input queue revision: ${record.inputId}`);
				}
				items.set(record.inputId, { ...item, revision: record.revision, payload: record.payload });
				continue;
			}
			if (record.type === "state") {
				const item = items.get(record.id);
				if (item) {
					items.set(record.id, { ...item, state: record.state });
				}
				continue;
			}
			if (record.type === "attempt") {
				const attempt: DurableInputAttempt = {
					id: record.id,
					inputId: record.inputId,
					revision: record.revision ?? 1,
					state: "admitted",
				};
				attempts.set(record.id, attempt);
				const item = items.get(record.inputId);
				if (item && !item.attempts.some(a => a.id === record.id)) {
					items.set(record.inputId, {
						...item,
						state: item.state === "queued" ? "admitted" : item.state,
						attempts: [...item.attempts, attempt],
					});
				}
				continue;
			}
			if (record.type === "request-start") {
				const attempt = attempts.get(record.attemptId);
				if (attempt) {
					attempts.set(record.attemptId, { ...attempt, state: "started" });
				}
				const item = items.get(record.inputId);
				if (item) {
					items.set(record.inputId, {
						...item,
						state: item.state === "admitted" ? "running" : item.state,
						attempts: item.attempts.map(a => (a.id === record.attemptId ? { ...a, state: "started" } : a)),
					});
				}
				continue;
			}
			if (record.type === "terminal") {
				const attempt = attempts.get(record.attemptId);
				if (attempt) {
					attempts.set(record.attemptId, {
						...attempt,
						state: record.state,
						retryAt: record.retryAt,
					});
				}
				const item = items.get(record.inputId);
				if (item) {
					items.set(record.inputId, {
						...item,
						state: record.state,
						retryAt: record.retryAt,
						attempts: item.attempts.map(a =>
							a.id === record.attemptId ? { ...a, state: record.state, retryAt: record.retryAt } : a,
						),
					});
				}
				continue;
			}
			if (record.type === "requeue") {
				const item = items.get(record.inputId);
				if (item) {
					items.set(record.inputId, { ...item, state: "queued", retryAt: undefined });
				}
			}
		}

		return [...items.values()]
			.map(item => {
				const lastRecordEpoch = this.#lastRecordEpochForItem(item.inputId, records);
				return lastRecordEpoch && lastRecordEpoch !== currentEpoch ? this.#applyAdoptionTransition(item) : item;
			})
			.sort((left, right) => left.sequence - right.sequence);
	}

	#lastRecordEpochForItem(inputId: string, records: readonly QueueRecord[]): string | undefined {
		for (let i = records.length - 1; i >= 0; i--) {
			const record = records[i];
			if (
				(record.type === "enqueue" && record.id === inputId) ||
				(record.type === "revision" && record.inputId === inputId) ||
				(record.type === "state" && record.id === inputId) ||
				(record.type === "attempt" && record.inputId === inputId) ||
				(record.type === "request-start" && record.inputId === inputId) ||
				(record.type === "terminal" && record.inputId === inputId) ||
				(record.type === "requeue" && record.inputId === inputId)
			) {
				return record.ownerEpoch;
			}
		}
		return undefined;
	}

	#applyAdoptionTransition(item: DurableQueuedInput): DurableQueuedInput {
		switch (item.state) {
			case "admitted":
			case "running": {
				const requestStarted = item.attempts.some(attempt => attempt.state === "started");
				return { ...item, state: requestStarted ? "uncertain" : "queued" };
			}
			case "failed-rate-limit": {
				const retryAt = [...item.attempts].reverse().find(attempt => attempt.retryAt !== undefined)?.retryAt;
				return { ...item, retryAt };
			}
			default:
				return item;
		}
	}
}
