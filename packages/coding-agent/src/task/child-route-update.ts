import * as fs from "node:fs/promises";
import { decodeJournalEntries, readJournalTailChunkAsync } from "../journal/projection";
import type { CustomEntry, FileEntry } from "../session/session-entries";
import { loadEntriesFromFile } from "../session/session-loader";
import type { SessionManager } from "../session/session-manager";

export const CHILD_ROUTE_UPDATE_CUSTOM_TYPE = "child_route_update";

export const CHILD_ROUTE_UPDATE_VERSION = 2;

/**
 * Versions this decoder accepts. Writers always emit the current version; the
 * reader still understands v1 because an append-only journal outlives the code
 * that wrote it, and rejecting a v1 record would poison the whole projection
 * (`corrupt`) and wedge every future route update for that child.
 */
const CHILD_ROUTE_UPDATE_READABLE_VERSIONS: ReadonlySet<number> = new Set([1, CHILD_ROUTE_UPDATE_VERSION]);

/** Bounded tail budget for projecting one child's route-update state without loading its history. */
export const CHILD_ROUTE_UPDATE_TAIL_BYTES = 64 * 1024;

/**
 * Hard ceiling for the reverse scan that looks past the tail for an older
 * record. Beyond this the read reports `overflow` instead of "nothing pending".
 */
export const CHILD_ROUTE_UPDATE_MAX_SCAN_BYTES = 4 * 1024 * 1024;

/** Operator-facing failure text is journalled, so it is truncated at the boundary. */
export const CHILD_ROUTE_UPDATE_MAX_DETAIL = 512;

/**
 * Owner epoch recorded for a child session that holds no lease of its own.
 *
 * In-process children live under their parent's lease, so their route updates
 * are fenced by the parent's epoch. The sentinel keeps the record decodable when
 * a session has no ownership handle at all (fresh `SessionManager`, tests).
 */
export const UNOWNED_OWNER_EPOCH = "unowned";

/**
 * Lifecycle of one route update.
 *
 * `pending` — admitted, nothing mutated yet.
 * `applying` — durable intent recorded; the session mutation may or may not have
 *   landed. A crash here is reconciled against the child's durable route.
 * `uncertain` — the mutation was observed to have started and could not be
 *   proven complete or safely rolled back. Reconciled exactly like `applying`.
 * `applied` / `not_applied` — terminal receipts.
 */
export type ChildRouteUpdateState = "pending" | "applying" | "uncertain" | "applied" | "not_applied";

export type ChildRouteUpdateNotAppliedReason =
	| "terminal_before_boundary"
	| "owner_epoch_changed"
	| "superseded"
	| "apply_failed";

/**
 * One durable, versioned child route-update request and its receipt.
 *
 * Records are append-only: a request lands as `pending`, takes a durable
 * `applying` intent before any session mutation, and is superseded by an
 * `applied`, `not_applied`, or `uncertain` record carrying the same
 * {@link requestId}. The owner epoch captured at request time fences the apply
 * against a session that has since been taken over by a different owner.
 */
export interface ChildRouteUpdateRecord {
	version: 2;
	requestId: string;
	agentId: string;
	/** Explicit selector exactly as requested, including any `:effort` suffix. */
	selector: string;
	/** Explicit effort, or `null` when the request did not name one. */
	effort: string | null;
	requestedBy: string;
	/** Owner epoch of the child session lease observed when the request was admitted. */
	ownerEpoch: string;
	requestedAt: string;
	state: ChildRouteUpdateState;
	updatedAt: string;
	reason?: string;
	/** 1-based count of durable apply intents recorded for this request. */
	attempt?: number;
	/** When the current apply intent became durable. Present from `applying` onward. */
	applyingAt?: string;
	/** Owner epoch of the process that recorded the current apply intent. */
	applyingOwnerEpoch?: string;
	appliedAt?: string;
	/** Resolved `provider/model` actually applied at the boundary. */
	appliedSelector?: string;
	appliedEffort?: string | null;
	/** Owner epoch of the process that actually performed the apply. */
	appliedOwnerEpoch?: string;
	terminalAt?: string;
	notAppliedReason?: ChildRouteUpdateNotAppliedReason;
	/** Bounded operator-facing detail for a failed or in-doubt apply. */
	failureDetail?: string;
}

export type ChildRouteUpdateDecode =
	| { kind: "not_route_update" }
	| { kind: "invalid" }
	| { kind: "valid"; record: ChildRouteUpdateRecord };

type RouteUpdateSessionManager = Pick<
	SessionManager,
	"appendCustomEntry" | "getEntries" | "ensureOnDisk" | "flush" | "getSessionFile"
>;

const CHILD_ROUTE_UPDATE_STATES: Record<ChildRouteUpdateState, true> = {
	pending: true,
	applying: true,
	uncertain: true,
	applied: true,
	not_applied: true,
};

/** States that still owe the child an outcome; exactly one may be open per journal. */
const CHILD_ROUTE_UPDATE_OPEN_STATES: Record<ChildRouteUpdateState, boolean> = {
	pending: true,
	applying: true,
	uncertain: true,
	applied: false,
	not_applied: false,
};

/** Open states whose session mutation may already have landed. */
const CHILD_ROUTE_UPDATE_IN_DOUBT_STATES: Record<ChildRouteUpdateState, boolean> = {
	pending: false,
	applying: true,
	uncertain: true,
	applied: false,
	not_applied: false,
};

const CHILD_ROUTE_UPDATE_NOT_APPLIED_REASONS: Record<ChildRouteUpdateNotAppliedReason, true> = {
	terminal_before_boundary: true,
	owner_epoch_changed: true,
	superseded: true,
	apply_failed: true,
};

/** True while the request still owes the child an outcome. */
export function isChildRouteUpdateOpen(state: ChildRouteUpdateState): boolean {
	return CHILD_ROUTE_UPDATE_OPEN_STATES[state];
}

/** True when the mutation may already have landed and must be reconciled, not replayed blindly. */
export function isChildRouteUpdateInDoubt(state: ChildRouteUpdateState): boolean {
	return CHILD_ROUTE_UPDATE_IN_DOUBT_STATES[state];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function optionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string";
}

function optionalNullableString(value: unknown): value is string | null | undefined {
	return value === undefined || value === null || typeof value === "string";
}

function optionalPositiveInteger(value: unknown): value is number | undefined {
	return value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
}

/** Keep journalled failure text bounded and single-line so status surfaces stay readable. */
export function boundedFailureDetail(detail: string): string {
	const flattened = detail.replace(/\s+/g, " ").trim();
	return flattened.length > CHILD_ROUTE_UPDATE_MAX_DETAIL
		? `${flattened.slice(0, CHILD_ROUTE_UPDATE_MAX_DETAIL - 1)}…`
		: flattened;
}

/**
 * Decode an untrusted durable route-update entry at the journal boundary.
 *
 * Fail-closed: anything that is not an exactly-shaped readable record decodes as
 * `invalid` so a corrupt or forward-versioned journal can never be mistaken for
 * an absent request.
 */
export function decodeChildRouteUpdateEntry(entry: FileEntry): ChildRouteUpdateDecode {
	if (entry.type !== "custom" || entry.customType !== CHILD_ROUTE_UPDATE_CUSTOM_TYPE) {
		return { kind: "not_route_update" };
	}
	const data = (entry as CustomEntry).data;
	if (!isRecord(data)) return { kind: "invalid" };
	const {
		version,
		requestId,
		agentId,
		selector,
		effort,
		requestedBy,
		ownerEpoch,
		requestedAt,
		state,
		updatedAt,
		reason,
		attempt,
		applyingAt,
		applyingOwnerEpoch,
		appliedAt,
		appliedSelector,
		appliedEffort,
		appliedOwnerEpoch,
		terminalAt,
		notAppliedReason,
		failureDetail,
	} = data;
	if (typeof version !== "number" || !CHILD_ROUTE_UPDATE_READABLE_VERSIONS.has(version)) return { kind: "invalid" };
	if (!nonEmptyString(requestId) || !nonEmptyString(agentId) || !nonEmptyString(selector)) return { kind: "invalid" };
	if (effort !== null && !nonEmptyString(effort)) return { kind: "invalid" };
	if (!nonEmptyString(requestedBy) || !nonEmptyString(ownerEpoch) || !nonEmptyString(requestedAt)) {
		return { kind: "invalid" };
	}
	if (!nonEmptyString(state) || !(state in CHILD_ROUTE_UPDATE_STATES)) return { kind: "invalid" };
	if (!nonEmptyString(updatedAt)) return { kind: "invalid" };
	if (!optionalString(reason) || !optionalString(appliedAt) || !optionalString(appliedSelector)) {
		return { kind: "invalid" };
	}
	if (!optionalNullableString(appliedEffort) || !optionalString(terminalAt)) return { kind: "invalid" };
	if (!optionalString(appliedOwnerEpoch) || !optionalString(applyingAt) || !optionalString(applyingOwnerEpoch)) {
		return { kind: "invalid" };
	}
	if (!optionalString(failureDetail) || !optionalPositiveInteger(attempt)) return { kind: "invalid" };
	if (notAppliedReason !== undefined) {
		if (!nonEmptyString(notAppliedReason) || !(notAppliedReason in CHILD_ROUTE_UPDATE_NOT_APPLIED_REASONS)) {
			return { kind: "invalid" };
		}
	}
	const decodedState = state as ChildRouteUpdateState;
	if (decodedState === "applied" && !nonEmptyString(appliedAt)) return { kind: "invalid" };
	if (decodedState === "not_applied" && notAppliedReason === undefined) return { kind: "invalid" };
	// An in-doubt record without its intent timestamp cannot be reconciled, so it
	// is not a record this state machine ever wrote.
	if (isChildRouteUpdateInDoubt(decodedState) && !nonEmptyString(applyingAt)) return { kind: "invalid" };
	return {
		kind: "valid",
		record: {
			version: CHILD_ROUTE_UPDATE_VERSION,
			requestId,
			agentId,
			selector,
			effort: effort === null ? null : effort,
			requestedBy,
			ownerEpoch,
			requestedAt,
			state: decodedState,
			updatedAt,
			...(reason === undefined ? {} : { reason }),
			...(attempt === undefined ? {} : { attempt }),
			...(applyingAt === undefined ? {} : { applyingAt }),
			...(applyingOwnerEpoch === undefined ? {} : { applyingOwnerEpoch }),
			...(appliedAt === undefined ? {} : { appliedAt }),
			...(appliedSelector === undefined ? {} : { appliedSelector }),
			...(appliedEffort === undefined ? {} : { appliedEffort }),
			...(appliedOwnerEpoch === undefined ? {} : { appliedOwnerEpoch }),
			...(terminalAt === undefined ? {} : { terminalAt }),
			...(notAppliedReason === undefined
				? {}
				: { notAppliedReason: notAppliedReason as ChildRouteUpdateNotAppliedReason }),
			...(failureDetail === undefined ? {} : { failureDetail }),
		},
	};
}

export function isChildRouteUpdateRecord(value: unknown): value is ChildRouteUpdateRecord {
	const decoded = decodeChildRouteUpdateEntry({
		type: "custom",
		customType: CHILD_ROUTE_UPDATE_CUSTOM_TYPE,
		data: value,
	} as FileEntry);
	return decoded.kind === "valid";
}

/** Latest durable state per request, plus the single request still awaiting an outcome. */
export interface ChildRouteUpdateProjection {
	/** Most recently appended valid record, whatever its state. */
	latest?: ChildRouteUpdateRecord;
	/** Most recently appended record that is still open (`pending`/`applying`/`uncertain`). */
	open?: ChildRouteUpdateRecord;
	/** Most recently appended record whose final state is `applied`. */
	applied?: ChildRouteUpdateRecord;
	byRequestId: ReadonlyMap<string, ChildRouteUpdateRecord>;
	/** A malformed record was seen; callers must treat the projection as untrustworthy. */
	corrupt: boolean;
	/**
	 * The bounded scan stopped before it could prove no record exists further
	 * back. `open` is then unknown, not absent — never read as "no swap".
	 */
	overflow: boolean;
}

const EMPTY_PROJECTION: ChildRouteUpdateProjection = {
	byRequestId: new Map(),
	corrupt: false,
	overflow: false,
};

/**
 * Fold append-ordered records into the current route-update state.
 *
 * Later appends win per request id. A corrupt record poisons the projection so
 * an apply never runs on a journal we cannot fully read.
 */
export function projectChildRouteUpdates(entries: readonly FileEntry[]): ChildRouteUpdateProjection {
	const byRequestId = new Map<string, ChildRouteUpdateRecord>();
	const order: string[] = [];
	let latest: ChildRouteUpdateRecord | undefined;
	let corrupt = false;
	for (const entry of entries) {
		const decoded = decodeChildRouteUpdateEntry(entry);
		if (decoded.kind === "invalid") {
			corrupt = true;
			continue;
		}
		if (decoded.kind !== "valid") continue;
		const record = decoded.record;
		if (!byRequestId.has(record.requestId)) order.push(record.requestId);
		byRequestId.set(record.requestId, record);
		latest = record;
	}
	let open: ChildRouteUpdateRecord | undefined;
	let applied: ChildRouteUpdateRecord | undefined;
	for (let index = order.length - 1; index >= 0; index--) {
		const record = byRequestId.get(order[index]);
		if (!record) continue;
		if (!open && isChildRouteUpdateOpen(record.state)) open = record;
		if (!applied && record.state === "applied") applied = record;
		if (open && applied) break;
	}
	return {
		byRequestId,
		corrupt,
		overflow: false,
		...(latest ? { latest } : {}),
		...(open ? { open } : {}),
		...(applied ? { applied } : {}),
	};
}

/** Project route-update state from a live session manager's in-memory entries. */
export function childRouteUpdateProjection(sessionManager: RouteUpdateSessionManager): ChildRouteUpdateProjection {
	return projectChildRouteUpdates(sessionManager.getEntries());
}

/**
 * Project route-update state from a child journal on disk with a bounded scan.
 *
 * The read starts at the tail and doubles its window backwards until it finds a
 * route-update record, reaches the start of the file, or exhausts `maxScanBytes`.
 * Finding one record is enough: `admitChildRouteUpdate` never admits a second
 * request while one is open and every transition re-appends the same request
 * id, so the newest record settles `open` for the whole journal.
 *
 * Exhausting the budget yields `overflow: true` rather than an empty projection,
 * so an open record buried behind a large turn is never reported as absent.
 */
export async function readChildRouteUpdateProjection(
	sessionFile: string,
	maxBytes = CHILD_ROUTE_UPDATE_TAIL_BYTES,
	maxScanBytes = CHILD_ROUTE_UPDATE_MAX_SCAN_BYTES,
): Promise<ChildRouteUpdateProjection> {
	let window = Math.max(1, maxBytes);
	const cap = Math.max(window, maxScanBytes);
	for (;;) {
		const chunk = await readJournalTailChunkAsync(sessionFile, 0, window);
		if (!chunk) return EMPTY_PROJECTION;
		const projection = projectChildRouteUpdates(decodeJournalEntries(chunk.text));
		if (projection.latest || projection.corrupt) return projection;
		// `fromByte === 0` only when the window covered the whole file.
		if (chunk.fromByte === 0) return projection;
		if (window >= cap) return { ...EMPTY_PROJECTION, overflow: true };
		window = Math.min(cap, window * 4);
	}
}

/**
 * Bounded read that escalates to the whole journal only when the reverse scan
 * overflows. Status surfaces use this so a buried open request is reported,
 * never dropped, while the common case still costs one tail read.
 */
export async function readAuthoritativeChildRouteUpdateProjection(
	sessionFile: string,
): Promise<ChildRouteUpdateProjection> {
	const bounded = await readChildRouteUpdateProjection(sessionFile);
	if (!bounded.overflow) return bounded;
	return projectChildRouteUpdates(await loadEntriesFromFile(sessionFile));
}

/** The child's own durable route, folded from the journal entries that define it. */
export interface DurableChildRoute {
	/** `provider/model` of the last durable model change, when the journal has one. */
	selector?: string;
	/** Last durable thinking level; `null` when explicitly cleared. */
	effort?: string | null;
}

/**
 * Fold the child's durable route out of its journal.
 *
 * This is the ground truth reconciliation compares against: `AgentSession`
 * writes `model_change` before anything else in an apply, so a journal that
 * already names the target proves the mutation landed even when the receipt
 * never made it to disk.
 */
export function projectDurableChildRoute(entries: readonly FileEntry[]): DurableChildRoute {
	let selector: string | undefined;
	let effort: string | null | undefined;
	for (const entry of entries) {
		if (entry.type === "model_change") {
			const model = (entry as { model?: unknown }).model;
			if (nonEmptyString(model)) selector = model;
		} else if (entry.type === "thinking_level_change") {
			const level = (entry as { thinkingLevel?: unknown }).thinkingLevel;
			if (level === null || typeof level === "string") effort = level;
		}
	}
	return {
		...(selector === undefined ? {} : { selector }),
		...(effort === undefined ? {} : { effort }),
	};
}

/** Route a reconciling apply is trying to reach. */
export interface ChildRouteUpdateTarget {
	/** Resolved `provider/model`. */
	selector: string;
	/** Explicit effort, or `null` when the request named none. */
	effort: string | null;
}

/**
 * True when the child's durable route already satisfies the request.
 *
 * An in-doubt record is settled with an `applied` receipt instead of a second
 * mutation when this holds, which is what keeps a crash between the mutation
 * and its receipt from duplicating model entries or hot-swap notices.
 */
export function durableRouteSatisfies(durable: DurableChildRoute, target: ChildRouteUpdateTarget): boolean {
	if (durable.selector !== target.selector) return false;
	if (target.effort === null) return true;
	return durable.effort === target.effort;
}

export interface ChildRouteUpdateRequest {
	requestId: string;
	agentId: string;
	selector: string;
	effort: string | null;
	requestedBy: string;
	ownerEpoch: string;
	reason?: string;
}

export function createPendingChildRouteUpdate(
	request: ChildRouteUpdateRequest,
	now = new Date().toISOString(),
): ChildRouteUpdateRecord {
	return {
		version: CHILD_ROUTE_UPDATE_VERSION,
		requestId: request.requestId,
		agentId: request.agentId,
		selector: request.selector,
		effort: request.effort,
		requestedBy: request.requestedBy,
		ownerEpoch: request.ownerEpoch,
		requestedAt: now,
		state: "pending",
		updatedAt: now,
		...(request.reason === undefined ? {} : { reason: request.reason }),
	};
}

/**
 * Durable intent recorded before any session mutation.
 *
 * Every attempt bumps {@link ChildRouteUpdateRecord.attempt}, so a reconciled
 * restart is visible in the journal instead of looking like the first try.
 */
export function markChildRouteUpdateApplying(
	record: ChildRouteUpdateRecord,
	applyingOwnerEpoch: string,
	now = new Date().toISOString(),
): ChildRouteUpdateRecord {
	const { failureDetail: _dropped, ...rest } = record;
	return {
		...rest,
		state: "applying",
		updatedAt: now,
		applyingAt: now,
		applyingOwnerEpoch,
		attempt: (record.attempt ?? 0) + 1,
	};
}

export function markChildRouteUpdateApplied(
	record: ChildRouteUpdateRecord,
	applied: { appliedSelector: string; appliedEffort: string | null; appliedOwnerEpoch: string },
	now = new Date().toISOString(),
): ChildRouteUpdateRecord {
	const { failureDetail: _dropped, ...rest } = record;
	return {
		...rest,
		state: "applied",
		updatedAt: now,
		appliedAt: now,
		appliedSelector: applied.appliedSelector,
		appliedEffort: applied.appliedEffort,
		appliedOwnerEpoch: applied.appliedOwnerEpoch,
	};
}

export function markChildRouteUpdateNotApplied(
	record: ChildRouteUpdateRecord,
	notAppliedReason: ChildRouteUpdateNotAppliedReason,
	failureDetail?: string,
	now = new Date().toISOString(),
): ChildRouteUpdateRecord {
	return {
		...record,
		state: "not_applied",
		updatedAt: now,
		terminalAt: now,
		notAppliedReason,
		...(failureDetail === undefined ? {} : { failureDetail: boundedFailureDetail(failureDetail) }),
	};
}

/**
 * The mutation started and could neither be proven complete nor safely undone.
 *
 * Deliberately not terminal: the next owner reconciles it against the child's
 * durable route exactly like an `applying` record, which is the only way to
 * settle it without guessing.
 */
export function markChildRouteUpdateUncertain(
	record: ChildRouteUpdateRecord,
	failureDetail: string,
	now = new Date().toISOString(),
): ChildRouteUpdateRecord {
	return {
		...record,
		state: "uncertain",
		updatedAt: now,
		applyingAt: record.applyingAt ?? now,
		failureDetail: boundedFailureDetail(failureDetail),
	};
}

/** One durable route-update transition, broadcast so status surfaces never go stale. */
export interface ChildRouteUpdateNotification {
	readonly agentId: string;
	/** Journal the record landed in, when the manager has already chosen one. */
	readonly sessionFile: string | undefined;
	readonly record: ChildRouteUpdateRecord;
}

const routeUpdateListeners = new Set<(notification: ChildRouteUpdateNotification) => void>();

/**
 * Observe every durable route-update transition in this process.
 *
 * The Hub and the async job manager both cache child journal state; without
 * this they only refresh on unrelated registry events, which is exactly when a
 * blocked child's pending swap would be invisible.
 */
export function onChildRouteUpdate(listener: (notification: ChildRouteUpdateNotification) => void): () => void {
	routeUpdateListeners.add(listener);
	return () => {
		routeUpdateListeners.delete(listener);
	};
}

export function notifyChildRouteUpdate(notification: ChildRouteUpdateNotification): void {
	for (const listener of [...routeUpdateListeners]) {
		try {
			listener(notification);
		} catch {
			// A status surface must never break a durable transition.
		}
	}
}

/**
 * Append one immutable route-update snapshot to its child journal, make it
 * durable, and publish the transition before returning.
 *
 * `ensureOnDisk` crosses the manager's lazy session-file gate: a child that has
 * not produced an assistant message yet would otherwise hold the request in
 * memory only and lose it on restart — the one outcome this record exists to
 * prevent.
 */
export async function appendChildRouteUpdateRecord(
	sessionManager: RouteUpdateSessionManager,
	record: ChildRouteUpdateRecord,
): Promise<ChildRouteUpdateRecord> {
	sessionManager.appendCustomEntry(CHILD_ROUTE_UPDATE_CUSTOM_TYPE, record);
	await sessionManager.ensureOnDisk();
	await sessionManager.flush();
	notifyChildRouteUpdate({
		agentId: record.agentId,
		sessionFile: sessionManager.getSessionFile() ?? undefined,
		record,
	});
	return record;
}

export type ChildRouteUpdateRejection = "stale_owner_epoch" | "conflicting_pending" | "corrupt_journal";

export type ChildRouteUpdateAdmission =
	| { status: "append"; record: ChildRouteUpdateRecord }
	| { status: "duplicate"; record: ChildRouteUpdateRecord }
	| { status: "rejected"; reason: ChildRouteUpdateRejection; record?: ChildRouteUpdateRecord };

function sameRouteValue(a: ChildRouteUpdateRecord, b: ChildRouteUpdateRequest): boolean {
	return a.selector === b.selector && a.effort === b.effort;
}

/**
 * Decide whether a route-update request may be appended.
 *
 * Idempotent on a replayed request id and on a byte-identical selector/effort
 * against the request already open. Anything else that would silently overwrite
 * a live request, or that was minted under a superseded owner epoch, is a typed
 * rejection rather than a second append.
 */
export function admitChildRouteUpdate(
	projection: ChildRouteUpdateProjection,
	request: ChildRouteUpdateRequest,
	currentOwnerEpoch: string,
	now = new Date().toISOString(),
): ChildRouteUpdateAdmission {
	if (projection.corrupt) return { status: "rejected", reason: "corrupt_journal" };
	const replay = projection.byRequestId.get(request.requestId);
	if (replay) return { status: "duplicate", record: replay };
	if (request.ownerEpoch !== currentOwnerEpoch) return { status: "rejected", reason: "stale_owner_epoch" };
	const open = projection.open;
	if (open) {
		if (sameRouteValue(open, request)) return { status: "duplicate", record: open };
		return { status: "rejected", reason: "conflicting_pending", record: open };
	}
	return { status: "append", record: createPendingChildRouteUpdate(request, now) };
}

export type ChildRouteUpdateClaim =
	| { status: "none" }
	| { status: "claim"; record: ChildRouteUpdateRecord; resume: boolean }
	| { status: "fenced"; record: ChildRouteUpdateRecord };

/**
 * Select the open request the safe boundary should act on.
 *
 * Epoch equality is not the apply-time fence: a record minted by a previous
 * owner is exactly what restart recovery must apply. The apply-time fence is
 * the *current* owner having lost its lease — `ownershipLost` retires the
 * request with a `not_applied` receipt instead of mutating a session this
 * process no longer owns.
 *
 * `resume` marks a record whose mutation may already have landed; the caller
 * must reconcile against the child's durable route before mutating again.
 */
export function claimChildRouteUpdate(
	projection: ChildRouteUpdateProjection,
	options: { ownershipLost?: boolean } = {},
): ChildRouteUpdateClaim {
	if (projection.corrupt) return { status: "none" };
	const open = projection.open;
	if (!open) return { status: "none" };
	if (options.ownershipLost) return { status: "fenced", record: open };
	return { status: "claim", record: open, resume: isChildRouteUpdateInDoubt(open.state) };
}

/** Compact status projection shared by the `job` tool output and the Hub view model. */
export interface ChildRouteUpdateStatus {
	requestId: string;
	state: ChildRouteUpdateState;
	selector: string;
	effort: string | null;
	requestedBy: string;
	requestedAt: string;
	attempt?: number;
	appliedSelector?: string;
	appliedEffort?: string | null;
	appliedAt?: string;
	notAppliedReason?: ChildRouteUpdateNotAppliedReason;
	failureDetail?: string;
}

/**
 * What a status surface actually knows about one child's route updates.
 *
 * A read or decode failure is its own answer. Collapsing it into "nothing
 * pending" is the one thing this type exists to prevent.
 */
export type ChildRouteUpdateReport =
	| { availability: "known"; status: ChildRouteUpdateStatus }
	| { availability: "unavailable"; detail: string }
	| { availability: "corrupt"; detail: string };

export function childRouteUpdateStatus(record: ChildRouteUpdateRecord | undefined): ChildRouteUpdateStatus | undefined {
	if (!record) return undefined;
	return {
		requestId: record.requestId,
		state: record.state,
		selector: record.selector,
		effort: record.effort,
		requestedBy: record.requestedBy,
		requestedAt: record.requestedAt,
		...(record.attempt === undefined ? {} : { attempt: record.attempt }),
		...(record.appliedSelector === undefined ? {} : { appliedSelector: record.appliedSelector }),
		...(record.appliedEffort === undefined ? {} : { appliedEffort: record.appliedEffort }),
		...(record.appliedAt === undefined ? {} : { appliedAt: record.appliedAt }),
		...(record.notAppliedReason === undefined ? {} : { notAppliedReason: record.notAppliedReason }),
		...(record.failureDetail === undefined ? {} : { failureDetail: record.failureDetail }),
	};
}

/**
 * Turn a projection into the honest status answer.
 *
 * `undefined` means the journal was read cleanly and holds no route update.
 * Corruption and an unresolvable bounded scan are reported, never omitted.
 */
export function childRouteUpdateReport(projection: ChildRouteUpdateProjection): ChildRouteUpdateReport | undefined {
	if (projection.corrupt) {
		return { availability: "corrupt", detail: "child journal holds an undecodable route-update record" };
	}
	if (projection.overflow) {
		return { availability: "unavailable", detail: "route-update scan budget exhausted before reaching a record" };
	}
	const status = childRouteUpdateStatus(projection.open ?? projection.latest);
	return status ? { availability: "known", status } : undefined;
}

/**
 * Tell "this journal holds no route update" apart from "this journal could not
 * be read".
 *
 * The bounded tail reader answers `undefined` for both, which is precisely the
 * silently-wrong status the report type exists to prevent. A journal that was
 * never created carries no request and is not a failure; anything else is.
 */
async function journalReadFailure(sessionFile: string): Promise<string | undefined> {
	try {
		const handle = await fs.open(sessionFile, "r");
		await handle.close();
		return undefined;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		return boundedFailureDetail(error instanceof Error ? error.message : String(error));
	}
}

/**
 * Read one child journal and answer honestly, including when it cannot be read.
 *
 * Status surfaces call this instead of swallowing the read error, so a pending
 * request in a temporarily unreadable journal never renders as "no swap".
 */
export async function readChildRouteUpdateReport(sessionFile: string): Promise<ChildRouteUpdateReport | undefined> {
	try {
		const report = childRouteUpdateReport(await readAuthoritativeChildRouteUpdateProjection(sessionFile));
		if (report) return report;
		const failure = await journalReadFailure(sessionFile);
		return failure === undefined ? undefined : { availability: "unavailable", detail: failure };
	} catch (error) {
		return {
			availability: "unavailable",
			detail: boundedFailureDetail(error instanceof Error ? error.message : String(error)),
		};
	}
}

/** Render one line describing the newest route-update outcome for status surfaces. */
export function formatChildRouteUpdate(status: ChildRouteUpdateStatus | undefined): string | undefined {
	if (!status) return undefined;
	const effort = status.effort === null ? "" : `:${status.effort}`;
	const detail = status.failureDetail ? `: ${status.failureDetail}` : "";
	if (status.state === "pending") return `route pending → ${status.selector}${effort} (by ${status.requestedBy})`;
	if (status.state === "applying") {
		const attempt = status.attempt && status.attempt > 1 ? ` (attempt ${status.attempt})` : "";
		return `route applying → ${status.selector}${effort}${attempt}`;
	}
	if (status.state === "uncertain") return `route uncertain → ${status.selector}${effort}${detail}`;
	if (status.state === "applied") {
		const appliedEffort =
			status.appliedEffort === null || status.appliedEffort === undefined ? "" : `:${status.appliedEffort}`;
		return `route applied → ${status.appliedSelector ?? status.selector}${appliedEffort}`;
	}
	return `route not applied → ${status.selector}${effort} (${status.notAppliedReason ?? "unknown"})${detail}`;
}

/** Render a status surface line, including the honest answer when nothing could be read. */
export function formatChildRouteUpdateReport(report: ChildRouteUpdateReport | undefined): string | undefined {
	if (!report) return undefined;
	if (report.availability === "known") return formatChildRouteUpdate(report.status);
	if (report.availability === "corrupt") return `route status corrupt (${report.detail})`;
	return `route status unavailable (${report.detail})`;
}
