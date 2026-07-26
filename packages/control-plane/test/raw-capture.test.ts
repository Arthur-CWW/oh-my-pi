import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { expect, test } from "bun:test"
import { Schema } from "effect"

import { contentObjectPathFor, MAX_RAW_CAPTURE_INPUT_BYTES, RawContentReferenceV1Schema } from "../src/outbox"
import {
  captureRawProviderPayload,
  defaultRawCaptureConfig,
  MAX_RAW_CAPTURE_QUOTA_BYTES,
} from "../src/raw-capture"

test("raw capture environment limits clamp to hard maxima", () => {
  const config = defaultRawCaptureConfig({
    AGENT_CONTROL_PLANE_RAW_QUOTA_BYTES: `${Number.MAX_SAFE_INTEGER}`,
    AGENT_CONTROL_PLANE_RAW_MAX_CAPTURE_BYTES: `${Number.MAX_SAFE_INTEGER}`,
  })
  expect(config.quotaBytes).toBe(MAX_RAW_CAPTURE_QUOTA_BYTES)
  expect(config.maxCaptureBytes).toBe(MAX_RAW_CAPTURE_INPUT_BYTES)
})

test("raw capture writes the exact redacted v1 reference and reuses canonical content", () => {
  const root = mkdtempSync(join(tmpdir(), "control-plane-raw-"))
  const rawDir = join(root, "raw")
  process.env["HOME"] = join(root, "home")
  process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] = join(root, "outbox")
  process.env["OMP_SESSION_CONTROL_DB"] = join(root, "session-control.sqlite")

  const config = { enabled: true, dir: rawDir, quotaBytes: 1024 * 1024, maxCaptureBytes: 1024 * 1024 }
  const first = captureRawProviderPayload({ secretKey: "secret", nested: { token: "hidden" } }, 1, config)
  const second = captureRawProviderPayload({ nested: { token: "hidden" }, secretKey: "secret" }, 2, config)

  expect(first.status).toBe("stored")
  expect(second.status).toBe("duplicate")
  expect(second.sha256).toBe(first.sha256)
  expect(second.artifactPath).toBe(first.artifactPath)
  const reference = Schema.decodeUnknownSync(RawContentReferenceV1Schema)(first.reference)
  expect(reference).toEqual({
    v: 1,
    algorithm: "sha256",
    digest: first.sha256,
    byteLength: first.bytes,
    contentType: "application/json",
    representation: "json-utf8",
    summary: { redacted: true, valueType: "object", itemCount: 2 },
  })
  expect(JSON.stringify(reference)).not.toContain("secretKey")
  expect(JSON.stringify(reference)).not.toContain("hidden")
  expect(first.artifactPath).toBe(contentObjectPathFor(rawDir, first.sha256))
  expect(readFileSync(first.artifactPath ?? "", "utf8"))
    .toBe("{\"nested\":{\"token\":\"hidden\"},\"secretKey\":\"secret\"}")
})

test("raw capture refuses corrupt reuse, oversize input, and ignores crash temp files", () => {
  const root = mkdtempSync(join(tmpdir(), "control-plane-raw-"))
  const rawDir = join(root, "raw")
  process.env["HOME"] = join(root, "home")
  process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] = join(root, "outbox")
  process.env["OMP_SESSION_CONTROL_DB"] = join(root, "session-control.sqlite")

  const config = { enabled: true, dir: rawDir, quotaBytes: 1024 * 1024, maxCaptureBytes: 1024 * 1024 }
  const stored = captureRawProviderPayload({ value: "original" }, 1, config)
  writeFileSync(stored.artifactPath ?? "", "corrupt")
  expect(captureRawProviderPayload({ value: "original" }, 2, config).status).toBe("capture-failed")

  const linked = captureRawProviderPayload({ value: "linked" }, 2, { ...config, enabled: false })
  const linkedPath = contentObjectPathFor(rawDir, linked.sha256)
  const outside = join(root, "outside.json")
  writeFileSync(outside, "{\"value\":\"linked\"}")
  mkdirSync(dirname(linkedPath), { recursive: true })
  symlinkSync(outside, linkedPath)
  expect(captureRawProviderPayload({ value: "linked" }, 2, config).status).toBe("capture-failed")

  const freshDigest = captureRawProviderPayload({ value: "fresh" }, 3, { ...config, enabled: false }).sha256
  const crashTemp = `${contentObjectPathFor(rawDir, freshDigest)}.tmp-crash`
  mkdirSync(dirname(crashTemp), { recursive: true })
  writeFileSync(crashTemp, "incomplete")
  const fresh = captureRawProviderPayload({ value: "fresh" }, 4, config)
  expect(fresh.status).toBe("stored")
  expect(readFileSync(fresh.artifactPath ?? "", "utf8")).toBe("{\"value\":\"fresh\"}")

  const oversize = captureRawProviderPayload("12345", 5, { ...config, maxCaptureBytes: 3 })
  expect(oversize.status).toBe("payload-too-large")
  expect(oversize.reference).toBeUndefined()
})

test("raw capture never commits through a parent swapped after descriptor validation", () => {
  const root = mkdtempSync(join(tmpdir(), "control-plane-raw-race-"))
  const rawDir = join(root, "raw")
  const attacker = join(root, "attacker")
  const moved = join(root, "verified-directory")
  mkdirSync(attacker, { recursive: true })
  process.env.HOME = join(root, "home")
  process.env.AGENT_CONTROL_PLANE_OUTBOX_DIR = join(root, "outbox")
  process.env.OMP_SESSION_CONTROL_DB = join(root, "session-control.sqlite")
  const base = { enabled: true, dir: rawDir, quotaBytes: 1024 * 1024, maxCaptureBytes: 1024 * 1024 }
  const digest = captureRawProviderPayload({ value: "raced" }, 1, { ...base, enabled: false }).sha256
  const canonicalDirectory = dirname(contentObjectPathFor(rawDir, digest))
  const result = captureRawProviderPayload({ value: "raced" }, 2, {
    ...base,
    beforeObjectCommit: () => {
      renameSync(canonicalDirectory, moved)
      symlinkSync(attacker, canonicalDirectory)
    },
  })
  expect(result.status).toBe("capture-failed")
  expect(readdirSync(attacker)).toEqual([])
  expect(readdirSync(moved)).toEqual([])
})

test("raw capture rejects symlink parents and cannot steal an old live-owner lock", () => {
  const root = mkdtempSync(join(tmpdir(), "control-plane-raw-fence-"))
  process.env.HOME = join(root, "home")
  process.env.AGENT_CONTROL_PLANE_OUTBOX_DIR = join(root, "outbox")
  process.env.OMP_SESSION_CONTROL_DB = join(root, "session-control.sqlite")
  const config = {
    enabled: true,
    dir: join(root, "symlink-raw"),
    quotaBytes: 1024 * 1024,
    maxCaptureBytes: 1024 * 1024,
  }
  const outside = join(root, "outside")
  mkdirSync(config.dir, { recursive: true })
  mkdirSync(outside, { recursive: true })
  symlinkSync(outside, join(config.dir, "objects"))
  expect(captureRawProviderPayload({ value: "blocked-parent" }, 1, config).status)
    .toBe("capture-failed")
  expect(readdirSync(outside)).toEqual([])

  const fencedDir = join(root, "fenced-raw")
  const lockPath = join(fencedDir, ".capture.lock")
  mkdirSync(lockPath, { recursive: true })
  writeFileSync(join(lockPath, "owner.json"), `${JSON.stringify({
    v: 1,
    host: hostname(),
    pid: process.pid,
    createdAt: 0,
  })}\n`)
  expect(captureRawProviderPayload({ value: "live-lock" }, 2, {
    ...config,
    dir: fencedDir,
  }).status).toBe("capture-failed")
})
