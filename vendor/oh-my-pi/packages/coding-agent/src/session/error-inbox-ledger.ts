import type { RequestFailureCause } from "@oh-my-pi/pi-ai";

import type { SessionManager } from "./session-manager";

export interface FocusCmuxOwnerAction {
	readonly kind: "focus_cmux_owner";
	readonly sessionFile: string;
	readonly sessionId: string;
	readonly lostOwnerEpoch: string;
}

export interface ResolveFallbackApprovalAction {
	readonly kind: "resolve_fallback_approval";
	readonly agentId: string;
	readonly sourceModel: string;
	readonly proposedModel: string;
	readonly cause: "network" | "rate-limit" | "provider";
	readonly taskContext: string;
	readonly options: readonly ["wait", "approve", "choose", "abort"];
}

export type DiagnosticAction = FocusCmuxOwnerAction | ResolveFallbackApprovalAction;

export interface DiagnosticEvent {
	id: string;
	firstTimestamp: number;
	lastTimestamp: number;
	message: string;
	count: number;

	source?: string;
	category?: string;
	/** Stable request-failure taxonomy; greppable in the durable ledger. */
	cause?: RequestFailureCause;
	/** Terminal/retry outcome rendered in the operator headline. */
	disposition?: string;
	/** Raw provider/SDK message, never used as the operator headline. */
	detail?: string;
	errorClass?: string;
	provider?: string;
	model?: string;
	session?: string;
	agent?: string;
	tool?: string;
	job?: string;
	operation?: string;
	status?: number | string;
	code?: string;
	retry?: boolean;
	reset?: number;
	requestFingerprint?: string;
	logPointer?: string;
	historyUri?: string;
	finalOutputUri?: string;
	finalOutputAvailable?: boolean;
	causeChain?: string[];
	buildDigest?: string;
	fleetRolloutId?: string;

	action?: DiagnosticAction;
	unread: boolean;
	resolved: boolean;
}

export type DiagnosticEventInput = Omit<
	DiagnosticEvent,
	"id" | "firstTimestamp" | "lastTimestamp" | "count" | "unread" | "resolved"
> & { id?: string };

export interface ErrorInboxWriter {
	appendCustomEntry: SessionManager["appendCustomEntry"];
	getEntries?: SessionManager["getEntries"];
	getSessionOwnership?: SessionManager["getSessionOwnership"];
}

function inferBuildDigest(sessionManager: ErrorInboxWriter): string | undefined {
	try {
		return sessionManager.getSessionOwnership?.()?.buildRevision.digest;
	} catch {
		return undefined;
	}
}

function inferFleetRolloutId(sessionManager: ErrorInboxWriter): string | undefined {
	try {
		const entries = sessionManager.getEntries?.();
		if (!entries) return undefined;

		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index];
			if (
				entry.type !== "custom" ||
				(entry.customType !== "rollout-checkpoint" && entry.customType !== "rollout-auto-resume") ||
				typeof entry.data !== "object" ||
				entry.data === null ||
				Array.isArray(entry.data)
			) {
				continue;
			}
			const rolloutId = (entry.data as Record<string, unknown>).rolloutId;
			if (typeof rolloutId === "string" && rolloutId.length > 0) return rolloutId;
		}
		return undefined;
	} catch {
		return undefined;
	}
}
export function enrichErrorInboxEvent(
	sessionManager: ErrorInboxWriter,
	event: Pick<DiagnosticEvent, "buildDigest" | "fleetRolloutId">,
): void {
	event.buildDigest ??= inferBuildDigest(sessionManager);
	event.fleetRolloutId ??= inferFleetRolloutId(sessionManager);
}

/** Persist one v2 ErrorInbox record without allowing ledger failures to recurse. */
export function appendErrorInboxEvent(sessionManager: ErrorInboxWriter, event: DiagnosticEvent): boolean {
	try {
		enrichErrorInboxEvent(sessionManager, event);
		sessionManager.appendCustomEntry("ui_error", { ...event, version: 2 });
		return true;
	} catch {
		// Persistence failure must never recursively surface as a new error.
		return false;
	}
}
