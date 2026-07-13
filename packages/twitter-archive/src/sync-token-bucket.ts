import type { Database } from "bun:sqlite"
import type { SyncMirrorPolicy, SyncTier } from "./sync-policy"

export interface TokenBucketState {
  readonly tokens: number
  readonly refilledAtMs: number
}

export interface TokenGrant {
  readonly granted: boolean
  readonly tokensBefore: number
  readonly tokensAfter: number
  readonly retryAtMs: number | null
}

interface BucketRow {
  tokens: number
  refilled_at_ms: number
}

export function refillTokenBucket(state: TokenBucketState, mirror: SyncMirrorPolicy, nowMs: number): TokenBucketState {
  const elapsedMs = Math.max(0, nowMs - state.refilledAtMs)
  const refill = elapsedMs * (mirror.refillPerHour / 3_600_000)
  return {
    tokens: Math.min(mirror.capacity, state.tokens + refill),
    refilledAtMs: Math.max(state.refilledAtMs, nowMs),
  }
}

export function consumeTokenBucket(state: TokenBucketState, mirror: SyncMirrorPolicy, nowMs: number): TokenGrant & TokenBucketState {
  const refilled = refillTokenBucket(state, mirror, nowMs)
  if (refilled.tokens >= 1) {
    return {
      ...refilled,
      granted: true,
      tokensBefore: refilled.tokens,
      tokensAfter: refilled.tokens - 1,
      tokens: refilled.tokens - 1,
      retryAtMs: null,
    }
  }
  const missing = 1 - refilled.tokens
  const retryAtMs = nowMs + Math.ceil((missing / mirror.refillPerHour) * 3_600_000)
  return {
    ...refilled,
    granted: false,
    tokensBefore: refilled.tokens,
    tokensAfter: refilled.tokens,
    retryAtMs,
  }
}

export function ensureSyncTokenBucketTable(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sync_token_buckets (
      mirror_url TEXT PRIMARY KEY,
      tokens REAL NOT NULL,
      refilled_at_ms INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_bucket_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at TEXT NOT NULL,
      mirror_url TEXT NOT NULL,
      handle TEXT NOT NULL,
      lane TEXT NOT NULL,
      granted INTEGER NOT NULL,
      tokens_before REAL NOT NULL,
      tokens_after REAL NOT NULL,
      retry_at TEXT
    );
  `)
}

export function acquireMirrorToken(
  database: Database,
  mirror: SyncMirrorPolicy,
  work: { handle: string; lane: SyncTier },
  nowMs: number,
): TokenGrant {
  ensureSyncTokenBucketTable(database)
  return database.transaction(() => {
    const row = database.query("SELECT tokens, refilled_at_ms FROM sync_token_buckets WHERE mirror_url = ?").get(mirror.url) as BucketRow | null
    const state: TokenBucketState = row
      ? { tokens: row.tokens, refilledAtMs: row.refilled_at_ms }
      : { tokens: mirror.capacity, refilledAtMs: nowMs }
    const grant = consumeTokenBucket(state, mirror, nowMs)
    const nowIso = new Date(nowMs).toISOString()
    database.query(`INSERT INTO sync_token_buckets(mirror_url,tokens,refilled_at_ms,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(mirror_url) DO UPDATE SET tokens=excluded.tokens,refilled_at_ms=excluded.refilled_at_ms,updated_at=excluded.updated_at`)
      .run(mirror.url, grant.tokensAfter, grant.refilledAtMs, nowIso)
    database.query(`INSERT INTO sync_bucket_events(occurred_at,mirror_url,handle,lane,granted,tokens_before,tokens_after,retry_at)
      VALUES(?,?,?,?,?,?,?,?)`)
      .run(nowIso, mirror.url, work.handle, work.lane, grant.granted ? 1 : 0, grant.tokensBefore, grant.tokensAfter, grant.retryAtMs === null ? null : new Date(grant.retryAtMs).toISOString())
    return grant
  })()
}
