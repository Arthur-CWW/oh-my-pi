import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import {
  assertWiseRequestAllowed,
  decodeWiseStatement,
  isAllowedWiseUrl,
  redactWiseToken,
  runWiseStatementsAction,
  validateWiseStatementInterval,
} from "../src/wise-statements"

function run<E, A>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, E, never>)
}

const wiseStatementFixture = {
  currency: "GBP",
  intervalStart: "2026-01-01T00:00:00.000Z",
  intervalEnd: "2026-01-31T23:59:59.999Z",
  transactions: [
    {
      type: "DEBIT",
      date: "2026-01-15T12:34:56.000Z",
      amount: { value: -12.34, currency: "GBP" },
      totalFees: { value: 0, currency: "GBP" },
      runningBalance: { value: 123.45, currency: "GBP" },
      referenceNumber: "CARD-123",
      details: {
        type: "CARD",
        description: "Card transaction at Wise Coffee",
        category: "EATING_OUT",
      },
    },
  ],
}

describe("wise statements config", () => {
  it("prefers WISE_API_TOKEN, falls back to WISE_TOKEN, and redacts output", async () => {
    const token = "wise-live-super-secret-token"
    const primary = await run(runWiseStatementsAction({ action: "config" }, {
      WISE_API_TOKEN: token,
      WISE_TOKEN: "fallback-token",
    }))
    expect(primary.text).not.toContain(token)
    expect(JSON.stringify(primary.details)).not.toContain(token)
    expect(primary.text).toContain(redactWiseToken(token))
    expect(primary.details.action).toBe("config")
    expect(primary.details.baseUrl).toBe("https://api.wise.com")

    const fallback = await run(runWiseStatementsAction({ action: "config" }, { WISE_TOKEN: "fallback-token" }))
    expect(fallback.text).toContain(redactWiseToken("fallback-token"))
  })
})

describe("wise request allowlist", () => {
  it("allows only Wise GET requests to read-only statement endpoints", async () => {
    expect(isAllowedWiseUrl(new URL("https://api.wise.com/v1/profiles"), false)).toBe(true)
    expect(isAllowedWiseUrl(new URL("https://api.wise.com/v4/profiles/123/balances"), false)).toBe(true)
    expect(isAllowedWiseUrl(new URL("https://api.wise.com/v1/profiles/123/balance-statements/456/statement.json"), false)).toBe(true)
    expect(isAllowedWiseUrl(new URL("https://api.wise.com/v1/quotes"), false)).toBe(false)
    expect(isAllowedWiseUrl(new URL("https://api.wise-sandbox.com/v1/profiles"), false)).toBe(false)
    expect(isAllowedWiseUrl(new URL("https://api.wise-sandbox.com/v1/profiles"), true)).toBe(true)
    expect(() => assertWiseRequestAllowed("POST", new URL("https://api.wise.com/v1/profiles"), false)).toThrow("GET-only")

    const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = []
    const originalFetch = globalThis.fetch
    const mockedFetch: typeof fetch = Object.assign(
      (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url, init })
        return Promise.resolve(new Response(JSON.stringify([{ id: 123, type: "personal" }]), { status: 200 }))
      },
      { preconnect: originalFetch.preconnect },
    )
    globalThis.fetch = mockedFetch

    try {
      const result = await run(runWiseStatementsAction({ action: "profiles" }, { WISE_API_TOKEN: "wise-test-token" }))
      expect(result.details.action).toBe("profiles")
      expect(calls).toHaveLength(1)
      expect(String(calls[0]?.url)).toBe("https://api.wise.com/v1/profiles")
      expect(calls[0]?.init?.method).toBe("GET")
      expect(calls[0]?.init?.body).toBeUndefined()
      expect(calls[0]?.init?.headers).toEqual({
        accept: "application/json",
        authorization: "Bearer wise-test-token",
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("wise statement intervals", () => {
  it("rejects statement intervals longer than 469 days before fetching", async () => {
    expect(() => validateWiseStatementInterval("2026-01-01T00:00:00.000Z", "2027-04-15T00:00:00.000Z")).not.toThrow()
    expect(() => validateWiseStatementInterval("2026-01-01T00:00:00.000Z", "2027-05-01T00:00:00.000Z")).toThrow("469 days")

    const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = []
    const originalFetch = globalThis.fetch
    const mockedFetch: typeof fetch = Object.assign(
      (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url, init })
        return Promise.resolve(new Response(JSON.stringify(wiseStatementFixture), { status: 200 }))
      },
      { preconnect: originalFetch.preconnect },
    )
    globalThis.fetch = mockedFetch

    try {
      await expect(run(runWiseStatementsAction({
        action: "statement",
        profileId: "123",
        balanceId: "456",
        currency: "GBP",
        intervalStart: "2026-01-01T00:00:00.000Z",
        intervalEnd: "2027-05-01T00:00:00.000Z",
      }, { WISE_API_TOKEN: "wise-test-token" }))).rejects.toThrow("469 days")
      expect(calls).toHaveLength(0)

      const valid = await run(runWiseStatementsAction({
        action: "statement",
        profileId: "123",
        balanceId: "456",
        currency: "GBP",
        intervalStart: "2026-01-01T00:00:00.000Z",
        intervalEnd: "2026-01-31T23:59:59.999Z",
      }, { WISE_API_TOKEN: "wise-test-token" }))
      expect(valid.details.action).toBe("statement")
      expect(calls).toHaveLength(1)
      const statementUrl = new URL(String(calls[0]?.url))
      expect(statementUrl.origin).toBe("https://api.wise.com")
      expect(statementUrl.pathname).toBe("/v1/profiles/123/balance-statements/456/statement.json")
      expect(statementUrl.searchParams.get("currency")).toBe("GBP")
      expect(statementUrl.searchParams.get("type")).toBe("COMPACT")
      expect(calls[0]?.init?.method).toBe("GET")
      expect(calls[0]?.init?.body).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("wise statement decoding", () => {
  it("decodes a compact statement transaction fixture", () => {
    const statement = decodeWiseStatement(wiseStatementFixture)
    expect(statement.transactions).toHaveLength(1)
    expect(statement.transactions[0]?.date).toBe("2026-01-15T12:34:56.000Z")
    expect(statement.transactions[0]?.amount.value).toBe(-12.34)
    expect(statement.transactions[0]?.amount.currency).toBe("GBP")
    expect(statement.transactions[0]?.details?.description).toBe("Card transaction at Wise Coffee")
  })
})
