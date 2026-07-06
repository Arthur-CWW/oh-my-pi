import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { Database } from "bun:sqlite"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect } from "effect"

import { ingestOutbox } from "../src/ingest"
import { LedgerStore, openLedger, type ModelCallInput } from "../src/ledger"
import { migration0001Sql } from "../src/migrate"
import { appendOutboxLine, type JsonValue, type OutboxEnvelope } from "../src/outbox"
import type { ModelCallRow } from "../src/schema"

const tmpDir = join(import.meta.dir, ".tmp", "attribution")

beforeAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

test("fresh migration stores and filters assistant attribution fields", async () => {
  const dbPath = join(tmpDir, "fresh.sqlite")

  await Effect.runPromise(Effect.gen(function* () {
    const store = yield* LedgerStore

    expect((yield* store.recordModelCall(modelCallInput({
      id: "model-call-attributed",
      entryId: "assistant-entry-1",
      upstreamProvider: "anthropic",
    }))).inserted).toBe(true)
    expect((yield* store.recordModelCall(modelCallInput({
      id: "model-call-other-entry",
      entryId: "assistant-entry-2",
      upstreamProvider: "openai",
    }))).inserted).toBe(true)

    const rows = yield* store.listModelCalls({ entryId: "assistant-entry-1" })
    expect(rows.map((row) => row.id)).toEqual(["model-call-attributed"])
    expect(rows[0]?.entryId).toBe("assistant-entry-1")
    expect(rows[0]?.upstreamProvider).toBe("anthropic")
  }).pipe(Effect.provide(openLedger(dbPath))))

  expect(readUserVersion(dbPath)).toBe(2)
})

test("v1 ledger upgrades model call attribution columns in place", async () => {
  const dbPath = join(tmpDir, "upgrade-v1.sqlite")
  const sqlite = new Database(dbPath)
  try {
    sqlite.exec(migration0001Sql)
    sqlite.exec(`
      INSERT INTO model_calls (
        id, ts, machine, session, branchId, agent, model, provider, effort,
        promptHash, systemPromptHash, skillProfile, contextManifest, packetId,
        tokensIn, tokensOut, cacheRead, cacheWrite, cost, latencyMs, outcome,
        errorClass, retryOf, fallbackFrom, rawRequestArtifact, rawResponseArtifact
      ) VALUES (
        'model-call-v1', 1000, 'm1', 'session-v1', 'branch-v1', 'AttributionLedger',
        'gpt-v1', 'openai', 'medium', 'prompt-hash', 'system-hash', 'skills',
        'context-artifact', 'packet-v1', 10, 20, 0, 0, 0.01, 250, 'ok',
        NULL, NULL, NULL, 'raw-request', 'raw-response'
      );
    `)
    expect(readUserVersionFromConnection(sqlite)).toBe(1)
  } finally {
    sqlite.close()
  }

  await Effect.runPromise(Effect.gen(function* () {
    const store = yield* LedgerStore
    const rows = yield* store.listModelCalls({ session: "session-v1" })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe("model-call-v1")
    expect(rows[0]?.entryId).toBeNull()
    expect(rows[0]?.upstreamProvider).toBeNull()
  }).pipe(Effect.provide(openLedger(dbPath))))

  expect(readUserVersion(dbPath)).toBe(2)
})

test("ingest preserves nullable model call attribution payload fields", async () => {
  const dbPath = join(tmpDir, "ingest.sqlite")
  const outboxPath = join(tmpDir, "attribution-outbox.jsonl")

  appendOutboxLine(outboxPath, envelope(1, "modelCall", modelCallPayload({
    id: "ingest-with-attribution",
    entryId: "assistant-entry-ingest",
    upstreamProvider: "anthropic",
  })))
  appendOutboxLine(outboxPath, envelope(2, "modelCall", modelCallPayload({
    id: "ingest-without-attribution",
  })))

  await Effect.runPromise(Effect.gen(function* () {
    const result = yield* ingestOutbox(outboxPath)
    expect(result).toEqual({ inserted: 2, ignored: 0, malformed: 0 })

    const store = yield* LedgerStore
    const attributedRows = yield* store.listModelCalls({ entryId: "assistant-entry-ingest" })
    expect(attributedRows.map((row) => row.id)).toEqual(["ingest-with-attribution"])
    expect(attributedRows[0]?.upstreamProvider).toBe("anthropic")

    const rows = yield* store.listModelCalls({ session: "session-ingest-attribution" })
    const unattributed = requireRow(rows, "ingest-without-attribution")
    expect(unattributed.entryId).toBeNull()
    expect(unattributed.upstreamProvider).toBeNull()
  }).pipe(Effect.provide(openLedger(dbPath))))
})

interface ModelCallOverrides {
  readonly id: string
  readonly entryId?: string
  readonly upstreamProvider?: string
}

function modelCallInput(overrides: ModelCallOverrides): ModelCallInput {
  return {
    id: overrides.id,
    ts: 1_800,
    machine: "m1",
    session: "session-attribution",
    ...(overrides.entryId !== undefined ? { entryId: overrides.entryId } : {}),
    branchId: "branch-attribution",
    agent: "AttributionLedger",
    model: "gpt-attribution",
    provider: "openrouter",
    ...(overrides.upstreamProvider !== undefined ? { upstreamProvider: overrides.upstreamProvider } : {}),
    effort: "medium",
    promptHash: "prompt-hash",
    systemPromptHash: "system-hash",
    skillProfile: "skills-fixture",
    contextManifest: "context-artifact",
    packetId: "packet-attribution",
    tokensIn: 10,
    tokensOut: 20,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0.01,
    latencyMs: 250,
    outcome: "ok",
    rawRequestArtifact: "raw-request",
    rawResponseArtifact: "raw-response",
  }
}

function modelCallPayload(overrides: ModelCallOverrides): JsonValue {
  const payload: { [key: string]: JsonValue } = {
    id: overrides.id,
    machine: "m1",
    branchId: "branch-ingest-attribution",
    agent: "AttributionLedger",
    model: "claude-3-5-sonnet",
    provider: "openrouter",
    effort: "medium",
    promptHash: "prompt-hash",
    systemPromptHash: "system-hash",
    skillProfile: "skills-fixture",
    contextManifest: "context-artifact",
    packetId: "packet-ingest-attribution",
    tokensIn: 11,
    tokensOut: 22,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0.02,
    latencyMs: 350,
    outcome: "ok",
    rawRequestArtifact: "raw-request",
    rawResponseArtifact: "raw-response",
  }
  if (overrides.entryId !== undefined) {
    payload.entryId = overrides.entryId
  }
  if (overrides.upstreamProvider !== undefined) {
    payload.upstreamProvider = overrides.upstreamProvider
  }
  return payload
}

function envelope(seq: number, kind: string, payload: JsonValue): OutboxEnvelope {
  return {
    v: 1,
    kind,
    sessionId: "session-ingest-attribution",
    seq,
    ts: 2_000 + seq,
    payload,
  }
}

function requireRow(rows: readonly ModelCallRow[], id: string): ModelCallRow {
  const row = rows.find((candidate) => candidate.id === id)
  if (row === undefined) {
    throw new Error(`missing model call row ${id}`)
  }
  return row
}

function readUserVersion(path: string): number {
  const sqlite = new Database(path)
  try {
    return readUserVersionFromConnection(sqlite)
  } finally {
    sqlite.close()
  }
}

function readUserVersionFromConnection(sqlite: Database): number {
  return sqlite.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? -1
}
