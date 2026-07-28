import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { createMockModel, type MockModel, registerMockApi } from "@oh-my-pi/pi-ai/providers/mock";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { AgentSession, type AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";
import { assistantMsg, userMsg } from "./utilities";

registerMockApi("compaction-content-block-fallback");

const CONTENT_BLOCK = "Codex error event: Request blocked. (code=invalid_prompt)";

describe("compaction content-block fallback", () => {
	let tempDir: TempDir;
	let previousHome: string | undefined;
	let previousControlDb: string | undefined;
	let authStorage: AuthStorage | undefined;
	let ircBus: IrcExternalBus | undefined;
	let session: AgentSession | undefined;

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-compaction-content-block-");
		previousHome = process.env.HOME;
		previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
		process.env.HOME = tempDir.path();
		process.env.OMP_SESSION_CONTROL_DB = path.join(tempDir.path(), "session-control.sqlite");
		ircBus = new IrcExternalBus(path.join(tempDir.path(), "irc-bus.sqlite"));
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await session?.dispose();
		ircBus?.close();
		authStorage?.close();
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
		else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
		tempDir.removeSync();
	});

	async function createSession(primary: MockModel, fallback: MockModel): Promise<AgentSession> {
		const settings = Settings.isolated({
			"compaction.autoContinue": false,
			"compaction.keepRecentTokens": 1,
			"compaction.strategy": "context-full",
			"compaction.thresholdPercent": 1,
			"contextPromotion.enabled": false,
			"retry.baseDelayMs": 1,
			"retry.maxRetries": 1,
		});
		settings.setModelRole("smol", `${fallback.provider}/${fallback.id}`);

		authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.sqlite"));
		authStorage.setRuntimeApiKey(primary.provider, "primary-token");
		authStorage.setRuntimeApiKey(fallback.provider, "fallback-token");
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));
		vi.spyOn(modelRegistry, "getAvailable").mockReturnValue([primary, fallback]);

		const agent = new Agent({
			initialState: {
				model: primary,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
			},
			streamFn: primary.stream,
		});
		const created = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir.path()),
			settings,
			modelRegistry,
			externalIrcBus: ircBus,
		});
		created.subscribe(() => {});

		for (const [userText, assistantText] of [
			["first question", "first answer"],
			["second question", "second answer"],
		] as const) {
			const user = userMsg(userText);
			const assistant = assistantMsg(assistantText);
			created.agent.appendMessage(user);
			created.sessionManager.appendMessage(user);
			created.agent.appendMessage(assistant);
			created.sessionManager.appendMessage(assistant);
		}

		session = created;
		return created;
	}

	it("manual compact falls through to candidate 2 after invalid_prompt", async () => {
		const primary = createMockModel({
			id: "sol",
			provider: "codex-fixture",
			handler: { stopReason: "error", errorMessage: CONTENT_BLOCK },
		});
		const fallback = createMockModel({
			id: "opus",
			provider: "anthropic-fixture",
			handler: { content: ["fallback summary"], stopReason: "stop" },
		});
		const created = await createSession(primary, fallback);

		const result = await created.compact();

		expect(result.summary).toContain("fallback summary");
		expect(primary.calls.length).toBeGreaterThan(0);
		expect(fallback.calls.length).toBeGreaterThan(0);
	});

	it("all-candidates-fail error lists every candidate and failure class", async () => {
		const primary = createMockModel({
			id: "sol",
			provider: "codex-fixture",
			handler: { stopReason: "error", errorMessage: CONTENT_BLOCK },
		});
		const fallback = createMockModel({
			id: "opus",
			provider: "anthropic-fixture",
			handler: { stopReason: "error", errorMessage: "auth_unavailable: no auth available" },
		});
		const created = await createSession(primary, fallback);

		const error = await created.compact().catch(cause => cause);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("codex-fixture/sol: content-blocked");
		expect((error as Error).message).toContain("anthropic-fixture/opus: auth");
		expect(primary.calls.length).toBeGreaterThan(0);
		expect(fallback.calls.length).toBeGreaterThan(0);
	});

	it("auto-compaction still retries a transient failure on the same candidate", async () => {
		let transientCalls = 0;
		const primary = createMockModel({
			id: "sol",
			provider: "codex-fixture",
			handler: () =>
				transientCalls++ === 0
					? { stopReason: "error", errorMessage: "503 service unavailable retry-after-ms=1" }
					: { content: ["recovered summary"], stopReason: "stop" },
		});
		const fallback = createMockModel({
			id: "opus",
			provider: "anthropic-fixture",
			handler: { content: ["unexpected fallback"], stopReason: "stop" },
		});
		const created = await createSession(primary, fallback);
		const completion = Promise.withResolvers<Extract<AgentSessionEvent, { type: "auto_compaction_end" }>>();
		created.subscribe(event => {
			if (event.type === "auto_compaction_end") completion.resolve(event);
		});
		const assistant = {
			role: "assistant" as const,
			content: [{ type: "text" as const, text: "Done." }],
			api: primary.api,
			provider: primary.provider,
			model: primary.id,
			stopReason: "stop" as const,
			usage: {
				input: 190_000,
				output: 1_000,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 191_000,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: Date.now(),
		};

		created.agent.emitExternalEvent({ type: "message_end", message: assistant });
		created.agent.emitExternalEvent({ type: "agent_end", messages: [assistant] });
		const end = await Promise.race([
			completion.promise,
			Bun.sleep(2_000).then(() => {
				throw new Error("Timed out waiting for auto-compaction");
			}),
		]);
		await created.waitForIdle();

		expect(end.aborted).toBe(false);
		expect(end.errorMessage).toBeUndefined();
		expect(transientCalls).toBeGreaterThan(1);
		expect(fallback.calls).toHaveLength(0);
	});
});
