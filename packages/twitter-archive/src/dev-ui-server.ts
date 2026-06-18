import { Database } from "bun:sqlite"
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises"
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path"

import { Effect, Layer, Schema } from "effect"

import {
  makeTwitterArchiveJsonlLogger,
  parseTwitterArchiveConfigEffect,
  TwitterArchiveConfig,
  type TwitterArchiveConfigEnv,
  type TwitterArchiveJsonlLoggerService,
  TwitterArchiveJsonlLogger,
} from "./effect-services"
import type { JsonlLogDetails, JsonlLogLevel, JsonlLogValue } from "./jsonl-log"
import type { ArchiveMedia, ArchiveTweet, ArchiveUser } from "./schema"
import { TwitterArchiveSqliteStore, initTwitterArchiveSqliteStore, type SqliteArchiveJob, type SqliteArchiveJobStatus, type SqliteArchiveJobTargetType, type SqliteCaptureJob, type SqliteInteractionSignalInput } from "./sqlite-store"
import { stableId } from "./normalize"
import { DEV_UI_STYLES } from "./dev-ui-styles"

export const DEFAULT_DEV_UI_PORT = 3420
export const DEFAULT_DEV_UI_HOSTNAME = "127.0.0.1"
export const DEFAULT_DEV_UI_DATA_DIR = resolve(import.meta.dir, "../../..", "data/twitter-archive")
export const DEFAULT_DEV_UI_DB_PATH = join(DEFAULT_DEV_UI_DATA_DIR, "twitter-archive.sqlite")
export const DEFAULT_DEV_UI_LOG_PATH = join(DEFAULT_DEV_UI_DATA_DIR, "twitter-archive.jsonl")

export type DevUiMediaDownloadStatus = "downloaded" | "queued" | "remote-only" | "missing-remote"
export type DevUiTweetGroupKind = "single" | "thread" | "reply"

export interface DevUiServerOptions {
  readonly env?: TwitterArchiveConfigEnv
  readonly hostname?: string
  readonly clientEntryPath?: string
}

export interface RunningDevUiServer {
  readonly url: string
  readonly server: Bun.Server<undefined>
  readonly stop: () => Promise<void>
}

export interface DevUiSummary {
  readonly generatedAt: string
  readonly dbPath: string
  readonly logPath: string
  readonly counts: {
    readonly rawPages: number
    readonly captureJobs: number
    readonly archiveJobs: number
    readonly users: number
    readonly tweets: number
    readonly media: number
  }
  readonly jobs: {
    readonly pending: number
    readonly running: number
    readonly completed: number
    readonly failed: number
  }
  readonly media: {
    readonly downloaded: number
    readonly queued: number
    readonly remoteOnly: number
    readonly missingRemote: number
  }
  readonly latestTweetAt?: string
  readonly latestJobAt?: string
}

export interface DevUiMediaView extends ArchiveMedia {
  readonly downloadStatus: DevUiMediaDownloadStatus
  readonly previewUrl?: string
}

export interface DevUiUserView extends ArchiveUser {
  readonly tweetCount: number
  readonly latestTweetAt?: string
}

export type DevUiTweetAttributeName = "bookmark" | "attribute"

export interface DevUiTweetAnnotationView {
  readonly tweetId: string
  readonly note?: string
  readonly bookmarked: boolean
  readonly attributed: boolean
  readonly updatedAt?: string
}

export interface DevUiQuotedTweetView extends ArchiveTweet {
  readonly displayName?: string
  readonly media: readonly DevUiMediaView[]
}

export interface DevUiRetweetProvenanceView {
  readonly username?: string
  readonly displayName?: string
}


export interface DevUiTweetView extends ArchiveTweet {
  readonly media: readonly DevUiMediaView[]
  readonly replyDepth: number
  readonly annotation: DevUiTweetAnnotationView
  readonly quotedTweet?: DevUiQuotedTweetView
  readonly retweetedBy?: DevUiRetweetProvenanceView
}

export interface DevUiTweetGroupView {
  readonly groupId: string
  readonly kind: DevUiTweetGroupKind
  readonly title: string
  readonly tweets: readonly DevUiTweetView[]
  readonly latestAt: string
}

export interface DevUiProfileView {
  readonly user: DevUiUserView
  readonly tweetGroups: readonly DevUiTweetGroupView[]
}

export interface DevUiSocialGraphNodeSummary {
  readonly accountKey: string
  readonly username: string
  readonly displayName?: string
  readonly edgeCount: number
}

export interface DevUiSocialGraphEdgeView {
  readonly id: string
  readonly sourceAccountKey: string
  readonly sourceUsername?: string
  readonly targetAccountKey: string
  readonly targetUsername?: string
  readonly relation: "following"
  readonly sourceLane: string
  readonly observedAt: string
  readonly importBatchId?: string
  readonly importStatus: string
}

export interface DevUiSocialGraphSummary {
  readonly nodes: number
  readonly edges: number
  readonly batches: number
  readonly followingEdges: number
  readonly topSources: readonly DevUiSocialGraphNodeSummary[]
  readonly topTargets: readonly DevUiSocialGraphNodeSummary[]
  readonly recentEdges: readonly DevUiSocialGraphEdgeView[]
}


export interface DevUiLogEventView {
  readonly lineNumber: number
  readonly raw: string
  readonly timestamp?: string
  readonly component?: string
  readonly level?: JsonlLogLevel
  readonly event?: string
  readonly runId?: string
  readonly jobId?: string
  readonly details?: JsonlLogDetails
  readonly parseError?: string
}

export interface DevUiState {
  readonly summary: DevUiSummary
  readonly users: readonly DevUiUserView[]
  readonly tweetGroups: readonly DevUiTweetGroupView[]
  readonly media: readonly DevUiMediaView[]
  readonly jobs: readonly SqliteCaptureJob[]
  readonly events: readonly DevUiLogEventView[]
  readonly socialGraph: DevUiSocialGraphSummary
}

export class DevUiServerStartupError extends Schema.TaggedErrorClass<DevUiServerStartupError>()(
  "DevUiServerStartupError",
  {
    message: Schema.String,
  },
) {}

const FrontendEventInputSchema = Schema.Struct({
  level: Schema.optionalKey(Schema.Union([Schema.Literal("debug"), Schema.Literal("info"), Schema.Literal("warn"), Schema.Literal("error")])),
  event: Schema.NonEmptyString,
  details: Schema.optionalKey(Schema.Json),
})

const TweetNoteInputSchema = Schema.Struct({
  tweetId: Schema.NonEmptyString,
  note: Schema.String,
})

const TweetAttributeInputSchema = Schema.Struct({
  tweetId: Schema.NonEmptyString,
  attribute: Schema.Union([Schema.Literal("bookmark"), Schema.Literal("attribute")]),
  value: Schema.Boolean,
})

const ArchiveJobInputSchema = Schema.Struct({
  sourceLane: Schema.optionalKey(Schema.NonEmptyString),
  targetType: Schema.Union([
    Schema.Literal("profile"),
    Schema.Literal("status"),
    Schema.Literal("search"),
    Schema.Literal("wayback"),
    Schema.Literal("following"),
  ]),
  targetValue: Schema.NonEmptyString,
  priority: Schema.optionalKey(Schema.Number),
  options: Schema.optionalKey(Schema.Json),
  provenance: Schema.optionalKey(Schema.Json),
})

type FrontendEventInput = Schema.Schema.Type<typeof FrontendEventInputSchema>
type TweetNoteInput = Schema.Schema.Type<typeof TweetNoteInputSchema>
type TweetAttributeInput = Schema.Schema.Type<typeof TweetAttributeInputSchema>
type ArchiveJobInput = Schema.Schema.Type<typeof ArchiveJobInputSchema>

const X_BOOKMARK_SYNC_SOURCE_LANE = "x-bookmark-sync-devtools"

interface XBookmarkSyncSnapshotInput {
  readonly source: Record<string, JsonSafeValue>
  readonly generatedAt?: string
  readonly captures: readonly XBookmarkSyncCaptureInput[]
  readonly incremental?: boolean
  readonly signals?: readonly XBookmarkSyncSignalInput[]
}

interface XBookmarkSyncCaptureInput {
  readonly id?: string
  readonly capturedAt?: string
  readonly inspectedTabId?: number
  readonly request: {
    readonly method?: string
    readonly url: string
    readonly headers?: JsonSafeValue
  }
  readonly response?: {
    readonly status?: number
    readonly statusText?: string
    readonly mimeType?: string
    readonly bodySize?: number
    readonly encoding?: string
    readonly headers?: JsonSafeValue
  }
  readonly timing?: Record<string, JsonSafeValue>
  readonly tags: readonly string[]
  readonly tweetLike: readonly XBookmarkSyncTweetLikeRecord[]
  readonly json?: JsonSafeValue
  readonly body?: string
  readonly parseError?: string
  readonly signals?: readonly XBookmarkSyncSignalInput[]
}

interface XBookmarkSyncTweetLikeRecord {
  readonly rest_id?: string
  readonly id_str?: string
  readonly full_text: string
  readonly created_at?: string
  readonly screen_name?: string
  readonly path?: string
  readonly url?: string
}

interface XBookmarkSyncSignalInput {
  readonly signalId?: string
  readonly kind: string
  readonly observedAt: string
  readonly durationMs?: number
  readonly pageUrl?: string
  readonly sourceUrl?: string
  readonly tabId?: number
  readonly sessionId?: string
  readonly tweetId?: string
  readonly profileHandle?: string
  readonly listId?: string
  readonly searchQuery?: string
  readonly confidence?: number
  readonly details?: Record<string, JsonSafeValue>
}

interface XBookmarkSyncIngestSummary {
  readonly capturesReceived: number
  readonly tweetLikeRecords: number
  readonly archiveJobsEnqueued: number
  readonly markdownFilesWritten: number
  readonly signalsReceived: number
}


interface XBookmarkSyncMarkdownEntry {
  readonly id: string
  readonly username?: string
  readonly text?: string
  readonly url: string
  readonly source: string
  readonly capturedAt: string
  readonly requestUrl?: string
  readonly provenance: Record<string, JsonSafeValue>
}

type JsonSafeValue = null | string | number | boolean | readonly JsonSafeValue[] | { readonly [key: string]: JsonSafeValue }

interface TweetRow {
  readonly data_json: string
}

interface UserRow {
  readonly data_json: string
  readonly tweet_count: number
  readonly latest_tweet_at: string | null
}

interface MediaRow {
  readonly data_json: string
}

interface RetweetProvenanceRow {
  readonly tweet_id: string
  readonly retweeted_by_username: string | null
  readonly retweeted_by_display_name: string | null
}


interface CountRow {
  readonly count: number
}

interface LatestRow {
  readonly latest: string | null
}

interface CaptureJobRow {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly request_hash: string
  readonly status: "pending" | "running" | "completed" | "failed"
  readonly stage: string
  readonly attempts: number
  readonly created_at: string
  readonly updated_at: string
  readonly started_at: string | null
  readonly completed_at: string | null
  readonly failed_at: string | null
  readonly retry_after_at: string | null
  readonly error: string | null
}

interface TweetNoteRow {
  readonly tweet_id: string
  readonly note: string
  readonly updated_at: string
}

interface TweetAttributeRow {
  readonly tweet_id: string
  readonly attribute: DevUiTweetAttributeName
  readonly value: number
  readonly updated_at: string
}

const localApiHeaders = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Private-Network": "true",
}

const jsonHeaders = {
  ...localApiHeaders,
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
}

const clientHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/javascript; charset=utf-8",
}

const cssHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "text/css; charset=utf-8",
}

const DEV_UI_HEALTH_RESPONSE = {
  ok: true,
  service: "twitter-archive-dev-ui",
  ingestPath: "/api/x-bookmark-sync/ingest",
}

export const startDevUiServer = Effect.fn("startDevUiServer")(function*(options: DevUiServerOptions = {}) {
  const env = buildDevUiConfigEnv(options.env)
  const config = yield* parseTwitterArchiveConfigEffect(env)
  const logger = makeTwitterArchiveJsonlLogger(config.logPath)
  const hostname = options.hostname ?? firstNonEmpty(process.env.TWITTER_ARCHIVE_DEV_HOST, process.env.HOST) ?? DEFAULT_DEV_UI_HOSTNAME

  return yield* Effect.provide(startDevUiServerFromServices(hostname, options.clientEntryPath), [
    Layer.succeed(TwitterArchiveConfig, config),
    Layer.succeed(TwitterArchiveJsonlLogger, logger),
  ])
})

const startDevUiServerFromServices = Effect.fn("startDevUiServerFromServices")(function*(
  hostname: string,
  clientEntryPath?: string,
) {
  const config = yield* TwitterArchiveConfig
  const logger = yield* TwitterArchiveJsonlLogger

  return yield* Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(config.dbPath), { recursive: true })
      await mkdir(dirname(config.logPath), { recursive: true })
      await mkdir(resolve(config.mediaRoot), { recursive: true })
      await mkdir(resolve(config.markdownRoot), { recursive: true })

      const schemaStore = initTwitterArchiveSqliteStore(config.dbPath)
      schemaStore.close()

      const clientScript = await buildDevUiClient(clientEntryPath ?? join(import.meta.dir, "dev-ui-client.ts"))
      const dataSource = new DevUiDataSource(config.dbPath, config.logPath, config.mediaRoot, config.markdownRoot)
      const requestHandler = createRequestHandler(dataSource, clientScript, logger, config.mediaRoot)
      const server = Bun.serve({
        hostname,
        port: config.port,
        fetch: requestHandler,
      })
      const url = server.url.toString().replace(/\/$/, "")

      console.info(`Twitter archive dev UI listening at ${url}`)
      void Effect.runPromise(
        logger.log({
          component: "server",
          level: "info",
          event: "dev_ui_started",
          details: {
            url,
            dbPath: config.dbPath,
            logPath: config.logPath,
          },
        }),
      ).catch(() => undefined)

      return {
        url,
        server,
        stop: async () => {
          dataSource.close()
          await server.stop()
        },
      } satisfies RunningDevUiServer
    },
    catch: (error) => new DevUiServerStartupError({ message: errorToMessage(error as Error | string | null | undefined) }),
  })
})

function createRequestHandler(
  dataSource: DevUiDataSource,
  clientScript: string,
  logger: TwitterArchiveJsonlLoggerService,
  mediaRoot: string,
): (request: Request) => Response | Promise<Response> {
  return async (request: Request) => {
    const url = new URL(request.url)

    try {
      if (request.method === "GET" && url.pathname === "/") {
        return htmlResponse(renderHtml())
      }

      if (request.method === "GET" && url.pathname === "/assets/dev-ui-client.js") {
        return new Response(clientScript, { headers: clientHeaders })
      }

      if (request.method === "GET" && url.pathname === "/assets/dev-ui.css") {
        return new Response(DEV_UI_STYLES, { headers: cssHeaders })
      }

      if (request.method === "GET" && url.pathname === "/media-file") {
        return await mediaFileResponse(mediaRoot, url.searchParams.get("path"))
      }

      if (request.method === "OPTIONS" && isLocalApiPreflightPath(url.pathname)) {
        return optionsResponse()
      }

      if (request.method === "GET" && isHealthPath(url.pathname)) {
        return jsonResponse(DEV_UI_HEALTH_RESPONSE)
      }

      if (request.method === "POST" && isXBookmarkSyncIngestPath(url.pathname)) {
        return await handleXBookmarkSyncIngest(request, dataSource)
      }

      if (request.method === "GET" && url.pathname === "/api/users") {
        const limit = readLimit(url, "limit", 100, 500)
        return jsonResponse(dataSource.getUsers(limit))
      }

      if (request.method === "GET" && url.pathname === "/api/profile") {
        const limit = readLimit(url, "limit", 100, 500)
        const userId = firstNonEmpty(url.searchParams.get("userId") ?? undefined, url.searchParams.get("id") ?? undefined)
        if (!userId) {
          return jsonResponse({ error: "Missing userId" }, 400)
        }
        const profile = dataSource.getProfile(userId, limit)
        return profile ? jsonResponse(profile) : jsonResponse({ error: "Profile not found" }, 404)
      }

      if (request.method === "GET" && url.pathname === "/api/summary") {
        return jsonResponse(dataSource.getSummary())
      }

      if (request.method === "GET" && url.pathname === "/api/social-graph") {
        const limit = readLimit(url, "limit", 10, 100)
        return jsonResponse(dataSource.getSocialGraphSummary(limit))
      }

      if (request.method === "GET" && url.pathname === "/api/archive-jobs") {
        const limit = readLimit(url, "limit", 100, 500)
        return jsonResponse(
          dataSource.getArchiveJobs({
            limit,
            status: archiveJobStatusParam(url.searchParams.get("status")),
            sourceLane: firstNonEmpty(url.searchParams.get("sourceLane") ?? undefined, url.searchParams.get("lane") ?? undefined),
            targetType: archiveJobTargetTypeParam(url.searchParams.get("targetType")),
          }),
        )
      }

      if (request.method === "GET" && url.pathname === "/api/tweets") {
        const limit = readLimit(url, "limit", 100, 500)
        return jsonResponse(dataSource.getTweetGroups(limit))
      }

      if (request.method === "GET" && url.pathname === "/api/media") {
        const limit = readLimit(url, "limit", 100, 500)
        return jsonResponse(dataSource.getMedia(limit))
      }

      if (request.method === "GET" && url.pathname === "/api/jobs") {
        const limit = readLimit(url, "limit", 100, 500)
        return jsonResponse(dataSource.getJobs(limit))
      }

      if (request.method === "POST" && url.pathname === "/api/archive-jobs") {
        return await handleArchiveJob(request, dataSource)
      }

      if (request.method === "GET" && (url.pathname === "/api/events" || url.pathname === "/api/logs")) {

        const limit = readLimit(url, "limit", 120, 500)
        return jsonResponse(await dataSource.getRecentEvents(limit))
      }

      if (request.method === "POST" && url.pathname === "/api/events") {
        return await handleFrontendEvent(request, logger)
      }

      if (request.method === "POST" && url.pathname === "/api/tweet-notes") {
        return await handleTweetNote(request, dataSource)
      }

      if (request.method === "POST" && url.pathname === "/api/tweet-attributes") {
        return await handleTweetAttribute(request, dataSource)
      }

      if (request.method === "GET" && url.pathname === "/api/state") {
        const limit = readLimit(url, "limit", 100, 500)
        return jsonResponse(await dataSource.getState(limit))
      }

      if (request.method === "GET" && url.pathname === "/api/stream") {
        const limit = readLimit(url, "limit", 100, 500)
        return streamState(dataSource, limit)
      }

      return jsonResponse({ error: "Not found" }, 404)
    } catch (error) {
      return jsonResponse({ error: errorToMessage(error as Error | string | null | undefined) }, 500)
    }
  }
}

class DevUiDataSource {
  private readonly db: Database

  constructor(
    private readonly dbPath: string,
    private readonly logPath: string,
    private readonly mediaRoot: string,
    private readonly markdownRoot: string,
  ) {
    this.db = new Database(dbPath)
    this.initAnnotationTables()
  }

  close(): void {
    this.db.close()
  }

  async getState(limit: number): Promise<DevUiState> {
    return {
      summary: this.getSummary(),
      users: this.getUsers(limit),
      tweetGroups: this.getTweetGroups(limit),
      media: this.getMedia(limit),
      jobs: this.getJobs(limit),
      events: await this.getRecentEvents(limit),
      socialGraph: this.getSocialGraphSummary(limit),
    }
  }

  getSummary(): DevUiSummary {
    const media = this.getMediaStatusCounts()
    return {
      generatedAt: new Date().toISOString(),
      dbPath: this.dbPath,
      logPath: this.logPath,
      counts: {
        rawPages: this.count("raw_pages"),
        captureJobs: this.count("capture_jobs"),
        archiveJobs: this.count("archive_jobs"),
        users: this.count("users"),
        tweets: this.count("tweets"),
        media: this.count("media"),
      },
      jobs: {
        pending: this.countJobsByStatus("pending"),
        running: this.countJobsByStatus("running"),
        completed: this.countJobsByStatus("completed"),
        failed: this.countJobsByStatus("failed"),
      },
      media,
      latestTweetAt: this.latestTweetAt(),
      latestJobAt: this.latest("capture_jobs", "updated_at"),
    }
  }

  getSocialGraphSummary(limit: number): DevUiSocialGraphSummary {
    return {
      nodes: this.count("social_graph_nodes"),
      edges: this.count("social_graph_edges"),
      batches: this.count("social_graph_import_batches"),
      followingEdges: this.countSocialGraphFollowingEdges(),
      topSources: this.socialGraphNodeSummaries("source", limit),
      topTargets: this.socialGraphNodeSummaries("target", limit),
      recentEdges: this.recentSocialGraphEdges(limit),
    }
  }

  private latestTweetAt(): string | undefined {
    const rows = this.db.prepare("SELECT data_json FROM tweets").all() as TweetRow[]
    let latestTweet: ArchiveTweet | undefined
    for (const row of rows) {
      const tweet = JSON.parse(row.data_json) as ArchiveTweet
      if (!latestTweet || compareTweetDescending(tweet, latestTweet) < 0) {
        latestTweet = tweet
      }
    }
    return latestTweet?.createdAt ?? latestTweet?.capturedAt
  }

  getUsers(limit: number): DevUiUserView[] {
    const rows = this.db
      .prepare(
        `SELECT u.data_json,
                COUNT(t.id) AS tweet_count,
                MAX(COALESCE(t.created_at, t.captured_at, t.updated_at)) AS latest_tweet_at
         FROM users u
         LEFT JOIN tweets t ON t.author_id = u.id
         GROUP BY u.id
         ORDER BY latest_tweet_at DESC, u.username ASC
         LIMIT ?`,
      )
      .all(limit) as UserRow[]
    return rows.map((row) => this.userViewFromRow(row))
  }

  getProfile(userId: string, limit: number): DevUiProfileView | undefined {
    const user = this.getUserById(userId)
    if (!user) {
      return undefined
    }

    return {
      user,
      tweetGroups: this.getTweetGroupsByAuthor(user.id, limit),
    }
  }

  private getUserById(userId: string): DevUiUserView | undefined {
    const row = this.db
      .prepare(
        `SELECT u.data_json,
                COUNT(t.id) AS tweet_count,
                MAX(COALESCE(t.created_at, t.captured_at, t.updated_at)) AS latest_tweet_at
         FROM users u
         LEFT JOIN tweets t ON t.author_id = u.id
         WHERE u.id = ?
         GROUP BY u.id`,
      )
      .get(userId) as UserRow | undefined
    return row ? this.userViewFromRow(row) : this.userViewFromTweets(userId)
  }

  private userViewFromRow(row: UserRow): DevUiUserView {
    return {
      ...(JSON.parse(row.data_json) as ArchiveUser),
      tweetCount: row.tweet_count,
      latestTweetAt: row.latest_tweet_at ?? undefined,
    }
  }

  private userViewFromTweets(userId: string): DevUiUserView | undefined {
    const rows = this.db.prepare("SELECT data_json FROM tweets WHERE author_id = ?").all(userId) as TweetRow[]
    if (rows.length === 0) {
      return undefined
    }

    let latestTweet: ArchiveTweet | undefined
    for (const row of rows) {
      const tweet = JSON.parse(row.data_json) as ArchiveTweet
      if (!latestTweet || compareTweetDescending(tweet, latestTweet) < 0) {
        latestTweet = tweet
      }
    }

    return {
      id: userId,
      username: latestTweet?.username ?? userId,
      tweetCount: rows.length,
      latestTweetAt: latestTweet?.createdAt ?? latestTweet?.capturedAt,
    }
  }

  getTweetGroups(limit: number): DevUiTweetGroupView[] {
    const tweets = (this.db
      .prepare(
        `SELECT data_json
         FROM tweets
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(limit) as TweetRow[]).map((row) => JSON.parse(row.data_json) as ArchiveTweet)
    return this.buildTweetGroups(tweets)
  }

  private getTweetGroupsByAuthor(userId: string, limit: number): DevUiTweetGroupView[] {
    const tweets = (this.db
      .prepare(
        `SELECT data_json
         FROM tweets
         WHERE author_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(userId, limit) as TweetRow[]).map((row) => JSON.parse(row.data_json) as ArchiveTweet)
    return this.buildTweetGroups(tweets)
  }

  private buildTweetGroups(tweets: readonly ArchiveTweet[]): DevUiTweetGroupView[] {
    const quotedTweets = this.getTweetsByIds(tweets.map((tweet) => tweet.quotedTweetId).filter((id): id is string => id !== undefined)).filter(
      hasQuotedTweetContent,
    )

    const mediaByTweetId = groupMediaByTweetId(this.getMediaForTweets([...tweets, ...quotedTweets]))
    const quotedAuthorsById = this.getUsersByIds(quotedTweets.map((tweet) => tweet.authorId))
    const quotedTweetsById = new Map(
      quotedTweets.map((tweet) => [tweet.id, buildQuotedTweetView(tweet, mediaByTweetId, quotedAuthorsById)]),
    )
    const annotationsByTweetId = this.getTweetAnnotationsForTweets(tweets.map((tweet) => tweet.id))
    const retweetsByTweetId = this.getRetweetProvenanceForTweets(tweets.map((tweet) => tweet.id))
    return groupTweets(tweets, mediaByTweetId, annotationsByTweetId, quotedTweetsById, retweetsByTweetId)
  }

  getMedia(limit: number): DevUiMediaView[] {
    const rows = this.db
      .prepare(
        `SELECT data_json
         FROM media
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`,
      )
      .all(limit) as MediaRow[]
    return rows.map((row) => withMediaStatus(JSON.parse(row.data_json) as ArchiveMedia, this.mediaRoot))
  }

  getJobs(limit: number): SqliteCaptureJob[] {
    const rows = this.db
      .prepare(
        `SELECT id, source, target, request_hash, status, stage, attempts, created_at, updated_at,
                started_at, completed_at, failed_at, retry_after_at, error
         FROM capture_jobs
         ORDER BY updated_at DESC, id
         LIMIT ?`,
      )
      .all(limit) as CaptureJobRow[]
    return rows.map(captureJobFromRow)
  }

  getArchiveJobs(filter: { limit: number; status?: SqliteArchiveJobStatus; sourceLane?: string; targetType?: SqliteArchiveJobTargetType }): SqliteArchiveJob[] {
    return new TwitterArchiveSqliteStore(this.db).listArchiveJobs(filter)
  }

  enqueueArchiveJob(input: ArchiveJobInput): SqliteArchiveJob {
    return new TwitterArchiveSqliteStore(this.db).enqueueArchiveJob({
      sourceLane: input.sourceLane ?? "dev-ui",
      targetType: input.targetType,
      targetValue: input.targetValue,
      priority: input.priority,
      options: input.options,
      provenance: input.provenance,
    })
  }

  async ingestXBookmarkSyncSnapshot(snapshot: XBookmarkSyncSnapshotInput): Promise<XBookmarkSyncIngestSummary> {
    const store = new TwitterArchiveSqliteStore(this.db)
    const statusUrls = new Map<string, XBookmarkSyncMarkdownEntry>()
    const tweetRecords = new Map<string, { record: XBookmarkSyncTweetLikeRecord; capture: XBookmarkSyncCaptureInput; url: string; capturedAt: string }>()
    const usersToUpsert = new Map<string, ArchiveUser>()
    let rawPagesStored = 0
    let tweetLikeRecordsFound = 0
    let signalsReceived = 0
    for (const signal of snapshot.signals ?? []) {
      const pageUrl = signal.pageUrl ?? signal.sourceUrl
      if (!pageUrl) {
        continue
      }
      store.insertInteractionSignal(buildInteractionSignalInput(signal, pageUrl))
      signalsReceived += 1
    }

    for (const capture of snapshot.captures) {
      const capturedAt = normalizeIsoDate(capture.capturedAt) ?? normalizeIsoDate(snapshot.generatedAt) ?? new Date().toISOString()
      const requestUrl = capture.request.url
      const storedRequestUrl = redactSensitiveUrl(requestUrl)
      const captureId = capture.id ?? stableId([X_BOOKMARK_SYNC_SOURCE_LANE, requestUrl, capturedAt]).slice(0, 16)
      const metadata = sanitizedCaptureMetadata(capture, snapshot.source, snapshot.incremental)
      const requestHash = stableId([X_BOOKMARK_SYNC_SOURCE_LANE, captureId, requestUrl, capturedAt])
      store.cacheRawPage({
        source: X_BOOKMARK_SYNC_SOURCE_LANE,
        url: storedRequestUrl,
        requestHash,
        fetchedAt: capturedAt,
        statusCode: capture.response?.status,
        contentType: capture.response?.mimeType,
        headers: normalizeHeaders(capture.response?.headers),
        body: JSON.stringify(metadata),
        fetchStatus: "captured",
        parseStatus: "pending",
        sourceUrl: storedRequestUrl,
        sourceTimestamp: capturedAt,
        importBatchId: `x_bookmark_sync_${requestHash.slice(0, 24)}`,
        importStatus: "imported",
      })
      rawPagesStored += 1

      for (const signal of capture.signals ?? []) {
        const pageUrl = signal.pageUrl ?? storedRequestUrl
        store.insertInteractionSignal(
          buildInteractionSignalInput(signal, pageUrl, signal.sourceUrl ?? storedRequestUrl),
        )
        signalsReceived += 1
      }

      for (const url of extractStatusUrlsFromCapture(capture)) {
        statusUrls.set(url, {
          id: statusIdFromUrl(url) ?? stableId([url]).slice(0, 16),
          username: statusUsernameFromUrl(url),
          url,
          source: X_BOOKMARK_SYNC_SOURCE_LANE,
          capturedAt,
          requestUrl: storedRequestUrl,
          provenance: ingestProvenance(snapshot, capture),
        })
      }

      const extractedTweetLikeRecords = extractTweetLikeRecordsFromCapture(capture)
      tweetLikeRecordsFound += extractedTweetLikeRecords.length
      for (const record of extractedTweetLikeRecords) {
        const tweetId = tweetLikeId(record)
        const username = normalizeUsername(record.screen_name)
        const text = record.full_text.trim()
        if (!tweetId || !username || text.length === 0) {
          continue
        }

        const url = normalizeStatusUrl(record.url) ?? `https://x.com/${username}/status/${tweetId}`
        const key = `${username.toLowerCase()}:${tweetId}`
        if (!tweetRecords.has(key)) {
          tweetRecords.set(key, { record, capture, url, capturedAt })
        }
        statusUrls.set(url, {
          id: tweetId,
          username,
          text,
          url,
          source: X_BOOKMARK_SYNC_SOURCE_LANE,
          capturedAt,
          requestUrl: storedRequestUrl,
          provenance: ingestProvenance(snapshot, capture, record),
        })
      }
    }

    for (const { record, capture, url, capturedAt } of tweetRecords.values()) {
      const tweetId = tweetLikeId(record)
      const username = normalizeUsername(record.screen_name)
      const text = record.full_text.trim()
      if (!tweetId || !username || text.length === 0) {
        continue
      }
      const authorId = xBookmarkSyncAuthorId(username)
      usersToUpsert.set(authorId, {
        id: authorId,
        username,
        profileUrl: `https://x.com/${username}`,
        capturedAt,
      })
      store.upsertTweets(
        [
          {
            id: tweetId,
            authorId,
            username,
            url,
            text,
            createdAt: normalizeTwitterCreatedAt(record.created_at),
            mediaIds: [],
            capturedAt,
            source: "tool",
          },
        ],
        {
          sourceLane: X_BOOKMARK_SYNC_SOURCE_LANE,
          sourceUrl: capture.request.url,
          provenance: ingestProvenance(snapshot, capture, record),
        },
      )
    }
    if (usersToUpsert.size > 0) {
      store.upsertUsers([...usersToUpsert.values()], {
        sourceLane: X_BOOKMARK_SYNC_SOURCE_LANE,
        provenance: { source: X_BOOKMARK_SYNC_SOURCE_LANE },
      })
    }

    let archiveJobsEnqueued = 0
    for (const [url, entry] of statusUrls) {
      store.enqueueArchiveJob({
        sourceLane: X_BOOKMARK_SYNC_SOURCE_LANE,
        targetType: "status",
        targetValue: url,
        priority: 5,
        provenance: entry.provenance,
      })
      archiveJobsEnqueued += 1
    }

    const markdownFilesWritten = await writeXBookmarkSyncMarkdown([...statusUrls.values()], this.markdownBookmarksDir())

    return {
      capturesReceived: rawPagesStored,
      tweetLikeRecords: tweetLikeRecordsFound,
      archiveJobsEnqueued,
      markdownFilesWritten,
      signalsReceived,
    }
  }

  private markdownBookmarksDir(): string {
    return join(this.markdownRoot, "bookmarks")
  }

  async getRecentEvents(limit: number): Promise<DevUiLogEventView[]> {
    let contents: string
    try {
      contents = await readFile(this.logPath, "utf8")
    } catch (error) {
      if (isErrno(error as Error | string | object | null | undefined, "ENOENT")) {
        return []
      }
      throw error
    }

    const lines = contents.split(/\r?\n/)
    const numberedLines = lines
      .map((line, index) => ({ line, lineNumber: index + 1 }))
      .filter((entry) => entry.line.length > 0)
    return numberedLines.slice(-limit).map((entry) => parseLogLine(entry.line, entry.lineNumber)).reverse()
  }

  saveTweetNote(input: TweetNoteInput): DevUiTweetAnnotationView {
    const now = new Date().toISOString()
    const note = input.note.trim()
    if (note.length === 0) {
      this.db.prepare("DELETE FROM tweet_notes WHERE tweet_id = ?").run(input.tweetId)
      return this.getTweetAnnotation(input.tweetId)
    }

    this.db
      .prepare(
        `INSERT INTO tweet_notes (id, tweet_id, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
      )
      .run(tweetNoteId(input.tweetId), input.tweetId, note, now, now)
    return this.getTweetAnnotation(input.tweetId)
  }

  setTweetAttribute(input: TweetAttributeInput): DevUiTweetAnnotationView {
    const now = new Date().toISOString()
    if (!input.value) {
      this.db.prepare("DELETE FROM tweet_attributes WHERE tweet_id = ? AND key = ?").run(input.tweetId, input.attribute)
      return this.getTweetAnnotation(input.tweetId)
    }

    this.db
      .prepare(
        `INSERT INTO tweet_attributes (tweet_id, key, value, created_at, updated_at)
         VALUES (?, ?, 'true', ?, ?)
         ON CONFLICT(tweet_id, key) DO UPDATE SET value = 'true', updated_at = excluded.updated_at`,
      )
      .run(input.tweetId, input.attribute, now, now)
    return this.getTweetAnnotation(input.tweetId)
  }

  private getMediaForTweets(tweets: readonly ArchiveTweet[]): DevUiMediaView[] {
    const mediaIds = Array.from(new Set(tweets.flatMap((tweet) => tweet.mediaIds)))
    if (mediaIds.length === 0) {
      return []
    }

    const placeholders = mediaIds.map(() => "?").join(", ")
    const rows = this.db
      .prepare(`SELECT data_json FROM media WHERE id IN (${placeholders}) ORDER BY updated_at DESC, id DESC`)
      .all(...mediaIds) as MediaRow[]
    return rows.map((row) => withMediaStatus(JSON.parse(row.data_json) as ArchiveMedia, this.mediaRoot))
  }

  private getRetweetProvenanceForTweets(tweetIds: readonly string[]): ReadonlyMap<string, DevUiRetweetProvenanceView> {
    const ids = Array.from(new Set(tweetIds))
    const map = new Map<string, DevUiRetweetProvenanceView>()
    if (ids.length === 0) {
      return map
    }

    const placeholders = ids.map(() => "?").join(", ")
    const rows = this.db
      .prepare(
        `SELECT tweet_id, retweeted_by_username, retweeted_by_display_name
         FROM tweet_timeline_provenance
         WHERE tweet_id IN (${placeholders})
           AND (retweeted_by_username IS NOT NULL OR retweeted_by_display_name IS NOT NULL)
         ORDER BY observed_at DESC, id DESC`,
      )
      .all(...ids) as RetweetProvenanceRow[]
    for (const row of rows) {
      if (!map.has(row.tweet_id)) {
        map.set(
          row.tweet_id,
          firstNonEmpty(row.retweeted_by_username ?? undefined, row.retweeted_by_display_name ?? undefined)
            ? {
                username: row.retweeted_by_username ?? undefined,
                displayName: row.retweeted_by_display_name ?? undefined,
              }
            : {},
        )
      }
    }
    return map
  }


  private getTweetsByIds(tweetIds: readonly string[]): ArchiveTweet[] {
    const ids = Array.from(new Set(tweetIds))
    if (ids.length === 0) {
      return []
    }

    const placeholders = ids.map(() => "?").join(", ")
    const rows = this.db.prepare(`SELECT data_json FROM tweets WHERE id IN (${placeholders})`).all(...ids) as TweetRow[]
    return rows.map((row) => JSON.parse(row.data_json) as ArchiveTweet)
  }

  private getUsersByIds(userIds: readonly string[]): ReadonlyMap<string, ArchiveUser> {
    const ids = Array.from(new Set(userIds))
    const map = new Map<string, ArchiveUser>()
    if (ids.length === 0) {
      return map
    }

    const placeholders = ids.map(() => "?").join(", ")
    const rows = this.db.prepare(`SELECT data_json FROM users WHERE id IN (${placeholders})`).all(...ids) as UserRow[]
    for (const row of rows) {
      const user = JSON.parse(row.data_json) as ArchiveUser
      map.set(user.id, user)
    }
    return map
  }

  private getMediaStatusCounts(): DevUiSummary["media"] {
    const rows = this.db.prepare("SELECT data_json FROM media").all() as MediaRow[]
    const counts = {
      downloaded: 0,
      queued: 0,
      remoteOnly: 0,
      missingRemote: 0,
    }

    for (const row of rows) {
      const status = mediaDownloadStatus(JSON.parse(row.data_json) as ArchiveMedia)
      if (status === "downloaded") counts.downloaded += 1
      if (status === "queued") counts.queued += 1
      if (status === "remote-only") counts.remoteOnly += 1
      if (status === "missing-remote") counts.missingRemote += 1
    }

    return counts
  }

  private initAnnotationTables(): void {
    this.db.exec(`
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
    `)
  }

  private getTweetAnnotationsForTweets(tweetIds: readonly string[]): ReadonlyMap<string, DevUiTweetAnnotationView> {
    const map = new Map<string, DevUiTweetAnnotationView>()
    for (const tweetId of tweetIds) {
      map.set(tweetId, emptyTweetAnnotation(tweetId))
    }
    if (tweetIds.length === 0) {
      return map
    }

    const placeholders = tweetIds.map(() => "?").join(", ")
    const noteRows = this.db
      .prepare(`SELECT tweet_id, body AS note, updated_at FROM tweet_notes WHERE tweet_id IN (${placeholders}) ORDER BY updated_at ASC`)
      .all(...tweetIds) as TweetNoteRow[]
    for (const row of noteRows) {
      const current = map.get(row.tweet_id) ?? emptyTweetAnnotation(row.tweet_id)
      map.set(row.tweet_id, { ...current, note: row.note, updatedAt: maxIso(current.updatedAt ?? "", row.updated_at) })
    }

    const attributeRows = this.db
      .prepare(`SELECT tweet_id, key AS attribute, CASE WHEN value = 'true' THEN 1 ELSE 0 END AS value, updated_at FROM tweet_attributes WHERE tweet_id IN (${placeholders})`)
      .all(...tweetIds) as TweetAttributeRow[]
    for (const row of attributeRows) {
      const current = map.get(row.tweet_id) ?? emptyTweetAnnotation(row.tweet_id)
      map.set(row.tweet_id, {
        ...current,
        bookmarked: row.attribute === "bookmark" ? row.value !== 0 : current.bookmarked,
        attributed: row.attribute === "attribute" ? row.value !== 0 : current.attributed,
        updatedAt: maxIso(current.updatedAt ?? "", row.updated_at),
      })
    }

    return map
  }

  private getTweetAnnotation(tweetId: string): DevUiTweetAnnotationView {
    return this.getTweetAnnotationsForTweets([tweetId]).get(tweetId) ?? emptyTweetAnnotation(tweetId)
  }

  private countSocialGraphFollowingEdges(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM social_graph_edges WHERE relation = 'following'").get() as CountRow | undefined
    return row?.count ?? 0
  }

  private socialGraphNodeSummaries(direction: "source" | "target", limit: number): DevUiSocialGraphNodeSummary[] {
    const edgeColumn = direction === "source" ? "source_account_key" : "target_account_key"
    const rows = this.db
      .prepare(
        `SELECT n.account_key, n.username, n.display_name, COUNT(e.id) AS edge_count
         FROM social_graph_nodes n
         JOIN social_graph_edges e ON e.${edgeColumn} = n.account_key
         GROUP BY n.account_key, n.username, n.display_name
         ORDER BY edge_count DESC, n.username ASC
         LIMIT ?`,
      )
      .all(limit) as Array<{ account_key: string; username: string; display_name: string | null; edge_count: number }>
    return rows.map((row) => ({
      accountKey: row.account_key,
      username: row.username,
      displayName: row.display_name ?? undefined,
      edgeCount: row.edge_count,
    }))
  }

  private recentSocialGraphEdges(limit: number): DevUiSocialGraphEdgeView[] {
    const rows = this.db
      .prepare(
        `SELECT e.id,
                e.source_account_key,
                source.username AS source_username,
                e.target_account_key,
                target.username AS target_username,
                e.relation,
                e.source_lane,
                e.observed_at,
                e.import_batch_id,
                e.import_status
         FROM social_graph_edges e
         LEFT JOIN social_graph_nodes source ON source.account_key = e.source_account_key
         LEFT JOIN social_graph_nodes target ON target.account_key = e.target_account_key
         ORDER BY e.observed_at DESC, e.id DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string
      source_account_key: string
      source_username: string | null
      target_account_key: string
      target_username: string | null
      relation: "following"
      source_lane: string
      observed_at: string
      import_batch_id: string | null
      import_status: string
    }>
    return rows.map((row) => ({
      id: row.id,
      sourceAccountKey: row.source_account_key,
      sourceUsername: row.source_username ?? undefined,
      targetAccountKey: row.target_account_key,
      targetUsername: row.target_username ?? undefined,
      relation: row.relation,
      sourceLane: row.source_lane,
      observedAt: row.observed_at,
      importBatchId: row.import_batch_id ?? undefined,
      importStatus: row.import_status,
    }))
  }

  private count(table: "raw_pages" | "capture_jobs" | "archive_jobs" | "users" | "tweets" | "media" | "social_graph_nodes" | "social_graph_edges" | "social_graph_import_batches"): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as CountRow | undefined
    return row?.count ?? 0
  }

  private countJobsByStatus(status: CaptureJobRow["status"]): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM capture_jobs WHERE status = ?").get(status) as CountRow | undefined
    return row?.count ?? 0
  }

  private latest(table: "tweets" | "capture_jobs", expression: string): string | undefined {
    const row = this.db.prepare(`SELECT MAX(${expression}) AS latest FROM ${table}`).get() as LatestRow | undefined
    return row?.latest ?? undefined
  }
}

function buildDevUiConfigEnv(env: TwitterArchiveConfigEnv = process.env): TwitterArchiveConfigEnv {
  const dbPath = firstNonEmpty(env.TWITTER_ARCHIVE_DB, env.NITTER_SQLITE_PATH) ?? DEFAULT_DEV_UI_DB_PATH
  return {
    ...env,
    TWITTER_ARCHIVE_DB: dbPath,
    TWITTER_ARCHIVE_LOG:
      firstNonEmpty(env.TWITTER_ARCHIVE_LOG, env.TWITTER_ARCHIVE_LOG_PATH) ?? DEFAULT_DEV_UI_LOG_PATH,
    TWITTER_ARCHIVE_PORT: firstNonEmpty(env.TWITTER_ARCHIVE_PORT, env.PORT) ?? String(DEFAULT_DEV_UI_PORT),
    TWITTER_ARCHIVE_MARKDOWN_ROOT: env.TWITTER_ARCHIVE_MARKDOWN_ROOT ?? join(dirname(dbPath), "markdown"),
  }
}

async function buildDevUiClient(entrypoint: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    target: "browser",
    format: "esm",
    minify: false,
    sourcemap: "none",
  })

  if (!result.success) {
    const message = result.logs.map((log) => log.message).join("\n") || "Bun.build failed"
    throw new Error(message)
  }

  const output = result.outputs[0]
  if (!output) {
    throw new Error("Bun.build produced no browser client output")
  }

  return await output.text()
}

async function handleFrontendEvent(request: Request, logger: TwitterArchiveJsonlLoggerService): Promise<Response> {
  const payload = await request.json()
  const decoded = Schema.decodeUnknownSync(FrontendEventInputSchema)(payload)
  const event = await Effect.runPromise(
    logger.log({
      component: "frontend",
      level: decoded.level ?? "info",
      event: decoded.event,
      details: frontendDetails(decoded),
    }),
  )
  return jsonResponse(event, 202)
}

async function handleTweetNote(request: Request, dataSource: DevUiDataSource): Promise<Response> {
  const payload = await request.json()
  const decoded = Schema.decodeUnknownSync(TweetNoteInputSchema)(payload)
  return jsonResponse(dataSource.saveTweetNote(decoded), 202)
}

async function handleTweetAttribute(request: Request, dataSource: DevUiDataSource): Promise<Response> {
  const payload = await request.json()
  const decoded = Schema.decodeUnknownSync(TweetAttributeInputSchema)(payload)
  return jsonResponse(dataSource.setTweetAttribute(decoded), 202)
}

async function handleArchiveJob(request: Request, dataSource: DevUiDataSource): Promise<Response> {
  const payload = await request.json()
  const decoded = Schema.decodeUnknownSync(ArchiveJobInputSchema)(payload)
  return jsonResponse(dataSource.enqueueArchiveJob(decoded), 202)
}

async function handleXBookmarkSyncIngest(request: Request, dataSource: DevUiDataSource): Promise<Response> {
  let payload: JsonSafeValue
  try {
    payload = (await request.json()) as JsonSafeValue
  } catch (error) {
    return jsonResponse({ error: errorToMessage(error as Error | string | null | undefined) }, 400)
  }
  let decoded: XBookmarkSyncSnapshotInput
  try {
    decoded = decodeXBookmarkSyncSnapshot(payload)
  } catch (error) {
    return jsonResponse({ error: errorToMessage(error as Error | string | null | undefined) }, 400)
  }
  return jsonResponse(await dataSource.ingestXBookmarkSyncSnapshot(decoded), 202)
}

function isHealthPath(pathname: string): boolean {
  return pathname === "/health" || pathname === "/api/health"
}

function isXBookmarkSyncIngestPath(pathname: string): boolean {
  return pathname === "/x-bookmark-sync/ingest" || pathname === "/api/x-bookmark-sync/ingest"
}

function isLocalApiPreflightPath(pathname: string): boolean {
  return isHealthPath(pathname) || isXBookmarkSyncIngestPath(pathname)
}

function streamState(dataSource: DevUiDataSource, limit: number): Response {
  const encoder = new TextEncoder()
  let interval: Timer | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = async () => {
        try {
          const state = await dataSource.getState(limit)
          controller.enqueue(encoder.encode(`event: state\ndata: ${JSON.stringify(state)}\n\n`))
        } catch (error) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: errorToMessage(error as Error | string | null | undefined) })}\n\n`))
        }
      }
      void send()
      interval = setInterval(() => void send(), 2_000)
    },
    cancel() {
      if (interval) {
        clearInterval(interval)
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  })
}

function decodeXBookmarkSyncSnapshot(value: JsonSafeValue): XBookmarkSyncSnapshotInput {
  if (!isRecord(value)) {
    throw new Error("x-bookmark-sync ingest payload must be an object")
  }
  if (!isRecord(value.source)) {
    throw new Error("x-bookmark-sync ingest payload must include source metadata")
  }
  if (!Array.isArray(value.captures)) {
    throw new Error("x-bookmark-sync ingest payload must include captures")
  }

  return {
    source: sanitizeJsonRecord(value.source),
    generatedAt: stringField(value, "generatedAt"),
    incremental: booleanField(value, "incremental"),
    captures: value.captures.map(decodeXBookmarkSyncCapture),
    signals: decodeXBookmarkSyncSignals(value.signals),
  }
}

function decodeXBookmarkSyncCapture(value: JsonSafeValue): XBookmarkSyncCaptureInput {
  if (!isRecord(value)) {
    throw new Error("x-bookmark-sync capture must be an object")
  }
  const request = isRecord(value.request) ? value.request : undefined
  const requestUrl = firstNonEmpty(request ? stringField(request, "url") : undefined, stringField(value, "pageUrl"))
  if (!requestUrl) {
    throw new Error("x-bookmark-sync capture must include request.url or pageUrl")
  }

  const visibleTweetRecords = decodeVisibleTweetRecords(value.visibleTweets)
  const explicitTweetLikeRecords = Array.isArray(value.tweetLike)
    ? value.tweetLike.map(tweetLikeRecordFromJson).filter((record): record is XBookmarkSyncTweetLikeRecord => record !== undefined)
    : []

  return {
    id: stringField(value, "id"),
    capturedAt: stringField(value, "capturedAt"),
    inspectedTabId: numberField(value, "inspectedTabId"),
    request: {
      method: request ? stringField(request, "method") : "GET",
      url: requestUrl,
      headers: request?.headers,
    },
    response: isRecord(value.response)
      ? {
          status: numberField(value.response, "status"),
          statusText: stringField(value.response, "statusText"),
          mimeType: stringField(value.response, "mimeType"),
          bodySize: numberField(value.response, "bodySize"),
          encoding: stringField(value.response, "encoding"),
          headers: value.response.headers,
        }
      : undefined,
    timing: isRecord(value.timing) ? sanitizeJsonRecord(value.timing) : undefined,
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === "string")
      : visibleTweetRecords.length > 0
        ? ["visible-tweets"]
        : [],
    tweetLike: mergeTweetLikeRecords(explicitTweetLikeRecords, visibleTweetRecords),
    json: value.json ?? lightweightCaptureJson(requestUrl, value.visibleTweets),
    body: stringField(value, "body"),
    parseError: stringField(value, "parseError"),
    signals: decodeXBookmarkSyncSignals(value.signals),
  }
}

function decodeVisibleTweetRecords(value: JsonSafeValue | undefined): XBookmarkSyncTweetLikeRecord[] {
  if (!Array.isArray(value)) {
    return []
  }
  const records: XBookmarkSyncTweetLikeRecord[] = []
  for (const [index, tweet] of value.entries()) {
    const record = visibleTweetLikeRecordFromJson(sanitizeJsonValue(tweet), `visibleTweets[${index}]`)
    if (record) {
      records.push(record)
    }
  }
  return records
}

function decodeXBookmarkSyncSignals(value: JsonSafeValue | undefined): XBookmarkSyncSignalInput[] {
  if (!Array.isArray(value)) {
    return []
  }
  const signals: XBookmarkSyncSignalInput[] = []
  for (const item of value) {
    const signal = decodeXBookmarkSyncSignal(sanitizeJsonValue(item))
    if (signal) {
      signals.push(signal)
    }
  }
  return signals
}

function decodeXBookmarkSyncSignal(value: JsonSafeValue): XBookmarkSyncSignalInput | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const kind = stringField(value, "kind")
  const observedAt = stringField(value, "observedAt")
  if (!kind || !observedAt) {
    return undefined
  }
  return {
    signalId: stringField(value, "signalId") ?? stringField(value, "eventId"),
    kind,
    observedAt,
    durationMs: numberField(value, "durationMs"),
    pageUrl: stringField(value, "pageUrl"),
    sourceUrl: stringField(value, "sourceUrl"),
    tabId: numberField(value, "tabId"),
    sessionId: stringField(value, "sessionId"),
    tweetId: stringField(value, "tweetId"),
    profileHandle: stringField(value, "profileHandle"),
    listId: stringField(value, "listId"),
    searchQuery: stringField(value, "searchQuery"),
    confidence: numberField(value, "confidence"),
    details: isRecord(value.details) ? sanitizeJsonRecord(value.details) : undefined,
  }
}

function buildInteractionSignalInput(
  signal: XBookmarkSyncSignalInput,
  pageUrl: string,
  sourceUrl?: string,
): SqliteInteractionSignalInput {
  return {
    id: signal.signalId,
    kind: signal.kind,
    observedAt: signal.observedAt,
    durationMs: signal.durationMs,
    pageUrl,
    sourceUrl: sourceUrl ?? signal.sourceUrl,
    tabId: signal.tabId !== undefined ? String(signal.tabId) : undefined,
    sessionId: signal.sessionId,
    tweetId: signal.tweetId,
    profileHandle: signal.profileHandle,
    listId: signal.listId,
    searchQuery: signal.searchQuery,
    confidence: signal.confidence,
    details: signal.details,
  }
}

function visibleTweetLikeRecordFromJson(value: JsonSafeValue, path: string): XBookmarkSyncTweetLikeRecord | undefined {
  const record = tweetLikeRecordFromJson(value)
  if (!isRecord(value)) {
    return record ? { ...record, path: record.path ?? path } : undefined
  }
  const url = firstNonEmpty(
    record?.url,
    stringField(value, "url"),
    stringField(value, "statusUrl"),
    stringField(recordField(value, "permalink"), "url"),
  )
  const fullText = firstNonEmpty(record?.full_text, stringField(value, "fullText"))
  if (!fullText) {
    return undefined
  }
  const statusId = url ? statusIdFromUrl(url) : undefined
  const statusUsername = url ? statusUsernameFromUrl(url) : undefined
  return {
    rest_id: firstNonEmpty(record?.rest_id, scalarStringField(value, "tweetId"), statusId),
    id_str: firstNonEmpty(record?.id_str, scalarStringField(value, "tweetId"), statusId),
    full_text: fullText,
    created_at: firstNonEmpty(record?.created_at, stringField(value, "createdAt")),
    screen_name: firstNonEmpty(
      record?.screen_name,
      stringField(value, "username"),
      stringField(value, "handle"),
      stringField(recordField(value, "author"), "username"),
      stringField(recordField(value, "author"), "screen_name"),
      stringField(recordField(value, "user"), "username"),
      stringField(recordField(value, "user"), "screen_name"),
      statusUsername,
    ),
    path: record?.path ?? path,
    url,
  }
}

function mergeTweetLikeRecords(
  ...recordGroups: ReadonlyArray<readonly XBookmarkSyncTweetLikeRecord[]>
): XBookmarkSyncTweetLikeRecord[] {
  const records = new Map<string, XBookmarkSyncTweetLikeRecord>()
  for (const group of recordGroups) {
    for (const record of group) {
      const key = tweetLikeRecordKey(record)
      if (!records.has(key)) {
        records.set(key, record)
      }
    }
  }
  return [...records.values()]
}

function lightweightCaptureJson(pageUrl: string, visibleTweets: JsonSafeValue | undefined): Record<string, JsonSafeValue> | undefined {
  if (!Array.isArray(visibleTweets)) {
    return undefined
  }
  return {
    pageUrl,
    visibleTweets: visibleTweets.map((tweet) => sanitizeJsonValue(tweet)),
  }
}

function tweetLikeRecordFromJson(value: JsonSafeValue): XBookmarkSyncTweetLikeRecord | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const fullText = firstNonEmpty(
    stringField(value, "full_text"),
    stringField(recordField(value, "legacy"), "full_text"),
    stringField(value, "text"),
  )
  if (!fullText) {
    return undefined
  }
  return {
    rest_id: firstNonEmpty(scalarStringField(value, "rest_id"), scalarStringField(value, "id")),
    id_str: firstNonEmpty(scalarStringField(value, "id_str"), scalarStringField(recordField(value, "legacy"), "id_str")),
    full_text: fullText,
    created_at: firstNonEmpty(stringField(value, "created_at"), stringField(recordField(value, "legacy"), "created_at")),
    screen_name: firstNonEmpty(
      stringField(value, "screen_name"),
      stringField(recordField(recordField(recordField(value, "core"), "user_results"), "result"), "screen_name"),
      stringField(recordField(recordField(recordField(recordField(value, "core"), "user_results"), "result"), "legacy"), "screen_name"),
      stringField(recordField(recordField(value, "user_results"), "result"), "screen_name"),
      stringField(recordField(recordField(recordField(value, "user_results"), "result"), "legacy"), "screen_name"),
      stringField(recordField(value, "user"), "screen_name"),
      stringField(recordField(recordField(value, "user"), "legacy"), "screen_name"),
    ),
    path: stringField(value, "path"),
    url: stringField(value, "url"),
  }
}

function extractTweetLikeRecordsFromCapture(capture: XBookmarkSyncCaptureInput): XBookmarkSyncTweetLikeRecord[] {
  const records: XBookmarkSyncTweetLikeRecord[] = [...capture.tweetLike]
  const seen = new WeakSet<object>()
  const seenKeys = new Set(records.map((record) => tweetLikeRecordKey(record)))

  const visit = (value: JsonSafeValue | undefined, path: string, depth: number): void => {
    if (records.length >= 1_000 || depth > 40 || value == null || typeof value !== "object") {
      return
    }
    if (seen.has(value)) {
      return
    }
    seen.add(value)
    const candidate = tweetLikeRecordFromJson(value)
    if (candidate) {
      const key = tweetLikeRecordKey(candidate)
      if (!seenKeys.has(key) && looksLikeTweetRecord(candidate, path)) {
        seenKeys.add(key)
        records.push({ ...candidate, path: candidate.path ?? path })
      }
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1))
      return
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, path ? `${path}.${key}` : key, depth + 1)
    }
  }

  visit(capture.json, "", 0)
  const parsedBody = parseJsonBody(capture.body)
  if (parsedBody !== undefined) {
    visit(parsedBody, "body", 0)
  }

  return records
}

function extractStatusUrlsFromCapture(capture: XBookmarkSyncCaptureInput): string[] {
  const urls = new Set<string>()
  addNormalizedStatusUrl(urls, capture.request.url)
  for (const record of capture.tweetLike) {
    addNormalizedStatusUrl(urls, record.url)
  }
  collectStatusUrlsFromJson(capture.json, urls)
  collectStatusUrlsFromText(capture.body, urls)
  return [...urls]
}

function collectStatusUrlsFromJson(value: JsonSafeValue | undefined, urls: Set<string>, depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 30 || value === null || value === undefined) {
    return
  }
  if (typeof value === "string") {
    collectStatusUrlsFromText(value, urls)
    return
  }
  if (typeof value !== "object") {
    return
  }
  if (seen.has(value)) {
    return
  }
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStatusUrlsFromJson(item, urls, depth + 1, seen)
    }
    return
  }
  for (const item of Object.values(value)) {
    collectStatusUrlsFromJson(item, urls, depth + 1, seen)
  }
}

function collectStatusUrlsFromText(text: string | undefined, urls: Set<string>): void {
  if (!text) {
    return
  }
  const statusUrlPattern = /https?:\/\/(?:mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_./-]*\/status(?:es)?\/\d+/gi
  for (const match of text.matchAll(statusUrlPattern)) {
    addNormalizedStatusUrl(urls, match[0])
  }
}

function addNormalizedStatusUrl(urls: Set<string>, value: string | undefined): void {
  const normalized = normalizeStatusUrl(value)
  if (normalized) {
    urls.add(normalized)
  }
}

function normalizeStatusUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  try {
    const url = new URL(value)
    const host = url.hostname.replace(/^mobile\./, "").toLowerCase()
    if (host !== "x.com" && host !== "twitter.com") {
      return undefined
    }
    const segments = url.pathname.split("/").filter(Boolean)
    const statusIndex = segments.findIndex((segment) => segment === "status" || segment === "statuses")
    if (statusIndex < 0 || statusIndex + 1 >= segments.length) {
      return undefined
    }
    const id = segments[statusIndex + 1]
    if (!/^\d+$/.test(id)) {
      return undefined
    }
    const username = statusIndex > 0 ? normalizeUsername(segments[statusIndex - 1]) : undefined
    if (username && username.toLowerCase() !== "web" && username.toLowerCase() !== "i") {
      return `https://x.com/${username}/status/${id}`
    }
    return `https://x.com/i/web/status/${id}`
  } catch {
    return undefined
  }
}

function statusIdFromUrl(url: string): string | undefined {
  const match = url.match(/\/status(?:es)?\/(\d+)$/)
  return match?.[1]
}

function statusUsernameFromUrl(url: string): string | undefined {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean)
    const statusIndex = segments.findIndex((segment) => segment === "status" || segment === "statuses")
    const username = statusIndex > 0 ? normalizeUsername(segments[statusIndex - 1]) : undefined
    return username && username.toLowerCase() !== "web" && username.toLowerCase() !== "i" ? username : undefined
  } catch {
    return undefined
  }
}

function tweetLikeId(record: XBookmarkSyncTweetLikeRecord): string | undefined {
  const id = firstNonEmpty(record.rest_id, record.id_str)
  return id && /^\d+$/.test(id) ? id : undefined
}

function tweetLikeRecordKey(record: XBookmarkSyncTweetLikeRecord): string {
  return firstNonEmpty(tweetLikeId(record), record.path, record.full_text) ?? stableId([record.full_text])
}

function looksLikeTweetRecord(record: XBookmarkSyncTweetLikeRecord, path: string): boolean {
  return Boolean(tweetLikeId(record) || path.toLowerCase().includes("tweet"))
}

function normalizeUsername(value: string | undefined): string | undefined {
  const username = value?.trim().replace(/^@+/, "")
  return username && /^[A-Za-z0-9_]{1,20}$/.test(username) ? username : undefined
}

function xBookmarkSyncAuthorId(username: string): string {
  return `x-user:${username.toLowerCase()}`
}

function normalizeTwitterCreatedAt(value: string | undefined): string | undefined {
  return normalizeIsoDate(value)
}

function normalizeIsoDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    return undefined
  }
  return new Date(parsed).toISOString()
}

function sanitizedCaptureMetadata(
  capture: XBookmarkSyncCaptureInput,
  source: Record<string, JsonSafeValue>,
  incremental: boolean | undefined,
): Record<string, JsonSafeValue> {
  return pruneJsonRecord({
    source,
    incremental,
    id: capture.id,
    capturedAt: capture.capturedAt,
    inspectedTabId: capture.inspectedTabId,
    request: pruneJsonRecord({
      method: capture.request.method,
      url: redactSensitiveUrl(capture.request.url),
      headers: normalizeHeaders(capture.request.headers),
    }),
    response: capture.response
      ? pruneJsonRecord({
          status: capture.response.status,
          statusText: capture.response.statusText,
          mimeType: capture.response.mimeType,
          bodySize: capture.response.bodySize,
          encoding: capture.response.encoding,
          headers: normalizeHeaders(capture.response.headers),
        })
      : undefined,
    timing: capture.timing,
    tags: capture.tags,
    tweetLikeCount: capture.tweetLike.length,
    parseError: capture.parseError,
  })
}

function ingestProvenance(
  snapshot: XBookmarkSyncSnapshotInput,
  capture: XBookmarkSyncCaptureInput,
  record?: XBookmarkSyncTweetLikeRecord,
): Record<string, JsonSafeValue> {
  return pruneJsonRecord({
    source: snapshot.source,
    sourceLane: X_BOOKMARK_SYNC_SOURCE_LANE,
    incremental: snapshot.incremental,
    generatedAt: snapshot.generatedAt,
    captureId: capture.id,
    capturedAt: capture.capturedAt,
    requestUrl: redactSensitiveUrl(capture.request.url),
    tweetPath: record?.path,
  })
}

function redactSensitiveUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.username) {
      url.username = "[REDACTED]"
    }
    if (url.password) {
      url.password = "[REDACTED]"
    }
    for (const [key, parameterValue] of url.searchParams) {
      if (isSensitiveKey(key) || isSensitiveHeaderValue(parameterValue)) {
        url.searchParams.set(key, "[REDACTED]")
      }
    }
    return url.toString()
  } catch {
    return isSensitiveHeaderValue(value) ? "[REDACTED]" : value
  }
}

function normalizeHeaders(value: JsonSafeValue | undefined): Record<string, string> {
  const headers: Record<string, string> = {}
  const assign = (name: JsonSafeValue | undefined, headerValue: JsonSafeValue | undefined): void => {
    if (typeof name !== "string" || name.trim().length === 0 || headerValue === undefined || headerValue === null) {
      return
    }
    const key = name.trim()
    const stringValue = typeof headerValue === "string" ? headerValue : String(headerValue)
    headers[key] = isSensitiveKey(key) || isSensitiveHeaderValue(stringValue) ? "[REDACTED]" : stringValue
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (Array.isArray(item)) {
        assign(item[0], item[1])
      } else if (isRecord(item)) {
        assign(item.name ?? item.key, item.value)
      }
    }
    return headers
  }

  if (isRecord(value)) {
    for (const [key, headerValue] of Object.entries(value)) {
      assign(key, headerValue)
    }
  }

  return headers
}

function sanitizeJsonRecord(value: Record<string, JsonSafeValue | undefined>): Record<string, JsonSafeValue> {
  return pruneJsonRecord(value)
}

function sanitizeJsonValue(value: JsonSafeValue | undefined, depth = 0): JsonSafeValue {
  if (depth > 10) {
    return "[MaxDepth]"
  }
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return typeof value === "string" && isSensitiveHeaderValue(value) ? "[REDACTED]" : value
  }
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : sanitizeJsonValue(item, depth + 1)))
  }
  if (isRecord(value)) {
    const record: Record<string, JsonSafeValue> = {}
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) {
        record[key] = isSensitiveKey(key) ? "[REDACTED]" : sanitizeJsonValue(item, depth + 1)
      }
    }
    return record
  }
  return String(value)
}

function pruneJsonRecord(value: JsonSafeValue | Record<string, JsonSafeValue | undefined>): Record<string, JsonSafeValue> {
  const record: Record<string, JsonSafeValue> = {}
  if (!isRecord(value)) {
    return record
  }
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      record[key] = sanitizeJsonValue(item)
    }
  }
  return record
}

function isSensitiveKey(key: string): boolean {
  return /authorization|cookie|token|secret|session|csrf|auth/i.test(key)
}

function isSensitiveHeaderValue(value: string): boolean {
  return /bearer\s+[a-z0-9._~+/=-]+|auth_token=|ct0=|guest_id=|personalization_id=/i.test(value)
}

function parseJsonBody(body: string | undefined): JsonSafeValue | undefined {
  if (!body || body.length > 2_000_000) {
    return undefined
  }
  try {
    return JSON.parse(body) as JsonSafeValue
  } catch {
    return undefined
  }
}

async function writeXBookmarkSyncMarkdown(entries: readonly XBookmarkSyncMarkdownEntry[], outputDir: string): Promise<number> {
  await mkdir(outputDir, { recursive: true })
  const sortedEntries = [...entries].sort((left, right) => left.url.localeCompare(right.url))
  let filesWritten = 0
  const indexLines = [
    "# X bookmark sync captures",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Captures",
    "",
  ]

  for (const entry of sortedEntries) {
    const fileName = `${markdownStatusSlug(entry)}.md`
    await writeFile(join(outputDir, fileName), xBookmarkSyncTweetMarkdown(entry), "utf8")
    filesWritten += 1
    indexLines.push(`- [${markdownStatusTitle(entry)}](${fileName}) — ${entry.capturedAt} — ${entry.url}`)
  }

  if (sortedEntries.length === 0) {
    indexLines.push("- No tweet/status captures in the latest ingest.")
  }

  await writeFile(join(outputDir, "index.md"), `${indexLines.join("\n")}\n`, "utf8")
  return filesWritten + 1
}

function xBookmarkSyncTweetMarkdown(entry: XBookmarkSyncMarkdownEntry): string {
  const lines = [
    `# ${markdownStatusTitle(entry)}`,
    "",
    `- URL: ${entry.url}`,
    `- Source: ${entry.source}`,
    `- Captured at: ${entry.capturedAt}`,
  ]
  if (entry.requestUrl) {
    lines.push(`- Request URL: ${entry.requestUrl}`)
  }
  lines.push(`- Provenance: ${JSON.stringify(entry.provenance)}`)
  if (entry.text) {
    lines.push("", entry.text)
  }
  return `${lines.join("\n")}\n`
}

function markdownStatusSlug(entry: XBookmarkSyncMarkdownEntry): string {
  const username = entry.username ? `${entry.username}-` : "status-"
  return `${username}${entry.id}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")
}

function markdownStatusTitle(entry: XBookmarkSyncMarkdownEntry): string {
  return entry.username ? `@${entry.username} status ${entry.id}` : `X status ${entry.id}`
}

function recordField(record: Record<string, JsonSafeValue | undefined> | undefined, key: string): Record<string, JsonSafeValue | undefined> | undefined {
  const value = record?.[key]
  return isRecord(value) ? value : undefined
}

function scalarStringField(record: Record<string, JsonSafeValue | undefined> | undefined, key: string): string | undefined {
  const value = record?.[key]
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value)
  }
  return undefined
}

function numberField(record: Record<string, JsonSafeValue | undefined>, key: string): number | undefined {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function groupTweets(
  tweets: readonly ArchiveTweet[],
  mediaByTweetId: ReadonlyMap<string, readonly DevUiMediaView[]>,
  annotationsByTweetId: ReadonlyMap<string, DevUiTweetAnnotationView>,
  quotedTweetsById: ReadonlyMap<string, DevUiQuotedTweetView>,
  retweetsByTweetId: ReadonlyMap<string, DevUiRetweetProvenanceView>,
): DevUiTweetGroupView[] {
  const groups = new Map<string, ArchiveTweet[]>()
  const tweetsById = new Map(tweets.map((tweet) => [tweet.id, tweet]))

  for (const tweet of tweets) {
    const groupId = tweetThreadGroupId(tweet, tweets, tweetsById)
    const group = groups.get(groupId)
    if (group) {
      group.push(tweet)
    } else {
      groups.set(groupId, [tweet])
    }
  }

  return Array.from(groups.entries())
    .map(([groupId, groupTweetsForId]) => {
      const orderedTweets = [...groupTweetsForId].sort(compareTweetAscending)
      const views = orderedTweets.map((tweet) => ({
        ...tweet,
        media: mediaByTweetId.get(tweet.id) ?? [],
        replyDepth: tweet.inReplyToTweetId ? 1 : 0,
        annotation: annotationsByTweetId.get(tweet.id) ?? emptyTweetAnnotation(tweet.id),
        quotedTweet: tweet.quotedTweetId ? quotedTweetsById.get(tweet.quotedTweetId) : undefined,
        retweetedBy: retweetsByTweetId.get(tweet.id),
      }))
      const latestAt = orderedTweets.reduce((latest, tweet) => (tweetSortMs(tweet) > tweetSortMs(latest) ? tweet : latest), orderedTweets[0])
      const kind = tweetGroupKind(orderedTweets)
      return {
        groupId,
        kind,
        title: tweetGroupTitle(kind, views[0]),
        tweets: views,
        latestAt: latestAt?.createdAt ?? latestAt?.capturedAt ?? "",
      } satisfies DevUiTweetGroupView
    })
    .sort((left, right) => compareDisplayTimeDescending(left.latestAt, right.latestAt))
}

function buildQuotedTweetView(
  tweet: ArchiveTweet,
  mediaByTweetId: ReadonlyMap<string, readonly DevUiMediaView[]>,
  authorsById: ReadonlyMap<string, ArchiveUser>,
): DevUiQuotedTweetView {
  return {
    ...tweet,
    displayName: authorsById.get(tweet.authorId)?.displayName,
    media: mediaByTweetId.get(tweet.id) ?? [],
  }
}

function groupMediaByTweetId(media: readonly DevUiMediaView[]): ReadonlyMap<string, readonly DevUiMediaView[]> {
  const map = new Map<string, DevUiMediaView[]>()
  for (const item of media) {
    const items = map.get(item.tweetId)
    if (items) {
      items.push(item)
    } else {
      map.set(item.tweetId, [item])
    }
  }
  return map
}

function tweetNoteId(tweetId: string): string {
  return `local-note:${tweetId}`
}

function emptyTweetAnnotation(tweetId: string): DevUiTweetAnnotationView {
  return {
    tweetId,
    bookmarked: false,
    attributed: false,
  }
}

function withMediaStatus(media: ArchiveMedia, mediaRoot?: string): DevUiMediaView {
  return {
    ...media,
    downloadStatus: mediaDownloadStatus(media),
    previewUrl: mediaRoot ? localMediaPreviewUrl(media, mediaRoot) : undefined,
  }
}

function mediaDownloadStatus(media: ArchiveMedia): DevUiMediaDownloadStatus {
  if (media.localPath) {
    return "downloaded"
  }
  if (media.remoteUrl || media.variants?.some((variant) => variant.url)) {
    return media.source ? "queued" : "remote-only"
  }
  return "missing-remote"
}

function compareTweetAscending(left: ArchiveTweet, right: ArchiveTweet): number {
  return tweetSortMs(left) - tweetSortMs(right)
}

function compareTweetDescending(left: ArchiveTweet, right: ArchiveTweet): number {
  return tweetSortMs(right) - tweetSortMs(left)
}

function compareDisplayTimeDescending(left: string, right: string): number {
  return displayTimeMs(right) - displayTimeMs(left)
}

function tweetSortMs(tweet: ArchiveTweet): number {
  return displayTimeMs(tweet.createdAt ?? tweet.capturedAt)
}

function displayTimeMs(value: string | undefined): number {
  if (!value) {
    return 0
  }
  const parsed = Date.parse(value.replace(" · ", " "))
  if (Number.isFinite(parsed)) {
    return parsed
  }
  return Date.parse(value) || 0
}

function tweetThreadGroupId(tweet: ArchiveTweet, tweets: readonly ArchiveTweet[], tweetsById: ReadonlyMap<string, ArchiveTweet>): string {
  if (tweet.inReplyToTweetId) {
    const parent = tweetsById.get(tweet.inReplyToTweetId)
    if (parent && parent.authorId === tweet.authorId) {
      return parent.conversationId ?? tweet.conversationId ?? parent.id
    }
    if (!parent && isSelfReply(tweet)) {
      return tweet.conversationId ?? tweet.inReplyToTweetId
    }
    return tweet.id
  }

  if (
    tweet.conversationId &&
    tweets.some(
      (candidate) =>
        candidate.id !== tweet.id &&
        candidate.conversationId === tweet.conversationId &&
        candidate.authorId === tweet.authorId &&
        (candidate.inReplyToTweetId || isSelfReply(candidate)),
    )
  ) {
    return tweet.conversationId
  }
  return tweet.id
}

function isSelfReply(tweet: ArchiveTweet): boolean {
  if (tweet.inReplyToUserId && tweet.inReplyToUserId === tweet.authorId) {
    return true
  }
  return Boolean(tweet.replyToUsername && tweet.username && tweet.replyToUsername.toLowerCase() === tweet.username.toLowerCase())
}

function hasQuotedTweetContent(tweet: ArchiveTweet): boolean {
  return tweet.text.trim().length > 0
}

function tweetGroupKind(tweets: readonly ArchiveTweet[]): DevUiTweetGroupKind {
  if (tweets.length > 1) {
    return "thread"
  }
  if (tweets.some((tweet) => tweet.inReplyToTweetId || tweet.replyToUsername)) {
    return "reply"
  }
  return "single"
}

function tweetGroupTitle(kind: DevUiTweetGroupKind, tweet: DevUiTweetView | undefined): string {
  const username = tweet?.username ? `@${tweet.username}` : "unknown author"
  if (kind === "reply") return `Reply group from ${username}`
  if (kind === "thread") return `Thread from ${username}`
  return `Tweet from ${username}`
}

function maxIso(left: string, right: string): string {
  if (!left) return right
  return left.localeCompare(right) >= 0 ? left : right
}

function captureJobFromRow(row: CaptureJobRow): SqliteCaptureJob {
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    requestHash: row.request_hash,
    status: row.status,
    stage: row.stage,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    failedAt: row.failed_at ?? undefined,
    retryAfterAt: row.retry_after_at ?? undefined,
    error: row.error ?? undefined,
  }
}

function parseLogLine(raw: string, lineNumber: number): DevUiLogEventView {
  try {
    const parsed = JSON.parse(raw) as JsonSafeValue
    if (!isRecord(parsed)) {
      return { lineNumber, raw, parseError: "JSONL record is not an object" }
    }
    const level = stringField(parsed, "level")
    return {
      lineNumber,
      raw,
      timestamp: stringField(parsed, "timestamp"),
      component: stringField(parsed, "component"),
      level: isJsonlLogLevel(level) ? level : undefined,
      event: stringField(parsed, "event"),
      runId: stringField(parsed, "runId"),
      jobId: stringField(parsed, "jobId"),
      details: isJsonlLogDetails(parsed.details) ? parsed.details : undefined,
    }
  } catch (error) {
    return { lineNumber, raw, parseError: errorToMessage(error as Error | string | null | undefined) }
  }
}

function frontendDetails(input: FrontendEventInput): JsonlLogDetails {
  if (input.details === undefined) {
    return {}
  }
  if (isJsonlLogDetails(input.details)) {
    return input.details
  }
  return { value: toJsonlLogValue(input.details) }
}

function toJsonlLogValue(value: JsonSafeValue | undefined): JsonlLogValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(toJsonlLogValue)
  }
  if (isRecord(value)) {
    const details: Record<string, JsonlLogValue> = {}
    for (const [key, item] of Object.entries(value)) {
      details[key] = toJsonlLogValue(item)
    }
    return details
  }
  return String(value)
}

function isJsonlLogDetails(value: JsonSafeValue | undefined): value is JsonlLogDetails {
  if (!isRecord(value)) {
    return false
  }
  return Object.values(value).every(isJsonlLogValue)
}

function isJsonlLogValue(value: JsonSafeValue | undefined): value is JsonlLogValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true
  }
  if (Array.isArray(value)) {
    return value.every(isJsonlLogValue)
  }
  return isJsonlLogDetails(value)
}

function isJsonlLogLevel(value: string | undefined): value is JsonlLogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error"
}

function stringField(record: Record<string, JsonSafeValue | undefined> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === "string" ? value : undefined
}

function booleanField(record: Record<string, JsonSafeValue | undefined> | undefined, key: string): boolean | undefined {
  const value = record?.[key]
  return typeof value === "boolean" ? value : undefined
}

async function mediaFileResponse(mediaRoot: string, requestedPath: string | null): Promise<Response> {
  if (requestedPath === null || requestedPath.trim().length === 0 || requestedPath.includes("\0")) {
    return jsonResponse({ error: "Missing media file path" }, 400)
  }

  const root = resolve(mediaRoot)
  const candidate = resolve(root, requestedPath)
  if (!isPathInsideRoot(root, candidate)) {
    return jsonResponse({ error: "Media file path is outside media root" }, 403)
  }

  let realRoot: string
  let realCandidate: string
  try {
    const realPaths = await Promise.all([realpath(root), realpath(candidate)])
    realRoot = realPaths[0]
    realCandidate = realPaths[1]
  } catch (error) {
    if (isErrno(error as Error | string | object | null | undefined, "ENOENT")) {
      return jsonResponse({ error: "Media file not found" }, 404)
    }
    throw error
  }

  if (!isPathInsideRoot(realRoot, realCandidate)) {
    return jsonResponse({ error: "Media file path is outside media root" }, 403)
  }

  try {
    const fileStats = await stat(realCandidate)
    if (!fileStats.isFile()) {
      return jsonResponse({ error: "Media file not found" }, 404)
    }
  } catch (error) {
    if (isErrno(error as Error | string | object | null | undefined, "ENOENT")) {
      return jsonResponse({ error: "Media file not found" }, 404)
    }
    throw error
  }

  return new Response(Bun.file(realCandidate), {
    headers: {
      "cache-control": "no-store",
      "content-type": mediaContentType(realCandidate),
    },
  })
}

function localMediaPreviewUrl(media: ArchiveMedia, mediaRoot: string): string | undefined {
  if (!media.localPath || media.localPath.trim().length === 0 || media.localPath.includes("\0")) {
    return undefined
  }

  const root = resolve(mediaRoot)
  const candidate = resolve(root, media.localPath)
  if (!isPathInsideRoot(root, candidate)) {
    return undefined
  }

  return `/media-file?path=${encodeURIComponent(candidate)}`
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

function mediaContentType(path: string): string {
  const extension = extname(path).toLowerCase()
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg"
  if (extension === ".png") return "image/png"
  if (extension === ".gif") return "image/gif"
  if (extension === ".webp") return "image/webp"
  if (extension === ".avif") return "image/avif"
  if (extension === ".mp4") return "video/mp4"
  if (extension === ".webm") return "video/webm"
  if (extension === ".mov") return "video/quicktime"
  return "application/octet-stream"
}

function jsonResponse(value: object | string | number | boolean | null, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: jsonHeaders })
}

function optionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...localApiHeaders,
      "Cache-Control": "no-store",
    },
  })
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  })
}

function readLimit(url: URL, key: string, fallback: number, max: number): number {
  const raw = url.searchParams.get(key)
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(parsed, max)
}

function archiveJobStatusParam(value: string | null): SqliteArchiveJobStatus | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined
  }
  if (value === "pending" || value === "claimed" || value === "completed" || value === "failed" || value === "skipped") {
    return value
  }
  throw new Error(`Unsupported archive job status filter: ${value}`)
}

function archiveJobTargetTypeParam(value: string | null): SqliteArchiveJobTargetType | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined
  }
  if (value === "profile" || value === "status" || value === "search" || value === "wayback" || value === "following") {
    return value
  }
  throw new Error(`Unsupported archive job target type filter: ${value}`)
}

function renderHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Twitter archive dev UI</title>
    <link rel="stylesheet" href="/assets/dev-ui.css?v=${Date.now()}" />
  </head>
  <body>
    <div id="app" class="app-shell"></div>
    <script type="module" src="/assets/dev-ui-client.js?v=${Date.now()}"></script>
  </body>
</html>`
}

function firstNonEmpty(...values: ReadonlyArray<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0)
}

function isRecord(value: JsonSafeValue | object | null | undefined): value is Record<string, JsonSafeValue | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isErrno(error: Error | string | object | null | undefined, code: string): error is NodeJS.ErrnoException {
  return isRecord(error) && error.code === code
}

function errorToMessage(error: Error | string | null | undefined): string {
  return error instanceof Error ? error.message : String(error)
}

