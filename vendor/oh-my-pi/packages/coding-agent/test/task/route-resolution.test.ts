import { describe, expect, it } from "bun:test";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { ModelLookupRegistry } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { resolveSpawnRoute, type SpawnRouteInput, type SpawnRouteSource } from "@oh-my-pi/pi-coding-agent/task/route-resolution";

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

function input(overrides: Omit<Partial<SpawnRouteInput>, "settings" | "modelRegistry"> = {}): SpawnRouteInput {
	return { settings: Settings.isolated({}), modelRegistry: registry, ...overrides };
}

const sourceSelectors: Readonly<Record<SpawnRouteSource, string>> = {
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
		SpawnRouteSource,
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
	it.each(Object.keys(sourceSelectors) as SpawnRouteSource[])("selects %s when it is the first usable tier", source => {
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

	it("falls through unresolved non-explicit tiers and stops at an invalid explicit tier", () => {
		const fallback = resolveSpawnRoute(input({ sessionTemporary: "missing/model", agentFrontmatter: "openai/smol-literal" }));
		expect(fallback.source).toBe("agent_frontmatter");
		expect(fallback.consulted.map(candidate => candidate.source)).toEqual(["session_temporary", "agent_frontmatter"]);

		const invalid = resolveSpawnRoute(input({ spawnExplicit: "missing/model", globalDefault: "openai/smol-literal" }));
		expect(invalid.invalid).toEqual({
			kind: "invalid_spawn_route",
			requested: ["missing/model"],
			patterns: ["missing/model"],
		});
		expect(invalid.consulted.map(candidate => candidate.source)).toEqual(["spawn_explicit"]);
	});

	it("normalizes a bare built-in spawn role without rewriting literal selectors", () => {
		const settings = Settings.isolated({ modelRoles: { smol: "openai/smol-literal", task: "openai-codex/gpt-5.6-terra" } });
		const role = resolveSpawnRoute({ settings, modelRegistry: registry, spawnExplicit: "smol" });
		expect(role.resolvedPatterns).toEqual(["openai/smol-literal"]);
		expect(role.route?.selector).toBe("openai/smol-literal");

		const literal = resolveSpawnRoute(input({ spawnExplicit: "openai/smol-literal" }));
		expect(literal.selectedSelectors).toEqual(["openai/smol-literal"]);
		expect(literal.resolvedPatterns).toEqual(["openai/smol-literal"]);

		const configuredTask = resolveSpawnRoute({ settings, modelRegistry: registry, agentModelOverride: "pi/task" });
		expect(configuredTask.resolvedPatterns).toEqual(["openai-codex/gpt-5.6-terra"]);
	});

	it("uses inherited and Settings default fallbacks, preserving route metadata and clamped thinking", () => {
		const inherited = resolveSpawnRoute(input({ sessionInherited: "openai/smol-literal", parentActiveSelector: "openai-codex/gpt-5.6-terra" }));
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
});
