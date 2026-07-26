import { createHash } from "node:crypto"
import { closeSync, constants, openSync, readFileSync, readSync, statSync } from "node:fs"

import { Effect, Schema } from "effect"

import { ArtifactError, StorageError } from "./errors"
import {
  type ArtifactContent,
  type ArtifactMeta,
  type BatchRow,
  type BranchInput,
  type DiagnosticOccurrenceInput,
  type DiagnosticProjectionInput,
  type EventInput,
  LedgerStore,
  type ModelCallInput,
  type OperationalEventInput,
  type ProviderCallInput,
  type RouteResolutionInput,
  type SessionInput,
  type TimelineInput,
  type TurnInput,
} from "./ledger"
import {
  contentObjectPathFor,
  defaultRawCaptureDir,
  MAX_SERIALIZED_OUTBOX_RECORD_BYTES,
  type JsonValue,
  JsonValueSchema,
  type KnownOutboxKind,
  OutboxEnvelopeSchema,
  type OutboxEnvelope,
  RawContentReferenceV1Schema,
  type RawContentReferenceV1,
  RelayLifecyclePayloadV1Schema,
  WorkLeasePayloadV1Schema,
} from "./outbox"
import {
  AgentTimelinePayloadV1Schema,
  type AgentTimelinePayloadV1,
  DiagnosticOccurrencePayloadV1Schema,
  DiagnosticProjectionPayloadV1Schema,
  type DiagnosticOccurrencePayloadV1,
  type DiagnosticProjectionPayloadV1,
  type JsonObject,
  RouteResolutionPayloadV1Schema,
  type RouteResolutionPayloadV1,
  RunnerEventPayloadV1Schema,
  type RunnerEventPayloadV1,
} from "./omp-events"

const DEFAULT_BATCH_SIZE = 500

export interface IngestOutboxOptions {
  readonly batchSize?: number
  readonly rawDir?: string
  readonly endOffset?: number
}

export interface IngestOutboxResult {
  readonly inserted: number
  readonly ignored: number
  readonly malformed: number
}

const NullableString = Schema.NullOr(Schema.String)
const NullableNumber = Schema.NullOr(Schema.Number)
const OptionalString = Schema.optionalKey(NullableString)
const OptionalNumber = Schema.optionalKey(NullableNumber)
const sha256Pattern = /^[0-9a-f]{64}$/

const SessionPayloadSchema = Schema.Struct({
  id: OptionalString,
  machine: Schema.String,
  harness: Schema.String,
  workspace: Schema.String,
  title: Schema.String,
  status: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  meta: Schema.String,
})

type SessionPayload = Schema.Schema.Type<typeof SessionPayloadSchema>

const BranchPayloadSchema = Schema.Struct({
  id: OptionalString,
  sessionId: OptionalString,
  parentBranchId: OptionalString,
  kind: Schema.String,
  atTurn: OptionalNumber,
  createdAt: Schema.Number,
  meta: Schema.String,
})

type BranchPayload = Schema.Schema.Type<typeof BranchPayloadSchema>

const TurnPayloadSchema = Schema.Struct({
  id: OptionalString,
  sessionId: OptionalString,
  branchId: Schema.String,
  seq: Schema.Number,
  startedAt: Schema.Number,
  endedAt: OptionalNumber,
  contextTokens: Schema.Number,
  toolCalls: Schema.Number,
  toolCallSummary: OptionalString,
  editBytes: Schema.Number,
  turnDurationMs: Schema.Number,
  yieldKind: Schema.String,
  affectSelfReport: OptionalString,
  affectSignals: OptionalString,
})

type TurnPayload = Schema.Schema.Type<typeof TurnPayloadSchema>

const EventPayloadSchema = Schema.Struct({
  id: OptionalString,
  ts: OptionalNumber,
  sessionId: OptionalString,
  seq: OptionalNumber,
  branchId: OptionalString,
  packetId: OptionalString,
  kind: Schema.String,
  payloadVersion: Schema.Number,
  payload: JsonValueSchema,
})

type EventPayload = Schema.Schema.Type<typeof EventPayloadSchema>

const AttributionPayloadSchema = Schema.Struct({
  modelCallId: Schema.String,
  entryId: Schema.String,
})

const ModelCallPayloadSchema = Schema.Struct({
  id: OptionalString,
  ts: OptionalNumber,
  machine: Schema.String,
  session: OptionalString,
  branchId: Schema.String,
  agent: Schema.String,
  model: Schema.String,
  provider: Schema.String,
  upstreamProvider: OptionalString,
  effort: Schema.String,
  promptHash: Schema.String,
  systemPromptHash: Schema.String,
  skillProfile: Schema.String,
  contextManifest: Schema.String,
  packetId: Schema.String,
  tokensIn: Schema.Number,
  tokensOut: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  // Live publisher emits a cost breakdown object; fixtures/spec use a number. Normalize to total.
  cost: Schema.Union([Schema.Number, Schema.Struct({ total: Schema.Number })]),
  latencyMs: Schema.Number,
  ttftMs: OptionalNumber,
  reasoningTokens: OptionalNumber,
  outcome: Schema.String,
  errorClass: OptionalString,
  retryOf: OptionalString,
  fallbackFrom: OptionalString,
  rawRequestArtifact: Schema.String,
  rawResponseArtifact: Schema.String,
  entryId: OptionalString,
  routeResolutionId: OptionalString,
  attribution: OptionalString,
  rawRequestSupport: OptionalString,
  rawRequest: Schema.optionalKey(JsonValueSchema),
  rawRequestRef: Schema.optionalKey(JsonValueSchema),
})

type ModelCallPayload = Schema.Schema.Type<typeof ModelCallPayloadSchema>

const ProviderCallPayloadSchema = Schema.Struct({
  id: OptionalString,
  ts: OptionalNumber,
  sessionId: OptionalString,
  branchId: OptionalString,
  packetId: OptionalString,
  provider: Schema.String,
  operation: Schema.String,
  inputHash: Schema.String,
  rawRequestArtifact: OptionalString,
  latencyMs: Schema.Number,
  outcome: Schema.String,
  errorClass: OptionalString,
  cost: OptionalNumber,
  usage: OptionalString,
})

type ProviderCallPayload = Schema.Schema.Type<typeof ProviderCallPayloadSchema>

const ArtifactPayloadSchema = Schema.Union([
  Schema.Struct({
    content: Schema.String,
    sessionId: OptionalString,
    kind: Schema.String,
    retention: Schema.String,
    meta: Schema.String,
  }),
  Schema.Struct({
    path: Schema.String,
    sessionId: OptionalString,
    kind: Schema.String,
    retention: Schema.String,
    meta: Schema.String,
  }),
])

type ArtifactPayload = Schema.Schema.Type<typeof ArtifactPayloadSchema>

type AgentTimelinePayload = AgentTimelinePayloadV1
type RouteResolutionPayload = RouteResolutionPayloadV1
type RunnerEventPayload = RunnerEventPayloadV1
type DiagnosticOccurrencePayload = DiagnosticOccurrencePayloadV1
type DiagnosticProjectionPayload = DiagnosticProjectionPayloadV1

type RowMapping = {
  readonly row: BatchRow
  readonly malformed: boolean
  readonly rawRequestArtifact?: RawRequestArtifactInput
  readonly attribution?: AttributionInput
}

interface RawRequestArtifactInput {
  readonly content: string
  readonly meta: ArtifactMeta
}

interface AttributionInput {
  readonly modelCallId: string
  readonly entryId: string
}

export function ingestOutbox(
  filePath: string,
  options: IngestOutboxOptions = {},
): Effect.Effect<IngestOutboxResult, StorageError | ArtifactError, LedgerStore> {
  return Effect.gen(function* () {
    const store = yield* LedgerStore
    const rows: BatchRow[] = []
    const attributions: AttributionInput[] = []
    const batchSize = normalizedBatchSize(options.batchSize)
    const rawDir = options.rawDir ?? defaultRawCaptureDir()
    let inserted = 0
    let ignored = 0
    let malformed = 0

    const flush = () => Effect.gen(function* () {
      if (rows.length === 0) return
      const batchRows = rows.splice(0)
      const batchAttributions = attributions.splice(0)
      const result = yield* store.ingestBatch(batchRows)
      inserted += result.inserted
      ignored += result.ignored
      for (const attribution of batchAttributions) {
        yield* store.attributeModelCall(attribution.modelCallId, attribution.entryId)
      }
    })

    try {
      for (const line of streamLines(filePath, options.endOffset)) {
        if (line.rawLine === "") continue
        const mapping = yield* Effect.try({
          try: () => mapLine(filePath, line.lineNumber, line.rawLine, rawDir),
          catch: (cause) => storageFailure(filePath, cause),
        })
        if (mapping.rawRequestArtifact !== undefined && mapping.row.kind === "modelCall") {
          const artifact = yield* store.putArtifact(
            { content: mapping.rawRequestArtifact.content },
            mapping.rawRequestArtifact.meta,
          )
          if (artifact.inserted) inserted += 1
          else ignored += 1
          rows.push({
            kind: "modelCall",
            payload: { ...mapping.row.payload, rawRequestArtifact: artifact.id },
          })
        } else {
          rows.push(mapping.row)
        }
        if (mapping.attribution !== undefined) attributions.push(mapping.attribution)
        if (mapping.malformed) malformed += 1
        if (rows.length >= batchSize) yield* flush()
      }
    } catch (cause) {
      return yield* Effect.fail(storageFailure(filePath, cause))
    }
    yield* flush()
    return { inserted, ignored, malformed }
  })
}

interface StreamedLine {
  readonly lineNumber: number
  readonly rawLine: string
}

function* streamLines(filePath: string, endOffset: number | undefined): Generator<StreamedLine> {
  const size = statSync(filePath).size
  const limit = endOffset ?? size
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > size) {
    throw new Error(`Invalid ingest end offset ${String(endOffset)} for ${filePath}`)
  }
  const descriptor = openSync(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  const chunk = Buffer.allocUnsafe(64 * 1024)
  let pending = Buffer.alloc(0)
  let position = 0
  let lineNumber = 0
  try {
    while (position < limit) {
      const count = readSync(
        descriptor,
        chunk,
        0,
        Math.min(chunk.length, limit - position),
        position,
      )
      if (count === 0) throw new Error(`Unexpected EOF while ingesting ${filePath}`)
      position += count
      const bytes = pending.length === 0
        ? chunk.subarray(0, count)
        : Buffer.concat([pending, chunk.subarray(0, count)])
      let start = 0
      for (let index = 0; index < bytes.length; index += 1) {
        if (bytes[index] !== 0x0a) continue
        const line = bytes.subarray(start, index)
        if (line.length > MAX_SERIALIZED_OUTBOX_RECORD_BYTES) {
          throw new Error(`Outbox record exceeds ${MAX_SERIALIZED_OUTBOX_RECORD_BYTES} bytes`)
        }
        lineNumber += 1
        yield { lineNumber, rawLine: line.toString("utf8") }
        start = index + 1
      }
      pending = Buffer.from(bytes.subarray(start))
      if (pending.length > MAX_SERIALIZED_OUTBOX_RECORD_BYTES) {
        throw new Error(`Outbox record exceeds ${MAX_SERIALIZED_OUTBOX_RECORD_BYTES} bytes`)
      }
    }
    if (pending.length > 0) {
      lineNumber += 1
      yield { lineNumber, rawLine: pending.toString("utf8") }
    }
  } finally {
    closeSync(descriptor)
  }
}

function mapLine(filePath: string, lineNumber: number, rawLine: string, rawDir: string): RowMapping {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawLine)
  } catch (cause) {
    return malformedEvent(filePath, lineNumber, rawLine, errorMessage(cause))
  }

  let envelope: OutboxEnvelope
  try {
    envelope = Schema.decodeUnknownSync(OutboxEnvelopeSchema)(parsed)
  } catch (cause) {
    return malformedEvent(filePath, lineNumber, rawLine, errorMessage(cause))
  }

  if (envelope.v !== 1 || !isKnownOutboxKind(envelope.kind)) {
    return { row: genericEvent(envelope, rawLine), malformed: false }
  }

  return mapKnownEnvelopeRow(envelope, envelope.kind, rawLine, rawDir)
}

function mapKnownEnvelopeRow(envelope: OutboxEnvelope, kind: KnownOutboxKind, rawLine: string, rawDir: string): RowMapping {
  switch (kind) {
    case "session": {
      const payload = Schema.decodeUnknownOption(SessionPayloadSchema)(envelope.payload, { onExcessProperty: "ignore" })
      return payload._tag === "Some" ? { row: { kind, payload: sessionInput(envelope, payload.value) }, malformed: false } : payloadErrorEvent(envelope, rawLine, "session payload schema mismatch")
    }
    case "branch": {
      const payload = Schema.decodeUnknownOption(BranchPayloadSchema)(envelope.payload, { onExcessProperty: "ignore" })
      return payload._tag === "Some" ? { row: { kind, payload: branchInput(envelope, payload.value) }, malformed: false } : payloadErrorEvent(envelope, rawLine, "branch payload schema mismatch")
    }
    case "turn": {
      const payload = Schema.decodeUnknownOption(TurnPayloadSchema)(envelope.payload, { onExcessProperty: "ignore" })
      return payload._tag === "Some" ? { row: { kind, payload: turnInput(envelope, payload.value) }, malformed: false } : payloadErrorEvent(envelope, rawLine, "turn payload schema mismatch")
    }
    case "event": {
      const payload = Schema.decodeUnknownOption(EventPayloadSchema)(envelope.payload, { onExcessProperty: "ignore" })
      if (payload._tag !== "Some") {
        return payloadErrorEvent(envelope, rawLine, "event payload schema mismatch")
      }
      return {
        row: { kind, payload: eventInput(envelope, payload.value) },
        malformed: false,
        attribution: attributionInput(payload.value),
      }
    }
    case "modelCall": {
      const payload = Schema.decodeUnknownOption(ModelCallPayloadSchema)(envelope.payload, { onExcessProperty: "ignore" })
      if (payload._tag !== "Some") {
        return payloadErrorEvent(envelope, rawLine, "modelCall payload schema mismatch")
      }
      return {
        row: { kind, payload: modelCallInput(envelope, payload.value) },
        malformed: false,
        rawRequestArtifact: rawRequestArtifactInput(envelope, payload.value, rawDir),
      }
    }
    case "providerCall": {
      const payload = Schema.decodeUnknownOption(ProviderCallPayloadSchema)(envelope.payload, { onExcessProperty: "ignore" })
      return payload._tag === "Some" ? { row: { kind, payload: providerCallInput(envelope, payload.value) }, malformed: false } : payloadErrorEvent(envelope, rawLine, "providerCall payload schema mismatch")
    }
    case "artifact": {
      const payload = Schema.decodeUnknownOption(ArtifactPayloadSchema)(envelope.payload, { onExcessProperty: "ignore" })
      return payload._tag === "Some" ? { row: { kind, payload: artifactInput(envelope, payload.value) }, malformed: false } : payloadErrorEvent(envelope, rawLine, "artifact payload schema mismatch")
    }
    case "agentTimeline": {
      if (payloadVersion(envelope.payload) !== 1) return { row: genericEvent(envelope, rawLine), malformed: false }
      const payload = Schema.decodeUnknownOption(AgentTimelinePayloadV1Schema)(envelope.payload, { onExcessProperty: "ignore" })
      if (payload._tag !== "Some") return payloadErrorEvent(envelope, rawLine, "agentTimeline payload schema mismatch")
      try {
        return { row: { kind, payload: agentTimelineInput(envelope, payload.value) }, malformed: false }
      } catch (cause) {
        return payloadErrorEvent(envelope, rawLine, errorMessage(cause))
      }
    }
    case "routeResolution": {
      if (payloadVersion(envelope.payload) !== 1) return { row: genericEvent(envelope, rawLine), malformed: false }
      const payload = Schema.decodeUnknownOption(RouteResolutionPayloadV1Schema)(envelope.payload, { onExcessProperty: "ignore" })
      if (payload._tag !== "Some") return payloadErrorEvent(envelope, rawLine, "routeResolution payload schema mismatch")
      try {
        return { row: { kind, payload: routeResolutionInput(envelope, payload.value) }, malformed: false }
      } catch (cause) {
        return payloadErrorEvent(envelope, rawLine, errorMessage(cause))
      }
    }
    case "runnerEvent": {
      if (payloadVersion(envelope.payload) !== 1) return { row: genericEvent(envelope, rawLine), malformed: false }
      try {
        return { row: { kind, payload: runnerEventInput(envelope, Schema.decodeUnknownSync(RunnerEventPayloadV1Schema)(envelope.payload)) }, malformed: false }
      } catch (cause) {
        return payloadErrorEvent(envelope, rawLine, errorMessage(cause))
      }
    }
    case "diagnosticOccurrence": {
      if (payloadVersion(envelope.payload) !== 1) return { row: genericEvent(envelope, rawLine), malformed: false }
      try {
        return { row: { kind, payload: diagnosticOccurrenceInput(envelope, Schema.decodeUnknownSync(DiagnosticOccurrencePayloadV1Schema)(envelope.payload)) }, malformed: false }
      } catch (cause) {
        return payloadErrorEvent(envelope, rawLine, errorMessage(cause))
      }
    }
    case "diagnosticProjection": {
      if (payloadVersion(envelope.payload) !== 1) return { row: genericEvent(envelope, rawLine), malformed: false }
      try {
        return { row: { kind, payload: diagnosticProjectionInput(envelope, Schema.decodeUnknownSync(DiagnosticProjectionPayloadV1Schema)(envelope.payload)) }, malformed: false }
      } catch (cause) {
        return payloadErrorEvent(envelope, rawLine, errorMessage(cause))
      }
    }
    case "relayLifecycle": {
      const payload = Schema.decodeUnknownOption(RelayLifecyclePayloadV1Schema)(envelope.payload)
      return payload._tag === "Some"
        ? { row: genericEvent(envelope, rawLine), malformed: false }
        : payloadErrorEvent(envelope, rawLine, "relay lifecycle payload schema mismatch")
    }
    case "workLease": {
      const payload = Schema.decodeUnknownOption(WorkLeasePayloadV1Schema)(envelope.payload)
      return payload._tag === "Some"
        ? { row: genericEvent(envelope, rawLine), malformed: false }
        : payloadErrorEvent(envelope, rawLine, "work lease payload schema mismatch")
    }
  }
}

function sessionInput(envelope: OutboxEnvelope, payload: SessionPayload): SessionInput {
  return {
    id: payload.id ?? envelope.sessionId,
    machine: payload.machine,
    harness: payload.harness,
    workspace: payload.workspace,
    title: payload.title,
    status: payload.status,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    meta: payload.meta,
  }
}

function branchInput(envelope: OutboxEnvelope, payload: BranchPayload): BranchInput {
  return {
    id: payload.id ?? rowId(envelope),
    sessionId: payload.sessionId ?? envelope.sessionId,
    parentBranchId: payload.parentBranchId ?? undefined,
    kind: payload.kind,
    atTurn: payload.atTurn ?? undefined,
    createdAt: payload.createdAt,
    meta: payload.meta,
  }
}

function turnInput(envelope: OutboxEnvelope, payload: TurnPayload): TurnInput {
  return {
    id: payload.id ?? `${envelope.sessionId}:turn:${payload.seq}`,
    sessionId: envelope.sessionId,
    branchId: payload.branchId,
    seq: payload.seq,
    startedAt: payload.startedAt,
    endedAt: payload.endedAt ?? undefined,
    contextTokens: payload.contextTokens,
    toolCalls: payload.toolCalls,
    toolCallSummary: payload.toolCallSummary ?? undefined,
    editBytes: payload.editBytes,
    turnDurationMs: payload.turnDurationMs,
    yieldKind: payload.yieldKind,
    affectSelfReport: payload.affectSelfReport ?? undefined,
    affectSignals: payload.affectSignals ?? undefined,
  }
}

function eventInput(envelope: OutboxEnvelope, payload: EventPayload): EventInput {
  return {
    id: payload.id ?? rowId(envelope),
    ts: payload.ts ?? envelope.ts,
    sessionId: payload.sessionId ?? envelope.sessionId,
    seq: payload.seq ?? envelope.seq,
    branchId: payload.branchId ?? undefined,
    packetId: payload.packetId ?? undefined,
    kind: payload.kind,
    payloadVersion: payload.payloadVersion,
    payload: typeof payload.payload === "string" ? payload.payload : jsonText(payload.payload),
  }
}

function attributionInput(payload: EventPayload): AttributionInput | undefined {
  if (payload.kind !== "attribution") {
    return undefined
  }
  const decoded = Schema.decodeUnknownOption(AttributionPayloadSchema)(payload.payload, { onExcessProperty: "ignore" })
  if (decoded._tag !== "Some") {
    return undefined
  }
  return decoded.value
}

function modelCallInput(envelope: OutboxEnvelope, payload: ModelCallPayload): ModelCallInput {
  return {
    id: payload.id ?? rowId(envelope),
    ts: payload.ts ?? envelope.ts,
    machine: payload.machine,
    session: payload.session ?? envelope.sessionId,
    branchId: payload.branchId,
    agent: payload.agent,
    model: payload.model,
    provider: payload.provider,
    upstreamProvider: payload.upstreamProvider ?? undefined,
    effort: payload.effort,
    promptHash: payload.promptHash,
    systemPromptHash: payload.systemPromptHash,
    skillProfile: payload.skillProfile,
    contextManifest: payload.contextManifest,
    packetId: payload.packetId,
    tokensIn: payload.tokensIn,
    tokensOut: payload.tokensOut,
    cacheRead: payload.cacheRead,
    cacheWrite: payload.cacheWrite,
    cost: typeof payload.cost === "number" ? payload.cost : payload.cost.total,
    routeResolutionId: payload.routeResolutionId ?? undefined,
    latencyMs: payload.latencyMs,
    ttftMs: payload.ttftMs ?? undefined,
    reasoningTokens: payload.reasoningTokens ?? undefined,
    outcome: payload.outcome,
    errorClass: payload.errorClass ?? undefined,
    retryOf: payload.retryOf ?? undefined,
    fallbackFrom: payload.fallbackFrom ?? undefined,
    rawRequestArtifact: payload.rawRequestArtifact,
    rawResponseArtifact: payload.rawResponseArtifact,
    entryId: payload.entryId ?? undefined,
  }
}
function agentTimelineInput(envelope: OutboxEnvelope, payload: AgentTimelinePayload): TimelineInput {
  validateTimeline(envelope, payload)
  return { id: payload.eventId, ts: payload.occurredAt, sourceSessionId: envelope.sessionId, sourceSeq: envelope.seq, agentId: payload.agentId, agentSeq: payload.agentSeq, agentSessionId: payload.agentSessionId ?? undefined, parentSessionId: payload.parentSessionId ?? undefined, parentAgentId: payload.parentAgentId ?? undefined, taskId: payload.taskId ?? undefined, packetId: payload.packetId ?? undefined, branchId: payload.branchId ?? undefined, turnId: payload.turnId ?? undefined, kind: payload.kind, fromState: payload.fromState ?? undefined, toState: payload.toState ?? undefined, reason: payload.reason ?? undefined, errorClass: payload.errorClass ?? undefined, detail: canonicalJson(payload.detail), artifacts: payload.artifacts.map((artifact, ordinal) => ({ ...artifact, ordinal })), payloadVersion: 1 }
}

function routeResolutionInput(envelope: OutboxEnvelope, payload: RouteResolutionPayload): RouteResolutionInput {
  validateRoute(envelope, payload)
  const timeline: TimelineInput = { id: `${payload.agentId}:event:${payload.agentSeq}`, ts: payload.occurredAt, sourceSessionId: envelope.sessionId, sourceSeq: envelope.seq, agentId: payload.agentId, agentSeq: payload.agentSeq, agentSessionId: payload.agentSessionId ?? undefined, parentSessionId: payload.parentSessionId ?? undefined, parentAgentId: payload.parentAgentId ?? undefined, taskId: payload.taskId ?? undefined, packetId: payload.packetId ?? undefined, branchId: payload.branchId ?? undefined, turnId: payload.turnId ?? undefined, kind: payload.changeKind, fromState: payload.changeKind === "spawn_resolved" ? "scheduled" : undefined, toState: payload.changeKind === "spawn_resolved" ? "resolved" : undefined, routeResolutionId: payload.resolutionId, reason: payload.reason ?? undefined, detail: canonicalJson({ fallbackFromResolutionId: payload.fallbackFromResolutionId, revertedFromResolutionId: payload.revertedFromResolutionId }), artifacts: [], payloadVersion: 1 }
  return { id: payload.resolutionId, ts: payload.occurredAt, sourceSessionId: envelope.sessionId, sourceSeq: envelope.seq, agentId: payload.agentId, agentSeq: payload.agentSeq, agentSessionId: payload.agentSessionId ?? undefined, parentSessionId: payload.parentSessionId ?? undefined, parentAgentId: payload.parentAgentId ?? undefined, taskId: payload.taskId ?? undefined, packetId: payload.packetId ?? undefined, branchId: payload.branchId ?? undefined, turnId: payload.turnId ?? undefined, changeKind: payload.changeKind, reason: payload.reason ?? undefined, lane: payload.route.lane, provider: payload.route.provider, upstreamProvider: payload.route.upstreamProvider ?? undefined, model: payload.route.model, accountKind: payload.route.account.kind, accountRef: payload.route.account.ref ?? undefined, accountProvenance: canonicalJson(payload.route.account.provenance), effort: payload.route.effort, winningLayer: payload.provenance.winningLayer, constraints: canonicalJson(payload.provenance.constraints), consultedSources: canonicalJson(payload.provenance.consultedSources), overriddenValues: canonicalJson(payload.provenance.overriddenValues), fallbackFromResolutionId: payload.fallbackFromResolutionId ?? undefined, revertedFromResolutionId: payload.revertedFromResolutionId ?? undefined, advisorMode: payload.advisors.length === 0 ? "none" : "composed", rawDecisionArtifactId: payload.rawDecisionArtifactId ?? undefined, candidates: payload.candidates.map((candidate) => ({ ordinal: candidate.ordinal, lane: candidate.lane, provider: candidate.provider, model: candidate.model, accountKind: candidate.account.kind, accountRef: candidate.account.ref ?? undefined, effort: candidate.effort, disposition: candidate.disposition, fallbackOrdinal: candidate.fallbackOrdinal ?? undefined, rejectionCode: candidate.rejectionCode ?? undefined, rejectionReason: candidate.rejectionReason ?? undefined, failedConstraintIds: canonicalJson(candidate.failedConstraintIds) })), advisors: payload.advisors.map((advisor) => ({ ordinal: advisor.ordinal, advisorAgentId: advisor.advisorAgentId ?? undefined, purpose: advisor.purpose, lane: advisor.lane, provider: advisor.provider, model: advisor.model, accountKind: advisor.account.kind, accountRef: advisor.account.ref ?? undefined, accountProvenance: canonicalJson(advisor.account.provenance), effort: advisor.effort, winningLayer: advisor.winningLayer, independenceRequired: advisor.independenceRequired, rawAdviceArtifactId: advisor.rawAdviceArtifactId ?? undefined })), artifacts: payload.artifacts.map((artifact, ordinal) => ({ ...artifact, ordinal })), timeline, payloadVersion: 1 }
}

function runnerEventInput(envelope: OutboxEnvelope, payload: RunnerEventPayload): OperationalEventInput {
  validateRunnerEvent(envelope, payload)
  return operationalEventInput("runnerEvent", envelope, payload.eventId, envelope.ts, {
    buildDigest: payload.runnerIdentity.buildRevision.digest,
    runnerInstanceId: payload.runnerIdentity.runnerInstance.runnerInstanceId,
    sessionId: payload.sessionId,
    ownerEpoch: payload.ownerEpoch,
    revision: payload.revision,
    sequence: payload.sequence,
    sessionRevision: payload.sessionRevision ?? undefined,
    commandId: payload.commandId,
    correlationId: payload.correlationId,
    causationId: payload.causationId ?? undefined,
    inputId: payload.inputId ?? undefined,
    attemptId: payload.attemptId ?? undefined,
    routeResolutionId: payload.routeResolutionId ?? undefined,
    quotaDecisionId: payload.quotaDecisionId ?? undefined,
    toolCallId: payload.toolCallId ?? undefined,
    entryId: payload.transcriptEntryId ?? undefined,
    viewId: payload.viewId ?? undefined,
    controllerEpoch: payload.controllerEpoch,
    durableSequence: payload.durableSequence ?? undefined,
    payload: canonicalJson(payload),
  })
}

function diagnosticOccurrenceInput(envelope: OutboxEnvelope, payload: DiagnosticOccurrencePayload): DiagnosticOccurrenceInput {
  validateDiagnosticOccurrence(envelope, payload)
  return {
    operational: operationalEventInput("diagnosticOccurrence", envelope, payload.diagnosticId, payload.occurredAt, {
      buildDigest: payload.buildDigest ?? undefined,
      runnerInstanceId: payload.runnerInstanceId ?? undefined,
      sessionId: payload.sessionId ?? undefined,
      branchId: payload.branchId ?? undefined,
      turnId: payload.turnId ?? undefined,
      entryId: payload.entryId ?? undefined,
      agentId: payload.agentId ?? undefined,
      ownerEpoch: payload.ownerEpoch ?? undefined,
      inputId: payload.inputId ?? undefined,
      attemptId: payload.attemptId ?? undefined,
      routeResolutionId: payload.routeResolutionId ?? undefined,
      diagnosticId: payload.diagnosticId,
      regressionId: payload.regressionId ?? undefined,
      redactionPolicyId: payload.redactionPolicyId,
      payload: canonicalJson(payload),
    }),
    diagnosticId: payload.diagnosticId,
    occurredAt: payload.occurredAt,
    failureClass: payload.failureClass,
    phase: payload.phase,
    message: payload.message,
    requestFingerprint: payload.requestFingerprint ?? undefined,
    buildDigest: payload.buildDigest ?? undefined,
    runnerInstanceId: payload.runnerInstanceId ?? undefined,
    runtimeIdentity: payload.runtimeIdentity,
    configHash: payload.configHash ?? undefined,
    manifestHash: payload.manifestHash ?? undefined,
    sessionId: payload.sessionId ?? undefined,
    branchId: payload.branchId ?? undefined,
    turnId: payload.turnId ?? undefined,
    entryId: payload.entryId ?? undefined,
    agentId: payload.agentId ?? undefined,
    routeResolutionId: payload.routeResolutionId ?? undefined,
    inputId: payload.inputId ?? undefined,
    attemptId: payload.attemptId ?? undefined,
    ownerEpoch: payload.ownerEpoch ?? undefined,
    explicitRoute: payload.explicitRoute ?? undefined,
    outcome: payload.outcome ?? undefined,
    causeDiagnosticId: payload.causeDiagnosticId ?? undefined,
    retryOfAttemptId: payload.retryOfAttemptId ?? undefined,
    fallbackResolutionId: payload.fallbackResolutionId ?? undefined,
    interventionCommandId: payload.interventionCommandId ?? undefined,
    regressionId: payload.regressionId ?? undefined,
    redactionPolicyId: payload.redactionPolicyId,
    payloadVersion: 1,
    artifacts: payload.artifacts.map((artifact, ordinal) => ({
      ordinal,
      role: artifact.role,
      artifactId: artifact.artifactId,
      sha256: artifact.sha256,
      redactionPolicyId: artifact.redactionPolicyId,
    })),
  }
}

function diagnosticProjectionInput(envelope: OutboxEnvelope, payload: DiagnosticProjectionPayload): DiagnosticProjectionInput {
  validateDiagnosticProjection(envelope, payload)
  return {
    operational: operationalEventInput("diagnosticProjection", envelope, payload.projectionEventId, payload.occurredAt, {
      sessionId: envelope.sessionId,
      commandId: payload.commandId ?? undefined,
      diagnosticId: payload.diagnosticId,
      payload: canonicalJson(payload),
    }),
    projectionEventId: payload.projectionEventId,
    diagnosticId: payload.diagnosticId,
    occurredAt: payload.occurredAt,
    state: payload.state,
    actor: payload.actor ?? undefined,
    commandId: payload.commandId ?? undefined,
    sourceEntryId: payload.sourceEntryId,
    payloadVersion: 1,
  }
}

function operationalEventInput(
  eventKind: OperationalEventInput["eventKind"],
  envelope: OutboxEnvelope,
  eventId: string,
  occurredAt: number,
  fields: Omit<OperationalEventInput, "eventId" | "eventKind" | "occurredAt" | "observedAt" | "producer" | "payloadVersion" | "sourceKind" | "sourceId" | "sourceSequence" | "sourceDigest">,
): OperationalEventInput {
  return {
    eventId,
    eventKind,
    occurredAt,
    observedAt: envelope.ts,
    producer: "omp.outbox",
    payloadVersion: 1,
    sourceKind: "outbox",
    sourceId: envelope.sessionId,
    sourceSequence: envelope.seq,
    sourceDigest: sourceDigest(envelope),
    ...fields,
  }
}

function genericPayloadOrError(envelope: OutboxEnvelope, rawLine: string, message: string): RowMapping {
  return payloadVersion(envelope.payload) !== 1
    ? { row: genericEvent(envelope, rawLine), malformed: false }
    : payloadErrorEvent(envelope, rawLine, message)
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function payloadVersion(value: JsonValue): number | undefined {
  if (!isJsonObject(value)) return undefined
  const version = value["payloadVersion"]
  return typeof version === "number" ? version : undefined
}

function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!isJsonObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]))
}

function sourceDigest(envelope: OutboxEnvelope): string {
  return createHash("sha256").update(canonicalJson({
    v: envelope.v,
    kind: envelope.kind,
    sessionId: envelope.sessionId,
    seq: envelope.seq,
    ts: envelope.ts,
    payload: envelope.payload,
  })).digest("hex")
}

function validateTimeline(envelope: OutboxEnvelope, payload: AgentTimelinePayload): void {
  const transition = {
    spawn_scheduled: [null, "scheduled"], spawn_started: ["resolved", "running"], interrupt: ["running", "interrupted"],
    cancel: ["nonterminal", "cancelled"], idle: ["running|interrupted|completed|failed", "idle"], park: ["idle", "parked"],
    adopt: ["parked", "parked"], revive: ["parked", "idle|running"], interrupted_by_restart: ["running|interrupted", "parked"],
    completed: ["running", "completed"], failed: ["nonterminal", "failed"],
  } as const
  const expected = transition[payload.kind]
  const matches = (actual: string | null, requirement: string | null): boolean => requirement === null
    ? actual === null
    : requirement === "nonterminal"
      ? actual !== null && !["cancelled", "completed", "failed"].includes(actual)
      : requirement.split("|").includes(actual ?? "")
  const detail = payload.detail
  if (
    !Number.isInteger(envelope.seq) || envelope.seq < 0 || !Number.isInteger(payload.agentSeq) || payload.agentSeq < 0 ||
    payload.eventId !== `${payload.agentId}:event:${payload.agentSeq}` || payload.occurredAt !== envelope.ts ||
    !matches(payload.fromState, expected[0]) || !matches(payload.toState, expected[1]) ||
    (payload.kind === "failed") !== (payload.errorClass !== null) ||
    (["interrupt", "cancel", "failed"].includes(payload.kind) && payload.reason === null) ||
    (payload.kind === "adopt" && (typeof detail["replacementSessionId"] !== "string" || typeof detail["recoveredJournalEntryId"] !== "string")) ||
    (payload.kind === "interrupted_by_restart" && (typeof detail["turnId"] !== "string" || typeof detail["restartId"] !== "string"))
  ) throw new Error("Invalid agent timeline payload")
}

function validateRoute(envelope: OutboxEnvelope, payload: RouteResolutionPayload): void {
  const selected = payload.candidates.filter((candidate) => candidate.disposition === "selected")
  const fallbackOrdinals = payload.candidates.filter((candidate) => candidate.disposition === "fallback").map((candidate) => candidate.fallbackOrdinal)
  const accountValid = (account: { readonly kind: string; readonly ref: string | null }): boolean =>
    (account.kind === "configured" && account.ref !== null) || (account.kind === "ambient") || (account.kind === "none" && account.ref === null)
  const candidateInvalid = payload.candidates.some((candidate, index) =>
    candidate.ordinal !== index || !accountValid(candidate.account) ||
    (candidate.disposition === "rejected" && (candidate.rejectionCode === null || candidate.rejectionReason === null)) ||
    (candidate.disposition !== "rejected" && (candidate.rejectionCode !== null || candidate.rejectionReason !== null)) ||
    (candidate.disposition === "fallback") !== (candidate.fallbackOrdinal !== null),
  )
  const advisorsInvalid = payload.advisors.some((advisor, index) => advisor.ordinal !== index || !accountValid(advisor.account))
  if (
    !Number.isInteger(envelope.seq) || envelope.seq < 0 || !Number.isInteger(payload.agentSeq) || payload.agentSeq < 0 ||
    payload.resolutionId !== `${payload.agentId}:route:${payload.agentSeq}` || payload.occurredAt !== envelope.ts || !accountValid(payload.route.account) ||
    candidateInvalid || advisorsInvalid || selected.length !== 1 ||
    selected[0]?.lane !== payload.route.lane || selected[0]?.provider !== payload.route.provider || selected[0]?.model !== payload.route.model ||
    selected[0]?.account.kind !== payload.route.account.kind || selected[0]?.account.ref !== payload.route.account.ref || selected[0]?.effort !== payload.route.effort ||
    fallbackOrdinals.some((ordinal, index) => ordinal !== index) || new Set(fallbackOrdinals).size !== fallbackOrdinals.length ||
    (payload.changeKind === "fallback") !== (payload.fallbackFromResolutionId !== null) ||
    (payload.changeKind === "revert") !== (payload.revertedFromResolutionId !== null) ||
    (["model_change", "thinking_change", "account_change", "hotswap", "fallback", "revert", "advisor_change"].includes(payload.changeKind) && payload.reason === null) ||
    (payload.advisors.length === 0 && payload.changeKind === "advisor_change" && payload.reason === null)
  ) throw new Error("Invalid route resolution payload")
}

function validateRunnerEvent(envelope: OutboxEnvelope, payload: RunnerEventPayload): void {
  validateSourceSequence(envelope)
  requireNonEmpty(payload.kind, "runnerEvent.kind")
  requireNonEmpty(payload.eventId, "runnerEvent.eventId")
  requireNonEmpty(payload.commandId, "runnerEvent.commandId")
  requireNonEmpty(payload.correlationId, "runnerEvent.correlationId")
  requireNonEmpty(payload.ownerEpoch, "runnerEvent.ownerEpoch")
  requireNonEmpty(payload.sessionId, "runnerEvent.sessionId")
  requireNonEmpty(payload.runnerIdentity.buildRevision.version, "runnerEvent.buildRevision.version")
  validateSha256(payload.runnerIdentity.buildRevision.digest, "runnerEvent.buildRevision.digest")
  requireNonEmpty(payload.runnerIdentity.runnerInstance.runnerInstanceId, "runnerEvent.runnerInstanceId")
  validateNonNegativeInteger(payload.runnerIdentity.runnerInstance.startedAt, "runnerEvent.runnerStartedAt")
  validateNonNegativeInteger(payload.revision, "runnerEvent.revision")
  validateNonNegativeInteger(payload.sequence, "runnerEvent.sequence")
  validateNonNegativeInteger(payload.controllerEpoch, "runnerEvent.controllerEpoch")
  validateNullableInteger(payload.sessionRevision, "runnerEvent.sessionRevision")
  validateNullableInteger(payload.durableSequence, "runnerEvent.durableSequence")
  validateNullableInteger(payload.transcriptPosition, "runnerEvent.transcriptPosition")
  validateNullableInteger(payload.targetGeneration, "runnerEvent.targetGeneration")
  validateNullableInteger(payload.targetOperationGeneration, "runnerEvent.targetOperationGeneration")
  if (payload.sessionId !== envelope.sessionId) {
    throw new Error("Invalid runner event payload")
  }
}

function validateDiagnosticOccurrence(envelope: OutboxEnvelope, payload: DiagnosticOccurrencePayload): void {
  validateSourceSequence(envelope)
  requireNonEmpty(payload.diagnosticId, "diagnosticOccurrence.diagnosticId")
  requireNonEmpty(payload.failureClass, "diagnosticOccurrence.failureClass")
  requireNonEmpty(payload.phase, "diagnosticOccurrence.phase")
  requireNonEmpty(payload.message, "diagnosticOccurrence.message")
  requireNonEmpty(payload.runtimeIdentity, "diagnosticOccurrence.runtimeIdentity")
  requireNonEmpty(payload.redactionPolicyId, "diagnosticOccurrence.redactionPolicyId")
  validateNullableSha256(payload.buildDigest, "diagnosticOccurrence.buildDigest")
  validateNullableSha256(payload.requestFingerprint, "diagnosticOccurrence.requestFingerprint")
  validateNullableSha256(payload.configHash, "diagnosticOccurrence.configHash")
  validateNullableSha256(payload.manifestHash, "diagnosticOccurrence.manifestHash")
  payload.artifacts.forEach((artifact, index) => {
    requireNonEmpty(artifact.role, `diagnosticOccurrence.artifacts[${index}].role`)
    requireNonEmpty(artifact.artifactId, `diagnosticOccurrence.artifacts[${index}].artifactId`)
    requireNonEmpty(artifact.redactionPolicyId, `diagnosticOccurrence.artifacts[${index}].redactionPolicyId`)
    validateSha256(artifact.sha256, `diagnosticOccurrence.artifacts[${index}].sha256`)
  })
  if (payload.occurredAt !== envelope.ts) {
    throw new Error("Invalid diagnostic occurrence payload")
  }
}

function validateDiagnosticProjection(envelope: OutboxEnvelope, payload: DiagnosticProjectionPayload): void {
  validateSourceSequence(envelope)
  requireNonEmpty(payload.projectionEventId, "diagnosticProjection.projectionEventId")
  requireNonEmpty(payload.diagnosticId, "diagnosticProjection.diagnosticId")
  requireNonEmpty(payload.sourceEntryId, "diagnosticProjection.sourceEntryId")
  if (payload.occurredAt !== envelope.ts) {
    throw new Error("Invalid diagnostic projection payload")
  }
}

function validateSourceSequence(envelope: OutboxEnvelope): void {
  if (!Number.isInteger(envelope.seq) || envelope.seq < 0) {
    throw new Error("Invalid outbox source sequence")
  }
}

function validateNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`invalid ${field}`)
  }
}

function validateNullableInteger(value: number | null, field: string): void {
  if (value !== null) {
    validateNonNegativeInteger(value, field)
  }
}

function requireNonEmpty(value: string, field: string): void {
  if (value.length === 0) {
    throw new Error(`invalid ${field}`)
  }
}

function validateSha256(value: string, field: string): void {
  if (!sha256Pattern.test(value)) {
    throw new Error(`invalid ${field}`)
  }
}

function validateNullableSha256(value: string | null, field: string): void {
  if (value !== null) {
    validateSha256(value, field)
  }
}

function rawRequestArtifactInput(
  envelope: OutboxEnvelope,
  payload: ModelCallPayload,
  rawDir: string,
): RawRequestArtifactInput | undefined {
  let content: string
  let reference: RawContentReferenceV1 | undefined
  if (payload.rawRequestRef !== undefined) {
    const decoded = Schema.decodeUnknownOption(RawContentReferenceV1Schema)(payload.rawRequestRef)
    if (decoded._tag === "Some") {
      reference = decoded.value
      try {
        const bytes = readFileSync(contentObjectPathFor(rawDir, reference.digest))
        const digest = createHash("sha256").update(bytes).digest("hex")
        if (bytes.byteLength !== reference.byteLength || digest !== reference.digest) {
          throw new Error("raw request content reference verification failed")
        }
        content = bytes.toString("utf8")
      } catch (cause) {
        if (payload.rawRequest === undefined) throw cause
        reference = undefined
        content = jsonText(payload.rawRequest)
      }
    } else {
      if (payload.rawRequest === undefined) throw new Error("invalid raw request content reference")
      content = jsonText(payload.rawRequest)
    }
  } else if (payload.rawRequest !== undefined) {
    content = jsonText(payload.rawRequest)
  } else {
    return undefined
  }

  return {
    content,
    meta: {
      ts: envelope.ts,
      sessionId: envelope.sessionId,
      kind: "rawRequest",
      retention: "default",
      meta: reference === undefined ? "{}" : JSON.stringify(reference),
    },
  }
}

function providerCallInput(envelope: OutboxEnvelope, payload: ProviderCallPayload): ProviderCallInput {
  return {
    id: payload.id ?? rowId(envelope),
    ts: payload.ts ?? envelope.ts,
    sessionId: payload.sessionId ?? envelope.sessionId,
    branchId: payload.branchId ?? undefined,
    packetId: payload.packetId ?? undefined,
    provider: payload.provider,
    operation: payload.operation,
    inputHash: payload.inputHash,
    rawRequestArtifact: payload.rawRequestArtifact ?? undefined,
    latencyMs: payload.latencyMs,
    outcome: payload.outcome,
    errorClass: payload.errorClass ?? undefined,
    cost: payload.cost ?? undefined,
    usage: payload.usage ?? undefined,
  }
}

function artifactInput(envelope: OutboxEnvelope, payload: ArtifactPayload): ArtifactContent & ArtifactMeta {
  const meta = {
    ts: envelope.ts,
    sessionId: payload.sessionId ?? envelope.sessionId,
    kind: payload.kind,
    retention: payload.retention,
    meta: payload.meta,
  }
  return "content" in payload ? { content: payload.content, ...meta } : { path: payload.path, ...meta }
}

function genericEvent(envelope: OutboxEnvelope, rawLine: string): BatchRow {
  return {
    kind: "event",
    payload: {
      id: rowId(envelope),
      ts: envelope.ts,
      sessionId: envelope.sessionId,
      seq: envelope.seq,
      kind: envelope.kind,
      payloadVersion: envelope.v,
      payload: rawLine,
    },
  }
}

function payloadErrorEvent(envelope: OutboxEnvelope, rawLine: string, message: string): RowMapping {
  return {
    row: {
      kind: "event",
      payload: {
        id: rowId(envelope),
        ts: envelope.ts,
        sessionId: envelope.sessionId,
        seq: envelope.seq,
        kind: "ingestError",
        payloadVersion: 1,
        payload: jsonText({ message, rawLine }),
      },
    },
    malformed: true,
  }
}

function malformedEvent(filePath: string, lineNumber: number, rawLine: string, message: string): RowMapping {
  return { row: { kind: "event", payload: { id: malformedEventId(filePath, lineNumber, rawLine), ts: 0, kind: "ingestError", payloadVersion: 1, payload: jsonText({ message, rawLine }) } }, malformed: true }
}

function isKnownOutboxKind(kind: string): kind is KnownOutboxKind {
  return kind === "session" || kind === "branch" || kind === "turn" || kind === "event" || kind === "modelCall" || kind === "providerCall" || kind === "artifact" || kind === "agentTimeline" || kind === "routeResolution" || kind === "relayLifecycle" || kind === "workLease" || kind === "runnerEvent" || kind === "diagnosticOccurrence" || kind === "diagnosticProjection"
}

function rowId(envelope: OutboxEnvelope): string {
  return `${envelope.sessionId}:${envelope.seq}`
}

function malformedEventId(filePath: string, lineNumber: number, rawLine: string): string {
  const digest = createHash("sha256").update(filePath).update("\0").update(String(lineNumber)).update("\0").update(rawLine).digest("hex")
  return `ingestError:${digest.slice(0, 32)}`
}

function jsonText(value: JsonValue): string {
  return JSON.stringify(value) ?? "null"
}

function normalizedBatchSize(batchSize: number | undefined): number {
  return batchSize === undefined ? DEFAULT_BATCH_SIZE : Math.max(1, Math.floor(batchSize))
}

function storageFailure(filePath: string, cause: unknown): StorageError {
  const message = errorMessage(cause)
  return new StorageError({
    operation: "ingestOutbox",
    message,
    cause: message,
    context: filePath,
  })
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
