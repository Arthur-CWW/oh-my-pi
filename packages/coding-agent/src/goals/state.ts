import type { UsageStatistics } from "../session/session-entries";

export type GoalStatus = "active" | "paused" | "complete" | "dropped";

export interface Goal {
	readonly id: string;
	objective: string;
	status: GoalStatus;
	tokensUsed: number;
	timeUsedSeconds: number;
	createdAt: number;
	updatedAt: number;
}

export interface GoalModeState {
	enabled: boolean;
	mode: "active" | "exiting";
	reason?: "completed";
	goal: Goal;
}

const GOAL_STATUSES = new Set<GoalStatus>(["active", "paused", "complete", "dropped"]);

/** Decode persisted goal state at the untyped session-journal boundary. */
export function decodeGoalModeState(value: unknown): GoalModeState | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const state = value as Record<string, unknown>;
	if (typeof state.enabled !== "boolean") return undefined;
	if (state.mode !== "active" && state.mode !== "exiting") return undefined;
	if (state.reason !== undefined && state.reason !== "completed") return undefined;
	if (typeof state.goal !== "object" || state.goal === null || Array.isArray(state.goal)) return undefined;

	const candidate = state.goal as Record<string, unknown>;
	if (typeof candidate.id !== "string" || candidate.id.length === 0) return undefined;
	if (typeof candidate.objective !== "string" || candidate.objective.length === 0) return undefined;
	if (typeof candidate.status !== "string") return undefined;
	const rawStatus = candidate.status;
	if (rawStatus !== "budget-limited" && !GOAL_STATUSES.has(rawStatus as GoalStatus)) return undefined;
	if (!isNonNegativeFiniteNumber(candidate.tokensUsed)) return undefined;
	if (!isNonNegativeFiniteNumber(candidate.timeUsedSeconds)) return undefined;
	if (!isNonNegativeFiniteNumber(candidate.createdAt) || !isNonNegativeFiniteNumber(candidate.updatedAt)) return undefined;

	const goal: Goal = {
		id: candidate.id,
		objective: candidate.objective,
		status: rawStatus === "budget-limited" ? "active" : rawStatus as GoalStatus,
		tokensUsed: candidate.tokensUsed,
		timeUsedSeconds: candidate.timeUsedSeconds,
		createdAt: candidate.createdAt,
		updatedAt: candidate.updatedAt,
	};
	return {
		enabled: state.enabled,
		mode: state.mode,
		...(state.reason === undefined ? {} : { reason: state.reason }),
		goal,
	};
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
	return isFiniteNumber(value) && value >= 0;
}
export type GoalWorkstreamReference =
	| { kind: "workstream"; id: string; charterPath: string }
	| { kind: "adhoc" };


export interface GoalToolDetails {
	op: "create" | "update" | "get" | "complete" | "resume" | "drop";
	goal?: Goal | null;
	workstream?: GoalWorkstreamReference;
	completionUsageReport?: string | null;
}

export type GoalRuntimeEvent =
	| { type: "goal_updated"; goal: Goal | null; state?: GoalModeState }
	| { type: "goal_continuation_requested"; prompt: string };

export type GoalTokenUsage = Pick<UsageStatistics, "input" | "output" | "cacheRead" | "cacheWrite">;

export type GoalTerminalMetricEmission = "emit" | "suppress";
