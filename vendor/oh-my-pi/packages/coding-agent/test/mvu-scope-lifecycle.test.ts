import { describe, expect, it } from "bun:test";
import { Deferred, Effect, Exit, Queue, Scope, Stream, SubscriptionRef } from "effect";
import * as Schema from "effect/Schema";
import {
	makeComponentId,
	RouteStampSchema,
	type RouteStamp,
	type SourceEnvelope,
} from "../src/modes/mvu/schema";
import { mountMvuRuntime } from "../src/modes/mvu/runtime";

type Message =
	| { readonly _tag: "Result"; readonly value: string }
	| { readonly _tag: "Advance"; readonly stamp: RouteStamp };
type Model = { readonly values: readonly string[]; readonly stamp: RouteStamp };

const RouteStampTypeSchema = Schema.toType(RouteStampSchema);
const MessageSchema: Schema.ConstraintDecoder<Message, never> = Schema.toType(
	Schema.Union([
		Schema.Struct({ _tag: Schema.Literal("Result"), value: Schema.String }),
		Schema.Struct({
			_tag: Schema.Literal("Advance"),
			stamp: RouteStampTypeSchema,
		}),
	]),
);

const runIn = <A, E>(scope: Scope.Scope, effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
	Effect.runPromise(Scope.provide(scope)(effect));

describe("MVU scope lifecycle", () => {
	it("fences live stale generations, interrupts sources, and closes every runtime queue", async () => {
		const scope = Scope.makeUnsafe("sequential");
		const sourceQueue = await Effect.runPromise(Queue.bounded<SourceEnvelope<Message>>(2));
		const sourceInterrupted = await Effect.runPromise(Deferred.make<void>());
		const stamp: RouteStamp = {
			componentId: makeComponentId("scope-lifecycle"),
			leaseGeneration: 1,
			sourceRevision: 1,
			requestGeneration: 1,
		};
		const runtime = await runIn(
			scope,
			mountMvuRuntime<Model, Message, never, never>({
				componentId: stamp.componentId,
				initialModel: { values: [], stamp },
				update: (model, message) =>
					message._tag === "Advance"
						? { model: { ...model, stamp: message.stamp }, commands: [], dirtyKeys: new Set() }
						: {
								model: { ...model, values: [...model.values, message.value] },
								commands: [],
								dirtyKeys: new Set([message.value]),
							},
				interpret: () => Effect.succeed([]),
				boundary: {
					messageSchema: MessageSchema,
					currentStamp: model => model.stamp,
				},
				sources: [
					Stream.fromQueue(sourceQueue).pipe(
						Stream.ensuring(Deferred.succeed(sourceInterrupted, undefined).pipe(Effect.asVoid)),
					),
				],
				inputToMessage: () => ({ _tag: "Result", value: "input" }),
				inputCapacity: 1,
				messageCapacity: 2,
				commandCapacity: 1,
			}),
		);

		await runIn(scope, Queue.offer(sourceQueue, {
			_tag: "MvuSource",
			stamp,
			message: { _tag: "Result", value: "live" },
		}));
		await runIn(scope, Effect.sleep("20 millis"));
		expect((await runIn(scope, SubscriptionRef.get(runtime.model))).values).toEqual(["live"]);

		const nextStamp = { ...stamp, requestGeneration: 2 };
		await runIn(scope, runtime.dispatch({ _tag: "Advance", stamp: nextStamp }));
		await runIn(scope, Queue.offer(sourceQueue, {
			_tag: "MvuSource",
			stamp,
			message: { _tag: "Result", value: "stale" },
		}));
		await runIn(scope, Effect.sleep("20 millis"));
		const beforeClose = await runIn(scope, SubscriptionRef.get(runtime.model));
		expect(beforeClose.values).toEqual(["live"]);
		expect(beforeClose.stamp).toEqual(nextStamp);
		expect(await Effect.runPromise(Deferred.isDone(sourceInterrupted))).toBe(false);

		await Effect.runPromise(Scope.close(scope, Exit.void));
		expect(await Effect.runPromise(Deferred.isDone(sourceInterrupted))).toBe(true);

		const dispatchExit = await Effect.runPromise(Effect.exit(runtime.dispatch({ _tag: "Result", value: "late" })));
		const inputExit = await Effect.runPromise(
			Effect.exit(runtime.dispatchInput({ _tag: "Paste", text: "late" })),
		);
		expect(Exit.isFailure(dispatchExit)).toBe(true);
		expect(Exit.isFailure(inputExit)).toBe(true);
		expect(await Effect.runPromise(SubscriptionRef.get(runtime.model))).toEqual(beforeClose);
	});
});
