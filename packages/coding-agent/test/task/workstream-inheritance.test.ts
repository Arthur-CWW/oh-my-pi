import { describe, expect, test } from "bun:test";
import { type SessionWorkstream, workstreamCharterPath } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { MemorySessionStorage } from "@oh-my-pi/pi-coding-agent/session/session-storage";
import { inheritParentWorkstream } from "@oh-my-pi/pi-coding-agent/task/executor";

const STREAM: SessionWorkstream = { kind: "workstream", id: "harness" };

function goalObjective(manager: SessionManager): string | undefined {
	const goalEntry = manager.getEntries().find(entry => entry.type === "mode_change" && entry.mode === "goal");
	return goalEntry?.type === "mode_change" ? (goalEntry.data?.goal as { objective?: string } | undefined)?.objective : undefined;
}

describe("task child workstream inheritance", () => {
	test("persists a spawn-time snapshot independently for sibling child sessions", async () => {
		const storage = new MemorySessionStorage();
		const parent = SessionManager.create("/project", "/sessions", storage);
		await parent.setWorkstream(STREAM);
		const spawnSnapshot = parent.getWorkstream();

		const childA = SessionManager.create("/project", "/sessions", storage);
		const childB = SessionManager.create("/project", "/sessions", storage);
		await inheritParentWorkstream(childA, spawnSnapshot);
		await inheritParentWorkstream(childB, spawnSnapshot);
		childA.appendModeChange("goal", { goal: { objective: "Child A goal" } });
		childB.appendModeChange("goal", { goal: { objective: "Child B goal" } });
		await childA.ensureOnDisk();
		await childB.ensureOnDisk();

		expect(childA.getSessionId()).not.toBe(childB.getSessionId());
		expect(childA.getSessionFile()).not.toBe(childB.getSessionFile());
		expect(goalObjective(childA)).toBe("Child A goal");
		expect(goalObjective(childB)).toBe("Child B goal");
		expect(childA.getWorkstream()).toEqual(STREAM);
		expect(childB.getWorkstream()).toEqual(STREAM);
		const childWorkstream = childA.getWorkstream();
		expect(childWorkstream?.kind).toBe("workstream");
		expect(workstreamCharterPath(childWorkstream?.kind === "workstream" ? childWorkstream.id : "")).toBe(
			"streams/harness/GOAL.md",
		);

		await parent.setWorkstream({ kind: "workstream", id: "reclassified-parent" });
		expect(childA.getWorkstream()).toEqual(STREAM);
		expect(childB.getWorkstream()).toEqual(STREAM);

		const reopenedA = await SessionManager.open(childA.getSessionFile()!, "/sessions", storage);
		const reopenedB = await SessionManager.open(childB.getSessionFile()!, "/sessions", storage);
		expect(reopenedA.getWorkstream()).toEqual(STREAM);
		expect(reopenedB.getWorkstream()).toEqual(STREAM);
	});

	test("preserves adhoc and unclassified semantics across in-process and isolated cwd children", async () => {
		const storage = new MemorySessionStorage();
		const adhocParent = SessionManager.create("/project", "/sessions", storage);
		await adhocParent.setWorkstream({ kind: "adhoc" });

		const inProcessChild = SessionManager.create("/project", "/sessions", storage);
		const isolatedChild = SessionManager.create("/isolated-worktree", "/sessions", storage);
		await inheritParentWorkstream(inProcessChild, adhocParent.getWorkstream());
		await inheritParentWorkstream(isolatedChild, adhocParent.getWorkstream());
		expect(inProcessChild.getWorkstream()).toEqual({ kind: "adhoc" });
		expect(isolatedChild.getWorkstream()).toEqual({ kind: "adhoc" });

		const legacyParent = SessionManager.create("/legacy", "/sessions", storage);
		const unclassifiedChild = SessionManager.create("/legacy", "/sessions", storage);
		expect(await inheritParentWorkstream(unclassifiedChild, legacyParent.getWorkstream())).toBe(false);
		expect(unclassifiedChild.getWorkstream()).toBeUndefined();
	});

	test("grandchildren snapshot their immediate parent's current classification", async () => {
		const storage = new MemorySessionStorage();
		const parent = SessionManager.create("/project", "/sessions", storage);
		await parent.setWorkstream(STREAM);
		const child = SessionManager.create("/project", "/sessions", storage);
		await inheritParentWorkstream(child, parent.getWorkstream());

		await child.setWorkstream({ kind: "workstream", id: "child-current" });
		const grandchild = SessionManager.create("/project", "/sessions", storage);
		await inheritParentWorkstream(grandchild, child.getWorkstream());

		await child.setWorkstream({ kind: "adhoc" });
		expect(parent.getWorkstream()).toEqual(STREAM);
		expect(child.getWorkstream()).toEqual({ kind: "adhoc" });
		expect(grandchild.getWorkstream()).toEqual({ kind: "workstream", id: "child-current" });
	});
});
