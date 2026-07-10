import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

import { expect, test } from "bun:test"
import { Schema } from "effect"

import type { AgentTimelinePayloadV1, ExtensionContextLike, PiLike, RouteResolutionPayloadV1 } from "../src/omp-events"
import createOmpPublisher from "../src/omp-publisher"
import { KnownOutboxKindSchema, OutboxEnvelopeSchema, outboxPathFor } from "../src/outbox"

const tmpDir = join(import.meta.dir, ".tmp", "omp-route-events")

class FakePi {
  private readonly handlers: Record<string, Array<(event: never, ctx: ExtensionContextLike) => unknown>> = {}

  on(event: string, handler: (event: never, ctx: ExtensionContextLike) => unknown): void {
    this.handlers[event] = [...(this.handlers[event] ?? []), handler]
  }

  emit<E>(event: string, payload: E, ctx: ExtensionContextLike): void {
    for (const handler of this.handlers[event] ?? []) handler(payload as never, ctx)
  }
}

function linkage(agentSeq: number) {
  return {
    agentId: "agent-1",
    agentSeq,
    agentSessionId: "child-session-1",
    parentSessionId: "parent-session-1",
    parentAgentId: null,
    taskId: "task-1",
    packetId: "packet-1",
    branchId: "root",
    turnId: null,
  } as const
}

function timeline(agentSeq: number, kind: AgentTimelinePayloadV1["kind"]): AgentTimelinePayloadV1 {
  return {
    ...linkage(agentSeq),
    payloadVersion: 1,
    eventId: `agent-1:event:${agentSeq}`,
    occurredAt: 1_000 + agentSeq,
    kind,
    fromState: kind === "spawn_scheduled" ? null : kind === "adopt" ? "parked" : "running",
    toState: kind === "spawn_scheduled" ? "scheduled" : "parked",
    reason: null,
    errorClass: null,
    detail: kind === "interrupted_by_restart" ? { turnId: "turn-7", restartId: "restart-1" } : {},
    artifacts: [],
  }
}

function resolution(): RouteResolutionPayloadV1 {
  return {
    ...linkage(1),
    payloadVersion: 1,
    resolutionId: "agent-1:route:1",
    occurredAt: 1_001,
    changeKind: "spawn_resolved",
    reason: null,
    route: {
      lane: "primary",
      provider: "anthropic",
      upstreamProvider: null,
      model: "claude-3-5-sonnet",
      account: { kind: "configured", ref: "anthropic-primary", provenance: { resolver: "fixture" } },
      effort: "high",
    },
    provenance: { winningLayer: "workspace_policy", constraints: [], consultedSources: [], overriddenValues: [] },
    candidates: [{
      ordinal: 0,
      lane: "primary",
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      account: { kind: "configured", ref: "anthropic-primary", provenance: { resolver: "fixture" } },
      effort: "high",
      disposition: "selected",
      fallbackOrdinal: null,
      rejectionCode: null,
      rejectionReason: null,
      failedConstraintIds: [],
    }],
    fallbackFromResolutionId: null,
    revertedFromResolutionId: null,
    advisors: [],
    rawDecisionArtifactId: null,
    artifacts: [],
  }
}

function context(sessionId: string): ExtensionContextLike {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => `/tmp/${sessionId}.jsonl`,
    },
  }
}

function readEnvelopes(sessionId: string, outboxDir: string) {
  const lines = readFileSync(outboxPathFor(sessionId, outboxDir), "utf8").trimEnd().split("\n")
  return lines.map((line) => Schema.decodeUnknownSync(OutboxEnvelopeSchema)(JSON.parse(line)))
}

test("publisher appends deterministic durable route and restart lifecycle envelopes in source-session order", () => {
  rmSync(tmpDir, { recursive: true, force: true })
  const outboxDir = join(tmpDir, "outbox")
  const oldOutboxDir = process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"]
  process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] = outboxDir

  try {
    const pi = new FakePi()
    const publisher = createOmpPublisher(pi as PiLike)
    const ctx = context("source-session-1")
    const scheduled = timeline(0, "spawn_scheduled")
    const interrupted = timeline(2, "interrupted_by_restart")
    const adopted = { ...timeline(3, "adopt"), detail: { replacementSessionId: "replacement-1", recoveredJournalEntryId: "journal-1" } }

    publisher.publishAgentTimeline(scheduled, ctx)
    publisher.publishRouteResolution(resolution(), ctx)
    publisher.publishAgentTimeline(interrupted, ctx)
    publisher.publishAgentTimeline(adopted, ctx)

    const rawLines = readFileSync(outboxPathFor("source-session-1", outboxDir), "utf8").trimEnd().split("\n")
    const envelopes = readEnvelopes("source-session-1", outboxDir)
    expect(envelopes.map((envelope) => [envelope.kind, envelope.seq, envelope.ts])).toEqual([
      ["agentTimeline", 0, 1_000], ["routeResolution", 1, 1_001], ["agentTimeline", 2, 1_002], ["agentTimeline", 3, 1_003],
    ])
    expect(rawLines[0]).toBe(JSON.stringify({ v: 1, kind: "agentTimeline", sessionId: "source-session-1", seq: 0, ts: 1_000, payload: scheduled }))
    expect(rawLines[1]).toBe(JSON.stringify({ v: 1, kind: "routeResolution", sessionId: "source-session-1", seq: 1, ts: 1_001, payload: resolution() }))
  } finally {
    if (oldOutboxDir === undefined) delete process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"]
    else process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] = oldOutboxDir
  }
})

test("publisher rejects invalid v1 route payloads before append", () => {
  rmSync(tmpDir, { recursive: true, force: true })
  const outboxDir = join(tmpDir, "invalid")
  const oldOutboxDir = process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"]
  process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] = outboxDir

  try {
    const publisher = createOmpPublisher(new FakePi() as PiLike)
    const invalid = { ...timeline(0, "spawn_scheduled"), payloadVersion: 2 } as never
    expect(() => publisher.publishAgentTimeline(invalid, context("source-session-invalid"))).toThrow()
    const invalidRoute = { ...resolution(), route: { ...resolution().route, effort: "unknown" } } as never
    expect(() => publisher.publishRouteResolution(invalidRoute, context("source-session-invalid"))).toThrow()
    expect(() => readFileSync(outboxPathFor("source-session-invalid", outboxDir), "utf8")).toThrow()
  } finally {
    if (oldOutboxDir === undefined) delete process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"]
    else process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] = oldOutboxDir
  }
})

test("model calls carry only an explicitly published active route resolution", () => {
  rmSync(tmpDir, { recursive: true, force: true })
  const outboxDir = join(tmpDir, "model-link")
  const oldOutboxDir = process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"]
  process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] = outboxDir

  try {
    const pi = new FakePi()
    const publisher = createOmpPublisher(pi as PiLike)
    const ctx = context("source-session-model")
    pi.emit("message_end", { timestamp: 10, message: { role: "assistant", provider: "anthropic", model: "first" } }, ctx)
    publisher.publishRouteResolution(resolution(), ctx)
    pi.emit("message_end", { timestamp: 11, message: { role: "assistant", provider: "anthropic", model: "second" } }, ctx)
    const restartedPi = new FakePi()
    createOmpPublisher(restartedPi as PiLike)
    restartedPi.emit("message_end", { timestamp: 12, message: { role: "assistant", provider: "anthropic", model: "third" } }, ctx)

    const modelCalls = readEnvelopes("source-session-model", outboxDir).filter((envelope) => envelope.kind === "modelCall")
    expect(modelCalls).toHaveLength(3)
    expect(modelCalls[0]?.payload).not.toHaveProperty("routeResolutionId")
    expect(modelCalls[1]?.payload).toMatchObject({ routeResolutionId: "agent-1:route:1" })
    expect(modelCalls[2]?.payload).toMatchObject({ routeResolutionId: "agent-1:route:1" })
  } finally {
    if (oldOutboxDir === undefined) delete process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"]
    else process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] = oldOutboxDir
  }
})

test("future envelopes remain outside the controlled known-kind set", () => {
  const future = { v: 2, kind: "futureRoute", sessionId: "source", seq: 0, ts: 1, payload: { payloadVersion: 2 } }
  expect(Schema.decodeUnknownSync(OutboxEnvelopeSchema)(future)).toEqual(future)
  expect(() => Schema.decodeUnknownSync(KnownOutboxKindSchema)(future.kind)).toThrow()
})
