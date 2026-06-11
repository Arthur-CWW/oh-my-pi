import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengHistoryQueueInfoRequest,
  createJimengHttpTransport,
  fetchJimengHistoryQueueInfo,
  JimengClient,
  JimengError,
  parseJimengHistoryIdsFlag,
  parseJimengHistoryQueueInfoBody,
  readJimengHttpCassette,
  summarizeJimengHistoryQueueInfo,
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

describe("Jimeng history queue info", () => {
  test("builds the confirmed snake_case history queue request", () => {
    expect(buildJimengHistoryQueueInfoRequest({ historyIds: ["39148697060354", "39148697060354"] })).toEqual({
      history_ids: ["39148697060354"],
    })
    expect(parseJimengHistoryIdsFlag("39148697060354,39156175522050")).toEqual(["39148697060354", "39156175522050"])
    expect(() => buildJimengHistoryQueueInfoRequest({ historyIds: [] })).toThrow(JimengError)
    expect(() => buildJimengHistoryQueueInfoRequest({ historyIds: ["bad id"] })).toThrow(JimengError)
  })

  test("normalizes queue details without leaking raw debug info", () => {
    const parsed = parseJimengHistoryQueueInfoBody(queueBody())

    expect(parsed).toEqual([
      {
        historyId: "39148697060354",
        status: 0,
        failCode: null,
        failMsg: null,
        queueInfo: {
          queueIdx: 0,
          priority: 2,
          queueStatus: 3,
          queueLength: 0,
          pollingIntervalSeconds: 30,
          pollingTimeoutSeconds: 86400,
          vipQueuingTimeThreshold: 300,
          waitingTimeThreshold: 60,
          debugInfoPresent: true,
          debugInfoSha256: "26f00489be180b2bdf34b6f2ca401e371ef5c42ffc7a77d418acd1e0a6e39917",
        },
        forecastCostTime: {
          forecastGenerateCost: 9,
          forecastQueueCost: 0,
        },
      },
    ])

    const summary = summarizeJimengHistoryQueueInfo({
      endpoint: "/mweb/v1/get_history_queue_info",
      httpStatus: 200,
      ret: "0",
      errmsg: "success",
      responseTextSha256: "hash",
      request: buildJimengHistoryQueueInfoRequest({ historyIds: ["39148697060354"] }),
      entries: parsed,
      body: queueBody(),
    })
    expect(summary).toMatchObject({
      entry_count: 1,
      by_status: { "0": 1 },
      by_queue_status: { "3": 1 },
    })
    expect(JSON.stringify(summary)).toContain("debug_info_sha256")
    expect(JSON.stringify(summary)).not.toContain("internal-queue-name")
  })

  test("fetchJimengHistoryQueueInfo posts snake_case body", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify(queueBody()), requests),
    })

    const result = await fetchJimengHistoryQueueInfo({
      client,
      session,
      historyIds: ["39148697060354"],
    })

    expect(requests[0]?.url).toContain("/mweb/v1/get_history_queue_info")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      history_ids: ["39148697060354"],
    })
    expect(result.entries[0]?.queueInfo?.queueStatus).toBe(3)
  })

  test("can fetch through recorded and replayed HTTP transport cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-history-queue-cassette-"))
    try {
      const cassettePath = path.join(dir, "history-queue.json")
      const requests: Array<{ url: string; init?: RequestInit }> = []
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: mockFetch(JSON.stringify(queueBody()), requests),
        nowIso: () => "2026-06-11T00:00:00.000Z",
      })
      const historyIds = ["39148697060354"]

      const recorded = await fetchJimengHistoryQueueInfo({
        fetch: recordTransport.fetch,
        session,
        historyIds,
      })

      expect(recorded.entries).toHaveLength(1)
      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(1)
      expect(requests).toHaveLength(1)

      const replayTransport = createJimengHttpTransport({
        mode: "replay",
        cassettePath,
      })
      const replayed = await fetchJimengHistoryQueueInfo({
        fetch: replayTransport.fetch,
        session,
        historyIds,
      })

      expect(summarizeJimengHistoryQueueInfo(replayed)).toMatchObject({
        endpoint: "/mweb/v1/get_history_queue_info",
        entry_count: 1,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function queueBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      "39148697060354": {
        status: 0,
        queue_info: {
          queue_idx: 0,
          priority: 2,
          queue_status: 3,
          queue_length: 0,
          polling_config: {
            interval_seconds: 30,
            timeout_seconds: 86400,
          },
          priority_queue_display_threshold: {
            vip_queuing_time_threshold: 300,
            waiting_time_threshold: 60,
          },
          debug_info: "{\"queue\":\"internal-queue-name\"}",
        },
        forecast_cost_time: {
          forecast_generate_cost: 9,
          forecast_queue_cost: 0,
        },
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
