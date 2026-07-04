import { afterEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import type { SessionMessageEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { loadEntriesFromFile } from "@oh-my-pi/pi-coding-agent/session/session-loader";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

const tempDirs: TempDir[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(dir => dir.remove()));
});

function makeTempDir(prefix: string): string {
	const dir = TempDir.createSync(prefix);
	tempDirs.push(dir);
	return dir.path();
}

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

describe("session message provenance", () => {
	it("round-trips optional assistant attribution fields", async () => {
		const cwd = makeTempDir("@pi-message-attribution-cwd-");
		const manager = SessionManager.create(cwd, path.join(cwd, "sessions"));
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("Expected a persisted session file path");

		manager.appendMessage(assistantMessage("hello"), {
			model: "anthropic/claude-sonnet-4-5:high",
			thinkingLevel: "high",
			advisor: "anthropic/claude-haiku-4-5:medium",
		});
		await manager.close();

		const entries = await loadEntriesFromFile(sessionFile);
		const assistant = entries.find(
			(entry): entry is SessionMessageEntry => entry.type === "message" && entry.message.role === "assistant",
		);
		expect(assistant?.model).toBe("anthropic/claude-sonnet-4-5:high");
		expect(assistant?.thinkingLevel).toBe("high");
		expect(assistant?.advisor).toBe("anthropic/claude-haiku-4-5:medium");
	});

	it("loads old-format message entries without attribution fields", async () => {
		const cwd = makeTempDir("@pi-old-message-attribution-cwd-");
		const sessionFile = path.join(cwd, "old.jsonl");
		const oldMessage = {
			type: "message",
			id: "assistant-1",
			parentId: null,
			timestamp: "2026-01-01T00:00:00.000Z",
			message: assistantMessage("old"),
		};
		await Bun.write(
			sessionFile,
			`${JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-01-01T00:00:00.000Z", cwd })}\n${JSON.stringify(oldMessage)}\n`,
		);

		const entries = await loadEntriesFromFile(sessionFile);
		const assistant = entries[1] as SessionMessageEntry | undefined;
		expect(assistant?.type).toBe("message");
		expect(assistant?.model).toBeUndefined();
		expect(assistant?.thinkingLevel).toBeUndefined();
		expect(assistant?.advisor).toBeUndefined();
	});
});
