import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { LoadExtensionsResult } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { CreateAgentSessionResult } from "@oh-my-pi/pi-coding-agent/sdk";
import * as sdkModule from "@oh-my-pi/pi-coding-agent/sdk";
import type { AgentSession, AgentSessionEvent, PromptOptions } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { runSubprocess } from "@oh-my-pi/pi-coding-agent/task/executor";
import type { AgentDefinition } from "@oh-my-pi/pi-coding-agent/task/types";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { JobTool } from "@oh-my-pi/pi-coding-agent/tools/job";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";
import { logger } from "@oh-my-pi/pi-utils";

const baseAgent: AgentDefinition = {
	name: "task",
	description: "test",
	systemPrompt: "test",
	source: "bundled",
};

const baseOptions = {
	cwd: "/tmp",
	agent: baseAgent,
	task: "do work",
	index: 0,
	modelRegistry: { refresh: async () => {} } as ModelRegistry,
	enableLsp: false,
	settings: Settings.isolated({ "task.maxRuntimeMs": 0, "task.agentIdleTtlMs": 0 }),
};

interface SessionHarness {
	session: AgentSession;
	emit(event: AgentSessionEvent): void;
	setLastAssistantText(text: string): void;
	notices: Array<{ content: string; deliverAs: string | undefined }>;
	disposeCalls(): number;
}

function createSessionHarness(options: {
	hangPrompt?: boolean;
	promptStarted?: () => void;
	releasePrompt?: Promise<void>;
	autoYieldText?: string;
} = {}): SessionHarness {
	const listeners: Array<(event: AgentSessionEvent) => void> = [];
	let lastAssistantText = "initial assistant";
	let disposeCount = 0;
	let autoYieldSent = false;
	const notices: Array<{ content: string; deliverAs: string | undefined }> = [];
	const session: Partial<AgentSession> = {
		state: { messages: [] } as never,
		agent: { state: { systemPrompt: ["test"] } } as never,
		extensionRunner: undefined as never,
		sessionManager: { appendSessionInit: () => {} } as never,
		getActiveToolNames: () => ["read", "yield"],
		setActiveToolsByName: async () => {},
		subscribe: (listener: (event: AgentSessionEvent) => void) => {
			listeners.push(listener);
			return () => {
				const index = listeners.indexOf(listener);
				if (index !== -1) listeners.splice(index, 1);
			};
		},
		prompt: async (_text: string, _options?: PromptOptions) => {
			options.promptStarted?.();
			if (options.autoYieldText && !autoYieldSent) {
				autoYieldSent = true;
				queueMicrotask(() => {
					lastAssistantText = options.autoYieldText ?? lastAssistantText;
					for (const listener of [...listeners]) {
						listener({
							type: "tool_execution_end",
							toolCallId: "tool-yield",
							toolName: "yield",
							result: {
								content: [{ type: "text", text: "Result submitted." }],
								details: { status: "success", data: { ok: true } },
							},
							isError: false,
						} as AgentSessionEvent);
						listener({
							type: "agent_end",
							messages: [{ role: "assistant", content: [{ type: "text", text: lastAssistantText }] }],
						} as AgentSessionEvent);
					}
				});
			}
			if (options.hangPrompt && options.releasePrompt) await options.releasePrompt;
			return true;
		},
		waitForIdle: async () => {},
		getLastAssistantMessage: () => ({
			role: "assistant",
			content: [{ type: "text", text: lastAssistantText }],
		} as never),
		abort: async () => {},
		dispose: async () => {
			disposeCount += 1;
		},
		sendCustomMessage: (async (
			message: { content?: string | unknown[] },
			messageOptions?: { deliverAs?: "steer" | "followUp" | "nextTurn" },
		) => {
			notices.push({
				content: typeof message.content === "string" ? message.content : "",
				deliverAs: messageOptions?.deliverAs,
			});
			return false;
		}) as AgentSession["sendCustomMessage"],
	};
	return {
		session: session as AgentSession,
		emit: event => {
			for (const listener of [...listeners]) listener(event);
		},
		setLastAssistantText: text => {
			lastAssistantText = text;
		},
		notices,
		disposeCalls: () => disposeCount,
	};
}

function mockCreateAgentSession(session: AgentSession) {
	return vi.spyOn(sdkModule, "createAgentSession").mockResolvedValue({
		session,
		extensionsResult: {} as LoadExtensionsResult,
		setToolUIContext: () => {},
		eventBus: new EventBus(),
	} satisfies CreateAgentSessionResult);
}

function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content.find(part => part.type === "text")?.text ?? "";
}

function createToolSession(manager: AsyncJobManager, ownerId: string): ToolSession {
	return {
		asyncJobManager: manager,
		settings: Settings.isolated({}),
		getAgentId: () => ownerId,
	} as object as ToolSession;
}



describe("job result refresh and interrupt executor hooks", () => {
	beforeEach(() => {
		vi.spyOn(logger, "warn").mockImplementation(() => {});
		vi.spyOn(logger, "debug").mockImplementation(() => {});
		vi.spyOn(logger, "error").mockImplementation(() => {});
		AgentRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
	});

	it("refreshes a completed task job from a later agent_end turn", async () => {
		const harness = createSessionHarness({ autoYieldText: "initial result" });
		mockCreateAgentSession(harness.session);
		const completions: string[] = [];
		const manager = new AsyncJobManager({
			onJobComplete: async (_jobId, text) => {
				completions.push(text);
			},
		});

		const jobId = manager.register("task", "FreshSub", async ({ jobId: ownJobId, signal }) => {
			const result = await runSubprocess({
				...baseOptions,
				id: "FreshSub",
				signal,
				asyncJobManager: manager,
				asyncJobId: ownJobId,
			});
			return result.output;
		}, { id: "FreshSub", ownerId: "Main" });
		await manager.waitForAll();
		await manager.drainDeliveries({ timeoutMs: 2_000 });
		expect(manager.getJob(jobId)?.status).toBe("completed");

		harness.setLastAssistantText("follow-up answer");
		harness.emit({ type: "agent_end", messages: [] } as AgentSessionEvent);

		expect(manager.getJob(jobId)?.resultText).toBe("follow-up answer\n\n[refreshed after follow-up turn]");
		expect(completions).toHaveLength(1);
		expect(manager.hasPendingDeliveries()).toBe(false);
	});

	it("does not refresh isolated task jobs from later agent_end events", async () => {
		const harness = createSessionHarness({ autoYieldText: "isolated initial" });
		mockCreateAgentSession(harness.session);
		const manager = new AsyncJobManager({ onJobComplete: async () => {} });

		const jobId = manager.register("task", "IsoSub", async ({ jobId: ownJobId, signal }) => {
			const result = await runSubprocess({
				...baseOptions,
				id: "IsoSub",
				worktree: "/tmp/isolated-worktree",
				signal,
				asyncJobManager: manager,
				asyncJobId: ownJobId,
			});
			return result.output;
		}, { id: "IsoSub", ownerId: "Main" });
		await manager.waitForAll();
		const before = manager.getJob(jobId)?.resultText;

		harness.setLastAssistantText("isolated follow-up");
		harness.emit({ type: "agent_end", messages: [] } as AgentSessionEvent);

		expect(manager.getJob(jobId)?.resultText).toBe(before);
	});

	it("soft interrupt completes the job with marked partial text and keeps the agent idle", async () => {
		const releasePrompt = Promise.withResolvers<void>();
		const promptStarted = Promise.withResolvers<void>();
		const harness = createSessionHarness({
			hangPrompt: true,
			releasePrompt: releasePrompt.promise,
			promptStarted: () => promptStarted.resolve(),
		});
		mockCreateAgentSession(harness.session);
		AgentRegistry.global().register({ id: "InterruptSub", displayName: "InterruptSub", kind: "sub", session: harness.session });
		const manager = new AsyncJobManager({ onJobComplete: async () => {} });

		const jobId = manager.register("task", "InterruptSub", async ({ jobId: ownJobId, signal }) => {
			const result = await runSubprocess({
				...baseOptions,
				id: "InterruptSub",
				signal,
				asyncJobManager: manager,
				asyncJobId: ownJobId,
			});
			return result.output;
		}, { id: "InterruptSub", ownerId: "Main" });
		await promptStarted.promise;
		harness.setLastAssistantText("partial answer");
		expect(manager.interrupt(jobId, { ownerId: "Main" }, "operator stop")).toBe(true);
		releasePrompt.resolve();
		await manager.waitForAll();

		const job = manager.getJob(jobId);
		expect(job?.status).toBe("completed");
		expect(job?.interrupted).toBe(true);
		expect(job?.resultText).toBe("[interrupted: operator stop]\n\npartial answer");
		expect(AgentRegistry.global().get("InterruptSub")?.status).toBe("idle");
		expect(AgentLifecycleManager.global().has("InterruptSub")).toBe(true);
		expect(harness.disposeCalls()).toBe(0);
		expect(harness.notices).toEqual([
			{
				content:
					"<system-warning>Your turn was interrupted by Main (reason: operator stop). Your session is alive; you may be woken via irc to continue.</system-warning>",
				deliverAs: "nextTurn",
			},
		]);
	});

	it("hard cancel still aborts the job and disposes the session", async () => {
		const releasePrompt = Promise.withResolvers<void>();
		const promptStarted = Promise.withResolvers<void>();
		const harness = createSessionHarness({
			hangPrompt: true,
			releasePrompt: releasePrompt.promise,
			promptStarted: () => promptStarted.resolve(),
		});
		mockCreateAgentSession(harness.session);
		AgentRegistry.global().register({ id: "CancelSub", displayName: "CancelSub", kind: "sub", session: harness.session });
		const manager = new AsyncJobManager({ onJobComplete: async () => {} });

		const jobId = manager.register("task", "CancelSub", async ({ signal }) => {
			const result = await runSubprocess({
				...baseOptions,
				id: "CancelSub",
				signal,
			});
			return result.output;
		}, { id: "CancelSub", ownerId: "Main" });
		await promptStarted.promise;
		expect(manager.cancel(jobId, { ownerId: "Main" })).toBe(true);
		releasePrompt.resolve();
		await manager.waitForAll();

		expect(manager.getJob(jobId)?.status).toBe("cancelled");
		expect(AgentRegistry.global().get("CancelSub")?.status).toBe("aborted");
		expect(AgentLifecycleManager.global().has("CancelSub")).toBe(false);
		expect(harness.disposeCalls()).toBe(1);
		expect(harness.notices).toEqual([]);
	});

	it("hard cancel after soft interrupt overrides keep-alive and suppresses delivery", async () => {
		const releasePrompt = Promise.withResolvers<void>();
		const promptStarted = Promise.withResolvers<void>();
		const harness = createSessionHarness({
			hangPrompt: true,
			releasePrompt: releasePrompt.promise,
			promptStarted: () => promptStarted.resolve(),
		});
		mockCreateAgentSession(harness.session);
		AgentRegistry.global().register({
			id: "CancelAfterInterruptSub",
			displayName: "CancelAfterInterruptSub",
			kind: "sub",
			session: harness.session,
		});
		const completions: string[] = [];
		const manager = new AsyncJobManager({
			onJobComplete: async (_jobId, text) => {
				completions.push(text);
			},
		});

		const jobId = manager.register(
			"task",
			"CancelAfterInterruptSub",
			async ({ jobId: ownJobId, signal }) => {
				const result = await runSubprocess({
					...baseOptions,
					id: "CancelAfterInterruptSub",
					signal,
					asyncJobManager: manager,
					asyncJobId: ownJobId,
				});
				return result.output;
			},
			{ id: "CancelAfterInterruptSub", ownerId: "Main" },
		);
		await promptStarted.promise;
		harness.setLastAssistantText("partial answer before hard cancel");
		expect(manager.interrupt(jobId, { ownerId: "Main" }, "operator stop")).toBe(true);

		const cancelResult = await new JobTool(createToolSession(manager, "Main")).execute(
			"job-cancel-after-interrupt",
			{ cancel: [jobId] },
		);
		expect(firstText(cancelResult)).toContain("Cancelled background job CancelAfterInterruptSub.");
		expect(cancelResult.details?.cancelled).toEqual([{ id: jobId, status: "cancelled" }]);

		releasePrompt.resolve();
		await manager.waitForAll();
		await manager.drainDeliveries({ timeoutMs: 50 });

		const job = manager.getJob(jobId);
		expect(job?.status).toBe("cancelled");
		expect(job?.hardCancelled).toBe(true);
		expect(job?.interrupted).toBeUndefined();
		expect(completions).toEqual([]);
		expect(AgentRegistry.global().get("CancelAfterInterruptSub")?.status).toBe("aborted");
		expect(AgentLifecycleManager.global().has("CancelAfterInterruptSub")).toBe(false);
		expect(harness.disposeCalls()).toBe(1);
		expect(harness.notices).toEqual([]);
	});

	it("rejects interrupt for isolated jobs while leaving cancel available", async () => {
		const manager = new AsyncJobManager({ onJobComplete: async () => {} });
		const jobId = manager.register(
			"task",
			"IsolatedSub",
			async ({ signal }) => {
				await new Promise<never>((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
				});
				throw new Error("unreachable");
			},
			{ id: "IsolatedSub", ownerId: "Main", isolated: true },
		);
		const tool = new JobTool(createToolSession(manager, "Main"));

		const interruptResult = await tool.execute("job-interrupt-isolated", { interrupt: [jobId] });
		expect(firstText(interruptResult)).toContain(
			"Background job IsolatedSub is isolated — interrupt cannot keep it alive; use cancel.",
		);
		expect(interruptResult.details?.interrupted).toEqual([{ id: jobId, status: "isolated" }]);
		expect(manager.getJob(jobId)?.interruptRequested).toBeUndefined();

		const cancelResult = await tool.execute("job-cancel-isolated", { cancel: [jobId] });
		expect(firstText(cancelResult)).toContain("Cancelled background job IsolatedSub.");
		expect(cancelResult.details?.cancelled).toEqual([{ id: jobId, status: "cancelled" }]);
		await manager.waitForAll();
		expect(manager.getJob(jobId)?.status).toBe("cancelled");
	});
});
