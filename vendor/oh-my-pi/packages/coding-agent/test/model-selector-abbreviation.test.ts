import { beforeAll, describe, expect, it } from "bun:test";
import {
	formatModelSelectorAbbreviation,
	renderModelSelectorAbbreviation,
	withModelSelectorEffort,
} from "@oh-my-pi/pi-coding-agent/modes/components/model-selector-abbreviation";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

describe("model selector abbreviation", () => {
	it.each([
		["openai-codex/gpt-5.6-sol:xhigh", ["S", "OX", "5.6", "xh"]],
		["openai-codex/gpt-5.6-terra:high", ["T", "OX", "5.6", "h"]],
		["openai-codex/gpt-5.6-luna:medium", ["L", "OX", "5.6", "m"]],
		["anthropic/claude-sonnet-4-6:low", ["S", "AN", "4.6", "l"]],
		["anthropic/claude-opus-4-8:minimal", ["O", "AN", "4.8", "mn"]],
		["anthropic/claude-haiku-4-5:off", ["H", "AN", "4.5", "0"]],
		["kimi-code/kimi-for-coding:high", ["K", "KM", "", "h"]],
		["google-antigravity/gemini-3.5-flash:low", ["F", "GA", "3.5", "l"]],
		["deepseek/deepseek-v4-pro:medium", ["P", "DS", "4", "m"]],
		["qwen-portal/qwen3-coder:high", ["C", "QW", "3", "h"]],
		["xai/grok-4:high", ["G", "XA", "4", "h"]],
		["mistral/codestral-25.01:low", ["C", "MI", "25.01", "l"]],
	] as const)("formats %s", (selector, expected) => {
		const value = formatModelSelectorAbbreviation(selector);
		expect([value.laneAbbrev, value.providerAbbrev, value.version, value.effortAbbrev]).toEqual([...expected]);
	});

	it("renders four compressed segments without separators", () => {
		expect(Bun.stripANSI(renderModelSelectorAbbreviation("openai-codex/gpt-5.6-sol:xhigh"))).toBe("SOX5.6xh");
	});

	it("adds receipt effort without duplicating an explicit suffix", () => {
		expect(withModelSelectorEffort("openai-codex/gpt-5.6-sol", "xhigh")).toBe("openai-codex/gpt-5.6-sol:xhigh");
		expect(withModelSelectorEffort("openai-codex/gpt-5.6-sol:high", "xhigh")).toBe("openai-codex/gpt-5.6-sol:high");
	});
});
