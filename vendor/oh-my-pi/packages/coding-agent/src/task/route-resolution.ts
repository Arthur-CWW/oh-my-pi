import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import { resolveConfiguredModelPatterns, resolveModelOverride, type ModelLookupRegistry } from "../config/model-resolver";
import { MODEL_ROLE_IDS } from "../config/model-roles";
import type { Settings } from "../config/settings";
import type { AgentQuotaAdmission } from "../registry/agent-registry";
import type { QuotaModel } from "./quota-admission";

/** Sources considered while selecting a route for a new spawn. */
export type SpawnRouteSource =
	| "spawn_explicit"
	| "session_explicit"
	| "session_temporary"
	| "agent_model_override"
	| "agent_frontmatter"
	| "session_inherited"
	| "global_default";

/** Sources which can appear after the initial spawn decision has been made. */
export type SubsequentSpawnRouteSource = SpawnRouteSource | "automatic_reroute" | "auth_fallback";

export interface SpawnRouteInput {
	readonly spawnExplicit?: string | readonly string[];
	readonly sessionExplicit?: string | readonly string[];
	readonly sessionTemporary?: string | readonly string[];
	readonly agentModelOverride?: string | readonly string[];
	readonly agentFrontmatter?: string | readonly string[];
	readonly sessionInherited?: string | readonly string[];
	readonly globalDefault?: string | readonly string[];
	readonly modelRegistry?: ModelLookupRegistry;
	readonly settings: Settings;
	readonly parentActiveSelector?: string;
	readonly originalRoute?: ResolvedRoute;
	readonly originalSource?: SubsequentSpawnRouteSource;
	readonly reason?: string;
}

export interface ConsultedRouteInput {
	readonly source: SpawnRouteSource;
	readonly explicit: boolean;
	readonly selectors: readonly string[];
	readonly patterns: readonly string[];
}

export interface ResolvedRoute {
	readonly selector: string;
	readonly provider: string;
	readonly model: string;
	readonly thinking: ThinkingLevel | undefined;
	readonly parentActiveSelector: string | undefined;
}

export interface SpawnRouteInvalidError {
	readonly kind: "invalid_spawn_route";
	readonly requested: readonly string[];
	readonly patterns: readonly string[];
}

export interface SpawnRouteQuotaBlock {
	readonly kind: "quota_admission_blocked";
	readonly selector: string;
	readonly reason: string | undefined;
	readonly resetAt: number | undefined;
}
export interface SpawnRouteAttempt {
	readonly source: SubsequentSpawnRouteSource;
	readonly route: ResolvedRoute;
	readonly reason: string | undefined;
	readonly quotaAdmission?: AgentQuotaAdmission;
}


export interface SpawnRouteDecision {
	readonly source: SubsequentSpawnRouteSource | undefined;
	readonly explicit: boolean;
	readonly selectedSelectors: readonly string[];
	readonly resolvedPatterns: readonly string[];
	readonly route: ResolvedRoute | undefined;
	readonly parentActiveSelector: string | undefined;
	readonly consulted: readonly ConsultedRouteInput[];
	readonly overridden: readonly ConsultedRouteInput[];
	readonly originalRoute?: ResolvedRoute;
	readonly originalSource?: SubsequentSpawnRouteSource;
	readonly reason?: string;
	readonly invalid: SpawnRouteInvalidError | undefined;
	readonly quotaAdmission?: AgentQuotaAdmission;
	readonly block?: SpawnRouteQuotaBlock;
	readonly priorAttempts?: readonly SpawnRouteAttempt[];
}

export interface SpawnRouteReceipt {
	readonly source: SubsequentSpawnRouteSource;
	readonly route: ResolvedRoute;
	readonly originalSource?: SubsequentSpawnRouteSource;
	readonly originalRoute?: ResolvedRoute;
	readonly reason?: string;
	readonly consulted: readonly ConsultedRouteInput[];
	readonly overridden: readonly ConsultedRouteInput[];
	readonly resolvedPatterns: readonly string[];
	readonly quotaAdmission?: AgentQuotaAdmission;
	readonly priorAttempts?: readonly SpawnRouteAttempt[];
}

type RouteTier = {
	readonly source: SpawnRouteSource;
	readonly explicit: boolean;
	readonly selectors: string | readonly string[] | undefined;
};

function immutable<T>(values: readonly T[]): readonly T[] {
	return Object.freeze([...values]);
}

function compactSelectors(value: string | readonly string[] | undefined): readonly string[] {
	if (value === undefined) return immutable([]);
	const values = typeof value === "string" ? [value] : value;
	return immutable(values.map(selector => selector.trim()).filter(Boolean));
}

function patternsFor(tier: RouteTier, settings: Settings): readonly string[] {
	const selectors = compactSelectors(tier.selectors);
	if (selectors.length === 0) return immutable([]);
	const normalized: string[] =
		tier.source === "spawn_explicit"
			? selectors.map(selector => (MODEL_ROLE_IDS.includes(selector as (typeof MODEL_ROLE_IDS)[number]) ? `pi/${selector}` : selector))
			: Array.from(selectors);
	return immutable(resolveConfiguredModelPatterns(normalized, settings));
}

function consultedInput(tier: RouteTier, settings: Settings): ConsultedRouteInput | undefined {
	const selectors = compactSelectors(tier.selectors);
	if (selectors.length === 0) return undefined;
	return { source: tier.source, explicit: tier.explicit, selectors, patterns: patternsFor(tier, settings) };
}

function toRoute(
	model: Model<Api>,
	thinking: ThinkingLevel | undefined,
	explicitThinking: boolean,
	parentActiveSelector: string | undefined,
): ResolvedRoute {
	const selector = `${model.provider}/${model.id}`;
	return {
		selector: explicitThinking && thinking ? `${selector}:${thinking}` : selector,
		provider: model.provider,
		model: model.id,
		thinking,
		parentActiveSelector,
	};
}

/**
 * Resolve the initial spawn route without performing I/O or mutating session state.
 * Explicit spawn and session selectors are terminal: an unresolved value is an error.
 */
export function resolveSpawnRoute(inputs: SpawnRouteInput): SpawnRouteDecision {
	const tiers: readonly RouteTier[] = [
		{ source: "spawn_explicit", explicit: true, selectors: inputs.spawnExplicit },
		{ source: "session_explicit", explicit: true, selectors: inputs.sessionExplicit },
		{ source: "session_temporary", explicit: false, selectors: inputs.sessionTemporary },
		{ source: "agent_model_override", explicit: false, selectors: inputs.agentModelOverride },
		{ source: "agent_frontmatter", explicit: false, selectors: inputs.agentFrontmatter },
		{ source: "session_inherited", explicit: false, selectors: inputs.sessionInherited },
		{ source: "global_default", explicit: false, selectors: inputs.globalDefault ?? inputs.settings.getModelRole("default") },
	];
	const consulted: ConsultedRouteInput[] = [];

	for (let index = 0; index < tiers.length; index += 1) {
		const tier = tiers[index];
		const candidate = consultedInput(tier, inputs.settings);
		if (!candidate) continue;
		consulted.push(candidate);
		if (!inputs.modelRegistry) {
			return {
				source: tier.source,
				explicit: tier.explicit,
				selectedSelectors: candidate.selectors,
				resolvedPatterns: candidate.patterns,
				route: undefined,
				parentActiveSelector: inputs.parentActiveSelector,
				consulted: immutable(consulted),
				overridden: immutable([]),
				originalRoute: inputs.originalRoute,
				originalSource: inputs.originalSource,
				reason: inputs.reason,
				invalid: undefined,
			};
		}
		const resolved = resolveModelOverride([...candidate.patterns], inputs.modelRegistry, inputs.settings);
		if (resolved.model) {
			const overridden: ConsultedRouteInput[] = [];
			for (let lower = index + 1; lower < tiers.length; lower += 1) {
				const lowerCandidate = consultedInput(tiers[lower], inputs.settings);
				if (!lowerCandidate) continue;
				consulted.push(lowerCandidate);
				const lowerResolved = resolveModelOverride([...lowerCandidate.patterns], inputs.modelRegistry, inputs.settings);
				if (lowerResolved.model) overridden.push(lowerCandidate);
			}
			return {
				source: tier.source,
				explicit: tier.explicit,
				selectedSelectors: candidate.selectors,
				resolvedPatterns: candidate.patterns,
				route: toRoute(resolved.model, resolved.thinkingLevel, resolved.explicitThinkingLevel, inputs.parentActiveSelector),
				parentActiveSelector: inputs.parentActiveSelector,
				consulted: immutable(consulted),
				overridden: immutable(overridden),
				originalRoute: inputs.originalRoute,
				originalSource: inputs.originalSource,
				reason: inputs.reason,
				invalid: undefined,
			};
		}
		if (tier.explicit) {
			return {
				source: tier.source,
				explicit: true,
				selectedSelectors: candidate.selectors,
				resolvedPatterns: candidate.patterns,
				route: undefined,
				parentActiveSelector: inputs.parentActiveSelector,
				consulted: immutable(consulted),
				overridden: immutable([]),
				originalRoute: inputs.originalRoute,
				originalSource: inputs.originalSource,
				reason: inputs.reason,
				invalid: { kind: "invalid_spawn_route", requested: candidate.selectors, patterns: candidate.patterns },
			};
		}
	}

	return {
		source: undefined,
		explicit: false,
		selectedSelectors: immutable([]),
		resolvedPatterns: immutable([]),
		route: undefined,
		parentActiveSelector: inputs.parentActiveSelector,
		consulted: immutable(consulted),
		overridden: immutable([]),
		originalRoute: inputs.originalRoute,
		originalSource: inputs.originalSource,
		reason: inputs.reason,
		invalid: undefined,
	};
}

export function admitSpawnRoute(
	decision: SpawnRouteDecision,
	quotaAdmission: AgentQuotaAdmission,
): SpawnRouteDecision {
	return { ...decision, quotaAdmission };
}

export function blockSpawnRoute(
	decision: SpawnRouteDecision,
	block: SpawnRouteQuotaBlock,
): SpawnRouteDecision {
	return { ...decision, block };
}

export function rerouteSpawnRoute(
	decision: SpawnRouteDecision,
	routedModel: QuotaModel,
	quotaAdmission: AgentQuotaAdmission,
	reason: string | undefined,
): SpawnRouteDecision {
	return {
		...decision,
		source: "automatic_reroute",
		explicit: false,
		selectedSelectors: immutable([routedModel.selector]),
		resolvedPatterns: immutable([routedModel.selector]),
		route: {
			selector: routedModel.selector,
			provider: routedModel.providerId,
			model: routedModel.modelId,
			thinking: undefined,
			parentActiveSelector: decision.parentActiveSelector,
		},
		originalSource: decision.source,
		originalRoute: decision.route,
		reason,
		quotaAdmission,
		priorAttempts:
			decision.source && decision.route
				? immutable([
						...(decision.priorAttempts ?? []),
						{ source: decision.source, route: decision.route, reason, quotaAdmission },
					])
				: decision.priorAttempts,
		block: undefined,
		invalid: undefined,
	};
}

export function reconcileSpawnRouteAuthFallback(
	decision: SpawnRouteDecision,
	model: Model<Api>,
	thinking: ThinkingLevel | undefined,
	explicitThinking: boolean,
): SpawnRouteDecision {
	if (!decision.source || !decision.route || decision.invalid || decision.block || decision.explicit) {
		throw new Error("Cannot apply auth fallback to an explicit, blocked, or unresolved spawn route");
	}
	const route = toRoute(model, thinking, explicitThinking, decision.parentActiveSelector);
	const authReason = `auth fallback from ${decision.route.selector} to ${route.selector}`;
	const reason = authReason;
	return {
		...decision,
		source: "auth_fallback",
		selectedSelectors: immutable([route.selector]),
		resolvedPatterns: immutable([route.selector]),
		route,
		originalSource: decision.source,
		originalRoute: decision.route,
		reason,
		priorAttempts: immutable([
			...(decision.priorAttempts ?? []),
			{ source: decision.source, route: decision.route, reason: authReason },
		]),
		quotaAdmission: decision.quotaAdmission,
	};
}

export function toSpawnRouteReceipt(decision: SpawnRouteDecision): SpawnRouteReceipt {
	if (decision.invalid || decision.block || !decision.source || !decision.route) {
		throw new Error("Cannot create a route receipt for a blocked or unresolved spawn route");
	}
	return {
		source: decision.source,
		route: decision.route,
		originalSource: decision.originalSource,
		originalRoute: decision.originalRoute,
		reason: decision.reason,
		consulted: decision.consulted,
		overridden: decision.overridden,
		resolvedPatterns: decision.resolvedPatterns,
		quotaAdmission: decision.quotaAdmission,
		priorAttempts: decision.priorAttempts ?? immutable([]),
	};
}
