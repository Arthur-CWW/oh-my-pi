import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DurableJournalModelCache } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub-roster";
import { getAgentPickerData } from "@oh-my-pi/pi-coding-agent/task/discovery";
import type { SpawnRouteReceipt } from "@oh-my-pi/pi-coding-agent/task/route-resolution";
import { createSpawnRecord } from "@oh-my-pi/pi-coding-agent/task/spawn-record";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

const route: SpawnRouteReceipt = {
	source: "auth_fallback",
	route: {
		selector: "openai/gpt-5.6",
		provider: "openai",
		model: "gpt-5.6",
		thinking: undefined,
		parentActiveSelector: "openai/gpt-5.6",
	},
	originalSource: "agent_frontmatter",
	originalRoute: {
		selector: "anthropic/claude-sonnet",
		provider: "anthropic",
		model: "claude-sonnet",
		thinking: undefined,
		parentActiveSelector: "openai/gpt-5.6",
	},
	reason: "credentials unavailable",
	consulted: [
		{
			source: "agent_frontmatter",
			explicit: false,
			selectors: ["pi/task"],
			patterns: ["anthropic/claude-sonnet"],
		},
	],
	overridden: [
		{
			source: "global_default",
			explicit: false,
			selectors: ["pi/default"],
			patterns: ["openai/gpt-5.6"],
		},
	],
	resolvedPatterns: ["openai/gpt-5.6"],
	priorAttempts: [
		{
			source: "agent_frontmatter",
			route: {
				selector: "anthropic/claude-sonnet",
				provider: "anthropic",
				model: "claude-sonnet",
				thinking: undefined,
				parentActiveSelector: "openai/gpt-5.6",
			},
			reason: "credentials unavailable",
		},
	],
};

describe("durable spawn records", () => {
	it("round-trips depth-2 prompt, definition, spawner, and route provenance into the Hub journal source", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-spawn-record-"));
		tempDirs.push(root);
		const journal = path.join(root, "FleetHealthRollback.ErrorCorrelation.jsonl");
		const spawnRecord = createSpawnRecord({
			agentId: "FleetHealthRollback.ErrorCorrelation",
			spawnerId: "FleetHealthRollback",
			agentType: "reviewer",
			definitionSourcePath: "embedded:reviewer.md",
			context: "# Goal\nCorrelate the child error ledger.",
			assignment: "# Target\nInspect depth-two failures.",
			resolvedModel: "openai/gpt-5.6",
			route,
		});
		await fs.writeFile(
			journal,
			`${JSON.stringify({ type: "session", id: "depth-two", timestamp: new Date().toISOString(), cwd: root })}\n${JSON.stringify(
				{
					type: "session_init",
					id: "init",
					parentId: null,
					timestamp: new Date().toISOString(),
					systemPrompt: "reviewer definition and shared context",
					task: "depth-two assignment",
					tools: [],
					subagent: {
						agentId: spawnRecord.agentId,
						parentSessionFile: path.join(root, "FleetHealthRollback.jsonl"),
						parentSessionId: "parent-session",
						displayName: spawnRecord.agentId,
						model: spawnRecord.resolvedModel,
						thinkingLevel: null,
						isolated: false,
						taskDepth: 2,
						parentTaskPrefix: spawnRecord.agentId,
						spawnRecord,
					},
				},
			)}\n`,
		);

		const durable = await new DurableJournalModelCache().load(journal);
		expect(durable?.spawnRecord).toEqual(spawnRecord);
		expect(durable?.spawnRecord?.fullPrompt).toBe(
			"# Goal\nCorrelate the child error ledger.\n\n# Target\nInspect depth-two failures.",
		);
		expect(durable?.spawnRecord?.route?.source).toBe("auth_fallback");
		expect(durable?.spawnRecord?.route?.originalSource).toBe("agent_frontmatter");
	});

	it("projects definition source and full prompt for agent picker previews", () => {
		const [preview] = getAgentPickerData([
			{
				name: "reviewer",
				description: "Reviews code",
				systemPrompt: "Full reviewer prompt",
				source: "bundled",
				filePath: "embedded:reviewer.md",
			},
		]);
		expect(preview).toEqual({
			name: "reviewer",
			description: "Reviews code",
			source: "bundled",
			definitionSourcePath: "embedded:reviewer.md",
			fullPrompt: "Full reviewer prompt",
		});
	});
});
