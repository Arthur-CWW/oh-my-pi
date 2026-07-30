import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { getPreservedOpenAiRemoteCompactionData } from "@oh-my-pi/pi-agent-core/compaction/openai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { loadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import { ExtensionRunner } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import {
	decodeOpenAiRemoteCompactionAttemptRecord,
	OPENAI_REMOTE_COMPACTION_ATTEMPT_CUSTOM_TYPE,
} from "@oh-my-pi/pi-coding-agent/session/compaction-receipt";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { getProjectAgentDir, TempDir, withTimeout } from "@oh-my-pi/pi-utils";
import { asGlobalFetch } from "./helpers/fetch-mock";

const runtimeSignalStoreKey = "__ompRuntimeSignals";

type RuntimeSignalGlobal = typeof globalThis & { [runtimeSignalStoreKey]?: string[] };

function getRuntimeSignals(): string[] {
	const globalWithSignals = globalThis as RuntimeSignalGlobal;
	if (!globalWithSignals[runtimeSignalStoreKey]) {
		globalWithSignals[runtimeSignalStoreKey] = [];
	}
	return globalWithSignals[runtimeSignalStoreKey];
}

/**
 * Regression test: auto-compaction completion should resume the agent loop when
 * there are queued agent-level messages (follow-up/steering/custom).
 */
describe("AgentSession auto-compaction queue resume", () => {
	let tempDir: TempDir;
	let session: AgentSession;
	let sessionManager: SessionManager;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;

	beforeEach(async () => {
		tempDir = TempDir.createSync("@pi-auto-compaction-queue-");

		// Provide an extension that short-circuits compaction so the test doesn't
		// make any LLM calls.
		const extensionsDir = path.join(getProjectAgentDir(tempDir.path()), "extensions");
		fs.mkdirSync(extensionsDir, { recursive: true });
		const extensionPath = path.join(extensionsDir, "compaction-short-circuit.ts");
		fs.writeFileSync(
			extensionPath,
			[
				"export default function(pi) {",
				'\tpi.on("session_before_compact", async (event) => {',
				"\t\treturn {",
				"\t\t\tcompaction: {",
				'\t\t\t\tsummary: "compacted",',
				"\t\t\t\tshortSummary: undefined,",
				"\t\t\t\tfirstKeptEntryId: event.preparation.firstKeptEntryId,",
				"\t\t\t\ttokensBefore: event.preparation.tokensBefore,",
				"\t\t\t\tdetails: {},",
				"\t\t\t},",
				"\t\t};",
				"\t});",
				'\tpi.on("auto_compaction_start", async (event) => {',
				`\t\tconst signals = globalThis.${runtimeSignalStoreKey} ?? (globalThis.${runtimeSignalStoreKey} = []);`,
				'\t\tsignals.push("compaction:start:" + event.reason);',
				"\t});",
				'\tpi.on("auto_compaction_end", async (event) => {',
				`\t\tconst signals = globalThis.${runtimeSignalStoreKey} ?? (globalThis.${runtimeSignalStoreKey} = []);`,
				'\t\tsignals.push("compaction:end:" + (event.aborted ? "aborted" : "ok"));',
				"\t});",
				'\tpi.on("todo_reminder", async (event) => {',
				`\t\tconst signals = globalThis.${runtimeSignalStoreKey} ?? (globalThis.${runtimeSignalStoreKey} = []);`,
				'\t\tsignals.push("todo:" + event.attempt + "/" + event.maxAttempts);',
				"\t});",
				"}",
			].join("\n"),
		);

		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		modelRegistry = new ModelRegistry(authStorage);
		sessionManager = SessionManager.create(tempDir.path(), tempDir.path());
		getRuntimeSignals().length = 0;

		const extensionsResult = await loadExtensions([extensionPath], tempDir.path());
		const extensionRunner = new ExtensionRunner(
			extensionsResult.extensions,
			extensionsResult.runtime,
			tempDir.path(),
			sessionManager,
			modelRegistry,
		);

		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) {
			throw new Error("Expected built-in anthropic model to exist");
		}

		const agent = new Agent({
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
			},
		});

		// Seed a minimal session branch so prepareCompaction() returns a preparation.
		sessionManager.appendMessage({
			role: "user",
			content: "hello",
			timestamp: Date.now(),
		});

		session = new AgentSession({
			agent,
			sessionManager,
			settings: Settings.isolated({
				"compaction.autoContinue": false,
				"todo.reminders": true,
				"todo.reminders.max": 3,
			}),
			modelRegistry,
			extensionRunner,
		});
	});

	afterEach(async () => {
		await session.dispose();
		authStorage.close();
		tempDir.removeSync();
		getRuntimeSignals().length = 0;
		vi.restoreAllMocks();
	});

	it("resumes after threshold compaction when only agent-level queued messages exist", async () => {
		session.agent.followUp({
			role: "custom",
			customType: "test",
			content: [{ type: "text", text: "Queued custom" }],
			display: false,
			timestamp: Date.now(),
		});

		expect(session.agent.hasQueuedMessages()).toBe(true);

		const continueSpy = vi.spyOn(session.agent, "continue").mockImplementation(async () => {
			// Real continue() polls and consumes the queued steering/follow-up
			// messages. Mirror that here so the stranded-queue drain settles after
			// one resume instead of rescheduling itself forever (a no-op mock
			// leaves the queue populated, spinning the drain into an OOM loop).
			session.agent.clearAllQueues();
		});

		// Wait for auto_compaction_end event to know when the async handler is done
		const { promise: compactionDone, resolve: onCompactionDone } = Promise.withResolvers<void>();
		session.subscribe(event => {
			if (event.type === "auto_compaction_end") onCompactionDone();
		});

		// Build a fake AssistantMessage above the model's compaction threshold.
		const assistantMsg = {
			role: "assistant" as const,
			// Non-empty content: an empty `stop` turn would trip the empty-stop guard
			// (#handleEmptyAssistantStop) and short-circuit the agent_end handler before
			// compaction/todo checks run — hanging this test forever.
			content: [{ type: "text" as const, text: "Done." }],
			api: "anthropic-messages" as const,
			provider: "anthropic" as const,
			model: "claude-sonnet-4-5",
			stopReason: "stop" as const,
			usage: {
				input: 900000,
				output: 1000,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 901000,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: Date.now(),
		};

		// Drive auto-compaction through the event flow:
		// message_end → stores #lastAssistantMessage
		// agent_end   → #checkCompaction → shouldCompact → #runAutoCompaction
		session.agent.emitExternalEvent({ type: "message_end", message: assistantMsg });
		session.agent.emitExternalEvent({ type: "agent_end", messages: [assistantMsg] });

		// Wait for compaction and the queued continuation under real time.
		await withTimeout(compactionDone, 1_000, "Threshold compaction timed out");
		await withTimeout(session.waitForIdle(), 1_000, "Queued continuation timed out");

		expect(continueSpy).toHaveBeenCalledTimes(1);
		const runtimeSignals = getRuntimeSignals();
		expect(runtimeSignals).toContain("compaction:start:threshold");
		expect(runtimeSignals.some(signal => signal.startsWith("compaction:end:"))).toBe(true);
	});

	it("commits a completed remote compaction when cancellation arrives after the response", async () => {
		await session.dispose();
		sessionManager = SessionManager.create(tempDir.path(), tempDir.path());
		sessionManager.appendMessage({
			role: "user",
			content: "remote compaction source",
			timestamp: Date.now(),
		});
		authStorage.setRuntimeApiKey("openai", "test-key");

		const model = getBundledModel("openai", "gpt-5.1");
		if (!model) throw new Error("Expected built-in openai/gpt-5.1 model to exist");

		const agent = new Agent({
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
			},
		});
		session = new AgentSession({
			agent,
			sessionManager,
			settings: Settings.isolated({
				"compaction.autoContinue": true,
				"compaction.keepRecentTokens": 1,
				"compaction.remoteEnabled": true,
				"compaction.strategy": "context-full",
				"compaction.thresholdTokens": 8_000,
				"contextPromotion.enabled": false,
			}),
			modelRegistry,
		});

		const remoteOutput = [
			{
				type: "message",
				id: "msg_replacement_history",
				role: "user",
				content: [{ type: "input_text", text: "Compacted durable history" }],
			},
			{
				type: "compaction",
				id: "cmp_completed_remote",
				encrypted_content: "encrypted_completed_remote",
			},
		];
		const requestedUrls: string[] = [];
		let compactResponseRead = false;
		const summaryEvents = [
			{
				type: "response.output_item.added",
				output_index: 0,
				item: { type: "message", id: "msg_summary", role: "assistant", status: "in_progress", content: [] },
			},
			{
				type: "response.content_part.added",
				output_index: 0,
				item_id: "msg_summary",
				part: { type: "output_text", text: "", annotations: [] },
			},
			{
				type: "response.output_text.delta",
				output_index: 0,
				item_id: "msg_summary",
				content_index: 0,
				delta: "Durable summary",
			},
			{
				type: "response.output_text.done",
				output_index: 0,
				item_id: "msg_summary",
				content_index: 0,
				text: "Durable summary",
			},
			{
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "message",
					id: "msg_summary",
					role: "assistant",
					status: "completed",
					content: [{ type: "output_text", text: "Durable summary", annotations: [] }],
				},
			},
			{
				type: "response.completed",
				response: {
					id: "resp_summary",
					status: "completed",
					usage: {
						input_tokens: 10,
						output_tokens: 2,
						total_tokens: 12,
						input_tokens_details: { cached_tokens: 0 },
					},
				},
			},
		];
		const summarySse = `${summaryEvents.map(event => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\n`;
		vi.spyOn(globalThis, "fetch").mockImplementation(
			asGlobalFetch(input => {
				const url = String(input);
				requestedUrls.push(url);
				if (!url.endsWith("/responses/compact")) {
					return new Response(summarySse, {
						status: 200,
						headers: { "content-type": "text/event-stream" },
					});
				}

				const response = new Response(
					JSON.stringify({
						id: "resp_completed_remote",
						output: remoteOutput,
					}),
					{
						status: 200,
						headers: {
							"content-type": "application/json",
							"x-request-id": "req_completed_remote",
						},
					},
				);
				const readJson = response.json.bind(response);
				Object.defineProperty(response, "json", {
					configurable: true,
					value: async () => {
						const body = await readJson();
						compactResponseRead = true;
						session.abortCompaction();
						return body;
					},
				});
				return response;
			}),
		);

		const continueSpy = vi.spyOn(session.agent, "continue");
		const { promise: compactionDone, resolve: onCompactionDone } = Promise.withResolvers<{
			aborted: boolean;
			willRetry: boolean;
		}>();
		session.subscribe(event => {
			if (event.type === "auto_compaction_end") onCompactionDone(event);
		});

		const assistantMsg = {
			role: "assistant" as const,
			content: [{ type: "text" as const, text: "Remote compaction trigger" }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			stopReason: "stop" as const,
			usage: {
				input: 9_000,
				output: 1_000,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 10_000,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: Date.now(),
		};
		session.agent.emitExternalEvent({ type: "message_end", message: assistantMsg });
		session.agent.emitExternalEvent({ type: "agent_end", messages: [assistantMsg] });

		const endEvent = await withTimeout(compactionDone, 1_000, "Remote compaction timed out");
		await session.waitForIdle();
		await Promise.resolve();

		expect(compactResponseRead).toBe(true);
		expect(endEvent).toEqual(expect.objectContaining({ aborted: true, willRetry: false }));
		expect(requestedUrls.filter(url => url.endsWith("/responses/compact"))).toHaveLength(1);
		expect(continueSpy).not.toHaveBeenCalled();

		await sessionManager.flush();
		const sessionFile = sessionManager.getSessionFile();
		if (!sessionFile) throw new Error("Expected a durable session file");
		const reopened = await SessionManager.open(sessionFile, tempDir.path());
		try {
			const entries = reopened.getEntries();
			const attempts = entries.flatMap(entry => {
				if (entry.type !== "custom" || entry.customType !== OPENAI_REMOTE_COMPACTION_ATTEMPT_CUSTOM_TYPE) {
					return [];
				}
				const record = decodeOpenAiRemoteCompactionAttemptRecord(entry.data);
				return record ? [record] : [];
			});
			expect(attempts).toHaveLength(1);
			const started = attempts[0];
			if (started?.status !== "started") throw new Error("Expected a durable started attempt");

			const compaction = entries.findLast(entry => entry.type === "compaction");
			if (compaction?.type !== "compaction") {
				throw new Error("Expected a durable completed compaction");
			}
			const remote = getPreservedOpenAiRemoteCompactionData(compaction.preserveData);
			expect(remote?.replacementHistory).toEqual(remoteOutput);
			expect(remote?.auditMetadata).toEqual({
				responseId: "resp_completed_remote",
				compactionItemId: "cmp_completed_remote",
				clientRequestId: "req_completed_remote",
			});
			expect(remote?.attempt).toEqual(
				expect.objectContaining({
					attemptId: started.attemptId,
					sourceDigest: started.source.digest,
					sourceLeafId: started.source.sourceLeafId,
					firstKeptEntryId: started.source.firstKeptEntryId,
					status: "completed",
					retryMode: "recompute_from_local_source",
				}),
			);
		} finally {
			await reopened.close();
		}
	});

	it("forwards todo reminder lifecycle signals to extensions", async () => {
		const continueSpy = vi.spyOn(session.agent, "continue").mockResolvedValue();

		session.setTodoPhases([
			{
				name: "Execution",
				tasks: [{ content: "Finish pending task", status: "in_progress" }],
			},
		]);

		const { promise: reminderDone, resolve: onReminderDone } = Promise.withResolvers<void>();
		session.subscribe(event => {
			if (event.type === "todo_reminder") onReminderDone();
		});

		const assistantMsg = {
			role: "assistant" as const,
			// Non-empty content: see comment on the first test's assistantMsg.
			content: [{ type: "text" as const, text: "Done." }],
			api: "anthropic-messages" as const,
			provider: "anthropic" as const,
			model: "claude-sonnet-4-5",
			stopReason: "stop" as const,
			usage: {
				input: 100,
				output: 20,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 120,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: Date.now(),
		};

		session.agent.emitExternalEvent({ type: "message_end", message: assistantMsg });
		session.agent.emitExternalEvent({ type: "agent_end", messages: [assistantMsg] });

		await withTimeout(reminderDone, 1000, "Todo reminder timed out");
		await Promise.resolve();

		expect(getRuntimeSignals()).toContain("todo:1/3");
		expect(continueSpy).toHaveBeenCalledTimes(1);
		await session.waitForIdle();
	});
});
