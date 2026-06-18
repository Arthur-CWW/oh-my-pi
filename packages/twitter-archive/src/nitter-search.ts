import { initTwitterArchiveSqliteStore, type TwitterArchiveSqliteCounts, type TwitterArchiveSqliteStore } from "./sqlite-store"
import type { ArchiveMedia, ArchiveTweet, ArchiveUser } from "./schema"
import {
  classifyNitterResponse,
  NITTER_DEFAULT_BASE_URL,
  NITTER_DEFAULT_MAX_PAGES,
  NITTER_HARD_MAX_PAGES,
  parseNitterTimelinePage,
  type CapturedNitterEntityUpserts,
  type NitterCursorInfo,
  type NitterFetchFunction,
  type NitterStopReason,
  type NitterTimelineItemInfo,
  type ParsedNitterTimelinePage,
} from "./nitter"

export interface TwitterAdvancedSearchQueryInput {
  rawText?: string
  from?: string
  minFaves?: number | string
  since?: string
  until?: string
  sinceTime?: number | string
  untilTime?: number | string
  withinTime?: string
}

export interface FetchNitterSearchOptions {
  baseUrl?: string
  fetchFn?: NitterFetchFunction
  maxPages?: number
  startCursor?: string
  delayMs?: number
  jitterMs?: number
  signal?: AbortSignal
  capturedAt?: string
}

export interface FetchedNitterSearch {
  query: string
  users: ArchiveUser[]
  tweets: ArchiveTweet[]
  media: ArchiveMedia[]
  timeline: NitterTimelineItemInfo[]
  pages: ParsedNitterTimelinePage[]
  requestedMaxPages: number
  maxPages: number
  stopReason: NitterStopReason
  nextCursor?: NitterCursorInfo
}

export interface CaptureNitterSearchToSqliteOptions extends FetchNitterSearchOptions {
  dbPath?: string
  store?: TwitterArchiveSqliteStore
}

export interface CapturedNitterSearchToSqlite extends FetchedNitterSearch {
  dbPath?: string
  counts: TwitterArchiveSqliteCounts
  rawPagesCached: number
  entityUpserts: CapturedNitterEntityUpserts
}

export type NitterSearchQuery = string | TwitterAdvancedSearchQueryInput

const TWITTER_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/
const TWITTER_SEARCH_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:_(\d{2}):(\d{2}):(\d{2})_UTC)?$/
const UNSIGNED_INTEGER_PATTERN = /^\d+$/
const WITHIN_TIME_PATTERN = /^[1-9]\d*[dhms]$/

export function buildTwitterAdvancedSearchQuery(input: TwitterAdvancedSearchQueryInput): string {
  const parts: string[] = []
  const rawText = input.rawText?.trim()
  if (rawText) {
    parts.push(rawText)
  }
  if (input.from !== undefined) {
    parts.push(`from:${parseTwitterAdvancedSearchUsername(input.from)}`)
  }
  if (input.minFaves !== undefined) {
    parts.push(`min_faves:${parseTwitterAdvancedSearchMinFaves(input.minFaves)}`)
  }
  if (input.since !== undefined) {
    parts.push(`since:${parseTwitterAdvancedSearchDate(input.since, "since")}`)
  }
  if (input.until !== undefined) {
    parts.push(`until:${parseTwitterAdvancedSearchDate(input.until, "until")}`)
  }
  if (input.sinceTime !== undefined) {
    parts.push(`since_time:${parseTwitterAdvancedSearchUnixSeconds(input.sinceTime, "sinceTime")}`)
  }
  if (input.untilTime !== undefined) {
    parts.push(`until_time:${parseTwitterAdvancedSearchUnixSeconds(input.untilTime, "untilTime")}`)
  }
  if (input.withinTime !== undefined) {
    parts.push(`within_time:${parseTwitterAdvancedSearchWithinTime(input.withinTime)}`)
  }
  return parts.join(" ")
}

export function parseTwitterAdvancedSearchUsername(username: string): string {
  const normalized = username.trim().replace(/^@+/, "")
  if (!TWITTER_HANDLE_PATTERN.test(normalized)) {
    throw new Error("from must be a Twitter username with 1-15 letters, numbers, or underscores")
  }
  return normalized
}

export function parseTwitterAdvancedSearchMinFaves(value: number | string): string {
  return parseNonNegativeSafeInteger(value, "minFaves")
}

export function parseTwitterAdvancedSearchDate(value: string, fieldName = "date"): string {
  const text = value.trim()
  const match = text.match(TWITTER_SEARCH_DATE_PATTERN)
  if (!match) {
    throw new Error(`${fieldName} must use YYYY-MM-DD or YYYY-MM-DD_HH:MM:SS_UTC`)
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = match[4] === undefined ? 0 : Number(match[4])
  const minute = match[5] === undefined ? 0 : Number(match[5])
  const second = match[6] === undefined ? 0 : Number(match[6])
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error(`${fieldName} must contain a valid UTC time`)
  }

  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second
  ) {
    throw new Error(`${fieldName} must contain a valid calendar date`)
  }

  return text
}

export function parseTwitterAdvancedSearchUnixSeconds(value: number | string, fieldName = "time"): string {
  return parseNonNegativeSafeInteger(value, fieldName)
}

export function parseTwitterAdvancedSearchWithinTime(value: string): string {
  const text = value.trim()
  if (!WITHIN_TIME_PATTERN.test(text)) {
    throw new Error("withinTime must use a positive duration ending in d, h, m, or s")
  }
  return text
}

export function buildNitterSearchUrl(
  baseUrl: string,
  query: NitterSearchQuery,
  cursor: string | undefined = undefined,
): string {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}/search`)
  url.searchParams.set("f", "tweets")
  url.searchParams.set("q", normalizeNitterSearchQuery(query))
  if (cursor) {
    url.searchParams.set("cursor", cursor)
  }
  return url.toString()
}

export async function fetchNitterSearch(
  query: NitterSearchQuery,
  options: FetchNitterSearchOptions = {},
): Promise<FetchedNitterSearch> {
  const normalizedQuery = normalizeNitterSearchQuery(query)
  const requestedMaxPages = options.maxPages ?? NITTER_DEFAULT_MAX_PAGES
  const maxPages = clampPageCount(requestedMaxPages)
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? NITTER_DEFAULT_BASE_URL)
  const fetchFn: NitterFetchFunction = options.fetchFn ?? ((url, init) => fetch(url, init))
  const users = new Map<string, ArchiveUser>()
  const tweets = new Map<string, ArchiveTweet>()
  const media = new Map<string, ArchiveMedia>()
  const timeline: NitterTimelineItemInfo[] = []
  const pages: ParsedNitterTimelinePage[] = []
  let cursor: string | undefined = options.startCursor
  let nextCursor: NitterCursorInfo | undefined
  let stopReason: NitterStopReason = "max-pages"

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const url = buildNitterSearchUrl(baseUrl, normalizedQuery, cursor)
    const response = await fetchFn(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
      },
      signal: options.signal,
    })
    const body = await response.text()
    const classification = classifyNitterResponse(response.status, body)
    if (!classification.ok) {
      stopReason = classification.reason ?? "non-2xx"
      break
    }

    const parsed = parseNitterTimelinePage(body, {
      baseUrl,
      capturedAt: options.capturedAt,
    })
    pages.push(parsed)
    mergeParsedPage(parsed, users, tweets, media, timeline)
    nextCursor = parsed.nextCursor

    if (!parsed.nextCursor) {
      stopReason = "no-cursor"
      break
    }

    cursor = parsed.nextCursor.cursor
    if (pageNumber + 1 < maxPages) {
      await delayBeforeNextPage(options.delayMs, options.jitterMs)
    }
  }

  return {
    query: normalizedQuery,
    users: Array.from(users.values()),
    tweets: Array.from(tweets.values()),
    media: Array.from(media.values()),
    timeline,
    pages,
    requestedMaxPages,
    maxPages,
    stopReason,
    nextCursor,
  }
}

export async function captureNitterSearchToSqlite(
  query: NitterSearchQuery,
  options: CaptureNitterSearchToSqliteOptions = {},
): Promise<CapturedNitterSearchToSqlite> {
  let sqliteStore: TwitterArchiveSqliteStore
  let closeStore = false
  if (options.store) {
    sqliteStore = options.store
  } else {
    const dbPath = options.dbPath
    if (!dbPath) {
      throw new Error("captureNitterSearchToSqlite requires dbPath or store")
    }
    sqliteStore = initTwitterArchiveSqliteStore(dbPath)
    closeStore = true
  }

  const normalizedQuery = normalizeNitterSearchQuery(query)
  const requestedMaxPages = options.maxPages ?? NITTER_DEFAULT_MAX_PAGES
  const maxPages = clampPageCount(requestedMaxPages)
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? NITTER_DEFAULT_BASE_URL)
  const fetchFn: NitterFetchFunction = options.fetchFn ?? ((url, init) => fetch(url, init))
  const users = new Map<string, ArchiveUser>()
  const tweets = new Map<string, ArchiveTweet>()
  const media = new Map<string, ArchiveMedia>()
  const timeline: NitterTimelineItemInfo[] = []
  const pages: ParsedNitterTimelinePage[] = []
  let cursor: string | undefined = options.startCursor
  let nextCursor: NitterCursorInfo | undefined
  let stopReason: NitterStopReason = "max-pages"
  let rawPagesCached = 0
  const entityUpserts: CapturedNitterEntityUpserts = { users: 0, tweets: 0, media: 0 }

  try {
    for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
      const url = buildNitterSearchUrl(baseUrl, normalizedQuery, cursor)
      const response = await fetchFn(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
        },
        signal: options.signal,
      })
      const body = await response.text()
      const contentType = response.headers?.get("content-type") ?? undefined
      const fetchedAt = new Date().toISOString()
      const cachedPage = sqliteStore.cacheRawPage({
        source: "nitter-search",
        url,
        body,
        fetchedAt,
        statusCode: response.status,
        contentType,
        headers: contentType ? { "content-type": contentType } : undefined,
      })
      rawPagesCached += 1

      const classification = classifyNitterResponse(response.status, body)
      if (!classification.ok) {
        sqliteStore.updateRawPageParseStatus("nitter-search", url, cachedPage.requestHash, "failed")
        stopReason = classification.reason ?? "non-2xx"
        break
      }

      const parsed = parseNitterTimelinePage(body, {
        baseUrl,
        capturedAt: options.capturedAt,
      })
      sqliteStore.updateRawPageParseStatus("nitter-search", url, cachedPage.requestHash, "parsed")
      pages.push(parsed)
      const userUpserts = sqliteStore.upsertUsers(parsed.users)
      const tweetUpserts = sqliteStore.upsertTweets(parsed.tweets)
      const mediaUpserts = sqliteStore.upsertMedia(parsed.media)
      entityUpserts.users += userUpserts.upserted
      entityUpserts.tweets += tweetUpserts.upserted
      entityUpserts.media += mediaUpserts.upserted
      for (const item of parsed.timeline) {
        if (item.needsDetailResolution) {
          sqliteStore.setTweetAttribute({ tweetId: item.tweetId, key: "nitter:detail", value: "pending" })
          sqliteStore.updateTweetResolutionStatus(item.tweetId, { threadStatus: "pending" })
        }
      }
      mergeParsedPage(parsed, users, tweets, media, timeline)
      nextCursor = parsed.nextCursor

      if (!parsed.nextCursor) {
        stopReason = "no-cursor"
        break
      }

      cursor = parsed.nextCursor.cursor
      if (pageNumber + 1 < maxPages) {
        await delayBeforeNextPage(options.delayMs, options.jitterMs)
      }
    }

    return {
      query: normalizedQuery,
      users: Array.from(users.values()),
      tweets: Array.from(tweets.values()),
      media: Array.from(media.values()),
      timeline,
      pages,
      requestedMaxPages,
      maxPages,
      stopReason,
      nextCursor,
      dbPath: options.dbPath,
      counts: sqliteStore.getCounts(),
      rawPagesCached,
      entityUpserts,
    }
  } finally {
    if (closeStore) {
      sqliteStore.close()
    }
  }
}

function normalizeNitterSearchQuery(query: NitterSearchQuery): string {
  const normalized = typeof query === "string" ? query.trim() : buildTwitterAdvancedSearchQuery(query)
  if (!normalized) {
    throw new Error("Nitter search query must not be empty")
  }
  return normalized
}

function parseNonNegativeSafeInteger(value: number | string, fieldName: string): string {
  const text = typeof value === "number" ? String(value) : value.trim()
  if (!UNSIGNED_INTEGER_PATTERN.test(text)) {
    throw new Error(`${fieldName} must be a non-negative integer`)
  }
  const numberValue = Number(text)
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    throw new Error(`${fieldName} must be a safe non-negative integer`)
  }
  return String(numberValue)
}

function mergeParsedPage(
  parsed: ParsedNitterTimelinePage,
  users: Map<string, ArchiveUser>,
  tweets: Map<string, ArchiveTweet>,
  media: Map<string, ArchiveMedia>,
  timeline: NitterTimelineItemInfo[],
): void {
  for (const user of parsed.users) {
    users.set(user.id, user)
  }
  for (const tweet of parsed.tweets) {
    tweets.set(tweet.id, tweet)
  }
  for (const entry of parsed.media) {
    media.set(entry.id, entry)
  }
  timeline.push(...parsed.timeline)
}

function clampPageCount(maxPages: number): number {
  if (!Number.isFinite(maxPages) || maxPages < 1) {
    return 1
  }
  return Math.min(Math.floor(maxPages), NITTER_HARD_MAX_PAGES)
}

async function delayBeforeNextPage(delayMs: number | undefined, jitterMs: number | undefined): Promise<void> {
  const baseDelay = Math.max(0, delayMs ?? 0)
  const jitter = Math.max(0, jitterMs ?? 0)
  const totalDelay = baseDelay + (jitter > 0 ? Math.floor(Math.random() * jitter) : 0)
  if (totalDelay === 0) {
    return
  }

  await Bun.sleep(totalDelay)
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "")
}
