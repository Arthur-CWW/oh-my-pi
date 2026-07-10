import { Effect, Schema } from "effect"

import { StorageError } from "./errors"
import { type LedgerStoreShape, LedgerStore } from "./ledger"
import { type RouteResolutionPayloadV1, RouteResolutionPayloadV1Schema, TimelineKindSchema } from "./omp-events"
import { JsonValueSchema, type JsonValue } from "./outbox"
import { type AgentTimelineEventRow, type ModelCallRow, type RouteResolutionRow } from "./schema"

const NullableStringSchema = Schema.Union([Schema.String, Schema.Null])

const HydratedTimelineSchema = Schema.Struct({
  agentId: Schema.String,
  agentSeq: Schema.Int,
  agentSessionId: NullableStringSchema,
  parentSessionId: NullableStringSchema,
  parentAgentId: NullableStringSchema,
  taskId: NullableStringSchema,
  packetId: NullableStringSchema,
  branchId: NullableStringSchema,
  turnId: NullableStringSchema,
  payloadVersion: Schema.Literal(1),
  eventId: Schema.String,
  occurredAt: Schema.Int,
  kind: TimelineKindSchema,
  fromState: NullableStringSchema,
  toState: NullableStringSchema,
  reason: NullableStringSchema,
  errorClass: NullableStringSchema,
  detail: Schema.Record(Schema.String, JsonValueSchema),
  artifacts: Schema.Array(Schema.Struct({ role: Schema.String, artifactId: Schema.String })),
})

export type HydratedTimelineEvent = Schema.Schema.Type<typeof HydratedTimelineSchema>

export interface AgentTimelineResult {
  readonly events: readonly HydratedTimelineEvent[]
  readonly nextAgentSeq: number | undefined
  readonly hasGap: boolean
}

export interface ResolvedRoute {
  readonly route: RouteResolutionPayloadV1
}

export function getAgentTimeline(agentId: string, afterAgentSeq?: number, limit = 200): Effect.Effect<AgentTimelineResult, StorageError, LedgerStore> {
  return Effect.gen(function* () {
    const store = yield* LedgerStore
    const rows = yield* store.listAgentTimelineRows(agentId, afterAgentSeq, limit)
    const events = yield* Effect.forEach(rows, (row) => hydrateTimeline(store, row))
    return { events, nextAgentSeq: rows.at(-1)?.agentSeq === undefined ? undefined : rows.at(-1)!.agentSeq + 1, hasGap: rows.some((row, index) => index > 0 && row.agentSeq !== rows[index - 1]!.agentSeq + 1) }
  })
}

export function getCurrentAgentStates(parentAgentId?: string): Effect.Effect<readonly HydratedTimelineEvent[], StorageError, LedgerStore> {
  return Effect.gen(function* () {
    const store = yield* LedgerStore
    return yield* Effect.forEach(yield* store.listCurrentAgentStateRows(parentAgentId), (row) => hydrateTimeline(store, row))
  })
}

export function getResolvedRoute(resolutionId: string): Effect.Effect<ResolvedRoute | undefined, StorageError, LedgerStore> {
  return Effect.gen(function* () {
    const store = yield* LedgerStore
    const row = yield* store.getRouteResolutionRow(resolutionId)
    return row === undefined ? undefined : yield* hydrateRoute(store, row)
  })
}

export function getAgentRouteTimeline(agentId: string): Effect.Effect<readonly ResolvedRoute[], StorageError, LedgerStore> {
  return Effect.gen(function* () {
    const store = yield* LedgerStore
    return yield* Effect.forEach(yield* store.listAgentRouteRows(agentId), (row) => hydrateRoute(store, row))
  })
}

export function getPacketRouteTimeline(packetId: string): Effect.Effect<readonly ResolvedRoute[], StorageError, LedgerStore> {
  return Effect.gen(function* () {
    const store = yield* LedgerStore
    return yield* Effect.forEach(yield* store.listPacketRouteRows(packetId), (row) => hydrateRoute(store, row))
  })
}

export function getRestartRecoveryTimeline(agentId: string): Effect.Effect<readonly HydratedTimelineEvent[], StorageError, LedgerStore> {
  return Effect.gen(function* () {
    const store = yield* LedgerStore
    return yield* Effect.forEach(yield* store.listRestartRecoveryRows(agentId), (row) => hydrateTimeline(store, row))
  })
}

export function getModelCallsForResolution(resolutionId: string): Effect.Effect<readonly ModelCallRow[], StorageError, LedgerStore> {
  return Effect.gen(function* () {
    return yield* (yield* LedgerStore).listModelCallResolutionRows(resolutionId)
  })
}

function hydrateTimeline(store: LedgerStoreShape, row: AgentTimelineEventRow): Effect.Effect<HydratedTimelineEvent, StorageError> {
  return Effect.map(store.listRouteArtifactRows("agentEvent", row.id), (artifacts) => Schema.decodeUnknownSync(HydratedTimelineSchema)({ agentId: row.agentId, agentSeq: row.agentSeq, agentSessionId: row.agentSessionId, parentSessionId: row.parentSessionId, parentAgentId: row.parentAgentId, taskId: row.taskId, packetId: row.packetId, branchId: row.branchId, turnId: row.turnId, payloadVersion: row.payloadVersion, eventId: row.id, occurredAt: row.ts, kind: row.kind, fromState: row.fromState, toState: row.toState, reason: row.reason, errorClass: row.errorClass, detail: parseJson(row.detail), artifacts: artifacts.map((artifact) => ({ role: artifact.role, artifactId: artifact.artifactId })) }))
}

function hydrateRoute(store: LedgerStoreShape, row: RouteResolutionRow): Effect.Effect<ResolvedRoute, StorageError> {
  return Effect.map(Effect.all([store.listRouteCandidateRows(row.id), store.listRouteAdvisorRows(row.id), store.listRouteArtifactRows("routeResolution", row.id)]), ([candidates, advisors, artifacts]) => ({ route: Schema.decodeUnknownSync(RouteResolutionPayloadV1Schema)({ agentId: row.agentId, agentSeq: row.agentSeq, agentSessionId: row.agentSessionId, parentSessionId: row.parentSessionId, parentAgentId: row.parentAgentId, taskId: row.taskId, packetId: row.packetId, branchId: row.branchId, turnId: row.turnId, payloadVersion: row.payloadVersion, resolutionId: row.id, occurredAt: row.ts, changeKind: row.changeKind, reason: row.reason, route: { lane: row.lane, provider: row.provider, upstreamProvider: row.upstreamProvider, model: row.model, account: { kind: row.accountKind, ref: row.accountRef, provenance: parseJson(row.accountProvenance) }, effort: row.effort }, provenance: { winningLayer: row.winningLayer, constraints: parseJson(row.constraints), consultedSources: parseJson(row.consultedSources), overriddenValues: parseJson(row.overriddenValues) }, candidates: candidates.map((candidate) => ({ ordinal: candidate.ordinal, lane: candidate.lane, provider: candidate.provider, model: candidate.model, account: { kind: candidate.accountKind, ref: candidate.accountRef, provenance: {} }, effort: candidate.effort, disposition: candidate.disposition, fallbackOrdinal: candidate.fallbackOrdinal, rejectionCode: candidate.rejectionCode, rejectionReason: candidate.rejectionReason, failedConstraintIds: parseJson(candidate.failedConstraintIds) })), fallbackFromResolutionId: row.fallbackFromResolutionId, revertedFromResolutionId: row.revertedFromResolutionId, advisors: advisors.map((advisor) => ({ ordinal: advisor.ordinal, advisorAgentId: advisor.advisorAgentId, purpose: advisor.purpose, lane: advisor.lane, provider: advisor.provider, model: advisor.model, account: { kind: advisor.accountKind, ref: advisor.accountRef, provenance: parseJson(advisor.accountProvenance) }, effort: advisor.effort, winningLayer: advisor.winningLayer, independenceRequired: advisor.independenceRequired, rawAdviceArtifactId: advisor.rawAdviceArtifactId })), rawDecisionArtifactId: row.rawDecisionArtifactId, artifacts: artifacts.map((artifact) => ({ role: artifact.role, artifactId: artifact.artifactId })) }) }))
}

function parseJson(text: string): JsonValue {
  return JSON.parse(text) as JsonValue
}
