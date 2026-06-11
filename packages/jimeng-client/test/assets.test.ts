import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengAssetsRequest,
  createJimengHttpTransport,
  fetchJimengAssets,
  JimengClient,
  JimengError,
  parseJimengAssetsBody,
  parseJimengAssetTypes,
  readJimengHttpCassette,
  summarizeJimengAssets,
  workspaceIdFromJimengSession,
  type JimengFetch,
  type JsonObject,
  type JsonValue,
  type JimengSessionBundle,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/generate/?type=image&workspace=14199856180236",
}

describe("Jimeng workbench assets", () => {
  test("builds the captured frontend asset-list request body", () => {
    const request = buildJimengAssetsRequest({
      count: 10,
      workspaceId: 14199856180236,
      assetTypes: [1, 2, 2, 12],
      endTimeStamp: 1780998990927,
      onlyFavorited: true,
    })

    expect(request).toMatchObject({
      count: 10,
      direction: 1,
      mode: "workbench",
      asset_type_list: [1, 2, 12],
      workspace_id: 14199856180236,
      option: {
        order_by: 0,
        only_favorited: true,
        end_time_stamp: 1780998990927,
        hide_story_agent_result: true,
      },
    })
    expect((request.option as { image_info: { image_scene_list: JsonValue[] } }).image_info.image_scene_list).toHaveLength(6)
  })

  test("validates asset-list flags and infers workspace id from session referer", () => {
    expect(parseJimengAssetTypes("1,2,12")).toEqual([1, 2, 12])
    expect(workspaceIdFromJimengSession(session)).toBe(14199856180236)
    expect(() => parseJimengAssetTypes("1,nope")).toThrow(JimengError)
    expect(() => buildJimengAssetsRequest({ count: 0 })).toThrow(JimengError)
    expect(() => buildJimengAssetsRequest({ workspaceId: 0 })).toThrow(JimengError)
  })

  test("normalizes image workbench assets without signed URLs", () => {
    const parsed = parseJimengAssetsBody(assetBody())

    expect(parsed).toMatchObject({
      hasMore: false,
      nextOffset: 1780998990927,
    })
    expect(parsed.assets[0]).toMatchObject({
      assetId: "39148697060354",
      assetType: 1,
      mediaKind: "image",
      image: {
        status: 50,
        taskStatus: 50,
        submitId: "submit-1",
        historyRecordId: "39148697060354",
        workspaceId: 14199856180236,
        prompt: "韩系美妆健身UGC创作者，手机自拍构图。",
        modelReqKey: "high_aes_general_v50",
        modelName: "图片5.0 Lite",
        seed: 105719980,
        totalImageCount: 4,
        finishedImageCount: 4,
      },
      generatedItems: [
        {
          id: "item-1",
          coverUri: "tos-cn-i-tb4s082cfz/cover",
          coverUrlPresent: true,
          coverMapKeys: ["1080", "2400"],
          imageUri: "tos-cn-i-tb4s082cfz/final.png",
          imageUrlPresent: true,
          imageWidth: 936,
          imageHeight: 1664,
          imageFormat: "png",
        },
      ],
    })

    const summary = summarizeJimengAssets({
      endpoint: "/mweb/v1/get_asset_list",
      httpStatus: 200,
      ret: "0",
      errmsg: "success",
      responseTextSha256: "hash",
      request: buildJimengAssetsRequest({ workspaceId: 14199856180236 }),
      ...parsed,
      body: assetBody(),
    })
    expect(summary).toMatchObject({
      asset_count: 1,
      by_asset_type: { "1": 1 },
      by_media_kind: { image: 1 },
      by_status: { "50": 1 },
    })
    expect(JSON.stringify(summary)).toContain("image_url_present")
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).not.toContain("x-signature")
  })

  test("fetchJimengAssets posts query and returns normalized items", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify(assetBody()), requests),
    })

    const result = await fetchJimengAssets({
      client,
      session,
      query: { count: 5, workspaceId: 14199856180236 },
    })

    expect(requests[0]?.url).toContain("/mweb/v1/get_asset_list")
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      count: 5,
      workspace_id: 14199856180236,
      mode: "workbench",
    })
    expect(result.ret).toBe("0")
    expect(result.assets[0]?.image?.modelReqKey).toBe("high_aes_general_v50")
  })

  test("can fetch through recorded and replayed HTTP transport cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-assets-cassette-"))
    try {
      const cassettePath = path.join(dir, "assets.json")
      const requests: Array<{ url: string; init?: RequestInit }> = []
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: mockFetch(JSON.stringify(assetBody()), requests),
        nowIso: () => "2026-06-11T00:00:00.000Z",
      })
      const query = { count: 5, workspaceId: 14199856180236 }

      const recorded = await fetchJimengAssets({
        fetch: recordTransport.fetch,
        session,
        query,
      })

      expect(recorded.assets).toHaveLength(1)
      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(1)
      expect(requests).toHaveLength(1)

      const replayTransport = createJimengHttpTransport({
        mode: "replay",
        cassettePath,
      })
      const replayed = await fetchJimengAssets({
        fetch: replayTransport.fetch,
        session,
        query,
      })

      expect(summarizeJimengAssets(replayed)).toMatchObject({
        endpoint: "/mweb/v1/get_asset_list",
        asset_count: 1,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function assetBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      has_more: false,
      next_offset: 1780998990927,
      asset_list: [
        {
          id: "39148697060354",
          uid: "2033447352671660",
          type: 1,
          image: {
            generate_type: 1,
            history_record_id: "39148697060354",
            created_time: 1780998990.928,
            item_list: [
              {
                common_attr: {
                  id: "item-1",
                  effect_id: "item-1",
                  effect_type: 9,
                  status: 102,
                  cover_uri: "tos-cn-i-tb4s082cfz/cover",
                  cover_url: "https://signed.example.invalid/cover.webp?x-signature=secret",
                  cover_url_map: {
                    "1080": "https://signed.example.invalid/1080.webp?x-signature=secret",
                    "2400": "https://signed.example.invalid/2400.webp?x-signature=secret",
                  },
                  cover_width: 936,
                  cover_height: 1664,
                },
                image: {
                  format: "png",
                  large_images: [
                    {
                      image_uri: "tos-cn-i-tb4s082cfz/final.png",
                      image_url: "https://signed.example.invalid/final.png?x-signature=secret",
                      width: 936,
                      height: 1664,
                      format: "png",
                    },
                  ],
                },
              },
            ],
            task: {
              task_id: "39148697060354",
              submit_id: "submit-1",
              status: 50,
            },
            mode: "workbench",
            asset_option: { has_favorited: false },
            status: 50,
            history_group_key: "韩系美妆健身UGC创作者，手机自拍构图。",
            draft_content: JSON.stringify({
              component_list: [
                {
                  abilities: {
                    generate: {
                      core_param: {
                        model: "high_aes_general_v50",
                        prompt: "draft prompt",
                        seed: 105719980,
                      },
                    },
                  },
                },
              ],
            }),
            model_info: {
              model_req_key: "high_aes_general_v50",
              model_name: "图片5.0 Lite",
            },
            total_image_count: 4,
            finished_image_count: 4,
            workspace_id: 14199856180236,
          },
        },
      ],
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
