import type { CustomEntry, FileEntry } from "../session/session-entries";
import type { SessionManager } from "../session/session-manager";

export const CHILD_LIFECYCLE_CUSTOM_TYPE = "child_lifecycle";

export const CHILD_RESTART_CUSTOM_TYPE = "child_restart";

export interface ChildRestartRecord {
	version: 1;
	agentId: string;
	predecessorOwnerEpoch: string;
	state: "running" | "parked";
	queueCheckpoint: string | null;
	status: "pending" | "resuming" | "resumed";
	attemptId?: string;
	updatedAt: string;
}

export type ChildRestartRecordDecode =
	| { kind: "not_restart" }
	| { kind: "invalid" }
	| { kind: "valid"; record: ChildRestartRecord };

export type ChildLifecycleState = "running" | "idle" | "parked" | "completed" | "failed" | "interrupted";

export interface ChildLifecycleRecord {
	version: 1;
	agentId: string;
	childSessionFile: string;
	parentSessionFile: string;
	state: ChildLifecycleState;
	updatedAt: string;
	modelId?: string;
	thinkingLevel?: string | null;
}

export type ChildLifecycleRecordDecode =
	| { kind: "not_lifecycle" }
	| { kind: "invalid" }
	| { kind: "valid"; record: ChildLifecycleRecord };

type LifecycleSessionManager = Pick<SessionManager, "appendCustomEntry" | "getEntries">;

const CHILD_LIFECYCLE_STATES: Record<ChildLifecycleState, true> = {
	running: true,
	idle: true,
	parked: true,
	completed: true,
	failed: true,
	interrupted: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Decode an untrusted durable child lifecycle custom entry at the journal boundary. */
export function decodeChildLifecycleEntry(entry: FileEntry): ChildLifecycleRecordDecode {
	if (entry.type !== "custom" || entry.customType !== CHILD_LIFECYCLE_CUSTOM_TYPE) return { kind: "not_lifecycle" };
	const data = (entry as CustomEntry).data;
	if (!isRecord(data)) return { kind: "invalid" };
	const { version, agentId, childSessionFile, parentSessionFile, state, updatedAt, modelId, thinkingLevel } = data;
	if (
		version !== 1 ||
		typeof agentId !== "string" ||
		agentId.length === 0 ||
		typeof childSessionFile !== "string" ||
		childSessionFile.length === 0 ||
		typeof parentSessionFile !== "string" ||
		parentSessionFile.length === 0 ||
		typeof state !== "string" ||
		!(state in CHILD_LIFECYCLE_STATES) ||
		typeof updatedAt !== "string" ||
		!Number.isFinite(Date.parse(updatedAt)) ||
		(modelId !== undefined && typeof modelId !== "string") ||
		(thinkingLevel !== undefined && thinkingLevel !== null && typeof thinkingLevel !== "string")
	) {
		return { kind: "invalid" };
	}
	return {
		kind: "valid",
		record: {
			version,
			agentId,
			childSessionFile,
			parentSessionFile,
			state: state as ChildLifecycleState,
			updatedAt,
			...(modelId === undefined ? {} : { modelId }),
			...(thinkingLevel === undefined ? {} : { thinkingLevel }),
		},
	};
}

/** Decode an ordered-restart checkpoint. Malformed records invalidate restart recovery. */
export function decodeChildRestartEntry(entry: FileEntry): ChildRestartRecordDecode {
	if (entry.type !== "custom" || entry.customType !== CHILD_RESTART_CUSTOM_TYPE) return { kind: "not_restart" };
	const data = (entry as CustomEntry).data;
	if (!isRecord(data)) return { kind: "invalid" };
	const { version, agentId, predecessorOwnerEpoch, state, queueCheckpoint, status, attemptId, updatedAt } = data;
	if (
		version !== 1 ||
		typeof agentId !== "string" ||
		agentId.length === 0 ||
		typeof predecessorOwnerEpoch !== "string" ||
		predecessorOwnerEpoch.length === 0 ||
		(state !== "running" && state !== "parked") ||
		(queueCheckpoint !== null && typeof queueCheckpoint !== "string") ||
		(status !== "pending" && status !== "resuming" && status !== "resumed") ||
		(attemptId !== undefined && (typeof attemptId !== "string" || attemptId.length === 0)) ||
		(status === "resuming" && typeof attemptId !== "string") ||
		typeof updatedAt !== "string" ||
		!Number.isFinite(Date.parse(updatedAt))
	) {
		return { kind: "invalid" };
	}
	return {
		kind: "valid",
		record: {
			version,
			agentId,
			predecessorOwnerEpoch,
			state,
			queueCheckpoint,
			status,
			...(attemptId === undefined ? {} : { attemptId }),
			updatedAt,
		},
	};
}

export function appendChildRestartRecord(sessionManager: LifecycleSessionManager, record: ChildRestartRecord): void {
	sessionManager.appendCustomEntry(CHILD_RESTART_CUSTOM_TYPE, record);
}

/** Latest append wins; a corrupt restart record prevents unsafe replay. */
export function latestChildRestartRecord(entries: readonly FileEntry[]): ChildRestartRecord | undefined | null {
	let latest: ChildRestartRecord | undefined;
	for (const entry of entries) {
		const decoded = decodeChildRestartEntry(entry);
		if (decoded.kind === "invalid") return null;
		if (decoded.kind === "valid") latest = decoded.record;
	}
	return latest;
}
/** Append one immutable lifecycle snapshot to its child journal. */
export function appendChildLifecycleRecord(sessionManager: LifecycleSessionManager, record: ChildLifecycleRecord): void {
	sessionManager.appendCustomEntry(CHILD_LIFECYCLE_CUSTOM_TYPE, record);
}

/** Advance an existing child journal without inventing lifecycle metadata for unrelated sessions. */
export function transitionChildLifecycleRecord(sessionManager: LifecycleSessionManager, state: ChildLifecycleState): void {
	const current = latestChildLifecycleRecord(sessionManager.getEntries());
	if (!current || isTerminalChildLifecycleState(current.state)) return;
	appendChildLifecycleRecord(sessionManager, { ...current, state, updatedAt: new Date().toISOString() });
}

/** Newest lifecycle timestamp wins; any malformed lifecycle entry invalidates the journal. */
export function latestChildLifecycleRecord(entries: readonly FileEntry[]): ChildLifecycleRecord | undefined | null {
	let latest: ChildLifecycleRecord | undefined;
	for (const entry of entries) {
		const decoded = decodeChildLifecycleEntry(entry);
		if (decoded.kind === "invalid") return null;
		if (decoded.kind === "valid" && (!latest || Date.parse(decoded.record.updatedAt) >= Date.parse(latest.updatedAt))) {
			latest = decoded.record;
		}
	}
	return latest;
}

export function isTerminalChildLifecycleState(state: ChildLifecycleState): boolean {
	return state === "completed" || state === "failed" || state === "interrupted";
}
