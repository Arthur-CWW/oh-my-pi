import { Schema } from "effect"
import { canonicalJson, jsonOf, sha256Hex, stableJson } from "./canonical"
import { ProviderRequest, StopReason, Usage, type JsonValue } from "./protocol"

export const REPLAY_TRACE_SCHEMA_VERSION = 1

const NullableString = Schema.Union([Schema.String, Schema.Null])

export const ReplayUserEvent = Schema.Struct({
  type: Schema.Literal("user"),
  content: Schema.String,
  at: Schema.optionalKey(Schema.String),
})

export const ReplayProviderEvent = Schema.Struct({
  type: Schema.Literal("provider"),
  request: ProviderRequest,
  variant: Schema.optionalKey(Schema.String),
  attempt: Schema.optionalKey(Schema.Int),
  expectedText: Schema.String,
  expectedStopReason: StopReason,
  expectedUsage: Usage,
})

export const ReplayToolEvent = Schema.Struct({
  type: Schema.Literal("tool"),
  callId: Schema.String,
  name: Schema.String,
  result: Schema.Json,
  isError: Schema.optionalKey(Schema.Boolean),
  at: Schema.optionalKey(Schema.String),
})

export const ReplayLifecycleEvent = Schema.Struct({
  type: Schema.Literal("lifecycle"),
  entityId: Schema.String,
  state: Schema.String,
  at: Schema.String,
  modelId: Schema.optionalKey(Schema.String),
  thinkingLevel: Schema.optionalKey(NullableString),
  failureClass: Schema.optionalKey(Schema.String),
  resumeDisposition: Schema.optionalKey(Schema.String),
})

export const ReplayRestartEvent = Schema.Struct({
  type: Schema.Literal("restart"),
  entityId: Schema.String,
  predecessorEpoch: Schema.String,
  state: Schema.String,
  queueCheckpoint: NullableString,
  attemptId: Schema.String,
  at: Schema.String,
})

export const ReplayTerminalEvent = Schema.Struct({
  type: Schema.Literal("terminal"),
  entityId: Schema.String,
  outcome: Schema.Literals(["completed", "failed", "interrupted"]),
  at: Schema.String,
  failureClass: Schema.optionalKey(Schema.String),
  resumeDisposition: Schema.optionalKey(Schema.String),
})

/** Explicit carrier for an event introduced by a newer producer. */
export const ReplayUnknownEvent = Schema.Struct({
  type: Schema.Literal("unknown"),
  originalType: Schema.String,
  payload: Schema.optionalKey(Schema.Json),
})

export const ReplayTraceEvent = Schema.Union([
  ReplayUserEvent,
  ReplayProviderEvent,
  ReplayToolEvent,
  ReplayLifecycleEvent,
  ReplayRestartEvent,
  ReplayTerminalEvent,
  ReplayUnknownEvent,
])
export type ReplayTraceEvent = Schema.Schema.Type<typeof ReplayTraceEvent>

export const ReplayCheckpoint = Schema.Struct({
  id: Schema.String,
  afterEvent: Schema.Int,
  reopen: Schema.optionalKey(Schema.Boolean),
  expectedDigest: Schema.optionalKey(Schema.String),
  invariants: Schema.optionalKey(Schema.Array(Schema.String)),
})
export type ReplayCheckpoint = Schema.Schema.Type<typeof ReplayCheckpoint>

export const ReplayTraceEnvelope = Schema.Struct({
  traceSchemaVersion: Schema.Int,
  traceId: Schema.String,
  sourceDigest: Schema.String,
  seed: Schema.optionalKey(Schema.Int),
  events: Schema.Array(ReplayTraceEvent),
  checkpoints: Schema.Array(ReplayCheckpoint),
  checksum: Schema.String,
})
export type ReplayTraceEnvelope = Schema.Schema.Type<typeof ReplayTraceEnvelope>
export const decodeReplayTraceEvent = Schema.decodeUnknownSync(ReplayTraceEvent)
export const decodeReplayCheckpoint = Schema.decodeUnknownSync(ReplayCheckpoint)

export interface ReplayTraceInput {
  readonly traceId: string
  readonly sourceDigest: string
  readonly seed?: number
  readonly events: readonly ReplayTraceEvent[]
  readonly checkpoints: readonly ReplayCheckpoint[]
}

export type ReplayTraceIntegrityReason =
  | "malformedSchema"
  | "unsupportedVersion"
  | "checksumMismatch"
  | "invalidTrace"

export class ReplayTraceIntegrityError extends Error {
  readonly _tag = "ReplayTraceIntegrityError"

  constructor(
    readonly reason: ReplayTraceIntegrityReason,
    readonly detail: string,
  ) {
    super(detail)
    this.name = "ReplayTraceIntegrityError"
  }
}

export class ReplayUnknownEventError extends Error {
  readonly _tag = "ReplayUnknownEventError"

  constructor(
    readonly eventIndex: number,
    readonly originalType: string,
  ) {
    super(`event ${eventIndex} has unsupported type ${JSON.stringify(originalType)}`)
    this.name = "ReplayUnknownEventError"
  }
}

export class ReplayTerminalMutationError extends Error {
  readonly _tag = "ReplayTerminalMutationError"

  constructor(readonly eventIndex: number) {
    super(`event ${eventIndex} attempts to mutate a terminal replay`)
    this.name = "ReplayTerminalMutationError"
  }
}

const DIGEST = /^sha256:[0-9a-f]{64}$/
const TRACE_DOMAIN = "omp.provider-testkit/differential-trace/v1\u0000"
const OBSERVATION_DOMAIN = "omp.provider-testkit/differential-observation/v1\u0000"

const checksumFor = (trace: Omit<ReplayTraceEnvelope, "checksum">): string =>
  sha256Hex(`${TRACE_DOMAIN}${stableJson(jsonOf(trace))}`)

const validateTrace = (trace: ReplayTraceEnvelope): ReplayTraceEnvelope => {
  if (trace.traceSchemaVersion !== REPLAY_TRACE_SCHEMA_VERSION) {
    throw new ReplayTraceIntegrityError("unsupportedVersion", "trace declares an unsupported schema version")
  }
  if (trace.traceId.length === 0 || !DIGEST.test(trace.sourceDigest)) {
    throw new ReplayTraceIntegrityError("invalidTrace", "trace id and source digest must be non-empty and canonical")
  }

  const { checksum, ...unsigned } = trace
  if (!DIGEST.test(checksum) || checksumFor(unsigned) !== checksum) {
    throw new ReplayTraceIntegrityError("checksumMismatch", "trace checksum does not cover the decoded envelope")
  }

  const checkpointIds = new Set<string>()
  let previousEvent = -1
  for (const checkpoint of trace.checkpoints) {
    if (
      checkpoint.id.length === 0 ||
      checkpointIds.has(checkpoint.id) ||
      checkpoint.afterEvent < 0 ||
      checkpoint.afterEvent >= trace.events.length ||
      checkpoint.afterEvent < previousEvent ||
      (checkpoint.expectedDigest !== undefined && !DIGEST.test(checkpoint.expectedDigest)) ||
      checkpoint.invariants?.some(name => name.length === 0)
    ) {
      throw new ReplayTraceIntegrityError("invalidTrace", `checkpoint ${JSON.stringify(checkpoint.id)} is invalid`)
    }
    checkpointIds.add(checkpoint.id)
    previousEvent = checkpoint.afterEvent
  }

  for (const [index, event] of trace.events.entries()) {
    if (event.type === "unknown" && event.originalType.length === 0) {
      throw new ReplayTraceIntegrityError("invalidTrace", `unknown event ${index} has no original type`)
    }
  }
  return trace
}

const decodeEnvelope = Schema.decodeUnknownSync(ReplayTraceEnvelope)

const decodeAndValidateTrace = (input: unknown): ReplayTraceEnvelope => {
  let trace: ReplayTraceEnvelope
  try {
    trace = decodeEnvelope(input)
  } catch {
    throw new ReplayTraceIntegrityError("malformedSchema", "trace is not valid JSON data for the replay schema")
  }
  return validateTrace(trace)
}

export const sealReplayTrace = (input: ReplayTraceInput): ReplayTraceEnvelope => {
  const unsigned = {
    traceSchemaVersion: REPLAY_TRACE_SCHEMA_VERSION,
    traceId: input.traceId,
    sourceDigest: input.sourceDigest,
    ...(input.seed === undefined ? {} : { seed: input.seed }),
    events: [...input.events],
    checkpoints: [...input.checkpoints],
  } satisfies Omit<ReplayTraceEnvelope, "checksum">
  return decodeAndValidateTrace({ ...unsigned, checksum: checksumFor(unsigned) })
}

export const decodeReplayTrace = (input: unknown): ReplayTraceEnvelope => decodeAndValidateTrace(input)

export const replayObservationDigest = (observation: JsonValue): string =>
  sha256Hex(`${OBSERVATION_DOMAIN}${canonicalJson(observation)}`)

type Awaitable<A> = A | Promise<A>

export interface DifferentialReplayAdapter<Observation> {
  apply(event: ReplayTraceEvent, eventIndex: number): Awaitable<void>
  observe(): Awaitable<Observation>
  reopen?(): Awaitable<void>
}

export interface ReplayInvariant<Observation> {
  readonly name: string
  check(observation: Observation): string | undefined
}

export interface DifferentialReplayOptions<Observation> {
  readonly unknownEventPolicy: "ignore" | "reject"
  readonly canonicalize: (observation: Observation) => JsonValue
  readonly invariants?: readonly ReplayInvariant<Observation>[]
  readonly environment?: Readonly<Record<string, string>>
}

export interface ReplayCheckpointReceipt {
  readonly id: string
  readonly eventIndex: number
  readonly observationDigest: string
  readonly reopened: boolean
}

export interface DifferentialReplayReceipt {
  readonly trace: {
    readonly schemaVersion: number
    readonly traceId: string
    readonly checksum: string
    readonly eventCount: number
    readonly checkpointCount: number
    readonly seed?: number
  }
  readonly sourceDigest: string
  readonly environment: Readonly<Record<string, string>>
  readonly checkpoints: readonly ReplayCheckpointReceipt[]
}

export interface ReplayDivergenceReport {
  readonly reason: "observation" | "invariant" | "expectedDigest"
  readonly checkpointId: string
  readonly eventIndex: number
  readonly prefixLength: number
  readonly minimizedPrefix: readonly ReplayTraceEvent[]
  readonly expectedDigest: string
  readonly actualDigest: string
  readonly expected: JsonValue
  readonly actual: JsonValue
  readonly invariant?: string
  readonly side?: "reference" | "candidate"
  readonly detail?: string
}

export type DifferentialReplayResult =
  | {
      readonly kind: "match"
      readonly finalDigest: string
      readonly receipt: DifferentialReplayReceipt
    }
  | {
      readonly kind: "diverged"
      readonly report: ReplayDivergenceReport
      readonly receipt: DifferentialReplayReceipt
    }

const defaultEnvironment = (): Readonly<Record<string, string>> => ({
  runtime: `${process.release.name}-${process.version}`,
  platform: process.platform,
  arch: process.arch,
})

const makeReceipt = (
  trace: ReplayTraceEnvelope,
  environment: Readonly<Record<string, string>>,
  checkpoints: readonly ReplayCheckpointReceipt[],
): DifferentialReplayReceipt => ({
  trace: {
    schemaVersion: trace.traceSchemaVersion,
    traceId: trace.traceId,
    checksum: trace.checksum,
    eventCount: trace.events.length,
    checkpointCount: trace.checkpoints.length,
    ...(trace.seed === undefined ? {} : { seed: trace.seed }),
  },
  sourceDigest: trace.sourceDigest,
  environment,
  checkpoints,
})

const divergence = (
  trace: ReplayTraceEnvelope,
  checkpoint: ReplayCheckpoint,
  expected: JsonValue,
  actual: JsonValue,
  reason: ReplayDivergenceReport["reason"],
  extra?: Pick<ReplayDivergenceReport, "invariant" | "side" | "detail">,
): ReplayDivergenceReport => ({
  reason,
  checkpointId: checkpoint.id,
  eventIndex: checkpoint.afterEvent,
  prefixLength: checkpoint.afterEvent + 1,
  minimizedPrefix: trace.events.slice(0, checkpoint.afterEvent + 1),
  expectedDigest: replayObservationDigest(expected),
  actualDigest: replayObservationDigest(actual),
  expected,
  actual,
  ...extra,
})

export const runDifferentialReplay = async <Observation>(
  inputTrace: ReplayTraceEnvelope,
  reference: DifferentialReplayAdapter<Observation>,
  candidate: DifferentialReplayAdapter<Observation>,
  options: DifferentialReplayOptions<Observation>,
): Promise<DifferentialReplayResult> => {
  const trace = decodeAndValidateTrace(inputTrace)
  const environment = options.environment ?? defaultEnvironment()
  const invariantByName = new Map(options.invariants?.map(invariant => [invariant.name, invariant]) ?? [])
  const receipts: ReplayCheckpointReceipt[] = []
  let checkpointIndex = 0
  let terminal = false

  for (const [eventIndex, event] of trace.events.entries()) {
    if (event.type === "unknown") {
      if (options.unknownEventPolicy === "reject") {
        throw new ReplayUnknownEventError(eventIndex, event.originalType)
      }
    } else {
      if (terminal) throw new ReplayTerminalMutationError(eventIndex)
      await reference.apply(event, eventIndex)
      await candidate.apply(event, eventIndex)
      if (event.type === "terminal") terminal = true
    }

    while (trace.checkpoints[checkpointIndex]?.afterEvent === eventIndex) {
      const checkpoint = trace.checkpoints[checkpointIndex] as ReplayCheckpoint
      if (checkpoint.reopen === true) {
        if (reference.reopen === undefined || candidate.reopen === undefined) {
          throw new ReplayTraceIntegrityError("invalidTrace", `checkpoint ${checkpoint.id} requires reopen-capable adapters`)
        }
        await reference.reopen()
        await candidate.reopen()
      }

      const referenceObservation = await reference.observe()
      const candidateObservation = await candidate.observe()
      const expected = options.canonicalize(referenceObservation)
      const actual = options.canonicalize(candidateObservation)
      const expectedDigest = replayObservationDigest(expected)
      const actualDigest = replayObservationDigest(actual)

      if (checkpoint.expectedDigest !== undefined && checkpoint.expectedDigest !== expectedDigest) {
        const expectedCheckpoint = checkpoint.expectedDigest as string
        const report = divergence(trace, checkpoint, expected, actual, "expectedDigest", {
          side: "reference",
          detail: `checkpoint declared ${expectedCheckpoint} but reference produced ${expectedDigest}`,
        })
        return { kind: "diverged", report: { ...report, expectedDigest: expectedCheckpoint }, receipt: makeReceipt(trace, environment, receipts) }
      }

      for (const invariantName of checkpoint.invariants ?? []) {
        const invariant = invariantByName.get(invariantName)
        if (invariant === undefined) {
          throw new ReplayTraceIntegrityError("invalidTrace", `checkpoint ${checkpoint.id} names unknown invariant ${invariantName}`)
        }
        const referenceFailure = invariant.check(referenceObservation)
        if (referenceFailure !== undefined) {
          return {
            kind: "diverged",
            report: divergence(trace, checkpoint, expected, actual, "invariant", {
              invariant: invariantName,
              side: "reference",
              detail: referenceFailure,
            }),
            receipt: makeReceipt(trace, environment, receipts),
          }
        }
        const candidateFailure = invariant.check(candidateObservation)
        if (candidateFailure !== undefined) {
          return {
            kind: "diverged",
            report: divergence(trace, checkpoint, expected, actual, "invariant", {
              invariant: invariantName,
              side: "candidate",
              detail: candidateFailure,
            }),
            receipt: makeReceipt(trace, environment, receipts),
          }
        }
      }

      if (expectedDigest !== actualDigest || canonicalJson(expected) !== canonicalJson(actual)) {
        return {
          kind: "diverged",
          report: divergence(trace, checkpoint, expected, actual, "observation"),
          receipt: makeReceipt(trace, environment, receipts),
        }
      }

      receipts.push({
        id: checkpoint.id,
        eventIndex,
        observationDigest: expectedDigest,
        reopened: checkpoint.reopen === true,
      })
      checkpointIndex += 1
    }
  }

  if (checkpointIndex !== trace.checkpoints.length) {
    throw new ReplayTraceIntegrityError("invalidTrace", "one or more checkpoints were not reached")
  }

  const referenceObservation = await reference.observe()
  const candidateObservation = await candidate.observe()
  const expected = options.canonicalize(referenceObservation)
  const actual = options.canonicalize(candidateObservation)
  const expectedDigest = replayObservationDigest(expected)
  const actualDigest = replayObservationDigest(actual)
  if (expectedDigest !== actualDigest || canonicalJson(expected) !== canonicalJson(actual)) {
    return {
      kind: "diverged",
      report: divergence(
        trace,
        { id: "final", afterEvent: trace.events.length - 1 },
        expected,
        actual,
        "observation",
      ),
      receipt: makeReceipt(trace, environment, receipts),
    }
  }
  return {
    kind: "match",
    finalDigest: expectedDigest,
    receipt: makeReceipt(trace, environment, receipts),
  }
}
