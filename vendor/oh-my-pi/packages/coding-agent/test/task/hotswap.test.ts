import { afterEach, describe, expect, it, vi } from "bun:test";
import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Model } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { Effort } from "@oh-my-pi/pi-catalog/effort";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession, AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { MemorySessionStorage } from "@oh-my-pi/pi-coding-agent/session/session-storage";
import * as hotswapModule from "@oh-my-pi/pi-coding-agent/task/hotswap";
import {
	type HotswapResult,
	hotswapAgentModel,
	type RestorableSessionModel,
	resolveRestorableSessionModel,
} from "@oh-my-pi/pi-coding-agent/task/hotswap";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { JobTool } from "@oh-my-pi/pi-coding-agent/tools/job";

const modelA = buildModel({
	id: "model-a",
	name: "Model A",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: false,
	input: ["text"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
});

const modelB = buildModel({
	id: "model-b",
	name: "Model B",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 2000,
	maxTokens: 100,
});

const modelC = buildModel({
	id: "model-c",
	name: "Model C",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 2000,
	maxTokens: 100,
});

const fableModel = buildModel({
	id: "claude-fable-5",
	name: "Fable",
	api: "openai-responses",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 2000,
	maxTokens: 100,
});

const retiredGpt55 = buildModel({
	id: "gpt-5.5",
	name: "GPT-5.5",
	api: "openai-responses",
	provider: "openai-codex",
	baseUrl: "https://api.openai.com/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 2000,
	maxTokens: 100,
});

const terra = buildModel({
	id: "gpt-5.6-terra",
	name: "GPT-5.6 Terra",
	api: "openai-responses",
	provider: "openai-codex",
	baseUrl: "https://api.openai.com/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 2000,
	maxTokens: 100,
});

interface ModelRegistryStub {
	getAvailable(): Model[];
	getApiKey(model: Model): Promise<string | undefined>;
	hasConfiguredAuth(model: Model): boolean;
}

interface SessionStubControls {
	session: AgentSession;
	setStreaming(value: boolean): void;
	emit(event: AgentSessionEvent): void;
	setModelCalls: Array<{ model: Model; role: string }>;
	thinkingCalls: Array<ThinkingLevel | undefined>;
	modelChangeCalls: Array<{ model: string; role: string }>;
	notices: Array<{ content: string; deliverAs: string | undefined }>;
	unsubscribeCalls(): number;
}

function makeRegistry(
	models: Model[] = [modelA, modelB, modelC],
	key = "key",
	hasConfiguredAuth: (model: Model) => boolean = () => true,
): ModelRegistryStub {
	return {
		getAvailable: () => models,
		getApiKey: async () => key,
		hasConfiguredAuth,
	};
}

async function createHistoricalChild(options: {
	parent: SessionManager;
	storage: MemorySessionStorage;
	fileName: string;
	agentId: string;
	thinkingLevel: string;
	parentSessionFile?: string;
	parentSessionId?: string;
}): Promise<string> {
	const parentFile = options.parent.getSessionFile();
	if (!parentFile) throw new Error("Parent session file is required for a durable child");
	const childFile = `${parentFile.slice(0, -".jsonl".length)}/${options.fileName}.jsonl`;
	await options.storage.writeText(childFile, "");
	const child = await SessionManager.open(childFile, undefined, options.storage, { suppressBreadcrumb: true });
	child.appendSessionInit({
		systemPrompt: "child system prompt",
		task: "child task",
		tools: [],
		subagent: {
			agentId: options.agentId,
			parentSessionFile: options.parentSessionFile ?? parentFile,
			parentSessionId: options.parentSessionId ?? options.parent.getSessionId(),
			displayName: options.agentId,
			model: "openai-codex/gpt-5.5",
			thinkingLevel: options.thinkingLevel,
			isolated: false,
			taskDepth: 1,
			parentTaskPrefix: options.agentId,
		},
	});
	child.appendModelChange("openai-codex/gpt-5.5");
	child.appendThinkingLevelChange(options.thinkingLevel);
	return childFile;
}

function makeSessionStub(
	options: {
		model?: Model;
		streaming?: boolean;
		registry?: ModelRegistryStub;
		onSubscribe?: () => void;
		sessionManager?: SessionManager;
	} = {},
): SessionStubControls {
	let currentModel = options.model ?? modelA;
	let streaming = options.streaming ?? false;
	let disposed = false;
	let unsubscribeCount = 0;
	const listeners: Array<(event: AgentSessionEvent) => void> = [];
	const setModelCalls: Array<{ model: Model; role: string }> = [];
	const thinkingCalls: Array<ThinkingLevel | undefined> = [];
	const modelChangeCalls: Array<{ model: string; role: string }> = [];
	const notices: Array<{ content: string; deliverAs: string | undefined }> = [];
	const session = {
		get model() {
			return currentModel;
		},
		get isStreaming() {
			return streaming;
		},
		get isDisposed() {
			return disposed;
		},
		modelRegistry: options.registry ?? makeRegistry(),
		settings: Settings.isolated({}),
		sessionManager: options.sessionManager ?? {
			appendModelChange: (model: string, role: string) => {
				modelChangeCalls.push({ model, role });
				return "model-change-id";
			},
			appendCustomEntry: () => "custom-entry-id",
			getEntries: () => [],
			getSessionId: () => "stub-session",
			flush: async () => {},
		},
		setModel: async (model: Model, role: string) => {
			setModelCalls.push({ model, role });
			currentModel = model;
		},
		setThinkingLevel: (level: ThinkingLevel | undefined) => {
			thinkingCalls.push(level);
		},
		sendCustomMessage: async (
			message: { content: string },
			messageOptions?: { deliverAs?: "steer" | "followUp" | "nextTurn" },
		) => {
			notices.push({ content: message.content, deliverAs: messageOptions?.deliverAs });
			return false;
		},
		subscribe: (listener: (event: AgentSessionEvent) => void) => {
			options.onSubscribe?.();
			listeners.push(listener);
			return () => {
				unsubscribeCount++;
				const index = listeners.indexOf(listener);
				if (index !== -1) listeners.splice(index, 1);
			};
		},
		dispose: async () => {
			disposed = true;
		},
	};
	return {
		session: session as object as AgentSession,
		setStreaming: value => {
			streaming = value;
		},
		emit: event => {
			for (const listener of [...listeners]) listener(event);
		},
		setModelCalls,
		thinkingCalls,
		modelChangeCalls,
		notices,
		unsubscribeCalls: () => unsubscribeCount,
	};
}

function registerSub(
	id: string,
	session: AgentSession | null,
	status: "idle" | "running" | "parked" | "aborted" = "idle",
	parentId?: string,
) {
	return AgentRegistry.global().register({ id, displayName: id, kind: "sub", parentId, session, status });
}

async function flushAsync(): Promise<void> {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content.find(part => part.type === "text")?.text ?? "";
}

describe("hotswapAgentModel", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
	});

	it("applies immediately to an idle session and injects a next-turn notice", async () => {
		const stub = makeSessionStub();
		registerSub("IdleSub", stub.session, "idle", "Main");

		const result = await hotswapAgentModel({
			agentId: "IdleSub",
			model: "openai/model-b",
			requestedBy: "Main",
			reason: "testing",
		});

		expect(result).toEqual({
			status: "applied",
			agentId: "IdleSub",
			from: "anthropic/model-a",
			to: "openai/model-b",
		});
		expect(stub.setModelCalls).toEqual([{ model: modelB, role: "hotswap" }]);
		expect(stub.notices).toHaveLength(1);
		expect(stub.notices[0]?.deliverAs).toBe("nextTurn");
		expect(stub.notices[0]?.content).toContain("hot-swapped by Main: anthropic/model-a → openai/model-b");
		expect(stub.notices[0]?.content).toContain("reason: testing");
	});

	it("refuses to hot-swap a subagent onto a blocked (fable) model", async () => {
		const stub = makeSessionStub({ registry: makeRegistry([modelA, modelB, fableModel]) });
		registerSub("GuardedSub", stub.session);

		const result = await hotswapAgentModel({ agentId: "GuardedSub", model: "anthropic/claude-fable-5" });

		expect(result.status).toBe("failed");
		if (result.status === "failed") expect(result.error).toContain("not allowed for subagents");
		expect(stub.setModelCalls).toHaveLength(0);
		expect(stub.notices).toHaveLength(0);
	});

	it("queues while streaming, applies once on agent_end, and unsubscribes", async () => {
		const stub = makeSessionStub({ streaming: true });
		registerSub("StreamingSub", stub.session, "running");

		const result = await hotswapAgentModel({ agentId: "StreamingSub", model: "openai/model-b" });

		expect(result).toEqual({
			status: "queued",
			agentId: "StreamingSub",
			from: "anthropic/model-a",
			to: "openai/model-b",
		});
		expect(stub.setModelCalls).toHaveLength(0);
		stub.setStreaming(false);
		stub.emit({ type: "agent_end", messages: [] });
		await flushAsync();
		expect(stub.setModelCalls).toEqual([{ model: modelB, role: "hotswap" }]);
		expect(stub.unsubscribeCalls()).toBe(1);
	});

	it("handles the subscribe race by applying exactly once when streaming flips idle", async () => {
		const stub = makeSessionStub({ streaming: true, onSubscribe: () => stub.setStreaming(false) });
		registerSub("RaceSub", stub.session, "running");

		const result = await hotswapAgentModel({ agentId: "RaceSub", model: "openai/model-b" });

		expect(result.status).toBe("applied");
		expect(stub.setModelCalls).toEqual([{ model: modelB, role: "hotswap" }]);
		expect(stub.unsubscribeCalls()).toBe(1);
	});

	it("uses last-wins semantics for two queued swaps", async () => {
		const stub = makeSessionStub({ streaming: true });
		registerSub("LastWinsSub", stub.session, "running");

		const first = await hotswapAgentModel({ agentId: "LastWinsSub", model: "openai/model-b" });
		const second = await hotswapAgentModel({ agentId: "LastWinsSub", model: "openai/model-c" });

		expect(first.status).toBe("queued");
		expect(second).toEqual({
			status: "queued",
			agentId: "LastWinsSub",
			from: "anthropic/model-a",
			to: "openai/model-c",
		});
		stub.setStreaming(false);
		stub.emit({ type: "agent_end", messages: [] });
		await flushAsync();
		expect(stub.setModelCalls).toEqual([{ model: modelC, role: "hotswap" }]);
	});

	it("returns failed without throwing for unknown, aborted, unresolvable, and missing-auth targets", async () => {
		await expect(hotswapAgentModel({ agentId: "Missing", model: "openai/model-b" })).resolves.toMatchObject({
			status: "failed",
		});

		registerSub("AbortedSub", null, "aborted");
		await expect(hotswapAgentModel({ agentId: "AbortedSub", model: "openai/model-b" })).resolves.toMatchObject({
			status: "failed",
		});

		const unresolvable = makeSessionStub({ registry: makeRegistry([modelA]) });
		registerSub("UnresolvableSub", unresolvable.session);
		await expect(hotswapAgentModel({ agentId: "UnresolvableSub", model: "openai/model-b" })).resolves.toMatchObject({
			status: "failed",
		});
		expect(unresolvable.setModelCalls).toHaveLength(0);

		const missingAuth = makeSessionStub({ registry: makeRegistry([modelA, modelB], "") });
		registerSub("NoAuthSub", missingAuth.session);
		await expect(hotswapAgentModel({ agentId: "NoAuthSub", model: "openai/model-b" })).resolves.toMatchObject({
			status: "failed",
		});
		expect(missingAuth.setModelCalls).toHaveLength(0);
	});

	it("treats same-model requests without explicit thinking as no-ops", async () => {
		const stub = makeSessionStub();
		registerSub("NoopSub", stub.session);

		const result = await hotswapAgentModel({ agentId: "NoopSub", model: "anthropic/model-a" });

		expect(result).toEqual({
			status: "applied",
			agentId: "NoopSub",
			from: "anthropic/model-a",
			to: "anthropic/model-a",
		});
		expect(stub.setModelCalls).toHaveLength(0);
		expect(stub.notices).toHaveLength(0);
	});

	it("applies same-model thinking-only swaps without resetting the provider session", async () => {
		const stub = makeSessionStub({ model: modelB });
		registerSub("ThinkingOnlySub", stub.session);

		const result = await hotswapAgentModel({ agentId: "ThinkingOnlySub", model: "openai/model-b:high" });

		expect(result).toEqual({
			status: "applied",
			agentId: "ThinkingOnlySub",
			from: "openai/model-b",
			to: "openai/model-b",
		});
		expect(stub.setModelCalls).toHaveLength(0);
		expect(stub.thinkingCalls).toEqual(["high" as ThinkingLevel]);
		expect(stub.modelChangeCalls).toEqual([{ model: "openai/model-b", role: "hotswap" }]);
	});

	it("rejects unsupported thinking before mutating a live child", async () => {
		const stub = makeSessionStub();
		registerSub("UnsupportedEffort", stub.session);

		await expect(
			hotswapAgentModel({ agentId: "UnsupportedEffort", model: "anthropic/model-a:high" }),
		).resolves.toMatchObject({
			status: "failed",
			error: "Thinking effort high is not supported by anthropic/model-a",
		});
		expect(stub.setModelCalls).toHaveLength(0);
		expect(stub.modelChangeCalls).toHaveLength(0);
		expect(stub.notices).toHaveLength(0);
	});

	it("revives parked agents before applying", async () => {
		const stub = makeSessionStub();
		registerSub("ParkedSub", null, "parked", "Main");
		AgentLifecycleManager.global().adopt("ParkedSub", { idleTtlMs: 0, revive: async () => stub.session });

		const result = await hotswapAgentModel({ agentId: "ParkedSub", model: "openai/model-b", requestedBy: "Main" });

		expect(result.status).toBe("applied");
		expect(AgentRegistry.global().get("ParkedSub")?.status).toBe("idle");
		expect(stub.setModelCalls).toEqual([{ model: modelB, role: "hotswap" }]);
	});


	it("hot-swaps a registered grandchild from the owning root session", async () => {
		const stub = makeSessionStub();
		registerSub("Parent", null, "parked", "Main");
		registerSub("Parent.Child", stub.session, "idle", "Parent");

		const result = await hotswapAgentModel({
			agentId: "Parent.Child",
			model: "openai/model-b",
			requestedBy: "Main",
		});

		expect(result.status).toBe("applied");
		expect(stub.setModelCalls).toEqual([{ model: modelB, role: "hotswap" }]);
	});
	it("rejects live children owned by another parent without mutating them", async () => {
		const stub = makeSessionStub();
		registerSub("ForeignLive", stub.session, "idle", "OtherParent");

		await expect(
			hotswapAgentModel({ agentId: "ForeignLive", model: "openai/model-b", requestedBy: "Main" }),
		).resolves.toEqual({
			status: "failed",
			agentId: "ForeignLive",
			error: "Agent ForeignLive is not a direct child of Main.",
		});
		expect(stub.setModelCalls).toHaveLength(0);
	});

	it.each([
		"high",
		"medium",
	] as const)("records historical GPT-5.5 %s swaps as Terra with durable effort", async thinkingLevel => {
		const storage = new MemorySessionStorage();
		const parent = SessionManager.create("/project", "/sessions", storage);
		const childFile = await createHistoricalChild({
			parent,
			storage,
			fileName: `Historical${thinkingLevel}`,
			agentId: "HistoricalTerra",
			thinkingLevel,
		});
		const before = await storage.readText(childFile);

		const result = await hotswapAgentModel({
			agentId: "HistoricalTerra",
			model: `openai-codex/gpt-5.6-terra:${thinkingLevel}`,
			parentSessionManager: parent,
			modelRegistry: makeRegistry([retiredGpt55, terra]),
			settings: Settings.isolated({}),
		});

		expect(result).toEqual({
			status: "recorded",
			agentId: "HistoricalTerra",
			from: "openai-codex/gpt-5.5",
			to: "openai-codex/gpt-5.6-terra",
		});
		const reopened = await SessionManager.open(childFile, undefined, storage, { suppressBreadcrumb: true });
		expect(
			reopened
				.getEntries()
				.slice(-3)
				.map(entry => entry.type),
		).toEqual(["model_change", "thinking_level_change", "custom"]);
		expect(reopened.getLastModelChangeRole()).toBe("hotswap");
		expect(reopened.buildSessionContext().thinkingLevel).toBe(thinkingLevel);
		const route = reopened.getEntries().at(-1);
		expect(route?.type).toBe("custom");
		if (route?.type === "custom") {
			expect((route.data as { route: { effort: string } }).route.effort).toBe(thinkingLevel);
			expect(
				(
					route.data as {
						hotswapAudit: { previousRoute: { effort: string }; newRoute: { effort: string }; timestamp: string };
					}
				).hotswapAudit,
			).toMatchObject({
				requestedBy: null,
				previousRoute: { effort: thinkingLevel },
				newRoute: { effort: thinkingLevel },
			});
			expect(typeof (route.data as { hotswapAudit: { timestamp: string } }).hotswapAudit.timestamp).toBe("string");
		}
		expect(
			resolveRestorableSessionModel(
				reopened,
				makeRegistry([retiredGpt55, terra]),
				Settings.isolated({}),
				retiredGpt55,
			),
		).toEqual({
			model: terra,
			thinkingLevel,
		});
		const after = await storage.readText(childFile);
		expect(after.split("\n").slice(0, -4)).toEqual(before.trimEnd().split("\n"));
	});

	it("refuses unknown and colliding historical agent ids", async () => {
		const storage = new MemorySessionStorage();
		const parent = SessionManager.create("/project", "/sessions", storage);
		const args = {
			model: "openai-codex/gpt-5.6-terra:high",
			parentSessionManager: parent,
			modelRegistry: makeRegistry([retiredGpt55, terra]),
			settings: Settings.isolated({}),
		};
		await expect(hotswapAgentModel({ agentId: "MissingHistorical", ...args })).resolves.toEqual({
			status: "failed",
			agentId: "MissingHistorical",
			error: "Unknown agent: MissingHistorical",
		});
		await createHistoricalChild({
			parent,
			storage,
			fileName: "DuplicateOne",
			agentId: "DuplicateHistorical",
			thinkingLevel: "high",
		});
		await createHistoricalChild({
			parent,
			storage,
			fileName: "DuplicateTwo",
			agentId: "DuplicateHistorical",
			thinkingLevel: "high",
		});
		await expect(hotswapAgentModel({ agentId: "DuplicateHistorical", ...args })).resolves.toEqual({
			status: "failed",
			agentId: "DuplicateHistorical",
			error: "Ambiguous historical agent id: DuplicateHistorical",
		});
	});

	it("does not mutate a foreign historical journal", async () => {
		const storage = new MemorySessionStorage();
		const parent = SessionManager.create("/project", "/sessions", storage);
		const foreignFile = await createHistoricalChild({
			parent,
			storage,
			fileName: "Foreign",
			agentId: "ForeignHistorical",
			thinkingLevel: "high",
			parentSessionFile: "/foreign/parent.jsonl",
			parentSessionId: "foreign-parent",
		});
		const before = await storage.readText(foreignFile);

		await expect(
			hotswapAgentModel({
				agentId: "ForeignHistorical",
				model: "openai-codex/gpt-5.6-terra:high",
				parentSessionManager: parent,
				modelRegistry: makeRegistry([retiredGpt55, terra]),
				settings: Settings.isolated({}),
			}),
		).resolves.toEqual({ status: "failed", agentId: "ForeignHistorical", error: "Unknown agent: ForeignHistorical" });
		expect(await storage.readText(foreignFile)).toBe(before);
	});
});

describe("resolveRestorableSessionModel", () => {
	it("restores a hotswap role model before the default spawn model with persisted thinking", () => {
		const source = {
			buildSessionContext: () => ({
				models: { default: "anthropic/model-a", hotswap: "openai/model-b" },
				thinkingLevel: "high",
			}),
			getLastModelChangeRole: () => "hotswap",
		};

		const restored: RestorableSessionModel | undefined = resolveRestorableSessionModel(
			source,
			makeRegistry([modelA, modelB]),
			Settings.isolated({}),
			modelA,
		);

		expect(restored).toEqual({ model: modelB, thinkingLevel: Effort.High });
	});

	it("restores same-model thinking-only hotswaps", () => {
		const source = {
			buildSessionContext: () => ({
				models: { default: "anthropic/model-a", hotswap: "anthropic/model-a" },
				thinkingLevel: "high",
			}),
			getLastModelChangeRole: () => "hotswap",
		};

		const restored = resolveRestorableSessionModel(source, makeRegistry([modelA]), Settings.isolated({}), modelA);

		expect(restored).toEqual({ model: modelA, thinkingLevel: Effort.High });
	});

	it("leaves the no-hotswap default revive path unchanged", () => {
		const source = {
			buildSessionContext: () => ({
				models: { default: "openai/model-b" },
				thinkingLevel: "high",
			}),
			getLastModelChangeRole: () => "default",
		};

		const restored = resolveRestorableSessionModel(
			source,
			makeRegistry([modelA, modelB]),
			Settings.isolated({}),
			modelA,
		);

		expect(restored).toBeUndefined();
	});

	it("does not restore an unauthenticated hotswap model", () => {
		const source = {
			buildSessionContext: () => ({
				models: { default: "anthropic/model-a", hotswap: "openai/model-b" },
				thinkingLevel: "high",
			}),
			getLastModelChangeRole: () => "hotswap",
		};
		const registry = makeRegistry([modelA, modelB], "key", model => model.provider !== "openai");

		const restored = resolveRestorableSessionModel(source, registry, Settings.isolated({}), modelA);

		expect(restored).toEqual({ model: modelA, thinkingLevel: Effort.High });
	});
});

describe("job setModel operation", () => {
	const managers: AsyncJobManager[] = [];

	function createManager(): AsyncJobManager {
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		managers.push(manager);
		return manager;
	}

	function createToolSession(manager: AsyncJobManager, ownerId: string): ToolSession {
		return {
			asyncJobManager: manager,
			settings: Settings.isolated({}),
			getAgentId: () => ownerId,
		} as object as ToolSession;
	}

	function registerRunningTask(manager: AsyncJobManager, id: string, ownerId: string): void {
		manager.register(
			"task",
			id,
			async ({ signal }) => {
				await new Promise<void>((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
				});
				return "done";
			},
			{ id, ownerId },
		);
	}

	afterEach(async () => {
		vi.restoreAllMocks();
		for (const manager of managers.splice(0)) {
			await manager.dispose({ timeoutMs: 1000 });
		}
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
	});

	it("routes owned setModel requests to the hotswap primitive and renders applied output", async () => {
		const manager = createManager();
		registerRunningTask(manager, "OwnedSub", "Main");
		vi.spyOn(hotswapModule, "hotswapAgentModel").mockResolvedValue({
			status: "applied",
			agentId: "OwnedSub",
			from: "anthropic/model-a",
			to: "openai/model-b",
		} satisfies HotswapResult);

		const result = await new JobTool(createToolSession(manager, "Main")).execute("job-set-model", {
			setModel: { id: "OwnedSub", model: "openai/model-b", reason: "capacity" },
		});

		expect(hotswapModule.hotswapAgentModel).toHaveBeenCalledWith({
			agentId: "OwnedSub",
			model: "openai/model-b",
			reason: "capacity",
			requestedBy: "Main",
		});
		expect(firstText(result)).toBe("Hot-swap applied: OwnedSub now openai/model-b (was anthropic/model-a)");
	});

	it("swaps the current Main session through the validated hotswap path", async () => {
		const manager = createManager();
		const parent = SessionManager.create("/project", "/sessions", new MemorySessionStorage());
		const stub = makeSessionStub({ model: modelA, sessionManager: parent });
		AgentRegistry.global().register({
			id: "Main",
			displayName: "main",
			kind: "main",
			session: stub.session,
			status: "idle",
		});
		const session = {
			asyncJobManager: manager,
			settings: Settings.isolated({}),
			getAgentId: () => "Main",
			sessionManager: parent,
			modelRegistry: makeRegistry([modelA, modelB]),
		} as object as ToolSession;

		const result = await new JobTool(session).execute("job-main-set-model", {
			setModel: { id: "Main", model: "openai/model-b:high", reason: "operator route" },
		});

		expect(firstText(result)).toBe("Hot-swap applied: Main now openai/model-b (was anthropic/model-a)");
		expect(stub.setModelCalls).toEqual([{ model: modelB, role: "hotswap" }]);
		expect(stub.thinkingCalls).toEqual(["high" as ThinkingLevel]);
	});

	it("routes setModel to a historical direct child without a background job", async () => {
		const storage = new MemorySessionStorage();
		const parent = SessionManager.create("/project", "/sessions", storage);
		await createHistoricalChild({
			parent,
			storage,
			fileName: "HistoricalJob",
			agentId: "HistoricalJob",
			thinkingLevel: "high",
		});
		const session = {
			settings: Settings.isolated({}),
			getAgentId: () => "Main",
			sessionManager: parent,
			modelRegistry: makeRegistry([retiredGpt55, terra]),
		} as object as ToolSession;

		const result = await new JobTool(session).execute("job-historical-set-model", {
			setModel: { id: "HistoricalJob", model: "openai-codex/gpt-5.6-terra:high" },
		});

		expect(firstText(result)).toBe(
			"Hot-swap recorded: HistoricalJob will use openai-codex/gpt-5.6-terra when revived (was openai-codex/gpt-5.5)",
		);
	});

	it("denies setModel for jobs owned by another agent", async () => {
		const manager = createManager();
		registerRunningTask(manager, "OtherSub", "OtherParent");
		const spy = vi.spyOn(hotswapModule, "hotswapAgentModel");

		const result = await new JobTool(createToolSession(manager, "Main")).execute("job-denied", {
			setModel: { id: "OtherSub", model: "openai/model-b" },
		});

		expect(spy).not.toHaveBeenCalled();
		expect(firstText(result)).toBe("Hot-swap failed: background job not found: OtherSub");
	});

	it("renders queued and failed hotswap results", async () => {
		const manager = createManager();
		registerRunningTask(manager, "QueuedSub", "Main");
		const spy = vi.spyOn(hotswapModule, "hotswapAgentModel");
		spy.mockResolvedValueOnce({
			status: "queued",
			agentId: "QueuedSub",
			from: "anthropic/model-a",
			to: "openai/model-b",
		} satisfies HotswapResult);
		const tool = new JobTool(createToolSession(manager, "Main"));

		const queued = await tool.execute("job-queued", { setModel: { id: "QueuedSub", model: "openai/model-b" } });
		expect(firstText(queued)).toBe(
			"Hot-swap queued: QueuedSub will switch anthropic/model-a → openai/model-b at its next turn boundary",
		);

		spy.mockResolvedValueOnce({
			status: "failed",
			agentId: "QueuedSub",
			error: "Missing credentials for openai/model-b",
		});
		const failed = await tool.execute("job-failed", { setModel: { id: "QueuedSub", model: "openai/model-b" } });
		expect(firstText(failed)).toBe("Hot-swap failed: Missing credentials for openai/model-b");
	});

	it("interrupts owned jobs and reports that the agent stays alive", async () => {
		const manager = createManager();
		registerRunningTask(manager, "InterruptSub", "Main");

		const result = await new JobTool(createToolSession(manager, "Main")).execute("job-interrupt", {
			interrupt: ["InterruptSub"],
			interruptReason: "need a checkpoint",
		});

		expect(firstText(result)).toContain("Interrupted InterruptSub — agent kept alive (irc-addressable)");
		expect(result.details?.interrupted).toEqual([{ id: "InterruptSub", status: "interrupted" }]);
		expect(manager.getJob("InterruptSub")?.interruptRequested).toBe(true);
		expect(manager.getJob("InterruptSub")?.interruptReason).toBe("need a checkpoint");
		expect(manager.getJob("InterruptSub")?.interruptRequestedBy).toBe("Main");
	});


	it("resolves dotted grandchildren for poll, cancel, interrupt, and setModel", async () => {
		const manager = createManager();
		const registry = AgentRegistry.global();
		registry.register({
			id: "Parent",
			displayName: "parent",
			kind: "sub",
			parentId: "Main",
			session: null,
			status: "idle",
		});
		registry.register({
			id: "Parent.Child",
			displayName: "child",
			kind: "sub",
			parentId: "Parent",
			session: null,
			status: "running",
		});
		registerRunningTask(manager, "Parent.Child", "Parent");
		const tool = new JobTool(createToolSession(manager, "Main"));

		const pollAbort = new AbortController();
		setTimeout(() => pollAbort.abort(), 5);
		const polled = await tool.execute("job-poll-grandchild", { poll: ["Parent.Child"] }, pollAbort.signal);
		expect(polled.details?.jobs.map(job => job.id)).toEqual(["Parent.Child"]);
		const swap = vi.spyOn(hotswapModule, "hotswapAgentModel").mockResolvedValue({
			status: "queued",
			agentId: "Parent.Child",
			from: "anthropic/model-a",
			to: "openai/model-b",
		});
		const swapped = await tool.execute("job-model-grandchild", {
			setModel: { id: "Parent.Child", model: "openai/model-b" },
		});
		expect(firstText(swapped)).toContain("Hot-swap queued: Parent.Child");
		expect(swap).toHaveBeenCalledWith(
			expect.objectContaining({ agentId: "Parent.Child", requestedBy: "Main" }),
		);

		const interrupted = await tool.execute("job-interrupt-grandchild", { interrupt: ["Parent.Child"] });
		expect(interrupted.details?.interrupted).toEqual([{ id: "Parent.Child", status: "interrupted" }]);
		expect(manager.getJob("Parent.Child")?.interruptRequested).toBe(true);
		expect(manager.getJob("Parent.Child")?.interruptRequestedBy).toBe("Main");

		registry.register({
			id: "Parent.CancelChild",
			displayName: "cancel child",
			kind: "sub",
			parentId: "Parent",
			session: null,
			status: "running",
		});
		registerRunningTask(manager, "Parent.CancelChild", "Parent");
		const cancelled = await tool.execute("job-cancel-grandchild", { cancel: ["Parent.CancelChild"] });
		expect(cancelled.details?.cancelled).toEqual([{ id: "Parent.CancelChild", status: "cancelled" }]);
		expect(manager.getJob("Parent.CancelChild")?.status).toBe("cancelled");
	});
	it("enforces interrupt ownership and rejects non-running jobs cleanly", async () => {
		const manager = createManager();
		registerRunningTask(manager, "OtherInterruptSub", "OtherParent");
		const completedId = manager.register("task", "DoneSub", async () => "done", { id: "DoneSub", ownerId: "Main" });
		await manager.getJob(completedId)?.promise;

		const result = await new JobTool(createToolSession(manager, "Main")).execute("job-interrupt-denied", {
			interrupt: ["OtherInterruptSub", "DoneSub"],
		});

		expect(firstText(result)).toContain("Background job not found: OtherInterruptSub");
		expect(firstText(result)).toContain("Background job DoneSub is already completed.");
		expect(result.details?.interrupted).toEqual([
			{ id: "OtherInterruptSub", status: "not_found" },
			{ id: "DoneSub", status: "not_running" },
		]);
		expect(manager.getJob("OtherInterruptSub")?.interruptRequested).toBeUndefined();
	});
});
