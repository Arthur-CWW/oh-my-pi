import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengCommercePricingRequest,
  createJimengHttpTransport,
  fetchJimengCommercePricing,
  JimengClient,
  JimengError,
  parseJimengCommercePricingEndpoints,
  readJimengHttpCassette,
  summarizeJimengCommercePricing,
  type JimengFetch,
  type JimengSessionBundle,
  type JsonObject,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("Jimeng commerce pricing", () => {
  test("parses endpoint selector flags and builds frontend request bodies", () => {
    expect(parseJimengCommercePricingEndpoints(undefined)).toEqual(["vip", "credit"])
    expect(parseJimengCommercePricingEndpoints("all")).toEqual(["vip", "credit"])
    expect(parseJimengCommercePricingEndpoints("vip,credit,vip")).toEqual(["vip", "credit"])
    expect(() => parseJimengCommercePricingEndpoints("refunds")).toThrow(JimengError)

    expect(buildJimengCommercePricingRequest("vip")).toEqual({
      aid: 513695,
      region: "cn",
      platform: 7,
      scene: "vip",
    })
    expect(buildJimengCommercePricingRequest("credit")).toEqual({
      goodsTypes: ["credit"],
    })
  })

  test("fetches signed VIP and credit pricing and summarizes without session leakage", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({ fetch: mockFetch(requests) })

    const result = await fetchJimengCommercePricing({
      client,
      session,
      nowMs: 1_771_234_567_000,
    })
    const summary = summarizeJimengCommercePricing(result)

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/commerce/v1/subscription/price_list",
      "/commerce/v1/purchase/price_list",
    ])
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(buildJimengCommercePricingRequest("vip"))
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual(buildJimengCommercePricingRequest("credit"))
    for (const request of requests) {
      const endpoint = new URL(request.url).pathname
      const headers = request.init?.headers as Record<string, string>
      expect(headers.sign).toBe(createHash("md5").update(`9e2c|${endpoint.slice(-7)}|7|8.4.0|1771234567||11ac`).digest("hex"))
      expect(headers.cookie).toBe("sid=test")
    }

    expect(result.results[0]).toMatchObject({
      endpointId: "vip",
      ret: "0",
      items: [
        {
          productId: "vip_monthly",
          totalAmount: 6900,
          currencyCode: "CNY",
          priceType: "subscribe",
          vipCreditAmount: 1000,
          benefitTexts: ["1000 credits", "Commercial use"],
        },
      ],
      tabs: [
        {
          tabName: "Monthly",
          asDefault: true,
          productIds: ["vip_monthly"],
        },
      ],
      defaultProductId: "vip_monthly",
    })
    expect(result.results[1]).toMatchObject({
      endpointId: "credit",
      items: [
        {
          productId: "credits_100",
          totalAmount: 990,
          currencyCode: "CNY",
          priceType: "one_time",
        },
      ],
    })
    expect(summary).toMatchObject({
      result_count: 2,
      results: [
        {
          endpoint_id: "vip",
          item_count: 1,
          tab_count: 1,
          product_ids: ["vip_monthly"],
          price_types: ["subscribe"],
          total_amount_min: 6900,
          vip_credit_amount_max: 1000,
        },
        {
          endpoint_id: "credit",
          item_count: 1,
          product_ids: ["credits_100"],
          price_types: ["one_time"],
          total_amount_max: 990,
        },
      ],
    })
    expect(JSON.stringify(summary)).not.toContain("sid=")
    expect(JSON.stringify(summary)).not.toContain("sign")
  })

  test("records and replays commerce pricing through HTTP cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-commerce-pricing-cassette-"))
    const cassettePath = path.join(dir, "commerce-pricing.json")
    const requests: Array<{ url: string; init?: RequestInit }> = []
    try {
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        nowIso: () => "2026-06-11T00:00:00.000Z",
        fetch: mockFetch(requests),
      })

      await fetchJimengCommercePricing({
        fetch: recordTransport.fetch,
        session,
        nowMs: 1_771_234_567_000,
      })

      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(2)
      expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
        "/commerce/v1/subscription/price_list",
        "/commerce/v1/purchase/price_list",
      ])

      const replayTransport = createJimengHttpTransport({ mode: "replay", cassettePath })
      const replayed = await fetchJimengCommercePricing({
        fetch: replayTransport.fetch,
        session,
        nowMs: 1_771_234_567_000,
      })
      const summary = summarizeJimengCommercePricing(replayed)

      expect(replayed.results.map((result) => result.endpointId)).toEqual(["vip", "credit"])
      expect(replayed.results[0]?.items[0]?.productId).toBe("vip_monthly")
      expect(replayed.results[1]?.items[0]?.productId).toBe("credits_100")
      expect(JSON.stringify(summary)).not.toContain("sid=")
      expect(JSON.stringify(summary)).not.toContain("sign")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("fails loudly when required response contract paths disappear", async () => {
    const client = new JimengClient({
      fetch: async () => {
        const text = JSON.stringify({
          ret: "0",
          errmsg: "success",
          response: JSON.stringify({ other_list: [] }),
        })
        return {
          ok: true,
          status: 200,
          text: async () => text,
          arrayBuffer: async () => new TextEncoder().encode(text).buffer,
        }
      },
    })

    await expect(fetchJimengCommercePricing({
      client,
      session,
      query: { endpoints: ["vip"] },
    })).rejects.toThrow(JimengError)
  })
})

function mockFetch(requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url: string, init?: RequestInit) => {
    requests.push({ url, init })
    const endpoint = new URL(url).pathname
    const payload = endpoint.includes("/subscription/price_list") ? vipPayload() : creditPayload()
    const text = JSON.stringify({
      ret: "0",
      errmsg: "success",
      response: JSON.stringify(payload),
      extra_provider_field: true,
    })
    return {
      ok: true,
      status: 200,
      text: async () => text,
      arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    }
  }
}

function vipPayload(): JsonObject {
  return {
    vip_price_list: [
      {
        product_id: "vip_monthly",
        total_amount: 6900,
        currency_code: "CNY",
        currency_tips: "RMB",
        price_tips: "69/month",
        price_type: "subscribe",
        subscribe_cycle: 1,
        cycle_unit: "month",
        change_type: "new",
        can_trial: false,
        vip_benefit_package: {
          user_credit: {
            amount: 1000,
            description: "monthly credits",
          },
          benefit_texts: ["1000 credits", "Commercial use"],
        },
        provider_added_field: { ok: true },
      },
    ],
    all_price_list: [],
    tab_list: [
      {
        tab_name: "Monthly",
        as_default: true,
        product_ids: ["vip_monthly"],
      },
    ],
    default_product_id: "vip_monthly",
    default_unauto_product_id: "vip_monthly_unauto",
    provider_added_root: true,
  }
}

function creditPayload(): JsonObject {
  return {
    price_list: [
      {
        product_id: "credits_100",
        total_amount: 990,
        currency_code: "CNY",
        price_type: "one_time",
        can_trial: null,
      },
    ],
    provider_added_root: true,
  }
}
