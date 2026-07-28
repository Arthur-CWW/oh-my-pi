import { describe, expect, it } from "bun:test";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import {
	appendChildLifecycleRecord,
	latestChildLifecycleRecord,
	transitionChildLifecycleRecord,
} from "@oh-my-pi/pi-coding-agent/task/child-lifecycle";

describe("child lifecycle journal records", () => {
	it("appends versioned snapshots and preserves terminal records", () => {
		const manager = SessionManager.inMemory();
		appendChildLifecycleRecord(manager, {
			version: 1,
			agentId: "Worker",
			childSessionFile: "/sessions/parent/Worker.jsonl",
			parentSessionFile: "/sessions/parent.jsonl",
			state: "running",
			updatedAt: "2026-07-10T00:00:00.000Z",
			modelId: "openai-codex/gpt-5.6-terra",
			thinkingLevel: "medium",
		});

		transitionChildLifecycleRecord(manager, "idle");
		expect(latestChildLifecycleRecord(manager.getEntries())).toEqual(
			expect.objectContaining({ state: "idle", agentId: "Worker", version: 1 }),
		);

		transitionChildLifecycleRecord(manager, "completed");
		transitionChildLifecycleRecord(manager, "parked");
		expect(latestChildLifecycleRecord(manager.getEntries())).toEqual(expect.objectContaining({ state: "completed" }));
	});
});
