import { Deferred, Effect, PubSub, Queue, Ref, Scope } from "effect";
import { DurableRunnerStoreError, InvalidRunnerCommandError, RunnerRevisionConflictError } from "./errors.js";
import {
	decodeSubmitInputCommand,
	stateFromSnapshot,
	transitionPreparedInput,
	type DurableRunnerSnapshot,
	type PreparedDurableInput,
	type RunnerCommandReceipt,
	type RunnerEvent,
	type RunnerState,
} from "./protocol.js";
import {
	beginDurableDispatch,
	DurableRunnerStoreService,
	finishDurableDispatch,
	loadDurableRunnerSnapshot,
	prepareDurableInput,
	RunnerProviderService,
} from "./services.js";
import { providerExitDispatchState } from "./transition.js";

export type RunnerFailure =
	| DurableRunnerStoreError
	| InvalidRunnerCommandError
	| RunnerRevisionConflictError;

export interface RunnerInspection {
	readonly revision: number;
	readonly records: DurableRunnerSnapshot["records"];
	readonly pendingOperations: number;
}

export type RunnerEventDelivery =
	| { readonly kind: "event"; readonly event: RunnerEvent }
	| {
			readonly kind: "resyncRequired";
			readonly expectedRevision: number;
			readonly observedRevision: number;
			readonly event: RunnerEvent;
		};

export interface RepresentativeRunnerOptions {
	readonly mailboxCapacity: number;
	readonly eventCapacity: number;
}

const asRunnerFailure = (error: unknown): RunnerFailure => {
	if (
		error instanceof DurableRunnerStoreError ||
		error instanceof InvalidRunnerCommandError ||
		error instanceof RunnerRevisionConflictError
	) {
		return error;
	}
	return new DurableRunnerStoreError({
		issue: error instanceof Error ? error.message : "Runner transition failed",
	});
};

/** A small serialized authority around a durable input outbox and supervised provider fibers. */
export const makeRepresentativeRunner = Effect.fn("Runner.makeRepresentativeRunner")(function* (
	options: RepresentativeRunnerOptions,
) {
	const provider = yield* RunnerProviderService;
	const durableStore = yield* DurableRunnerStoreService;
	const mailbox = yield* Queue.bounded<number>(options.mailboxCapacity);
	const events = yield* PubSub.sliding<RunnerEvent>(options.eventCapacity);
	const durableSnapshot = yield* loadDurableRunnerSnapshot();
	const state = yield* Ref.make<RunnerState>(stateFromSnapshot(durableSnapshot));
	const pending = new Map<number, Effect.Effect<void, never, Scope.Scope>>();
	let nextMailboxId = 0;

	const drainMailbox = Effect.forever(
		Queue.take(mailbox).pipe(
			Effect.flatMap((mailboxId) =>
				Effect.sync(() => {
					const operation = pending.get(mailboxId);
					pending.delete(mailboxId);
					return operation;
				}).pipe(Effect.flatMap((operation) => operation ?? Effect.void)),
			),
		),
	);
	yield* Effect.forkScoped(drainMailbox, { startImmediately: true });

	const enqueue = Effect.fn("Runner.enqueue")(function* (operation: Effect.Effect<void, never, Scope.Scope>) {
		const mailboxId = nextMailboxId++;
		yield* Effect.sync(() => pending.set(mailboxId, operation));
		yield* Queue.offer(mailbox, mailboxId).pipe(
			Effect.onInterrupt(() =>
				Effect.sync(() => {
					if (pending.get(mailboxId) === operation) pending.delete(mailboxId);
				}),
			),
		);
	});

	const dispatchPrepared = Effect.fn("Runner.dispatchPrepared")(function* (commandId: string) {
		const record = yield* beginDurableDispatch(commandId);
		if (!record) return;
		const input: PreparedDurableInput = {
			commandId: record.receipt.commandId,
			inputId: record.receipt.inputId,
			sequence: record.receipt.sequence,
			revision: record.receipt.revision,
			replayed: false,
		};
		const invocation = Effect.scoped(provider.run(input)).pipe(
			Effect.onExit((exit) => finishDurableDispatch(commandId, providerExitDispatchState(exit))),
			Effect.catchCause(() => Effect.void),
		);
		yield* Effect.forkScoped(invocation, { startImmediately: true });
	});

	// Reconcile before returning the authority. The durable prepared-to-dispatched
	// CAS prevents two concurrently opened runners from invoking the same record.
	for (const record of durableSnapshot.records) {
		if (record.dispatchState === "prepared") yield* dispatchPrepared(record.receipt.commandId);
	}

	const submitInput = Effect.fn("Runner.submitInput")(function* (input: unknown) {
		const command = yield* Effect.try({ try: () => decodeSubmitInputCommand(input), catch: asRunnerFailure });
		const reply = yield* Deferred.make<RunnerCommandReceipt, RunnerFailure>();
		const operation = Effect.gen(function* () {
			const current = yield* Ref.get(state);
			const prior = current.processedCommandIds.get(command.commandId);
			if (prior) return { ...prior, replayed: true };
			const prepared = yield* prepareDurableInput(command, command.expectedRevision ?? current.revision);
			const transition = transitionPreparedInput(current, command, prepared);
			yield* Ref.set(state, transition.state);
			if (transition.event) yield* PubSub.publish(events, transition.event);
			yield* dispatchPrepared(command.commandId);
			return transition.receipt;
		}).pipe(
			Effect.matchEffect({
				onFailure: (error) => Deferred.fail(reply, asRunnerFailure(error)),
				onSuccess: (receipt) => Deferred.succeed(reply, receipt),
			}),
			Effect.asVoid,
			Effect.provideService(DurableRunnerStoreService, durableStore),
		);
		yield* enqueue(operation);
		return yield* Deferred.await(reply);
	});

	const inspect = Effect.fn("Runner.inspect")(function* () {
		const reply = yield* Deferred.make<RunnerInspection, RunnerFailure>();
		yield* enqueue(
			loadDurableRunnerSnapshot().pipe(
				Effect.flatMap((snapshot) =>
					Ref.set(state, stateFromSnapshot(snapshot)).pipe(
						Effect.andThen(
							Deferred.succeed(reply, {
								revision: snapshot.revision,
								records: snapshot.records,
								pendingOperations: pending.size,
							}),
						),
					),
				),
				Effect.catch((error) => Deferred.fail(reply, error)),
				Effect.asVoid,
				Effect.provideService(DurableRunnerStoreService, durableStore),
			),
		);
		return yield* Deferred.await(reply);
	});

	const subscribe = Effect.fn("Runner.subscribe")(function* () {
		const subscription = yield* PubSub.subscribe(events);
		const snapshot = yield* loadDurableRunnerSnapshot().pipe(
			Effect.provideService(DurableRunnerStoreService, durableStore),
		);
		let nextRevision = snapshot.revision + 1;
		let takeNext!: Effect.Effect<RunnerEventDelivery>;
		takeNext = Effect.suspend(() =>
			PubSub.take(subscription).pipe(
				Effect.flatMap((event): Effect.Effect<RunnerEventDelivery> => {
					if (event.revision < nextRevision) return takeNext;
					if (event.revision !== nextRevision) {
						const expectedRevision = nextRevision;
						nextRevision = event.revision + 1;
						return Effect.succeed({
							kind: "resyncRequired",
							expectedRevision,
							observedRevision: event.revision,
							event,
						});
					}
					nextRevision++;
					return Effect.succeed({ kind: "event", event });
				}),
			),
		);
		return { take: takeNext };
	});

	return { submitInput, inspect, subscribe };
});
