import { dirname, join } from "node:path"

import {
  NITTER_BACKFILL_WORKER_DEFAULT_DELAY_MS,
  NITTER_BACKFILL_WORKER_DEFAULT_JITTER_MS,
  NITTER_BACKFILL_WORKER_DEFAULT_MEDIA_MAX_ITEMS,
  ensureNitterBackfillTargetsTable,
  runNitterBackfillWorker,
} from "./backfill-worker"
import { DEFAULT_NITTER_MIRRORS, DiskCache, MirrorPool, type DiskCacheFetch } from "./corpus/scraper"
import { appendTwitterArchiveJsonlLog, type JsonlLogDetails } from "./jsonl-log"
import { downloadArchivedMedia, type MediaDownloadFetchFunction } from "./media-download"
import { classifyNitterResponse, normalizeNitterUsername, type NitterFetchFunction, type NitterFetchResponseLike } from "./nitter"
import { captureNitterSearchToSqlite } from "./nitter-search"
import { initTwitterArchiveSqliteStore, type TwitterArchiveSqliteStore } from "./sqlite-store"
import { importWaybackSnapshotsToSqlite, type WaybackFetchFunction } from "./wayback-import"

export const FULL_SYNC_DEFAULT_HORIZON = "2006-03-21T00:00:00.000Z"
export const FULL_SYNC_DEFAULT_PAGES_PER_PASS = 10
const SEARCH_WINDOW_DAYS = 365

export type FullSyncLaneName = "timeline" | "search" | "wayback" | "media"
export type FullSyncLaneStatus = "pending" | "running" | "stopped" | "completed"
export type FullSyncStopReason = "completed" | "page-budget" | "rate-limited" | "upstream" | "aborted" | "error"

export interface FullSyncLaneSummary {
  readonly lane: FullSyncLaneName
  readonly status: FullSyncLaneStatus
  readonly stopReason: string | null
  readonly pages: number
  readonly tweets: number
  readonly items: number
  readonly cursor: string | null
}

export interface FullSyncHandleSummary {
  readonly handle: string
  readonly exhaustedAt: string | null
  readonly stopReason: FullSyncStopReason
  readonly totalTweets: number
  readonly oldestTweet: string | null
  readonly lanes: readonly FullSyncLaneSummary[]
}

export interface FullSyncPassSummary {
  readonly runId: string
  readonly handles: readonly FullSyncHandleSummary[]
}

export interface FullSyncPassOptions {
  readonly runId: string
  readonly handles: readonly string[]
  readonly dbPath: string
  readonly logPath: string
  readonly mediaRoot: string
  readonly baseUrl: string
  readonly pagesPerPass?: number
  readonly horizon?: string
  readonly delayMs?: number
  readonly jitterMs?: number
  readonly mediaMaxItems?: number
  readonly mirrorUrls?: readonly string[]
  readonly cacheRoot?: string
  readonly fetchFn?: NitterFetchFunction
  readonly mediaFetchFn?: MediaDownloadFetchFunction
  readonly signal?: AbortSignal
  readonly now?: () => string
}

interface FullSyncRow {
  handle_key: string
  handle: string
  horizon: string
  exhausted_at: string | null
  stop_reason: string | null
  total_tweets: number
  oldest_tweet: string | null
}

interface FullSyncLaneRow {
  handle_key: string
  lane: FullSyncLaneName
  status: FullSyncLaneStatus
  stop_reason: string | null
  pages: number
  tweets: number
  items: number
  cursor: string | null
  window_since: string | null
  window_until: string | null
}

interface TimelineProgressRow {
  status: string
  stop_reason: string | null
  pages_fetched: number
  tweets_upserted: number
}

interface TweetCorpusStats {
  total_tweets: number
}

export function ensureFullSyncTables(store: TwitterArchiveSqliteStore): void {
  store.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS full_sync_handles (
      handle_key TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      horizon TEXT NOT NULL,
      exhausted_at TEXT,
      stop_reason TEXT,
      total_tweets INTEGER NOT NULL DEFAULT 0,
      oldest_tweet TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS full_sync_lanes (
      handle_key TEXT NOT NULL,
      lane TEXT NOT NULL,
      status TEXT NOT NULL,
      stop_reason TEXT,
      pages INTEGER NOT NULL DEFAULT 0,
      tweets INTEGER NOT NULL DEFAULT 0,
      items INTEGER NOT NULL DEFAULT 0,
      cursor TEXT,
      window_since TEXT,
      window_until TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (handle_key, lane)
    );
  `)
}

export async function runFullSyncPass(options: FullSyncPassOptions): Promise<FullSyncPassSummary> {
  const pagesPerPass = positiveInteger(options.pagesPerPass ?? FULL_SYNC_DEFAULT_PAGES_PER_PASS, "pagesPerPass")
  const horizon = normalizeTimestamp(options.horizon ?? FULL_SYNC_DEFAULT_HORIZON, "horizon")
  const now = options.now ?? (() => new Date().toISOString())
  const jitterMinMs = nonNegativeInteger(options.delayMs ?? NITTER_BACKFILL_WORKER_DEFAULT_DELAY_MS, "delayMs")
  const jitterMaxMs = jitterMinMs + nonNegativeInteger(options.jitterMs ?? NITTER_BACKFILL_WORKER_DEFAULT_JITTER_MS, "jitterMs")
  const cache = new DiskCache(
    options.cacheRoot ?? join(dirname(options.dbPath), "cache", "full-sync"),
    options.fetchFn ? nitterFetchAdapter(options.fetchFn) : undefined,
  )
  const mirrors = new MirrorPool(options.mirrorUrls ?? [options.baseUrl, ...DEFAULT_NITTER_MIRRORS])
  const fetchFn = createRespectfulNitterFetch({ cache, mirrors, logPath: options.logPath, runId: options.runId, signal: options.signal, jitterMinMs, jitterMaxMs })
  const handles: FullSyncHandleSummary[] = []

  for (const rawHandle of options.handles) {
    if (options.signal?.aborted) break
    const handle = normalizeNitterUsername(rawHandle)
    handles.push(
      await runHandlePass({
        ...options,
        handle,
        horizon,
        pagesPerPass,
        now,
        fetchFn,
        cache,
      }),
    )
  }
  return { runId: options.runId, handles }
}

async function runHandlePass(
  options: FullSyncPassOptions & {
    readonly handle: string
    readonly horizon: string
    readonly pagesPerPass: number
    readonly now: () => string
    readonly fetchFn: NitterFetchFunction
    readonly cache: DiskCache
  },
): Promise<FullSyncHandleSummary> {
  const handleKey = options.handle.toLowerCase()
  let remainingPages = options.pagesPerPass
  let horizon = options.horizon
  const store = initTwitterArchiveSqliteStore(options.dbPath)
  try {
    ensureNitterBackfillTargetsTable(store)
    ensureFullSyncTables(store)
    ensureHandleRows(store, handleKey, options.handle, options.horizon, options.now())
    const existing = readHandle(store, handleKey)
    horizon = existing.horizon
    if (existing.exhausted_at) {
      const stats = store.sqlite.query(`SELECT COUNT(*) AS total_tweets FROM tweets WHERE LOWER(username) = ?`).get(handleKey) as TweetCorpusStats
      store.sqlite.query(`UPDATE full_sync_handles SET total_tweets = ?, oldest_tweet = ?, updated_at = ? WHERE handle_key = ?`).run(stats.total_tweets, readOldestTweet(store, handleKey), options.now(), handleKey)
      return summarizeHandle(store, readHandle(store, handleKey), "completed")
    }
  } finally {
    store.close()
  }

  let timeline = readLaneFromPath(options.dbPath, handleKey, "timeline")
  if (timeline.status !== "completed" && remainingPages > 0) {
    const before = readTimelineProgress(options.dbPath, handleKey, options.baseUrl)
    setLaneState(options.dbPath, handleKey, "timeline", "running", null, options.now())
    const timelineRun = await runNitterBackfillWorker({
      runId: `${options.runId}:${handleKey}:timeline`,
      handles: [options.handle],
      dbPath: options.dbPath,
      logPath: options.logPath,
      mediaRoot: options.mediaRoot,
      baseUrl: options.baseUrl,
      batchPages: remainingPages,
      maxTotalPages: remainingPages,
      delayMs: options.delayMs ?? NITTER_BACKFILL_WORKER_DEFAULT_DELAY_MS,
      jitterMs: options.jitterMs ?? NITTER_BACKFILL_WORKER_DEFAULT_JITTER_MS,
      mediaConcurrency: 1,
      mediaMaxItems: options.mediaMaxItems ?? NITTER_BACKFILL_WORKER_DEFAULT_MEDIA_MAX_ITEMS,
      runUntilEnd: true,
      fetchFn: options.fetchFn,
      mediaFetchFn: options.mediaFetchFn,
      signal: options.signal,
      now: options.now,
    })
    const target = timelineRun.targets[0]
    const used = Math.max(0, target.pagesFetched - before.pages_fetched)
    remainingPages = Math.max(0, remainingPages - used)
    const terminal = target.stopReason === "no-cursor"
    updateLane(options.dbPath, handleKey, "timeline", {
      status: terminal ? "completed" : "stopped",
      stopReason: target.stopReason,
      pagesDelta: used,
      tweetsDelta: Math.max(0, target.tweetsUpserted - before.tweets_upserted),
      cursor: target.cursor,
      now: options.now(),
    })
    await laneEvent(options, "timeline", terminal ? "completed" : "stopped", { pages: used, stopReason: target.stopReason })
    timeline = readLaneFromPath(options.dbPath, handleKey, "timeline")
  }

  let search = readLaneFromPath(options.dbPath, handleKey, "search")
  while (timeline.status === "completed" && search.status !== "completed" && remainingPages > 0) {
    const window = searchWindow(search, options.now(), horizon)
    setLaneSearchWindow(options.dbPath, handleKey, "running", null, search.cursor, window.since, window.until, options.now())
    const result = await captureNitterSearchToSqlite(
      { from: options.handle, since: datePart(window.since), until: datePart(window.until) },
      {
        dbPath: options.dbPath,
        baseUrl: options.baseUrl,
        fetchFn: options.fetchFn,
        maxPages: remainingPages,
        startCursor: search.cursor ?? undefined,
        delayMs: options.delayMs ?? NITTER_BACKFILL_WORKER_DEFAULT_DELAY_MS,
        jitterMs: options.jitterMs ?? NITTER_BACKFILL_WORKER_DEFAULT_JITTER_MS,
        signal: options.signal,
        capturedAt: options.now(),
      },
    )
    const used = Math.max(1, result.pages.length)
    remainingPages = Math.max(0, remainingPages - used)
    const reachedWindowEnd = result.stopReason === "no-cursor"
    const reachedHorizon = reachedWindowEnd && window.since === horizon
    const status: FullSyncLaneStatus = reachedHorizon ? "completed" : "stopped"
    const nextWindowUntil = reachedWindowEnd ? window.since : window.until
    const nextWindowSince = reachedWindowEnd ? subtractWindow(window.since, horizon) : window.since
    updateSearchLane(options.dbPath, handleKey, {
      status,
      stopReason: result.stopReason,
      pagesDelta: used,
      tweetsDelta: result.entityUpserts.tweets,
      cursor: reachedWindowEnd ? null : (result.nextCursor?.cursor ?? null),
      windowSince: nextWindowSince,
      windowUntil: nextWindowUntil,
      now: options.now(),
    })
    await laneEvent(options, "search", status, {
      cachedPages: result.rawPagesCached,
      pages: used,
      stopReason: result.stopReason,
      windowSince: window.since,
      windowUntil: window.until,
    })
    search = readLaneFromPath(options.dbPath, handleKey, "search")
    if (!reachedWindowEnd) break
  }

  let wayback = readLaneFromPath(options.dbPath, handleKey, "wayback")
  if (search.status === "completed" && wayback.status !== "completed") {
    setLaneState(options.dbPath, handleKey, "wayback", "running", null, options.now())
    const result = await importWaybackSnapshotsToSqlite(options.handle, {
      dbPath: options.dbPath,
      fetchFn: cachedWaybackFetch(
        options.cache,
        options.signal,
        options.logPath,
        options.runId,
        options.delayMs ?? NITTER_BACKFILL_WORKER_DEFAULT_DELAY_MS,
        (options.delayMs ?? NITTER_BACKFILL_WORKER_DEFAULT_DELAY_MS) + (options.jitterMs ?? NITTER_BACKFILL_WORKER_DEFAULT_JITTER_MS),
      ),
      importedAt: options.now(),
      capturedAt: options.now(),
      fetchSnapshots: true,
    })
    const terminal = result.queryErrors.length === 0
    updateLane(options.dbPath, handleKey, "wayback", {
      status: terminal ? "completed" : "stopped",
      stopReason: terminal ? "no-cursor" : "upstream",
      pagesDelta: result.queries.length + result.snapshotsFetched,
      tweetsDelta: result.entityUpserts.tweets,
      cursor: null,
      now: options.now(),
    })
    await laneEvent(options, "wayback", terminal ? "completed" : "stopped", {
      queries: result.queries.length,
      queryErrors: result.queryErrors.length,
      snapshotsFetched: result.snapshotsFetched,
    })
    wayback = readLaneFromPath(options.dbPath, handleKey, "wayback")
  }

  const media = readLaneFromPath(options.dbPath, handleKey, "media")
  if (wayback.status === "completed" && media.status !== "completed") {
    setLaneState(options.dbPath, handleKey, "media", "running", null, options.now())
    const mediaStore = initTwitterArchiveSqliteStore(options.dbPath)
    let mediaItems = 0
    try {
      const result = await downloadArchivedMedia({
        store: mediaStore,
        mediaRoot: options.mediaRoot,
        fetchFn: options.mediaFetchFn,
        logPath: options.logPath,
        runId: options.runId,
        maxItems: options.mediaMaxItems ?? NITTER_BACKFILL_WORKER_DEFAULT_MEDIA_MAX_ITEMS,
        concurrency: 1,
        signal: options.signal,
        now: options.now,
      })
      mediaItems = result.counts.total
    } finally {
      mediaStore.close()
    }
    incrementLaneItems(options.dbPath, handleKey, "media", mediaItems, options.now())
    setLaneState(options.dbPath, handleKey, "media", "completed", "capped-pass", options.now())
    await laneEvent(options, "media", "completed", { items: mediaItems, maxItems: options.mediaMaxItems ?? NITTER_BACKFILL_WORKER_DEFAULT_MEDIA_MAX_ITEMS })
  }

  return finalizeOrSummarize(options.dbPath, handleKey, options.now())
}

function ensureHandleRows(store: TwitterArchiveSqliteStore, handleKey: string, handle: string, horizon: string, now: string): void {
  store.sqlite
    .query(`INSERT INTO full_sync_handles (handle_key, handle, horizon, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(handle_key) DO UPDATE SET handle = excluded.handle, updated_at = excluded.updated_at`)
    .run(handleKey, handle, horizon, now, now)
  for (const lane of ["timeline", "search", "wayback", "media"] as const) {
    store.sqlite
      .query(`INSERT INTO full_sync_lanes (handle_key, lane, status, updated_at) VALUES (?, ?, 'pending', ?) ON CONFLICT(handle_key, lane) DO NOTHING`)
      .run(handleKey, lane, now)
  }
}

function readHandle(store: TwitterArchiveSqliteStore, handleKey: string): FullSyncRow {
  const row = store.sqlite.query(`SELECT * FROM full_sync_handles WHERE handle_key = ?`).get(handleKey) as FullSyncRow | null
  if (!row) throw new Error(`Missing full sync handle state for ${handleKey}`)
  return row
}

function readLaneFromPath(dbPath: string, handleKey: string, lane: FullSyncLaneName): FullSyncLaneRow {
  const store = initTwitterArchiveSqliteStore(dbPath)
  try {
    ensureFullSyncTables(store)
    const row = store.sqlite.query(`SELECT * FROM full_sync_lanes WHERE handle_key = ? AND lane = ?`).get(handleKey, lane) as FullSyncLaneRow | null
    if (!row) throw new Error(`Missing ${lane} lane for ${handleKey}`)
    return row
  } finally {
    store.close()
  }
}

function readTimelineProgress(dbPath: string, handleKey: string, baseUrl: string): TimelineProgressRow {
  const store = initTwitterArchiveSqliteStore(dbPath)
  try {
    ensureNitterBackfillTargetsTable(store)
    const row = store.sqlite.query(`SELECT status, stop_reason, pages_fetched, tweets_upserted FROM nitter_backfill_targets WHERE handle_key = ? AND base_url = ?`).get(handleKey, baseUrl) as TimelineProgressRow | null
    return row ?? { status: "pending", stop_reason: null, pages_fetched: 0, tweets_upserted: 0 }
  } finally {
    store.close()
  }
}

function setLaneState(dbPath: string, handleKey: string, lane: FullSyncLaneName, status: FullSyncLaneStatus, stopReason: string | null, now: string): void {
  const store = initTwitterArchiveSqliteStore(dbPath)
  try {
    store.sqlite.query(`UPDATE full_sync_lanes SET status = ?, stop_reason = ?, updated_at = ? WHERE handle_key = ? AND lane = ?`).run(status, stopReason, now, handleKey, lane)
  } finally {
    store.close()
  }
}

function incrementLaneItems(dbPath: string, handleKey: string, lane: FullSyncLaneName, items: number, now: string): void {
  const store = initTwitterArchiveSqliteStore(dbPath)
  try {
    store.sqlite.query(`UPDATE full_sync_lanes SET items = items + ?, updated_at = ? WHERE handle_key = ? AND lane = ?`).run(items, now, handleKey, lane)
  } finally {
    store.close()
  }
}

function setLaneSearchWindow(dbPath: string, handleKey: string, status: FullSyncLaneStatus, stopReason: string | null, cursor: string | null, since: string, until: string, now: string): void {
  const store = initTwitterArchiveSqliteStore(dbPath)
  try {
    store.sqlite.query(`UPDATE full_sync_lanes SET status = ?, stop_reason = ?, cursor = ?, window_since = ?, window_until = ?, updated_at = ? WHERE handle_key = ? AND lane = 'search'`).run(status, stopReason, cursor, since, until, now, handleKey)
  } finally {
    store.close()
  }
}

function updateLane(dbPath: string, handleKey: string, lane: FullSyncLaneName, input: { status: FullSyncLaneStatus; stopReason: string | null; pagesDelta: number; tweetsDelta: number; cursor: string | null; now: string }): void {
  const store = initTwitterArchiveSqliteStore(dbPath)
  try {
    store.sqlite.query(`UPDATE full_sync_lanes SET status = ?, stop_reason = ?, pages = pages + ?, tweets = tweets + ?, cursor = ?, updated_at = ? WHERE handle_key = ? AND lane = ?`).run(input.status, input.stopReason, input.pagesDelta, input.tweetsDelta, input.cursor, input.now, handleKey, lane)
  } finally {
    store.close()
  }
}

function updateSearchLane(dbPath: string, handleKey: string, input: { status: FullSyncLaneStatus; stopReason: string | null; pagesDelta: number; tweetsDelta: number; cursor: string | null; windowSince: string; windowUntil: string; now: string }): void {
  const store = initTwitterArchiveSqliteStore(dbPath)
  try {
    store.sqlite.query(`UPDATE full_sync_lanes SET status = ?, stop_reason = ?, pages = pages + ?, tweets = tweets + ?, cursor = ?, window_since = ?, window_until = ?, updated_at = ? WHERE handle_key = ? AND lane = 'search'`).run(input.status, input.stopReason, input.pagesDelta, input.tweetsDelta, input.cursor, input.windowSince, input.windowUntil, input.now, handleKey)
  } finally {
    store.close()
  }
}

function finalizeOrSummarize(dbPath: string, handleKey: string, now: string): FullSyncHandleSummary {
  const store = initTwitterArchiveSqliteStore(dbPath)
  try {
    const lanes = readLanes(store, handleKey)
    const terminal = lanes.every((lane) => lane.status === "completed")
    const stats = store.sqlite.query(`SELECT COUNT(*) AS total_tweets FROM tweets WHERE LOWER(username) = ?`).get(handleKey) as TweetCorpusStats
    const oldestTweet = readOldestTweet(store, handleKey)
    if (terminal) {
      store.sqlite.query(`UPDATE full_sync_handles SET exhausted_at = ?, stop_reason = 'completed', total_tweets = ?, oldest_tweet = ?, updated_at = ? WHERE handle_key = ?`).run(now, stats.total_tweets, oldestTweet, now, handleKey)
    } else {
      store.sqlite.query(`UPDATE full_sync_handles SET total_tweets = ?, oldest_tweet = ?, updated_at = ? WHERE handle_key = ?`).run(stats.total_tweets, oldestTweet, now, handleKey)
    }
    const row = readHandle(store, handleKey)
    const reason: FullSyncStopReason = terminal ? "completed" : stopReasonFor(lanes)
    return summarizeHandle(store, row, reason)
  } finally {
    store.close()
  }
}

function summarizeHandle(store: TwitterArchiveSqliteStore, row: FullSyncRow, stopReason: FullSyncStopReason): FullSyncHandleSummary {
  return {
    handle: row.handle,
    exhaustedAt: row.exhausted_at,
    stopReason,
    totalTweets: row.total_tweets,
    oldestTweet: row.oldest_tweet,
    lanes: readLanes(store, row.handle_key).map((lane) => ({
      lane: lane.lane,
      status: lane.status,
      stopReason: lane.stop_reason,
      pages: lane.pages,
      tweets: lane.tweets,
      items: lane.items,
      cursor: lane.cursor,
    })),
  }
}

function readLanes(store: TwitterArchiveSqliteStore, handleKey: string): FullSyncLaneRow[] {
  return store.sqlite.query(`SELECT * FROM full_sync_lanes WHERE handle_key = ? ORDER BY CASE lane WHEN 'timeline' THEN 0 WHEN 'search' THEN 1 WHEN 'wayback' THEN 2 ELSE 3 END`).all(handleKey) as FullSyncLaneRow[]
}

function stopReasonFor(lanes: readonly FullSyncLaneRow[]): FullSyncStopReason {
  const reason = lanes.find((lane) => lane.status === "stopped")?.stop_reason
  if (reason === "rate-limited") return "rate-limited"
  if (reason === "aborted") return "aborted"
  if (reason === "error") return "error"
  if (reason && reason !== "max-pages" && !reason.startsWith("safety-")) return "upstream"
  return "page-budget"
}

function searchWindow(lane: FullSyncLaneRow, now: string, horizon: string): { since: string; until: string } {
  const until = lane.window_until ?? normalizeTimestamp(now, "now")
  return { since: lane.window_since ?? subtractWindow(until, horizon), until }
}

function subtractWindow(until: string, horizon: string): string {
  const value = new Date(until)
  value.setUTCDate(value.getUTCDate() - SEARCH_WINDOW_DAYS)
  const candidate = value.toISOString()
  return candidate < horizon ? horizon : candidate
}

function datePart(timestamp: string): string {
  return timestamp.slice(0, 10)
}

function normalizeTimestamp(value: string, name: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${name} must be an ISO timestamp`)
  return parsed.toISOString()
}

function readOldestTweet(store: TwitterArchiveSqliteStore, handleKey: string): string | null {
  const rows = store.sqlite.query(`SELECT created_at FROM tweets WHERE LOWER(username) = ? AND created_at IS NOT NULL`).all(handleKey) as Array<{ created_at: string }>
  let oldestMs = Number.POSITIVE_INFINITY
  for (const row of rows) {
    const timestamp = Date.parse(row.created_at.replace(" · ", " "))
    if (Number.isFinite(timestamp) && timestamp < oldestMs) oldestMs = timestamp
  }
  return Number.isFinite(oldestMs) ? new Date(oldestMs).toISOString() : null
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`)
  return value
}

function nitterFetchAdapter(fetchFn: NitterFetchFunction): DiskCacheFetch {
  return async (url, init) => {
    const response = await fetchFn(url, { headers: init.headers as Record<string, string>, signal: init.signal ?? undefined })
    const contentType = response.headers?.get("content-type")
    return new Response(await response.text(), {
      status: response.status,
      headers: contentType ? { "content-type": contentType } : undefined,
    })
  }
}

function createRespectfulNitterFetch(options: { cache: DiskCache; mirrors: MirrorPool; logPath: string; runId: string; signal?: AbortSignal; jitterMinMs: number; jitterMaxMs: number }): NitterFetchFunction {
  return async (requestedUrl) => {
    let lastResponse: NitterFetchResponseLike | undefined
    for (let attempt = 0; attempt < options.mirrors.size; attempt += 1) {
      const mirror = options.mirrors.next(Date.now())
      if (!mirror) break
      const requested = new URL(requestedUrl)
      const actualUrl = `${mirror}${requested.pathname}${requested.search}`
      const fetched = await options.cache.fetch(actualUrl, { signal: options.signal, jitterMinMs: options.jitterMinMs, jitterMaxMs: options.jitterMaxMs })
      await appendTwitterArchiveJsonlLog(options.logPath, { component: "full-sync", level: "info", event: fetched.cached ? "cache.hit" : "cache.miss", runId: options.runId, details: { url: actualUrl } })
      lastResponse = responseLike(fetched.response.status, fetched.response.body, fetched.response.headers)
      const classification = classifyNitterResponse(fetched.response.status, fetched.response.body)
      if (classification.ok) return lastResponse
      const reason = classification.reason ?? "upstream"
      options.mirrors.markUnavailable(mirror, Date.now())
      await appendTwitterArchiveJsonlLog(options.logPath, { component: "full-sync", level: "warn", event: `backoff.${reason}`, runId: options.runId, details: { cached: fetched.cached, mirror, attempt: attempt + 1 } })
    }
    return lastResponse ?? responseLike(429, "all mirrors cooling down")
  }
}

function cachedWaybackFetch(cache: DiskCache, signal: AbortSignal | undefined, logPath: string, runId: string, jitterMinMs: number, jitterMaxMs: number): WaybackFetchFunction {
  return async (url) => {
    const fetched = await cache.fetch(url, { signal, jitterMinMs, jitterMaxMs })
    await appendTwitterArchiveJsonlLog(logPath, { component: "full-sync", level: "info", event: fetched.cached ? "cache.hit" : "cache.miss", runId, details: { lane: "wayback", url } })
    return responseLike(fetched.response.status, fetched.response.body, fetched.response.headers)
  }
}

function responseLike(status: number, body: string, headers: Record<string, string> = {}): NitterFetchResponseLike {
  return { ok: status >= 200 && status < 300, status, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, text: async () => body }
}

async function laneEvent(options: { logPath: string; runId: string; handle: string }, lane: FullSyncLaneName, status: FullSyncLaneStatus, details: JsonlLogDetails): Promise<void> {
  await appendTwitterArchiveJsonlLog(options.logPath, { component: "full-sync", level: "info", event: "lane.status", runId: options.runId, details: { handle: options.handle, lane, status, ...details } })
}
