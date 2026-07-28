export const AUTH_FALLBACK_SETTINGS_SCHEMA = {
	"auth.codexUsageReset": {
		type: "enum",
		values: ["auto", "manual"] as const,
		default: "auto",
	},
} as const;

export const RETRY_FALLBACK_SETTINGS_SCHEMA = {
	"retry.fallbackApproval": {
		type: "boolean",
		default: true,
		ui: {
			tab: "model",
			group: "Retry & Fallback",
			label: "Fallback Approval",
			description: "Allow failing subagents to propose configured fallback models for explicit parent approval",
		},
	},
	"retry.proposableFallbackChains": { type: "record", default: {} as Record<string, string[]> },
	"retry.subagentFallbackAutoApproveUntil": {
		type: "string",
		default: "",
		ui: {
			tab: "model",
			group: "Retry & Fallback",
			label: "Subagent Fallback Auto-Approve Until",
			description:
				"ISO timestamp bounding temporary auto-approval of configured subagent fallback proposals; never applies to main/orchestrator sessions",
		},
	},
	"retry.fallbackRevertPolicy": {
		type: "enum",
		values: ["cooldown-expiry", "never"] as const,
		default: "cooldown-expiry",
		ui: {
			tab: "model",
			group: "Retry & Fallback",
			label: "Fallback Revert Policy",
			description: "When to return to the primary model after a fallback",
			options: [
				{
					value: "cooldown-expiry",
					label: "Cooldown expiry",
					description: "Return to the primary model after its suppression window ends",
				},
				{ value: "never", label: "Never", description: "Stay on the fallback model until manually changed" },
			],
		},
	},
	"retry.semanticRefusalRecovery.enabled": {
		type: "boolean",
		default: true,
		ui: {
			tab: "model",
			group: "Retry & Fallback",
			label: "Semantic Refusal Recovery",
			description: "Recover decoded Anthropic Fable refusals on the same session using a durable Codex route",
		},
	},
	"retry.semanticRefusalRecovery.model": {
		type: "string",
		default: "openai-codex/gpt-5.6-sol",
	},
	"retry.semanticRefusalRecovery.smolModel": {
		type: "string",
		default: "openai-codex/gpt-5.6-luna",
	},
	"retry.semanticRefusalRecovery.maxPerSession": {
		type: "number",
		default: 3,
	},
	"retry.semanticRefusalRecovery.exemptResponsibilities": {
		type: "array",
		default: ["designer"],
	},
	"retry.semanticRefusalRecovery.smolResponsibilities": {
		type: "array",
		default: ["quick_task"],
	},
} as const;

export const CODEX_RESET_SETTINGS_SCHEMA = {
	"codexResets.autoRedeem": {
		type: "enum",
		values: ["unset", "yes", "no"] as const,
		default: "yes" as const,
		ui: {
			tab: "providers",
			group: "Services",
			label: "Codex Auto-Redeem Saved Resets",
			description:
				"Automatically spend one eligible saved reset when the active account is blocked by the Codex weekly limit or shortly before the credit expires. yes is the default; unset asks on blocked turns but leaves unattended expiry salvage disabled; no disables both paths.",
			options: [
				{
					value: "unset",
					label: "Unset",
					description: "Ask before spending for a blocked turn; do not redeem unattended near expiry.",
				},
				{ value: "yes", label: "Yes", description: "Spend eligible saved resets without prompting." },
				{ value: "no", label: "No", description: "Do not run the saved-reset auto-redeem check." },
			],
		},
	},
	"codexResets.expiryLeadMinutes": {
		type: "number",
		default: 30,
		min: 5,
		max: 24 * 60,
		integer: true,
		ui: {
			tab: "providers",
			group: "Services",
			label: "Codex Saved Reset Expiry Lead",
			description: "Automatically redeem saved resets 5m..24h before they expire.",
		},
	},
	"codexResets.minBlockedMinutes": {
		type: "number",
		default: 60,
		ui: {
			tab: "providers",
			group: "Services",
			label: "Codex Auto-Redeem Min Block",
			description:
				"Only auto-redeem when the natural weekly reset is at least this many minutes away (don't spend a ~30-day credit to save a short wait).",
		},
	},
	"codexResets.keepCredits": {
		type: "number",
		default: 0,
		ui: {
			tab: "providers",
			group: "Services",
			label: "Codex Auto-Redeem Reserve",
			description: "Never auto-spend below this many saved resets (0 = the last credit may be spent automatically).",
		},
	},
} as const;

export type CodexAutoRedeemMode = "unset" | "yes" | "no";

export interface CodexResetsSettings {
	autoRedeem: CodexAutoRedeemMode;
	minBlockedMinutes: number;
	expiryLeadMinutes: number;
	keepCredits: number;
}

export interface ContextPromotionSettings {
	enabled: boolean;
}

export interface RetrySettings {
	enabled: boolean;
	maxRetries: number;
	baseDelayMs: number;
	networkHoldMs: number;
	maxDelayMs: number;
	fallbackApproval: boolean;
	proposableFallbackChains: Record<string, string[]>;
	subagentFallbackAutoApproveUntil: string;
	fallbackRevertPolicy: "cooldown-expiry" | "never";
	"semanticRefusalRecovery.enabled": boolean;
	"semanticRefusalRecovery.model": string;
	"semanticRefusalRecovery.smolModel": string;
	"semanticRefusalRecovery.maxPerSession": number;
	"semanticRefusalRecovery.exemptResponsibilities": string[];
	"semanticRefusalRecovery.smolResponsibilities": string[];
}

export interface IncidentsSettings {
	enabled: boolean;
	windowMs: number;
	threshold: number;
}
