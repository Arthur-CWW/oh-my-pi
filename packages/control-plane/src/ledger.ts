import { createHash } from "node:crypto"
import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { homedir } from "node:os"

import { Database } from "bun:sqlite"
import { Context, Effect, Layer, Schema } from "effect"
import { and, desc, eq, gte, isNull } from "drizzle-orm"
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"

import { ArtifactError, StorageError } from "./errors"
import { migrateLedger, setDurabilityPragmas } from "./migrate"
import { agentTimelineEvents, artifacts, branches, events, modelCalls, papercuts, providerCalls, routeAdvisors, routeCandidates, routeEventArtifacts, routeResolutions, sessions, turns, PapercutInputSchema, PapercutSeveritySchema, PapercutStatusSchema, type AgentTimelineEventRow, type ArtifactRow, type EventRow, type ModelCallRow, type PapercutInput, type PapercutKind, type PapercutRow, type PapercutSeverity, type PapercutStatus, type RouteAdvisorRow, type RouteCandidateRow, type RouteEventArtifactRow, type RouteResolutionRow } from "./schema"
import { decodeRelayCursorV1, decodeRelayEnvelopeV1, type NodeIdentityV1, type PeerRouteV1, type RelayAckV1, type RelayEnvelopeV1, type RelayHealthV1, type RelayJson, type WorkLeaseV1, type WorkPacketV1 } from "./relay-schema"

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

export interface OperationalEventInput {
  readonly eventId: string
  readonly eventKind: "runnerEvent" | "diagnosticOccurrence" | "diagnosticProjection"
  readonly occurredAt: number
  readonly observedAt: number
  readonly producer: string
  readonly payloadVersion: 1
  readonly sourceKind: string
  readonly sourceId: string
  readonly sourceSequence: number
  readonly sourceDigest: string
  readonly buildDigest?: string
  readonly runnerInstanceId?: string
  readonly sessionId?: string
  readonly branchId?: string
  readonly turnId?: string
  readonly entryId?: string
  readonly agentId?: string
  readonly parentAgentId?: string
  readonly taskId?: string
  readonly packetId?: string
  readonly viewId?: string
  readonly controllerEpoch?: number
  readonly ownerEpoch?: string
  readonly revision?: number
  readonly sequence?: number
  readonly sessionRevision?: number
  readonly durableSequence?: number
  readonly commandId?: string
  readonly correlationId?: string
  readonly causationId?: string
  readonly inputId?: string
  readonly attemptId?: string
  readonly routeResolutionId?: string
  readonly quotaDecisionId?: string
  readonly toolCallId?: string
  readonly diagnosticId?: string
  readonly regressionId?: string
  readonly redactionPolicyId?: string
  readonly payload: string
}

export interface DiagnosticArtifactInput {
  readonly ordinal: number
  readonly role: string
  readonly artifactId: string
  readonly sha256: string
  readonly redactionPolicyId: string
}

export interface DiagnosticOccurrenceInput {
  readonly operational: OperationalEventInput
  readonly diagnosticId: string
  readonly occurredAt: number
  readonly failureClass: string
  readonly phase: string
  readonly message: string
  readonly requestFingerprint?: string
  readonly buildDigest?: string
  readonly runnerInstanceId?: string
  readonly runtimeIdentity: string
  readonly configHash?: string
  readonly manifestHash?: string
  readonly sessionId?: string
  readonly branchId?: string
  readonly turnId?: string
  readonly entryId?: string
  readonly agentId?: string
  readonly routeResolutionId?: string
  readonly inputId?: string
  readonly attemptId?: string
  readonly ownerEpoch?: string
  readonly explicitRoute?: boolean
  readonly outcome?: string
  readonly causeDiagnosticId?: string
  readonly retryOfAttemptId?: string
  readonly fallbackResolutionId?: string
  readonly interventionCommandId?: string
  readonly regressionId?: string
  readonly redactionPolicyId: string
  readonly payloadVersion: 1
  readonly artifacts: readonly DiagnosticArtifactInput[]
}

export interface DiagnosticProjectionInput {
  readonly operational: OperationalEventInput
  readonly projectionEventId: string
  readonly diagnosticId: string
  readonly occurredAt: number
  readonly state: "unread" | "acknowledged" | "resolved" | "reopened"
  readonly actor?: string
  readonly commandId?: string
  readonly sourceEntryId: string
  readonly payloadVersion: 1
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


export interface PapercutReportInput extends PapercutInput {
  readonly timestamp: number
  readonly agentId?: string
  readonly modelId?: string
  readonly sessionId?: string
}

export interface PapercutFilters {
  readonly severity?: PapercutSeverity
  readonly status?: PapercutStatus
  readonly limit?: number
}

export interface PapercutRecord {
  readonly fingerprint: string
  readonly timestamp: number
  readonly agentId?: string
  readonly modelId?: string
  readonly sessionId?: string
  readonly package?: string
  readonly kind: PapercutKind
  readonly severity: PapercutSeverity
  readonly commandOrTool?: string
  readonly message: string
  readonly evidence?: string
  readonly suggestedFix?: string
  readonly status: PapercutStatus
  readonly occurrences: number
  readonly firstSeenAt: number
  readonly lastSeenAt: number
}

export interface PapercutReportResult {
  readonly record: PapercutRecord
  readonly appendedTo: string
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
  | { readonly kind: "runnerEvent"; readonly payload: OperationalEventInput }
  | { readonly kind: "diagnosticOccurrence"; readonly payload: DiagnosticOccurrenceInput }
  | { readonly kind: "diagnosticProjection"; readonly payload: DiagnosticProjectionInput }

export interface BatchResult {
  readonly inserted: number
  readonly ignored: number
}
export interface RelayReceiveInput { readonly receiverNodeId: string; readonly envelope: RelayEnvelopeV1; readonly receivedAt: number }
export interface RelayReceiveResult { readonly disposition: "accepted" | "duplicate"; readonly receipt: RelayAckV1; readonly cursor?: RelayAckV1["destinationCursor"] }
export interface RelayRetryInput { readonly envelopeId: string; readonly nextAttemptAt: number }
export interface LeaseClaimInput { readonly packet: WorkPacketV1; readonly ownerNodeId: string; readonly ownerSessionId: string; readonly ownerAgentId: string; readonly acquiredAt: number; readonly renewBy: number }
export interface RelayOutboxAcceptance { readonly envelopeId: string; readonly acceptedAt: number }
export interface LeaseMutationInput { readonly packetId: string; readonly leaseEpoch: string; readonly ownerNodeId: string; readonly at: number; readonly state?: "completed" | "failed" | "cancelled" }
export interface LeaseRenewalInput extends LeaseMutationInput { readonly renewBy: number }
export interface LeaseMutationResult { readonly fenced: boolean; readonly lease?: WorkLeaseV1 }
export interface LeaseExpiry { readonly packetId: string; readonly state: "queued" | "orphaned" }
export interface RelayOutboxItem { readonly envelope: RelayEnvelopeV1; readonly attemptCount: number; readonly nextAttemptAt: number }
export interface RelayAdapterDelivery { readonly envelopeId: string; readonly messageId: string }
export interface RelayNodeInput { readonly identity: NodeIdentityV1 }
export interface RelayHealthInput { readonly observerNodeId: string; readonly health: RelayHealthV1; readonly consecutiveFailures: number; readonly lastFailureAt?: number }
export interface RelayNodeRecord { readonly nodeId: string; readonly displayName: string; readonly protocolVersions: readonly number[]; readonly firstSeenAt: number; readonly lastSeenAt: number; readonly lastHostEpoch: string }
export interface RelayRouteRecord { readonly nodeId: string; readonly peerId: string; readonly alias?: string; readonly endpoint: string; readonly enabled: boolean; readonly updatedAt: number }
export interface RelayHealthRecord { readonly observerNodeId: string; readonly peerNodeId: string; readonly state: "healthy" | "degraded" | "offline"; readonly lastSuccessAt?: number; readonly lastFailureAt?: number; readonly consecutiveFailures: number; readonly queueDepth: number; readonly oldestUnackedMs?: number; readonly detail?: string }
export interface RelayQueueState { readonly pendingOutbox: number; readonly pendingInbox: number; readonly oldestPendingOutboxAt?: number }


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
  readonly reportPapercut: (input: PapercutReportInput) => Effect.Effect<PapercutReportResult, StorageError>
  readonly listPapercuts: (filters: PapercutFilters) => Effect.Effect<PapercutRecord[], StorageError>
  readonly enqueueRelayEnvelope: (envelope: RelayEnvelopeV1) => Effect.Effect<InsertResult, StorageError>
  readonly scheduleRelayRetry: (input: RelayRetryInput) => Effect.Effect<InsertResult, StorageError>
  readonly listPendingRelayOutbox: (now: number, limit?: number) => Effect.Effect<readonly RelayOutboxItem[], StorageError>
  readonly acceptRelayOutbox: (input: RelayOutboxAcceptance) => Effect.Effect<InsertResult, StorageError>
  readonly receiveRelayEnvelope: (input: RelayReceiveInput) => Effect.Effect<RelayReceiveResult, StorageError>
  readonly recordRelayAdapterDelivery: (input: RelayAdapterDelivery) => Effect.Effect<InsertResult, StorageError>
  readonly upsertRelayNode: (input: RelayNodeInput) => Effect.Effect<InsertResult, StorageError>
  readonly upsertRelayRoute: (route: PeerRouteV1, alias: string | undefined, enabled: boolean, updatedAt: number) => Effect.Effect<InsertResult, StorageError>
  readonly recordRelayHealth: (input: RelayHealthInput) => Effect.Effect<InsertResult, StorageError>
  readonly listRelayNodes: () => Effect.Effect<readonly RelayNodeRecord[], StorageError>
  readonly listRelayRoutes: (nodeId?: string) => Effect.Effect<readonly RelayRouteRecord[], StorageError>
  readonly listRelayHealth: (observerNodeId?: string) => Effect.Effect<readonly RelayHealthRecord[], StorageError>
  readonly relayQueueState: () => Effect.Effect<RelayQueueState, StorageError>
  readonly claimWorkLease: (input: LeaseClaimInput) => Effect.Effect<LeaseMutationResult, StorageError>
  readonly renewWorkLease: (input: LeaseRenewalInput) => Effect.Effect<LeaseMutationResult, StorageError>
  readonly finishWorkLease: (input: LeaseMutationInput) => Effect.Effect<LeaseMutationResult, StorageError>
  readonly expireWorkLeases: (now: number) => Effect.Effect<readonly LeaseExpiry[], StorageError>
  readonly fenceWorkLease: (input: LeaseMutationInput) => Effect.Effect<LeaseMutationResult, StorageError>
  readonly getArtifact: (id: string) => Effect.Effect<ArtifactRecord & { readonly content: string }, ArtifactError>
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
  const papercutLogPath = defaultPapercutLogPath(dbPath)

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
    reportPapercut: Effect.fn("LedgerStore.reportPapercut")((input: PapercutReportInput) =>
      storageEffect("reportPapercut", () => reportPapercut(db, papercutLogPath, input)),
    ),
    enqueueRelayEnvelope: Effect.fn("LedgerStore.enqueueRelayEnvelope")((envelope: RelayEnvelopeV1) => storageEffect("enqueueRelayEnvelope", () => enqueueRelayEnvelope(sqlite, envelope))),
    scheduleRelayRetry: Effect.fn("LedgerStore.scheduleRelayRetry")((input: RelayRetryInput) => storageEffect("scheduleRelayRetry", () => scheduleRelayRetry(sqlite, input))),
    acceptRelayOutbox: Effect.fn("LedgerStore.acceptRelayOutbox")((input: RelayOutboxAcceptance) => storageEffect("acceptRelayOutbox", () => acceptRelayOutbox(sqlite, input))),
    listPendingRelayOutbox: Effect.fn("LedgerStore.listPendingRelayOutbox")((now: number, limit?: number) => storageEffect("listPendingRelayOutbox", () => listPendingRelayOutbox(sqlite, now, limit))),
    receiveRelayEnvelope: Effect.fn("LedgerStore.receiveRelayEnvelope")((input: RelayReceiveInput) => storageEffect("receiveRelayEnvelope", () => receiveRelayEnvelope(sqlite, input))),
    recordRelayAdapterDelivery: Effect.fn("LedgerStore.recordRelayAdapterDelivery")((input: RelayAdapterDelivery) => storageEffect("recordRelayAdapterDelivery", () => recordRelayAdapterDelivery(sqlite, input))),
    upsertRelayNode: Effect.fn("LedgerStore.upsertRelayNode")((input: RelayNodeInput) => storageEffect("upsertRelayNode", () => upsertRelayNode(sqlite, input))),
    upsertRelayRoute: Effect.fn("LedgerStore.upsertRelayRoute")((route: PeerRouteV1, alias: string | undefined, enabled: boolean, updatedAt: number) => storageEffect("upsertRelayRoute", () => upsertRelayRoute(sqlite, route, alias, enabled, updatedAt))),
    recordRelayHealth: Effect.fn("LedgerStore.recordRelayHealth")((input: RelayHealthInput) => storageEffect("recordRelayHealth", () => recordRelayHealth(sqlite, input))),
    listRelayNodes: Effect.fn("LedgerStore.listRelayNodes")(() => storageEffect("listRelayNodes", () => listRelayNodes(sqlite))),
    listRelayRoutes: Effect.fn("LedgerStore.listRelayRoutes")((nodeId?: string) => storageEffect("listRelayRoutes", () => listRelayRoutes(sqlite, nodeId))),
    listRelayHealth: Effect.fn("LedgerStore.listRelayHealth")((observerNodeId?: string) => storageEffect("listRelayHealth", () => listRelayHealth(sqlite, observerNodeId))),
    relayQueueState: Effect.fn("LedgerStore.relayQueueState")(() => storageEffect("relayQueueState", () => relayQueueState(sqlite))),
    claimWorkLease: Effect.fn("LedgerStore.claimWorkLease")((input: LeaseClaimInput) => storageEffect("claimWorkLease", () => claimWorkLease(sqlite, input))),
    renewWorkLease: Effect.fn("LedgerStore.renewWorkLease")((input: LeaseRenewalInput) => storageEffect("renewWorkLease", () => renewWorkLease(sqlite, input))),
    finishWorkLease: Effect.fn("LedgerStore.finishWorkLease")((input: LeaseMutationInput) => storageEffect("finishWorkLease", () => finishWorkLease(sqlite, input))),
    fenceWorkLease: Effect.fn("LedgerStore.fenceWorkLease")((input: LeaseMutationInput) => storageEffect("fenceWorkLease", () => fenceWorkLease(sqlite, input))),
    expireWorkLeases: Effect.fn("LedgerStore.expireWorkLeases")((now: number) => storageEffect("expireWorkLeases", () => expireWorkLeases(sqlite, now))),
    listPapercuts: Effect.fn("LedgerStore.listPapercuts")((filters: PapercutFilters) =>
      storageEffect("listPapercuts", () => listPapercutRows(db, filters)),
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
    case "runnerEvent":
      return insertOperationalEvent(db, row.payload)
    case "diagnosticOccurrence":
      return insertDiagnosticOccurrence(db, row.payload)
    case "diagnosticProjection":
      return insertDiagnosticProjection(db, row.payload)
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

interface OperationalEventStoredRow {
  readonly eventId: string
  readonly eventKind: string
  readonly occurredAt: number
  readonly observedAt: number
  readonly producer: string
  readonly payloadVersion: number
  readonly sourceKind: string
  readonly sourceId: string
  readonly sourceSequence: number | null
  readonly sourceDigest: string
  readonly buildDigest: string | null
  readonly runnerInstanceId: string | null
  readonly sessionId: string | null
  readonly branchId: string | null
  readonly turnId: string | null
  readonly entryId: string | null
  readonly agentId: string | null
  readonly parentAgentId: string | null
  readonly taskId: string | null
  readonly packetId: string | null
  readonly viewId: string | null
  readonly controllerEpoch: number | null
  readonly ownerEpoch: string | null
  readonly revision: number | null
  readonly sequence: number | null
  readonly sessionRevision: number | null
  readonly durableSequence: number | null
  readonly commandId: string | null
  readonly correlationId: string | null
  readonly causationId: string | null
  readonly inputId: string | null
  readonly attemptId: string | null
  readonly routeResolutionId: string | null
  readonly quotaDecisionId: string | null
  readonly toolCallId: string | null
  readonly diagnosticId: string | null
  readonly regressionId: string | null
  readonly redactionPolicyId: string | null
  readonly payload: string
}

interface OperationalSourceStoredRow {
  readonly sourceDigest: string
  readonly lastSourceSequence: number | null
  readonly lastOccurredAt: number | null
  readonly lastObservedAt: number
  readonly gapFromSequence: number | null
  readonly gapToSequence: number | null
}

interface DiagnosticArtifactStoredRow {
  readonly ordinal: number
  readonly role: string
  readonly artifactId: string
  readonly sha256: string
  readonly redactionPolicyId: string
}

function rawSqlite(db: LedgerDb): Database {
  return (db as LedgerDb & { readonly session: { readonly client: Database } }).session.client
}

function insertOperationalEvent(db: LedgerDb, input: OperationalEventInput): InsertResult {
  const existingByEventId = rawSqlite(db).query<OperationalEventStoredRow, [string]>("SELECT * FROM operational_events WHERE eventId = ?").get(input.eventId)
  if (existingByEventId !== null && existingByEventId !== undefined) {
    if (operationalEventMatches(existingByEventId, input)) {
      return { inserted: false }
    }
    throw new Error("Operational event idempotency conflict")
  }
  const existingBySource = rawSqlite(db).query<OperationalEventStoredRow, [string, string, number]>("SELECT * FROM operational_events WHERE sourceKind = ? AND sourceId = ? AND sourceSequence = ?").get(input.sourceKind, input.sourceId, input.sourceSequence)
  if (existingBySource !== null && existingBySource !== undefined) {
    if (operationalEventMatches(existingBySource, input)) {
      return { inserted: false }
    }
    throw new Error("Operational source sequence conflict")
  }
  rawSqlite(db).query("INSERT INTO operational_events (eventId, eventKind, occurredAt, observedAt, producer, payloadVersion, sourceKind, sourceId, sourceSequence, sourceDigest, buildDigest, runnerInstanceId, sessionId, branchId, turnId, entryId, agentId, parentAgentId, taskId, packetId, viewId, controllerEpoch, ownerEpoch, revision, sequence, sessionRevision, durableSequence, commandId, correlationId, causationId, inputId, attemptId, routeResolutionId, quotaDecisionId, toolCallId, diagnosticId, regressionId, redactionPolicyId, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    input.eventId,
    input.eventKind,
    input.occurredAt,
    input.observedAt,
    input.producer,
    input.payloadVersion,
    input.sourceKind,
    input.sourceId,
    input.sourceSequence,
    input.sourceDigest,
    input.buildDigest ?? null,
    input.runnerInstanceId ?? null,
    input.sessionId ?? null,
    input.branchId ?? null,
    input.turnId ?? null,
    input.entryId ?? null,
    input.agentId ?? null,
    input.parentAgentId ?? null,
    input.taskId ?? null,
    input.packetId ?? null,
    input.viewId ?? null,
    input.controllerEpoch ?? null,
    input.ownerEpoch ?? null,
    input.revision ?? null,
    input.sequence ?? null,
    input.sessionRevision ?? null,
    input.durableSequence ?? null,
    input.commandId ?? null,
    input.correlationId ?? null,
    input.causationId ?? null,
    input.inputId ?? null,
    input.attemptId ?? null,
    input.routeResolutionId ?? null,
    input.quotaDecisionId ?? null,
    input.toolCallId ?? null,
    input.diagnosticId ?? null,
    input.regressionId ?? null,
    input.redactionPolicyId ?? null,
    input.payload,
  )
  updateOperationalSource(db, input)
  return { inserted: true }
}

function insertDiagnosticOccurrence(db: LedgerDb, input: DiagnosticOccurrenceInput): InsertResult {
  const eventInsert = insertOperationalEvent(db, input.operational)
  if (!eventInsert.inserted) {
    const existingArtifacts = rawSqlite(db).query<DiagnosticArtifactStoredRow, [string]>("SELECT ordinal, role, artifactId, sha256, redactionPolicyId FROM diagnostic_artifacts WHERE diagnosticId = ? ORDER BY ordinal").all(input.diagnosticId)
    if (diagnosticArtifactsMatch(existingArtifacts, input.artifacts)) {
      return { inserted: false }
    }
    throw new Error("Diagnostic occurrence artifact conflict")
  }
  rawSqlite(db).query("INSERT INTO diagnostic_occurrences (diagnosticId, occurredAt, failureClass, phase, message, requestFingerprint, buildDigest, runnerInstanceId, runtimeIdentity, configHash, manifestHash, sessionId, branchId, turnId, entryId, agentId, routeResolutionId, inputId, attemptId, ownerEpoch, explicitRoute, outcome, causeDiagnosticId, retryOfAttemptId, fallbackResolutionId, interventionCommandId, regressionId, redactionPolicyId, payloadVersion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    input.diagnosticId,
    input.occurredAt,
    input.failureClass,
    input.phase,
    input.message,
    input.requestFingerprint ?? null,
    input.buildDigest ?? null,
    input.runnerInstanceId ?? null,
    input.runtimeIdentity,
    input.configHash ?? null,
    input.manifestHash ?? null,
    input.sessionId ?? null,
    input.branchId ?? null,
    input.turnId ?? null,
    input.entryId ?? null,
    input.agentId ?? null,
    input.routeResolutionId ?? null,
    input.inputId ?? null,
    input.attemptId ?? null,
    input.ownerEpoch ?? null,
    input.explicitRoute === undefined ? null : input.explicitRoute ? 1 : 0,
    input.outcome ?? null,
    input.causeDiagnosticId ?? null,
    input.retryOfAttemptId ?? null,
    input.fallbackResolutionId ?? null,
    input.interventionCommandId ?? null,
    input.regressionId ?? null,
    input.redactionPolicyId,
    input.payloadVersion,
  )
  for (const artifact of input.artifacts) {
    const existingArtifact = db.select().from(artifacts).where(eq(artifacts.id, artifact.artifactId)).get()
    if (existingArtifact !== undefined && existingArtifact.sha256 !== artifact.sha256) {
      throw new Error("Diagnostic artifact digest mismatch")
    }
    rawSqlite(db).query("INSERT INTO diagnostic_artifacts (diagnosticId, ordinal, role, artifactId, sha256, redactionPolicyId) VALUES (?, ?, ?, ?, ?, ?)").run(
      input.diagnosticId,
      artifact.ordinal,
      artifact.role,
      artifact.artifactId,
      artifact.sha256,
      artifact.redactionPolicyId,
    )
  }
  return { inserted: true }
}

function insertDiagnosticProjection(db: LedgerDb, input: DiagnosticProjectionInput): InsertResult {
  const eventInsert = insertOperationalEvent(db, input.operational)
  if (!eventInsert.inserted) {
    return { inserted: false }
  }
  rawSqlite(db).query("INSERT INTO diagnostic_projection_events (projectionEventId, diagnosticId, occurredAt, state, actor, commandId, sourceEntryId, payloadVersion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    input.projectionEventId,
    input.diagnosticId,
    input.occurredAt,
    input.state,
    input.actor ?? null,
    input.commandId ?? null,
    input.sourceEntryId,
    input.payloadVersion,
  )
  return { inserted: true }
}

function operationalEventMatches(row: OperationalEventStoredRow, input: OperationalEventInput): boolean {
  return row.eventId === input.eventId &&
    row.eventKind === input.eventKind &&
    row.occurredAt === input.occurredAt &&
    row.observedAt === input.observedAt &&
    row.producer === input.producer &&
    row.payloadVersion === input.payloadVersion &&
    row.sourceKind === input.sourceKind &&
    row.sourceId === input.sourceId &&
    row.sourceSequence === input.sourceSequence &&
    row.sourceDigest === input.sourceDigest &&
    row.buildDigest === (input.buildDigest ?? null) &&
    row.runnerInstanceId === (input.runnerInstanceId ?? null) &&
    row.sessionId === (input.sessionId ?? null) &&
    row.branchId === (input.branchId ?? null) &&
    row.turnId === (input.turnId ?? null) &&
    row.entryId === (input.entryId ?? null) &&
    row.agentId === (input.agentId ?? null) &&
    row.parentAgentId === (input.parentAgentId ?? null) &&
    row.taskId === (input.taskId ?? null) &&
    row.packetId === (input.packetId ?? null) &&
    row.viewId === (input.viewId ?? null) &&
    row.controllerEpoch === (input.controllerEpoch ?? null) &&
    row.ownerEpoch === (input.ownerEpoch ?? null) &&
    row.revision === (input.revision ?? null) &&
    row.sequence === (input.sequence ?? null) &&
    row.sessionRevision === (input.sessionRevision ?? null) &&
    row.durableSequence === (input.durableSequence ?? null) &&
    row.commandId === (input.commandId ?? null) &&
    row.correlationId === (input.correlationId ?? null) &&
    row.causationId === (input.causationId ?? null) &&
    row.inputId === (input.inputId ?? null) &&
    row.attemptId === (input.attemptId ?? null) &&
    row.routeResolutionId === (input.routeResolutionId ?? null) &&
    row.quotaDecisionId === (input.quotaDecisionId ?? null) &&
    row.toolCallId === (input.toolCallId ?? null) &&
    row.diagnosticId === (input.diagnosticId ?? null) &&
    row.regressionId === (input.regressionId ?? null) &&
    row.redactionPolicyId === (input.redactionPolicyId ?? null) &&
    row.payload === input.payload
}

function diagnosticArtifactsMatch(rows: readonly DiagnosticArtifactStoredRow[], artifactsInput: readonly DiagnosticArtifactInput[]): boolean {
  return rows.length === artifactsInput.length && rows.every((row, index) => {
    const artifact = artifactsInput[index]
    return artifact !== undefined &&
      row.ordinal === artifact.ordinal &&
      row.role === artifact.role &&
      row.artifactId === artifact.artifactId &&
      row.sha256 === artifact.sha256 &&
      row.redactionPolicyId === artifact.redactionPolicyId
  })
}

function updateOperationalSource(db: LedgerDb, input: OperationalEventInput): void {
  const sqlite = rawSqlite(db)
  const current = sqlite.query<OperationalSourceStoredRow, [string, string]>("SELECT sourceDigest, lastSourceSequence, lastOccurredAt, lastObservedAt, gapFromSequence, gapToSequence FROM operational_sources WHERE sourceKind = ? AND sourceId = ?").get(input.sourceKind, input.sourceId)
  const sequences = sqlite.query<{ sourceSequence: number }, [string, string]>("SELECT sourceSequence FROM operational_events WHERE sourceKind = ? AND sourceId = ? AND sourceSequence IS NOT NULL ORDER BY sourceSequence").all(input.sourceKind, input.sourceId)
  let expectedSequence = 0
  let gapFromSequence: number | null = null
  let gapToSequence: number | null = null
  for (const row of sequences) {
    if (gapFromSequence === null && row.sourceSequence > expectedSequence) {
      gapFromSequence = expectedSequence
      gapToSequence = row.sourceSequence - 1
    }
    expectedSequence = Math.max(expectedSequence, row.sourceSequence + 1)
  }
  if (current === null || current === undefined) {
    sqlite.query("INSERT INTO operational_sources (sourceKind, sourceId, sourceDigest, lastSourceSequence, lastOccurredAt, lastObservedAt, gapFromSequence, gapToSequence, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      input.sourceKind,
      input.sourceId,
      input.sourceDigest,
      input.sourceSequence,
      input.occurredAt,
      input.observedAt,
      gapFromSequence,
      gapToSequence,
      gapFromSequence === null ? "ok" : "gap",
    )
    return
  }
  const lastSourceSequence = current.lastSourceSequence === null ? input.sourceSequence : Math.max(current.lastSourceSequence, input.sourceSequence)
  const updateDigest = current.lastSourceSequence === null || input.sourceSequence >= current.lastSourceSequence
  sqlite.query("UPDATE operational_sources SET sourceDigest = ?, lastSourceSequence = ?, lastOccurredAt = ?, lastObservedAt = ?, gapFromSequence = ?, gapToSequence = ?, status = ? WHERE sourceKind = ? AND sourceId = ?").run(
    updateDigest ? input.sourceDigest : current.sourceDigest,
    lastSourceSequence,
    updateDigest ? input.occurredAt : current.lastOccurredAt,
    Math.max(current.lastObservedAt, input.observedAt),
    gapFromSequence,
    gapToSequence,
    gapFromSequence === null ? "ok" : "gap",
    input.sourceKind,
    input.sourceId,
  )
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

function envelopeBody(envelope: RelayEnvelopeV1): string {
  const value: RelayJson = {
    v: envelope.v,
    envelopeId: envelope.envelopeId,
    origin: {
      nodeId: envelope.origin.nodeId,
      hostEpoch: envelope.origin.hostEpoch,
      sessionId: envelope.origin.sessionId,
      ...(envelope.origin.agentId === undefined ? {} : { agentId: envelope.origin.agentId }),
      streamId: envelope.origin.streamId,
      sequence: envelope.origin.sequence,
    },
    destination: { nodeId: envelope.destination.nodeId, peerId: envelope.destination.peerId },
    kind: envelope.kind,
    createdAt: envelope.createdAt,
    ...(envelope.expiresAt === undefined ? {} : { expiresAt: envelope.expiresAt }),
    payloadVersion: envelope.payloadVersion,
    payloadHash: envelope.payloadHash,
    payload: envelope.payload,
  }
  return canonicalRelayJson(value)
}

function canonicalRelayJson(value: RelayJson): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalRelayJson).join(",")}]`
  const objectValue = value as { readonly [key: string]: RelayJson }
  return `{${Object.keys(objectValue).sort().map((key) => `${JSON.stringify(key)}:${canonicalRelayJson(objectValue[key]!)}`).join(",")}}`
}

function relayEventId(): string {
  return crypto.randomUUID()
}

function enqueueRelayEnvelope(sqlite: Database, envelope: RelayEnvelopeV1): InsertResult {
  const body = envelopeBody(envelope)
  const result = sqlite.query<{ envelope_id: string }, [string, string, string, number, string, string, string, string, string, number, number]>(
    "INSERT INTO relay_outbox (envelope_id, origin_node_id, stream_id, sequence, destination_node_id, destination_peer_id, kind, body, body_sha256, state, attempt_count, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?) ON CONFLICT(envelope_id) DO NOTHING RETURNING envelope_id",
  ).all(envelope.envelopeId, envelope.origin.nodeId, envelope.origin.streamId, envelope.origin.sequence, envelope.destination.nodeId, envelope.destination.peerId, envelope.kind, body, envelope.payloadHash, envelope.createdAt, envelope.createdAt)
  if (result.length === 0) {
    const existing = sqlite.query<{ body: string }, [string]>("SELECT body FROM relay_outbox WHERE envelope_id = ?").get(envelope.envelopeId)
    if (existing == null || existing.body !== body) throw new Error("Relay envelope idempotency conflict")
  }
  return { inserted: result.length > 0 }
}

function scheduleRelayRetry(sqlite: Database, input: RelayRetryInput): InsertResult {
  const result = sqlite.query<{ envelope_id: string }, [number, string]>("UPDATE relay_outbox SET attempt_count = attempt_count + 1, next_attempt_at = ? WHERE envelope_id = ? AND state = 'pending' RETURNING envelope_id").all(input.nextAttemptAt, input.envelopeId)
  return { inserted: result.length > 0 }
}

function acceptRelayOutbox(sqlite: Database, input: RelayOutboxAcceptance): InsertResult {
  const result = sqlite.query<{ envelope_id: string }, [number, string]>("UPDATE relay_outbox SET state = 'accepted', accepted_at = ? WHERE envelope_id = ? AND state = 'pending' RETURNING envelope_id").all(input.acceptedAt, input.envelopeId)
  return { inserted: result.length > 0 }
}

function receiveRelayEnvelope(sqlite: Database, input: RelayReceiveInput): RelayReceiveResult {
  if (input.receiverNodeId !== input.envelope.destination.nodeId) throw new Error("Relay destination mismatch")
  const committed = sqlite.transaction(() => {
    const body = envelopeBody(input.envelope)
    const prior = sqlite.query<{ body: string }, [string]>("SELECT body FROM relay_inbox WHERE envelope_id = ?").get(input.envelope.envelopeId)
    if (prior != null) {
      if (prior.body !== body) throw new Error("Relay envelope idempotency conflict")
      const receipt = sqlite.query<{ received_at: number; cursor_json: string }, [string, string]>("SELECT received_at, cursor_json FROM relay_receipts WHERE envelope_id = ? AND destination_node_id = ?").get(input.envelope.envelopeId, input.receiverNodeId)
      if (receipt == null) throw new Error("Relay receipt missing")
      return { disposition: "duplicate" as const, receivedAt: receipt.received_at, cursorJson: receipt.cursor_json }
    }
    const conflictingSequence = sqlite.query<{ envelope_id: string }, [string, string, string, number]>("SELECT envelope_id FROM relay_inbox WHERE destination_node_id = ? AND origin_node_id = ? AND stream_id = ? AND sequence = ?").get(input.receiverNodeId, input.envelope.origin.nodeId, input.envelope.origin.streamId, input.envelope.origin.sequence)
    if (conflictingSequence != null) throw new Error("Contradictory relay stream sequence")
    sqlite.query("INSERT INTO relay_inbox (envelope_id, origin_node_id, stream_id, sequence, destination_node_id, destination_peer_id, kind, body, body_sha256, received_at, adapter_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')").run(input.envelope.envelopeId, input.envelope.origin.nodeId, input.envelope.origin.streamId, input.envelope.origin.sequence, input.envelope.destination.nodeId, input.envelope.destination.peerId, input.envelope.kind, body, input.envelope.payloadHash, input.receivedAt)
    const cursor = advanceCursor(sqlite, input.receiverNodeId, input.envelope.origin.nodeId, input.envelope.origin.streamId, input.receivedAt)
    const cursorJson = JSON.stringify(cursor) ?? "null"
    sqlite.query("INSERT INTO relay_receipts (envelope_id, destination_node_id, disposition, received_at, cursor_json) VALUES (?, ?, 'accepted', ?, ?)").run(input.envelope.envelopeId, input.receiverNodeId, input.receivedAt, cursorJson)
    return { disposition: "accepted" as const, receivedAt: input.receivedAt, cursorJson }
  })()
  const cursor = committed.cursorJson === "null" ? undefined : decodeRelayCursorV1(JSON.parse(committed.cursorJson))
  const receipt = makeReceipt(input.receiverNodeId, input.envelope.envelopeId, committed.receivedAt, cursor)
  return { disposition: committed.disposition, receipt, cursor }
}

function makeReceipt(destinationNodeId: string, envelopeId: string, acceptedAt: number, cursor: RelayAckV1["destinationCursor"]): RelayAckV1 {
  return cursor === undefined
    ? { v: 1, destinationNodeId, envelopeId, acceptedAt, disposition: "accepted" }
    : { v: 1, destinationNodeId, envelopeId, acceptedAt, disposition: "accepted", destinationCursor: cursor }
}

function advanceCursor(sqlite: Database, receiver: string, origin: string, stream: string, now: number): RelayAckV1["destinationCursor"] {
  const current = sqlite.query<{ highest_contiguous_sequence: number }, [string, string, string]>("SELECT highest_contiguous_sequence FROM relay_cursors WHERE receiver_node_id = ? AND origin_node_id = ? AND stream_id = ?").get(receiver, origin, stream)
  let highest = current?.highest_contiguous_sequence ?? -1
  while (sqlite.query<{ envelope_id: string }, [string, string, string, number]>("SELECT envelope_id FROM relay_inbox WHERE destination_node_id = ? AND origin_node_id = ? AND stream_id = ? AND sequence = ?").get(receiver, origin, stream, highest + 1) != null) highest += 1
  const received = sqlite.query<{ sequence: number }, [string, string, string, number]>("SELECT sequence FROM relay_inbox WHERE destination_node_id = ? AND origin_node_id = ? AND stream_id = ? AND sequence > ? ORDER BY sequence").all(receiver, origin, stream, highest).map((row) => row.sequence)
  const maxSequence = received.at(-1) ?? highest
  const receivedSet = new Set(received)
  const holes: number[] = []
  for (let sequence = highest + 1; sequence < maxSequence; sequence += 1) if (!receivedSet.has(sequence)) holes.push(sequence)
  sqlite.query("INSERT INTO relay_cursors (receiver_node_id, origin_node_id, stream_id, highest_contiguous_sequence, holes_json, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(receiver_node_id, origin_node_id, stream_id) DO UPDATE SET highest_contiguous_sequence = excluded.highest_contiguous_sequence, holes_json = excluded.holes_json, updated_at = excluded.updated_at").run(receiver, origin, stream, highest, JSON.stringify(holes), now)
  return highest < 0 ? undefined : { v: 1, originNodeId: origin, streamId: stream, sequence: highest }
}

function listPendingRelayOutbox(sqlite: Database, now: number, limit = 100): readonly RelayOutboxItem[] {
  return sqlite.query<{ body: string; attempt_count: number; next_attempt_at: number }, [number, number]>("SELECT body, attempt_count, next_attempt_at FROM relay_outbox WHERE state = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at, envelope_id LIMIT ?").all(now, Math.max(1, Math.min(limit, 1_000))).map((row) => ({ envelope: decodeRelayEnvelopeV1(JSON.parse(row.body)), attemptCount: row.attempt_count, nextAttemptAt: row.next_attempt_at }))
}

function recordRelayAdapterDelivery(sqlite: Database, input: RelayAdapterDelivery): InsertResult {
  return sqlite.transaction(() => {
    const row = sqlite.query<{ adapter_state: string; adapter_message_id: string | null }, [string]>("SELECT adapter_state, adapter_message_id FROM relay_inbox WHERE envelope_id = ?").get(input.envelopeId)
    if (row == null) return { inserted: false }
    if (row.adapter_state === "delivered_to_local_bus") {
      if (row.adapter_message_id !== input.messageId) throw new Error("Relay adapter delivery conflict")
      return { inserted: false }
    }
    const updated = sqlite.query<{ envelope_id: string }, [string, string]>("UPDATE relay_inbox SET adapter_state = 'delivered_to_local_bus', adapter_message_id = ? WHERE envelope_id = ? AND adapter_state = 'pending' RETURNING envelope_id").all(input.messageId, input.envelopeId)
    return { inserted: updated.length > 0 }
  })()
}

function upsertRelayNode(sqlite: Database, input: RelayNodeInput): InsertResult {
  const node = input.identity
  sqlite.query("INSERT INTO relay_nodes (node_id, display_name, protocol_versions, first_seen_at, last_seen_at, last_host_epoch) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(node_id) DO UPDATE SET display_name = excluded.display_name, protocol_versions = excluded.protocol_versions, last_seen_at = excluded.last_seen_at, last_host_epoch = excluded.last_host_epoch").run(node.nodeId, node.displayName, JSON.stringify(node.protocolVersions), node.observedAt, node.observedAt, node.hostEpoch)
  return { inserted: true }
}

function upsertRelayRoute(sqlite: Database, route: PeerRouteV1, alias: string | undefined, enabled: boolean, updatedAt: number): InsertResult {
  sqlite.query("INSERT INTO relay_peer_routes (node_id, peer_id, alias, endpoint, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(node_id, peer_id) DO UPDATE SET alias = excluded.alias, endpoint = excluded.endpoint, enabled = excluded.enabled, updated_at = excluded.updated_at").run(route.nodeId, route.peerId, alias ?? null, route.endpoint, enabled ? 1 : 0, updatedAt)
  return { inserted: true }
}

function recordRelayHealth(sqlite: Database, input: RelayHealthInput): InsertResult {
  const health = input.health
  sqlite.query("INSERT INTO relay_peer_health (observer_node_id, peer_node_id, state, last_success_at, last_failure_at, consecutive_failures, queue_depth, oldest_unacked_ms, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(observer_node_id, peer_node_id) DO UPDATE SET state = excluded.state, last_success_at = excluded.last_success_at, last_failure_at = excluded.last_failure_at, consecutive_failures = excluded.consecutive_failures, queue_depth = excluded.queue_depth, oldest_unacked_ms = excluded.oldest_unacked_ms, detail = excluded.detail").run(input.observerNodeId, health.nodeId, health.status, health.lastAcceptedAt ?? null, input.lastFailureAt ?? null, input.consecutiveFailures, health.pendingEnvelopes, health.oldestPendingAt === undefined ? null : health.observedAt - health.oldestPendingAt, health.detail ?? null)
  return { inserted: true }
}
function listRelayNodes(sqlite: Database): readonly RelayNodeRecord[] {
  return sqlite.query<{ node_id: string; display_name: string; protocol_versions: string; first_seen_at: number; last_seen_at: number; last_host_epoch: string }, []>("SELECT node_id, display_name, protocol_versions, first_seen_at, last_seen_at, last_host_epoch FROM relay_nodes ORDER BY node_id").all().map((row) => ({
    nodeId: row.node_id,
    displayName: row.display_name,
    protocolVersions: parseProtocolVersions(row.protocol_versions),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastHostEpoch: row.last_host_epoch,
  }))
}

function listRelayRoutes(sqlite: Database, nodeId: string | undefined): readonly RelayRouteRecord[] {
  const rows = nodeId === undefined
    ? sqlite.query<{ node_id: string; peer_id: string; alias: string | null; endpoint: string; enabled: number; updated_at: number }, []>("SELECT node_id, peer_id, alias, endpoint, enabled, updated_at FROM relay_peer_routes ORDER BY node_id, peer_id").all()
    : sqlite.query<{ node_id: string; peer_id: string; alias: string | null; endpoint: string; enabled: number; updated_at: number }, [string]>("SELECT node_id, peer_id, alias, endpoint, enabled, updated_at FROM relay_peer_routes WHERE node_id = ? ORDER BY peer_id").all(nodeId)
  return rows.map((row) => ({ nodeId: row.node_id, peerId: row.peer_id, ...(row.alias === null ? {} : { alias: row.alias }), endpoint: row.endpoint, enabled: row.enabled === 1, updatedAt: row.updated_at }))
}

function listRelayHealth(sqlite: Database, observerNodeId: string | undefined): readonly RelayHealthRecord[] {
  const rows = observerNodeId === undefined
    ? sqlite.query<{ observer_node_id: string; peer_node_id: string; state: string; last_success_at: number | null; last_failure_at: number | null; consecutive_failures: number; queue_depth: number; oldest_unacked_ms: number | null; detail: string | null }, []>("SELECT observer_node_id, peer_node_id, state, last_success_at, last_failure_at, consecutive_failures, queue_depth, oldest_unacked_ms, detail FROM relay_peer_health ORDER BY observer_node_id, peer_node_id").all()
    : sqlite.query<{ observer_node_id: string; peer_node_id: string; state: string; last_success_at: number | null; last_failure_at: number | null; consecutive_failures: number; queue_depth: number; oldest_unacked_ms: number | null; detail: string | null }, [string]>("SELECT observer_node_id, peer_node_id, state, last_success_at, last_failure_at, consecutive_failures, queue_depth, oldest_unacked_ms, detail FROM relay_peer_health WHERE observer_node_id = ? ORDER BY peer_node_id").all(observerNodeId)
  return rows.map((row) => ({
    observerNodeId: row.observer_node_id,
    peerNodeId: row.peer_node_id,
    state: relayHealthState(row.state),
    ...(row.last_success_at === null ? {} : { lastSuccessAt: row.last_success_at }),
    ...(row.last_failure_at === null ? {} : { lastFailureAt: row.last_failure_at }),
    consecutiveFailures: row.consecutive_failures,
    queueDepth: row.queue_depth,
    ...(row.oldest_unacked_ms === null ? {} : { oldestUnackedMs: row.oldest_unacked_ms }),
    ...(row.detail === null ? {} : { detail: row.detail }),
  }))
}

function relayQueueState(sqlite: Database): RelayQueueState {
  const outbox = sqlite.query<{ count: number; oldest: number | null }, []>("SELECT COUNT(*) AS count, MIN(created_at) AS oldest FROM relay_outbox WHERE state = 'pending'").get()
  const inbox = sqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM relay_inbox WHERE adapter_state = 'pending'").get()
  return { pendingOutbox: outbox?.count ?? 0, pendingInbox: inbox?.count ?? 0, ...(outbox?.oldest === null || outbox?.oldest === undefined ? {} : { oldestPendingOutboxAt: outbox.oldest }) }
}

function parseProtocolVersions(value: string): readonly number[] {
  const parsed = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some((version) => !Number.isSafeInteger(version) || version < 1)) throw new Error("Invalid persisted relay protocol versions")
  return parsed
}

function relayHealthState(value: string): RelayHealthRecord["state"] {
  if (value === "healthy" || value === "degraded" || value === "offline") return value
  throw new Error("Invalid persisted relay health state")
}

function workLease(input: LeaseClaimInput, epoch: string, attempt: number): WorkLeaseV1 {
  return { v: 1, packetId: input.packet.packetId, leaseEpoch: epoch, ownerNodeId: input.ownerNodeId, ownerSessionId: input.ownerSessionId, ownerAgentId: input.ownerAgentId, acquiredAt: input.acquiredAt, renewBy: input.renewBy, attempt }
}

function appendLeaseEvent(sqlite: Database, packetId: string, epoch: string | null, eventKind: string, actorNodeId: string | null, at: number): void {
  sqlite.query("INSERT INTO packet_lease_events (id, packet_id, epoch, event_kind, actor_node_id, ts, detail) VALUES (?, ?, ?, ?, ?, ?, '{}')").run(relayEventId(), packetId, epoch, eventKind, actorNodeId, at)
}

function assertPacketIdentity(sqlite: Database, packet: WorkPacketV1): void {
  const existing = sqlite.query<{ relay_envelope_id: string | null; relay_origin_node_id: string | null; relay_destination_node_id: string | null; relay_payload_version: number | null; relay_payload: string | null; relay_idempotency: string | null; relay_expires_at: number | null }, [string]>("SELECT relay_envelope_id, relay_origin_node_id, relay_destination_node_id, relay_payload_version, relay_payload, relay_idempotency, relay_expires_at FROM packets WHERE id = ?").get(packet.packetId)
  if (existing == null) return
  if (existing.relay_envelope_id !== packet.envelopeId || existing.relay_origin_node_id !== packet.originNodeId || existing.relay_destination_node_id !== packet.destinationNodeId || existing.relay_payload_version !== packet.payloadVersion || existing.relay_payload !== canonicalRelayJson(packet.payload) || existing.relay_idempotency !== packet.idempotency || existing.relay_expires_at !== (packet.expiresAt ?? null)) throw new Error("Work packet idempotency conflict")
}

function claimWorkLease(sqlite: Database, input: LeaseClaimInput): LeaseMutationResult {
  return sqlite.transaction(() => {
    assertPacketIdentity(sqlite, input.packet)
    const existing = sqlite.query<{ attempt: number; renew_by: number; state: string; idempotency: string }, [string]>("SELECT attempt, renew_by, state, idempotency FROM packet_leases WHERE packet_id = ?").get(input.packet.packetId)
    if (existing != null && (existing.state === "orphaned" || existing.state === "completed" || existing.state === "failed" || existing.state === "cancelled" || existing.state === "fenced" || (existing.state === "leased" && (existing.renew_by >= input.acquiredAt || existing.idempotency === "unsafe")))) return { fenced: true }
    const attempt = (existing?.attempt ?? 0) + 1
    const lease = workLease(input, crypto.randomUUID(), attempt)
    const payloadJson = canonicalRelayJson(input.packet.payload)
    sqlite.query("INSERT INTO packets (id, title, lane, status, summary, ownerPaths, excludedPaths, relay_envelope_id, relay_origin_node_id, relay_destination_node_id, relay_payload_version, relay_payload, relay_idempotency, relay_expires_at, createdAt, updatedAt, claimedAt) VALUES (?, 'Remote work', 'relay', 'leased', ?, '[]', '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = 'leased', updatedAt = excluded.updatedAt, claimedAt = excluded.claimedAt").run(input.packet.packetId, payloadJson, input.packet.envelopeId, input.packet.originNodeId, input.packet.destinationNodeId, input.packet.payloadVersion, payloadJson, input.packet.idempotency, input.packet.expiresAt ?? null, input.acquiredAt, input.acquiredAt, input.acquiredAt)
    sqlite.query("INSERT INTO packet_leases (packet_id, epoch, owner_node_id, owner_session_id, owner_agent_id, attempt, acquired_at, renew_by, state, idempotency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'leased', ?) ON CONFLICT(packet_id) DO UPDATE SET epoch = excluded.epoch, owner_node_id = excluded.owner_node_id, owner_session_id = excluded.owner_session_id, owner_agent_id = excluded.owner_agent_id, attempt = excluded.attempt, acquired_at = excluded.acquired_at, renew_by = excluded.renew_by, state = 'leased', idempotency = excluded.idempotency").run(lease.packetId, lease.leaseEpoch, lease.ownerNodeId, lease.ownerSessionId, lease.ownerAgentId, lease.attempt, lease.acquiredAt, lease.renewBy, input.packet.idempotency)
    appendLeaseEvent(sqlite, lease.packetId, lease.leaseEpoch, "leased", lease.ownerNodeId, input.acquiredAt)
    return { fenced: false, lease }
  })()
}

function renewWorkLease(sqlite: Database, input: LeaseRenewalInput): LeaseMutationResult {
  return sqlite.transaction(() => {
    const row = sqlite.query<{ packet_id: string; attempt: number; owner_session_id: string; owner_agent_id: string; acquired_at: number }, [number, string, string, string]>("UPDATE packet_leases SET renew_by = ? WHERE packet_id = ? AND epoch = ? AND owner_node_id = ? AND state = 'leased' RETURNING packet_id, attempt, owner_session_id, owner_agent_id, acquired_at").get(input.renewBy, input.packetId, input.leaseEpoch, input.ownerNodeId)
    if (row == null) return { fenced: true }
    appendLeaseEvent(sqlite, input.packetId, input.leaseEpoch, "renewed", input.ownerNodeId, input.at)
    return { fenced: false, lease: { v: 1 as const, packetId: row.packet_id, leaseEpoch: input.leaseEpoch, ownerNodeId: input.ownerNodeId, ownerSessionId: row.owner_session_id, ownerAgentId: row.owner_agent_id, acquiredAt: row.acquired_at, renewBy: input.renewBy, attempt: row.attempt } }
  })()
}

function finishWorkLease(sqlite: Database, input: LeaseMutationInput): LeaseMutationResult {
  return sqlite.transaction(() => {
    const state = input.state ?? "completed"
    const row = sqlite.query<{ packet_id: string }, [string, number, string, string, string]>("UPDATE packet_leases SET state = ?, renew_by = ? WHERE packet_id = ? AND epoch = ? AND owner_node_id = ? AND state = 'leased' RETURNING packet_id").get(state, input.at, input.packetId, input.leaseEpoch, input.ownerNodeId)
    if (row == null) return { fenced: true }
    sqlite.query("UPDATE packets SET status = ?, updatedAt = ?, doneAt = ? WHERE id = ?").run(state, input.at, state === "completed" ? input.at : null, input.packetId)
    appendLeaseEvent(sqlite, input.packetId, input.leaseEpoch, state, input.ownerNodeId, input.at)
    return { fenced: false }
  })()
}

function fenceWorkLease(sqlite: Database, input: LeaseMutationInput): LeaseMutationResult {
  return sqlite.transaction(() => {
    const row = sqlite.query<{ packet_id: string }, [number, string, string, string]>("UPDATE packet_leases SET state = 'fenced', renew_by = ? WHERE packet_id = ? AND epoch = ? AND owner_node_id = ? AND state = 'leased' RETURNING packet_id").get(input.at, input.packetId, input.leaseEpoch, input.ownerNodeId)
    if (row == null) return { fenced: true }
    sqlite.query("UPDATE packets SET status = 'fenced', updatedAt = ?, staleAt = ? WHERE id = ?").run(input.at, input.at, input.packetId)
    appendLeaseEvent(sqlite, input.packetId, input.leaseEpoch, "fenced", input.ownerNodeId, input.at)
    return { fenced: false }
  })()
}

function expireWorkLeases(sqlite: Database, now: number): readonly LeaseExpiry[] {
  return sqlite.transaction(() => sqlite.query<{ packet_id: string; idempotency: string; epoch: string }, [number]>("SELECT packet_id, idempotency, epoch FROM packet_leases WHERE state = 'leased' AND renew_by < ?").all(now).map((row) => {
    const state = row.idempotency === "safe" ? "queued" as const : "orphaned" as const
    sqlite.query("UPDATE packet_leases SET state = ?, renew_by = ? WHERE packet_id = ? AND epoch = ? AND state = 'leased'").run(state, now, row.packet_id, row.epoch)
    sqlite.query("UPDATE packets SET status = ?, updatedAt = ?, staleAt = ? WHERE id = ?").run(state, now, now, row.packet_id)
    appendLeaseEvent(sqlite, row.packet_id, row.epoch, state === "queued" ? "expired_requeued" : "expired_orphaned", null, now)
    return { packetId: row.packet_id, state }
  }))()
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

export function papercutFingerprint(input: PapercutInput): string {
  const shape = [input.kind, input.cwdOrPackage, input.commandOrTool, input.message]
    .map((value) => normalizePapercutShape(value ?? ""))
    .join("\u001f")
  return createHash("sha256").update(shape).digest("hex")
}

function reportPapercut(db: LedgerDb, logPath: string, input: PapercutReportInput): PapercutReportResult {
  const report = validatePapercutReport(input)
  const fingerprint = papercutFingerprint(report)
  mkdirSync(dirname(logPath), { recursive: true })
  appendFileSync(logPath, `${JSON.stringify({ version: 1, fingerprint, ...report })}\n`, "utf8")
  const row = db.transaction((tx) => upsertPapercut(tx, fingerprint, report))
  return { record: papercutRecord(row), appendedTo: logPath }
}

function upsertPapercut(db: LedgerDb, fingerprint: string, input: PapercutReportInput): PapercutRow {
  const existing = db.select().from(papercuts).where(eq(papercuts.fingerprint, fingerprint)).get()
  if (existing === undefined) {
    const values = papercutValues(fingerprint, input)
    db.insert(papercuts).values(values).run()
    return values
  }
  const updated = {
    timestamp: Math.max(existing.timestamp, input.timestamp),
    agentId: stableOptional(existing.agentId, input.agentId),
    modelId: stableOptional(existing.modelId, input.modelId),
    sessionId: stableOptional(existing.sessionId, input.sessionId),
    package: stableOptional(existing.package, input.cwdOrPackage),
    severity: higherSeverity(existing.severity, input.severity),
    commandOrTool: stableOptional(existing.commandOrTool, input.commandOrTool),
    message: stableRequired(existing.message, input.message),
    evidence: stableOptional(existing.evidence, input.evidenceArtifactId),
    suggestedFix: stableOptional(existing.suggestedFix, input.suggestedFix),
    status: "recurring" as const,
    occurrences: existing.occurrences + 1,
    firstSeenAt: Math.min(existing.firstSeenAt, input.timestamp),
    lastSeenAt: Math.max(existing.lastSeenAt, input.timestamp),
  }
  db.update(papercuts).set(updated).where(eq(papercuts.fingerprint, fingerprint)).run()
  return { ...existing, ...updated }
}

function papercutValues(fingerprint: string, input: PapercutReportInput): PapercutRow {
  return {
    fingerprint,
    timestamp: input.timestamp,
    agentId: input.agentId ?? null,
    modelId: input.modelId ?? null,
    sessionId: input.sessionId ?? null,
    package: input.cwdOrPackage ?? null,
    kind: input.kind,
    severity: input.severity,
    commandOrTool: input.commandOrTool ?? null,
    message: input.message,
    evidence: input.evidenceArtifactId ?? null,
    suggestedFix: input.suggestedFix ?? null,
    status: "new",
    occurrences: 1,
    firstSeenAt: input.timestamp,
    lastSeenAt: input.timestamp,
  }
}

function listPapercutRows(db: LedgerDb, filters: PapercutFilters): PapercutRecord[] {
  const clauses = [
    filters.severity === undefined ? undefined : eq(papercuts.severity, filters.severity),
    filters.status === undefined ? undefined : eq(papercuts.status, filters.status),
  ].filter((clause) => clause !== undefined)
  return db.select().from(papercuts).where(clauses.length === 0 ? undefined : and(...clauses)).orderBy(desc(papercuts.timestamp), desc(papercuts.occurrences), papercuts.fingerprint).limit(limitOrDefault(filters.limit)).all().map(papercutRecord)
}

function papercutRecord(row: PapercutRow): PapercutRecord {
  const decoded = Schema.decodeUnknownSync(PapercutInputSchema)(papercutSchemaInput({ kind: row.kind, severity: row.severity, message: row.message, commandOrTool: row.commandOrTool ?? undefined, cwdOrPackage: row.package ?? undefined, evidenceArtifactId: row.evidence ?? undefined, suggestedFix: row.suggestedFix ?? undefined }))
  return {
    fingerprint: row.fingerprint,
    timestamp: row.timestamp,
    agentId: row.agentId ?? undefined,
    modelId: row.modelId ?? undefined,
    sessionId: row.sessionId ?? undefined,
    package: decoded.cwdOrPackage,
    kind: decoded.kind,
    severity: decoded.severity,
    commandOrTool: decoded.commandOrTool,
    message: decoded.message,
    evidence: decoded.evidenceArtifactId,
    suggestedFix: decoded.suggestedFix,
    status: Schema.decodeUnknownSync(PapercutStatusSchema)(row.status),
    occurrences: row.occurrences,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
  }
}

function validatePapercutReport(input: PapercutReportInput): PapercutReportInput {
  if (!Number.isSafeInteger(input.timestamp) || input.timestamp < 0) throw new Error("Papercut timestamp must be a non-negative safe integer")
  const decoded = Schema.decodeUnknownSync(PapercutInputSchema)(papercutSchemaInput(input))
  const message = requiredPapercutText("message", decoded.message, 4_000)
  return {
    ...decoded,
    message,
    commandOrTool: optionalPapercutText("commandOrTool", decoded.commandOrTool, 2_048),
    cwdOrPackage: optionalPapercutText("cwdOrPackage", decoded.cwdOrPackage, 2_048),
    evidenceArtifactId: optionalPapercutText("evidenceArtifactId", decoded.evidenceArtifactId, 2_048),
    suggestedFix: optionalPapercutText("suggestedFix", decoded.suggestedFix, 4_000),
    timestamp: input.timestamp,
    agentId: optionalPapercutText("agentId", input.agentId, 256),
    modelId: optionalPapercutText("modelId", input.modelId, 256),
    sessionId: optionalPapercutText("sessionId", input.sessionId, 256),
  }
}

interface PapercutSchemaInput {
  readonly kind: string
  readonly severity: string
  readonly message: string
  readonly commandOrTool?: string
  readonly cwdOrPackage?: string
  readonly evidenceArtifactId?: string
  readonly suggestedFix?: string
}

function papercutSchemaInput(input: PapercutSchemaInput): PapercutSchemaInput {
  const values: {
    kind: string
    severity: string
    message: string
    commandOrTool?: string
    cwdOrPackage?: string
    evidenceArtifactId?: string
    suggestedFix?: string
  } = { kind: input.kind, severity: input.severity, message: input.message }
  if (input.commandOrTool !== undefined) values.commandOrTool = input.commandOrTool
  if (input.cwdOrPackage !== undefined) values.cwdOrPackage = input.cwdOrPackage
  if (input.evidenceArtifactId !== undefined) values.evidenceArtifactId = input.evidenceArtifactId
  if (input.suggestedFix !== undefined) values.suggestedFix = input.suggestedFix
  return values
}

function requiredPapercutText(field: string, value: string, maxLength: number): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maxLength) throw new Error(`Papercut ${field} must be between 1 and ${maxLength} characters`)
  return normalized
}

function optionalPapercutText(field: string, value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) return undefined
  return requiredPapercutText(field, value, maxLength)
}

function normalizePapercutShape(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/\b(?:0x)?[a-f0-9]{8,}\b|\b\d+\b/g, "#")
}

function stableOptional(left: string | null, right: string | undefined): string | null {
  if (left === null) return right ?? null
  if (right === undefined) return left
  return left.localeCompare(right) <= 0 ? left : right
}

function stableRequired(left: string, right: string): string {
  return left.localeCompare(right) <= 0 ? left : right
}

function higherSeverity(left: string, right: PapercutSeverity): PapercutSeverity {
  const rank = { low: 0, medium: 1, high: 2 } as const
  const decoded = Schema.decodeUnknownSync(PapercutSeveritySchema)(left)
  return rank[decoded] >= rank[right] ? decoded : right
}

function defaultPapercutLogPath(dbPath: string): string {
  const basePath = dbPath === ":memory:" ? join(homedir(), ".agent-control-plane", "ledger.sqlite") : dbPath
  return join(dirname(resolve(basePath)), "papercuts.jsonl")
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
  return new StorageError({ operation, message: errorMessage(cause), cause: errorMessage(cause), context: context ?? "" })
}

function artifactError(operation: string, cause: unknown, context?: string): ArtifactError {
  return new ArtifactError({ operation, message: errorMessage(cause), cause: errorMessage(cause), context: context ?? "" })
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
