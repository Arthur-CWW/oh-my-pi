import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  ensureNitterBackfillTargetsTable,
  initTwitterArchiveSqliteStore,
  runQueuedNitterBackfillWorker,
  type NitterBackfillWorkerTargetStatus,
  type NitterFetchFunction,
} from "../src"

const baseUrl = "https://nitter.example"
const fixedNow = "2026-06-18T00:00:00.000Z"

interface StoredBackfillTargetState {
  readonly status: NitterBackfillWorkerTargetStatus
  readonly stop_reason: string | null
  readonly pages_fetched: number
  readonly completed_at: string | null
}

describe("Queued Nitter backfill worker", () => {
  test("discovers and fetches pending queued targets", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-queued-backfill-pending-"))
    const dbPath = join(tempDir, "archive.sqlite")
    const logPath = join(tempDir, "archive.jsonl")
    const mediaRoot = join(tempDir, "media")
    const fetchedUrls: string[] = []
    const pages = new Map<string, string>([
      [`${baseUrl}/queuedAI`, nitterTimelinePage("queuedAI", "1800000000000000300", "cursor-queued")],
    ])
    const fetchFn = fakeTimelineFetch(pages, fetchedUrls)

    try {
      seedBackfillTarget({
        dbPath,
        handle: "queuedAI",
        status: "pending",
        now: fixedNow,
      })

      const summary = await runQueuedNitterBackfillWorker({
        runId: "queued-worker-pending",
        once: true,
        dbPath,
        logPath,
        mediaRoot,
        baseUrl,
        limit: 10,
        batchPages: 1,
        delayMs: 0,
        jitterMs: 0,
        mediaConcurrency: 1,
        mediaMaxItems: 0,
        fetchFn,
        now: () => fixedNow,
      })

      expect(fetchedUrls).toEqual([`${baseUrl}/queuedAI`])
      expect(summary.cyclesCompleted).toBe(1)
      expect(summary.lastCycle?.selectedTargets).toEqual([
        {
          handleKey: "queuedai",
          handle: "queuedAI",
          status: "pending",
          updatedAt: fixedNow,
          completedAt: null,
          requeuedForResync: false,
        },
      ])
      expect(summary.lastCycle?.backfill?.targets[0]).toMatchObject({
        username: "queuedAI",
        status: "stopped",
        stopReason: "run-once",
        cursor: "cursor-queued",
        pagesFetched: 1,
        batchesCompleted: 1,
      })
      expect(readBackfillTargetState(dbPath, "queuedAI")).toMatchObject({
        status: "stopped",
        stop_reason: "run-once",
        pages_fetched: 1,
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("skips completed targets until the resync window expires", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-queued-backfill-completed-"))
    const dbPath = join(tempDir, "archive.sqlite")
    const logPath = join(tempDir, "archive.jsonl")
    const mediaRoot = join(tempDir, "media")
    const fetchedUrls: string[] = []
    const fetchFn = fakeTimelineFetch(
      new Map([[`${baseUrl}/recentAI`, nitterTimelinePage("recentAI", "1800000000000000400")]]),
      fetchedUrls,
    )

    try {
      seedBackfillTarget({
        dbPath,
        handle: "recentAI",
        status: "completed",
        now: fixedNow,
        completedAt: fixedNow,
      })

      const recentSummary = await runQueuedNitterBackfillWorker({
        runId: "queued-worker-completed-recent",
        once: true,
        dbPath,
        logPath,
        mediaRoot,
        baseUrl,
        limit: 10,
        completedResyncMs: 60 * 60 * 1000,
        batchPages: 1,
        delayMs: 0,
        jitterMs: 0,
        mediaConcurrency: 1,
        mediaMaxItems: 0,
        fetchFn,
        now: () => fixedNow,
      })

      expect(fetchedUrls).toEqual([])
      expect(recentSummary.lastCycle?.selectedTargets).toEqual([])
      expect(recentSummary.lastCycle?.backfill).toBeNull()

      markBackfillTargetCompletedAt(dbPath, "recentAI", "2026-06-17T22:00:00.000Z")

      const staleSummary = await runQueuedNitterBackfillWorker({
        runId: "queued-worker-completed-stale",
        once: true,
        dbPath,
        logPath,
        mediaRoot,
        baseUrl,
        limit: 10,
        completedResyncMs: 60 * 60 * 1000,
        batchPages: 1,
        delayMs: 0,
        jitterMs: 0,
        mediaConcurrency: 1,
        mediaMaxItems: 0,
        fetchFn,
        now: () => fixedNow,
      })

      expect(fetchedUrls).toEqual([`${baseUrl}/recentAI`])
      expect(staleSummary.lastCycle?.selectedTargets).toEqual([
        {
          handleKey: "recentai",
          handle: "recentAI",
          status: "completed",
          updatedAt: "2026-06-17T22:00:00.000Z",
          completedAt: "2026-06-17T22:00:00.000Z",
          requeuedForResync: true,
        },
      ])
      expect(staleSummary.lastCycle?.backfill?.targets[0]).toMatchObject({
        username: "recentAI",
        status: "completed",
        stopReason: "no-cursor",
        cursor: null,
        pagesFetched: 1,
        batchesCompleted: 1,
      })
      expect(readBackfillTargetState(dbPath, "recentAI")).toMatchObject({
        status: "completed",
        stop_reason: "no-cursor",
        pages_fetched: 1,
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

function seedBackfillTarget(options: {
  readonly dbPath: string
  readonly handle: string
  readonly status: NitterBackfillWorkerTargetStatus
  readonly now: string
  readonly completedAt?: string
}): void {
  const store = initTwitterArchiveSqliteStore(options.dbPath)
  try {
    ensureNitterBackfillTargetsTable(store)
    store.sqlite
      .query(
        `INSERT INTO nitter_backfill_targets (
          handle_key,
          handle,
          base_url,
          status,
          cursor,
          stop_reason,
          pages_fetched,
          batches_completed,
          raw_pages_cached,
          users_upserted,
          tweets_upserted,
          media_upserted,
          last_run_id,
          last_error,
          created_at,
          updated_at,
          completed_at
        ) VALUES (?, ?, ?, ?, NULL, NULL, 0, 0, 0, 0, 0, 0, NULL, NULL, ?, ?, ?)`,
      )
      .run(
        options.handle.toLowerCase(),
        options.handle,
        baseUrl,
        options.status,
        options.now,
        options.now,
        options.completedAt ?? null,
      )
  } finally {
    store.close()
  }
}

function markBackfillTargetCompletedAt(dbPath: string, handle: string, completedAt: string): void {
  const store = initTwitterArchiveSqliteStore(dbPath)
  try {
    ensureNitterBackfillTargetsTable(store)
    store.sqlite
      .query(
        `UPDATE nitter_backfill_targets
         SET completed_at = ?, updated_at = ?
         WHERE handle_key = ? AND base_url = ?`,
      )
      .run(completedAt, completedAt, handle.toLowerCase(), baseUrl)
  } finally {
    store.close()
  }
}

function readBackfillTargetState(dbPath: string, handle: string): StoredBackfillTargetState | undefined {
  const store = initTwitterArchiveSqliteStore(dbPath)
  try {
    return (
      store.sqlite
        .query(
          `SELECT status, stop_reason, pages_fetched, completed_at
           FROM nitter_backfill_targets
           WHERE handle_key = ? AND base_url = ?`,
        )
        .get(handle.toLowerCase(), baseUrl) as StoredBackfillTargetState | null
    ) ?? undefined
  } finally {
    store.close()
  }
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
      <a class="profile-card-fullname" href="/${username}">Queued AI</a>
      <a class="profile-card-username" href="/${username}">@${username}</a>
    </div>
    <div class="timeline">
      <div class="timeline-item">
        <a class="tweet-link" href="/${username}/status/${tweetId}#m"></a>
        <div class="tweet-body">
          <div class="tweet-header">
            <a class="fullname" href="/${username}">Queued AI</a>
            <a class="username" href="/${username}">@${username}</a>
            <span class="tweet-date"><a href="/${username}/status/${tweetId}#m" title="Jun 18, 2026 · 10:30 AM UTC">Jun 18</a></span>
          </div>
          <div class="tweet-content" dir="auto">Queued page for ${tweetId}</div>
        </div>
      </div>
    </div>
    ${showMore}
  </body>
</html>`
}
