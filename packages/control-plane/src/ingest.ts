import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import { Effect, Schema } from "effect"

import { ArtifactError, StorageError } from "./errors"
import {
  type ArtifactContent,
  type ArtifactMeta,
  type BatchRow,
  type BranchInput,
  type EventInput,
  LedgerStore,
  type ModelCallInput,
  type ProviderCallInput,
  type SessionInput,
  type TurnInput,
} from "./ledger"
import { type JsonValue, JsonValueSchema, type KnownOutboxKind, OutboxEnvelopeSchema, type OutboxEnvelope } from "./outbox"

const DEFAULT_BATCH_SIZE = 500

export interface IngestOutboxOptions {
  readonly batchSize?: number
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
  cost: Schema.Number,
  latencyMs: Schema.Number,
  outcome: Schema.String,
  errorClass: OptionalString,
  retryOf: OptionalString,
  fallbackFrom: OptionalString,
  rawRequestArtifact: Schema.String,
  rawResponseArtifact: Schema.String,
  entryId: OptionalString,
  rawRequestSupport: OptionalString,
  rawRequest: Schema.optionalKey(JsonValueSchema),
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

type RowMapping = {
  readonly row: BatchRow
  readonly malformed: boolean
  readonly rawRequestArtifact?: RawRequestArtifactInput
}

interface RawRequestArtifactInput {
  readonly content: string
  readonly meta: ArtifactMeta
}

export function ingestOutbox(
  filePath: string,
  options: IngestOutboxOptions = {},
): Effect.Effect<IngestOutboxResult, StorageError | ArtifactError, LedgerStore> {
  return Effect.gen(function* () {
    const store = yield* LedgerStore
    const content = yield* Effect.try({
      try: () => readFileSync(filePath, "utf8"),
      catch: (cause) => new StorageError({ operation: "ingestOutbox", message: errorMessage(cause), cause: errorMessage(cause), context: filePath }),
    })
    const rows: BatchRow[] = []
    let malformed = 0
    let materializedInserted = 0
    let materializedIgnored = 0
    const lines = content.split("\n")

    for (let index = 0; index < lines.length; index += 1) {
      const rawLine = lines[index]
      if (rawLine === "") continue
      const mapping = mapLine(filePath, index + 1, rawLine)
      if (mapping.rawRequestArtifact !== undefined && mapping.row.kind === "modelCall") {
        const artifact = yield* store.putArtifact({ content: mapping.rawRequestArtifact.content }, mapping.rawRequestArtifact.meta)
        if (artifact.inserted) {
          materializedInserted += 1
        } else {
          materializedIgnored += 1
        }
        rows.push({ kind: "modelCall", payload: { ...mapping.row.payload, rawRequestArtifact: artifact.id } })
      } else {
        rows.push(mapping.row)
      }
      if (mapping.malformed) malformed += 1
    }

    let inserted = materializedInserted
    let ignored = materializedIgnored
    const batchSize = normalizedBatchSize(options.batchSize)
    for (let index = 0; index < rows.length; index += batchSize) {
      const result = yield* store.ingestBatch(rows.slice(index, index + batchSize))
      inserted += result.inserted
      ignored += result.ignored
    }

    return { inserted, ignored, malformed }
  })
}

function mapLine(filePath: string, lineNumber: number, rawLine: string): RowMapping {
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

  return mapKnownEnvelopeRow(envelope, envelope.kind, rawLine)
}

function mapKnownEnvelopeRow(envelope: OutboxEnvelope, kind: KnownOutboxKind, rawLine: string): RowMapping {
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
      return payload._tag === "Some" ? { row: { kind, payload: eventInput(envelope, payload.value) }, malformed: false } : payloadErrorEvent(envelope, rawLine, "event payload schema mismatch")
    }
    case "modelCall": {
      const payload = Schema.decodeUnknownOption(ModelCallPayloadSchema)(envelope.payload, { onExcessProperty: "ignore" })
      if (payload._tag !== "Some") {
        return payloadErrorEvent(envelope, rawLine, "modelCall payload schema mismatch")
      }
      return {
        row: { kind, payload: modelCallInput(envelope, payload.value) },
        malformed: false,
        rawRequestArtifact: rawRequestArtifactInput(envelope, payload.value),
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
    cost: payload.cost,
    latencyMs: payload.latencyMs,
    outcome: payload.outcome,
    errorClass: payload.errorClass ?? undefined,
    retryOf: payload.retryOf ?? undefined,
    fallbackFrom: payload.fallbackFrom ?? undefined,
    rawRequestArtifact: payload.rawRequestArtifact,
    rawResponseArtifact: payload.rawResponseArtifact,
    entryId: payload.entryId ?? undefined,
  }
}

function rawRequestArtifactInput(envelope: OutboxEnvelope, payload: ModelCallPayload): RawRequestArtifactInput | undefined {
  if (payload.rawRequestSupport !== "captured" || payload.rawRequest === undefined) {
    return undefined
  }

  return {
    content: jsonText(payload.rawRequest),
    meta: {
      ts: envelope.ts,
      sessionId: envelope.sessionId,
      kind: "rawRequest",
      retention: "default",
      meta: "{}",
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
  return {
    row: {
      kind: "event",
      payload: {
        id: malformedEventId(filePath, lineNumber, rawLine),
        ts: 0,
        kind: "ingestError",
        payloadVersion: 1,
        payload: jsonText({ message, rawLine }),
      },
    },
    malformed: true,
  }
}


function isKnownOutboxKind(kind: string): kind is KnownOutboxKind {
  return kind === "session" || kind === "branch" || kind === "turn" || kind === "event" || kind === "modelCall" || kind === "providerCall" || kind === "artifact"
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

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
