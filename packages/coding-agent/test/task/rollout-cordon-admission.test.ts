import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../../src/config/settings";
import { SessionControlBus } from "../../src/session/session-control";
import { TaskTool } from "../../src/task";
import type { ToolSession } from "../../src/tools";

const cleanupRoots: string[] = [];

afterEach(async () => {
	await Promise.all(cleanupRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("rollout cordon task admission", () => {
	it("returns a typed refusal for a spawn attempted after cordon", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-rollout-cordon-"));
		cleanupRoots.push(root);
		const sessionId = `session-${crypto.randomUUID()}`;
		const ownerEpoch = "owner-a";
		const bus = new SessionControlBus(path.join(root, "control.sqlite"));
		bus.bindTarget(sessionId, ownerEpoch);
		bus.cordon(sessionId, ownerEpoch, "rollout-a", "digest-a", "rollout");
		const session = {
			cwd: root,
			hasUI: false,
			settings: Settings.isolated({ "task.isolation.mode": "none", "task.batch": false }),
			getSessionFile: () => null,
			getSessionId: () => sessionId,
			getSessionSpawns: () => "*",
		} as unknown as ToolSession;
		const tool = await TaskTool.create(session);

		const result = await tool.execute("spawn-after-cordon", {
			agent: "task",
			assignment: "This must not start.",
		});

		expect(result.details?.spawnRefusal).toEqual({
			kind: "SpawnCordoned",
			sessionId,
			ownerEpoch,
			rolloutId: "rollout-a",
			expectedDigest: "digest-a",
			pauseProvenance: "rollout",
			cordonedAt: expect.any(String),
		});
		expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Spawn refused") });
		bus.close();
	});
});
