import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { LoadExtensionsResult } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import type { CreateAgentSessionResult } from "@oh-my-pi/pi-coding-agent/sdk";
import * as sdkModule from "@oh-my-pi/pi-coding-agent/sdk";
import type { AgentSession, AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { formatResultOutputFallback } from "@oh-my-pi/pi-coding-agent/task";
import { runSubprocess } from "@oh-my-pi/pi-coding-agent/task/executor";
import { subprocessToolRegistry } from "@oh-my-pi/pi-coding-agent/task/subprocess-tool-registry";
import type { AgentDefinition } from "@oh-my-pi/pi-coding-agent/task/types";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";
import { logger } from "@oh-my-pi/pi-utils";
import "@oh-my-pi/pi-coding-agent/tools/yield";

/**
 * Contract: runaway-subagent guards.
 *
 * 1. The executor counts assistant requests (message_end events) and surfaces
 *    the count on `SingleResult.requests`.
 * 2. Crossing the soft request budget injects exactly ONE steering notice into
 *    the child session asking it to wrap up; crossing 1.5x the budget aborts
 *    the run gracefully.
 * 3. A cancelled/aborted child that produced no completed output salvages its
 *    last assistant text into a `[cancelled after N req, …]` summary instead
 *    of the parent seeing "(no output)" and redoing the work.
 */

interface SteerCall {
	content: string;
	options?: { deliverAs?: "steer" | "followUp" };
}
interface FakeSessionConfig {
	/** Events pushed to the executor's subscriber on the next microtask. */
	events?: AgentSessionEvent[];
	/** When true, prompt/waitForIdle hang until abort() is called. */
	hang?: boolean;
	/** When true, prompt returns immediately and waitForIdle hangs until releaseIdle() or abort() is called. */
	holdIdle?: boolean;
	/** When true, events are pushed synchronously in subscribe() instead of on a microtask. */
	syncEvents?: boolean;
	/** Called when getLastAssistantMessage is read. */
	onLastAssistantMessage?: () => void;
	/** Returned from getLastAssistantMessage (salvage source). */
	lastAssistantMessage?: unknown;
}

interface FakeSessionHandle {
	session: AgentSession;
	steerCalls: SteerCall[];
	abortCalls: () => number;
	releaseIdle?: () => void;
	promptStarted: Promise<void>;
	waitForIdleStarted: Promise<void>;
}

function assistantMessageEnd(text: string, usage?: Record<string, number>): AgentSessionEvent {
	return {
		type: "message_end",
		message: {
			role: "assistant",
			content: text ? [{ type: "text", text }] : [],
			usage: usage ?? { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 },
		},
	} as unknown as AgentSessionEvent;
}

function yieldToolEnd(): AgentSessionEvent {
	return {
		type: "tool_execution_end",
		toolCallId: "tool-yield",
		toolName: "yield",
		result: {
			content: [{ type: "text", text: "Result submitted." }],
			details: { status: "success", data: { ok: true } },
		},
		isError: false,
	} as unknown as AgentSessionEvent;
}

function createFakeSession(config: FakeSessionConfig = {}): FakeSessionHandle {
	let abortCount = 0;
	const steerCalls: SteerCall[] = [];
	const { promise: hang, resolve: releaseHang } = Promise.withResolvers<void>();
	const { promise: idleHang, resolve: releaseIdleHang } = Promise.withResolvers<void>();
	const { promise: promptStarted, resolve: resolvePromptStarted } = Promise.withResolvers<void>();
	const { promise: waitForIdleStarted, resolve: resolveWaitForIdleStarted } = Promise.withResolvers<void>();
	if (!config.hang) releaseHang();
	if (!config.holdIdle) releaseIdleHang();

	const session: Partial<AgentSession> = {
		state: { messages: [] } as never,
		agent: { state: { systemPrompt: ["test"] } } as never,
		extensionRunner: undefined as never,
		sessionManager: { appendSessionInit: () => {} } as never,
		getActiveToolNames: () => ["read", "yield"],
		setActiveToolsByName: async (_names: string[]) => {},
		subscribe: (listener: (event: AgentSessionEvent) => void) => {
			if (config.events?.length) {
				const events = config.events;
				if (config.syncEvents) {
					for (const event of events) listener(event);
				} else {
					queueMicrotask(() => {
						for (const event of events) listener(event);
					});
				}
			}
			return () => {};
		},
		prompt: async () => {
			resolvePromptStarted();
			await hang;
			return true;
		},
		waitForIdle: async () => {
			resolveWaitForIdleStarted();
			await hang;
			await idleHang;
		},
		sendUserMessage: async (content, options) => {
			steerCalls.push({ content: String(content), options });
		},
		getLastAssistantMessage: () => {
			config.onLastAssistantMessage?.();
			return (config.lastAssistantMessage ?? undefined) as never;
		},
		abort: async () => {
			abortCount += 1;
			releaseHang();
			releaseIdleHang();
		},
		dispose: async () => {},
	};
	return {
		session: session as AgentSession,
		steerCalls,
		abortCalls: () => abortCount,
		releaseIdle: releaseIdleHang,
		promptStarted,
		waitForIdleStarted,
	};
}

function mockCreateAgentSession(session: AgentSession) {
	return vi.spyOn(sdkModule, "createAgentSession").mockResolvedValue({
		session,
		extensionsResult: {} as unknown as LoadExtensionsResult,
		setToolUIContext: () => {},
		eventBus: new EventBus(),
	} satisfies CreateAgentSessionResult);
}

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
	id: "subagent-guards",
	modelRegistry: { refresh: async () => {} } as unknown as ModelRegistry,
	enableLsp: false,
};

describe("runSubprocess request guards", () => {
	beforeEach(() => {
		vi.spyOn(logger, "warn").mockImplementation(() => {});
		vi.spyOn(logger, "debug").mockImplementation(() => {});
		vi.spyOn(logger, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("counts assistant requests into SingleResult.requests", async () => {
		const settings = Settings.isolated({ "task.maxRuntimeMs": 0 });
		const handle = createFakeSession({
			events: [
				assistantMessageEnd("step one"),
				assistantMessageEnd("step two"),
				assistantMessageEnd("step three"),
				yieldToolEnd(),
			],
		});
		mockCreateAgentSession(handle.session);

		const result = await runSubprocess({ ...baseOptions, id: "subagent-requests", settings });

		expect(result.aborted).toBe(false);
		expect(result.requests).toBe(3);
		// Well under any budget: no steer injected.
		expect(handle.steerCalls.length).toBe(0);
	});

	it("injects exactly one steering notice when the soft budget is crossed", async () => {
		// Budget 4: steer fires at request 4 and must not repeat at request 5
		// (still below the 1.5x hard stop of 6).
		const settings = Settings.isolated({ "task.maxRuntimeMs": 0, "task.softRequestBudget": 4 });
		const handle = createFakeSession({
			events: [
				assistantMessageEnd("1"),
				assistantMessageEnd("2"),
				assistantMessageEnd("3"),
				assistantMessageEnd("4"),
				assistantMessageEnd("5"),
				yieldToolEnd(),
			],
		});
		mockCreateAgentSession(handle.session);

		const result = await runSubprocess({ ...baseOptions, id: "subagent-steer", settings });

		expect(result.requests).toBe(5);
		expect(result.aborted).toBe(false);
		expect(handle.steerCalls.length).toBe(1);
		expect(handle.steerCalls[0].content).toContain("[budget notice]");
		expect(handle.steerCalls[0].content).toContain("4 requests");
		expect(handle.steerCalls[0].options?.deliverAs).toBe("steer");
	});

	it("aborts the run gracefully at 1.5x the soft budget", async () => {
		// Budget 2: steer at 2, hard stop at 3. The session hangs so only the
		// budget abort can release it.
		const settings = Settings.isolated({ "task.maxRuntimeMs": 0, "task.softRequestBudget": 2 });
		const handle = createFakeSession({
			hang: true,
			events: [
				assistantMessageEnd("", { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 }),
				assistantMessageEnd("", { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 }),
				assistantMessageEnd("", { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 }),
			],
		});
		mockCreateAgentSession(handle.session);

		const result = await runSubprocess({ ...baseOptions, id: "subagent-hard-stop", settings });

		expect(result.aborted).toBe(true);
		expect(result.exitCode).toBe(1);
		expect(result.abortReason).toContain("request budget exceeded");
		expect(handle.abortCalls()).toBeGreaterThanOrEqual(1);
		expect(handle.steerCalls.length).toBe(1);
	});

	it("salvages the last assistant text for an aborted child with no completed output", async () => {
		const settings = Settings.isolated({ "task.maxRuntimeMs": 50 });
		const handle = createFakeSession({
			hang: true,
			events: [
				// One completed assistant turn with usage but no text content:
				// counts a request and tokens without producing output chunks.
				assistantMessageEnd("", { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 }),
			],
			lastAssistantMessage: {
				role: "assistant",
				stopReason: "aborted",
				content: [{ type: "text", text: "Reading   the\n\tconfig loader before patching" }],
			},
		});
		mockCreateAgentSession(handle.session);

		const result = await runSubprocess({ ...baseOptions, id: "subagent-salvage", settings });

		expect(result.aborted).toBe(true);
		expect(result.requests).toBe(1);
		expect(result.output).toContain("cancelled after 1 req");
		expect(result.output).toContain("150 tok");
		expect(result.output).toContain("last activity:");
		// Whitespace is flattened so the snippet stays a single line.
		expect(result.output).toContain("Reading the config loader before patching");
		expect(result.output).not.toContain("\n");
	});

	it("clips oversized salvage snippets", async () => {
		const settings = Settings.isolated({ "task.maxRuntimeMs": 50 });
		const longText = `start-marker ${"x".repeat(700)}`;
		const handle = createFakeSession({
			hang: true,
			lastAssistantMessage: {
				role: "assistant",
				stopReason: "aborted",
				content: [{ type: "text", text: longText }],
			},
		});
		mockCreateAgentSession(handle.session);

		const result = await runSubprocess({ ...baseOptions, id: "subagent-salvage-clip", settings });

		expect(result.output).toContain("start-marker");
		expect(result.output).toContain("…");
		expect(result.output).not.toContain(longText);
		expect(result.output.length).toBeLessThan(700);
	});

	it("keeps a successful yield as completed when abort arrives after terminal idle", async () => {
		// Deterministic held-idle race: the yield payload has already been captured
		// and the session reached idle, then the parent signal aborts before
		// finalization. The terminal winner must be the completed yield.
		const settings = Settings.isolated({ "task.maxRuntimeMs": 0 });
		const abortController = new AbortController();
		const realYieldHandler = subprocessToolRegistry.getHandler("yield");
		if (!realYieldHandler?.extractData) throw new Error("yield subprocess handler is not registered");
		subprocessToolRegistry.register("yield", { extractData: realYieldHandler.extractData });
		try {
			const handle = createFakeSession({
				holdIdle: true,
				syncEvents: true,
				events: [yieldToolEnd()],
				lastAssistantMessage: { role: "assistant", stopReason: "end_turn", content: [] },
				onLastAssistantMessage: () => abortController.abort(),
			});
			mockCreateAgentSession(handle.session);

			const resultPromise = runSubprocess({
				...baseOptions,
				id: "subagent-post-terminal-abort",
				settings,
				signal: abortController.signal,
			});

			await handle.waitForIdleStarted;
			handle.releaseIdle?.();

			const result = await resultPromise;

			expect(result.exitCode).toBe(0);
			expect(result.aborted).toBe(false);
			expect(result.abortReason).toBeUndefined();
			expect(result.error).toBeUndefined();
			expect(result.output).toBe('{\n  "ok": true\n}');
		} finally {
			subprocessToolRegistry.register("yield", realYieldHandler);
		}
	});

	it("fails with a reason when abort arrives before terminal completion", async () => {
		const settings = Settings.isolated({ "task.maxRuntimeMs": 0 });
		const handle = createFakeSession({
			hang: true,
			events: [assistantMessageEnd("still thinking")],
		});
		mockCreateAgentSession(handle.session);

		const abortController = new AbortController();
		const resultPromise = runSubprocess({
			...baseOptions,
			id: "subagent-pre-terminal-abort",
			settings,
			signal: abortController.signal,
		});

		await handle.promptStarted;
		abortController.abort();

		const result = await resultPromise;

		expect(result.exitCode).toBe(1);
		expect(result.aborted).toBe(true);
		expect(result.abortReason).toBeTruthy();
	});

	it("formats the (no output) fallback with the request count", () => {
		expect(formatResultOutputFallback({ output: "", stderr: "", requests: 7 })).toBe("(no output) after 7 req");
		expect(formatResultOutputFallback({ output: "  ", stderr: "", requests: 0 })).toBe("(no output)");
		expect(formatResultOutputFallback({ output: "real output", stderr: "", requests: 7 })).toBe("real output");
		expect(formatResultOutputFallback({ output: "", stderr: "boom", requests: 7 })).toBe("boom");
	});
});
