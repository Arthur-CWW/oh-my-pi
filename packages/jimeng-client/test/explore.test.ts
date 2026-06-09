import { describe, expect, test } from "bun:test"
import {
  buildExploreRequestBody,
  buildShortVideoExploreQuery,
  fetchExploreTemplates,
  fetchOverseasShortVideos,
  JimengClient,
  JimengError,
  parseOverseasShortVideosBody,
  parseExploreTemplatesBody,
  parseExploreWorkTypes,
  redactExploreTemplateItems,
  summarizeExploreShortVideos,
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
    expect(parseExploreWorkTypes("image,video,canvas,short_video")).toEqual(["image", "video", "canvas", "short_video"])
    expect(() => parseExploreWorkTypes("image,audio")).toThrow(JimengError)
  })

  test("builds short-video Explore query with frontend feed defaults", () => {
    expect(buildExploreRequestBody(buildShortVideoExploreQuery({ count: 5 }))).toMatchObject({
      count: 5,
      offset: 0,
      feed_refer: "feed_enterauto",
      filter: { work_type_list: ["short_video"] },
    })
    expect(buildExploreRequestBody(buildShortVideoExploreQuery({ offset: 5 }))).toMatchObject({
      offset: 5,
      feed_refer: "feed_loadmore",
      filter: { work_type_list: ["short_video"] },
    })
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

  test("fetchOverseasShortVideos posts to feed_short_video and parses snake_case response data", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify(shortVideoBody()), requests),
    })

    const result = await fetchOverseasShortVideos({
      client,
      session,
      query: { count: 5, categoryId: 11222 },
    })

    expect(requests[0]?.url).toContain("/mweb/v1/feed_short_video")
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      count: 5,
      feed_refer: "feed_enterauto",
      filter: { work_type_list: ["short_video"] },
    })
    expect(result.endpoint).toBe("/mweb/v1/feed_short_video")
    expect(result.items[0]?.videoId).toBe("v03870g10004cu4siofog65s06ml296g")
  })

  test("normalizes short-video metadata without signed video URLs", () => {
    const parsed = parseExploreTemplatesBody(shortVideoBody())

    expect(parsed.items[0]).toMatchObject({
      id: "short-video-1",
      effectId: "short-video-1",
      effectType: 210,
      description: "来自故宫的猫税",
      favoriteNum: 89886,
      playNum: 29884369,
      commentNum: 3172,
      shareNum: 8766,
      videoId: "v03870g10004cu4siofog65s06ml296g",
      videoDurationSec: 115,
      videoDurationMs: 114867,
      videoWidth: 2560,
      videoHeight: 1440,
      videoFps: 30,
      videoDefinition: "1440p",
      videoFormat: "mp4",
      videoCodec: "h264",
      videoSize: 207251143,
      videoHasAudio: true,
      videoIsMute: false,
      transcodedDefinitions: ["1080p", "480p", "720p"],
      metadataEffectId: "gen_story",
      metadataEffectType: "tool",
    })
    expect("videoUrl" in parsed.items[0]!).toBe(false)

    expect(summarizeExploreShortVideos(parsed)).toMatchObject({
      total: 1,
      top_by_play: [
        {
          id: "short-video-1",
          play_num: 29884369,
          favorite_num: 89886,
          video_id: "v03870g10004cu4siofog65s06ml296g",
          duration_sec: 115,
          definition: "1440p",
          has_audio: true,
        },
      ],
    })
    expect(redactExploreTemplateItems(parsed.items)[0]).toMatchObject({
      coverUrlPresent: true,
    })
    expect("coverUrl" in redactExploreTemplateItems(parsed.items)[0]!).toBe(false)
  })

  test("normalizes feed_short_video camelCase response data", () => {
    const parsed = parseOverseasShortVideosBody(overseasShortVideoBody(), { category_id: 11222 })

    expect(parsed).toMatchObject({
      hasMore: true,
      nextOffset: 40,
      categoryId: 11222,
      requestId: "overseas-request-1",
    })
    expect(parsed.items[0]).toMatchObject({
      id: "overseas-short-1",
      effectId: "overseas-short-1",
      effectType: 210,
      favoriteNum: 302,
      playNum: 9512,
      videoId: "v-overseas-1",
      videoDurationSec: 31,
      videoDurationMs: 31200,
      videoWidth: 1080,
      videoHeight: 1920,
      videoFps: 30,
      videoDefinition: "1080p",
      videoFormat: "mp4",
      videoCodec: "h264",
      videoHasAudio: true,
      videoIsMute: false,
      metadataEffectId: "creator-template",
      metadataEffectType: "tool",
    })
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

function shortVideoBody(): Record<string, unknown> {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      has_more: true,
      next_offset: 5,
      request_id: "request-short-1",
      category_id: 11222,
      item_list: [
        {
          common_attr: {
            id: "short-video-1",
            effect_id: "short-video-1",
            effect_type: 210,
            title: "",
            description: "来自故宫的猫税",
            cover_url: "https://example.invalid/cover.webp",
            cover_height: 1152,
            cover_width: 2048,
            aspect_ratio: 1.7777777777777777,
            create_time: 1775561323,
          },
          statistic: {
            usage_num: 0,
            favorite_num: 89886,
            play_num: 29884369,
            comment_num: 3172,
            share_num: 8766,
          },
          category_id_list: [11222],
          metadata_param: JSON.stringify({
            effect_id: "gen_story",
            effect_type: "tool",
          }),
          video: {
            video_id: "v03870g10004cu4siofog65s06ml296g",
            duration: 115,
            duration_ms: 114867,
            origin_video: {
              width: 2560,
              height: 1440,
              fps: 30,
              format: "mp4",
              codec: "h264",
              definition: "1440p",
              size: 207251143,
              video_url: "https://example.invalid/signed-video-url.mp4",
            },
            transcoded_video: {
              "720p": { definition: "720p" },
              "1080p": { definition: "1080p" },
              "480p": { definition: "480p" },
            },
            has_audio: true,
            is_mute: false,
          },
        },
      ],
    },
  }
}

function overseasShortVideoBody(): Record<string, unknown> {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      hasMore: true,
      nextOffset: 40,
      requestId: "overseas-request-1",
      itemList: [
        {
          commonAttr: {
            id: "overseas-short-1",
            effectId: "overseas-short-1",
            effectType: 210,
            description: "海外短视频参考",
            coverUrl: "https://example.invalid/cover.webp",
            coverHeight: 1920,
            coverWidth: 1080,
            aspectRatio: 0.5625,
          },
          statistic: {
            favoriteNum: 302,
            playNum: 9512,
            commentNum: 41,
            shareNum: 12,
          },
          categoryIdList: [11222],
          metadataParam: JSON.stringify({
            effectId: "creator-template",
            effectType: "tool",
          }),
          video: {
            videoId: "v-overseas-1",
            duration: 31,
            durationMs: 31200,
            originVideo: {
              width: 1080,
              height: 1920,
              fps: 30,
              format: "mp4",
              codec: "h264",
              definition: "1080p",
              videoUrl: "https://example.invalid/signed-overseas.mp4",
            },
            transcodedVideo: {
              "720p": { definition: "720p" },
            },
            hasAudio: true,
            isMute: false,
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
