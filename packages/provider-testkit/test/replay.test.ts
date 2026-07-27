import { beforeAll, describe, expect, it } from "bun:test"
import { Effect, Stream } from "effect"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"
import { loadCassette, type Cassette } from "../src/cassette"
import type { ProviderEvent, TimedProviderEvent } from "../src/protocol"
import { makeReplayProvider } from "../src/replay"
import { EXAMPLE_INTERACTION_ID, exampleRequest, expectedRedactedEvents } from "./support/fixtures"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const exampleDirectory = join(packageRoot, "fixtures", "cassettes", "example")

let cassette: Cassette

beforeAll(async () => {
  cassette = await Effect.runPromise(loadCassette(exampleDirectory))
})

const collect = (request = exampleRequest(), options?: { variant?: string; attempt?: number }) =>
  Effect.runPromiseExit(Stream.runCollect(makeReplayProvider(cassette).stream(request, options)))

describe("ReplayProvider", () => {
  it("reproduces the recorded stream event for event", async () => {
    const exit = await collect()
    expect(exit._tag).toBe("Success")
    const frames = (exit._tag === "Success" ? exit.value : []) as readonly TimedProviderEvent[]

    const recorded = cassette.interactions.find(entry => entry.interactionId === EXAMPLE_INTERACTION_ID)
    expect(recorded).toBeDefined()
    expect(frames).toEqual((recorded as { frames: readonly TimedProviderEvent[] }).frames as TimedProviderEvent[])
    expect(frames.map(frame => frame.event)).toEqual(expectedRedactedEvents as ProviderEvent[])
    expect(frames.map(frame => frame.seq)).toEqual(frames.map((_, index) => index))
  })

  it("fails closed with a digest mismatch when the prompt contract changes", async () => {
    const base = exampleRequest()
    const mutated = exampleRequest({ contract: { ...base.contract, promptVersion: "annotate/v4" } })

    const exit = await collect(mutated)
    expect(exit._tag).toBe("Failure")
    const rendered = JSON.stringify(exit)
    expect(rendered).toContain("PromptDigestMismatchError")
    expect(rendered).toContain('"component":"contract"')
    // Digests are reported; prompt text never is.
    expect(rendered).not.toContain("You annotate short passages")
  })

  it("fails closed with a digest mismatch when the system prompt text changes", async () => {
    const mutated = exampleRequest({ system: ["You annotate short passages.", "Cite every claim. Twice."] })
    const exit = await collect(mutated)
    expect(exit._tag).toBe("Failure")
    const rendered = JSON.stringify(exit)
    expect(rendered).toContain("PromptDigestMismatchError")
    expect(rendered).toContain('"component":"prompt"')
  })

  it("fails closed with a miss when nothing shares the route", async () => {
    const exit = await collect(
      exampleRequest({ route: { providerApi: "openai.responses.v1", model: "gpt-example" } }),
    )
    expect(exit._tag).toBe("Failure")
    expect(JSON.stringify(exit)).toContain("CassetteMissError")
  })

  it("fails closed when an explicitly named variant was never recorded", async () => {
    const exit = await collect(exampleRequest(), { variant: "rate-limited" })
    expect(exit._tag).toBe("Failure")
    expect(JSON.stringify(exit)).toContain("CassetteMissError")
  })

  it("refuses to guess between attempts instead of taking the first", async () => {
    const recorded = cassette.interactions[0] as Cassette["interactions"][number]
    const secondAttempt = { ...recorded, interactionId: "attempt-2", attempt: 2 }
    const ambiguous: Cassette = {
      ...cassette,
      byDigestVariant: new Map([
        [`${recorded.requestDigest}|default`, [recorded, secondAttempt]],
      ]),
      byExactKey: new Map([
        [`${recorded.requestDigest}|default|1`, recorded],
        [`${recorded.requestDigest}|default|2`, secondAttempt],
      ]),
    }

    const exit = await Effect.runPromiseExit(
      Stream.runCollect(makeReplayProvider(ambiguous).stream(exampleRequest())),
    )
    expect(exit._tag).toBe("Failure")
    expect(JSON.stringify(exit)).toContain("CassetteAmbiguousMatchError")

    const disambiguated = await Effect.runPromiseExit(
      Stream.runCollect(makeReplayProvider(ambiguous).stream(exampleRequest(), { attempt: 2 })),
    )
    expect(disambiguated._tag).toBe("Success")
  })

  it("emits nothing at all on any failure path", async () => {
    const observed: TimedProviderEvent[] = []
    const exit = await Effect.runPromiseExit(
      Stream.runForEach(
        makeReplayProvider(cassette).stream(exampleRequest({ system: ["different"] })),
        frame =>
          Effect.sync(() => {
            observed.push(frame)
          }),
      ),
    )
    expect(exit._tag).toBe("Failure")
    expect(observed).toEqual([])
  })
})
