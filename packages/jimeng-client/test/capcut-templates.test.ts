import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"
import {
  buildCapCutSignedHeaders,
  buildCapCutTemplateCategoriesRequest,
  fetchCapCutTemplateCategories,
  JimengClient,
  JimengError,
  parseCapCutTemplateCategoriesBody,
  summarizeCapCutTemplateCategories,
  type JimengFetch,
  type JimengSessionBundle,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("CapCut commercial template helpers", () => {
  test("builds the frontend-compatible category request body", () => {
    expect(buildCapCutTemplateCategoriesRequest()).toEqual({ sdk_version: "16.1.0" })
  })

  test("signs CapCut template requests with the frontend hash contract", () => {
    const path = "/lv/v1/cc_web/plane/get_categories"
    const headers = buildCapCutSignedHeaders({
      path,
      nowSec: 1781045795,
      lan: "en",
      loc: "us",
      userAgent: "UnitTest/1.0",
    })
    const expected = createHash("md5")
      .update(`9e2c|${path.slice(-7)}|7|5.8.0|1781045795||11ac`)
      .digest("hex")

    expect(headers).toMatchObject({
      sign: expected,
      "device-time": "1781045795",
      "sign-ver": "1",
      pf: "7",
      appvr: "5.8.0",
      "app-sdk-version": "999.999.999",
      lan: "en",
      loc: "us",
    })
  })

  test("parses durable template category fields", () => {
    const categories = parseCapCutTemplateCategoriesBody(capCutCategoriesBody())

    expect(categories).toEqual([
      {
        categoryId: 0,
        starlingKey: "web_smart_tools_text_black_friday",
        displayName: "Black Friday",
      },
      {
        categoryId: 2,
        starlingKey: "web_smart_tools_text_cosmetic_dailyization",
        displayName: "Cosmetic dailyization",
      },
    ])
  })

  test("fetches categories from the signed CapCut API host", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify(capCutCategoriesBody()), requests),
    })

    const result = await fetchCapCutTemplateCategories({
      client,
      session,
      query: { lan: "en", loc: "us" },
    })

    expect(requests[0]?.url).toBe("https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_categories")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ sdk_version: "16.1.0" })
    expect(requests[0]?.init?.headers).toMatchObject({
      origin: "https://www.capcut.com",
      referer: "https://www.capcut.com/",
      "user-agent": "UnitTest/1.0",
      pf: "7",
      appvr: "5.8.0",
    })
    expect(result.categories).toHaveLength(2)
    expect(summarizeCapCutTemplateCategories(result)).toMatchObject({
      category_count: 2,
      categories: [
        { category_id: 0, display_name: "Black Friday" },
        { category_id: 2, display_name: "Cosmetic dailyization" },
      ],
    })
  })

  test("rejects CapCut API errors", async () => {
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "1000",
        errmsg: "param error",
        data: null,
      }), []),
    })

    await expect(fetchCapCutTemplateCategories({ client, session })).rejects.toThrow(JimengError)
  })
})

function capCutCategoriesBody(): Record<string, unknown> {
  return {
    ret: "0",
    errmsg: "success",
    log_id: "log-1",
    data: [
      {
        category_id: 0,
        starling_key: "web_smart_tools_text_black_friday",
        default_display_name: "Black Friday",
      },
      {
        category_id: 2,
        starling_key: "web_smart_tools_text_cosmetic_dailyization",
        default_display_name: "Cosmetic dailyization",
      },
    ],
  }
}

function mockFetch(text: string, requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url, init) => {
    requests.push({ url, init })
    return new Response(text, { status: 200 })
  }
}
