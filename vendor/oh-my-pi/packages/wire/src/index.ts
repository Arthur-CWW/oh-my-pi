/**
 * Shared wire types for the omp collab live-session protocol.
 *
 * Dependency-free JSON shapes produced by `@oh-my-pi/pi-coding-agent`
 * (`src/collab/protocol.ts` and friends). Browser and test clients import this
 * package instead of depending on the coding-agent runtime; conformance is
 * asserted type-only in `packages/coding-agent/test/collab/web-wire.types.ts`.
 *
 * Unknown entry/event variants arrive over the wire as plain JSON. The unions
 * below cover only the variants this client renders; consumers cast at the
 * JSON boundary and every `switch` keeps a tolerant `default:` branch.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Content blocks
// ═══════════════════════════════════════════════════════════════════════════

export interface TextContent {
	type: "text";
	text: string;
}

export interface ImageContent {
	type: "image";
	/** Base64-encoded image data. */
	data: string;
	/** e.g. "image/png". */
	mimeType: string;
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
}

export interface RedactedThinkingContent {
	type: "redactedThinking";
	data: string;
}

export interface ToolCallContent {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	intent?: string;
}

export type AssistantContent = TextContent | ThinkingContent | RedactedThinkingContent | ToolCallContent;

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface WireUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: { total: number };
}

// ═══════════════════════════════════════════════════════════════════════════
// Messages
// ═══════════════════════════════════════════════════════════════════════════

export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	/** True if the message was injected by the system (e.g. auto-continue). */
	synthetic?: boolean;
	/** Unix timestamp in milliseconds. */
	timestamp: number;
}

export interface DeveloperMessage {
	role: "developer";
	content: string | (TextContent | ImageContent)[];
	timestamp: number;
}

export interface AssistantMessage {
	role: "assistant";
	content: AssistantContent[];
	model: string;
	usage: WireUsage;
	stopReason: StopReason;
	errorMessage?: string;
	timestamp: number;
}

export interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[];
	details?: unknown;
	isError: boolean;
	timestamp: number;
}

export type WireMessage = UserMessage | DeveloperMessage | AssistantMessage | ToolResultMessage;

// ═══════════════════════════════════════════════════════════════════════════
// Session entries (rendered subset; cast `as SessionEntry` at the JSON
// boundary and skip unknown `type`s in a tolerant `default:`)
// ═══════════════════════════════════════════════════════════════════════════

export interface SessionHeader {
	type: "session";
	id: string;
	title?: string;
	timestamp: string;
	cwd: string;
}

export interface EntryBase {
	id: string;
	parentId: string | null;
	timestamp: string;
}

export interface MessageEntry extends EntryBase {
	type: "message";
	message: WireMessage;
}

export interface CustomMessageEntry extends EntryBase {
	type: "custom_message";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	details?: unknown;
	display: boolean;
}

export interface CompactionEntry extends EntryBase {
	type: "compaction";
	summary: string;
	shortSummary?: string;
	firstKeptEntryId: string;
	tokensBefore: number;
}

export interface BranchSummaryEntry extends EntryBase {
	type: "branch_summary";
	fromId: string;
	summary: string;
}

export interface ModelChangeEntry extends EntryBase {
	type: "model_change";
	/** Model in "provider/modelId" format. */
	model: string;
	role?: string;
}

export interface ThinkingLevelChangeEntry extends EntryBase {
	type: "thinking_level_change";
	thinkingLevel?: string | null;
}

export type SessionEntry =
	| MessageEntry
	| CustomMessageEntry
	| CompactionEntry
	| BranchSummaryEntry
	| ModelChangeEntry
	| ThinkingLevelChangeEntry;

/** customType of collab guest prompts injected on the host. */
export const COLLAB_PROMPT_MESSAGE_TYPE = "collab-prompt";

/** `details` shape of `custom_message` entries with `customType === "collab-prompt"`. */
export interface CollabPromptDetails {
	from?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Events (handled subset)
// ═══════════════════════════════════════════════════════════════════════════

export type AgentEvent =
	| { type: "agent_start" }
	| { type: "agent_end" }
	| { type: "turn_start" }
	| { type: "turn_end" }
	| { type: "message_start"; message: WireMessage }
	/** Carries the FULL accumulating partial message — no delta tracking needed. */
	| { type: "message_update"; message: WireMessage }
	| { type: "message_end"; message: WireMessage }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown; intent?: string }
	| { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
	| { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError?: boolean }
	| { type: "notice"; level: "info" | "warning" | "error"; message: string; source?: string }
	| { type: "auto_compaction_start"; reason: string; action: string }
	| { type: "auto_compaction_end"; aborted: boolean; willRetry: boolean; errorMessage?: string; skipped?: boolean }
	| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
	| { type: "thinking_level_changed"; thinkingLevel?: string };

// ═══════════════════════════════════════════════════════════════════════════
// State & agents
// ═══════════════════════════════════════════════════════════════════════════

export interface WireModel {
	id: string;
	name: string;
	provider: string;
	contextWindow: number | null;
}

export interface ContextUsage {
	tokens: number | null;
	contextWindow: number | null;
	percent: number | null;
}

export interface Participant {
	name: string;
	role: "host" | "guest";
	/** True when the guest joined through a read-only (view) link. */
	readOnly?: boolean;
}

/** Debounced footer snapshot broadcast by the host. */
export interface SessionState {
	isStreaming: boolean;
	queuedMessageCount: number;
	sessionName?: string;
	/** Host cwd — display only; the guest never chdirs. */
	cwd: string;
	model?: WireModel;
	thinkingLevel?: string;
	contextUsage?: ContextUsage;
	participants: Participant[];
	isAborting?: boolean;
}

export type AgentOperationAction = "reconcile" | "retry" | "cancel" | "inspect";

export interface AgentActivity {
	kind: string;
	fromId?: string;
	toId?: string;
	at?: number;
}

export interface AgentRecovery {
	state: string;
	reason?: string;
	attempt?: number;
	task?: string;
	model?: string;
	thinkingLevel?: string | null;
	hotswapModel?: string;
}

export interface AgentQuota {
	originalProvider?: string;
	routedProvider?: string;
	originalModel?: string;
	routedModel?: string;
	ratePerHour?: number;
	projectedEmptyAt?: number;
	resetAt?: number;
	deficitPerHour?: number;
	decisionReason?: string;
	quotaPoolId?: string;
	limitWindowId?: string;
}

export interface AgentOperation {
	inputId?: string;
	state: "blocked" | "uncertain" | "retrying";
	resetAt?: number;
	reason?: string;
	supportedActions: readonly AgentOperationAction[];
}

export interface AgentSnapshot {
	id: string;
	displayName: string;
	kind: "main" | "sub";
	parentId?: string;
	/** Stable owning tree root, derived from parentId; omitted by older hosts. */
	group?: string;
	status: "running" | "idle" | "parked" | "aborted";
	/** Whether the host has a transcript file for this agent (gates remote transcript fetch). */
	hasSessionFile: boolean;
	createdAt: number;
	lastActivity: number;
	/** Stable registration order; lower values appeared first. */
	spawnIndex?: number;
	/** Work-aware display metadata; omitted by older hosts. */
	activity?: AgentActivity;
	/** Durable restart recovery metadata; omitted when not recovering. */
	recovery?: AgentRecovery;
	/** Admission/quota decision metadata; omitted when no quota decision exists. */
	quota?: AgentQuota;
	/** Only present when the host can safely operate on a real durable condition. */
	operation?: AgentOperation;
}

// ═══════════════════════════════════════════════════════════════════════════
// Bus payloads (task subagent lifecycle/progress channels)
// ═══════════════════════════════════════════════════════════════════════════

export interface AgentProgress {
	index: number;
	id: string;
	agent: string;
	status: "pending" | "running" | "completed" | "failed" | "aborted";
	task: string;
	description?: string;
	lastIntent?: string;
	currentTool?: string;
	currentToolArgs?: string;
	currentToolStartMs?: number;
	recentTools: { tool: string; args: string; endMs: number }[];
	recentOutput: string[];
	toolCount: number;
	requests: number;
	tokens: number;
	contextTokens?: number;
	contextWindow?: number;
	cost: number;
	durationMs: number;
	resolvedModel?: string;
}

export interface SubagentProgressPayload {
	index: number;
	agent: string;
	task: string;
	parentToolCallId?: string;
	assignment?: string;
	progress: AgentProgress;
	sessionFile?: string;
}

export interface SubagentLifecyclePayload {
	id: string;
	agent: string;
	description?: string;
	status: "started" | "completed" | "failed" | "aborted";
	sessionFile?: string;
	parentToolCallId?: string;
	index: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Collaboration protocol v2
// ═══════════════════════════════════════════════════════════════════════════

export const COLLAB_PROTO = 2 as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];
export type CollabCapability = "observer" | "controller";
export type CollabDirection = "guestToHost" | "hostToGuest";

/** Sent in plaintext by the host. It contains fresh entropy, but no secret. */
export interface CollabChallengeFrame {
	readonly t: "challenge";
	readonly proto: typeof COLLAB_PROTO;
	readonly challengeId: string;
	readonly challenge: string;
}

/** First authenticated guest payload. A challenge is valid for one attach only. */
export interface CollabAttachFrame {
	readonly t: "attach";
	readonly proto: typeof COLLAB_PROTO;
	readonly clientId: string;
	readonly viewId: string;
	readonly requestedCapability: CollabCapability;
	readonly writeToken?: string;
	readonly challengeId: string;
	readonly challengeResponse: string;
	readonly afterSequence?: number;
}

/** JSON-only runner projection. Live runner objects must never cross this boundary. */
export interface CollabRunnerSnapshot {
	readonly revision: number;
	readonly runnerSequence: number;
	readonly sessionRevision: number;
	readonly transcript: JsonValue;
	readonly durableInputs: readonly JsonValue[];
	readonly activeOperations: readonly JsonValue[];
	readonly workflow: JsonValue;
	readonly tools: JsonValue;
	readonly todos: JsonValue;
	readonly model: JsonValue;
	readonly session: JsonValue;
}

export interface CollabRunnerEventDelivery {
	readonly kind: "event";
	readonly event: JsonValue;
}

export type GuestFrame =
	| CollabAttachFrame
	| { readonly t: "command"; readonly requestId: string; readonly command: JsonValue }
	| { readonly t: "acquireController"; readonly requestId: string }
	| { readonly t: "releaseController"; readonly requestId: string; readonly controllerEpoch: number }
	| { readonly t: "detach" }
	| { readonly t: "resyncRequest"; readonly afterSequence: number };

export type HostFrame =
	| {
			readonly t: "welcome";
			readonly connectionId: string;
			readonly viewId: string;
			readonly capability: CollabCapability;
			readonly controllerEpoch?: number;
			readonly snapshot: CollabRunnerSnapshot;
			readonly sequence: number;
	  }
	| { readonly t: "delta"; readonly delivery: CollabRunnerEventDelivery }
	| {
			readonly t: "resync";
			readonly snapshot: CollabRunnerSnapshot;
			readonly expectedSequence: number;
			readonly observedSequence: number;
	  }
	| {
			readonly t: "commandResult";
			readonly requestId: string;
			readonly ok: boolean;
			readonly receipt?: JsonValue;
			readonly error?: { readonly code: string; readonly message: string };
	  }
	| { readonly t: "controllerChanged"; readonly capability: CollabCapability; readonly controllerEpoch?: number }
	| { readonly t: "bye"; readonly reason: string }
	| { readonly t: "error"; readonly code: string; readonly message: string; readonly requestId?: string };

export type CollabApplicationFrame = GuestFrame | HostFrame;

/** Authenticated plaintext. Routing metadata is duplicated as AES-GCM AAD. */
export interface SecureCollabFrame {
	readonly proto: typeof COLLAB_PROTO;
	readonly connectionId: string;
	readonly direction: CollabDirection;
	readonly sequence: number;
	readonly frame: CollabApplicationFrame;
}

export type WireFrame = CollabChallengeFrame | SecureCollabFrame;

// ═══════════════════════════════════════════════════════════════════════════
// Envelope & link constants
// ═══════════════════════════════════════════════════════════════════════════

/** Plaintext envelope prefix: `[4B uint32 BE peerId][sealed payload]`. */
export const ENVELOPE_HEADER_LENGTH = 4;

export const ROOM_ID_BYTES = 16;

/** AES-256-GCM room key; the seal key for every collab frame. */
export const ROOM_KEY_BYTES = 32;

/**
 * Random write token appended to the room key in full links
 * (`base64url(key ∥ token)`); view links carry the bare key. Possession
 * proves prompt/abort/agent-cmd capability to the host.
 */
export const WRITE_TOKEN_BYTES = 16;

/** Default public relay; bare `<roomId>.<key>` links resolve against it. */
export const DEFAULT_RELAY_URL = "wss://my.omp.sh";

/** Default share viewer/upload base; `/share` links resolve against `<base>/<id>#<key>`. */
export const DEFAULT_SHARE_URL = "https://my.omp.sh/s";

export interface ParsedCollabLink {
	/** wss://host[:port]/r/<roomId> — no query, no fragment. */
	wsUrl: string;
	roomId: string;
	key: Uint8Array;
	/** Write token from a full link; absent for read-only (view) links. */
	writeToken?: Uint8Array;
}

// ═══════════════════════════════════════════════════════════════════════════
// Relay control messages (TEXT JSON, unencrypted, no session data)
// ═══════════════════════════════════════════════════════════════════════════

/** Relay → host control message. */
export type RelayControlToHost = { t: "peer-joined" | "peer-left"; peer: number };
/** Relay → guest control message. */
export type RelayControlToGuest = { t: "room-closed" };
export type RelayControlMessage = RelayControlToHost | RelayControlToGuest;
