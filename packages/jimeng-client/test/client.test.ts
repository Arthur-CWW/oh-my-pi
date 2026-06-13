import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  collectImageUrls,
  createJimengHttpTransport,
  downloadArtifactsEffect,
  JimengClient,
  JimengError,
  pollUntilTerminalEffect,
  runPreparedEffect,
  submitPreparedEffect,
  type JimengFetch,
  type PreparedJimengRun,
} from "../src"

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

  test("collectImageUrls prefers the highest-resolution generated image over preview sizes", () => {
    const urls = collectImageUrls({
      status: 45,
      item_list: [
        {
          common_attr: {
            cover_url: "https://img.example/cover.png",
            cover_url_map: {
              "240": "https://img.example/240.png",
              "1080": "https://img.example/1080.png",
            },
          },
          image: {
            large_images: [
              { image_url: "https://img.example/1024.png", width: 1024, height: 1024 },
              { image_url: "https://img.example/2048.png", width: 2048, height: 2048 },
            ],
          },
        },
      ],
    })

    expect(urls).toEqual([
      "https://img.example/2048.png",
    ])
  })

  test("Effect helpers call injected fetch path and return submit poll and artifacts", async () => {
    const calls: Array<{ url: string; method: string }> = []
    const prepared: PreparedJimengRun = {
      op: "video",
      submitKind: "workbench_json",
      pollKind: "history_by_submit_id",
      submitId: "fallback-submit-id",
      prompt: "test prompt",
      submitUrl: "https://jimeng.example.test/mweb/v1/aigc_draft/generate",
      pollUrl: "https://jimeng.example.test/mweb/v1/get_history_by_ids",
      submitHeaders: { "content-type": "application/json" },
      pollHeaders: { "content-type": "application/json" },
      submitBody: { submit_id: "fallback-submit-id" },
      terminalStatus: 50,
    }
    const client = new JimengClient({
      fetch: async (url, init) => {
        calls.push({ url, method: init?.method ?? "GET" })
        if (url === prepared.submitUrl) {
          return new Response(JSON.stringify({
            ret: 0,
            data: { aigc_data: { submit_id: "effect-submit-id", history_record_id: "effect-history-id" } },
          }), { status: 200 })
        }
        if (url === prepared.pollUrl) {
          return new Response(JSON.stringify({
            ret: 0,
            data: {
              "effect-submit-id": {
                status: 50,
                item_list: [{ video: { play_url: "https://cdn.example.test/effect.mp4" } }],
              },
            },
          }), { status: 200 })
        }
        if (url === "https://cdn.example.test/effect.mp4") {
          return new Response("video-bytes", { status: 200 })
        }
        throw new Error(`Unexpected URL ${url}`)
      },
    })

    const submit = await Effect.runPromise(submitPreparedEffect(client, prepared))
    const poll = await Effect.runPromise(pollUntilTerminalEffect(client, {
      pollUrl: prepared.pollUrl,
      pollHeaders: prepared.pollHeaders,
      submitId: submit.submitId,
      terminalStatus: prepared.terminalStatus,
      pollKind: prepared.pollKind,
      pollIntervalMs: 0,
      maxPolls: 1,
    }))
    const artifacts = await Effect.runPromise(downloadArtifactsEffect(client, prepared.op, poll.record))

    expect(submit).toMatchObject({ submitId: "effect-submit-id", historyId: "effect-history-id" })
    expect(poll.record.item_list?.[0]?.video?.play_url).toBe("https://cdn.example.test/effect.mp4")
    expect(artifacts).toEqual([{
      kind: "video",
      url: "https://cdn.example.test/effect.mp4",
      bytes: new Uint8Array(await new Response("video-bytes").arrayBuffer()),
    }])
    expect(calls).toEqual([
      { url: prepared.submitUrl, method: "POST" },
      { url: prepared.pollUrl, method: "POST" },
      { url: "https://cdn.example.test/effect.mp4", method: "GET" },
    ])
  })

  test("runPreparedEffect can route submit through an injected cdp-fetch transport", async () => {
    const prepared: PreparedJimengRun = {
      op: "video",
      submitKind: "workbench_json",
      pollKind: "history_by_submit_id",
      submitId: "video-fallback",
      prompt: "browser submit prompt",
      submitUrl: "https://jimeng.example.test/mweb/v1/aigc_draft/generate",
      pollUrl: "https://jimeng.example.test/mweb/v1/get_history_by_ids",
      submitHeaders: { "content-type": "application/json" },
      pollHeaders: { "content-type": "application/json" },
      submitBody: { submit_id: "video-fallback" },
      terminalStatus: 50,
    }
    const browserCalls: Array<{ url: string; method: string }> = []
    const nodeCalls: Array<{ url: string; method: string }> = []
    const submitTransport = createJimengHttpTransport({
      mode: "cdp-fetch",
      fetch: async (url, init) => {
        browserCalls.push({ url, method: init?.method ?? "GET" })
        return new Response(JSON.stringify({
          ret: 0,
          data: { aigc_data: { submit_id: "cdp-submit-id", history_record_id: "cdp-history-id" } },
        }), { status: 200 })
      },
    })
    const client = new JimengClient({
      fetch: async (url, init) => {
        if (url === prepared.submitUrl) return submitTransport.fetch(url, init)
        nodeCalls.push({ url, method: init?.method ?? "GET" })
        if (url === prepared.pollUrl) {
          return new Response(JSON.stringify({
            ret: 0,
            data: {
              "cdp-submit-id": {
                status: 50,
                item_list: [{ video: { play_url: "https://cdn.example.test/cdp.mp4" } }],
              },
            },
          }), { status: 200 })
        }
        if (url === "https://cdn.example.test/cdp.mp4") {
          return new Response("cdp-video-bytes", { status: 200 })
        }
        throw new Error(`Unexpected URL ${url}`)
      },
    })

    const result = await Effect.runPromise(runPreparedEffect(client, {
      prepared,
      pollIntervalMs: 0,
      maxPolls: 1,
    }))

    expect(result.submit).toMatchObject({ submitId: "cdp-submit-id", historyId: "cdp-history-id" })
    expect(result.artifacts).toEqual([{
      kind: "video",
      url: "https://cdn.example.test/cdp.mp4",
      bytes: new Uint8Array(await new Response("cdp-video-bytes").arrayBuffer()),
    }])
    expect(browserCalls).toEqual([{ url: prepared.submitUrl, method: "POST" }])
    expect(nodeCalls).toEqual([
      { url: prepared.pollUrl, method: "POST" },
      { url: "https://cdn.example.test/cdp.mp4", method: "GET" },
    ])
  })

  test("runPreparedEffect returns end-to-end submit poll and artifact result", async () => {
    const prepared: PreparedJimengRun = {
      op: "image",
      submitKind: "conversation_sse",
      pollKind: "asset_list_first_image",
      submitId: "image-fallback",
      prompt: "test prompt",
      submitUrl: "https://jimeng.example.test/mweb/v1/creation_agent/v2/conversation",
      pollUrl: "https://jimeng.example.test/mweb/v1/get_asset_list",
      submitHeaders: { "content-type": "application/json" },
      pollHeaders: { "content-type": "application/json" },
      submitBody: { messages: [] },
      pollBody: { count: 20 },
      terminalStatus: 50,
    }
    const calls: string[] = []
    const client = new JimengClient({
      fetch: async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${url}`)
        if (url === prepared.submitUrl) {
          return new Response([
            "event: message",
            'data: {"event_data":{"submit_info":{"code":0,"msg":"success"},"aigc_data":{"submit_id":"123e4567-e89b-12d3-a456-426614174000"}}}',
            "",
          ].join("\n"), { status: 200 })
        }
        if (url === prepared.pollUrl) {
          return new Response(JSON.stringify({
            ret: "0",
            data: {
              asset_list: [{
                image: {
                  submit_id: "123e4567-e89b-12d3-a456-426614174000",
                  status: 50,
                  item_list: [{ image: { large_images: [{ image_url: "https://cdn.example.test/image.png" }] } }],
                },
              }],
            },
          }), { status: 200 })
        }
        if (url === "https://cdn.example.test/image.png") {
          return new Response("image-bytes", { status: 200 })
        }
        throw new Error(`Unexpected URL ${url}`)
      },
    })

    const result = await Effect.runPromise(runPreparedEffect(client, {
      prepared,
      pollIntervalMs: 0,
      maxPolls: 1,
    }))

    expect(result.submit.submitId).toBe("123e4567-e89b-12d3-a456-426614174000")
    expect(result.poll.record.status).toBe(50)
    expect(result.artifacts).toEqual([{
      kind: "image",
      url: "https://cdn.example.test/image.png",
      bytes: new Uint8Array(await new Response("image-bytes").arrayBuffer()),
    }])
    expect(calls).toEqual([
      `POST ${prepared.submitUrl}`,
      `POST ${prepared.pollUrl}`,
      "GET https://cdn.example.test/image.png",
    ])
  })
})
