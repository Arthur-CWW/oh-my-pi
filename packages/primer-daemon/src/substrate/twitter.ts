import { existsSync } from "node:fs"
import { openReadonly } from "./open"

import {
  type EvidenceHit,
  type SearchResult,
  type TwitterRow,
  decodeEvidenceHit,
  decodeTwitterRow,
} from "../schema"

interface TwitterSqlRow {
  id: string
  username: string | null
  url: string | null
  text: string | null
  capturedAt: string
}

export function searchTwitter(dbPath: string, terms: readonly string[], limit = 250): SearchResult {
  if (!existsSync(dbPath)) {
    return { hits: [], skipped: `missing twitter DB: ${dbPath}` }
  }

  const normalizedTerms = normalizeTerms(terms)
  if (normalizedTerms.length === 0) return { hits: [] }

  const termWhere = buildTweetWhere(normalizedTerms)
  const db = openReadonly(dbPath)
  try {
    const rows = db
      .query<TwitterSqlRow, Array<string | number>>(
        `SELECT id,
                username,
                url,
                json_extract(data_json, '$.text') AS text,
                captured_at AS capturedAt
         FROM tweets
         WHERE ${termWhere.clause}
         ORDER BY datetime(captured_at) DESC
         LIMIT ?`,
      )
      .all(...termWhere.params, limit)
    return { hits: rows.map(decodeTwitterRow).map((row) => tweetRowToHit(row, normalizedTerms)) }
  } finally {
    db.close()
  }
}

export function recentTweets(dbPath: string, limit: number): SearchResult {
  if (!existsSync(dbPath)) {
    return { hits: [], skipped: `missing twitter DB: ${dbPath}` }
  }

  const db = openReadonly(dbPath)
  try {
    const rows = db
      .query<TwitterSqlRow, [number]>(
        `SELECT id,
                username,
                url,
                json_extract(data_json, '$.text') AS text,
                captured_at AS capturedAt
         FROM tweets
         ORDER BY datetime(captured_at) DESC
         LIMIT ?`,
      )
      .all(limit)
    return { hits: rows.map(decodeTwitterRow).map((row) => tweetRowToHit(row, [])) }
  } finally {
    db.close()
  }
}

function tweetRowToHit(row: TwitterRow, terms: readonly string[]): EvidenceHit {
  const username = row.username ?? "unknown"
  return decodeEvidenceHit({
    source: "twitter",
    kind: "tweet",
    ref: `twitter:tweets:${row.id}`,
    url: row.url,
    title: `@${username}`,
    snippet: snippetAroundTerms(row.text ?? "", terms),
    timestamp: row.capturedAt,
    score: 0,
  })
}

function snippetAroundTerms(text: string, terms: readonly string[]): string | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
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

function buildTweetWhere(terms: readonly string[]): { clause: string; params: string[] } {
  const clauses: string[] = []
  const params: string[] = []
  for (const term of terms) {
    clauses.push("(lower(coalesce(json_extract(data_json, '$.text'), '')) LIKE ? OR lower(coalesce(username, '')) LIKE ?)")
    const like = `%${term}%`
    params.push(like, like)
  }
  return { clause: clauses.join(" AND "), params }
}
