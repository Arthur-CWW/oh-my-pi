import { appendFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "bun:test"
import { Effect } from "effect"

import { ingestOutbox } from "../src/ingest"
import { LedgerStore, openLedger } from "../src/ledger"
import { appendOutboxLine, outboxPathFor, type JsonValue } from "../src/outbox"
import { captureRawProviderPayload } from "../src/raw-capture"

test("ingest verifies raw references, accepts legacy inline bodies, and preserves partial-tail handling", async () => {
  const root = mkdtempSync(join(tmpdir(), "control-plane-ingest-raw-"))
  const outboxDir = join(root, "outbox")
  const rawDir = join(root, "raw")
  const dbPath = join(root, "ledger.sqlite")
  process.env["HOME"] = join(root, "home")
  process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] = outboxDir
  process.env["AGENT_CONTROL_PLANE_RAW_DIR"] = rawDir
  process.env["OMP_SESSION_CONTROL_DB"] = join(root, "session-control.sqlite")

  const captured = captureRawProviderPayload(
    { messages: ["referenced"] },
    1,
    { enabled: true, dir: rawDir, quotaBytes: 1024 * 1024, maxCaptureBytes: 1024 * 1024 },
  )
  expect(captured.reference).toBeDefined()

  const sessionId = "raw-ingest"
  const path = outboxPathFor(sessionId, outboxDir)
  const common: Record<string, JsonValue> = {
    ts: 1,
    machine: "test",
    session: sessionId,
    branchId: "root",
    agent: "omp",
    model: "model",
    provider: "provider",
    effort: "unknown",
    promptHash: "unknown",
    systemPromptHash: "unknown",
    skillProfile: "unknown",
    contextManifest: "unknown",
    packetId: "",
    tokensIn: 1,
    tokensOut: 1,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    latencyMs: 1,
    outcome: "ok",
    rawRequestArtifact: "",
    rawResponseArtifact: "",
  }
  expect(appendOutboxLine(path, {
    v: 1,
    kind: "modelCall",
    sessionId,
    seq: 0,
    ts: 1,
    payload: {
      ...common,
      id: "referenced-call",
      rawRequestSupport: "captured",
      rawRequestRef: captured.reference as JsonValue,
      rawRequest: { messages: ["must-not-win"] },
    },
  }).admitted).toBe(true)
  expect(appendOutboxLine(path, {
    v: 1,
    kind: "modelCall",
    sessionId,
    seq: 1,
    ts: 2,
    payload: {
      ...common,
      id: "legacy-call",
      rawRequestSupport: "captured",
      rawRequest: { messages: ["legacy"] },
    },
  }).admitted).toBe(true)
  expect(appendOutboxLine(path, {
    v: 1,
    kind: "modelCall",
    sessionId,
    seq: 2,
    ts: 3,
    payload: {
      ...common,
      id: "absent-support-fallback",
      rawRequestRef: { v: 2 },
      rawRequest: { messages: ["absent-fallback"] },
    },
  }).admitted).toBe(true)
  expect(appendOutboxLine(path, {
    v: 1,
    kind: "modelCall",
    sessionId,
    seq: 3,
    ts: 4,
    payload: {
      ...common,
      id: "digest-only-fallback",
      rawRequestSupport: "digest-only",
      rawRequestRef: { ...(captured.reference as object), digest: "0".repeat(64) } as JsonValue,
      rawRequest: { messages: ["digest-fallback"] },
    },
  }).admitted).toBe(true)
  expect(appendOutboxLine(path, {
    v: 1,
    kind: "modelCall",
    sessionId,
    seq: 4,
    ts: 5,
    payload: {
      ...common,
      id: "unsupported-fallback",
      rawRequestSupport: "unsupported",
      rawRequestRef: { ...(captured.reference as object), byteLength: (captured.reference?.byteLength ?? 0) + 1 } as JsonValue,
      rawRequest: { messages: ["unsupported-fallback"] },
    },
  }).admitted).toBe(true)
  appendFileSync(path, "{\"v\":1")

  await Effect.runPromise(Effect.gen(function* () {
    const result = yield* ingestOutbox(path, { rawDir })
    expect(result.malformed).toBe(1)
    const store = yield* LedgerStore
    const calls = yield* store.listModelCalls({ outcome: "ok" })
    expect(calls).toHaveLength(5)
    const contents: string[] = []
    for (const call of calls) {
      contents.push((yield* store.getArtifact(call.rawRequestArtifact)).content)
    }
    expect(contents.sort()).toEqual([
      "{\"messages\":[\"absent-fallback\"]}",
      "{\"messages\":[\"digest-fallback\"]}",
      "{\"messages\":[\"legacy\"]}",
      "{\"messages\":[\"referenced\"]}",
      "{\"messages\":[\"unsupported-fallback\"]}",
    ])
  }).pipe(Effect.provide(openLedger(dbPath))))
})
