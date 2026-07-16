import type { ThemeColor } from "../theme/theme";
import { theme } from "../theme/theme";

export interface ModelSelectorAbbreviation {
	laneAbbrev: string;
	providerAbbrev: string;
	version: string;
	effortAbbrev: string;
}

/**
 * Compact model-label vocabulary.
 *
 * Live configured catalog (models.yml):
 *   openai-codex/gpt-5.6-sol   -> S | OX | 5.6
 *   openai-codex/gpt-5.6-terra -> T | OX | 5.6
 *   openai-codex/gpt-5.6-luna  -> L | OX | 5.6
 *
 * Bundled catalog families use the same stable lane initials:
 *   GPT: Sol S, Terra T, Luna L, Codex C, Mini M, Nano N, base GPT G
 *   Claude: Sonnet S, Opus O, Haiku H
 *   Gemini: Flash F, Pro P, Ultra U
 *   Kimi K; DeepSeek: Chat C, Reasoner R, Pro P; Qwen/GLM/Grok/Llama use
 *   their family initial unless a Coder/Chat/Reasoner variant supplies C/R.
 * Unknown providers fall back to their first two characters and unknown
 * lanes to the first model-id character, so newly discovered catalog entries
 * remain compact without a stale exhaustive model-id list.
 *
 * Color roles are deliberately redundant with position/text (not color-only):
 *   lane=success, provider=accent, version=text, effort=thinkingText.
 */
export const MODEL_ABBREVIATION_COLOR_ROLES = {
	laneAbbrev: "success",
	providerAbbrev: "accent",
	version: "text",
	effortAbbrev: "thinkingText",
} as const satisfies Record<keyof ModelSelectorAbbreviation, ThemeColor>;

const PROVIDER_ABBREVIATIONS: Readonly<Record<string, string>> = {
	anthropic: "AN",
	"amazon-bedrock": "AB",
	"azure-openai": "AZ",
	cursor: "CU",
	deepseek: "DS",
	fireworks: "FW",
	github: "GH",
	"github-copilot": "GH",
	google: "GO",
	"google-antigravity": "GA",
	"google-gemini-cli": "GC",
	"google-vertex": "GV",
	groq: "GQ",
	huggingface: "HF",
	"kimi-code": "KM",
	"lm-studio": "LM",
	minimax: "MM",
	"minimax-code": "MC",
	mistral: "MI",
	moonshot: "MS",
	nvidia: "NV",
	ollama: "OL",
	"ollama-cloud": "OC",
	openai: "OA",
	"openai-codex": "OX",
	"opencode-go": "OG",
	"opencode-zen": "OZ",
	openrouter: "OR",
	perplexity: "PX",
	"qwen-portal": "QW",
	together: "TG",
	vercel: "VE",
	"vercel-ai-gateway": "VG",
	vllm: "VL",
	xai: "XA",
	zai: "ZA",
	"zhipu-coding-plan": "ZP",
};

const EFFORT_ABBREVIATIONS: Readonly<Record<string, string>> = {
	auto: "a",
	inherit: "i",
	off: "0",
	none: "0",
	minimal: "mn",
	low: "l",
	medium: "m",
	high: "h",
	xhigh: "xh",
};

const LANE_RULES: readonly [RegExp, string][] = [
	[/\bsol\b/, "S"],
	[/\bterra\b/, "T"],
	[/\bluna\b/, "L"],
	[/\bsonnet\b/, "S"],
	[/\bopus\b/, "O"],
	[/\bhaiku\b/, "H"],
	[/\bflash\b/, "F"],
	[/\bpro\b/, "P"],
	[/\bultra\b/, "U"],
	[/\bcodex\b/, "C"],
	[/\bkimi\b/, "K"],
	[/\b(?:coder|coding)\b/, "C"],
	[/\breasoner\b/, "R"],
	[/\bchat\b/, "C"],
	[/\bmini\b/, "M"],
	[/\bnano\b/, "N"],
	[/\bdeepseek\b/, "D"],
	[/\bqwen\b/, "Q"],
	[/\bglm\b/, "G"],
	[/\bgrok\b/, "G"],
	[/\bllama\b/, "L"],
	[/\bmistral\b/, "M"],
	[/\bcodestral\b/, "C"],
	[/\bcommand\b/, "C"],
	[/\bnova\b/, "N"],
];

function splitEffortSuffix(value: string): { base: string; effort: string | undefined } {
	const separator = value.lastIndexOf(":");
	if (separator <= 0 || separator === value.length - 1) return { base: value, effort: undefined };
	const suffix = value.slice(separator + 1).toLowerCase();
	return EFFORT_ABBREVIATIONS[suffix]
		? { base: value.slice(0, separator), effort: suffix }
		: { base: value, effort: undefined };
}

function laneAbbreviation(modelId: string): string {
	const normalized = modelId
		.toLowerCase()
		.replace(/@[a-z0-9-]+$/i, "")
		.replaceAll(/[^a-z0-9]+/g, "-");
	for (const [pattern, abbreviation] of LANE_RULES) {
		if (pattern.test(normalized)) return abbreviation;
	}
	if (normalized.startsWith("gpt-")) return "G";
	return normalized.match(/[a-z]/)?.[0]?.toUpperCase() ?? "?";
}

function modelVersion(modelId: string): string {
	const normalized = modelId.replace(/@[a-z0-9-]+$/i, "");
	const dotted = normalized.match(/(?:^|[-_])(\d{1,2})\.(\d{1,2})(?=[^0-9]|$)/);
	if (dotted) return `${dotted[1]}.${dotted[2]}`;
	const dashed = normalized.match(/(?:^|[-_])(\d{1,2})-(\d{1,2})(?=[^0-9]|$)/);
	if (dashed) return `${dashed[1]}.${dashed[2]}`;
	const single = normalized.match(/(?:^|[-_])(\d{1,2})(?=[a-z-]|$)/i);
	if (single) return single[1];
	const attached = normalized.match(/(?:^|[-_])(?:v|qwen|gpt|grok|glm|llama)(\d{1,2})(?=[a-z-]|$)/i);
	return attached?.[1] ?? "";
}

/** Format a resolved `provider/model[:effort]` selector into four dense segments. */
export function formatModelSelectorAbbreviation(selector: string): ModelSelectorAbbreviation {
	const normalized = selector.trim().replaceAll("\t", " ");
	const providerSeparator = normalized.indexOf("/");
	const provider = providerSeparator > 0 ? normalized.slice(0, providerSeparator).toLowerCase() : "";
	const modelWithEffort = providerSeparator > 0 ? normalized.slice(providerSeparator + 1) : normalized;
	const { base: modelId, effort } = splitEffortSuffix(modelWithEffort);
	return {
		laneAbbrev: laneAbbreviation(modelId),
		providerAbbrev: provider ? (PROVIDER_ABBREVIATIONS[provider] ?? provider.slice(0, 2).toUpperCase()) : "??",
		version: modelVersion(modelId),
		effortAbbrev: effort ? EFFORT_ABBREVIATIONS[effort] : "",
	};
}

/** Add receipt/session effort only when the selector does not already carry one. */
export function withModelSelectorEffort(
	selector: string | undefined,
	effort: string | null | undefined,
): string | undefined {
	if (!selector || !effort) return selector;
	const providerSeparator = selector.indexOf("/");
	const model = providerSeparator >= 0 ? selector.slice(providerSeparator + 1) : selector;
	if (splitEffortSuffix(model).effort) return selector;
	return `${selector}:${effort}`;
}

/** Render the four segments without spacing; callers add brackets/icons as needed. */
export function renderModelSelectorAbbreviation(selector: string): string {
	const abbreviation = formatModelSelectorAbbreviation(selector);
	return (
		theme.fg(MODEL_ABBREVIATION_COLOR_ROLES.laneAbbrev, abbreviation.laneAbbrev) +
		theme.fg(MODEL_ABBREVIATION_COLOR_ROLES.providerAbbrev, abbreviation.providerAbbrev) +
		theme.fg(MODEL_ABBREVIATION_COLOR_ROLES.version, abbreviation.version) +
		theme.fg(MODEL_ABBREVIATION_COLOR_ROLES.effortAbbrev, abbreviation.effortAbbrev)
	);
}
