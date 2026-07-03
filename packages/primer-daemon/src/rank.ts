import type { EvidenceHit } from "./schema"

export interface RankOptions {
  limit?: number
  now?: Date
}

const SEVEN_DAYS_MS = 7 * 86_400_000
const THIRTY_DAYS_MS = 30 * 86_400_000

export function rankEvidence(hits: readonly EvidenceHit[], terms: readonly string[], opts: RankOptions = {}): EvidenceHit[] {
  const now = opts.now ?? new Date()
  const normalizedTerms = normalizeTerms(terms)
  return hits
    .map((hit) => ({ ...hit, score: scoreEvidenceHit(hit, normalizedTerms, now) }))
    .sort(compareRankedHits)
    .slice(0, opts.limit ?? 30)
}

export function scoreEvidenceHit(hit: EvidenceHit, terms: readonly string[], now: Date = new Date()): number {
  const normalizedTerms = normalizeTerms(terms)
  const title = hit.title.toLowerCase()
  const url = hit.url?.toLowerCase() ?? ""
  const snippet = hit.snippet?.toLowerCase() ?? ""

  let score = 0
  for (const term of normalizedTerms) {
    if (title.includes(term)) score += 2
    if (url.includes(term) || snippet.includes(term)) score += 1
  }

  return score + recencyBoost(hit.timestamp, now)
}

function recencyBoost(timestamp: string | null, now: Date): number {
  if (timestamp === null) return 0
  const time = new Date(timestamp).getTime()
  if (!Number.isFinite(time)) return 0
  const age = now.getTime() - time
  if (age < 0) return 2
  if (age <= SEVEN_DAYS_MS) return 2
  if (age <= THIRTY_DAYS_MS) return 1
  return 0
}

function compareRankedHits(left: EvidenceHit, right: EvidenceHit): number {
  const scoreDelta = right.score - left.score
  if (scoreDelta !== 0) return scoreDelta

  const rightTime = right.timestamp === null ? 0 : new Date(right.timestamp).getTime()
  const leftTime = left.timestamp === null ? 0 : new Date(left.timestamp).getTime()
  const timeDelta = rightTime - leftTime
  if (timeDelta !== 0) return timeDelta

  return left.ref.localeCompare(right.ref)
}

function normalizeTerms(terms: readonly string[]): string[] {
  const normalized: string[] = []
  for (const term of terms) {
    const value = term.trim().toLowerCase()
    if (value.length > 0) normalized.push(value)
  }
  return normalized
}
