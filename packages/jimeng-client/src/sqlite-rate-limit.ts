import { randomUUID } from "node:crypto"
import { Database } from "bun:sqlite"

export type JimengRateLimitOperation = "submit" | "poll" | "download"

export interface JimengRateLimitKey {
  accountKey: string
  sessionHash?: string
  operation: JimengRateLimitOperation
}

export interface JimengSlidingWindowAcquireInput extends JimengRateLimitKey {
  maxEvents: number
  windowMs: number
}

export interface JimengConcurrencyAcquireInput extends JimengRateLimitKey {
  maxConcurrent: number
  ttlMs: number
  leaseId?: string
}

export interface JimengRateLimitDecision {
  allowed: boolean
  key: JimengRateLimitKey
  limit: number
  remaining: number
  resetAtMs: number
  retryAfterMs: number
}

export interface JimengConcurrencyLease {
  leaseId: string
  key: JimengRateLimitKey
  expiresAtMs: number
  release: () => boolean
}

export interface JimengConcurrencyDecision {
  allowed: boolean
  key: JimengRateLimitKey
  limit: number
  inFlight: number
  retryAfterMs: number
  lease: JimengConcurrencyLease | null
}

export interface JimengSqliteRateLimiterOptions {
  path: string
  nowMs?: () => number
  eventRetentionMs?: number
}

export interface JimengSqliteRateLimiter {
  acquireSlidingWindow(input: JimengSlidingWindowAcquireInput): JimengRateLimitDecision
  acquireConcurrency(input: JimengConcurrencyAcquireInput): JimengConcurrencyDecision
  releaseConcurrency(leaseId: string): boolean
  cleanup(nowMs?: number): void
  close(): void
}

interface CountRow {
  count: number
}

interface OldestEventRow {
  created_at_ms: number
}

interface EarliestLockRow {
  expires_at_ms: number
}

const EMPTY_SESSION_HASH = ""

export function createJimengSqliteRateLimiter(options: JimengSqliteRateLimiterOptions): JimengSqliteRateLimiter {
  return new BunSqliteJimengRateLimiter(options)
}

class BunSqliteJimengRateLimiter implements JimengSqliteRateLimiter {
  private readonly db: Database
  private readonly nowMs: () => number
  private readonly eventRetentionMs: number

  constructor(options: JimengSqliteRateLimiterOptions) {
    this.db = new Database(options.path)
    this.nowMs = options.nowMs ?? Date.now
    this.eventRetentionMs = options.eventRetentionMs ?? 86_400_000
    assertPositiveInteger(this.eventRetentionMs, "eventRetentionMs")
    this.initialize()
  }

  acquireSlidingWindow(input: JimengSlidingWindowAcquireInput): JimengRateLimitDecision {
    assertPositiveInteger(input.maxEvents, "maxEvents")
    assertPositiveInteger(input.windowMs, "windowMs")

    const now = this.nowMs()
    const sessionHash = input.sessionHash ?? EMPTY_SESSION_HASH
    const windowStart = now - input.windowMs

    this.db.exec("BEGIN IMMEDIATE")
    try {
      this.deleteExpiredRows(now, windowStart)
      const count = this.countEvents(input.accountKey, sessionHash, input.operation, windowStart)
      if (count >= input.maxEvents) {
        const oldest = this.oldestEvent(input.accountKey, sessionHash, input.operation, windowStart)
        const resetAtMs = oldest === null ? now + input.windowMs : oldest + input.windowMs
        this.db.exec("COMMIT")
        return {
          allowed: false,
          key: decisionKey(input),
          limit: input.maxEvents,
          remaining: 0,
          resetAtMs,
          retryAfterMs: Math.max(0, resetAtMs - now),
        }
      }

      this.db
        .prepare(`
          INSERT INTO jimeng_rate_limit_events (account_key, session_hash, operation, created_at_ms)
          VALUES (?, ?, ?, ?)
        `)
        .run(input.accountKey, sessionHash, input.operation, now)

      this.db.exec("COMMIT")
      return {
        allowed: true,
        key: decisionKey(input),
        limit: input.maxEvents,
        remaining: input.maxEvents - count - 1,
        resetAtMs: now + input.windowMs,
        retryAfterMs: 0,
      }
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }

  acquireConcurrency(input: JimengConcurrencyAcquireInput): JimengConcurrencyDecision {
    assertPositiveInteger(input.maxConcurrent, "maxConcurrent")
    assertPositiveInteger(input.ttlMs, "ttlMs")

    const now = this.nowMs()
    const sessionHash = input.sessionHash ?? EMPTY_SESSION_HASH

    this.db.exec("BEGIN IMMEDIATE")
    try {
      this.deleteExpiredLocks(now)
      const inFlight = this.countLocks(input.accountKey, sessionHash, input.operation)
      if (inFlight >= input.maxConcurrent) {
        const earliest = this.earliestLockExpiry(input.accountKey, sessionHash, input.operation)
        this.db.exec("COMMIT")
        return {
          allowed: false,
          key: decisionKey(input),
          limit: input.maxConcurrent,
          inFlight,
          retryAfterMs: Math.max(0, (earliest ?? now) - now),
          lease: null,
        }
      }

      const leaseId = input.leaseId ?? randomUUID()
      const expiresAtMs = now + input.ttlMs
      this.db
        .prepare(`
          INSERT INTO jimeng_rate_limit_locks (
            lease_id,
            account_key,
            session_hash,
            operation,
            acquired_at_ms,
            expires_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(leaseId, input.accountKey, sessionHash, input.operation, now, expiresAtMs)

      this.db.exec("COMMIT")
      return {
        allowed: true,
        key: decisionKey(input),
        limit: input.maxConcurrent,
        inFlight: inFlight + 1,
        retryAfterMs: 0,
        lease: {
          leaseId,
          key: decisionKey(input),
          expiresAtMs,
          release: () => this.releaseConcurrency(leaseId),
        },
      }
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }

  releaseConcurrency(leaseId: string): boolean {
    const result = this.db.prepare("DELETE FROM jimeng_rate_limit_locks WHERE lease_id = ?").run(leaseId)
    return result.changes > 0
  }

  cleanup(nowMs = this.nowMs()): void {
    this.deleteExpiredLocks(nowMs)
    this.deleteEventsOlderThan(nowMs - this.eventRetentionMs)
  }

  close(): void {
    this.db.close()
  }

  private initialize(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS jimeng_rate_limit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_key TEXT NOT NULL,
        session_hash TEXT NOT NULL,
        operation TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jimeng_rate_limit_events_key_created_idx
        ON jimeng_rate_limit_events (account_key, session_hash, operation, created_at_ms);

      CREATE TABLE IF NOT EXISTS jimeng_rate_limit_locks (
        lease_id TEXT PRIMARY KEY,
        account_key TEXT NOT NULL,
        session_hash TEXT NOT NULL,
        operation TEXT NOT NULL,
        acquired_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jimeng_rate_limit_locks_key_expires_idx
        ON jimeng_rate_limit_locks (account_key, session_hash, operation, expires_at_ms);
    `)
  }

  private deleteExpiredRows(nowMs: number, windowStartMs: number): void {
    this.deleteExpiredLocks(nowMs)
    this.deleteEventsOlderThan(windowStartMs)
  }

  private deleteExpiredLocks(nowMs: number): void {
    this.db.prepare("DELETE FROM jimeng_rate_limit_locks WHERE expires_at_ms <= ?").run(nowMs)
  }

  private deleteEventsOlderThan(cutoffMs: number): void {
    this.db.prepare("DELETE FROM jimeng_rate_limit_events WHERE created_at_ms <= ?").run(cutoffMs)
  }

  private countEvents(accountKey: string, sessionHash: string, operation: JimengRateLimitOperation, windowStartMs: number): number {
    const row = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM jimeng_rate_limit_events
        WHERE account_key = ? AND session_hash = ? AND operation = ? AND created_at_ms > ?
      `)
      .get(accountKey, sessionHash, operation, windowStartMs) as CountRow | undefined
    return row?.count ?? 0
  }

  private oldestEvent(accountKey: string, sessionHash: string, operation: JimengRateLimitOperation, windowStartMs: number): number | null {
    const row = this.db
      .prepare(`
        SELECT created_at_ms
        FROM jimeng_rate_limit_events
        WHERE account_key = ? AND session_hash = ? AND operation = ? AND created_at_ms > ?
        ORDER BY created_at_ms ASC
        LIMIT 1
      `)
      .get(accountKey, sessionHash, operation, windowStartMs) as OldestEventRow | undefined
    return row?.created_at_ms ?? null
  }

  private countLocks(accountKey: string, sessionHash: string, operation: JimengRateLimitOperation): number {
    const row = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM jimeng_rate_limit_locks
        WHERE account_key = ? AND session_hash = ? AND operation = ?
      `)
      .get(accountKey, sessionHash, operation) as CountRow | undefined
    return row?.count ?? 0
  }

  private earliestLockExpiry(accountKey: string, sessionHash: string, operation: JimengRateLimitOperation): number | null {
    const row = this.db
      .prepare(`
        SELECT expires_at_ms
        FROM jimeng_rate_limit_locks
        WHERE account_key = ? AND session_hash = ? AND operation = ?
        ORDER BY expires_at_ms ASC
        LIMIT 1
      `)
      .get(accountKey, sessionHash, operation) as EarliestLockRow | undefined
    return row?.expires_at_ms ?? null
  }
}


function decisionKey(input: JimengRateLimitKey): JimengRateLimitKey {
  return input.sessionHash === undefined
    ? { accountKey: input.accountKey, operation: input.operation }
    : { accountKey: input.accountKey, sessionHash: input.sessionHash, operation: input.operation }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
}
