import { describe, expect, it } from "bun:test";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { ModelLookupRegistry } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import {
	admitSpawnRoute,
	reconcileSpawnRouteAuthFallback,
	resolveSpawnRoute,
	type SpawnRouteInput,
	type SpawnRouteSource,
	toSpawnRouteReceipt,
} from "@oh-my-pi/pi-coding-agent/task/route-resolution";
import type { PolicySnapshot } from "../../src/policy/policy-projection";
import type { CoreRoutingKey } from "../../src/policy/policy-records";

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
type LegacySpawnRouteSource = Exclude<SpawnRouteSource, "policy">;

const policyKey: CoreRoutingKey = "core.routing.implementer";
const policySnapshotAt = "2026-07-15T00:00:00.000Z";
const policyTransactionId = "7d7cc923-2da4-4aaa-9b98-cfb8b6806df3";
const expectedPolicyProvenance = {
	key: policyKey,
	sourceLayer: "workstream-durable",
	transactionId: policyTransactionId,
	sequence: 7,
	snapshotAt: policySnapshotAt,
} as const;
const policySnapshot: PolicySnapshot = {
	at: policySnapshotAt,
	workstream: "hr-129",
	values: {
		[policyKey]: {
			key: policyKey,
			value: "openai/smol-literal",
			sourceLayer: "workstream-durable",
			scope: { kind: "workstream", workstream: "hr-129" },
			transactionId: policyTransactionId,
			sequence: 7,
			shadowed: [],
		},
	},
	transactions: [],
	expiredTransactionIds: [],
	futureTransactionIds: [],
};

function input(overrides: Omit<Partial<SpawnRouteInput>, "settings" | "modelRegistry"> = {}): SpawnRouteInput {
	return { settings: Settings.isolated({}), modelRegistry: registry, ...overrides };
}

const sourceSelectors: Readonly<Record<LegacySpawnRouteSource, string>> = {
	spawn_explicit: "openai-codex/gpt-5.6-terra",
	session_explicit: "openai-codex/gpt-5.6-terra",
	session_temporary: "openai-codex/gpt-5.6-terra",
	agent_model_override: "openai-codex/gpt-5.6-terra",
	agent_frontmatter: "openai-codex/gpt-5.6-terra",
	session_inherited: "openai-codex/gpt-5.6-terra",
	global_default: "openai-codex/gpt-5.6-terra",
};

const sourceInputs: Readonly<
	Record<
		LegacySpawnRouteSource,
		| "spawnExplicit"
		| "sessionExplicit"
		| "sessionTemporary"
		| "agentModelOverride"
		| "agentFrontmatter"
		| "sessionInherited"
		| "globalDefault"
	>
> = {
	spawn_explicit: "spawnExplicit",
	session_explicit: "sessionExplicit",
	session_temporary: "sessionTemporary",
	agent_model_override: "agentModelOverride",
	agent_frontmatter: "agentFrontmatter",
	session_inherited: "sessionInherited",
	global_default: "globalDefault",
};

describe("resolveSpawnRoute", () => {
	it.each(
		Object.keys(sourceSelectors) as LegacySpawnRouteSource[],
	)("selects %s when it is the first usable tier", source => {
		const decision = resolveSpawnRoute(input({ [sourceInputs[source]]: sourceSelectors[source] }));
		expect(decision.source).toBe(source);
		expect(decision.route?.selector).toBe("openai-codex/gpt-5.6-terra");
	});

	it("uses the fixed precedence table", () => {
		const decision = resolveSpawnRoute(
			input({
				spawnExplicit: "openai-codex/gpt-5.6-terra",
				sessionExplicit: "openai/smol-literal",
				sessionTemporary: "openai/smol-literal",
				agentModelOverride: "openai/smol-literal",
				agentFrontmatter: "openai/smol-literal",
				sessionInherited: "openai/smol-literal",
				globalDefault: "openai/smol-literal",
			}),
		);
		expect(decision.source).toBe("spawn_explicit");
		expect(decision.consulted.map(candidate => candidate.source)).toEqual([
			"spawn_explicit",
			"session_explicit",
			"session_temporary",
			"agent_model_override",
			"agent_frontmatter",
			"session_inherited",
			"global_default",
		]);
		expect(Object.isFrozen(decision.consulted)).toBe(true);
		expect(decision.overridden.map(candidate => candidate.source)).toEqual([
			"session_explicit",
			"session_temporary",
			"agent_model_override",
			"agent_frontmatter",
			"session_inherited",
			"global_default",
		]);
	});

	it.each([
		["spawn_explicit", "spawnExplicit"],
		["session_explicit", "sessionExplicit"],
		["session_temporary", "sessionTemporary"],
	] as const)("keeps %s above a policy snapshot", (source, inputName) => {
		const decision = resolveSpawnRoute(
			input({
				[inputName]: "openai-codex/gpt-5.6-terra",
				policyKey,
				policySnapshot,
			}),
		);

		expect(decision.source).toBe(source);
		expect(decision.consulted.map(candidate => candidate.source)).toEqual([source, "policy"]);
		expect(decision.overridden.map(candidate => candidate.source)).toEqual(["policy"]);
		expect(decision.overridden[0]?.policy).toEqual(expectedPolicyProvenance);
	});

	it("selects policy before configured, frontmatter, inherited, and default fallbacks with exact provenance", () => {
		const decision = resolveSpawnRoute(
			input({
				policyKey,
				policySnapshot,
				agentModelOverride: "openai-codex/gpt-5.6-terra",
				agentFrontmatter: "openai-codex/gpt-5.6-terra",
				sessionInherited: "openai-codex/gpt-5.6-terra",
				globalDefault: "openai-codex/gpt-5.6-terra",
			}),
		);
		const receipt = toSpawnRouteReceipt(decision);

		expect(decision.source).toBe("policy");
		expect(receipt.route.selector).toBe("openai/smol-literal");
		expect(receipt.consulted.map(candidate => candidate.source)).toEqual([
			"policy",
			"agent_model_override",
			"agent_frontmatter",
			"session_inherited",
			"global_default",
		]);
		expect(receipt.overridden.map(candidate => candidate.source)).toEqual([
			"agent_model_override",
			"agent_frontmatter",
			"session_inherited",
			"global_default",
		]);
		expect(receipt.consulted[0]).toEqual({
			source: "policy",
			explicit: false,
			selectors: ["openai/smol-literal"],
			patterns: ["openai/smol-literal"],
			policy: expectedPolicyProvenance,
		});
	});

	it("falls through unresolved non-explicit tiers and stops at an invalid explicit tier", () => {
		const fallback = resolveSpawnRoute(
			input({ sessionTemporary: "missing/model", agentFrontmatter: "openai/smol-literal" }),
		);
		expect(fallback.source).toBe("agent_frontmatter");
		expect(fallback.consulted.map(candidate => candidate.source)).toEqual(["session_temporary", "agent_frontmatter"]);

		const invalid = resolveSpawnRoute(
			input({ spawnExplicit: "missing/model", globalDefault: "openai/smol-literal" }),
		);
		expect(invalid.invalid).toEqual({
			kind: "invalid_spawn_route",
			requested: ["missing/model"],
			patterns: ["missing/model"],
		});
		expect(invalid.consulted.map(candidate => candidate.source)).toEqual(["spawn_explicit"]);
	});

	it("normalizes a bare built-in spawn role without rewriting literal selectors", () => {
		const settings = Settings.isolated({
			modelRoles: { smol: "openai/smol-literal", task: "openai-codex/gpt-5.6-terra" },
		});
		const role = resolveSpawnRoute({ settings, modelRegistry: registry, spawnExplicit: "smol" });
		expect(role.resolvedPatterns).toEqual(["openai/smol-literal"]);
		expect(role.route?.selector).toBe("openai/smol-literal");

		const literal = resolveSpawnRoute(input({ spawnExplicit: "openai/smol-literal" }));
		expect(literal.selectedSelectors).toEqual(["openai/smol-literal"]);
		expect(literal.resolvedPatterns).toEqual(["openai/smol-literal"]);

		const configuredTask = resolveSpawnRoute({ settings, modelRegistry: registry, agentModelOverride: "pi/task" });
		expect(configuredTask.resolvedPatterns).toEqual(["openai-codex/gpt-5.6-terra"]);
	});

	it.each([
		"implementer",
		"qa",
		"operator",
		"synthesizer",
	] as const)("resolves the %s responsibility lane without inheriting the parent session", responsibility => {
		const settings = Settings.isolated({
			modelRoles: {
				[responsibility]: "openai/smol-literal",
				default: "openai-codex/gpt-5.6-terra",
			},
		});
		const decision = resolveSpawnRoute({
			settings,
			modelRegistry: registry,
			agentFrontmatter: `pi/${responsibility}`,
			sessionInherited: "openai-codex/gpt-5.6-terra",
			parentActiveSelector: "openai-codex/gpt-5.6-terra",
			responsibility,
		});
		const receipt = toSpawnRouteReceipt(decision);

		expect(decision.source).toBe("agent_frontmatter");
		expect(receipt).toMatchObject({
			responsibility,
			resolutionSource: "agent_frontmatter",
			resolvedLane: "openai/smol-literal",
		});
		expect(receipt.route.selector).not.toBe(receipt.route.parentActiveSelector);
	});

	it("resolves the deprecated task alias as implementer unless modelRoles.task is configured", () => {
		const base = {
			modelRegistry: registry,
			agentFrontmatter: "pi/task",
			sessionInherited: "openai-codex/gpt-5.6-terra",
			parentActiveSelector: "openai-codex/gpt-5.6-terra",
			responsibility: "implementer",
			alias: "deprecated-alias" as const,
		};
		const inheritedImplementer = resolveSpawnRoute({
			...base,
			settings: Settings.isolated({
				modelRoles: { implementer: "openai/smol-literal", default: "openai-codex/gpt-5.6-terra" },
			}),
		});
		expect(toSpawnRouteReceipt(inheritedImplementer)).toMatchObject({
			alias: "deprecated-alias",
			responsibility: "implementer",
			resolutionSource: "agent_frontmatter",
			resolvedLane: "openai/smol-literal",
		});

		const configuredAlias = resolveSpawnRoute({
			...base,
			settings: Settings.isolated({
				modelRoles: {
					task: "openai-codex/gpt-5.6-terra",
					implementer: "openai/smol-literal",
				},
			}),
		});
		expect(configuredAlias.route?.selector).toBe("openai-codex/gpt-5.6-terra");
	});

	it("does not fall through an unavailable responsibility chain to the parent session", () => {
		const decision = resolveSpawnRoute({
			settings: Settings.isolated({ modelRoles: { implementer: "missing/model" } }),
			modelRegistry: { getAvailable: () => [secondary] },
			agentFrontmatter: "pi/implementer",
			sessionInherited: "openai/smol-literal",
			parentActiveSelector: "openai/smol-literal",
			responsibility: "implementer",
		});

		expect(decision.source).toBe("agent_frontmatter");
		expect(decision.route).toBeUndefined();
		expect(decision.invalid).toMatchObject({ kind: "invalid_spawn_route" });
		expect(decision.consulted.map(candidate => candidate.source)).not.toContain("session_inherited");
	});

	it("keeps an explicit spawn model above responsibility lane resolution", () => {
		const decision = resolveSpawnRoute({
			settings: Settings.isolated({ modelRoles: { implementer: "openai/smol-literal" } }),
			modelRegistry: registry,
			spawnExplicit: "openai-codex/gpt-5.6-terra",
			agentFrontmatter: "pi/implementer",
			sessionInherited: "openai/smol-literal",
			responsibility: "implementer",
		});
		expect(toSpawnRouteReceipt(decision)).toMatchObject({
			responsibility: "implementer",
			resolutionSource: "spawn_explicit",
			resolvedLane: "openai-codex/gpt-5.6-terra",
		});
	});

	it("uses inherited and Settings default fallbacks, preserving route metadata and clamped thinking", () => {
		const inherited = resolveSpawnRoute(
			input({ sessionInherited: "openai/smol-literal", parentActiveSelector: "openai-codex/gpt-5.6-terra" }),
		);
		expect(inherited.source).toBe("session_inherited");
		expect(inherited.route?.parentActiveSelector).toBe("openai-codex/gpt-5.6-terra");

		const defaulted = resolveSpawnRoute({
			settings: Settings.isolated({ modelRoles: { default: "openai/smol-literal" } }),
			modelRegistry: registry,
		});
		expect(defaulted.source).toBe("global_default");

		const thinking = resolveSpawnRoute(input({ spawnExplicit: "openai-codex/gpt-5.6-terra:xhigh" }));
		expect(thinking.route?.thinking).toBe(ThinkingLevel.Medium);
	});

	it("reconciles auth fallback into the sole receipt while preserving quota history", () => {
		const selected = admitSpawnRoute(
			resolveSpawnRoute(
				input({
					agentFrontmatter: "openai/smol-literal",
					parentActiveSelector: "openai-codex/gpt-5.6-terra",
				}),
			),
			{
				originalProvider: "openai",
				originalModel: "openai/smol-literal",
				decisionReason: "quota admitted selected route",
			},
		);
		const reconciled = reconcileSpawnRouteAuthFallback(selected, primary, ThinkingLevel.Low, true);
		const receipt = toSpawnRouteReceipt(reconciled);

		expect(receipt.source).toBe("auth_fallback");
		expect(receipt.originalSource).toBe("agent_frontmatter");
		expect(receipt.originalRoute?.selector).toBe("openai/smol-literal");
		expect(receipt.route.selector).toBe("openai-codex/gpt-5.6-terra:low");
		expect(receipt.reason).toBe("auth fallback from openai/smol-literal to openai-codex/gpt-5.6-terra:low");
		expect(reconciled.quotaAdmission).toMatchObject({
			originalProvider: "openai",
			originalModel: "openai/smol-literal",
			decisionReason: "quota admitted selected route",
		});
		expect(receipt.quotaAdmission).toEqual(reconciled.quotaAdmission);
		expect(receipt.priorAttempts).toHaveLength(1);
		expect(receipt.priorAttempts?.[0]).toMatchObject({
			source: "agent_frontmatter",
			reason: "auth fallback from openai/smol-literal to openai-codex/gpt-5.6-terra:low",
		});
	});

	it("rejects auth fallback reconciliation for explicit routes", () => {
		const explicit = resolveSpawnRoute(input({ spawnExplicit: "openai/smol-literal" }));
		expect(() => reconcileSpawnRouteAuthFallback(explicit, primary, undefined, false)).toThrow(
			"Cannot apply auth fallback",
		);
	});
});
