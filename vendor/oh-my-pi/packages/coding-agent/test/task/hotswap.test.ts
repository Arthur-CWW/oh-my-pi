import { afterEach, describe, expect, it, vi } from "bun:test";
import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Model } from "@oh-my-pi/pi-ai";
import { Effort } from "@oh-my-pi/pi-catalog/effort";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession, AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import {
	hotswapAgentModel,
	resolveRestorableSessionModel,
	type HotswapResult,
	type RestorableSessionModel,
} from "@oh-my-pi/pi-coding-agent/task/hotswap";
import * as hotswapModule from "@oh-my-pi/pi-coding-agent/task/hotswap";
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

function makeSessionStub(options: {
	model?: Model;
	streaming?: boolean;
	registry?: ModelRegistryStub;
	onSubscribe?: () => void;
} = {}): SessionStubControls {
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
		sessionManager: {
			appendModelChange: (model: string, role: string) => {
				modelChangeCalls.push({ model, role });
				return "model-change-id";
			},
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

function registerSub(id: string, session: AgentSession | null, status: "idle" | "running" | "parked" | "aborted" = "idle") {
	return AgentRegistry.global().register({ id, displayName: id, kind: "sub", session, status });
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
		registerSub("IdleSub", stub.session);

		const result = await hotswapAgentModel({
			agentId: "IdleSub",
			model: "openai/model-b",
			requestedBy: "Main",
			reason: "testing",
		});

		expect(result).toEqual({ status: "applied", agentId: "IdleSub", from: "anthropic/model-a", to: "openai/model-b" });
		expect(stub.setModelCalls).toEqual([{ model: modelB, role: "hotswap" }]);
		expect(stub.notices).toHaveLength(1);
		expect(stub.notices[0]?.deliverAs).toBe("nextTurn");
		expect(stub.notices[0]?.content).toContain("hot-swapped by Main: anthropic/model-a → openai/model-b");
		expect(stub.notices[0]?.content).toContain("reason: testing");
	});

	it("queues while streaming, applies once on agent_end, and unsubscribes", async () => {
		const stub = makeSessionStub({ streaming: true });
		registerSub("StreamingSub", stub.session, "running");

		const result = await hotswapAgentModel({ agentId: "StreamingSub", model: "openai/model-b" });

		expect(result).toEqual({ status: "queued", agentId: "StreamingSub", from: "anthropic/model-a", to: "openai/model-b" });
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
		expect(second).toEqual({ status: "queued", agentId: "LastWinsSub", from: "anthropic/model-a", to: "openai/model-c" });
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

		expect(result).toEqual({ status: "applied", agentId: "NoopSub", from: "anthropic/model-a", to: "anthropic/model-a" });
		expect(stub.setModelCalls).toHaveLength(0);
		expect(stub.notices).toHaveLength(0);
	});

	it("applies same-model thinking-only swaps without resetting the provider session", async () => {
		const stub = makeSessionStub();
		registerSub("ThinkingOnlySub", stub.session);

		const result = await hotswapAgentModel({ agentId: "ThinkingOnlySub", model: "anthropic/model-a:high" });

		expect(result).toEqual({
			status: "applied",
			agentId: "ThinkingOnlySub",
			from: "anthropic/model-a",
			to: "anthropic/model-a",
		});
		expect(stub.setModelCalls).toHaveLength(0);
		expect(stub.thinkingCalls).toEqual(["high" as ThinkingLevel]);
		expect(stub.modelChangeCalls).toEqual([{ model: "anthropic/model-a", role: "hotswap" }]);
	});

	it("revives parked agents before applying", async () => {
		const stub = makeSessionStub();
		registerSub("ParkedSub", null, "parked");
		AgentLifecycleManager.global().adopt("ParkedSub", { idleTtlMs: 0, revive: async () => stub.session });

		const result = await hotswapAgentModel({ agentId: "ParkedSub", model: "openai/model-b" });

		expect(result.status).toBe("applied");
		expect(AgentRegistry.global().get("ParkedSub")?.status).toBe("idle");
		expect(stub.setModelCalls).toEqual([{ model: modelB, role: "hotswap" }]);
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

		const restored = resolveRestorableSessionModel(source, makeRegistry([modelA, modelB]), Settings.isolated({}), modelA);

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

		spy.mockResolvedValueOnce({ status: "failed", agentId: "QueuedSub", error: "Missing credentials for openai/model-b" });
		const failed = await tool.execute("job-failed", { setModel: { id: "QueuedSub", model: "openai/model-b" } });
		expect(firstText(failed)).toBe("Hot-swap failed: Missing credentials for openai/model-b");
	});
});
