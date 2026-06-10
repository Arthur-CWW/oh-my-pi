import { describe, expect, test } from "bun:test"
import { collectImageUrls, JimengClient, JimengError, type JimengFetch } from "../src"

function mockFetchFromQueue(textResponses: Array<{ status: number; text: string }>, bytes: Record<string, string> = {}): JimengFetch {
  const queue = [...textResponses]
  return async (url: string, init?: RequestInit) => {
    if (!init?.method || init.method === "GET") {
      const value = bytes[url]
      if (value === undefined) throw new Error(`No mocked bytes for ${url}`)
      return new Response(value, { status: 200 })
    }

    const next = queue.shift()
    if (!next) throw new Error(`No mocked text response for ${url}`)
    return new Response(next.text, { status: next.status })
  }
}

describe("JimengClient", () => {
  test("submitVideo resolves submit and history IDs", async () => {
    const client = new JimengClient({
      fetch: mockFetchFromQueue([
        {
          status: 200,
          text: JSON.stringify({
            ret: 0,
            errmsg: "ok",
            data: {
              aigc_data: {
                submit_id: "video-submit-id",
                history_record_id: "history-id-001",
              },
            },
            provider_extra: { untouched: true },
          }),
        },
      ]),
    })

    const result = await client.submitVideo({
      submitUrl: "https://jimeng.example.test/mweb/v1/aigc_draft/generate",
      submitHeaders: { "content-type": "application/json" },
      submitBody: { submit_id: "fallback-submit-id" },
      submitId: "fallback-submit-id",
    })

    expect(result.submitId).toBe("video-submit-id")
    expect(result.historyId).toBe("history-id-001")
    expect(result.httpStatus).toBe(200)
    expect(result.responseTextSha256.length).toBe(64)
  })

  test("submitImage fails fast on submit_info rejection", async () => {
    const client = new JimengClient({
      fetch: mockFetchFromQueue([
        {
          status: 200,
          text: [
            "event: message",
            'data: {"event_data":{"submit_info":{"code":1017,"msg":"CheckPermission"}}}',
            "",
          ].join("\n"),
        },
      ]),
    })

    await expect(
      client.submitImage({
        submitUrl: "https://jimeng.example.test/mweb/v1/creation_agent/v2/conversation",
        submitHeaders: { "content-type": "application/json" },
        submitBody: { messages: [] },
      }),
    ).rejects.toMatchObject({ category: "auth", code: "IMAGE_SUBMIT_REJECTED", retryable: false })
  })

  test("pollUntilTerminal returns record + trace and preserves unknown fields", async () => {
    const submitId = "poll-submit-id"
    const client = new JimengClient({
      fetch: mockFetchFromQueue([
        {
          status: 200,
          text: JSON.stringify({ ret: 0, data: { [submitId]: { status: 30, item_list: [] } } }),
        },
        {
          status: 200,
          text: JSON.stringify({
            ret: 0,
            data: {
              [submitId]: {
                status: 50,
                unexpected_meta: { source: "provider", nested: { keep_me: true } },
                item_list: [{ video: { play_url: "https://cdn.example.test/video.mp4" } }],
              },
            },
          }),
        },
      ]),
    })

    const result = await client.pollUntilTerminal({
      pollUrl: "https://jimeng.example.test/mweb/v1/get_history_by_ids",
      pollHeaders: { "content-type": "application/json" },
      submitId,
      terminalStatus: 50,
      pollIntervalMs: 0,
      maxPolls: 2,
    })

    expect(result.trace.length).toBe(2)
    expect(result.trace[0]?.status).toBe(30)
    expect(result.trace[1]?.status).toBe(50)
    expect(result.record.unexpected_meta).toEqual({ source: "provider", nested: { keep_me: true } })
  })

  test("pollUntilTerminal can poll current workbench image asset list", async () => {
    const submitId = "image-submit-id"
    const client = new JimengClient({
      fetch: mockFetchFromQueue([
        {
          status: 200,
          text: JSON.stringify({
            ret: "0",
            data: {
              asset_list: [
                {
                  id: "history-id-001",
                  image: {
                    submit_id: submitId,
                    status: 42,
                    item_list: [],
                  },
                },
              ],
            },
          }),
        },
        {
          status: 200,
          text: JSON.stringify({
            ret: "0",
            data: {
              asset_list: [
                {
                  id: "history-id-001",
                  image: {
                    submit_id: submitId,
                    status: 50,
                    total_image_count: 4,
                    finished_image_count: 4,
                    item_list: [
                      {
                        image: {
                          large_images: [{ image_url: "https://img.example/final.png" }],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          }),
        },
      ]),
    })

    const result = await client.pollUntilTerminal({
      pollUrl: "https://jimeng.example.test/mweb/v1/get_asset_list",
      pollHeaders: { "content-type": "application/json" },
      submitId,
      terminalStatus: 50,
      pollKind: "asset_list_first_image",
      pollBody: { count: 20, workspace_id: 123 },
      pollIntervalMs: 0,
      maxPolls: 2,
    })

    expect(result.trace.map((entry) => entry.status)).toEqual([42, 50])
    expect(result.record.finished_image_count).toBe(4)
    expect(collectImageUrls(result.record)).toEqual(["https://img.example/final.png"])
  })

  test("pollUntilTerminal times out with typed timeout error", async () => {
    const submitId = "never-terminal"
    const client = new JimengClient({
      fetch: mockFetchFromQueue([
        {
          status: 200,
          text: JSON.stringify({ ret: 0, data: { [submitId]: { status: 30, item_list: [] } } }),
        },
      ]),
    })

    await expect(
      client.pollUntilTerminal({
        pollUrl: "https://jimeng.example.test/mweb/v1/get_history_by_ids",
        pollHeaders: { "content-type": "application/json" },
        submitId,
        terminalStatus: 50,
        pollIntervalMs: 0,
        maxPolls: 1,
      }),
    ).rejects.toBeInstanceOf(JimengError)
  })

  test("requestText opens a risk-control cooldown after a shark response", async () => {
    let nowMs = 1_000
    let requestCount = 0
    const client = new JimengClient({
      fetch: async () => {
        requestCount += 1
        return new Response(JSON.stringify({ ret: 1019, errmsg: "shark not pass" }), { status: 200 })
      },
      riskControlBreaker: {
        cooldownMs: 60_000,
        nowMs: () => nowMs,
      },
    })

    await expect(
      client.requestText("https://jimeng.example.test/mweb/v1/aigc_draft/generate", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toMatchObject({
      category: "risk_control",
      code: "SHARK_NOT_PASS",
      retryable: false,
    })

    expect(client.getRiskControlBreakerState()).toEqual({
      consecutiveHits: 1,
      cooldownUntilMs: 61_000,
      cooldownRemainingMs: 60_000,
    })

    await expect(
      client.requestText("https://jimeng.example.test/mweb/v1/get_common_config", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toMatchObject({
      category: "risk_control",
      code: "RISK_CONTROL_COOLDOWN_ACTIVE",
      retryable: false,
    })
    expect(requestCount).toBe(1)

    nowMs = 61_001
    await expect(
      client.requestText("https://jimeng.example.test/mweb/v1/get_common_config", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toMatchObject({
      category: "risk_control",
      code: "SHARK_NOT_PASS",
    })
    expect(requestCount).toBe(2)
  })

  test("risk-control breaker respects configurable consecutive hit budget", async () => {
    let nowMs = 10_000
    const responses = [
      JSON.stringify({ ret: 1019, errmsg: "shark not pass" }),
      JSON.stringify({ ret: 0, errmsg: "success" }),
      JSON.stringify({ ret: 1019, errmsg: "shark not pass" }),
      JSON.stringify({ ret: 1019, errmsg: "shark not pass" }),
    ]
    const client = new JimengClient({
      fetch: async () => {
        const text = responses.shift()
        if (!text) throw new Error("No mocked response")
        return new Response(text, { status: 200 })
      },
      riskControlBreaker: {
        maxConsecutiveHits: 2,
        cooldownMs: 30_000,
        nowMs: () => nowMs,
      },
    })

    await expect(client.requestText("https://jimeng.example.test/risk-1", { method: "POST" }))
      .rejects.toMatchObject({ category: "risk_control", code: "SHARK_NOT_PASS" })
    expect(client.getRiskControlBreakerState()).toEqual({
      consecutiveHits: 1,
      cooldownUntilMs: 0,
      cooldownRemainingMs: 0,
    })

    await expect(client.requestText("https://jimeng.example.test/ok", { method: "POST" }))
      .resolves.toMatchObject({ status: 200 })
    expect(client.getRiskControlBreakerState().consecutiveHits).toBe(0)

    await expect(client.requestText("https://jimeng.example.test/risk-2", { method: "POST" }))
      .rejects.toMatchObject({ category: "risk_control", code: "SHARK_NOT_PASS" })
    await expect(client.requestText("https://jimeng.example.test/risk-3", { method: "POST" }))
      .rejects.toMatchObject({ category: "risk_control", code: "SHARK_NOT_PASS" })
    expect(client.getRiskControlBreakerState()).toEqual({
      consecutiveHits: 2,
      cooldownUntilMs: 40_000,
      cooldownRemainingMs: 30_000,
    })

    nowMs = 20_000
    await expect(client.requestText("https://jimeng.example.test/blocked", { method: "POST" }))
      .rejects.toMatchObject({ category: "risk_control", code: "RISK_CONTROL_COOLDOWN_ACTIVE" })
  })

  test("collectImageUrls deduplicates URL sources", () => {
    const urls = collectImageUrls({
      status: 45,
      item_list: [
        {
          common_attr: {
            cover_url: "https://img.example/cover.png",
            cover_url_map: {
              large: "https://img.example/cover.png",
              small: "https://img.example/small.png",
            },
          },
          image: {
            large_images: [
              { image_url: "https://img.example/small.png" },
              { image_url: "https://img.example/other.png" },
            ],
          },
        },
      ],
    })

    expect(urls).toEqual([
      "https://img.example/cover.png",
      "https://img.example/small.png",
      "https://img.example/other.png",
    ])
  })
})
