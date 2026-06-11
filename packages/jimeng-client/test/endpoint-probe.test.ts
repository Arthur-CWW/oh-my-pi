import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengEndpointProbeUrl,
  createJimengHttpTransport,
  JimengClient,
  parseJimengEndpointProbeVariants,
  readJimengHttpCassette,
  runJimengEndpointProbe,
  summarizeJimengEndpointProbe,
  type JimengFetch,
  type JimengSessionBundle,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("Jimeng endpoint probe", () => {
  test("builds default Jimeng endpoint URLs and parses variants", () => {
    expect(buildJimengEndpointProbeUrl({ endpoint: "/mweb/v1/get_video_by_vid" })).toContain("aid=513695")
    expect(parseJimengEndpointProbeVariants(JSON.stringify([
      { name: "vids", body: { vids: ["v1"] } },
      { body: { vid: "v1" } },
    ]))).toEqual([
      { name: "vids", body: { vids: ["v1"] } },
      { name: "variant-2", body: { vid: "v1" } },
    ])
  })

  test("probes variants and summarizes shapes without signed URLs", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const bodies = [
      JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          image_url: "https://signed.example.invalid/image.png?x-signature=secret",
          width: 1024,
        },
      }),
      JSON.stringify({ ret: "1000", errmsg: "invalid parameter" }),
    ]
    const client = new JimengClient({ fetch: mockFetch(bodies, requests) })

    const result = await runJimengEndpointProbe({
      client,
      session,
      probe: {
        endpoint: "/mweb/v1/get_image_by_uri",
        variants: [
          { name: "ok", body: { uris: ["tos-cn-i-demo/image.png"] } },
          { name: "bad", body: { uri: "tos-cn-i-demo/image.png" } },
        ],
      },
    })

    expect(requests).toHaveLength(2)
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ uris: ["tos-cn-i-demo/image.png"] })
    expect(result.results.map((item) => `${item.name}:${item.ret}`)).toEqual(["ok:0", "bad:1000"])
    expect(result.results[0]?.responseTextHasUrlLikeTokens).toBe(true)

    const summary = summarizeJimengEndpointProbe(result)
    const summaryText = JSON.stringify(summary)
    expect(summaryText).toContain("url_like")
    expect(summaryText).not.toContain("signed.example.invalid")
    expect(summaryText).not.toContain("x-signature")
  })

  test("records and replays endpoint probe variants through HTTP cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-endpoint-probe-cassette-"))
    const cassettePath = path.join(dir, "endpoint-probe.json")
    const requests: Array<{ url: string; init?: RequestInit }> = []
    try {
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        nowIso: () => "2026-06-11T00:00:00.000Z",
        fetch: mockFetch([
          JSON.stringify({ ret: "0", errmsg: "success", data: { width: 1024 } }),
          JSON.stringify({ ret: "1000", errmsg: "invalid parameter" }),
        ], requests),
      })

      await runJimengEndpointProbe({
        fetch: recordTransport.fetch,
        session,
        probe: {
          endpoint: "/mweb/v1/get_image_by_uri",
          variants: [
            { name: "ok", body: { uris: ["tos-cn-i-demo/image.png"] } },
            { name: "bad", body: { uri: "tos-cn-i-demo/image.png" } },
          ],
        },
      })

      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(2)
      const replayTransport = createJimengHttpTransport({ mode: "replay", cassettePath })
      const replayed = await runJimengEndpointProbe({
        fetch: replayTransport.fetch,
        session,
        probe: {
          endpoint: "/mweb/v1/get_image_by_uri",
          variants: [
            { name: "ok", body: { uris: ["tos-cn-i-demo/image.png"] } },
            { name: "bad", body: { uri: "tos-cn-i-demo/image.png" } },
          ],
        },
      })

      expect(replayed.results.map((item) => `${item.name}:${item.ret}`)).toEqual(["ok:0", "bad:1000"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function mockFetch(bodies: string[], requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url: string, init?: RequestInit) => {
    requests.push({ url, init })
    const body = bodies[Math.min(requests.length - 1, bodies.length - 1)] ?? "{}"
    return {
      ok: true,
      status: 200,
      text: async () => body,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    }
  }
}
