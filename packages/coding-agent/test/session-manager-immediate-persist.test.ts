import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { MemorySessionStorage } from "@oh-my-pi/pi-coding-agent/session/session-storage";
import { TempDir } from "@oh-my-pi/pi-utils";

const tempDirs: TempDir[] = [];

function makeTempDir(prefix: string): string {
	const dir = TempDir.createSync(prefix);
	tempDirs.push(dir);
	return dir.path();
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(dir => dir.remove()));
});

function assistantMessage(text: string) {
	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("Expected built-in anthropic model to exist");
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp: Date.now(),
	};
}

function readJsonl(file: string): Array<Record<string, unknown>> {
	return fs
		.readFileSync(file, "utf8")
		.trimEnd()
		.split("\n")
		.filter(Boolean)
		.map(line => JSON.parse(line) as Record<string, unknown>);
}

function messageRole(entry: Record<string, unknown>): string | undefined {
	const message = entry.message;
	if (!message || typeof message !== "object") return undefined;
	const role = (message as { role?: unknown }).role;
	return typeof role === "string" ? role : undefined;
}

function messageContent(entry: Record<string, unknown>): unknown {
	const message = entry.message;
	if (!message || typeof message !== "object") return undefined;
	return (message as { content?: unknown }).content;
}

class AtomicOnlyStorage extends MemorySessionStorage {
	syncWrites = 0;
	atomicSyncWrites = 0;

	override writeTextSync(filePath: string, content: string): void {
		this.syncWrites++;
		super.writeTextSync(filePath, content);
	}

	override writeTextAtomicSync(filePath: string, content: string): void {
		this.atomicSyncWrites++;
		super.writeTextSync(filePath, content);
	}
}

describe("SessionManager immediate JSONL persistence", () => {
	it("writes the first assistant turn and later entries before appendMessage returns", () => {
		const cwd = makeTempDir("@pi-immediate-cwd-");
		const sessionDir = path.join(cwd, "sessions");
		const manager = SessionManager.create(cwd, sessionDir);
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("Expected a persisted session file path");

		manager.appendMessage({ role: "user", content: "queued before assistant", timestamp: Date.now() });
		expect(fs.existsSync(sessionFile)).toBe(false);

		manager.appendMessage(assistantMessage("hello"));
		expect(fs.existsSync(sessionFile)).toBe(true);

		let entries = readJsonl(sessionFile);
		expect(entries).toHaveLength(3);
		expect(messageRole(entries[1] ?? {})).toBe("user");
		expect(messageRole(entries[2] ?? {})).toBe("assistant");

		manager.appendMessage({ role: "user", content: "written immediately", timestamp: Date.now() });

		entries = readJsonl(sessionFile);
		expect(entries).toHaveLength(4);
		expect(messageRole(entries[3] ?? {})).toBe("user");
		expect(messageContent(entries[3] ?? {})).toBe("written immediately");
	});
	it("externalizes mixed media before writing JSONL and hydrates bytes on reopen", async () => {
		const cwd = makeTempDir("@pi-media-persist-cwd-");
		const sessionDir = path.join(cwd, "sessions");
		const manager = SessionManager.create(cwd, sessionDir);
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("Expected a persisted session file path");

		manager.appendMessage(assistantMessage("seed"));
		const imageData = Buffer.alloc(1024, 17).toString("base64");
		const videoData = Buffer.from([18, 19, 20, 21]).toString("base64");
		manager.appendMessage({
			role: "user",
			content: [
				{ type: "text", text: "persist these" },
				{ type: "image", mimeType: "image/png", detail: "high", data: imageData },
				{ type: "video", mimeType: "video/mp4", data: videoData },
			],
			timestamp: Date.now(),
		});
		await manager.close();

		const persisted = readJsonl(sessionFile).find(entry => messageRole(entry) === "user");
		const persistedContent = messageContent(persisted ?? {});
		expect(persistedContent).toEqual([
			{ type: "text", text: "persist these" },
			expect.objectContaining({ type: "image", mimeType: "image/png", detail: "high", data: expect.stringMatching(/^blob:sha256:[0-9a-f]{64}$/) }),
			expect.objectContaining({ type: "video", mimeType: "video/mp4", data: expect.stringMatching(/^blob:sha256:[0-9a-f]{64}$/) }),
		]);

		const reopened = await SessionManager.open(sessionFile, sessionDir);
		const hydrated = reopened.getEntries().find(entry => entry.type === "message" && entry.message.role === "user");
		expect(hydrated).toMatchObject({
			message: {
				content: [
					{ type: "text", text: "persist these" },
					{ type: "image", mimeType: "image/png", detail: "high", data: imageData },
					{ type: "video", mimeType: "video/mp4", data: videoData },
				],
			},
		});
		await reopened.close();
	});

	it("uses atomic synchronous rewrite when the first assistant turn materializes the file", async () => {
		const cwd = makeTempDir("@pi-atomic-cwd-");
		const sessionDir = path.join(cwd, "sessions");
		const storage = new AtomicOnlyStorage();
		const manager = SessionManager.create(cwd, sessionDir, storage);
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("Expected a persisted session file path");

		manager.appendMessage({ role: "user", content: "queued before assistant", timestamp: Date.now() });
		manager.appendMessage(assistantMessage("hello"));

		expect(storage.atomicSyncWrites).toBe(1);
		expect(storage.syncWrites).toBe(0);
		const entries = JSON.parse(`[${(await storage.readText(sessionFile)).trimEnd().split("\n").join(",")}]`) as Array<
			Record<string, unknown>
		>;
		expect(entries[0]?.type).toBe("session");
		expect(messageRole(entries[2] ?? {})).toBe("assistant");
	});
});
