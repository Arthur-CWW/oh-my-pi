import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildCapCutCollectionTemplatesRequest,
  buildSingleCapCutEndpointProbeVariant,
  buildCapCutSignedHeaders,
  buildCapCutTemplateCategoriesRequest,
  buildCapCutTemplateCollectionsRequest,
  buildCapCutTemplateDetailRequest,
  capCutTemplateStaticCatalogUrls,
  createJimengHttpTransport,
  fetchCapCutCollectionTemplates,
  fetchCapCutTemplateCollections,
  fetchCapCutTemplateCategories,
  fetchCapCutTemplateDetail,
  fetchCapCutTemplateStaticCatalog,
  JimengClient,
  JimengError,
  parseCapCutCollectionTemplatesBody,
  parseCapCutTemplateCategoriesBody,
  parseCapCutTemplateCollectionsBody,
  parseCapCutTemplateDetailBody,
  parseCapCutTemplateRatioCatalogBody,
  parseCapCutTemplateSceneCatalogBody,
  parseCapCutEndpointProbeVariants,
  parseCapCutTemplateMiningBody,
  readJimengHttpCassette,
  runCapCutEndpointProbe,
  summarizeCapCutCollectionTemplates,
  summarizeCapCutEndpointProbe,
  summarizeCapCutTemplateCategories,
  summarizeCapCutTemplateCollections,
  summarizeCapCutTemplateDetail,
  summarizeCapCutTemplateMining,
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

  test("fetches template collections and normalizes durable collection ids", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify(capCutCollectionsBody()), requests),
    })

    expect(buildCapCutTemplateCollectionsRequest({
      categoryType: 0,
      scale: 1,
      canvasWidth: 1080,
      canvasHeight: 1920,
    })).toEqual({
      sdk_version: "16.1.0",
      category_type: 0,
      scale: 1,
      canvas_width: 1080,
      canvas_height: 1920,
    })

    const result = await fetchCapCutTemplateCollections({
      client,
      session,
      query: { lan: "en", loc: "us" },
    })
    const summary = summarizeCapCutTemplateCollections(result)

    expect(requests[0]?.url).toBe("https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_collections")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ sdk_version: "16.1.0" })
    expect(result.collections).toEqual([
      {
        id: 10034,
        displayName: "Beauty Care",
        rootCategory: null,
        starlingKey: "vimo-ad-category-us-29-MNPNHI",
        resourceLen: 16369,
        categoryType: 0,
        direction: 0,
        isEcomCategory: true,
        capsuleCount: 0,
      },
    ])
    expect(summary).toMatchObject({
      collection_count: 1,
      collections: [
        { id: 10034, display_name: "Beauty Care", resource_len: 16369 },
      ],
    })
  })

  test("fetches collection template rows and redacts signed media from summaries", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify(capCutCollectionTemplatesBody()), requests),
    })

    expect(buildCapCutCollectionTemplatesRequest({
      collectionId: 10034,
      count: 5,
      cursor: 10,
      lang: "en",
    })).toEqual({
      sdk_version: "16.1.0",
      enter_from: "feed",
      count: 5,
      lang: "en",
      id: 10034,
      cursor: 10,
    })

    const result = await fetchCapCutCollectionTemplates({
      client,
      session,
      query: { collectionId: 10034, count: 5, lan: "en", loc: "us" },
    })
    const summary = summarizeCapCutCollectionTemplates(result)

    expect(requests[0]?.url).toBe("https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_collection_templates")
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      sdk_version: "16.1.0",
      enter_from: "feed",
      count: 5,
      lang: "en",
      id: 10034,
    })
    expect(result.templates[0]).toMatchObject({
      id: "7369116096600771846",
      title: "FACEBOOK ADS - BEAUTY",
      coverUrlPresent: true,
      coverSize: { width: 1200, height: 628 },
      categoryIds: [10032, 10034],
      author: { uid: "6995172659920372737", name: "DK Candra", role: 0 },
      sceneIds: [10012],
      canvasSize: { width: 1200, height: 628 },
      textThemeCoverCount: 1,
    })
    expect(summary).toMatchObject({
      collection_id: 10034,
      template_count: 1,
      cursor: 5,
      has_more: true,
    })
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).not.toContain("x-signature=secret")
  })

  test("parses typed template mining rows from non-mutating search responses", () => {
    const collectionBody = capCutCollectionTemplatesBody()
    const collectionData = collectionBody.data as { item_list: unknown[] }
    const result = parseCapCutTemplateMiningBody({
      ret: "0",
      errmsg: "success",
      data: {
        has_more: false,
        cursor: 0,
        template_source: "search",
        template_list: collectionData.item_list,
      },
    }, "/lv/v1/cc_web/replicate/search_templates")
    const summary = summarizeCapCutTemplateMining(result)

    expect(result).toMatchObject({
      endpoint: "/lv/v1/cc_web/replicate/search_templates",
      blockedReason: null,
      templateRowsPath: "data.template_list",
      hasMore: false,
      cursor: 0,
    })
    expect(result.templates[0]).toMatchObject({
      id: "7369116096600771846",
      title: "FACEBOOK ADS - BEAUTY",
      author: { uid: "6995172659920372737", name: "DK Candra" },
    })
    expect(summary).toMatchObject({
      status: "ok",
      template_count: 1,
      template_rows_path: "data.template_list",
      templates: [
        {
          id: "7369116096600771846",
          cover_url_present: true,
          category_ids: [10032, 10034],
        },
      ],
    })
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).not.toContain("x-signature=secret")
  })

  test("keeps exact blocked reasons for template mining probes that are still parked", () => {
    const result = parseCapCutTemplateMiningBody({
      ret: 1000,
      errmsg: "param error",
      data: null,
    }, "/lv/v1/cc_web/plane/fuzzy_search_templates")

    expect(summarizeCapCutTemplateMining(result)).toMatchObject({
      endpoint: "/lv/v1/cc_web/plane/fuzzy_search_templates",
      status: "blocked",
      ret: 1000,
      errmsg: "param error",
      blocked_reason: "ret=1000: param error",
      template_count: 0,
    })
  })

  test("fetches template detail by web id and summarizes without raw template data", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify(capCutTemplateDetailBody()), requests),
    })

    expect(buildCapCutTemplateDetailRequest({
      templateId: "7369116096600771846",
      needDraft: true,
      lang: "en",
      region: "us",
    })).toEqual({
      sdk_version: "16.1.0",
      enter_from: "feed",
      app_version: "5.8.0",
      lang: "en",
      region: "us",
      template_id: "7369116096600771846",
      need_draft: true,
    })

    const result = await fetchCapCutTemplateDetail({
      client,
      session,
      query: { templateId: "7369116096600771846", needDraft: false },
    })
    const summary = summarizeCapCutTemplateDetail(result)

    expect(requests[0]?.url).toBe("https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_template_detail")
    expect(result.detail).toMatchObject({
      templateId: "7369116096600771846",
      templateUrlPresent: true,
      templateDataPresent: true,
      draftDataPresent: true,
      templateVersion: "1.3.2",
      creatorSubmitType: 1,
      textThemeEffectCount: 1,
    })
    expect(summary).toMatchObject({
      detail: {
        template_id: "7369116096600771846",
        template_url_present: true,
        material_counts: {
          effects: 1,
          file_infos: 0,
        },
      },
    })
    expect(JSON.stringify(summary)).not.toContain("raw-template-data")
    expect(JSON.stringify(summary)).not.toContain("https://signed.example.invalid")
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

  test("allows explicitly whitelisted signed LV editor read probes", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          item_list: [],
          has_more: false,
          new_cursor: 0,
        },
      }), requests),
    })

    const result = await runCapCutEndpointProbe({
      client,
      probe: {
        endpoint: "/lv/v1/editor/template/recent_list",
        variants: [
          { name: "recent", body: { count: 5, lang: "en" } },
        ],
        lan: "en",
        loc: "us",
        userAgent: "UnitTest/1.0",
      },
    })

    expect(requests[0]?.url).toBe("https://edit-api-sg.capcut.com/lv/v1/editor/template/recent_list")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ count: 5, lang: "en" })
    expect(result.results[0]).toMatchObject({
      name: "recent",
      ret: "0",
      errmsg: "success",
    })

    const catalogResult = await runCapCutEndpointProbe({
      client,
      probe: {
        endpoint: "/lv/v1/effect/get_panel_info",
        variants: [
          { name: "fonts", body: { panel: "fonts", limit: 20, offset: 0 } },
        ],
        lan: "en",
        loc: "us",
        userAgent: "UnitTest/1.0",
      },
    })

    expect(requests[1]?.url).toBe("https://edit-api-sg.capcut.com/lv/v1/effect/get_panel_info")
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({ panel: "fonts", limit: 20, offset: 0 })
    expect(catalogResult.results[0]).toMatchObject({
      name: "fonts",
      ret: "0",
      errmsg: "success",
    })
  })

  test("routes signed CapCut task probes to the feed API host", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          draft_info: [],
        },
      }), requests),
    })

    await runCapCutEndpointProbe({
      client,
      probe: {
        endpoint: "/lv/v2/cc_web_task/get_task_draft",
        variants: [
          { name: "task", body: { task_id: "task-1", app_id: 348188 } },
        ],
        lan: "en",
        loc: "us",
        userAgent: "UnitTest/1.0",
      },
    })

    expect(requests[0]?.url).toBe("https://feed-api-sg.capcut.com/lv/v2/cc_web_task/get_task_draft")
  })

  test("records and replays CapCut template catalog helpers through HTTP cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-capcut-cassette-"))
    const cassettePath = path.join(dir, "capcut-template-catalog.json")
    const requests: Array<{ url: string; init?: RequestInit }> = []
    try {
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        nowIso: () => "2026-06-11T00:00:00.000Z",
        fetch: mockFetchSequence([
          JSON.stringify(capCutCategoriesBody()),
          JSON.stringify(capCutCollectionsBody()),
          JSON.stringify(capCutCollectionTemplatesBody()),
          JSON.stringify(capCutTemplateDetailBody()),
          JSON.stringify(capCutRatioCatalogBody()),
          JSON.stringify(capCutSceneCatalogBody()),
          JSON.stringify({
            ret: "0",
            errmsg: "success",
            data: {
              item_list: [{ web_id: "template-1", cover_url: "https://signed.example.invalid/cover.png?x-signature=secret" }],
            },
          }),
        ], requests),
      })

      await fetchCapCutTemplateCategories({
        fetch: recordTransport.fetch,
        session,
        query: { lan: "en", loc: "us" },
      })
      await fetchCapCutTemplateCollections({
        fetch: recordTransport.fetch,
        query: { lan: "en", loc: "us" },
      })
      await fetchCapCutCollectionTemplates({
        fetch: recordTransport.fetch,
        query: { collectionId: 10034, count: 5, lan: "en", loc: "us" },
      })
      await fetchCapCutTemplateDetail({
        fetch: recordTransport.fetch,
        query: { templateId: "7369116096600771846", needDraft: false },
      })
      await fetchCapCutTemplateStaticCatalog({ fetch: recordTransport.fetch, userAgent: "UnitTest/1.0" })
      await runCapCutEndpointProbe({
        fetch: recordTransport.fetch,
        probe: {
          endpoint: "/lv/v1/cc_web/plane/fuzzy_search_templates",
          variants: [{ name: "keyword", body: { sdk_version: "16.1.0", keyword: "makeup" } }],
          lan: "en",
          loc: "us",
          userAgent: "UnitTest/1.0",
        },
      })

      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(7)
      expect(requests.map((request) => request.url)).toEqual([
        "https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_categories",
        "https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_collections",
        "https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_collection_templates",
        "https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_template_detail",
        "https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_49/bee_prod_49_bee_publish_709.json",
        "https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_149/bee_prod_149_bee_publish_835.json",
        "https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/fuzzy_search_templates",
      ])

      const replayTransport = createJimengHttpTransport({ mode: "replay", cassettePath })
      const categories = await fetchCapCutTemplateCategories({
        fetch: replayTransport.fetch,
        session,
        query: { lan: "en", loc: "us" },
      })
      const collections = await fetchCapCutTemplateCollections({
        fetch: replayTransport.fetch,
        query: { lan: "en", loc: "us" },
      })
      const templates = await fetchCapCutCollectionTemplates({
        fetch: replayTransport.fetch,
        query: { collectionId: 10034, count: 5, lan: "en", loc: "us" },
      })
      const detail = await fetchCapCutTemplateDetail({
        fetch: replayTransport.fetch,
        query: { templateId: "7369116096600771846", needDraft: false },
      })
      const metadata = await fetchCapCutTemplateStaticCatalog({ fetch: replayTransport.fetch, userAgent: "UnitTest/1.0" })
      const probe = await runCapCutEndpointProbe({
        fetch: replayTransport.fetch,
        probe: {
          endpoint: "/lv/v1/cc_web/plane/fuzzy_search_templates",
          variants: [{ name: "keyword", body: { sdk_version: "16.1.0", keyword: "makeup" } }],
          lan: "en",
          loc: "us",
          userAgent: "UnitTest/1.0",
        },
      })

      expect(categories.categories).toHaveLength(2)
      expect(collections.collections[0]?.id).toBe(10034)
      expect(templates.templates[0]?.id).toBe("7369116096600771846")
      expect(detail.detail.templateUrlPresent).toBe(true)
      expect(metadata.scenes).toHaveLength(2)
      expect(probe.results[0]?.ret).toBe("0")
      expect(JSON.stringify(summarizeCapCutEndpointProbe(probe))).not.toContain("signed.example.invalid")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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

    await expect(runCapCutEndpointProbe({
      client,
      probe: {
        endpoint: "/lv/v1/cc_web/plane/del_presets_template",
        variants: [{ name: "body", body: {} }],
      },
    })).rejects.toThrow(JimengError)
  })

  test("fails loudly when CapCut required response paths disappear", () => {
    expect(() => parseCapCutTemplateCollectionsBody({ ret: "0", data: {} })).toThrow()
    expect(() => parseCapCutCollectionTemplatesBody({ ret: "0", data: {} })).toThrow()
    expect(() => parseCapCutTemplateDetailBody({ ret: "0", data: {} })).toThrow()
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

function capCutCollectionsBody(): Record<string, unknown> {
  return {
    ret: "0",
    errmsg: "success",
    log_id: "log-collections",
    data: {
      template_source: "",
      collections: [
        {
          id: 10034,
          display_name: "Beauty Care",
          root_category: "",
          direction: 0,
          starling_key: "vimo-ad-category-us-29-MNPNHI",
          resource_len: 16369,
          category_type: 0,
          is_ecom_category: true,
          capsules: [],
          provider_added_field: "allowed",
        },
      ],
    },
  }
}

function capCutCollectionTemplatesBody(): Record<string, unknown> {
  return {
    ret: "0",
    errmsg: "success",
    log_id: "log-templates",
    data: {
      has_more: true,
      new_cursor: 5,
      template_source: "",
      item_list: [
        {
          id: 7369116096600772000,
          web_id: "7369116096600771846",
          title: "FACEBOOK ADS - BEAUTY",
          short_title: "BEAUTY",
          cover_url: "https://signed.example.invalid/cover.webp?x-signature=secret",
          cover_width: 1200,
          cover_height: 628,
          optimized_cover_url: {
            cover_url_small: "https://signed.example.invalid/small.webp?x-signature=secret",
          },
          category_id_list: [10032, 10034],
          status: 0,
          author: {
            uid: 6995172659920373000,
            web_uid: "6995172659920372737",
            name: "DK Candra",
            role: 0,
          },
          hypic_extra: {
            producer_type: 2,
            features: ["element.text", "template.web"],
            template_version: "1.0.0",
          },
          text_theme_covers: [{ uri: "tos-1" }],
          text_theme_effects: [{ id: "font-1" }],
          extra_v2: {
            canvas_width: "1200",
            canvas_height: "628",
            scene_ids: "[10012]",
          },
          is_multi_lang: false,
          template_tags_v2: ["operationTag/industry/beauty & personal care"],
          item_type: 2001,
          provider_added_field: { nested: true },
        },
      ],
    },
  }
}

function capCutTemplateDetailBody(): Record<string, unknown> {
  return {
    ret: "0",
    errmsg: "success",
    log_id: "log-detail",
    data: {
      template_id: "7369116096600771846",
      template_url: "https://signed.example.invalid/template.zip?x-signature=secret",
      template_data: "raw-template-data",
      draft_data: "{}",
      main_version: 1,
      feature_version: 3,
      revise_version: 2,
      creator_info: {
        submit_type: 1,
      },
      materials: {
        effects: [{ id: "effect-1" }],
        file_infos: [],
      },
      extra_v2: {
        source_draft_id: "source-1",
      },
      multi_langs: {},
      text_theme_covers: [],
      text_theme_effects: [{ id: "font-1" }],
      theme_data: "{}",
      provider_added_field: "allowed",
    },
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
