import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { Database } from "bun:sqlite"
import { Context, Effect, Layer } from "effect"
import { and, asc, desc, eq, gte } from "drizzle-orm"
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"

import type {
  BenchmarkCatalogV1,
  BenchmarkSaturationAssessmentV1,
  CommercialFactV1,
  EvidenceBundleV1,
  EvaluationMeasurementV1,
  EvaluationRunParticipantV1,
  EvaluationRunV1,
  MetricDefinitionV1,
} from "./evidence"
import { StorageError } from "./errors"
import { defaultLedgerPath } from "./ledger"
import { migrateLedger, setDurabilityPragmas } from "./migrate"
import {
  benchmarkCatalog,
  benchmarkSaturationAssessments,
  commercialFacts,
  evidenceSources,
  evaluationMeasurements,
  evaluationRunParticipants,
  evaluationRuns,
  metricDefinitions,
  type BenchmarkCatalogRow,
  type BenchmarkSaturationAssessmentRow,
  type CommercialFactRow,
  type EvidenceSourceRow,
  type EvaluationMeasurementRow,
  type EvaluationRunParticipantRow,
  type EvaluationRunRow,
  type MetricDefinitionRow,
} from "./schema"

export interface EvidenceIngestCounts {
  inserted: number
  ignored: number
}

export interface IngestBundleResult {
  readonly sources: EvidenceIngestCounts
  readonly benchmarkCatalog: EvidenceIngestCounts
  readonly benchmarkSaturationAssessments: EvidenceIngestCounts
  readonly metricDefinitions: EvidenceIngestCounts
  readonly commercialFacts: EvidenceIngestCounts
  readonly runs: EvidenceIngestCounts
  readonly participants: EvidenceIngestCounts
  readonly measurements: EvidenceIngestCounts
}

export interface EvidenceSourceFilters {
  readonly trustLabel?: string
  readonly sourceKind?: string
  readonly since?: number
  readonly limit?: number
}

export interface MetricDefinitionFilters {
  readonly definitionKind?: string
  readonly workClass?: string
  readonly definitionKey?: string
  readonly limit?: number
}

export interface CommercialFactFilters {
  readonly sourceId?: string
  readonly provider?: string
  readonly model?: string
  readonly since?: number
  readonly limit?: number
}

export interface EvaluationRunFilters {
  readonly sourceId?: string
  readonly workClass?: string
  readonly evidenceKind?: string
  readonly provider?: string
  readonly model?: string
  readonly since?: number
  readonly limit?: number
}

export interface EvaluationMeasurementFilters {
  readonly runId?: string
  readonly metricDefinitionId?: string
  readonly metricKey?: string
  readonly limit?: number
}

export interface BenchmarkCatalogFilters {
  readonly readiness?: string
  readonly ingestMethod?: string
  readonly since?: number
  readonly limit?: number
}

export interface BenchmarkSaturationAssessmentFilters {
  readonly benchmarkCatalogId?: string
  readonly cohortKey?: string
  readonly status?: string
  readonly since?: number
  readonly limit?: number
}

export interface EvidenceStoreShape {
  readonly dbPath: string
  readonly ingestBundle: (bundle: EvidenceBundleV1) => Effect.Effect<IngestBundleResult, StorageError>
  readonly listSources: (filters: EvidenceSourceFilters) => Effect.Effect<EvidenceSourceRow[], StorageError>
  readonly listMetricDefinitions: (filters: MetricDefinitionFilters) => Effect.Effect<MetricDefinitionRow[], StorageError>
  readonly listCommercialFacts: (filters: CommercialFactFilters) => Effect.Effect<CommercialFactRow[], StorageError>
  readonly listRuns: (filters: EvaluationRunFilters) => Effect.Effect<EvaluationRunRow[], StorageError>
  readonly listMeasurements: (filters: EvaluationMeasurementFilters) => Effect.Effect<EvaluationMeasurementRow[], StorageError>
  readonly listBenchmarkCatalog: (filters: BenchmarkCatalogFilters) => Effect.Effect<BenchmarkCatalogRow[], StorageError>
  readonly listBenchmarkSaturationAssessments: (filters: BenchmarkSaturationAssessmentFilters) => Effect.Effect<BenchmarkSaturationAssessmentRow[], StorageError>
  readonly close: () => void
}

export class EvidenceStore extends Context.Service<EvidenceStore, EvidenceStoreShape>()("ControlPlane/EvidenceStore") {}

type EvidenceDb = BunSQLiteDatabase

export function openEvidenceStore(dbPath: string = defaultLedgerPath()) {
  return Layer.effect(
    EvidenceStore,
    Effect.acquireRelease(
      Effect.try({
        try: () => makeEvidenceStore(dbPath),
        catch: (cause) => storageError("openEvidenceStore", cause, dbPath),
      }),
      (store) => Effect.sync(() => store.close()),
    ),
  )
}

function makeEvidenceStore(dbPath: string): EvidenceStoreShape {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(resolve(dbPath)), { recursive: true })
  }
  const sqlite = new Database(dbPath)
  setDurabilityPragmas(sqlite)
  migrateLedger(sqlite)
  const db = drizzle(sqlite)
  return {
    dbPath,
    ingestBundle: Effect.fn("EvidenceStore.ingestBundle")((bundle: EvidenceBundleV1) =>
      storageEffect("ingestBundle", () => ingestBundle(sqlite, db, bundle)),
    ),
    listSources: Effect.fn("EvidenceStore.listSources")((filters: EvidenceSourceFilters) =>
      storageEffect("listSources", () => listSources(db, filters)),
    ),
    listBenchmarkCatalog: Effect.fn("EvidenceStore.listBenchmarkCatalog")((filters: BenchmarkCatalogFilters) =>
      storageEffect("listBenchmarkCatalog", () => listBenchmarkCatalog(db, filters)),
    ),
    listBenchmarkSaturationAssessments: Effect.fn("EvidenceStore.listBenchmarkSaturationAssessments")((filters: BenchmarkSaturationAssessmentFilters) =>
      storageEffect("listBenchmarkSaturationAssessments", () => listBenchmarkSaturationAssessments(db, filters)),
    ),
    listMetricDefinitions: Effect.fn("EvidenceStore.listMetricDefinitions")((filters: MetricDefinitionFilters) =>
      storageEffect("listMetricDefinitions", () => listMetricDefinitions(db, filters)),
    ),
    listCommercialFacts: Effect.fn("EvidenceStore.listCommercialFacts")((filters: CommercialFactFilters) =>
      storageEffect("listCommercialFacts", () => listCommercialFacts(db, filters)),
    ),
    listRuns: Effect.fn("EvidenceStore.listRuns")((filters: EvaluationRunFilters) =>
      storageEffect("listRuns", () => listRuns(db, filters)),
    ),
    listMeasurements: Effect.fn("EvidenceStore.listMeasurements")((filters: EvaluationMeasurementFilters) =>
      storageEffect("listMeasurements", () => listMeasurements(db, filters)),
    ),
    close: () => sqlite.close(),
  }
}

function ingestBundle(sqlite: Database, db: EvidenceDb, bundle: EvidenceBundleV1): IngestBundleResult {
  validateBundle(db, bundle)
  const transaction = sqlite.transaction(() => {
    const result = emptyResult()
    for (const source of bundle.sources) insertSource(db, source) ? result.sources.inserted++ : result.sources.ignored++
    for (const catalog of bundle.benchmarkCatalog) insertBenchmarkCatalog(db, catalog) ? result.benchmarkCatalog.inserted++ : result.benchmarkCatalog.ignored++
    for (const assessment of bundle.benchmarkSaturationAssessments) insertBenchmarkSaturationAssessment(db, assessment) ? result.benchmarkSaturationAssessments.inserted++ : result.benchmarkSaturationAssessments.ignored++
    for (const definition of bundle.metricDefinitions) insertDefinition(db, definition) ? result.metricDefinitions.inserted++ : result.metricDefinitions.ignored++
    for (const fact of bundle.commercialFacts) insertFact(db, fact) ? result.commercialFacts.inserted++ : result.commercialFacts.ignored++
    for (const run of bundle.runs) insertRun(db, run) ? result.runs.inserted++ : result.runs.ignored++
    for (const participant of bundle.participants) insertParticipant(db, participant) ? result.participants.inserted++ : result.participants.ignored++
    for (const measurement of bundle.measurements) insertMeasurement(db, measurement) ? result.measurements.inserted++ : result.measurements.ignored++
    return result
  })
  return transaction()
}

function emptyResult(): IngestBundleResult {
  return {
    sources: { inserted: 0, ignored: 0 },
    benchmarkCatalog: { inserted: 0, ignored: 0 },
    benchmarkSaturationAssessments: { inserted: 0, ignored: 0 },
    metricDefinitions: { inserted: 0, ignored: 0 },
    commercialFacts: { inserted: 0, ignored: 0 },
    runs: { inserted: 0, ignored: 0 },
    participants: { inserted: 0, ignored: 0 },
    measurements: { inserted: 0, ignored: 0 },
  }
}

function validateBundle(db: EvidenceDb, bundle: EvidenceBundleV1): void {
  ensureUnique(bundle.sources.map((row) => row.id), "source id")
  ensureUnique(bundle.benchmarkCatalog.map((row) => row.id), "benchmark catalog id")
  ensureUnique(bundle.benchmarkSaturationAssessments.map((row) => `${row.benchmarkCatalogId}:${row.sourceId}:${row.assessedAt}:${row.cohortKey}`), "benchmark saturation assessment identity")
  ensureUnique(bundle.metricDefinitions.map((row) => row.id), "metric definition id")
  ensureUnique(bundle.commercialFacts.map((row) => row.id), "commercial fact id")
  ensureUnique(bundle.runs.map((row) => row.id), "run id")
  ensureUnique(bundle.measurements.map((row) => row.id), "measurement id")
  ensureUnique(bundle.participants.map((row) => `${row.runId}:${row.ordinal}`), "participant run/ordinal")

  for (const source of bundle.sources) validateSource(source)
  for (const catalog of bundle.benchmarkCatalog) validateBenchmarkCatalog(catalog)
  for (const assessment of bundle.benchmarkSaturationAssessments) validateSaturationAssessment(assessment)
  for (const definition of bundle.metricDefinitions) validateDefinition(definition)
  for (const fact of bundle.commercialFacts) validateFact(fact)
  for (const run of bundle.runs) validateRun(run)
  for (const participant of bundle.participants) validateParticipant(participant)
  for (const measurement of bundle.measurements) validateMeasurement(measurement)

  const sourceIds = knownIds(db.select({ id: evidenceSources.id }).from(evidenceSources).all(), bundle.sources.map((row) => row.id))
  const catalogIds = knownIds(db.select({ id: benchmarkCatalog.id }).from(benchmarkCatalog).all(), bundle.benchmarkCatalog.map((row) => row.id))
  const existingDefinitions = db.select().from(metricDefinitions).all()
  const definitionIds = knownIds(existingDefinitions, bundle.metricDefinitions.map((row) => row.id))
  const existingRuns = db.select().from(evaluationRuns).all()
  const runIds = knownIds(existingRuns, bundle.runs.map((row) => row.id))
  const sourceById = new Map(bundle.sources.map((source) => [source.id, source] as const))
  const definitionById = new Map<string, MetricDefinitionV1 | MetricDefinitionRow>([...existingDefinitions.map((definition) => [definition.id, definition] as const), ...bundle.metricDefinitions.map((definition) => [definition.id, definition] as const)])
  const runById = new Map<string, EvaluationRunV1 | EvaluationRunRow>([...existingRuns.map((run) => [run.id, run] as const), ...bundle.runs.map((run) => [run.id, run] as const)])
  const existingSources = db.select().from(evidenceSources).all()
  const existingSourceById = new Map(existingSources.map((source) => [source.id, source] as const))

  for (const definition of bundle.metricDefinitions) {
    requireKnown(sourceIds, definition.methodologySourceId, "metric definition methodologySourceId")
    if (definition.definitionKind === "benchmark") {
      if (definition.benchmarkCatalogId === undefined || definition.benchmarkCatalogId === null) throw new Error(`benchmark definition ${definition.id} requires benchmarkCatalogId`)
      requireKnown(catalogIds, definition.benchmarkCatalogId, "metric definition benchmarkCatalogId")
    }
  }
  for (const assessment of bundle.benchmarkSaturationAssessments) {
    requireKnown(catalogIds, assessment.benchmarkCatalogId, "saturation assessment benchmarkCatalogId")
    requireKnown(sourceIds, assessment.sourceId, "saturation assessment sourceId")
  }
  for (const allowance of bundle.commercialFacts.filter((fact) => fact.factKind === "allowance" && fact.limitKind === "shared_pool")) {
    const eligibility = bundle.commercialFacts.some((fact) => fact.factKind === "eligibility" && fact.poolKey === allowance.poolKey)
    if (!eligibility) throw new Error(`shared pool allowance ${allowance.id} requires a separate eligibility assertion for ${allowance.poolKey}`)
  }
  for (const run of bundle.runs) requireKnown(sourceIds, run.sourceId, "evaluation run sourceId")
  for (const participant of bundle.participants) requireKnown(runIds, participant.runId, "participant runId")
  for (const measurement of bundle.measurements) {
    requireKnown(runIds, measurement.runId, "measurement runId")
    if (measurement.metricDefinitionId !== undefined && measurement.metricDefinitionId !== null) {
      requireKnown(definitionIds, measurement.metricDefinitionId, "measurement metricDefinitionId")
      const definition = definitionById.get(measurement.metricDefinitionId)
      if (definition !== undefined) validateDefinitionMatch(measurement, definition)
    } else if (!isFixedPhysicalCounter(measurement.metricKey, measurement.unit)) {
      throw new Error(`measurement ${measurement.id} requires metricDefinitionId; only fixed physical counters may omit it`)
    }
    const run = runById.get(measurement.runId)
    const source = run === undefined ? undefined : sourceById.get(run.sourceId) ?? existingSourceById.get(run.sourceId)
    if (source?.captureKind === "graph_ocr") validateOcrMeasurement(source.notes, measurement)
  }
  validateParticipants(bundle.participants, bundle.runs.map((run) => run.id))
}

function knownIds(existing: readonly { readonly id: string }[], incoming: readonly string[]): ReadonlySet<string> {
  return new Set([...existing.map((row) => row.id), ...incoming])
}

function validateSource(source: EvidenceBundleV1["sources"][number]): void {
  nonEmpty("source id", source.id)
  nonEmpty("source publisher", source.publisher)
  nonEmpty("source title", source.title)
  nonEmpty("source scope", source.scope)
  integer("source retrievedAt", source.retrievedAt)
  orderedDates("source effective", source.effectiveFrom, source.effectiveTo)
  if ((source.sourceSystem === "twitter_archive" || source.sourceSystem === "primer") && (empty(source.sourceRef))) {
    throw new Error(`source ${source.id} requires sourceRef for ${source.sourceSystem}`)
  }
  if ((source.sourceSystem === null || source.sourceSystem === undefined) && source.sourceRef !== null && source.sourceRef !== undefined) {
    throw new Error(`source ${source.id} cannot have sourceRef without sourceSystem`)
  }
}

function validateBenchmarkCatalog(catalog: BenchmarkCatalogV1): void {
  for (const [field, value] of [["benchmark catalog id", catalog.id], ["benchmark catalog key", catalog.benchmarkKey], ["benchmark catalog version", catalog.version]] as const) nonEmpty(field, value)
  integer("benchmark catalog expectedAt", catalog.expectedAt ?? undefined)
  integer("benchmark catalog releasedAt", catalog.releasedAt ?? undefined)
  integer("benchmark catalog lastCheckedAt", catalog.lastCheckedAt ?? undefined)
  integer("benchmark catalog nextCheckAt", catalog.nextCheckAt ?? undefined)
  if (catalog.lastCheckedAt !== undefined && catalog.lastCheckedAt !== null && catalog.nextCheckAt !== undefined && catalog.nextCheckAt !== null && catalog.lastCheckedAt > catalog.nextCheckAt) throw new Error(`benchmark catalog ${catalog.id} lastCheckedAt must not exceed nextCheckAt`)
}

function validateSaturationAssessment(assessment: BenchmarkSaturationAssessmentV1): void {
  for (const [field, value] of [["saturation benchmarkCatalogId", assessment.benchmarkCatalogId], ["saturation sourceId", assessment.sourceId], ["saturation cohortKey", assessment.cohortKey]] as const) nonEmpty(field, value)
  integer("saturation assessedAt", assessment.assessedAt)
  integer("saturation topK", assessment.topK ?? undefined)
  integer("saturation expectedSaturationAt", assessment.expectedSaturationAt ?? undefined)
  nonNegativeInteger("saturation topK", assessment.topK)
  finite("saturation topScore", assessment.topScore)
  finite("saturation scoreSpread", assessment.scoreSpread)
  finite("saturation ceiling", assessment.ceiling)
  finite("saturation threshold", assessment.threshold)
  if (assessment.scoreSpread !== undefined && assessment.scoreSpread !== null && assessment.scoreSpread < 0) throw new Error(`saturation scoreSpread must be non-negative`)
}

function validateDefinition(definition: MetricDefinitionV1): void {
  nonEmpty("metric definition id", definition.id)
  for (const [field, value] of [["definitionKey", definition.definitionKey], ["version", definition.version], ["metricKey", definition.metricKey], ["displayName", definition.displayName], ["workClass", definition.workClass], ["taskModality", definition.taskModality], ["unit", definition.unit], ["scoringRule", definition.scoringRule], ["methodologySourceId", definition.methodologySourceId]] as const) nonEmpty(field, value)
  nonNegativeInteger("metric definition datasetSize", definition.datasetSize)
  orderedBounds("metric definition", definition.lowerBound, definition.upperBound)
}

function validateFact(fact: CommercialFactV1): void {
  nonEmpty("commercial fact id", fact.id)
  for (const [field, value] of [["sourceId", fact.sourceId], ["provider", fact.provider], ["product", fact.product], ["component", fact.component], ["subjectKey", fact.subjectKey], ["unit", fact.unit], ["scope", fact.scope]] as const) nonEmpty(field, value)
  integer("commercial effectiveFrom", fact.effectiveFrom)
  orderedDates("commercial effective", fact.effectiveFrom, fact.effectiveTo)
  finiteNonNegative("commercial value", fact.value)
  finitePositive("commercial perValue", fact.perValue)
  nonNegativeInteger("commercial periodSeconds", fact.periodSeconds)
  const hasPerValue = fact.perValue !== undefined && fact.perValue !== null
  const hasPerUnit = fact.perUnit !== undefined && fact.perUnit !== null
  if (hasPerValue !== hasPerUnit) throw new Error(`commercial fact ${fact.id} must pair perValue with perUnit`)
  if ((fact.limitKind === "unlimited" || fact.windowKind === "dynamic" || fact.windowKind === "unknown") && fact.value !== undefined && fact.value !== null) {
    throw new Error(`commercial fact ${fact.id} has an unknown or unlimited quantity and must use null value`)
  }
  if (fact.limitKind === "shared_pool" && empty(fact.poolKey)) throw new Error(`commercial fact ${fact.id} requires poolKey for shared_pool`)
  if ((fact.factKind === "allowance" || fact.factKind === "eligibility") && empty(fact.poolKey)) throw new Error(`commercial fact ${fact.id} requires poolKey for ${fact.factKind}`)
  if (fact.factKind === "eligibility" && fact.value !== undefined && fact.value !== null) throw new Error(`commercial eligibility ${fact.id} must not duplicate a pool quantity`)
}

function validateRun(run: EvaluationRunV1): void {
  nonEmpty("evaluation run id", run.id)
  nonEmpty("evaluation run sourceId", run.sourceId)
  nonEmpty("evaluation run workClass", run.workClass)
  nonEmpty("evaluation run taskModality", run.taskModality)
  integer("evaluation run observedAt", run.observedAt)
  nonNegativeInteger("evaluation run taskCount", run.taskCount)
  nonNegativeInteger("evaluation run retryCount", run.retryCount)
  nonNegativeInteger("evaluation run humanInterventionCount", run.humanInterventionCount)
}

function validateParticipant(participant: EvaluationRunParticipantV1): void {
  nonEmpty("participant runId", participant.runId)
  nonNegativeInteger("participant ordinal", participant.ordinal)
  nonEmpty("participant provider", participant.provider)
  nonEmpty("participant model", participant.model)
}

function validateParticipants(participants: readonly EvaluationRunParticipantV1[], runIds: readonly string[]): void {
  for (const runId of runIds) {
    const forRun = participants.filter((participant) => participant.runId === runId).sort((left, right) => left.ordinal - right.ordinal)
    if (forRun.length === 0) throw new Error(`run ${runId} requires a primary participant`)
    const primaries = forRun.filter((participant) => participant.role === "primary")
    if (primaries.length !== 1 || primaries[0]?.ordinal !== 0) throw new Error(`run ${runId} must have exactly one primary participant at ordinal 0`)
    for (const [index, participant] of forRun.entries()) {
      if (participant.ordinal !== index) throw new Error(`run ${runId} participant ordinals must be contiguous from 0`)
    }
  }
}

function validateMeasurement(measurement: EvaluationMeasurementV1): void {
  nonEmpty("measurement id", measurement.id)
  for (const [field, value] of [["runId", measurement.runId], ["metricKey", measurement.metricKey], ["unit", measurement.unit], ["statistic", measurement.statistic]] as const) nonEmpty(field, value)
  finite("measurement value", measurement.value)
  finite("measurement lowerConfidenceBound", measurement.lowerConfidenceBound)
  finite("measurement upperConfidenceBound", measurement.upperConfidenceBound)
  if (measurement.lowerConfidenceBound !== undefined && measurement.lowerConfidenceBound !== null && measurement.lowerConfidenceBound > measurement.value) throw new Error(`measurement ${measurement.id} lowerConfidenceBound exceeds value`)
  if (measurement.upperConfidenceBound !== undefined && measurement.upperConfidenceBound !== null && measurement.upperConfidenceBound < measurement.value) throw new Error(`measurement ${measurement.id} upperConfidenceBound is below value`)
  if (measurement.confidenceLevel !== undefined && measurement.confidenceLevel !== null && (!Number.isFinite(measurement.confidenceLevel) || measurement.confidenceLevel < 0 || measurement.confidenceLevel > 1)) throw new Error(`measurement ${measurement.id} confidenceLevel must be in [0, 1]`)
  nonNegativeInteger("measurement sampleSize", measurement.sampleSize)
  if (measurement.derived && empty(measurement.derivation)) throw new Error(`derived measurement ${measurement.id} requires derivation`)
}

function validateDefinitionMatch(measurement: EvaluationMeasurementV1, definition: MetricDefinitionV1 | MetricDefinitionRow): void {
  if (measurement.metricKey !== definition.metricKey || measurement.unit !== definition.unit || measurement.direction !== definition.scoreDirection) {
    throw new Error(`measurement ${measurement.id} does not match metric definition ${definition.id} metricKey/unit/direction`)
  }
}

function validateOcrMeasurement(notes: string | null | undefined, measurement: EvaluationMeasurementV1): void {
  const normalizedNotes = notes?.toLocaleLowerCase() ?? ""
  const calibrated = normalizedNotes.includes("calibrat") && normalizedNotes.includes("extract") && normalizedNotes.includes("precision")
  const bounded = measurement.lowerConfidenceBound !== undefined && measurement.lowerConfidenceBound !== null && measurement.upperConfidenceBound !== undefined && measurement.upperConfidenceBound !== null
  if (!calibrated || !bounded) throw new Error(`graph_ocr measurement ${measurement.id} requires calibrated axes, extraction method, precision, and uncertainty bounds`)
}

function insertBenchmarkCatalog(db: EvidenceDb, catalog: BenchmarkCatalogV1): boolean {
  const values = benchmarkCatalogValues(catalog)
  const existing = db.select().from(benchmarkCatalog).where(eq(benchmarkCatalog.id, catalog.id)).get()
  if (existing !== undefined) return same(benchmarkCatalogValues(existing), values, `benchmark catalog ${catalog.id}`)
  db.insert(benchmarkCatalog).values(values).run()
  return true
}

function insertBenchmarkSaturationAssessment(db: EvidenceDb, assessment: BenchmarkSaturationAssessmentV1): boolean {
  const values = saturationAssessmentValues(assessment)
  const existing = db.select().from(benchmarkSaturationAssessments).where(and(eq(benchmarkSaturationAssessments.benchmarkCatalogId, assessment.benchmarkCatalogId), eq(benchmarkSaturationAssessments.sourceId, assessment.sourceId), eq(benchmarkSaturationAssessments.assessedAt, assessment.assessedAt), eq(benchmarkSaturationAssessments.cohortKey, assessment.cohortKey))).get()
  if (existing !== undefined) return same(saturationAssessmentValues(existing), values, `benchmark saturation assessment ${assessment.benchmarkCatalogId}:${assessment.sourceId}:${assessment.assessedAt}:${assessment.cohortKey}`)
  db.insert(benchmarkSaturationAssessments).values(values).run()
  return true
}

function isFixedPhysicalCounter(metricKey: string, unit: string): boolean {
  return new Set(["latency.ms:ms", "duration.ms:ms", "tokens.input:tokens", "tokens.output:tokens", "tokens.total:tokens", "cost.usd:USD", "cost.credits:credits", "retry.count:count", "human.interventions:count"]).has(`${metricKey}:${unit}`)
}

function insertSource(db: EvidenceDb, source: EvidenceBundleV1["sources"][number]): boolean {
  const values = sourceValues(source)
  const existing = db.select().from(evidenceSources).where(eq(evidenceSources.id, source.id)).get()
  if (existing !== undefined) return same(sourceValues(existing), values, `evidence source ${source.id}`)
  db.insert(evidenceSources).values(values).run()
  return true
}

function insertDefinition(db: EvidenceDb, definition: MetricDefinitionV1): boolean {
  const values = definitionValues(definition)
  const existing = db.select().from(metricDefinitions).where(eq(metricDefinitions.id, definition.id)).get()
  if (existing !== undefined) return same(definitionValues(existing), values, `metric definition ${definition.id}`)
  db.insert(metricDefinitions).values(values).run()
  return true
}

function insertFact(db: EvidenceDb, fact: CommercialFactV1): boolean {
  const values = factValues(fact)
  const existing = db.select().from(commercialFacts).where(eq(commercialFacts.id, fact.id)).get()
  if (existing !== undefined) return same(factValues(existing), values, `commercial fact ${fact.id}`)
  db.insert(commercialFacts).values(values).run()
  return true
}

function insertRun(db: EvidenceDb, run: EvaluationRunV1): boolean {
  const values = runValues(run)
  const existing = db.select().from(evaluationRuns).where(eq(evaluationRuns.id, run.id)).get()
  if (existing !== undefined) return same(runValues(existing), values, `evaluation run ${run.id}`)
  db.insert(evaluationRuns).values(values).run()
  return true
}

function insertParticipant(db: EvidenceDb, participant: EvaluationRunParticipantV1): boolean {
  const values = participantValues(participant)
  const existing = db.select().from(evaluationRunParticipants).where(and(eq(evaluationRunParticipants.runId, participant.runId), eq(evaluationRunParticipants.ordinal, participant.ordinal))).get()
  if (existing !== undefined) return same(participantValues(existing), values, `evaluation participant ${participant.runId}:${participant.ordinal}`)
  db.insert(evaluationRunParticipants).values(values).run()
  return true
}

function insertMeasurement(db: EvidenceDb, measurement: EvaluationMeasurementV1): boolean {
  const values = measurementValues(measurement)
  const existing = db.select().from(evaluationMeasurements).where(eq(evaluationMeasurements.id, measurement.id)).get()
  if (existing !== undefined) return same(measurementValues(existing), values, `evaluation measurement ${measurement.id}`)
  db.insert(evaluationMeasurements).values(values).run()
  return true
}

function same(left: object, right: object, identity: string): boolean {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
  if (JSON.stringify(left, keys) !== JSON.stringify(right, keys)) throw new Error(`${identity} collides with a different normalized payload`)
  return false
}

function sourceValues(source: EvidenceBundleV1["sources"][number] | EvidenceSourceRow) {
  return { ...source, sourceSystem: source.sourceSystem ?? null, sourceRef: source.sourceRef ?? null, author: source.author ?? null, url: source.url ?? null, publishedAt: source.publishedAt ?? null, effectiveFrom: source.effectiveFrom ?? null, effectiveTo: source.effectiveTo ?? null, artifactId: source.artifactId ?? null, contentSha256: source.contentSha256 ?? null, methodologyUrl: source.methodologyUrl ?? null, notes: source.notes ?? null }
}
function benchmarkCatalogValues(catalog: BenchmarkCatalogV1 | BenchmarkCatalogRow) {
  return { ...catalog, expectedAt: catalog.expectedAt ?? null, releasedAt: catalog.releasedAt ?? null, lastCheckedAt: catalog.lastCheckedAt ?? null, nextCheckAt: catalog.nextCheckAt ?? null, sourceUrl: catalog.sourceUrl ?? null, dataUrl: catalog.dataUrl ?? null, blocker: catalog.blocker ?? null, notes: catalog.notes ?? null }
}
function saturationAssessmentValues(assessment: BenchmarkSaturationAssessmentV1 | BenchmarkSaturationAssessmentRow) {
  return { ...assessment, topScore: assessment.topScore ?? null, scoreSpread: assessment.scoreSpread ?? null, topK: assessment.topK ?? null, ceiling: assessment.ceiling ?? null, threshold: assessment.threshold ?? null, expectedSaturationAt: assessment.expectedSaturationAt ?? null, notes: assessment.notes ?? null }
}
function definitionValues(definition: MetricDefinitionV1 | MetricDefinitionRow) {
  return { ...definition, benchmarkCatalogId: definition.benchmarkCatalogId ?? null, datasetSize: definition.datasetSize ?? null, hiddenEval: definition.hiddenEval === undefined || definition.hiddenEval === null ? null : typeof definition.hiddenEval === "boolean" ? Number(definition.hiddenEval) : definition.hiddenEval, lowerBound: definition.lowerBound ?? null, upperBound: definition.upperBound ?? null, qualityNotes: definition.qualityNotes ?? null }
}
function factValues(fact: CommercialFactV1 | CommercialFactRow) {
  return { ...fact, effectiveTo: fact.effectiveTo ?? null, model: fact.model ?? null, account: fact.account ?? null, serviceTier: fact.serviceTier ?? null, poolKey: fact.poolKey ?? null, value: fact.value ?? null, perValue: fact.perValue ?? null, perUnit: fact.perUnit ?? null, periodSeconds: fact.periodSeconds ?? null, notes: fact.notes ?? null }
}
function runValues(run: EvaluationRunV1 | EvaluationRunRow) {
  return { ...run, harnessProfile: run.harnessProfile ?? null, toolProfile: run.toolProfile ?? null, contextProfile: run.contextProfile ?? null, taskCount: run.taskCount ?? null, modelCallId: run.modelCallId ?? null, sessionId: run.sessionId ?? null, packetId: run.packetId ?? null, artifactId: run.artifactId ?? null, outcomeClass: run.outcomeClass ?? null, retryCount: run.retryCount ?? null, humanInterventionCount: run.humanInterventionCount ?? null, notes: run.notes ?? null }
}
function participantValues(participant: EvaluationRunParticipantV1 | EvaluationRunParticipantRow) {
  return { ...participant, modelVersion: participant.modelVersion ?? null, account: participant.account ?? null, effort: participant.effort ?? null }
}
function measurementValues(measurement: EvaluationMeasurementV1 | EvaluationMeasurementRow) {
  return { ...measurement, metricDefinitionId: measurement.metricDefinitionId ?? null, lowerConfidenceBound: measurement.lowerConfidenceBound ?? null, upperConfidenceBound: measurement.upperConfidenceBound ?? null, confidenceLevel: measurement.confidenceLevel ?? null, sampleSize: measurement.sampleSize ?? null, costBasis: measurement.costBasis ?? null, derivation: measurement.derivation ?? null, notes: measurement.notes ?? null, derived: typeof measurement.derived === "boolean" ? Number(measurement.derived) : measurement.derived }
}
function listBenchmarkCatalog(db: EvidenceDb, filters: BenchmarkCatalogFilters): BenchmarkCatalogRow[] {
  integer("benchmark catalog since", filters.since)
  return db.select().from(benchmarkCatalog).where(and(filters.readiness === undefined ? undefined : eq(benchmarkCatalog.readiness, filters.readiness), filters.ingestMethod === undefined ? undefined : eq(benchmarkCatalog.ingestMethod, filters.ingestMethod), filters.since === undefined ? undefined : gte(benchmarkCatalog.lastCheckedAt, filters.since))).orderBy(asc(benchmarkCatalog.benchmarkKey), asc(benchmarkCatalog.version), asc(benchmarkCatalog.id)).limit(limit(filters.limit)).all()
}
function listBenchmarkSaturationAssessments(db: EvidenceDb, filters: BenchmarkSaturationAssessmentFilters): BenchmarkSaturationAssessmentRow[] {
  integer("saturation since", filters.since)
  return db.select().from(benchmarkSaturationAssessments).where(and(filters.benchmarkCatalogId === undefined ? undefined : eq(benchmarkSaturationAssessments.benchmarkCatalogId, filters.benchmarkCatalogId), filters.cohortKey === undefined ? undefined : eq(benchmarkSaturationAssessments.cohortKey, filters.cohortKey), filters.status === undefined ? undefined : eq(benchmarkSaturationAssessments.status, filters.status), filters.since === undefined ? undefined : gte(benchmarkSaturationAssessments.assessedAt, filters.since))).orderBy(desc(benchmarkSaturationAssessments.assessedAt), asc(benchmarkSaturationAssessments.benchmarkCatalogId), asc(benchmarkSaturationAssessments.cohortKey)).limit(limit(filters.limit)).all()
}

function listSources(db: EvidenceDb, filters: EvidenceSourceFilters): EvidenceSourceRow[] {
  integer("source since", filters.since)
  return db.select().from(evidenceSources).where(and(filters.trustLabel === undefined ? undefined : eq(evidenceSources.trustLabel, filters.trustLabel), filters.sourceKind === undefined ? undefined : eq(evidenceSources.sourceKind, filters.sourceKind), filters.since === undefined ? undefined : gte(evidenceSources.retrievedAt, filters.since))).orderBy(desc(evidenceSources.retrievedAt), asc(evidenceSources.id)).limit(limit(filters.limit)).all()
}

function listMetricDefinitions(db: EvidenceDb, filters: MetricDefinitionFilters): MetricDefinitionRow[] {
  return db.select().from(metricDefinitions).where(and(filters.definitionKind === undefined ? undefined : eq(metricDefinitions.definitionKind, filters.definitionKind), filters.workClass === undefined ? undefined : eq(metricDefinitions.workClass, filters.workClass), filters.definitionKey === undefined ? undefined : eq(metricDefinitions.definitionKey, filters.definitionKey))).orderBy(asc(metricDefinitions.definitionKey), asc(metricDefinitions.version), asc(metricDefinitions.metricKey), asc(metricDefinitions.id)).limit(limit(filters.limit)).all()
}

function listCommercialFacts(db: EvidenceDb, filters: CommercialFactFilters): CommercialFactRow[] {
  integer("commercial since", filters.since)
  return db.select().from(commercialFacts).where(and(filters.sourceId === undefined ? undefined : eq(commercialFacts.sourceId, filters.sourceId), filters.provider === undefined ? undefined : eq(commercialFacts.provider, filters.provider), filters.model === undefined ? undefined : eq(commercialFacts.model, filters.model), filters.since === undefined ? undefined : gte(commercialFacts.effectiveFrom, filters.since))).orderBy(desc(commercialFacts.effectiveFrom), asc(commercialFacts.id)).limit(limit(filters.limit)).all()
}

function listRuns(db: EvidenceDb, filters: EvaluationRunFilters): EvaluationRunRow[] {
  integer("run since", filters.since)
  const participantRunIds = filters.provider === undefined && filters.model === undefined ? undefined : new Set(db.select({ runId: evaluationRunParticipants.runId }).from(evaluationRunParticipants).where(and(filters.provider === undefined ? undefined : eq(evaluationRunParticipants.provider, filters.provider), filters.model === undefined ? undefined : eq(evaluationRunParticipants.model, filters.model))).all().map((row) => row.runId))
  const rows = db.select().from(evaluationRuns).where(and(filters.sourceId === undefined ? undefined : eq(evaluationRuns.sourceId, filters.sourceId), filters.workClass === undefined ? undefined : eq(evaluationRuns.workClass, filters.workClass), filters.evidenceKind === undefined ? undefined : eq(evaluationRuns.evidenceKind, filters.evidenceKind), filters.since === undefined ? undefined : gte(evaluationRuns.observedAt, filters.since))).orderBy(desc(evaluationRuns.observedAt), asc(evaluationRuns.id)).all()
  return participantRunIds === undefined ? rows.slice(0, limit(filters.limit)) : rows.filter((row) => participantRunIds.has(row.id)).slice(0, limit(filters.limit))
}
function listMeasurements(db: EvidenceDb, filters: EvaluationMeasurementFilters): EvaluationMeasurementRow[] {
  return db.select().from(evaluationMeasurements).where(and(filters.runId === undefined ? undefined : eq(evaluationMeasurements.runId, filters.runId), filters.metricDefinitionId === undefined ? undefined : eq(evaluationMeasurements.metricDefinitionId, filters.metricDefinitionId), filters.metricKey === undefined ? undefined : eq(evaluationMeasurements.metricKey, filters.metricKey))).orderBy(asc(evaluationMeasurements.runId), asc(evaluationMeasurements.metricKey), asc(evaluationMeasurements.id)).limit(limit(filters.limit)).all()
}

function limit(value: number | undefined): number {
  if (value === undefined) return 100
  if (!Number.isInteger(value) || value < 1) throw new Error(`limit must be a positive integer: ${value}`)
  return Math.min(value, 1_000)
}
function nonEmpty(field: string, value: string): void { if (value.length === 0) throw new Error(`${field} must not be empty`) }
function empty(value: string | null | undefined): boolean { return value === undefined || value === null || value.length === 0 }
function integer(field: string, value: number | undefined): void { if (value !== undefined && !Number.isInteger(value)) throw new Error(`${field} must be an integer: ${value}`) }
function nonNegativeInteger(field: string, value: number | null | undefined): void { if (value !== undefined && value !== null && (!Number.isInteger(value) || value < 0)) throw new Error(`${field} must be a non-negative integer: ${value}`) }
function finite(field: string, value: number | null | undefined): void { if (value !== undefined && value !== null && !Number.isFinite(value)) throw new Error(`${field} must be finite: ${value}`) }
function finiteNonNegative(field: string, value: number | null | undefined): void { finite(field, value); if (value !== undefined && value !== null && value < 0) throw new Error(`${field} must be non-negative: ${value}`) }
function finitePositive(field: string, value: number | null | undefined): void { finite(field, value); if (value !== undefined && value !== null && value <= 0) throw new Error(`${field} must be positive: ${value}`) }
function orderedDates(field: string, start: number | null | undefined, end: number | null | undefined): void { integer(`${field} start`, start ?? undefined); integer(`${field} end`, end ?? undefined); if (start !== undefined && start !== null && end !== undefined && end !== null && start > end) throw new Error(`${field} start must not exceed end`) }
function orderedBounds(field: string, lower: number | null | undefined, upper: number | null | undefined): void { finite(`${field} lower`, lower); finite(`${field} upper`, upper); if (lower !== undefined && lower !== null && upper !== undefined && upper !== null && lower > upper) throw new Error(`${field} lower bound must not exceed upper bound`) }
function ensureUnique(values: readonly string[], label: string): void { if (new Set(values).size !== values.length) throw new Error(`bundle contains duplicate ${label}`) }
function requireKnown(ids: ReadonlySet<string>, id: string, field: string): void { if (!ids.has(id)) throw new Error(`${field} references unknown id ${id}`) }
function storageEffect<A>(operation: string, run: () => A) { return Effect.try({ try: run, catch: (cause) => storageError(operation, cause) }) }
function storageError(operation: string, cause: unknown, context?: string): StorageError { const message = cause instanceof Error ? cause.message : String(cause); return new StorageError({ operation, message, cause: message, context: context ?? operation }) }
