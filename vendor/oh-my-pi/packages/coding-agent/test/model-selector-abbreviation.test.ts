import { beforeAll, describe, expect, it } from "bun:test";
import {
	formatModelSelectorAbbreviation,
	renderModelSelectorAbbreviation,
	renderModelSelectorStatusLabel,
	withModelSelectorEffort,
} from "@oh-my-pi/pi-coding-agent/modes/components/model-selector-abbreviation";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

describe("model selector abbreviation", () => {
	it.each([
		["openai-codex/gpt-5.6-sol:xhigh", "OX5.6solxh", "codex 5.6sol xhigh"],
		["openai-codex/gpt-5.6-terra:high", "OX5.6terrah", "codex 5.6terra high"],
		["openai-codex/gpt-5.6-luna:medium", "OX5.6lunam", "codex 5.6luna medium"],
		["openai-codex/gpt-5.6-fable:low", "OX5.6fablel", "codex 5.6fable low"],
		["openai/gpt-5.1-codex:high", "OA5.1codexh", "openai 5.1codex high"],
		["anthropic/claude-sonnet-4-6:low", "AN4.6sonnetl", "anthropic 4.6sonnet low"],
		["anthropic/claude-opus-4-8:minimal", "AN4.8opusmn", "anthropic 4.8opus minimal"],
		["anthropic/claude-haiku-4-5:off", "AN4.5haiku0", "anthropic 4.5haiku off"],
		["kimi-code/kimi-for-coding:high", "KMkimih", "kimi kimi high"],
		["google-antigravity/gemini-3.5-flash:low", "GA3.5flashl", "antigravity 3.5flash low"],
		["deepseek/deepseek-v4-pro:medium", "DS4prom", "deepseek 4pro medium"],
		["qwen-portal/qwen3-coder:high", "QW3coderh", "qwen 3coder high"],
		["zai/glm-4.7:medium", "ZA4.7glmm", "zai 4.7glm medium"],
		["xai/grok-4:high", "XA4grokh", "xai 4grok high"],
		["ollama/llama-4:low", "OL4llamal", "ollama 4llama low"],
		["mistral/codestral-25.01:low", "MI25.01codestrall", "mistral 25.01codestral low"],
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
	it("renders status labels with compact effort and no provider", () => {
		expect(Bun.stripANSI(renderModelSelectorStatusLabel("anthropic/claude-fable-5:medium"))).toBe("5fable m");
		expect(Bun.stripANSI(renderModelSelectorStatusLabel("openai-codex/gpt-5.6-sol:xhigh"))).toBe("5.6sol xh");
	});

	it("omits off and none from status labels", () => {
		expect(Bun.stripANSI(renderModelSelectorStatusLabel("anthropic/claude-fable-5:off"))).toBe("5fable");
		expect(Bun.stripANSI(renderModelSelectorStatusLabel("anthropic/claude-fable-5:none"))).toBe("5fable");
	});

	it("resolves every row's effective effort from runtime state, model default, or capability", () => {
		expect(withModelSelectorEffort("openai-codex/gpt-5.6-sol", { modelDefault: "medium", reasoning: true })).toBe(
			"openai-codex/gpt-5.6-sol:medium",
		);
		expect(withModelSelectorEffort("openai-codex/gpt-5.6-luna:high", { session: "xhigh" })).toBe(
			"openai-codex/gpt-5.6-luna:xhigh",
		);
		expect(withModelSelectorEffort("openai/gpt-4.1", { reasoning: false })).toBe("openai/gpt-4.1:off");
		expect(withModelSelectorEffort("custom/model", {})).toBe("custom/model:inherit");
	});
});
