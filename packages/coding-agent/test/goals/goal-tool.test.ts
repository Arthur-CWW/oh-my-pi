import { describe, expect, it, vi } from "bun:test";
import { completionUsageReport, GoalRuntime } from "@oh-my-pi/pi-coding-agent/goals/runtime";
import type { Goal, GoalModeState, GoalTokenUsage } from "@oh-my-pi/pi-coding-agent/goals/state";
import { GoalTool } from "@oh-my-pi/pi-coding-agent/goals/tools/goal-tool";
import type { SessionWorkstream } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { ToolError } from "@oh-my-pi/pi-coding-agent/tools/tool-errors";

function createUsage(overrides: Partial<GoalTokenUsage> = {}): GoalTokenUsage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		...overrides,
	};
}

function createGoal(overrides: Partial<Goal> = {}): Goal {
	return {
		id: "goal-1",
		objective: "Ship it",
		status: "active",
		tokensUsed: 0,
		timeUsedSeconds: 0,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

function cloneState(state: GoalModeState | undefined): GoalModeState | undefined {
	return state ? { ...state, goal: { ...state.goal } } : undefined;
}

function createToolSession(overrides: Partial<ToolSession>): ToolSession {
	return overrides as ToolSession;
}

function createRuntimeHarness(initialState?: GoalModeState) {
	let state = cloneState(initialState);
	let workstream: SessionWorkstream | undefined;
	const runtime = new GoalRuntime({
		getState: () => cloneState(state),
		setState: next => {
			state = cloneState(next);
		},
		getWorkstream: () => workstream,
		setWorkstream: async next => {
			workstream = { ...next };
			return true;
		},
		getCurrentUsage: () => createUsage(),
		emit: async () => {},
		persist: (_mode, _state) => {},
		sendHiddenMessage: async _message => {},
		now: () => 0,
	});
	return {
		runtime,
		getState: () => cloneState(state),
	};
}

describe("GoalTool", () => {
	it("routes create/get/complete operations and returns completion usage details", async () => {
		const createGoalState: GoalModeState = {
			enabled: true,
			mode: "active",
			goal: createGoal({ objective: "Create route" }),
		};
		const getGoalState: GoalModeState = {
			enabled: true,
			mode: "active",
			goal: createGoal({ objective: "Get route", tokensUsed: 4 }),
		};
		const completedGoal = createGoal({
			objective: "Complete route",
			status: "complete",
			tokensUsed: 7,
			timeUsedSeconds: 3,
		});
		const runtime = {
			createGoal: vi.fn(async () => createGoalState),
			completeGoalFromTool: vi.fn(async () => completedGoal),
			getWorkstreamReference: () => ({
				kind: "workstream" as const,
				id: "create-route",
				charterPath: "streams/create-route/GOAL.md",
			}),
		};
		const getGoalModeState = vi.fn(() => getGoalState);
		const tool = new GoalTool(
			createToolSession({
				getGoalRuntime: () => runtime as unknown as GoalRuntime,
				getGoalModeState,
			}),
		);

		const created = await tool.execute("call-create", {
			op: "create",
			objective: "  Create route  ",
			workstream: "create-route",
		});
		expect(runtime.createGoal).toHaveBeenCalledWith({
			objective: "Create route",
			workstream: "create-route",
		});
		expect(created.details).toMatchObject({
			op: "create",
			goal: createGoalState.goal,
			workstream: {
				kind: "workstream",
				id: "create-route",
				charterPath: "streams/create-route/GOAL.md",
			},
			completionUsageReport: null,
		});
		expect(created.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("Workstream: create-route · streams/create-route/GOAL.md"),
		});

		const fetched = await tool.execute("call-get", { op: "get" });
		expect(getGoalModeState).toHaveBeenCalledTimes(1);
		expect(fetched.details).toMatchObject({
			op: "get",
			goal: getGoalState.goal,
			completionUsageReport: null,
		});
		expect(runtime.completeGoalFromTool).not.toHaveBeenCalled();

		const completed = await tool.execute("call-complete", { op: "complete" });
		expect(runtime.completeGoalFromTool).toHaveBeenCalledTimes(1);
		expect(completed.details).toMatchObject({
			op: "complete",
			goal: completedGoal,
			completionUsageReport: completionUsageReport(completedGoal),
		});
		expect(completed.content[0]).toEqual({
			type: "text",
			text: "Goal: Complete route\nStatus: complete\nTokens: 7 used\nWorkstream: create-route · streams/create-route/GOAL.md\n\nGoal achieved. Report final usage to the user: tokens used: 7; time used: 3 seconds.",
		});
	});

	it("converges create, update, and resume wrappers on the set lifecycle", async () => {
		const cases: Array<{
			status: Goal["status"] | "absent";
			create: "success";
			update: "success";
			resume: "success" | string;
		}> = [
			{
				status: "absent",
				create: "success",
				update: "success",
				resume: "cannot activate goal because this session has no goal; set an objective",
			},
			{
				status: "active",
				create: "success",
				update: "success",
				resume: "success",
			},
			{
				status: "paused",
				create: "success",
				update: "success",
				resume: "success",
			},
			{
				status: "complete",
				create: "success",
				update: "success",
				resume: "cannot activate goal because existing goal is complete; set an objective",
			},
			{
				status: "dropped",
				create: "success",
				update: "success",
				resume: "cannot activate goal because existing goal is dropped; set an objective",
			},
		];

		const initialState = (status: Goal["status"] | "absent"): GoalModeState | undefined => {
			if (status === "absent") return undefined;
			return {
				enabled: status === "active",
				mode: status === "complete" ? "exiting" : "active",
				reason: status === "complete" ? "completed" : undefined,
				goal: createGoal({ status, tokensUsed: 7, timeUsedSeconds: 3 }),
			};
		};
		const setup = (status: Goal["status"] | "absent") => {
			const harness = createRuntimeHarness(initialState(status));
			const tool = new GoalTool(
				createToolSession({
					getGoalRuntime: () => harness.runtime,
					getGoalModeState: () => harness.getState(),
				}),
			);
			return { harness, tool };
		};

		for (const testCase of cases) {
			const create = setup(testCase.status);
			const createCall = create.tool.execute(`create-${testCase.status}`, {
				op: "create",
				objective: "Created",
			});
			if (testCase.create === "success") {
				const result = await createCall;
				expect(result.details?.goal).toMatchObject({
					objective: "Created",
					status: "active",
					tokensUsed: 0,
					timeUsedSeconds: 0,
				});
			} else {
				await expect(createCall).rejects.toThrow(testCase.create);
			}

			const update = setup(testCase.status);
			const updateCall = update.tool.execute(`update-${testCase.status}`, {
				op: "update",
				objective: "Updated",
			});
			if (testCase.update === "success") {
				const result = await updateCall;
				expect(result.details?.goal).toMatchObject({
					objective: "Updated",
					status: "active",
					tokensUsed: 0,
					timeUsedSeconds: 0,
				});
				expect(result.details?.goal?.id).not.toBe("goal-1");
				expect(update.harness.getState()?.enabled).toBe(true);
			} else {
				await expect(updateCall).rejects.toThrow(testCase.update);
			}

			const resume = setup(testCase.status);
			const resumeCall = resume.tool.execute(`resume-${testCase.status}`, { op: "resume" });
			if (testCase.resume === "success") {
				const result = await resumeCall;
				expect(result.details?.goal).toMatchObject({
					id: "goal-1",
					status: "active",
					tokensUsed: 7,
					timeUsedSeconds: 3,
				});
				expect(resume.harness.getState()?.enabled).toBe(true);
			} else {
				await expect(resumeCall).rejects.toThrow(testCase.resume);
			}
		}
	});



	it("rejects op=update when the objective is missing or only whitespace", async () => {
		const harness = createRuntimeHarness();
		await harness.runtime.createGoal({ objective: "Existing" });
		const tool = new GoalTool(
			createToolSession({
				getGoalRuntime: () => harness.runtime,
				getGoalModeState: () => harness.getState(),
			}),
		);

		await expect(tool.execute("call-empty-update", { op: "update", objective: "   \t\n" })).rejects.toThrow(
			"objective is required when op=update",
		);
		expect(harness.getState()?.goal.objective).toBe("Existing");
	});

	it("rejects complete when no goal is active", async () => {
		const harness = createRuntimeHarness();
		const tool = new GoalTool(
			createToolSession({
				getGoalRuntime: () => harness.runtime,
				getGoalModeState: () => harness.getState(),
			}),
		);

		await expect(tool.execute("call-complete", { op: "complete" })).rejects.toThrow(
			"cannot complete goal because no goal is active",
		);
	});

	it("rejects op=create when the objective is missing or only whitespace", async () => {
		const harness = createRuntimeHarness();
		const tool = new GoalTool(
			createToolSession({
				getGoalRuntime: () => harness.runtime,
				getGoalModeState: () => harness.getState(),
			}),
		);

		await expect(tool.execute("call-empty", { op: "create", objective: "   \t\n" })).rejects.toThrow(
			"objective is required when op=create",
		);
		expect(harness.getState()).toBeUndefined();
	});


	it("rejects an invalid explicit workstream as a tool error before goal creation", async () => {
		const harness = createRuntimeHarness();
		const tool = new GoalTool(
			createToolSession({
				getGoalRuntime: () => harness.runtime,
				getGoalModeState: () => harness.getState(),
			}),
		);

		await expect(
			tool.execute("call-invalid-workstream", {
				op: "create",
				objective: "Ship it",
				workstream: "Feature X",
			}),
		).rejects.toBeInstanceOf(ToolError);
		expect(harness.getState()).toBeUndefined();
	});

	it("flips state to exiting and clears enabled when op=complete succeeds (fix #1)", async () => {
		const harness = createRuntimeHarness();
		await harness.runtime.createGoal({ objective: "Ship the release" });
		const tool = new GoalTool(
			createToolSession({
				getGoalRuntime: () => harness.runtime,
				getGoalModeState: () => harness.getState(),
			}),
		);

		const result = await tool.execute("call-complete", { op: "complete" });

		expect(result.details).toMatchObject({ op: "complete" });
		const after = harness.getState();
		expect(after?.enabled).toBe(false);
		expect(after?.mode).toBe("exiting");
		expect(after?.reason).toBe("completed");
		expect(after?.goal.status).toBe("complete");
	});

	it("completes a paused goal (enabled=false) — was broken before fix", async () => {
		const harness = createRuntimeHarness({
			enabled: false,
			mode: "active",
			goal: createGoal({ objective: "Paused work", status: "paused" }),
		});
		const tool = new GoalTool(
			createToolSession({
				getGoalRuntime: () => harness.runtime,
				getGoalModeState: () => harness.getState(),
			}),
		);

		const result = await tool.execute("call-complete", { op: "complete" });
		expect(result.details?.goal?.status).toBe("complete");
		expect(harness.getState()?.goal.status).toBe("complete");
	});


	it("op=get returns a paused goal even when enabled=false", async () => {
		const harness = createRuntimeHarness({
			enabled: false,
			mode: "active",
			goal: createGoal({ status: "paused" }),
		});
		const tool = new GoalTool(
			createToolSession({
				getGoalRuntime: () => harness.runtime,
				getGoalModeState: () => harness.getState(),
			}),
		);

		const result = await tool.execute("call-get", { op: "get" });
		expect(result.details?.goal?.status).toBe("paused");
		expect(result.details?.goal?.objective).toBe("Ship it");
	});


	it("op=drop clears goal state", async () => {
		const harness = createRuntimeHarness({
			enabled: true,
			mode: "active",
			goal: createGoal({ objective: "Drop me" }),
		});
		const tool = new GoalTool(
			createToolSession({
				getGoalRuntime: () => harness.runtime,
				getGoalModeState: () => harness.getState(),
			}),
		);

		const result = await tool.execute("call-drop", { op: "drop" });
		expect(result.details?.op).toBe("drop");
		expect(result.details?.goal?.status).toBe("dropped");
		expect(harness.getState()).toBeUndefined();
	});
});
