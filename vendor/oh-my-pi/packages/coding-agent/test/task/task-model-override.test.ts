import { afterEach, describe, expect, it, vi } from "bun:test";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { formatModelChain, TaskTool } from "@oh-my-pi/pi-coding-agent/task";
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

const availableModel = buildModel({
	id: "claude-sonnet-4-5",
	name: "Claude Sonnet 4.5",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: false,
	input: ["text"],
	cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	contextWindow: 200000,
	maxTokens: 8192,
});

const modelRegistry = {
	getAvailable: () => [availableModel],
};

function createSession(manager: AsyncJobManager): ToolSession {
	return {
		cwd: "/tmp/task-model-override-test",
		hasUI: false,
		settings: Settings.isolated({ "task.isolation.mode": "none" }),
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		getModelString: () => "anthropic/claude-sonnet-4-5",
		asyncJobManager: manager,
		modelRegistry,
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

describe("task model override receipts", () => {
	const managers: AsyncJobManager[] = [];

	function createManager(): AsyncJobManager {
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		managers.push(manager);
		return manager;
	}

	afterEach(async () => {
		vi.restoreAllMocks();
		for (const manager of managers.splice(0)) {
			await manager.dispose({ timeoutMs: 1000 });
		}
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
	});

	it("formats resolved model chains with and without roles", () => {
		expect(formatModelChain("task", undefined, "anthropic/claude-sonnet-4-5")).toBe(
			"task → anthropic/claude-sonnet-4-5",
		);
		expect(formatModelChain("task", "Review specialist", "anthropic/claude-sonnet-4-5:high")).toBe(
			'task → "Review specialist" → anthropic/claude-sonnet-4-5:high',
		);
		expect(formatModelChain("task", "   ", "anthropic/claude-sonnet-4-5")).toBe("task → anthropic/claude-sonnet-4-5");
		expect(formatModelChain("task", "Review specialist", undefined)).toBeUndefined();
	});

	it("includes the resolved model chain in the spawn receipt", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({ agents: [taskAgent], projectAgentsDir: null });
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => makeResult(options.id ?? "?"));

		const manager = createManager();
		const tool = await TaskTool.create(createSession(manager));
		const result = await tool.execute("tc-model-receipt", {
			agent: "task",
			id: "ModelReceipt",
			role: "Review specialist",
			model: "anthropic/claude-sonnet-4-5",
			assignment: "Do the thing.",
		} as TaskParams);

		expect(getFirstText(result)).toContain('using task → "Review specialist" → anthropic/claude-sonnet-4-5');
		const jobId = result.details?.async?.jobId;
		if (jobId) await manager.getJob(jobId)?.promise;
	});

	it("fails an invalid per-spawn model override before scheduling a job", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({ agents: [taskAgent], projectAgentsDir: null });
		const runSpy = vi
			.spyOn(executorModule, "runSubprocess")
			.mockImplementation(async options => makeResult(options.id ?? "?"));

		const manager = createManager();
		const tool = await TaskTool.create(createSession(manager));
		const result = await tool.execute("tc-invalid-model", {
			agent: "task",
			id: "BadModel",
			model: "not-a-real-model",
			assignment: "Do the thing.",
		} as TaskParams);

		const text = getFirstText(result);
		expect(text).toContain('Invalid model override for task agent "task": not-a-real-model.');
		expect(text).toContain("Resolved selector: not-a-real-model");
		expect(text).toContain("Valid model selectors include: anthropic/claude-sonnet-4-5");
		expect(manager.getAllJobs()).toHaveLength(0);
		expect(runSpy).not.toHaveBeenCalled();
	});
});
