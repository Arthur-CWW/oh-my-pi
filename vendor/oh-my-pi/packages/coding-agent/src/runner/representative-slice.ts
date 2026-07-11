import { Deferred, Effect, PubSub, Queue, Ref, Scope } from "effect";
import { DurableRunnerStoreError, InvalidRunnerCommandError, RunnerRevisionConflictError } from "./errors.js";
import {
	decodeSubmitInputCommand,
	transitionPreparedInput,
	type RunnerCommandReceipt,
	type RunnerEvent,
	type RunnerState,
} from "./protocol.js";
import {
	DurableRunnerStoreService,
	loadDurableRunnerSnapshot,
	prepareDurableInput,
	RunnerProviderService,
} from "./services.js";
import { transitionProviderCompletion } from "./transition.js";

export type RunnerFailure =
	| DurableRunnerStoreError
	| InvalidRunnerCommandError
	| RunnerRevisionConflictError;

export interface RunnerInspection {
	readonly revision: number;
}

export type RunnerEventDelivery =
	| { readonly kind: "event"; readonly event: RunnerEvent }
	| {
			readonly kind: "resyncRequired";
			readonly expectedRevision: number;
			readonly observedRevision: number;
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

/**
 * A deliberately small vertical slice. The queue transports mailbox wakeup IDs;
 * commands and their replies stay in the private pending table until serialized.
 */
export const makeRepresentativeRunner = Effect.fn("Runner.makeRepresentativeRunner")(function* (
	options: RepresentativeRunnerOptions,
) {
	const provider = yield* RunnerProviderService;
	const durableStore = yield* DurableRunnerStoreService;
	const mailbox = yield* Queue.bounded<number>(options.mailboxCapacity);
	const events = yield* PubSub.sliding<RunnerEvent>(options.eventCapacity);
	const durableSnapshot = yield* loadDurableRunnerSnapshot();
	const state = yield* Ref.make<RunnerState>({
		revision: durableSnapshot.revision,
		processedCommandIds: new Map(durableSnapshot.receipts.map((receipt) => [receipt.commandId, receipt])),
	});
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
		const mailboxId = nextMailboxId;
		nextMailboxId += 1;
		yield* Effect.sync(() => pending.set(mailboxId, operation));
		yield* Queue.offer(mailbox, mailboxId);
	});

	const reenterProviderCompletion = Effect.fn("Runner.reenterProviderCompletion")(function* () {
		yield* enqueue(
			Effect.gen(function* () {
				const current = yield* Ref.get(state);
				yield* Ref.set(state, transitionProviderCompletion(current));
			}).pipe(Effect.asVoid),
		);
	});

	const submitInput = Effect.fn("Runner.submitInput")(function* (input: unknown) {
		const command = yield* Effect.try({
			try: () => decodeSubmitInputCommand(input),
			catch: asRunnerFailure,
		});
		const reply = yield* Deferred.make<RunnerCommandReceipt, RunnerFailure>();
		const operation = Effect.gen(function* () {
			const result = yield* Effect.gen(function* () {
				const current = yield* Ref.get(state);
				if (
					!current.processedCommandIds.has(command.commandId) &&
					command.expectedRevision !== undefined &&
					command.expectedRevision !== current.revision
				) {
					return yield* new RunnerRevisionConflictError({
						expectedRevision: command.expectedRevision,
						actualRevision: current.revision,
					});
				}
				const prepared = yield* prepareDurableInput(command, current.revision + 1);
				const transition = yield* Effect.try({
					try: () => transitionPreparedInput(current, command, prepared),
					catch: asRunnerFailure,
				});
				yield* Ref.set(state, transition.state);
				if (transition.event) {
					yield* PubSub.publish(events, transition.event);
					yield* Effect.forkScoped(
						provider.run(prepared).pipe(
							Effect.matchEffect({
								onFailure: () => reenterProviderCompletion(),
								onSuccess: () => reenterProviderCompletion(),
							}),
						),
						{ startImmediately: true },
					);
				}
				return transition.receipt;
			}).pipe(Effect.catch((error) => Deferred.fail(reply, error).pipe(Effect.asVoid)));
			if (result !== undefined) {
				yield* Deferred.succeed(reply, result);
			}
		}).pipe(Effect.provideService(DurableRunnerStoreService, durableStore), Effect.asVoid);
		yield* enqueue(operation);
		return yield* Deferred.await(reply);
	});

	const inspect = Effect.fn("Runner.inspect")(function* () {
		const reply = yield* Deferred.make<RunnerInspection>();
		yield* enqueue(
			Effect.gen(function* () {
				const current = yield* Ref.get(state);
				yield* Deferred.succeed(reply, { revision: current.revision });
			}).pipe(Effect.asVoid),
		);
		return yield* Deferred.await(reply);
	});

	const subscribe = Effect.fn("Runner.subscribe")(function* () {
		const subscription = yield* PubSub.subscribe(events);
		let nextRevision = 1;
		return {
			take: PubSub.take(subscription).pipe(
				Effect.map((event): RunnerEventDelivery => {
					if (event.revision !== nextRevision) {
						const delivery: RunnerEventDelivery = {
							kind: "resyncRequired",
							expectedRevision: nextRevision,
							observedRevision: event.revision,
						};
						nextRevision = event.revision + 1;
						return delivery;
					}
					nextRevision += 1;
					return { kind: "event", event };
				}),
			),
		};
	});

	return { submitInput, inspect, subscribe };
});
