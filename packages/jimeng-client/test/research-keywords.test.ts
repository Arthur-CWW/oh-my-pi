import { describe, expect, test } from "bun:test"
import {
  buildJimengResearchGuessRequest,
  buildJimengResearchSuggestRequest,
  fetchJimengResearchKeywords,
  JimengClient,
  JimengError,
  parseJimengResearchKeywordChannels,
  parseJimengResearchKeywordEndpoints,
  summarizeJimengResearchKeywords,
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

describe("Jimeng research keyword helpers", () => {
  test("parses endpoint/channel flags and builds frontend wire requests", () => {
    expect(parseJimengResearchKeywordEndpoints(undefined)).toEqual(["suggest", "guess"])
    expect(parseJimengResearchKeywordEndpoints("guess,suggest,guess")).toEqual(["guess", "suggest"])
    expect(parseJimengResearchKeywordChannels(undefined)).toEqual(["inspiration", "short-film", "asset"])
    expect(parseJimengResearchKeywordChannels("short-film,inspiration")).toEqual(["short-film", "inspiration"])
    expect(() => parseJimengResearchKeywordEndpoints("search")).toThrow("must be suggest, guess, or all")
    expect(() => parseJimengResearchKeywordChannels("generate")).toThrow("must be inspiration, short-film, asset, or all")

    expect(buildJimengResearchSuggestRequest("short-film", " 韩系美妆 ")).toEqual({
      search_channel: "short_film",
      keyword: "韩系美妆",
    })
    expect(buildJimengResearchGuessRequest("asset", 5)).toEqual({
      search_channel: "asset",
      count: 5,
    })
  })

  test("fetches suggestions and guesses sequentially while skipping unsupported asset suggestions", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify(suggestBody()),
        JSON.stringify(guessBody()),
        JSON.stringify(emptyGuessBody()),
      ], requests),
    })

    const result = await fetchJimengResearchKeywords({
      client,
      session,
      query: {
        endpoints: ["suggest", "guess"],
        channels: ["inspiration", "asset"],
        keyword: "韩系美妆",
        count: 5,
      },
    })
    const summary = summarizeJimengResearchKeywords(result)

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/mweb/search/v1/sug",
      "/mweb/search/v1/guess",
      "/mweb/search/v1/guess",
    ])
    expect(requests.map((request) => JSON.parse(String(request.init?.body)))).toEqual([
      { search_channel: "inspiration", keyword: "韩系美妆" },
      { search_channel: "inspiration", count: 5 },
      { search_channel: "asset", count: 5 },
    ])
    expect(result.skipped).toEqual([
      {
        endpoint: "suggest",
        channel: "asset",
        reason: expect.stringContaining("ret=1000"),
      },
    ])
    expect(summary).toMatchObject({
      result_count: 3,
      results: [
        {
          endpoint_id: "suggest",
          channel: "inspiration",
          item_count: 2,
          items: [
            {
              gid: null,
              gid_was_unsafe_number: true,
              word: "韩系美妆",
            },
            {
              gid: "42",
              gid_was_unsafe_number: false,
              word: "韩系淡颜",
              display_type: "query",
            },
          ],
        },
        {
          endpoint_id: "guess",
          channel: "inspiration",
          item_count: 1,
        },
        {
          endpoint_id: "guess",
          channel: "asset",
          item_count: 0,
        },
      ],
    })
  })

  test("requires keyword only when suggestions are selected", async () => {
    const client = new JimengClient({
      fetch: mockFetchSequence([JSON.stringify(guessBody())], []),
    })

    const guesses = await fetchJimengResearchKeywords({
      client,
      session,
      query: { endpoints: ["guess"], channels: ["inspiration"], count: 10 },
    })
    expect(guesses.results).toHaveLength(1)

    await expect(fetchJimengResearchKeywords({
      client,
      session,
      query: { endpoints: ["suggest"], channels: ["inspiration"] },
    })).rejects.toBeInstanceOf(JimengError)
  })

  test("rejects missing relied-on provider list paths while tolerating additive fields", async () => {
    const validClient = new JimengClient({
      fetch: mockFetchSequence([JSON.stringify(suggestBody())], []),
    })
    const valid = await fetchJimengResearchKeywords({
      client: validClient,
      session,
      query: { endpoints: ["suggest"], channels: ["inspiration"], keyword: "韩系美妆" },
    })
    expect(valid.results[0]?.items).toHaveLength(2)

    const invalidClient = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify({ ret: "0", errmsg: "success", data: { extra_new_field: true } }),
      ], []),
    })
    await expect(fetchJimengResearchKeywords({
      client: invalidClient,
      session,
      query: { endpoints: ["suggest"], channels: ["inspiration"], keyword: "韩系美妆" },
    })).rejects.toBeInstanceOf(JimengError)
  })

  test("rejects provider nonzero ret responses", async () => {
    const client = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify({
          ret: "1000",
          errmsg: "invalid parameter",
          data: { guess_list: [] },
        }),
      ], []),
    })

    await expect(fetchJimengResearchKeywords({
      client,
      session,
      query: { endpoints: ["guess"], channels: ["inspiration"] },
    })).rejects.toBeInstanceOf(JimengError)
  })
})

function suggestBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    logid: "test-log-id",
    data: {
      suggest_list: [
        {
          gid: 5893791023034227000,
          word: "韩系美妆 ",
          additive_provider_field: true,
        },
        {
          gid: 42,
          word: "韩系淡颜",
          display_info: {
            display_type: "query",
            additive_provider_field: "ok",
          },
        },
      ],
      additive_provider_field: true,
    },
    additive_provider_field: true,
  }
}

function guessBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      guess_list: [
        {
          gid: 0,
          word: "包装",
        },
      ],
    },
  }
}

function emptyGuessBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      guess_list: [],
    },
  }
}

function mockFetchSequence(bodies: string[], requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  let index = 0
  return async (url, init) => {
    requests.push({ url, init })
    const body = bodies[index]
    index += 1
    if (body === undefined) throw new Error(`unexpected request ${url}`)
    return {
      ok: true,
      status: 200,
      async text() {
        return body
      },
      async arrayBuffer() {
        return new TextEncoder().encode(body).buffer
      },
    }
  }
}
