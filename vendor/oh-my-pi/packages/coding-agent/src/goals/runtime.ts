import { prompt, Snowflake } from "@oh-my-pi/pi-utils";
import goalBudgetLimitPrompt from "../prompts/goals/goal-budget-limit.md" with { type: "text" };
import goalContinuationPrompt from "../prompts/goals/goal-continuation.md" with { type: "text" };
import goalModeActivePrompt from "../prompts/goals/goal-mode-active.md" with { type: "text" };
import {
	decodeSessionWorkstream,
	type SessionWorkstream,
	type TransitionGoalModeRequest,
	type WorkstreamSource,
	workstreamCharterPath,
} from "../session/session-entries";
import {
	decodeGoalModeState,
	type Goal,
	type GoalBudgetSteering,
	type GoalModeState,
	type GoalRuntimeEvent,
	type GoalTokenUsage,
	type GoalWorkstreamReference,
} from "./state";

export interface GoalRuntimeHost {
	getState(): GoalModeState | undefined;
	setState(state: GoalModeState | undefined): void;
	getWorkstream(): SessionWorkstream | undefined;
	setWorkstream(workstream: SessionWorkstream, source: WorkstreamSource): Promise<boolean>;
	getCurrentUsage(): GoalTokenUsage;
	emit(event: GoalRuntimeEvent): void | Promise<void>;
	persist(mode: "goal" | "goal_paused" | "none", state?: GoalModeState): void;
	sendHiddenMessage(message: {
		customType: string;
		content: string;
		deliverAs?: "steer" | "followUp" | "nextTurn";
	}): Promise<void>;
	now?(): number;
}

export interface GoalTurnSnapshot {
	turnId: string;
	baselineUsage: GoalTokenUsage;
	activeGoalId?: string;
}

export interface GoalWallClockSnapshot {
	lastAccountedAt: number;
	activeGoalId?: string;
}

export interface GoalRuntimeSnapshot {
	turnSnapshot?: GoalTurnSnapshot;
	wallClock: GoalWallClockSnapshot;
	budgetReportedFor?: string;
}

export type GoalPromptKind = "active" | "continuation" | "budget-limit";


function cloneGoal(goal: Goal): Goal {
	return { ...goal };
}

function cloneState(state: GoalModeState): GoalModeState {
	return { ...state, goal: cloneGoal(state.goal) };
}

function budgetValue(goal: Goal): string {
	return goal.tokenBudget === undefined ? "none" : String(goal.tokenBudget);
}

function remainingValue(goal: Goal): string {
	return goal.tokenBudget === undefined ? "unbounded" : String(Math.max(0, goal.tokenBudget - goal.tokensUsed));
}

export function remainingTokens(goal: Goal | null | undefined): number | null {
	if (!goal || goal.tokenBudget === undefined) return null;
	return Math.max(0, goal.tokenBudget - goal.tokensUsed);
}

export function escapeXmlText(input: string): string {
	let firstEscapable = -1;
	for (let index = 0; index < input.length; index++) {
		const char = input.charCodeAt(index);
		if (char === 38 || char === 60 || char === 62) {
			firstEscapable = index;
			break;
		}
	}
	if (firstEscapable === -1) return input;

	let output = input.slice(0, firstEscapable);
	for (let index = firstEscapable; index < input.length; index++) {
		const char = input[index];
		if (char === "&") output += "&amp;";
		else if (char === "<") output += "&lt;";
		else if (char === ">") output += "&gt;";
		else output += char;
	}
	return output;
}

export function renderTrustedObjective(objective: string): string {
	return `<objective>\n${escapeXmlText(objective)}\n</objective>`;
}

export function goalTokenDelta(current: GoalTokenUsage, baseline: GoalTokenUsage): number {
	// Diverges from codex-rs: codex omits cache creation because its target providers
	// do not bill cache writes distinctly through the token-usage stream. Pi receives
	// cacheWrite separately on Anthropic/Bedrock; rotating a 1h ephemeral cache or
	// re-anchoring a changed system prompt can write 100K+ tokens, which the goal
	// budget must account for. cacheRead is excluded because it is reused prefix,
	// not new work consumed by the goal.
	return (
		Math.max(0, current.input - baseline.input) +
		Math.max(0, current.cacheWrite - baseline.cacheWrite) +
		Math.max(0, current.output - baseline.output)
	);
}

export function projectGoalWorkstream(workstream: SessionWorkstream | undefined): GoalWorkstreamReference | undefined {
	if (!workstream) return undefined;
	return workstream.kind === "adhoc"
		? { kind: "adhoc" }
		: { kind: "workstream", id: workstream.id, charterPath: workstreamCharterPath(workstream.id) };
}

function renderWorkstreamContext(workstream: GoalWorkstreamReference | undefined): string {
	if (!workstream) return "";
	return workstream.kind === "adhoc"
		? '<workstream kind="adhoc" />'
		: `<workstream id="${workstream.id}" charter="${workstream.charterPath}" />`;
}

export function renderGoalPrompt(
	kind: GoalPromptKind,
	goal: Goal,
	workstream?: GoalWorkstreamReference,
): string {
	const template =
		kind === "active"
			? goalModeActivePrompt
			: kind === "continuation"
				? goalContinuationPrompt
				: goalBudgetLimitPrompt;
	return prompt.render(template, {
		objective: escapeXmlText(goal.objective),
		tokensUsed: String(goal.tokensUsed),
		tokenBudget: budgetValue(goal),
		remainingTokens: remainingValue(goal),
		timeUsedSeconds: String(goal.timeUsedSeconds),
		workstreamContext: renderWorkstreamContext(workstream),
	});
}

export function completionBudgetReport(goal: Goal): string | null {
	const parts: string[] = [];
	if (goal.tokenBudget !== undefined) {
		parts.push(`tokens used: ${goal.tokensUsed} of ${goal.tokenBudget}`);
	}
	if (goal.timeUsedSeconds > 0) {
		parts.push(`time used: ${goal.timeUsedSeconds} seconds`);
	}
	if (parts.length === 0) return null;
	return `Goal achieved. Report final budget usage to the user: ${parts.join("; ")}.`;
}

function validateTokenBudget(tokenBudget: number | undefined): void {
	if (tokenBudget !== undefined && (!Number.isInteger(tokenBudget) || tokenBudget <= 0)) {
		throw new Error("goal token_budget must be a positive integer when provided");
	}
}
const CHARTER_REFERENCE_PATTERN =
	/(?<![A-Za-z0-9_./-])streams\/([a-z0-9]+(?:-[a-z0-9]+)*)\/GOAL\.md(?![A-Za-z0-9_./-])/g;

export function inferGoalWorkstream(objective: string): SessionWorkstream | undefined {
	const matches = [...objective.matchAll(CHARTER_REFERENCE_PATTERN)];
	if (matches.length !== 1) return undefined;
	const id = matches[0]?.[1];
	if (!id) return undefined;
	return { kind: "workstream", id };
}

function explicitGoalWorkstream(value: string): SessionWorkstream {
	const id = value.trim();
	const candidate: SessionWorkstream = id === "adhoc" ? { kind: "adhoc" } : { kind: "workstream", id };
	const validated = decodeSessionWorkstream(candidate);
	if (!validated) throw new Error('workstream must be "adhoc" or a lowercase kebab-case stream slug');
	return validated;
}

function sameWorkstream(left: SessionWorkstream | undefined, right: SessionWorkstream): boolean {
	return left?.kind === right.kind && (left.kind === "adhoc" || (right.kind === "workstream" && left.id === right.id));
}

function isAccountingStatus(goal: Goal): boolean {
	return goal.status === "active" || goal.status === "budget-limited";
}

export class GoalRuntime {
	readonly #host: GoalRuntimeHost;
	#turnSnapshot: GoalTurnSnapshot | undefined;
	#wallClock: GoalWallClockSnapshot;
	#budgetReportedFor: string | undefined;
	#accountingTail: Promise<void> = Promise.resolve();

	constructor(host: GoalRuntimeHost) {
		this.#host = host;
		this.#wallClock = { lastAccountedAt: this.#now() };
	}

	get snapshot(): GoalRuntimeSnapshot {
		return {
			turnSnapshot: this.#turnSnapshot
				? { ...this.#turnSnapshot, baselineUsage: { ...this.#turnSnapshot.baselineUsage } }
				: undefined,
			wallClock: { ...this.#wallClock },
			budgetReportedFor: this.#budgetReportedFor,
		};
	}
	restoreSnapshot(snapshot: GoalRuntimeSnapshot): void {
		this.#turnSnapshot = snapshot.turnSnapshot
			? { ...snapshot.turnSnapshot, baselineUsage: { ...snapshot.turnSnapshot.baselineUsage } }
			: undefined;
		this.#wallClock = { ...snapshot.wallClock };
		this.#budgetReportedFor = snapshot.budgetReportedFor;
	}

	#now(): number {
		return this.#host.now?.() ?? Date.now();
	}
	async #classifyWorkstream(objective: string, explicit: string | undefined): Promise<void> {
		if (explicit !== undefined) {
			const requested = explicitGoalWorkstream(explicit);
			const current = this.#host.getWorkstream();
			const changed = await this.#host.setWorkstream(requested, "explicit");
			if (!changed && !sameWorkstream(current, requested)) {
				throw new Error(`failed to classify session as workstream "${explicit.trim()}"`);
			}
		} else if (!this.#host.getWorkstream()) {
			const inferred = inferGoalWorkstream(objective);
			if (inferred) await this.#host.setWorkstream(inferred, "goal");
		}
	}
	getWorkstreamReference(): GoalWorkstreamReference | undefined {
		return projectGoalWorkstream(this.#host.getWorkstream());
	}

	#hasAccountingState(): boolean {
		const state = this.#host.getState();
		return Boolean(state?.enabled && isAccountingStatus(state.goal));
	}

	async #withAccounting<T>(fn: () => Promise<T> | T): Promise<T> {
		const previous = this.#accountingTail;
		const { promise, resolve } = Promise.withResolvers<void>();
		this.#accountingTail = previous.then(
			() => promise,
			() => promise,
		);
		await previous.catch(() => {});
		try {
			return await fn();
		} finally {
			resolve();
		}
	}

	#getStateClone(): GoalModeState | undefined {
		const state = this.#host.getState();
		return state ? cloneState(state) : undefined;
	}

	async #commitState(
		state: GoalModeState | undefined,
		options?: { persist?: "goal" | "goal_paused" | "none"; emit?: boolean },
	): Promise<void> {
		this.#host.setState(state ? cloneState(state) : undefined);
		if (options?.persist) {
			this.#host.persist(options.persist, state);
		}
		if (options?.emit !== false) {
			await this.#host.emit({ type: "goal_updated", goal: state ? cloneGoal(state.goal) : null, state });
		}
	}

	#markActiveAccounting(goal: Goal): void {
		if (this.#wallClock.activeGoalId !== goal.id) {
			this.#wallClock = { lastAccountedAt: this.#now(), activeGoalId: goal.id };
		}
		if (this.#turnSnapshot) {
			this.#turnSnapshot.activeGoalId = goal.id;
			this.#turnSnapshot.baselineUsage = { ...this.#host.getCurrentUsage() };
		}
	}

	#clearActiveAccounting(): void {
		this.#wallClock = { lastAccountedAt: this.#now() };
		if (this.#turnSnapshot) {
			this.#turnSnapshot.activeGoalId = undefined;
		}
	}

	/**
	 * Replace runtime state from the canonical session projection without
	 * appending journal entries or emitting lifecycle events.
	 */
	hydratePersistedState(value: unknown): void {
		if (value === undefined) {
			this.#host.setState(undefined);
			this.#clearActiveAccounting();
			this.#budgetReportedFor = undefined;
			return;
		}
		const state = decodeGoalModeState(value);
		if (!state) throw new Error("Invalid persisted goal mode state");
		this.#host.setState(cloneState(state));
		if (state.enabled && isAccountingStatus(state.goal)) {
			this.#markActiveAccounting(state.goal);
		} else {
			this.#clearActiveAccounting();
		}
		this.#budgetReportedFor = undefined;
	}

	onTurnStart(turnId: string, baselineUsage: GoalTokenUsage): void {
		this.#turnSnapshot = { turnId, baselineUsage: { ...baselineUsage } };
		const state = this.#host.getState();
		if (state?.enabled && isAccountingStatus(state.goal)) {
			this.#turnSnapshot.activeGoalId = state.goal.id;
			if (this.#wallClock.activeGoalId !== state.goal.id) {
				this.#wallClock = { lastAccountedAt: this.#now(), activeGoalId: state.goal.id };
			}
		}
	}

	async onToolCompleted(toolName: string): Promise<void> {
		if (toolName === "goal") return;
		if (!this.#hasAccountingState()) return;
		await this.flushUsage("allowed");
	}

	async onGoalToolCompleted(): Promise<void> {
		if (!this.#hasAccountingState()) return;
		await this.flushUsage("suppressed");
	}

	async onAgentEnd(options?: { turnCompleted?: boolean; currentUsage?: GoalTokenUsage }): Promise<void> {
		if (!this.#hasAccountingState()) {
			this.#turnSnapshot = undefined;
			return;
		}
		await this.flushUsage("suppressed", options?.currentUsage);
		this.#turnSnapshot = undefined;
	}

	async onTaskAborted(options?: { reason?: "interrupted" | "internal" }): Promise<void> {
		const state = this.#host.getState();
		const needsAccounting = state?.enabled && isAccountingStatus(state.goal);
		const needsPause = options?.reason === "interrupted" && state?.enabled && state.goal.status === "active";
		if (!needsAccounting && !needsPause) {
			this.#turnSnapshot = undefined;
			return;
		}
		await this.#withAccounting(async () => {
			await this.#flushUsageLocked("suppressed");
			this.#turnSnapshot = undefined;
			if (options?.reason !== "interrupted") return;
			const cloned = this.#getStateClone();
			if (!cloned?.enabled || cloned.goal.status !== "active") return;
			cloned.enabled = false;
			cloned.goal.status = "paused";
			cloned.goal.updatedAt = this.#now();
			this.#clearActiveAccounting();
			this.#budgetReportedFor = undefined;
			await this.#commitState(cloned, { persist: "goal_paused" });
		});
	}

	async onThreadResumed(): Promise<GoalModeState | undefined> {
		const state = this.#getStateClone();
		if (!state) return undefined;
		if (state.goal.status === "active") {
			state.enabled = false;
			state.goal.status = "paused";
			state.goal.updatedAt = this.#now();
			this.#clearActiveAccounting();
			this.#budgetReportedFor = undefined;
			await this.#commitState(state, { persist: "goal_paused" });
			return state;
		}
		if (state.enabled && isAccountingStatus(state.goal)) {
			this.#markActiveAccounting(state.goal);
		} else {
			this.#clearActiveAccounting();
		}
		await this.#commitState(state, { emit: true });
		return state;
	}

	async onBudgetMutated(newBudget: number | undefined): Promise<GoalModeState | undefined> {
		validateTokenBudget(newBudget);
		return await this.#withAccounting(async () => {
			this.#budgetReportedFor = undefined;
			await this.#flushUsageLocked("suppressed");
			const state = this.#getStateClone();
			if (!state?.goal) return undefined;
			state.goal.tokenBudget = newBudget;
			state.goal.updatedAt = this.#now();
			let shouldSteer = false;
			if (newBudget !== undefined && state.goal.tokensUsed >= newBudget) {
				if (state.goal.status === "active") {
					state.goal.status = "budget-limited";
					shouldSteer = true;
				}
			} else if (state.goal.status === "budget-limited") {
				state.goal.status = "active";
				state.enabled = true;
				this.#markActiveAccounting(state.goal);
			}
			await this.#commitState(state, { persist: state.enabled ? "goal" : "goal_paused" });
			if (shouldSteer) {
				await this.#sendBudgetLimitSteer(state.goal);
			}
			return state;
		});
	}

	async #flushUsageLocked(
		steering: GoalBudgetSteering,
		currentUsage: GoalTokenUsage = this.#host.getCurrentUsage(),
	): Promise<void> {
		const state = this.#getStateClone();
		if (!state?.enabled || !isAccountingStatus(state.goal)) return;
		if (this.#turnSnapshot?.activeGoalId !== state.goal.id && this.#wallClock.activeGoalId !== state.goal.id) return;

		const tokenDelta =
			this.#turnSnapshot?.activeGoalId === state.goal.id
				? goalTokenDelta(currentUsage, this.#turnSnapshot.baselineUsage)
				: 0;
		const wallSeconds =
			this.#wallClock.activeGoalId === state.goal.id
				? Math.max(0, Math.floor((this.#now() - this.#wallClock.lastAccountedAt) / 1000))
				: 0;
		if (tokenDelta <= 0 && wallSeconds <= 0) return;

		state.goal.tokensUsed += tokenDelta;
		state.goal.timeUsedSeconds += wallSeconds;
		state.goal.updatedAt = this.#now();
		const flippedToBudgetLimited =
			state.goal.tokenBudget !== undefined &&
			state.goal.tokensUsed >= state.goal.tokenBudget &&
			state.goal.status === "active";
		if (flippedToBudgetLimited) {
			state.goal.status = "budget-limited";
		}

		if (this.#turnSnapshot?.activeGoalId === state.goal.id) {
			this.#turnSnapshot.baselineUsage = { ...currentUsage };
		}
		if (this.#wallClock.activeGoalId === state.goal.id && wallSeconds > 0) {
			this.#wallClock.lastAccountedAt += wallSeconds * 1000;
		}

		// Persisting wall-clock-only accounting on every tool event bloats /goal sessions with full
		// objective snapshots. Keep the in-memory/UI state fresh, but persist only token/budget changes.
		const shouldPersistUsage = tokenDelta > 0 || flippedToBudgetLimited;
		await this.#commitState(state, { persist: shouldPersistUsage ? "goal" : undefined });

		if (state.goal.status !== "budget-limited") {
			this.#budgetReportedFor = undefined;
		}
		if (steering === "allowed" && flippedToBudgetLimited && this.#budgetReportedFor !== state.goal.id) {
			await this.#sendBudgetLimitSteer(state.goal);
		}
	}

	async flushUsage(
		steering: GoalBudgetSteering,
		currentUsage: GoalTokenUsage = this.#host.getCurrentUsage(),
	): Promise<void> {
		await this.#withAccounting(() => this.#flushUsageLocked(steering, currentUsage));
	}

	#createGoalState(objective: string, tokenBudget: number | undefined, goalId = String(Snowflake.next())): GoalModeState {
		const now = this.#now();
		const goal: Goal = {
			id: goalId,
			objective,
			status: "active",
			tokenBudget,
			tokensUsed: 0,
			timeUsedSeconds: 0,
			createdAt: now,
			updatedAt: now,
		};
		return { enabled: true, mode: "active", goal };
	}

	reserveGoalId(): string {
		return String(Snowflake.next());
	}

	preflightWorkflowTransition(request: TransitionGoalModeRequest, goalId?: string): void {
		const transition = request.transition;
		const state = this.#host.getState();
		if (transition.kind === "enter" && transition.action === "create") {
			if (goalId !== undefined && !goalId) throw new Error("goalId must be non-empty when creating a goal workflow");
			const objective = transition.objective.trim();
			if (!objective) throw new Error("objective is required when op=create");
			validateTokenBudget(transition.tokenBudget);
			if (transition.workstream !== undefined) explicitGoalWorkstream(transition.workstream);
			if (goalId !== undefined && state?.goal.id === goalId) return;
			if (state?.goal && state.goal.status !== "dropped" && state.goal.status !== "complete") {
				throw new Error(
					`cannot create goal because existing goal is ${state.goal.status}; use op=update to replace it`,
				);
			}
			return;
		}

		const requestedGoalId = transition.goalId;
		if (!goalId || goalId !== requestedGoalId) {
			throw new Error(`goal workflow transition requires exact goalId "${requestedGoalId}"`);
		}
		if (!state?.goal) {
			if (transition.kind === "exit" && transition.disposition !== "paused") return;
			throw new Error(`cannot transition goal "${requestedGoalId}" because this session has no goal`);
		}
		if (state.goal.id !== requestedGoalId) {
			throw new Error(
				`cannot transition goal "${requestedGoalId}" because active goal is "${state.goal.id}"`,
			);
		}

		if (transition.kind === "enter") {
			if (state.enabled && state.mode === "active" && state.goal.status === "active") return;
			if (state.goal.status !== "paused") {
				throw new Error(`cannot resume goal because existing goal is ${state.goal.status}`);
			}
			return;
		}
		if (transition.disposition === "paused") {
			if (!state.enabled && state.goal.status === "paused") return;
			if (state.goal.status !== "active" && state.goal.status !== "budget-limited") {
				throw new Error(`cannot pause goal because existing goal is ${state.goal.status}`);
			}
			return;
		}
		if (transition.disposition === "dropped") {
			if (state.goal.status === "dropped") return;
			if (state.goal.status === "complete") throw new Error("cannot drop a completed goal");
			return;
		}
		if (state.goal.status !== "complete" || state.mode !== "exiting") {
			throw new Error("cannot finalize goal before the goal tool has completed it");
		}
	}

	async applyWorkflowTransition(request: TransitionGoalModeRequest, goalId: string): Promise<void> {
		await this.#withAccounting(async () => {
			this.preflightWorkflowTransition(request, goalId);
			const transition = request.transition;
			const current = this.#host.getState();

			if (transition.kind === "enter" && transition.action === "create") {
				if (current?.goal.id === goalId) return;
				const objective = transition.objective.trim();
				await this.#classifyWorkstream(objective, transition.workstream);
				const state = this.#createGoalState(objective, transition.tokenBudget, goalId);
				this.#budgetReportedFor = undefined;
				this.#markActiveAccounting(state.goal);
				await this.#commitState(state, { persist: "goal" });
				return;
			}

			if (!current) {
				if (transition.kind === "exit" && transition.disposition !== "paused") return;
				throw new Error(`cannot apply goal workflow transition for inactive goal "${goalId}"`);
			}
			if (current.goal.id !== goalId) {
				throw new Error(`cannot apply goal workflow transition for inactive goal "${goalId}"`);
			}
			if (transition.kind === "enter") {
				if (current.enabled && current.mode === "active" && current.goal.status === "active") return;
				const state = cloneState(current);
				state.enabled = true;
				state.mode = "active";
				state.reason = undefined;
				state.goal.status = "active";
				state.goal.updatedAt = this.#now();
				this.#budgetReportedFor = undefined;
				this.#markActiveAccounting(state.goal);
				await this.#commitState(state, { persist: "goal" });
				return;
			}

			if (transition.disposition === "paused") {
				if (!current.enabled && current.goal.status === "paused") return;
				await this.#flushUsageLocked("suppressed");
				const state = this.#getStateClone();
				if (!state || state.goal.id !== goalId) {
					throw new Error(`goal "${goalId}" changed while pausing`);
				}
				state.enabled = false;
				state.mode = "active";
				state.reason = undefined;
				state.goal.status = "paused";
				state.goal.updatedAt = this.#now();
				this.#clearActiveAccounting();
				this.#budgetReportedFor = undefined;
				await this.#commitState(state, { persist: "goal_paused" });
				return;
			}

			if (transition.disposition === "completed") {
				this.#clearActiveAccounting();
				this.#budgetReportedFor = undefined;
				await this.#commitState(undefined, { persist: "none" });
				return;
			}

			if (current.goal.status === "dropped") return;
			await this.#flushUsageLocked("suppressed");
			const state = this.#getStateClone();
			if (!state || state.goal.id !== goalId) {
				throw new Error(`goal "${goalId}" changed while dropping`);
			}
			const dropped = { ...state.goal, status: "dropped" as const, updatedAt: this.#now() };
			this.#clearActiveAccounting();
			this.#budgetReportedFor = undefined;
			await this.#host.emit({
				type: "goal_updated",
				goal: dropped,
				state: { ...state, enabled: false, goal: dropped },
			});
			await this.#commitState(undefined, { persist: "none", emit: false });
		});
	}

	async createGoal(input: { objective: string; tokenBudget?: number; workstream?: string }): Promise<GoalModeState> {
		const objective = input.objective.trim();
		if (!objective) throw new Error("objective is required when op=create");
		validateTokenBudget(input.tokenBudget);
		return await this.#withAccounting(async () => {
			const existing = this.#host.getState();
			if (existing?.goal && existing.goal.status !== "dropped" && existing.goal.status !== "complete") {
				throw new Error(
					`cannot create goal because existing goal is ${existing.goal.status}; use op=update to replace it`,
				);
			}
			await this.#classifyWorkstream(objective, input.workstream);
			const state = this.#createGoalState(objective, input.tokenBudget);
			this.#budgetReportedFor = undefined;
			this.#markActiveAccounting(state.goal);
			await this.#commitState(state, { persist: "goal" });
			return state;
		});
	}

	async replaceGoal(input: { objective: string; tokenBudget?: number; workstream?: string }): Promise<GoalModeState> {
		const objective = input.objective.trim();
		if (!objective) throw new Error("objective is required when op=update");
		validateTokenBudget(input.tokenBudget);
		return await this.#withAccounting(async () => {
			const existing = this.#host.getState();
			if (!existing?.goal) {
				throw new Error("cannot update goal because this session has no goal; use op=create");
			}
			if (existing.goal.status === "complete" || existing.goal.status === "dropped") {
				throw new Error(
					`cannot update goal because existing goal is ${existing.goal.status}; use op=create`,
				);
			}
			await this.#flushUsageLocked("suppressed");
			await this.#classifyWorkstream(objective, input.workstream);
			const state = this.#createGoalState(objective, input.tokenBudget);
			this.#budgetReportedFor = undefined;
			this.#markActiveAccounting(state.goal);
			await this.#commitState(state, { persist: "goal" });
			return state;
		});
	}

	async resumeGoal(): Promise<GoalModeState> {
		return await this.#withAccounting(async () => {
			const state = this.#getStateClone();
			if (!state?.goal) {
				throw new Error("cannot resume goal because this session has no goal; use op=create");
			}
			if (state.goal.status !== "paused") {
				const action =
					state.goal.status === "complete" || state.goal.status === "dropped"
						? "use op=create"
						: state.goal.status === "active"
							? "no action is needed"
							: "use op=update to replace it";
				throw new Error(`cannot resume goal because existing goal is ${state.goal.status}; ${action}`);
			}
			state.enabled = true;
			state.mode = "active";
			state.reason = undefined;
			state.goal.status = "active";
			state.goal.updatedAt = this.#now();
			this.#budgetReportedFor = undefined;
			this.#markActiveAccounting(state.goal);
			await this.#commitState(state, { persist: "goal" });
			return state;
		});
	}

	async pauseGoal(): Promise<GoalModeState | undefined> {
		return await this.#withAccounting(async () => {
			await this.#flushUsageLocked("suppressed");
			const state = this.#getStateClone();
			if (!state?.goal) return undefined;
			state.enabled = false;
			state.mode = "active";
			state.reason = undefined;
			if (state.goal.status === "active" || state.goal.status === "budget-limited") {
				state.goal.status = "paused";
			}
			state.goal.updatedAt = this.#now();
			this.#clearActiveAccounting();
			this.#budgetReportedFor = undefined;
			await this.#commitState(state, { persist: "goal_paused" });
			return state;
		});
	}

	async dropGoal(): Promise<Goal | undefined> {
		return await this.#withAccounting(async () => {
			await this.#flushUsageLocked("suppressed");
			const state = this.#getStateClone();
			if (!state?.goal) return undefined;
			const dropped = { ...state.goal, status: "dropped" as const, updatedAt: this.#now() };
			this.#clearActiveAccounting();
			this.#budgetReportedFor = undefined;
			await this.#host.emit({
				type: "goal_updated",
				goal: dropped,
				state: { ...state, enabled: false, goal: dropped },
			});
			await this.#commitState(undefined, { persist: "none", emit: false });
			return dropped;
		});
	}

	async completeGoalFromTool(): Promise<Goal> {
		return await this.#withAccounting(async () => {
			await this.#flushUsageLocked("suppressed");
			const state = this.#getStateClone();
			if (!state?.goal) {
				throw new Error("cannot complete goal because no goal is active");
			}
			if (state.goal.status === "complete") {
				throw new Error("goal is already complete");
			}
			if (state.goal.status === "dropped") {
				throw new Error("cannot complete a dropped goal");
			}
			state.enabled = false;
			state.goal.status = "complete";
			state.goal.updatedAt = this.#now();
			state.mode = "exiting";
			state.reason = "completed";
			this.#clearActiveAccounting();
			this.#budgetReportedFor = undefined;
			await this.#commitState(state, { persist: "goal" });
			return state.goal;
		});
	}

	buildActivePrompt(): string | undefined {
		const state = this.#host.getState();
		return state?.enabled && state.goal && state.goal.status === "active"
			? renderGoalPrompt("active", state.goal, this.getWorkstreamReference())
			: undefined;
	}

	buildContinuationPrompt(): string | undefined {
		const state = this.#host.getState();
		return state?.enabled && state.goal.status === "active"
			? renderGoalPrompt("continuation", state.goal, this.getWorkstreamReference())
			: undefined;
	}

	async #sendBudgetLimitSteer(goal: Goal): Promise<void> {
		if (this.#budgetReportedFor === goal.id) return;
		this.#budgetReportedFor = goal.id;
		await this.#host.sendHiddenMessage({
			customType: "goal-budget-limit",
			content: renderGoalPrompt("budget-limit", goal, this.getWorkstreamReference()),
			deliverAs: "steer",
		});
	}
}
