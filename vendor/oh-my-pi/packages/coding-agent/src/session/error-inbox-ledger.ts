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
}

/** Persist one v2 ErrorInbox record without allowing ledger failures to recurse. */
export function appendErrorInboxEvent(sessionManager: ErrorInboxWriter, event: DiagnosticEvent): boolean {
	try {
		sessionManager.appendCustomEntry("ui_error", { ...event, version: 2 });
		return true;
	} catch {
		// Persistence failure must never recursively surface as a new error.
		return false;
	}
}

