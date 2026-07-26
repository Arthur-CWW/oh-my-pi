import { createHash, randomUUID } from "node:crypto"
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs"
import { homedir, hostname } from "node:os"
import { dirname, join } from "node:path"
import { Schema } from "effect"
import { RelayHealthV1Schema, WorkEventV1Schema } from "./relay-schema"

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export const JsonValueSchema: Schema.Codec<JsonValue> = Schema.suspend((): Schema.Codec<JsonValue> =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.Array(JsonValueSchema),
    Schema.Record(Schema.String, JsonValueSchema),
  ]),
)

export const KnownOutboxKindSchema = Schema.Union([
  Schema.Literal("session"),
  Schema.Literal("branch"),
  Schema.Literal("turn"),
  Schema.Literal("event"),
  Schema.Literal("modelCall"),
  Schema.Literal("providerCall"),
  Schema.Literal("artifact"),
  Schema.Literal("agentTimeline"),
  Schema.Literal("routeResolution"),
  Schema.Literal("relayLifecycle"),
  Schema.Literal("workLease"),
  Schema.Literal("runnerEvent"),
  Schema.Literal("diagnosticOccurrence"),
  Schema.Literal("diagnosticProjection"),
])
export type KnownOutboxKind = Schema.Schema.Type<typeof KnownOutboxKindSchema>

export const OutboxEnvelopeSchema = Schema.Struct({
  v: Schema.Number,
  kind: Schema.String,
  sessionId: Schema.String,
  seq: Schema.Number,
  ts: Schema.Number,
  payload: JsonValueSchema,
})
export type OutboxEnvelope = Schema.Schema.Type<typeof OutboxEnvelopeSchema>
export const RelayLifecyclePayloadV1Schema = RelayHealthV1Schema
export type RelayLifecyclePayloadV1 = Schema.Schema.Type<typeof RelayLifecyclePayloadV1Schema>
export const WorkLeasePayloadV1Schema = WorkEventV1Schema
export type WorkLeasePayloadV1 = Schema.Schema.Type<typeof WorkLeasePayloadV1Schema>

const LowercaseSha256Schema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))
const NonNegativeSafeIntegerSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

export const RawContentReferenceV1Schema = Schema.Struct({
  v: Schema.Literal(1),
  algorithm: Schema.Literal("sha256"),
  digest: LowercaseSha256Schema,
  byteLength: NonNegativeSafeIntegerSchema,
  contentType: Schema.Literal("application/json"),
  representation: Schema.Literal("json-utf8"),
  summary: Schema.Struct({
    redacted: Schema.Literal(true),
    valueType: Schema.Literals(["null", "boolean", "number", "string", "array", "object"]),
    itemCount: NonNegativeSafeIntegerSchema,
  }),
})
export type RawContentReferenceV1 = Schema.Schema.Type<typeof RawContentReferenceV1Schema>

const OutboxOwnerV1Schema = Schema.Struct({
  host: Schema.String,
  pid: NonNegativeSafeIntegerSchema,
  leaseId: Schema.String,
})

export const OutboxTerminalV1Schema = Schema.Struct({
  v: Schema.Literal(1),
  sessionId: Schema.String,
  owner: OutboxOwnerV1Schema,
  terminalAt: Schema.String,
  source: Schema.Struct({
    byteOffset: NonNegativeSafeIntegerSchema,
    sha256: LowercaseSha256Schema,
  }),
})
export type OutboxTerminalV1 = Schema.Schema.Type<typeof OutboxTerminalV1Schema>

export const OutboxLeaseV1Schema = Schema.Struct({
  v: Schema.Literal(1),
  sessionId: Schema.String,
  owner: OutboxOwnerV1Schema,
  lastSeenAt: Schema.String,
  releasedAt: Schema.optionalKey(Schema.String),
})
export type OutboxLeaseV1 = Schema.Schema.Type<typeof OutboxLeaseV1Schema>

export const MAX_SERIALIZED_OUTBOX_RECORD_BYTES = 8 * 1024 * 1024
export const MAX_JSONL_SEGMENT_BYTES = 32 * 1024 * 1024
export const MAX_RAW_CAPTURE_INPUT_BYTES = 32 * 1024 * 1024

const sha256Pattern = /^[0-9a-f]{64}$/
const processLeaseIds = new Map<string, string>()

const DEFAULT_SEGMENT_MAX_BYTES = MAX_JSONL_SEGMENT_BYTES
export const MAX_OUTBOX_HOT_QUOTA_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_HOT_QUOTA_BYTES = MAX_OUTBOX_HOT_QUOTA_BYTES
const MAX_HEALTH_BYTES = 4_096
const HEALTH_RESERVE_BYTES = MAX_HEALTH_BYTES
const LOCK_STALE_MS = 60_000
const IO_CHUNK_BYTES = 64 * 1024
const MAX_ROUTE_RECOVERY_BYTES = 8 * 1024 * 1024
const ioScratch = Buffer.allocUnsafe(IO_CHUNK_BYTES)

interface RecoveryState {
  readonly v: 1
  readonly sessionId: string
  readonly nextSeq: number
  readonly latestRouteResolution?: OutboxEnvelope
}

const hotUsageCache = new Map<string, number>()

export interface OutboxConfig {
  readonly dir: string
  readonly segmentMaxBytes: number
  readonly maxRecordBytes: number
  readonly hotQuotaBytes: number
}

export type OutboxDropReason =
  | "append-failed"
  | "callback-failed"
  | "hot-quota-exceeded"
  | "line-too-large"
  | "lock-busy"
  | "rotation-failed"
  | "sequence-conflict"
  | "tail-repair-failed"

export type OutboxAppendReceipt =
  | {
    readonly admitted: true
    readonly seq: number
    readonly bytes: number
    readonly sealedPath?: string
  }
  | {
    readonly admitted: false
    readonly seq: number
    readonly bytes: number
    readonly reason: OutboxDropReason
  }

export type OutboxRecoveryReceipt =
  | {
    readonly recovered: true
    readonly nextSeq: number
    readonly latestRouteResolution?: OutboxEnvelope
  }
  | {
    readonly recovered: false
    readonly reason: OutboxDropReason
  }

export function defaultOutboxConfig(
  dir: string = defaultOutboxDir(),
  env: Record<string, string | undefined> = process.env,
): OutboxConfig {
  const segmentMaxBytes = boundedPositiveInteger(
    env["AGENT_CONTROL_PLANE_OUTBOX_SEGMENT_BYTES"],
    DEFAULT_SEGMENT_MAX_BYTES,
    MAX_JSONL_SEGMENT_BYTES,
  )
  return {
    dir,
    segmentMaxBytes,
    maxRecordBytes: Math.min(
      boundedPositiveInteger(
        env["AGENT_CONTROL_PLANE_OUTBOX_MAX_RECORD_BYTES"],
        MAX_SERIALIZED_OUTBOX_RECORD_BYTES,
        MAX_SERIALIZED_OUTBOX_RECORD_BYTES,
      ),
      segmentMaxBytes,
    ),
    hotQuotaBytes: boundedPositiveInteger(
      env["AGENT_CONTROL_PLANE_OUTBOX_HOT_QUOTA_BYTES"],
      DEFAULT_HOT_QUOTA_BYTES,
      MAX_OUTBOX_HOT_QUOTA_BYTES,
    ),
  }
}

class OutboxWriterFenceBusyError extends Error {}

export function withOutboxWriterFence<T>(
  sessionId: string,
  outboxDir: string,
  operation: () => T,
): T {
  mkdirSync(outboxDir, { recursive: true, mode: 0o700 })
  const lockPath = acquireLock(outboxDir, publisherLockName(sessionId))
  if (lockPath === undefined) throw new OutboxWriterFenceBusyError("outbox publisher lock is busy")
  try {
    const result = operation()
    const maybePromise: unknown = result
    if (
      (typeof maybePromise === "object" && maybePromise !== null || typeof maybePromise === "function")
      && "then" in maybePromise
      && typeof maybePromise.then === "function"
    ) {
      throw new Error("outbox writer fence operation must be synchronous")
    }
    return result
  } finally {
    try {
      rmSync(lockPath, { recursive: true, force: true })
    } catch {
      // Keep stale-lock recovery conservative if releasing the fence fails.
    }
  }
}

export function appendOutboxLine(
  filePath: string,
  envelope: OutboxEnvelope,
  config: OutboxConfig = defaultOutboxConfig(dirname(filePath)),
): OutboxAppendReceipt {
  let line: Buffer
  try {
    line = Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8")
  } catch {
    recordOutboxHealth(filePath, "append-failed")
    return { admitted: false, seq: envelope.seq, bytes: 0, reason: "append-failed" }
  }

  if (line.byteLength > config.maxRecordBytes || line.byteLength > config.segmentMaxBytes) {
    recordOutboxHealth(filePath, "line-too-large")
    return { admitted: false, seq: envelope.seq, bytes: line.byteLength, reason: "line-too-large" }
  }

  try {
    return withOutboxWriterFence(envelope.sessionId, config.dir, () =>
      appendOutboxLineUnderFence(filePath, envelope, line, config))
  } catch (cause) {
    invalidateHotUsage(config.dir)
    if (cause instanceof OutboxWriterFenceBusyError) {
      recordOutboxHealth(filePath, "lock-busy")
      return { admitted: false, seq: envelope.seq, bytes: line.byteLength, reason: "lock-busy" }
    }
    recordOutboxHealth(filePath, "append-failed")
    return { admitted: false, seq: envelope.seq, bytes: line.byteLength, reason: "append-failed" }
  }
}

function appendOutboxLineUnderFence(
  filePath: string,
  envelope: OutboxEnvelope,
  line: Buffer,
  config: OutboxConfig,
): OutboxAppendReceipt {
  if (hasPartialTail(filePath)) {
    recordOutboxHealth(filePath, "tail-repair-failed")
    return { admitted: false, seq: envelope.seq, bytes: line.byteLength, reason: "tail-repair-failed" }
  }

  const activeBytes = existsSync(filePath) ? statSync(filePath).size : 0
  const lastEnvelope = lastCompleteEnvelope(filePath, envelope.sessionId, config.maxRecordBytes)
  const statePath = recoveryStatePath(config.dir, envelope.sessionId)
  const priorState = readRecoveryState(statePath, envelope.sessionId, config.maxRecordBytes)
  const expectedSeq = lastEnvelope === undefined ? priorState?.nextSeq : lastEnvelope.seq + 1
  if (expectedSeq !== undefined && envelope.seq !== expectedSeq) {
    recordOutboxHealth(filePath, "sequence-conflict")
    return { admitted: false, seq: envelope.seq, bytes: line.byteLength, reason: "sequence-conflict" }
  }

  const nextState: RecoveryState = {
    v: 1,
    sessionId: envelope.sessionId,
    nextSeq: envelope.seq + 1,
    latestRouteResolution: envelope.kind === "routeResolution"
      ? envelope
      : priorState?.latestRouteResolution,
  }
  const nextStateBytes = Buffer.from(`${JSON.stringify(nextState)}\n`, "utf8")
  const previousStateBytes = existsSync(statePath) ? statSync(statePath).size : 0
  const additionalStateBytes = Math.max(0, nextStateBytes.byteLength - previousStateBytes)
  const leasePath = outboxLeasePathFor(envelope.sessionId, config.dir)
  const lease: OutboxLeaseV1 = {
    v: 1,
    sessionId: envelope.sessionId,
    owner: outboxOwner(envelope.sessionId),
    lastSeenAt: new Date().toISOString(),
  }
  const leaseBytes = Buffer.from(`${JSON.stringify(lease)}\n`, "utf8")
  const previousLeaseBytes = existsSync(leasePath) ? statSync(leasePath).size : 0
  const additionalLeaseBytes = Math.max(0, leaseBytes.byteLength - previousLeaseBytes)
  const hotBytes = cachedDirectoryBytes(config.dir)
  if (
    hotBytes === undefined
    || hotBytes + line.byteLength + additionalStateBytes + additionalLeaseBytes + HEALTH_RESERVE_BYTES > config.hotQuotaBytes
  ) {
    recordOutboxHealth(filePath, "hot-quota-exceeded")
    return { admitted: false, seq: envelope.seq, bytes: line.byteLength, reason: "hot-quota-exceeded" }
  }

  let sealedPath: string | undefined
  if (activeBytes > 0 && activeBytes + line.byteLength > config.segmentMaxBytes) {
    const bounds = activeSequenceBounds(filePath, envelope.sessionId, config.maxRecordBytes)
    if (bounds === undefined) {
      if (!quarantineActiveFile(filePath, envelope.sessionId, config.dir)) {
        recordOutboxHealth(filePath, "rotation-failed")
        return { admitted: false, seq: envelope.seq, bytes: line.byteLength, reason: "rotation-failed" }
      }
      createEmptyActiveFile(filePath)
    } else {
      sealedPath = sealActiveFile(filePath, envelope.sessionId, bounds, config.dir)
      if (sealedPath === undefined) {
        recordOutboxHealth(filePath, "rotation-failed")
        return { admitted: false, seq: envelope.seq, bytes: line.byteLength, reason: "rotation-failed" }
      }
      createEmptyActiveFile(filePath)
    }
    invalidateHotUsage(config.dir)
  }

  atomicWrite(leasePath, leaseBytes)
  updateHotUsage(config.dir, leaseBytes.byteLength - previousLeaseBytes)
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
  appendDurable(filePath, line)
  updateHotUsage(config.dir, line.byteLength)
  try {
    atomicWrite(statePath, nextStateBytes)
    updateHotUsage(config.dir, nextStateBytes.byteLength - previousStateBytes)
  } catch {
    invalidateHotUsage(config.dir)
  }
  return sealedPath === undefined
    ? { admitted: true, seq: envelope.seq, bytes: line.byteLength }
    : { admitted: true, seq: envelope.seq, bytes: line.byteLength, sealedPath }
}

export function outboxPathFor(sessionId: string, dir: string = defaultOutboxDir()): string {
  return join(dir, `${encodeURIComponent(sessionId)}.jsonl`)
}

export function outboxTerminalPathFor(sessionId: string, outboxDir: string = defaultOutboxDir()): string {
  return join(outboxDir, "terminals", `${encodeURIComponent(sessionId)}.terminal.json`)
}

export function outboxLeasePathFor(sessionId: string, outboxDir: string = defaultOutboxDir()): string {
  return join(outboxDir, "leases", `${encodeURIComponent(sessionId)}.lease.json`)
}

export function contentObjectPathFor(rawDir: string, digest: string): string {
  if (!sha256Pattern.test(digest)) throw new Error("invalid sha256 digest")
  return join(rawDir, "objects", "sha256", digest.slice(0, 2), `${digest}.json`)
}

export function defaultRawCaptureDir(env: Record<string, string | undefined> = process.env): string {
  return env["AGENT_CONTROL_PLANE_RAW_DIR"] ?? join(homedir(), ".agent-control-plane", "raw")
}

export function recordOutboxTerminalReleased(
  filePath: string,
  sessionId: string,
  terminalAt: string = new Date().toISOString(),
): OutboxTerminalV1 {
  const root = dirname(filePath)
  return withOutboxWriterFence(sessionId, root, () => {
    const owner = outboxOwner(sessionId)
    const byteOffset = statSync(filePath).size
    const sha256 = hashFile(filePath)
    if (statSync(filePath).size !== byteOffset) throw new Error("outbox changed while recording terminal marker")
    const terminal: OutboxTerminalV1 = {
      v: 1,
      sessionId,
      owner,
      terminalAt,
      source: { byteOffset, sha256 },
    }
    const lease: OutboxLeaseV1 = {
      v: 1,
      sessionId,
      owner,
      lastSeenAt: terminalAt,
      releasedAt: terminalAt,
    }
    atomicWrite(outboxLeasePathFor(sessionId, root), Buffer.from(`${JSON.stringify(lease)}\n`, "utf8"))
    atomicWrite(outboxTerminalPathFor(sessionId, root), Buffer.from(`${JSON.stringify(terminal)}\n`, "utf8"))
    return terminal
  })
}

export function defaultOutboxDir(env: Record<string, string | undefined> = process.env): string {
  return env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] ?? join(homedir(), ".agent-control-plane", "outbox")
}

export function recoverOutboxSession(
  filePath: string,
  sessionId: string,
  config: OutboxConfig = defaultOutboxConfig(dirname(filePath)),
): OutboxRecoveryReceipt {
  try {
    return withOutboxWriterFence(sessionId, config.dir, () =>
      recoverOutboxSessionUnderFence(filePath, sessionId, config))
  } catch (cause) {
    invalidateHotUsage(config.dir)
    if (cause instanceof OutboxWriterFenceBusyError) {
      recordOutboxHealth(filePath, "lock-busy")
      return { recovered: false, reason: "lock-busy" }
    }
    recordOutboxHealth(filePath, "tail-repair-failed")
    return { recovered: false, reason: "tail-repair-failed" }
  }
}

function recoverOutboxSessionUnderFence(
  filePath: string,
  sessionId: string,
  config: OutboxConfig,
): OutboxRecoveryReceipt {
  if (!repairActiveTail(filePath, sessionId, config.dir, config.maxRecordBytes)) {
    recordOutboxHealth(filePath, "tail-repair-failed")
    return { recovered: false, reason: "tail-repair-failed" }
  }

  const statePath = recoveryStatePath(config.dir, sessionId)
  const priorState = readRecoveryState(statePath, sessionId, config.maxRecordBytes)
  const lastEnvelope = lastCompleteEnvelope(filePath, sessionId, config.maxRecordBytes)
  const nextSeq = Math.max(priorState?.nextSeq ?? 0, (lastEnvelope?.seq ?? -1) + 1)
  const activeRoute = priorState === undefined || (lastEnvelope?.seq ?? -1) >= priorState.nextSeq
    ? findLatestRouteResolution(filePath, sessionId, config.maxRecordBytes, priorState?.nextSeq ?? 0)
    : undefined
  const latestRouteResolution = activeRoute ?? priorState?.latestRouteResolution
  const state: RecoveryState = {
    v: 1,
    sessionId,
    nextSeq,
    latestRouteResolution,
  }
  const stateBytes = Buffer.from(`${JSON.stringify(state)}\n`, "utf8")
  const previousBytes = existsSync(statePath) ? statSync(statePath).size : 0
  try {
    atomicWrite(statePath, stateBytes)
    updateHotUsage(config.dir, stateBytes.byteLength - previousBytes)
  } catch {
    invalidateHotUsage(config.dir)
  }

  return latestRouteResolution === undefined
    ? { recovered: true, nextSeq }
    : { recovered: true, nextSeq, latestRouteResolution }
}

export function recordOutboxHealth(filePath: string, reason: OutboxDropReason): void {
  const root = dirname(filePath)
  let lockPath: string | undefined
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    lockPath = acquireLock(root, ".health.lock")
    if (lockPath === undefined) return

    const healthPath = join(root, "publisher-health.json")
    let dropped = 0
    let reasonCount = 0
    if (existsSync(healthPath) && statSync(healthPath).size <= MAX_HEALTH_BYTES) {
      try {
        const previous = JSON.parse(readFileSync(healthPath, "utf8")) as {
          readonly dropped?: unknown
          readonly lastReason?: unknown
          readonly reasonCount?: unknown
        }
        dropped = boundedCount(previous.dropped)
        reasonCount = previous.lastReason === reason ? boundedCount(previous.reasonCount) : 0
      } catch {
        // Replace malformed health state with a new bounded counter.
      }
    }

    const health = Buffer.from(`${JSON.stringify({
      v: 1,
      dropped: incrementCount(dropped),
      lastReason: reason,
      reasonCount: incrementCount(reasonCount),
    })}\n`, "utf8")
    if (health.byteLength <= MAX_HEALTH_BYTES) {
      const previousBytes = existsSync(healthPath) ? statSync(healthPath).size : 0
      atomicWrite(healthPath, health)
      updateHotUsage(root, health.byteLength - previousBytes)
    }
  } catch {
    // Health reporting must never escape into an OMP callback.
  } finally {
    if (lockPath !== undefined) {
      try {
        rmSync(lockPath, { recursive: true, force: true })
      } catch {
        // A stale health lock is safe to recover later.
      }
    }
  }
}

function outboxOwner(sessionId: string): OutboxLeaseV1["owner"] {
  let leaseId = processLeaseIds.get(sessionId)
  if (leaseId === undefined) {
    leaseId = randomUUID()
    processLeaseIds.set(sessionId, leaseId)
  }
  return { host: hostname(), pid: process.pid, leaseId }
}


function hasPartialTail(filePath: string): boolean {
  if (!existsSync(filePath)) return false
  const size = statSync(filePath).size
  if (size === 0) return false
  const descriptor = openSync(filePath, "r")
  try {
    return readByte(descriptor, size - 1) !== 10
  } finally {
    closeSync(descriptor)
  }
}

function boundedPositiveInteger(raw: string | undefined, fallback: number, hardMaximum: number): number {
  if (raw === undefined || raw.trim() === "") return Math.min(fallback, hardMaximum)
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, hardMaximum) : Math.min(fallback, hardMaximum)
}

interface OutboxLockOwnerV1 {
  readonly v: 1
  readonly host: string
  readonly pid: number
  readonly createdAt: number
}

function acquireLock(root: string, name: string): string | undefined {
  const lockPath = join(root, name)
  try {
    mkdirSync(lockPath, { mode: 0o700 })
    initializeLock(lockPath)
    fsyncDirectory(root)
    return lockPath
  } catch (cause) {
    if (!isAlreadyExists(cause)) return undefined
  }

  try {
    if (!recoverableLock(lockPath)) return undefined
    rmSync(lockPath, { recursive: true, force: true })
    fsyncDirectory(root)
    mkdirSync(lockPath, { mode: 0o700 })
    initializeLock(lockPath)
    fsyncDirectory(root)
    return lockPath
  } catch {
    return undefined
  }
}

function initializeLock(lockPath: string): void {
  const owner: OutboxLockOwnerV1 = {
    v: 1,
    host: hostname(),
    pid: process.pid,
    createdAt: Date.now(),
  }
  try {
    writeDurableExclusive(
      join(lockPath, "owner.json"),
      Buffer.from(`${JSON.stringify(owner)}\n`, "utf8"),
    )
    fsyncDirectory(lockPath)
  } catch (cause) {
    rmSync(lockPath, { recursive: true, force: true })
    throw cause
  }
}

function recoverableLock(lockPath: string): boolean {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8"))
  } catch {
    return false
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("v" in value) ||
    value.v !== 1 ||
    !("host" in value) ||
    value.host !== hostname() ||
    !("pid" in value) ||
    typeof value.pid !== "number" ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    !("createdAt" in value) ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt)
  ) return false
  try {
    process.kill(value.pid, 0)
    return false
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EPERM") {
      return false
    }
  }
  return Date.now() - value.createdAt > LOCK_STALE_MS
}

function publisherLockName(sessionId: string): string {
  return `.publisher.${createHash("sha256").update(sessionId).digest("hex").slice(0, 32)}.lock`
}

function recoveryStatePath(root: string, sessionId: string): string {
  const key = createHash("sha256").update(sessionId).digest("hex")
  return join(root, ".publisher-state", `${key}.json`)
}

function readRecoveryState(path: string, sessionId: string, maxLineBytes: number): RecoveryState | undefined {
  try {
    if (!existsSync(path) || statSync(path).size > maxLineBytes + MAX_HEALTH_BYTES) return undefined
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<RecoveryState>
    if (
      value.v !== 1
      || value.sessionId !== sessionId
      || !Number.isSafeInteger(value.nextSeq)
      || (value.nextSeq ?? -1) < 0
    ) {
      return undefined
    }
    const route = value.latestRouteResolution
    if (
      route !== undefined
      && (
        route.kind !== "routeResolution"
        || validatedEnvelope(Buffer.from(JSON.stringify(route)), sessionId) === undefined
        || route.seq >= (value.nextSeq ?? 0)
      )
    ) {
      return undefined
    }
    return value as RecoveryState
  } catch {
    return undefined
  }
}

function repairActiveTail(filePath: string, sessionId: string, root: string, maxLineBytes: number): boolean {
  let descriptor: number | undefined
  try {
    if (!existsSync(filePath)) return true
    const size = statSync(filePath).size
    if (size === 0) return true
    descriptor = openSync(filePath, "r")
    if (readByte(descriptor, size - 1) === 10) return true

    const newline = findPreviousNewline(descriptor, size)
    const tailStart = newline < 0 ? 0 : newline + 1
    const tailBytes = size - tailStart
    const tail = tailBytes <= maxLineBytes ? readRange(descriptor, tailStart, tailBytes) : undefined
    if (tail !== undefined && validatedEnvelope(tail, sessionId) !== undefined) {
      closeSync(descriptor)
      descriptor = undefined
      appendFileSync(filePath, "\n", { encoding: "utf8", flag: "a" })
      updateHotUsage(root, 1)
      return true
    }

    closeSync(descriptor)
    descriptor = undefined
    if (!writeQuarantineRange(filePath, tailStart, tailBytes, root, sessionId, "partial")) return false
    truncateSync(filePath, tailStart)
    return true
  } catch {
    invalidateHotUsage(root)
    return false
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function quarantineActiveFile(filePath: string, sessionId: string, root: string): boolean {
  try {
    const size = statSync(filePath).size
    if (size === 0) {
      truncateSync(filePath, 0)
      return true
    }
    const digest = hashFile(filePath)
    const quarantineDir = join(root, "quarantine")
    const target = join(quarantineDir, `${encodeURIComponent(sessionId)}.${digest}.${randomUUID()}.invalid`)
    mkdirSync(quarantineDir, { recursive: true, mode: 0o700 })
    renameDurable(filePath, target)
    return true
  } catch {
    invalidateHotUsage(root)
    return false
  }
}

function writeQuarantineRange(
  filePath: string,
  start: number,
  length: number,
  root: string,
  sessionId: string,
  suffix: "partial",
): boolean {
  const quarantineDir = join(root, "quarantine")
  const temp = join(quarantineDir, `.${randomUUID()}.tmp-${process.pid}`)
  let source: number | undefined
  let destination: number | undefined
  try {
    mkdirSync(quarantineDir, { recursive: true, mode: 0o700 })
    source = openSync(filePath, "r")
    destination = openSync(temp, "wx", 0o600)
    const hash = createHash("sha256")
    let offset = start
    const end = start + length
    while (offset < end) {
      const requested = Math.min(IO_CHUNK_BYTES, end - offset)
      const bytesRead = readSync(source, ioScratch, 0, requested, offset)
      if (bytesRead !== requested) throw new Error("short quarantine read")
      hash.update(ioScratch.subarray(0, bytesRead))
      let written = 0
      while (written < bytesRead) {
        written += writeSync(destination, ioScratch, written, bytesRead - written)
      }
      offset += bytesRead
    }
    fsyncSync(destination)
    closeSync(destination)
    destination = undefined
    closeSync(source)
    source = undefined
    const digest = hash.digest("hex")
    const target = join(quarantineDir, `${encodeURIComponent(sessionId)}.${digest}.${randomUUID()}.${suffix}`)
    renameDurable(temp, target)
    return true
  } catch {
    if (destination !== undefined) closeSync(destination)
    if (source !== undefined) closeSync(source)
    try {
      unlinkSync(temp)
    } catch {
      // Preserve the original recovery failure.
    }
    return false
  }
}

function activeSequenceBounds(
  filePath: string,
  sessionId: string,
  maxLineBytes: number,
): { readonly first: number; readonly last: number } | undefined {
  const first = firstCompleteEnvelope(filePath, sessionId, maxLineBytes)
  const last = lastCompleteEnvelope(filePath, sessionId, maxLineBytes)
  return first === undefined || last === undefined ? undefined : { first: first.seq, last: last.seq }
}

function sealActiveFile(
  filePath: string,
  sessionId: string,
  bounds: { readonly first: number; readonly last: number },
  root: string,
): string | undefined {
  try {
    const digest = hashFile(filePath)
    const sealedDir = join(root, "sealed")
    const sealedPath = join(
      sealedDir,
      `${encodeURIComponent(sessionId)}.${bounds.first}-${bounds.last}.${digest}.jsonl`,
    )
    mkdirSync(sealedDir, { recursive: true, mode: 0o700 })
    if (existsSync(sealedPath)) {
      if (hashFile(sealedPath) !== digest) return undefined
      unlinkSync(filePath)
      fsyncDirectory(dirname(filePath))
      return sealedPath
    }
    renameDurable(filePath, sealedPath)
    return sealedPath
  } catch {
    return undefined
  }
}

function createEmptyActiveFile(filePath: string): void {
  const directory = dirname(filePath)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const descriptor = openSync(filePath, "a", 0o600)
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  fsyncDirectory(directory)
}

function firstCompleteEnvelope(filePath: string, sessionId: string, maxLineBytes: number): OutboxEnvelope | undefined {
  if (!existsSync(filePath)) return undefined
  let descriptor: number | undefined
  try {
    descriptor = openSync(filePath, "r")
    const size = statSync(filePath).size
    let offset = 0
    while (offset < size && offset <= maxLineBytes) {
      const requested = Math.min(IO_CHUNK_BYTES, size - offset)
      const bytesRead = readSync(descriptor, ioScratch, 0, requested, offset)
      if (bytesRead !== requested) return undefined
      const newline = ioScratch.subarray(0, bytesRead).indexOf(10)
      if (newline >= 0 && newline < bytesRead) {
        const length = offset + newline
        return length <= maxLineBytes
          ? validatedEnvelope(readRange(descriptor, 0, length), sessionId)
          : undefined
      }
      offset += bytesRead
    }
    return undefined
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function lastCompleteEnvelope(filePath: string, sessionId: string, maxLineBytes: number): OutboxEnvelope | undefined {
  let latest: OutboxEnvelope | undefined
  visitEnvelopesBackwards(filePath, sessionId, maxLineBytes, 0, (envelope) => {
    latest = envelope
    return false
  })
  return latest
}

function findLatestRouteResolution(
  filePath: string,
  sessionId: string,
  maxLineBytes: number,
  minimumSeq: number,
): OutboxEnvelope | undefined {
  let latest: OutboxEnvelope | undefined
  visitEnvelopesBackwards(filePath, sessionId, maxLineBytes, minimumSeq, (envelope) => {
    if (envelope.kind === "routeResolution") {
      latest = envelope
      return false
    }
    return true
  })
  return latest
}

function visitEnvelopesBackwards(
  filePath: string,
  sessionId: string,
  maxLineBytes: number,
  minimumSeq: number,
  visit: (envelope: OutboxEnvelope) => boolean,
): void {
  if (!existsSync(filePath)) return
  let descriptor: number | undefined
  try {
    descriptor = openSync(filePath, "r")
    let end = statSync(filePath).size
    if (end > 0 && readByte(descriptor, end - 1) === 10) end -= 1
    const initialEnd = end
    while (end > 0) {
      const line = readLineEndingAt(descriptor, end, maxLineBytes)
      if (line === undefined) return
      if (line.bytes.byteLength > 0) {
        const envelope = validatedEnvelope(line.bytes, sessionId)
        if (envelope !== undefined) {
          if (envelope.seq < minimumSeq || !visit(envelope)) return
        }
      }
      if (initialEnd - line.start > MAX_ROUTE_RECOVERY_BYTES) return
      if (line.start === 0) return
      end = line.start - 1
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function readLineEndingAt(
  descriptor: number,
  end: number,
  maxLineBytes: number,
): { readonly start: number; readonly bytes: Buffer } | undefined {
  let cursor = end
  while (cursor > 0) {
    const readStart = Math.max(0, cursor - IO_CHUNK_BYTES)
    const requested = cursor - readStart
    const bytesRead = readSync(descriptor, ioScratch, 0, requested, readStart)
    if (bytesRead !== requested) return undefined
    const newline = ioScratch.lastIndexOf(10, bytesRead - 1)
    if (newline >= 0) {
      const start = readStart + newline + 1
      const length = end - start
      return length <= maxLineBytes ? { start, bytes: readRange(descriptor, start, length) } : undefined
    }
    if (end - readStart > maxLineBytes) return undefined
    cursor = readStart
  }
  return end <= maxLineBytes ? { start: 0, bytes: readRange(descriptor, 0, end) } : undefined
}

function findPreviousNewline(descriptor: number, end: number): number {
  let cursor = end
  while (cursor > 0) {
    const readStart = Math.max(0, cursor - IO_CHUNK_BYTES)
    const requested = cursor - readStart
    const bytesRead = readSync(descriptor, ioScratch, 0, requested, readStart)
    if (bytesRead !== requested) throw new Error("short tail read")
    const newline = ioScratch.lastIndexOf(10, bytesRead - 1)
    if (newline >= 0) return readStart + newline
    cursor = readStart
  }
  return -1
}

function readRange(descriptor: number, start: number, length: number): Buffer {
  const bytes = Buffer.allocUnsafe(length)
  let offset = 0
  while (offset < length) {
    const bytesRead = readSync(descriptor, bytes, offset, length - offset, start + offset)
    if (bytesRead === 0) throw new Error("short file read")
    offset += bytesRead
  }
  return bytes
}

function readByte(descriptor: number, position: number): number {
  return readSync(descriptor, ioScratch, 0, 1, position) === 1 ? ioScratch[0] ?? -1 : -1
}

function hashFile(path: string): string {
  const descriptor = openSync(path, "r")
  try {
    const hash = createHash("sha256")
    const size = statSync(path).size
    let offset = 0
    while (offset < size) {
      const requested = Math.min(IO_CHUNK_BYTES, size - offset)
      const bytesRead = readSync(descriptor, ioScratch, 0, requested, offset)
      if (bytesRead !== requested) throw new Error("short hash read")
      hash.update(ioScratch.subarray(0, bytesRead))
      offset += bytesRead
    }
    return hash.digest("hex")
  } finally {
    closeSync(descriptor)
  }
}

function validatedEnvelope(bytes: Uint8Array, sessionId: string): OutboxEnvelope | undefined {
  try {
    const decoded = Schema.decodeUnknownOption(OutboxEnvelopeSchema)(JSON.parse(Buffer.from(bytes).toString("utf8")))
    if (
      decoded._tag !== "Some"
      || decoded.value.v !== 1
      || decoded.value.sessionId !== sessionId
      || !Number.isSafeInteger(decoded.value.seq)
      || decoded.value.seq < 0
      || !Number.isFinite(decoded.value.ts)
    ) {
      return undefined
    }
    return decoded.value
  } catch {
    return undefined
  }
}

function cachedDirectoryBytes(root: string): number | undefined {
  const cached = hotUsageCache.get(root)
  if (cached !== undefined) return cached
  const measured = directoryBytes(root)
  if (measured !== undefined) hotUsageCache.set(root, measured)
  return measured
}

function updateHotUsage(root: string, delta: number): void {
  const cached = hotUsageCache.get(root)
  if (cached === undefined) return
  const next = cached + delta
  if (!Number.isSafeInteger(next) || next < 0) {
    hotUsageCache.delete(root)
    return
  }
  hotUsageCache.set(root, next)
}

function invalidateHotUsage(root: string): void {
  hotUsageCache.delete(root)
}

function directoryBytes(root: string): number | undefined {
  let total = 0
  const pending = [root]
  try {
    while (pending.length > 0) {
      const path = pending.pop()
      if (path === undefined) break
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const child = join(path, entry.name)
        if (entry.isDirectory()) {
          pending.push(child)
        } else if (entry.isFile()) {
          total += statSync(child).size
          if (!Number.isSafeInteger(total)) return undefined
        }
      }
    }
    return total
  } catch {
    return undefined
  }
}

function appendDurable(path: string, content: Uint8Array): void {
  const descriptor = openSync(path, "a", 0o600)
  try {
    writeFileSync(descriptor, content)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function renameDurable(source: string, destination: string): void {
  renameSync(source, destination)
  const sourceDirectory = dirname(source)
  const destinationDirectory = dirname(destination)
  fsyncDirectory(sourceDirectory)
  if (destinationDirectory !== sourceDirectory) fsyncDirectory(destinationDirectory)
}

function atomicWrite(path: string, content: Uint8Array): void {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`
  try {
    writeDurableExclusive(tempPath, content)
    renameSync(tempPath, path)
    fsyncDirectory(directory)
  } catch (cause) {
    try {
      unlinkSync(tempPath)
    } catch {
      // Preserve the original bounded failure.
    }
    throw cause
  }
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

function boundedCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function incrementCount(value: number): number {
  return value >= Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : value + 1
}

function isAlreadyExists(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EEXIST"
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, "r")
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}
