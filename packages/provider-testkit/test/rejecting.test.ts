import { afterEach, describe, expect, it } from "bun:test"
import { Effect, Stream } from "effect"
import { componentDigests, requestDigest } from "../src/canonical"
import { guardNetwork, makeRejectingProvider, type NetworkGuardHandle } from "../src/rejecting"
import { exampleRequest } from "./support/fixtures"

let guard: NetworkGuardHandle | undefined

afterEach(() => {
  guard?.restore()
  guard = undefined
})

describe("RejectingProvider", () => {
  it("fails any provider call and records a safe audit entry", async () => {
    const { provider, audit } = makeRejectingProvider("historical-transcript-projection")
    const request = exampleRequest()

    const exit = await Effect.runPromiseExit(
      Stream.runCollect(provider.stream(request, { label: "projection", variant: "default" })),
    )

    expect(exit._tag).toBe("Failure")
    expect(JSON.stringify(exit)).toContain("UnexpectedNetworkAccessError")

    const entries = audit.entries()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.guard).toBe("RejectingProvider")
    expect(entries[0]?.label).toBe("historical-transcript-projection:projection")
    expect(entries[0]?.requestDigest).toBe(requestDigest(request))
    expect(entries[0]?.routeDigest).toBe(componentDigests(request).route)
  })

  it("audits every unexpected call rather than only the first", async () => {
    const { provider, audit } = makeRejectingProvider("inert")
    await Effect.runPromiseExit(Stream.runCollect(provider.stream(exampleRequest())))
    await Effect.runPromiseExit(Stream.runCollect(provider.stream(exampleRequest({ system: ["other"] }))))
    expect(audit.entries()).toHaveLength(2)
  })

  it("never emits an event before failing", async () => {
    const { provider } = makeRejectingProvider("inert")
    const observed: unknown[] = []
    await Effect.runPromiseExit(
      Stream.runForEach(provider.stream(exampleRequest()), frame =>
        Effect.sync(() => {
          observed.push(frame)
        }),
      ),
    )
    expect(observed).toEqual([])
  })
})

describe("network guard", () => {
  it("rejects an unexpected fetch and records scheme and host only", async () => {
    guard = guardNetwork("hermetic-e2e")

    const rejection = await fetch("https://api.example.invalid/v1/messages?key=secret-value").then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(JSON.stringify(rejection)).toContain("UnexpectedNetworkAccessError")
    const entries = guard.audit.entries()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.origin).toBe("https://api.example.invalid")
    expect(entries[0]?.guard).toBe("networkGuard")
    expect(JSON.stringify(entries[0])).not.toContain("secret-value")
  })

  it("restores the previous fetch implementation", () => {
    const before = globalThis.fetch
    const handle = guardNetwork("temporary")
    expect(globalThis.fetch).not.toBe(before)
    handle.restore()
    expect(globalThis.fetch).toBe(before)
  })
})
