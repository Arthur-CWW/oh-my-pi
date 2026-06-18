import { initTwitterArchiveSqliteStore, type SqliteJsonRecord, type SqliteJsonValue, type SqliteSocialGraphAccountInput, type SqliteSocialGraphImportResult, type TwitterArchiveSqliteStore } from "./sqlite-store"
import {
  classifyNitterResponse,
  NITTER_DEFAULT_BASE_URL,
  NITTER_DEFAULT_MAX_PAGES,
  NITTER_HARD_MAX_PAGES,
  normalizeNitterUsername,
  type NitterFetchFunction,
  type NitterFetchRequestInit,
} from "./nitter"
import { nowIso, stableId } from "./normalize"

export const NITTER_FOLLOWING_SOURCE_LANE = "nitter-following"
export const EXPORT_FOLLOWING_SOURCE_LANE = "following-export"

export type SocialGraphAccount = SqliteSocialGraphAccountInput

export interface ParsedFollowingEdge {
  sourceAccount: SocialGraphAccount
  targetAccount: SocialGraphAccount
  relation: "following"
  sourceLane: string
  observedAt: string
  provenance: SqliteJsonRecord
}

export interface ParsedFollowingPage {
  sourceAccount: SocialGraphAccount
  targets: readonly SocialGraphAccount[]
  edges: readonly ParsedFollowingEdge[]
  nextPageUrl?: string
  observedAt: string
  sourceUrl: string
}

export interface FetchedFollowingPage extends ParsedFollowingPage {
  body: string
  status: number
}

export interface FetchNitterFollowingOptions {
  baseUrl?: string
  maxPages?: number
  fetch?: NitterFetchFunction
  observedAt?: string
  sourceLane?: string
  userAgent?: string
}

export interface FetchedNitterFollowing {
  sourceAccount: SocialGraphAccount
  targets: readonly SocialGraphAccount[]
  edges: readonly ParsedFollowingEdge[]
  pages: readonly FetchedFollowingPage[]
  observedAt: string
  stoppedReason: "max-pages" | "no-cursor" | "non-2xx" | "rate-limited" | "challenge" | "policy"
}

export interface CaptureNitterFollowingToSqliteOptions extends FetchNitterFollowingOptions {
  dbPath?: string
  store?: TwitterArchiveSqliteStore
  importBatchId?: string
  provenance?: SqliteJsonRecord
}

export interface CapturedNitterFollowingToSqlite extends FetchedNitterFollowing {
  importResult: SqliteSocialGraphImportResult
}

export interface ParseFollowingExportOptions {
  sourceAccount?: SocialGraphAccount
  sourceLane?: string
  observedAt?: string
  provenance?: SqliteJsonRecord
}

export function parseNitterFollowingPage(html: string, sourceUsername: string, options: { sourceUrl?: string; observedAt?: string; sourceLane?: string } = {}): ParsedFollowingPage {
  const observedAt = options.observedAt ?? nowIso()
  const sourceLane = options.sourceLane ?? NITTER_FOLLOWING_SOURCE_LANE
  const sourceAccount = parseSourceAccount(html, sourceUsername, observedAt)
  const sourceUrl = options.sourceUrl ?? "nitter-following:fixture"
  const targets = parseFollowingTargets(html, sourceAccount.username, observedAt)
  const edges = targets.map((targetAccount) => ({
    sourceAccount,
    targetAccount,
    relation: "following" as const,
    sourceLane,
    observedAt,
    provenance: {
      source: sourceLane,
      sourceUrl,
      sourceUsername: sourceAccount.username,
      targetUsername: targetAccount.username,
    },
  }))

  return {
    sourceAccount,
    targets,
    edges,
    nextPageUrl: readNextPageUrl(html, sourceUrl),
    observedAt,
    sourceUrl,
  }
}

export async function fetchNitterFollowing(username: string, options: FetchNitterFollowingOptions = {}): Promise<FetchedNitterFollowing> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? NITTER_DEFAULT_BASE_URL)
  const maxPages = clampPageCount(options.maxPages ?? NITTER_DEFAULT_MAX_PAGES)
  const fetcher = options.fetch ?? defaultFetch
  const observedAt = options.observedAt ?? nowIso()
  const sourceLane = options.sourceLane ?? NITTER_FOLLOWING_SOURCE_LANE
  let sourceAccount: SocialGraphAccount = { username: normalizeNitterUsername(username), observedAt, profileUrl: canonicalXProfileUrl(username) }
  const pages: FetchedFollowingPage[] = []
  const targetsByUsername = new Map<string, SocialGraphAccount>()
  const edges: ParsedFollowingEdge[] = []
  let stoppedReason: FetchedNitterFollowing["stoppedReason"] = "max-pages"
  let nextUrl: string | undefined = buildNitterFollowingUrl(baseUrl, username)

  for (let pageIndex = 0; pageIndex < maxPages && nextUrl; pageIndex += 1) {
    const response = await fetcher(nextUrl, { headers: { "User-Agent": options.userAgent ?? "twitter-archive/0.1" } })
    const body = await response.text()
    const classification = classifyNitterResponse(response.status, body)
    if (!classification.ok) {
      stoppedReason = classification.reason ?? "non-2xx"
      break
    }

    const parsed = parseNitterFollowingPage(body, username, { sourceUrl: nextUrl, observedAt, sourceLane })
    sourceAccount = parsed.sourceAccount
    pages.push({ ...parsed, body, status: response.status })
    for (const target of parsed.targets) {
      const key = target.username.toLowerCase()
      if (!targetsByUsername.has(key)) {
        targetsByUsername.set(key, target)
      }
    }
    edges.push(...parsed.edges)
    nextUrl = parsed.nextPageUrl
    stoppedReason = nextUrl ? "max-pages" : "no-cursor"
  }

  return {
    sourceAccount,
    targets: Array.from(targetsByUsername.values()),
    edges,
    pages,
    observedAt,
    stoppedReason,
  }
}

export async function captureNitterFollowingToSqlite(username: string, options: CaptureNitterFollowingToSqliteOptions = {}): Promise<CapturedNitterFollowingToSqlite> {
  const fetched = await fetchNitterFollowing(username, options)
  const store = options.store ?? initTwitterArchiveSqliteStore(requiredDbPath(options.dbPath))
  const shouldClose = options.store === undefined

  try {
    for (const page of fetched.pages) {
      store.cacheRawPage({
        source: NITTER_FOLLOWING_SOURCE_LANE,
        url: page.sourceUrl,
        requestHash: stableId([NITTER_FOLLOWING_SOURCE_LANE, page.sourceUrl, page.observedAt]),
        fetchedAt: page.observedAt,
        statusCode: page.status,
        contentType: "text/html; charset=utf-8",
        headers: {},
        body: page.body,
        parseStatus: "parsed",
        sourceUrl: page.sourceUrl,
        importBatchId: options.importBatchId,
        importStatus: "imported",
      })
    }

    const provenance = {
      source: NITTER_FOLLOWING_SOURCE_LANE,
      handle: normalizeNitterUsername(username),
      pages: fetched.pages.map((page) => page.sourceUrl),
      ...options.provenance,
    }
    const importResult = store.upsertSocialGraphImport({
      sourceAccount: fetched.sourceAccount,
      targetAccounts: fetched.targets,
      relation: "following",
      sourceLane: NITTER_FOLLOWING_SOURCE_LANE,
      observedAt: fetched.observedAt,
      importBatchId: options.importBatchId,
      importStatus: "imported",
      batchStatus: fetched.stoppedReason === "no-cursor" || fetched.stoppedReason === "max-pages" ? "imported" : "failed",
      provenance,
      error: fetched.stoppedReason === "non-2xx" || fetched.stoppedReason === "rate-limited" || fetched.stoppedReason === "challenge" ? fetched.stoppedReason : undefined,
    })
    return { ...fetched, importResult }
  } finally {
    if (shouldClose) {
      store.close()
    }
  }
}

export function parseFollowingExport(input: string, options: ParseFollowingExportOptions = {}): { sourceAccount: SocialGraphAccount; targets: readonly SocialGraphAccount[]; observedAt: string; sourceLane: string; provenance: SqliteJsonRecord } {
  const observedAt = options.observedAt ?? nowIso()
  const sourceLane = options.sourceLane ?? EXPORT_FOLLOWING_SOURCE_LANE
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new Error("Following export input must be non-empty")
  }
  return trimmed.startsWith("{") || trimmed.startsWith("[")
    ? parseFollowingJsonExport(trimmed, options, observedAt, sourceLane)
    : parseFollowingCsvExport(trimmed, options, observedAt, sourceLane)
}

export function importFollowingExportToSqlite(input: string, options: ParseFollowingExportOptions & { dbPath?: string; store?: TwitterArchiveSqliteStore; importBatchId?: string } = {}): SqliteSocialGraphImportResult {
  const parsed = parseFollowingExport(input, options)
  const store = options.store ?? initTwitterArchiveSqliteStore(requiredDbPath(options.dbPath))
  const shouldClose = options.store === undefined
  try {
    return store.upsertSocialGraphImport({
      sourceAccount: parsed.sourceAccount,
      targetAccounts: parsed.targets,
      relation: "following",
      sourceLane: parsed.sourceLane,
      observedAt: parsed.observedAt,
      importBatchId: options.importBatchId,
      importStatus: "imported",
      batchStatus: "imported",
      provenance: parsed.provenance,
    })
  } finally {
    if (shouldClose) {
      store.close()
    }
  }
}

function parseFollowingJsonExport(input: string, options: ParseFollowingExportOptions, observedAt: string, sourceLane: string) {
  const value = JSON.parse(input) as SqliteJsonValue
  const record = Array.isArray(value) ? { following: value } : value
  if (!isRecord(record)) {
    throw new Error("Following JSON export must be an object or array")
  }
  const sourceAccount = options.sourceAccount ?? accountFromJson(record.sourceAccount ?? record.source ?? record.owner, observedAt)
  if (!sourceAccount) {
    throw new Error("Following JSON export requires an explicit sourceAccount or source account field")
  }
  const rawTargets = Array.isArray(record.following) ? record.following : Array.isArray(record.targets) ? record.targets : Array.isArray(record.edges) ? record.edges : undefined
  if (!rawTargets) {
    throw new Error("Following JSON export requires following, targets, or edges array")
  }
  const targets = rawTargets.map((entry) => accountFromJson(isRecord(entry) && isRecord(entry.target) ? entry.target : entry, observedAt)).filter(isAccount)
  return {
    sourceAccount: { ...sourceAccount, observedAt },
    targets,
    observedAt,
    sourceLane,
    provenance: { source: sourceLane, format: "json", ...options.provenance },
  }
}

function parseFollowingCsvExport(input: string, options: ParseFollowingExportOptions, observedAt: string, sourceLane: string) {
  const rows = parseCsv(input)
  if (rows.length < 2) {
    throw new Error("Following CSV export requires a header and at least one row")
  }
  const header = rows[0].map((cell) => cell.trim().toLowerCase())
  const sourceFromOptions = options.sourceAccount
  const targets: SocialGraphAccount[] = []
  let sourceAccount = sourceFromOptions
  for (const row of rows.slice(1)) {
    const record = csvRecord(header, row)
    sourceAccount ??= accountFromFields(record, "source_", observedAt)
    const target = accountFromFields(record, "target_", observedAt) ?? accountFromFields(record, "", observedAt)
    if (target) {
      targets.push(target)
    }
  }
  if (!sourceAccount) {
    throw new Error("Following CSV export requires sourceAccount option or source_username column")
  }
  return {
    sourceAccount: { ...sourceAccount, observedAt },
    targets,
    observedAt,
    sourceLane,
    provenance: { source: sourceLane, format: "csv", ...options.provenance },
  }
}

function parseSourceAccount(html: string, sourceUsername: string, observedAt: string): SocialGraphAccount {
  const profile = extractFirstElementByClass(html, "profile-card") ?? extractFirstElementByClass(html, "profile-tabs")
  const username = normalizeNitterUsername(readFirstText(profile?.html ?? "", ["username"]) ?? sourceUsername)
  return {
    username,
    displayName: readFirstText(profile?.html ?? "", ["fullname"]),
    avatarUrl: readImageUrl(profile?.html ?? ""),
    profileUrl: canonicalXProfileUrl(username),
    observedAt,
  }
}

function parseFollowingTargets(html: string, sourceUsername: string, observedAt: string): SocialGraphAccount[] {
  const blocks = [...extractElementsByClass(html, "timeline-item"), ...extractElementsByClass(html, "account"), ...extractElementsByClass(html, "user-item")]
  const targets = new Map<string, SocialGraphAccount>()
  for (const block of blocks) {
    const usernameText = readFirstText(block.html, ["username"])
    const username = usernameText ? normalizeNitterUsername(usernameText) : readProfileHrefUsername(block.html)
    if (!username || username.toLowerCase() === sourceUsername.toLowerCase()) {
      continue
    }
    const key = username.toLowerCase()
    if (targets.has(key)) {
      continue
    }
    targets.set(key, {
      username,
      displayName: readFirstText(block.html, ["fullname"]),
      avatarUrl: readImageUrl(block.html),
      profileUrl: canonicalXProfileUrl(username),
      description: readFirstText(block.html, ["bio", "tweet-content"]),
      observedAt,
    })
  }
  return Array.from(targets.values())
}

function accountFromJson(value: SqliteJsonValue | undefined, observedAt: string): SocialGraphAccount | undefined {
  if (typeof value === "string") {
    return { username: normalizeNitterUsername(value), observedAt }
  }
  if (!isRecord(value)) {
    return undefined
  }
  const username = stringField(value, "username") ?? stringField(value, "handle") ?? stringField(value, "screen_name")
  if (!username) {
    return undefined
  }
  return {
    accountId: stringField(value, "accountId") ?? stringField(value, "id") ?? stringField(value, "user_id"),
    username: normalizeNitterUsername(username),
    displayName: stringField(value, "displayName") ?? stringField(value, "name"),
    profileUrl: stringField(value, "profileUrl") ?? stringField(value, "profile_url"),
    avatarUrl: stringField(value, "avatarUrl") ?? stringField(value, "avatar_url"),
    description: stringField(value, "description") ?? stringField(value, "bio"),
    protected: booleanField(value, "protected"),
    verified: booleanField(value, "verified"),
    observedAt,
  }
}

function accountFromFields(record: ReadonlyMap<string, string>, prefix: string, observedAt: string): SocialGraphAccount | undefined {
  const username = record.get(`${prefix}username`) ?? record.get(`${prefix}handle`) ?? record.get(`${prefix}screen_name`)
  if (!username) {
    return undefined
  }
  return {
    accountId: record.get(`${prefix}account_id`) ?? record.get(`${prefix}id`),
    username: normalizeNitterUsername(username),
    displayName: record.get(`${prefix}display_name`) ?? record.get(`${prefix}name`),
    profileUrl: record.get(`${prefix}profile_url`),
    avatarUrl: record.get(`${prefix}avatar_url`),
    description: record.get(`${prefix}description`) ?? record.get(`${prefix}bio`),
    observedAt: record.get("observed_at") ?? observedAt,
  }
}

function isAccount(account: SocialGraphAccount | undefined): account is SocialGraphAccount {
  return account !== undefined
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    const next = input[index + 1]
    if (char === '"' && inQuotes && next === '"') {
      cell += '"'
      index += 1
    } else if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === "," && !inQuotes) {
      row.push(cell)
      cell = ""
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1
      }
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else {
      cell += char
    }
  }
  row.push(cell)
  rows.push(row)
  return rows.filter((candidate) => candidate.some((cellValue) => cellValue.trim().length > 0))
}

function csvRecord(header: readonly string[], row: readonly string[]): ReadonlyMap<string, string> {
  const record = new Map<string, string>()
  for (let index = 0; index < header.length; index += 1) {
    const value = row[index]?.trim()
    if (value) {
      record.set(header[index], value)
    }
  }
  return record
}

interface HtmlElement {
  html: string
  start: number
  end: number
}

const CLASS_TAGS = ["article", "section", "div", "span", "a", "p"] as const

function extractFirstElementByClass(html: string, className: string): HtmlElement | undefined {
  return extractElementsByClass(html, className)[0]
}

function extractElementsByClass(html: string, className: string): HtmlElement[] {
  const elements: HtmlElement[] = []
  const pattern = new RegExp(`<(${CLASS_TAGS.join("|")})\\b[^>]*class=["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["'][^>]*>`, "gi")
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const end = findMatchingElementEnd(html, match.index, match[1].toLowerCase())
    if (end !== undefined) {
      elements.push({ html: html.slice(match.index, end), start: match.index, end })
      pattern.lastIndex = end
    }
  }
  return elements
}

function findMatchingElementEnd(html: string, start: number, tag: string): number | undefined {
  const tagPattern = new RegExp(`</?${escapeRegExp(tag)}\\b[^>]*>`, "gi")
  tagPattern.lastIndex = start
  let depth = 0
  let match: RegExpExecArray | null
  while ((match = tagPattern.exec(html)) !== null) {
    if (match[0].startsWith("</")) {
      depth -= 1
      if (depth === 0) {
        return tagPattern.lastIndex
      }
    } else if (!match[0].endsWith("/>")) {
      depth += 1
    }
  }
  return undefined
}

function readFirstText(html: string, classNames: readonly string[]): string | undefined {
  for (const className of classNames) {
    const element = extractFirstElementByClass(html, className)
    if (element) {
      const text = textFromHtml(element.html)
      if (text.length > 0) {
        return text
      }
    }
  }
  return undefined
}

function readImageUrl(html: string): string | undefined {
  const match = /<img\b[^>]*src=["']([^"']+)["']/i.exec(html)
  return match ? decodeHtml(match[1]) : undefined
}

function readProfileHrefUsername(html: string): string | undefined {
  const hrefPattern = /href=["']\/([A-Za-z0-9_]{1,15})(?:["']|[?#/])/g
  let match: RegExpExecArray | null
  while ((match = hrefPattern.exec(html)) !== null) {
    const username = normalizeNitterUsername(match[1])
    if (username !== "search" && username !== "about") {
      return username
    }
  }
  return undefined
}

function readNextPageUrl(html: string, sourceUrl: string): string | undefined {
  const showMore = extractFirstElementByClass(html, "show-more")?.html ?? html
  const hrefPattern = /href=["']([^"']*(?:cursor|following)[^"']*)["']/gi
  let match: RegExpExecArray | null
  while ((match = hrefPattern.exec(showMore)) !== null) {
    const href = decodeHtml(match[1])
    if (href.includes("cursor=")) {
      try {
        return new URL(href, sourceUrl).toString()
      } catch {
        return href
      }
    }
  }
  return undefined
}

function buildNitterFollowingUrl(baseUrl: string, username: string): string {
  return new URL(`${baseUrl}/${encodeURIComponent(normalizeNitterUsername(username))}/following`).toString()
}

function canonicalXProfileUrl(username: string): string {
  return `https://x.com/${encodeURIComponent(normalizeNitterUsername(username))}`
}

function clampPageCount(maxPages: number): number {
  if (!Number.isFinite(maxPages) || maxPages < 1) {
    throw new Error("Nitter following maxPages must be a positive finite number")
  }
  return Math.min(Math.floor(maxPages), NITTER_HARD_MAX_PAGES)
}

function requiredDbPath(dbPath: string | undefined): string {
  if (!dbPath) {
    throw new Error("A dbPath or store is required for following graph capture/import")
  }
  return dbPath
}

async function defaultFetch(url: string, init: NitterFetchRequestInit) {
  return fetch(url, init)
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "")
}

function textFromHtml(html: string): string {
  return decodeHtml(html.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function stringField(record: SqliteJsonRecord, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function booleanField(record: SqliteJsonRecord, key: string): boolean | undefined {
  const value = record[key]
  return typeof value === "boolean" ? value : undefined
}

function isRecord(value: SqliteJsonValue | object | undefined): value is SqliteJsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
