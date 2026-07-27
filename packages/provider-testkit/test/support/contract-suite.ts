import { expect, it } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { validateFrames } from "../../src/cassette"
import type { ProviderRequest, TimedProviderEvent } from "../../src/protocol"
import { Provider, type ProviderStreamOptions } from "../../src/provider"

/**
 * A provider arm under test. Every implementation must satisfy the same
 * contract, which is what licenses swapping them in a product's Layer wiring.
 */
export interface ContractArm {
  readonly name: string
  readonly layer: Layer.Layer<Provider>
  /** A request the arm can serve to completion. */
  readonly successRequest: ProviderRequest
  readonly successOptions?: ProviderStreamOptions
  /** A request the arm must refuse. No arm may invent a plausible answer. */
  readonly unservableRequest: ProviderRequest
  readonly unservableOptions?: ProviderStreamOptions
  /** Tags this arm is allowed to fail an unservable request with. */
  readonly unservableTags: readonly string[]
}

const collect = (arm: ContractArm, request: ProviderRequest, options?: ProviderStreamOptions) =>
  Effect.gen(function* () {
    const provider = yield* Provider
    return yield* Stream.runCollect(provider.stream(request, options))
  }).pipe(Effect.provide(arm.layer))

/**
 * The shared contract. These assertions are deliberately behavioral: none of
 * them looks at call counts, internal call order, or provider prose.
 */
export const runProviderContract = (arm: ContractArm): void => {
  it(`${arm.name}: emits a legal, terminated event sequence`, async () => {
    const frames = (await Effect.runPromise(collect(arm, arm.successRequest, arm.successOptions))) as readonly TimedProviderEvent[]

    expect(frames.length).toBeGreaterThan(0)
    expect(validateFrames(frames)).toBeUndefined()
    expect(frames[0]?.event.type).toBe("response.started")
    expect(frames[frames.length - 1]?.event.type).toBe("response.completed")
  })

  it(`${arm.name}: never surfaces cassette-only terminal records to a consumer`, async () => {
    const frames = (await Effect.runPromise(collect(arm, arm.successRequest, arm.successOptions))) as readonly TimedProviderEvent[]
    const leaked = frames.filter(
      frame => frame.event.type === "response.error" || frame.event.type === "response.interrupted",
    )
    expect(leaked).toEqual([])
  })

  it(`${arm.name}: reassembles fragmented tool arguments byte-exactly`, async () => {
    const frames = (await Effect.runPromise(collect(arm, arm.successRequest, arm.successOptions))) as readonly TimedProviderEvent[]
    const buffers: Record<string, string> = {}
    let completions = 0
    for (const frame of frames) {
      if (frame.event.type === "tool.call.started") buffers[frame.event.callId] = ""
      if (frame.event.type === "tool.call.arguments.delta") {
        buffers[frame.event.callId] = `${buffers[frame.event.callId] ?? ""}${frame.event.fragment}`
      }
      if (frame.event.type === "tool.call.completed") {
        completions++
        expect(buffers[frame.event.callId]).toBe(frame.event.argumentsJson)
        expect(() => JSON.parse(frame.event.type === "tool.call.completed" ? frame.event.argumentsJson : "")).not.toThrow()
      }
    }
    expect(completions).toBeGreaterThan(0)
  })

  it(`${arm.name}: fails closed on an unservable request and emits nothing`, async () => {
    const observed: TimedProviderEvent[] = []
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const provider = yield* Provider
        yield* Stream.runForEach(provider.stream(arm.unservableRequest, arm.unservableOptions), frame =>
          Effect.sync(() => {
            observed.push(frame)
          }),
        )
      }).pipe(Effect.provide(arm.layer)),
    )

    expect(exit._tag).toBe("Failure")
    expect(observed).toEqual([])
    const failure = exit._tag === "Failure" ? exit.cause : undefined
    const tag = JSON.stringify(failure)
    expect(arm.unservableTags.some(candidate => tag.includes(candidate))).toBe(true)
  })

  it(`${arm.name}: interrupting the consumer stops delivery and finalizes`, async () => {
    const observed: TimedProviderEvent[] = []
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* Provider
        // Accept exactly one frame, then hang: the fiber can only leave this
        // stream by being interrupted, which is what we want to observe.
        const reachedFirstFrame = yield* Deferred.make<void>()
        const fiber = yield* Effect.forkChild(
          Stream.runForEach(provider.stream(arm.successRequest, arm.successOptions), frame =>
            Effect.suspend(() => {
              observed.push(frame)
              return Effect.flatMap(Deferred.succeed(reachedFirstFrame, undefined), () => Effect.never)
            }),
          ),
        )
        yield* Deferred.await(reachedFirstFrame)
        yield* Fiber.interrupt(fiber)
        return yield* Fiber.await(fiber)
      }).pipe(Effect.provide(arm.layer), Effect.scoped),
    )

    expect(exit._tag).toBe("Failure")
    expect(observed).toHaveLength(1)
    expect(observed[0]?.event.type).toBe("response.started")
  })
}
