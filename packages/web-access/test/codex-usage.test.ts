import { describe, expect, it } from "bun:test"
import { extractAccountLabelFromCodexAuth } from "../src/codex-usage/account"
import { composeFooterLine, formatUsageVariants } from "../src/codex-usage/format"
import type { UsageSnapshot } from "../src/codex-usage/domain"

const theme = {
  fg: (_color: string, text: string) => text,
}

function snapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    leftPercent: { "5h": 98, "7d": 96 },
    resetInSeconds: { "5h": 4 * 3_600, "7d": 6 * 86_400 },
    isLimited: false,
    accountLabel: "wei",
    ...overrides,
  }
}

function jwt(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`
}

describe("codex usage formatting", () => {
  it("renders the compact inline usage variants", () => {
    const variants = formatUsageVariants(theme, snapshot())
    expect(variants[0]).toBe("[wei] 5h2% 7d4% ↺6d/4h")
    expect(variants[1]).toBe("[wei] 2%/4% ↺6d/4h")
    expect(variants[2]).toBe("[wei] 2%/4%")
  })

  it("preserves the right side by truncating the left side first", () => {
    const line = composeFooterLine(40, "↑103k ↓25k R1.3M $0.942 (sub) 36.0%/272k (auto)", ["[wei] 5h2% 7d4% ↺6d/4h (openai-codex) gpt-5.4• xhigh", "gpt-5.4• xhigh"])
    expect(line.endsWith("gpt-5.4• xhigh")).toBe(true)
  })
})

describe("codex account extraction", () => {
  it("extracts the first three account letters from a codex id token", () => {
    expect(extractAccountLabelFromCodexAuth({
      tokens: {
        id_token: jwt({ email: "we.i+tests@gmail.com" }),
      },
    })).toBe("wei")
  })

  it("returns null when no account email is available", () => {
    expect(extractAccountLabelFromCodexAuth({ tokens: {} })).toBeNull()
  })
})
