import { describe, expect, it } from "bun:test"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { ProviderStreamError } from "../src/errors"
import type { TimedProviderEvent } from "../src/protocol"
import { makeScriptedProvider, scriptedFrames, type ScriptedInteraction } from "../src/scripted"
import { exampleRequest, exampleSteps } from "./support/fixtures"

const partialSteps = exampleSteps.slice(0, 8)

const rateLimited: ScriptedInteraction = {
  name: "rate-limited",
  when: (_request, options) => options.variant === "rate-limited",
  steps: exampleSteps.slice(0, 3),
  terminal: {
    kind: "error",
    error: new ProviderStreamError({
      code: "rate_limit",
      retryable: true,
      message: "provider is rate limiting this route",
      statusHint: 429,
      retryAfterMs: 2000,
    }),
  },
}

const truncatedToolCall: ScriptedInteraction = {
  name: "truncated-tool-call",
  when: (_request, options) => options.variant === "truncated",
  // Stops in the middle of the tool-argument fragments.
  steps: partialSteps,
  terminal: {
    kind: "error",
    error: new ProviderStreamError({ code: "stream_disconnected", retryable: true, message: "transport closed" }),
  },
}

const hanging: ScriptedInteraction = {
  name: "hangs",
  when: (_request, options) => options.variant === "hangs",
  steps: exampleSteps.slice(0, 2),
  terminal: { kind: "hang" },
}

const provider = makeScriptedProvider({
  scriptId: "scripted-tests",
  interactions: [rateLimited, truncatedToolCall, hanging],
})

describe("ScriptedProvider", () => {
  it("delivers a mid-stream typed error after its authored prefix", async () => {
    const observed: TimedProviderEvent[] = []
    const exit = await Effect.runPromiseExit(
      Stream.runForEach(provider.stream(exampleRequest(), { variant: "rate-limited" }), frame =>
        Effect.sync(() => {
          observed.push(frame)
        }),
      ),
    )

    expect(observed).toHaveLength(3)
    expect(observed[0]?.event.type).toBe("response.started")
    expect(exit._tag).toBe("Failure")
    const rendered = JSON.stringify(exit)
    expect(rendered).toContain("ProviderStreamError")
    expect(rendered).toContain("rate_limit")
    expect(rendered).toContain('"retryable":true')
  })

  it("can end mid tool-call so a consumer never sees complete arguments", async () => {
    const observed: TimedProviderEvent[] = []
    const exit = await Effect.runPromiseExit(
      Stream.runForEach(provider.stream(exampleRequest(), { variant: "truncated" }), frame =>
        Effect.sync(() => {
          observed.push(frame)
        }),
      ),
    )

    expect(exit._tag).toBe("Failure")
    expect(observed.some(frame => frame.event.type === "tool.call.arguments.delta")).toBe(true)
    expect(observed.some(frame => frame.event.type === "tool.call.completed")).toBe(false)
  })

  it("holds a stream open so real cancellation can be observed", async () => {
    const observed: TimedProviderEvent[] = []
    let finalized = false

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* Deferred.make<void>()
        const fiber = yield* Effect.forkChild(
          provider.stream(exampleRequest(), { variant: "hangs" }).pipe(
            Stream.ensuring(
              Effect.sync(() => {
                finalized = true
              }),
            ),
            Stream.runForEach(frame =>
              Effect.suspend(() => {
                observed.push(frame)
                return observed.length === 1 ? Deferred.succeed(first, undefined) : Effect.void
              }),
            ),
          ),
        )
        yield* Deferred.await(first)
        yield* Fiber.interrupt(fiber)
        return yield* Fiber.await(fiber)
      }).pipe(Effect.scoped),
    )

    expect(exit._tag).toBe("Failure")
    expect(finalized).toBe(true)
    expect(observed.length).toBeGreaterThanOrEqual(1)
    expect(observed.length).toBeLessThanOrEqual(2)
  })

  it("fails closed when no interaction, or more than one, matches", async () => {
    const noMatch = await Effect.runPromiseExit(
      Stream.runCollect(provider.stream(exampleRequest(), { variant: "never-authored" })),
    )
    expect(noMatch._tag).toBe("Failure")
    expect(JSON.stringify(noMatch)).toContain("ScriptedNoMatchError")

    const overlapping = makeScriptedProvider({
      scriptId: "overlapping",
      interactions: [
        { name: "a", when: () => true, steps: exampleSteps, terminal: { kind: "complete" } },
        { name: "b", when: () => true, steps: exampleSteps, terminal: { kind: "complete" } },
      ],
    })
    const ambiguous = await Effect.runPromiseExit(Stream.runCollect(overlapping.stream(exampleRequest())))
    expect(ambiguous._tag).toBe("Failure")
    expect(JSON.stringify(ambiguous)).toContain('"matchCount":2')
  })

  it("derives elapsed time from the script, not the wall clock", () => {
    const first = scriptedFrames(exampleSteps)
    const second = scriptedFrames(exampleSteps)
    expect(first).toEqual(second as TimedProviderEvent[])
    expect(first[0]?.elapsedMs).toBe(0)
    expect(first[1]?.elapsedMs).toBe(15)
  })
})
