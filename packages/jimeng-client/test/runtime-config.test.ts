import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengRuntimeConfigRequest,
  createJimengHttpTransport,
  fetchJimengRuntimeConfig,
  JimengClient,
  JimengError,
  parseJimengRuntimeConfigEndpoints,
  readJimengHttpCassette,
  summarizeJimengRuntimeConfig,
  type JimengFetch,
  type JimengSessionBundle,
  type JsonObject,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("Jimeng runtime config helpers", () => {
  test("parses endpoint flags and builds empty wire requests", () => {
    expect(parseJimengRuntimeConfigEndpoints(undefined)).toEqual([
      "experiment-params",
      "home-header-banner",
      "help-desk-entrance",
      "asr-token",
      "asr-hotwords",
    ])
    expect(parseJimengRuntimeConfigEndpoints("asr-token,experiment-params,asr-token")).toEqual(["asr-token", "experiment-params"])
    expect(() => parseJimengRuntimeConfigEndpoints("notice-list")).toThrow("runtime-config --endpoints must be")

    expect(buildJimengRuntimeConfigRequest("experiment-params")).toEqual({})
    expect(buildJimengRuntimeConfigRequest("home-header-banner")).toEqual({})
    expect(buildJimengRuntimeConfigRequest("help-desk-entrance")).toEqual({})
    expect(buildJimengRuntimeConfigRequest("asr-token")).toEqual({})
    expect(buildJimengRuntimeConfigRequest("asr-hotwords")).toEqual({})
  })

  test("fetches and summarizes runtime config without leaking token or URL values", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify(experimentParamsBody()),
        JSON.stringify(homeHeaderBannerBody()),
        JSON.stringify(helpDeskEntranceBody()),
        JSON.stringify(asrTokenBody()),
        JSON.stringify(asrHotwordsBody()),
      ], requests),
    })

    const result = await fetchJimengRuntimeConfig({ client, session })
    const summary = summarizeJimengRuntimeConfig(result)

    expect(requests.map((request) => request.url)).toEqual([
      expect.stringContaining("/mweb/v1/get_experiment_params"),
      expect.stringContaining("/mweb/v1/get_home_header_banner_config"),
      expect.stringContaining("/mweb/v1/get_help_desk_entrance"),
      expect.stringContaining("/mweb/v1/speech/asr_token"),
      expect.stringContaining("/mweb/v1/speech/asr_hotwords"),
    ])
    expect(requests.map((request) => JSON.parse(String(request.init?.body)))).toEqual([{}, {}, {}, {}, {}])
    expect(summary).toMatchObject({
      endpoints: ["experiment-params", "home-header-banner", "help-desk-entrance", "asr-token", "asr-hotwords"],
      result_count: 5,
      results: [
        {
          endpoint_id: "experiment-params",
          params_key_count: 2,
          params_keys: ["alpha", "beta"],
        },
        {
          endpoint_id: "home-header-banner",
          item_count: 2,
          banner_keys: ["canvas", "octo"],
          item_codes: ["banner-a"],
        },
        {
          endpoint_id: "help-desk-entrance",
          url: { length: 45 },
        },
        {
          endpoint_id: "asr-token",
          appkey: { length: 16 },
          expire_at: 1790000000,
          token: { length: 25 },
          token_present: true,
          ws_url: { length: 35 },
        },
        {
          endpoint_id: "asr-hotwords",
          hot_word_info_keys: ["today_word"],
          today_word_count: 2,
        },
      ],
    })

    const serialized = JSON.stringify(summary)
    expect(serialized).not.toContain("very-secret-runtime-token")
    expect(serialized).not.toContain("wss://speech.example.invalid")
    expect(serialized).not.toContain("https://help.example.invalid")
  })

  test("can fetch through recorded and replayed HTTP transport cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-runtime-config-cassette-"))
    try {
      const cassettePath = path.join(dir, "runtime-config.json")
      const requests: Array<{ url: string; init?: RequestInit }> = []
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: mockFetchSequence([JSON.stringify(asrTokenBody())], requests),
        nowIso: () => "2026-06-11T00:00:00.000Z",
      })

      const recorded = await fetchJimengRuntimeConfig({
        fetch: recordTransport.fetch,
        session,
        query: { endpoints: ["asr-token"] },
      })

      expect(recorded.results[0]?.endpointId).toBe("asr-token")
      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(1)
      expect(requests).toHaveLength(1)

      const replayTransport = createJimengHttpTransport({
        mode: "replay",
        cassettePath,
      })
      const replayed = await fetchJimengRuntimeConfig({
        fetch: replayTransport.fetch,
        session,
        query: { endpoints: ["asr-token"] },
      })

      const summary = summarizeJimengRuntimeConfig(replayed)
      expect(summary).toMatchObject({
        result_count: 1,
        results: [
          {
            endpoint_id: "asr-token",
            token_present: true,
            ws_url: { length: 35 },
          },
        ],
      })
      expect(JSON.stringify(summary)).not.toContain("very-secret-runtime-token")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("rejects provider errors and required contract drift", async () => {
    const errorClient = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify({ ret: "1000", errmsg: "invalid parameter", data: {} }),
      ], []),
    })
    await expect(fetchJimengRuntimeConfig({
      client: errorClient,
      session,
      query: { endpoints: ["asr-token"] },
    })).rejects.toBeInstanceOf(JimengError)

    const driftClient = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify({ ret: "0", errmsg: "success", data: { appkey: "runtime-app-key" } }),
      ], []),
    })
    await expect(fetchJimengRuntimeConfig({
      client: driftClient,
      session,
      query: { endpoints: ["asr-token"] },
    })).rejects.toThrow("required fields")
  })
})

function experimentParamsBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      params: {
        alpha: true,
        beta: 1,
      },
    },
  }
}

function homeHeaderBannerBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      items: [
        { banner_key: "canvas", item_code: "banner-a", signed_url: "https://signed.example.invalid/a" },
        { banner_key: "octo", item_name: "Octo" },
      ],
      panel_key: "pc",
      source: "vimo",
    },
  }
}

function helpDeskEntranceBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      url: "https://help.example.invalid/ticket?token=abc",
    },
  }
}

function asrTokenBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      appkey: "1234567890abcdef",
      expire_at: 1790000000,
      token: "very-secret-runtime-token",
      ws_url: "wss://speech.example.invalid/socket",
    },
  }
}

function asrHotwordsBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      hot_word_info: {
        today_word: ["UGC", "Jimeng"],
      },
    },
  }
}

function mockFetchSequence(bodies: string[], requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  let index = 0
  return async (url, init) => {
    requests.push({ url, init })
    const body = bodies[index] ?? bodies.at(-1) ?? "{}"
    index += 1
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } })
  }
}
