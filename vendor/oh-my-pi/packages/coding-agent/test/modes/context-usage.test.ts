/**
 * Contract: tool schema token estimation reflects the wire JSON Schema.
 *
 * Tools authored with Zod must be counted by the JSON Schema providers
 * actually receive — not by stringifying the Zod instance's enumerable
 * internals (`def` tree), which massively overcounts.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { zodToWireSchema } from "@oh-my-pi/pi-ai/utils/schema";
import type { ContextUsage } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { initTheme, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import {
	type ContextBreakdown,
	computeContextBreakdown,
	estimateToolSchemaTokens,
	renderContextUsage,
} from "@oh-my-pi/pi-coding-agent/modes/utils/context-usage";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
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
			percent: (27929 / 200000) * 100,
			autoCompactBufferTokens: 0,
			freeTokens: 172071,
			estimatedRetainedTokens: 27929,
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
			percent: 0,
			autoCompactBufferTokens: 0,
			freeTokens: contextWindow,
			estimatedRetainedTokens: 0,
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

/**
 * Contract: the /context panel's headline used/window/percent/free numbers are
 * the provider-anchored authority from session.getContextUsage() — identical to
 * the status line — while the per-category counts are a clearly-labeled,
 * separate retained-text estimate. The two can diverge sharply (e.g. a 557K
 * transcript estimate against 62.8% real provider usage); the headline must
 * follow the provider, never the estimate sum.
 */
describe("renderContextUsage provider-anchored authority", () => {
	const contextWindow = 272_000;
	// 62.8% of the 272K window, against a 557K retained-text estimate.
	const providerUsed = Math.round(0.628 * contextWindow); // 170_816

	function divergentBreakdown(percent: number | null): ContextBreakdown {
		return {
			model: { id: "claude-test", name: "Claude Test", contextWindow } as never,
			contextWindow,
			categories: [
				{ id: "messages", label: "Messages", tokens: 557_000, color: "userMessageText", glyph: "⛃" } as never,
			],
			usedTokens: percent === null ? 557_000 : providerUsed,
			percent,
			autoCompactBufferTokens: 0,
			freeTokens: percent === null ? 0 : contextWindow - providerUsed,
			estimatedRetainedTokens: 557_000,
		};
	}

	function plainRender(breakdown: ContextBreakdown): string {
		return renderContextUsage(breakdown, theme).replaceAll(/\x1b\[[0-9;]*m/g, "");
	}

	it("puts the provider percent in the headline, not the 557K estimate sum", () => {
		const plain = plainRender(divergentBreakdown((providerUsed / contextWindow) * 100));
		// Headline used/window/percent is the provider-anchored 62.8%, matching the status line.
		expect(plain).toContain("171K/272k tokens (62.8%)");
		// The 557K estimate is surfaced separately and clearly labeled — never as the headline.
		expect(plain).toContain("Retained-text estimate: 557K");
		// Free space anchors on the provider count (272K − 171K), not (272K − 557K) → never 0/negative.
		expect(plain).toContain("Free space: 101K");
	});

	it("shows unknown — not a fabricated percent — while the provider count is unknown", () => {
		const plain = plainRender(divergentBreakdown(null));
		// Post-compaction: the headline stays unknown until the next response.
		expect(plain).toContain("unknown/272k tokens (unknown until next response)");
		expect(plain).toContain("Free space: unknown");
		// The retained-text estimate is still surfaced separately.
		expect(plain).toContain("Retained-text estimate: 557K");
	});

	it("reports genuine over-window usage honestly (percent > 100%, no free space)", () => {
		const over: ContextBreakdown = {
			model: { id: "m", name: "M", contextWindow } as never,
			contextWindow,
			categories: [],
			usedTokens: 300_000,
			percent: (300_000 / contextWindow) * 100,
			autoCompactBufferTokens: 0,
			freeTokens: 0,
			estimatedRetainedTokens: 120_000,
		};
		const plain = plainRender(over);
		expect(plain).toContain("300K/272k tokens (110.3%)");
		expect(plain).toContain("Free space: 0 (0.0%)");
	});
});

/**
 * Contract: computeContextBreakdown reads its headline numbers straight from
 * session.getContextUsage() (provider-anchored) and keeps the per-category
 * transcript estimate independent in `estimatedRetainedTokens`. A null provider
 * count (right after compaction) stays unknown (percent null).
 */
function makeBreakdownSession(opts: {
	usage: ContextUsage | undefined;
	messages?: unknown[];
	contextWindow?: number;
}): AgentSession {
	const contextWindow = opts.contextWindow ?? 272_000;
	return {
		model: { id: "test-model", name: "Test", contextWindow },
		messages: opts.messages ?? [{ role: "user", content: "hi" }],
		systemPrompt: ["You are a helpful assistant."],
		skills: [],
		agent: { state: { tools: [] } },
		settings: { getGroup: () => ({ enabled: false, strategy: "off" }) },
		getContextUsage: () => opts.usage,
	} as unknown as AgentSession;
}

describe("computeContextBreakdown provider anchoring", () => {
	it("uses the provider count for usedTokens/percent/free, keeping the estimate separate", () => {
		const contextWindow = 272_000;
		const providerTokens = 170_816; // 62.8% of the window
		const breakdown = computeContextBreakdown(
			makeBreakdownSession({
				usage: { tokens: providerTokens, contextWindow, percent: (providerTokens / contextWindow) * 100 },
				contextWindow,
			}),
		);
		expect(breakdown.usedTokens).toBe(providerTokens);
		expect(breakdown.percent).toBeCloseTo(62.8, 5);
		// The transcript estimate is computed independently and does not drive the headline.
		expect(breakdown.estimatedRetainedTokens).not.toBe(providerTokens);
		// Free space follows the provider count, never the estimate sum.
		expect(breakdown.freeTokens).toBe(contextWindow - providerTokens);
	});

	it("keeps the count unknown (percent null) right after compaction", () => {
		const contextWindow = 272_000;
		const breakdown = computeContextBreakdown(
			makeBreakdownSession({ usage: { tokens: null, contextWindow, percent: null }, contextWindow }),
		);
		expect(breakdown.percent).toBeNull();
		// The retained-text estimate is still surfaced for the panel's category section.
		expect(breakdown.estimatedRetainedTokens).toBeGreaterThanOrEqual(0);
	});
});
