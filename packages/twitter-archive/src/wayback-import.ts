import { parseNitterTimelinePage } from "./nitter"
import { nowIso, stableId } from "./normalize"
import { initTwitterArchiveSqliteStore, type SqliteJsonValue, type TwitterArchiveSqliteCounts, type TwitterArchiveSqliteStore } from "./sqlite-store"

export const WAYBACK_CDX_SOURCE_LANE = "wayback-cdx"
export const WAYBACK_SNAPSHOT_SOURCE_LANE = "wayback-snapshot"
export const WAYBACK_CDX_BASE_URL = "https://web.archive.org/cdx"
export const WAYBACK_DEFAULT_CDX_LIMIT = 25
export const WAYBACK_HARD_CDX_LIMIT = 25
export const WAYBACK_DEFAULT_SNAPSHOT_LIMIT = 3
export const WAYBACK_HARD_SNAPSHOT_LIMIT = 5

export type WaybackCdxTargetKind = "profile" | "status"
export type WaybackCdxTargetHost = "twitter.com" | "x.com"

export interface WaybackCdxTarget {
  kind: WaybackCdxTargetKind
  host: WaybackCdxTargetHost
  pattern: string
  url: string
}

export interface WaybackCdxQuery {
  target: WaybackCdxTarget
  url: string
  limit: number
}

export interface WaybackCdxQueryOptions {
  cdxBaseUrl?: string
  limit?: number
  from?: string
  to?: string
  collapseDigest?: boolean
  statusCode?: number
}

export interface WaybackFetchRequestInit {
  headers?: Record<string, string>
  signal?: AbortSignal
}

export interface WaybackFetchResponseLike {
  ok?: boolean
  status: number
  headers?: {
    get(name: string): string | null
  }
  text(): Promise<string>
}

export type WaybackFetchFunction = (url: string, init: WaybackFetchRequestInit) => Promise<WaybackFetchResponseLike>

export interface WaybackCdxEntry {
  sourceLane: typeof WAYBACK_CDX_SOURCE_LANE
  sourceUrl: string
  timestamp: string
  originalUrl: string
  mementoUrl: string
  mimeType?: string
  statusCode?: number
  digest?: string
  length?: number
  raw: SqliteJsonValue
}

export interface WaybackCdxQueryError {
  queryUrl: string
  status?: number
  message: string
}

export interface FetchWaybackCdxEntriesOptions extends WaybackCdxQueryOptions {
  fetchFn?: WaybackFetchFunction
  signal?: AbortSignal
}

export interface FetchedWaybackCdxEntries {
  handle: string
  queries: WaybackCdxQuery[]
  entries: WaybackCdxEntry[]
  queryErrors: WaybackCdxQueryError[]
  limit: number
}

export interface ImportWaybackSnapshotsToSqliteOptions extends FetchWaybackCdxEntriesOptions {
  dbPath?: string
  store?: TwitterArchiveSqliteStore
  importBatchId?: string
  importedAt?: string
  capturedAt?: string
  fetchSnapshots?: boolean
  snapshotLimit?: number
}

export interface WaybackEntityUpserts {
  users: number
  tweets: number
  media: number
}

export interface ImportedWaybackSnapshots extends FetchedWaybackCdxEntries {
  importBatchId: string
  counts: TwitterArchiveSqliteCounts
  cdxEntriesStored: number
  snapshotsFetched: number
  rawPagesCached: number
  parseJobsCreated: number
  parsedSnapshots: number
  entityUpserts: WaybackEntityUpserts
}

export function normalizeWaybackHandle(handle: string): string {
  const normalized = handle.trim().replace(/^@+/, "")
  if (!normalized) {
    throw new Error("Wayback handle must not be empty")
  }
  return normalized
}

export function buildWaybackCdxTargets(handle: string): WaybackCdxTarget[] {
  const username = normalizeWaybackHandle(handle)
  return [
    buildTarget("twitter.com", "profile", username),
    buildTarget("x.com", "profile", username),
    buildTarget("twitter.com", "status", username),
    buildTarget("x.com", "status", username),
  ]
}

export function buildWaybackCdxQueries(handle: string, options: WaybackCdxQueryOptions = {}): WaybackCdxQuery[] {
  const limit = clampCdxLimit(options.limit)
  const baseUrl = options.cdxBaseUrl ?? WAYBACK_CDX_BASE_URL
  return buildWaybackCdxTargets(handle).map((target) => {
    const url = new URL(baseUrl)
    url.searchParams.set("url", target.pattern)
    url.searchParams.set("output", "json")
    url.searchParams.set("fl", "timestamp,original,mimetype,statuscode,digest,length")
    url.searchParams.set("limit", String(limit))
    if (options.statusCode !== undefined) {
      url.searchParams.append("filter", `statuscode:${options.statusCode}`)
    } else {
      url.searchParams.append("filter", "statuscode:200")
    }
    if (options.collapseDigest ?? true) {
      url.searchParams.set("collapse", "digest")
    }
    if (options.from) {
      url.searchParams.set("from", options.from)
    }
    if (options.to) {
      url.searchParams.set("to", options.to)
    }
    return { target, url: url.toString(), limit }
  })
}

export async function fetchWaybackCdxEntriesForHandle(
  handle: string,
  options: FetchWaybackCdxEntriesOptions = {},
): Promise<FetchedWaybackCdxEntries> {
  const fetchFn = options.fetchFn ?? defaultFetch
  const queries = buildWaybackCdxQueries(handle, options)
  const entries: WaybackCdxEntry[] = []
  const queryErrors: WaybackCdxQueryError[] = []
  for (const query of queries) {
    try {
      const response = await fetchFn(query.url, {
        headers: { accept: "application/json" },
        signal: options.signal,
      })
      const body = await response.text()
      if (response.status < 200 || response.status > 299) {
        queryErrors.push({ queryUrl: query.url, status: response.status, message: `HTTP ${response.status}` })
        continue
      }
      entries.push(...parseWaybackCdxResponse(body, query.url))
    } catch (error) {
      queryErrors.push({ queryUrl: query.url, message: error instanceof Error ? error.message : String(error) })
    }
  }

  return {
    handle: normalizeWaybackHandle(handle),
    queries,
    entries,
    queryErrors,
    limit: queries[0]?.limit ?? clampCdxLimit(options.limit),
  }
}

export async function importWaybackSnapshotsToSqlite(
  handle: string,
  options: ImportWaybackSnapshotsToSqliteOptions = {},
): Promise<ImportedWaybackSnapshots> {
  let store: TwitterArchiveSqliteStore
  let closeStore = false
  if (options.store) {
    store = options.store
  } else {
    if (!options.dbPath) {
      throw new Error("importWaybackSnapshotsToSqlite requires dbPath or store")
    }
    store = initTwitterArchiveSqliteStore(options.dbPath)
    closeStore = true
  }

  const importedAt = options.importedAt ?? nowIso()
  const importBatchId = options.importBatchId ?? `wayback_${stableId([normalizeWaybackHandle(handle), importedAt]).slice(0, 24)}`
  const fetchFn = options.fetchFn ?? defaultFetch
  const entityUpserts: WaybackEntityUpserts = { users: 0, tweets: 0, media: 0 }
  let cdxEntriesStored = 0
  let snapshotsFetched = 0
  let rawPagesCached = 0
  let parseJobsCreated = 0
  let parsedSnapshots = 0

  try {
    const fetched = await fetchWaybackCdxEntriesForHandle(handle, options)
    for (const entry of fetched.entries) {
      store.upsertWaybackCdxEntry({
        sourceLane: WAYBACK_CDX_SOURCE_LANE,
        sourceUrl: entry.sourceUrl,
        timestamp: entry.timestamp,
        originalUrl: entry.originalUrl,
        mementoUrl: entry.mementoUrl,
        importBatchId,
        importStatus: "listed",
        parseStatus: "pending",
        mimeType: entry.mimeType,
        statusCode: entry.statusCode,
        digest: entry.digest,
        length: entry.length,
        raw: entry.raw,
        importedAt,
      })
      cdxEntriesStored += 1
    }

    const snapshotLimit = options.fetchSnapshots ? clampSnapshotLimit(options.snapshotLimit ?? WAYBACK_DEFAULT_SNAPSHOT_LIMIT) : 0
    for (const entry of fetched.entries.slice(0, snapshotLimit)) {
      const response = await fetchFn(entry.mementoUrl, {
        headers: { accept: "text/html,application/xhtml+xml" },
        signal: options.signal,
      })
      const body = await response.text()
      const contentType = response.headers?.get("content-type") ?? undefined
      const ok = response.status >= 200 && response.status <= 299
      snapshotsFetched += 1
      const cachedPage = store.cacheRawPage({
        source: WAYBACK_SNAPSHOT_SOURCE_LANE,
        url: entry.mementoUrl,
        requestHash: stableId([WAYBACK_SNAPSHOT_SOURCE_LANE, entry.timestamp, entry.originalUrl, entry.mementoUrl]),
        fetchedAt: importedAt,
        statusCode: response.status,
        contentType,
        headers: contentType ? { "content-type": contentType } : undefined,
        body,
        fetchStatus: ok ? "fetched" : "failed",
        parseStatus: ok ? "pending" : "failed",
        sourceUrl: entry.sourceUrl,
        sourceTimestamp: entry.timestamp,
        originalUrl: entry.originalUrl,
        mementoUrl: entry.mementoUrl,
        importBatchId,
        importStatus: ok ? "fetched" : "failed",
      })
      rawPagesCached += 1

      let parseStatus: "pending" | "parsed" | "failed" = ok ? "pending" : "failed"
      let importStatus = ok ? "snapshot-fetched" : "snapshot-fetch-failed"
      if (ok && body.includes("timeline-item") && (body.includes("tweet-content") || body.includes("profile-card"))) {
        const parsed = parseNitterTimelinePage(body, {
          baseUrl: new URL(entry.mementoUrl).origin,
          targetUsername: handle,
          capturedAt: options.capturedAt ?? importedAt,
        })
        if (parsed.users.length > 0 || parsed.tweets.length > 0 || parsed.media.length > 0) {
          const provenance = {
            wayback: {
              sourceLane: WAYBACK_SNAPSHOT_SOURCE_LANE,
              sourceUrl: entry.sourceUrl,
              timestamp: entry.timestamp,
              originalUrl: entry.originalUrl,
              mementoUrl: entry.mementoUrl,
              importBatchId,
            },
          }
          entityUpserts.users += store.upsertUsers(parsed.users, {
            sourceLane: WAYBACK_SNAPSHOT_SOURCE_LANE,
            sourceUrl: entry.mementoUrl,
            importBatchId,
            provenance,
          }).upserted
          entityUpserts.tweets += store.upsertTweets(parsed.tweets, {
            sourceLane: WAYBACK_SNAPSHOT_SOURCE_LANE,
            sourceUrl: entry.mementoUrl,
            importBatchId,
            provenance,
          }).upserted
          entityUpserts.media += store.upsertMedia(parsed.media, {
            sourceLane: WAYBACK_SNAPSHOT_SOURCE_LANE,
            sourceUrl: entry.mementoUrl,
            importBatchId,
            provenance,
          }).upserted
          store.updateRawPageParseStatus(WAYBACK_SNAPSHOT_SOURCE_LANE, entry.mementoUrl, cachedPage.requestHash, "parsed")
          parseStatus = "parsed"
          importStatus = "snapshot-parsed"
          parsedSnapshots += 1
        }
      }

      if (ok && parseStatus === "pending") {
        store.enqueueJob({
          source: WAYBACK_SNAPSHOT_SOURCE_LANE,
          target: entry.mementoUrl,
          requestHash: cachedPage.requestHash,
          stage: "wayback-parse",
          createdAt: importedAt,
          provenance: {
            sourceLane: WAYBACK_SNAPSHOT_SOURCE_LANE,
            sourceUrl: entry.sourceUrl,
            timestamp: entry.timestamp,
            originalUrl: entry.originalUrl,
            mementoUrl: entry.mementoUrl,
            importBatchId,
          },
        })
        parseJobsCreated += 1
      }

      store.upsertWaybackCdxEntry({
        sourceLane: WAYBACK_CDX_SOURCE_LANE,
        sourceUrl: entry.sourceUrl,
        timestamp: entry.timestamp,
        originalUrl: entry.originalUrl,
        mementoUrl: entry.mementoUrl,
        importBatchId,
        importStatus,
        parseStatus,
        mimeType: entry.mimeType,
        statusCode: entry.statusCode,
        digest: entry.digest,
        length: entry.length,
        raw: entry.raw,
        importedAt,
      })
    }

    return {
      ...fetched,
      importBatchId,
      counts: store.getCounts(),
      cdxEntriesStored,
      snapshotsFetched,
      rawPagesCached,
      parseJobsCreated,
      parsedSnapshots,
      entityUpserts,
    }
  } finally {
    if (closeStore) {
      store.close()
    }
  }
}

export function parseWaybackCdxResponse(body: string, sourceUrl: string): WaybackCdxEntry[] {
  const value = JSON.parse(body) as SqliteJsonValue
  if (!Array.isArray(value) || value.length === 0) {
    return []
  }

  if (Array.isArray(value[0])) {
    const headers = value[0].map((header) => String(header))
    return value.slice(1).flatMap((row) => (Array.isArray(row) ? cdxArrayRowToEntry(headers, row, sourceUrl) : []))
  }

  return value.flatMap((row) => (isRecord(row) ? cdxObjectRowToEntry(row, sourceUrl) : []))
}

export function buildWaybackMementoUrl(timestamp: string, originalUrl: string): string {
  return `https://web.archive.org/web/${encodeURIComponent(timestamp)}id_/${originalUrl}`
}

function buildTarget(host: WaybackCdxTargetHost, kind: WaybackCdxTargetKind, username: string): WaybackCdxTarget {
  const path = kind === "profile" ? username : `${username}/status/*`
  const pattern = `${host}/${path}`
  return { kind, host, pattern, url: `https://${host}/${path}` }
}

function cdxArrayRowToEntry(headers: readonly string[], row: readonly SqliteJsonValue[], sourceUrl: string): WaybackCdxEntry[] {
  const record: Record<string, SqliteJsonValue | undefined> = {}
  for (let index = 0; index < headers.length; index += 1) {
    record[headers[index] ?? String(index)] = row[index]
  }
  return cdxObjectRowToEntry(record, sourceUrl)
}

function cdxObjectRowToEntry(row: Record<string, SqliteJsonValue | undefined>, sourceUrl: string): WaybackCdxEntry[] {
  const timestamp = stringValue(row.timestamp)
  const originalUrl = stringValue(row.original) ?? stringValue(row.originalUrl) ?? stringValue(row.url)
  if (!timestamp || !originalUrl) {
    return []
  }
  return [
    {
      sourceLane: WAYBACK_CDX_SOURCE_LANE,
      sourceUrl,
      timestamp,
      originalUrl,
      mementoUrl: buildWaybackMementoUrl(timestamp, originalUrl),
      mimeType: stringValue(row.mimetype) ?? stringValue(row.mimeType),
      statusCode: numberValue(row.statuscode) ?? numberValue(row.statusCode),
      digest: stringValue(row.digest),
      length: numberValue(row.length),
      raw: row,
    },
  ]
}


function clampCdxLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return WAYBACK_DEFAULT_CDX_LIMIT
  }
  if (!Number.isFinite(limit) || limit < 1) {
    return 1
  }
  return Math.min(Math.floor(limit), WAYBACK_HARD_CDX_LIMIT)
}

function clampSnapshotLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 0) {
    return 0
  }
  return Math.min(Math.floor(limit), WAYBACK_HARD_SNAPSHOT_LIMIT)
}

function stringValue(value: SqliteJsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function numberValue(value: SqliteJsonValue | undefined): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

function isRecord(value: SqliteJsonValue | object | undefined): value is Record<string, SqliteJsonValue | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function defaultFetch(url: string, init: WaybackFetchRequestInit): Promise<WaybackFetchResponseLike> {
  return fetch(url, init)
}
