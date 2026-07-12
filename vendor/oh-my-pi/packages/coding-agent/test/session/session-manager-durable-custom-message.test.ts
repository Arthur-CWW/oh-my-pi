import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	CURRENT_SESSION_VERSION,
	type CustomMessageEntry,
	type SessionHeader,
} from "@oh-my-pi/pi-coding-agent/session/session-entries";
import {
	DurableCustomMessageConflictError,
	SessionManager,
} from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

const message = {
	customType: "extension-card",
	content: [{ type: "text" as const, text: "one line" }],
	display: true,
	details: { count: 1, nested: [true, null, "ok"] },
	attribution: "user" as const,
};
const delivery = { inputId: "input-1", inputRevision: 3 };

function customEntries(manager: SessionManager): CustomMessageEntry[] {
	return manager.getEntries().filter((entry): entry is CustomMessageEntry => entry.type === "custom_message");
}

describe("SessionManager durable custom messages", () => {
	it("appends one line, replays exactly, conflicts on changed reuse, and keeps ordinary appends ordinary", async () => {
		const manager = SessionManager.inMemory("/durable-custom");
		const first = await manager.appendDurableCustomMessageEntry(message, delivery);
		const replay = await manager.appendDurableCustomMessageEntry(message, delivery);
		expect(replay).toBe(first);
		expect(customEntries(manager)).toEqual([first]);
		expect(first.durableDelivery).toEqual(delivery);

		await expect(
			manager.appendDurableCustomMessageEntry({ ...message, display: false }, delivery),
		).rejects.toBeInstanceOf(DurableCustomMessageConflictError);
		const ordinaryId = manager.appendCustomMessageEntry("legacy-api", "ordinary", false, { unconstrained: undefined });
		const ordinary = customEntries(manager).find(entry => entry.id === ordinaryId);
		expect(ordinary?.durableDelivery).toBeUndefined();
	});

	it("rejects non-JSON details before appending", async () => {
		const manager = SessionManager.inMemory("/durable-custom");
		await expect(
			manager.appendDurableCustomMessageEntry({ ...message, details: { bad: Number.NaN } }, delivery),
		).rejects.toBeInstanceOf(TypeError);
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		await expect(
			manager.appendDurableCustomMessageEntry({ ...message, details: cyclic as never }, delivery),
		).rejects.toBeInstanceOf(TypeError);
		expect(manager.getEntries()).toHaveLength(0);
	});

	it("is durable before listeners and return, then replays after reopen", async () => {
		using temp = TempDir.createSync("@omp-durable-custom-");
		const sessionDir = path.join(temp.path(), "sessions");
		fs.mkdirSync(sessionDir, { recursive: true });
		const manager = SessionManager.create(temp.path(), sessionDir);
		await manager.ensureOnDisk();
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("expected session file");
		let listenerSawPersisted = false;
		manager.subscribeEntries(entry => {
			if (entry.type !== "custom_message") return;
			listenerSawPersisted = fs.readFileSync(sessionFile, "utf8").includes(`\"id\":\"${entry.id}\"`);
		});
		const first = await manager.appendDurableCustomMessageEntry(message, delivery);
		expect(listenerSawPersisted).toBe(true);
		expect(fs.readFileSync(sessionFile, "utf8")).toContain(`\"id\":\"${first.id}\"`);
		await manager.close();

		const reopened = await SessionManager.open(sessionFile, sessionDir);
		const replay = await reopened.appendDurableCustomMessageEntry(message, delivery);
		expect(replay.id).toBe(first.id);
		expect(customEntries(reopened)).toHaveLength(1);
		await expect(
			reopened.appendDurableCustomMessageEntry(message, { ...delivery, inputRevision: 4 }),
		).rejects.toBeInstanceOf(DurableCustomMessageConflictError);
		await reopened.close();
	});

	it("opens legacy custom entries without a delivery identity", async () => {
		using temp = TempDir.createSync("@omp-legacy-custom-");
		const sessionFile = path.join(temp.path(), "legacy.jsonl");
		const timestamp = new Date().toISOString();
		const header: SessionHeader = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: "legacy-session",
			timestamp,
			cwd: temp.path(),
		};
		const legacy: CustomMessageEntry = {
			type: "custom_message",
			id: "legacy-entry",
			parentId: null,
			timestamp,
			customType: "legacy",
			content: "still readable",
			display: false,
		};
		fs.writeFileSync(sessionFile, `${JSON.stringify(header)}\n${JSON.stringify(legacy)}\n`);
		const manager = await SessionManager.open(sessionFile);
		expect(customEntries(manager)[0]?.durableDelivery).toBeUndefined();
		expect(customEntries(manager)[0]?.content).toBe("still readable");
		await manager.close();
	});
});
