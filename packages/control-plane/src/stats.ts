import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { Database } from "bun:sqlite"
import { Effect } from "effect"

import { StorageError } from "./errors"
import { migrateLedger, setDurabilityPragmas } from "./migrate"

export interface UsageByLaneHourRow {
  readonly lane: string
  readonly hourBucket: number
  readonly calls: number
  readonly tokensIn: number
  readonly tokensOut: number
  readonly cacheRead: number
  readonly cost: number
  readonly avgLatencyMs: number
  readonly tokensPerMinute: number
  readonly tokensPerSecond: number | null
  readonly avgTtftMs: number | null
  readonly reasoningTokens: number
}

export interface UsageByAgentRow {
  readonly agent: string
  readonly lane: string
  readonly calls: number
  readonly tokensIn: number
  readonly tokensOut: number
  readonly cacheRead: number
  readonly cost: number
  readonly avgLatencyMs: number
  readonly firstTs: number
  readonly lastTs: number
  readonly tokensPerMinute: number
  readonly tokensPerSecond: number | null
  readonly avgTtftMs: number | null
  readonly reasoningTokens: number
}

export interface UsageBySessionRow {
  readonly session: string
  readonly lane: string
  readonly calls: number
  readonly tokensIn: number
  readonly tokensOut: number
  readonly cacheRead: number
  readonly cost: number
  readonly avgLatencyMs: number
  readonly firstTs: number
  readonly lastTs: number
  readonly tokensPerMinute: number
  readonly tokensPerSecond: number | null
  readonly avgTtftMs: number | null
  readonly reasoningTokens: number
}

export interface StatsFilters {
  readonly sinceTs?: number
}

export function queryUsageByLaneHour(dbPath: string, filters: StatsFilters = {}): Effect.Effect<UsageByLaneHourRow[], StorageError> {
  return storageEffect("queryUsageByLaneHour", () =>
    withDb(dbPath, (sqlite) => {
      if (filters.sinceTs !== undefined) {
        return sqlite.query<UsageByLaneHourRow, [number]>(`
          SELECT
            provider || '/' || model AS lane,
            (ts / 3600000) * 3600000 AS hourBucket,
            COUNT(*) AS calls,
            SUM(tokensIn) AS tokensIn,
            SUM(tokensOut) AS tokensOut,
            SUM(cacheRead) AS cacheRead,
            SUM(cost) AS cost,
            CAST(ROUND(AVG(latencyMs)) AS INTEGER) AS avgLatencyMs,
            ROUND((SUM(tokensIn) + SUM(tokensOut)) / 60.0, 2) AS tokensPerMinute,
            ROUND(SUM(tokensOut) / NULLIF(SUM(latencyMs) / 1000.0, 0), 2) AS tokensPerSecond,
            CAST(ROUND(AVG(ttftMs)) AS INTEGER) AS avgTtftMs,
            SUM(COALESCE(reasoningTokens, 0)) AS reasoningTokens
          FROM model_calls
          WHERE ts >= ?
          GROUP BY lane, hourBucket
          ORDER BY hourBucket DESC
        `).all(filters.sinceTs)
      }
      return sqlite.query<UsageByLaneHourRow, []>(`
        SELECT * FROM usage_by_lane_hour ORDER BY hourBucket DESC
      `).all()
    }),
  )
}

export function queryUsageByAgent(dbPath: string, filters: StatsFilters = {}): Effect.Effect<UsageByAgentRow[], StorageError> {
  return storageEffect("queryUsageByAgent", () =>
    withDb(dbPath, (sqlite) => {
      if (filters.sinceTs !== undefined) {
        return sqlite.query<UsageByAgentRow, [number]>(`
          SELECT
            agent,
            provider || '/' || model AS lane,
            COUNT(*) AS calls,
            SUM(tokensIn) AS tokensIn,
            SUM(tokensOut) AS tokensOut,
            SUM(cacheRead) AS cacheRead,
            SUM(cost) AS cost,
            CAST(ROUND(AVG(latencyMs)) AS INTEGER) AS avgLatencyMs,
            MIN(ts) AS firstTs,
            MAX(ts) AS lastTs,
            CASE
              WHEN MAX(ts) = MIN(ts) THEN 0.0
              ELSE ROUND((SUM(tokensIn) + SUM(tokensOut)) * 60000.0 / (MAX(ts) - MIN(ts)), 2)
            END AS tokensPerMinute,
            ROUND(SUM(tokensOut) / NULLIF(SUM(latencyMs) / 1000.0, 0), 2) AS tokensPerSecond,
            CAST(ROUND(AVG(ttftMs)) AS INTEGER) AS avgTtftMs,
            SUM(COALESCE(reasoningTokens, 0)) AS reasoningTokens
          FROM model_calls
          WHERE ts >= ?
          GROUP BY agent, lane
          ORDER BY SUM(tokensIn) + SUM(tokensOut) DESC
        `).all(filters.sinceTs)
      }
      return sqlite.query<UsageByAgentRow, []>(`
        SELECT * FROM usage_by_agent ORDER BY tokensIn + tokensOut DESC
      `).all()
    }),
  )
}

export function queryUsageBySession(dbPath: string, filters: StatsFilters = {}): Effect.Effect<UsageBySessionRow[], StorageError> {
  return storageEffect("queryUsageBySession", () =>
    withDb(dbPath, (sqlite) => {
      if (filters.sinceTs !== undefined) {
        return sqlite.query<UsageBySessionRow, [number]>(`
          SELECT
            session,
            provider || '/' || model AS lane,
            COUNT(*) AS calls,
            SUM(tokensIn) AS tokensIn,
            SUM(tokensOut) AS tokensOut,
            SUM(cacheRead) AS cacheRead,
            SUM(cost) AS cost,
            CAST(ROUND(AVG(latencyMs)) AS INTEGER) AS avgLatencyMs,
            MIN(ts) AS firstTs,
            MAX(ts) AS lastTs,
            CASE
              WHEN MAX(ts) = MIN(ts) THEN 0.0
              ELSE ROUND((SUM(tokensIn) + SUM(tokensOut)) * 60000.0 / (MAX(ts) - MIN(ts)), 2)
            END AS tokensPerMinute,
            ROUND(SUM(tokensOut) / NULLIF(SUM(latencyMs) / 1000.0, 0), 2) AS tokensPerSecond,
            CAST(ROUND(AVG(ttftMs)) AS INTEGER) AS avgTtftMs,
            SUM(COALESCE(reasoningTokens, 0)) AS reasoningTokens
          FROM model_calls
          WHERE ts >= ?
          GROUP BY session, lane
          ORDER BY MAX(ts) DESC
        `).all(filters.sinceTs)
      }
      return sqlite.query<UsageBySessionRow, []>(`
        SELECT * FROM usage_by_session
      `).all()
    }),
  )
}

function withDb<T>(dbPath: string, fn: (sqlite: Database) => T): T {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(resolve(dbPath)), { recursive: true })
  }
  const sqlite = new Database(dbPath)
  try {
    setDurabilityPragmas(sqlite)
    migrateLedger(sqlite)
    return fn(sqlite)
  } finally {
    sqlite.close()
  }
}

function storageEffect<A>(operation: string, run: () => A): Effect.Effect<A, StorageError> {
  return Effect.try({
    try: run,
    catch: (cause) => new StorageError({
      operation,
      message: cause instanceof Error ? cause.message : String(cause),
      cause: cause instanceof Error ? cause.message : String(cause),
    }),
  })
}
