import { Database } from "bun:sqlite"
import { parseNitterTimelinePage } from "./nitter"

export const DEFAULT_PUBLIC_SOURCE_HANDLES = ["thsottiaux"] as const
export type PublicSourceKind = "rss" | "nitter" | "syndication" | "api" | "json"
export type SyncCadence = "hourly" | "daily"

export interface PublicRecord {
  author: string
  handle: string
  id: string
  timestamp: string
  text: string
  links: string[]
  sourceUrl: string
}
export interface SourcePage { records: PublicRecord[]; cursor?: string }
export interface PublicSourceRequest {
  handle: string
  cursor?: string
  fetch: PublicSourceFetch
}
export interface PublicSourceAdapter {
  id: string
  kind: PublicSourceKind
  fetch(input: PublicSourceRequest): Promise<SourcePage>
}
export interface PublicSourceFetchResponse { ok: boolean; status: number; text(): Promise<string> }
export type PublicSourceFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<PublicSourceFetchResponse>
export interface EndpointSourceOptions {
  id: string
  kind: Exclude<PublicSourceKind, "json">
  url: string | ((handle: string, cursor?: string) => string)
  headers?: Record<string, string>
  parse?: (text: string, context: { handle: string; sourceUrl: string }) => SourcePage
}
export interface SyncOptions {
  handles?: readonly string[]
  cadence?: SyncCadence
  force?: boolean
  fetch?: PublicSourceFetch
  retries?: number
  backoffMs?: number
  jitterMs?: number
  now?: Date
}
export interface SyncResult { attempted: number; inserted: number; skipped: number; failures: Array<{ handle: string; errors: string[] }> }
export interface PublicRecordSearch {
  handle?: string
  handles?: readonly string[]
  query?: string
  since?: string
  until?: string
  limit?: number
  offset?: number
}
export type PublicSourceTier = "Primary" | "Topic lists" | "Archive/mute candidates"
export interface HandleAnalysis {
  handle: string
  tier: PublicSourceTier
  recordCount: number
  activeDays: number
  latestTimestamp?: string
  evidence: { matchingRecords: number; totalLinks: number; averageTextLength: number }
}
export interface AnalyzeOptions { handles?: readonly string[]; query?: string; since?: string; until?: string }

interface RecordRow { author: string; handle: string; id: string; timestamp: string; text: string; links_json: string; source_url: string }
interface SourceStateRow { cursor: string | null; last_synced_at: string | null }

export class PublicSourceCache {
  readonly database: Database
  constructor(path: string, options: { readonly?: boolean } = {}) {
    this.database = new Database(path, options.readonly ? { readonly: true } : undefined)
    if (!options.readonly) this.initialize()
  }
  close(): void { this.database.close() }
  private initialize(): void {
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS public_source_records (
        handle TEXT NOT NULL COLLATE NOCASE, id TEXT NOT NULL, author TEXT NOT NULL,
        timestamp TEXT NOT NULL, text TEXT NOT NULL, links_json TEXT NOT NULL,
        source_url TEXT NOT NULL, imported_at TEXT NOT NULL,
        PRIMARY KEY(handle, id)
      );
      CREATE INDEX IF NOT EXISTS public_source_records_timestamp ON public_source_records(timestamp DESC);
      CREATE TABLE IF NOT EXISTS public_source_state (
        source_id TEXT NOT NULL, handle TEXT NOT NULL COLLATE NOCASE, cursor TEXT,
        last_synced_at TEXT, PRIMARY KEY(source_id, handle)
      );
    `)
  }
  upsert(records: readonly PublicRecord[], importedAt = new Date().toISOString()): number {
    const statement = this.database.prepare(`INSERT INTO public_source_records
      (handle,id,author,timestamp,text,links_json,source_url,imported_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(handle,id) DO UPDATE SET author=excluded.author,timestamp=excluded.timestamp,
      text=excluded.text,links_json=excluded.links_json,source_url=excluded.source_url
      WHERE public_source_records.author != excluded.author OR public_source_records.timestamp != excluded.timestamp
      OR public_source_records.text != excluded.text OR public_source_records.links_json != excluded.links_json
      OR public_source_records.source_url != excluded.source_url`)
    const transaction = this.database.transaction((items: readonly PublicRecord[]) => {
      let changed = 0
      for (const item of items) {
        const record = normalizePublicRecord(item)
        const result = statement.run(record.handle, record.id, record.author, record.timestamp, record.text, JSON.stringify(record.links), record.sourceUrl, importedAt)
        changed += result.changes
      }
      return changed
    })
    return transaction(records)
  }
  search(filter: PublicRecordSearch = {}): PublicRecord[] {
    const clauses: string[] = []; const values: Array<string | number> = []
    const handles = filter.handles ?? (filter.handle ? [filter.handle] : undefined)
    if (handles?.length) { clauses.push(`handle IN (${handles.map(() => "?").join(",")})`); values.push(...handles.map(normalizeHandle)) }
    if (filter.query?.trim()) { clauses.push("(text LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\')"); const q = `%${escapeLike(filter.query.trim())}%`; values.push(q, q) }
    if (filter.since) { clauses.push("timestamp >= ?"); values.push(normalizeTimestamp(filter.since)) }
    if (filter.until) { clauses.push("timestamp <= ?"); values.push(normalizeTimestamp(filter.until)) }
    const limit = clampInteger(filter.limit, 100, 1, 10_000); const offset = clampInteger(filter.offset, 0, 0, 1_000_000)
    values.push(limit, offset)
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
    return (this.database.query(`SELECT author,handle,id,timestamp,text,links_json,source_url FROM public_source_records ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).all(...values) as RecordRow[]).map(rowToRecord)
  }
  sourceState(sourceId: string, handle: string): SourceStateRow | undefined {
    return this.database.query("SELECT cursor,last_synced_at FROM public_source_state WHERE source_id=? AND handle=?").get(sourceId, normalizeHandle(handle)) as SourceStateRow | undefined
  }
  setSourceState(sourceId: string, handle: string, cursor: string | undefined, syncedAt: string): void {
    this.database.query(`INSERT INTO public_source_state(source_id,handle,cursor,last_synced_at) VALUES(?,?,?,?)
      ON CONFLICT(source_id,handle) DO UPDATE SET cursor=excluded.cursor,last_synced_at=excluded.last_synced_at`).run(sourceId, normalizeHandle(handle), cursor ?? null, syncedAt)
  }
  importJson(text: string, sourceUrl = "manual:json"): number { return this.upsert(parsePublicJson(text, { sourceUrl })) }
  analyze(options: AnalyzeOptions = {}): HandleAnalysis[] {
    const records = this.search({ handles: options.handles, query: options.query, since: options.since, until: options.until, limit: 10_000 })
    const requested = options.handles?.map(normalizeHandle)
    const grouped = new Map<string, PublicRecord[]>(); for (const handle of requested ?? []) grouped.set(handle, [])
    for (const record of records) { const list = grouped.get(record.handle) ?? []; list.push(record); grouped.set(record.handle, list) }
    return [...grouped].map(([handle, items]) => analyzeHandle(handle, items, Boolean(options.query))).sort((a, b) => b.recordCount - a.recordCount || a.handle.localeCompare(b.handle))
  }
}

export async function syncPublicSources(cache: PublicSourceCache, adapters: readonly PublicSourceAdapter[], options: SyncOptions = {}): Promise<SyncResult> {
  const handles = uniqueHandles(options.handles ?? DEFAULT_PUBLIC_SOURCE_HANDLES)
  const fetcher = options.fetch ?? defaultFetch; const now = options.now ?? new Date(); const syncedAt = now.toISOString()
  const cadenceMs = (options.cadence ?? "hourly") === "daily" ? 86_400_000 : 3_600_000
  let attempted = 0, inserted = 0, skipped = 0; const failures: SyncResult["failures"] = []
  for (const handle of handles) {
    const errors: string[] = []; let completed = false
    for (const adapter of adapters) {
      const state = cache.sourceState(adapter.id, handle)
      if (!options.force && state?.last_synced_at && now.getTime() - Date.parse(state.last_synced_at) < cadenceMs) { skipped++; completed = true; break }
      attempted++
      try {
        const page = await retry(() => adapter.fetch({ handle, cursor: state?.cursor ?? undefined, fetch: fetcher }), options.retries ?? 2, options.backoffMs ?? 750, options.jitterMs ?? 250)
        inserted += cache.upsert(page.records, syncedAt); cache.setSourceState(adapter.id, handle, page.cursor, syncedAt); completed = true; break
      } catch (error) { errors.push(`${adapter.id}: ${errorMessage(error)}`) }
    }
    if (!completed) failures.push({ handle, errors })
    await delayWithJitter(options.backoffMs ?? 750, options.jitterMs ?? 250)
  }
  return { attempted, inserted, skipped, failures }
}

export function createEndpointSource(options: EndpointSourceOptions): PublicSourceAdapter {
  return { id: options.id, kind: options.kind, async fetch({ handle, cursor, fetch }) {
    const sourceUrl = typeof options.url === "function" ? options.url(handle, cursor) : interpolateUrl(options.url, handle, cursor)
    const response = await fetch(sourceUrl, { headers: options.headers }); const body = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (options.parse) return options.parse(body, { handle, sourceUrl })
    if (options.kind === "rss") return parsePublicRss(body, { handle, sourceUrl })
    if (options.kind === "nitter") return parsePublicNitter(body, { handle, sourceUrl })
    return parsePublicJsonPage(body, { handle, sourceUrl })
  } }
}
export function createRssSource(id: string, url: EndpointSourceOptions["url"]): PublicSourceAdapter { return createEndpointSource({ id, kind: "rss", url }) }
export function createNitterSource(id: string, baseUrl: string): PublicSourceAdapter { return createEndpointSource({ id, kind: "nitter", url: (h, c) => `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(h)}${c ? `?cursor=${encodeURIComponent(c)}` : ""}` }) }
export function createSyndicationSource(id: string, url: EndpointSourceOptions["url"]): PublicSourceAdapter { return createEndpointSource({ id, kind: "syndication", url }) }
export function createApiSource(id: string, url: EndpointSourceOptions["url"], headers?: Record<string, string>): PublicSourceAdapter { return createEndpointSource({ id, kind: "api", url, headers }) }

export function parsePublicNitter(text: string, context: { handle?: string; sourceUrl: string }): SourcePage {
  const baseUrl = /^https?:/.test(context.sourceUrl) ? new URL(context.sourceUrl).origin : context.sourceUrl
  const parsed = parseNitterTimelinePage(text, { baseUrl, targetUsername: context.handle })
  const users = new Map(parsed.users.map(user => [user.username.toLowerCase(), user]))
  return {
    records: parsed.tweets.map(tweet => {
      const handle = tweet.username ?? context.handle ?? "unknown"
      const user = users.get(handle.toLowerCase())
      return normalizePublicRecord({
        author: user?.displayName ?? handle,
        handle,
        id: tweet.id,
        timestamp: tweet.createdAt ?? parsed.capturedAt,
        text: tweet.text,
        links: uniqueStrings([tweet.url, ...extractLinks(tweet.text)]),
        sourceUrl: tweet.url || context.sourceUrl,
      })
    }),
    cursor: parsed.nextCursor?.cursor,
  }
}
export function parsePublicRss(text: string, context: { handle?: string; sourceUrl: string }): SourcePage {
  const items = [...text.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)]
  return { records: items.map((match, index) => {
    const item = match[1] ?? ""; const link = xmlValue(item, "link") || xmlAttribute(item, "link", "href") || context.sourceUrl
    const author = xmlValue(item, "author") || xmlValue(item, "dc:creator") || context.handle || "unknown"
    const description = xmlValue(item, "description") || xmlValue(item, "content") || xmlValue(item, "summary") || xmlValue(item, "title")
    return normalizePublicRecord({ author: stripMarkup(author), handle: context.handle || inferHandle(author, link), id: xmlValue(item, "guid") || xmlValue(item, "id") || link || String(index), timestamp: xmlValue(item, "pubDate") || xmlValue(item, "published") || xmlValue(item, "updated"), text: stripMarkup(description), links: uniqueStrings([link, ...extractLinks(description)]), sourceUrl: link })
  }) }
}
export function parsePublicJsonPage(text: string, context: { handle?: string; sourceUrl: string }): SourcePage {
  const root: unknown = JSON.parse(text)
  const records = Array.isArray(root)
    ? root.map((value, index) => normalizeJsonRecord(value, index, context))
    : isObject(root)
      ? arrayField(root, ["records", "tweets", "data", "items"]).map((value, index) => normalizeJsonRecord(value, index, context))
      : []
  const cursor = isObject(root) ? stringValue(root.next_cursor, root.nextCursor, root.cursor) || undefined : undefined
  return { records, cursor }
}
export function parsePublicJson(text: string, context: { handle?: string; sourceUrl: string }): PublicRecord[] {
  return parsePublicJsonPage(text, context).records
}

export function seedPublicSourceHandles(handles: readonly string[] = []): string[] { return uniqueHandles([...DEFAULT_PUBLIC_SOURCE_HANDLES, ...handles]) }

function normalizeJsonRecord(value: unknown, index: number, context: { handle?: string; sourceUrl: string }): PublicRecord {
  if (!isObject(value)) throw new Error(`JSON record ${index} is not an object`)
  const user = isObject(value.user) ? value.user : isObject(value.author) ? value.author : undefined
  const handle = stringValue(value.handle, value.username, user?.username, context.handle)
  const author = stringValue(typeof value.author === "string" ? value.author : undefined, value.name, user?.name, handle)
  const sourceUrl = stringValue(value.sourceUrl, value.url, value.link, context.sourceUrl)
  return normalizePublicRecord({ author, handle, id: stringValue(value.id, value.id_str, value.tweet_id) || `${handle}:${index}`, timestamp: stringValue(value.timestamp, value.created_at, value.createdAt, value.date), text: stringValue(value.text, value.full_text, value.content, value.title), links: stringArray(value.links).length ? stringArray(value.links) : extractLinks(stringValue(value.text, value.full_text, value.content)), sourceUrl })
}
function normalizePublicRecord(record: PublicRecord): PublicRecord {
  const handle = normalizeHandle(record.handle); const text = record.text.trim(); const sourceUrl = record.sourceUrl.trim()
  if (!handle || !record.id.trim() || !record.timestamp || !sourceUrl) throw new Error("Public record requires handle, id, timestamp, and source URL")
  return { author: record.author.trim() || handle, handle, id: record.id.trim(), timestamp: normalizeTimestamp(record.timestamp), text, links: uniqueStrings(record.links.map(v => v.trim()).filter(Boolean)), sourceUrl }
}
function analyzeHandle(handle: string, records: PublicRecord[], query: boolean): HandleAnalysis {
  const days = new Set(records.map(r => r.timestamp.slice(0, 10))).size; const totalLinks = records.reduce((n, r) => n + r.links.length, 0)
  const averageTextLength = records.length ? Math.round(records.reduce((n, r) => n + r.text.length, 0) / records.length) : 0
  const tier: PublicSourceTier = records.length === 0 ? "Archive/mute candidates" : query || records.length < 5 || days < 2 ? "Topic lists" : "Primary"
  return { handle, tier, recordCount: records.length, activeDays: days, latestTimestamp: records[0]?.timestamp, evidence: { matchingRecords: records.length, totalLinks, averageTextLength } }
}
function rowToRecord(row: RecordRow): PublicRecord { return { author: row.author, handle: row.handle, id: row.id, timestamp: row.timestamp, text: row.text, links: JSON.parse(row.links_json) as string[], sourceUrl: row.source_url } }
function normalizeHandle(value: string): string { return value.trim().replace(/^@+/, "").toLowerCase() }
function uniqueHandles(values: readonly string[]): string[] { return uniqueStrings(values.map(normalizeHandle).filter(Boolean)) }
function uniqueStrings(values: readonly string[]): string[] { return [...new Set(values)] }
function extractLinks(value: string): string[] { return uniqueStrings(value.match(/https?:\/\/[^\s<>'"\])]+/g) ?? []) }
function stripMarkup(value: string): string { return decodeXml(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() }
function decodeXml(value: string): string { return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'") }
function xmlValue(text: string, tag: string): string { const escaped = tag.replace(":", "\\:"); return text.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"))?.[1]?.trim() ?? "" }
function xmlAttribute(text: string, tag: string, attr: string): string { const open = text.match(new RegExp(`<${tag}\\b[^>]*>`, "i"))?.[0]; return open?.match(new RegExp(`${attr}=["']([^"']+)["']`, "i"))?.[1] ?? "" }
function inferHandle(author: string, url: string): string { return author.match(/@([A-Za-z0-9_]+)/)?.[1] ?? url.match(/(?:x\.com|twitter\.com|nitter[^/]*)\/([^/?#]+)/i)?.[1] ?? "unknown" }
function interpolateUrl(url: string, handle: string, cursor?: string): string { return url.replaceAll("{handle}", encodeURIComponent(handle)).replaceAll("{cursor}", encodeURIComponent(cursor ?? "")) }
function normalizeTimestamp(value: string): string { const time = Date.parse(value); if (!Number.isFinite(time)) throw new Error(`Invalid timestamp: ${value}`); return new Date(time).toISOString() }
function escapeLike(value: string): string { return value.replace(/[\\%_]/g, "\\$&") }
function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number { return Math.min(max, Math.max(min, Math.trunc(value ?? fallback))) }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function arrayField(value: Record<string, unknown>, keys: string[]): unknown[] { for (const key of keys) if (Array.isArray(value[key])) return value[key]; return [value] }
function stringValue(...values: unknown[]): string { for (const value of values) if (typeof value === "string" && value.trim()) return value; return "" }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [] }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
async function defaultFetch(url: string, init?: { headers?: Record<string, string> }): Promise<PublicSourceFetchResponse> { return fetch(url, init) }
async function retry<T>(operation: () => Promise<T>, retries: number, backoffMs: number, jitterMs: number): Promise<T> { let last: unknown; for (let attempt = 0; attempt <= retries; attempt++) { try { return await operation() } catch (error) { last = error; if (attempt < retries) await delayWithJitter(backoffMs * 2 ** attempt, jitterMs) } } throw last }
async function delayWithJitter(ms: number, jitterMs: number): Promise<void> { const { promise, resolve } = Promise.withResolvers<void>(); setTimeout(resolve, Math.max(0, ms + Math.random() * Math.max(0, jitterMs))); return promise }
