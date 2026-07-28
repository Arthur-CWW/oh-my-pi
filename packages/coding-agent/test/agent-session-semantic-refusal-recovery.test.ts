import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Agent, type AgentTool } from "@oh-my-pi/pi-agent-core";
import { type AssistantMessage, type Model, z } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { RefusalStore } from "@oh-my-pi/pi-coding-agent/session/refusal-corpus";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";

const CHILD_MODE = Bun.env.OMP_SEMANTIC_REFUSAL_INTEGRATION_CHILD === "1";
const CHILD_ID = "SemanticRefusalRecoveryChild";
const REFUSAL_DETAIL = "RECORDED_REFUSAL_DETAIL_MUST_NOT_REACH_RECOVERY";
const PROVIDER_ERROR = `Refusal (policy): ${REFUSAL_DETAIL}`;
const recordSchema = z.object({ value: z.string() });
const tempRoots: string[] = [];

function usage(): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function recordedResponse(
	model: Model,
	response: { content: AssistantMessage["content"]; stopReason: "error" | "stop" | "toolUse" } &
		Partial<Pick<AssistantMessage, "stopDetails" | "errorMessage">>,
): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	queueMicrotask(() => {
		const content: AssistantMessage["content"] = [];
		const message: AssistantMessage = {
			role: "assistant",
			content,
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: usage(),
			stopReason: "stop",
			timestamp: Date.now(),
		};
		stream.push({ type: "start", partial: message });
		for (const block of response.content) {
			content.push(block);
			const contentIndex = content.length - 1;
			if (block.type === "text") {
				stream.push({ type: "text_start", contentIndex, partial: message });
				stream.push({ type: "text_delta", contentIndex, delta: block.text, partial: message });
				stream.push({ type: "text_end", contentIndex, content: block.text, partial: message });
			} else if (block.type === "toolCall") {
				stream.push({ type: "toolcall_start", contentIndex, partial: message });
				stream.push({
					type: "toolcall_delta",
					contentIndex,
					delta: typeof block.arguments === "string" ? block.arguments : JSON.stringify(block.arguments),
					partial: message,
				});
				stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: message });
			}
		}
		message.stopReason = response.stopReason;
		message.stopDetails = response.stopDetails;
		message.errorMessage = response.errorMessage;
		if (response.stopReason === "error") {
			stream.push({ type: "error", reason: "error", error: message });
			return;
		}
		stream.push({ type: "done", reason: response.stopReason, message });
		stream.end();
	});
	return stream;
}

async function exerciseSameChildRecovery(): Promise<void> {
	const root = Bun.env.OMP_SEMANTIC_REFUSAL_TEST_ROOT;
	const controlDb = Bun.env.OMP_SESSION_CONTROL_DB;
	const ircDb = Bun.env.OMP_IRC_DB;
	if (!root || !controlDb || !ircDb) throw new Error("Isolated refusal integration paths are required");

	const primary = getBundledModel("anthropic", "claude-fable-5");
	const fallback = getBundledModel("openai-codex", "gpt-5.6-sol");
	if (!primary || !fallback) throw new Error("Expected Fable and Sol models in the bundled catalog");

	const authStorage = await AuthStorage.create(path.join(root, "auth.sqlite"));
	authStorage.setRuntimeApiKey("anthropic", "anthropic-test-key");
	authStorage.setRuntimeApiKey("openai-codex", "codex-test-key");
	const modelRegistry = new ModelRegistry(authStorage, path.join(root, "models.yml"));
	const externalIrcBus = new IrcExternalBus(ircDb);
	externalIrcBus.registerPeer({ sessionId: "majordomo-session", name: "Majordomo", cwd: root });
	AgentRegistry.resetGlobalForTests();

	let toolExecutions = 0;
	const recordTool: AgentTool<typeof recordSchema, { value: string }> = {
		name: "record",
		label: "Record",
		description: "Record one durable side effect",
		parameters: recordSchema,
		async execute(_toolCallId, params) {
			toolExecutions += 1;
			return { content: [{ type: "text", text: `recorded:${params.value}` }], details: params };
		},
	};
	const requestedModels: string[] = [];
	let fableAttempts = 0;
	let fallbackContext = "";
	let session!: AgentSession;
	const agent = new Agent({
		getApiKey: provider => `${provider}-test-key`,
		initialState: {
			model: primary,
			systemPrompt: ["Recorded semantic-refusal integration fixture"],
			tools: [recordTool],
			messages: [],
		},
		transformContext: async messages => {
			await session.checkpointSemanticRefusalAttempt(messages);
			return messages;
		},
		streamFn: (model, context) => {
			requestedModels.push(`${model.provider}/${model.id}`);
			if (model.provider === primary.provider && model.id === primary.id) {
				fableAttempts += 1;
				if (fableAttempts === 1) {
					return recordedResponse(model, {
						content: [{ type: "toolCall", id: "record-once", name: "record", arguments: { value: "alpha" } }],
						stopReason: "toolUse",
					});
				}
				return recordedResponse(model, {
					content: [{ type: "text", text: REFUSAL_DETAIL }],
					stopReason: "error",
					stopDetails: { type: "refusal", category: "policy", explanation: REFUSAL_DETAIL },
					errorMessage: PROVIDER_ERROR,
				});
			}
			if (model.provider === fallback.provider && model.id === fallback.id) {
				fallbackContext = JSON.stringify(context);
				return recordedResponse(model, {
					content: [{ type: "text", text: "Recovered on Sol without replaying the completed tool." }],
					stopReason: "stop",
				});
			}
			throw new Error(`Unexpected recovery model ${model.provider}/${model.id}`);
		},
	});
	const settings = Settings.isolated({
		"compaction.enabled": false,
		"retry.enabled": false,
		"retry.semanticRefusalRecovery.enabled": true,
		"retry.semanticRefusalRecovery.model": `${fallback.provider}/${fallback.id}`,
		"retry.semanticRefusalRecovery.maxPerSession": 1,
		"todo.enabled": false,
		"todo.reminders": false,
	});
	settings.setModelRole("default", `${primary.provider}/${primary.id}`);
	const sessionManager = SessionManager.inMemory(root);
	session = new AgentSession({
		agent,
		sessionManager,
		settings,
		modelRegistry,
		toolRegistry: new Map([[recordTool.name, recordTool]]),
		externalIrcBus,
		agentId: CHILD_ID,
		agentKind: "sub",
	});

	try {
		await session.prompt("Complete the recorded operation once, then report success.");
		await session.waitForIdle();

		expect(requestedModels).toEqual([
			`${primary.provider}/${primary.id}`,
			`${primary.provider}/${primary.id}`,
			`${fallback.provider}/${fallback.id}`,
		]);
		expect(toolExecutions).toBe(1);
		expect(session.model).toMatchObject({ provider: fallback.provider, id: fallback.id });
		expect(fallbackContext).toContain("recorded:alpha");
		expect(fallbackContext).not.toContain(REFUSAL_DETAIL);
		expect(fallbackContext).not.toContain(PROVIDER_ERROR);
		expect(JSON.stringify(session.messages)).not.toContain(REFUSAL_DETAIL);
		expect(JSON.stringify(session.messages)).not.toContain(PROVIDER_ERROR);

		const store = new RefusalStore({ dbPath: controlDb, legacyPath: null, readonly: true });
		try {
			const records = store.list();
			expect(records).toHaveLength(1);
			expect(records[0]).toMatchObject({
				sessionId: session.sessionId,
				childId: CHILD_ID,
				provider: primary.provider,
				model: primary.id,
				recoveryState: "resumed",
				recoveryModel: `${fallback.provider}/${fallback.id}`,
			});
			expect(store.events(records[0]!.id).map(event => event.type)).toEqual([
				"refusal-observed",
				"route-persisted",
				"resume-committed",
			]);
		} finally {
			store.close();
		}

		const routeEntries = sessionManager
			.getBranch()
			.filter(entry => entry.type === "custom" && entry.customType === "provider_refusal_route");
		expect(routeEntries).toHaveLength(1);
		expect(JSON.stringify(routeEntries)).not.toContain(REFUSAL_DETAIL);
		expect(JSON.stringify(routeEntries)).not.toContain(PROVIDER_ERROR);
		const notices = externalIrcBus.pollMessages("Majordomo");
		expect(notices).toHaveLength(1);
		const notice = JSON.parse(notices[0]!.body);
		expect(notice).toMatchObject({
			type: "semantic_refusal_recovery_notice",
			version: 1,
			sessionId: session.sessionId,
			childId: CHILD_ID,
			state: "resumed",
			recoveryModel: `${fallback.provider}/${fallback.id}`,
		});
		expect(notices[0]!.body).not.toContain(REFUSAL_DETAIL);
		expect(notices[0]!.body).not.toContain(PROVIDER_ERROR);
	} finally {
		await session.dispose();
		authStorage.close();
		externalIrcBus.close();
	}
}

if (CHILD_MODE) {
	describe("semantic refusal recovery fixture", () => {
		it("continues the same child on Sol without replay or refusal leakage", exerciseSameChildRecovery, 30_000);
	});
} else {
	afterEach(async () => {
		await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
	});

	describe("semantic refusal recovery integration", () => {
		it("runs the recorded refusal fixture in an isolated host process", async () => {
			const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-semantic-refusal-integration-"));
			tempRoots.push(root);
			const testProcess = Bun.spawn([process.execPath, "test", import.meta.path], {
				cwd: path.resolve(import.meta.dir, ".."),
				env: {
					...Bun.env,
					HOME: path.join(root, "home"),
					OMP_CONFIG_ROOT: path.join(root, "config"),
					OMP_SESSION_CONTROL_DB: path.join(root, "session-control.sqlite"),
					OMP_REFUSALS_DB: path.join(root, "session-control.sqlite"),
					OMP_IRC_DB: path.join(root, "irc.sqlite"),
					OMP_REFUSALS_PATH: path.join(root, "legacy-refusals.jsonl"),
					OMP_SEMANTIC_REFUSAL_INTEGRATION_CHILD: "1",
					OMP_SEMANTIC_REFUSAL_TEST_ROOT: root,
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(testProcess.stdout).text(),
				new Response(testProcess.stderr).text(),
				testProcess.exited,
			]);
			if (exitCode !== 0) throw new Error(`Child refusal integration failed (${exitCode})\n${stdout}\n${stderr}`);
		}, 40_000);
	});
}
