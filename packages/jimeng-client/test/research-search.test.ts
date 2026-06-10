import { createCipheriv } from "node:crypto"
import { describe, expect, test } from "bun:test"
import {
  buildJimengResearchSearchRequest,
  fetchJimengResearchSearch,
  JimengClient,
  JimengError,
  parseJimengResearchAssetType,
  parseJimengResearchSearchChannel,
  parseJimengResearchShowTypeList,
  summarizeJimengResearchSearch,
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

const searchMediaKey = Buffer.from("9f2b4c7a65d1e3f827b5a3cfd4e9c1a0ff4b2d6e7a9c8b2f0d1e3f4c9a2b5d6c", "hex")

describe("Jimeng research search", () => {
  test("parses flags and builds inspiration and asset request shapes", () => {
    expect(parseJimengResearchSearchChannel(undefined)).toBe("inspiration")
    expect(parseJimengResearchSearchChannel("short-film")).toBe("short-film")
    expect(() => parseJimengResearchSearchChannel("video")).toThrow("must be inspiration, short-film, or asset")
    expect(parseJimengResearchAssetType("canvas-project")).toBe("canvas-project")
    expect(parseJimengResearchAssetType("9")).toBe(9)
    expect(parseJimengResearchShowTypeList("1,3,1")).toEqual([1, 3])

    expect(buildJimengResearchSearchRequest({
      channel: "short-film",
      keyword: " 韩系美妆 ",
      count: 6,
      cursor: 12,
      searchId: "search-1",
      needIntentionMark: false,
    })).toEqual({
      keyword: "韩系美妆",
      count: 6,
      search_channel: "short_film",
      cursor: 12,
      source: "search",
      image_info: {},
      pack_item_opt: { need_intention_mark: false },
      search_id: "search-1",
    })

    expect(buildJimengResearchSearchRequest({
      channel: "asset",
      keyword: "",
      assetType: "video",
      workspaceId: 0,
      onlyFavorited: true,
      showTypeList: [1, 3],
      isInsertFrame: false,
      hideStoryAgentResult: true,
      beginTimeStamp: 100,
      endTimeStamp: 200,
    })).toEqual({
      keyword: "",
      count: 20,
      search_channel: "asset",
      cursor: 0,
      source: "search",
      image_info: {},
      search_id: "",
      workspace_id: 0,
      cond: {
        asset_type: 2,
        block_index: 0,
        only_favorited: true,
        show_type_list: [1, 3],
        is_insert_frame: false,
        hide_story_agent_result: true,
        begin_time_stamp: 100,
        end_time_stamp: 200,
      },
    })
  })

  test("fetches and normalizes inspiration rows while tolerating additive fields", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify(inspirationBody()), requests),
    })
    const result = await fetchJimengResearchSearch({
      client,
      session,
      query: { channel: "inspiration", keyword: "韩系美妆", count: 3 },
    })
    const summary = summarizeJimengResearchSearch(result)

    expect(new URL(requests[0]!.url).pathname).toBe("/mweb/search/v1/search")
    expect(JSON.parse(String(requests[0]!.init?.body))).toMatchObject({
      keyword: "韩系美妆",
      search_channel: "inspiration",
      count: 3,
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: null,
      idWasUnsafeNumber: true,
      title: "Glass skin hook",
      prompt: "K-beauty creator holding serum",
      authorName: "Sora",
      coverUri: "tos-cn-i/example",
      imageUri: "tos-cn-i/example",
      playCount: 1200,
      hashTags: ["美妆", "护肤"],
    })
    expect(summary).toMatchObject({
      channel: "inspiration",
      item_count: 1,
      asset_count: 0,
      items: [{
        cover_url_present: true,
        image_url_present: true,
      }],
    })
  })

  test("reproduces the frontend cache-token and media URL decrypt transform", async () => {
    const logId = "00112233445566778899aabbccddeeff"
    const mediaIv = Buffer.from("ffeeddccbbaa99887766554433221100", "hex")
    const coverUrl = "https://example.test/cover.webp"
    const videoUrl = "https://example.test/video.mp4"
    const cacheSyncToken = encrypt(Buffer.from(mediaIv), Buffer.from(logId, "hex"))
    const body = inspirationBody({
      logid: logId,
      cache_sync_token: cacheSyncToken,
      data: {
        data_list: [{
          item: {
            common_attr: {
              id: "item-1",
              title: "Encrypted",
              cover_url: encrypt(Buffer.from(coverUrl), mediaIv),
            },
            video: {
              origin_video: {
                video_url: encrypt(Buffer.from(videoUrl), mediaIv),
              },
            },
          },
        }],
        search_id: "search-1",
        has_more: false,
        next_cursor: 1,
      },
    })
    const client = new JimengClient({ fetch: mockFetch(JSON.stringify(body), []) })

    const result = await fetchJimengResearchSearch({
      client,
      session,
      query: { channel: "short-film", keyword: "hook" },
    })

    expect(result.decryptionApplied).toBe(true)
    expect(result.items[0]?.coverUrl).toBe(coverUrl)
    expect(result.items[0]?.videoUrl).toBe(videoUrl)
  })

  test("normalizes asset rows and preserves unsafe numeric ids honestly", async () => {
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify(assetBody()), []),
    })
    const result = await fetchJimengResearchSearch({
      client,
      session,
      query: { channel: "asset", keyword: "", assetType: "image", workspaceId: 0 },
    })

    expect(result.items).toHaveLength(0)
    expect(result.assets).toHaveLength(1)
    expect(result.assets[0]).toMatchObject({
      id: "asset-1",
      assetType: 1,
      mediaKind: "image",
      status: 50,
      historyRecordId: "12730336145164",
      historyRecordIdWasUnsafeNumber: false,
      workspaceId: 0,
    })
    expect(result.assets[0]?.generatedItems[0]).toMatchObject({
      id: "generated-1",
      imageUri: "tos-cn-i/generated",
    })
  })

  test("rejects contract drift and nonzero provider responses", async () => {
    const missingListClient = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          search_id: "search-1",
          has_more: false,
          next_cursor: 0,
          additive_provider_field: true,
        },
      }), []),
    })
    await expect(fetchJimengResearchSearch({
      client: missingListClient,
      session,
      query: { channel: "inspiration", keyword: "hook" },
    })).rejects.toBeInstanceOf(JimengError)

    const failedClient = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "1000",
        errmsg: "invalid parameter",
        data: {
          data_list: [],
          search_id: "",
          has_more: false,
          next_cursor: 0,
        },
      }), []),
    })
    await expect(fetchJimengResearchSearch({
      client: failedClient,
      session,
      query: { channel: "inspiration", keyword: "hook" },
    })).rejects.toBeInstanceOf(JimengError)
  })
})

function inspirationBody(overrides: JsonObject = {}): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    logid: "20260611000000AABBCCDDEEFF00112233",
    data: {
      data_list: [{
        item: {
          common_attr: {
            id: 7566529901126274000,
            title: " Glass skin hook ",
            description: "A serum demo",
            cover_uri: "tos-cn-i/example",
            cover_url: "https://example.test/cover.webp",
            cover_width: 1080,
            cover_height: 1920,
          },
          image: {
            large_images: [{
              image_uri: "tos-cn-i/example",
              image_url: "https://example.test/image.webp",
              width: 1080,
              height: 1920,
              format: "webp",
            }],
          },
          author: {
            uid: "author-1",
            sec_uid: "sec-1",
            name: "Sora",
            avatar_url: "https://example.test/avatar.webp",
          },
          statistic: {
            play_num: 1200,
            favorite_num: 90,
            usage_num: 8,
          },
          sharing_info: {
            hash_tags: [
              { id: "1", name: "美妆" },
              { id: "2", name: "护肤" },
            ],
          },
          aigc_image_params: {
            template_id: "template-1",
            text2image_params: {
              prompt: "K-beauty creator holding serum",
              model_config: {
                model_req_key: "high_aes_general_v50",
                model_name: "图片5.0 Lite",
              },
            },
          },
          additive_provider_field: true,
        },
        rel_score: 1,
        search_item_type: 1,
      }],
      search_id: "search-1",
      has_more: true,
      next_cursor: 1,
      additive_provider_field: true,
    },
    additive_provider_field: true,
    ...overrides,
  }
}

function assetBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    logid: "20260611000000AABBCCDDEEFF00112233",
    data: {
      data_list: [{
        asset: {
          id: "asset-1",
          uid: "user-1",
          type: 1,
          image: {
            status: 50,
            submit_id: "submit-1",
            history_record_id: 12730336145164,
            workspace_id: 0,
            generate_type: 1,
            mode: "workbench",
            item_list: [{
              common_attr: {
                id: "generated-1",
                cover_uri: "tos-cn-i/generated",
                cover_url: "https://example.test/generated.webp",
              },
              image: {
                large_images: [{
                  image_uri: "tos-cn-i/generated",
                  image_url: "https://example.test/generated.webp",
                  width: 2048,
                  height: 2048,
                  format: "png",
                }],
              },
            }],
          },
        },
      }],
      search_id: "search-assets",
      has_more: false,
      next_cursor: 1,
      can_search_deeper: false,
    },
  }
}

function encrypt(value: Buffer, iv: Buffer): string {
  const cipher = createCipheriv("aes-256-cbc", searchMediaKey, iv)
  return Buffer.concat([cipher.update(value), cipher.final()]).toString("base64")
}

function mockFetch(body: string, requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url, init) => {
    requests.push({ url, init })
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
