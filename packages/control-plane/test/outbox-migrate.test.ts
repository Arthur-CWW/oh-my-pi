import { createHash } from "node:crypto"
import { Database } from "bun:sqlite"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import {
  migrateOutboxes,
  outboxMigrationStatus,
  type OutboxMigrationOptions,
} from "../src/outbox-migrate"
import {
  appendOutboxLine,
  contentObjectPathFor,
  outboxLeasePathFor,
  outboxTerminalPathFor,
  type JsonValue,
  type OutboxAppendReceipt,
} from "../src/outbox"
import { captureRawProviderPayload } from "../src/raw-capture"

const roots: string[] = []
const OLD = new Date(Date.now() - 48 * 60 * 60 * 1_000)

interface Fixture {
  readonly root: string
  readonly sessionId: string
  readonly path: string
  readonly options: OutboxMigrationOptions
}

describe.serial("legacy outbox migration", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  test("metadata-only dry-run inventories a sparse 15 GiB source without reading or writing it", () => {
    const fixture = makeFixture("sparse", [], { peer: "unknown" })
    truncateSync(fixture.path, 15 * 1024 * 1024 * 1024)
    const before = listTree(fixture.root)
    const status = outboxMigrationStatus({ ...fixture.options, metadataOnly: true })
    expect(status.files[0]).toMatchObject({ bytes: 15 * 1024 * 1024 * 1024, reason: "owner-unknown" })
    expect(listTree(fixture.root)).toEqual(before)
  })

  test("metadata owner proof blocks unknown, fresh, live, and current sources", () => {
    const unknown = makeFixture("unknown", legacyRecords("unknown"), { peer: "unknown" })
    expect(outboxMigrationStatus(unknown.options).files[0]?.reason).toBe("owner-unknown")

    const fresh = makeFixture("fresh", legacyRecords("fresh"), { lastSeenAt: new Date().toISOString() })
    expect(outboxMigrationStatus({ ...fresh.options, graceMs: 60 * 60 * 1_000, now: Date.now() }).files[0]?.reason)
      .toBe("owner-fresh")

    const live = makeFixture("live", legacyRecords("live"), { pid: process.pid })
    expect(outboxMigrationStatus(live.options).files[0]?.reason).toBe("owner-live")

    const current = makeFixture("current", legacyRecords("current"))
    expect(outboxMigrationStatus({ ...current.options, currentFile: current.path }).files[0]?.reason)
      .toBe("current-file")
  })

  test("CLI metadata-only dry-run emits bounded JSON without migration writes", () => {
    const fixture = makeFixture("cli-metadata", legacyRecords("cli-metadata"))
    const cli = join(import.meta.dir, "../src/cli.ts")
    const result = Bun.spawnSync([
      "bun",
      cli,
      "outbox",
      "migrate",
      "--dry-run",
      "--metadata-only",
      "--outbox", fixture.options.outboxDir,
      "--cursor", fixture.options.cursorPath,
      "--archive", fixture.options.archiveDir,
      "--db", fixture.options.dbPath ?? "",
      "--raw", fixture.options.rawDir ?? "",
      "--peer-db", fixture.options.peerDbPath ?? "",
      "--grace-ms", "0",
      "--json",
    ], {
      env: {
        ...process.env,
        HOME: join(fixture.root, "home"),
        AGENT_CONTROL_PLANE_OUTBOX_DIR: fixture.options.outboxDir,
        OMP_SESSION_CONTROL_DB: join(fixture.root, "control", "session-control.sqlite"),
      },
    })
    expect(result.exitCode).toBe(0)
    const status = JSON.parse(result.stdout.toString()) as {
      metadataCandidateBytes: number
      files: Array<{ reason: string }>
    }
    expect(status.metadataCandidateBytes).toBe(statSync(fixture.path).size)
    expect(status.files[0]?.reason).toBe("candidate-scan-required")
    expect(existsSync(fixture.options.cursorPath)).toBeFalse()
  })

  test("dry-run reports exact complete-prefix, inline, reference, CAS, and rewrite projection with zero writes", () => {
    const fixture = makeFixture("projection", legacyRecords("projection"))
    const before = listTree(fixture.root)
    const result = migrateOutboxes(fixture.options, "dry-run")
    const file = result.files[0]
    expect(file).toMatchObject({
      eligible: true,
      reason: "candidate",
      partialTailBytes: 0,
      terminalRecordPresent: true,
      inlineRecords: 1,
      referencedRecords: 0,
    })
    expect(file?.completePrefixBytes).toBe(statSync(fixture.path).size)
    expect(file?.completePrefixSha256).toBe(sha(readFileSync(fixture.path)))
    expect(file?.projectedCasBytes).toBeGreaterThan(0)
    expect(file?.projectedRewrittenBytes).toBeGreaterThan(0)
    expect(result.projectedReclaimBytes).toBe(statSync(fixture.path).size)
    expect(listTree(fixture.root)).toEqual(before)
  })

  test("apply materializes inline evidence, ingests staging, writes proofs, and preserves source", () => {
    const fixture = makeFixture("apply", legacyRecords("apply"))
    const original = readFileSync(fixture.path)
    const result = migrateOutboxes(fixture.options, "apply")
    expect(result.files[0]?.reason).toBe("migrated")
    expect(readFileSync(fixture.path)).toEqual(original)
    expect(existsSync(fixture.options.cursorPath)).toBeTrue()
    expect(existsSync(outboxTerminalPathFor(fixture.sessionId, fixture.options.outboxDir))).toBeTrue()
    expect(existsSync(outboxLeasePathFor(fixture.sessionId, fixture.options.outboxDir))).toBeTrue()
    const cursor = JSON.parse(readFileSync(fixture.options.cursorPath, "utf8")) as {
      files: Record<string, { offset: number; sha256: string; device: number; inode: number }>
    }
    expect(cursor.files[fixture.path]).toMatchObject({
      offset: original.length,
      sha256: sha(original),
      device: statSync(fixture.path).dev,
      inode: statSync(fixture.path).ino,
    })
    expect(countFiles(fixture.options.rawDir ?? "", ".json")).toBeGreaterThan(0)
    const completionPath = join(
      fixture.options.archiveDir,
      "migration-receipts",
      `${encodeURIComponent(fixture.sessionId)}.json`,
    )
    expect(statSync(completionPath).isFile()).toBeTrue()
    expect(migrateOutboxes(fixture.options, "apply").files[0]?.reason).toBe("already-migrated")
  })

  test("mixed inline/reference input reuses verified CAS and removes inline only in staging", () => {
    const root = newRoot()
    const rawDir = join(root, "raw")
    const captured = captureRawProviderPayload(
      { messages: ["secret"] },
      Date.now(),
      { enabled: true, dir: rawDir, quotaBytes: 1024 * 1024, maxCaptureBytes: 1024 * 1024 },
    )
    if (captured.reference === undefined) throw new Error("capture failed")
    const fixture = makeFixture("mixed", legacyRecords("mixed", captured.reference as JsonValue), { root, rawDir })
    const result = migrateOutboxes(fixture.options, "apply")
    expect(result.files[0]).toMatchObject({ reason: "migrated", referencedRecords: 1, projectedCasBytes: 0 })
    const stage = findFile(join(fixture.options.archiveDir, "migration-manifests"), ".staging.jsonl")
    const staged = readFileSync(stage, "utf8")
    expect(staged).not.toContain("rawRequest\"")
    expect(staged).toContain(captured.reference.digest)
    expect(existsSync(contentObjectPathFor(rawDir, captured.reference.digest))).toBeTrue()
  })

  test("partial tails are quarantined losslessly then source is durably repaired", () => {
    const tail = Buffer.from('{"v":1,"partial"')
    const complete = Buffer.from(legacyRecords("partial").join(""), "utf8")
    const fixture = makeFixture("partial", [complete.toString("utf8"), tail.toString("utf8")])
    const status = outboxMigrationStatus(fixture.options)
    expect(status.files[0]).toMatchObject({ reason: "candidate-partial-tail", partialTailBytes: tail.length })
    migrateOutboxes(fixture.options, "apply")
    expect(readFileSync(fixture.path)).toEqual(complete)
    const quarantine = findFile(join(fixture.options.outboxDir, ".migration-quarantine"), ".partial-tail")
    expect(readFileSync(quarantine)).toEqual(tail)
    const cursor = JSON.parse(readFileSync(fixture.options.cursorPath, "utf8")) as {
      files: Record<string, { offset: number; sha256: string }>
    }
    expect(cursor.files[fixture.path]).toMatchObject({ offset: complete.length, sha256: sha(complete) })
  })

  test("missing terminal record stays ineligible and writes no proof", () => {
    const fixture = makeFixture("nonterminal", [modelCallLine("nonterminal")])
    expect(outboxMigrationStatus(fixture.options).files[0]?.reason).toBe("missing-terminal-record")
    expect(existsSync(outboxTerminalPathFor(fixture.sessionId, fixture.options.outboxDir))).toBeFalse()
  })

  test("corrupt referenced content blocks migration when inline fallback is absent", () => {
    const fixture = makeFixture("corrupt", [])
    const reference = {
      v: 1,
      algorithm: "sha256",
      digest: "1".repeat(64),
      byteLength: 2,
      contentType: "application/json",
      representation: "json-utf8",
      summary: { redacted: true, valueType: "object", itemCount: 0 },
    } as const
    writeFileSync(fixture.path, `${modelCallLine("corrupt", undefined, reference as JsonValue)}${terminalLine("corrupt")}`)
    utimesSync(fixture.path, OLD, OLD)
    expect(outboxMigrationStatus(fixture.options).files[0]?.reason).toBe("corrupt-reference")
  })

  test("shared writer fence rejects append during final migration proof", () => {
    const fixture = makeFixture("race", legacyRecords("race"))
    let appendReceipt: OutboxAppendReceipt | undefined
    migrateOutboxes({
      ...fixture.options,
      beforeProof: () => {
        appendReceipt = appendOutboxLine(fixture.path, {
          v: 1,
          kind: "event",
          sessionId: fixture.sessionId,
          seq: 2,
          ts: Date.now(),
          payload: null,
        })
      },
    }, "apply")
    expect(appendReceipt).toMatchObject({ admitted: false, reason: "lock-busy" })
  })

  test("partial-tail quarantine crash preserves the source and converges on rerun", () => {
    const tail = Buffer.from('{"partial":')
    const complete = Buffer.from(legacyRecords("crash-quarantine").join(""), "utf8")
    const fixture = makeFixture("crash-quarantine", [
      complete.toString("utf8"),
      tail.toString("utf8"),
    ])
    expect(() => migrateOutboxes({
      ...fixture.options,
      crashPoint: "after-quarantine",
    }, "apply")).toThrow("Injected migration crash: after-quarantine")
    expect(readFileSync(fixture.path)).toEqual(Buffer.concat([complete, tail]))
    expect(migrateOutboxes(fixture.options, "apply").files[0]?.reason).toBe("migrated")
    expect(readFileSync(fixture.path)).toEqual(complete)
  })

  test("every injected crash reruns idempotently without deleting the source", () => {
    const points = [
      "after-stage",
      "after-cas",
      "after-ingest",
      "after-repair",
      "after-cursor",
      "after-terminal",
    ] as const
    for (const point of points) {
      const fixture = makeFixture(`crash-${point}`, legacyRecords(`crash-${point}`))
      const original = readFileSync(fixture.path)
      expect(() => migrateOutboxes({ ...fixture.options, crashPoint: point }, "apply"))
        .toThrow(`Injected migration crash: ${point}`)
      expect(readFileSync(fixture.path)).toEqual(original)
      expect(migrateOutboxes(fixture.options, "apply").files[0]?.reason).toBe("migrated")
      expect(readFileSync(fixture.path)).toEqual(original)
    }
  })
})

function makeFixture(
  sessionId: string,
  records: readonly string[],
  overrides: {
    readonly root?: string
    readonly rawDir?: string
    readonly peer?: "unknown"
    readonly pid?: number
    readonly lastSeenAt?: string
  } = {},
): Fixture {
  const root = overrides.root ?? newRoot()
  if (!roots.includes(root)) roots.push(root)
  const outboxDir = join(root, "outbox")
  const rawDir = overrides.rawDir ?? join(root, "raw")
  const path = join(outboxDir, `${encodeURIComponent(sessionId)}.jsonl`)
  const peerDbPath = join(root, "control", "irc-bus.sqlite")
  const cursorPath = join(root, "control", "cursors.json")
  const archiveDir = join(root, "archive")
  const dbPath = join(root, "control", "ledger.sqlite")
  mkdirSync(outboxDir, { recursive: true })
  mkdirSync(dirname(peerDbPath), { recursive: true })
  writeFileSync(path, records.join(""))
  utimesSync(path, OLD, OLD)
  const peers = new Database(peerDbPath)
  peers.run("CREATE TABLE peers (session_id TEXT PRIMARY KEY, pid INTEGER, last_seen TEXT, owner_epoch TEXT, session_file TEXT)")
  if (overrides.peer !== "unknown") {
    peers.query("INSERT INTO peers (session_id, pid, last_seen, owner_epoch, session_file) VALUES (?, ?, ?, ?, ?)")
      .run(sessionId, overrides.pid ?? 2_147_483_647, overrides.lastSeenAt ?? OLD.toISOString(), "legacy-epoch", null)
  }
  peers.close()
  process.env.HOME = join(root, "home")
  process.env.AGENT_CONTROL_PLANE_OUTBOX_DIR = outboxDir
  process.env.AGENT_CONTROL_PLANE_RAW_DIR = rawDir
  process.env.OMP_SESSION_CONTROL_DB = join(root, "control", "session-control.sqlite")
  return {
    root,
    sessionId,
    path,
    options: {
      outboxDir,
      cursorPath,
      archiveDir,
      dbPath,
      rawDir,
      peerDbPath,
      graceMs: 0,
      now: Date.now() + 60_000,
    },
  }
}

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "control-plane-outbox-migrate-"))
  roots.push(root)
  return root
}

function legacyRecords(sessionId: string, reference?: JsonValue): readonly string[] {
  return [modelCallLine(sessionId, { messages: ["secret"] }, reference), terminalLine(sessionId)]
}

function modelCallLine(
  sessionId: string,
  rawRequest?: JsonValue,
  rawRequestRef?: JsonValue,
): string {
  return `${JSON.stringify({
    v: 1,
    kind: "modelCall",
    sessionId,
    seq: 0,
    ts: 1,
    payload: {
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
      ...(rawRequest === undefined ? {} : { rawRequest }),
      ...(rawRequestRef === undefined ? {} : { rawRequestRef }),
    },
  })}\n`
}

function terminalLine(sessionId: string): string {
  return `${JSON.stringify({
    v: 1,
    kind: "event",
    sessionId,
    seq: 1,
    ts: 2,
    payload: {
      id: `${sessionId}:1`,
      ts: 2,
      sessionId,
      seq: 1,
      kind: "session_shutdown",
      payloadVersion: 1,
      payload: null,
    },
  })}\n`
}

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function listTree(root: string): readonly string[] {
  const values: string[] = []
  const visit = (path: string, prefix: string): void => {
    if (!existsSync(path)) return
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = join(prefix, entry.name)
      values.push(relativePath)
      if (entry.isDirectory()) visit(join(path, entry.name), relativePath)
    }
  }
  visit(root, "")
  return values
}

function findFile(root: string, suffix: string): string {
  const name = readdirSync(root).find((entry) => entry.endsWith(suffix))
  if (name === undefined) throw new Error(`Missing ${suffix} in ${root}`)
  return join(root, name)
}

function countFiles(root: string, suffix: string): number {
  if (!existsSync(root)) return 0
  let count = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) count += countFiles(path, suffix)
    else if (entry.name.endsWith(suffix)) count += 1
  }
  return count
}
