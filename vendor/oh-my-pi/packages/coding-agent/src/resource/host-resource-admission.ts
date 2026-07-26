import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveIrcExternalDbPath } from "../irc/bus-external";
import {
	computeHostResourceProfile,
	DEFAULT_ATTEMPT_RESERVATION_BYTES,
	type HostResourceProbe,
	type HostResourceProfile,
} from "./host-resource-profile";
import { type LeaseProcessTarget, sampleLeaseProcessTrees } from "./host-resource-sampler";
import { type ProcessIdentity, readProcessIdentity } from "./process-identity";

const RESOURCE_SCHEMA_VERSION = 2;
const DEFAULT_LEASE_TTL_MS = 10_000;
const DEFAULT_WAITER_HEARTBEAT_MS = 5_000;
const DEFAULT_WAITER_STALE_MS = 30_000;
const DEFAULT_QUEUE_POLL_MS = 250;
const DEFAULT_SAMPLE_INTERVAL_MS = 1_000;
const DEFAULT_OBSERVATION_MAX_AGE_MS = 5_000;
const MAX_RECEIPTS = 64;
const GC_PRESSURE_RATIO = 0.8;
const HARD_PRESSURE_RATIO = 0.95;

export type ResourceAttemptKind = "spawn" | "revive";
export type AdmissionDeferredReason = "memory-budget" | "concurrency-cap" | "stale-owner-reaping";
export type AdmissionRejectedReason = "authority-unavailable" | "cancelled" | "pressure-hard";
export type HostResourcePressureState = "normal" | "gc" | "hard";

export interface HostResourceAdmissionRequest {
	readonly attemptId: string;
	readonly kind: ResourceAttemptKind;
	readonly sessionId: string;
	readonly sessionOwnerEpoch: string | null;
	readonly parentAgentId: string;
	readonly agentId: string;
	readonly jobId: string;
	readonly holderProcess: ProcessIdentity;
	readonly reservationBytes: number;
}

export interface AdmissionDeferred {
	readonly attemptId: string;
	readonly reason: AdmissionDeferredReason;
	readonly queueDepth: number;
}

export interface HostMemoryPressureDoorbell {
	readonly epoch: number;
	readonly state: "gc" | "hard";
	readonly chargedBytes: number;
	readonly budgetBytes: number;
	readonly atMs: number;
}

export interface HostResourceAdmissionOptions {
	readonly dbPath?: string;
	readonly memoryBudgetBytes?: number;
	readonly userCap?: number;
	readonly childReservationBytes?: number;
	readonly hostResourceProbe?: HostResourceProbe;
	readonly leaseTtlMs?: number;
	readonly waiterHeartbeatMs?: number;
	readonly waiterStaleMs?: number;
	readonly queuePollMs?: number;
	readonly sampleIntervalMs?: number;
	readonly observationMaxAgeMs?: number;
	readonly onPressure?: (doorbell: HostMemoryPressureDoorbell) => void | Promise<void>;
}

export interface HostResourceWaiterSnapshot {
	readonly attemptId: string;
	readonly ticket: number;
	readonly kind: ResourceAttemptKind;
	readonly sessionId: string;
	readonly agentId: string;
	readonly reservationBytes: number;
	readonly rejectionReason: AdmissionRejectedReason | null;
	readonly holderProcess: ProcessIdentity;
}

export interface HostResourceLeaseSnapshot {
	readonly leaseId: string;
	readonly attemptId: string;
	readonly fenceToken: number;
	readonly kind: ResourceAttemptKind;
	readonly sessionId: string;
	readonly agentId: string;
	readonly holderProcess: ProcessIdentity;
	readonly reservationBytes: number;
	readonly observedBytes: number;
	readonly observedAtMs: number;
	readonly chargedBytes: number;
	readonly acquiredAtMs: number;
	readonly heartbeatAtMs: number;
	readonly expiresAtMs: number;
}

export interface HostResourcePoolReceipt {
	readonly id: string;
	readonly type: "queued" | "deferred" | "admitted" | "released" | "pressure" | "waiters-rejected";
	readonly atMs: number;
	readonly attemptId?: string;
	readonly leaseId?: string;
	readonly pressureState?: HostResourcePressureState;
	readonly chargedBytes?: number;
	readonly budgetBytes?: number;
	readonly count?: number;
}

export interface HostResourcePoolSnapshot {
	readonly mode: HostResourceProfile["mode"];
	readonly userCap: number | null;
	readonly effectiveLimit: number;
	readonly limitingBounds: HostResourceProfile["limitingBounds"];
	readonly limitExplanation: string;
	readonly cpuCapacity: number;
	readonly memoryCapacity: number;
	readonly reservedHeadroomBytes: number;
	readonly effectiveMemoryBytes: number;
	readonly effectiveCpuCount: number;
	readonly availableSlots: number;
	readonly memoryBudgetBytes: number;
	readonly reservedBytes: number;
	readonly observedBytes: number;
	readonly chargedBytes: number;
	readonly pressureState: HostResourcePressureState;
	readonly pressureRatio: number;
	readonly pressureEpoch: number;
	readonly sampledAtMs: number | null;
	readonly waiters: readonly HostResourceWaiterSnapshot[];
	readonly leases: readonly HostResourceLeaseSnapshot[];
	readonly receipts: readonly HostResourcePoolReceipt[];
}

export class HostAdmissionRejectedError extends Error {
	constructor(
		readonly reason: AdmissionRejectedReason,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "HostAdmissionRejectedError";
	}
}

export class HostAdmissionFencedError extends Error {
	constructor(
		readonly leaseId: string,
		readonly fenceToken: number,
	) {
		super(`Host resource lease ${leaseId} fence ${fenceToken} is no longer authoritative`);
		this.name = "HostAdmissionFencedError";
	}
}

export class HostAdmissionCorruptError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "HostAdmissionCorruptError";
	}
}

interface WaiterRow {
	attempt_id: string;
	ticket: number;
	kind: string;
	session_id: string;
	session_owner_epoch: string | null;
	parent_agent_id: string;
	agent_id: string;
	job_id: string;
	holder_boot_id: string;
	holder_pid: number;
	holder_start_fingerprint: string;
	reservation_bytes: number;
	enqueued_at_ms: number;
	heartbeat_at_ms: number;
	rejection_reason: string | null;
}

interface LeaseRow {
	lease_id: string;
	attempt_id: string;
	fence_token: number;
	kind: string;
	session_id: string;
	session_owner_epoch: string | null;
	parent_agent_id: string;
	agent_id: string;
	job_id: string;
	holder_boot_id: string;
	holder_pid: number;
	holder_start_fingerprint: string;
	child_boot_id: string | null;
	child_pid: number | null;
	child_start_fingerprint: string | null;
	reservation_bytes: number;
	observed_bytes: number;
	observed_at_ms: number;
	acquired_at_ms: number;
	heartbeat_at_ms: number;
	expires_at_ms: number;
}

interface PoolStateRow {
	schema_version: number;
	next_ticket: number;
	next_fence_token: number;
	grant_sequence: number;
	pressure_state: string;
	pressure_since_ms: number | null;
	pressure_epoch: number;
	sample_at_ms: number | null;
	receipts_json: string;
}

interface FairnessRow {
	session_id: string;
	last_grant_sequence: number;
}

interface ResourceTotals {
	reservedBytes: number;
	observedBytes: number;
	chargedBytes: number;
}

function normalizedPositiveInteger(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function attemptKind(value: string): ResourceAttemptKind {
	if (value === "spawn" || value === "revive") return value;
	throw new HostAdmissionCorruptError(`Invalid host resource attempt kind ${JSON.stringify(value)}`);
}

function rejectionReason(value: string): AdmissionRejectedReason {
	if (value === "pressure-hard" || value === "cancelled" || value === "authority-unavailable") return value;
	throw new HostAdmissionCorruptError(`Invalid host resource rejection reason ${JSON.stringify(value)}`);
}

function pressureState(value: string): HostResourcePressureState {
	if (value === "normal" || value === "gc" || value === "hard") return value;
	throw new HostAdmissionCorruptError(`Invalid host resource pressure state ${JSON.stringify(value)}`);
}

function holderFromRow(
	row: Pick<WaiterRow, "holder_boot_id" | "holder_pid" | "holder_start_fingerprint">,
): ProcessIdentity {
	if (
		!row.holder_boot_id ||
		!Number.isSafeInteger(row.holder_pid) ||
		row.holder_pid <= 0 ||
		!row.holder_start_fingerprint
	) {
		throw new HostAdmissionCorruptError("Host resource holder identity is malformed");
	}
	return { bootId: row.holder_boot_id, pid: row.holder_pid, startFingerprint: row.holder_start_fingerprint };
}

function holderIsProvenDead(identity: ProcessIdentity): boolean {
	const current = readProcessIdentity(identity.pid);
	if (current !== null) {
		return current.bootId !== identity.bootId || current.startFingerprint !== identity.startFingerprint;
	}
	try {
		process.kill(identity.pid, 0);
		return false;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ESRCH";
	}
}

function validateRequest(request: HostResourceAdmissionRequest): void {
	for (const [name, value] of [
		["attemptId", request.attemptId],
		["sessionId", request.sessionId],
		["parentAgentId", request.parentAgentId],
		["agentId", request.agentId],
		["jobId", request.jobId],
	] as const) {
		if (!value.trim()) throw new HostAdmissionRejectedError("authority-unavailable", `${name} is required`);
	}
	if (request.kind !== "spawn" && request.kind !== "revive") {
		throw new HostAdmissionRejectedError("authority-unavailable", "Host resource attempt kind is invalid");
	}
	if (
		!request.holderProcess.bootId ||
		!request.holderProcess.startFingerprint ||
		!Number.isSafeInteger(request.holderProcess.pid) ||
		request.holderProcess.pid <= 0
	) {
		throw new HostAdmissionRejectedError("authority-unavailable", "Host resource holder identity is unavailable");
	}
	if (!Number.isSafeInteger(request.reservationBytes) || request.reservationBytes <= 0) {
		throw new HostAdmissionRejectedError(
			"authority-unavailable",
			"Host resource reservation must be a positive safe integer",
		);
	}
}

export class HostResourceLease {
	#released = false;

	constructor(
		private readonly admission: HostResourceAdmission,
		readonly leaseId: string,
		readonly attemptId: string,
		readonly fenceToken: number,
		readonly kind: ResourceAttemptKind,
	) {}

	renew(): "renewed" | "fenced" {
		if (this.#released) return "fenced";
		return this.admission.renewLease(this.leaseId, this.fenceToken);
	}

	release(): "released" {
		if (this.#released) return "released";
		this.admission.releaseLease(this.leaseId, this.fenceToken);
		this.#released = true;
		return "released";
	}
}

export class HostResourceAdmission {
	static #global: HostResourceAdmission | undefined;

	static global(options: HostResourceAdmissionOptions = {}): HostResourceAdmission {
		if (!HostResourceAdmission.#global) {
			HostResourceAdmission.#global = new HostResourceAdmission(options);
		} else {
			if (
				options.dbPath !== undefined &&
				path.resolve(resolveIrcExternalDbPath(options.dbPath)) !==
					path.resolve(HostResourceAdmission.#global.dbPath)
			) {
				throw new HostAdmissionRejectedError(
					"authority-unavailable",
					"Host resource authority is already bound to a different SQLite database",
				);
			}
			HostResourceAdmission.#global.#refreshResourceProfile(options);
			if (options.onPressure) HostResourceAdmission.#global.#onPressure = options.onPressure;
		}
		return HostResourceAdmission.#global;
	}

	static resetGlobalForTests(): void {
		HostResourceAdmission.#global?.close();
		HostResourceAdmission.#global = undefined;
	}

	readonly dbPath: string;
	readonly #db: Database;
	readonly #leaseTtlMs: number;
	readonly #waiterHeartbeatMs: number;
	readonly #waiterStaleMs: number;
	readonly #queuePollMs: number;
	readonly #observationMaxAgeMs: number;
	readonly #samplerTimer: NodeJS.Timeout;
	#resourceProfile: HostResourceProfile;
	#userCap: number | undefined;
	#memoryBudgetCap: number | undefined;
	#childReservationBytes: number | undefined;
	#hostResourceProbe: HostResourceProbe | undefined;
	#onPressure: ((doorbell: HostMemoryPressureDoorbell) => void | Promise<void>) | undefined;
	#lastHandledPressureEpoch = 0;
	#sampleInFlight: Promise<void> | undefined;
	#closed = false;

	constructor(options: HostResourceAdmissionOptions = {}) {
		this.dbPath = resolveIrcExternalDbPath(options.dbPath);
		this.#userCap = options.userCap;
		this.#memoryBudgetCap = options.memoryBudgetBytes;
		this.#childReservationBytes = options.childReservationBytes;
		this.#hostResourceProbe = options.hostResourceProbe;
		this.#resourceProfile = computeHostResourceProfile({
			userCap: this.#userCap,
			memoryBudgetBytes: this.#memoryBudgetCap,
			childReservationBytes: this.#childReservationBytes,
			probe: this.#hostResourceProbe,
		});
		this.#leaseTtlMs = normalizedPositiveInteger(options.leaseTtlMs, DEFAULT_LEASE_TTL_MS);
		this.#waiterHeartbeatMs = normalizedPositiveInteger(options.waiterHeartbeatMs, DEFAULT_WAITER_HEARTBEAT_MS);
		this.#waiterStaleMs = normalizedPositiveInteger(options.waiterStaleMs, DEFAULT_WAITER_STALE_MS);
		this.#queuePollMs = normalizedPositiveInteger(options.queuePollMs, DEFAULT_QUEUE_POLL_MS);
		this.#observationMaxAgeMs = normalizedPositiveInteger(
			options.observationMaxAgeMs,
			DEFAULT_OBSERVATION_MAX_AGE_MS,
		);
		this.#onPressure = options.onPressure;
		try {
			fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
			this.#db = new Database(this.dbPath);
			this.#db.run("PRAGMA busy_timeout = 3000");
			this.#db.run("PRAGMA journal_mode = WAL");
			this.#db.run("PRAGMA synchronous = FULL");
			this.#db.run("PRAGMA foreign_keys = ON");
			this.#initializeSchema();
		} catch (error) {
			throw this.#authorityError(error);
		}
		const sampleIntervalMs = Math.min(
			60_000,
			Math.max(100, normalizedPositiveInteger(options.sampleIntervalMs, DEFAULT_SAMPLE_INTERVAL_MS)),
		);
		this.#samplerTimer = setInterval(() => {
			void this.sampleNow().catch(() => {
				// A failed observation ages back to declared reservations. Admission remains conservative.
			});
		}, sampleIntervalMs);
		this.#samplerTimer.unref?.();
	}

	#refreshResourceProfile(options: HostResourceAdmissionOptions): void {
		if (options.userCap !== undefined) this.#userCap = options.userCap;
		if (options.memoryBudgetBytes !== undefined) this.#memoryBudgetCap = options.memoryBudgetBytes;
		if (options.childReservationBytes !== undefined) this.#childReservationBytes = options.childReservationBytes;
		if (options.hostResourceProbe !== undefined) this.#hostResourceProbe = options.hostResourceProbe;
		this.#resourceProfile = computeHostResourceProfile({
			userCap: this.#userCap,
			memoryBudgetBytes: this.#memoryBudgetCap,
			childReservationBytes: this.#childReservationBytes,
			probe: this.#hostResourceProbe,
		});
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		clearInterval(this.#samplerTimer);
		this.#db.close();
	}

	async acquire(
		request: HostResourceAdmissionRequest,
		options: { signal?: AbortSignal; onDeferred?: (decision: AdmissionDeferred) => void } = {},
	): Promise<HostResourceLease> {
		validateRequest(request);
		const signal = options.signal;
		if (signal?.aborted) throw this.#cancelled(signal);
		let deferredReceiptWritten = false;
		try {
			const existing = this.#enqueue(request);
			if (existing === "rejected-hard") throw this.#hardPressureError();
			if (existing) return existing;
			let nextHeartbeatAt = Date.now() + this.#waiterHeartbeatMs;
			while (true) {
				if (signal?.aborted) {
					this.#deleteWaiter(request.attemptId);
					throw this.#cancelled(signal);
				}
				this.#reconcileExpired();
				const rejected = this.#takeWaiterRejection(request.attemptId);
				if (rejected) throw new HostAdmissionRejectedError(rejected, "Host memory pressure rejected admission");
				const granted = this.#tryGrant(request.attemptId);
				this.#deliverPressureDoorbell();
				if (granted) {
					if (signal?.aborted) {
						granted.release();
						throw this.#cancelled(signal);
					}
					return granted;
				}
				const postGrantRejection = this.#takeWaiterRejection(request.attemptId);
				if (postGrantRejection) {
					throw new HostAdmissionRejectedError(postGrantRejection, "Host memory pressure rejected admission");
				}
				const now = Date.now();
				if (now >= nextHeartbeatAt) {
					this.#heartbeatWaiter(request.attemptId, now);
					nextHeartbeatAt = now + this.#waiterHeartbeatMs;
				}
				const snapshot = this.#snapshot();
				const own = snapshot.waiters.find(waiter => waiter.attemptId === request.attemptId);
				if (!own) {
					throw new HostAdmissionCorruptError(
						`Host resource waiter ${request.attemptId} disappeared without a lease`,
					);
				}
				const reason: AdmissionDeferredReason =
					snapshot.leases.length >= snapshot.effectiveLimit ? "concurrency-cap" : "memory-budget";
				if (!deferredReceiptWritten) {
					this.#recordDeferred(request.attemptId);
					deferredReceiptWritten = true;
				}
				options.onDeferred?.({
					attemptId: request.attemptId,
					reason,
					queueDepth: snapshot.waiters.findIndex(waiter => waiter.attemptId === request.attemptId) + 1,
				});
				await new Promise<void>((resolve, reject) => {
					const delay = this.#queuePollMs + Math.floor(Math.random() * Math.min(50, this.#queuePollMs));
					const timer = setTimeout(resolve, delay);
					const onAbort = () => {
						clearTimeout(timer);
						reject(this.#cancelled(signal!));
					};
					signal?.addEventListener("abort", onAbort, { once: true });
					if (signal) setTimeout(() => signal.removeEventListener("abort", onAbort), delay).unref?.();
				});
			}
		} catch (error) {
			if (signal?.aborted) {
				try {
					this.#deleteWaiter(request.attemptId);
				} catch (cleanupError) {
					throw this.#authorityError(cleanupError);
				}
				if (
					error instanceof HostAdmissionFencedError ||
					error instanceof HostAdmissionCorruptError ||
					(error instanceof HostAdmissionRejectedError && error.reason !== "cancelled")
				) {
					throw error;
				}
				throw this.#cancelled(signal);
			}
			if (
				error instanceof HostAdmissionRejectedError ||
				error instanceof HostAdmissionFencedError ||
				error instanceof HostAdmissionCorruptError
			) {
				throw error;
			}
			throw this.#authorityError(error);
		}
	}

	inspect(): HostResourcePoolSnapshot {
		try {
			this.#reconcileExpired();
			this.#immediate(() => this.#refreshPressureLocked(Date.now()));
			const snapshot = this.#snapshot();
			this.#deliverPressureDoorbell(snapshot);
			return snapshot;
		} catch (error) {
			if (error instanceof HostAdmissionCorruptError) throw error;
			throw this.#authorityError(error);
		}
	}

	async sampleNow(): Promise<void> {
		this.#assertOpen();
		if (this.#sampleInFlight) return this.#sampleInFlight;
		this.#sampleInFlight = (async () => {
			const rows = this.#leaseRows();
			const targets: LeaseProcessTarget[] = rows.map(row => {
				const target: LeaseProcessTarget = { leaseId: row.lease_id, holderProcess: holderFromRow(row) };
				if (row.child_boot_id && row.child_pid && row.child_start_fingerprint) {
					return {
						...target,
						childProcess: {
							bootId: row.child_boot_id,
							pid: row.child_pid,
							startFingerprint: row.child_start_fingerprint,
						},
					};
				}
				return target;
			});
			const sample = await sampleLeaseProcessTrees(targets);
			this.#immediate(() => {
				for (const [leaseId, observedBytes] of sample.observedBytesByLease) {
					this.#db
						.query(
							`UPDATE resource_leases SET observed_bytes=$observedBytes, observed_at_ms=$observedAtMs
							 WHERE lease_id=$leaseId AND state='active'`,
						)
						.run({ $observedBytes: observedBytes, $observedAtMs: sample.sampledAtMs, $leaseId: leaseId });
				}
				this.#db
					.query("UPDATE resource_pool_state SET sample_at_ms=$sampleAtMs WHERE id=1")
					.run({ $sampleAtMs: sample.sampledAtMs });
				this.#refreshPressureLocked(sample.sampledAtMs);
			});
			this.#deliverPressureDoorbell();
		})().finally(() => {
			this.#sampleInFlight = undefined;
		});
		return this.#sampleInFlight;
	}

	renewLease(leaseId: string, fenceToken: number): "renewed" | "fenced" {
		try {
			const now = Date.now();
			const changes = this.#immediate(
				() =>
					this.#db
						.query(
							`UPDATE resource_leases SET heartbeat_at_ms=$now, expires_at_ms=$expiresAt
							 WHERE lease_id=$leaseId AND fence_token=$fenceToken AND state='active'`,
						)
						.run({ $now: now, $expiresAt: now + this.#leaseTtlMs, $leaseId: leaseId, $fenceToken: fenceToken })
						.changes,
			);
			this.#deliverPressureDoorbell();
			return changes === 1 ? "renewed" : "fenced";
		} catch (error) {
			throw this.#authorityError(error);
		}
	}

	releaseLease(leaseId: string, fenceToken: number): void {
		try {
			const current = this.#immediate(() => {
				const row = this.#db
					.query<{ attempt_id: string }, { $leaseId: string; $fenceToken: number }>(
						"SELECT attempt_id FROM resource_leases WHERE lease_id=$leaseId AND fence_token=$fenceToken",
					)
					.get({ $leaseId: leaseId, $fenceToken: fenceToken });
				if (row) {
					this.#db
						.query("DELETE FROM resource_leases WHERE lease_id=$leaseId AND fence_token=$fenceToken")
						.run({ $leaseId: leaseId, $fenceToken: fenceToken });
					this.#appendReceiptLocked({
						id: randomUUID(),
						type: "released",
						atMs: Date.now(),
						attemptId: row.attempt_id,
						leaseId,
					});
					this.#refreshPressureLocked(Date.now());
					return undefined;
				}
				return this.#db
					.query<{ fence_token: number }, { $leaseId: string }>(
						"SELECT fence_token FROM resource_leases WHERE lease_id=$leaseId",
					)
					.get({ $leaseId: leaseId });
			});
			if (current !== null && current !== undefined) throw new HostAdmissionFencedError(leaseId, fenceToken);
		} catch (error) {
			if (error instanceof HostAdmissionFencedError) throw error;
			throw this.#authorityError(error);
		}
	}

	#initializeSchema(): void {
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS resource_pool_state (
				id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL,
				next_ticket INTEGER NOT NULL, next_fence_token INTEGER NOT NULL, grant_sequence INTEGER NOT NULL,
				pressure_state TEXT NOT NULL CHECK (pressure_state IN ('normal', 'gc', 'hard')),
				pressure_since_ms INTEGER, pressure_epoch INTEGER NOT NULL, emergency_epoch INTEGER NOT NULL DEFAULT 0,
				sample_json TEXT, sample_at_ms INTEGER, receipts_json TEXT NOT NULL
			)
		`);
		const existingVersion = this.#db
			.query<{ schema_version: number }, []>("SELECT schema_version FROM resource_pool_state WHERE id=1")
			.get();
		if (existingVersion && existingVersion.schema_version !== RESOURCE_SCHEMA_VERSION) {
			throw new HostAdmissionCorruptError(
				`Host resource schema ${existingVersion.schema_version} is not supported; expected ${RESOURCE_SCHEMA_VERSION}`,
			);
		}
		if (!existingVersion) {
			this.#db.run(`
				INSERT INTO resource_pool_state
					(id, schema_version, next_ticket, next_fence_token, grant_sequence, pressure_state, pressure_epoch, receipts_json)
				VALUES (1, ${RESOURCE_SCHEMA_VERSION}, 1, 1, 0, 'normal', 0, '[]')
			`);
		}
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS resource_waiters (
				attempt_id TEXT PRIMARY KEY, ticket INTEGER NOT NULL UNIQUE,
				kind TEXT NOT NULL CHECK (kind IN ('spawn', 'revive')), session_id TEXT NOT NULL,
				session_owner_epoch TEXT, parent_agent_id TEXT NOT NULL, agent_id TEXT NOT NULL, job_id TEXT NOT NULL,
				holder_boot_id TEXT NOT NULL, holder_pid INTEGER NOT NULL, holder_start_fingerprint TEXT NOT NULL,
				reservation_bytes INTEGER NOT NULL CHECK (reservation_bytes > 0), enqueued_at_ms INTEGER NOT NULL,
				heartbeat_at_ms INTEGER NOT NULL, rejection_reason TEXT CHECK (rejection_reason IS NULL OR rejection_reason='pressure-hard')
			)
		`);
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS resource_leases (
				lease_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL UNIQUE, fence_token INTEGER NOT NULL UNIQUE,
				kind TEXT NOT NULL CHECK (kind IN ('spawn', 'revive')), session_id TEXT NOT NULL, session_owner_epoch TEXT,
				parent_agent_id TEXT NOT NULL, agent_id TEXT NOT NULL, job_id TEXT NOT NULL,
				holder_boot_id TEXT NOT NULL, holder_pid INTEGER NOT NULL, holder_start_fingerprint TEXT NOT NULL,
				child_boot_id TEXT, child_pid INTEGER, child_start_fingerprint TEXT, child_pgid INTEGER,
				state TEXT NOT NULL CHECK (state IN ('active', 'reaping')),
				reservation_bytes INTEGER NOT NULL CHECK (reservation_bytes > 0), observed_bytes INTEGER NOT NULL,
				observed_at_ms INTEGER NOT NULL, acquired_at_ms INTEGER NOT NULL, heartbeat_at_ms INTEGER NOT NULL,
				expires_at_ms INTEGER NOT NULL, terminal_receipt_digest TEXT
			)
		`);
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS resource_session_fairness (
				session_id TEXT PRIMARY KEY, last_grant_sequence INTEGER NOT NULL
			)
		`);
		this.#db.run("CREATE INDEX IF NOT EXISTS idx_resource_waiters_ticket ON resource_waiters(ticket)");
		this.#db.run(
			"CREATE INDEX IF NOT EXISTS idx_resource_waiters_session_ticket ON resource_waiters(session_id, ticket)",
		);
		this.#db.run("CREATE INDEX IF NOT EXISTS idx_resource_leases_expiry ON resource_leases(expires_at_ms)");
		this.#db.run("CREATE INDEX IF NOT EXISTS idx_resource_leases_holder_pid ON resource_leases(holder_pid)");
		this.#db.run("CREATE INDEX IF NOT EXISTS idx_resource_leases_child_pid ON resource_leases(child_pid)");
	}

	#enqueue(request: HostResourceAdmissionRequest): HostResourceLease | "rejected-hard" | undefined {
		return this.#immediate(() => {
			const existingLease = this.#db
				.query<LeaseRow, { $attemptId: string }>("SELECT * FROM resource_leases WHERE attempt_id=$attemptId")
				.get({ $attemptId: request.attemptId });
			if (existingLease) {
				this.#assertSameAttempt(existingLease, request);
				return this.#leaseFromRow(existingLease);
			}
			const existingWaiter = this.#db
				.query<WaiterRow, { $attemptId: string }>("SELECT * FROM resource_waiters WHERE attempt_id=$attemptId")
				.get({ $attemptId: request.attemptId });
			if (existingWaiter) {
				this.#assertSameAttempt(existingWaiter, request);
				return existingWaiter.rejection_reason ? "rejected-hard" : undefined;
			}
			this.#refreshPressureLocked(Date.now());
			if (pressureState(this.#poolState().pressure_state) === "hard") return "rejected-hard";
			const state = this.#poolState();
			const now = Date.now();
			this.#db
				.query(
					`INSERT INTO resource_waiters (
					 attempt_id, ticket, kind, session_id, session_owner_epoch, parent_agent_id, agent_id, job_id,
					 holder_boot_id, holder_pid, holder_start_fingerprint, reservation_bytes, enqueued_at_ms, heartbeat_at_ms
					 ) VALUES (
					 $attemptId, $ticket, $kind, $sessionId, $sessionOwnerEpoch, $parentAgentId, $agentId, $jobId,
					 $holderBootId, $holderPid, $holderStartFingerprint, $reservationBytes, $now, $now
					 )`,
				)
				.run({
					$attemptId: request.attemptId,
					$ticket: state.next_ticket,
					$kind: request.kind,
					$sessionId: request.sessionId,
					$sessionOwnerEpoch: request.sessionOwnerEpoch,
					$parentAgentId: request.parentAgentId,
					$agentId: request.agentId,
					$jobId: request.jobId,
					$holderBootId: request.holderProcess.bootId,
					$holderPid: request.holderProcess.pid,
					$holderStartFingerprint: request.holderProcess.startFingerprint,
					$reservationBytes: request.reservationBytes,
					$now: now,
				});
			this.#db.run("UPDATE resource_pool_state SET next_ticket=next_ticket+1 WHERE id=1");
			this.#appendReceiptLocked({ id: randomUUID(), type: "queued", atMs: now, attemptId: request.attemptId });
			return undefined;
		});
	}

	#tryGrant(attemptId: string): HostResourceLease | undefined {
		return this.#immediate(() => {
			const existing = this.#db
				.query<LeaseRow, { $attemptId: string }>("SELECT * FROM resource_leases WHERE attempt_id=$attemptId")
				.get({ $attemptId: attemptId });
			if (existing) return this.#leaseFromRow(existing);
			this.#refreshPressureLocked(Date.now());
			const waiters = this.#db.query<WaiterRow, []>("SELECT * FROM resource_waiters ORDER BY ticket").all();
			if (waiters.length === 0 || waiters.some(row => row.attempt_id === attemptId && row.rejection_reason))
				return undefined;
			const leases = this.#leaseRows();
			if (leases.length >= this.#resourceProfile.effectiveLimit) return undefined;
			const sessionHeads = new Map<string, WaiterRow>();
			for (const waiter of waiters) {
				if (!waiter.rejection_reason && !sessionHeads.has(waiter.session_id))
					sessionHeads.set(waiter.session_id, waiter);
			}
			const fairness = new Map(
				this.#db
					.query<FairnessRow, []>("SELECT session_id, last_grant_sequence FROM resource_session_fairness")
					.all()
					.map(row => [row.session_id, row.last_grant_sequence] as const),
			);
			const selected = [...sessionHeads.values()].sort((left, right) => {
				const sequenceDelta = (fairness.get(left.session_id) ?? 0) - (fairness.get(right.session_id) ?? 0);
				return sequenceDelta || left.ticket - right.ticket;
			})[0];
			if (!selected || selected.attempt_id !== attemptId) return undefined;
			const now = Date.now();
			const projectedBytes = this.#resourceTotals(leases, now).chargedBytes + selected.reservation_bytes;
			if (projectedBytes > this.#resourceProfile.memoryBudgetBytes) return undefined;
			if (projectedBytes / this.#resourceProfile.memoryBudgetBytes >= HARD_PRESSURE_RATIO) {
				this.#setPressureStateLocked("hard", projectedBytes, now);
				this.#rejectWaitersLocked(now);
				return undefined;
			}
			const state = this.#poolState();
			const leaseId = randomUUID();
			this.#db
				.query(
					`INSERT INTO resource_leases (
					 lease_id, attempt_id, fence_token, kind, session_id, session_owner_epoch, parent_agent_id,
					 agent_id, job_id, holder_boot_id, holder_pid, holder_start_fingerprint, state,
					 reservation_bytes, observed_bytes, observed_at_ms, acquired_at_ms, heartbeat_at_ms, expires_at_ms
					 ) VALUES (
					 $leaseId, $attemptId, $fenceToken, $kind, $sessionId, $sessionOwnerEpoch, $parentAgentId,
					 $agentId, $jobId, $holderBootId, $holderPid, $holderStartFingerprint, 'active',
					 $reservationBytes, $reservationBytes, $now, $now, $now, $expiresAt
					 )`,
				)
				.run({
					$leaseId: leaseId,
					$attemptId: selected.attempt_id,
					$fenceToken: state.next_fence_token,
					$kind: selected.kind,
					$sessionId: selected.session_id,
					$sessionOwnerEpoch: selected.session_owner_epoch,
					$parentAgentId: selected.parent_agent_id,
					$agentId: selected.agent_id,
					$jobId: selected.job_id,
					$holderBootId: selected.holder_boot_id,
					$holderPid: selected.holder_pid,
					$holderStartFingerprint: selected.holder_start_fingerprint,
					$reservationBytes: selected.reservation_bytes,
					$now: now,
					$expiresAt: now + this.#leaseTtlMs,
				});
			this.#db.query("DELETE FROM resource_waiters WHERE attempt_id=$attemptId").run({ $attemptId: attemptId });
			const nextSequence = state.grant_sequence + 1;
			this.#db
				.query(
					`INSERT INTO resource_session_fairness (session_id, last_grant_sequence) VALUES ($sessionId, $sequence)
					 ON CONFLICT(session_id) DO UPDATE SET last_grant_sequence=excluded.last_grant_sequence`,
				)
				.run({ $sessionId: selected.session_id, $sequence: nextSequence });
			this.#db
				.query(
					"UPDATE resource_pool_state SET next_fence_token=next_fence_token+1, grant_sequence=$sequence WHERE id=1",
				)
				.run({ $sequence: nextSequence });
			this.#appendReceiptLocked({
				id: randomUUID(),
				type: "admitted",
				atMs: now,
				attemptId: selected.attempt_id,
				leaseId,
				chargedBytes: projectedBytes,
				budgetBytes: this.#resourceProfile.memoryBudgetBytes,
			});
			this.#refreshPressureLocked(now);
			return new HostResourceLease(
				this,
				leaseId,
				selected.attempt_id,
				state.next_fence_token,
				attemptKind(selected.kind),
			);
		});
	}

	#reconcileExpired(): void {
		const now = Date.now();
		const expiredWaiters = this.#db
			.query<WaiterRow, { $staleBefore: number }>(
				"SELECT * FROM resource_waiters WHERE heartbeat_at_ms <= $staleBefore ORDER BY ticket LIMIT 32",
			)
			.all({ $staleBefore: now - this.#waiterStaleMs });
		const expiredLeases = this.#db
			.query<LeaseRow, { $now: number }>(
				"SELECT * FROM resource_leases WHERE expires_at_ms <= $now ORDER BY expires_at_ms LIMIT 32",
			)
			.all({ $now: now });
		const deadWaiters = expiredWaiters.filter(row => holderIsProvenDead(holderFromRow(row)));
		const deadLeases = expiredLeases.filter(row => holderIsProvenDead(holderFromRow(row)));
		if (deadWaiters.length === 0 && deadLeases.length === 0) return;
		this.#immediate(() => {
			for (const waiter of deadWaiters) {
				this.#db
					.query(
						`DELETE FROM resource_waiters WHERE attempt_id=$attemptId AND holder_boot_id=$bootId AND holder_pid=$pid
						 AND holder_start_fingerprint=$startFingerprint AND heartbeat_at_ms <= $staleBefore`,
					)
					.run({
						$attemptId: waiter.attempt_id,
						$bootId: waiter.holder_boot_id,
						$pid: waiter.holder_pid,
						$startFingerprint: waiter.holder_start_fingerprint,
						$staleBefore: now - this.#waiterStaleMs,
					});
			}
			for (const lease of deadLeases) {
				this.#db
					.query(
						`DELETE FROM resource_leases WHERE lease_id=$leaseId AND fence_token=$fenceToken AND holder_boot_id=$bootId
						 AND holder_pid=$pid AND holder_start_fingerprint=$startFingerprint AND expires_at_ms <= $now`,
					)
					.run({
						$leaseId: lease.lease_id,
						$fenceToken: lease.fence_token,
						$bootId: lease.holder_boot_id,
						$pid: lease.holder_pid,
						$startFingerprint: lease.holder_start_fingerprint,
						$now: now,
					});
			}
			this.#refreshPressureLocked(now);
		});
	}

	#refreshPressureLocked(now: number): void {
		const chargedBytes = this.#resourceTotals(this.#leaseRows(), now).chargedBytes;
		const ratio = chargedBytes / this.#resourceProfile.memoryBudgetBytes;
		const next: HostResourcePressureState =
			ratio >= HARD_PRESSURE_RATIO ? "hard" : ratio >= GC_PRESSURE_RATIO ? "gc" : "normal";
		this.#setPressureStateLocked(next, chargedBytes, now);
		if (next === "hard") this.#rejectWaitersLocked(now);
	}

	#setPressureStateLocked(next: HostResourcePressureState, chargedBytes: number, now: number): void {
		const state = this.#poolState();
		const previous = pressureState(state.pressure_state);
		if (previous === next) return;
		const crossedGc = previous === "normal" && next !== "normal";
		this.#db
			.query(
				`UPDATE resource_pool_state SET pressure_state=$pressureState, pressure_since_ms=$now,
				 pressure_epoch=pressure_epoch+$epochDelta WHERE id=1`,
			)
			.run({ $pressureState: next, $now: now, $epochDelta: crossedGc ? 1 : 0 });
		this.#appendReceiptLocked({
			id: randomUUID(),
			type: "pressure",
			atMs: now,
			pressureState: next,
			chargedBytes,
			budgetBytes: this.#resourceProfile.memoryBudgetBytes,
		});
	}

	#rejectWaitersLocked(now: number): void {
		const changes = this.#db
			.query("UPDATE resource_waiters SET rejection_reason='pressure-hard' WHERE rejection_reason IS NULL")
			.run().changes;
		if (changes > 0) {
			this.#appendReceiptLocked({ id: randomUUID(), type: "waiters-rejected", atMs: now, count: changes });
		}
	}

	#resourceTotals(rows: readonly LeaseRow[], now: number): ResourceTotals {
		let reservedBytes = 0;
		let observedBytes = 0;
		let chargedBytes = 0;
		for (const row of rows) {
			reservedBytes += row.reservation_bytes;
			const fresh = now - row.observed_at_ms <= this.#observationMaxAgeMs;
			const effectiveObserved = fresh ? row.observed_bytes : row.reservation_bytes;
			observedBytes += effectiveObserved;
			chargedBytes += Math.max(row.reservation_bytes, effectiveObserved);
		}
		return { reservedBytes, observedBytes, chargedBytes };
	}

	#deliverPressureDoorbell(snapshot = this.#snapshot()): void {
		if (!this.#onPressure || snapshot.pressureEpoch <= this.#lastHandledPressureEpoch) return;
		this.#lastHandledPressureEpoch = snapshot.pressureEpoch;
		if (snapshot.pressureState === "normal") return;
		void Promise.resolve(
			this.#onPressure({
				epoch: snapshot.pressureEpoch,
				state: snapshot.pressureState,
				chargedBytes: snapshot.chargedBytes,
				budgetBytes: snapshot.memoryBudgetBytes,
				atMs: Date.now(),
			}),
		).catch(() => {
			// The durable epoch prevents an exception in cooperative cleanup from weakening admission.
		});
	}

	#recordDeferred(attemptId: string): void {
		this.#immediate(() =>
			this.#appendReceiptLocked({ id: randomUUID(), type: "deferred", atMs: Date.now(), attemptId }),
		);
	}

	#appendReceiptLocked(receipt: HostResourcePoolReceipt): void {
		const row = this.#db
			.query<{ receipts_json: string }, []>("SELECT receipts_json FROM resource_pool_state WHERE id=1")
			.get();
		let receipts: HostResourcePoolReceipt[];
		try {
			const parsed = JSON.parse(row?.receipts_json ?? "");
			if (!Array.isArray(parsed)) throw new Error("not an array");
			receipts = parsed as HostResourcePoolReceipt[];
		} catch (error) {
			throw new HostAdmissionCorruptError("Host resource receipt snapshot is malformed", { cause: error });
		}
		receipts.push(receipt);
		this.#db
			.query("UPDATE resource_pool_state SET receipts_json=$receipts WHERE id=1")
			.run({ $receipts: JSON.stringify(receipts.slice(-MAX_RECEIPTS)) });
	}

	#heartbeatWaiter(attemptId: string, now: number): void {
		this.#immediate(() => {
			this.#db
				.query("UPDATE resource_waiters SET heartbeat_at_ms=$now WHERE attempt_id=$attemptId")
				.run({ $now: now, $attemptId: attemptId });
		});
	}

	#deleteWaiter(attemptId: string): void {
		this.#immediate(() => {
			this.#db.query("DELETE FROM resource_waiters WHERE attempt_id=$attemptId").run({ $attemptId: attemptId });
		});
	}

	#takeWaiterRejection(attemptId: string): AdmissionRejectedReason | undefined {
		return this.#immediate(() => {
			const row = this.#db
				.query<{ rejection_reason: string | null }, { $attemptId: string }>(
					"SELECT rejection_reason FROM resource_waiters WHERE attempt_id=$attemptId",
				)
				.get({ $attemptId: attemptId });
			if (!row?.rejection_reason) return undefined;
			this.#db.query("DELETE FROM resource_waiters WHERE attempt_id=$attemptId").run({ $attemptId: attemptId });
			return rejectionReason(row.rejection_reason);
		});
	}

	#snapshot(): HostResourcePoolSnapshot {
		this.#assertOpen();
		const now = Date.now();
		const waiters = this.#db.query<WaiterRow, []>("SELECT * FROM resource_waiters ORDER BY ticket").all();
		const leases = this.#leaseRows();
		const totals = this.#resourceTotals(leases, now);
		const state = this.#poolState();
		let receipts: HostResourcePoolReceipt[];
		try {
			const parsed = JSON.parse(state.receipts_json);
			if (!Array.isArray(parsed)) throw new Error("not an array");
			receipts = parsed as HostResourcePoolReceipt[];
		} catch (error) {
			throw new HostAdmissionCorruptError("Host resource receipt snapshot is malformed", { cause: error });
		}
		return {
			mode: this.#resourceProfile.mode,
			userCap: this.#resourceProfile.userCap,
			effectiveLimit: this.#resourceProfile.effectiveLimit,
			limitingBounds: this.#resourceProfile.limitingBounds,
			limitExplanation: this.#resourceProfile.explanation,
			cpuCapacity: this.#resourceProfile.cpuCapacity,
			memoryCapacity: this.#resourceProfile.memoryCapacity,
			reservedHeadroomBytes: this.#resourceProfile.reservedHeadroomBytes,
			effectiveMemoryBytes: this.#resourceProfile.effectiveMemoryBytes,
			effectiveCpuCount: this.#resourceProfile.effectiveCpuCount,
			availableSlots: Math.max(
				0,
				Math.min(
					this.#resourceProfile.effectiveLimit - leases.length,
					Math.floor(
						(this.#resourceProfile.memoryBudgetBytes - totals.chargedBytes) /
							this.#resourceProfile.childReservationBytes,
					),
				),
			),
			memoryBudgetBytes: this.#resourceProfile.memoryBudgetBytes,
			reservedBytes: totals.reservedBytes,
			observedBytes: totals.observedBytes,
			chargedBytes: totals.chargedBytes,
			pressureState: pressureState(state.pressure_state),
			pressureRatio: totals.chargedBytes / this.#resourceProfile.memoryBudgetBytes,
			pressureEpoch: state.pressure_epoch,
			sampledAtMs: state.sample_at_ms,
			waiters: waiters.map(row => ({
				attemptId: row.attempt_id,
				ticket: row.ticket,
				kind: attemptKind(row.kind),
				sessionId: row.session_id,
				agentId: row.agent_id,
				reservationBytes: row.reservation_bytes,
				rejectionReason: row.rejection_reason ? rejectionReason(row.rejection_reason) : null,
				holderProcess: holderFromRow(row),
			})),
			leases: leases.map(row => {
				const effectiveObserved =
					now - row.observed_at_ms <= this.#observationMaxAgeMs ? row.observed_bytes : row.reservation_bytes;
				return {
					leaseId: row.lease_id,
					attemptId: row.attempt_id,
					fenceToken: row.fence_token,
					kind: attemptKind(row.kind),
					sessionId: row.session_id,
					agentId: row.agent_id,
					holderProcess: holderFromRow(row),
					reservationBytes: row.reservation_bytes,
					observedBytes: effectiveObserved,
					observedAtMs: row.observed_at_ms,
					chargedBytes: Math.max(row.reservation_bytes, effectiveObserved),
					acquiredAtMs: row.acquired_at_ms,
					heartbeatAtMs: row.heartbeat_at_ms,
					expiresAtMs: row.expires_at_ms,
				};
			}),
			receipts,
		};
	}

	#leaseRows(): LeaseRow[] {
		return this.#db.query<LeaseRow, []>("SELECT * FROM resource_leases ORDER BY acquired_at_ms, fence_token").all();
	}

	#poolState(): PoolStateRow {
		const row = this.#db.query<PoolStateRow, []>("SELECT * FROM resource_pool_state WHERE id=1").get();
		if (
			row?.schema_version !== RESOURCE_SCHEMA_VERSION ||
			!Number.isSafeInteger(row.next_ticket) ||
			row.next_ticket < 1 ||
			!Number.isSafeInteger(row.next_fence_token) ||
			row.next_fence_token < 1 ||
			!Number.isSafeInteger(row.grant_sequence) ||
			row.grant_sequence < 0 ||
			!Number.isSafeInteger(row.pressure_epoch) ||
			row.pressure_epoch < 0 ||
			typeof row.receipts_json !== "string"
		) {
			throw new HostAdmissionCorruptError("Host resource pool state is malformed");
		}
		pressureState(row.pressure_state);
		return row;
	}

	#assertSameAttempt(row: WaiterRow | LeaseRow, request: HostResourceAdmissionRequest): void {
		const holder = holderFromRow(row);
		if (
			attemptKind(row.kind) !== request.kind ||
			row.session_id !== request.sessionId ||
			row.session_owner_epoch !== request.sessionOwnerEpoch ||
			row.parent_agent_id !== request.parentAgentId ||
			row.agent_id !== request.agentId ||
			row.job_id !== request.jobId ||
			holder.bootId !== request.holderProcess.bootId ||
			holder.pid !== request.holderProcess.pid ||
			holder.startFingerprint !== request.holderProcess.startFingerprint ||
			row.reservation_bytes !== request.reservationBytes
		) {
			throw new HostAdmissionCorruptError(`Attempt id ${request.attemptId} was reused with different ownership`);
		}
	}

	#leaseFromRow(row: LeaseRow): HostResourceLease {
		return new HostResourceLease(this, row.lease_id, row.attempt_id, row.fence_token, attemptKind(row.kind));
	}

	#immediate<T>(operation: () => T): T {
		this.#assertOpen();
		this.#db.run("BEGIN IMMEDIATE");
		try {
			const result = operation();
			this.#db.run("COMMIT");
			return result;
		} catch (error) {
			try {
				this.#db.run("ROLLBACK");
			} catch {
				// Preserve the mutation failure; the connection remains fail-closed.
			}
			throw error;
		}
	}

	#assertOpen(): void {
		if (this.#closed)
			throw new HostAdmissionRejectedError("authority-unavailable", "Host resource authority is closed");
	}

	#hardPressureError(): HostAdmissionRejectedError {
		return new HostAdmissionRejectedError("pressure-hard", "Host memory pressure is at or above the hard threshold");
	}

	#cancelled(signal: AbortSignal): HostAdmissionRejectedError {
		return new HostAdmissionRejectedError("cancelled", "Host resource admission was cancelled", {
			cause: signal.reason,
		});
	}

	#authorityError(error: unknown): HostAdmissionRejectedError | HostAdmissionCorruptError {
		if (error instanceof HostAdmissionRejectedError || error instanceof HostAdmissionCorruptError) return error;
		const message = error instanceof Error ? error.message : String(error);
		if (/malformed|corrupt|database disk image|schema/i.test(message)) {
			return new HostAdmissionCorruptError(`Host resource authority is corrupt: ${message}`, { cause: error });
		}
		return new HostAdmissionRejectedError(
			"authority-unavailable",
			`Host resource authority unavailable: ${message}`,
			{
				cause: error,
			},
		);
	}
}

export { DEFAULT_ATTEMPT_RESERVATION_BYTES };
