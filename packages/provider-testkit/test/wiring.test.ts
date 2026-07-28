import { describe, expect, it } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import {
  CredentialGate,
  ProviderTransport,
  envCredentialGate,
  layerLive,
  layerLiveUpstream,
  type ProviderTransportService,
} from "../src/live"
import type { ProviderEvent, TimedProviderEvent } from "../src/protocol"
import { Provider } from "../src/provider"
import { RecordingSink, layerRecording, makeMemorySink } from "../src/recording"
import { exampleRequest, exampleSteps } from "./support/fixtures"

const CREDENTIAL_ENV = "PROVIDER_TESTKIT_WIRING_KEY"

/**
 * Stands in for a product's real wire adapter. It performs no I/O; the point of
 * this file is the Layer graph and the credential gate, not transport fidelity.
 */
const transport: ProviderTransportService = {
  connect: () => Stream.fromArray(exampleSteps.map(step => step.event) as readonly ProviderEvent[]),
}

const transportLayer = Layer.succeed(ProviderTransport, transport)

describe("Layer wiring", () => {
  it("refuses to open a live stream when the credential is absent", async () => {
    delete process.env[CREDENTIAL_ENV]
    const layer = Layer.provide(
      layerLive,
      Layer.mergeAll(transportLayer, Layer.succeed(CredentialGate, envCredentialGate(CREDENTIAL_ENV))),
    )

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const provider = yield* Provider
        return yield* Stream.runCollect(provider.stream(exampleRequest()))
      }).pipe(Effect.provide(layer)),
    )

    expect(exit._tag).toBe("Failure")
    const rendered = JSON.stringify(exit)
    expect(rendered).toContain("ProviderCredentialsMissingError")
    // The gate reports a route digest and a variable name, never a secret.
    expect(rendered).toContain(CREDENTIAL_ENV)
  })

  it("stamps sequence and elapsed time onto a transport's raw events", async () => {
    process.env[CREDENTIAL_ENV] = "present"
    const layer = Layer.provide(
      layerLive,
      Layer.mergeAll(transportLayer, Layer.succeed(CredentialGate, envCredentialGate(CREDENTIAL_ENV))),
    )

    const frames = (await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* Provider
        return yield* Stream.runCollect(provider.stream(exampleRequest()))
      }).pipe(Effect.provide(layer)),
    )) as readonly TimedProviderEvent[]

    delete process.env[CREDENTIAL_ENV]
    expect(frames).toHaveLength(exampleSteps.length)
    expect(frames.map(frame => frame.seq)).toEqual(frames.map((_, index) => index))
    expect(frames.every(frame => frame.elapsedMs >= 0)).toBe(true)
  })

  it("composes RecordingProvider over LiveProvider without self-reference", async () => {
    process.env[CREDENTIAL_ENV] = "present"
    const sink = makeMemorySink()
    const layer = Layer.provide(
      layerRecording({ interactionId: request => `wired-${request.route.model}` }),
      Layer.mergeAll(
        Layer.provide(
          layerLiveUpstream,
          Layer.mergeAll(transportLayer, Layer.succeed(CredentialGate, envCredentialGate(CREDENTIAL_ENV))),
        ),
        Layer.succeed(RecordingSink, sink),
      ),
    )

    await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* Provider
        yield* Stream.runDrain(provider.stream(exampleRequest()))
      }).pipe(Effect.provide(layer)),
    )

    delete process.env[CREDENTIAL_ENV]
    const drafts = await Effect.runPromise(sink.drafts)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.interactionId).toBe("wired-claude-example-4")
    expect(drafts[0]?.frames).toHaveLength(exampleSteps.length)
  })
})
