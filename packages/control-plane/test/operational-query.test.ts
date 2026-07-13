import { createHash } from "node:crypto"
import { mkdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"

import { Database } from "bun:sqlite"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect } from "effect"

import { queryOperationalReleases, queryOperationalSessions } from "../src/operational-query"
import { openLedger } from "../src/ledger"

const tmpDir = join(import.meta.dir, ".tmp", "operational-query")

beforeAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => rmSync(tmpDir, { recursive: true, force: true }))

test("operational queries open existing current ledgers without reverse writes", async () => {
  const dbPath = join(tmpDir, "readonly.sqlite")
  await Effect.runPromise(Effect.scoped(Effect.void.pipe(Effect.provide(openLedger(dbPath)))))
  const before = await fileEvidence(dbPath)
  expect(await Effect.runPromise(queryOperationalSessions(dbPath))).toEqual([])
  const after = await fileEvidence(dbPath)
  expect(after).toEqual(before)

  const absentPath = join(tmpDir, "absent", "ledger.sqlite")
  await expect(Effect.runPromise(queryOperationalSessions(absentPath))).rejects.toThrow()
  expect(await Bun.file(absentPath).exists()).toBe(false)
})

test("operational queries reject ledgers older than schema version 10", async () => {
  const dbPath = join(tmpDir, "older.sqlite")
  const sqlite = new Database(dbPath)
  sqlite.exec("PRAGMA user_version = 9")
  sqlite.close()
  await expect(Effect.runPromise(queryOperationalSessions(dbPath))).rejects.toThrow("older than required version 10")
})

test("release query reports transaction artifact digest mismatch and missing link", async () => {
  const dbPath = join(tmpDir, "release.sqlite")
  await Effect.runPromise(Effect.scoped(Effect.void.pipe(Effect.provide(openLedger(dbPath)))))
  const sqlite = new Database(dbPath)
  try {
    sqlite.query("INSERT INTO artifacts (id, ts, sessionId, kind, contentPath, contentInline, sha256, bytes, retention, meta) VALUES (?, 1, NULL, 'releaseTransaction', NULL, '{}', ?, 2, 'keep', '{}')").run(`artifact_${"a".repeat(32)}`, "b".repeat(64))
    sqlite.query("INSERT INTO release_transactions (promotionId, operation, occurredAt, fromBuildDigest, toBuildDigest, receiptDigest, registryBeforeDigest, registryAfterDigest, transactionArtifactId) VALUES ('promotion-mismatch', 'bless', 1, NULL, ?, NULL, ?, ?, ?)").run("c".repeat(64), "d".repeat(64), "e".repeat(64), `artifact_${"a".repeat(32)}`)
    sqlite.query("INSERT INTO release_transactions (promotionId, operation, occurredAt, fromBuildDigest, toBuildDigest, receiptDigest, registryBeforeDigest, registryAfterDigest, transactionArtifactId) VALUES ('promotion-missing', 'bless', 2, NULL, ?, NULL, ?, ?, 'artifact_missing')").run("c".repeat(64), "d".repeat(64), "f".repeat(64))
  } finally {
    sqlite.close()
  }

  const rows = await Effect.runPromise(queryOperationalReleases(dbPath))
  expect(rows.find((row) => row.promotionId === "promotion-mismatch")?.mismatches).toContain(`transactionArtifact:artifact_${"a".repeat(32)}`)
  expect(rows.find((row) => row.promotionId === "promotion-missing")?.missingLinks).toContain("artifacts:artifact_missing")
})

async function fileEvidence(path: string): Promise<{ readonly digest: string; readonly mtimeMs: number; readonly size: number }> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
  const stat = statSync(path)
  return { digest: createHash("sha256").update(bytes).digest("hex"), mtimeMs: stat.mtimeMs, size: stat.size }
}
