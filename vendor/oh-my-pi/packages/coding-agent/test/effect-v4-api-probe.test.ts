import { describe, expect, it } from "bun:test";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Queue, Schedule, Schema } from "effect";
import { TestClock } from "effect/testing";

class ProbeFailure extends Schema.TaggedErrorClass<ProbeFailure>()("EffectV4ApiProbeFailure", {
	message: Schema.String,
}) {}

class ProbeService extends Context.Service<
	ProbeService,
	{
		readonly double: (value: number) => Effect.Effect<number, ProbeFailure>;
	}
>()("@oh-my-pi/coding-agent/EffectV4ApiProbe") {
	static readonly layer = Layer.succeed(
		ProbeService,
		ProbeService.of({
			double: Effect.fn("EffectV4ApiProbe.double")(function* (value: number) {
				if (value < 0) {
					return yield* new ProbeFailure({ message: "value must be non-negative" });
				}
				return value * 2;
			}),
		}),
	);
}

const double = Effect.fn("EffectV4ApiProbe.useService")(function* (value: number) {
	const service = yield* ProbeService;
	return yield* service.double(value);
});

describe("Effect v4 beta.92 API probe", () => {
	it("provides a service through a Layer and preserves tagged failures", async () => {
		const success = await Effect.runPromise(double(21).pipe(Effect.provide(ProbeService.layer)));
		const failure = await Effect.runPromise(Effect.flip(double(-1).pipe(Effect.provide(ProbeService.layer))));

		expect(success).toBe(42);
		expect(failure).toBeInstanceOf(ProbeFailure);
		expect(failure).toMatchObject({
			_tag: "EffectV4ApiProbeFailure",
			message: "value must be non-negative",
		});
	});

	it("releases a scoped resource exactly once when interrupted", async () => {
		let releases = 0;
		const exit = await Effect.runPromise(
			Effect.exit(
				Effect.scoped(
					Effect.gen(function* () {
						yield* Effect.acquireRelease(Effect.succeed("resource"), () =>
							Effect.sync(() => {
								releases += 1;
							}),
						);
						yield* Effect.interrupt;
					}),
				),
			),
		);

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			expect(Cause.hasInterrupts(exit.cause)).toBe(true);
		}
		expect(releases).toBe(1);
	});

	it("interrupts a started child when its scope closes", async () => {
		const childInterrupted = await Effect.runPromise(
			Effect.gen(function* () {
				const interrupted = yield* Deferred.make<void>();
				yield* Effect.scoped(
					Effect.gen(function* () {
						yield* Effect.forkScoped(
							Effect.never.pipe(
								Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid)),
							),
							{ startImmediately: true },
						);
						yield* Effect.yieldNow;
					}),
				);
				return yield* Deferred.await(interrupted);
			}),
		);

		expect(childInterrupted).toBeUndefined();
	});

	it("suspends a producer at bounded queue capacity until a consumer takes", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const queue = yield* Queue.bounded<number>(1);
				const published = yield* Deferred.make<void>();
				yield* Queue.offer(queue, 1);
				const producer = yield* Effect.forkChild(
					Queue.offer(queue, 2).pipe(Effect.andThen(Deferred.succeed(published, undefined))),
					{ startImmediately: true },
				);
				yield* Effect.yieldNow;
				const blockedBeforeTake = !(yield* Deferred.isDone(published));
				const first = yield* Queue.take(queue);
				yield* Fiber.join(producer);
				const second = yield* Queue.take(queue);
				return { blockedBeforeTake, first, second };
			}),
		);

		expect(result).toEqual({ blockedBeforeTake: true, first: 1, second: 2 });
	});

	it("advances a scheduled repetition only when the TestClock reaches its deadline", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const attempts: Array<number> = [];
				const repeated = Effect.sync(() => {
					attempts.push(attempts.length + 1);
				}).pipe(
					Effect.repeat(Schedule.both(Schedule.spaced("1 second"), Schedule.recurs(1))),
				);
				const fiber = yield* Effect.forkChild(repeated, { startImmediately: true });
				yield* Effect.yieldNow;
				const beforeDeadline = attempts.length;
				yield* TestClock.adjust("999 millis");
				const beforeExactDeadline = attempts.length;
				yield* TestClock.adjust("1 millis");
				yield* Fiber.join(fiber);
				return { attempts, beforeDeadline, beforeExactDeadline };
			}).pipe(Effect.provide(TestClock.layer())),
		);

		expect(result).toEqual({ attempts: [1, 2], beforeDeadline: 1, beforeExactDeadline: 1 });
	});
});
