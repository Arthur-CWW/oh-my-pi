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

test("segments Han runs with CEDICT words and drops Chinese stopwords", () => {
  const terms = extractTerms("我最近在读什么？")

  expect(terms).toEqual(["最近", "读"])
})

test("keeps Latin terms alongside segmented Han terms", () => {
  const terms = extractTerms("compare React with 最近在读")

  expect(terms).toContain("react")
  expect(terms).toContain("最近")
  expect(terms).toContain("读")
})

test("falls back to Han bigrams when CEDICT is unavailable", () => {
  const terms = extractTerms("我甲乙丙", "/tmp/primer-missing-cedict.sqlite")

  expect(terms).toEqual(["甲乙", "丙"])
})
