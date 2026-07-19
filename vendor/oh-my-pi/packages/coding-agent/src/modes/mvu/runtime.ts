import { Deferred, Effect, Queue, Scope, Stream, SubscriptionRef } from "effect";
import * as Schema from "effect/Schema";
import {
	makeSourceEnvelopeSchema,
	type ComponentId,
	type KeyEvent,
	type RouteStamp,
	type SourceEnvelope,
	type Transition,
	type Update,
} from "./schema";

export interface MvuRuntimeBoundary<Model, Msg, Command> {
	readonly messageSchema: Schema.ConstraintDecoder<Msg, never>;
	currentStamp(model: Model): RouteStamp;
	commandStamp?(command: Command): RouteStamp | undefined;
}

export interface MvuRuntimeConfig<Model, Msg, Command, R> {
	readonly componentId: ComponentId;
	readonly initialModel: Model;
	readonly update: Update<Model, Msg, Command>;
	readonly interpret: (
		command: Command,
	) => Effect.Effect<readonly (Msg | SourceEnvelope<Msg>)[], never, R>;
	readonly sources?: readonly Stream.Stream<SourceEnvelope<Msg>, never, R>[];
	readonly boundary?: MvuRuntimeBoundary<Model, Msg, Command>;
	readonly inputCapacity: number;
	readonly messageCapacity: number;
	readonly commandCapacity: number;
	/** Optional conversion for callers that dispatch terminal events directly. */
	readonly inputToMessage?: (event: KeyEvent) => Msg;
}

export interface MvuRuntime<Model, Msg> {
	readonly model: SubscriptionRef.SubscriptionRef<Model>;
	dispatch(msg: Msg): Effect.Effect<void>;
	/** Enqueues a local message and completes only after its reducer commit. */
	dispatchCommitted(msg: Msg): Effect.Effect<void>;
	dispatchSource(envelope: SourceEnvelope<Msg>): Effect.Effect<void>;
	dispatchInput(event: KeyEvent): Effect.Effect<void>;
}

function bounded<A>(capacity: number): Effect.Effect<Queue.Queue<A>, never> {
	if (capacity <= 0 || !Number.isSafeInteger(capacity)) {
		return Effect.die(new RangeError(`MVU queue capacity must be a positive integer: ${capacity}`));
	}
	return Queue.bounded<A>(capacity);
}

/**
 * Mounts one serialized reducer and its scoped source/command workers.
 *
 * All input, source, and command-result messages converge on `messageQueue`.
 * The reducer is the sole consumer and commits exactly once before it exposes
 * any declarative command to the command worker.
 */
export const mountMvuRuntime = <Model, Msg, Command, R>(
	config: MvuRuntimeConfig<Model, Msg, Command, R>,
): Effect.Effect<MvuRuntime<Model, Msg>, never, R | Scope.Scope> =>
	Effect.gen(function* () {
		type RuntimeMessage =
			| {
					readonly _tag: "Local";
					readonly message: Msg;
					readonly committed?: Deferred.Deferred<void>;
			  }
			| { readonly _tag: "External"; readonly envelope: SourceEnvelope<Msg> };

		const inputQueue = yield* bounded<KeyEvent>(config.inputCapacity);
		const messageQueue = yield* bounded<RuntimeMessage>(config.messageCapacity);
		const commandQueue = yield* bounded<Command>(config.commandCapacity);
		const model = yield* SubscriptionRef.make(config.initialModel);
		const envelopeSchema =
			config.boundary === undefined ? undefined : makeSourceEnvelopeSchema(config.boundary.messageSchema);

		const offer = <A>(queue: Queue.Queue<A>, value: A): Effect.Effect<void> =>
			Queue.offer(queue, value).pipe(
				Effect.flatMap(accepted => (accepted ? Effect.void : Effect.interrupt)),
			);
		const offerAll = <A>(queue: Queue.Queue<A>, values: Iterable<A>): Effect.Effect<void> =>
			Effect.forEach(values, value => offer(queue, value), { discard: true });
		const decodeExternal = (
			candidate: Msg | SourceEnvelope<Msg>,
			fallbackStamp?: RouteStamp,
		): Effect.Effect<SourceEnvelope<Msg> | undefined> =>
			Effect.gen(function* () {
				if (envelopeSchema === undefined || config.boundary === undefined) {
					return yield* Effect.die(new Error("MVU external results require a schema and RouteStamp boundary"));
				}
				let envelope: SourceEnvelope<Msg>;
				try {
					envelope = Schema.decodeUnknownSync(envelopeSchema)(candidate, {
						onExcessProperty: "error",
					});
				} catch {
					if (fallbackStamp === undefined) return undefined;
					let message: Msg;
					try {
						message = Schema.decodeUnknownSync(config.boundary.messageSchema)(candidate, {
							onExcessProperty: "error",
						});
					} catch {
						return undefined;
					}
					envelope = { _tag: "MvuSource", stamp: fallbackStamp, message };
				}
				const current = yield* SubscriptionRef.get(model);
				const currentStamp = config.boundary.currentStamp(current);
				return envelope.stamp.componentId === config.componentId && sameRouteStamp(envelope.stamp, currentStamp)
					? envelope
					: undefined;
			});
		const enqueueExternal = (
			candidate: Msg | SourceEnvelope<Msg>,
			fallbackStamp?: RouteStamp,
		): Effect.Effect<void> =>
			decodeExternal(candidate, fallbackStamp).pipe(
				Effect.flatMap(envelope =>
					envelope === undefined ? Effect.void : offer(messageQueue, { _tag: "External", envelope }),
				),
			);

		yield* Stream.runForEach(Stream.fromQueue(messageQueue), queued =>
			Effect.gen(function* () {
				const current = yield* SubscriptionRef.get(model);
				if (queued._tag === "External") {
					const boundary = config.boundary;
					if (
						boundary === undefined ||
						!sameRouteStamp(queued.envelope.stamp, boundary.currentStamp(current))
					) {
						return;
					}
				}
				const message = queued._tag === "Local" ? queued.message : queued.envelope.message;
				const transition: Transition<Model, Command> = config.update(current, message);
				yield* SubscriptionRef.set(model, transition.model);
				if (queued._tag === "Local" && queued.committed !== undefined) {
					yield* Deferred.succeed(queued.committed, undefined);
				}
				yield* offerAll(commandQueue, transition.commands);
			}),
		).pipe(Effect.forkScoped);

		const inputToMessage = config.inputToMessage ?? ((event: KeyEvent) => event as Msg);
		yield* Stream.runForEach(Stream.fromQueue(inputQueue), event =>
			offer(messageQueue, { _tag: "Local", message: inputToMessage(event) }),
		).pipe(Effect.forkScoped);

		yield* Stream.runForEach(Stream.fromQueue(commandQueue), command =>
			Effect.gen(function* () {
				const boundary = config.boundary;
				const commandStamp = boundary?.commandStamp?.(command);
				if (boundary !== undefined && commandStamp !== undefined) {
					const current = yield* SubscriptionRef.get(model);
					if (!sameRouteStamp(commandStamp, boundary.currentStamp(current))) return;
				}
				const interpreted =
					boundary === undefined || commandStamp === undefined
						? config.interpret(command)
						: Effect.race(
								config.interpret(command),
								Stream.runHead(
									SubscriptionRef.changes(model).pipe(
										Stream.filter(
											current =>
												!sameRouteStamp(commandStamp, boundary.currentStamp(current)),
										),
									),
								).pipe(Effect.as([] as readonly (Msg | SourceEnvelope<Msg>)[])),
							);
				const messages = yield* interpreted;
				yield* Effect.forEach(messages, message => enqueueExternal(message, commandStamp), { discard: true });
			}),
		).pipe(Effect.forkScoped);

		for (const source of config.sources ?? []) {
			yield* Stream.runForEach(source, enqueueExternal).pipe(Effect.forkScoped({ startImmediately: true }));
		}

		yield* Effect.addFinalizer(() =>
			Queue.shutdown(inputQueue).pipe(
				Effect.andThen(Queue.shutdown(messageQueue)),
				Effect.andThen(Queue.shutdown(commandQueue)),
				Effect.asVoid,
			),
		);

		const dispatch = (message: Msg): Effect.Effect<void> =>
			offer(messageQueue, { _tag: "Local", message });
		const dispatchCommitted = (message: Msg): Effect.Effect<void> =>
			Effect.gen(function* () {
				const committed = yield* Deferred.make<void>();
				yield* offer(messageQueue, { _tag: "Local", message, committed });
				yield* Deferred.await(committed);
			});
		const dispatchSource = (envelope: SourceEnvelope<Msg>): Effect.Effect<void> =>
			enqueueExternal(envelope);
		const dispatchInput = (event: KeyEvent): Effect.Effect<void> => offer(inputQueue, event);

		return { model, dispatch, dispatchCommitted, dispatchSource, dispatchInput } satisfies MvuRuntime<Model, Msg>;
	});

/**
 * Route-stamp comparison used by mount adapters before forwarding results.
 * Keeping the comparison here makes every route use the same fence semantics.
 */
export const sameRouteStamp = (left: RouteStamp, right: RouteStamp): boolean =>
	left.componentId === right.componentId &&
	left.leaseGeneration === right.leaseGeneration &&
	left.sourceRevision === right.sourceRevision &&
	left.requestGeneration === right.requestGeneration;
