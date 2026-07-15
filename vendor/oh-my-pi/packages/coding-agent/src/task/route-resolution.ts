import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import { type ModelLookupRegistry, resolveModelOverride } from "../config/model-resolver";
import { MODEL_ROLE_IDS } from "../config/model-roles";
import { resolveConfiguredModelPatterns } from "../config/role-resolution";
import type { Settings } from "../config/settings";
import type { PolicySnapshot, PolicySourceLayer, ProviderPostureEntry } from "../policy/policy-projection";
import type { CoreRoutingKey } from "../policy/policy-records";
import type { AgentQuotaAdmission } from "../registry/agent-registry";
import type { QuotaModel } from "./quota-admission";

/** Sources considered while selecting a route for a new spawn. */
export type SpawnRouteSource =
	| "spawn_explicit"
	| "session_explicit"
	| "session_temporary"
	| "policy"
	| "agent_model_override"
	| "agent_frontmatter"
	| "session_inherited"
	| "global_default";

/** Sources which can appear after the initial spawn decision has been made. */
export type SubsequentSpawnRouteSource = SpawnRouteSource | "automatic_reroute" | "auth_fallback";

/** Compatibility status attached to a responsibility route. */
export type SpawnRouteAlias = "deprecated-alias";

export interface SpawnRouteInput {
	readonly spawnExplicit?: string | readonly string[];
	readonly sessionExplicit?: string | readonly string[];
	readonly sessionTemporary?: string | readonly string[];
	readonly agentModelOverride?: string | readonly string[];
	readonly agentFrontmatter?: string | readonly string[];
	readonly sessionInherited?: string | readonly string[];
	readonly globalDefault?: string | readonly string[];
	readonly policyKey?: CoreRoutingKey;
	readonly policySnapshot?: PolicySnapshot;
	readonly modelRegistry?: ModelLookupRegistry;
	readonly settings: Settings;
	readonly parentActiveSelector?: string;
	readonly originalRoute?: ResolvedRoute;
	readonly originalSource?: SubsequentSpawnRouteSource;
	readonly reason?: string;
	readonly responsibility?: string;
	readonly alias?: SpawnRouteAlias;
}

export interface ConsultedPolicyRoute {
	readonly key: CoreRoutingKey;
	readonly sourceLayer: PolicySourceLayer;
	readonly transactionId?: string;
	readonly sequence: number;
	readonly snapshotAt: string;
}

export interface ConsultedRouteInput {
	readonly source: SpawnRouteSource;
	readonly explicit: boolean;
	readonly selectors: readonly string[];
	readonly patterns: readonly string[];
	readonly policy?: ConsultedPolicyRoute;
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

export interface SpawnRouteProviderDenyConstraint {
	readonly denyKind: "provider" | "model";
	readonly key: "core.providers.deny.providers" | "core.providers.deny.models";
	readonly provider: string;
	readonly model?: string;
	readonly transactionId: string;
	readonly sequence: number;
	readonly effectiveFrom: string;
	readonly expiresAt?: string;
	readonly remainingMs?: number;
	readonly sourceLayer: PolicySourceLayer;
	readonly snapshotAt: string;
}

export interface SpawnRoutePolicyExclusion extends Omit<SpawnRouteProviderDenyConstraint, "model"> {
	readonly model: string;
	readonly selector: string;
	readonly source: SubsequentSpawnRouteSource;
	readonly reason: string;
}

export interface SpawnRoutePolicyBlock {
	readonly kind: "provider_policy_denied";
	readonly requested: readonly string[];
	readonly patterns: readonly string[];
	readonly exclusions: readonly SpawnRoutePolicyExclusion[];
}

export type SpawnRouteBlock = SpawnRouteQuotaBlock | SpawnRoutePolicyBlock;

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
	readonly block?: SpawnRouteBlock;
	readonly priorAttempts?: readonly SpawnRouteAttempt[];
	readonly responsibility?: string;
	readonly alias?: SpawnRouteAlias;
	/** Immutable deny rules derived from the policy snapshot used for this decision. */
	readonly providerDenyConstraints?: readonly SpawnRouteProviderDenyConstraint[];
	/** Denied concrete candidates skipped while resolving or reconciling this route. */
	readonly excludedPolicyCandidates?: readonly SpawnRoutePolicyExclusion[];
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
	/** Denied concrete candidates skipped before the selected route won. */
	readonly excludedPolicyCandidates?: readonly SpawnRoutePolicyExclusion[];
	/** Responsibility template which selected this lane. */
	readonly responsibility?: string;
	/** Compatibility status when the requested template was an alias. */
	readonly alias?: SpawnRouteAlias;
	/** Provenance source which won the lane decision. */
	readonly resolutionSource: SubsequentSpawnRouteSource;
	/** Final concrete lane after quota/auth reconciliation. */
	readonly resolvedLane: string;
}

type RouteTier = {
	readonly source: SpawnRouteSource;
	readonly explicit: boolean;
	readonly selectors: string | readonly string[] | undefined;
	readonly policy?: ConsultedPolicyRoute;
};

function immutable<T>(values: readonly T[]): readonly T[] {
	return Object.freeze([...values]);
}

function activeProviderPostureEntry(
	snapshot: PolicySnapshot,
	key: SpawnRouteProviderDenyConstraint["key"],
): ProviderPostureEntry | undefined {
	return snapshot.providerPosture?.entries.find(
		entry => entry.key === key && entry.state === "active" && entry.effective,
	);
}

function constraintFromEntry(
	entry: ProviderPostureEntry,
	snapshotAt: string,
	denyKind: SpawnRouteProviderDenyConstraint["denyKind"],
	provider: string,
	model?: string,
): SpawnRouteProviderDenyConstraint {
	return Object.freeze({
		denyKind,
		key: entry.key as SpawnRouteProviderDenyConstraint["key"],
		provider,
		...(model === undefined ? {} : { model }),
		transactionId: entry.transactionId,
		sequence: entry.sequence,
		effectiveFrom: entry.effectiveFrom,
		...(entry.expiresAt === undefined ? {} : { expiresAt: entry.expiresAt }),
		...(entry.remainingMs === undefined ? {} : { remainingMs: entry.remainingMs }),
		sourceLayer: entry.sourceLayer,
		snapshotAt,
	});
}

function providerDenyConstraints(snapshot: PolicySnapshot | undefined): readonly SpawnRouteProviderDenyConstraint[] {
	const posture = snapshot?.providerPosture;
	if (snapshot === undefined || posture === undefined) return immutable([]);
	const providerEntry = activeProviderPostureEntry(snapshot, "core.providers.deny.providers");
	const modelEntry = activeProviderPostureEntry(snapshot, "core.providers.deny.models");
	return immutable([
		...(providerEntry === undefined
			? []
			: posture.deniedProviderIds.map(provider =>
					constraintFromEntry(providerEntry, snapshot.at, "provider", provider),
				)),
		...(modelEntry === undefined
			? []
			: posture.deniedModels.map(({ provider, model }) =>
					constraintFromEntry(modelEntry, snapshot.at, "model", provider, model),
				)),
	]);
}

export function spawnRoutePolicyExclusions(
	decision: Pick<SpawnRouteDecision, "providerDenyConstraints">,
	source: SubsequentSpawnRouteSource,
	route: Pick<ResolvedRoute, "selector" | "provider" | "model">,
): readonly SpawnRoutePolicyExclusion[] {
	const exclusions = (decision.providerDenyConstraints ?? [])
		.filter(
			constraint =>
				constraint.provider === route.provider &&
				(constraint.denyKind === "provider" || constraint.model === route.model),
		)
		.map(constraint =>
			Object.freeze({
				...constraint,
				model: route.model,
				selector: route.selector,
				source,
				reason:
					constraint.denyKind === "provider"
						? `provider ${route.provider} denied by ${constraint.key}`
						: `model ${route.provider}/${route.model} denied by ${constraint.key}`,
			}),
		);
	return immutable(exclusions);
}

export function appendSpawnRoutePolicyExclusions(
	decision: SpawnRouteDecision,
	exclusions: readonly SpawnRoutePolicyExclusion[],
): SpawnRouteDecision {
	if (exclusions.length === 0) return decision;
	const merged = [...(decision.excludedPolicyCandidates ?? [])];
	for (const exclusion of exclusions) {
		if (
			merged.some(
				current =>
					current.source === exclusion.source &&
					current.selector === exclusion.selector &&
					current.key === exclusion.key &&
					current.transactionId === exclusion.transactionId,
			)
		)
			continue;
		merged.push(exclusion);
	}
	return { ...decision, excludedPolicyCandidates: immutable(merged) };
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
			? selectors.map(selector =>
					MODEL_ROLE_IDS.includes(selector as (typeof MODEL_ROLE_IDS)[number]) ? `pi/${selector}` : selector,
				)
			: Array.from(selectors);
	return immutable(resolveConfiguredModelPatterns(normalized, settings));
}

function consultedInput(tier: RouteTier, settings: Settings): ConsultedRouteInput | undefined {
	const selectors = compactSelectors(tier.selectors);
	if (selectors.length === 0) return undefined;
	return {
		source: tier.source,
		explicit: tier.explicit,
		selectors,
		patterns: patternsFor(tier, settings),
		...(tier.policy === undefined ? {} : { policy: tier.policy }),
	};
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

function registryWithAvailable(
	modelRegistry: ModelLookupRegistry,
	available: readonly Model<Api>[],
): ModelLookupRegistry {
	return {
		getAvailable: () => [...available],
		...(modelRegistry.resolveCanonicalModel === undefined
			? {}
			: { resolveCanonicalModel: modelRegistry.resolveCanonicalModel.bind(modelRegistry) }),
		...(modelRegistry.getCanonicalVariants === undefined
			? {}
			: { getCanonicalVariants: modelRegistry.getCanonicalVariants.bind(modelRegistry) }),
		...(modelRegistry.getCanonicalId === undefined
			? {}
			: { getCanonicalId: modelRegistry.getCanonicalId.bind(modelRegistry) }),
	};
}

function resolveEligibleRoute(
	patterns: readonly string[],
	source: SubsequentSpawnRouteSource,
	modelRegistry: ModelLookupRegistry,
	settings: Settings,
	parentActiveSelector: string | undefined,
	constraints: readonly SpawnRouteProviderDenyConstraint[],
): { readonly route?: ResolvedRoute; readonly exclusions: readonly SpawnRoutePolicyExclusion[] } {
	const exclusions: SpawnRoutePolicyExclusion[] = [];
	for (const pattern of patterns) {
		let available = modelRegistry.getAvailable();
		const seenDenied = new Set<string>();
		while (available.length > 0) {
			const resolved = resolveModelOverride([pattern], registryWithAvailable(modelRegistry, available), settings);
			if (!resolved.model) break;
			const route = toRoute(
				resolved.model,
				resolved.thinkingLevel,
				resolved.explicitThinkingLevel,
				parentActiveSelector,
			);
			const denied = spawnRoutePolicyExclusions({ providerDenyConstraints: constraints }, source, route);
			if (denied.length === 0) return { route, exclusions: immutable(exclusions) };
			if (seenDenied.has(route.selector)) break;
			seenDenied.add(route.selector);
			exclusions.push(...denied);
			available = available.filter(model => model.provider !== route.provider || model.id !== route.model);
		}
	}
	return { exclusions: immutable(exclusions) };
}

function providerPolicyBlock(
	candidate: ConsultedRouteInput,
	exclusions: readonly SpawnRoutePolicyExclusion[],
): SpawnRoutePolicyBlock {
	return {
		kind: "provider_policy_denied",
		requested: candidate.selectors,
		patterns: candidate.patterns,
		exclusions,
	};
}

/**
 * Resolve the initial spawn route without performing I/O or mutating session state.
 * Explicit spawn and session selectors are terminal: an unresolved value is an error.
 */
export function resolveSpawnRoute(inputs: SpawnRouteInput): SpawnRouteDecision {
	const effectivePolicy = inputs.policyKey === undefined ? undefined : inputs.policySnapshot?.values[inputs.policyKey];
	const policy: ConsultedPolicyRoute | undefined =
		inputs.policyKey === undefined || inputs.policySnapshot === undefined || effectivePolicy === undefined
			? undefined
			: {
					key: inputs.policyKey,
					sourceLayer: effectivePolicy.sourceLayer,
					...(effectivePolicy.transactionId === undefined ? {} : { transactionId: effectivePolicy.transactionId }),
					sequence: effectivePolicy.sequence,
					snapshotAt: inputs.policySnapshot.at,
				};
	const tiers: readonly RouteTier[] = [
		{ source: "spawn_explicit", explicit: true, selectors: inputs.spawnExplicit },
		{ source: "session_explicit", explicit: true, selectors: inputs.sessionExplicit },
		{ source: "session_temporary", explicit: false, selectors: inputs.sessionTemporary },
		{ source: "policy", explicit: false, selectors: effectivePolicy?.value, policy },
		{ source: "agent_model_override", explicit: false, selectors: inputs.agentModelOverride },
		{ source: "agent_frontmatter", explicit: false, selectors: inputs.agentFrontmatter },
		{ source: "session_inherited", explicit: false, selectors: inputs.sessionInherited },
		{
			source: "global_default",
			explicit: false,
			selectors: inputs.globalDefault ?? inputs.settings.getModelRole("default"),
		},
	];
	const constraints = providerDenyConstraints(inputs.policySnapshot);
	const consulted: ConsultedRouteInput[] = [];
	const exclusions: SpawnRoutePolicyExclusion[] = [];

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
				responsibility: inputs.responsibility,
				alias: inputs.alias,
				providerDenyConstraints: constraints,
				excludedPolicyCandidates: immutable(exclusions),
				invalid: undefined,
			};
		}

		const resolution = resolveEligibleRoute(
			candidate.patterns,
			tier.source,
			inputs.modelRegistry,
			inputs.settings,
			inputs.parentActiveSelector,
			constraints,
		);
		exclusions.push(...resolution.exclusions);
		if (resolution.route) {
			const overridden: ConsultedRouteInput[] = [];
			for (let lower = index + 1; lower < tiers.length; lower += 1) {
				const lowerTier = tiers[lower];
				const lowerCandidate = consultedInput(lowerTier, inputs.settings);
				if (!lowerCandidate) continue;
				consulted.push(lowerCandidate);
				const lowerResolution = resolveEligibleRoute(
					lowerCandidate.patterns,
					lowerTier.source,
					inputs.modelRegistry,
					inputs.settings,
					inputs.parentActiveSelector,
					constraints,
				);
				exclusions.push(...lowerResolution.exclusions);
				if (lowerResolution.route) overridden.push(lowerCandidate);
			}
			return {
				source: tier.source,
				explicit: tier.explicit,
				selectedSelectors: candidate.selectors,
				resolvedPatterns: candidate.patterns,
				route: resolution.route,
				parentActiveSelector: inputs.parentActiveSelector,
				consulted: immutable(consulted),
				overridden: immutable(overridden),
				originalRoute: inputs.originalRoute,
				originalSource: inputs.originalSource,
				reason: inputs.reason,
				responsibility: inputs.responsibility,
				alias: inputs.alias,
				providerDenyConstraints: constraints,
				excludedPolicyCandidates: immutable(exclusions),
				invalid: undefined,
			};
		}

		const terminalResponsibility = tier.source === "agent_frontmatter" && inputs.responsibility;
		if (terminalResponsibility || tier.explicit) {
			const denied = resolution.exclusions.length > 0;
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
				responsibility: inputs.responsibility,
				alias: inputs.alias,
				providerDenyConstraints: constraints,
				excludedPolicyCandidates: immutable(exclusions),
				block: denied ? providerPolicyBlock(candidate, resolution.exclusions) : undefined,
				invalid: denied
					? undefined
					: { kind: "invalid_spawn_route", requested: candidate.selectors, patterns: candidate.patterns },
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
		responsibility: inputs.responsibility,
		alias: inputs.alias,
		providerDenyConstraints: constraints,
		excludedPolicyCandidates: immutable(exclusions),
		invalid: undefined,
	};
}

export function admitSpawnRoute(decision: SpawnRouteDecision, quotaAdmission: AgentQuotaAdmission): SpawnRouteDecision {
	return { ...decision, quotaAdmission };
}

export function blockSpawnRoute(decision: SpawnRouteDecision, block: SpawnRouteBlock): SpawnRouteDecision {
	return { ...decision, block };
}

export function rerouteSpawnRoute(
	decision: SpawnRouteDecision,
	routedModel: QuotaModel,
	quotaAdmission: AgentQuotaAdmission,
	reason: string | undefined,
): SpawnRouteDecision {
	const route: ResolvedRoute = {
		selector: routedModel.selector,
		provider: routedModel.providerId,
		model: routedModel.modelId,
		thinking: undefined,
		parentActiveSelector: decision.parentActiveSelector,
	};
	const exclusions = spawnRoutePolicyExclusions(decision, "automatic_reroute", route);
	if (exclusions.length > 0) {
		return {
			...appendSpawnRoutePolicyExclusions(decision, exclusions),
			quotaAdmission,
			block: {
				kind: "provider_policy_denied",
				requested: immutable([routedModel.selector]),
				patterns: immutable([routedModel.selector]),
				exclusions,
			},
		};
	}
	return {
		...decision,
		source: "automatic_reroute",
		explicit: false,
		selectedSelectors: immutable([routedModel.selector]),
		resolvedPatterns: immutable([routedModel.selector]),
		route,
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
	const exclusions = spawnRoutePolicyExclusions(decision, "auth_fallback", route);
	if (exclusions.length > 0) return appendSpawnRoutePolicyExclusions(decision, exclusions);
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
		excludedPolicyCandidates: decision.excludedPolicyCandidates ?? immutable([]),
		responsibility: decision.responsibility,
		alias: decision.alias,
		resolutionSource: decision.source,
		resolvedLane: decision.route.selector,
	};
}
