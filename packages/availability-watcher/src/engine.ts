import { Database } from "bun:sqlite"
import { dirname, join, resolve } from "node:path"
import {
  createEndpointSource,
  createNitterSource,
  NITTER_DEFAULT_BASE_URL,
  type PublicRecord,
  type PublicSourceAdapter,
  type PublicSourceRequest,
  type SourcePage,
} from "@wirebabel/twitter-archive"
import { Schema } from "effect"
import {
  AvailabilityStateSchema,
  type AvailabilityState,
  type CandidateFact,
  classifierProfiles,
  type FeedConfigEntry,
  type FeedItem,
  FeedRegistrySchema,
  type FeedRegistry,
} from "./model"

export const packageRoot = resolve(import.meta.dir, "..")
export const repositoryRoot = resolve(packageRoot, "../..")
export const defaultRegistryPath = join(packageRoot, "feeds.yml")
export const defaultDatabasePath = join(packageRoot, ".state", "feeds.sqlite")
export const defaultDocumentPath = join(repositoryRoot, "docs/state/model-availability.md")
export const defaultMachineStatePath = join(repositoryRoot, "docs/state/model-availability.state.json")

const NITTER_MIRRORS = [NITTER_DEFAULT_BASE_URL, "https://xcancel.com", "https://nitter.poast.org", "https://nitter.net"] as const
const RESET_PATTERN = /reset/i

export interface SyncSettings {
  readonly registryPath?: string
  readonly databasePath?: string
  readonly documentPath?: string
  readonly machineStatePath?: string
  readonly dryRun?: boolean
  readonly now?: Date
  readonly fetch?: typeof fetch
}

export interface FeedDiagnostic {
  readonly feed: string
  readonly fetched: number
  readonly candidates: number
  readonly failures: readonly string[]
}

export interface SyncReport {
  readonly candidates: readonly CandidateFact[]
  readonly appended: number
  readonly diagnostics: readonly FeedDiagnostic[]
}

interface FeedStateRow {
  content_hash: string | null
  cursor: string | null
  last_synced_at: string | null
  last_working_adapter: string | null
}

export class FeedStateStore {
  readonly database: Database
  constructor(path: string) {
    this.database = new Database(path)
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS processed_items (
        feed_name TEXT NOT NULL,
        item_key TEXT NOT NULL,
        item_url TEXT NOT NULL,
        processed_at TEXT NOT NULL,
        PRIMARY KEY(feed_name, item_key),
        UNIQUE(feed_name, item_url)
      );
      CREATE TABLE IF NOT EXISTS feed_state (
        feed_name TEXT PRIMARY KEY,
        content_hash TEXT,
        cursor TEXT,
        last_synced_at TEXT,
        last_working_adapter TEXT
      );
      DROP TABLE IF EXISTS public_source_records;
      DROP TABLE IF EXISTS public_source_state;
    `)
    try {
      this.database.exec("ALTER TABLE feed_state ADD COLUMN cursor TEXT")
    } catch (error) {
      if (!/duplicate column name/i.test(errorMessage(error))) throw error
    }
  }
  close(): void { this.database.close() }
  hasProcessed(feed: string, item: FeedItem): boolean {
    return this.database.query("SELECT 1 FROM processed_items WHERE feed_name=? AND (item_key=? OR item_url=?)").get(feed, item.id, item.url) !== null
  }
  claimProcessed(feed: string, candidate: CandidateFact, processedAt: string): boolean {
    const result = this.database.query("INSERT OR IGNORE INTO processed_items(feed_name,item_key,item_url,processed_at) VALUES(?,?,?,?)").run(feed, candidate.itemId, candidate.url, processedAt)
    return result.changes === 1
  }
  releaseClaims(candidates: readonly CandidateFact[]): void {
    const remove = this.database.prepare("DELETE FROM processed_items WHERE feed_name=? AND item_key=? AND item_url=?")
    this.database.transaction(() => {
      for (const candidate of candidates) remove.run(candidate.source, candidate.itemId, candidate.url)
    })()
  }
  state(feed: string): FeedStateRow | undefined {
    return this.database.query("SELECT content_hash,cursor,last_synced_at,last_working_adapter FROM feed_state WHERE feed_name=?").get(feed) as FeedStateRow | undefined
  }
  setState(feed: string, values: { contentHash?: string; cursor?: string | null; syncedAt: string; lastWorkingAdapter?: string }): void {
    this.database.query(`INSERT INTO feed_state(feed_name,content_hash,cursor,last_synced_at,last_working_adapter) VALUES(?,?,?,?,?)
      ON CONFLICT(feed_name) DO UPDATE SET content_hash=COALESCE(excluded.content_hash,feed_state.content_hash),
      cursor=excluded.cursor,last_synced_at=excluded.last_synced_at,last_working_adapter=COALESCE(excluded.last_working_adapter,feed_state.last_working_adapter)`)
      .run(feed, values.contentHash ?? null, values.cursor ?? null, values.syncedAt, values.lastWorkingAdapter ?? null)
  }
}

export async function loadRegistry(path = defaultRegistryPath): Promise<FeedRegistry> {
  const text = await Bun.file(path).text()
  const value: unknown = JSON.parse(text)
  return Schema.decodeUnknownSync(FeedRegistrySchema)(value)
}

export async function syncFeeds(settings: SyncSettings = {}): Promise<SyncReport> {
  const registry = await loadRegistry(settings.registryPath)
  const databasePath = settings.databasePath ?? defaultDatabasePath
  await Bun.write(join(dirname(databasePath), ".keep"), "")
  const store = new FeedStateStore(databasePath)
  const now = settings.now ?? new Date()
  const nowIso = now.toISOString()
  const diagnostics: FeedDiagnostic[] = []
  const candidates: CandidateFact[] = []
  const fetchedItems = new Map<string, FeedItem[]>()
  try {
    for (const feed of registry.feeds) {
      const fetched = await fetchFeed(feed, store, now, settings.fetch ?? fetch, settings.dryRun ?? false)
      fetchedItems.set(feed.name, fetched.items)
      const classifier = classifierProfiles[feed.classifierProfile]
      if (!classifier) throw new Error(`Unknown classifier profile: ${feed.classifierProfile}`)
      let candidateCount = 0
      for (const item of fetched.items) {
        if (store.hasProcessed(feed.name, item)) continue
        const candidate = classifier(item)
        if (!candidate) continue
        if (settings.dryRun || store.claimProcessed(feed.name, candidate, nowIso)) {
          candidates.push(candidate)
          candidateCount++
        }
      }
      diagnostics.push({ feed: feed.name, fetched: fetched.items.length, candidates: candidateCount, failures: fetched.failures })
      if (feed !== registry.feeds.at(-1)) await sleepWithJitter(750, 250)
    }
    if (settings.dryRun) return { candidates, appended: 0, diagnostics }

    if (candidates.length > 0) {
      try {
        await appendCandidateRows(settings.documentPath ?? defaultDocumentPath, candidates)
      } catch (error) {
        store.releaseClaims(candidates)
        throw error
      }
    }
    await writeMachineState(settings.machineStatePath ?? defaultMachineStatePath, fetchedItems, candidates, nowIso)
    return { candidates, appended: candidates.length, diagnostics }
  } finally {
    store.close()
  }
}

async function fetchFeed(feed: FeedConfigEntry, store: FeedStateStore, now: Date, fetcher: typeof fetch, dryRun: boolean): Promise<{ items: FeedItem[]; failures: string[] }> {
  if (feed.kind === "page-hash") return fetchPageHash(feed, store, now, fetcher, dryRun)
  const handle = feed.kind === "nitter-handle" ? feed.target : feed.name
  const state = store.state(feed.name)
  const cadenceMs = feed.cadence === "daily" ? 86_400_000 : 3_600_000
  if (state?.last_synced_at && now.getTime() - Date.parse(state.last_synced_at) < cadenceMs) return { items: [], failures: [] }

  const adapters = orderedAdapters(feed, state?.last_working_adapter ?? undefined)
  const failures: string[] = []
  const publicFetch = (url: string, init?: { headers?: Record<string, string> }) => fetcher(url, {
    headers: { "user-agent": "agents-availability-watcher/0.1 (respectful hourly/daily polling)", ...init?.headers },
  })
  for (const adapter of adapters) {
    const cursor = adapter.id === state?.last_working_adapter ? state?.cursor ?? undefined : undefined
    const input: PublicSourceRequest = { handle, cursor, fetch: publicFetch }
    try {
      const page = await retryAdapterFetch(adapter, input)
      if (!dryRun) store.setState(feed.name, { cursor: page.cursor, syncedAt: now.toISOString(), lastWorkingAdapter: adapter.id })
      return { items: page.records.map((record) => publicRecordToItem(feed, record)), failures }
    } catch (error) {
      failures.push(`${adapter.id}: ${errorMessage(error)}`)
    }
  }
  return { items: [], failures }
}

function orderedAdapters(feed: FeedConfigEntry, preferred?: string): PublicSourceAdapter[] {
  const adapters = feed.kind === "rss"
    ? [createEndpointSource({ id: `${feed.name}:rss`, kind: "rss", url: feed.target, headers: { "user-agent": "agents-availability-watcher/0.1" } })]
    : NITTER_MIRRORS.flatMap((mirror) => [
      createNitterSource(`${feed.name}:html:${mirror}`, mirror),
      createEndpointSource({ id: `${feed.name}:rss:${mirror}`, kind: "rss", url: `${mirror.replace(/\/$/, "")}/{handle}/rss`, headers: { "user-agent": "agents-availability-watcher/0.1" } }),
    ])
  const validated = adapters.map(validatePublicAdapter)
  if (!preferred) return validated
  return validated.sort((left, right) => Number(right.id === preferred) - Number(left.id === preferred))
}

function validatePublicAdapter(adapter: PublicSourceAdapter): PublicSourceAdapter {
  return {
    ...adapter,
    async fetch(input) {
      const page = await adapter.fetch(input)
      const usable = page.records.filter((record) => record.timestamp !== "1971-01-01T00:00:00.000Z" && !/RSS reader not yet whitelisted/i.test(record.text))
      if (usable.length === 0) throw new Error("Source returned no usable records")
      return { ...page, records: usable }
    },
  }
}
async function retryAdapterFetch(adapter: PublicSourceAdapter, input: PublicSourceRequest): Promise<SourcePage> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await adapter.fetch(input) }
    catch (error) {
      lastError = error
      if (attempt < 2) await sleepWithJitter(750 * 2 ** attempt, 250)
    }
  }
  throw lastError
}

async function fetchPageHash(feed: FeedConfigEntry, store: FeedStateStore, now: Date, fetcher: typeof fetch, dryRun: boolean): Promise<{ items: FeedItem[]; failures: string[] }> {
  try {
    const response = await retryFetch(feed.target, fetcher)
    const html = Schema.decodeUnknownSync(Schema.String)(await response.text())
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = visibleText(html)
    const hash = new Bun.CryptoHasher("sha256").update(text).digest("hex")
    const previous = store.state(feed.name)?.content_hash
    if (!dryRun) store.setState(feed.name, { contentHash: hash, syncedAt: now.toISOString() })
    if (hash === previous) return { items: [], failures: [] }
    return { items: [{ id: hash, observedAt: now.toISOString(), source: feed.name, text, url: feed.target }], failures: [] }
  } catch (error) {
    return { items: [], failures: [errorMessage(error)] }
  }
}

function publicRecordToItem(feed: FeedConfigEntry, record: PublicRecord): FeedItem {
  return { id: record.id, observedAt: record.timestamp, source: feed.name, handle: record.handle, text: record.text, url: record.sourceUrl }
}

export async function appendCandidateRows(path: string, candidates: readonly CandidateFact[]): Promise<void> {
  if (candidates.length === 0) return
  const existing = await Bun.file(path).text()
  const separator = existing.endsWith("\n") ? "" : "\n"
  const rows = candidates.map(formatCandidateRow).join("")
  await Bun.write(path, `${existing}${separator}${rows}`)
}

export function formatCandidateRow(candidate: CandidateFact): string {
  const observed = candidate.observedAt.slice(0, 10)
  const fact = `${candidate.handle ? `@${candidate.handle}` : candidate.source}: matched ${candidate.matchedTerms.join(", ")}`
  return `| ${escapeCell(observed)} | ${escapeCell(fact)} | "${escapeCell(candidate.quote)}" | ${escapeCell(candidate.url)} |\n`
}

async function writeMachineState(path: string, itemsBySource: ReadonlyMap<string, readonly FeedItem[]>, candidates: readonly CandidateFact[], nowIso: string): Promise<void> {
  let current: AvailabilityState = { lastSyncAt: nowIso, perSource: {} }
  const file = Bun.file(path)
  if (await file.exists()) {
    const parsed: unknown = JSON.parse(await file.text())
    current = Schema.decodeUnknownSync(AvailabilityStateSchema)(parsed)
  }
  const perSource: Record<string, AvailabilityState["perSource"][string]> = { ...current.perSource }
  for (const [source, items] of itemsBySource) {
    const latest = [...items].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0]
    const previous = perSource[source]
    perSource[source] = { lastItemAt: latest?.observedAt ?? previous?.lastItemAt ?? nowIso, lastResetMentionAt: previous?.lastResetMentionAt }
  }
  for (const candidate of candidates) if (RESET_PATTERN.test(candidate.matchedTerms.join(" "))) {
    const previous = perSource[candidate.source]
    if (previous?.lastResetMentionAt && previous.lastResetMentionAt >= candidate.observedAt) continue
    perSource[candidate.source] = { lastItemAt: previous?.lastItemAt ?? candidate.observedAt, lastResetMentionAt: candidate.observedAt }
  }
  await Bun.write(path, `${JSON.stringify({ lastSyncAt: nowIso, perSource }, null, 2)}\n`)
}

export async function readMachineState(path = defaultMachineStatePath): Promise<AvailabilityState> {
  const parsed: unknown = JSON.parse(await Bun.file(path).text())
  return Schema.decodeUnknownSync(AvailabilityStateSchema)(parsed)
}

function visibleText(html: string): string {
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/gi, "'").replace(/\s+/g, " ").trim()
}

async function retryFetch(url: string, fetcher: typeof fetch): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await fetcher(url, { headers: { "user-agent": "agents-availability-watcher/0.1 (respectful hourly/daily polling)" } }) }
    catch (error) { lastError = error; if (attempt < 2) await sleepWithJitter(750 * 2 ** attempt, 250) }
  }
  throw lastError
}

function escapeCell(value: string): string { return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ") }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
async function sleepWithJitter(ms: number, jitter: number): Promise<void> { await Bun.sleep(ms + Math.random() * jitter) }
