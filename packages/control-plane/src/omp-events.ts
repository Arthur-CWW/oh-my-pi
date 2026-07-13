import { Schema } from "effect"

import { JsonValueSchema, type JsonValue } from "./outbox"

export interface PiLike {
  on(event: "session_start", handler: ExtensionHandler<SessionStartPayload>): void
  on(event: "turn_start", handler: ExtensionHandler<TurnPayload>): void
  on(event: "turn_end", handler: ExtensionHandler<TurnPayload>): void
  on(event: "message_end", handler: ExtensionHandler<MessageEndPayload>): void
  on(event: "message_start", handler: ExtensionHandler<MessageStartPayload>): void
  on(event: "session_switch", handler: ExtensionHandler<SessionSwitchPayload>): void
  on(event: "session_branch", handler: ExtensionHandler<SessionBranchPayload>): void
  on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownPayload>): void
  on(event: "before_provider_request", handler: ExtensionHandler<BeforeProviderRequestPayload>): void
  on(event: string, handler: ExtensionHandler<never>): void
}

export type ExtensionHandler<E> = (event: E, ctx: ExtensionContextLike) => unknown

export interface SessionEntryLike {
  readonly id: string
  readonly parentId?: string | null
  readonly timestamp?: string | number
  readonly type?: string
  readonly message?: {
    readonly role?: string
    readonly timestamp?: number
  }
  readonly model?: string
}

export interface SessionManagerLike {
  getSessionId(): string
  getSessionFile(): string
  getEntries?: () => ReadonlyArray<SessionEntryLike>
}

export interface ExtensionContextLike {
  readonly cwd?: string
  readonly sessionManager: SessionManagerLike
}

export type OmpTimestamp = number | string | Date

export interface SessionStartPayload {
  readonly type?: "session_start"
  readonly timestamp?: OmpTimestamp
  readonly workspace?: string
  readonly title?: string
  readonly parentSession?: string
  readonly machine?: string
}

export interface TurnPayload {
  readonly type?: "turn_start" | "turn_end"
  readonly sessionId?: string
  readonly branchId?: string
  readonly turnId?: string
  readonly turnIndex?: number
  readonly seq?: number
  readonly timestamp?: OmpTimestamp
  readonly startedAt?: OmpTimestamp
  readonly endedAt?: OmpTimestamp
  readonly contextTokens?: number
  readonly toolCalls?: number
  readonly toolResults?: readonly JsonValue[]
  readonly toolCallSummary?: JsonValue
  readonly editBytes?: number
  readonly duration?: number
  readonly turnDurationMs?: number
  readonly yieldKind?: string
  readonly message?: AssistantMessage
}

export interface AssistantUsage {
  readonly input?: number
  readonly output?: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
  readonly cost?: number
  readonly totalTokens?: number
  readonly reasoningTokens?: number
  readonly premiumRequests?: number
}

export interface AssistantMessage {
  readonly role?: string
  readonly api?: string
  readonly provider?: string
  readonly upstreamProvider?: string
  readonly model?: string
  readonly usage?: AssistantUsage
  readonly stopReason?: string
  readonly stopDetails?: JsonValue
  readonly errorMessage?: string
  readonly errorStatus?: string
  readonly disabledFeatures?: readonly string[]
  readonly providerPayload?: JsonValue
  readonly timestamp?: OmpTimestamp
  readonly duration?: number
  readonly ttft?: number
  readonly thinkingLevel?: string
}

export interface MessageEndPayload {
  readonly type?: "message_end"
  readonly sessionId?: string
  readonly branchId?: string
  readonly timestamp?: OmpTimestamp
  readonly message: AssistantMessage
}

export interface MessageStartPayload {
  readonly type?: "message_start"
  readonly sessionId?: string
  readonly branchId?: string
  readonly timestamp?: OmpTimestamp
}

export interface BeforeProviderRequestPayload {
  readonly type?: "before_provider_request"
  readonly sessionId?: string
  readonly branchId?: string
  readonly timestamp?: OmpTimestamp
  readonly provider?: string
  readonly model?: string
  readonly api?: string
  readonly payload?: JsonValue
}

export interface SessionSwitchPayload {
  readonly type?: "session_switch"
  readonly reason?: "new" | "resume" | "fork" | string
  readonly sessionId?: string
  readonly sessionFile?: string
  readonly previousSessionId?: string
  readonly previousSessionFile?: string
  readonly parentSession?: string
  readonly branchId?: string
  readonly timestamp?: OmpTimestamp
  readonly sessionManager?: SessionManagerLike
}

export interface SessionBranchPayload {
  readonly type?: "session_branch"
  readonly sessionId?: string
  readonly sessionFile?: string
  readonly sourceSessionId?: string
  readonly sourceSessionFile?: string
  readonly previousSessionFile?: string
  readonly parentSession?: string
  readonly branchId?: string
  readonly parentBranchId?: string
  readonly leafId?: string
  readonly atTurn?: number
  readonly timestamp?: OmpTimestamp
  readonly sessionManager?: SessionManagerLike
}

export interface SessionShutdownPayload {
  readonly type?: "session_shutdown"
  readonly sessionId?: string
  readonly sessionFile?: string
  readonly timestamp?: OmpTimestamp
  readonly reason?: string
  readonly sessionManager?: SessionManagerLike
}

export type JsonObject = { readonly [key: string]: JsonValue }

export const AgentStateSchema = Schema.Literals([
  "scheduled", "resolved", "running", "interrupted", "cancelled", "idle", "parked", "completed", "failed",
])
export type AgentState = Schema.Schema.Type<typeof AgentStateSchema>

export const PolicyLayerSchema = Schema.Literals([
  "hard_constraint", "spawn_explicit", "session_strategy", "workspace_policy", "global_policy",
])
export type PolicyLayer = Schema.Schema.Type<typeof PolicyLayerSchema>

export const AccountKindSchema = Schema.Literals(["configured", "ambient", "none"])
export type AccountKind = Schema.Schema.Type<typeof AccountKindSchema>

export const EffortSchema = Schema.Union([
  Schema.Literals(["none", "low", "medium", "high", "high_plus"]),
  Schema.TemplateLiteral(["provider_defined:", Schema.String]),
])
export type Effort = Schema.Schema.Type<typeof EffortSchema>

export const LifecycleKindSchema = Schema.Literals([
  "spawn_scheduled", "spawn_started", "interrupt", "cancel", "idle", "park", "adopt", "revive",
  "interrupted_by_restart", "completed", "failed",
])
export type LifecycleKind = Schema.Schema.Type<typeof LifecycleKindSchema>

export const RouteChangeKindSchema = Schema.Literals([
  "spawn_resolved", "model_change", "thinking_change", "account_change", "hotswap", "fallback", "revert", "advisor_change",
])
export type RouteChangeKind = Schema.Schema.Type<typeof RouteChangeKindSchema>

export const TimelineKindSchema = Schema.Union([LifecycleKindSchema, RouteChangeKindSchema])
export type TimelineKind = Schema.Schema.Type<typeof TimelineKindSchema>

const NullableStringSchema = Schema.Union([Schema.String, Schema.Null])
const NullableAgentStateSchema = Schema.Union([AgentStateSchema, Schema.Null])

const EventLinkageFields = {
  agentId: Schema.String,
  agentSeq: Schema.Int,
  agentSessionId: NullableStringSchema,
  parentSessionId: NullableStringSchema,
  parentAgentId: NullableStringSchema,
  taskId: NullableStringSchema,
  packetId: NullableStringSchema,
  branchId: NullableStringSchema,
  turnId: NullableStringSchema,
}

export const EventLinkageSchema = Schema.Struct(EventLinkageFields)
export type EventLinkage = Schema.Schema.Type<typeof EventLinkageSchema>

export const ArtifactHandleSchema = Schema.Struct({
  role: Schema.Literals(["sessionJournal", "taskInput", "taskOutput", "rawRequest", "rawResponse", "contextManifest", "resolverTrace", "error", "review", "other"]),
  artifactId: Schema.String,
})
export type ArtifactHandle = Schema.Schema.Type<typeof ArtifactHandleSchema>

export const AgentTimelinePayloadV1Schema = Schema.Struct({ ...EventLinkageFields,
  payloadVersion: Schema.Literal(1),
  eventId: Schema.String,
  occurredAt: Schema.Int,
  kind: LifecycleKindSchema,
  fromState: NullableAgentStateSchema,
  toState: NullableAgentStateSchema,
  reason: NullableStringSchema,
  errorClass: NullableStringSchema,
  detail: Schema.Record(Schema.String, JsonValueSchema),
  artifacts: Schema.Array(ArtifactHandleSchema),
})
export type AgentTimelinePayloadV1 = Schema.Schema.Type<typeof AgentTimelinePayloadV1Schema>

export const RouteConstraintSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["quality", "latency", "budget", "context", "tool", "privacy", "auth", "availability", "review_independence", "other"]),
  requirement: Schema.String,
  hard: Schema.Boolean,
  sourceLayer: PolicyLayerSchema,
  sourceRef: Schema.String,
})
export type RouteConstraint = Schema.Schema.Type<typeof RouteConstraintSchema>

export const ConsultedSourceSchema = Schema.Struct({
  layer: PolicyLayerSchema,
  sourceRef: Schema.String,
  values: Schema.Record(Schema.String, JsonValueSchema),
})
export type ConsultedSource = Schema.Schema.Type<typeof ConsultedSourceSchema>

export const OverriddenValueSchema = Schema.Struct({
  field: Schema.Literals(["lane", "provider", "model", "account", "effort", "advisor", "fallback"]),
  losingLayer: PolicyLayerSchema,
  losingSourceRef: Schema.String,
  losingValue: JsonValueSchema,
  winningLayer: PolicyLayerSchema,
  winningSourceRef: Schema.String,
  winningValue: JsonValueSchema,
  reason: Schema.String,
})
export type OverriddenValue = Schema.Schema.Type<typeof OverriddenValueSchema>

export const AccountResolutionSchema = Schema.Struct({
  kind: AccountKindSchema,
  ref: NullableStringSchema,
  provenance: Schema.Record(Schema.String, JsonValueSchema),
})
export type AccountResolution = Schema.Schema.Type<typeof AccountResolutionSchema>

export const RouteCandidateV1Schema = Schema.Struct({
  ordinal: Schema.Int,
  lane: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  account: AccountResolutionSchema,
  effort: EffortSchema,
  disposition: Schema.Literals(["selected", "rejected", "fallback"]),
  fallbackOrdinal: Schema.Union([Schema.Int, Schema.Null]),
  rejectionCode: NullableStringSchema,
  rejectionReason: NullableStringSchema,
  failedConstraintIds: Schema.Array(Schema.String),
})
export type RouteCandidateV1 = Schema.Schema.Type<typeof RouteCandidateV1Schema>

export const AdvisorRouteV1Schema = Schema.Struct({
  ordinal: Schema.Int,
  advisorAgentId: NullableStringSchema,
  purpose: Schema.String,
  lane: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  account: AccountResolutionSchema,
  effort: EffortSchema,
  winningLayer: PolicyLayerSchema,
  independenceRequired: Schema.Boolean,
  rawAdviceArtifactId: NullableStringSchema,
})
export type AdvisorRouteV1 = Schema.Schema.Type<typeof AdvisorRouteV1Schema>

export const RouteResolutionPayloadV1Schema = Schema.Struct({ ...EventLinkageFields,
  payloadVersion: Schema.Literal(1),
  resolutionId: Schema.String,
  occurredAt: Schema.Int,
  changeKind: RouteChangeKindSchema,
  reason: NullableStringSchema,
  route: Schema.Struct({
    lane: Schema.String,
    provider: Schema.String,
    upstreamProvider: NullableStringSchema,
    model: Schema.String,
    account: AccountResolutionSchema,
    effort: EffortSchema,
  }),
  provenance: Schema.Struct({
    winningLayer: PolicyLayerSchema,
    constraints: Schema.Array(RouteConstraintSchema),
    consultedSources: Schema.Array(ConsultedSourceSchema),
    overriddenValues: Schema.Array(OverriddenValueSchema),
  }),
  candidates: Schema.Array(RouteCandidateV1Schema),
  fallbackFromResolutionId: NullableStringSchema,
  revertedFromResolutionId: NullableStringSchema,
  advisors: Schema.Array(AdvisorRouteV1Schema),
  rawDecisionArtifactId: NullableStringSchema,
  artifacts: Schema.Array(ArtifactHandleSchema),
})
export type RouteResolutionPayloadV1 = Schema.Schema.Type<typeof RouteResolutionPayloadV1Schema>

const NullableIntSchema = Schema.Union([Schema.Int, Schema.Null])
const NullableBooleanSchema = Schema.Union([Schema.Boolean, Schema.Null])

export const RunnerIdentityPayloadV1Schema = Schema.Struct({
  buildRevision: Schema.Struct({
    digest: Schema.String,
    version: Schema.String,
  }),
  runnerInstance: Schema.Struct({
    runnerInstanceId: Schema.String,
    startedAt: Schema.Int,
  }),
})
export type RunnerIdentityPayloadV1 = Schema.Schema.Type<typeof RunnerIdentityPayloadV1Schema>

export const RunnerEventPayloadV1Schema = Schema.Struct({
  payloadVersion: Schema.Literal(1),
  runnerIdentity: RunnerIdentityPayloadV1Schema,
  sessionId: Schema.String,
  ownerEpoch: Schema.String,
  kind: Schema.String,
  eventId: Schema.String,
  commandId: Schema.String,
  correlationId: Schema.String,
  causationId: NullableStringSchema,
  revision: Schema.Int,
  sequence: Schema.Int,
  sessionRevision: NullableIntSchema,
  controllerEpoch: Schema.Int,
  viewId: NullableStringSchema,
  inputId: NullableStringSchema,
  durableSequence: NullableIntSchema,
  attemptId: NullableStringSchema,
  routeResolutionId: NullableStringSchema,
  quotaDecisionId: NullableStringSchema,
  toolCallId: NullableStringSchema,
  transcriptEntryId: NullableStringSchema,
  transcriptLeafId: NullableStringSchema,
  transcriptPosition: NullableIntSchema,
  targetGeneration: NullableIntSchema,
  targetCommandId: NullableStringSchema,
  targetOperationGeneration: NullableIntSchema,
  detail: JsonValueSchema,
})
export type RunnerEventPayloadV1 = Schema.Schema.Type<typeof RunnerEventPayloadV1Schema>

export const DiagnosticArtifactLinkPayloadV1Schema = Schema.Struct({
  role: Schema.String,
  artifactId: Schema.String,
  sha256: Schema.String,
  redactionPolicyId: Schema.String,
})
export type DiagnosticArtifactLinkPayloadV1 = Schema.Schema.Type<typeof DiagnosticArtifactLinkPayloadV1Schema>

export const DiagnosticOccurrencePayloadV1Schema = Schema.Struct({
  payloadVersion: Schema.Literal(1),
  diagnosticId: Schema.String,
  occurredAt: Schema.Int,
  failureClass: Schema.String,
  phase: Schema.String,
  message: Schema.String,
  requestFingerprint: NullableStringSchema,
  buildDigest: NullableStringSchema,
  runnerInstanceId: NullableStringSchema,
  runtimeIdentity: Schema.String,
  configHash: NullableStringSchema,
  manifestHash: NullableStringSchema,
  sessionId: NullableStringSchema,
  branchId: NullableStringSchema,
  turnId: NullableStringSchema,
  entryId: NullableStringSchema,
  agentId: NullableStringSchema,
  routeResolutionId: NullableStringSchema,
  inputId: NullableStringSchema,
  attemptId: NullableStringSchema,
  ownerEpoch: NullableStringSchema,
  explicitRoute: NullableBooleanSchema,
  outcome: NullableStringSchema,
  causeDiagnosticId: NullableStringSchema,
  retryOfAttemptId: NullableStringSchema,
  fallbackResolutionId: NullableStringSchema,
  interventionCommandId: NullableStringSchema,
  regressionId: NullableStringSchema,
  redactionPolicyId: Schema.String,
  artifacts: Schema.Array(DiagnosticArtifactLinkPayloadV1Schema),
})
export type DiagnosticOccurrencePayloadV1 = Schema.Schema.Type<typeof DiagnosticOccurrencePayloadV1Schema>

export const DiagnosticProjectionStateSchema = Schema.Literals(["unread", "acknowledged", "resolved", "reopened"])
export type DiagnosticProjectionState = Schema.Schema.Type<typeof DiagnosticProjectionStateSchema>

export const DiagnosticProjectionPayloadV1Schema = Schema.Struct({
  payloadVersion: Schema.Literal(1),
  projectionEventId: Schema.String,
  diagnosticId: Schema.String,
  occurredAt: Schema.Int,
  state: DiagnosticProjectionStateSchema,
  actor: NullableStringSchema,
  commandId: NullableStringSchema,
  sourceEntryId: Schema.String,
})
export type DiagnosticProjectionPayloadV1 = Schema.Schema.Type<typeof DiagnosticProjectionPayloadV1Schema>
