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

export type ChildLifecycleState =
	| "running"
	| "waiting-provider"
	| "idle"
	| "parked"
	| "completed"
	| "failed"
	| "interrupted";

export type ChildFailureClass =
	| "wall_timeout"
	| "subprocess_abort"
	| "transient_host_resource"
	| "lost_transcript"
	| "fatal";

export type ChildResumeDisposition = "resumable" | "unrecoverable";

export interface ChildLifecycleRecord {
	version: 1;
	agentId: string;
	childSessionFile: string;
	parentSessionFile: string;
	state: ChildLifecycleState;
	updatedAt: string;
	modelId?: string;
	thinkingLevel?: string | null;
	failureClass?: ChildFailureClass;
	resumeDisposition?: ChildResumeDisposition;
}

export type ChildLifecycleRecordDecode =
	| { kind: "not_lifecycle" }
	| { kind: "invalid" }
	| { kind: "valid"; record: ChildLifecycleRecord };

type LifecycleSessionManager = Pick<SessionManager, "appendCustomEntry" | "getEntries">;

const CHILD_LIFECYCLE_STATES: Record<ChildLifecycleState, true> = {
	running: true,
	"waiting-provider": true,
	idle: true,
	parked: true,
	completed: true,
	failed: true,
	interrupted: true,
};

const CHILD_FAILURE_CLASSES: Record<ChildFailureClass, true> = {
	wall_timeout: true,
	subprocess_abort: true,
	transient_host_resource: true,
	lost_transcript: true,
	fatal: true,
};

const CHILD_RESUME_DISPOSITIONS: Record<ChildResumeDisposition, true> = {
	resumable: true,
	unrecoverable: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Decode an untrusted durable child lifecycle custom entry at the journal boundary. */
export function decodeChildLifecycleEntry(entry: FileEntry): ChildLifecycleRecordDecode {
	if (entry.type !== "custom" || entry.customType !== CHILD_LIFECYCLE_CUSTOM_TYPE) return { kind: "not_lifecycle" };
	const data = (entry as CustomEntry).data;
	if (!isRecord(data)) return { kind: "invalid" };
	const {
		version,
		agentId,
		childSessionFile,
		parentSessionFile,
		state,
		updatedAt,
		modelId,
		thinkingLevel,
		failureClass,
		resumeDisposition,
	} = data;
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
		(thinkingLevel !== undefined && thinkingLevel !== null && typeof thinkingLevel !== "string") ||
		(failureClass !== undefined &&
			(typeof failureClass !== "string" || !(failureClass in CHILD_FAILURE_CLASSES))) ||
		(resumeDisposition !== undefined &&
			(typeof resumeDisposition !== "string" || !(resumeDisposition in CHILD_RESUME_DISPOSITIONS)))
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
			...(failureClass === undefined ? {} : { failureClass: failureClass as ChildFailureClass }),
			...(resumeDisposition === undefined
				? {}
				: { resumeDisposition: resumeDisposition as ChildResumeDisposition }),
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

export type ChildResumeOutcome =
	| "wall_timeout"
	| "subprocess_abort"
	| "transient_host_resource"
	| "lost_transcript"
	| "completed"
	| "fatal"
	| "isolated"
	| "live_owner"
	| "unusable_journal";

export interface ChildResumeEvidence {
	journal: "usable" | "missing" | "corrupt";
	lifecycle?: ChildLifecycleRecord;
	liveOwner: boolean;
	isolated: boolean;
	parentFailureClass?: string;
}

export interface ChildResumeClassification {
	outcome: ChildResumeOutcome;
	disposition: ChildResumeDisposition;
	reason: string;
}

function persistedFailureClass(evidence: ChildResumeEvidence): ChildFailureClass | undefined {
	if (evidence.lifecycle?.failureClass) return evidence.lifecycle.failureClass;
	switch (evidence.parentFailureClass) {
		case "timeout":
			return "wall_timeout";
		case "subprocess-abort":
			return "subprocess_abort";
		case "host-resource":
			return "transient_host_resource";
		case "lost-transcript":
			return "lost_transcript";
		default:
			return undefined;
	}
}

/** Classify resume safety from journal and owner evidence, never from the process-local job cache. */
export function classifyChildResumeEvidence(evidence: ChildResumeEvidence): ChildResumeClassification {
	if (evidence.liveOwner) {
		return {
			outcome: "live_owner",
			disposition: "unrecoverable",
			reason: "a live owner still holds this child",
		};
	}
	if (evidence.isolated) {
		return {
			outcome: "isolated",
			disposition: "unrecoverable",
			reason: "isolated child workspaces cannot be resumed in place",
		};
	}
	if (evidence.journal !== "usable") {
		return {
			outcome: evidence.journal === "missing" ? "lost_transcript" : "unusable_journal",
			disposition: "unrecoverable",
			reason:
				evidence.journal === "missing"
					? "the child journal is missing"
					: "the child journal is malformed or unreadable",
		};
	}
	const lifecycle = evidence.lifecycle;
	if (!lifecycle) {
		return {
			outcome: "unusable_journal",
			disposition: "unrecoverable",
			reason: "the child journal has no lifecycle evidence",
		};
	}
	if (lifecycle.state === "completed") {
		return { outcome: "completed", disposition: "unrecoverable", reason: "the child already completed" };
	}
	if (lifecycle.resumeDisposition === "unrecoverable" || lifecycle.failureClass === "fatal") {
		return { outcome: "fatal", disposition: "unrecoverable", reason: "the child recorded an unrecoverable failure" };
	}
	const failureClass = persistedFailureClass(evidence);
	if (failureClass && failureClass !== "fatal") {
		return {
			outcome: failureClass,
			disposition: "resumable",
			reason: `the durable failure class is ${failureClass}`,
		};
	}
	if (lifecycle.state === "interrupted") {
		return {
			outcome: "subprocess_abort",
			disposition: "resumable",
			reason: "the child recorded an interrupted turn",
		};
	}
	if (lifecycle.state === "failed") {
		return { outcome: "fatal", disposition: "unrecoverable", reason: "the child recorded an unclassified failure" };
	}
	if (lifecycle.state === "running") {
		return {
			outcome: "lost_transcript",
			disposition: "resumable",
			reason: "the journal remained non-terminal after its owner disappeared",
		};
	}
	return {
		outcome: "subprocess_abort",
		disposition: "resumable",
		reason: `the child is durably ${lifecycle.state} with no live owner`,
	};
}
