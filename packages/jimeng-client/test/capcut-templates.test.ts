import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"
import {
  buildSingleCapCutEndpointProbeVariant,
  buildCapCutSignedHeaders,
  buildCapCutTemplateCategoriesRequest,
  capCutTemplateStaticCatalogUrls,
  fetchCapCutTemplateCategories,
  fetchCapCutTemplateStaticCatalog,
  JimengClient,
  JimengError,
  parseCapCutTemplateCategoriesBody,
  parseCapCutTemplateRatioCatalogBody,
  parseCapCutTemplateSceneCatalogBody,
  parseCapCutEndpointProbeVariants,
  runCapCutEndpointProbe,
  summarizeCapCutEndpointProbe,
  summarizeCapCutTemplateCategories,
  summarizeCapCutTemplateStaticCatalog,
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

  test("exposes the public static metadata catalog URLs from the frontend bundle", () => {
    expect(capCutTemplateStaticCatalogUrls()).toEqual({
      ratioCatalogUrl: "https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_49/bee_prod_49_bee_publish_709.json",
      sceneCatalogUrl: "https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_149/bee_prod_149_bee_publish_835.json",
    })
  })

  test("parses public template ratio metadata", () => {
    const ratios = parseCapCutTemplateRatioCatalogBody(capCutRatioCatalogBody())

    expect(ratios).toEqual([
      {
        serverScaleType: 1,
        size: { width: 1, height: 1 },
        range: { min: 0.85, max: 1.5 },
        aspectRatio: 1,
      },
      {
        serverScaleType: 2,
        size: { width: 9, height: 16 },
        range: { min: 0.25, max: 0.85 },
        aspectRatio: 0.5625,
      },
    ])
  })

  test("parses public template scene metadata", () => {
    const scenes = parseCapCutTemplateSceneCatalogBody(capCutSceneCatalogBody())

    expect(scenes).toEqual([
      {
        id: 88300000068,
        sceneId: "10002",
        name: "Instagram post",
        sizeUnit: "px",
        size: { width: 1080, height: 1080 },
        display: true,
        index: 1,
        searchTemplateVisible: true,
        publishTemplateVisible: true,
        iconUrl: "https://example.invalid/icon.svg",
      },
      {
        id: 88300000069,
        sceneId: "10003",
        name: "Instagram story",
        sizeUnit: "px",
        size: { width: 1080, height: 1920 },
        display: true,
        index: 2,
        searchTemplateVisible: true,
        publishTemplateVisible: false,
        iconUrl: null,
      },
    ])
  })

  test("fetches the public static template metadata catalogs", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify(capCutRatioCatalogBody()),
        JSON.stringify(capCutSceneCatalogBody()),
      ], requests),
    })

    const result = await fetchCapCutTemplateStaticCatalog({ client, userAgent: "UnitTest/1.0" })

    expect(requests.map((request) => request.url)).toEqual([
      "https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_49/bee_prod_49_bee_publish_709.json",
      "https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_149/bee_prod_149_bee_publish_835.json",
    ])
    expect(requests[0]?.init?.headers).toMatchObject({ "user-agent": "UnitTest/1.0" })
    expect(result.ratios).toHaveLength(2)
    expect(result.scenes).toHaveLength(2)
    expect(summarizeCapCutTemplateStaticCatalog(result)).toMatchObject({
      ratio_count: 2,
      scene_count: 2,
      scenes: [
        {
          scene_id: "10002",
          name: "Instagram post",
          size: { width: 1080, height: 1080 },
          icon_url_present: true,
        },
        {
          scene_id: "10003",
          name: "Instagram story",
          size: { width: 1080, height: 1920 },
          icon_url_present: false,
        },
      ],
    })
  })

  test("parses CapCut endpoint probe variants and single bodies", () => {
    expect(parseCapCutEndpointProbeVariants(JSON.stringify({
      variants: [
        { name: "keyword", body: { sdk_version: "16.1.0", keyword: "makeup" } },
      ],
    }))).toEqual([
      { name: "keyword", body: { sdk_version: "16.1.0", keyword: "makeup" } },
    ])
    expect(buildSingleCapCutEndpointProbeVariant('{"sdk_version":"16.1.0"}')).toEqual([
      { name: "body", body: { sdk_version: "16.1.0" } },
    ])
  })

  test("replays signed CapCut endpoint probe variants and summarizes shapes without URL values", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          item_list: [
            {
              web_id: "template-1",
              cover_url: "https://signed.example.invalid/cover.png?x-signature=secret",
            },
          ],
        },
      }), requests),
    })

    const result = await runCapCutEndpointProbe({
      client,
      probe: {
        endpoint: "/lv/v1/cc_web/plane/fuzzy_search_templates",
        variants: [
          { name: "keyword", body: { sdk_version: "16.1.0", keyword: "makeup" } },
        ],
        lan: "en",
        loc: "us",
        userAgent: "UnitTest/1.0",
      },
    })
    const summary = summarizeCapCutEndpointProbe(result)

    expect(requests[0]?.url).toBe("https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/fuzzy_search_templates")
    expect(requests[0]?.init?.headers).toMatchObject({
      origin: "https://www.capcut.com",
      referer: "https://www.capcut.com/",
      "user-agent": "UnitTest/1.0",
      pf: "7",
      appvr: "5.8.0",
    })
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ sdk_version: "16.1.0", keyword: "makeup" })
    expect(summary.results).toHaveLength(1)
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).not.toContain("x-signature=secret")
    expect(summary).toMatchObject({
      endpoint: "/lv/v1/cc_web/plane/fuzzy_search_templates",
      variant_count: 1,
      results: [
        {
          name: "keyword",
          ret: "0",
          errmsg: "success",
          response_text_has_url_like_tokens: true,
        },
      ],
    })
  })

  test("rejects unsafe CapCut probe endpoints", async () => {
    const client = new JimengClient({ fetch: mockFetch(JSON.stringify({ ret: "0" }), []) })

    await expect(runCapCutEndpointProbe({
      client,
      probe: {
        endpoint: "https://example.invalid/lv/v1/cc_web/plane/fuzzy_search_templates",
        variants: [{ name: "body", body: {} }],
      },
    })).rejects.toThrow(JimengError)

    await expect(runCapCutEndpointProbe({
      client,
      probe: {
        endpoint: "/lv/v1/editor/use_report",
        variants: [{ name: "body", body: {} }],
      },
    })).rejects.toThrow(JimengError)
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

function capCutRatioCatalogBody(): Array<Record<string, unknown>> {
  return [
    {
      serverScaleType: 1,
      size: [1, 1],
      range: { min: 0.85, max: 1.5 },
    },
    {
      serverScaleType: 2,
      size: [9, 16],
      range: { min: 0.25, max: 0.85 },
    },
  ]
}

function capCutSceneCatalogBody(): Record<string, unknown> {
  return {
    data: [
      {
        id: 88300000068,
        sceneId: "10002",
        name: "Instagram post",
        sizeUnit: "px",
        size: {
          width: 1080,
          height: 1080,
        },
        display: true,
        index: 1,
        searchTemplateVIsible: true,
        publishTemplateVIsible: true,
        icon: "https://example.invalid/icon.svg",
      },
      {
        id: 88300000069,
        sceneId: "10003",
        name: "Instagram story",
        sizeUnit: "px",
        size: {
          width: 1080,
          height: 1920,
        },
        display: true,
        index: 2,
        searchTemplateVIsible: true,
        publishTemplateVIsible: false,
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

function mockFetchSequence(texts: string[], requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url, init) => {
    requests.push({ url, init })
    const text = texts.shift()
    return new Response(text ?? "{}", { status: 200 })
  }
}
