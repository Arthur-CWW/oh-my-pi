import { describe, expect, it } from "bun:test";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { MemorySessionStorage } from "@oh-my-pi/pi-coding-agent/session/session-storage";
import { resolveSpawnRoute, rerouteSpawnRoute, toSpawnRouteReceipt } from "@oh-my-pi/pi-coding-agent/task/route-resolution";
import { appendSpawnRouteResolution, createSpawnRouteResolution, ROUTE_RESOLUTION_ENTRY } from "@oh-my-pi/pi-coding-agent/task/route-events";

const primary = buildModel({ id: "terra", name: "Terra", api: "openai-responses", provider: "openai-codex", baseUrl: "https://api.openai.com/v1", reasoning: true, thinking: { mode: "effort", efforts: [ThinkingLevel.Medium] }, input: ["text"], cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192 });
const fallback = buildModel({ id: "fallback", name: "Fallback", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text"], cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192 });
const registry = { getAvailable: () => [primary, fallback] };
const linkage = { agentId: "Worker", parentSessionId: "parent", parentAgentId: "Main", taskId: "task", packetId: null, branchId: null, turnId: null };

function manager() { return SessionManager.create("/project", "/sessions", new MemorySessionStorage()); }
function decision(overrides = {}) { return resolveSpawnRoute({ settings: Settings.isolated({}), modelRegistry: registry, ...overrides }); }

describe("spawn route resolution events", () => {
	it("records explicit and inherited receipts with linkage and monotonic sequence", () => {
		const session = manager();
		const explicit = appendSpawnRouteResolution(session, linkage, toSpawnRouteReceipt(decision({ spawnExplicit: "openai-codex/terra" })));
		const inherited = appendSpawnRouteResolution(session, linkage, toSpawnRouteReceipt(decision({ sessionInherited: "openai/fallback" })));
		expect(explicit.provenance.winningLayer).toBe("spawn_explicit");
		expect(inherited.provenance.winningLayer).toBe("session_inherited");
		expect(inherited.agentSeq).toBe(explicit.agentSeq + 1);
		expect(session.getEntries().at(-1)).toMatchObject({ type: "custom", customType: ROUTE_RESOLUTION_ENTRY, data: { agentId: "Worker", taskId: "task" } });
	});

	it("records automatic reroute original and final candidates", () => {
		const session = manager();
		const base = decision({ sessionInherited: "openai-codex/terra" });
		const rerouted = rerouteSpawnRoute(base, { providerId: "openai", modelId: "fallback", selector: "openai/fallback" }, { originalProvider: "openai-codex", reroutedProvider: "openai", originalModel: "openai-codex/terra", reroutedModel: "openai/fallback", ratePerHour: undefined, projectedEmptyAt: undefined, resetAt: undefined, deficitPerHour: undefined, decisionReason: "quota", quotaPoolId: undefined, limitWindowId: undefined }, "quota");
		const event = createSpawnRouteResolution(session, linkage, toSpawnRouteReceipt(rerouted));
		expect(event.provenance.winningLayer).toBe("automatic_reroute");
		expect(event.reason).toBe("quota");
		expect(event.candidates).toHaveLength(2);
	});

	it("rejects blocked and invalid decisions", () => {
		expect(() => toSpawnRouteReceipt(decision({ spawnExplicit: "missing/model" }))).toThrow();
		const blocked = { ...decision({ sessionInherited: "openai-codex/terra" }), block: { kind: "quota_admission_blocked" as const, selector: "openai-codex/terra", reason: undefined, resetAt: undefined } };
		expect(() => toSpawnRouteReceipt(blocked)).toThrow();
	});
});
