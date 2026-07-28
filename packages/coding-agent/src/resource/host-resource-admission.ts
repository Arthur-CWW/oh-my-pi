import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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
/**
 * How long a contended statement waits for the authority's write lock before failing closed.
 * Also bounds the WAL-mode handshake, which SQLite excludes from the busy handler.
 */
const AUTHORITY_BUSY_TIMEOUT_MS = 3_000;
/**
 * Failures that mean another writer holds the lock right now. They are the one
 * outcome a handback must never treat as final and never wait out on the event
 * loop: the row is still this process's to give back, and the lock clears on
 * its own, so the caller's retry schedule is what waits.
 */
const WRITE_LOCK_CONTENTION_PATTERN = /database is locked|database table is locked|SQLITE_BUSY/i;
/**
 * Storage failures that never heal on their own. Corruption and I/O damage
 * outlive the statement that hit them, so teardown reports them instead of
 * trusting a row to "age out" through heartbeats that will never run cleanly.
 * Contention and an already-gone connection are deliberately absent: both are
 * ordinary, recoverable teardown outcomes.
 */
const UNRECOVERABLE_STORAGE_PATTERN =
	/malformed|corrupt|database disk image|schema|disk i\/o error|SQLITE_IOERR|SQLITE_NOTADB|SQLITE_CORRUPT|file is not a database/i;

function isWriteLockContention(error: unknown): boolean {
	if (error instanceof HostAdmissionCorruptError || error instanceof HostAdmissionFencedError) return false;
	return WRITE_LOCK_CONTENTION_PATTERN.test(error instanceof Error ? error.message : String(error));
}

export function resolveHostResourceDbPath(explicit?: string): string {
	return (
		explicit ??
		process.env.OMP_RESOURCE_AUTHORITY_DB ??
		path.join(os.homedir(), ".omp", "agent", "resource-authority.sqlite")
	);
}

export type ResourceAttemptKind = "spawn" | "revive";
export type AdmissionDeferredReason = "memory-budget" | "concurrency-cap" | "stale-owner-reaping";
export type AdmissionRejectedReason = "authority-unavailable" | "cancelled" | "pressure-hard";
export type HostResourcePressureState = "normal" | "gc" | "hard";

/**
 * Authority lifecycle. `closing` is the window in which new admission work is
 * already refused but the SQLite handle is still usable, so a close can drain
 * the durable state this process owns before the connection disappears.
 */
type AuthorityLifecycle = "open" | "closing" | "closed";

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
	readonly coordinatorRoots?: () => readonly ProcessIdentity[];
	readonly leaseTtlMs?: number;
	readonly waiterHeartbeatMs?: number;
	readonly waiterStaleMs?: number;
	readonly queuePollMs?: number;
	readonly sampleIntervalMs?: number;
	readonly observationMaxAgeMs?: number;
	/**
	 * How long a contended statement waits for the write lock. Zero fails fast,
	 * for a caller that already owns a retry schedule and must not spend the
	 * budget on the thread every timer in the process runs on.
	 */
	readonly busyTimeoutMs?: number;
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
	readonly processCount: number;
	readonly coordinatorRootCount: number;
	readonly sampleFresh: boolean;
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
	sample_json: string | null;
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

interface CoordinatorSample {
	readonly schemaVersion: 1;
	readonly observedBytes: number;
	readonly processCount: number;
	readonly rootCount: number;
}

function decodeCoordinatorSample(value: string | null): CoordinatorSample | undefined {
	if (!value) return undefined;
	try {
		const parsed = JSON.parse(value) as Record<string, unknown>;
		if (
			parsed.schemaVersion !== 1 ||
			!Number.isSafeInteger(parsed.observedBytes) ||
			(parsed.observedBytes as number) < 0 ||
			!Number.isSafeInteger(parsed.processCount) ||
			(parsed.processCount as number) < 0 ||
			!Number.isSafeInteger(parsed.rootCount) ||
			(parsed.rootCount as number) < 0
		) {
			return undefined;
		}
		return {
			schemaVersion: 1,
			observedBytes: parsed.observedBytes as number,
			processCount: parsed.processCount as number,
			rootCount: parsed.rootCount as number,
		};
	} catch {
		return undefined;
	}
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

/**
 * Where a lease handle stands with the durable row it was granted. The two
 * terminal states say different things: `released` means this handle removed
 * the row, `revoked` means it stopped speaking for it — the authority closed,
 * a newer fence owns it, or the storage under it is damaged. `releasing` is the
 * window a reentrant caller joins instead of opening a second transaction
 * against the same row, which SQLite would refuse.
 */
export type HostResourceLeaseState = "open" | "releasing" | "released" | "revoked";

/**
 * What one non-blocking handback attempt learned. `unbound` is the one that
 * matters: this handle can no longer speak for its row — its authority closed,
 * or a newer fence took it — so the row's fate is unknown from here and only
 * the durable authority can settle it.
 */
export type LeaseHandbackOutcome = "released" | "contended" | "unbound";

export class HostResourceLease {
	#state: HostResourceLeaseState = "open";

	constructor(
		private readonly admission: HostResourceAdmission,
		readonly leaseId: string,
		readonly attemptId: string,
		readonly fenceToken: number,
		readonly kind: ResourceAttemptKind,
	) {}

	get state(): HostResourceLeaseState {
		return this.#state;
	}

	/** Authority database the durable row behind this handle lives in. */
	get dbPath(): string {
		return this.admission.dbPath;
	}

	/** Fenced once this handle is no longer open, and once the authority that granted it stopped. */
	renew(): "renewed" | "fenced" {
		if (this.#state !== "open" || !this.admission.isOpen) return "fenced";
		return this.admission.renewLease(this.leaseId, this.fenceToken);
	}

	/**
	 * Hand the slot back. Idempotent, and safe to call from any number of
	 * cleanup paths: only an open handle runs a statement, and every other
	 * caller — including one that reenters while that statement is still in
	 * flight — shares its outcome instead of issuing a second one.
	 *
	 * Closing the authority revokes every lease it granted, so a release that
	 * arrives afterwards is a no-op instead of a statement against a handle that
	 * is already gone; the durable row then ages out through its TTL and
	 * holder-death proof exactly as it does when the whole process dies.
	 *
	 * A failure that leaves the authority open leaves the handle open too. Write
	 * contention and transient I/O faults are the failures that get here, the
	 * row is still this live process's to give back, and expiry reaping refuses
	 * to touch a lease whose holder is provably alive — so a handle that gave up
	 * here would strand the slot for the rest of the process. Fencing and
	 * corruption are the terminal failures: raised once, never retried.
	 */
	release(): "released" {
		if (this.#state !== "open") return "released";
		if (!this.admission.isOpen) {
			this.#state = "revoked";
			return "released";
		}
		this.#state = "releasing";
		try {
			this.admission.releaseLease(this.leaseId, this.fenceToken);
		} catch (error) {
			if (error instanceof HostAdmissionFencedError || error instanceof HostAdmissionCorruptError) {
				this.#state = "revoked";
				throw error;
			}
			// The authority went away underneath this release. The close that took
			// it revoked the lease, so the caller whose only job was handing the
			// slot back did nothing wrong and hears nothing.
			if (!this.admission.isOpen) {
				this.#state = "revoked";
				return "released";
			}
			this.#state = "open";
			throw error;
		}
		this.#state = "released";
		return "released";
	}

	/**
	 * Offer the slot back without waiting on the write lock, and say honestly
	 * what happened.
	 *
	 * {@link release} answers a caller whose only job is to try once: it absorbs
	 * a closed authority as success, because there is nothing that caller could
	 * do about it. That answer is wrong for a caller that owns the row until it
	 * is durably gone — the row outlives the authority that granted it, and a
	 * live holder is exactly what expiry reaping refuses to reclaim. So this
	 * reports `unbound` instead of claiming a release that never ran, and
	 * `contended` instead of spending the busy budget on the event loop.
	 */
	tryRelease(): LeaseHandbackOutcome {
		if (this.#state === "released") return "released";
		if (this.#state !== "open" || !this.admission.isOpen) return "unbound";
		this.#state = "releasing";
		try {
			if (this.admission.tryReleaseLease(this.leaseId, this.fenceToken) === "contended") {
				this.#state = "open";
				return "contended";
			}
		} catch (error) {
			if (error instanceof HostAdmissionFencedError || error instanceof HostAdmissionCorruptError) {
				this.#state = "revoked";
				throw error;
			}
			// The authority went away underneath this attempt. Whether the row
			// went with it is not this handle's to claim.
			if (!this.admission.isOpen) {
				this.#state = "revoked";
				return "unbound";
			}
			this.#state = "open";
			throw error;
		}
		this.#state = "released";
		return "released";
	}
}

export class HostResourceAdmission {
	static #global: HostResourceAdmission | undefined;

	static global(options: HostResourceAdmissionOptions = {}): HostResourceAdmission {
		const existing = HostResourceAdmission.#global;
		// A closed singleton is never handed back out: its connection is gone, so
		// every later caller would fail closed for the rest of the process.
		if (existing === undefined || existing.#lifecycle !== "open") {
			HostResourceAdmission.#global = new HostResourceAdmission(options);
			return HostResourceAdmission.#global;
		}
		if (
			options.dbPath !== undefined &&
			path.resolve(resolveHostResourceDbPath(options.dbPath)) !== path.resolve(existing.dbPath)
		) {
			throw new HostAdmissionRejectedError(
				"authority-unavailable",
				"Host resource authority is already bound to a different SQLite database",
			);
		}
		existing.#refreshResourceProfile(options);
		if (options.onPressure) existing.#onPressure = options.onPressure;
		if (options.coordinatorRoots) existing.#coordinatorRoots = options.coordinatorRoots;
		return existing;
	}

	/**
	 * Whether a usable host authority already exists. Callers that would otherwise
	 * construct one from incomplete configuration use this to reuse the
	 * configured authority instead of silently installing default budgets. A
	 * closed authority does not count: nothing can be admitted through it.
	 */
	static hasGlobal(): boolean {
		const existing = HostResourceAdmission.#global;
		return existing !== undefined && existing.#lifecycle === "open";
	}

	/**
	 * The live process authority already bound to this database, if there is
	 * one. A caller holding a durable row whose granting authority has closed
	 * uses this to finish through the open connection instead of opening a
	 * second one against the same file — and gets `undefined`, not a wrongly
	 * budgeted default singleton, when nothing here speaks for that database.
	 */
	static openFor(dbPath: string): HostResourceAdmission | undefined {
		const existing = HostResourceAdmission.#global;
		if (existing === undefined || existing.#lifecycle !== "open") return undefined;
		return path.resolve(existing.dbPath) === path.resolve(dbPath) ? existing : undefined;
	}

	/** Drop and quiesce the process authority. Idempotent and safe to repeat. */
	static resetGlobalForTests(): void {
		const current = HostResourceAdmission.#global;
		// Cleared before the close: anything racing this reset resolves a fresh
		// authority rather than the one whose connection is about to disappear.
		HostResourceAdmission.#global = undefined;
		current?.close();
	}

	readonly dbPath: string;
	readonly #db: Database;
	readonly #leaseTtlMs: number;
	readonly #waiterHeartbeatMs: number;
	readonly #waiterStaleMs: number;
	readonly #queuePollMs: number;
	readonly #observationMaxAgeMs: number;
	readonly #busyTimeoutMs: number;
	readonly #samplerTimer: NodeJS.Timeout;
	#resourceProfile: HostResourceProfile;
	#userCap: number | undefined;
	#memoryBudgetCap: number | undefined;
	#childReservationBytes: number | undefined;
	#hostResourceProbe: HostResourceProbe | undefined;
	#coordinatorRoots: () => readonly ProcessIdentity[];
	#onPressure: ((doorbell: HostMemoryPressureDoorbell) => void | Promise<void>) | undefined;
	#lastHandledPressureEpoch = 0;
	#sampleInFlight: Promise<void> | undefined;
	#lifecycle: AuthorityLifecycle = "open";
	/** Wakes deferred acquire back-offs so a close never waits out a poll interval. */
	readonly #sleepWakeups = new Set<() => void>();
	/** Attempt ids this process currently has queued, withdrawn durably on close. */
	readonly #pendingWaiters = new Set<string>();

	constructor(options: HostResourceAdmissionOptions = {}) {
		this.dbPath = resolveHostResourceDbPath(options.dbPath);
		this.#userCap = options.userCap;
		this.#memoryBudgetCap = options.memoryBudgetBytes;
		this.#childReservationBytes = options.childReservationBytes;
		this.#hostResourceProbe = options.hostResourceProbe;
		this.#coordinatorRoots =
			options.coordinatorRoots ??
			(() => {
				const identity = readProcessIdentity(process.pid);
				return identity ? [identity] : [];
			});
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
		this.#busyTimeoutMs =
			options.busyTimeoutMs !== undefined &&
			Number.isSafeInteger(options.busyTimeoutMs) &&
			options.busyTimeoutMs >= 0
				? options.busyTimeoutMs
				: AUTHORITY_BUSY_TIMEOUT_MS;
		this.#onPressure = options.onPressure;
		let opened: Database | undefined;
		try {
			fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
			opened = new Database(this.dbPath);
			this.#db = opened;
			// busy_timeout must be armed before any schema work: it is what turns write-lock
			// contention at `BEGIN IMMEDIATE` into a wait instead of an immediate SQLITE_BUSY when
			// several processes cold-open this authority at once.
			this.#db.run(`PRAGMA busy_timeout = ${this.#busyTimeoutMs}`);
			this.#enableWalMode();
			this.#db.run("PRAGMA synchronous = FULL");
			this.#db.run("PRAGMA foreign_keys = ON");
			this.#initializeSchema();
		} catch (error) {
			// A constructor that throws never yields the object that owns this
			// connection, so no `close` anywhere can reach it: the handle goes back
			// here or not at all. The caller that makes this matter is a contended
			// handback reopening the same database on a retry schedule — every
			// failed attempt would otherwise strand one native connection until the
			// process runs out of descriptors.
			try {
				opened?.close();
			} catch {
				// Nothing is recoverable from here and nothing else may escape: the
				// construction failure below is the one the caller has to see, and a
				// handle that refuses to close has no second disposal to try.
			}
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

	get childReservationBytes(): number {
		return this.#resourceProfile.childReservationBytes;
	}

	/**
	 * False from the moment this authority stops accepting work. Leases read it
	 * to stay no-ops once a close revoked them: the connection they would drive
	 * is gone, or is about to be.
	 */
	get isOpen(): boolean {
		return this.#lifecycle === "open";
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

	/**
	 * Stop this authority. Idempotent, and safe to call while an acquire is
	 * deferred, a sample is in flight, or another close already ran.
	 *
	 * Three phases, so nothing ever observes a half-torn-down authority: the
	 * state flips to `closing` and the sampler stops, the queued waiters this
	 * process owns are withdrawn while the connection is still usable, and only
	 * then do the sleepers wake into a `closed` authority and the handle go away.
	 *
	 * Teardown always finishes. A corrupt or unreadable database found while
	 * draining is reported after the connection is gone rather than instead of
	 * closing it: that damage is permanent and no heartbeat will clean it up.
	 */
	close(): void {
		if (this.#lifecycle !== "open") return;
		this.#lifecycle = "closing";
		clearInterval(this.#samplerTimer);
		const drainFailure = this.#withdrawPendingWaiters();
		// This flip is the revocation: every lease this authority granted reads
		// `isOpen` and becomes a no-op from here, before the handle disappears.
		this.#lifecycle = "closed";
		// Waking after the state flip is deliberate: every sleeper resumes into
		// the closed check and settles with a typed error instead of a raw SQLite
		// failure from a connection that no longer exists.
		for (const wake of this.#sleepWakeups) wake();
		this.#sleepWakeups.clear();
		this.#db.close();
		if (drainFailure) throw drainFailure;
	}

	/**
	 * Resolves once no sampling callback can still run against this authority.
	 * Closing is synchronous, but an in-flight process sample outlives it, so
	 * shutdown paths await this to prove the closed handle is never touched.
	 */
	async whenQuiesced(): Promise<void> {
		while (this.#sampleInFlight) await this.#sampleInFlight.catch(() => {});
	}

	/**
	 * Remove the waiter rows this process still owns. They are durable and
	 * cross-process, so leaving them behind makes every peer wait out
	 * `waiterStaleMs` before the queue head can move.
	 *
	 * Reports instead of throwing, because close still has teardown to finish
	 * and decides what escapes. Contention and a connection that is already gone
	 * are absorbed — those rows age out on their heartbeat — but a corrupt or
	 * unreadable database is handed back, because that never ages out.
	 */
	#withdrawPendingWaiters(): HostAdmissionCorruptError | undefined {
		if (this.#pendingWaiters.size === 0) return undefined;
		try {
			this.#transaction(() => {
				for (const attemptId of this.#pendingWaiters) {
					this.#db
						.query("DELETE FROM resource_waiters WHERE attempt_id=$attemptId")
						.run({ $attemptId: attemptId });
				}
			});
			return undefined;
		} catch (error) {
			const classified = this.#authorityError(error);
			return classified instanceof HostAdmissionCorruptError ? classified : undefined;
		} finally {
			this.#pendingWaiters.clear();
		}
	}

	async acquire(
		request: HostResourceAdmissionRequest,
		options: { signal?: AbortSignal; onDeferred?: (decision: AdmissionDeferred) => void } = {},
	): Promise<HostResourceLease> {
		validateRequest(request);
		this.#assertOpen();
		const signal = options.signal;
		if (signal?.aborted) throw this.#cancelled(signal);
		let deferredReceiptWritten = false;
		let queued = false;
		try {
			if (!this.#hasFreshSample()) await this.sampleNow();
			const existing = this.#enqueue(request);
			if (existing === "rejected-hard") throw this.#hardPressureError();
			if (existing) return existing;
			queued = true;
			this.#pendingWaiters.add(request.attemptId);
			let nextHeartbeatAt = Date.now() + this.#waiterHeartbeatMs;
			while (true) {
				// Re-checked every iteration: a close between two polls must end
				// this wait with a typed refusal, never a raw closed-database throw.
				this.#assertOpen();
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
				await this.#sleep(this.#queuePollMs + Math.floor(Math.random() * Math.min(50, this.#queuePollMs)), signal);
			}
		} catch (error) {
			if (signal?.aborted) {
				// Only the explicit already-closed case is skipped: a close already
				// withdrew this row while its connection was still usable. Every other
				// cleanup failure is real and outranks the cancellation that caused it.
				try {
					if (this.#lifecycle === "open") this.#deleteWaiter(request.attemptId);
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
		} finally {
			if (queued) this.#pendingWaiters.delete(request.attemptId);
		}
	}

	/**
	 * Back-off for a deferred waiter. Settles on the poll interval, on
	 * cancellation, or the moment this authority starts closing — a waiter must
	 * never sleep past the lifetime of the connection it is waiting on.
	 *
	 * Registration and the lifecycle re-check bracket each other on purpose. The
	 * deferred hook runs synchronously just before this call and is allowed to
	 * close the authority, which drains a wake-up set this sleeper has not joined
	 * yet; without the re-check the waiter would sleep out a whole poll interval
	 * past the close that exists to end it immediately.
	 */
	#sleep(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let timer: NodeJS.Timeout | undefined;
			const wake = (): void => {
				clearTimeout(timer);
				this.#sleepWakeups.delete(wake);
				signal?.removeEventListener("abort", onAbort);
				resolve();
			};
			const onAbort = (): void => {
				clearTimeout(timer);
				this.#sleepWakeups.delete(wake);
				reject(this.#cancelled(signal!));
			};
			this.#sleepWakeups.add(wake);
			if (this.#lifecycle !== "open") {
				wake();
				return;
			}
			// An abort raised by the deferred hook never redelivers to a listener
			// registered after the fact, so it is settled here instead.
			if (signal?.aborted) {
				onAbort();
				return;
			}
			timer = setTimeout(wake, delayMs);
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	inspect(): HostResourcePoolSnapshot {
		this.#assertOpen();
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
			const sample = await sampleLeaseProcessTrees(targets, { coordinatorRoots: this.#coordinatorRoots() });
			// This authority can close while the process sample is in flight.
			// Dropping the observation ages admission back to declared
			// reservations, which is the conservative outcome, and keeps every
			// post-await callback off a connection that no longer exists.
			if (this.#lifecycle !== "open") return;
			this.#immediate(() => {
				for (const [leaseId, observedBytes] of sample.observedBytesByLease) {
					this.#db
						.query(
							`UPDATE resource_leases SET observed_bytes=$observedBytes, observed_at_ms=$observedAtMs
							 WHERE lease_id=$leaseId AND state='active'`,
						)
						.run({ $observedBytes: observedBytes, $observedAtMs: sample.sampledAtMs, $leaseId: leaseId });
				}
				const coordinatorSample: CoordinatorSample = {
					schemaVersion: 1,
					observedBytes: sample.aggregateObservedBytes,
					processCount: sample.processCount,
					rootCount: sample.rootCount,
				};
				this.#db
					.query("UPDATE resource_pool_state SET sample_json=$sampleJson, sample_at_ms=$sampleAtMs WHERE id=1")
					.run({ $sampleJson: JSON.stringify(coordinatorSample), $sampleAtMs: sample.sampledAtMs });
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
		this.#releaseRow(leaseId, fenceToken, true);
	}

	/**
	 * Hand a durable row back without waiting out the write lock. The statement
	 * is the same one {@link releaseLease} runs — same fence check, same
	 * receipt, same pressure recompute — with the busy wait suppressed for its
	 * duration, so contention comes back as an answer instead of as seconds of
	 * a blocked event loop. Fencing and corruption still raise: those never
	 * clear on their own and no retry schedule should pretend otherwise.
	 */
	tryReleaseLease(leaseId: string, fenceToken: number): "released" | "contended" {
		this.#assertOpen();
		return this.#failFastOnContention(() => this.#releaseRow(leaseId, fenceToken, true));
	}

	/**
	 * Hand back a row this authority never granted and cannot price.
	 *
	 * A handback authority is opened over a database whose configuration it has
	 * never seen: no memory budget, no user cap and no child reservation reach
	 * it, so its profile is whatever this host implies by default. Repricing the
	 * pool from that profile would replace a deliberately narrow pool's pressure
	 * decision with the default's — normal, almost always — and silence the
	 * signal for every other reader until the authority that owns the budgets
	 * refreshes it.
	 *
	 * So this path writes only what it can know: the fence check, the row, and
	 * the receipt saying the row is gone. Pressure stays exactly where the
	 * budget owner left it, which is stale in the safe direction — a release
	 * only ever lowers what is charged — and is corrected by that owner's next
	 * admission, sample or inspection.
	 */
	tryReleaseForeignLease(leaseId: string, fenceToken: number): "released" | "contended" {
		this.#assertOpen();
		return this.#failFastOnContention(() => this.#releaseRow(leaseId, fenceToken, false));
	}

	/**
	 * Delete one durable row under the write lock and record the receipt that
	 * says it is gone. `reprice` separates an authority that knows this pool's
	 * budgets from one that only knows the row: only the former may recompute
	 * the shared pressure decision the deletion moved.
	 */
	#releaseRow(leaseId: string, fenceToken: number, reprice: boolean): void {
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
					if (reprice) this.#refreshPressureLocked(Date.now());
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

	/** Run one write with the busy wait suppressed, so a lost lock is an answer rather than a stall. */
	#failFastOnContention(write: () => void): "released" | "contended" {
		// Safe to toggle on the shared connection: nothing between here and the
		// restore below yields, so no other statement can observe the gap.
		this.#db.run("PRAGMA busy_timeout = 0");
		try {
			write();
			return "released";
		} catch (error) {
			if (isWriteLockContention(error)) return "contended";
			throw error;
		} finally {
			this.#db.run(`PRAGMA busy_timeout = ${this.#busyTimeoutMs}`);
		}
	}

	/**
	 * Switching a cold authority from rollback journalling to WAL needs a brief exclusive lock so the
	 * database header can be rewritten, and SQLite does not run the busy handler for that acquisition:
	 * when several processes cold-open the same file at once, every loser fails outright with
	 * SQLITE_BUSY instead of waiting. Measured on a real 8-process cold-open barrier, 35 of 96 opens
	 * died here, all of them on this one statement.
	 *
	 * The journal mode is a durable property of the file rather than of this connection, so a loser
	 * only has to observe the winner's transition: once any process has flipped the header, this pragma
	 * is a lock-free no-op that reports `wal`. Retry until it does, bounded by the same budget
	 * `busy_timeout` gives every other contended statement, then fail closed.
	 */
	#enableWalMode(): void {
		const deadline = Date.now() + this.#busyTimeoutMs;
		for (;;) {
			let mode: string | undefined;
			try {
				mode = this.#db.query<{ journal_mode: string }, []>("PRAGMA journal_mode = WAL").get()?.journal_mode;
			} catch (error) {
				if (Date.now() >= deadline) throw error;
			}
			if (mode === "wal") return;
			if (Date.now() >= deadline) {
				throw new Error(
					`Host resource authority stayed in ${mode ?? "an unreadable"} journal mode under contention`,
				);
			}
			// Blocking is correct here: the constructor is synchronous, the winner needs microseconds,
			// and admitting work against a non-WAL authority would break every other reader.
			Bun.sleepSync(1);
		}
	}

	/**
	 * Cross-process safe initialization. This authority file is opened concurrently by independent OS
	 * processes, so the entire check-and-create runs inside one `BEGIN IMMEDIATE` transaction: the write
	 * lock is taken up front, exactly one initializer is ever inside this body, and every loser blocks on
	 * `busy_timeout` until the winner commits, then observes the finished schema and creates nothing.
	 *
	 * A deferred transaction would not do. A reader that later upgrades to a writer gets
	 * SQLITE_BUSY_SNAPSHOT, for which SQLite deliberately never invokes the busy handler, so the loser
	 * would fail instead of waiting.
	 *
	 * The singleton `resource_pool_state` seed row is written last, after every table and index exists,
	 * so the schema version stamp is never visible without the schema it describes.
	 */
	#initializeSchema(): void {
		this.#immediate(() => {
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
			// Fail closed before touching anything else: an unsupported stamp is never migrated.
			if (existingVersion && existingVersion.schema_version !== RESOURCE_SCHEMA_VERSION) {
				throw new HostAdmissionCorruptError(
					`Host resource schema ${existingVersion.schema_version} is not supported; expected ${RESOURCE_SCHEMA_VERSION}`,
				);
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
			if (!existingVersion) {
				this.#db.run(`
					INSERT INTO resource_pool_state
						(id, schema_version, next_ticket, next_fence_token, grant_sequence, pressure_state, pressure_epoch, receipts_json)
					VALUES (1, ${RESOURCE_SCHEMA_VERSION}, 1, 1, 0, 'normal', 0, '[]')
				`);
			}
		});
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
		this.#assertOpen();
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

	#hasFreshSample(now = Date.now()): boolean {
		const state = this.#poolState();
		return (
			state.sample_at_ms !== null &&
			decodeCoordinatorSample(state.sample_json) !== undefined &&
			now - state.sample_at_ms <= this.#observationMaxAgeMs
		);
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
		let leaseObservedBytes = 0;
		for (const row of rows) {
			reservedBytes += row.reservation_bytes;
			const fresh = now - row.observed_at_ms <= this.#observationMaxAgeMs;
			leaseObservedBytes += fresh ? row.observed_bytes : row.reservation_bytes;
		}
		const state = this.#poolState();
		const coordinatorSample = decodeCoordinatorSample(state.sample_json);
		const sampleFresh =
			coordinatorSample !== undefined &&
			state.sample_at_ms !== null &&
			now - state.sample_at_ms <= this.#observationMaxAgeMs;
		const observedBytes = Math.max(sampleFresh ? coordinatorSample.observedBytes : 0, leaseObservedBytes);
		return { reservedBytes, observedBytes, chargedBytes: Math.max(reservedBytes, observedBytes) };
	}

	#deliverPressureDoorbell(provided?: HostResourcePoolSnapshot): void {
		// Snapshotted lazily: with no doorbell registered, or once this authority
		// is closing, there is nothing to notify and nothing worth reading.
		if (!this.#onPressure || this.#lifecycle !== "open") return;
		const snapshot = provided ?? this.#snapshot();
		if (snapshot.pressureEpoch <= this.#lastHandledPressureEpoch) return;
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
			processCount: decodeCoordinatorSample(state.sample_json)?.processCount ?? 0,
			coordinatorRootCount: decodeCoordinatorSample(state.sample_json)?.rootCount ?? 0,
			sampleFresh:
				state.sample_at_ms !== null &&
				decodeCoordinatorSample(state.sample_json) !== undefined &&
				now - state.sample_at_ms <= this.#observationMaxAgeMs,
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
		this.#assertOpen();
		return this.#db.query<LeaseRow, []>("SELECT * FROM resource_leases ORDER BY acquired_at_ms, fence_token").all();
	}

	#poolState(): PoolStateRow {
		this.#assertOpen();
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
			(row.sample_json !== null && decodeCoordinatorSample(row.sample_json) === undefined) ||
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
		return this.#transaction(operation);
	}

	/**
	 * Transaction without the lifecycle gate. Only `close` may use it, to drain
	 * the durable state this process owns after new work is already refused.
	 */
	#transaction<T>(operation: () => T): T {
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
		if (this.#lifecycle !== "open")
			throw new HostAdmissionRejectedError("authority-unavailable", `Host resource authority is ${this.#lifecycle}`);
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
		if (UNRECOVERABLE_STORAGE_PATTERN.test(message)) {
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
