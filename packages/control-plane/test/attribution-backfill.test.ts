import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"

import { ingestOutbox } from "../src/ingest"
import { LedgerStore, openLedger } from "../src/ledger"
import type { ExtensionContextLike, PiLike, SessionEntryLike } from "../src/omp-events"
import createOmpPublisher from "../src/omp-publisher"
import { OutboxEnvelopeSchema, outboxPathFor, type JsonValue } from "../src/outbox"

const tmpDir = join(import.meta.dir, ".tmp", "attribution-backfill")

class FakePi {
  private readonly handlers: Record<string, Array<(event: never, ctx: ExtensionContextLike) => unknown>> = {}

  on(event: string, handler: (event: never, ctx: ExtensionContextLike) => unknown): void {
    this.handlers[event] = [...(this.handlers[event] ?? []), handler]
  }

  emit<E>(event: string, payload: E, ctx: ExtensionContextLike): void {
    for (const handler of this.handlers[event] ?? []) {
      handler(payload as never, ctx)
    }
  }
}

test("publisher backfills model call attribution from the next persisted entry scan", async () => {
  rmSync(tmpDir, { recursive: true, force: true })

  const sessionId = "session-attribution-backfill"
  const outboxDir = join(tmpDir, "outbox")
  const dbPath = join(tmpDir, "ledger.sqlite")
  const sessionFile = join(tmpDir, "sessions", "2026-07-06_session-attribution-backfill.jsonl")
  process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] = outboxDir

  const assistantTimestamp = 2_000
  const missTimestamp = 3_000
  let entries: ReadonlyArray<SessionEntryLike> = []
  const ctx = {
    cwd: "/repo/attribution",
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => sessionFile,
      getEntries: () => entries,
    },
  } satisfies ExtensionContextLike

  const pi = new FakePi()
  createOmpPublisher(pi as PiLike)

  pi.emit("session_start", { type: "session_start", timestamp: 1_000, title: "Attribution" }, ctx)
  pi.emit("message_end", {
    type: "message_end",
    message: {
      role: "assistant",
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      thinkingLevel: "high",
      usage: { input: 10, output: 20, totalTokens: 30 },
      timestamp: assistantTimestamp,
    },
  }, ctx)
  entries = [{ id: "entry-1", message: { role: "assistant", timestamp: assistantTimestamp } }]
  pi.emit("turn_end", { type: "turn_end", turnIndex: 1, timestamp: 2_100, duration: 100, toolResults: [] }, ctx)

  pi.emit("message_end", {
    type: "message_end",
    message: {
      role: "assistant",
      provider: "openai",
      model: "gpt-miss",
      usage: { input: 1, output: 2, totalTokens: 3 },
      timestamp: missTimestamp,
    },
  }, ctx)
  pi.emit("message_start", { type: "message_start", timestamp: 3_100 }, ctx)
  pi.emit("session_shutdown", { type: "session_shutdown", timestamp: 3_200, reason: "fixture" }, ctx)

  const outboxPath = outboxPathFor(sessionId, outboxDir)
  const envelopes = readFileSync(outboxPath, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => Schema.decodeUnknownSync(OutboxEnvelopeSchema)(JSON.parse(line) as unknown))

  const modelPayloads = envelopes.filter((envelope) => envelope.kind === "modelCall").map((envelope) => jsonRecord(envelope.payload))
  const attributedModel = requirePayload(modelPayloads, "model", "claude-3-5-sonnet")
  const attributedModelId = attributedModel.id
  if (typeof attributedModelId !== "string") {
    throw new Error("expected attributed model id")
  }
  expect(attributedModel.attribution).toBe("anthropic/claude-3-5-sonnet:high")

  const eventPayloads = envelopes.filter((envelope) => envelope.kind === "event").map((envelope) => jsonRecord(envelope.payload))
  const attributionEvent = requirePayload(eventPayloads, "kind", "attribution")
  const attributionPayload = jsonRecord(attributionEvent.payload ?? null)
  expect(attributionPayload.modelCallId).toBe(attributedModelId)
  expect(attributionPayload.entryId).toBe("entry-1")
  expect(attributionPayload.attribution).toBe("anthropic/claude-3-5-sonnet:high")

  const missEvent = requirePayload(eventPayloads, "kind", "attributionMiss")
  const missPayload = jsonRecord(missEvent.payload ?? null)
  expect(missPayload.reason).toBe("entryNotFound")

  await Effect.runPromise(Effect.gen(function* () {
    const first = yield* ingestOutbox(outboxPath, { batchSize: 2 })
    expect(first.malformed).toBe(0)

    const second = yield* ingestOutbox(outboxPath, { batchSize: 2 })
    expect(second.inserted).toBe(0)
    expect(second.malformed).toBe(0)

    const store = yield* LedgerStore
    const attributedRows = yield* store.listModelCalls({ entryId: "entry-1" })
    expect(attributedRows.map((row) => row.id)).toEqual([attributedModelId])
    expect(attributedRows[0]?.entryId).toBe("entry-1")

    const events = yield* store.listEvents({ kind: "attribution" })
    expect(events).toHaveLength(1)
  }).pipe(Effect.provide(openLedger(dbPath))))
})

function jsonRecord(value: JsonValue): Record<string, JsonValue> {
  expect(value).not.toBeNull()
  expect(Array.isArray(value)).toBe(false)
  expect(typeof value).toBe("object")
  return value as Record<string, JsonValue>
}

function requirePayload(records: readonly Record<string, JsonValue>[], key: string, value: string): Record<string, JsonValue> {
  const record = records.find((candidate) => candidate[key] === value)
  expect(record).toBeDefined()
  return record ?? {}
}
