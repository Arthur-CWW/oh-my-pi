import { afterAll, beforeAll, describe, expect, it, setSystemTime } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { StatusLineComponent } from "@oh-my-pi/pi-coding-agent/modes/components/status-line";
import { getPreset } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/presets";
import type { StatusLinePreset } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/types";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

const PRESETS: readonly StatusLinePreset[] = ["default", "minimal", "compact", "full", "nerd", "ascii", "custom"];

beforeAll(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
	await initTheme();
});

afterAll(() => {
	setSystemTime();
	resetSettingsForTest();
});

function createStreamingSession() {
	const messages = [
		{
			role: "assistant",
			content: [{ type: "text", text: "streaming" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-sonnet-4.5",
			usage: {
				input: 10,
				output: 60,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 70,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 1_000,
		},
	];
	return {
		state: { model: { name: "Sonnet 4", id: "claude-sonnet-4", contextWindow: 200_000 }, messages },
		isStreaming: true,
		isFastModeActive: () => false,
		isFastModeEnabled: () => false,
		isAdvisorActive: () => false,
		isAutoThinking: false,
		autoResolvedThinkingLevel: () => undefined,
		thinkingLevel: undefined,
		getAsyncJobSnapshot: () => ({ running: [] }),
		getCurrentModel: () => ({ name: "Sonnet 4", id: "claude-sonnet-4" }),
		getContextUsage: () => ({ tokens: 100_000, contextWindow: 200_000 }),
		model: { name: "Sonnet 4", id: "claude-sonnet-4", contextWindow: 200_000 },
		messages,
		modelRegistry: { isUsingOAuth: () => false },
		sessionManager: {
			getSessionName: () => "live-rate-test",
			getSessionId: () => "live-rate-test-id",
			getCwd: () => "/tmp/live-rate-test",
			getUsageStatistics: () => ({
				input: 10,
				output: 60,
				cacheRead: 0,
				cacheWrite: 0,
				premiumRequests: 0,
				cost: 0.0123,
			}),
		},
		autoCompactionEnabled: false,
	} as unknown as ConstructorParameters<typeof StatusLineComponent>[0];
}

function renderStatus(component: StatusLineComponent, preset: StatusLinePreset): string {
	const content = preset === "compact" ? component.render(500)[0] : component.getTopBorder(500).content;
	return stripVTControlCharacters(content ?? "");
}

describe("memoized live token-rate segment", () => {
	for (const preset of PRESETS) {
		it(`${preset} includes tok/s and refreshes it on the one-second live bucket`, () => {
			expect([...getPreset(preset).leftSegments, ...getPreset(preset).rightSegments]).toContain("token_rate");
			const component = new StatusLineComponent(createStreamingSession());
			component.updateSettings({ preset });
			try {
				setSystemTime(new Date(4_000));
				const first = renderStatus(component, preset);
				expect(first).toContain("20.0 tok/s");

				setSystemTime(new Date(5_000));
				const second = renderStatus(component, preset);
				expect(second).toContain("15.0 tok/s");
				expect(second).not.toBe(first);
			} finally {
				component.dispose();
				setSystemTime();
			}
		});
	}
});

describe("compact information density", () => {
	it("keeps the high-value model, context, throughput, cost, and branch segments", () => {
		const preset = getPreset("compact");
		const segments = [...preset.leftSegments, ...preset.rightSegments];
		for (const segment of ["model", "context_pct", "token_rate", "cost", "git"] as const) {
			expect(segments).toContain(segment);
		}
	});
});
