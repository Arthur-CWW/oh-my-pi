import { Cause, Deferred, Effect, Fiber, PubSub, Queue, Ref, Scope } from "effect";
import {
	DurableRunnerStoreError,
	InvalidRunnerCommandError,
	RunnerControllerConflictError,
	RunnerRevisionConflictError,
	RunnerViewAlreadyAttachedError,
	RunnerViewCapabilityError,
	RunnerViewNotAttachedError,
	SessionRunnerStoppedError,
	StaleRunnerControllerLeaseError,
} from "./errors";
import {
	assertRunnerRevision,
	decodeSubmitInputCommand,
	RUNNER_SCHEMA_VERSION,
	stateFromSnapshot,
	transitionPreparedInput,
	type AcquireRunnerControllerCommand,
	type AttachRunnerViewCommand,
	type DetachRunnerViewCommand,
	type DurableInputRecord,
	type PreparedDurableInput,
	type ReleaseRunnerControllerCommand,
	type RunnerCapability,
	type RunnerCommandReceipt,
	type RunnerControlMetadata,
	type RunnerEvent,
	type RunnerEventDelivery,
	type RunnerEventKind,
	type RunnerState,
	type RunnerStatus,
	type RunnerViewSnapshot,
	type SessionRunnerSnapshot,
} from "./protocol";
import {
	beginDurableDispatch,
	DurableRunnerStoreService,
	finishDurableDispatch,
	loadDurableRunnerSnapshot,
	prepareDurableInput,
	RunnerProviderService,
} from "./services";
import { providerExitDispatchState } from "./transition";

export type RunnerFailure =
	| DurableRunnerStoreError
	| InvalidRunnerCommandError
	| RunnerRevisionConflictError
	| RunnerControllerConflictError
	| StaleRunnerControllerLeaseError
	| RunnerViewAlreadyAttachedError
	| RunnerViewNotAttachedError
	| RunnerViewCapabilityError
	| SessionRunnerStoppedError;

export interface SessionRunnerOptions {
	readonly mailboxCapacity: number;
	readonly eventCapacity: number;
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
	readonly releaseController: (
		command: ReleaseRunnerControllerCommand,
	) => Effect.Effect<ObserverSessionRunnerView, RunnerFailure, Scope.Scope>;
}

export type SessionRunnerView = ObserverSessionRunnerView | ControllerSessionRunnerView;

export interface SessionRunner {
	readonly attachView: (command: AttachRunnerViewCommand) => Effect.Effect<SessionRunnerView, RunnerFailure, Scope.Scope>;
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
	readonly metadata: RunnerControlMetadata;
	readonly controllerEpoch: number;
	readonly viewId?: string;
	readonly inputId?: string;
	readonly durableSequence?: number;
}

const asRunnerFailure = (error: unknown): RunnerFailure => {
	if (
		error instanceof DurableRunnerStoreError ||
		error instanceof InvalidRunnerCommandError ||
		error instanceof RunnerRevisionConflictError ||
		error instanceof RunnerControllerConflictError ||
		error instanceof StaleRunnerControllerLeaseError ||
		error instanceof RunnerViewAlreadyAttachedError ||
		error instanceof RunnerViewNotAttachedError ||
		error instanceof RunnerViewCapabilityError ||
		error instanceof SessionRunnerStoppedError
	) {
		return error;
	}
	return new DurableRunnerStoreError({ issue: error instanceof Error ? error.message : "Runner operation failed" });
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

/** A single serialized session authority. Provider effects run only in supervised fibers outside the mailbox. */
export const makeSessionRunner = Effect.fn("Runner.makeSessionRunner")(function* (options: SessionRunnerOptions) {
	if (!Number.isSafeInteger(options.mailboxCapacity) || options.mailboxCapacity < 1) {
		return yield* Effect.fail(new InvalidRunnerCommandError({ issue: "mailboxCapacity must be positive" }));
	}
	if (!Number.isSafeInteger(options.eventCapacity) || options.eventCapacity < 1) {
		return yield* Effect.fail(new InvalidRunnerCommandError({ issue: "eventCapacity must be positive" }));
	}

	const provider = yield* RunnerProviderService;
	const durableStore = yield* DurableRunnerStoreService;
	const opened = yield* loadDurableRunnerSnapshot();
	let runnerState: RunnerState = stateFromSnapshot(opened);
	const durableRecords = new Map<string, DurableInputRecord>();
	for (const record of opened.records) {
		durableRecords.set(
			record.receipt.commandId,
			record.dispatchState === "dispatched" ? { ...record, dispatchState: "uncertain" } : record,
		);
	}

	const mailbox = yield* Queue.bounded<Effect.Effect<void, never, Scope.Scope>>(options.mailboxCapacity);
	const events = yield* PubSub.sliding<RunnerEvent>(options.eventCapacity);
	const pendingOperations = yield* Ref.make(0);
	const statusRef = yield* Ref.make<RunnerStatus>("running");
	const stopDone = yield* Deferred.make<void, RunnerFailure>();
	const views = new Map<string, MutableViewState>();
	const providerFibers = new Set<Fiber.Fiber<void, never>>();
	let activeController: ActiveController | undefined;
	let nextControllerEpoch = 1;
	let runnerSequence = 0;

	const materializeSnapshot = Effect.fn("Runner.materializeSnapshot")(function* () {
		const pending = yield* Ref.get(pendingOperations);
		const status = yield* Ref.get(statusRef);
		const records = Array.from(durableRecords.values()).sort(
			(left, right) => left.receipt.sequence - right.receipt.sequence,
		);
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
			revision: runnerState.revision,
			sequence: runnerSequence,
			durableSequence: records.at(-1)?.receipt.sequence ?? 0,
			records,
			views: viewSnapshots,
			controller: activeController,
			status,
			pendingOperations: pending,
		} satisfies SessionRunnerSnapshot;
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
			revision: runnerState.revision,
			sequence: runnerSequence,
			controllerEpoch: details.controllerEpoch,
			viewId: details.viewId,
			inputId: details.inputId,
			durableSequence: details.durableSequence,
		};
		yield* PubSub.publish(events, event);
		return event;
	});

	const enqueue = <A>(
		operation: Effect.Effect<A, RunnerFailure, Scope.Scope | DurableRunnerStoreService>,
	): Effect.Effect<A, RunnerFailure, Scope.Scope> =>
		Effect.gen(function* () {
			const reply = yield* Deferred.make<A, RunnerFailure>();
			const queued = operation.pipe(
				Effect.provideService(DurableRunnerStoreService, durableStore),
				Effect.matchCauseEffect({
					onFailure: (cause) => {
						const failure = Cause.findErrorOption(cause);
						return Deferred.fail(
							reply,
							failure._tag === "Some"
								? asRunnerFailure(failure.value)
								: new DurableRunnerStoreError({ issue: Cause.pretty(cause) }),
						);
					},
					onSuccess: (value) => Deferred.succeed(reply, value),
				}),
				Effect.asVoid,
			);
			yield* Ref.update(pendingOperations, (count) => count + 1);
			yield* Queue.offer(mailbox, queued).pipe(
				Effect.onInterrupt(() => Ref.update(pendingOperations, (count) => count - 1)),
			);
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

	const requireRunning = Effect.fn("Runner.requireRunning")(function* () {
		const status = yield* Ref.get(statusRef);
		if (status !== "running") return yield* Effect.fail(new SessionRunnerStoppedError());
	});

	const requireRevision = (expectedRevision: number): Effect.Effect<void, RunnerFailure> =>
		Effect.try({
			try: () => assertRunnerRevision(expectedRevision, runnerState.revision),
			catch: asRunnerFailure,
		});

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

	const dispatchPrepared = Effect.fn("Runner.dispatchPrepared")(function* (commandId: string) {
		const record = yield* beginDurableDispatch(commandId);
		if (!record) return;
		durableRecords.set(commandId, record);
		const input: PreparedDurableInput = { ...record.receipt, replayed: false };
		let fiber: Fiber.Fiber<void, never> | undefined;
		const invocation = Effect.scoped(provider.run(input)).pipe(
			Effect.onExit((exit) => {
				const dispatchState = providerExitDispatchState(exit);
				return enqueue(
					finishDurableDispatch(commandId, dispatchState).pipe(
						Effect.flatMap(() => {
							const current = durableRecords.get(commandId);
							if (current) durableRecords.set(commandId, { ...current, dispatchState });
							if (fiber) providerFibers.delete(fiber);
							return publishEvent({
								kind: dispatchState === "completed" ? "inputCompleted" : "inputUncertain",
								metadata: record.command,
								controllerEpoch: record.command.controllerEpoch,
								viewId: record.command.viewId,
								inputId: record.receipt.inputId,
								durableSequence: record.receipt.sequence,
							});
						}),
						Effect.asVoid,
					),
				).pipe(Effect.catchCause(() => Effect.void));
			}),
			Effect.catchCause(() => Effect.void),
		);
		fiber = yield* Effect.forkScoped(invocation, { startImmediately: true });
		providerFibers.add(fiber);
	});

	for (const record of opened.records) {
		if (record.dispatchState === "prepared") {
			yield* enqueue(dispatchPrepared(record.receipt.commandId).pipe(Effect.mapError(asRunnerFailure)));
		}
	}

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
			releaseController: (command) =>
				command.viewId === viewId ? releaseController(command) : mismatchedView(viewId),
		};
	};

	snapshot = Effect.fn("Runner.snapshot")(function* () {
		const status = yield* Ref.get(statusRef);
		return status === "stopped" ? yield* materializeSnapshot() : yield* enqueue(materializeSnapshot());
	});

	snapshotView = Effect.fn("Runner.snapshotView")(function* (viewId: string) {
		return yield* enqueue(
			Effect.gen(function* () {
				yield* requireRunning();
				yield* requireView(viewId);
				return yield* materializeSnapshot();
			}),
		);
	});

	subscribeView = Effect.fn("Runner.subscribeView")(function* (viewId: string) {
		const subscription = yield* PubSub.subscribe(events);
		const starting = yield* enqueue(
			Effect.gen(function* () {
				yield* requireRunning();
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
				yield* requireRunning();
				yield* requireController(viewId, controllerEpoch);
				const prior = runnerState.processedCommandIds.get(command.commandId);
				if (prior) return { ...prior, replayed: true };
				yield* requireRevision(command.expectedRevision);
				const prepared = yield* prepareDurableInput(command, command.expectedRevision);
				const transition = transitionPreparedInput(runnerState, command, prepared, runnerSequence + 1);
				runnerState = transition.state;
				if (transition.event) {
					runnerSequence = transition.event.sequence;
					yield* PubSub.publish(events, transition.event);
				}
				const record: DurableInputRecord = {
					command,
					receipt: {
						commandId: prepared.commandId,
						correlationId: prepared.correlationId,
						causationId: prepared.causationId,
						controllerEpoch: prepared.controllerEpoch,
						inputId: prepared.inputId,
						sequence: prepared.sequence,
						revision: prepared.revision,
					},
					dispatchState: "prepared",
				};
				durableRecords.set(command.commandId, record);
				yield* dispatchPrepared(command.commandId);
				return transition.receipt;
			}),
		);
	});

	acquireController = Effect.fn("Runner.acquireController")(function* (command: AcquireRunnerControllerCommand) {
		yield* Effect.try({ try: () => validateMetadata(command), catch: asRunnerFailure });
		const epoch = yield* enqueue(
			Effect.gen(function* () {
				yield* requireRunning();
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
				yield* requireRunning();
				yield* requireController(command.viewId, command.controllerEpoch);
				yield* requireRevision(command.expectedRevision);
				const view = views.get(command.viewId);
				if (!view) return yield* Effect.fail(new RunnerViewNotAttachedError({ viewId: command.viewId }));
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
				yield* requireRunning();
				const view = yield* requireView(command.viewId);
				yield* requireRevision(command.expectedRevision);
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
					controllerEpoch: command.controllerEpoch ?? activeController?.epoch ?? nextControllerEpoch - 1,
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
				yield* requireRunning();
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
				const eventSequence = runnerSequence + 1;
				views.set(command.viewId, {
					capability: command.capability,
					controllerEpoch: epoch,
					attachedSequence: eventSequence,
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

	const stop = Effect.fn("Runner.stop")(function* () {
		return yield* Effect.uninterruptibleMask((restore) =>
			Effect.gen(function* () {
				const currentStatus = yield* Ref.get(statusRef);
				if (currentStatus === "stopped") return yield* restore(Deferred.await(stopDone));
				const beginning = yield* enqueue(
					Effect.gen(function* () {
						const status = yield* Ref.get(statusRef);
						if (status !== "running") return { leader: false as const, fibers: [] };
						yield* Ref.set(statusRef, "stopping");
						return { leader: true as const, fibers: Array.from(providerFibers) };
					}),
				);
				if (!beginning.leader) return yield* restore(Deferred.await(stopDone));
				yield* Effect.forEach(beginning.fibers, Fiber.interrupt, { concurrency: "unbounded", discard: true });
				yield* enqueue(
					Effect.gen(function* () {
						views.clear();
						activeController = undefined;
						yield* Ref.set(statusRef, "stopped");
						yield* PubSub.shutdown(events);
					}),
				);
				yield* Queue.shutdown(mailbox);
				yield* Deferred.succeed(stopDone, undefined);
			}),
		);
	});

	return { attachView, snapshot, stop } satisfies SessionRunner;
});
