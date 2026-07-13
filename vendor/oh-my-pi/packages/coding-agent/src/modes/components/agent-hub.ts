/**
 * Agent Hub overlay component.
 *
 * One overlay, two views:
 * - Table view: every registered agent except Main (Main IS the ambient
 *   chat), live from the global AgentRegistry — status, unread irc count,
 *   current/last task, last activity. Select with j/k; Enter focuses live agents
 *   and opens parked agents read-only; `r` revives a parked agent, `x` aborts +
 *   releases one.
 * - Chat view: per-agent transcript (incremental session-file tail, absorbed
 *   from the old session observer overlay) plus an input line. `R` revives the
 *   parked agent explicitly; submitting a message also revives a parked agent,
 *   then lands in the agent's persisted history via the normal prompt path.
 *
 * Replaces the old SessionObserverOverlayComponent (ctrl+s observer).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage, AgentTool } from "@oh-my-pi/pi-agent-core";
import type { Usage } from "@oh-my-pi/pi-ai";
import { Container, Editor, matchesKey, padding, ScrollView, Text, type TUI, visibleWidth } from "@oh-my-pi/pi-tui";
import { formatAge, formatBytes, formatDuration, formatNumber, getProjectDir, logger } from "@oh-my-pi/pi-utils";
import type { AdvisorMessageDetails } from "../../advisor";
import { COLLAB_PROMPT_MESSAGE_TYPE } from "../../collab/protocol";
import type { CollabPromptDetails } from "../collab-presentation-types";
import type { KeyId } from "../../config/keybindings";
import { settings } from "../../config/settings";
import type { MessageRenderer } from "../../extensibility/extensions/types";
import { IrcBus } from "../../irc/bus";
import {
	IRC_EXTERNAL_STALE_MS,
	IrcExternalBus,
	type IrcExternalPeer,
	type IrcExternalPeerState,
	isIrcExternalPeerFresh,
} from "../../irc/bus-external";
import { watchSiblingTranscript } from "../../irc/sibling-session";
import { AgentLifecycleManager } from "../../registry/agent-lifecycle";
import {
	type AgentRef,
	AgentRegistry,
	type AgentStatus,
	MAIN_AGENT_ID,
	type RegistryEvent,
} from "../../registry/agent-registry";
import { decodeJournalEntries, JOURNAL_TAIL_BYTES, readJournalTailChunk } from "../../journal/projection";
import { listArchivedDirectChildren, type ArchivedDirectChildDescriptor } from "../../internal-urls/history-protocol";
import type { AgentSession } from "../../session/agent-session";
import {
	BACKGROUND_TAN_DISPATCH_MESSAGE_TYPE,
	type CustomMessage,
	isSilentAbort,
	LSP_LATE_DIAGNOSTIC_MESSAGE_TYPE,
	resolveAbortLabel,
	SKILL_PROMPT_MESSAGE_TYPE,
	type SkillPromptDetails,
	USER_INTERRUPT_LABEL,
} from "../../session/messages";
import type { SessionMessageEntry } from "../../session/session-entries";
import { createIrcMessageCard } from "../../tools/irc";
import { replaceTabs, shortenPath, TRUNCATE_LENGTHS, truncateToWidth } from "../../tools/render-utils";
import { canonicalizeMessage, normalizeThinkingDisplay } from "../../utils/thinking-display";
import type { ObservableSession, SessionObserverRegistry } from "../session-observer-registry";
import { getEditorTheme, theme } from "../theme/theme";
import {
	matchesAppInterrupt,
	matchesNavigationBottom,
	matchesNavigationDown,
	matchesNavigationPageDown,
	matchesNavigationPageUp,
	matchesNavigationTop,
	matchesNavigationUp,
	matchesSelectDown,
	matchesSelectUp,
} from "../utils/keybinding-matchers";
import { createAdvisorMessageCard } from "./advisor-message";
import {
	agentHistoryRank,
	cycleVisibleAgentSibling,
	expandAgentAncestors,
	isHistoricalAgent,
	projectAgentRoster,
} from "./agent-hub-roster";
import { AssistantMessageComponent } from "./assistant-message";
import { createBackgroundTanDispatchBlock } from "./background-tan-message";
import { BashExecutionComponent } from "./bash-execution";
import { BranchSummaryMessageComponent } from "./branch-summary-message";
import { CollabPromptMessageComponent } from "./collab-prompt-message";
import { CompactionSummaryMessageComponent, createHandoffSummaryMessageComponent } from "./compaction-summary-message";
import { CustomMessageComponent } from "./custom-message";
import { DynamicBorder } from "./dynamic-border";
import { EvalExecutionComponent } from "./eval-execution";
import { type LateDiagnosticsFile, LateDiagnosticsMessageComponent } from "./late-diagnostics-message";
import { ReadToolGroupComponent, readArgsHaveTarget, readArgsTargetInternalUrl } from "./read-tool-group";
import { SkillMessageComponent } from "./skill-message";
import { formatContextUsage } from "./status-line/context-thresholds";
import { calculateTokensPerSecond } from "./status-line/token-rate";
import { ToolExecutionComponent } from "./tool-execution";
import { TranscriptBlock, TranscriptContainer } from "./transcript-container";
import { createUsageRowBlock } from "./usage-row";
import { UserMessageComponent } from "./user-message";

/** Lines per page for PageUp/PageDown */
const PAGE_SIZE = 15;
/** Refresh cadence for the relative-time column */
const AGE_TICK_MS = 5_000;
/** Debounce for live-session transcript refreshes */
const CHAT_REFRESH_DEBOUNCE_MS = 80;
/** Double-tap window for the left-left "go to parent" gesture (matches the editor's). */
const LEFT_TAP_WINDOW_MS = 500;
/** Completed journal rows shown without an explicit archive expansion. */
const RECENT_COMPLETED_LIMIT = 20;
/** Maximum bytes retained while glancing at a transcript in the cockpit. */
const PREVIEW_TAIL_BYTES = JOURNAL_TAIL_BYTES;
/** Maximum parsed message entries retained for the selected preview. */
const PREVIEW_MAX_ENTRIES = 200;
/** Wide cockpit breakpoint: two independently scrollable 80-column lanes. */
const DUAL_LANE_MIN_WIDTH = 160;
/** Smallest useful inspector/transcript track when narrow cockpits stack them. */
const STACKED_LANE_MIN_HEIGHT = 6;
/** Bounded roster strip left below the full-height cockpit preview. */
const ROSTER_STRIP_HEIGHT = 9;
/** Hub title and footer chrome outside the preview and roster tracks. */
const HUB_CHROME_HEIGHT = 6;
const INSPECTOR_PROMPT_MAX_CHARS = 32 * 1024;
const INSPECTOR_DELIVERY_LIMIT = 20;

/** Compute the max content width for the current terminal, accounting for chrome. */
function contentWidth(): number {
	return Math.max(TRUNCATE_LENGTHS.SHORT, (process.stdout.columns || 80) - 6);
}

/** Sanitize a line for TUI display: replace tabs, then truncate to viewport width. */
function sanitizeLine(text: string, maxWidth?: number): string {
	return truncateToWidth(replaceTabs(text), maxWidth ?? contentWidth());
}

/** Compact glyph + state label, colored per theme status conventions. */
function statusBadge(status: AgentStatus): string {
	switch (status) {
		case "running":
			return theme.fg("accent", "● RUN");
		case "idle":
			return theme.fg("success", "○ IDLE");
		case "parked":
			return theme.fg("muted", "■ PARK");
		case "aborted":
			return theme.fg("error", "× ABRT");
	}
}

export type AgentHubExternalPeerState = IrcExternalPeerState;
type AgentHubExternalPeerDisplayState = AgentHubExternalPeerState | "disconnected";

/** Hub-side peer view: tolerates rows from older bus versions that lack state columns. */
export type AgentHubExternalPeer = Omit<IrcExternalPeer, "state" | "stateTs"> & {
	state?: AgentHubExternalPeerState | null;
	stateTs?: string | null;
};

export interface AgentHubExternalPeerDataSource {
	listPeers(options?: { excludeSessionId?: string; staleMs?: number; includeStale?: boolean }): AgentHubExternalPeer[];
	sendMessage?(args: { fromPeer: string; toPeer: string; body: string; origin?: "agent" | "user" }): number;
}

interface ExternalPeerRow {
	peer: AgentHubExternalPeer;
	displayIndex: number;
	state: AgentHubExternalPeerDisplayState;
}

/** A selectable local agent row; archived children never become registry refs. */
type HubAgentRow = { kind: "active"; ref: AgentRef } | { kind: "archived"; descriptor: ArchivedDirectChildDescriptor };

function externalIrcDbPath(): string {
	return path.join(os.homedir(), ".omp", "agent", "irc-bus.sqlite");
}

function parseTimestampMs(value: string): number | undefined {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function formatLastSeenAge(lastSeen: string): string {
	const parsed = parseTimestampMs(lastSeen);
	if (parsed === undefined) return "unknown age";
	return formatAge(Math.max(1, Math.round((Date.now() - parsed) / 1000)));
}

function externalStateBadge(state: AgentHubExternalPeerDisplayState): string {
	switch (state) {
		case "working":
			return theme.fg("accent", "● WORK");
		case "waiting_input":
			return theme.fg("warning", "◌ WAIT");
		case "idle":
			return theme.fg("success", "○ IDLE");
		case "disconnected":
			return theme.fg("muted", "× DISC");
		case "unknown":
			return theme.fg("muted", "· UNKN");
	}
}

function normalizeExternalPeerState(state: AgentHubExternalPeer["state"]): AgentHubExternalPeerState {
	switch (state) {
		case "working":
		case "waiting_input":
		case "idle":
		case "unknown":
			return state;
		default:
			return "unknown";
	}
}

function displayedExternalPeerState(peer: AgentHubExternalPeer): AgentHubExternalPeerDisplayState {
	return isIrcExternalPeerFresh(peer.lastSeen) ? normalizeExternalPeerState(peer.state) : "disconnected";
}

interface ResolvedModelParts {
	provider: string | undefined;
	id: string;
	thinking: string | undefined;
	raw: string;
}

const SUBSCRIPTION_MODEL_PROVIDERS = new Set(["kimi-code", "openai-codex", "google-antigravity"]);

const MODEL_ABBREVIATIONS: Record<string, string> = {
	"openai-codex/gpt-5.5": "GPT-5.5",
	"kimi-code/kimi-for-coding": "KimiCode",
	"deepseek/deepseek-v4-pro": "DS V4 Pro",
	"google-antigravity/gemini-3.5-flash": "Gem3.5F",
};

/** Compact provider codes so the model id survives narrow lanes ("anthropic/claude-…" → "ant/claude-…"). */
const PROVIDER_SHORT_NAMES: Record<string, string> = {
	anthropic: "AN",
	openai: "OA",
	"openai-codex": "OX",
	google: "GO",
	"google-antigravity": "GM",
	deepseek: "DS",
	"kimi-code": "KM",
	openrouter: "OR",
	mistral: "MI",
};

function shortProviderName(provider: string): string {
	return PROVIDER_SHORT_NAMES[provider] ?? provider.slice(0, 2).toUpperCase();
}

function splitThinkingSuffix(value: string): { id: string; thinking: string | undefined } {
	const suffixStart = value.lastIndexOf(":");
	if (suffixStart <= 0 || suffixStart === value.length - 1) return { id: value, thinking: undefined };
	return { id: value.slice(0, suffixStart), thinking: value.slice(suffixStart + 1) };
}

function parseResolvedModel(resolvedModel: string): ResolvedModelParts {
	const raw = replaceTabs(resolvedModel.trim());
	const providerEnd = raw.indexOf("/");
	if (providerEnd <= 0 || providerEnd === raw.length - 1) {
		const { id, thinking } = splitThinkingSuffix(raw);
		return { provider: undefined, id, thinking, raw };
	}

	const provider = raw.slice(0, providerEnd);
	const { id, thinking } = splitThinkingSuffix(raw.slice(providerEnd + 1));
	return { provider, id, thinking, raw };
}

function modelAuthBadge(provider: string | undefined): string {
	return SUBSCRIPTION_MODEL_PROVIDERS.has(provider ?? "") ? theme.fg("success", "S") : theme.fg("warning", "A");
}

const VARIANT_ALIASES: Record<string, string> = {
	terra: "Tr",
	sonnet: "So",
	luna: "Lu",
	flash: "Fl",
	pro: "Pr",
	coding: "Cd",
	opus: "Op",
	haiku: "Hk",
};

function abbreviateResolvedModel(parts: ResolvedModelParts): string {
	const modelKey = parts.provider ? `${parts.provider}/${parts.id}` : parts.id;
	const abbreviation = MODEL_ABBREVIATIONS[modelKey];
	if (abbreviation) return abbreviation;

	const id = parts.id
		.replace(/^gpt-/, "")
		.replace(/^claude-/, "")
		.toLowerCase();

	let family = "";
	for (const f of Object.keys(VARIANT_ALIASES)) {
		if (id.includes(f)) {
			family = f;
			break;
		}
	}

	const versionMatch = id.match(/(\d+)[-.](\d+)/);
	let version = "";
	if (versionMatch) {
		version = `${versionMatch[1]}.${versionMatch[2]}`;
	} else {
		const singleMatch = id.match(/\d+/);
		if (singleMatch) {
			version = singleMatch[0];
		}
	}

	if (family) {
		const alias = VARIANT_ALIASES[family];
		return version ? `${version}${alias}` : alias;
	}

	return version || parts.id;
}

function getModelLaneWidth(width: number): number {
	if (width <= 60) return 13;
	if (width <= 80) return 13;
	if (width <= 120) return 14;
	return 15;
}

function getStateLaneWidth(width: number): number {
	if (width <= 80) return 6;
	return 7;
}

const ARCHIVED_STATE_BADGES: Record<string, { shape: string; text: string; color: string }> = {
	completed: { shape: "✓", text: "DONE", color: "success" },
	failed: { shape: "×", text: "FAIL", color: "error" },
	interrupted: { shape: "~", text: "INTR", color: "warning" },
	legacy: { shape: "■", text: "LEGC", color: "muted" },
};

function formatArchivedState(state: string): string {
	const normalized = state.toLowerCase();
	const config = ARCHIVED_STATE_BADGES[normalized] ?? { shape: "■", text: "LEGC", color: "muted" };
	return theme.fg(config.color as any, `${config.shape} ${config.text}`);
}

function modelLane(resolvedModel: string, maxLabelWidth: number): string {
	const parts = parseResolvedModel(resolvedModel);
	const provider = parts.provider ? shortProviderName(parts.provider) : "";
	const sOrA = modelAuthBadge(parts.provider);
	let variant = abbreviateResolvedModel(parts).replace(/\s+/g, "");

	let effort = "";
	if (parts.thinking) {
		const eff = parts.thinking.toLowerCase();
		if (eff === "low" || eff === "l") effort = "l";
		else if (eff === "medium" || eff === "m") effort = "m";
		else if (eff === "high" || eff === "h") effort = "h";
	}

	const hasProvider = provider.length > 0;
	const hasEffort = effort.length > 0;
	const textWidth = maxLabelWidth - 1;
	const overhead = 2 + (hasProvider ? 3 : 0) + (hasEffort ? 2 : 0);
	const available = Math.max(1, textWidth - overhead);
	const truncatedVariant = truncateToWidth(variant, available);

	let result = sOrA + " ";
	if (hasProvider) {
		result += theme.fg("dim", provider) + " ";
	}
	result += truncatedVariant;
	if (hasEffort) {
		result += " " + theme.fg("dim", effort);
	}
	const truncatedResult = truncateToWidth(result, textWidth);
	return truncatedResult + padding(Math.max(0, textWidth - visibleWidth(truncatedResult))) + " ";
}

function modelHeaderLane(resolvedModel: string): string {
	const parts = parseResolvedModel(resolvedModel);
	const abbreviated = abbreviateResolvedModel(parts);
	const lane = `${modelAuthBadge(parts.provider)} ${abbreviated}`;
	if (parts.raw === abbreviated) return lane;
	return `${lane} ${theme.fg("dim", `(${parts.raw})`)}`;
}

function fixedLane(value: string, width: number): string {
	const truncated = truncateToWidth(replaceTabs(value), width);
	return truncated + padding(Math.max(0, width - visibleWidth(truncated)));
}

function fixedLaneWithSeparator(value: string, width: number): string {
	const truncated = truncateToWidth(replaceTabs(value), width - 1);
	return truncated + padding(Math.max(0, width - 1 - visibleWidth(truncated))) + " ";
}

function renderHubColumns(options: {
	width: number;
	model?: string;
	state: string;
	name: string;
	task?: string;
	context?: string;
	age?: string;
}): string {
	const innerWidth = Math.max(10, options.width - 3);
	const modelLaneWidth = getModelLaneWidth(options.width);
	const stateLaneWidth = getStateLaneWidth(options.width);

	const model = options.model ? modelLane(options.model, modelLaneWidth) : " ".repeat(modelLaneWidth);
	const state = fixedLaneWithSeparator(options.state, stateLaneWidth);

	const prefixWidth = modelLaneWidth + stateLaneWidth;
	const optional = [options.task, options.context, options.age].filter((value): value is string => Boolean(value));
	const available = Math.max(1, innerWidth - prefixWidth);
	let extras = optional.map(value => sanitizeLine(value, TRUNCATE_LENGTHS.TITLE));
	const COLUMN_GAP = " ";
	while (
		extras.length > 0 &&
		extras.reduce((sum, value) => sum + COLUMN_GAP.length + visibleWidth(value), 0) > Math.max(0, available - 4)
	) {
		extras.shift();
	}
	const extraWidth = extras.reduce((sum, value) => sum + COLUMN_GAP.length + visibleWidth(value), 0);
	const nameWidth = Math.max(1, available - extraWidth);
	const name = fixedLane(options.name, nameWidth);
	return `${model}${state}${name}${extras.map(value => `${COLUMN_GAP}${value}`).join("")}`;
}

/** Guest-side proxy for hub actions executed on the collab host. */
export interface AgentHubRemote {
	chat(id: string, text: string): void;
	kill(id: string): void;
	revive(id: string): void;
	/** Mirrors readFileIncremental: text from fromByte (complete JSONL lines), newSize = next fromByte base; null = unavailable. */
	readTranscript(id: string, fromByte: number): Promise<{ text: string; newSize: number } | null>;
}

/** Typed admission projection supplied by the queue owner; never inferred from transcript text. */
export interface AgentHubTurnStatus {
	inputId: string;
	state: "queued" | "admitted" | "running" | "completed" | "failed-rate-limit" | "cancelled";
	resetAt?: number;
	reroutedProvider?: string;
	originalModel?: string;
	reroutedModel?: string;
	canCancel: boolean;
	/** Shared quota-pool telemetry for display only; scheduling stays with the queue owner. */
	ratePerHour?: number;
	projectedEmptyAt?: number;
	deficitPerHour?: number;
	provider?: string;
	decisionReason?: string;
	quotaPoolId?: string;
	limitWindowId?: string;
}

export interface AgentHubDeps {
	/** Progress/status snapshot source (task lifecycle + progress channels). */
	observers: SessionObserverRegistry;
	/** Keys that toggle the hub closed from inside (app.agents.hub + app.session.observe). */
	hubKeys: KeyId[];
	onDone: () => void;
	requestRender: () => void;
	/** Injectable for tests; defaults to the process-global registry. */
	registry?: AgentRegistry;
	/** Injectable for tests; defaults to the process-global lifecycle manager. */
	lifecycle?: AgentLifecycleManager;
	/** Injectable for tests; defaults to the process-global bus. */
	irc?: IrcBus;
	/** TUI handle for transcript components; tests omit it and get a render-only stub. */
	ui?: TUI;
	/** Tool lookup for transcript renderers (labels, custom render functions). */
	getTool?: (name: string) => AgentTool | undefined;
	/** Extension message renderers for custom messages in the transcript. */
	getMessageRenderer?: (customType: string) => MessageRenderer | undefined;
	/** Cwd used by tool renderers for path shortening; defaults to the project dir. */
	cwd?: string;
	/** Mirrors the main transcript's thinking-block visibility. */
	hideThinkingBlock?: () => boolean;
	/** Keys toggling tool output expansion (app.tools.expand). */
	expandKeys?: KeyId[];
	/** Focus the main view on this agent's live session (ctx.focusAgentSession). When absent (collab guest, tests), Enter opens the in-hub chat view instead. */
	focusAgent?: (id: string) => Promise<void>;
	/** Agent currently attached in the main view; the cockpit opens with this row selected. */
	initialAgentId?: string;
	/** Collab guest: route actions/transcripts to the host instead of local sessions. */
	remote?: AgentHubRemote;
	/** Queue/admission projection for the selected agent, if the host exposes one. */
	turnStatus?: (agentId: string) => AgentHubTurnStatus | undefined;
	/** Cross-session IRC bus reader for sibling OMP instances; null disables it for deterministic tests. */
	externalIrc?: AgentHubExternalPeerDataSource | null;
	/** Current external IRC session id; defaults to the session registration convention `${cwd}:${pid}`. */
	externalSessionId?: string;
	/** Legacy construction field; archive discovery always uses Main's current sessionFile. */
	parentSessionFile?: string | null;
}

export interface AgentHubRetentionMetrics {
	/** Ordered active identities, the minimum state needed for virtual navigation. */
	activeIdentities: number;
	/** Lowercased filter buffers; retained only while a table filter is active. */
	activeSearchFieldEntries: number;
	/** Observer identity index, not a rendered row buffer. */
	observerEntries: number;
	externalIdentityRows: number;
	archivedIdentityRows: number;
	/** Materialized roster rows are capped by the terminal viewport. */
	materializedRows: number;
	/** Stable-order identities retained by external-peer polling. */
	externalOrderEntries: number;
	/** Parsed journal messages retained only while a chat transcript is open. */
	cachedTranscriptEntries: number;
	/** Transcript components retained only while a chat transcript is open. */
	materializedChatComponents: number;
	/** The age interval plus an optional debounced chat refresh. */
	liveTimers: number;
}
export class AgentHubOverlayComponent extends Container {
	#registry: AgentRegistry;
	#observers: SessionObserverRegistry;
	#irc: IrcBus;
	#externalBus: AgentHubExternalPeerDataSource | null | undefined;
	#externalSessionId: string;
	#lifecycle: () => AgentLifecycleManager;
	#onDone: () => void;
	#requestRender: () => void;
	#hubKeys: KeyId[];
	#unsubscribers: Array<() => void> = [];
	#ageTimer: NodeJS.Timeout | undefined;
	#projectionTimer: NodeJS.Timeout | undefined;
	#pendingRegistryEvents: RegistryEvent[] = [];
	#registryRefs = new Map<string, AgentRef>();
	#refsByStatus: Record<AgentStatus, Map<string, AgentRef>> = {
		running: new Map(),
		idle: new Map(),
		parked: new Map(),
		aborted: new Map(),
	};
	#remote: AgentHubRemote | undefined;
	#turnStatus: ((agentId: string) => AgentHubTurnStatus | undefined) | undefined;
	#remoteFetchInFlight = false;
	/** Invalidates stale in-flight fetch callbacks after openChat resets the cache. */
	#remoteFetchToken = 0;
	#remoteTranscriptUnavailable = false;

	// Table state
	#view: "table" | "chat" = "table";
	#rows: AgentRef[] = [];
	/** Lowercased immutable-at-invalidation search field for each ordered active ref. */
	#activeSearchFields = new Map<string, string>();
	#registryGeneration = 0;
	#orderedRegistryGeneration = -1;
	#observerById = new Map<string, ObservableSession>();
	#externalRows: ExternalPeerRow[] = [];
	#externalOrder = new Map<string, number>();
	#nextExternalDisplayIndex = 0;
	#selectedRow = 0;
	#selectedAgentKey: string | undefined;
	#tableScrollOffset = 0;
	/** Modal cockpit state: scroll is the default; input forwards text to the selected agent. */
	#cockpitMode: "scroll" | "input" = "scroll";
	#cockpitPreview = true;
	#previewRenderedHeight = 0;
	#showTerminalAgents = false;
	#showHistoricalAgents = true;
	#hiddenTerminalCount = 0;
	#statusCounts: Record<AgentStatus, number> = { running: 0, idle: 0, parked: 0, aborted: 0 };
	#sectionStarts: Array<{ index: number; label: string }> = [];
	#notice: string | undefined;
	// Table roster filter (/ key)
	#tableFilterQuery = "";
	#tableFilterEditing = false;
	/** Filtered identities, not eagerly-built row objects; rows materialize at the viewport only. */
	#visibleActiveRows: readonly AgentRef[] = [];
	#visibleArchivedRows: readonly ArchivedDirectChildDescriptor[] = [];
	#visibleExternalRows: readonly ExternalPeerRow[] = [];
	#filterDirty = true;
	#searchFieldsDirty = true;
	#archivedRows: readonly ArchivedDirectChildDescriptor[] = [];
	#archivedLoadToken = 0;
	#archiveSourceSessionFile: string | undefined;

	#foldedAgentIds = new Set<string>();
	#treeDepthById = new Map<string, number>();
	#treeGuideById = new Map<string, string>();
	#hiddenDescendantsById = new Map<string, number>();
	#hiddenRunningById = new Map<string, number>();
	#groupStartIndexes: number[] = [];
	/** Vim `g` prefix is scoped to the table so a lone `g` never jumps. */
	#tableGotoPrefixActive = false;
	#showLegend = false;
	// Chat state
	#chatAgentId: string | undefined;
	#chatArchived: ArchivedDirectChildDescriptor | undefined;
	#chatExternal: AgentHubExternalPeer | undefined;
	#externalInputActive = false;
	#siblingWatchDispose: (() => void) | undefined;
	#editor: Editor;
	#sessionUnsubscribe: (() => void) | undefined;
	#attachedSession: AgentSession | undefined;
	#chatRefreshTimer: NodeJS.Timeout | undefined;
	#transcriptCache:
		| {
				path: string;
				bytesRead: number;
				entries: SessionMessageEntry[];
				model?: string;
				thinking?: string;
		  }
		| undefined;

	// Chat transcript: the same component renderers as the main session
	// transcript, assembled incrementally from the persisted JSONL entries.
	#ui: TUI;
	#getTool: ((name: string) => AgentTool | undefined) | undefined;
	#getMessageRenderer: ((customType: string) => MessageRenderer | undefined) | undefined;
	#cwd: string;
	#hideThinkingBlock: (() => boolean) | undefined;
	#expandKeys: KeyId[];
	#focusAgent: ((id: string) => Promise<void>) | undefined;
	#chatLog = new TranscriptContainer();
	#chatEntriesRef: SessionMessageEntry[] | undefined;
	#chatBuiltCount = 0;
	#chatPendingTools = new Map<string, ToolExecutionComponent | ReadToolGroupComponent>();
	#chatReadArgs = new Map<string, Record<string, unknown>>();
	#chatReadGroup: ReadToolGroupComponent | null = null;
	#pendingUsage: Usage | undefined;
	#chatWaitingPoll: ToolExecutionComponent | null = null;
	#chatExpandables: Array<{ setExpanded(expanded: boolean): void }> = [];
	#chatExpanded = false;
	#plainPreview = false;
	#chatPlaceholder: string | undefined;
	// Chat transcript search (/ key in chat view)
	#chatSearchQuery = "";
	#chatSearchEditing = false;
	#chatSearchMatches: number[] = [];
	#chatSearchMatchIndex = -1;
	#chatRenderedContent: readonly string[] = [];

	// Viewport state
	#scrollOffset = 0;
	#lastMaxScroll = 0;
	#viewportHeight = 20;
	#wasAtBottom = true;
	#inspectorSection: "prompt" | "route" | "comms" = "prompt";
	#inspectorFocused = false;
	#inspectorScrollOffset = 0;
	#inspectorLastMaxScroll = 0;
	#dualLaneActive = false;

	#detailPrefixActive = false;
	/** Vim `g` prefix is scoped to transcript navigation and only armed outside the editor. */
	#viewerGotoPrefixActive = false;
	#viewerHeaderLines: string[] = [];
	#lastLeftTap = 0;

	constructor(deps: AgentHubDeps) {
		super();
		this.#registry = deps.registry ?? AgentRegistry.global();
		this.#observers = deps.observers;
		this.#irc = deps.irc ?? IrcBus.global();
		// Lazy: the lifecycle global self-constructs against the global
		// registry, so only touch it when revive/kill actually needs it.
		this.#lifecycle = () => deps.lifecycle ?? AgentLifecycleManager.global();
		this.#onDone = deps.onDone;
		this.#requestRender = deps.requestRender;
		this.#hubKeys = deps.hubKeys;
		this.#remote = deps.remote;
		this.#turnStatus = deps.turnStatus;
		this.#ui =
			deps.ui ??
			({
				requestRender: () => deps.requestRender(),
				requestComponentRender: () => deps.requestRender(),
			} as unknown as TUI);
		this.#getTool = deps.getTool;
		this.#getMessageRenderer = deps.getMessageRenderer;
		this.#cwd = deps.cwd ?? getProjectDir();
		this.#externalBus = deps.externalIrc;
		this.#externalSessionId = deps.externalSessionId ?? `${this.#cwd}:${process.pid}`;
		this.#hideThinkingBlock = deps.hideThinkingBlock;
		this.#expandKeys = deps.expandKeys ?? ["ctrl+o"];
		this.#focusAgent = deps.focusAgent;

		this.#editor = new Editor(getEditorTheme());
		this.#editor.setMaxHeight(4);
		this.#editor.onSubmit = text => this.#submitChatMessage(text);

		this.#unsubscribers.push(
			this.#registry.onChange(event => {
				this.#pendingRegistryEvents.push({ ...event, ref: { ...event.ref } });
				this.#registryGeneration++;
				this.#scheduleProjection();
			}),
		);
		this.#unsubscribers.push(
			this.#observers.onChange(() => {
				this.#rebuildObserverSnapshot();
				this.#onDataChange();
			}),
		);
		this.#ageTimer = setInterval(() => {
			// Relative ages are read at render time. Only external peers have an
			// independent snapshot that may need filter invalidation here.
			if (this.#refreshExternalRows() && this.#filterDirty) this.#applyFilter();
			if (this.#chatExternal) this.#scheduleChatRefresh();
			this.#requestRender();
		}, AGE_TICK_MS);
		this.#ageTimer.unref?.();

		this.#rebuildObserverSnapshot();
		this.#initializeRegistryProjection();
		this.#refreshRows();
		this.#loadArchivedRows();
		// Oldest active agent is first; external peers remain informational.
		if (this.#visibleActiveRows.length > 0) {
			this.#selectedRow = 0;
			this.#selectedAgentKey = this.#selectedTableKey();
			const initialIndex = deps.initialAgentId ? this.#findTableIndex(`agent:${deps.initialAgentId}`) : -1;
			if (initialIndex >= 0) {
				this.#selectedRow = initialIndex;
				this.#selectedAgentKey = `agent:${deps.initialAgentId}`;
			}
			this.#syncSelectedPreview();
		}
	}

	/** Whether the table view has no registered live or revivable agents. */
	get isEmpty(): boolean {
		this.#flushProjection();
		return this.#registryRefs.size + this.#archivedRows.length + this.#externalRows.length === 0;
	}

	getRetentionMetrics(): AgentHubRetentionMetrics {
		return {
			activeIdentities: this.#rows.length,
			activeSearchFieldEntries: this.#activeSearchFields.size,
			observerEntries: this.#observerById.size,
			externalIdentityRows: this.#externalRows.length,
			archivedIdentityRows: this.#archivedRows.length,
			materializedRows:
				this.#totalTableRows() === 0 ? 0 : Math.min(this.#totalTableRows(), this.#tableViewportCapacity()),
			externalOrderEntries: this.#externalOrder.size,
			cachedTranscriptEntries: this.#transcriptCache?.entries.length ?? 0,
			materializedChatComponents: this.#chatLog.children.length,
			liveTimers:
				Number(this.#ageTimer !== undefined) +
				Number(this.#projectionTimer !== undefined) +
				Number(this.#chatRefreshTimer !== undefined),
		};
	}

	/** Tear down every subscription and timer. Called by the overlay owner on close. */
	dispose(): void {
		for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe();
		if (this.#ageTimer) {
			clearInterval(this.#ageTimer);
			this.#ageTimer = undefined;
		}
		if (this.#projectionTimer) {
			clearTimeout(this.#projectionTimer);
			this.#projectionTimer = undefined;
		}
		if (this.#chatRefreshTimer) {
			clearTimeout(this.#chatRefreshTimer);
			this.#chatRefreshTimer = undefined;
		}
		this.#siblingWatchDispose?.();
		this.#siblingWatchDispose = undefined;
		this.#detachLiveSession();
		this.#resetChatLog();
		this.#transcriptCache = undefined;
		this.#chatRenderedContent = [];
		this.#chatSearchMatches = [];
		this.#viewerHeaderLines = [];
		this.#rows = [];
		this.#visibleActiveRows = [];
		this.#observerById.clear();
		this.#externalRows = [];
		this.#visibleExternalRows = [];
		this.#externalOrder.clear();
		this.#archivedRows = [];
		this.#visibleArchivedRows = [];
		this.#pendingRegistryEvents = [];
		this.#registryRefs.clear();
		for (const bucket of Object.values(this.#refsByStatus)) bucket.clear();
		this.#activeSearchFields.clear();
		this.#treeDepthById.clear();
		this.#hiddenDescendantsById.clear();
		this.#foldedAgentIds.clear();
		this.#groupStartIndexes = [];
		this.#sectionStarts = [];
		this.#editor.setText("");
		this.#tableFilterQuery = "";
		this.#chatSearchQuery = "";
		this.#notice = undefined;
		this.#chatAgentId = undefined;
		this.#chatArchived = undefined;
		this.#chatExternal = undefined;
		this.#selectedAgentKey = undefined;
	}

	override render(width: number): readonly string[] {
		this.#flushProjection();
		return this.#view === "table" ? this.#renderTable(width) : this.#renderChat(width);
	}

	handleInput(keyData: string): void {
		// The hub/observe keys always close the overlay (toggle semantics)
		for (const key of this.#hubKeys) {
			if (matchesKey(keyData, key)) {
				this.#onDone();
				return;
			}
		}
		if (this.#view === "table") {
			this.#handleTableInput(keyData);
		} else {
			this.#handleChatInput(keyData);
		}
	}

	/** Open the chat view for an agent id (public for table Enter and tests). */
	openChat(id: string): void {
		if (!this.#registry.get(id)) return;
		this.#view = "chat";
		this.#chatArchived = undefined;
		this.#chatAgentId = id;
		this.#chatExternal = undefined;
		this.#notice = undefined;
		this.#transcriptCache = undefined;
		this.#remoteTranscriptUnavailable = false;
		this.#remoteFetchInFlight = false;
		this.#remoteFetchToken++;
		this.#resetChatLog();
		this.#scrollOffset = 0;
		this.#wasAtBottom = true;
		this.#lastLeftTap = 0;
		this.#cockpitMode = "scroll";
		this.#editor.setText("");
		this.#attachLiveSession();
		this.#rebuildChatContent();
		this.#requestRender();
	}

	/** Open a persisted completed child transcript without registering or reviving it. */
	#openArchivedChat(row: ArchivedDirectChildDescriptor): void {
		this.#view = "chat";
		this.#detachLiveSession();
		this.#chatAgentId = row.agentId;
		this.#chatArchived = row;
		this.#chatExternal = undefined;
		this.#notice = undefined;
		this.#transcriptCache = undefined;
		this.#remoteTranscriptUnavailable = false;
		this.#remoteFetchInFlight = false;
		this.#remoteFetchToken++;
		this.#resetChatLog();
		this.#scrollOffset = 0;
		this.#wasAtBottom = true;
		this.#lastLeftTap = 0;
		this.#cockpitMode = "scroll";
		this.#editor.setText("");
		this.#rebuildChatContent();
		this.#requestRender();
	}
	#openExternalChat(peer: AgentHubExternalPeer): void {
		this.#view = "chat";
		this.#detachLiveSession();
		this.#siblingWatchDispose?.();
		this.#chatAgentId = peer.name || peer.sessionId;
		this.#chatArchived = undefined;
		this.#chatExternal = peer;
		this.#externalInputActive = false;
		this.#notice = undefined;
		this.#transcriptCache = undefined;
		this.#resetChatLog();
		this.#scrollOffset = 0;
		this.#wasAtBottom = true;
		this.#cockpitMode = "scroll";
		this.#editor.setText("");
		if (peer.sessionFile) {
			this.#siblingWatchDispose = watchSiblingTranscript(peer.sessionFile, () => this.#scheduleChatRefresh());
		}
		this.#rebuildChatContent();
		this.#requestRender();
	}

	// ========================================================================
	// Live data plumbing
	// ========================================================================

	#scheduleProjection(): void {
		if (this.#projectionTimer) return;
		this.#projectionTimer = setTimeout(() => {
			this.#projectionTimer = undefined;
			this.#flushProjection();
			this.#requestRender();
		}, 0);
		this.#projectionTimer.unref?.();
	}

	#flushProjection(): void {
		if (this.#pendingRegistryEvents.length === 0) return;
		const events = this.#pendingRegistryEvents;
		this.#pendingRegistryEvents = [];
		for (const event of events) this.#applyRegistryEvent(event);
		this.#onDataChange();
	}

	#onDataChange(): void {
		if (this.#archiveSourceSessionFile !== this.#registry.get(MAIN_AGENT_ID)?.sessionFile) {
			this.#loadArchivedRows();
		}
		this.#refreshRows();
		if (this.#view === "chat") {
			if (!this.#chatArchived) {
				this.#attachLiveSession();
				this.#scheduleChatRefresh();
			}
		}
	}

	#isTerminal(ref: AgentRef): boolean {
		return ref.status === "aborted";
	}

	#rebuildObserverSnapshot(): void {
		this.#observerById = new Map(this.#observers.getSessions().map(session => [session.id, session]));
		this.#searchFieldsDirty = true;
		this.#filterDirty = true;
	}

	#rebuildActiveSearchFields(): void {
		this.#activeSearchFields.clear();
		for (const ref of this.#registryRefs.values()) {
			const observed = this.#observerById.get(ref.id);
			const task = observed?.description ?? observed?.progress?.task ?? "";
			const model = observed?.progress?.resolvedModel ?? "";
			const source = observed?.progress?.routeReceipt?.source ?? "";
			this.#activeSearchFields.set(
				ref.id,
				`${ref.id}\n${ref.displayName}\n${ref.status}\n${task}\n${model}\n${source}`.toLowerCase(),
			);
		}
		this.#searchFieldsDirty = false;
	}

	#sameExternalRows(left: readonly ExternalPeerRow[], right: readonly ExternalPeerRow[]): boolean {
		if (left.length !== right.length) return false;
		for (let index = 0; index < left.length; index++) {
			const a = left[index]!;
			const b = right[index]!;
			if (
				a.displayIndex !== b.displayIndex ||
				a.state !== b.state ||
				a.peer.sessionId !== b.peer.sessionId ||
				a.peer.name !== b.peer.name ||
				a.peer.cwd !== b.peer.cwd ||
				a.peer.sessionFile !== b.peer.sessionFile ||
				a.peer.lastSeen !== b.peer.lastSeen
			)
				return false;
		}
		return true;
	}

	/** Poll the independent external bus; only a real snapshot change invalidates filtering. */
	#refreshExternalRows(): boolean {
		const externalRows = this.#loadExternalRows();
		if (this.#sameExternalRows(this.#externalRows, externalRows)) return false;
		this.#externalRows = externalRows;
		this.#filterDirty = true;
		return true;
	}

	#initializeRegistryProjection(): void {
		for (const ref of this.#registry.list()) {
			if (ref.id !== MAIN_AGENT_ID) this.#applyRegistryEvent({ type: "registered", ref: { ...ref } });
		}
	}

	#applyRegistryEvent(event: RegistryEvent): void {
		if (event.ref.id === MAIN_AGENT_ID) return;
		const previous = this.#registryRefs.get(event.ref.id);
		if (previous) this.#refsByStatus[previous.status].delete(previous.id);
		if (event.type === "removed") {
			this.#registryRefs.delete(event.ref.id);
			return;
		}
		const snapshot = { ...event.ref };
		this.#registryRefs.set(snapshot.id, snapshot);
		this.#refsByStatus[snapshot.status].set(snapshot.id, snapshot);
	}

	#orderedStatus(status: AgentStatus): AgentRef[] {
		return [...this.#refsByStatus[status].values()].sort(
			(a, b) => a.spawnIndex - b.spawnIndex || a.id.localeCompare(b.id),
		);
	}

	/** Rebuild displayed identities only from expanded status buckets. */
	#refreshRows(): void {
		if (this.#orderedRegistryGeneration !== this.#registryGeneration) {
			const counts: Record<AgentStatus, number> = {
				running: this.#refsByStatus.running.size,
				idle: this.#refsByStatus.idle.size,
				parked: this.#refsByStatus.parked.size,
				aborted: this.#refsByStatus.aborted.size,
			};
			const rows = [...this.#orderedStatus("running"), ...this.#orderedStatus("idle")];
			if (this.#showHistoricalAgents || this.#tableFilterQuery) rows.push(...this.#orderedStatus("parked"));
			if (this.#showTerminalAgents) rows.push(...this.#orderedStatus("aborted"));
			this.#rows = rows;
			this.#statusCounts = counts;
			this.#hiddenTerminalCount = this.#showTerminalAgents ? 0 : counts.aborted;
			this.#orderedRegistryGeneration = this.#registryGeneration;
			this.#searchFieldsDirty = true;
			this.#filterDirty = true;
		}
		if (this.#searchFieldsDirty && (this.#tableFilterEditing || this.#tableFilterQuery)) {
			this.#rebuildActiveSearchFields();
			this.#filterDirty = true;
		}
		this.#refreshExternalRows();
		if (this.#filterDirty) this.#applyFilter();
	}

	#tableViewportCapacity(): number {
		// The roster is deliberately a compact, scrollable strip. Section labels
		// and the overflow marker share this budget with the selectable rows.
		return Math.max(3, Math.min(ROSTER_STRIP_HEIGHT - 3, (process.stdout.rows || 40) - 7));
	}
	#setSelectedFold(expand: boolean): boolean {
		const selected = this.#selectedInternalRef();
		if (!selected || !this.#rows.some(ref => ref.parentId === selected.id)) return false;
		if (expand) this.#foldedAgentIds.delete(selected.id);
		else this.#foldedAgentIds.add(selected.id);
		this.#filterDirty = true;
		this.#applyFilter();
		return true;
	}


	#cycleSibling(direction: -1 | 1): boolean {
		const selected = this.#selectedInternalRef();
		if (!selected) return false;
		const sibling = cycleVisibleAgentSibling(this.#visibleActiveRows, selected.id, direction);
		if (!sibling || sibling.id === selected.id) return false;
		this.#selectedAgentKey = `agent:${sibling.id}`;
		this.#resolveSelection();
		this.#syncSelectedPreview();
		return true;
	}

	#moveGroup(delta: number): void {
		if (this.#groupStartIndexes.length === 0) return;
		const current = this.#groupStartIndexes.findLastIndex(index => index <= this.#selectedRow);
		const target = Math.max(0, Math.min((current < 0 ? 0 : current) + delta, this.#groupStartIndexes.length - 1));
		this.#selectedRow = this.#groupStartIndexes[target]!;
		this.#syncSelectedKey();
	}
	#applyFilter(): void {
		const q = this.#tableFilterQuery.toLowerCase();
		this.#treeDepthById.clear();
		this.#treeGuideById.clear();
		this.#hiddenDescendantsById.clear();
		this.#hiddenRunningById.clear();
		this.#groupStartIndexes = [];
		const matches = (refs: readonly AgentRef[]) => (q ? refs.filter(ref => this.#matchesTableFilter(ref, q)) : refs);
		const runningAll = this.#orderedStatus("running");
		const idleAll = this.#orderedStatus("idle");
		const running = matches(runningAll);
		const idleRows = matches(idleAll);
		const recentCompleted: AgentRef[] = [];
		const idle: AgentRef[] = [];
		for (const ref of idleRows) {
			if (this.#turnStatus?.(ref.id)?.state === "completed") {
				if (this.#showHistoricalAgents && recentCompleted.length < RECENT_COMPLETED_LIMIT)
					recentCompleted.push(ref);
			} else idle.push(ref);
		}
		const parked = this.#showHistoricalAgents ? matches(this.#orderedStatus("parked")) : [];
		const terminal = !this.#showTerminalAgents ? [] : matches(this.#orderedStatus("aborted"));
		const sections = [
			["Running", running],
			["Idle / needs attention", idle],
			["Recent completed", recentCompleted],
			["Parked history", parked],
			["Terminal", terminal],
		] as const;
		const eligible = sections.flatMap(([, refs]) => refs);
		this.#sectionStarts = [];
		const includedIds = new Set(eligible.map(ref => ref.id));
		for (const ref of eligible) {
			let parentId = ref.parentId;
			while (parentId && parentId !== MAIN_AGENT_ID && !includedIds.has(parentId)) {
				const parent = this.#registryRefs.get(parentId);
				if (!parent) break;
				includedIds.add(parent.id);
				parentId = parent.parentId;
			}
		}
		const projectRefs = [...includedIds]
			.map(id => this.#registryRefs.get(id))
			.filter((ref): ref is AgentRef => ref !== undefined)
			.sort(
				(a, b) =>
					agentHistoryRank(a, this.#turnStatus?.(a.id)?.state === "completed") -
						agentHistoryRank(b, this.#turnStatus?.(b.id)?.state === "completed") ||
					a.spawnIndex - b.spawnIndex ||
					a.id.localeCompare(b.id),
			);
		const selectedId = this.#selectedAgentKey?.startsWith("agent:")
			? this.#selectedAgentKey.slice("agent:".length)
			: undefined;
		if (!q && selectedId)
			this.#foldedAgentIds = expandAgentAncestors(projectRefs, this.#foldedAgentIds, selectedId);
		const projected = projectAgentRoster(projectRefs, this.#foldedAgentIds, includedIds, Boolean(q));
		this.#visibleActiveRows = projected.map(row => row.ref);
		const sectionById = new Map<string, (typeof sections)[number]>();
		for (const section of sections) for (const ref of section[1]) sectionById.set(ref.id, section);
		let previousSection: (typeof sections)[number] | undefined;
		for (let index = 0; index < projected.length; index++) {
			const row = projected[index]!;
			this.#treeDepthById.set(row.ref.id, row.depth);
			this.#treeGuideById.set(row.ref.id, row.guide);
			if (row.collapsed) {
				this.#hiddenDescendantsById.set(row.ref.id, row.collapsed.descendants);
				this.#hiddenRunningById.set(row.ref.id, row.collapsed.running);
			}
			if (row.depth === 0) {
				this.#groupStartIndexes.push(index);
				const section = sectionById.get(row.ref.id);
				if (section && section !== previousSection) {
					this.#sectionStarts.push({ index, label: `${section[0]} (${section[1].length})` });
					previousSection = section;
				}
			}
		}
		const filteredArchived = this.#archivedRows
			.filter(row => !q || this.#matchesArchivedFilter(row, q))
			.slice(0, RECENT_COMPLETED_LIMIT);
		this.#visibleArchivedRows = this.#showHistoricalAgents ? filteredArchived : [];
		if (this.#visibleArchivedRows.length > 0) {
			this.#sectionStarts.push({
				index: this.#visibleActiveRows.length,
				label: `Archived completed (${this.#visibleArchivedRows.length})`,
			});
		}
		const filteredExternal = q
			? this.#externalRows.filter(row => this.#matchesExternalFilter(row, q))
			: this.#externalRows;
		this.#visibleExternalRows = filteredExternal;
		this.#filterDirty = false;
		this.#resolveSelection();
	}

	#toggleHistoricalAgents(): void {
		this.#showHistoricalAgents = !this.#showHistoricalAgents;
		this.#orderedRegistryGeneration = -1;
		this.#refreshRows();
		this.#syncSelectedPreview();
	}

	#matchesTableFilter(ref: AgentRef, q: string): boolean {
		return this.#activeSearchFields.get(ref.id)?.includes(q) === true;
	}

	#matchesExternalFilter(row: ExternalPeerRow, q: string): boolean {
		const peer = row.peer;
		return (peer.name || peer.sessionId).toLowerCase().includes(q) || displayedExternalPeerState(peer).includes(q);
	}

	#matchesArchivedFilter(row: ArchivedDirectChildDescriptor, q: string): boolean {
		return (
			row.agentId.toLowerCase().includes(q) ||
			row.state.includes(q) ||
			row.modelId?.toLowerCase().includes(q) === true ||
			row.thinkingLevel?.toLowerCase().includes(q) === true
		);
	}

	/** Resolve #selectedRow from the stable #selectedAgentKey against visible rows. */
	#resolveSelection(): void {
		const totalVisible = this.#totalTableRows();
		if (totalVisible === 0) {
			this.#selectedRow = 0;
			return;
		}
		if (this.#selectedAgentKey) {
			const idx = this.#findTableIndex(this.#selectedAgentKey);
			if (idx >= 0) {
				this.#selectedRow = idx;
				return;
			}
		}
		this.#selectedRow = Math.min(this.#selectedRow, totalVisible - 1);
		this.#selectedAgentKey = this.#selectedTableKey();
	}

	#syncSelectedKey(): void {
		this.#selectedAgentKey = this.#selectedTableKey();
	}

	#moveTableSelection(delta: number): void {
		const totalRows = this.#totalTableRows();
		if (totalRows === 0) return;
		const previous = this.#selectedRow;
		this.#selectedRow = Math.max(0, Math.min(this.#selectedRow + delta, totalRows - 1));
		this.#syncSelectedKey();
		if (this.#selectedRow !== previous) this.#syncSelectedPreview();
	}

	/** Swap only the selected preview and its one live subscription. */
	#syncSelectedPreview(): void {
		if (!this.#cockpitPreview) return;
		const row = this.#selectedAgentRow();
		const nextId =
			row?.kind === "active" ? row.ref.id : row?.kind === "archived" ? row.descriptor.agentId : undefined;
		const nextArchive = row?.kind === "archived" ? row.descriptor : undefined;
		if (nextId === this.#chatAgentId && nextArchive === this.#chatArchived) return;
		this.#detachLiveSession();
		this.#resetChatLog();
		this.#transcriptCache = undefined;
		this.#chatAgentId = nextId;
		this.#chatArchived = nextArchive;
		this.#scrollOffset = 0;
		this.#wasAtBottom = true;
		this.#inspectorScrollOffset = 0;
		this.#inspectorFocused = false;

		this.#chatSearchQuery = "";
		this.#chatSearchMatches = [];
		this.#editor.setText("");
		if (!nextId) {
			this.#viewerHeaderLines = [];
			return;
		}
		this.#attachLiveSession();
		this.#rebuildChatContent();
	}

	#renderPreview(width: number, targetHeight: number): string[] {
		if (!this.#chatAgentId) {
			this.#dualLaneActive = false;
			const lines = [theme.fg("dim", " No agent transcript selected.")];
			while (lines.length < targetHeight - 1) lines.push("");
			lines.push(...new DynamicBorder().render(width));
			this.#previewRenderedHeight = lines.length;
			return lines;
		}
		const canStack = targetHeight >= STACKED_LANE_MIN_HEIGHT * 2;
		if (width < DUAL_LANE_MIN_WIDTH && !canStack) {
			this.#dualLaneActive = false;
			return this.#renderTranscriptPreview(width, targetHeight);
		}
		this.#dualLaneActive = true;
		if (width < DUAL_LANE_MIN_WIDTH) {
			const inspectorHeight = Math.floor(targetHeight / 2);
			const transcriptHeight = targetHeight - inspectorHeight;
			const lines = [
				...this.#renderInspectorPreview(width, inspectorHeight),
				...this.#renderTranscriptPreview(width, transcriptHeight, false),
			];
			this.#previewRenderedHeight = lines.length;
			return lines;
		}
		const laneWidth = width - 1;
		const leftWidth = Math.floor(laneWidth / 2);
		const rightWidth = laneWidth - leftWidth;
		const transcript = this.#renderTranscriptPreview(rightWidth, targetHeight, false);
		const inspector = this.#renderInspectorPreview(leftWidth, targetHeight);
		const lines: string[] = [];
		for (let index = 0; index < targetHeight; index++) {
			const left = inspector[index] ?? "";
			const right = transcript[index] ?? "";
			const leftContent = truncateToWidth(left, leftWidth);
			lines.push(
				`${leftContent}${padding(Math.max(0, leftWidth - visibleWidth(leftContent)))}${theme.fg("dim", "│")}${right}`,
			);
		}
		this.#previewRenderedHeight = lines.length;
		return lines;
	}

	#renderTranscriptPreview(width: number, targetHeight: number, trackHeight = true): string[] {
		const innerWidth = Math.max(20, width - 2);
		const richRendered = this.#chatPlaceholder
			? [theme.fg("dim", this.#chatPlaceholder)]
			: this.#chatLog.render(innerWidth);
		const rendered = this.#plainPreview ? richRendered.map(line => Bun.stripANSI(line)) : richRendered;
		const content = rendered.length > 0 ? rendered : [theme.fg("dim", "No messages yet.")];
		this.#viewportHeight = Math.max(1, targetHeight - 2);
		this.#lastMaxScroll = Math.max(0, content.length - this.#viewportHeight);
		if (this.#wasAtBottom && !this.#chatSearchQuery) this.#scrollOffset = this.#lastMaxScroll;
		this.#scrollOffset = Math.max(0, Math.min(this.#scrollOffset, this.#lastMaxScroll));
		this.#chatRenderedContent = content;
		const focus = this.#dualLaneActive && !this.#inspectorFocused ? theme.fg("accent", "●") : "";
		const mode = this.#cockpitMode === "input" ? theme.fg("accent", "INPUT") : theme.fg("dim", "SCROLL");
		const rate = this.#tokenRateBadge();
		const rateBadge = rate ? `  ${rate}` : "";
		const lines = [` ${focus}${theme.fg("accent", "Preview transcript")}  ${mode}${rateBadge}`];
		for (const row of content.slice(this.#scrollOffset, this.#scrollOffset + this.#viewportHeight))
			lines.push(` ${row}`);
		while (lines.length < targetHeight - 1) lines.push("");
		lines.push(...new DynamicBorder().render(width));
		if (trackHeight) this.#previewRenderedHeight = lines.length;
		return lines;
	}

	#renderInspectorPreview(width: number, targetHeight: number): string[] {
		const observed = this.#chatAgentId ? this.#observerById.get(this.#chatAgentId) : undefined;
		const innerWidth = Math.max(20, width - 2);
		const content = this.#inspectorLines(observed, innerWidth);
		const viewportHeight = Math.max(1, targetHeight - 2);
		this.#inspectorLastMaxScroll = Math.max(0, content.length - viewportHeight);
		this.#inspectorScrollOffset = Math.max(0, Math.min(this.#inspectorScrollOffset, this.#inspectorLastMaxScroll));
		const focus = this.#inspectorFocused ? theme.fg("accent", "●") : "";
		const label = this.#inspectorSection[0].toUpperCase() + this.#inspectorSection.slice(1);
		const lines = [` ${focus}${theme.fg("accent", label)} ${theme.fg("dim", "[ / ] section")}`];
		for (const row of content.slice(this.#inspectorScrollOffset, this.#inspectorScrollOffset + viewportHeight))
			lines.push(` ${sanitizeLine(row, innerWidth)}`);
		while (lines.length < targetHeight - 1) lines.push("");
		lines.push(...new DynamicBorder().render(width));
		return lines;
	}

	#inspectorLines(observed: ObservableSession | undefined, width: number): string[] {
		if (this.#inspectorSection === "prompt") {
			const progress = observed?.progress;
			const context = progress?.spawnContext?.slice(0, INSPECTOR_PROMPT_MAX_CHARS) ?? "";
			const remaining = Math.max(0, INSPECTOR_PROMPT_MAX_CHARS - context.length);
			const assignment = (progress?.assignment ?? progress?.task ?? observed?.description ?? "").slice(0, remaining);
			if (!context && !assignment) return ["No spawn prompt available."];
			const lines: string[] = [];
			if (context) {
				lines.push(theme.fg("dim", "Context"));
				lines.push(...this.#wrapInspectorText(context, width, ""));
			}
			if (assignment) {
				if (context) lines.push("");
				lines.push(theme.fg("dim", "Assignment"));
				lines.push(...this.#wrapInspectorText(assignment, width, ""));
			}
			return lines;
		}
		if (this.#inspectorSection === "comms") {
			const deliveries = this.#chatAgentId
				? this.#irc.recentDeliveries({ peerId: this.#chatAgentId, limit: INSPECTOR_DELIVERY_LIMIT })
				: [];
			if (deliveries.length === 0) return ["No recent IRC deliveries."];
			return deliveries.map(record => {
				const direction =
					record.senderId === this.#chatAgentId ? `→ ${record.recipientId}` : `← ${record.senderId}`;
				const method = record.delivery ? ` via ${record.delivery}` : "";
				return `${direction} ${record.state}${method} [${record.origin}]`;
			});
		}
		const receipt = observed?.progress?.routeReceipt;
		if (!receipt) return ["No route provenance available."];
		const lines = [
			`Selected: ${receipt.route.selector}`,
			`Source: ${receipt.source}`,
			...(receipt.reason ? [`Reason: ${receipt.reason}`] : []),
			...(receipt.resolvedPatterns.length ? [`Candidates: ${receipt.resolvedPatterns.join(", ")}`] : []),
		];
		if (receipt.quotaAdmission) lines.push(`Quota: ${JSON.stringify(receipt.quotaAdmission)}`);
		for (const attempt of receipt.priorAttempts ?? []) {
			lines.push(
				`Prior: ${attempt.route.selector} [${attempt.source}]${attempt.reason ? ` — ${attempt.reason}` : ""}`,
			);
			if (attempt.quotaAdmission) lines.push(`  Quota: ${JSON.stringify(attempt.quotaAdmission)}`);
		}
		return lines.flatMap(line => this.#wrapInspectorText(line, width, ""));
	}

	#wrapInspectorText(text: string, width: number, empty: string): string[] {
		if (!text) return empty ? [empty] : [];
		const lines: string[] = [];
		for (const sourceLine of replaceTabs(text).split("\n")) {
			if (!sourceLine) {
				lines.push("");
				continue;
			}
			for (let offset = 0; offset < sourceLine.length; offset += width)
				lines.push(sourceLine.slice(offset, offset + width));
		}
		return lines;
	}

	#visibleAgentRowCount(): number {
		return this.#visibleActiveRows.length + this.#visibleArchivedRows.length;
	}

	#totalTableRows(): number {
		return this.#visibleAgentRowCount() + this.#visibleExternalRows.length;
	}

	#tableAgentRowAt(index: number): HubAgentRow | undefined {
		const ref = this.#visibleActiveRows[index];
		if (ref) return { kind: "active", ref };
		const descriptor = this.#visibleArchivedRows[index - this.#visibleActiveRows.length];
		return descriptor ? { kind: "archived", descriptor } : undefined;
	}

	#selectedTableKey(): string | undefined {
		const row = this.#selectedAgentRow();
		if (row?.kind === "active") return `agent:${row.ref.id}`;
		if (row?.kind === "archived") return `archived:${row.descriptor.childSessionFile}`;
		const external = this.#selectedExternalRow();
		return external ? `external:${external.peer.sessionId}` : undefined;
	}

	#findTableIndex(key: string): number {
		if (key.startsWith("agent:")) {
			const id = key.slice("agent:".length);
			return this.#visibleActiveRows.findIndex(ref => ref.id === id);
		}
		if (key.startsWith("archived:")) {
			const sessionFile = key.slice("archived:".length);
			const index = this.#visibleArchivedRows.findIndex(row => row.childSessionFile === sessionFile);
			return index >= 0 ? this.#visibleActiveRows.length + index : -1;
		}
		if (!key.startsWith("external:")) return -1;
		const sessionId = key.slice("external:".length);
		const externalIndex = this.#visibleExternalRows.findIndex(row => row.peer.sessionId === sessionId);
		return externalIndex >= 0 ? this.#visibleAgentRowCount() + externalIndex : -1;
	}

	#selectedAgentRow(): HubAgentRow | undefined {
		return this.#tableAgentRowAt(this.#selectedRow);
	}

	#selectedInternalRef(): AgentRef | undefined {
		const row = this.#selectedAgentRow();
		return row?.kind === "active" ? row.ref : undefined;
	}

	#selectedArchivedRow(): ArchivedDirectChildDescriptor | undefined {
		const row = this.#selectedAgentRow();
		return row?.kind === "archived" ? row.descriptor : undefined;
	}

	#selectedExternalRow(): ExternalPeerRow | undefined {
		const externalIndex = this.#selectedRow - this.#visibleAgentRowCount();
		return externalIndex >= 0 ? this.#visibleExternalRows[externalIndex] : undefined;
	}

	#loadArchivedRows(): void {
		const parentSessionFile = this.#registry.get(MAIN_AGENT_ID)?.sessionFile;
		if (!parentSessionFile) {
			this.#archivedLoadToken++;
			this.#archiveSourceSessionFile = undefined;
			this.#archivedRows = [];
			return;
		}
		this.#archivedRows = [];
		this.#applyFilter();
		this.#archiveSourceSessionFile = parentSessionFile;
		const token = ++this.#archivedLoadToken;
		void listArchivedDirectChildren(parentSessionFile)
			.then(rows => {
				if (
					token !== this.#archivedLoadToken ||
					this.#registry.get(MAIN_AGENT_ID)?.sessionFile !== parentSessionFile
				)
					return;
				this.#archivedRows = rows;
				this.#applyFilter();
				this.#requestRender();
			})
			.catch(error => logger.debug("Agent hub: completed child history unavailable", { error: String(error) }));
	}

	#loadExternalRows(): ExternalPeerRow[] {
		if (this.#remote) {
			this.#externalOrder.clear();
			return [];
		}
		const bus = this.#resolveExternalBus();
		if (!bus) {
			this.#externalOrder.clear();
			return [];
		}
		let peers: AgentHubExternalPeer[];
		try {
			peers = bus.listPeers({
				excludeSessionId: this.#externalSessionId,
				includeStale: false,
				staleMs: IRC_EXTERNAL_STALE_MS,
			});
		} catch (error) {
			logger.debug("Agent hub: external IRC peers unavailable", { error: String(error) });
			this.#externalOrder.clear();
			return [];
		}
		const peerIds = new Set(peers.map(peer => peer.sessionId));
		for (const sessionId of this.#externalOrder.keys()) {
			if (!peerIds.has(sessionId)) this.#externalOrder.delete(sessionId);
		}
		return peers
			.map(peer => {
				let displayIndex = this.#externalOrder.get(peer.sessionId);
				if (displayIndex === undefined) {
					displayIndex = this.#nextExternalDisplayIndex++;
					this.#externalOrder.set(peer.sessionId, displayIndex);
				}
				return { peer, displayIndex, state: displayedExternalPeerState(peer) };
			})
			.sort((a, b) => a.displayIndex - b.displayIndex);
	}

	#resolveExternalBus(): AgentHubExternalPeerDataSource | undefined {
		if (this.#externalBus === null) return undefined;
		if (this.#externalBus) return this.#externalBus;
		if (!fs.existsSync(externalIrcDbPath())) return undefined;
		try {
			this.#externalBus = IrcExternalBus.global();
			return this.#externalBus;
		} catch (error) {
			logger.debug("Agent hub: failed to open external IRC bus", { error: String(error) });
			this.#externalBus = null;
			return undefined;
		}
	}

	/** Subscribe to the chat agent's live session (if any) for transcript refreshes. Idempotent per session. */
	#attachLiveSession(): void {
		// Remote and completed-child rows carry no live session handle.
		if (this.#remote || this.#chatArchived) return;
		const session = this.#chatAgentId ? (this.#registry.get(this.#chatAgentId)?.session ?? undefined) : undefined;
		if (session === this.#attachedSession) return;
		this.#detachLiveSession();
		if (!session) return;
		this.#attachedSession = session;
		this.#sessionUnsubscribe = session.subscribe(event => {
			if (
				event.type === "message_start" ||
				event.type === "message_update" ||
				event.type === "message_end" ||
				event.type === "tool_execution_end" ||
				event.type === "agent_end"
			) {
				this.#scheduleChatRefresh();
			}
		});
	}

	#detachLiveSession(): void {
		this.#sessionUnsubscribe?.();
		this.#sessionUnsubscribe = undefined;
		this.#attachedSession = undefined;
	}

	#scheduleChatRefresh(): void {
		if (this.#chatRefreshTimer) return;
		this.#chatRefreshTimer = setTimeout(() => {
			this.#chatRefreshTimer = undefined;
			if (this.#view !== "chat" && !this.#cockpitPreview) return;
			this.#rebuildChatContent();
			this.#requestRender();
		}, CHAT_REFRESH_DEBOUNCE_MS);
		this.#chatRefreshTimer.unref?.();
	}

	#observableFor(id: string): ObservableSession | undefined {
		return this.#observerById.get(id);
	}

	// ========================================================================
	// Table view
	// ========================================================================

	#historicalHiddenCount(): number {
		if (this.#showHistoricalAgents) return 0;
		const q = this.#tableFilterQuery.toLowerCase();
		let hidden = q ? 0 : this.#statusCounts.parked;
		const refs = q ? this.#registryRefs.values() : this.#refsByStatus.idle.values();
		for (const ref of refs) {
			if (
				isHistoricalAgent(ref, this.#turnStatus?.(ref.id)?.state === "completed") &&
				(!q || this.#matchesTableFilter(ref, q))
			)
				hidden++;
		}
		hidden += this.#archivedRows.filter(row => !q || this.#matchesArchivedFilter(row, q)).length;
		return hidden;
	}

	#renderTable(width: number): string[] {
		const lines: string[] = [];
		lines.push(...new DynamicBorder().render(width));
		const counts = this.#statusSummary();
		const filterIndicator = this.#tableFilterQuery
			? theme.fg("accent", ` /${this.#tableFilterQuery}`) +
				theme.fg(
					"dim",
					` (${this.#totalTableRows()}/${this.#registryRefs.size + this.#archivedRows.length + this.#externalRows.length})`,
				)
			: "";
		const terminalIndicator =
			this.#hiddenTerminalCount > 0 ? theme.fg("dim", ` · ${this.#hiddenTerminalCount} terminal hidden`) : "";
		const historyIndicator = this.#showHistoricalAgents
			? ""
			: theme.fg("dim", ` · ${this.#historicalHiddenCount()} hidden`);
		lines.push(
			` ${theme.fg("accent", "Agent Hub")}${theme.fg("dim", " · tree")}${counts ? theme.fg("dim", `${theme.sep.dot}${counts}`) : ""}${terminalIndicator}${historyIndicator}${filterIndicator}`,
		);
		lines.push(...new DynamicBorder().render(width));
		const previewHeight = Math.max(
			4,
			(process.stdout.rows || 40) -
				ROSTER_STRIP_HEIGHT -
				HUB_CHROME_HEIGHT -
				(this.#showLegend ? 10 : 0) -
				(this.#notice ? 1 : 0) -
				(this.#tableFilterEditing ? 1 : 0),
		);
		lines.push(...this.#renderPreview(width, previewHeight));
		if (this.#showLegend) {
			lines.push(...this.#renderLegend(width));
			lines.push(...new DynamicBorder().render(width));
		}
		const totalRows = this.#totalTableRows();
		if (totalRows === 0 && !this.#showHistoricalAgents)
			lines.push(` ${theme.fg("dim", "No active subagents · . to show history")}`);
		else if (totalRows === 0 && this.#statusCounts.parked > 0 && !this.#tableFilterQuery) {
			lines.push(` ${theme.fg("dim", `Parked (${this.#statusCounts.parked}) · / to search and expand`)}`);
		} else if (totalRows === 0 && !this.#tableFilterQuery)
			lines.push(` ${theme.fg("dim", "no subagents yet — task spawns appear here")}`);
		else if (totalRows === 0) lines.push(` ${theme.fg("dim", "no matches")}`);
		else {
			const maxVisible = this.#tableViewportCapacity();
			const maxStart = Math.max(0, totalRows - maxVisible);
			let start = Math.min(this.#tableScrollOffset, maxStart);
			if (this.#selectedRow < start) start = this.#selectedRow;
			else if (this.#selectedRow >= start + maxVisible) start = this.#selectedRow - maxVisible + 1;
			this.#tableScrollOffset = Math.max(0, Math.min(start, maxStart));
			start = this.#tableScrollOffset;
			const end = Math.min(start + maxVisible, totalRows);
			let externalHeaderShown = false;
			const activeRowCount = this.#visibleActiveRows.length;
			const agentRowCount = this.#visibleAgentRowCount();
			for (let i = start; i < end; i++) {
				const section = this.#sectionStarts.find(candidate => candidate.index === i);
				if (section) lines.push(` ${theme.fg("accent", section.label)}`);
				const active = this.#visibleActiveRows[i];
				if (active) {
					lines.push(this.#renderRow(active, i === this.#selectedRow, width));
					continue;
				}
				const archived = this.#visibleArchivedRows[i - activeRowCount];
				if (archived) {
					lines.push(this.#renderArchivedRow(archived, i === this.#selectedRow, width));
					continue;
				}
				if (!externalHeaderShown) {
					lines.push(` ${theme.fg("dim", "External peers")}`);
					externalHeaderShown = true;
				}
				const external = this.#visibleExternalRows[i - agentRowCount];
				if (external) lines.push(this.#renderExternalRow(external, i === this.#selectedRow, width));
			}
			if (end < totalRows) lines.push(` ${theme.fg("dim", `… ${totalRows - end} more`)}`);
		}

		if (this.#notice) lines.push(` ${theme.fg("error", sanitizeLine(this.#notice, Math.max(10, width - 2)))}`);
		if (this.#tableFilterEditing)
			lines.push(` ${theme.fg("accent", "/")}${this.#tableFilterQuery}${theme.fg("accent", "▏")}`);
		lines.push("");
		const historyHint = this.#showHistoricalAgents ? ". hide history" : ". show history";
		lines.push(
			` ${theme.fg("dim", `SCROLL j/k,ctrl-u/d,g/G:preview  n/p:agent  i:input  Enter:attach  /:filter  h/l or ←/→:fold  [ ]:sibling  H/L:root  ?:legend  ${historyHint}  Esc/q:close`)}`,
		);
		lines.push(...new DynamicBorder().render(width));
		return lines;
	}

	#selectedRowData(): { id: string; model?: string } | undefined {
		const active = this.#selectedInternalRef();
		if (active) {
			const observed = this.#observerById.get(active.id);
			const cachedRoute =
				this.#transcriptCache?.path === active.sessionFile && this.#transcriptCache?.model
					? `${this.#transcriptCache.model}${this.#transcriptCache.thinking ? `:${this.#transcriptCache.thinking}` : ""}`
					: undefined;
			const model = observed?.progress?.resolvedModel ?? cachedRoute;
			return { id: active.id, model };
		}
		const archived = this.#selectedArchivedRow();
		if (archived) {
			const model = archived.modelId
				? `${archived.modelId}${archived.thinkingLevel ? `:${archived.thinkingLevel}` : ""}`
				: undefined;
			return { id: archived.agentId, model };
		}
		const external = this.#selectedExternalRow();
		if (external) {
			return { id: external.peer.name || external.peer.sessionId };
		}
		return undefined;
	}

	#renderLegend(width: number): string[] {
		const lines: string[] = [];
		lines.push(` ${theme.fg("accent", "Legend & Details (press ? to hide)")}`);
		lines.push(`   ${theme.fg("success", "S")} = Subscription model  ${theme.fg("warning", "A")} = Auth/Paid model`);
		lines.push(
			`   ${theme.fg("dim", "/")} search · ${theme.fg("dim", ".")} show/hide history · ${theme.fg("dim", "i/Esc")} input/navigation mode`,
		);
		lines.push(
			`   ${theme.fg("dim", "h/l or ←/→")} collapse/expand · ${theme.fg("dim", "[ / ]")} cycle siblings · ${theme.fg("dim", "v")} rich/plain preview`,
		);

		const selectedRow = this.#selectedRowData();
		if (selectedRow) {
			lines.push(` ${theme.fg("dim", "Selected Agent:")} ${theme.bold(selectedRow.id)}`);
			if (selectedRow.model) {
				const parts = parseResolvedModel(selectedRow.model);
				const authStr = SUBSCRIPTION_MODEL_PROVIDERS.has(parts.provider ?? "")
					? "Subscription (S)"
					: "Auth/Paid (A)";
				const effortStr = parts.thinking ? parts.thinking : "none";
				lines.push(`   ${theme.fg("dim", "Provider:")} ${parts.provider ?? "none"}`);
				lines.push(`   ${theme.fg("dim", "Model:")}    ${parts.id}`);
				lines.push(`   ${theme.fg("dim", "Auth:")}     ${authStr}`);
				lines.push(`   ${theme.fg("dim", "Effort:")}   ${effortStr}`);
			} else {
				lines.push(`   ${theme.fg("dim", "Model:")}    none`);
			}
		} else {
			lines.push(`   No agent selected.`);
		}
		// Pad/truncate legend lines to width
		return lines.map(line => sanitizeLine(line, Math.max(10, width - 2)));
	}
	#statusSummary(): string {
		const parts: string[] = [];
		for (const status of ["running", "idle", "parked", "aborted"] as const) {
			const count = this.#statusCounts[status];
			if (count > 0) parts.push(`${count} ${status}`);
		}
		if (this.#archivedRows.length > 0) parts.push(`${this.#archivedRows.length} archived`);
		if (this.#externalRows.length > 0) parts.push(`${this.#externalRows.length} external`);
		return parts.join(theme.sep.dot);
	}

	#renderRow(ref: AgentRef, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", theme.nav.cursor) : " ";
		const prefix = this.#treeGuideById.get(ref.id) ?? "";
		const context =
			ref.parentId === MAIN_AGENT_ID ? "MAIN CONTEXT" : ref.parentId ? "GROUP CONTEXT" : "SEPARATE/HUB-ONLY";
		const observed = this.#observableFor(ref.id);
		const task = observed?.description ?? observed?.progress?.task;
		const age = formatAge(Math.max(1, Math.round((Date.now() - ref.lastActivity) / 1000)));
		const unread = this.#irc.unreadCount(ref.id);
		const hiddenDescendants = this.#hiddenDescendantsById.get(ref.id);
		const rollup = hiddenDescendants
			? theme.fg("dim", ` (+${hiddenDescendants} · ${this.#hiddenRunningById.get(ref.id) ?? 0} run)`)
			: "";
		const tail = unread > 0 ? `⧉ ${unread}` : "";
		const cachedRoute =
			this.#transcriptCache?.path === ref.sessionFile && this.#transcriptCache?.model
				? `${this.#transcriptCache.model}${this.#transcriptCache.thinking ? `:${this.#transcriptCache.thinking}` : ""}`
				: undefined;
		const model =
			observed?.progress?.resolvedModel ?? cachedRoute ?? ref.recovery?.hotswapModel ?? ref.recovery?.model;
		const row = renderHubColumns({
			width: Math.max(10, width - 1),
			model,
			state: statusBadge(ref.status),
			name: `${prefix}${theme.bold(replaceTabs(ref.id))} ${theme.fg("dim", replaceTabs(ref.displayName))}${rollup}`,
			task,
			context,
			age: tail ? `${tail} ${age}` : age,
		});
		return truncateToWidth(` ${cursor} ${row}`, Math.max(10, width - 1));
	}

	#renderArchivedRow(row: ArchivedDirectChildDescriptor, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", theme.nav.cursor) : " ";
		const model = row.modelId ? `${row.modelId}${row.thinkingLevel ? `:${row.thinkingLevel}` : ""}` : undefined;
		const updatedAt = parseTimestampMs(row.updatedAt);
		const age =
			updatedAt === undefined ? undefined : formatAge(Math.max(1, Math.round((Date.now() - updatedAt) / 1000)));
		const rendered = renderHubColumns({
			width: Math.max(10, width - 1),
			model,
			state: formatArchivedState(row.state),
			name: `${theme.bold(replaceTabs(row.agentId))} ${theme.fg("dim", "read-only")}`,
			age,
		});
		return truncateToWidth(` ${cursor} ${rendered}`, Math.max(10, width - 1));
	}

	#renderExternalRow(row: ExternalPeerRow, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", theme.nav.cursor) : " ";
		const peer = row.peer;
		const rendered = renderHubColumns({
			width: Math.max(10, width - 1),
			state: externalStateBadge(displayedExternalPeerState(peer)),
			name: `${theme.bold(replaceTabs(peer.name || peer.sessionId))} ${theme.fg("dim", "external")}`,
			context: shortenPath(peer.cwd),
			age: formatLastSeenAge(peer.lastSeen),
		});
		return truncateToWidth(` ${cursor} ${rendered}`, Math.max(10, width - 1));
	}

	#handleTableInput(keyData: string): void {
		const gotoTop = matchesNavigationTop(keyData) && this.#tableGotoPrefixActive;
		this.#tableGotoPrefixActive = false;
		if (matchesNavigationTop(keyData) && !gotoTop) {
			this.#tableGotoPrefixActive = true;
			return;
		}
		if (gotoTop) {
			this.#moveTableSelection(-this.#selectedRow);
			this.#requestRender();
			return;
		}

		// Filter editing mode: capture keystrokes for the filter query
		if (this.#tableFilterEditing) {
			if (matchesKey(keyData, "enter") || keyData === "\r" || keyData === "\n") {
				this.#tableFilterEditing = false;
				if (!this.#tableFilterQuery) this.#activeSearchFields.clear();
				this.#requestRender();
				return;
			}
			if (matchesAppInterrupt(keyData)) {
				this.#tableFilterEditing = false;
				this.#tableFilterQuery = "";
				this.#activeSearchFields.clear();
				this.#applyFilter();
				this.#requestRender();
				return;
			}
			if (matchesKey(keyData, "backspace")) {
				if (!this.#tableFilterQuery) {
					this.#tableFilterEditing = false;
					this.#activeSearchFields.clear();
				} else {
					this.#tableFilterQuery = this.#tableFilterQuery.slice(0, -1);
				}
				this.#applyFilter();
				this.#requestRender();
				return;
			}
			// Printable single characters
			if (keyData.length === 1 && keyData >= " ") {
				this.#tableFilterQuery += keyData;
				this.#applyFilter();
				this.#requestRender();
				return;
			}
			return;
		}
		if (this.#cockpitMode === "input") {
			if (matchesAppInterrupt(keyData)) {
				this.#cockpitMode = "scroll";
				this.#requestRender();
				return;
			}
			if (matchesKey(keyData, "ctrl+enter")) {
				this.#submitChatMessage(this.#editor.getText(), true);
				return;
			}
			this.#editor.handleInput(keyData);
			this.#requestRender();
			return;
		}
		if (keyData === "i" && this.#chatAgentId && !this.#chatArchived) {
			this.#scrollOffset = this.#lastMaxScroll;
			this.#wasAtBottom = true;
			this.#cockpitMode = "input";
			this.#requestRender();
			return;
		}
		if (keyData === "v") {
			this.#plainPreview = !this.#plainPreview;
			this.#requestRender();
			return;
		}
		if (keyData === "n" || keyData === "p") {
			this.#moveTableSelection(keyData === "n" ? 1 : -1);
			this.#requestRender();
			return;
		}
		if (keyData === "[" || keyData === "]") {
			if (!this.#cycleSibling(keyData === "]" ? 1 : -1) && this.#dualLaneActive) {
				const sections = ["prompt", "route", "comms"] as const;
				const current = sections.indexOf(this.#inspectorSection);
				this.#inspectorSection =
					sections[(current + (keyData === "]" ? 1 : sections.length - 1)) % sections.length];
				this.#inspectorScrollOffset = 0;
			}
			this.#requestRender();
			return;
		}
		if (keyData === "h" || matchesKey(keyData, "left")) {
			if (!this.#setSelectedFold(false) && this.#dualLaneActive) this.#inspectorFocused = true;
			this.#requestRender();
			return;
		}
		if (keyData === "l" || matchesKey(keyData, "right")) {
			if (!this.#setSelectedFold(true) && this.#dualLaneActive) this.#inspectorFocused = false;
			this.#requestRender();
			return;
		}
		if (this.#dualLaneActive && this.#inspectorFocused && this.#handleInspectorNavigation(keyData)) return;

		if (this.#handleViewerNavigation(keyData)) return;
		if (keyData === ".") {
			this.#toggleHistoricalAgents();
			this.#requestRender();
			return;
		}

		if (matchesAppInterrupt(keyData)) {
			// Esc clears an active filter first, then closes the hub
			if (this.#tableFilterQuery) {
				this.#tableFilterQuery = "";
				this.#activeSearchFields.clear();
				this.#applyFilter();
				this.#requestRender();
				return;
			}
			this.#onDone();
			return;
		}
		if (keyData === "?") {
			this.#showLegend = !this.#showLegend;
			this.#requestRender();
			return;
		}
		if (keyData === "H") {
			this.#moveGroup(-1);
			this.#requestRender();
			return;
		}
		if (keyData === "L") {
			this.#moveGroup(1);
			this.#requestRender();
			return;
		}
		// j/k and Ctrl+U/Ctrl+D belong to the preview in cockpit scroll mode.

		if (matchesNavigationBottom(keyData)) {
			this.#moveTableSelection(this.#totalTableRows());
			this.#requestRender();
			return;
		}
		if (this.#tableFilterQuery && keyData === "n") {
			this.#moveTableSelection(1);
			this.#requestRender();
			return;
		}
		if (this.#tableFilterQuery && keyData === "N") {
			this.#moveTableSelection(-1);
			this.#requestRender();
			return;
		}
		if (keyData === "/") {
			this.#tableFilterEditing = true;
			this.#tableFilterQuery = "";
			this.#rebuildActiveSearchFields();
			this.#filterDirty = true;
			this.#applyFilter();
			this.#requestRender();
			return;
		}
		if (keyData === "P") {
			void this.#reconcileSelected();
			return;
		}
		if (matchesKey(keyData, "enter") || keyData === "\r" || keyData === "\n") {
			const selected = this.#selectedInternalRef();
			if (selected) this.#activateAgent(selected);
			else {
				const archived = this.#selectedArchivedRow();
				if (archived) this.#openArchivedChat(archived);
				else {
					const external = this.#selectedExternalRow();
					if (external) this.#openExternalChat(external.peer);
				}
			}
			return;
		}
		if (keyData === "q") {
			this.#onDone();
			return;
		}
		if (keyData === "r") {
			this.#reviveSelected();
			return;
		}
		if (keyData === "x") {
			this.#killSelected();
			return;
		}
	}
	async #reconcileSelected(): Promise<void> {
		const ref = this.#selectedInternalRef();
		if (!ref) return;
		const result = await this.#lifecycle().reconcileStaleOrphan(ref.id);
		this.#notice = result.reconciled
			? `${ref.id} parked after terminal evidence`
			: `cannot park ${ref.id}: ${result.reason.replaceAll("_", " ")}`;
		this.#requestRender();
	}

	#showExternalPeerHint(): void {
		const row = this.#selectedExternalRow();
		if (!row) return;
		this.#notice = `message with: omp irc send ${row.peer.name || row.peer.sessionId} …`;
		this.#requestRender();
	}

	/**
	 * Enter on a row: parked agents open the in-hub transcript without revival;
	 * live agents focus the main view on the agent session and close the hub. The
	 * focused transcript then renders through the regular session pipeline —
	 * exact parity by construction. Collab guests (no local sessions) keep the
	 * in-hub chat view.
	 */
	#activateAgent(ref: AgentRef): void {
		this.#notice = undefined;
		if (ref.status === "parked") {
			this.openChat(ref.id);
			return;
		}
		const focusAgent = this.#focusAgent;
		if (this.#remote || !focusAgent) {
			this.openChat(ref.id);
			return;
		}
		void (async () => {
			try {
				await focusAgent(ref.id);
				this.#onDone();
			} catch (error) {
				this.#notice = error instanceof Error ? error.message : String(error);
				this.#requestRender();
			}
		})();
	}

	#reviveSelected(): void {
		if (this.#selectedArchivedRow()) {
			this.#notice = "Completed children are read-only.";
			this.#requestRender();
			return;
		}
		const ref = this.#selectedInternalRef();
		if (!ref) {
			this.#showExternalPeerHint();
			return;
		}
		if (ref.status !== "parked") {
			this.#notice = `Agent "${ref.id}" is ${ref.status} — only parked agents can be revived.`;
			this.#requestRender();
			return;
		}
		this.#notice = undefined;
		if (this.#remote) {
			this.#remote.revive(ref.id);
			this.#requestRender();
			return;
		}
		// Fire-and-forget; failures surface as an inline notice
		this.#lifecycle()
			.ensureLive(ref.id)
			.catch((error: unknown) => {
				this.#notice = error instanceof Error ? error.message : String(error);
				this.#requestRender();
			});
		this.#requestRender();
	}

	#reviveChatAgent(): void {
		const id = this.#chatAgentId;
		if (!id) return;
		const ref = this.#registry.get(id);
		if (!ref) return;
		if (ref.status !== "parked") {
			this.#notice = `Agent "${id}" is ${ref.status} — only parked agents can be revived.`;
			this.#requestRender();
			return;
		}
		this.#notice = undefined;
		if (this.#remote) {
			this.#remote.revive(id);
			this.#scheduleChatRefresh();
			this.#requestRender();
			return;
		}
		this.#lifecycle()
			.ensureLive(id)
			.then(() => {
				this.#attachLiveSession();
				this.#scheduleChatRefresh();
			})
			.catch((error: unknown) => {
				this.#notice = error instanceof Error ? error.message : String(error);
			})
			.finally(() => this.#requestRender());
		this.#requestRender();
	}

	#killSelected(): void {
		if (this.#selectedArchivedRow()) {
			this.#notice = "Completed children are read-only.";
			this.#requestRender();
			return;
		}
		const ref = this.#selectedInternalRef();
		if (!ref) {
			this.#showExternalPeerHint();
			return;
		}
		this.#notice = undefined;
		if (this.#remote) {
			this.#remote.kill(ref.id);
			this.#refreshRows();
			this.#requestRender();
			return;
		}
		void (async () => {
			try {
				if (ref.status === "running" && ref.session) {
					await ref.session.abort({ reason: USER_INTERRUPT_LABEL });
				}
				await this.#lifecycle().release(ref.id);
			} catch (error) {
				logger.warn("Agent hub: kill failed", { id: ref.id, error: String(error) });
				this.#notice = error instanceof Error ? error.message : String(error);
			}
			this.#refreshRows();
			this.#requestRender();
		})();
	}

	// ========================================================================
	// Chat view
	// ========================================================================

	#renderChat(width: number): string[] {
		const termHeight = process.stdout.rows || 40;
		const innerWidth = Math.max(20, width - 2);
		const editorLines = this.#chatSearchEditing
			? [` ${theme.fg("accent", "/")}${this.#chatSearchQuery}${theme.fg("accent", "▏")}`]
			: this.#chatArchived ||
				  (this.#chatExternal ? !this.#externalInputActive : this.#cockpitMode !== "input")
				? []
				: this.#editor.render(innerWidth);
		const noticeLine = this.#notice
			? ` ${theme.fg("error", sanitizeLine(this.#notice, Math.max(10, width - 2)))}`
			: undefined;
		const footerLines = this.#buildChatFooterLines();

		// Header: border + headerLines + border; footer: notice? + editor + footer + border
		const headerChrome = this.#viewerHeaderLines.length + 2;
		const footerChrome = editorLines.length + footerLines.length + (noticeLine ? 1 : 0) + 1;
		this.#viewportHeight = Math.max(5, termHeight - headerChrome - footerChrome);

		const richContentLines: readonly string[] = this.#chatPlaceholder
			? [theme.fg("dim", this.#chatPlaceholder)]
			: this.#chatLog.render(innerWidth).length > 0
				? this.#chatLog.render(innerWidth)
				: [theme.fg("dim", "No messages yet.")];
		const contentLines = this.#plainPreview
			? richContentLines.map(line => Bun.stripANSI(line))
			: richContentLines;

		// Cache rendered lines for transcript search
		this.#chatRenderedContent = contentLines;

		const maxScroll = Math.max(0, contentLines.length - this.#viewportHeight);
		this.#lastMaxScroll = maxScroll;
		if (this.#wasAtBottom && !this.#chatSearchQuery) this.#scrollOffset = maxScroll;
		this.#scrollOffset = Math.max(0, Math.min(this.#scrollOffset, maxScroll));

		const lines: string[] = [];
		lines.push(...new DynamicBorder().render(width));
		// Show search indicator in header when search is active
		const searchIndicator = this.#chatSearchQuery
			? `  ${theme.fg("accent", `/${this.#chatSearchQuery}`)}${theme.fg("dim", ` [${this.#chatSearchMatches.length > 0 ? `${this.#chatSearchMatchIndex + 1}/${this.#chatSearchMatches.length}` : "0"}]`)}`
			: "";
		for (let hi = 0; hi < this.#viewerHeaderLines.length; hi++) {
			const suffix = hi === 0 ? searchIndicator : "";
			lines.push(` ${this.#viewerHeaderLines[hi]}${suffix}`);
		}
		lines.push(...new DynamicBorder().render(width));

		if (contentLines.length <= this.#viewportHeight) {
			for (const row of contentLines) lines.push(` ${row}`);
		} else {
			const scrollView = new ScrollView(
				contentLines.slice(this.#scrollOffset, this.#scrollOffset + this.#viewportHeight),
				{
					scrollbar: "auto",
					height: this.#viewportHeight,
					totalRows: contentLines.length,
					theme: { track: t => theme.fg("dim", t), thumb: t => theme.fg("accent", t) },
				},
			);
			scrollView.setScrollOffset(this.#scrollOffset);
			for (const row of scrollView.render(Math.max(1, width - 1))) lines.push(` ${row}`);
		}

		if (noticeLine) lines.push(noticeLine);
		for (const editorLine of editorLines) lines.push(` ${editorLine}`);
		lines.push(...footerLines);
		lines.push(...new DynamicBorder().render(width));
		return lines;
	}

	#buildChatFooterLines(): string[] {
		const lines: string[] = [];
		const searchHint = this.#chatSearchQuery ? "  n/N:match" : "  /:search";
		if (this.#chatArchived) {
			const archived = this.#chatArchived;
			const route = archived.modelId
				? `${archived.modelId}${archived.thinkingLevel ? `:${archived.thinkingLevel}` : ""}`
				: "route unavailable";
			lines.push(` ${theme.fg("dim", `${archived.state} archived · ${route} · read-only`)}`);
			lines.push(
				` ${theme.fg("dim", `Esc/h/⌫:back  q:close  [/] prev/next  ctrl-s n/p:cycle${searchHint}  j/k:scroll  ctrl-u/d:page  g/G:top/end`)}`,
			);
			return lines;
		}
		const observed = this.#chatAgentId ? this.#observableFor(this.#chatAgentId) : undefined;
		const ref = this.#chatAgentId ? this.#registry.get(this.#chatAgentId) : undefined;
		const statsLine = this.#buildStatsLine(observed);
		if (statsLine) lines.push(` ${statsLine}`);
		const turnStatus = this.#chatAgentId ? this.#turnStatus?.(this.#chatAgentId) : undefined;
		if (turnStatus) lines.push(` ${this.#formatTurnStatus(turnStatus)}`);
		const reviveHint = ref?.status === "parked" ? "  R:revive" : "";
		const inputHint =
			this.#cockpitMode === "input"
				? "Ctrl+Enter:queue  Esc:navigation"
				: "i:input  Esc/h/⌫:back";
		lines.push(
			` ${theme.fg("dim", `${inputHint}  q:close  [/] prev/next  v:rich/plain  ctrl-s n/p:cycle${reviveHint}${searchHint}  ${this.#expandKeys[0] ?? "ctrl+o"}:expand  j/k:scroll  ctrl-u/d:page  g/G:top/end`)}`,
		);
		return lines;
	}

	#formatTurnStatus(status: AgentHubTurnStatus): string {
		const details = [
			status.provider ? `provider:${sanitizeLine(status.provider, 24)}` : undefined,
			status.reroutedProvider ? `rerouted:${sanitizeLine(status.reroutedProvider, 24)}` : undefined,
			status.originalModel ? `model:${sanitizeLine(status.originalModel, 24)}` : undefined,
			status.reroutedModel ? `rerouted-model:${sanitizeLine(status.reroutedModel, 24)}` : undefined,
			status.ratePerHour !== undefined ? `rate:${status.ratePerHour}/h` : undefined,
			status.projectedEmptyAt ? `empty:${new Date(status.projectedEmptyAt).toLocaleTimeString()}` : undefined,
			status.resetAt ? `reset:${new Date(status.resetAt).toLocaleTimeString()}` : undefined,
			status.deficitPerHour !== undefined ? `deficit:${status.deficitPerHour}/h` : undefined,
			status.decisionReason ? `reason:${sanitizeLine(status.decisionReason, 32)}` : undefined,
			status.quotaPoolId ? `pool:${sanitizeLine(status.quotaPoolId, 16)}` : undefined,
			status.limitWindowId ? `window:${sanitizeLine(status.limitWindowId, 16)}` : undefined,
			status.canCancel ? "cancellable" : undefined,
		].filter((detail): detail is string => detail !== undefined);
		const color =
			status.state === "failed-rate-limit" ? "error" : status.state === "cancelled" ? "warning" : "accent";
		return theme.fg(color, `${status.state}${details.length ? ` · ${details.join(" · ")}` : ""}`);
	}

	#tokenRateBadge(): string | undefined {
		const ref = this.#chatAgentId ? this.#registry.get(this.#chatAgentId) : undefined;
		if (ref?.status !== "running") return undefined;

		const state = ref.session?.state;
		const liveMessages = state?.messages ?? [];
		let rate = calculateTokensPerSecond(liveMessages, true);
		if (rate === null && state?.streamMessage) {
			rate = calculateTokensPerSecond([state.streamMessage], true);
		}
		if (rate === null && this.#transcriptCache) {
			rate = calculateTokensPerSecond(
				this.#transcriptCache.entries.map(entry => entry.message),
				false,
			);
		}
		return rate === null ? undefined : theme.bold(theme.fg("accent", `${rate.toFixed(1)} tok/s`));
	}

	#buildStatsLine(observed: ObservableSession | undefined): string {
		const progress = observed?.progress;
		const stats: string[] = [];
		const rate = this.#tokenRateBadge();
		if (rate) stats.push(rate);
		// Current per-turn context — match the status line's `<pct>%/<window>` gauge (e.g. `5.1%/1M`).
		if (progress?.contextTokens && progress.contextTokens > 0) {
			const ctx =
				progress.contextWindow && progress.contextWindow > 0
					? formatContextUsage((progress.contextTokens / progress.contextWindow) * 100, progress.contextWindow)
					: `${formatNumber(progress.contextTokens)}`;
			stats.push(ctx);
		}
		if (progress?.durationMs && progress.durationMs > 0) {
			stats.push(formatDuration(progress.durationMs));
		}
		const parts: string[] = [];
		if (stats.length > 0 || (progress?.toolCount ?? 0) > 0) {
			const toolCountStat =
				progress && progress.toolCount > 0 ? `${formatNumber(progress.toolCount)} ${theme.icon.extensionTool}` : undefined;
			const statSegments = [toolCountStat, ...stats].filter((segment): segment is string => Boolean(segment));
			parts.push(theme.fg("dim", statSegments.join(theme.sep.dot)));
		}
		if (progress?.cost && progress.cost > 0) {
			parts.push(theme.fg("statusLineCost", `$${progress.cost.toFixed(2)}`));
		}
		return parts.join(theme.sep.dot);
	}

	/** Rebuild the chat header and sync transcript components from new entries */
	#rebuildChatContent(): void {
		const id = this.#chatAgentId;
		const ref = id ? this.#registry.get(id) : undefined;

		// Load transcript first so model info is available for the header
		let messageEntries: SessionMessageEntry[] | null = null;
		if (this.#chatExternal?.sessionFile) {
			messageEntries = this.#loadTranscript(this.#chatExternal.sessionFile);
		} else if (this.#chatArchived) {
			messageEntries = this.#loadTranscript(this.#chatArchived.childSessionFile);
		} else if (this.#remote) {
			if (id) this.#fetchRemoteTranscript(id);
			messageEntries = this.#transcriptCache?.entries ?? [];
		} else if (ref?.sessionFile) {
			messageEntries = this.#loadTranscript(ref.sessionFile);
		}

		this.#viewerHeaderLines = [];
		this.#viewerHeaderLines.push(theme.fg("accent", `Agent Hub > ${id ?? "?"}`));
		if (this.#chatExternal) {
			const peer = this.#chatExternal;
			const state = displayedExternalPeerState(peer);
			this.#viewerHeaderLines.push(
				`${theme.bold(peer.name || peer.sessionId)} ${theme.fg("warning", "READONLY")} ${theme.fg("dim", `${state} · pid ${peer.pid} · ${peer.cwd} · cmd+p to real TUI`)}`,
			);
		} else if (this.#chatArchived) {
			const archived = this.#chatArchived;
			const model = archived.modelId
				? `${archived.modelId}${archived.thinkingLevel ? `:${archived.thinkingLevel}` : ""}`
				: this.#transcriptCache?.model;
			const modelLabel = model ? `${theme.sep.dot}${modelHeaderLane(model)}` : "";
			this.#viewerHeaderLines.push(
				`${theme.bold(archived.agentId)} ${theme.fg("dim", `${archived.state} · archived · read-only`)}${modelLabel}`,
			);
		} else if (ref) {
			const observed = this.#observableFor(ref.id);
			const cachedRoute = this.#transcriptCache?.model
				? `${this.#transcriptCache.model}${this.#transcriptCache.thinking ? `:${this.#transcriptCache.thinking}` : ""}`
				: undefined;
			const model = observed?.progress?.resolvedModel ?? cachedRoute;
			const kindTag = theme.fg("dim", ` ${ref.parentId ? `${ref.kind} · of ${ref.parentId}` : ref.kind}`);
			const modelLabel = model ? `${theme.sep.dot}${modelHeaderLane(model)}` : "";
			const source = observed?.progress?.routeReceipt?.source;
			const sourceLabel = source ? theme.fg("dim", ` [${source}]`) : "";
			this.#viewerHeaderLines.push(
				`${theme.bold(ref.id)} ${statusBadge(ref.status)}${kindTag}${modelLabel}${sourceLabel}`,
			);
		}

		if (this.#chatExternal) {
			this.#chatPlaceholder = !this.#chatExternal.sessionFile
				? "Sibling transcript path unavailable. Use cmd+p to navigate to its real TUI."
				: messageEntries === null
					? "Sibling transcript is no longer available."
					: messageEntries.length === 0
						? "No messages yet."
						: undefined;
			if (messageEntries && messageEntries.length > 0) this.#syncChatComponents(messageEntries);
		} else if (this.#chatArchived) {
			this.#chatPlaceholder =
				messageEntries === null
					? "Archived transcript is no longer available."
					: messageEntries.length === 0
						? "No messages yet."
						: undefined;
			if (messageEntries && messageEntries.length > 0) this.#syncChatComponents(messageEntries);
		} else if (!ref) {
			this.#chatPlaceholder = "Agent no longer registered.";
		} else if (!this.#remote && !ref.sessionFile) {
			this.#chatPlaceholder = ref.status === "parked" ? "No messages yet." : "No session file available yet.";
		} else if (messageEntries === null) {
			this.#chatPlaceholder = "Transcript is no longer available.";
		} else if (messageEntries.length === 0) {
			if (this.#remote && this.#remoteTranscriptUnavailable) {
				this.#chatPlaceholder = "Transcript lives on the host — not available.";
			} else if (this.#remote && !this.#transcriptCache) {
				this.#chatPlaceholder = "Loading transcript from host…";
			} else {
				this.#chatPlaceholder = "No messages yet.";
			}
		} else {
			this.#chatPlaceholder = undefined;
			this.#syncChatComponents(messageEntries);
		}
	}

	#handleChatInput(keyData: string): void {
		const editorEmpty = this.#editor.getText().trim() === "";
		if (this.#chatSearchEditing) {
			if (matchesKey(keyData, "enter") || keyData === "\r" || keyData === "\n") {
				this.#chatSearchEditing = false;
				this.#requestRender();
				return;
			}
			if (matchesAppInterrupt(keyData)) {
				this.#chatSearchEditing = false;
				this.#chatSearchQuery = "";
				this.#chatSearchMatches = [];
				this.#chatSearchMatchIndex = -1;
				this.#requestRender();
				return;
			}
			if (matchesKey(keyData, "backspace")) {
				if (!this.#chatSearchQuery) {
					this.#chatSearchEditing = false;
				} else {
					this.#chatSearchQuery = this.#chatSearchQuery.slice(0, -1);
					this.#computeChatSearchMatches();
				}
				this.#requestRender();
				return;
			}
			if (keyData.length === 1 && keyData >= " ") {
				this.#chatSearchQuery += keyData;
				this.#computeChatSearchMatches();
				this.#requestRender();
			}
			return;
		}
		if (this.#chatExternal) {
			this.#handleExternalChatInput(keyData);
			return;
		}
		if (this.#chatArchived) {
			this.#handleReadOnlyChatInput(keyData);
			return;
		}
		if (this.#cockpitMode === "input") {
			if (matchesAppInterrupt(keyData)) {
				this.#cockpitMode = "scroll";
				this.#requestRender();
				return;
			}
			if (matchesKey(keyData, "ctrl+enter")) {
				this.#submitChatMessage(this.#editor.getText(), true);
				return;
			}
			this.#editor.handleInput(keyData);
			this.#requestRender();
			return;
		}
		if (keyData === "i") {
			this.#cockpitMode = "input";
			this.#requestRender();
			return;
		}
		if (keyData === "v") {
			this.#plainPreview = !this.#plainPreview;
			this.#requestRender();
			return;
		}
		if (matchesAppInterrupt(keyData)) {
			if (this.#chatSearchQuery) {
				this.#chatSearchQuery = "";
				this.#chatSearchMatches = [];
				this.#chatSearchMatchIndex = -1;
				this.#requestRender();
			} else {
				this.#closeChat();
			}
			return;
		}
		if (matchesKey(keyData, "ctrl+s")) {
			this.#detailPrefixActive = true;
			this.#requestRender();
			return;
		}
		if (this.#detailPrefixActive) {
			this.#detailPrefixActive = false;
			if (keyData === "n") this.#openAdjacentChat(1);
			else if (keyData === "p") this.#openAdjacentChat(-1);
			else this.#requestRender();
			return;
		}
		if (keyData === "q") {
			this.#onDone();
			return;
		}
		if (keyData === "h" || matchesKey(keyData, "backspace")) {
			this.#closeChat();
			return;
		}
		if (keyData === "]") {
			this.#openAdjacentChat(1);
			return;
		}
		if (keyData === "[") {
			this.#openAdjacentChat(-1);
			return;
		}
		for (const key of this.#expandKeys) {
			if (matchesKey(keyData, key)) {
				this.#chatExpanded = !this.#chatExpanded;
				for (const component of this.#chatExpandables) component.setExpanded(this.#chatExpanded);
				this.#requestRender();
				return;
			}
		}
		if (keyData === "R") {
			this.#reviveChatAgent();
			return;
		}
		if (keyData === "/") {
			this.#chatSearchEditing = true;
			this.#chatSearchQuery = "";
			this.#chatSearchMatches = [];
			this.#chatSearchMatchIndex = -1;
			this.#requestRender();
			return;
		}
		if (this.#chatSearchMatches.length > 0) {
			if (keyData === "n") {
				this.#chatSearchMatchIndex = (this.#chatSearchMatchIndex + 1) % this.#chatSearchMatches.length;
				this.#scrollToSearchMatch();
				this.#requestRender();
				return;
			}
			if (keyData === "N") {
				this.#chatSearchMatchIndex =
					(this.#chatSearchMatchIndex - 1 + this.#chatSearchMatches.length) % this.#chatSearchMatches.length;
				this.#scrollToSearchMatch();
				this.#requestRender();
				return;
			}
		}
		if (matchesKey(keyData, "left")) {
			const now = Date.now();
			if (now - this.#lastLeftTap < LEFT_TAP_WINDOW_MS) {
				this.#lastLeftTap = 0;
				this.#openParent();
			} else {
				this.#lastLeftTap = now;
			}
			return;
		}
		if (this.#handleViewerNavigation(keyData)) return;
	}

	#handleExternalChatInput(keyData: string): void {
		if (!this.#externalInputActive) {
			if (keyData === "i") {
				this.#externalInputActive = true;
				this.#editor.setText("");
				this.#notice = "IRC input · Ctrl+Enter sends as User";
				this.#requestRender();
				return;
			}
			this.#handleReadOnlyChatInput(keyData);
			return;
		}
		if (matchesAppInterrupt(keyData)) {
			this.#externalInputActive = false;
			this.#editor.setText("");
			this.#notice = undefined;
			this.#requestRender();
			return;
		}
		if (matchesKey(keyData, "ctrl+enter")) {
			const body = this.#editor.getText().trim();
			const peer = this.#chatExternal;
			const bus = this.#resolveExternalBus();
			if (!body || !peer || !bus?.sendMessage) return;
			try {
				bus.sendMessage({ fromPeer: this.#externalSessionId, toPeer: peer.name, body, origin: "user" });
				this.#editor.setText("");
				this.#externalInputActive = false;
				this.#notice = `Sent to ${peer.name} as User`;
			} catch (error) {
				this.#notice = error instanceof Error ? error.message : String(error);
			}
			this.#requestRender();
			return;
		}
		this.#editor.handleInput(keyData);
		this.#requestRender();
	}
	#handleReadOnlyChatInput(keyData: string): void {
		if (matchesAppInterrupt(keyData)) {
			if (this.#chatSearchQuery) {
				this.#chatSearchQuery = "";
				this.#chatSearchMatches = [];
				this.#chatSearchMatchIndex = -1;
				this.#requestRender();
			} else {
				this.#closeChat();
			}
			return;
		}
		if (keyData === "q") {
			this.#onDone();
			return;
		}
		if (keyData === "h" || matchesKey(keyData, "backspace")) {
			this.#closeChat();
			return;
		}
		if (matchesKey(keyData, "ctrl+s")) {
			this.#detailPrefixActive = true;
			this.#requestRender();
			return;
		}
		if (this.#detailPrefixActive) {
			this.#detailPrefixActive = false;
			if (keyData === "n") this.#openAdjacentChat(1);
			else if (keyData === "p") this.#openAdjacentChat(-1);
			else this.#requestRender();
			return;
		}
		if (keyData === "]") {
			this.#openAdjacentChat(1);
			return;
		}
		if (keyData === "[") {
			this.#openAdjacentChat(-1);
			return;
		}
		if (keyData === "/") {
			this.#chatSearchEditing = true;
			this.#chatSearchQuery = "";
			this.#chatSearchMatches = [];
			this.#chatSearchMatchIndex = -1;
			this.#requestRender();
			return;
		}
		if (this.#chatSearchMatches.length > 0 && (keyData === "n" || keyData === "N")) {
			this.#chatSearchMatchIndex =
				keyData === "n"
					? (this.#chatSearchMatchIndex + 1) % this.#chatSearchMatches.length
					: (this.#chatSearchMatchIndex - 1 + this.#chatSearchMatches.length) % this.#chatSearchMatches.length;
			this.#scrollToSearchMatch();
			this.#requestRender();
			return;
		}
		if (this.#handleViewerNavigation(keyData)) return;
	}

	// ========================================================================
	// Chat transcript search
	// ========================================================================

	/** Strip ANSI escape sequences for plain-text search. */
	static #ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

	/** Recompute search matches against the cached rendered content lines. */
	#computeChatSearchMatches(): void {
		const q = this.#chatSearchQuery.toLowerCase();
		if (!q || this.#chatRenderedContent.length === 0) {
			this.#chatSearchMatches = [];
			this.#chatSearchMatchIndex = -1;
			return;
		}
		const matches: number[] = [];
		for (let i = 0; i < this.#chatRenderedContent.length; i++) {
			const plain = this.#chatRenderedContent[i].replace(AgentHubOverlayComponent.#ANSI_RE, "");
			if (plain.toLowerCase().includes(q)) matches.push(i);
		}
		this.#chatSearchMatches = matches;
		// Jump to first match at or after current scroll, or wrap to first
		if (matches.length > 0) {
			let idx = matches.findIndex(line => line >= this.#scrollOffset);
			if (idx < 0) idx = 0;
			this.#chatSearchMatchIndex = idx;
			this.#scrollToSearchMatch();
		} else {
			this.#chatSearchMatchIndex = -1;
		}
	}

	/** Scroll the viewport so the current search match line is visible. */
	#scrollToSearchMatch(): void {
		if (this.#chatSearchMatchIndex < 0 || this.#chatSearchMatchIndex >= this.#chatSearchMatches.length) return;
		const matchLine = this.#chatSearchMatches[this.#chatSearchMatchIndex];
		const maxScroll = this.#lastMaxScroll;
		// Center the match in the viewport
		const target = Math.max(0, Math.min(matchLine - Math.floor(this.#viewportHeight / 2), maxScroll));
		this.#scrollOffset = target;
		this.#wasAtBottom = this.#scrollOffset >= maxScroll;
	}

	/** Move through the visible active or archived agent rows without losing the detail view. */
	#openAdjacentChat(delta: number): void {
		const currentKey = this.#chatArchived
			? `archived:${this.#chatArchived.childSessionFile}`
			: this.#chatAgentId
				? `agent:${this.#chatAgentId}`
				: undefined;
		const currentIndex = currentKey ? this.#findTableIndex(currentKey) : -1;
		const navigableRows = this.#visibleAgentRowCount();
		if (currentIndex < 0 || navigableRows === 0) return;
		const nextIndex = Math.max(0, Math.min(currentIndex + delta, navigableRows - 1));
		if (nextIndex === currentIndex) return;
		const next = this.#tableAgentRowAt(nextIndex);
		if (!next) return;
		this.#selectedRow = nextIndex;
		this.#syncSelectedKey();
		if (next.kind === "active") this.openChat(next.ref.id);
		else this.#openArchivedChat(next.descriptor);
	}

	/** Open the chat for the agent's parent, or close the hub when the parent is the main session. */
	#openParent(): void {
		const ref = this.#chatAgentId ? this.#registry.get(this.#chatAgentId) : undefined;
		const parentId = ref?.parentId;
		if (parentId && parentId !== MAIN_AGENT_ID && this.#registry.get(parentId)) {
			this.openChat(parentId);
			return;
		}
		this.#onDone();
	}

	#closeChat(): void {
		// Restore selection to the agent or completed child we just drilled into.
		if (this.#chatExternal) this.#selectedAgentKey = `external:${this.#chatExternal.sessionId}`;
		else if (this.#chatArchived) this.#selectedAgentKey = `archived:${this.#chatArchived.childSessionFile}`;
		else if (this.#chatAgentId) this.#selectedAgentKey = `agent:${this.#chatAgentId}`;
		this.#cockpitMode = "scroll";
		this.#view = "table";
		this.#chatAgentId = undefined;
		this.#chatArchived = undefined;
		this.#chatExternal = undefined;
		this.#externalInputActive = false;
		this.#siblingWatchDispose?.();
		this.#siblingWatchDispose = undefined;
		this.#notice = undefined;
		this.#chatSearchQuery = "";
		this.#chatSearchEditing = false;
		this.#chatSearchMatches = [];
		this.#chatSearchMatchIndex = -1;
		this.#chatRenderedContent = [];
		this.#viewerHeaderLines = [];
		this.#transcriptCache = undefined;
		this.#remoteTranscriptUnavailable = false;
		this.#remoteFetchInFlight = false;
		this.#remoteFetchToken++;
		this.#detachLiveSession();
		this.#resetChatLog();
		this.#refreshRows();
		this.#requestRender();
	}

	#submitChatMessage(text: string, queue = false): void {
		const id = this.#chatAgentId;
		const trimmed = text.trim();
		if (!id || !trimmed) return;
		this.#editor.setText("");
		this.#notice = undefined;
		if (this.#remote) {
			// Remote queue intent requires the host's typed submission transport.
			// Until it is exposed, preserve normal remote submission rather than
			// fabricating a queue status locally.
			this.#remote.chat(id, trimmed);
			this.#scheduleChatRefresh();
			this.#requestRender();
			return;
		}
		void (async () => {
			try {
				// Revives a parked agent; returns the live session for running/idle.
				const session = await this.#lifecycle().ensureLive(id);
				this.#attachLiveSession();
				if (queue) {
					await session.sendUserMessage(trimmed, { deliverAs: "followUp" });
				} else {
					// A normal send lets admission choose direct or queued delivery.
					await session.prompt(trimmed, { streamingBehavior: "steer" });
				}
			} catch (error) {
				this.#notice = error instanceof Error ? error.message : String(error);
			}
			this.#scheduleChatRefresh();
			this.#requestRender();
		})();
		this.#requestRender();
	}

	/** Viewport scrolling for the chat transcript. Returns true when handled. */
	#handleViewerNavigation(keyData: string): boolean {
		const gotoTop = matchesNavigationTop(keyData) && this.#viewerGotoPrefixActive;
		this.#viewerGotoPrefixActive = false;
		if (matchesNavigationTop(keyData) && !gotoTop) {
			this.#viewerGotoPrefixActive = true;
			return true;
		}
		if (gotoTop) {
			this.#scrollOffset = 0;
			this.#wasAtBottom = this.#lastMaxScroll === 0;
			this.#requestRender();
			return true;
		}
		const maxScroll = this.#lastMaxScroll;
		const scrollBy = (delta: number) => {
			this.#scrollOffset = Math.max(0, Math.min(this.#scrollOffset + delta, maxScroll));
			this.#wasAtBottom = this.#scrollOffset >= maxScroll;
			this.#requestRender();
		};
		if (matchesNavigationDown(keyData) || matchesSelectDown(keyData)) {
			scrollBy(1);
			return true;
		}
		if (matchesNavigationUp(keyData) || matchesSelectUp(keyData)) {
			scrollBy(-1);
			return true;
		}

		if (matchesNavigationPageDown(keyData)) {
			scrollBy(Math.max(1, Math.floor(this.#viewportHeight / 2)));
			return true;
		}
		if (matchesNavigationPageUp(keyData)) {
			scrollBy(-Math.max(1, Math.floor(this.#viewportHeight / 2)));
			return true;
		}
		if (matchesKey(keyData, "pageDown")) {
			scrollBy(PAGE_SIZE);
			return true;
		}
		if (matchesKey(keyData, "pageUp")) {
			scrollBy(-PAGE_SIZE);
			return true;
		}
		if (matchesNavigationBottom(keyData)) {
			this.#scrollOffset = maxScroll;
			this.#wasAtBottom = true;
			this.#requestRender();
			return true;
		}

		return false;
	}
	/** Viewport scrolling for the spawn-packet inspector. */
	#handleInspectorNavigation(keyData: string): boolean {
		let delta: number | undefined;
		if (matchesNavigationDown(keyData) || matchesSelectDown(keyData)) delta = 1;
		else if (matchesNavigationUp(keyData) || matchesSelectUp(keyData)) delta = -1;
		else if (matchesNavigationPageDown(keyData)) delta = Math.max(1, Math.floor(this.#viewportHeight / 2));
		else if (matchesNavigationPageUp(keyData)) delta = -Math.max(1, Math.floor(this.#viewportHeight / 2));
		else if (matchesKey(keyData, "pageDown")) delta = PAGE_SIZE;
		else if (matchesKey(keyData, "pageUp")) delta = -PAGE_SIZE;
		else if (matchesNavigationBottom(keyData)) {
			this.#inspectorScrollOffset = this.#inspectorLastMaxScroll;
			this.#requestRender();
			return true;
		}
		if (delta === undefined) return false;
		this.#inspectorScrollOffset = Math.max(
			0,
			Math.min(this.#inspectorScrollOffset + delta, this.#inspectorLastMaxScroll),
		);
		this.#requestRender();
		return true;
	}

	// ========================================================================
	// Transcript assembly — the same components as the main session transcript
	// (mirrors UiHelpers.renderSessionContext / addMessageToChat).
	// ========================================================================

	/** Tear down transcript components (sealing pending spinners) and reset build state. */
	#resetChatLog(): void {
		for (const pending of this.#chatPendingTools.values()) pending.seal();
		this.#chatPendingTools.clear();
		this.#chatReadArgs.clear();
		this.#chatReadGroup = null;
		this.#pendingUsage = undefined;
		this.#chatWaitingPoll = null;
		this.#chatExpandables = [];
		this.#chatLog.dispose();
		this.#chatLog.clear();
		this.#chatEntriesRef = undefined;
		this.#chatBuiltCount = 0;
		this.#chatPlaceholder = undefined;
	}

	/** Append components for entries not yet materialized. Rebuilds from scratch when the cache was replaced (agent switch, file rotation). */
	#syncChatComponents(entries: SessionMessageEntry[]): void {
		if (this.#chatEntriesRef !== entries) {
			this.#resetChatLog();
			this.#chatEntriesRef = entries;
		}
		for (let i = this.#chatBuiltCount; i < entries.length; i++) {
			this.#appendChatMessage(entries[i].message);
		}
		this.#chatBuiltCount = entries.length;
		// Flush the trailing turn's usage row only once its tools are materialized.
		// A read (or any tool) whose toolResult lands in a later debounced sync stays
		// pending in #chatReadArgs / #chatPendingTools; flushing now would emit the
		// row above it. The sync that drains the maps flushes it below the tools.
		if (this.#chatReadArgs.size === 0 && this.#chatPendingTools.size === 0) {
			this.#flushPendingUsage();
		}
	}

	#trackExpandable(component: { setExpanded(expanded: boolean): void }): void {
		component.setExpanded(this.#chatExpanded);
		this.#chatExpandables.push(component);
	}

	/** A `job` poll showing all-running is displaced by the next `job` call (mirrors the rebuild path). */
	#resolveWaitingPoll(nextToolName?: string): void {
		const previous = this.#chatWaitingPoll;
		if (!previous) return;
		this.#chatWaitingPoll = null;
		if (nextToolName === "job" && previous.isDisplaceableBlock()) {
			this.#chatLog.removeChild(previous);
		}
		previous.seal();
	}

	#ensureReadGroup(): ReadToolGroupComponent {
		if (!this.#chatReadGroup) {
			this.#chatReadGroup = new ReadToolGroupComponent({
				showContentPreview: settings.get("read.toolResultPreview"),
			});
			this.#trackExpandable(this.#chatReadGroup);
			this.#chatLog.addChild(this.#chatReadGroup);
		}
		return this.#chatReadGroup;
	}

	// The per-turn token-usage row must land below the turn's tool blocks, but
	// normal `read` calls only materialize their group in #appendToolResult. Defer
	// the row: stash it on the assistant message and flush once the turn's tools
	// are placed — before the next non-toolResult message and at the end of each
	// sync pass — sealing the read run so the row sits under it.
	#flushPendingUsage(): void {
		if (!this.#pendingUsage) return;
		this.#chatReadGroup?.seal();
		this.#chatReadGroup = null;
		this.#chatLog.addChild(createUsageRowBlock(this.#pendingUsage));
		this.#pendingUsage = undefined;
	}

	#appendChatMessage(message: AgentMessage): void {
		if (message.role !== "toolResult") this.#flushPendingUsage();
		switch (message.role) {
			case "assistant":
				this.#appendAssistantMessage(message);
				break;
			case "toolResult":
				this.#appendToolResult(message);
				break;
			case "user":
			case "developer": {
				// A user prompt closes the poll-displacement window, same as the live path.
				if (message.role === "user") this.#resolveWaitingPoll();
				const textContent =
					message.role !== "user"
						? ""
						: typeof message.content === "string"
							? message.content
							: message.content
									.filter((block): block is { type: "text"; text: string } => block.type === "text")
									.map(block => block.text)
									.join("");
				if (textContent) {
					const isSynthetic = message.role === "developer" ? true : (message.synthetic ?? false);
					this.#chatLog.addChild(new UserMessageComponent(textContent, isSynthetic));
				}
				break;
			}
			case "bashExecution": {
				const component = new BashExecutionComponent(message.command, this.#ui, message.excludeFromContext);
				if (message.output) component.appendOutput(message.output);
				component.setComplete(message.exitCode, message.cancelled, { truncation: message.meta?.truncation });
				this.#chatLog.addChild(component);
				break;
			}
			case "pythonExecution": {
				const component = new EvalExecutionComponent(message.code, this.#ui, message.excludeFromContext);
				if (message.output) component.appendOutput(message.output);
				component.setComplete(message.exitCode, message.cancelled, { truncation: message.meta?.truncation });
				this.#chatLog.addChild(component);
				break;
			}
			case "hookMessage":
			case "custom":
				this.#appendCustomMessage(message);
				break;
			case "compactionSummary": {
				const component = new CompactionSummaryMessageComponent(message);
				this.#trackExpandable(component);
				this.#chatLog.addChild(component);
				break;
			}
			case "branchSummary": {
				const component = new BranchSummaryMessageComponent(message);
				this.#trackExpandable(component);
				this.#chatLog.addChild(component);
				break;
			}
			case "fileMention": {
				const block = new TranscriptBlock();
				for (const file of message.files) {
					let suffix: string;
					if (file.skippedReason === "tooLarge") {
						const size = typeof file.byteSize === "number" ? formatBytes(file.byteSize) : "unknown size";
						suffix = `(skipped: ${size})`;
					} else {
						suffix = file.image
							? "(image)"
							: file.lineCount === undefined
								? "(unknown lines)"
								: `(${file.lineCount} lines)`;
					}
					const text = `${theme.fg("dim", `${theme.tree.last} `)}${theme.fg("muted", "Read")} ${theme.fg(
						"accent",
						file.path,
					)} ${theme.fg("dim", suffix)}`;
					block.addChild(new Text(text, 0, 0));
				}
				if (block.children.length > 0) this.#chatLog.addChild(block);
				break;
			}
			default:
				message satisfies never;
		}
	}

	#appendAssistantMessage(message: Extract<AgentMessage, { role: "assistant" }>): void {
		const assistantComponent = new AssistantMessageComponent(message, this.#hideThinkingBlock?.() ?? false, () =>
			this.#requestRender(),
		);
		this.#chatLog.addChild(assistantComponent);

		const hasVisibleAssistantContent = message.content.some(
			content =>
				(content.type === "text" && canonicalizeMessage(content.text)) ||
				(content.type === "thinking" && normalizeThinkingDisplay(content.thinking)),
		);
		if (hasVisibleAssistantContent) {
			// New visible turn content closes the current read run (mirrors rebuild).
			this.#chatReadGroup?.seal();
			this.#chatReadGroup = null;
		}

		const isAbortedSilently = message.stopReason === "aborted" && isSilentAbort(message.errorMessage);
		const hasErrorStop = !isAbortedSilently && (message.stopReason === "aborted" || message.stopReason === "error");
		const errorMessage = hasErrorStop
			? message.stopReason === "aborted"
				? resolveAbortLabel(message.errorMessage)
				: message.errorMessage || "Error"
			: null;

		for (const content of message.content) {
			if (content.type !== "toolCall") continue;
			this.#resolveWaitingPoll(content.name);

			if (
				content.name === "read" &&
				readArgsHaveTarget(content.arguments) &&
				!readArgsTargetInternalUrl(content.arguments)
			) {
				if (hasErrorStop && errorMessage) {
					const group = this.#ensureReadGroup();
					group.updateArgs(content.arguments, content.id);
					group.updateResult(
						{ content: [{ type: "text", text: errorMessage }], isError: true },
						false,
						content.id,
					);
				} else {
					const normalizedArgs =
						content.arguments && typeof content.arguments === "object" && !Array.isArray(content.arguments)
							? (content.arguments as Record<string, unknown>)
							: {};
					this.#chatReadArgs.set(content.id, normalizedArgs);
				}
				continue;
			}

			this.#chatReadGroup?.seal();
			this.#chatReadGroup = null;
			const component = new ToolExecutionComponent(
				content.name,
				content.arguments,
				{
					// Images can't be sliced through the scroll viewport; keep them off.
					showImages: false,
					editFuzzyThreshold: settings.get("edit.fuzzyThreshold"),
					editAllowFuzzy: settings.get("edit.fuzzyMatch"),
					liveRegion: this.#chatLog,
				},
				this.#getTool?.(content.name),
				this.#ui,
				this.#cwd,
				content.id,
			);
			this.#trackExpandable(component);
			this.#chatLog.addChild(component);

			if (hasErrorStop && errorMessage) {
				component.updateResult(
					{ content: [{ type: "text", text: errorMessage }], isError: true },
					false,
					content.id,
				);
			} else {
				this.#chatPendingTools.set(content.id, component);
			}
		}

		this.#pendingUsage = settings.get("display.showTokenUsage") ? message.usage : undefined;
	}

	#appendToolResult(message: Extract<AgentMessage, { role: "toolResult" }>): void {
		const pending = this.#chatPendingTools.get(message.toolCallId);
		const isReadGroupResult = message.toolName === "read" && (!pending || pending instanceof ReadToolGroupComponent);
		if (isReadGroupResult) {
			let component = pending;
			if (!component) {
				const group = this.#ensureReadGroup();
				const args = this.#chatReadArgs.get(message.toolCallId);
				if (args) group.updateArgs(args, message.toolCallId);
				component = group;
			}
			component.updateResult(message, false, message.toolCallId);
			this.#chatPendingTools.delete(message.toolCallId);
			this.#chatReadArgs.delete(message.toolCallId);
			return;
		}
		if (!pending) return;
		pending.updateResult(message, false, message.toolCallId);
		this.#chatPendingTools.delete(message.toolCallId);
		if (message.toolName === "job" && pending instanceof ToolExecutionComponent && pending.isDisplaceableBlock()) {
			this.#chatWaitingPoll = pending;
		}
	}

	#appendCustomMessage(message: Extract<AgentMessage, { role: "custom" | "hookMessage" }>): void {
		if (!message.display) return;
		if (message.customType === "async-result") {
			const details = (
				message as CustomMessage<{
					jobId?: string;
					type?: "bash" | "task";
					label?: string;
					durationMs?: number;
					jobs?: Array<{ jobId?: string; type?: "bash" | "task"; label?: string; durationMs?: number }>;
				}>
			).details;
			const jobs =
				details?.jobs && details.jobs.length > 0
					? details.jobs
					: [
							{
								jobId: details?.jobId,
								type: details?.type,
								label: details?.label,
								durationMs: details?.durationMs,
							},
						];
			const block = new TranscriptBlock();
			for (const job of jobs) {
				const jobId = job.jobId ?? "unknown";
				const typeLabel = job.type ? `[${job.type}]` : "[job]";
				const duration = typeof job.durationMs === "number" ? formatDuration(job.durationMs) : undefined;
				const line = [
					theme.fg("success", `${theme.status.done} Background job completed`),
					theme.fg("dim", typeLabel),
					theme.fg("accent", jobId),
					duration ? theme.fg("dim", `(${duration})`) : undefined,
				]
					.filter(Boolean)
					.join(" ");
				block.addChild(new Text(line, 1, 0));
			}
			this.#chatLog.addChild(block);
			return;
		}
		if (message.customType === LSP_LATE_DIAGNOSTIC_MESSAGE_TYPE) {
			const details = (message as CustomMessage<{ files?: LateDiagnosticsFile[] }>).details;
			const component = new LateDiagnosticsMessageComponent(details?.files ?? []);
			this.#trackExpandable(component);
			this.#chatLog.addChild(component);
			return;
		}
		if (message.customType === COLLAB_PROMPT_MESSAGE_TYPE) {
			this.#chatLog.addChild(new CollabPromptMessageComponent(message as CustomMessage<CollabPromptDetails>));
			return;
		}
		if (message.customType === SKILL_PROMPT_MESSAGE_TYPE) {
			const component = new SkillMessageComponent(message as CustomMessage<SkillPromptDetails>);
			this.#trackExpandable(component);
			this.#chatLog.addChild(component);
			return;
		}
		if (
			message.customType === "irc:incoming" ||
			message.customType === "irc:autoreply" ||
			message.customType === "irc:relay"
		) {
			const details = (
				message as CustomMessage<{ from?: string; to?: string; message?: string; body?: string; replyTo?: string }>
			).details;
			const kind =
				message.customType === "irc:incoming"
					? ("incoming" as const)
					: message.customType === "irc:autoreply"
						? ("autoreply" as const)
						: ("relay" as const);
			const card = createIrcMessageCard(
				{
					kind,
					from: details?.from,
					to: details?.to,
					body: kind === "incoming" ? details?.message : details?.body,
					replyTo: details?.replyTo,
					timestamp: message.timestamp,
				},
				() => this.#chatExpanded,
				theme,
			);
			this.#chatLog.addChild(card);
			return;
		}
		if (message.customType === "advisor") {
			const details = (message as CustomMessage<AdvisorMessageDetails>).details;
			this.#chatLog.addChild(createAdvisorMessageCard(details, () => this.#chatExpanded, theme));
			return;
		}
		if (message.customType === BACKGROUND_TAN_DISPATCH_MESSAGE_TYPE) {
			this.#chatLog.addChild(createBackgroundTanDispatchBlock(message as CustomMessage<unknown>));
			return;
		}
		const handoffComponent = createHandoffSummaryMessageComponent(
			message as CustomMessage<unknown>,
			this.#chatExpanded,
		);
		if (handoffComponent) {
			this.#trackExpandable(handoffComponent);
			this.#chatLog.addChild(handoffComponent);
			return;
		}
		const component = new CustomMessageComponent(
			message as CustomMessage<unknown>,
			this.#getMessageRenderer?.(message.customType),
		);
		this.#trackExpandable(component);
		this.#chatLog.addChild(component);
	}

	#loadTranscript(sessionFile: string): SessionMessageEntry[] | null {
		if (this.#transcriptCache && this.#transcriptCache.path !== sessionFile) {
			this.#transcriptCache = undefined;
		}

		const fromByte = this.#transcriptCache?.bytesRead ?? 0;
		const result = readJournalTailChunk(sessionFile, fromByte, PREVIEW_TAIL_BYTES);
		if (!result) {
			logger.debug("Agent hub: failed to read session file", { path: sessionFile });
			return this.#transcriptCache?.entries ?? null;
		}

		if (result.newSize < fromByte) {
			this.#transcriptCache = undefined;
			return this.#loadTranscript(sessionFile);
		}

		this.#ingestTranscriptChunk(sessionFile, result.text, result.fromByte);
		return this.#transcriptCache?.entries ?? null;
	}

	/** Parse a complete-line JSONL chunk into the transcript cache and advance bytesRead. Shared by the local file and remote paths. */
	#ingestTranscriptChunk(cacheKey: string, text: string, fromByte: number): void {
		if (!this.#transcriptCache) {
			this.#transcriptCache = { path: cacheKey, bytesRead: 0, entries: [] };
		}
		if (text.length === 0) return;
		const lastNewline = text.lastIndexOf("\n");
		if (lastNewline < 0) return;
		const completeChunk = text.slice(0, lastNewline + 1);
		const newEntries = decodeJournalEntries(completeChunk);
		for (const entry of newEntries) {
			if (entry.type === "message") {
				this.#transcriptCache.entries.push(entry);
				// Extract model from first assistant message
				const msg = entry.message;
				if (!this.#transcriptCache.model && msg.role === "assistant") {
					this.#transcriptCache.model = msg.provider ? `${msg.provider}/${msg.model}` : msg.model;
				}
			} else if (entry.type === "model_change") {
				this.#transcriptCache.model = entry.model;
			} else if (entry.type === "thinking_level_change") {
				this.#transcriptCache.thinking = entry.thinkingLevel ?? undefined;
			}
		}
		if (this.#transcriptCache.entries.length > PREVIEW_MAX_ENTRIES) {
			const excess = this.#transcriptCache.entries.length - PREVIEW_MAX_ENTRIES;
			this.#transcriptCache.entries.splice(0, excess);
		}
		this.#transcriptCache.bytesRead = fromByte + Buffer.byteLength(completeChunk, "utf-8");
	}

	/** Kick an incremental transcript fetch from the collab host (single-flight). */
	#fetchRemoteTranscript(id: string): void {
		const remote = this.#remote;
		if (!remote || this.#remoteFetchInFlight) return;
		const cacheKey = `remote:${id}`;
		if (this.#transcriptCache && this.#transcriptCache.path !== cacheKey) {
			this.#transcriptCache = undefined;
		}
		const fromByte = this.#transcriptCache?.bytesRead ?? 0;
		this.#remoteFetchInFlight = true;
		const token = ++this.#remoteFetchToken;
		void remote
			.readTranscript(id, fromByte)
			.then(result => {
				if (token !== this.#remoteFetchToken) return;
				this.#remoteFetchInFlight = false;
				if (this.#chatAgentId !== id) return;
				if (!result) {
					if (!this.#transcriptCache || this.#transcriptCache.entries.length === 0) {
						if (!this.#remoteTranscriptUnavailable) {
							this.#remoteTranscriptUnavailable = true;
							this.#scheduleChatRefresh();
						}
					}
					return;
				}
				if (result.newSize < fromByte) {
					this.#transcriptCache = undefined;
					this.#remoteFetchInFlight = false;
					this.#fetchRemoteTranscript(id);
					return;
				}
				const hadCache = this.#transcriptCache !== undefined;
				const before = this.#transcriptCache?.entries.length ?? 0;
				this.#ingestTranscriptChunk(cacheKey, result.text, fromByte);
				const after = this.#transcriptCache?.entries.length ?? 0;
				if (after > before || !hadCache) this.#scheduleChatRefresh();
			})
			.catch(error => {
				if (token === this.#remoteFetchToken) this.#remoteFetchInFlight = false;
				logger.warn("Agent hub: remote transcript fetch failed", { id, error: String(error) });
			});
	}
}
