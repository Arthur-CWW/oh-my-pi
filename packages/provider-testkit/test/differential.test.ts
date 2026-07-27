import { describe, expect, it } from "bun:test"
import {
  decodeReplayTrace,
  ReplayTerminalMutationError,
  ReplayTraceIntegrityError,
  ReplayUnknownEventError,
  runDifferentialReplay,
  sealReplayTrace,
  sha256Hex,
  type DifferentialReplayAdapter,
  type ReplayTraceEvent,
} from "../src"

interface Observation {
  readonly log: readonly string[]
  readonly terminal: boolean
  readonly reopens: number
}

class ReducerAdapter implements DifferentialReplayAdapter<Observation> {
  readonly log: string[] = []
  terminal = false
  reopens = 0

  constructor(readonly mutateToolOrder = false) {}

  apply(event: ReplayTraceEvent): void {
    switch (event.type) {
      case "user":
        this.log.push(`user:${event.content}`)
        return
      case "provider":
        this.log.push(`assistant:${event.expectedText}`)
        return
      case "tool":
        if (this.mutateToolOrder) this.log.unshift(`tool:${event.name}`)
        else this.log.push(`tool:${event.name}`)
        return
      case "lifecycle":
        this.log.push(`lifecycle:${event.state}`)
        return
      case "restart":
        this.log.push(`restart:${event.attemptId}`)
        return
      case "terminal":
        this.terminal = true
        this.log.push(`terminal:${event.outcome}`)
        return
      case "unknown":
        throw new Error("the runner must apply its unknown-event policy before adapters")
    }
  }

  reopen(): void {
    this.reopens += 1
  }

  observe(): Observation {
    return { log: [...this.log], terminal: this.terminal, reopens: this.reopens }
  }
}

const request = {
  route: { providerApi: "anthropic.messages.v1", model: "fixture-model" },
  contract: { promptVersion: "replay/v1", toolContractVersion: "tools/v1" },
  system: ["Sanitized replay fixture."],
  messages: [{ role: "user" as const, parts: [{ kind: "text" as const, text: "Run diagnostics." }] }],
  tools: [],
  generation: { maxOutputTokens: 128 },
}

const events: readonly ReplayTraceEvent[] = [
  { type: "user", content: "Run diagnostics.", at: "2026-07-27T00:00:00.000Z" },
  {
    type: "provider",
    request,
    expectedText: "Ready.",
    expectedStopReason: "stop",
    expectedUsage: { inputTokens: 3, outputTokens: 1 },
  },
  {
    type: "tool",
    callId: "call-status",
    name: "status",
    result: { healthy: true },
    at: "2026-07-27T00:00:01.000Z",
  },
  {
    type: "lifecycle",
    entityId: "ReplayChild",
    state: "running",
    at: "2026-07-27T00:00:02.000Z",
  },
  {
    type: "restart",
    entityId: "ReplayChild",
    predecessorEpoch: "epoch-1",
    state: "running",
    queueCheckpoint: "queue-1",
    attemptId: "attempt-2",
    at: "2026-07-27T00:00:03.000Z",
  },
  {
    type: "terminal",
    entityId: "ReplayChild",
    outcome: "completed",
    at: "2026-07-27T00:00:04.000Z",
  },
]

const trace = (inputEvents: readonly ReplayTraceEvent[] = events) =>
  sealReplayTrace({
    traceId: "provider-testkit-parity",
    sourceDigest: sha256Hex("sanitized historical source"),
    seed: 2718,
    events: inputEvents,
    checkpoints: [
      { id: "provider", afterEvent: 1 },
      { id: "tool", afterEvent: 2 },
      { id: "restart", afterEvent: 4, reopen: true },
      { id: "terminal", afterEvent: inputEvents.length - 1, invariants: ["terminal-consistency"] },
    ],
  })

const options = {
  unknownEventPolicy: "ignore" as const,
  canonicalize: (observation: Observation) => ({
    log: observation.log,
    terminal: observation.terminal,
    reopens: observation.reopens,
  }),
  invariants: [
    {
      name: "terminal-consistency",
      check: (observation: Observation) =>
        observation.terminal === observation.log.some(entry => entry.startsWith("terminal:"))
          ? undefined
          : "terminal flag and log disagree",
    },
  ],
  environment: { runtime: "bun-test", platform: "nixbox", arch: "x64" },
}

describe("differential replay runner", () => {
  it("matches every checkpoint and preserves receipt provenance across reopen", async () => {
    const reference = new ReducerAdapter()
    const candidate = new ReducerAdapter()
    const result = await runDifferentialReplay(trace(), reference, candidate, options)

    expect(result.kind).toBe("match")
    expect(result.receipt.sourceDigest).toBe(sha256Hex("sanitized historical source"))
    expect(result.receipt.environment).toEqual(options.environment)
    expect(result.receipt.trace).toMatchObject({
      schemaVersion: 1,
      traceId: "provider-testkit-parity",
      eventCount: 6,
      checkpointCount: 4,
      seed: 2718,
    })
    expect(result.receipt.checkpoints.map(checkpoint => [checkpoint.id, checkpoint.reopened])).toEqual([
      ["provider", false],
      ["tool", false],
      ["restart", true],
      ["terminal", false],
    ])
    expect(reference.reopens).toBe(1)
    expect(candidate.reopens).toBe(1)
  })

  it("reports the exact first divergent event and shortest checkpoint prefix", async () => {
    const result = await runDifferentialReplay(trace(), new ReducerAdapter(), new ReducerAdapter(true), options)

    expect(result.kind).toBe("diverged")
    if (result.kind !== "diverged") throw new Error("mutant unexpectedly survived")
    expect(result.report).toMatchObject({
      reason: "observation",
      checkpointId: "tool",
      eventIndex: 2,
      prefixLength: 3,
    })
    expect(result.report.minimizedPrefix).toEqual(events.slice(0, 3))
    expect(result.report.expectedDigest).not.toBe(result.report.actualDigest)
  })

  it("compares final state when a trace has no checkpoints", async () => {
    const finalEvents = [events[0] as ReplayTraceEvent, events[2] as ReplayTraceEvent]
    const noCheckpointTrace = sealReplayTrace({
      traceId: "final-without-checkpoints",
      sourceDigest: sha256Hex("zero checkpoint source"),
      events: finalEvents,
      checkpoints: [],
    })

    const result = await runDifferentialReplay(
      noCheckpointTrace,
      new ReducerAdapter(),
      new ReducerAdapter(true),
      options,
    )

    expect(result.kind).toBe("diverged")
    if (result.kind !== "diverged") throw new Error("zero-checkpoint mutant unexpectedly survived")
    expect(result.report).toMatchObject({
      reason: "observation",
      checkpointId: "final",
      eventIndex: 1,
      prefixLength: 2,
    })
    expect(result.report.minimizedPrefix).toEqual(finalEvents)
    expect(result.receipt.checkpoints).toEqual([])
  })

  it("compares trailing events after the last checkpoint", async () => {
    const trailingEvents = events.slice(0, 3)
    const trailingTrace = sealReplayTrace({
      traceId: "trailing-event",
      sourceDigest: sha256Hex("trailing event source"),
      events: trailingEvents,
      checkpoints: [{ id: "before-trailing", afterEvent: 1 }],
    })

    const result = await runDifferentialReplay(
      trailingTrace,
      new ReducerAdapter(),
      new ReducerAdapter(true),
      options,
    )

    expect(result.kind).toBe("diverged")
    if (result.kind !== "diverged") throw new Error("trailing-event mutant unexpectedly survived")
    expect(result.report).toMatchObject({
      reason: "observation",
      checkpointId: "final",
      eventIndex: 2,
      prefixLength: 3,
    })
    expect(result.report.minimizedPrefix).toEqual(trailingEvents)
    expect(result.receipt.checkpoints.map(checkpoint => checkpoint.id)).toEqual(["before-trailing"])
  })

  it("ignores explicit forward-compatible events or rejects them by policy", async () => {
    const withUnknown: readonly ReplayTraceEvent[] = [
      events[0] as ReplayTraceEvent,
      { type: "unknown", originalType: "provider.cache.hint", payload: { ttl: 60 } },
    ]
    const unknownTrace = sealReplayTrace({
      traceId: "unknown-policy",
      sourceDigest: sha256Hex("unknown source"),
      events: withUnknown,
      checkpoints: [{ id: "after-unknown", afterEvent: 1 }],
    })
    const ignored = await runDifferentialReplay(unknownTrace, new ReducerAdapter(), new ReducerAdapter(), options)
    expect(ignored.kind).toBe("match")

    await expect(
      runDifferentialReplay(unknownTrace, new ReducerAdapter(), new ReducerAdapter(), {
        ...options,
        unknownEventPolicy: "reject",
      }),
    ).rejects.toBeInstanceOf(ReplayUnknownEventError)
  })

  it("decodes the full schema at seal, decode, and run boundaries", async () => {
    expect(() => decodeReplayTrace({})).toThrow(ReplayTraceIntegrityError)
    expect(() =>
      sealReplayTrace({
        traceId: "future-event",
        sourceDigest: sha256Hex("future event source"),
        events: [{ type: "provider.v2" } as unknown as ReplayTraceEvent],
        checkpoints: [],
      }),
    ).toThrow(ReplayTraceIntegrityError)
    expect(() =>
      sealReplayTrace({
        traceId: "malformed-known-event",
        sourceDigest: sha256Hex("malformed event source"),
        events: [{ type: "user", content: 42 } as unknown as ReplayTraceEvent],
        checkpoints: [],
      }),
    ).toThrow(ReplayTraceIntegrityError)
    expect(() =>
      sealReplayTrace({
        traceId: "malformed-checkpoint",
        sourceDigest: sha256Hex("malformed checkpoint source"),
        events: [events[0] as ReplayTraceEvent],
        checkpoints: [{ id: "fractional", afterEvent: 0.5 }],
      }),
    ).toThrow(ReplayTraceIntegrityError)

    const valid = trace()
    try {
      decodeReplayTrace({ ...valid, traceSchemaVersion: 2 })
      throw new Error("unsupported trace survived")
    } catch (error) {
      expect(error).toBeInstanceOf(ReplayTraceIntegrityError)
      expect((error as ReplayTraceIntegrityError).reason).toBe("unsupportedVersion")
    }

    try {
      decodeReplayTrace({ ...valid, checksum: sha256Hex("tampered") })
      throw new Error("tampered trace survived")
    } catch (error) {
      expect(error).toBeInstanceOf(ReplayTraceIntegrityError)
      expect((error as ReplayTraceIntegrityError).reason).toBe("checksumMismatch")
    }

    const malformedRunTrace = {
      ...valid,
      events: [{ type: "provider.v2" }],
      checkpoints: [{ id: "fractional", afterEvent: 0.5 }],
    } as unknown as typeof valid
    await expect(
      runDifferentialReplay(malformedRunTrace, new ReducerAdapter(), new ReducerAdapter(), options),
    ).rejects.toBeInstanceOf(ReplayTraceIntegrityError)
  })

  it("prevents any known event from mutating terminal state", async () => {
    const terminalThenUser: readonly ReplayTraceEvent[] = [
      events[5] as ReplayTraceEvent,
      { type: "user", content: "should not be applied" },
    ]
    const terminalTrace = sealReplayTrace({
      traceId: "terminal-immutable",
      sourceDigest: sha256Hex("terminal source"),
      events: terminalThenUser,
      checkpoints: [{ id: "unreachable", afterEvent: 1 }],
    })

    await expect(
      runDifferentialReplay(terminalTrace, new ReducerAdapter(), new ReducerAdapter(), options),
    ).rejects.toBeInstanceOf(ReplayTerminalMutationError)
  })
})
