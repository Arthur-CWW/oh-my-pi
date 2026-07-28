/** Tree roster with bounded sibling transcript and selected-session inspector. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage, AgentTool } from "@oh-my-pi/pi-agent-core";
import type { Usage } from "@oh-my-pi/pi-ai";
import { Container, matchesKey, padding, ScrollView, Text, type TUI, visibleWidth } from "@oh-my-pi/pi-tui";
import { Effect, Exit, Scope } from "effect";
import {
	formatAge,
	formatBytes,
	formatDuration,
	formatNumber,
	getProjectDir,
	logger,
	VERSION,
} from "@oh-my-pi/pi-utils";
import type { AdvisorMessageDetails } from "../../advisor";
import { COLLAB_PROMPT_MESSAGE_TYPE } from "../../collab/protocol";
import type { KeyId } from "../../config/keybindings";
import { settings } from "../../config/settings";
import type { MessageRenderer } from "../../extensibility/extensions/types";
import { type ArchivedDirectChildDescriptor, listArchivedDirectChildren } from "../../internal-urls/history-protocol";
import { IrcBus } from "../../irc/bus";
import {
	IRC_EXTERNAL_STALE_MS,
	IrcExternalBus,
	type IrcExternalPeer,
	type IrcExternalPeerDisplayState,
	type IrcExternalPeerState,
	isIrcExternalPeerFresh,
} from "../../irc/bus-external";
import { watchSiblingTranscript } from "../../irc/sibling-session";
import type { JournalTailChunk } from "../../journal/projection";
import { decodeJournalEntries } from "../../journal/projection";
import { AgentLifecycleManager } from "../../registry/agent-lifecycle";
import {
	type AgentRef,
	AgentRegistry,
	type AgentStatus,
	MAIN_AGENT_ID,
	type RegistryEvent,
} from "../../registry/agent-registry";
import {
	childRouteUpdateStatus,
	type ChildRouteUpdateRecord,
	type ChildRouteUpdateStatus,
	formatChildRouteUpdate,
	onChildRouteUpdate,
} from "../../task/child-route-update";
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
import type { BookmarkTarget } from "../../session/bookmarks";
import { createIrcMessageCard } from "../../tools/irc";
import { replaceTabs, shortenPath, TRUNCATE_LENGTHS, truncateToWidth } from "../../tools/render-utils";
import { copyToClipboard } from "../../utils/clipboard";
import { canonicalizeMessage, normalizeThinkingDisplay } from "../../utils/thinking-display";
import type { CollabPromptDetails } from "../collab-presentation-types";
import { resolveViewerScrollDelta } from "../interaction-registry";
import type { ObservableSession, SessionObserverRegistry } from "../session-observer-registry";
import { DEFAULT_TRANSCRIPT_DISPLAY_CONTEXT, type TranscriptDisplayContext } from "../transcript-display";
import { theme } from "../theme/theme";
import {
	matchesUiDismiss,
	matchesNavigationBottom,
	matchesSelectDown,
	matchesSelectUp,
} from "../utils/keybinding-matchers";
import {
	CMUX_OWNER_UNAVAILABLE_MESSAGE,
	focusLiveCmuxOwner,
	type FocusCmuxOwnerResult,
} from "../utils/cmux-owner-navigation";
import { createAdvisorMessageCard } from "./advisor-message";
import { agentHubYankPayload } from "./agent-hub-identity";
import { AgentHubViewerSequence, applyAgentHubViewerSequenceAction } from "./agent-hub-viewer-sequence";
import { AgentHubFoldSequence } from "./agent-hub-fold-sequence";
import {
	AGENT_HUB_G_CHORD_CUE,
	renderAgentHubChatFooter,
	renderAgentHubFooter,
	renderAgentHubHelp,
} from "./agent-hub-interaction-help";
import { AgentHubJournalTailCache, recordAgentHubProjectionRebuild } from "./agent-hub-performance";
import type { AgentHubRolloutDataSource, AgentHubRolloutPeerIdentity } from "./agent-hub-rollout-state";
import {
	EMPTY_AGENT_HUB_SELECTED_LIVE_STATE,
	type AgentHubSelectedLiveState,
	type AgentHubSelectedStateItem,
	type AgentHubTurnStatus,
	formatAgentHubTurnStatus,
	projectAgentHubRowActivity,
	projectAgentHubSelectedState,
	renderAgentHubSelectedState,
	reduceAgentHubSelectedLiveState,
} from "./agent-hub-selected-state";
import {
	agentHistoryRank,
	cycleVisibleAgentSibling,
	DurableJournalModelCache,
	durableModelSelector,
	expandAgentAncestors,
	externalPeerActivity,
	getModelLaneWidth,
	getStateLaneWidth,
	HUB_FIELD_UNKNOWN,
	isHistoricalAgent,
	listAutomationJournalRows,
	projectAgentRoster,
	projectExternalPeerIdentity,
	projectLocalAgentIdentity,
} from "./agent-hub-roster";
import { AssistantMessageComponent } from "./assistant-message";
import { renderModelSelectorAbbreviation, withModelSelectorEffort } from "./model-selector-abbreviation";
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
import { TranscriptViewportModel } from "./transcript-viewport";
import { createUsageRowBlock } from "./usage-row";
import { TablePreviewComponent, type TablePreviewSession } from "./table-preview";
import { routeResolutionEvents, type RouteResolutionSource } from "../../task/route-events";
import {
	buildAgentRouteExplanation,
	formatRouteInspection,
	type AgentRouteExplanation,
	type RouteInspectionInput,
} from "../../task/route-inspector";
import { UserMessageComponent } from "./user-message";

const AGE_TICK_MS = 5_000;
const SPINNER_TICK_MS = 160;
const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"] as const;
const CHAT_REFRESH_DEBOUNCE_MS = 80;
const PROJECTION_WINDOW_MS = 16;
const LEFT_TAP_WINDOW_MS = 500;
const RECENT_COMPLETED_LIMIT = 20;
const DUAL_LANE_MIN_WIDTH = 160;
const STACKED_LANE_MIN_HEIGHT = 6;
const ROSTER_STRIP_HEIGHT = 9;
const HUB_CHROME_HEIGHT = 6;
const INSPECTOR_PROMPT_MAX_CHARS = 32 * 1024;
const INSPECTOR_DELIVERY_LIMIT = 20;

function contentWidth(): number {
	return Math.max(TRUNCATE_LENGTHS.SHORT, (process.stdout.columns || 80) - 6);
}

function sanitizeLine(text: string, maxWidth?: number): string {
	return truncateToWidth(replaceTabs(text), maxWidth ?? contentWidth());
}

function statusBadge(status: AgentStatus): string {
	switch (status) {
		case "running":
			return theme.fg("accent", "● RUN");
		case "waiting-provider":
			return theme.fg("warning", "◷ WAIT");
		case "idle":
			return theme.fg("success", "○ IDLE");
		case "parked":
			return theme.fg("muted", "■ PARK");
		case "aborted":
			return theme.fg("error", "× ABRT");
	}
}

export type AgentHubExternalPeerState = IrcExternalPeerState;
type AgentHubExternalPeerDisplayState = IrcExternalPeerDisplayState;

/** Hub-side peer view: tolerates rows from older bus versions that lack state columns. */
export type AgentHubExternalPeer = Omit<IrcExternalPeer, "state" | "stateTs"> & {
	state?: AgentHubExternalPeerState | null;
	stateTs?: string | null;
};

export interface AgentHubExternalPeerDataSource {
	listPeers(options?: { excludeSessionId?: string; staleMs?: number; includeStale?: boolean }): AgentHubExternalPeer[];
}

interface ExternalPeerRow {
	peer: AgentHubExternalPeer;
	displayIndex: number;
	state: AgentHubExternalPeerDisplayState;
}

/** A selectable local agent row; archived children never become registry refs. */
type HubAgentRow = { kind: "active"; ref: AgentRef } | { kind: "archived"; descriptor: ArchivedDirectChildDescriptor };
type HubTableRow = AgentRef | ArchivedDirectChildDescriptor | ExternalPeerRow;

async function listArchivedDescendants(parentSessionFile: string): Promise<ArchivedDirectChildDescriptor[]> {
	const pending = [parentSessionFile];
	const visited = new Set<string>();
	const rows: ArchivedDirectChildDescriptor[] = [];
	while (pending.length > 0) {
		const current = pending.pop()!;
		if (visited.has(current)) continue;
		visited.add(current);
		const children = await listArchivedDirectChildren(current);
		rows.push(...children);
		for (const child of children) pending.push(child.childSessionFile);
	}
	return rows;
}

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

function externalPreviewName(peer: AgentHubExternalPeer): string {
	const raw = peer.name.trim();
	const separator = raw.lastIndexOf("/");
	return separator >= 0 ? raw.slice(separator + 1) || "Main" : raw || "Main";
}

function externalPreviewWorkstream(peer: AgentHubExternalPeer): string {
	return path.basename(path.resolve(peer.cwd)) || shortenPath(peer.cwd);
}

function externalStateBadge(state: AgentHubExternalPeerDisplayState): string {
	switch (state) {
		case "working":
			return theme.fg("accent", "● WORK");
		case "waiting_input":
			return theme.fg("warning", "◌ WAIT");
		case "idle":
			return theme.fg("success", "○ IDLE");
		case "paused":
			return theme.fg("warning", "Ⅱ PAUSE");
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
		case "paused":
		case "unknown":
			return state;
		default:
			return "unknown";
	}
}

function displayedExternalPeerState(peer: AgentHubExternalPeer): AgentHubExternalPeerDisplayState {
	return isIrcExternalPeerFresh(peer.lastSeen) ? normalizeExternalPeerState(peer.state) : "disconnected";
}

const ARCHIVED_STATE_BADGES: Record<string, { shape: string; text: string; color: string }> = {
	completed: { shape: "✓", text: "DONE", color: "success" },
	failed: { shape: "×", text: "FAIL", color: "error" },
	interrupted: { shape: "~", text: "INTR", color: "warning" },
	legacy: { shape: "■", text: "LEGC", color: "muted" },
};

function formatArchivedState(state: string): string {
	const config = ARCHIVED_STATE_BADGES[state.toLowerCase()] ?? { shape: "■", text: "LEGC", color: "muted" };
	return theme.fg(config.color as any, `${config.shape} ${config.text}`);
}

function modelLane(resolvedModel: string, maxLabelWidth: number): string {
	const textWidth = maxLabelWidth - 1;
	const rendered =
		resolvedModel === "-" ? theme.fg("dim", "-") : renderModelSelectorAbbreviation(resolvedModel, "compact");
	const result = truncateToWidth(rendered, textWidth);
	return result + padding(Math.max(0, textWidth - visibleWidth(result))) + " ";
}

function modelHeaderLane(resolvedModel: string): string {
	return renderModelSelectorAbbreviation(resolvedModel, "standalone");
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

export interface AgentHubRemote {
	kill(id: string): void;
	revive(id: string): void;
	/** Mirrors readFileIncremental: text from fromByte (complete JSONL lines), newSize = next fromByte base; null = unavailable. */
	readTranscript(id: string, fromByte: number): Promise<{ text: string; newSize: number } | null>;
}

export interface AgentHubDeps {
	interruptKeys?: KeyId[];
	unfocusSession?: () => Promise<void>;
	initialSelection?: { kind: "agent" | "external"; id: string; viewportOffset: number };
	observers: SessionObserverRegistry;
	hubKeys: KeyId[];
	onDone: () => void;
	requestRender: () => void;
	height?: () => number;
	registry?: AgentRegistry;
	lifecycle?: AgentLifecycleManager;
	irc?: IrcBus;
	ui?: TUI;
	getTool?: (name: string) => AgentTool | undefined;
	getMessageRenderer?: (customType: string) => MessageRenderer | undefined;
	cwd?: string;
	hideThinkingBlock?: () => boolean;
	expandKeys?: KeyId[];
	/** Focus the main view on this agent's live session (ctx.focusAgentSession). When absent (collab guest, tests), Enter opens the in-hub chat view instead. */
	focusAgent?: (id: string) => Promise<void>;
	/** Focus an external peer's live owner surface in cmux; defaults to live owner navigation. */
	focusExternalOwner?: (sessionFile: string, sessionId: string) => Promise<FocusCmuxOwnerResult>;
	/** Clipboard sink for selected-agent identity yanks; defaults to OSC52-capable copyToClipboard. */
	copyIdentity?: (payload: string) => void | Promise<void>;
	/** Root session id shared by Main and all child handles. */
	sessionId?: string;
	initialAgentId?: string;
	/** Collab guest: route actions/transcripts to the host instead of local sessions. */
	remote?: AgentHubRemote;
	/** Queue/admission projection for the selected agent, if the host exposes one. */
	turnStatus?: (agentId: string) => AgentHubTurnStatus | undefined;
	/** Stable presentation state shared by transcript renderers by reference. */
	transcriptDisplay?: TranscriptDisplayContext;
	/** Journal-backed rollout state; null explicitly disables rollout reads. */
	rollout?: AgentHubRolloutDataSource | null;
	/** Cross-session IRC bus reader for sibling OMP instances; null disables it for deterministic tests. */
	externalIrc?: AgentHubExternalPeerDataSource | null;
	/** Current external IRC session id; defaults to the session registration convention `${cwd}:${pid}`. */
	externalSessionId?: string;
	/** Legacy construction field; archive discovery always uses Main's current sessionFile. */
	parentSessionFile?: string | null;
	sessionsDir?: string;
	/** Open the durable errors dock, optionally scoped by the selected agent. */
	openErrors?: (agentId?: string) => void;
	/** Open the global bookmarks surface. */
	openBookmarks?: () => void;
	/** Injectable real-reader cache for deterministic journal race coverage. */
	journalTails?: AgentHubJournalTailCache;
}

export interface AgentHubRetentionMetrics {
	activeIdentities: number;
	activeSearchFieldEntries: number;
	observerEntries: number;
	externalIdentityRows: number;
	archivedIdentityRows: number;
	materializedRows: number;
	externalOrderEntries: number;
	cachedTranscriptEntries: number;
	materializedChatComponents: number;
	materializedTranscriptRows: number;
	retainedJournalTextBytes: number;
	previewFinalizedPrefixScans: number;
	liveTimers: number;
}

interface TranscriptLoadRequest {
	readonly generation: number;
	readonly path: string;
	readonly fromByte: number;
}

export type AgentHubInspectorSection = "prompt" | "route" | "comms";
export type AgentHubPanelFocus = "roster" | "transcript" | AgentHubInspectorSection;

export interface AgentHubInteractionState {
	readonly view: "table" | "chat";
	readonly panelFocus: AgentHubPanelFocus;
	readonly inspectorSection: AgentHubInspectorSection;
	readonly selectedAgentId?: string;
	readonly tableIndex: number;
	readonly transcriptOffset: number;
	readonly inspectorOffset: number;
	readonly archivedChat: boolean;
}

export interface AgentHubSelectedAgentViewModel {
	readonly agentId: string;
	readonly lifecycle: string;
	readonly modelSelector?: string;
	readonly routeUpdate?: ChildRouteUpdateStatus;
	readonly route: AgentRouteExplanation;
}

// Canonical ISO-8601 timestamps sort lexicographically in chronological order.
function newestChildRouteUpdateRecord(
	live: ChildRouteUpdateRecord | undefined,
	durable: ChildRouteUpdateRecord | undefined,
): ChildRouteUpdateRecord | undefined {
	if (!live) return durable;
	if (!durable) return live;
	return live.updatedAt >= durable.updatedAt ? live : durable;
}

const ROUTE_INSPECTOR_PANE_LINES = 8;

function boundedRouteInspectionLines(input: RouteInspectionInput, resolvedModel?: string): string[] {
	const inspectionLines = formatRouteInspection(input).split("\n");
	const selected = inspectionLines.find(line => line.startsWith("selected:"));
	const consulted = inspectionLines.filter(line => /^\d+\. /.test(line));
	const winner = consulted.find(
		line => line.includes("result=winner") || line.includes("result=initial winner before fallback"),
	);
	const policy = inspectionLines.find(line => line.includes("policy key=") || line.startsWith("policy "));
	const policyMetadata = input.decision.consulted.find(candidate => candidate.policy)?.policy;
	const policyTransaction = policyMetadata?.transactionId ?? policy?.match(/transaction=[^ ;\]]+/)?.[0]?.slice(12);
	const policyKey = policyMetadata?.key ?? policy?.match(/(?:policy key=|policy )([^ ]+)/)?.[1];
	const policyLayer = policyMetadata?.sourceLayer ?? policy?.match(/layer=([^ ]+)/)?.[1];
	const policySummary =
		policyTransaction !== undefined
			? `policy: transaction=${policyTransaction}${policyKey ? ` key=${policyKey}` : ""}${policyLayer ? ` layer=${policyLayer}` : ""}`
			: policy
				? `policy: ${policy}`
				: undefined;
	const reasons = [
		...inspectionLines.filter(
			line =>
				line.startsWith("fallback ") ||
				line.startsWith("policy exclusion ") ||
				line.startsWith("blocked:") ||
				line.startsWith("decision reason:"),
		),
		...(input.decision.reason &&
		!inspectionLines.some(line => line.includes(`decision reason: ${input.decision.reason}`))
			? [`decision reason: ${input.decision.reason}`]
			: []),
	];
	const lines = [
		"ROUTE",
		...(resolvedModel ? [`model: ${resolvedModel}`] : []),
		...(selected ? [selected] : []),
		...(winner ? [`winner: ${winner}`] : []),
		`consulted: ${input.decision.consulted.length} layers; shadowed candidates=${input.decision.overridden.length}`,
		...(policySummary ? [policySummary] : []),
		...reasons,
	];
	return lines.slice(0, ROUTE_INSPECTOR_PANE_LINES);
}

export class AgentHubOverlayComponent extends Container {
	#interruptKeys: KeyId[] = [];
	#unfocusSession: (() => Promise<void>) | undefined;
	#registry: AgentRegistry;
	#observers: SessionObserverRegistry;
	#irc: IrcBus;
	#externalBus: AgentHubExternalPeerDataSource | null | undefined;
	#externalSessionId: string;
	#lifecycle: () => AgentLifecycleManager;
	#onDone: () => void;
	#requestRender: () => void;
	#height: () => number;
	#hubKeys: KeyId[];
	#unsubscribers: Array<() => void> = [];
	#ageTimer: NodeJS.Timeout | undefined;
	#spinnerTimer: NodeJS.Timeout | undefined;
	#spinnerFrame = 0;
	#projectionTimer: NodeJS.Timeout | undefined;
	#pendingRegistryEvents: RegistryEvent[] = [];
	#observerProjectionDirty = false;
	#pendingJournalAgentIds = new Set<string>();
	#registryRefs = new Map<string, AgentRef>();
	#refsByStatus: Record<AgentStatus, Map<string, AgentRef>> = {
		running: new Map(),
		"waiting-provider": new Map(),
		idle: new Map(),
		parked: new Map(),
		aborted: new Map(),
	};
	#remote: AgentHubRemote | undefined;
	#turnStatus: ((agentId: string) => AgentHubTurnStatus | undefined) | undefined;
	#transcriptDisplay: TranscriptDisplayContext;
	#rollout: AgentHubRolloutDataSource | null;
	#openErrors: ((agentId?: string) => void) | undefined;
	#openBookmarks: (() => void) | undefined;
	#selectedLiveState: AgentHubSelectedLiveState = EMPTY_AGENT_HUB_SELECTED_LIVE_STATE;
	#remoteFetchInFlight = false;
	#remoteFetchToken = 0;
	#remoteTranscriptUnavailable = false;

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
	readonly #tableScope = Scope.makeUnsafe("sequential");
	#tablePreview!: TablePreviewComponent<HubTableRow, string>;
	#visibleTableRows: readonly HubTableRow[] = [];
	#tableBodyHeight = ROSTER_STRIP_HEIGHT;
	#animatedTableRowVisible = false;
	#disposed = false;
	#cockpitPreview = true;
	#previewRenderedHeight = 0;
	#showTerminalAgents = false;
	#showHistoricalAgents = true;
	#hiddenTerminalCount = 0;
	#statusCounts: Record<AgentStatus, number> = {
		running: 0,
		"waiting-provider": 0,
		idle: 0,
		parked: 0,
		aborted: 0,
	};
	#sectionStarts: Array<{ index: number; label: string }> = [];
	#notice: string | undefined;
	/** Filtered identities, not eagerly-built row objects; rows materialize at the viewport only. */
	#visibleActiveRows: readonly AgentRef[] = [];
	#visibleArchivedRows: readonly ArchivedDirectChildDescriptor[] = [];
	#visibleExternalRows: readonly ExternalPeerRow[] = [];
	#filterDirty = true;
	#searchFieldsDirty = true;
	#archivedRows: readonly ArchivedDirectChildDescriptor[] = [];
	#archivedLoadToken = 0;
	#archiveSourceSessionFile: string | null | undefined = null;
	#sessionsDir: string | undefined;
	#journalModels = new DurableJournalModelCache();
	#journalTails: AgentHubJournalTailCache;
	#transcriptLoadGeneration = 0;
	#transcriptLoadInFlight: TranscriptLoadRequest | undefined;
	#liveRouteUpdates = new Map<string, ChildRouteUpdateRecord>();

	#foldedAgentIds = new Set<string>();
	#treeDepthById = new Map<string, number>();
	#treeGuideById = new Map<string, string>();
	#hiddenDescendantsById = new Map<string, number>();
	#hiddenRunningById = new Map<string, number>();
	#groupStartIndexes: number[] = [];
	#foldSequence = new AgentHubFoldSequence();
	#showLegend = false;
	#chatAgentId: string | undefined;
	#chatArchived: ArchivedDirectChildDescriptor | undefined;
	#chatExternal: AgentHubExternalPeer | undefined;
	#chatAccessMode: "read-only" | "attachable" = "read-only";
	#inputUnavailableFlash = false;
	#sessionUnsubscribe: (() => void) | undefined;
	#attachedSession: AgentSession | undefined;
	#siblingWatchDispose: (() => void) | undefined;
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
	#focusExternalOwner: (sessionFile: string, sessionId: string) => Promise<FocusCmuxOwnerResult>;
	#copyIdentity: (payload: string) => void | Promise<void>;
	#sessionId: string | undefined;
	#chatLog = new TranscriptContainer();
	#chatEntriesRef: SessionMessageEntry[] | undefined;
	#chatBuiltCount = 0;
	#chatPendingTools = new Map<string, ToolExecutionComponent | ReadToolGroupComponent>();
	#chatReadArgs = new Map<string, Record<string, unknown>>();
	#chatReadGroup: ReadToolGroupComponent | null = null;
	#pendingUsage: Usage | undefined;
	#chatWaitingPoll: ToolExecutionComponent | null = null;
	#chatExpandables: Array<{ setExpanded(expanded: boolean): void }> = [];
	#chatRichRenderables: Array<{ setRichRendering(rich: boolean): void }> = [];
	#chatExpanded = false;
	#plainPreview = false;
	#liveAssistantComponent: AssistantMessageComponent | undefined;
	#chatPlaceholder: string | undefined;
	#chatSearchQuery = "";
	#chatSearchEditing = false;
	#chatSearchMatches: number[] = [];
	#chatSearchMatchIndex = -1;
	#chatRenderedContent: readonly string[] = [];

	#transcriptViewport = new TranscriptViewportModel<string>();
	#inspectorSection: AgentHubInspectorSection = "prompt";
	#previewLaneFocus: "transcript" | "inspector" = "transcript";
	#inspectorScrollOffset = 0;
	#inspectorLastMaxScroll = 0;
	#inspectorViewportHeight = 20;
	#dualLaneActive = false;

	/** One no-timeout `g` namespace shared by roster, transcript, and inspector. */
	#viewerSequence = new AgentHubViewerSequence();
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
		this.#interruptKeys = deps.interruptKeys ?? [];
		this.#unfocusSession = deps.unfocusSession;
		this.#height = deps.height ?? (() => process.stdout.rows || 40);
		this.#requestRender = deps.requestRender;
		this.#hubKeys = deps.hubKeys;
		this.#remote = deps.remote;
		this.#turnStatus = deps.turnStatus;
		this.#transcriptDisplay = deps.transcriptDisplay ?? DEFAULT_TRANSCRIPT_DISPLAY_CONTEXT;
		this.#rollout = deps.rollout ?? null;
		this.#openErrors = deps.openErrors;
		this.#openBookmarks = deps.openBookmarks;
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
		this.#focusExternalOwner = deps.focusExternalOwner ?? focusLiveCmuxOwner;
		this.#copyIdentity = deps.copyIdentity ?? copyToClipboard;
		this.#sessionId = deps.sessionId ?? this.#registry.get(MAIN_AGENT_ID)?.session?.sessionManager.getSessionId();
		this.#sessionsDir = deps.sessionsDir;
		this.#journalTails = deps.journalTails ?? new AgentHubJournalTailCache();

		this.#unsubscribers.push(
			this.#registry.onChange(event => {
				this.#pendingRegistryEvents.push({ ...event, ref: { ...event.ref } });
				this.#pendingJournalAgentIds.add(event.ref.id);
				this.#registryGeneration++;
				this.#scheduleProjection();
			}),
		);
		this.#unsubscribers.push(
			this.#observers.onChange(() => {
				this.#observerProjectionDirty = true;
				this.#scheduleProjection();
			}),
		);
		this.#unsubscribers.push(
			onChildRouteUpdate(notification => {
				this.#liveRouteUpdates.set(notification.agentId, notification.record);
				if (notification.sessionFile)
					void this.#journalModels.load(notification.sessionFile).then(() => this.#requestRender());
				this.#requestRender();
			}),
		);
		this.#ageTimer = setInterval(() => {
			// Relative ages are the only unconditional clock-driven content.
			// Keep the invalidation scoped to the Hub instead of composing the full TUI.
			if (this.#refreshExternalRows() && this.#filterDirty) this.#applyFilter();
			this.#ui.requestComponentRender(this);
		}, AGE_TICK_MS);
		this.#ageTimer.unref?.();

		this.#rebuildObserverSnapshot();
		this.#initializeRegistryProjection();
		this.#onDataChange();
		this.#tablePreview = Effect.runSync(
			Scope.provide(this.#tableScope)(
				TablePreviewComponent.mount<HubTableRow, string>({
					rows: () => this.#visibleTableRows,
					keyOf: row => this.#tableKey(row),
					matchesRow: () => true,
					renderRow: (row, context) => this.#renderTableRow(row, context.selected, context.width),
					preview: { open: row => this.#openTablePreview(row) },
					height: () => this.#tableBodyHeight,
					tableHeight: () => this.#tableViewportCapacity(),
					betweenPanes: width => this.#renderTableLegend(width),
					requestRender: this.#requestRender,
					onClose: this.#onDone,
					flush: () => this.#flushProjection(),
					onSearchChange: query => this.#applyTableQuery(query),
					onSelectionChange: () => this.#foldSequence.reset(),
					previewTracksRowIdentity: false,
					layout: "stacked",
					showTableHeader: false,
					decorateSelectedRow: false,
					showTableScrollbar: false,
					fitTableHeight: false,
					sectionLabel: (row, context) => this.#tableSectionLabel(row, context.index, context.firstVisible),
					renderSectionLabel: label => ` ${label}`,
					renderEmpty: () => this.#emptyTableLines(),
					renderOverflow: remaining => ` ${theme.fg("dim", `… ${remaining} more`)}`,
				}),
			),
		);
		// Prefer the oldest active agent, but external-only rosters still preview their selected sibling.
		if (this.#totalTableRows() > 0) {
			const initialSelection = deps.initialAgentId
				? { kind: "agent" as const, id: deps.initialAgentId, viewportOffset: 0 }
				: deps.initialSelection;
			const initialKey = initialSelection ? this.#selectionKey(initialSelection) : undefined;
			if (initialKey) this.#tablePreview.selectKey(initialKey);
			this.#tablePreview.setScrollOffset(Math.max(0, initialSelection?.viewportOffset ?? 0));
		}
	}

	/** Whether the table view has no registered live or revivable agents. */
	get isEmpty(): boolean {
		this.#flushProjection();
		return this.#registryRefs.size + this.#archivedRows.length + this.#externalRows.length === 0;
	}

	getRetentionMetrics(): AgentHubRetentionMetrics {
		this.#flushProjection();
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
			materializedTranscriptRows: this.#transcriptViewport.visibleRowCount,
			retainedJournalTextBytes: this.#journalTails.retainedTextBytes,
			previewFinalizedPrefixScans: this.#chatLog.getRetentionMetrics().finalizedPrefixScans,
			liveTimers:
				Number(this.#ageTimer !== undefined) +
				Number(this.#projectionTimer !== undefined) +
				Number(this.#chatRefreshTimer !== undefined),
		};
	}

	#panelFocus(): AgentHubPanelFocus {
		if (this.#view === "chat") return "transcript";
		if (this.#tablePreview.focus === "table") return "roster";
		return this.#previewLaneFocus === "inspector" ? this.#inspectorSection : "transcript";
	}

	#focusPreviewLane(lane: "transcript" | "inspector"): boolean {
		if (!this.#dualLaneActive) return false;
		this.#previewLaneFocus = lane;
		this.#tablePreview.setFocus("preview");
		this.#requestRender();
		return true;
	}

	getInteractionState(): AgentHubInteractionState {
		this.#flushProjection();
		const row = this.#selectedAgentRow();
		const selectedAgentId =
			this.#view === "chat" ? this.#chatAgentId : row?.kind === "active" ? row.ref.id : row?.descriptor.agentId;
		return {
			view: this.#view,
			panelFocus: this.#panelFocus(),
			inspectorSection: this.#inspectorSection,
			...(selectedAgentId ? { selectedAgentId } : {}),
			tableIndex: this.#tablePreview.selectedIndex,
			transcriptOffset: this.#transcriptViewport.offset,
			inspectorOffset: this.#inspectorScrollOffset,
			archivedChat: this.#chatArchived !== undefined,
		};
	}

	getSelectedAgentViewModel(): AgentHubSelectedAgentViewModel | undefined {
		this.#flushProjection();
		const row = this.#selectedAgentRow();
		const active = row?.kind === "active" ? row.ref : undefined;
		const archived = row?.kind === "archived" ? row.descriptor : this.#chatArchived;
		const agentId = active?.id ?? archived?.agentId;
		if (!agentId) return undefined;
		const observed = active ? this.#observableFor(active.id) : undefined;
		const durable = this.#journalModels.peek(active?.sessionFile ?? archived?.childSessionFile);
		const receipt = observed?.progress?.routeReceipt ?? durable?.spawnRecord?.route;
		const eventById = new Map<string, RouteResolutionSource>();
		for (const event of durable?.routeEvents ?? []) eventById.set(event.resolutionId, event);
		const sessionManager = active?.session?.sessionManager;
		if (sessionManager)
			for (const event of routeResolutionEvents(sessionManager.getEntries(), agentId))
				eventById.set(event.resolutionId, event);
		const modelSelector = active
			? this.#resolvedModelSelector(active, observed)
			: withModelSelectorEffort(archived?.modelId, { session: archived?.thinkingLevel });
		const routeUpdate = childRouteUpdateStatus(
			newestChildRouteUpdateRecord(this.#liveRouteUpdates.get(agentId), durable?.childRouteUpdate),
		);
		const route = buildAgentRouteExplanation({
			agentId,
			...(receipt ? { receipt } : {}),
			routeEvents: [...eventById.values()],
			fallbackModel: modelSelector,
			fallbackResponsibility: observed?.progress?.agent ?? durable?.spawnRecord?.agentType,
		});
		return {
			agentId,
			lifecycle: active?.status ?? archived?.state ?? "unknown",
			...(modelSelector ? { modelSelector } : {}),
			...(routeUpdate ? { routeUpdate } : {}),
			route,
		};
	}

	/** Tear down every subscription and timer. Called by the overlay owner on close. */
	dispose(): void {
		if (this.#disposed) return;
		this.#releaseSelectedTranscriptRead();
		this.#disposed = true;
		void Effect.runPromise(Scope.close(this.#tableScope, Exit.void));
		for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe();
		this.#liveRouteUpdates.clear();
		if (this.#ageTimer) {
			clearInterval(this.#ageTimer);
			this.#ageTimer = undefined;
		}
		if (this.#spinnerTimer) {
			clearInterval(this.#spinnerTimer);
			this.#spinnerTimer = undefined;
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
		this.#rollout?.close?.();
		this.#selectedLiveState = EMPTY_AGENT_HUB_SELECTED_LIVE_STATE;
		this.#foldSequence.reset();
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
		this.#visibleTableRows = [];
		this.#chatSearchQuery = "";
		this.#notice = undefined;
		this.#chatAgentId = undefined;
		this.#chatArchived = undefined;
		this.#chatExternal = undefined;
	}

	/** Return the stable identity represented by the current Hub row. */ getSelectedBookmarkTarget():
		| BookmarkTarget
		| undefined {
		this.#flushProjection();
		const row = this.#selectedAgentRow();
		if (row?.kind === "active") {
			const sessionId = row.ref.sessionId ?? this.#sessionId;
			if (!sessionId) return undefined;
			if (row.ref.id === MAIN_AGENT_ID) {
				return {
					kind: "session",
					sessionId,
					title: row.ref.displayName || "Current session",
				};
			}
			return {
				kind: "agent",
				sessionId,
				agentId: row.ref.id,
				title: row.ref.displayName || row.ref.id,
			};
		}
		if (row?.kind === "archived") {
			const sessionId = this.#sessionId;
			if (!sessionId) return undefined;
			return {
				kind: "agent",
				sessionId,
				agentId: row.descriptor.agentId,
				title: row.descriptor.agentId,
			};
		}
		const external = this.#selectedExternalRow()?.peer;
		if (!external) return undefined;
		return { kind: "session", sessionId: external.sessionId, title: external.name || external.sessionId };
	}

	/** Return the stable row identity and viewport offset for the current selection. */
	getSelectedSelection(): { kind: "agent" | "external"; id: string; viewportOffset: number } | undefined {
		this.#flushProjection();
		const row = this.#selectedAgentRow();
		const viewportOffset = this.#tablePreview.scrollOffset;
		if (row?.kind === "active") return { kind: "agent", id: row.ref.id, viewportOffset };
		if (row?.kind === "archived") return { kind: "agent", id: row.descriptor.agentId, viewportOffset };
		const external = this.#selectedExternalRow()?.peer;
		return external ? { kind: "external", id: external.sessionId, viewportOffset } : undefined;
	}
	/** Select a bookmarked identity without opening or changing the preview modality. */
	selectBookmarkTarget(target: BookmarkTarget): boolean {
		this.#flushProjection();
		this.#tablePreview.endSearch();
		this.#tablePreview.clearSearch();
		this.#activeSearchFields.clear();
		this.#applyFilter();
		let key: string | undefined;
		if (target.kind === "agent") {
			const active = this.#visibleActiveRows.find(
				ref => ref.id === target.agentId && (ref.sessionId ?? this.#sessionId) === target.sessionId,
			);
			if (active) key = `agent:${active.id}`;
			else {
				const archived = this.#visibleArchivedRows.find(row => row.agentId === target.agentId);
				if (archived) key = `archived:${archived.childSessionFile}`;
			}
		} else {
			const active = this.#visibleActiveRows.find(ref => (ref.sessionId ?? this.#sessionId) === target.sessionId);
			if (active) key = `agent:${active.id}`;
			else {
				const external = this.#visibleExternalRows.find(row => row.peer.sessionId === target.sessionId);
				if (external) key = `external:${external.peer.sessionId}`;
			}
		}
		if (!key || !this.#tablePreview.selectKey(key)) return false;
		this.#view = "table";
		this.#requestRender();
		return true;
	}

	override render(width: number): readonly string[] {
		this.#flushProjection();
		if (this.#chatRefreshTimer) {
			clearTimeout(this.#chatRefreshTimer);
			this.#chatRefreshTimer = undefined;
			if (this.#view === "chat" || this.#cockpitPreview) this.#rebuildChatContent();
		}
		return this.#view === "table" ? this.#renderTable(width) : this.#renderChat(width);
	}
	handleInput(keyData: string): void {
		if (matchesKey(keyData, "ctrl+c") || keyData === "q") {
			this.#onDone();
			return;
		}
		for (const key of this.#interruptKeys) {
			if (matchesKey(keyData, key)) {
				this.#onDone();
				void this.#unfocusSession?.();
				return;
			}
		}
		// The hub/observe keys always close the overlay (toggle semantics)
		for (const key of this.#hubKeys) {
			if (matchesKey(keyData, key)) {
				this.#onDone();
				return;
			}
		}
		if (this.#view === "table") {
			if (this.#tablePreview.focus === "preview" && this.#handlePreviewPanelInput(keyData)) return;
			this.#handleTableInput(keyData);
		} else {
			this.#handleChatInput(keyData);
		}
	}
	/** Open the chat view for an agent id (public for table Enter and tests). */
	openChat(id: string): void {
		if (!this.#registry.get(id)) return;
		this.#releaseSelectedTranscriptRead();
		this.#view = "chat";
		this.#foldSequence.reset();
		this.#chatArchived = undefined;
		this.#chatAgentId = id;
		this.#chatExternal = undefined;
		this.#notice = undefined;
		this.#transcriptCache = undefined;
		this.#remoteTranscriptUnavailable = false;
		this.#remoteFetchInFlight = false;
		this.#remoteFetchToken++;
		this.#resetChatLog();
		this.#transcriptViewport.reset();
		this.#lastLeftTap = 0;
		this.#attachLiveSession();
		this.#rebuildChatContent();
		this.#requestRender();
	}

	/** Open a persisted completed child transcript without registering or reviving it. */
	#openArchivedChat(row: ArchivedDirectChildDescriptor): void {
		this.#releaseSelectedTranscriptRead();
		this.#view = "chat";
		this.#foldSequence.reset();
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
		this.#transcriptViewport.reset();
		this.#lastLeftTap = 0;
		void this.#journalModels.load(row.childSessionFile).then(() => this.#requestRender());
		this.#rebuildChatContent();
		this.#requestRender();
	}
	#openExternalChat(peer: AgentHubExternalPeer): void {
		this.#releaseSelectedTranscriptRead();
		this.#view = "chat";
		this.#foldSequence.reset();
		this.#detachLiveSession();
		this.#siblingWatchDispose?.();
		this.#chatAgentId = peer.name || peer.sessionId;
		this.#chatArchived = undefined;
		this.#chatExternal = peer;
		this.#notice = undefined;
		this.#transcriptCache = undefined;
		this.#resetChatLog();
		this.#transcriptViewport.reset();
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
		}, PROJECTION_WINDOW_MS);
		this.#projectionTimer.unref?.();
	}

	#flushProjection(): void {
		if (this.#pendingRegistryEvents.length === 0 && !this.#observerProjectionDirty) return;
		const events = this.#pendingRegistryEvents;
		this.#pendingRegistryEvents = [];
		for (const event of events) this.#applyRegistryEvent(event);
		if (this.#observerProjectionDirty) {
			this.#observerProjectionDirty = false;
			this.#rebuildObserverSnapshot();
		}
		const journalAgentIds = this.#pendingJournalAgentIds;
		this.#pendingJournalAgentIds = new Set();
		recordAgentHubProjectionRebuild();
		this.#onDataChange(journalAgentIds);
	}

	#onDataChange(journalAgentIds: ReadonlySet<string> = new Set(this.#registryRefs.keys())): void {
		if (this.#archiveSourceSessionFile !== this.#registry.get(MAIN_AGENT_ID)?.sessionFile) {
			this.#loadArchivedRows();
		}
		this.#refreshRows();
		const sessionFiles = [...journalAgentIds].flatMap(id => {
			const sessionFile = this.#registryRefs.get(id)?.sessionFile;
			return sessionFile ? [sessionFile] : [];
		});
		if (sessionFiles.length > 0)
			void Promise.all(sessionFiles.map(sessionFile => this.#journalModels.load(sessionFile))).then(() =>
				this.#requestRender(),
			);
		if (this.#view === "chat" && !this.#chatArchived) {
			this.#attachLiveSession();
			this.#scheduleChatRefresh(false);
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
			const observed = this.#observableFor(ref.id);
			const task = observed?.description ?? observed?.progress?.task ?? "";
			const model = this.#resolvedModelSelector(ref, observed) ?? "";
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
				a.peer.lastSeen !== b.peer.lastSeen ||
				a.peer.labels?.label !== b.peer.labels?.label ||
				a.peer.labels?.activity !== b.peer.labels?.activity ||
				a.peer.labels?.todoHead !== b.peer.labels?.todoHead ||
				a.peer.labels?.objective !== b.peer.labels?.objective ||
				a.peer.labels?.summary !== b.peer.labels?.summary ||
				a.peer.labels?.model !== b.peer.labels?.model
			)
				return false;
		}
		return true;
	}

	#refreshExternalRows(): boolean {
		const externalRows = this.#loadExternalRows();
		if (this.#sameExternalRows(this.#externalRows, externalRows)) return false;
		const selectedExternal = this.#chatExternal
			? externalRows.find(row => row.peer.sessionId === this.#chatExternal?.sessionId)
			: undefined;
		if (selectedExternal) this.#chatExternal = selectedExternal.peer;
		this.#externalRows = externalRows;
		this.#filterDirty = true;
		const sessionFiles = externalRows.flatMap(row => (row.peer.sessionFile ? [row.peer.sessionFile] : []));
		if (sessionFiles.length > 0)
			void Promise.all(sessionFiles.map(sessionFile => this.#journalModels.load(sessionFile))).then(() =>
				this.#requestRender(),
			);
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

	#refreshRows(): void {
		if (this.#orderedRegistryGeneration !== this.#registryGeneration) {
			const counts: Record<AgentStatus, number> = {
				running: this.#refsByStatus.running.size,
				"waiting-provider": this.#refsByStatus["waiting-provider"].size,
				idle: this.#refsByStatus.idle.size,
				parked: this.#refsByStatus.parked.size,
				aborted: this.#refsByStatus.aborted.size,
			};
			const rows = [
				...this.#orderedStatus("running"),
				...this.#orderedStatus("waiting-provider"),
				...this.#orderedStatus("idle"),
			];
			if (this.#showHistoricalAgents || this.#tableQuery()) rows.push(...this.#orderedStatus("parked"));
			if (this.#showTerminalAgents) rows.push(...this.#orderedStatus("aborted"));
			this.#rows = rows;
			this.#statusCounts = counts;
			this.#hiddenTerminalCount = this.#showTerminalAgents ? 0 : counts.aborted;
			this.#orderedRegistryGeneration = this.#registryGeneration;
			this.#searchFieldsDirty = true;
			this.#filterDirty = true;
		}
		if (this.#searchFieldsDirty && (this.#tableSearchEditing() || this.#tableQuery())) {
			this.#rebuildActiveSearchFields();
			this.#filterDirty = true;
		}
		this.#refreshExternalRows();
		if (this.#filterDirty) this.#applyFilter();
	}

	#tableViewportCapacity(): number {
		// The roster is deliberately a compact, scrollable strip. Section labels
		// and the overflow marker share this budget with the selectable rows.
		return Math.max(3, Math.min(ROSTER_STRIP_HEIGHT - 3, this.#height() - 7));
	}
	#toggleFold(agentId: string, expand?: boolean): boolean {
		if (!this.#registryRefs.has(agentId) || !this.#rows.some(ref => ref.parentId === agentId)) return false;
		const shouldExpand = expand ?? this.#foldedAgentIds.has(agentId);
		if (shouldExpand) this.#foldedAgentIds.delete(agentId);
		else this.#foldedAgentIds.add(agentId);
		this.#filterDirty = true;
		this.#applyFilter();
		return true;
	}

	#tableQuery(): string {
		return this.#tablePreview?.searchQuery ?? "";
	}

	#tableSearchEditing(): boolean {
		return this.#tablePreview?.searchEditing ?? false;
	}

	#applyTableQuery(query: string): void {
		if (query && this.#searchFieldsDirty) this.#rebuildActiveSearchFields();
		if (!query) this.#activeSearchFields.clear();
		this.#filterDirty = true;
		this.#applyFilter(false);
	}

	#applyFilter(refreshTable = true): void {
		const q = this.#tableQuery().toLowerCase();
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
		const waitingProvider = matches(this.#orderedStatus("waiting-provider"));
		const parked = this.#showHistoricalAgents ? matches(this.#orderedStatus("parked")) : [];
		const terminal = !this.#showTerminalAgents ? [] : matches(this.#orderedStatus("aborted"));
		// Every status a roster row can hold needs a lane here. A status missing
		// from this list is not eligible: such an agent is dropped outright when it
		// is a leaf, and is readmitted only as an unlabelled revealed ancestor when
		// it has children — landing its whole subtree in a neighbouring section.
		const sections = [
			["Running", running],
			["Waiting on provider", waitingProvider],
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
		const selectedKey = this.#tablePreview?.selectedKey;
		const selectedId = selectedKey?.startsWith("agent:") ? selectedKey.slice("agent:".length) : undefined;
		if (!q && selectedId) this.#foldedAgentIds = expandAgentAncestors(projectRefs, this.#foldedAgentIds, selectedId);
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
		this.#visibleTableRows = [...this.#visibleActiveRows, ...this.#visibleArchivedRows, ...this.#visibleExternalRows];
		this.#filterDirty = false;
		if (refreshTable && this.#tablePreview) this.#tablePreview.refresh({ requestRender: false });
	}

	#toggleHistoricalAgents(): void {
		this.#showHistoricalAgents = !this.#showHistoricalAgents;
		this.#orderedRegistryGeneration = -1;
		this.#refreshRows();
	}

	#matchesTableFilter(ref: AgentRef, q: string): boolean {
		return this.#activeSearchFields.get(ref.id)?.includes(q) === true;
	}

	#matchesExternalFilter(row: ExternalPeerRow, q: string): boolean {
		const peer = row.peer;
		// Search exactly the lanes the enriched row renders, so a peer stays
		// reachable by the role or activity it publishes and not only by the
		// ambient name the bus generated for it.
		if ((peer.name || peer.sessionId).toLowerCase().includes(q)) return true;
		if (displayedExternalPeerState(peer).includes(q)) return true;
		if (peer.labels?.label?.toLowerCase().includes(q) === true) return true;
		if (externalPeerActivity(peer)?.toLowerCase().includes(q) === true) return true;
		return peer.cwd.length > 0 && shortenPath(peer.cwd).toLowerCase().includes(q);
	}

	#matchesArchivedFilter(row: ArchivedDirectChildDescriptor, q: string): boolean {
		return (
			row.agentId.toLowerCase().includes(q) ||
			row.state.includes(q) ||
			row.modelId?.toLowerCase().includes(q) === true ||
			row.thinkingLevel?.toLowerCase().includes(q) === true
		);
	}

	#moveTableSelection(delta: number): void {
		this.#tablePreview.moveSelection(delta);
	}

	#openTablePreview(selected: HubTableRow): TablePreviewSession {
		const row = this.#asAgentRow(selected);
		const external = this.#asExternalRow(selected)?.peer;
		const nextId = external
			? external.name || external.sessionId
			: row?.kind === "active"
				? row.ref.id
				: row?.descriptor.agentId;
		const nextArchive = row?.kind === "archived" ? row.descriptor : undefined;
		this.#releaseSelectedTranscriptRead();
		this.#foldSequence.reset();
		this.#detachLiveSession();
		this.#siblingWatchDispose?.();
		this.#siblingWatchDispose = undefined;
		this.#resetChatLog();
		this.#transcriptCache = undefined;
		this.#chatAgentId = nextId;
		this.#chatArchived = nextArchive;
		this.#chatExternal = external;
		this.#transcriptViewport.reset();
		this.#inspectorScrollOffset = 0;
		this.#previewLaneFocus = "transcript";
		this.#chatSearchQuery = "";
		this.#chatSearchMatches = [];
		if (nextId) {
			if (external?.sessionFile)
				this.#siblingWatchDispose = watchSiblingTranscript(external.sessionFile, () => this.#scheduleChatRefresh());
			this.#attachLiveSession();
			this.#rebuildChatContent();
		} else {
			this.#viewerHeaderLines = [];
		}
		return {
			render: (width, height) => this.#renderPreview(width, height),
			handleInput: data => this.#handlePreviewPanelInput(data),
			dispose: () => this.#disposeTablePreview(selected),
		};
	}

	#disposeTablePreview(selected: HubTableRow): void {
		const row = this.#asAgentRow(selected);
		const external = this.#asExternalRow(selected)?.peer;
		const id = external
			? external.name || external.sessionId
			: row?.kind === "active"
				? row.ref.id
				: row?.descriptor.agentId;
		if (
			id !== this.#chatAgentId ||
			(row?.kind === "archived" ? row.descriptor : undefined) !== this.#chatArchived ||
			external?.sessionId !== this.#chatExternal?.sessionId
		)
			return;
		this.#releaseSelectedTranscriptRead();
		this.#detachLiveSession();
		this.#siblingWatchDispose?.();
		this.#siblingWatchDispose = undefined;
		this.#resetChatLog();
		this.#transcriptCache = undefined;
		this.#chatAgentId = undefined;
		this.#chatArchived = undefined;
		this.#chatExternal = undefined;
	}

	#selectedStateItems(): AgentHubSelectedStateItem[] {
		const ref =
			!this.#chatExternal && !this.#chatArchived && this.#chatAgentId
				? this.#registry.get(this.#chatAgentId)
				: undefined;
		const external = this.#chatExternal;
		const identity: AgentHubRolloutPeerIdentity | undefined = external
			? { sessionId: external.sessionId, sessionFile: external.sessionFile }
			: ref
				? { sessionId: ref.sessionId, sessionFile: ref.sessionFile }
				: this.#chatArchived
					? { sessionFile: this.#chatArchived.childSessionFile }
					: undefined;
		return projectAgentHubSelectedState({
			ref,
			observed: ref ? this.#observableFor(ref.id) : undefined,
			external: external
				? {
						state: displayedExternalPeerState(external),
						sessionId: external.sessionId,
						buildDigest: external.buildDigest,
						version: external.version,
					}
				: undefined,
			turnStatus: ref ? this.#turnStatus?.(ref.id) : undefined,
			live: this.#selectedLiveState,
			rollout: identity ? this.#rollout?.latestForPeer(identity) : undefined,
		});
	}
	#animatedRosterState(
		status: AgentStatus | AgentHubExternalPeerDisplayState | undefined,
		observed: ObservableSession | undefined,
		sessionId: string | undefined,
		sessionFile: string | null | undefined,
	): string | undefined {
		if (observed?.progress?.retryState) return "TRY";
		const phase = this.#rollout?.latestForPeer({ sessionId, sessionFile })?.phase;
		switch (phase) {
			case "requested":
				return "REQ";
			case "acknowledged":
				return "ACK";
			case "applied":
				return "APL";
		}
		if (status === "running") return "RUN";
		if (status === "working") return "WRK";
		return undefined;
	}

	#selectedIsAnimated(): boolean {
		const ref =
			!this.#chatExternal && !this.#chatArchived && this.#chatAgentId
				? this.#registry.get(this.#chatAgentId)
				: undefined;
		if (ref)
			return Boolean(
				this.#animatedRosterState(ref.status, this.#observableFor(ref.id), ref.sessionId, ref.sessionFile),
			);
		if (this.#chatExternal)
			return Boolean(
				this.#animatedRosterState(
					displayedExternalPeerState(this.#chatExternal),
					undefined,
					this.#chatExternal.sessionId,
					this.#chatExternal.sessionFile,
				),
			);
		return Boolean(this.#animatedRosterState(undefined, undefined, undefined, this.#chatArchived?.childSessionFile));
	}

	#selectedRailIsAnimated(items: readonly AgentHubSelectedStateItem[]): boolean {
		const kind = items[0]?.kind;
		return this.#selectedIsAnimated() && kind !== "error" && kind !== "needs-input";
	}

	#syncSpinnerTimer(needed: boolean): void {
		if (needed === Boolean(this.#spinnerTimer)) return;
		if (!needed) {
			clearInterval(this.#spinnerTimer);
			this.#spinnerTimer = undefined;
			this.#spinnerFrame = 0;
			return;
		}
		this.#spinnerTimer = setInterval(() => {
			this.#spinnerFrame = (this.#spinnerFrame + 1) % SPINNER_FRAMES.length;
			this.#ui.requestComponentRender(this);
		}, SPINNER_TICK_MS);
		this.#spinnerTimer.unref?.();
	}

	#spinnerPrefix(): string {
		return theme.fg("accent", SPINNER_FRAMES[this.#spinnerFrame]);
	}

	#spinnerStateLabel(label: string): string {
		return theme.fg("accent", `${SPINNER_FRAMES[this.#spinnerFrame]} ${label}`);
	}

	#selectedRailLines(width: number): string[] {
		if (!this.#chatAgentId) return [];
		const innerWidth = Math.max(10, width - 2);
		const identity = this.#chatExternal
			? this.#chatExternal.name || this.#chatExternal.sessionId
			: (this.#chatArchived?.agentId ?? this.#chatAgentId);
		const items = this.#selectedStateItems();
		const rendered = renderAgentHubSelectedState(items, Math.max(1, innerWidth - 2))[0];
		const ref = !this.#chatExternal && !this.#chatArchived ? this.#registry.get(this.#chatAgentId) : undefined;
		const fallback = this.#chatExternal
			? displayedExternalPeerState(this.#chatExternal).replace("_", " ")
			: this.#chatArchived
				? `${this.#chatArchived.state} · read-only`
				: (ref?.status ?? "state unavailable");
		const animate = this.#selectedRailIsAnimated(items);
		const prefix = animate ? this.#spinnerPrefix() : theme.fg("dim", "·");
		return [
			` ${theme.fg("accent", `Selected · ${identity}`)}`,
			truncateToWidth(` ${prefix} ${rendered ?? fallback}`, innerWidth),
		];
	}

	#contextualMetadataLines(): string[] {
		const states = renderAgentHubSelectedState(this.#selectedStateItems(), contentWidth()).map(
			line => `Status: ${line}`,
		);
		if (this.#chatExternal) {
			const peer = this.#chatExternal;
			return [
				`Identity: ${peer.name || peer.sessionId}`,
				`Raw handle: ${peer.name || peer.sessionId}`,
				`Session: ${peer.sessionId}`,
				`State: ${displayedExternalPeerState(peer).replace("_", " ")}`,
				`Source: ${peer.sessionFile ?? "remote transcript"}`,
				`Model: ${withModelSelectorEffort(durableModelSelector(this.#journalModels.peek(peer.sessionFile)), {}) ?? "unknown"}`,
				`Version/fork: ${peer.version ?? "unknown"}${peer.buildDigest ? ` · ${peer.buildDigest.slice(0, 12)}` : ""}`,
				...states,
			];
		}
		if (this.#chatArchived) {
			const row = this.#chatArchived;
			return [
				`Identity: ${row.agentId}`,
				`State: ${row.state} · archived`,
				`Source: ${row.childSessionFile}`,
				`Model: ${withModelSelectorEffort(row.modelId, { session: row.thinkingLevel }) ?? "unknown"}`,
				`Version/fork: ${VERSION}`,
				...states,
			];
		}
		const ref = this.#chatAgentId ? this.#registry.get(this.#chatAgentId) : undefined;
		const observed = ref ? this.#observableFor(ref.id) : undefined;
		const durable = this.#journalModels.peek(ref?.sessionFile)?.spawnRecord;
		const progress = observed?.progress;
		const model =
			(ref ? this.#resolvedModelSelector(ref, observed) : undefined) ??
			withModelSelectorEffort(durable?.resolvedModel, { route: durable?.route?.route.thinking }) ??
			"unknown";
		const source = progress?.definitionSourcePath ?? durable?.definitionSourcePath ?? "unknown";
		const routeSource = progress?.routeReceipt?.source ?? durable?.route?.source ?? "unknown";
		const buildVersion = progress?.buildVersion ?? durable?.buildVersion ?? VERSION;
		const buildDigest = progress?.buildDigest ?? durable?.buildDigest;
		return [
			`Identity: ${ref?.id ?? this.#chatAgentId ?? "unknown"}`,
			`State: ${ref?.status ?? observed?.status ?? "unknown"}`,
			`Prompt/source: ${source}`,
			`Route provenance: ${routeSource}`,
			`Model: ${model}`,
			`Version/fork: ${buildVersion}${buildDigest ? ` · ${buildDigest.slice(0, 12)}` : ""}`,
			...states,
		];
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
		for (const component of this.#chatRichRenderables)
			component.setRichRendering(this.#transcriptDisplay.richTranscript);
		this.#liveAssistantComponent?.setRichRendering(this.#transcriptDisplay.richTranscript);
		const richRendered = this.#chatPlaceholder
			? [theme.fg("dim", this.#chatPlaceholder)]
			: this.#chatLog.render(innerWidth);
		const rendered = this.#plainPreview ? richRendered.map(line => Bun.stripANSI(line)) : richRendered;
		const content = rendered.length > 0 ? rendered : [theme.fg("dim", "No messages yet.")];
		this.#transcriptViewport.layout(content, Math.max(1, targetHeight - 2), !this.#chatSearchQuery);
		this.#chatRenderedContent = content;
		const focus = this.#dualLaneActive && this.#panelFocus() === "transcript" ? theme.fg("accent", "●") : "";
		const rate = this.#tokenRateBadge();
		const lines = [` ${focus}${theme.fg("accent", "Preview transcript")}${rate ? `  ${rate}` : ""}`];
		for (const row of this.#transcriptViewport.visibleRows()) lines.push(` ${row}`);
		while (lines.length < targetHeight - 1) lines.push("");
		lines.push(...new DynamicBorder().render(width));
		if (trackHeight) this.#previewRenderedHeight = lines.length;
		return lines;
	}

	#renderInspectorPreview(width: number, targetHeight: number): string[] {
		const innerWidth = Math.max(20, width - 2);
		const details = this.#inspectorLines(
			!this.#chatExternal && !this.#chatArchived && this.#chatAgentId
				? this.#observableFor(this.#chatAgentId)
				: undefined,
			innerWidth,
		);
		const content = details;
		this.#inspectorViewportHeight = Math.max(1, targetHeight - 2);
		this.#inspectorLastMaxScroll = Math.max(0, content.length - this.#inspectorViewportHeight);
		this.#inspectorScrollOffset = Math.max(0, Math.min(this.#inspectorScrollOffset, this.#inspectorLastMaxScroll));
		const focus = this.#panelFocus() === this.#inspectorSection ? theme.fg("accent", "●") : "";
		const label = this.#inspectorSection[0].toUpperCase() + this.#inspectorSection.slice(1);
		const lines = [` ${focus}${theme.fg("accent", label)} ${theme.fg("dim", "[ / ] section · ← / →")}`];
		for (const row of content.slice(
			this.#inspectorScrollOffset,
			this.#inspectorScrollOffset + this.#inspectorViewportHeight,
		))
			lines.push(` ${sanitizeLine(row, innerWidth)}`);
		while (lines.length < targetHeight - 1) lines.push("");
		lines.push(...new DynamicBorder().render(width));
		return lines;
	}

	#inspectorLines(observed: ObservableSession | undefined, width: number): string[] {
		const sessionFile =
			this.#chatExternal?.sessionFile ??
			(this.#chatAgentId
				? (this.#registryRefs.get(this.#chatAgentId)?.sessionFile ?? this.#chatArchived?.childSessionFile)
				: this.#chatArchived?.childSessionFile);
		const durableJournal = this.#journalModels.peek(sessionFile);
		const durableSpawn = durableJournal?.spawnRecord;
		if (this.#inspectorSection === "prompt") {
			if (this.#chatExternal) {
				const systemPrompt = durableJournal?.systemPrompt?.slice(0, INSPECTOR_PROMPT_MAX_CHARS) ?? "";
				const remaining = Math.max(0, INSPECTOR_PROMPT_MAX_CHARS - systemPrompt.length);
				const firstUserMessage = durableJournal?.firstUserMessage?.slice(0, remaining) ?? "";
				if (!systemPrompt && !firstUserMessage) return ["No journal head prompt available."];
				const lines: string[] = [];
				if (systemPrompt) {
					lines.push(theme.fg("dim", "System prompt"));
					lines.push(...this.#wrapInspectorText(systemPrompt, width, ""));
				}
				if (firstUserMessage) {
					if (systemPrompt) lines.push("");
					lines.push(theme.fg("dim", "First user message"));
					lines.push(...this.#wrapInspectorText(firstUserMessage, width, ""));
				}
				return lines;
			}
			const progress = observed?.progress;
			const context = (progress?.spawnContext ?? durableSpawn?.context ?? "").slice(0, INSPECTOR_PROMPT_MAX_CHARS);
			const remaining = Math.max(0, INSPECTOR_PROMPT_MAX_CHARS - context.length);
			const assignment = (
				progress?.assignment ??
				durableSpawn?.assignment ??
				progress?.task ??
				observed?.description ??
				""
			).slice(0, remaining);
			const fullPrompt = durableSpawn?.fullPrompt?.slice(0, INSPECTOR_PROMPT_MAX_CHARS);
			if (!context && !assignment && !fullPrompt) return ["No spawn prompt available."];
			const lines: string[] = [];
			const definitionSourcePath = progress?.definitionSourcePath ?? durableSpawn?.definitionSourcePath;
			const spawnerId = progress?.spawnerId ?? durableSpawn?.spawnerId;
			const buildVersion = progress?.buildVersion ?? durableSpawn?.buildVersion;
			const buildDigest = progress?.buildDigest ?? durableSpawn?.buildDigest;
			if (definitionSourcePath) lines.push(`Definition: ${definitionSourcePath}`);
			if (spawnerId) lines.push(`Spawner: ${spawnerId}`);
			if (buildVersion) lines.push(`Build: ${buildVersion}`);
			if (buildDigest) lines.push(`Build digest: ${buildDigest}`);
			if (lines.length) lines.push("");
			if (fullPrompt) {
				lines.push(theme.fg("dim", "Spawn prompt"));
				lines.push(...this.#wrapInspectorText(fullPrompt, width, ""));
				return lines;
			}
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
		const progress = observed?.progress;
		const receipt = progress?.routeReceipt ?? durableSpawn?.route;
		const transactionId = receipt?.consulted.find(candidate => candidate.policy?.transactionId)?.policy
			?.transactionId;
		const selectedView = this.getSelectedAgentViewModel();
		const routeView = selectedView?.route;
		const routeUpdateLine = formatChildRouteUpdate(selectedView?.routeUpdate);
		const explanationLines = routeView
			? [
					"ROUTE EXPLANATION",
					`selected model: ${routeView.selectedModel} · effort: ${routeView.effort}`,
					`responsibility: ${routeView.responsibility} · receipt source: ${routeView.receiptSource ?? "unknown"}`,
					`escalation reason: ${routeView.escalationReason ?? "none"}${transactionId ? ` · transaction=${transactionId}` : ""}`,
					...routeView.history.map(
						event => `${event.kind}: ${event.model}:${event.effort}${event.reason ? ` · ${event.reason}` : ""}`,
					),
				]
			: ["ROUTE EXPLANATION", "No route provenance available."];
		if (!receipt) return [...explanationLines, ...(routeUpdateLine ? [routeUpdateLine] : [])];
		const agentId = this.#chatAgentId ?? "selected agent";
		const ref = this.#chatAgentId ? this.#registry.get(this.#chatAgentId) : undefined;
		const explicitOverride =
			receipt.source === "spawn_explicit"
				? receipt.consulted.find(candidate => candidate.explicit)?.selectors.join(",")
				: undefined;
		const provenance = boundedRouteInspectionLines(
			{
				agentId,
				responsibility: receipt.responsibility ?? durableSpawn?.agentType ?? progress?.agent ?? "unknown",
				definitionSourcePath:
					progress?.definitionSourcePath ?? durableSpawn?.definitionSourcePath ?? "unknown definition",
				decision: receipt,
				binaryVersion: progress?.buildVersion ?? durableSpawn?.buildVersion ?? "unknown/legacy",
				receiptSource: `spawn receipt ${agentId}`,
				...(explicitOverride ? { explicitOverride } : {}),
			},
			(ref ? this.#resolvedModelSelector(ref, observed) : undefined) ??
				withModelSelectorEffort(durableSpawn?.resolvedModel, { route: durableSpawn?.route?.route.thinking }) ??
				withModelSelectorEffort(`${receipt.route.provider}/${receipt.route.model}`, {
					route: receipt.route.thinking,
				})!,
		);
		return [...explanationLines, ...(routeUpdateLine ? [routeUpdateLine] : []), ...provenance.slice(1)];
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

	#totalTableRows(): number {
		return this.#visibleTableRows.length;
	}

	#asAgentRow(row: HubTableRow | undefined): HubAgentRow | undefined {
		if (!row || "peer" in row) return undefined;
		return "childSessionFile" in row ? { kind: "archived", descriptor: row } : { kind: "active", ref: row };
	}

	#asExternalRow(row: HubTableRow | undefined): ExternalPeerRow | undefined {
		return row && "peer" in row ? row : undefined;
	}

	#tableKey(row: HubTableRow): string {
		if ("peer" in row) return `external:${row.peer.sessionId}`;
		if ("childSessionFile" in row) return `archived:${row.childSessionFile}`;
		return `agent:${row.id}`;
	}

	#selectionKey(selection: { kind: "agent" | "external"; id: string; viewportOffset: number }): string {
		if (selection.kind === "external") return `external:${selection.id}`;
		if (this.#visibleActiveRows.some(ref => ref.id === selection.id)) return `agent:${selection.id}`;
		const archived = this.#visibleArchivedRows.find(row => row.agentId === selection.id);
		return archived ? `archived:${archived.childSessionFile}` : `agent:${selection.id}`;
	}

	#selectedAgentRow(): HubAgentRow | undefined {
		return this.#asAgentRow(this.#tablePreview?.selected);
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
		return this.#asExternalRow(this.#tablePreview?.selected);
	}

	#copyHubPayload(payload: string | undefined, label: string): void {
		if (!payload) {
			this.#notice = `Nothing to copy for ${label}.`;
			this.#requestRender();
			return;
		}
		void Promise.resolve(this.#copyIdentity(payload)).then(
			() => {
				this.#notice = `Copied ${label}.`;
				this.#requestRender();
			},
			error => {
				this.#notice = `Could not copy ${label}: ${error instanceof Error ? error.message : String(error)}`;
				this.#requestRender();
			},
		);
	}

	#copySelectedTableRow(full: boolean): void {
		const row = this.#selectedAgentRow();
		if (row?.kind === "active") {
			const ref = row.ref;
			const name = ref.displayName && ref.displayName !== ref.id ? `${ref.id} · ${ref.displayName}` : ref.id;
			if (!full) return this.#copyHubPayload(name, "row");
			const observed = this.#observableFor(ref.id);
			const payload = [
				name,
				ref.status,
				this.#resolvedModelSelector(ref, observed),
				projectAgentHubRowActivity(ref, observed),
				ref.parentId ? `parent ${ref.parentId}` : undefined,
			]
				.filter((value): value is string => Boolean(value))
				.join(" · ");
			return this.#copyHubPayload(payload, "full row");
		}
		if (row?.kind === "archived") {
			const archived = row.descriptor;
			const payload = full
				? [
						archived.agentId,
						archived.state,
						withModelSelectorEffort(archived.modelId, { session: archived.thinkingLevel }),
						archived.childSessionFile,
					]
						.filter(Boolean)
						.join(" · ")
				: archived.agentId;
			return this.#copyHubPayload(payload, full ? "full row" : "row");
		}
		const external = this.#selectedExternalRow();
		if (!external) return this.#copyHubPayload(undefined, "row");
		const peer = external.peer;
		const name = peer.name || peer.sessionId;
		const payload = full ? [name, external.state, peer.cwd, peer.sessionId].filter(Boolean).join(" · ") : name;
		this.#copyHubPayload(payload, full ? "full row" : "row");
	}

	#copyTranscriptUnit(full: boolean): void {
		const lines = this.#chatRenderedContent.map(line => Bun.stripANSI(line).trimEnd());
		if (full) return this.#copyHubPayload(lines.join("\n").trim(), "transcript section");
		let index = Math.min(this.#transcriptViewport.offset, Math.max(0, lines.length - 1));
		while (index < lines.length && !lines[index]?.trim()) index++;
		if (index >= lines.length) return this.#copyHubPayload(undefined, "transcript paragraph");
		let start = index;
		let end = index + 1;
		while (start > 0 && lines[start - 1]?.trim()) start--;
		while (end < lines.length && lines[end]?.trim()) end++;
		this.#copyHubPayload(lines.slice(start, end).join("\n").trim(), "transcript paragraph");
	}

	#loadArchivedRows(): void {
		const parentSessionFile = this.#registry.get(MAIN_AGENT_ID)?.sessionFile ?? undefined;
		if (!parentSessionFile && !this.#sessionsDir) {
			this.#archiveSourceSessionFile = undefined;
			this.#archivedRows = [];
			this.#archivedLoadToken++;
			return;
		}
		this.#archivedRows = [];
		this.#applyFilter();
		this.#archiveSourceSessionFile = parentSessionFile;
		const token = ++this.#archivedLoadToken;
		void Promise.all([
			parentSessionFile ? listArchivedDescendants(parentSessionFile) : Promise.resolve([]),
			listAutomationJournalRows(this.#sessionsDir, parentSessionFile),
		])
			.then(([children, automations]) => {
				if (
					token !== this.#archivedLoadToken ||
					this.#registry.get(MAIN_AGENT_ID)?.sessionFile !== parentSessionFile
				)
					return;
				this.#archivedRows = [...children, ...automations].sort(
					(left, right) =>
						right.updatedAt.localeCompare(left.updatedAt) || left.agentId.localeCompare(right.agentId),
				);
				this.#applyFilter();
				this.#requestRender();
			})
			.catch(error => logger.debug("Agent hub: historical journals unavailable", { error: String(error) }));
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

	#attachLiveSession(): void {
		if (this.#remote || this.#chatArchived || this.#chatExternal) return;
		const session = this.#chatAgentId ? (this.#registry.get(this.#chatAgentId)?.session ?? undefined) : undefined;
		if (session === this.#attachedSession) return;
		this.#detachLiveSession();
		if (!session) return;
		this.#attachedSession = session;
		this.#sessionUnsubscribe = session.subscribe(event => {
			const live = reduceAgentHubSelectedLiveState(this.#selectedLiveState, event);
			if (live !== this.#selectedLiveState) {
				this.#selectedLiveState = live;
				this.#requestRender();
			}
			if (
				event.type === "message_start" ||
				event.type === "message_update" ||
				event.type === "message_end" ||
				event.type === "tool_execution_end" ||
				event.type === "agent_end"
			)
				this.#scheduleChatRefresh();
		});
	}

	#detachLiveSession(): void {
		this.#sessionUnsubscribe?.();
		this.#sessionUnsubscribe = undefined;
		this.#attachedSession = undefined;
		this.#selectedLiveState = EMPTY_AGENT_HUB_SELECTED_LIVE_STATE;
	}

	#selectedJournalPath(): string | undefined {
		if (this.#chatExternal?.sessionFile) return this.#chatExternal.sessionFile;
		if (this.#chatArchived) return this.#chatArchived.childSessionFile;
		if (!this.#remote && this.#chatAgentId) return this.#registry.get(this.#chatAgentId)?.sessionFile ?? undefined;
		return undefined;
	}

	#invalidateTranscriptRead(sessionFile?: string): void {
		this.#transcriptLoadGeneration++;
		this.#transcriptLoadInFlight = undefined;
		if (sessionFile) this.#journalTails.invalidate(sessionFile);
	}

	#releaseSelectedTranscriptRead(): void {
		this.#invalidateTranscriptRead(this.#selectedJournalPath());
	}

	#scheduleChatRefresh(invalidateJournal = true): void {
		const sessionFile = this.#selectedJournalPath();
		if (invalidateJournal && sessionFile) this.#invalidateTranscriptRead(sessionFile);
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
		this.#flushProjection();
		return this.#observerById.get(id);
	}

	#resolvedModelSelector(ref: AgentRef, observed: ObservableSession | undefined): string | undefined {
		const progress = observed?.progress;
		const cachedModel = this.#transcriptCache?.path === ref.sessionFile ? this.#transcriptCache.model : undefined;
		const cachedThinking =
			this.#transcriptCache?.path === ref.sessionFile ? this.#transcriptCache.thinking : undefined;
		const liveModel = ref.session?.model;
		const liveSelector = liveModel ? `${liveModel.provider}/${liveModel.id}` : undefined;
		const durable = this.#journalModels.peek(ref.sessionFile);
		const selector =
			liveSelector ??
			ref.recovery?.hotswapModel ??
			cachedModel ??
			durableModelSelector(durable) ??
			progress?.resolvedModel ??
			ref.recovery?.model;
		return withModelSelectorEffort(selector, {
			session:
				ref.session?.thinkingLevel ??
				(ref.recovery?.hotswapModel ? ref.recovery.thinkingLevel : undefined) ??
				cachedThinking ??
				durable?.thinkingLevel,
			route: progress?.routeReceipt?.route.thinking,
			modelDefault: liveModel?.thinking?.defaultLevel,
			reasoning: liveModel?.reasoning,
		});
	}

	// ========================================================================
	// Table view
	// ========================================================================

	#historicalHiddenCount(): number {
		if (this.#showHistoricalAgents) return 0;
		const q = this.#tableQuery().toLowerCase();
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

	#renderTableLegend(width: number): readonly string[] {
		if (!this.#showLegend) return [];
		const lines: string[] = [];
		for (const metadata of this.#contextualMetadataLines())
			lines.push(`   ${theme.fg("dim", sanitizeLine(metadata, Math.max(10, width - 4)))}`);
		lines.push(...renderAgentHubHelp(width, this.#previewLaneFocus === "inspector" ? "hub.inspector" : "hub.table"));
		lines.push(`   ${theme.fg("dim", "[ / ] cycle siblings · ← / →")}`);
		lines.push(...new DynamicBorder().render(width));
		return lines;
	}

	#emptyTableLines(): readonly string[] {
		const query = this.#tableQuery();
		if (!this.#showHistoricalAgents) return [` ${theme.fg("dim", "No active subagents · . to show history")}`];
		if (this.#statusCounts.parked > 0 && !query)
			return [` ${theme.fg("dim", `Parked (${this.#statusCounts.parked}) · / to search and expand`)}`];
		if (!query) return [` ${theme.fg("dim", "no subagents yet — task spawns appear here")}`];
		return [` ${theme.fg("dim", "no matches")}`];
	}

	#tableSectionLabel(row: HubTableRow, index: number, firstVisible: boolean): string | undefined {
		if ("peer" in row) {
			const firstExternal = this.#visibleActiveRows.length + this.#visibleArchivedRows.length;
			if (index === firstExternal || firstVisible) return theme.fg("dim", "External peers");
			return undefined;
		}
		const section = this.#sectionStarts.find(candidate => candidate.index === index);
		return section ? theme.fg("accent", section.label) : undefined;
	}

	#renderTableRow(row: HubTableRow, selected: boolean, width: number): string {
		if ("peer" in row) {
			const animation = this.#animatedRosterState(
				displayedExternalPeerState(row.peer),
				undefined,
				row.peer.sessionId,
				row.peer.sessionFile,
			);
			if (animation) this.#animatedTableRowVisible = true;
			return this.#renderExternalRow(row, selected, width, animation);
		}
		if ("childSessionFile" in row) return this.#renderArchivedRow(row, selected, width);
		const observed = this.#observableFor(row.id);
		const animation = this.#animatedRosterState(row.status, observed, row.sessionId, row.sessionFile);
		if (animation) this.#animatedTableRowVisible = true;
		return this.#renderRow(row, selected, width, observed, animation);
	}

	#renderTable(width: number): string[] {
		const lines: string[] = [];
		lines.push(...new DynamicBorder().render(width));
		const counts = this.#statusSummary();
		const query = this.#tableQuery();
		const filterIndicator = query
			? theme.fg("accent", ` /${query}`) +
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
			` ${theme.fg("accent", "Agent Hub")}${theme.fg("dim", ` · tree · focus ${this.#panelFocus()}`)}${counts ? theme.fg("dim", `${theme.sep.dot}${counts}`) : ""}${terminalIndicator}${historyIndicator}${filterIndicator}`,
		);
		lines.push(...new DynamicBorder().render(width));
		const rail = this.#selectedRailLines(width);
		lines.push(...rail);
		const previewHeight = Math.max(
			4,
			this.#height() -
				ROSTER_STRIP_HEIGHT -
				HUB_CHROME_HEIGHT -
				rail.length -
				(this.#showLegend ? 10 : 0) -
				(this.#notice ? 1 : 0) -
				(this.#tableSearchEditing() ? 1 : 0),
		);
		this.#tableBodyHeight = previewHeight + this.#tableViewportCapacity();
		this.#animatedTableRowVisible = false;
		lines.push(...this.#tablePreview.render(width));
		this.#syncSpinnerTimer(this.#animatedTableRowVisible || this.#selectedRailIsAnimated(this.#selectedStateItems()));
		if (this.#notice) lines.push(` ${theme.fg("error", sanitizeLine(this.#notice, Math.max(10, width - 2)))}`);
		if (this.#tableSearchEditing()) lines.push(` ${theme.fg("accent", "/")}${query}${theme.fg("accent", "▏")}`);
		lines.push("");
		lines.push(
			renderAgentHubFooter({
				width,
				surface: this.#previewLaneFocus === "inspector" ? "hub.inspector" : "hub.table",
				mode: this.#tableSearchEditing() ? "filter" : "normal",
				extra: query ? ["n/N:next/previous match"] : undefined,
				pending: this.#viewerSequence.isPending ? AGENT_HUB_G_CHORD_CUE : undefined,
			}),
		);
		lines.push(...new DynamicBorder().render(width));
		return lines;
	}

	#statusSummary(): string {
		const parts: string[] = [];
		for (const status of ["running", "waiting-provider", "idle", "parked", "aborted"] as const) {
			const count = this.#statusCounts[status];
			if (count > 0) parts.push(`${count} ${status}`);
		}
		if (this.#archivedRows.length > 0) parts.push(`${this.#archivedRows.length} archived`);
		if (this.#externalRows.length > 0) parts.push(`${this.#externalRows.length} external`);
		return parts.join(theme.sep.dot);
	}

	#renderRow(
		ref: AgentRef,
		selected: boolean,
		width: number,
		observed: ObservableSession | undefined,
		animation?: string,
	): string {
		const cursor = selected ? theme.fg("accent", theme.nav.cursor) : " ";
		const prefix = this.#treeGuideById.get(ref.id) ?? "";
		const identity = projectLocalAgentIdentity({
			ref,
			activity: projectAgentHubRowActivity(ref, observed),
			nowMs: Date.now(),
		});
		const unread = this.#irc.unreadCount(ref.id);
		const hiddenDescendants = this.#hiddenDescendantsById.get(ref.id);
		const rollup = hiddenDescendants
			? theme.fg("dim", ` (+${hiddenDescendants} · ${this.#hiddenRunningById.get(ref.id) ?? 0} run)`)
			: "";
		const tail = unread > 0 ? `⧉ ${unread}` : "";
		const model = this.#resolvedModelSelector(ref, observed);
		const row = renderHubColumns({
			width: Math.max(10, width - 1),
			model,
			state: animation ? this.#spinnerStateLabel(animation) : statusBadge(ref.status),
			name: `${prefix}${theme.bold(replaceTabs(identity.id))} ${theme.fg("dim", replaceTabs(identity.displayName ?? ""))}${rollup}`,
			task: identity.activity,
			context: identity.context,
			age: tail ? `${tail} ${identity.age}` : identity.age,
		});
		return truncateToWidth(` ${cursor} ${row}`, Math.max(10, width - 1));
	}

	#renderArchivedRow(row: ArchivedDirectChildDescriptor, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", theme.nav.cursor) : " ";
		const model = withModelSelectorEffort(row.modelId, { session: row.thinkingLevel });
		const updatedAt = parseTimestampMs(row.updatedAt);
		const age =
			updatedAt === undefined ? undefined : formatAge(Math.max(1, Math.round((Date.now() - updatedAt) / 1000)));
		const rendered = renderHubColumns({
			width: Math.max(10, width - 1),
			model,
			state: formatArchivedState(row.state),
			name: `${theme.bold(replaceTabs(row.agentId))} ${theme.fg("dim", row.agentId.startsWith("automation: ") ? "automation · read-only" : "read-only")}`,
			age,
		});
		return truncateToWidth(` ${cursor} ${rendered}`, Math.max(10, width - 1));
	}

	#renderExternalRow(row: ExternalPeerRow, selected: boolean, width: number, animation?: string): string {
		const cursor = selected ? theme.fg("accent", theme.nav.cursor) : " ";
		const peer = row.peer;
		const identity = projectExternalPeerIdentity({ peer, nowMs: Date.now() });
		// The peer republishes its own resolved selector on every heartbeat; the
		// durable journal only wins when this host could actually read the file.
		const model = durableModelSelector(this.#journalModels.peek(peer.sessionFile)) ?? peer.labels?.model;
		const rendered = renderHubColumns({
			width: Math.max(10, width - 1),
			state: animation ? this.#spinnerStateLabel(animation) : externalStateBadge(row.state),
			name: `${theme.bold(replaceTabs(identity.id))} ${theme.fg("dim", "external")} ${theme.fg("dim", replaceTabs(identity.displayName ?? HUB_FIELD_UNKNOWN))}`,
			model: withModelSelectorEffort(model, {}) ?? "-",
			task: identity.activity,
			context: identity.context,
			age: identity.age,
		});
		return truncateToWidth(` ${cursor} ${rendered}`, Math.max(10, width - 1));
	}

	#attachSelectedExternalOwner(): void {
		const row = this.#selectedExternalRow();
		if (!row) {
			this.#notice = "ga targets external peers only.";
			this.#requestRender();
			return;
		}
		const peer = row.peer;
		const name = peer.name || peer.sessionId;
		if (!peer.sessionFile) {
			this.#notice = "peer publishes no session file (older build)";
			this.#requestRender();
			return;
		}
		this.#notice = `attaching ${name} in cmux…`;
		this.#requestRender();
		void this.#focusExternalOwner(peer.sessionFile, peer.sessionId).then(
			result => {
				switch (result.kind) {
					case "focused":
						this.#notice = `focused ${name} in cmux`;
						break;
					case "unavailable":
						this.#notice = CMUX_OWNER_UNAVAILABLE_MESSAGE;
						break;
					case "failed":
						this.#notice = result.reason;
						break;
				}
				this.#requestRender();
			},
			error => {
				this.#notice = error instanceof Error ? error.message : String(error);
				this.#requestRender();
			},
		);
	}

	#openRouteExplanation(): void {
		if (!this.#chatAgentId) {
			this.#notice = "Select an agent to inspect its route.";
			this.#requestRender();
			return;
		}
		if (this.#view === "chat") {
			const selectedKey = this.#chatExternal
				? `external:${this.#chatExternal.sessionId}`
				: this.#chatArchived
					? `archived:${this.#chatArchived.childSessionFile}`
					: `agent:${this.#chatAgentId}`;
			this.#closeChat();
			this.#tablePreview.selectKey(selectedKey);
			this.#tablePreview.refresh({ refreshPreview: true });
		}
		this.#inspectorSection = "route";
		this.#inspectorScrollOffset = 0;
		this.#previewLaneFocus = "inspector";
		this.#tablePreview.setFocus("preview");
		this.#requestRender();
	}

	#handleGrammarSequence(keyData: string, lane: "table" | "chat" | "inspector"): boolean {
		const action = this.#viewerSequence.handle(keyData, {
			prefix: keyData === "g",
			down: keyData === "j",
			up: keyData === "k",
			displayRows: lane !== "chat" || this.#transcriptDisplay.transcriptWrap,
			dismiss: matchesUiDismiss(keyData),
		});
		if (action.kind === "unhandled") return false;
		if (action.kind === "pending" || action.kind === "cancelled") {
			this.#requestRender();
			return true;
		}
		if (action.kind === "unknown") {
			this.#notice = `unknown Control Plane chord: ${action.chord}`;
			this.#requestRender();
			return true;
		}
		if (action.kind === "first-line") {
			if (lane === "table") {
				this.#tablePreview.selectIndex(0);
			} else if (lane === "inspector") {
				this.#inspectorScrollOffset = 0;
			} else {
				this.#transcriptViewport.scrollToTop();
			}
			this.#requestRender();
			return true;
		}
		if (
			action.kind === "display-row-down" ||
			action.kind === "logical-down" ||
			action.kind === "display-row-up" ||
			action.kind === "logical-up"
		) {
			if (lane === "table") {
				const down = action.kind === "display-row-down" || action.kind === "logical-down";
				this.#tablePreview.moveSelection(down ? 1 : -1);
			} else if (lane === "inspector") {
				this.#inspectorScrollOffset = applyAgentHubViewerSequenceAction(
					this.#inspectorScrollOffset,
					this.#inspectorLastMaxScroll,
					action,
				);
			} else {
				const down = action.kind === "display-row-down" || action.kind === "logical-down";
				this.#transcriptViewport.scrollBy(down ? 1 : -1);
			}
			this.#requestRender();
			return true;
		}
		if (action.kind === "attach-owner") {
			this.#attachSelectedExternalOwner();
		} else if (action.kind === "open-route-explanation") {
			this.#openRouteExplanation();
		} else if (action.kind === "open-errors") {
			if (this.#openErrors) this.#openErrors(this.#chatAgentId);
			else this.#notice = "Errors dock is unavailable.";
		} else if (action.kind === "open-bookmarks") {
			if (this.#openBookmarks) this.#openBookmarks();
			else this.#notice = "Bookmarks surface is unavailable.";
		} else if (action.kind === "open-messages") {
			const row = this.#selectedAgentRow();
			if (lane === "chat") this.#notice = "Messages already open.";
			else if (row?.kind === "active") this.openChat(row.ref.id);
			else if (row?.kind === "archived") this.#openArchivedChat(row.descriptor);
			else {
				const external = this.#selectedExternalRow();
				if (external) this.#openExternalChat(external.peer);
			}
		} else if (action.kind === "refresh") {
			const sessionFile = this.#selectedJournalPath();
			if (sessionFile) this.#invalidateTranscriptRead(sessionFile);
			this.#rebuildObserverSnapshot();
			this.#refreshExternalRows();
			this.#orderedRegistryGeneration = -1;
			this.#refreshRows();
			this.#rebuildChatContent();
			this.#notice = "Control Plane projections refreshed.";
		} else if (action.kind === "send") {
			const ref = this.#chatAgentId ? this.#registry.get(this.#chatAgentId) : this.#selectedInternalRef();
			if (this.#chatExternal || this.#selectedExternalRow()) this.#showExternalPeerHint();
			else if (!ref || ref.status === "parked" || ref.status === "aborted" || !ref.session)
				this.#notice = "Selected row is read-only; send is unavailable.";
			else if (!this.#focusAgent) this.#notice = "Selected agent cannot be attached from this view.";
			else
				void this.#focusAgent(ref.id).then(
					() => this.#onDone(),
					error => {
						this.#notice = error instanceof Error ? error.message : String(error);
						this.#requestRender();
					},
				);
		}
		this.#requestRender();
		return true;
	}

	#handleTableInput(keyData: string): void {
		if (this.#tableSearchEditing()) {
			this.#tablePreview.handleSearchInput(keyData);
			if (!this.#tableSearchEditing() && !this.#tableQuery()) this.#activeSearchFields.clear();
			return;
		}
		const dismiss = matchesUiDismiss(keyData);
		const grammarLane = this.#dualLaneActive && this.#previewLaneFocus === "inspector" ? "inspector" : "table";
		if (this.#viewerSequence.isPending && this.#handleGrammarSequence(keyData, grammarLane)) return;
		if (dismiss) {
			if (this.#tablePreview.focus === "preview") {
				this.#tablePreview.handleInput(keyData);
				return;
			}
			if (this.#dualLaneActive && this.#previewLaneFocus === "inspector") {
				this.#focusPreviewLane("transcript");
				return;
			}
			const fold = this.#foldSequence.handle(keyData, this.#selectedInternalRef()?.id, true);
			if (fold.kind !== "unhandled") {
				this.#requestRender();
				return;
			}
			if (this.#tableQuery()) {
				this.#tablePreview.clearSearch();
				this.#activeSearchFields.clear();
				return;
			}
			this.#onDone();
			return;
		}
		if (this.#tablePreview.focus === "preview") {
			if (!this.#handlePreviewPanelInput(keyData)) this.#tablePreview.handleInput(keyData);
			return;
		}
		if (this.#handleGrammarSequence(keyData, grammarLane)) return;
		if (matchesKey(keyData, "ctrl+w")) {
			this.#tablePreview.handleInput(keyData);
			return;
		}
		if (keyData === "c" || keyData === "C") {
			this.#copySelectedTableRow(keyData === "C");
			return;
		}
		if (this.#tableQuery() && (keyData === "n" || keyData === "N")) {
			this.#moveTableSelection(keyData === "n" ? 1 : -1);
			this.#requestRender();
			return;
		}
		if (keyData === "j" || matchesKey(keyData, "down") || keyData === "k" || matchesKey(keyData, "up")) {
			this.#moveTableSelection(keyData === "j" || matchesKey(keyData, "down") ? 1 : -1);
			this.#requestRender();
			return;
		}
		const tableDelta = resolveViewerScrollDelta(keyData, this.#tableViewportCapacity());
		if (tableDelta !== undefined) {
			this.#moveTableSelection(tableDelta);
			this.#requestRender();
			return;
		}
		if (keyData === "n" || keyData === "p") {
			this.#moveTableSelection(keyData === "n" ? 1 : -1);
			return;
		}
		if (keyData === "G") {
			this.#tablePreview.selectIndex(this.#totalTableRows() - 1);
			return;
		}
		if (this.#dualLaneActive && this.#previewLaneFocus === "inspector") {
			if (this.#handleInspectorNavigation(keyData)) return;
		} else if (this.#handleViewerNavigation(keyData)) return;
		const fold = this.#foldSequence.handle(keyData, this.#selectedInternalRef()?.id, matchesUiDismiss(keyData));
		if (fold.kind !== "unhandled") {
			if (fold.kind === "toggle") {
				this.#toggleFold(fold.agentId);
				this.#requestRender();
			}
			return;
		}
		if (keyData === "v") {
			this.#plainPreview = !this.#plainPreview;
			this.#requestRender();
			return;
		}
		if (keyData === "[" || keyData === "]") {
			this.#cycleSiblingOrSection(keyData === "]" ? 1 : -1);
			return;
		}
		if (matchesKey(keyData, "left") || matchesKey(keyData, "right")) {
			this.#cycleSiblingOrSection(matchesKey(keyData, "right") ? 1 : -1);
			return;
		}
		if (keyData === "h") {
			if (!this.#toggleFold(this.#selectedInternalRef()?.id ?? "", false) && this.#dualLaneActive)
				this.#focusPreviewLane("inspector");
			this.#requestRender();
			return;
		}
		if (keyData === "l") {
			if (!this.#toggleFold(this.#selectedInternalRef()?.id ?? "", true) && this.#dualLaneActive)
				this.#focusPreviewLane("transcript");
			this.#requestRender();
			return;
		}
		if (keyData === ".") {
			this.#toggleHistoricalAgents();
			this.#requestRender();
			return;
		}

		if (keyData === "y") {
			this.#yankSelectedIdentity();
			return;
		}
		if (keyData === "?") {
			this.#showLegend = !this.#showLegend;
			this.#requestRender();
			return;
		}
		if (keyData === "/") {
			this.#foldSequence.reset();
			this.#rebuildActiveSearchFields();
			this.#filterDirty = true;
			this.#tablePreview.beginSearch();
			this.#applyFilter();
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
		if (keyData === "r") {
			this.#reviveSelected();
			return;
		}
		if (keyData === "x") {
			this.#killSelected();
			return;
		}
	}
	#yankSelectedIdentity(): void {
		const row = this.#selectedAgentRow();
		const agentId = row?.kind === "active" ? row.ref.id : row?.descriptor.agentId;
		if (!agentId || agentId === MAIN_AGENT_ID) {
			this.#notice = "Select a child agent to yank its identity.";
			this.#requestRender();
			return;
		}
		const sessionId = this.#sessionId;
		if (!sessionId) {
			this.#notice = "Session identity is unavailable.";
			this.#requestRender();
			return;
		}
		const payload = agentHubYankPayload({ sessionId, agentId });
		void Promise.resolve(this.#copyIdentity(payload)).then(
			() => {
				this.#notice = `Yanked ${sessionId}/${agentId} + history://${sessionId}/${agentId}`;
				this.#requestRender();
			},
			error => {
				this.#notice = `Could not yank identity: ${error instanceof Error ? error.message : String(error)}`;
				this.#requestRender();
			},
		);
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

	/** Enter always opens the in-Hub transcript preview without mutating lifecycle state. */
	#activateAgent(ref: AgentRef): void {
		this.#notice = undefined;
		this.openChat(ref.id);
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
			: [];
		const noticeLine = this.#notice
			? ` ${theme.fg("error", sanitizeLine(this.#notice, Math.max(10, width - 2)))}`
			: undefined;
		const footerLines = this.#buildChatFooterLines(width);
		const selectedItems = this.#selectedStateItems();
		const selectedSummary = renderAgentHubSelectedState(selectedItems, Math.max(1, innerWidth - 2))[0];
		const selectedRailAnimated = this.#selectedRailIsAnimated(selectedItems);
		const selectedRail =
			selectedSummary && selectedRailAnimated ? `${this.#spinnerPrefix()} ${selectedSummary}` : selectedSummary;

		const headerChrome = this.#viewerHeaderLines.length + 2 + Number(selectedRail !== undefined);
		const footerChrome = editorLines.length + footerLines.length + (noticeLine ? 1 : 0) + 1;
		const viewportHeight = Math.max(5, termHeight - headerChrome - footerChrome);

		for (const component of this.#chatRichRenderables)
			component.setRichRendering(this.#transcriptDisplay.richTranscript);
		this.#liveAssistantComponent?.setRichRendering(this.#transcriptDisplay.richTranscript);
		const renderedContent = this.#chatPlaceholder ? [] : this.#chatLog.render(innerWidth);
		const richContentLines: readonly string[] = this.#chatPlaceholder
			? [theme.fg("dim", this.#chatPlaceholder)]
			: renderedContent.length > 0
				? renderedContent
				: [theme.fg("dim", "No messages yet.")];
		const contentLines = this.#plainPreview ? richContentLines.map(line => Bun.stripANSI(line)) : richContentLines;

		// Cache rendered lines for transcript search
		this.#chatRenderedContent = contentLines;

		this.#transcriptViewport.layout(contentLines, viewportHeight, !this.#chatSearchQuery);

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
		if (selectedRail) lines.push(` ${selectedRail}`);
		lines.push(...new DynamicBorder().render(width));

		if (contentLines.length <= viewportHeight) {
			for (const row of this.#transcriptViewport.visibleRows()) lines.push(` ${row}`);
		} else {
			const scrollView = new ScrollView(this.#transcriptViewport.visibleRows(), {
				scrollbar: "auto",
				height: viewportHeight,
				totalRows: contentLines.length,
				theme: { track: t => theme.fg("dim", t), thumb: t => theme.fg("accent", t) },
			});
			scrollView.setScrollOffset(this.#transcriptViewport.offset);
			for (const row of scrollView.render(Math.max(1, width - 1))) lines.push(` ${row}`);
		}

		if (noticeLine) lines.push(noticeLine);
		for (const editorLine of editorLines) lines.push(` ${editorLine}`);
		lines.push(...footerLines);
		lines.push(...new DynamicBorder().render(width));
		this.#syncSpinnerTimer(selectedRailAnimated);
		return lines;
	}

	#buildChatFooterLines(width: number): string[] {
		const searchHint = this.#chatSearchQuery ? "n/N:next/previous match" : undefined;
		if (this.#chatArchived)
			return renderAgentHubChatFooter({
				width,
				filterEditing: this.#chatSearchEditing,
				showHelp: this.#showLegend,
				archive: this.#chatArchived,
				status: this.#showLegend ? this.#contextualMetadataLines() : undefined,
				extra: [searchHint, "h/Backspace:back"],
				pending: this.#viewerSequence.isPending ? AGENT_HUB_G_CHORD_CUE : undefined,
			});
		const internalId = !this.#chatExternal ? this.#chatAgentId : undefined;
		const ref = internalId ? this.#registry.get(internalId) : undefined;
		const statsLine = this.#buildStatsLine(internalId ? this.#observableFor(internalId) : undefined);
		const turnStatus = internalId ? this.#turnStatus?.(internalId) : undefined;
		return renderAgentHubChatFooter({
			width,
			filterEditing: this.#chatSearchEditing,
			showHelp: this.#showLegend,
			status: [
				statsLine,
				turnStatus ? formatAgentHubTurnStatus(turnStatus, contentWidth()) : "",
				...(this.#showLegend ? this.#contextualMetadataLines() : []),
			],
			extra: [
				"h/Backspace:back",
				searchHint,
				ref?.status === "parked" && this.#chatAccessMode === "attachable" ? "R:revive" : undefined,
				this.#chatAccessMode === "attachable" ? "i:focus input" : undefined,
				`${this.#expandKeys[0] ?? "Ctrl+O"}:expand`,
			],
			pending: this.#viewerSequence.isPending ? AGENT_HUB_G_CHORD_CUE : undefined,
		});
	}

	#tokenRateBadge(): string | undefined {
		const ref =
			!this.#chatExternal && !this.#chatArchived && this.#chatAgentId
				? this.#registry.get(this.#chatAgentId)
				: undefined;
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
				progress && progress.toolCount > 0
					? `${formatNumber(progress.toolCount)} ${theme.icon.extensionTool}`
					: undefined;
			const statSegments = [toolCountStat, ...stats].filter((segment): segment is string => Boolean(segment));
			parts.push(theme.fg("dim", statSegments.join(theme.sep.dot)));
		}
		if (progress?.cost && progress.cost > 0) {
			parts.push(theme.fg("statusLineCost", `$${progress.cost.toFixed(2)}`));
		}
		return parts.join(theme.sep.dot);
	}

	#updateChatAccessMode(): void {
		if (this.#chatExternal || this.#chatArchived || this.#remote || !this.#focusAgent || !this.#chatAgentId) {
			this.#chatAccessMode = "read-only";
			return;
		}
		this.#chatAccessMode = this.#lifecycle().canResumeInPlace(this.#chatAgentId) ? "attachable" : "read-only";
	}

	#chatAccessLabel(): string {
		if (this.#chatAccessMode === "attachable") return "attachable — i:focus input";
		if (this.#chatExternal) return "read-only — external session";
		if (this.#chatArchived) return "read-only — archived";
		const ref = this.#chatAgentId ? this.#registry.get(this.#chatAgentId) : undefined;
		if (ref?.status === "running") return "read-only — running";
		if (ref?.status === "parked") return "read-only — no reviver";
		return `read-only — ${ref?.status ?? "unavailable"}`;
	}

	#focusChatInput(): void {
		this.#updateChatAccessMode();
		const id = this.#chatAgentId;
		const focusAgent = this.#focusAgent;
		if (this.#chatAccessMode !== "attachable" || !id || !focusAgent) {
			this.#inputUnavailableFlash = true;
			this.#rebuildChatContent();
			this.#requestRender();
			return;
		}
		this.#inputUnavailableFlash = false;
		void focusAgent(id).then(
			() => this.#onDone(),
			error => {
				const message = error instanceof Error ? error.message : String(error);
				if (message.includes("no reviver registered")) {
					this.#updateChatAccessMode();
					this.#inputUnavailableFlash = true;
				} else {
					this.#notice = message;
				}
				this.#rebuildChatContent();
				this.#requestRender();
			},
		);
	}

	/** Rebuild the chat header and sync transcript components from new entries */
	#rebuildChatContent(): void {
		this.#flushProjection();
		const id = this.#chatAgentId;
		const ref = id && !this.#chatExternal && !this.#chatArchived ? this.#registry.get(id) : undefined;

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
		const transcriptChanged =
			messageEntries !== null &&
			(this.#chatEntriesRef !== messageEntries || this.#chatBuiltCount < messageEntries.length);
		if (transcriptChanged) this.#detachStreamingAssistant(false);

		this.#updateChatAccessMode();
		const accessLabel = `${this.#chatAccessLabel()}${this.#inputUnavailableFlash ? " · input unavailable" : ""}`;
		this.#viewerHeaderLines = [];
		const title = this.#chatExternal
			? `${externalPreviewName(this.#chatExternal)} · ${externalPreviewWorkstream(this.#chatExternal)} · ${formatLastSeenAge(this.#chatExternal.lastSeen)}`
			: (id ?? "?");
		this.#viewerHeaderLines.push(theme.fg("accent", `Agent Hub > ${title}`));
		if (this.#chatExternal) {
			const peer = this.#chatExternal;
			const state = displayedExternalPeerState(peer);
			const model = withModelSelectorEffort(durableModelSelector(this.#journalModels.peek(peer.sessionFile)), {});
			const modelLabel = model ? ` ${modelHeaderLane(model)}` : ` ${theme.fg("dim", "-")}`;
			this.#viewerHeaderLines.push(
				`${externalStateBadge(state)} ${theme.fg("dim", `pid ${peer.pid} · ${shortenPath(peer.cwd)} · ${accessLabel}`)}${modelLabel}`,
			);
		} else if (this.#chatArchived) {
			const archived = this.#chatArchived;
			const model = withModelSelectorEffort(archived.modelId ?? this.#transcriptCache?.model, {
				session: archived.thinkingLevel ?? this.#transcriptCache?.thinking,
			});
			const modelLabel = model ? ` ${modelHeaderLane(model)}` : "";
			this.#viewerHeaderLines.push(
				`${theme.bold(archived.agentId)} ${theme.fg("dim", `${archived.state} · archived · ${accessLabel}`)}${modelLabel}`,
			);
		} else if (ref) {
			const observed = this.#observableFor(ref.id);
			const model = this.#resolvedModelSelector(ref, observed);
			const kindTag = theme.fg("dim", ` ${ref.parentId ? `${ref.kind} · of ${ref.parentId}` : ref.kind}`);
			const modelLabel = model ? ` ${modelHeaderLane(model)} ${theme.fg("dim", model)}` : "";
			const source = observed?.progress?.routeReceipt?.source;
			const sourceLabel = source ? theme.fg("dim", ` [${source}]`) : "";
			this.#viewerHeaderLines.push(
				`${theme.bold(ref.id)} ${statusBadge(ref.status)}${kindTag}${modelLabel}${sourceLabel} ${theme.fg("dim", accessLabel)}`,
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
		this.#syncStreamingAssistant(ref);
	}

	#handleChatInput(keyData: string): void {
		if (this.#chatSearchEditing) {
			if (matchesKey(keyData, "enter") || keyData === "\r" || keyData === "\n") {
				this.#chatSearchEditing = false;
				this.#requestRender();
				return;
			}
			if (matchesUiDismiss(keyData)) {
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
		if (keyData === "?") {
			this.#showLegend = !this.#showLegend;
			this.#requestRender();
			return;
		}
		if (keyData === "i") {
			this.#focusChatInput();
			return;
		}
		if (keyData === "c" || keyData === "C") {
			this.#copyTranscriptUnit(keyData === "C");
			return;
		}
		if (this.#handleGrammarSequence(keyData, "chat")) return;
		if (keyData === "[" || keyData === "]") {
			if (this.#chatArchived || this.#chatExternal) {
				this.#notice = "Sibling cycling is unavailable for archived and external transcripts.";
				this.#requestRender();
				return;
			}
			const currentId = this.#chatAgentId;
			const sibling = currentId
				? cycleVisibleAgentSibling(this.#visibleActiveRows, currentId, keyData === "]" ? 1 : -1)
				: undefined;
			if (sibling && sibling.id !== currentId) this.openChat(sibling.id);
			return;
		}
		if (this.#inputUnavailableFlash) this.#inputUnavailableFlash = false;
		if (this.#chatExternal) {
			this.#handleReadOnlyChatInput(keyData);
			return;
		}
		if (this.#chatArchived) {
			this.#handleReadOnlyChatInput(keyData);
			return;
		}
		if (keyData === "v") {
			this.#plainPreview = !this.#plainPreview;
			this.#requestRender();
			return;
		}
		if (matchesUiDismiss(keyData)) {
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

	#handleReadOnlyChatInput(keyData: string): void {
		if (keyData === "c" || keyData === "C") {
			this.#copyTranscriptUnit(keyData === "C");
			return;
		}
		if (matchesUiDismiss(keyData)) {
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
			let idx = matches.findIndex(line => line >= this.#transcriptViewport.offset);
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
		const target = Math.max(
			0,
			Math.min(matchLine - Math.floor(this.#transcriptViewport.height / 2), this.#transcriptViewport.maxOffset),
		);
		this.#transcriptViewport.setOffset(target);
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
		this.#foldSequence.reset();
		const selectedKey = this.#chatExternal
			? `external:${this.#chatExternal.sessionId}`
			: this.#chatArchived
				? `archived:${this.#chatArchived.childSessionFile}`
				: this.#chatAgentId
					? `agent:${this.#chatAgentId}`
					: undefined;
		this.#releaseSelectedTranscriptRead();
		this.#view = "table";
		this.#chatAgentId = undefined;
		this.#chatArchived = undefined;
		this.#chatExternal = undefined;
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
		if (selectedKey) this.#tablePreview.selectKey(selectedKey);
		this.#requestRender();
	}
	/** `[`/`]` and bare arrow-key view cycling: next/previous visible sibling agent, falling back to inspector sections in dual-lane. */
	#cycleSiblingOrSection(direction: 1 | -1): void {
		const selected = this.#selectedInternalRef();
		const sibling = selected ? cycleVisibleAgentSibling(this.#visibleActiveRows, selected.id, direction) : undefined;
		if (sibling && sibling.id !== selected?.id) {
			this.#tablePreview.selectKey(`agent:${sibling.id}`);
		} else if (this.#dualLaneActive) {
			const sections = ["prompt", "route", "comms"] as const;
			const current = sections.indexOf(this.#inspectorSection);
			this.#inspectorSection = sections[(current + (direction === 1 ? 1 : sections.length - 1)) % sections.length];
			this.#inspectorScrollOffset = 0;
			this.#requestRender();
		}
	}

	/** Route keys for the focused transcript/prompt pane inside the table preview. */
	#handlePreviewPanelInput(keyData: string): boolean {
		const lane = this.#previewLaneFocus === "inspector" ? "inspector" : "chat";
		if (this.#viewerSequence.isPending && this.#handleGrammarSequence(keyData, lane)) return true;
		if (this.#handleGrammarSequence(keyData, lane)) return true;
		if (keyData === "h") return this.#focusPreviewLane("inspector");
		if (keyData === "l") return this.#focusPreviewLane("transcript");
		if (keyData === "[" || keyData === "]") {
			this.#cycleSiblingOrSection(keyData === "]" ? 1 : -1);
			return true;
		}
		if (keyData === "c" || keyData === "C") {
			this.#copyTranscriptUnit(keyData === "C");
			return true;
		}
		if (keyData === "v") {
			this.#plainPreview = !this.#plainPreview;
			this.#requestRender();
			return true;
		}
		if (keyData === "?") {
			this.#showLegend = !this.#showLegend;
			this.#requestRender();
			return true;
		}
		return lane === "inspector" ? this.#handleInspectorNavigation(keyData) : this.#handleViewerNavigation(keyData);
	}

	/** Viewport scrolling for the chat transcript. Returns true when handled. */
	#handleViewerNavigation(keyData: string): boolean {
		const scrollBy = (delta: number) => {
			this.#transcriptViewport.scrollBy(delta);
			this.#requestRender();
		};
		const delta = resolveViewerScrollDelta(keyData, this.#transcriptViewport.height);
		if (delta !== undefined) {
			scrollBy(delta);
			return true;
		}
		if (matchesSelectDown(keyData)) {
			scrollBy(1);
			return true;
		}
		if (matchesSelectUp(keyData)) {
			scrollBy(-1);
			return true;
		}
		if (matchesNavigationBottom(keyData)) {
			this.#transcriptViewport.scrollToBottom();
			this.#requestRender();
			return true;
		}

		return false;
	}
	/** Viewport scrolling for the spawn-packet inspector. */
	#handleInspectorNavigation(keyData: string): boolean {
		let delta = resolveViewerScrollDelta(keyData, this.#inspectorViewportHeight);
		if (delta === undefined && matchesSelectDown(keyData)) delta = 1;
		else if (delta === undefined && matchesSelectUp(keyData)) delta = -1;
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

	/** Tear down transcript components (sealing pending spinners) and reset build state. */
	#resetChatLog(): void {
		for (const pending of this.#chatPendingTools.values()) pending.seal();
		this.#chatPendingTools.clear();
		this.#chatReadArgs.clear();
		this.#chatReadGroup = null;
		this.#pendingUsage = undefined;
		this.#chatWaitingPoll = null;
		this.#chatExpandables = [];
		this.#chatRichRenderables = [];
		this.#liveAssistantComponent = undefined;
		this.#chatLog.dispose();
		this.#chatLog.clear();
		this.#chatEntriesRef = undefined;
		this.#chatBuiltCount = 0;
		this.#chatPlaceholder = undefined;
	}

	#detachStreamingAssistant(dispose: boolean): void {
		const component = this.#liveAssistantComponent;
		if (!component) return;
		this.#chatLog.removeChild(component);
		if (dispose) {
			component.dispose();
			this.#liveAssistantComponent = undefined;
		}
	}

	#syncStreamingAssistant(ref: AgentRef | undefined): void {
		const streamMessage = ref?.status === "running" ? ref.session?.state?.streamMessage : undefined;
		if (!streamMessage || streamMessage.role !== "assistant") {
			this.#detachStreamingAssistant(true);
			return;
		}
		const message = streamMessage;
		if (!this.#liveAssistantComponent) {
			this.#liveAssistantComponent = new AssistantMessageComponent(
				undefined,
				this.#hideThinkingBlock?.() ?? false,
				() => this.#requestRender(),
				undefined,
				undefined,
				this.#transcriptDisplay.richTranscript,
			);
		}
		this.#liveAssistantComponent.updateContent(message, { transient: true });
		if (!this.#chatLog.children.includes(this.#liveAssistantComponent))
			this.#chatLog.addChild(this.#liveAssistantComponent);
		this.#chatPlaceholder = undefined;
	}

	#syncChatComponents(entries: SessionMessageEntry[]): void {
		if (this.#chatEntriesRef !== entries) {
			this.#resetChatLog();
			this.#chatEntriesRef = entries;
		}
		for (let i = this.#chatBuiltCount; i < entries.length; i++) {
			this.#appendChatMessage(entries[i].message);
		}
		this.#chatBuiltCount = entries.length;
		if (this.#chatReadArgs.size === 0 && this.#chatPendingTools.size === 0) {
			this.#flushPendingUsage();
		}
	}

	#trackExpandable(component: { setExpanded(expanded: boolean): void }): void {
		component.setExpanded(this.#chatExpanded);
		this.#chatExpandables.push(component);
	}
	#trackRich<T extends { setRichRendering(rich: boolean): void }>(component: T): T {
		this.#chatRichRenderables.push(component);
		return component;
	}

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
					this.#chatLog.addChild(
						this.#trackRich(
							new UserMessageComponent(
								textContent,
								isSynthetic,
								undefined,
								this.#transcriptDisplay.richTranscript,
							),
						),
					);
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
						suffix = file.attachment
							? file.attachment.type === "video"
								? "(video)"
								: "(image)"
							: file.lineCount === undefined
								? "(unknown lines)"
								: `(${file.lineCount} lines)`;
					}
					const text = `   ${theme.fg("muted", "Read")} ${theme.fg(
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
		const assistantComponent = this.#trackRich(
			new AssistantMessageComponent(
				message,
				this.#hideThinkingBlock?.() ?? false,
				() => this.#requestRender(),
				undefined,
				undefined,
				this.#transcriptDisplay.richTranscript,
			),
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
					transcriptDisplay: this.#transcriptDisplay,
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
				this.#transcriptDisplay,
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
		if (this.#transcriptCache?.path !== sessionFile) {
			if (this.#transcriptCache) this.#invalidateTranscriptRead(this.#transcriptCache.path);
			this.#transcriptCache = { path: sessionFile, bytesRead: 0, entries: [] };
		}

		const fromByte = this.#transcriptCache.bytesRead;
		const cached = this.#journalTails.peek(sessionFile, fromByte);
		if (cached === undefined) {
			this.#requestTranscriptRead(sessionFile, fromByte);
			return this.#transcriptCache.entries;
		}
		if (!cached) return null;
		if (cached.newSize < fromByte) {
			this.#invalidateTranscriptRead(sessionFile);
			this.#transcriptCache = { path: sessionFile, bytesRead: 0, entries: [] };
			this.#requestTranscriptRead(sessionFile, 0);
			return this.#transcriptCache.entries;
		}
		if (cached.fromByte !== fromByte) {
			this.#invalidateTranscriptRead(sessionFile);
			this.#requestTranscriptRead(sessionFile, fromByte);
			return this.#transcriptCache.entries;
		}
		this.#ingestTranscriptChunk(sessionFile, cached.text, fromByte);
		this.#journalTails.releaseText(sessionFile, fromByte, cached.newSize);
		return this.#transcriptCache.entries;
	}

	#requestTranscriptRead(sessionFile: string, fromByte: number): void {
		const inFlight = this.#transcriptLoadInFlight;
		if (inFlight?.path === sessionFile && inFlight.fromByte === fromByte) return;
		const request: TranscriptLoadRequest = {
			generation: ++this.#transcriptLoadGeneration,
			path: sessionFile,
			fromByte,
		};
		this.#transcriptLoadInFlight = request;
		// Initial reads must start at byte zero: a tail slice can begin inside
		// one large JSONL record and silently make the transcript's head unreachable.
		void this.#journalTails
			.load(sessionFile, fromByte, Number.POSITIVE_INFINITY)
			.then(result => this.#applyTranscriptChunk(request, result));
	}

	#applyTranscriptChunk(request: TranscriptLoadRequest, result: JournalTailChunk | null): void {
		const requestIsCurrent =
			request.generation === this.#transcriptLoadGeneration &&
			this.#transcriptLoadInFlight?.generation === request.generation;
		const cacheIsCurrent =
			this.#transcriptCache?.path === request.path && this.#transcriptCache.bytesRead === request.fromByte;
		if (!requestIsCurrent || !cacheIsCurrent || (result !== null && result.fromByte !== request.fromByte)) {
			if (this.#transcriptLoadInFlight?.generation === request.generation) this.#transcriptLoadInFlight = undefined;
			if (requestIsCurrent && result !== null && result.fromByte !== request.fromByte)
				this.#journalTails.invalidate(request.path);
			this.#scheduleCurrentTranscriptRead(request.path);
			return;
		}
		this.#transcriptLoadInFlight = undefined;
		if (!result) {
			logger.debug("Agent hub: failed to read session file", { path: request.path });
			this.#requestRender();
			return;
		}
		if (result.newSize < request.fromByte) {
			this.#invalidateTranscriptRead(request.path);
			this.#transcriptCache = { path: request.path, bytesRead: 0, entries: [] };
			this.#requestTranscriptRead(request.path, 0);
		} else {
			this.#ingestTranscriptChunk(request.path, result.text, request.fromByte);
			this.#journalTails.releaseText(request.path, request.fromByte, result.newSize);
		}
		this.#rebuildChatContent();
		this.#ui.requestComponentRender(this);
	}

	#scheduleCurrentTranscriptRead(sessionFile: string): void {
		if (this.#selectedJournalPath() !== sessionFile || this.#transcriptCache?.path !== sessionFile) return;
		this.#requestTranscriptRead(sessionFile, this.#transcriptCache.bytesRead);
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
