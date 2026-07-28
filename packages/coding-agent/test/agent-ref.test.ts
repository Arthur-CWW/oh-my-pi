import { describe, expect, it } from "bun:test";
import { dottedParentId, isAgentJobOwned, isDottedDescendant, resolveAgentRef } from "../src/registry/agent-ref";
import { AgentRegistry } from "../src/registry/agent-registry";

function registryTree(): AgentRegistry {
	const registry = new AgentRegistry();
	registry.register({ id: "Main", displayName: "main", kind: "main", session: null, status: "idle" });
	registry.register({
		id: "Parent",
		displayName: "parent",
		kind: "sub",
		parentId: "Main",
		session: null,
		status: "idle",
	});
	registry.register({
		id: "Parent.Child",
		displayName: "child",
		kind: "sub",
		parentId: "Parent",
		session: null,
		status: "running",
	});
	registry.register({
		id: "Foreign.Child",
		displayName: "foreign",
		kind: "sub",
		parentId: "Foreign",
		session: null,
		status: "running",
	});
	return registry;
}

describe("AgentRef resolution", () => {
	it("resolves exact identity and preserves requester attribution", () => {
		const resolved = resolveAgentRef("Main", "Main", registryTree());
		expect(resolved).toMatchObject({ attributionId: "Main", via: "exact", ref: { id: "Main" } });
	});

	it("resolves a registered dotted descendant through lineage", () => {
		const resolved = resolveAgentRef("Parent.Child", "Main", registryTree());
		expect(resolved).toMatchObject({ attributionId: "Main", via: "descendant", ref: { id: "Parent.Child" } });
		expect(dottedParentId("Parent.Child")).toBe("Parent");
		expect(isDottedDescendant("Parent.Child", "Parent")).toBe(true);
	});

	it("rejects a foreign registered tree even when the target is dotted", () => {
		expect(resolveAgentRef("Foreign.Child", "Main", registryTree())).toBeUndefined();
	});

	it("uses job ownership only after exact and lineage resolution", () => {
		const registry = registryTree();
		const ownedJob = { id: "Parent.Child", ownerId: "Parent" };
		expect(isAgentJobOwned(ownedJob, "Main", registry)).toBe(true);
		expect(isAgentJobOwned({ id: "Foreign.Child", ownerId: "Foreign" }, "Main", registry)).toBe(false);
	});
});
