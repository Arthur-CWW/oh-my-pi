import type { ThemeColor } from "../theme/theme";
import { theme } from "../theme/theme";

export type ModelSelectorLabelTier = "compact" | "standalone";

export interface ModelSelectorAbbreviation {
	provider: string;
	model: string;
	effort: string;
}

/**
 * Tiered model-label vocabulary.
 *
 * Compact labels are reserved for dense comparison tables:
 *   openai-codex/gpt-5.6-sol:xhigh -> OX5.6sol xh
 *
 * Standalone labels favor recognition over width:
 *   openai-codex/gpt-5.6-sol:xhigh -> codex 5.6sol xhigh
 *
 * Variant names remain whole words in both tiers. Unknown model families keep
 * their normalized model id rather than collapsing to an ambiguous initial.
 */
export const MODEL_ABBREVIATION_COLOR_ROLES = {
	provider: "accent",
	model: "text",
	effort: "thinkingText",
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

const STANDALONE_PROVIDER_NAMES: Readonly<Record<string, string>> = {
	"github-copilot": "copilot",
	"google-antigravity": "antigravity",
	"google-gemini-cli": "gemini",
	"google-vertex": "vertex",
	"kimi-code": "kimi",
	"lm-studio": "lmstudio",
	"minimax-code": "minimax",
	"ollama-cloud": "ollama",
	"openai-codex": "codex",
	"qwen-portal": "qwen",
	"vercel-ai-gateway": "vercel",
	"zhipu-coding-plan": "zhipu",
};

const EFFORT_LABELS: Readonly<Record<string, { compact: string; standalone: string }>> = {
	auto: { compact: "a", standalone: "auto" },
	inherit: { compact: "i", standalone: "inherit" },
	off: { compact: "0", standalone: "off" },
	none: { compact: "0", standalone: "none" },
	minimal: { compact: "mn", standalone: "minimal" },
	low: { compact: "l", standalone: "low" },
	medium: { compact: "m", standalone: "medium" },
	high: { compact: "h", standalone: "high" },
	xhigh: { compact: "xh", standalone: "xhigh" },
};

const MODEL_VARIANTS: readonly [RegExp, string][] = [
	[/\bsol\b/, "sol"],
	[/\bterra\b/, "terra"],
	[/\bluna\b/, "luna"],
	[/\bfable\b/, "fable"],
	[/\bsonnet\b/, "sonnet"],
	[/\bopus\b/, "opus"],
	[/\bhaiku\b/, "haiku"],
	[/\bflash\b/, "flash"],
	[/\bpro\b/, "pro"],
	[/\bultra\b/, "ultra"],
	[/\bcodex\b/, "codex"],
	[/\bkimi\b/, "kimi"],
	[/\b(?:coder|coding)\b/, "coder"],
	[/\breasoner\b/, "reasoner"],
	[/\bchat\b/, "chat"],
	[/\bmini\b/, "mini"],
	[/\bnano\b/, "nano"],
	[/\bdeepseek\b/, "deepseek"],
	[/\bqwen\b/, "qwen"],
	[/\bglm\b/, "glm"],
	[/\bgrok\b/, "grok"],
	[/\bllama\b/, "llama"],
	[/\bmistral\b/, "mistral"],
	[/\bcodestral\b/, "codestral"],
	[/\bcommand\b/, "command"],
	[/\bnova\b/, "nova"],
	[/\bgpt\b/, "gpt"],
	[/\bclaude\b/, "claude"],
	[/\bgemini\b/, "gemini"],
];

function splitEffortSuffix(value: string): { base: string; effort: string | undefined } {
	const separator = value.lastIndexOf(":");
	if (separator <= 0 || separator === value.length - 1) return { base: value, effort: undefined };
	const suffix = value.slice(separator + 1).toLowerCase();
	return EFFORT_LABELS[suffix]
		? { base: value.slice(0, separator), effort: suffix }
		: { base: value, effort: undefined };
}

function normalizedModelId(modelId: string): string {
	return modelId
		.toLowerCase()
		.replace(/@[a-z0-9-]+$/i, "")
		.replaceAll(/[^a-z0-9.]+/g, "-")
		.replace(/^-|-$/g, "");
}

function modelVariant(modelId: string): string | undefined {
	const normalized = normalizedModelId(modelId);
	for (const [pattern, variant] of MODEL_VARIANTS) {
		if (pattern.test(normalized)) return variant;
	}
	return undefined;
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

function versionVariant(modelId: string): string {
	const variant = modelVariant(modelId);
	return variant ? `${modelVersion(modelId)}${variant}` : normalizedModelId(modelId);
}

/** Format a resolved `provider/model[:effort]` selector for the requested display tier. */
export function formatModelSelectorAbbreviation(
	selector: string,
	tier: ModelSelectorLabelTier,
): ModelSelectorAbbreviation {
	const normalized = selector.trim().replaceAll("\t", " ");
	const providerSeparator = normalized.indexOf("/");
	const provider = providerSeparator > 0 ? normalized.slice(0, providerSeparator).toLowerCase() : "";
	const modelWithEffort = providerSeparator > 0 ? normalized.slice(providerSeparator + 1) : normalized;
	const { base: modelId, effort } = splitEffortSuffix(modelWithEffort);
	const providerLabel =
		tier === "compact"
			? provider
				? (PROVIDER_ABBREVIATIONS[provider] ?? provider.slice(0, 2).toUpperCase())
				: "??"
			: provider
				? (STANDALONE_PROVIDER_NAMES[provider] ?? provider)
				: "unknown";
	return {
		provider: providerLabel,
		model: versionVariant(modelId),
		effort: effort ? EFFORT_LABELS[effort][tier] : "",
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

/** Render a model label; compact is only for dense comparison rows. */
export function renderModelSelectorAbbreviation(selector: string, tier: ModelSelectorLabelTier): string {
	const abbreviation = formatModelSelectorAbbreviation(selector, tier);
	const providerModelSeparator = tier === "compact" ? "" : " ";
	const effort = abbreviation.effort ? ` ${theme.fg(MODEL_ABBREVIATION_COLOR_ROLES.effort, abbreviation.effort)}` : "";
	return (
		theme.fg(MODEL_ABBREVIATION_COLOR_ROLES.provider, abbreviation.provider) +
		providerModelSeparator +
		theme.fg(MODEL_ABBREVIATION_COLOR_ROLES.model, abbreviation.model) +
		effort
	);
}
