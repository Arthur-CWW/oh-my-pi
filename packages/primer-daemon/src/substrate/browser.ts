import { existsSync } from "node:fs"
import { openReadonly } from "./open"

import {
  type BrowserRow,
  type EvidenceHit,
  type SearchResult,
  decodeBrowserRow,
  decodeEvidenceHit,
} from "../schema"

interface BrowserSqlRow {
  kind: "tab_entry" | "event"
  id: number
  url: string | null
  title: string | null
  timestampMs: number | null
}

export interface BrowserSearchOptions {
  limit?: number
}

const BROWSER_EVENT_TYPES = ["tab_updated", "tab_activated"] as const

export function searchBrowser(dbPath: string, terms: readonly string[], opts: BrowserSearchOptions = {}): SearchResult {
  if (!existsSync(dbPath)) {
    return { hits: [], skipped: `missing browser DB: ${dbPath}` }
  }

  const normalizedTerms = normalizeTerms(terms)
  if (normalizedTerms.length === 0) return { hits: [] }

  const db = openReadonly(dbPath)
  try {
    const termWhere = buildTermWhere(normalizedTerms)
    const rows = db
      .query<BrowserSqlRow, string[]>(
        `SELECT kind, id, url, title, timestampMs
         FROM (
           SELECT 'tab_entry' AS kind, id, url, title, last_accessed AS timestampMs
           FROM tab_entries
           WHERE ${termWhere.clause}
           UNION ALL
           SELECT 'event' AS kind, id, url, title, observed_at AS timestampMs
           FROM events
           WHERE event_type IN ('tab_updated', 'tab_activated') AND ${termWhere.clause}
         )
         ORDER BY timestampMs DESC
         LIMIT ?`,
      )
      .all(...termWhere.params, ...termWhere.params, String((opts.limit ?? 250) * 4))
    return { hits: dedupeBrowserRows(rows.map(decodeBrowserRow)).slice(0, opts.limit ?? 250) }
  } finally {
    db.close()
  }
}

export function recentBrowser(dbPath: string, days: number, limit: number): SearchResult {
  if (!existsSync(dbPath)) {
    return { hits: [], skipped: `missing browser DB: ${dbPath}` }
  }

  const sinceMs = Date.now() - Math.max(0, days) * 86_400_000
  const db = openReadonly(dbPath)
  try {
    const rows = db
      .query<BrowserSqlRow, [number, number]>(
        `SELECT 'event' AS kind, id, url, title, observed_at AS timestampMs
         FROM events
         WHERE event_type IN ('tab_updated', 'tab_activated')
           AND observed_at IS NOT NULL
           AND observed_at >= ?
         ORDER BY observed_at DESC
         LIMIT ?`,
      )
      .all(sinceMs, limit * 4)
    return { hits: dedupeBrowserRows(rows.map(decodeBrowserRow)).slice(0, limit) }
  } finally {
    db.close()
  }
}

function dedupeBrowserRows(rows: readonly BrowserRow[]): EvidenceHit[] {
  const newestByUrl = new Map<string, BrowserRow>()
  const withoutUrl: BrowserRow[] = []

  for (const row of rows) {
    if (row.url === null || row.url.length === 0) {
      withoutUrl.push(row)
      continue
    }

    const previous = newestByUrl.get(row.url)
    if (!previous || (row.timestampMs ?? 0) > (previous.timestampMs ?? 0)) {
      newestByUrl.set(row.url, row)
    }
  }

  return [...newestByUrl.values(), ...withoutUrl]
    .sort((left, right) => (right.timestampMs ?? 0) - (left.timestampMs ?? 0))
    .map(browserRowToHit)
}

function browserRowToHit(row: BrowserRow): EvidenceHit {
  return decodeEvidenceHit({
    source: "browser",
    kind: row.kind,
    ref: `browser:${row.kind === "tab_entry" ? "tab_entries" : "events"}:${row.id}`,
    url: row.url,
    title: row.title ?? row.url ?? "(untitled browser item)",
    snippet: null,
    timestamp: row.timestampMs === null ? null : new Date(row.timestampMs).toISOString(),
    score: 0,
  })
}

function normalizeTerms(terms: readonly string[]): string[] {
  const normalized: string[] = []
  for (const term of terms) {
    const value = term.trim().toLowerCase()
    if (value.length > 0) normalized.push(value)
  }
  return normalized
}

function buildTermWhere(terms: readonly string[]): { clause: string; params: string[] } {
  const clauses: string[] = []
  const params: string[] = []
  for (const term of terms) {
    clauses.push("(lower(coalesce(url, '')) LIKE ? OR lower(coalesce(title, '')) LIKE ?)")
    const like = `%${term}%`
    params.push(like, like)
  }
  return { clause: clauses.join(" AND "), params }
}

export { BROWSER_EVENT_TYPES }
