import { describe, expect, it } from "bun:test";
import { Cause, Clock, Context, Deferred, Duration, Effect, Exit, Fiber, Layer, Option, PubSub, Queue, Schedule, Schema, Semaphore } from "effect";
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

	it("does not run a dropped lazy effect until the returned effect is executed", async () => {
		let runs = 0;
		const program = Effect.gen(function* () {
			const dropped = Effect.sync(() => {
				runs += 1;
			});
			void dropped;
			return "done";
		});

		expect(await Effect.runPromise(program)).toBe("done");
		expect(runs).toBe(0);
		await Effect.runPromise(
			Effect.sync(() => {
				runs += 1;
			}),
		);
		expect(runs).toBe(1);
	});

	it("runs an interruption finalizer once under double interruption", async () => {
		const finalizations = await Effect.runPromise(
			Effect.gen(function* () {
				let finalizations = 0;
				const fiber = yield* Effect.forkChild(
					Effect.uninterruptibleMask((restore) =>
						restore(Effect.never).pipe(
							Effect.ensuring(
								Effect.uninterruptibleMask(() =>
									Effect.sync(() => {
										finalizations += 1;
									}),
								),
						),
						),
					),
					{ startImmediately: true },
				);
				yield* Effect.yieldNow;
				yield* Fiber.interrupt(fiber);
				yield* Fiber.interrupt(fiber);
				return finalizations;
			}),
		);

		expect(finalizations).toBe(1);
	});

	it("releases two interrupted resources in LIFO order", async () => {
		const releaseOrder: Array<string> = [];
		const exit = await Effect.runPromise(
			Effect.exit(
				Effect.scoped(
					Effect.gen(function* () {
						yield* Effect.acquireRelease(Effect.succeed("outer"), () =>
							Effect.sync(() => {
								releaseOrder.push("outer");
							}),
						);
						yield* Effect.acquireRelease(Effect.succeed("inner"), () =>
							Effect.sync(() => {
								releaseOrder.push("inner");
							}),
						);
						yield* Effect.interrupt;
					}),
				),
			),
		);

		expect(Exit.isFailure(exit)).toBe(true);
		expect(releaseOrder).toEqual(["inner", "outer"]);
	});

	it("delivers one published value to two PubSub subscribers", async () => {
		const values = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const pubsub = yield* PubSub.unbounded<number>();
					const first = yield* PubSub.subscribe(pubsub);
					const second = yield* PubSub.subscribe(pubsub);
					yield* PubSub.publish(pubsub, 42);
					return [yield* PubSub.take(first), yield* PubSub.take(second)];
				}),
			),
		);

		expect(values).toEqual([42, 42]);
	});

	it("uses two alternative layers for one service contract", async () => {
		const increment = Layer.succeed(
			ProbeService,
			ProbeService.of({
				double: (value) => Effect.succeed(value + 1),
			}),
		);
		const decrement = Layer.succeed(
			ProbeService,
			ProbeService.of({
				double: (value) => Effect.succeed(value - 1),
			}),
		);
		const values = await Promise.all([
			Effect.runPromise(double(10).pipe(Effect.provide(increment))),
			Effect.runPromise(double(10).pipe(Effect.provide(decrement))),
		]);

		expect(values).toEqual([11, 9]);
	});

	it("retries according to an exponential schedule under virtual time", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				let attempts = 0;
				const retryPolicy = Schedule.exponential("100 millis").pipe(
					Schedule.jittered,
					Schedule.modifyDelay((_output, delay) =>
						Effect.succeed(Duration.millis(Math.min(Duration.toMillis(delay), 200))),
					),
					Schedule.both(Schedule.recurs(2)),
				);
				const retrying = Effect.exit(
					Effect.fail(new ProbeFailure({ message: "retry" })).pipe(
						Effect.tapError(() =>
							Effect.sync(() => {
								attempts += 1;
							}),
						),
						Effect.retry(retryPolicy),
					),
				);
				const fiber = yield* Effect.forkChild(retrying, { startImmediately: true });
				yield* Effect.yieldNow;
				const beforeAdvance = attempts;
				yield* TestClock.adjust("500 millis");
				const outcome = yield* Fiber.join(fiber);
				return { beforeAdvance, attempts, outcome };
			}).pipe(Effect.provide(TestClock.layer())),
		);

		expect(result.beforeAdvance).toBe(1);
		expect(result.attempts).toBe(3);
		expect(Exit.isFailure(result.outcome)).toBe(true);
	});

	it("blocks a second Semaphore acquisition until the permit is released", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const semaphore = yield* Semaphore.make(1);
				yield* Semaphore.take(semaphore, 1);
				const blocked = yield* Semaphore.withPermitsIfAvailable(
					semaphore,
					1,
					Effect.succeed("acquired"),
				);
				const available = yield* Semaphore.release(semaphore, 1);
				const admitted = yield* Semaphore.withPermitsIfAvailable(
					semaphore,
					1,
					Effect.succeed("acquired"),
				);
				return { blocked, available, admitted };
			}),
		);

		expect(Option.isNone(result.blocked)).toBe(true);
		expect(result.available).toBe(1);
		expect(Option.isSome(result.admitted)).toBe(true);
	});

	it("handles Deferred completion before and after timeout", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const completed = yield* Deferred.make<number>();
				yield* Deferred.succeed(completed, 7);
				const beforeTimeout = yield* Effect.exit(Effect.timeout(Deferred.await(completed), "1 second"));

				const pending = yield* Deferred.make<number>();
				const timeoutFiber = yield* Effect.forkChild(
					Effect.exit(Effect.timeout(Deferred.await(pending), "1 second")),
					{ startImmediately: true },
				);
				yield* Effect.yieldNow;
				yield* TestClock.adjust("1 second");
				const afterTimeout = yield* Fiber.join(timeoutFiber);
				const lateCompletion = yield* Deferred.succeed(pending, 9);
				return { beforeTimeout, afterTimeout, lateCompletion };
			}).pipe(Effect.provide(TestClock.layer())),
		);

		expect(Exit.isSuccess(result.beforeTimeout)).toBe(true);
		if (Exit.isSuccess(result.beforeTimeout)) {
			expect(result.beforeTimeout.value).toBe(7);
		}
		expect(Exit.isFailure(result.afterTimeout)).toBe(true);
		expect(result.lateCompletion).toBe(true);
	});

	it("reads current time through Clock under TestClock", async () => {
		const times = await Effect.runPromise(
			Effect.gen(function* () {
				const initial = yield* Clock.currentTimeMillis;
				yield* TestClock.adjust("250 millis");
				const advanced = yield* Clock.currentTimeMillis;
				return { initial, advanced };
			}).pipe(Effect.provide(TestClock.layer())),
		);

		expect(times).toEqual({ initial: 0, advanced: 250 });
	});
});
