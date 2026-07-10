import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { Database } from "bun:sqlite"
import { Effect, Schema } from "effect"

import { StorageError } from "./errors"
import { migrateLedger, setDurabilityPragmas } from "./migrate"

export const FrontierDirectionSchema = Schema.Literals(["maximize", "minimize"])
export type FrontierDirection = Schema.Schema.Type<typeof FrontierDirectionSchema>

export const FrontierReducerSchema = Schema.Literals(["latest", "mean", "median", "sum", "rate"])
export type FrontierReducer = Schema.Schema.Type<typeof FrontierReducerSchema>

export const FrontierBoundsModeSchema = Schema.Literals(["point", "conservative"])
export type FrontierBoundsMode = Schema.Schema.Type<typeof FrontierBoundsModeSchema>

export interface FrontierAxis {
  /** A versioned semantic definition. Required for quality, reliability, and outcome metrics. */
  readonly metricDefinitionId?: string
  readonly metricKey: string
  readonly unit: string
  readonly direction: FrontierDirection
  readonly reducer: FrontierReducer
  readonly boundsMode: FrontierBoundsMode
}

export interface FrontierFilters {
  readonly since?: number
  readonly until?: number
  readonly evidenceKind?: "external_benchmark" | "local_evaluation"
  readonly trustLabels?: readonly string[]
  readonly taskModality?: string
  readonly harnessProfile?: string | null
  readonly toolProfile?: string | null
  readonly contextProfile?: string | null
  readonly provider?: string
  readonly model?: string
  readonly account?: string | null
  readonly effort?: string | null
}

export interface FrontierQuery extends FrontierFilters {
  readonly workClass: string
  readonly axes: readonly FrontierAxis[]
  readonly includeIncomplete?: boolean
}

export interface FrontierParticipant {
  readonly ordinal: number
  readonly role: string
  readonly provider: string
  readonly model: string
  readonly modelVersion: string | null
  readonly account: string | null
  readonly effort: string | null
}

export interface FrontierCandidateIdentity {
  /** Ordered participant tuple; ordinal zero is the primary worker. */
  readonly participants: readonly FrontierParticipant[]
  readonly harnessProfile: string | null
  readonly toolProfile: string | null
  readonly contextProfile: string | null
}

/** Stable axis identity for exporters and CLI x/y selectors. */
export function frontierAxisId(axis: FrontierAxis): string {
  return JSON.stringify([axis.metricDefinitionId ?? null, axis.metricKey, axis.unit, axis.direction, axis.reducer, axis.boundsMode])
}

export interface FrontierAxisValue {

  readonly axis: FrontierAxis
  readonly value: number
  readonly comparisonValue: number
  readonly lowerBound: number | null
  readonly upperBound: number | null
  readonly sampleSize: number | null
  readonly measurementIds: readonly string[]
  readonly runIds: readonly string[]
  readonly sourceIds: readonly string[]
  readonly trustLabels: readonly string[]
}

export type FrontierCandidateStatus = "frontier" | "dominated" | "incomplete"

export interface FrontierCandidate {
  readonly identity: FrontierCandidateIdentity
  readonly axes: readonly FrontierAxisValue[]
  readonly status: FrontierCandidateStatus
  readonly dominatedBy: readonly FrontierCandidateIdentity[]
  readonly missingAxes: readonly number[]
}

export interface FrontierResult {
  readonly query: FrontierQuery
  readonly candidates: readonly FrontierCandidate[]
}

interface MeasurementRow {
  readonly measurementId: string
  readonly runId: string
  readonly sourceId: string
  readonly trustLabel: string
  readonly captureKind: string
  readonly observedAt: number
  readonly workClass: string
  readonly taskModality: string
  readonly harnessProfile: string | null
  readonly toolProfile: string | null
  readonly contextProfile: string | null
  readonly metricDefinitionId: string | null
  readonly metricKey: string
  readonly value: number
  readonly unit: string
  readonly direction: string
  readonly lowerConfidenceBound: number | null
  readonly upperConfidenceBound: number | null
  readonly sampleSize: number | null
  readonly participants: string
}

interface GroupedMeasurement {
  readonly row: MeasurementRow
  readonly identity: FrontierCandidateIdentity
}

/**
 * Computes a descriptive, complete-case Pareto frontier from canonical SQLite evidence.
 * It never converts units or constructs a weighted score.
 */
export function queryFrontier(dbPath: string, query: FrontierQuery): Effect.Effect<FrontierResult, StorageError> {
  return Effect.try({
    try: () => withDb(dbPath, (sqlite) => computeFrontier(sqlite, query)),
    catch: (cause) => new StorageError({
      operation: "queryFrontier",
      message: cause instanceof Error ? cause.message : String(cause),
      cause: cause instanceof Error ? cause.message : String(cause),
    }),
  })
}

function computeFrontier(sqlite: Database, query: FrontierQuery): FrontierResult {
  validateQuery(query)
  const rows = loadMeasurements(sqlite, query)
  const grouped = rows.map((row) => ({ row, identity: decodeIdentity(row.participants, row) }))
  const candidateGroups = groupByCandidate(grouped)
  const candidates = Array.from(candidateGroups.values()).map((candidateRows) => buildCandidate(candidateRows, query.axes))
  const complete = candidates.filter((candidate) => candidate.missingAxes.length === 0)
  if (complete.length === 0) {
    throw new Error("frontier query has no complete candidate across all requested axes")
  }

  const statusByKey = new Map<string, { status: FrontierCandidateStatus; dominatedBy: FrontierCandidateIdentity[] }>()
  for (const candidate of complete) {
    const dominatedBy = complete.filter((other) => other.key !== candidate.key && dominates(other.axes, candidate.axes))
      .map((other) => other.identity)
      .sort(compareIdentity)
    statusByKey.set(candidate.key, {
      status: dominatedBy.length === 0 ? "frontier" : "dominated",
      dominatedBy,
    })
  }

  const rendered = candidates.map((candidate): FrontierCandidate => {
    const status = statusByKey.get(candidate.key)
    return {
      identity: candidate.identity,
      axes: candidate.axes,
      status: status?.status ?? "incomplete",
      dominatedBy: status?.dominatedBy ?? [],
      missingAxes: candidate.missingAxes,
    }
  }).filter((candidate) => query.includeIncomplete === true || candidate.status !== "incomplete")

  rendered.sort((left, right) => statusRank(left.status) - statusRank(right.status) || compareIdentity(left.identity, right.identity))
  return { query, candidates: rendered }
}

function loadMeasurements(sqlite: Database, query: FrontierQuery): MeasurementRow[] {
  const clauses = ["r.workClass = ?"]
  const values: Array<string | number> = [query.workClass]
  if (query.since !== undefined) { clauses.push("r.observedAt >= ?"); values.push(query.since) }
  if (query.until !== undefined) { clauses.push("r.observedAt <= ?"); values.push(query.until) }
  if (query.evidenceKind !== undefined) { clauses.push("r.evidenceKind = ?"); values.push(query.evidenceKind) }
  if (query.taskModality !== undefined) { clauses.push("r.taskModality = ?"); values.push(query.taskModality) }
  nullableClause(clauses, values, "r.harnessProfile", query.harnessProfile)
  nullableClause(clauses, values, "r.toolProfile", query.toolProfile)
  nullableClause(clauses, values, "r.contextProfile", query.contextProfile)
  participantClause(clauses, values, "provider", query.provider)
  participantClause(clauses, values, "model", query.model)
  participantClause(clauses, values, "account", query.account)
  participantClause(clauses, values, "effort", query.effort)
  if (query.trustLabels !== undefined) {
    if (query.trustLabels.length === 0) throw new Error("trustLabels must not be empty")
    clauses.push(`s.trustLabel IN (${query.trustLabels.map(() => "?").join(", ")})`)
    values.push(...query.trustLabels)
  }

  // json_group_array preserves ordinal ordering in the nested query. Participant data is
  // normalized before it becomes a candidate key, so advisor composition cannot be opaque text.
  const sql = `
    SELECT
      m.id AS measurementId, m.runId, r.sourceId, s.trustLabel, s.captureKind,
      r.observedAt, r.workClass, r.taskModality, r.harnessProfile, r.toolProfile, r.contextProfile,
      m.metricDefinitionId, m.metricKey, m.value, m.unit, m.direction,
      m.lowerConfidenceBound, m.upperConfidenceBound, m.sampleSize,
      COALESCE((
        SELECT json_group_array(json_object(
          'ordinal', p.ordinal, 'role', p.role, 'provider', p.provider, 'model', p.model,
          'modelVersion', p.modelVersion, 'account', p.account, 'effort', p.effort
        ))
        FROM (
          SELECT * FROM evaluation_run_participants WHERE runId = r.id ORDER BY ordinal ASC
        ) AS p
      ), '[]') AS participants
    FROM evaluation_measurements AS m
    JOIN evaluation_runs AS r ON r.id = m.runId
    JOIN evidence_sources AS s ON s.id = r.sourceId
    WHERE ${clauses.join(" AND ")}
    ORDER BY r.observedAt ASC, r.id ASC, m.id ASC
  `
  const rows = sqlite.query<MeasurementRow, Array<string | number>>(sql).all(...values)
  if (rows.length === 0) throw new Error("frontier query has no measurements after filters")
  return rows
}

function nullableClause(clauses: string[], values: Array<string | number>, column: string, value: string | null | undefined): void {
  if (value === undefined) return
  if (value === null) clauses.push(`${column} IS NULL`)
  else { clauses.push(`${column} = ?`); values.push(value) }
}

function participantClause(clauses: string[], values: Array<string | number>, column: "provider" | "model" | "account" | "effort", value: string | null | undefined): void {
  if (value === undefined) return
  if (value === null) clauses.push(`EXISTS (SELECT 1 FROM evaluation_run_participants AS primary_participant WHERE primary_participant.runId = r.id AND primary_participant.role = 'primary' AND primary_participant.${column} IS NULL)`)
  else {
    clauses.push(`EXISTS (SELECT 1 FROM evaluation_run_participants AS primary_participant WHERE primary_participant.runId = r.id AND primary_participant.role = 'primary' AND primary_participant.${column} = ?)`)
    values.push(value)
  }
}

function buildCandidate(rows: readonly GroupedMeasurement[], axes: readonly FrontierAxis[]): {
  readonly key: string
  readonly identity: FrontierCandidateIdentity
  readonly axes: readonly FrontierAxisValue[]
  readonly missingAxes: readonly number[]
} {
  const identity = rows[0]!.identity

  const values: FrontierAxisValue[] = []
  const missingAxes: number[] = []
  axes.forEach((axis, index) => {
    const matched = rows.filter(({ row }) => matchesAxis(row, axis))
    validateAxisCompatibility(rows, axis)
    const aggregate = matched.length === 0 ? null : reduceAxis(matched, axis)
    if (aggregate === null) missingAxes.push(index)
    else values.push(aggregate)
  })
  return { key: identityKey(identity), identity, axes: values, missingAxes }
}

function matchesAxis(row: MeasurementRow, axis: FrontierAxis): boolean {
  return row.metricKey === axis.metricKey && row.unit === axis.unit && row.direction === axis.direction &&
    (axis.metricDefinitionId === undefined ? row.metricDefinitionId === null : row.metricDefinitionId === axis.metricDefinitionId)
}

function validateAxisCompatibility(rows: readonly GroupedMeasurement[], axis: FrontierAxis): void {
  const related = rows.filter(({ row }) => row.metricKey === axis.metricKey &&
    (axis.metricDefinitionId === undefined ? row.metricDefinitionId === null : row.metricDefinitionId === axis.metricDefinitionId))
  for (const { row } of related) {
    if (row.unit !== axis.unit || row.direction !== axis.direction) {
      throw new Error(`axis ${axis.metricKey} has incompatible measurement ${row.measurementId}`)
    }
  }
}

function reduceAxis(rows: readonly GroupedMeasurement[], axis: FrontierAxis): FrontierAxisValue | null {
  const ordered = [...rows].sort((left, right) => right.row.observedAt - left.row.observedAt || compareText(right.row.runId, left.row.runId) || compareText(right.row.measurementId, left.row.measurementId))
  const selected = axis.reducer === "latest" ? ordered.slice(0, 1) : ordered
  const comparisonSamples = selected.map(({ row }) => comparisonSample(row, axis)).filter((value): value is number => value !== null)
  if (comparisonSamples.length !== selected.length) return null
  const pointSamples = selected.map(({ row }) => row.value)
  const lowerSamples = selected.map(({ row }) => row.lowerConfidenceBound)
  const upperSamples = selected.map(({ row }) => row.upperConfidenceBound)
  const lowerNumbers = lowerSamples.filter((value): value is number => value !== null)
  const upperNumbers = upperSamples.filter((value): value is number => value !== null)
  return {
    axis,
    value: reduce(pointSamples, axis.reducer),
    comparisonValue: reduce(comparisonSamples, axis.reducer),
    lowerBound: lowerNumbers.length === selected.length ? reduce(lowerNumbers, axis.reducer) : null,
    upperBound: upperNumbers.length === selected.length ? reduce(upperNumbers, axis.reducer) : null,
    sampleSize: sumNullable(selected.map(({ row }) => row.sampleSize)),
    measurementIds: selected.map(({ row }) => row.measurementId).sort(compareText),
    runIds: uniqueSorted(selected.map(({ row }) => row.runId)),
    sourceIds: uniqueSorted(selected.map(({ row }) => row.sourceId)),
    trustLabels: uniqueSorted(selected.map(({ row }) => row.trustLabel)),
  }
}

function comparisonSample(row: MeasurementRow, axis: FrontierAxis): number | null {
  if (axis.boundsMode === "point") return row.value
  if (axis.direction === "maximize") {
    if (row.lowerConfidenceBound !== null) return row.lowerConfidenceBound
    return row.captureKind === "graph_ocr" ? null : row.value
  }
  if (row.upperConfidenceBound !== null) return row.upperConfidenceBound
  return row.captureKind === "graph_ocr" ? null : row.value
}

function reduce(values: readonly number[], reducer: FrontierReducer): number {
  if (reducer === "sum") return values.reduce((total, value) => total + value, 0)
  if (reducer === "median") {
    const sorted = [...values].sort((left, right) => left - right)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
  }
  // A rate is an unweighted arithmetic rate across explicit observations. Weighting by
  // sample size would be an additional, hidden aggregation policy.
  return values.reduce((total, value) => total + value, 0) / values.length
}

function dominates(left: readonly FrontierAxisValue[], right: readonly FrontierAxisValue[]): boolean {
  let strictlyBetter = false
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!.comparisonValue
    const rightValue = right[index]!.comparisonValue
    const direction = left[index]!.axis.direction
    if (direction === "maximize") {
      if (leftValue < rightValue) return false
      if (leftValue > rightValue) strictlyBetter = true
    } else {
      if (leftValue > rightValue) return false
      if (leftValue < rightValue) strictlyBetter = true
    }
  }
  return strictlyBetter
}

const ParticipantSchema = Schema.Struct({
  ordinal: Schema.Number,
  role: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  modelVersion: Schema.NullOr(Schema.String),
  account: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
})
const ParticipantArraySchema = Schema.Array(ParticipantSchema)

function decodeIdentity(participantsJson: string, row: MeasurementRow): FrontierCandidateIdentity {
  const parsed = Schema.decodeUnknownSync(ParticipantArraySchema)(JSON.parse(participantsJson))
  if (parsed.length === 0) throw new Error(`run ${row.runId} has no participants`)
  const participants = [...parsed].sort((left, right) => left.ordinal - right.ordinal)
  if (participants.some((participant, index) => participant.ordinal !== index)) {
    throw new Error(`run ${row.runId} participants must have contiguous ordinals starting at zero`)
  }
  return {
    participants,
    harnessProfile: row.harnessProfile,
    toolProfile: row.toolProfile,
    contextProfile: row.contextProfile,
  }
}

function groupByCandidate(rows: readonly GroupedMeasurement[]): Map<string, GroupedMeasurement[]> {
  const groups = new Map<string, GroupedMeasurement[]>()
  for (const row of rows) {
    const key = identityKey(row.identity)
    const existing = groups.get(key)
    if (existing === undefined) groups.set(key, [row])
    else existing.push(row)
  }
  return groups
}

function identityKey(identity: FrontierCandidateIdentity): string {
  return JSON.stringify(identity)
}

function compareIdentity(left: FrontierCandidateIdentity, right: FrontierCandidateIdentity): number {
  return compareText(identityKey(left), identityKey(right))
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText)
}

function sumNullable(values: readonly (number | null)[]): number | null {
  let total = 0
  for (const value of values) {
    if (value === null) return null
    total += value
  }
  return total
}

function statusRank(status: FrontierCandidateStatus): number {
  return status === "frontier" ? 0 : status === "dominated" ? 1 : 2
}

function validateQuery(query: FrontierQuery): void {
  if (query.workClass.length === 0) throw new Error("workClass is required")
  if (query.axes.length < 2) throw new Error("frontier requires at least two axes")
  if (query.since !== undefined && !Number.isInteger(query.since)) throw new Error("since must be an integer timestamp")
  if (query.until !== undefined && !Number.isInteger(query.until)) throw new Error("until must be an integer timestamp")
  if (query.since !== undefined && query.until !== undefined && query.since > query.until) throw new Error("since must not exceed until")
  const axisKeys = new Set<string>()
  for (const axis of query.axes) {
    if (axis.metricKey.length === 0 || axis.unit.length === 0) throw new Error("axis metricKey and unit are required")
    Schema.decodeUnknownSync(FrontierDirectionSchema)(axis.direction)
    Schema.decodeUnknownSync(FrontierReducerSchema)(axis.reducer)
    const key = JSON.stringify([axis.metricDefinitionId ?? null, axis.metricKey, axis.unit, axis.direction])
    Schema.decodeUnknownSync(FrontierBoundsModeSchema)(axis.boundsMode)
    if (axisKeys.has(key)) throw new Error("frontier axes must be distinct")
    axisKeys.add(key)
  }
}

function withDb<T>(dbPath: string, fn: (sqlite: Database) => T): T {
  if (dbPath !== ":memory:") mkdirSync(dirname(resolve(dbPath)), { recursive: true })
  const sqlite = new Database(dbPath)
  try {
    setDurabilityPragmas(sqlite)
    migrateLedger(sqlite)
    return fn(sqlite)
  } finally {
    sqlite.close()
  }
}
