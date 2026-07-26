import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { isReadOnlyAgent, TaskTool } from "@oh-my-pi/pi-coding-agent/task";
import { loadBundledAgents } from "@oh-my-pi/pi-coding-agent/task/agents";
import * as discoveryModule from "@oh-my-pi/pi-coding-agent/task/discovery";
import type { AgentDefinition } from "@oh-my-pi/pi-coding-agent/task/types";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { beginSettingsTest, restoreSettingsTestState } from "../helpers/settings-test-state";

function createSession(overrides: Partial<Record<string, unknown>> = {}): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		settings: Settings.isolated(overrides),
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
	} as unknown as ToolSession;
}

function agentByName(agents: AgentDefinition[], name: string): AgentDefinition {
	const agent = agents.find(candidate => candidate.name === name);
	expect(agent).toBeDefined();
	return agent as AgentDefinition;
}

function advertisedAgentNames(description: string): string[] {
	const agents = /<agents>\n([\s\S]*?)\n<\/agents>/.exec(description)?.[1] ?? "";
	return [...agents.matchAll(/^# ([a-z][a-z0-9_-]*)/gm)].map(match => match[1]);
}

function createLiveSession(settings: Settings, cwd: string, manager: AsyncJobManager): ToolSession {
	return {
		cwd,
		hasUI: false,
		settings,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		asyncJobManager: manager,
		modelRegistry: { getAvailable: () => [] },
	} as unknown as ToolSession;
}

async function writeDisabledAgents(agentDir: string, disabledAgents: string[]): Promise<void> {
	await Bun.write(path.join(agentDir, "config.yml"), JSON.stringify({ task: { disabledAgents } }));
}

describe("task agent capability descriptions", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("classifies bundled explore as the only read-only delegated agent", () => {
		const agents = loadBundledAgents();

		expect(isReadOnlyAgent(agentByName(agents, "explore"))).toBe(true);
		for (const name of ["task", "quick_task", "plan", "reviewer", "oracle", "designer"]) {
			expect(isReadOnlyAgent(agentByName(agents, name))).toBe(false);
		}
	});

	it("disables read summarization for explore and librarian, leaves other agents summarizing", () => {
		const agents = loadBundledAgents();

		expect(agentByName(agents, "explore").readSummarize).toBe(false);
		expect(agentByName(agents, "librarian").readSummarize).toBe(false);
		for (const name of ["task", "quick_task", "plan", "reviewer", "oracle", "designer"]) {
			expect(agentByName(agents, name).readSummarize).toBeUndefined();
		}
	});

	it("marks read-only agents in the task description and keeps full agents unmarked", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [
				{
					name: "read_scout",
					description: "Read-only scout",
					systemPrompt: "Scout the codebase.",
					tools: ["read", "search", "find"],
					source: "project",
				},
				{
					name: "full_agent",
					description: "Full agent",
					systemPrompt: "Modify the codebase.",
					source: "project",
				},
			],
			projectAgentsDir: null,
		});

		const tool = await TaskTool.create(createSession());
		const description = tool.description;

		expect(description).toContain("# read_scout — READ-ONLY (no edit/write/exec tools)\nRead-only scout");
		expect(description).toContain("# full_agent\nFull agent");
		expect(description).not.toContain("# full_agent — READ-ONLY");
		expect(description).toContain(
			"NEVER offload reasoning, analysis, design, or decision-making to `quick_task` or `explore`",
		);
	});
});

describe("task executable capability snapshots", () => {
	it("omits a responsibility disabled before tool creation", async () => {
		const settingsState = beginSettingsTest();
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "task-capabilities-disabled-"));
		const cwd = path.join(root, "project");
		const agentDir = path.join(root, "agent");
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		try {
			await fs.mkdir(cwd, { recursive: true });
			await fs.mkdir(agentDir, { recursive: true });
			await writeDisabledAgents(agentDir, ["operator"]);
			const settings = await Settings.init({ cwd, agentDir });
			const tool = await TaskTool.create(createLiveSession(settings, cwd, manager));

			expect(advertisedAgentNames(tool.description)).not.toContain("operator");
			const result = await tool.execute("disabled-before-create", {
				agent: "operator",
				id: "DisabledOperator",
				model: "not-a-real-model",
				assignment: "Operate the environment.",
			});
			const text = result.content.find(part => part.type === "text")?.text ?? "";
			expect(text).toContain('Unknown agent "operator"');
		} finally {
			await manager.dispose({ timeoutMs: 1000 });
			restoreSettingsTestState(settingsState);
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("keeps an enabled responsibility executable until the next generation after reload", async () => {
		const settingsState = beginSettingsTest();
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "task-capabilities-disable-reload-"));
		const cwd = path.join(root, "project");
		const agentDir = path.join(root, "agent");
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		try {
			await fs.mkdir(cwd, { recursive: true });
			await fs.mkdir(agentDir, { recursive: true });
			await writeDisabledAgents(agentDir, []);
			const settings = await Settings.init({ cwd, agentDir });
			const session = createLiveSession(settings, cwd, manager);
			const enabledGeneration = await TaskTool.create(session);

			await writeDisabledAgents(agentDir, ["operator"]);
			await settings.reloadFromDisk();

			expect(advertisedAgentNames(enabledGeneration.description)).toContain("operator");
			const retained = await enabledGeneration.execute("enabled-generation", {
				agent: "operator",
				id: "EnabledOperator",
				model: "not-a-real-model",
				assignment: "Operate the environment.",
			});
			const retainedText = retained.content.find(part => part.type === "text")?.text ?? "";
			expect(retainedText).toContain('Invalid model override for task agent "operator": not-a-real-model.');
			expect(retainedText).not.toContain('Unknown agent "operator"');

			const disabledGeneration = await TaskTool.create(session);
			expect(advertisedAgentNames(disabledGeneration.description)).not.toContain("operator");
			const disabled = await disabledGeneration.execute("disabled-generation", {
				agent: "operator",
				id: "DisabledOperator",
				model: "not-a-real-model",
				assignment: "Operate the environment.",
			});
			expect(disabled.content.find(part => part.type === "text")?.text ?? "").toContain('Unknown agent "operator"');
		} finally {
			await manager.dispose({ timeoutMs: 1000 });
			restoreSettingsTestState(settingsState);
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("keeps a disabled responsibility unavailable until the next generation after reload", async () => {
		const settingsState = beginSettingsTest();
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "task-capabilities-enable-reload-"));
		const cwd = path.join(root, "project");
		const agentDir = path.join(root, "agent");
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		try {
			await fs.mkdir(cwd, { recursive: true });
			await fs.mkdir(agentDir, { recursive: true });
			await writeDisabledAgents(agentDir, ["operator"]);
			const settings = await Settings.init({ cwd, agentDir });
			const session = createLiveSession(settings, cwd, manager);
			const disabledGeneration = await TaskTool.create(session);

			await writeDisabledAgents(agentDir, []);
			await settings.reloadFromDisk();

			expect(advertisedAgentNames(disabledGeneration.description)).not.toContain("operator");
			const retained = await disabledGeneration.execute("still-disabled-generation", {
				agent: "operator",
				id: "StillDisabledOperator",
				model: "not-a-real-model",
				assignment: "Operate the environment.",
			});
			expect(retained.content.find(part => part.type === "text")?.text ?? "").toContain('Unknown agent "operator"');

			const enabledGeneration = await TaskTool.create(session);
			expect(advertisedAgentNames(enabledGeneration.description)).toContain("operator");
			const enabled = await enabledGeneration.execute("enabled-after-reload", {
				agent: "operator",
				id: "EnabledAfterReload",
				model: "not-a-real-model",
				assignment: "Operate the environment.",
			});
			const enabledText = enabled.content.find(part => part.type === "text")?.text ?? "";
			expect(enabledText).toContain('Invalid model override for task agent "operator": not-a-real-model.');
			expect(enabledText).not.toContain('Unknown agent "operator"');
		} finally {
			await manager.dispose({ timeoutMs: 1000 });
			restoreSettingsTestState(settingsState);
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("resolves every advertised responsibility with its per-spawn model", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "task-capabilities-resolution-"));
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		try {
			const settings = Settings.isolated({});
			const tool = await TaskTool.create(createLiveSession(settings, root, manager));
			const advertised = advertisedAgentNames(tool.description);
			expect(advertised.length).toBeGreaterThan(0);

			for (const agent of advertised) {
				const result = await tool.execute(`resolve-${agent}`, {
					agent,
					id: `${agent.replaceAll("_", "")}Probe`,
					model: "not-a-real-model",
					assignment: `Resolve ${agent}.`,
				});
				const text = result.content.find(part => part.type === "text")?.text ?? "";
				expect(text).toContain(`Invalid model override for task agent "${agent}": not-a-real-model.`);
				expect(text).not.toContain(`Unknown agent "${agent}"`);
			}
			expect(manager.getAllJobs()).toHaveLength(0);
		} finally {
			await manager.dispose({ timeoutMs: 1000 });
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
