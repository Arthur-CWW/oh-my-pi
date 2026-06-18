import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

export const rawPages = sqliteTable(
  "raw_pages",
  {
    source: text("source").notNull(),
    url: text("url").notNull(),
    requestHash: text("request_hash").notNull(),
    fetchedAt: text("fetched_at").notNull(),
    statusCode: integer("status_code"),
    contentType: text("content_type"),
    headersJson: text("headers_json").notNull(),
    body: text("body").notNull(),
    fetchStatus: text("fetch_status").notNull().default("fetched"),
    parseStatus: text("parse_status").notNull().default("pending"),
    sourceUrl: text("source_url"),
    sourceTimestamp: text("source_timestamp"),
    originalUrl: text("original_url"),
    mementoUrl: text("memento_url"),
    importBatchId: text("import_batch_id"),
    importStatus: text("import_status").notNull().default("imported"),
  },
  (table) => [
    primaryKey({ columns: [table.source, table.url, table.requestHash] }),
    index("raw_pages_source_url_fetched_at_idx").on(table.source, table.url, table.fetchedAt),
  ],
)

export const waybackCdxEntries = sqliteTable(
  "wayback_cdx_entries",
  {
    sourceLane: text("source_lane").notNull(),
    sourceUrl: text("source_url").notNull(),
    timestamp: text("timestamp").notNull(),
    originalUrl: text("original_url").notNull(),
    mementoUrl: text("memento_url").notNull(),
    importBatchId: text("import_batch_id").notNull(),
    importStatus: text("import_status").notNull().default("listed"),
    parseStatus: text("parse_status").notNull().default("pending"),
    mimeType: text("mime_type"),
    statusCode: integer("status_code"),
    digest: text("digest"),
    length: integer("length"),
    rawJson: text("raw_json").notNull(),
    importedAt: text("imported_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceLane, table.sourceUrl, table.timestamp, table.originalUrl] }),
    index("wayback_cdx_entries_batch_idx").on(table.importBatchId, table.sourceLane, table.timestamp),
    index("wayback_cdx_entries_original_timestamp_idx").on(table.originalUrl, table.timestamp),
  ],
)

export const captureJobs = sqliteTable(
  "capture_jobs",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    target: text("target").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull(),
    stage: text("stage").notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    failedAt: text("failed_at"),
    retryAfterAt: text("retry_after_at"),
    error: text("error"),
    skipStatus: text("skip_status").notNull().default("none"),
    provenanceJson: text("provenance_json"),
  },
  (table) => [
    uniqueIndex("capture_jobs_source_target_request_hash_idx").on(table.source, table.target, table.requestHash),
    index("capture_jobs_status_stage_updated_at_idx").on(table.status, table.stage, table.updatedAt),
  ],
)

export const archiveJobs = sqliteTable(
  "archive_jobs",
  {
    id: text("id").primaryKey(),
    sourceLane: text("source_lane").notNull(),
    targetType: text("target_type").notNull(),
    targetValue: text("target_value").notNull(),
    priority: integer("priority").notNull().default(0),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: text("created_at").notNull(),
    claimedAt: text("claimed_at"),
    claimedBy: text("claimed_by"),
    finishedAt: text("finished_at"),
    error: text("error"),
    optionsJson: text("options_json"),
    provenanceJson: text("provenance_json"),
  },
  (table) => [
    index("archive_jobs_status_priority_created_idx").on(table.status, table.priority, table.createdAt),
    index("archive_jobs_target_idx").on(table.targetType, table.targetValue),
  ],
)

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    displayName: text("display_name"),
    capturedAt: text("captured_at"),
    updatedAt: text("updated_at").notNull(),
    dataJson: text("data_json").notNull(),
    lifecycleStatus: text("lifecycle_status").notNull().default("captured"),
    provenanceJson: text("provenance_json"),
    sourceLane: text("source_lane").notNull().default("unknown"),
    sourceUrl: text("source_url"),
    importBatchId: text("import_batch_id"),
  },
  (table) => [index("users_username_idx").on(table.username)],
)

export const tweets = sqliteTable(
  "tweets",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id").notNull(),
    username: text("username"),
    url: text("url").notNull(),
    createdAt: text("created_at"),
    capturedAt: text("captured_at").notNull(),
    conversationId: text("conversation_id"),
    updatedAt: text("updated_at").notNull(),
    dataJson: text("data_json").notNull(),
    capturedMetricsJson: text("captured_metrics_json"),
    lifecycleStatus: text("lifecycle_status").notNull().default("captured"),
    threadStatus: text("thread_status").notNull().default("unknown"),
    quoteStatus: text("quote_status").notNull().default("unknown"),
    quoteUnavailableReason: text("quote_unavailable_reason"),
    provenanceJson: text("provenance_json"),
    sourceLane: text("source_lane").notNull().default("unknown"),
    sourceUrl: text("source_url"),
    importBatchId: text("import_batch_id"),
  },
  (table) => [index("tweets_author_created_at_idx").on(table.authorId, table.createdAt)],
)

export const tweetTimelineProvenance = sqliteTable(
  "tweet_timeline_provenance",
  {
    id: text("id").primaryKey(),
    tweetId: text("tweet_id").notNull(),
    sourceLane: text("source_lane").notNull().default("unknown"),
    observedAt: text("observed_at").notNull(),
    retweetedByUsername: text("retweeted_by_username"),
    retweetedByDisplayName: text("retweeted_by_display_name"),
    detailUrl: text("detail_url"),
    dataJson: text("data_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("tweet_timeline_provenance_tweet_idx").on(table.tweetId, table.observedAt),
    uniqueIndex("tweet_timeline_provenance_identity_idx").on(table.tweetId, table.sourceLane, table.retweetedByUsername, table.detailUrl),
  ],
)


export const media = sqliteTable(
  "media",
  {
    id: text("id").primaryKey(),
    tweetId: text("tweet_id").notNull(),
    type: text("type").notNull(),
    remoteUrl: text("remote_url"),
    capturedAt: text("captured_at"),
    updatedAt: text("updated_at").notNull(),
    dataJson: text("data_json").notNull(),
    downloadStatus: text("download_status").notNull().default("pending"),
    skipStatus: text("skip_status").notNull().default("none"),
    provenanceJson: text("provenance_json"),
    sourceLane: text("source_lane").notNull().default("unknown"),
    sourceUrl: text("source_url"),
    importBatchId: text("import_batch_id"),
  },
  (table) => [index("media_tweet_id_idx").on(table.tweetId)],
)

export const tweetNotes = sqliteTable(
  "tweet_notes",
  {
    id: text("id").primaryKey(),
    tweetId: text("tweet_id").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("tweet_notes_tweet_updated_at_idx").on(table.tweetId, table.updatedAt)],
)

export const tweetAttributes = sqliteTable(
  "tweet_attributes",
  {
    tweetId: text("tweet_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull().default("true"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tweetId, table.key] }),
    index("tweet_attributes_key_updated_at_idx").on(table.key, table.updatedAt),
  ],
)

export const socialGraphImportBatches = sqliteTable(
  "social_graph_import_batches",
  {
    id: text("id").primaryKey(),
    sourceAccountKey: text("source_account_key").notNull(),
    sourceUsername: text("source_username").notNull(),
    relation: text("relation").notNull().default("following"),
    sourceLane: text("source_lane").notNull(),
    status: text("status").notNull().default("imported"),
    observedAt: text("observed_at").notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    provenanceJson: text("provenance_json"),
    error: text("error"),
  },
  (table) => [
    index("social_graph_import_batches_source_idx").on(table.sourceAccountKey, table.relation, table.observedAt),
    index("social_graph_import_batches_status_idx").on(table.status, table.startedAt),
  ],
)

export const socialGraphNodes = sqliteTable(
  "social_graph_nodes",
  {
    accountKey: text("account_key").primaryKey(),
    platform: text("platform").notNull().default("x"),
    accountId: text("account_id"),
    username: text("username").notNull(),
    displayName: text("display_name"),
    profileUrl: text("profile_url"),
    avatarUrl: text("avatar_url"),
    description: text("description"),
    protected: integer("protected", { mode: "boolean" }),
    verified: integer("verified", { mode: "boolean" }),
    observedAt: text("observed_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    provenanceJson: text("provenance_json"),
    dataJson: text("data_json").notNull(),
  },
  (table) => [
    uniqueIndex("social_graph_nodes_platform_username_idx").on(table.platform, table.username),
    index("social_graph_nodes_updated_at_idx").on(table.updatedAt),
  ],
)

export const socialGraphEdges = sqliteTable(
  "social_graph_edges",
  {
    id: text("id").primaryKey(),
    sourceAccountKey: text("source_account_key").notNull(),
    targetAccountKey: text("target_account_key").notNull(),
    relation: text("relation").notNull().default("following"),
    sourceLane: text("source_lane").notNull(),
    observedAt: text("observed_at").notNull(),
    importBatchId: text("import_batch_id"),
    importStatus: text("import_status").notNull().default("imported"),
    provenanceJson: text("provenance_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("social_graph_edges_identity_idx").on(
      table.sourceAccountKey,
      table.targetAccountKey,
      table.relation,
      table.sourceLane,
      table.observedAt,
    ),
    index("social_graph_edges_source_idx").on(table.sourceAccountKey, table.relation, table.observedAt),
    index("social_graph_edges_target_idx").on(table.targetAccountKey, table.relation, table.observedAt),
    index("social_graph_edges_batch_idx").on(table.importBatchId, table.importStatus),
  ],
)


export const twitterArchiveSchemaSql = `
CREATE TABLE IF NOT EXISTS raw_pages (
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  status_code INTEGER,
  content_type TEXT,
  headers_json TEXT NOT NULL,
  body TEXT NOT NULL,
  fetch_status TEXT NOT NULL DEFAULT 'fetched',
  parse_status TEXT NOT NULL DEFAULT 'pending',
  source_url TEXT,
  source_timestamp TEXT,
  original_url TEXT,
  memento_url TEXT,
  import_batch_id TEXT,
  import_status TEXT NOT NULL DEFAULT 'imported',
  PRIMARY KEY (source, url, request_hash)
);

CREATE INDEX IF NOT EXISTS raw_pages_source_url_fetched_at_idx
  ON raw_pages (source, url, fetched_at DESC);

CREATE TABLE IF NOT EXISTS wayback_cdx_entries (
  source_lane TEXT NOT NULL,
  source_url TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  original_url TEXT NOT NULL,
  memento_url TEXT NOT NULL,
  import_batch_id TEXT NOT NULL,
  import_status TEXT NOT NULL DEFAULT 'listed',
  parse_status TEXT NOT NULL DEFAULT 'pending',
  mime_type TEXT,
  status_code INTEGER,
  digest TEXT,
  length INTEGER,
  raw_json TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (source_lane, source_url, timestamp, original_url)
);

CREATE INDEX IF NOT EXISTS wayback_cdx_entries_batch_idx
  ON wayback_cdx_entries (import_batch_id, source_lane, timestamp DESC);

CREATE INDEX IF NOT EXISTS wayback_cdx_entries_original_timestamp_idx
  ON wayback_cdx_entries (original_url, timestamp DESC);

CREATE TABLE IF NOT EXISTS capture_jobs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  stage TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  failed_at TEXT,
  retry_after_at TEXT,
  error TEXT,
  skip_status TEXT NOT NULL DEFAULT 'none',
  provenance_json TEXT,
  UNIQUE (source, target, request_hash)
);

CREATE INDEX IF NOT EXISTS capture_jobs_status_stage_updated_at_idx
  ON capture_jobs (status, stage, updated_at DESC);

CREATE TABLE IF NOT EXISTS archive_jobs (
  id TEXT PRIMARY KEY,
  source_lane TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('profile', 'status', 'search', 'wayback', 'following')),
  target_value TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'completed', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  claimed_by TEXT,
  finished_at TEXT,
  error TEXT,
  options_json TEXT,
  provenance_json TEXT
);

CREATE INDEX IF NOT EXISTS archive_jobs_status_priority_created_idx
  ON archive_jobs (status, priority DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS archive_jobs_target_idx
  ON archive_jobs (target_type, target_value);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT,
  captured_at TEXT,
  updated_at TEXT NOT NULL,
  data_json TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'captured',
  provenance_json TEXT,
  source_lane TEXT NOT NULL DEFAULT 'unknown',
  source_url TEXT,
  import_batch_id TEXT
);

CREATE INDEX IF NOT EXISTS users_username_idx
  ON users (username);

CREATE TABLE IF NOT EXISTS tweets (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  username TEXT,
  url TEXT NOT NULL,
  created_at TEXT,
  captured_at TEXT NOT NULL,
  conversation_id TEXT,
  updated_at TEXT NOT NULL,
  data_json TEXT NOT NULL,
  captured_metrics_json TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'captured',
  thread_status TEXT NOT NULL DEFAULT 'unknown',
  quote_status TEXT NOT NULL DEFAULT 'unknown',
  quote_unavailable_reason TEXT,
  provenance_json TEXT,
  source_lane TEXT NOT NULL DEFAULT 'unknown',
  source_url TEXT,
  import_batch_id TEXT
);

CREATE INDEX IF NOT EXISTS tweets_author_created_at_idx
  ON tweets (author_id, created_at DESC);


CREATE TABLE IF NOT EXISTS tweet_timeline_provenance (
  id TEXT PRIMARY KEY,
  tweet_id TEXT NOT NULL,
  source_lane TEXT NOT NULL DEFAULT 'unknown',
  observed_at TEXT NOT NULL,
  retweeted_by_username TEXT,
  retweeted_by_display_name TEXT,
  detail_url TEXT,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tweet_timeline_provenance_tweet_idx
  ON tweet_timeline_provenance (tweet_id, observed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS tweet_timeline_provenance_identity_idx
  ON tweet_timeline_provenance (tweet_id, source_lane, retweeted_by_username, detail_url);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  tweet_id TEXT NOT NULL,
  type TEXT NOT NULL,
  remote_url TEXT,
  captured_at TEXT,
  updated_at TEXT NOT NULL,
  data_json TEXT NOT NULL,
  download_status TEXT NOT NULL DEFAULT 'pending',
  skip_status TEXT NOT NULL DEFAULT 'none',
  provenance_json TEXT,
  source_lane TEXT NOT NULL DEFAULT 'unknown',
  source_url TEXT,
  import_batch_id TEXT
);

CREATE INDEX IF NOT EXISTS media_tweet_id_idx
  ON media (tweet_id);

CREATE TABLE IF NOT EXISTS tweet_notes (
  id TEXT PRIMARY KEY,
  tweet_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tweet_notes_tweet_updated_at_idx
  ON tweet_notes (tweet_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS tweet_attributes (
  tweet_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT 'true',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tweet_id, key)
);

CREATE INDEX IF NOT EXISTS tweet_attributes_key_updated_at_idx
  ON tweet_attributes (key, updated_at DESC);

CREATE TABLE IF NOT EXISTS social_graph_import_batches (
  id TEXT PRIMARY KEY,
  source_account_key TEXT NOT NULL,
  source_username TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'following' CHECK (relation IN ('following')),
  source_lane TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'imported' CHECK (status IN ('pending', 'imported', 'failed', 'skipped')),
  observed_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  provenance_json TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS social_graph_import_batches_source_idx
  ON social_graph_import_batches (source_account_key, relation, observed_at DESC);

CREATE INDEX IF NOT EXISTS social_graph_import_batches_status_idx
  ON social_graph_import_batches (status, started_at DESC);

CREATE TABLE IF NOT EXISTS social_graph_nodes (
  account_key TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'x',
  account_id TEXT,
  username TEXT NOT NULL,
  display_name TEXT,
  profile_url TEXT,
  avatar_url TEXT,
  description TEXT,
  protected INTEGER,
  verified INTEGER,
  observed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  provenance_json TEXT,
  data_json TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS social_graph_nodes_platform_username_idx
  ON social_graph_nodes (platform, username);

CREATE INDEX IF NOT EXISTS social_graph_nodes_updated_at_idx
  ON social_graph_nodes (updated_at DESC);

CREATE TABLE IF NOT EXISTS social_graph_edges (
  id TEXT PRIMARY KEY,
  source_account_key TEXT NOT NULL,
  target_account_key TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'following' CHECK (relation IN ('following')),
  source_lane TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  import_batch_id TEXT,
  import_status TEXT NOT NULL DEFAULT 'imported' CHECK (import_status IN ('pending', 'imported', 'failed', 'skipped')),
  provenance_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS social_graph_edges_identity_idx
  ON social_graph_edges (source_account_key, target_account_key, relation, source_lane, observed_at);

CREATE INDEX IF NOT EXISTS social_graph_edges_source_idx
  ON social_graph_edges (source_account_key, relation, observed_at DESC);

CREATE INDEX IF NOT EXISTS social_graph_edges_target_idx
  ON social_graph_edges (target_account_key, relation, observed_at DESC);

CREATE INDEX IF NOT EXISTS social_graph_edges_batch_idx
  ON social_graph_edges (import_batch_id, import_status);

`

export type RawPageRow = typeof rawPages.$inferSelect
export type WaybackCdxEntryRow = typeof waybackCdxEntries.$inferSelect
export type CaptureJobRow = typeof captureJobs.$inferSelect
export type ArchiveJobRow = typeof archiveJobs.$inferSelect
export type TweetNoteRow = typeof tweetNotes.$inferSelect
export type TweetTimelineProvenanceRow = typeof tweetTimelineProvenance.$inferSelect
export type TweetAttributeRow = typeof tweetAttributes.$inferSelect
export type SocialGraphImportBatchRow = typeof socialGraphImportBatches.$inferSelect
export type SocialGraphNodeRow = typeof socialGraphNodes.$inferSelect
export type SocialGraphEdgeRow = typeof socialGraphEdges.$inferSelect
