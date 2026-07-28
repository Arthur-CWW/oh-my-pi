import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { DurableInputQueue } from "@oh-my-pi/pi-coding-agent/session/durable-input-queue";
import { USER_INTERRUPT_LABEL } from "@oh-my-pi/pi-coding-agent/session/messages";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { acquireSessionOwnership } from "@oh-my-pi/pi-coding-agent/session/session-ownership";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";

const roots: string[] = [];
const TEST_BUILD_REVISION = { digest: "0".repeat(64), version: "durable-input-interrupt-test" };
const TEST_RUNNER_INSTANCE_IDENTITY = {
	runnerInstanceId: "00000000-0000-4000-8000-000000000007",
	startedAt: "2026-01-01T00:00:00.000Z",
};
let closeFixture: (() => Promise<void>) | undefined;

function durableAttemptEntries(sessionManager: SessionManager): Array<Record<string, unknown>> {
	const entries: Array<Record<string, unknown>> = [];
	for (const entry of sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== "durable_input_attempt") continue;
		const data = entry.data;
		if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
		entries.push(data as Record<string, unknown>);
	}
	return entries;
}

async function createFixture(root: string) {
	const project = path.join(root, "project");
	const sessions = path.join(root, "sessions");
	const muxRoot = path.join(root, "mux");
	await fs.mkdir(project, { recursive: true });
	await fs.mkdir(sessions, { recursive: true });

	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("test model unavailable");
	const authStorage = await AuthStorage.create(path.join(root, "auth.db"));
	authStorage.setRuntimeApiKey(model.provider, "test-key");
	const modelRegistry = new ModelRegistry(authStorage, path.join(root, "models.yml"));
	const sessionManager = SessionManager.create(project, sessions);
	await sessionManager.flush();
	const sessionFile = sessionManager.getSessionFile();
	if (!sessionFile) throw new Error("test session file unavailable");
	const ownership = await acquireSessionOwnership(sessionFile, sessionManager.getSessionId(), {
		root: muxRoot,
		buildRevision: TEST_BUILD_REVISION,
		runnerInstanceIdentity: TEST_RUNNER_INSTANCE_IDENTITY,
	});
	sessionManager.bindSessionOwnership(ownership);
	const queue = await DurableInputQueue.open(ownership, muxRoot);
	await queue.adopt();
	const externalIrcBus = new IrcExternalBus(path.join(root, "irc-bus.sqlite"));

	const providerStarted = Promise.withResolvers<void>();
	const providerAborted = Promise.withResolvers<void>();
	const providerAbortReleased = Promise.withResolvers<void>();
	const providerCalls: string[] = [];
	const providerAbortReasons: unknown[] = [];

	function assistantMessage(text: string, stopReason: "stop" | "aborted", errorMessage?: string): AssistantMessage {
		return {
			role: "assistant",
			content: text ? [{ type: "text", text }] : [],
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
			stopReason,
			...(errorMessage === undefined ? {} : { errorMessage }),
			timestamp: Date.now(),
		};
	}

	const agent = new Agent({
		getApiKey: () => "test-key",
		initialState: { model, systemPrompt: ["test"], tools: [], messages: [] },
		streamFn: (_streamModel, context, options) => {
			const lastUser = [...context.messages].reverse().find(message => message.role === "user");
			const text =
				typeof lastUser?.content === "string"
					? lastUser.content
					: lastUser?.content?.find(part => part.type === "text")?.text;
			providerCalls.push(text ?? "");
			const stream = new AssistantMessageEventStream();

			if (providerCalls.length === 1) {
				let settled = false;
				const onAbort = () => {
					if (settled) return;
					settled = true;
					const reason = options?.signal?.reason;
					providerAbortReasons.push(reason);
					const message = assistantMessage(
						"interrupted",
						"aborted",
						typeof reason === "string" ? reason : USER_INTERRUPT_LABEL,
					);
					providerAbortReleased.promise.then(() => {
						stream.push({ type: "error", reason: "aborted", error: message });
					});
					providerAborted.resolve();
				};
				options?.signal?.addEventListener("abort", onAbort, { once: true });
				queueMicrotask(() => {
					stream.push({ type: "start", partial: assistantMessage("", "stop") });
					providerStarted.resolve();
					if (options?.signal?.aborted) onAbort();
				});
				return stream;
			}

			queueMicrotask(() => {
				const message = assistantMessage("follow-up completed", "stop");
				stream.push({ type: "start", partial: message });
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		},
	});
	const session = new AgentSession({
		agent,
		sessionManager,
		durableInputQueue: queue,
		settings: Settings.isolated({ "compaction.enabled": false }),
		modelRegistry,
		externalIrcBus,
	});

	let closed = false;
	return {
		session,
		sessionManager,
		queue,
		providerCalls,
		providerAbortReasons,
		providerStarted: providerStarted.promise,
		providerAborted: providerAborted.promise,
		releaseProviderAbort: () => providerAbortReleased.resolve(),
		async close() {
			if (closed) return;
			closed = true;
			providerAbortReleased.resolve();
			await session.dispose();
			await sessionManager.close();
			authStorage.close();
			await ownership.release();
			externalIrcBus.close();
		},
	};
}

afterEach(async () => {
	await closeFixture?.();
	closeFixture = undefined;
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("AgentSession durable input user interrupt", () => {
	it("drains one queued follow-up after the interrupted provider turn settles", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-agent-session-durable-interrupt-"));
		roots.push(root);
		const fixture = await createFixture(root);
		closeFixture = fixture.close;

		try {
			const activeTurn = fixture.session.prompt("active provider turn");
			await fixture.providerStarted;

			const followUpText = "durable follow-up: orchestrate everything";
			await fixture.session.prompt(followUpText, { streamingBehavior: "followUp" });
			const queued = fixture.session
				.getQueuedInputProjection()
				.find(item => item.payload.kind === "user" && item.payload.text === followUpText);
			if (!queued) throw new Error("durable follow-up was not queued");

			const aborting = fixture.session.abort({ reason: USER_INTERRUPT_LABEL });
			await fixture.providerAborted;
			fixture.releaseProviderAbort();
			await Promise.all([aborting, activeTurn]);
			await fixture.session.waitForIdle();

			expect(fixture.providerAbortReasons).toEqual([USER_INTERRUPT_LABEL]);
			expect(fixture.providerCalls).toEqual(["active provider turn", followUpText]);
			expect(fixture.providerCalls.filter(call => call === followUpText)).toHaveLength(1);

			const item = (await fixture.queue.list()).find(candidate => candidate.inputId === queued.inputId);
			expect(item?.state).toBe("completed");

			const attempts = durableAttemptEntries(fixture.sessionManager).filter(entry => entry.inputId === queued.inputId);
			expect(attempts.map(entry => entry.state)).toEqual(["admitted", "request-started", "completed"]);
			expect(new Set(attempts.map(entry => entry.attemptId)).size).toBe(1);
		} finally {
			await fixture.close();
			closeFixture = undefined;
		}
	}, 10_000);
	it("waits for overlapping aborts before draining a queued follow-up", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-agent-session-durable-overlap-"));
		roots.push(root);
		const fixture = await createFixture(root);
		closeFixture = fixture.close;

		try {
			const activeTurn = fixture.session.prompt("active provider turn");
			await fixture.providerStarted;

			const followUpText = "durable follow-up: overlap";
			await fixture.session.prompt(followUpText, { streamingBehavior: "followUp" });
			const queued = fixture.session
				.getQueuedInputProjection()
				.find(item => item.payload.kind === "user" && item.payload.text === followUpText);
			if (!queued) throw new Error("durable follow-up was not queued");

			const firstAbort = fixture.session.abort({ reason: USER_INTERRUPT_LABEL });
			const secondAbort = fixture.session.abort({ reason: USER_INTERRUPT_LABEL });
			await fixture.providerAborted;
			expect(fixture.providerCalls).toEqual(["active provider turn"]);

			fixture.releaseProviderAbort();
			await firstAbort;
			await Bun.sleep(0);
			expect(fixture.providerCalls).toEqual(["active provider turn"]);

			await Promise.all([secondAbort, activeTurn]);
			await fixture.session.waitForIdle();

			expect(fixture.providerAbortReasons).toEqual([USER_INTERRUPT_LABEL]);
			expect(fixture.providerCalls).toEqual(["active provider turn", followUpText]);
			expect(fixture.providerCalls.filter(call => call === followUpText)).toHaveLength(1);

			const item = (await fixture.queue.list()).find(candidate => candidate.inputId === queued.inputId);
			expect(item?.state).toBe("completed");

			const attempts = durableAttemptEntries(fixture.sessionManager).filter(entry => entry.inputId === queued.inputId);
			expect(attempts.map(entry => entry.state)).toEqual(["admitted", "request-started", "completed"]);
			expect(new Set(attempts.map(entry => entry.attemptId)).size).toBe(1);
		} finally {
			await fixture.close();
			closeFixture = undefined;
		}
	}, 10_000);
});
