import { type ModelLookupRegistry, formatModelString } from "../config/model-resolver";
import { describeModelRoleSource } from "../config/role-resolution";
import type { ModelRoleWinningLayer, Settings } from "../config/settings";
import type { PolicyCandidate, PolicySnapshot } from "../policy/policy-projection";
import { isCoreRoutingKey, type CoreRoutingKey } from "../policy/policy-records";
import { AgentRegistry, MAIN_AGENT_ID } from "../registry/agent-registry";
import type { AgentSession } from "../session/agent-session";
import type { SessionEntry } from "../session/session-entries";
import { replaceTabs, truncateToWidth } from "../tools/render-utils";
import { discoverAgents } from "./discovery";
import type { ConsultedRouteInput, SpawnRouteDecision, SpawnRouteReceipt, SpawnRouteSource } from "./route-resolution";
import { resolveSpawnRoute } from "./route-resolution";
import { snapshotTaskSpawnPolicy } from "./spawn-route";
import { type SpawnRecord, isSpawnRecord } from "./spawn-record";
import type { AgentDefinition } from "./types";

const MAX_OUTPUT_LINES = 24;
const MAX_OUTPUT_WIDTH = 160;

export interface RouteInspectionInput {
	readonly agentId: string;
	readonly responsibility: string;
	readonly definitionSourcePath: string;
	readonly decision: SpawnRouteDecision | SpawnRouteReceipt;
	readonly policySnapshot?: PolicySnapshot;
	readonly settings?: Settings;
	readonly binaryVersion: string;
	readonly receiptSource: string;
	readonly explicitOverride?: string;
	readonly preview?: boolean;
}

export interface RoutePreviewInput {
	readonly selectorOrRole: string;
	readonly agents: readonly AgentDefinition[];
	readonly settings: Settings;
	readonly modelRegistry: ModelLookupRegistry;
	readonly policySnapshot?: PolicySnapshot;
	readonly parentActiveSelector?: string;
}

export interface RoutePreviewResult {
	readonly responsibility: string;
	readonly definitionSourcePath: string;
	readonly explicitOverride?: string;
	readonly decision: SpawnRouteDecision;
}

type RouteDecisionLike = SpawnRouteDecision | SpawnRouteReceipt;

function isDecision(value: RouteDecisionLike): value is SpawnRouteDecision {
	return "invalid" in value;
}

function sanitizeLine(line: string): string {
	return truncateToWidth(
		replaceTabs(line)
			.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
			.replace(/\s+/g, " ")
			.trimEnd(),
		MAX_OUTPUT_WIDTH,
	);
}

function sourceRecord(candidate: ConsultedRouteInput, receiptSource: string): string {
	if (candidate.policy) {
		const transaction = candidate.policy.transactionId ? ` transaction=${candidate.policy.transactionId}` : "";
		return `policy key=${candidate.policy.key} layer=${candidate.policy.sourceLayer}${transaction} sequence=${candidate.policy.sequence} snapshot=${candidate.policy.snapshotAt}`;
	}
	return `${receiptSource} field=${candidate.source}`;
}

function roleFromSelector(selector: string): string | undefined {
	if (!selector.startsWith("pi/")) return undefined;
	const role = selector.slice(3).split(":", 1)[0]?.trim();
	return role || undefined;
}

function settingsLayerRecord(layer: ModelRoleWinningLayer): string {
	switch (layer) {
		case "runtime_override":
			return "runtime modelRoles override record";
		case "config_overlay":
			return "--config modelRoles overlay";
		case "project":
			return "project config modelRoles record";
		case "global":
			return "global config.yml modelRoles record";
		case "default":
			return "built-in modelRoles defaults";
	}
}

function appendSettingsLayers(lines: string[], candidate: ConsultedRouteInput, settings: Settings | undefined): void {
	if (!settings) return;
	const roles = [
		...new Set(candidate.selectors.map(roleFromSelector).filter((role): role is string => role !== undefined)),
	];
	for (const role of roles) {
		const resolution = settings.resolveModelRole(role);
		if (!resolution.effectiveSelector || !resolution.winningLayer) {
			lines.push(
				` role ${role}: built-in responsibility/priority fallback [source: ${describeModelRoleSource(settings, role)}]`,
			);
			continue;
		}
		lines.push(
			` role ${role}: winner ${resolution.winningLayer}=${resolution.effectiveSelector} [source: ${settingsLayerRecord(resolution.winningLayer)}]`,
		);
		for (const shadowed of resolution.shadowedCandidates) {
			lines.push(
				` role ${role}: shadowed ${shadowed.layer}=${shadowed.selector}; reason=lower settings precedence [source: ${settingsLayerRecord(shadowed.layer)}]`,
			);
		}
	}
}

function policyCandidateSource(candidate: PolicyCandidate): string {
	return candidate.transactionId
		? `policy transaction=${candidate.transactionId} sequence=${candidate.sequence}`
		: `policy ${candidate.sourceLayer} sequence=${candidate.sequence}`;
}

function appendPolicyLayers(
	lines: string[],
	snapshot: PolicySnapshot | undefined,
	key: CoreRoutingKey | undefined,
): void {
	if (!snapshot || !key) return;
	const effective = snapshot.values[key];
	if (!effective) return;
	const winnerSource = effective.transactionId
		? `policy transaction=${effective.transactionId} sequence=${effective.sequence}`
		: `policy ${effective.sourceLayer} sequence=${effective.sequence}`;
	lines.push(
		` policy ${key}: winner ${effective.sourceLayer}=${effective.value} [source: ${winnerSource}; snapshot=${snapshot.at}]`,
	);
	for (const shadowed of effective.shadowed) {
		const value = shadowed.operation === "set" ? shadowed.value : "unset";
		const reason = shadowed.operation === "clear" ? "clear does not supply a route" : "lower policy precedence";
		lines.push(
			` policy ${key}: shadowed ${shadowed.sourceLayer}=${value}; reason=${reason} [source: ${policyCandidateSource(shadowed)}]`,
		);
	}
}

function temporaryPostureLine(snapshot: PolicySnapshot | undefined, key: CoreRoutingKey | undefined): string {
	if (!snapshot || !key) return "temporary posture: none [source: no policy snapshot]";
	const effective = snapshot.values[key];
	const candidate =
		effective?.sourceLayer === "temporary-posture"
			? effective
			: effective?.shadowed.find(value => value.sourceLayer === "temporary-posture" && value.operation === "set");
	if (!candidate) return `temporary posture: none [source: policy snapshot=${snapshot.at}]`;
	const transactionId = candidate.transactionId;
	const transaction = transactionId
		? snapshot.transactions.find(record => record.transactionId === transactionId)
		: undefined;
	const state = effective?.sourceLayer === "temporary-posture" ? "active" : "shadowed";
	return `temporary posture: ${state} value=${candidate.value ?? "unset"} expires=${transaction?.expiresAt ?? "unknown"} [source: policy transaction=${transactionId ?? "inline"}]`;
}

function candidateKey(candidate: ConsultedRouteInput): string {
	return `${candidate.source}\u0000${candidate.selectors.join("\u0000")}`;
}

function policyKey(decision: RouteDecisionLike): CoreRoutingKey | undefined {
	for (const candidate of decision.consulted) {
		if (candidate.policy) return candidate.policy.key;
	}
	return undefined;
}

export function formatRouteInspection(input: RouteInspectionInput): string {
	const { decision } = input;
	const lines: string[] = [];
	const mode = input.preview ? "preview (no spawn, no writes)" : "current";
	lines.push(`Route ${input.agentId} — ${mode} [source: ${input.receiptSource}]`);
	lines.push(
		`responsibility: ${input.responsibility}${decision.alias ? ` alias=${decision.alias}` : ""} [source: definition ${input.definitionSourcePath}]`,
	);
	lines.push(
		`explicit override: ${input.explicitOverride ?? "none"} [source: ${input.explicitOverride ? input.receiptSource : "route inputs"}]`,
	);
	if (isDecision(decision) && decision.block) {
		if (decision.block.kind === "quota_admission_blocked") {
			lines.push(
				`selected: blocked selector=${decision.block.selector}; reason=${decision.block.reason ?? "quota admission"} reset=${decision.block.resetAt ?? "unknown"} [source: quota admission decision]`,
			);
		} else if (decision.block.kind === "routing_policy_enforcement") {
			lines.push(
				`selected: blocked selector=${decision.block.requestedSelector}; reason=${decision.block.reason} [source: policy transaction=${decision.block.transactionId ?? "unknown"} snapshot=${decision.block.snapshotAt}]`,
			);
		} else {
			lines.push(
				`selected: blocked selectors=${decision.block.requested.join(",")}; reason=provider policy denied [source: policy snapshot]`,
			);
		}
	} else if (decision.route) {
		lines.push(
			`selected: ${decision.route.selector} effort=${decision.route.thinking ?? "none"} account=${decision.quotaAdmission?.reroutedProvider ?? decision.route.provider} [source: ${input.receiptSource} resolution=${decision.source ?? "unresolved"}]`,
		);
	} else {
		const reason = isDecision(decision) && decision.invalid ? decision.invalid.kind : "unresolved";
		lines.push(`selected: none reason=${reason} [source: ${input.receiptSource}]`);
	}
	const overridden = new Set(decision.overridden.map(candidateKey));
	for (const [index, candidate] of decision.consulted.entries()) {
		const winner = candidate.source === decision.source || candidate.source === decision.originalSource;
		const reason = winner
			? candidate.source === decision.source
				? "winner"
				: "initial winner before fallback"
			: overridden.has(candidateKey(candidate))
				? "shadowed by higher precedence"
				: "candidate did not resolve";
		lines.push(
			`${index + 1}. ${candidate.source}: selectors=${candidate.selectors.join(",")} patterns=${candidate.patterns.join(",")} result=${reason} [source: ${sourceRecord(candidate, input.receiptSource)}]`,
		);
		appendSettingsLayers(lines, candidate, input.settings);
	}
	appendPolicyLayers(lines, input.policySnapshot, policyKey(decision));
	lines.push(temporaryPostureLine(input.policySnapshot, policyKey(decision)));
	if (decision.routeEnforcement) {
		lines.push(
			`route enforcement: ${decision.routeEnforcement.outcome} requested=${decision.routeEnforcement.requestedSelector} effective=${decision.routeEnforcement.effectiveSelector} expires=${decision.routeEnforcement.expiresAt ?? "none"}; reason=${decision.routeEnforcement.reason} [source: policy transaction=${decision.routeEnforcement.transactionId} sequence=${decision.routeEnforcement.sequence} snapshot=${decision.routeEnforcement.snapshotAt}]`,
		);
	}
	for (const [index, attempt] of (decision.priorAttempts ?? []).entries()) {
		lines.push(
			`fallback ${index + 1}: rejected ${attempt.route.selector}; reason=${attempt.reason ?? attempt.quotaAdmission?.decisionReason ?? "ineligible"} [source: ${attempt.quotaAdmission ? "quota admission receipt" : `${input.receiptSource} priorAttempts`}]`,
		);
	}
	for (const [index, exclusion] of (decision.excludedPolicyCandidates ?? []).entries()) {
		lines.push(
			`policy exclusion ${index + 1}: ${exclusion.selector}; reason=${exclusion.reason}; effective=${exclusion.effectiveFrom} expires=${exclusion.expiresAt ?? "none"} [source: policy key=${exclusion.key} transaction=${exclusion.transactionId} sequence=${exclusion.sequence} snapshot=${exclusion.snapshotAt}]`,
		);
	}
	if (isDecision(decision) && decision.block) {
		if (decision.block.kind === "quota_admission_blocked") {
			lines.push(
				`blocked: ${decision.block.selector}; reason=${decision.block.reason ?? "quota/ineligible"} [source: quota admission receipt]`,
			);
		} else if (decision.block.kind === "routing_policy_enforcement") {
			lines.push(
				`blocked: ${decision.block.requestedSelector}; reason=${decision.block.reason} [source: routing enforcement transaction=${decision.block.transactionId ?? "unknown"}]`,
			);
		} else {
			lines.push(
				`blocked: ${decision.block.requested.join(",")}; reason=provider policy denied [source: policy exclusion receipt]`,
			);
		}
	}
	if (decision.reason && !(decision.priorAttempts?.length ?? 0)) {
		lines.push(`decision reason: ${decision.reason} [source: ${input.receiptSource}]`);
	}
	lines.push(`binary: ${input.binaryVersion} [source: running build]`);

	const sanitized = lines.map(sanitizeLine);
	if (sanitized.length <= MAX_OUTPUT_LINES) return sanitized.join("\n");
	const visible = sanitized.slice(0, MAX_OUTPUT_LINES - 1);
	visible.push(`… ${sanitized.length - visible.length} more provenance lines omitted [source: bounded :route output]`);
	return visible.join("\n");
}

function previewPolicyKey(
	deprecatedTaskAlias: boolean,
	responsibility: string,
	selectors: readonly string[],
): CoreRoutingKey {
	if (deprecatedTaskAlias) return "core.routing.implementer";
	for (const selector of selectors) {
		const role = roleFromSelector(selector);
		const key = role ? `core.routing.${role}` : undefined;
		if (key && isCoreRoutingKey(key)) return key;
	}
	const responsibilityKey = `core.routing.${responsibility}`;
	return isCoreRoutingKey(responsibilityKey) ? responsibilityKey : "core.routing.default";
}

export function previewSpawnRoute(input: RoutePreviewInput): RoutePreviewResult {
	const query = input.selectorOrRole.trim();
	if (!query) throw new Error("Usage: :route preview <selector-or-role>");
	const agent = input.agents.find(candidate => candidate.name === query);
	const deprecatedTaskAlias = agent?.name === "task";
	const responsibility = deprecatedTaskAlias ? "implementer" : (agent?.name ?? query);
	const definitionSourcePath = agent ? (agent.filePath ?? `embedded:${agent.name}.md`) : `command argument ${query}`;
	const selectors = agent?.model ?? [query];
	const decision = resolveSpawnRoute({
		...(agent ? { agentFrontmatter: deprecatedTaskAlias ? "pi/task" : agent.model } : { spawnExplicit: query }),
		sessionInherited: input.parentActiveSelector,
		globalDefault: input.settings.getModelRole("default"),
		policyKey: previewPolicyKey(Boolean(deprecatedTaskAlias), responsibility, selectors),
		policySnapshot: input.policySnapshot,
		settings: input.settings,
		modelRegistry: input.modelRegistry,
		parentActiveSelector: input.parentActiveSelector,
		responsibility,
		alias: deprecatedTaskAlias ? "deprecated-alias" : undefined,
	});
	return {
		responsibility,
		definitionSourcePath,
		...(agent ? {} : { explicitOverride: query }),
		decision,
	};
}

function spawnRecordFromEntries(entries: readonly SessionEntry[]): SpawnRecord | undefined {
	for (const entry of entries) {
		if (entry.type === "session_init" && isSpawnRecord(entry.subagent?.spawnRecord))
			return entry.subagent.spawnRecord;
	}
	return undefined;
}

async function spawnRecordForAgent(agentId: string): Promise<SpawnRecord | undefined> {
	const ref = AgentRegistry.global().get(agentId);
	const live = ref?.session ? spawnRecordFromEntries(ref.session.sessionManager.getEntries()) : undefined;
	if (live) return live;
	if (!ref?.sessionFile) return undefined;
	let text: string;
	try {
		text = await Bun.file(ref.sessionFile).text();
	} catch {
		return undefined;
	}
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line) as { type?: string; subagent?: { spawnRecord?: unknown } };
			if (entry.type === "session_init" && isSpawnRecord(entry.subagent?.spawnRecord))
				return entry.subagent.spawnRecord;
		} catch {
			continue;
		}
	}
	return undefined;
}

function latestExplicitModel(entries: readonly SessionEntry[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type === "model_change" && entry.command) return entry.model;
	}
	return undefined;
}

function mainDecision(session: AgentSession, snapshot: PolicySnapshot): SpawnRouteDecision {
	const active = session.model ? formatModelString(session.model) : undefined;
	const explicit = latestExplicitModel(session.sessionManager.getEntries());
	return resolveSpawnRoute({
		sessionExplicit: explicit,
		policyKey: "core.routing.default",
		policySnapshot: snapshot,
		sessionInherited: active,
		globalDefault: session.settings.getModelRole("default"),
		settings: session.settings,
		modelRegistry: session.modelRegistry,
		parentActiveSelector: active,
		responsibility: "default",
	});
}

export async function routeCommandOutput(options: {
	readonly mainSession: AgentSession;
	readonly focusedSession: AgentSession;
	readonly focusedAgentId?: string;
	readonly args: readonly string[];
	readonly binaryVersion: string;
}): Promise<string> {
	const [first, ...rest] = options.args;
	const snapshot = await snapshotTaskSpawnPolicy(options.focusedSession);
	if (first?.toLowerCase() === "preview") {
		const selectorOrRole = rest.join(" ").trim();
		if (!selectorOrRole) return "Usage: :route preview <selector-or-role>";
		const cwd = options.focusedSession.sessionManager.getCwd();
		const agents = (await discoverAgents(cwd)).agents;
		const parentActiveSelector = options.focusedSession.model
			? formatModelString(options.focusedSession.model)
			: undefined;
		const preview = previewSpawnRoute({
			selectorOrRole,
			agents,
			settings: options.focusedSession.settings,
			modelRegistry: options.focusedSession.modelRegistry,
			policySnapshot: snapshot,
			parentActiveSelector,
		});
		return formatRouteInspection({
			agentId: `preview:${selectorOrRole}`,
			responsibility: preview.responsibility,
			definitionSourcePath: preview.definitionSourcePath,
			decision: preview.decision,
			policySnapshot: snapshot,
			settings: options.focusedSession.settings,
			binaryVersion: options.binaryVersion,
			receiptSource: "dry-run resolveSpawnRoute result",
			explicitOverride: preview.explicitOverride,
			preview: true,
		});
	}
	if (rest.length > 0) return "Usage: :route [agentId] | :route preview <selector-or-role>";
	const agentId = first ?? options.focusedAgentId ?? MAIN_AGENT_ID;
	if (agentId === MAIN_AGENT_ID) {
		const decision = mainDecision(options.mainSession, snapshot);
		return formatRouteInspection({
			agentId: MAIN_AGENT_ID,
			responsibility: "default",
			definitionSourcePath: options.mainSession.sessionManager.getSessionFile() ?? "current session",
			decision,
			policySnapshot: snapshot,
			settings: options.mainSession.settings,
			binaryVersion: options.binaryVersion,
			receiptSource: "current session route record",
			explicitOverride: latestExplicitModel(options.mainSession.sessionManager.getEntries()),
		});
	}
	const record = await spawnRecordForAgent(agentId);
	if (!record?.route) return `No spawn route receipt for agent ${agentId}.`;
	return formatRouteInspection({
		agentId,
		responsibility: record.route.responsibility ?? record.agentType,
		definitionSourcePath: record.definitionSourcePath,
		decision: record.route,
		policySnapshot: snapshot,
		settings: options.focusedSession.settings,
		binaryVersion: options.binaryVersion,
		receiptSource: `spawn receipt ${record.agentId}`,
		explicitOverride:
			record.route.source === "spawn_explicit" ? record.route.consulted[0]?.selectors.join(",") : undefined,
	});
}
