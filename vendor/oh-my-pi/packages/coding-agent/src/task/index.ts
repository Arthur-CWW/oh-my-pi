/**
 * Task tool - Delegate tasks to specialized agents.
 *
 * Discovers agent definitions from:
 *   - Bundled agents (shipped with omp-coding-agent)
 *   - ~/.omp/agent/agents/*.md (user-level)
 *   - .omp/agents/*.md (project-level)
 *
 * Supports:
 *   - Single agent spawn per call (parallelism = parallel task calls)
 *   - Batch spawning + shared context per call when `task.batch` is enabled
 *   - Background execution through AsyncJobManager when `async.enabled` is enabled
 *   - Progress tracking via JSON events
 *   - Session artifacts for debugging
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { $env, isEnoent, logger, prompt, Snowflake, VERSION } from "@oh-my-pi/pi-utils";
import type { ToolSession } from "..";
import { MCPManager } from "../mcp/manager";
import type { Theme } from "../modes/theme/theme";
import planModeSubagentPrompt from "../prompts/system/plan-mode-subagent.md" with { type: "text" };
import subagentUserPromptTemplate from "../prompts/system/subagent-user-prompt.md" with { type: "text" };
import taskDescriptionTemplate from "../prompts/tools/task.md" with { type: "text" };
import taskSummaryTemplate from "../prompts/tools/task-summary.md" with { type: "text" };
import { truncateForPrompt } from "../tools/approval";
import { isIrcEnabled } from "../tools/irc";
import { formatBytes, formatDuration } from "../tools/render-utils";
import {
	type AgentDefinition,
	type AgentProgress,
	canSpawnAtDepth,
	getTaskSchema,
	resolveSubagentDisplayName,
	type SingleResult,
	type TaskItem,
	type TaskParams,
	type TaskToolDetails,
	type TaskToolSchemaInstance,
} from "./types";
// Import review tools for side effects (registers subagent tool handlers)
import "../tools/review";
import type { AsyncJobManager } from "../async";
import type { LocalProtocolOptions } from "../internal-urls";
import { type ArchivedDirectChildDescriptor, listArchivedDirectChildren } from "../internal-urls/history-protocol";
import { loadOverallPlanReference } from "../plan-mode/plan-handoff";
import { AgentLifecycleManager, type ResourceLeaseAcquirer } from "../registry/agent-lifecycle";
import type { AgentStatus } from "../registry/agent-registry";
import { AgentRegistry, MAIN_AGENT_ID } from "../registry/agent-registry";
import {
	HostAdmissionRejectedError,
	HostResourceAdmission,
	type HostResourceLease,
	type ResourceAttemptKind,
} from "../resource/host-resource-admission";
import { readProcessIdentity } from "../resource/process-identity";
import type { AgentSession } from "../session/agent-session";
import { getSessionSpawnCordon, type SessionSpawnCordon } from "../session/session-control";
import { generateCommitMessage } from "../utils/commit-message-generator";
import * as git from "../utils/git";
import * as jj from "../utils/jj";
import { type DiscoveryResult, discoverAgents, getAgent } from "./discovery";
import { type ExecutorOptions, runSubprocess } from "./executor";
import { generateTaskName } from "./name-generator";
import { AgentOutputManager } from "./output-manager";
import { mapWithConcurrencyLimit } from "./parallel";
import { ProgressAggregator } from "./progress-aggregator";
import { addUsageTotals, createUsageTotals } from "./progress-usage";
import { renderResult, renderCall as renderTaskCall } from "./render";
import { repairTaskParams } from "./repair-args";
import { appendSpawnRouteResolution } from "./route-events";
import { type SpawnRouteDecision, toSpawnRouteReceipt } from "./route-resolution";
import {
	applyQuotaAdmission,
	applyTaskAuthFallback,
	formatModelChain,
	formatTaskRouteError,
	resolveTaskSpawnRoute,
	snapshotTaskSpawnPolicy,
} from "./spawn-route";
import { monitorDetachedSpawnWorker, runSubagentSpawnProcess } from "./spawn-worker-client";
import type { ReAdoptedChild } from "./re-adopt";
import {
	recordFinalizedSubagentFailure,
	recordThrownSubagentFailure,
	TaskJobError,
	updateFinalizedSubagentProgress,
} from "./subagent-failure";
import {
	applyNestedPatches,
	captureBaseline,
	captureDeltaPatch,
	cleanupIsolation,
	cleanupTaskBranches,
	commitToBranch,
	ensureIsolation,
	getRepoRoot,
	type IsolationHandle,
	mergeTaskBranches,
	parseIsolationMode,
	type WorktreeBaseline,
} from "./worktree";

export const DEFAULT_SPAWN_GUIDE_PATH = "docs/fable/spawn-guide.md";

interface SpawnGuideCacheEntry {
	mtimeMs: number;
	content: string;
}

const spawnGuideCache = new Map<string, SpawnGuideCacheEntry>();
async function resolveRepositoryRoot(cwd: string): Promise<string> {
	return (await jj.repo.root(cwd)) ?? getRepoRoot(cwd);
}

const defaultSpawnGuidePathCache = new Map<string, Promise<string>>();

async function resolveSpawnGuidePath(cwd: string, configuredPath?: string): Promise<string> {
	const requestedPath = configuredPath?.trim() || DEFAULT_SPAWN_GUIDE_PATH;
	if (path.isAbsolute(requestedPath)) return requestedPath;
	if (requestedPath !== DEFAULT_SPAWN_GUIDE_PATH) return path.resolve(cwd, requestedPath);

	const resolvedCwd = path.resolve(cwd);
	let cached = defaultSpawnGuidePathCache.get(resolvedCwd);
	if (!cached) {
		cached = resolveRepositoryRoot(resolvedCwd)
			.then(repoRoot => path.join(repoRoot, requestedPath))
			.catch(() => path.resolve(resolvedCwd, requestedPath));
		defaultSpawnGuidePathCache.set(resolvedCwd, cached);
	}
	return cached;
}

/**
 * Load the optional living spawn doctrine. The file is cached by mtime so
 * edits are visible to the next spawn without restarting the process.
 */
export async function loadSpawnGuide(cwd: string, configuredPath?: string): Promise<string | undefined> {
	const guidePath = await resolveSpawnGuidePath(cwd, configuredPath);
	let stat: Awaited<ReturnType<typeof fs.stat>>;
	try {
		stat = await fs.stat(guidePath);
	} catch (error) {
		spawnGuideCache.delete(guidePath);
		if (!isEnoent(error)) logger.warn("task: failed to stat spawn guide", { path: guidePath, error: String(error) });
		return undefined;
	}

	const cached = spawnGuideCache.get(guidePath);
	if (cached?.mtimeMs === stat.mtimeMs) return cached.content;

	let source: string;
	try {
		source = await fs.readFile(guidePath, "utf8");
	} catch (error) {
		spawnGuideCache.delete(guidePath);
		if (!isEnoent(error)) logger.warn("task: failed to read spawn guide", { path: guidePath, error: String(error) });
		return undefined;
	}

	const trimmedSource = source.trim();
	const provenance = `Spawn guide: ${guidePath} (${stat.mtime.toISOString()})`;
	const content = trimmedSource ? `${provenance}\n\n${trimmedSource}` : provenance;
	spawnGuideCache.set(guidePath, { mtimeMs: stat.mtimeMs, content });
	return content;
}

/**
 * Prepare one shared task context before fan-out. Callers pass the resulting
 * string to every item; the guide is never loaded or concatenated per item.
 */
export async function prepareSpawnContext(
	cwd: string,
	configuredPath: string | undefined,
	context: string | undefined,
): Promise<string | undefined> {
	const guide = await loadSpawnGuide(cwd, configuredPath);
	const trimmedContext = context?.trim() || undefined;
	if (!guide) return trimmedContext;
	return trimmedContext ? `${guide}\n\n${trimmedContext}` : guide;
}

function deriveSpawnGroup(ownerId: string | undefined): { groupId: string; coordinatorId?: string } {
	const registry = AgentRegistry.global();
	const coordinatorId = ownerId ?? MAIN_AGENT_ID;
	if (coordinatorId === MAIN_AGENT_ID) return { groupId: MAIN_AGENT_ID };
	let groupId = coordinatorId;
	const visited = new Set<string>();
	while (!visited.has(groupId)) {
		visited.add(groupId);
		const parentId = registry.get(groupId)?.parentId;
		if (!parentId || parentId === MAIN_AGENT_ID) break;
		groupId = parentId;
	}
	return { groupId, coordinatorId };
}

function renderSubagentUserPrompt(assignment: string): string {
	return prompt.render(subagentUserPromptTemplate, {
		assignment: assignment.trim(),
	});
}

// Re-export types and utilities
export { loadBundledAgents as BUNDLED_AGENTS } from "./agents";
export { discoverCommands, expandCommand, getCommand } from "./commands";
export { discoverAgents, getAgent, getAgentPickerData } from "./discovery";
export { AgentOutputManager } from "./output-manager";
export type { SpawnRecord } from "./spawn-record";
export { composeSpawnPrompt, createSpawnRecord, isSpawnRecord, SPAWN_RECORD_VERSION } from "./spawn-record";
export { formatAvailableModels, formatInvalidModelOverrideError, formatModelChain } from "./spawn-route";
export type {
	AgentDefinition,
	AgentProgress,
	SingleResult,
	SubagentEventPayload,
	SubagentLifecyclePayload,
	SubagentProgressPayload,
	TaskParams,
	TaskToolDetails,
} from "./types";
export {
	TASK_SUBAGENT_EVENT_CHANNEL,
	TASK_SUBAGENT_LIFECYCLE_CHANNEL,
	TASK_SUBAGENT_PROGRESS_CHANNEL,
	taskSchema,
} from "./types";

// Built-in tools whose approval tier is "read" (see tool classes' `approval`).
// An agent is read-only iff its declared tools are a non-empty subset of this set.
// Fail-safe: any unknown tool makes the agent not read-only.
export const READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
	"read",
	"search",
	"find",
	"web_search",
	"ast_grep",
	"yield",
	"irc",
	"ask",
	"job",
	"todo",
	"recall",
	"reflect",
	"retain",
	"memory_edit",
	"render_mermaid",
	"inspect_image",
	"checkpoint",
	"rewind",
	"resolve",
	"report_finding",
	"search_tool_bm25",
]);

const PLAN_MODE_BASE_TOOLS = ["read", "search", "find", "lsp", "web_search"];
const PLAN_MODE_AGENT_TOOL_ALLOWLIST: ReadonlySet<string> = new Set(["ast_grep", "report_finding"]);

export function resolveSubagentLspEnabled(session: Pick<ToolSession, "enableLsp" | "settings">): boolean {
	return (session.enableLsp ?? true) && session.settings.get("task.enableLsp");
}

export function resolveSubagentDefinition(agent: AgentDefinition, planModeEnabled: boolean): AgentDefinition {
	if (!planModeEnabled) return agent;
	const tools = [
		...PLAN_MODE_BASE_TOOLS,
		...(agent.tools ?? []).filter(
			tool => PLAN_MODE_AGENT_TOOL_ALLOWLIST.has(tool) && !PLAN_MODE_BASE_TOOLS.includes(tool),
		),
	];
	return {
		...agent,
		systemPrompt: `${planModeSubagentPrompt}\n\n${agent.systemPrompt}`,
		tools,
		spawns: undefined,
	};
}

export function isReadOnlyAgent(agent: AgentDefinition): boolean {
	return !!agent.tools?.length && agent.tools.every(tool => READ_ONLY_TOOL_NAMES.has(tool));
}

/**
 * Preview text for a child result. Falls back to "(no output)" — annotated
 * with the request count when the child actually did work, so the parent can
 * tell a no-op child from one that burned requests before being cancelled.
 */
export function formatResultOutputFallback(result: Pick<SingleResult, "output" | "stderr" | "requests">): string {
	const base = result.output.trim() || result.stderr.trim();
	if (base) return base;
	return result.requests > 0 ? `(no output) after ${result.requests} req` : "(no output)";
}

/**
 * Render the tool description from a cached agent list and current settings.
 */
function renderDescription(
	agents: AgentDefinition[],
	maxConcurrency: number,
	isolationEnabled: boolean,
	disabledAgents: string[],
	batchEnabled: boolean,
	asyncEnabled: boolean,
	ircEnabled: boolean,
	parentSpawns: string,
): string {
	const spawningDisabled = parentSpawns === "";
	let filteredAgents = disabledAgents.length > 0 ? agents.filter(a => !disabledAgents.includes(a.name)) : agents;
	if (spawningDisabled) {
		filteredAgents = [];
	} else if (parentSpawns !== "*") {
		const allowed = new Set(
			parentSpawns
				.split(",")
				.map(s => s.trim())
				.filter(Boolean),
		);
		filteredAgents = filteredAgents.filter(a => allowed.has(a.name));
	}
	const renderedAgents = filteredAgents.map(agent => ({
		name: agent.name,
		description: agent.description,
		readOnly: isReadOnlyAgent(agent),
	}));
	return prompt.render(taskDescriptionTemplate, {
		agents: renderedAgents,
		spawningDisabled,
		MAX_CONCURRENCY: maxConcurrency,
		isolationEnabled,
		batchEnabled,
		asyncEnabled,
		ircEnabled,
	});
}

function createTaskModeError(text: string): AgentToolResult<TaskToolDetails> {
	return {
		content: [{ type: "text", text }],
		details: { projectAgentsDir: null, results: [], totalDurationMs: 0 },
	};
}

function createSpawnCordonRefusal(cordon: SessionSpawnCordon): AgentToolResult<TaskToolDetails> {
	return {
		content: [
			{
				type: "text",
				text: `Spawn refused: session is cordoned for rollout ${cordon.rolloutId} (${cordon.expectedDigest}).`,
			},
		],
		details: { projectAgentsDir: null, results: [], totalDurationMs: 0, spawnRefusal: cordon },
	};
}
function createSessionPausedRefusal(): AgentToolResult<TaskToolDetails> {
	return {
		content: [{ type: "text", text: "Spawn refused: session is paused by fleet control." }],
		details: {
			projectAgentsDir: null,
			results: [],
			totalDurationMs: 0,
			pauseRefusal: { kind: "SessionControlPaused", reason: "session paused by fleet control" },
		},
	};
}

/**
 * Reject fields the current configuration does not accept. `schema` is never
 * accepted (structured output comes from the agent definition's `output`
 * frontmatter, the inherited session schema, or an eval-workflow
 * `agent(..., schema)` call); `tasks`/`context` require `task.batch`.
 */
function validateShapeParams(batchEnabled: boolean, params: TaskParams): string | undefined {
	if ((params as Record<string, unknown>).schema !== undefined) {
		return "The task tool does not accept `schema`. Rely on the selected agent definition's `output` schema or the inherited session schema; workflows needing ad-hoc structured output use eval `agent(prompt, schema)`.";
	}
	if (!batchEnabled) {
		const disallowed = (["tasks", "context"] as const).filter(field => params[field] !== undefined);
		if (disallowed.length > 0) {
			return `task.batch is disabled, so the task tool does not accept ${disallowed.map(f => `\`${f}\``).join(" or ")}. Spawn one agent per call with \`assignment\`, or enable the task.batch setting.`;
		}
	}
	return undefined;
}

/**
 * Validate the spawn parameter contract against the wire shapes. `agent` is
 * always required. With `task.batch` the model-facing shape is
 * `{ agent, context, tasks[] }` — `tasks` non-empty with per-item assignments
 * and unique ids, `context` non-empty, no top-level `assignment` alongside.
 * The flat `{ agent, ...item }` form stays accepted at runtime under either
 * setting (internal callers, stale transcripts). Returns a problem
 * description, or undefined when valid.
 */
function validateSpawnParams(params: TaskParams, batchEnabled: boolean): string | undefined {
	const agent = typeof params.agent === "string" ? params.agent.trim() : "";
	if (!agent) {
		return "Missing `agent`. Provide an agent type to spawn.";
	}
	const hasAssignment = typeof params.assignment === "string" && params.assignment.trim() !== "";
	const tasks = params.tasks;
	if (batchEnabled && tasks !== undefined) {
		if (!Array.isArray(tasks) || tasks.length === 0) {
			return "Missing `tasks`. Provide at least one task item ({ id?, description?, assignment }).";
		}
		if (hasAssignment) {
			return "Top-level `assignment` is not part of the batch shape. Put the work in `tasks[]` items.";
		}
		for (let i = 0; i < tasks.length; i++) {
			const item = tasks[i];
			if (!item || typeof item.assignment !== "string" || item.assignment.trim() === "") {
				return `Task ${i + 1}${item?.id ? ` (\`${item.id}\`)` : ""} is missing \`assignment\`. Every task needs complete, self-contained instructions.`;
			}
		}
		const seen = new Map<string, string>();
		for (const item of tasks) {
			const id = item.id?.trim();
			if (!id) continue;
			const key = id.toLowerCase();
			const existing = seen.get(key);
			if (existing !== undefined) {
				return `Duplicate task id ${existing === id ? `\`${id}\`` : `\`${existing}\` / \`${id}\``}. Provided ids must be unique within a call (case-insensitive).`;
			}
			seen.set(key, id);
		}
		if (typeof params.context !== "string" || params.context.trim() === "") {
			return "Missing `context`. Provide the shared background for this batch — goal, constraints, and any contract the tasks share.";
		}
		return undefined;
	}
	if (!hasAssignment) {
		return batchEnabled
			? "Missing `tasks`. Provide a `tasks` array (one subagent per item) with a shared `context`."
			: "Missing `assignment`. Provide complete, self-contained instructions for the agent.";
	}
	return undefined;
}

/**
 * Normalize a validated call into its spawn list: the `tasks[]` batch when
 * provided, otherwise the single top-level spawn.
 */
function resolveSpawnItems(params: TaskParams): TaskItem[] {
	if (Array.isArray(params.tasks) && params.tasks.length > 0) {
		return params.tasks;
	}
	return [
		{
			id: params.id,
			description: params.description,
			role: params.role,
			model: params.model,
			assignment: params.assignment,
			timeoutSec: params.timeoutSec,
		},
	];
}

/**
 * Per-spawn params handed to the executor path: top-level call fields with the
 * item's identity substituted in. `tasks` never leaks into a spawn; the shared
 * `context` rides along unchanged. Keys are only materialized when present —
 * `#runSpawn` distinguishes an absent `isolated` from an explicit one. The
 * item's `isolated` (batch form) wins over the top-level flag (flat form).
 */
function spawnParamsFor(params: TaskParams, item: TaskItem): TaskParams {
	const spawn: TaskParams = { agent: params.agent };
	if (item.id !== undefined) spawn.id = item.id;
	if (item.description !== undefined) spawn.description = item.description;
	if (item.role !== undefined) spawn.role = item.role;
	if (item.model !== undefined) {
		spawn.model = item.model;
	} else if (params.model !== undefined) {
		spawn.model = params.model;
	}
	if (item.assignment !== undefined) spawn.assignment = item.assignment;
	if (item.timeoutSec !== undefined) spawn.timeoutSec = item.timeoutSec;
	if (params.context !== undefined) spawn.context = params.context;
	if (item.isolated !== undefined) {
		spawn.isolated = item.isolated;
	} else if ("isolated" in params) {
		spawn.isolated = params.isolated;
	}
	return spawn;
}

/** Generic worker agents whose output sharpens with a tailored `role` rather than the bare type. */
const GENERIC_SPAWN_AGENTS: ReadonlySet<string> = new Set(["quick_task"]);

/**
 * Advisory — never a rejection — marks the deprecated `task` alias and nudges
 * generic workers toward tailored specialists while spawn capacity remains.
 */
export function buildSpecializationAdvisory(
	agentName: string | undefined,
	items: TaskItem[],
	depthCapacity: boolean,
): string | undefined {
	if (agentName === "task") {
		return (
			'Deprecated alias: `agent: "task"` is marked `deprecated-alias` and resolves through the `implementer` ' +
			'responsibility lane. Migrate this spawn to `agent: "implementer"`; the alias remains non-blocking during migration.'
		);
	}
	if (!depthCapacity) return undefined;
	const rolelessCount = items.filter(item => !item.role?.trim()).length;
	if (rolelessCount === 0) return undefined;
	const generic = agentName !== undefined && GENERIC_SPAWN_AGENTS.has(agentName);
	const cloned = items.length >= 2 && rolelessCount === items.length;
	if (!generic && !cloned) return undefined;
	const label = agentName ?? "task";
	return (
		`Tip: spawned ${rolelessCount} \`${label}\` worker${rolelessCount === 1 ? "" : "s"} without a \`role\`. ` +
		`Tailored specialists outperform generic workers — give each spawn a \`role\` naming its expertise ` +
		`(e.g. "Auth-flow security reviewer"). Depth budget remains, so decompose into named specialists ` +
		`rather than cloning one generic worker.`
	);
}

/**
 * Suggestion — never a rejection — nudging the spawner to coordinate via `irc`
 * when one call creates ≥2 live siblings and it still holds spawn capacity.
 * Returns undefined when there is nothing to coordinate or IRC is unavailable.
 */
export function buildCoordinationAdvisory(
	items: TaskItem[],
	depthCapacity: boolean,
	ircEnabled: boolean,
): string | undefined {
	if (!depthCapacity || !ircEnabled || items.length < 2) return undefined;
	return (
		`Coordinate: ${items.length} siblings are running together. If their work overlaps, have them ` +
		`message each other via \`irc\` (by id, or "all" to broadcast) before editing shared files — ` +
		`live coordination beats a serial handoff. Check \`irc\` op:"list" to see who is doing what.`
	);
}

/**
 * Compose the non-blocking advisory appended to a `task` result: the
 * specialization nudge, plus — only when the siblings keep running after this
 * call (`willRunAsync`) — the coordination suggestion. Coordination is gated on
 * async because a sync fanout's siblings have already finished, so a
 * "coordinate while they run" hint would misfire. Returns undefined when
 * neither applies.
 */
export function composeSpawnAdvisory(args: {
	agentName: string | undefined;
	items: TaskItem[];
	depthCapacity: boolean;
	ircEnabled: boolean;
	willRunAsync: boolean;
}): string | undefined {
	return (
		[
			buildSpecializationAdvisory(args.agentName, args.items, args.depthCapacity),
			args.willRunAsync ? buildCoordinationAdvisory(args.items, args.depthCapacity, args.ircEnabled) : undefined,
		]
			.filter(Boolean)
			.join("\n\n") || undefined
	);
}

const CONTINUATION_ID_SUFFIXES = ["Resume", "Retry", "Continue", "Redo", "Finish"] as const;
const LEADING_CONTINUATION_WORDS = ["resume", "retry", "continue", "redo", "finish"] as const;
const COMPACT_AGENT_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const DEDUPE_ID_SUFFIX = /-\d+$/;

export type SpawnIdentityMatchKind = "exact" | "continuation" | "dedupe";

export interface SpawnIdentityCandidate {
	id: string;
	status: AgentStatus | ArchivedDirectChildDescriptor["state"];
	revivable: boolean;
	archived: boolean;
}

export interface SpawnIdentityMatch {
	candidate: SpawnIdentityCandidate;
	kind: SpawnIdentityMatchKind;
	refuse: boolean;
	requestedId?: string;
}

function compactSpawnIdentifiers(item: TaskItem): string[] {
	const identifiers: string[] = [];
	for (const value of [item.id, item.description, item.assignment]) {
		const trimmed = value?.trim();
		if (trimmed && COMPACT_AGENT_ID.test(trimmed) && !identifiers.includes(trimmed)) identifiers.push(trimmed);
	}
	return identifiers;
}

function classifySpawnIdentifier(requested: string, existing: string): SpawnIdentityMatchKind | undefined {
	if (requested === existing) return "exact";
	for (const suffix of CONTINUATION_ID_SUFFIXES) {
		if (requested === `${existing}${suffix}` || requested === `${existing}-${suffix}`) return "continuation";
	}
	const requestedBase = requested.replace(DEDUPE_ID_SUFFIX, "");
	const existingBase = existing.replace(DEDUPE_ID_SUFFIX, "");
	return requested !== existing && requestedBase === existingBase ? "dedupe" : undefined;
}

function startsWithContinuationIntent(text: string | undefined, existing: string): boolean {
	const normalized = text?.trim().toLowerCase();
	if (!normalized) return false;
	const target = existing.toLowerCase();
	for (const action of LEADING_CONTINUATION_WORDS) {
		const prefix = `${action} ${target}`;
		if (normalized === prefix || normalized.startsWith(`${prefix} `) || normalized.startsWith(`${prefix}:`))
			return true;
	}
	return false;
}

/** Pick the strongest cheap identity collision without fuzzy semantic matching. */
export function findSpawnIdentityMatch(
	item: TaskItem,
	candidates: readonly SpawnIdentityCandidate[],
): SpawnIdentityMatch | undefined {
	const identifiers = compactSpawnIdentifiers(item);
	let best: { match: SpawnIdentityMatch; score: number } | undefined;
	for (const candidate of candidates) {
		let kind: SpawnIdentityMatchKind | undefined;
		for (const identifier of identifiers) {
			kind = classifySpawnIdentifier(identifier, candidate.id);
			if (kind) break;
		}
		if (
			!kind &&
			(startsWithContinuationIntent(item.description, candidate.id) ||
				startsWithContinuationIntent(item.assignment, candidate.id))
		) {
			kind = "continuation";
		}
		if (!kind) continue;
		const refuse =
			(!candidate.archived &&
				candidate.status === "running" &&
				(kind === "exact" || kind === "continuation")) ||
			(candidate.revivable &&
				(candidate.status === "idle" || candidate.status === "parked") &&
				(kind === "exact" || kind === "continuation"));
		const score = (refuse ? 10 : 0) + (kind === "exact" ? 3 : kind === "continuation" ? 2 : 1);
		if (!best || score > best.score) {
			best = {
				match: {
					candidate,
					kind,
					refuse,
					...(item.id?.trim() ? { requestedId: item.id.trim() } : {}),
				},
				score,
			};
		}
	}
	return best?.match;
}

export function renderSpawnIdentityNotice(match: SpawnIdentityMatch): string {
	const { candidate } = match;
	const requested = match.requestedId ? `agent \`${match.requestedId}\`` : "this spawn";
	const relation =
		match.kind === "exact"
			? "the same id as"
			: match.kind === "continuation"
				? "a continuation of"
				: "a deduped id of";
	const state = `${candidate.archived ? "archived, " : ""}${candidate.status}${candidate.revivable ? ", revivable" : ""}`;
	const ircGuidance =
		`Use \`irc\` with \`op:"send", to:"${candidate.id}", message:"<follow-up>"\` instead; ` +
		`read history://${candidate.id} for its context.`;
	if (match.refuse) {
		return (
			`Spawn refused: ${requested} is ${relation} existing agent \`${candidate.id}\` (${state}). ` +
			`${ircGuidance} One message resumes it in place with context intact.`
		);
	}
	if (candidate.status === "running") {
		return (
			`Warning: ${requested} is ${relation} running agent \`${candidate.id}\`. The spawn will proceed, ` +
			`but this duplicates live work. ${ircGuidance}`
		);
	}
	if (candidate.revivable) {
		return (
			`Warning: ${requested} is ${relation} existing agent \`${candidate.id}\` (${state}). ` +
			`The spawn will proceed. ${ircGuidance}`
		);
	}
	return (
		`Warning: ${requested} is ${relation} terminated agent \`${candidate.id}\` (${state}). ` +
		`The spawn will proceed. Salvage prior context from history://${candidate.id} first.`
	);
}

/**
 * Process-level memo for create-time agent discovery, keyed by resolved cwd.
 *
 * `TaskTool.create` runs for every (sub)agent session in this process and the
 * walk-up + plugin-registry scan in `discoverAgents` is identical for a given
 * cwd, so repeat creations reuse the first scan. Execution-time discovery
 * (`#runSpawn`) intentionally stays fresh. The memo also tracks the live
 * `discoverAgents` binding: test spies swap that binding, which invalidates
 * the memo automatically.
 */
const discoveryMemo = new Map<string, Promise<DiscoveryResult>>();
let discoveryMemoFn: typeof discoverAgents | undefined;

function discoverAgentsForCreate(cwd: string): Promise<DiscoveryResult> {
	const fn = discoverAgents;
	if (discoveryMemoFn !== fn) {
		discoveryMemoFn = fn;
		discoveryMemo.clear();
	}
	const key = path.resolve(cwd);
	let pending = discoveryMemo.get(key);
	if (!pending) {
		pending = fn(cwd);
		discoveryMemo.set(key, pending);
		pending.catch(() => {
			if (discoveryMemo.get(key) === pending) discoveryMemo.delete(key);
		});
	}
	return pending;
}

export function reattachDetachedChildTask(options: {
	manager: AsyncJobManager;
	child: ReAdoptedChild;
	ownerId?: string;
}): string {
	const { manager, child } = options;
	const existing = manager.getJob(child.id);
	if (existing?.status === "running") return existing.id;
	const processIdentity = child.detachedProcess;
	if (!processIdentity) throw new Error(`Detached child ${child.id} has no verified process identity`);
	const registry = AgentRegistry.global();
	const lifecycle = AgentLifecycleManager.global();
	return manager.register(
		"task",
		child.id,
		async ({ signal, markRunning }) => {
			markRunning();
			let outcome;
			try {
				outcome = await monitorDetachedSpawnWorker({
					sessionFile: child.sessionFile,
					processIdentity,
					signal,
				});
			} catch (error) {
				if (registry.get(child.id)?.sessionFile === child.sessionFile) await lifecycle.release(child.id);
				throw error;
			}
			if (registry.get(child.id)?.sessionFile === child.sessionFile) registry.setStatus(child.id, "parked");
			const transcript = `Transcript: history://${child.id}`;
			if (outcome.state === "failed" || outcome.state === "interrupted") {
				throw new TaskJobError(`Re-adopted background task ${child.id} ended ${outcome.state}. ${transcript}`);
			}
			return `Re-adopted background task ${child.id} complete. ${transcript}`;
		},
		{
			id: child.id,
			ownerId: options.ownerId ?? MAIN_AGENT_ID,
			group: deriveSpawnGroup(options.ownerId ?? MAIN_AGENT_ID),
		},
	);
}

/** Supervise a journal-continuous replacement turn under its original async job id. */
export function respawnReAdoptedChildTask(options: {
	manager: AsyncJobManager;
	child: ReAdoptedChild;
	session: AgentSession;
	ownerId?: string;
}): string {
	const { manager, child, session } = options;
	const existing = manager.getJob(child.id);
	if (existing?.status === "running") return existing.id;
	return manager.register(
		"task",
		child.id,
		async ({ signal, markRunning }) => {
			markRunning();
			const abort = (): void => session.agent.abort();
			signal.addEventListener("abort", abort, { once: true });
			try {
				await session.agent.continue();
				return `Re-adopted background task ${child.id} complete. Transcript: history://${child.id}`;
			} finally {
				signal.removeEventListener("abort", abort);
			}
		},
		{
			id: child.id,
			ownerId: options.ownerId ?? MAIN_AGENT_ID,
			group: deriveSpawnGroup(options.ownerId ?? MAIN_AGENT_ID),
		},
	);
}

/**
 * Task tool - Delegate tasks to specialized agents.
 *
 * Each call spawns one subagent — or, with `task.batch`, one per `tasks[]`
 * item. When `async.enabled` is on, spawns run as AsyncJobManager jobs; when
 * disabled, the tool blocks until every spawn finishes.
 */
export class TaskTool implements AgentTool<TaskToolSchemaInstance, TaskToolDetails, Theme> {
	readonly name = "task";
	readonly approval = "exec" as const;
	readonly formatApprovalDetails = (args: unknown): string[] => {
		const params = args as Partial<TaskParams>;
		const lines: string[] = [];
		if (typeof params.agent === "string") {
			lines.push(`Agent: ${truncateForPrompt(params.agent)}`);
		}
		if (typeof params.role === "string" && params.role.trim()) {
			lines.push(`Role: ${truncateForPrompt(params.role)}`);
		}
		if (typeof params.id === "string" && params.id.trim()) {
			lines.push(`Task: ${truncateForPrompt(params.id)}`);
		}
		if (typeof params.assignment === "string") {
			lines.push(`Assignment:\n${truncateForPrompt(params.assignment)}`);
		}
		if (typeof params.context === "string" && params.context.trim()) {
			lines.push(`Context:\n${truncateForPrompt(params.context)}`);
		}
		const tasks = Array.isArray(params.tasks) ? params.tasks : [];
		const firstTask = tasks[0];
		if (firstTask) {
			if (typeof firstTask.id === "string" && firstTask.id.trim()) {
				lines.push(`Task: ${truncateForPrompt(firstTask.id)}`);
			}
			if (typeof firstTask.role === "string" && firstTask.role.trim()) {
				lines.push(`Role: ${truncateForPrompt(firstTask.role)}`);
			}
			if (typeof firstTask.assignment === "string") {
				lines.push(`Assignment:\n${truncateForPrompt(firstTask.assignment)}`);
			}
			if (tasks.length > 1) {
				lines.push(`+${tasks.length - 1} more task${tasks.length === 2 ? "" : "s"}`);
			}
		}
		return lines;
	};
	readonly label = "Task";
	readonly summary = "Spawn subagents to complete delegated tasks";
	readonly strict = true;
	readonly loadMode = "discoverable";
	readonly renderResult = renderResult;
	// Suppress the streaming call preview once a (partial or final) result exists
	// so the task renders as ONE block that transitions in place — not a pending
	// call frame stacked above the result frame. Mirrors `taskToolRenderer`.
	readonly mergeCallAndResult = true;
	readonly #discoveredAgents: AgentDefinition[];
	readonly #blockedAgent: string | undefined;
	/** Schedule-time route decisions keyed by agentId, consumed by #runSpawn to avoid duplicate work. */
	#preResolvedModels = new Map<string, SpawnRouteDecision>();
	readonly #fallbackAdmissionSessionId = `ephemeral:${process.pid}:${randomUUID()}`;
	readonly #resourceLeaseAcquirer: ResourceLeaseAcquirer;

	get parameters(): TaskToolSchemaInstance {
		const isolationEnabled = this.session.settings.get("task.isolation.mode") !== "none";
		return getTaskSchema({ isolationEnabled, batchEnabled: this.#isBatchEnabled() });
	}

	renderCall(args: unknown, options: Parameters<typeof renderTaskCall>[1], theme: Theme) {
		return renderTaskCall(repairTaskParams(args as TaskParams), options, theme);
	}

	/** Dynamic description that reflects current disabled-agent settings */
	get description(): string {
		const disabledAgents = this.session.settings.get("task.disabledAgents") as string[];
		const maxConcurrency = this.session.settings.get("task.maxConcurrency");
		const isolationMode = this.session.settings.get("task.isolation.mode");
		return renderDescription(
			this.#discoveredAgents,
			maxConcurrency,
			isolationMode !== "none",
			disabledAgents,
			this.#isBatchEnabled(),
			this.session.settings.get("async.enabled"),
			isIrcEnabled(this.session.settings, this.session.taskDepth ?? 0),
			this.session.getSessionSpawns() ?? "*",
		);
	}
	private constructor(
		private readonly session: ToolSession,
		discoveredAgents: AgentDefinition[],
	) {
		this.#blockedAgent = $env.PI_BLOCKED_AGENT;
		this.#discoveredAgents = discoveredAgents;
		this.#resourceLeaseAcquirer = agentId => {
			const attemptId = randomUUID();
			return this.#acquireResourceLease(attemptId, "revive", agentId, `revive:${attemptId}`);
		};
	}

	#isBatchEnabled(): boolean {
		return this.session.settings.get("task.batch");
	}

	async #acquireResourceLease(
		attemptId: string,
		kind: ResourceAttemptKind,
		agentId: string,
		jobId: string,
		signal?: AbortSignal,
	): Promise<HostResourceLease> {
		const holderProcess = readProcessIdentity(process.pid);
		if (!holderProcess) {
			throw new HostAdmissionRejectedError(
				"authority-unavailable",
				`Cannot prove process identity before starting ${agentId}`,
			);
		}
		return HostResourceAdmission.global({
			memoryBudgetBytes: this.session.settings.getGlobal("task.globalAdmission.memoryBudgetBytes"),
			onPressure: async () => {
				await AgentLifecycleManager.global().reclaimIdleChildrenForHostPressure();
			},
		}).acquire(
			{
				attemptId,
				kind,
				sessionId: this.session.getSessionId?.() ?? this.#fallbackAdmissionSessionId,
				sessionOwnerEpoch: this.session.sessionManager?.getSessionOwnership()?.ownerEpoch ?? null,
				parentAgentId: this.session.getAgentId?.() ?? MAIN_AGENT_ID,
				agentId,
				jobId,
				holderProcess,
				reservationBytes: this.session.settings.getGlobal("task.globalAdmission.attemptReservationBytes"),
			},
			{
				signal,
				onDeferred: decision => {
					logger.info("Task start deferred by host resource admission", {
						agentId,
						attemptId,
						reason: decision.reason,
						queueDepth: decision.queueDepth,
					});
				},
			},
		);
	}

	/**
	 * Create a TaskTool instance with async agent discovery.
	 */
	static async create(session: ToolSession): Promise<TaskTool> {
		const { agents } = await discoverAgentsForCreate(session.cwd);
		return new TaskTool(session, agents);
	}

	async #spawnIdentityCandidates(): Promise<SpawnIdentityCandidate[]> {
		const registry = AgentRegistry.global();
		const ownerId = this.session.getAgentId?.();
		const refs = registry.list();
		const candidates: SpawnIdentityCandidate[] = refs
			.filter(ref => ref.kind === "sub" && ref.id !== ownerId)
			.map(ref => ({
				id: ref.id,
				status: ref.status,
				revivable: AgentLifecycleManager.global().canResumeInPlace(ref.id),
				archived: false,
			}));
		const parentSessionFile = this.session.getSessionFile();
		if (!parentSessionFile) return candidates;
		const registeredIds = new Set(refs.map(ref => ref.id));
		for (const child of await listArchivedDirectChildren(parentSessionFile)) {
			if (registeredIds.has(child.agentId)) continue;
			candidates.push({
				id: child.agentId,
				status: child.state,
				revivable: false,
				archived: true,
			});
		}
		return candidates;
	}

	async execute(
		toolCallId: string,
		rawParams: unknown,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TaskToolDetails>,
	): Promise<AgentToolResult<TaskToolDetails>> {
		let params = repairTaskParams(rawParams as TaskParams);
		const batchEnabled = this.#isBatchEnabled();
		const validationError = validateShapeParams(batchEnabled, params) ?? validateSpawnParams(params, batchEnabled);
		if (validationError) {
			return createTaskModeError(validationError);
		}
		if (this.session.isSessionControlPaused?.()) return createSessionPausedRefusal();
		const cordon = this.session.getSessionId ? getSessionSpawnCordon(this.session.getSessionId() ?? "") : undefined;
		if (cordon) return createSpawnCordonRefusal(cordon);

		if (batchEnabled) {
			const context = await prepareSpawnContext(
				this.session.cwd,
				this.session.settings.get("task.spawnGuidePath"),
				params.context,
			);
			params = { ...params, context };
		}

		const spawnItems = resolveSpawnItems(params);
		const selectedAgent = this.#discoveredAgents.find(agent => agent.name === params.agent);
		const asyncEnabled = this.session.settings.get("async.enabled");
		const manager = asyncEnabled ? this.session.asyncJobManager : undefined;
		const depthCapacity = canSpawnAtDepth(
			this.session.settings.get("task.maxRecursionDepth") ?? 2,
			this.session.taskDepth ?? 0,
		);
		const ircEnabled = isIrcEnabled(this.session.settings, this.session.taskDepth ?? 0);
		const identityCandidates = await this.#spawnIdentityCandidates();
		const identityMatches = spawnItems
			.map(item => findSpawnIdentityMatch(item, identityCandidates))
			.filter((match): match is SpawnIdentityMatch => match !== undefined);
		const refusedIdentity = identityMatches.find(match => match.refuse);
		if (refusedIdentity) {
			return {
				content: [{ type: "text", text: renderSpawnIdentityNotice(refusedIdentity) }],
				details: { projectAgentsDir: null, results: [], totalDurationMs: 0 },
			};
		}
		const identityAdvisory =
			identityMatches.length > 0 ? identityMatches.map(renderSpawnIdentityNotice).join("\n\n") : undefined;
		// Coordination only makes sense when the siblings keep running after this
		// call returns (async). In the sync fallback they have already completed,
		// so a "coordinate while they run" hint would misfire.
		const willRunAsync = !!manager && selectedAgent?.blocking !== true;
		const spawnAdvisory = this.session.suppressSpawnAdvisory
			? undefined
			: composeSpawnAdvisory({
					agentName: params.agent,
					items: spawnItems,
					depthCapacity,
					ircEnabled,
					willRunAsync,
				});
		const advisory = [identityAdvisory, spawnAdvisory].filter(Boolean).join("\n\n") || undefined;
		// Returns a fresh result (copied content array, copied text part) rather
		// than mutating the caller's — task results are short-lived here, but an
		// in-place edit on a shared/cached AgentToolResult would be a hidden trap.
		const withAdvisory = (result: AgentToolResult<TaskToolDetails>): AgentToolResult<TaskToolDetails> => {
			if (!advisory) return result;
			let appended = false;
			const content = result.content.map(part => {
				if (!appended && part.type === "text" && typeof part.text === "string") {
					appended = true;
					return { ...part, text: `${part.text}\n\n${advisory}` };
				}
				return part;
			});
			if (!appended) content.push({ type: "text", text: advisory });
			return { ...result, content };
		};
		if (!asyncEnabled || !manager || selectedAgent?.blocking === true) {
			// Sync fallback: async execution disabled, orphaned host that never
			// wired a job manager, or an agent definition that declares
			// `blocking: true`. The host authority still governs every start.
			if (asyncEnabled && !manager) {
				logger.warn("task: no AsyncJobManager registered; falling back to sync execution");
			}
			return withAdvisory(await this.#executeSyncFanout(toolCallId, params, spawnItems, signal, onUpdate));
		}

		const agentLabel = params.agent ?? "task";
		const agentSource = selectedAgent?.source ?? "bundled";
		const routeDecisions: Array<SpawnRouteDecision | undefined> = [];
		for (const item of spawnItems) {
			const spawnParams = spawnParamsFor(params, item);
			const policySnapshot = selectedAgent ? await snapshotTaskSpawnPolicy(this.session) : undefined;
			let routeDecision = selectedAgent
				? resolveTaskSpawnRoute(this.session, agentLabel, selectedAgent, spawnParams, policySnapshot)
				: undefined;
			if (routeDecision && !routeDecision.invalid) {
				routeDecision = await applyQuotaAdmission(this.session, routeDecision, signal);
			}
			if (routeDecision && !routeDecision.invalid && !routeDecision.block) {
				routeDecision = await applyTaskAuthFallback(this.session, routeDecision);
			}
			const routeError = routeDecision ? formatTaskRouteError(this.session, agentLabel, routeDecision) : undefined;
			if (routeError) {
				return withAdvisory({
					content: [
						{
							type: "text",
							text: `Failed to start background task job${spawnItems.length === 1 ? "" : "s"}: ${routeError}`,
						},
					],
					details: { projectAgentsDir: null, results: [], totalDurationMs: 0 },
				});
			}
			routeDecisions.push(routeDecision);
		}

		// Resolve agent IDs only after every route has passed invalid-model and quota admission.
		const outputManager =
			this.session.agentOutputManager ?? new AgentOutputManager(this.session.getArtifactsDir ?? (() => null));
		const spawns: Array<{
			agentId: string;
			item: TaskItem;
			routeDecision: SpawnRouteDecision | undefined;
			progress: AgentProgress;
		}> = [];
		for (let index = 0; index < spawnItems.length; index++) {
			const item = spawnItems[index];
			const routeDecision = routeDecisions[index];
			const agentId = await outputManager.allocate(
				item.id?.trim() || generateTaskName(),
				candidate => AgentRegistry.global().get(candidate) !== undefined,
			);
			const assignment = (item.assignment ?? "").trim();
			spawns.push({
				agentId,
				item,
				routeDecision,
				progress: {
					index,
					id: agentId,
					agent: agentLabel,
					agentSource,
					status: "pending",
					task: renderSubagentUserPrompt(assignment),
					assignment,
					description: item.description,
					recentTools: [],
					recentOutput: [],
					toolCount: 0,
					requests: 0,
					tokens: 0,
					cost: 0,
					durationMs: 0,
					routeReceipt:
						routeDecision?.source && routeDecision.route && !routeDecision.invalid && !routeDecision.block
							? toSpawnRouteReceipt(routeDecision)
							: undefined,
					...(routeDecision
						? { modelOverride: [...routeDecision.resolvedPatterns], resolvedModel: routeDecision.route?.selector }
						: {}),
				},
			});
		}

		// Aggregate async state for the one tool call: every spawn's job reports
		// into the shared progress snapshot; the call stays "running" until all
		// jobs settle, then turns "failed" if any spawn failed. The single-spawn
		// case passes the job's own suggestion through (pre-batch behavior).
		const single = spawns.length === 1;
		let settledCount = 0;
		let failedCount = 0;
		let primaryJobId = spawns[0].agentId;
		const buildAsyncDetails = (state: "running" | "completed" | "failed", jobId: string): TaskToolDetails => ({
			projectAgentsDir: null,
			results: [],
			totalDurationMs: 0,
			progress: spawns.map(spawn => ({ ...spawn.progress })),
			async: {
				state: single ? state : settledCount < spawns.length ? "running" : failedCount > 0 ? "failed" : "completed",
				jobId: single ? jobId : primaryJobId,
				type: "task",
			},
		});

		const started: Array<{ agentId: string; jobId: string; description?: string; modelChain?: string }> = [];
		const failedSchedules: string[] = [];
		for (const spawn of spawns) {
			try {
				const spawnParams = spawnParamsFor(params, spawn.item);
				const routeDecision = spawn.routeDecision;
				if (routeDecision) this.#preResolvedModels.set(spawn.agentId, routeDecision);
				const spawnIsolated =
					this.session.settings.get("task.isolation.mode") !== "none" && spawnParams.isolated === true;
				const modelChain = formatModelChain(
					agentLabel,
					spawnParams.role,
					routeDecision?.route?.selector,
					routeDecision?.source,
				);
				// Reserve a durable `starting` identity before the nonblocking job is
				// registered: its body may sit in the durable host admission queue, and until
				// it builds a real session history/IRC would otherwise report this
				// genuinely-queued id as unknown. The child's own registration clears
				// the flag when it comes live; a startup failure finalizes it.
				this.#reserveStartingChild(spawn.agentId, agentLabel, spawn.item);
				const jobId = this.#registerSpawnJob({
					manager,
					toolCallId,
					spawnParams,
					agentId: spawn.agentId,
					progress: spawn.progress,
					isolated: spawnIsolated,
					ircEnabled,
					buildDetails: buildAsyncDetails,
					onUpdate,
					onSettled: failed => {
						settledCount += 1;
						if (failed) failedCount += 1;
					},
				});
				if (started.length === 0) primaryJobId = jobId;
				started.push({ agentId: spawn.agentId, jobId, description: spawn.item.description, modelChain });
			} catch (error) {
				this.#preResolvedModels.delete(spawn.agentId);
				// The reserve (if it happened before the failure) never came live;
				// finalize it as terminal so it stays inspectable but stops projecting
				// as active queued work.
				AgentRegistry.global().failStart(spawn.agentId);
				const message = error instanceof Error ? error.message : String(error);
				failedSchedules.push(`${spawn.agentId}: ${message}`);
				spawn.progress.status = "failed";
				settledCount += 1;
				failedCount += 1;
			}
		}

		if (started.length === 0) {
			return {
				content: [
					{
						type: "text",
						text: `Failed to start background task job${single ? "" : "s"}: ${failedSchedules.join("; ")}`,
					},
				],
				details: { projectAgentsDir: null, results: [], totalDurationMs: 0 },
			};
		}

		if (single) {
			const { agentId, jobId, description, modelChain } = started[0];
			const coordinationHint = ircEnabled
				? `DM \`${agentId}\` via \`irc\` to coordinate while it runs; use \`job\` only to inspect (\`list\`), wait (\`poll\`), or cancel a stuck task.`
				: `Use \`job\` to inspect (\`list\`), wait (\`poll\`), or cancel a stuck task.`;
			const descriptionSuffix = description ? ` — ${description}` : "";
			const modelSuffix = modelChain ? ` using ${modelChain}` : "";
			onUpdate?.({
				content: [{ type: "text", text: `Spawned agent \`${agentId}\`...` }],
				details: buildAsyncDetails("running", jobId),
			});
			return withAdvisory({
				content: [
					{
						type: "text",
						text: `Spawned agent \`${agentId}\` (job \`${jobId}\`)${descriptionSuffix}${modelSuffix}. The result will be delivered when it yields. ${coordinationHint}`,
					},
				],
				details: buildAsyncDetails("running", jobId),
			});
		}

		const coordinationHint = ircEnabled
			? `DM these ids via \`irc\` to coordinate while they run; use \`job\` only to inspect (\`list\`), wait (\`poll\`), or cancel a stuck task.`
			: `Use \`job\` to inspect (\`list\`), wait (\`poll\`), or cancel a stuck task by id.`;
		const scheduleFailureSummary =
			failedSchedules.length > 0
				? ` Failed to schedule ${failedSchedules.length} spawn${failedSchedules.length === 1 ? "" : "s"}: ${failedSchedules.join("; ")}.`
				: "";
		const startedListing = started
			.map(({ agentId, jobId, description, modelChain }) => {
				const prefix = `- \`${agentId}\` (job \`${jobId}\`)`;
				const chainSuffix = modelChain ? ` — ${modelChain}` : "";
				return description ? `${prefix} — ${description}${chainSuffix}` : `${prefix}${chainSuffix}`;
			})
			.join("\n");
		onUpdate?.({
			content: [{ type: "text", text: `Spawned ${started.length} agents...` }],
			details: buildAsyncDetails("running", primaryJobId),
		});
		return withAdvisory({
			content: [
				{
					type: "text",
					text: `Spawned ${started.length} background agents using ${agentLabel}.${scheduleFailureSummary} Each result will be delivered when that agent yields.\n${startedListing}\n${coordinationHint}`,
				},
			],
			details: buildAsyncDetails("running", primaryJobId),
		});
	}

	/**
	 * Reserve a durable, addressable identity for a child whose nonblocking job
	 * has been scheduled but whose body has not yet built a live session (it may
	 * be queued by host admission). Registered `running` + `starting: true`
	 * so history/IRC resolve it as genuinely-known queued work rather than
	 * unknown. Never clobbers an already-live session: the child's own
	 * `createAgentSession` registration overwrites this ref (dropping the flag)
	 * the moment it comes live, and {@link AgentRegistry.failStart} finalizes it
	 * if it never does.
	 */
	#reserveStartingChild(agentId: string, agentLabel: string, item: TaskItem): void {
		const registry = AgentRegistry.global();
		if (registry.get(agentId)?.session) return;
		registry.register({
			id: agentId,
			displayName: resolveSubagentDisplayName(item.role, agentLabel),
			kind: "sub",
			parentId: this.session.getAgentId?.() ?? MAIN_AGENT_ID,
			session: null,
			sessionFile: null,
			status: "running",
			starting: true,
		});
	}

	/** Register one background spawn job and feed its progress into the caller's aggregate snapshot. */
	#registerSpawnJob(options: {
		manager: AsyncJobManager;
		toolCallId: string;
		spawnParams: TaskParams;
		agentId: string;
		progress: AgentProgress;
		isolated: boolean;
		ircEnabled: boolean;
		buildDetails: (state: "running" | "completed" | "failed", jobId: string) => TaskToolDetails;
		onUpdate?: AgentToolUpdateCallback<TaskToolDetails>;
		onSettled?: (failed: boolean) => void;
	}): string {
		const {
			manager,
			toolCallId,
			spawnParams,
			agentId,
			progress,
			ircEnabled,
			isolated,
			buildDetails,
			onUpdate,
			onSettled,
		} = options;
		const buildFollowUpHint = (interrupted: boolean): string => {
			const ref = AgentRegistry.global().get(agentId);
			const addressable =
				(ref?.status === "running" || ref?.status === "idle") && ref.session !== null
					? true
					: ref?.status === "parked" && AgentLifecycleManager.global().canResumeInPlace(agentId);
			if (!addressable) {
				const reason = interrupted ? " after the interruption" : "";
				return (
					`\n\n${agentId} is no longer addressable${reason}. ` +
					`Salvage its transcript at history://${agentId} before spawning replacement work.`
				);
			}
			const state = interrupted ? "after the interruption" : "after this job";
			const send = ircEnabled ? "Send" : "When `irc` is available, send";
			return (
				`\n\n${agentId} remains addressable ${state}. ${send} one \`irc\` message ` +
				`(\`op:"send", to:"${agentId}"\`) to resume it in place with context intact; ` +
				`transcript at history://${agentId}`
			);
		};
		const attemptId = randomUUID();
		return manager.register(
			"task",
			agentId,
			async ({ jobId: ownJobId, signal: runSignal, reportProgress, markRunning }) => {
				let resourceLease: HostResourceLease;
				try {
					resourceLease = await this.#acquireResourceLease(attemptId, "spawn", agentId, ownJobId, runSignal);
				} catch (error) {
					this.#preResolvedModels.delete(agentId);
					progress.status = "aborted";
					AgentRegistry.global().failStart(agentId);
					onSettled?.(true);
					throw error;
				}
				const startedAt = Date.now();
				if (runSignal.aborted) {
					progress.status = "aborted";
					AgentRegistry.global().failStart(agentId);
					resourceLease.release();
					onSettled?.(true);
					throw new Error("Aborted before execution");
				}
				try {
					markRunning();
					progress.status = "running";
					await reportProgress(
						`Running background task ${agentId}...`,
						buildDetails("running", ownJobId) as unknown as Record<string, unknown>,
					);
					const result = await this.#executeSync(
						toolCallId,
						spawnParams,
						runSignal,
						undefined,
						agentId,
						progress.index,
						true,
					);
					const finalText = result.content.find(part => part.type === "text")?.text ?? "(no output)";
					const singleResult = result.details?.results[0];
					const resultFailed = recordFinalizedSubagentFailure(
						this.session.sessionManager,
						agentId,
						ownJobId,
						singleResult,
						runSignal.aborted,
						AgentRegistry.global().get(agentId) !== undefined,
					);
					updateFinalizedSubagentProgress(progress, singleResult, resultFailed, startedAt);
					onSettled?.(resultFailed);
					const statusText = resultFailed
						? `Background task ${agentId} failed.`
						: `Background task ${agentId} complete.`;
					await reportProgress(
						statusText,
						buildDetails(resultFailed ? "failed" : "completed", ownJobId) as unknown as Record<string, unknown>,
					);
					onUpdate?.({
						content: [{ type: "text", text: statusText }],
						details: buildDetails(resultFailed ? "failed" : "completed", ownJobId),
					});
					const deliveryText = `${finalText}${buildFollowUpHint(singleResult?.aborted === true)}`;
					if (resultFailed) {
						// Mark the job itself failed; the failed agent stays interrogable.
						throw new TaskJobError(deliveryText);
					}
					return deliveryText;
				} catch (error) {
					if (error instanceof TaskJobError) {
						throw error;
					}
					const message = error instanceof Error ? error.message : String(error);
					const ref = AgentRegistry.global().get(agentId);
					recordThrownSubagentFailure(
						this.session.sessionManager,
						agentId,
						ownJobId,
						message,
						runSignal.aborted,
						ref !== undefined,
					);
					progress.status = "failed";
					progress.durationMs = Math.max(0, Date.now() - startedAt);
					onSettled?.(true);
					const statusText = `Background task ${agentId} failed.`;
					await reportProgress(statusText, buildDetails("failed", ownJobId) as unknown as Record<string, unknown>);
					onUpdate?.({
						content: [{ type: "text", text: statusText }],
						details: buildDetails("failed", ownJobId),
					});
					const hint = buildFollowUpHint(false);
					throw new TaskJobError(`${message}${hint}`);
				} finally {
					// Finalize startup failure/terminal projection before capacity
					// becomes reusable. No-op once child registration cleared it.
					AgentRegistry.global().failStart(agentId);
					resourceLease.release();
				}
			},
			{
				id: agentId,
				queued: true,
				ownerId: this.session.getAgentId?.() ?? undefined,
				group: deriveSpawnGroup(this.session.getAgentId?.() ?? undefined),
				isolated,
				onProgress: (text, details) => {
					const progressDetails = (details as TaskToolDetails | undefined) ?? buildDetails("running", agentId);
					onUpdate?.({ content: [{ type: "text", text }], details: progressDetails });
				},
			},
		);
	}

	/**
	 * Sync fallback fan-out (no job manager, or a `blocking: true` agent): run
	 * every spawn to completion inline and merge the per-spawn payloads.
	 * Global admission governs starts across sessions; task.maxConcurrency only
	 * limits how many items this call schedules at once.
	 */
	async #executeSyncFanout(
		toolCallId: string,
		params: TaskParams,
		spawnItems: TaskItem[],
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TaskToolDetails>,
	): Promise<AgentToolResult<TaskToolDetails>> {
		if (spawnItems.length === 1) {
			const agentId = spawnItems[0].id?.trim() || params.agent || "subagent";
			const attemptId = randomUUID();
			const resourceLease = await this.#acquireResourceLease(
				attemptId,
				"spawn",
				agentId,
				`sync:${toolCallId}:0`,
				signal,
			);
			try {
				return await this.#executeSync(
					toolCallId,
					spawnParamsFor(params, spawnItems[0]),
					signal,
					onUpdate,
					undefined,
					0,
				);
			} finally {
				resourceLease.release();
			}
		}

		const startTime = Date.now();
		const progressAggregator = new ProgressAggregator(progress => {
			onUpdate?.({
				content: [{ type: "text", text: `Running ${spawnItems.length} agents...` }],
				details: {
					projectAgentsDir: null,
					results: [],
					totalDurationMs: Date.now() - startTime,
					progress: [...progress],
				},
			});
		});

		const { results: payloads } = await mapWithConcurrencyLimit(
			spawnItems,
			this.session.settings.get("task.maxConcurrency"),
			async (item, index, workerSignal) => {
				const agentId = item.id?.trim() || `${params.agent || "subagent"}-${index + 1}`;
				const attemptId = randomUUID();
				const resourceLease = await this.#acquireResourceLease(
					attemptId,
					"spawn",
					agentId,
					`sync:${toolCallId}:${index}`,
					workerSignal,
				);
				try {
					const itemOnUpdate: AgentToolUpdateCallback<TaskToolDetails> | undefined = onUpdate
						? update => {
								const progress = update.details?.progress?.[0];
								if (progress) {
									progressAggregator.update(index, { ...progress, index });
								}
							}
						: undefined;
					return await this.#executeSync(
						toolCallId,
						spawnParamsFor(params, item),
						workerSignal,
						itemOnUpdate,
						undefined,
						index,
					);
				} finally {
					resourceLease.release();
				}
			},
			signal,
		);
		progressAggregator.flush();
		progressAggregator.dispose();

		const results: SingleResult[] = [];
		const contentParts: string[] = [];
		const outputPaths: string[] = [];
		const usageTotals = createUsageTotals();
		let hasUsage = false;
		let projectAgentsDir: string | null = null;
		for (let index = 0; index < spawnItems.length; index++) {
			const payload = payloads[index];
			if (!payload) {
				contentParts.push(`Task ${spawnItems[index].id?.trim() || `#${index + 1}`}: cancelled before start.`);
				continue;
			}
			projectAgentsDir ??= payload.details?.projectAgentsDir ?? null;
			const text = payload.content.find(part => part.type === "text")?.text;
			if (text) contentParts.push(text);
			for (const result of payload.details?.results ?? []) {
				results.push({ ...result, index });
				if (result.usage) {
					addUsageTotals(usageTotals, result.usage);
					hasUsage = true;
				}
				if (result.outputPath) outputPaths.push(result.outputPath);
			}
		}

		return {
			content: [{ type: "text", text: contentParts.join("\n\n") }],
			details: {
				projectAgentsDir,
				results,
				totalDurationMs: Date.now() - startTime,
				usage: hasUsage ? usageTotals : undefined,
				outputPaths: outputPaths.length > 0 ? outputPaths : undefined,
			},
		};
	}

	/**
	 * Synchronous execution of one spawn. Used as the body of every
	 * async job and directly by the sync fallback (no job manager / blocking
	 * agent) and by in-process callers that need the result inline (e.g. the
	 * commit flow's analyze_files tool).
	 */
	async #executeSync(
		toolCallId: string,
		params: TaskParams,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TaskToolDetails>,
		preAllocatedId?: string,
		spawnIndex = 0,
		detached = false,
	): Promise<AgentToolResult<TaskToolDetails>> {
		return this.#runSpawn(toolCallId, params, signal, onUpdate, preAllocatedId, spawnIndex, detached);
	}

	/** Spawn a fresh subagent and run it to completion. */
	async #runSpawn(
		toolCallId: string,
		params: TaskParams,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TaskToolDetails>,
		preAllocatedId?: string,
		spawnIndex = 0,
		detached = false,
	): Promise<AgentToolResult<TaskToolDetails>> {
		const startTime = Date.now();
		try {
			await this.session.settings.reloadFromDisk();
		} catch (error) {
			logger.warn("task: failed to reload settings before spawning subagent", { error: String(error) });
		}
		if (this.session.isSessionControlPaused?.()) return createSessionPausedRefusal();
		const cordon = this.session.getSessionId ? getSessionSpawnCordon(this.session.getSessionId() ?? "") : undefined;
		if (cordon) return createSpawnCordonRefusal(cordon);
		const { agents, projectAgentsDir } = await discoverAgents(this.session.cwd);
		const agentName = params.agent ?? "";
		const preResolved = preAllocatedId ? this.#preResolvedModels.get(preAllocatedId) : undefined;
		if (preAllocatedId) this.#preResolvedModels.delete(preAllocatedId);
		const sharedContext = this.#isBatchEnabled() ? params.context?.trim() || undefined : undefined;
		const assignment = (params.assignment ?? "").trim();
		const isolationMode = this.session.settings.get("task.isolation.mode");
		const isolationRequested = "isolated" in params ? params.isolated === true : false;
		const isIsolated = isolationMode !== "none" && isolationRequested;
		const mergeMode = this.session.settings.get("task.isolation.merge");
		const commitStyle = this.session.settings.get("task.isolation.commits");
		const taskDepth = this.session.taskDepth ?? 0;
		const subagentLspEnabled = resolveSubagentLspEnabled(this.session);

		if (isolationMode === "none" && "isolated" in params) {
			return {
				content: [{ type: "text", text: "Task isolation is disabled." }],
				details: { projectAgentsDir, results: [], totalDurationMs: 0 },
			};
		}

		// Validate agent exists
		const agent = getAgent(agents, agentName);
		if (!agent) {
			const available = agents.map(a => a.name).join(", ") || "none";
			return {
				content: [{ type: "text", text: `Unknown agent "${agentName}". Available: ${available}` }],
				details: { projectAgentsDir, results: [], totalDurationMs: 0 },
			};
		}

		// Check if agent is disabled in settings
		const disabledAgents = this.session.settings.get("task.disabledAgents") as string[];
		if (disabledAgents.length > 0 && disabledAgents.includes(agentName)) {
			const enabled = agents.filter(a => !disabledAgents.includes(a.name)).map(a => a.name);
			return {
				content: [
					{
						type: "text",

						text: `Agent "${agentName}" is disabled in settings. Enable it via /agents, or use a different agent type.${enabled.length > 0 ? ` Available: ${enabled.join(", ")}` : ""}`,
					},
				],
				details: { projectAgentsDir, results: [], totalDurationMs: 0 },
			};
		}

		const planModeState = this.session.getPlanModeState?.();
		const effectiveAgent = resolveSubagentDefinition(agent, planModeState?.enabled === true);

		const policySnapshot = preResolved ? undefined : await snapshotTaskSpawnPolicy(this.session);
		let routeDecision =
			preResolved ?? resolveTaskSpawnRoute(this.session, agentName, effectiveAgent, params, policySnapshot);
		if (!preResolved && !routeDecision.invalid) {
			routeDecision = await applyQuotaAdmission(this.session, routeDecision, signal);
		}
		routeDecision = await applyTaskAuthFallback(this.session, routeDecision);
		const routeError = formatTaskRouteError(this.session, agentName, routeDecision);
		if (routeError) {
			const blockedEntry: SingleResult = {
				index: spawnIndex,
				id: "",
				agent: agentName,
				agentSource: agent.source,
				task: params.assignment ?? "",
				exitCode: 1,
				output: routeError,
				stderr: "",
				truncated: false,
				durationMs: Date.now() - startTime,
				tokens: 0,
				requests: 0,
				error: routeError,
				aborted: false,
			};
			return {
				content: [{ type: "text", text: routeError }],
				details: { projectAgentsDir, results: [blockedEntry], totalDurationMs: Date.now() - startTime },
			};
		}
		const routeReceipt =
			routeDecision.source && routeDecision.route && !routeDecision.invalid && !routeDecision.block
				? toSpawnRouteReceipt(routeDecision)
				: undefined;
		const modelOverride = [...routeDecision.resolvedPatterns];
		const parentActiveModelPattern = routeDecision.parentActiveSelector;
		const resolvedModel = routeDecision.route?.selector;
		const quotaAdmission = routeDecision.quotaAdmission;
		const thinkingLevelOverride = effectiveAgent.thinkingLevel;

		// Output schema priority: agent frontmatter > inherited parent session.
		// The task call itself never carries a schema; workflows needing ad-hoc
		// structured output go through eval agent(prompt, schema).
		const effectiveOutputSchema = effectiveAgent.output ?? this.session.outputSchema;

		let repoRoot: string | null = null;
		let baseline: WorktreeBaseline | null = null;
		if (isIsolated) {
			try {
				repoRoot = await getRepoRoot(this.session.cwd);
				baseline = await captureBaseline(repoRoot);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Isolated task execution requires a git repository. ${message}` }],
					details: { projectAgentsDir, results: [], totalDurationMs: Date.now() - startTime },
				};
			}
		}

		const preferredIsolationBackend = parseIsolationMode(isolationMode);

		// Derive artifacts directory
		const sessionFile = this.session.getSessionFile();
		const artifactsDir = sessionFile ? sessionFile.slice(0, -6) : null;
		const tempArtifactsDir = artifactsDir ? null : path.join(os.tmpdir(), `omp-task-${Snowflake.next()}`);
		const effectiveArtifactsDir = artifactsDir || tempArtifactsDir!;

		const localProtocolOptions: LocalProtocolOptions = this.session.localProtocolOptions ?? {
			getArtifactsDir: this.session.getArtifactsDir ?? (() => null),
			getSessionId: this.session.getSessionId ?? (() => null),
		};

		// Subagents adopt the parent's ArtifactManager so artifact IDs are unique
		// across the whole tree and outputs land flat in the parent's dir.
		const parentArtifactManager = this.session.getArtifactManager?.() ?? undefined;

		// When the session is executing an approved plan, hand the overall plan to
		// every subagent so they share the main agent's plan context. Skipped in
		// plan mode (read-only exploration uses planModeSubagentPrompt instead) and
		// when no plan file exists at the session's reference path.
		const planReference = planModeState?.enabled
			? undefined
			: await loadOverallPlanReference(
					this.session.getPlanReferencePath?.() ?? "local://PLAN.md",
					localProtocolOptions,
				);

		try {
			// Check self-recursion prevention
			if (this.#blockedAgent && agentName === this.#blockedAgent) {
				return {
					content: [
						{
							type: "text",
							text: `Cannot spawn ${this.#blockedAgent} agent from within itself (recursion prevention). Use a different agent type.`,
						},
					],
					details: { projectAgentsDir, results: [], totalDurationMs: Date.now() - startTime },
				};
			}

			// Check spawn restrictions from parent
			const parentSpawns = this.session.getSessionSpawns() ?? "*";
			const allowedSpawns = parentSpawns.split(",").map(s => s.trim());
			const isSpawnAllowed = (): boolean => {
				if (parentSpawns === "") return false; // Empty = deny all
				if (parentSpawns === "*") return true; // Wildcard = allow all
				return allowedSpawns.includes(agentName);
			};

			if (!isSpawnAllowed()) {
				const allowed = parentSpawns === "" ? "none (spawns disabled for this agent)" : parentSpawns;
				return {
					content: [{ type: "text", text: `Cannot spawn '${agentName}'. Allowed: ${allowed}` }],
					details: { projectAgentsDir, results: [], totalDurationMs: Date.now() - startTime },
				};
			}

			await fs.mkdir(effectiveArtifactsDir, { recursive: true });

			// Allocate a unique ID across the session to prevent artifact collisions
			let agentId: string;
			if (preAllocatedId) {
				agentId = preAllocatedId;
			} else {
				const outputManager =
					this.session.agentOutputManager ?? new AgentOutputManager(this.session.getArtifactsDir ?? (() => null));
				agentId = await outputManager.allocate(
					params.id?.trim() || generateTaskName(),
					candidate => AgentRegistry.global().get(candidate) !== undefined,
				);
			}
			if (this.session.sessionManager && routeReceipt) {
				appendSpawnRouteResolution(
					this.session.sessionManager,
					{
						agentId,
						agentSessionId: null,
						parentSessionId: this.session.getSessionId?.() ?? null,
						parentAgentId: this.session.getAgentId?.() ?? null,
						taskId: params.id?.trim() || null,
						packetId: null,
						branchId: null,
						turnId: toolCallId ?? null,
					},
					routeReceipt,
				);
			}

			const availableSkills = [...(this.session.skills ?? [])];
			// Resolve autoload skills from agent definition against available skills
			const resolvedAutoloadSkills =
				agent.autoloadSkills?.length && availableSkills.length > 0
					? agent.autoloadSkills
							.map(name => availableSkills.find(s => s.name === name))
							.filter((s): s is NonNullable<typeof s> => s !== undefined)
					: [];
			const contextFiles = this.session.contextFiles?.filter(
				file => path.basename(file.path).toLowerCase() !== "agents.md",
			);
			const promptTemplates = this.session.promptTemplates;
			const parentEvalSessionId = this.session.getEvalSessionId?.() ?? undefined;
			const mcpManager = this.session.mcpManager ?? MCPManager.instance();

			// Progress tracking for the single agent
			let latestProgress: AgentProgress = {
				index: spawnIndex,
				id: agentId,
				agent: agentName,
				routeReceipt,
				agentSource: agent.source,
				status: "pending",
				task: renderSubagentUserPrompt(assignment),
				assignment,
				spawnContext: sharedContext,
				definitionSourcePath: agent.filePath ?? `embedded:${agent.name}.md`,
				spawnerId: this.session.getAgentId?.() ?? MAIN_AGENT_ID,
				recentTools: [],
				recentOutput: [],
				toolCount: 0,
				requests: 0,
				tokens: 0,
				cost: 0,
				durationMs: 0,
				modelOverride,
				resolvedModel,
				description: params.description,
			};
			const emitProgress = () => {
				onUpdate?.({
					content: [{ type: "text", text: `Running agent ${agentId}...` }],
					details: {
						projectAgentsDir,
						results: [],
						totalDurationMs: Date.now() - startTime,
						progress: [latestProgress],
					},
				});
			};
			emitProgress();

			const buildCommitMessageFn = () =>
				commitStyle === "ai" && this.session.modelRegistry
					? async (diff: string) => {
							return generateCommitMessage(
								diff,
								this.session.modelRegistry!,
								this.session.settings,
								this.session.getSessionId?.() ?? undefined,
							);
						}
					: undefined;

			const maxRuntimeMsOverride =
				params.timeoutSec !== undefined ? Math.trunc(params.timeoutSec * 1000) : undefined;
			const isolateSetup = this.session.settings.get("task.isolateSetup") ?? this.session.hasUI;

			const sharedRunOptions = {
				cwd: this.session.cwd,
				routeReceipt,
				buildVersion: this.session.buildVersion ?? VERSION,
				buildDigest: this.session.buildDigest,
				agent: effectiveAgent,
				task: renderSubagentUserPrompt(assignment),
				assignment,
				context: sharedContext,
				planReference,
				description: params.description,
				role: params.role,
				index: spawnIndex,
				parentToolCallId: toolCallId,
				detached,
				id: agentId,
				taskDepth,
				modelOverride,
				parentActiveModelPattern,
				thinkingLevel: thinkingLevelOverride,
				outputSchema: effectiveOutputSchema,
				quotaAdmission,
				sessionFile,
				parentSessionFile: sessionFile,
				parentSessionId: this.session.getSessionId?.() ?? undefined,
				parentAgentId: this.session.getAgentId?.() ?? undefined,
				acquireResourceLease: this.#resourceLeaseAcquirer,
				parentWorkstream: this.session.sessionManager?.getWorkstream(),
				persistArtifacts: !!artifactsDir,
				artifactsDir: effectiveArtifactsDir,
				enableLsp: subagentLspEnabled,
				signal,
				eventBus: this.session.eventBus,
				onProgress: (progress: AgentProgress) => {
					// Shallow snapshot; recentTools is mutated in place by the
					// executor, the rest is reassigned or immutable. A deep clone
					// here cost O(extractedToolData) per progress event.
					latestProgress = { ...progress, recentTools: progress.recentTools.slice() };
					emitProgress();
				},
				authStorage: this.session.authStorage,
				modelRegistry: this.session.modelRegistry,
				settings: this.session.settings,
				mcpManager,
				contextFiles,
				skills: availableSkills,
				autoloadSkills: resolvedAutoloadSkills,
				workspaceTree: this.session.workspaceTree,
				promptTemplates,
				rules: this.session.rules,
				preloadedExtensionPaths: this.session.extensionPaths,
				preloadedCustomToolPaths: this.session.customToolPaths,
				localProtocolOptions,
				parentArtifactManager,
				parentHindsightSessionState: this.session.getHindsightSessionState?.(),
				parentMnemopiSessionState: this.session.getMnemopiSessionState?.(),
				parentTelemetry: this.session.getTelemetry?.(),
				parentEvalSessionId,
				maxRuntimeMs: maxRuntimeMsOverride,
				asyncJobManager: preAllocatedId ? this.session.asyncJobManager : undefined,
				asyncJobId: preAllocatedId,
			};

			const executeChild = (options: ExecutorOptions): Promise<SingleResult> =>
				isolateSetup ? runSubagentSpawnProcess(options, this.session.settings) : runSubprocess(options);

			const runTask = async (): Promise<SingleResult> => {
				if (!isIsolated) {
					return executeChild(sharedRunOptions);
				}

				const taskStart = Date.now();
				let isolationHandle: IsolationHandle | undefined;
				try {
					if (!repoRoot || !baseline) {
						throw new Error("Isolated task execution not initialized.");
					}
					const taskBaseline = structuredClone(baseline);

					isolationHandle = await ensureIsolation(repoRoot, agentId, preferredIsolationBackend);
					const isolationDir = isolationHandle.mergedDir;

					// Isolated runs re-discover extensions/custom tools inside the
					// worktree instead of reusing the parent's source paths.
					const result = await executeChild({
						...sharedRunOptions,
						worktree: isolationDir,
						preloadedExtensionPaths: undefined,
						preloadedCustomToolPaths: undefined,
					});
					if (mergeMode === "branch" && result.exitCode === 0) {
						try {
							const commitResult = await commitToBranch(
								isolationDir,
								taskBaseline,
								agentId,
								params.description,
								buildCommitMessageFn(),
							);
							return {
								...result,
								branchName: commitResult?.branchName,
								nestedPatches: commitResult?.nestedPatches,
							};
						} catch (mergeErr) {
							// Agent succeeded but branch commit failed — clean up stale branch
							const branchName = `omp/task/${agentId}`;
							await git.branch.tryDelete(repoRoot, branchName);
							const msg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
							return { ...result, error: `Merge failed: ${msg}` };
						}
					}
					if (result.exitCode === 0) {
						try {
							const delta = await captureDeltaPatch(isolationDir, taskBaseline);
							const patchPath = path.join(effectiveArtifactsDir, `${agentId}.patch`);
							await Bun.write(patchPath, delta.rootPatch);
							return {
								...result,
								patchPath,
								nestedPatches: delta.nestedPatches,
							};
						} catch (patchErr) {
							const msg = patchErr instanceof Error ? patchErr.message : String(patchErr);
							return { ...result, error: `Patch capture failed: ${msg}` };
						}
					}
					return result;
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					return {
						index: spawnIndex,
						id: agentId,
						agent: agent.name,
						agentSource: agent.source,
						task: renderSubagentUserPrompt(assignment),
						assignment,
						description: params.description,
						exitCode: 1,
						output: "",
						stderr: message,
						truncated: false,
						durationMs: Date.now() - taskStart,
						tokens: 0,
						requests: 0,
						modelOverride,
						error: message,
					};
				} finally {
					if (isolationHandle) {
						await cleanupIsolation(isolationHandle);
					}
				}
			};

			const result = await runTask();

			let mergeSummary = "";
			let changesApplied: boolean | null = null;
			let hadAnyChanges = false;
			let mergedBranchForNestedPatches = false;
			if (isIsolated && repoRoot) {
				try {
					if (mergeMode === "branch") {
						if (!result.branchName || result.exitCode !== 0 || result.aborted) {
							changesApplied = true;
							mergeSummary = "\n\nNo changes to apply.";
						} else {
							const mergeResult = await mergeTaskBranches(repoRoot, [
								{ branchName: result.branchName, taskId: result.id, description: result.description },
							]);
							mergedBranchForNestedPatches = mergeResult.merged.includes(result.branchName);
							changesApplied = mergeResult.failed.length === 0;
							hadAnyChanges = changesApplied && mergeResult.merged.length > 0;

							if (changesApplied) {
								mergeSummary = hadAnyChanges
									? `\n\nMerged branch: ${result.branchName}`
									: "\n\nNo changes to apply.";
							} else {
								const conflictPart = mergeResult.conflict ? `\nConflict: ${mergeResult.conflict}` : "";
								mergeSummary = `\n\n<system-notification>Branch merge failed: ${result.branchName}.${conflictPart}\nThe unmerged branch remains for manual resolution.</system-notification>`;
							}
							if (mergeResult.stashConflict) {
								mergeSummary += `\n\n<system-notification>${mergeResult.stashConflict}</system-notification>`;
							}

							// Clean up the merged branch (keep failed ones for manual resolution)
							if (changesApplied) {
								await cleanupTaskBranches(repoRoot, [result.branchName]);
							}
						}
					} else {
						// Patch mode: apply the patch from a successful run. A failed or
						// aborted run has nothing to apply and must not block the result.
						const succeeded = result.exitCode === 0 && !result.error && !result.aborted;
						if (!succeeded) {
							changesApplied = true;
							hadAnyChanges = false;
						} else if (!result.patchPath) {
							changesApplied = false;
							hadAnyChanges = false;
						} else {
							const patchText = await Bun.file(result.patchPath).text();
							if (!patchText.trim()) {
								changesApplied = true;
								hadAnyChanges = false;
							} else {
								const normalized = patchText.endsWith("\n") ? patchText : `${patchText}\n`;
								changesApplied = await git.patch.canApplyText(repoRoot, normalized);
								if (changesApplied) {
									try {
										await git.patch.applyText(repoRoot, normalized);
										hadAnyChanges = true;
									} catch {
										changesApplied = false;
										hadAnyChanges = false;
									}
								}
							}
						}

						if (changesApplied) {
							mergeSummary = hadAnyChanges ? "\n\nApplied patches: yes" : "\n\nNo changes to apply.";
						} else {
							const notification =
								"<system-notification>Patches were not applied and must be handled manually.</system-notification>";
							const patchList = result.patchPath ? `\n\nPatch artifact:\n- ${result.patchPath}` : "";
							mergeSummary = `\n\n${notification}${patchList}`;
						}
					}
				} catch (mergeErr) {
					const msg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
					changesApplied = false;
					hadAnyChanges = false;
					mergeSummary = `\n\n<system-notification>Merge phase failed: ${msg}\nTask outputs are preserved but changes were not applied.</system-notification>`;
				}
			}

			// Apply nested repo patches (separate from parent git)
			if (isIsolated && repoRoot && (mergeMode === "branch" || changesApplied !== false)) {
				const nestedPatches = result.nestedPatches ?? [];
				const eligible =
					nestedPatches.length > 0 &&
					result.exitCode === 0 &&
					!result.aborted &&
					(mergeMode !== "branch" || mergedBranchForNestedPatches);
				if (eligible) {
					try {
						await applyNestedPatches(repoRoot, nestedPatches, buildCommitMessageFn());
					} catch {
						// Nested patch failures are non-fatal to the parent merge
						mergeSummary +=
							"\n\n<system-notification>Some nested repository patches failed to apply.</system-notification>";
					}
				}
			}

			// Cleanup temp directory if used
			const shouldCleanupTempArtifacts =
				tempArtifactsDir && (!isIsolated || changesApplied === true || changesApplied === null);
			if (shouldCleanupTempArtifacts) {
				await fs.rm(tempArtifactsDir, { recursive: true, force: true });
			}

			return this.#buildResultPayload(result, projectAgentsDir, Date.now() - startTime, mergeSummary);
		} catch (err) {
			return {
				content: [{ type: "text", text: `Task execution failed: ${err}` }],
				details: { projectAgentsDir, results: [], totalDurationMs: Date.now() - startTime },
			};
		}
	}

	/** Build the tool result (summary text + details) for a settled run. */
	#buildResultPayload(
		result: SingleResult,
		projectAgentsDir: string | null,
		totalDurationMs: number,
		mergeSummary: string,
	): AgentToolResult<TaskToolDetails> {
		const status = result.aborted
			? "cancelled"
			: result.exitCode === 0 && result.error
				? "merge failed"
				: result.exitCode === 0
					? "completed"
					: `failed (exit ${result.exitCode})`;
		const output = formatResultOutputFallback(result);
		const outputCharCount = result.outputMeta?.charCount ?? output.length;
		const fullOutputThreshold = 5000;
		let preview = output;
		let truncated = false;
		if (outputCharCount > fullOutputThreshold) {
			const slice = output.slice(0, fullOutputThreshold);
			const lastNewline = slice.lastIndexOf("\n");
			preview = lastNewline >= 0 ? slice.slice(0, lastNewline) : slice;
			truncated = true;
		}
		const summary = prompt.render(taskSummaryTemplate, {
			agentName: result.agent,
			id: result.id,
			status,
			duration: formatDuration(totalDurationMs),
			preview,
			truncated,
			meta: result.outputMeta
				? {
						lineCount: result.outputMeta.lineCount,
						charSize: formatBytes(result.outputMeta.charCount),
					}
				: undefined,
			mergeSummary,
		});

		return {
			content: [{ type: "text", text: summary }],
			details: {
				projectAgentsDir,
				results: [result],
				totalDurationMs,
				usage: result.usage,
				outputPaths: result.outputPath ? [result.outputPath] : undefined,
			},
		};
	}
}
