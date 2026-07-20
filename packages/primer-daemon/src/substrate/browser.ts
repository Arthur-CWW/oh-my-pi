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
  readonly kind: "tab_entry" | "event"
  readonly refTable: "tabs" | "browser_events" | "tab_entries" | "events"
  readonly id: number
  readonly url: string | null
  readonly title: string | null
  readonly timestampMs: number | null
}

interface BrowserEvidenceRow extends BrowserRow {
  readonly refTable: BrowserSqlRow["refTable"]
}

interface BrowserEvidenceSchema {
  readonly canonicalTabs: boolean
  readonly canonicalEvents: boolean
  readonly legacyTabEntries: boolean
  readonly legacyEvents: boolean
}

export interface BrowserSearchOptions {
  limit?: number
}

const BROWSER_EVENT_TYPES = ["navigated", "activated"] as const
const LEGACY_BROWSER_EVENT_TYPES = ["tab_updated", "tab_activated"] as const

export function searchBrowser(dbPath: string, terms: readonly string[], opts: BrowserSearchOptions = {}): SearchResult {
  if (!existsSync(dbPath)) {
    return { hits: [], skipped: `missing browser DB: ${dbPath}` }
  }

  const normalizedTerms = normalizeTerms(terms)
  if (normalizedTerms.length === 0) return { hits: [] }

  const db = openReadonly(dbPath)
  try {
    const schema = inspectBrowserEvidenceSchema(db)
    const branches: string[] = []
    const bindings: string[] = []

    if (schema.canonicalTabs) {
      const termWhere = buildTermWhere(normalizedTerms, "tab")
      branches.push(
        `SELECT 'tab_entry' AS kind, 'tabs' AS refTable, tab.rowid AS id, tab.url, tab.title,
                unixepoch(tab.last_seen_at) * 1000 AS timestampMs
         FROM tabs tab${whereClause(["tab.eligible = 1", termWhere.clause])}`,
      )
      bindings.push(...termWhere.params)
    }
    if (schema.canonicalTabs && schema.canonicalEvents) {
      const termWhere = buildTermWhere(normalizedTerms, "tab")
      branches.push(
        `SELECT 'event' AS kind, 'browser_events' AS refTable, event.rowid AS id, tab.url, tab.title,
                unixepoch(event.at) * 1000 AS timestampMs
         FROM browser_events event
         JOIN tabs tab ON tab.tab_key = event.tab_key${whereClause([
           "tab.eligible = 1",
           `event.kind IN ('${BROWSER_EVENT_TYPES.join("', '")}')`,
           termWhere.clause,
         ])}`,
      )
      bindings.push(...termWhere.params)
    }
    if (schema.legacyTabEntries) {
      const termWhere = buildTermWhere(normalizedTerms, "entry")
      branches.push(
        `SELECT 'tab_entry' AS kind, 'tab_entries' AS refTable, entry.id, entry.url, entry.title,
                entry.last_accessed AS timestampMs
         FROM tab_entries entry${whereClause([termWhere.clause])}`,
      )
      bindings.push(...termWhere.params)
    }
    if (schema.legacyEvents) {
      const termWhere = buildTermWhere(normalizedTerms, "event")
      branches.push(
        `SELECT 'event' AS kind, 'events' AS refTable, event.id, event.url, event.title,
                event.observed_at AS timestampMs
         FROM events event${whereClause([
           `event.event_type IN ('${LEGACY_BROWSER_EVENT_TYPES.join("', '")}')`,
           termWhere.clause,
         ])}`,
      )
      bindings.push(...termWhere.params)
    }
    if (branches.length === 0) return unsupportedSchema(dbPath)

    const rows = db
      .query<BrowserSqlRow, Array<string | number>>(
        `SELECT kind, refTable, id, url, title, timestampMs
         FROM (${branches.join("\nUNION ALL\n")})
         ORDER BY timestampMs DESC
         LIMIT ?`,
      )
      .all(...bindings, (opts.limit ?? 250) * 4)
    return { hits: dedupeBrowserRows(rows.map(decodeBrowserEvidenceRow)).slice(0, opts.limit ?? 250) }
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
    const schema = inspectBrowserEvidenceSchema(db)
    const branches: string[] = []
    const bindings: number[] = []

    if (schema.canonicalTabs && schema.canonicalEvents) {
      branches.push(
        `SELECT 'event' AS kind, 'browser_events' AS refTable, event.rowid AS id, tab.url, tab.title,
                unixepoch(event.at) * 1000 AS timestampMs
         FROM browser_events event
         JOIN tabs tab ON tab.tab_key = event.tab_key${whereClause([
           "tab.eligible = 1",
           `event.kind IN ('${BROWSER_EVENT_TYPES.join("', '")}')`,
           "unixepoch(event.at) * 1000 >= ?",
         ])}`,
      )
      bindings.push(sinceMs)
    }
    if (schema.legacyEvents) {
      branches.push(
        `SELECT 'event' AS kind, 'events' AS refTable, event.id, event.url, event.title,
                event.observed_at AS timestampMs
         FROM events event${whereClause([
           `event.event_type IN ('${LEGACY_BROWSER_EVENT_TYPES.join("', '")}')`,
           "event.observed_at IS NOT NULL",
           "event.observed_at >= ?",
         ])}`,
      )
      bindings.push(sinceMs)
    }
    if (branches.length === 0) return unsupportedSchema(dbPath)

    const rows = db
      .query<BrowserSqlRow, number[]>(
        `SELECT kind, refTable, id, url, title, timestampMs
         FROM (${branches.join("\nUNION ALL\n")})
         ORDER BY timestampMs DESC
         LIMIT ?`,
      )
      .all(...bindings, limit * 4)
    return { hits: dedupeBrowserRows(rows.map(decodeBrowserEvidenceRow)).slice(0, limit) }
  } finally {
    db.close()
  }
}

function dedupeBrowserRows(rows: readonly BrowserEvidenceRow[]): EvidenceHit[] {
  const newestByUrl = new Map<string, BrowserEvidenceRow>()
  const withoutUrl: BrowserEvidenceRow[] = []

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

function browserRowToHit(row: BrowserEvidenceRow): EvidenceHit {
  return decodeEvidenceHit({
    source: "browser",
    kind: row.kind,
    ref: `browser:${row.refTable}:${row.id}`,
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

function buildTermWhere(terms: readonly string[], tableAlias: string): { clause: string; params: string[] } {
  const clauses: string[] = []
  const params: string[] = []
  for (const term of terms) {
    clauses.push(`(lower(coalesce(${tableAlias}.url, '')) LIKE ? OR lower(coalesce(${tableAlias}.title, '')) LIKE ?)`)
    const like = `%${term}%`
    params.push(like, like)
  }
  return { clause: clauses.join(" AND "), params }
}

function whereClause(predicates: readonly string[]): string {
  const present = predicates.filter((predicate) => predicate.length > 0)
  return present.length === 0 ? "" : ` WHERE ${present.join(" AND ")}`
}

function inspectBrowserEvidenceSchema(database: ReturnType<typeof openReadonly>): BrowserEvidenceSchema {
  return {
    canonicalTabs: hasColumns(database, "tabs", ["tab_key", "browser", "profile_id", "window_id", "tab_id", "eligible", "url", "title", "last_seen_at"]),
    canonicalEvents: hasColumns(database, "browser_events", ["kind", "at", "tab_key"]),
    legacyTabEntries: hasColumns(database, "tab_entries", ["id", "url", "title", "last_accessed"]),
    legacyEvents: hasColumns(database, "events", ["id", "event_type", "observed_at", "url", "title"]),
  }
}

function hasColumns(
  database: ReturnType<typeof openReadonly>,
  table: "tabs" | "browser_events" | "tab_entries" | "events",
  required: readonly string[],
): boolean {
  const exists = database
    .query<{ readonly present: number }, [string]>(
      "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ?",
    )
    .get(table)
  if (exists === null) return false
  const columns = new Set(
    database.query<{ readonly name: string }, []>(`PRAGMA table_info("${table}")`).all().map((column) => column.name),
  )
  return required.every((column) => columns.has(column))
}

function decodeBrowserEvidenceRow(row: BrowserSqlRow): BrowserEvidenceRow {
  return {
    ...decodeBrowserRow(row),
    refTable: row.refTable,
  }
}

function unsupportedSchema(dbPath: string): never {
  throw new Error(`Unsupported browser evidence schema: ${dbPath}`)
}

export { BROWSER_EVENT_TYPES }
