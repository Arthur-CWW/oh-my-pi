import type { UsageStatistics } from "../session/session-entries";

export type GoalStatus = "active" | "paused" | "budget-limited" | "complete" | "dropped";

export interface Goal {
	readonly id: string;
	objective: string;
	status: GoalStatus;
	tokenBudget?: number;
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

const GOAL_STATUSES = new Set<GoalStatus>(["active", "paused", "budget-limited", "complete", "dropped"]);

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
	if (typeof candidate.status !== "string" || !GOAL_STATUSES.has(candidate.status as GoalStatus)) return undefined;
	if (
		candidate.tokenBudget !== undefined &&
		(typeof candidate.tokenBudget !== "number" ||
			!Number.isInteger(candidate.tokenBudget) ||
			candidate.tokenBudget <= 0)
	) {
		return undefined;
	}
	if (!isNonNegativeFiniteNumber(candidate.tokensUsed)) return undefined;
	if (!isNonNegativeFiniteNumber(candidate.timeUsedSeconds)) return undefined;
	if (!isNonNegativeFiniteNumber(candidate.createdAt) || !isNonNegativeFiniteNumber(candidate.updatedAt)) return undefined;

	const goal: Goal = {
		id: candidate.id,
		objective: candidate.objective,
		status: candidate.status as GoalStatus,
		...(candidate.tokenBudget === undefined ? {} : { tokenBudget: candidate.tokenBudget as number }),
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
	remainingTokens?: number | null;
	completionBudgetReport?: string | null;
}

export type GoalRuntimeEvent =
	| { type: "goal_updated"; goal: Goal | null; state?: GoalModeState }
	| { type: "goal_continuation_requested"; prompt: string };

export type GoalTokenUsage = Pick<UsageStatistics, "input" | "output" | "cacheRead" | "cacheWrite">;

export type GoalBudgetSteering = "allowed" | "suppressed";
export type GoalTerminalMetricEmission = "emit" | "suppress";
