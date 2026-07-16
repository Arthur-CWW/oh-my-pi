import { beforeAll, describe, expect, it } from "bun:test";
import type { SegmentContext } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import { renderSegment } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import { initTheme, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

function createModelContext(advisorActive: boolean): SegmentContext {
	return {
		session: {
			state: {
				model: { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "openai-codex", thinking: true },
				thinkingLevel: "xhigh",
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
		expect(Bun.stripANSI(rendered.content)).toContain("SOX5.6xh");
		// The badge carries the success color, kept distinct from the statusLineModel
		// name color (which several themes alias to `accent`).
		expect(rendered.content).toContain(theme.fg("success", "++"));
	});

	it("omits the badge when the advisor is inactive", () => {
		const rendered = renderSegment("model", createModelContext(false));
		expect(Bun.stripANSI(rendered.content)).toContain("SOX5.6xh");
		expect(rendered.content).not.toContain("++");
	});
});
