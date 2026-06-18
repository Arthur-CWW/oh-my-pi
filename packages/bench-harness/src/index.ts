import { Schema } from "effect"

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))
const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))
const ScoreNumber = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))

export const BenchDifficultySchema = Schema.Union([
  Schema.Literal("medium"),
  Schema.Literal("hard"),
  Schema.Literal("integration"),
])

export const BenchRiskSchema = Schema.Union([
  Schema.Literal("none"),
  Schema.Literal("auth_required"),
  Schema.Literal("rate_limited"),
  Schema.Literal("network"),
  Schema.Literal("provider_state"),
  Schema.Literal("large_context"),
])

export const BenchTaskInputSchema = Schema.Struct({
  path: NonEmptyString,
  description: NonEmptyString,
  approxBytes: NonNegativeNumber,
})

export const BenchPacketSchema = Schema.Struct({
  id: NonEmptyString,
  title: NonEmptyString,
  workstream: NonEmptyString,
  difficulty: BenchDifficultySchema,
  summary: NonEmptyString,
  context: Schema.NonEmptyArray(NonEmptyString),
  inputs: Schema.NonEmptyArray(BenchTaskInputSchema),
  acceptance: Schema.NonEmptyArray(NonEmptyString),
  risks: Schema.Array(BenchRiskSchema),
  tags: Schema.Array(NonEmptyString),
})

export const BenchStatusSchema = Schema.Union([
  Schema.Literal("passed"),
  Schema.Literal("failed"),
  Schema.Literal("error"),
  Schema.Literal("skipped"),
  Schema.Literal("blocked"),
])

export const BenchErrorKindSchema = Schema.Union([
  Schema.Literal("auth"),
  Schema.Literal("rate_limit"),
  Schema.Literal("timeout"),
  Schema.Literal("assertion"),
  Schema.Literal("runtime"),
  Schema.Literal("provider"),
])

export const BenchErrorSchema = Schema.Struct({
  message: NonEmptyString,
  kind: Schema.optional(BenchErrorKindSchema),
  code: Schema.optional(NonEmptyString),
  httpStatus: Schema.optional(NonNegativeNumber),
})

export const BenchArtifactSchema = Schema.Struct({
  id: NonEmptyString,
  kind: Schema.Union([
    Schema.Literal("log"),
    Schema.Literal("json"),
    Schema.Literal("trace"),
    Schema.Literal("report"),
    Schema.Literal("diff"),
  ]),
  path: NonEmptyString,
  bytes: NonNegativeNumber,
})

export const BenchTaskResultSchema = Schema.Struct({
  taskId: NonEmptyString,
  status: BenchStatusSchema,
  startedAtMs: NonNegativeNumber,
  endedAtMs: NonNegativeNumber,
  error: Schema.optional(BenchErrorSchema),
  artifacts: Schema.Array(BenchArtifactSchema),
})

export const BenchRunRecordSchema = Schema.Struct({
  runId: NonEmptyString,
  packetId: NonEmptyString,
  startedAtMs: NonNegativeNumber,
  endedAtMs: NonNegativeNumber,
  status: BenchStatusSchema,
  results: Schema.NonEmptyArray(BenchTaskResultSchema),
  artifacts: Schema.Array(BenchArtifactSchema),
})

export const BenchScoreInputSchema = Schema.Struct({
  taskId: NonEmptyString,
  correctness: ScoreNumber,
  safety: ScoreNumber,
  completeness: ScoreNumber,
  maintainability: ScoreNumber,
})

export type BenchDifficulty = Schema.Schema.Type<typeof BenchDifficultySchema>
export type BenchRisk = Schema.Schema.Type<typeof BenchRiskSchema>
export type BenchTaskInput = Schema.Schema.Type<typeof BenchTaskInputSchema>
export type BenchPacket = Schema.Schema.Type<typeof BenchPacketSchema>
export type BenchStatus = Schema.Schema.Type<typeof BenchStatusSchema>
export type BenchErrorKind = Schema.Schema.Type<typeof BenchErrorKindSchema>
export type BenchError = Schema.Schema.Type<typeof BenchErrorSchema>
export type BenchArtifact = Schema.Schema.Type<typeof BenchArtifactSchema>
export type BenchTaskResult = Schema.Schema.Type<typeof BenchTaskResultSchema>
export type BenchRunRecord = Schema.Schema.Type<typeof BenchRunRecordSchema>
export type BenchScoreInput = Schema.Schema.Type<typeof BenchScoreInputSchema>

export interface BenchScoreBreakdown {
  taskId: string
  score: number
  correctness: number
  safety: number
  completeness: number
  maintainability: number
}

export interface BenchScoreSummary {
  score: number
  maxScore: number
  breakdown: BenchScoreBreakdown[]
}

export interface BenchErrorSummary {
  taskId: string
  message: string
  code?: string
  httpStatus?: number
}

export interface BenchRunSummary {
  runId: string
  packetId: string
  status: BenchStatus
  durationMs: number
  taskCount: number
  passed: number
  failed: number
  skipped: number
  blocked: number
  error: number
  rateLimitErrors: BenchErrorSummary[]
  authErrors: BenchErrorSummary[]
  artifacts: BenchArtifact[]
}

export const scoringRubric = {
  correctness: 0.45,
  safety: 0.25,
  completeness: 0.2,
  maintainability: 0.1,
} as const

function normalizeScore(score: number): number {
  return Math.round(score * 1_000_000_000_000) / 1_000_000_000_000
}


export function scoreTask(input: BenchScoreInput): BenchScoreBreakdown {
  const score = input.correctness * scoringRubric.correctness
    + input.safety * scoringRubric.safety
    + input.completeness * scoringRubric.completeness
    + input.maintainability * scoringRubric.maintainability

  return {
    taskId: input.taskId,
    score: normalizeScore(score),
    correctness: input.correctness,
    safety: input.safety,
    completeness: input.completeness,
    maintainability: input.maintainability,
  }
}

export function aggregateScores(inputs: readonly BenchScoreInput[]): BenchScoreSummary {
  const breakdown = inputs.map(scoreTask)
  const total = breakdown.reduce((sum, entry) => sum + entry.score, 0)

  return {
    score: breakdown.length === 0 ? 0 : normalizeScore(total / breakdown.length),
    maxScore: 1,
    breakdown,
  }
}

export function summarizeBenchRun(run: BenchRunRecord): BenchRunSummary {
  const summary: BenchRunSummary = {
    runId: run.runId,
    packetId: run.packetId,
    status: run.status,
    durationMs: Math.max(0, run.endedAtMs - run.startedAtMs),
    taskCount: run.results.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    blocked: 0,
    error: 0,
    rateLimitErrors: [],
    authErrors: [],
    artifacts: [...run.artifacts],
  }

  for (const result of run.results) {
    summary[result.status] += 1
    summary.artifacts.push(...result.artifacts)

    if (result.error === undefined) {
      continue
    }

    if (isRateLimitError(result.error)) {
      summary.rateLimitErrors.push(toErrorSummary(result.taskId, result.error))
    }

    if (isAuthError(result.error)) {
      summary.authErrors.push(toErrorSummary(result.taskId, result.error))
    }
  }

  return summary
}

export function isRateLimitError(error: BenchError): boolean {
  return error.kind === "rate_limit"
    || error.httpStatus === 429
    || error.code === "RATE_LIMITED"
    || error.code === "TOO_MANY_REQUESTS"
    || /rate[ -]?limit|too many requests|quota/i.test(error.message)
}

export function isAuthError(error: BenchError): boolean {
  return error.kind === "auth"
    || error.httpStatus === 401
    || error.httpStatus === 403
    || error.code === "AUTH_REQUIRED"
    || error.code === "UNAUTHORIZED"
    || error.code === "FORBIDDEN"
    || /unauthori[sz]ed|forbidden|auth|login|credential/i.test(error.message)
}

function toErrorSummary(taskId: string, error: BenchError): BenchErrorSummary {
  return {
    taskId,
    message: error.message,
    code: error.code,
    httpStatus: error.httpStatus,
  }
}

export function decodeBenchPacket(value: unknown): BenchPacket {
  return Schema.decodeUnknownSync(BenchPacketSchema)(value)
}

export function decodeBenchRunRecord(value: unknown): BenchRunRecord {
  return Schema.decodeUnknownSync(BenchRunRecordSchema)(value)
}
