import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	CURRENT_SESSION_VERSION,
	type CustomMessageEntry,
	type SessionHeader,
} from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { SessionOwnershipLostError } from "@oh-my-pi/pi-coding-agent/session/durable-input-queue";
import {
	DurableCustomMessageConflictError,
	SessionManager,
} from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { FileSessionStorage, type SessionStorageWriter } from "@oh-my-pi/pi-coding-agent/session/session-storage";
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
	it("transitions read-only without an unhandled rejection when ownership is revoked during a rewrite", async () => {
		using temp = TempDir.createSync("@omp-ownership-rewrite-");
		let releaseClose!: () => void;
		let closeStarted!: () => void;
		const closeGate = new Promise<void>(resolve => {
			releaseClose = resolve;
		});
		const closeObserved = new Promise<void>(resolve => {
			closeStarted = resolve;
		});
		class GatedStorage extends FileSessionStorage {
			override openWriter(file: string, options?: { flags?: "a" | "w"; onError?: (error: Error) => void }): SessionStorageWriter {
				const writer = super.openWriter(file, options);
				return {
					append: line => writer.append(line),
					flush: () => writer.flush(),
					isOpen: () => writer.isOpen(),
					getError: () => writer.getError(),
					close: async () => {
						closeStarted();
						await closeGate;
						await writer.close();
					},
				};
			}
		}
		const manager = SessionManager.create(temp.path(), path.join(temp.path(), "sessions"), new GatedStorage());
		await manager.ensureOnDisk();
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("expected session file");
		let fenced = false;
		manager.bindSessionOwnership({
			sessionFile,
			sessionId: manager.getSessionId(),
			ownerEpoch: "revoked-epoch",
			ownerKind: "omp",
			buildRevision: {} as never,
			runnerInstanceIdentity: {} as never,
			isCurrent: async () => !fenced,
			isFenced: () => fenced,
			release: async () => {},
		});
		manager.appendCustomMessageEntry("probe", "before revoke", true);
		const notices: SessionOwnershipLostError[] = [];
		manager.subscribeOwnershipLost(error => notices.push(error));
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			const rewrite = manager.rewriteEntries();
			await closeObserved;
			fenced = true;
			releaseClose();
			await expect(rewrite).rejects.toBeInstanceOf(SessionOwnershipLostError);
			await Bun.sleep(10);
			expect(unhandled).toEqual([]);
			expect(notices).toHaveLength(1);
			expect(notices[0]?.message).toContain("read-only");
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
	});

});
