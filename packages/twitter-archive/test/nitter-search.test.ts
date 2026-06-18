import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildNitterSearchUrl,
  buildTwitterAdvancedSearchQuery,
  captureNitterSearchToSqlite,
  fetchNitterSearch,
  initTwitterArchiveSqliteStore,
  NITTER_DEFAULT_MAX_PAGES,
  NITTER_HARD_MAX_PAGES,
  type NitterFetchFunction,
} from "../src"
import { readFixture } from "./fixtures/read-fixture"

const capturedAt = "2026-06-18T00:00:00.000Z"
const nitterSearchPage = await readFixture("nitter-search-result-with-cursor.html")

describe("Twitter advanced search query building", () => {
  test("builds the reference from/min_faves/date query", () => {
    expect(
      buildTwitterAdvancedSearchQuery({
        from: "NASA",
        minFaves: 10,
        since: "2021-12-31",
        until: "2022-01-02",
      }),
    ).toBe("from:NASA min_faves:10 since:2021-12-31 until:2022-01-02")
  })

  test("normalizes @ usernames and keeps UTC timestamp date operators", () => {
    expect(
      buildTwitterAdvancedSearchQuery({
        rawText: "moon landing",
        from: "@NASA",
        since: "2021-12-31_20:00:00_UTC",
        until: "2022-01-02_00:00:00_UTC",
      }),
    ).toBe("moon landing from:NASA since:2021-12-31_20:00:00_UTC until:2022-01-02_00:00:00_UTC")
  })

  test("builds unix second time operators", () => {
    expect(
      buildTwitterAdvancedSearchQuery({
        from: "NASA",
        sinceTime: 1640908800,
        untilTime: "1641081600",
      }),
    ).toBe("from:NASA since_time:1640908800 until_time:1641081600")
  })

  test("builds within_time duration operators", () => {
    expect(buildTwitterAdvancedSearchQuery({ rawText: "JWST", withinTime: "2d" })).toBe("JWST within_time:2d")
    expect(buildTwitterAdvancedSearchQuery({ rawText: "JWST", withinTime: "3h" })).toBe("JWST within_time:3h")
    expect(buildTwitterAdvancedSearchQuery({ rawText: "JWST", withinTime: "5m" })).toBe("JWST within_time:5m")
    expect(buildTwitterAdvancedSearchQuery({ rawText: "JWST", withinTime: "30s" })).toBe("JWST within_time:30s")
  })

  test("rejects invalid advanced operator values", () => {
    expect(() => buildTwitterAdvancedSearchQuery({ from: "@not-a-handle" })).toThrow("from must be")
    expect(() => buildTwitterAdvancedSearchQuery({ minFaves: "1.5" })).toThrow("minFaves must be")
    expect(() => buildTwitterAdvancedSearchQuery({ since: "2021-02-29" })).toThrow("since must contain")
    expect(() => buildTwitterAdvancedSearchQuery({ withinTime: "2w" })).toThrow("withinTime must use")
  })
})

describe("Nitter search fetching", () => {
  test("builds public Nitter tweet search URLs", () => {
    const url = new URL(
      buildNitterSearchUrl(
        "https://nitter.example/",
        { from: "@NASA", minFaves: 10, since: "2021-12-31", until: "2022-01-02" },
        "SCROLL==",
      ),
    )

    expect(url.origin).toBe("https://nitter.example")
    expect(url.pathname).toBe("/search")
    expect(url.searchParams.get("f")).toBe("tweets")
    expect(url.searchParams.get("q")).toBe("from:NASA min_faves:10 since:2021-12-31 until:2022-01-02")
    expect(url.searchParams.get("cursor")).toBe("SCROLL==")
  })

  test("defaults to one page and clamps requested searches to the hard cap", async () => {
    const fetchedUrls: string[] = []
    const fetchFn: NitterFetchFunction = async (url) => {
      fetchedUrls.push(url)
      return {
        ok: true,
        status: 200,
        async text() {
          return nitterSearchPage
        },
      }
    }

    const defaultResult = await fetchNitterSearch({ from: "NASA", minFaves: 10 }, {
      baseUrl: "https://nitter.example",
      fetchFn,
      capturedAt,
    })
    expect(defaultResult.requestedMaxPages).toBe(NITTER_DEFAULT_MAX_PAGES)
    expect(defaultResult.maxPages).toBe(1)
    expect(defaultResult.stopReason).toBe("max-pages")

    fetchedUrls.length = 0
    const clampedResult = await fetchNitterSearch("from:NASA", {
      baseUrl: "https://nitter.example",
      fetchFn,
      maxPages: 100,
      capturedAt,
    })
    expect(clampedResult.maxPages).toBe(NITTER_HARD_MAX_PAGES)
    expect(fetchedUrls).toHaveLength(NITTER_HARD_MAX_PAGES)
    expect(new URL(fetchedUrls[1]).searchParams.get("cursor")).toBe("SCROLL==")
  })

  test("captures raw search pages and upserts parsed timeline entities into sqlite", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-nitter-search-"))
    const dbPath = join(tempDir, "archive.sqlite")
    const store = initTwitterArchiveSqliteStore(dbPath)
    const fetchedUrls: string[] = []
    try {
      const fetchFn: NitterFetchFunction = async (url) => {
        fetchedUrls.push(url)
        return {
          ok: true,
          status: 200,
          headers: {
            get(name: string) {
              return name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null
            },
          },
          async text() {
            return nitterSearchPage
          },
        }
      }

      const result = await captureNitterSearchToSqlite({ from: "pleometric", minFaves: 10 }, {
        baseUrl: "https://nitter.example",
        store,
        fetchFn,
        maxPages: 1,
        capturedAt,
      })

      expect(result.query).toBe("from:pleometric min_faves:10")
      expect(result.rawPagesCached).toBe(1)
      expect(result.entityUpserts).toEqual({ users: 1, tweets: 1, media: 0 })
      expect(result.counts.rawPages).toBe(1)
      expect(result.counts.users).toBe(1)
      expect(result.counts.tweets).toBe(1)
      expect(result.stopReason).toBe("max-pages")
      expect(store.getCachedPage({ source: "nitter-search", url: fetchedUrls[0] })?.body).toBe(nitterSearchPage)
    } finally {
      store.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
