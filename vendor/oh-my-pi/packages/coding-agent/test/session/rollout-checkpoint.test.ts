import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentSession } from "../../src/session/agent-session";
import {
	assembleRolloutCheckpoint,
	decodeRolloutCheckpoint,
	ROLLOUT_CHECKPOINT_CUSTOM_TYPE,
} from "../../src/session/rollout-checkpoint";
import { SessionManager } from "../../src/session/session-manager";

const cleanupRoots: string[] = [];

async function fixture() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-rollout-checkpoint-"));
	cleanupRoots.push(root);
	const sessionManager = SessionManager.create(root, path.join(root, "sessions"));
	let restartCheckpointCalls = 0;
	const session = {
		asyncJobManager: undefined,
		checkpointChildJobsForRestart: async () => {
			restartCheckpointCalls += 1;
		},
	} as unknown as AgentSession;
	return { root, sessionManager, session, restartCheckpointCalls: () => restartCheckpointCalls };
}

afterEach(async () => {
	await Promise.all(cleanupRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("rollout checkpoint", () => {
	it("does not interrupt running provider work and journals a deferred cordoned checkpoint", async () => {
		const { sessionManager, session, restartCheckpointCalls } = await fixture();
		let providerCallRunning = true;
		let now = 0;
		const checkpoint = await assembleRolloutCheckpoint({
			sessionManager,
			session,
			commandId: "command-a",
			rolloutId: "rollout-a",
			ownerEpoch: "owner-a",
			expectedDigest: "digest-a",
			pauseProvenance: "rollout",
			drainTimeoutMs: 10,
			drainPollIntervalMs: 5,
			now: () => now,
			sleep: async ms => {
				now += ms;
			},
			inspectDrain: () => ({
				safe: false,
				busyReason: "provider call is still running",
				children: [],
			}),
		});

		expect(providerCallRunning).toBe(true);
		expect(restartCheckpointCalls()).toBe(0);
		expect(checkpoint).toMatchObject({
			outcome: "BusyDeferred",
			autoResumeAllowed: false,
			unresumableReasons: ["provider call is still running"],
		});
		providerCallRunning = false;
		await sessionManager.close();
	});

	it("materializes and flushes a fresh journal before returning a safe checkpoint receipt", async () => {
		const { root, sessionManager, session, restartCheckpointCalls } = await fixture();
		const sessionFile = sessionManager.getSessionFile();
		if (!sessionFile) throw new Error("expected allocated session file");
		await expect(fs.stat(sessionFile)).rejects.toMatchObject({ code: "ENOENT" });
		const checkpoint = await assembleRolloutCheckpoint({
			sessionManager,
			session,
			commandId: "command-b",
			rolloutId: "rollout-b",
			ownerEpoch: "owner-b",
			expectedDigest: "digest-b",
			pauseProvenance: "rollout",
			drainTimeoutMs: 10,
			inspectDrain: () => ({ safe: true, children: [] }),
		});
		const durableEntries = (await fs.readFile(sessionFile, "utf8"))
			.trim()
			.split("\n")
			.map(line => JSON.parse(line));
		expect(durableEntries).toContainEqual(
			expect.objectContaining({
				type: "custom",
				customType: ROLLOUT_CHECKPOINT_CUSTOM_TYPE,
				data: checkpoint,
			}),
		);
		await sessionManager.close();

		const reopened = await SessionManager.open(sessionFile, path.join(root, "sessions"));
		const entry = reopened
			.getEntries()
			.find(candidate => candidate.type === "custom" && candidate.customType === ROLLOUT_CHECKPOINT_CUSTOM_TYPE);
		if (!entry || entry.type !== "custom") throw new Error("expected rollout checkpoint journal entry");
		const decoded = decodeRolloutCheckpoint(entry.data);

		expect(restartCheckpointCalls()).toBe(1);
		expect(decoded).toEqual(checkpoint);
		expect(decoded.journalCheckpoint).toMatchObject({
			sessionId: reopened.getSessionId(),
			sessionFile,
			checkpointId: decoded.checkpointId,
		});
		await reopened.close();
	});

	it("rejects checkpoint assembly when the manager has no durable journal path", async () => {
		const sessionManager = SessionManager.inMemory("/workspace");
		const session = {
			asyncJobManager: undefined,
			checkpointChildJobsForRestart: async () => undefined,
		} as unknown as AgentSession;

		await expect(
			assembleRolloutCheckpoint({
				sessionManager,
				session,
				commandId: "command-memory",
				rolloutId: "rollout-memory",
				ownerEpoch: "owner-memory",
				expectedDigest: "digest-memory",
				pauseProvenance: "rollout",
				drainTimeoutMs: 0,
				inspectDrain: () => ({ safe: false, busyReason: "not durable", children: [] }),
			}),
		).rejects.toThrow("Rollout checkpoint requires a durable session journal");
		await sessionManager.close();
	});
});
