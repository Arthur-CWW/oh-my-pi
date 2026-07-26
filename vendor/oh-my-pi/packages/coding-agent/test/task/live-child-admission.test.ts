import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { HostResourceAdmission } from "@oh-my-pi/pi-coding-agent/resource/host-resource-admission";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { TaskTool } from "@oh-my-pi/pi-coding-agent/task";
import * as discoveryModule from "@oh-my-pi/pi-coding-agent/task/discovery";
import * as executorModule from "@oh-my-pi/pi-coding-agent/task/executor";
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
	sessionId?: string;
}): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		settings: Settings.isolated(options.settings ?? {}),
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		getAgentId: () => options.agentId,
		getSessionId: () => options.sessionId,
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

let root: string;
let previousHome: string | undefined;
let previousControlDb: string | undefined;

function expectLeaseLifecycle(attemptCount: number): void {
	const db = new Database(path.join(root, "irc-bus.sqlite"), { readonly: true });
	try {
		const events = db
			.query<{ event: string }, []>("SELECT event FROM test_resource_lease_events ORDER BY rowid")
			.all()
			.map(row => row.event);
		expect(events).toEqual(
			Array.from({ length: attemptCount }, () => ["acquired", "released"]).flat(),
		);
	} finally {
		db.close();
	}
}

describe("live child admission", () => {
	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-task-admission-"));
		previousHome = process.env.HOME;
		previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
		process.env.HOME = root;
		process.env.OMP_SESSION_CONTROL_DB = path.join(root, "session-control.sqlite");
		AgentRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
		HostResourceAdmission.resetGlobalForTests();
		HostResourceAdmission.global({
			dbPath: path.join(root, "irc-bus.sqlite"),
			maxLiveAttempts: 1,
			queuePollMs: 5,
		});
		const audit = new Database(path.join(root, "irc-bus.sqlite"));
		audit.run("CREATE TABLE test_resource_lease_events (event TEXT NOT NULL, attempt_id TEXT NOT NULL)");
		audit.run(`
			CREATE TRIGGER test_resource_lease_acquired
			AFTER INSERT ON resource_leases
			BEGIN
				INSERT INTO test_resource_lease_events (event, attempt_id) VALUES ('acquired', NEW.attempt_id);
			END
		`);
		audit.run(`
			CREATE TRIGGER test_resource_lease_released
			AFTER DELETE ON resource_leases
			BEGIN
				INSERT INTO test_resource_lease_events (event, attempt_id) VALUES ('released', OLD.attempt_id);
			END
		`);
		audit.close();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
		HostResourceAdmission.resetGlobalForTests();
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
		else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
		await fs.rm(root, { recursive: true, force: true });
	});


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
					settings: { "task.maxConcurrency": 1 },
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
			expectLeaseLifecycle(2);
		} finally {
			await manager.dispose({ timeoutMs: 1000 });
		}
	});

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
					settings: { "task.maxConcurrency": 1 },
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
			expectLeaseLifecycle(2);
		} finally {
			await manager.dispose({ timeoutMs: 1000 });
		}
	});

	it("routes every batch item through the width-one host authority", async () => {
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
					settings: { "task.maxConcurrency": 4, "task.batch": true },
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

			await pollUntil(() => admitted.length === 1);
			expect(admitted).toEqual(["A"]);
			for (const [index, id] of ["A", "B", "C", "D"].entries()) {
				gates.get(id)!.resolve();
				if (index < 3) {
					await pollUntil(() => admitted.length === index + 2);
					expect(admitted[index + 1]).toBe(["B", "C", "D"][index]);
				}
			}
			await manager.waitForAll();
			expect(peakLive).toBe(1);
			expectLeaseLifecycle(4);
		} finally {
			releaseImmediately = true;
			for (const gate of gates.values()) gate.resolve();
			await manager.dispose({ timeoutMs: 1000 });
		}
	});

	it("routes sync and nested TaskTools through the same host lease", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		const parentGate = deferred();
		const started: string[] = [];
		const leaseCounts: number[] = [];
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			const id = options.id ?? "?";
			started.push(id);
			leaseCounts.push(HostResourceAdmission.global().inspect().leases.length);
			if (id === "Parent") await parentGate.promise;
			return makeResult(id);
		});
		const parentTool = await TaskTool.create(
			createSession({ agentId: "Main", sessionId: "outer-session", settings: { "task.maxConcurrency": 8 } }),
		);
		const nestedTool = await TaskTool.create(
			createSession({ agentId: "Parent", sessionId: "nested-session", settings: { "task.maxConcurrency": 8 } }),
		);
		const parentRun = parentTool.execute("sync-parent", {
			agent: "task",
			id: "Parent",
			assignment: "Hold the global lease.",
		} as TaskParams);
		await pollUntil(() => started.length === 1);
		const nestedRun = nestedTool.execute("sync-nested", {
			agent: "task",
			id: "Nested",
			assignment: "Wait for the same global lease.",
		} as TaskParams);
		await pollUntil(() => HostResourceAdmission.global().inspect().waiters.length === 1);
		expect(started).toEqual(["Parent"]);
		parentGate.resolve();
		await Promise.all([parentRun, nestedRun]);
		expect(started).toEqual(["Parent", "Nested"]);
		expect(leaseCounts).toEqual([1, 1]);
		expect(HostResourceAdmission.global().inspect()).toMatchObject({ leases: [], waiters: [] });
		expectLeaseLifecycle(2);
	});
});
