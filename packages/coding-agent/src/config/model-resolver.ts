/**
 * Model resolution, scoping, and initial selection.
 *
 * Layering:
 * - `matchModel` is the single matching engine. Order: exact `provider/id`
 *   reference (with variant-alias and OpenRouter routed/date fallbacks) →
 *   exact canonical id → exact bare id → retired variant alias →
 *   provider-scoped fuzzy → substring with alias-vs-dated pick.
 * - `parseModelPatternWithContext`/`parseModelPattern` layer the selector
 *   grammar on top: trailing `:level` thinking suffixes (`splitThinkingSuffix`)
 *   and `@upstream` provider routing (`splitUpstreamRouting`).
 * - Everything else (`resolveModelFromString`, `resolveModelOverride*`,
 *   `resolveRoleSelection`, `resolveModelScope`, `resolveCliModel`,
 *   `findSmolModel`/`findSlowModel`) adapts inputs — roles, settings patterns,
 *   CLI flags, scope globs — onto that pipeline.
 */

import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Api, Effort, KnownProvider, Model, ModelSpec } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { modelMatchesHost } from "@oh-my-pi/pi-catalog/hosts";
import { buildModelProviderPriorityRank } from "@oh-my-pi/pi-catalog/identity";
import { stripThinkingVariantToken } from "@oh-my-pi/pi-catalog/identity/family";
import { clampThinkingLevelForModel } from "@oh-my-pi/pi-catalog/model-thinking";
import { modelsAreEqual } from "@oh-my-pi/pi-catalog/models";
import { DEFAULT_MODEL_PER_PROVIDER } from "@oh-my-pi/pi-catalog/provider-models";
import { resolveBareVariantAlias, resolveVariantAlias } from "@oh-my-pi/pi-catalog/variant-collapse";
import { fuzzyMatch } from "@oh-my-pi/pi-tui";
import { logger } from "@oh-my-pi/pi-utils";
import chalk from "chalk";
import MODEL_PRIO from "../priority.json" with { type: "json" };
import { clampAutoThinkingEffort, parseThinkingLevel, resolveThinkingLevelForModel } from "../thinking";
import { isAuthenticated, kNoAuth, type ModelRegistry } from "./model-registry";
import { MODEL_ROLE_IDS, type ModelRole } from "./model-roles";
import {
	DEFAULT_MODEL_ROLE,
	describeModelRoleSource,
	expandRoleAlias,
	formatUnknownModelRoleError,
	isKnownModelRole,
	parseExplicitModelRoleReference,
	resolveConfiguredModelPatterns,
	splitThinkingSuffix,
} from "./role-resolution";
import type { Settings } from "./settings";

/**
 * Pick the first available model matching a known provider's default id
 * (catalog table order), falling back to the first available model.
 */
function pickDefaultAvailableModel(availableModels: Model<Api>[]): Model<Api> | undefined {
	for (const provider of Object.keys(DEFAULT_MODEL_PER_PROVIDER) as KnownProvider[]) {
		const defaultId = DEFAULT_MODEL_PER_PROVIDER[provider];
		const match = availableModels.find(m => m.provider === provider && m.id === defaultId);
		if (match) return match;
	}
	return availableModels[0];
}

/** Match a glob pattern (only `*` wildcards) against a string, case-insensitive. */
function matchesGlobPattern(text: string, pattern: string): boolean {
	const lower = text.toLowerCase();
	const parts = pattern.toLowerCase().split("*");
	if (parts.length === 1) return lower === parts[0];
	let pos = 0;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part.length === 0) continue;
		const idx = lower.indexOf(part, pos);
		if (idx === -1) return false;
		if (i === 0 && idx !== 0) return false;
		pos = idx + part.length;
	}
	if (parts[parts.length - 1] !== "" && pos !== lower.length) return false;
	return true;
}

export function isBlockedSubagentModel(model: Model<Api>, settings?: Settings): boolean {
	const selector = `${model.provider}/${model.id}`.toLowerCase();
	// Hard built-in floor: fable is always blocked regardless of settings
	if (selector.includes("fable")) return true;
	// Config-driven patterns from task.orchestratorOnlyModels
	if (settings) {
		const patterns = settings.get("task.orchestratorOnlyModels");
		for (const pattern of patterns) {
			if (matchesGlobPattern(selector, pattern)) return true;
		}
	}
	return false;
}

export interface ScopedModel {
	model: Model<Api>;
	thinkingLevel?: ThinkingLevel;
	explicitThinkingLevel: boolean;
}


/**
 * Parse a model string in "provider/modelId" format.
 * Returns undefined if the format is invalid.
 */
export function parseModelString(
	modelStr: string,
): { provider: string; id: string; thinkingLevel?: ThinkingLevel } | undefined {
	const slashIdx = modelStr.indexOf("/");
	if (slashIdx <= 0) return undefined;
	const id = modelStr.slice(slashIdx + 1);
	const provider = modelStr.slice(0, slashIdx);
	// Strip valid thinking level suffix (e.g., "claude-sonnet-4-6:high" -> id "claude-sonnet-4-6", thinkingLevel "high")
	const { base, level } = splitThinkingSuffix(id);
	return level ? { provider, id: base, thinkingLevel: level } : { provider, id };
}

/**
 * Format a model as "provider/modelId" string.
 */
export function formatModelString(model: Model<Api>): string {
	return `${model.provider}/${model.id}`;
}

export function formatModelSelectorValue(selector: string, thinkingLevel: ThinkingLevel | undefined): string {
	return thinkingLevel && thinkingLevel !== ThinkingLevel.Inherit ? `${selector}:${thinkingLevel}` : selector;
}

function getOpenRouterRouteSuffix(modelId: string): { baseId: string; suffix: string } | undefined {
	const colonIdx = modelId.lastIndexOf(":");
	if (colonIdx === -1) {
		return undefined;
	}

	const suffix = modelId.slice(colonIdx + 1).trim();
	if (!suffix || parseThinkingLevel(suffix)) {
		return undefined;
	}

	return { baseId: modelId.slice(0, colonIdx), suffix };
}

function stripOpenRouterDateSuffix(modelId: string): string | undefined {
	const stripped = modelId.replace(/-\d{8}(?=$|:)/i, "");
	return stripped !== modelId ? stripped : undefined;
}

function getOpenRouterFallbackModelIds(modelId: string): string[] {
	const orderedCandidates: string[] = [];
	const queue = [modelId];
	const seen = new Set<string>();

	while (queue.length > 0) {
		const candidate = queue.shift();
		if (!candidate || seen.has(candidate)) {
			continue;
		}
		seen.add(candidate);
		orderedCandidates.push(candidate);

		const routedSuffix = getOpenRouterRouteSuffix(candidate);
		if (routedSuffix) {
			queue.push(routedSuffix.baseId);
		}

		const strippedDate = stripOpenRouterDateSuffix(candidate);
		if (strippedDate) {
			queue.push(strippedDate);
		}
	}

	return orderedCandidates;
}

function cloneModelWithRequestedId(model: Model<Api>, requestedId: string): Model<Api> {
	return {
		...model,
		id: requestedId,
		...(model.name === model.id ? { name: requestedId } : {}),
	};
}

const UPSTREAM_ROUTING_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

/**
 * Split a trailing `@<upstream>` provider-routing selector off a model pattern.
 *
 * `openrouter/z-ai/glm-4.7@cerebras` -> base `openrouter/z-ai/glm-4.7`, upstream
 * `cerebras`. A `:thinking` suffix after the slug is kept on the base
 * (`...@cerebras:high` -> base `...:high`). Returns undefined when there is no
 * `@` or the suffix is not a bare provider slug, so model ids that legitimately
 * contain `@` (`claude-opus-4-8@default`, `workers-ai/@cf/...`) are never split.
 */
function splitUpstreamRouting(pattern: string): { base: string; upstream: string } | undefined {
	const at = pattern.lastIndexOf("@");
	if (at <= 0) return undefined;
	const rest = pattern.slice(at + 1);
	const colon = rest.indexOf(":");
	const upstream = colon === -1 ? rest : rest.slice(0, colon);
	if (!UPSTREAM_ROUTING_SLUG.test(upstream)) return undefined;
	const trailing = colon === -1 ? "" : rest.slice(colon);
	return { base: pattern.slice(0, at) + trailing, upstream };
}

/** OpenRouter and Vercel AI Gateway are the aggregators that honor per-request upstream routing. */
function supportsUpstreamRouting(model: Model<Api>): boolean {
	return modelMatchesHost(model, "openrouter") || modelMatchesHost(model, "vercelAIGateway");
}

/** Pin a resolved aggregator model to a single upstream provider via its compat routing block. */
function applyUpstreamRouting(model: Model<Api>, upstream: string): Model<Api> {
	const aggregatorModel = model as Model<"openai-completions">;
	const routing = { only: [upstream] };
	return buildModel({
		...model,
		compat: modelMatchesHost(model, "vercelAIGateway")
			? { ...aggregatorModel.compatConfig, vercelGatewayRouting: routing }
			: { ...aggregatorModel.compatConfig, openRouterRouting: routing },
	} as ModelSpec<Api>);
}

const kProviderModelIndex = Symbol("model-resolver.providerIndex");
type ModelsWithProviderIndex = readonly Model<Api>[] & {
	[kProviderModelIndex]?: Map<string, Model<Api> | null>;
};

function getProviderModelIndex(availableModels: readonly Model<Api>[]): Map<string, Model<Api> | null> {
	const tagged = availableModels as ModelsWithProviderIndex;
	const cached = tagged[kProviderModelIndex];
	if (cached) return cached;
	const index = new Map<string, Model<Api> | null>();
	for (const m of availableModels) {
		const key = `${m.provider.toLowerCase()}\u0000${m.id.toLowerCase()}`;
		if (index.has(key)) {
			index.set(key, null); // ambiguous sentinel; do not overwrite back
		} else {
			index.set(key, m);
		}
	}
	tagged[kProviderModelIndex] = index;
	return index;
}

export function resolveProviderModelReference(
	provider: string,
	modelId: string,
	availableModels: readonly Model<Api>[],
): Model<Api> | undefined {
	const normalizedProvider = provider.trim().toLowerCase();
	const normalizedModelId = modelId.trim().toLowerCase();
	if (!normalizedProvider || !normalizedModelId) {
		return undefined;
	}

	const index = getProviderModelIndex(availableModels);
	const exact = index.get(`${normalizedProvider}\u0000${normalizedModelId}`);
	if (exact === null) {
		return undefined; // ambiguous
	}
	if (exact !== undefined) {
		return exact;
	}

	// Retired effort-tier variant ids resolve to their collapsed logical
	// model: hand-table aliases first, then the `X-thinking` → `X` grammar
	// for auto-derived pairs. Exact lookup above always wins while raw is live.
	const variantAliasId =
		resolveVariantAlias(normalizedProvider, normalizedModelId) ?? stripThinkingVariantToken(normalizedModelId);
	if (variantAliasId) {
		const aliased = index.get(`${normalizedProvider}\u0000${variantAliasId.toLowerCase()}`);
		if (aliased) {
			return aliased;
		}
	}

	if (normalizedProvider !== "openrouter") {
		return undefined;
	}

	for (const fallbackId of getOpenRouterFallbackModelIds(modelId).slice(1)) {
		const fallback = index.get(`${normalizedProvider}\u0000${fallbackId.toLowerCase()}`);
		if (fallback === null) {
			return undefined;
		}
		if (fallback !== undefined) {
			return cloneModelWithRequestedId(fallback, modelId);
		}
	}

	return undefined;
}

export interface ModelMatchPreferences {
	/** Most-recently-used model keys (provider/modelId) to prefer when ambiguous. */
	usageOrder?: string[];
	/** Provider precedence used for ambiguous unqualified model patterns. */
	providerOrder?: readonly string[];
	/** Providers to deprioritize when no recent usage or provider priority is available. */
	deprioritizeProviders?: string[];
}

export type CanonicalModelRegistry = Partial<
	Pick<ModelRegistry, "resolveCanonicalModel" | "getCanonicalVariants" | "getCanonicalId">
>;
export type ModelLookupRegistry = Pick<ModelRegistry, "getAvailable"> & Partial<CanonicalModelRegistry>;
type CliModelRegistry = Pick<ModelRegistry, "getAll"> & Partial<CanonicalModelRegistry>;
type InitialModelRegistry = Pick<ModelRegistry, "getAvailable" | "find">;
type RestorableModelRegistry = Pick<ModelRegistry, "getAvailable" | "find" | "getApiKey">;

interface ModelPreferenceContext {
	modelUsageRank: Map<string, number>;
	providerUsageRank: Map<string, number>;
	providerPriorityRank: Map<string, number>;
	deprioritizedProviders: Set<string>;
	modelOrder: Map<string, number>;
}

function buildPreferenceContext(
	availableModels: Model<Api>[],
	preferences: ModelMatchPreferences | undefined,
): ModelPreferenceContext {
	const modelUsageRank = new Map<string, number>();
	const providerUsageRank = new Map<string, number>();
	const usageOrder = preferences?.usageOrder ?? [];
	for (let i = 0; i < usageOrder.length; i += 1) {
		const key = usageOrder[i];
		if (!modelUsageRank.has(key)) {
			modelUsageRank.set(key, i);
		}
		const parsed = parseModelString(key);
		if (parsed && !providerUsageRank.has(parsed.provider)) {
			providerUsageRank.set(parsed.provider, i);
		}
	}
	const providerPriorityRank = buildModelProviderPriorityRank(preferences?.providerOrder);
	const deprioritizedProviders = new Set(preferences?.deprioritizeProviders ?? []);
	const modelOrder = new Map<string, number>();
	for (let i = 0; i < availableModels.length; i += 1) {
		modelOrder.set(formatModelString(availableModels[i]), i);
	}

	return { modelUsageRank, providerUsageRank, providerPriorityRank, deprioritizedProviders, modelOrder };
}

export function getModelMatchPreferences(
	settings?: Partial<Pick<Settings, "get" | "getStorage">>,
): ModelMatchPreferences {
	return {
		usageOrder: settings?.getStorage?.()?.getModelUsageOrder(),
		providerOrder: settings?.get?.("modelProviderOrder"),
	};
}

function mergeModelMatchPreferences(
	settings: Settings | undefined,
	preferences: ModelMatchPreferences | undefined,
): ModelMatchPreferences {
	const settingsPreferences = getModelMatchPreferences(settings);
	return {
		usageOrder: preferences?.usageOrder ?? settingsPreferences.usageOrder,
		providerOrder: preferences?.providerOrder ?? settingsPreferences.providerOrder,
		deprioritizeProviders: preferences?.deprioritizeProviders,
	};
}

function pickPreferredModel(candidates: Model<Api>[], context: ModelPreferenceContext): Model<Api> {
	if (candidates.length <= 1) return candidates[0];
	return [...candidates].sort((a, b) => {
		const aKey = formatModelString(a);
		const bKey = formatModelString(b);
		const aUsage = context.modelUsageRank.get(aKey);
		const bUsage = context.modelUsageRank.get(bKey);
		if (aUsage !== undefined || bUsage !== undefined) {
			return (aUsage ?? Number.POSITIVE_INFINITY) - (bUsage ?? Number.POSITIVE_INFINITY);
		}

		const aProviderPriority = context.providerPriorityRank.get(a.provider.toLowerCase());
		const bProviderPriority = context.providerPriorityRank.get(b.provider.toLowerCase());
		if (aProviderPriority !== undefined || bProviderPriority !== undefined) {
			return (aProviderPriority ?? Number.POSITIVE_INFINITY) - (bProviderPriority ?? Number.POSITIVE_INFINITY);
		}

		const aProviderUsage = context.providerUsageRank.get(a.provider);
		const bProviderUsage = context.providerUsageRank.get(b.provider);
		if (aProviderUsage !== undefined || bProviderUsage !== undefined) {
			return (aProviderUsage ?? Number.POSITIVE_INFINITY) - (bProviderUsage ?? Number.POSITIVE_INFINITY);
		}

		const aDeprioritized = context.deprioritizedProviders.has(a.provider);
		const bDeprioritized = context.deprioritizedProviders.has(b.provider);
		if (aDeprioritized !== bDeprioritized) {
			return aDeprioritized ? 1 : -1;
		}

		const aOrder = context.modelOrder.get(aKey) ?? 0;
		const bOrder = context.modelOrder.get(bKey) ?? 0;
		return aOrder - bOrder;
	})[0];
}

/**
 * Helper to check if a model ID looks like an alias (no date suffix)
 * Dates are typically in format: -20241022 or -20250929
 */
function isAlias(id: string): boolean {
	// Check if ID ends with -latest
	if (id.endsWith("-latest")) return true;

	// Check if ID ends with a date pattern (-YYYYMMDD)
	const datePattern = /-\d{8}$/;
	return !datePattern.test(id);
}

/**
 * Find an exact explicit provider/model match.
 * Bare model ids are handled separately so canonical ids can coalesce variants.
 */
function findExactModelReferenceMatch(modelReference: string, availableModels: Model<Api>[]): Model<Api> | undefined {
	const trimmedReference = modelReference.trim();
	if (!trimmedReference) {
		return undefined;
	}

	const slashIndex = trimmedReference.indexOf("/");
	if (slashIndex !== -1) {
		const provider = trimmedReference.substring(0, slashIndex).trim();
		const modelId = trimmedReference.substring(slashIndex + 1).trim();
		if (provider && modelId) {
			return resolveProviderModelReference(provider, modelId, availableModels);
		}
	}
	return undefined;
}

function findExactCanonicalModelMatch(
	modelReference: string,
	availableModels: Model<Api>[],
	modelRegistry: CanonicalModelRegistry | undefined,
): Model<Api> | undefined {
	if (!modelRegistry) {
		return undefined;
	}
	const trimmedReference = modelReference.trim();
	if (!trimmedReference || trimmedReference.includes("/")) {
		return undefined;
	}
	return modelRegistry.resolveCanonicalModel?.(trimmedReference, {
		availableOnly: false,
		candidates: availableModels,
	});
}

/**
 * The single model-matching engine. Tries, in order:
 * 1. exact `provider/id` reference (variant-alias and OpenRouter routed/date
 *    fallbacks included),
 * 2. exact canonical id (coalesces provider variants),
 * 3. exact bare id (preference-ranked),
 * 4. retired effort-tier variant alias (collapsed catalog entries),
 * 5. provider-scoped fuzzy match,
 * 6. substring match with the alias-vs-dated pick.
 * Returns the matched model or undefined if no match found.
 */
function matchModel(
	modelPattern: string,
	availableModels: Model<Api>[],
	context: ModelPreferenceContext,
	options?: { modelRegistry?: CanonicalModelRegistry },
): Model<Api> | undefined {
	// Explicit provider/model selectors always bypass canonical coalescing.
	const exactRefMatch = findExactModelReferenceMatch(modelPattern, availableModels);
	if (exactRefMatch) {
		return exactRefMatch;
	}

	// Exact canonical ids coalesce provider variants before bare-id matching.
	const exactCanonicalMatch = findExactCanonicalModelMatch(modelPattern, availableModels, options?.modelRegistry);
	if (exactCanonicalMatch) {
		return exactCanonicalMatch;
	}

	// Exact ID match (case-insensitive) — this must happen before provider-scoped
	// fuzzy matching so raw IDs that contain slashes (for example OpenRouter model
	// IDs like "openai/gpt-4o:extended") still resolve as IDs instead of being
	// misread as a provider-qualified selector.
	const exactMatches = availableModels.filter(m => m.id.toLowerCase() === modelPattern.toLowerCase());
	if (exactMatches.length > 0) {
		return pickPreferredModel(exactMatches, context);
	}

	// Retired effort-tier variant ids (bare, no provider prefix) resolve to
	// their collapsed logical model; models from the providers whose table
	// declared the alias win ties. Auto-derived `X-thinking` pairs resolve
	// through the grammar fallback.
	const bareAlias = resolveBareVariantAlias(modelPattern);
	const bareAliasTargetId = bareAlias?.id ?? stripThinkingVariantToken(modelPattern);
	if (bareAliasTargetId) {
		const aliasMatches = availableModels.filter(m => m.id.toLowerCase() === bareAliasTargetId.toLowerCase());
		if (aliasMatches.length > 0) {
			const preferred = bareAlias ? aliasMatches.filter(m => bareAlias.providers.includes(m.provider)) : [];
			return pickPreferredModel(preferred.length > 0 ? preferred : aliasMatches, context);
		}
	}
	// Check for provider/modelId format — fuzzy match within provider only.
	const slashIndex = modelPattern.indexOf("/");
	if (slashIndex !== -1) {
		const provider = modelPattern.substring(0, slashIndex);
		const modelId = modelPattern.substring(slashIndex + 1);
		const providerModels = availableModels.filter(m => m.provider.toLowerCase() === provider.toLowerCase());
		if (providerModels.length === 0) {
			// The prefix is not a known provider in this candidate set, so treat the
			// slash as part of the raw model ID and continue with generic matching.
		} else {
			const scored = providerModels
				.map(model => ({ model, match: fuzzyMatch(modelId, model.id) }))
				.filter(entry => entry.match.matches);
			if (scored.length === 0) {
				return undefined;
			}

			scored.sort((a, b) => {
				if (a.match.score !== b.match.score) return a.match.score - b.match.score;
				const aKey = formatModelString(a.model);
				const bKey = formatModelString(b.model);
				const aUsage = context.modelUsageRank.get(aKey) ?? Number.POSITIVE_INFINITY;
				const bUsage = context.modelUsageRank.get(bKey) ?? Number.POSITIVE_INFINITY;
				if (aUsage !== bUsage) return aUsage - bUsage;

				const aProviderUsage = context.providerUsageRank.get(a.model.provider) ?? Number.POSITIVE_INFINITY;
				const bProviderUsage = context.providerUsageRank.get(b.model.provider) ?? Number.POSITIVE_INFINITY;
				if (aProviderUsage !== bProviderUsage) return aProviderUsage - bProviderUsage;

				const aOrder = context.modelOrder.get(aKey) ?? 0;
				const bOrder = context.modelOrder.get(bKey) ?? 0;
				return aOrder - bOrder;
			});
			return scored[0]?.model;
		}
	}

	// No exact match - fall back to partial matching
	const matches = availableModels.filter(
		m =>
			m.id.toLowerCase().includes(modelPattern.toLowerCase()) ||
			m.name?.toLowerCase().includes(modelPattern.toLowerCase()),
	);

	if (matches.length === 0) {
		return undefined;
	}

	// Separate into aliases and dated versions
	const aliases = matches.filter(m => isAlias(m.id));
	const datedVersions = matches.filter(m => !isAlias(m.id));

	if (aliases.length > 0) {
		return pickPreferredModel(aliases, context);
	}
	if (datedVersions.length === 0) return undefined;

	if (datedVersions.length === 1) {
		return datedVersions[0];
	}

	const sortedById = [...datedVersions].sort((a, b) => b.id.localeCompare(a.id));
	const topId = sortedById[0]?.id;
	if (!topId) return undefined;
	const topCandidates = sortedById.filter(model => model.id === topId);
	return pickPreferredModel(topCandidates, context);
}

export interface ParsedModelResult {
	model: Model<Api> | undefined;
	/** Thinking level if explicitly specified in pattern, undefined otherwise */
	thinkingLevel?: ThinkingLevel;
	/** Upstream provider slug from an `@upstream` routing selector, if present. */
	upstream?: string;
	warning: string | undefined;
	explicitThinkingLevel: boolean;
}

/**
 * Parse a pattern to extract model and thinking level.
 * Handles models with colons in their IDs (e.g., OpenRouter's :exacto suffix).
 *
 * Algorithm:
 * 1. Try to match full pattern as a model
 * 2. If found, return it with undefined thinking level
 * 3. If not found and has colons, split on last colon:
 *    - If suffix is valid thinking level, use it and recurse on prefix
 *    - If suffix is invalid, warn and recurse on prefix
 *
 * @internal Exported for testing
 */
function parseModelPatternWithContext(
	pattern: string,
	availableModels: Model<Api>[],
	context: ModelPreferenceContext,
	options?: { allowInvalidThinkingSelectorFallback?: boolean; modelRegistry?: CanonicalModelRegistry },
): ParsedModelResult {
	// Try exact match first
	const exactMatch = matchModel(pattern, availableModels, context, options);
	if (exactMatch) {
		return { model: exactMatch, thinkingLevel: undefined, warning: undefined, explicitThinkingLevel: false };
	}

	// No match - try stripping a valid thinking suffix and recursing
	const { base, level } = splitThinkingSuffix(pattern);
	if (level) {
		const result = parseModelPatternWithContext(base, availableModels, context, options);
		if (result.model) {
			// Only use this thinking level if no warning from inner recursion
			const explicitThinkingLevel = !result.warning;
			return {
				model: result.model,
				thinkingLevel: explicitThinkingLevel ? level : undefined,
				warning: result.warning,
				explicitThinkingLevel,
			};
		}
		return result;
	}

	const lastColonIndex = pattern.lastIndexOf(":");
	if (lastColonIndex === -1) {
		// No colons, pattern simply doesn't match any model
		return { model: undefined, thinkingLevel: undefined, warning: undefined, explicitThinkingLevel: false };
	}
	const prefix = pattern.substring(0, lastColonIndex);
	const suffix = pattern.substring(lastColonIndex + 1);

	const allowFallback = options?.allowInvalidThinkingSelectorFallback ?? true;
	if (!allowFallback) {
		return { model: undefined, thinkingLevel: undefined, warning: undefined, explicitThinkingLevel: false };
	}

	// Invalid suffix - recurse on prefix and warn
	const result = parseModelPatternWithContext(prefix, availableModels, context, options);
	if (result.model) {
		return {
			model: result.model,
			thinkingLevel: undefined,
			warning: `Invalid thinking level "${suffix}" in pattern "${pattern}". Using default instead.`,
			explicitThinkingLevel: false,
		};
	}
	return result;
}

export function parseModelPattern(
	pattern: string,
	availableModels: Model<Api>[],
	preferences?: ModelMatchPreferences,
	options?: { allowInvalidThinkingSelectorFallback?: boolean; modelRegistry?: CanonicalModelRegistry },
): ParsedModelResult {
	const context = buildPreferenceContext(availableModels, preferences);
	const direct = parseModelPatternWithContext(pattern, availableModels, context, options);
	if (direct.model) return direct;

	// No direct match: a trailing `@upstream` may be a provider-routing selector.
	// Only honor it when the base resolves to an aggregator model (OpenRouter /
	// Vercel Gateway); otherwise `@` stays part of the id and `direct` stands.
	const routing = splitUpstreamRouting(pattern);
	if (routing) {
		const routed = parseModelPatternWithContext(routing.base, availableModels, context, options);
		if (routed.model && supportsUpstreamRouting(routed.model)) {
			return { ...routed, model: applyUpstreamRouting(routed.model, routing.upstream), upstream: routing.upstream };
		}
	}
	return direct;
}


function resolveExplicitThinkingLevelForModel(
	model: Model<Api>,
	thinkingLevel: ThinkingLevel | undefined,
): ThinkingLevel | undefined {
	const resolved = resolveThinkingLevelForModel(model, thinkingLevel);
	if (resolved !== undefined) return resolved;
	if (thinkingLevel === undefined || thinkingLevel === ThinkingLevel.Inherit) return undefined;
	if (!model.reasoning) return thinkingLevel;
	return clampAutoThinkingEffort(model, thinkingLevel);
}
/**
 * Resolve a model role value into a concrete model and thinking metadata.
 */
export interface ResolvedModelRoleValue {
	model: Model<Api> | undefined;
	thinkingLevel?: ThinkingLevel;
	explicitThinkingLevel: boolean;
	warning: string | undefined;
}

export function resolveModelRoleValue(
	roleValue: string | undefined,
	availableModels: Model<Api>[],
	options?: { settings?: Settings; matchPreferences?: ModelMatchPreferences; modelRegistry?: CanonicalModelRegistry },
): ResolvedModelRoleValue {
	if (!roleValue) {
		return { model: undefined, thinkingLevel: undefined, explicitThinkingLevel: false, warning: undefined };
	}

	const normalized = roleValue.trim();
	if (!normalized || normalized === DEFAULT_MODEL_ROLE) {
		return { model: undefined, thinkingLevel: undefined, explicitThinkingLevel: false, warning: undefined };
	}

	const effectivePatterns = resolveConfiguredModelPatterns(normalized, options?.settings);
	if (!effectivePatterns || effectivePatterns.length === 0) {
		return { model: undefined, thinkingLevel: undefined, explicitThinkingLevel: false, warning: undefined };
	}

	let warning: string | undefined;
	const matchPreferences = mergeModelMatchPreferences(options?.settings, options?.matchPreferences);
	for (const effectivePattern of effectivePatterns) {
		const resolved = parseModelPattern(effectivePattern, availableModels, matchPreferences, {
			modelRegistry: options?.modelRegistry,
		});
		if (resolved.model) {
			return {
				model: resolved.model,
				thinkingLevel: resolved.explicitThinkingLevel
					? resolveExplicitThinkingLevelForModel(resolved.model, resolved.thinkingLevel)
					: resolved.thinkingLevel,
				explicitThinkingLevel: resolved.explicitThinkingLevel,
				warning: resolved.warning,
			};
		}
		if (!warning && resolved.warning) {
			warning = resolved.warning;
		}
	}

	return { model: undefined, thinkingLevel: undefined, explicitThinkingLevel: false, warning };
}


/**
 * Resolve a model identifier or pattern to a Model instance.
 */
export function resolveModelFromString(
	value: string,
	available: Model<Api>[],
	matchPreferences?: ModelMatchPreferences,
	modelRegistry?: CanonicalModelRegistry,
): Model<Api> | undefined {
	const parsed = parseModelString(value);
	if (parsed) {
		const exact = available.find(model => model.provider === parsed.provider && model.id === parsed.id);
		if (exact) return exact;
	}
	return parseModelPattern(value, available, matchPreferences, { modelRegistry }).model;
}

/**
 * Resolve a model from configured roles, honoring order and overrides.
 */
export function resolveModelFromSettings(options: {
	settings: Settings;
	availableModels: Model<Api>[];
	matchPreferences?: ModelMatchPreferences;
	roleOrder?: readonly ModelRole[];
	modelRegistry?: CanonicalModelRegistry;
}): Model<Api> | undefined {
	const { settings, availableModels, matchPreferences, roleOrder, modelRegistry } = options;
	const roles = roleOrder ?? MODEL_ROLE_IDS;
	let sawConfiguredProviderQualifiedRole = false;
	for (const role of roles) {
		const configured = settings.getModelRole(role);
		if (!configured) continue;
		const expanded = expandRoleAlias(configured, settings).trim();
		if (expanded.includes("/")) {
			sawConfiguredProviderQualifiedRole = true;
		}
		const resolved = resolveModelFromString(expanded, availableModels, matchPreferences, modelRegistry);
		if (resolved) return resolved;
	}
	return sawConfiguredProviderQualifiedRole ? undefined : availableModels[0];
}

/**
 * Resolve a list of override patterns to the first matching model.
 */
export function resolveModelOverride(
	modelPatterns: string[],
	modelRegistry: ModelLookupRegistry,
	settings?: Settings,
): { model?: Model<Api>; thinkingLevel?: ThinkingLevel; explicitThinkingLevel: boolean } {
	if (modelPatterns.length === 0) return { explicitThinkingLevel: false };
	const availableModels = modelRegistry.getAvailable();
	const matchPreferences = getModelMatchPreferences(settings);
	for (const pattern of modelPatterns) {
		const { model, thinkingLevel, explicitThinkingLevel } = resolveModelRoleValue(pattern, availableModels, {
			settings,
			matchPreferences,
			modelRegistry,
		});
		if (model) {
			return { model, thinkingLevel, explicitThinkingLevel };
		}
	}
	return { explicitThinkingLevel: false };
}

/**
 * Resolve a list of override patterns to the first matching model, with an
 * auth-aware fallback to the parent session's active model.
 *
 * If the resolved subagent model has no working credentials (provider has no
 * usable auth), and the parent's active model resolves with working auth,
 * use the parent's model instead. This prevents subagent dispatch from
 * silently routing to a provider the user can't actually call (for example, a
 * configured responsibility lane pointing at an unqualified id whose only
 * available provider variant has no configured credentials — see #985).
 *
 * Keyless-by-design providers (llama.cpp, ollama, lm-studio) advertise the
 * `kNoAuth` sentinel from `getApiKey` to signal that they do not require
 * credentials. Those are treated as authenticated here so an explicitly
 * configured local model is never silently rerouted to the parent's remote
 * provider (see #1008).
 *
 * If neither the subagent nor the parent has working auth, returns the
 * primary resolution unchanged so the existing error path still surfaces
 * a meaningful failure downstream.
 */
export async function resolveModelOverrideWithAuthFallback(
	modelPatterns: string[],
	parentActiveModelPattern: string | undefined,
	modelRegistry: ModelLookupRegistry & Pick<ModelRegistry, "getApiKey">,
	settings?: Settings,
): Promise<{
	model?: Model<Api>;
	thinkingLevel?: ThinkingLevel;
	explicitThinkingLevel: boolean;
	authFallbackUsed: boolean;
	blocked: boolean;
}> {
	const primary = resolveModelOverride(modelPatterns, modelRegistry, settings);

	// Leak A fix: when modelPatterns is empty (or resolves to no model) and
	// parentActiveModelPattern is set, resolve the parent pattern and run it
	// through the blocked-model guard. Without this, the undefined primary
	// would skip the guard and downstream session creation would silently
	// inherit the parent model — which can be an orchestrator-only model.
	if (!primary.model && parentActiveModelPattern) {
		const parentResolved = resolveModelOverride([parentActiveModelPattern], modelRegistry, settings);
		if (parentResolved.model && !isBlockedSubagentModel(parentResolved.model, settings)) {
			return { ...parentResolved, authFallbackUsed: false, blocked: false };
		}
		if (parentResolved.model && isBlockedSubagentModel(parentResolved.model, settings)) {
			const fallbackPatterns = ["pi/task", "pi/implementer", "pi/smol", "pi/slow"];
			for (const fallbackPattern of fallbackPatterns) {
				const fallback = resolveModelOverride([fallbackPattern], modelRegistry, settings);
				if (!fallback.model || isBlockedSubagentModel(fallback.model, settings)) continue;
				const fallbackKey = await modelRegistry.getApiKey(fallback.model);
				if (fallbackKey === kNoAuth || isAuthenticated(fallbackKey)) {
					logger.warn("Blocked orchestrator-only parent model for subagent; falling back", {
						parentPattern: parentActiveModelPattern,
						fallbackPattern,
						resolvedProvider: fallback.model.provider,
						resolvedModel: fallback.model.id,
					});
					return { ...fallback, authFallbackUsed: true, blocked: false };
				}
			}
			logger.warn("Blocked orchestrator-only parent model for subagent; no fallback available", {
				parentPattern: parentActiveModelPattern,
			});
			return { model: undefined, thinkingLevel: undefined, explicitThinkingLevel: false, authFallbackUsed: false, blocked: true };
		}
		return { ...primary, authFallbackUsed: false, blocked: false };
	}

	if (primary.model && isBlockedSubagentModel(primary.model, settings)) {
		const fallbackPatterns = [
			...(parentActiveModelPattern ? [parentActiveModelPattern] : []),
			"pi/task",
			"pi/implementer",
			"pi/smol",
			"pi/slow",
		];

		for (const fallbackPattern of fallbackPatterns) {
			const fallback = resolveModelOverride([fallbackPattern], modelRegistry, settings);
			if (!fallback.model || isBlockedSubagentModel(fallback.model, settings)) continue;
			const fallbackKey = await modelRegistry.getApiKey(fallback.model);
			if (fallbackKey === kNoAuth || isAuthenticated(fallbackKey)) {
				logger.warn("Blocked orchestrator-only subagent model; falling back to a non-blocked model", {
					requested: modelPatterns,
					fallbackPattern,
					resolvedProvider: fallback.model.provider,
					resolvedModel: fallback.model.id,
				});
				return { ...fallback, authFallbackUsed: true, blocked: false };
			}
		}

		// Leak B fix: signal blocked explicitly instead of returning ambiguous undefined
		logger.warn("Blocked orchestrator-only subagent model; no fallback was available", { requested: modelPatterns });
		return { model: undefined, thinkingLevel: undefined, explicitThinkingLevel: false, authFallbackUsed: false, blocked: true };
	}

	if (!primary.model || !parentActiveModelPattern) {
		return { ...primary, authFallbackUsed: false, blocked: false };
	}

	const primaryKey = await modelRegistry.getApiKey(primary.model);
	if (primaryKey === kNoAuth || isAuthenticated(primaryKey)) {
		return { ...primary, authFallbackUsed: false, blocked: false };
	}

	const fallback = resolveModelOverride([parentActiveModelPattern], modelRegistry, settings);
	if (!fallback.model) {
		return { ...primary, authFallbackUsed: false, blocked: false };
	}
	if (modelsAreEqual(fallback.model, primary.model) || isBlockedSubagentModel(fallback.model, settings)) {
		return { ...primary, authFallbackUsed: false, blocked: false };
	}
	const fallbackKey = await modelRegistry.getApiKey(fallback.model);
	if (fallbackKey !== kNoAuth && !isAuthenticated(fallbackKey)) {
		return { ...primary, authFallbackUsed: false, blocked: false };
	}

	return { ...fallback, authFallbackUsed: true, blocked: false };
}

/**
 * Resolve a list of role patterns to the first matching model.
 */
export function resolveRoleSelection(
	roles: readonly string[],
	settings: Settings,
	availableModels: Model<Api>[],
	modelRegistry?: CanonicalModelRegistry,
): { model: Model<Api>; thinkingLevel?: ThinkingLevel } | undefined {
	const matchPreferences = getModelMatchPreferences(settings);
	for (const role of roles) {
		const resolved = resolveModelRoleValue(settings.getModelRole(role), availableModels, {
			settings,
			matchPreferences,
			modelRegistry,
		});
		if (resolved.model) {
			return { model: resolved.model, thinkingLevel: resolved.thinkingLevel };
		}
	}
	return undefined;
}

function resolveExactCanonicalScopePattern(
	pattern: string,
	modelRegistry: Pick<ModelRegistry, "getCanonicalVariants">,
	availableModels: Model<Api>[],
): { models: Model<Api>[]; thinkingLevel?: ThinkingLevel; explicitThinkingLevel: boolean } | undefined {
	const { base: canonicalId, level: thinkingLevel } = splitThinkingSuffix(pattern);
	const explicitThinkingLevel = thinkingLevel !== undefined;

	const variants = modelRegistry
		.getCanonicalVariants(canonicalId, { availableOnly: true, candidates: availableModels })
		.map(variant => variant.model);
	if (variants.length === 0) {
		return undefined;
	}

	return { models: variants, thinkingLevel, explicitThinkingLevel };
}

/**
 * Resolve model patterns to actual Model objects with optional thinking levels
 * Format: "pattern:level" where :level is optional
 * For each pattern, finds all matching models and picks the best version:
 * 1. Prefer alias (e.g., claude-sonnet-4-5) over dated versions (claude-sonnet-4-5-20250929)
 * 2. If no alias, pick the latest dated version
 *
 * Supports models with colons in their IDs (e.g., OpenRouter's model:exacto).
 * The algorithm tries to match the full pattern first, then progressively
 * strips colon-suffixes to find a match.
 */
export async function resolveModelScope(
	patterns: string[],
	modelRegistry: Pick<ModelRegistry, "getAvailable" | "getCanonicalVariants">,
	preferences?: ModelMatchPreferences,
): Promise<ScopedModel[]> {
	const availableModels = modelRegistry.getAvailable();
	const context = buildPreferenceContext(availableModels, preferences);
	const scopedModels: ScopedModel[] = [];
	const addScopedModel = (model: Model<Api>, thinkingLevel: ThinkingLevel | undefined, explicit: boolean) => {
		if (scopedModels.some(sm => modelsAreEqual(sm.model, model))) return;
		scopedModels.push({
			model,
			thinkingLevel: explicit ? resolveExplicitThinkingLevelForModel(model, thinkingLevel) : thinkingLevel,
			explicitThinkingLevel: explicit,
		});
	};

	for (const pattern of patterns) {
		// Check if pattern contains glob characters
		if (pattern.includes("*") || pattern.includes("?") || pattern.includes("[")) {
			// Extract optional thinking level suffix (e.g., "provider/*:high")
			const { base: globPattern, level: thinkingLevel } = splitThinkingSuffix(pattern);
			const explicitThinkingLevel = thinkingLevel !== undefined;

			// Match against "provider/modelId" format OR just model ID
			// This allows "*sonnet*" to match without requiring "anthropic/*sonnet*"
			const matchingModels = availableModels.filter(m => {
				const fullId = `${m.provider}/${m.id}`;
				const glob = new Bun.Glob(globPattern.toLowerCase());
				return glob.match(fullId.toLowerCase()) || glob.match(m.id.toLowerCase());
			});

			if (matchingModels.length === 0) {
				logger.warn(`No models match pattern "${pattern}"`);
				continue;
			}

			for (const model of matchingModels) {
				addScopedModel(model, thinkingLevel, explicitThinkingLevel);
			}
			continue;
		}

		const exactCanonical = resolveExactCanonicalScopePattern(pattern, modelRegistry, availableModels);
		if (exactCanonical) {
			for (const model of exactCanonical.models) {
				addScopedModel(model, exactCanonical.thinkingLevel, exactCanonical.explicitThinkingLevel);
			}
			continue;
		}

		const { model, thinkingLevel, warning, explicitThinkingLevel } = parseModelPatternWithContext(
			pattern,
			availableModels,
			context,
			{ modelRegistry },
		);

		if (warning) {
			logger.warn(warning);
		}

		if (!model) {
			logger.warn(`No models match pattern "${pattern}"`);
			continue;
		}

		addScopedModel(model, thinkingLevel, explicitThinkingLevel);
	}

	return scopedModels;
}

/**
 * Resolve the set of models a session is allowed to use, given the active
 * settings. Starts from `modelRegistry.getAvailable()` (so disabled providers
 * and providers without credentials are already filtered out) and, when
 * `enabledModels` is configured for the current path scope, further restricts
 * the result to models matching those patterns.
 *
 * Returns the unfiltered available list when `enabledModels` is empty.
 * Returns an empty list when `enabledModels` is configured but no available
 * model matches any pattern — callers MUST treat this as "no usable model"
 * rather than falling back to the global default (see issue #1022).
 */
export async function resolveAllowedModels(
	modelRegistry: Pick<ModelRegistry, "getAvailable" | "getCanonicalVariants">,
	settings: Settings | undefined,
	preferences?: ModelMatchPreferences,
): Promise<Model<Api>[]> {
	const available = modelRegistry.getAvailable();
	const patterns = settings?.get("enabledModels");
	if (!patterns || patterns.length === 0) {
		return available;
	}
	const scoped = await resolveModelScope(patterns, modelRegistry, preferences);
	if (scoped.length === 0) {
		return [];
	}
	const allowed = new Set(scoped.map(entry => `${entry.model.provider}/${entry.model.id}`));
	return available.filter(model => allowed.has(`${model.provider}/${model.id}`));
}

/**
 * Synchronous subset of {@link resolveAllowedModels} for contexts where async is unavailable
 * (e.g. `getAvailableModels()` which is called from the ACP model-list advertisement, RPC
 * `get_available_models`, and the `/model` slash command). Uses the same effective
 * `enabledModels` scope semantics as startup resolution:
 *
 * - Glob selectors match `provider/modelId` and bare model id
 * - Exact canonical ids expand to all available concrete variants
 * - Exact `provider/modelId`, bare ids, provider-scoped fuzzy, and substring selectors
 *   resolve through the shared model-pattern matcher
 * - Optional `:thinkingLevel` suffixes are stripped only when valid
 *
 * When no pattern resolves to any model (misconfiguration / typo) an empty list is returned,
 * consistent with the empty-list contract of {@link resolveAllowedModels}. Callers that render
 * a UI picker should treat an empty list as "hide the picker entry", matching how the SDK
 * surfaces the same misconfiguration during session initialization.
 */
export function filterAvailableModelsByEnabledPatterns(
	available: Model<Api>[],
	patterns: readonly string[],
	registry: Pick<ModelRegistry, "getCanonicalVariants">,
): Model<Api>[] {
	if (patterns.length === 0) return available;

	const context = buildPreferenceContext(available, undefined);
	const allowed = new Set<string>();
	const addAllowed = (model: Model<Api>) => {
		allowed.add(`${model.provider}/${model.id}`);
	};

	for (const pattern of patterns) {
		if (pattern.includes("*") || pattern.includes("?") || pattern.includes("[")) {
			const { base: globPattern } = splitThinkingSuffix(pattern);
			const glob = new Bun.Glob(globPattern.toLowerCase());
			for (const model of available) {
				const fullId = `${model.provider}/${model.id}`.toLowerCase();
				if (glob.match(fullId) || glob.match(model.id.toLowerCase())) {
					addAllowed(model);
				}
			}
			continue;
		}

		const exactCanonical = resolveExactCanonicalScopePattern(pattern, registry, available);
		if (exactCanonical) {
			for (const model of exactCanonical.models) {
				addAllowed(model);
			}
			continue;
		}

		const { model } = parseModelPatternWithContext(pattern, available, context, { modelRegistry: registry });
		if (model) {
			addAllowed(model);
		}
	}

	return allowed.size === 0 ? [] : available.filter(model => allowed.has(`${model.provider}/${model.id}`));
}

export interface ResolveCliModelResult {
	model: Model<Api> | undefined;
	selector?: string;
	thinkingLevel?: ThinkingLevel;
	warning: string | undefined;
	error: string | undefined;
}

/**
 * Resolve a single model from CLI flags.
 */
export function resolveCliModel(options: {
	cliProvider?: string;
	cliModel?: string;
	modelRegistry: CliModelRegistry;
	preferences?: ModelMatchPreferences;
	settings?: Settings;
}): ResolveCliModelResult {
	const { cliProvider, cliModel, modelRegistry, preferences, settings } = options;

	if (!cliModel) {
		return { model: undefined, selector: undefined, warning: undefined, error: undefined };
	}

	const availableModels = modelRegistry.getAll();
	if (availableModels.length === 0) {
		return {
			model: undefined,
			selector: undefined,
			warning: undefined,
			error: "No models available. Check your installation or add models to models.json.",
		};
	}

	const trimmedModel = cliModel.trim();
	const roleReference = !cliProvider ? parseExplicitModelRoleReference(trimmedModel) : undefined;
	if (roleReference) {
		const role = roleReference.role;
		if (!isKnownModelRole(role, settings)) {
			return {
				model: undefined,
				selector: undefined,
				thinkingLevel: undefined,
				warning: undefined,
				error: formatUnknownModelRoleError(trimmedModel, settings),
			};
		}

		const resolved = resolveModelRoleValue(trimmedModel, availableModels, {
			settings,
			matchPreferences: preferences,
			modelRegistry,
		});
		if (!resolved.model) {
			const configuredSelector = settings?.resolveModelRole(role).effectiveSelector;
			const roleSource = describeModelRoleSource(settings, role);
			const selectorDetail = configuredSelector ? ` selector "${configuredSelector}"` : "";
			return {
				model: undefined,
				selector: undefined,
				thinkingLevel: undefined,
				warning: resolved.warning,
				error: `Model role "${trimmedModel}" from ${roleSource}${selectorDetail} did not match an available model. Run "omp models" to see available models.`,
			};
		}

		return {
			model: resolved.model,
			selector: formatModelSelectorValue(
				formatModelString(resolved.model),
				resolved.explicitThinkingLevel ? resolved.thinkingLevel : undefined,
			),
			thinkingLevel: resolved.thinkingLevel,
			warning: resolved.warning,
			error: undefined,
		};
	}

	const providerMap = new Map<string, string>();
	for (const model of availableModels) {
		providerMap.set(model.provider.toLowerCase(), model.provider);
	}

	let provider = cliProvider ? providerMap.get(cliProvider.toLowerCase()) : undefined;
	if (cliProvider && !provider) {
		return {
			model: undefined,
			selector: undefined,
			warning: undefined,
			error: `Unknown provider "${cliProvider}". Run "omp models" to see available providers/models.`,
		};
	}


	if (!provider) {
		const lower = trimmedModel.toLowerCase();
		// When input has provider/id format (e.g. "zai/glm-5"), prefer decomposed
		// provider+id match over flat id match. Without this, a model with id
		// "zai/glm-5" on provider "vercel-ai-gateway" wins over provider "zai"
		// with id "glm-5", because Array.find returns the first catalog hit.
		let exact = findExactModelReferenceMatch(trimmedModel, availableModels);
		if (!exact && !trimmedModel.includes(":")) {
			// CLI flags address the full catalog, so unlike the engine's canonical
			// step this lookup is unrestricted; the `:`-guard defers suffixed
			// selectors (thinking levels, ollama-style ids) to the grammar below.
			const canonicalMatch = modelRegistry.resolveCanonicalModel?.(trimmedModel, { availableOnly: false });
			if (canonicalMatch) {
				return {
					model: canonicalMatch,
					selector: modelRegistry.getCanonicalId?.(canonicalMatch) ?? trimmedModel,
					warning: undefined,
					thinkingLevel: undefined,
					error: undefined,
				};
			}
		}
		if (!exact) {
			// Flat exact id (or full selector) by catalog order: CLI resolution
			// stays deterministic across runs regardless of usage-based ranking.
			exact = availableModels.find(
				model => model.id.toLowerCase() === lower || `${model.provider}/${model.id}`.toLowerCase() === lower,
			);
		}
		if (exact) {
			return {
				model: exact,
				selector: formatModelString(exact),
				warning: undefined,
				thinkingLevel: undefined,
				error: undefined,
			};
		}
	}

	let pattern = trimmedModel;

	if (!provider) {
		const slashIndex = cliModel.indexOf("/");
		if (slashIndex !== -1) {
			const maybeProvider = cliModel.substring(0, slashIndex);
			const canonical = providerMap.get(maybeProvider.toLowerCase());
			if (canonical) {
				provider = canonical;
				pattern = cliModel.substring(slashIndex + 1);
			}
		}
	} else {
		const prefix = `${provider}/`;
		if (cliModel.toLowerCase().startsWith(prefix.toLowerCase())) {
			pattern = cliModel.substring(prefix.length);
		}
	}

	if (provider) {
		const exactProviderMatch = resolveProviderModelReference(provider, pattern, availableModels);
		if (exactProviderMatch) {
			return {
				model: exactProviderMatch,
				selector: formatModelString(exactProviderMatch),
				warning: undefined,
				thinkingLevel: undefined,
				error: undefined,
			};
		}
	}

	const candidates = provider ? availableModels.filter(model => model.provider === provider) : availableModels;
	const { model, thinkingLevel, warning, upstream } = parseModelPattern(pattern, candidates, preferences, {
		allowInvalidThinkingSelectorFallback: false,
		modelRegistry,
	});

	if (!model) {
		const display = provider ? `${provider}/${pattern}` : cliModel;
		return {
			model: undefined,
			selector: undefined,
			thinkingLevel: undefined,
			warning,
			error: `Model "${display}" not found. Run "omp models" to see available models.`,
		};
	}

	let selector = provider ? formatModelString(model) : undefined;
	if (!provider) {
		const canonicalCandidate = splitThinkingSuffix(pattern).base;
		if (!canonicalCandidate.includes("/")) {
			const canonicalResolved = modelRegistry.resolveCanonicalModel?.(canonicalCandidate, { availableOnly: false });
			if (canonicalResolved && canonicalResolved.provider === model.provider && canonicalResolved.id === model.id) {
				selector = modelRegistry.getCanonicalId?.(canonicalResolved) ?? canonicalCandidate;
			}
		}
	}
	if (selector !== undefined && upstream) {
		selector = `${selector}@${upstream}`;
	}

	return {
		model,
		selector,
		thinkingLevel,
		warning,
		error: undefined,
	};
}

export interface InitialModelResult {
	model: Model<Api> | undefined;
	thinkingLevel?: ThinkingLevel;
	fallbackMessage: string | undefined;
}

/**
 * Find the initial model to use based on priority:
 * 1. CLI args (provider + model)
 * 2. First model from scoped models (if not continuing/resuming)
 * 3. Restored from session (if continuing/resuming)
 * 4. Saved default from settings
 * 5. First available model with valid API key
 */
export async function findInitialModel(options: {
	cliProvider?: string;
	cliModel?: string;
	scopedModels: ScopedModel[];
	isContinuing: boolean;
	defaultProvider?: string;
	defaultModelId?: string;
	defaultThinkingSelector?: Effort;
	modelRegistry: InitialModelRegistry;
}): Promise<InitialModelResult> {
	const {
		cliProvider,
		cliModel,
		scopedModels,
		isContinuing,
		defaultProvider,
		defaultModelId,
		defaultThinkingSelector,
		modelRegistry,
	} = options;

	let model: Model<Api> | undefined;
	let thinkingLevel: ThinkingLevel | undefined;

	// 1. CLI args take priority
	if (cliProvider && cliModel) {
		const found = modelRegistry.find(cliProvider, cliModel);
		if (!found) {
			console.error(chalk.red(`Model ${cliProvider}/${cliModel} not found`));
			process.exit(1);
		}
		return { model: found, thinkingLevel: undefined, fallbackMessage: undefined };
	}

	// 2. Use first model from scoped models (skip if continuing/resuming)
	if (scopedModels.length > 0 && !isContinuing) {
		const scoped = scopedModels[0];
		const scopedThinkingSelector =
			scoped.thinkingLevel === ThinkingLevel.Inherit
				? defaultThinkingSelector
				: (scoped.thinkingLevel ?? defaultThinkingSelector);
		return {
			model: scoped.model,
			thinkingLevel:
				scopedThinkingSelector === ThinkingLevel.Off
					? ThinkingLevel.Off
					: clampThinkingLevelForModel(scoped.model, scopedThinkingSelector),
			fallbackMessage: undefined,
		};
	}

	// 3. Try saved default from settings
	if (defaultProvider && defaultModelId) {
		const found = modelRegistry.find(defaultProvider, defaultModelId);
		if (found) {
			model = found;
			thinkingLevel = clampThinkingLevelForModel(found, defaultThinkingSelector);
			return { model, thinkingLevel, fallbackMessage: undefined };
		}
	}

	// 4. Try first available model with valid API key
	const availableModels = modelRegistry.getAvailable();

	const fallback = pickDefaultAvailableModel(availableModels);
	if (fallback) {
		return { model: fallback, thinkingLevel: undefined, fallbackMessage: undefined };
	}

	// 5. No model found
	return { model: undefined, thinkingLevel: undefined, fallbackMessage: undefined };
}

/**
 * Restore model from session, with fallback to available models
 */
export async function restoreModelFromSession(
	savedProvider: string,
	savedModelId: string,
	currentModel: Model<Api> | undefined,
	shouldPrintMessages: boolean,
	modelRegistry: RestorableModelRegistry,
): Promise<{ model: Model<Api> | undefined; fallbackMessage: string | undefined }> {
	const restoredModel = modelRegistry.find(savedProvider, savedModelId);

	// Check if restored model exists and has a valid API key
	const hasApiKey = restoredModel ? !!(await modelRegistry.getApiKey(restoredModel)) : false;

	if (restoredModel && hasApiKey) {
		if (shouldPrintMessages) {
			console.log(chalk.dim(`Restored model: ${savedProvider}/${savedModelId}`));
		}
		return { model: restoredModel, fallbackMessage: undefined };
	}

	// Model not found or no API key - fall back
	const reason = !restoredModel ? "model no longer exists" : "no API key available";

	if (shouldPrintMessages) {
		console.error(chalk.yellow(`Warning: Could not restore model ${savedProvider}/${savedModelId} (${reason}).`));
	}

	// If we already have a model, use it as fallback
	if (currentModel) {
		if (shouldPrintMessages) {
			console.log(chalk.dim(`Falling back to: ${currentModel.provider}/${currentModel.id}`));
		}
		return {
			model: currentModel,
			fallbackMessage: `Could not restore model ${savedProvider}/${savedModelId} (${reason}). Using ${currentModel.provider}/${currentModel.id}.`,
		};
	}

	// Try to find any available model
	const availableModels = modelRegistry.getAvailable();

	const fallbackModel = pickDefaultAvailableModel(availableModels);
	if (fallbackModel) {
		if (shouldPrintMessages) {
			console.log(chalk.dim(`Falling back to: ${fallbackModel.provider}/${fallbackModel.id}`));
		}

		return {
			model: fallbackModel,
			fallbackMessage: `Could not restore model ${savedProvider}/${savedModelId} (${reason}). Using ${fallbackModel.provider}/${fallbackModel.id}.`,
		};
	}

	// No models available
	return { model: undefined, fallbackMessage: undefined };
}

/**
 * Find a smol/fast model using the priority chain.
 * Tries exact matches first, then fuzzy matches.
 *
 * @param modelRegistry The model registry to search
 * @param savedModel Optional saved model string from settings (provider/modelId)
 * @returns The best available smol model, or undefined if none found
 */
export async function findSmolModel(
	modelRegistry: ModelLookupRegistry,
	savedModel?: string,
): Promise<Model<Api> | undefined> {
	const availableModels = modelRegistry.getAvailable();
	if (availableModels.length === 0) return undefined;

	// 1. Try saved model from settings
	if (savedModel) {
		const match = resolveModelFromString(savedModel, availableModels, undefined, modelRegistry);
		if (match) return match;
	}

	// 2. Try priority chain
	for (const pattern of MODEL_PRIO.smol) {
		// Try exact match with provider prefix
		const providerMatch = availableModels.find(m => `${m.provider}/${m.id}`.toLowerCase() === pattern);
		if (providerMatch) return providerMatch;

		// Try exact match first
		const exactMatch = parseModelPattern(pattern, availableModels, undefined, { modelRegistry }).model;
		if (exactMatch) return exactMatch;

		// Try fuzzy match (substring)
		const fuzzyMatch = availableModels.find(m => m.id.toLowerCase().includes(pattern));
		if (fuzzyMatch) return fuzzyMatch;
	}

	// 3. Fallback to first available (same as default)
	return availableModels[0];
}

/**
 * Find a slow/comprehensive model using the priority chain.
 * Prioritizes reasoning and codex models for thorough analysis.
 *
 * @param modelRegistry The model registry to search
 * @param savedModel Optional saved model string from settings (provider/modelId)
 * @returns The best available slow model, or undefined if none found
 */
export async function findSlowModel(
	modelRegistry: ModelLookupRegistry,
	savedModel?: string,
): Promise<Model<Api> | undefined> {
	const availableModels = modelRegistry.getAvailable();
	if (availableModels.length === 0) return undefined;

	// 1. Try saved model from settings
	if (savedModel) {
		const match = resolveModelFromString(savedModel, availableModels, undefined, modelRegistry);
		if (match) return match;
	}

	// 2. Try priority chain
	for (const pattern of MODEL_PRIO.slow) {
		// Try exact match first
		const exactMatch = parseModelPattern(pattern, availableModels, undefined, { modelRegistry }).model;
		if (exactMatch) return exactMatch;

		// Try fuzzy match (substring)
		const fuzzyMatch = availableModels.find(m => m.id.toLowerCase().includes(pattern.toLowerCase()));
		if (fuzzyMatch) return fuzzyMatch;
	}

	// 3. Fallback to first available (same as default)
	return availableModels[0];
}
