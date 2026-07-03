import { describe, expect, it } from "bun:test"
import { buildGrokLoginRecoveryStep } from "../src/frontend-browser"

describe("Grok blocker recovery", () => {
  it("uses the blocked prompt and requested output file in recovery commands", () => {
    const step = buildGrokLoginRecoveryStep(
      "Find recent Grok launch posts from @xai.",
      "data/research/xai-grok-launch.md",
    )

    expect(step).toContain("pi-llm-browser setup --provider grok")
    expect(step).toContain("pi-llm-browser prompt --provider grok --no-wait --output-file 'data/research/xai-grok-launch.md' 'Find recent Grok launch posts from @xai.'")
    expect(step).toContain("pi-llm-browser wait --provider grok --session latest --response-timeout-ms 300000 --output-file 'data/research/xai-grok-launch.md'")
    expect(step).not.toContain("grok-twitter-search-openai-codex")
    expect(step).not.toContain("@openai about Codex")
  })

  it("shell-quotes prompt and output path values without substituting a sample", () => {
    const step = buildGrokLoginRecoveryStep(
      "Summarize Arthur's Grok blocker.",
      "data/research/arthur's-grok-blocker.md",
    )

    expect(step).toContain("'Summarize Arthur'\\''s Grok blocker.'")
    expect(step).toContain("--output-file 'data/research/arthur'\\''s-grok-blocker.md'")
    expect(step).not.toContain("grok-twitter-search-openai-codex")
  })

  it("omits output-file flags when no output path is available", () => {
    const step = buildGrokLoginRecoveryStep("Recover this Grok prompt.")

    expect(step).toContain("pi-llm-browser prompt --provider grok --no-wait 'Recover this Grok prompt.'")
    expect(step).toContain("pi-llm-browser wait --provider grok --session latest --response-timeout-ms 300000")
    expect(step).not.toContain("--output-file")
    expect(step).not.toContain("grok-twitter-search-openai-codex")
  })
})
