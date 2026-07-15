import { Effect, type Scope } from "effect";
import type { AgentSession } from "../session/agent-session";
import { createFleetCapability, FLEET_ROLLOUT_FEATURES } from "../session/fleet-capability";
import {
	type ReleaseRegistryValidationOptions,
	validateFleetPinSelection,
	validateFleetUnpinBlessed,
} from "../session/release-registry-validation";
import {
	assembleRolloutCheckpoint,
	inspectRolloutDrain,
	type RolloutCheckpoint,
	type RolloutPauseProvenance,
} from "../session/rollout-checkpoint";
import {
	CURRENT_SESSION_CONTROL_PROTOCOL,
	type FleetPinControlCommand,
	type FleetPinControlResult,
	type FleetPinJournalRecord,
	type PrepareRolloutCommand,
	type SessionControlCommand,
	type SessionControlResult,
} from "../session/session-control";
import type { SessionManager } from "../session/session-manager";
import type { SessionOwnershipHandle } from "../session/session-ownership";
import { InvalidRunnerCommandError } from "./errors";
import {
	RUNNER_SCHEMA_VERSION,
	type RunCompactionCommand,
	type RunCompactionReceipt,
	type RunnerIdentity,
	type SessionRunnerSnapshot,
	type SetModelReceipt,
} from "./protocol";
import type { RunnerFailure } from "./session-runner";

interface SessionControlResources {
	readonly ownership: SessionOwnershipHandle;
	readonly runnerIdentity: RunnerIdentity;
	readonly session: AgentSession;
	readonly sessionManager: SessionManager;
}

interface RunnerControllerRef {
	readonly viewId: string;
	readonly epoch: number;
}

type RunnerEffect<A> = Effect.Effect<A, RunnerFailure, Scope.Scope>;

type Enqueue = <A>(operation: Effect.Effect<A, RunnerFailure>) => RunnerEffect<A>;

export interface SessionControlHandlerOptions {
	readonly resources: SessionControlResources;
	readonly releaseValidation?: ReleaseRegistryValidationOptions;
	readonly snapshot: () => RunnerEffect<SessionRunnerSnapshot>;
	readonly enqueue: Enqueue;
	readonly activeController: () => RunnerControllerRef | undefined;
	readonly setModel: (viewId: string, controllerEpoch: number, input: unknown) => RunnerEffect<SetModelReceipt>;
	readonly runCompaction: (
		viewId: string,
		controllerEpoch: number,
		command: RunCompactionCommand,
	) => RunnerEffect<RunCompactionReceipt>;
	readonly asRunnerFailure: (error: unknown) => RunnerFailure;
}

export interface SessionControlHandlers {
	readonly applySessionControl: (command: SessionControlCommand) => RunnerEffect<SessionControlResult>;
	readonly prepareRollout: (
		command: PrepareRolloutCommand,
		pauseProvenance: RolloutPauseProvenance,
	) => RunnerEffect<RolloutCheckpoint>;
}

export function makeSessionControlHandlers(options: SessionControlHandlerOptions): SessionControlHandlers {
	const { resources } = options;

	const prepareRollout = Effect.fn("Runner.prepareRollout")(function* (
		command: PrepareRolloutCommand,
		pauseProvenance: RolloutPauseProvenance,
	) {
		return yield* Effect.tryPromise({
			try: () =>
				assembleRolloutCheckpoint({
					sessionManager: resources.sessionManager,
					session: resources.session,
					commandId: command.commandId,
					rolloutId: command.intent.rolloutId,
					ownerEpoch: command.targetOwnerEpoch,
					expectedDigest: command.intent.expectedDigest,
					pauseProvenance,
					drainTimeoutMs: command.intent.drainTimeoutMs,
					inspectDrain: async () => {
						const current = await Effect.runPromise(Effect.scoped(options.snapshot()));
						return inspectRolloutDrain(resources.session, current.pendingOperations);
					},
				}),
			catch: options.asRunnerFailure,
		});
	});

	const applySessionControl = Effect.fn("Runner.applySessionControl")(function* (command: SessionControlCommand) {
		switch (command.intent.kind) {
			case "status": {
				const current = yield* options.snapshot();
				const model = resources.session.model;
				return {
					status: current.status,
					revision: current.revision,
					sessionRevision: current.sessionRevision,
					pendingOperations: current.pendingOperations,
					model: model ? `${model.provider}/${model.id}` : undefined,
					fleetCapability: createFleetCapability({
						buildDigest: resources.runnerIdentity.buildRevision.digest,
						productVersion: resources.runnerIdentity.buildRevision.version,
						controlProtocol: CURRENT_SESSION_CONTROL_PROTOCOL,
						rolloutFeatures: FLEET_ROLLOUT_FEATURES,
						workstream: resources.sessionManager.getWorkstream(),
					}),
				};
			}
			case "pause":
				yield* options.enqueue(
					Effect.tryPromise({
						try: () => resources.session.setSessionControlPaused(true),
						catch: options.asRunnerFailure,
					}),
				);
				return { paused: true };
			case "resume":
				yield* options.enqueue(
					Effect.tryPromise({
						try: () => resources.session.setSessionControlPaused(false),
						catch: options.asRunnerFailure,
					}),
				);
				return { paused: false };
			case "fleet-pin":
			case "fleet-unpin":
				return yield* options.enqueue(
					Effect.tryPromise({
						try: () =>
							applyFleetPinControl(resources, command as FleetPinControlCommand, options.releaseValidation),
						catch: options.asRunnerFailure,
					}),
				);
			case "setModel": {
				const controller = options.activeController();
				if (!controller) {
					return yield* Effect.fail(new InvalidRunnerCommandError({ issue: "No active runner controller" }));
				}
				const separator = command.intent.selector.indexOf("/");
				if (separator <= 0 || separator === command.intent.selector.length - 1) {
					return yield* Effect.fail(
						new InvalidRunnerCommandError({ issue: `Invalid model selector: ${command.intent.selector}` }),
					);
				}
				const current = yield* options.snapshot();
				return yield* options.setModel(controller.viewId, controller.epoch, {
					schemaVersion: RUNNER_SCHEMA_VERSION,
					kind: "setModel",
					commandId: command.commandId,
					correlationId: command.commandId,
					expectedSessionRevision: current.sessionRevision,
					viewId: controller.viewId,
					controllerEpoch: controller.epoch,
					payload: {
						provider: command.intent.selector.slice(0, separator),
						id: command.intent.selector.slice(separator + 1),
					},
				});
			}
			case "compact": {
				const controller = options.activeController();
				if (!controller) {
					return yield* Effect.fail(new InvalidRunnerCommandError({ issue: "No active runner controller" }));
				}
				const current = yield* options.snapshot();
				return yield* options.runCompaction(controller.viewId, controller.epoch, {
					schemaVersion: RUNNER_SCHEMA_VERSION,
					kind: "runCompaction",
					commandId: command.commandId,
					correlationId: command.commandId,
					expectedSessionRevision: current.sessionRevision as RunCompactionCommand["expectedSessionRevision"],
					viewId: controller.viewId,
					controllerEpoch: controller.epoch as RunCompactionCommand["controllerEpoch"],
					customInstructions: command.intent.instructions,
				});
			}
			case "restart":
			case "stop":
				return yield* Effect.fail(
					new InvalidRunnerCommandError({ issue: `${command.intent.kind} is a runner lifecycle action` }),
				);
			case "prepare-rollout":
				return yield* Effect.fail(
					new InvalidRunnerCommandError({ issue: "prepare-rollout requires the rollout checkpoint action" }),
				);
			case "policy-apply":
				return yield* Effect.fail(
					new InvalidRunnerCommandError({ issue: "policy-apply requires a policy runtime adapter" }),
				);
		}
	});

	return { applySessionControl, prepareRollout };
}

async function applyFleetPinControl(
	resources: SessionControlResources,
	command: FleetPinControlCommand,
	releaseValidation: ReleaseRegistryValidationOptions | undefined,
): Promise<FleetPinControlResult> {
	if (
		command.sessionId !== resources.ownership.sessionId ||
		command.targetOwnerEpoch !== resources.ownership.ownerEpoch ||
		resources.ownership.isFenced?.() ||
		!(await resources.ownership.isCurrent())
	) {
		throw new Error(`Session ownership epoch ${command.targetOwnerEpoch} is no longer current`);
	}
	const validated =
		command.intent.kind === "fleet-pin"
			? await validateFleetPinSelection(command.intent.selection, releaseValidation)
			: await validateFleetUnpinBlessed(releaseValidation);
	if (resources.ownership.isFenced?.() || !(await resources.ownership.isCurrent())) {
		throw new Error(`Session ownership epoch ${command.targetOwnerEpoch} is no longer current`);
	}
	const recordedAt = new Date().toISOString();
	if (command.intent.kind === "fleet-pin") {
		const record = {
			version: 2,
			action: "pin",
			channel: validated.channel,
			source: validated.source,
			digest: validated.digest,
			commandId: command.commandId,
			recordedAt,
			ownerEpoch: command.targetOwnerEpoch,
		} satisfies FleetPinJournalRecord;
		resources.sessionManager.appendCustomEntry("fleet_pin", record);
		return {
			channel: validated.channel,
			digest: validated.digest,
			pinned: true,
			source: validated.source,
		};
	}
	const record = {
		version: 2,
		action: "unpin",
		channel: "blessed",
		source: "unpin",
		commandId: command.commandId,
		recordedAt,
		ownerEpoch: command.targetOwnerEpoch,
	} satisfies FleetPinJournalRecord;
	resources.sessionManager.appendCustomEntry("fleet_pin", record);
	return {
		channel: "blessed",
		digest: validated.digest,
		pinned: false,
		source: "unpin",
	};
}
