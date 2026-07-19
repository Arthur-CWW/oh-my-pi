import { describe, expect, it } from "bun:test";
import { Effect, Exit, Queue, Scope, Stream, SubscriptionRef } from "effect";
import * as Schema from "effect/Schema";
import {
	makeComponentId,
	type RouteStamp,
	type SourceEnvelope,
	type Transition,
} from "../src/modes/mvu/schema";
import { mountMvuRuntime, type MvuRuntimeConfig } from "../src/modes/mvu/runtime";

type Message =
	| { readonly kind: "input"; readonly id: string }
	| { readonly kind: "source"; readonly id: string }
	| { readonly kind: "receipt"; readonly id: string };

const MessageSchema: Schema.ConstraintDecoder<Message, never> = Schema.toType(
	Schema.Union([
		Schema.Struct({ kind: Schema.Literal("input"), id: Schema.String }),
		Schema.Struct({ kind: Schema.Literal("source"), id: Schema.String }),
		Schema.Struct({ kind: Schema.Literal("receipt"), id: Schema.String }),
	]),
);

type Command = { readonly id: string };
type Model = { readonly events: readonly string[] };

const runIn = <A, E>(scope: Scope.Scope, effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
	Effect.runPromise(Scope.provide(scope)(effect));

const transition = (model: Model, message: Message, trace: string[]): Transition<Model, Command> => {
	trace.push(`update:${message.kind}:${message.id}`);
	return {
		model: { events: [...model.events, `${message.kind}:${message.id}`] },
		commands: message.kind === "input" ? [{ id: message.id }] : [],
		dirtyKeys: new Set([message.id]),
	};
};

describe("MVU runtime ordering", () => {
	it("serializes interleaved input/source messages and commits before command interpretation", async () => {
		const scope = Scope.makeUnsafe("sequential");
		const stamp: RouteStamp = {
			componentId: makeComponentId("runtime-order"),
			leaseGeneration: 1,
			sourceRevision: 1,
			requestGeneration: 1,
		};
		const sourceQueue = await Effect.runPromise(Queue.bounded<SourceEnvelope<Message>>(8));
		const trace: string[] = [];
		const config: MvuRuntimeConfig<Model, Message, Command, never> = {
			componentId: stamp.componentId,
			initialModel: { events: [] },
			update: (model, message) => transition(model, message, trace),
			boundary: {
				messageSchema: MessageSchema,
				currentStamp: () => stamp,
				commandStamp: () => stamp,
			},
			interpret: command =>
				Effect.sync(() => {
					trace.push(`interpret:${command.id}`);
					return [
						{ kind: "receipt", id: `${command.id}-bare` },
						{
							_tag: "MvuSource",
							stamp,
							message: { kind: "receipt", id: command.id },
						} satisfies SourceEnvelope<Message>,
						{
							_tag: "MvuSource",
							stamp: { ...stamp, requestGeneration: stamp.requestGeneration + 1 },
							message: { kind: "receipt", id: `${command.id}-stale` },
						} satisfies SourceEnvelope<Message>,
					];
				}),
			sources: [Stream.fromQueue(sourceQueue)],
			inputCapacity: 2,
			messageCapacity: 4,
			commandCapacity: 2,
		};
		const runtime = await runIn(scope, mountMvuRuntime(config));

		await runIn(scope, runtime.dispatch({ kind: "input", id: "a" }));
		await runIn(scope, Queue.offer(sourceQueue, {
			_tag: "MvuSource",
			stamp,
			message: { kind: "source", id: "b" },
		}));
		await runIn(scope, runtime.dispatch({ kind: "input", id: "c" }));
		await runIn(scope, Effect.sleep("25 millis"));

		const live = await runIn(scope, SubscriptionRef.get(runtime.model));
		const replay: Model = trace.reduce<Model>((model, entry) => {
			if (!entry.startsWith("update:")) return model;
			const [kind, id] = entry.slice("update:".length).split(":");
			if (
				id === undefined ||
				(kind !== "input" && kind !== "source" && kind !== "receipt")
			) {
				throw new Error(`Invalid update trace entry: ${entry}`);
			}
			const message: Message = { kind, id };
			return transition(model, message, []).model;
		}, { events: [] });
		expect(live).toEqual(replay);
		expect(trace.findIndex(entry => entry === "update:input:a")).toBeLessThan(
			trace.findIndex(entry => entry === "interpret:a"),
		);
		expect(live.events).toContain("receipt:a");
		expect(live.events).toContain("receipt:a-bare");
		expect(live.events).not.toContain("receipt:a-stale");
		await Effect.runPromise(Scope.close(scope, Exit.void));
	});
});
