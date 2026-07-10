import { Schema } from "effect"

export const SourceKindSchema = Schema.Literals(["official_rate_card", "official_benchmark", "independent_eval", "methodology", "expert_note", "local_telemetry"])
export type SourceKind = Schema.Schema.Type<typeof SourceKindSchema>

export const CaptureKindSchema = Schema.Literals(["web_text", "api_document", "graph_ocr", "methodology", "local_telemetry"])
export type CaptureKind = Schema.Schema.Type<typeof CaptureKindSchema>

export const SourceSystemSchema = Schema.Literals(["twitter_archive", "primer"])
export type SourceSystem = Schema.Schema.Type<typeof SourceSystemSchema>

export const TrustLabelSchema = Schema.Literals(["official", "primary", "independent", "secondary", "local", "inferred"])
export type TrustLabel = Schema.Schema.Type<typeof TrustLabelSchema>

export const DefinitionKindSchema = Schema.Literals(["benchmark", "local_outcome"])
export type DefinitionKind = Schema.Schema.Type<typeof DefinitionKindSchema>

export const EvidenceKindSchema = Schema.Literals(["external_benchmark", "local_evaluation"])
export type EvidenceKind = Schema.Schema.Type<typeof EvidenceKindSchema>

export const ScoreDirectionSchema = Schema.Literals(["maximize", "minimize"])
export type ScoreDirection = Schema.Schema.Type<typeof ScoreDirectionSchema>

export const ContaminationStatusSchema = Schema.Literals(["declared_clean", "possible", "known", "unknown"])

export const BenchmarkReadinessSchema = Schema.Literals(["unreleased", "released", "data_available", "ingested", "blocked", "retired"])
export type BenchmarkReadiness = Schema.Schema.Type<typeof BenchmarkReadinessSchema>

export const BenchmarkIngestMethodSchema = Schema.Literals(["manual", "api", "download", "scrape", "unknown"])
export type BenchmarkIngestMethod = Schema.Schema.Type<typeof BenchmarkIngestMethodSchema>

export const SaturationAssessmentStatusSchema = Schema.Literals(["unknown", "active", "warning", "saturated"])
export type SaturationAssessmentStatus = Schema.Schema.Type<typeof SaturationAssessmentStatusSchema>
export type ContaminationStatus = Schema.Schema.Type<typeof ContaminationStatusSchema>


export const AxisRoleSchema = Schema.Literals(["x", "y", "reported", "derived"])
export type AxisRole = Schema.Schema.Type<typeof AxisRoleSchema>

export const CostBasisSchema = Schema.Literals(["api", "subscription", "credits", "reported_other", "none"])
export type CostBasis = Schema.Schema.Type<typeof CostBasisSchema>

export const PricingContextSchema = Schema.Literals(["api_token", "codex_credit", "chatgpt_message", "subscription_allowance"])
export type PricingContext = Schema.Schema.Type<typeof PricingContextSchema>

export const LimitKindSchema = Schema.Literals(["metered", "fixed_allowance", "shared_pool", "unlimited", "unknown"])
export type LimitKind = Schema.Schema.Type<typeof LimitKindSchema>

export const CommercialFactKindSchema = Schema.Literals(["price", "allowance", "eligibility"])
export type CommercialFactKind = Schema.Schema.Type<typeof CommercialFactKindSchema>

export const CommercialSubjectKindSchema = Schema.Literals(["model", "product", "account", "pool"])
export type CommercialSubjectKind = Schema.Schema.Type<typeof CommercialSubjectKindSchema>

export const WindowKindSchema = Schema.Literals(["fixed", "rolling", "dynamic", "unknown"])
export type WindowKind = Schema.Schema.Type<typeof WindowKindSchema>

export const ParticipantRoleSchema = Schema.Literals(["primary", "advisor"])
export type ParticipantRole = Schema.Schema.Type<typeof ParticipantRoleSchema>

const nullableString = Schema.NullOr(Schema.String)
const nullableNumber = Schema.NullOr(Schema.Number)
const nullableInteger = Schema.NullOr(Schema.Int)

export const EvidenceSourceV1Schema = Schema.Struct({
  id: Schema.String,
  sourceKind: SourceKindSchema,
  captureKind: CaptureKindSchema,
  sourceSystem: Schema.optionalKey(Schema.NullOr(SourceSystemSchema)),
  sourceRef: Schema.optionalKey(nullableString),
  trustLabel: TrustLabelSchema,
  publisher: Schema.String,
  author: Schema.optionalKey(nullableString),
  title: Schema.String,
  url: Schema.optionalKey(nullableString),
  publishedAt: Schema.optionalKey(nullableInteger),
  retrievedAt: Schema.Int,
  effectiveFrom: Schema.optionalKey(nullableInteger),
  effectiveTo: Schema.optionalKey(nullableInteger),
  artifactId: Schema.optionalKey(nullableString),
  contentSha256: Schema.optionalKey(nullableString),
  scope: Schema.String,
  methodologyUrl: Schema.optionalKey(nullableString),
  notes: Schema.optionalKey(nullableString),
})
export type EvidenceSourceV1 = Schema.Schema.Type<typeof EvidenceSourceV1Schema>
export const BenchmarkCatalogV1Schema = Schema.Struct({
  id: Schema.String,
  benchmarkKey: Schema.String,
  version: Schema.String,
  readiness: BenchmarkReadinessSchema,
  expectedAt: Schema.optionalKey(nullableInteger),
  releasedAt: Schema.optionalKey(nullableInteger),
  lastCheckedAt: Schema.optionalKey(nullableInteger),
  nextCheckAt: Schema.optionalKey(nullableInteger),
  sourceUrl: Schema.optionalKey(nullableString),
  dataUrl: Schema.optionalKey(nullableString),
  ingestMethod: BenchmarkIngestMethodSchema,
  blocker: Schema.optionalKey(nullableString),
  notes: Schema.optionalKey(nullableString),
})
export type BenchmarkCatalogV1 = Schema.Schema.Type<typeof BenchmarkCatalogV1Schema>

export const BenchmarkSaturationAssessmentV1Schema = Schema.Struct({
  benchmarkCatalogId: Schema.String,
  sourceId: Schema.String,
  assessedAt: Schema.Int,
  cohortKey: Schema.String,
  status: SaturationAssessmentStatusSchema,
  topScore: Schema.optionalKey(nullableNumber),
  scoreSpread: Schema.optionalKey(nullableNumber),
  topK: Schema.optionalKey(nullableInteger),
  ceiling: Schema.optionalKey(nullableNumber),
  threshold: Schema.optionalKey(nullableNumber),
  expectedSaturationAt: Schema.optionalKey(nullableInteger),
  notes: Schema.optionalKey(nullableString),
})
export type BenchmarkSaturationAssessmentV1 = Schema.Schema.Type<typeof BenchmarkSaturationAssessmentV1Schema>


export const MetricDefinitionV1Schema = Schema.Struct({
  id: Schema.String,
  definitionKind: DefinitionKindSchema,
  definitionKey: Schema.String,
  version: Schema.String,
  benchmarkCatalogId: Schema.optionalKey(nullableString),
  metricKey: Schema.String,
  displayName: Schema.String,
  workClass: Schema.String,
  taskModality: Schema.String,
  unit: Schema.String,
  scoreDirection: ScoreDirectionSchema,
  scoringRule: Schema.String,
  datasetSize: Schema.optionalKey(nullableInteger),
  hiddenEval: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  contaminationStatus: ContaminationStatusSchema,
  lowerBound: Schema.optionalKey(nullableNumber),
  upperBound: Schema.optionalKey(nullableNumber),
  methodologySourceId: Schema.String,
  qualityNotes: Schema.optionalKey(nullableString),
})
export type MetricDefinitionV1 = Schema.Schema.Type<typeof MetricDefinitionV1Schema>
export const CommercialFactV1Schema = Schema.Struct({
  id: Schema.String,
  sourceId: Schema.String,
  effectiveFrom: Schema.Int,
  effectiveTo: Schema.optionalKey(nullableInteger),
  provider: Schema.String,
  model: Schema.optionalKey(nullableString),
  account: Schema.optionalKey(nullableString),
  product: Schema.String,
  pricingContext: PricingContextSchema,
  serviceTier: Schema.optionalKey(nullableString),
  component: Schema.String,
  poolKey: Schema.optionalKey(nullableString),
  factKind: CommercialFactKindSchema,
  subjectKind: CommercialSubjectKindSchema,
  subjectKey: Schema.String,
  windowKind: WindowKindSchema,
  value: Schema.optionalKey(nullableNumber),
  unit: Schema.String,
  perValue: Schema.optionalKey(nullableNumber),
  perUnit: Schema.optionalKey(nullableString),
  limitKind: LimitKindSchema,
  periodSeconds: Schema.optionalKey(nullableInteger),
  scope: Schema.String,
  notes: Schema.optionalKey(nullableString),
})
export type CommercialFactV1 = Schema.Schema.Type<typeof CommercialFactV1Schema>

export const EvaluationRunV1Schema = Schema.Struct({
  id: Schema.String,
  sourceId: Schema.String,
  evidenceKind: EvidenceKindSchema,
  observedAt: Schema.Int,
  workClass: Schema.String,
  harnessProfile: Schema.optionalKey(nullableString),
  toolProfile: Schema.optionalKey(nullableString),
  contextProfile: Schema.optionalKey(nullableString),
  taskModality: Schema.String,
  taskCount: Schema.optionalKey(nullableInteger),
  modelCallId: Schema.optionalKey(nullableString),
  sessionId: Schema.optionalKey(nullableString),
  packetId: Schema.optionalKey(nullableString),
  artifactId: Schema.optionalKey(nullableString),
  outcomeClass: Schema.optionalKey(nullableString),
  retryCount: Schema.optionalKey(nullableInteger),
  humanInterventionCount: Schema.optionalKey(nullableInteger),
  notes: Schema.optionalKey(nullableString),
})
export type EvaluationRunV1 = Schema.Schema.Type<typeof EvaluationRunV1Schema>

export const EvaluationRunParticipantV1Schema = Schema.Struct({
  runId: Schema.String,
  ordinal: Schema.Int,
  role: ParticipantRoleSchema,
  provider: Schema.String,
  model: Schema.String,
  modelVersion: Schema.optionalKey(nullableString),
  account: Schema.optionalKey(nullableString),
  effort: Schema.optionalKey(nullableString),
})
export type EvaluationRunParticipantV1 = Schema.Schema.Type<typeof EvaluationRunParticipantV1Schema>

export const EvaluationMeasurementV1Schema = Schema.Struct({
  id: Schema.String,
  runId: Schema.String,
  metricDefinitionId: Schema.optionalKey(nullableString),
  metricKey: Schema.String,
  value: Schema.Number,
  unit: Schema.String,
  direction: ScoreDirectionSchema,
  statistic: Schema.String,
  axisRole: AxisRoleSchema,
  lowerConfidenceBound: Schema.optionalKey(nullableNumber),
  upperConfidenceBound: Schema.optionalKey(nullableNumber),
  confidenceLevel: Schema.optionalKey(nullableNumber),
  sampleSize: Schema.optionalKey(nullableInteger),
  costBasis: Schema.optionalKey(Schema.NullOr(CostBasisSchema)),
  derived: Schema.Boolean,
  derivation: Schema.optionalKey(nullableString),
  notes: Schema.optionalKey(nullableString),
})
export type EvaluationMeasurementV1 = Schema.Schema.Type<typeof EvaluationMeasurementV1Schema>

export const EvidenceBundleV1Schema = Schema.Struct({
  version: Schema.Literal(1),
  sources: Schema.Array(EvidenceSourceV1Schema),
  benchmarkCatalog: Schema.Array(BenchmarkCatalogV1Schema),
  benchmarkSaturationAssessments: Schema.Array(BenchmarkSaturationAssessmentV1Schema),
  metricDefinitions: Schema.Array(MetricDefinitionV1Schema),
  commercialFacts: Schema.Array(CommercialFactV1Schema),
  runs: Schema.Array(EvaluationRunV1Schema),
  participants: Schema.Array(EvaluationRunParticipantV1Schema),
  measurements: Schema.Array(EvaluationMeasurementV1Schema),
})
export type EvidenceBundleV1 = Schema.Schema.Type<typeof EvidenceBundleV1Schema>

const EvidenceBundleV1JsonSchema = Schema.fromJsonString(EvidenceBundleV1Schema)

export function decodeEvidenceBundleV1Json(json: string): EvidenceBundleV1 {
  return Schema.decodeUnknownSync(EvidenceBundleV1JsonSchema)(json)
}
