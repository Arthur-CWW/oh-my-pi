import { describe, expect, test } from "bun:test"
import {
  buildJimengHistoryRecordsRequest,
  fetchJimengHistoryRecords,
  JimengClient,
  JimengError,
  parseJimengHistoryRecordsBody,
  parseJimengIdCsvFlag,
  summarizeJimengHistoryRecords,
  type JimengFetch,
  type JimengSessionBundle,
  type JsonObject,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/generate/?type=image&workspace=14199856180236",
}

describe("Jimeng history records", () => {
  test("builds get_history_by_ids request variants", () => {
    expect(buildJimengHistoryRecordsRequest({
      submitIds: ["submit-1", "submit-1"],
      historyIds: ["39148697060354"],
    })).toEqual({
      submit_ids: ["submit-1"],
      need_batch: true,
      history_ids: ["39148697060354"],
    })
    expect(parseJimengIdCsvFlag("submit-1,39148697060354")).toEqual(["submit-1", "39148697060354"])
    expect(() => buildJimengHistoryRecordsRequest({})).toThrow(JimengError)
    expect(() => buildJimengHistoryRecordsRequest({ submitIds: ["bad id"] })).toThrow(JimengError)
  })

  test("normalizes completed image records without signed URLs", () => {
    const parsed = parseJimengHistoryRecordsBody(historyBody())

    expect(parsed[0]).toMatchObject({
      lookupKey: "submit-1",
      historyRecordId: "39148697060354",
      submitId: "submit-1",
      status: 50,
      taskStatus: 50,
      prompt: "韩系美妆健身UGC创作者，手机自拍构图。",
      modelReqKey: "high_aes_general_v50",
      modelName: "图片5.0 Lite",
      seed: 105719980,
      totalImageCount: 4,
      finishedImageCount: 4,
      itemCount: 1,
      items: [
        {
          id: "item-1",
          coverUri: "tos-cn-i-tb4s082cfz/cover",
          coverUrlPresent: true,
          coverMapKeys: ["1080"],
          imageUri: "tos-cn-i-tb4s082cfz/final.png",
          imageUrlPresent: true,
          imageWidth: 936,
          imageHeight: 1664,
          imageFormat: "png",
        },
      ],
    })

    const summary = summarizeJimengHistoryRecords({
      endpoint: "/mweb/v1/get_history_by_ids",
      httpStatus: 200,
      ret: "0",
      errmsg: "success",
      responseTextSha256: "hash",
      request: buildJimengHistoryRecordsRequest({ submitIds: ["submit-1"] }),
      records: parsed,
      body: historyBody(),
    })
    expect(summary).toMatchObject({
      record_count: 1,
      by_status: { "50": 1 },
    })
    expect(JSON.stringify(summary)).toContain("image_url_present")
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).not.toContain("x-signature")
  })

  test("fetchJimengHistoryRecords posts submit and history ids", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify(historyBody()), requests),
    })

    const result = await fetchJimengHistoryRecords({
      client,
      session,
      query: {
        submitIds: ["submit-1"],
        historyIds: ["39148697060354"],
      },
    })

    expect(requests[0]?.url).toContain("/mweb/v1/get_history_by_ids")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      submit_ids: ["submit-1"],
      need_batch: true,
      history_ids: ["39148697060354"],
    })
    expect(result.records[0]?.status).toBe(50)
  })
})

function historyBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      "submit-1": {
        generate_type: 1,
        history_record_id: "39148697060354",
        origin_history_record_id: "39148697060354",
        submit_id: "submit-1",
        created_time: 1780998990.928,
        finish_time: 1780999001,
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
              },
            },
            image: {
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
          submit_id: "submit-1",
          status: 50,
        },
        mode: "workbench",
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
      },
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
