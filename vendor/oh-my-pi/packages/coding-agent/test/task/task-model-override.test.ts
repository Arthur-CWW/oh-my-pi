import { afterEach, describe, expect, it, vi } from "bun:test";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { QUOTA_ADMISSION_CUSTOM_TYPE, createQuotaAdmissionStateRecord } from "@oh-my-pi/pi-coding-agent/task/quota-admission";
import { formatModelChain, TaskTool } from "@oh-my-pi/pi-coding-agent/task";
import { toSpawnRouteReceipt } from "@oh-my-pi/pi-coding-agent/task/route-resolution";
import { resolveTaskSpawnRoute } from "@oh-my-pi/pi-coding-agent/task/spawn-route";
import * as discoveryModule from "@oh-my-pi/pi-coding-agent/task/discovery";
import * as executorModule from "@oh-my-pi/pi-coding-agent/task/executor";
import type { AgentDefinition, SingleResult, TaskParams } from "@oh-my-pi/pi-coding-agent/task/types";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";

const taskAgent: AgentDefinition = {
	name: "task",
	description: "General-purpose task agent",
	systemPrompt: "You are a task agent.",
	model: ["openai/gpt-5-mini"],
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

const fallbackModel = buildModel({
	id: "gpt-5-mini",
	name: "GPT-5 mini",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0.25 },
	contextWindow: 128000,
	maxTokens: 8192,
});

const modelRegistry = {
	getAvailable: () => [availableModel, fallbackModel],
};

function createSession(
	manager: AsyncJobManager,
	options: {
		authStorage?: { fetchUsageReports: () => Promise<unknown> };
		sessionManager?: SessionManager;
	} = {},
): ToolSession {
	return {
		cwd: "/tmp/task-model-override-test",
		hasUI: false,
		settings: Settings.isolated({ "task.isolation.mode": "none" }),
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		getModelString: () => "anthropic/claude-sonnet-4-5",
		getActiveModelString: () => "anthropic/claude-sonnet-4-5",
		asyncJobManager: manager,
		authStorage: options.authStorage,
		modelRegistry,
		sessionManager: options.sessionManager,
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

	it("routes task through implementer with deprecated-alias provenance and preserves explicit precedence", () => {
		const manager = createManager();
		const session = createSession(manager);
		session.settings = Settings.isolated({
			"task.isolation.mode": "none",
			modelRoles: { implementer: "openai/gpt-5-mini" },
		});

		const aliased = toSpawnRouteReceipt(
			resolveTaskSpawnRoute(session, "task", taskAgent, {
				agent: "task",
				assignment: "Do the thing.",
			}),
		);
		expect(aliased).toMatchObject({
			responsibility: "implementer",
			alias: "deprecated-alias",
			resolutionSource: "agent_frontmatter",
			resolvedLane: "openai/gpt-5-mini",
		});
		expect(aliased.resolvedLane).not.toBe(aliased.route.parentActiveSelector);

		const explicit = toSpawnRouteReceipt(
			resolveTaskSpawnRoute(session, "task", taskAgent, {
				agent: "task",
				model: "anthropic/claude-sonnet-4-5",
				assignment: "Do the thing.",
			}),
		);
		expect(explicit).toMatchObject({
			responsibility: "implementer",
			alias: "deprecated-alias",
			resolutionSource: "spawn_explicit",
			resolvedLane: "anthropic/claude-sonnet-4-5",
		});
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

	it.each(["rejects", "returns no reports"] as const)(
		"blocks an explicit model override from fresh persisted one-percent quota when usage fetching %s",
		async fetchOutcome => {
			vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({ agents: [taskAgent], projectAgentsDir: null });
			const runSpy = vi
				.spyOn(executorModule, "runSubprocess")
				.mockImplementation(async options => makeResult(options.id ?? "?"));
			const fetchUsageReports = vi.fn(async () => {
				if (fetchOutcome === "rejects") throw new Error("usage service unavailable");
				return [];
			});
			const sessionManager = SessionManager.inMemory("/tmp/task-model-override-quota");
			const now = Date.now();
			sessionManager.appendCustomEntry(
				QUOTA_ADMISSION_CUSTOM_TYPE,
				createQuotaAdmissionStateRecord({
					samples: [
						{
							poolId: "anthropic:test",
							windowId: "five-hour",
							modelId: "claude-sonnet-4-5",
							observedAtMs: now,
							remainingPercent: 1,
							resetAtMs: now + 3_600_000,
							emaBurnPerHour: 0,
						},
						{
							poolId: "openai:healthy",
							windowId: "five-hour",
							modelId: "gpt-5-mini",
							observedAtMs: now,
							remainingPercent: 80,
							resetAtMs: now + 3_600_000,
							emaBurnPerHour: 0,
						},
					],
					decisions: [],
				}, now),
			);

			const manager = createManager();
			const tool = await TaskTool.create(createSession(manager, { authStorage: { fetchUsageReports }, sessionManager }));
			const result = await tool.execute("tc-quota-fetch-outage", {
				agent: "task",
				id: "QuotaOutage",
				model: "anthropic/claude-sonnet-4-5",
				assignment: "Do the thing.",
			} as TaskParams);

			expect(fetchUsageReports).toHaveBeenCalledTimes(1);
			expect(getFirstText(result)).toContain("Quota admission blocked anthropic/claude-sonnet-4-5 (reserve).");
			expect(manager.getAllJobs()).toHaveLength(0);
			expect(runSpy).not.toHaveBeenCalled();
		},
	);

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

