import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { Effect } from "effect";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import {
	RunnerRevisionConflictError,
	StaleRunnerControllerLeaseError,
	type AttachRunnerViewCommand,
	type DetachRunnerViewCommand,
	type RunnerControlMetadata,
} from "../../src/runner/protocol";
import { makeSessionRunnerLive } from "../../src/runner/session-runner";
import { AgentSession } from "../../src/session/agent-session";
import { AuthStorage } from "../../src/session/auth-storage";
import { DurableInputQueue } from "../../src/session/durable-input-queue";
import { SessionManager } from "../../src/session/session-manager";
import { acquireSessionOwnership } from "../../src/session/session-ownership";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const metadata = (commandId: string, expectedRevision: number): RunnerControlMetadata => ({
	schemaVersion: 1,
	commandId,
	correlationId: `correlation-${commandId}`,
	expectedRevision,
});

const attach = (
	viewId: string,
	capability: "observer" | "controller",
	expectedRevision: number,
): AttachRunnerViewCommand => ({
	...metadata(`attach-${viewId}`, expectedRevision),
	kind: "attachView",
	viewId,
	capability,
});

const detach = (viewId: string, expectedRevision: number, controllerEpoch?: number): DetachRunnerViewCommand => ({
	...metadata(`detach-${viewId}`, expectedRevision),
	kind: "detachView",
	viewId,
	...(controllerEpoch === undefined ? {} : { controllerEpoch }),
});

const submit = (viewId: string, controllerEpoch: number, commandId: string, expectedRevision: number) => ({
	...metadata(commandId, expectedRevision),
	kind: "submitInput" as const,
	viewId,
	controllerEpoch,
	payload: { text: `input-${commandId}` },
});

async function createLiveFixture() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-runner-"));
	roots.push(root);
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
	const providerInputs: string[] = [];
	const agent = new Agent({
		initialState: { model, systemPrompt: ["test"], tools: [], messages: [] },
		streamFn: (_model, context) => {
			const lastUser = [...context.messages].reverse().find((message) => message.role === "user");
			const text =
				typeof lastUser?.content === "string"
					? lastUser.content
					: lastUser?.content?.find((part) => part.type === "text")?.text;
			providerInputs.push(text ?? "");
			const stream = new AssistantMessageEventStream();
			const message: AssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "accepted" }],
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
			queueMicrotask(() => {
				stream.push({ type: "start", partial: message });
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		},
	});
	const sessionManager = SessionManager.create(project, sessions);
	await sessionManager.flush();
	const sessionFile = sessionManager.getSessionFile();
	if (!sessionFile) throw new Error("persistent test session has no file");
	const ownership = await acquireSessionOwnership(sessionFile, sessionManager.getSessionId(), {
		root: muxRoot,
	});
	sessionManager.bindSessionOwnership(ownership);
	const queue = await DurableInputQueue.open(ownership, muxRoot);
	await queue.adopt();
	const session = new AgentSession({
		agent,
		sessionManager,
		durableInputQueue: queue,
		settings: Settings.isolated({ "compaction.enabled": false }),
		modelRegistry,
	});
	return { root, muxRoot, sessionFile, ownership, queue, session, sessionManager, providerInputs };
}

describe("live SessionRunner", () => {
	it("uses queue and transcript authority across replay, fencing, resync, detach, and stop", async () => {
		const fixture = await createLiveFixture();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 1 });
					const observer = yield* runner.attachView(attach("observer", "observer", 0));
					const controller = yield* runner.attachView(attach("controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("expected controller");

					const command = submit(controller.viewId, controller.controllerEpoch, "duplicate", 0);
					const first = yield* controller.submitInput(command);
					const replay = yield* controller.submitInput(command);
					expect(first.replayed).toBe(false);
					expect(replay).toEqual({ ...first, replayed: true });
					expect(first.durableSequence).toBe(1);
					expect(first.revision).toBe(1);
					expect((yield* Effect.promise(() => fixture.queue.list())).filter((item) => item.inputId === first.inputId)).toHaveLength(1);

					const stale = yield* Effect.flip(
						controller.submitInput(submit(controller.viewId, controller.controllerEpoch, "stale", 0)),
					);
					expect(stale).toBeInstanceOf(RunnerRevisionConflictError);

					const released = yield* controller.releaseController({
						...metadata("release-controller", 1),
						kind: "releaseController",
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
					});
					const replacement = yield* released.acquireController({
						...metadata("reacquire-controller", 1),
						kind: "acquireController",
						viewId: released.viewId,
					});
					const fenced = yield* Effect.flip(
						controller.submitInput(submit(controller.viewId, controller.controllerEpoch, "fenced", 1)),
					);
					expect(fenced).toBeInstanceOf(StaleRunnerControllerLeaseError);

					yield* Effect.promise(() => fixture.session.waitForIdle());
					expect(fixture.providerInputs).toEqual(["input-duplicate"]);

					const transcriptSubscription = yield* observer.subscribe();
					fixture.sessionManager.appendMessage({ role: "user", content: "transcript-race", timestamp: Date.now() });
					const transcriptDelivery = yield* transcriptSubscription.take;
					expect(transcriptDelivery.event.kind).toBe("transcriptEntryAppended");
					const transcriptSnapshot = yield* observer.snapshot();
					expect(transcriptSnapshot.transcript.lastEntryId).toBe(transcriptDelivery.event.transcriptEntryId);

					const lagging = yield* observer.subscribe();
					const extraA = yield* runner.attachView(attach("extra-a", "observer", 1));
					yield* extraA.detach(detach("extra-a", 1));
					const extraB = yield* runner.attachView(attach("extra-b", "observer", 1));
					yield* extraB.detach(detach("extra-b", 1));
					expect((yield* lagging.take).kind).toBe("resyncRequired");

					yield* observer.detach(detach("observer", 1));
					expect((yield* runner.snapshot()).status).toBe("running");
					yield* replacement.detach(detach(replacement.viewId, 1, replacement.controllerEpoch));
					yield* Effect.all([runner.stop(), runner.stop()], { concurrency: "unbounded", discard: true });
					expect((yield* runner.snapshot()).status).toBe("stopped");
				}),
			),
		);

		const replacementOwnership = await acquireSessionOwnership(
			fixture.sessionFile,
			fixture.sessionManager.getSessionId(),
			{ root: fixture.muxRoot },
		);
		expect(await replacementOwnership.isCurrent()).toBe(true);
		await replacementOwnership.release();
	});
});
