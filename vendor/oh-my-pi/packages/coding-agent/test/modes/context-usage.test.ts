/**
 * Contract: tool schema token estimation reflects the wire JSON Schema.
 *
 * Tools authored with Zod must be counted by the JSON Schema providers
 * actually receive — not by stringifying the Zod instance's enumerable
 * internals (`def` tree), which massively overcounts.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { zodToWireSchema } from "@oh-my-pi/pi-ai/utils/schema";
import { initTheme, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import {
	type ContextBreakdown,
	estimateToolSchemaTokens,
	renderContextUsage,
} from "@oh-my-pi/pi-coding-agent/modes/utils/context-usage";
import { z } from "zod/v4";

beforeAll(async () => {
	await initTheme();
});

describe("estimateToolSchemaTokens", () => {
	it("counts Zod tool schemas by their wire JSON Schema, not Zod internals", () => {
		const parameters = z.object({
			query: z.string().describe("search query"),
			limit: z.number().optional(),
		});
		const zodEstimate = estimateToolSchemaTokens([
			{ name: "web_search", description: "Searches the web.", parameters } as never,
		]);
		const wireEstimate = estimateToolSchemaTokens([
			{ name: "web_search", description: "Searches the web.", parameters: zodToWireSchema(parameters) } as never,
		]);
		expect(zodEstimate).toBe(wireEstimate);
	});
});

/**
 * Contract: the /context panel surfaces estimated snapcompact wire savings —
 * applied swaps show "saves" figures, inactive states say why.
 */
describe("renderContextUsage snapcompact section", () => {
	const themeStub = {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	} as never;

	function breakdownWith(snapcompact: ContextBreakdown["snapcompact"]): ContextBreakdown {
		return {
			model: { id: "test-model", name: "Test Model", contextWindow: 200000 } as never,
			contextWindow: 200000,
			categories: [],
			usedTokens: 27929,
			autoCompactBufferTokens: 0,
			freeTokens: 172071,
			snapcompact,
		};
	}

	it("renders savings, skip reasons, and the wire total", () => {
		const output = renderContextUsage(
			breakdownWith({
				visionCapable: true,
				systemPrompt: {
					applied: true,
					scope: "all",
					textTokens: 9768,
					frames: 2,
					imageTokens: 6600,
					savedTokens: 3168,
				},
				toolResults: { total: 3, swapped: 0, textTokens: 0, frames: 0, imageTokens: 0, savedTokens: 0 },
				savedTokens: 3168,
			}),
			themeStub,
		);
		expect(output).toContain("Snapcompact (estimated wire savings)");
		expect(output).toContain("System prompt (all): saves ~3.2K (9.8K text → 2 frames ≈ 6.6K)");
		expect(output).toContain("Tool results: none imaged (3 in history)");
		// 27929 logical − 3168 saved ≈ 25K on the wire.
		expect(output).toContain("Next request: ~25K tokens on the wire");
	});

	it("reports text-only models as inactive", () => {
		const output = renderContextUsage(breakdownWith({ visionCapable: false, savedTokens: 0 }), themeStub);
		expect(output).toContain("Snapcompact: inactive (model has no image input)");
	});

	it("omits the section entirely when no snapcompact setting is on", () => {
		const output = renderContextUsage(breakdownWith(undefined), themeStub);
		expect(output).not.toContain("Snapcompact");
	});
});

describe("renderContextUsage model provenance", () => {
	function breakdown(model: ContextBreakdown["model"], contextWindow: number): ContextBreakdown {
		return {
			model,
			contextWindow,
			categories: [],
			usedTokens: 0,
			autoCompactBufferTokens: 0,
			freeTokens: contextWindow,
		};
	}

	it("labels a user-overridden Codex window in the model header", () => {
		const model = {
			id: "gpt-5.6",
			name: "GPT-5.6",
			contextWindow: 372_000,
			codex: { contextWindowSource: "user-override" },
		} as ContextBreakdown["model"];

		expect(renderContextUsage(breakdown(model, 372_000), theme)).toContain("372K (user override)");
	});

	it("preserves the existing non-Codex model header", () => {
		const model = { id: "test-model", name: "Test Model", contextWindow: 372_000 } as ContextBreakdown["model"];

		const output = renderContextUsage(breakdown(model, 372_000), theme).replaceAll(/\x1b\[[0-9;]*m/g, "");
		expect(output).toContain("Test Model (372k context)");
		expect(output).not.toContain("user override");
	});
});
