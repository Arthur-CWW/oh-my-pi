/**
 * Contracts: task tool spawn routing (rework-contracts.md §3).
 *
 * 1. With an AsyncJobManager wired, `execute` returns immediately (agent id +
 *    job id) while the job body is still gated; job completion delivers a
 *    result carrying the irc follow-up / `history://<id>` hint.
 * 2. The session-scoped spawn semaphore (task.maxConcurrency) serializes job
 *    bodies: with concurrency 1 the second body does not start until the
 *    first releases.
 *
 * Param validation (missing agent / missing assignment) is covered by
 * test/task/task-schema.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { TaskTool } from "@oh-my-pi/pi-coding-agent/task";
import * as discoveryModule from "@oh-my-pi/pi-coding-agent/task/discovery";
import * as executorModule from "@oh-my-pi/pi-coding-agent/task/executor";
import type { AgentDefinition, SingleResult, TaskParams } from "@oh-my-pi/pi-coding-agent/task/types";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";

const taskAgent: AgentDefinition = {
	name: "task",
	description: "General-purpose task agent",
	systemPrompt: "You are a task agent.",
	source: "bundled",
};

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

function getFirstText(result: { content: Array<{ type: string; text?: string }> }): string {
	const content = result.content.find(part => part.type === "text");
	return content?.type === "text" ? (content.text ?? "") : "";
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

interface Deferred {
	promise: Promise<void>;
	resolve: () => void;
}

function deferred(): Deferred {
	const { promise, resolve } = Promise.withResolvers<void>();
	return { promise, resolve };
}

function registerRevivableParked(id: string): void {
	AgentRegistry.global().register({
		id,
		displayName: id,
		kind: "sub",
		parentId: "Main",
		session: null,
		sessionFile: `/tmp/${id}.jsonl`,
		status: "parked",
	});
	AgentLifecycleManager.global().adopt(id, {
		idleTtlMs: 0,
		revive: async () => {
			throw new Error("revive should not run in this test");
		},
	});
}

async function pollUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("pollUntil timed out");
		await Bun.sleep(5);
	}
}

describe("task spawn routing", () => {
	const managers: AsyncJobManager[] = [];

	function createManager(): AsyncJobManager {
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		managers.push(manager);
		return manager;
	}

	beforeEach(() => {
		AgentRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		for (const manager of managers.splice(0)) {
			await manager.dispose({ timeoutMs: 1000 });
		}
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
	});

	it("returns immediately on spawn and delivers the follow-up hint when the job completes", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		const gate = deferred();
		const runSpy = vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			await gate.promise;
			const id = options.id ?? "?";
			registerRevivableParked(id);
			return makeResult(id);
		});

		const manager = createManager();
		const tool = await TaskTool.create(createSession({ manager, agentId: "Main" }));

		const result = await tool.execute("tc-spawn", {
			agent: "task",
			id: "Spawnling",
			description: "background work",
			assignment: "Do the thing.",
		} as TaskParams);

		// Tool returned while the job body is still gated on the deferred.
		const text = getFirstText(result);
		expect(text).toContain("Spawned agent `Spawnling`");
		const jobId = result.details?.async?.jobId;
		expect(jobId).toBeTruthy();
		expect(text).toContain(`job \`${jobId}\``);
		const job = manager.getJob(jobId!);
		expect(job?.status).toBe("running");
		expect(job?.resultText).toBeUndefined();
		expect(job?.group).toEqual({ groupId: "Main", topology: "flat", reporting: "main" });

		gate.resolve();
		await job!.promise;

		expect(job!.status).toBe("completed");
		expect(job!.resultText).toContain("Spawnling remains addressable after this job");
		expect(job!.resultText).toContain('op:"send", to:"Spawnling"');
		expect(job!.resultText).toContain("history://Spawnling");
		expect(runSpy).toHaveBeenCalledTimes(1);
		expect(runSpy.mock.calls[0]?.[0]?.parentAgentId).toBe("Main");
	});

	it("refuses a NameResume duplicate when the parked agent can be revived", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		const runSpy = vi.spyOn(executorModule, "runSubprocess");
		const registry = AgentRegistry.global();
		registry.register({
			id: "Foo",
			displayName: "Foo",
			kind: "sub",
			parentId: "Main",
			session: null,
			sessionFile: "/tmp/Foo.jsonl",
			status: "parked",
		});
		AgentLifecycleManager.global().adopt("Foo", {
			idleTtlMs: 0,
			revive: async () => {
				throw new Error("revive should not run during duplicate detection");
			},
		});

		const manager = createManager();
		const tool = await TaskTool.create(createSession({ manager, agentId: "Main" }));
		const result = await tool.execute("tc-resume-duplicate", {
			agent: "task",
			id: "FooResume",
			assignment: "Continue Foo's work.",
		} as TaskParams);

		const text = getFirstText(result);
		expect(text).toContain("Spawn refused");
		expect(text).toContain("existing agent `Foo` (parked, revivable)");
		expect(text).toContain('op:"send", to:"Foo"');
		expect(text).toContain("history://Foo");
		expect(text).toContain("resumes it in place with context intact");
		expect(runSpy).not.toHaveBeenCalled();
		expect(manager.getAllJobs()).toHaveLength(0);
	});

	it("refuses an exact revivable id instead of silently allocating a dedupe suffix", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		const registry = AgentRegistry.global();
		registry.register({
			id: "Foo",
			displayName: "Foo",
			kind: "sub",
			parentId: "Main",
			session: null,
			sessionFile: "/tmp/Foo.jsonl",
			status: "parked",
		});
		AgentLifecycleManager.global().adopt("Foo", {
			idleTtlMs: 0,
			revive: async () => {
				throw new Error("revive should not run during duplicate detection");
			},
		});

		const manager = createManager();
		const tool = await TaskTool.create(createSession({ manager, agentId: "Main" }));
		const result = await tool.execute("tc-exact-duplicate", {
			agent: "task",
			id: "Foo",
			assignment: "Repeat Foo's work.",
		} as TaskParams);

		const text = getFirstText(result);
		expect(text).toContain("Spawn refused");
		expect(text).toContain("agent `Foo` is the same id as existing agent `Foo`");
		expect(text).not.toContain("Foo-2");
		expect(manager.getAllJobs()).toHaveLength(0);
	});

	it("refuses a running exact match and routes the caller to irc instead of a suffixed duplicate", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => makeResult(options.id ?? "?"));
		AgentRegistry.global().register({
			id: "Foo",
			displayName: "Foo",
			kind: "sub",
			parentId: "Main",
			session: null,
			status: "running",
		});

		const manager = createManager();
		const tool = await TaskTool.create(createSession({ manager, agentId: "Main" }));
		const result = await tool.execute("tc-running-duplicate", {
			agent: "task",
			id: "Foo",
			assignment: "Repeat Foo's work.",
		} as TaskParams);

		const text = getFirstText(result);
		expect(text).toContain("Spawn refused");
		expect(text).toContain('op:"send", to:"Foo"');
		expect(text).toContain("history://Foo");
		expect(result.details?.async).toBeUndefined();
		expect(AgentRegistry.global().get("Foo-2")).toBeUndefined();
	});

	it("delivers resume-in-place guidance when a started task job fails", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			const id = options.id ?? "?";
			registerRevivableParked(id);
			return makeResult(id, {
				exitCode: 1,
				output: "Worker failed.",
				error: "provider failed",
			});
		});

		const manager = createManager();
		const tool = await TaskTool.create(createSession({ manager, agentId: "Main" }));
		const result = await tool.execute("tc-failed-delivery", {
			agent: "task",
			id: "FailingWorker",
			assignment: "Attempt the work.",
		} as TaskParams);
		const job = manager.getJob(result.details!.async!.jobId)!;
		await job.promise;

		expect(job.status).toBe("failed");
		expect(job.errorText).toContain("FailingWorker remains addressable after this job");
		expect(job.errorText).toContain('op:"send", to:"FailingWorker"');
		expect(job.errorText).toContain("resume it in place with context intact");
		expect(job.errorText).toContain("history://FailingWorker");
	});

	it("delivers transcript salvage guidance when a failed agent is no longer addressable", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options =>
			makeResult(options.id ?? "?", {
				exitCode: 1,
				output: "Worker terminated.",
				error: "cancelled",
			}),
		);

		const manager = createManager();
		const tool = await TaskTool.create(createSession({ manager, agentId: "Main" }));
		const result = await tool.execute("tc-terminated-delivery", {
			agent: "task",
			id: "TerminatedWorker",
			assignment: "Attempt the work.",
		} as TaskParams);
		const job = manager.getJob(result.details!.async!.jobId)!;
		await job.promise;

		expect(job.status).toBe("failed");
		expect(job.errorText).toContain("TerminatedWorker is no longer addressable");
		expect(job.errorText).toContain("Salvage its transcript at history://TerminatedWorker");
		expect(job.errorText).not.toContain('op:"send", to:"TerminatedWorker"');
	});

	it("derives a supervised group snapshot from nested registry parentage", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		const registry = AgentRegistry.global();
		registry.register({ id: "Hub", displayName: "Hub", kind: "sub", parentId: "Main", session: null });
		registry.register({ id: "Leaf", displayName: "Leaf", kind: "sub", parentId: "Hub", session: null });
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => makeResult(options.id ?? "?"));

		const manager = createManager();
		manager.configureGroup("Hub", { topology: "supervised", reporting: "hub" });
		const tool = await TaskTool.create(createSession({ manager, agentId: "Leaf" }));
		const result = await tool.execute("tc-nested", {
			agent: "task",
			id: "Nested",
			assignment: "Do the nested thing.",
		} as TaskParams);

		expect(manager.getJob(result.details!.async!.jobId)?.group).toEqual({
			groupId: "Hub",
			coordinatorId: "Leaf",
			topology: "supervised",
			reporting: "hub",
		});
	});

	it("reserves a starting identity before the gated job body builds a session", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		const gate = deferred();
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			await gate.promise;
			const id = options.id ?? "?";
			registerRevivableParked(id);
			return makeResult(id);
		});

		const manager = createManager();
		const tool = await TaskTool.create(createSession({ manager, agentId: "Main" }));
		const result = await tool.execute("tc-starting", {
			agent: "task",
			id: "Queued",
			assignment: "Do the queued thing.",
		} as TaskParams);

		// The tool has returned while the job body is still gated inside the
		// executor, so the child has not built a session yet — but its identity
		// is reserved as durable `starting` work rather than reported unknown.
		const ref = AgentRegistry.global().get("Queued");
		expect(ref).toBeDefined();
		expect(ref?.starting).toBe(true);
		expect(ref?.session).toBeNull();
		expect(ref?.status).toBe("running");
		expect(AgentRegistry.global().get("NeverSpawned")).toBeUndefined();

		gate.resolve();
		await manager.getJob(result.details!.async!.jobId)!.promise;
		// Coming live clears the reserve flag (here the executor parks it).
		expect(AgentRegistry.global().get("Queued")?.starting).toBeFalsy();
	});

	it("finalizes a failed-startup identity as terminal, keeping it inspectable not unknown", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async () => {
			throw new Error("provider blocked before the session was built");
		});

		const manager = createManager();
		const tool = await TaskTool.create(createSession({ manager, agentId: "Main" }));
		const result = await tool.execute("tc-start-fail", {
			agent: "task",
			id: "StartupFailer",
			assignment: "Attempt the work.",
		} as TaskParams);
		await manager.getJob(result.details!.async!.jobId)!.promise;

		// The reserved identity is never lost: it stays registered (known) and
		// terminal (aborted), not a phantom `starting` row and not unknown.
		const ref = AgentRegistry.global().get("StartupFailer");
		expect(ref).toBeDefined();
		expect(ref?.status).toBe("aborted");
		expect(ref?.starting).toBeFalsy();
	});
});
