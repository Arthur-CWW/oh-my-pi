import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"
import {
  buildJimengCommerceSignedHeaders,
  fetchJimengAccountCredit,
  JimengClient,
  JimengError,
  parseJimengAccountCreditBody,
  summarizeJimengAccountCredit,
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

describe("Jimeng account credit", () => {
  test("builds signed commerce headers with the frontend-compatible sign contract", () => {
    const headers = buildJimengCommerceSignedHeaders(session, {
      endpoint: "/commerce/v1/benefits/user_credit",
      nowMs: 1_771_234_567_000,
    })

    const expectedSign = createHash("md5")
      .update("9e2c|_credit|7|8.4.0|1771234567||11ac")
      .digest("hex")
    expect(headers).toMatchObject({
      "device-time": "1771234567",
      sign: expectedSign,
      "sign-ver": "1",
      appid: "513695",
      appvr: "8.4.0",
      pf: "7",
      loc: "cn",
    })
    expect(headers.cookie).toBe("sid=test")
  })

  test("parses and summarizes account credit without leaking headers", () => {
    const parsed = parseJimengAccountCreditBody(accountCreditBody())
    expect(parsed.credit).toEqual({
      giftCredit: 100,
      purchaseCredit: 12,
      vipCredit: 3,
      totalCredit: 115,
    })

    const summary = summarizeJimengAccountCredit({
      endpoint: "/commerce/v1/benefits/user_credit",
      httpStatus: 200,
      ret: "0",
      errmsg: "success",
      responseTextSha256: "hash",
      request: {},
      body: accountCreditBody(),
      ...parsed,
    })
    expect(summary).toMatchObject({
      credit: {
        gift_credit: 100,
        purchase_credit: 12,
        vip_credit: 3,
        total_credit: 115,
      },
      credits_detail_kind: "array",
    })
    expect(JSON.stringify(summary)).not.toContain("sid=")
  })

  test("fetches signed account credit from the commerce endpoint", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify(accountCreditBody()), requests),
    })

    const result = await fetchJimengAccountCredit({
      client,
      session,
      nowMs: 1_771_234_567_000,
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe("https://jimeng.jianying.com/commerce/v1/benefits/user_credit")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({})
    const headers = requests[0]?.init?.headers as Record<string, string>
    expect(headers.sign).toBe(createHash("md5").update("9e2c|_credit|7|8.4.0|1771234567||11ac").digest("hex"))
    expect(result.credit.totalCredit).toBe(115)
  })

  test("fails loudly when required credit fields disappear", () => {
    expect(() => parseJimengAccountCreditBody({
      ret: "0",
      errmsg: "success",
      data: { credit: { gift_credit: 1, vip_credit: 2 } },
    })).toThrow(JimengError)
  })
})

function accountCreditBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      credit: {
        gift_credit: 100,
        purchase_credit: 12,
        vip_credit: 3,
      },
      credits_detail: [
        { resource_id: "generate_img", balance: 100, extra_provider_field: true },
      ],
      extra_new_field: { ok: true },
    },
  }
}

function mockFetch(body: string, requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url: string, init?: RequestInit) => {
    requests.push({ url, init })
    return {
      ok: true,
      status: 200,
      text: async () => body,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    }
  }
}
