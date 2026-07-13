import { Cause, Deferred, Effect, FiberSet, PubSub, Queue, Ref, type Scope } from "effect";
import { buildRestartSpawnSpec, type RestartSpawnSpec } from "../cli/restart-session";
import type { PythonResult } from "../eval/py/executor";
import type { BashResult } from "../exec/bash-executor";
import { IrcBus } from "../irc/bus";
import type { InteractiveHostIntent } from "../modes/interactive-host-intent";
import { captureRestartChildManifest } from "../session/restart-child-manifest";
import { writeRestartHandoff } from "../session/session-ownership";
import { type AgentSession, type AgentSessionEvent, PromptOperationConflictError } from "../session/agent-session";
import {
	type DurableCustomPayload,
	DurableInputCommandConflictError,
	DurableInputItemRevisionConflictError,
	type DurableInputQueue,
	DurableInputQueueConflictError,
	type DurableInputQueueEvent,
	DurableInputRunnerRevisionConflictError,
	SessionOwnershipLostError,
} from "../session/durable-input-queue";
import type {
	SessionEntry,
	SetModelSessionCommand,
	SetThinkingSessionCommand,
	TransitionGoalModeSessionCommand,
	TransitionPlanModeSessionCommand,
} from "../session/session-entries";
import {
	SessionCommandConflictError,
	SessionManager,
	SessionRevisionConflictError,
	SessionStateCommandInFlightError,
} from "../session/session-manager";
import type { SessionControlCommand, SessionControlResult } from "../session/session-control";
import type { SessionOwnershipHandle } from "../session/session-ownership";
import {
	InvalidRunnerCommandError,
	RunnerCompactionCommandConflictError,
	RunnerCompactionTargetError,
	RunnerCompactionUnavailableError,
	RunnerControllerConflictError,
	RunnerEphemeralTurnCommandConflictError,
	RunnerEphemeralTurnTargetError,
	RunnerEphemeralTurnUnavailableError,
	RunnerItemRevisionConflictError,
	RunnerLocalOperationCommandConflictError,
	RunnerLocalOperationTargetError,
	RunnerLocalOperationUnavailableError,
	RunnerPromptOperationConflictError,
	RunnerRevisionConflictError,
	RunnerSessionReloadCancelledError,
	RunnerSshToolUnavailableError,
	RunnerTodoConflictError,
	RunnerToolConfigurationConflictError,
	RunnerViewAlreadyAttachedError,
	RunnerViewCapabilityError,
	RunnerViewNotAttachedError,
	SessionRunnerRuntimeError,
	SessionRunnerStoppedError,
	StaleRunnerControllerLeaseError,
} from "./errors";
import {
	type AcquireRunnerControllerCommand,
	type AttachRunnerViewCommand,
	assertRunnerRevision,
	type CancelCompactionCommand,
	type CancelCompactionReceipt,
	type CancelEphemeralTurnCommand,
	type CancelEphemeralTurnReceipt,
	type CancelHandoffCommand,
	type CancelHandoffReceipt,
	type CancelLocalOperationCommand,
	type CancelLocalOperationReceipt,
	type CancelShakeCommand,
	type CancelShakeReceipt,
	type CycleModelCommand,
	type CycleModelReceipt,
	type DetachRunnerViewCommand,
	decodeCancelCompactionCommand,
	decodeCancelEphemeralTurnCommand,
	decodeCancelHandoffCommand,
	decodeCancelLocalOperationCommand,
	decodeCancelQueuedInputCommand,
	decodeCancelShakeCommand,
	decodeCycleModelCommand,
	decodeEditQueuedInputCommand,
	decodeGetCheckpointStateCommand,
	decodeInterruptPromptCommand,
	decodeRefreshSshToolCommand,
	decodePrepareHostTransitionCommand,
	decodeReloadSessionCommand,
	decodeReplaceTodosCommand,
	decodeRunCompactionCommand,
	decodeRunEphemeralTurnCommand,
	decodeRunHandoffCommand,
	decodeRunLocalOperationCommand,
	decodeRunShakeCommand,
	decodeSetActiveToolsCommand,
	decodeSetCheckpointStateCommand,
	decodeSetModelCommand,
	decodeSetThinkingLevelCommand,
	decodeSubmitCustomMessageCommand,
	decodeSubmitInputCommand,
	decodeTransitionGoalModeCommand,
	decodeTransitionPlanModeCommand,
	type GetCheckpointStateCommand,
	type GetCheckpointStateReceipt,
	type InterruptPromptCommand,
	type InterruptPromptReceipt,
	type RefreshSshToolCommand,
	type RefreshSshToolReceipt,
	type ReleaseRunnerControllerCommand,
	type PrepareHostTransitionCommand,
	type PrepareHostTransitionReceipt,
	type ReloadSessionCommand,
	type ReloadSessionReceipt,
	type ReplaceTodosCommand,
	type ReplaceTodosReceipt,
	RUNNER_SCHEMA_VERSION,
	type RunCompactionCommand,
	type RunCompactionReceipt,
	type RunEphemeralTurnCommand,
	type RunEphemeralTurnReceipt,
	type RunHandoffCommand,
	type RunHandoffReceipt,
	type RunLocalOperationCommand,
	type RunLocalOperationReceipt,
	type RunnerCapability,
	type RunnerCommandReceipt,
	type RunnerControlMetadata,
	type RunnerEvent,
	type RunnerEventDelivery,
	type RunnerEventKind,
	type RunnerIdentity,
	type RunnerStatus,
	type RunnerViewSnapshot,
	type RunShakeCommand,
	type RunShakeReceipt,
	type SessionRunnerSnapshot,
	type SetActiveToolsCommand,
	type SetActiveToolsReceipt,
	type SetCheckpointStateCommand,
	type SetCheckpointStateReceipt,
	type SetModelReceipt,
	type SetThinkingLevelReceipt,
	type TransitionGoalModeReceipt,
	type TransitionPlanModeReceipt,
} from "./protocol";
import type {
	TerminalSessionDelivery,
	TerminalSessionSnapshot,
	TerminalSessionSubscription,
	TerminalSessionView,
} from "./terminal-session-view";

export type RunnerFailure =
	| InvalidRunnerCommandError
	| RunnerToolConfigurationConflictError
	| RunnerSshToolUnavailableError
	| RunnerTodoConflictError
	| RunnerRevisionConflictError
	| RunnerItemRevisionConflictError
	| RunnerPromptOperationConflictError
	| RunnerControllerConflictError
	| RunnerCompactionCommandConflictError
	| RunnerCompactionUnavailableError
	| RunnerCompactionTargetError
	| RunnerEphemeralTurnCommandConflictError
	| RunnerEphemeralTurnUnavailableError
	| RunnerEphemeralTurnTargetError
	| RunnerLocalOperationCommandConflictError
	| RunnerLocalOperationUnavailableError
	| RunnerLocalOperationTargetError
	| StaleRunnerControllerLeaseError
	| RunnerViewAlreadyAttachedError
	| RunnerViewNotAttachedError
	| RunnerViewCapabilityError
	| SessionRunnerRuntimeError
	| RunnerSessionReloadCancelledError
	| SessionRunnerStoppedError
	| SessionRevisionConflictError
	| SessionCommandConflictError
	| SessionStateCommandInFlightError;

export interface SessionRunnerOptions {
	readonly mailboxCapacity: number;
	readonly eventCapacity: number;
	readonly childStopPolicy?: "detach" | "stop";
}

export interface SessionRunnerLiveResources {
	readonly ownership: SessionOwnershipHandle;
	readonly runnerIdentity: RunnerIdentity;
	readonly queue: DurableInputQueue;
	readonly session: AgentSession;
	readonly sessionManager: SessionManager;
}

type LocalOperationExecutionResult =
	| { readonly kind: "bash"; readonly result: BashResult }
	| { readonly kind: "python"; readonly result: PythonResult };

export interface RunnerSubscription {
	readonly take: Effect.Effect<RunnerEventDelivery, RunnerFailure, Scope.Scope>;
}

export interface RunnerProjection {
	readonly snapshot: SessionRunnerSnapshot;
	readonly subscription: RunnerSubscription;
}

interface RunnerViewBase {
	readonly viewId: string;
	readonly snapshot: () => Effect.Effect<SessionRunnerSnapshot, RunnerFailure, Scope.Scope>;
	/** Atomically establishes delivery before materializing its sequence baseline. */
	readonly openProjection: () => Effect.Effect<RunnerProjection, RunnerFailure, Scope.Scope>;
	readonly subscribe: () => Effect.Effect<RunnerSubscription, RunnerFailure, Scope.Scope>;
	readonly detach: (command: DetachRunnerViewCommand) => Effect.Effect<void, RunnerFailure, Scope.Scope>;
	readonly close: (command: DetachRunnerViewCommand) => Effect.Effect<void, RunnerFailure, Scope.Scope>;
}

export interface ObserverSessionRunnerView extends RunnerViewBase {
	readonly capability: "observer";
	readonly acquireController: (
		command: AcquireRunnerControllerCommand,
	) => Effect.Effect<ControllerSessionRunnerView, RunnerFailure, Scope.Scope>;
}

export interface ControllerSessionRunnerView extends RunnerViewBase {
	readonly capability: "controller";
	readonly controllerEpoch: number;
	readonly submitInput: (input: unknown) => Effect.Effect<RunnerCommandReceipt, RunnerFailure, Scope.Scope>;
	readonly submitCustomMessage: (input: unknown) => Effect.Effect<RunnerCommandReceipt, RunnerFailure, Scope.Scope>;
	readonly editQueuedInput: (input: unknown) => Effect.Effect<RunnerCommandReceipt, RunnerFailure, Scope.Scope>;
	readonly cancelQueuedInput: (input: unknown) => Effect.Effect<RunnerCommandReceipt, RunnerFailure, Scope.Scope>;
	readonly setActiveTools: (input: unknown) => Effect.Effect<SetActiveToolsReceipt, RunnerFailure, Scope.Scope>;
	readonly replaceTodos: (
		input: ReplaceTodosCommand,
	) => Effect.Effect<ReplaceTodosReceipt, RunnerFailure, Scope.Scope>;
	readonly refreshSshTool: (
		input: RefreshSshToolCommand,
	) => Effect.Effect<RefreshSshToolReceipt, RunnerFailure, Scope.Scope>;
	readonly cycleModel: (input: unknown) => Effect.Effect<CycleModelReceipt, RunnerFailure, Scope.Scope>;
	readonly setModel: (input: unknown) => Effect.Effect<SetModelReceipt, RunnerFailure, Scope.Scope>;
	readonly setThinkingLevel: (input: unknown) => Effect.Effect<SetThinkingLevelReceipt, RunnerFailure, Scope.Scope>;
	readonly transitionPlanMode: (
		input: unknown,
	) => Effect.Effect<TransitionPlanModeReceipt, RunnerFailure, Scope.Scope>;
	readonly transitionGoalMode: (
		input: unknown,
	) => Effect.Effect<TransitionGoalModeReceipt, RunnerFailure, Scope.Scope>;
	readonly shake: (command: RunShakeCommand) => Effect.Effect<RunShakeReceipt, RunnerFailure, Scope.Scope>;
	readonly cancelShake: (command: CancelShakeCommand) => Effect.Effect<CancelShakeReceipt, RunnerFailure, Scope.Scope>;
	readonly handoff: (command: RunHandoffCommand) => Effect.Effect<RunHandoffReceipt, RunnerFailure, Scope.Scope>;
	readonly cancelHandoff: (
		command: CancelHandoffCommand,
	) => Effect.Effect<CancelHandoffReceipt, RunnerFailure, Scope.Scope>;
	readonly getCheckpointState: (
		command: GetCheckpointStateCommand,
	) => Effect.Effect<GetCheckpointStateReceipt, RunnerFailure, Scope.Scope>;
	readonly setCheckpointState: (
		command: SetCheckpointStateCommand,
	) => Effect.Effect<SetCheckpointStateReceipt, RunnerFailure, Scope.Scope>;
	readonly prepareHostTransition: (
		input: PrepareHostTransitionCommand,
	) => Effect.Effect<PrepareHostTransitionReceipt, RunnerFailure, Scope.Scope>;
	readonly reload: (command: ReloadSessionCommand) => Effect.Effect<ReloadSessionReceipt, RunnerFailure, Scope.Scope>;
	readonly compact: (command: RunCompactionCommand) => Effect.Effect<RunCompactionReceipt, RunnerFailure, Scope.Scope>;
	readonly cancelCompaction: (
		command: CancelCompactionCommand,
	) => Effect.Effect<CancelCompactionReceipt, RunnerFailure, Scope.Scope>;
	readonly runEphemeralTurn: (
		command: RunEphemeralTurnCommand,
	) => Effect.Effect<RunEphemeralTurnReceipt, RunnerFailure, Scope.Scope>;
	readonly cancelEphemeralTurn: (
		command: CancelEphemeralTurnCommand,
	) => Effect.Effect<CancelEphemeralTurnReceipt, RunnerFailure, Scope.Scope>;
	readonly runLocalOperation: (
		command: RunLocalOperationCommand,
	) => Effect.Effect<RunLocalOperationReceipt, RunnerFailure, Scope.Scope>;
	readonly cancelLocalOperation: (
		command: CancelLocalOperationCommand,
	) => Effect.Effect<CancelLocalOperationReceipt, RunnerFailure, Scope.Scope>;
	readonly interruptPrompt: (
		command: InterruptPromptCommand,
	) => Effect.Effect<InterruptPromptReceipt, RunnerFailure, Scope.Scope>;
	readonly releaseController: (
		command: ReleaseRunnerControllerCommand,
	) => Effect.Effect<ObserverSessionRunnerView, RunnerFailure, Scope.Scope>;
}

export type SessionRunnerView = ObserverSessionRunnerView | ControllerSessionRunnerView;

export interface SessionRunner {
	readonly attachView: (
		command: AttachRunnerViewCommand,
	) => Effect.Effect<SessionRunnerView, RunnerFailure, Scope.Scope>;
	readonly attachTerminalView: (
		command: AttachRunnerViewCommand,
	) => Effect.Effect<TerminalSessionView, RunnerFailure, Scope.Scope>;
	readonly snapshot: () => Effect.Effect<SessionRunnerSnapshot, RunnerFailure, Scope.Scope>;
	readonly applySessionControl: (
		command: SessionControlCommand,
	) => Effect.Effect<SessionControlResult, RunnerFailure, Scope.Scope>;
	readonly stop: () => Effect.Effect<void, RunnerFailure, Scope.Scope>;
}

interface MutableViewState {
	capability: RunnerCapability;
	controllerEpoch: number | undefined;
	readonly attachedSequence: number;
}

interface ActiveController {
	readonly viewId: string;
	readonly epoch: number;
}

interface EventDetails {
	readonly kind: RunnerEventKind;
	readonly metadata:
		| RunnerControlMetadata
		| SetActiveToolsCommand
		| ReplaceTodosCommand
		| RefreshSshToolCommand
		| CycleModelCommand
		| InterruptPromptCommand
		| CancelCompactionCommand
		| RunLocalOperationCommand
		| CancelLocalOperationCommand
		| RunEphemeralTurnCommand
		| CancelEphemeralTurnCommand
		| RunShakeCommand
		| CancelShakeCommand
		| RunHandoffCommand
		| CancelHandoffCommand
		| SetCheckpointStateCommand
		| ReloadSessionCommand
		| PrepareHostTransitionCommand;
	readonly controllerEpoch: number;
	readonly viewId?: string;
	readonly inputId?: string;
	readonly targetGeneration?: number;
	readonly targetCommandId?: string;
	readonly targetOperationGeneration?: number;
	readonly localOperationOutput?: {
		readonly chunk: string;
		readonly totalBytes: number;
		readonly truncated: boolean;
		readonly reset: boolean;
	};
	readonly ephemeralTurnOutput?: {
		readonly chunk: string;
		readonly totalBytes: number;
		readonly truncated: boolean;
		readonly reset: boolean;
	};
	readonly durableSequence?: number;
	readonly transcriptEntryId?: string;
	readonly transcriptLeafId?: string | null;
	readonly transcriptEntry?: SessionEntry;
	readonly transcriptPosition?: number;
	readonly sessionRevision?: number;
}
type TerminalRawDelivery =
	| { readonly kind: "agentEvent"; readonly sequence: number; readonly event: AgentSessionEvent }
	| { readonly kind: "runnerEvent"; readonly sequence: number; readonly event: RunnerEvent };

interface TerminalViewState {
	readonly events: PubSub.PubSub<TerminalRawDelivery>;
	planResolveCapabilityEpoch?: number;
}

interface LiveCompactionRecord {
	readonly command: RunCompactionCommand;
	readonly operationGeneration: number;
	readonly startedSessionRevision: number;
	readonly deferred: Deferred.Deferred<RunCompactionReceipt, RunnerFailure>;
	completed: boolean;
	cancellationRequested: boolean;
}

interface LiveLocalOperationRecord {
	readonly command: RunLocalOperationCommand;
	readonly operationGeneration: number;
	readonly startedSessionRevision: number;
	readonly deferred: Deferred.Deferred<RunLocalOperationReceipt, RunnerFailure>;
	readonly outputChunks: Map<number, Buffer>;
	outputHead: number;
	outputTail: number;
	outputHeadOffset: number;
	retainedBytes: number;
	totalBytes: number;
	completed: boolean;
	cancellationRequested: boolean;
	readonly pendingOutputChunks: Array<{
		chunk: string;
		bytes: number;
		reset: boolean;
		totalBytes: number;
		truncated: boolean;
	}>;
	pendingOutputBytes: number;
	peakPendingOutputChunks: number;
	peakPendingOutputBytes: number;
	outputPumpRunning: boolean;
	outputClosed: boolean;
	readonly outputDrained: Deferred.Deferred<void>;
}

interface LiveEphemeralTurnRecord {
	readonly command: RunEphemeralTurnCommand;
	readonly operationGeneration: number;
	readonly startedSessionRevision: number;
	readonly deferred: Deferred.Deferred<RunEphemeralTurnReceipt, RunnerFailure>;
	readonly abortController: AbortController;
	readonly outputChunks: Map<number, Buffer>;
	outputHead: number;
	outputTail: number;
	outputHeadOffset: number;
	retainedBytes: number;
	totalBytes: number;
	completed: boolean;
	cancellationRequested: boolean;
	readonly pendingOutputChunks: Array<{
		chunk: string;
		bytes: number;
		reset: boolean;
		totalBytes: number;
		truncated: boolean;
	}>;
	pendingOutputBytes: number;
	peakPendingOutputChunks: number;
	peakPendingOutputBytes: number;
	outputPumpRunning: boolean;
	outputClosed: boolean;
	readonly outputDrained: Deferred.Deferred<void>;
}

interface LiveShakeRecord {
	readonly command: RunShakeCommand;
	readonly operationGeneration: number;
	readonly startedSessionRevision: number;
	readonly deferred: Deferred.Deferred<RunShakeReceipt, RunnerFailure>;
	readonly abortController: AbortController;
	completed: boolean;
	cancellationRequested: boolean;
}

interface LiveHandoffRecord {
	readonly command: RunHandoffCommand;
	readonly operationGeneration: number;
	readonly startedSessionRevision: number;
	readonly deferred: Deferred.Deferred<RunHandoffReceipt, RunnerFailure>;
	readonly abortController: AbortController;
	completed: boolean;
	cancellationRequested: boolean;
}

interface LiveReloadRecord {
	readonly command: ReloadSessionCommand;
	readonly operationGeneration: number;
	readonly startedSessionRevision: number;
	readonly deferred: Deferred.Deferred<ReloadSessionReceipt, RunnerFailure>;
	completed: boolean;
}

interface LiveHostTransitionRecord {
	readonly command: PrepareHostTransitionCommand;
	readonly operationGeneration: number;
	readonly startedSessionRevision: number;
	readonly deferred: Deferred.Deferred<PrepareHostTransitionReceipt, RunnerFailure>;
	completed: boolean;
}

interface HostTransitionOutcome {
	readonly intent: InteractiveHostIntent;
	readonly cancelled: boolean;
	readonly editorText?: string;
	readonly restartSpawn?: RestartSpawnSpec;
}

type ActiveSessionOperation =
	| { readonly kind: "shake"; readonly record: LiveShakeRecord }
	| { readonly kind: "handoff"; readonly record: LiveHandoffRecord }
	| { readonly kind: "reload"; readonly record: LiveReloadRecord }
	| { readonly kind: "hostTransition"; readonly record: LiveHostTransitionRecord };

interface RetainedCheckpointRead {
	readonly command: GetCheckpointStateCommand;
	readonly receipt: GetCheckpointStateReceipt;
}

interface RetainedCheckpointWrite {
	readonly command: SetCheckpointStateCommand;
	readonly receipt: SetCheckpointStateReceipt;
}

const asRunnerFailure = (error: unknown): RunnerFailure => {
	if (
		error instanceof InvalidRunnerCommandError ||
		error instanceof RunnerRevisionConflictError ||
		error instanceof RunnerTodoConflictError ||
		error instanceof RunnerSshToolUnavailableError ||
		error instanceof RunnerControllerConflictError ||
		error instanceof RunnerItemRevisionConflictError ||
		error instanceof RunnerPromptOperationConflictError ||
		error instanceof RunnerCompactionCommandConflictError ||
		error instanceof RunnerCompactionUnavailableError ||
		error instanceof RunnerCompactionTargetError ||
		error instanceof RunnerLocalOperationCommandConflictError ||
		error instanceof RunnerLocalOperationUnavailableError ||
		error instanceof RunnerLocalOperationTargetError ||
		error instanceof RunnerEphemeralTurnCommandConflictError ||
		error instanceof RunnerEphemeralTurnUnavailableError ||
		error instanceof RunnerEphemeralTurnTargetError ||
		error instanceof StaleRunnerControllerLeaseError ||
		error instanceof RunnerViewAlreadyAttachedError ||
		error instanceof RunnerViewNotAttachedError ||
		error instanceof RunnerViewCapabilityError ||
		error instanceof SessionRunnerRuntimeError ||
		error instanceof RunnerSessionReloadCancelledError ||
		error instanceof SessionRunnerStoppedError ||
		error instanceof SessionRevisionConflictError ||
		error instanceof SessionCommandConflictError ||
		error instanceof RunnerToolConfigurationConflictError ||
		error instanceof SessionStateCommandInFlightError
	) {
		return error;
	}
	if (error instanceof PromptOperationConflictError) {
		return new RunnerPromptOperationConflictError({
			targetGeneration: error.targetGeneration,
			actualGeneration: error.actualGeneration,
			active: error.active,
		});
	}
	if (error instanceof DurableInputRunnerRevisionConflictError) {
		return new RunnerRevisionConflictError({
			expectedRevision: error.expectedRevision,
			actualRevision: error.actualRevision,
		});
	}
	if (error instanceof DurableInputItemRevisionConflictError) {
		return new RunnerItemRevisionConflictError({
			inputId: error.inputId,
			expectedRevision: error.expectedRevision,
			actualRevision: error.actualRevision,
		});
	}
	if (error instanceof DurableInputCommandConflictError || error instanceof DurableInputQueueConflictError) {
		return new InvalidRunnerCommandError({ issue: error.message });
	}
	if (error instanceof SessionOwnershipLostError) {
		return new SessionRunnerRuntimeError({ issue: error.message });
	}
	return new SessionRunnerRuntimeError({ issue: error instanceof Error ? error.message : "Runner operation failed" });
};

const validateMetadata = (metadata: RunnerControlMetadata): void => {
	if (
		metadata.schemaVersion !== RUNNER_SCHEMA_VERSION ||
		metadata.commandId.length === 0 ||
		metadata.correlationId.length === 0
	) {
		throw new InvalidRunnerCommandError({ issue: "Invalid runner command metadata" });
	}
};

/** One live session authority over the injected queue, AgentSession, transcript, and ownership lease. */
export const makeSessionRunnerLive = Effect.fn("Runner.makeSessionRunnerLive")(function* (
	resources: SessionRunnerLiveResources,
	options: SessionRunnerOptions,
) {
	if (!Number.isSafeInteger(options.mailboxCapacity) || options.mailboxCapacity < 1) {
		return yield* Effect.fail(new InvalidRunnerCommandError({ issue: "mailboxCapacity must be positive" }));
	}
	if (!Number.isSafeInteger(options.eventCapacity) || options.eventCapacity < 1) {
		return yield* Effect.fail(new InvalidRunnerCommandError({ issue: "eventCapacity must be positive" }));
	}

	const openedItems = yield* Effect.tryPromise({ try: () => resources.queue.list(), catch: asRunnerFailure });
	let revision = yield* Effect.tryPromise({
		try: () => resources.queue.getLatestRunnerRevision(),
		catch: asRunnerFailure,
	});
	let sessionRevision = resources.sessionManager.getSessionRevision();
	const stateCommandFailure = (error: unknown): RunnerFailure => {
		sessionRevision = Math.max(sessionRevision, resources.sessionManager.getSessionRevision());
		return asRunnerFailure(error);
	};
	const durableItems = new Map(openedItems.map(item => [item.inputId, item]));
	const acceptedCommands = new Set<string>();
	const transcriptEntries = resources.sessionManager.getEntries();
	let transcriptEntryCount = transcriptEntries.length;
	let transcriptLeafId = resources.sessionManager.getLeafId();
	let transcriptLastEntryId = transcriptEntries.at(-1)?.id;

	const mailbox = yield* Queue.bounded<Effect.Effect<void, never>>(options.mailboxCapacity);
	const events = yield* PubSub.sliding<RunnerEvent>(options.eventCapacity);
	const pendingOperations = yield* Ref.make(0);
	const statusRef = yield* Ref.make<RunnerStatus>("running");
	const stopDone = yield* Deferred.make<void, RunnerFailure>();
	const callbackFibers = yield* FiberSet.make<void, never>();
	const runCallback = yield* FiberSet.runtime(callbackFibers)<never>();
	const sessionOperationFibers = yield* FiberSet.make<void, never>();
	const runSessionOperation = yield* FiberSet.runtime(sessionOperationFibers)<never>();
	const views = new Map<string, MutableViewState>();
	const terminalViews = new Map<string, TerminalViewState>();
	let unsubscribeTerminalAgent: (() => void) | undefined;
	let terminalSequence = 0;
	let activeController: ActiveController | undefined;
	let nextControllerEpoch = 1;
	let runnerSequence = 0;
	const mailboxWaiters = new Set<() => Effect.Effect<void>>();
	const compactionCommands = new Map<string, LiveCompactionRecord>();
	const localOperationCommands = new Map<string, LiveLocalOperationRecord>();
	let activeLocalOperation: LiveLocalOperationRecord | undefined;
	let nextLocalOperationGeneration = 1;
	const localOperationOutputLimit = 256 * 1024;
	const ephemeralTurnCommands = new Map<string, LiveEphemeralTurnRecord>();
	let activeEphemeralTurn: LiveEphemeralTurnRecord | undefined;
	let nextEphemeralTurnGeneration = 1;
	let activeCompaction: { readonly commandId: string; readonly operationGeneration: number } | undefined;
	let nextCompactionOperationGeneration = 1;
	const shakeCommands = new Map<string, LiveShakeRecord>();
	const handoffCommands = new Map<string, LiveHandoffRecord>();
	const reloadCommands = new Map<string, LiveReloadRecord>();
	const hostTransitionCommands = new Map<string, LiveHostTransitionRecord>();
	const cycleModelCommands = new Map<string, { command: CycleModelCommand; receipt: CycleModelReceipt }>();
	const checkpointReads = new Map<string, RetainedCheckpointRead>();
	const checkpointWrites = new Map<string, RetainedCheckpointWrite>();
	let activeSessionOperation: ActiveSessionOperation | undefined;
	let nextSessionOperationGeneration = 1;
	let checkpointRevision = 0;

	const materializeSnapshot = Effect.fn("Runner.materializeSnapshot")(function* (refreshQueue: boolean) {
		if (refreshQueue) {
			const items = yield* Effect.tryPromise({ try: () => resources.queue.list(), catch: asRunnerFailure });
			durableItems.clear();
			for (const item of items) durableItems.set(item.inputId, item);
		}
		const pending = yield* Ref.get(pendingOperations);
		const status = yield* Ref.get(statusRef);
		const items = Array.from(durableItems.values()).sort((left, right) => left.sequence - right.sequence);
		const transcript = resources.sessionManager.snapshotForReplication();
		const viewSnapshots: Array<RunnerViewSnapshot> = [];
		for (const [viewId, view] of views) {
			viewSnapshots.push({
				viewId,
				capability: view.capability,
				controllerEpoch: view.controllerEpoch,
				attachedSequence: view.attachedSequence,
			});
		}
		return {
			runnerIdentity: resources.runnerIdentity,
			revision,
			sessionRevision,
			sequence: runnerSequence,
			durableSequence: items.at(-1)?.sequence ?? 0,
			items,
			transcript: {
				entryCount: transcriptEntryCount,
				leafId: transcriptLeafId,
				header: transcript.header,
				entries: transcript.entries,
				lastEntryId: transcriptLastEntryId,
			},
			recentDeliveries: IrcBus.global().recentDeliveries(),
			views: viewSnapshots,
			controller: activeController,
			activeCompaction:
				activeCompaction === undefined
					? undefined
					: {
							...activeCompaction,
							startedSessionRevision: compactionCommands.get(activeCompaction.commandId)!.startedSessionRevision,
						},
			activeLocalOperation:
				activeLocalOperation === undefined
					? undefined
					: {
							commandId: activeLocalOperation.command.commandId,
							operationGeneration: activeLocalOperation.operationGeneration,
							startedSessionRevision: activeLocalOperation.startedSessionRevision,
							operation: activeLocalOperation.command.operation,
							output: localOperationOutputSnapshot(activeLocalOperation),
							pendingOutputChunks: activeLocalOperation.pendingOutputChunks.length,
							pendingOutputBytes: activeLocalOperation.pendingOutputBytes,
							peakPendingOutputChunks: activeLocalOperation.peakPendingOutputChunks,
							peakPendingOutputBytes: activeLocalOperation.peakPendingOutputBytes,
						},
			activeEphemeralTurn:
				activeEphemeralTurn === undefined
					? undefined
					: {
							commandId: activeEphemeralTurn.command.commandId,
							operationGeneration: activeEphemeralTurn.operationGeneration,
							startedSessionRevision: activeEphemeralTurn.startedSessionRevision,
							output: localOperationOutputSnapshot(activeEphemeralTurn),
							pendingOutputChunks: activeEphemeralTurn.pendingOutputChunks.length,
							pendingOutputBytes: activeEphemeralTurn.pendingOutputBytes,
							peakPendingOutputChunks: activeEphemeralTurn.peakPendingOutputChunks,
							peakPendingOutputBytes: activeEphemeralTurn.peakPendingOutputBytes,
						},
			activeSessionOperation:
				activeSessionOperation === undefined
					? undefined
					: {
							kind: activeSessionOperation.kind,
							commandId: activeSessionOperation.record.command.commandId,
							operationGeneration: activeSessionOperation.record.operationGeneration,
							startedSessionRevision: activeSessionOperation.record.startedSessionRevision,
						},
			checkpointRevision,
			checkpointState: (() => {
				const state = resources.session.getCheckpointState();
				return state === undefined ? undefined : { ...state };
			})(),
			workflow: resources.sessionManager.buildSessionContext().workflow ?? { kind: "none" },
			toolConfigurationGeneration: resources.session.toolConfigurationGeneration,
			activeToolNames: resources.session.getActiveToolNames(),
			todoGeneration: resources.session.todoGeneration,
			status,
			pendingOperations: pending,
		} satisfies SessionRunnerSnapshot;
	});
	const materializeTerminalSnapshot = Effect.fn("Runner.materializeTerminalSnapshot")(function* (
		refreshQueue: boolean,
	) {
		const runner = yield* materializeSnapshot(refreshQueue);
		const model = resources.session.model;
		return {
			terminalSequence,
			runner,
			session: {
				sessionId: resources.session.sessionId,
				sessionFile: resources.session.sessionFile,
				cwd: resources.sessionManager.getCwd(),
				modelSummary:
					model === undefined
						? undefined
						: {
								provider: model.provider,
								api: model.api,
								id: model.id,
								...(model.requestModelId === undefined ? {} : { requestModelId: model.requestModelId }),
								name: model.name,
								contextWindow: model.contextWindow,
							},
				configuredThinkingLevel: resources.session.configuredThinkingLevel(),
				effectiveThinkingLevel: resources.session.thinkingLevel,
				workflow: resources.sessionManager.buildSessionContext().workflow ?? { kind: "none" },
				toolConfigurationGeneration: resources.session.toolConfigurationGeneration,
				activeToolNames: resources.session.getActiveToolNames(),
				todoGeneration: resources.session.todoGeneration,
				todoPhases: resources.session.getTodoPhases(),
				goalModeState: (() => {
					const state = resources.session.getGoalModeState();
					return state === undefined ? undefined : { ...state, goal: { ...state.goal } };
				})(),
				planReferencePath: resources.session.getPlanReferencePath(),
				autoCompactionEnabled: resources.session.autoCompactionEnabled,
				isStreaming: resources.session.isStreaming,
				isCompacting: resources.session.isCompacting,
				hasPostPromptWork: resources.session.hasPostPromptWork,
				isBashRunning: resources.session.isBashRunning,
				promptOperation: resources.session.promptOperation,
				isEvalRunning: resources.session.isEvalRunning,
			},
		} satisfies TerminalSessionSnapshot;
	});

	const publishTerminal = Effect.fn("Runner.publishTerminal")(function* (
		delivery:
			| { readonly kind: "agentEvent"; readonly event: AgentSessionEvent }
			| { readonly kind: "runnerEvent"; readonly event: RunnerEvent },
	) {
		terminalSequence += 1;
		const sequenced = { ...delivery, sequence: terminalSequence } as TerminalRawDelivery;
		yield* Effect.forEach(terminalViews.values(), view => PubSub.publish(view.events, sequenced), {
			discard: true,
		});
	});

	const publishEvent = Effect.fn("Runner.publishEvent")(function* (details: EventDetails) {
		runnerSequence += 1;
		const event: RunnerEvent = {
			schemaVersion: RUNNER_SCHEMA_VERSION,
			kind: details.kind,
			eventId: `${details.kind}:${runnerSequence}`,
			commandId: details.metadata.commandId,
			correlationId: details.metadata.correlationId,
			causationId: details.metadata.causationId,
			revision,
			sessionRevision: details.sessionRevision,
			sequence: runnerSequence,
			controllerEpoch: details.controllerEpoch,
			viewId: details.viewId,
			inputId: details.inputId,
			durableSequence: details.durableSequence,
			transcriptEntryId: details.transcriptEntryId,
			transcriptLeafId: details.transcriptLeafId,
			transcriptPosition: details.transcriptPosition,
			transcriptEntry: details.transcriptEntry,
			targetGeneration: details.targetGeneration,
			targetCommandId: details.targetCommandId,
			targetOperationGeneration: details.targetOperationGeneration,
			localOperationOutput: details.localOperationOutput,
			ephemeralTurnOutput: details.ephemeralTurnOutput,
		};
		yield* PubSub.publish(events, event);
		yield* publishTerminal({ kind: "runnerEvent", event });
	});

	const enqueue = <A>(operation: Effect.Effect<A, RunnerFailure>): Effect.Effect<A, RunnerFailure> =>
		Effect.gen(function* () {
			const status = yield* Ref.get(statusRef);
			if (status !== "running") return yield* Effect.fail(new SessionRunnerStoppedError());
			const reply = yield* Deferred.make<A, RunnerFailure>();
			const cancel = () => Deferred.fail(reply, new SessionRunnerStoppedError()).pipe(Effect.asVoid);
			mailboxWaiters.add(cancel);
			const admittedStatus = yield* Ref.get(statusRef);
			if (admittedStatus !== "running") {
				mailboxWaiters.delete(cancel);
				return yield* Effect.fail(new SessionRunnerStoppedError());
			}
			const queued = Effect.gen(function* () {
				mailboxWaiters.delete(cancel);
				const executionStatus = yield* Ref.get(statusRef);
				if (executionStatus !== "running") {
					yield* Deferred.fail(reply, new SessionRunnerStoppedError());
					return;
				}
				yield* operation.pipe(
					Effect.matchCauseEffect({
						onFailure: cause => {
							const failure = Cause.findErrorOption(cause);
							return Deferred.fail(
								reply,
								failure._tag === "Some"
									? asRunnerFailure(failure.value)
									: new SessionRunnerRuntimeError({ issue: Cause.pretty(cause) }),
							);
						},
						onSuccess: value => Deferred.succeed(reply, value),
					}),
					Effect.asVoid,
				);
			});
			yield* Ref.update(pendingOperations, count => count + 1);
			const offered = yield* Queue.offer(mailbox, queued).pipe(
				Effect.onInterrupt(() =>
					Effect.sync(() => mailboxWaiters.delete(cancel)).pipe(
						Effect.andThen(Ref.update(pendingOperations, count => count - 1)),
					),
				),
			);
			if (!offered) {
				mailboxWaiters.delete(cancel);
				yield* Ref.update(pendingOperations, count => count - 1);
				return yield* Effect.fail(new SessionRunnerStoppedError());
			}
			return yield* Deferred.await(reply);
		});

	const drainMailbox = Effect.forever(
		Queue.take(mailbox).pipe(
			Effect.flatMap(operation => Ref.update(pendingOperations, count => count - 1).pipe(Effect.andThen(operation))),
		),
	);
	yield* Effect.forkScoped(drainMailbox, { startImmediately: true });

	const requireRevision = (expectedRevision: number): Effect.Effect<void, RunnerFailure> =>
		Effect.try({ try: () => assertRunnerRevision(expectedRevision, revision), catch: asRunnerFailure });

	const requireView = (viewId: string): Effect.Effect<MutableViewState, RunnerFailure> => {
		const view = views.get(viewId);
		return view ? Effect.succeed(view) : Effect.fail(new RunnerViewNotAttachedError({ viewId }));
	};

	const requireController = (
		viewId: string,
		controllerEpoch: number,
	): Effect.Effect<MutableViewState, RunnerFailure> => {
		const view = views.get(viewId);
		if (!view) return Effect.fail(new RunnerViewNotAttachedError({ viewId }));
		if (activeController?.viewId !== viewId || activeController.epoch !== controllerEpoch) {
			return Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: controllerEpoch,
					actualControllerEpoch: activeController?.viewId === viewId ? activeController.epoch : undefined,
				}),
			);
		}
		if (view.capability !== "controller") {
			return Effect.fail(new RunnerViewCapabilityError({ viewId, requiredCapability: "controller" }));
		}
		return Effect.succeed(view);
	};

	const applyQueueEvent = Effect.fn("Runner.applyQueueEvent")(function* (event: DurableInputQueueEvent) {
		if (acceptedCommands.has(event.command.commandId)) return;
		acceptedCommands.add(event.command.commandId);
		durableItems.set(event.item.inputId, event.item);
		revision = event.runnerRevision;
		const kind: RunnerEventKind =
			event.kind === "inputAccepted"
				? "inputPrepared"
				: event.kind === "inputEdited"
					? "inputEdited"
					: "inputCancelled";
		yield* publishEvent({
			kind,
			metadata: event.command,
			controllerEpoch: event.command.controllerEpoch,
			viewId: event.command.viewId,
			inputId: event.item.inputId,
			durableSequence: event.item.sequence,
		});
	});

	let transcriptPosition = transcriptEntryCount;
	const unsubscribeQueue = resources.queue.subscribe(event => {
		runCallback(
			enqueue(applyQueueEvent(event)).pipe(
				Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void }),
			),
		);
	});
	const unsubscribeTranscript = resources.sessionManager.subscribeEntries((entry: SessionEntry) => {
		transcriptPosition += 1;
		const position = transcriptPosition;
		const leafId = resources.sessionManager.getLeafId();
		runCallback(
			enqueue(
				Effect.gen(function* () {
					transcriptEntryCount = position;
					transcriptLeafId = leafId;
					transcriptLastEntryId = entry.id;
					sessionRevision = resources.sessionManager.getSessionRevision();
					yield* publishEvent({
						kind: "transcriptEntryAppended",
						metadata: {
							schemaVersion: RUNNER_SCHEMA_VERSION,
							commandId: `transcript:${entry.id}`,
							correlationId: `transcript:${entry.id}`,
							expectedRevision: revision,
						},
						controllerEpoch: activeController?.epoch ?? 0,
						transcriptEntryId: entry.id,
						transcriptLeafId: leafId,
						transcriptEntry: structuredClone(entry) as SessionEntry,
						transcriptPosition: position,
					});
				}),
			).pipe(Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void })),
		);
	});

	let snapshot!: () => Effect.Effect<SessionRunnerSnapshot, RunnerFailure, Scope.Scope>;
	let snapshotView!: (viewId: string) => Effect.Effect<SessionRunnerSnapshot, RunnerFailure, Scope.Scope>;
	let openProjectionView!: (viewId: string) => Effect.Effect<RunnerProjection, RunnerFailure, Scope.Scope>;
	let subscribeView!: (viewId: string) => Effect.Effect<RunnerSubscription, RunnerFailure, Scope.Scope>;
	let detachView!: (command: DetachRunnerViewCommand) => Effect.Effect<void, RunnerFailure, Scope.Scope>;
	let acquireController!: (
		command: AcquireRunnerControllerCommand,
	) => Effect.Effect<ControllerSessionRunnerView, RunnerFailure, Scope.Scope>;
	let releaseController!: (
		command: ReleaseRunnerControllerCommand,
	) => Effect.Effect<ObserverSessionRunnerView, RunnerFailure, Scope.Scope>;
	let submitInput!: (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) => Effect.Effect<RunnerCommandReceipt, RunnerFailure, Scope.Scope>;
	let submitCustomMessage!: (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) => Effect.Effect<RunnerCommandReceipt, RunnerFailure, Scope.Scope>;
	let editQueuedInput!: (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) => Effect.Effect<RunnerCommandReceipt, RunnerFailure, Scope.Scope>;
	let cancelQueuedInput!: (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) => Effect.Effect<RunnerCommandReceipt, RunnerFailure, Scope.Scope>;
	let setActiveTools!: (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) => Effect.Effect<SetActiveToolsReceipt, RunnerFailure, Scope.Scope>;
	let replaceTodos!: (
		viewId: string,
		controllerEpoch: number,
		input: ReplaceTodosCommand,
	) => Effect.Effect<ReplaceTodosReceipt, RunnerFailure, Scope.Scope>;
	let refreshSshTool!: (
		viewId: string,
		controllerEpoch: number,
		input: RefreshSshToolCommand,
	) => Effect.Effect<RefreshSshToolReceipt, RunnerFailure, Scope.Scope>;
	let setModel!: (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) => Effect.Effect<SetModelReceipt, RunnerFailure, Scope.Scope>;
	let setThinkingLevel!: (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) => Effect.Effect<SetThinkingLevelReceipt, RunnerFailure, Scope.Scope>;
	let transitionPlanMode!: (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) => Effect.Effect<TransitionPlanModeReceipt, RunnerFailure, Scope.Scope>;
	let transitionGoalMode!: (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) => Effect.Effect<TransitionGoalModeReceipt, RunnerFailure, Scope.Scope>;
	let runShake!: (
		viewId: string,
		controllerEpoch: number,
		command: RunShakeCommand,
	) => Effect.Effect<RunShakeReceipt, RunnerFailure, Scope.Scope>;
	let cancelShake!: (
		viewId: string,
		controllerEpoch: number,
		command: CancelShakeCommand,
	) => Effect.Effect<CancelShakeReceipt, RunnerFailure, Scope.Scope>;
	let runHandoff!: (
		viewId: string,
		controllerEpoch: number,
		command: RunHandoffCommand,
	) => Effect.Effect<RunHandoffReceipt, RunnerFailure, Scope.Scope>;
	let cancelHandoff!: (
		viewId: string,
		controllerEpoch: number,
		command: CancelHandoffCommand,
	) => Effect.Effect<CancelHandoffReceipt, RunnerFailure, Scope.Scope>;
	let getCheckpointState!: (
		viewId: string,
		controllerEpoch: number,
		command: GetCheckpointStateCommand,
	) => Effect.Effect<GetCheckpointStateReceipt, RunnerFailure, Scope.Scope>;
	let setCheckpointState!: (
		viewId: string,
		controllerEpoch: number,
		command: SetCheckpointStateCommand,
	) => Effect.Effect<SetCheckpointStateReceipt, RunnerFailure, Scope.Scope>;
	let reloadSession!: (
		viewId: string,
		controllerEpoch: number,
		command: ReloadSessionCommand,
	) => Effect.Effect<ReloadSessionReceipt, RunnerFailure, Scope.Scope>;
	let prepareHostTransition!: (
		viewId: string,
		controllerEpoch: number,
		command: PrepareHostTransitionCommand,
	) => Effect.Effect<PrepareHostTransitionReceipt, RunnerFailure, Scope.Scope>;
	let runCompaction!: (
		viewId: string,
		controllerEpoch: number,
		command: RunCompactionCommand,
	) => Effect.Effect<RunCompactionReceipt, RunnerFailure, Scope.Scope>;
	let cancelCompaction!: (
		viewId: string,
		controllerEpoch: number,
		command: CancelCompactionCommand,
	) => Effect.Effect<CancelCompactionReceipt, RunnerFailure, Scope.Scope>;
	let runEphemeralTurn!: (
		viewId: string,
		controllerEpoch: number,
		command: RunEphemeralTurnCommand,
	) => Effect.Effect<RunEphemeralTurnReceipt, RunnerFailure, Scope.Scope>;
	let cancelEphemeralTurn!: (
		viewId: string,
		controllerEpoch: number,
		command: CancelEphemeralTurnCommand,
	) => Effect.Effect<CancelEphemeralTurnReceipt, RunnerFailure, Scope.Scope>;
	let runLocalOperation!: (
		viewId: string,
		controllerEpoch: number,
		command: RunLocalOperationCommand,
	) => Effect.Effect<RunLocalOperationReceipt, RunnerFailure, Scope.Scope>;
	let cancelLocalOperation!: (
		viewId: string,
		controllerEpoch: number,
		command: CancelLocalOperationCommand,
	) => Effect.Effect<CancelLocalOperationReceipt, RunnerFailure, Scope.Scope>;
	let interruptPrompt!: (
		viewId: string,
		controllerEpoch: number,
		command: InterruptPromptCommand,
	) => Effect.Effect<InterruptPromptReceipt, RunnerFailure, Scope.Scope>;

	const mismatchedView = (viewId: string): Effect.Effect<never, RunnerFailure> =>
		Effect.fail(new InvalidRunnerCommandError({ issue: `Command does not belong to view ${viewId}` }));

	const observerView = (viewId: string): ObserverSessionRunnerView => {
		const detach = (command: DetachRunnerViewCommand) =>
			command.viewId === viewId ? detachView(command) : mismatchedView(viewId);
		return {
			viewId,
			capability: "observer",
			snapshot: () => snapshotView(viewId),
			subscribe: () => subscribeView(viewId),
			openProjection: () => openProjectionView(viewId),
			detach,
			close: detach,
			acquireController: command =>
				command.viewId === viewId ? acquireController(command) : mismatchedView(viewId),
		};
	};
	const controllerView = (viewId: string, controllerEpoch: number): ControllerSessionRunnerView => {
		const detach = (command: DetachRunnerViewCommand) =>
			command.viewId === viewId ? detachView(command) : mismatchedView(viewId);
		return {
			viewId,
			capability: "controller",
			controllerEpoch,
			snapshot: () => snapshotView(viewId),
			subscribe: () => subscribeView(viewId),
			openProjection: () => openProjectionView(viewId),
			detach,
			close: detach,
			submitInput: input => submitInput(viewId, controllerEpoch, input),
			submitCustomMessage: input => submitCustomMessage(viewId, controllerEpoch, input),
			editQueuedInput: input => editQueuedInput(viewId, controllerEpoch, input),
			cancelQueuedInput: input => cancelQueuedInput(viewId, controllerEpoch, input),
			setActiveTools: input => setActiveTools(viewId, controllerEpoch, input),
			replaceTodos: input => replaceTodos(viewId, controllerEpoch, input),
			cycleModel: input => cycleModel(viewId, controllerEpoch, input),
			refreshSshTool: input => refreshSshTool(viewId, controllerEpoch, input),
			setThinkingLevel: input => setThinkingLevel(viewId, controllerEpoch, input),
			setModel: input => setModel(viewId, controllerEpoch, input),
			transitionPlanMode: input => transitionPlanMode(viewId, controllerEpoch, input),
			transitionGoalMode: input => transitionGoalMode(viewId, controllerEpoch, input),
			shake: input => runShake(viewId, controllerEpoch, input),
			cancelShake: input => cancelShake(viewId, controllerEpoch, input),
			handoff: input => runHandoff(viewId, controllerEpoch, input),
			cancelHandoff: input => cancelHandoff(viewId, controllerEpoch, input),
			getCheckpointState: input => getCheckpointState(viewId, controllerEpoch, input),
			setCheckpointState: input => setCheckpointState(viewId, controllerEpoch, input),
			reload: input => reloadSession(viewId, controllerEpoch, input),
			prepareHostTransition: input => prepareHostTransition(viewId, controllerEpoch, input),
			compact: input => runCompaction(viewId, controllerEpoch, input),
			cancelCompaction: command => cancelCompaction(viewId, controllerEpoch, command),
			runEphemeralTurn: command => runEphemeralTurn(viewId, controllerEpoch, command),
			cancelEphemeralTurn: command => cancelEphemeralTurn(viewId, controllerEpoch, command),
			runLocalOperation: command => runLocalOperation(viewId, controllerEpoch, command),
			cancelLocalOperation: command => cancelLocalOperation(viewId, controllerEpoch, command),
			interruptPrompt: command => interruptPrompt(viewId, controllerEpoch, command),
			releaseController: command =>
				command.viewId === viewId ? releaseController(command) : mismatchedView(viewId),
		};
	};

	snapshot = Effect.fn("Runner.snapshot")(function* () {
		const status = yield* Ref.get(statusRef);
		return status === "running" ? yield* enqueue(materializeSnapshot(true)) : yield* materializeSnapshot(false);
	});

	snapshotView = Effect.fn("Runner.snapshotView")(function* (viewId: string) {
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireView(viewId);
				return yield* materializeSnapshot(true);
			}),
		);
	});

	openProjectionView = Effect.fn("Runner.openProjectionView")(function* (viewId: string) {
		const subscription = yield* PubSub.subscribe(events);
		const baseline = yield* enqueue(
			Effect.gen(function* () {
				yield* requireView(viewId);
				return yield* materializeSnapshot(true);
			}),
		);
		let expectedSequence = baseline.sequence + 1;
		let take!: Effect.Effect<RunnerEventDelivery, RunnerFailure, Scope.Scope>;
		take = Effect.suspend(() =>
			PubSub.take(subscription).pipe(
				Effect.flatMap((event): Effect.Effect<RunnerEventDelivery, RunnerFailure, Scope.Scope> => {
					if (event.sequence < expectedSequence) return take;
					if (event.sequence !== expectedSequence) {
						const expected = expectedSequence;
						return snapshot().pipe(
							Effect.map(current => {
								expectedSequence = current.sequence + 1;
								return {
									kind: "resyncRequired" as const,
									expectedSequence: expected,
									observedSequence: event.sequence,
									event,
									snapshot: current,
								};
							}),
						);
					}
					expectedSequence += 1;
					return Effect.succeed({ kind: "event" as const, event });
				}),
			),
		);
		return { snapshot: baseline, subscription: { take } };
	});

	subscribeView = Effect.fn("Runner.subscribeView")(function* (viewId: string) {
		const subscription = yield* PubSub.subscribe(events);
		const starting = yield* enqueue(
			Effect.gen(function* () {
				yield* requireView(viewId);
				return runnerSequence;
			}),
		);
		let expectedSequence = starting + 1;
		let take!: Effect.Effect<RunnerEventDelivery, RunnerFailure, Scope.Scope>;
		take = Effect.suspend(() =>
			PubSub.take(subscription).pipe(
				Effect.flatMap((event): Effect.Effect<RunnerEventDelivery, RunnerFailure, Scope.Scope> => {
					if (event.sequence < expectedSequence) return take;
					if (event.sequence !== expectedSequence) {
						const expected = expectedSequence;
						return snapshot().pipe(
							Effect.map(current => {
								expectedSequence = current.sequence + 1;
								return {
									kind: "resyncRequired" as const,
									expectedSequence: expected,
									observedSequence: event.sequence,
									event,
									snapshot: current,
								};
							}),
						);
					}
					expectedSequence += 1;
					return Effect.succeed({ kind: "event" as const, event });
				}),
			),
		);
		return { take };
	});

	submitInput = Effect.fn("Runner.submitInput")(function* (viewId: string, controllerEpoch: number, input: unknown) {
		const command = yield* Effect.try({ try: () => decodeSubmitInputCommand(input), catch: asRunnerFailure });
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const prior = yield* Effect.tryPromise({
					try: () => resources.queue.getCommandReceipt(command.commandId),
					catch: asRunnerFailure,
				});
				if (!prior) yield* requireRevision(command.expectedRevision);
				const durable = yield* Effect.tryPromise({
					try: () =>
						resources.session.acceptDurableInput(
							{
								text: command.payload.text,
								images: command.payload.images,
								deliveryClass: command.payload.deliveryClass,
							},
							{
								schemaVersion: 1,
								commandId: command.commandId,
								correlationId: command.correlationId,
								...(command.causationId === undefined ? {} : { causationId: command.causationId }),
								viewId,
								controllerEpoch,
								expectedRevision: command.expectedRevision,
							},
						),
					catch: asRunnerFailure,
				});
				revision = Math.max(revision, durable.runnerRevision);
				durableItems.set(durable.item.inputId, durable.item);
				if (!durable.replayed) {
					yield* applyQueueEvent({
						kind: "inputAccepted",
						runnerRevision: durable.runnerRevision,
						command: durable.command,
						item: durable.item,
					});
				}
				return {
					commandId: durable.command.commandId,
					correlationId: durable.command.correlationId,
					...(durable.command.causationId === undefined ? {} : { causationId: durable.command.causationId }),
					inputId: durable.item.inputId,
					durableSequence: durable.item.sequence,
					revision: durable.runnerRevision,
					replayed: durable.replayed,
				} satisfies RunnerCommandReceipt;
			}),
		);
	});

	submitCustomMessage = Effect.fn("Runner.submitCustomMessage")(function* (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) {
		const command = yield* Effect.try({
			try: () => decodeSubmitCustomMessageCommand(input),
			catch: asRunnerFailure,
		});
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const prior = yield* Effect.tryPromise({
					try: () => resources.queue.getCommandReceipt(command.commandId),
					catch: asRunnerFailure,
				});
				if (!prior) yield* requireRevision(command.expectedRevision);
				const durable = yield* Effect.tryPromise({
					try: () =>
						resources.session.acceptDurableCustomMessage(command.payload as DurableCustomPayload, {
							schemaVersion: 1,
							commandId: command.commandId,
							correlationId: command.correlationId,
							...(command.causationId === undefined ? {} : { causationId: command.causationId }),
							viewId,
							controllerEpoch,
							expectedRevision: command.expectedRevision,
						}),
					catch: asRunnerFailure,
				});
				revision = Math.max(revision, durable.runnerRevision);
				durableItems.set(durable.item.inputId, durable.item);
				if (!durable.replayed) {
					yield* applyQueueEvent({
						kind: "inputAccepted",
						runnerRevision: durable.runnerRevision,
						command: durable.command,
						item: durable.item,
					});
				}
				return {
					commandId: durable.command.commandId,
					correlationId: durable.command.correlationId,
					...(durable.command.causationId === undefined ? {} : { causationId: durable.command.causationId }),
					inputId: durable.item.inputId,
					durableSequence: durable.item.sequence,
					revision: durable.runnerRevision,
					replayed: durable.replayed,
				} satisfies RunnerCommandReceipt;
			}),
		);
	});

	editQueuedInput = Effect.fn("Runner.editQueuedInput")(function* (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) {
		const command = yield* Effect.try({ try: () => decodeEditQueuedInputCommand(input), catch: asRunnerFailure });
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const prior = yield* Effect.tryPromise({
					try: () => resources.queue.getCommandReceipt(command.commandId),
					catch: asRunnerFailure,
				});
				if (!prior) yield* requireRevision(command.expectedRevision);
				const durable = yield* Effect.tryPromise({
					try: () =>
						resources.session.editDurableInputCommand(
							command.inputId,
							command.itemRevision,
							{ text: command.payload.text, images: command.payload.images },
							{
								schemaVersion: 1,
								commandId: command.commandId,
								correlationId: command.correlationId,
								...(command.causationId === undefined ? {} : { causationId: command.causationId }),
								viewId,
								controllerEpoch,
								expectedRevision: command.expectedRevision,
							},
						),
					catch: asRunnerFailure,
				});
				revision = Math.max(revision, durable.runnerRevision);
				durableItems.set(durable.item.inputId, durable.item);
				if (!durable.replayed) {
					yield* applyQueueEvent({
						kind: "inputEdited",
						runnerRevision: durable.runnerRevision,
						command: durable.command,
						item: durable.item,
					});
				}
				return {
					commandId: durable.command.commandId,
					correlationId: durable.command.correlationId,
					...(durable.command.causationId === undefined ? {} : { causationId: durable.command.causationId }),
					inputId: durable.item.inputId,
					durableSequence: durable.item.sequence,
					revision: durable.runnerRevision,
					replayed: durable.replayed,
				} satisfies RunnerCommandReceipt;
			}),
		);
	});

	cancelQueuedInput = Effect.fn("Runner.cancelQueuedInput")(function* (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) {
		const command = yield* Effect.try({ try: () => decodeCancelQueuedInputCommand(input), catch: asRunnerFailure });
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const prior = yield* Effect.tryPromise({
					try: () => resources.queue.getCommandReceipt(command.commandId),
					catch: asRunnerFailure,
				});
				if (!prior) yield* requireRevision(command.expectedRevision);
				const durable = yield* Effect.tryPromise({
					try: () =>
						resources.session.cancelDurableInputCommand(command.inputId, command.itemRevision, {
							schemaVersion: 1,
							commandId: command.commandId,
							correlationId: command.correlationId,
							...(command.causationId === undefined ? {} : { causationId: command.causationId }),
							viewId,
							controllerEpoch,
							expectedRevision: command.expectedRevision,
						}),
					catch: asRunnerFailure,
				});
				revision = Math.max(revision, durable.runnerRevision);
				durableItems.set(durable.item.inputId, durable.item);
				if (!durable.replayed) {
					yield* applyQueueEvent({
						kind: "inputCancelled",
						runnerRevision: durable.runnerRevision,
						command: durable.command,
						item: durable.item,
					});
				}
				return {
					commandId: durable.command.commandId,
					correlationId: durable.command.correlationId,
					...(durable.command.causationId === undefined ? {} : { causationId: durable.command.causationId }),
					inputId: durable.item.inputId,
					durableSequence: durable.item.sequence,
					revision: durable.runnerRevision,
					replayed: durable.replayed,
				} satisfies RunnerCommandReceipt;
			}),
		);
	});

	const reserveOperationCapacity = <T extends { readonly completed: boolean }>(records: Map<string, T>): boolean => {
		if (records.size < options.eventCapacity) return true;
		for (const [commandId, record] of records) {
			if (!record.completed) continue;
			records.delete(commandId);
			return true;
		}
		return false;
	};

	const refreshSessionProjection = (): void => {
		sessionRevision = resources.sessionManager.getSessionRevision();
		const entries = resources.sessionManager.getEntries();
		transcriptEntryCount = entries.length;
		transcriptPosition = entries.length;
		transcriptLeafId = resources.sessionManager.getLeafId();
		transcriptLastEntryId = entries.at(-1)?.id;
	};

	const requireSessionOperationAvailable = (): Effect.Effect<void, RunnerFailure> => {
		if (
			activeSessionOperation !== undefined ||
			activeCompaction !== undefined ||
			activeLocalOperation !== undefined ||
			activeEphemeralTurn !== undefined ||
			resources.session.isStreaming ||
			resources.session.isCompacting ||
			resources.session.isRetrying ||
			resources.session.isGeneratingHandoff
		) {
			return Effect.fail(new SessionStateCommandInFlightError());
		}
		return Effect.void;
	};

	const sameShakeCommand = (left: RunShakeCommand, right: RunShakeCommand): boolean =>
		left.schemaVersion === right.schemaVersion &&
		left.kind === right.kind &&
		left.commandId === right.commandId &&
		left.correlationId === right.correlationId &&
		left.causationId === right.causationId &&
		left.expectedSessionRevision === right.expectedSessionRevision &&
		left.viewId === right.viewId &&
		left.controllerEpoch === right.controllerEpoch &&
		left.mode === right.mode;

	runShake = Effect.fn("Runner.runShake")(function* (viewId: string, controllerEpoch: number, input: RunShakeCommand) {
		const command = yield* Effect.try({ try: () => decodeRunShakeCommand(input), catch: asRunnerFailure });
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		const admitted = yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const retained = shakeCommands.get(command.commandId);
				if (retained !== undefined) {
					if (!sameShakeCommand(retained.command, command)) {
						return yield* Effect.fail(
							new InvalidRunnerCommandError({ issue: `Conflicting shake command ${command.commandId}` }),
						);
					}
					return { record: retained, replayed: true };
				}
				if (command.expectedSessionRevision !== sessionRevision) {
					return yield* Effect.fail(
						new SessionRevisionConflictError(command.expectedSessionRevision, sessionRevision),
					);
				}
				yield* requireSessionOperationAvailable();
				if (!reserveOperationCapacity(shakeCommands)) {
					return yield* Effect.fail(new SessionStateCommandInFlightError());
				}
				const deferred = yield* Deferred.make<RunShakeReceipt, RunnerFailure>();
				const record: LiveShakeRecord = {
					command,
					operationGeneration: nextSessionOperationGeneration++,
					startedSessionRevision: sessionRevision,
					deferred,
					abortController: new AbortController(),
					completed: false,
					cancellationRequested: false,
				};
				shakeCommands.set(command.commandId, record);
				activeSessionOperation = { kind: "shake", record };
				runSessionOperation(
					Effect.tryPromise({
						try: () => resources.session.shake(command.mode, { signal: record.abortController.signal }),
						catch: asRunnerFailure,
					}).pipe(
						Effect.matchEffect({
							onFailure: failure =>
								enqueue(
									Effect.sync(() => {
										record.completed = true;
										if (activeSessionOperation?.record === record) activeSessionOperation = undefined;
										return failure;
									}),
								).pipe(
									Effect.flatMap(retainedFailure => Deferred.fail(record.deferred, retainedFailure)),
									Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void }),
								),
							onSuccess: result =>
								enqueue(
									Effect.gen(function* () {
										refreshSessionProjection();
										record.completed = true;
										if (activeSessionOperation?.record === record) activeSessionOperation = undefined;
										const receipt: RunShakeReceipt = {
											commandId: command.commandId,
											correlationId: command.correlationId,
											...(command.causationId === undefined ? {} : { causationId: command.causationId }),
											startedSessionRevision: record.startedSessionRevision,
											operationGeneration: record.operationGeneration,
											completedSessionRevision: sessionRevision,
											replayed: false,
											result: {
												mode: result.mode,
												toolResultsDropped: result.toolResultsDropped,
												blocksDropped: result.blocksDropped,
												...(result.imagesDropped === undefined
													? {}
													: { imagesDropped: result.imagesDropped }),
												tokensFreed: result.tokensFreed,
												...(result.artifactId === undefined ? {} : { artifactId: result.artifactId }),
											},
										};
										yield* publishEvent({
											kind: "shakeCompleted",
											metadata: command,
											controllerEpoch,
											viewId,
											targetCommandId: command.commandId,
											targetOperationGeneration: record.operationGeneration,
											sessionRevision,
										});
										yield* Deferred.succeed(record.deferred, receipt);
									}),
								).pipe(Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void })),
						}),
					),
				);
				return { record, replayed: false };
			}),
		);
		const receipt = yield* Deferred.await(admitted.record.deferred);
		return admitted.replayed ? { ...receipt, replayed: true } : receipt;
	});

	cancelShake = Effect.fn("Runner.cancelShake")(function* (
		viewId: string,
		controllerEpoch: number,
		input: CancelShakeCommand,
	) {
		const command = yield* Effect.try({ try: () => decodeCancelShakeCommand(input), catch: asRunnerFailure });
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const active = activeSessionOperation;
				if (
					active?.kind !== "shake" ||
					active.record.completed ||
					active.record.command.commandId !== command.targetCommandId ||
					active.record.operationGeneration !== command.targetOperationGeneration
				) {
					return yield* Effect.fail(
						new InvalidRunnerCommandError({ issue: "Shake cancellation target is not active" }),
					);
				}
				if (!active.record.cancellationRequested) {
					active.record.cancellationRequested = true;
					active.record.abortController.abort();
					yield* publishEvent({
						kind: "shakeCancelRequested",
						metadata: command,
						controllerEpoch,
						viewId,
						targetCommandId: command.targetCommandId,
						targetOperationGeneration: command.targetOperationGeneration,
						sessionRevision,
					});
				}
				return {
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					targetCommandId: command.targetCommandId,
					targetOperationGeneration: command.targetOperationGeneration,
					cancellationRequested: true,
				} satisfies CancelShakeReceipt;
			}),
		);
	});

	const sameHandoffCommand = (left: RunHandoffCommand, right: RunHandoffCommand): boolean =>
		left.schemaVersion === right.schemaVersion &&
		left.kind === right.kind &&
		left.commandId === right.commandId &&
		left.correlationId === right.correlationId &&
		left.causationId === right.causationId &&
		left.expectedSessionRevision === right.expectedSessionRevision &&
		left.viewId === right.viewId &&
		left.controllerEpoch === right.controllerEpoch &&
		left.customInstructions === right.customInstructions;

	runHandoff = Effect.fn("Runner.runHandoff")(function* (
		viewId: string,
		controllerEpoch: number,
		input: RunHandoffCommand,
	) {
		const command = yield* Effect.try({ try: () => decodeRunHandoffCommand(input), catch: asRunnerFailure });
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		const admitted = yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const retained = handoffCommands.get(command.commandId);
				if (retained !== undefined) {
					if (!sameHandoffCommand(retained.command, command)) {
						return yield* Effect.fail(
							new InvalidRunnerCommandError({ issue: `Conflicting handoff command ${command.commandId}` }),
						);
					}
					return { record: retained, replayed: true };
				}
				if (command.expectedSessionRevision !== sessionRevision) {
					return yield* Effect.fail(
						new SessionRevisionConflictError(command.expectedSessionRevision, sessionRevision),
					);
				}
				yield* requireSessionOperationAvailable();
				if (!reserveOperationCapacity(handoffCommands)) {
					return yield* Effect.fail(new SessionStateCommandInFlightError());
				}
				const deferred = yield* Deferred.make<RunHandoffReceipt, RunnerFailure>();
				const record: LiveHandoffRecord = {
					command,
					operationGeneration: nextSessionOperationGeneration++,
					startedSessionRevision: sessionRevision,
					deferred,
					abortController: new AbortController(),
					completed: false,
					cancellationRequested: false,
				};
				handoffCommands.set(command.commandId, record);
				activeSessionOperation = { kind: "handoff", record };
				runSessionOperation(
					Effect.tryPromise({
						try: () =>
							resources.session.handoff(command.customInstructions, { signal: record.abortController.signal }),
						catch: asRunnerFailure,
					}).pipe(
						Effect.matchEffect({
							onFailure: failure =>
								enqueue(
									Effect.sync(() => {
										record.completed = true;
										if (activeSessionOperation?.record === record) activeSessionOperation = undefined;
										return failure;
									}),
								).pipe(
									Effect.flatMap(retainedFailure => Deferred.fail(record.deferred, retainedFailure)),
									Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void }),
								),
							onSuccess: result =>
								enqueue(
									Effect.gen(function* () {
										refreshSessionProjection();
										record.completed = true;
										if (activeSessionOperation?.record === record) activeSessionOperation = undefined;
										const receipt: RunHandoffReceipt = {
											commandId: command.commandId,
											correlationId: command.correlationId,
											...(command.causationId === undefined ? {} : { causationId: command.causationId }),
											startedSessionRevision: record.startedSessionRevision,
											operationGeneration: record.operationGeneration,
											completedSessionRevision: sessionRevision,
											replayed: false,
											result:
												result === undefined
													? undefined
													: {
															document: result.document,
															...(result.savedPath === undefined ? {} : { savedPath: result.savedPath }),
															sessionId: resources.session.sessionId,
															...(resources.session.sessionFile === undefined
																? {}
																: { sessionFile: resources.session.sessionFile }),
														},
										};
										yield* publishEvent({
											kind: "handoffCompleted",
											metadata: command,
											controllerEpoch,
											viewId,
											targetCommandId: command.commandId,
											targetOperationGeneration: record.operationGeneration,
											sessionRevision,
										});
										yield* Deferred.succeed(record.deferred, receipt);
									}),
								).pipe(Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void })),
						}),
					),
				);
				return { record, replayed: false };
			}),
		);
		const receipt = yield* Deferred.await(admitted.record.deferred);
		return admitted.replayed ? { ...receipt, replayed: true } : receipt;
	});

	cancelHandoff = Effect.fn("Runner.cancelHandoff")(function* (
		viewId: string,
		controllerEpoch: number,
		input: CancelHandoffCommand,
	) {
		const command = yield* Effect.try({ try: () => decodeCancelHandoffCommand(input), catch: asRunnerFailure });
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const active = activeSessionOperation;
				if (
					active?.kind !== "handoff" ||
					active.record.completed ||
					active.record.command.commandId !== command.targetCommandId ||
					active.record.operationGeneration !== command.targetOperationGeneration
				) {
					return yield* Effect.fail(
						new InvalidRunnerCommandError({ issue: "Handoff cancellation target is not active" }),
					);
				}
				if (!active.record.cancellationRequested) {
					active.record.cancellationRequested = true;
					active.record.abortController.abort();
					yield* publishEvent({
						kind: "handoffCancelRequested",
						metadata: command,
						controllerEpoch,
						viewId,
						targetCommandId: command.targetCommandId,
						targetOperationGeneration: command.targetOperationGeneration,
						sessionRevision,
					});
				}
				return {
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					targetCommandId: command.targetCommandId,
					targetOperationGeneration: command.targetOperationGeneration,
					cancellationRequested: true,
				} satisfies CancelHandoffReceipt;
			}),
		);
	});

	const sameCheckpointReadCommand = (left: GetCheckpointStateCommand, right: GetCheckpointStateCommand): boolean =>
		left.schemaVersion === right.schemaVersion &&
		left.kind === right.kind &&
		left.commandId === right.commandId &&
		left.correlationId === right.correlationId &&
		left.causationId === right.causationId &&
		left.viewId === right.viewId &&
		left.controllerEpoch === right.controllerEpoch;

	getCheckpointState = Effect.fn("Runner.getCheckpointState")(function* (
		viewId: string,
		controllerEpoch: number,
		input: GetCheckpointStateCommand,
	) {
		const command = yield* Effect.try({
			try: () => decodeGetCheckpointStateCommand(input),
			catch: asRunnerFailure,
		});
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const retained = checkpointReads.get(command.commandId);
				if (retained !== undefined) {
					if (!sameCheckpointReadCommand(retained.command, command)) {
						return yield* Effect.fail(
							new InvalidRunnerCommandError({ issue: `Conflicting checkpoint read ${command.commandId}` }),
						);
					}
					return { ...retained.receipt, replayed: true };
				}
				if (checkpointReads.size >= options.eventCapacity) {
					const oldest = checkpointReads.keys().next().value;
					if (oldest !== undefined) checkpointReads.delete(oldest);
				}
				const state = resources.session.getCheckpointState();
				const receipt: GetCheckpointStateReceipt = {
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					sessionRevision,
					checkpointRevision,
					state: state === undefined ? undefined : { ...state },
					replayed: false,
				};
				checkpointReads.set(command.commandId, { command, receipt });
				return receipt;
			}),
		);
	});

	const sameCheckpointState = (
		left: SetCheckpointStateCommand["state"],
		right: SetCheckpointStateCommand["state"],
	): boolean =>
		(left === null && right === null) ||
		(left !== null &&
			right !== null &&
			left.checkpointMessageCount === right.checkpointMessageCount &&
			left.checkpointEntryId === right.checkpointEntryId &&
			left.startedAt === right.startedAt);

	const sameCheckpointWriteCommand = (left: SetCheckpointStateCommand, right: SetCheckpointStateCommand): boolean =>
		left.schemaVersion === right.schemaVersion &&
		left.kind === right.kind &&
		left.commandId === right.commandId &&
		left.correlationId === right.correlationId &&
		left.causationId === right.causationId &&
		left.viewId === right.viewId &&
		left.controllerEpoch === right.controllerEpoch &&
		left.expectedCheckpointRevision === right.expectedCheckpointRevision &&
		sameCheckpointState(left.state, right.state);

	setCheckpointState = Effect.fn("Runner.setCheckpointState")(function* (
		viewId: string,
		controllerEpoch: number,
		input: SetCheckpointStateCommand,
	) {
		const command = yield* Effect.try({
			try: () => decodeSetCheckpointStateCommand(input),
			catch: asRunnerFailure,
		});
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const retained = checkpointWrites.get(command.commandId);
				if (retained !== undefined) {
					if (!sameCheckpointWriteCommand(retained.command, command)) {
						return yield* Effect.fail(
							new InvalidRunnerCommandError({ issue: `Conflicting checkpoint write ${command.commandId}` }),
						);
					}
					return { ...retained.receipt, replayed: true };
				}
				if (command.expectedCheckpointRevision !== checkpointRevision) {
					return yield* Effect.fail(
						new RunnerRevisionConflictError({
							expectedRevision: command.expectedCheckpointRevision,
							actualRevision: checkpointRevision,
						}),
					);
				}
				const state = command.state === null ? undefined : { ...command.state };
				resources.session.setCheckpointState(state);
				checkpointRevision += 1;
				const receipt: SetCheckpointStateReceipt = {
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					sessionRevision,
					checkpointRevision,
					state,
					replayed: false,
				};
				if (checkpointWrites.size >= options.eventCapacity) {
					const oldest = checkpointWrites.keys().next().value;
					if (oldest !== undefined) checkpointWrites.delete(oldest);
				}
				checkpointWrites.set(command.commandId, { command, receipt });
				yield* publishEvent({
					kind: "checkpointChanged",
					metadata: command,
					controllerEpoch,
					viewId,
					targetGeneration: checkpointRevision,
					sessionRevision,
				});
				return receipt;
			}),
		);
	});

	const sameReloadCommand = (left: ReloadSessionCommand, right: ReloadSessionCommand): boolean =>
		left.schemaVersion === right.schemaVersion &&
		left.kind === right.kind &&
		left.commandId === right.commandId &&
		left.correlationId === right.correlationId &&
		left.causationId === right.causationId &&
		left.expectedSessionRevision === right.expectedSessionRevision &&
		left.viewId === right.viewId &&
		left.controllerEpoch === right.controllerEpoch;

	reloadSession = Effect.fn("Runner.reloadSession")(function* (
		viewId: string,
		controllerEpoch: number,
		input: ReloadSessionCommand,
	) {
		const command = yield* Effect.try({ try: () => decodeReloadSessionCommand(input), catch: asRunnerFailure });
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		const admitted = yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const retained = reloadCommands.get(command.commandId);
				if (retained !== undefined) {
					if (!sameReloadCommand(retained.command, command)) {
						return yield* Effect.fail(
							new InvalidRunnerCommandError({ issue: `Conflicting reload command ${command.commandId}` }),
						);
					}
					return { record: retained, replayed: true };
				}
				if (command.expectedSessionRevision !== sessionRevision) {
					return yield* Effect.fail(
						new SessionRevisionConflictError(command.expectedSessionRevision, sessionRevision),
					);
				}
				yield* requireSessionOperationAvailable();
				if (!reserveOperationCapacity(reloadCommands)) {
					return yield* Effect.fail(new SessionStateCommandInFlightError());
				}
				const deferred = yield* Deferred.make<ReloadSessionReceipt, RunnerFailure>();
				const record: LiveReloadRecord = {
					command,
					operationGeneration: nextSessionOperationGeneration++,
					startedSessionRevision: sessionRevision,
					deferred,
					completed: false,
				};
				reloadCommands.set(command.commandId, record);
				activeSessionOperation = { kind: "reload", record };
				runSessionOperation(
					Effect.tryPromise({
						try: () => resources.session.reload(),
						catch: asRunnerFailure,
					}).pipe(
						Effect.matchEffect({
							onFailure: failure =>
								enqueue(
									Effect.sync(() => {
										record.completed = true;
										if (activeSessionOperation?.record === record) activeSessionOperation = undefined;
										return failure;
									}),
								).pipe(
									Effect.flatMap(retainedFailure => Deferred.fail(record.deferred, retainedFailure)),
									Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void }),
								),
							onSuccess: switched =>
								enqueue(
									Effect.gen(function* () {
										record.completed = true;
										if (activeSessionOperation?.record === record) activeSessionOperation = undefined;
										if (!switched) {
											reloadCommands.delete(command.commandId);
											return yield* Deferred.fail(
												record.deferred,
												new RunnerSessionReloadCancelledError({ reason: "session-before-switch" }),
											);
										}
										refreshSessionProjection();
										resources.session.setCheckpointState(undefined);
										checkpointRevision += 1;
										yield* publishEvent({
											kind: "checkpointChanged",
											metadata: command,
											controllerEpoch,
											viewId,
											targetGeneration: checkpointRevision,
											sessionRevision,
										});
										const receipt: ReloadSessionReceipt = {
											commandId: command.commandId,
											correlationId: command.correlationId,
											...(command.causationId === undefined ? {} : { causationId: command.causationId }),
											startedSessionRevision: record.startedSessionRevision,
											operationGeneration: record.operationGeneration,
											completedSessionRevision: sessionRevision,
											sessionId: resources.session.sessionId,
											...(resources.session.sessionFile === undefined
												? {}
												: { sessionFile: resources.session.sessionFile }),
											replayed: false,
										};
										yield* publishEvent({
											kind: "sessionReloaded",
											metadata: command,
											controllerEpoch,
											viewId,
											targetCommandId: command.commandId,
											targetOperationGeneration: record.operationGeneration,
											sessionRevision,
										});
										yield* Deferred.succeed(record.deferred, receipt);
									}),
								).pipe(Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void })),
						}),
					),
				);
				return { record, replayed: false };
			}),
		);
		const receipt = yield* Deferred.await(admitted.record.deferred);
		return admitted.replayed ? { ...receipt, replayed: true } : receipt;
	});

	const sameSessionLocator = (
		left: { readonly kind: "id"; readonly id: string } | { readonly kind: "path"; readonly path: string },
		right: { readonly kind: "id"; readonly id: string } | { readonly kind: "path"; readonly path: string },
	): boolean =>
		left.kind === "id"
			? right.kind === "id" && left.id === right.id
			: right.kind === "path" && left.path === right.path;

	const sameHostIntent = (left: InteractiveHostIntent, right: InteractiveHostIntent): boolean => {
		switch (left.kind) {
			case "exit":
			case "freshSession":
			case "restartProcess":
				return right.kind === left.kind;
			case "newSession":
				return (
					right.kind === "newSession" &&
					(left.parent === undefined
						? right.parent === undefined
						: right.parent !== undefined && sameSessionLocator(left.parent, right.parent))
				);
			case "resume":
			case "switchSession":
				return right.kind === left.kind && sameSessionLocator(left.session, right.session);
			case "fork":
			case "branch":
				return right.kind === left.kind && left.entryId === right.entryId;
			case "navigate":
				return right.kind === "navigate" && left.targetId === right.targetId && left.summarize === right.summarize;
			case "moveSession":
				return right.kind === "moveSession" && left.newDir === right.newDir;
		}
	};

	const sameHostTransitionCommand = (
		left: PrepareHostTransitionCommand,
		right: PrepareHostTransitionCommand,
	): boolean =>
		left.schemaVersion === right.schemaVersion &&
		left.kind === right.kind &&
		left.commandId === right.commandId &&
		left.correlationId === right.correlationId &&
		left.causationId === right.causationId &&
		left.expectedSessionRevision === right.expectedSessionRevision &&
		left.viewId === right.viewId &&
		left.controllerEpoch === right.controllerEpoch &&
		sameHostIntent(left.intent, right.intent);

	const resolveSessionLocator = async (
		locator: { readonly kind: "id"; readonly id: string } | { readonly kind: "path"; readonly path: string },
	): Promise<string> => {
		if (locator.kind === "path") return locator.path;
		const session = (await SessionManager.listAll()).find(candidate => candidate.id === locator.id);
		if (!session) throw new Error(`Session ${locator.id} not found`);
		return session.path;
	};

	const performHostTransition = async (intent: InteractiveHostIntent): Promise<HostTransitionOutcome> => {
		switch (intent.kind) {
			case "exit":
				await resources.sessionManager.flush();
				return { intent, cancelled: false };
			case "restartProcess": {
				await resources.sessionManager.flush();
				const childManifest = await captureRestartChildManifest(
					resources.session,
					resources.ownership.ownerEpoch,
				);
				await writeRestartHandoff(resources.ownership, childManifest);
				return {
					intent,
					cancelled: false,
					restartSpawn: buildRestartSpawnSpec({
						sessionId: resources.session.sessionId,
						cwd: resources.sessionManager.getCwd(),
					}),
				};
			}
			case "newSession": {
				const parentSession = intent.parent === undefined ? undefined : await resolveSessionLocator(intent.parent);
				const switched = await resources.session.newSession(
					parentSession === undefined ? undefined : { parentSession },
				);
				return {
					intent:
						parentSession === undefined
							? intent
							: { kind: "newSession", parent: { kind: "path", path: parentSession } },
					cancelled: !switched,
				};
			}
			case "freshSession":
				return { intent, cancelled: resources.session.freshSession() === undefined };
			case "resume":
			case "switchSession": {
				const sessionPath = await resolveSessionLocator(intent.session);
				const switched = await resources.session.switchSession(sessionPath);
				return {
					intent: { kind: intent.kind, session: { kind: "path", path: sessionPath } },
					cancelled: !switched,
				};
			}
			case "fork":
			case "branch": {
				const result = await resources.session.branch(intent.entryId);
				return { intent, cancelled: result.cancelled, editorText: result.selectedText };
			}
			case "navigate": {
				const result = await resources.session.navigateTree(intent.targetId, { summarize: intent.summarize });
				return { intent, cancelled: result.cancelled, editorText: result.editorText };
			}
			case "moveSession":
				await resources.sessionManager.flush();
				await resources.sessionManager.moveTo(intent.newDir);
				return { intent, cancelled: false };
		}
	};

	prepareHostTransition = Effect.fn("Runner.prepareHostTransition")(function* (
		viewId: string,
		controllerEpoch: number,
		input: PrepareHostTransitionCommand,
	) {
		const command = yield* Effect.try({
			try: () => decodePrepareHostTransitionCommand(input),
			catch: asRunnerFailure,
		});
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		const admitted = yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const retained = hostTransitionCommands.get(command.commandId);
				if (retained !== undefined) {
					if (!sameHostTransitionCommand(retained.command, command)) {
						return yield* Effect.fail(
							new InvalidRunnerCommandError({
								issue: `Conflicting host transition command ${command.commandId}`,
							}),
						);
					}
					return { record: retained, replayed: true };
				}
				if (command.expectedSessionRevision !== sessionRevision) {
					return yield* Effect.fail(
						new SessionRevisionConflictError(command.expectedSessionRevision, sessionRevision),
					);
				}
				yield* requireSessionOperationAvailable();
				if (!reserveOperationCapacity(hostTransitionCommands)) {
					return yield* Effect.fail(new SessionStateCommandInFlightError());
				}
				const deferred = yield* Deferred.make<PrepareHostTransitionReceipt, RunnerFailure>();
				const record: LiveHostTransitionRecord = {
					command,
					operationGeneration: nextSessionOperationGeneration++,
					startedSessionRevision: sessionRevision,
					deferred,
					completed: false,
				};
				hostTransitionCommands.set(command.commandId, record);
				activeSessionOperation = { kind: "hostTransition", record };
				runSessionOperation(
					Effect.tryPromise({
						try: () => performHostTransition(command.intent),
						catch: asRunnerFailure,
					}).pipe(
						Effect.matchEffect({
							onFailure: failure =>
								enqueue(
									Effect.sync(() => {
										record.completed = true;
										if (activeSessionOperation?.record === record) activeSessionOperation = undefined;
										hostTransitionCommands.delete(command.commandId);
										return failure;
									}),
								).pipe(
									Effect.flatMap(retainedFailure => Deferred.fail(record.deferred, retainedFailure)),
									Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void }),
								),
							onSuccess: outcome =>
								enqueue(
									Effect.gen(function* () {
										record.completed = true;
										if (activeSessionOperation?.record === record) activeSessionOperation = undefined;
										refreshSessionProjection();
										const sessionFile = resources.session.sessionFile;
										const receipt: PrepareHostTransitionReceipt = {
											commandId: command.commandId,
											correlationId: command.correlationId,
											...(command.causationId === undefined ? {} : { causationId: command.causationId }),
											startedSessionRevision: record.startedSessionRevision,
											operationGeneration: record.operationGeneration,
											completedSessionRevision: sessionRevision,
											intent: outcome.intent,
											...(outcome.cancelled
												? {}
												: {
														target: {
															sessionId: resources.session.sessionId,
															...(sessionFile === undefined ? {} : { sessionFile }),
															cwd: resources.sessionManager.getCwd(),
															...(outcome.editorText === undefined ? {} : { editorText: outcome.editorText }),
														},
													}),
											...(outcome.restartSpawn === undefined ? {} : { restartSpawn: outcome.restartSpawn }),
											cancelled: outcome.cancelled,
											replayed: false,
										};
										yield* publishEvent({
											kind: "hostTransitionPrepared",
											metadata: command,
											controllerEpoch,
											viewId,
											targetCommandId: command.commandId,
											targetOperationGeneration: record.operationGeneration,
											sessionRevision,
										});
										yield* Deferred.succeed(record.deferred, receipt);
									}),
								).pipe(Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void })),
						}),
					),
				);
				return { record, replayed: false };
			}),
		);
		const receipt = yield* Deferred.await(admitted.record.deferred);
		return admitted.replayed ? { ...receipt, replayed: true } : receipt;
	});


	const sameCompactionCommand = (left: RunCompactionCommand, right: RunCompactionCommand): boolean =>
		left.schemaVersion === right.schemaVersion &&
		left.kind === right.kind &&
		left.commandId === right.commandId &&
		left.correlationId === right.correlationId &&
		left.causationId === right.causationId &&
		left.expectedSessionRevision === right.expectedSessionRevision &&
		left.viewId === right.viewId &&
		left.controllerEpoch === right.controllerEpoch &&
		left.customInstructions === right.customInstructions;

	runCompaction = Effect.fn("Runner.runCompaction")(function* (
		viewId: string,
		controllerEpoch: number,
		command: RunCompactionCommand,
	) {
		const decoded = yield* Effect.try({ try: () => decodeRunCompactionCommand(command), catch: asRunnerFailure });
		command = decoded;
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		const admitted = yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const retained = compactionCommands.get(command.commandId);
				if (retained) {
					if (!sameCompactionCommand(retained.command, command)) {
						return yield* Effect.fail(new RunnerCompactionCommandConflictError({ commandId: command.commandId }));
					}
					return { record: retained, replayed: true };
				}
				if (command.expectedSessionRevision !== sessionRevision) {
					return yield* Effect.fail(
						new SessionRevisionConflictError(command.expectedSessionRevision, sessionRevision),
					);
				}
				if (activeSessionOperation !== undefined) {
					return yield* Effect.fail(
						new RunnerCompactionUnavailableError({
							reason: activeSessionOperation.kind === "handoff" ? "handoff" : "compacting",
						}),
					);
				}
				const unavailableReason = resources.session.isStreaming
					? "streaming"
					: activeCompaction !== undefined || resources.session.isCompacting
						? "compacting"
						: resources.session.isRetrying
							? "retrying"
							: resources.session.isGeneratingHandoff
								? "handoff"
								: undefined;
				if (unavailableReason) {
					return yield* Effect.fail(new RunnerCompactionUnavailableError({ reason: unavailableReason }));
				}
				if (compactionCommands.size >= options.eventCapacity) {
					let evicted = false;
					for (const [commandId, record] of compactionCommands) {
						if (!record.completed) continue;
						compactionCommands.delete(commandId);
						evicted = true;
						break;
					}
					if (!evicted) {
						return yield* Effect.fail(new RunnerCompactionUnavailableError({ reason: "capacity" }));
					}
				}
				const deferred = yield* Deferred.make<RunCompactionReceipt, RunnerFailure>();
				const operationGeneration = nextCompactionOperationGeneration++;
				const record: LiveCompactionRecord = {
					command,
					operationGeneration,
					startedSessionRevision: sessionRevision,
					deferred,
					completed: false,
					cancellationRequested: false,
				};
				compactionCommands.set(command.commandId, record);
				activeCompaction = { commandId: command.commandId, operationGeneration };
				runCallback(
					Effect.tryPromise({
						try: () => resources.session.compact(command.customInstructions),
						catch: asRunnerFailure,
					}).pipe(
						Effect.matchEffect({
							onFailure: failure =>
								enqueue(
									Effect.sync(() => {
										record.completed = true;
										if (activeCompaction?.operationGeneration === record.operationGeneration)
											activeCompaction = undefined;
										return failure;
									}),
								).pipe(
									Effect.flatMap(retainedFailure => Deferred.fail(record.deferred, retainedFailure)),
									Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void }),
								),
							onSuccess: result =>
								enqueue(
									Effect.gen(function* () {
										sessionRevision = resources.sessionManager.getSessionRevision();
										record.completed = true;
										if (activeCompaction?.operationGeneration === record.operationGeneration)
											activeCompaction = undefined;
										const receipt: RunCompactionReceipt = {
											commandId: command.commandId,
											correlationId: command.correlationId,
											...(command.causationId === undefined ? {} : { causationId: command.causationId }),
											startedSessionRevision: record.startedSessionRevision,
											operationGeneration: record.operationGeneration,
											completedSessionRevision: sessionRevision,
											replayed: false,
											result: {
												summary: result.summary,
												...(result.shortSummary === undefined ? {} : { shortSummary: result.shortSummary }),
												firstKeptEntryId: result.firstKeptEntryId,
												tokensBefore: result.tokensBefore,
											},
										};
										yield* publishEvent({
											kind: "compactionCompleted",
											metadata: {
												schemaVersion: RUNNER_SCHEMA_VERSION,
												commandId: command.commandId,
												correlationId: command.correlationId,
												...(command.causationId === undefined ? {} : { causationId: command.causationId }),
												expectedRevision: revision,
											},
											controllerEpoch,
											viewId,
											sessionRevision,
										});
										yield* Deferred.succeed(record.deferred, receipt);
									}),
								).pipe(Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void })),
						}),
					),
				);
				return { record, replayed: false };
			}),
		);
		const receipt = yield* Deferred.await(admitted.record.deferred);
		return admitted.replayed ? { ...receipt, replayed: true } : receipt;
	});

	cancelCompaction = Effect.fn("Runner.cancelCompaction")(function* (
		viewId: string,
		controllerEpoch: number,
		command: CancelCompactionCommand,
	) {
		const decoded = yield* Effect.try({
			try: () => decodeCancelCompactionCommand(command),
			catch: asRunnerFailure,
		});
		if (decoded.viewId !== viewId) return yield* mismatchedView(viewId);
		if (decoded.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: decoded.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const active = activeCompaction;
				const record = active === undefined ? undefined : compactionCommands.get(active.commandId);
				if (
					active === undefined ||
					record === undefined ||
					record.completed ||
					active.commandId !== decoded.targetCommandId ||
					active.operationGeneration !== decoded.targetOperationGeneration
				) {
					return yield* Effect.fail(
						new RunnerCompactionTargetError({
							targetCommandId: decoded.targetCommandId,
							targetOperationGeneration: decoded.targetOperationGeneration,
							...(active === undefined
								? {}
								: {
										activeCommandId: active.commandId,
										activeOperationGeneration: active.operationGeneration,
									}),
						}),
					);
				}
				if (!record.cancellationRequested) {
					record.cancellationRequested = true;
					resources.session.abortCompaction();
					yield* publishEvent({
						kind: "compactionCancelRequested",
						metadata: decoded,
						controllerEpoch,
						viewId,
						targetCommandId: decoded.targetCommandId,
						targetOperationGeneration: decoded.targetOperationGeneration,
						sessionRevision,
					});
				}
				return {
					commandId: decoded.commandId,
					correlationId: decoded.correlationId,
					...(decoded.causationId === undefined ? {} : { causationId: decoded.causationId }),
					targetCommandId: decoded.targetCommandId,
					targetOperationGeneration: decoded.targetOperationGeneration,
					cancellationRequested: true,
				} satisfies CancelCompactionReceipt;
			}),
		);
	});

	const sameLocalOperationCommand = (left: RunLocalOperationCommand, right: RunLocalOperationCommand): boolean => {
		if (
			left.schemaVersion !== right.schemaVersion ||
			left.kind !== right.kind ||
			left.commandId !== right.commandId ||
			left.correlationId !== right.correlationId ||
			left.causationId !== right.causationId ||
			left.expectedSessionRevision !== right.expectedSessionRevision ||
			left.viewId !== right.viewId ||
			left.controllerEpoch !== right.controllerEpoch ||
			left.operation.kind !== right.operation.kind ||
			left.operation.excludeFromContext !== right.operation.excludeFromContext
		) {
			return false;
		}
		return left.operation.kind === "bash" && right.operation.kind === "bash"
			? left.operation.command === right.operation.command &&
					left.operation.useUserShell === right.operation.useUserShell
			: left.operation.kind === "python" &&
					right.operation.kind === "python" &&
					left.operation.code === right.operation.code;
	};

	const trimLocalOperationOutput = (record: LiveLocalOperationRecord | LiveEphemeralTurnRecord): void => {
		let excess = record.retainedBytes - localOperationOutputLimit;
		while (excess > 0 && record.outputHead < record.outputTail) {
			const head = record.outputChunks.get(record.outputHead)!;
			const available = head.length - record.outputHeadOffset;
			if (excess < available) {
				record.outputHeadOffset += excess;
				record.retainedBytes -= excess;
				while (record.outputHeadOffset < head.length && (head[record.outputHeadOffset]! & 0xc0) === 0x80) {
					record.outputHeadOffset++;
					record.retainedBytes--;
				}
				return;
			}
			record.outputChunks.delete(record.outputHead++);
			record.outputHeadOffset = 0;
			record.retainedBytes -= available;
			excess -= available;
		}
	};

	const appendLocalOperationOutput = (
		record: LiveLocalOperationRecord | LiveEphemeralTurnRecord,
		chunk: string,
	): void => {
		const bytes = Buffer.from(chunk);
		record.totalBytes += bytes.length;
		if (bytes.length === 0) return;
		record.outputChunks.set(record.outputTail++, bytes);
		record.retainedBytes += bytes.length;
		trimLocalOperationOutput(record);
	};

	const replaceLocalOperationOutput = (
		record: LiveLocalOperationRecord | LiveEphemeralTurnRecord,
		output: string,
		totalBytes: number,
	): void => {
		record.outputChunks.clear();
		record.outputHead = 0;
		record.outputTail = 0;
		record.outputHeadOffset = 0;
		record.retainedBytes = 0;
		record.totalBytes = totalBytes;
		const bytes = Buffer.from(output);
		if (bytes.length > 0) {
			record.outputChunks.set(record.outputTail++, bytes);
			record.retainedBytes = bytes.length;
			trimLocalOperationOutput(record);
		}
	};

	const materializeLocalOperationOutput = (record: LiveLocalOperationRecord | LiveEphemeralTurnRecord): string => {
		if (record.retainedBytes === 0) return "";
		const chunks: Buffer[] = [];
		for (let index = record.outputHead; index < record.outputTail; index++) {
			const chunk = record.outputChunks.get(index)!;
			chunks.push(index === record.outputHead ? chunk.subarray(record.outputHeadOffset) : chunk);
		}
		return Buffer.concat(chunks, record.retainedBytes).toString();
	};

	const localOperationOutputSnapshot = (record: LiveLocalOperationRecord | LiveEphemeralTurnRecord) => ({
		text: materializeLocalOperationOutput(record),
		totalBytes: record.totalBytes,
		truncated: record.totalBytes > record.retainedBytes,
	});

	runLocalOperation = Effect.fn("Runner.runLocalOperation")(function* (
		viewId: string,
		controllerEpoch: number,
		command: RunLocalOperationCommand,
	) {
		command = yield* Effect.try({
			try: () => decodeRunLocalOperationCommand(command),
			catch: asRunnerFailure,
		});
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		const admitted = yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const retained = localOperationCommands.get(command.commandId);
				if (retained) {
					if (!sameLocalOperationCommand(retained.command, command)) {
						return yield* Effect.fail(
							new RunnerLocalOperationCommandConflictError({ commandId: command.commandId }),
						);
					}
					return { record: retained, replayed: true };
				}
				if (command.expectedSessionRevision !== sessionRevision) {
					return yield* Effect.fail(
						new SessionRevisionConflictError(command.expectedSessionRevision, sessionRevision),
					);
				}
				if (activeLocalOperation !== undefined || activeSessionOperation !== undefined) {
					return yield* Effect.fail(new RunnerLocalOperationUnavailableError({ reason: "active" }));
				}
				if (localOperationCommands.size >= options.eventCapacity) {
					let evicted = false;
					for (const [commandId, record] of localOperationCommands) {
						if (!record.completed) continue;
						localOperationCommands.delete(commandId);
						evicted = true;
						break;
					}
					if (!evicted) {
						return yield* Effect.fail(new RunnerLocalOperationUnavailableError({ reason: "capacity" }));
					}
				}
				const deferred = yield* Deferred.make<RunLocalOperationReceipt, RunnerFailure>();
				const outputDrained = yield* Deferred.make<void>();
				const record: LiveLocalOperationRecord = {
					command,
					operationGeneration: nextLocalOperationGeneration++,
					startedSessionRevision: sessionRevision,
					deferred,
					outputChunks: new Map(),
					outputHead: 0,
					outputTail: 0,
					outputHeadOffset: 0,
					retainedBytes: 0,
					totalBytes: 0,
					completed: false,
					cancellationRequested: false,
					pendingOutputChunks: [],
					pendingOutputBytes: 0,
					peakPendingOutputChunks: 0,
					peakPendingOutputBytes: 0,
					outputPumpRunning: false,
					outputClosed: false,
					outputDrained,
				};
				localOperationCommands.set(command.commandId, record);
				activeLocalOperation = record;
				const runOutputPump = (): void => {
					if (record.outputPumpRunning) return;
					record.outputPumpRunning = true;
					runCallback(
						Effect.gen(function* () {
							while (record.pendingOutputChunks.length > 0) {
								yield* enqueue(
									Effect.gen(function* () {
										const pending = record.pendingOutputChunks.splice(0, 32);
										for (const delivery of pending) {
											record.pendingOutputBytes -= delivery.bytes;
											if (record.completed) continue;
											yield* publishEvent({
												kind: "localOperationOutput",
												metadata: command,
												controllerEpoch,
												viewId,
												targetCommandId: command.commandId,
												targetOperationGeneration: record.operationGeneration,
												sessionRevision,
												localOperationOutput: {
													chunk: delivery.chunk,
													totalBytes: delivery.totalBytes,
													truncated: delivery.truncated,
													reset: delivery.reset,
												},
											});
										}
									}),
								);
								yield* Effect.yieldNow;
							}
							record.outputPumpRunning = false;
							if (record.outputClosed) yield* Deferred.succeed(record.outputDrained, undefined);
						}).pipe(Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void })),
					);
				};
				const onChunk = (chunk: string): void => {
					if (record.outputClosed) return;
					appendLocalOperationOutput(record, chunk);
					const bytes = Buffer.byteLength(chunk);
					const tail = record.pendingOutputChunks.at(-1);
					if (
						tail?.reset === true ||
						record.pendingOutputChunks.length >= 32 ||
						record.pendingOutputBytes + bytes > localOperationOutputLimit
					) {
						record.pendingOutputChunks.length = 0;
						record.pendingOutputBytes = 0;
						const resetChunk = materializeLocalOperationOutput(record);
						const resetBytes = Buffer.byteLength(resetChunk);
						record.pendingOutputChunks.push({
							chunk: resetChunk,
							bytes: resetBytes,
							reset: true,
							totalBytes: record.totalBytes,
							truncated: record.totalBytes > record.retainedBytes,
						});
						record.pendingOutputBytes = resetBytes;
					} else {
						record.pendingOutputChunks.push({
							chunk,
							bytes,
							reset: false,
							totalBytes: record.totalBytes,
							truncated: record.totalBytes > record.retainedBytes,
						});
						record.pendingOutputBytes += bytes;
					}
					record.peakPendingOutputChunks = Math.max(
						record.peakPendingOutputChunks,
						record.pendingOutputChunks.length,
					);
					record.peakPendingOutputBytes = Math.max(record.peakPendingOutputBytes, record.pendingOutputBytes);
					runOutputPump();
				};
				const operation = command.operation;
				const operationEffect: Effect.Effect<LocalOperationExecutionResult, RunnerFailure> =
					operation.kind === "bash"
						? Effect.tryPromise({
								try: () =>
									resources.session.executeBash(operation.command, onChunk, {
										excludeFromContext: operation.excludeFromContext,
										useUserShell: true,
									}),
								catch: asRunnerFailure,
							}).pipe(Effect.map((result): LocalOperationExecutionResult => ({ kind: "bash", result })))
						: Effect.tryPromise({
								try: () =>
									resources.session.executePython(operation.code, onChunk, {
										excludeFromContext: operation.excludeFromContext,
									}),
								catch: asRunnerFailure,
							}).pipe(Effect.map((result): LocalOperationExecutionResult => ({ kind: "python", result })));
				const closeOutput = Effect.sync(() => {
					record.outputClosed = true;
					if (record.outputPumpRunning) return;
					if (record.pendingOutputChunks.length > 0) runOutputPump();
					else runCallback(Deferred.succeed(record.outputDrained, undefined));
				});
				runCallback(
					operationEffect.pipe(
						Effect.matchEffect({
							onFailure: failure =>
								closeOutput.pipe(
									Effect.andThen(Deferred.await(record.outputDrained)),
									Effect.andThen(
										enqueue(
											Effect.sync(() => {
												record.completed = true;
												if (activeLocalOperation?.operationGeneration === record.operationGeneration) {
													activeLocalOperation = undefined;
												}
												return failure;
											}),
										),
									),
									Effect.flatMap(retainedFailure => Deferred.fail(record.deferred, retainedFailure)),
									Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void }),
								),
							onSuccess: result =>
								closeOutput.pipe(
									Effect.andThen(Deferred.await(record.outputDrained)),
									Effect.andThen(
										enqueue(
											Effect.gen(function* () {
												replaceLocalOperationOutput(record, result.result.output, result.result.totalBytes);
												sessionRevision = resources.sessionManager.getSessionRevision();
												record.completed = true;
												if (activeLocalOperation?.operationGeneration === record.operationGeneration) {
													activeLocalOperation = undefined;
												}
												const output = {
													...localOperationOutputSnapshot(record),
													truncated: result.result.truncated || record.totalBytes > record.retainedBytes,
												};
												const resultSummary: RunLocalOperationReceipt["result"] =
													result.kind === "bash"
														? {
																kind: "bash",
																output,
																exitCode: result.result.exitCode,
																cancelled: result.result.cancelled,
																...(result.result.artifactId === undefined
																	? {}
																	: { artifactId: result.result.artifactId }),
															}
														: {
																kind: "python",
																output,
																exitCode: result.result.exitCode,
																cancelled: result.result.cancelled,
																...(result.result.artifactId === undefined
																	? {}
																	: { artifactId: result.result.artifactId }),
																totalLines: result.result.totalLines,
																outputLines: result.result.outputLines,
																outputBytes: result.result.outputBytes,
																displayOutputs: result.result.displayOutputs,
																stdinRequested: result.result.stdinRequested,
															};
												const receipt: RunLocalOperationReceipt = {
													commandId: command.commandId,
													correlationId: command.correlationId,
													...(command.causationId === undefined
														? {}
														: { causationId: command.causationId }),
													startedSessionRevision: record.startedSessionRevision,
													operationGeneration: record.operationGeneration,
													completedSessionRevision: sessionRevision,
													replayed: false,
													result: resultSummary,
												};
												yield* publishEvent({
													kind: "localOperationCompleted",
													metadata: command,
													controllerEpoch,
													viewId,
													targetCommandId: command.commandId,
													targetOperationGeneration: record.operationGeneration,
													sessionRevision,
												});
												yield* Deferred.succeed(record.deferred, receipt);
											}),
										),
									),
									Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void }),
								),
						}),
					),
				);
				return { record, replayed: false };
			}),
		);
		const receipt = yield* Deferred.await(admitted.record.deferred);
		return admitted.replayed ? { ...receipt, replayed: true } : receipt;
	});

	cancelLocalOperation = Effect.fn("Runner.cancelLocalOperation")(function* (
		viewId: string,
		controllerEpoch: number,
		command: CancelLocalOperationCommand,
	) {
		command = yield* Effect.try({
			try: () => decodeCancelLocalOperationCommand(command),
			catch: asRunnerFailure,
		});
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				if (command.expectedSessionRevision !== sessionRevision) {
					return yield* Effect.fail(
						new SessionRevisionConflictError(command.expectedSessionRevision, sessionRevision),
					);
				}
				const record = activeLocalOperation;
				if (
					record === undefined ||
					record.completed ||
					record.command.commandId !== command.targetCommandId ||
					record.operationGeneration !== command.targetOperationGeneration
				) {
					return yield* Effect.fail(
						new RunnerLocalOperationTargetError({
							targetCommandId: command.targetCommandId,
							targetOperationGeneration: command.targetOperationGeneration,
						}),
					);
				}
				if (!record.cancellationRequested) {
					record.cancellationRequested = true;
					if (record.command.operation.kind === "bash") {
						resources.session.abortBash();
					} else {
						resources.session.abortEval();
					}
					yield* publishEvent({
						kind: "localOperationCancelRequested",
						metadata: command,
						controllerEpoch,
						viewId,
						targetCommandId: command.targetCommandId,
						targetOperationGeneration: command.targetOperationGeneration,
						sessionRevision,
					});
				}
				return {
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					targetCommandId: command.targetCommandId,
					targetOperationGeneration: command.targetOperationGeneration,
					cancellationRequested: true,
				} satisfies CancelLocalOperationReceipt;
			}),
		);
	});

	const sameEphemeralTurnCommand = (left: RunEphemeralTurnCommand, right: RunEphemeralTurnCommand): boolean =>
		left.schemaVersion === right.schemaVersion &&
		left.kind === right.kind &&
		left.commandId === right.commandId &&
		left.correlationId === right.correlationId &&
		left.causationId === right.causationId &&
		left.expectedSessionRevision === right.expectedSessionRevision &&
		left.viewId === right.viewId &&
		left.controllerEpoch === right.controllerEpoch &&
		left.prompt === right.prompt;

	runEphemeralTurn = Effect.fn("Runner.runEphemeralTurn")(function* (
		viewId: string,
		controllerEpoch: number,
		command: RunEphemeralTurnCommand,
	) {
		command = yield* Effect.try({ try: () => decodeRunEphemeralTurnCommand(command), catch: asRunnerFailure });
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		const admitted = yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const retained = ephemeralTurnCommands.get(command.commandId);
				if (retained) {
					if (!sameEphemeralTurnCommand(retained.command, command)) {
						return yield* Effect.fail(
							new RunnerEphemeralTurnCommandConflictError({ commandId: command.commandId }),
						);
					}
					return { record: retained, replayed: true };
				}
				if (command.expectedSessionRevision !== sessionRevision) {
					return yield* Effect.fail(
						new SessionRevisionConflictError(command.expectedSessionRevision, sessionRevision),
					);
				}
				if (activeEphemeralTurn !== undefined || activeSessionOperation !== undefined) {
					return yield* Effect.fail(new RunnerEphemeralTurnUnavailableError({ reason: "active" }));
				}
				if (ephemeralTurnCommands.size >= options.eventCapacity) {
					let evicted = false;
					for (const [commandId, record] of ephemeralTurnCommands) {
						if (!record.completed) continue;
						ephemeralTurnCommands.delete(commandId);
						evicted = true;
						break;
					}
					if (!evicted) return yield* Effect.fail(new RunnerEphemeralTurnUnavailableError({ reason: "capacity" }));
				}
				const deferred = yield* Deferred.make<RunEphemeralTurnReceipt, RunnerFailure>();
				const outputDrained = yield* Deferred.make<void>();
				const record: LiveEphemeralTurnRecord = {
					command,
					operationGeneration: nextEphemeralTurnGeneration++,
					startedSessionRevision: sessionRevision,
					deferred,
					abortController: new AbortController(),
					outputChunks: new Map(),
					outputHead: 0,
					outputTail: 0,
					outputHeadOffset: 0,
					retainedBytes: 0,
					totalBytes: 0,
					completed: false,
					cancellationRequested: false,
					pendingOutputChunks: [],
					pendingOutputBytes: 0,
					peakPendingOutputChunks: 0,
					peakPendingOutputBytes: 0,
					outputPumpRunning: false,
					outputClosed: false,
					outputDrained,
				};
				ephemeralTurnCommands.set(command.commandId, record);
				activeEphemeralTurn = record;
				const runOutputPump = (): void => {
					if (record.outputPumpRunning) return;
					record.outputPumpRunning = true;
					runCallback(
						Effect.gen(function* () {
							while (record.pendingOutputChunks.length > 0) {
								yield* enqueue(
									Effect.gen(function* () {
										const pending = record.pendingOutputChunks.splice(0, 32);
										for (const delivery of pending) {
											record.pendingOutputBytes -= delivery.bytes;
											if (record.completed) continue;
											yield* publishEvent({
												kind: "ephemeralTurnOutput",
												metadata: command,
												controllerEpoch,
												viewId,
												targetCommandId: command.commandId,
												targetOperationGeneration: record.operationGeneration,
												sessionRevision,
												ephemeralTurnOutput: {
													chunk: delivery.chunk,
													totalBytes: delivery.totalBytes,
													truncated: delivery.truncated,
													reset: delivery.reset,
												},
											});
										}
									}),
								);
								yield* Effect.yieldNow;
							}
							record.outputPumpRunning = false;
							if (record.outputClosed) yield* Deferred.succeed(record.outputDrained, undefined);
						}).pipe(Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void })),
					);
				};
				const onChunk = (chunk: string): void => {
					if (record.outputClosed) return;
					appendLocalOperationOutput(record, chunk);
					const bytes = Buffer.byteLength(chunk);
					const tail = record.pendingOutputChunks.at(-1);
					if (
						tail?.reset === true ||
						record.pendingOutputChunks.length >= 32 ||
						record.pendingOutputBytes + bytes > localOperationOutputLimit
					) {
						record.pendingOutputChunks.length = 0;
						record.pendingOutputBytes = 0;
						const resetChunk = materializeLocalOperationOutput(record);
						const resetBytes = Buffer.byteLength(resetChunk);
						record.pendingOutputChunks.push({
							chunk: resetChunk,
							bytes: resetBytes,
							reset: true,
							totalBytes: record.totalBytes,
							truncated: record.totalBytes > record.retainedBytes,
						});
						record.pendingOutputBytes = resetBytes;
					} else {
						record.pendingOutputChunks.push({
							chunk,
							bytes,
							reset: false,
							totalBytes: record.totalBytes,
							truncated: record.totalBytes > record.retainedBytes,
						});
						record.pendingOutputBytes += bytes;
					}
					record.peakPendingOutputChunks = Math.max(
						record.peakPendingOutputChunks,
						record.pendingOutputChunks.length,
					);
					record.peakPendingOutputBytes = Math.max(record.peakPendingOutputBytes, record.pendingOutputBytes);
					runOutputPump();
				};
				const closeOutput = Effect.sync(() => {
					record.outputClosed = true;
					if (record.outputPumpRunning) return;
					if (record.pendingOutputChunks.length > 0) runOutputPump();
					else runCallback(Deferred.succeed(record.outputDrained, undefined));
				});
				runCallback(
					Effect.tryPromise({
						try: () =>
							resources.session.runEphemeralTurn({
								promptText: command.prompt,
								onTextDelta: onChunk,
								signal: record.abortController.signal,
							}),
						catch: asRunnerFailure,
					}).pipe(
						Effect.matchEffect({
							onFailure: failure =>
								closeOutput.pipe(
									Effect.andThen(Deferred.await(record.outputDrained)),
									Effect.andThen(
										enqueue(
											Effect.sync(() => {
												record.completed = true;
												if (activeEphemeralTurn?.operationGeneration === record.operationGeneration)
													activeEphemeralTurn = undefined;
												return failure;
											}),
										),
									),
									Effect.flatMap(retainedFailure => Deferred.fail(record.deferred, retainedFailure)),
									Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void }),
								),
							onSuccess: result =>
								closeOutput.pipe(
									Effect.andThen(Deferred.await(record.outputDrained)),
									Effect.andThen(
										enqueue(
											Effect.gen(function* () {
												replaceLocalOperationOutput(
													record,
													result.replyText,
													Buffer.byteLength(result.replyText),
												);
												record.completed = true;
												if (activeEphemeralTurn?.operationGeneration === record.operationGeneration)
													activeEphemeralTurn = undefined;
												const receipt: RunEphemeralTurnReceipt = {
													commandId: command.commandId,
													correlationId: command.correlationId,
													...(command.causationId === undefined
														? {}
														: { causationId: command.causationId }),
													startedSessionRevision: record.startedSessionRevision,
													operationGeneration: record.operationGeneration,
													completedSessionRevision: sessionRevision,
													replayed: false,
													output: localOperationOutputSnapshot(record),
												};
												yield* publishEvent({
													kind: "ephemeralTurnOutput",
													metadata: command,
													controllerEpoch,
													viewId,
													targetCommandId: command.commandId,
													targetOperationGeneration: record.operationGeneration,
													sessionRevision,
													ephemeralTurnOutput: {
														chunk: receipt.output.text,
														totalBytes: receipt.output.totalBytes,
														truncated: receipt.output.truncated,
														reset: true,
													},
												});
												yield* publishEvent({
													kind: "ephemeralTurnCompleted",
													metadata: command,
													controllerEpoch,
													viewId,
													targetCommandId: command.commandId,
													targetOperationGeneration: record.operationGeneration,
													sessionRevision,
												});
												yield* Deferred.succeed(record.deferred, receipt);
											}),
										),
									),
									Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void }),
								),
						}),
					),
				);
				return { record, replayed: false };
			}),
		);
		const receipt = yield* Deferred.await(admitted.record.deferred);
		return admitted.replayed ? { ...receipt, replayed: true } : receipt;
	});

	cancelEphemeralTurn = Effect.fn("Runner.cancelEphemeralTurn")(function* (
		viewId: string,
		controllerEpoch: number,
		command: CancelEphemeralTurnCommand,
	) {
		command = yield* Effect.try({ try: () => decodeCancelEphemeralTurnCommand(command), catch: asRunnerFailure });
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				if (command.expectedSessionRevision !== sessionRevision) {
					return yield* Effect.fail(
						new SessionRevisionConflictError(command.expectedSessionRevision, sessionRevision),
					);
				}
				const record = activeEphemeralTurn;
				if (
					record === undefined ||
					record.completed ||
					record.command.commandId !== command.targetCommandId ||
					record.operationGeneration !== command.targetOperationGeneration
				) {
					return yield* Effect.fail(
						new RunnerEphemeralTurnTargetError({
							targetCommandId: command.targetCommandId,
							targetOperationGeneration: command.targetOperationGeneration,
						}),
					);
				}
				if (!record.cancellationRequested) {
					record.cancellationRequested = true;
					record.abortController.abort();
					yield* publishEvent({
						kind: "ephemeralTurnCancelRequested",
						metadata: command,
						controllerEpoch,
						viewId,
						targetCommandId: command.targetCommandId,
						targetOperationGeneration: command.targetOperationGeneration,
						sessionRevision,
					});
				}
				return {
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					targetCommandId: command.targetCommandId,
					targetOperationGeneration: command.targetOperationGeneration,
					cancellationRequested: true,
				} satisfies CancelEphemeralTurnReceipt;
			}),
		);
	});

	interruptPrompt = Effect.fn("Runner.interruptPrompt")(function* (
		viewId: string,
		controllerEpoch: number,
		command: InterruptPromptCommand,
	) {
		const decoded = yield* Effect.try({ try: () => decodeInterruptPromptCommand(command), catch: asRunnerFailure });
		if (decoded.viewId !== viewId) return yield* mismatchedView(viewId);
		if (decoded.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: decoded.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				yield* Effect.tryPromise({
					try: () => resources.session.interruptPrompt(decoded.targetGeneration),
					catch: asRunnerFailure,
				});
				yield* publishEvent({
					kind: "promptInterrupted",
					metadata: decoded,
					controllerEpoch,
					viewId,
					targetGeneration: decoded.targetGeneration,
				});
				return {
					commandId: decoded.commandId,
					correlationId: decoded.correlationId,
					...(decoded.causationId === undefined ? {} : { causationId: decoded.causationId }),
					targetGeneration: decoded.targetGeneration,
					interrupted: true,
				} satisfies InterruptPromptReceipt;
			}),
		);
	});

	replaceTodos = Effect.fn("Runner.replaceTodos")(function* (
		viewId: string,
		controllerEpoch: number,
		input: ReplaceTodosCommand,
	) {
		const command = yield* Effect.try({ try: () => decodeReplaceTodosCommand(input), catch: asRunnerFailure });
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const result = yield* Effect.tryPromise({
					try: () =>
						resources.session.configureTodoPhases(
							command.expectedTodoGeneration,
							command.phases.map(phase => ({
								name: phase.name,
								tasks: phase.tasks.map(task => ({ content: task.content, status: task.status })),
							})),
						),
					catch: asRunnerFailure,
				});
				if (result.kind === "conflict") {
					return yield* Effect.fail(
						new RunnerTodoConflictError({
							expectedGeneration: command.expectedTodoGeneration,
							actualGeneration: result.actualGeneration,
						}),
					);
				}
				yield* publishEvent({ kind: "todosReplaced", metadata: command, controllerEpoch, viewId });
				return {
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					todoGeneration: result.todoGeneration,
					phases: result.phases,
				} satisfies ReplaceTodosReceipt;
			}),
		);
	});

	refreshSshTool = Effect.fn("Runner.refreshSshTool")(function* (
		viewId: string,
		controllerEpoch: number,
		input: RefreshSshToolCommand,
	) {
		const command = yield* Effect.try({ try: () => decodeRefreshSshToolCommand(input), catch: asRunnerFailure });
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const result = yield* Effect.tryPromise({
					try: () =>
						resources.session.refreshSshToolConfiguration(
							command.expectedToolConfigurationGeneration,
							command.activateIfAvailable,
						),
					catch: asRunnerFailure,
				});
				if (result.kind === "conflict") {
					return yield* Effect.fail(
						new RunnerToolConfigurationConflictError({
							expectedGeneration: command.expectedToolConfigurationGeneration,
							actualGeneration: result.actualGeneration,
						}),
					);
				}
				if (result.kind === "unavailable") {
					return yield* Effect.fail(new RunnerSshToolUnavailableError({ reason: result.reason }));
				}
				yield* publishEvent({ kind: "sshToolRefreshed", metadata: command, controllerEpoch, viewId });
				return {
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					toolConfigurationGeneration: result.toolConfigurationGeneration,
					activeToolNames: result.activeToolNames,
				} satisfies RefreshSshToolReceipt;
			}),
		);
	});

	setActiveTools = Effect.fn("Runner.setActiveTools")(function* (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) {
		const command = yield* Effect.try({ try: () => decodeSetActiveToolsCommand(input), catch: asRunnerFailure });
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const available = new Set(resources.session.getAllToolNames());
				for (const name of command.toolNames) {
					if (!available.has(name)) {
						return yield* Effect.fail(new InvalidRunnerCommandError({ issue: `Tool "${name}" is unavailable` }));
					}
				}
				const result = yield* Effect.tryPromise({
					try: () =>
						resources.session.configureActiveTools(
							command.expectedToolConfigurationGeneration,
							command.toolNames,
						),
					catch: asRunnerFailure,
				});
				if (result.kind === "conflict") {
					return yield* Effect.fail(
						new RunnerToolConfigurationConflictError({
							expectedGeneration: command.expectedToolConfigurationGeneration,
							actualGeneration: result.actualGeneration,
						}),
					);
				}
				yield* publishEvent({
					kind: "toolsChanged",
					metadata: command,
					controllerEpoch,
					viewId,
				});
				return {
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					toolConfigurationGeneration: result.toolConfigurationGeneration,
					activeToolNames: result.activeToolNames,
				} satisfies SetActiveToolsReceipt;
			}),
		);
	});

	const sameCycleModelCommand = (left: CycleModelCommand, right: CycleModelCommand): boolean =>
		left.schemaVersion === right.schemaVersion &&
		left.kind === right.kind &&
		left.commandId === right.commandId &&
		left.correlationId === right.correlationId &&
		left.causationId === right.causationId &&
		left.expectedSessionRevision === right.expectedSessionRevision &&
		left.viewId === right.viewId &&
		left.controllerEpoch === right.controllerEpoch &&
		left.direction === right.direction;

	const cycleModel = Effect.fn("Runner.cycleModel")(function* (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) {
		const command = yield* Effect.try({ try: () => decodeCycleModelCommand(input), catch: asRunnerFailure });
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const retained = cycleModelCommands.get(command.commandId);
				if (retained) {
					if (!sameCycleModelCommand(retained.command, command)) {
						return yield* Effect.fail(
							new InvalidRunnerCommandError({ issue: `Conflicting cycle-model command ${command.commandId}` }),
						);
					}
					return { ...retained.receipt, replayed: true };
				}
				if (command.expectedSessionRevision !== sessionRevision) {
					return yield* Effect.fail(
						new SessionRevisionConflictError(command.expectedSessionRevision, sessionRevision),
					);
				}
				const result = yield* Effect.tryPromise({
					try: () => resources.session.cycleModel(command.direction),
					catch: asRunnerFailure,
				});
				sessionRevision = Math.max(sessionRevision, resources.sessionManager.getSessionRevision());
				const receipt: CycleModelReceipt = {
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					sessionRevision,
					replayed: false,
					result:
						result === undefined
							? undefined
							: {
									provider: result.model.provider,
									id: result.model.id,
									thinkingLevel: result.thinkingLevel,
									isScoped: result.isScoped,
								},
				};
				if (cycleModelCommands.size >= options.eventCapacity) {
					const oldest = cycleModelCommands.keys().next().value;
					if (oldest !== undefined) cycleModelCommands.delete(oldest);
				}
				cycleModelCommands.set(command.commandId, { command, receipt });
				if (result !== undefined) {
					yield* publishEvent({
						kind: "modelChanged",
						metadata: command,
						controllerEpoch,
						viewId,
						sessionRevision,
					});
				}
				return receipt;
			}),
		);
	});

	setModel = Effect.fn("Runner.setModel")(function* (viewId: string, controllerEpoch: number, input: unknown) {
		const command = yield* Effect.try({ try: () => decodeSetModelCommand(input), catch: asRunnerFailure });
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const journalCommand: SetModelSessionCommand = {
					schemaVersion: 1,
					kind: "setModel",
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					expectedSessionRevision: command.expectedSessionRevision,
					model: `${command.payload.provider}/${command.payload.id}`,
					role: command.payload.role ?? "default",
				};
				const durable = yield* Effect.tryPromise({
					try: () => resources.session.commitJournaledModel(journalCommand),
					catch: stateCommandFailure,
				});
				sessionRevision = Math.max(sessionRevision, durable.sessionRevision);
				if (!durable.replayed) {
					yield* publishEvent({
						kind: "modelChanged",
						metadata: {
							schemaVersion: RUNNER_SCHEMA_VERSION,
							commandId: command.commandId,
							correlationId: command.correlationId,
							...(command.causationId === undefined ? {} : { causationId: command.causationId }),
							expectedRevision: revision,
						},
						controllerEpoch,
						viewId,
						sessionRevision,
					});
				}
				return {
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					sessionRevision: durable.sessionRevision,
					replayed: durable.replayed,
				} satisfies SetModelReceipt;
			}),
		);
	});

	setThinkingLevel = Effect.fn("Runner.setThinkingLevel")(function* (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) {
		const command = yield* Effect.try({
			try: () => decodeSetThinkingLevelCommand(input),
			catch: asRunnerFailure,
		});
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const journalCommand: SetThinkingSessionCommand = {
					schemaVersion: 1,
					kind: "setThinkingLevel",
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					expectedSessionRevision: command.expectedSessionRevision,
					thinkingLevel: command.thinkingLevel ?? null,
				};
				const durable = yield* Effect.tryPromise({
					try: () => resources.session.commitJournaledThinkingLevel(journalCommand),
					catch: stateCommandFailure,
				});
				sessionRevision = Math.max(sessionRevision, durable.sessionRevision);
				if (!durable.replayed) {
					yield* publishEvent({
						kind: "thinkingLevelChanged",
						metadata: {
							schemaVersion: RUNNER_SCHEMA_VERSION,
							commandId: command.commandId,
							correlationId: command.correlationId,
							...(command.causationId === undefined ? {} : { causationId: command.causationId }),
							expectedRevision: revision,
						},
						controllerEpoch,
						viewId,
						sessionRevision,
					});
				}
				return {
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					sessionRevision: durable.sessionRevision,
					replayed: durable.replayed,
				} satisfies SetThinkingLevelReceipt;
			}),
		);
	});

	transitionPlanMode = Effect.fn("Runner.transitionPlanMode")(function* (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) {
		const command = yield* Effect.try({
			try: () => decodeTransitionPlanModeCommand(input),
			catch: asRunnerFailure,
		});
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const journalCommand: TransitionPlanModeSessionCommand = {
					schemaVersion: 1,
					kind: "transitionPlanMode",
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					expectedSessionRevision: command.expectedSessionRevision,
					transition: command.transition,
				};
				const durable = yield* Effect.tryPromise({
					try: () => resources.session.commitPlanWorkflowTransition(journalCommand),
					catch: stateCommandFailure,
				});
				sessionRevision = Math.max(sessionRevision, durable.sessionRevision);
				if (!durable.replayed) {
					yield* publishEvent({
						kind: "planModeChanged",
						metadata: {
							schemaVersion: RUNNER_SCHEMA_VERSION,
							commandId: command.commandId,
							correlationId: command.correlationId,
							...(command.causationId === undefined ? {} : { causationId: command.causationId }),
							expectedRevision: revision,
						},
						controllerEpoch,
						viewId,
						sessionRevision,
					});
				}
				return {
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					sessionRevision: durable.sessionRevision,
					replayed: durable.replayed,
				} satisfies TransitionPlanModeReceipt;
			}),
		);
	});

	transitionGoalMode = Effect.fn("Runner.transitionGoalMode")(function* (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) {
		const command = yield* Effect.try({
			try: () => decodeTransitionGoalModeCommand(input),
			catch: asRunnerFailure,
		});
		if (command.viewId !== viewId) return yield* mismatchedView(viewId);
		if (command.controllerEpoch !== controllerEpoch) {
			return yield* Effect.fail(
				new StaleRunnerControllerLeaseError({
					viewId,
					expectedControllerEpoch: command.controllerEpoch,
					actualControllerEpoch: controllerEpoch,
				}),
			);
		}
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(viewId, controllerEpoch);
				const journalCommand: TransitionGoalModeSessionCommand = {
					schemaVersion: 1,
					kind: "transitionGoalMode",
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					expectedSessionRevision: command.expectedSessionRevision,
					transition: command.transition,
				};
				const durable = yield* Effect.tryPromise({
					try: () => resources.session.commitGoalWorkflowTransition(journalCommand),
					catch: stateCommandFailure,
				});
				sessionRevision = resources.sessionManager.getSessionRevision();
				const workflowEntry = durable.entry;
				if (workflowEntry.type !== "workflow_change") {
					return yield* Effect.fail(
						new SessionRunnerRuntimeError({ issue: "Goal workflow command committed an invalid entry" }),
					);
				}
				if (!durable.replayed) {
					yield* publishEvent({
						kind: "goalModeChanged",
						metadata: {
							schemaVersion: RUNNER_SCHEMA_VERSION,
							commandId: command.commandId,
							correlationId: command.correlationId,
							...(command.causationId === undefined ? {} : { causationId: command.causationId }),
							expectedRevision: revision,
						},
						controllerEpoch,
						viewId,
						sessionRevision,
					});
				}
				return {
					commandId: command.commandId,
					correlationId: command.correlationId,
					...(command.causationId === undefined ? {} : { causationId: command.causationId }),
					workflow: workflowEntry.next,
					sessionRevision,
					replayed: durable.replayed,
				} satisfies TransitionGoalModeReceipt;
			}),
		);
	});

	acquireController = Effect.fn("Runner.acquireController")(function* (command: AcquireRunnerControllerCommand) {
		yield* Effect.try({ try: () => validateMetadata(command), catch: asRunnerFailure });
		const epoch = yield* enqueue(
			Effect.gen(function* () {
				yield* requireRevision(command.expectedRevision);
				const view = yield* requireView(command.viewId);
				if (activeController) {
					return yield* Effect.fail(
						new RunnerControllerConflictError({
							requestedViewId: command.viewId,
							activeViewId: activeController.viewId,
							controllerEpoch: activeController.epoch,
						}),
					);
				}
				const acquiredEpoch = nextControllerEpoch++;
				view.capability = "controller";
				view.controllerEpoch = acquiredEpoch;
				activeController = { viewId: command.viewId, epoch: acquiredEpoch };
				yield* publishEvent({
					kind: "controllerAcquired",
					metadata: command,
					controllerEpoch: acquiredEpoch,
					viewId: command.viewId,
				});
				return acquiredEpoch;
			}),
		);
		return controllerView(command.viewId, epoch);
	});

	releaseController = Effect.fn("Runner.releaseController")(function* (command: ReleaseRunnerControllerCommand) {
		yield* Effect.try({ try: () => validateMetadata(command), catch: asRunnerFailure });
		yield* enqueue(
			Effect.gen(function* () {
				yield* requireController(command.viewId, command.controllerEpoch);
				yield* requireRevision(command.expectedRevision);
				const view = yield* requireView(command.viewId);
				view.capability = "observer";
				view.controllerEpoch = undefined;
				activeController = undefined;
				yield* publishEvent({
					kind: "controllerReleased",
					metadata: command,
					controllerEpoch: command.controllerEpoch,
					viewId: command.viewId,
				});
			}),
		);
		return observerView(command.viewId);
	});

	detachView = Effect.fn("Runner.detachView")(function* (command: DetachRunnerViewCommand) {
		yield* Effect.try({ try: () => validateMetadata(command), catch: asRunnerFailure });
		yield* enqueue(
			Effect.gen(function* () {
				const view = yield* requireView(command.viewId);
				yield* requireRevision(command.expectedRevision);
				const detachedEpoch = view.controllerEpoch ?? activeController?.epoch ?? nextControllerEpoch - 1;
				if (view.capability === "controller") {
					if (command.controllerEpoch === undefined) {
						return yield* Effect.fail(
							new StaleRunnerControllerLeaseError({
								viewId: command.viewId,
								expectedControllerEpoch: 0,
								actualControllerEpoch: view.controllerEpoch,
							}),
						);
					}
					yield* requireController(command.viewId, command.controllerEpoch);
					activeController = undefined;
				}
				views.delete(command.viewId);
				yield* publishEvent({
					kind: "viewDetached",
					metadata: command,
					controllerEpoch: detachedEpoch,
					viewId: command.viewId,
				});
			}),
		);
	});

	const attachView = Effect.fn("Runner.attachView")(function* (command: AttachRunnerViewCommand) {
		yield* Effect.try({ try: () => validateMetadata(command), catch: asRunnerFailure });
		if (command.capability !== "observer" && command.capability !== "controller") {
			return yield* Effect.fail(new InvalidRunnerCommandError({ issue: "Invalid view capability" }));
		}
		const attached = yield* enqueue(
			Effect.gen(function* () {
				yield* requireRevision(command.expectedRevision);
				if (views.has(command.viewId)) {
					return yield* Effect.fail(new RunnerViewAlreadyAttachedError({ viewId: command.viewId }));
				}
				if (command.capability === "controller" && activeController) {
					const displaced = views.get(activeController.viewId);
					if (displaced) views.set(activeController.viewId, { ...displaced, capability: "observer", controllerEpoch: undefined });
				}
				const epoch = command.capability === "controller" ? nextControllerEpoch++ : undefined;
				views.set(command.viewId, {
					capability: command.capability,
					controllerEpoch: epoch,
					attachedSequence: runnerSequence + 1,
				});
				if (epoch !== undefined) activeController = { viewId: command.viewId, epoch };
				yield* publishEvent({
					kind: command.capability === "controller" ? "controllerAcquired" : "observerAttached",
					metadata: command,
					controllerEpoch: epoch ?? activeController?.epoch ?? nextControllerEpoch - 1,
					viewId: command.viewId,
				});
				return { capability: command.capability, epoch };
			}),
		);
		if (attached.capability === "controller" && attached.epoch !== undefined) {
			return controllerView(command.viewId, attached.epoch);
		}
		return observerView(command.viewId);
	});

	const attachTerminalView = Effect.fn("Runner.attachTerminalView")(function* (command: AttachRunnerViewCommand) {
		if (command.capability !== "controller") {
			return yield* Effect.fail(
				new RunnerViewCapabilityError({ viewId: command.viewId, requiredCapability: "controller" }),
			);
		}
		const terminalEvents = yield* PubSub.sliding<TerminalRawDelivery>(options.eventCapacity);
		terminalViews.set(command.viewId, { events: terminalEvents });
		if (unsubscribeTerminalAgent === undefined) {
			unsubscribeTerminalAgent = resources.session.subscribe(event => {
				runCallback(
					enqueue(publishTerminal({ kind: "agentEvent", event })).pipe(
						Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void }),
					),
				);
			});
		}
		const attached = yield* attachView(command).pipe(
			Effect.matchEffect({
				onFailure: failure =>
					Effect.sync(() => {
						terminalViews.delete(command.viewId);
						if (terminalViews.size === 0) {
							unsubscribeTerminalAgent?.();
							unsubscribeTerminalAgent = undefined;
						}
					}).pipe(Effect.andThen(PubSub.shutdown(terminalEvents)), Effect.andThen(Effect.fail(failure))),
				onSuccess: Effect.succeed,
			}),
		);
		if (attached.capability !== "controller") {
			return yield* Effect.fail(
				new RunnerViewCapabilityError({ viewId: command.viewId, requiredCapability: "controller" }),
			);
		}
		const epoch = attached.controllerEpoch;
		const planResolveCapabilityEpoch = resources.session.bindPlanResolveCapability(epoch);
		terminalViews.get(command.viewId)!.planResolveCapabilityEpoch = planResolveCapabilityEpoch;

		const terminalSnapshot = () =>
			enqueue(
				Effect.gen(function* () {
					yield* requireController(command.viewId, epoch);
					return yield* materializeTerminalSnapshot(true);
				}),
			);
		const terminalQuery = <A>(read: () => A): Effect.Effect<A, RunnerFailure> =>
			enqueue(
				Effect.gen(function* () {
					yield* requireController(command.viewId, epoch);
					return read();
				}),
			);
		/**
		 * Admit an expensive read under the runner/controller lifetime fence, then
		 * execute it outside the serialized mailbox. Admission defines lifetime:
		 * once started, a later detach or stop does not invalidate its result.
		 * Only the private callable crosses the mailbox boundary.
		 */
		const terminalOutsideMailboxRead = <A>(read: () => A | Promise<A>): Effect.Effect<A, RunnerFailure> =>
			Effect.gen(function* () {
				const admittedRead = yield* enqueue(
					Effect.gen(function* () {
						yield* requireController(command.viewId, epoch);
						return read;
					}),
				);
				return yield* Effect.tryPromise({
					try: () => Promise.resolve().then(admittedRead),
					catch: asRunnerFailure,
				});
			});
		const getContextUsage = (queryOptions?: { readonly contextWindow?: number }) =>
			terminalQuery(() => {
				const usage = resources.session.getContextUsage(queryOptions);
				return usage === undefined ? undefined : { ...usage };
			});
		const getSessionStats = () =>
			terminalQuery(() => {
				const stats = resources.session.getSessionStats();
				return { ...stats, tokens: { ...stats.tokens } };
			});
		const getAdvisorStats = () =>
			terminalQuery(() => {
				const stats = resources.session.getAdvisorStats();
				const model = stats.model;
				return {
					...stats,
					...(model === undefined
						? {}
						: {
								model: {
									provider: model.provider,
									api: model.api,
									id: model.id,
									...(model.requestModelId === undefined ? {} : { requestModelId: model.requestModelId }),
									name: model.name,
									contextWindow: model.contextWindow,
								},
							}),
					tokens: { ...stats.tokens },
					messages: { ...stats.messages },
				};
			});
		const getAsyncJobSnapshot = (queryOptions?: { readonly recentLimit?: number }) =>
			terminalQuery(() => {
				const snapshot = resources.session.getAsyncJobSnapshot(queryOptions);
				return snapshot === null
					? null
					: {
							running: snapshot.running.map(job => ({ ...job })),
							recent: snapshot.recent.map(job => ({ ...job })),
							delivery: {
								...snapshot.delivery,
								pendingJobIds: [...snapshot.delivery.pendingJobIds],
							},
						};
			});
		const getHindsightSessionState = () =>
			terminalQuery(() => {
				const state = resources.session.getHindsightSessionState();
				if (state === undefined) return undefined;
				return {
					sessionId: state.sessionId,
					bankId: state.bankId,
					retainTags: state.retainTags === undefined ? undefined : [...state.retainTags],
					recallTags: state.recallTags === undefined ? undefined : [...state.recallTags],
					recallTagsMatch: state.recallTagsMatch,
					lastRetainedTurn: state.lastRetainedTurn,
					hasRecalledForFirstTurn: state.hasRecalledForFirstTurn,
					lastRecallSnippet: state.lastRecallSnippet,
					mentalModelsSnippet: state.mentalModelsSnippet,
					mentalModelsLoadedAt: state.mentalModelsLoadedAt,
					isAlias: state.aliasOf !== undefined,
				};
			});
		const getAllToolNames = () => terminalQuery(() => [...resources.session.getAllToolNames()]);
		const formatSessionAsText = (queryOptions?: { readonly compact?: boolean }) =>
			terminalOutsideMailboxRead(() => resources.session.formatSessionAsText(queryOptions));
		const formatAdvisorHistoryAsText = (queryOptions?: { readonly compact?: boolean }) =>
			terminalOutsideMailboxRead(() => resources.session.formatAdvisorHistoryAsText(queryOptions));
		const getModelCatalog = () =>
			terminalQuery(() =>
				Object.freeze(
					resources.session
						.getModelCatalog()
						.map(item => Object.freeze({ ...item, roles: Object.freeze([...item.roles]) })),
				),
			);
		const getToolCatalog = () =>
			terminalQuery(() => {
				const catalog = resources.session.getToolCatalog();
				return Object.freeze({
					generation: catalog.generation,
					tools: Object.freeze(catalog.tools.map(item => Object.freeze({ ...item }))),
				});
			});
		const getSessionMetadataSnapshot = () =>
			terminalQuery(() => {
				const metadata = resources.session.getSessionMetadataSnapshot();
				return Object.freeze({
					...metadata,
					branch: Object.freeze([...metadata.branch]),
					usage: Object.freeze({ ...metadata.usage }),
					workflow: Object.freeze({ ...metadata.workflow }),
				});
			});
		const getWorkflowEligibility = () =>
			terminalQuery(() => {
				const eligibility = resources.session.getWorkflowEligibility();
				return Object.freeze({
					...eligibility,
					planResolve: Object.freeze({ ...eligibility.planResolve }),
					goalContinuation: Object.freeze({ ...eligibility.goalContinuation }),
				});
			});
		const getTurnLifecycle = () => terminalQuery(() => Object.freeze({ ...resources.session.getTurnLifecycle() }));
		const saveDraft = (text: string) => terminalOutsideMailboxRead(() => resources.session.saveDraft(text));
		const consumeDraft = () => terminalOutsideMailboxRead(() => resources.session.consumeDraft());
		const invokeExtensionCommand = (name: string, args: string) =>
			terminalOutsideMailboxRead(() => resources.session.invokeExtensionCommand(name, args));
		const invokePlanResolve = (input: import("../session/durable-input-queue").JsonValue) =>
			terminalOutsideMailboxRead(() => resources.session.invokePlanResolve(input, planResolveCapabilityEpoch));
		const requestGoalContinuation = () =>
			terminalOutsideMailboxRead(() => resources.session.requestGoalContinuation());
		const subscribe = Effect.fn("Runner.subscribeTerminalView")(function* () {
			const subscription = yield* PubSub.subscribe(terminalEvents);
			const starting = yield* enqueue(
				Effect.gen(function* () {
					yield* requireController(command.viewId, epoch);
					return terminalSequence;
				}),
			);
			let expectedSequence = starting + 1;
			let take!: Effect.Effect<TerminalSessionDelivery, RunnerFailure, Scope.Scope>;
			take = Effect.suspend(() =>
				PubSub.take(subscription).pipe(
					Effect.flatMap((delivery): Effect.Effect<TerminalSessionDelivery, RunnerFailure, Scope.Scope> => {
						if (delivery.sequence < expectedSequence) return take;
						if (delivery.sequence !== expectedSequence) {
							const expected = expectedSequence;
							return terminalSnapshot().pipe(
								Effect.map(current => {
									expectedSequence = current.terminalSequence + 1;
									return {
										kind: "resyncRequired" as const,
										expectedSequence: expected,
										observedSequence: delivery.sequence,
										snapshot: current,
									};
								}),
							);
						}
						expectedSequence += 1;
						return Effect.succeed(delivery);
					}),
				),
			);
			return { take } satisfies TerminalSessionSubscription;
		});
		const detach = Effect.fn("Runner.detachTerminalView")(function* () {
			yield* enqueue(
				Effect.gen(function* () {
					const attachedView = yield* requireView(command.viewId);
					if (attachedView.capability === "controller") {
						yield* requireController(command.viewId, epoch);
					}
					const detachCommand: DetachRunnerViewCommand = {
						schemaVersion: RUNNER_SCHEMA_VERSION,
						kind: "detachView",
						commandId: `terminal-detach:${command.viewId}:${terminalSequence}`,
						correlationId: command.correlationId,
						expectedRevision: revision,
						viewId: command.viewId,
						controllerEpoch: epoch,
					};
					resources.session.unbindPlanResolveCapability(planResolveCapabilityEpoch);
					views.delete(command.viewId);
					if (activeController?.viewId === command.viewId) activeController = undefined;
					yield* publishEvent({
						kind: "viewDetached",
						metadata: detachCommand,
						controllerEpoch: epoch,
						viewId: command.viewId,
					});
				}),
			);
			terminalViews.delete(command.viewId);
			if (terminalViews.size === 0) {
				unsubscribeTerminalAgent?.();
				unsubscribeTerminalAgent = undefined;
			}
			yield* PubSub.shutdown(terminalEvents);
		});
		return {
			viewId: command.viewId,
			epoch,
			snapshot: terminalSnapshot,
			subscribe,
			getContextUsage,
			getSessionStats,
			getAdvisorStats,
			getAsyncJobSnapshot,
			getHindsightSessionState,
			getAllToolNames,
			formatSessionAsText,
			formatAdvisorHistoryAsText,
			getModelCatalog,
			getToolCatalog,
			getSessionMetadataSnapshot,
			getWorkflowEligibility,
			getTurnLifecycle,
			saveDraft,
			consumeDraft,
			invokeExtensionCommand,
			invokePlanResolve,
			requestGoalContinuation,
			submit: attached.submitInput,
			submitCustomMessage: attached.submitCustomMessage,
			edit: attached.editQueuedInput,
			cancel: attached.cancelQueuedInput,
			setActiveTools: attached.setActiveTools,
			replaceTodos: attached.replaceTodos,
			refreshSshTool: attached.refreshSshTool,
			cycleModel: attached.cycleModel,
			setThinkingLevel: attached.setThinkingLevel,
			setModel: attached.setModel,
			transitionPlanMode: attached.transitionPlanMode,
			transitionGoalMode: attached.transitionGoalMode,
			shake: attached.shake,
			cancelShake: attached.cancelShake,
			handoff: attached.handoff,
			cancelHandoff: attached.cancelHandoff,
			getCheckpointState: attached.getCheckpointState,
			setCheckpointState: attached.setCheckpointState,
			reload: attached.reload,
			prepareHostTransition: attached.prepareHostTransition,
			compact: attached.compact,
			cancelCompaction: attached.cancelCompaction,
			runEphemeralTurn: attached.runEphemeralTurn,
			cancelEphemeralTurn: attached.cancelEphemeralTurn,
			runLocalOperation: attached.runLocalOperation,
			cancelLocalOperation: attached.cancelLocalOperation,
			interruptPrompt: attached.interruptPrompt,
			detach,
		} satisfies TerminalSessionView;
	});

	const applySessionControl = Effect.fn("Runner.applySessionControl")(function* (command: SessionControlCommand) {
		switch (command.intent.kind) {
			case "status": {
				const current = yield* snapshot();
				const model = resources.session.model;
				return {
					status: current.status,
					revision: current.revision,
					sessionRevision: current.sessionRevision,
					pendingOperations: current.pendingOperations,
					model: model ? `${model.provider}/${model.id}` : undefined,
				};
			}
			case "pause":
				yield* enqueue(
					Effect.tryPromise({
						try: () => resources.session.setSessionControlPaused(true),
						catch: asRunnerFailure,
					}),
				);
				return { paused: true };
			case "resume":
				yield* enqueue(
					Effect.tryPromise({
						try: () => resources.session.setSessionControlPaused(false),
						catch: asRunnerFailure,
					}),
				);
				return { paused: false };
			case "setModel": {
				const controller = activeController;
				if (!controller) {
					return yield* Effect.fail(new InvalidRunnerCommandError({ issue: "No active runner controller" }));
				}
				const separator = command.intent.selector.indexOf("/");
				if (separator <= 0 || separator === command.intent.selector.length - 1) {
					return yield* Effect.fail(
						new InvalidRunnerCommandError({ issue: `Invalid model selector: ${command.intent.selector}` }),
					);
				}
				const current = yield* snapshot();
				return yield* setModel(controller.viewId, controller.epoch, {
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
				const controller = activeController;
				if (!controller) {
					return yield* Effect.fail(new InvalidRunnerCommandError({ issue: "No active runner controller" }));
				}
				const current = yield* snapshot();
				return yield* runCompaction(controller.viewId, controller.epoch, {
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
		}
	});

	const stop = Effect.fn("Runner.stop")(function* () {
		return yield* Effect.uninterruptibleMask(restore =>
			Effect.gen(function* () {
				const leader = yield* Ref.modify(statusRef, status =>
					status === "running" ? [true, "stopping" as const] : [false, status],
				);
				if (!leader) return yield* restore(Deferred.await(stopDone));

				const stoppingEphemeralTurn = activeEphemeralTurn;
				activeEphemeralTurn = undefined;
				stoppingEphemeralTurn?.abortController.abort();
				yield* Effect.forEach(
					ephemeralTurnCommands.values(),
					record => Deferred.fail(record.deferred, new SessionRunnerStoppedError()).pipe(Effect.asVoid),
					{ discard: true },
				);
				const stoppingSessionOperation = activeSessionOperation;
				activeSessionOperation = undefined;
				if (stoppingSessionOperation?.kind === "shake" || stoppingSessionOperation?.kind === "handoff") {
					stoppingSessionOperation.record.abortController.abort();
				}
				yield* Effect.forEach(
					shakeCommands.values(),
					record => Deferred.fail(record.deferred, new SessionRunnerStoppedError()).pipe(Effect.asVoid),
					{ discard: true },
				);
				yield* Effect.forEach(
					handoffCommands.values(),
					record => Deferred.fail(record.deferred, new SessionRunnerStoppedError()).pipe(Effect.asVoid),
					{ discard: true },
				);
				yield* Effect.forEach(
					reloadCommands.values(),
					record => Deferred.fail(record.deferred, new SessionRunnerStoppedError()).pipe(Effect.asVoid),
					{ discard: true },
				);
				yield* Effect.forEach(
					hostTransitionCommands.values(),
					record => Deferred.fail(record.deferred, new SessionRunnerStoppedError()).pipe(Effect.asVoid),
					{ discard: true },
				);
				yield* FiberSet.clear(sessionOperationFibers);
				for (const terminalView of terminalViews.values()) {
					if (terminalView.planResolveCapabilityEpoch !== undefined) {
						resources.session.unbindPlanResolveCapability(terminalView.planResolveCapabilityEpoch);
					}
				}
				resources.session.beginDispose();
				activeCompaction = undefined;
				yield* Effect.forEach(
					compactionCommands.values(),
					record => Deferred.fail(record.deferred, new SessionRunnerStoppedError()).pipe(Effect.asVoid),
					{ discard: true },
				);
				activeLocalOperation = undefined;
				yield* Effect.forEach(
					localOperationCommands.values(),
					record => Deferred.fail(record.deferred, new SessionRunnerStoppedError()).pipe(Effect.asVoid),
					{ discard: true },
				);
				let firstFailure: RunnerFailure | undefined;
				const finish = (effect: Effect.Effect<void, RunnerFailure>) =>
					effect.pipe(
						Effect.matchCauseEffect({
							onFailure: cause =>
								Effect.sync(() => {
									if (firstFailure) return;
									const failure = Cause.findErrorOption(cause);
									firstFailure =
										failure._tag === "Some"
											? asRunnerFailure(failure.value)
											: new SessionRunnerRuntimeError({ issue: Cause.pretty(cause) });
								}),
							onSuccess: () => Effect.void,
						}),
					);

				yield* Effect.forEach(mailboxWaiters, cancel => cancel(), { discard: true });
				mailboxWaiters.clear();
				yield* finish(
					Effect.tryPromise({
						try: () =>
							resources.session.dispose({ scope: "root", childPolicy: options.childStopPolicy ?? "detach" }),
						catch: asRunnerFailure,
					}),
				);
				yield* finish(Effect.sync(unsubscribeQueue));
				yield* finish(Effect.sync(unsubscribeTranscript));
				yield* finish(
					Effect.sync(() => {
						unsubscribeTerminalAgent?.();
						unsubscribeTerminalAgent = undefined;
					}),
				);
				yield* finish(FiberSet.clear(callbackFibers));
				yield* Effect.forEach(terminalViews.values(), view => finish(PubSub.shutdown(view.events)), {
					discard: true,
				});
				terminalViews.clear();
				yield* finish(PubSub.shutdown(events));
				yield* finish(Queue.shutdown(mailbox).pipe(Effect.asVoid));
				yield* Ref.set(pendingOperations, 0);
				yield* finish(Effect.tryPromise({ try: () => resources.ownership.release(), catch: asRunnerFailure }));
				yield* Ref.set(statusRef, "stopped");
				if (firstFailure) yield* Deferred.fail(stopDone, firstFailure);
				else yield* Deferred.succeed(stopDone, undefined);
				return yield* restore(Deferred.await(stopDone));
			}),
		);
	});

	yield* Effect.addFinalizer(() =>
		stop().pipe(Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void })),
	);
	return { attachView, attachTerminalView, snapshot, applySessionControl, stop } satisfies SessionRunner;
});
