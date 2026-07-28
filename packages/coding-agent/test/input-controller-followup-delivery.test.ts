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
import { InputController } from "@oh-my-pi/pi-coding-agent/modes/controllers/input-controller";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { DurableInputQueue } from "@oh-my-pi/pi-coding-agent/session/durable-input-queue";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { acquireSessionOwnership } from "@oh-my-pi/pi-coding-agent/session/session-ownership";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";

const roots: string[] = [];
const TEST_BUILD_REVISION = { digest: "0".repeat(64), version: "follow-up-delivery-test" };
const TEST_RUNNER_INSTANCE_IDENTITY = {
	runnerInstanceId: "00000000-0000-4000-8000-000000000008",
	startedAt: "2026-01-01T00:00:00.000Z",
};

interface FollowUpFixture {
	session: AgentSession;
	queue: DurableInputQueue;
	providerStarted: Promise<void>;
	releaseFirstProvider: () => void;
	providerCalls: string[];
	getProviderAbortCount: () => number;
	close: () => Promise<void>;
}

async function createFixture(root: string): Promise<FollowUpFixture> {
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
	const firstProviderRelease = Promise.withResolvers<void>();
	const providerCalls: string[] = [];
	let providerAbortCount = 0;
	let closed = false;

	function assistantMessage(text: string): AssistantMessage {
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
			stopReason: "stop",
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
			const message = assistantMessage(providerCalls.length === 1 ? "first completed" : "follow-up completed");
			if (providerCalls.length === 1) {
				options?.signal?.addEventListener(
					"abort",
					() => {
						providerAbortCount++;
					},
					{ once: true },
				);
				queueMicrotask(() => {
					stream.push({ type: "start", partial: message });
					providerStarted.resolve();
				});
				firstProviderRelease.promise.then(() => {
					stream.push({ type: "done", reason: "stop", message });
				});
				return stream;
			}
			queueMicrotask(() => {
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

	return {
		session,
		queue,
		providerStarted: providerStarted.promise,
		releaseFirstProvider: () => firstProviderRelease.resolve(),
		providerCalls,
		getProviderAbortCount: () => providerAbortCount,
		async close() {
			if (closed) return;
			closed = true;
			firstProviderRelease.resolve();
			await session.dispose();
			await authStorage.close();
			await ownership.release();
			externalIrcBus.close();
		},
	};
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("InputController follow-up delivery", () => {
	it("queues Ctrl-Enter follow-ups at the turn boundary without steering", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-follow-up-delivery-"));
		roots.push(root);
		const fixture = await createFixture(root);
		const editor = {
			text: "",
			getText: () => editor.text,
			setText: (text: string) => {
				editor.text = text;
			},
			addToHistory: (_text: string) => {},
		};
		const ctx = {
			session: fixture.session,
			sessionManager: fixture.session.sessionManager,
			focusedAgentId: undefined,
			collabGuest: undefined,
			editor,
			pendingImages: [],
			pendingImageLinks: [],
			withLocalSubmission: async <T>(_: string, fn: () => Promise<T>) => fn(),
			updatePendingMessagesDisplay: () => {},
			ui: { requestRender: () => {} },
			showError: (error: unknown) => {
				throw error;
			},
		} as never;
		const controller = new InputController(ctx);

		try {
			const activeTurn = fixture.session.prompt("active provider turn");
			await fixture.providerStarted;
			editor.text = "follow-up entered with Ctrl-Enter";

			await controller.handleFollowUp();
			const queued = fixture.session
				.getQueuedInputProjection()
				.find(item => item.payload.kind === "user" && item.payload.text === "follow-up entered with Ctrl-Enter");
			if (!queued) throw new Error("follow-up was not queued");
			expect(queued.deliveryClass).toBe("followUp");
			expect(fixture.providerCalls).toEqual(["active provider turn"]);
			expect(fixture.getProviderAbortCount()).toBe(0);
			expect(editor.text).toBe("");

			fixture.releaseFirstProvider();
			await activeTurn;
			await fixture.session.waitForIdle();
			expect(fixture.providerCalls).toEqual(["active provider turn", "follow-up entered with Ctrl-Enter"]);
			expect((await fixture.queue.list()).find(item => item.inputId === queued.inputId)?.state).toBe("completed");
		} finally {
			await fixture.close();
		}
	}, 10_000);
});
