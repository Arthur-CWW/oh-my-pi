import { describe, expect, it } from "bun:test";
import {
	agentAncestorPath,
	agentHistoryRank,
	cycleVisibleAgentSibling,
	DurableJournalModelCache,
	expandAgentAncestors,
	type ExternalRosterPeer,
	HUB_FIELD_UNKNOWN,
	projectAgentRoster,
	projectExternalPeerIdentity,
	projectLocalAgentIdentity,
} from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub-roster";
import type { AgentRef } from "@oh-my-pi/pi-coding-agent/registry/agent-ref";
import { AgentRegistry, type AgentStatus, MAIN_AGENT_ID } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";

function add(registry: AgentRegistry, id: string, parentId?: string, status: AgentStatus = "running"): void {
	registry.register({ id, displayName: id, kind: "sub", parentId, session: null, status });
}

/**
 * Reproduce the exact array the Hub hands to the projection: one flat list
 * sorted by status lane, then spawn index. Roots carry the lane order the
 * section headers label, and every descendant inherits that same global sort.
 */
function statusLaneOrder(refs: readonly AgentRef[]): AgentRef[] {
	return [...refs].sort(
		(left, right) =>
			agentHistoryRank(left, false) - agentHistoryRank(right, false) ||
			left.spawnIndex - right.spawnIndex ||
			left.id.localeCompare(right.id),
	);
}

function externalPeer(overrides: Partial<ExternalRosterPeer> = {}): ExternalRosterPeer {
	return {
		sessionId: "/home/arthur/agents:41337",
		name: "agents-vlix62",
		cwd: "/home/arthur/agents",
		lastSeen: "2026-07-28T00:00:00.000Z",
		...overrides,
	};
}

function nestedRefs() {
	const registry = new AgentRegistry();
	add(registry, "Alpha", MAIN_AGENT_ID);
	add(registry, "Beta", MAIN_AGENT_ID);
	add(registry, "Alpha.One", "Alpha");
	add(registry, "Alpha.Two", "Alpha");
	add(registry, "Alpha.One.Leaf", "Alpha.One", "idle");
	return registry.list();
}

describe("Agent Hub roster projection", () => {
	it("preserves root and sibling order while flattening two nested levels", () => {
		const rows = projectAgentRoster(nestedRefs(), new Set());
		expect(rows.map(row => row.ref.id)).toEqual(["Alpha", "Alpha.One", "Alpha.One.Leaf", "Alpha.Two", "Beta"]);
		expect(rows.map(row => row.guide)).toEqual(["", "  ", "    ", "  ", ""]);
	});

	it("ranks every AgentStatus and keeps waiting-provider in the active lanes", () => {
		const expected: Record<AgentStatus, number> = {
			running: 0,
			"waiting-provider": 1,
			idle: 2,
			parked: 4,
			aborted: 5,
		};
		const registry = new AgentRegistry();
		for (const status of Object.keys(expected) as AgentStatus[]) add(registry, status, undefined, status);

		for (const ref of registry.list()) expect(agentHistoryRank(ref, false)).toBe(expected[ref.status]);
		const idle = registry.get("idle");
		expect(idle).toBeDefined();
		expect(agentHistoryRank(idle!, true)).toBe(3);
	});

	it("restores sibling spawn order after the Hub interleaves their status lanes", () => {
		const registry = new AgentRegistry();
		add(registry, "Parent", MAIN_AGENT_ID);
		add(registry, "Parent.Oldest", "Parent", "idle");
		add(registry, "Parent.Middle", "Parent", "running");
		add(registry, "Parent.Newest", "Parent", "waiting-provider");
		const statusOrdered = statusLaneOrder(registry.list());

		expect(statusOrdered.map(ref => ref.id)).toEqual(["Parent", "Parent.Middle", "Parent.Newest", "Parent.Oldest"]);
		expect(projectAgentRoster(statusOrdered, new Set()).map(row => row.ref.id)).toEqual([
			"Parent",
			"Parent.Oldest",
			"Parent.Middle",
			"Parent.Newest",
		]);
	});

	it("projects local and external peers into the same identity lanes", () => {
		const registry = new AgentRegistry();
		add(registry, "Local", MAIN_AGENT_ID);
		const ref = registry.get("Local");
		expect(ref).toBeDefined();
		const local = projectLocalAgentIdentity({
			ref: ref!,
			activity: "Stabilizing sibling order",
			nowMs: ref!.lastActivity + 60_000,
		});
		const external = projectExternalPeerIdentity({
			peer: externalPeer({
				name: "Remote",
				cwd: "/tmp/remote-workspace",
				lastSeen: "2026-07-28T00:00:00.000Z",
				labels: { label: "TUI engineer", activity: "Stabilizing sibling order" },
			}),
			nowMs: Date.parse("2026-07-28T00:01:00.000Z"),
		});

		expect(Object.keys(external)).toEqual(Object.keys(local));
		expect(external).toEqual({
			id: "Remote",
			displayName: "TUI engineer",
			activity: "Stabilizing sibling order",
			context: "/tmp/remote-workspace",
			age: local.age,
		});
		expect(
			projectExternalPeerIdentity({
				peer: externalPeer({ name: "", cwd: "", lastSeen: "not-a-date" }),
				nowMs: Date.parse("2026-07-28T00:01:00.000Z"),
			}),
		).toEqual({
			id: "/home/arthur/agents:41337",
			displayName: HUB_FIELD_UNKNOWN,
			activity: HUB_FIELD_UNKNOWN,
			context: HUB_FIELD_UNKNOWN,
			age: HUB_FIELD_UNKNOWN,
		});
	});

	it("hides a collapsed subtree and rolls up hidden and running descendants", () => {
		const rows = projectAgentRoster(nestedRefs(), new Set(["Alpha"]));
		expect(rows.map(row => row.ref.id)).toEqual(["Alpha", "Beta"]);
		expect(rows[0]?.collapsed).toEqual({ descendants: 3, running: 2 });
	});

	it("reveals matching paths with their ancestors through collapsed nodes", () => {
		const refs = nestedRefs();
		const rows = projectAgentRoster(refs, new Set(["Alpha", "Alpha.One"]), new Set(["Alpha.One.Leaf"]), true);
		expect(rows.map(row => row.ref.id)).toEqual(["Alpha", "Alpha.One", "Alpha.One.Leaf"]);
		expect(rows.every(row => row.collapsed === undefined)).toBe(true);
	});

	it("expands every selected ancestor without changing unrelated folds", () => {
		const refs = nestedRefs();
		expect(agentAncestorPath(refs, "Alpha.One.Leaf")).toEqual(["Alpha", "Alpha.One", "Alpha.One.Leaf"]);
		expect([...expandAgentAncestors(refs, new Set(["Alpha", "Alpha.One", "Beta"]), "Alpha.One.Leaf")]).toEqual([
			"Beta",
		]);
	});

	it("cycles only visible siblings at the same depth", () => {
		const rows = projectAgentRoster(nestedRefs(), new Set()).map(row => row.ref);
		expect(cycleVisibleAgentSibling(rows, "Alpha.One", 1)?.id).toBe("Alpha.Two");
		expect(cycleVisibleAgentSibling(rows, "Alpha.Two", 1)?.id).toBe("Alpha.One");
		expect(cycleVisibleAgentSibling(rows, "Alpha", 1)?.id).toBe("Beta");
	});

	it("leaves a childless roster visually neutral", () => {
		const registry = new AgentRegistry();
		add(registry, "Alpha", MAIN_AGENT_ID);
		add(registry, "Beta", MAIN_AGENT_ID);
		const refs = registry.list();
		const rows = projectAgentRoster(refs, new Set());
		expect(rows.map(row => row.ref)).toEqual(refs);
		expect(rows.map(row => row.guide)).toEqual(["", ""]);
	});

	it("degrades malformed parent cycles to ordered roots", () => {
		const registry = new AgentRegistry();
		add(registry, "Alpha", "Beta");
		add(registry, "Beta", "Alpha");
		const rows = projectAgentRoster(registry.list(), new Set());
		expect(rows.map(row => [row.ref.id, row.depth])).toEqual([
			["Alpha", 0],
			["Beta", 0],
		]);
	});

	it("caches durable journal model metadata by session file and mtime", async () => {
		let mtimeMs = 1;
		let reads = 0;
		let model = "openai-codex/gpt-5.6-terra";
		const cache = new DurableJournalModelCache({
			mtimeMs: async () => mtimeMs,
			readText: async () => {
				reads++;
				return `${JSON.stringify({
					type: "session_init",
					subagent: { model, thinkingLevel: "high" },
				})}\n`;
			},
		});

		expect(await cache.load("/sessions/Worker.jsonl")).toMatchObject({
			modelId: "openai-codex/gpt-5.6-terra",
			thinkingLevel: "high",
		});
		expect(await cache.load("/sessions/Worker.jsonl")).toMatchObject({
			modelId: "openai-codex/gpt-5.6-terra",
			thinkingLevel: "high",
		});
		expect(reads).toBe(1);

		mtimeMs = 2;
		model = "anthropic/claude-opus-4-5";
		expect(await cache.load("/sessions/Worker.jsonl")).toMatchObject({
			modelId: "anthropic/claude-opus-4-5",
			thinkingLevel: "high",
		});
		expect(reads).toBe(2);
	});
});
