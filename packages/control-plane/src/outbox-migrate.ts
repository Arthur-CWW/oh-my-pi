import { createHash } from "node:crypto"
import { Database } from "bun:sqlite"
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
  type Stats,
} from "node:fs"
import { homedir, hostname } from "node:os"
import { basename, dirname, join, relative, resolve, sep } from "node:path"

import { Effect } from "effect"

import { ingestOutbox } from "./ingest"
import { openLedger } from "./ledger"
import {
  contentObjectPathFor,
  defaultRawCaptureDir,
  MAX_RAW_CAPTURE_INPUT_BYTES,
  outboxLeasePathFor,
  outboxTerminalPathFor,
  withOutboxWriterFence,
  type JsonValue,
  type RawContentReferenceV1,
} from "./outbox"
import {
  MAX_RETENTION_RECORD_BYTES,
  MAX_RETENTION_SIDECAR_BYTES,
  readBoundedRegularFile,
} from "./outbox-retention"
import { captureRawProviderPayload, verifyRawContentReference } from "./raw-capture"

const IO_BYTES = 64 * 1024
const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1_000
const DIGEST = /^[0-9a-f]{64}$/

export type OutboxMigrationReason =
  | "candidate"
  | "candidate-partial-tail"
  | "candidate-scan-required"
  | "current-file"
  | "invalid-source"
  | "invalid-terminal"
  | "invalid-lease"
  | "owner-unknown"
  | "owner-fresh"
  | "owner-live"
  | "too-young"
  | "missing-terminal-record"
  | "invalid-record"
  | "record-too-large"
  | "corrupt-reference"
  | "already-migrated"
  | "migrated"

export type OutboxMigrationFailureCode =
  | "unsafe-source"
  | "source-changed"
  | "invalid-record"
  | "record-too-large"
  | "missing-terminal-record"
  | "cas-materialization-failed"
  | "durability-failed"
  | "ingest-failed"

export class OutboxMigrationError extends Error {
  readonly name = "OutboxMigrationError"

  constructor(
    readonly code: OutboxMigrationFailureCode,
    message: string,
    readonly path?: string,
  ) {
    super(message)
  }
}

export interface OutboxMigrationOptions {
  readonly outboxDir: string
  readonly cursorPath: string
  readonly archiveDir: string
  readonly dbPath?: string
  readonly rawDir?: string
  readonly peerDbPath?: string
  readonly graceMs?: number
  readonly now?: number
  readonly currentFile?: string
  readonly onlyFile?: string
  readonly host?: string
  readonly quarantineDir?: string
  readonly stagingDir?: string
  readonly metadataOnly?: boolean
  readonly processAlive?: (pid: number) => boolean
  readonly beforeProof?: () => void
  readonly crashPoint?:
    | "after-quarantine"
    | "after-stage"
    | "after-cas"
    | "after-ingest"
    | "after-repair"
    | "after-cursor"
    | "after-terminal"
}

export interface OutboxMigrationFileStatus {
  readonly path: string
  readonly sessionId: string
  readonly bytes: number
  readonly eligible: boolean
  readonly reason: OutboxMigrationReason
  readonly sourceSha256: string | null
  readonly completePrefixBytes: number
  readonly completePrefixSha256: string | null
  readonly partialTailBytes: number
  readonly terminalRecordPresent: boolean | null
  readonly inlineRecords: number
  readonly inlineBytes: number
  readonly referencedRecords: number
  readonly projectedCasBytes: number
  readonly projectedRewrittenBytes: number
  readonly projectedReclaimBytes: number
}

export interface OutboxMigrationStatus {
  readonly version: 1
  readonly files: readonly OutboxMigrationFileStatus[]
  readonly candidateBytes: number
  readonly metadataCandidateBytes: number
  readonly inlineBytes: number
  readonly projectedCasBytes: number
  readonly projectedRewrittenBytes: number
  readonly projectedReclaimBytes: number
}

interface Owner {
  readonly host: string
  readonly pid: number
  readonly leaseId: string
}

interface OwnerEvidence {
  readonly owner: Owner
  readonly lastSeenAt: string
  readonly releasedAt?: string
}

interface Metadata {
  readonly status: OutboxMigrationFileStatus
  readonly evidence?: OwnerEvidence
}

interface SourceIdentity {
  readonly device: number
  readonly inode: number
  readonly size: number
  readonly modifiedAt: number
  readonly changedAt: number
}

interface OpenedSource {
  readonly descriptor: number
  readonly identity: SourceIdentity
}

interface ScanResult {
  readonly source: SourceIdentity
  readonly sourceSha256: string
  readonly completePrefixBytes: number
  readonly completePrefixSha256: string
  readonly partialTail: Buffer
  readonly terminalEvidence: boolean
  readonly inlineRecords: number
  readonly inlineBytes: number
  readonly referencedRecords: number
  readonly projectedCasBytes: number
  readonly projectedBytes: number
}

interface PeerRow {
  readonly pid: number | null
  readonly last_seen: string | null
  readonly owner_epoch: string | null
  readonly session_file: string | null
}

interface PeerIndexRow extends PeerRow {
  readonly session_id: string
}

interface MigrationRuntime extends OutboxMigrationOptions {
  readonly peerRows: ReadonlyMap<string, PeerRow>
}

interface JsonRead {
  readonly present: boolean
  readonly value?: unknown
}

export function defaultLegacyPeerDbPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return env["OMP_IRC_BUS_DB"] ?? join(homedir(), ".omp", "agent", "irc-bus.sqlite")
}

function migrationRuntime(options: OutboxMigrationOptions): MigrationRuntime {
  const peerDbPath = options.peerDbPath ?? defaultLegacyPeerDbPath()
  return { ...options, peerDbPath, peerRows: loadPeerRows(peerDbPath) }
}

function loadPeerRows(path: string): ReadonlyMap<string, PeerRow> {
  const rows = new Map<string, PeerRow>()
  try {
    const metadata = lstatSync(path)
    if (!metadata.isFile() || metadata.isSymbolicLink()) return rows
    const db = new Database(path, { readonly: true, create: false })
    try {
      for (const row of db.query<PeerIndexRow, []>(
        "SELECT session_id, pid, last_seen, owner_epoch, session_file FROM peers",
      ).all()) {
        rows.set(row.session_id, row)
      }
    } finally {
      db.close()
    }
  } catch {
    return rows
  }
  return rows
}

export function outboxMigrationStatus(options: OutboxMigrationOptions): OutboxMigrationStatus {
  const runtime = migrationRuntime(options)
  return summarize(listSources(runtime).map((path) => inspectMigration(path, runtime)))
}

export function migrateOutboxes(
  options: OutboxMigrationOptions,
  mode: "dry-run" | "apply",
): OutboxMigrationStatus {
  const runtime = migrationRuntime(options)
  const inventory = summarize(listSources(runtime).map((path) => inspectMigration(path, runtime)))
  if (mode === "dry-run") return inventory
  if (runtime.metadataOnly === true) {
    throw new OutboxMigrationError("unsafe-source", "Metadata-only inventory cannot be applied")
  }
  if (runtime.dbPath === undefined) {
    throw new OutboxMigrationError("ingest-failed", "Migration apply requires a ledger database path")
  }
  const files = inventory.files.map((file) => file.eligible ? migrateFile(file.path, runtime) : file)
  return summarize(files)
}

function summarize(files: readonly OutboxMigrationFileStatus[]): OutboxMigrationStatus {
  return {
    version: 1,
    files,
    candidateBytes: sum(files, (file) => file.eligible ? file.bytes : 0),
    metadataCandidateBytes: sum(files, (file) => file.reason === "candidate-scan-required" ? file.bytes : 0),
    inlineBytes: sum(files, (file) => file.inlineBytes),
    projectedCasBytes: sum(files, (file) => file.projectedCasBytes),
    projectedRewrittenBytes: sum(files, (file) => file.projectedRewrittenBytes),
    projectedReclaimBytes: sum(files, (file) => file.projectedReclaimBytes),
  }
}

function sum(
  files: readonly OutboxMigrationFileStatus[],
  value: (file: OutboxMigrationFileStatus) => number,
): number {
  return files.reduce((total, file) => safeAdd(total, value(file)), 0)
}

function inspectMigration(path: string, options: MigrationRuntime): OutboxMigrationFileStatus {
  const metadata = inspectMetadata(path, options)
  if (!metadata.status.eligible) return metadata.status
  if (options.metadataOnly === true) {
    return {
      ...metadata.status,
      eligible: false,
      reason: "candidate-scan-required",
    }
  }

  let scan: ScanResult
  try {
    scan = scanSource(path, options)
  } catch (error) {
    if (error instanceof OutboxMigrationError) {
      if (error.code === "record-too-large") return { ...metadata.status, eligible: false, reason: "record-too-large" }
      if (error.code === "cas-materialization-failed") return { ...metadata.status, eligible: false, reason: "corrupt-reference" }
    }
    return { ...metadata.status, eligible: false, reason: "invalid-record" }
  }
  if (migrationCompleted(metadata.status.sessionId, path, scan, options)) {
    return withScan(metadata.status, scan, false, "already-migrated")
  }
  if (!scan.terminalEvidence) return withScan(metadata.status, scan, false, "missing-terminal-record")
  if (scan.inlineRecords === 0) return withScan(metadata.status, scan, false, "already-migrated")
  return withScan(
    metadata.status,
    scan,
    true,
    scan.partialTail.length === 0 ? "candidate" : "candidate-partial-tail",
  )
}

function inspectMetadata(path: string, options: MigrationRuntime): Metadata {
  const sessionId = decodeSession(path)
  const base = (bytes: number, reason: OutboxMigrationReason, eligible = false): Metadata => ({
    status: emptyStatus(path, sessionId, bytes, reason, eligible),
  })
  if (options.currentFile !== undefined && resolve(options.currentFile) === resolve(path)) {
    return base(0, "current-file")
  }
  const source = openRegular(path, options.outboxDir)
  if (source === undefined) return base(0, "invalid-source")
  const bytes = source.size
  const proof = ownerEvidence(sessionId, options)
  if (proof.reason !== undefined || proof.evidence === undefined) {
    return base(bytes, proof.reason ?? "owner-unknown")
  }

  const evidence = proof.evidence
  const now = options.now ?? Date.now()
  const grace = nonnegative(options.graceMs, DEFAULT_GRACE_MS)
  if (evidence.owner.host !== (options.host ?? hostname())) return base(bytes, "owner-unknown")
  if (evidence.releasedAt === undefined) {
    const seenAt = Date.parse(evidence.lastSeenAt)
    if (!Number.isFinite(seenAt) || now - seenAt < grace) return base(bytes, "owner-fresh")
    if ((options.processAlive ?? defaultProcessAlive)(evidence.owner.pid)) return base(bytes, "owner-live")
  } else {
    const releasedAt = Date.parse(evidence.releasedAt)
    if (!Number.isFinite(releasedAt) || now - releasedAt < grace) return base(bytes, "owner-fresh")
  }
  if (now - source.modifiedAt < grace) return base(bytes, "too-young")
  return { ...base(bytes, "candidate", true), evidence }
}

function emptyStatus(
  path: string,
  sessionId: string,
  bytes: number,
  reason: OutboxMigrationReason,
  eligible: boolean,
): OutboxMigrationFileStatus {
  return {
    path,
    sessionId,
    bytes,
    eligible,
    reason,
    sourceSha256: null,
    completePrefixBytes: 0,
    completePrefixSha256: null,
    partialTailBytes: 0,
    terminalRecordPresent: null,
    inlineRecords: 0,
    inlineBytes: 0,
    referencedRecords: 0,
    projectedCasBytes: 0,
    projectedRewrittenBytes: 0,
    projectedReclaimBytes: 0,
  }
}

function ownerEvidence(
  sessionId: string,
  options: MigrationRuntime,
): { readonly evidence?: OwnerEvidence; readonly reason?: OutboxMigrationReason } {
  const terminal = readJson(outboxTerminalPathFor(sessionId, options.outboxDir), options.outboxDir)
  const lease = readJson(outboxLeasePathFor(sessionId, options.outboxDir), options.outboxDir)
  if (!terminal.present && !lease.present) return peerOwnerEvidence(sessionId, options)
  const decodedTerminal = terminalValue(terminal.value, sessionId)
  const decodedLease = leaseValue(lease.value, sessionId)
  if (terminal.present && decodedTerminal === undefined) return { reason: "invalid-terminal" }
  if (lease.present && decodedLease === undefined) return { reason: "invalid-lease" }
  if (decodedTerminal !== undefined && decodedLease !== undefined) {
    if (!sameOwner(decodedTerminal, decodedLease.owner)) return { reason: "invalid-lease" }
    return {
      evidence: {
        owner: decodedLease.owner,
        lastSeenAt: decodedLease.lastSeenAt,
        ...(decodedLease.releasedAt === undefined ? {} : { releasedAt: decodedLease.releasedAt }),
      },
    }
  }
  const peer = peerOwnerEvidence(sessionId, options)
  if (peer.evidence === undefined) {
    return { reason: decodedTerminal === undefined ? "invalid-lease" : "invalid-terminal" }
  }
  if (decodedTerminal !== undefined && !sameOwner(decodedTerminal, peer.evidence.owner)) {
    return { reason: "invalid-terminal" }
  }
  if (decodedLease !== undefined && !sameOwner(decodedLease.owner, peer.evidence.owner)) {
    return { reason: "invalid-lease" }
  }
  return peer
}

function peerOwnerEvidence(
  sessionId: string,
  options: MigrationRuntime,
): { readonly evidence?: OwnerEvidence; readonly reason?: OutboxMigrationReason } {
  const row = options.peerRows.get(sessionId)
  if (row === undefined || row.pid === null || !Number.isSafeInteger(row.pid) ||
      row.pid <= 0 || row.last_seen === null) return { reason: "owner-unknown" }
  const identity = row.owner_epoch ?? row.session_file ?? "legacy-peer"
  const leaseId = `legacy-${createHash("sha256").update(
    `${sessionId}\u0000${row.pid}\u0000${identity}`,
  ).digest("hex").slice(0, 32)}`
  return {
    evidence: {
      owner: { host: options.host ?? hostname(), pid: row.pid, leaseId },
      lastSeenAt: row.last_seen,
    },
  }
}

function terminalValue(value: unknown, sessionId: string): Owner | undefined {
  if (!isRecord(value) || value.v !== 1 || value.sessionId !== sessionId || !ownerValue(value.owner) ||
      typeof value.terminalAt !== "string" || !isRecord(value.source) || !safeOffset(value.source.byteOffset) ||
      typeof value.source.sha256 !== "string" || !DIGEST.test(value.source.sha256)) return undefined
  return value.owner
}

function leaseValue(
  value: unknown,
  sessionId: string,
): { readonly owner: Owner; readonly lastSeenAt: string; readonly releasedAt?: string } | undefined {
  if (!isRecord(value) || value.v !== 1 || value.sessionId !== sessionId || !ownerValue(value.owner) ||
      typeof value.lastSeenAt !== "string" ||
      (value.releasedAt !== undefined && typeof value.releasedAt !== "string")) return undefined
  return {
    owner: value.owner,
    lastSeenAt: value.lastSeenAt,
    ...(value.releasedAt === undefined ? {} : { releasedAt: value.releasedAt }),
  }
}

function withScan(
  status: OutboxMigrationFileStatus,
  scan: ScanResult,
  eligible: boolean,
  reason: OutboxMigrationReason,
): OutboxMigrationFileStatus {
  return {
    ...status,
    bytes: scan.source.size,
    eligible,
    reason,
    sourceSha256: scan.sourceSha256,
    completePrefixBytes: scan.completePrefixBytes,
    completePrefixSha256: scan.completePrefixSha256,
    partialTailBytes: scan.partialTail.length,
    terminalRecordPresent: scan.terminalEvidence,
    inlineRecords: scan.inlineRecords,
    inlineBytes: scan.inlineBytes,
    referencedRecords: scan.referencedRecords,
    projectedCasBytes: scan.projectedCasBytes,
    projectedRewrittenBytes: scan.projectedBytes,
    projectedReclaimBytes: eligible ? scan.completePrefixBytes : 0,
  }
}

function scanSource(path: string, options: OutboxMigrationOptions): ScanResult {
  const opened = openRegularDescriptor(path, options.outboxDir)
  if (opened === undefined) {
    throw new OutboxMigrationError("unsafe-source", `Source is not a contained regular file: ${path}`, path)
  }
  const sourceHash = createHash("sha256")
  const completeHash = createHash("sha256")
  const chunk = Buffer.allocUnsafe(IO_BYTES)
  let pending = Buffer.alloc(0)
  let position = 0
  let completePrefixBytes = 0
  let terminalEvidence = false
  let inlineRecords = 0
  let inlineBytes = 0
  let referencedRecords = 0
  let projectedCasBytes = 0
  let projectedBytes = 0
  const projectedDigests = new Set<string>()
  try {
    while (true) {
      const count = readSync(opened.descriptor, chunk, 0, chunk.length, position)
      if (count === 0) break
      const bytes = chunk.subarray(0, count)
      sourceHash.update(bytes)
      position += count
      const combined = pending.length === 0 ? bytes : Buffer.concat([pending, bytes])
      let start = 0
      for (let index = 0; index < combined.length; index += 1) {
        if (combined[index] !== 0x0a) continue
        const line = combined.subarray(start, index)
        if (line.length > MAX_RETENTION_RECORD_BYTES) {
          throw new OutboxMigrationError("record-too-large", `Outbox record exceeds hard maximum: ${path}`, path)
        }
        const record = parseRecord(line, path)
        terminalEvidence ||= isTerminalRecord(record)
        const projection = projectRecord(record, options.rawDir ?? defaultRawCaptureDir(), projectedDigests)
        inlineRecords += projection.inlineRecords
        inlineBytes = safeAdd(inlineBytes, projection.inlineBytes)
        referencedRecords += projection.referencedRecords
        projectedCasBytes = safeAdd(projectedCasBytes, projection.projectedCasBytes)
        const projectedLine = Buffer.from(`${JSON.stringify(projection.record)}\n`, "utf8")
        projectedBytes = safeAdd(projectedBytes, projectedLine.length)
        completeHash.update(line)
        completeHash.update("\n")
        completePrefixBytes += line.length + 1
        start = index + 1
      }
      pending = Buffer.from(combined.subarray(start))
      if (pending.length > MAX_RETENTION_RECORD_BYTES) {
        throw new OutboxMigrationError("record-too-large", `Outbox record exceeds hard maximum: ${path}`, path)
      }
    }
    const after = identityFromStat(fstatSync(opened.descriptor))
    if (!sameIdentity(opened.identity, after)) {
      throw new OutboxMigrationError("source-changed", `Outbox changed while scanning: ${path}`, path)
    }
    return {
      source: opened.identity,
      sourceSha256: sourceHash.digest("hex"),
      completePrefixBytes,
      completePrefixSha256: completeHash.digest("hex"),
      partialTail: pending,
      terminalEvidence,
      inlineRecords,
      inlineBytes,
      referencedRecords,
      projectedCasBytes,
      projectedBytes,
    }
  } finally {
    closeSync(opened.descriptor)
  }
}

interface Projection {
  readonly record: Record<string, unknown>
  readonly inlineRecords: number
  readonly inlineBytes: number
  readonly referencedRecords: number
  readonly projectedCasBytes: number
}

function projectRecord(
  record: Record<string, unknown>,
  rawDir: string,
  projectedDigests: Set<string>,
): Projection {
  if (!isRecord(record.payload)) {
    return { record, inlineRecords: 0, inlineBytes: 0, referencedRecords: 0, projectedCasBytes: 0 }
  }
  const raw = record.payload.rawRequest
  const existing = rawReferenceValue(record.payload.rawRequestRef)
  if (raw === undefined) {
    if (existing !== undefined) {
      try { verifyRawContentReference(rawDir, existing) } catch {
        throw new OutboxMigrationError("cas-materialization-failed", "Referenced raw request is missing or corrupt")
      }
      return { record, inlineRecords: 0, inlineBytes: 0, referencedRecords: 1, projectedCasBytes: 0 }
    }
    return { record, inlineRecords: 0, inlineBytes: 0, referencedRecords: 0, projectedCasBytes: 0 }
  }
  if (!isJsonValue(raw)) throw new OutboxMigrationError("invalid-record", "rawRequest is not JSON")
  const bytes = Buffer.from(canonicalJson(raw), "utf8")
  const reference = rawReference(raw, bytes)
  const payload: Record<string, unknown> = { ...record.payload, rawRequestRef: reference }
  delete payload.rawRequest
  let projectedCasBytes = 0
  if (!projectedDigests.has(reference.digest)) {
    projectedDigests.add(reference.digest)
    const objectPath = contentObjectPathFor(rawDir, reference.digest)
    if (!existsSync(objectPath)) projectedCasBytes = reference.byteLength
    else {
      try { verifyRawContentReference(rawDir, reference) } catch {
        throw new OutboxMigrationError("cas-materialization-failed", `CAS object is corrupt: ${reference.digest}`)
      }
    }
  }
  return {
    record: { ...record, payload },
    inlineRecords: 1,
    inlineBytes: Buffer.byteLength(JSON.stringify(raw)),
    referencedRecords: existing === undefined ? 0 : 1,
    projectedCasBytes,
  }
}

function migrateFile(path: string, options: MigrationRuntime): OutboxMigrationFileStatus {
  const sessionId = decodeSession(path)
  return withOutboxWriterFence(sessionId, options.outboxDir, (): OutboxMigrationFileStatus => {
    const metadata = inspectMetadata(path, options)
    if (!metadata.status.eligible || metadata.evidence === undefined) return metadata.status
    const scan = scanSource(path, options)
    if (!scan.terminalEvidence) {
      throw new OutboxMigrationError("missing-terminal-record", `No terminal event in complete JSONL prefix: ${path}`, path)
    }
    if (scan.inlineRecords === 0) return withScan(metadata.status, scan, false, "already-migrated")

    const id = `${encodeURIComponent(sessionId)}.${scan.sourceSha256}`
    const quarantineDir = options.quarantineDir ?? join(options.outboxDir, ".migration-quarantine")
    const stagingDir = options.stagingDir ?? join(options.archiveDir, "migration-manifests")
    mkdirSync(stagingDir, { recursive: true, mode: 0o700 })
    let quarantinePath: string | undefined
    if (scan.partialTail.length > 0) {
      mkdirSync(quarantineDir, { recursive: true, mode: 0o700 })
      const tailDigest = createHash("sha256").update(scan.partialTail).digest("hex")
      quarantinePath = join(quarantineDir, `${id}.${tailDigest}.partial-tail`)
      writeDurableExclusive(quarantinePath, scan.partialTail)
      writeDurableExclusive(
        `${quarantinePath}.receipt.json`,
        Buffer.from(`${JSON.stringify({
          v: 1,
          sourcePath: path,
          sourceSha256: scan.sourceSha256,
          completePrefixBytes: scan.completePrefixBytes,
          tailSha256: tailDigest,
          tailBytes: scan.partialTail.length,
        })}\n`, "utf8"),
      )
      fsyncDirectory(quarantineDir)
      crash(options, "after-quarantine")
    }

    const stagePath = join(stagingDir, `${id}.staging.jsonl`)
    const transformed = existsSync(stagePath)
      ? verifyStage(stagePath, scan.sourceSha256, path)
      : writeStage(path, stagePath, options, scan)
    if (transformed.originalDigest !== scan.sourceSha256) {
      throw new OutboxMigrationError("source-changed", `Outbox changed before migration: ${path}`, path)
    }
    fsyncDirectory(stagingDir)
    crash(options, "after-stage")

    const manifestPath = join(stagingDir, `${id}.json`)
    writeDurableExclusive(
      manifestPath,
      Buffer.from(`${JSON.stringify({
        v: 1,
        sessionId,
        sourcePath: path,
        sourceSha256: scan.sourceSha256,
        sourceBytes: scan.source.size,
        completePrefixBytes: scan.completePrefixBytes,
        completePrefixSha256: scan.completePrefixSha256,
        replacementSha256: transformed.digest,
        replacementBytes: transformed.bytes,
        ...(quarantinePath === undefined ? {} : { quarantinePath, partialTailBytes: scan.partialTail.length }),
        stagePath,
      })}\n`, "utf8"),
    )
    fsyncDirectory(stagingDir)
    crash(options, "after-cas")

    finishIngestAndProof(path, stagePath, sessionId, metadata.evidence, options, scan)
    return withScan(metadata.status, scan, false, "migrated")
  })
}

interface StageResult {
  readonly originalDigest: string
  readonly digest: string
  readonly bytes: number
}

function verifyStage(stagePath: string, sourceDigest: string, sourcePath: string): StageResult {
  const opened = openRegularDescriptor(stagePath, dirname(stagePath))
  if (opened === undefined) {
    throw new OutboxMigrationError("durability-failed", `Unsafe staging artifact: ${stagePath}`, sourcePath)
  }
  const hash = createHash("sha256")
  let bytes = 0
  const chunk = Buffer.allocUnsafe(IO_BYTES)
  try {
    while (true) {
      const count = readSync(opened.descriptor, chunk, 0, chunk.length, bytes)
      if (count === 0) break
      hash.update(chunk.subarray(0, count))
      bytes += count
    }
    const after = identityFromStat(fstatSync(opened.descriptor))
    if (!sameIdentity(opened.identity, after)) {
      throw new OutboxMigrationError("durability-failed", `Staging artifact changed: ${stagePath}`, sourcePath)
    }
  } finally {
    closeSync(opened.descriptor)
  }
  const digest = hash.digest("hex")
  const marker = readJson(`${stagePath}.meta`, dirname(stagePath))
  if (!isRecord(marker.value) || marker.value.originalDigest !== sourceDigest || marker.value.digest !== digest ||
      marker.value.bytes !== bytes) {
    throw new OutboxMigrationError("durability-failed", `Contradictory staging artifact: ${stagePath}`, sourcePath)
  }
  return { originalDigest: sourceDigest, digest, bytes }
}

function writeStage(
  sourcePath: string,
  stagePath: string,
  options: OutboxMigrationOptions,
  expected: ScanResult,
): StageResult {
  const opened = openRegularDescriptor(sourcePath, options.outboxDir)
  if (opened === undefined || !sameIdentity(opened.identity, expected.source)) {
    if (opened !== undefined) closeSync(opened.descriptor)
    throw new OutboxMigrationError("unsafe-source", `Unsafe migration source: ${sourcePath}`, sourcePath)
  }
  const output = openSync(
    stagePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  const sourceHash = createHash("sha256")
  const outputHash = createHash("sha256")
  const chunk = Buffer.allocUnsafe(IO_BYTES)
  let pending = Buffer.alloc(0)
  let position = 0
  let outputBytes = 0
  try {
    while (true) {
      const count = readSync(opened.descriptor, chunk, 0, chunk.length, position)
      if (count === 0) break
      const bytes = chunk.subarray(0, count)
      sourceHash.update(bytes)
      position += count
      const combined = pending.length === 0 ? bytes : Buffer.concat([pending, bytes])
      let start = 0
      for (let index = 0; index < combined.length; index += 1) {
        if (combined[index] !== 0x0a) continue
        const record = parseRecord(combined.subarray(start, index), sourcePath)
        const line = Buffer.from(
          `${JSON.stringify(materializeRecord(record, options.rawDir ?? defaultRawCaptureDir()))}\n`,
          "utf8",
        )
        writeAll(output, line)
        outputHash.update(line)
        outputBytes += line.length
        start = index + 1
      }
      pending = Buffer.from(combined.subarray(start))
      if (pending.length > MAX_RETENTION_RECORD_BYTES) {
        throw new OutboxMigrationError("record-too-large", `Outbox record exceeds hard maximum: ${sourcePath}`, sourcePath)
      }
    }
    const after = identityFromStat(fstatSync(opened.descriptor))
    if (!sameIdentity(opened.identity, after) || !sameIdentity(opened.identity, expected.source)) {
      throw new OutboxMigrationError("source-changed", `Outbox changed during rewrite: ${sourcePath}`, sourcePath)
    }
    fsyncSync(output)
    const result = {
      originalDigest: sourceHash.digest("hex"),
      digest: outputHash.digest("hex"),
      bytes: outputBytes,
    }
    writeDurableExclusive(`${stagePath}.meta`, Buffer.from(`${JSON.stringify(result)}\n`, "utf8"))
    fsyncDirectory(dirname(stagePath))
    return result
  } catch (error) {
    closeSync(output)
    try { unlinkSync(stagePath) } catch { /* preserve original failure */ }
    throw error
  } finally {
    try { closeSync(output) } catch { /* already closed on failure */ }
    closeSync(opened.descriptor)
  }
}

function materializeRecord(record: Record<string, unknown>, rawDir: string): Record<string, unknown> {
  if (!isRecord(record.payload) || record.payload.rawRequest === undefined) return record
  const raw = record.payload.rawRequest
  if (!isJsonValue(raw)) throw new OutboxMigrationError("invalid-record", "rawRequest is not JSON")
  const result = captureRawProviderPayload(raw, Date.now(), {
    enabled: true,
    dir: rawDir,
    quotaBytes: Number.MAX_SAFE_INTEGER,
    maxCaptureBytes: MAX_RAW_CAPTURE_INPUT_BYTES,
  })
  if (result.reference === undefined || (result.status !== "stored" && result.status !== "duplicate")) {
    throw new OutboxMigrationError(
      "cas-materialization-failed",
      `Unable to materialize inline rawRequest (${result.status})`,
    )
  }
  const payload: Record<string, unknown> = { ...record.payload, rawRequestRef: result.reference }
  delete payload.rawRequest
  return { ...record, payload }
}

function finishIngestAndProof(
  path: string,
  stagePath: string,
  sessionId: string,
  evidence: OwnerEvidence,
  options: OutboxMigrationOptions,
  scan: ScanResult,
): void {
  if (options.dbPath === undefined) throw new OutboxMigrationError("ingest-failed", "Missing ledger path", path)
  try {
    Effect.runSync(ingestOutbox(stagePath, {
      rawDir: options.rawDir ?? defaultRawCaptureDir(),
    }).pipe(Effect.provide(openLedger(options.dbPath))))
  } catch (error) {
    throw new OutboxMigrationError(
      "ingest-failed",
      error instanceof Error ? error.message : String(error),
      path,
    )
  }
  crash(options, "after-ingest")
  options.beforeProof?.()

  let source = verifySourceIdentity(path, options.outboxDir, scan.source)
  if (scan.partialTail.length > 0) {
    const descriptor = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const before = identityFromStat(fstatSync(descriptor))
      if (!sameIdentity(before, scan.source)) {
        throw new OutboxMigrationError("source-changed", `Outbox changed before tail repair: ${path}`, path)
      }
      ftruncateSync(descriptor, scan.completePrefixBytes)
      fsyncSync(descriptor)
      source = identityFromStat(fstatSync(descriptor))
      if (source.size !== scan.completePrefixBytes) {
        throw new OutboxMigrationError("durability-failed", `Outbox tail repair failed: ${path}`, path)
      }
    } finally {
      closeSync(descriptor)
    }
    fsyncDirectory(dirname(path))
  }
  crash(options, "after-repair")

  const cursor = readJson(options.cursorPath, dirname(options.cursorPath))
  if (cursor.present && (
    !isRecord(cursor.value) ||
    cursor.value.version !== 2 ||
    !isRecord(cursor.value.files)
  )) {
    throw new OutboxMigrationError(
      "durability-failed",
      `Existing cursor state is not a valid v2 proof: ${options.cursorPath}`,
      options.cursorPath,
    )
  }
  const files = isRecord(cursor.value) && isRecord(cursor.value.files)
    ? { ...cursor.value.files }
    : {}
  files[path] = {
    device: source.device,
    inode: source.inode,
    offset: scan.completePrefixBytes,
    modifiedAt: source.modifiedAt,
    sha256: scan.completePrefixSha256,
  }
  writeAtomicJson(options.cursorPath, { version: 2, files })
  crash(options, "after-cursor")

  const terminalAt = new Date(options.now ?? Date.now()).toISOString()
  writeAtomicJson(outboxLeasePathFor(sessionId, options.outboxDir), {
    v: 1,
    sessionId,
    owner: evidence.owner,
    lastSeenAt: evidence.lastSeenAt,
    releasedAt: terminalAt,
  })
  writeAtomicJson(outboxTerminalPathFor(sessionId, options.outboxDir), {
    v: 1,
    sessionId,
    owner: evidence.owner,
    terminalAt,
    source: { byteOffset: scan.completePrefixBytes, sha256: scan.completePrefixSha256 },
  })
  crash(options, "after-terminal")
  const completionPath = migrationCompletionPath(options.archiveDir, sessionId)
  writeDurableExclusive(completionPath, Buffer.from(`${JSON.stringify({
    v: 1,
    sessionId,
    sourcePath: path,
    sourceSha256: scan.completePrefixSha256,
    sourceBytes: scan.completePrefixBytes,
    stagePath,
    completedAt: terminalAt,
  })}\n`, "utf8"))
}

function migrationCompletionPath(archiveDir: string, sessionId: string): string {
  return join(archiveDir, "migration-receipts", `${encodeURIComponent(sessionId)}.json`)
}

function migrationCompleted(
  sessionId: string,
  sourcePath: string,
  scan: ScanResult,
  options: OutboxMigrationOptions,
): boolean {
  const path = migrationCompletionPath(options.archiveDir, sessionId)
  const receipt = readJson(path, dirname(path))
  if (!receipt.present) return false
  if (!isRecord(receipt.value) || receipt.value.v !== 1 ||
      receipt.value.sessionId !== sessionId || receipt.value.sourcePath !== sourcePath ||
      receipt.value.sourceSha256 !== scan.completePrefixSha256 ||
      receipt.value.sourceBytes !== scan.completePrefixBytes) {
    throw new OutboxMigrationError(
      "durability-failed",
      `Contradictory migration completion receipt: ${path}`,
      path,
    )
  }
  return true
}

function verifySourceIdentity(
  path: string,
  root: string,
  expected: SourceIdentity,
): SourceIdentity {
  const opened = openRegularDescriptor(path, root)
  if (opened === undefined || !sameIdentity(opened.identity, expected)) {
    if (opened !== undefined) closeSync(opened.descriptor)
    throw new OutboxMigrationError("source-changed", `Outbox changed before proof: ${path}`, path)
  }
  closeSync(opened.descriptor)
  return opened.identity
}

function rawReference(value: JsonValue, bytes: Buffer): RawContentReferenceV1 {
  return {
    v: 1,
    algorithm: "sha256",
    digest: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.length,
    contentType: "application/json",
    representation: "json-utf8",
    summary: {
      redacted: true,
      valueType: value === null
        ? "null"
        : Array.isArray(value)
          ? "array"
          : typeof value === "object"
            ? "object"
            : valueType(value),
      itemCount: Array.isArray(value)
        ? value.length
        : value !== null && typeof value === "object"
          ? Object.keys(value).length
          : 0,
    },
  }
}

function rawReferenceValue(value: unknown): RawContentReferenceV1 | undefined {
  if (!isRecord(value) || value.v !== 1 || value.algorithm !== "sha256" ||
      typeof value.digest !== "string" || !DIGEST.test(value.digest) ||
      !safeOffset(value.byteLength) || value.contentType !== "application/json" ||
      value.representation !== "json-utf8" || !isRecord(value.summary) ||
      value.summary.redacted !== true || !safeOffset(value.summary.itemCount) ||
      (value.summary.valueType !== "null" && value.summary.valueType !== "boolean" &&
        value.summary.valueType !== "number" && value.summary.valueType !== "string" &&
        value.summary.valueType !== "array" && value.summary.valueType !== "object")) return undefined
  return value as unknown as RawContentReferenceV1
}

function valueType(value: string | number | boolean): "string" | "number" | "boolean" {
  if (typeof value === "string") return "string"
  if (typeof value === "number") return "number"
  return "boolean"
}

function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value: JsonValue): JsonValue {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new OutboxMigrationError("invalid-record", "Non-finite rawRequest number")
  }
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(canonicalValue)
  const objectValue = value as { readonly [key: string]: JsonValue }
  const sorted: Record<string, JsonValue> = {}
  for (const key of Object.keys(objectValue).sort()) {
    const child = objectValue[key]
    if (child !== undefined) sorted[key] = canonicalValue(child)
  }
  return sorted
}

function isTerminalRecord(record: Record<string, unknown>): boolean {
  if (record.kind === "session" && isRecord(record.payload) &&
      record.payload.endedAt !== undefined && record.payload.endedAt !== null) return true
  if (record.kind !== "event" || !isRecord(record.payload)) return false
  const kind = record.payload.kind
  return kind === "session_shutdown" || kind === "sessionEnd" || kind === "session-end" ||
    kind === "session-ended" || kind === "session_terminal" || kind === "sessionTerminal"
}

function parseRecord(bytes: Buffer, path: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"))
    if (!isRecord(value)) throw new Error("record is not an object")
    return value
  } catch (error) {
    throw new OutboxMigrationError(
      "invalid-record",
      `Invalid JSONL record in ${path}: ${error instanceof Error ? error.message : String(error)}`,
      path,
    )
  }
}

function readJson(path: string, root: string): JsonRead {
  const read = readBoundedRegularFile(path, root, MAX_RETENTION_SIDECAR_BYTES)
  if (!read.present || read.bytes === undefined) return { present: read.present }
  try {
    return { present: true, value: JSON.parse(read.bytes.toString("utf8")) as unknown }
  } catch {
    return { present: true }
  }
}

function openRegular(path: string, root: string): SourceIdentity | undefined {
  const opened = openRegularDescriptor(path, root)
  if (opened === undefined) return undefined
  try { return opened.identity } finally { closeSync(opened.descriptor) }
}

function openRegularDescriptor(path: string, root: string): OpenedSource | undefined {
  if (!isContainedPath(path, root)) return undefined
  let descriptor: number
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch {
    return undefined
  }
  const stat = fstatSync(descriptor)
  if (!stat.isFile()) {
    closeSync(descriptor)
    return undefined
  }
  return { descriptor, identity: identityFromStat(stat) }
}

function identityFromStat(stat: Stats): SourceIdentity {
  return {
    device: stat.dev,
    inode: stat.ino,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    changedAt: stat.ctimeMs,
  }
}

function sameIdentity(left: SourceIdentity, right: SourceIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.size === right.size &&
    left.modifiedAt === right.modifiedAt && left.changedAt === right.changedAt
}

function isContainedPath(path: string, root: string): boolean {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(path)
  const traversal = relative(resolvedRoot, resolvedPath)
  if (traversal === ".." || traversal.startsWith(`..${sep}`)) return false
  try {
    const realRoot = realpathSync(root)
    const realParent = realpathSync(dirname(path))
    const realCandidate = join(realParent, basename(path))
    const realTraversal = relative(realRoot, realCandidate)
    return realTraversal !== ".." && !realTraversal.startsWith(`..${sep}`)
  } catch {
    return false
  }
}

function writeAll(descriptor: number, bytes: Buffer): void {
  let offset = 0
  while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset, bytes.length - offset)
}

function writeDurableExclusive(path: string, bytes: Buffer): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (existsSync(path)) {
    const current = readBoundedRegularFile(path, dirname(path), bytes.length)
    if (current.bytes !== undefined && current.bytes.equals(bytes)) return
    throw new OutboxMigrationError("durability-failed", `Immutable migration artifact mismatch: ${path}`, path)
  }
  const descriptor = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o400,
  )
  try { writeAll(descriptor, bytes); fsyncSync(descriptor) } finally { closeSync(descriptor) }
  fsyncDirectory(dirname(path))
}

function writeAtomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8")
  const digest = createHash("sha256").update(bytes).digest("hex")
  const temporary = `${path}.${process.pid}.${digest.slice(0, 12)}.tmp`
  const descriptor = openSync(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try { writeAll(descriptor, bytes); fsyncSync(descriptor) } finally { closeSync(descriptor) }
  renameSync(temporary, path)
  fsyncDirectory(dirname(path))
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, constants.O_RDONLY)
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

function listSources(options: OutboxMigrationOptions): readonly string[] {
  if (options.onlyFile !== undefined) {
    return isContainedPath(options.onlyFile, options.outboxDir) ? [options.onlyFile] : []
  }
  try {
    return readdirSync(options.outboxDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => join(options.outboxDir, entry.name))
      .sort()
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return []
    throw error
  }
}

function decodeSession(path: string): string {
  try { return decodeURIComponent(basename(path, ".jsonl")) } catch { return basename(path, ".jsonl") }
}

function ownerValue(value: unknown): value is Owner {
  return isRecord(value) && typeof value.host === "string" && typeof value.pid === "number" &&
    Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.leaseId === "string" &&
    value.leaseId.length > 0
}

function sameOwner(left: Owner, right: Owner): boolean {
  return left.host === right.host && left.pid === right.pid && left.leaseId === right.leaseId
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function defaultProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) {
    return isRecord(error) && error.code === "EPERM"
  }
}

function safeOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function nonnegative(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) || value < 0 ? fallback : value
}

function safeAdd(left: number, right: number): number {
  return left > Number.MAX_SAFE_INTEGER - right ? Number.MAX_SAFE_INTEGER : left + right
}

function crash(options: OutboxMigrationOptions, point: OutboxMigrationOptions["crashPoint"]): void {
  if (options.crashPoint === point) {
    throw new OutboxMigrationError("durability-failed", `Injected migration crash: ${point}`)
  }
}
