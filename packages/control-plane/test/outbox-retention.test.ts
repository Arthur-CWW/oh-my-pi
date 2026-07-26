import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync, truncateSync, unlinkSync, utimesSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterAll, beforeAll, describe, expect, test } from "bun:test"

import { appendOutboxLine, contentObjectPathFor, outboxLeasePathFor, outboxTerminalPathFor, type OutboxAppendReceipt } from "../src/outbox"
import { createIngestDaemon } from "../src/daemon"
import { fleetSyncImmutableTransferClaimBytes, outboxRetentionStatus, pruneOutbox, type FleetSyncImmutableTransferClaimV2, type OutboxRetentionOptions } from "../src/outbox-retention"

const NOW = Date.parse("2026-07-26T12:00:00.000Z")
const OLD = new Date(NOW - 48 * 60 * 60 * 1_000)
const ENV_KEYS = ["HOME", "AGENT_CONTROL_PLANE_OUTBOX_DIR", "OMP_SESSION_CONTROL_DB"] as const
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

interface Fixture {
  readonly root: string
  readonly options: OutboxRetentionOptions
  readonly path: string
  readonly sessionId: string
}

describe.serial("outbox retention", () => {
  beforeAll(() => {
    const isolation = mkdtempSync(join(tmpdir(), "control-plane-retention-env-"))
    process.env.HOME = join(isolation, "home")
    process.env.AGENT_CONTROL_PLANE_OUTBOX_DIR = join(isolation, "outbox")
    process.env.OMP_SESSION_CONTROL_DB = join(isolation, "control", "session-control.sqlite")
  })

  afterAll(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  test("inventories a sparse 15 GiB-equivalent source from stat without allocating or scanning it", () => {
    const fixture = emptyFixture("sparse")
    truncateSync(fixture.path, 15 * 1024 * 1024 * 1024)
    const result = outboxRetentionStatus(fixture.options)
    expect(result.files[0]).toMatchObject({ bytes: 15 * 1024 * 1024 * 1024, eligible: false, reason: "missing-terminal", sourceSha256: null })
  })

  test("rejects a partial final line", () => {
    const fixture = eligibleFixture("partial", Buffer.from('{"kind":"modelCall"}'))
    expect(outboxRetentionStatus(fixture.options).files[0]?.reason).toBe("partial-final-line")
  })

  test("rejects unknown, fresh, and live owners", () => {
    const unknown = eligibleFixture("unknown")
    const unknownOwner = { host: "unrecognized-host", pid: 8675309, leaseId: "lease" }
    writeProof(unknown, readFileSync(unknown.path), OLD.toISOString(), unknownOwner)
    expect(outboxRetentionStatus(unknown.options).files[0]?.reason).toBe("owner-unknown")

    const fresh = eligibleFixture("fresh")
    writeLease(fresh, { host: hostname(), pid: process.pid, leaseId: "lease" }, undefined, new Date(NOW).toISOString())
    expect(outboxRetentionStatus(fresh.options).files[0]?.reason).toBe("owner-fresh")

    const live = eligibleFixture("live")
    writeLease(live, { host: hostname(), pid: process.pid, leaseId: "lease" }, undefined, OLD.toISOString())
    expect(outboxRetentionStatus(live.options).files[0]?.reason).toBe("owner-live")
  })

  test("rejects the explicitly current source", () => {
    const fixture = eligibleFixture("current")
    const options = { ...fixture.options, currentFile: fixture.path }
    expect(outboxRetentionStatus(options).files[0]?.reason).toBe("current-file")
  })

  test("rejects a corrupt referenced object without parsing its body", () => {
    const digest = sha(Buffer.from('{"secret":"expected"}'))
    const ref = { v: 1, algorithm: "sha256", digest, byteLength: 21, contentType: "application/json", representation: "json-utf8", summary: { redacted: true, valueType: "object", itemCount: 1 } }
    const fixture = eligibleFixture("corrupt-ref", Buffer.from(`${JSON.stringify({ v: 1, payload: { rawRequestRef: ref } })}\n`))
    if (fixture.options.rawDir === undefined) throw new Error("missing raw fixture directory")
    const objectPath = contentObjectPathFor(fixture.options.rawDir, digest)
    mkdirSync(dirname(objectPath), { recursive: true })
    writeFileSync(objectPath, '{"secret":"tampered"}')
    expect(outboxRetentionStatus(fixture.options).files[0]?.reason).toBe("corrupt-reference")
  })

  test("rejects a source inside the grace period", () => {
    const fixture = eligibleFixture("young")
    const bytes = readFileSync(fixture.path)
    writeProof(fixture, bytes, new Date(NOW).toISOString())
    expect(outboxRetentionStatus(fixture.options).files[0]?.reason).toBe("too-young")
  })

  test("rejects cursor digest mismatch", () => {
    const fixture = eligibleFixture("cursor-mismatch")
    const cursor = JSON.parse(readFileSync(fixture.options.cursorPath, "utf8")) as { files: Record<string, { sha256: string }> }
    const cursorEntry = cursor.files[fixture.path]
    if (cursorEntry === undefined) throw new Error("missing cursor fixture")
    cursorEntry.sha256 = "0".repeat(64)
    writeFileSync(fixture.options.cursorPath, JSON.stringify(cursor))
    expect(outboxRetentionStatus(fixture.options).files[0]?.reason).toBe("cursor-digest-mismatch")
  })

  test("projects logical reclaim bytes only for a fully verified candidate", () => {
    const fixture = eligibleFixture("eligible")
    const result = outboxRetentionStatus(fixture.options)
    expect(result.files[0]).toMatchObject({ eligible: true, reason: "eligible", projectedReclaimBytes: statSync(fixture.path).size })
    expect(result.projectedReclaimBytes).toBe(statSync(fixture.path).size)
  })

  test("projects a fully ingested sealed rotation only after session terminal release", () => {
    const fixture = eligibleFixture("sealed")
    const bytes = readFileSync(fixture.path)
    const digest = sha(bytes)
    const sealedDir = join(fixture.options.outboxDir, "sealed")
    const sealedPath = join(sealedDir, `${encodeURIComponent(fixture.sessionId)}.0-0.${digest}.jsonl`)
    mkdirSync(sealedDir, { recursive: true })
    renameSync(fixture.path, sealedPath)
    const stat = statSync(sealedPath)
    writeFileSync(fixture.options.cursorPath, JSON.stringify({
      version: 2,
      files: { [sealedPath]: { device: stat.dev, inode: stat.ino, offset: bytes.length, modifiedAt: stat.mtimeMs, sha256: digest } },
    }))
    const result = outboxRetentionStatus(fixture.options)
    expect(result.files[0]).toMatchObject({ path: sealedPath, sessionId: fixture.sessionId, eligible: true, reason: "eligible" })
  })

  test("CLI status and prune dry-run emit JSON without applying", () => {
    const fixture = eligibleFixture("cli")
    if (fixture.options.rawDir === undefined) throw new Error("missing raw fixture directory")
    const common = [
      "--outbox", fixture.options.outboxDir,
      "--cursor", fixture.options.cursorPath,
      "--archive", fixture.options.archiveDir,
      "--raw", fixture.options.rawDir,
      "--grace-ms", String(fixture.options.graceMs),
      "--json",
    ]
    const env = {
      ...process.env,
      HOME: join(fixture.root, "home"),
      AGENT_CONTROL_PLANE_OUTBOX_DIR: fixture.options.outboxDir,
      OMP_SESSION_CONTROL_DB: join(fixture.root, "control", "session-control.sqlite"),
    }
    const cli = join(import.meta.dir, "../src/cli.ts")
    const status = Bun.spawnSync(["bun", cli, "outbox", "status", ...common], { env })
    expect(status.exitCode).toBe(0)
    expect((JSON.parse(status.stdout.toString()) as { files: unknown[] }).files).toHaveLength(1)
    const dryRun = Bun.spawnSync(["bun", cli, "outbox", "prune", "--dry-run", ...common], { env })
    expect(dryRun.exitCode).toBe(0)
    expect(existsSync(fixture.path)).toBeTrue()
  })

  test("recovers each durable apply crash point and is idempotent", () => {
    for (const crashPoint of ["after-manifest", "after-authorization", "after-unlink"] as const) {
      const fixture = eligibleFixture(`crash-${crashPoint}`)
      expect(() => pruneOutbox({ ...fixture.options, crashPoint }, "apply")).toThrow(`Injected retention crash: ${crashPoint}`)
      pruneOutbox(fixture.options, "apply")
      expect(existsSync(fixture.path)).toBeFalse()
      const receipts = join(fixture.options.archiveDir, "receipts")
      expect(countFiles(receipts, ".authorization.json")).toBe(1)
      expect(countFiles(receipts, ".completion.json")).toBe(1)
      pruneOutbox(fixture.options, "apply")
      expect(countFiles(receipts, ".authorization.json")).toBe(1)
      expect(countFiles(receipts, ".completion.json")).toBe(1)
    }
  })

  test("dry-run never writes a missing completion receipt during crash recovery", () => {
    const fixture = eligibleFixture("dry-run-recovery")
    expect(() => pruneOutbox({ ...fixture.options, crashPoint: "after-unlink" }, "apply"))
      .toThrow("Injected retention crash: after-unlink")
    const receipts = join(fixture.options.archiveDir, "receipts")
    expect(countFiles(receipts, ".completion.json")).toBe(0)
    pruneOutbox(fixture.options, "dry-run")
    expect(countFiles(receipts, ".completion.json")).toBe(0)
    pruneOutbox(fixture.options, "apply")
    expect(countFiles(receipts, ".completion.json")).toBe(1)
  })

  test("publisher append cannot interleave with final prune verification and unlink", () => {
    const fixture = eligibleFixture("prune-race")
    let appendReceipt: OutboxAppendReceipt | undefined
    pruneOutbox({
      ...fixture.options,
      beforeFinalUnlink: () => {
        appendReceipt = appendOutboxLine(fixture.path, {
          v: 1,
          kind: "event",
          sessionId: fixture.sessionId,
          seq: 1,
          ts: NOW,
          payload: null,
        })
      },
    }, "apply")
    expect(appendReceipt).toMatchObject({ admitted: false, reason: "lock-busy" })
    expect(existsSync(fixture.path)).toBeFalse()
  })

  test("symlinked terminal and lease sidecars never authorize prune", () => {
    const terminal = eligibleFixture("terminal-symlink")
    const terminalPath = outboxTerminalPathFor(terminal.sessionId, terminal.options.outboxDir)
    const outsideTerminal = join(terminal.root, "outside-terminal.json")
    writeFileSync(outsideTerminal, readFileSync(terminalPath))
    unlinkSync(terminalPath)
    symlinkSync(outsideTerminal, terminalPath)
    expect(outboxRetentionStatus(terminal.options).files[0]?.reason).toBe("invalid-terminal")

    const lease = eligibleFixture("lease-symlink")
    const leasePath = outboxLeasePathFor(lease.sessionId, lease.options.outboxDir)
    const outsideLease = join(lease.root, "outside-lease.json")
    writeFileSync(outsideLease, readFileSync(leasePath))
    unlinkSync(leasePath)
    symlinkSync(outsideLease, leasePath)
    expect(outboxRetentionStatus(lease.options).files[0]?.reason).toBe("invalid-lease")
  })

  test("daemon v2 cursor covers exactly complete records and never a partial tail", async () => {
    const fixture = emptyFixture("daemon-partial")
    const complete = Buffer.from(`${JSON.stringify({ v: 1, kind: "event", sessionId: fixture.sessionId, seq: 1, ts: 1, payload: { kind: "cursor-proof", payloadVersion: 1, payload: null } })}\n`)
    writeFileSync(fixture.path, Buffer.concat([complete, Buffer.from('{\"v\":1')]))
    const dbPath = join(fixture.root, "control", "ledger.sqlite")
    const daemon = createIngestDaemon({
      outboxDir: fixture.options.outboxDir,
      cursorPath: fixture.options.cursorPath,
      dbPath,
      errorLogPath: join(fixture.root, "control", "errors.jsonl"),
      retryLimit: 0,
    })
    await daemon.scan()
    const state = JSON.parse(readFileSync(fixture.options.cursorPath, "utf8")) as { version: number; files: Record<string, { offset: number; sha256: string }> }
    expect(state.version).toBe(2)
    expect(state.files[fixture.path]?.offset).toBe(complete.length)
    expect(state.files[fixture.path]?.sha256).toBe(sha(complete))
    const sqlite = new Database(dbPath, { readonly: true, create: false })
    try {
      const row = sqlite.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM events WHERE kind = 'ingestError'",
      ).get()
      expect(row?.count).toBe(0)
    } finally {
      sqlite.close()
    }
  })

  test("H11 staging writes only a fleet-sync v1 manifest and retains the source", () => {
    const fixture = eligibleFixture("h11")
    const h11ManifestDir = join(fixture.root, "fleet-sync", "asset-manifests")
    const result = pruneOutbox({ ...fixture.options, h11ManifestDir, h11AssetRoot: fixture.root }, "apply")
    expect(result.files[0]?.reason).toBe("h11-transfer-pending")
    expect(existsSync(fixture.path)).toBeTrue()
    expect(countFiles(h11ManifestDir, ".asset-manifest.json")).toBe(1)
    const manifestEntry = readdirSync(h11ManifestDir).find((name) => name.endsWith(".asset-manifest.json"))
    if (manifestEntry === undefined) throw new Error("missing staged asset manifest")
    const manifest = JSON.parse(readFileSync(join(h11ManifestDir, manifestEntry), "utf8")) as { version: number; objects: unknown[] }
    expect(manifest.version).toBe(1)
    expect(manifest.objects).toHaveLength(1)
  })

  test("H11 crash after unlink converges only after the immutable receipt is verified", () => {
    const fixture = eligibleFixture("h11-crash")
    const h11ManifestDir = join(fixture.root, "fleet-sync", "asset-manifests")
    const immutableReceiptDir = join(fixture.root, "fleet-sync", "receipts")
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const trust = {
      producerId: "fleet-sync",
      keyId: "h11-transfer-2026",
      sourceHost: "arthur-mac",
      destinationHost: "h11",
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    }
    const options = {
      ...fixture.options,
      h11ManifestDir,
      h11AssetRoot: fixture.root,
      immutableReceiptDir,
      immutableReceiptTrust: trust,
    }
    expect(pruneOutbox(options, "apply").files[0]?.reason).toBe("h11-transfer-pending")
    const digest = sha(readFileSync(fixture.path))
    const id = `${encodeURIComponent(fixture.sessionId)}.${digest}`
    const assetPath = join(h11ManifestDir, `${id}.asset-manifest.json`)
    mkdirSync(immutableReceiptDir, { recursive: true })
    const receiptPath = join(immutableReceiptDir, `${id}.immutable-transfer.json`)
    writeFileSync(receiptPath, JSON.stringify({
      v: 1,
      immutable: true,
      assetManifestSha256: sha(readFileSync(assetPath)),
      sourceSha256: digest,
      bytes: statSync(fixture.path).size,
    }))
    expect(pruneOutbox(options, "apply").files[0]?.reason).toBe("h11-transfer-pending")
    expect(existsSync(fixture.path)).toBeTrue()
    const claim: FleetSyncImmutableTransferClaimV2 = {
      v: 2,
      producerId: trust.producerId,
      keyId: trust.keyId,
      sourceHost: trust.sourceHost,
      destinationHost: trust.destinationHost,
      runId: "0123456789abcdef01234567",
      assetLogicalKey: `asset:sha256:${digest}`,
      assetLogicalDigest: `sha256:${digest}`,
      assetManifestSha256: sha(readFileSync(assetPath)),
      sourceSha256: digest,
      bytes: statSync(fixture.path).size,
    }
    writeFileSync(receiptPath, JSON.stringify({
      ...claim,
      signature: sign(null, fleetSyncImmutableTransferClaimBytes(claim), privateKey).toString("base64"),
    }))
    expect(() => pruneOutbox({ ...options, crashPoint: "after-unlink" }, "apply"))
      .toThrow("Injected retention crash: after-unlink")
    expect(existsSync(fixture.path)).toBeFalse()
    const receiptRoot = join(fixture.options.archiveDir, "receipts")
    expect(countFiles(receiptRoot, ".completion.json")).toBe(0)
    pruneOutbox(options, "apply")
    expect(countFiles(receiptRoot, ".completion.json")).toBe(1)
  })
})

function emptyFixture(sessionId: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), "control-plane-retention-"))
  const outboxDir = join(root, "outbox")
  const cursorPath = join(root, "control", "cursors.json")
  const archiveDir = join(root, "archive")
  const rawDir = join(root, "raw")
  process.env.HOME = join(root, "home")
  process.env.AGENT_CONTROL_PLANE_OUTBOX_DIR = outboxDir
  process.env.OMP_SESSION_CONTROL_DB = cursorPath
  mkdirSync(outboxDir, { recursive: true })
  mkdirSync(dirname(cursorPath), { recursive: true })
  const path = join(outboxDir, `${encodeURIComponent(sessionId)}.jsonl`)
  writeFileSync(path, "")
  return { root, path, sessionId, options: { outboxDir, cursorPath, archiveDir, rawDir, graceMs: 60_000, now: NOW } }
}

function eligibleFixture(sessionId: string, bytes = Buffer.from('{"v":1,"kind":"test"}\n')): Fixture {
  const fixture = emptyFixture(sessionId)
  writeFileSync(fixture.path, bytes)
  writeProof(fixture, bytes, OLD.toISOString())
  return fixture
}

function writeProof(
  fixture: Fixture,
  bytes: Buffer,
  terminalAt: string,
  owner = { host: hostname(), pid: process.pid, leaseId: "lease" },
): void {
  const sourceSha256 = sha(bytes)
  const terminalPath = outboxTerminalPathFor(fixture.sessionId, fixture.options.outboxDir)
  mkdirSync(dirname(terminalPath), { recursive: true })
  writeFileSync(terminalPath, JSON.stringify({ v: 1, sessionId: fixture.sessionId, owner, terminalAt, source: { byteOffset: bytes.length, sha256: sourceSha256 } }))
  writeLease(fixture, owner, OLD.toISOString(), OLD.toISOString())
  const stat = statSync(fixture.path)
  writeFileSync(fixture.options.cursorPath, JSON.stringify({ version: 2, files: { [fixture.path]: { device: stat.dev, inode: stat.ino, offset: bytes.length, modifiedAt: stat.mtimeMs, sha256: sourceSha256 } } }))
  utimesSync(fixture.path, OLD, OLD)
}

function writeLease(fixture: Fixture, owner: { host: string; pid: number; leaseId: string }, releasedAt: string | undefined, lastSeenAt: string): void {
  const path = outboxLeasePathFor(fixture.sessionId, fixture.options.outboxDir)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ v: 1, sessionId: fixture.sessionId, owner, lastSeenAt, ...(releasedAt === undefined ? {} : { releasedAt }) }))
}

function sha(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
function countFiles(root: string, suffix: string): number { return readdirSync(root).filter((name) => name.endsWith(suffix)).length }
