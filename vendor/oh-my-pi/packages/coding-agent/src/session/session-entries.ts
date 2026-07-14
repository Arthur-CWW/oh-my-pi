import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { MessageAttribution, ServiceTier, UserContent } from "@oh-my-pi/pi-ai";

export const CURRENT_SESSION_VERSION = 4;

export const EPHEMERAL_MODEL_CHANGE_ROLE = "fallback";

export type WorkstreamSource = "explicit" | "goal" | "inherited";

export type SessionWorkstream = { kind: "workstream"; id: string } | { kind: "adhoc" };

const WORKSTREAM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function workstreamCharterPath(id: string): string {
	return `streams/${id}/GOAL.md`;
}

/**
 * Decode persisted workstream metadata without trusting the session JSON.
 * Invalid metadata is treated as absent so legacy and malformed sessions remain resumable.
 */
export function decodeSessionWorkstream(value: unknown): SessionWorkstream | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;

	if (record.kind === "adhoc") {
		if (Object.keys(record).length !== 1) return undefined;
		return { kind: "adhoc" };
	}

	if (
		record.kind !== "workstream" ||
		Object.keys(record).length !== 2 ||
		typeof record.id !== "string" ||
		!WORKSTREAM_ID_PATTERN.test(record.id)
	)
		return undefined;

	return { kind: "workstream", id: record.id };
}

export interface SessionHeader {
	type: "session";
	version?: number; // v1 sessions don't have this
	id: string;
	title?: string; // Auto-generated title from first message
	titleSource?: "auto" | "user";
	timestamp: string;
	cwd: string;
	parentSession?: string;
	workstream?: SessionWorkstream;
}

export interface NewSessionOptions {
	parentSession?: string;
	/** Skip flushing the current session and delete it instead of saving. */
	drop?: boolean;
}

export interface SessionEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
}

export interface SessionMessageAttribution {
	/** Resolved request selector in "provider/modelId[:thinkingLevel]" format. */
	model?: string;
	/** Effective thinking level used for this message, when tracked separately. */
	thinkingLevel?: string | null;
	/** Advisor model selector when an advisor injection influenced this turn. */
	advisor?: string;
}

export interface SessionMessageEntry extends SessionEntryBase, SessionMessageAttribution {
	type: "message";
	message: AgentMessage;
}

export interface SessionCommandMetadataV1 {
	readonly schemaVersion: 1;
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly expectedSessionRevision: number;
}

export interface SetModelRequest {
	readonly kind: "setModel";
	readonly model: string;
	readonly role: string;
}

export interface SetThinkingLevelRequest {
	readonly kind: "setThinkingLevel";
	readonly thinkingLevel: string | null;
}

export type WorkflowModeSnapshot =
	| { readonly kind: "none" }
	| {
			readonly kind: "plan";
			readonly phase: "active" | "paused";
			readonly planFilePath: string;
			readonly workflow: "parallel" | "iterative";
			readonly reentry: boolean;
	  }
	| { readonly kind: "goal"; readonly phase: "active" | "paused"; readonly goalId: string };

export interface TransitionPlanModeRequest {
	readonly kind: "transitionPlanMode";
	readonly transition:
		| {
				readonly kind: "enter";
				readonly planFilePath: string;
				readonly workflow: "parallel" | "iterative";
		  }
		| { readonly kind: "exit"; readonly disposition: "paused" | "disabled" };
}

export interface TransitionGoalModeRequest {
	readonly kind: "transitionGoalMode";
	readonly transition:
		| {
				readonly kind: "enter";
				readonly action: "create";
				readonly objective: string;
				readonly tokenBudget?: number;
				readonly workstream?: string;
		  }
		| { readonly kind: "enter"; readonly action: "resume"; readonly goalId: string }
		| {
				readonly kind: "exit";
				readonly goalId: string;
				readonly disposition: "paused" | "dropped" | "completed";
		  };
}

export interface WorkflowRestoreState {
	readonly mode: WorkflowModeSnapshot;
	readonly activeToolNames: string[];
	readonly model?: string;
	readonly thinkingLevel?: string;
}

export type SetModelSessionCommand = SessionCommandMetadataV1 & SetModelRequest;
export type SetThinkingSessionCommand = SessionCommandMetadataV1 & SetThinkingLevelRequest;
export type TransitionPlanModeSessionCommand = SessionCommandMetadataV1 & TransitionPlanModeRequest;
export type TransitionGoalModeSessionCommand = SessionCommandMetadataV1 & TransitionGoalModeRequest;
export type TransitionWorkflowModeSessionCommand = TransitionPlanModeSessionCommand | TransitionGoalModeSessionCommand;
export type SessionStateCommand = SetModelSessionCommand | SetThinkingSessionCommand;
export type SessionCommand = SessionStateCommand | TransitionWorkflowModeSessionCommand;

export interface SessionCommandRecord<
	Request extends SetModelRequest | SetThinkingLevelRequest | TransitionPlanModeRequest | TransitionGoalModeRequest,
> extends SessionCommandMetadataV1 {
	readonly request: Request;
	readonly committedSessionRevision: number;
}

export interface ThinkingLevelChangeEntry extends SessionEntryBase {
	type: "thinking_level_change";
	thinkingLevel?: string | null;
	command?: SessionCommandRecord<SetThinkingLevelRequest>;
}

export interface ModelChangeEntry extends SessionEntryBase {
	type: "model_change";
	/** Model in "provider/modelId" format */
	model: string;
	/** Role: "default", "smol", "slow", etc. Undefined treated as "default" */
	role?: string;
	command?: SessionCommandRecord<SetModelRequest>;
}

export interface WorkflowChangeEntry extends SessionEntryBase {
	type: "workflow_change";
	command: SessionCommandRecord<TransitionPlanModeRequest | TransitionGoalModeRequest>;
	from: WorkflowModeSnapshot;
	previous: WorkflowRestoreState;
	next: WorkflowModeSnapshot;
}

declare module "@oh-my-pi/pi-agent-core/compaction/entries" {
	interface CustomCompactionSessionEntries {
		workflowChange: WorkflowChangeEntry;
	}
}

export type SessionCommandEntry = ModelChangeEntry | ThinkingLevelChangeEntry | WorkflowChangeEntry;

export interface SessionCommandReceipt {
	readonly entry: SessionCommandEntry;
	readonly sessionRevision: number;
	readonly replayed: boolean;
}

/** Decode command provenance at the persisted-session trust boundary. */
export function decodeSessionCommandEntry(value: unknown): SessionCommandEntry | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const entry = value as Record<string, unknown>;
	const commandValue = entry.command;
	if (typeof commandValue !== "object" || commandValue === null) return undefined;
	const command = commandValue as Record<string, unknown>;
	const requestValue = command.request;
	if (typeof requestValue !== "object" || requestValue === null) return undefined;
	const request = requestValue as Record<string, unknown>;
	if (
		command.schemaVersion !== 1 ||
		typeof command.commandId !== "string" ||
		typeof command.correlationId !== "string" ||
		(command.causationId !== undefined && typeof command.causationId !== "string") ||
		!Number.isSafeInteger(command.expectedSessionRevision) ||
		(command.expectedSessionRevision as number) < 0 ||
		!Number.isSafeInteger(command.committedSessionRevision) ||
		(command.committedSessionRevision as number) < 1
	) {
		return undefined;
	}
	if (
		entry.type === "model_change" &&
		request.kind === "setModel" &&
		typeof request.model === "string" &&
		typeof request.role === "string" &&
		entry.model === request.model &&
		entry.role === request.role
	) {
		return value as ModelChangeEntry;
	}
	if (
		entry.type === "thinking_level_change" &&
		request.kind === "setThinkingLevel" &&
		(request.thinkingLevel === null || typeof request.thinkingLevel === "string") &&
		entry.thinkingLevel === request.thinkingLevel
	) {
		return value as ThinkingLevelChangeEntry;
	}
	if (
		entry.type === "workflow_change" &&
		((request.kind === "transitionPlanMode" && isTransitionPlanModeRequest(request)) ||
			(request.kind === "transitionGoalMode" && isTransitionGoalModeRequest(request))) &&
		isWorkflowModeSnapshot(entry.from) &&
		isWorkflowRestoreState(entry.previous) &&
		isWorkflowModeSnapshot(entry.next) &&
		isWorkflowTransitionResult(request, entry.from, entry.next)
	) {
		return value as WorkflowChangeEntry;
	}
	return undefined;
}

function isTransitionPlanModeRequest(value: Record<string, unknown>): boolean {
	const transition = value.transition;
	if (typeof transition !== "object" || transition === null) return false;
	const candidate = transition as Record<string, unknown>;
	return candidate.kind === "enter"
		? typeof candidate.planFilePath === "string" &&
				(candidate.workflow === "parallel" || candidate.workflow === "iterative")
		: candidate.kind === "exit" && (candidate.disposition === "paused" || candidate.disposition === "disabled");
}

function isTransitionGoalModeRequest(value: Record<string, unknown>): boolean {
	const transition = value.transition;
	if (typeof transition !== "object" || transition === null) return false;
	const candidate = transition as Record<string, unknown>;
	if (candidate.kind === "enter" && candidate.action === "create") {
		return (
			candidate.goalId === undefined &&
			typeof candidate.objective === "string" &&
			candidate.objective.trim().length > 0 &&
			(candidate.tokenBudget === undefined ||
				(Number.isSafeInteger(candidate.tokenBudget) && (candidate.tokenBudget as number) > 0)) &&
			(candidate.workstream === undefined ||
				(typeof candidate.workstream === "string" &&
					decodeSessionWorkstream({ kind: "workstream", id: candidate.workstream }) !== undefined))
		);
	}
	if (candidate.kind === "enter" && candidate.action === "resume") {
		return typeof candidate.goalId === "string" && candidate.goalId.trim().length > 0;
	}
	return (
		candidate.kind === "exit" &&
		typeof candidate.goalId === "string" &&
		candidate.goalId.trim().length > 0 &&
		(candidate.disposition === "paused" ||
			candidate.disposition === "dropped" ||
			candidate.disposition === "completed")
	);
}

export function isWorkflowModeSnapshot(value: unknown): value is WorkflowModeSnapshot {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	if (candidate.kind === "none") return true;
	if (candidate.kind === "goal") {
		return (
			(candidate.phase === "active" || candidate.phase === "paused") &&
			typeof candidate.goalId === "string" &&
			candidate.goalId.trim().length > 0
		);
	}
	return (
		candidate.kind === "plan" &&
		(candidate.phase === "active" || candidate.phase === "paused") &&
		typeof candidate.planFilePath === "string" &&
		(candidate.workflow === "parallel" || candidate.workflow === "iterative") &&
		typeof candidate.reentry === "boolean"
	);
}

function isWorkflowRestoreState(value: unknown): value is WorkflowRestoreState {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		isWorkflowModeSnapshot(candidate.mode) &&
		Array.isArray(candidate.activeToolNames) &&
		candidate.activeToolNames.every(name => typeof name === "string") &&
		(candidate.model === undefined || typeof candidate.model === "string") &&
		(candidate.thinkingLevel === undefined || typeof candidate.thinkingLevel === "string")
	);
}

function isWorkflowTransitionResult(
	request: Record<string, unknown>,
	from: WorkflowModeSnapshot,
	next: WorkflowModeSnapshot,
): boolean {
	const transition = request.transition as Record<string, unknown>;
	if (request.kind === "transitionPlanMode") {
		if (transition.kind === "enter") {
			return (
				next.kind === "plan" &&
				next.phase === "active" &&
				next.planFilePath === transition.planFilePath &&
				next.workflow === transition.workflow &&
				next.reentry === (from.kind === "plan")
			);
		}
		if (from.kind !== "plan" || from.phase !== "active") return false;
		return transition.disposition === "paused"
			? next.kind === "plan" &&
					next.phase === "paused" &&
					next.planFilePath === from.planFilePath &&
					next.workflow === from.workflow &&
					next.reentry === from.reentry
			: next.kind === "none";
	}
	if (transition.kind === "enter" && transition.action === "create") {
		return next.kind === "goal" && next.phase === "active";
	}
	if (transition.kind === "enter") {
		return (
			from.kind === "goal" &&
			from.phase === "paused" &&
			from.goalId === transition.goalId &&
			next.kind === "goal" &&
			next.phase === "active" &&
			next.goalId === transition.goalId
		);
	}
	if (
		from.kind !== "goal" ||
		from.phase !== "active" ||
		from.goalId !== transition.goalId
	) {
		return false;
	}
	return transition.disposition === "paused"
		? next.kind === "goal" && next.phase === "paused" && next.goalId === transition.goalId
		: next.kind === "none";
}

export interface ServiceTierChangeEntry extends SessionEntryBase {
	type: "service_tier_change";
	serviceTier: ServiceTier | null;
}

export interface CompactionEntry<T = unknown> extends SessionEntryBase {
	type: "compaction";
	summary: string;
	shortSummary?: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	/**
	 * Highest durable input queue sequence observed when compaction began.
	 * Audit metadata only; it neither owns the queue nor asserts payload inclusion.
	 */
	queueBoundarySequence?: number;
	/** Extension-specific data (e.g., ArtifactIndex, version markers for structured compaction) */
	details?: T;
	/** Hook-provided data to persist across compaction */
	preserveData?: Record<string, unknown>;
	/** True if generated by an extension, undefined/false if pi-generated (backward compatible) */
	fromExtension?: boolean;
}

export interface BranchSummaryEntry<T = unknown> extends SessionEntryBase {
	type: "branch_summary";
	fromId: string;
	summary: string;
	/** Extension-specific data (not sent to LLM) */
	details?: T;
	/** True if generated by an extension, false if pi-generated */
	fromExtension?: boolean;
}

/** Persisted active leaf selection. Not a conversation tree node. */
export interface LeafChangeEntry extends SessionEntryBase {
	type: "leaf_change";
	/** Null means root/no active leaf; unknown non-null targets are ignored on replay. */
	target: string | null;
}

/**
 * Custom entry for extensions to store extension-specific data in the session.
 * Use customType to identify your extension's entries.
 *
 * Purpose: Persist extension state across session reloads. On reload, extensions can
 * scan entries for their customType and reconstruct internal state.
 *
 * Does NOT participate in LLM context (ignored by buildSessionContext).
 * For injecting content into context, see CustomMessageEntry.
 */
export interface CustomEntry<T = unknown> extends SessionEntryBase {
	type: "custom";
	customType: string;
	data?: T;
}

/** Label entry for user-defined bookmarks/markers on entries. */
export interface LabelEntry extends SessionEntryBase {
	type: "label";
	targetId: string;
	label: string | undefined;
}

/** TTSR injection entry - tracks which time-traveling rules have been injected this session. */
export interface TtsrInjectionEntry extends SessionEntryBase {
	type: "ttsr_injection";
	/** Names of rules that were injected */
	injectedRules: string[];
}

/** Persisted MCP discovery selection state for a session branch. */
export interface MCPToolSelectionEntry extends SessionEntryBase {
	type: "mcp_tool_selection";
	/** MCP tool names selected for visibility in discovery mode. */
	selectedToolNames: string[];
}

/** Durable task metadata needed to re-adopt a direct child after controller replacement. */
export interface SubagentSessionMetadata {
	agentId: string;
	parentSessionFile: string;
	parentSessionId?: string;
	displayName: string;
	model?: string;
	thinkingLevel?: string | null;
	isolated: boolean;
	/** Child depth and task prefix preserve subagent-scoped advisor policy on revival. */
	taskDepth: number;
	parentTaskPrefix: string;
}

/** Session init entry - captures initial context for subagent sessions (debugging/replay). */
export interface SessionInitEntry extends SessionEntryBase {
	type: "session_init";
	/** Full system prompt sent to the model */
	systemPrompt: string;
	/** Initial task/user message */
	task: string;
	/** Tools available to the agent */
	tools: string[];
	/** Output schema if structured output was requested */
	outputSchema?: unknown;
	/** Present only for durable direct task children. */
	subagent?: SubagentSessionMetadata;
}

/** Mode change entry - tracks agent mode transitions (e.g. plan mode). */
export interface ModeChangeEntry extends SessionEntryBase {
	type: "mode_change";
	/** Current mode name, or "none" when exiting a mode */
	mode: string;
	/** Optional mode-specific data (e.g. plan file path) */
	data?: Record<string, unknown>;
}

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Internal identity connecting a durable queue obligation to its transcript entry. */
export interface DurableDeliveryIdentity {
	inputId: string;
	inputRevision: number;
}

export function decodeDurableDeliveryIdentity(value: unknown): DurableDeliveryIdentity | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate.inputId !== "string" ||
		candidate.inputId.length === 0 ||
		typeof candidate.inputRevision !== "number" ||
		!Number.isSafeInteger(candidate.inputRevision) ||
		candidate.inputRevision < 0
	) {
		return undefined;
	}
	return { inputId: candidate.inputId, inputRevision: candidate.inputRevision };
}

/**
 * Custom message entry for extensions to inject messages into LLM context.
 * Use customType to identify your extension's entries.
 *
 * Unlike CustomEntry, this DOES participate in LLM context.
 * The content participates in LLM context through convertToLlm().
 * Use details for extension-specific metadata (not sent to LLM).
 *
 * display controls TUI rendering:
 * - false: hidden entirely
 * - true: rendered with distinct styling (different from user messages)
 */
export interface CustomMessageEntry<T = unknown> extends SessionEntryBase {
	type: "custom_message";
	customType: string;
	content: string | UserContent[];
	details?: T;
	display: boolean;
	/** Who initiated this message for billing/attribution semantics. */
	attribution?: MessageAttribution;
	/** Queue delivery identity. Internal control data; never extension metadata. */
	durableDelivery?: DurableDeliveryIdentity;
}

/** Session entry - has id/parentId for persisted journal entries (tree entries plus metadata entries). */
export type SessionEntry =
	| SessionMessageEntry
	| ThinkingLevelChangeEntry
	| ModelChangeEntry
	| ServiceTierChangeEntry
	| CompactionEntry
	| BranchSummaryEntry
	| LeafChangeEntry
	| CustomEntry
	| CustomMessageEntry
	| LabelEntry
	| TtsrInjectionEntry
	| MCPToolSelectionEntry
	| SessionInitEntry
	| ModeChangeEntry
	| WorkflowChangeEntry;

/** Raw file entry (includes header) */
export type FileEntry = SessionHeader | SessionEntry;

/** Tree node for getTree() - defensive copy of session structure */
export interface SessionTreeNode {
	entry: SessionEntry;
	children: SessionTreeNode[];
	/** Resolved label for this entry, if any */
	label?: string;
}

export interface UsageStatistics {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	premiumRequests: number;
	cost: number;
}
