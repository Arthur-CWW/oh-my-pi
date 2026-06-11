import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  createJimengHttpTransport,
  JimengClient,
  readJimengHttpCassette,
  runJimengRateProbe,
  summarizeJimengRateProbe,
  type JimengFetch,
  type JimengSessionBundle,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("Jimeng rate probe", () => {
  test("runs a bounded concurrent probe and summarizes rate metrics", async () => {
    let inFlight = 0
    let maxInFlight = 0
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: async (url, init) => {
        requests.push({ url, init })
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 10))
        inFlight -= 1
        const body = JSON.stringify({ ret: "0", errmsg: "success", data: { ok: true } })
        return response(200, body)
      },
    })

    const result = await runJimengRateProbe({
      client,
      session,
      probe: {
        endpoint: "/mweb/v1/get_common_config",
        variants: [{ name: "config", body: { need_cache: true } }],
        requestCount: 6,
        concurrency: 3,
      },
    })

    expect(requests).toHaveLength(6)
    expect(maxInFlight).toBeLessThanOrEqual(3)
    expect(result.stopped).toBe(false)
    expect(result.attempts.map((attempt) => attempt.ret)).toEqual(["0", "0", "0", "0", "0", "0"])

    const summary = summarizeJimengRateProbe(result)
    expect(summary).toMatchObject({
      completed_count: 6,
      concurrency: 3,
      stopped: false,
      http_status_counts: { "200": 6 },
      ret_counts: { "0": 6 },
    })
  })

  test("records and replays bounded probes through HTTP cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-rate-probe-cassette-"))
    const cassettePath = path.join(dir, "rate-probe.json")
    const requests: Array<{ url: string; init?: RequestInit }> = []
    try {
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        nowIso: () => "2026-06-11T00:00:00.000Z",
        fetch: mockFetch([
          { status: 200, body: JSON.stringify({ ret: "0", errmsg: "success", data: { index: 1 } }) },
          { status: 200, body: JSON.stringify({ ret: "0", errmsg: "success", data: { index: 2 } }) },
        ], requests),
      })

      await runJimengRateProbe({
        fetch: recordTransport.fetch,
        session,
        probe: {
          endpoint: "/mweb/v1/get_common_config",
          variants: [{ name: "config", body: { need_cache: true } }],
          requestCount: 2,
          concurrency: 1,
        },
      })

      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(2)
      const replayTransport = createJimengHttpTransport({ mode: "replay", cassettePath })
      const replayed = await runJimengRateProbe({
        fetch: replayTransport.fetch,
        session,
        probe: {
          endpoint: "/mweb/v1/get_common_config",
          variants: [{ name: "config", body: { need_cache: true } }],
          requestCount: 2,
          concurrency: 1,
        },
      })

      expect(replayed.attempts.map((attempt) => attempt.ret)).toEqual(["0", "0"])
      expect(replayed.stopped).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("stops on rate-limit responses", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch([
        { status: 429, body: JSON.stringify({ ret: "429", errmsg: "too many requests" }) },
        { status: 200, body: JSON.stringify({ ret: "0", errmsg: "success" }) },
      ], requests),
    })

    const result = await runJimengRateProbe({
      client,
      session,
      probe: {
        endpoint: "/mweb/v1/get_common_config",
        variants: [{ name: "config", body: { need_cache: true } }],
        requestCount: 10,
        concurrency: 1,
      },
    })

    expect(requests).toHaveLength(1)
    expect(result.stopped).toBe(true)
    expect(result.stopReason).toBe("http_429_rate_limited")
  })

  test("rejects likely mutating endpoints unless explicitly opted in", async () => {
    const client = new JimengClient({ fetch: mockFetch([], []) })
    await expect(runJimengRateProbe({
      client,
      session,
      probe: {
        endpoint: "/mweb/v1/aigc_draft/generate",
        variants: [{ name: "submit", body: {} }],
        requestCount: 1,
        concurrency: 1,
      },
    })).rejects.toThrow("rate-probe rejects likely mutating/generating endpoints")
  })
})

function mockFetch(
  bodies: Array<{ status: number; body: string }>,
  requests: Array<{ url: string; init?: RequestInit }>,
): JimengFetch {
  return async (url: string, init?: RequestInit) => {
    requests.push({ url, init })
    const item = bodies[Math.min(requests.length - 1, bodies.length - 1)] ?? { status: 200, body: "{}" }
    return response(item.status, item.body)
  }
}

function response(status: number, body: string): ReturnType<JimengFetch> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  })
}
