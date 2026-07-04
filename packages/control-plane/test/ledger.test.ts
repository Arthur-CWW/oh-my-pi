import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { Database } from "bun:sqlite"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Context, Effect } from "effect"

import { LedgerStore, openLedger } from "../src/ledger"

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
    expect(tableNames).toEqual(["artifacts", "branches", "commits", "events", "model_calls", "packets", "provider_calls", "sessions", "turns"])
    expect(sqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM packets").get()?.count).toBe(1)
    expect(sqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM commits").get()?.count).toBe(1)
  } finally {
    sqlite.close()
  }
})

test("in-memory ledger opens", async () => {
  await Effect.runPromise(Effect.gen(function* () {
    const store = yield* LedgerStore
    expect((yield* store.statusSummary()).counts.sessions).toBe(0)
  }).pipe(Effect.provide(openLedger(":memory:"))))
})
