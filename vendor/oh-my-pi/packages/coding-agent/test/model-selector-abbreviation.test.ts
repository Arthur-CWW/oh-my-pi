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
		["openai-codex/gpt-5.6-sol:xhigh", "OX5.6sol xh", "codex 5.6sol xhigh"],
		["openai-codex/gpt-5.6-terra:high", "OX5.6terra h", "codex 5.6terra high"],
		["openai-codex/gpt-5.6-luna:medium", "OX5.6luna m", "codex 5.6luna medium"],
		["openai-codex/gpt-5.6-fable:low", "OX5.6fable l", "codex 5.6fable low"],
		["openai/gpt-5.1-codex:high", "OA5.1codex h", "openai 5.1codex high"],
		["anthropic/claude-sonnet-4-6:low", "AN4.6sonnet l", "anthropic 4.6sonnet low"],
		["anthropic/claude-opus-4-8:minimal", "AN4.8opus mn", "anthropic 4.8opus minimal"],
		["anthropic/claude-haiku-4-5:off", "AN4.5haiku 0", "anthropic 4.5haiku off"],
		["kimi-code/kimi-for-coding:high", "KMkimi h", "kimi kimi high"],
		["google-antigravity/gemini-3.5-flash:low", "GA3.5flash l", "antigravity 3.5flash low"],
		["deepseek/deepseek-v4-pro:medium", "DS4pro m", "deepseek 4pro medium"],
		["qwen-portal/qwen3-coder:high", "QW3coder h", "qwen 3coder high"],
		["zai/glm-4.7:medium", "ZA4.7glm m", "zai 4.7glm medium"],
		["xai/grok-4:high", "XA4grok h", "xai 4grok high"],
		["ollama/llama-4:low", "OL4llama l", "ollama 4llama low"],
		["mistral/codestral-25.01:low", "MI25.01codestral l", "mistral 25.01codestral low"],
	] as const)("renders both tiers for %s", (selector, compact, standalone) => {
		expect(Bun.stripANSI(renderModelSelectorAbbreviation(selector, "compact"))).toBe(compact);
		expect(Bun.stripANSI(renderModelSelectorAbbreviation(selector, "standalone"))).toBe(standalone);
	});

	it("returns tier-specific segments without single-letter variants", () => {
		expect(formatModelSelectorAbbreviation("openai-codex/gpt-5.6-sol:xhigh", "compact")).toEqual({
			provider: "OX",
			model: "5.6sol",
			effort: "xh",
		});
		expect(formatModelSelectorAbbreviation("openai-codex/gpt-5.6-sol:xhigh", "standalone")).toEqual({
			provider: "codex",
			model: "5.6sol",
			effort: "xhigh",
		});
	});

	it("adds receipt effort without duplicating an explicit suffix", () => {
		expect(withModelSelectorEffort("openai-codex/gpt-5.6-sol", "xhigh")).toBe("openai-codex/gpt-5.6-sol:xhigh");
		expect(withModelSelectorEffort("openai-codex/gpt-5.6-sol:high", "xhigh")).toBe("openai-codex/gpt-5.6-sol:high");
	});
});
