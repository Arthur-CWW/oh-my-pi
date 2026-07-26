import { createHash } from "node:crypto"
import { appendFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "bun:test"

import {
  appendOutboxLine,
  defaultOutboxConfig,
  MAX_JSONL_SEGMENT_BYTES,
  MAX_OUTBOX_HOT_QUOTA_BYTES,
  MAX_SERIALIZED_OUTBOX_RECORD_BYTES,
  outboxPathFor,
  recoverOutboxSession,
  type OutboxConfig,
  type OutboxEnvelope,
  withOutboxWriterFence,
} from "../src/outbox"

test("outbox environment limits clamp to hard maxima and record fits segment", () => {
  const config = defaultOutboxConfig("/tmp/unused", {
    AGENT_CONTROL_PLANE_OUTBOX_SEGMENT_BYTES: `${Number.MAX_SAFE_INTEGER}`,
    AGENT_CONTROL_PLANE_OUTBOX_MAX_RECORD_BYTES: `${Number.MAX_SAFE_INTEGER}`,
    AGENT_CONTROL_PLANE_OUTBOX_HOT_QUOTA_BYTES: `${Number.MAX_SAFE_INTEGER}`,
  })
  expect(config.segmentMaxBytes).toBe(MAX_JSONL_SEGMENT_BYTES)
  expect(config.maxRecordBytes).toBe(MAX_SERIALIZED_OUTBOX_RECORD_BYTES)
  expect(config.maxRecordBytes).toBeLessThanOrEqual(config.segmentMaxBytes)
  expect(config.hotQuotaBytes).toBe(MAX_OUTBOX_HOT_QUOTA_BYTES)

  const smallSegment = defaultOutboxConfig("/tmp/unused", {
    AGENT_CONTROL_PLANE_OUTBOX_SEGMENT_BYTES: "1024",
    AGENT_CONTROL_PLANE_OUTBOX_MAX_RECORD_BYTES: "2048",
  })
  expect(smallSegment.maxRecordBytes).toBe(1024)
})

test("writer fence excludes append through the exact publisher lock", () => {
  const root = mkdtempSync(join(tmpdir(), "control-plane-outbox-fence-"))
  const outboxDir = join(root, "outbox")
  const sessionId = "fenced"
  const path = outboxPathFor(sessionId, outboxDir)
  const envelope: OutboxEnvelope = { v: 1, kind: "event", sessionId, seq: 0, ts: 1, payload: null }

  withOutboxWriterFence(sessionId, outboxDir, () => {
    expect(appendOutboxLine(path, envelope)).toMatchObject({ admitted: false, reason: "lock-busy" })
    const lockPath = join(
      outboxDir,
      `.publisher.${createHash("sha256").update(sessionId).digest("hex").slice(0, 32)}.lock`,
    )
    writeFileSync(join(lockPath, "owner.json"), `${JSON.stringify({
      v: 1,
      host: hostname(),
      pid: process.pid,
      createdAt: 0,
    })}\n`)
    expect(appendOutboxLine(path, envelope)).toMatchObject({ admitted: false, reason: "lock-busy" })
  })
  expect(appendOutboxLine(path, envelope).admitted).toBe(true)
})

test("outbox rejects record and quota limits with typed receipts", () => {
  const root = mkdtempSync(join(tmpdir(), "control-plane-outbox-"))
  const outboxDir = join(root, "outbox")
  process.env["HOME"] = join(root, "home")
  process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] = outboxDir
  process.env["OMP_SESSION_CONTROL_DB"] = join(root, "session-control.sqlite")
  const path = outboxPathFor("limits", outboxDir)
  const envelope: OutboxEnvelope = { v: 1, kind: "event", sessionId: "limits", seq: 0, ts: 1, payload: { value: "x".repeat(200) } }

  const recordConfig: OutboxConfig = { dir: outboxDir, segmentMaxBytes: 1024, maxRecordBytes: 100, hotQuotaBytes: 1024 * 1024 }
  expect(appendOutboxLine(path, envelope, recordConfig)).toMatchObject({ admitted: false, reason: "line-too-large", seq: 0 })

  const quotaConfig: OutboxConfig = { dir: outboxDir, segmentMaxBytes: 1024, maxRecordBytes: 1024, hotQuotaBytes: 1 }
  expect(appendOutboxLine(path, { ...envelope, payload: null }, quotaConfig)).toMatchObject({ admitted: false, reason: "hot-quota-exceeded", seq: 0 })
})

test("outbox rotates only complete records and recovery quarantines a crash tail", () => {
  const root = mkdtempSync(join(tmpdir(), "control-plane-outbox-"))
  const outboxDir = join(root, "outbox")
  process.env["HOME"] = join(root, "home")
  process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] = outboxDir
  process.env["OMP_SESSION_CONTROL_DB"] = join(root, "session-control.sqlite")
  const sessionId = "rotation"
  const path = outboxPathFor(sessionId, outboxDir)
  const config: OutboxConfig = { dir: outboxDir, segmentMaxBytes: 230, maxRecordBytes: 220, hotQuotaBytes: 1024 * 1024 }
  const first: OutboxEnvelope = { v: 1, kind: "event", sessionId, seq: 0, ts: 1, payload: { value: "a".repeat(90) } }
  const second: OutboxEnvelope = { v: 1, kind: "event", sessionId, seq: 1, ts: 2, payload: { value: "b".repeat(90) } }

  expect(appendOutboxLine(path, first, config).admitted).toBe(true)
  const rotated = appendOutboxLine(path, second, config)
  expect(rotated.admitted).toBe(true)
  expect(rotated.admitted && rotated.sealedPath).toBeDefined()
  expect(readFileSync(rotated.admitted ? rotated.sealedPath ?? "" : "", "utf8").endsWith("\n")).toBe(true)
  expect(readFileSync(path, "utf8").trimEnd().split("\n")).toHaveLength(1)
  expect(statSync(path).isFile()).toBe(true)
  expect(statSync(rotated.admitted ? rotated.sealedPath ?? "" : "").isFile()).toBe(true)
  expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ sessionId, seq: 1 })

  appendFileSync(path, "{\"v\":1")
  const rejected = appendOutboxLine(path, { ...second, seq: 2, ts: 3 }, config)
  expect(rejected).toMatchObject({ admitted: false, reason: "tail-repair-failed", seq: 2 })
  expect(recoverOutboxSession(path, sessionId, config)).toMatchObject({ recovered: true, nextSeq: 2 })
  expect(appendOutboxLine(path, { ...second, seq: 2, ts: 3 }, config).admitted).toBe(true)
  expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true)
})
