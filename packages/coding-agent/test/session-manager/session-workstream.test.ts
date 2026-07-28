import { describe, expect, test } from "bun:test";
import {
	type SessionWorkstream,
	workstreamCharterPath,
} from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { listSessions } from "@oh-my-pi/pi-coding-agent/session/session-listing";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { MemorySessionStorage } from "@oh-my-pi/pi-coding-agent/session/session-storage";

const STREAM: SessionWorkstream = {
	kind: "workstream",
	id: "session-metadata",
};

function parseLines(raw: string): Array<Record<string, unknown>> {
	return raw
		.split("\n")
		.filter(Boolean)
		.map(line => JSON.parse(line) as Record<string, unknown>);
}

describe("session workstream metadata", () => {
	test("roundtrips through an atomic header rewrite without changing entries or leaf", async () => {
		const storage = new MemorySessionStorage();
		const manager = SessionManager.create("/project", "/sessions", storage);
		const firstId = manager.appendMessage({ role: "user", content: "Keep this entry", timestamp: Date.now() });
		const leafId = manager.appendModeChange("goal", { active: true });
		await manager.ensureOnDisk();
		const sessionFile = manager.getSessionFile();
		expect(sessionFile).toBeDefined();

		let notifications = 0;
		manager.onWorkstreamChanged(() => notifications++);
		expect(await manager.setWorkstream(STREAM)).toBe(true);
		expect(manager.getLeafId()).toBe(leafId);
		expect(manager.getEntries().map(entry => entry.id)).toEqual([firstId, leafId]);
		expect(notifications).toBe(1);

		const persisted = parseLines(await storage.readText(sessionFile!));
		expect(persisted).toHaveLength(3);
		expect(persisted[0]?.workstream).toEqual(STREAM);

		const reloaded = await SessionManager.open(sessionFile!, "/sessions", storage);
		expect(reloaded.getWorkstream()).toEqual(STREAM);
		expect(workstreamCharterPath(STREAM.id)).toBe("streams/session-metadata/GOAL.md");
		expect(reloaded.getLeafId()).toBe(leafId);
		expect(reloaded.getEntries().map(entry => entry.id)).toEqual([firstId, leafId]);
		expect(await reloaded.setWorkstream(undefined, "goal")).toBe(false);
		expect(await reloaded.setWorkstream(undefined, "explicit")).toBe(true);
		expect(reloaded.getWorkstream()).toBeUndefined();
		expect(reloaded.getLeafId()).toBe(leafId);
		expect(parseLines(await storage.readText(sessionFile!))[0]?.workstream).toBeUndefined();

		const unclassifiedReload = await SessionManager.open(sessionFile!, "/sessions", storage);
		expect(unclassifiedReload.getWorkstream()).toBeUndefined();
		expect(unclassifiedReload.getEntries().map(entry => entry.id)).toEqual([firstId, leafId]);
	});

	test("protects explicit metadata from goal inference and distinguishes adhoc from unclassified", async () => {
		const storage = new MemorySessionStorage();
		const manager = SessionManager.create("/project", "/sessions", storage);
		expect(manager.getWorkstream()).toBeUndefined();
		expect(await manager.setWorkstream(STREAM)).toBe(true);
		expect(await manager.setWorkstream({ kind: "workstream", id: "other-stream" }, "goal")).toBe(false);
		expect(manager.getWorkstream()).toEqual(STREAM);
		expect(await manager.setWorkstream({ kind: "workstream", id: "other-stream" }, "explicit")).toBe(true);
		expect(manager.getWorkstream()).toEqual({ kind: "workstream", id: "other-stream" });
		expect(await manager.setWorkstream(undefined, "goal")).toBe(false);

		const adhoc: SessionWorkstream = { kind: "adhoc" };
		const separate = SessionManager.create("/other", "/sessions", storage);
		expect(await separate.setWorkstream(adhoc)).toBe(true);
		expect(separate.getWorkstream()).toEqual(adhoc);
	});

	test("ignores malformed persisted metadata while preserving resume history", async () => {
		const storage = new MemorySessionStorage();
		const file = "/sessions/malformed.jsonl";
		const header = {
			type: "session",
			version: 3,
			id: "legacy-session",
			timestamp: "2026-07-11T00:00:00.000Z",
			cwd: "/project",
			workstream: {
				kind: "workstream",
				id: "wrong-path",
				charterPath: "streams/somewhere-else/GOAL.md",
			},
		};
		const entry = {
			type: "message",
			id: "entry-1",
			parentId: null,
			timestamp: "2026-07-11T00:00:01.000Z",
			message: { role: "user", content: "still resumable" },
		};
		storage.writeTextSync(file, `${JSON.stringify(header)}\n${JSON.stringify(entry)}\n`);

		const manager = await SessionManager.open(file, "/sessions", storage);
		expect(manager.getWorkstream()).toBeUndefined();
		expect(manager.getEntries()).toHaveLength(1);
		expect(manager.getLeafId()).toBe("entry-1");
	});

	test("projects valid metadata into listings and leaves malformed or legacy headers unclassified", async () => {
		const storage = new MemorySessionStorage();
		const headers = [
			{
				type: "session",
				id: "valid",
				timestamp: "2026-07-11T00:00:03.000Z",
				cwd: "/project",
				workstream: STREAM,
			},
			{
				type: "session",
				id: "malformed",
				timestamp: "2026-07-11T00:00:02.000Z",
				cwd: "/project",
				workstream: { kind: "adhoc", source: "explicit" },
			},
			{ type: "session", id: "legacy", timestamp: "2026-07-11T00:00:01.000Z", cwd: "/project" },
		];
		for (const header of headers) storage.writeTextSync(`/sessions/${header.id}.jsonl`, `${JSON.stringify(header)}\n`);

		const sessions = await listSessions("/sessions", storage);
		expect(sessions.find(session => session.id === "valid")?.workstream).toEqual(STREAM);
		expect(sessions.find(session => session.id === "malformed")?.workstream).toBeUndefined();
		expect(sessions.find(session => session.id === "legacy")?.workstream).toBeUndefined();
	});
});
