import { randomUUID } from "node:crypto";
import { logger } from "@oh-my-pi/pi-utils";
import { Effect } from "effect";
import type { ToolSession } from "..";
import { resolveModelOverrideWithAuthFallback, resolveModelRoleValue } from "../config/model-resolver";
import { PolicyJournal, type PolicyJournalOptions } from "../policy/policy-journal";
import type { PolicySnapshot } from "../policy/policy-projection";
import { type CoreRoutingKey, isCoreRoutingKey } from "../policy/policy-records";
import { makePolicyService } from "../policy/policy-service";
import type { AgentQuotaAdmission } from "../registry/agent-registry";
import {
	createQuotaAdmissionStateRecord,
	latestQuotaAdmissionState,
	QUOTA_ADMISSION_CUSTOM_TYPE,
	QuotaAdmissionController,
	type QuotaModel,
} from "./quota-admission";
import {
	appendSpawnRoutePolicyExclusions,
	admitSpawnRoute,
	blockSpawnRoute,
	reconcileSpawnRouteAuthFallback,
	rerouteSpawnRoute,
	spawnRoutePolicyExclusions,
	resolveSpawnRoute,
	type SpawnRouteDecision,
	type SpawnRoutePolicyExclusion,
} from "./route-resolution";
import type { AgentDefinition, TaskParams } from "./types";

export interface SpawnPolicyRoutingOptions {
	readonly directory?: string;
}

type SpawnPolicySession = Pick<ToolSession, "sessionManager">;

let configuredPolicyDirectory: string | undefined;

export function configureSpawnPolicyRouting(options: SpawnPolicyRoutingOptions = {}): void {
	configuredPolicyDirectory = options.directory;
}

function policyReader(options: PolicyJournalOptions): PolicyJournal {
	const acquiredAt = new Date().toISOString();
	return new PolicyJournal(options, {
		uid: process.getuid?.() ?? 0,
		pid: process.pid,
		epoch: randomUUID(),
		acquiredAt,
	});
}

function sessionWorkstream(session: SpawnPolicySession): string | undefined {
	const workstream = session.sessionManager?.getWorkstream();
	return workstream?.kind === "workstream" ? workstream.id : undefined;
}

export async function snapshotTaskSpawnPolicy(
	session: SpawnPolicySession,
	options: SpawnPolicyRoutingOptions = {},
): Promise<PolicySnapshot> {
	const directory = options.directory ?? configuredPolicyDirectory;
	if (directory === undefined) {
		return {
			at: new Date().toISOString(),
			values: {},
			transactions: [],
			expiredTransactionIds: [],
			futureTransactionIds: [],
		};
	}
	const journal = policyReader({ directory });
	const workstream = sessionWorkstream(session);
	return Effect.runPromise(
		makePolicyService(journal).snapshot({
			...(workstream === undefined ? {} : { workstream }),
		}),
	);
}

function policyKeyForSpawn(
	deprecatedTaskAlias: boolean,
	responsibility: string,
	modelSelectors: readonly string[] | undefined,
): CoreRoutingKey {
	if (deprecatedTaskAlias) return "core.routing.implementer";
	for (const selector of modelSelectors ?? []) {
		const role = selector.startsWith("pi/") ? selector.slice(3).split(":", 1)[0] : undefined;
		const key = role === undefined ? undefined : `core.routing.${role}`;
		if (key !== undefined && isCoreRoutingKey(key)) return key;
	}
	const responsibilityKey = `core.routing.${responsibility}`;
	return isCoreRoutingKey(responsibilityKey) ? responsibilityKey : "core.routing.default";
}

function formatResolvedModelSelector(
	model: { provider: string; id: string },
	thinkingLevel: string | undefined,
	explicitThinkingLevel: boolean,
): string {
	return explicitThinkingLevel && thinkingLevel
		? `${model.provider}/${model.id}:${thinkingLevel}`
		: `${model.provider}/${model.id}`;
}

export function formatModelChain(
	agentName: string,
	role: string | undefined,
	resolvedModel: string | undefined,
	source?: string,
): string | undefined {
	if (!resolvedModel) return undefined;
	const route = source ? ` [${source}]` : "";
	const roleLabel = role?.trim();
	return roleLabel
		? `${agentName} → "${roleLabel}" → ${resolvedModel}${route}`
		: `${agentName} → ${resolvedModel}${route}`;
}

export function formatAvailableModels(models: ReadonlyArray<{ provider: string; id: string }>): string {
	if (models.length === 0) return "none";
	const limit = 20;
	const listed = models.slice(0, limit).map(model => `${model.provider}/${model.id}`);
	return models.length > limit ? `${listed.join(", ")}, … (${models.length - limit} more)` : listed.join(", ");
}

export function formatInvalidModelOverrideError(args: {
	agentName: string;
	requested: string | string[];
	resolvedPatterns: string[];
	availableModels: ReadonlyArray<{ provider: string; id: string }>;
}): string {
	const requested = Array.isArray(args.requested) ? args.requested.join(", ") : args.requested;
	const resolved = args.resolvedPatterns.length > 0 ? args.resolvedPatterns.join(", ") : "none";
	return `Invalid model override for task agent "${args.agentName}": ${requested}. Resolved selector${args.resolvedPatterns.length === 1 ? "" : "s"}: ${resolved}; no available model matched. Valid model selectors include: ${formatAvailableModels(args.availableModels)}.`;
}

export function resolveTaskSpawnRoute(
	session: ToolSession,
	agentName: string,
	effectiveAgent: AgentDefinition,
	params: TaskParams,
	policySnapshot?: PolicySnapshot,
): SpawnRouteDecision {
	const deprecatedTaskAlias = agentName === "task";
	const responsibility = deprecatedTaskAlias ? "implementer" : agentName;
	const agentModelOverrides = session.settings.get("task.agentModelOverrides");
	const parentActiveSelector = session.getActiveModelString?.();
	const policyKey = policyKeyForSpawn(deprecatedTaskAlias, responsibility, effectiveAgent.model);
	return resolveSpawnRoute({
		spawnExplicit: params.model,
		sessionExplicit: session.getExplicitModelString?.(),
		sessionTemporary: session.getTemporaryModelString?.(),
		agentModelOverride: agentModelOverrides[agentName],
		agentFrontmatter: deprecatedTaskAlias ? "pi/task" : effectiveAgent.model,
		sessionInherited: parentActiveSelector,
		globalDefault: session.settings.getModelRole("default"),
		policyKey,
		policySnapshot,
		settings: session.settings,
		modelRegistry: session.modelRegistry,
		parentActiveSelector,
		responsibility,
		alias: deprecatedTaskAlias ? "deprecated-alias" : undefined,
	});
}

function quotaModel(decision: SpawnRouteDecision): QuotaModel | undefined {
	const route = decision.route;
	return route ? { providerId: route.provider, modelId: route.model, selector: route.selector } : undefined;
}

function quotaCandidates(
	session: ToolSession,
	decision: SpawnRouteDecision,
	primary: QuotaModel,
): { readonly candidates: QuotaModel[]; readonly exclusions: readonly SpawnRoutePolicyExclusion[] } {
	const modelRegistry = session.modelRegistry;
	if (!modelRegistry || decision.explicit) return { candidates: [], exclusions: [] };
	const available = modelRegistry.getAvailable();
	const candidates: QuotaModel[] = [];
	const exclusions: SpawnRoutePolicyExclusion[] = [];
	for (const pattern of decision.resolvedPatterns) {
		const resolved = resolveModelRoleValue(pattern, available, { settings: session.settings, modelRegistry });
		if (!resolved.model) continue;
		if (resolved.model.provider === primary.providerId && resolved.model.id === primary.modelId) continue;
		const selector = formatResolvedModelSelector(
			resolved.model,
			resolved.thinkingLevel,
			resolved.explicitThinkingLevel,
		);
		const denied = spawnRoutePolicyExclusions(decision, "automatic_reroute", {
			selector,
			provider: resolved.model.provider,
			model: resolved.model.id,
		});
		if (denied.length > 0) {
			exclusions.push(...denied);
			continue;
		}
		candidates.push({ providerId: resolved.model.provider, modelId: resolved.model.id, selector });
	}
	return { candidates, exclusions };
}

export async function applyQuotaAdmission(
	session: ToolSession,
	decision: SpawnRouteDecision,
	signal?: AbortSignal,
): Promise<SpawnRouteDecision> {
	const model = quotaModel(decision);
	if (!model || !session.authStorage) return decision;
	const state = session.sessionManager ? latestQuotaAdmissionState(session.sessionManager.getEntries()) : undefined;
	const controller = new QuotaAdmissionController(
		{
			enabled: session.settings.get("quotaAdmission.enabled"),
			reservePercent: session.settings.get("quotaAdmission.reservePercent"),
			emaAlpha: session.settings.get("quotaAdmission.emaAlpha"),
			hysteresisPercent: session.settings.get("quotaAdmission.hysteresisPercent"),
		},
		state,
	);
	const reports = await session.authStorage
		.fetchUsageReports({
			baseUrlResolver: provider => session.modelRegistry?.getProviderBaseUrl?.(provider),
			signal,
		})
		.catch(error => {
			logger.debug("task: quota admission usage fetch failed", { error: String(error) });
			return null;
		});
	if (reports?.length) controller.observeReports(reports);
	const constrained = quotaCandidates(session, decision, model);
	const constrainedDecision = appendSpawnRoutePolicyExclusions(decision, constrained.exclusions);
	const quotaDecision = controller.admit(model, constrained.candidates);
	session.sessionManager?.appendCustomEntry(
		QUOTA_ADMISSION_CUSTOM_TYPE,
		createQuotaAdmissionStateRecord(controller.state, quotaDecision.atMs),
	);
	const admission: AgentQuotaAdmission = {
		originalProvider: quotaDecision.model.providerId,
		reroutedProvider: quotaDecision.outcome === "reroute" ? quotaDecision.routedModel?.providerId : undefined,
		originalModel: quotaDecision.model.selector,
		reroutedModel: quotaDecision.outcome === "reroute" ? quotaDecision.routedModel?.selector : undefined,
		ratePerHour: quotaDecision.ratePerHour,
		projectedEmptyAt: quotaDecision.projectedEmptyAt,
		resetAt: quotaDecision.resetAt,
		deficitPerHour: quotaDecision.deficitPerHour,
		decisionReason: quotaDecision.reason,
		quotaPoolId: quotaDecision.poolId,
		limitWindowId: quotaDecision.windowId,
	};
	if (quotaDecision.outcome === "admit") return admitSpawnRoute(constrainedDecision, admission);
	if (quotaDecision.outcome === "block" || !quotaDecision.routedModel) {
		return blockSpawnRoute(constrainedDecision, {
			kind: "quota_admission_blocked",
			selector: model.selector,
			reason: quotaDecision.reason,
			resetAt: quotaDecision.resetAt,
		});
	}
	return rerouteSpawnRoute(constrainedDecision, quotaDecision.routedModel, admission, quotaDecision.reason);
}

export async function applyTaskAuthFallback(
	session: ToolSession,
	decision: SpawnRouteDecision,
): Promise<SpawnRouteDecision> {
	const modelRegistry = session.modelRegistry;
	if (decision.explicit || decision.invalid || decision.block || !decision.route || !modelRegistry) return decision;
	const resolution = await resolveModelOverrideWithAuthFallback(
		[...decision.resolvedPatterns],
		decision.parentActiveSelector,
		modelRegistry,
		session.settings,
	);
	if (!resolution.authFallbackUsed || !resolution.model) return decision;
	logger.warn("Task route lacks working credentials; reconciling route to parent session model", {
		requested: decision.route.selector,
		parentModel: decision.parentActiveSelector,
		resolvedProvider: resolution.model.provider,
		resolvedModel: resolution.model.id,
	});
	return reconcileSpawnRouteAuthFallback(
		decision,
		resolution.model,
		resolution.thinkingLevel,
		resolution.explicitThinkingLevel,
	);
}

export function formatTaskRouteError(
	session: ToolSession,
	agentName: string,
	decision: SpawnRouteDecision,
): string | undefined {
	if (decision.invalid) {
		return formatInvalidModelOverrideError({
			agentName,
			requested: [...decision.invalid.requested],
			resolvedPatterns: [...decision.invalid.patterns],
			availableModels: session.modelRegistry?.getAvailable() ?? [],
		});
	}
	if (decision.block?.kind === "provider_policy_denied") {
		const requested = decision.block.requested.join(", ");
		const reasons = decision.block.exclusions
			.map(
				exclusion =>
					`${exclusion.selector} (${exclusion.reason}; ${exclusion.sourceLayer} transaction ${exclusion.transactionId} sequence ${exclusion.sequence})`,
			)
			.join("; ");
		const subject = decision.explicit ? "explicit model pin" : "model route";
		return `Provider policy denied ${subject} for task agent "${agentName}": ${requested}. ${reasons}. Policy snapshot: ${decision.block.exclusions[0]?.snapshotAt ?? "unknown"}.`;
	}
	if (decision.block?.kind === "quota_admission_blocked") {
		const reason = decision.block.reason ? ` (${decision.block.reason})` : "";
		const reset = decision.block.resetAt ? ` Reset at ${new Date(decision.block.resetAt).toISOString()}.` : "";
		return `Quota admission blocked ${decision.block.selector}${reason}.${reset}`;
	}
	return undefined;
}
