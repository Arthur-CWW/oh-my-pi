import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  captureNitterTimelineToSqlite,
  classifyNitterResponse,
  fetchNitterTimeline,
  initTwitterArchiveSqliteStore,
  NITTER_DEFAULT_MAX_PAGES,
  NITTER_HARD_MAX_PAGES,
  parseNitterTimelinePage,
  parseNitterTweetDetailPage,
  resolveNitterTweetDetails,
  type NitterFetchFunction,
} from "../src"
import { parseNitterBackfillCliArgs } from "../src/nitter-smoke"
import { readFixture } from "./fixtures/read-fixture"

const capturedAt = "2026-06-18T00:00:00.000Z"
const nitterPage = await readFixture("nitter-timeline-media-quote-retweet.html")
const truncatedTimelinePage = await readFixture("nitter-timeline-truncated.html")
const detailPage = await readFixture("nitter-detail-thread.html")
const unavailableQuoteDetailPage = await readFixture("nitter-detail-unavailable-quote.html")
const quoteReferenceOnlyDetailPage = await readFixture("nitter-detail-quote-reference-only.html")

describe("Nitter timeline parsing", () => {
  test("parses profile, tweets, media, metrics, retweet marker, and next cursor", () => {
    const parsed = parseNitterTimelinePage(nitterPage, {
      baseUrl: "https://nitter.example",
      targetUsername: "@communalAI",
      capturedAt,
    })

    expect({
      user: parsed.users.find((user) => user.id === "communalai"),
      firstTweet: {
        id: parsed.tweets[0]?.id,
        authorId: parsed.tweets[0]?.authorId,
        username: parsed.tweets[0]?.username,
        url: parsed.tweets[0]?.url,
        text: parsed.tweets[0]?.text,
        createdAt: parsed.tweets[0]?.createdAt,
        quotedTweetId: parsed.tweets[0]?.quotedTweetId,
        quotedTweetUrl: parsed.tweets[0]?.quotedTweetUrl,
        mediaIds: parsed.tweets[0]?.mediaIds,
        publicMetrics: parsed.tweets[0]?.publicMetrics,
        capturedAt: parsed.tweets[0]?.capturedAt,
        source: parsed.tweets[0]?.source,
      },
      quotedTweet: {
        id: parsed.tweets.find((tweet) => tweet.id === "1799999999999999999")?.id,
        username: parsed.tweets.find((tweet) => tweet.id === "1799999999999999999")?.username,
        text: parsed.tweets.find((tweet) => tweet.id === "1799999999999999999")?.text,
      },
      media: parsed.media[0],
      retweet: parsed.timeline[1],
      nextCursor: parsed.nextCursor,
    }).toMatchSnapshot()
  })

  test("marks truncated timeline text for detail resolution", () => {
    const parsed = parseNitterTimelinePage(truncatedTimelinePage, {
      baseUrl: "https://nitter.example",
      targetUsername: "CommunalAi",
      capturedAt,
    })

    expect(parsed.tweets[0]?.text).toBe("This public timeline text is clipped…")
    expect(parsed.timeline[0]).toMatchObject({
      tweetId: "1800000000000000003",
      needsDetailResolution: true,
      detailUrl: "https://x.com/CommunalAi/status/1800000000000000003",
    })
  })

  test("classifies rate limits, policy stops, challenges, and non-2xx responses", () => {
    expect(classifyNitterResponse(429, "Too many requests")).toEqual({ ok: false, status: 429, reason: "rate-limited" })
    expect(classifyNitterResponse(200, "Verify you are human before continuing")).toEqual({
      ok: false,
      status: 200,
      reason: "challenge",
    })
    expect(classifyNitterResponse(200, "Blocked by robots.txt policy")).toEqual({ ok: false, status: 200, reason: "policy" })
    expect(classifyNitterResponse(503, "Service unavailable")).toEqual({ ok: false, status: 503, reason: "non-2xx" })
  })
})

describe("Nitter timeline fetching", () => {
  test("uses injectable fetch and defaults to one page at a time", async () => {
    const fetchedUrls: string[] = []
    const fetchFn: NitterFetchFunction = async (url) => {
      fetchedUrls.push(url)
      return {
        ok: true,
        status: 200,
        async text() {
          return nitterPage
        },
      }
    }

    const result = await fetchNitterTimeline("@communalAI", {
      baseUrl: "https://nitter.example",
      fetchFn,
      capturedAt,
    })

    expect(result.requestedMaxPages).toBe(NITTER_DEFAULT_MAX_PAGES)
    expect(result.maxPages).toBe(1)
    expect(result.stopReason).toBe("max-pages")
    expect(fetchedUrls).toEqual(["https://nitter.example/communalAI"])
    expect(result.users.some((user) => user.id === "communalai")).toBe(true)
    expect(result.tweets.some((tweet) => tweet.id === "1800000000000000001")).toBe(true)
    expect(result.nextCursor?.cursor).toBe("DAABC==")
  })

  test("starts from a saved cursor and exposes the next cursor for resumed batches", async () => {
    const fetchedUrls: string[] = []
    const fetchFn: NitterFetchFunction = async (url) => {
      fetchedUrls.push(url)
      return {
        ok: true,
        status: 200,
        async text() {
          return truncatedTimelinePage
        },
      }
    }

    const result = await fetchNitterTimeline("CommunalAi", {
      baseUrl: "https://nitter.example",
      fetchFn,
      startCursor: "SAVED",
      capturedAt,
    })

    expect(fetchedUrls).toEqual(["https://nitter.example/CommunalAi?cursor=SAVED"])
    expect(result.nextCursor?.cursor).toBe("NEXT")
  })

  test("clamps requested page count to the hard cap", async () => {
    const fetchedUrls: string[] = []
    const fetchFn: NitterFetchFunction = async (url) => {
      fetchedUrls.push(url)
      return {
        ok: true,
        status: 200,
        async text() {
          return nitterPage
        },
      }
    }

    const result = await fetchNitterTimeline("CommunalAi", {
      baseUrl: "https://nitter.example",
      fetchFn,
      maxPages: 100,
      capturedAt,
    })

    expect(result.maxPages).toBe(NITTER_HARD_MAX_PAGES)
    expect(fetchedUrls).toHaveLength(NITTER_HARD_MAX_PAGES)
    expect(fetchedUrls[1]).toBe("https://nitter.example/CommunalAi?cursor=DAABC%3D%3D")
    expect(result.stopReason).toBe("max-pages")
  })

  test("stops fetching when a response is classified as rate limited", async () => {
    let calls = 0
    const fetchFn: NitterFetchFunction = async () => {
      calls += 1
      return calls === 1
        ? {
            ok: true,
            status: 200,
            async text() {
              return nitterPage
            },
          }
        : {
            ok: false,
            status: 429,
            async text() {
              return "rate limited"
            },
          }
    }

    const result = await fetchNitterTimeline("CommunalAi", {
      baseUrl: "https://nitter.example",
      fetchFn,
      maxPages: 2,
      capturedAt,
    })

    expect(calls).toBe(2)
    expect(result.pages).toHaveLength(1)
    expect(result.stopReason).toBe("rate-limited")
  })

  test("caches raw pages and upserts parsed entities into sqlite", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-nitter-"))
    const dbPath = join(tempDir, "archive.sqlite")
    try {
      const fetchFn: NitterFetchFunction = async () => ({
        ok: true,
        status: 200,
        headers: {
          get(name: string) {
            return name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null
          },
        },
        async text() {
          return nitterPage
        },
      })

      const result = await captureNitterTimelineToSqlite("CommunalAi", {
        baseUrl: "https://nitter.example",
        dbPath,
        fetchFn,
        maxPages: 1,
        capturedAt,
      })

      expect(result.rawPagesCached).toBe(1)
      expect(result.entityUpserts).toEqual({ users: 3, tweets: 3, media: 1 })
      expect(result.counts.rawPages).toBe(1)
      expect(result.counts.users).toBe(3)
      expect(result.counts.tweets).toBe(3)
      expect(result.counts.media).toBe(1)
      expect(result.stopReason).toBe("max-pages")

      const store = initTwitterArchiveSqliteStore(dbPath)
      try {
        expect(store.listTweetTimelineProvenance().map(({ id: _id, ...entry }) => entry)).toMatchSnapshot()
      } finally {
        store.close()
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})


describe("Nitter status detail parsing and resolution", () => {
  test("parses full status text, quote cards, media, and surrounding thread tweets", () => {
    const parsed = parseNitterTweetDetailPage(detailPage, {
      baseUrl: "https://nitter.example",
      targetUsername: "CommunalAi",
      tweetId: "1800000000000000003",
      capturedAt,
    })

    expect({
      parseStatus: parsed.parseStatus,
      primaryTweet: {
        id: parsed.primaryTweet?.id,
        text: parsed.primaryTweet?.text,
        quotedTweetId: parsed.primaryTweet?.quotedTweetId,
        quotedTweetUrl: parsed.primaryTweet?.quotedTweetUrl,
        conversationId: parsed.primaryTweet?.conversationId,
        mediaIds: parsed.primaryTweet?.mediaIds,
      },
      quote: parsed.quote,
      quotedTweet: {
        id: parsed.quotedTweet?.id,
        username: parsed.quotedTweet?.username,
        text: parsed.quotedTweet?.text,
        mediaIds: parsed.quotedTweet?.mediaIds,
      },
      quoteMedia: {
        id: parsed.media.find((media) => media.tweetId === "1799999999999999999")?.id,
        remoteUrl: parsed.media.find((media) => media.tweetId === "1799999999999999999")?.remoteUrl,
        previewImageUrl: parsed.media.find((media) => media.tweetId === "1799999999999999999")?.previewImageUrl,
      },
      thread: parsed.thread,
      followUpConversationId: parsed.tweets.find((tweet) => tweet.id === "1800000000000000004")?.conversationId,
    }).toMatchSnapshot()
  })

  test("resolves truncated timeline records into sqlite without dropping metrics", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-nitter-detail-"))
    const dbPath = join(tempDir, "archive.sqlite")
    const store = initTwitterArchiveSqliteStore(dbPath)
    try {
      const timeline = parseNitterTimelinePage(truncatedTimelinePage, {
        baseUrl: "https://nitter.example",
        targetUsername: "CommunalAi",
        capturedAt,
      })
      store.upsertUsers(timeline.users)
      store.upsertTweets(timeline.tweets)
      store.upsertMedia(timeline.media)

      const fetchFn: NitterFetchFunction = async () => ({
        ok: true,
        status: 200,
        headers: {
          get(name: string) {
            return name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null
          },
        },
        async text() {
          return detailPage
        },
      })

      const result = await resolveNitterTweetDetails([timeline.tweets[0]], {
        baseUrl: "https://nitter.example",
        store,
        fetchFn,
        capturedAt,
      })

      expect(result.details).toHaveLength(1)
      expect(result.rawPagesCached).toBe(1)
      const resolvedTweet = store.getTweet("1800000000000000003")
      expect(resolvedTweet?.text).toBe("This public timeline text is clipped in lists, but the status page exposes the complete text.")
      expect(resolvedTweet?.publicMetrics).toEqual({ likes: 5 })
      expect(resolvedTweet?.mediaIds).toEqual(["1800000000000000003-media-1"])
      expect(store.getTweet("1800000000000000004")?.conversationId).toBe("1800000000000000003")
      expect(store.getTweet("1799999999999999999")?.text).toBe("Quoted card text from detail.")
      expect(store.getTweet("1799999999999999999")?.mediaIds).toEqual(["1799999999999999999-media-1"])
      expect(store.getMedia("1799999999999999999-media-1")?.remoteUrl).toBe("https://nitter.example/pic/media%2Fquoted.jpg")
      const status = store.sqlite.prepare("SELECT quote_status AS quoteStatus FROM tweets WHERE id = ?").get("1800000000000000003") as
        | { quoteStatus: string }
        | undefined
      expect(status?.quoteStatus).toBe("resolved")
    } finally {
      store.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("keeps quote status pending when detail exposes only a quote reference", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-nitter-pending-quote-"))
    const dbPath = join(tempDir, "archive.sqlite")
    const store = initTwitterArchiveSqliteStore(dbPath)
    try {
      const fetchFn: NitterFetchFunction = async () => ({
        ok: true,
        status: 200,
        headers: {
          get(name: string) {
            return name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null
          },
        },
        async text() {
          return quoteReferenceOnlyDetailPage
        },
      })

      await resolveNitterTweetDetails(
        [{ tweetId: "1800000000000000006", username: "CommunalAi", url: "https://x.com/CommunalAi/status/1800000000000000006" }],
        {
          baseUrl: "https://nitter.example",
          store,
          fetchFn,
          capturedAt,
        },
      )

      expect(store.getTweet("1799999999999999998")).toBeUndefined()
      const status = store.sqlite
        .prepare("SELECT quote_status AS quoteStatus, quote_unavailable_reason AS quoteUnavailableReason FROM tweets WHERE id = ?")
        .get("1800000000000000006") as { quoteStatus: string; quoteUnavailableReason: string | null } | undefined
      expect(status).toMatchSnapshot()
      expect(status).toEqual({
        quoteStatus: "pending",
        quoteUnavailableReason: "quoted tweet reference found without stored quoted content",
      })
    } finally {
      store.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("marks unavailable quoted tweets from Nitter detail pages", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-nitter-unavailable-quote-"))
    const dbPath = join(tempDir, "archive.sqlite")
    const store = initTwitterArchiveSqliteStore(dbPath)
    try {
      const fetchFn: NitterFetchFunction = async () => ({
        ok: true,
        status: 200,
        headers: {
          get(name: string) {
            return name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null
          },
        },
        async text() {
          return unavailableQuoteDetailPage
        },
      })

      await resolveNitterTweetDetails(
        [{ tweetId: "1800000000000000005", username: "CommunalAi", url: "https://x.com/CommunalAi/status/1800000000000000005" }],
        {
          baseUrl: "https://nitter.example",
          store,
          fetchFn,
          capturedAt,
        },
      )

      const status = store.sqlite
        .prepare("SELECT quote_status AS quoteStatus, quote_unavailable_reason AS quoteUnavailableReason FROM tweets WHERE id = ?")
        .get("1800000000000000005") as { quoteStatus: string; quoteUnavailableReason: string | null } | undefined
      expect(status).toEqual({
        quoteStatus: "unavailable",
        quoteUnavailableReason: "quote unavailable on Nitter status page",
      })
    } finally {
      store.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
describe("Nitter backfill CLI parsing", () => {
  test("defaults to communalAI with one target when no handles are provided", () => {
    expect(parseNitterBackfillCliArgs([])).toEqual({ handles: ["communalAI"] })
  })

  test("accepts explicit bounded backfill handles from flags, env, and slash-separated groups", () => {
    expect(
      parseNitterBackfillCliArgs(["--handles", "@communalAI,pleometric", "teortaxes/teortaxestex", "--max-pages=1"]),
    ).toEqual({
      handles: ["communalAI", "pleometric", "teortaxes", "teortaxestex"],
      maxPages: 1,
    })
    expect(parseNitterBackfillCliArgs([], { NITTER_BACKFILL_HANDLES: "pleometric teortaxes/teortaxestex" })).toEqual({
      handles: ["pleometric", "teortaxes", "teortaxestex"],
    })
  })

  test("adds named future backfill targets only when requested", () => {
    expect(parseNitterBackfillCliArgs(["--include-backfill-targets"]).handles).toEqual([
      "communalAI",
      "pleometric",
      "teortaxes",
      "teortaxestex",
    ])
  })
})
