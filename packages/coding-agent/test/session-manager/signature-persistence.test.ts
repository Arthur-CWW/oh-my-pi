import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AssistantMessage, Model } from "@oh-my-pi/pi-ai";
import { streamOpenAICodexResponses } from "@oh-my-pi/pi-ai/providers/openai-codex-responses";
import { createOpenAIResponsesHistoryPayload } from "@oh-my-pi/pi-ai/utils";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { convertToLlm } from "@oh-my-pi/pi-coding-agent/session/messages";
import type { SessionMessageEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { getBlobsDir, TempDir } from "@oh-my-pi/pi-utils";

function isAssistantSessionEntry(entry: unknown): entry is SessionMessageEntry & { message: AssistantMessage } {
	return (
		typeof entry === "object" &&
		entry !== null &&
		"type" in entry &&
		entry.type === "message" &&
		"message" in entry &&
		typeof entry.message === "object" &&
		entry.message !== null &&
		"role" in entry.message &&
		entry.message.role === "assistant"
	);
}

function getAssistantMessage(session: SessionManager): AssistantMessage {
	const assistantEntry = session.getEntries().find(isAssistantSessionEntry);
	if (!assistantEntry) throw new Error("Expected assistant message");
	return assistantEntry.message;
}

describe("SessionManager signature persistence", () => {
	it("clears oversized signatures instead of truncating them", async () => {
		using tempDir = TempDir.createSync("@pi-session-signature-persistence-");
		const session = SessionManager.create(tempDir.path(), tempDir.path());

		session.appendMessage({ role: "user", content: "continue", timestamp: 1 });
		session.appendMessage({
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "reasoning", thinkingSignature: "s".repeat(600_000) },
				{ type: "text", text: "done", textSignature: "m".repeat(600_000) },
				{ type: "toolCall", id: "tool_1", name: "read", arguments: {}, thoughtSignature: "t".repeat(600_000) },
			],
			api: "openai-responses",
			provider: "openai",
			model: "gpt-5-mini",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 2,
		} satisfies AssistantMessage);
		await session.flush();

		const reloaded = await SessionManager.open(session.getSessionFile()!);
		const assistant = getAssistantMessage(reloaded);

		expect(assistant.content[0]).toMatchObject({ type: "thinking", thinking: "reasoning", thinkingSignature: "" });
		expect(assistant.content[1]).toMatchObject({ type: "text", text: "done", textSignature: "" });
		expect(assistant.content[2]).toMatchObject({ type: "toolCall", id: "tool_1", thoughtSignature: "" });
	});

	it("externalizes provider image data URLs and restores preserved history payloads across reload", async () => {
		using tempDir = TempDir.createSync("@pi-session-provider-image-persistence-");
		const session = SessionManager.create(tempDir.path(), tempDir.path());
		const largeImageUrl = `data:image/png;base64,${"a".repeat(600_000)}`;

		session.appendMessage({
			role: "user",
			content: "look at this",
			providerPayload: {
				type: "openaiResponsesHistory",
				api: "openai-codex-responses",
				provider: "openai-codex",
				model: "gpt-5.4",
				items: [
					{
						type: "message",
						role: "user",
						content: [
							{ type: "input_text", text: "look at this" },
							{ type: "input_image", detail: "auto", image_url: largeImageUrl },
						],
					},
				],
			},
			timestamp: 1,
		});
		session.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "done" }],
			api: "openai-codex-responses",
			provider: "openai-codex",
			model: "gpt-5.4",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 2,
		});
		await session.flush();

		const expectedBlobHash = new Bun.SHA256().update(Buffer.from(largeImageUrl, "utf8")).digest("hex");
		const persistedBlob = await fs.readFile(path.join(getBlobsDir(), expectedBlobHash), "utf8");
		expect(persistedBlob).toBe(largeImageUrl);

		const reloaded = await SessionManager.open(session.getSessionFile()!);
		const reloadedUserEntry = reloaded
			.getEntries()
			.find(entry => entry.type === "message" && entry.message.role === "user");
		if (reloadedUserEntry?.type !== "message" || reloadedUserEntry.message.role !== "user") {
			throw new Error("Expected user message");
		}

		expect(reloadedUserEntry.message.providerPayload).toEqual({
			type: "openaiResponsesHistory",
			api: "openai-codex-responses",
			provider: "openai-codex",
			model: "gpt-5.4",
			items: [
				{
					type: "message",
					role: "user",
					content: [
						{ type: "input_text", text: "look at this" },
						{ type: "input_image", detail: "auto", image_url: largeImageUrl },
					],
				},
			],
		});
	});

	it("strips generic Responses cold replay metadata without rewriting the session file", async () => {
		using tempDir = TempDir.createSync("@pi-session-rehydrate-persistence-");
		const session = SessionManager.create(tempDir.path(), tempDir.path());
		const providerPayload = {
			type: "openaiResponsesHistory" as const,
			api: "openai-responses",
			provider: "openai",
			model: "gpt-5-mini",
			items: [
				{ type: "reasoning", encrypted_content: "enc_stale" },
				{
					type: "message",
					role: "assistant",
					status: "completed",
					id: "msg_stale_snapshot",
					content: [{ type: "output_text", text: "done" }],
				},
			],
		};

		session.appendMessage({ role: "user", content: "continue", timestamp: 1 });
		session.appendMessage({
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "reasoning", thinkingSignature: JSON.stringify(providerPayload.items[0]) },
				{ type: "text", text: "done" },
			],
			api: "openai-responses",
			provider: "openai",
			model: "gpt-5-mini",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			providerPayload,
			timestamp: 2,
		} satisfies AssistantMessage);
		await session.flush();

		const sessionFile = session.getSessionFile();
		if (!sessionFile) throw new Error("Expected persisted session file");
		const persistedBefore = await fs.readFile(sessionFile, "utf8");
		const initialMtimeMs = (await fs.stat(sessionFile)).mtimeMs;
		await session.close();

		const reloaded = await SessionManager.open(sessionFile);
		const assistant = getAssistantMessage(reloaded);

		// After rehydration, assistant providerPayload must be stripped to prevent
		// stale native history replay on warmed sessions.
		expect(assistant.providerPayload).toBeUndefined();
		expect(assistant.content[0]).toMatchObject({
			type: "thinking",
			thinking: "reasoning",
			thinkingSignature: undefined,
		});
		expect(await fs.readFile(sessionFile, "utf8")).toBe(persistedBefore);
		expect((await fs.stat(sessionFile)).mtimeMs).toBe(initialMtimeMs);
		await reloaded.close();
	}, 15_000);

	it("migrates an exact legacy Codex payload from immutable assistant provenance", async () => {
		using tempDir = TempDir.createSync("@pi-session-codex-legacy-replay-");
		const session = SessionManager.create(tempDir.path(), tempDir.path());
		const nativeReasoning = {
			type: "reasoning",
			id: "rs_legacy",
			encrypted_content: "enc_legacy_same_model",
		};
		const legacyProviderPayload = createOpenAIResponsesHistoryPayload(
			"openai-codex-responses",
			"openai-codex",
			"gpt-5.4",
			[nativeReasoning],
			false,
		);
		Reflect.deleteProperty(legacyProviderPayload, "api");
		Reflect.deleteProperty(legacyProviderPayload, "model");
		const thinkingSignature = JSON.stringify(nativeReasoning);

		session.appendMessage({
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "legacy reasoning", thinkingSignature },
				{ type: "text", text: "legacy done" },
			],
			api: "openai-codex-responses",
			provider: "openai-codex",
			model: "gpt-5.4",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			// Deliberate pre-provenance fixture: only api/model are absent.
			providerPayload: legacyProviderPayload,
			timestamp: 1,
		} satisfies AssistantMessage);
		await session.flush();
		const sessionFile = session.getSessionFile();
		if (!sessionFile) throw new Error("Expected persisted session file");
		await session.close();

		const reloaded = await SessionManager.open(sessionFile);
		const assistant = getAssistantMessage(reloaded);
		expect(assistant.providerPayload).toEqual({
			type: "openaiResponsesHistory",
			api: "openai-codex-responses",
			provider: "openai-codex",
			model: "gpt-5.4",
			items: [nativeReasoning],
		});
		expect(assistant.content[0]).toEqual({
			type: "thinking",
			thinking: "legacy reasoning",
			thinkingSignature,
		});
		const model = getBundledModel("openai-codex", "gpt-5.4") as Model<"openai-codex-responses">;
		const abortController = new AbortController();
		abortController.abort();
		const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
		const tokenPayload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
		).toString("base64url");
		const { promise: payloadCaptured, resolve: capturePayload } = Promise.withResolvers<unknown>();
		streamOpenAICodexResponses(
			model,
			{ messages: convertToLlm(reloaded.buildSessionContext().messages) },
			{
				apiKey: `${header}.${tokenPayload}.signature`,
				signal: abortController.signal,
				onPayload: capturePayload,
			},
		);
		const wirePayload = (await payloadCaptured) as { input?: Array<Record<string, unknown>> };
		expect(wirePayload.input).toContainEqual({
			type: "reasoning",
			encrypted_content: nativeReasoning.encrypted_content,
		});
		await reloaded.close();
	});

	it("fails closed when a Codex payload has explicit mismatched api and model provenance", async () => {
		using tempDir = TempDir.createSync("@pi-session-codex-mismatched-replay-");
		const session = SessionManager.create(tempDir.path(), tempDir.path());
		const nativeReasoning = {
			type: "reasoning",
			id: "rs_mismatched",
			encrypted_content: "enc_mismatched_route",
		};

		session.appendMessage({
			role: "assistant",
			content: [
				{
					type: "thinking",
					thinking: "foreign reasoning",
					thinkingSignature: JSON.stringify(nativeReasoning),
				},
				{ type: "text", text: "foreign done" },
			],
			api: "openai-codex-responses",
			provider: "openai-codex",
			model: "gpt-5.4",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			providerPayload: {
				type: "openaiResponsesHistory",
				api: "openai-responses",
				provider: "openai-codex",
				model: "gpt-5-mini",
				items: [nativeReasoning],
			},
			timestamp: 1,
		} satisfies AssistantMessage);
		await session.flush();
		const sessionFile = session.getSessionFile();
		if (!sessionFile) throw new Error("Expected persisted session file");
		await session.close();

		const reloaded = await SessionManager.open(sessionFile);
		const assistant = getAssistantMessage(reloaded);
		expect(assistant.providerPayload).toBeUndefined();
		expect(assistant.content[0]).toEqual({
			type: "thinking",
			thinking: "foreign reasoning",
			thinkingSignature: undefined,
		});
		await reloaded.close();
	});

	it("strips GitHub Copilot Responses cold replay metadata", async () => {
		using tempDir = TempDir.createSync("@pi-session-copilot-replay-");
		const session = SessionManager.create(tempDir.path(), tempDir.path());
		const nativeReasoning = {
			type: "reasoning",
			id: "rs_copilot",
			encrypted_content: "enc_copilot",
		};

		session.appendMessage({
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "copilot reasoning", thinkingSignature: JSON.stringify(nativeReasoning) },
				{ type: "text", text: "copilot done" },
			],
			api: "openai-responses",
			provider: "github-copilot",
			model: "gpt-5-mini",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			providerPayload: {
				type: "openaiResponsesHistory",
				api: "openai-responses",
				provider: "github-copilot",
				model: "gpt-5-mini",
				items: [nativeReasoning],
			},
			timestamp: 1,
		} satisfies AssistantMessage);
		await session.flush();
		const sessionFile = session.getSessionFile();
		if (!sessionFile) throw new Error("Expected persisted session file");
		await session.close();

		const reloaded = await SessionManager.open(sessionFile);
		const assistant = getAssistantMessage(reloaded);
		expect(assistant.providerPayload).toBeUndefined();
		expect(assistant.content[0]).toEqual({
			type: "thinking",
			thinking: "copilot reasoning",
			thinkingSignature: undefined,
		});
		await reloaded.close();
	});

	it("preserves Anthropic thinking signatures byte-for-byte across a cold reopen", async () => {
		using tempDir = TempDir.createSync("@pi-session-anthropic-signature-");
		const session = SessionManager.create(tempDir.path(), tempDir.path());
		const thinkingSignature = Buffer.from([
			0x00, 0x01, 0x02, 0x7f, 0x80, 0xfe, 0xff, 0x10, 0x20, 0x30, 0x40, 0x50,
		]).toString("base64");

		session.appendMessage({
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "anthropic reasoning", thinkingSignature },
				{ type: "text", text: "anthropic done" },
			],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 1,
		} satisfies AssistantMessage);
		await session.flush();
		const sessionFile = session.getSessionFile();
		if (!sessionFile) throw new Error("Expected persisted session file");
		await session.close();

		const reloaded = await SessionManager.open(sessionFile);
		const assistant = getAssistantMessage(reloaded);
		const reloadedThinking = assistant.content[0];
		if (reloadedThinking?.type !== "thinking") throw new Error("Expected Anthropic thinking block");
		expect(Buffer.from(reloadedThinking.thinkingSignature ?? "", "utf8")).toEqual(
			Buffer.from(thinkingSignature, "utf8"),
		);
		await reloaded.close();
	});
});
