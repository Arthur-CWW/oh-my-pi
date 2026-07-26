import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveIrcExternalDbPath } from "../irc/bus-external";
import { type ProcessIdentity, readProcessIdentity } from "./process-identity";

export const COMPILED_MAX_LIVE_ATTEMPTS = 3;
const DEFAULT_LEASE_TTL_MS = 10_000;
const DEFAULT_WAITER_HEARTBEAT_MS = 5_000;
const DEFAULT_WAITER_STALE_MS = 30_000;
const DEFAULT_QUEUE_POLL_MS = 250;

export type ResourceAttemptKind = "spawn" | "revive";
export type AdmissionDeferredReason = "capacity" | "revive-reserve" | "stale-owner-reaping";
export type AdmissionRejectedReason = "authority-unavailable" | "cancelled";

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

export interface HostResourceAdmissionOptions {
	readonly dbPath?: string;
	readonly maxLiveAttempts?: number;
	readonly leaseTtlMs?: number;
	readonly waiterHeartbeatMs?: number;
	readonly waiterStaleMs?: number;
	readonly queuePollMs?: number;
}

export interface HostResourceWaiterSnapshot {
	readonly attemptId: string;
	readonly ticket: number;
	readonly kind: ResourceAttemptKind;
	readonly sessionId: string;
	readonly agentId: string;
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
	readonly acquiredAtMs: number;
	readonly heartbeatAtMs: number;
	readonly expiresAtMs: number;
}

export interface HostResourcePoolSnapshot {
	readonly configuredWidth: number;
	readonly reviveReserve: number;
	readonly waiters: readonly HostResourceWaiterSnapshot[];
	readonly leases: readonly HostResourceLeaseSnapshot[];
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
	reservation_bytes: number;
	acquired_at_ms: number;
	heartbeat_at_ms: number;
	expires_at_ms: number;
}

interface PoolStateRow {
	schema_version: number;
	next_ticket: number;
	next_fence_token: number;
	grant_sequence: number;
}

interface FairnessRow {
	session_id: string;
	last_grant_sequence: number;
}

function normalizedPositiveInteger(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function attemptKind(value: string): ResourceAttemptKind {
	if (value === "spawn" || value === "revive") return value;
	throw new HostAdmissionCorruptError(`Invalid host resource attempt kind ${JSON.stringify(value)}`);
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
	return {
		bootId: row.holder_boot_id,
		pid: row.holder_pid,
		startFingerprint: row.holder_start_fingerprint,
	};
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
	if (!Number.isSafeInteger(request.reservationBytes) || request.reservationBytes < 0) {
		throw new HostAdmissionRejectedError("authority-unavailable", "Host resource reservation must be a safe integer");
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
			if (options.maxLiveAttempts !== undefined) {
				HostResourceAdmission.#global.#configuredWidth = HostResourceAdmission.#normalizeWidth(
					options.maxLiveAttempts,
				);
			}
		}
		return HostResourceAdmission.#global;
	}

	static resetGlobalForTests(): void {
		HostResourceAdmission.#global?.close();
		HostResourceAdmission.#global = undefined;
	}

	static #normalizeWidth(value: number | undefined): number {
		if (value === undefined) return 1;
		if (!Number.isSafeInteger(value) || value < 1) return 1;
		return Math.min(value, COMPILED_MAX_LIVE_ATTEMPTS);
	}

	readonly dbPath: string;
	readonly #db: Database;
	readonly #leaseTtlMs: number;
	readonly #waiterHeartbeatMs: number;
	readonly #waiterStaleMs: number;
	readonly #queuePollMs: number;
	#configuredWidth: number;
	#closed = false;

	constructor(options: HostResourceAdmissionOptions = {}) {
		this.dbPath = resolveIrcExternalDbPath(options.dbPath);
		this.#configuredWidth = HostResourceAdmission.#normalizeWidth(options.maxLiveAttempts);
		this.#leaseTtlMs = normalizedPositiveInteger(options.leaseTtlMs, DEFAULT_LEASE_TTL_MS);
		this.#waiterHeartbeatMs = normalizedPositiveInteger(options.waiterHeartbeatMs, DEFAULT_WAITER_HEARTBEAT_MS);
		this.#waiterStaleMs = normalizedPositiveInteger(options.waiterStaleMs, DEFAULT_WAITER_STALE_MS);
		this.#queuePollMs = normalizedPositiveInteger(options.queuePollMs, DEFAULT_QUEUE_POLL_MS);
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
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#db.close();
	}

	async acquire(
		request: HostResourceAdmissionRequest,
		options: { signal?: AbortSignal; onDeferred?: (decision: AdmissionDeferred) => void } = {},
	): Promise<HostResourceLease> {
		validateRequest(request);
		const signal = options.signal;
		if (signal?.aborted) throw this.#cancelled(signal);
		try {
			const existing = this.#enqueue(request);
			if (existing) return existing;
			let nextHeartbeatAt = Date.now() + this.#waiterHeartbeatMs;
			while (true) {
				if (signal?.aborted) {
					this.#deleteWaiter(request.attemptId);
					throw this.#cancelled(signal);
				}
				this.#reconcileExpired();
				const granted = this.#tryGrant(request.attemptId);
				if (granted) {
					if (signal?.aborted) {
						granted.release();
						throw this.#cancelled(signal);
					}
					return granted;
				}
				const now = Date.now();
				if (now >= nextHeartbeatAt) {
					this.#heartbeatWaiter(request.attemptId, now);
					nextHeartbeatAt = now + this.#waiterHeartbeatMs;
				}
				const snapshot = this.#snapshot(false);
				const own = snapshot.waiters.find(waiter => waiter.attemptId === request.attemptId);
				if (!own) {
					throw new HostAdmissionCorruptError(
						`Host resource waiter ${request.attemptId} disappeared without a lease`,
					);
				}
				const spawnCount = snapshot.leases.reduce((count, lease) => count + (lease.kind === "spawn" ? 1 : 0), 0);
				const reason: AdmissionDeferredReason =
					request.kind === "spawn" && this.#configuredWidth >= 2 && spawnCount >= this.#configuredWidth - 1
						? "revive-reserve"
						: "capacity";
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
					if (signal) {
						const settle = () => signal.removeEventListener("abort", onAbort);
						setTimeout(settle, delay).unref?.();
					}
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
			return this.#snapshot(true);
		} catch (error) {
			if (error instanceof HostAdmissionCorruptError) throw error;
			throw this.#authorityError(error);
		}
	}

	renewLease(leaseId: string, fenceToken: number): "renewed" | "fenced" {
		try {
			const now = Date.now();
			const changes = this.#immediate(
				() =>
					this.#db
						.query(
							`UPDATE resource_leases
						 SET heartbeat_at_ms=$now, expires_at_ms=$expiresAt
						 WHERE lease_id=$leaseId AND fence_token=$fenceToken AND state='active'`,
						)
						.run({ $now: now, $expiresAt: now + this.#leaseTtlMs, $leaseId: leaseId, $fenceToken: fenceToken })
						.changes,
			);
			return changes === 1 ? "renewed" : "fenced";
		} catch (error) {
			throw this.#authorityError(error);
		}
	}

	releaseLease(leaseId: string, fenceToken: number): void {
		try {
			const current = this.#immediate(() => {
				const changes = this.#db
					.query("DELETE FROM resource_leases WHERE lease_id=$leaseId AND fence_token=$fenceToken")
					.run({ $leaseId: leaseId, $fenceToken: fenceToken }).changes;
				if (changes === 1) return undefined;
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
				id INTEGER PRIMARY KEY CHECK (id = 1),
				schema_version INTEGER NOT NULL,
				next_ticket INTEGER NOT NULL,
				next_fence_token INTEGER NOT NULL,
				grant_sequence INTEGER NOT NULL,
				pressure_state TEXT NOT NULL DEFAULT 'normal',
				pressure_since_ms INTEGER,
				emergency_epoch INTEGER NOT NULL DEFAULT 0,
				sample_json TEXT,
				sample_at_ms INTEGER
			)
		`);
		this.#db.run(`
			INSERT OR IGNORE INTO resource_pool_state
				(id, schema_version, next_ticket, next_fence_token, grant_sequence)
			VALUES (1, 1, 1, 1, 0)
		`);
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS resource_waiters (
				attempt_id TEXT PRIMARY KEY,
				ticket INTEGER NOT NULL UNIQUE,
				kind TEXT NOT NULL CHECK (kind IN ('spawn', 'revive')),
				session_id TEXT NOT NULL,
				session_owner_epoch TEXT,
				parent_agent_id TEXT NOT NULL,
				agent_id TEXT NOT NULL,
				job_id TEXT NOT NULL,
				holder_boot_id TEXT NOT NULL,
				holder_pid INTEGER NOT NULL,
				holder_start_fingerprint TEXT NOT NULL,
				reservation_bytes INTEGER NOT NULL,
				enqueued_at_ms INTEGER NOT NULL,
				heartbeat_at_ms INTEGER NOT NULL
			)
		`);
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS resource_leases (
				lease_id TEXT PRIMARY KEY,
				attempt_id TEXT NOT NULL UNIQUE,
				fence_token INTEGER NOT NULL UNIQUE,
				kind TEXT NOT NULL CHECK (kind IN ('spawn', 'revive')),
				session_id TEXT NOT NULL,
				session_owner_epoch TEXT,
				parent_agent_id TEXT NOT NULL,
				agent_id TEXT NOT NULL,
				job_id TEXT NOT NULL,
				holder_boot_id TEXT NOT NULL,
				holder_pid INTEGER NOT NULL,
				holder_start_fingerprint TEXT NOT NULL,
				child_boot_id TEXT,
				child_pid INTEGER,
				child_start_fingerprint TEXT,
				child_pgid INTEGER,
				state TEXT NOT NULL CHECK (state IN ('active', 'reaping')),
				reservation_bytes INTEGER NOT NULL,
				acquired_at_ms INTEGER NOT NULL,
				heartbeat_at_ms INTEGER NOT NULL,
				expires_at_ms INTEGER NOT NULL,
				terminal_receipt_digest TEXT
			)
		`);
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS resource_session_fairness (
				session_id TEXT PRIMARY KEY,
				last_grant_sequence INTEGER NOT NULL
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

	#enqueue(request: HostResourceAdmissionRequest): HostResourceLease | undefined {
		return this.#immediate(() => {
			const existingLease = this.#db
				.query<LeaseRow, { $attemptId: string }>(
					`SELECT lease_id, attempt_id, fence_token, kind, session_id, session_owner_epoch,
					 parent_agent_id, agent_id, job_id, holder_boot_id, holder_pid, holder_start_fingerprint,
					 reservation_bytes, acquired_at_ms, heartbeat_at_ms, expires_at_ms
					 FROM resource_leases WHERE attempt_id=$attemptId`,
				)
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
				return undefined;
			}
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
			return undefined;
		});
	}

	#tryGrant(attemptId: string): HostResourceLease | undefined {
		return this.#immediate(() => {
			const existing = this.#db
				.query<LeaseRow, { $attemptId: string }>(
					`SELECT lease_id, attempt_id, fence_token, kind, session_id, session_owner_epoch,
					 parent_agent_id, agent_id, job_id, holder_boot_id, holder_pid, holder_start_fingerprint,
					 reservation_bytes, acquired_at_ms, heartbeat_at_ms, expires_at_ms
					 FROM resource_leases WHERE attempt_id=$attemptId`,
				)
				.get({ $attemptId: attemptId });
			if (existing) return this.#leaseFromRow(existing);

			const waiters = this.#db.query<WaiterRow, []>("SELECT * FROM resource_waiters ORDER BY ticket").all();
			if (waiters.length === 0) return undefined;
			const leaseKinds = this.#db.query<{ kind: string }, []>("SELECT kind FROM resource_leases").all();
			if (leaseKinds.length >= this.#configuredWidth) return undefined;
			const spawnCount = leaseKinds.reduce((count, row) => count + (attemptKind(row.kind) === "spawn" ? 1 : 0), 0);
			const reviveReserve = this.#configuredWidth >= 2 ? 1 : 0;
			const spawnCapacity = this.#configuredWidth - reviveReserve;
			const sessionHeads = new Map<string, WaiterRow>();
			for (const waiter of waiters) {
				if (!sessionHeads.has(waiter.session_id)) sessionHeads.set(waiter.session_id, waiter);
			}
			const fairness = new Map(
				this.#db
					.query<FairnessRow, []>("SELECT session_id, last_grant_sequence FROM resource_session_fairness")
					.all()
					.map(row => [row.session_id, row.last_grant_sequence] as const),
			);
			const eligible = [...sessionHeads.values()]
				.filter(waiter => attemptKind(waiter.kind) === "revive" || spawnCount < spawnCapacity)
				.sort((left, right) => {
					const sequenceDelta = (fairness.get(left.session_id) ?? 0) - (fairness.get(right.session_id) ?? 0);
					return sequenceDelta || left.ticket - right.ticket;
				});
			const selected = eligible[0];
			if (!selected || selected.attempt_id !== attemptId) return undefined;

			const state = this.#poolState();
			const leaseId = randomUUID();
			const now = Date.now();
			this.#db
				.query(
					`INSERT INTO resource_leases (
					 lease_id, attempt_id, fence_token, kind, session_id, session_owner_epoch, parent_agent_id,
					 agent_id, job_id, holder_boot_id, holder_pid, holder_start_fingerprint, state,
					 reservation_bytes, acquired_at_ms, heartbeat_at_ms, expires_at_ms
					 ) VALUES (
					 $leaseId, $attemptId, $fenceToken, $kind, $sessionId, $sessionOwnerEpoch, $parentAgentId,
					 $agentId, $jobId, $holderBootId, $holderPid, $holderStartFingerprint, 'active',
					 $reservationBytes, $now, $now, $expiresAt
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
					`INSERT INTO resource_session_fairness (session_id, last_grant_sequence)
					 VALUES ($sessionId, $sequence)
					 ON CONFLICT(session_id) DO UPDATE SET last_grant_sequence=excluded.last_grant_sequence`,
				)
				.run({ $sessionId: selected.session_id, $sequence: nextSequence });
			this.#db
				.query(
					`UPDATE resource_pool_state
					 SET next_fence_token=next_fence_token+1, grant_sequence=$sequence
					 WHERE id=1`,
				)
				.run({ $sequence: nextSequence });
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
				`SELECT lease_id, attempt_id, fence_token, kind, session_id, session_owner_epoch,
				 parent_agent_id, agent_id, job_id, holder_boot_id, holder_pid, holder_start_fingerprint,
				 reservation_bytes, acquired_at_ms, heartbeat_at_ms, expires_at_ms
				 FROM resource_leases WHERE expires_at_ms <= $now ORDER BY expires_at_ms LIMIT 32`,
			)
			.all({ $now: now });
		const deadWaiters = expiredWaiters.filter(row => holderIsProvenDead(holderFromRow(row)));
		const deadLeases = expiredLeases.filter(row => holderIsProvenDead(holderFromRow(row)));
		if (deadWaiters.length === 0 && deadLeases.length === 0) return;
		this.#immediate(() => {
			for (const waiter of deadWaiters) {
				this.#db
					.query(
						`DELETE FROM resource_waiters
						 WHERE attempt_id=$attemptId AND holder_boot_id=$bootId AND holder_pid=$pid
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
						`DELETE FROM resource_leases
						 WHERE lease_id=$leaseId AND fence_token=$fenceToken AND holder_boot_id=$bootId
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
		});
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

	#snapshot(reconcileAlreadyDone: boolean): HostResourcePoolSnapshot {
		if (!reconcileAlreadyDone) this.#assertOpen();
		const waiters = this.#db.query<WaiterRow, []>("SELECT * FROM resource_waiters ORDER BY ticket").all();
		const leases = this.#db
			.query<LeaseRow, []>(
				`SELECT lease_id, attempt_id, fence_token, kind, session_id, session_owner_epoch,
				 parent_agent_id, agent_id, job_id, holder_boot_id, holder_pid, holder_start_fingerprint,
				 reservation_bytes, acquired_at_ms, heartbeat_at_ms, expires_at_ms
				 FROM resource_leases ORDER BY acquired_at_ms, fence_token`,
			)
			.all();
		return {
			configuredWidth: this.#configuredWidth,
			reviveReserve: this.#configuredWidth >= 2 ? 1 : 0,
			waiters: waiters.map(row => ({
				attemptId: row.attempt_id,
				ticket: row.ticket,
				kind: attemptKind(row.kind),
				sessionId: row.session_id,
				agentId: row.agent_id,
				holderProcess: holderFromRow(row),
			})),
			leases: leases.map(row => ({
				leaseId: row.lease_id,
				attemptId: row.attempt_id,
				fenceToken: row.fence_token,
				kind: attemptKind(row.kind),
				sessionId: row.session_id,
				agentId: row.agent_id,
				holderProcess: holderFromRow(row),
				acquiredAtMs: row.acquired_at_ms,
				heartbeatAtMs: row.heartbeat_at_ms,
				expiresAtMs: row.expires_at_ms,
			})),
		};
	}

	#poolState(): PoolStateRow {
		const row = this.#db
			.query<PoolStateRow, []>(
				"SELECT schema_version, next_ticket, next_fence_token, grant_sequence FROM resource_pool_state WHERE id=1",
			)
			.get();
		if (
			row?.schema_version !== 1 ||
			!Number.isSafeInteger(row.next_ticket) ||
			row.next_ticket < 1 ||
			!Number.isSafeInteger(row.next_fence_token) ||
			row.next_fence_token < 1 ||
			!Number.isSafeInteger(row.grant_sequence) ||
			row.grant_sequence < 0
		) {
			throw new HostAdmissionCorruptError("Host resource pool state is malformed");
		}
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

	#cancelled(signal: AbortSignal): HostAdmissionRejectedError {
		return new HostAdmissionRejectedError("cancelled", "Host resource admission was cancelled", {
			cause: signal.reason,
		});
	}

	#authorityError(error: unknown): HostAdmissionRejectedError | HostAdmissionCorruptError {
		if (error instanceof HostAdmissionRejectedError || error instanceof HostAdmissionCorruptError) return error;
		const message = error instanceof Error ? error.message : String(error);
		if (/malformed|corrupt|database disk image/i.test(message)) {
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
