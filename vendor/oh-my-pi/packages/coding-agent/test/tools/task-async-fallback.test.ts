import { afterEach, describe, expect, it, vi } from "bun:test";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { TaskTool } from "@oh-my-pi/pi-coding-agent/task";
import * as discoveryModule from "@oh-my-pi/pi-coding-agent/task/discovery";
import type { TaskParams } from "@oh-my-pi/pi-coding-agent/task/types";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";

const routeModel = buildModel({
	id: "gpt-5.6-sol",
	name: "Sol",
	api: "openai-responses",
	provider: "openai-codex",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 8192,
});

function createSession(overrides: Partial<Record<string, unknown>> = {}): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		settings: Settings.isolated(overrides),
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		modelRegistry: { getAvailable: () => [routeModel] },
	} as unknown as ToolSession;
}

function getFirstText(result: { content: Array<{ type: string; text?: string }> }): string {
	const content = result.content.find(part => part.type === "text");
	return content?.type === "text" ? (content.text ?? "") : "";
}

describe("task.async-fallback", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("falls back to sync execution without rediscovering task capabilities", async () => {
		// The missing asyncJobManager routes through the synchronous run path.
		// An explicit responsibility route reaches the live-parent precondition,
		// proving that path retains the create-time capability snapshot.
		const discoverSpy = vi.spyOn(discoveryModule, "discoverAgents");
		discoverSpy.mockResolvedValueOnce({
			agents: [
				{
					name: "task",
					description: "General-purpose task agent",
					systemPrompt: "You are a task agent.",
					source: "bundled",
				},
			],
			projectAgentsDir: null,
		});
		discoverSpy.mockResolvedValue({ agents: [], projectAgentsDir: null });

		// Enable async so the missing `asyncJobManager` is the fallback trigger.
		const tool = await TaskTool.create(
			createSession({
				"async.enabled": true,
				modelRoles: {
					task: "openai-codex/gpt-5.6-luna:medium",
					implementer: "openai-codex/gpt-5.6-sol:medium",
				},
			}),
		);

		const result = await tool.execute("tool-1", {
			agent: "task",
			id: "One",
			description: "label",
			model: "not-a-real-model",
			assignment: "Do the thing.",
		} as TaskParams);

		const text = getFirstText(result);
		expect(discoverSpy).toHaveBeenCalledTimes(1);
		expect(text).toContain('Invalid model override for task agent "task": not-a-real-model.');
		expect(text).not.toContain('Unknown agent "task"');
	});
});
