import { sql } from "drizzle-orm"
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  machine: text("machine").notNull(),
  harness: text("harness").notNull(),
  workspace: text("workspace").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
  meta: text("meta").notNull(),
})

export const branches = sqliteTable("branches", {
  id: text("id").primaryKey(),
  sessionId: text("sessionId").notNull(),
  parentBranchId: text("parentBranchId"),
  kind: text("kind").notNull(),
  atTurn: integer("atTurn"),
  createdAt: integer("createdAt").notNull(),
  meta: text("meta").notNull(),
})

export const turns = sqliteTable(
  "turns",
  {
    id: text("id").primaryKey(),
    sessionId: text("sessionId").notNull(),
    branchId: text("branchId").notNull(),
    seq: integer("seq").notNull(),
    startedAt: integer("startedAt").notNull(),
    endedAt: integer("endedAt"),
    contextTokens: integer("contextTokens").notNull(),
    toolCalls: integer("toolCalls").notNull(),
    toolCallSummary: text("toolCallSummary"),
    editBytes: integer("editBytes").notNull(),
    turnDurationMs: integer("turnDurationMs").notNull(),
    yieldKind: text("yieldKind").notNull(),
    affectSelfReport: text("affectSelfReport"),
    affectSignals: text("affectSignals"),
  },
  (table) => [index("turns_sessionId_branchId_seq_idx").on(table.sessionId, table.branchId, table.seq)],
)

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    ts: integer("ts").notNull(),
    sessionId: text("sessionId"),
    seq: integer("seq"),
    branchId: text("branchId"),
    packetId: text("packetId"),
    kind: text("kind").notNull(),
    payloadVersion: integer("payloadVersion").notNull(),
    payload: text("payload").notNull(),
  },
  (table) => [
    index("events_sessionId_ts_idx").on(table.sessionId, table.ts),
    index("events_kind_idx").on(table.kind),
    uniqueIndex("events_sessionId_seq_unique_idx").on(table.sessionId, table.seq).where(sql`seq IS NOT NULL`),
  ],
)

export const modelCalls = sqliteTable(
  "model_calls",
  {
    id: text("id").primaryKey(),
    ts: integer("ts").notNull(),
    machine: text("machine").notNull(),
    session: text("session").notNull(),
    entryId: text("entryId"),
    branchId: text("branchId").notNull(),
    agent: text("agent").notNull(),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    upstreamProvider: text("upstreamProvider"),
    effort: text("effort").notNull(),
    promptHash: text("promptHash").notNull(),
    systemPromptHash: text("systemPromptHash").notNull(),
    skillProfile: text("skillProfile").notNull(),
    contextManifest: text("contextManifest").notNull(),
    packetId: text("packetId").notNull(),
    tokensIn: integer("tokensIn").notNull(),
    tokensOut: integer("tokensOut").notNull(),
    cacheRead: integer("cacheRead").notNull(),
    cacheWrite: integer("cacheWrite").notNull(),
    cost: real("cost").notNull(),
    latencyMs: integer("latencyMs").notNull(),
    ttftMs: integer("ttftMs"),
    reasoningTokens: integer("reasoningTokens"),
    outcome: text("outcome").notNull(),
    errorClass: text("errorClass"),
    retryOf: text("retryOf"),
    fallbackFrom: text("fallbackFrom"),
    rawRequestArtifact: text("rawRequestArtifact").notNull(),
    rawResponseArtifact: text("rawResponseArtifact").notNull(),
    routeResolutionId: text("routeResolutionId"),
  },
  (table) => [
    index("model_calls_session_ts_idx").on(table.session, table.ts),
    index("model_calls_outcome_idx").on(table.outcome),
    index("model_calls_session_entryId_idx").on(table.session, table.entryId),
    index("model_calls_route_resolution_idx").on(table.routeResolutionId),
  ],
)

export const providerCalls = sqliteTable("provider_calls", {
  id: text("id").primaryKey(),
  ts: integer("ts").notNull(),
  sessionId: text("sessionId").notNull(),
  branchId: text("branchId"),
  packetId: text("packetId"),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  inputHash: text("inputHash").notNull(),
  rawRequestArtifact: text("rawRequestArtifact"),
  latencyMs: integer("latencyMs").notNull(),
  outcome: text("outcome").notNull(),
  errorClass: text("errorClass"),
  cost: real("cost"),
  usage: text("usage"),
})

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  ts: integer("ts").notNull(),
  sessionId: text("sessionId"),
  kind: text("kind").notNull(),
  contentPath: text("contentPath"),
  contentInline: text("contentInline"),
  sha256: text("sha256").notNull(),
  bytes: integer("bytes").notNull(),
  retention: text("retention").notNull(),
  meta: text("meta").notNull(),
})

export const packets = sqliteTable("packets", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  lane: text("lane").notNull(),
  status: text("status").notNull(),
  priority: integer("priority"),
  summary: text("summary"),
  sourcePointer: text("sourcePointer"),
  ownerPaths: text("ownerPaths").notNull(),
  excludedPaths: text("excludedPaths").notNull(),
  dirtyPaths: text("dirtyPaths"),
  workerSessionId: text("workerSessionId"),
  reviewerSessionId: text("reviewerSessionId"),
  branchId: text("branchId"),
  proofLinks: text("proofLinks"),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
  claimedAt: integer("claimedAt"),
  reviewReadyAt: integer("reviewReadyAt"),
  doneAt: integer("doneAt"),
  staleAt: integer("staleAt"),
})

export const commits = sqliteTable("commits", {
  sha: text("sha").primaryKey(),
  sessionId: text("sessionId").notNull(),
  agentId: text("agentId"),
  packetId: text("packetId"),
  ts: integer("ts").notNull(),
})

export const routingObservations = sqliteTable(
  "routing_observations",
  {
    id: text("id").primaryKey(),
    ts: integer("ts").notNull(),
    machine: text("machine").notNull(),
    session: text("session"),
    agent: text("agent"),
    lane: text("lane").notNull(),
    workType: text("workType").notNull(),
    verdict: text("verdict").notNull(),
    note: text("note").notNull(),
    evidence: text("evidence"),
    confidence: real("confidence"),
  },
  (table) => [
    index("routing_observations_lane_ts_idx").on(table.lane, table.ts),
    index("routing_observations_workType_ts_idx").on(table.workType, table.ts),
    index("routing_observations_verdict_ts_idx").on(table.verdict, table.ts),
  ],
)

export const laneState = sqliteTable("lane_state", {
  lane: text("lane").primaryKey(),
  updatedTs: integer("updatedTs").notNull(),
  updatedBy: text("updatedBy").notNull(),
  status: text("status").notNull(),
  exhaustedUntilTs: integer("exhaustedUntilTs"),
  costTier: text("costTier"),
  defaultFor: text("defaultFor"),
  notes: text("notes"),
})

export const agentTimelineEvents = sqliteTable(
  "agent_timeline_events",
  {
    id: text("id").primaryKey(), ts: integer("ts").notNull(), sourceSessionId: text("sourceSessionId").notNull(), sourceSeq: integer("sourceSeq").notNull(), agentId: text("agentId").notNull(), agentSeq: integer("agentSeq").notNull(), agentSessionId: text("agentSessionId"), parentSessionId: text("parentSessionId"), parentAgentId: text("parentAgentId"), taskId: text("taskId"), packetId: text("packetId"), branchId: text("branchId"), turnId: text("turnId"), kind: text("kind").notNull(), fromState: text("fromState"), toState: text("toState"), routeResolutionId: text("routeResolutionId"), reason: text("reason"), errorClass: text("errorClass"), detail: text("detail").notNull(), payloadVersion: integer("payloadVersion").notNull(),
  },
  (table) => [uniqueIndex("agent_timeline_source_unique_idx").on(table.sourceSessionId, table.sourceSeq), uniqueIndex("agent_timeline_agent_seq_unique_idx").on(table.agentId, table.agentSeq), index("agent_timeline_agent_ts_idx").on(table.agentId, table.ts), index("agent_timeline_parent_agent_seq_idx").on(table.parentAgentId, table.agentSeq), index("agent_timeline_task_idx").on(table.taskId), index("agent_timeline_packet_idx").on(table.packetId), index("agent_timeline_kind_ts_idx").on(table.kind, table.ts), index("agent_timeline_route_idx").on(table.routeResolutionId)],
)

export const routeResolutions = sqliteTable(
  "route_resolutions",
  {
    id: text("id").primaryKey(), ts: integer("ts").notNull(), sourceSessionId: text("sourceSessionId").notNull(), sourceSeq: integer("sourceSeq").notNull(), agentId: text("agentId").notNull(), agentSeq: integer("agentSeq").notNull(), agentSessionId: text("agentSessionId"), parentSessionId: text("parentSessionId"), parentAgentId: text("parentAgentId"), taskId: text("taskId"), packetId: text("packetId"), branchId: text("branchId"), turnId: text("turnId"), changeKind: text("changeKind").notNull(), reason: text("reason"), lane: text("lane").notNull(), provider: text("provider").notNull(), upstreamProvider: text("upstreamProvider"), model: text("model").notNull(), accountKind: text("accountKind").notNull(), accountRef: text("accountRef"), accountProvenance: text("accountProvenance").notNull(), effort: text("effort").notNull(), winningLayer: text("winningLayer").notNull(), constraints: text("constraints").notNull(), consultedSources: text("consultedSources").notNull(), overriddenValues: text("overriddenValues").notNull(), fallbackFromResolutionId: text("fallbackFromResolutionId"), revertedFromResolutionId: text("revertedFromResolutionId"), advisorMode: text("advisorMode").notNull(), rawDecisionArtifactId: text("rawDecisionArtifactId"), payloadVersion: integer("payloadVersion").notNull(),
  },
  (table) => [uniqueIndex("route_resolutions_source_unique_idx").on(table.sourceSessionId, table.sourceSeq), uniqueIndex("route_resolutions_agent_seq_unique_idx").on(table.agentId, table.agentSeq), index("route_resolutions_agent_ts_idx").on(table.agentId, table.ts), index("route_resolutions_packet_ts_idx").on(table.packetId, table.ts), index("route_resolutions_lane_ts_idx").on(table.provider, table.model, table.accountRef, table.effort, table.ts), index("route_resolutions_change_kind_ts_idx").on(table.changeKind, table.ts), index("route_resolutions_fallback_from_idx").on(table.fallbackFromResolutionId)],
)

export const routeCandidates = sqliteTable("route_candidates", { routeResolutionId: text("routeResolutionId").notNull(), ordinal: integer("ordinal").notNull(), lane: text("lane").notNull(), provider: text("provider").notNull(), model: text("model").notNull(), accountKind: text("accountKind").notNull(), accountRef: text("accountRef"), effort: text("effort").notNull(), disposition: text("disposition").notNull(), fallbackOrdinal: integer("fallbackOrdinal"), rejectionCode: text("rejectionCode"), rejectionReason: text("rejectionReason"), failedConstraintIds: text("failedConstraintIds").notNull() }, (table) => [primaryKey({ columns: [table.routeResolutionId, table.ordinal] }), index("route_candidates_disposition_idx").on(table.routeResolutionId, table.disposition, table.fallbackOrdinal), index("route_candidates_lane_idx").on(table.provider, table.model, table.accountRef, table.effort)])

export const routeAdvisors = sqliteTable("route_advisors", { routeResolutionId: text("routeResolutionId").notNull(), ordinal: integer("ordinal").notNull(), advisorAgentId: text("advisorAgentId"), purpose: text("purpose").notNull(), lane: text("lane").notNull(), provider: text("provider").notNull(), model: text("model").notNull(), accountKind: text("accountKind").notNull(), accountRef: text("accountRef"), accountProvenance: text("accountProvenance").notNull(), effort: text("effort").notNull(), winningLayer: text("winningLayer").notNull(), independenceRequired: integer("independenceRequired", { mode: "boolean" }).notNull(), rawAdviceArtifactId: text("rawAdviceArtifactId") }, (table) => [primaryKey({ columns: [table.routeResolutionId, table.ordinal] }), index("route_advisors_agent_idx").on(table.advisorAgentId), index("route_advisors_lane_idx").on(table.provider, table.model, table.accountRef, table.effort)])

export const routeEventArtifacts = sqliteTable("route_event_artifacts", { ownerKind: text("ownerKind").notNull(), ownerId: text("ownerId").notNull(), ordinal: integer("ordinal").notNull(), role: text("role").notNull(), artifactId: text("artifactId").notNull() }, (table) => [primaryKey({ columns: [table.ownerKind, table.ownerId, table.ordinal] }), index("route_event_artifacts_artifact_idx").on(table.artifactId), index("route_event_artifacts_owner_role_idx").on(table.ownerKind, table.ownerId, table.role)])


export const operationalEvents = sqliteTable(
  "operational_events",
  {
    eventId: text("eventId").primaryKey(),
    eventKind: text("eventKind").notNull(),
    occurredAt: integer("occurredAt").notNull(),
    observedAt: integer("observedAt").notNull(),
    producer: text("producer").notNull(),
    payloadVersion: integer("payloadVersion").notNull(),
    sourceKind: text("sourceKind").notNull(),
    sourceId: text("sourceId").notNull(),
    sourceSequence: integer("sourceSequence"),
    sourceDigest: text("sourceDigest").notNull(),
    buildDigest: text("buildDigest"),
    runnerInstanceId: text("runnerInstanceId"),
    sessionId: text("sessionId"),
    branchId: text("branchId"),
    turnId: text("turnId"),
    entryId: text("entryId"),
    agentId: text("agentId"),
    parentAgentId: text("parentAgentId"),
    taskId: text("taskId"),
    packetId: text("packetId"),
    viewId: text("viewId"),
    controllerEpoch: integer("controllerEpoch"),
    ownerEpoch: text("ownerEpoch"),
    revision: integer("revision"),
    sequence: integer("sequence"),
    sessionRevision: integer("sessionRevision"),
    durableSequence: integer("durableSequence"),
    commandId: text("commandId"),
    correlationId: text("correlationId"),
    causationId: text("causationId"),
    inputId: text("inputId"),
    attemptId: text("attemptId"),
    routeResolutionId: text("routeResolutionId"),
    quotaDecisionId: text("quotaDecisionId"),
    toolCallId: text("toolCallId"),
    diagnosticId: text("diagnosticId"),
    canaryRunId: text("canaryRunId"),
    promotionId: text("promotionId"),
    regressionId: text("regressionId"),
    redactionPolicyId: text("redactionPolicyId"),
    payload: text("payload").notNull(),
  },
  (table) => [
    uniqueIndex("operational_events_source_unique_idx").on(table.sourceKind, table.sourceId, table.sourceSequence).where(sql`${table.sourceSequence} IS NOT NULL`),
    index("operational_events_session_revision_idx").on(table.sessionId, table.revision, table.occurredAt),
    index("operational_events_runner_sequence_idx").on(table.runnerInstanceId, table.sequence, table.occurredAt),
    index("operational_events_command_idx").on(table.commandId, table.occurredAt),
    index("operational_events_input_attempt_idx").on(table.inputId, table.attemptId, table.occurredAt),
    index("operational_events_route_idx").on(table.routeResolutionId, table.occurredAt),
    index("operational_events_diagnostic_idx").on(table.diagnosticId, table.occurredAt),
    index("operational_events_canary_idx").on(table.canaryRunId, table.occurredAt),
    index("operational_events_promotion_idx").on(table.promotionId, table.occurredAt),
    index("operational_events_observed_lag_idx").on(table.observedAt, table.occurredAt),
  ],
)

export const operationalSources = sqliteTable(
  "operational_sources",
  {
    sourceKind: text("sourceKind").notNull(),
    sourceId: text("sourceId").notNull(),
    sourceDigest: text("sourceDigest").notNull(),
    lastSourceSequence: integer("lastSourceSequence"),
    lastOccurredAt: integer("lastOccurredAt"),
    lastObservedAt: integer("lastObservedAt").notNull(),
    gapFromSequence: integer("gapFromSequence"),
    gapToSequence: integer("gapToSequence"),
    status: text("status").notNull(),
  },
  (table) => [primaryKey({ columns: [table.sourceKind, table.sourceId] })],
)

export const diagnosticOccurrences = sqliteTable(
  "diagnostic_occurrences",
  {
    diagnosticId: text("diagnosticId").primaryKey(),
    occurredAt: integer("occurredAt").notNull(),
    failureClass: text("failureClass").notNull(),
    phase: text("phase").notNull(),
    message: text("message").notNull(),
    requestFingerprint: text("requestFingerprint"),
    buildDigest: text("buildDigest"),
    runnerInstanceId: text("runnerInstanceId"),
    runtimeIdentity: text("runtimeIdentity").notNull(),
    configHash: text("configHash"),
    manifestHash: text("manifestHash"),
    sessionId: text("sessionId"),
    branchId: text("branchId"),
    turnId: text("turnId"),
    entryId: text("entryId"),
    agentId: text("agentId"),
    routeResolutionId: text("routeResolutionId"),
    inputId: text("inputId"),
    attemptId: text("attemptId"),
    ownerEpoch: text("ownerEpoch"),
    explicitRoute: integer("explicitRoute", { mode: "boolean" }),
    outcome: text("outcome"),
    causeDiagnosticId: text("causeDiagnosticId"),
    retryOfAttemptId: text("retryOfAttemptId"),
    fallbackResolutionId: text("fallbackResolutionId"),
    interventionCommandId: text("interventionCommandId"),
    regressionId: text("regressionId"),
    redactionPolicyId: text("redactionPolicyId").notNull(),
    payloadVersion: integer("payloadVersion").notNull(),
  },
)

export const diagnosticArtifacts = sqliteTable(
  "diagnostic_artifacts",
  {
    diagnosticId: text("diagnosticId").notNull(),
    ordinal: integer("ordinal").notNull(),
    role: text("role").notNull(),
    artifactId: text("artifactId").notNull(),
    sha256: text("sha256").notNull(),
    redactionPolicyId: text("redactionPolicyId").notNull(),
  },
  (table) => [primaryKey({ columns: [table.diagnosticId, table.ordinal] })],
)

export const diagnosticProjectionEvents = sqliteTable(
  "diagnostic_projection_events",
  {
    projectionEventId: text("projectionEventId").primaryKey(),
    diagnosticId: text("diagnosticId").notNull(),
    occurredAt: integer("occurredAt").notNull(),
    state: text("state").notNull(),
    actor: text("actor"),
    commandId: text("commandId"),
    sourceEntryId: text("sourceEntryId"),
    payloadVersion: integer("payloadVersion").notNull(),
  },
)

export const canaryRuns = sqliteTable(
  "canary_runs",
  {
    canaryRunId: text("canaryRunId").primaryKey(),
    receiptDigest: text("receiptDigest").notNull().unique(),
    buildDigest: text("buildDigest").notNull(),
    version: text("version").notNull(),
    runnerInstanceId: text("runnerInstanceId").notNull(),
    fixtureSessionId: text("fixtureSessionId").notNull(),
    ownerEpoch: text("ownerEpoch").notNull(),
    commandId: text("commandId").notNull(),
    startedAt: integer("startedAt").notNull(),
    stoppedAt: integer("stoppedAt").notNull(),
    initialSnapshotRevision: integer("initialSnapshotRevision").notNull(),
    finalSnapshotRevision: integer("finalSnapshotRevision").notNull(),
    mutationAppliedExactlyOnce: integer("mutationAppliedExactlyOnce", { mode: "boolean" }).notNull(),
    leaseReleased: integer("leaseReleased", { mode: "boolean" }).notNull(),
    leaseReacquired: integer("leaseReacquired", { mode: "boolean" }).notNull(),
    jsonlPersisted: integer("jsonlPersisted", { mode: "boolean" }).notNull(),
    queuePersisted: integer("queuePersisted", { mode: "boolean" }).notNull(),
    artifactId: text("artifactId").notNull(),
  },
)

export const releaseTransactions = sqliteTable(
  "release_transactions",
  {
    promotionId: text("promotionId").primaryKey(),
    operation: text("operation").notNull(),
    occurredAt: integer("occurredAt").notNull(),
    fromBuildDigest: text("fromBuildDigest"),
    toBuildDigest: text("toBuildDigest").notNull(),
    receiptDigest: text("receiptDigest"),
    registryBeforeDigest: text("registryBeforeDigest").notNull(),
    registryAfterDigest: text("registryAfterDigest").notNull(),
    transactionArtifactId: text("transactionArtifactId").notNull(),
  },
)

export const releaseRegistryObservations = sqliteTable(
  "release_registry_observations",
  {
    observationId: text("observationId").primaryKey(),
    observedAt: integer("observedAt").notNull(),
    stableBuildDigest: text("stableBuildDigest"),
    previousBuildDigest: text("previousBuildDigest"),
    candidateBuildDigest: text("candidateBuildDigest"),
    receiptDigest: text("receiptDigest"),
    sourceDigest: text("sourceDigest").notNull(),
    artifactId: text("artifactId").notNull(),
  },
)


export const evidenceSources = sqliteTable(
  "evidence_sources",
  {
    id: text("id").primaryKey(),
    sourceKind: text("sourceKind").notNull(),
    captureKind: text("captureKind").notNull(),
    sourceSystem: text("sourceSystem"),
    sourceRef: text("sourceRef"),
    trustLabel: text("trustLabel").notNull(),
    publisher: text("publisher").notNull(),
    author: text("author"),
    title: text("title").notNull(),
    url: text("url"),
    publishedAt: integer("publishedAt"),
    retrievedAt: integer("retrievedAt").notNull(),
    effectiveFrom: integer("effectiveFrom"),
    effectiveTo: integer("effectiveTo"),
    artifactId: text("artifactId"),
    contentSha256: text("contentSha256"),
    scope: text("scope").notNull(),
    methodologyUrl: text("methodologyUrl"),
    notes: text("notes"),
  },
  (table) => [
    index("evidence_sources_publisher_publishedAt_idx").on(table.publisher, table.publishedAt),
    index("evidence_sources_trustLabel_publishedAt_idx").on(table.trustLabel, table.publishedAt),
    index("evidence_sources_contentSha256_idx").on(table.contentSha256),
    index("evidence_sources_sourceSystem_sourceRef_idx").on(table.sourceSystem, table.sourceRef),
  ],
)

export const benchmarkCatalog = sqliteTable(
  "benchmark_catalog",
  {
    id: text("id").primaryKey(),
    benchmarkKey: text("benchmarkKey").notNull(),
    version: text("version").notNull(),
    readiness: text("readiness").notNull(),
    expectedAt: integer("expectedAt"),
    releasedAt: integer("releasedAt"),
    lastCheckedAt: integer("lastCheckedAt"),
    nextCheckAt: integer("nextCheckAt"),
    sourceUrl: text("sourceUrl"),
    dataUrl: text("dataUrl"),
    ingestMethod: text("ingestMethod").notNull(),
    blocker: text("blocker"),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("benchmark_catalog_key_version_unique_idx").on(table.benchmarkKey, table.version),
    index("benchmark_catalog_readiness_nextCheckAt_idx").on(table.readiness, table.nextCheckAt),
  ],
)

export const metricDefinitions = sqliteTable(
  "metric_definitions",
  {
    id: text("id").primaryKey(),
    definitionKind: text("definitionKind").notNull(),
    definitionKey: text("definitionKey").notNull(),
    version: text("version").notNull(),
    metricKey: text("metricKey").notNull(),
    displayName: text("displayName").notNull(),
    workClass: text("workClass").notNull(),
    taskModality: text("taskModality").notNull(),
    unit: text("unit").notNull(),
    scoreDirection: text("scoreDirection").notNull(),
    scoringRule: text("scoringRule").notNull(),
    datasetSize: integer("datasetSize"),
    hiddenEval: integer("hiddenEval"),
    contaminationStatus: text("contaminationStatus").notNull(),
    benchmarkCatalogId: text("benchmarkCatalogId"),
    lowerBound: real("lowerBound"),
    upperBound: real("upperBound"),
    methodologySourceId: text("methodologySourceId").notNull(),
    qualityNotes: text("qualityNotes"),
  },
  (table) => [
    uniqueIndex("metric_definitions_key_version_metric_unique_idx").on(table.definitionKey, table.version, table.metricKey),
    index("metric_definitions_kind_workClass_modality_idx").on(table.definitionKind, table.workClass, table.taskModality),
    index("metric_definitions_catalog_idx").on(table.benchmarkCatalogId),
    index("metric_definitions_source_idx").on(table.methodologySourceId),
  ],
)

export const commercialFacts = sqliteTable(
  "commercial_facts",
  {
    id: text("id").primaryKey(),
    sourceId: text("sourceId").notNull(),
    effectiveFrom: integer("effectiveFrom").notNull(),
    effectiveTo: integer("effectiveTo"),
    provider: text("provider").notNull(),
    model: text("model"),
    account: text("account"),
    product: text("product").notNull(),
    pricingContext: text("pricingContext").notNull(),
    serviceTier: text("serviceTier"),
    component: text("component").notNull(),
    poolKey: text("poolKey"),
    factKind: text("factKind").notNull(),
    subjectKind: text("subjectKind").notNull(),
    subjectKey: text("subjectKey").notNull(),
    windowKind: text("windowKind").notNull(),
    value: real("value"),
    unit: text("unit").notNull(),
    perValue: real("perValue"),
    perUnit: text("perUnit"),
    limitKind: text("limitKind").notNull(),
    periodSeconds: integer("periodSeconds"),
    scope: text("scope").notNull(),
    notes: text("notes"),
  },
  (table) => [
    index("commercial_facts_provider_model_context_effective_idx").on(table.provider, table.model, table.pricingContext, table.effectiveFrom),
    index("commercial_facts_product_account_effective_idx").on(table.product, table.account, table.effectiveFrom),
    index("commercial_facts_source_idx").on(table.sourceId),
    index("commercial_facts_poolKey_idx").on(table.poolKey),
    index("commercial_facts_subject_idx").on(table.subjectKind, table.subjectKey),
  ],
)

export const evaluationRuns = sqliteTable(
  "evaluation_runs",
  {
    id: text("id").primaryKey(),
    sourceId: text("sourceId").notNull(),
    evidenceKind: text("evidenceKind").notNull(),
    observedAt: integer("observedAt").notNull(),
    workClass: text("workClass").notNull(),
    harnessProfile: text("harnessProfile"),
    toolProfile: text("toolProfile"),
    contextProfile: text("contextProfile"),
    taskModality: text("taskModality").notNull(),
    taskCount: integer("taskCount"),
    modelCallId: text("modelCallId"),
    sessionId: text("sessionId"),
    packetId: text("packetId"),
    artifactId: text("artifactId"),
    outcomeClass: text("outcomeClass"),
    retryCount: integer("retryCount"),
    humanInterventionCount: integer("humanInterventionCount"),
    notes: text("notes"),
  },
  (table) => [
    index("evaluation_runs_workClass_observedAt_idx").on(table.workClass, table.observedAt),
    index("evaluation_runs_source_idx").on(table.sourceId),
    index("evaluation_runs_modelCall_idx").on(table.modelCallId),
    index("evaluation_runs_packet_idx").on(table.packetId),
    index("evaluation_runs_profiles_idx").on(table.harnessProfile, table.toolProfile, table.contextProfile),
  ],
)

export const evaluationRunParticipants = sqliteTable(
  "evaluation_run_participants",
  {
    runId: text("runId").notNull(),
    ordinal: integer("ordinal").notNull(),
    role: text("role").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    modelVersion: text("modelVersion"),
    account: text("account"),
    effort: text("effort"),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.ordinal] }),
    index("evaluation_run_participants_candidate_idx").on(table.provider, table.model, table.modelVersion, table.account, table.effort),
    index("evaluation_run_participants_run_role_idx").on(table.runId, table.role),
  ],
)

export const evaluationMeasurements = sqliteTable(
  "evaluation_measurements",
  {
    id: text("id").primaryKey(),
    runId: text("runId").notNull(),
    metricDefinitionId: text("metricDefinitionId"),
    metricKey: text("metricKey").notNull(),
    value: real("value").notNull(),
    unit: text("unit").notNull(),
    direction: text("direction").notNull(),
    statistic: text("statistic").notNull(),
    axisRole: text("axisRole").notNull(),
    lowerConfidenceBound: real("lowerConfidenceBound"),
    upperConfidenceBound: real("upperConfidenceBound"),
    confidenceLevel: real("confidenceLevel"),
    sampleSize: integer("sampleSize"),
    costBasis: text("costBasis"),
    derived: integer("derived").notNull(),
    derivation: text("derivation"),
    notes: text("notes"),
  },
  (table) => [
    index("evaluation_measurements_run_metric_idx").on(table.runId, table.metricKey),
    index("evaluation_measurements_metricDefinition_run_idx").on(table.metricDefinitionId, table.runId),
    index("evaluation_measurements_metric_unit_direction_idx").on(table.metricKey, table.unit, table.direction),
  ],
)


export const benchmarkSaturationAssessments = sqliteTable(
  "benchmark_saturation_assessments",
  {
    benchmarkCatalogId: text("benchmarkCatalogId").notNull(),
    sourceId: text("sourceId").notNull(),
    assessedAt: integer("assessedAt").notNull(),
    cohortKey: text("cohortKey").notNull(),
    status: text("status").notNull(),
    topScore: real("topScore"),
    scoreSpread: real("scoreSpread"),
    topK: integer("topK"),
    ceiling: real("ceiling"),
    threshold: real("threshold"),
    expectedSaturationAt: integer("expectedSaturationAt"),
    notes: text("notes"),
  },
  (table) => [
    primaryKey({ columns: [table.benchmarkCatalogId, table.sourceId, table.assessedAt, table.cohortKey] }),
    index("benchmark_saturation_assessments_catalog_cohort_assessedAt_idx").on(table.benchmarkCatalogId, table.cohortKey, table.assessedAt),
    index("benchmark_saturation_assessments_status_assessedAt_idx").on(table.status, table.assessedAt),
  ],
)
export const ledgerTables = {
  sessions,
  branches,
  turns,
  events,
  modelCalls,
  providerCalls,
  artifacts,
  packets,
  commits,
  routingObservations,
  laneState,
  agentTimelineEvents,
  routeResolutions,
  routeCandidates,
  routeAdvisors,
  routeEventArtifacts,
  operationalEvents,
  operationalSources,
  diagnosticOccurrences,
  diagnosticArtifacts,
  diagnosticProjectionEvents,
  canaryRuns,
  releaseTransactions,
  releaseRegistryObservations,
  evidenceSources,
  metricDefinitions,
  benchmarkCatalog,
  commercialFacts,
  benchmarkSaturationAssessments,
  evaluationRuns,
  evaluationRunParticipants,
  evaluationMeasurements,
} as const

export type SessionRow = typeof sessions.$inferSelect
export type BranchRow = typeof branches.$inferSelect
export type TurnRow = typeof turns.$inferSelect
export type EventRow = typeof events.$inferSelect
export type ModelCallRow = typeof modelCalls.$inferSelect
export type ProviderCallRow = typeof providerCalls.$inferSelect
export type ArtifactRow = typeof artifacts.$inferSelect
export type PacketRow = typeof packets.$inferSelect
export type CommitRow = typeof commits.$inferSelect
export type RoutingObservationRow = typeof routingObservations.$inferSelect
export type LaneStateRow = typeof laneState.$inferSelect
export type EvidenceSourceRow = typeof evidenceSources.$inferSelect
export type MetricDefinitionRow = typeof metricDefinitions.$inferSelect
export type CommercialFactRow = typeof commercialFacts.$inferSelect
export type BenchmarkCatalogRow = typeof benchmarkCatalog.$inferSelect
export type EvaluationRunRow = typeof evaluationRuns.$inferSelect
export type BenchmarkSaturationAssessmentRow = typeof benchmarkSaturationAssessments.$inferSelect
export type EvaluationRunParticipantRow = typeof evaluationRunParticipants.$inferSelect
export type EvaluationMeasurementRow = typeof evaluationMeasurements.$inferSelect
export type AgentTimelineEventRow = typeof agentTimelineEvents.$inferSelect
export type RouteResolutionRow = typeof routeResolutions.$inferSelect
export type RouteCandidateRow = typeof routeCandidates.$inferSelect
export type RouteAdvisorRow = typeof routeAdvisors.$inferSelect
export type RouteEventArtifactRow = typeof routeEventArtifacts.$inferSelect
export type OperationalEventRow = typeof operationalEvents.$inferSelect
export type OperationalSourceRow = typeof operationalSources.$inferSelect
export type DiagnosticOccurrenceRow = typeof diagnosticOccurrences.$inferSelect
export type DiagnosticArtifactRow = typeof diagnosticArtifacts.$inferSelect
export type DiagnosticProjectionEventRow = typeof diagnosticProjectionEvents.$inferSelect
export type CanaryRunRow = typeof canaryRuns.$inferSelect
export type ReleaseTransactionRow = typeof releaseTransactions.$inferSelect
export type ReleaseRegistryObservationRow = typeof releaseRegistryObservations.$inferSelect
