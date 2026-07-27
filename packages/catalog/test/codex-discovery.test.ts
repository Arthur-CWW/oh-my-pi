import { describe, expect, it } from "bun:test";
import { fetchCodexModels } from "../src/discovery/codex";

describe("Codex discovery", () => {
	it("preserves ordered exact effort presets and live model capabilities", async () => {
		const result = await fetchCodexModels({
			accessToken: "test-token",
			baseUrl: "https://api.example.com",
			clientVersion: "0.99.0",
			fetchFn: async () => new Response(JSON.stringify({ models: [{
				slug: "gpt-live", display_name: "Live", description: "Catalog description", context_window: 500_000,
				default_reasoning_level: "ultra", supported_reasoning_levels: ["none", "low", "medium", "high", "xhigh", "max", "ultra", "custom"].map(effort => ({ effort, description: `${effort} description` })),
				visibility: "hide", supported_in_api: true, priority: 3, shell_type: "unified_exec", additional_speed_tiers: ["fast"], service_tiers: [{ id: "custom-tier", name: "Custom", description: "Tier description" }], default_service_tier: "custom-tier",
				availability_nux: { message: "Available" }, upgrade: { model: "gpt-next", migration_markdown: "Upgrade" }, base_instructions: "Instructions", include_skills_usage_instructions: true, supports_reasoning_summaries: true, default_reasoning_summary: "detailed", support_verbosity: true, default_verbosity: "high", apply_patch_tool_type: "freeform", web_search_tool_type: "text_and_image", truncation_policy: { mode: "tokens", limit: 10_000 }, supports_parallel_tool_calls: true, supports_image_detail_original: true, max_context_window: 600_000, auto_compact_token_limit: 400_000, comp_hash: "hash", effective_context_window_percent: 90, experimental_supported_tools: ["tool"], input_modalities: ["text"], supports_search_tool: true, use_responses_lite: true, auto_review_model_override: "gpt-review", tool_mode: "code_mode", multi_agent_version: "v1",
			}] }), { status: 200, headers: { "Content-Type": "application/json", ETag: "catalog-tag" } }),
		});

		const model = result?.models[0];
		expect(result?.etag).toBe("catalog-tag");
		expect(model?.thinking).toEqual({ mode: "effort", efforts: ["none", "low", "medium", "high", "xhigh", "max", "ultra", "custom"], presets: ["none", "low", "medium", "high", "xhigh", "max", "ultra", "custom"].map(effort => ({ effort, description: `${effort} description` })), defaultLevel: "ultra" });
		expect(model?.hidden).toBe(true);
		expect(model?.codex).toMatchObject({ description: "Catalog description", defaultReasoningLevel: "ultra", visibility: "hide", supportedInApi: true, shellType: "unified_exec", additionalSpeedTiers: ["fast"], serviceTiers: [{ id: "custom-tier", name: "Custom", description: "Tier description" }], defaultServiceTier: "custom-tier", availabilityNuxMessage: "Available", upgrade: { model: "gpt-next", migrationMarkdown: "Upgrade" }, baseInstructions: "Instructions", includeSkillsUsageInstructions: true, supportsReasoningSummaries: true, defaultReasoningSummary: "detailed", supportsVerbosity: true, defaultVerbosity: "high", applyPatchToolType: "freeform", webSearchToolType: "text_and_image", maxContextWindow: 600_000, autoCompactTokenLimit: 400_000, compactionHash: "hash", effectiveContextWindowPercent: 90, experimentalSupportedTools: ["tool"], supportsSearchTool: true, useResponsesLite: true, autoReviewModelOverride: "gpt-review", toolMode: "code_mode", multiAgentVersion: "v1", truncationPolicy: { mode: "tokens", limit: 10_000 }, supportsParallelToolCalls: true, supportsImageDetailOriginal: true, contextWindowSource: "endpoint", maxTokensSource: "fallback", costSource: "fallback" });
		expect([model?.contextWindow, model?.maxTokens]).toEqual([500_000, 128_000]);
	});

	it("uses explicit fallbacks only when endpoint limits are absent", async () => {
		const result = await fetchCodexModels({ accessToken: "test-token", baseUrl: "https://api.example.com", clientVersion: "0.99.0", fetchFn: async () => new Response(JSON.stringify({ models: [{ slug: "fallback", supported_reasoning_levels: [{ effort: "custom" }] }] }), { status: 200 }) });
		expect(result?.models[0]).toMatchObject({ contextWindow: 272_000, maxTokens: 128_000, codex: { contextWindowSource: "fallback", maxTokensSource: "fallback", costSource: "fallback" } });
	});

	it("keeps hidden models resolvable while excluding API-ineligible models", async () => {
		const result = await fetchCodexModels({ accessToken: "test-token", baseUrl: "https://api.example.com", clientVersion: "0.99.0", fetchFn: async () => new Response(JSON.stringify({ models: [{ slug: "hidden", visibility: "hide", supported_in_api: true }, { slug: "ineligible", supported_in_api: false }] }), { status: 200 }) });
		expect(result?.models).toHaveLength(1);
		expect(result?.models[0]).toMatchObject({ id: "hidden", hidden: true });
	});

	it("projects Ultra orchestration separately from reasoning effort", async () => {
		const result = await fetchCodexModels({ accessToken: "test-token", baseUrl: "https://api.example.com", clientVersion: "0.99.0", fetchFn: async () => new Response(JSON.stringify({ models: [{ slug: "sol", supported_in_api: true, multi_agent_version: "v2", supported_reasoning_levels: [{ effort: "max", description: "Maximum" }] }] }), { status: 200 }) });
		expect(result?.models[0]).toMatchObject({ thinking: { efforts: ["max"] }, codex: { multiAgentVersion: "v2", supportsUltraOrchestration: true } });
	});
});
