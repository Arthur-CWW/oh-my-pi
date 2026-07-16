import { beforeAll, describe, expect, it } from "bun:test";
import type { SegmentContext } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import { renderSegment } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import { initTheme, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

function createModelContext(
	advisorActive: boolean,
	options: {
		provider?: string;
		id?: string;
		thinking?: boolean;
		reasoning?: boolean;
		thinkingLevel?: string;
	} = {},
): SegmentContext {
	return {
		session: {
			state: {
				model: {
					id: options.id ?? "gpt-5.6-sol",
					name: "Test model",
					provider: options.provider ?? "openai-codex",
					thinking: options.thinking ?? true,
					reasoning: options.reasoning,
				},
				thinkingLevel: options.thinkingLevel ?? "xhigh",
			},
			isFastModeActive: () => false,
			isAutoThinking: false,
			autoResolvedThinkingLevel: () => undefined,
			isAdvisorActive: () => advisorActive,
		} as unknown as SegmentContext["session"],
		width: 120,
		options: {},
		planMode: null,
		loopMode: null,
		goalMode: null,
		collab: null,
		usageStats: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			premiumRequests: 0,
			cost: 0,
		},
		contextPercent: 0,
		contextWindow: 0,
		autoCompactEnabled: false,
		subagentCount: 0,
		sessionStartTime: Date.now(),
		git: { branch: null, status: null, pr: null },
		usage: null,
	};
}

describe("status line model segment advisor badge", () => {
	it("appends a success-colored ++ badge when the advisor is active", () => {
		const rendered = renderSegment("model", createModelContext(true));
		expect(Bun.stripANSI(rendered.content)).toContain("5.6sol xh");
		// The badge carries the success color, kept distinct from the statusLineModel
		// name color (which several themes alias to `accent`).
		expect(rendered.content).toContain(theme.fg("success", "++"));
	});

	it("omits the badge when the advisor is inactive", () => {
		const rendered = renderSegment("model", createModelContext(false));
		expect(Bun.stripANSI(rendered.content)).toContain("5.6sol xh");
		expect(rendered.content).not.toContain("++");
	});

	it("renders anthropic model names with compact medium effort and no provider", () => {
		const rendered = renderSegment(
			"model",
			createModelContext(false, {
				provider: "anthropic",
				id: "claude-fable-5",
				thinkingLevel: "medium",
			}),
		);
		const text = Bun.stripANSI(rendered.content);
		expect(text).toContain("5fable m");
		expect(text).not.toContain("anthropic");
	});

	it("omits the effort label for non-reasoning models", () => {
		const rendered = renderSegment(
			"model",
			createModelContext(false, {
				provider: "anthropic",
				id: "claude-fable-5",
				thinking: false,
				reasoning: false,
				thinkingLevel: "off",
			}),
		);
		const text = Bun.stripANSI(rendered.content);
		expect(text).toContain("5fable");
		expect(text).not.toMatch(/\s(?:[a-z]+|xh)$/);
	});
});
