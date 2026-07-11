import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Agent, ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { type AssistantMessage, Effort } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import * as autoThinkingClassifier from "../../src/auto-thinking/classifier";
import { Effect, Exit, Fiber, Scope } from "effect";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { createTerminalSessionController } from "../../src/modes/terminal-session-controller";
import {
	decodeSubmitInputCommand,
	decodeSetModelCommand,
	decodeSetThinkingLevelCommand,
	RunnerRevisionConflictError,
	RunnerItemRevisionConflictError,
	StaleRunnerControllerLeaseError,
	SessionRunnerRuntimeError,
	type AttachRunnerViewCommand,
	type DetachRunnerViewCommand,
	type RunnerControlMetadata,
} from "../../src/runner/protocol";
import { makeSessionRunnerLive } from "../../src/runner/session-runner";
import { AgentSession } from "../../src/session/agent-session";
import { AuthStorage } from "../../src/session/auth-storage";
import { DurableInputQueue } from "../../src/session/durable-input-queue";
import {
	SessionManager,
	SessionRevisionConflictError,
	SessionStateCommandInFlightError,
} from "../../src/session/session-manager";
import { AUTO_THINKING } from "../../src/thinking";
import { acquireSessionOwnership } from "../../src/session/session-ownership";

const roots: string[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
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
	payload: { text: `input-${commandId}`, deliveryClass: "followUp" as const },
});

async function createLiveFixture(holdProviderResponses = false) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-runner-"));
	roots.push(root);
	const project = path.join(root, "project");
	const sessions = path.join(root, "sessions");
	const muxRoot = path.join(root, "mux");
	await fs.mkdir(project, { recursive: true });
	await fs.mkdir(sessions, { recursive: true });

	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	const alternateModel = getBundledModel("anthropic", "claude-haiku-4-5");
	if (!model || !alternateModel) throw new Error("test models unavailable");
	const authStorage = await AuthStorage.create(path.join(root, "auth.db"));
	authStorage.setRuntimeApiKey(model.provider, "test-key");
	const modelRegistry = new ModelRegistry(authStorage, path.join(root, "models.yml"));
	const providerInputs: string[] = [];
	const pendingProviderCompletions: Array<() => void> = [];
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
				const complete = () => stream.push({ type: "done", reason: "stop", message });
				if (holdProviderResponses) pendingProviderCompletions.push(complete);
				else complete();
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
	let failNextPromptRebuild = false;
	let session!: AgentSession;
	const settings = Settings.isolated({ "compaction.enabled": false });
	session = new AgentSession({
		agent,
		sessionManager,
		durableInputQueue: queue,
		settings,
		modelRegistry,
		rebuildSystemPrompt: async () => {
			if (failNextPromptRebuild) {
				failNextPromptRebuild = false;
				throw new Error("prompt rebuild failed once");
			}
			return { systemPrompt: [`model:${session.model?.provider}/${session.model?.id}`] };
		},
	});
	return {
		root,
		muxRoot,
		sessionFile,
		ownership,
		queue,
		session,
		sessionManager,
		providerInputs,
		settings,
		modelRegistry,
		alternateModel,
		failNextPromptRebuild: () => {
			failNextPromptRebuild = true;
		},
		releaseProviderResponses: () => {
			for (const complete of pendingProviderCompletions.splice(0)) complete();
		},
	};
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

	it("decodes and persists steer and follow-up image payloads", async () => {
		const fixture = await createLiveFixture();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 4 });
					const attached = yield* runner.attachView(attach("image-controller", "controller", 0));
					if (attached.capability !== "controller") throw new Error("expected controller");
					const image = { type: "image" as const, data: "aW1hZ2U=", mimeType: "image/png" };
					const steer = yield* attached.submitInput({
						...metadata("steer-image", 0),
						kind: "submitInput",
						viewId: attached.viewId,
						controllerEpoch: attached.controllerEpoch,
						payload: { text: "steer image", images: [image], deliveryClass: "steer" },
					});
					yield* Effect.promise(() => fixture.session.waitForIdle());
					const followUp = yield* attached.submitInput({
						...metadata("follow-up-image", 1),
						kind: "submitInput",
						viewId: attached.viewId,
						controllerEpoch: attached.controllerEpoch,
						payload: { text: "follow-up image", images: [image], deliveryClass: "followUp" },
					});
					yield* Effect.promise(() => fixture.session.waitForIdle());
					const snapshot = yield* runner.snapshot();
					expect(snapshot.items.find(item => item.inputId === steer.inputId)?.deliveryClass).toBe("steer");
					expect(snapshot.items.find(item => item.inputId === steer.inputId)?.payload.images).toEqual([image]);
					expect(snapshot.items.find(item => item.inputId === followUp.inputId)?.deliveryClass).toBe("followUp");
					expect(snapshot.items.find(item => item.inputId === followUp.inputId)?.payload.images).toEqual([image]);
					yield* runner.stop();
				}),
			),
		);
	});

	it("serializes edit and cancel with typed fences, replay deduplication, and kind-specific events", async () => {
		const fixture = await createLiveFixture(true);
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 8 });
					const attached = yield* runner.attachView(attach("mutation-controller", "controller", 0));
					if (attached.capability !== "controller") throw new Error("expected controller");
					yield* attached.submitInput(submit(attached.viewId, attached.controllerEpoch, "blocking-input", 0));
					while (!fixture.session.isStreaming) yield* Effect.promise(() => Bun.sleep(1));
					const target = yield* attached.submitInput(
						submit(attached.viewId, attached.controllerEpoch, "mutation-target", 1),
					);
					const subscription = yield* attached.subscribe();

					const staleRunner = yield* Effect.flip(
						attached.editQueuedInput({
							...metadata("stale-runner-edit", 1),
							kind: "editQueuedInput",
							viewId: attached.viewId,
							controllerEpoch: attached.controllerEpoch,
							inputId: target.inputId,
							itemRevision: 1,
							payload: { text: "must not apply" },
						}),
					);
					expect(staleRunner).toBeInstanceOf(RunnerRevisionConflictError);
					const staleItem = yield* Effect.flip(
						attached.editQueuedInput({
							...metadata("stale-item-edit", 2),
							kind: "editQueuedInput",
							viewId: attached.viewId,
							controllerEpoch: attached.controllerEpoch,
							inputId: target.inputId,
							itemRevision: 2,
							payload: { text: "must not apply" },
						}),
					);
					expect(staleItem).toBeInstanceOf(RunnerItemRevisionConflictError);
					const staleController = yield* Effect.flip(
						attached.cancelQueuedInput({
							...metadata("stale-controller-cancel", 2),
							kind: "cancelQueuedInput",
							viewId: attached.viewId,
							controllerEpoch: attached.controllerEpoch + 1,
							inputId: target.inputId,
							itemRevision: 1,
						}),
					);
					expect(staleController).toBeInstanceOf(StaleRunnerControllerLeaseError);

					const editCommand = {
						...metadata("edit-command", 2),
						kind: "editQueuedInput" as const,
						viewId: attached.viewId,
						controllerEpoch: attached.controllerEpoch,
						inputId: target.inputId,
						itemRevision: 1,
						payload: {
							text: "after edit",
							images: [{ type: "image" as const, data: "ZWRpdA==", mimeType: "image/jpeg" }],
						},
					};
					const edited = yield* attached.editQueuedInput(editCommand);
					const editReplay = yield* attached.editQueuedInput(editCommand);
					expect(editReplay).toEqual({ ...edited, replayed: true });

					const cancelCommand = {
						...metadata("cancel-command", 3),
						kind: "cancelQueuedInput" as const,
						viewId: attached.viewId,
						controllerEpoch: attached.controllerEpoch,
						inputId: target.inputId,
						itemRevision: 2,
					};
					const cancelled = yield* attached.cancelQueuedInput(cancelCommand);
					const cancelReplay = yield* attached.cancelQueuedInput(cancelCommand);
					expect(cancelReplay).toEqual({ ...cancelled, replayed: true });
					const mutationEvents: string[] = [];
					while (!mutationEvents.some(event => event.startsWith("cancel-command:"))) {
						const delivery = yield* subscription.take;
						if (delivery.event.commandId === "edit-command" || delivery.event.commandId === "cancel-command") {
							mutationEvents.push(`${delivery.event.commandId}:${delivery.event.kind}`);
						}
					}
					expect(mutationEvents).toEqual(["edit-command:inputEdited", "cancel-command:inputCancelled"]);
					const snapshot = yield* runner.snapshot();
					expect(snapshot.revision).toBe(4);
					expect(snapshot.items.find(item => item.inputId === target.inputId)).toMatchObject({
						revision: 2,
						state: "cancelled",
						payload: editCommand.payload,
					});
					fixture.releaseProviderResponses();
					yield* Effect.promise(() => fixture.session.waitForIdle());
					yield* runner.stop();
				}).pipe(Effect.ensuring(Effect.sync(fixture.releaseProviderResponses))),
			),
		);
	});
	it("commits thinking changes on the session revision without advancing the input revision", async () => {
		const fixture = await createLiveFixture();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 8 });
					const terminal = yield* runner.attachTerminalView(attach("thinking-terminal", "controller", 0));
					const initial = yield* terminal.snapshot();
					let thinkingEvents = 0;
					const unsubscribe = fixture.session.subscribe((event) => {
						if (event.type === "thinking_level_changed") thinkingEvents += 1;
					});
					const command = decodeSetThinkingLevelCommand({
						schemaVersion: 1,
						kind: "setThinkingLevel",
						commandId: "thinking-high",
						correlationId: "thinking-high-correlation",
						expectedSessionRevision: initial.runner.sessionRevision,
						viewId: terminal.viewId,
						controllerEpoch: terminal.epoch,
						thinkingLevel: ThinkingLevel.High,
					});
					const receipt = yield* terminal.setThinkingLevel(command);
					expect(receipt).toMatchObject({
						commandId: "thinking-high",
						sessionRevision: initial.runner.sessionRevision + 1,
						replayed: false,
					});
					expect(fixture.session.configuredThinkingLevel()).toBe(ThinkingLevel.High);
					expect((yield* runner.snapshot()).revision).toBe(initial.runner.revision);
					expect(
						fixture.sessionManager
							.getEntries()
							.filter((entry) => entry.type === "thinking_level_change" && entry.command?.commandId === "thinking-high"),
					).toHaveLength(1);

					const secondCommand = decodeSetThinkingLevelCommand({
						...command,
						commandId: "thinking-low",
						correlationId: "thinking-low-correlation",
						expectedSessionRevision: receipt.sessionRevision,
						thinkingLevel: ThinkingLevel.Low,
					});
					const secondReceipt = yield* terminal.setThinkingLevel(secondCommand);
					expect(fixture.session.configuredThinkingLevel()).toBe(ThinkingLevel.Low);

					const replay = yield* terminal.setThinkingLevel(command);
					expect(replay).toEqual({ ...receipt, replayed: true });
					expect(fixture.session.configuredThinkingLevel()).toBe(ThinkingLevel.Low);
					expect((yield* runner.snapshot()).sessionRevision).toBe(secondReceipt.sessionRevision);
					expect(thinkingEvents).toBe(2);
					expect(

						fixture.sessionManager
							.getEntries()
							.filter((entry) => entry.type === "thinking_level_change" && entry.command?.commandId === "thinking-high"),
					).toHaveLength(1);
					expect(
						fixture.sessionManager.getEntries().filter((entry) => entry.type === "thinking_level_change"),
					).toHaveLength(2);
					unsubscribe();
					yield* terminal.detach();
					yield* runner.stop();
				}),
			),
		);
	});

	it("durably switches models once, fences revisions, and keeps replay older than the latest model inert", async () => {
		const fixture = await createLiveFixture();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 8 });
					const terminal = yield* runner.attachTerminalView(attach("model-terminal", "controller", 0));
					const subscription = yield* terminal.subscribe();
					const initial = yield* terminal.snapshot();
					const setRole = vi.spyOn(fixture.settings, "setModelRole");
					const commandA = decodeSetModelCommand({
						schemaVersion: 1,
						kind: "setModel",
						commandId: "model-a",
						correlationId: "model-a-correlation",
						expectedSessionRevision: initial.runner.sessionRevision,
						viewId: terminal.viewId,
						controllerEpoch: terminal.epoch,
						payload: {
							provider: fixture.alternateModel.provider,
							id: fixture.alternateModel.id,
						},
					});

					yield* Effect.flip(
						terminal.setModel(
							decodeSetModelCommand({ ...commandA, controllerEpoch: terminal.epoch + 1 }),
						),
					).pipe(Effect.tap(error => Effect.sync(() => expect(error).toBeInstanceOf(StaleRunnerControllerLeaseError))));

					const receiptA = yield* terminal.setModel(commandA);
					expect(fixture.session.model?.id).toBe(fixture.alternateModel.id);
					expect((yield* terminal.snapshot()).session.modelSummary?.id).toBe(fixture.alternateModel.id);
					expect((yield* runner.snapshot()).revision).toBe(initial.runner.revision);
					expect(setRole).not.toHaveBeenCalled();
					expect(
						fixture.sessionManager
							.getEntries()
							.filter(entry => entry.type === "model_change" && entry.command?.commandId === "model-a"),
					).toHaveLength(1);
					const initialModel = fixture.modelRegistry.find(
						initial.session.modelSummary!.provider,
						initial.session.modelSummary!.id,
					);
					if (!initialModel) throw new Error("initial model unavailable");
					fixture.session.agent.setModel(initialModel);
					expect(fixture.session.model?.id).toBe(initialModel.id);
					expect(yield* terminal.setModel(commandA)).toEqual({ ...receiptA, replayed: true });
					expect(fixture.session.model?.id).toBe(fixture.alternateModel.id);

					yield* Effect.flip(
						terminal.setModel(
							decodeSetModelCommand({
								...commandA,
								commandId: "model-stale",
								correlationId: "model-stale-correlation",
								payload: {
									provider: initial.session.modelSummary!.provider,
									id: initial.session.modelSummary!.id,
								},
							}),
						),
					).pipe(Effect.tap(error => Effect.sync(() => expect(error).toBeInstanceOf(SessionRevisionConflictError))));

					const commandB = decodeSetModelCommand({
						...commandA,
						commandId: "model-b",
						correlationId: "model-b-correlation",
						expectedSessionRevision: receiptA.sessionRevision,
						payload: {
							provider: initial.session.modelSummary!.provider,
							id: initial.session.modelSummary!.id,
						},
					});
					const receiptB = yield* terminal.setModel(commandB);
					expect(fixture.session.model?.id).toBe(initial.session.modelSummary?.id);
					const replay = yield* terminal.setModel(commandA);
					expect(replay).toEqual({ ...receiptA, replayed: true });
					expect(fixture.session.model?.id).toBe(initial.session.modelSummary?.id);
					expect((yield* runner.snapshot()).sessionRevision).toBe(receiptB.sessionRevision);
					expect(
						fixture.sessionManager.getEntries().filter(entry => entry.type === "model_change" && entry.command),
					).toHaveLength(2);

					const modelEvents: string[] = [];
					while (modelEvents.length < 2) {
						const delivery = yield* subscription.take;
						if (delivery.kind === "runnerEvent" && delivery.event.kind === "modelChanged") {
							modelEvents.push(delivery.event.commandId);
						}
					}
					expect(modelEvents).toEqual(["model-a", "model-b"]);
					yield* terminal.detach();
					yield* runner.stop();
				}),
			),
		);
	});

	it("replays the latest durable model command to finish a failed post-commit prompt rebuild", async () => {
		const fixture = await createLiveFixture();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 8 });
					const terminal = yield* runner.attachTerminalView(attach("model-reconcile", "controller", 0));
					const initial = yield* terminal.snapshot();
					const command = decodeSetModelCommand({
						schemaVersion: 1,
						kind: "setModel",
						commandId: "model-reconcile-command",
						correlationId: "model-reconcile-correlation",
						expectedSessionRevision: initial.runner.sessionRevision,
						viewId: terminal.viewId,
						controllerEpoch: terminal.epoch,
						payload: {
							provider: fixture.alternateModel.provider,
							id: fixture.alternateModel.id,
						},
					});
					fixture.failNextPromptRebuild();
					yield* Effect.flip(terminal.setModel(command)).pipe(
						Effect.tap(error =>
							Effect.sync(() => expect(error).toBeInstanceOf(SessionRunnerRuntimeError)),
						),
					);
					expect(fixture.session.model?.id).toBe(fixture.alternateModel.id);
					expect(fixture.session.agent.state.systemPrompt).toEqual(["test"]);
					expect(
						fixture.sessionManager
							.getEntries()
							.filter(entry => entry.type === "model_change" && entry.command?.commandId === command.commandId),
					).toHaveLength(1);
					const sequenceAfterFailedApply = (yield* runner.snapshot()).sequence;
					expect(sequenceAfterFailedApply).toBe(initial.runner.sequence + 1);

					const replay = yield* terminal.setModel(command);
					expect(replay.replayed).toBe(true);
					expect(fixture.session.agent.state.systemPrompt).toEqual([
						`model:${fixture.alternateModel.provider}/${fixture.alternateModel.id}`,
					]);
					expect(
						fixture.sessionManager
							.getEntries()
							.filter(entry => entry.type === "model_change" && entry.command?.commandId === command.commandId),
					).toHaveLength(1);
					expect((yield* runner.snapshot()).sequence).toBe(sequenceAfterFailedApply);
					yield* terminal.detach();
					yield* runner.stop();
				}),
			),
		);
	});

	it("keeps busy thinking rejection, snapshots, detach, and replay responsive during a held prompt", async () => {
		const fixture = await createLiveFixture(true);
		const scope = Scope.makeUnsafe("sequential");
		const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
			Effect.runPromise(Scope.provide(scope)(effect));
		let releaseTimer: ReturnType<typeof setInterval> | undefined;
		try {
			const runner = await run(makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 8 }));
			const terminal = await run(runner.attachTerminalView(attach("thinking-race", "controller", 0)));
			const initial = await run(terminal.snapshot());
			const committedCommand = decodeSetThinkingLevelCommand({
				schemaVersion: 1,
				kind: "setThinkingLevel",
				commandId: "thinking-before-drain",
				correlationId: "thinking-before-drain-correlation",
				expectedSessionRevision: initial.runner.sessionRevision,
				viewId: terminal.viewId,
				controllerEpoch: terminal.epoch,
				thinkingLevel: ThinkingLevel.High,
			});
			const committed = await run(terminal.setThinkingLevel(committedCommand));
			await run(terminal.submit(decodeSubmitInputCommand(submit(terminal.viewId, terminal.epoch, "race-input", 0))));
			while (!fixture.session.isStreaming) await Bun.sleep(1);

			const startedAt = Date.now();
			await expect(
				run(
					terminal.setThinkingLevel(
						decodeSetThinkingLevelCommand({
							...committedCommand,
							commandId: "thinking-during-drain",
							correlationId: "thinking-during-drain-correlation",
							expectedSessionRevision: committed.sessionRevision,
							thinkingLevel: ThinkingLevel.Low,
						}),
					),
				),
			).rejects.toBeInstanceOf(SessionStateCommandInFlightError);
			expect(Date.now() - startedAt).toBeLessThan(250);
			expect((await run(runner.snapshot())).status).toBe("running");

			const replay = await run(terminal.setThinkingLevel(committedCommand));
			expect(replay).toEqual({ ...committed, replayed: true });
			const observer = await run(runner.attachView(attach("race-observer", "observer", 1)));
			await run(observer.detach(detach(observer.viewId, 1)));
			expect(
				fixture.sessionManager
					.getEntries()
					.some(
						(entry) =>
							entry.type === "thinking_level_change" &&
							entry.command?.commandId === "thinking-during-drain",
					),
			).toBe(false);
			expect(fixture.session.configuredThinkingLevel()).toBe(ThinkingLevel.High);

			releaseTimer = setInterval(fixture.releaseProviderResponses, 1);
			await fixture.session.waitForIdle();
			clearInterval(releaseTimer);
			releaseTimer = undefined;
			await run(terminal.detach());
			await run(runner.stop());
		} finally {
			if (releaseTimer) clearInterval(releaseTimer);
			fixture.releaseProviderResponses();
			await Effect.runPromise(Scope.close(scope, Exit.void));
		}
	});

	it("rejects a model switch promptly during a held prompt without blocking snapshots or journaling", async () => {
		const fixture = await createLiveFixture(true);
		const scope = Scope.makeUnsafe("sequential");
		const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
			Effect.runPromise(Scope.provide(scope)(effect));
		let releaseTimer: ReturnType<typeof setInterval> | undefined;
		try {
			const runner = await run(makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 8 }));
			const terminal = await run(runner.attachTerminalView(attach("model-race", "controller", 0)));
			const initial = await run(terminal.snapshot());
			await run(terminal.submit(decodeSubmitInputCommand(submit(terminal.viewId, terminal.epoch, "model-race-input", 0))));
			while (!fixture.session.isStreaming) await Bun.sleep(1);
			const command = decodeSetModelCommand({
				schemaVersion: 1,
				kind: "setModel",
				commandId: "model-during-prompt",
				correlationId: "model-during-prompt-correlation",
				expectedSessionRevision: initial.runner.sessionRevision,
				viewId: terminal.viewId,
				controllerEpoch: terminal.epoch,
				payload: {
					provider: fixture.alternateModel.provider,
					id: fixture.alternateModel.id,
				},
			});
			const startedAt = Date.now();
			await expect(run(terminal.setModel(command))).rejects.toBeInstanceOf(SessionStateCommandInFlightError);
			expect(Date.now() - startedAt).toBeLessThan(250);
			expect((await run(runner.snapshot())).status).toBe("running");
			expect(
				fixture.sessionManager
					.getEntries()
					.some(entry => entry.type === "model_change" && entry.command?.commandId === command.commandId),
			).toBe(false);
			releaseTimer = setInterval(fixture.releaseProviderResponses, 1);
			await fixture.session.waitForIdle();
			clearInterval(releaseTimer);
			releaseTimer = undefined;
			await run(terminal.detach());
			await run(runner.stop());
		} finally {
			if (releaseTimer) clearInterval(releaseTimer);
			fixture.releaseProviderResponses();
			await Effect.runPromise(Scope.close(scope, Exit.void));
		}
	});

	it("restores a journaled auto selector and classifies after reopening", async () => {
		const fixture = await createLiveFixture();
		await fixture.sessionManager.commitStateCommand({
			schemaVersion: 1,
			kind: "setThinkingLevel",
			commandId: "journal-auto",
			correlationId: "journal-auto-correlation",
			expectedSessionRevision: fixture.sessionManager.getSessionRevision(),
			thinkingLevel: AUTO_THINKING,
		});
		fixture.session.applyJournaledThinkingLevel(AUTO_THINKING);
		await fixture.sessionManager.flush();
		fixture.session.applyJournaledThinkingLevel(ThinkingLevel.Low);

		expect(await fixture.session.switchSession(fixture.sessionFile)).toBe(true);
		expect(fixture.session.configuredThinkingLevel()).toBe(AUTO_THINKING);
		expect(fixture.session.isAutoThinking).toBe(true);

		const classifierSpy = vi.spyOn(autoThinkingClassifier, "classifyDifficulty").mockResolvedValue(Effort.Medium);
		await fixture.session.prompt("Classify this reopened journaled auto session");
		await fixture.session.waitForIdle();
		expect(classifierSpy).toHaveBeenCalledTimes(1);
		expect(fixture.session.configuredThinkingLevel()).toBe(AUTO_THINKING);
		expect(fixture.session.thinkingLevel).toBe(Effort.Medium);
		await fixture.session.dispose();
	});

	it("projects terminal state without exposing the session and detaches without stopping the runner", async () => {
		const fixture = await createLiveFixture();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 4 });
					const terminal = yield* runner.attachTerminalView(attach("terminal", "controller", 0));
					const subscription = yield* terminal.subscribe();
					const initial = yield* terminal.snapshot();
					expect(initial.session.sessionId).toBe(fixture.session.sessionId);
					expect(initial.session.modelSummary?.provider).toBe(fixture.session.model?.provider);
					expect(initial.session.modelSummary?.id).toBe(fixture.session.model?.id);
					expect(initial.session.modelSummary?.name).toBe(fixture.session.model?.name);
					expect(initial.session.modelSummary?.contextWindow).toBe(fixture.session.model?.contextWindow);
					expect(initial.session.messages).not.toBe(fixture.session.messages);

					const command = submit(terminal.viewId, terminal.epoch, "terminal-submit", 0);
					yield* terminal.submit(decodeSubmitInputCommand(command));
					const delivery = yield* subscription.take;
					expect(["agentEvent", "runnerEvent", "resyncRequired"]).toContain(delivery.kind);
					expect(initial.session.messages).toHaveLength(0);

					yield* terminal.detach();
					const alive = yield* runner.snapshot();
					expect(alive.status).toBe("running");
					expect(alive.views).toHaveLength(0);
					fixture.releaseProviderResponses();
					yield* Effect.promise(() => fixture.session.waitForIdle());
					yield* runner.stop();
				}).pipe(Effect.ensuring(Effect.sync(fixture.releaseProviderResponses))),
			),
		);
	});
	it("advances Promise controller fences across sequential mutations and closes without stopping", async () => {
		const fixture = await createLiveFixture();
		const scope = Scope.makeUnsafe("sequential");
		const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
			Effect.runPromise(Scope.provide(scope)(effect));
		try {
			const runner = await run(makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 4 }));
			const controller = await createTerminalSessionController(runner, { viewId: "promise-terminal" });
			const first = await controller.submit({ text: "one", deliveryClass: "followUp" });
			const second = await controller.submit({ text: "two", deliveryClass: "followUp" });
			expect(first.revision).toBe(1);
			expect(second.revision).toBe(2);
			expect(controller.snapshot().runner.revision).toBe(2);
			await fixture.session.waitForIdle();
			const beforeModelRevision = controller.snapshot().runner.sessionRevision;
			const modelReceipt = await controller.setModel({
				provider: fixture.alternateModel.provider,
				id: fixture.alternateModel.id,
			});
			expect(modelReceipt.sessionRevision).toBe(beforeModelRevision + 1);
			expect(controller.snapshot().runner.sessionRevision).toBe(modelReceipt.sessionRevision);
			expect(controller.snapshot().session.modelSummary?.id).toBe(fixture.alternateModel.id);
			await controller.close();
			expect((await run(runner.snapshot())).status).toBe("running");
			fixture.releaseProviderResponses();
			await fixture.session.waitForIdle();
			await run(runner.stop());
		} finally {
			fixture.releaseProviderResponses();
			await Effect.runPromise(Scope.close(scope, Exit.void));
		}
	});

	it("resyncs from the snapshot baseline and atomically detaches beside an admitted mutation", async () => {
		const fixture = await createLiveFixture();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 1 });
					const terminal = yield* runner.attachTerminalView(attach("gap-terminal", "controller", 0));
					const subscription = yield* terminal.subscribe();
					yield* runner.attachView(attach("gap-observer-1", "observer", 0));
					yield* runner.attachView(attach("gap-observer-2", "observer", 0));
					yield* runner.attachView(attach("gap-observer-3", "observer", 0));
					const gap = yield* subscription.take;
					expect(gap.kind).toBe("resyncRequired");
					if (gap.kind !== "resyncRequired") throw new Error("expected terminal resync");
					const baseline = gap.snapshot.terminalSequence;
					yield* runner.attachView(attach("gap-observer-4", "observer", 0));
					const afterBaseline = yield* subscription.take;
					expect(afterBaseline.kind).toBe("runnerEvent");
					if (afterBaseline.kind === "resyncRequired") throw new Error("unexpected second resync");
					expect(afterBaseline.sequence).toBe(baseline + 1);

					const mutation = yield* Effect.forkChild(
						terminal.submit(
							decodeSubmitInputCommand(
								submit(terminal.viewId, terminal.epoch, "concurrent-terminal-submit", 0),
							),
						),
						{ startImmediately: true },
					);
					yield* Effect.yieldNow;
					yield* terminal.detach();
					expect((yield* Fiber.join(mutation)).revision).toBe(1);
					expect((yield* runner.snapshot()).views.some(view => view.viewId === terminal.viewId)).toBe(false);
					fixture.releaseProviderResponses();
					yield* Effect.promise(() => fixture.session.waitForIdle());
					yield* runner.stop();
				}).pipe(Effect.ensuring(Effect.sync(fixture.releaseProviderResponses))),
			),
		);
	});
});
