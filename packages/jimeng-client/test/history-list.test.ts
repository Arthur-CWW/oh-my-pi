import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengHistoryListRequest,
  createJimengHttpTransport,
  fetchJimengHistoryList,
  JimengClient,
  JimengError,
  parseJimengHistoryFilterTypeListFlag,
  parseJimengHistoryListBody,
  readJimengHttpCassette,
  summarizeJimengHistoryList,
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

describe("Jimeng history list", () => {
  test("builds the frontend-derived get_history request shape", () => {
    expect(buildJimengHistoryListRequest({
      offset: 0,
      limit: 10,
      direction: 1,
      workspaceId: 14199856180236,
      filterTypeList: [1, 10, 10],
      orderBy: 0,
      hideStoryAgentResult: true,
      imageResolutionStrategy: {
        enableCommon: true,
        enableSmartCrop: true,
      },
    })).toEqual({
      offset: 0,
      count: 10,
      direction: 1,
      workspace_id: 14199856180236,
      filter_type_list: [1, 10],
      order_by: 0,
      hide_story_agent_result: true,
      image_resolution_strategy: {
        enable_common: true,
        enable_smart_crop: true,
      },
    })
    expect(parseJimengHistoryFilterTypeListFlag("1,10,1")).toEqual([1, 10])
    expect(() => buildJimengHistoryListRequest({ limit: 101 })).toThrow(JimengError)
    expect(() => buildJimengHistoryListRequest({ direction: 3 })).toThrow(JimengError)
  })

  test("accepts empty records_list as a valid no-spend read response", () => {
    const parsed = parseJimengHistoryListBody(emptyHistoryListBody())

    expect(parsed).toEqual({
      records: [],
      hasMore: false,
      nextOffset: 0,
      agentConversationSessionCount: 0,
    })
  })

  test("normalizes non-empty history rows without signed media URLs", () => {
    const parsed = parseJimengHistoryListBody(historyListBody())

    expect(parsed.records[0]).toMatchObject({
      lookupKey: "submit-1",
      historyRecordId: "39148697060354",
      submitId: "submit-1",
      status: 50,
      prompt: "韩系美妆健身UGC创作者，手机自拍构图。",
      modelReqKey: "high_aes_general_v50",
      itemCount: 1,
    })

    const summary = summarizeJimengHistoryList({
      endpoint: "/mweb/v1/get_history",
      httpStatus: 200,
      ret: "0",
      errmsg: "success",
      responseTextSha256: "hash",
      request: buildJimengHistoryListRequest({ limit: 10 }),
      records: parsed.records,
      hasMore: parsed.hasMore,
      nextOffset: parsed.nextOffset,
      agentConversationSessionCount: parsed.agentConversationSessionCount,
      body: historyListBody(),
    })

    expect(summary).toMatchObject({
      record_count: 1,
      has_more: true,
      next_offset: 20,
      by_status: { "50": 1 },
      media_counts: {
        total: 1,
        images: 1,
        image_urls_present: 1,
      },
    })
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).not.toContain("x-signature")
  })

  test("fetchJimengHistoryList posts the typed request", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify(emptyHistoryListBody()), requests),
    })

    const result = await fetchJimengHistoryList({
      client,
      session,
      query: {
        offset: 0,
        limit: 10,
        workspaceId: 14199856180236,
      },
    })

    expect(requests[0]?.url).toContain("/mweb/v1/get_history")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      offset: 0,
      count: 10,
      direction: 1,
      workspace_id: 14199856180236,
    })
    expect(result.records).toHaveLength(0)
    expect(result.hasMore).toBe(false)
  })

  test("can fetch through recorded and replayed HTTP transport cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-history-list-cassette-"))
    try {
      const cassettePath = path.join(dir, "history-list.json")
      const requests: Array<{ url: string; init?: RequestInit }> = []
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: mockFetch(JSON.stringify(emptyHistoryListBody()), requests),
        nowIso: () => "2026-06-11T00:00:00.000Z",
      })

      const recorded = await fetchJimengHistoryList({
        fetch: recordTransport.fetch,
        session,
        query: { limit: 10 },
      })

      expect(recorded.records).toHaveLength(0)
      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(1)
      expect(requests).toHaveLength(1)

      const replayTransport = createJimengHttpTransport({
        mode: "replay",
        cassettePath,
      })
      const replayed = await fetchJimengHistoryList({
        fetch: replayTransport.fetch,
        session,
        query: { limit: 10 },
      })

      expect(summarizeJimengHistoryList(replayed)).toMatchObject({
        endpoint: "/mweb/v1/get_history",
        record_count: 0,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("fails loudly when records_list disappears", () => {
    expect(() => parseJimengHistoryListBody({
      ret: "0",
      errmsg: "success",
      data: {
        has_more: false,
        next_offset: 0,
      },
    })).toThrow(JimengError)
  })
})

function emptyHistoryListBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      has_more: false,
      next_offset: 0,
      records_list: [],
      agent_conversation_session_map: null,
    },
  }
}

function historyListBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      has_more: true,
      next_offset: 20,
      agent_conversation_session_map: {
        session_1: { id: "session_1" },
      },
      records_list: [
        {
          generate_type: 1,
          history_record_id: "39148697060354",
          origin_history_record_id: "39148697060354",
          submit_id: "submit-1",
          created_time: 1780998990.928,
          finish_time: 1780999001,
          status: 50,
          history_group_key: "韩系美妆健身UGC创作者，手机自拍构图。",
          model_info: {
            model_req_key: "high_aes_general_v50",
            model_name: "图片5.0 Lite",
          },
          total_image_count: 4,
          finished_image_count: 4,
          item_list: [
            {
              common_attr: {
                id: "item-1",
                effect_id: "item-1",
                effect_type: 9,
                status: 102,
                cover_uri: "tos-cn-i-tb4s082cfz/cover",
                cover_url: "https://signed.example.invalid/cover.png?x-signature=secret",
              },
              image: {
                image_uri: "tos-cn-i-tb4s082cfz/final.png",
                image_url: "https://signed.example.invalid/final.png?x-signature=secret",
                width: 936,
                height: 1664,
                format: "png",
              },
            },
          ],
        },
      ],
    },
  }
}

function mockFetch(body: string, requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url: string, init?: RequestInit) => {
    requests.push({ url, init })
    const bytes = new TextEncoder().encode(body)
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => body,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }
  }
}
