import { type ResolvedThinkingLevel, ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { Effort, type Model, type ReasoningEffort, THINKING_EFFORTS } from "@oh-my-pi/pi-ai";
import { clampThinkingLevelForModel, getSupportedEfforts } from "@oh-my-pi/pi-catalog/model-thinking";

/**
 * Metadata used to render thinking selector values in the coding-agent UI.
 */
export interface ThinkingLevelMetadata {
	value: ThinkingLevel;
	label: string;
	description: string;
}

type KnownThinkingLevel = (typeof ThinkingLevel)[keyof typeof ThinkingLevel];

const THINKING_LEVEL_METADATA: Record<KnownThinkingLevel, ThinkingLevelMetadata> = {
	[ThinkingLevel.Inherit]: {
		value: ThinkingLevel.Inherit,
		label: "inherit",
		description: "Inherit session default",
	},
	[ThinkingLevel.Off]: { value: ThinkingLevel.Off, label: "off", description: "No reasoning" },
	[ThinkingLevel.None]: { value: ThinkingLevel.None, label: "none", description: "No provider reasoning" },
	[ThinkingLevel.Minimal]: {
		value: ThinkingLevel.Minimal,
		label: "min",
		description: "Very brief reasoning (~1k tokens)",
	},
	[ThinkingLevel.Low]: { value: ThinkingLevel.Low, label: "low", description: "Light reasoning (~2k tokens)" },
	[ThinkingLevel.Medium]: {
		value: ThinkingLevel.Medium,
		label: "medium",
		description: "Moderate reasoning (~8k tokens)",
	},
	[ThinkingLevel.High]: { value: ThinkingLevel.High, label: "high", description: "Deep reasoning (~16k tokens)" },
	[ThinkingLevel.XHigh]: {
		value: ThinkingLevel.XHigh,
		label: "xhigh",
		description: "Maximum reasoning (~32k tokens)",
	},
	[ThinkingLevel.Max]: {
		value: ThinkingLevel.Max,
		label: "max",
		description: "Maximum provider reasoning",
	},
};

const THINKING_LEVELS = new Set<string>([ThinkingLevel.Inherit, ThinkingLevel.Off, ...THINKING_EFFORTS]);
const EFFORT_LEVELS = new Set<string>(THINKING_EFFORTS);

/**
 * Parses a legacy canonical effort selector.
 *
 * Endpoint-advertised values deliberately bypass this selector and are carried
 * as {@link ReasoningEffort} only after model-capability validation.
 */
export function parseEffort(value: string | null | undefined): Effort | undefined {
	return value !== undefined && value !== null && EFFORT_LEVELS.has(value) ? (value as Effort) : undefined;
}

/**
 * Parses an agent-local thinking selector.
 */
export function parseThinkingLevel(value: string | null | undefined): ThinkingLevel | undefined {
	if (value === "med") return ThinkingLevel.Medium;
	return value !== undefined && value !== null && THINKING_LEVELS.has(value) ? (value as ThinkingLevel) : undefined;
}

/**
 * Returns display metadata for a thinking selector or endpoint-defined effort.
 */
export function getThinkingLevelMetadata(level: ThinkingLevel): ThinkingLevelMetadata {
	return (
		THINKING_LEVEL_METADATA[level as KnownThinkingLevel] ?? {
			value: level,
			label: level,
			description: "Provider-defined reasoning effort",
		}
	);
}

/**
 * Converts an agent-local selector into an exact provider reasoning effort.
 */
export function toReasoningEffort(level: ThinkingLevel | undefined): ReasoningEffort | undefined {
	if (level === undefined || level.length === 0 || level === ThinkingLevel.Off || level === ThinkingLevel.Inherit) {
		return undefined;
	}
	return level as ReasoningEffort;
}

/**
 * True when a selector explicitly requests provider-side reasoning disablement.
 */
export function shouldDisableReasoning(level: ThinkingLevel | undefined): boolean {
	return level === ThinkingLevel.Off;
}

/**
 * Resolves a selector against the current model while preserving explicit "off".
 */
export function resolveThinkingLevelForModel(
	model: Model | undefined,
	level: ThinkingLevel | undefined,
): ResolvedThinkingLevel | undefined {
	if (level === undefined || level === ThinkingLevel.Inherit) {
		return undefined;
	}
	if (level === ThinkingLevel.Off) {
		return ThinkingLevel.Off;
	}
	return clampThinkingLevelForModel(model, level);
}

/**
 * Sentinel selector for the coding-agent "auto" thinking mode. Kept entirely
 * inside the coding-agent layer: it is never an {@link Effort} or
 * {@link ThinkingLevel}, so provider mapping/clamping keeps seeing concrete
 * efforts. The session resolves `auto` to a concrete effort each turn.
 */
export const AUTO_THINKING = "auto" as const;

/** A thinking selector as configured by the user — a concrete level or `auto`. */
export type ConfiguredThinkingLevel = ThinkingLevel | typeof AUTO_THINKING;

/** Metadata used to render the `auto` selector value alongside concrete levels. */
export interface ConfiguredThinkingLevelMetadata {
	value: ConfiguredThinkingLevel;
	label: string;
	description: string;
}

const AUTO_THINKING_METADATA: ConfiguredThinkingLevelMetadata = {
	value: AUTO_THINKING,
	label: "auto",
	description: "Auto-detect per prompt (low–xhigh)",
};

/**
 * Parses a configured thinking selector, accepting `auto` in addition to every
 * value {@link parseThinkingLevel} accepts. {@link parseThinkingLevel} itself
 * stays strict so model-suffix parsing (`model:high`) keeps rejecting `auto`.
 */
export function parseConfiguredThinkingLevel(value: string | null | undefined): ConfiguredThinkingLevel | undefined {
	if (value === AUTO_THINKING) return AUTO_THINKING;
	return parseThinkingLevel(value);
}

/** Returns display metadata for a configured selector, including `auto`. */
export function getConfiguredThinkingLevelMetadata(level: ConfiguredThinkingLevel): ConfiguredThinkingLevelMetadata {
	return level === AUTO_THINKING ? AUTO_THINKING_METADATA : getThinkingLevelMetadata(level);
}

/**
 * Resolves an auto-classified effort against the active model's supported
 * range. Unlike {@link clampThinkingLevelForModel}, `auto` never resolves below
 * {@link Effort.Low}: the eligible pool is the model's supported canonical
 * efforts at or above Low (falling back to the full supported set only when the
 * model exposes no canonical auto range). Unknown endpoint values have no global
 * ordering, so an advertised unknown default round-trips unchanged.
 */
export function clampAutoThinkingEffort(model: Model | undefined, effort: Effort): Effort;
export function clampAutoThinkingEffort(
	model: Model | undefined,
	effort: ReasoningEffort,
): ReasoningEffort;
export function clampAutoThinkingEffort(
	model: Model | undefined,
	effort: ReasoningEffort,
): ReasoningEffort {
	const supported = model ? getSupportedEfforts(model) : THINKING_EFFORTS;
	if (supported.length === 0) return effort;
	const knownEffortIndex = (candidate: ReasoningEffort): number =>
		THINKING_EFFORTS.findIndex(known => known === candidate);
	if (knownEffortIndex(effort) < 0 && supported.includes(effort)) return effort;
	const lowIndex = knownEffortIndex(Effort.Low);
	const eligible = supported.filter(level => knownEffortIndex(level) >= lowIndex);
	const pool = eligible.length > 0 ? eligible : supported;
	const requestedIndex = knownEffortIndex(effort);
	if (requestedIndex < 0) return pool[0]!;
	let chosen = pool[0]!;
	for (const candidate of pool) {
		if (knownEffortIndex(candidate) > requestedIndex) break;
		chosen = candidate;
	}
	return chosen;
}

/**
 * The provisional concrete level shown while `auto` is configured but before a
 * turn has been classified. Prefers the model's `defaultLevel`, otherwise High,
 * clamped into the auto range. Returns `undefined` for non-reasoning models.
 */
export function resolveProvisionalAutoLevel(model: Model | undefined): ReasoningEffort | undefined {
	if (!model?.reasoning) return undefined;
	return clampAutoThinkingEffort(model, model.thinking?.defaultLevel ?? Effort.High);
}
