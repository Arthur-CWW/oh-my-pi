import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseQueuedNitterBackfillWorkerCliArgs, runFullSyncPass, type NitterFetchFunction } from "../src"

const baseUrl = "https://nitter.example"
const fixedNow = "2026-06-18T00:00:00.000Z"
const horizon = "2026-05-19T00:00:00.000Z"

describe("full account exhaustion", () => {
  test("CLI keeps explicit handles ordered and separate from due-target selection", () => {
    expect(
      parseQueuedNitterBackfillWorkerCliArgs([
        "--exhaust",
        "--handles",
        "Second,first",
        "--handle",
        "@THIRD",
        "--handle=first",
        "--pages-per-pass",
        "7",
        "--horizon",
        horizon,
      ]),
    ).toMatchObject({
      exhaust: true,
      handles: ["Second", "first", "THIRD"],
      once: true,
      daemon: false,
      pagesPerPass: 7,
      horizon,
    })
    expect(() => parseQueuedNitterBackfillWorkerCliArgs(["--exhaust"])).toThrow("requires --handles or --handle")
  })

  test("cursor chain reaches no-cursor and immediately enters the search lane", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-full-sync-chain-"))
    const fetched: string[] = []
    const fetchFn = fixtureFetch(
      (url) => {
        if (url === `${baseUrl}/chain`) return timelineFixture("chain", "1900000000000000001", "next")
        if (url === `${baseUrl}/chain?cursor=next`) return timelineFixture("chain", "1890000000000000001")
        if (url.startsWith(`${baseUrl}/search?`)) return timelineFixture("chain", "1880000000000000001")
        if (url.startsWith("https://web.archive.org/")) return "[]"
        return undefined
      },
      fetched,
    )
    try {
      const summary = await runFullSyncPass({
        runId: "chain-pass",
        handles: ["chain"],
        dbPath: join(tempDir, "archive.sqlite"),
        logPath: join(tempDir, "archive.jsonl"),
        mediaRoot: join(tempDir, "media"),
        baseUrl,
        mirrorUrls: [baseUrl],
        cacheRoot: join(tempDir, "cache"),
        pagesPerPass: 3,
        horizon,
        delayMs: 0,
        jitterMs: 0,
        mediaMaxItems: 0,
        fetchFn,
        now: () => fixedNow,
      })

      expect(fetched.slice(0, 2)).toEqual([`${baseUrl}/chain`, `${baseUrl}/chain?cursor=next`])
      expect(fetched.some((url) => url.startsWith(`${baseUrl}/search?`))).toBeTrue()
      expect(summary.handles[0]?.lanes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ lane: "timeline", status: "completed", cursor: null, pages: 2 }),
          expect.objectContaining({ lane: "search", status: "completed" }),
        ]),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("reopens durable state and reuses a cached stopped response", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-full-sync-resume-"))
    const fetched: string[] = []
    const fetchFn: NitterFetchFunction = async (url) => {
      fetched.push(url)
      return response(503, "temporary upstream failure")
    }
    const options = {
      handles: ["resume"] as const,
      dbPath: join(tempDir, "archive.sqlite"),
      logPath: join(tempDir, "archive.jsonl"),
      mediaRoot: join(tempDir, "media"),
      baseUrl,
      mirrorUrls: [baseUrl] as const,
      cacheRoot: join(tempDir, "cache"),
      pagesPerPass: 1,
      horizon,
      delayMs: 0,
      jitterMs: 0,
      mediaMaxItems: 0,
      fetchFn,
      now: () => fixedNow,
    }
    try {
      const first = await runFullSyncPass({ ...options, runId: "resume-pass-1" })
      const second = await runFullSyncPass({ ...options, runId: "resume-pass-2" })

      expect(fetched).toEqual([`${baseUrl}/resume`])
      expect(first.handles[0]?.lanes[0]).toMatchObject({ lane: "timeline", status: "stopped", pages: 1 })
      expect(second.handles[0]?.lanes[0]).toMatchObject({ lane: "timeline", status: "stopped", pages: 2 })
      expect(second.handles[0]?.exhaustedAt).toBeNull()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

function fixtureFetch(resolveBody: (url: string) => string | undefined, fetched: string[]): NitterFetchFunction {
  return async (url) => {
    fetched.push(url)
    const body = resolveBody(url)
    return body === undefined ? response(404, "missing fixture") : response(200, body)
  }
}

function response(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
    async text() {
      return body
    },
  }
}

function timelineFixture(username: string, tweetId: string, nextCursor?: string): string {
  const showMore = nextCursor
    ? `<div class="show-more"><a href="/${username}?cursor=${encodeURIComponent(nextCursor)}">Load more</a></div>`
    : ""
  return `<!doctype html><html><body>
    <div class="profile-card"><a class="profile-card-fullname" href="/${username}">Fixture</a><a class="profile-card-username" href="/${username}">@${username}</a></div>
    <div class="timeline"><div class="timeline-item"><a class="tweet-link" href="/${username}/status/${tweetId}#m"></a><div class="tweet-body"><div class="tweet-header"><a class="fullname" href="/${username}">Fixture</a><a class="username" href="/${username}">@${username}</a><span class="tweet-date"><a href="/${username}/status/${tweetId}#m" title="Jun 18, 2026 · 10:30 AM UTC">Jun 18</a></span></div><div class="tweet-content" dir="auto">Fixture ${tweetId}</div></div></div></div>
    ${showMore}</body></html>`
}
