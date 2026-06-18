import {
  initTwitterArchiveSqliteStore,
  type SqliteTweetQuoteStatus,
  type TwitterArchiveSqliteCounts,
  type TwitterArchiveSqliteStore,
} from "./sqlite-store"
import type { ArchiveMedia, ArchiveMediaType, ArchivePublicMetrics, ArchiveTweet, ArchiveUser } from "./schema"

export const NITTER_DEFAULT_BASE_URL = "https://nitter.tiekoetter.com"
export const NITTER_DEFAULT_MAX_PAGES = 1
export const NITTER_HARD_MAX_PAGES = 25

export interface NitterCursorInfo {
  cursor: string
  url: string
}

export interface NitterTimelineItemInfo {
  tweetId: string
  retweetedByUsername?: string
  retweetedByDisplayName?: string
  needsDetailResolution?: boolean
  detailUrl?: string
}

export interface ParsedNitterTimelinePage {
  users: ArchiveUser[]
  tweets: ArchiveTweet[]
  media: ArchiveMedia[]
  timeline: NitterTimelineItemInfo[]
  nextCursor?: NitterCursorInfo
  capturedAt: string
}

export interface ParseNitterTimelineOptions {
  baseUrl?: string
  targetUsername?: string
  capturedAt?: string
}

export interface NitterFetchRequestInit {
  headers?: Record<string, string>
  signal?: AbortSignal
}

export interface NitterFetchResponseLike {
  ok: boolean
  status: number
  url?: string
  headers?: {
    get(name: string): string | null
  }
  text(): Promise<string>
}

export type NitterFetchFunction = (url: string, init: NitterFetchRequestInit) => Promise<NitterFetchResponseLike>

export type NitterStopReason = "max-pages" | "no-cursor" | "non-2xx" | "rate-limited" | "challenge" | "policy"

export interface NitterResponseClassification {
  ok: boolean
  status: number
  reason?: NitterStopReason
}

export interface FetchNitterTimelineOptions extends ParseNitterTimelineOptions {
  fetchFn?: NitterFetchFunction
  maxPages?: number
  startCursor?: string
  delayMs?: number
  jitterMs?: number
  signal?: AbortSignal
}

export interface FetchedNitterTimeline {
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

export interface CaptureNitterTimelineToSqliteOptions extends FetchNitterTimelineOptions {
  dbPath?: string
  store?: TwitterArchiveSqliteStore
}

export interface CapturedNitterEntityUpserts {
  users: number
  tweets: number
  media: number
}

export interface CapturedNitterTimelineToSqlite extends FetchedNitterTimeline {
  dbPath?: string
  counts: TwitterArchiveSqliteCounts
  rawPagesCached: number
  entityUpserts: CapturedNitterEntityUpserts
}

export type NitterTweetReference = string | ArchiveTweet | NitterTimelineItemInfo | { tweetId: string; username?: string; url?: string }

export type NitterThreadItemRole = "context" | "primary"

export type NitterDetailParseStatus = "parsed" | "partial" | "failed"

export interface NitterThreadItemInfo {
  tweetId: string
  role: NitterThreadItemRole
}

export interface NitterQuotedTweetCard {
  tweetId?: string
  username?: string
  url?: string
  text?: string
  unavailable?: boolean
}

export interface ParsedNitterTweetDetailPage {
  users: ArchiveUser[]
  tweets: ArchiveTweet[]
  media: ArchiveMedia[]
  thread: NitterThreadItemInfo[]
  primaryTweet?: ArchiveTweet
  quotedTweet?: ArchiveTweet
  quote?: NitterQuotedTweetCard
  parseStatus: NitterDetailParseStatus
  capturedAt: string
}

export interface FetchNitterTweetDetailOptions extends ParseNitterTimelineOptions {
  fetchFn?: NitterFetchFunction
  signal?: AbortSignal
}

export interface FetchedNitterTweetDetail {
  reference: { tweetId: string; username?: string; url?: string }
  url: string
  status: number
  stopReason?: NitterStopReason
  parsed?: ParsedNitterTweetDetailPage
}

export interface ResolveNitterTweetDetailsOptions extends FetchNitterTweetDetailOptions {
  dbPath?: string
  store?: TwitterArchiveSqliteStore
  maxTweets?: number
  delayMs?: number
  jitterMs?: number
}

export interface ResolvedNitterTweetDetails {
  details: FetchedNitterTweetDetail[]
  requestedMaxTweets: number
  maxTweets: number
  rawPagesCached: number
  entityUpserts: CapturedNitterEntityUpserts
}

interface HtmlElement {
  tag: string
  openTag: string
  inner: string
  raw: string
  start: number
  end: number
}

interface ParsedNitterTimelineItem {
  user: ArchiveUser
  tweet: ArchiveTweet
  media: ArchiveMedia[]
  timeline: NitterTimelineItemInfo
  quotedUser?: ArchiveUser
  quotedTweet?: ArchiveTweet
  quotedMedia: ArchiveMedia[]
}

const CLASS_TAGS = ["article", "section", "div", "span", "a", "p"] as const

export function normalizeNitterUsername(username: string): string {
  return username.trim().replace(/^@+/, "")
}

export function nitterUsernameKey(username: string): string {
  return normalizeNitterUsername(username).toLowerCase()
}

export function canonicalXProfileUrl(username: string): string {
  return `https://x.com/${encodeURIComponent(normalizeNitterUsername(username))}`
}

export function canonicalXTweetUrl(username: string, tweetId: string): string {
  return `${canonicalXProfileUrl(username)}/status/${tweetId}`
}

export function parseNitterTimelinePage(html: string, options: ParseNitterTimelineOptions = {}): ParsedNitterTimelinePage {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? NITTER_DEFAULT_BASE_URL)
  const capturedAt = options.capturedAt ?? new Date().toISOString()
  const users = new Map<string, ArchiveUser>()
  const tweets = new Map<string, ArchiveTweet>()
  const media = new Map<string, ArchiveMedia>()
  const timeline: NitterTimelineItemInfo[] = []

  const profileUser = parseProfileUser(html, baseUrl, options.targetUsername, capturedAt)
  if (profileUser) {
    upsertUser(users, profileUser)
  }

  for (const item of extractElementsByClass(html, "timeline-item", ["div", "article"])) {
    const parsed = parseTimelineItem(item.raw, baseUrl, options.targetUsername, capturedAt)
    if (!parsed) {
      continue
    }

    upsertUser(users, parsed.user)
    if (parsed.quotedUser) {
      upsertUser(users, parsed.quotedUser)
    }
    tweets.set(parsed.tweet.id, parsed.tweet)
    if (parsed.quotedTweet) {
      tweets.set(parsed.quotedTweet.id, parsed.quotedTweet)
    }
    for (const entry of [...parsed.media, ...parsed.quotedMedia]) {
      media.set(entry.id, entry)
    }
    timeline.push(parsed.timeline)
  }

  return {
    users: Array.from(users.values()),
    tweets: Array.from(tweets.values()),
    media: Array.from(media.values()),
    timeline,
    nextCursor: parseNextCursor(html, baseUrl),
    capturedAt,
  }
}

export async function fetchNitterTimeline(
  username: string,
  options: FetchNitterTimelineOptions = {},
): Promise<FetchedNitterTimeline> {
  const requestedMaxPages = options.maxPages ?? NITTER_DEFAULT_MAX_PAGES
  const maxPages = clampPageCount(requestedMaxPages)
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? NITTER_DEFAULT_BASE_URL)
  const fetchFn = options.fetchFn ?? defaultFetch
  const users = new Map<string, ArchiveUser>()
  const tweets = new Map<string, ArchiveTweet>()
  const media = new Map<string, ArchiveMedia>()
  const timeline: NitterTimelineItemInfo[] = []
  const pages: ParsedNitterTimelinePage[] = []
  let cursor: string | undefined = options.startCursor
  let nextCursor: NitterCursorInfo | undefined
  let stopReason: NitterStopReason = "max-pages"

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const url = buildNitterTimelineUrl(baseUrl, username, cursor)
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
      targetUsername: username,
      capturedAt: options.capturedAt,
    })
    pages.push(parsed)
    for (const user of parsed.users) {
      upsertUser(users, user)
    }
    for (const tweet of parsed.tweets) {
      tweets.set(tweet.id, tweet)
    }
    for (const entry of parsed.media) {
      media.set(entry.id, entry)
    }
    timeline.push(...parsed.timeline)
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

export async function captureNitterTimelineToSqlite(
  username: string,
  options: CaptureNitterTimelineToSqliteOptions = {},
): Promise<CapturedNitterTimelineToSqlite> {
  let sqliteStore: TwitterArchiveSqliteStore
  let closeStore = false
  if (options.store) {
    sqliteStore = options.store
  } else {
    const dbPath = options.dbPath
    if (!dbPath) {
      throw new Error("captureNitterTimelineToSqlite requires dbPath or store")
    }
    sqliteStore = initTwitterArchiveSqliteStore(dbPath)
    closeStore = true
  }

  const requestedMaxPages = options.maxPages ?? NITTER_DEFAULT_MAX_PAGES
  const maxPages = clampPageCount(requestedMaxPages)
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? NITTER_DEFAULT_BASE_URL)
  const fetchFn = options.fetchFn ?? defaultFetch
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
      const url = buildNitterTimelineUrl(baseUrl, username, cursor)
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
        source: "nitter",
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
        sqliteStore.updateRawPageParseStatus("nitter", url, cachedPage.requestHash, "failed")
        stopReason = classification.reason ?? "non-2xx"
        break
      }

      const parsed = parseNitterTimelinePage(body, {
        baseUrl,
        targetUsername: username,
        capturedAt: options.capturedAt,
      })
      sqliteStore.updateRawPageParseStatus("nitter", url, cachedPage.requestHash, "parsed")
      pages.push(parsed)
      const userUpserts = sqliteStore.upsertUsers(parsed.users)
      const tweetUpserts = sqliteStore.upsertTweets(parsed.tweets)
      const mediaUpserts = sqliteStore.upsertMedia(parsed.media)
      sqliteStore.upsertTweetTimelineProvenance(
        parsed.timeline.map((item) => ({
          tweetId: item.tweetId,
          sourceLane: "nitter",
          observedAt: parsed.capturedAt,
          retweetedByUsername: item.retweetedByUsername,
          retweetedByDisplayName: item.retweetedByDisplayName,
          detailUrl: item.detailUrl,
        })),
      )
      entityUpserts.users += userUpserts.upserted
      entityUpserts.tweets += tweetUpserts.upserted
      entityUpserts.media += mediaUpserts.upserted
      markResolvedQuotedTweets(sqliteStore, parsed.tweets)
      for (const item of parsed.timeline) {
        if (item.needsDetailResolution) {
          sqliteStore.setTweetAttribute({ tweetId: item.tweetId, key: "nitter:detail", value: "pending" })
          sqliteStore.updateTweetResolutionStatus(item.tweetId, { threadStatus: "pending" })
        }
      }
      for (const user of parsed.users) {
        upsertUser(users, user)
      }
      for (const tweet of parsed.tweets) {
        tweets.set(tweet.id, tweet)
      }
      for (const entry of parsed.media) {
        media.set(entry.id, entry)
      }
      timeline.push(...parsed.timeline)
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

export function parseNitterTweetDetailPage(html: string, options: ParseNitterTimelineOptions & { tweetId?: string } = {}): ParsedNitterTweetDetailPage {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? NITTER_DEFAULT_BASE_URL)
  const capturedAt = options.capturedAt ?? new Date().toISOString()
  const users = new Map<string, ArchiveUser>()
  const tweets = new Map<string, ArchiveTweet>()
  const media = new Map<string, ArchiveMedia>()
  const threadRoles = new Map<string, NitterThreadItemRole>()
  const expectedTweetId = options.tweetId
  let primaryTweetId: string | undefined
  let primaryHtml: string | undefined

  const candidates: Array<{ raw: string; role: NitterThreadItemRole; start: number }> = []
  for (const main of extractElementsByClass(html, "main-tweet", ["div", "article"])) {
    candidates.push({ raw: main.raw, role: "primary", start: main.start })
  }
  for (const item of extractElementsByClass(html, "timeline-item", ["div", "article"])) {
    candidates.push({ raw: item.raw, role: "context", start: item.start })
  }
  candidates.sort((left, right) => left.start - right.start)

  for (const candidate of candidates) {
    const parsed = parseTimelineItem(candidate.raw, baseUrl, options.targetUsername, capturedAt)
    if (!parsed) {
      continue
    }
    upsertUser(users, parsed.user)
    if (parsed.quotedUser) {
      upsertUser(users, parsed.quotedUser)
    }
    for (const entry of [...parsed.media, ...parsed.quotedMedia]) {
      media.set(entry.id, entry)
    }
    if (parsed.quotedTweet) {
      const existingQuotedTweet = tweets.get(parsed.quotedTweet.id)
      tweets.set(parsed.quotedTweet.id, existingQuotedTweet ? mergeParsedTweet(existingQuotedTweet, parsed.quotedTweet) : parsed.quotedTweet)
    }

    const isPrimary = candidate.role === "primary" || parsed.tweet.id === expectedTweetId
    const role: NitterThreadItemRole = isPrimary ? "primary" : "context"
    const existingTweet = tweets.get(parsed.tweet.id)
    tweets.set(parsed.tweet.id, existingTweet ? mergeParsedTweet(existingTweet, parsed.tweet) : parsed.tweet)
    threadRoles.set(parsed.tweet.id, role === "primary" ? "primary" : (threadRoles.get(parsed.tweet.id) ?? "context"))
    if (isPrimary) {
      primaryTweetId = parsed.tweet.id
      primaryHtml = candidate.raw
    }
  }

  primaryTweetId ??= expectedTweetId && tweets.has(expectedTweetId) ? expectedTweetId : undefined
  primaryTweetId ??= candidates.length > 0 ? Array.from(threadRoles.entries()).find(([, role]) => role === "primary")?.[0] : undefined
  primaryTweetId ??= threadRoles.size === 1 ? Array.from(threadRoles.keys())[0] : undefined

  if (primaryTweetId) {
    const conversationId = primaryTweetId
    for (const tweetId of threadRoles.keys()) {
      const tweet = tweets.get(tweetId)
      if (tweet) {
        tweets.set(tweetId, pruneUndefined({ ...tweet, conversationId }))
      }
    }
  }

  const primaryTweet = primaryTweetId ? tweets.get(primaryTweetId) : undefined
  const quote = parseQuotedTweetCard(primaryHtml ?? html, baseUrl, capturedAt, primaryTweet?.id)
  let quotedTweet: ArchiveTweet | undefined
  if (quote?.user) {
    upsertUser(users, quote.user)
  }
  if (quote?.tweet) {
    quotedTweet = quote.tweet
    const existingQuotedTweet = tweets.get(quotedTweet.id)
    tweets.set(quotedTweet.id, existingQuotedTweet ? mergeParsedTweet(existingQuotedTweet, quotedTweet) : quotedTweet)
  }
  if (quote?.media) {
    for (const entry of quote.media) {
      media.set(entry.id, entry)
    }
  }

  return {
    users: Array.from(users.values()),
    tweets: Array.from(tweets.values()),
    media: Array.from(media.values()),
    thread: Array.from(threadRoles.entries()).map(([tweetId, role]) => ({ tweetId, role })),
    primaryTweet,
    quotedTweet,
    quote: quote?.card,
    parseStatus: primaryTweet ? "parsed" : threadRoles.size > 0 ? "partial" : "failed",
    capturedAt,
  }
}

export async function fetchNitterTweetDetail(
  reference: NitterTweetReference,
  options: FetchNitterTweetDetailOptions = {},
): Promise<FetchedNitterTweetDetail> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? NITTER_DEFAULT_BASE_URL)
  const resolved = resolveTweetReference(reference, undefined, options.targetUsername)
  if (!resolved.username) {
    throw new Error(`Cannot build Nitter status URL without a username for tweet ${resolved.tweetId}`)
  }

  const url = buildNitterStatusUrl(baseUrl, resolved.username, resolved.tweetId)
  const response = await (options.fetchFn ?? defaultFetch)(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
    },
    signal: options.signal,
  })
  const body = await response.text()
  const classification = classifyNitterResponse(response.status, body)
  if (!classification.ok) {
    return { reference: resolved, url, status: response.status, stopReason: classification.reason ?? "non-2xx" }
  }

  return {
    reference: resolved,
    url,
    status: response.status,
    parsed: parseNitterTweetDetailPage(body, {
      baseUrl,
      targetUsername: resolved.username,
      tweetId: resolved.tweetId,
      capturedAt: options.capturedAt,
    }),
  }
}

export async function resolveNitterTweetDetails(
  references: readonly NitterTweetReference[],
  options: ResolveNitterTweetDetailsOptions = {},
): Promise<ResolvedNitterTweetDetails> {
  const requestedMaxTweets = options.maxTweets ?? 10
  const maxTweets = clampResolveCount(requestedMaxTweets)
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? NITTER_DEFAULT_BASE_URL)
  const fetchFn = options.fetchFn ?? defaultFetch
  const details: FetchedNitterTweetDetail[] = []
  const entityUpserts: CapturedNitterEntityUpserts = { users: 0, tweets: 0, media: 0 }
  let rawPagesCached = 0
  let sqliteStore: TwitterArchiveSqliteStore | undefined = options.store
  let closeStore = false
  if (!sqliteStore && options.dbPath) {
    sqliteStore = initTwitterArchiveSqliteStore(options.dbPath)
    closeStore = true
  }

  try {
    for (let index = 0; index < Math.min(references.length, maxTweets); index += 1) {
      const resolved = resolveTweetReference(references[index], sqliteStore, options.targetUsername)
      if (!resolved.username) {
        details.push({ reference: resolved, url: resolved.url ?? "", status: 0, stopReason: "policy" })
        continue
      }

      const url = buildNitterStatusUrl(baseUrl, resolved.username, resolved.tweetId)
      const response = await fetchFn(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
        },
        signal: options.signal,
      })
      const body = await response.text()
      const contentType = response.headers?.get("content-type") ?? undefined
      const cachedPage = sqliteStore?.cacheRawPage({
        source: "nitter",
        url,
        body,
        fetchedAt: new Date().toISOString(),
        statusCode: response.status,
        contentType,
        headers: contentType ? { "content-type": contentType } : undefined,
      })
      if (cachedPage) {
        rawPagesCached += 1
      }

      const classification = classifyNitterResponse(response.status, body)
      if (!classification.ok) {
        if (sqliteStore) {
          if (cachedPage) {
            sqliteStore.updateRawPageParseStatus("nitter", url, cachedPage.requestHash, "failed")
          }
          sqliteStore.updateTweetResolutionStatus(resolved.tweetId, { threadStatus: "partial" })
        }
        details.push({ reference: resolved, url, status: response.status, stopReason: classification.reason ?? "non-2xx" })
        continue
      }

      const parsed = parseNitterTweetDetailPage(body, {
        baseUrl,
        targetUsername: resolved.username,
        tweetId: resolved.tweetId,
        capturedAt: options.capturedAt,
      })
      if (sqliteStore && cachedPage) {
        sqliteStore.updateRawPageParseStatus("nitter", url, cachedPage.requestHash, parsed.parseStatus === "failed" ? "failed" : "parsed")
      }
      if (sqliteStore) {
        const userUpserts = sqliteStore.upsertUsers(parsed.users)
        const tweetUpserts = sqliteStore.upsertTweets(parsed.tweets)
        const mediaUpserts = sqliteStore.upsertMedia(parsed.media)
        entityUpserts.users += userUpserts.upserted
        entityUpserts.tweets += tweetUpserts.upserted
        entityUpserts.media += mediaUpserts.upserted
        markResolvedQuotedTweets(sqliteStore, parsed.tweets)
        const quoteResolution = quoteResolutionForParsedDetail(parsed, sqliteStore)
        sqliteStore.updateTweetResolutionStatus(resolved.tweetId, {
          threadStatus: parsed.parseStatus === "parsed" ? "complete" : "partial",
          quoteStatus: quoteResolution.quoteStatus,
          quoteUnavailableReason: quoteResolution.quoteUnavailableReason,
        })
        sqliteStore.setTweetAttribute({
          tweetId: resolved.tweetId,
          key: "nitter:detail",
          value: parsed.parseStatus === "parsed" ? "resolved" : parsed.parseStatus,
        })
      }

      details.push({ reference: resolved, url, status: response.status, parsed })
      if (index + 1 < Math.min(references.length, maxTweets)) {
        await delayBeforeNextPage(options.delayMs, options.jitterMs)
      }
    }

    return { details, requestedMaxTweets, maxTweets, rawPagesCached, entityUpserts }
  } finally {
    if (closeStore) {
      sqliteStore?.close()
    }
  }
}

export function classifyNitterResponse(status: number, body: string): NitterResponseClassification {
  const lowerBody = body.toLowerCase()
  if (status === 429 || lowerBody.includes("rate limited") || lowerBody.includes("too many requests")) {
    return { ok: false, status, reason: "rate-limited" }
  }
  if (
    lowerBody.includes("captcha") ||
    lowerBody.includes("cloudflare") ||
    lowerBody.includes("ddos-guard") ||
    lowerBody.includes("verify you are human")
  ) {
    return { ok: false, status, reason: "challenge" }
  }
  if (lowerBody.includes("robots.txt") || lowerBody.includes("policy violation") || lowerBody.includes("not allowed")) {
    return { ok: false, status, reason: "policy" }
  }
  if (status < 200 || status > 299) {
    return { ok: false, status, reason: "non-2xx" }
  }

  return { ok: true, status }
}

function parseProfileUser(
  html: string,
  baseUrl: string,
  targetUsername: string | undefined,
  capturedAt: string,
): ArchiveUser | undefined {
  const profile = extractFirstElementByClass(html, "profile-card")
  if (!profile) {
    return targetUsername
      ? {
          id: nitterUsernameKey(targetUsername),
          username: normalizeNitterUsername(targetUsername),
          profileUrl: canonicalXProfileUrl(targetUsername),
          capturedAt,
        }
      : undefined
  }

  const username = readUsername(profile.raw) ?? (targetUsername ? normalizeNitterUsername(targetUsername) : undefined)
  if (!username) {
    return undefined
  }

  const displayName = readFirstText(profile.raw, ["profile-card-fullname", "fullname"])
  const description = readFirstText(profile.raw, ["profile-bio", "profile-card-bio"])
  const avatarUrl = readImageUrlFromClass(profile.raw, ["profile-card-avatar"], baseUrl)
  const protectedProfile = /\bprotected\b/i.test(profile.raw)

  return pruneUndefined({
    id: nitterUsernameKey(username),
    username,
    displayName,
    avatarUrl,
    profileUrl: canonicalXProfileUrl(username),
    description,
    verified: /\bverified\b|icon-ok/i.test(profile.raw) ? true : undefined,
    protected: protectedProfile ? true : undefined,
    capturedAt,
  })
}

function parseTimelineItem(
  html: string,
  baseUrl: string,
  targetUsername: string | undefined,
  capturedAt: string,
): ParsedNitterTimelineItem | undefined {
  const tweetId = readTweetId(html)
  const username = readUsername(html)
  if (!tweetId || !username) {
    return undefined
  }

  const displayName = readFirstText(html, ["fullname"])
  const avatarUrl = readImageUrlFromClass(html, ["tweet-avatar"], baseUrl)
  const user: ArchiveUser = pruneUndefined({
    id: nitterUsernameKey(username),
    username,
    displayName,
    avatarUrl,
    profileUrl: canonicalXProfileUrl(username),
    capturedAt,
  })

  const quote = parseQuotedTweetCard(html, baseUrl, capturedAt, tweetId)
  const tweetMedia = parseTweetMedia(stripQuotedTweetCards(html), tweetId, baseUrl, capturedAt)
  const quotedTweet = readQuotedTweetReference(html, baseUrl, tweetId) ?? quoteReferenceFromCard(quote?.card)
  const needsDetailResolution = hasTruncatedTimelineText(html, tweetId)
  const tweet: ArchiveTweet = pruneUndefined({
    id: tweetId,
    authorId: user.id,
    username,
    url: canonicalXTweetUrl(username, tweetId),
    text: readFirstText(html, ["tweet-content"]) ?? "",
    createdAt: readCreatedAt(html),
    replyToUsername: readReplyToUsername(html),
    quotedTweetId: quotedTweet?.quotedTweetId,
    quotedTweetUrl: quotedTweet?.quotedTweetUrl,
    mediaIds: tweetMedia.map((entry) => entry.id),
    publicMetrics: parsePublicMetrics(html),
    capturedAt,
    source: "frontend" as const,
  })

  const retweet = parseRetweetMarker(html, targetUsername)
  return {
    user,
    tweet,
    media: tweetMedia,
    quotedUser: quote?.user,
    quotedTweet: quote?.tweet,
    quotedMedia: quote?.media ?? [],
    timeline: pruneUndefined({
      tweetId,
      retweetedByUsername: retweet?.username,
      retweetedByDisplayName: retweet?.displayName,
      needsDetailResolution,
      detailUrl: needsDetailResolution ? canonicalXTweetUrl(username, tweetId) : undefined,
    }),
  }
}

function parseRetweetMarker(
  html: string,
  targetUsername: string | undefined,
): { username?: string; displayName?: string } | undefined {
  const marker = extractFirstElementByClass(html, "retweet-header")
  if (!marker) {
    return undefined
  }

  const text = textFromHtml(marker.inner).replace(/\s+/g, " ").trim()
  const displayName = text.replace(/\s+retweeted\b.*$/i, "").trim()
  if (!displayName) {
    return undefined
  }

  const markerUsername = displayName.startsWith("@") ? normalizeNitterUsername(displayName) : undefined
  return pruneUndefined({
    username: markerUsername ?? (targetUsername ? normalizeNitterUsername(targetUsername) : undefined),
    displayName,
  })
}

function parseTweetMedia(html: string, tweetId: string, baseUrl: string, capturedAt: string): ArchiveMedia[] {
  const attachments = extractFirstElementByClass(html, "attachments")
  if (!attachments) {
    return []
  }

  const mediaRoots = extractElementsByClass(attachments.raw, "attachment", ["div"])
  const roots = mediaRoots.length > 0 ? mediaRoots.map((root) => root.raw) : [attachments.raw]
  const seen = new Set<string>()
  const media: ArchiveMedia[] = []

  for (const root of roots) {
    const type = mediaTypeFromHtml(root)
    const video = firstOpeningTag(root, "video")
    const img = firstOpeningTag(root, "img")
    const link = extractFirstElementByClass(root, "still-image", ["a"])
    const href = link ? attributeValue(link.openTag, "href") : undefined
    const videoSrc = video ? attributeValue(video, "src") : undefined
    const poster = video ? attributeValue(video, "poster") : undefined
    const imgSrc = img ? attributeValue(img, "src") : undefined
    const rawRemoteUrl = videoSrc ?? href ?? imgSrc
    const remoteUrl = rawRemoteUrl ? absolutizeNitterUrl(decodeHtml(rawRemoteUrl), baseUrl) : undefined
    const previewImageUrl = poster ?? imgSrc
    const absolutePreviewUrl = previewImageUrl ? absolutizeNitterUrl(decodeHtml(previewImageUrl), baseUrl) : undefined
    if (!remoteUrl || seen.has(remoteUrl)) {
      continue
    }

    seen.add(remoteUrl)
    const altText = img ? attributeValue(img, "alt") : undefined
    const id = `${tweetId}-media-${media.length + 1}`
    media.push(
      pruneUndefined({
        id,
        tweetId,
        type,
        remoteUrl,
        previewImageUrl: absolutePreviewUrl,
        altText: altText ? decodeHtml(altText).trim() : undefined,
        variants: videoSrc ? [{ url: remoteUrl }] : undefined,
        capturedAt,
        source: "frontend" as const,
      }),
    )
  }

  return media
}

function parseQuotedTweetCard(
  html: string,
  baseUrl: string,
  capturedAt: string,
  currentTweetId: string | undefined,
): { user?: ArchiveUser; tweet?: ArchiveTweet; media: ArchiveMedia[]; card: NitterQuotedTweetCard } | undefined {
  const roots = [...extractElementsByClass(html, "quote", ["div"]), ...extractElementsByClass(html, "quote-big", ["div"])]
  for (const root of roots) {
    const link = extractFirstElementByClass(root.raw, "quote-link", ["a"])
    const href = link ? attributeValue(link.openTag, "href") : extractOpeningTags(root.raw, "a").map((tag) => attributeValue(tag, "href")).find(Boolean)
    const parsedHref = href ? parseTweetHref(href) : undefined
    const text = readFirstText(root.raw, ["quote-text", "tweet-content"])
    const unavailable = /unavailable|deleted|not found|protected/i.test(textFromHtml(root.raw))
    if (!parsedHref && !unavailable) {
      continue
    }
    if (parsedHref?.tweetId === currentTweetId) {
      continue
    }

    const username = readUsername(root.raw) ?? parsedHref?.username
    const displayName = readFirstText(root.raw, ["fullname", "quote-fullname"])
    const user: ArchiveUser | undefined = username
      ? pruneUndefined({
          id: nitterUsernameKey(username),
          username,
          displayName,
          profileUrl: canonicalXProfileUrl(username),
          capturedAt,
        })
      : undefined
    const quoteMedia = parsedHref ? parseTweetMedia(root.raw, parsedHref.tweetId, baseUrl, capturedAt) : []
    const tweet: ArchiveTweet | undefined =
      parsedHref && username && text
        ? pruneUndefined({
            id: parsedHref.tweetId,
            authorId: nitterUsernameKey(username),
            username,
            url: canonicalXTweetUrl(username, parsedHref.tweetId),
            text,
            mediaIds: quoteMedia.map((entry) => entry.id),
            capturedAt,
            source: "frontend" as const,
          })
        : undefined

    return {
      user,
      tweet,
      media: quoteMedia,
      card: pruneUndefined({
        tweetId: parsedHref?.tweetId,
        username,
        url: parsedHref
          ? parsedHref.username
            ? canonicalXTweetUrl(parsedHref.username, parsedHref.tweetId)
            : href
              ? absolutizeNitterUrl(href, baseUrl)
              : undefined
          : undefined,
        text,
        unavailable,
      }),
    }
  }

  return undefined
}

function quoteReferenceFromCard(card: NitterQuotedTweetCard | undefined): { quotedTweetId?: string; quotedTweetUrl?: string } | undefined {
  if (!card?.tweetId && !card?.url) {
    return undefined
  }
  return pruneUndefined({
    quotedTweetId: card.tweetId,
    quotedTweetUrl: card.url,
  })
}

function stripQuotedTweetCards(html: string): string {
  const uniqueRanges = new Map<string, HtmlElement>()
  for (const element of [...extractElementsByClass(html, "quote", ["div"]), ...extractElementsByClass(html, "quote-big", ["div"])]) {
    uniqueRanges.set(`${element.start}:${element.end}`, element)
  }

  let stripped = html
  for (const element of Array.from(uniqueRanges.values()).sort((left, right) => right.start - left.start)) {
    stripped = `${stripped.slice(0, element.start)}${stripped.slice(element.end)}`
  }
  return stripped
}

function hasTruncatedTimelineText(html: string, tweetId: string): boolean {
  const tweetText = readFirstText(html, ["tweet-content"])
  if (tweetText && /(?:…|\.\.\.)\s*$/.test(tweetText)) {
    return true
  }
  for (const more of extractElementsByClass(html, "show-more", ["a", "div"])) {
    if (!/show more|read more|more/i.test(textFromHtml(more.raw))) {
      continue
    }
    if (more.raw.includes(`/status/${tweetId}`) || more.raw.includes(`/status/${tweetId}#`) || more.raw.includes(`/status/${tweetId}?`)) {
      return true
    }
  }
  return new RegExp(`/status(?:es)?/${escapeRegExp(tweetId)}[^"']*["'][^>]*>\\s*(show more|read more|more)`, "i").test(html)
}

function mergeParsedTweet(existing: ArchiveTweet, incoming: ArchiveTweet): ArchiveTweet {
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
    mediaIds: Array.from(new Set([...existing.mediaIds, ...incoming.mediaIds])),
    language: incoming.language ?? existing.language,
    publicMetrics: incoming.publicMetrics ?? existing.publicMetrics,
    source: incoming.source ?? existing.source,
  })
}

function quoteResolutionForParsedDetail(
  parsed: ParsedNitterTweetDetailPage,
  store: TwitterArchiveSqliteStore,
): { quoteStatus: SqliteTweetQuoteStatus; quoteUnavailableReason: string | null } {
  if (parsed.quote?.unavailable) {
    return { quoteStatus: "unavailable", quoteUnavailableReason: "quote unavailable on Nitter status page" }
  }
  if (!parsed.primaryTweet?.quotedTweetId && !parsed.primaryTweet?.quotedTweetUrl) {
    return { quoteStatus: "none", quoteUnavailableReason: null }
  }
  if (parsed.quotedTweet || quotedTweetContentExists(store, parsed.primaryTweet.quotedTweetId)) {
    return { quoteStatus: "resolved", quoteUnavailableReason: null }
  }
  return {
    quoteStatus: "pending",
    quoteUnavailableReason: "quoted tweet reference found without stored quoted content",
  }
}

function markResolvedQuotedTweets(store: TwitterArchiveSqliteStore, tweets: readonly ArchiveTweet[]): void {
  for (const tweet of tweets) {
    if (quotedTweetContentExists(store, tweet.quotedTweetId)) {
      store.updateTweetResolutionStatus(tweet.id, { quoteStatus: "resolved", quoteUnavailableReason: null })
    }
  }
}

function quotedTweetContentExists(store: TwitterArchiveSqliteStore, tweetId: string | undefined): boolean {
  if (!tweetId) {
    return false
  }
  const tweet = store.getTweet(tweetId)
  return tweet !== undefined && tweet.text.trim().length > 0
}


function parsePublicMetrics(html: string): ArchivePublicMetrics | undefined {
  const metrics: ArchivePublicMetrics = {}
  for (const stat of extractElementsByClass(html, "tweet-stat", ["span", "div"])) {
    const value = parseAbbreviatedNumber(textFromHtml(stat.inner))
    if (value === undefined) {
      continue
    }

    if (/icon-comment|icon-reply/i.test(stat.raw)) {
      metrics.replies = value
    } else if (/icon-retweet/i.test(stat.raw)) {
      metrics.reposts = value
    } else if (/icon-quote/i.test(stat.raw)) {
      metrics.quotes = value
    } else if (/icon-heart/i.test(stat.raw)) {
      metrics.likes = value
    } else if (/icon-eye|icon-chart|icon-play|icon-views/i.test(stat.raw)) {
      metrics.views = value
    }
  }

  return Object.keys(metrics).length > 0 ? metrics : undefined
}

function parseNextCursor(html: string, baseUrl: string): NitterCursorInfo | undefined {
  for (const more of extractElementsByClass(html, "show-more", ["div", "a"])) {
    const links = extractOpeningTags(more.raw, "a")
    for (const link of links) {
      const href = attributeValue(link, "href")
      if (!href || !href.includes("cursor=")) {
        continue
      }

      const absoluteUrl = absolutizeNitterUrl(decodeHtml(href), baseUrl)
      const cursor = readCursorFromUrl(absoluteUrl)
      if (cursor) {
        return { cursor, url: absoluteUrl }
      }
    }
  }

  const cursorHref = html.match(/href=["']([^"']*\?[^"']*cursor=[^"']+)["']/i)?.[1]
  if (!cursorHref) {
    return undefined
  }

  const absoluteUrl = absolutizeNitterUrl(decodeHtml(cursorHref), baseUrl)
  const cursor = readCursorFromUrl(absoluteUrl)
  return cursor ? { cursor, url: absoluteUrl } : undefined
}

function readCursorFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.searchParams.get("cursor") ?? undefined
  } catch {
    return undefined
  }
}

function readTweetId(html: string): string | undefined {
  const tweetLink = extractFirstElementByClass(html, "tweet-link", ["a"])
  const tweetLinkHref = tweetLink ? attributeValue(tweetLink.openTag, "href") : undefined
  const tweetDate = extractFirstElementByClass(html, "tweet-date", ["span", "div"])
  const dateHref = tweetDate ? extractOpeningTags(tweetDate.raw, "a").map((tag) => attributeValue(tag, "href")).find(Boolean) : undefined
  const href = tweetLinkHref ?? dateHref
  return href?.match(/\/status(?:es)?\/(\d+)/)?.[1] ?? html.match(/\/status(?:es)?\/(\d+)/)?.[1]
}

function readCreatedAt(html: string): string | undefined {
  const date = extractFirstElementByClass(html, "tweet-date", ["span", "div"])
  if (!date) {
    return undefined
  }

  const title = extractOpeningTags(date.raw, "a").map((tag) => attributeValue(tag, "title")).find(Boolean)
  return title ? decodeHtml(title).trim() : undefined
}

function readReplyToUsername(html: string): string | undefined {
  const reply = extractFirstElementByClass(html, "replying-to")
  if (!reply) {
    return undefined
  }

  const usernameText = textFromHtml(reply.inner).match(/@([A-Za-z0-9_]+)/)?.[1]
  return usernameText ? normalizeNitterUsername(usernameText) : undefined
}

function readQuotedTweetReference(
  html: string,
  baseUrl: string,
  currentTweetId: string,
): { quotedTweetId?: string; quotedTweetUrl?: string } | undefined {
  const quotedRegions = [
    ...extractElementsByClass(html, "quote", ["div"]),
    ...extractElementsByClass(html, "quote-big", ["div"]),
    ...extractElementsByClass(html, "quote-link", ["a"]),
    ...extractElementsByClass(html, "quote-text", ["a", "div"]),
  ]
  for (const region of quotedRegions) {
    const hrefs =
      region.tag === "a"
        ? [
            attributeValue(region.openTag, "href"),
            ...extractOpeningTags(region.inner, "a").map((tag) => attributeValue(tag, "href")),
          ]
        : extractOpeningTags(region.raw, "a").map((tag) => attributeValue(tag, "href"))
    for (const href of hrefs) {
      if (!href) {
        continue
      }
      const parsed = parseTweetHref(href)
      if (parsed && parsed.tweetId !== currentTweetId) {
        return pruneUndefined({
          quotedTweetId: parsed.tweetId,
          quotedTweetUrl: parsed.username ? canonicalXTweetUrl(parsed.username, parsed.tweetId) : absolutizeNitterUrl(href, baseUrl),
        })
      }
    }
  }

  return undefined
}

function parseTweetHref(href: string): { username?: string; tweetId: string } | undefined {
  const usernameMatch = href.match(/\/([^/?#]+)\/status(?:es)?\/(\d+)/)
  if (usernameMatch) {
    return {
      username: normalizeNitterUsername(decodeHtml(usernameMatch[1])),
      tweetId: usernameMatch[2],
    }
  }

  const statusMatch = href.match(/\/status(?:es)?\/(\d+)/)
  return statusMatch ? { tweetId: statusMatch[1] } : undefined
}

function resolveTweetReference(
  reference: NitterTweetReference,
  store: TwitterArchiveSqliteStore | undefined,
  fallbackUsername: string | undefined,
): { tweetId: string; username?: string; url?: string } {
  if (typeof reference === "string") {
    const parsed = parseTweetHref(reference)
    if (parsed) {
      return {
        tweetId: parsed.tweetId,
        username: parsed.username ?? normalizeReferenceUsername(fallbackUsername),
        url: /^https?:\/\//i.test(reference) ? reference : undefined,
      }
    }

    const storedTweet = /^\d+$/.test(reference) ? store?.getTweet(reference) : undefined
    return {
      tweetId: reference,
      username: storedTweet?.username ?? normalizeReferenceUsername(fallbackUsername),
      url: storedTweet?.url,
    }
  }

  const tweetId = "tweetId" in reference ? reference.tweetId : reference.id
  const storedTweet = store?.getTweet(tweetId)
  const url = "url" in reference ? reference.url : "detailUrl" in reference ? reference.detailUrl : storedTweet?.url
  const parsed = url ? parseTweetHref(url) : undefined
  const username = "username" in reference ? reference.username : undefined
  return {
    tweetId,
    username: username ?? parsed?.username ?? storedTweet?.username ?? normalizeReferenceUsername(fallbackUsername),
    url,
  }
}

function normalizeReferenceUsername(username: string | undefined): string | undefined {
  return username ? normalizeNitterUsername(username) : undefined
}

function readUsername(html: string): string | undefined {
  const usernameText = readFirstText(html, ["profile-card-username", "username"])
  if (usernameText) {
    const match = usernameText.match(/@?([A-Za-z0-9_]+)/)
    if (match) {
      return normalizeNitterUsername(match[1])
    }
  }

  const usernameLink = extractFirstElementByClass(html, "username", ["a"])
  const href = usernameLink ? attributeValue(usernameLink.openTag, "href") : undefined
  const hrefUsername = href?.match(/^\/?([A-Za-z0-9_]+)(?:$|[/?#])/)
  return hrefUsername ? normalizeNitterUsername(hrefUsername[1]) : undefined
}

function readFirstText(html: string, classNames: readonly string[]): string | undefined {
  for (const className of classNames) {
    const element = extractFirstElementByClass(html, className)
    if (!element) {
      continue
    }

    const text = textFromHtml(element.inner)
    if (text) {
      return text
    }
  }

  return undefined
}

function readImageUrlFromClass(html: string, classNames: readonly string[], baseUrl: string): string | undefined {
  for (const className of classNames) {
    const element = extractFirstElementByClass(html, className)
    if (!element) {
      continue
    }

    const img = firstOpeningTag(element.raw, "img")
    const src = img ? attributeValue(img, "src") : undefined
    if (src) {
      return absolutizeNitterUrl(decodeHtml(src), baseUrl)
    }
  }

  return undefined
}

function mediaTypeFromHtml(html: string): ArchiveMediaType {
  if (/\bgif\b/i.test(html)) {
    return "gif"
  }
  if (/<video\b|\bvideo\b/i.test(html)) {
    return "video"
  }
  return "image"
}

function buildNitterTimelineUrl(baseUrl: string, username: string, cursor: string | undefined): string {
  const url = new URL(`${baseUrl}/${encodeURIComponent(normalizeNitterUsername(username))}`)
  if (cursor) {
    url.searchParams.set("cursor", cursor)
  }
  return url.toString()
}

function buildNitterStatusUrl(baseUrl: string, username: string, tweetId: string): string {
  return new URL(`${baseUrl}/${encodeURIComponent(normalizeNitterUsername(username))}/status/${encodeURIComponent(tweetId)}`).toString()
}

function clampPageCount(maxPages: number): number {
  if (!Number.isFinite(maxPages) || maxPages < 1) {
    return 1
  }
  return Math.min(Math.floor(maxPages), NITTER_HARD_MAX_PAGES)
}

function clampResolveCount(maxTweets: number): number {
  if (!Number.isFinite(maxTweets) || maxTweets < 1) {
    return 1
  }
  return Math.min(Math.floor(maxTweets), 50)
}

async function defaultFetch(url: string, init: NitterFetchRequestInit): Promise<NitterFetchResponseLike> {
  return fetch(url, init)
}

async function delayBeforeNextPage(delayMs: number | undefined, jitterMs: number | undefined): Promise<void> {
  const baseDelay = Math.max(0, delayMs ?? 0)
  const jitter = Math.max(0, jitterMs ?? 0)
  const totalDelay = baseDelay + (jitter > 0 ? Math.floor(Math.random() * jitter) : 0)
  if (totalDelay === 0) {
    return
  }

  await new Promise<void>((resolve) => setTimeout(resolve, totalDelay))
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "")
}

function absolutizeNitterUrl(url: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url
  }
  return new URL(url, `${baseUrl}/`).toString()
}

function extractFirstElementByClass(
  html: string,
  className: string,
  tags: readonly string[] = CLASS_TAGS,
): HtmlElement | undefined {
  return extractElementsByClass(html, className, tags)[0]
}

function extractElementsByClass(html: string, className: string, tags: readonly string[] = CLASS_TAGS): HtmlElement[] {
  const elements: HtmlElement[] = []
  for (const tag of tags) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>`, "gi")
    let match = pattern.exec(html)
    while (match) {
      const classValue = attributeValue(match[0], "class")
      const classTokens = classValue?.split(/\s+/) ?? []
      if (!classTokens.includes(className)) {
        match = pattern.exec(html)
        continue
      }

      const end = findMatchingElementEnd(html, match.index, tag)
      if (end !== undefined) {
        const openTag = match[0]
        const openEnd = match.index + openTag.length
        elements.push({
          tag,
          openTag,
          inner: html.slice(openEnd, end - `</${tag}>`.length),
          raw: html.slice(match.index, end),
          start: match.index,
          end,
        })
      }
      match = pattern.exec(html)
    }
  }

  return elements.sort((left, right) => left.start - right.start)
}

function findMatchingElementEnd(html: string, start: number, tag: string): number | undefined {
  const pattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi")
  pattern.lastIndex = start
  let depth = 0
  let match = pattern.exec(html)
  while (match) {
    if (match[0].startsWith("</")) {
      depth -= 1
    } else if (!match[0].endsWith("/>")) {
      depth += 1
    }

    if (depth === 0) {
      return pattern.lastIndex
    }
    match = pattern.exec(html)
  }

  return undefined
}

function firstOpeningTag(html: string, tag: string): string | undefined {
  return extractOpeningTags(html, tag)[0]
}

function extractOpeningTags(html: string, tag: string): string[] {
  const tags: string[] = []
  const pattern = new RegExp(`<${tag}\\b[^>]*>`, "gi")
  let match = pattern.exec(html)
  while (match) {
    tags.push(match[0])
    match = pattern.exec(html)
  }
  return tags
}

function attributeValue(openTag: string, name: string): string | undefined {
  const pattern = new RegExp(`${escapeRegExp(name)}\\s*=\\s*(["'])(.*?)\\1`, "i")
  return openTag.match(pattern)?.[2]
}

function textFromHtml(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
  const decoded = decodeHtml(withBreaks.replace(/<[^>]+>/g, ""))
  return decoded
    .split("\n")
    .map((line) => line.replace(/[\t\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim()
}

function decodeHtml(value: string): string {
  const unescapedValue = value.replace(/\\u([0-9a-f]{4})/gi, (_sequence, code: string) =>
    String.fromCodePoint(Number.parseInt(code, 16)),
  )
  return unescapedValue.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
    const lowerCode = code.toLowerCase()
    if (lowerCode === "amp") {
      return "&"
    }
    if (lowerCode === "lt") {
      return "<"
    }
    if (lowerCode === "gt") {
      return ">"
    }
    if (lowerCode === "quot") {
      return '"'
    }
    if (lowerCode === "apos") {
      return "'"
    }
    if (lowerCode.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(lowerCode.slice(2), 16))
    }
    if (lowerCode.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(lowerCode.slice(1), 10))
    }
    return entity
  })
}

function parseAbbreviatedNumber(value: string): number | undefined {
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kmb])?/i)
  if (!match) {
    return undefined
  }

  const base = Number.parseFloat(match[1])
  const suffix = match[2]?.toLowerCase()
  if (suffix === "k") {
    return Math.round(base * 1_000)
  }
  if (suffix === "m") {
    return Math.round(base * 1_000_000)
  }
  if (suffix === "b") {
    return Math.round(base * 1_000_000_000)
  }
  return Math.round(base)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function upsertUser(users: Map<string, ArchiveUser>, user: ArchiveUser): void {
  const existing = users.get(user.id)
  if (!existing) {
    users.set(user.id, user)
    return
  }

  users.set(
    user.id,
    pruneUndefined({
      ...existing,
      ...user,
      displayName: existing.displayName ?? user.displayName,
      avatarUrl: existing.avatarUrl ?? user.avatarUrl,
      profileUrl: existing.profileUrl ?? user.profileUrl,
      description: existing.description ?? user.description,
      verified: existing.verified ?? user.verified,
      protected: existing.protected ?? user.protected,
      capturedAt: existing.capturedAt ?? user.capturedAt,
    }),
  )
}

function pruneUndefined<T extends object>(record: T): T {
  for (const key of Object.keys(record) as Array<keyof T>) {
    if (record[key] === undefined) {
      delete record[key]
    }
  }
  return record
}
