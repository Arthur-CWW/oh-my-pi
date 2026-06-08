import { describe, expect, it } from "bun:test"
import { looksLikeBlockedPage, shouldReturnEarly } from "../src/fetch"

describe("fetch browser fallback heuristics", () => {
  it("detects common challenge pages", () => {
    expect(looksLikeBlockedPage(
      "Just a moment...",
      "Verification successful. Waiting for openai.com to respond",
      '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>',
    )).toBe(true)
  })

  it("does not flag normal article pages", () => {
    expect(looksLikeBlockedPage(
      "Harness engineering: leveraging Codex in an agent-first world",
      "Over the past five months, our team has been running an experiment.",
      "<main><article><h1>Harness engineering</h1></article></main>",
    )).toBe(false)
  })

  it("keeps 403s and 429s eligible for fallback but short-circuits hard 404s", () => {
    expect(shouldReturnEarly("HTTP 403")).toBe(false)
    expect(shouldReturnEarly("HTTP 429")).toBe(false)
    expect(shouldReturnEarly("HTTP 404")).toBe(true)
  })
})
