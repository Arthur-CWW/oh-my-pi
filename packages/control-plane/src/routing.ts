import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { Database } from "bun:sqlite"
import { Context, Effect, Layer, Schema } from "effect"
import { and, asc, desc, eq, gte } from "drizzle-orm"
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"

import { StorageError } from "./errors"
import { defaultLedgerPath, type InsertResult } from "./ledger"
import { migrateLedger, setDurabilityPragmas } from "./migrate"
import { laneState, routingObservations, type LaneStateRow, type RoutingObservationRow } from "./schema"

export const RoutingVerdictSchema = Schema.Literals(["strength", "weakness", "failure_mode", "steering_note", "quota", "cost_note"])
export type RoutingVerdict = Schema.Schema.Type<typeof RoutingVerdictSchema>

export const LaneStatusSchema = Schema.Literals(["available", "degraded", "quota_exhausted", "retired"])
export type LaneStatus = Schema.Schema.Type<typeof LaneStatusSchema>

export const LaneCostTierSchema = Schema.Literals(["subscription", "api-cheap", "api-expensive", "scarce"])
export type LaneCostTier = Schema.Schema.Type<typeof LaneCostTierSchema>

export interface RoutingObservationInput {
  readonly id: string
  readonly ts: number
  readonly machine: string
  readonly session?: string
  readonly agent?: string
  readonly lane: string
  readonly workType: string
  readonly verdict: RoutingVerdict
  readonly note: string
  readonly evidence?: string
  readonly confidence?: number
}

export interface RoutingObservationFilters {
  readonly lane?: string
  readonly workType?: string
  readonly verdict?: RoutingVerdict
  readonly sinceTs?: number
  readonly limit?: number
}

export interface LaneStateInput {
  readonly lane: string
  readonly updatedTs: number
  readonly updatedBy: string
  readonly status: LaneStatus
  readonly exhaustedUntilTs?: number
  readonly costTier?: LaneCostTier
  readonly defaultFor?: string
  readonly notes?: string
}

export interface LaneStateWriteResult {
  readonly written: boolean
}

export interface LaneBriefOptions {
  readonly lane?: string
  readonly observationsPerLane?: number
}

export interface LaneBriefEntry {
  readonly lane: string
  readonly state: LaneStateRow | null
  readonly observations: readonly RoutingObservationRow[]
}

export interface LaneBrief {
  readonly entries: readonly LaneBriefEntry[]
}

export interface RoutingStoreShape {
  readonly dbPath: string
  readonly recordObservation: (input: RoutingObservationInput) => Effect.Effect<InsertResult, StorageError>
  readonly listObservations: (filters: RoutingObservationFilters) => Effect.Effect<RoutingObservationRow[], StorageError>
  readonly setLaneState: (input: LaneStateInput) => Effect.Effect<LaneStateWriteResult, StorageError>
  readonly getLaneState: (lane?: string) => Effect.Effect<readonly LaneStateRow[] | LaneStateRow | null, StorageError>
  readonly laneBrief: (options: LaneBriefOptions) => Effect.Effect<LaneBrief, StorageError>
  readonly close: () => void
}

export class RoutingStore extends Context.Service<RoutingStore, RoutingStoreShape>()("ControlPlane/RoutingStore") {}

type RoutingDb = BunSQLiteDatabase

export function openRoutingStore(dbPath: string = defaultLedgerPath()): Layer.Layer<RoutingStore, StorageError> {
  return Layer.effect(
    RoutingStore,
    Effect.acquireRelease(
      Effect.try({
        try: () => makeRoutingStore(dbPath),
        catch: (cause) => storageError("openRoutingStore", cause, dbPath),
      }),
      (store) => Effect.sync(() => store.close()),
    ),
  )
}

function makeRoutingStore(dbPath: string): RoutingStoreShape {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(resolve(dbPath)), { recursive: true })
  }

  const sqlite = new Database(dbPath)
  setDurabilityPragmas(sqlite)
  migrateLedger(sqlite)
  const db = drizzle(sqlite)

  // The event ledger remains a daemon-owned single-writer ingestion log. These routing
  // tables are intentionally low-rate shared state: sessions write them directly with
  // caller-supplied ids and idempotent INSERT OR IGNORE / lane upsert semantics.
  return {
    dbPath,
    recordObservation: Effect.fn("RoutingStore.recordObservation")((input: RoutingObservationInput) =>
      storageEffect("recordObservation", () => insertObservation(db, input)),
    ),
    listObservations: Effect.fn("RoutingStore.listObservations")((filters: RoutingObservationFilters) =>
      storageEffect("listObservations", () => listObservationRows(db, filters)),
    ),
    setLaneState: Effect.fn("RoutingStore.setLaneState")((input: LaneStateInput) =>
      storageEffect("setLaneState", () => upsertLaneState(db, input)),
    ),
    getLaneState: Effect.fn("RoutingStore.getLaneState")((lane?: string) =>
      storageEffect("getLaneState", () => readLaneState(db, lane)),
    ),
    laneBrief: Effect.fn("RoutingStore.laneBrief")((options: LaneBriefOptions) =>
      storageEffect("laneBrief", () => readLaneBrief(db, options)),
    ),
    close: () => sqlite.close(),
  }
}

function insertObservation(db: RoutingDb, input: RoutingObservationInput): InsertResult {
  validateObservationInput(input)
  const result = db.insert(routingObservations).values({
    id: input.id,
    ts: input.ts,
    machine: input.machine,
    session: input.session ?? null,
    agent: input.agent ?? null,
    lane: input.lane,
    workType: input.workType,
    verdict: input.verdict,
    note: input.note,
    evidence: input.evidence ?? null,
    confidence: input.confidence ?? null,
  }).onConflictDoNothing().returning({ id: routingObservations.id }).all()
  return { inserted: result.length > 0 }
}

function upsertLaneState(db: RoutingDb, input: LaneStateInput): LaneStateWriteResult {
  validateLaneStateInput(input)
  const values = {
    lane: input.lane,
    updatedTs: input.updatedTs,
    updatedBy: input.updatedBy,
    status: input.status,
    exhaustedUntilTs: input.exhaustedUntilTs ?? null,
    costTier: input.costTier ?? null,
    defaultFor: input.defaultFor ?? null,
    notes: input.notes ?? null,
  }
  const result = db.insert(laneState).values(values).onConflictDoUpdate({
    target: laneState.lane,
    set: values,
  }).returning({ lane: laneState.lane }).all()
  return { written: result.length > 0 }
}

function listObservationRows(db: RoutingDb, filters: RoutingObservationFilters): RoutingObservationRow[] {
  if (filters.verdict !== undefined) {
    decodeRoutingVerdict(filters.verdict)
  }
  if (filters.sinceTs !== undefined) {
    ensureInteger("sinceTs", filters.sinceTs)
  }
  const clauses = [
    filters.lane === undefined ? undefined : eq(routingObservations.lane, filters.lane),
    filters.workType === undefined ? undefined : eq(routingObservations.workType, filters.workType),
    filters.verdict === undefined ? undefined : eq(routingObservations.verdict, filters.verdict),
    filters.sinceTs === undefined ? undefined : gte(routingObservations.ts, filters.sinceTs),
  ].filter((clause) => clause !== undefined)
  return db.select().from(routingObservations)
    .where(clauses.length === 0 ? undefined : and(...clauses))
    .orderBy(desc(routingObservations.ts), desc(routingObservations.id))
    .limit(limitOrDefault(filters.limit, 100))
    .all()
}

function readLaneState(db: RoutingDb, lane: string | undefined): readonly LaneStateRow[] | LaneStateRow | null {
  if (lane !== undefined) {
    return db.select().from(laneState).where(eq(laneState.lane, lane)).get() ?? null
  }
  return db.select().from(laneState).orderBy(asc(laneState.lane)).all()
}

function readLaneBrief(db: RoutingDb, options: LaneBriefOptions): LaneBrief {
  const observationsPerLane = limitOrDefault(options.observationsPerLane, 5)
  const states = options.lane === undefined
    ? db.select().from(laneState).orderBy(asc(laneState.lane)).all()
    : db.select().from(laneState).where(eq(laneState.lane, options.lane)).all()
  const observedLanes = options.lane === undefined
    ? db.selectDistinct({ lane: routingObservations.lane }).from(routingObservations).orderBy(asc(routingObservations.lane)).all().map((row) => row.lane)
    : [options.lane]
  const stateByLane = new Map(states.map((state) => [state.lane, state] as const))
  const lanes = Array.from(new Set([...states.map((state) => state.lane), ...observedLanes])).sort()
  return {
    entries: lanes.map((lane) => ({
      lane,
      state: stateByLane.get(lane) ?? null,
      observations: listObservationRows(db, { lane, limit: observationsPerLane }),
    })),
  }
}

export function parseRoutingVerdict(value: string): RoutingVerdict | null {
  const result = Schema.decodeUnknownOption(RoutingVerdictSchema)(value)
  return result._tag === "Some" ? result.value : null
}

export function parseLaneStatus(value: string): LaneStatus | null {
  const result = Schema.decodeUnknownOption(LaneStatusSchema)(value)
  return result._tag === "Some" ? result.value : null
}

export function parseLaneCostTier(value: string): LaneCostTier | null {
  const result = Schema.decodeUnknownOption(LaneCostTierSchema)(value)
  return result._tag === "Some" ? result.value : null
}

function validateObservationInput(input: RoutingObservationInput): void {
  ensureNonEmpty("id", input.id)
  ensureInteger("ts", input.ts)
  ensureNonEmpty("machine", input.machine)
  ensureNonEmpty("lane", input.lane)
  ensureNonEmpty("workType", input.workType)
  decodeRoutingVerdict(input.verdict)
  ensureOneParagraph("note", input.note)
  if (input.confidence !== undefined && (input.confidence < 0 || input.confidence > 1 || !Number.isFinite(input.confidence))) {
    throw new Error(`confidence must be between 0 and 1: ${input.confidence}`)
  }
}

function validateLaneStateInput(input: LaneStateInput): void {
  ensureNonEmpty("lane", input.lane)
  ensureInteger("updatedTs", input.updatedTs)
  ensureNonEmpty("updatedBy", input.updatedBy)
  decodeLaneStatus(input.status)
  if (input.exhaustedUntilTs !== undefined) {
    ensureInteger("exhaustedUntilTs", input.exhaustedUntilTs)
  }
  if (input.costTier !== undefined) {
    decodeLaneCostTier(input.costTier)
  }
}

function decodeRoutingVerdict(value: RoutingVerdict): RoutingVerdict {
  return Schema.decodeUnknownSync(RoutingVerdictSchema)(value)
}

function decodeLaneStatus(value: LaneStatus): LaneStatus {
  return Schema.decodeUnknownSync(LaneStatusSchema)(value)
}

function decodeLaneCostTier(value: LaneCostTier): LaneCostTier {
  return Schema.decodeUnknownSync(LaneCostTierSchema)(value)
}

function ensureNonEmpty(field: string, value: string): void {
  if (value.length === 0) {
    throw new Error(`${field} must not be empty`)
  }
}

function ensureOneParagraph(field: string, value: string): void {
  ensureNonEmpty(field, value)
  if (/\r|\n/.test(value)) {
    throw new Error(`${field} must be one paragraph`)
  }
}

function ensureInteger(field: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${field} must be an integer: ${value}`)
  }
}

function limitOrDefault(limit: number | undefined, fallback: number): number {
  return limit === undefined ? fallback : Math.max(1, Math.min(limit, 1_000))
}

function storageEffect<A>(operation: string, run: () => A): Effect.Effect<A, StorageError> {
  return Effect.try({ try: run, catch: (cause) => storageError(operation, cause) })
}

function storageError(operation: string, cause: unknown, context?: string): StorageError {
  return new StorageError({ operation, message: errorMessage(cause), cause: errorMessage(cause), context })
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
