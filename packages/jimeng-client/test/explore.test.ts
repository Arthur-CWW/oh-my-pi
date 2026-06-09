import { describe, expect, test } from "bun:test"
import {
  buildExploreRequestBody,
  fetchExploreTemplates,
  JimengClient,
  JimengError,
  parseExploreTemplatesBody,
  parseExploreWorkTypes,
  summarizeExploreTemplates,
  type JimengFetch,
  type JimengSessionBundle,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("Jimeng Explore templates", () => {
  test("builds a frontend-compatible get_explore request body", () => {
    const body = buildExploreRequestBody({
      count: 10,
      offset: 20,
      categoryId: 11222,
      workTypes: ["image", "video"],
    })

    expect(body).toMatchObject({
      count: 10,
      offset: 20,
      category_id: 11222,
      feed_refer: "feed_loadmore",
      filter: { work_type_list: ["image", "video"] },
    })
    expect((body.image_info as { image_scene_list: unknown[] }).image_scene_list).toHaveLength(13)
  })

  test("parses work type flags", () => {
    expect(parseExploreWorkTypes("image,video,canvas")).toEqual(["image", "video", "canvas"])
    expect(() => parseExploreWorkTypes("image,audio")).toThrow(JimengError)
  })

  test("normalizes prompt and template signals from response body", () => {
    const parsed = parseExploreTemplatesBody(exploreBody())

    expect(parsed).toMatchObject({
      hasMore: true,
      nextOffset: 3,
      categoryId: 11222,
      requestId: "request-1",
    })
    expect(parsed.items[0]).toMatchObject({
      id: "item-1",
      effectId: "item-1",
      effectType: 9,
      templateType: "image",
      aiFeature: "text_generate_image",
      featureTypes: ["text_generate_image"],
      usageNum: 408,
      favoriteNum: 334,
      draftUri: "aigc-draft/1",
      prompt: "韩系美妆达人，手机自拍，真实种草短视频封面。",
      modelReqKey: "high_aes_general_v40",
      seed: 1885748692,
      imageRatio: 5,
      metadataEffectId: "template-1",
      metadataEffectType: "template",
    })

    const summary = summarizeExploreTemplates(parsed)
    expect(summary).toMatchObject({
      total: 1,
      by_template_type: { image: 1 },
      by_ai_feature: { text_generate_image: 1 },
    })
  })

  test("fetchExploreTemplates posts query and returns normalized items", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify(exploreBody()), requests),
    })

    const result = await fetchExploreTemplates({
      client,
      session,
      query: { count: 5, workTypes: ["image"] },
    })

    expect(requests[0]?.url).toContain("/mweb/v1/get_explore")
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      count: 5,
      filter: { work_type_list: ["image"] },
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.prompt).toContain("韩系美妆达人")
  })
})

function exploreBody(): Record<string, unknown> {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      has_more: true,
      next_offset: 3,
      request_id: "request-1",
      category_id: 11222,
      item_list: [
        {
          common_attr: {
            id: "item-1",
            effect_id: "item-1",
            effect_type: 9,
            title: "",
            description: "",
            cover_url: "https://example.invalid/cover.webp",
            create_time: 1775561323,
            status: 102,
            aspect_ratio: 0.5625,
            cover_height: 2048,
            cover_width: 1152,
          },
          statistic: {
            usage_num: 408,
            favorite_num: 334,
            play_num: 12,
          },
          category_id_list: [11222],
          extra: {
            template_type: "image",
            ai_feature: "text_generate_image",
          },
          ai_feature: {
            features: [{ type: "text_generate_image" }],
            is_merged: true,
          },
          metadata_param: JSON.stringify({
            effect_id: "template-1",
            effect_type: "template",
          }),
          aigc_draft: {
            version: "3.0.2",
            uri: "aigc-draft/1",
            content: JSON.stringify({
              component_list: [
                {
                  abilities: {
                    generate: {
                      core_param: {
                        model: "high_aes_general_v40",
                        prompt: "韩系美妆达人，手机自拍，真实种草短视频封面。",
                        seed: 1885748692,
                        image_ratio: 5,
                      },
                    },
                  },
                },
              ],
            }),
          },
        },
      ],
    },
  }
}

function mockFetch(text: string, requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url, init) => {
    requests.push({ url, init })
    return new Response(text, { status: 200 })
  }
}
