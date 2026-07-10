export interface LedgerSqliteQuery<T extends object> {
  get(): T | null | undefined
}

export interface LedgerSqliteConnection {
  exec(sql: string): void
  query<T extends object>(sql: string): LedgerSqliteQuery<T>
}

interface UserVersionRow {
  user_version: number
}

export const LEDGER_SCHEMA_VERSION = 7

export const migration0001Sql = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  machine TEXT NOT NULL,
  harness TEXT NOT NULL,
  workspace TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  meta TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  parentBranchId TEXT,
  kind TEXT NOT NULL,
  atTurn INTEGER,
  createdAt INTEGER NOT NULL,
  meta TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  seq INTEGER NOT NULL,
  startedAt INTEGER NOT NULL,
  endedAt INTEGER,
  contextTokens INTEGER NOT NULL,
  toolCalls INTEGER NOT NULL,
  toolCallSummary TEXT,
  editBytes INTEGER NOT NULL,
  turnDurationMs INTEGER NOT NULL,
  yieldKind TEXT NOT NULL,
  affectSelfReport TEXT,
  affectSignals TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  sessionId TEXT,
  seq INTEGER,
  branchId TEXT,
  packetId TEXT,
  kind TEXT NOT NULL,
  payloadVersion INTEGER NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_calls (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  machine TEXT NOT NULL,
  session TEXT NOT NULL,
  branchId TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  effort TEXT NOT NULL,
  promptHash TEXT NOT NULL,
  systemPromptHash TEXT NOT NULL,
  skillProfile TEXT NOT NULL,
  contextManifest TEXT NOT NULL,
  packetId TEXT NOT NULL,
  tokensIn INTEGER NOT NULL,
  tokensOut INTEGER NOT NULL,
  cacheRead INTEGER NOT NULL,
  cacheWrite INTEGER NOT NULL,
  cost REAL NOT NULL,
  latencyMs INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  errorClass TEXT,
  retryOf TEXT,
  fallbackFrom TEXT,
  rawRequestArtifact TEXT NOT NULL,
  rawResponseArtifact TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_calls (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  sessionId TEXT NOT NULL,
  branchId TEXT,
  packetId TEXT,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  inputHash TEXT NOT NULL,
  rawRequestArtifact TEXT,
  latencyMs INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  errorClass TEXT,
  cost REAL,
  usage TEXT
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  sessionId TEXT,
  kind TEXT NOT NULL,
  contentPath TEXT,
  contentInline TEXT,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  retention TEXT NOT NULL,
  meta TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS packets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  lane TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER,
  summary TEXT,
  sourcePointer TEXT,
  ownerPaths TEXT NOT NULL,
  excludedPaths TEXT NOT NULL,
  dirtyPaths TEXT,
  workerSessionId TEXT,
  reviewerSessionId TEXT,
  branchId TEXT,
  proofLinks TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  claimedAt INTEGER,
  reviewReadyAt INTEGER,
  doneAt INTEGER,
  staleAt INTEGER
);

CREATE TABLE IF NOT EXISTS commits (
  sha TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  agentId TEXT,
  packetId TEXT,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS turns_sessionId_branchId_seq_idx ON turns (sessionId, branchId, seq);
CREATE INDEX IF NOT EXISTS events_sessionId_ts_idx ON events (sessionId, ts);
CREATE INDEX IF NOT EXISTS events_kind_idx ON events (kind);
CREATE UNIQUE INDEX IF NOT EXISTS events_sessionId_seq_unique_idx ON events (sessionId, seq) WHERE seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS model_calls_session_ts_idx ON model_calls (session, ts);
CREATE INDEX IF NOT EXISTS model_calls_outcome_idx ON model_calls (outcome);

PRAGMA user_version = 1;
`

export const migration0002Sql = `
ALTER TABLE model_calls ADD COLUMN entryId TEXT;
ALTER TABLE model_calls ADD COLUMN upstreamProvider TEXT;
CREATE INDEX IF NOT EXISTS model_calls_session_entryId_idx ON model_calls (session, entryId);

PRAGMA user_version = 2;
`

export const migration0003Sql = `
CREATE TABLE IF NOT EXISTS routing_observations (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  machine TEXT NOT NULL,
  session TEXT,
  agent TEXT,
  lane TEXT NOT NULL,
  workType TEXT NOT NULL,
  verdict TEXT NOT NULL,
  note TEXT NOT NULL,
  evidence TEXT,
  confidence REAL
);

CREATE TABLE IF NOT EXISTS lane_state (
  lane TEXT PRIMARY KEY,
  updatedTs INTEGER NOT NULL,
  updatedBy TEXT NOT NULL,
  status TEXT NOT NULL,
  exhaustedUntilTs INTEGER,
  costTier TEXT,
  defaultFor TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS routing_observations_lane_ts_idx ON routing_observations (lane, ts);
CREATE INDEX IF NOT EXISTS routing_observations_workType_ts_idx ON routing_observations (workType, ts);
CREATE INDEX IF NOT EXISTS routing_observations_verdict_ts_idx ON routing_observations (verdict, ts);

PRAGMA user_version = 3;
`

export const migration0004Sql = `
CREATE VIEW IF NOT EXISTS usage_by_lane_hour AS
SELECT
  provider || '/' || model AS lane,
  (ts / 3600000) * 3600000 AS hourBucket,
  COUNT(*) AS calls,
  SUM(tokensIn) AS tokensIn,
  SUM(tokensOut) AS tokensOut,
  SUM(cacheRead) AS cacheRead,
  SUM(cost) AS cost,
  CAST(ROUND(AVG(latencyMs)) AS INTEGER) AS avgLatencyMs,
  ROUND((SUM(tokensIn) + SUM(tokensOut)) / 60.0, 2) AS tokensPerMinute
FROM model_calls
GROUP BY lane, hourBucket;

CREATE VIEW IF NOT EXISTS usage_by_agent AS
SELECT
  agent,
  provider || '/' || model AS lane,
  COUNT(*) AS calls,
  SUM(tokensIn) AS tokensIn,
  SUM(tokensOut) AS tokensOut,
  SUM(cacheRead) AS cacheRead,
  SUM(cost) AS cost,
  CAST(ROUND(AVG(latencyMs)) AS INTEGER) AS avgLatencyMs,
  MIN(ts) AS firstTs,
  MAX(ts) AS lastTs,
  CASE
    WHEN MAX(ts) = MIN(ts) THEN 0.0
    ELSE ROUND((SUM(tokensIn) + SUM(tokensOut)) * 60000.0 / (MAX(ts) - MIN(ts)), 2)
  END AS tokensPerMinute
FROM model_calls
GROUP BY agent, lane;

CREATE VIEW IF NOT EXISTS usage_by_session AS
SELECT
  session,
  provider || '/' || model AS lane,
  COUNT(*) AS calls,
  SUM(tokensIn) AS tokensIn,
  SUM(tokensOut) AS tokensOut,
  SUM(cacheRead) AS cacheRead,
  SUM(cost) AS cost,
  CAST(ROUND(AVG(latencyMs)) AS INTEGER) AS avgLatencyMs,
  MIN(ts) AS firstTs,
  MAX(ts) AS lastTs,
  CASE
    WHEN MAX(ts) = MIN(ts) THEN 0.0
    ELSE ROUND((SUM(tokensIn) + SUM(tokensOut)) * 60000.0 / (MAX(ts) - MIN(ts)), 2)
  END AS tokensPerMinute
FROM model_calls
GROUP BY session, lane
ORDER BY MAX(ts) DESC;

PRAGMA user_version = 4;
`

export const migration0005Sql = `
ALTER TABLE model_calls ADD COLUMN ttftMs INTEGER;
ALTER TABLE model_calls ADD COLUMN reasoningTokens INTEGER;

DROP VIEW IF EXISTS usage_by_lane_hour;
DROP VIEW IF EXISTS usage_by_agent;
DROP VIEW IF EXISTS usage_by_session;

CREATE VIEW usage_by_lane_hour AS
SELECT
  provider || '/' || model AS lane,
  (ts / 3600000) * 3600000 AS hourBucket,
  COUNT(*) AS calls,
  SUM(tokensIn) AS tokensIn,
  SUM(tokensOut) AS tokensOut,
  SUM(cacheRead) AS cacheRead,
  SUM(cost) AS cost,
  CAST(ROUND(AVG(latencyMs)) AS INTEGER) AS avgLatencyMs,
  ROUND((SUM(tokensIn) + SUM(tokensOut)) / 60.0, 2) AS tokensPerMinute,
  ROUND(SUM(tokensOut) / NULLIF(SUM(latencyMs) / 1000.0, 0), 2) AS tokensPerSecond,
  CAST(ROUND(AVG(ttftMs)) AS INTEGER) AS avgTtftMs,
  SUM(COALESCE(reasoningTokens, 0)) AS reasoningTokens
FROM model_calls
GROUP BY lane, hourBucket;

CREATE VIEW usage_by_agent AS
SELECT
  agent,
  provider || '/' || model AS lane,
  COUNT(*) AS calls,
  SUM(tokensIn) AS tokensIn,
  SUM(tokensOut) AS tokensOut,
  SUM(cacheRead) AS cacheRead,
  SUM(cost) AS cost,
  CAST(ROUND(AVG(latencyMs)) AS INTEGER) AS avgLatencyMs,
  MIN(ts) AS firstTs,
  MAX(ts) AS lastTs,
  CASE
    WHEN MAX(ts) = MIN(ts) THEN 0.0
    ELSE ROUND((SUM(tokensIn) + SUM(tokensOut)) * 60000.0 / (MAX(ts) - MIN(ts)), 2)
  END AS tokensPerMinute,
  ROUND(SUM(tokensOut) / NULLIF(SUM(latencyMs) / 1000.0, 0), 2) AS tokensPerSecond,
  CAST(ROUND(AVG(ttftMs)) AS INTEGER) AS avgTtftMs,
  SUM(COALESCE(reasoningTokens, 0)) AS reasoningTokens
FROM model_calls
GROUP BY agent, lane;

CREATE VIEW usage_by_session AS
SELECT
  session,
  provider || '/' || model AS lane,
  COUNT(*) AS calls,
  SUM(tokensIn) AS tokensIn,
  SUM(tokensOut) AS tokensOut,
  SUM(cacheRead) AS cacheRead,
  SUM(cost) AS cost,
  CAST(ROUND(AVG(latencyMs)) AS INTEGER) AS avgLatencyMs,
  MIN(ts) AS firstTs,
  MAX(ts) AS lastTs,
  CASE
    WHEN MAX(ts) = MIN(ts) THEN 0.0
    ELSE ROUND((SUM(tokensIn) + SUM(tokensOut)) * 60000.0 / (MAX(ts) - MIN(ts)), 2)
  END AS tokensPerMinute,
  ROUND(SUM(tokensOut) / NULLIF(SUM(latencyMs) / 1000.0, 0), 2) AS tokensPerSecond,
  CAST(ROUND(AVG(ttftMs)) AS INTEGER) AS avgTtftMs,
  SUM(COALESCE(reasoningTokens, 0)) AS reasoningTokens
FROM model_calls
GROUP BY session, lane
ORDER BY MAX(ts) DESC;

PRAGMA user_version = 5;
`

export const migration0006Sql = `
CREATE TABLE IF NOT EXISTS evidence_sources (
  id TEXT PRIMARY KEY,
  sourceKind TEXT NOT NULL,
  captureKind TEXT NOT NULL,
  sourceSystem TEXT,
  sourceRef TEXT,
  trustLabel TEXT NOT NULL,
  publisher TEXT NOT NULL,
  author TEXT,
  title TEXT NOT NULL,
  url TEXT,
  publishedAt INTEGER,
  retrievedAt INTEGER NOT NULL,
  effectiveFrom INTEGER,
  effectiveTo INTEGER,
  artifactId TEXT,
  contentSha256 TEXT,
  scope TEXT NOT NULL,
  methodologyUrl TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS evidence_sources_publisher_publishedAt_idx ON evidence_sources (publisher, publishedAt);
CREATE INDEX IF NOT EXISTS evidence_sources_trustLabel_publishedAt_idx ON evidence_sources (trustLabel, publishedAt);
CREATE INDEX IF NOT EXISTS evidence_sources_contentSha256_idx ON evidence_sources (contentSha256);
CREATE INDEX IF NOT EXISTS evidence_sources_sourceSystem_sourceRef_idx ON evidence_sources (sourceSystem, sourceRef);

CREATE TABLE IF NOT EXISTS benchmark_catalog (
  id TEXT PRIMARY KEY,
  benchmarkKey TEXT NOT NULL,
  version TEXT NOT NULL,
  readiness TEXT NOT NULL,
  expectedAt INTEGER,
  releasedAt INTEGER,
  lastCheckedAt INTEGER,
  nextCheckAt INTEGER,
  sourceUrl TEXT,
  dataUrl TEXT,
  ingestMethod TEXT NOT NULL,
  blocker TEXT,
  notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS benchmark_catalog_key_version_unique_idx ON benchmark_catalog (benchmarkKey, version);
CREATE INDEX IF NOT EXISTS benchmark_catalog_readiness_nextCheckAt_idx ON benchmark_catalog (readiness, nextCheckAt);

CREATE TABLE IF NOT EXISTS metric_definitions (
  id TEXT PRIMARY KEY,
  definitionKind TEXT NOT NULL,
  definitionKey TEXT NOT NULL,
  version TEXT NOT NULL,
  metricKey TEXT NOT NULL,
  displayName TEXT NOT NULL,
  workClass TEXT NOT NULL,
  taskModality TEXT NOT NULL,
  unit TEXT NOT NULL,
  scoreDirection TEXT NOT NULL,
  scoringRule TEXT NOT NULL,
  datasetSize INTEGER,
  hiddenEval INTEGER,
  contaminationStatus TEXT NOT NULL,
  benchmarkCatalogId TEXT,
  lowerBound REAL,
  upperBound REAL,
  methodologySourceId TEXT NOT NULL,
  qualityNotes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS metric_definitions_key_version_metric_unique_idx ON metric_definitions (definitionKey, version, metricKey);
CREATE INDEX IF NOT EXISTS metric_definitions_kind_workClass_modality_idx ON metric_definitions (definitionKind, workClass, taskModality);
CREATE INDEX IF NOT EXISTS metric_definitions_catalog_idx ON metric_definitions (benchmarkCatalogId);
CREATE INDEX IF NOT EXISTS metric_definitions_source_idx ON metric_definitions (methodologySourceId);


CREATE TABLE IF NOT EXISTS benchmark_saturation_assessments (
  benchmarkCatalogId TEXT NOT NULL,
  sourceId TEXT NOT NULL,
  assessedAt INTEGER NOT NULL,
  cohortKey TEXT NOT NULL,
  status TEXT NOT NULL,
  topScore REAL,
  scoreSpread REAL,
  topK INTEGER,
  ceiling REAL,
  threshold REAL,
  expectedSaturationAt INTEGER,
  notes TEXT,
  PRIMARY KEY (benchmarkCatalogId, sourceId, assessedAt, cohortKey)
);

CREATE INDEX IF NOT EXISTS benchmark_saturation_assessments_catalog_cohort_assessedAt_idx ON benchmark_saturation_assessments (benchmarkCatalogId, cohortKey, assessedAt);
CREATE INDEX IF NOT EXISTS benchmark_saturation_assessments_status_assessedAt_idx ON benchmark_saturation_assessments (status, assessedAt);
CREATE TABLE IF NOT EXISTS commercial_facts (
  id TEXT PRIMARY KEY,
  sourceId TEXT NOT NULL,
  effectiveFrom INTEGER NOT NULL,
  effectiveTo INTEGER,
  provider TEXT NOT NULL,
  model TEXT,
  account TEXT,
  product TEXT NOT NULL,
  pricingContext TEXT NOT NULL,
  serviceTier TEXT,
  component TEXT NOT NULL,
  poolKey TEXT,
  factKind TEXT NOT NULL,
  subjectKind TEXT NOT NULL,
  subjectKey TEXT NOT NULL,
  windowKind TEXT NOT NULL,
  value REAL,
  unit TEXT NOT NULL,
  perValue REAL,
  perUnit TEXT,
  limitKind TEXT NOT NULL,
  periodSeconds INTEGER,
  scope TEXT NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS commercial_facts_provider_model_context_effective_idx ON commercial_facts (provider, model, pricingContext, effectiveFrom);
CREATE INDEX IF NOT EXISTS commercial_facts_product_account_effective_idx ON commercial_facts (product, account, effectiveFrom);
CREATE INDEX IF NOT EXISTS commercial_facts_source_idx ON commercial_facts (sourceId);
CREATE INDEX IF NOT EXISTS commercial_facts_poolKey_idx ON commercial_facts (poolKey);
CREATE INDEX IF NOT EXISTS commercial_facts_subject_idx ON commercial_facts (subjectKind, subjectKey);

CREATE TABLE IF NOT EXISTS evaluation_runs (
  id TEXT PRIMARY KEY,
  sourceId TEXT NOT NULL,
  evidenceKind TEXT NOT NULL,
  observedAt INTEGER NOT NULL,
  workClass TEXT NOT NULL,
  harnessProfile TEXT,
  toolProfile TEXT,
  contextProfile TEXT,
  taskModality TEXT NOT NULL,
  taskCount INTEGER,
  modelCallId TEXT,
  sessionId TEXT,
  packetId TEXT,
  artifactId TEXT,
  outcomeClass TEXT,
  retryCount INTEGER,
  humanInterventionCount INTEGER,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS evaluation_runs_workClass_observedAt_idx ON evaluation_runs (workClass, observedAt);
CREATE INDEX IF NOT EXISTS evaluation_runs_source_idx ON evaluation_runs (sourceId);
CREATE INDEX IF NOT EXISTS evaluation_runs_modelCall_idx ON evaluation_runs (modelCallId);
CREATE INDEX IF NOT EXISTS evaluation_runs_packet_idx ON evaluation_runs (packetId);
CREATE INDEX IF NOT EXISTS evaluation_runs_profiles_idx ON evaluation_runs (harnessProfile, toolProfile, contextProfile);

CREATE TABLE IF NOT EXISTS evaluation_run_participants (
  runId TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  modelVersion TEXT,
  account TEXT,
  effort TEXT,
  PRIMARY KEY (runId, ordinal)
);

CREATE INDEX IF NOT EXISTS evaluation_run_participants_candidate_idx ON evaluation_run_participants (provider, model, modelVersion, account, effort);
CREATE INDEX IF NOT EXISTS evaluation_run_participants_run_role_idx ON evaluation_run_participants (runId, role);

CREATE TABLE IF NOT EXISTS evaluation_measurements (
  id TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  metricDefinitionId TEXT,
  metricKey TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  direction TEXT NOT NULL,
  statistic TEXT NOT NULL,
  axisRole TEXT NOT NULL,
  lowerConfidenceBound REAL,
  upperConfidenceBound REAL,
  confidenceLevel REAL,
  sampleSize INTEGER,
  costBasis TEXT,
  derived INTEGER NOT NULL,
  derivation TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS evaluation_measurements_run_metric_idx ON evaluation_measurements (runId, metricKey);
CREATE INDEX IF NOT EXISTS evaluation_measurements_metricDefinition_run_idx ON evaluation_measurements (metricDefinitionId, runId);
CREATE INDEX IF NOT EXISTS evaluation_measurements_metric_unit_direction_idx ON evaluation_measurements (metricKey, unit, direction);

PRAGMA user_version = 6;
`

export const migration0007Sql = `
CREATE TABLE agent_timeline_events (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, sourceSessionId TEXT NOT NULL, sourceSeq INTEGER NOT NULL, agentId TEXT NOT NULL, agentSeq INTEGER NOT NULL, agentSessionId TEXT, parentSessionId TEXT, parentAgentId TEXT, taskId TEXT, packetId TEXT, branchId TEXT, turnId TEXT, kind TEXT NOT NULL, fromState TEXT, toState TEXT, routeResolutionId TEXT, reason TEXT, errorClass TEXT, detail TEXT NOT NULL, payloadVersion INTEGER NOT NULL);
CREATE UNIQUE INDEX agent_timeline_source_unique_idx ON agent_timeline_events (sourceSessionId, sourceSeq);
CREATE UNIQUE INDEX agent_timeline_agent_seq_unique_idx ON agent_timeline_events (agentId, agentSeq);
CREATE INDEX agent_timeline_agent_ts_idx ON agent_timeline_events (agentId, ts);
CREATE INDEX agent_timeline_parent_agent_seq_idx ON agent_timeline_events (parentAgentId, agentSeq);
CREATE INDEX agent_timeline_task_idx ON agent_timeline_events (taskId);
CREATE INDEX agent_timeline_packet_idx ON agent_timeline_events (packetId);
CREATE INDEX agent_timeline_kind_ts_idx ON agent_timeline_events (kind, ts);
CREATE INDEX agent_timeline_route_idx ON agent_timeline_events (routeResolutionId);
CREATE TABLE route_resolutions (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, sourceSessionId TEXT NOT NULL, sourceSeq INTEGER NOT NULL, agentId TEXT NOT NULL, agentSeq INTEGER NOT NULL, agentSessionId TEXT, parentSessionId TEXT, parentAgentId TEXT, taskId TEXT, packetId TEXT, branchId TEXT, turnId TEXT, changeKind TEXT NOT NULL, reason TEXT, lane TEXT NOT NULL, provider TEXT NOT NULL, upstreamProvider TEXT, model TEXT NOT NULL, accountKind TEXT NOT NULL, accountRef TEXT, accountProvenance TEXT NOT NULL, effort TEXT NOT NULL, winningLayer TEXT NOT NULL, constraints TEXT NOT NULL, consultedSources TEXT NOT NULL, overriddenValues TEXT NOT NULL, fallbackFromResolutionId TEXT, revertedFromResolutionId TEXT, advisorMode TEXT NOT NULL, rawDecisionArtifactId TEXT, payloadVersion INTEGER NOT NULL);
CREATE UNIQUE INDEX route_resolutions_source_unique_idx ON route_resolutions (sourceSessionId, sourceSeq);
CREATE UNIQUE INDEX route_resolutions_agent_seq_unique_idx ON route_resolutions (agentId, agentSeq);
CREATE INDEX route_resolutions_agent_ts_idx ON route_resolutions (agentId, ts);
CREATE INDEX route_resolutions_packet_ts_idx ON route_resolutions (packetId, ts);
CREATE INDEX route_resolutions_lane_ts_idx ON route_resolutions (provider, model, accountRef, effort, ts);
CREATE INDEX route_resolutions_change_kind_ts_idx ON route_resolutions (changeKind, ts);
CREATE INDEX route_resolutions_fallback_from_idx ON route_resolutions (fallbackFromResolutionId);
CREATE TABLE route_candidates (routeResolutionId TEXT NOT NULL, ordinal INTEGER NOT NULL, lane TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, accountKind TEXT NOT NULL, accountRef TEXT, effort TEXT NOT NULL, disposition TEXT NOT NULL, fallbackOrdinal INTEGER, rejectionCode TEXT, rejectionReason TEXT, failedConstraintIds TEXT NOT NULL, PRIMARY KEY (routeResolutionId, ordinal));
CREATE INDEX route_candidates_disposition_idx ON route_candidates (routeResolutionId, disposition, fallbackOrdinal);
CREATE INDEX route_candidates_lane_idx ON route_candidates (provider, model, accountRef, effort);
CREATE TABLE route_advisors (routeResolutionId TEXT NOT NULL, ordinal INTEGER NOT NULL, advisorAgentId TEXT, purpose TEXT NOT NULL, lane TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, accountKind TEXT NOT NULL, accountRef TEXT, accountProvenance TEXT NOT NULL, effort TEXT NOT NULL, winningLayer TEXT NOT NULL, independenceRequired INTEGER NOT NULL, rawAdviceArtifactId TEXT, PRIMARY KEY (routeResolutionId, ordinal));
CREATE INDEX route_advisors_agent_idx ON route_advisors (advisorAgentId);
CREATE INDEX route_advisors_lane_idx ON route_advisors (provider, model, accountRef, effort);
CREATE TABLE route_event_artifacts (ownerKind TEXT NOT NULL, ownerId TEXT NOT NULL, ordinal INTEGER NOT NULL, role TEXT NOT NULL, artifactId TEXT NOT NULL, PRIMARY KEY (ownerKind, ownerId, ordinal));
CREATE INDEX route_event_artifacts_artifact_idx ON route_event_artifacts (artifactId);
CREATE INDEX route_event_artifacts_owner_role_idx ON route_event_artifacts (ownerKind, ownerId, role);
ALTER TABLE model_calls ADD COLUMN routeResolutionId TEXT;
CREATE INDEX model_calls_route_resolution_idx ON model_calls (routeResolutionId);
PRAGMA user_version = 7;
`


export function setDurabilityPragmas(sqlite: LedgerSqliteConnection): void {
  sqlite.exec("PRAGMA journal_mode = WAL")
  sqlite.exec("PRAGMA synchronous = NORMAL")
}

export function migrateLedger(sqlite: LedgerSqliteConnection): void {
  const row = sqlite.query<UserVersionRow>("PRAGMA user_version").get()
  const currentVersion = row?.user_version ?? 0

  if (currentVersion < 1) {
    sqlite.exec(migration0001Sql)
  }
  if (currentVersion < 2) {
    sqlite.exec(migration0002Sql)
  }
  if (currentVersion < 3) {
    sqlite.exec(migration0003Sql)
  }
  if (currentVersion < 4) {
    sqlite.exec(migration0004Sql)
  }
  if (currentVersion < 5) {
    sqlite.exec(migration0005Sql)
  }
  if (currentVersion < 6) {
    sqlite.exec(migration0006Sql)
  }
  if (currentVersion < 7) {
    sqlite.exec(migration0007Sql)
  }
}
