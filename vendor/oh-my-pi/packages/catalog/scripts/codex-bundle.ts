import { z } from "zod/v4";
import { CODEX_BASE_URL } from "../src/wire/codex";
import { normalizeCodexModels } from "../src/discovery/codex";
import type { CodexModelCapabilities, ModelSpec } from "../src/types";

export const CODEX_BUNDLE_SOURCE_PATH = "vendor/openai/codex/codex-rs/models-manager/models.json";
const CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 95;
const CODEX_AUTO_COMPACT_PERCENT = 90;
const OMP_MAX_OUTPUT_FALLBACK = 128_000;

const codexBundlePayloadSchema = z
	.object({
		models: z.array(
			z
				.object({
					slug: z.string(),
					context_window: z.number(),
				})
				.loose(),
		),
	})
	.loose();

export type CodexBundlePayload = z.infer<typeof codexBundlePayloadSchema>;

export function decodeCodexBundlePayload(payload: unknown): CodexBundlePayload {
	const parsed = codexBundlePayloadSchema.safeParse(payload);
	if (!parsed.success) {
		throw new Error(`Invalid Codex bundle at ${CODEX_BUNDLE_SOURCE_PATH}: ${z.prettifyError(parsed.error)}`);
	}
	return parsed.data;
}

function bundledModels(payload: CodexBundlePayload): ModelSpec<"openai-codex-responses">[] {
	const models = normalizeCodexModels(payload, CODEX_BASE_URL);
	if (models === null) {
		throw new Error(`Invalid Codex bundle at ${CODEX_BUNDLE_SOURCE_PATH}`);
	}
	return models;
}

function bundledCapabilities(model: ModelSpec<"openai-codex-responses">): CodexModelCapabilities {
	const {
		contextWindowSource: _contextWindowSource,
		maxTokensSource: _maxTokensSource,
		costSource: _costSource,
		...metadata
	} = model.codex ?? {};
	const rawContextWindow = model.contextWindow;
	if (rawContextWindow === null) {
		throw new Error(`Codex bundle model ${model.id} has no context window`);
	}
	return {
		...metadata,
		maxContextWindow: metadata.maxContextWindow ?? rawContextWindow,
		effectiveContextWindowPercent:
			metadata.effectiveContextWindowPercent ?? CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
		autoCompactTokenLimit:
			metadata.autoCompactTokenLimit ?? Math.floor((rawContextWindow * CODEX_AUTO_COMPACT_PERCENT) / 100),
	};
}

export function applyCodexBundle(
	models: ModelSpec[],
	payload: CodexBundlePayload,
	commit: string,
	liveModels: readonly ModelSpec<"openai-codex-responses">[] | null,
): void {
	const liveById = new Map((liveModels ?? []).map(model => [model.id, model]));
	for (const bundled of bundledModels(payload)) {
		let target = models.find(model => model.provider === "openai-codex" && model.id === bundled.id);
		if (!target) {
			target = bundled;
			models.push(target);
		}

		const rawContextWindow = bundled.contextWindow;
		if (rawContextWindow === null) {
			throw new Error(`Codex bundle model ${bundled.id} has no context window`);
		}
		const metadata = bundledCapabilities(bundled);
		const effectiveContextWindowPercent = metadata.effectiveContextWindowPercent ?? CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT;
		const autoCompactTokenLimit = metadata.autoCompactTokenLimit ?? Math.floor((rawContextWindow * CODEX_AUTO_COMPACT_PERCENT) / 100);
		const live = liveById.get(bundled.id);

		target.name = bundled.name;
		target.api = bundled.api;
		target.provider = bundled.provider;
		target.baseUrl = bundled.baseUrl;
		target.reasoning = bundled.reasoning;
		target.thinking = bundled.thinking;
		target.input = bundled.input;
		target.contextWindow = rawContextWindow;
		target.maxTokens = Math.min(OMP_MAX_OUTPUT_FALLBACK, rawContextWindow);
		target.omitMaxOutputTokens = true;
		target.applyPatchToolType = bundled.applyPatchToolType;
		target.preferWebsockets = bundled.preferWebsockets;
		target.priority = bundled.priority;
		if (live?.codex) {
			target.codex = live.codex;
		} else {
			delete target.codex;
		}
		target.codexCatalog = {
			codexBundled: {
				source: "vendored-codex-models-json",
				path: CODEX_BUNDLE_SOURCE_PATH,
				commit,
				rawContextWindow,
				effectiveContextWindowPercent,
				effectiveInputTokens: Math.floor((rawContextWindow * effectiveContextWindowPercent) / 100),
				autoCompactTokenLimit,
				metadata,
			},
			liveAccountEligibility: {
				source: "live-account-catalog",
				status: live ? "listed" : liveModels === null ? "not-queried" : "not-listed",
				officialPickerParity: live !== undefined,
			},
			ompPolicy: {
				source: "omp-policy",
				visibility: live ? "picker" : "bundled/direct-only",
				pricing: "omp-policy",
				maxOutput: {
					value: target.maxTokens,
					source: "omp-fallback",
					sentToEndpoint: false,
				},
			},
		};
	}
}

export function findCodexBundleDrift(
	generated: Record<string, Record<string, ModelSpec>>,
	payload: CodexBundlePayload,
	commit: string,
): string[] {
	const drift: string[] = [];
	const generatedModels = generated["openai-codex"] ?? {};
	for (const bundled of bundledModels(payload)) {
		const actual = generatedModels[bundled.id];
		if (!actual) {
			drift.push(`${bundled.id}: missing generated openai-codex entry`);
			continue;
		}
		const rawContextWindow = bundled.contextWindow;
		if (rawContextWindow === null) {
			drift.push(`${bundled.id}: vendored entry has no context window`);
			continue;
		}
		const metadata = bundledCapabilities(bundled);
		const percent = metadata.effectiveContextWindowPercent ?? CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT;
		const expected = {
			commit,
			rawContextWindow,
			effectiveContextWindowPercent: percent,
			effectiveInputTokens: Math.floor((rawContextWindow * percent) / 100),
			autoCompactTokenLimit:
				metadata.autoCompactTokenLimit ?? Math.floor((rawContextWindow * CODEX_AUTO_COMPACT_PERCENT) / 100),
			metadata,
		};
		const actualBundle = actual.codexCatalog?.codexBundled;
		if (JSON.stringify(actualBundle ? {
			commit: actualBundle.commit,
			rawContextWindow: actualBundle.rawContextWindow,
			effectiveContextWindowPercent: actualBundle.effectiveContextWindowPercent,
			effectiveInputTokens: actualBundle.effectiveInputTokens,
			autoCompactTokenLimit: actualBundle.autoCompactTokenLimit,
			metadata: actualBundle.metadata,
		} : null) !== JSON.stringify(expected)) {
			drift.push(`${bundled.id}: generated bundled metadata differs from vendored Codex`);
		}
		if (actual.contextWindow !== rawContextWindow) {
			drift.push(`${bundled.id}: contextWindow ${actual.contextWindow} != ${rawContextWindow}`);
		}
		if (actual.maxTokens !== Math.min(OMP_MAX_OUTPUT_FALLBACK, rawContextWindow)) {
			drift.push(`${bundled.id}: OMP maxTokens fallback is stale`);
		}
		if (actual.omitMaxOutputTokens !== true || actual.codexCatalog?.ompPolicy.maxOutput.source !== "omp-fallback") {
			drift.push(`${bundled.id}: OMP max-output fallback is not labeled and omitted on wire`);
		}
	}
	return drift;
}
