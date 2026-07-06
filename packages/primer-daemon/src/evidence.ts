import type { DaemonPaths } from "./paths"
import { rankEvidence } from "./rank"
import type { EvidenceHit, EvidenceSource, SearchResult } from "./schema"
import { recentBrowser, searchBrowser } from "./substrate/browser"
import { searchCards } from "./substrate/cards"
import { searchReader } from "./substrate/reader"
import { recentTweets, searchTwitter } from "./substrate/twitter"

export interface EvidenceSet {
  hits: EvidenceHit[]
  skipped: string[]
}

export const SUBSTRATES = ["browser", "twitter", "reader", "cards"] as const satisfies readonly EvidenceSource[]

export function searchEvidence(
  paths: DaemonPaths,
  terms: readonly string[],
  source: EvidenceSource | undefined,
  limit: number,
): EvidenceSet {
  const hits: EvidenceHit[] = []
  const skipped: string[] = []
  const substrateLimit = Math.max(limit, 250)

  for (const substrate of SUBSTRATES) {
    if (source !== undefined && source !== substrate) continue
    const result = searchSubstrate(paths, substrate, terms, substrateLimit)
    hits.push(...result.hits)
    if (result.skipped !== undefined) skipped.push(result.skipped)
  }

  return { hits: rankEvidence(hits, terms, { limit }), skipped }
}

/**
 * Retrieval for natural questions: OR across terms (one single-term search
 * per term), dedupe by ref, then rank with the full term list so hits
 * covering more terms rise. `search` keeps strict AND semantics.
 */
export function askEvidence(paths: DaemonPaths, terms: readonly string[], limit: number): EvidenceSet {
  const byRef = new Map<string, EvidenceHit>()
  const skipped = new Set<string>()
  const substrateLimit = Math.max(limit, 250)

  for (const substrate of SUBSTRATES) {
    for (const term of terms) {
      const result = searchSubstrate(paths, substrate, [term], substrateLimit)
      for (const hit of result.hits) {
        if (!byRef.has(hit.ref)) byRef.set(hit.ref, hit)
      }
      if (result.skipped !== undefined) skipped.add(result.skipped)
    }
  }

  return { hits: rankEvidence([...byRef.values()], terms, { limit }), skipped: [...skipped] }
}

export function recentEvidence(paths: DaemonPaths, days: number, limit: number): EvidenceSet {
  const hits: EvidenceHit[] = []
  const skipped: string[] = []

  appendResult(recentBrowser(paths.browserDb, days, limit), hits, skipped)
  appendResult(recentTweets(paths.twitterDb, limit), hits, skipped)

  return { hits: sortByNewest(hits).slice(0, limit), skipped }
}

function searchSubstrate(paths: DaemonPaths, substrate: EvidenceSource, terms: readonly string[], limit: number): SearchResult {
  if (substrate === "browser") return searchBrowser(paths.browserDb, terms, { limit })
  if (substrate === "twitter") return searchTwitter(paths.twitterDb, terms, limit)
  if (substrate === "reader") return searchReader(paths.readerDb, terms, limit)
  return searchCards(paths.learningCardsDb, terms, limit)
}

function appendResult(result: SearchResult, hits: EvidenceHit[], skipped: string[]): void {
  hits.push(...result.hits)
  if (result.skipped !== undefined) skipped.push(result.skipped)
}

function sortByNewest(hits: readonly EvidenceHit[]): EvidenceHit[] {
  return [...hits].sort((left, right) => timestampMs(right.timestamp) - timestampMs(left.timestamp))
}

function timestampMs(timestamp: string | null): number {
  if (timestamp === null) return 0
  const parsed = new Date(timestamp).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}
