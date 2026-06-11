import { describe, expect, test } from "bun:test"
import {
  buildJimengProfileFavoritesRequest,
  buildJimengProfileFollowRequest,
  buildJimengProfileHomepageRequest,
  buildJimengProfileBatchItemsRequest,
  buildJimengProfileItemRequest,
  buildJimengProfileStoriesRequest,
  buildJimengProfileUserRequest,
  fetchJimengProfileResearch,
  JimengClient,
  JimengError,
  parseJimengPublishedItemIds,
  parseJimengProfileImageTypeList,
  parseJimengProfileResearchEndpoints,
  summarizeJimengProfileResearch,
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

describe("Jimeng profile research", () => {
  test("parses endpoint flags and builds exact wire request shapes", () => {
    expect(parseJimengProfileResearchEndpoints(undefined)).toEqual(["profile", "homepage", "favorites", "stories"])
    expect(parseJimengProfileResearchEndpoints("followers,profile,followers")).toEqual(["followers", "profile"])
    expect(parseJimengProfileResearchEndpoints("all")).toEqual([
      "profile",
      "homepage",
      "favorites",
      "stories",
      "following",
      "followers",
      "item",
      "items",
    ])
    expect(() => parseJimengProfileResearchEndpoints("videos")).toThrow("profile-research --endpoints")
    expect(() => parseJimengProfileResearchEndpoints(",")).toThrow("at least one endpoint")
    expect(parseJimengProfileImageTypeList("3,4,7,3")).toEqual([3, 4, 7])
    expect(parseJimengPublishedItemIds("7524730786826751247,7572448714904603931,7524730786826751247"))
      .toEqual(["7524730786826751247", "7572448714904603931"])

    expect(buildJimengProfileUserRequest("sec-1")).toEqual({ sec_uid: "sec-1" })
    expect(buildJimengProfileHomepageRequest({
      secUid: "sec-1",
      count: 8,
      offset: 20,
      imageTypeList: [5],
      feedRefer: "feed_enterauto",
    })).toEqual({
      sec_uid: "sec-1",
      image_info: {},
      count: 8,
      feed_refer: "feed_enterauto",
      image_type_list: [5],
      offset: 20,
    })
    expect(buildJimengProfileFavoritesRequest({ secUid: "sec-1" })).toEqual({
      sec_uid: "sec-1",
      image_info: {},
      count: 12,
      image_type_list: [3, 4, 7],
      offset: 0,
    })
    expect(buildJimengProfileStoriesRequest({ secUid: "sec-1", count: 6 })).toEqual({
      sec_uid: "sec-1",
      count: 6,
      offset: 0,
    })
    expect(buildJimengProfileFollowRequest("following", { count: 10 })).toEqual({
      list_type: 1,
      count: 10,
      offset: 0,
    })
    expect(buildJimengProfileFollowRequest("followers", { count: 10 })).toEqual({
      list_type: 2,
      count: 10,
      offset: 0,
    })
    expect(buildJimengProfileItemRequest("7524730786826751247")).toEqual({
      published_item_id: "7524730786826751247",
    })
    expect(buildJimengProfileBatchItemsRequest(["7524730786826751247", "7572448714904603931"])).toEqual({
      item_id_list: ["7524730786826751247", "7572448714904603931"],
    })
  })

  test("fetches public profile works, current-account follows, and item detail sequentially", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify(userInfoBody()),
        JSON.stringify(itemListBody(false)),
        JSON.stringify(itemListBody(true)),
        JSON.stringify(storyListBody()),
        JSON.stringify(followListBody()),
        JSON.stringify(followListBody([])),
        JSON.stringify(itemDetailBody()),
        JSON.stringify(batchItemDetailBody()),
      ], requests),
    })

    const result = await fetchJimengProfileResearch({
      client,
      session,
      query: {
        endpoints: parseJimengProfileResearchEndpoints("all"),
        secUid: "sec-public-1",
        publishedItemId: "7524730786826751247",
        publishedItemIds: ["7524730786826751247", "7572448714904603931"],
        count: 6,
      },
    })
    const summary = summarizeJimengProfileResearch(result)

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/mweb/v1/get_user_info",
      "/mweb/v1/get_homepage",
      "/mweb/v1/get_favorite_list",
      "/mweb/v1/get_user_story_list",
      "/mweb/v1/get_follow_list",
      "/mweb/v1/get_follow_list",
      "/mweb/v1/get_item_info",
      "/mweb/v1/mget_item_info",
    ])
    expect(JSON.parse(String(requests[3]?.init?.body))).toMatchObject({ sec_uid: "sec-public-1", count: 6 })
    expect(JSON.parse(String(requests[4]?.init?.body))).toMatchObject({ list_type: 1 })
    expect(JSON.parse(String(requests[5]?.init?.body))).toMatchObject({ list_type: 2 })
    expect(JSON.parse(String(requests[7]?.init?.body))).toEqual({
      item_id_list: ["7524730786826751247", "7572448714904603931"],
    })
    expect(result.results.find((item) => item.endpointId === "profile")?.profile).toMatchObject({
      name: "Sora",
      secUid: "sec-public-1",
      followerCount: 595,
    })
    expect(result.results.find((item) => item.endpointId === "homepage")?.items[0]).toMatchObject({
      id: "7524730786826751247",
      prompt: "turn toward camera with calm confidence",
      modelReqKey: "dreamina_ic_generate_video_model_vgfm_3.0",
      generateType: 10,
      videoAspectRatio: "9:16",
      firstFrameImageUri: "tos-cn-i/frame-1",
      videoWidth: 704,
      videoHeight: 1248,
      videoFormat: "mp4",
    })
    expect(result.results.find((item) => item.endpointId === "following")?.scope).toBe("current-account")
    expect(result.results.find((item) => item.endpointId === "following")?.profiles[0]).toMatchObject({
      name: "Current Follow",
      followerCount: 37,
    })
    expect(result.results.find((item) => item.endpointId === "stories")?.stories[0]).toMatchObject({
      storyId: "story-1",
      draftId: "draft-1",
      name: "Routine archive",
      coverWidth: 720,
      coverHeight: 1280,
    })
    expect(result.results.find((item) => item.endpointId === "item")?.items).toHaveLength(1)
    expect(result.results.find((item) => item.endpointId === "items")?.items).toHaveLength(2)
    expect(summary).toMatchObject({
      result_count: 8,
      skipped: [],
      results: expect.arrayContaining([
        expect.objectContaining({
          endpoint_id: "homepage",
          item_count: 1,
          items: [
            expect.objectContaining({
              video_url_present: true,
              first_frame_image_url_present: true,
            }),
          ],
        }),
        expect.objectContaining({
          endpoint_id: "stories",
          story_count: 1,
          stories: [
            expect.objectContaining({
              story_id: "story-1",
              cover_url_present: true,
            }),
          ],
        }),
        expect.objectContaining({
          endpoint_id: "items",
          item_count: 2,
          total_count: 2,
        }),
      ]),
    })
    const summaryText = JSON.stringify(summary)
    expect(summaryText).not.toContain("x-signature=secret")
    expect(summaryText).not.toContain("https://signed.example.invalid")
  })

  test("skips optional item detail without an id and rejects required contract drift", async () => {
    const listClient = new JimengClient({
      fetch: mockFetchSequence([JSON.stringify(followListBody())], []),
    })
    const result = await fetchJimengProfileResearch({
      client: listClient,
      session,
      query: {
        endpoints: ["following", "item", "items"],
        count: 5,
      },
    })
    expect(result.results.map((item) => item.endpointId)).toEqual(["following"])
    expect(result.skipped).toEqual([
      { endpoint: "item", reason: "missing --publishedItemId" },
      { endpoint: "items", reason: "missing --publishedItemIds" },
    ])

    const driftClient = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify({ ret: "0", errmsg: "success", data: { additive_provider_field: true } }),
      ], []),
    })
    await expect(fetchJimengProfileResearch({
      client: driftClient,
      session,
      query: { endpoints: ["homepage"], secUid: "sec-public-1" },
    })).rejects.toBeInstanceOf(JimengError)
  })
})

function userInfoBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      name: "Sora",
      avatar_url: "https://signed.example.invalid/avatar.webp?x-signature=secret",
      uid: "998822791880119",
      sec_uid: "sec-public-1",
      total_materials_usage: 12,
      total_materials_favorite: 3715,
      total_materials_like: 200,
      follow: 1,
      fans: 595,
      has_followed: false,
      description: "K-beauty creator",
      status: 0,
      show_followers: true,
      show_following: true,
      show_likes: true,
      show_favorites: true,
      additive_provider_field: true,
    },
  }
}

function itemListBody(favorite: boolean): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      item_list: [profileItem()],
      has_more: false,
      next_offset: favorite ? 12 : 1751987932,
      ...(favorite ? {} : { total_count: 1 }),
      additive_provider_field: true,
    },
  }
}

function followListBody(users: JsonObject[] = [{
  name: "Current Follow",
  avatar_url: "https://signed.example.invalid/follow.webp?x-signature=secret",
  uid: "3359710805498199",
  sec_uid: "sec-follow-1",
  total_materials_usage: 8,
  total_materials_favorite: 106,
  follow: 0,
  fans: 37,
  has_followed: true,
  description: "",
  status: 0,
}]): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      has_more: false,
      next_offset: 10,
      user_list: users,
      additive_provider_field: true,
    },
  }
}

function storyListBody(): JsonObject {
  return {
    ret: 0,
    errmsg: "success",
    data: {
      story_list: [{
        story_id: "story-1",
        draft_id: "draft-1",
        name: "Routine archive",
        desc: "Daily K-beauty morning story set",
        story_version: 4,
        create_at: 1751987932,
        modify_at: 1751988999,
        has_favored: true,
        cover: {
          image_uri: "tos-cn-i/story-cover",
          image_url: "https://signed.example.invalid/story-cover.webp?x-signature=secret",
          width: 720,
          height: 1280,
          format: "webp",
        },
        additive_provider_field: true,
      }],
      has_more: false,
      next_offset: 0,
      additive_provider_field: true,
    },
  }
}

function itemDetailBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: profileItem(),
  }
}

function batchItemDetailBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      effect_item_list: [
        profileItem("7524730786826751247"),
        profileItem("7572448714904603931"),
      ],
      deduct_list: null,
      dto_list: null,
      additive_provider_field: true,
    },
  }
}

function profileItem(id = "7524730786826751247"): JsonObject {
  return {
    common_attr: {
      id,
      title: "K-beauty hook",
      description: "",
      cover_uri: "tos-cn-p/cover-1",
      cover_url: "https://signed.example.invalid/cover.webp?x-signature=secret",
      cover_width: 360,
      cover_height: 640,
    },
    author: {
      uid: "998822791880119",
      sec_uid: "sec-public-1",
      name: "Sora",
      avatar_url: "https://signed.example.invalid/avatar.webp?x-signature=secret",
    },
    statistic: {
      play_num: 1200,
      favorite_num: 91,
      usage_num: 8,
    },
    video: {
      video_id: "v03870g10004d1md60vog65oo5uvgtng",
      duration: 6,
      duration_ms: 5042,
      has_audio: false,
      is_mute: false,
      transcoded_video: {
        origin: {
          fps: 24,
          width: 704,
          height: 1248,
          duration: 5.042,
          video_url: "https://signed.example.invalid/video.mp4?x-signature=secret",
          format: "mp4",
          definition: "origin",
        },
      },
    },
    aigc_image_params: {
      generate_type: 10,
      first_generate_type: 10,
      text2video_params: {
        video_aspect_ratio: "9:16",
        seed: 1345529316,
        model_req_key: "dreamina_ic_generate_video_model_vgfm_3.0",
        model_config: {
          model_req_key: "dreamina_ic_generate_video_model_vgfm_3.0",
          model_name: "Seedance 1.0 mini",
        },
        video_gen_inputs: [{
          prompt: "turn toward camera with calm confidence",
          first_frame_image: {
            image_uri: "tos-cn-i/frame-1",
            image_url: "https://signed.example.invalid/frame.png?x-signature=secret",
            width: 1080,
            height: 1920,
            format: "png",
          },
        }],
      },
    },
    additive_provider_field: true,
  }
}

function mockFetchSequence(
  bodies: string[],
  requests: Array<{ url: string; init?: RequestInit }>,
): JimengFetch {
  let index = 0
  return async (url, init) => {
    requests.push({ url, init })
    const body = bodies[index]
    index += 1
    if (body === undefined) throw new Error(`unexpected request ${url}`)
    return {
      ok: true,
      status: 200,
      async text() {
        return body
      },
      async arrayBuffer() {
        return new TextEncoder().encode(body).buffer
      },
    }
  }
}
