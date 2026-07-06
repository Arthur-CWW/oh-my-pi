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

export const LEDGER_SCHEMA_VERSION = 2

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
  if (currentVersion < LEDGER_SCHEMA_VERSION) {
    sqlite.exec(migration0002Sql)
  }
}
