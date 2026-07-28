/** Known reasoning effort wire values. Endpoint-advertised values may extend this list. */
export const enum Effort {
	None = "none",
	Minimal = "minimal",
	Low = "low",
	Medium = "medium",
	High = "high",
	XHigh = "xhigh",
	Max = "max",
}

/**
 * An exact, non-empty reasoning effort value. The Codex catalog may advertise
 * values newer than OMP, so callers must not reduce this to `Effort`.
 */
export type ReasoningEffort = Effort | (string & {});

/** Canonical ordering for known reasoning-effort wire values. */
export const KNOWN_REASONING_EFFORTS: readonly Effort[] = [
	Effort.None,
	Effort.Minimal,
	Effort.Low,
	Effort.Medium,
	Effort.High,
	Effort.XHigh,
	Effort.Max,
];

/** Codex client-side orchestration levels, distinct from request wire efforts. */
export const enum CodexOrchestrationLevel {
	Ultra = "ultra",
}

/** Legacy generic-model wire-effort order. */
export const THINKING_EFFORTS: readonly Effort[] = [
	Effort.Minimal,
	Effort.Low,
	Effort.Medium,
	Effort.High,
	Effort.XHigh,
	Effort.Max,
];

/** Returns an exact effort only when a boundary value is a non-empty string. */
export function toReasoningEffort(value: unknown): ReasoningEffort | undefined {
	if (typeof value !== "string" || value.length === 0) return undefined;
	return value;
}
