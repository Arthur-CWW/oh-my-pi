import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runNitterBackfillWorker, type NitterFetchFunction } from "../src"

const baseUrl = "https://nitter.example"
const fixedNow = "2026-06-18T00:00:00.000Z"

describe("Nitter backfill worker", () => {
  test("persists cursor state and resumes across batches", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-backfill-worker-"))
    const dbPath = join(tempDir, "archive.sqlite")
    const logPath = join(tempDir, "archive.jsonl")
    const mediaRoot = join(tempDir, "media")
    const fetchedUrls: string[] = []
    const pages = new Map<string, string>([
      [`${baseUrl}/communalAI`, nitterTimelinePage("communalAI", "1800000000000000100", "cursor-1")],
      [`${baseUrl}/communalAI?cursor=cursor-1`, nitterTimelinePage("communalAI", "1800000000000000101")],
    ])
    const fetchFn = fakeTimelineFetch(pages, fetchedUrls)

    try {
      const firstRun = await runNitterBackfillWorker({
        runId: "worker-resume-1",
        handles: ["communalAI"],
        dbPath,
        logPath,
        mediaRoot,
        baseUrl,
        batchPages: 1,
        runUntilEnd: false,
        delayMs: 0,
        jitterMs: 0,
        mediaConcurrency: 1,
        mediaMaxItems: 0,
        fetchFn,
        now: () => fixedNow,
      })

      expect(fetchedUrls).toEqual([`${baseUrl}/communalAI`])
      expect(firstRun.targets[0]).toMatchObject({
        username: "communalAI",
        status: "stopped",
        stopReason: "run-once",
        cursor: "cursor-1",
        pagesFetched: 1,
        batchesCompleted: 1,
      })

      const secondRun = await runNitterBackfillWorker({
        runId: "worker-resume-2",
        handles: ["communalAI"],
        dbPath,
        logPath,
        mediaRoot,
        baseUrl,
        batchPages: 1,
        runUntilEnd: true,
        delayMs: 0,
        jitterMs: 0,
        mediaConcurrency: 1,
        mediaMaxItems: 0,
        fetchFn,
        now: () => fixedNow,
      })

      expect(fetchedUrls).toEqual([`${baseUrl}/communalAI`, `${baseUrl}/communalAI?cursor=cursor-1`])
      expect(secondRun.targets[0]).toMatchObject({
        username: "communalAI",
        status: "completed",
        stopReason: "no-cursor",
        cursor: null,
        pagesFetched: 2,
        batchesCompleted: 2,
        rawPagesCached: 2,
        tweetsUpserted: 2,
      })
      expect(secondRun.targets[0]?.counts.rawPages).toBe(2)
      expect(secondRun.targets[0]?.counts.tweets).toBe(2)

      const events = jsonlEvents(await readFile(logPath, "utf8"))
      expect(events.some((event) => event.event === "page.completed" && event.details?.cursor === "cursor-1")).toBe(true)
      expect(events.some((event) => event.event === "batch.completed" && event.details?.nextCursor === null)).toBe(true)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("stops terminally when a page has no next cursor", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-backfill-terminal-"))
    const dbPath = join(tempDir, "archive.sqlite")
    const logPath = join(tempDir, "archive.jsonl")
    const mediaRoot = join(tempDir, "media")
    const fetchedUrls: string[] = []
    const fetchFn = fakeTimelineFetch(
      new Map([[`${baseUrl}/communalAI`, nitterTimelinePage("communalAI", "1800000000000000200")]]),
      fetchedUrls,
    )

    try {
      const run = await runNitterBackfillWorker({
        runId: "worker-terminal",
        handles: ["communalAI"],
        dbPath,
        logPath,
        mediaRoot,
        baseUrl,
        batchPages: 5,
        runUntilEnd: true,
        delayMs: 0,
        jitterMs: 0,
        mediaConcurrency: 1,
        mediaMaxItems: 0,
        fetchFn,
        now: () => fixedNow,
      })

      expect(fetchedUrls).toEqual([`${baseUrl}/communalAI`])
      expect(run.targets[0]).toMatchObject({
        status: "completed",
        stopReason: "no-cursor",
        cursor: null,
        pagesFetched: 1,
        batchesCompleted: 1,
      })
      expect(run.targets[0]?.counts.rawPages).toBe(1)
      expect(run.targets[0]?.counts.tweets).toBe(1)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

function fakeTimelineFetch(pages: ReadonlyMap<string, string>, fetchedUrls: string[]): NitterFetchFunction {
  return async (url) => {
    fetchedUrls.push(url)
    const body = pages.get(url)
    if (!body) {
      return {
        ok: false,
        status: 404,
        headers: contentTypeHeaders(),
        async text() {
          return "missing fake page"
        },
      }
    }

    return {
      ok: true,
      status: 200,
      headers: contentTypeHeaders(),
      async text() {
        return body
      },
    }
  }
}

function contentTypeHeaders(): { readonly get: (name: string) => string | null } {
  return {
    get(name: string) {
      return name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null
    },
  }
}

function nitterTimelinePage(username: string, tweetId: string, nextCursor?: string): string {
  const showMore = nextCursor
    ? `<div class="show-more"><a href="/${username}?cursor=${encodeURIComponent(nextCursor)}">Load more</a></div>`
    : ""
  return String.raw`
<!doctype html>
<html>
  <body>
    <div class="profile-card">
      <a class="profile-card-fullname" href="/${username}">Communal AI</a>
      <a class="profile-card-username" href="/${username}">@${username}</a>
    </div>
    <div class="timeline">
      <div class="timeline-item">
        <a class="tweet-link" href="/${username}/status/${tweetId}#m"></a>
        <div class="tweet-body">
          <div class="tweet-header">
            <a class="fullname" href="/${username}">Communal AI</a>
            <a class="username" href="/${username}">@${username}</a>
            <span class="tweet-date"><a href="/${username}/status/${tweetId}#m" title="Jun 18, 2026 · 10:30 AM UTC">Jun 18</a></span>
          </div>
          <div class="tweet-content" dir="auto">Archived page for ${tweetId}</div>
        </div>
      </div>
    </div>
    ${showMore}
  </body>
</html>`
}

function jsonlEvents(raw: string): Array<{ readonly event?: string; readonly details?: { readonly cursor?: string | null; readonly nextCursor?: string | null } }> {
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { readonly event?: string; readonly details?: { readonly cursor?: string | null; readonly nextCursor?: string | null } })
}
