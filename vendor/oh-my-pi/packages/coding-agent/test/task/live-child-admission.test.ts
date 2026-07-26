import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { TaskTool } from "@oh-my-pi/pi-coding-agent/task";
import * as discoveryModule from "@oh-my-pi/pi-coding-agent/task/discovery";
import * as executorModule from "@oh-my-pi/pi-coding-agent/task/executor";
import { resolveSpawnConcurrency, Semaphore } from "@oh-my-pi/pi-coding-agent/task/parallel";
import type { AgentDefinition, SingleResult, TaskParams } from "@oh-my-pi/pi-coding-agent/task/types";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";

interface Deferred {
	promise: Promise<void>;
	resolve: () => void;
}

function deferred(): Deferred {
	const { promise, resolve } = Promise.withResolvers<void>();
	return { promise, resolve };
}

function createSession(options: {
	manager?: AsyncJobManager;
	settings?: Record<string, unknown>;
	agentId?: string;
}): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		settings: Settings.isolated(options.settings ?? {}),
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		getAgentId: () => options.agentId,
		asyncJobManager: options.manager,
	} as unknown as ToolSession;
}

function makeResult(id: string, overrides: Partial<SingleResult> = {}): SingleResult {
	return {
		index: 0,
		id,
		agent: "task",
		agentSource: "bundled",
		task: "task prompt",
		assignment: "Do the thing.",
		exitCode: 0,
		output: "All done.",
		stderr: "",
		truncated: false,
		durationMs: 5,
		tokens: 0,
		requests: 1,
		...overrides,
	};
}

async function pollUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("pollUntil timed out");
		await Bun.sleep(5);
	}
}

const taskAgent: AgentDefinition = {
	name: "task",
	description: "General-purpose task agent",
	systemPrompt: "You are a task agent.",
	source: "bundled",
};

describe("live child admission", () => {
	beforeEach(() => {
		AgentRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
	});

	it("admits FIFO, caps live children, and completes every queued spawn", async () => {
		const admission = new Semaphore(resolveSpawnConcurrency(32, 2));
		const gates = Array.from({ length: 5 }, () => deferred());
		const admitted: number[] = [];
		let live = 0;
		let peakLive = 0;

		const children = gates.map(async (gate, index) => {
			await admission.acquire();
			admitted.push(index);
			live++;
			peakLive = Math.max(peakLive, live);
			try {
				await gate.promise;
				return index;
			} finally {
				live--;
				admission.release();
			}
		});

		await Promise.resolve();
		expect(admitted).toEqual([0, 1]);
		for (let index = 0; index < gates.length; index++) {
			gates[index]!.resolve();
			await Promise.resolve();
			await Promise.resolve();
		}

		expect(await Promise.all(children)).toEqual([0, 1, 2, 3, 4]);
		expect(admitted).toEqual([0, 1, 2, 3, 4]);
		expect(peakLive).toBe(2);
	});

	it("gives nested children their own budget under a saturated parent", async () => {
		const parentAdmission = new Semaphore(1);
		const nestedAdmission = new Semaphore(1);
		await parentAdmission.acquire();

		const grandchild = (async () => {
			await nestedAdmission.acquire();
			try {
				return "grandchild completed";
			} finally {
				nestedAdmission.release();
			}
		})();

		expect(await grandchild).toBe("grandchild completed");
		parentAdmission.release();
	});

	it("starts a queued child's runtime budget only after admission", async () => {
		const admission = new Semaphore(1);
		const work = deferred();
		await admission.acquire();
		let runtimeStarted = false;

		const queuedChild = (async () => {
			await admission.acquire();
			runtimeStarted = true;
			try {
				await work.promise;
				return "completed";
			} finally {
				admission.release();
			}
		})();

		await Promise.resolve();
		expect(runtimeStarted).toBe(false);
		admission.release();
		await Promise.resolve();
		await Promise.resolve();
		expect(runtimeStarted).toBe(true);
		work.resolve();
		expect(await queuedChild).toBe("completed");
	});

	it("keeps historical concurrency when the live-child cap is unset", () => {
		expect(resolveSpawnConcurrency(32, 0)).toBe(32);
		expect(resolveSpawnConcurrency(7, 0)).toBe(7);
	});

	it("removes an aborted FIFO waiter without leaking or stealing the next slot", async () => {
		const admission = new Semaphore(1);
		await admission.acquire();
		const aborted = new AbortController();
		const first = admission.acquire(undefined, aborted.signal);
		let secondAdmitted = false;
		const second = admission.acquire().then(() => {
			secondAdmitted = true;
		});

		aborted.abort(new Error("cancel queued admission"));
		await expect(first).rejects.toThrow("cancel queued admission");
		admission.release();
		await second;

		expect(secondAdmitted).toBe(true);
		admission.release();
		await admission.acquire();
		admission.release();
	});

	// review-added
	it("cancels a queued spawn before the occupied slot releases without leaking admission", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		const gate = deferred();
		const firstStarted = deferred();
		const runSpy = vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			if (options.id === "First") firstStarted.resolve();
			await gate.promise;
			return makeResult(options.id ?? "?");
		});

		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		try {
			const tool = await TaskTool.create(
				createSession({
					manager,
					agentId: "Main",
					settings: { "task.maxConcurrency": 1, "task.maxLiveChildren": 1 },
				}),
			);

			const first = await tool.execute("tc-cancel-1", {
				agent: "task",
				id: "First",
				assignment: "Work A.",
			} as TaskParams);
			const firstJob = manager.getJob(first.details!.async!.jobId)!;
			await firstStarted.promise;

			const second = await tool.execute("tc-cancel-2", {
				agent: "task",
				id: "Second",
				assignment: "Work B.",
			} as TaskParams);
			const secondJob = manager.getJob(second.details!.async!.jobId)!;
			const third = await tool.execute("tc-cancel-3", {
				agent: "task",
				id: "Third",
				assignment: "Work C.",
			} as TaskParams);
			const thirdJob = manager.getJob(third.details!.async!.jobId)!;
			expect(secondJob.queued).toBe(true);
			expect(thirdJob.queued).toBe(true);

			expect(manager.cancel(secondJob.id)).toBe(true);
			await secondJob.promise;

			expect(secondJob.status).toBe("cancelled");
			expect(firstJob.status).toBe("running");
			expect(firstJob.queued).toBe(false);
			expect(thirdJob.queued).toBe(true);
			expect(runSpy.mock.calls.map(call => call[0].id)).toEqual(["First"]);

			gate.resolve();
			await Promise.all([firstJob.promise, thirdJob.promise]);

			expect(firstJob.status).toBe("completed");
			expect(thirdJob.status).toBe("completed");
			expect(runSpy.mock.calls.map(call => call[0].id)).toEqual(["First", "Third"]);
		} finally {
			await manager.dispose({ timeoutMs: 1000 });
		}
	});

	// review-added
	it("releases the admission slot when a child throws during startup so the next spawn admits", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		const runSpy = vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			const id = options.id ?? "?";
			if (id === "First") {
				throw new Error("startup failure");
			}
			return makeResult(id);
		});

		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		try {
			const tool = await TaskTool.create(
				createSession({
					manager,
					agentId: "Main",
					settings: { "task.maxConcurrency": 1, "task.maxLiveChildren": 1 },
				}),
			);

			const first = await tool.execute("tc-throw-1", {
				agent: "task",
				id: "First",
				assignment: "Work A.",
			} as TaskParams);
			const second = await tool.execute("tc-throw-2", {
				agent: "task",
				id: "Second",
				assignment: "Work B.",
			} as TaskParams);

			const firstJob = manager.getJob(first.details!.async!.jobId)!;
			const secondJob = manager.getJob(second.details!.async!.jobId)!;

			await manager.waitForAll();

			expect(firstJob.status).toBe("failed");
			expect(secondJob.status).toBe("completed");
			expect(runSpy).toHaveBeenCalledTimes(2);
		} finally {
			await manager.dispose({ timeoutMs: 1000 });
		}
	});

	// review-added
	it("admits batch spawns in FIFO order under a live-child cap", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		const admitted: string[] = [];
		const gates = new Map<string, Deferred>();
		let live = 0;
		let peakLive = 0;
		let releaseImmediately = false;
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			const id = options.id ?? "?";
			admitted.push(id);
			live++;
			peakLive = Math.max(peakLive, live);
			const gate = deferred();
			gates.set(id, gate);
			if (releaseImmediately) gate.resolve();
			try {
				await gate.promise;
				return makeResult(id);
			} finally {
				live--;
			}
		});

		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		try {
			const tool = await TaskTool.create(
				createSession({
					manager,
					agentId: "Main",
					settings: { "task.maxConcurrency": 2, "task.maxLiveChildren": 2, "task.batch": true },
				}),
			);

			await tool.execute("tc-fifo", {
				agent: "task",
				context: "shared context",
				tasks: [
					{ id: "A", assignment: "Work A." },
					{ id: "B", assignment: "Work B." },
					{ id: "C", assignment: "Work C." },
					{ id: "D", assignment: "Work D." },
				],
			} as TaskParams);

			await pollUntil(() => admitted.length === 2);
			expect(new Set(admitted)).toEqual(new Set(["A", "B"]));

			gates.get("A")!.resolve();
			await pollUntil(() => admitted.length === 3);
			expect(admitted[2]).toBe("C");

			gates.get("B")!.resolve();
			await pollUntil(() => admitted.length === 4);
			expect(admitted[3]).toBe("D");

			gates.get("C")!.resolve();
			gates.get("D")!.resolve();
			await manager.waitForAll();
			expect(peakLive).toBe(2);
		} finally {
			releaseImmediately = true;
			for (const gate of gates.values()) gate.resolve();
			await manager.dispose({ timeoutMs: 1000 });
		}
	});
});
