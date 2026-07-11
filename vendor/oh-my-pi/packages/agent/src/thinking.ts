import { Effort, type ReasoningEffort } from "@oh-my-pi/pi-catalog/effort";

/**
 * Agent-local thinking selector.
 *
 * `off` and `inherit` control local request selection. Every other value is
 * an exact, previously validated provider reasoning-effort wire value.
 */
export const ThinkingLevel = {
	Inherit: "inherit",
	Off: "off",
	None: Effort.None,
	Minimal: Effort.Minimal,
	Low: Effort.Low,
	Medium: Effort.Medium,
	High: Effort.High,
	XHigh: Effort.XHigh,
	Max: Effort.Max,
} as const;

type LocalThinkingLevel = (typeof ThinkingLevel)["Inherit" | "Off"];

export type ThinkingLevel = LocalThinkingLevel | ReasoningEffort;
export type ResolvedThinkingLevel = Exclude<ThinkingLevel, LocalThinkingLevel>;

/** True when the selector can be forwarded to a provider as a reasoning effort. */
export function isProviderThinkingEffort(level: ThinkingLevel): level is ReasoningEffort {
	return level !== ThinkingLevel.Inherit && level !== ThinkingLevel.Off;
}
