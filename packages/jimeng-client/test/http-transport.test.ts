import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  createJimengHttpTransport,
  JimengError,
  parseJimengHttpTransportMode,
  readJimengHttpCassette,
  type JimengFetch,
} from "../src"

describe("Jimeng HTTP cassette transport", () => {
  test("records and replays requests without storing headers or raw bodies", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "jimeng-http-transport-"))
    try {
      const cassettePath = path.join(dir, "cassette.json")
      const liveRequests: Array<{ url: string; init?: RequestInit }> = []
      const liveFetch = mockFetch(["{\"ret\":0,\"data\":{\"ok\":true}}"], liveRequests)
      const record = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: liveFetch,
        nowIso: () => "2026-06-11T00:00:00.000Z",
      })

      const recorded = await record.fetch("https://jimeng.jianying.com/mweb/v1/example", {
        method: "POST",
        headers: { cookie: "sid=secret" },
        body: JSON.stringify({ prompt: "secret prompt" }),
      })

      expect(await responseText(recorded)).toBe("{\"ret\":0,\"data\":{\"ok\":true}}")
      expect(liveRequests).toHaveLength(1)

      const cassetteText = readFileSync(cassettePath, "utf8")
      expect(cassetteText).toContain("\"bodySha256\"")
      expect(cassetteText).not.toContain("sid=secret")
      expect(cassetteText).not.toContain("secret prompt")

      const replay = createJimengHttpTransport({
        mode: "replay",
        cassettePath,
        fetch: failIfLiveFetch,
      })

      const replayed = await replay.fetch("https://jimeng.jianying.com/mweb/v1/example", {
        method: "POST",
        body: JSON.stringify({ prompt: "secret prompt" }),
      })

      expect(await responseText(replayed)).toBe("{\"ret\":0,\"data\":{\"ok\":true}}")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("replay consumes duplicate matching entries while fixture mode is reusable", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "jimeng-http-transport-"))
    try {
      const cassettePath = path.join(dir, "cassette.json")
      const record = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: mockFetch(["one", "two"]),
        nowIso: () => "2026-06-11T00:00:00.000Z",
      })
      const request = {
        method: "POST",
        body: "same-body",
      }

      expect(await responseText(await record.fetch("https://jimeng.jianying.com/mweb/v1/example", request))).toBe("one")
      expect(await responseText(await record.fetch("https://jimeng.jianying.com/mweb/v1/example", request))).toBe("two")

      const replay = createJimengHttpTransport({ mode: "replay", cassettePath, fetch: failIfLiveFetch })
      expect(await responseText(await replay.fetch("https://jimeng.jianying.com/mweb/v1/example", request))).toBe("one")
      expect(await responseText(await replay.fetch("https://jimeng.jianying.com/mweb/v1/example", request))).toBe("two")
      await expect(replay.fetch("https://jimeng.jianying.com/mweb/v1/example", request)).rejects.toMatchObject({
        code: "JIMENG_CASSETTE_MISS",
      })

      const fixture = createJimengHttpTransport({ mode: "fixture", cassettePath, fetch: failIfLiveFetch })
      expect(await responseText(await fixture.fetch("https://jimeng.jianying.com/mweb/v1/example", request))).toBe("one")
      expect(await responseText(await fixture.fetch("https://jimeng.jianying.com/mweb/v1/example", request))).toBe("one")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("validates cassette shape at the boundary", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "jimeng-http-transport-"))
    try {
      const cassettePath = path.join(dir, "bad.json")
      writeFileSync(cassettePath, JSON.stringify({ version: 1, entries: [{}] }))

      expect(() => readJimengHttpCassette(cassettePath)).toThrow(JimengError)
      expect(() => readJimengHttpCassette(cassettePath)).toThrow(/cassette is invalid/)
      expect(parseJimengHttpTransportMode(undefined)).toBe("live")
      expect(parseJimengHttpTransportMode("fixture")).toBe("fixture")
      expect(parseJimengHttpTransportMode("cdp-ui")).toBe("cdp-ui")
      expect(parseJimengHttpTransportMode("cdp-fetch")).toBe("cdp-fetch")
      expect(() => parseJimengHttpTransportMode("random")).toThrow(JimengError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("cdp-fetch mode requires injected browser fetch and reuses it like live transport", async () => {
    expect(() => createJimengHttpTransport({ mode: "cdp-fetch" })).toThrow(JimengError)

    const requests: Array<{ url: string; init?: RequestInit }> = []
    const transport = createJimengHttpTransport({
      mode: "cdp-fetch",
      fetch: mockFetch(["browser-response"], requests),
    })

    expect(transport.info).toEqual({ mode: "cdp-fetch", cassettePath: null })
    expect(await responseText(await transport.fetch("https://jimeng.jianying.com/mweb/v1/example", {
      method: "POST",
      body: JSON.stringify({ prompt: "browser" }),
    }))).toBe("browser-response")
    expect(requests).toEqual([{
      url: "https://jimeng.jianying.com/mweb/v1/example",
      init: {
        method: "POST",
        body: JSON.stringify({ prompt: "browser" }),
      },
    }])
  })
})

function mockFetch(bodies: string[], requests: Array<{ url: string; init?: RequestInit }> = []): JimengFetch {
  return async (url, init) => {
    requests.push({ url, init })
    const body = bodies[Math.min(requests.length - 1, bodies.length - 1)] ?? ""
    const bytes = new TextEncoder().encode(body)
    return {
      ok: true,
      status: 200,
      text: async () => body,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }
  }
}

const failIfLiveFetch: JimengFetch = async () => {
  throw new Error("unexpected live fetch")
}

async function responseText(response: Awaited<ReturnType<JimengFetch>>): Promise<string> {
  return new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()))
}
