import { createHash } from "node:crypto"
import { mkdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { Database } from "bun:sqlite"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"

import { StorageError } from "./errors"
import { migrateLedger, setDurabilityPragmas } from "./migrate"
import { artifacts, canaryRuns, releaseRegistryObservations, releaseTransactions, type ArtifactRow, type CanaryRunRow, type ReleaseRegistryObservationRow, type ReleaseTransactionRow } from "./schema"

const HEX64 = /^[a-f0-9]{64}$/
const ARTIFACT_ID_LENGTH = 32

type LedgerDb = BunSQLiteDatabase<Record<string, never>>

type NullableDigest = string | null

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export interface CanaryReceiptProofV1 {
  readonly mutationAppliedExactlyOnce: true
  readonly leaseReleased: true
  readonly leaseReacquired: true
  readonly jsonlPersisted: true
  readonly queuePersisted: true
}

export interface CanaryReceiptV1 {
  readonly schemaVersion: 1
  readonly buildDigest: string
  readonly version: string
  readonly runnerInstanceId: string
  readonly fixtureSessionId: string
  readonly ownerEpoch: string
  readonly startedAt: string
  readonly stoppedAt: string
  readonly initialSnapshotRevision: number
  readonly finalSnapshotRevision: number
  readonly commandId: string
  readonly proof: CanaryReceiptProofV1
}

export interface ReleaseRegistryV1 {
  readonly schemaVersion: 1
  readonly stable: NullableDigest
  readonly previous: NullableDigest
  readonly candidate: NullableDigest
  readonly receiptDigest: NullableDigest
  readonly timestamps: {
    readonly candidate: string | null
    readonly blessed: string | null
    readonly rollback: string | null
  }
}

export interface ReleaseTransactionArtifactV1 {
  readonly op: "bless" | "rollback"
  readonly from: NullableDigest
  readonly to: string
  readonly registryBefore: ReleaseRegistryV1
  readonly registryAfter: ReleaseRegistryV1
}

export interface ReleaseEvidencePaths {
  readonly canaryReceiptPath: string
  readonly releaseRegistryPath: string
  readonly releaseTransactionPath: string
}

export interface ReleaseEvidenceIds {
  readonly canaryRunId: string
  readonly promotionId: string
  readonly observationId: string
  readonly artifactIds: {
    readonly canaryReceipt: string
    readonly releaseRegistry: string
    readonly releaseTransaction: string
  }
}

export interface ReleaseEvidenceIngestResult extends ReleaseEvidenceIds {
  readonly inserted: {
    readonly artifacts: number
    readonly canaryRun: boolean
    readonly releaseTransaction: boolean
    readonly releaseRegistryObservation: boolean
  }
}

export function ingestReleaseEvidence(dbPath: string, paths: ReleaseEvidencePaths): Effect.Effect<ReleaseEvidenceIngestResult, StorageError> {
  return storageEffect("ingestReleaseEvidence", () =>
    withDb(dbPath, (sqlite) => {
      const db = drizzle(sqlite)
      const canaryRaw = readFileSync(paths.canaryReceiptPath, "utf8")
      const registryRaw = readFileSync(paths.releaseRegistryPath, "utf8")
      const transactionRaw = readFileSync(paths.releaseTransactionPath, "utf8")
      const canary = decodeCanaryReceiptV1Json(canaryRaw)
      const registry = decodeReleaseRegistryV1Json(registryRaw)
      const transaction = decodeReleaseTransactionArtifactV1Json(transactionRaw)
      return db.transaction((tx) => ingestReleaseEvidenceRows(tx, canaryRaw, canary, registryRaw, registry, transactionRaw, transaction))
    }),
  )
}

export function decodeCanaryReceiptV1Json(json: string): CanaryReceiptV1 {
  return validateCanaryReceipt(parseJson(json, "canary receipt"))
}

export function decodeReleaseRegistryV1Json(json: string): ReleaseRegistryV1 {
  return validateReleaseRegistry(parseJson(json, "release registry"))
}

export function decodeReleaseTransactionArtifactV1Json(json: string): ReleaseTransactionArtifactV1 {
  return validateReleaseTransactionArtifact(parseJson(json, "release transaction artifact"))
}

function ingestReleaseEvidenceRows(
  tx: LedgerDb,
  canaryRaw: string,
  canary: CanaryReceiptV1,
  registryRaw: string,
  registry: ReleaseRegistryV1,
  transactionRaw: string,
  transaction: ReleaseTransactionArtifactV1,
): ReleaseEvidenceIngestResult {
  const canaryArtifact = putInlineArtifact(tx, canaryRaw, {
    ts: parseIsoTimestamp(canary.stoppedAt, "canary receipt stoppedAt"),
    sessionId: canary.fixtureSessionId,
    kind: "canaryReceipt",
    retention: "keep",
    meta: JSON.stringify({ schemaVersion: canary.schemaVersion, buildDigest: canary.buildDigest }),
  })
  const registryArtifact = putInlineArtifact(tx, registryRaw, {
    ts: registryObservedAt(registry),
    kind: "releaseRegistry",
    retention: "keep",
    meta: JSON.stringify({ schemaVersion: registry.schemaVersion, stable: registry.stable, candidate: registry.candidate }),
  })
  const transactionArtifact = putInlineArtifact(tx, transactionRaw, {
    ts: transactionOccurredAt(transaction),
    kind: "releaseTransaction",
    retention: "keep",
    meta: JSON.stringify({ op: transaction.op, to: transaction.to }),
  })

  const canaryRunId = `canary_${canaryArtifact.sha256.slice(0, ARTIFACT_ID_LENGTH)}`
  const promotionId = `promotion_${transactionArtifact.sha256.slice(0, ARTIFACT_ID_LENGTH)}`
  const observationId = `registry_${registryArtifact.sha256.slice(0, ARTIFACT_ID_LENGTH)}`

  const canaryRow = {
    canaryRunId,
    receiptDigest: canaryArtifact.sha256,
    buildDigest: canary.buildDigest,
    version: canary.version,
    runnerInstanceId: canary.runnerInstanceId,
    fixtureSessionId: canary.fixtureSessionId,
    ownerEpoch: canary.ownerEpoch,
    commandId: canary.commandId,
    startedAt: parseIsoTimestamp(canary.startedAt, "canary receipt startedAt"),
    stoppedAt: parseIsoTimestamp(canary.stoppedAt, "canary receipt stoppedAt"),
    initialSnapshotRevision: canary.initialSnapshotRevision,
    finalSnapshotRevision: canary.finalSnapshotRevision,
    mutationAppliedExactlyOnce: true,
    leaseReleased: true,
    leaseReacquired: true,
    jsonlPersisted: true,
    queuePersisted: true,
    artifactId: canaryArtifact.id,
  } satisfies CanaryRunRow
  const releaseTransactionRow = {
    promotionId,
    operation: transaction.op,
    occurredAt: transactionOccurredAt(transaction),
    fromBuildDigest: transaction.from,
    toBuildDigest: transaction.to,
    receiptDigest: transaction.registryAfter.receiptDigest,
    registryBeforeDigest: sha256Text(canonicalJson(transaction.registryBefore)),
    registryAfterDigest: sha256Text(canonicalJson(transaction.registryAfter)),
    transactionArtifactId: transactionArtifact.id,
  } satisfies ReleaseTransactionRow
  const releaseRegistryRow = {
    observationId,
    observedAt: registryObservedAt(registry),
    stableBuildDigest: registry.stable,
    previousBuildDigest: registry.previous,
    candidateBuildDigest: registry.candidate,
    receiptDigest: registry.receiptDigest,
    sourceDigest: sha256Text(canonicalJson(registry)),
    artifactId: registryArtifact.id,
  } satisfies ReleaseRegistryObservationRow

  const canaryInserted = upsertExact(tx, canaryRuns, eq(canaryRuns.canaryRunId, canaryRunId), canaryRow, (row) => assertCanaryRow(row, canaryRow))
  const releaseTransactionInserted = upsertExact(tx, releaseTransactions, eq(releaseTransactions.promotionId, promotionId), releaseTransactionRow, (row) => assertReleaseTransactionRow(row, releaseTransactionRow))
  const releaseRegistryObservationInserted = upsertExact(tx, releaseRegistryObservations, eq(releaseRegistryObservations.observationId, observationId), releaseRegistryRow, (row) => assertReleaseRegistryRow(row, releaseRegistryRow))

  return {
    canaryRunId,
    promotionId,
    observationId,
    artifactIds: {
      canaryReceipt: canaryArtifact.id,
      releaseRegistry: registryArtifact.id,
      releaseTransaction: transactionArtifact.id,
    },
    inserted: {
      artifacts: Number(canaryArtifact.inserted) + Number(registryArtifact.inserted) + Number(transactionArtifact.inserted),
      canaryRun: canaryInserted,
      releaseTransaction: releaseTransactionInserted,
      releaseRegistryObservation: releaseRegistryObservationInserted,
    },
  }
}

function putInlineArtifact(
  db: LedgerDb,
  content: string,
  meta: { readonly ts: number; readonly sessionId?: string; readonly kind: string; readonly retention: string; readonly meta: string },
): { readonly id: string; readonly sha256: string; readonly inserted: boolean } {
  const bytes = Buffer.from(content)
  const sha256 = sha256Bytes(bytes)
  const id = `artifact_${sha256.slice(0, ARTIFACT_ID_LENGTH)}`
  const existing = db.select().from(artifacts).where(eq(artifacts.id, id)).get()
  const inserted = existing === undefined
  if (inserted) {
    db.insert(artifacts).values({
      id,
      ts: meta.ts,
      sessionId: meta.sessionId ?? null,
      kind: meta.kind,
      contentPath: null,
      contentInline: content,
      sha256,
      bytes: bytes.byteLength,
      retention: meta.retention,
      meta: meta.meta,
    }).run()
  }
  const row = db.select().from(artifacts).where(eq(artifacts.id, id)).get()
  if (row === undefined) throw new Error(`Artifact missing after insert: ${id}`)
  assertArtifactRow(row, { id, sha256, content, bytes: bytes.byteLength, meta })
  return { id, sha256, inserted }
}

function upsertExact<T extends { readonly [key: string]: unknown }>(
  db: LedgerDb,
  table: { readonly _: { readonly name: string } },
  where: unknown,
  row: T,
  assertExisting: (row: T) => void,
): boolean {
  const existing = db.select().from(table as never).where(where as never).get() as T | undefined
  const inserted = existing === undefined
  if (inserted) {
    db.insert(table as never).values(row as never).run()
  }
  const persisted = db.select().from(table as never).where(where as never).get() as T | undefined
  if (persisted === undefined) throw new Error(`Row missing after insert: ${table._.name}`)
  assertExisting(persisted)
  return inserted
}

function assertArtifactRow(
  row: ArtifactRow,
  expected: { readonly id: string; readonly sha256: string; readonly content: string; readonly bytes: number; readonly meta: { readonly ts: number; readonly sessionId?: string; readonly kind: string; readonly retention: string; readonly meta: string } },
): void {
  if (
    row.id !== expected.id ||
    row.sha256 !== expected.sha256 ||
    row.contentInline !== expected.content ||
    row.contentPath !== null ||
    row.bytes !== expected.bytes ||
    row.ts !== expected.meta.ts ||
    row.sessionId !== (expected.meta.sessionId ?? null) ||
    row.kind !== expected.meta.kind ||
    row.retention !== expected.meta.retention ||
    row.meta !== expected.meta.meta
  ) {
    throw new Error(`Artifact idempotency conflict: ${expected.id}`)
  }
}

function assertCanaryRow(row: CanaryRunRow, expected: CanaryRunRow): void {
  if (canonicalJson(row as unknown as JsonValue) !== canonicalJson(expected as unknown as JsonValue)) {
    throw new Error(`Canary run idempotency conflict: ${expected.canaryRunId}`)
  }
}

function assertReleaseTransactionRow(row: ReleaseTransactionRow, expected: ReleaseTransactionRow): void {
  if (canonicalJson(row as unknown as JsonValue) !== canonicalJson(expected as unknown as JsonValue)) {
    throw new Error(`Release transaction idempotency conflict: ${expected.promotionId}`)
  }
}

function assertReleaseRegistryRow(row: ReleaseRegistryObservationRow, expected: ReleaseRegistryObservationRow): void {
  if (canonicalJson(row as unknown as JsonValue) !== canonicalJson(expected as unknown as JsonValue)) {
    throw new Error(`Release registry observation idempotency conflict: ${expected.observationId}`)
  }
}

function transactionOccurredAt(transaction: ReleaseTransactionArtifactV1): number {
  const timestamp = transaction.op === "rollback"
    ? transaction.registryAfter.timestamps.rollback ?? transaction.registryBefore.timestamps.rollback
    : transaction.registryAfter.timestamps.blessed ?? transaction.registryBefore.timestamps.blessed
  if (timestamp === null || timestamp === undefined) {
    throw new Error(`Release transaction ${transaction.op} is missing its commit timestamp`)
  }
  return parseIsoTimestamp(timestamp, `release transaction ${transaction.op} timestamp`)
}

function registryObservedAt(registry: ReleaseRegistryV1): number {
  const timestamp = registry.timestamps.rollback ?? registry.timestamps.blessed ?? registry.timestamps.candidate
  if (timestamp === null || timestamp === undefined) throw new Error("Release registry is missing all timestamps")
  return parseIsoTimestamp(timestamp, "release registry timestamp")
}

function validateCanaryReceipt(value: unknown): CanaryReceiptV1 {
  const record = strictRecord(value, "canary receipt")
  exactKeys(record, ["schemaVersion", "buildDigest", "version", "runnerInstanceId", "fixtureSessionId", "ownerEpoch", "startedAt", "stoppedAt", "initialSnapshotRevision", "finalSnapshotRevision", "commandId", "proof"], "canary receipt")
  if (record.schemaVersion !== 1) throw new Error("Unsupported canary receipt schemaVersion")
  const proofRecord = strictRecord(record.proof, "canary receipt proof")
  exactKeys(proofRecord, ["mutationAppliedExactlyOnce", "leaseReleased", "leaseReacquired", "jsonlPersisted", "queuePersisted"], "canary receipt proof")
  for (const key of Object.keys(proofRecord)) {
    if (proofRecord[key] !== true) throw new Error(`Canary receipt proof failed: ${key}`)
  }
  const startedAt = requiredString(record.startedAt, "canary receipt startedAt")
  const stoppedAt = requiredString(record.stoppedAt, "canary receipt stoppedAt")
  const initialSnapshotRevision = requiredInteger(record.initialSnapshotRevision, "canary receipt initialSnapshotRevision")
  const finalSnapshotRevision = requiredInteger(record.finalSnapshotRevision, "canary receipt finalSnapshotRevision")
  if (finalSnapshotRevision <= initialSnapshotRevision) {
    throw new Error("Canary receipt finalSnapshotRevision must be greater than initialSnapshotRevision")
  }
  parseIsoTimestamp(startedAt, "canary receipt startedAt")
  parseIsoTimestamp(stoppedAt, "canary receipt stoppedAt")
  return {
    schemaVersion: 1,
    buildDigest: requiredDigest(record.buildDigest, "canary receipt buildDigest"),
    version: requiredString(record.version, "canary receipt version"),
    runnerInstanceId: requiredString(record.runnerInstanceId, "canary receipt runnerInstanceId"),
    fixtureSessionId: requiredString(record.fixtureSessionId, "canary receipt fixtureSessionId"),
    ownerEpoch: requiredString(record.ownerEpoch, "canary receipt ownerEpoch"),
    startedAt,
    stoppedAt,
    initialSnapshotRevision,
    finalSnapshotRevision,
    commandId: requiredString(record.commandId, "canary receipt commandId"),
    proof: {
      mutationAppliedExactlyOnce: true,
      leaseReleased: true,
      leaseReacquired: true,
      jsonlPersisted: true,
      queuePersisted: true,
    },
  }
}

function validateReleaseRegistry(value: unknown): ReleaseRegistryV1 {
  const record = strictRecord(value, "release registry")
  exactKeys(record, ["schemaVersion", "stable", "previous", "candidate", "receiptDigest", "timestamps"], "release registry")
  if (record.schemaVersion !== 1) throw new Error("Unsupported release registry schemaVersion")
  const timestamps = strictRecord(record.timestamps, "release registry timestamps")
  exactKeys(timestamps, ["candidate", "blessed", "rollback"], "release registry timestamps")
  const candidate = nullableTimestamp(timestamps.candidate, "release registry timestamps.candidate")
  const blessed = nullableTimestamp(timestamps.blessed, "release registry timestamps.blessed")
  const rollback = nullableTimestamp(timestamps.rollback, "release registry timestamps.rollback")
  return {
    schemaVersion: 1,
    stable: nullableDigest(record.stable, "release registry stable"),
    previous: nullableDigest(record.previous, "release registry previous"),
    candidate: nullableDigest(record.candidate, "release registry candidate"),
    receiptDigest: nullableDigest(record.receiptDigest, "release registry receiptDigest"),
    timestamps: { candidate, blessed, rollback },
  }
}

function validateReleaseTransactionArtifact(value: unknown): ReleaseTransactionArtifactV1 {
  const record = strictRecord(value, "release transaction artifact")
  exactKeys(record, ["op", "from", "to", "registryBefore", "registryAfter"], "release transaction artifact")
  const op = requiredLiteral(record.op, ["bless", "rollback"], "release transaction artifact op")
  const registryBefore = validateReleaseRegistry(record.registryBefore)
  const registryAfter = validateReleaseRegistry(record.registryAfter)
  const to = requiredDigest(record.to, "release transaction artifact to")
  if (registryAfter.stable !== to) throw new Error("Release transaction artifact to must match registryAfter.stable")
  return {
    op,
    from: nullableDigest(record.from, "release transaction artifact from"),
    to,
    registryBefore,
    registryAfter,
  }
}

function parseJson(json: string, label: string): unknown {
  try {
    return JSON.parse(json)
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function strictRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort()
  const sortedExpected = [...expected].sort()
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error(`${label} has unexpected fields`)
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function requiredInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`)
  return value as number
}

function requiredDigest(value: unknown, label: string): string {
  if (typeof value !== "string" || !HEX64.test(value)) throw new Error(`${label} must be a 64-character lowercase sha256 digest`)
  return value
}

function nullableDigest(value: unknown, label: string): string | null {
  if (value === null) return null
  return requiredDigest(value, label)
}

function nullableTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null
  const timestamp = requiredString(value, label)
  parseIsoTimestamp(timestamp, label)
  return timestamp
}

function requiredLiteral<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new Error(`${label} must be one of: ${choices.join(", ")}`)
  return value as T
}

function parseIsoTimestamp(value: string, label: string): number {
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) throw new Error(`${label} must be an ISO-8601 timestamp`)
  return ts
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  }
  if (typeof value !== "object") {
    throw new Error(`Cannot canonicalize non-JSON value: ${String(value)}`)
  }
  const record = value as Record<string, unknown>
  const entries = Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
  return `{${entries.join(",")}}`
}

function sha256Text(value: string): string {
  return sha256Bytes(Buffer.from(value))
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function withDb<T>(dbPath: string, fn: (sqlite: Database) => T): T {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(resolve(dbPath)), { recursive: true })
  }
  const sqlite = new Database(dbPath)
  try {
    setDurabilityPragmas(sqlite)
    migrateLedger(sqlite)
    return fn(sqlite)
  } finally {
    sqlite.close()
  }
}

function storageEffect<A>(operation: string, run: () => A): Effect.Effect<A, StorageError> {
  return Effect.try({
    try: run,
    catch: (cause) => new StorageError({
      operation,
      message: cause instanceof Error ? cause.message : String(cause),
      cause: cause instanceof Error ? cause.message : String(cause),
    }),
  })
}
