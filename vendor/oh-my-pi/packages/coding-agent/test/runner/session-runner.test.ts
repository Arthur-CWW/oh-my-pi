import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Agent, type AgentTool, ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import * as compactionModule from "@oh-my-pi/pi-agent-core/compaction";
import { type AssistantMessage, Effort } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { Effect, Exit, Fiber, Scope } from "effect";
import { z } from "zod";
import * as autoThinkingClassifier from "../../src/auto-thinking/classifier";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { IrcExternalBus, type IrcExternalPeer } from "../../src/irc/bus-external";
import { createTerminalSessionController } from "../../src/modes/terminal-session-controller";
import {
	type AttachRunnerViewCommand,
	type DetachRunnerViewCommand,
	decodeCancelCompactionCommand,
	decodeCancelEphemeralTurnCommand,
	decodeCancelHandoffCommand,
	decodeCancelLocalOperationCommand,
	decodeCycleModelCommand,
	decodeGetCheckpointStateCommand,
	decodeInterruptPromptCommand,
	decodeRefreshSshToolCommand,
	decodeReloadSessionCommand,
	decodeRunCompactionCommand,
	decodeRunEphemeralTurnCommand,
	decodeRunHandoffCommand,
	decodeRunLocalOperationCommand,
	decodeRunShakeCommand,
	decodeSetActiveToolsCommand,
	decodeSetCheckpointStateCommand,
	decodeSetModelCommand,
	decodeSetThinkingLevelCommand,
	decodeSubmitInputCommand,
	decodeTransitionGoalModeCommand,
	decodeTransitionPlanModeCommand,
	InvalidRunnerCommandError,
	RunnerCompactionCommandConflictError,
	RunnerCompactionTargetError,
	RunnerCompactionUnavailableError,
	type RunnerControlMetadata,
	RunnerEphemeralTurnCommandConflictError,
	RunnerEphemeralTurnTargetError,
	RunnerItemRevisionConflictError,
	RunnerLocalOperationCommandConflictError,
	RunnerLocalOperationTargetError,
	RunnerPromptOperationConflictError,
	RunnerRevisionConflictError,
	RunnerSessionReloadCancelledError,
	RunnerSshToolUnavailableError,
	RunnerToolConfigurationConflictError,
	RunnerViewNotAttachedError,
	SessionRunnerRuntimeError,
	SessionRunnerStoppedError,
	StaleRunnerControllerLeaseError,
} from "../../src/runner/protocol";
import { makeSessionRunnerLive } from "../../src/runner/session-runner";
import { AgentSession } from "../../src/session/agent-session";
import { AuthStorage } from "../../src/session/auth-storage";
import { isBlobRef } from "../../src/session/blob-store";
import { DurableInputQueue } from "../../src/session/durable-input-queue";
import {
	createFleetCompatibilityProfile,
	FLEET_ROLLOUT_FEATURES,
	type FleetCapability,
} from "../../src/session/fleet-capability";
import { createFleetRolloutPlan } from "../../src/session/fleet-rollout-plan";
import { convertToLlm } from "../../src/session/messages";
import { CURRENT_SESSION_CONTROL_PROTOCOL, decodeSessionControlCommand } from "../../src/session/session-control";
import {
	SessionManager,
	SessionRevisionConflictError,
	SessionStateCommandInFlightError,
} from "../../src/session/session-manager";
import { acquireSessionOwnership } from "../../src/session/session-ownership";
import { AUTO_THINKING } from "../../src/thinking";
import * as imageLoading from "../../src/utils/image-loading";

const runnerIdentity = {
	buildRevision: { digest: "0".repeat(64), version: "session-runner-test" },
	runnerInstance: {
		runnerInstanceId: "00000000-0000-4000-8000-000000000001",
		startedAt: "2026-01-01T00:00:00.000Z",
	},
} as const;

const roots: string[] = [];
const externalBuses: IrcExternalBus[] = [];

async function snapshotDefaultPeerStore(): Promise<{ readonly bytes?: Uint8Array; readonly mtimeMs?: number }> {
	const dbPath = path.join(os.homedir(), ".omp", "agent", "irc-bus.sqlite");
	try {
		const [bytes, stat] = await Promise.all([fs.readFile(dbPath), fs.stat(dbPath)]);
		return { bytes, mtimeMs: stat.mtimeMs };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

afterEach(async () => {
	for (const bus of externalBuses.splice(0)) bus.close();
	vi.restoreAllMocks();
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
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

async function createLiveFixture(holdProviderResponses = false, reloadSshTool?: () => Promise<AgentTool | null>) {
	let shouldHoldProviderResponses = holdProviderResponses;
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-runner-"));
	roots.push(root);
	const project = path.join(root, "project");
	const sessions = path.join(root, "sessions");
	const muxRoot = path.join(root, "mux");
	await fs.mkdir(project, { recursive: true });
	await fs.mkdir(sessions, { recursive: true });
	const externalIrcBus = new IrcExternalBus(path.join(root, "irc-bus.sqlite"));
	externalBuses.push(externalIrcBus);

	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	const alternateModel = getBundledModel("anthropic", "claude-haiku-4-5");
	if (!model || !alternateModel) throw new Error("test models unavailable");
	const authStorage = await AuthStorage.create(path.join(root, "auth.db"));
	authStorage.setRuntimeApiKey(model.provider, "test-key");
	const modelRegistry = new ModelRegistry(authStorage, path.join(root, "models.yml"));
	const providerInputs: string[] = [];
	const providerPlanModeContextCounts: number[] = [];
	const pendingProviderCompletions: Array<() => void> = [];
	const alphaTool: AgentTool = {
		name: "alpha",
		label: "Alpha",
		description: "Test tool alpha",
		parameters: z.object({}),
		execute: async () => ({ content: [{ type: "text" as const, text: "alpha" }] }),
	};
	const betaTool: AgentTool = {
		name: "beta",
		label: "Beta",
		description: "Test tool beta",
		parameters: z.object({}),
		execute: async () => ({ content: [{ type: "text" as const, text: "beta" }] }),
	};
	const mcpTool = {
		name: "mcp__test_lookup",
		label: "test/lookup",
		description: "Test MCP lookup",
		parameters: z.object({}),
		mcpServerName: "test",
		mcpToolName: "lookup",
		execute: async () => ({ content: [{ type: "text" as const, text: "mcp" }] }),
	} as AgentTool;
	const agent = new Agent({
		convertToLlm,
		initialState: { model, systemPrompt: ["test"], tools: [alphaTool], messages: [] },
		streamFn: (_model, context) => {
			const lastUser = [...context.messages].reverse().find(message => message.role === "user");
			const text =
				typeof lastUser?.content === "string"
					? lastUser.content
					: lastUser?.content?.find(part => part.type === "text")?.text;
			providerInputs.push(text ?? "");
			const serializedContext = JSON.stringify(context);
			providerPlanModeContextCounts.push(serializedContext.split("Plan mode is active.").length - 1);
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
				if (shouldHoldProviderResponses) pendingProviderCompletions.push(complete);
				else complete();
			});
			return stream;
		},
	});
	const sessionManager = SessionManager.create(project, sessions);
	await sessionManager.ensureOnDisk();
	const sessionFile = sessionManager.getSessionFile();
	if (!sessionFile) throw new Error("persistent test session has no file");
	const ownership = await acquireSessionOwnership(sessionFile, sessionManager.getSessionId(), {
		root: muxRoot,
		buildRevision: runnerIdentity.buildRevision,
		runnerInstanceIdentity: runnerIdentity.runnerInstance,
	});
	sessionManager.bindSessionOwnership(ownership);
	const queue = await DurableInputQueue.open(ownership, muxRoot);
	await queue.adopt();
	let failNextPromptRebuild = false;
	let session!: AgentSession;
	const settings = Settings.isolated({ "compaction.enabled": false });
	let heldPromptRebuild:
		| { readonly started: PromiseWithResolvers<void>; readonly release: PromiseWithResolvers<void> }
		| undefined;
	session = new AgentSession({
		agent,
		sessionManager,
		durableInputQueue: queue,
		settings,
		convertToLlm,
		modelRegistry,
		externalIrcBus,
		toolRegistry: new Map([
			[alphaTool.name, alphaTool],
			[betaTool.name, betaTool],
			[mcpTool.name, mcpTool],
		]),
		mcpDiscoveryEnabled: true,
		...(reloadSshTool === undefined ? {} : { reloadSshTool }),
		rebuildSystemPrompt: async () => {
			if (heldPromptRebuild) {
				const held = heldPromptRebuild;
				held.started.resolve();
				await held.release.promise;
				heldPromptRebuild = undefined;
			}
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
		externalIrcBus,
		ownership,
		queue,
		session,
		sessionManager,
		runnerIdentity,
		providerInputs,
		providerPlanModeContextCounts,
		settings,
		modelRegistry,
		holdNextPromptRebuild: () => {
			const held = {
				started: Promise.withResolvers<void>(),
				release: Promise.withResolvers<void>(),
			};
			heldPromptRebuild = held;
			return held;
		},
		alternateModel,
		failNextPromptRebuild: () => {
			failNextPromptRebuild = true;
		},
		holdProviderResponses: () => {
			shouldHoldProviderResponses = true;
		},
		releaseProviderResponses: () => {
			for (const complete of pendingProviderCompletions.splice(0)) complete();
		},
	};
}

describe("live SessionRunner", () => {
	it("advertises rollout capability through the real runner and planner", async () => {
		const defaultStoreBefore = await snapshotDefaultPeerStore();
		const fixture = await createLiveFixture();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 1 });
					const sessionId = fixture.sessionManager.getSessionId();
					const status = decodeSessionControlCommand({
						schemaVersion: 1,
						commandId: "00000000-0000-4000-8000-000000000002",
						source: {
							kind: "local-cli",
							instanceId: "00000000-0000-4000-8000-000000000003",
							pid: process.pid,
						},
						sessionId,
						targetOwnerEpoch: fixture.ownership.ownerEpoch,
						requestedAt: new Date().toISOString(),
						intent: { kind: "status" },
					});
					const result = yield* runner.applySessionControl(status);
					expect(result).toHaveProperty("fleetCapability");
					const capability = (result as { readonly fleetCapability: FleetCapability }).fleetCapability;
					expect(capability.rolloutFeatures).toEqual(FLEET_ROLLOUT_FEATURES);

					const now = new Date().toISOString();
					const peer: IrcExternalPeer = {
						sessionId,
						name: "fresh-runner",
						cwd: fixture.root,
						pid: process.pid,
						lastSeen: now,
						state: "idle",
						stateTs: now,
						ownerEpoch: fixture.ownership.ownerEpoch,
						buildDigest: fixture.runnerIdentity.buildRevision.digest,
						version: fixture.runnerIdentity.buildRevision.version,
						fleetCapability: capability,
						sessionFile: fixture.sessionFile,
					};
					const legacyPeer: IrcExternalPeer = { ...peer, sessionId: "legacy-runner", fleetCapability: undefined };
					const plan = createFleetRolloutPlan({
						peers: [peer, legacyPeer],
						target: { digest: "1".repeat(64), source: { kind: "blessed" } },
						previousDigest: "0".repeat(64),
						compatibility: createFleetCompatibilityProfile(
							CURRENT_SESSION_CONTROL_PROTOCOL,
							FLEET_ROLLOUT_FEATURES,
						),
						initiatorSessionIds: new Set(),
						nowMs: Date.parse(now),
						id: (() => {
							let sequence = 0;
							return () => `test-id-${++sequence}`;
						})(),
					});
					expect(plan.orderedTargets).toEqual([]);
					expect(plan.excluded).toHaveLength(2);
					expect(plan.excluded).toContainEqual(
						expect.objectContaining({
							sessionId,
							state: "LegacyIncompatible",
							reason: "peer build digest is not a nonzero release SHA-256",
						}),
					);
					expect(plan.excluded).toContainEqual(
						expect.objectContaining({
							sessionId: "legacy-runner",
							state: "LegacyIncompatible",
						}),
					);
				}),
			),
		);
		expect(await snapshotDefaultPeerStore()).toEqual(defaultStoreBefore);
	});

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
					expect(
						(yield* Effect.promise(() => fixture.queue.list())).filter(item => item.inputId === first.inputId),
					).toHaveLength(1);

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

					const projection = yield* observer.openProjection();
					expect(projection.snapshot.transcript.entries).toHaveLength(projection.snapshot.transcript.entryCount);
					fixture.sessionManager.appendMessage({
						role: "user",
						content: "transcript-race",
						timestamp: Date.now(),
					});
					const transcriptDelivery = yield* projection.subscription.take;
					expect(transcriptDelivery.kind).toBe("event");
					if (transcriptDelivery.kind !== "event") throw new Error("expected transcript delta");
					expect(transcriptDelivery.event.kind).toBe("transcriptEntryAppended");
					expect(transcriptDelivery.event.sequence).toBe(projection.snapshot.sequence + 1);
					expect(transcriptDelivery.event.transcriptEntry).toMatchObject({
						id: transcriptDelivery.event.transcriptEntryId,
						type: "message",
						message: { role: "user", content: "transcript-race" },
					});
					const transcriptSnapshot = yield* observer.snapshot();
					expect(transcriptSnapshot.transcript.lastEntryId).toBe(transcriptDelivery.event.transcriptEntryId);
					expect(transcriptSnapshot.transcript.entries.at(-1)).toEqual(transcriptDelivery.event.transcriptEntry);
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
			{
				root: fixture.muxRoot,
				buildRevision: runnerIdentity.buildRevision,
				runnerInstanceIdentity: {
					runnerInstanceId: "00000000-0000-4000-8000-000000000002",
					startedAt: "2026-01-01T00:00:01.000Z",
				},
			},
		);
		expect(await replacementOwnership.isCurrent()).toBe(true);
		await replacementOwnership.release();
	});

	it("atomically preempts and fences the displaced controller", async () => {
		const fixture = await createLiveFixture();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 4 });
					const local = yield* runner.attachView(attach("local-controller", "controller", 0));
					const remote = yield* runner.attachView(attach("remote-controller", "controller", 0));
					if (local.capability !== "controller" || remote.capability !== "controller")
						throw new Error("expected controllers");
					expect(remote.controllerEpoch).toBeGreaterThan(local.controllerEpoch);
					const stale = yield* Effect.flip(
						local.submitInput(submit(local.viewId, local.controllerEpoch, "displaced", 0)),
					);
					expect(stale).toBeInstanceOf(StaleRunnerControllerLeaseError);
				}),
			),
		);
	});

	it("detaches a terminal view after a remote controller preempts it", async () => {
		const fixture = await createLiveFixture();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 4 });
					const terminal = yield* runner.attachTerminalView(attach("terminal-controller", "controller", 0));
					const remote = yield* runner.attachView(attach("remote-controller", "controller", 0));
					if (remote.capability !== "controller") throw new Error("expected controller");
					yield* terminal.detach();
					yield* remote.snapshot();
				}),
			),
		);
	});

	it("decodes and persists steer and follow-up attachment payloads", async () => {
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
						payload: { text: "steer image", attachments: [image], deliveryClass: "steer" },
					});
					yield* Effect.promise(() => fixture.session.waitForIdle());
					const followUp = yield* attached.submitInput({
						...metadata("follow-up-image", 1),
						kind: "submitInput",
						viewId: attached.viewId,
						controllerEpoch: attached.controllerEpoch,
						payload: { text: "follow-up image", attachments: [image], deliveryClass: "followUp" },
					});
					yield* Effect.promise(() => fixture.session.waitForIdle());
					const snapshot = yield* runner.snapshot();
					expect(snapshot.items.find(item => item.inputId === steer.inputId)?.deliveryClass).toBe("steer");
					const steerItem = snapshot.items.find(item => item.inputId === steer.inputId);
					if (!steerItem || !("attachments" in steerItem.payload) || !steerItem.payload.attachments) {
						throw new Error("persisted steer attachments missing");
					}
					const steerAttachment = steerItem.payload.attachments[0];
					if (!steerAttachment) throw new Error("persisted steer attachment missing");
					expect(steerAttachment).toMatchObject({ type: "image", mimeType: "image/png" });
					expect(isBlobRef(steerAttachment.data)).toBe(true);
					expect(snapshot.items.find(item => item.inputId === followUp.inputId)?.deliveryClass).toBe("followUp");
					const followUpItem = snapshot.items.find(item => item.inputId === followUp.inputId);
					if (!followUpItem || !("attachments" in followUpItem.payload) || !followUpItem.payload.attachments) {
						throw new Error("persisted follow-up attachments missing");
					}
					const followUpAttachment = followUpItem.payload.attachments[0];
					if (!followUpAttachment) throw new Error("persisted follow-up attachment missing");
					expect(followUpAttachment).toMatchObject({ type: "image", mimeType: "image/png" });
					expect(followUpAttachment.data).toBe(steerAttachment.data);
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
							attachments: [{ type: "image" as const, data: "ZWRpdA==", mimeType: "image/jpeg" }],
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
					const unsubscribe = fixture.session.subscribe(event => {
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
							.filter(
								entry => entry.type === "thinking_level_change" && entry.command?.commandId === "thinking-high",
							),
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
							.filter(
								entry => entry.type === "thinking_level_change" && entry.command?.commandId === "thinking-high",
							),
					).toHaveLength(1);
					expect(
						fixture.sessionManager.getEntries().filter(entry => entry.type === "thinking_level_change"),
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
						terminal.setModel(decodeSetModelCommand({ ...commandA, controllerEpoch: terminal.epoch + 1 })),
					).pipe(
						Effect.tap(error => Effect.sync(() => expect(error).toBeInstanceOf(StaleRunnerControllerLeaseError))),
					);

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
					).pipe(
						Effect.tap(error => Effect.sync(() => expect(error).toBeInstanceOf(SessionRevisionConflictError))),
					);

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

	it("commits and restores plan workflow without side journal entries", async () => {
		const fixture = await createLiveFixture();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 8 });
					const terminal = yield* runner.attachTerminalView(attach("plan-terminal", "controller", 0));
					const initial = yield* terminal.snapshot();
					const initialTools = [...initial.session.activeToolNames];
					const sideEntryCount = fixture.sessionManager
						.getEntries()
						.filter(
							entry =>
								entry.type === "mode_change" ||
								entry.type === "model_change" ||
								entry.type === "thinking_level_change",
						).length;
					const initialQueueEntryCount = (yield* Effect.promise(() => fixture.queue.list())).length;
					const enter = decodeTransitionPlanModeCommand({
						schemaVersion: 1,
						kind: "transitionPlanMode",
						commandId: "plan-enter",
						correlationId: "plan-enter-correlation",
						expectedSessionRevision: initial.runner.sessionRevision,
						viewId: terminal.viewId,
						controllerEpoch: terminal.epoch,
						transition: {
							kind: "enter",
							planFilePath: "local://PLAN.md",
							workflow: "parallel",
						},
					});
					yield* Effect.flip(
						terminal.transitionPlanMode(
							decodeTransitionPlanModeCommand({ ...enter, controllerEpoch: terminal.epoch + 1 }),
						),
					).pipe(
						Effect.tap(error => Effect.sync(() => expect(error).toBeInstanceOf(StaleRunnerControllerLeaseError))),
					);
					yield* Effect.flip(
						terminal.transitionPlanMode(
							decodeTransitionPlanModeCommand({
								...enter,
								commandId: "plan-stale",
								correlationId: "plan-stale-correlation",
								expectedSessionRevision: initial.runner.sessionRevision + 1,
							}),
						),
					).pipe(
						Effect.tap(error => Effect.sync(() => expect(error).toBeInstanceOf(SessionRevisionConflictError))),
					);
					const enterReceipt = yield* terminal.transitionPlanMode(enter);
					const entered = yield* terminal.snapshot();
					expect(entered.runner.revision).toBe(initial.runner.revision);
					expect(entered.session.workflow).toMatchObject({
						kind: "plan",
						phase: "active",
						planFilePath: "local://PLAN.md",
					});
					expect(entered.session.activeToolNames).not.toContain("resolve");
					expect(entered.runner.toolConfigurationGeneration).toBe(initial.runner.toolConfigurationGeneration + 1);
					expect(
						fixture.sessionManager
							.getEntries()
							.filter(entry => entry.type === "workflow_change" && entry.command.commandId === enter.commandId),
					).toHaveLength(1);
					expect(
						fixture.sessionManager
							.getEntries()
							.filter(
								entry =>
									entry.type === "mode_change" ||
									entry.type === "model_change" ||
									entry.type === "thinking_level_change",
							),
					).toHaveLength(sideEntryCount);
					expect((yield* Effect.promise(() => fixture.queue.list())).length).toBe(initialQueueEntryCount);
					const providerRequestCount = fixture.providerPlanModeContextCounts.length;
					yield* Effect.promise(() => fixture.session.prompt("plan context probe"));
					yield* Effect.promise(() => fixture.session.waitForIdle());
					expect(fixture.providerPlanModeContextCounts).toHaveLength(providerRequestCount + 1);
					expect(fixture.providerPlanModeContextCounts.at(-1)).toBe(1);
					expect(yield* terminal.transitionPlanMode(enter)).toEqual({ ...enterReceipt, replayed: true });

					const exit = decodeTransitionPlanModeCommand({
						...enter,
						commandId: "plan-exit",
						correlationId: "plan-exit-correlation",
						expectedSessionRevision: (yield* terminal.snapshot()).runner.sessionRevision,
						transition: { kind: "exit", disposition: "paused" },
					});
					yield* terminal.transitionPlanMode(exit);
					const exited = yield* terminal.snapshot();
					expect(exited.session.workflow).toMatchObject({ kind: "plan", phase: "paused" });
					expect(exited.session.activeToolNames).toEqual(initialTools);
					expect(exited.runner.toolConfigurationGeneration).toBe(entered.runner.toolConfigurationGeneration + 1);
					yield* terminal.detach();
					yield* runner.stop();
				}),
			),
		);
	});

	it("commits, replays, and fences goal workflow transitions without changing input revision", async () => {
		const fixture = await createLiveFixture();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 8 });
					const terminal = yield* runner.attachTerminalView(attach("goal-terminal", "controller", 0));
					const initial = yield* terminal.snapshot();
					const initialTools = [...initial.session.activeToolNames];
					const enter = decodeTransitionGoalModeCommand({
						schemaVersion: 1,
						kind: "transitionGoalMode",
						commandId: "goal-enter",
						correlationId: "goal-enter-correlation",
						expectedSessionRevision: initial.runner.sessionRevision,
						viewId: terminal.viewId,
						controllerEpoch: terminal.epoch,
						transition: {
							kind: "enter",
							action: "create",
							objective: "Prove durable goal transitions",
							tokenBudget: 500,
						},
					});

					const receipt = yield* terminal.transitionGoalMode(enter);
					const entered = yield* terminal.snapshot();
					expect(receipt.replayed).toBe(false);
					expect(entered.runner.revision).toBe(initial.runner.revision);
					expect(entered.session.workflow).toMatchObject({ kind: "goal", phase: "active" });
					expect(entered.session.activeToolNames).toEqual(initialTools);
					expect(entered.runner.toolConfigurationGeneration).toBe(initial.runner.toolConfigurationGeneration + 1);
					expect(fixture.session.getGoalModeState()).toMatchObject({
						enabled: true,
						goal: {
							objective: "Prove durable goal transitions",
							status: "active",
							tokenBudget: 500,
						},
					});
					expect(yield* terminal.transitionGoalMode(enter)).toEqual({ ...receipt, replayed: true });
					expect((yield* terminal.snapshot()).runner.revision).toBe(initial.runner.revision);

					const workflow = entered.session.workflow;
					if (workflow.kind !== "goal") throw new Error("expected active goal workflow");
					const mismatch = decodeTransitionGoalModeCommand({
						...enter,
						commandId: "goal-mismatch",
						correlationId: "goal-mismatch-correlation",
						expectedSessionRevision: receipt.sessionRevision,
						transition: { kind: "exit", goalId: "different-goal", disposition: "paused" },
					});
					yield* Effect.flip(terminal.transitionGoalMode(mismatch)).pipe(
						Effect.tap(error => Effect.sync(() => expect(error).toBeInstanceOf(SessionRunnerRuntimeError))),
					);

					const pause = decodeTransitionGoalModeCommand({
						...enter,
						commandId: "goal-pause",
						correlationId: "goal-pause-correlation",
						expectedSessionRevision: receipt.sessionRevision,
						transition: { kind: "exit", goalId: workflow.goalId, disposition: "paused" },
					});
					yield* terminal.transitionGoalMode(pause);
					const paused = yield* terminal.snapshot();
					expect(paused.session.workflow).toEqual({
						kind: "goal",
						phase: "paused",
						goalId: workflow.goalId,
					});
					expect(paused.session.activeToolNames).toEqual(initialTools);
					expect(paused.runner.toolConfigurationGeneration).toBe(entered.runner.toolConfigurationGeneration + 1);
					expect(fixture.session.getGoalModeState()).toMatchObject({
						enabled: false,
						goal: { id: workflow.goalId, status: "paused" },
					});
					yield* terminal.detach();
					yield* runner.stop();
				}),
			),
		);
	});

	it("replays a committed plan workflow after prompt rebuild failure without duplicate events", async () => {
		const fixture = await createLiveFixture();
		fixture.settings.setRuntimeModelRole("plan", `${fixture.alternateModel.provider}/${fixture.alternateModel.id}`);
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 8 });
					const terminal = yield* runner.attachTerminalView(attach("plan-reconcile", "controller", 0));
					const initial = yield* terminal.snapshot();
					const command = decodeTransitionPlanModeCommand({
						schemaVersion: 1,
						kind: "transitionPlanMode",
						commandId: "plan-reconcile-command",
						correlationId: "plan-reconcile-correlation",
						expectedSessionRevision: initial.runner.sessionRevision,
						viewId: terminal.viewId,
						controllerEpoch: terminal.epoch,
						transition: {
							kind: "enter",
							planFilePath: "local://PLAN.md",
							workflow: "parallel",
						},
					});
					fixture.failNextPromptRebuild();
					yield* Effect.flip(terminal.transitionPlanMode(command)).pipe(
						Effect.tap(error => Effect.sync(() => expect(error).toBeInstanceOf(SessionRunnerRuntimeError))),
					);
					expect(
						fixture.sessionManager
							.getEntries()
							.filter(
								entry => entry.type === "workflow_change" && entry.command.commandId === command.commandId,
							),
					).toHaveLength(1);
					const failed = yield* runner.snapshot();
					expect(failed.sequence).toBe(initial.runner.sequence + 1);
					expect(failed.sessionRevision).toBe(initial.runner.sessionRevision + 1);

					const replay = yield* terminal.transitionPlanMode(command);
					expect(replay.replayed).toBe(true);
					expect((yield* terminal.snapshot()).session.workflow).toMatchObject({
						kind: "plan",
						phase: "active",
					});
					expect(fixture.session.agent.state.systemPrompt).toEqual([
						`model:${fixture.alternateModel.provider}/${fixture.alternateModel.id}`,
					]);
					expect(
						fixture.sessionManager
							.getEntries()
							.filter(
								entry => entry.type === "workflow_change" && entry.command.commandId === command.commandId,
							),
					).toHaveLength(1);
					expect((yield* runner.snapshot()).sequence).toBe(failed.sequence);
					const correctiveExit = decodeTransitionPlanModeCommand({
						...command,
						commandId: "plan-reconcile-exit",
						correlationId: "plan-reconcile-exit-correlation",
						expectedSessionRevision: failed.sessionRevision,
						transition: { kind: "exit", disposition: "disabled" },
					});
					const corrected = yield* terminal.transitionPlanMode(correctiveExit);
					expect(corrected.sessionRevision).toBe(failed.sessionRevision + 1);
					expect((yield* terminal.snapshot()).session.workflow).toEqual({ kind: "none" });
					expect(fixture.session.getPlanModeState()).toBeUndefined();
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
						Effect.tap(error => Effect.sync(() => expect(error).toBeInstanceOf(SessionRunnerRuntimeError))),
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
		const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Scope.provide(scope)(effect));
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
			const busyPlan = decodeTransitionPlanModeCommand({
				schemaVersion: 1,
				kind: "transitionPlanMode",
				commandId: "plan-during-drain",
				correlationId: "plan-during-drain-correlation",
				expectedSessionRevision: committed.sessionRevision,
				viewId: terminal.viewId,
				controllerEpoch: terminal.epoch,
				transition: {
					kind: "enter",
					planFilePath: "local://PLAN.md",
					workflow: "parallel",
				},
			});
			const planStartedAt = Date.now();
			await expect(run(terminal.transitionPlanMode(busyPlan))).rejects.toBeInstanceOf(
				SessionStateCommandInFlightError,
			);
			expect(Date.now() - planStartedAt).toBeLessThan(250);
			expect(
				fixture.sessionManager
					.getEntries()
					.some(entry => entry.type === "workflow_change" && entry.command.commandId === busyPlan.commandId),
			).toBe(false);
			const busyGoal = decodeTransitionGoalModeCommand({
				schemaVersion: 1,
				kind: "transitionGoalMode",
				commandId: "goal-during-drain",
				correlationId: "goal-during-drain-correlation",
				expectedSessionRevision: committed.sessionRevision,
				viewId: terminal.viewId,
				controllerEpoch: terminal.epoch,
				transition: {
					kind: "enter",
					action: "create",
					objective: "Must wait for the held prompt",
				},
			});
			await expect(run(terminal.transitionGoalMode(busyGoal))).rejects.toBeInstanceOf(
				SessionStateCommandInFlightError,
			);
			expect(
				fixture.sessionManager
					.getEntries()
					.some(entry => entry.type === "workflow_change" && entry.command.commandId === busyGoal.commandId),
			).toBe(false);
			expect((await run(runner.snapshot())).status).toBe("running");

			const replay = await run(terminal.setThinkingLevel(committedCommand));
			expect(replay).toEqual({ ...committed, replayed: true });
			const observer = await run(runner.attachView(attach("race-observer", "observer", 1)));
			await run(observer.detach(detach(observer.viewId, 1)));
			expect(
				fixture.sessionManager
					.getEntries()
					.some(
						entry =>
							entry.type === "thinking_level_change" && entry.command?.commandId === "thinking-during-drain",
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
		const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Scope.provide(scope)(effect));
		let releaseTimer: ReturnType<typeof setInterval> | undefined;
		try {
			const runner = await run(makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 8 }));
			const terminal = await run(runner.attachTerminalView(attach("model-race", "controller", 0)));
			const initial = await run(terminal.snapshot());
			await run(
				terminal.submit(decodeSubmitInputCommand(submit(terminal.viewId, terminal.epoch, "model-race-input", 0))),
			);
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
					expect(initial.session.sessionFile).toBe(fixture.session.sessionFile);
					expect(initial.session.cwd).toBe(fixture.sessionManager.getCwd());
					expect(initial.session.modelSummary?.provider).toBe(fixture.session.model?.provider);
					expect(initial.session.modelSummary?.api).toBe(fixture.session.model?.api);
					expect(initial.session.modelSummary?.id).toBe(fixture.session.model?.id);
					expect(initial.session.modelSummary?.requestModelId).toBe(fixture.session.model?.requestModelId);
					expect(initial.session.modelSummary?.name).toBe(fixture.session.model?.name);
					expect(initial.session.modelSummary?.contextWindow).toBe(fixture.session.model?.contextWindow);
					expect(initial.session.configuredThinkingLevel).toBe(fixture.session.configuredThinkingLevel());
					expect(initial.session.effectiveThinkingLevel).toBe(fixture.session.thinkingLevel);

					const beforeQueries = initial;
					const contextUsage = yield* terminal.getContextUsage();
					const sessionStats = yield* terminal.getSessionStats();
					const advisorStats = yield* terminal.getAdvisorStats();
					const jobs = yield* terminal.getAsyncJobSnapshot({ recentLimit: 2 });
					const hindsight = yield* terminal.getHindsightSessionState();
					const toolNames = yield* terminal.getAllToolNames();
					const fullText = yield* terminal.formatSessionAsText();
					const compactText = yield* terminal.formatSessionAsText({ compact: true });
					const advisorText = yield* terminal.formatAdvisorHistoryAsText({ compact: true });
					const models = yield* terminal.getModelCatalog();
					const tools = yield* terminal.getToolCatalog();
					const metadata = yield* terminal.getSessionMetadataSnapshot();
					const eligibility = yield* terminal.getWorkflowEligibility();
					const lifecycle = yield* terminal.getTurnLifecycle();
					expect(contextUsage).toEqual(fixture.session.getContextUsage());
					expect(sessionStats).toEqual(fixture.session.getSessionStats());
					expect(advisorStats).toEqual(fixture.session.getAdvisorStats());
					expect(jobs).toEqual(fixture.session.getAsyncJobSnapshot({ recentLimit: 2 }));
					expect(hindsight).toBeUndefined();
					expect(toolNames).toEqual(fixture.session.getAllToolNames());
					expect(fullText).toBe(fixture.session.formatSessionAsText());
					expect(compactText).toBe(fixture.session.formatSessionAsText({ compact: true }));
					expect(advisorText).toBe(fixture.session.formatAdvisorHistoryAsText({ compact: true }));
					expect(models).toEqual(fixture.session.getModelCatalog());
					expect(tools).toEqual(fixture.session.getToolCatalog());
					expect(metadata).toEqual(fixture.session.getSessionMetadataSnapshot());
					expect(eligibility).toEqual(fixture.session.getWorkflowEligibility());
					expect(lifecycle).toEqual(fixture.session.getTurnLifecycle());
					expect(Object.isFrozen(models)).toBe(true);
					expect(models.every(item => Object.isFrozen(item) && Object.isFrozen(item.roles))).toBe(true);
					expect(Object.isFrozen(tools)).toBe(true);
					expect(Object.isFrozen(tools.tools)).toBe(true);
					expect(tools.tools.every(Object.isFrozen)).toBe(true);
					expect(Object.isFrozen(metadata.branch)).toBe(true);
					expect(Object.isFrozen(metadata.usage)).toBe(true);
					expect(Object.isFrozen(eligibility.planResolve)).toBe(true);
					expect(Object.isFrozen(eligibility.goalContinuation)).toBe(true);
					expect(Object.isFrozen(lifecycle)).toBe(true);
					(sessionStats.tokens as { input: number }).input = -1;
					(advisorStats.tokens as { input: number }).input = -1;
					(toolNames as string[]).push("escaped");
					if (jobs) {
						(jobs.delivery.pendingJobIds as string[]).push("escaped");
					}
					expect(fixture.session.getSessionStats().tokens.input).not.toBe(-1);
					expect(fixture.session.getAdvisorStats().tokens.input).not.toBe(-1);
					expect(fixture.session.getAllToolNames()).not.toContain("escaped");
					const unchangedJobs = fixture.session.getAsyncJobSnapshot({ recentLimit: 2 });
					if (unchangedJobs) {
						expect(unchangedJobs.delivery.pendingJobIds).not.toContain("escaped");
					}
					const afterQueries = yield* terminal.snapshot();
					expect(afterQueries.terminalSequence).toBe(beforeQueries.terminalSequence);
					expect(afterQueries.runner.revision).toBe(beforeQueries.runner.revision);
					expect(afterQueries.runner.sessionRevision).toBe(beforeQueries.runner.sessionRevision);
					expect(afterQueries.runner.sequence).toBe(beforeQueries.runner.sequence);

					const command = submit(terminal.viewId, terminal.epoch, "terminal-submit", 0);
					yield* terminal.submit(decodeSubmitInputCommand(command));
					const delivery = yield* subscription.take;
					expect(["agentEvent", "runnerEvent", "resyncRequired"]).toContain(delivery.kind);

					yield* terminal.detach();
					yield* terminal.getSessionStats().pipe(
						Effect.flip,
						Effect.map(error => expect(error).toBeInstanceOf(RunnerViewNotAttachedError)),
					);
					const alive = yield* runner.snapshot();
					expect(alive.status).toBe("running");
					expect(alive.views).toHaveLength(0);
					fixture.releaseProviderResponses();
					yield* Effect.promise(() => fixture.session.waitForIdle());
					yield* runner.stop();
					yield* terminal.getSessionStats().pipe(
						Effect.flip,
						Effect.map(error => expect(error).toBeInstanceOf(SessionRunnerStoppedError)),
					);
				}).pipe(Effect.ensuring(Effect.sync(fixture.releaseProviderResponses))),
			),
		);
	});
	it("runs admitted transcript formatting outside the mailbox and honors start-time lifetime", async () => {
		const fixture = await createLiveFixture();
		const scope = Scope.makeUnsafe("sequential");
		const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Scope.provide(scope)(effect));
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		vi.spyOn(fixture.session, "formatSessionAsText").mockImplementation(() => {
			started.resolve();
			return release.promise.then(() => "held transcript") as never;
		});
		try {
			const runner = await run(makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 4 }));
			const terminal = await run(runner.attachTerminalView(attach("held-format", "controller", 0)));
			const formatting = run(terminal.formatSessionAsText({ compact: true }));
			await started.promise;

			const snapshot = await Promise.race([
				run(terminal.snapshot()),
				Bun.sleep(500).then(() => {
					throw new Error("snapshot blocked behind transcript formatting");
				}),
			]);
			expect(snapshot.runner.status).toBe("running");
			await Promise.race([
				run(terminal.detach()),
				Bun.sleep(500).then(() => {
					throw new Error("detach blocked behind transcript formatting");
				}),
			]);

			release.resolve();
			expect(await formatting).toBe("held transcript");
			expect((await run(runner.snapshot())).views).toHaveLength(0);
			await run(runner.stop());
		} finally {
			release.resolve();
			fixture.releaseProviderResponses();
			await Effect.runPromise(Scope.close(scope, Exit.void));
		}
	});

	it("advances Promise controller fences across sequential mutations and closes without stopping", async () => {
		const fixture = await createLiveFixture();
		const scope = Scope.makeUnsafe("sequential");
		const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Scope.provide(scope)(effect));
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
			const betaTools = await controller.setActiveTools({ toolNames: ["beta"] });
			const alphaTools = await controller.setActiveTools({ toolNames: ["alpha"] });
			expect(betaTools.toolConfigurationGeneration).toBe(1);
			expect(betaTools.activeToolNames).toEqual(["beta"]);
			expect(alphaTools.toolConfigurationGeneration).toBe(2);
			expect(alphaTools.activeToolNames).toEqual(["alpha"]);
			expect(controller.snapshot().runner.toolConfigurationGeneration).toBe(2);
			const beforeTodoRevision = controller.snapshot().runner.revision;
			const beforeTodoSessionRevision = controller.snapshot().runner.sessionRevision;
			const beforeTodoGeneration = controller.snapshot().runner.todoGeneration;
			const firstTodos = await controller.replaceTodos({
				phases: [{ name: "build", tasks: [{ content: "first", status: "in_progress" }] }],
			});
			const secondTodos = await controller.replaceTodos({
				phases: [{ name: "verify", tasks: [{ content: "second", status: "pending" }] }],
			});
			expect(firstTodos.todoGeneration).toBe(beforeTodoGeneration + 1);
			expect(secondTodos.todoGeneration).toBe(beforeTodoGeneration + 2);
			expect(controller.snapshot().runner.todoGeneration).toBe(secondTodos.todoGeneration);
			expect(controller.snapshot().session.todoPhases).toEqual(secondTodos.phases);
			secondTodos.phases[0]!.tasks[0]!.content = "mutated receipt";
			expect(controller.snapshot().session.todoPhases[0]!.tasks[0]!.content).toBe("second");
			expect(controller.snapshot().runner.revision).toBe(beforeTodoRevision);
			expect(controller.snapshot().runner.sessionRevision).toBe(beforeTodoSessionRevision);
			expect(await controller.getContextUsage()).toEqual(fixture.session.getContextUsage());
			expect(await controller.getSessionStats()).toEqual(fixture.session.getSessionStats());
			expect(await controller.getAdvisorStats()).toEqual(fixture.session.getAdvisorStats());
			expect(await controller.getAsyncJobSnapshot({ recentLimit: 1 })).toEqual(
				fixture.session.getAsyncJobSnapshot({ recentLimit: 1 }),
			);
			expect(await controller.getHindsightSessionState()).toBeUndefined();
			expect(await controller.getAllToolNames()).toEqual(fixture.session.getAllToolNames());
			expect(await controller.formatSessionAsText({ compact: true })).toBe(
				fixture.session.formatSessionAsText({ compact: true }),
			);
			expect(await controller.formatAdvisorHistoryAsText()).toBe(fixture.session.formatAdvisorHistoryAsText());
			expect(await controller.getModelCatalog()).toEqual(fixture.session.getModelCatalog());
			expect(await controller.getToolCatalog()).toEqual(fixture.session.getToolCatalog());
			expect(await controller.getSessionMetadataSnapshot()).toEqual(fixture.session.getSessionMetadataSnapshot());
			expect(await controller.getWorkflowEligibility()).toEqual(fixture.session.getWorkflowEligibility());
			expect(await controller.getTurnLifecycle()).toEqual(fixture.session.getTurnLifecycle());
			await controller.close();
			await expect(controller.getSessionStats()).rejects.toBeInstanceOf(RunnerViewNotAttachedError);
			expect((await run(runner.snapshot())).status).toBe("running");
			fixture.releaseProviderResponses();
			await fixture.session.waitForIdle();
			await run(runner.stop());
		} finally {
			fixture.releaseProviderResponses();
			await Effect.runPromise(Scope.close(scope, Exit.void));
		}
	});
	it("reports an unavailable SSH reloader without consuming the generation", async () => {
		const fixture = await createLiveFixture();
		const scope = Scope.makeUnsafe("sequential");
		const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Scope.provide(scope)(effect));
		try {
			const runner = await run(makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 4 }));
			const controller = await createTerminalSessionController(runner, { viewId: "ssh-unavailable-terminal" });
			const initial = controller.snapshot();
			await expect(controller.refreshSshTool({ activateIfAvailable: true })).rejects.toBeInstanceOf(
				RunnerSshToolUnavailableError,
			);
			const refreshed = controller.snapshot();
			expect(refreshed.runner.toolConfigurationGeneration).toBe(initial.runner.toolConfigurationGeneration);
			expect(refreshed.runner.revision).toBe(initial.runner.revision);
			expect(refreshed.runner.sessionRevision).toBe(initial.runner.sessionRevision);
			await controller.close();
			await run(runner.stop());
		} finally {
			fixture.releaseProviderResponses();
			await Effect.runPromise(Scope.close(scope, Exit.void));
		}
	});

	it("refreshes SSH through the Promise controller and rolls back a failed prompt rebuild", async () => {
		const sshTool = (description: string): AgentTool => ({
			name: "ssh",
			label: "SSH",
			description,
			parameters: z.object({}),
			execute: async () => ({ content: [{ type: "text" as const, text: "ssh" }] }),
		});
		let reloadedSshTool: AgentTool | null = sshTool("SSH v1");
		const fixture = await createLiveFixture(false, async () => reloadedSshTool);
		const scope = Scope.makeUnsafe("sequential");
		const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Scope.provide(scope)(effect));
		try {
			const runner = await run(makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 8 }));
			const controller = await createTerminalSessionController(runner, { viewId: "ssh-refresh-terminal" });
			const initial = controller.snapshot();
			const available = await controller.refreshSshTool({ activateIfAvailable: true });
			expect(available.toolConfigurationGeneration).toBe(initial.runner.toolConfigurationGeneration + 1);
			expect(available.activeToolNames).toEqual(["alpha", "ssh"]);
			await controller.setActiveTools({ toolNames: ["alpha", "mcp__test_lookup", "ssh"] });

			const beforeFailure = controller.snapshot();
			const previousTools = fixture.session.agent.state.tools.map(tool => ({
				name: tool.name,
				description: tool.description,
			}));
			const previousPrompt = [...fixture.session.agent.state.systemPrompt];
			const previousMcpSelection = fixture.session.getSelectedMCPToolNames();
			reloadedSshTool = sshTool("SSH v2");
			fixture.failNextPromptRebuild();
			await expect(controller.refreshSshTool({ activateIfAvailable: true })).rejects.toBeInstanceOf(
				SessionRunnerRuntimeError,
			);
			const recovered = controller.snapshot();
			expect(
				fixture.session.agent.state.tools.map(tool => ({ name: tool.name, description: tool.description })),
			).toEqual(previousTools);
			expect(fixture.session.agent.state.systemPrompt).toEqual(previousPrompt);
			expect(fixture.session.getSelectedMCPToolNames()).toEqual(previousMcpSelection);
			expect(recovered.runner.toolConfigurationGeneration).toBe(
				beforeFailure.runner.toolConfigurationGeneration + 2,
			);
			expect(recovered.runner.revision).toBe(initial.runner.revision);
			expect(recovered.runner.sessionRevision).toBe(initial.runner.sessionRevision);
			await controller.close();
			await run(runner.stop());
		} finally {
			fixture.releaseProviderResponses();
			await Effect.runPromise(Scope.close(scope, Exit.void));
		}
	});

	it("fences stale SSH refresh generation and controller epoch without mutation", async () => {
		const fixture = await createLiveFixture(false, async () => null);
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 8 });
					const terminal = yield* runner.attachTerminalView(attach("ssh-fence-terminal", "controller", 0));
					const subscription = yield* terminal.subscribe();
					const initial = yield* terminal.snapshot();
					yield* Effect.promise(() => fixture.session.setActiveToolsByName(["beta"]));
					const command = (commandId: string, generation: number, epoch = terminal.epoch) =>
						decodeRefreshSshToolCommand({
							schemaVersion: 1,
							kind: "refreshSshTool",
							commandId,
							correlationId: commandId,
							viewId: terminal.viewId,
							controllerEpoch: epoch,
							expectedToolConfigurationGeneration: generation,
							activateIfAvailable: true,
						});
					const staleGeneration = yield* Effect.flip(terminal.refreshSshTool(command("ssh-stale", 0)));
					expect(staleGeneration).toBeInstanceOf(RunnerToolConfigurationConflictError);
					const staleEpoch = yield* Effect.flip(
						terminal.refreshSshTool(command("ssh-stale-epoch", 1, terminal.epoch + 1)),
					);
					expect(staleEpoch).toBeInstanceOf(StaleRunnerControllerLeaseError);
					expect(fixture.session.toolConfigurationGeneration).toBe(1);

					const receipt = yield* terminal.refreshSshTool(command("ssh-current", 1));
					expect(receipt.toolConfigurationGeneration).toBe(2);
					const delivery = yield* subscription.take;
					expect(delivery.kind).toBe("runnerEvent");
					if (delivery.kind !== "runnerEvent") throw new Error("expected runner event");
					expect(delivery.event.kind).toBe("sshToolRefreshed");
					const final = yield* terminal.snapshot();
					expect(final.runner.revision).toBe(initial.runner.revision);
					expect(final.runner.sessionRevision).toBe(initial.runner.sessionRevision);
					yield* terminal.detach();
					yield* runner.stop();
				}),
			),
		);
	});

	it("rejects live tool changes while a prompt is active without blocking snapshots", async () => {
		const fixture = await createLiveFixture(true);
		const scope = Scope.makeUnsafe("sequential");
		const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Scope.provide(scope)(effect));
		const bounded = async <A>(promise: Promise<A>): Promise<A> => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				return await Promise.race([
					promise,
					new Promise<never>((_, reject) => {
						timer = setTimeout(() => reject(new Error("operation blocked behind active prompt")), 500);
					}),
				]);
			} finally {
				if (timer) clearTimeout(timer);
			}
		};
		try {
			const runner = await run(makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 4 }));
			const controller = await createTerminalSessionController(runner, { viewId: "busy-tools-terminal" });
			const prompt = fixture.session.prompt("held tool configuration prompt");
			for (let attempt = 0; attempt < 100 && !fixture.session.isStreaming; attempt++) {
				await Bun.sleep(1);
			}
			expect(fixture.session.isStreaming).toBe(true);
			await expect(bounded(controller.setActiveTools({ toolNames: ["beta"] }))).rejects.toBeInstanceOf(
				SessionStateCommandInFlightError,
			);
			const snapshot = await bounded(controller.refresh());
			expect(snapshot.session.isStreaming).toBe(true);
			expect(snapshot.runner.toolConfigurationGeneration).toBe(0);
			fixture.releaseProviderResponses();
			await prompt;
			await controller.close();
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
							decodeSubmitInputCommand(submit(terminal.viewId, terminal.epoch, "concurrent-terminal-submit", 0)),
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
	it("interrupts only the exact live prompt generation without changing durable revisions", async () => {
		const fixture = await createLiveFixture(true);
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 8 });
					const observer = yield* runner.attachView(attach("interrupt-observer", "observer", 0));
					const controller = yield* runner.attachView(attach("interrupt-controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("expected controller");
					const subscription = yield* observer.subscribe();
					const before = yield* runner.snapshot();

					const firstPrompt = fixture.session.prompt("interrupt target");
					yield* Effect.promise(async () => {
						while (!fixture.session.promptOperation.active) await new Promise(resolve => setTimeout(resolve, 1));
					});
					const targetGeneration = fixture.session.promptOperation.generation;
					const command = decodeInterruptPromptCommand({
						schemaVersion: 1,
						kind: "interruptPrompt",
						commandId: "interrupt-once",
						correlationId: "interrupt-correlation",
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
						targetGeneration,
					});
					const receipt = yield* controller.interruptPrompt(command);
					expect(receipt).toEqual({
						commandId: "interrupt-once",
						correlationId: "interrupt-correlation",
						targetGeneration,
						interrupted: true,
					});
					yield* Effect.promise(() => firstPrompt);
					let interruptEventCount = 0;
					let observedTargetGeneration: number | undefined;
					for (let index = 0; index < 8; index += 1) {
						const delivery = yield* Effect.race(
							subscription.take,
							Effect.sleep("2 seconds").pipe(
								Effect.andThen(
									Effect.fail(
										new SessionRunnerRuntimeError({ issue: "Timed out awaiting prompt interrupt event" }),
									),
								),
							),
						);
						if (delivery.kind !== "event" || delivery.event.kind !== "promptInterrupted") continue;
						interruptEventCount += 1;
						observedTargetGeneration = delivery.event.targetGeneration;
						break;
					}
					expect(interruptEventCount).toBe(1);
					expect(observedTargetGeneration).toBe(targetGeneration);

					const secondPrompt = fixture.session.prompt("new prompt");
					yield* Effect.promise(async () => {
						while (
							!fixture.session.promptOperation.active ||
							fixture.session.promptOperation.generation === targetGeneration ||
							!fixture.providerInputs.includes("new prompt")
						) {
							await new Promise(resolve => setTimeout(resolve, 1));
						}
					});
					yield* Effect.promise(() => new Promise(resolve => setTimeout(resolve, 10)));
					const beforeStale = yield* runner.snapshot();
					const stale = yield* Effect.flip(controller.interruptPrompt(command));
					expect(stale).toBeInstanceOf(RunnerPromptOperationConflictError);
					expect(fixture.session.promptOperation.active).toBe(true);
					const after = yield* runner.snapshot();
					expect(after.revision).toBe(before.revision);
					expect(after.sessionRevision).toBe(beforeStale.sessionRevision);

					yield* observer.detach(detach(observer.viewId, after.revision));
					fixture.releaseProviderResponses();
					yield* Effect.promise(() => secondPrompt);
					yield* runner.stop();
				}).pipe(Effect.ensuring(Effect.sync(fixture.releaseProviderResponses))),
			),
		);
	});
	it("refreshes the Promise controller generation before interrupting a newly started prompt", async () => {
		const fixture = await createLiveFixture(true);
		let releaseNormalization!: () => void;
		const normalizationGate = new Promise<void>(resolve => {
			releaseNormalization = resolve;
		});
		vi.spyOn(imageLoading, "normalizeModelContextAttachments").mockImplementation(async attachments => {
			await normalizationGate;
			return attachments;
		});
		const scope = Scope.makeUnsafe("sequential");
		const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Scope.provide(scope)(effect));
		try {
			const runner = await run(makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 8 }));
			const controller = await createTerminalSessionController(runner, { viewId: "fresh-interrupt-controller" });
			const cachedGeneration = controller.snapshot().session.promptOperation.generation;
			const prompt = fixture.session.prompt("new live operation", {
				synthetic: true,
				attachments: [{ type: "image", data: "AA==", mimeType: "image/png" }],
			});
			while (!fixture.session.promptOperation.active) {
				await new Promise(resolve => setTimeout(resolve, 1));
			}
			expect(controller.snapshot().session.promptOperation.generation).toBe(cachedGeneration);
			const receipt = await controller.interruptPrompt({
				commandId: "fresh-generation-interrupt",
				correlationId: "fresh-generation-interrupt",
			});
			expect(receipt.targetGeneration).toBe(fixture.session.promptOperation.generation);
			expect(receipt.interrupted).toBe(true);
			releaseNormalization();
			await prompt;
			await controller.close();
			await run(runner.stop());
		} finally {
			releaseNormalization();
			fixture.releaseProviderResponses();
			await Effect.runPromise(Scope.close(scope, Exit.void));
		}
	});

	it("does not launch the provider when interrupted during image normalization", async () => {
		const fixture = await createLiveFixture();
		let releaseNormalization!: () => void;
		const normalizationGate = new Promise<void>(resolve => {
			releaseNormalization = resolve;
		});
		vi.spyOn(imageLoading, "normalizeModelContextAttachments").mockImplementation(async attachments => {
			await normalizationGate;
			return attachments;
		});
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 8 });
					const controller = yield* runner.attachView(attach("normalization-controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("expected controller");
					const prompt = fixture.session.prompt("normalize then interrupt", {
						synthetic: true,
						attachments: [{ type: "image", data: "AA==", mimeType: "image/png" }],
					});
					yield* Effect.promise(async () => {
						while (!fixture.session.promptOperation.active) await new Promise(resolve => setTimeout(resolve, 1));
					});
					const targetGeneration = fixture.session.promptOperation.generation;
					yield* controller.interruptPrompt(
						decodeInterruptPromptCommand({
							schemaVersion: 1,
							kind: "interruptPrompt",
							commandId: "interrupt-normalization",
							correlationId: "interrupt-normalization",
							viewId: controller.viewId,
							controllerEpoch: controller.controllerEpoch,
							targetGeneration,
						}),
					);
					releaseNormalization();
					yield* Effect.promise(() => prompt);
					expect(fixture.providerInputs).toHaveLength(0);
					expect(fixture.session.promptOperation).toEqual({ generation: targetGeneration, active: false });
					yield* runner.stop();
				}).pipe(Effect.ensuring(Effect.sync(releaseNormalization))),
			),
		);
	});

	it("delegates model cycling to AgentSession and reports its scoped thinking result", async () => {
		const fixture = await createLiveFixture();
		const scope = Scope.makeUnsafe("sequential");
		const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Scope.provide(scope)(effect));
		const cycleSpy = vi.spyOn(fixture.session, "cycleModel");
		try {
			const runner = await run(makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 8 }));
			const controller = await run(runner.attachView(attach("cycle-controller", "controller", 0)));
			if (controller.capability !== "controller") throw new Error("expected controller");
			const initial = await run(controller.snapshot());
			const initialModelId = fixture.session.model?.id;
			const receipt = await run(
				controller.cycleModel(
					decodeCycleModelCommand({
						schemaVersion: 1,
						kind: "cycleModel",
						commandId: "cycle-forward",
						correlationId: "cycle-forward",
						expectedSessionRevision: initial.sessionRevision,
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
						direction: "forward",
					}),
				),
			);
			expect(cycleSpy).toHaveBeenCalledWith("forward");
			expect(receipt.result?.id).not.toBe(initialModelId);
			expect(receipt.result?.isScoped).toBe(false);
			expect(receipt.result?.thinkingLevel).toBe(fixture.session.thinkingLevel);
			expect(fixture.session.model?.id).toBe(receipt.result?.id);
			expect(
				await run(
					controller.cycleModel(
						decodeCycleModelCommand({
							schemaVersion: 1,
							kind: "cycleModel",
							commandId: "cycle-replay",
							correlationId: "cycle-forward",
							expectedSessionRevision: receipt.sessionRevision,
							viewId: controller.viewId,
							controllerEpoch: controller.controllerEpoch,
							direction: "backward",
						}),
					),
				),
			).toMatchObject({ result: { id: initialModelId } });
			await run(runner.stop());
		} finally {
			await Effect.runPromise(Scope.close(scope, Exit.void));
		}
	});

	it("fails an extension-cancelled reload without advancing checkpoint projection", async () => {
		const fixture = await createLiveFixture();
		vi.spyOn(fixture.session, "reload").mockResolvedValue(false);
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 8 });
					const controller = yield* runner.attachView(attach("cancelled-reload-controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("expected controller");
					const before = yield* controller.snapshot();
					const command = decodeReloadSessionCommand({
						schemaVersion: 1,
						kind: "reloadSession",
						commandId: "reload-cancelled",
						correlationId: "reload-cancelled",
						expectedSessionRevision: before.sessionRevision,
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
					});
					yield* Effect.flip(controller.reload(command)).pipe(
						Effect.tap(error =>
							Effect.sync(() => expect(error).toBeInstanceOf(RunnerSessionReloadCancelledError)),
						),
					);
					const after = yield* controller.snapshot();
					expect(after.sequence).toBe(before.sequence);
					expect(after.checkpointRevision).toBe(before.checkpointRevision);
					expect(after.checkpointState).toEqual(before.checkpointState);
					yield* runner.stop();
				}),
			),
		);
	});

	it("supervises shake and handoff while checkpoint and reload commands remain fenced", async () => {
		const fixture = await createLiveFixture();
		const shakeGate = Promise.withResolvers<void>();
		const handoffGate = Promise.withResolvers<void>();
		let handoffSignal: AbortSignal | undefined;
		const shakeSpy = vi.spyOn(fixture.session, "shake").mockImplementation(async mode => {
			await shakeGate.promise;
			return {
				mode,
				toolResultsDropped: 2,
				blocksDropped: 1,
				tokensFreed: 32,
				artifactId: "shake-artifact",
			};
		});
		const handoffSpy = vi
			.spyOn(fixture.session, "handoff")
			.mockImplementation(async (_customInstructions, options) => {
				handoffSignal = options?.signal;
				await handoffGate.promise;
				if (handoffSignal?.aborted) throw new Error("Handoff cancelled");
				return { document: "handoff document" };
			});
		const reloadSpy = vi.spyOn(fixture.session, "reload").mockResolvedValue(true);

		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 8 });
					const controller = yield* runner.attachView(attach("session-operation-controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("expected controller");
					const initial = yield* controller.snapshot();
					const shakeCommand = decodeRunShakeCommand({
						schemaVersion: 1,
						kind: "runShake",
						commandId: "shake-once",
						correlationId: "shake-once",
						expectedSessionRevision: initial.sessionRevision,
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
						mode: "elide",
					});
					const shaking = yield* Effect.forkChild(controller.shake(shakeCommand));
					while ((yield* runner.snapshot()).activeSessionOperation?.kind !== "shake") {
						yield* Effect.sleep("1 millis");
					}
					const checkpointRead = yield* controller.getCheckpointState(
						decodeGetCheckpointStateCommand({
							schemaVersion: 1,
							kind: "getCheckpointState",
							commandId: "checkpoint-before",
							correlationId: "checkpoint-before",
							viewId: controller.viewId,
							controllerEpoch: controller.controllerEpoch,
						}),
					);
					expect(checkpointRead.state).toBeUndefined();
					const checkpointWrite = yield* controller.setCheckpointState(
						decodeSetCheckpointStateCommand({
							schemaVersion: 1,
							kind: "setCheckpointState",
							commandId: "checkpoint-set",
							correlationId: "checkpoint-set",
							viewId: controller.viewId,
							controllerEpoch: controller.controllerEpoch,
							expectedCheckpointRevision: checkpointRead.checkpointRevision,
							state: {
								checkpointMessageCount: 3,
								checkpointEntryId: null,
								startedAt: "2026-01-01T00:00:00.000Z",
							},
						}),
					);
					expect(checkpointWrite.checkpointRevision).toBe(1);
					expect((yield* runner.snapshot()).activeSessionOperation?.kind).toBe("shake");
					shakeGate.resolve();
					const shakeReceipt = yield* Fiber.join(shaking);
					expect(shakeReceipt.result.tokensFreed).toBe(32);
					expect(yield* controller.shake(shakeCommand)).toEqual({ ...shakeReceipt, replayed: true });
					expect(shakeSpy).toHaveBeenCalledTimes(1);

					const afterShake = yield* controller.snapshot();
					const handoffCommand = decodeRunHandoffCommand({
						schemaVersion: 1,
						kind: "runHandoff",
						commandId: "handoff-cancelled",
						correlationId: "handoff-cancelled",
						expectedSessionRevision: afterShake.sessionRevision,
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
					});
					const handingOff = yield* Effect.forkChild(controller.handoff(handoffCommand));
					while (handoffSignal === undefined) yield* Effect.sleep("1 millis");
					const active = (yield* runner.snapshot()).activeSessionOperation;
					if (active?.kind !== "handoff") throw new Error("expected active handoff");
					yield* controller.cancelHandoff(
						decodeCancelHandoffCommand({
							schemaVersion: 1,
							kind: "cancelHandoff",
							commandId: "cancel-handoff",
							correlationId: "cancel-handoff",
							viewId: controller.viewId,
							controllerEpoch: controller.controllerEpoch,
							targetCommandId: active.commandId,
							targetOperationGeneration: active.operationGeneration,
						}),
					);
					expect(handoffSignal?.aborted).toBe(true);
					handoffGate.resolve();
					expect(yield* Effect.flip(Fiber.join(handingOff))).toBeInstanceOf(SessionRunnerRuntimeError);
					expect(handoffSpy).toHaveBeenCalledTimes(1);

					const beforeReload = yield* controller.snapshot();
					const reloadEvents = yield* controller.subscribe();
					const reloadCommand = decodeReloadSessionCommand({
						schemaVersion: 1,
						kind: "reloadSession",
						commandId: "reload-once",
						correlationId: "reload-once",
						expectedSessionRevision: beforeReload.sessionRevision,
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
					});
					const reloadReceipt = yield* controller.reload(reloadCommand);
					expect(reloadReceipt.sessionId).toBe(fixture.session.sessionId);
					const checkpointEvent = yield* reloadEvents.take;
					const reloadedEvent = yield* reloadEvents.take;
					expect(checkpointEvent.kind).toBe("event");
					expect(reloadedEvent.kind).toBe("event");
					if (checkpointEvent.kind !== "event" || reloadedEvent.kind !== "event") {
						throw new Error("expected ordered reload events");
					}
					expect(checkpointEvent.event.kind).toBe("checkpointChanged");
					expect(reloadedEvent.event.kind).toBe("sessionReloaded");
					const afterReload = yield* controller.snapshot();
					expect(afterReload.checkpointRevision).toBe(checkpointWrite.checkpointRevision + 1);
					expect(afterReload.checkpointState).toBeUndefined();
					expect(yield* controller.reload(reloadCommand)).toEqual({ ...reloadReceipt, replayed: true });
					expect(reloadSpy).toHaveBeenCalledTimes(1);
					yield* runner.stop();
				}),
			),
		);
	});

	it("supervises live compaction without occupying the mailbox and replays one retained result", async () => {
		const fixture = await createLiveFixture();
		fixture.settings.set("compaction.keepRecentTokens", 1);
		await fixture.session.prompt("first compactable turn", { synthetic: true });
		await fixture.session.prompt("second compactable turn", { synthetic: true });
		let releaseCompaction!: () => void;
		const compactionGate = new Promise<void>(resolve => {
			releaseCompaction = resolve;
		});
		const compactSpy = vi.spyOn(compactionModule, "compact").mockImplementation(async preparation => {
			await compactionGate;
			return {
				summary: "held runner compaction",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
			};
		});
		const abortCompactionSpy = vi.spyOn(fixture.session, "abortCompaction").mockImplementation(() => {});
		let releaseSecondCompaction = () => {};
		let releaseReusedCompaction = () => {};
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 2 });
					const observer = yield* runner.attachView(attach("compaction-observer", "observer", 0));
					const controller = yield* runner.attachView(attach("compaction-controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("expected controller");
					const subscription = yield* controller.subscribe();
					const initial = yield* controller.snapshot();
					const command = decodeRunCompactionCommand({
						schemaVersion: 1,
						kind: "runCompaction",
						commandId: "manual-compaction",
						correlationId: "manual-compaction-correlation",
						expectedSessionRevision: initial.sessionRevision,
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
					});

					const firstFiber = yield* Effect.forkChild(controller.compact(command));
					yield* Effect.promise(async () => {
						while (compactSpy.mock.calls.length === 0) await new Promise(resolve => setTimeout(resolve, 1));
					});
					const heldSnapshot = yield* runner.snapshot();
					expect(heldSnapshot.status).toBe("running");
					expect(heldSnapshot.activeCompaction).toEqual({
						commandId: command.commandId,
						operationGeneration: 1,
						startedSessionRevision: initial.sessionRevision,
					});
					const cancelCommand = decodeCancelCompactionCommand({
						schemaVersion: 1,
						kind: "cancelCompaction",
						commandId: "cancel-manual-compaction",
						correlationId: "cancel-manual-compaction",
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
						targetCommandId: command.commandId,
						targetOperationGeneration: heldSnapshot.activeCompaction!.operationGeneration,
					});
					const abortCallsBeforeCancel = abortCompactionSpy.mock.calls.length;
					const cancelReceipt = yield* controller.cancelCompaction(cancelCommand);
					expect(cancelReceipt.targetCommandId).toBe(command.commandId);
					expect(cancelReceipt.targetOperationGeneration).toBe(heldSnapshot.activeCompaction!.operationGeneration);
					expect(abortCompactionSpy).toHaveBeenCalledTimes(abortCallsBeforeCancel + 1);
					yield* controller.cancelCompaction({
						...cancelCommand,
						commandId: "duplicate-cancel",
						correlationId: "duplicate-cancel",
					});
					expect(abortCompactionSpy).toHaveBeenCalledTimes(abortCallsBeforeCancel + 1);
					const staleCancel = yield* Effect.flip(
						controller.cancelCompaction({
							...cancelCommand,
							commandId: "stale-cancel",
							correlationId: "stale-cancel",
							targetCommandId: "older-compaction",
						}),
					);
					expect(staleCancel).toBeInstanceOf(RunnerCompactionTargetError);
					expect(abortCompactionSpy).toHaveBeenCalledTimes(abortCallsBeforeCancel + 1);
					const cancelDelivery = yield* subscription.take;
					expect(cancelDelivery.kind).toBe("event");
					if (cancelDelivery.kind === "event") {
						expect(cancelDelivery.event.kind).toBe("compactionCancelRequested");
						expect(cancelDelivery.event.targetCommandId).toBe(command.commandId);
						expect(cancelDelivery.event.targetOperationGeneration).toBe(
							heldSnapshot.activeCompaction!.operationGeneration,
						);
					}
					expect((yield* runner.snapshot()).revision).toBe(initial.revision);

					const staleEpoch = yield* Effect.flip(
						controller.compact(
							decodeRunCompactionCommand({
								...command,
								commandId: "stale-compaction-epoch",
								correlationId: "stale-compaction-epoch",
								controllerEpoch: controller.controllerEpoch + 1,
							}),
						),
					);
					expect(staleEpoch).toBeInstanceOf(StaleRunnerControllerLeaseError);
					const staleRevision = yield* Effect.flip(
						controller.compact(
							decodeRunCompactionCommand({
								...command,
								commandId: "stale-compaction-revision",
								correlationId: "stale-compaction-revision",
								expectedSessionRevision: initial.sessionRevision + 1,
							}),
						),
					);
					const secondWhileActive = yield* Effect.flip(
						controller.compact(
							decodeRunCompactionCommand({
								...command,
								commandId: "second-active-compaction",
								correlationId: "second-active-compaction",
							}),
						),
					);
					expect(secondWhileActive).toBeInstanceOf(RunnerCompactionUnavailableError);
					expect(staleRevision).toBeInstanceOf(SessionRevisionConflictError);
					const conflicting = yield* Effect.flip(
						controller.compact(
							decodeRunCompactionCommand({
								...command,
								customInstructions: "different command content",
							}),
						),
					);
					expect(conflicting).toBeInstanceOf(RunnerCompactionCommandConflictError);

					const duplicateFiber = yield* Effect.forkChild(controller.compact(command));
					expect(compactSpy).toHaveBeenCalledTimes(1);
					releaseCompaction();
					const first = yield* Fiber.join(firstFiber);
					const duplicate = yield* Fiber.join(duplicateFiber);
					expect(first.replayed).toBe(false);
					expect(duplicate).toEqual({ ...first, replayed: true });
					const retained = yield* controller.compact(command);
					expect(retained).toEqual({ ...first, replayed: true });

					let completionEvents = 0;
					while (completionEvents === 0) {
						const delivery = yield* subscription.take;
						if (delivery.kind !== "resyncRequired" && delivery.event.kind === "compactionCompleted") {
							completionEvents += 1;
						}
					}
					expect(completionEvents).toBe(1);
					yield* observer.detach(detach(observer.viewId, heldSnapshot.revision));
					expect(compactSpy).toHaveBeenCalledTimes(1);
					const completed = yield* runner.snapshot();
					expect(completed.activeCompaction).toBeUndefined();
					expect(completed.revision).toBe(initial.revision);
					expect(completed.sessionRevision).toBeGreaterThan(initial.sessionRevision);
					expect(first.startedSessionRevision).toBe(initial.sessionRevision);
					expect(first.completedSessionRevision).toBe(completed.sessionRevision);
					yield* Effect.promise(() => fixture.session.prompt("third compactable turn", { synthetic: true }));
					yield* Effect.promise(() => fixture.session.prompt("fourth compactable turn", { synthetic: true }));
					const beforeSecond = yield* runner.snapshot();
					const secondGate = new Promise<void>(resolve => {
						releaseSecondCompaction = resolve;
					});
					compactSpy.mockImplementationOnce(async preparation => {
						await secondGate;
						return {
							summary: "second held runner compaction",
							firstKeptEntryId: preparation.firstKeptEntryId,
							tokensBefore: preparation.tokensBefore,
						};
					});
					const secondCommand = decodeRunCompactionCommand({
						...command,
						commandId: "newer-manual-compaction",
						correlationId: "newer-manual-compaction",
						expectedSessionRevision: beforeSecond.sessionRevision,
					});
					const secondFiber = yield* Effect.forkChild(controller.compact(secondCommand));
					yield* Effect.promise(async () => {
						while (compactSpy.mock.calls.length < 2) await new Promise(resolve => setTimeout(resolve, 1));
					});
					const abortCallsBeforeDelayedCancel = abortCompactionSpy.mock.calls.length;
					const delayedOldCancel = yield* Effect.flip(
						controller.cancelCompaction({
							...cancelCommand,
							commandId: "delayed-old-cancel",
							correlationId: "delayed-old-cancel",
						}),
					);
					expect(delayedOldCancel).toBeInstanceOf(RunnerCompactionTargetError);
					expect(abortCompactionSpy).toHaveBeenCalledTimes(abortCallsBeforeDelayedCancel);
					expect((yield* runner.snapshot()).activeCompaction?.commandId).toBe(secondCommand.commandId);
					releaseSecondCompaction();
					yield* Fiber.join(secondFiber);
					yield* Effect.promise(() => fixture.session.prompt("fifth compactable turn", { synthetic: true }));
					yield* Effect.promise(() => fixture.session.prompt("sixth compactable turn", { synthetic: true }));
					const beforeEvictor = yield* runner.snapshot();
					yield* controller.compact(
						decodeRunCompactionCommand({
							...command,
							commandId: "compaction-record-evictor",
							correlationId: "compaction-record-evictor",
							expectedSessionRevision: beforeEvictor.sessionRevision,
						}),
					);
					yield* Effect.promise(() => fixture.session.prompt("seventh compactable turn", { synthetic: true }));
					yield* Effect.promise(() => fixture.session.prompt("eighth compactable turn", { synthetic: true }));
					const beforeReused = yield* runner.snapshot();
					const reusedGate = new Promise<void>(resolve => {
						releaseReusedCompaction = resolve;
					});
					compactSpy.mockImplementationOnce(async preparation => {
						await reusedGate;
						return {
							summary: "reused-id held runner compaction",
							firstKeptEntryId: preparation.firstKeptEntryId,
							tokensBefore: preparation.tokensBefore,
						};
					});
					const reusedCommand = decodeRunCompactionCommand({
						...command,
						correlationId: "reused-manual-compaction",
						expectedSessionRevision: beforeReused.sessionRevision,
					});
					const reusedFiber = yield* Effect.forkChild(controller.compact(reusedCommand));
					yield* Effect.promise(async () => {
						while (compactSpy.mock.calls.length < 4) await new Promise(resolve => setTimeout(resolve, 1));
					});
					const reusedActive = (yield* runner.snapshot()).activeCompaction;
					expect(reusedActive?.commandId).toBe(command.commandId);
					expect(reusedActive?.operationGeneration).not.toBe(cancelCommand.targetOperationGeneration);
					const abortCallsBeforeSameIdCancel = abortCompactionSpy.mock.calls.length;
					const staleSameIdCancel = yield* Effect.flip(
						controller.cancelCompaction({
							...cancelCommand,
							commandId: "delayed-old-generation-cancel",
							correlationId: "delayed-old-generation-cancel",
						}),
					);
					expect(staleSameIdCancel).toBeInstanceOf(RunnerCompactionTargetError);
					expect(abortCompactionSpy).toHaveBeenCalledTimes(abortCallsBeforeSameIdCancel);
					expect((yield* runner.snapshot()).activeCompaction).toEqual(reusedActive);
					releaseReusedCompaction();
					yield* Fiber.join(reusedFiber);
					yield* runner.stop();
				}).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							releaseCompaction();
							releaseSecondCompaction();
							releaseReusedCompaction();
						}),
					),
				),
			),
		);
	});

	it("resolves held compaction waiters with a typed stop failure", async () => {
		const fixture = await createLiveFixture();
		fixture.settings.set("compaction.keepRecentTokens", 1);
		await fixture.session.prompt("first stop-compaction turn", { synthetic: true });
		await fixture.session.prompt("second stop-compaction turn", { synthetic: true });
		let releaseCompaction!: () => void;
		const compactionGate = new Promise<void>(resolve => {
			releaseCompaction = resolve;
		});
		const compactSpy = vi.spyOn(compactionModule, "compact").mockImplementation(async preparation => {
			await compactionGate;
			return {
				summary: "should be interrupted by stop",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
			};
		});

		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 2 });
					const controller = yield* runner.attachView(attach("stop-compaction-controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("expected controller");
					const initial = yield* controller.snapshot();
					const compacting = yield* Effect.forkChild(
						controller.compact(
							decodeRunCompactionCommand({
								schemaVersion: 1,
								kind: "runCompaction",
								commandId: "stop-compaction",
								correlationId: "stop-compaction",
								expectedSessionRevision: initial.sessionRevision,
								viewId: controller.viewId,
								controllerEpoch: controller.controllerEpoch,
							}),
						),
					);
					yield* Effect.promise(async () => {
						while (compactSpy.mock.calls.length === 0) await new Promise(resolve => setTimeout(resolve, 1));
					});
					const stopping = yield* Effect.forkChild(runner.stop());
					const failure = yield* Effect.flip(Fiber.join(compacting));
					expect(failure).toBeInstanceOf(SessionRunnerStoppedError);
					releaseCompaction();
					yield* Fiber.join(stopping);
					expect(fixture.sessionManager.getEntries().filter(entry => entry.type === "compaction")).toHaveLength(0);
				}).pipe(Effect.ensuring(Effect.sync(releaseCompaction))),
			),
		);
	});

	it("retains a typed compaction failure and does not rerun it", async () => {
		const fixture = await createLiveFixture();
		fixture.settings.set("compaction.keepRecentTokens", 1);
		await fixture.session.prompt("first failing-compaction turn", { synthetic: true });
		await fixture.session.prompt("second failing-compaction turn", { synthetic: true });
		const compactSpy = vi.spyOn(compactionModule, "compact").mockRejectedValue(new Error("held provider failed"));

		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 2 });
					const controller = yield* runner.attachView(attach("failed-compaction-controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("expected controller");
					const initial = yield* controller.snapshot();
					const command = decodeRunCompactionCommand({
						schemaVersion: 1,
						kind: "runCompaction",
						commandId: "failed-compaction",
						correlationId: "failed-compaction",
						expectedSessionRevision: initial.sessionRevision,
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
					});
					const first = yield* Effect.flip(controller.compact(command));
					const replayed = yield* Effect.flip(controller.compact(command));
					expect(first).toBeInstanceOf(SessionRunnerRuntimeError);
					expect(replayed).toBe(first);
					expect(compactSpy).toHaveBeenCalledTimes(1);
					expect(fixture.sessionManager.getEntries().filter(entry => entry.type === "compaction")).toHaveLength(0);
					yield* runner.stop();
				}),
			),
		);
	});

	it("fences live tool configuration and rolls back failed prompt rebuilds", async () => {
		const fixture = await createLiveFixture();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 4, eventCapacity: 8 });
					const terminal = yield* runner.attachTerminalView(attach("tools-terminal", "controller", 0));
					const initial = yield* terminal.snapshot();
					expect(initial.runner.toolConfigurationGeneration).toBe(0);
					expect(initial.session.activeToolNames).toEqual(["alpha"]);

					const command = (commandId: string, generation: number, toolNames: string[]) =>
						decodeSetActiveToolsCommand({
							schemaVersion: 1,
							kind: "setActiveTools",
							commandId,
							correlationId: commandId,
							viewId: terminal.viewId,
							controllerEpoch: terminal.epoch,
							expectedToolConfigurationGeneration: generation,
							toolNames,
						});
					const changed = yield* terminal.setActiveTools(command("tools-beta", 0, ["beta"]));
					expect(changed.toolConfigurationGeneration).toBe(1);
					expect(changed.activeToolNames).toEqual(["beta"]);
					yield* Effect.promise(() => fixture.session.setActiveToolsByName(["alpha"]));
					yield* Effect.promise(() => fixture.session.setActiveToolsByName(["beta"]));
					expect(fixture.session.toolConfigurationGeneration).toBe(3);

					const stale = yield* Effect.flip(terminal.setActiveTools(command("tools-stale", 1, ["alpha"])));
					expect(stale).toBeInstanceOf(RunnerToolConfigurationConflictError);
					expect(fixture.session.getActiveToolNames()).toEqual(["beta"]);

					const unknown = yield* Effect.flip(terminal.setActiveTools(command("tools-unknown", 3, ["missing"])));
					expect(unknown).toBeInstanceOf(InvalidRunnerCommandError);
					expect(fixture.session.getActiveToolNames()).toEqual(["beta"]);

					const previousPrompt = fixture.session.agent.state.systemPrompt;
					fixture.failNextPromptRebuild();
					yield* Effect.flip(terminal.setActiveTools(command("tools-fail", 3, ["alpha"])));
					expect(fixture.session.getActiveToolNames()).toEqual(["beta"]);
					expect(fixture.session.agent.state.systemPrompt).toEqual(previousPrompt);
					expect((yield* terminal.snapshot()).runner.toolConfigurationGeneration).toBe(5);

					const recovered = yield* terminal.setActiveTools(command("tools-recover", 5, ["alpha"]));
					expect(recovered.toolConfigurationGeneration).toBe(6);
					expect(recovered.activeToolNames).toEqual(["alpha"]);
					const mcpEntryCount = fixture.sessionManager
						.getEntries()
						.filter(entry => entry.type === "mcp_tool_selection").length;
					const mcpChanged = yield* terminal.setActiveTools(command("tools-mcp", 6, ["mcp__test_lookup"]));
					expect(mcpChanged.toolConfigurationGeneration).toBe(7);
					expect(
						fixture.sessionManager.getEntries().filter(entry => entry.type === "mcp_tool_selection"),
					).toHaveLength(mcpEntryCount);

					const held = fixture.holdNextPromptRebuild();
					const external = yield* Effect.forkScoped(Effect.promise(() => fixture.session.refreshMCPTools([])));
					yield* Effect.promise(() => held.started.promise);
					const concurrentCommand = yield* Effect.forkScoped(
						terminal.setActiveTools(command("tools-concurrent", 7, ["alpha"])),
					);
					held.release.resolve();
					yield* Fiber.join(external);
					const concurrentConflict = yield* Effect.flip(Fiber.join(concurrentCommand));
					expect(concurrentConflict).toBeInstanceOf(RunnerToolConfigurationConflictError);
					expect(fixture.session.toolConfigurationGeneration).toBe(8);
					expect(fixture.session.getActiveToolNames()).toEqual([]);
					expect(() => command("tools-duplicate", 8, ["alpha", "alpha"])).toThrow(InvalidRunnerCommandError);
					yield* terminal.detach();
					yield* runner.stop();
				}),
			),
		);
	});

	it("streams real bash output in order while snapshots and view detach remain responsive", async () => {
		const fixture = await createLiveFixture();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 8 });
					const controller = yield* runner.attachView(attach("local-controller", "controller", 0));
					const observer = yield* runner.attachView(attach("local-observer", "observer", 0));
					if (controller.capability !== "controller") throw new Error("expected controller");
					const subscription = yield* observer.subscribe();
					const initial = yield* runner.snapshot();
					const startedRevision = fixture.sessionManager.getSessionRevision();
					const command = decodeRunLocalOperationCommand({
						schemaVersion: 1,
						kind: "runLocalOperation",
						commandId: "streaming-bash",
						correlationId: "streaming-bash-correlation",
						expectedSessionRevision: startedRevision,
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
						operation: {
							kind: "bash",
							command: "printf first; sleep 0.15; printf second",
							excludeFromContext: false,
							useUserShell: true,
						},
					});
					const running = yield* Effect.forkScoped(controller.runLocalOperation(command));
					while ((yield* runner.snapshot()).activeLocalOperation === undefined) {
						yield* Effect.sleep("1 millis");
					}
					const during = yield* runner.snapshot();
					expect(during.revision).toBe(initial.revision);
					expect(during.activeLocalOperation?.commandId).toBe(command.commandId);
					let firstChunk = "";
					while (firstChunk.length === 0) {
						const delivery = yield* subscription.take;
						if (delivery.event.kind === "localOperationOutput") {
							firstChunk = delivery.event.localOperationOutput?.chunk ?? "";
						}
					}
					expect(firstChunk).toBe("first");
					yield* observer.detach(detach(observer.viewId, initial.revision));

					const receipt = yield* Fiber.join(running);
					expect(receipt.result.output.text).toBe("firstsecond");
					expect(receipt.result.exitCode).toBe(0);
					expect(receipt.result.cancelled).toBe(false);
					expect(receipt.startedSessionRevision).toBe(startedRevision);
					expect(receipt.completedSessionRevision).toBe(startedRevision + 1);
					expect((yield* runner.snapshot()).revision).toBe(initial.revision);
					expect(receipt.result.output.text.startsWith(firstChunk)).toBe(true);
					const finalMessage = fixture.session.messages.at(-1);
					expect(finalMessage?.role).toBe("bashExecution");
					if (finalMessage?.role !== "bashExecution") throw new Error("expected bash transcript entry");
					if (command.operation.kind !== "bash") throw new Error("expected bash command");
					expect(finalMessage.command).toBe(command.operation.command);
					expect(finalMessage.output).toBe("firstsecond");

					const replay = yield* controller.runLocalOperation(command);
					expect(replay).toEqual({ ...receipt, replayed: true });
					expect(fixture.session.messages.filter(message => message.role === "bashExecution")).toHaveLength(1);
					yield* controller.detach(detach(controller.viewId, initial.revision, controller.controllerEpoch));
					yield* runner.stop();
				}),
			),
		);
	});

	it("bounds pending tiny output and resets consumers to the retained projection", async () => {
		const fixture = await createLiveFixture();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 512 });
					const controller = yield* runner.attachView(attach("tiny-output-controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("expected controller");
					const subscription = yield* controller.subscribe();
					const chunk = "abcdefghijklmnop";
					const fullOutput = chunk.repeat(20_004);
					const executionStarted = Promise.withResolvers<void>();
					const releaseExecution = Promise.withResolvers<void>();
					fixture.session.executeBash = async (_command, onOutput) => {
						for (let index = 0; index < 4; index++) onOutput?.(chunk);
						await Bun.sleep(10);
						for (let index = 0; index < 20_000; index++) onOutput?.(chunk);
						executionStarted.resolve();
						await releaseExecution.promise;
						return {
							output: fullOutput,
							exitCode: 0,
							cancelled: false,
							truncated: false,
							totalLines: 1,
							totalBytes: Buffer.byteLength(fullOutput),
							outputLines: 1,
							outputBytes: Buffer.byteLength(fullOutput),
						};
					};
					let projected = "";
					let sawReset = false;
					const outputMetadata: Array<{ totalBytes: number; truncated: boolean }> = [];
					const consume = yield* Effect.forkScoped(
						Effect.gen(function* () {
							while (true) {
								const delivery = yield* subscription.take;
								if (delivery.event.kind === "localOperationOutput") {
									const output = delivery.event.localOperationOutput;
									if (output) {
										projected = output.reset ? output.chunk : projected + output.chunk;
										sawReset ||= output.reset;
										outputMetadata.push({
											totalBytes: output.totalBytes,
											truncated: output.truncated,
										});
									}
								}
								if (delivery.event.kind === "localOperationCompleted") return;
							}
						}),
					);
					const running = yield* Effect.forkScoped(
						controller.runLocalOperation(
							decodeRunLocalOperationCommand({
								schemaVersion: 1,
								kind: "runLocalOperation",
								commandId: "tiny-output-bash",
								correlationId: "tiny-output-bash-correlation",
								expectedSessionRevision: fixture.sessionManager.getSessionRevision(),
								viewId: controller.viewId,
								controllerEpoch: controller.controllerEpoch,
								operation: {
									kind: "bash",
									command: "synchronous-test-producer",
									excludeFromContext: true,
									useUserShell: true,
								},
							}),
						),
					);
					yield* Effect.promise(() => executionStarted.promise);
					let active = (yield* runner.snapshot()).activeLocalOperation;
					if (active === undefined) throw new Error("expected active local operation");
					while (projected !== active.output.text) {
						yield* Effect.sleep("1 millis");
						active = (yield* runner.snapshot()).activeLocalOperation;
						if (active === undefined) throw new Error("expected active local operation");
					}
					expect(active.output.totalBytes).toBe(Buffer.byteLength(fullOutput));
					expect(active.peakPendingOutputChunks).toBeLessThanOrEqual(32);
					expect(active.peakPendingOutputBytes).toBeLessThanOrEqual(256 * 1024);
					expect(outputMetadata.length).toBeGreaterThan(1);
					for (let index = 1; index < outputMetadata.length; index++) {
						expect(outputMetadata[index]!.totalBytes).toBeGreaterThan(outputMetadata[index - 1]!.totalBytes);
					}
					expect(outputMetadata.every(metadata => metadata.truncated === metadata.totalBytes > 256 * 1024)).toBe(
						true,
					);
					expect(sawReset).toBe(true);
					expect(projected).toBe(active.output.text);
					releaseExecution.resolve();
					yield* Fiber.join(running);
					yield* Fiber.join(consume);
					yield* controller.detach(
						detach(controller.viewId, (yield* runner.snapshot()).revision, controller.controllerEpoch),
					);
					yield* runner.stop();
				}),
			),
		);
	});

	it("bounds real bash output and retains non-zero results with included and excluded transcript revisions", async () => {
		const fixture = await createLiveFixture();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 4 });
					const controller = yield* runner.attachView(attach("bounded-controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("expected controller");
					const inputRevision = (yield* runner.snapshot()).revision;
					const firstSessionRevision = fixture.sessionManager.getSessionRevision();
					const bounded = yield* controller.runLocalOperation(
						decodeRunLocalOperationCommand({
							schemaVersion: 1,
							kind: "runLocalOperation",
							commandId: "bounded-bash",
							correlationId: "bounded-bash-correlation",
							expectedSessionRevision: firstSessionRevision,
							viewId: controller.viewId,
							controllerEpoch: controller.controllerEpoch,
							operation: {
								kind: "bash",
								command: "python3 -c 'import sys; sys.stdout.write(\"€\" * 100000)'",
								excludeFromContext: true,
								useUserShell: true,
							},
						}),
					);
					expect(bounded.result.output.totalBytes).toBe(300_000);
					expect(Buffer.byteLength(bounded.result.output.text)).toBeLessThanOrEqual(256 * 1024);
					expect(bounded.result.output.text).not.toContain("\uFFFD");
					expect(bounded.result.output.truncated).toBe(true);
					expect(bounded.completedSessionRevision).toBe(firstSessionRevision + 1);
					const excluded = fixture.session.messages.at(-1);
					expect(excluded?.role).toBe("bashExecution");
					if (excluded?.role !== "bashExecution") throw new Error("expected excluded bash transcript entry");
					expect(excluded.excludeFromContext).toBe(true);

					const retained = yield* controller.runLocalOperation(
						decodeRunLocalOperationCommand({
							schemaVersion: 1,
							kind: "runLocalOperation",
							commandId: "failed-bash",
							correlationId: "failed-bash-correlation",
							expectedSessionRevision: bounded.completedSessionRevision,
							viewId: controller.viewId,
							controllerEpoch: controller.controllerEpoch,
							operation: {
								kind: "bash",
								command: "printf retained-failure; exit 7",
								excludeFromContext: false,
								useUserShell: true,
							},
						}),
					);
					expect(retained.result.exitCode).toBe(7);
					expect(retained.result.cancelled).toBe(false);
					expect(retained.result.output.text).toBe("retained-failure");
					expect(retained.completedSessionRevision).toBe(bounded.completedSessionRevision + 1);
					expect((yield* runner.snapshot()).revision).toBe(inputRevision);
					const included = fixture.session.messages.at(-1);
					expect(included?.role).toBe("bashExecution");
					if (included?.role !== "bashExecution") throw new Error("expected included bash transcript entry");
					expect(included.excludeFromContext).toBe(false);
					yield* runner.stop();
				}),
			),
		);
	});

	it("fences duplicate, conflicting, stale-lease, exact-cancel, and same-ID ABA local operations", async () => {
		const fixture = await createLiveFixture();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 1 });
					const controller = yield* runner.attachView(attach("cancel-controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("expected controller");
					const makeRun = (commandId: string, command: string) =>
						decodeRunLocalOperationCommand({
							schemaVersion: 1,
							kind: "runLocalOperation",
							commandId,
							correlationId: `${commandId}-correlation`,
							expectedSessionRevision: fixture.sessionManager.getSessionRevision(),
							viewId: controller.viewId,
							controllerEpoch: controller.controllerEpoch,
							operation: {
								kind: "bash",
								command,
								excludeFromContext: true,
								useUserShell: true,
							},
						});
					const staleRevisionCommand = makeRun("stale-session", "printf forbidden");
					const staleRevision = yield* Effect.flip(
						controller.runLocalOperation(
							decodeRunLocalOperationCommand({
								...staleRevisionCommand,
								expectedSessionRevision: staleRevisionCommand.expectedSessionRevision + 1,
							}),
						),
					);
					expect(staleRevision).toBeInstanceOf(SessionRevisionConflictError);
					const first = yield* controller.runLocalOperation(makeRun("aba", "printf first"));
					const conflict = yield* Effect.flip(controller.runLocalOperation(makeRun("aba", "printf conflict")));
					expect(conflict).toBeInstanceOf(RunnerLocalOperationCommandConflictError);
					yield* controller.runLocalOperation(makeRun("evict", "printf evict"));

					const replacementCommand = makeRun("aba", "printf begun; sleep 10; printf forbidden");
					const replacementFiber = yield* Effect.forkScoped(controller.runLocalOperation(replacementCommand));
					let replacementGeneration = 0;
					while (replacementGeneration === 0) {
						replacementGeneration = (yield* runner.snapshot()).activeLocalOperation?.operationGeneration ?? 0;
						if (replacementGeneration === 0) yield* Effect.sleep("1 millis");
					}
					expect(replacementGeneration).toBeGreaterThan(first.operationGeneration);
					const staleTarget = yield* Effect.flip(
						controller.cancelLocalOperation(
							decodeCancelLocalOperationCommand({
								schemaVersion: 1,
								kind: "cancelLocalOperation",
								commandId: "stale-aba-cancel",
								correlationId: "stale-aba-cancel-correlation",
								expectedSessionRevision: fixture.sessionManager.getSessionRevision(),
								viewId: controller.viewId,
								controllerEpoch: controller.controllerEpoch,
								targetCommandId: "aba",
								targetOperationGeneration: first.operationGeneration,
							}),
						),
					);
					expect(staleTarget).toBeInstanceOf(RunnerLocalOperationTargetError);
					const staleLease = yield* Effect.flip(
						controller.cancelLocalOperation(
							decodeCancelLocalOperationCommand({
								schemaVersion: 1,
								kind: "cancelLocalOperation",
								commandId: "stale-lease-cancel",
								correlationId: "stale-lease-cancel-correlation",
								expectedSessionRevision: fixture.sessionManager.getSessionRevision(),
								viewId: controller.viewId,
								controllerEpoch: controller.controllerEpoch + 1,
								targetCommandId: "aba",
								targetOperationGeneration: replacementGeneration,
							}),
						),
					);
					expect(staleLease).toBeInstanceOf(StaleRunnerControllerLeaseError);
					const cancel = decodeCancelLocalOperationCommand({
						schemaVersion: 1,
						kind: "cancelLocalOperation",
						commandId: "exact-cancel",
						correlationId: "exact-cancel-correlation",
						expectedSessionRevision: fixture.sessionManager.getSessionRevision(),
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
						targetCommandId: "aba",
						targetOperationGeneration: replacementGeneration,
					});
					const cancelled = yield* controller.cancelLocalOperation(cancel);
					const duplicateCancel = yield* controller.cancelLocalOperation(cancel);
					expect(duplicateCancel).toEqual(cancelled);
					const result = yield* Fiber.join(replacementFiber);
					expect(result.result.cancelled).toBe(true);
					expect(result.result.output.text).toContain("begun");
					expect(result.result.output.text).not.toContain("forbidden");
					yield* runner.stop();
				}),
			),
		);
	});

	it("supervises ephemeral turns with ordered output, replay, fences, exact cancellation, and no durable mutation", async () => {
		const fixture = await createLiveFixture();
		let providerCalls = 0;
		let release!: () => void;
		const gate = new Promise<void>(resolve => {
			release = resolve;
		});
		fixture.session.runEphemeralTurn = async args => {
			providerCalls++;
			args.onTextDelta?.("first");
			await gate;
			if (args.signal?.aborted) throw new DOMException("Aborted", "AbortError");
			args.onTextDelta?.(" second");
			return { replyText: "first second", assistantMessage: {} as AssistantMessage };
		};
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 2 });
					const controller = yield* runner.attachView(attach("ephemeral-controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("expected controller");
					const before = yield* runner.snapshot();
					const makeRun = (commandId: string, prompt: string) =>
						decodeRunEphemeralTurnCommand({
							schemaVersion: 1,
							kind: "runEphemeralTurn",
							commandId,
							correlationId: `${commandId}-correlation`,
							expectedSessionRevision: before.sessionRevision,
							viewId: controller.viewId,
							controllerEpoch: controller.controllerEpoch,
							prompt,
						});
					const command = makeRun("ephemeral-once", "side question");
					const running = yield* Effect.forkScoped(controller.runEphemeralTurn(command));
					while ((yield* runner.snapshot()).activeEphemeralTurn?.output.text !== "first")
						yield* Effect.sleep("1 millis");
					expect((yield* runner.snapshot()).status).toBe("running");
					expect(providerCalls).toBe(1);
					const duplicate = yield* Effect.forkScoped(controller.runEphemeralTurn(command));
					const conflict = yield* Effect.flip(controller.runEphemeralTurn(makeRun("ephemeral-once", "different")));
					expect(conflict).toBeInstanceOf(RunnerEphemeralTurnCommandConflictError);
					const stale = yield* Effect.flip(
						controller.runEphemeralTurn(
							decodeRunEphemeralTurnCommand({
								...makeRun("stale-ephemeral", "stale"),
								expectedSessionRevision: before.sessionRevision + 1,
							}),
						),
					);
					expect(stale).toBeInstanceOf(SessionRevisionConflictError);
					release();
					const receipt = yield* Fiber.join(running);
					expect(yield* Fiber.join(duplicate)).toEqual({ ...receipt, replayed: true });
					expect(receipt.output.text).toBe("first second");
					expect(providerCalls).toBe(1);
					const after = yield* runner.snapshot();
					expect(after.revision).toBe(before.revision);
					expect(after.sessionRevision).toBe(before.sessionRevision);
					expect(after.transcript).toEqual(before.transcript);

					fixture.session.runEphemeralTurn = async args => {
						providerCalls++;
						args.onTextDelta?.("evicted");
						return { replyText: "evicted", assistantMessage: {} as AssistantMessage };
					};
					yield* controller.runEphemeralTurn(makeRun("evict-one", "evict one"));
					yield* controller.runEphemeralTurn(makeRun("evict-two", "evict two"));

					let cancelledSignal: AbortSignal | undefined;
					fixture.session.runEphemeralTurn = async args => {
						providerCalls++;
						cancelledSignal = args.signal;
						await new Promise<void>((_resolve, reject) =>
							args.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
								once: true,
							}),
						);
						throw new Error("unreachable");
					};
					const replacement = yield* Effect.forkScoped(
						controller.runEphemeralTurn(makeRun("ephemeral-once", "same ID ABA")),
					);
					let generation = 0;
					while (generation === 0) {
						generation = (yield* runner.snapshot()).activeEphemeralTurn?.operationGeneration ?? 0;
						if (generation === 0) yield* Effect.sleep("1 millis");
					}
					expect(generation).toBeGreaterThan(receipt.operationGeneration);
					const wrong = yield* Effect.flip(
						controller.cancelEphemeralTurn(
							decodeCancelEphemeralTurnCommand({
								schemaVersion: 1,
								kind: "cancelEphemeralTurn",
								commandId: "wrong-cancel",
								correlationId: "wrong-cancel",
								expectedSessionRevision: before.sessionRevision,
								viewId: controller.viewId,
								controllerEpoch: controller.controllerEpoch,
								targetCommandId: "ephemeral-once",
								targetOperationGeneration: receipt.operationGeneration,
							}),
						),
					);
					expect(wrong).toBeInstanceOf(RunnerEphemeralTurnTargetError);
					const staleLease = yield* Effect.flip(
						controller.cancelEphemeralTurn(
							decodeCancelEphemeralTurnCommand({
								schemaVersion: 1,
								kind: "cancelEphemeralTurn",
								commandId: "stale-lease-cancel",
								correlationId: "stale-lease-cancel",
								expectedSessionRevision: before.sessionRevision,
								viewId: controller.viewId,
								controllerEpoch: controller.controllerEpoch + 1,
								targetCommandId: "ephemeral-once",
								targetOperationGeneration: generation,
							}),
						),
					);
					expect(staleLease).toBeInstanceOf(StaleRunnerControllerLeaseError);
					yield* controller.cancelEphemeralTurn(
						decodeCancelEphemeralTurnCommand({
							schemaVersion: 1,
							kind: "cancelEphemeralTurn",
							commandId: "exact-cancel",
							correlationId: "exact-cancel",
							expectedSessionRevision: before.sessionRevision,
							viewId: controller.viewId,
							controllerEpoch: controller.controllerEpoch,
							targetCommandId: "ephemeral-once",
							targetOperationGeneration: generation,
						}),
					);
					expect(cancelledSignal?.aborted).toBe(true);
					expect(yield* Effect.flip(Fiber.join(replacement))).toBeInstanceOf(SessionRunnerRuntimeError);
					yield* runner.stop();
				}),
			),
		);
	});

	it("bounds and resets UTF-8 ephemeral output deliveries under synchronous provider backpressure", async () => {
		const fixture = await createLiveFixture();
		let release!: () => void;
		const gate = new Promise<void>(resolve => {
			release = resolve;
		});
		const chunk = "🙂".repeat(1024);
		fixture.session.runEphemeralTurn = async args => {
			for (let index = 0; index < 100; index++) args.onTextDelta?.(chunk);
			await gate;
			return { replyText: `  ${chunk.repeat(50)}  `, assistantMessage: {} as AssistantMessage };
		};
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 128 });
					const controller = yield* runner.attachView(attach("ephemeral-output-controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("expected controller");
					const subscription = yield* controller.subscribe();
					let projected = "";
					let sawReset = false;
					const collect = yield* Effect.forkScoped(
						Effect.gen(function* () {
							while (true) {
								const delivery = yield* subscription.take;
								if (delivery.kind !== "event") continue;
								const output = delivery.event.ephemeralTurnOutput;
								if (delivery.event.kind === "ephemeralTurnOutput" && output) {
									projected = output.reset ? output.chunk : projected + output.chunk;
									sawReset ||= output.reset;
								}
								if (delivery.event.kind === "ephemeralTurnCompleted") return;
							}
						}),
					);
					const running = yield* Effect.forkScoped(
						controller.runEphemeralTurn(
							decodeRunEphemeralTurnCommand({
								schemaVersion: 1,
								kind: "runEphemeralTurn",
								commandId: "bounded-ephemeral",
								correlationId: "bounded-ephemeral",
								expectedSessionRevision: fixture.sessionManager.getSessionRevision(),
								viewId: controller.viewId,
								controllerEpoch: controller.controllerEpoch,
								prompt: "large output",
							}),
						),
					);
					let active = (yield* runner.snapshot()).activeEphemeralTurn;
					while (active === undefined || active.pendingOutputChunks > 0) {
						yield* Effect.sleep("1 millis");
						active = (yield* runner.snapshot()).activeEphemeralTurn;
					}
					expect(active.output.totalBytes).toBe(409_600);
					expect(Buffer.byteLength(active.output.text)).toBeLessThanOrEqual(256 * 1024);
					expect(Buffer.from(active.output.text).toString()).toBe(active.output.text);
					expect(active.peakPendingOutputChunks).toBeLessThanOrEqual(32);
					expect(active.peakPendingOutputBytes).toBeLessThanOrEqual(256 * 1024);
					release();
					const receipt = yield* Fiber.join(running);
					yield* Fiber.join(collect);
					expect(sawReset).toBe(true);
					expect(receipt.output.text).toBe(`  ${chunk.repeat(50)}  `);
					expect(projected).toBe(receipt.output.text);
					expect(receipt.output.truncated).toBe(false);
					yield* runner.stop();
				}),
			),
		);
	});

	it("routes canonical ephemeral reset output through the Promise terminal controller", async () => {
		const fixture = await createLiveFixture();
		fixture.session.runEphemeralTurn = async args => {
			args.onTextDelta?.("duplicate duplicate ");
			return { replyText: "canonical answer", assistantMessage: {} as AssistantMessage };
		};
		const scope = Scope.makeUnsafe("sequential");
		const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Scope.provide(scope)(effect));
		try {
			const runner = await run(makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 8 }));
			const controller = await createTerminalSessionController(runner, { viewId: "ephemeral-terminal-controller" });
			const outputs: Array<{ readonly chunk: string; readonly reset: boolean }> = [];
			const unsubscribe = controller.subscribeEphemeralTurnOutput(output =>
				outputs.push({
					chunk: output.chunk,
					reset: output.reset,
				}),
			);
			const receipt = await controller.runEphemeralTurn({ prompt: "canonicalize" });
			for (let attempts = 0; attempts < 100 && outputs.at(-1)?.chunk !== receipt.output.text; attempts++) {
				await Bun.sleep(1);
			}
			expect(outputs.some(output => output.chunk === "duplicate duplicate " && !output.reset)).toBe(true);
			expect(outputs.at(-1)).toEqual({ chunk: "canonical answer", reset: true });
			expect(receipt.output.text).toBe("canonical answer");
			unsubscribe();
			await controller.close();
			await run(runner.stop());
		} finally {
			await Effect.runPromise(Scope.close(scope, Exit.void));
		}
	});

	it("retains ephemeral provider failure and aborts a held turn before stop disposal", async () => {
		const fixture = await createLiveFixture();
		let calls = 0;
		fixture.session.runEphemeralTurn = async () => {
			calls++;
			throw new Error("retained ephemeral failure");
		};
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 2 });
					const controller = yield* runner.attachView(attach("ephemeral-failure-controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("expected controller");
					const makeRun = (commandId: string) =>
						decodeRunEphemeralTurnCommand({
							schemaVersion: 1,
							kind: "runEphemeralTurn",
							commandId,
							correlationId: commandId,
							expectedSessionRevision: fixture.sessionManager.getSessionRevision(),
							viewId: controller.viewId,
							controllerEpoch: controller.controllerEpoch,
							prompt: "question",
						});
					const failed = makeRun("retained-failure");
					expect(yield* Effect.flip(controller.runEphemeralTurn(failed))).toBeInstanceOf(
						SessionRunnerRuntimeError,
					);
					expect(yield* Effect.flip(controller.runEphemeralTurn(failed))).toBeInstanceOf(
						SessionRunnerRuntimeError,
					);
					expect(calls).toBe(1);
					let aborted = false;
					fixture.session.runEphemeralTurn = async args => {
						calls++;
						await new Promise<void>((_resolve, reject) =>
							args.signal?.addEventListener(
								"abort",
								() => {
									aborted = true;
									reject(new DOMException("Aborted", "AbortError"));
								},
								{ once: true },
							),
						);
						throw new Error("unreachable");
					};
					const held = yield* Effect.forkScoped(controller.runEphemeralTurn(makeRun("held-stop")));
					while ((yield* runner.snapshot()).activeEphemeralTurn === undefined) yield* Effect.sleep("1 millis");
					yield* runner.stop();
					expect(aborted).toBe(true);
					expect(yield* Effect.flip(Fiber.join(held))).toBeInstanceOf(SessionRunnerStoppedError);
				}),
			),
		);
	});

	it.skipIf(Bun.env.PI_PYTHON_INTEGRATION !== "1")(
		"executes a real Python kernel operation and persists its final transcript entry",
		async () => {
			const fixture = await createLiveFixture();
			await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const runner = yield* makeSessionRunnerLive(fixture, { mailboxCapacity: 1, eventCapacity: 4 });
						const controller = yield* runner.attachView(attach("python-controller", "controller", 0));
						if (controller.capability !== "controller") throw new Error("expected controller");
						const startedRevision = fixture.sessionManager.getSessionRevision();
						const receipt = yield* controller.runLocalOperation(
							decodeRunLocalOperationCommand({
								schemaVersion: 1,
								kind: "runLocalOperation",
								commandId: "real-python",
								correlationId: "real-python-correlation",
								expectedSessionRevision: startedRevision,
								viewId: controller.viewId,
								controllerEpoch: controller.controllerEpoch,
								operation: {
									kind: "python",
									code: "print('python-real', flush=True)\n21 * 2",
									excludeFromContext: false,
								},
							}),
						);
						expect(receipt.result.kind).toBe("python");
						if (receipt.result.kind !== "python") throw new Error("expected Python operation result");
						expect(receipt.result.output.text).toContain("python-real");
						expect(receipt.result.cancelled).toBe(false);
						expect(receipt.result.stdinRequested).toBe(false);
						expect(receipt.result.totalLines).toBeGreaterThanOrEqual(1);
						expect(receipt.completedSessionRevision).toBe(startedRevision + 1);
						const finalMessage = fixture.session.messages.at(-1);
						expect(finalMessage?.role).toBe("pythonExecution");
						if (finalMessage?.role !== "pythonExecution") throw new Error("expected Python transcript entry");
						expect(finalMessage.code).toContain("21 * 2");
						expect(finalMessage.output).toContain("python-real");
						yield* runner.stop();
						yield* Effect.promise(() => fixture.session.dispose());
					}),
				),
			);
		},
	);
});
