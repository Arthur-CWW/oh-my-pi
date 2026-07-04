import { appendFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { Database } from "bun:sqlite"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect } from "effect"

import { ingestOutbox } from "../src/ingest"
import { LedgerStore, openLedger } from "../src/ledger"
import { appendOutboxLine, type JsonValue, type OutboxEnvelope } from "../src/outbox"

const tmpDir = join(import.meta.dir, ".tmp")
const dbPath = join(tmpDir, "ingest-fixture.sqlite")
const outboxPath = join(tmpDir, "fixture-outbox.jsonl")
const sessionId = "session-ingest"
const rootBranchId = `${sessionId}:2`

beforeAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

test("outbox ingest is idempotent and resumes from a truncated tail", async () => {
  writeFixtureOutbox()

  await Effect.runPromise(Effect.gen(function* () {
    const first = yield* ingestOutbox(outboxPath, { batchSize: 3 })
    expect(first).toEqual({ inserted: 10, ignored: 0, malformed: 1 })

    const store = yield* LedgerStore
    const summary = yield* store.statusSummary()
    expect(summary.counts.sessions).toBe(1)
    expect(summary.counts.branches).toBe(1)
    expect(summary.counts.turns).toBe(1)
    expect(summary.counts.events).toBe(4)
    expect(summary.counts.modelCalls).toBe(1)
    expect(summary.counts.providerCalls).toBe(1)
    expect(summary.counts.artifacts).toBe(1)

    expect((yield* store.listModelCalls({ session: sessionId })).map((row) => row.id)).toEqual([`${sessionId}:5`])

    const yieldEvents = yield* store.listEvents({ kind: "yield" })
    expect(yieldEvents).toHaveLength(1)
    expect(yieldEvents[0]?.id).toBe(`${sessionId}:4`)
    expect(yieldEvents[0]?.payload).toBe(JSON.stringify({ yieldKind: "done", nested: [1, null, { ok: true }] }))

    const unknownEvents = yield* store.listEvents({ kind: "mysteryKind" })
    expect(unknownEvents).toHaveLength(1)
    expect(unknownEvents[0]?.id).toBe(`${sessionId}:8`)
    expect(unknownEvents[0]?.payload).toContain('"kind":"mysteryKind"')

    const futureEvents = yield* store.listEvents({ kind: "turn" })
    expect(futureEvents).toHaveLength(1)
    expect(futureEvents[0]?.id).toBe(`${sessionId}:10`)
    expect(futureEvents[0]?.payloadVersion).toBe(2)

    const ingestErrors = yield* store.listEvents({ kind: "ingestError" })
    expect(ingestErrors).toHaveLength(1)
    expect(ingestErrors[0]?.payload).toContain("not-json")

    const second = yield* ingestOutbox(outboxPath, { batchSize: 3 })
    expect(second).toEqual({ inserted: 0, ignored: 10, malformed: 1 })
  }).pipe(Effect.provide(openLedger(dbPath))))

  appendOutboxLine(outboxPath, envelope(11, "event", {
    kind: "tailEvent",
    payloadVersion: 1,
    payload: { resumed: true },
  }))
  appendOutboxLine(outboxPath, envelope(12, "providerCall", {
    branchId: rootBranchId,
    packetId: "packet-tail",
    provider: "tail-provider",
    operation: "tail-op",
    inputHash: "tail-input",
    latencyMs: 20,
    outcome: "ok",
    usage: JSON.stringify({ calls: 1 }),
  }))

  await Effect.runPromise(Effect.gen(function* () {
    const resumed = yield* ingestOutbox(outboxPath, { batchSize: 4 })
    expect(resumed).toEqual({ inserted: 2, ignored: 10, malformed: 1 })

    const store = yield* LedgerStore
    const summary = yield* store.statusSummary()
    expect(summary.counts.events).toBe(5)
    expect(summary.counts.providerCalls).toBe(2)
    expect((yield* store.listEvents({ kind: "tailEvent" })).map((row) => row.id)).toEqual([`${sessionId}:11`])
  }).pipe(Effect.provide(openLedger(dbPath))))

  const sqlite = new Database(dbPath)
  try {
    expect(sqlite.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM events WHERE id = ?").get(`${sessionId}:11`)?.count).toBe(1)
    expect(sqlite.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM provider_calls WHERE id = ?").get(`${sessionId}:12`)?.count).toBe(1)
  } finally {
    sqlite.close()
  }
})

function writeFixtureOutbox(): void {
  appendOutboxLine(outboxPath, envelope(1, "session", {
    machine: "m1",
    harness: "omp",
    workspace: "/repo",
    title: "ingest fixture",
    status: "running",
    createdAt: 1_000,
    updatedAt: 2_000,
    meta: JSON.stringify({ fixture: true }),
  }))
  appendOutboxLine(outboxPath, envelope(2, "branch", {
    kind: "root",
    parentBranchId: null,
    atTurn: null,
    createdAt: 1_010,
    meta: "{}",
  }))
  appendOutboxLine(outboxPath, envelope(3, "turn", {
    branchId: rootBranchId,
    seq: 1,
    startedAt: 1_100,
    endedAt: null,
    contextTokens: 100,
    toolCalls: 1,
    toolCallSummary: null,
    editBytes: 32,
    turnDurationMs: 100,
    yieldKind: "handoff",
    affectSelfReport: null,
    affectSignals: null,
    phase: "end",
  }))
  appendOutboxLine(outboxPath, envelope(4, "event", {
    branchId: rootBranchId,
    packetId: "packet-1",
    kind: "yield",
    payloadVersion: 1,
    payload: { yieldKind: "done", nested: [1, null, { ok: true }] },
    extraEventField: "ignored",
  }))
  appendOutboxLine(outboxPath, envelope(5, "modelCall", {
    machine: "m1",
    branchId: rootBranchId,
    agent: "IngestTailer",
    model: "gpt-fixture",
    provider: "openai",
    effort: "medium",
    promptHash: "prompt-hash",
    systemPromptHash: "system-hash",
    skillProfile: "skills-fixture",
    contextManifest: "artifact-context",
    packetId: "packet-1",
    tokensIn: 10,
    tokensOut: 20,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0.01,
    latencyMs: 250,
    outcome: "ok",
    errorClass: null,
    retryOf: null,
    fallbackFrom: null,
    ttftMs: 50,
    totalTokens: 30,
    rawRequestArtifact: "artifact-request",
    rawResponseArtifact: "artifact-response",
  }))
  appendOutboxLine(outboxPath, envelope(6, "providerCall", {
    branchId: null,
    packetId: null,
    provider: "kagi",
    operation: "search",
    inputHash: "input-hash",
    rawRequestArtifact: null,
    latencyMs: 50,
    outcome: "ok",
    cost: null,
    usage: null,
  }))
  appendOutboxLine(outboxPath, envelope(7, "artifact", {
    content: JSON.stringify({ text: "hello" }),
    kind: "rawResponse",
    retention: "keep",
    meta: "{}",
  }))
  appendOutboxLine(outboxPath, envelope(8, "mysteryKind", { weird: "snowman ☃ and nul \u0000", nested: [1, null, { ok: true }] }))
  appendFileSync(outboxPath, "not-json {\n", "utf8")
  appendOutboxLine(outboxPath, envelope(10, "turn", {
    branchId: rootBranchId,
    seq: 2,
    startedAt: 1_300,
    contextTokens: 120,
    toolCalls: 2,
    editBytes: 64,
    turnDurationMs: 200,
    yieldKind: "future-version",
  }, 2))
}

function envelope(seq: number, kind: string, payload: JsonValue, v = 1): OutboxEnvelope {
  return {
    v,
    kind,
    sessionId,
    seq,
    ts: 1_000 + seq,
    payload,
  }
}
