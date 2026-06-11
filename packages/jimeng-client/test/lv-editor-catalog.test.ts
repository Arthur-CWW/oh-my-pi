import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildCapCutEditorCatalogRequest,
  capCutEditorCatalogEndpointPath,
  createJimengHttpTransport,
  fetchCapCutEditorCatalog,
  JimengClient,
  JimengError,
  parseCapCutEditorCatalogEndpoints,
  readJimengHttpCassette,
  summarizeCapCutEditorCatalog,
  type JimengFetch,
} from "../src"

describe("CapCut LV editor catalog helpers", () => {
  test("parses endpoint flags and builds frontend-compatible requests", () => {
    expect(parseCapCutEditorCatalogEndpoints(undefined)).toEqual(["panel", "effects", "fonts", "colors"])
    expect(parseCapCutEditorCatalogEndpoints("fonts,colors,fonts")).toEqual(["fonts", "colors"])

    expect(buildCapCutEditorCatalogRequest("panel", { panel: "fonts", limit: 10, offset: 4, lang: "en", region: "US" })).toEqual({
      appVersion: "999.999.999",
      sdkVersion: "16.1.0",
      enter_from: "image_editor",
      lang: "en",
      region: "US",
      panel: "fonts",
      limit: 10,
      offset: 4,
      sortingPosition: 4,
      hasCategoryEffects: true,
    })
    expect(buildCapCutEditorCatalogRequest("effects", { panel: "fonts", category: "hot" })).toMatchObject({
      panel: "fonts",
      category: "hot",
      hasCategoryEffects: false,
    })
    expect(buildCapCutEditorCatalogRequest("fonts", { panel: "fonts" })).toMatchObject({
      panel: "fonts",
      limit: 1000,
    })
    expect(buildCapCutEditorCatalogRequest("colors")).toEqual({})
    expect(capCutEditorCatalogEndpointPath("colors")).toBe("/lv/v1/editor/plane/color/feed")
  })

  test("fetches editor catalog endpoints and summarizes without signed URLs", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify(lvCatalogBody({ categoryCount: 1, effectCount: 1, effectName: "RedHatDisplay-BoldItalic" })),
        JSON.stringify(lvCatalogBody({ categoryCount: 0, effectCount: 1, effectName: "ZY Flexible" })),
        JSON.stringify(lvCatalogBody({ categoryCount: 0, effectCount: 2, effectName: "Aboreto-Regular" })),
        JSON.stringify({
          ret: "0",
          errmsg: "SUCCESS",
          data: {
            palettes: [
              [[228, 213, 200, 1], [216, 185, 146, 1]],
            ],
          },
        }),
      ], requests),
    })

    const result = await fetchCapCutEditorCatalog({
      client,
      query: {
        endpoints: ["panel", "effects", "fonts", "colors"],
        panel: "fonts",
        limit: 20,
        offset: 0,
      },
    })
    const summary = summarizeCapCutEditorCatalog(result)

    expect(requests.map((request) => request.url)).toEqual([
      "https://edit-api-sg.capcut.com/lv/v1/effect/get_panel_info",
      "https://edit-api-sg.capcut.com/lv/v1/effect/get_category_effects",
      "https://edit-api-sg.capcut.com/lv/v1/effect/get_all_fonts",
      "https://edit-api-sg.capcut.com/lv/v1/editor/plane/color/feed",
    ])
    expect(result.results.map((item) => item.effectCount)).toEqual([1, 1, 2, 0])
    expect(result.results[0]?.categories[0]).toMatchObject({ id: "28234", key: "hot", name: "Trending" })
    expect(result.results[2]?.effects[0]).toMatchObject({
      name: "Aboreto-Regular 1",
      panel: "fonts",
      fileUri: "font-uri-1",
      fileUrlPresent: true,
      iconUrlPresent: true,
    })
    expect(result.results[3]?.palettes[0]).toEqual({
      colorCount: 2,
      colors: ["rgba(228,213,200,1)", "rgba(216,185,146,1)"],
    })
    expect(JSON.stringify(summary)).toContain("file_url_present")
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).not.toContain("x-signature=secret")
  })

  test("records and replays editor catalog endpoints through HTTP cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-lv-editor-cassette-"))
    const cassettePath = path.join(dir, "lv-editor-catalog.json")
    const requests: Array<{ url: string; init?: RequestInit }> = []
    try {
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        nowIso: () => "2026-06-11T00:00:00.000Z",
        fetch: mockFetchSequence([
          JSON.stringify(lvCatalogBody({ categoryCount: 1, effectCount: 1, effectName: "RedHatDisplay-BoldItalic" })),
          JSON.stringify(lvCatalogBody({ categoryCount: 0, effectCount: 1, effectName: "ZY Flexible" })),
          JSON.stringify(lvCatalogBody({ categoryCount: 0, effectCount: 2, effectName: "Aboreto-Regular" })),
          JSON.stringify({
            ret: "0",
            errmsg: "SUCCESS",
            data: {
              palettes: [
                [[228, 213, 200, 1], [216, 185, 146, 1]],
              ],
            },
          }),
        ], requests),
      })

      await fetchCapCutEditorCatalog({
        fetch: recordTransport.fetch,
        query: {
          endpoints: ["panel", "effects", "fonts", "colors"],
          panel: "fonts",
          limit: 20,
          offset: 0,
        },
      })

      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(4)
      expect(requests.map((request) => request.url)).toEqual([
        "https://edit-api-sg.capcut.com/lv/v1/effect/get_panel_info",
        "https://edit-api-sg.capcut.com/lv/v1/effect/get_category_effects",
        "https://edit-api-sg.capcut.com/lv/v1/effect/get_all_fonts",
        "https://edit-api-sg.capcut.com/lv/v1/editor/plane/color/feed",
      ])

      const replayTransport = createJimengHttpTransport({ mode: "replay", cassettePath })
      const replayed = await fetchCapCutEditorCatalog({
        fetch: replayTransport.fetch,
        query: {
          endpoints: ["panel", "effects", "fonts", "colors"],
          panel: "fonts",
          limit: 20,
          offset: 0,
        },
      })
      const summary = summarizeCapCutEditorCatalog(replayed)

      expect(replayed.results.map((item) => item.effectCount)).toEqual([1, 1, 2, 0])
      expect(replayed.results[3]?.palettes[0]?.colors).toEqual(["rgba(228,213,200,1)", "rgba(216,185,146,1)"])
      expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("fails loudly when required catalog paths disappear", async () => {
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        BaseResp: { StatusCode: 0, StatusMessage: "success" },
        data: {},
      })),
    })

    await expect(fetchCapCutEditorCatalog({
      client,
      query: { endpoints: ["fonts"] },
    })).rejects.toBeInstanceOf(JimengError)
  })
})

function lvCatalogBody(input: { categoryCount: number; effectCount: number; effectName: string }): Record<string, unknown> {
  const categories = Array.from({ length: input.categoryCount }, (_, index) => ({
    Id: String(28234 + index),
    Key: index === 0 ? "hot" : `category-${index + 1}`,
    Name: index === 0 ? "Trending" : `Category ${index + 1}`,
    Tags: [],
    ChildrenCategories: [],
    provider_added_field: "allowed",
  }))
  const effects = Array.from({ length: input.effectCount }, (_, index) => ({
    ResourceId: `resource-${index + 1}`,
    Id: `item-${index + 1}`,
    EffectId: `effect-${index + 1}`,
    Name: `${input.effectName}${input.effectCount > 1 ? ` ${index + 1}` : ""}`,
    Panel: "fonts",
    SdkVersion: "4.0.0",
    FileUrl: {
      Uri: `font-uri-${index + 1}`,
      UrlList: [`https://signed.example.invalid/font-${index + 1}.ttf?x-signature=secret`],
    },
    IconUrl: {
      Uri: `icon-uri-${index + 1}`,
      UrlList: [`https://signed.example.invalid/icon-${index + 1}.svg?x-signature=secret`],
    },
    Tags: [],
    IsBusiness: false,
    provider_added_field: "allowed",
  }))
  return {
    BaseResp: {
      StatusCode: 0,
      StatusMessage: "success",
      Extra: { logId: "20260610-unit-test" },
    },
    data: {
      CategoryList: categories,
      CategoryEffects: {
        HasMore: false,
        Cursor: 20,
        SortingPosition: 20,
        CategoryKey: "all",
        Effects: effects,
      },
      UrlPrefix: ["https://signed.example.invalid/prefix?x-signature=secret"],
    },
  }
}

function mockFetch(text: string): JimengFetch {
  return async () => new Response(text, { status: 200 })
}

function mockFetchSequence(texts: string[], requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url, init) => {
    requests.push({ url, init })
    const text = texts.shift()
    return new Response(text ?? "{}", { status: 200 })
  }
}
