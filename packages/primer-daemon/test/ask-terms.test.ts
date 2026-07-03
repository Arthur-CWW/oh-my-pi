import { describe, expect, test } from "bun:test"

import { extractTerms } from "../src/cli"

describe("extractTerms", () => {
  test("strips question stopwords while keeping content tokens", () => {
    const terms = extractTerms("what have I been reading about spaced repetition")

    expect(terms).toContain("spaced")
    expect(terms).toContain("repetition")
    expect(terms).not.toContain("what")
    expect(terms).not.toContain("have")
    expect(terms).not.toContain("been")
    expect(terms).not.toContain("about")
  })

  test("keeps quoted phrases whole", () => {
    const terms = extractTerms('compare "spaced repetition" against memory systems')

    expect(terms).toContain("spaced repetition")
  })

  test("drops tokens shorter than three characters", () => {
    const terms = extractTerms("AI in spaced repetition")

    expect(terms).toContain("spaced")
    expect(terms).toContain("repetition")
    expect(terms).not.toContain("ai")
    expect(terms).not.toContain("in")
  })
})
