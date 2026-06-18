import { Database } from "bun:sqlite"
import { and, desc, eq, sql } from "drizzle-orm"
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"
import { resolve } from "node:path"

import { nowIso, stableId } from "./normalize"
import type { ArchiveCaptureSource, ArchiveMedia, ArchiveMediaType, ArchiveTweet, ArchiveTweetTimelineProvenance, ArchiveUser } from "./schema"
import {
  archiveJobs,
  captureJobs,
  media,
  rawPages,
  socialGraphEdges,
  socialGraphImportBatches,
  socialGraphNodes,
  tweetAttributes,
  tweetNotes,
  tweets,
  tweetTimelineProvenance,
  twitterArchiveSchemaSql,
  users,
  waybackCdxEntries,
  type ArchiveJobRow,
  type CaptureJobRow,
  type RawPageRow,
  type SocialGraphEdgeRow,
  type SocialGraphImportBatchRow,
  type SocialGraphNodeRow,
  type TweetAttributeRow,
  type TweetNoteRow,
  type TweetTimelineProvenanceRow,
  type WaybackCdxEntryRow,
} from "./sqlite-schema"

export type SqliteCaptureJobStatus = "pending" | "running" | "completed" | "failed"
export type SqliteArchiveJobTargetType = "profile" | "status" | "search" | "wayback" | "following"
export type SqliteArchiveJobStatus = "pending" | "claimed" | "completed" | "failed" | "skipped"
export type SqliteTweetThreadStatus = "unknown" | "none" | "pending" | "partial" | "complete"
export type SqliteTweetQuoteStatus = "unknown" | "none" | "pending" | "resolved" | "unavailable"
export type SqliteRawPageParseStatus = "pending" | "parsed" | "failed"
export type SqliteSocialGraphRelation = "following"
export type SqliteSocialGraphImportStatus = "pending" | "imported" | "failed" | "skipped"

export type SqliteJsonValue = null | string | number | boolean | readonly SqliteJsonValue[] | SqliteJsonRecord
export interface SqliteJsonRecord {
  readonly [key: string]: SqliteJsonValue | undefined
}



export interface OpenTwitterArchiveSqliteStoreOptions {
  readonly?: boolean
}

export interface RawPageCacheInput {
  source: string
  url: string
  body: string
  requestHash?: string
  fetchedAt?: string
  statusCode?: number
  contentType?: string
  headers?: Record<string, string>
  fetchStatus?: string
  parseStatus?: SqliteRawPageParseStatus
  sourceUrl?: string
  sourceTimestamp?: string
  originalUrl?: string
  mementoUrl?: string
  importBatchId?: string
  importStatus?: string
}

export interface RawPageParseStatusInput extends RawPageCacheKey {
  parseStatus: SqliteRawPageParseStatus
}

export interface RawPageCacheKey {
  source: string
  url: string
  requestHash?: string
}

export interface RawPageCacheEntry {
  source: string
  url: string
  requestHash: string
  fetchedAt: string
  statusCode?: number
  contentType?: string
  headers: Record<string, string>
  body: string
  fetchStatus?: string
  parseStatus?: SqliteRawPageParseStatus
  sourceUrl?: string
  sourceTimestamp?: string
  originalUrl?: string
  mementoUrl?: string
  importBatchId?: string
  importStatus?: string
}

export interface SqliteCaptureJobInput {
  id?: string
  source: string
  target: string
  requestHash?: string
  stage?: string
  createdAt?: string
  provenance?: SqliteJsonRecord
}

export interface SqliteEntityProvenanceInput {
  sourceLane?: string
  sourceUrl?: string
  importBatchId?: string
  provenance?: SqliteJsonRecord
}

export interface SqliteWaybackCdxEntryInput {
  sourceLane: string
  sourceUrl: string
  timestamp: string
  originalUrl: string
  mementoUrl: string
  importBatchId: string
  importStatus?: string
  parseStatus?: SqliteRawPageParseStatus
  mimeType?: string
  statusCode?: number
  digest?: string
  length?: number
  raw: SqliteJsonValue
  importedAt?: string
}

export interface SqliteWaybackCdxEntry {
  sourceLane: string
  sourceUrl: string
  timestamp: string
  originalUrl: string
  mementoUrl: string
  importBatchId: string
  importStatus: string
  parseStatus: SqliteRawPageParseStatus
  mimeType?: string
  statusCode?: number
  digest?: string
  length?: number
  raw: SqliteJsonValue
  importedAt: string
}

export interface SqliteWaybackCdxEntryListFilter extends SqliteArchiveListFilter {
  importBatchId?: string
  sourceLane?: string
}

export interface SqliteCaptureJobStartOptions {
  stage?: string
  startedAt?: string
}

export interface SqliteCaptureJobCompleteOptions {
  stage?: string
  completedAt?: string
}

export interface SqliteCaptureJobFailOptions {
  stage?: string
  failedAt?: string
  retryAfterAt?: string
}

export interface SqliteCaptureJobListFilter {
  status?: SqliteCaptureJobStatus
  stage?: string
}

export interface SqliteCaptureJob {
  id: string
  source: string
  target: string
  requestHash: string
  status: SqliteCaptureJobStatus
  stage: string
  attempts: number
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  failedAt?: string
  retryAfterAt?: string
  error?: string
  provenance?: SqliteJsonValue
}

export interface SqliteArchiveJobInput {
  id?: string
  sourceLane: string
  targetType: SqliteArchiveJobTargetType
  targetValue: string
  priority?: number
  createdAt?: string
  options?: SqliteJsonValue
  provenance?: SqliteJsonValue
}

export interface SqliteArchiveJobListFilter extends SqliteArchiveListFilter {
  status?: SqliteArchiveJobStatus
  sourceLane?: string
  targetType?: SqliteArchiveJobTargetType
}

export interface SqliteArchiveJobClaimOptions {
  workerId?: string
  claimedAt?: string
  sourceLane?: string
  targetType?: SqliteArchiveJobTargetType
}

export interface SqliteArchiveJobFinishOptions {
  status?: Extract<SqliteArchiveJobStatus, "completed" | "failed" | "skipped">
  finishedAt?: string
  error?: string
}

export interface SqliteArchiveJob {
  id: string
  sourceLane: string
  targetType: SqliteArchiveJobTargetType
  targetValue: string
  priority: number
  status: SqliteArchiveJobStatus
  attempts: number
  createdAt: string
  claimedAt?: string
  claimedBy?: string
  finishedAt?: string
  error?: string
  options?: SqliteJsonValue
  provenance?: SqliteJsonValue
}

export interface SqliteTweetNoteInput {
  id?: string
  tweetId: string
  body: string
  createdAt?: string
  updatedAt?: string
}

export interface SqliteTweetNote {
  id: string
  tweetId: string
  body: string
  createdAt: string
  updatedAt: string
}

export interface SqliteTweetAttributeInput {
  tweetId: string
  key: string
  value?: string
  createdAt?: string
  updatedAt?: string
}

export interface SqliteTweetAttribute {
  tweetId: string
  key: string
  value: string
  createdAt: string
  updatedAt: string
}

export interface SqliteTweetResolutionStatusInput {
  threadStatus?: SqliteTweetThreadStatus
  quoteStatus?: SqliteTweetQuoteStatus
  quoteUnavailableReason?: string | null
}

export interface SqliteTweetTimelineProvenanceInput {
  tweetId: string
  sourceLane?: string
  observedAt?: string
  retweetedByUsername?: string
  retweetedByDisplayName?: string
  detailUrl?: string
}

export interface SqliteTweetTimelineProvenance extends ArchiveTweetTimelineProvenance {
  id: string
  sourceLane: string
}

export interface SqliteSocialGraphAccountInput {
  accountId?: string
  username: string
  displayName?: string
  profileUrl?: string
  avatarUrl?: string
  description?: string
  protected?: boolean
  verified?: boolean
  observedAt?: string
  provenance?: SqliteJsonValue
}

export interface SqliteSocialGraphNode {
  accountKey: string
  platform: string
  accountId?: string
  username: string
  displayName?: string
  profileUrl?: string
  avatarUrl?: string
  description?: string
  protected?: boolean
  verified?: boolean
  observedAt: string
  updatedAt: string
  provenance?: SqliteJsonValue
}

export interface SqliteSocialGraphEdgeInput {
  sourceAccount: SqliteSocialGraphAccountInput
  targetAccount: SqliteSocialGraphAccountInput
  relation?: SqliteSocialGraphRelation
  sourceLane: string
  observedAt?: string
  importBatchId?: string
  importStatus?: SqliteSocialGraphImportStatus
  provenance?: SqliteJsonValue
}

export interface SqliteSocialGraphImportInput {
  sourceAccount: SqliteSocialGraphAccountInput
  targetAccounts: readonly SqliteSocialGraphAccountInput[]
  relation?: SqliteSocialGraphRelation
  sourceLane: string
  observedAt?: string
  importBatchId?: string
  importStatus?: SqliteSocialGraphImportStatus
  batchStatus?: SqliteSocialGraphImportStatus
  provenance?: SqliteJsonValue
  error?: string
}

export interface SqliteSocialGraphImportResult {
  importBatchId: string
  nodesUpserted: number
  edgesUpserted: number
  totalEdges: number
}

export interface SqliteSocialGraphEdge {
  id: string
  sourceAccountKey: string
  targetAccountKey: string
  relation: SqliteSocialGraphRelation
  sourceLane: string
  observedAt: string
  importBatchId?: string
  importStatus: SqliteSocialGraphImportStatus
  provenance?: SqliteJsonValue
  createdAt: string
  updatedAt: string
}

export interface SqliteSocialGraphNodeSummary {
  accountKey: string
  username: string
  displayName?: string
  edgeCount: number
}

export interface SqliteSocialGraphSummary {
  nodes: number
  edges: number
  batches: number
  followingEdges: number
  topSources: readonly SqliteSocialGraphNodeSummary[]
  topTargets: readonly SqliteSocialGraphNodeSummary[]
  recentEdges: readonly SqliteSocialGraphEdge[]
}


export interface SqliteUpsertResult {
  upserted: number
  total: number
}

export interface TwitterArchiveSqliteCounts {
  rawPages: number
  captureJobs: number
  archiveJobs: number
  users: number
  tweets: number
  media: number
  socialGraphNodes: number
  socialGraphEdges: number
  socialGraphImportBatches: number
}

export interface SqliteArchiveListFilter {
  limit?: number
  offset?: number
}

type CountTable =
  | "raw_pages"
  | "capture_jobs"
  | "archive_jobs"
  | "users"
  | "tweets"
  | "media"
  | "tweet_timeline_provenance"
  | "social_graph_nodes"
  | "social_graph_edges"
  | "social_graph_import_batches"
type ExistingTableName = "raw_pages" | "capture_jobs" | "users" | "tweets" | "media"
type TwitterArchiveDatabase = BunSQLiteDatabase

interface SqliteTableColumnInfo {
  name: string
}

interface ArchiveJobSqlRow {
  id: string
  source_lane: string
  target_type: string
  target_value: string
  priority: number
  status: string
  attempts: number
  created_at: string
  claimed_at: string | null
  claimed_by: string | null
  finished_at: string | null
  error: string | null
  options_json: string | null
  provenance_json: string | null
}

const captureJobStatuses: Record<SqliteCaptureJobStatus, true> = {
  pending: true,
  running: true,
  completed: true,
  failed: true,
}
const archiveJobTargetTypes: Record<SqliteArchiveJobTargetType, true> = {
  profile: true,
  status: true,
  search: true,
  wayback: true,
  following: true,
}
const archiveJobStatuses: Record<SqliteArchiveJobStatus, true> = {
  pending: true,
  claimed: true,
  completed: true,
  failed: true,
  skipped: true,
}
const archiveCaptureSources: Record<ArchiveCaptureSource, true> = {
  frontend: true,
  api: true,
  tool: true,
  manual: true,
  unknown: true,
}
const archiveMediaTypes: Record<ArchiveMediaType, true> = {
  image: true,
  video: true,
  gif: true,
  unknown: true,
}
const socialGraphRelations: Record<SqliteSocialGraphRelation, true> = {
  following: true,
}
const socialGraphImportStatuses: Record<SqliteSocialGraphImportStatus, true> = {
  pending: true,
  imported: true,
  failed: true,
  skipped: true,
}


function excludedColumn(column: string) {
  return sql.raw(`excluded.${column}`)
}

export function openTwitterArchiveSqliteStore(
  dbPath: string,
  options: OpenTwitterArchiveSqliteStoreOptions = {},
): TwitterArchiveSqliteStore {
  const sqlite = options.readonly ? new Database(resolve(dbPath), { readonly: true }) : new Database(resolve(dbPath))
  sqlite.exec("PRAGMA foreign_keys = ON")
  return new TwitterArchiveSqliteStore(sqlite)
}

export function initTwitterArchiveSqliteStore(
  dbPath: string,
  options: OpenTwitterArchiveSqliteStoreOptions = {},
): TwitterArchiveSqliteStore {
  const store = openTwitterArchiveSqliteStore(dbPath, options)
  store.initSchema()
  return store
}

export class TwitterArchiveSqliteStore {
  readonly sqlite: Database
  readonly db: TwitterArchiveDatabase

  constructor(sqlite: Database) {
    this.sqlite = sqlite
    this.db = drizzle(sqlite)
  }

  initSchema(): void {
    this.sqlite.exec(twitterArchiveSchemaSql)
    this.ensureExistingColumns()
  }

  close(): void {
    this.sqlite.close()
  }

  cacheRawPage(input: RawPageCacheInput): RawPageCacheEntry {
    const requestHash = input.requestHash ?? stableId([input.source, input.url])
    const fetchedAt = input.fetchedAt ?? nowIso()
    const headersJson = stringifyJson(input.headers ?? {})

    this.db
      .insert(rawPages)
      .values({
        source: input.source,
        url: input.url,
        requestHash,
        fetchedAt,
        statusCode: input.statusCode ?? null,
        contentType: input.contentType ?? null,
        headersJson,
        body: input.body,
        fetchStatus: input.fetchStatus ?? "fetched",
        parseStatus: input.parseStatus ?? "pending",
        sourceUrl: input.sourceUrl ?? null,
        sourceTimestamp: input.sourceTimestamp ?? null,
        originalUrl: input.originalUrl ?? null,
        mementoUrl: input.mementoUrl ?? null,
        importBatchId: input.importBatchId ?? null,
        importStatus: input.importStatus ?? "imported",
      })
      .onConflictDoUpdate({
        target: [rawPages.source, rawPages.url, rawPages.requestHash],
        set: {
          fetchedAt: excludedColumn("fetched_at"),
          statusCode: excludedColumn("status_code"),
          contentType: excludedColumn("content_type"),
          headersJson: excludedColumn("headers_json"),
          body: excludedColumn("body"),
          fetchStatus: excludedColumn("fetch_status"),
          parseStatus: excludedColumn("parse_status"),
          sourceUrl: excludedColumn("source_url"),
          sourceTimestamp: excludedColumn("source_timestamp"),
          originalUrl: excludedColumn("original_url"),
          mementoUrl: excludedColumn("memento_url"),
          importBatchId: excludedColumn("import_batch_id"),
          importStatus: excludedColumn("import_status"),
        },
      })
      .run()

    return pruneUndefined({
      source: input.source,
      url: input.url,
      requestHash,
      fetchedAt,
      statusCode: input.statusCode,
      contentType: input.contentType,
      headers: input.headers ?? {},
      body: input.body,
      fetchStatus: input.fetchStatus ?? "fetched",
      parseStatus: input.parseStatus ?? "pending",
      sourceUrl: input.sourceUrl,
      sourceTimestamp: input.sourceTimestamp,
      originalUrl: input.originalUrl,
      mementoUrl: input.mementoUrl,
      importBatchId: input.importBatchId,
      importStatus: input.importStatus ?? "imported",
    })
  }

  getCachedPage(key: RawPageCacheKey): RawPageCacheEntry | undefined {
    const row = key.requestHash
      ? this.db
          .select()
          .from(rawPages)
          .where(and(eq(rawPages.source, key.source), eq(rawPages.url, key.url), eq(rawPages.requestHash, key.requestHash)))
          .get()
      : this.db
          .select()
          .from(rawPages)
          .where(and(eq(rawPages.source, key.source), eq(rawPages.url, key.url)))
          .orderBy(desc(rawPages.fetchedAt))
          .limit(1)
          .get()

    return row ? rawPageFromRow(row) : undefined
  }

  updateRawPageParseStatus(source: string, url: string, requestHash: string, parseStatus: SqliteRawPageParseStatus): void {
    this.db
      .update(rawPages)
      .set({ parseStatus })
      .where(and(eq(rawPages.source, source), eq(rawPages.url, url), eq(rawPages.requestHash, requestHash)))
      .run()
  }

  upsertWaybackCdxEntry(input: SqliteWaybackCdxEntryInput): SqliteWaybackCdxEntry {
    const importedAt = input.importedAt ?? nowIso()
    this.db
      .insert(waybackCdxEntries)
      .values({
        sourceLane: input.sourceLane,
        sourceUrl: input.sourceUrl,
        timestamp: input.timestamp,
        originalUrl: input.originalUrl,
        mementoUrl: input.mementoUrl,
        importBatchId: input.importBatchId,
        importStatus: input.importStatus ?? "listed",
        parseStatus: input.parseStatus ?? "pending",
        mimeType: input.mimeType ?? null,
        statusCode: input.statusCode ?? null,
        digest: input.digest ?? null,
        length: input.length ?? null,
        rawJson: stringifyJson(input.raw),
        importedAt,
      })
      .onConflictDoUpdate({
        target: [
          waybackCdxEntries.sourceLane,
          waybackCdxEntries.sourceUrl,
          waybackCdxEntries.timestamp,
          waybackCdxEntries.originalUrl,
        ],
        set: {
          mementoUrl: excludedColumn("memento_url"),
          importBatchId: excludedColumn("import_batch_id"),
          importStatus: excludedColumn("import_status"),
          parseStatus: excludedColumn("parse_status"),
          mimeType: excludedColumn("mime_type"),
          statusCode: excludedColumn("status_code"),
          digest: excludedColumn("digest"),
          length: excludedColumn("length"),
          rawJson: excludedColumn("raw_json"),
          importedAt: excludedColumn("imported_at"),
        },
      })
      .run()

    return this.requireWaybackCdxEntry(input.sourceLane, input.sourceUrl, input.timestamp, input.originalUrl)
  }

  listWaybackCdxEntries(filter: SqliteWaybackCdxEntryListFilter = {}): SqliteWaybackCdxEntry[] {
    const { limit, offset } = normalizeListFilter(filter)
    const rows =
      filter.importBatchId && filter.sourceLane
        ? this.db
            .select()
            .from(waybackCdxEntries)
            .where(and(eq(waybackCdxEntries.importBatchId, filter.importBatchId), eq(waybackCdxEntries.sourceLane, filter.sourceLane)))
            .orderBy(desc(waybackCdxEntries.timestamp), waybackCdxEntries.originalUrl)
            .limit(limit)
            .offset(offset)
            .all()
        : filter.importBatchId
          ? this.db
              .select()
              .from(waybackCdxEntries)
              .where(eq(waybackCdxEntries.importBatchId, filter.importBatchId))
              .orderBy(desc(waybackCdxEntries.timestamp), waybackCdxEntries.originalUrl)
              .limit(limit)
              .offset(offset)
              .all()
          : filter.sourceLane
            ? this.db
                .select()
                .from(waybackCdxEntries)
                .where(eq(waybackCdxEntries.sourceLane, filter.sourceLane))
                .orderBy(desc(waybackCdxEntries.timestamp), waybackCdxEntries.originalUrl)
                .limit(limit)
                .offset(offset)
                .all()
            : this.db
                .select()
                .from(waybackCdxEntries)
                .orderBy(desc(waybackCdxEntries.timestamp), waybackCdxEntries.originalUrl)
                .limit(limit)
                .offset(offset)
                .all()
    return rows.map(waybackCdxEntryFromRow)
  }

  upsertUsers(archiveUsers: readonly ArchiveUser[], provenance: SqliteEntityProvenanceInput = {}): SqliteUpsertResult {
    const updatedAt = nowIso()
    const provenanceJson = provenance.provenance ? stringifyJson(provenance.provenance) : null

    for (const user of archiveUsers) {
      this.db
        .insert(users)
        .values({
          id: user.id,
          username: user.username,
          displayName: user.displayName ?? null,
          capturedAt: user.capturedAt ?? null,
          updatedAt,
          dataJson: stringifyJson(user),
          lifecycleStatus: "captured",
          provenanceJson,
          sourceLane: provenance.sourceLane ?? "unknown",
          sourceUrl: provenance.sourceUrl ?? null,
          importBatchId: provenance.importBatchId ?? null,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            username: excludedColumn("username"),
            displayName: excludedColumn("display_name"),
            capturedAt: excludedColumn("captured_at"),
            updatedAt: excludedColumn("updated_at"),
            dataJson: excludedColumn("data_json"),
            provenanceJson: excludedColumn("provenance_json"),
            sourceLane: excludedColumn("source_lane"),
            sourceUrl: excludedColumn("source_url"),
            importBatchId: excludedColumn("import_batch_id"),
          },
        })
        .run()
    }

    return { upserted: archiveUsers.length, total: this.count("users") }
  }

  upsertTweets(archiveTweets: readonly ArchiveTweet[], provenance: SqliteEntityProvenanceInput = {}): SqliteUpsertResult {
    const updatedAt = nowIso()
    const provenanceJson = provenance.provenance ? stringifyJson(provenance.provenance) : null

    for (const tweet of archiveTweets) {
      const existingTweet = this.getTweet(tweet.id)
      const mergedTweet = existingTweet ? mergeArchiveTweet(existingTweet, tweet) : tweet
      this.db
        .insert(tweets)
        .values({
          id: mergedTweet.id,
          authorId: mergedTweet.authorId,
          username: mergedTweet.username ?? null,
          url: mergedTweet.url,
          createdAt: mergedTweet.createdAt ?? null,
          capturedAt: mergedTweet.capturedAt,
          conversationId: mergedTweet.conversationId ?? null,
          updatedAt,
          dataJson: stringifyJson(mergedTweet),
          capturedMetricsJson: mergedTweet.publicMetrics ? stringifyJson(mergedTweet.publicMetrics) : null,
          lifecycleStatus: "captured",
          threadStatus: "unknown",
          quoteStatus: mergedTweet.quotedTweetId || mergedTweet.quotedTweetUrl ? "pending" : "none",
          quoteUnavailableReason: null,
          provenanceJson,
          sourceLane: provenance.sourceLane ?? mergedTweet.source ?? "unknown",
          sourceUrl: provenance.sourceUrl ?? null,
          importBatchId: provenance.importBatchId ?? null,
        })
        .onConflictDoUpdate({
          target: tweets.id,
          set: {
            authorId: excludedColumn("author_id"),
            username: excludedColumn("username"),
            url: excludedColumn("url"),
            createdAt: excludedColumn("created_at"),
            capturedAt: excludedColumn("captured_at"),
            conversationId: excludedColumn("conversation_id"),
            updatedAt: excludedColumn("updated_at"),
            dataJson: excludedColumn("data_json"),
            capturedMetricsJson: excludedColumn("captured_metrics_json"),
            provenanceJson: excludedColumn("provenance_json"),
            sourceLane: excludedColumn("source_lane"),
            sourceUrl: excludedColumn("source_url"),
            importBatchId: excludedColumn("import_batch_id"),
          },
        })
        .run()
    }

    for (const tweet of archiveTweets) {
      const storedTweet = this.getTweet(tweet.id)
      if (!storedTweet?.quotedTweetId) {
        continue
      }
      if (tweetHasStoredContent(this.getTweet(storedTweet.quotedTweetId))) {
        this.updateTweetResolutionStatus(storedTweet.id, { quoteStatus: "resolved", quoteUnavailableReason: null })
        continue
      }
      const statusRow = this.db.select({ quoteStatus: tweets.quoteStatus }).from(tweets).where(eq(tweets.id, storedTweet.id)).get()
      if (statusRow?.quoteStatus === "unknown" || statusRow?.quoteStatus === "none") {
        this.updateTweetResolutionStatus(storedTweet.id, { quoteStatus: "pending", quoteUnavailableReason: null })
      }
    }

    return { upserted: archiveTweets.length, total: this.count("tweets") }
  }

  upsertTweetTimelineProvenance(
    entries: readonly SqliteTweetTimelineProvenanceInput[],
    provenance: SqliteEntityProvenanceInput = {},
  ): SqliteUpsertResult {
    const createdAt = nowIso()
    const updatedAt = createdAt
    let upserted = 0

    for (const entry of entries) {
      if (!entry.retweetedByUsername && !entry.retweetedByDisplayName && !entry.detailUrl) {
        continue
      }

      const sourceLane = provenance.sourceLane ?? entry.sourceLane ?? "unknown"
      const observedAt = entry.observedAt ?? createdAt
      const id = stableId([
        "tweet_timeline_provenance",
        entry.tweetId,
        sourceLane,
        entry.retweetedByUsername ?? "",
        entry.detailUrl ?? "",
      ])
      const record: ArchiveTweetTimelineProvenance = pruneUndefined({
        tweetId: entry.tweetId,
        sourceLane,
        observedAt,
        retweetedByUsername: entry.retweetedByUsername,
        retweetedByDisplayName: entry.retweetedByDisplayName,
        detailUrl: entry.detailUrl,
      })

      this.db
        .insert(tweetTimelineProvenance)
        .values({
          id,
          tweetId: entry.tweetId,
          sourceLane,
          observedAt,
          retweetedByUsername: entry.retweetedByUsername ?? null,
          retweetedByDisplayName: entry.retweetedByDisplayName ?? null,
          detailUrl: entry.detailUrl ?? null,
          dataJson: stringifyJson(record),
          createdAt,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: tweetTimelineProvenance.id,
          set: {
            observedAt: excludedColumn("observed_at"),
            retweetedByUsername: excludedColumn("retweeted_by_username"),
            retweetedByDisplayName: excludedColumn("retweeted_by_display_name"),
            detailUrl: excludedColumn("detail_url"),
            dataJson: excludedColumn("data_json"),
            updatedAt: excludedColumn("updated_at"),
          },
        })
        .run()
      upserted += 1
    }

    return { upserted, total: this.count("tweet_timeline_provenance") }
  }


  upsertMedia(archiveMedia: readonly ArchiveMedia[], provenance: SqliteEntityProvenanceInput = {}): SqliteUpsertResult {
    const updatedAt = nowIso()
    const provenanceJson = provenance.provenance ? stringifyJson(provenance.provenance) : null

    for (const item of archiveMedia) {
      this.db
        .insert(media)
        .values({
          id: item.id,
          tweetId: item.tweetId,
          type: item.type,
          remoteUrl: item.remoteUrl ?? null,
          capturedAt: item.capturedAt ?? null,
          updatedAt,
          dataJson: stringifyJson(item),
          downloadStatus: item.localPath ? "downloaded" : item.remoteUrl ? "pending" : "missing_remote",
          skipStatus: "none",
          provenanceJson,
          sourceLane: provenance.sourceLane ?? item.source ?? "unknown",
          sourceUrl: provenance.sourceUrl ?? null,
          importBatchId: provenance.importBatchId ?? null,
        })
        .onConflictDoUpdate({
          target: media.id,
          set: {
            tweetId: excludedColumn("tweet_id"),
            type: excludedColumn("type"),
            remoteUrl: excludedColumn("remote_url"),
            capturedAt: excludedColumn("captured_at"),
            updatedAt: excludedColumn("updated_at"),
            dataJson: excludedColumn("data_json"),
            provenanceJson: excludedColumn("provenance_json"),
            sourceLane: excludedColumn("source_lane"),
            sourceUrl: excludedColumn("source_url"),
            importBatchId: excludedColumn("import_batch_id"),
          },
        })
        .run()
    }

    return { upserted: archiveMedia.length, total: this.count("media") }
  }

  getUser(id: string): ArchiveUser | undefined {
    const row = this.db.select({ dataJson: users.dataJson }).from(users).where(eq(users.id, id)).get()
    return row ? parseArchiveUserJson(row.dataJson) : undefined
  }

  getTweet(id: string): ArchiveTweet | undefined {
    const row = this.db.select({ dataJson: tweets.dataJson }).from(tweets).where(eq(tweets.id, id)).get()
    return row ? parseArchiveTweetJson(row.dataJson) : undefined
  }

  updateTweetResolutionStatus(tweetId: string, input: SqliteTweetResolutionStatusInput): void {
    if (!input.threadStatus && !input.quoteStatus && input.quoteUnavailableReason === undefined) {
      return
    }

    const updates: {
      updatedAt: string
      threadStatus?: SqliteTweetThreadStatus
      quoteStatus?: SqliteTweetQuoteStatus
      quoteUnavailableReason?: string | null
    } = { updatedAt: nowIso() }
    if (input.threadStatus !== undefined) {
      updates.threadStatus = input.threadStatus
    }
    if (input.quoteStatus !== undefined) {
      updates.quoteStatus = input.quoteStatus
    }
    if (input.quoteUnavailableReason !== undefined) {
      updates.quoteUnavailableReason = input.quoteUnavailableReason
    }

    this.db.update(tweets).set(updates).where(eq(tweets.id, tweetId)).run()
  }

  getMedia(id: string): ArchiveMedia | undefined {
    const row = this.db.select({ dataJson: media.dataJson }).from(media).where(eq(media.id, id)).get()
    return row ? parseArchiveMediaJson(row.dataJson) : undefined
  }

  listUsers(filter: SqliteArchiveListFilter = {}): ArchiveUser[] {
    const { limit, offset } = normalizeListFilter(filter)
    return this.db
      .select({ dataJson: users.dataJson })
      .from(users)
      .orderBy(users.username, users.id)
      .limit(limit)
      .offset(offset)
      .all()
      .map((row) => parseArchiveUserJson(row.dataJson))
  }

  listTweets(filter: SqliteArchiveListFilter = {}): ArchiveTweet[] {
    const { limit, offset } = normalizeListFilter(filter)
    return this.db
      .select({ dataJson: tweets.dataJson })
      .from(tweets)
      .orderBy(desc(sql`COALESCE(${tweets.createdAt}, ${tweets.capturedAt})`), tweets.id)
      .limit(limit)
      .offset(offset)
      .all()
      .map((row) => parseArchiveTweetJson(row.dataJson))
  }

  listTweetTimelineProvenance(filter: SqliteArchiveListFilter = {}): SqliteTweetTimelineProvenance[] {
    const { limit, offset } = normalizeListFilter(filter)
    return this.db
      .select()
      .from(tweetTimelineProvenance)
      .orderBy(desc(tweetTimelineProvenance.observedAt), tweetTimelineProvenance.id)
      .limit(limit)
      .offset(offset)
      .all()
      .map(tweetTimelineProvenanceFromRow)
  }


  listMedia(filter: SqliteArchiveListFilter = {}): ArchiveMedia[] {
    const { limit, offset } = normalizeListFilter(filter)
    return this.db
      .select({ dataJson: media.dataJson })
      .from(media)
      .orderBy(desc(media.updatedAt), media.id)
      .limit(limit)
      .offset(offset)
      .all()
      .map((row) => parseArchiveMediaJson(row.dataJson))
  }

  updateMediaLocalPath(id: string, localPath: string, updatedAt = nowIso()): ArchiveMedia {
    const archiveMedia = this.getMedia(id)
    if (!archiveMedia) {
      throw new Error(`Archive media not found: ${id}`)
    }

    const updatedMedia: ArchiveMedia = { ...archiveMedia, localPath }
    this.db
      .update(media)
      .set({
        remoteUrl: updatedMedia.remoteUrl ?? null,
        updatedAt,
        dataJson: stringifyJson(updatedMedia),
        downloadStatus: "downloaded",
      })
      .where(eq(media.id, id))
      .run()

    return updatedMedia
  }

  getCounts(): TwitterArchiveSqliteCounts {
    return {
      rawPages: this.count("raw_pages"),
      captureJobs: this.count("capture_jobs"),
      archiveJobs: this.count("archive_jobs"),
      users: this.count("users"),
      tweets: this.count("tweets"),
      media: this.count("media"),
      socialGraphNodes: this.count("social_graph_nodes"),
      socialGraphEdges: this.count("social_graph_edges"),
      socialGraphImportBatches: this.count("social_graph_import_batches"),
    }
  }

  upsertSocialGraphImport(input: SqliteSocialGraphImportInput): SqliteSocialGraphImportResult {
    const observedAt = input.observedAt ?? nowIso()
    const relation = input.relation ?? "following"
    assertSocialGraphRelation(relation)
    const importStatus = input.importStatus ?? "imported"
    const batchStatus = input.batchStatus ?? importStatus
    assertSocialGraphImportStatus(importStatus)
    assertSocialGraphImportStatus(batchStatus)

    const sourceNode = this.upsertSocialGraphNode({ ...input.sourceAccount, observedAt, provenance: input.provenance })
    const importBatchId =
      input.importBatchId ??
      `social_graph_batch_${stableId([sourceNode.accountKey, relation, input.sourceLane, observedAt]).slice(0, 24)}`

    this.db
      .insert(socialGraphImportBatches)
      .values({
        id: importBatchId,
        sourceAccountKey: sourceNode.accountKey,
        sourceUsername: sourceNode.username,
        relation,
        sourceLane: input.sourceLane,
        status: batchStatus,
        observedAt,
        startedAt: observedAt,
        completedAt: batchStatus === "pending" ? null : observedAt,
        provenanceJson: input.provenance === undefined ? null : stringifyJson(input.provenance),
        error: input.error ?? null,
      })
      .onConflictDoUpdate({
        target: socialGraphImportBatches.id,
        set: {
          sourceAccountKey: excludedColumn("source_account_key"),
          sourceUsername: excludedColumn("source_username"),
          relation: excludedColumn("relation"),
          sourceLane: excludedColumn("source_lane"),
          status: excludedColumn("status"),
          observedAt: excludedColumn("observed_at"),
          completedAt: excludedColumn("completed_at"),
          provenanceJson: excludedColumn("provenance_json"),
          error: excludedColumn("error"),
        },
      })
      .run()

    let nodesUpserted = 1
    let edgesUpserted = 0
    for (const targetAccount of input.targetAccounts) {
      const targetNode = this.upsertSocialGraphNode({ ...targetAccount, observedAt, provenance: targetAccount.provenance ?? input.provenance })
      nodesUpserted += 1
      const edge = this.upsertSocialGraphEdge({
        sourceAccount: sourceNode,
        targetAccount: targetNode,
        relation,
        sourceLane: input.sourceLane,
        observedAt,
        importBatchId,
        importStatus,
        provenance: input.provenance,
      })
      if (edge.importStatus === importStatus) {
        edgesUpserted += 1
      }
    }

    return {
      importBatchId,
      nodesUpserted,
      edgesUpserted,
      totalEdges: this.count("social_graph_edges"),
    }
  }

  upsertSocialGraphEdge(input: SqliteSocialGraphEdgeInput): SqliteSocialGraphEdge {
    const observedAt = input.observedAt ?? nowIso()
    const relation = input.relation ?? "following"
    const importStatus = input.importStatus ?? "imported"
    assertSocialGraphRelation(relation)
    assertSocialGraphImportStatus(importStatus)
    const sourceNode = this.upsertSocialGraphNode({ ...input.sourceAccount, observedAt, provenance: input.sourceAccount.provenance ?? input.provenance })
    const targetNode = this.upsertSocialGraphNode({ ...input.targetAccount, observedAt, provenance: input.targetAccount.provenance ?? input.provenance })
    const id = `social_graph_edge_${stableId([sourceNode.accountKey, targetNode.accountKey, relation, input.sourceLane, observedAt]).slice(0, 24)}`
    const updatedAt = nowIso()

    this.db
      .insert(socialGraphEdges)
      .values({
        id,
        sourceAccountKey: sourceNode.accountKey,
        targetAccountKey: targetNode.accountKey,
        relation,
        sourceLane: input.sourceLane,
        observedAt,
        importBatchId: input.importBatchId ?? null,
        importStatus,
        provenanceJson: input.provenance === undefined ? null : stringifyJson(input.provenance),
        createdAt: updatedAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [
          socialGraphEdges.sourceAccountKey,
          socialGraphEdges.targetAccountKey,
          socialGraphEdges.relation,
          socialGraphEdges.sourceLane,
          socialGraphEdges.observedAt,
        ],
        set: {
          importBatchId: excludedColumn("import_batch_id"),
          importStatus: excludedColumn("import_status"),
          provenanceJson: excludedColumn("provenance_json"),
          updatedAt: excludedColumn("updated_at"),
        },
      })
      .run()

    return this.requireSocialGraphEdge(id)
  }

  upsertSocialGraphNode(input: SqliteSocialGraphAccountInput): SqliteSocialGraphNode {
    const existingUser = this.findUserByUsername(input.username)
    const observedAt = input.observedAt ?? existingUser?.capturedAt ?? nowIso()
    const updatedAt = nowIso()
    const node = normalizeSocialGraphAccount({
      accountId: input.accountId ?? existingUser?.id,
      username: input.username,
      displayName: input.displayName ?? existingUser?.displayName,
      profileUrl: input.profileUrl ?? existingUser?.profileUrl,
      avatarUrl: input.avatarUrl ?? existingUser?.avatarUrl,
      description: input.description ?? existingUser?.description,
      protected: input.protected ?? existingUser?.protected,
      verified: input.verified ?? existingUser?.verified,
      observedAt,
      provenance: input.provenance,
    })

    this.db
      .insert(socialGraphNodes)
      .values({
        accountKey: node.accountKey,
        platform: node.platform,
        accountId: node.accountId ?? null,
        username: node.username,
        displayName: node.displayName ?? null,
        profileUrl: node.profileUrl ?? null,
        avatarUrl: node.avatarUrl ?? null,
        description: node.description ?? null,
        protected: node.protected ?? null,
        verified: node.verified ?? null,
        observedAt: node.observedAt,
        updatedAt,
        provenanceJson: node.provenance === undefined ? null : stringifyJson(node.provenance),
        dataJson: stringifyJson(node),
      })
      .onConflictDoUpdate({
        target: socialGraphNodes.accountKey,
        set: {
          accountId: excludedColumn("account_id"),
          username: excludedColumn("username"),
          displayName: excludedColumn("display_name"),
          profileUrl: excludedColumn("profile_url"),
          avatarUrl: excludedColumn("avatar_url"),
          description: excludedColumn("description"),
          protected: excludedColumn("protected"),
          verified: excludedColumn("verified"),
          observedAt: excludedColumn("observed_at"),
          updatedAt: excludedColumn("updated_at"),
          provenanceJson: excludedColumn("provenance_json"),
          dataJson: excludedColumn("data_json"),
        },
      })
      .run()

    return this.requireSocialGraphNode(node.accountKey)
  }

  hydrateSocialGraphNodesFromUsers(observedAt = nowIso()): SqliteUpsertResult {
    const archiveUsers = this.listUsers({ limit: this.count("users") })
    for (const user of archiveUsers) {
      this.upsertSocialGraphNode({ ...user, accountId: user.id, observedAt, provenance: { source: "users" } })
    }
    return { upserted: archiveUsers.length, total: this.count("social_graph_nodes") }
  }

  listSocialGraphEdges(filter: SqliteArchiveListFilter = {}): SqliteSocialGraphEdge[] {
    const { limit, offset } = normalizeListFilter(filter)
    return this.db
      .select()
      .from(socialGraphEdges)
      .orderBy(desc(socialGraphEdges.observedAt), socialGraphEdges.id)
      .limit(limit)
      .offset(offset)
      .all()
      .map(socialGraphEdgeFromRow)
  }

  getSocialGraphSummary(limit = 10): SqliteSocialGraphSummary {
    this.hydrateSocialGraphNodesFromUsers()
    return {
      nodes: this.count("social_graph_nodes"),
      edges: this.count("social_graph_edges"),
      batches: this.count("social_graph_import_batches"),
      followingEdges: this.countSocialGraphFollowingEdges(),
      topSources: this.socialGraphNodeSummaries("source", limit),
      topTargets: this.socialGraphNodeSummaries("target", limit),
      recentEdges: this.listSocialGraphEdges({ limit }),
    }
  }

  enqueueArchiveJob(input: SqliteArchiveJobInput): SqliteArchiveJob {
    assertArchiveJobTargetType(input.targetType)
    const createdAt = input.createdAt ?? nowIso()
    const priority = normalizePriority(input.priority)
    const sourceLane = normalizeNonEmptyString(input.sourceLane, "Archive job source lane")
    const targetValue = normalizeNonEmptyString(input.targetValue, "Archive job target value")
    const optionsJson = input.options === undefined ? null : stringifyJson(input.options)
    const provenanceJson = input.provenance === undefined ? null : stringifyJson(input.provenance)
    const id = input.id ?? `archive_job_${stableId([sourceLane, input.targetType, targetValue, optionsJson ?? ""]).slice(0, 24)}`

    this.db
      .insert(archiveJobs)
      .values({
        id,
        sourceLane,
        targetType: input.targetType,
        targetValue,
        priority,
        status: "pending",
        attempts: 0,
        createdAt,
        claimedAt: null,
        claimedBy: null,
        finishedAt: null,
        error: null,
        optionsJson,
        provenanceJson,
      })
      .onConflictDoUpdate({
        target: archiveJobs.id,
        set: {
          sourceLane: excludedColumn("source_lane"),
          targetType: excludedColumn("target_type"),
          targetValue: excludedColumn("target_value"),
          priority: excludedColumn("priority"),
          optionsJson: excludedColumn("options_json"),
          provenanceJson: excludedColumn("provenance_json"),
        },
      })
      .run()

    return this.requireArchiveJob(id)
  }

  getArchiveJob(id: string): SqliteArchiveJob | undefined {
    const row = this.db.select().from(archiveJobs).where(eq(archiveJobs.id, id)).get()
    return row ? archiveJobFromRow(row) : undefined
  }

  listArchiveJobs(filter: SqliteArchiveJobListFilter = {}): SqliteArchiveJob[] {
    const { limit, offset } = normalizeListFilter(filter)
    const clauses: string[] = []
    const params: Array<string | number> = []
    if (filter.status) {
      assertArchiveJobStatus(filter.status)
      clauses.push("status = ?")
      params.push(filter.status)
    }
    if (filter.sourceLane) {
      clauses.push("source_lane = ?")
      params.push(filter.sourceLane)
    }
    if (filter.targetType) {
      assertArchiveJobTargetType(filter.targetType)
      clauses.push("target_type = ?")
      params.push(filter.targetType)
    }
    const whereSql = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`
    const rows = this.sqlite
      .query(
        `SELECT id, source_lane, target_type, target_value, priority, status, attempts, created_at,
                claimed_at, claimed_by, finished_at, error, options_json, provenance_json
         FROM archive_jobs
         ${whereSql}
         ORDER BY priority DESC, created_at ASC, id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as ArchiveJobSqlRow[]
    return rows.map(archiveJobFromSqlRow)
  }

  claimNextArchiveJob(options: SqliteArchiveJobClaimOptions = {}): SqliteArchiveJob | undefined {
    if (options.targetType) {
      assertArchiveJobTargetType(options.targetType)
    }
    const claimedAt = options.claimedAt ?? nowIso()
    const workerId = options.workerId ?? "archive-job-worker"
    const clauses = ["status = 'pending'"]
    const params: string[] = []
    if (options.sourceLane) {
      clauses.push("source_lane = ?")
      params.push(options.sourceLane)
    }
    if (options.targetType) {
      clauses.push("target_type = ?")
      params.push(options.targetType)
    }

    return this.sqlite.transaction(() => {
      const row = this.sqlite
        .query(
          `SELECT id
           FROM archive_jobs
           WHERE ${clauses.join(" AND ")}
           ORDER BY priority DESC, created_at ASC, id ASC
           LIMIT 1`,
        )
        .get(...params) as { id: string } | undefined
      if (!row) {
        return undefined
      }
      this.sqlite
        .query(
          `UPDATE archive_jobs
           SET status = 'claimed',
               attempts = attempts + 1,
               claimed_at = ?,
               claimed_by = ?,
               finished_at = NULL,
               error = NULL
           WHERE id = ? AND status = 'pending'`,
        )
        .run(claimedAt, workerId, row.id)
      return this.requireArchiveJob(row.id)
    })()
  }

  finishArchiveJob(id: string, options: SqliteArchiveJobFinishOptions = {}): SqliteArchiveJob {
    const status = options.status ?? "completed"
    assertArchiveJobTerminalStatus(status)
    const finishedAt = options.finishedAt ?? nowIso()
    this.db
      .update(archiveJobs)
      .set({
        status,
        finishedAt,
        error: options.error ?? null,
      })
      .where(eq(archiveJobs.id, id))
      .run()
    return this.requireArchiveJob(id)
  }

  enqueueJob(input: SqliteCaptureJobInput): SqliteCaptureJob {
    const requestHash = input.requestHash ?? stableId([input.source, input.target])
    const id = input.id ?? `job_${stableId([input.source, input.target, requestHash]).slice(0, 24)}`
    const createdAt = input.createdAt ?? nowIso()
    const stage = input.stage ?? "pending"

    this.db
      .insert(captureJobs)
      .values({
        id,
        source: input.source,
        target: input.target,
        requestHash,
        status: "pending",
        stage,
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
        skipStatus: "none",
        provenanceJson: input.provenance ? stringifyJson(input.provenance) : null,
      })
      .onConflictDoNothing({
        target: [captureJobs.source, captureJobs.target, captureJobs.requestHash],
      })
      .run()

    return this.requireJobByKey(input.source, input.target, requestHash)
  }

  startJob(id: string, options: SqliteCaptureJobStartOptions = {}): SqliteCaptureJob {
    const startedAt = options.startedAt ?? nowIso()
    const updatedAt = startedAt

    this.db
      .update(captureJobs)
      .set({
        status: "running",
        stage: sql`COALESCE(${options.stage ?? null}, ${captureJobs.stage})`,
        attempts: sql`${captureJobs.attempts} + 1`,
        startedAt,
        completedAt: null,
        failedAt: null,
        retryAfterAt: null,
        error: null,
        updatedAt,
      })
      .where(eq(captureJobs.id, id))
      .run()

    return this.requireJob(id)
  }

  completeJob(id: string, options: SqliteCaptureJobCompleteOptions = {}): SqliteCaptureJob {
    const completedAt = options.completedAt ?? nowIso()
    const updatedAt = completedAt

    this.db
      .update(captureJobs)
      .set({
        status: "completed",
        stage: options.stage ?? "completed",
        completedAt,
        failedAt: null,
        retryAfterAt: null,
        error: null,
        updatedAt,
      })
      .where(eq(captureJobs.id, id))
      .run()

    return this.requireJob(id)
  }

  failJob(id: string, error: string, options: SqliteCaptureJobFailOptions = {}): SqliteCaptureJob {
    const failedAt = options.failedAt ?? nowIso()
    const updatedAt = failedAt

    this.db
      .update(captureJobs)
      .set({
        status: "failed",
        stage: options.stage ?? "failed",
        failedAt,
        completedAt: null,
        retryAfterAt: options.retryAfterAt ?? null,
        error,
        updatedAt,
      })
      .where(eq(captureJobs.id, id))
      .run()

    return this.requireJob(id)
  }

  getJob(id: string): SqliteCaptureJob | undefined {
    const row = this.db.select().from(captureJobs).where(eq(captureJobs.id, id)).get()
    return row ? captureJobFromRow(row) : undefined
  }

  listJobs(filter: SqliteCaptureJobListFilter = {}): SqliteCaptureJob[] {
    if (filter.status && filter.stage) {
      return this.db
        .select()
        .from(captureJobs)
        .where(and(eq(captureJobs.status, filter.status), eq(captureJobs.stage, filter.stage)))
        .orderBy(desc(captureJobs.updatedAt), captureJobs.id)
        .all()
        .map(captureJobFromRow)
    }

    if (filter.status) {
      return this.db
        .select()
        .from(captureJobs)
        .where(eq(captureJobs.status, filter.status))
        .orderBy(desc(captureJobs.updatedAt), captureJobs.id)
        .all()
        .map(captureJobFromRow)
    }

    if (filter.stage) {
      return this.db
        .select()
        .from(captureJobs)
        .where(eq(captureJobs.stage, filter.stage))
        .orderBy(desc(captureJobs.updatedAt), captureJobs.id)
        .all()
        .map(captureJobFromRow)
    }

    return this.db.select().from(captureJobs).orderBy(desc(captureJobs.updatedAt), captureJobs.id).all().map(captureJobFromRow)
  }

  upsertTweetNote(input: SqliteTweetNoteInput): SqliteTweetNote {
    const createdAt = input.createdAt ?? nowIso()
    const updatedAt = input.updatedAt ?? createdAt
    const id = input.id ?? `note_${stableId([input.tweetId, createdAt, input.body]).slice(0, 24)}`

    this.db
      .insert(tweetNotes)
      .values({
        id,
        tweetId: input.tweetId,
        body: input.body,
        createdAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: tweetNotes.id,
        set: {
          tweetId: excludedColumn("tweet_id"),
          body: excludedColumn("body"),
          updatedAt: excludedColumn("updated_at"),
        },
      })
      .run()

    return this.requireTweetNote(id)
  }

  deleteTweetNote(id: string): void {
    this.db.delete(tweetNotes).where(eq(tweetNotes.id, id)).run()
  }

  listTweetNotes(tweetId: string): SqliteTweetNote[] {
    return this.db
      .select()
      .from(tweetNotes)
      .where(eq(tweetNotes.tweetId, tweetId))
      .orderBy(desc(tweetNotes.updatedAt), tweetNotes.id)
      .all()
      .map(tweetNoteFromRow)
  }

  setTweetAttribute(input: SqliteTweetAttributeInput): SqliteTweetAttribute {
    const createdAt = input.createdAt ?? nowIso()
    const updatedAt = input.updatedAt ?? createdAt
    const value = input.value ?? "true"

    this.db
      .insert(tweetAttributes)
      .values({
        tweetId: input.tweetId,
        key: input.key,
        value,
        createdAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [tweetAttributes.tweetId, tweetAttributes.key],
        set: {
          value: excludedColumn("value"),
          updatedAt: excludedColumn("updated_at"),
        },
      })
      .run()

    return this.requireTweetAttribute(input.tweetId, input.key)
  }

  clearTweetAttribute(tweetId: string, key: string): void {
    this.db.delete(tweetAttributes).where(and(eq(tweetAttributes.tweetId, tweetId), eq(tweetAttributes.key, key))).run()
  }

  listTweetAttributes(tweetId: string): SqliteTweetAttribute[] {
    return this.db
      .select()
      .from(tweetAttributes)
      .where(eq(tweetAttributes.tweetId, tweetId))
      .orderBy(tweetAttributes.key)
      .all()
      .map(tweetAttributeFromRow)
  }

  private requireArchiveJob(id: string): SqliteArchiveJob {
    const job = this.getArchiveJob(id)
    if (!job) {
      throw new Error(`Archive job not found: ${id}`)
    }
    return job
  }

  private requireJob(id: string): SqliteCaptureJob {
    const job = this.getJob(id)
    if (!job) {
      throw new Error(`Capture job not found: ${id}`)
    }
    return job
  }

  private requireJobByKey(source: string, target: string, requestHash: string): SqliteCaptureJob {
    const row = this.db
      .select()
      .from(captureJobs)
      .where(and(eq(captureJobs.source, source), eq(captureJobs.target, target), eq(captureJobs.requestHash, requestHash)))
      .get()

    if (!row) {
      throw new Error(`Capture job not found for ${source} ${target}`)
    }
    return captureJobFromRow(row)
  }

  private requireTweetNote(id: string): SqliteTweetNote {
    const row = this.db.select().from(tweetNotes).where(eq(tweetNotes.id, id)).get()
    if (!row) {
      throw new Error(`Tweet note not found: ${id}`)
    }
    return tweetNoteFromRow(row)
  }

  private requireTweetAttribute(tweetId: string, key: string): SqliteTweetAttribute {
    const row = this.db
      .select()
      .from(tweetAttributes)
      .where(and(eq(tweetAttributes.tweetId, tweetId), eq(tweetAttributes.key, key)))
      .get()
    if (!row) {
      throw new Error(`Tweet attribute not found: ${tweetId} ${key}`)
    }
    return tweetAttributeFromRow(row)
  }

  private requireSocialGraphNode(accountKey: string): SqliteSocialGraphNode {
    const row = this.db.select().from(socialGraphNodes).where(eq(socialGraphNodes.accountKey, accountKey)).get()
    if (!row) {
      throw new Error(`Social graph node not found: ${accountKey}`)
    }
    return socialGraphNodeFromRow(row)
  }

  private requireSocialGraphEdge(id: string): SqliteSocialGraphEdge {
    const row = this.db.select().from(socialGraphEdges).where(eq(socialGraphEdges.id, id)).get()
    if (!row) {
      throw new Error(`Social graph edge not found: ${id}`)
    }
    return socialGraphEdgeFromRow(row)
  }

  private requireWaybackCdxEntry(sourceLane: string, sourceUrl: string, timestamp: string, originalUrl: string): SqliteWaybackCdxEntry {
    const row = this.db
      .select()
      .from(waybackCdxEntries)
      .where(
        and(
          eq(waybackCdxEntries.sourceLane, sourceLane),
          eq(waybackCdxEntries.sourceUrl, sourceUrl),
          eq(waybackCdxEntries.timestamp, timestamp),
          eq(waybackCdxEntries.originalUrl, originalUrl),
        ),
      )
      .get()
    if (!row) {
      throw new Error(`Wayback CDX entry not found: ${sourceLane} ${sourceUrl} ${timestamp} ${originalUrl}`)
    }
    return waybackCdxEntryFromRow(row)
  }

  private findUserByUsername(username: string): ArchiveUser | undefined {
    const normalized = normalizeSocialGraphUsername(username)
    const row = this.db
      .select({ dataJson: users.dataJson })
      .from(users)
      .where(sql`lower(${users.username}) = ${normalized}`)
      .limit(1)
      .get()
    return row ? parseArchiveUserJson(row.dataJson) : undefined
  }

  private countSocialGraphFollowingEdges(): number {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(socialGraphEdges)
      .where(eq(socialGraphEdges.relation, "following"))
      .get()
    return row?.count ?? 0
  }

  private socialGraphNodeSummaries(direction: "source" | "target", limit: number): SqliteSocialGraphNodeSummary[] {
    const edgeColumn = direction === "source" ? "source_account_key" : "target_account_key"
    const rows = this.sqlite
      .query(
        `SELECT n.account_key, n.username, n.display_name, COUNT(e.id) AS edge_count
         FROM social_graph_nodes n
         JOIN social_graph_edges e ON e.${edgeColumn} = n.account_key
         GROUP BY n.account_key, n.username, n.display_name
         ORDER BY edge_count DESC, n.username ASC
         LIMIT ?`,
      )
      .all(Math.floor(Math.max(0, limit))) as Array<{
      account_key: string
      username: string
      display_name: string | null
      edge_count: number
    }>
    return rows.map((row) => ({
      accountKey: row.account_key,
      username: row.username,
      displayName: row.display_name ?? undefined,
      edgeCount: row.edge_count,
    }))
  }


  private count(table: CountTable): number {
    if (table === "raw_pages") return this.countRawPages()
    if (table === "capture_jobs") return this.countCaptureJobs()
    if (table === "archive_jobs") return this.countArchiveJobs()
    if (table === "users") return this.countUsers()
    if (table === "tweets") return this.countTweets()
    if (table === "tweet_timeline_provenance") return this.countTweetTimelineProvenance()
    if (table === "media") return this.countMedia()
    if (table === "social_graph_nodes") return this.countSocialGraphNodes()
    if (table === "social_graph_edges") return this.countSocialGraphEdges()
    return this.countSocialGraphImportBatches()
  }

  private countRawPages(): number {
    const row = this.db.select({ count: sql<number>`count(*)` }).from(rawPages).get()
    return row?.count ?? 0
  }

  private countCaptureJobs(): number {
    const row = this.db.select({ count: sql<number>`count(*)` }).from(captureJobs).get()
    return row?.count ?? 0
  }

  private countArchiveJobs(): number {
    const row = this.db.select({ count: sql<number>`count(*)` }).from(archiveJobs).get()
    return row?.count ?? 0
  }

  private countUsers(): number {
    const row = this.db.select({ count: sql<number>`count(*)` }).from(users).get()
    return row?.count ?? 0
  }

  private countTweets(): number {
    const row = this.db.select({ count: sql<number>`count(*)` }).from(tweets).get()
    return row?.count ?? 0
  }

  private countTweetTimelineProvenance(): number {
    const row = this.db.select({ count: sql<number>`count(*)` }).from(tweetTimelineProvenance).get()
    return row?.count ?? 0
  }


  private countMedia(): number {
    const row = this.db.select({ count: sql<number>`count(*)` }).from(media).get()
    return row?.count ?? 0
  }

  private countSocialGraphNodes(): number {
    const row = this.db.select({ count: sql<number>`count(*)` }).from(socialGraphNodes).get()
    return row?.count ?? 0
  }

  private countSocialGraphEdges(): number {
    const row = this.db.select({ count: sql<number>`count(*)` }).from(socialGraphEdges).get()
    return row?.count ?? 0
  }

  private countSocialGraphImportBatches(): number {
    const row = this.db.select({ count: sql<number>`count(*)` }).from(socialGraphImportBatches).get()
    return row?.count ?? 0
  }

  private ensureExistingColumns(): void {
    this.ensureColumn("raw_pages", "fetch_status", "TEXT NOT NULL DEFAULT 'fetched'")
    this.ensureColumn("raw_pages", "parse_status", "TEXT NOT NULL DEFAULT 'pending'")
    this.ensureColumn("raw_pages", "source_url", "TEXT")
    this.ensureColumn("raw_pages", "source_timestamp", "TEXT")
    this.ensureColumn("raw_pages", "original_url", "TEXT")
    this.ensureColumn("raw_pages", "memento_url", "TEXT")
    this.ensureColumn("raw_pages", "import_batch_id", "TEXT")
    this.ensureColumn("raw_pages", "import_status", "TEXT NOT NULL DEFAULT 'imported'")
    this.ensureColumn("capture_jobs", "skip_status", "TEXT NOT NULL DEFAULT 'none'")
    this.ensureColumn("capture_jobs", "provenance_json", "TEXT")
    this.ensureColumn("users", "lifecycle_status", "TEXT NOT NULL DEFAULT 'captured'")
    this.ensureColumn("users", "provenance_json", "TEXT")
    this.ensureColumn("users", "source_lane", "TEXT NOT NULL DEFAULT 'unknown'")
    this.ensureColumn("users", "source_url", "TEXT")
    this.ensureColumn("users", "import_batch_id", "TEXT")
    this.ensureColumn("tweets", "captured_metrics_json", "TEXT")
    this.ensureColumn("tweets", "lifecycle_status", "TEXT NOT NULL DEFAULT 'captured'")
    this.ensureColumn("tweets", "thread_status", "TEXT NOT NULL DEFAULT 'unknown'")
    this.ensureColumn("tweets", "quote_status", "TEXT NOT NULL DEFAULT 'unknown'")
    this.ensureColumn("tweets", "quote_unavailable_reason", "TEXT")
    this.ensureColumn("tweets", "provenance_json", "TEXT")
    this.ensureColumn("tweets", "source_lane", "TEXT NOT NULL DEFAULT 'unknown'")
    this.ensureColumn("tweets", "source_url", "TEXT")
    this.ensureColumn("tweets", "import_batch_id", "TEXT")
    this.ensureColumn("media", "download_status", "TEXT NOT NULL DEFAULT 'pending'")
    this.ensureColumn("media", "skip_status", "TEXT NOT NULL DEFAULT 'none'")
    this.ensureColumn("media", "provenance_json", "TEXT")
    this.ensureColumn("media", "source_lane", "TEXT NOT NULL DEFAULT 'unknown'")
    this.ensureColumn("media", "source_url", "TEXT")
    this.ensureColumn("media", "import_batch_id", "TEXT")
  }

  private ensureColumn(table: ExistingTableName, column: string, definition: string): void {
    const rows = this.sqlite.query(`PRAGMA table_info(${table})`).all() as SqliteTableColumnInfo[]
    if (rows.some((row) => row.name === column)) {
      return
    }
    this.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function normalizeListFilter(filter: SqliteArchiveListFilter): { limit: number; offset: number } {
  return {
    limit: normalizeNonNegativeInteger(filter.limit, 100),
    offset: normalizeNonNegativeInteger(filter.offset, 0),
  }
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("SQLite list filter values must be non-negative finite numbers")
  }
  return Math.floor(value)
}

function normalizePriority(value: number | undefined): number {
  if (value === undefined) {
    return 0
  }
  if (!Number.isFinite(value)) {
    throw new Error("Archive job priority must be a finite number")
  }
  return Math.trunc(value)
}

function normalizeNonEmptyString(value: string, label: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) {
    throw new Error(`${label} must be non-empty`)
  }
  return normalized
}

function rawPageFromRow(row: RawPageRow): RawPageCacheEntry {
  return pruneUndefined({
    source: row.source,
    url: row.url,
    requestHash: row.requestHash,
    fetchedAt: row.fetchedAt,
    statusCode: row.statusCode ?? undefined,
    contentType: row.contentType ?? undefined,
    headers: parseHeadersJson(row.headersJson),
    body: row.body,
    fetchStatus: row.fetchStatus,
    parseStatus: row.parseStatus as SqliteRawPageParseStatus,
    sourceUrl: row.sourceUrl ?? undefined,
    sourceTimestamp: row.sourceTimestamp ?? undefined,
    originalUrl: row.originalUrl ?? undefined,
    mementoUrl: row.mementoUrl ?? undefined,
    importBatchId: row.importBatchId ?? undefined,
    importStatus: row.importStatus ?? undefined,
  })
}

function captureJobFromRow(row: CaptureJobRow): SqliteCaptureJob {
  if (!isSqliteCaptureJobStatus(row.status)) {
    throw new Error(`Invalid capture job status in sqlite store: ${row.status}`)
  }

  return {
    id: row.id,
    source: row.source,
    target: row.target,
    requestHash: row.requestHash,
    status: row.status,
    stage: row.stage,
    attempts: row.attempts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    failedAt: row.failedAt ?? undefined,
    retryAfterAt: row.retryAfterAt ?? undefined,
    error: row.error ?? undefined,
    provenance: row.provenanceJson ? parseJson(row.provenanceJson, "capture_jobs.provenance_json") : undefined,
  }
}

function archiveJobFromRow(row: ArchiveJobRow): SqliteArchiveJob {
  return normalizeArchiveJob({
    id: row.id,
    sourceLane: row.sourceLane,
    targetType: row.targetType,
    targetValue: row.targetValue,
    priority: row.priority,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.createdAt,
    claimedAt: row.claimedAt ?? undefined,
    claimedBy: row.claimedBy ?? undefined,
    finishedAt: row.finishedAt ?? undefined,
    error: row.error ?? undefined,
    options: row.optionsJson ? parseJson(row.optionsJson, "archive_jobs.options_json") : undefined,
    provenance: row.provenanceJson ? parseJson(row.provenanceJson, "archive_jobs.provenance_json") : undefined,
  })
}

function archiveJobFromSqlRow(row: ArchiveJobSqlRow): SqliteArchiveJob {
  return normalizeArchiveJob({
    id: row.id,
    sourceLane: row.source_lane,
    targetType: row.target_type,
    targetValue: row.target_value,
    priority: row.priority,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.created_at,
    claimedAt: row.claimed_at ?? undefined,
    claimedBy: row.claimed_by ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    error: row.error ?? undefined,
    options: row.options_json ? parseJson(row.options_json, "archive_jobs.options_json") : undefined,
    provenance: row.provenance_json ? parseJson(row.provenance_json, "archive_jobs.provenance_json") : undefined,
  })
}

function normalizeArchiveJob(row: {
  id: string
  sourceLane: string
  targetType: string
  targetValue: string
  priority: number
  status: string
  attempts: number
  createdAt: string
  claimedAt?: string
  claimedBy?: string
  finishedAt?: string
  error?: string
  options?: SqliteJsonValue
  provenance?: SqliteJsonValue
}): SqliteArchiveJob {
  if (!isSqliteArchiveJobTargetType(row.targetType)) {
    throw new Error(`Invalid archive job target type in sqlite store: ${row.targetType}`)
  }
  if (!isSqliteArchiveJobStatus(row.status)) {
    throw new Error(`Invalid archive job status in sqlite store: ${row.status}`)
  }
  return pruneUndefined({
    id: row.id,
    sourceLane: row.sourceLane,
    targetType: row.targetType,
    targetValue: row.targetValue,
    priority: row.priority,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.createdAt,
    claimedAt: row.claimedAt,
    claimedBy: row.claimedBy,
    finishedAt: row.finishedAt,
    error: row.error,
    options: row.options,
    provenance: row.provenance,
  })
}

function tweetNoteFromRow(row: TweetNoteRow): SqliteTweetNote {
  return {
    id: row.id,
    tweetId: row.tweetId,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function tweetTimelineProvenanceFromRow(row: TweetTimelineProvenanceRow): SqliteTweetTimelineProvenance {
  return pruneUndefined({
    id: row.id,
    tweetId: row.tweetId,
    sourceLane: row.sourceLane,
    observedAt: row.observedAt,
    retweetedByUsername: row.retweetedByUsername ?? undefined,
    retweetedByDisplayName: row.retweetedByDisplayName ?? undefined,
    detailUrl: row.detailUrl ?? undefined,
  })
}


function tweetAttributeFromRow(row: TweetAttributeRow): SqliteTweetAttribute {
  return {
    tweetId: row.tweetId,
    key: row.key,
    value: row.value,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function waybackCdxEntryFromRow(row: WaybackCdxEntryRow): SqliteWaybackCdxEntry {
  return pruneUndefined({
    sourceLane: row.sourceLane,
    sourceUrl: row.sourceUrl,
    timestamp: row.timestamp,
    originalUrl: row.originalUrl,
    mementoUrl: row.mementoUrl,
    importBatchId: row.importBatchId,
    importStatus: row.importStatus,
    parseStatus: row.parseStatus as SqliteRawPageParseStatus,
    mimeType: row.mimeType ?? undefined,
    statusCode: row.statusCode ?? undefined,
    digest: row.digest ?? undefined,
    length: row.length ?? undefined,
    raw: parseJson(row.rawJson, "wayback_cdx_entries.raw_json"),
    importedAt: row.importedAt,
  })
}

function socialGraphNodeFromRow(row: SocialGraphNodeRow): SqliteSocialGraphNode {
  return normalizeSocialGraphNodeJson(row.dataJson, row)
}

function socialGraphEdgeFromRow(row: SocialGraphEdgeRow): SqliteSocialGraphEdge {
  if (!isSqliteSocialGraphRelation(row.relation)) {
    throw new Error(`Invalid social graph relation in sqlite store: ${row.relation}`)
  }
  if (!isSqliteSocialGraphImportStatus(row.importStatus)) {
    throw new Error(`Invalid social graph import status in sqlite store: ${row.importStatus}`)
  }

  return pruneUndefined({
    id: row.id,
    sourceAccountKey: row.sourceAccountKey,
    targetAccountKey: row.targetAccountKey,
    relation: row.relation,
    sourceLane: row.sourceLane,
    observedAt: row.observedAt,
    importBatchId: row.importBatchId ?? undefined,
    importStatus: row.importStatus,
    provenance: row.provenanceJson ? parseJson(row.provenanceJson, "social_graph_edges.provenance_json") : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

function normalizeSocialGraphNodeJson(json: string, row: SocialGraphNodeRow): SqliteSocialGraphNode {
  const value = parseJson(json, "social_graph_nodes.data_json")
  if (!isRecord(value)) {
    throw new Error("Invalid social graph node JSON in sqlite store")
  }
  return pruneUndefined({
    accountKey: row.accountKey,
    platform: row.platform,
    accountId: stringField(value, "accountId") ?? row.accountId ?? undefined,
    username: row.username,
    displayName: stringField(value, "displayName") ?? row.displayName ?? undefined,
    profileUrl: stringField(value, "profileUrl") ?? row.profileUrl ?? undefined,
    avatarUrl: stringField(value, "avatarUrl") ?? row.avatarUrl ?? undefined,
    description: stringField(value, "description") ?? row.description ?? undefined,
    protected: booleanField(value, "protected") ?? row.protected ?? undefined,
    verified: booleanField(value, "verified") ?? row.verified ?? undefined,
    observedAt: row.observedAt,
    updatedAt: row.updatedAt,
    provenance: row.provenanceJson ? parseJson(row.provenanceJson, "social_graph_nodes.provenance_json") : undefined,
  })
}

function normalizeSocialGraphAccount(input: SqliteSocialGraphAccountInput): SqliteSocialGraphNode {
  const username = normalizeSocialGraphUsername(input.username)
  const observedAt = input.observedAt ?? nowIso()
  return pruneUndefined({
    accountKey: sqliteSocialGraphAccountKey({ username }),
    platform: "x",
    accountId: input.accountId,
    username,
    displayName: input.displayName,
    profileUrl: input.profileUrl,
    avatarUrl: input.avatarUrl,
    description: input.description,
    protected: input.protected,
    verified: input.verified,
    observedAt,
    updatedAt: observedAt,
    provenance: input.provenance,
  })
}

export function sqliteSocialGraphAccountKey(input: { username: string }): string {
  return `x:${normalizeSocialGraphUsername(input.username).toLowerCase()}`
}

export function normalizeSocialGraphUsername(username: string): string {
  const normalized = username.trim().replace(/^@+/, "")
  if (normalized.length === 0) {
    throw new Error("Social graph username must be non-empty")
  }
  return normalized
}

function stringifyJson(value: SqliteJsonValue | object): string {
  const json = JSON.stringify(value)
  if (json === undefined) {
    throw new Error("Cannot serialize undefined into sqlite store JSON")
  }
  return json
}

function parseJson(json: string, label: string): SqliteJsonValue {
  try {
    return JSON.parse(json) as SqliteJsonValue
  } catch (error) {
    throw new Error(`Invalid JSON in sqlite store ${label}`, { cause: error })
  }
}

function parseHeadersJson(json: string): Record<string, string> {
  const value = parseJson(json, "raw_pages.headers_json")
  if (!isRecord(value)) {
    throw new Error("Invalid headers JSON in sqlite store")
  }

  const headers: Record<string, string> = {}
  for (const [key, headerValue] of Object.entries(value)) {
    if (typeof headerValue !== "string") {
      throw new Error(`Invalid header value in sqlite store: ${key}`)
    }
    headers[key] = headerValue
  }
  return headers
}

function mergeArchiveTweet(existing: ArchiveTweet, incoming: ArchiveTweet): ArchiveTweet {
  const mediaIds = Array.from(new Set([...existing.mediaIds, ...incoming.mediaIds]))
  const text = incoming.text.length >= existing.text.length ? incoming.text : existing.text
  return pruneUndefined({
    ...existing,
    ...incoming,
    text,
    username: incoming.username ?? existing.username,
    createdAt: incoming.createdAt ?? existing.createdAt,
    conversationId: incoming.conversationId ?? existing.conversationId,
    inReplyToTweetId: incoming.inReplyToTweetId ?? existing.inReplyToTweetId,
    inReplyToUserId: incoming.inReplyToUserId ?? existing.inReplyToUserId,
    replyToUsername: incoming.replyToUsername ?? existing.replyToUsername,
    quotedTweetId: incoming.quotedTweetId ?? existing.quotedTweetId,
    quotedTweetUrl: incoming.quotedTweetUrl ?? existing.quotedTweetUrl,
    mediaIds,
    language: incoming.language ?? existing.language,
    publicMetrics: incoming.publicMetrics ?? existing.publicMetrics,
    source: incoming.source ?? existing.source,
  })
}

function tweetHasStoredContent(tweet: ArchiveTweet | undefined): boolean {
  return tweet !== undefined && tweet.text.trim().length > 0
}

function pruneUndefined<T extends object>(record: T): T {
  for (const key of Object.keys(record) as Array<keyof T>) {
    if (record[key] === undefined) {
      delete record[key]
    }
  }
  return record
}

function parseArchiveUserJson(json: string): ArchiveUser {
  const value = parseJson(json, "users.data_json")
  if (!isArchiveUser(value)) {
    throw new Error("Invalid ArchiveUser JSON in sqlite store")
  }
  return value
}

function parseArchiveTweetJson(json: string): ArchiveTweet {
  const value = parseJson(json, "tweets.data_json")
  if (!isArchiveTweet(value)) {
    throw new Error("Invalid ArchiveTweet JSON in sqlite store")
  }
  return value
}

function parseArchiveMediaJson(json: string): ArchiveMedia {
  const value = parseJson(json, "media.data_json")
  if (!isArchiveMedia(value)) {
    throw new Error("Invalid ArchiveMedia JSON in sqlite store")
  }
  return value
}

function isSqliteCaptureJobStatus(value: string): value is SqliteCaptureJobStatus {
  return value in captureJobStatuses
}

function isSqliteArchiveJobTargetType(value: string): value is SqliteArchiveJobTargetType {
  return value in archiveJobTargetTypes
}

function isSqliteArchiveJobStatus(value: string): value is SqliteArchiveJobStatus {
  return value in archiveJobStatuses
}

function assertArchiveJobTargetType(value: string): asserts value is SqliteArchiveJobTargetType {
  if (!isSqliteArchiveJobTargetType(value)) {
    throw new Error(`Unsupported archive job target type: ${value}`)
  }
}

function assertArchiveJobStatus(value: string): asserts value is SqliteArchiveJobStatus {
  if (!isSqliteArchiveJobStatus(value)) {
    throw new Error(`Unsupported archive job status: ${value}`)
  }
}

function assertArchiveJobTerminalStatus(value: string): asserts value is Extract<SqliteArchiveJobStatus, "completed" | "failed" | "skipped"> {
  if (value !== "completed" && value !== "failed" && value !== "skipped") {
    throw new Error(`Archive job finish status must be terminal: ${value}`)
  }
}

function isSqliteSocialGraphRelation(value: string): value is SqliteSocialGraphRelation {
  return value in socialGraphRelations
}

function isSqliteSocialGraphImportStatus(value: string): value is SqliteSocialGraphImportStatus {
  return value in socialGraphImportStatuses
}

function assertSocialGraphRelation(value: string): asserts value is SqliteSocialGraphRelation {
  if (!isSqliteSocialGraphRelation(value)) {
    throw new Error(`Invalid social graph relation: ${value}`)
  }
}

function assertSocialGraphImportStatus(value: string): asserts value is SqliteSocialGraphImportStatus {
  if (!isSqliteSocialGraphImportStatus(value)) {
    throw new Error(`Invalid social graph import status: ${value}`)
  }
}

function isArchiveCaptureSource(value: SqliteJsonValue | undefined): value is ArchiveCaptureSource {
  return typeof value === "string" && value in archiveCaptureSources
}

function isArchiveMediaType(value: SqliteJsonValue | undefined): value is ArchiveMediaType {
  return typeof value === "string" && value in archiveMediaTypes
}

function isArchiveUser(value: SqliteJsonValue | object | undefined): value is ArchiveUser {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.id === "string" &&
    typeof value.username === "string" &&
    isOptionalString(value.displayName) &&
    isOptionalString(value.avatarUrl) &&
    isOptionalString(value.profileUrl) &&
    isOptionalString(value.description) &&
    isOptionalBoolean(value.verified) &&
    isOptionalBoolean(value.protected) &&
    isOptionalString(value.capturedAt)
  )
}

function isArchiveTweet(value: SqliteJsonValue | object | undefined): value is ArchiveTweet {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.id === "string" &&
    typeof value.authorId === "string" &&
    isOptionalString(value.username) &&
    typeof value.url === "string" &&
    typeof value.text === "string" &&
    isOptionalString(value.createdAt) &&
    isOptionalString(value.conversationId) &&
    isOptionalString(value.inReplyToTweetId) &&
    isOptionalString(value.inReplyToUserId) &&
    isOptionalString(value.replyToUsername) &&
    isOptionalString(value.quotedTweetId) &&
    isOptionalString(value.quotedTweetUrl) &&
    isStringArray(value.mediaIds) &&
    isOptionalString(value.language) &&
    isOptionalPublicMetrics(value.publicMetrics) &&
    typeof value.capturedAt === "string" &&
    isOptionalArchiveCaptureSource(value.source)
  )
}

function isArchiveMedia(value: SqliteJsonValue | object | undefined): value is ArchiveMedia {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.id === "string" &&
    typeof value.tweetId === "string" &&
    isArchiveMediaType(value.type) &&
    isOptionalString(value.remoteUrl) &&
    isOptionalString(value.localPath) &&
    isOptionalString(value.previewImageUrl) &&
    isOptionalString(value.altText) &&
    isOptionalNumber(value.width) &&
    isOptionalNumber(value.height) &&
    isOptionalNumber(value.durationMs) &&
    isOptionalMediaVariants(value.variants) &&
    isOptionalString(value.capturedAt) &&
    isOptionalArchiveCaptureSource(value.source)
  )
}

function isOptionalPublicMetrics(value: SqliteJsonValue | undefined): boolean {
  if (value === undefined) {
    return true
  }
  if (!isRecord(value)) {
    return false
  }

  return (
    isOptionalNumber(value.replies) &&
    isOptionalNumber(value.reposts) &&
    isOptionalNumber(value.likes) &&
    isOptionalNumber(value.quotes) &&
    isOptionalNumber(value.views)
  )
}

function isOptionalMediaVariants(value: SqliteJsonValue | undefined): boolean {
  if (value === undefined) {
    return true
  }
  if (!Array.isArray(value)) {
    return false
  }

  return value.every((variant) => {
    if (!isRecord(variant)) {
      return false
    }
    return typeof variant.url === "string" && isOptionalString(variant.contentType) && isOptionalNumber(variant.bitrate)
  })
}

function isOptionalArchiveCaptureSource(value: SqliteJsonValue | undefined): boolean {
  return value === undefined || isArchiveCaptureSource(value)
}

function isStringArray(value: SqliteJsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isOptionalString(value: SqliteJsonValue | undefined): boolean {
  return value === undefined || typeof value === "string"
}

function isOptionalNumber(value: SqliteJsonValue | undefined): boolean {
  return value === undefined || typeof value === "number"
}

function isOptionalBoolean(value: SqliteJsonValue | undefined): boolean {
  return value === undefined || typeof value === "boolean"
}


function stringField(record: SqliteJsonRecord, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function booleanField(record: SqliteJsonRecord, key: string): boolean | undefined {
  const value = record[key]
  return typeof value === "boolean" ? value : undefined
}

function isRecord(value: SqliteJsonValue | object | undefined): value is SqliteJsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
