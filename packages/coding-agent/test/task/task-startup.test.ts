import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { computePolicyRecordHash } from "@oh-my-pi/pi-coding-agent/policy/policy-journal";
import {
	POLICY_GENESIS_HASH,
	POLICY_REGISTRY_VERSION,
	type PolicyTransactionV1,
} from "@oh-my-pi/pi-coding-agent/policy/policy-records";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { TaskStartupError, TaskTool } from "@oh-my-pi/pi-coding-agent/task";
import * as discoveryModule from "@oh-my-pi/pi-coding-agent/task/discovery";
import * as executorModule from "@oh-my-pi/pi-coding-agent/task/executor";
import { configureSpawnPolicyRouting } from "@oh-my-pi/pi-coding-agent/task/spawn-route";
import type { AgentDefinition, SingleResult, TaskParams } from "@oh-my-pi/pi-coding-agent/task/types";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";

const librarianAgent: AgentDefinition = {
	name: "librarian",
	description: "Source-verified research agent",
	systemPrompt: "Research the assigned source.",
	model: ["openai-codex/gpt-5.6-luna:medium"],
	source: "bundled",
};

const lunaModel = buildModel({
	id: "gpt-5.6-luna",
	name: "GPT-5.6 Luna",
	api: "openai-responses",
	provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 8_192,
});

const modelRegistry = {
	getAvailable: () => [lunaModel],
};

interface Fixture {
	root: string;
	policyDirectory: string;
	parentFile: string;
	artifactsDirectory: string;
}

const roots: string[] = [];
const managers: AsyncJobManager[] = [];

async function createFixture(registryVersion = 4): Promise<Fixture> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "task-startup-"));
	roots.push(root);
	const policyDirectory = path.join(root, "policy");
	const parentFile = path.join(root, "parent.jsonl");
	const artifactsDirectory = parentFile.slice(0, -".jsonl".length);
	await fs.mkdir(policyDirectory, { recursive: true });
	await fs.writeFile(parentFile, "{}\n", "utf8");

	const base = {
		recordType: "policy-transaction" as const,
		schemaVersion: 1 as const,
		transactionId: randomUUID(),
		sequence: 1,
		previousHash: POLICY_GENESIS_HASH,
		createdAt: "2026-07-27T00:00:00.000Z",
		effectiveFrom: "2026-07-27T00:00:00.000Z",
		author: { kind: "cli" as const, uid: 501, pid: 1 },
		source: { kind: "cli" as const, uri: "task-startup-fixture" },
		reason: "Exercise an older persistent policy registry",
		registry: { version: registryVersion, digest: "a".repeat(64) },
		mutations: [
			{
				op: "set" as const,
				key: "core.routing.default" as const,
				scope: { kind: "global" as const },
				fragmentVersion: 1 as const,
				value: "openai-codex/gpt-5.6-luna:medium",
			},
		],
	};
	const record = {
		...base,
		recordHash: computePolicyRecordHash(base as Omit<PolicyTransactionV1, "recordHash">),
	};
	await fs.writeFile(path.join(policyDirectory, "policy-v1.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
	return { root, policyDirectory, parentFile, artifactsDirectory };
}

function createManager(): AsyncJobManager {
	const manager = new AsyncJobManager({ onJobComplete: () => {} });
	managers.push(manager);
	return manager;
}

function createSession(fixture: Fixture, manager: AsyncJobManager, asyncEnabled = true): ToolSession {
	return {
		cwd: fixture.root,
		hasUI: false,
		settings: Settings.isolated({
			"async.enabled": asyncEnabled,
			"task.batch": true,
			"task.isolation.mode": "none",
		}),
		getSessionFile: () => fixture.parentFile,
		getSessionId: () => "persistent-parent-session",
		getAgentId: () => "Main",
		getSessionSpawns: () => "*",
		getArtifactsDir: () => fixture.artifactsDirectory,
		getActiveModelString: () => "openai-codex/gpt-5.6-sol:medium",
		getModelString: () => "openai-codex/gpt-5.6-sol:medium",
		asyncJobManager: manager,
		modelRegistry,
	} as unknown as ToolSession;
}

function resultFor(id: string): SingleResult {
	return {
		index: 0,
		id,
		agent: "librarian",
		agentSource: "bundled",
		task: "Research.",
		assignment: "Research.",
		exitCode: 0,
		output: "done",
		stderr: "",
		truncated: false,
		durationMs: 1,
		tokens: 0,
		requests: 1,
	};
}

function batchParams(): TaskParams {
	return {
		agent: "librarian",
		context: "# Goal\nVerify source behavior.",
		tasks: [
			{
				id: "FirstResearcher",
				assignment: "Research the first source.",
				model: "openai-codex/gpt-5.6-luna:medium",
			},
			{
				id: "SecondResearcher",
				assignment: "Research the second source.",
				model: "openai-codex/gpt-5.6-luna:medium",
			},
		],
	};
}

beforeEach(() => {
	AgentRegistry.resetGlobalForTests();
	AgentLifecycleManager.resetGlobalForTests();
	vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({ agents: [librarianAgent], projectAgentsDir: null });
});

afterEach(async () => {
	vi.restoreAllMocks();
	configureSpawnPolicyRouting();
	for (const manager of managers.splice(0)) await manager.dispose({ timeoutMs: 1_000 });
	for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
	AgentLifecycleManager.resetGlobalForTests();
	AgentRegistry.resetGlobalForTests();
});

describe("TaskTool persistent startup", () => {
	it("accepts the previous policy registry and preserves parent identity when another batch item fails registration", async () => {
		const fixture = await createFixture(4);
		configureSpawnPolicyRouting({ directory: fixture.policyDirectory });
		const manager = createManager();
		const originalRegister = manager.register.bind(manager);
		vi.spyOn(manager, "register")
			.mockImplementationOnce(() => {
				throw new Error("");
			})
			.mockImplementation((...args) => originalRegister(...args));
		const seen: Array<{
			id: string | undefined;
			sessionFile: string | null | undefined;
			parentSessionFile: string | null | undefined;
			parentSessionId: string | undefined;
		}> = [];
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			seen.push({
				id: options.id,
				sessionFile: options.sessionFile,
				parentSessionFile: options.parentSessionFile,
				parentSessionId: options.parentSessionId,
			});
			return resultFor(options.id ?? "missing");
		});

		const tool = await TaskTool.create(createSession(fixture, manager));
		const response = await tool.execute("persistent-mixed-batch", batchParams());

		expect(response.content[0]).toEqual(
			expect.objectContaining({ type: "text", text: expect.stringContaining("Spawned 1 background agent") }),
		);
		expect(response.details?.startupFailures).toEqual([
			expect.objectContaining({
				code: "TASK_JOB_REGISTRATION_FAILED",
				phase: "job-registration",
				agentId: "FirstResearcher",
				causeTag: "Error",
				message: expect.stringContaining("No error message provided"),
			}),
		]);
		expect(manager.getJob("FirstResearcher")).toBeUndefined();
		const second = manager.getJob("SecondResearcher");
		expect(second).toBeDefined();
		await second!.promise;
		expect(seen).toEqual([
			{
				id: "SecondResearcher",
				sessionFile: fixture.parentFile,
				parentSessionFile: fixture.parentFile,
				parentSessionId: "persistent-parent-session",
			},
		]);
	});

	it("turns a synchronous tagged policy failure with an empty Error.message into a typed non-empty startup error", async () => {
		const fixture = await createFixture(POLICY_REGISTRY_VERSION + 1);
		configureSpawnPolicyRouting({ directory: fixture.policyDirectory });
		const manager = createManager();
		const tool = await TaskTool.create(createSession(fixture, manager, false));

		try {
			await tool.execute("future-policy", {
				agent: "librarian",
				assignment: "Research one source.",
				model: "openai-codex/gpt-5.6-luna:medium",
			});
			throw new Error("Expected TaskTool startup to fail");
		} catch (error) {
			expect(error).toBeInstanceOf(TaskStartupError);
			if (!(error instanceof TaskStartupError)) throw error;
			expect(error.code).toBe("TASK_PRE_REGISTRATION_FAILED");
			expect(error.phase).toBe("route-policy");
			expect(error.causeTag).toBe("TornPolicyJournalError");
			expect(error.message).toContain("got 6");
			expect(error.message.length).toBeGreaterThan(40);
		}
		expect(manager.getAllJobs()).toHaveLength(0);
	});
});
