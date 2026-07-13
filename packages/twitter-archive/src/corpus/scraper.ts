import { existsSync } from "node:fs"
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"

import {
  NITTER_DEFAULT_BASE_URL,
  NITTER_HARD_MAX_PAGES,
  classifyNitterResponse,
  normalizeNitterUsername,
  parseNitterTimelinePage,
} from "../nitter"
import type { ArchiveTweet, ArchiveUser } from "../schema"
import { CorpusStore, DEFAULT_CORPUS_DB_PATH, type CorpusTweetInput } from "./store"
import type { CorpusCursor, CorpusStopReason } from "./schema"

const CORPUS_PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url))
export const CORPUS_HORIZON_UTC = "2024-01-01T00:00:00.000Z"
export const DEFAULT_NITTER_MIRRORS = [NITTER_DEFAULT_BASE_URL, "https://nitter.poast.org", "https://nitter.net"] as const

export interface ScrapeAccountOptions {
  handle: string
  dbPath?: string
  maxPages?: number
  signal?: AbortSignal
  mirrorUrls?: readonly string[]
  cacheRoot?: string
  horizonUtc?: string
  onPage?: (page: ScrapePageEvent) => void
}

export interface ScrapePageEvent {
  handle: string
  pageNumber: number
  url: string
  cached: boolean
  tweetsSeen: number
  tweetsInserted: number
  nextCursor: string | null
}

export interface ScrapeAccountResult {
  handle: string
  pagesFetched: number
  tweetsSeen: number
  tweetsInserted: number
  stoppedBecause: CorpusStopReason
  cursor: CorpusCursor | null
}

export interface CachedHttpResponse {
  url: string
  status: number
  headers: Record<string, string>
  body: string
  fetchedAt: string
}

export interface CachedFetchResult {
  response: CachedHttpResponse
  cached: boolean
}
export type DiskCacheFetch = (url: string, init: RequestInit) => Promise<Response>

interface EnrichedTweet {
  text: string | null
  rawJson: string
  quoteId: string | null
  threadRootId: string | null
  replyToId: string | null
  isNote: boolean
  quotedTweet: CorpusTweetInput | null
}

interface MirrorState {
  url: string
  cooldownUntil: number
}

const HeadersSchema = Schema.Record(Schema.String, Schema.String)
const CacheEntrySchema = Schema.Struct({
  url: Schema.String,
  status: Schema.Number,
  headers: HeadersSchema,
  body: Schema.String,
  fetchedAt: Schema.String,
})
type CacheEntry = Schema.Schema.Type<typeof CacheEntrySchema>

const OptionalString = Schema.optional(Schema.NullOr(Schema.String))
const FxAuthorSchema = Schema.Struct({
  id: OptionalString,
  id_str: OptionalString,
  screen_name: OptionalString,
  name: OptionalString,
})
const FxQuoteSchema = Schema.Struct({
  id: OptionalString,
  id_str: OptionalString,
  text: OptionalString,
  full_text: OptionalString,
  created_at: OptionalString,
  created_timestamp: Schema.optional(Schema.NullOr(Schema.Number)),
  author: Schema.optional(Schema.NullOr(FxAuthorSchema)),
})
const FxTweetSchema = Schema.Struct({
  id: OptionalString,
  id_str: OptionalString,
  text: OptionalString,
  full_text: OptionalString,
  created_at: OptionalString,
  created_timestamp: Schema.optional(Schema.NullOr(Schema.Number)),
  is_note_tweet: Schema.optional(Schema.Boolean),
  conversation_id_str: OptionalString,
  in_reply_to_status_id_str: OptionalString,
  author: Schema.optional(Schema.NullOr(FxAuthorSchema)),
  quote: Schema.optional(Schema.NullOr(FxQuoteSchema)),
})
const FxResponseSchema = Schema.Struct({
  tweet: Schema.optional(Schema.NullOr(FxTweetSchema)),
  code: Schema.optional(Schema.Number),
  message: OptionalString,
})
type FxResponse = Schema.Schema.Type<typeof FxResponseSchema>
type FxTweet = Schema.Schema.Type<typeof FxTweetSchema>
type FxQuote = Schema.Schema.Type<typeof FxQuoteSchema>

const AccountsFileSchema = Schema.Struct({
  accounts: Schema.Array(Schema.String),
  horizon: Schema.optional(Schema.String),
})
export type CorpusAccountsFile = Schema.Schema.Type<typeof AccountsFileSchema>

export class MirrorPool {
  private readonly mirrors: MirrorState[]
  private index = 0

  constructor(urls: readonly string[] = DEFAULT_NITTER_MIRRORS) {
    const normalized = Array.from(new Set(urls.map((url) => normalizeBaseUrl(url)).filter((url) => url.length > 0)))
    this.mirrors = (normalized.length > 0 ? normalized : [NITTER_DEFAULT_BASE_URL]).map((url) => ({ url, cooldownUntil: 0 }))
  }

  get size(): number {
    return this.mirrors.length
  }
  next(nowMs: number): string | null {
    for (let offset = 0; offset < this.mirrors.length; offset += 1) {
      const index = (this.index + offset) % this.mirrors.length
      const mirror = this.mirrors[index]
      if (mirror.cooldownUntil <= nowMs) {
        this.index = index
        return mirror.url
      }
    }
    return null
  }

  rotate(): void {
    this.index = (this.index + 1) % this.mirrors.length
  }

  markUnavailable(url: string, nowMs: number): void {
    const mirror = this.mirrors.find((entry) => entry.url === normalizeBaseUrl(url))
    if (mirror) mirror.cooldownUntil = nowMs + 5 * 60 * 1000
    this.rotate()
  }

  markRateLimited(url: string, nowMs: number): void {
    this.markUnavailable(url, nowMs)
  }
}

export class DiskCache {
  constructor(
    private readonly root: string,
    private readonly fetchFn: DiskCacheFetch = fetch,
  ) {}

  async fetch(url: string, options: { signal?: AbortSignal; jitterMinMs: number; jitterMaxMs: number }): Promise<CachedFetchResult> {
    await mkdir(this.root, { recursive: true })
    const path = this.pathForUrl(url)
    if (existsSync(path)) {
      const entry = decodeCacheEntry(await readFile(path, "utf8"))
      const fetchedAtMs = Date.parse(entry.fetchedAt)
      const failureIsCoolingDown = Number.isFinite(fetchedAtMs) && Date.now() - fetchedAtMs < 5 * 60 * 1000
      if ((entry.status >= 200 && entry.status < 300) || failureIsCoolingDown) {
        return { response: entry, cached: true }
      }
      await unlink(path)
    }

    await delay(randomInt(options.jitterMinMs, options.jitterMaxMs))
    const fetchedAt = new Date().toISOString()
    const response = await this.fetchFn(url, {
      headers: { accept: "text/html,application/xhtml+xml,application/json" },
      signal: options.signal,
    })
    const body = await response.text()
    const headers = responseHeadersToRecord(response.headers)
    const entry: CacheEntry = { url, status: response.status, headers, body, fetchedAt }
    await writeFile(path, JSON.stringify(entry, null, 2))
    return { response: entry, cached: false }
  }

  pathForUrl(url: string): string {
    const hash = createHash("sha256").update(url).digest("hex")
    return join(this.root, `${hash}.json`)
  }
}

export async function scrapeAccount(options: ScrapeAccountOptions): Promise<ScrapeAccountResult> {
  const handle = normalizeCorpusHandle(options.handle)
  const maxPages = clampMaxPages(options.maxPages ?? NITTER_HARD_MAX_PAGES)
  const horizonUtc = normalizeHorizon(options.horizonUtc ?? CORPUS_HORIZON_UTC)
  const store = new CorpusStore({ path: options.dbPath ?? DEFAULT_CORPUS_DB_PATH })
  const cache = new DiskCache(options.cacheRoot ?? join(dirname(options.dbPath ?? DEFAULT_CORPUS_DB_PATH), "cache"))
  const mirrors = new MirrorPool(options.mirrorUrls)
  let pagesFetched = 0
  let tweetsSeen = 0
  let tweetsInserted = 0
  let stoppedBecause: CorpusStopReason = "max-pages"

  try {
    const now = new Date().toISOString()
    store.upsertAuthor({ handle, seen_at: now, last_synced: now })
    let cursor = store.getCursor(handle)
    let nextCursor = cursor?.timeline_cursor ?? null
    let oldestSeenId = cursor?.oldest_seen_id ?? null
    let newestSeenId = cursor?.newest_seen_id ?? null
    let oldOnlyPages = 0

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      if (options.signal?.aborted) {
        stoppedBecause = "aborted"
        break
      }
      const mirror = mirrors.next(Date.now())
      if (mirror === null) {
        stoppedBecause = "no-mirror"
        break
      }

      const url = buildNitterTimelineUrl(mirror, handle, nextCursor ?? undefined)
      const fetched = await cache.fetch(url, { signal: options.signal, jitterMinMs: 2000, jitterMaxMs: 6000 })
      const classification = classifyNitterResponse(fetched.response.status, fetched.response.body)
      if (!classification.ok) {
        if (classification.reason === "rate-limited") {
          mirrors.markRateLimited(mirror, Date.now())
          stoppedBecause = "rate-limited"
        } else {
          stoppedBecause = "upstream"
        }
        break
      }

      const parsed = parseNitterTimelinePage(fetched.response.body, {
        baseUrl: mirror,
        targetUsername: handle,
        capturedAt: fetched.response.fetchedAt,
      })
      const pageTweets = await buildCorpusTweets({
        tweets: parsed.tweets,
        users: parsed.users,
        handle,
        cache,
        signal: options.signal,
      })
      for (const user of parsed.users) {
        store.upsertAuthor(authorInputFromArchiveUser(user, fetched.response.fetchedAt))
      }
      for (const tweet of pageTweets) {
        store.upsertAuthor({ handle: tweet.author, seen_at: fetched.response.fetchedAt, last_synced: null })
      }
      store.upsertAuthor({ handle, seen_at: fetched.response.fetchedAt, last_synced: fetched.response.fetchedAt })
      const inserted = store.upsertTweets(pageTweets).inserted
      tweetsInserted += inserted
      tweetsSeen += parsed.tweets.length
      pagesFetched += 1

      for (const tweet of pageTweets) {
        oldestSeenId = minSnowflake(oldestSeenId, tweet.id)
        newestSeenId = maxSnowflake(newestSeenId, tweet.id)
      }

      const cutoff = pageCutoffState(pageTweets, horizonUtc)
      if (cutoff.allOlderThanHorizon) oldOnlyPages += 1
      const crossedHorizon = cutoff.oldestIsOlderThanHorizon && oldOnlyPages > 0
      const pageCursor = parsed.nextCursor ?? null
      nextCursor = pageCursor?.cursor ?? null
      cursor = store.upsertCursor({
        author: handle,
        oldest_seen_id: oldestSeenId,
        newest_seen_id: newestSeenId,
        timeline_cursor: nextCursor,
        backfill_complete: crossedHorizon || pageCursor === null,
        updated_at: new Date().toISOString(),
      })

      options.onPage?.({
        handle,
        pageNumber: pageIndex + 1,
        url,
        cached: fetched.cached,
        tweetsSeen: parsed.tweets.length,
        tweetsInserted: inserted,
        nextCursor,
      })

      if (crossedHorizon) {
        stoppedBecause = "cutoff"
        break
      }
      if (pageCursor === null) {
        stoppedBecause = "no-cursor"
        break
      }
    }

    if (pagesFetched >= maxPages && stoppedBecause === "max-pages") {
      cursor = store.upsertCursor({
        author: handle,
        oldest_seen_id: oldestSeenId,
        newest_seen_id: newestSeenId,
        timeline_cursor: nextCursor,
        backfill_complete: false,
        updated_at: new Date().toISOString(),
      })
    }

    return { handle, pagesFetched, tweetsSeen, tweetsInserted, stoppedBecause, cursor }
  } finally {
    store.close()
  }
}

export async function loadCorpusAccounts(path = join(CORPUS_PACKAGE_ROOT, "corpus", "accounts.json")): Promise<CorpusAccountsFile> {
  const text = await readFile(path, "utf8")
  return Schema.decodeUnknownSync(Schema.fromJsonString(AccountsFileSchema))(text)
}

async function buildCorpusTweets(input: {
  tweets: readonly ArchiveTweet[]
  users: readonly ArchiveUser[]
  handle: string
  cache: DiskCache
  signal?: AbortSignal
}): Promise<CorpusTweetInput[]> {
  const byHandle = new Map(input.users.map((user) => [normalizeCorpusHandle(user.username), user]))
  const rows: CorpusTweetInput[] = []
  for (const tweet of input.tweets) {
    const author = normalizeCorpusHandle(tweet.username ?? tweet.authorId)
    const needsEnrichment = author === input.handle && (isPossiblyTruncated(tweet.text) || Boolean(tweet.quotedTweetId))
    const enriched = needsEnrichment ? await enrichTweet(tweet, author, input.cache, input.signal) : null
    const row = corpusTweetFromArchiveTweet(tweet, author, byHandle.get(author), enriched)
    rows.push(row)
    if (enriched?.quotedTweet) rows.push(enriched.quotedTweet)
  }
  return dedupeTweets(rows)
}

async function enrichTweet(
  tweet: ArchiveTweet,
  author: string,
  cache: DiskCache,
  signal: AbortSignal | undefined,
): Promise<EnrichedTweet | null> {
  const url = `https://api.fxtwitter.com/${encodeURIComponent(author)}/status/${encodeURIComponent(tweet.id)}`
  const fetched = await cache.fetch(url, { signal, jitterMinMs: 500, jitterMaxMs: 1000 })
  if (fetched.response.status < 200 || fetched.response.status >= 300) return null
  const decoded = decodeFxResponse(fetched.response.body)
  if (decoded === null || !decoded.tweet) return null
  const fxTweet = decoded.tweet
  const quote = fxTweet.quote ?? null
  return {
    text: cleanText(fxTweet.full_text ?? fxTweet.text ?? tweet.text),
    rawJson: fetched.response.body,
    quoteId: quote ? fxTweetId(quote) : tweet.quotedTweetId ?? null,
    threadRootId: fxTweet.conversation_id_str ?? null,
    replyToId: fxTweet.in_reply_to_status_id_str ?? tweet.inReplyToTweetId ?? null,
    isNote: fxTweet.is_note_tweet ?? isPossiblyTruncated(tweet.text),
    quotedTweet: quote ? corpusTweetFromFxQuote(quote, fetched.response.body, fetched.response.fetchedAt) : null,
  }
}

function corpusTweetFromArchiveTweet(
  tweet: ArchiveTweet,
  author: string,
  user: ArchiveUser | undefined,
  enriched: EnrichedTweet | null,
): CorpusTweetInput {
  const capturedAt = tweet.capturedAt
  return {
    id: tweet.id,
    author,
    ts_utc: parseTweetTsUtc(tweet.createdAt, capturedAt),
    text: cleanText(enriched?.text ?? tweet.text),
    raw_json: enriched?.rawJson ?? JSON.stringify({ source: "nitter", tweet }),
    reply_to_id: enriched?.replyToId ?? tweet.inReplyToTweetId ?? null,
    quote_id: enriched?.quoteId ?? tweet.quotedTweetId ?? null,
    thread_root_id: enriched?.threadRootId ?? null,
    is_note: enriched?.isNote ?? isPossiblyTruncated(tweet.text),
    source: enriched ? "fxtwitter+nitter" : "nitter",
    captured_at: capturedAt ?? user?.capturedAt ?? new Date().toISOString(),
  }
}

function corpusTweetFromFxQuote(quote: FxQuote, parentRawJson: string, capturedAt: string): CorpusTweetInput | null {
  const id = fxTweetId(quote)
  const author = quote.author?.screen_name ? normalizeCorpusHandle(quote.author.screen_name) : null
  if (!id || !author) return null
  return {
    id,
    author,
    ts_utc: parseTweetTsUtc(timestampFromFx(quote), capturedAt),
    text: cleanText(quote.full_text ?? quote.text ?? ""),
    raw_json: JSON.stringify({ source: "fxtwitter_quote", parent_raw_json: parentRawJson, quote }),
    reply_to_id: null,
    quote_id: null,
    thread_root_id: null,
    is_note: false,
    source: "fxtwitter",
    captured_at: capturedAt,
  }
}

function authorInputFromArchiveUser(user: ArchiveUser, seenAt: string) {
  return {
    handle: normalizeCorpusHandle(user.username),
    user_id: user.id,
    display_name: user.displayName ?? null,
    seen_at: user.capturedAt ?? seenAt,
    last_synced: seenAt,
  }
}

function pageCutoffState(tweets: readonly CorpusTweetInput[], horizonUtc: string): { allOlderThanHorizon: boolean; oldestIsOlderThanHorizon: boolean } {
  if (tweets.length === 0) return { allOlderThanHorizon: false, oldestIsOlderThanHorizon: false }
  let allOlder = true
  let oldest = tweets[0]?.ts_utc ?? horizonUtc
  for (const tweet of tweets) {
    if (tweet.ts_utc >= horizonUtc) allOlder = false
    if (tweet.ts_utc < oldest) oldest = tweet.ts_utc
  }
  return { allOlderThanHorizon: allOlder, oldestIsOlderThanHorizon: oldest < horizonUtc }
}

function buildNitterTimelineUrl(baseUrl: string, handle: string, cursor: string | undefined): string {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}/${encodeURIComponent(handle)}`)
  if (cursor) url.searchParams.set("cursor", cursor)
  return url.toString()
}

function decodeCacheEntry(text: string): CacheEntry {
  return Schema.decodeUnknownSync(Schema.fromJsonString(CacheEntrySchema))(text)
}

function decodeFxResponse(text: string): FxResponse | null {
  try {
    return Schema.decodeUnknownSync(Schema.fromJsonString(FxResponseSchema))(text)
  } catch {
    return null
  }
}

function responseHeadersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

function randomInt(minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(Math.random() * (maxInclusive - minInclusive + 1))
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "")
}

function normalizeCorpusHandle(handle: string): string {
  return normalizeNitterUsername(handle).toLowerCase()
}

function clampMaxPages(maxPages: number): number {
  if (!Number.isFinite(maxPages) || maxPages < 1) return 1
  return Math.min(Math.floor(maxPages), NITTER_HARD_MAX_PAGES)
}

function normalizeHorizon(horizon: string): string {
  const date = new Date(horizon)
  return Number.isNaN(date.getTime()) ? CORPUS_HORIZON_UTC : date.toISOString()
}

function parseTweetTsUtc(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback
  const direct = new Date(raw)
  if (!Number.isNaN(direct.getTime())) return direct.toISOString()
  const compact = raw.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/)
  if (compact) {
    const parsed = new Date(`${compact[1]} ${compact[2]} ${compact[3]} ${compact[4]}:${compact[5]}:${compact[6]} UTC`)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  const comma = raw.match(/(\w{3})\s+(\d{1,2}),\s+(\d{4}).*?(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (comma) {
    const parsed = new Date(`${comma[1]} ${comma[2]} ${comma[3]} ${comma[4]}:${comma[5]} ${comma[6]} UTC`)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return fallback
}

function cleanText(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim()
}

function isPossiblyTruncated(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.endsWith("…") || trimmed.endsWith("...")
}

function timestampFromFx(tweet: FxTweet | FxQuote): string | undefined {
  if (tweet.created_timestamp !== undefined && tweet.created_timestamp !== null) {
    return new Date(tweet.created_timestamp * 1000).toISOString()
  }
  return tweet.created_at ?? undefined
}

function fxTweetId(tweet: FxTweet | FxQuote): string | null {
  return tweet.id_str ?? tweet.id ?? null
}

function dedupeTweets(tweets: readonly CorpusTweetInput[]): CorpusTweetInput[] {
  const byId = new Map<string, CorpusTweetInput>()
  for (const tweet of tweets) {
    if (!byId.has(tweet.id)) byId.set(tweet.id, tweet)
  }
  return Array.from(byId.values())
}

function minSnowflake(current: string | null, candidate: string): string {
  if (current === null) return candidate
  return compareSnowflake(candidate, current) < 0 ? candidate : current
}

function maxSnowflake(current: string | null, candidate: string): string {
  if (current === null) return candidate
  return compareSnowflake(candidate, current) > 0 ? candidate : current
}

function compareSnowflake(left: string, right: string): number {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  if (leftValue < rightValue) return -1
  if (leftValue > rightValue) return 1
  return 0
}
