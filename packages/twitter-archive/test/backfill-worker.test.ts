import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  enqueueNitterBackfillTarget,
  readNitterBackfillTarget,
  runNitterBackfillWorker,
  type NitterBackfillWorkerOptions,
  type NitterFetchFunction,
  type NitterFetchResponseLike,
} from "../src"

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

  test("allows only one overlapping worker to fetch a target", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-backfill-overlap-"))
    const started = deferred<void>()
    const release = deferred<void>()
    let firstFetches = 0
    let secondFetches = 0
    const firstFetch: NitterFetchFunction = async () => {
      firstFetches += 1
      started.resolve()
      await release.promise
      return timelineResponse(nitterTimelinePage("communalAI", "1800000000000000300"))
    }
    const secondFetch: NitterFetchFunction = async () => {
      secondFetches += 1
      return timelineResponse(nitterTimelinePage("communalAI", "1800000000000000301"))
    }

    try {
      const firstRunPromise = runNitterBackfillWorker(workerOptions(tempDir, "worker-overlap-1", firstFetch))
      await started.promise
      const secondRun = await runNitterBackfillWorker(workerOptions(tempDir, "worker-overlap-2", secondFetch))

      expect(secondFetches).toBe(0)
      expect(secondRun.targets[0]).toMatchObject({
        status: "running",
        stopReason: "already-running",
        pagesFetched: 0,
      })

      release.resolve()
      const firstRun = await firstRunPromise
      expect(firstFetches).toBe(1)
      expect(firstRun.targets[0]).toMatchObject({ status: "completed", pagesFetched: 1 })
    } finally {
      release.resolve()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("rejects an explicit reset while the target lease is active", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-backfill-reset-"))
    const started = deferred<void>()
    const release = deferred<void>()
    const fetchFn: NitterFetchFunction = async () => {
      started.resolve()
      await release.promise
      return timelineResponse(nitterTimelinePage("communalAI", "1800000000000000400"))
    }

    try {
      const runPromise = runNitterBackfillWorker(workerOptions(tempDir, "worker-reset-owner", fetchFn))
      await started.promise

      expect(() =>
        enqueueNitterBackfillTarget({
          dbPath: join(tempDir, "archive.sqlite"),
          handle: "communalAI",
          baseUrl,
          reset: true,
          runId: "reset-attempt",
          now: () => fixedNow,
        }),
      ).toThrow("Cannot reset actively leased backfill target")

      release.resolve()
      await runPromise
    } finally {
      release.resolve()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("reclaims an expired lease without allowing the stale owner to overwrite progress", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-backfill-expired-"))
    const started = deferred<void>()
    const release = deferred<void>()
    let now = fixedNow
    const firstFetch: NitterFetchFunction = async () => {
      started.resolve()
      await release.promise
      return timelineResponse(nitterTimelinePage("communalAI", "1800000000000000500", "stale-cursor"))
    }
    const secondFetch: NitterFetchFunction = async () =>
      timelineResponse(nitterTimelinePage("communalAI", "1800000000000000501", "reclaimed-cursor"))

    try {
      const firstRunPromise = runNitterBackfillWorker({
        ...workerOptions(tempDir, "worker-expired-owner", firstFetch),
        now: () => now,
      })
      await started.promise
      now = "2026-06-18T00:06:00.000Z"

      const reclaimedRun = await runNitterBackfillWorker({
        ...workerOptions(tempDir, "worker-expired-reclaimer", secondFetch),
        runUntilEnd: false,
        now: () => now,
      })
      expect(reclaimedRun.targets[0]).toMatchObject({
        status: "stopped",
        cursor: "reclaimed-cursor",
        stopReason: "run-once",
        pagesFetched: 1,
      })

      release.resolve()
      await firstRunPromise
      expect(
        readNitterBackfillTarget({
          dbPath: join(tempDir, "archive.sqlite"),
          handle: "communalAI",
          baseUrl,
        }),
      ).toMatchObject({
        status: "stopped",
        cursor: "reclaimed-cursor",
        pagesFetched: 1,
        lastRunId: "worker-expired-reclaimer",
      })
    } finally {
      release.resolve()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("preserves the durable cursor and page count when a later page throws", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-backfill-partial-failure-"))
    const fetchedUrls: string[] = []
    const fetchFn: NitterFetchFunction = async (url) => {
      fetchedUrls.push(url)
      if (url === `${baseUrl}/communalAI`) {
        return timelineResponse(
          nitterTimelinePage("communalAI", "1800000000000000600", "durable-cursor"),
        )
      }
      throw new Error("synthetic second-page failure")
    }

    try {
      const run = await runNitterBackfillWorker({
        ...workerOptions(tempDir, "worker-partial-failure", fetchFn),
        batchPages: 2,
        runUntilEnd: true,
      })

      expect(fetchedUrls).toEqual([
        `${baseUrl}/communalAI`,
        `${baseUrl}/communalAI?cursor=durable-cursor`,
      ])
      expect(run.targets[0]).toMatchObject({
        status: "failed",
        stopReason: "error",
        cursor: "durable-cursor",
        pagesFetched: 1,
        rawPagesCached: 1,
      })
      expect(
        readNitterBackfillTarget({
          dbPath: join(tempDir, "archive.sqlite"),
          handle: "communalAI",
          baseUrl,
        }),
      ).toMatchObject({
        status: "failed",
        cursor: "durable-cursor",
        pagesFetched: 1,
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

function workerOptions(
  tempDir: string,
  runId: string,
  fetchFn: NitterFetchFunction,
): NitterBackfillWorkerOptions {
  return {
    runId,
    handles: ["communalAI"],
    dbPath: join(tempDir, "archive.sqlite"),
    logPath: join(tempDir, "archive.jsonl"),
    mediaRoot: join(tempDir, "media"),
    baseUrl,
    batchPages: 1,
    runUntilEnd: true,
    delayMs: 0,
    jitterMs: 0,
    mediaConcurrency: 1,
    mediaMaxItems: 0,
    fetchFn,
    now: () => fixedNow,
  }
}

function timelineResponse(body: string): NitterFetchResponseLike {
  return {
    ok: true,
    status: 200,
    headers: contentTypeHeaders(),
    async text() {
      return body
    },
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolvePromise: (value: T) => void = () => {
    throw new Error("Deferred promise was not initialized")
  }
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

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
