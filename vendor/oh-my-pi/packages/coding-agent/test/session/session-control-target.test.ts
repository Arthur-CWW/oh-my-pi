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
});
