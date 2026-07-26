import { Database } from "bun:sqlite"
import { createHash, randomUUID } from "node:crypto"
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"


const MIB = 1024 * 1024
const GIB = 1024 * MIB
const DEFAULT_SEGMENT_BYTES = 32 * MIB
const DEFAULT_HOT_QUOTA_BYTES = 2 * GIB
const DEFAULT_ARCHIVE_QUOTA_BYTES = 8 * GIB
const DEFAULT_RAW_TTL_MS = 24 * 60 * 60 * 1_000
const DEFAULT_RAW_QUOTA_BYTES = 256 * MIB
const DEFAULT_MAX_ACTIONS = 64
const IO_BUFFER_BYTES = 256 * 1024
const MAX_STATUS_ERRORS = 32
const MAX_STATE_ERRORS = 128
const MAX_RAW_METADATA_BYTES = 4_096
const DIGEST_PATTERN = /^[0-9a-f]{64}$/

export interface StorageConfig {
  readonly outboxDir?: string
  readonly archiveDir?: string
  readonly stateDbPath?: string
  readonly rawDir?: string
  readonly segmentBytes?: number
  readonly hotQuotaBytes?: number
  readonly archiveQuotaBytes?: number
  readonly rawTtlMs?: number
  readonly rawQuotaBytes?: number
  readonly maxActionsPerRun?: number
}

export interface StorageBytes {
  readonly active: number
  readonly sealed: number
  readonly archive: number
  readonly raw: number
  readonly ledger: number
  readonly spool: number
  readonly total: number
}

export interface StorageSegments {
  readonly active: number
  readonly sealing: number
  readonly sealed: number
  readonly ingested: number
  readonly archived: number
  readonly errored: number
}

export interface StorageIngestProgress {
  readonly pending: number
  readonly ingested: number
  readonly archived: number
  readonly latestIngestedAt: string | null
  readonly latestArchivedAt: string | null
}

export interface StorageReclaimableBytes {
  readonly sealed: number
  readonly raw: number
  readonly total: number
}

export interface StorageOldestTimestamp {
  readonly active: string | null
  readonly sealed: string | null
  readonly archive: string | null
  readonly raw: string | null
}

export type StorageActionKind =
  | "seal"
  | "split"
  | "ingest"
  | "archive"
  | "remove-source"
  | "remove-raw"
  | "remove-temp"
  | "reconcile-state"
  | "quarantine"

export interface StorageAction {
  readonly kind: StorageActionKind
  readonly path: string
  readonly bytes: number
  readonly targetPath?: string
  readonly digest?: string
  readonly oversized?: boolean
  readonly error?: string
}

export interface StorageStatus {
  readonly generatedAt: string
  readonly bytes: StorageBytes
  readonly activeWriters: number
  readonly segments: StorageSegments
  readonly ingestProgress: StorageIngestProgress
  readonly reclaimableBytes: StorageReclaimableBytes
  readonly oldestTimestamp: StorageOldestTimestamp
  readonly quotaViolations: readonly string[]
  readonly actions: readonly StorageAction[]
  readonly healthErrors: readonly string[]
  readonly corruptionErrors: readonly string[]
}

export interface StorageMaintenanceResult {
  readonly mode: "dry-run" | "apply"
  readonly startedAt: string
  readonly finishedAt: string
  readonly before: StorageStatus
  readonly after: StorageStatus
  readonly actions: readonly StorageAction[]
}

interface ResolvedConfig {
  readonly outboxDir: string
  readonly sealedDir: string
  readonly archiveDir: string
  readonly stateDbPath: string
  readonly rawDir: string
  readonly ledgerPath: string
  readonly segmentBytes: number
  readonly hotQuotaBytes: number
  readonly archiveQuotaBytes: number
  readonly rawTtlMs: number
  readonly rawQuotaBytes: number
  readonly maxActionsPerRun: number
}

type SegmentState = "discovered" | "ingested" | "archived" | "remote" | "error"

interface SegmentRow {
  readonly sealed_path: string
  readonly digest: string
  readonly size_bytes: number
  readonly oversized: number
  readonly state: SegmentState
  readonly archive_path: string | null
  readonly archive_bytes: number | null
  readonly ingested_at: string | null
  readonly archived_at: string | null
  readonly source_removed_at: string | null
  readonly error_code: string | null
}

interface SegmentPlan {
  readonly index: number
  readonly offset: number
  readonly bytes: number
  readonly digest: string
  readonly oversized: boolean
}

interface FileEntry {
  readonly path: string
  readonly bytes: number
  readonly mtimeMs: number
}

interface RawMetadata {
  readonly sha256: string
  readonly storedBytes: number
  readonly createdAt: number
  readonly expiresAt: number
  readonly blob: string
}

export function inspectStorage(
  config: Partial<StorageConfig> = {},
  activeSessionIds?: readonly string[],
): StorageStatus {
  const resolved = resolveConfig(config)
  const healthErrors: string[] = []
  const corruptionErrors: string[] = []
  const actions: StorageAction[] = []
  const activeNames = activeSessionIds === undefined
    ? undefined
    : new Set(activeSessionIds.map((sessionId) => `${encodeURIComponent(sessionId)}.jsonl`))

  const topLevel = listFiles(resolved.outboxDir, false, healthErrors, "outbox_read_failed")
  const activeFiles = topLevel.filter((entry) => basename(entry.path).endsWith(".jsonl"))
  const sealedAllFiles = listFiles(resolved.sealedDir, true, healthErrors, "sealed_read_failed")
  const sealingFiles = sealedAllFiles
    .filter((entry) => dirname(entry.path) === resolve(resolved.sealedDir) && basename(entry.path).endsWith(".sealing"))
  const sealedFiles = sealedAllFiles
    .filter((entry) => dirname(entry.path) === resolve(resolved.sealedDir) && basename(entry.path).endsWith(".segment.jsonl"))
  const archiveFiles = listFiles(resolved.archiveDir, true, healthErrors, "archive_read_failed")
  const rawFiles = listFiles(resolved.rawDir, true, healthErrors, "raw_read_failed")

  const rows = readSegmentRows(resolved.stateDbPath, healthErrors)
  const rowByPath = new Map(rows.map((row) => [resolve(row.sealed_path), row]))
  const rowStateCounts = countRowStates(rows)
  const ingestProgress = computeIngestProgress(rows)

  for (const file of activeFiles) {
    if (activeNames === undefined || activeNames.has(basename(file.path))) continue
    actions.push({
      kind: "seal",
      path: file.path,
      bytes: file.bytes,
    })
  }

  for (const file of sealingFiles) {
    try {
      const plans = scanSegmentPlans(file.path, resolved.segmentBytes)
      let complete = true
      for (const plan of plans) {
        const targetPath = segmentPath(resolved.sealedDir, file.path, plan)
        if (existsSync(targetPath)) {
          if (safeFileSize(targetPath) !== plan.bytes || hashFileRange(targetPath, 0, plan.bytes) !== plan.digest) {
            complete = false
            addBounded(corruptionErrors, "segment_target_conflict")
            actions.push({
              kind: "quarantine",
              path: targetPath,
              bytes: safeFileSize(targetPath),
              digest: plan.digest,
              error: "segment_target_conflict",
            })
          }
          continue
        }
        complete = false
        actions.push({
          kind: "split",
          path: file.path,
          targetPath,
          bytes: plan.bytes,
          digest: plan.digest,
          oversized: plan.oversized,
        })
      }
      if (complete) actions.push({ kind: "remove-source", path: file.path, bytes: file.bytes })
    } catch {
      addBounded(corruptionErrors, "sealing_incomplete_record")
      actions.push({ kind: "quarantine", path: file.path, bytes: file.bytes, error: "sealing_incomplete_record" })
    }
  }

  let reclaimableSealed = 0
  for (const file of sealedFiles) {
    const row = rowByPath.get(resolve(file.path))
    let digest: string
    try {
      digest = hashFileRange(file.path, 0, file.bytes)
      const namedDigest = digestFromSegmentName(file.path)
      if (!hasTerminalNewline(file.path, file.bytes) || (namedDigest !== undefined && namedDigest !== digest)) {
        throw new Error("segment checksum mismatch")
      }
    } catch {
      addBounded(corruptionErrors, "sealed_checksum_mismatch")
      actions.push({ kind: "quarantine", path: file.path, bytes: file.bytes, error: "sealed_checksum_mismatch" })
      continue
    }

    if (row === undefined || row.state === "discovered" || (row.state === "error" && row.error_code === "ingest_failure")) {
      actions.push({ kind: "ingest", path: file.path, bytes: file.bytes, digest })
    } else if (row.state === "ingested" || (row.state === "error" && row.error_code === "archive_failure")) {
      actions.push({
        kind: "archive",
        path: file.path,
        targetPath: archivePath(resolved.archiveDir, digest),
        bytes: file.bytes,
        digest,
      })
    } else if (
      (row.state === "archived" || row.state === "remote" || (row.state === "error" && row.error_code === "source_remove_blocked"))
      && row.source_removed_at === null
      && row.archive_path !== null
    ) {
      reclaimableSealed += file.bytes
      actions.push({ kind: "remove-source", path: file.path, bytes: file.bytes, digest })
    } else if (row.state === "error") {
      addBounded(corruptionErrors, row.error_code ?? "segment_error")
    }
  }

  for (const code of readStoredErrors(resolved.stateDbPath, healthErrors)) {
    if (/checksum|corrupt|conflict|incomplete|receipt/.test(code)) addBounded(corruptionErrors, code)
    else addBounded(healthErrors, code)
  }
  for (const row of rows) {
    if ((row.state !== "archived" && row.state !== "remote") || row.archive_path === null) continue
    if (!existsSync(row.archive_path)) {
      addBounded(corruptionErrors, "archive_receipt_missing")
      continue
    }
    try {
      verifyArchive(row.archive_path, row.digest, row.size_bytes)
    } catch {
      addBounded(corruptionErrors, "archive_checksum_mismatch")
      const bytes = safeFileSize(row.archive_path)
      actions.push({
        kind: "quarantine",
        path: row.archive_path,
        bytes,
        digest: row.digest,
        error: "archive_checksum_mismatch",
      })
    }
  }

  const rawCandidates = inspectRawCandidates(resolved, healthErrors)
  let reclaimableRaw = 0
  for (const candidate of rawCandidates) {
    if (!candidate.unreferenced || !candidate.expired) continue
    reclaimableRaw += candidate.bytes
    actions.push({
      kind: "remove-raw",
      path: candidate.metadataPath,
      targetPath: candidate.blobPath,
      bytes: candidate.bytes,
      digest: candidate.digest,
    })
  }

  const activeBytes = sumBytes(activeFiles)
  const sealedBytes = sumBytes(sealedAllFiles)
  const archiveBytes = sumBytes(archiveFiles)
  const rawBytes = sumBytes(rawFiles)
  const ledgerBytes = sqliteBytes(resolved.ledgerPath)
  const spoolBytes = sqliteBytes(resolved.stateDbPath)
  const total = activeBytes + sealedBytes + archiveBytes + rawBytes + ledgerBytes + spoolBytes
  const hotBytes = activeBytes + sealedBytes
  const quotaViolations: string[] = []
  if (hotBytes > resolved.hotQuotaBytes) quotaViolations.push("hot_quota_exceeded")
  if (archiveBytes > resolved.archiveQuotaBytes) quotaViolations.push("archive_quota_exceeded")
  if (rawBytes > resolved.rawQuotaBytes) quotaViolations.push("raw_quota_exceeded")

  const activeWriters = activeNames === undefined
    ? activeFiles.length
    : activeFiles.reduce((count, file) => count + (activeNames.has(basename(file.path)) ? 1 : 0), 0)

  return {
    generatedAt: new Date().toISOString(),
    bytes: {
      active: activeBytes,
      sealed: sealedBytes,
      archive: archiveBytes,
      raw: rawBytes,
      ledger: ledgerBytes,
      spool: spoolBytes,
      total,
    },
    activeWriters,
    segments: {
      active: activeFiles.length,
      sealing: sealingFiles.length,
      sealed: sealedFiles.length,
      ingested: rowStateCounts.ingested,
      archived: rowStateCounts.archived + rowStateCounts.remote,
      errored: rowStateCounts.error,
    },
    ingestProgress,
    reclaimableBytes: {
      sealed: reclaimableSealed,
      raw: reclaimableRaw,
      total: reclaimableSealed + reclaimableRaw,
    },
    oldestTimestamp: {
      active: oldestTimestamp(activeFiles),
      sealed: oldestTimestamp(sealedAllFiles),
      archive: oldestTimestamp(archiveFiles),
      raw: oldestTimestamp(rawFiles),
    },
    quotaViolations,
    actions: actions.slice(0, resolved.maxActionsPerRun),
    healthErrors: healthErrors.slice(0, MAX_STATUS_ERRORS),
    corruptionErrors: corruptionErrors.slice(0, MAX_STATUS_ERRORS),
  }
}

export async function maintainStorage(options: {
  readonly config?: Partial<StorageConfig>
  readonly mode: "dry-run" | "apply"
  readonly activeSessionIds?: readonly string[]
}): Promise<StorageMaintenanceResult> {
  const startedAt = new Date().toISOString()
  const config = resolveConfig(options.config ?? {})
  const before = inspectStorage(options.config ?? {}, options.activeSessionIds)
  if (options.mode === "dry-run") {
    const finishedAt = new Date().toISOString()
    return { mode: options.mode, startedAt, finishedAt, before, after: before, actions: before.actions }
  }

  const actions: StorageAction[] = []
  mkdirSync(config.outboxDir, { recursive: true, mode: 0o700 })
  mkdirSync(config.sealedDir, { recursive: true, mode: 0o700 })
  mkdirSync(config.archiveDir, { recursive: true, mode: 0o700 })
  mkdirSync(dirname(config.stateDbPath), { recursive: true, mode: 0o700 })
  const state = openStateDatabase(config.stateDbPath)
  try {
    const budget = (): boolean => actions.length < config.maxActionsPerRun
    const activeNames = options.activeSessionIds === undefined
      ? undefined
      : new Set(options.activeSessionIds.map((sessionId) => `${encodeURIComponent(sessionId)}.jsonl`))

    reconcileTemps(config, state, actions, budget)
    sealInactive(config, activeNames, state, actions, budget)
    splitSealingFiles(config, state, actions, budget)
    reconcileMissingSources(config, state, actions, budget)
    await processSealedFiles(config, state, actions, budget)
    cleanupRaw(config, state, actions, budget)
    trimStateErrors(state)
  } finally {
    state.close()
  }

  const after = inspectStorage(options.config ?? {}, options.activeSessionIds)
  return {
    mode: options.mode,
    startedAt,
    finishedAt: new Date().toISOString(),
    before,
    after,
    actions,
  }
}

function resolveConfig(config: Partial<StorageConfig>): ResolvedConfig {
  const outboxDir = absolutePath(config.outboxDir ?? process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] ?? join(homedir(), ".agent-control-plane", "outbox"), "outboxDir")
  const root = dirname(outboxDir)
  return {
    outboxDir,
    sealedDir: join(outboxDir, "sealed"),
    archiveDir: absolutePath(config.archiveDir ?? join(root, "archive"), "archiveDir"),
    stateDbPath: absolutePath(config.stateDbPath ?? join(root, "spool-state.sqlite"), "stateDbPath"),
    rawDir: absolutePath(config.rawDir ?? join(root, "raw"), "rawDir"),
    ledgerPath: absolutePath(process.env["AGENT_CONTROL_PLANE_DB"] ?? join(homedir(), ".agent-control-plane", "ledger.sqlite"), "ledgerPath"),
    segmentBytes: positiveInteger(config.segmentBytes, DEFAULT_SEGMENT_BYTES, "segmentBytes"),
    hotQuotaBytes: positiveInteger(config.hotQuotaBytes, DEFAULT_HOT_QUOTA_BYTES, "hotQuotaBytes"),
    archiveQuotaBytes: positiveInteger(config.archiveQuotaBytes, DEFAULT_ARCHIVE_QUOTA_BYTES, "archiveQuotaBytes"),
    rawTtlMs: positiveInteger(config.rawTtlMs, DEFAULT_RAW_TTL_MS, "rawTtlMs"),
    rawQuotaBytes: positiveInteger(config.rawQuotaBytes, DEFAULT_RAW_QUOTA_BYTES, "rawQuotaBytes"),
    maxActionsPerRun: positiveInteger(config.maxActionsPerRun, DEFAULT_MAX_ACTIONS, "maxActionsPerRun"),
  }
}

function absolutePath(path: string, field: string): string {
  if (path.length === 0) throw new Error(`${field} must not be empty`)
  return isAbsolute(path) ? resolve(path) : resolve(path)
}

function positiveInteger(value: number | undefined, fallback: number, field: string): number {
  const normalized = value ?? fallback
  if (!Number.isSafeInteger(normalized) || normalized <= 0) throw new Error(`${field} must be a positive safe integer`)
  return normalized
}

function openStateDatabase(path: string): Database {
  const db = new Database(path, { create: true, strict: true })
  db.exec("PRAGMA journal_mode = DELETE")
  db.exec("PRAGMA synchronous = FULL")
  db.exec("PRAGMA busy_timeout = 5000")
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_segments (
      sealed_path TEXT PRIMARY KEY,
      digest TEXT NOT NULL CHECK(length(digest) = 64),
      size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
      oversized INTEGER NOT NULL CHECK(oversized IN (0, 1)),
      state TEXT NOT NULL CHECK(state IN ('discovered', 'ingested', 'archived', 'remote', 'error')),
      archive_path TEXT,
      archive_bytes INTEGER,
      discovered_at TEXT NOT NULL,
      ingested_at TEXT,
      archived_at TEXT,
      remote_at TEXT,
      source_removed_at TEXT,
      error_code TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS storage_segments_digest_idx ON storage_segments(digest);
    CREATE TABLE IF NOT EXISTS storage_errors (
      path TEXT NOT NULL,
      code TEXT NOT NULL,
      occurrences INTEGER NOT NULL,
      first_at TEXT NOT NULL,
      last_at TEXT NOT NULL,
      PRIMARY KEY(path, code)
    );
  `)
  return db
}

function readSegmentRows(path: string, healthErrors: string[]): readonly SegmentRow[] {
  if (!existsSync(path)) return []
  let db: Database | undefined
  try {
    db = new Database(path, { readonly: true, create: false, strict: true })
    return db.query<SegmentRow, []>(
      "SELECT sealed_path, digest, size_bytes, oversized, state, archive_path, archive_bytes, ingested_at, archived_at, source_removed_at, error_code FROM storage_segments ORDER BY sealed_path",
    ).all()
  } catch {
    addBounded(healthErrors, "spool_state_read_failed")
    return []
  } finally {
    db?.close()
  }
}

function readStoredErrors(path: string, healthErrors: string[]): readonly string[] {
  if (!existsSync(path)) return []
  let db: Database | undefined
  try {
    db = new Database(path, { readonly: true, create: false, strict: true })
    return db.query<{ code: string }, [number]>(
      "SELECT code FROM storage_errors ORDER BY last_at DESC LIMIT ?",
    ).all(MAX_STATUS_ERRORS).map((row) => sanitizeCode(row.code))
  } catch {
    addBounded(healthErrors, "spool_errors_read_failed")
    return []
  } finally {
    db?.close()
  }
}

function countRowStates(rows: readonly SegmentRow[]): Record<SegmentState, number> {
  const counts: Record<SegmentState, number> = { discovered: 0, ingested: 0, archived: 0, remote: 0, error: 0 }
  for (const row of rows) counts[row.state] += 1
  return counts
}

function computeIngestProgress(rows: readonly SegmentRow[]): StorageIngestProgress {
  let pending = 0
  let ingested = 0
  let archived = 0
  let latestIngestedAt: string | null = null
  let latestArchivedAt: string | null = null
  for (const row of rows) {
    if (row.ingested_at === null) {
      pending += 1
    } else {
      ingested += 1
      if (latestIngestedAt === null || row.ingested_at > latestIngestedAt) latestIngestedAt = row.ingested_at
    }
    if (row.archived_at === null) continue
    archived += 1
    if (latestArchivedAt === null || row.archived_at > latestArchivedAt) latestArchivedAt = row.archived_at
  }
  return { pending, ingested, archived, latestIngestedAt, latestArchivedAt }
}

function sealInactive(
  config: ResolvedConfig,
  activeNames: ReadonlySet<string> | undefined,
  state: Database,
  actions: StorageAction[],
  budget: () => boolean,
): void {
  if (activeNames === undefined) return
  const errors: string[] = []
  for (const file of listFiles(config.outboxDir, false, errors, "outbox_read_failed")) {
    if (!budget()) return
    const name = basename(file.path)
    if (!name.endsWith(".jsonl") || activeNames.has(name)) continue
    try {
      const before = statSync(file.path)
      const digest = hashFileRange(file.path, 0, before.size)
      const after = statSync(file.path)
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) {
        recordError(state, file.path, "active_file_changed")
        continue
      }
      const target = sealingPath(config.sealedDir, file.path, digest)
      let destination = target
      if (existsSync(target)) {
        const targetBytes = safeFileSize(target)
        if (targetBytes !== before.size || hashFileRange(target, 0, targetBytes) !== digest) {
          quarantine(target, config.sealedDir, "sealing_target_conflict", state, actions, digest)
          if (!budget()) return
        } else {
          destination = target.replace(/\.sealing$/, `.duplicate-${before.ino}.sealing`)
          if (existsSync(destination)) {
            recordError(state, destination, "sealing_duplicate_conflict")
            continue
          }
        }
      }
      renameSync(file.path, destination)
      syncDirectory(config.outboxDir)
      syncDirectory(config.sealedDir)
      actions.push({ kind: "seal", path: file.path, targetPath: destination, bytes: before.size, digest })
    } catch {
      recordError(state, file.path, "seal_failure")
    }
  }
}

function splitSealingFiles(
  config: ResolvedConfig,
  state: Database,
  actions: StorageAction[],
  budget: () => boolean,
): void {
  const errors: string[] = []
  const files = listFiles(config.sealedDir, false, errors, "sealed_read_failed")
    .filter((entry) => basename(entry.path).endsWith(".sealing"))
  for (const file of files) {
    let plans: readonly SegmentPlan[]
    try {
      plans = scanSegmentPlans(file.path, config.segmentBytes)
    } catch {
      if (!budget()) return
      quarantine(file.path, config.sealedDir, "sealing_incomplete_record", state, actions)
      continue
    }

    let complete = true
    for (const plan of plans) {
      const target = segmentPath(config.sealedDir, file.path, plan)
      if (!existsSync(target)) {
        if (!budget()) {
          complete = false
          break
        }
        try {
          writeRangeDurably(file.path, plan.offset, plan.bytes, target, plan.digest)
          actions.push({
            kind: "split",
            path: file.path,
            targetPath: target,
            bytes: plan.bytes,
            digest: plan.digest,
            oversized: plan.oversized,
          })
        } catch {
          recordError(state, file.path, "split_failure")
          complete = false
          break
        }
      } else {
        try {
          if (safeFileSize(target) !== plan.bytes || hashFileRange(target, 0, plan.bytes) !== plan.digest) {
            throw new Error("segment target mismatch")
          }
        } catch {
          if (!budget()) return
          quarantine(target, config.sealedDir, "segment_target_conflict", state, actions)
          complete = false
          break
        }
      }
      upsertDiscovered(state, target, plan.digest, plan.bytes, plan.oversized)
    }

    if (complete && plans.every((plan) => existsSync(segmentPath(config.sealedDir, file.path, plan)))) {
      if (!budget()) return
      try {
        unlinkSync(file.path)
        syncDirectory(config.sealedDir)
        actions.push({ kind: "remove-source", path: file.path, bytes: file.bytes })
      } catch {
        recordError(state, file.path, "sealing_remove_failure")
      }
    }
  }
}

async function processSealedFiles(
  config: ResolvedConfig,
  state: Database,
  actions: StorageAction[],
  budget: () => boolean,
): Promise<void> {
  const errors: string[] = []
  const files = listFiles(config.sealedDir, false, errors, "sealed_read_failed")
    .filter((entry) => basename(entry.path).endsWith(".segment.jsonl"))
  for (const file of files) {
    if (!budget()) return
    let digest: string
    try {
      digest = hashFileRange(file.path, 0, file.bytes)
      const namedDigest = digestFromSegmentName(file.path)
      if (!hasTerminalNewline(file.path, file.bytes) || (namedDigest !== undefined && namedDigest !== digest)) {
        throw new Error("sealed checksum mismatch")
      }
    } catch {
      quarantine(file.path, config.sealedDir, "sealed_checksum_mismatch", state, actions)
      continue
    }

    const namedOversized = basename(file.path).includes(".oversized.segment.jsonl")
    upsertDiscovered(state, file.path, digest, file.bytes, namedOversized)
    let row = getSegmentRow(state, file.path)
    if (row === undefined) continue

    if (row.digest !== digest || row.size_bytes !== file.bytes) {
      quarantine(file.path, config.sealedDir, "segment_state_mismatch", state, actions)
      continue
    }

    if (row.state === "error" && row.error_code === "archive_failure") {
      restoreSegmentState(state, file.path, "ingested")
      row = getSegmentRow(state, file.path) ?? row
    } else if (row.state === "error" && row.error_code === "source_remove_blocked" && row.archive_path !== null) {
      const receiptPath = row.archive_path
      try {
        verifyArchive(receiptPath, digest, file.bytes)
        restoreSegmentState(state, file.path, "archived")
        row = getSegmentRow(state, file.path) ?? row
      } catch {
        if (existsSync(receiptPath) && budget()) {
          quarantine(receiptPath, config.archiveDir, "archive_checksum_mismatch", state, actions, digest)
        }
        invalidateArchiveReceipt(state, file.path)
        recordError(state, file.path, "archive_checksum_mismatch")
        continue
      }
    }

    if (row.state === "discovered" || (row.state === "error" && row.error_code === "ingest_failure")) {
      if (!budget()) return
      try {
        const [{ Effect }, { ingestOutbox }, { openLedger }] = await Promise.all([
          import("effect"),
          import("./ingest"),
          import("./ledger"),
        ])
        await Effect.runPromise(ingestOutbox(file.path, {
          rawDir: config.rawDir,
        }).pipe(Effect.provide(openLedger(config.ledgerPath))))
        markIngested(state, file.path)
        actions.push({ kind: "ingest", path: file.path, bytes: file.bytes, digest })
        row = getSegmentRow(state, file.path) ?? row
      } catch {
        markSegmentError(state, file.path, "ingest_failure")
        recordError(state, file.path, "ingest_failure")
        continue
      }
    }

    if (row.state === "ingested") {
      if (!budget()) return
      const target = archivePath(config.archiveDir, digest)
      try {
        const archiveBytes = writeVerifiedArchive(file.path, target, digest, file.bytes)
        markArchived(state, file.path, target, archiveBytes)
        actions.push({ kind: "archive", path: file.path, targetPath: target, bytes: archiveBytes, digest })
        row = getSegmentRow(state, file.path) ?? row
      } catch {
        if (existsSync(target) && budget()) {
          quarantine(target, config.archiveDir, "archive_checksum_mismatch", state, actions, digest)
        } else {
          markSegmentError(state, file.path, "archive_failure")
          recordError(state, file.path, "archive_failure")
        }
        continue
      }
    }

    if ((row.state === "archived" || row.state === "remote") && row.source_removed_at === null) {
      if (!budget()) return
      if (row.archive_path === null) {
        invalidateArchiveReceipt(state, file.path)
        recordError(state, file.path, "archive_receipt_missing")
        continue
      }
      const receiptPath = row.archive_path
      try {
        verifyArchive(receiptPath, digest, file.bytes)
      } catch {
        if (existsSync(receiptPath) && budget()) {
          quarantine(receiptPath, config.archiveDir, "archive_checksum_mismatch", state, actions, digest)
        }
        invalidateArchiveReceipt(state, file.path)
        recordError(state, file.path, "archive_checksum_mismatch")
        continue
      }
      try {
        unlinkSync(file.path)
        syncDirectory(config.sealedDir)
        markSourceRemoved(state, file.path)
        actions.push({ kind: "remove-source", path: file.path, bytes: file.bytes, digest })
      } catch {
        markSegmentError(state, file.path, "source_remove_blocked")
        recordError(state, file.path, "source_remove_blocked")
      }
    }
  }
}

function reconcileMissingSources(
  config: ResolvedConfig,
  state: Database,
  actions: StorageAction[],
  budget: () => boolean,
): void {
  const rows = state.query<SegmentRow, []>(
    "SELECT sealed_path, digest, size_bytes, oversized, state, archive_path, archive_bytes, source_removed_at, error_code FROM storage_segments WHERE source_removed_at IS NULL ORDER BY sealed_path",
  ).all()
  for (const row of rows) {
    if (!budget()) return
    if (existsSync(row.sealed_path)) continue
    if (
      (row.state === "archived" || row.state === "remote" || (row.state === "error" && row.error_code === "source_remove_blocked"))
      && row.archive_path !== null
    ) {
      const receiptPath = row.archive_path
      try {
        verifyArchive(receiptPath, row.digest, row.size_bytes)
        if (row.state === "error") restoreSegmentState(state, row.sealed_path, "archived")
        markSourceRemoved(state, row.sealed_path)
        actions.push({ kind: "reconcile-state", path: row.sealed_path, bytes: 0, digest: row.digest })
      } catch {
        if (existsSync(receiptPath) && budget()) {
          quarantine(receiptPath, config.archiveDir, "archive_checksum_mismatch", state, actions, row.digest)
        }
        markSegmentError(state, row.sealed_path, "archive_checksum_mismatch")
        recordError(state, row.sealed_path, "archive_checksum_mismatch")
      }
      continue
    }
    recordError(state, row.sealed_path, "sealed_source_missing")
  }
}

function cleanupRaw(
  config: ResolvedConfig,
  state: Database,
  actions: StorageAction[],
  budget: () => boolean,
): void {
  const errors: string[] = []
  for (const candidate of inspectRawCandidates(config, errors)) {
    if (!budget()) return
    if (!candidate.expired || !candidate.unreferenced) continue
    try {
      if (existsSync(candidate.blobPath)) unlinkSync(candidate.blobPath)
      if (existsSync(candidate.metadataPath)) unlinkSync(candidate.metadataPath)
      syncDirectory(dirname(candidate.metadataPath))
      actions.push({
        kind: "remove-raw",
        path: candidate.metadataPath,
        targetPath: candidate.blobPath,
        bytes: candidate.bytes,
        digest: candidate.digest,
      })
    } catch {
      recordError(state, candidate.metadataPath, "raw_remove_failure")
    }
  }
}

function reconcileTemps(
  config: ResolvedConfig,
  state: Database,
  actions: StorageAction[],
  budget: () => boolean,
): void {
  for (const root of [config.sealedDir, config.archiveDir]) {
    const errors: string[] = []
    for (const file of listFiles(root, true, errors, "temp_scan_failed")) {
      if (!budget()) return
      if (!basename(file.path).includes(".storage-tmp-")) continue
      try {
        unlinkSync(file.path)
        syncDirectory(dirname(file.path))
        actions.push({ kind: "remove-temp", path: file.path, bytes: file.bytes })
      } catch {
        recordError(state, file.path, "temp_remove_failure")
      }
    }
  }
}

function scanSegmentPlans(path: string, segmentBytes: number): readonly SegmentPlan[] {
  const size = safeFileSize(path)
  if (size === 0) return []
  const descriptor = openSync(path, "r")
  const buffer = Buffer.allocUnsafe(IO_BUFFER_BYTES)
  const ranges: Array<{ offset: number; bytes: number; oversized: boolean }> = []
  let absolute = 0
  let lineStart = 0
  let segmentStart = 0
  let segmentSize = 0
  try {
    while (absolute < size) {
      const count = readSync(descriptor, buffer, 0, Math.min(buffer.byteLength, size - absolute), absolute)
      if (count === 0) break
      for (let index = 0; index < count; index += 1) {
        if (buffer[index] !== 0x0a) continue
        const newlineEnd = absolute + index + 1
        const lineBytes = newlineEnd - lineStart
        if (lineBytes > segmentBytes) {
          if (segmentSize > 0) ranges.push({ offset: segmentStart, bytes: segmentSize, oversized: false })
          ranges.push({ offset: lineStart, bytes: lineBytes, oversized: true })
          segmentStart = newlineEnd
          segmentSize = 0
        } else if (segmentSize > 0 && segmentSize + lineBytes > segmentBytes) {
          ranges.push({ offset: segmentStart, bytes: segmentSize, oversized: false })
          segmentStart = lineStart
          segmentSize = lineBytes
        } else {
          if (segmentSize === 0) segmentStart = lineStart
          segmentSize += lineBytes
        }
        lineStart = newlineEnd
      }
      absolute += count
    }
  } finally {
    closeSync(descriptor)
  }
  if (lineStart !== size) throw new Error("sealing source has an incomplete final record")
  if (segmentSize > 0) ranges.push({ offset: segmentStart, bytes: segmentSize, oversized: false })
  return ranges.map((range, index) => ({
    index,
    offset: range.offset,
    bytes: range.bytes,
    digest: hashFileRange(path, range.offset, range.bytes),
    oversized: range.oversized,
  }))
}

function writeRangeDurably(source: string, offset: number, bytes: number, target: string, digest: string): void {
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  const temp = `${target}.storage-tmp-${process.pid}-${randomUUID()}`
  const sourceFd = openSync(source, "r")
  const targetFd = openSync(temp, "wx", 0o600)
  const buffer = Buffer.allocUnsafe(IO_BUFFER_BYTES)
  let copied = 0
  try {
    while (copied < bytes) {
      const count = readSync(sourceFd, buffer, 0, Math.min(buffer.byteLength, bytes - copied), offset + copied)
      if (count === 0) throw new Error("unexpected end of sealing source")
      let written = 0
      while (written < count) written += writeSync(targetFd, buffer, written, count - written)
      copied += count
    }
    fsyncSync(targetFd)
  } finally {
    closeSync(targetFd)
    closeSync(sourceFd)
  }
  try {
    if (safeFileSize(temp) !== bytes || hashFileRange(temp, 0, bytes) !== digest) throw new Error("segment verification failed")
    if (existsSync(target)) {
      if (safeFileSize(target) !== bytes || hashFileRange(target, 0, bytes) !== digest) throw new Error("segment collision")
      unlinkSync(temp)
    } else {
      renameSync(temp, target)
      syncDirectory(dirname(target))
    }
  } catch (cause) {
    tryUnlink(temp)
    throw cause
  }
}

function writeVerifiedArchive(source: string, target: string, digest: string, sourceBytes: number): number {
  if (existsSync(target)) return verifyArchive(target, digest, sourceBytes)
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  const compressed = Bun.zstdCompressSync(readFileSync(source))
  const temp = `${target}.storage-tmp-${process.pid}-${randomUUID()}`
  try {
    writeDurableExclusive(temp, compressed)
    const archiveBytes = verifyArchive(temp, digest, sourceBytes)
    if (existsSync(target)) {
      verifyArchive(target, digest, sourceBytes)
      unlinkSync(temp)
      return safeFileSize(target)
    }
    renameSync(temp, target)
    syncDirectory(dirname(target))
    verifyArchive(target, digest, sourceBytes)
    return archiveBytes
  } catch (cause) {
    tryUnlink(temp)
    throw cause
  }
}

function verifyArchive(path: string, digest: string, sourceBytes: number): number {
  const compressed = readFileSync(path)
  const restored = Bun.zstdDecompressSync(compressed)
  const restoredDigest = createHash("sha256").update(restored).digest("hex")
  if (restored.byteLength !== sourceBytes || restoredDigest !== digest) throw new Error("archive checksum mismatch")
  return compressed.byteLength
}

function writeDurableExclusive(path: string, content: Uint8Array): void {
  const descriptor = openSync(path, "wx", 0o600)
  try {
    writeFileSync(descriptor, content)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function upsertDiscovered(db: Database, path: string, digest: string, bytes: number, oversized: boolean): void {
  const now = new Date().toISOString()
  db.query(`
    INSERT INTO storage_segments (sealed_path, digest, size_bytes, oversized, state, discovered_at, updated_at)
    VALUES (?, ?, ?, ?, 'discovered', ?, ?)
    ON CONFLICT(sealed_path) DO UPDATE SET
      updated_at = excluded.updated_at
    WHERE storage_segments.digest = excluded.digest AND storage_segments.size_bytes = excluded.size_bytes
  `).run(resolve(path), digest, bytes, oversized ? 1 : 0, now, now)
}

function getSegmentRow(db: Database, path: string): SegmentRow | undefined {
  return db.query<SegmentRow, [string]>(
    "SELECT sealed_path, digest, size_bytes, oversized, state, archive_path, archive_bytes, ingested_at, archived_at, source_removed_at, error_code FROM storage_segments WHERE sealed_path = ?",
  ).get(resolve(path)) ?? undefined
}

function markIngested(db: Database, path: string): void {
  const now = new Date().toISOString()
  db.query("UPDATE storage_segments SET state = 'ingested', ingested_at = ?, error_code = NULL, updated_at = ? WHERE sealed_path = ?")
    .run(now, now, resolve(path))
}

function markArchived(db: Database, path: string, archive: string, bytes: number): void {
  const now = new Date().toISOString()
  db.query("UPDATE storage_segments SET state = 'archived', archive_path = ?, archive_bytes = ?, archived_at = ?, error_code = NULL, updated_at = ? WHERE sealed_path = ? AND state IN ('ingested', 'archived')")
    .run(resolve(archive), bytes, now, now, resolve(path))
}

function invalidateArchiveReceipt(db: Database, path: string): void {
  const now = new Date().toISOString()
  db.query("UPDATE storage_segments SET state = 'ingested', archive_path = NULL, archive_bytes = NULL, archived_at = NULL, error_code = NULL, updated_at = ? WHERE sealed_path = ?")
    .run(now, resolve(path))
}

function markSourceRemoved(db: Database, path: string): void {
  const now = new Date().toISOString()
  db.query("UPDATE storage_segments SET source_removed_at = ?, updated_at = ? WHERE sealed_path = ? AND state IN ('archived', 'remote')")
    .run(now, now, resolve(path))
}

function markSegmentError(db: Database, path: string, code: string): void {
  const now = new Date().toISOString()
  db.query("UPDATE storage_segments SET state = 'error', error_code = ?, updated_at = ? WHERE sealed_path = ?")
    .run(sanitizeCode(code), now, resolve(path))
}

function restoreSegmentState(db: Database, path: string, state: "ingested" | "archived"): void {
  const now = new Date().toISOString()
  db.query("UPDATE storage_segments SET state = ?, error_code = NULL, updated_at = ? WHERE sealed_path = ? AND state = 'error'")
    .run(state, now, resolve(path))
}

function recordError(db: Database, path: string, code: string): void {
  const now = new Date().toISOString()
  db.query(`
    INSERT INTO storage_errors (path, code, occurrences, first_at, last_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(path, code) DO UPDATE SET occurrences = MIN(storage_errors.occurrences + 1, 2147483647), last_at = excluded.last_at
  `).run(resolve(path), sanitizeCode(code), now, now)
  trimStateErrors(db)
}

function trimStateErrors(db: Database): void {
  db.query("DELETE FROM storage_errors WHERE rowid IN (SELECT rowid FROM storage_errors ORDER BY last_at DESC LIMIT -1 OFFSET ?)")
    .run(MAX_STATE_ERRORS)
}

function quarantine(
  path: string,
  root: string,
  code: string,
  state: Database,
  actions: StorageAction[],
  digest?: string,
): void {
  const bytes = safeFileSize(path)
  const quarantineDir = join(root, "quarantine")
  mkdirSync(quarantineDir, { recursive: true, mode: 0o700 })
  const target = join(quarantineDir, `${basename(path)}.${Date.now()}-${randomUUID()}.corrupt`)
  try {
    renameSync(path, target)
    syncDirectory(dirname(path))
    syncDirectory(quarantineDir)
    markSegmentError(state, path, code)
    recordError(state, target, code)
    actions.push({ kind: "quarantine", path, targetPath: target, bytes, digest, error: sanitizeCode(code) })
  } catch {
    recordError(state, path, "quarantine_failure")
  }
}

function inspectRawCandidates(config: ResolvedConfig, healthErrors: string[]): readonly {
  readonly metadataPath: string
  readonly blobPath: string
  readonly digest: string
  readonly bytes: number
  readonly expired: boolean
  readonly unreferenced: boolean
}[] {
  const metadataDir = join(config.rawDir, "metadata")
  const metadataFiles = listFiles(metadataDir, false, healthErrors, "raw_metadata_read_failed")
    .filter((entry) => basename(entry.path).endsWith(".json"))
  const ledger = openReadonlyLedger(config.ledgerPath)
  const candidates: Array<{
    metadataPath: string
    blobPath: string
    digest: string
    bytes: number
    expired: boolean
    unreferenced: boolean
  }> = []
  try {
    for (const file of metadataFiles) {
      const metadata = readRawMetadata(file.path)
      if (metadata === undefined) {
        addBounded(healthErrors, "raw_metadata_invalid")
        continue
      }
      const blobPath = resolve(config.rawDir, metadata.blob)
      const relativeBlob = relative(config.rawDir, blobPath)
      if (relativeBlob.startsWith("..") || isAbsolute(relativeBlob)) {
        addBounded(healthErrors, "raw_metadata_path_invalid")
        continue
      }
      const blobBytes = safeFileSize(blobPath)
      const referenced = ledger === undefined ? true : ledger.query<{ present: number }, [string, string]>(
        "SELECT 1 AS present FROM artifacts WHERE contentPath = ? OR contentPath = ? LIMIT 1",
      ).get(blobPath, metadata.blob) !== null
      candidates.push({
        metadataPath: file.path,
        blobPath,
        digest: metadata.sha256,
        bytes: file.bytes + blobBytes,
        expired: Math.min(metadata.expiresAt, metadata.createdAt + config.rawTtlMs) <= Date.now(),
        unreferenced: !referenced,
      })
    }
  } catch {
    addBounded(healthErrors, "raw_reference_check_failed")
  } finally {
    ledger?.close()
  }
  return candidates
}

function readRawMetadata(path: string): RawMetadata | undefined {
  try {
    const bytes = readFileSync(path)
    if (bytes.byteLength > MAX_RAW_METADATA_BYTES) return undefined
    const value = JSON.parse(bytes.toString("utf8")) as Partial<RawMetadata>
    return typeof value.sha256 === "string"
      && DIGEST_PATTERN.test(value.sha256)
      && Number.isSafeInteger(value.storedBytes)
      && (value.storedBytes ?? -1) >= 0
      && Number.isSafeInteger(value.createdAt)
      && (value.createdAt ?? -1) >= 0
      && Number.isSafeInteger(value.expiresAt)
      && (value.expiresAt ?? -1) >= 0
      && typeof value.blob === "string"
      ? value as RawMetadata
      : undefined
  } catch {
    return undefined
  }
}

function openReadonlyLedger(path: string): Database | undefined {
  if (!existsSync(path)) return undefined
  try {
    return new Database(path, { readonly: true, create: false, strict: true })
  } catch {
    return undefined
  }
}

function listFiles(root: string, recursive: boolean, errors: string[], errorCode: string): FileEntry[] {
  if (!existsSync(root)) return []
  const files: FileEntry[] = []
  const visit = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      addBounded(errors, errorCode)
      return
    }
    entries.sort((left, right) => compareStrings(left.name, right.name))
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (recursive) visit(path)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const stat = statSync(path)
        files.push({ path: resolve(path), bytes: stat.size, mtimeMs: stat.mtimeMs })
      } catch {
        addBounded(errors, errorCode)
      }
    }
  }
  visit(root)
  return files
}

function hashFileRange(path: string, offset: number, bytes: number): string {
  const descriptor = openSync(path, "r")
  const hash = createHash("sha256")
  const buffer = Buffer.allocUnsafe(IO_BUFFER_BYTES)
  let consumed = 0
  try {
    while (consumed < bytes) {
      const count = readSync(descriptor, buffer, 0, Math.min(buffer.byteLength, bytes - consumed), offset + consumed)
      if (count === 0) throw new Error("unexpected end of file")
      hash.update(buffer.subarray(0, count))
      consumed += count
    }
  } finally {
    closeSync(descriptor)
  }
  return hash.digest("hex")
}

function hasTerminalNewline(path: string, bytes: number): boolean {
  if (bytes === 0) return false
  const descriptor = openSync(path, "r")
  const byte = Buffer.allocUnsafe(1)
  try {
    return readSync(descriptor, byte, 0, 1, bytes - 1) === 1 && byte[0] === 0x0a
  } finally {
    closeSync(descriptor)
  }
}

function sealingPath(sealedDir: string, activePath: string, digest: string): string {
  const sourceName = basename(activePath).replace(/\.jsonl$/, "")
  const boundedName = sourceName.length <= 96
    ? sourceName
    : createHash("sha256").update(sourceName).digest("hex").slice(0, 24)
  return join(sealedDir, `${boundedName}.${digest}.jsonl.sealing`)
}

function segmentPath(sealedDir: string, sealingSource: string, plan: SegmentPlan): string {
  const sourceKey = createHash("sha256").update(basename(sealingSource)).digest("hex").slice(0, 16)
  const ordinal = plan.index.toString().padStart(8, "0")
  const oversized = plan.oversized ? ".oversized" : ""
  return join(sealedDir, `${sourceKey}.${ordinal}.${plan.digest}${oversized}.segment.jsonl`)
}

function archivePath(archiveDir: string, digest: string): string {
  return join(archiveDir, "sha256", digest.slice(0, 2), `${digest}.jsonl.zst`)
}

function digestFromSegmentName(path: string): string | undefined {
  const match = basename(path).match(/\.([0-9a-f]{64})(?:\.oversized)?\.segment\.jsonl$/)
  return match?.[1]
}

function safeFileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function sqliteBytes(path: string): number {
  return safeFileSize(path) + safeFileSize(`${path}-wal`) + safeFileSize(`${path}-shm`) + safeFileSize(`${path}-journal`)
}

function sumBytes(files: readonly FileEntry[]): number {
  let total = 0
  for (const file of files) total += file.bytes
  return total
}

function oldestTimestamp(files: readonly FileEntry[]): string | null {
  let oldest = Number.POSITIVE_INFINITY
  for (const file of files) oldest = Math.min(oldest, file.mtimeMs)
  return Number.isFinite(oldest) ? new Date(oldest).toISOString() : null
}

function syncDirectory(path: string): void {
  const descriptor = openSync(path, "r")
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // Preserve the original operation failure.
  }
}

function sanitizeCode(code: string): string {
  const sanitized = code.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80)
  return sanitized.length === 0 ? "storage_failure" : sanitized
}

function addBounded(values: string[], code: string): void {
  const sanitized = sanitizeCode(code)
  if (values.length < MAX_STATUS_ERRORS && !values.includes(sanitized)) values.push(sanitized)
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
