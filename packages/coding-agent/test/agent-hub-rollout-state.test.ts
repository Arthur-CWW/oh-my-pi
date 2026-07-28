import { describe, expect, it } from "bun:test";
import { createAgentHubRolloutDataSource } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub-rollout-state";
import { RolloutJournal } from "@oh-my-pi/pi-coding-agent/session/rollout-journal";
import { TempDir } from "@oh-my-pi/pi-utils";

describe("Agent Hub rollout state", () => {
	it("resolves the latest peer by session identity and expires only terminal phases", () => {
		using tempDir = TempDir.createSync("@omp-hub-rollout-");
		const dbPath = `${tempDir.path()}/rollout.sqlite`;
		const journal = new RolloutJournal(dbPath);
		journal.beginRun({
			rolloutId: "active-run",
			targetDigest: "1234567890abcdef",
			targetVersion: "2.0.0",
			startedAt: "2026-07-14T00:00:00.000Z",
		});
		journal.updatePeer({
			rolloutId: "active-run",
			sessionId: "worker-session",
			sessionFile: "/tmp/worker.jsonl",
			name: "Worker",
			phase: "planned",
			updatedAt: "2026-07-14T00:00:00.000Z",
		});
		journal.updatePeer({
			rolloutId: "active-run",
			sessionId: "worker-session",
			sessionFile: "/tmp/worker.jsonl",
			name: "Worker",
			phase: "requested",
			updatedAt: "2026-07-14T00:00:00.000Z",
		});
		journal.beginRun({
			rolloutId: "expired-run",
			targetDigest: "fedcba0987654321",
			targetVersion: "1.9.0",
			startedAt: "2026-07-13T00:00:00.000Z",
		});
		journal.updatePeer({
			rolloutId: "expired-run",
			sessionId: "old-session",
			name: "Old Worker",
			phase: "skipped",
			reason: "already-current",
			updatedAt: "2026-07-13T00:00:00.000Z",
		});
		journal.close();

		const source = createAgentHubRolloutDataSource({
			dbPath,
			terminalTtlMs: 60_000,
			now: () => Date.parse("2026-07-14T00:05:00.000Z"),
		});
		expect(source.latestForPeer({ sessionId: "worker-session" })).toMatchObject({
			rolloutId: "active-run",
			phase: "requested",
		});
		expect(source.latestForPeer({ sessionFile: "/tmp/worker.jsonl" })?.sessionId).toBe("worker-session");
		expect(source.latestForPeer({ sessionId: "old-session" })).toBeUndefined();
		expect(source.latestForPeer({})).toBeUndefined();
		source.close?.();
	});
});
