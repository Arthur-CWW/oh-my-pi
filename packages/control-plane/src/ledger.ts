import { createHash } from "node:crypto"
import { mkdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { homedir } from "node:os"

import { Database } from "bun:sqlite"
import { Context, Effect, Layer } from "effect"
import { and, desc, eq, gte, isNull } from "drizzle-orm"
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"

import { ArtifactError, StorageError } from "./errors"
import { migrateLedger, setDurabilityPragmas } from "./migrate"
import { agentTimelineEvents, artifacts, branches, events, modelCalls, providerCalls, routeAdvisors, routeCandidates, routeEventArtifacts, routeResolutions, sessions, turns, type AgentTimelineEventRow, type ArtifactRow, type EventRow, type ModelCallRow, type RouteAdvisorRow, type RouteCandidateRow, type RouteEventArtifactRow, type RouteResolutionRow } from "./schema"

export interface InsertResult {
  readonly inserted: boolean
}

export interface AttributeResult {
  readonly updated: boolean
}

export interface SessionInput {
  readonly id: string
  readonly machine: string
  readonly harness: string
  readonly workspace: string
  readonly title: string
  readonly status: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly meta: string
}

export interface BranchInput {
  readonly id: string
  readonly sessionId: string
  readonly parentBranchId?: string
  readonly kind: string
  readonly atTurn?: number
  readonly createdAt: number
  readonly meta: string
}

export interface TurnInput {
  readonly id: string
  readonly sessionId: string
  readonly branchId: string
  readonly seq: number
  readonly startedAt: number
  readonly endedAt?: number
  readonly contextTokens: number
  readonly toolCalls: number
  readonly toolCallSummary?: string
  readonly editBytes: number
  readonly turnDurationMs: number
  readonly yieldKind: string
  readonly affectSelfReport?: string
  readonly affectSignals?: string
}

export interface EventInput {
  readonly id: string
  readonly ts: number
  readonly sessionId?: string
  readonly seq?: number
  readonly branchId?: string
  readonly packetId?: string
  readonly kind: string
  readonly payloadVersion: number
  readonly payload: string
}

export interface ModelCallInput {
  readonly id: string
  readonly ts: number
  readonly machine: string
  readonly session: string
  readonly entryId?: string
  readonly branchId: string
  readonly agent: string
  readonly model: string
  readonly provider: string
  readonly upstreamProvider?: string
  readonly effort: string
  readonly promptHash: string
  readonly systemPromptHash: string
  readonly skillProfile: string
  readonly contextManifest: string
  readonly packetId: string
  readonly tokensIn: number
  readonly tokensOut: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly cost: number
  readonly latencyMs: number
  readonly ttftMs?: number
  readonly reasoningTokens?: number
  readonly outcome: string
  readonly errorClass?: string
  readonly retryOf?: string
  readonly fallbackFrom?: string
  readonly rawRequestArtifact: string
  readonly rawResponseArtifact: string
  readonly routeResolutionId?: string
}

export interface TimelineInput {
  readonly id: string; readonly ts: number; readonly sourceSessionId: string; readonly sourceSeq: number; readonly agentId: string; readonly agentSeq: number; readonly agentSessionId?: string; readonly parentSessionId?: string; readonly parentAgentId?: string; readonly taskId?: string; readonly packetId?: string; readonly branchId?: string; readonly turnId?: string; readonly kind: string; readonly fromState?: string; readonly toState?: string; readonly routeResolutionId?: string; readonly reason?: string; readonly errorClass?: string; readonly detail: string; readonly artifacts: readonly RouteArtifactInput[]; readonly payloadVersion: 1
}
export interface RouteCandidateInput { readonly ordinal: number; readonly lane: string; readonly provider: string; readonly model: string; readonly accountKind: string; readonly accountRef?: string; readonly effort: string; readonly disposition: string; readonly fallbackOrdinal?: number; readonly rejectionCode?: string; readonly rejectionReason?: string; readonly failedConstraintIds: string }
export interface RouteAdvisorInput { readonly ordinal: number; readonly advisorAgentId?: string; readonly purpose: string; readonly lane: string; readonly provider: string; readonly model: string; readonly accountKind: string; readonly accountRef?: string; readonly accountProvenance: string; readonly effort: string; readonly winningLayer: string; readonly independenceRequired: boolean; readonly rawAdviceArtifactId?: string }
export interface RouteArtifactInput { readonly ordinal: number; readonly role: string; readonly artifactId: string }
export interface RouteResolutionInput extends Omit<TimelineInput, "id" | "kind" | "fromState" | "toState" | "routeResolutionId" | "errorClass" | "detail"> {
  readonly id: string; readonly changeKind: string; readonly lane: string; readonly provider: string; readonly upstreamProvider?: string; readonly model: string; readonly accountKind: string; readonly accountRef?: string; readonly accountProvenance: string; readonly effort: string; readonly winningLayer: string; readonly constraints: string; readonly consultedSources: string; readonly overriddenValues: string; readonly fallbackFromResolutionId?: string; readonly revertedFromResolutionId?: string; readonly advisorMode: string; readonly rawDecisionArtifactId?: string; readonly candidates: readonly RouteCandidateInput[]; readonly advisors: readonly RouteAdvisorInput[]; readonly artifacts: readonly RouteArtifactInput[]; readonly timeline: TimelineInput
}

export interface ProviderCallInput {
  readonly id: string
  readonly ts: number
  readonly sessionId: string
  readonly branchId?: string
  readonly packetId?: string
  readonly provider: string
  readonly operation: string
  readonly inputHash: string
  readonly rawRequestArtifact?: string
  readonly latencyMs: number
  readonly outcome: string
  readonly errorClass?: string
  readonly cost?: number
  readonly usage?: string
}

export type ArtifactContent =
  | { readonly content: string | Uint8Array; readonly path?: never }
  | { readonly path: string; readonly content?: never }

export interface ArtifactMeta {
  readonly ts: number
  readonly sessionId?: string
  readonly kind: string
  readonly retention: string
  readonly meta: string
}

export interface ArtifactRecord {
  readonly id: string
  readonly ts: number
  readonly sessionId?: string
  readonly kind: string
  readonly contentPath?: string
  readonly contentInline?: string
  readonly sha256: string
  readonly bytes: number
  readonly retention: string
  readonly meta: string
}

export interface PutArtifactResult extends InsertResult {
  readonly id: string
  readonly sha256: string
  readonly bytes: number
}

export interface StatusSummary {
  readonly sessionsByStatus: readonly { readonly status: string; readonly count: number }[]
  readonly counts: {
    readonly sessions: number
    readonly branches: number
    readonly turns: number
    readonly events: number
    readonly modelCalls: number
    readonly providerCalls: number
    readonly artifacts: number
    readonly packets: number
    readonly commits: number
  }
  readonly lastActivity: number | null
}

export interface ModelCallFilters {
  readonly session?: string
  readonly model?: string
  readonly provider?: string
  readonly entryId?: string
  readonly outcome?: string
  readonly sinceTs?: number
  readonly limit?: number
}

export interface EventFilters {
  readonly sessionId?: string
  readonly branchId?: string
  readonly packetId?: string
  readonly kind?: string
  readonly sinceTs?: number
  readonly limit?: number
}

export interface TimelineSourceCursor {
  readonly sourceSessionId: string
  readonly sourceSeq: number
}

export type BatchRow =
  | { readonly kind: "session"; readonly payload: SessionInput }
  | { readonly kind: "branch"; readonly payload: BranchInput }
  | { readonly kind: "turn"; readonly payload: TurnInput }
  | { readonly kind: "event"; readonly payload: EventInput }
  | { readonly kind: "modelCall"; readonly payload: ModelCallInput }
  | { readonly kind: "providerCall"; readonly payload: ProviderCallInput }
  | { readonly kind: "artifact"; readonly payload: ArtifactContent & ArtifactMeta }
  | { readonly kind: "agentTimeline"; readonly payload: TimelineInput }
  | { readonly kind: "routeResolution"; readonly payload: RouteResolutionInput }

export interface BatchResult {
  readonly inserted: number
  readonly ignored: number
}

export interface LedgerStoreShape {
  readonly dbPath: string
  readonly upsertSession: (input: SessionInput) => Effect.Effect<InsertResult, StorageError>
  readonly recordBranch: (input: BranchInput) => Effect.Effect<InsertResult, StorageError>
  readonly recordTurn: (input: TurnInput) => Effect.Effect<InsertResult, StorageError>
  readonly publishEvent: (input: EventInput) => Effect.Effect<InsertResult, StorageError>
  readonly recordModelCall: (input: ModelCallInput) => Effect.Effect<InsertResult, StorageError>
  readonly attributeModelCall: (modelCallId: string, entryId: string) => Effect.Effect<AttributeResult, StorageError>
  readonly recordProviderCall: (input: ProviderCallInput) => Effect.Effect<InsertResult, StorageError>
  readonly putArtifact: (content: ArtifactContent, meta: ArtifactMeta) => Effect.Effect<PutArtifactResult, ArtifactError>
  readonly ingestBatch: (rows: readonly BatchRow[]) => Effect.Effect<BatchResult, StorageError | ArtifactError>
  readonly statusSummary: () => Effect.Effect<StatusSummary, StorageError>
  readonly listModelCalls: (filters: ModelCallFilters) => Effect.Effect<ModelCallRow[], StorageError>
  readonly listEvents: (filters: EventFilters) => Effect.Effect<EventRow[], StorageError>
  readonly getArtifact: (id: string) => Effect.Effect<ArtifactRecord & { readonly content: string }, StorageError | ArtifactError>
  readonly close: () => void
  readonly listAgentTimelineRows: (agentId: string, afterAgentSeq?: number, limit?: number) => Effect.Effect<AgentTimelineEventRow[], StorageError>
  readonly listTimelineRowsAfterSource: (cursor: TimelineSourceCursor | undefined, limit: number) => Effect.Effect<AgentTimelineEventRow[], StorageError>
  readonly listCurrentAgentStateRows: (parentAgentId?: string) => Effect.Effect<AgentTimelineEventRow[], StorageError>
  readonly getRouteResolutionRow: (id: string) => Effect.Effect<RouteResolutionRow | undefined, StorageError>
  readonly listRouteCandidateRows: (resolutionId: string) => Effect.Effect<RouteCandidateRow[], StorageError>
  readonly listRouteAdvisorRows: (resolutionId: string) => Effect.Effect<RouteAdvisorRow[], StorageError>
  readonly listRouteArtifactRows: (ownerKind: "agentEvent" | "routeResolution", ownerId: string) => Effect.Effect<RouteEventArtifactRow[], StorageError>
  readonly listAgentRouteRows: (agentId: string) => Effect.Effect<RouteResolutionRow[], StorageError>
  readonly listPacketRouteRows: (packetId: string) => Effect.Effect<RouteResolutionRow[], StorageError>
  readonly listRestartRecoveryRows: (agentId: string) => Effect.Effect<AgentTimelineEventRow[], StorageError>
  readonly listModelCallResolutionRows: (resolutionId: string) => Effect.Effect<ModelCallRow[], StorageError>
}

export class LedgerStore extends Context.Service<LedgerStore, LedgerStoreShape>()("ControlPlane/LedgerStore") {}

type LedgerDb = BunSQLiteDatabase

export function defaultLedgerPath(env: Record<string, string | undefined> = process.env): string {
  return env["AGENT_CONTROL_PLANE_DB"] ?? join(homedir(), ".agent-control-plane", "ledger.sqlite")
}

export function openLedger(dbPath: string): Layer.Layer<LedgerStore, StorageError> {
  return Layer.effect(
    LedgerStore,
    Effect.acquireRelease(
      Effect.try({
        try: () => makeLedgerStore(dbPath),
        catch: (cause) => storageError("openLedger", cause, dbPath),
      }),
      (store) => Effect.sync(() => store.close()),
    ),
  )
}

function makeLedgerStore(dbPath: string): LedgerStoreShape {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(resolve(dbPath)), { recursive: true })
  }

  const sqlite = new Database(dbPath)
  setDurabilityPragmas(sqlite)
  migrateLedger(sqlite)
  const db = drizzle(sqlite)

  return {
    dbPath,
    upsertSession: Effect.fn("LedgerStore.upsertSession")((input: SessionInput) =>
      storageEffect("upsertSession", () => insertSession(db, input)),
    ),
    recordBranch: Effect.fn("LedgerStore.recordBranch")((input: BranchInput) =>
      storageEffect("recordBranch", () => insertBranch(db, input)),
    ),
    recordTurn: Effect.fn("LedgerStore.recordTurn")((input: TurnInput) =>
      storageEffect("recordTurn", () => insertTurn(db, input)),
    ),
    publishEvent: Effect.fn("LedgerStore.publishEvent")((input: EventInput) =>
      storageEffect("publishEvent", () => insertEvent(db, input)),
    ),
    recordModelCall: Effect.fn("LedgerStore.recordModelCall")((input: ModelCallInput) =>
      storageEffect("recordModelCall", () => insertModelCall(db, input)),
    ),
    attributeModelCall: Effect.fn("LedgerStore.attributeModelCall")((modelCallId: string, entryId: string) =>
      storageEffect("attributeModelCall", () => updateModelCallAttribution(db, modelCallId, entryId)),
    ),
    recordProviderCall: Effect.fn("LedgerStore.recordProviderCall")((input: ProviderCallInput) =>
      storageEffect("recordProviderCall", () => insertProviderCall(db, input)),
    ),
    putArtifact: Effect.fn("LedgerStore.putArtifact")((content: ArtifactContent, meta: ArtifactMeta) =>
      artifactEffect("putArtifact", () => insertArtifact(db, content, meta)),
    ),
    ingestBatch: Effect.fn("LedgerStore.ingestBatch")((rows: readonly BatchRow[]) =>
      Effect.try({
        try: () => db.transaction((tx) => {
          let inserted = 0
          let ignored = 0
          for (const row of rows) {
            const result = insertBatchRow(tx, row)
            if (result.inserted) {
              inserted += 1
            } else {
              ignored += 1
            }
          }
          return { inserted, ignored }
        }),
        catch: (cause) => storageError("ingestBatch", cause),
      }),
    ),
    statusSummary: Effect.fn("LedgerStore.statusSummary")(() => storageEffect("statusSummary", () => readStatusSummary(sqlite))),
    listModelCalls: Effect.fn("LedgerStore.listModelCalls")((filters: ModelCallFilters) =>
      storageEffect("listModelCalls", () => listModelCallRows(db, filters)),
    ),
    listEvents: Effect.fn("LedgerStore.listEvents")((filters: EventFilters) =>
      storageEffect("listEvents", () => listEventRows(db, filters)),
    ),
    listAgentTimelineRows: Effect.fn("LedgerStore.listAgentTimelineRows")((agentId: string, afterAgentSeq?: number, limit?: number) => storageEffect("listAgentTimelineRows", () => listAgentTimelineRows(db, agentId, afterAgentSeq, limit))),
    listTimelineRowsAfterSource: Effect.fn("LedgerStore.listTimelineRowsAfterSource")((cursor: TimelineSourceCursor | undefined, limit: number) => storageEffect("listTimelineRowsAfterSource", () => listTimelineRowsAfterSource(sqlite, cursor, limit))),
    listCurrentAgentStateRows: Effect.fn("LedgerStore.listCurrentAgentStateRows")((parentAgentId?: string) => storageEffect("listCurrentAgentStateRows", () => listCurrentAgentStateRows(sqlite, parentAgentId))),
    getRouteResolutionRow: Effect.fn("LedgerStore.getRouteResolutionRow")((id: string) => storageEffect("getRouteResolutionRow", () => db.select().from(routeResolutions).where(eq(routeResolutions.id, id)).get())),
    listRouteCandidateRows: Effect.fn("LedgerStore.listRouteCandidateRows")((id: string) => storageEffect("listRouteCandidateRows", () => db.select().from(routeCandidates).where(eq(routeCandidates.routeResolutionId, id)).orderBy(routeCandidates.ordinal).all())),
    listRouteAdvisorRows: Effect.fn("LedgerStore.listRouteAdvisorRows")((id: string) => storageEffect("listRouteAdvisorRows", () => db.select().from(routeAdvisors).where(eq(routeAdvisors.routeResolutionId, id)).orderBy(routeAdvisors.ordinal).all())),
    listRouteArtifactRows: Effect.fn("LedgerStore.listRouteArtifactRows")((ownerKind: "agentEvent" | "routeResolution", ownerId: string) => storageEffect("listRouteArtifactRows", () => db.select().from(routeEventArtifacts).where(and(eq(routeEventArtifacts.ownerKind, ownerKind), eq(routeEventArtifacts.ownerId, ownerId))).orderBy(routeEventArtifacts.ordinal).all())),
    listAgentRouteRows: Effect.fn("LedgerStore.listAgentRouteRows")((agentId: string) => storageEffect("listAgentRouteRows", () => db.select().from(routeResolutions).where(eq(routeResolutions.agentId, agentId)).orderBy(routeResolutions.agentSeq).all())),
    listPacketRouteRows: Effect.fn("LedgerStore.listPacketRouteRows")((packetId: string) => storageEffect("listPacketRouteRows", () => db.select().from(routeResolutions).where(eq(routeResolutions.packetId, packetId)).orderBy(routeResolutions.ts, routeResolutions.sourceSessionId, routeResolutions.sourceSeq).all())),
    listRestartRecoveryRows: Effect.fn("LedgerStore.listRestartRecoveryRows")((agentId: string) => storageEffect("listRestartRecoveryRows", () => listRestartRecoveryRows(sqlite, agentId))),
    listModelCallResolutionRows: Effect.fn("LedgerStore.listModelCallResolutionRows")((id: string) => storageEffect("listModelCallResolutionRows", () => db.select().from(modelCalls).where(eq(modelCalls.routeResolutionId, id)).orderBy(modelCalls.ts, modelCalls.id).all())),
    getArtifact: Effect.fn("LedgerStore.getArtifact")((id: string) =>
      Effect.try({
        try: () => readArtifact(db, id),
        catch: (cause) => artifactError("getArtifact", cause, id),
      }),
    ),
    close: () => sqlite.close(),
  }
}

function insertBatchRow(db: LedgerDb, row: BatchRow): InsertResult {
  switch (row.kind) {
    case "session":
      return insertSession(db, row.payload)
    case "branch":
      return insertBranch(db, row.payload)
    case "turn":
      return insertTurn(db, row.payload)
    case "event":
      return insertEvent(db, row.payload)
    case "modelCall":
      return insertModelCall(db, row.payload)
    case "providerCall":
      return insertProviderCall(db, row.payload)
    case "artifact":
      return insertArtifact(db, row.payload, row.payload)
    case "agentTimeline":
      return insertAgentTimeline(db, row.payload)
    case "routeResolution":
      return insertRouteResolution(db, row.payload)
  }
}

function insertSession(db: LedgerDb, input: SessionInput): InsertResult {
  const rows = db.insert(sessions).values(input).onConflictDoNothing().returning({ id: sessions.id }).all()
  return { inserted: rows.length > 0 }
}

function insertBranch(db: LedgerDb, input: BranchInput): InsertResult {
  const result = db.insert(branches).values({
    id: input.id,
    sessionId: input.sessionId,
    parentBranchId: input.parentBranchId ?? null,
    kind: input.kind,
    atTurn: input.atTurn ?? null,
    createdAt: input.createdAt,
    meta: input.meta,
  }).onConflictDoNothing().returning({ id: branches.id }).all()
  return { inserted: result.length > 0 }
}

function insertTurn(db: LedgerDb, input: TurnInput): InsertResult {
  const result = db.insert(turns).values({
    id: input.id,
    sessionId: input.sessionId,
    branchId: input.branchId,
    seq: input.seq,
    startedAt: input.startedAt,
    endedAt: input.endedAt ?? null,
    contextTokens: input.contextTokens,
    toolCalls: input.toolCalls,
    toolCallSummary: input.toolCallSummary ?? null,
    editBytes: input.editBytes,
    turnDurationMs: input.turnDurationMs,
    yieldKind: input.yieldKind,
    affectSelfReport: input.affectSelfReport ?? null,
    affectSignals: input.affectSignals ?? null,
  }).onConflictDoNothing().returning({ id: turns.id }).all()
  return { inserted: result.length > 0 }
}

function insertEvent(db: LedgerDb, input: EventInput): InsertResult {
  const result = db.insert(events).values({
    id: input.id,
    ts: input.ts,
    sessionId: input.sessionId ?? null,
    seq: input.seq ?? null,
    branchId: input.branchId ?? null,
    packetId: input.packetId ?? null,
    kind: input.kind,
    payloadVersion: input.payloadVersion,
    payload: input.payload,
  }).onConflictDoNothing().returning({ id: events.id }).all()
  return { inserted: result.length > 0 }
}


function insertModelCall(db: LedgerDb, input: ModelCallInput): InsertResult {
  if (input.routeResolutionId !== undefined && db.select().from(routeResolutions).where(eq(routeResolutions.id, input.routeResolutionId)).get() === undefined) {
    throw new Error("Model call route resolution does not exist")
  }
  const result = db.insert(modelCalls).values({
    ...input,
    entryId: input.entryId ?? null,
    upstreamProvider: input.upstreamProvider ?? null,
    errorClass: input.errorClass ?? null,
    retryOf: input.retryOf ?? null,
    fallbackFrom: input.fallbackFrom ?? null,
    ttftMs: input.ttftMs ?? null,
    reasoningTokens: input.reasoningTokens ?? null,
    routeResolutionId: input.routeResolutionId ?? null,
  }).onConflictDoNothing().returning({ id: modelCalls.id }).all()
  return { inserted: result.length > 0 }
}

function updateModelCallAttribution(db: LedgerDb, modelCallId: string, entryId: string): AttributeResult {
  const result = db.update(modelCalls).set({ entryId }).where(and(eq(modelCalls.id, modelCallId), isNull(modelCalls.entryId))).returning({ id: modelCalls.id }).all()
  return { updated: result.length > 0 }
}

function insertAgentTimeline(db: LedgerDb, input: TimelineInput): InsertResult {
  const conflict = db.select().from(agentTimelineEvents).where(and(eq(agentTimelineEvents.sourceSessionId, input.sourceSessionId), eq(agentTimelineEvents.sourceSeq, input.sourceSeq))).get()
    ?? db.select().from(agentTimelineEvents).where(and(eq(agentTimelineEvents.agentId, input.agentId), eq(agentTimelineEvents.agentSeq, input.agentSeq))).get()
  if (conflict !== undefined) {
    if (timelineMatches(db, conflict, input)) return { inserted: false }
    throw new Error("Agent timeline idempotency conflict")
  }
  db.insert(agentTimelineEvents).values(timelineValues(input)).run()
  if (input.artifacts.length > 0) {
    db.insert(routeEventArtifacts).values(input.artifacts.map((artifact) => ({ ...artifact, ownerKind: "agentEvent", ownerId: input.id }))).run()
  }
  return { inserted: true }
}

function insertRouteResolution(db: LedgerDb, input: RouteResolutionInput): InsertResult {
  const conflict = db.select().from(routeResolutions).where(and(eq(routeResolutions.sourceSessionId, input.sourceSessionId), eq(routeResolutions.sourceSeq, input.sourceSeq))).get()
    ?? db.select().from(routeResolutions).where(and(eq(routeResolutions.agentId, input.agentId), eq(routeResolutions.agentSeq, input.agentSeq))).get()
  if (conflict !== undefined) {
    if (routeMatches(db, conflict, input)) return { inserted: false }
    throw new Error("Route resolution idempotency conflict")
  }
  if (input.fallbackFromResolutionId !== undefined && db.select().from(routeResolutions).where(eq(routeResolutions.id, input.fallbackFromResolutionId)).get() === undefined) {
    throw new Error("Fallback route resolution does not exist")
  }
  if (input.revertedFromResolutionId !== undefined && db.select().from(routeResolutions).where(eq(routeResolutions.id, input.revertedFromResolutionId)).get() === undefined) {
    throw new Error("Reverted route resolution does not exist")
  }
  db.insert(routeResolutions).values(routeValues(input)).run()
  db.insert(agentTimelineEvents).values(timelineValues(input.timeline)).run()
  if (input.candidates.length > 0) db.insert(routeCandidates).values(input.candidates.map((candidate) => ({ ...candidate, routeResolutionId: input.id, accountRef: candidate.accountRef ?? null, fallbackOrdinal: candidate.fallbackOrdinal ?? null, rejectionCode: candidate.rejectionCode ?? null, rejectionReason: candidate.rejectionReason ?? null }))).run()
  if (input.advisors.length > 0) db.insert(routeAdvisors).values(input.advisors.map((advisor) => ({ ...advisor, routeResolutionId: input.id, advisorAgentId: advisor.advisorAgentId ?? null, accountRef: advisor.accountRef ?? null, rawAdviceArtifactId: advisor.rawAdviceArtifactId ?? null }))).run()
  if (input.artifacts.length > 0) db.insert(routeEventArtifacts).values(input.artifacts.map((artifact) => ({ ...artifact, ownerKind: "routeResolution", ownerId: input.id }))).run()
  return { inserted: true }
}

function timelineValues(input: TimelineInput) {
  const { artifacts: timelineArtifacts, ...row } = input
  return { ...row, agentSessionId: input.agentSessionId ?? null, parentSessionId: input.parentSessionId ?? null, parentAgentId: input.parentAgentId ?? null, taskId: input.taskId ?? null, packetId: input.packetId ?? null, branchId: input.branchId ?? null, turnId: input.turnId ?? null, fromState: input.fromState ?? null, toState: input.toState ?? null, routeResolutionId: input.routeResolutionId ?? null, reason: input.reason ?? null, errorClass: input.errorClass ?? null }
}

function routeValues(input: RouteResolutionInput) {
  const { candidates, advisors, artifacts: routeArtifacts, timeline, ...row } = input
  return { ...row, agentSessionId: input.agentSessionId ?? null, parentSessionId: input.parentSessionId ?? null, parentAgentId: input.parentAgentId ?? null, taskId: input.taskId ?? null, packetId: input.packetId ?? null, branchId: input.branchId ?? null, turnId: input.turnId ?? null, reason: input.reason ?? null, upstreamProvider: input.upstreamProvider ?? null, accountRef: input.accountRef ?? null, fallbackFromResolutionId: input.fallbackFromResolutionId ?? null, revertedFromResolutionId: input.revertedFromResolutionId ?? null, rawDecisionArtifactId: input.rawDecisionArtifactId ?? null }
}

function timelineMatches(db: LedgerDb, row: AgentTimelineEventRow, input: TimelineInput): boolean {
  const expected = timelineValues(input)
  const artifacts = db.select().from(routeEventArtifacts).where(and(eq(routeEventArtifacts.ownerKind, "agentEvent"), eq(routeEventArtifacts.ownerId, input.id))).orderBy(routeEventArtifacts.ordinal).all()
  return row.id === expected.id && row.ts === expected.ts && row.sourceSessionId === expected.sourceSessionId && row.sourceSeq === expected.sourceSeq && row.agentId === expected.agentId && row.agentSeq === expected.agentSeq && row.agentSessionId === expected.agentSessionId && row.parentSessionId === expected.parentSessionId && row.parentAgentId === expected.parentAgentId && row.taskId === expected.taskId && row.packetId === expected.packetId && row.branchId === expected.branchId && row.turnId === expected.turnId && row.kind === expected.kind && row.fromState === expected.fromState && row.toState === expected.toState && row.routeResolutionId === expected.routeResolutionId && row.reason === expected.reason && row.errorClass === expected.errorClass && row.detail === expected.detail && row.payloadVersion === expected.payloadVersion && JSON.stringify(artifacts.map((artifact) => [artifact.ordinal, artifact.role, artifact.artifactId])) === JSON.stringify(input.artifacts.map((artifact) => [artifact.ordinal, artifact.role, artifact.artifactId]))
}

function routeMatches(db: LedgerDb, row: RouteResolutionRow, input: RouteResolutionInput): boolean {
  const expected = routeValues(input)
  const candidates = db.select().from(routeCandidates).where(eq(routeCandidates.routeResolutionId, input.id)).orderBy(routeCandidates.ordinal).all()
  const advisors = db.select().from(routeAdvisors).where(eq(routeAdvisors.routeResolutionId, input.id)).orderBy(routeAdvisors.ordinal).all()
  const artifacts = db.select().from(routeEventArtifacts).where(and(eq(routeEventArtifacts.ownerKind, "routeResolution"), eq(routeEventArtifacts.ownerId, input.id))).orderBy(routeEventArtifacts.ordinal).all()
  return row.id === expected.id && row.ts === expected.ts && row.sourceSessionId === expected.sourceSessionId && row.sourceSeq === expected.sourceSeq && row.agentId === expected.agentId && row.agentSeq === expected.agentSeq && row.agentSessionId === expected.agentSessionId && row.parentSessionId === expected.parentSessionId && row.parentAgentId === expected.parentAgentId && row.taskId === expected.taskId && row.packetId === expected.packetId && row.branchId === expected.branchId && row.turnId === expected.turnId && row.changeKind === expected.changeKind && row.reason === expected.reason && row.lane === expected.lane && row.provider === expected.provider && row.upstreamProvider === expected.upstreamProvider && row.model === expected.model && row.accountKind === expected.accountKind && row.accountRef === expected.accountRef && row.accountProvenance === expected.accountProvenance && row.effort === expected.effort && row.winningLayer === expected.winningLayer && row.constraints === expected.constraints && row.consultedSources === expected.consultedSources && row.overriddenValues === expected.overriddenValues && row.fallbackFromResolutionId === expected.fallbackFromResolutionId && row.revertedFromResolutionId === expected.revertedFromResolutionId && row.advisorMode === expected.advisorMode && row.rawDecisionArtifactId === expected.rawDecisionArtifactId && row.payloadVersion === expected.payloadVersion && JSON.stringify(candidates.map((candidate) => [candidate.ordinal, candidate.lane, candidate.provider, candidate.model, candidate.accountKind, candidate.accountRef, candidate.effort, candidate.disposition, candidate.fallbackOrdinal, candidate.rejectionCode, candidate.rejectionReason, candidate.failedConstraintIds])) === JSON.stringify(input.candidates.map((candidate) => [candidate.ordinal, candidate.lane, candidate.provider, candidate.model, candidate.accountKind, candidate.accountRef ?? null, candidate.effort, candidate.disposition, candidate.fallbackOrdinal ?? null, candidate.rejectionCode ?? null, candidate.rejectionReason ?? null, candidate.failedConstraintIds])) && JSON.stringify(advisors.map((advisor) => [advisor.ordinal, advisor.advisorAgentId, advisor.purpose, advisor.lane, advisor.provider, advisor.model, advisor.accountKind, advisor.accountRef, advisor.accountProvenance, advisor.effort, advisor.winningLayer, advisor.independenceRequired, advisor.rawAdviceArtifactId])) === JSON.stringify(input.advisors.map((advisor) => [advisor.ordinal, advisor.advisorAgentId ?? null, advisor.purpose, advisor.lane, advisor.provider, advisor.model, advisor.accountKind, advisor.accountRef ?? null, advisor.accountProvenance, advisor.effort, advisor.winningLayer, advisor.independenceRequired, advisor.rawAdviceArtifactId ?? null])) && JSON.stringify(artifacts.map((artifact) => [artifact.ordinal, artifact.role, artifact.artifactId])) === JSON.stringify(input.artifacts.map((artifact) => [artifact.ordinal, artifact.role, artifact.artifactId]))
}

function insertProviderCall(db: LedgerDb, input: ProviderCallInput): InsertResult {
  const result = db.insert(providerCalls).values({
    id: input.id,
    ts: input.ts,
    sessionId: input.sessionId,
    branchId: input.branchId ?? null,
    packetId: input.packetId ?? null,
    provider: input.provider,
    operation: input.operation,
    inputHash: input.inputHash,
    rawRequestArtifact: input.rawRequestArtifact ?? null,
    latencyMs: input.latencyMs,
    outcome: input.outcome,
    errorClass: input.errorClass ?? null,
    cost: input.cost ?? null,
    usage: input.usage ?? null,
  }).onConflictDoNothing().returning({ id: providerCalls.id }).all()
  return { inserted: result.length > 0 }
}

function insertArtifact(db: LedgerDb, content: ArtifactContent, meta: ArtifactMeta): PutArtifactResult {
  const material = artifactMaterial(content)
  const sha256 = createHash("sha256").update(material.bytes).digest("hex")
  const id = `artifact_${sha256.slice(0, 32)}`
  const result = db.insert(artifacts).values({
    id,
    ts: meta.ts,
    sessionId: meta.sessionId ?? null,
    kind: meta.kind,
    contentPath: material.path,
    contentInline: material.inline,
    sha256,
    bytes: material.bytes.byteLength,
    retention: meta.retention,
    meta: meta.meta,
  }).onConflictDoNothing().returning({ id: artifacts.id }).all()
  return { id, sha256, bytes: material.bytes.byteLength, inserted: result.length > 0 }
}

function artifactMaterial(content: ArtifactContent): { readonly bytes: Uint8Array; readonly inline: string | null; readonly path: string | null } {
  if (content.path !== undefined) {
    return { bytes: readFileSync(content.path), inline: null, path: content.path }
  }
  if (typeof content.content === "string") {
    return { bytes: Buffer.from(content.content), inline: content.content, path: null }
  }
  return { bytes: content.content, inline: Buffer.from(content.content).toString("utf8"), path: null }
}

function readStatusSummary(sqlite: Database): StatusSummary {
  return {
    sessionsByStatus: sqlite.query<{ status: string; count: number }, []>(
      "SELECT status, COUNT(*) AS count FROM sessions GROUP BY status ORDER BY status",
    ).all(),
    counts: {
      sessions: countTable(sqlite, "sessions"),
      branches: countTable(sqlite, "branches"),
      turns: countTable(sqlite, "turns"),
      events: countTable(sqlite, "events"),
      modelCalls: countTable(sqlite, "model_calls"),
      providerCalls: countTable(sqlite, "provider_calls"),
      artifacts: countTable(sqlite, "artifacts"),
      packets: countTable(sqlite, "packets"),
      commits: countTable(sqlite, "commits"),
    },
    lastActivity: sqlite.query<{ lastActivity: number | null }, []>(
      "SELECT MAX(updatedAt) AS lastActivity FROM sessions",
    ).get()?.lastActivity ?? null,
  }
}

function countTable(sqlite: Database, table: string): number {
  return sqlite.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0
}

function listModelCallRows(db: LedgerDb, filters: ModelCallFilters): ModelCallRow[] {
  const clauses = [
    filters.session === undefined ? undefined : eq(modelCalls.session, filters.session),
    filters.model === undefined ? undefined : eq(modelCalls.model, filters.model),
    filters.provider === undefined ? undefined : eq(modelCalls.provider, filters.provider),
    filters.entryId === undefined ? undefined : eq(modelCalls.entryId, filters.entryId),
    filters.outcome === undefined ? undefined : eq(modelCalls.outcome, filters.outcome),
    filters.sinceTs === undefined ? undefined : gte(modelCalls.ts, filters.sinceTs),
  ].filter((clause) => clause !== undefined)
  return db.select().from(modelCalls).where(clauses.length === 0 ? undefined : and(...clauses)).orderBy(desc(modelCalls.ts)).limit(limitOrDefault(filters.limit)).all()
}

function listEventRows(db: LedgerDb, filters: EventFilters): EventRow[] {
  const clauses = [
    filters.sessionId === undefined ? undefined : eq(events.sessionId, filters.sessionId),
    filters.branchId === undefined ? undefined : eq(events.branchId, filters.branchId),
    filters.packetId === undefined ? undefined : eq(events.packetId, filters.packetId),
    filters.kind === undefined ? undefined : eq(events.kind, filters.kind),
    filters.sinceTs === undefined ? undefined : gte(events.ts, filters.sinceTs),
  ].filter((clause) => clause !== undefined)
  return db.select().from(events).where(clauses.length === 0 ? undefined : and(...clauses)).orderBy(desc(events.ts)).limit(limitOrDefault(filters.limit)).all()
}

function readArtifact(db: LedgerDb, id: string): ArtifactRecord & { readonly content: string } {
  const row = db.select().from(artifacts).where(eq(artifacts.id, id)).get()
  if (row === undefined) {
    throw new Error(`Artifact not found: ${id}`)
  }
  const content = artifactContent(row)
  return artifactRecord(row, content)
}

function artifactContent(row: ArtifactRow): string {
  if (row.contentInline !== null) {
    return row.contentInline
  }
  if (row.contentPath !== null) {
    return readFileSync(row.contentPath, "utf8")
  }
  throw new Error(`Artifact has no content: ${row.id}`)
}

function artifactRecord(row: ArtifactRow, content: string): ArtifactRecord & { readonly content: string } {
  return { id: row.id, ts: row.ts, sessionId: row.sessionId ?? undefined, kind: row.kind, contentPath: row.contentPath ?? undefined, contentInline: row.contentInline ?? undefined, sha256: row.sha256, bytes: row.bytes, retention: row.retention, meta: row.meta, content }
}

function listAgentTimelineRows(db: LedgerDb, agentId: string, afterAgentSeq?: number, limit?: number): AgentTimelineEventRow[] {
  const clauses = [eq(agentTimelineEvents.agentId, agentId), afterAgentSeq === undefined ? undefined : gte(agentTimelineEvents.agentSeq, afterAgentSeq + 1)].filter((clause) => clause !== undefined)
  return db.select().from(agentTimelineEvents).where(and(...clauses)).orderBy(agentTimelineEvents.agentSeq).limit(limit ?? 200).all()
}

function listTimelineRowsAfterSource(sqlite: Database, cursor: TimelineSourceCursor | undefined, limit: number): AgentTimelineEventRow[] {
  const boundedLimit = Math.max(1, Math.min(limit, 1_000))
  if (cursor === undefined) {
    return sqlite.query<AgentTimelineEventRow, [number]>("SELECT * FROM agent_timeline_events ORDER BY sourceSessionId ASC, sourceSeq ASC LIMIT ?").all(boundedLimit)
  }
  return sqlite.query<AgentTimelineEventRow, [string, string, number, number]>("SELECT * FROM agent_timeline_events WHERE sourceSessionId > ? OR (sourceSessionId = ? AND sourceSeq > ?) ORDER BY sourceSessionId ASC, sourceSeq ASC LIMIT ?").all(cursor.sourceSessionId, cursor.sourceSessionId, cursor.sourceSeq, boundedLimit)
}

function listCurrentAgentStateRows(sqlite: Database, parentAgentId?: string): AgentTimelineEventRow[] {
  return sqlite.query<AgentTimelineEventRow, [string | null, string | null]>("WITH ranked AS (SELECT e.*, ROW_NUMBER() OVER (PARTITION BY agentId ORDER BY agentSeq DESC) AS rn FROM agent_timeline_events e WHERE (? IS NULL OR parentAgentId = ?)) SELECT * FROM ranked WHERE rn = 1 ORDER BY ts DESC, agentId ASC").all(parentAgentId ?? null, parentAgentId ?? null)
}

function listRestartRecoveryRows(sqlite: Database, agentId: string): AgentTimelineEventRow[] {
  return sqlite.query<AgentTimelineEventRow, [string]>("SELECT * FROM agent_timeline_events WHERE agentId = ? AND kind IN ('interrupted_by_restart', 'adopt', 'revive') ORDER BY agentSeq ASC").all(agentId)
}

function limitOrDefault(limit: number | undefined): number {
  return limit === undefined ? 100 : Math.max(1, Math.min(limit, 1_000))
}

function storageEffect<A>(operation: string, run: () => A): Effect.Effect<A, StorageError> {
  return Effect.try({ try: run, catch: (cause) => storageError(operation, cause) })
}

function artifactEffect<A>(operation: string, run: () => A): Effect.Effect<A, ArtifactError> {
  return Effect.try({ try: run, catch: (cause) => artifactError(operation, cause) })
}

function storageError(operation: string, cause: unknown, context?: string): StorageError {
  return new StorageError({ operation, message: errorMessage(cause), cause: errorMessage(cause), context })
}

function artifactError(operation: string, cause: unknown, context?: string): ArtifactError {
  return new ArtifactError({ operation, message: errorMessage(cause), cause: errorMessage(cause), context })
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
