import { existsSync } from "node:fs"
import { openReadonly } from "./open"

import {
  type EvidenceHit,
  type ReaderRow,
  type SearchResult,
  decodeEvidenceHit,
  decodeReaderRow,
} from "../schema"

interface ReaderSqlRow {
  kind: "annotation" | "source_block" | "concept"
  id: number
  url: string | null
  title: string | null
  text: string | null
  note: string | null
  tags: string | null
  shortNote: string | null
  longNote: string | null
  timestamp: string | null
}

export function searchReader(dbPath: string, terms: readonly string[], limit = 250): SearchResult {
  if (!existsSync(dbPath)) {
    return { hits: [], skipped: `missing reader DB: ${dbPath}` }
  }

  const normalizedTerms = normalizeTerms(terms)
  if (normalizedTerms.length === 0) return { hits: [] }

  const annotationWhere = buildWhere(normalizedTerms, ["title", "note", "tags"])
  const sourceBlockWhere = buildWhere(normalizedTerms, ["sb.text", "w.title"])
  const conceptWhere = buildWhere(normalizedTerms, ["title", "short_note", "long_note"])

  const db = openReadonly(dbPath)
  try {
    const rows = db
      .query<ReaderSqlRow, Array<string | number>>(
        `SELECT kind, id, url, title, text, note, tags, shortNote, longNote, timestamp
         FROM (
           SELECT 'annotation' AS kind,
                  id,
                  NULL AS url,
                  title,
                  NULL AS text,
                  note,
                  tags,
                  NULL AS shortNote,
                  NULL AS longNote,
                  created_at AS timestamp
           FROM annotations
           WHERE ${annotationWhere.clause}
           UNION ALL
           SELECT 'source_block' AS kind,
                  sb.id,
                  NULL AS url,
                  coalesce(w.title, 'source block') AS title,
                  sb.text,
                  NULL AS note,
                  NULL AS tags,
                  NULL AS shortNote,
                  NULL AS longNote,
                  NULL AS timestamp
           FROM source_blocks sb
           LEFT JOIN works w ON w.id = sb.work_id
           WHERE ${sourceBlockWhere.clause}
           UNION ALL
           SELECT 'concept' AS kind,
                  id,
                  NULL AS url,
                  title,
                  NULL AS text,
                  NULL AS note,
                  NULL AS tags,
                  short_note AS shortNote,
                  long_note AS longNote,
                  NULL AS timestamp
           FROM concepts
           WHERE ${conceptWhere.clause}
         )
         ORDER BY timestamp DESC, id DESC
         LIMIT ?`,
      )
      .all(
        ...annotationWhere.params,
        ...sourceBlockWhere.params,
        ...conceptWhere.params,
        limit,
      )
    return { hits: rows.map(decodeReaderRow).map((row) => readerRowToHit(row, normalizedTerms)) }
  } finally {
    db.close()
  }
}

function readerRowToHit(row: ReaderRow, terms: readonly string[]): EvidenceHit {
  const table = row.kind === "annotation" ? "annotations" : row.kind === "source_block" ? "source_blocks" : "concepts"
  return decodeEvidenceHit({
    source: "reader",
    kind: row.kind,
    ref: `reader:${table}:${row.id}`,
    url: row.url,
    title: row.title ?? "(untitled reader item)",
    snippet: snippetForReader(row, terms),
    timestamp: row.timestamp,
    score: 0,
  })
}

function snippetForReader(row: ReaderRow, terms: readonly string[]): string | null {
  const candidates = [row.note, row.text, row.shortNote, row.longNote, row.tags, row.title]
  for (const candidate of candidates) {
    if (candidate && containsAnyTerm(candidate, terms)) return snippetAroundTerms(candidate, terms)
  }
  for (const candidate of candidates) {
    if (candidate && candidate.trim().length > 0) return snippetAroundTerms(candidate, terms)
  }
  return null
}

function containsAnyTerm(value: string, terms: readonly string[]): boolean {
  const lower = value.toLowerCase()
  return terms.some((term) => lower.includes(term))
}

function snippetAroundTerms(text: string, terms: readonly string[]): string {
  const trimmed = text.trim()
  if (trimmed.length <= 240 && terms.length === 0) return trimmed

  const lower = trimmed.toLowerCase()
  let firstIndex = -1
  for (const term of terms) {
    const index = lower.indexOf(term)
    if (index >= 0 && (firstIndex < 0 || index < firstIndex)) firstIndex = index
  }

  if (firstIndex < 0) return trimmed.slice(0, 240)

  const start = Math.max(0, firstIndex - 80)
  const end = Math.min(trimmed.length, start + 240)
  const snippet = trimmed.slice(start, end)
  if (start === 0) return snippet
  return `…${snippet.slice(1)}`
}

function normalizeTerms(terms: readonly string[]): string[] {
  const normalized: string[] = []
  for (const term of terms) {
    const value = term.trim().toLowerCase()
    if (value.length > 0) normalized.push(value)
  }
  return normalized
}

function buildWhere(terms: readonly string[], columns: readonly string[]): { clause: string; params: string[] } {
  const clauses: string[] = []
  const params: string[] = []
  for (const term of terms) {
    const columnClause = columns.map((column) => `lower(coalesce(${column}, '')) LIKE ?`).join(" OR ")
    clauses.push(`(${columnClause})`)
    for (let index = 0; index < columns.length; index += 1) params.push(`%${term}%`)
  }
  return { clause: clauses.join(" AND "), params }
}
