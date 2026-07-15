import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SessionControlBus, type SessionControlCommand } from "../../src/session/session-control";
import { type SessionControlTargetActions, startSessionControlTarget } from "../../src/session/session-control-target";
import type { SessionOwnershipHandle } from "../../src/session/session-ownership";

const cleanupRoots: string[] = [];

async function fixture() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-control-target-"));
	cleanupRoots.push(root);
	const bus = new SessionControlBus(path.join(root, "control.sqlite"));
	const ownership = {
		sessionFile: path.join(root, "session.jsonl"),
		sessionId: "session-a",
		ownerEpoch: "owner-a",
		ownerKind: "omp",
		buildRevision: { digest: "old-digest", version: "old-version" },
		runnerInstanceIdentity: { runnerInstanceId: "runner-a", startedAt: new Date(0).toISOString() },
		isCurrent: async () => true,
		isFenced: () => false,
		release: async () => {},
	} satisfies SessionOwnershipHandle;
	return { bus, ownership };
}

function actions(restart: SessionControlTargetActions["restart"]): SessionControlTargetActions {
	return {
		status: () => ({}),
		pause: () => {},
		resume: () => {},
		prepareRollout: (intent, pauseProvenance, command) => ({
			type: "rollout-checkpoint",
			checkpointId: "checkpoint-a",
			rolloutId: intent.rolloutId,
			commandId: command.commandId,
			ownerEpoch: command.targetOwnerEpoch,
			expectedDigest: intent.expectedDigest,
			journalCheckpoint: {
				sessionId: command.sessionId,
				sessionFile: "/tmp/session.jsonl",
				checkpointId: "checkpoint-a",
			},
			children: [],
			unresumableReasons: [],
			autoResumeAllowed: pauseProvenance === "rollout",
			pauseProvenance,
			outcome: "Checkpointed",
			createdAt: new Date(0).toISOString(),
		}),
		restart,
		setModel: () => ({}),
		compact: () => ({}),
		stop: () => {},
	};
}

function requestRestart(bus: SessionControlBus): SessionControlCommand {
	const command: SessionControlCommand = {
		schemaVersion: 1,
		commandId: crypto.randomUUID(),
		source: {
			kind: "local-cli",
			instanceId: crypto.randomUUID(),
			pid: process.pid,
			...(process.getuid ? { uid: process.getuid() } : {}),
		},
		sessionId: "session-a",
		targetOwnerEpoch: "owner-a",
		requestedAt: new Date().toISOString(),
		intent: { kind: "restart", executable: "/releases/omp-target" },
	};
	bus.request(command);
	return command;
}

function requestPrepare(bus: SessionControlBus, ownerEpoch = "owner-a"): SessionControlCommand {
	const command: SessionControlCommand = {
		schemaVersion: 2,
		commandId: crypto.randomUUID(),
		source: {
			kind: "local-cli",
			instanceId: crypto.randomUUID(),
			pid: process.pid,
			...(process.getuid ? { uid: process.getuid() } : {}),
		},
		sessionId: "session-a",
		targetOwnerEpoch: ownerEpoch,
		requestedAt: new Date().toISOString(),
		intent: {
			kind: "prepare-rollout",
			rolloutId: "rollout-a",
			expectedDigest: "old-digest",
			drainTimeoutMs: 25,
		},
	};
	bus.request(command);
	return command;
}

function requestRolloutRestart(
	bus: SessionControlBus,
	executable: string,
	targetDigest: string,
	checkpointCommandId: string,
): SessionControlCommand {
	const command: SessionControlCommand = {
		schemaVersion: 2,
		commandId: crypto.randomUUID(),
		source: {
			kind: "local-cli",
			instanceId: crypto.randomUUID(),
			pid: process.pid,
			...(process.getuid ? { uid: process.getuid() } : {}),
		},
		sessionId: "session-a",
		targetOwnerEpoch: "owner-a",
		requestedAt: new Date().toISOString(),
		intent: {
			kind: "restart",
			executable,
			rolloutId: "rollout-a",
			targetDigest,
			checkpointCommandId,
		},
	};
	bus.request(command);
	return command;
}

afterEach(async () => {
	await Promise.all(cleanupRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("session control restart", () => {
	it("passes the explicit target executable to the restart action and commits at the re-exec boundary", async () => {
		const { bus, ownership } = await fixture();
		let executable: string | undefined;
		const target = await startSessionControlTarget({
			bus,
			ownership,
			pollIntervalMs: 1,
			actions: actions((command, commit) => {
				executable = command.intent.kind === "restart" ? command.intent.executable : undefined;
				commit();
			}),
		});
		const command = requestRestart(bus);

		await target.done;

		expect(executable).toBe("/releases/omp-target");
		expect(bus.getReceipt(command.commandId)).toMatchObject({ state: "applied", result: { kind: "restart" } });
		bus.close();
	});

	it("records a failed receipt when restart preparation throws before re-exec", async () => {
		const { bus, ownership } = await fixture();
		const target = await startSessionControlTarget({
			bus,
			ownership,
			pollIntervalMs: 1,
			actions: actions(() => {
				throw new Error("transition preparation failed");
			}),
		});
		const command = requestRestart(bus);

		await expect(target.done).rejects.toThrow("transition preparation failed");

		expect(bus.getReceipt(command.commandId)).toMatchObject({
			state: "failed",
			error: "transition preparation failed",
		});
		bus.close();
	});

	it("accepts a v2 rollout restart only after its applied checkpoint and exact executable hash", async () => {
		const { bus, ownership } = await fixture();
		const bytes = "#!/bin/sh\nexit 0\n";
		const digest = createHash("sha256").update(bytes).digest("hex");
		const executable = path.join(path.dirname(ownership.sessionFile), `omp-${digest}`);
		await fs.writeFile(executable, bytes);
		await fs.chmod(executable, 0o555);
		let restarted = false;
		const targetActions = actions((_command, commit) => {
			restarted = true;
			commit();
		});
		const target = await startSessionControlTarget({
			bus,
			ownership,
			pollIntervalMs: 1,
			actions: {
				...targetActions,
				prepareRollout: (intent, pauseProvenance, command) => ({
					type: "rollout-checkpoint",
					checkpointId: "checkpoint-a",
					rolloutId: intent.rolloutId,
					commandId: command.commandId,
					ownerEpoch: command.targetOwnerEpoch,
					expectedDigest: intent.expectedDigest,
					journalCheckpoint: {
						sessionId: command.sessionId,
						sessionFile: ownership.sessionFile,
						checkpointId: "checkpoint-a",
					},
					children: [],
					unresumableReasons: [],
					autoResumeAllowed: pauseProvenance === "rollout",
					pauseProvenance,
					outcome: "Checkpointed",
					createdAt: new Date(0).toISOString(),
				}),
			},
		});
		const prepare = requestPrepare(bus);
		await bus.waitForTerminal(prepare.commandId, { timeoutMs: 1_000, pollIntervalMs: 1 });
		const restart = requestRolloutRestart(bus, executable, digest, prepare.commandId);
		await target.done;
		expect(restarted).toBe(true);
		expect(bus.getReceipt(restart.commandId)?.state).toBe("applied");
		bus.close();
	});
});

describe("session control prepare rollout", () => {
	it("cordons before checkpointing and preserves manual pause provenance", async () => {
		const { bus, ownership } = await fixture();
		bus.bindTarget(ownership.sessionId, ownership.ownerEpoch);
		bus.setPaused(ownership.sessionId, ownership.ownerEpoch, true);
		let pauseCalls = 0;
		const targetActions = actions(() => {});
		const target = await startSessionControlTarget({
			bus,
			ownership,
			pollIntervalMs: 1,
			actions: { ...targetActions, pause: () => void (pauseCalls += 1) },
		});
		const command = requestPrepare(bus);
		const receipt = await bus.waitForTerminal(command.commandId, { timeoutMs: 1_000, pollIntervalMs: 1 });

		expect(receipt).toMatchObject({
			state: "applied",
			result: {
				kind: "prepare-rollout",
				cordon: { kind: "SpawnCordoned", pauseProvenance: "manual" },
				checkpoint: { pauseProvenance: "manual", autoResumeAllowed: false },
			},
		});
		expect(bus.getPaused(ownership.sessionId)).toBe(true);
		expect(bus.getCordon(ownership.sessionId)?.rolloutId).toBe("rollout-a");
		expect(pauseCalls).toBe(1);
		await target.stop();
		bus.close();
	});

	it("does not let a stale owner checkpoint or cordon", async () => {
		const { bus, ownership } = await fixture();
		let current = true;
		const target = await startSessionControlTarget({
			bus,
			ownership: { ...ownership, isCurrent: async () => current },
			pollIntervalMs: 5,
			actions: actions(() => {}),
		});
		current = false;
		const command = requestPrepare(bus);
		await target.done;

		expect(bus.getReceipt(command.commandId)?.state).toBe("requested");
		expect(bus.getCordon(ownership.sessionId)).toBeUndefined();
		bus.close();
	});
});
