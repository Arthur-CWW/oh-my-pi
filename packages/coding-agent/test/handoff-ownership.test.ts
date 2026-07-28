import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IrcExternalBus } from "../src/irc/bus-external";
import { SessionManager } from "../src/session/session-manager";
import {
	acquireSessionOwnership,
	handoffSessionOwnership,
	inspectSessionOwnership,
} from "../src/session/session-ownership";

const buildRevision = { digest: "1".repeat(64), version: "handoff-ownership-test" };
const runnerInstanceIdentity = {
	runnerInstanceId: "11111111-1111-4111-8111-111111111111",
	startedAt: "2026-07-16T00:00:00.000Z",
};

const tempDirs: string[] = [];
const originalEnvironment = {
	HOME: process.env.HOME,
	OMP_SESSION_CONTROL_DB: process.env.OMP_SESSION_CONTROL_DB,
};

afterEach(async () => {
	if (originalEnvironment.HOME === undefined) delete process.env.HOME;
	else process.env.HOME = originalEnvironment.HOME;
	if (originalEnvironment.OMP_SESSION_CONTROL_DB === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
	else process.env.OMP_SESSION_CONTROL_DB = originalEnvironment.OMP_SESSION_CONTROL_DB;
	await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe("/handoff session ownership", () => {
	test("releases the predecessor and owns the successor exactly once", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "omp-handoff-ownership-"));
		tempDirs.push(tempDir);
		process.env.HOME = path.join(tempDir, "home");
		process.env.OMP_SESSION_CONTROL_DB = path.join(tempDir, "session-control.sqlite");
		const ownershipRoot = path.join(tempDir, "ownership");
		const manager = SessionManager.create(tempDir, path.join(tempDir, "sessions"));
		const ircBus = new IrcExternalBus(path.join(tempDir, "irc.sqlite"));
		await manager.ensureOnDisk();

		const predecessorFile = manager.getSessionFile();
		expect(predecessorFile).toBeDefined();
		const predecessorId = manager.getSessionId();
		const predecessor = await acquireSessionOwnership(predecessorFile as string, predecessorId, {
			root: ownershipRoot,
			buildRevision,
			runnerInstanceIdentity,
		});
		manager.bindSessionOwnership(predecessor);
		ircBus.registerPeer({
			sessionId: predecessorId,
			name: "handoff-owner",
			cwd: tempDir,
			sessionFile: predecessorFile,
			ownerEpoch: predecessor.ownerEpoch,
		});

		try {
			await manager.newSession({ parentSession: predecessorFile });
			const successor = await handoffSessionOwnership(manager, predecessor);
			manager.appendCustomMessageEntry("handoff", "successor context", true, undefined, "agent");
			await manager.ensureOnDisk();

			expect(manager.getSessionOwnership()).toBe(successor);
			expect(await predecessor.isCurrent()).toBe(false);
			expect((await inspectSessionOwnership(predecessorFile as string, predecessorId, { root: ownershipRoot })).status).toBe(
				"none",
			);
			const successorFile = manager.getSessionFile();
			expect(successorFile).toBeDefined();
			ircBus.handoffPeer(predecessorId, {
				sessionId: manager.getSessionId(),
				name: "handoff-owner",
				cwd: tempDir,
				sessionFile: successorFile,
				ownerEpoch: successor.ownerEpoch,
			});
			expect(ircBus.listPeers({ includeStale: true }).map(peer => peer.sessionId)).toEqual([manager.getSessionId()]);
			const successorLookup = await inspectSessionOwnership(successorFile as string, manager.getSessionId(), {
				root: ownershipRoot,
			});
			expect(successorLookup.status).toBe("live");
			if (successorLookup.status === "live") expect(successorLookup.lease.ownerEpoch).toBe(successor.ownerEpoch);

			await manager.close();
			await successor.release();
			expect(
				(await inspectSessionOwnership(successorFile as string, manager.getSessionId(), { root: ownershipRoot })).status,
			).toBe("none");
		} finally {
			ircBus.close();
			await predecessor.release();
		}
	});
});
