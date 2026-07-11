import { type AgentSession, type AgentSessionEvent, PromptOperationConflictError } from "../session/agent-session";
import { Cause, Deferred, Effect, FiberSet, PubSub, Queue, Ref, type Scope } from "effect";
import {
	DurableInputCommandConflictError,
	DurableInputQueueConflictError,
	DurableInputItemRevisionConflictError,
	DurableInputRunnerRevisionConflictError,
	SessionOwnershipLostError,
	type DurableInputQueue,
	type DurableInputQueueEvent,
} from "../session/durable-input-queue";
import type {
	SessionEntry,
	SetModelSessionCommand,
	SetThinkingSessionCommand,
	TransitionPlanModeSessionCommand,
	TransitionGoalModeSessionCommand,
} from "../session/session-entries";
import {
	SessionCommandConflictError,
	type SessionManager,
	SessionRevisionConflictError,
	SessionStateCommandInFlightError,
} from "../session/session-manager";
import type { SessionOwnershipHandle } from "../session/session-ownership";
import {
	InvalidRunnerCommandError,
	RunnerControllerConflictError,
	RunnerRevisionConflictError,
	RunnerToolConfigurationConflictError,
	RunnerCompactionCommandConflictError,
	RunnerCompactionUnavailableError,
	RunnerCompactionTargetError,
	RunnerItemRevisionConflictError,
	RunnerPromptOperationConflictError,
	RunnerViewAlreadyAttachedError,
	RunnerViewCapabilityError,
	RunnerViewNotAttachedError,
	SessionRunnerRuntimeError,
	SessionRunnerStoppedError,
	StaleRunnerControllerLeaseError,
} from "./errors";
import {
	assertRunnerRevision,
	decodeCancelQueuedInputCommand,
	decodeCancelCompactionCommand,
	decodeEditQueuedInputCommand,
	decodeSetActiveToolsCommand,
	decodeSubmitInputCommand,
	decodeRunCompactionCommand,
	decodeSetModelCommand,
	decodeTransitionPlanModeCommand,
	decodeTransitionGoalModeCommand,
	decodeInterruptPromptCommand,
	decodeSetThinkingLevelCommand,
	RUNNER_SCHEMA_VERSION,
	type AcquireRunnerControllerCommand,
	type CancelCompactionCommand,
	type CancelCompactionReceipt,
	type AttachRunnerViewCommand,
	type DetachRunnerViewCommand,
	type ReleaseRunnerControllerCommand,
	type RunnerCapability,
	type RunnerCommandReceipt,
	type RunCompactionCommand,
	type RunCompactionReceipt,
	type InterruptPromptReceipt,
	type SetModelReceipt,
	type SetActiveToolsReceipt,
	type SetActiveToolsCommand,
	type InterruptPromptCommand,
	type SetThinkingLevelReceipt,
	type TransitionPlanModeReceipt,
	type TransitionGoalModeReceipt,
	type RunnerControlMetadata,
	type RunnerEvent,
	type RunnerEventDelivery,
	type RunnerEventKind,
	type RunnerStatus,
	type RunnerViewSnapshot,
	type SessionRunnerSnapshot,
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
	| RunnerRevisionConflictError
	| RunnerItemRevisionConflictError
	| RunnerPromptOperationConflictError
	| RunnerControllerConflictError
	| RunnerCompactionCommandConflictError
	| RunnerCompactionUnavailableError
	| RunnerCompactionTargetError
	| StaleRunnerControllerLeaseError
	| RunnerViewAlreadyAttachedError
	| RunnerViewNotAttachedError
	| RunnerViewCapabilityError
	| SessionRunnerRuntimeError
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
	readonly queue: DurableInputQueue;
	readonly session: AgentSession;
	readonly sessionManager: SessionManager;
}

export interface RunnerSubscription {
	readonly take: Effect.Effect<RunnerEventDelivery, RunnerFailure, Scope.Scope>;
}

interface RunnerViewBase {
	readonly viewId: string;
	readonly snapshot: () => Effect.Effect<SessionRunnerSnapshot, RunnerFailure, Scope.Scope>;
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
	readonly editQueuedInput: (input: unknown) => Effect.Effect<RunnerCommandReceipt, RunnerFailure, Scope.Scope>;
	readonly cancelQueuedInput: (input: unknown) => Effect.Effect<RunnerCommandReceipt, RunnerFailure, Scope.Scope>;
	readonly setActiveTools: (input: unknown) => Effect.Effect<SetActiveToolsReceipt, RunnerFailure, Scope.Scope>;
	readonly setModel: (input: unknown) => Effect.Effect<SetModelReceipt, RunnerFailure, Scope.Scope>;
	readonly setThinkingLevel: (input: unknown) => Effect.Effect<SetThinkingLevelReceipt, RunnerFailure, Scope.Scope>;
	readonly transitionPlanMode: (input: unknown) => Effect.Effect<TransitionPlanModeReceipt, RunnerFailure, Scope.Scope>;
	readonly transitionGoalMode: (input: unknown) => Effect.Effect<TransitionGoalModeReceipt, RunnerFailure, Scope.Scope>;
	readonly compact: (command: RunCompactionCommand) => Effect.Effect<RunCompactionReceipt, RunnerFailure, Scope.Scope>;
	readonly cancelCompaction: (
		command: CancelCompactionCommand,
	) => Effect.Effect<CancelCompactionReceipt, RunnerFailure, Scope.Scope>;
	readonly interruptPrompt: (
		command: InterruptPromptCommand,
	) => Effect.Effect<InterruptPromptReceipt, RunnerFailure, Scope.Scope>;
	readonly releaseController: (
		command: ReleaseRunnerControllerCommand,
	) => Effect.Effect<ObserverSessionRunnerView, RunnerFailure, Scope.Scope>;
}

export type SessionRunnerView = ObserverSessionRunnerView | ControllerSessionRunnerView;

export interface SessionRunner {
	readonly attachView: (command: AttachRunnerViewCommand) => Effect.Effect<SessionRunnerView, RunnerFailure, Scope.Scope>;
	readonly attachTerminalView: (
		command: AttachRunnerViewCommand,
	) => Effect.Effect<TerminalSessionView, RunnerFailure, Scope.Scope>;
	readonly snapshot: () => Effect.Effect<SessionRunnerSnapshot, RunnerFailure, Scope.Scope>;
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
	readonly metadata: RunnerControlMetadata | SetActiveToolsCommand | InterruptPromptCommand | CancelCompactionCommand;
	readonly controllerEpoch: number;
	readonly viewId?: string;
	readonly inputId?: string;
	readonly targetGeneration?: number;
	readonly targetCommandId?: string;
	readonly targetOperationGeneration?: number;
	readonly durableSequence?: number;
	readonly transcriptEntryId?: string;
	readonly transcriptLeafId?: string | null;
	readonly transcriptPosition?: number;
	readonly sessionRevision?: number;
}
type TerminalRawDelivery =
	| { readonly kind: "agentEvent"; readonly sequence: number; readonly event: AgentSessionEvent }
	| { readonly kind: "runnerEvent"; readonly sequence: number; readonly event: RunnerEvent };

interface TerminalViewState {
	readonly events: PubSub.PubSub<TerminalRawDelivery>;
}

interface LiveCompactionRecord {
	readonly command: RunCompactionCommand;
	readonly operationGeneration: number;
	readonly startedSessionRevision: number;
	readonly deferred: Deferred.Deferred<RunCompactionReceipt, RunnerFailure>;
	completed: boolean;
	cancellationRequested: boolean;
}


const asRunnerFailure = (error: unknown): RunnerFailure => {
	if (
		error instanceof InvalidRunnerCommandError ||
		error instanceof RunnerRevisionConflictError ||
		error instanceof RunnerControllerConflictError ||
		error instanceof RunnerItemRevisionConflictError ||
		error instanceof RunnerPromptOperationConflictError ||
		error instanceof RunnerCompactionCommandConflictError ||
		error instanceof RunnerCompactionUnavailableError ||
		error instanceof RunnerCompactionTargetError ||
		error instanceof StaleRunnerControllerLeaseError ||
		error instanceof RunnerViewAlreadyAttachedError ||
		error instanceof RunnerViewNotAttachedError ||
		error instanceof RunnerViewCapabilityError ||
		error instanceof SessionRunnerRuntimeError ||
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
	const durableItems = new Map(openedItems.map((item) => [item.inputId, item]));
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
	const views = new Map<string, MutableViewState>();
	const terminalViews = new Map<string, TerminalViewState>();
	let unsubscribeTerminalAgent: (() => void) | undefined;
	let terminalSequence = 0;
	let activeController: ActiveController | undefined;
	let nextControllerEpoch = 1;
	let runnerSequence = 0;
	const mailboxWaiters = new Set<() => Effect.Effect<void>>();
	const compactionCommands = new Map<string, LiveCompactionRecord>();
	let activeCompaction: { readonly commandId: string; readonly operationGeneration: number } | undefined;
	let nextCompactionOperationGeneration = 1;


	const materializeSnapshot = Effect.fn("Runner.materializeSnapshot")(function* (refreshQueue: boolean) {
		if (refreshQueue) {
			const items = yield* Effect.tryPromise({ try: () => resources.queue.list(), catch: asRunnerFailure });
			durableItems.clear();
			for (const item of items) durableItems.set(item.inputId, item);
		}
		const pending = yield* Ref.get(pendingOperations);
		const status = yield* Ref.get(statusRef);
		const items = Array.from(durableItems.values()).sort((left, right) => left.sequence - right.sequence);
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
			revision,
			sessionRevision,
			sequence: runnerSequence,
			durableSequence: items.at(-1)?.sequence ?? 0,
			items,
			transcript: {
				entryCount: transcriptEntryCount,
				leafId: transcriptLeafId,
				lastEntryId: transcriptLastEntryId,
			},
			views: viewSnapshots,
			controller: activeController,
			activeCompaction:
				activeCompaction === undefined
					? undefined
					: {
							...activeCompaction,
							startedSessionRevision: compactionCommands.get(activeCompaction.commandId)!.startedSessionRevision,
						},
			workflow: resources.sessionManager.buildSessionContext().workflow ?? { kind: "none" },
			toolConfigurationGeneration: resources.session.toolConfigurationGeneration,
			activeToolNames: resources.session.getActiveToolNames(),
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
				modelSummary:
					model === undefined
						? undefined
						: {
								provider: model.provider,
								id: model.id,
								name: model.name,
								contextWindow: model.contextWindow,
							},
				configuredThinkingLevel: resources.session.configuredThinkingLevel(),
				workflow: resources.sessionManager.buildSessionContext().workflow ?? { kind: "none" },
				toolConfigurationGeneration: resources.session.toolConfigurationGeneration,
				activeToolNames: resources.session.getActiveToolNames(),
				autoCompactionEnabled: resources.session.autoCompactionEnabled,
				isStreaming: resources.session.isStreaming,
				isCompacting: resources.session.isCompacting,
				hasPostPromptWork: resources.session.hasPostPromptWork,
				isBashRunning: resources.session.isBashRunning,
				promptOperation: resources.session.promptOperation,
				isEvalRunning: resources.session.isEvalRunning,
				messages: [...resources.session.messages],
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
		yield* Effect.forEach(terminalViews.values(), (view) => PubSub.publish(view.events, sequenced), {
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
			targetGeneration: details.targetGeneration,
			targetCommandId: details.targetCommandId,
			targetOperationGeneration: details.targetOperationGeneration,
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
						onFailure: (cause) => {
							const failure = Cause.findErrorOption(cause);
							return Deferred.fail(
								reply,
								failure._tag === "Some"
									? asRunnerFailure(failure.value)
									: new SessionRunnerRuntimeError({ issue: Cause.pretty(cause) }),
							);
						},
						onSuccess: (value) => Deferred.succeed(reply, value),
					}),
					Effect.asVoid,
				);
			});
			yield* Ref.update(pendingOperations, (count) => count + 1);
			const offered = yield* Queue.offer(mailbox, queued).pipe(
				Effect.onInterrupt(() =>
					Effect.sync(() => mailboxWaiters.delete(cancel)).pipe(
						Effect.andThen(Ref.update(pendingOperations, (count) => count - 1)),
					),
				),
			);
			if (!offered) {
				mailboxWaiters.delete(cancel);
				yield* Ref.update(pendingOperations, (count) => count - 1);
				return yield* Effect.fail(new SessionRunnerStoppedError());
			}
			return yield* Deferred.await(reply);
		});

	const drainMailbox = Effect.forever(
		Queue.take(mailbox).pipe(
			Effect.flatMap((operation) =>
				Ref.update(pendingOperations, (count) => count - 1).pipe(Effect.andThen(operation)),
			),
		),
	);
	yield* Effect.forkScoped(drainMailbox, { startImmediately: true });

	const requireRevision = (expectedRevision: number): Effect.Effect<void, RunnerFailure> =>
		Effect.try({ try: () => assertRunnerRevision(expectedRevision, revision), catch: asRunnerFailure });

	const requireView = (viewId: string): Effect.Effect<MutableViewState, RunnerFailure> => {
		const view = views.get(viewId);
		return view
			? Effect.succeed(view)
			: Effect.fail(new RunnerViewNotAttachedError({ viewId }));
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
	const unsubscribeQueue = resources.queue.subscribe((event) => {
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
						transcriptPosition: position,
					});
				}),
			).pipe(Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void })),
		);
	});

	let snapshot!: () => Effect.Effect<SessionRunnerSnapshot, RunnerFailure, Scope.Scope>;
	let snapshotView!: (viewId: string) => Effect.Effect<SessionRunnerSnapshot, RunnerFailure, Scope.Scope>;
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
			detach,
			close: detach,
			acquireController: (command) =>
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
			detach,
			close: detach,
			submitInput: (input) => submitInput(viewId, controllerEpoch, input),
			editQueuedInput: (input) => editQueuedInput(viewId, controllerEpoch, input),
			cancelQueuedInput: (input) => cancelQueuedInput(viewId, controllerEpoch, input),
			setActiveTools: (input) => setActiveTools(viewId, controllerEpoch, input),
			setThinkingLevel: (input) => setThinkingLevel(viewId, controllerEpoch, input),
			setModel: (input) => setModel(viewId, controllerEpoch, input),
			transitionPlanMode: (input) => transitionPlanMode(viewId, controllerEpoch, input),
			transitionGoalMode: (input) => transitionGoalMode(viewId, controllerEpoch, input),
			compact: (input) => runCompaction(viewId, controllerEpoch, input),
			cancelCompaction: (command) => cancelCompaction(viewId, controllerEpoch, command),
			interruptPrompt: (command) => interruptPrompt(viewId, controllerEpoch, command),
			releaseController: (command) =>
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
						expectedSequence = event.sequence + 1;
						return snapshot().pipe(
							Effect.map((current) => ({
								kind: "resyncRequired" as const,
								expectedSequence: expected,
								observedSequence: event.sequence,
								event,
								snapshot: current,
							})),
						);
					}
					expectedSequence += 1;
					return Effect.succeed({ kind: "event" as const, event });
				}),
			),
		);
		return { take };
	});

	submitInput = Effect.fn("Runner.submitInput")(function* (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) {
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
						return yield* Effect.fail(
							new RunnerCompactionCommandConflictError({ commandId: command.commandId }),
						);
					}
					return { record: retained, replayed: true };
				}
				if (command.expectedSessionRevision !== sessionRevision) {
					return yield* Effect.fail(
						new SessionRevisionConflictError(command.expectedSessionRevision, sessionRevision),
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
							onFailure: (failure) =>
								enqueue(
									Effect.sync(() => {
										record.completed = true;
										if (activeCompaction?.operationGeneration === record.operationGeneration) activeCompaction = undefined;
										return failure;
									}),
								).pipe(
									Effect.flatMap((retainedFailure) => Deferred.fail(record.deferred, retainedFailure)),
									Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void }),
								),
							onSuccess: (result) =>
								enqueue(
									Effect.gen(function* () {
										sessionRevision = resources.sessionManager.getSessionRevision();
										record.completed = true;
										if (activeCompaction?.operationGeneration === record.operationGeneration) activeCompaction = undefined;
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
												...(result.shortSummary === undefined
													? {}
													: { shortSummary: result.shortSummary }),
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
												...(command.causationId === undefined
													? {}
													: { causationId: command.causationId }),
												expectedRevision: revision,
											},
											controllerEpoch,
											viewId,
											sessionRevision,
										});
										yield* Deferred.succeed(record.deferred, receipt);
									}),
								).pipe(
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
						return yield* Effect.fail(
							new InvalidRunnerCommandError({ issue: `Tool "${name}" is unavailable` }),
						);
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

	setModel = Effect.fn("Runner.setModel")(function* (
		viewId: string,
		controllerEpoch: number,
		input: unknown,
	) {
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
					return yield* Effect.fail(
						new RunnerControllerConflictError({
							requestedViewId: command.viewId,
							activeViewId: activeController.viewId,
							controllerEpoch: activeController.epoch,
						}),
					);
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

	const attachTerminalView = Effect.fn("Runner.attachTerminalView")(function* (
		command: AttachRunnerViewCommand,
	) {
		if (command.capability !== "controller") {
			return yield* Effect.fail(
				new RunnerViewCapabilityError({ viewId: command.viewId, requiredCapability: "controller" }),
			);
		}
		const terminalEvents = yield* PubSub.sliding<TerminalRawDelivery>(options.eventCapacity);
		terminalViews.set(command.viewId, { events: terminalEvents });
		if (unsubscribeTerminalAgent === undefined) {
			unsubscribeTerminalAgent = resources.session.subscribe((event) => {
				runCallback(
					enqueue(publishTerminal({ kind: "agentEvent", event })).pipe(
						Effect.matchCauseEffect({ onFailure: () => Effect.void, onSuccess: () => Effect.void }),
					),
				);
			});
		}
		const attached = yield* attachView(command).pipe(
			Effect.matchEffect({
				onFailure: (failure) =>
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

		const terminalSnapshot = () =>
			enqueue(
				Effect.gen(function* () {
					yield* requireController(command.viewId, epoch);
					return yield* materializeTerminalSnapshot(true);
				}),
			);
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
								Effect.map((current) => {
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
					yield* requireController(command.viewId, epoch);
					const detachCommand: DetachRunnerViewCommand = {
						schemaVersion: RUNNER_SCHEMA_VERSION,
						kind: "detachView",
						commandId: `terminal-detach:${command.viewId}:${terminalSequence}`,
						correlationId: command.correlationId,
						expectedRevision: revision,
						viewId: command.viewId,
						controllerEpoch: epoch,
					};
					views.delete(command.viewId);
					activeController = undefined;
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
			submit: attached.submitInput,
			edit: attached.editQueuedInput,
			cancel: attached.cancelQueuedInput,
			setActiveTools: attached.setActiveTools,
			setThinkingLevel: attached.setThinkingLevel,
			setModel: attached.setModel,
			transitionPlanMode: attached.transitionPlanMode,
			transitionGoalMode: attached.transitionGoalMode,
			compact: attached.compact,
			cancelCompaction: attached.cancelCompaction,
			interruptPrompt: attached.interruptPrompt,
			detach,
		} satisfies TerminalSessionView;
	});

	const stop = Effect.fn("Runner.stop")(function* () {
		return yield* Effect.uninterruptibleMask((restore) =>
			Effect.gen(function* () {
				const leader = yield* Ref.modify(statusRef, (status) =>
					status === "running" ? [true, "stopping" as const] : [false, status],
				);
				if (!leader) return yield* restore(Deferred.await(stopDone));

				resources.session.beginDispose();
				activeCompaction = undefined;
				yield* Effect.forEach(
					compactionCommands.values(),
					(record) => Deferred.fail(record.deferred, new SessionRunnerStoppedError()).pipe(Effect.asVoid),
					{ discard: true },
				);
				let firstFailure: RunnerFailure | undefined;
				const finish = (effect: Effect.Effect<void, RunnerFailure>) =>
					effect.pipe(
						Effect.matchCauseEffect({
							onFailure: (cause) =>
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

				yield* Effect.forEach(mailboxWaiters, (cancel) => cancel(), { discard: true });
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
				yield* Effect.forEach(terminalViews.values(), (view) => finish(PubSub.shutdown(view.events)), {
					discard: true,
				});
				terminalViews.clear();
				yield* finish(PubSub.shutdown(events));
				yield* finish(Queue.shutdown(mailbox).pipe(Effect.asVoid));
				yield* Ref.set(pendingOperations, 0);
				yield* finish(
					Effect.tryPromise({ try: () => resources.ownership.release(), catch: asRunnerFailure }),
				);
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
	return { attachView, attachTerminalView, snapshot, stop } satisfies SessionRunner;
});
