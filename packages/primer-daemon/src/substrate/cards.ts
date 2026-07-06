import { existsSync } from "node:fs"
import { openReadonly } from "./open"

import {
  type CardsRow,
  type EvidenceHit,
  type SearchResult,
  decodeCardsRow,
  decodeEvidenceHit,
} from "../schema"

interface CardsSqlRow {
  kind: "concept_node" | "tacit_move" | "card_candidate"
  id: string
  title: string | null
  primaryText: string | null
  secondaryText: string | null
  tertiaryText: string | null
}

export function searchCards(dbPath: string, terms: readonly string[], limit = 250): SearchResult {
  if (!existsSync(dbPath)) {
    return { hits: [], skipped: `missing cards DB: ${dbPath}` }
  }

  const normalizedTerms = normalizeTerms(terms)
  if (normalizedTerms.length === 0) return { hits: [] }

  const conceptWhere = buildWhere(normalizedTerms, ["name", "common_confusions", "micro_examples"])
  const tacitWhere = buildWhere(normalizedTerms, ["move", "if_then"])
  const candidateWhere = buildWhere(normalizedTerms, ["title", "prompt", "expected_answer"])

  const db = openReadonly(dbPath)
  try {
    const rows = db
      .query<CardsSqlRow, Array<string | number>>(
        `SELECT kind, id, title, primaryText, secondaryText, tertiaryText
         FROM (
           SELECT 'concept_node' AS kind,
                  id,
                  name AS title,
                  common_confusions AS primaryText,
                  micro_examples AS secondaryText,
                  name AS tertiaryText
           FROM concept_nodes
           WHERE ${conceptWhere.clause}
           UNION ALL
           SELECT 'tacit_move' AS kind,
                  id,
                  move AS title,
                  if_then AS primaryText,
                  move AS secondaryText,
                  category AS tertiaryText
           FROM tacit_moves
           WHERE ${tacitWhere.clause}
           UNION ALL
           SELECT 'card_candidate' AS kind,
                  id,
                  title,
                  prompt AS primaryText,
                  expected_answer AS secondaryText,
                  type AS tertiaryText
           FROM card_candidates
           WHERE ${candidateWhere.clause}
         )
         ORDER BY id
         LIMIT ?`,
      )
      .all(
        ...conceptWhere.params,
        ...tacitWhere.params,
        ...candidateWhere.params,
        limit,
      )
    return { hits: rows.map(decodeCardsRow).map((row) => cardsRowToHit(row, normalizedTerms)) }
  } finally {
    db.close()
  }
}

function cardsRowToHit(row: CardsRow, terms: readonly string[]): EvidenceHit {
  const table = row.kind === "concept_node" ? "concept_nodes" : row.kind === "tacit_move" ? "tacit_moves" : "card_candidates"
  return decodeEvidenceHit({
    source: "cards",
    kind: row.kind,
    ref: `cards:${table}:${row.id}`,
    url: null,
    title: row.title ?? "(untitled card substrate item)",
    snippet: snippetForCards(row, terms),
    timestamp: null,
    score: 0,
  })
}

function snippetForCards(row: CardsRow, terms: readonly string[]): string | null {
  const candidates = [row.primaryText, row.secondaryText, row.tertiaryText, row.title]
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
