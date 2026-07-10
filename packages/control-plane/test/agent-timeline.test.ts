import { appendFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { Database } from "bun:sqlite"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect } from "effect"

import {
  getAgentRouteTimeline,
  getAgentTimeline,
  getCurrentAgentStates,
  getModelCallsForResolution,
  getPacketRouteTimeline,
  getResolvedRoute,
  getRestartRecoveryTimeline,
} from "../src/agent-timeline"
import { ingestOutbox } from "../src/ingest"
import { LedgerStore, openLedger } from "../src/ledger"
import { LEDGER_SCHEMA_VERSION, migrateLedger, migration0001Sql, migration0002Sql, migration0003Sql, migration0004Sql, migration0005Sql, migration0006Sql } from "../src/migrate"
import { type JsonValue, type OutboxEnvelope } from "../src/outbox"

const tmpDir = join(import.meta.dir, ".timeline-tmp")
const dbPath = join(tmpDir, "timeline.sqlite")
const outboxPath = join(tmpDir, "timeline.jsonl")
const sessionId = "source-session"
const agentId = "agent-7"
const resolutionId = `${agentId}:route:1`

beforeAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

test("v6 ledgers retain rows and migrate additively to v7", () => {
  const sqlite = new Database(":memory:")
  try {
    sqlite.exec(migration0001Sql)
    sqlite.exec(migration0002Sql)
    sqlite.exec(migration0003Sql)
    sqlite.exec(migration0004Sql)
    sqlite.exec(migration0005Sql)
    sqlite.exec(migration0006Sql)
    sqlite.exec("INSERT INTO events (id, ts, kind, payloadVersion, payload) VALUES ('v6-event', 1, 'legacy', 1, '{\"kept\":true}')")

    migrateLedger(sqlite)

    expect(sqlite.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(LEDGER_SCHEMA_VERSION)
    expect(sqlite.query<{ payload: string }, []>("SELECT payload FROM events WHERE id = 'v6-event'").get()?.payload).toBe('{"kept":true}')
    const fresh = new Database(":memory:")
    try {
      migrateLedger(fresh)
      expect(fresh.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(LEDGER_SCHEMA_VERSION)
      expect(fresh.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'route_event_artifacts'").get()?.name).toBe("route_event_artifacts")
    } finally {
      fresh.close()
    }
    expect(sqlite.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'route_resolutions'").get()?.name).toBe("route_resolutions")
    expect(sqlite.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_timeline_events'").get()?.name).toBe("agent_timeline_events")
  } finally {
    sqlite.close()
  }
})

test("projects timelines and routes atomically, preserving future known envelopes", async () => {
  append(envelope(0, "agentTimeline", timelinePayload(0, "spawn_scheduled", null, "scheduled")))
  append(envelope(1, "routeResolution", routePayload(1)))
  append(envelope(2, "agentTimeline", timelinePayload(2, "spawn_started", "resolved", "running")))
  append(envelope(3, "agentTimeline", timelinePayload(3, "interrupted_by_restart", "running", "parked", { turnId: "turn-1", restartId: "restart-1" })))
  append(envelope(4, "agentTimeline", timelinePayload(4, "adopt", "parked", "parked", { replacementSessionId: "replacement", recoveredJournalEntryId: "journal-1" })))
  append(envelope(5, "modelCall", modelCallPayload()))
  const futureLine = JSON.stringify(envelope(6, "agentTimeline", { payloadVersion: 2, opaque: ["future"] }))
  appendFileSync(outboxPath, `${futureLine}\n`)
  const unknownLine = JSON.stringify(envelope(7, "futureKind", { opaque: ["unknown"] }))
  appendFileSync(outboxPath, `${unknownLine}\n`)

  await Effect.runPromise(Effect.gen(function* () {
    expect(yield* ingestOutbox(outboxPath)).toEqual({ inserted: 8, ignored: 0, malformed: 0 })
    expect(yield* ingestOutbox(outboxPath)).toEqual({ inserted: 0, ignored: 8, malformed: 0 })

    const store = yield* LedgerStore
    const timeline = yield* getAgentTimeline(agentId)
    expect(timeline.events.map((event) => event.kind)).toEqual(["spawn_scheduled", "spawn_resolved", "spawn_started", "interrupted_by_restart", "adopt"])
    expect(timeline.nextAgentSeq).toBe(5)
    expect(timeline.hasGap).toBe(false)
    expect((yield* getCurrentAgentStates()).map((event) => event.kind)).toEqual(["adopt"])
    expect((yield* getCurrentAgentStates("parent-agent")).map((event) => event.agentId)).toEqual([agentId])
    expect((yield* getRestartRecoveryTimeline(agentId)).map((event) => event.kind)).toEqual(["interrupted_by_restart", "adopt"])

    const route = yield* getResolvedRoute(resolutionId)
    expect(route?.route.resolutionId).toBe(resolutionId)
    expect(route?.route.candidates.map((candidate) => candidate.disposition)).toEqual(["selected"])
    expect((yield* getAgentRouteTimeline(agentId)).map((item) => item.route.resolutionId)).toEqual([resolutionId])
    expect((yield* getPacketRouteTimeline("packet-7")).map((item) => item.route.resolutionId)).toEqual([resolutionId])
    expect((yield* getModelCallsForResolution(resolutionId)).map((call) => call.id)).toEqual(["call-7"])
    expect((yield* store.listEvents({ kind: "agentTimeline" }))[0]?.payload).toBe(futureLine)
    expect((yield* store.listEvents({ kind: "futureKind" }))[0]?.payload).toBe(unknownLine)
  }).pipe(Effect.provide(openLedger(dbPath))))
})

test("rejects conflicts and rolls back invalid route projections", async () => {
  const conflictPath = join(tmpDir, "conflict.jsonl")
  appendTo(conflictPath, envelope(0, "agentTimeline", timelinePayload(0, "spawn_scheduled", null, "scheduled")))
  appendTo(conflictPath, envelope(0, "agentTimeline", timelinePayload(0, "spawn_scheduled", null, "scheduled", { changed: true })))
  await expect(Effect.runPromise(ingestOutbox(conflictPath).pipe(Effect.provide(openLedger(join(tmpDir, "conflict.sqlite")))))).rejects.toThrow()

  const atomicPath = join(tmpDir, "atomic.jsonl")
  const invalidFallback = routePayload(0, "fallback", "missing-route")
  appendTo(atomicPath, envelope(0, "routeResolution", invalidFallback))
  const atomicDbPath = join(tmpDir, "atomic.sqlite")
  await expect(Effect.runPromise(ingestOutbox(atomicPath).pipe(Effect.provide(openLedger(atomicDbPath))))).rejects.toThrow()
  const sqlite = new Database(atomicDbPath)
  try {
    expect(sqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM route_resolutions").get()?.count).toBe(0)
    expect(sqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM agent_timeline_events").get()?.count).toBe(0)
  } finally {
    sqlite.close()
  }
})

function append(value: OutboxEnvelope): void {
  appendTo(outboxPath, value)
}

function appendTo(path: string, value: OutboxEnvelope): void {
  appendFileSync(path, `${JSON.stringify(value)}\n`)
}

function envelope(seq: number, kind: string, payload: JsonValue): OutboxEnvelope {
  return { v: 1, kind, sessionId, seq, ts: 1_000 + seq, payload }
}

function timelinePayload(agentSeq: number, kind: string, fromState: string | null, toState: string | null, detail: JsonValue = {}): JsonValue {
  return { payloadVersion: 1, eventId: `${agentId}:event:${agentSeq}`, occurredAt: 1_000 + agentSeq, agentId, agentSeq, agentSessionId: "child-session", parentSessionId: sessionId, parentAgentId: "parent-agent", taskId: "task-7", packetId: "packet-7", branchId: "branch-7", turnId: "turn-1", kind, fromState, toState, reason: kind === "spawn_scheduled" || kind === "spawn_started" ? null : "restart recovery", errorClass: null, detail, artifacts: [] }
}

function routePayload(agentSeq: number, changeKind = "spawn_resolved", fallbackFromResolutionId: string | null = null): JsonValue {
  return { payloadVersion: 1, resolutionId: `${agentId}:route:${agentSeq}`, occurredAt: 1_000 + agentSeq, agentId, agentSeq, agentSessionId: "child-session", parentSessionId: sessionId, parentAgentId: "parent-agent", taskId: "task-7", packetId: "packet-7", branchId: "branch-7", turnId: "turn-1", changeKind, reason: changeKind === "spawn_resolved" ? null : "fallback reason", route: { lane: "worker", provider: "openai", upstreamProvider: null, model: "gpt-test", account: { kind: "configured", ref: "slot-a", provenance: { source: "fixture" } }, effort: "medium" }, provenance: { winningLayer: "workspace_policy", constraints: [], consultedSources: [], overriddenValues: [] }, candidates: [{ ordinal: 0, lane: "worker", provider: "openai", model: "gpt-test", account: { kind: "configured", ref: "slot-a", provenance: { source: "fixture" } }, effort: "medium", disposition: "selected", fallbackOrdinal: null, rejectionCode: null, rejectionReason: null, failedConstraintIds: [] }], fallbackFromResolutionId, revertedFromResolutionId: null, advisors: [], rawDecisionArtifactId: null, artifacts: [] }
}

function modelCallPayload(): JsonValue {
  return { id: "call-7", machine: "m1", session: sessionId, branchId: "branch-7", agent: agentId, model: "gpt-test", provider: "openai", upstreamProvider: null, effort: "medium", promptHash: "prompt", systemPromptHash: "system", skillProfile: "none", contextManifest: "none", packetId: "packet-7", tokensIn: 1, tokensOut: 1, cacheRead: 0, cacheWrite: 0, cost: 0, latencyMs: 1, ttftMs: null, reasoningTokens: null, outcome: "ok", errorClass: null, retryOf: null, fallbackFrom: null, rawRequestArtifact: "", rawResponseArtifact: "", routeResolutionId: resolutionId }
}
