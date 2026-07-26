import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"

import { LedgerStore, openLedger } from "../src/ledger"
import { appendOutboxLine, outboxPathFor, type JsonValue } from "../src/outbox"
import { captureRawProviderPayload } from "../src/raw-capture"
import { maintainStorage } from "../src/storage"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test("storage maintenance passes its configured raw CAS root to ingestion", async () => {
  const root = mkdtempSync(join(tmpdir(), "control-plane-storage-raw-"))
  roots.push(root)
  const outboxDir = join(root, "outbox")
  const rawDir = join(root, "custom-raw")
  const archiveDir = join(root, "archive")
  const stateDbPath = join(root, "control", "storage.sqlite")
  const ledgerPath = join(root, "control", "ledger.sqlite")
  process.env.HOME = join(root, "home")
  process.env.AGENT_CONTROL_PLANE_OUTBOX_DIR = outboxDir
  process.env.AGENT_CONTROL_PLANE_RAW_DIR = join(root, "wrong-default-raw")
  process.env.AGENT_CONTROL_PLANE_DB = ledgerPath
  process.env.OMP_SESSION_CONTROL_DB = join(root, "control", "session-control.sqlite")

  const capture = captureRawProviderPayload(
    { messages: ["configured-root"] },
    Date.now(),
    { enabled: true, dir: rawDir, quotaBytes: 1024 * 1024, maxCaptureBytes: 1024 * 1024 },
  )
  if (capture.reference === undefined) throw new Error("raw capture failed")
  const sessionId = "storage-raw-root"
  const common: Record<string, JsonValue> = {
    id: `${sessionId}:modelCall:0`,
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
    rawRequestSupport: "captured",
    rawRequestRef: capture.reference as JsonValue,
  }
  expect(appendOutboxLine(outboxPathFor(sessionId, outboxDir), {
    v: 1,
    kind: "modelCall",
    sessionId,
    seq: 0,
    ts: 1,
    payload: common,
  }).admitted).toBeTrue()

  const result = await maintainStorage({
    config: {
      outboxDir,
      archiveDir,
      stateDbPath,
      rawDir,
      segmentBytes: 1024 * 1024,
      maxActionsPerRun: 32,
    },
    mode: "apply",
    activeSessionIds: [],
  })
  expect(result.actions.some((action) => action.kind === "ingest")).toBeTrue()

  await Effect.runPromise(Effect.gen(function* () {
    const store = yield* LedgerStore
    const calls = yield* store.listModelCalls({ session: sessionId })
    expect(calls).toHaveLength(1)
    const artifact = yield* store.getArtifact(calls[0]?.rawRequestArtifact ?? "")
    expect(artifact.content).toBe("{\"messages\":[\"configured-root\"]}")
  }).pipe(Effect.provide(openLedger(ledgerPath))))
})
