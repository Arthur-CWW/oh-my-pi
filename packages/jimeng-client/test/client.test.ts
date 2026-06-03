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
