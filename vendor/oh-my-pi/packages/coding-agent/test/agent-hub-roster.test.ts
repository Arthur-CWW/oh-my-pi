import { describe, expect, it } from "bun:test";
import {
	agentAncestorPath,
	cycleVisibleAgentSibling,
	expandAgentAncestors,
	projectAgentRoster,
} from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub-roster";
import { AgentRegistry, MAIN_AGENT_ID, type AgentStatus } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";

function add(
	registry: AgentRegistry,
	id: string,
	parentId?: string,
	status: AgentStatus = "running",
): void {
	registry.register({ id, displayName: id, kind: "sub", parentId, session: null, status });
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
		expect(rows.map(row => row.ref.id)).toEqual([
			"Alpha",
			"Alpha.One",
			"Alpha.One.Leaf",
			"Alpha.Two",
			"Beta",
		]);
		expect(rows.map(row => row.guide)).toEqual(["", "├ • ", "│ └ • ", "└ • ", ""]);
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
});
