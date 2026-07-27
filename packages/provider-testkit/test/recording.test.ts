import { afterEach, describe, expect, it } from "bun:test"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { requestDigest } from "../src/canonical"
import { loadCassette, sealCassette, writeSealedCassette } from "../src/cassette"
import { ProviderStreamError } from "../src/errors"
import type { TimedProviderEvent } from "../src/protocol"
import { makeMemorySink, makeRecordingProvider } from "../src/recording"
import { DEFAULT_REDACTION_POLICY } from "../src/redaction"
import { makeReplayProvider } from "../src/replay"
import { makeScriptedProvider, type ScriptedInteraction } from "../src/scripted"
import { exampleRequest, exampleSteps } from "./support/fixtures"

const roots: string[] = []

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop() as string, { recursive: true, force: true })
})

const recorderOver = (interaction: ScriptedInteraction) => {
  const sink = makeMemorySink()
  const upstream = makeScriptedProvider({ scriptId: "upstream", interactions: [interaction] })
  return { sink, provider: makeRecordingProvider(upstream, sink, { interactionId: () => "captured" }) }
}

const success: ScriptedInteraction = {
  name: "success",
  when: () => true,
  steps: exampleSteps,
  terminal: { kind: "complete" },
}
const sealedFailureBytes = async (providerCode: string, providerMessage: string): Promise<string> => {
  const { sink, provider } = recorderOver({
    name: "private-failure",
    when: () => true,
    steps: exampleSteps.slice(0, 2),
    terminal: {
      kind: "error",
      error: new ProviderStreamError({
        code: providerCode,
        retryable: true,
        message: providerMessage,
        statusHint: 429,
        retryAfterMs: 2_500,
      }),
    },
  })
  await Effect.runPromiseExit(Stream.runCollect(provider.stream(exampleRequest())))
  const drafts = await Effect.runPromise(sink.drafts)
  const sealed = await Effect.runPromise(
    sealCassette({
      cassetteId: "private-error",
      interactions: drafts,
      policy: DEFAULT_REDACTION_POLICY,
      createdAt: "2026-07-27T00:00:00.000Z",
    }),
  )
  return Array.from(sealed.files.values()).join("")
}

describe("RecordingProvider", () => {
  it("captures the unchanged neutral stream and its request identity", async () => {
    const { sink, provider } = recorderOver(success)
    const request = exampleRequest()

    const observed = (await Effect.runPromise(Stream.runCollect(provider.stream(request)))) as readonly TimedProviderEvent[]
    const drafts = await Effect.runPromise(sink.drafts)

    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.requestDigest).toBe(requestDigest(request))
    expect(drafts[0]?.frames).toEqual(observed as TimedProviderEvent[])
  })

  it("survives the record -> seal -> replay round trip event for event", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-testkit-record-"))
    roots.push(root)
    const { sink, provider } = recorderOver(success)
    const request = exampleRequest()

    const recorded = (await Effect.runPromise(Stream.runCollect(provider.stream(request)))) as readonly TimedProviderEvent[]
    const drafts = await Effect.runPromise(sink.drafts)

    const replayed = await Effect.runPromise(
      Effect.gen(function* () {
        const sealed = yield* sealCassette({
          cassetteId: "round-trip",
          interactions: drafts,
          policy: DEFAULT_REDACTION_POLICY,
          createdAt: "2026-07-27T00:00:00.000Z",
        })
        yield* writeSealedCassette(root, sealed)
        const cassette = yield* loadCassette(root)
        return yield* Stream.runCollect(makeReplayProvider(cassette).stream(request))
      }),
    )

    expect(replayed).toEqual(recorded as TimedProviderEvent[])
  })

  it("records a typed provider failure as the terminal record", async () => {
    const { sink, provider } = recorderOver({
      name: "fails",
      when: () => true,
      steps: exampleSteps.slice(0, 4),
      terminal: {
        kind: "error",
        error: new ProviderStreamError({ code: "overloaded", retryable: true, message: "upstream overloaded" }),
      },
    })

    const exit = await Effect.runPromiseExit(Stream.runCollect(provider.stream(exampleRequest())))
    expect(exit._tag).toBe("Failure")

    const drafts = await Effect.runPromise(sink.drafts)
    const frames = drafts[0]?.frames as readonly TimedProviderEvent[]
    const terminal = frames[frames.length - 1]
    expect(terminal?.event.type).toBe("response.error")
    expect(terminal?.event.type === "response.error" ? terminal.event.error.code : undefined).toBe("overloaded")
    expect(terminal?.event.type === "response.error" ? terminal.event.error.retryable : undefined).toBe(true)
  })

  it("seals only bounded provider error metadata and never raw provider prose", async () => {
    const privateInput = "private request winter-orchid-731 must never persist"
    const { sink, provider } = recorderOver({
      name: "private-failure",
      when: () => true,
      steps: exampleSteps.slice(0, 2),
      terminal: {
        kind: "error",
        error: new ProviderStreamError({
          code: "rate_limit",
          retryable: true,
          message: privateInput,
          statusHint: 429,
          retryAfterMs: 2_500,
        }),
      },
    })

    await Effect.runPromiseExit(Stream.runCollect(provider.stream(exampleRequest())))
    const drafts = await Effect.runPromise(sink.drafts)
    const sealed = await Effect.runPromise(
      sealCassette({
        cassetteId: "sanitized-error",
        interactions: drafts,
        policy: DEFAULT_REDACTION_POLICY,
        createdAt: "2026-07-27T00:00:00.000Z",
      }),
    )
    const sealedBytes = Array.from(sealed.files.values()).join("")
    expect(sealedBytes).not.toContain(privateInput)
    expect(sealedBytes).toContain('"code":"rate_limit"')
    expect(sealedBytes).toContain('"message":"ProviderStreamError (HTTP 429)"')
    expect(sealedBytes).toContain('"retryable":true')
    expect(sealedBytes).toContain('"statusHint":429')
    expect(sealedBytes).toContain('"retryAfterMs":2500')
  })
  it("does not persist a token-like provider error code", async () => {
    const providerCode = "sk_live_winter_orchid_731"
    const providerMessage = "private provider token detail winter-orchid-731"
    const sealedBytes = await sealedFailureBytes(providerCode, providerMessage)
    expect(sealedBytes).not.toContain(providerCode)
    expect(sealedBytes).not.toContain(providerMessage)
    expect(sealedBytes).toContain('"code":"provider_error"')
    expect(sealedBytes).toContain('"retryable":true')
    expect(sealedBytes).toContain('"statusHint":429')
    expect(sealedBytes).toContain('"retryAfterMs":2500')
  })

  it("does not persist a prose-like provider error code", async () => {
    const providerCode = "customer_winter_orchid_incident"
    const providerMessage = "private provider prose winter-orchid-731"
    const sealedBytes = await sealedFailureBytes(providerCode, providerMessage)
    expect(sealedBytes).not.toContain(providerCode)
    expect(sealedBytes).not.toContain(providerMessage)
    expect(sealedBytes).toContain('"code":"provider_error"')
    expect(sealedBytes).toContain('"message":"ProviderStreamError (HTTP 429)"')
  })

  it("replaces malformed provider error metadata with bounded safe values", async () => {
    const privateInput = "private prose disguised as an error code"
    const { sink, provider } = recorderOver({
      name: "malformed-failure",
      when: () => true,
      steps: exampleSteps.slice(0, 2),
      terminal: {
        kind: "error",
        error: new ProviderStreamError({
          code: privateInput,
          retryable: false,
          message: privateInput,
          statusHint: 42,
          retryAfterMs: -1,
        }),
      },
    })

    await Effect.runPromiseExit(Stream.runCollect(provider.stream(exampleRequest())))
    const drafts = await Effect.runPromise(sink.drafts)
    const sealed = await Effect.runPromise(
      sealCassette({
        cassetteId: "bounded-error",
        interactions: drafts,
        policy: DEFAULT_REDACTION_POLICY,
        createdAt: "2026-07-27T00:00:00.000Z",
      }),
    )
    const sealedBytes = Array.from(sealed.files.values()).join("")
    expect(sealedBytes).not.toContain(privateInput)
    expect(sealedBytes).toContain('"code":"provider_error"')
    expect(sealedBytes).toContain('"message":"ProviderStreamError"')
    expect(sealedBytes).not.toContain("statusHint")
    expect(sealedBytes).not.toContain("retryAfterMs")
  })

  it("records consumer cancellation as an interrupted terminal record", async () => {
    const { sink, provider } = recorderOver({
      name: "hangs",
      when: () => true,
      steps: exampleSteps.slice(0, 2),
      terminal: { kind: "hang" },
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* Deferred.make<void>()
        const seen: TimedProviderEvent[] = []
        const fiber = yield* Effect.forkChild(
          Stream.runForEach(provider.stream(exampleRequest()), frame =>
            Effect.suspend(() => {
              seen.push(frame)
              return seen.length === 1 ? Deferred.succeed(first, undefined) : Effect.void
            }),
          ),
        )
        yield* Deferred.await(first)
        yield* Fiber.interrupt(fiber)
        yield* Fiber.await(fiber)
      }).pipe(Effect.scoped),
    )

    const drafts = await Effect.runPromise(sink.drafts)
    const frames = drafts[0]?.frames as readonly TimedProviderEvent[]
    expect(frames[frames.length - 1]?.event.type).toBe("response.interrupted")
  })
})
