import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { ModelLookupRegistry } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { Effect } from "effect";
import { PolicyJournal } from "../../src/policy/policy-journal";
import { makePolicyService } from "../../src/policy/policy-service";
import { resolveSpawnRoute, toSpawnRouteReceipt } from "../../src/task/route-resolution";

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
const secondary = buildModel({
	id: "smol-literal",
	name: "Smol literal",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 8192,
});
const registry: ModelLookupRegistry = { getAvailable: () => [primary, secondary] };
const policyKey = "core.routing.implementer" as const;
const temporaryDirectories: string[] = [];
const openJournals: PolicyJournal[] = [];

async function createJournal(): Promise<PolicyJournal> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-routing-cutover-"));
	temporaryDirectories.push(directory);
	const journal = await PolicyJournal.acquire({ directory });
	openJournals.push(journal);
	return journal;
}

afterEach(async () => {
	for (const journal of openJournals.splice(0)) await journal.release();
	for (const directory of temporaryDirectories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

describe("durable policy routing cutover", () => {
	it("preserves legacy settings routing for absent and empty journals", async () => {
		const journal = await createJournal();
		const service = makePolicyService(journal);
		const settings = Settings.isolated({ modelRoles: { implementer: "openai/smol-literal" } });
		const routeInput = {
			settings,
			modelRegistry: registry,
			agentFrontmatter: "pi/implementer",
			responsibility: "implementer",
		} as const;
		const legacyDecision = resolveSpawnRoute(routeInput);
		const legacyReceipt = toSpawnRouteReceipt(legacyDecision);

		const absentSnapshot = await Effect.runPromise(service.snapshot({ at: "2026-07-15T00:00:00.000Z" }));
		expect(await journal.replay()).toEqual([]);
		const absentDecision = resolveSpawnRoute({ ...routeInput, policyKey, policySnapshot: absentSnapshot });
		expect(absentDecision).toEqual(legacyDecision);
		expect(toSpawnRouteReceipt(absentDecision)).toEqual(legacyReceipt);

		await fs.writeFile(journal.journalPath, "", "utf8");
		const emptySnapshot = await Effect.runPromise(service.snapshot({ at: "2026-07-15T00:00:00.000Z" }));
		expect(await journal.replay()).toEqual([]);
		const emptyDecision = resolveSpawnRoute({ ...routeInput, policyKey, policySnapshot: emptySnapshot });
		expect(emptyDecision).toEqual(legacyDecision);
		expect(toSpawnRouteReceipt(emptyDecision)).toEqual(legacyReceipt);
	});

	it("routes a real workstream snapshot ahead of a later global value with journal provenance", async () => {
		const journal = await createJournal();
		const service = makePolicyService(journal);
		const workstreamSet = await Effect.runPromise(
			service.set({
				key: policyKey,
				value: "openai-codex/gpt-5.6-terra:low",
				scope: { kind: "workstream", workstream: "hr-129" },
				workstream: "hr-129",
				reason: "route HR-129 implementation work",
			}),
		);
		const globalSet = await Effect.runPromise(
			service.set({
				key: policyKey,
				value: "openai/smol-literal",
				scope: { kind: "global" },
				reason: "route implementation work globally",
			}),
		);
		const globalSnapshot = await Effect.runPromise(service.snapshot());
		const workstreamSnapshot = await Effect.runPromise(service.snapshot({ workstream: "hr-129" }));
		const settings = Settings.isolated({ modelRoles: { implementer: "openai-codex/gpt-5.6-terra" } });
		const routeInput = {
			settings,
			modelRegistry: registry,
			agentFrontmatter: "pi/implementer",
			responsibility: "implementer",
		} as const;

		const globalDecision = resolveSpawnRoute({ ...routeInput, policyKey, policySnapshot: globalSnapshot });
		expect(globalDecision.source).toBe("policy");
		expect(globalDecision.route?.selector).toBe("openai/smol-literal");
		expect(globalSnapshot.values[policyKey]).toMatchObject({
			sourceLayer: "global-durable",
			transactionId: globalSet.transaction.transactionId,
			sequence: 2,
		});

		const workstreamDecision = resolveSpawnRoute({ ...routeInput, policyKey, policySnapshot: workstreamSnapshot });
		const workstreamReceipt = toSpawnRouteReceipt(workstreamDecision);
		expect(workstreamDecision.source).toBe("policy");
		expect(workstreamReceipt.route.selector).toBe("openai-codex/gpt-5.6-terra:low");
		expect(workstreamSnapshot.values[policyKey]).toMatchObject({
			sourceLayer: "workstream-durable",
			transactionId: workstreamSet.transaction.transactionId,
			sequence: 1,
			shadowed: [
				expect.objectContaining({
					sourceLayer: "global-durable",
					transactionId: globalSet.transaction.transactionId,
					sequence: 2,
				}),
			],
		});
		expect(workstreamReceipt.consulted[0]?.policy).toEqual({
			key: policyKey,
			sourceLayer: "workstream-durable",
			transactionId: workstreamSet.transaction.transactionId,
			sequence: 1,
			snapshotAt: workstreamSnapshot.at,
		});
	});
});
