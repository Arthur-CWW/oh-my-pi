import { describe, expect, test } from "bun:test"

import { rankEvidence, scoreEvidenceHit } from "../src/rank"
import type { EvidenceHit } from "../src/schema"

describe("rankEvidence", () => {
  test("scores title hits above url or snippet hits and applies recency boosts", () => {
    const now = new Date("2026-07-03T00:00:00.000Z")
    const titleRecent = hit({
      ref: "browser:events:1",
      source: "browser",
      title: "Matuschak notes",
      timestamp: "2026-07-02T00:00:00.000Z",
    })
    const oldUrlAndSnippet = hit({
      ref: "twitter:tweets:1",
      source: "twitter",
      url: "https://example.test/matuschak",
      snippet: "matuschak appears here too",
      timestamp: "2026-01-01T00:00:00.000Z",
    })
    const monthRecentSnippet = hit({
      ref: "reader:annotations:1",
      source: "reader",
      snippet: "matuschak appears in the reader note",
      timestamp: "2026-06-20T00:00:00.000Z",
    })

    expect(scoreEvidenceHit(titleRecent, ["matuschak"], now)).toBe(4)
    expect(scoreEvidenceHit(oldUrlAndSnippet, ["matuschak"], now)).toBe(1)
    expect(scoreEvidenceHit(monthRecentSnippet, ["matuschak"], now)).toBe(2)

    expect(rankEvidence([oldUrlAndSnippet, monthRecentSnippet, titleRecent], ["matuschak"], { now }).map((ranked) => ranked.ref)).toEqual([
      "browser:events:1",
      "reader:annotations:1",
      "twitter:tweets:1",
    ])
  })

  test("limits results and breaks ties by timestamp then ref", () => {
    const now = new Date("2026-07-03T00:00:00.000Z")
    const older = hit({ ref: "reader:concepts:2", source: "reader", title: "alpha", timestamp: "2026-01-01T00:00:00.000Z" })
    const newerA = hit({ ref: "browser:events:2", source: "browser", title: "alpha", timestamp: "2026-02-01T00:00:00.000Z" })
    const newerB = hit({ ref: "browser:events:1", source: "browser", title: "alpha", timestamp: "2026-02-01T00:00:00.000Z" })

    expect(rankEvidence([older, newerA, newerB], ["alpha"], { now, limit: 2 }).map((ranked) => ranked.ref)).toEqual([
      "browser:events:1",
      "browser:events:2",
    ])
  })
})

function hit(overrides: Partial<EvidenceHit> & Pick<EvidenceHit, "ref" | "source">): EvidenceHit {
  return {
    source: overrides.source,
    kind: overrides.source === "twitter" ? "tweet" : "event",
    ref: overrides.ref,
    url: overrides.url ?? null,
    title: overrides.title ?? "untitled",
    snippet: overrides.snippet ?? null,
    timestamp: overrides.timestamp ?? null,
    score: overrides.score ?? 0,
  }
}
