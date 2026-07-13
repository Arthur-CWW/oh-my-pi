import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import {
  DEFAULT_TWITTER_ARCHIVE_DB_PATH,
  DEFAULT_TWITTER_ARCHIVE_LOG_PATH,
  DEFAULT_TWITTER_ARCHIVE_MEDIA_ROOT,
} from "./effect-services"
import { runFullSyncPass } from "./full-sync"
import { captureNitterTimelineToSqlite } from "./nitter"
import { loadSyncPolicy, type SyncAccountPolicy, type SyncMirrorPolicy, type SyncPolicy, type SyncTier } from "./sync-policy"
import { acquireMirrorToken, ensureSyncTokenBucketTable, type TokenGrant } from "./sync-token-bucket"

const CLAIM_LEASE_MS = 15 * 60_000

interface ScheduleRow {
  handle: string
  tier: SyncTier
  ordinal: number
  next_due_at: string
}

export interface BucketEvent {
  readonly handle: string
  readonly tier: SyncTier
  readonly mirror: string
  readonly granted: boolean
  readonly tokensBefore: number
  readonly tokensAfter: number
  readonly retryAt: string | null
}

export interface SyncAccountEvent {
  readonly handle: string
  readonly tier: SyncTier
  readonly mirror: string | null
  readonly status: "synced" | "failed" | "deferred"
  readonly detail: string
}

export interface SyncTickReport {
  readonly startedAt: string
  readonly finishedAt: string
  readonly due: number
  readonly synced: number
  readonly failed: number
  readonly deferred: number
  readonly accounts: readonly SyncAccountEvent[]
  readonly buckets: readonly BucketEvent[]
}

export interface SyncTickOptions {
  readonly policyPath?: string
  readonly dbPath?: string
  readonly logPath?: string
  readonly mediaRoot?: string
  readonly now?: Date
  readonly fetch?: typeof fetch
}

export async function runSyncTick(options: SyncTickOptions = {}): Promise<SyncTickReport> {
  const policy = await loadSyncPolicy(options.policyPath)
  const now = options.now ?? new Date()
  const startedAt = now.toISOString()
  const dbPath = options.dbPath ?? DEFAULT_TWITTER_ARCHIVE_DB_PATH
  const logPath = options.logPath ?? DEFAULT_TWITTER_ARCHIVE_LOG_PATH
  const mediaRoot = options.mediaRoot ?? DEFAULT_TWITTER_ARCHIVE_MEDIA_ROOT
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true })
  const database = new Database(dbPath)
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;")
  ensureSchedulerTables(database)
  ensureSyncTokenBucketTable(database)
  seedSchedule(database, policy, startedAt)

  const dueRows = database.query(`SELECT handle,tier,ordinal,next_due_at FROM sync_account_schedule
    WHERE next_due_at <= ? ORDER BY next_due_at,ordinal LIMIT ?`).all(startedAt, policy.maxAccountsPerTick) as ScheduleRow[]
  const accounts: SyncAccountEvent[] = []
  const buckets: BucketEvent[] = []
  try {
    for (const row of dueRows) {
      if (!claimAccount(database, row.handle, startedAt, now.getTime())) continue
      const acquired = acquireAnyMirror(database, policy.mirrors, row, now.getTime(), buckets)
      if (acquired === null) {
        const retryAt = earliestRetryAt(buckets, row.handle) ?? new Date(now.getTime() + CLAIM_LEASE_MS).toISOString()
        setNextDue(database, row.handle, retryAt, startedAt, null)
        accounts.push({ handle: row.handle, tier: row.tier, mirror: null, status: "deferred", detail: `bucket-empty until ${retryAt}` })
        continue
      }

      try {
        const detail = row.tier === "corpus"
          ? await syncCorpusAccount(row.handle, acquired.url, policy, { dbPath, logPath, mediaRoot, now, fetch: options.fetch })
          : await syncNewsAccount(row.handle, acquired.url, policy, { dbPath, now, fetch: options.fetch })
        const nextDue = nextDueAt(row, policy, now)
        setNextDue(database, row.handle, nextDue, startedAt, null)
        accounts.push({ handle: row.handle, tier: row.tier, mirror: acquired.url, status: "synced", detail })
      } catch (error) {
        const message = errorMessage(error)
        setNextDue(database, row.handle, new Date(now.getTime() + CLAIM_LEASE_MS).toISOString(), null, message)
        accounts.push({ handle: row.handle, tier: row.tier, mirror: acquired.url, status: "failed", detail: message })
      }
    }
  } finally {
    database.close()
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    due: dueRows.length,
    synced: accounts.filter((event) => event.status === "synced").length,
    failed: accounts.filter((event) => event.status === "failed").length,
    deferred: accounts.filter((event) => event.status === "deferred").length,
    accounts,
    buckets,
  }
}

function ensureSchedulerTables(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS sync_account_schedule (
    handle TEXT PRIMARY KEY COLLATE NOCASE,
    tier TEXT NOT NULL CHECK(tier IN ('corpus','news')),
    ordinal INTEGER NOT NULL,
    next_due_at TEXT NOT NULL,
    last_attempt_at TEXT,
    last_success_at TEXT,
    last_error TEXT
  );`)
}

function seedSchedule(database: Database, policy: SyncPolicy, nowIso: string): void {
  const statement = database.prepare(`INSERT INTO sync_account_schedule(handle,tier,ordinal,next_due_at)
    VALUES(?,?,?,?) ON CONFLICT(handle) DO UPDATE SET tier=excluded.tier,ordinal=excluded.ordinal`)
  database.transaction(() => {
    for (const [ordinal, account] of policy.accounts.entries()) {
      statement.run(normalizeHandle(account.handle), account.tier, ordinal, nowIso)
    }
  })()
}

function claimAccount(database: Database, handle: string, nowIso: string, nowMs: number): boolean {
  const result = database.query(`UPDATE sync_account_schedule SET next_due_at=?,last_attempt_at=?
    WHERE handle=? AND next_due_at<=?`).run(new Date(nowMs + CLAIM_LEASE_MS).toISOString(), nowIso, handle, nowIso)
  return result.changes === 1
}

function acquireAnyMirror(
  database: Database,
  mirrors: readonly SyncMirrorPolicy[],
  account: Pick<ScheduleRow, "handle" | "tier" | "ordinal">,
  nowMs: number,
  events: BucketEvent[],
): SyncMirrorPolicy | null {
  for (let offset = 0; offset < mirrors.length; offset += 1) {
    const mirror = mirrors[(account.ordinal + offset) % mirrors.length]
    if (!mirror) continue
    const grant = acquireMirrorToken(database, mirror, { handle: account.handle, lane: account.tier }, nowMs)
    events.push(bucketEvent(account, mirror, grant))
    if (grant.granted) return mirror
  }
  return null
}

function bucketEvent(account: Pick<ScheduleRow, "handle" | "tier">, mirror: SyncMirrorPolicy, grant: TokenGrant): BucketEvent {
  return {
    handle: account.handle,
    tier: account.tier,
    mirror: mirror.url,
    granted: grant.granted,
    tokensBefore: grant.tokensBefore,
    tokensAfter: grant.tokensAfter,
    retryAt: grant.retryAtMs === null ? null : new Date(grant.retryAtMs).toISOString(),
  }
}

async function syncCorpusAccount(
  handle: string,
  mirror: string,
  policy: SyncPolicy,
  options: { dbPath: string; logPath: string; mediaRoot: string; now: Date; fetch?: typeof fetch },
): Promise<string> {
  const result = await runFullSyncPass({
    runId: `sync-tick:${options.now.toISOString()}`,
    handles: [handle],
    dbPath: options.dbPath,
    logPath: options.logPath,
    mediaRoot: options.mediaRoot,
    baseUrl: mirror,
    mirrorUrls: [mirror],
    pagesPerPass: policy.tiers.corpus.pagesPerTick,
    delayMs: policy.delayMs,
    jitterMs: policy.jitterMs,
    fetchFn: options.fetch,
  })
  const account = result.handles[0]
  if (!account) throw new Error(`full sync returned no result for ${handle}`)
  if (account.stopReason === "upstream" || account.stopReason === "rate-limited" || account.stopReason === "error") {
    throw new Error(`corpus sync stopped: ${account.stopReason}`)
  }
  return `${account.stopReason}; ${account.totalTweets} tweets; oldest ${account.oldestTweet ?? "unknown"}`
}

async function syncNewsAccount(
  handle: string,
  mirror: string,
  policy: SyncPolicy,
  options: { dbPath: string; now: Date; fetch?: typeof fetch },
): Promise<string> {
  const result = await captureNitterTimelineToSqlite(handle, {
    dbPath: options.dbPath,
    baseUrl: mirror,
    maxPages: policy.tiers.news.pagesPerTick,
    delayMs: policy.delayMs,
    jitterMs: policy.jitterMs,
    capturedAt: options.now.toISOString(),
    fetchFn: options.fetch,
  })
  if (result.pages.length === 0) throw new Error(`news sync stopped: ${result.stopReason}`)
  return `recent-only; ${result.pages.length} pages; ${result.entityUpserts.tweets} tweet upserts; no thread/media downloads`
}

function nextDueAt(row: ScheduleRow, policy: SyncPolicy, now: Date): string {
  const tierPolicy = policy.tiers[row.tier]
  if (row.tier === "news") return new Date(now.getTime() + tierPolicy.cadenceMinutes * 60_000).toISOString()
  const corpusCount = policy.accounts.filter((account) => account.tier === "corpus").length
  const corpusOrdinal = policy.accounts.filter((account, index) => account.tier === "corpus" && index < row.ordinal).length
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const slotMs = Math.floor((86_400_000 * corpusOrdinal) / Math.max(1, corpusCount))
  let target = dayStart + slotMs
  if (target <= now.getTime()) target += tierPolicy.cadenceMinutes * 60_000
  return new Date(target).toISOString()
}

function setNextDue(database: Database, handle: string, nextDue: string, successAt: string | null, error: string | null): void {
  database.query(`UPDATE sync_account_schedule SET next_due_at=?,last_success_at=COALESCE(?,last_success_at),last_error=? WHERE handle=?`)
    .run(nextDue, successAt, error, handle)
}

function earliestRetryAt(events: readonly BucketEvent[], handle: string): string | null {
  const retryTimes = events.filter((event) => event.handle === handle && event.retryAt !== null).map((event) => event.retryAt as string).sort()
  return retryTimes[0] ?? null
}

function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, "").trim().toLowerCase()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
