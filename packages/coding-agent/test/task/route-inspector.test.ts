import { describe, expect, it } from "bun:test";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { ModelLookupRegistry } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { COMMAND_MODE_COMMANDS } from "@oh-my-pi/pi-coding-agent/modes/command-registry";
import type { PolicySnapshot } from "@oh-my-pi/pi-coding-agent/policy/policy-projection";
import {
	formatRouteInspection,
	previewSpawnRoute,
	type RouteInspectionInput,
} from "@oh-my-pi/pi-coding-agent/task/route-inspector";
import {
	blockSpawnRoute,
	rerouteSpawnRoute,
	resolveSpawnRoute,
} from "@oh-my-pi/pi-coding-agent/task/route-resolution";
import type { AgentDefinition } from "@oh-my-pi/pi-coding-agent/task/types";

const primary = buildModel({
	id: "gpt-5.6-terra",
	name: "Terra",
	api: "openai-responses",
	provider: "openai-codex",
	baseUrl: "https://api.openai.com/v1",
	reasoning: true,
	thinking: { mode: "effort", efforts: [ThinkingLevel.Low, ThinkingLevel.Medium] },
	input: ["text"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 8192,
});
const fallback = buildModel({
	id: "smol-literal",
	name: "Smol",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 8192,
});
const registry: ModelLookupRegistry = { getAvailable: () => [primary, fallback] };
const binaryVersion = "16.0.1+fork.route-test";

function render(decision: RouteInspectionInput["decision"], overrides: Partial<RouteInspectionInput> = {}): string {
	return formatRouteInspection({
		agentId: "RouteProbe",
		responsibility: "implementer",
		definitionSourcePath: "/repo/.omp/agents/implementer.md",
		decision,
		binaryVersion,
		receiptSource: "spawn receipt RouteProbe",
		...overrides,
	});
}


const taskAgent: AgentDefinition = {
	name: "task",
	description: "General-purpose agent",
	systemPrompt: "Implement the assignment.",
	model: ["pi/task"],
	spawns: "*",
	source: "bundled",
	filePath: "/opt/omp/agents/task.md",
};
const implementerAgent: AgentDefinition = {
	name: "implementer",
	description: "Implementation specialist",
	systemPrompt: "Implement the assignment.",
	model: ["pi/implementer"],
	spawns: "*",
	source: "project",
	filePath: "/repo/.omp/agents/implementer.md",
};

describe(":route provenance assembly", () => {
	it("names an explicit override, all consulted sources, and the receipt", () => {
		const settings = Settings.isolated({ modelRoles: { default: "openai/smol-literal" } });
		const decision = resolveSpawnRoute({
			spawnExplicit: "openai-codex/gpt-5.6-terra:medium",
			agentFrontmatter: "pi/implementer",
			globalDefault: "openai/smol-literal",
			settings,
			modelRegistry: registry,
			responsibility: "implementer",
		});
		const output = render(decision, {
			settings,
			explicitOverride: "openai-codex/gpt-5.6-terra:medium",
		});

		expect(output).toContain("explicit override: openai-codex/gpt-5.6-terra:medium [source: spawn receipt RouteProbe]");
		expect(output).toContain("selected: openai-codex/gpt-5.6-terra:medium effort=medium");
		expect(output).toContain("1. spawn_explicit:");
		expect(output).toContain("2. agent_frontmatter:");
		expect(output).toContain("result=shadowed by higher precedence");
		expect(output.split("\n").every(line => line.includes("[source:"))).toBe(true);
	});

	it("explains a policy-layer winner and shadowed policy candidate", () => {
		const settings = Settings.isolated({ modelRoles: { implementer: "openai-codex/gpt-5.6-terra" } });
		const snapshot: PolicySnapshot = {
			at: "2026-07-15T12:00:00.000Z",
			workstream: "hr-132",
			values: {
				"core.routing.implementer": {
					key: "core.routing.implementer",
					value: "openai/smol-literal",
					sourceLayer: "workstream-durable",
					scope: { kind: "workstream", workstream: "hr-132" },
					transactionId: "11111111-1111-4111-8111-111111111111",
					sequence: 7,
					shadowed: [
						{
							key: "core.routing.implementer",
							operation: "set",
							value: "openai-codex/gpt-5.6-terra",
							sourceLayer: "global-durable",
							scope: { kind: "global" },
							transactionId: "22222222-2222-4222-8222-222222222222",
							sequence: 3,
						},
					],
				},
			},
			transactions: [],
			expiredTransactionIds: [],
			futureTransactionIds: [],
		};
		const decision = resolveSpawnRoute({
			policyKey: "core.routing.implementer",
			policySnapshot: snapshot,
			agentFrontmatter: "pi/implementer",
			settings,
			modelRegistry: registry,
			responsibility: "implementer",
		});
		const output = render(decision, { settings, policySnapshot: snapshot });

		expect(output).toContain("selected: openai/smol-literal");
		expect(output).toContain("policy core.routing.implementer: winner workstream-durable=openai/smol-literal");
		expect(output).toContain("transaction=11111111-1111-4111-8111-111111111111");
		expect(output).toContain("shadowed global-durable=openai-codex/gpt-5.6-terra; reason=lower policy precedence");
		expect(output).toContain("temporary posture: none [source: policy snapshot=2026-07-15T12:00:00.000Z]");
	});

	it("labels the deprecated task alias and its definition source", () => {
		const settings = Settings.isolated({
			modelRoles: { task: "openai/smol-literal", implementer: "openai-codex/gpt-5.6-terra" },
		});
		const preview = previewSpawnRoute({
			selectorOrRole: "task",
			agents: [taskAgent],
			settings,
			modelRegistry: registry,
		});
		const output = render(preview.decision, {
			responsibility: preview.responsibility,
			definitionSourcePath: preview.definitionSourcePath,
			settings,
			receiptSource: "dry-run resolveSpawnRoute result",
			preview: true,
		});

		expect(output).toContain("responsibility: implementer alias=deprecated-alias [source: definition /opt/omp/agents/task.md]");
		expect(output).toContain("agent_frontmatter: selectors=pi/task");
		expect(output).toContain("role task: winner runtime_override=openai/smol-literal");
	});

	it("reports a blocked route and the quota fallback attempt", () => {
		const settings = Settings.isolated({});
		const initial = resolveSpawnRoute({
			globalDefault: "openai-codex/gpt-5.6-terra",
			settings,
			modelRegistry: registry,
			responsibility: "implementer",
		});
		const rerouted = rerouteSpawnRoute(
			initial,
			{ providerId: "openai", modelId: "smol-literal", selector: "openai/smol-literal" },
			{
				originalProvider: "openai-codex",
				reroutedProvider: "openai",
				originalModel: "openai-codex/gpt-5.6-terra",
				reroutedModel: "openai/smol-literal",
				decisionReason: "primary quota below reserve",
				quotaPoolId: "codex-primary",
			},
			"primary quota below reserve",
		);
		const blocked = blockSpawnRoute(rerouted, {
			kind: "quota_admission_blocked",
			selector: "openai/smol-literal",
			reason: "fallback account ineligible",
			resetAt: 1_752_600_000_000,
		});
		const output = render(blocked, { settings });

		expect(output).toContain("selected: blocked selector=openai/smol-literal; reason=fallback account ineligible");
		expect(output).toContain("fallback 1: rejected openai-codex/gpt-5.6-terra; reason=primary quota below reserve");
		expect(output).toContain("[source: quota admission receipt]");
		expect(output).toContain("blocked: openai/smol-literal; reason=fallback account ineligible");
	});

	it("previews a role through resolveSpawnRoute without a spawn receipt", () => {
		const settings = Settings.isolated({ modelRoles: { implementer: "openai/smol-literal" } });
		const preview = previewSpawnRoute({
			selectorOrRole: "implementer",
			agents: [implementerAgent],
			settings,
			modelRegistry: registry,
			parentActiveSelector: "openai-codex/gpt-5.6-terra",
		});
		const output = render(preview.decision, {
			responsibility: preview.responsibility,
			definitionSourcePath: preview.definitionSourcePath,
			settings,
			receiptSource: "dry-run resolveSpawnRoute result",
			preview: true,
		});

		expect(output).toContain("Route RouteProbe — preview (no spawn, no writes)");
		expect(output).toContain("responsibility: implementer [source: definition /repo/.omp/agents/implementer.md]");
		expect(output).toContain("selected: openai/smol-literal");
		expect(output).toContain("[source: dry-run resolveSpawnRoute result field=agent_frontmatter]");
		const command = COMMAND_MODE_COMMANDS.find(candidate => candidate.name === "route");
		expect(command?.inlineHint).toBe("[agentId | preview <selector-or-role>]");
		expect(command?.subcommands).toEqual([
			{ name: "preview", description: "dry-run a spawn route", usage: "<selector-or-role>" },
		]);
	});
});
