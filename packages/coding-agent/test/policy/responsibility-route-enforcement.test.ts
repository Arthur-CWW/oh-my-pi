import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { runPolicyCommand } from "@oh-my-pi/pi-coding-agent/cli/policy-cli";
import type { ModelLookupRegistry } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { PolicyJournal } from "@oh-my-pi/pi-coding-agent/policy/policy-journal";
import { makePolicyService } from "@oh-my-pi/pi-coding-agent/policy/policy-service";
import { EXACT_RESPONSIBILITY_ROUTES } from "@oh-my-pi/pi-coding-agent/task/spawn-route";
import {
	resolveSpawnRoute,
	toSpawnRouteReceipt,
	type SpawnRouteInput,
} from "@oh-my-pi/pi-coding-agent/task/route-resolution";
import { Effect } from "effect";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { force: true, recursive: true })));
});

const opus = buildModel({
	id: "claude-opus-5",
	name: "Opus",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://example.invalid",
	reasoning: true,
	thinking: { mode: "effort", efforts: [ThinkingLevel.Medium, ThinkingLevel.High] },
	input: ["text"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 8_192,
});
const sol = buildModel({
	id: "gpt-5.6-sol",
	name: "Sol",
	api: "openai-responses",
	provider: "openai-codex",
	baseUrl: "https://example.invalid",
	reasoning: true,
	thinking: { mode: "effort", efforts: [ThinkingLevel.Medium, ThinkingLevel.High] },
	input: ["text"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 8_192,
});
const luna = buildModel({
	id: "gpt-5.6-luna",
	name: "Luna",
	api: "openai-responses",
	provider: "openai-codex",
	baseUrl: "https://example.invalid",
	reasoning: true,
	thinking: { mode: "effort", efforts: [ThinkingLevel.Medium] },
	input: ["text"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 8_192,
});
const registry: ModelLookupRegistry = { getAvailable: () => [opus, sol, luna] };
const settings = Settings.isolated({
	modelRoles: {
		default: "openai-codex/gpt-5.6-sol:medium",
		slow: "openai-codex/gpt-5.6-sol:medium",
		smol: "openai-codex/gpt-5.6-luna:medium",
		designer: "anthropic/claude-opus-5:medium",
	},
});

async function tempDirectory(): Promise<string> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-route-enforcement-"));
	directories.push(directory);
	return directory;
}

function routeInput(
	responsibility: string,
	policySnapshot: SpawnRouteInput["policySnapshot"],
): SpawnRouteInput {
	return {
		settings,
		modelRegistry: registry,
		spawnExplicit: "anthropic/claude-opus-5:high",
		responsibility,
		policySnapshot,
	};
}

const campaignYaml = `task:
  routeEnforcement:
    routes:
      - responsibility: reviewer
        action: override
        role: slow
      - responsibility: implementer
        action: override
        selector: pi/slow
      - responsibility: quick_task
        action: override
        role: smol
      - responsibility: explore
        action: override
        selector: pi/smol
      - responsibility: designer
        action: override
        role: slow
        category: ui
      - responsibility: operator
        action: refuse
        role: slow
    exemptCategories:
      - ui
`;

describe("exact responsibility route admission", () => {
	it("resolves every advertised responsibility to its exact selector", () => {
		expect(EXACT_RESPONSIBILITY_ROUTES).toEqual({
			quick_task: "openai-codex/gpt-5.6-luna:medium",
			explore: "openai-codex/gpt-5.6-luna:medium",
			librarian: "openai-codex/gpt-5.6-luna:medium",
			reviewer: "openai-codex/gpt-5.6-luna:medium",
			qa: "openai-codex/gpt-5.6-luna:medium",
			research: "openai-codex/gpt-5.6-luna:medium",
			authenticated_web: "openai-codex/gpt-5.6-luna:medium",
			vision: "openai-codex/gpt-5.6-luna:medium",
			smol: "openai-codex/gpt-5.6-luna:medium",
			task: "openai-codex/gpt-5.6-luna:medium",
			plan: "openai-codex/gpt-5.6-sol:medium",
			implementer: "openai-codex/gpt-5.6-sol:medium",
			oracle: "openai-codex/gpt-5.6-sol:medium",
			operator: "openai-codex/gpt-5.6-sol:medium",
			synthesizer: "openai-codex/gpt-5.6-sol:medium",
			orchestrator: "openai-codex/gpt-5.6-sol:medium",
			default: "openai-codex/gpt-5.6-sol:medium",
			designer: "anthropic/claude-opus-5:medium",
		});
		for (const [responsibility, responsibilityDefault] of Object.entries(EXACT_RESPONSIBILITY_ROUTES)) {
			const receipt = toSpawnRouteReceipt(
				resolveSpawnRoute({
					settings,
					modelRegistry: registry,
					responsibility,
					responsibilityDefault,
					sessionInherited: "anthropic/claude-opus-5:high",
				}),
			);
			expect(receipt.route.selector).toBe(responsibilityDefault);
			expect(receipt.enforcementSource).toBe("responsibility_default");
		}
	});

	it("never inherits an omitted responsibility model from the parent session", () => {
		const decision = resolveSpawnRoute({
			settings,
			modelRegistry: registry,
			responsibility: "custom_without_route",
			sessionInherited: "anthropic/claude-opus-5:high",
			globalDefault: "anthropic/claude-opus-5:high",
		});
		expect(decision.route).toBeUndefined();
		expect(decision.invalid).toMatchObject({
			kind: "missing_responsibility_route",
			reason: 'responsibility "custom_without_route" has no executable model selector',
		});
	});

	it("rejects a responsibility selector without explicit effort", () => {
		const decision = resolveSpawnRoute({
			settings,
			modelRegistry: registry,
			responsibility: "reviewer",
			responsibilityDefault: "openai-codex/gpt-5.6-luna",
		});
		expect(decision.route).toBeUndefined();
		expect(decision.invalid?.kind).toBe("missing_route_effort");
	});

	it("canonicalizes med in responsibility defaults and per-task overrides", () => {
		const responsibilityDefault = resolveSpawnRoute({
			settings,
			modelRegistry: registry,
			responsibility: "reviewer",
			responsibilityDefault: "openai-codex/gpt-5.6-luna:med",
		});
		expect(responsibilityDefault.invalid).toBeUndefined();
		expect(responsibilityDefault.route?.selector).toBe("openai-codex/gpt-5.6-luna:medium");

		const perTaskOverride = resolveSpawnRoute({
			settings,
			modelRegistry: registry,
			responsibility: "reviewer",
			responsibilityDefault: "openai-codex/gpt-5.6-luna:high",
			spawnExplicit: "openai-codex/gpt-5.6-luna:med",
		});
		expect(perTaskOverride.invalid).toBeUndefined();
		expect(perTaskOverride.source).toBe("spawn_explicit");
		expect(perTaskOverride.route?.selector).toBe("openai-codex/gpt-5.6-luna:medium");
	});

	it("names packet-local escalation in the route receipt", () => {
		const receipt = toSpawnRouteReceipt(
			resolveSpawnRoute({
				settings,
				modelRegistry: registry,
				responsibility: "reviewer",
				responsibilityDefault: EXACT_RESPONSIBILITY_ROUTES.reviewer,
				spawnExplicit: "openai-codex/gpt-5.6-sol:high",
			}),
		);
		expect(receipt).toMatchObject({
			requestedSelector: "openai-codex/gpt-5.6-sol:high",
			effectiveSelector: "openai-codex/gpt-5.6-sol:high",
			enforcementSource: "packet_local_escalation",
		});
	});
});

describe("responsibility route enforcement campaign", () => {
	it("atomically overrides explicit routes, exempts UI, reaches nested spawns, expires, and rolls back", async () => {
		const directory = await tempDirectory();
		const campaignPath = path.join(directory, "campaign.yml");
		await Bun.write(campaignPath, campaignYaml);
		const activatedAt = new Date("2026-07-26T00:00:00.000Z");
		const imported = JSON.parse(
			await runPolicyCommand(
				{
					action: "import",
					sourcePaths: [campaignPath],
					apply: true,
					expiresIn: "1d",
					reason: "Majordomo temporary responsibility routing campaign",
					json: true,
				},
				{ directory, now: () => activatedAt },
			),
		);
		expect(imported.committed).toBe(true);
		expect(imported.transaction.mutations).toHaveLength(1);
		expect(imported.transaction.mutations[0].value.routes).toHaveLength(6);
		expect(imported.transaction.expiresAt).toBe("2026-07-27T00:00:00.000Z");

		const journal = await PolicyJournal.acquire({ directory, now: () => activatedAt });
		const service = makePolicyService(journal);
		const snapshot = await Effect.runPromise(service.snapshot({ at: activatedAt.toISOString() }));
		for (const responsibility of ["reviewer", "implementer"] as const) {
			const receipt = toSpawnRouteReceipt(resolveSpawnRoute(routeInput(responsibility, snapshot)));
			expect(receipt.source).toBe("policy_enforced");
			expect(receipt.route.selector).toBe("openai-codex/gpt-5.6-sol:medium");
			expect(receipt.enforcementSource).toBe("policy_enforcement");
			expect(receipt.routeEnforcement).toMatchObject({
				outcome: "overridden",
				requestedSelector: "anthropic/claude-opus-5:high",
				effectiveSelector: "openai-codex/gpt-5.6-sol:medium",
				transactionId: imported.transaction.transactionId,
				reason: "Majordomo temporary responsibility routing campaign",
				expiresAt: "2026-07-27T00:00:00.000Z",
			});
		}
		for (const responsibility of ["quick_task", "explore"] as const) {
			const receipt = toSpawnRouteReceipt(resolveSpawnRoute(routeInput(responsibility, snapshot)));
			expect(receipt.route.selector).toBe("openai-codex/gpt-5.6-luna:medium");
		}
		const designer = toSpawnRouteReceipt(resolveSpawnRoute(routeInput("designer", snapshot)));
		expect(designer.route.selector).toBe("anthropic/claude-opus-5:high");
		expect(designer.routeEnforcement?.outcome).toBe("excepted");

		const nestedSnapshot = await Effect.runPromise(service.snapshot({ at: activatedAt.toISOString() }));
		const nested = toSpawnRouteReceipt(resolveSpawnRoute(routeInput("implementer", nestedSnapshot)));
		expect(nested.route.selector).toBe("openai-codex/gpt-5.6-sol:medium");
		expect(nested.routeEnforcement?.transactionId).toBe(imported.transaction.transactionId);

		const refused = resolveSpawnRoute(routeInput("operator", snapshot));
		expect(refused.block).toMatchObject({
			kind: "routing_policy_enforcement",
			requestedSelector: "anthropic/claude-opus-5:high",
		});

		const expired = await Effect.runPromise(service.snapshot({ at: "2026-07-27T00:00:00.000Z" }));
		const afterExpiry = toSpawnRouteReceipt(resolveSpawnRoute(routeInput("reviewer", expired)));
		expect(afterExpiry.source).toBe("spawn_explicit");
		expect(afterExpiry.route.selector).toBe("anthropic/claude-opus-5:high");
		expect(afterExpiry.routeEnforcement).toBeUndefined();
		await journal.release();

		const rolledBack = JSON.parse(
			await runPolicyCommand(
				{
					action: "rollback",
					transactionId: imported.transaction.transactionId,
					reason: "end temporary routing campaign",
					json: true,
				},
				{ directory, now: () => new Date("2026-07-26T12:00:00.000Z") },
			),
		);
		expect(rolledBack.committed).toBe(true);
		const afterRollbackJournal = await PolicyJournal.acquire({ directory });
		const afterRollback = await Effect.runPromise(
			makePolicyService(afterRollbackJournal).snapshot({ at: "2026-07-26T12:00:01.000Z" }),
		);
		const legacy = toSpawnRouteReceipt(resolveSpawnRoute(routeInput("reviewer", afterRollback)));
		expect(legacy.source).toBe("spawn_explicit");
		expect(legacy.route.selector).toBe("anthropic/claude-opus-5:high");
		await afterRollbackJournal.release();
	});

	it("exposes transaction reason and expiry through policy explain and diff", async () => {
		const directory = await tempDirectory();
		const campaignPath = path.join(directory, "campaign.yml");
		await Bun.write(campaignPath, campaignYaml);
		const now = () => new Date("2026-07-26T00:00:00.000Z");
		const imported = JSON.parse(
			await runPolicyCommand(
				{
					action: "import",
					sourcePaths: [campaignPath],
					apply: true,
					expiresAt: "2026-07-27T00:00:00.000Z",
					reason: "explainable campaign",
					json: true,
				},
				{ directory, now },
			),
		);
		const explanation = JSON.parse(
			await runPolicyCommand(
				{ action: "explain", key: "core.routing.enforcement", json: true },
				{ directory, now },
			),
		);
		expect(explanation.winner.transactionId).toBe(imported.transaction.transactionId);
		expect(explanation.stack[0]).toMatchObject({
			reason: "explainable campaign",
			expiresAt: "2026-07-27T00:00:00.000Z",
			state: "active",
		});
		const difference = JSON.parse(
			await runPolicyCommand(
				{ action: "diff", from: "0", to: "1", json: true },
				{ directory, now },
			),
		);
		expect(difference.changes).toHaveLength(1);
		expect(difference.changes[0]).toMatchObject({
			key: "core.routing.enforcement",
			after: { transactionId: imported.transaction.transactionId },
		});
	});
});
