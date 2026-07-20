import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

import { Database } from "bun:sqlite"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Context, Effect, Schema } from "effect"

import { LedgerStore, openLedger, papercutFingerprint } from "../src/ledger"
import { makeControlPlaneApi } from "../src/http-api"
import { migrateLedger } from "../src/migrate"
import { PapercutInputSchema } from "../src/schema"

const tmpDir = join(import.meta.dir, ".tmp")
const dbPath = join(tmpDir, "ledger-fixture.sqlite")
const unknownPayload = JSON.stringify({ weird: "snowman ☃ and nul \u0000", nested: [1, null, { ok: true }] })

beforeAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

test("ledger migration and fixture rows cover every row family", async () => {
  const program = Effect.gen(function* () {
    const store = yield* LedgerStore

    expect((yield* store.upsertSession({
      id: "session-1",
      machine: "m1",
      harness: "UNKNOWN_HARNESS",
      workspace: "/repo",
      title: "fixture",
      status: "running",
      createdAt: 1_000,
      updatedAt: 1_900,
      meta: "{\"fixture\":true}",
    })).inserted).toBe(true)

    expect((yield* store.recordBranch({
      id: "branch-root",
      sessionId: "session-1",
      kind: "root",
      createdAt: 1_010,
      meta: "{}",
    })).inserted).toBe(true)

    expect((yield* store.recordTurn({
      id: "turn-1",
      sessionId: "session-1",
      branchId: "branch-root",
      seq: 1,
      startedAt: 1_100,
      endedAt: 1_200,
      contextTokens: 100,
      toolCalls: 1,
      toolCallSummary: "[{\"tool\":\"read\"}]",
      editBytes: 0,
      turnDurationMs: 100,
      yieldKind: "handoff",
      affectSelfReport: "steady",
      affectSignals: "{\"retries\":0}",
    })).inserted).toBe(true)

    expect((yield* store.recordTurn({
      id: "turn-2",
      sessionId: "session-1",
      branchId: "branch-root",
      seq: 2,
      startedAt: 1_300,
      endedAt: 1_500,
      contextTokens: 120,
      toolCalls: 2,
      editBytes: 64,
      turnDurationMs: 200,
      yieldKind: "done",
    })).inserted).toBe(true)

    expect((yield* store.publishEvent({
      id: "session-1:1",
      ts: 1_150,
      sessionId: "session-1",
      seq: 1,
      branchId: "branch-root",
      kind: "UNKNOWN_EVENT_KIND",
      payloadVersion: 1,
      payload: unknownPayload,
    })).inserted).toBe(true)
    expect((yield* store.publishEvent({
      id: "session-1:1",
      ts: 1_150,
      sessionId: "session-1",
      seq: 1,
      branchId: "branch-root",
      kind: "UNKNOWN_EVENT_KIND",
      payloadVersion: 1,
      payload: unknownPayload,
    })).inserted).toBe(false)

    expect((yield* store.publishEvent({
      id: "event-2",
      ts: 1_550,
      sessionId: "session-1",
      branchId: "branch-root",
      packetId: "packet-1",
      kind: "yield",
      payloadVersion: 1,
      payload: "{\"yieldKind\":\"done\"}",
    })).inserted).toBe(true)

    const rawRequest = yield* store.putArtifact({ content: "{\"messages\":[\"hi\"]}" }, {
      ts: 1_600,
      sessionId: "session-1",
      kind: "rawRequest",
      retention: "keep",
      meta: "{}",
    })
    const rawResponse = yield* store.putArtifact({ content: "{\"text\":\"hello\"}" }, {
      ts: 1_700,
      sessionId: "session-1",
      kind: "rawResponse",
      retention: "keep",
      meta: "{}",
    })

    expect((yield* store.recordModelCall({
      id: "model-call-1",
      ts: 1_800,
      machine: "m1",
      session: "session-1",
      branchId: "branch-root",
      agent: "CtrlPlaneFoundation",
      model: "gpt-fixture",
      provider: "openai",
      effort: "medium",
      promptHash: "prompt-hash",
      systemPromptHash: "system-hash",
      skillProfile: "skills-fixture",
      contextManifest: rawRequest.id,
      packetId: "packet-1",
      tokensIn: 10,
      tokensOut: 20,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0.01,
      latencyMs: 250,
      outcome: "ok",
      rawRequestArtifact: rawRequest.id,
      rawResponseArtifact: rawResponse.id,
    })).inserted).toBe(true)

    expect((yield* store.recordProviderCall({
      id: "provider-call-1",
      ts: 1_850,
      sessionId: "session-1",
      branchId: "branch-root",
      packetId: "packet-1",
      provider: "kagi",
      operation: "search",
      inputHash: "input-hash",
      rawRequestArtifact: rawRequest.id,
      latencyMs: 50,
      outcome: "ok",
      cost: 0.001,
      usage: "{\"queries\":1}",
    })).inserted).toBe(true)

    const summary = yield* store.statusSummary()
    expect(summary.counts.sessions).toBe(1)
    expect(summary.counts.branches).toBe(1)
    expect(summary.counts.turns).toBe(2)
    expect(summary.counts.events).toBe(2)
    expect(summary.counts.modelCalls).toBe(1)
    expect(summary.counts.providerCalls).toBe(1)
    expect(summary.counts.artifacts).toBe(2)
    expect(summary.sessionsByStatus).toEqual([{ status: "running", count: 1 }])

    expect((yield* store.listModelCalls({ outcome: "ok" })).map((row) => row.id)).toEqual(["model-call-1"])
    expect((yield* store.listModelCalls({ session: "session-1" })).map((row) => row.id)).toEqual(["model-call-1"])

    const unknownEvents = yield* store.listEvents({ kind: "UNKNOWN_EVENT_KIND" })
    expect(unknownEvents).toHaveLength(1)
    expect(unknownEvents[0]?.payload).toBe(unknownPayload)

    const artifact = yield* store.getArtifact(rawResponse.id)
    expect(artifact.content).toBe("{\"text\":\"hello\"}")
  })

  await Effect.runPromise(program.pipe(Effect.provide(openLedger(dbPath))))
  await Effect.runPromise(Effect.gen(function* () {
    const store = yield* LedgerStore
    expect((yield* store.statusSummary()).counts.sessions).toBe(1)
  }).pipe(Effect.provide(openLedger(dbPath))))

  const sqlite = new Database(dbPath)
  try {
    sqlite.exec("INSERT OR IGNORE INTO packets (id, title, lane, status, ownerPaths, excludedPaths, createdAt, updatedAt) VALUES ('packet-1', 'Packet', 'impl', 'done', '[]', '[]', 1000, 2000)")
    sqlite.exec("INSERT OR IGNORE INTO commits (sha, sessionId, agentId, packetId, ts) VALUES ('abc123', 'session-1', 'agent-1', 'packet-1', 2100)")
    const tableNames = sqlite.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name).sort()
    expect(sqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM packets").get()?.count).toBe(1)
    expect(tableNames).toEqual(["agent_timeline_events", "artifacts", "benchmark_catalog", "benchmark_saturation_assessments", "branches", "canary_runs", "commercial_facts", "commits", "diagnostic_artifacts", "diagnostic_occurrences", "diagnostic_projection_events", "evaluation_measurements", "evaluation_run_participants", "evaluation_runs", "events", "evidence_sources", "lane_state", "metric_definitions", "model_calls", "operational_events", "operational_sources", "packet_lease_events", "packet_leases", "packets", "papercuts", "provider_calls", "refusal_records", "relay_cursors", "relay_inbox", "relay_nodes", "relay_outbox", "relay_peer_health", "relay_peer_routes", "relay_receipts", "release_registry_observations", "release_transactions", "route_advisors", "route_candidates", "route_event_artifacts", "route_resolutions", "routing_observations", "sessions", "turns"])
    expect(sqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM commits").get()?.count).toBe(1)
  } finally {
    sqlite.close()
  }
})

test("papercuts decode, append, aggregate, and preserve task verification state", async () => {
  const papercutDbPath = join(tmpDir, "papercut-fixture.sqlite")
  const sqlite = new Database(papercutDbPath)
  try {
    migrateLedger(sqlite)
    sqlite.exec("INSERT INTO packets (id, title, lane, status, ownerPaths, excludedPaths, createdAt, updatedAt) VALUES ('packet-papercut', 'Verify unchanged', 'task', 'review', '[]', '[]', 1, 1)")
  } finally {
    sqlite.close()
  }

  const first = {
    kind: "tool" as const,
    severity: "medium" as const,
    message: "Terminal command failed with exit 41",
    commandOrTool: "bash",
    cwdOrPackage: "packages/control-plane",
    evidenceArtifactId: "artifact-a",
    suggestedFix: "Expose the failing command output.",
  }
  const second = { ...first, severity: "high" as const, message: "Terminal command failed with exit 99", evidenceArtifactId: "artifact-b" }
  expect(papercutFingerprint(first)).toBe(papercutFingerprint(second))

  const schemaResult = Schema.decodeUnknownOption(PapercutInputSchema)({ ...first, kind: "invalid" })
  expect(schemaResult._tag).toBe("None")
  const program = Effect.gen(function* () {
    const store = yield* LedgerStore
    const before = yield* store.statusSummary()
    const firstResult = yield* store.reportPapercut({ ...first, timestamp: 1_000, agentId: "agent-a", modelId: "model-a", sessionId: "session-a" })
    const secondResult = yield* store.reportPapercut({ ...second, timestamp: 2_000, agentId: "agent-b", modelId: "model-b", sessionId: "session-b" })
    const minimalResult = yield* store.reportPapercut({ kind: "repo", severity: "low", message: "Missing setup instruction", timestamp: 3_000 })
    expect(firstResult.record.status).toBe("new")
    expect(secondResult.record).toMatchObject({ severity: "high", status: "recurring", occurrences: 2, firstSeenAt: 1_000, lastSeenAt: 2_000 })
    expect(minimalResult.record).toMatchObject({ kind: "repo", status: "new", occurrences: 1 })
    expect((yield* store.listPapercuts({ severity: "high", status: "recurring" }))).toEqual([secondResult.record])
    const api = makeControlPlaneApi({ ledger: store, clientErrorLogPath: join(tmpDir, "papercut-client-errors.log") })
    const recurring = yield* Effect.promise(() => api.fetch(new Request("http://localhost/api/papercuts/recurring?severity=high")))
    expect(recurring.status).toBe(200)
    expect(yield* Effect.promise(() => recurring.text())).toContain('"status":"recurring"')
    expect((yield* store.statusSummary())).toEqual(before)
  })

  await Effect.runPromise(program.pipe(Effect.provide(openLedger(papercutDbPath))))

  const appended = readFileSync(join(tmpDir, "papercuts.jsonl"), "utf8").trim().split("\n")
  expect(appended).toHaveLength(3)
  const projection = new Database(papercutDbPath)
  try {
    expect(projection.query<{ status: string; occurrences: number; severity: string }, []>("SELECT status, occurrences, severity FROM papercuts WHERE occurrences = 2").get()).toEqual({ status: "recurring", occurrences: 2, severity: "high" })
    expect(projection.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM events").get()?.count).toBe(0)
    expect(projection.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM packets WHERE status = 'done'").get()?.count).toBe(0)
    expect(projection.query<{ status: string }, []>("SELECT status FROM packets WHERE id = 'packet-papercut'").get()?.status).toBe("review")
  } finally {
    projection.close()
  }
})

test("in-memory ledger opens", async () => {
  await Effect.runPromise(Effect.gen(function* () {
    const store = yield* LedgerStore
    expect((yield* store.statusSummary()).counts.sessions).toBe(0)
  }).pipe(Effect.provide(openLedger(":memory:"))))
})
