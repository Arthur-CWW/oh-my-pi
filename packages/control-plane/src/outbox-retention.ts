import { createHash, createPublicKey, verify as verifySignature } from "node:crypto"
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  type Stats,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { hostname } from "node:os"
import { basename, dirname, join, relative, resolve, sep } from "node:path"

import {
  contentObjectPathFor,
  defaultRawCaptureDir,
  outboxLeasePathFor,
  MAX_SERIALIZED_OUTBOX_RECORD_BYTES,
  outboxTerminalPathFor,
  withOutboxWriterFence,
  type RawContentReferenceV1,
  type OutboxLeaseV1,
  type OutboxTerminalV1,
} from "./outbox"

export const MAX_RETENTION_RECORD_BYTES = MAX_SERIALIZED_OUTBOX_RECORD_BYTES
export const MAX_RETENTION_SIDECAR_BYTES = 256 * 1024
export const DEFAULT_RETENTION_GRACE_MS = 24 * 60 * 60 * 1_000
const DIGEST = /^[0-9a-f]{64}$/
const IO_BYTES = 64 * 1024

export type RetentionReason =
  | "eligible"
  | "current-file"
  | "missing-terminal"
  | "invalid-terminal"
  | "missing-lease"
  | "invalid-lease"
  | "owner-unknown"
  | "owner-fresh"
  | "owner-live"
  | "too-young"
  | "missing-cursor"
  | "legacy-cursor"
  | "cursor-not-eof"
  | "cursor-digest-mismatch"
  | "terminal-source-mismatch"
  | "partial-final-line"
  | "record-too-large"
  | "invalid-record"
  | "missing-reference"
  | "corrupt-reference"
  | "h11-transfer-pending"

export interface FleetSyncReceiptTrustV1 {
  readonly producerId: string
  readonly keyId: string
  readonly sourceHost: string
  readonly destinationHost: string
  readonly publicKey: string
}

export interface FleetSyncImmutableTransferClaimV2 {
  readonly v: 2
  readonly producerId: string
  readonly keyId: string
  readonly sourceHost: string
  readonly destinationHost: string
  readonly runId: string
  readonly assetLogicalKey: string
  readonly assetLogicalDigest: string
  readonly assetManifestSha256: string
  readonly sourceSha256: string
  readonly bytes: number
}

export function fleetSyncImmutableTransferClaimBytes(claim: FleetSyncImmutableTransferClaimV2): Buffer {
  return Buffer.from(JSON.stringify({
    v: claim.v,
    producerId: claim.producerId,
    keyId: claim.keyId,
    sourceHost: claim.sourceHost,
    destinationHost: claim.destinationHost,
    runId: claim.runId,
    assetLogicalKey: claim.assetLogicalKey,
    assetLogicalDigest: claim.assetLogicalDigest,
    assetManifestSha256: claim.assetManifestSha256,
    sourceSha256: claim.sourceSha256,
    bytes: claim.bytes,
  }), "utf8")
}

export interface OutboxRetentionOptions {
  readonly outboxDir: string
  readonly cursorPath: string
  readonly archiveDir: string
  readonly rawDir?: string
  readonly h11AssetRoot?: string
  readonly graceMs?: number
  readonly now?: number
  readonly currentFile?: string
  readonly host?: string
  readonly processAlive?: (pid: number) => boolean
  readonly h11ManifestDir?: string
  readonly immutableReceiptDir?: string
  readonly immutableReceiptTrust?: FleetSyncReceiptTrustV1
  readonly crashPoint?: "after-manifest" | "after-authorization" | "after-unlink"
  readonly beforeFinalUnlink?: () => void
}

export interface VerificationStatus {
  readonly present: boolean
  readonly valid: boolean
  readonly detail?: string
}

export interface OutboxRetentionFileStatus {
  readonly path: string
  readonly sessionId: string
  readonly bytes: number
  readonly sourceSha256: string | null
  readonly eligible: boolean
  readonly reason: RetentionReason
  readonly terminal: VerificationStatus
  readonly cursor: VerificationStatus
  readonly references: VerificationStatus & { readonly count: number }
  readonly referenceDigests: readonly string[]
  readonly completeFinalNewline: boolean | null
  readonly projectedReclaimBytes: number
}

export interface OutboxRetentionStatus {
  readonly version: 1
  readonly files: readonly OutboxRetentionFileStatus[]
  readonly projectedReclaimBytes: number
}

type TerminalV1 = OutboxTerminalV1
type LeaseV1 = OutboxLeaseV1
type Owner = OutboxTerminalV1["owner"]
interface CursorV2 { readonly version: 2; readonly files: Record<string, { readonly offset: number; readonly sha256: string; readonly device: number; readonly inode: number }> }
interface SourceInspection { readonly sha256: string; readonly complete: boolean; readonly refs: readonly RawContentReferenceV1[]; readonly error?: RetentionReason }

export function outboxRetentionStatus(options: OutboxRetentionOptions): OutboxRetentionStatus {
  const files = listJsonl(options.outboxDir).map((path) => inspectFile(path, options))
  return { version: 1, files, projectedReclaimBytes: files.reduce((sum, file) => sum + file.projectedReclaimBytes, 0) }
}

export function pruneOutbox(
  options: OutboxRetentionOptions,
  mode: "dry-run" | "apply",
): OutboxRetentionStatus {
  if (mode === "dry-run") return outboxRetentionStatus(options)
  recoverInterruptedApplies(options)
  const status = outboxRetentionStatus(options)
  const files = status.files.map((file) => file.eligible ? applyFile(file, options) : file)
  return { version: 1, files, projectedReclaimBytes: files.reduce((sum, file) => sum + file.projectedReclaimBytes, 0) }
}

function inspectFile(path: string, options: OutboxRetentionOptions): OutboxRetentionFileStatus {
  const stat = statRegular(path)
  const sessionId = decodeSession(path)
  if (stat === undefined) {
    return {
      path, sessionId, bytes: 0, sourceSha256: null, eligible: false, reason: "invalid-record",
      terminal: absent(), cursor: absent(), references: { present: false, valid: false, count: 0 },
      referenceDigests: [], completeFinalNewline: null, projectedReclaimBytes: 0,
    }
  }
  const base = (reason: RetentionReason, terminal: VerificationStatus, cursor: VerificationStatus): OutboxRetentionFileStatus => ({
    path,
    sessionId,
    bytes: stat.size,
    sourceSha256: null,
    eligible: false,
    reason,
    terminal,
    cursor,
    references: { present: false, valid: false, count: 0 },
    referenceDigests: [],
    completeFinalNewline: null,
    projectedReclaimBytes: 0,
  })
  if (options.currentFile !== undefined && resolve(options.currentFile) === resolve(path)) {
    return base("current-file", absent(), absent())
  }
  const terminalRead = readJson(outboxTerminalPathFor(sessionId, options.outboxDir), options.outboxDir)
  if (!terminalRead.present) return base("missing-terminal", absent(), absent())
  const terminal = terminalValue(terminalRead.value, sessionId)
  if (terminal === undefined) return base("invalid-terminal", invalid("schema"), absent())
  const terminalStatus = valid()
  const leaseRead = readJson(outboxLeasePathFor(sessionId, options.outboxDir), options.outboxDir)
  if (!leaseRead.present) return base("missing-lease", terminalStatus, absent())
  const lease = leaseValue(leaseRead.value, sessionId)
  if (lease === undefined || !sameOwner(lease.owner, terminal.owner)) return base("invalid-lease", terminalStatus, absent())
  const now = options.now ?? Date.now()
  const grace = nonnegative(options.graceMs, DEFAULT_RETENTION_GRACE_MS)
  const seenAt = Date.parse(lease.lastSeenAt)
  if (lease.owner.host !== (options.host ?? hostname())) return base("owner-unknown", terminalStatus, absent())
  if (lease.releasedAt === undefined) {
    if (!Number.isFinite(seenAt) || now - seenAt < grace) return base("owner-fresh", terminalStatus, absent())
    if ((options.processAlive ?? defaultProcessAlive)(lease.owner.pid)) return base("owner-live", terminalStatus, absent())
  } else {
    const releasedAt = Date.parse(lease.releasedAt)
    if (!Number.isFinite(releasedAt)) return base("invalid-lease", terminalStatus, absent())
    if (now - releasedAt < grace) return base("owner-fresh", terminalStatus, absent())
  }
  const terminalAt = Date.parse(terminal.terminalAt)
  if (!Number.isFinite(terminalAt) || now - terminalAt < grace || now - stat.mtimeMs < grace) return base("too-young", terminalStatus, absent())

  const cursorRead = readJson(options.cursorPath, dirname(options.cursorPath))
  if (!cursorRead.present) return base("missing-cursor", terminalStatus, absent())
  const cursorState = cursorValue(cursorRead.value)
  if (cursorState === "legacy") return base("legacy-cursor", terminalStatus, invalid("v1 has no digest"))
  if (cursorState === undefined) return base("missing-cursor", terminalStatus, invalid("schema"))
  const cursor = cursorState.files[path] ?? cursorState.files[resolve(path)]
  if (cursor === undefined) return base("missing-cursor", terminalStatus, absent())
  if (cursor.device !== stat.dev || cursor.inode !== stat.ino) return base("cursor-not-eof", terminalStatus, invalid("identity"))
  if (cursor.offset !== stat.size) return base("cursor-not-eof", terminalStatus, invalid("offset"))
  if (!isSealedSegment(path, options.outboxDir) && terminal.source.byteOffset !== stat.size) {
    return base("terminal-source-mismatch", invalid("offset"), valid())
  }

  const source = inspectSource(path)
  const after = statRegular(path)
  const referenceStatus: OutboxRetentionFileStatus["references"] = {
    present: source.refs.length > 0,
    valid: source.error === undefined,
    count: source.refs.length,
    ...(source.error === undefined ? {} : { detail: source.error }),
  }
  let reason = source.error
  if (after === undefined || after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
    reason = "cursor-digest-mismatch"
  }
  if (reason === undefined && !source.complete) reason = "partial-final-line"
  if (reason === undefined && cursor.sha256 !== source.sha256) reason = "cursor-digest-mismatch"
  if (reason === undefined && !isSealedSegment(path, options.outboxDir) && terminal.source.sha256 !== source.sha256) reason = "terminal-source-mismatch"
  const namedDigest = sealedSegmentDigest(path, options.outboxDir)
  if (reason === undefined && namedDigest !== undefined && namedDigest !== source.sha256) reason = "terminal-source-mismatch"
  if (reason === undefined) reason = verifyReferences(source.refs, options.rawDir ?? defaultRawCaptureDir())
  const eligible = reason === undefined
  return {
    path,
    sessionId,
    bytes: stat.size,
    sourceSha256: source.sha256,
    eligible,
    reason: reason ?? "eligible",
    terminal: reason === "terminal-source-mismatch" ? invalid("digest") : terminalStatus,
    cursor: reason === "cursor-digest-mismatch" ? invalid("digest") : valid(),
    references: reason === "missing-reference" || reason === "corrupt-reference" ? { ...referenceStatus, valid: false, detail: reason } : referenceStatus,
    referenceDigests: [...new Set(source.refs.map((reference) => reference.digest))],
    completeFinalNewline: source.complete,
    projectedReclaimBytes: eligible ? stat.size : 0,
  }
}

function inspectSource(path: string): SourceInspection {
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const before = fstatSync(descriptor)
    if (!before.isFile()) return { sha256: "", complete: false, refs: [], error: "invalid-record" }
    return inspectSourceDescriptor(descriptor, before)
  } catch {
    return { sha256: "", complete: false, refs: [], error: "invalid-record" }
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor) } catch { /* bounded cleanup */ }
    }
  }
}

function inspectSourceDescriptor(descriptor: number, before: Stats): SourceInspection {
  const hash = createHash("sha256")
  const chunk = Buffer.allocUnsafe(IO_BYTES)
  let pending = Buffer.alloc(0)
  let position = 0
  let complete = true
  const refs: RawContentReferenceV1[] = []
  let error: RetentionReason | undefined
  while (true) {
    const count = readSync(descriptor, chunk, 0, chunk.byteLength, position)
    if (count === 0) break
    const bytes = chunk.subarray(0, count)
    hash.update(bytes)
    position += count
    if (error !== undefined) continue
    const combined = pending.length === 0 ? bytes : Buffer.concat([pending, bytes])
    let start = 0
    for (let index = 0; index < combined.length; index += 1) {
      if (combined[index] !== 0x0a) continue
      const line = combined.subarray(start, index)
      if (line.length > MAX_RETENTION_RECORD_BYTES) { error = "record-too-large"; break }
      try { collectReferences(JSON.parse(line.toString("utf8")), refs) } catch { error = "invalid-record"; break }
      start = index + 1
    }
    pending = error === undefined ? Buffer.from(combined.subarray(start)) : Buffer.alloc(0)
    if (pending.length > MAX_RETENTION_RECORD_BYTES) error = "record-too-large"
  }
  complete = position === 0 || pending.length === 0
  const after = fstatSync(descriptor)
  if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
    return { sha256: hash.digest("hex"), complete: false, refs: [], error: "cursor-digest-mismatch" }
  }
  return { sha256: hash.digest("hex"), complete, refs, ...(error === undefined ? {} : { error }) }
}

function collectReferences(value: unknown, refs: RawContentReferenceV1[]): void {
  if (Array.isArray(value)) { for (const item of value) collectReferences(item, refs); return }
  if (!isRecord(value)) return
  if (
    value.v === 1 &&
    value.algorithm === "sha256" &&
    typeof value.digest === "string" &&
    DIGEST.test(value.digest) &&
    typeof value.byteLength === "number" &&
    Number.isSafeInteger(value.byteLength) &&
    value.byteLength >= 0 &&
    value.contentType === "application/json" &&
    value.representation === "json-utf8" &&
    isRecord(value.summary) &&
    value.summary.redacted === true &&
    (value.summary.valueType === "null" || value.summary.valueType === "boolean" || value.summary.valueType === "number" ||
      value.summary.valueType === "string" || value.summary.valueType === "array" || value.summary.valueType === "object") &&
    typeof value.summary.itemCount === "number" &&
    Number.isSafeInteger(value.summary.itemCount) &&
    value.summary.itemCount >= 0
  ) {
    refs.push(value as unknown as RawContentReferenceV1)
    return
  }
  if (value.algorithm === "sha256" || value.representation === "json-utf8") {
    throw new Error("invalid raw content reference")
  }
  for (const child of Object.values(value)) collectReferences(child, refs)
}

function verifyReferences(refs: readonly RawContentReferenceV1[], rawDir: string): RetentionReason | undefined {
  const seen = new Set<string>()
  for (const ref of refs) {
    if (seen.has(ref.digest)) continue
    seen.add(ref.digest)
    const path = contentObjectPathFor(rawDir, ref.digest)
    const stat = statRegular(path)
    if (stat === undefined || stat.size !== ref.byteLength) return "corrupt-reference"
    try {
      if (hashRegularFile(path, rawDir) !== ref.digest) return "corrupt-reference"
    } catch {
      return "corrupt-reference"
    }
  }
  return undefined
}

function applyFile(file: OutboxRetentionFileStatus, options: OutboxRetentionOptions): OutboxRetentionFileStatus {
  return withOutboxWriterFence(file.sessionId, options.outboxDir, (): OutboxRetentionFileStatus => {
    const refreshed = inspectFile(file.path, options)
    if (!refreshed.eligible) return refreshed
    const digest = refreshed.sourceSha256
    if (digest === null) return refreshed
    const receiptRoot = join(options.archiveDir, "receipts")
    const manifestRoot = join(options.archiveDir, "manifests")
    mkdirSync(receiptRoot, { recursive: true })
    mkdirSync(manifestRoot, { recursive: true })
    const id = `${encodeURIComponent(refreshed.sessionId)}.${digest}`
    const completionPath = join(receiptRoot, `${id}.completion.json`)
    const completion = readJson(completionPath, receiptRoot)
    if (completion.present && completion.value !== undefined) {
      return { ...refreshed, eligible: false, projectedReclaimBytes: 0 }
    }
    const manifest = {
      v: 1,
      sessionId: refreshed.sessionId,
      source: { path: refreshed.path, sha256: digest, bytes: refreshed.bytes },
      references: refreshed.referenceDigests.map((referenceDigest) => ({ algorithm: "sha256", digest: referenceDigest })),
      referencesVerified: true,
    }
    const manifestPath = join(manifestRoot, `${id}.json`)
    durableImmutableJson(manifestPath, manifest, manifestRoot)
    crash(options, "after-manifest")
    const manifestSha256 = hashRegularFile(manifestPath, manifestRoot)
    const authorizationPath = join(receiptRoot, `${id}.authorization.json`)
    const authorization = {
      v: 1,
      action: "prune",
      manifestPath,
      manifestSha256,
      ...(options.h11ManifestDir === undefined ? {} : { h11: true }),
      authorizedAt: new Date(options.now ?? Date.now()).toISOString(),
    }
    durableImmutableJson(authorizationPath, authorization, receiptRoot)
    const verifiedAuthorization = readJson(authorizationPath, receiptRoot)
    if (!verifiedAuthorization.present || !isRecord(verifiedAuthorization.value) ||
        verifiedAuthorization.value.manifestSha256 !== manifestSha256 ||
        verifiedAuthorization.value.manifestPath !== manifestPath) {
      throw new Error(`Prune authorization failed verification: ${authorizationPath}`)
    }
    crash(options, "after-authorization")
    if (options.h11ManifestDir !== undefined) {
      if (options.h11AssetRoot === undefined) throw new Error("H11 staging requires h11AssetRoot")
      const relativeSource = relative(resolve(options.h11AssetRoot), resolve(refreshed.path))
      if (relativeSource === "" || relativeSource === ".." || relativeSource.startsWith(`..${sep}`)) {
        throw new Error(`Outbox source is outside H11 asset root: ${refreshed.path}`)
      }
      mkdirSync(options.h11ManifestDir, { recursive: true })
      const assetPath = join(options.h11ManifestDir, `${id}.asset-manifest.json`)
      durableImmutableJson(assetPath, { version: 1, objects: [{ path: relativeSource, sha256: digest, bytes: refreshed.bytes }] }, options.h11ManifestDir)
      const assetDigest = hashRegularFile(assetPath, options.h11ManifestDir)
      if (!verifiedTransferReceipt(options.immutableReceiptDir, options.immutableReceiptTrust, id, assetDigest, digest, refreshed.bytes)) {
        return { ...refreshed, eligible: false, reason: "h11-transfer-pending", projectedReclaimBytes: 0 }
      }
    }
    options.beforeFinalUnlink?.()
    const final = inspectFile(refreshed.path, options)
    if (!final.eligible || final.sourceSha256 !== digest || final.bytes !== refreshed.bytes) {
      throw new Error(`Outbox changed before prune: ${refreshed.path}`)
    }
    unlinkSync(refreshed.path)
    fsyncDirectory(dirname(refreshed.path))
    crash(options, "after-unlink")
    durableImmutableJson(completionPath, {
      v: 1,
      action: "prune-complete",
      manifestPath,
      manifestSha256,
      completedAt: new Date(options.now ?? Date.now()).toISOString(),
    }, receiptRoot)
    return { ...refreshed, eligible: false, projectedReclaimBytes: 0 }
  })
}

function verifiedTransferReceipt(
  root: string | undefined,
  trust: FleetSyncReceiptTrustV1 | undefined,
  id: string,
  assetManifestSha256: string,
  sourceSha256: string,
  bytes: number,
): boolean {
  if (root === undefined || trust === undefined) return false
  const read = readJson(join(root, `${id}.immutable-transfer.json`), root)
  if (!read.present || !isRecord(read.value)) return false
  const value = read.value
  const keys = [
    "v", "producerId", "keyId", "sourceHost", "destinationHost", "runId", "assetLogicalKey",
    "assetLogicalDigest", "assetManifestSha256", "sourceSha256", "bytes", "signature",
  ] as const
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key as typeof keys[number])) ||
      value.v !== 2 || value.producerId !== trust.producerId || value.keyId !== trust.keyId ||
      value.sourceHost !== trust.sourceHost || value.destinationHost !== trust.destinationHost ||
      typeof value.runId !== "string" || !/^[0-9a-f]{24}$/.test(value.runId) ||
      value.assetLogicalKey !== `asset:sha256:${sourceSha256}` ||
      value.assetLogicalDigest !== `sha256:${sourceSha256}` ||
      value.assetManifestSha256 !== assetManifestSha256 || value.sourceSha256 !== sourceSha256 ||
      value.bytes !== bytes || !Number.isSafeInteger(value.bytes) || value.bytes < 0 ||
      typeof value.signature !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.signature)) return false
  const claim: FleetSyncImmutableTransferClaimV2 = {
    v: 2,
    producerId: trust.producerId,
    keyId: trust.keyId,
    sourceHost: trust.sourceHost,
    destinationHost: trust.destinationHost,
    runId: value.runId,
    assetLogicalKey: value.assetLogicalKey,
    assetLogicalDigest: value.assetLogicalDigest,
    assetManifestSha256,
    sourceSha256,
    bytes,
  }
  try {
    return verifySignature(
      null,
      fleetSyncImmutableTransferClaimBytes(claim),
      createPublicKey(trust.publicKey),
      Buffer.from(value.signature, "base64"),
    )
  } catch {
    return false
  }
}

function durableImmutableJson(path: string, value: unknown, root: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8")
  const expected = createHash("sha256").update(bytes).digest("hex")
  const existing = readBoundedRegularFile(path, root, bytes.byteLength)
  if (existing.present) {
    if (existing.bytes === undefined || existing.bytes.byteLength !== bytes.byteLength ||
        createHash("sha256").update(existing.bytes).digest("hex") !== expected) {
      throw new Error(`Immutable receipt mismatch: ${path}`)
    }
    return
  }
  const temporary = `${path}.${process.pid}.${expected.slice(0, 12)}.tmp`
  const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o444)
  try { writeFileSync(descriptor, bytes); fsyncSync(descriptor) } finally { closeSync(descriptor) }
  try {
    linkSync(temporary, path)
    unlinkSync(temporary)
  } catch (error) {
    unlinkSync(temporary)
    const raced = readBoundedRegularFile(path, root, bytes.byteLength)
    if (!raced.present) throw error
    if (raced.bytes === undefined || createHash("sha256").update(raced.bytes).digest("hex") !== expected) {
      throw new Error(`Immutable receipt mismatch: ${path}`)
    }
  }
  fsyncDirectory(dirname(path))
}

function hashFile(path: string): string {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  const before = fstatSync(descriptor)
  if (!before.isFile()) { closeSync(descriptor); throw new Error(`Not a regular file: ${path}`) }
  const hash = createHash("sha256")
  const chunk = Buffer.allocUnsafe(IO_BYTES)
  let position = 0
  try {
    while (true) { const count = readSync(descriptor, chunk, 0, chunk.length, position); if (count === 0) break; hash.update(chunk.subarray(0, count)); position += count }
    const after = fstatSync(descriptor)
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error(`File changed while hashing: ${path}`)
    }
    return hash.digest("hex")
  } finally { closeSync(descriptor) }
}

function hashRegularFile(path: string, root: string): string {
  if (!isContainedPath(path, root, true)) throw new Error(`File is outside trusted root: ${path}`)
  return hashFile(path)
}

interface BoundedRegularRead {
  readonly present: boolean
  readonly bytes?: Buffer
}

export function readBoundedRegularFile(path: string, root: string, maximumBytes: number): BoundedRegularRead {
  if (!isContainedPath(path, root, false)) return { present: true }
  let descriptor: number
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return { present: false }
    return { present: true }
  }
  try {
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.size < 0 || before.size > maximumBytes) return { present: true }
    const bytes = Buffer.allocUnsafe(before.size)
    let position = 0
    while (position < bytes.byteLength) {
      const count = readSync(descriptor, bytes, position, bytes.byteLength - position, position)
      if (count === 0) return { present: true }
      position += count
    }
    const after = fstatSync(descriptor)
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) return { present: true }
    return { present: true, bytes }
  } catch {
    return { present: true }
  } finally {
    closeSync(descriptor)
  }
}

function statRegular(path: string): Stats | undefined {
  try {
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const stat = fstatSync(descriptor)
      return stat.isFile() ? stat : undefined
    } finally { closeSync(descriptor) }
  } catch { return undefined }
}

function isContainedPath(path: string, root: string, requireExistingParent: boolean): boolean {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(path)
  const lexical = relative(resolvedRoot, resolvedPath)
  if (lexical === ".." || lexical.startsWith(`..${sep}`) || resolve(root, lexical) !== resolvedPath) return false
  try {
    const realRoot = realpathSync(root)
    const realParent = realpathSync(dirname(path))
    const realCandidate = join(realParent, basename(path))
    const traversal = relative(realRoot, realCandidate)
    return traversal !== ".." && !traversal.startsWith(`..${sep}`)
  } catch (error) {
    if (!requireExistingParent && isRecord(error) && error.code === "ENOENT") return true
    return false
  }
}

function fsyncDirectory(path: string): void { const descriptor = openSync(path, "r"); try { fsyncSync(descriptor) } finally { closeSync(descriptor) } }
function readJson(path: string, root: string): { readonly present: boolean; readonly value?: unknown } {
  const read = readBoundedRegularFile(path, root, MAX_RETENTION_SIDECAR_BYTES)
  if (!read.present || read.bytes === undefined) return { present: read.present }
  try {
    return { present: true, value: JSON.parse(read.bytes.toString("utf8")) as unknown }
  } catch {
    return { present: true }
  }
}
function recoverInterruptedApplies(options: OutboxRetentionOptions): void {
  const receiptRoot = join(options.archiveDir, "receipts")
  const manifestRoot = join(options.archiveDir, "manifests")
  for (const path of listFilesEnding(receiptRoot, ".authorization.json")) {
    const authorization = readJson(path, receiptRoot)
    if (!authorization.present || !isRecord(authorization.value) || authorization.value.v !== 1 ||
        authorization.value.action !== "prune" || typeof authorization.value.manifestPath !== "string" ||
        typeof authorization.value.manifestSha256 !== "string" || !DIGEST.test(authorization.value.manifestSha256)) continue
    let manifestDigest: string
    try { manifestDigest = hashRegularFile(authorization.value.manifestPath, manifestRoot) } catch { continue }
    if (manifestDigest !== authorization.value.manifestSha256) continue
    const manifest = readJson(authorization.value.manifestPath, manifestRoot)
    if (!manifest.present || !isRecord(manifest.value) || !isRecord(manifest.value.source) ||
        typeof manifest.value.source.path !== "string" || typeof manifest.value.source.sha256 !== "string" ||
        !DIGEST.test(manifest.value.source.sha256) || typeof manifest.value.source.bytes !== "number") continue
    if (!isContainedPath(manifest.value.source.path, options.outboxDir, false)) continue
    if (existsSync(manifest.value.source.path)) continue
    if (authorization.value.h11 === true) {
      if (options.h11ManifestDir === undefined) continue
      const id = basename(path, ".authorization.json")
      const assetPath = join(options.h11ManifestDir, `${id}.asset-manifest.json`)
      let assetDigest: string
      try { assetDigest = hashRegularFile(assetPath, options.h11ManifestDir) } catch { continue }
      if (!verifiedTransferReceipt(options.immutableReceiptDir, options.immutableReceiptTrust, id, assetDigest, manifest.value.source.sha256, manifest.value.source.bytes)) continue
    }
    const completionPath = path.slice(0, -".authorization.json".length) + ".completion.json"
    durableImmutableJson(completionPath, {
      v: 1,
      action: "prune-complete",
      manifestPath: authorization.value.manifestPath,
      manifestSha256: authorization.value.manifestSha256,
      completedAt: new Date(options.now ?? Date.now()).toISOString(),
    }, receiptRoot)
  }
}
function terminalValue(value: unknown, sessionId: string): TerminalV1 | undefined {
  if (!isRecord(value) || value.v !== 1 || value.sessionId !== sessionId || !ownerValue(value.owner) || !isRecord(value.source) || !safeOffset(value.source.byteOffset) || typeof value.source.sha256 !== "string" || !DIGEST.test(value.source.sha256) || typeof value.terminalAt !== "string") return undefined
  return value as unknown as TerminalV1
}
function leaseValue(value: unknown, sessionId: string): LeaseV1 | undefined {
  if (!isRecord(value) || value.v !== 1 || value.sessionId !== sessionId || !ownerValue(value.owner) || typeof value.lastSeenAt !== "string" || (value.releasedAt !== undefined && typeof value.releasedAt !== "string")) return undefined
  return value as unknown as LeaseV1
}
function cursorValue(value: unknown): CursorV2 | "legacy" | undefined {
  if (!isRecord(value)) return undefined
  if (value.version === 1) return "legacy"
  if (value.version !== 2 || !isRecord(value.files)) return undefined
  for (const cursor of Object.values(value.files)) {
    if (!isRecord(cursor) || !safeOffset(cursor.offset) || typeof cursor.sha256 !== "string" || !DIGEST.test(cursor.sha256) ||
        typeof cursor.device !== "number" || !Number.isSafeInteger(cursor.device) || cursor.device < 0 ||
        typeof cursor.inode !== "number" || !Number.isSafeInteger(cursor.inode) || cursor.inode < 0) return undefined
  }
  return value as unknown as CursorV2
}
function ownerValue(value: unknown): value is Owner { return isRecord(value) && typeof value.host === "string" && typeof value.pid === "number" && Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.leaseId === "string" && value.leaseId.length > 0 }
function sameOwner(a: Owner, b: Owner): boolean { return a.host === b.host && a.pid === b.pid && a.leaseId === b.leaseId }
function safeOffset(value: unknown): boolean { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function decodeSession(path: string): string {
  const name = basename(path)
  const sealed = /^(.*)\.\d+-\d+\.[0-9a-f]{64}\.jsonl$/.exec(name)
  const encoded = sealed?.[1] ?? basename(path, ".jsonl")
  try { return decodeURIComponent(encoded) } catch { return encoded }
}
function listJsonl(root: string): readonly string[] {
  return [...listJsonlDirectory(root), ...listJsonlDirectory(join(root, "sealed"))].sort()
}
function listJsonlDirectory(root: string): readonly string[] {
  try {
    return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl")).map((entry) => join(root, entry.name))
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return []
    throw error
  }
}
function isSealedSegment(path: string, root: string): boolean {
  return resolve(dirname(path)) === resolve(join(root, "sealed"))
}
function sealedSegmentDigest(path: string, root: string): string | undefined {
  if (!isSealedSegment(path, root)) return undefined
  return /\.([0-9a-f]{64})\.jsonl$/.exec(basename(path))?.[1]
}
function listFilesEnding(root: string, suffix: string): readonly string[] {
  try {
    return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(suffix)).map((entry) => join(root, entry.name)).sort()
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return []
    throw error
  }
}
function defaultProcessAlive(pid: number): boolean { try { process.kill(pid, 0); return true } catch (error) { return isRecord(error) && error.code === "EPERM" } }
function valid(): VerificationStatus { return { present: true, valid: true } }
function invalid(detail: string): VerificationStatus { return { present: true, valid: false, detail } }
function absent(): VerificationStatus { return { present: false, valid: false } }
function nonnegative(value: number | undefined, fallback: number): number { return value === undefined || !Number.isFinite(value) || value < 0 ? fallback : value }
function crash(options: OutboxRetentionOptions, point: OutboxRetentionOptions["crashPoint"]): void { if (options.crashPoint === point) throw new Error(`Injected retention crash: ${point}`) }
