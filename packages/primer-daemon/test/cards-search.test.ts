import { describe, expect, test } from "bun:test"

import { resolveDaemonPaths } from "../src/paths"
import { searchCards } from "../src/substrate/cards"

const LEARNING_CARDS_DB = resolveDaemonPaths({}).learningCardsDb
const MISSING_CARDS_DB = `${LEARNING_CARDS_DB}.missing`

describe("searchCards", () => {
  test("searches the real learning-card sqlite with cards provenance refs", () => {
    const result = searchCards(LEARNING_CARDS_DB, ["gradient"], 10)

    expect(result.skipped).toBeUndefined()
    expect(result.hits.length).toBeGreaterThanOrEqual(1)
    expect(result.hits.every((hit) => hit.source === "cards")).toBe(true)
    expect(result.hits.some((hit) => /^cards:(concept_nodes|tacit_moves|card_candidates):[^:]+$/u.test(hit.ref))).toBe(true)
  })

  test("searches learning-card tacit moves and card candidates", () => {
    const result = searchCards(LEARNING_CARDS_DB, ["learning"], 10)

    expect(result.skipped).toBeUndefined()
    expect(result.hits.length).toBeGreaterThanOrEqual(1)
    expect(result.hits.some((hit) => hit.ref.startsWith("cards:tacit_moves:") || hit.ref.startsWith("cards:card_candidates:"))).toBe(true)
  })

  test("returns empty hits for a missing sqlite path", () => {
    const result = searchCards(MISSING_CARDS_DB, ["gradient"], 10)

    expect(result.hits).toEqual([])
    expect(result.skipped).toContain("missing cards DB")
  })
})
