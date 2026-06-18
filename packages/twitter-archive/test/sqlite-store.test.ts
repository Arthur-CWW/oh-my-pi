import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initTwitterArchiveSqliteStore, type ArchiveMedia, type ArchiveTweet, type ArchiveUser } from "../src"

describe("Twitter archive sqlite store", () => {
  test("caches pages, upserts archive records, counts rows, and advances jobs", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-sqlite-"))
    const store = initTwitterArchiveSqliteStore(join(tempDir, "archive.sqlite"))

    try {
      const cachedPage = store.cacheRawPage({
        source: "nitter",
        url: "https://nitter.net/communalAI",
        requestHash: "communalAI-page-1",
        fetchedAt: "2026-06-18T00:00:00.000Z",
        statusCode: 200,
        contentType: "text/html; charset=utf-8",
        headers: { "cache-control": "public" },
        body: "<html><body>communalAI timeline</body></html>",
      })

      expect(store.getCachedPage({ source: "nitter", url: "https://nitter.net/communalAI", requestHash: cachedPage.requestHash })).toEqual(
        cachedPage,
      )

      const user: ArchiveUser = {
        id: "user-communalai",
        username: "communalAI",
        displayName: "communalAI",
        profileUrl: "https://x.com/communalAI",
        capturedAt: "2026-06-18T00:00:01.000Z",
      }
      const tweet: ArchiveTweet = {
        id: "tweet-1",
        authorId: user.id,
        username: user.username,
        url: "https://x.com/communalAI/status/1",
        text: "A public timeline post",
        createdAt: "2026-06-17T12:00:00.000Z",
        mediaIds: ["media-1"],
        capturedAt: "2026-06-18T00:00:02.000Z",
        source: "frontend",
      }
      const media: ArchiveMedia = {
        id: "media-1",
        tweetId: tweet.id,
        type: "image",
        remoteUrl: "https://nitter.net/pic/media-1.jpg",
        capturedAt: "2026-06-18T00:00:03.000Z",
        source: "frontend",
      }

      expect(store.upsertUsers([user]).total).toBe(1)
      expect(store.upsertTweets([tweet]).total).toBe(1)
      expect(store.upsertMedia([media]).total).toBe(1)
      expect(store.upsertUsers([user]).total).toBe(1)
      expect(store.upsertTweets([tweet]).total).toBe(1)
      expect(store.upsertMedia([media]).total).toBe(1)
      expect(store.getUser(user.id)).toEqual(user)
      expect(store.getTweet(tweet.id)).toEqual(tweet)
      expect(store.getMedia(media.id)).toEqual(media)
      expect(store.listUsers()).toEqual([user])
      expect(store.listTweets()).toEqual([tweet])
      expect(store.listMedia()).toEqual([media])
      expect(store.updateMediaLocalPath(media.id, join(tempDir, "media-1.jpg"), "2026-06-18T00:00:04.000Z")).toEqual({
        ...media,
        localPath: join(tempDir, "media-1.jpg"),
      })
      expect(store.getMedia(media.id)?.localPath).toBe(join(tempDir, "media-1.jpg"))
      expect(store.getCounts()).toMatchObject({ rawPages: 1, captureJobs: 0, users: 1, tweets: 1, media: 1 })

      expect(
        store.upsertTweetNote({
          id: "note-1",
          tweetId: tweet.id,
          body: "Local note, not a Twitter reply",
          createdAt: "2026-06-18T00:00:05.000Z",
        }),
      ).toEqual({
        id: "note-1",
        tweetId: tweet.id,
        body: "Local note, not a Twitter reply",
        createdAt: "2026-06-18T00:00:05.000Z",
        updatedAt: "2026-06-18T00:00:05.000Z",
      })
      expect(
        store.upsertTweetNote({
          id: "note-1",
          tweetId: tweet.id,
          body: "Edited local note",
          createdAt: "2026-06-18T00:00:05.000Z",
          updatedAt: "2026-06-18T00:00:06.000Z",
        }),
      ).toMatchObject({ id: "note-1", body: "Edited local note", updatedAt: "2026-06-18T00:00:06.000Z" })
      expect(store.listTweetNotes(tweet.id).map((note) => note.body)).toEqual(["Edited local note"])
      store.deleteTweetNote("note-1")
      expect(store.listTweetNotes(tweet.id)).toEqual([])

      expect(
        store.setTweetAttribute({
          tweetId: tweet.id,
          key: "priority-review",
          value: "true",
          createdAt: "2026-06-18T00:00:07.000Z",
        }),
      ).toEqual({
        tweetId: tweet.id,
        key: "priority-review",
        value: "true",
        createdAt: "2026-06-18T00:00:07.000Z",
        updatedAt: "2026-06-18T00:00:07.000Z",
      })
      expect(store.setTweetAttribute({ tweetId: tweet.id, key: "priority-review", value: "done" })).toMatchObject({
        key: "priority-review",
        value: "done",
      })
      expect(store.listTweetAttributes(tweet.id).map((attribute) => [attribute.key, attribute.value])).toEqual([
        ["priority-review", "done"],
      ])
      store.clearTweetAttribute(tweet.id, "priority-review")
      expect(store.listTweetAttributes(tweet.id)).toEqual([])

      const completedJob = store.enqueueJob({
        source: "nitter",
        target: "https://nitter.net/communalAI",
        requestHash: "job-page-1",
        stage: "timeline",
        createdAt: "2026-06-18T00:01:00.000Z",
      })
      expect(completedJob.status).toBe("pending")
      expect(store.listJobs({ status: "pending", stage: "timeline" }).map((job) => job.id)).toEqual([completedJob.id])

      expect(store.startJob(completedJob.id, { stage: "fetching", startedAt: "2026-06-18T00:01:01.000Z" })).toMatchObject({
        status: "running",
        stage: "fetching",
        attempts: 1,
      })
      expect(store.completeJob(completedJob.id, { stage: "stored", completedAt: "2026-06-18T00:01:02.000Z" })).toMatchObject({
        status: "completed",
        stage: "stored",
        error: undefined,
      })

      const failedJob = store.enqueueJob({
        source: "nitter",
        target: "https://nitter.net/communalAI?page=2",
        requestHash: "job-page-2",
        stage: "timeline",
        createdAt: "2026-06-18T00:02:00.000Z",
      })
      store.startJob(failedJob.id, { stage: "fetching", startedAt: "2026-06-18T00:02:01.000Z" })
      expect(
        store.failJob(failedJob.id, "HTTP 503", {
          stage: "retryable-fetch-error",
          failedAt: "2026-06-18T00:02:02.000Z",
          retryAfterAt: "2026-06-18T00:07:02.000Z",
        }),
      ).toMatchObject({
        status: "failed",
        stage: "retryable-fetch-error",
        error: "HTTP 503",
        retryAfterAt: "2026-06-18T00:07:02.000Z",
      })

      expect(store.listJobs({ status: "completed" }).map((job) => job.id)).toEqual([completedJob.id])
      expect(store.listJobs({ status: "failed", stage: "retryable-fetch-error" }).map((job) => job.id)).toEqual([failedJob.id])

      const lowPriorityArchiveJob = store.enqueueArchiveJob({
        sourceLane: "browser-history",
        targetType: "profile",
        targetValue: "communalAI",
        priority: 1,
        createdAt: "2026-06-18T00:03:00.000Z",
        provenance: { source: "history-analysis" },
      })
      const highPriorityArchiveJob = store.enqueueArchiveJob({
        sourceLane: "browser-history",
        targetType: "status",
        targetValue: "https://x.com/communalAI/status/123",
        priority: 10,
        createdAt: "2026-06-18T00:04:00.000Z",
        options: { username: "communalAI" },
      })
      expect(store.listArchiveJobs({ status: "pending" }).map((job) => job.id)).toEqual([
        highPriorityArchiveJob.id,
        lowPriorityArchiveJob.id,
      ])
      expect(store.claimNextArchiveJob({ workerId: "test-worker", claimedAt: "2026-06-18T00:05:00.000Z" })).toMatchObject({
        id: highPriorityArchiveJob.id,
        status: "claimed",
        attempts: 1,
        claimedBy: "test-worker",
      })
      expect(store.finishArchiveJob(highPriorityArchiveJob.id, { finishedAt: "2026-06-18T00:06:00.000Z" })).toMatchObject({
        status: "completed",
        finishedAt: "2026-06-18T00:06:00.000Z",
      })
      expect(store.listArchiveJobs({ status: "pending" }).map((job) => job.id)).toEqual([lowPriorityArchiveJob.id])
      expect(store.getCounts()).toMatchObject({ rawPages: 1, captureJobs: 2, archiveJobs: 2, users: 1, tweets: 1, media: 1 })
    } finally {
      store.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("adds status columns while keeping old tweet rows readable", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-sqlite-migrate-"))
    const dbPath = join(tempDir, "archive.sqlite")
    const legacyTweet: ArchiveTweet = {
      id: "legacy-tweet-1",
      authorId: "legacy-user",
      username: "legacyUser",
      url: "https://x.com/legacyUser/status/1",
      text: "Already archived before Drizzle statuses",
      createdAt: "2026-06-17T00:00:00.000Z",
      mediaIds: [],
      capturedAt: "2026-06-18T00:00:00.000Z",
    }

    const legacyDb = new Database(dbPath)
    legacyDb.exec(`
      CREATE TABLE tweets (
        id TEXT PRIMARY KEY,
        author_id TEXT NOT NULL,
        username TEXT,
        url TEXT NOT NULL,
        created_at TEXT,
        captured_at TEXT NOT NULL,
        conversation_id TEXT,
        updated_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
    `)
    legacyDb
      .prepare(
        `INSERT INTO tweets (
          id, author_id, username, url, created_at, captured_at, conversation_id, updated_at, data_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        legacyTweet.id,
        legacyTweet.authorId,
        legacyTweet.username ?? null,
        legacyTweet.url,
        legacyTweet.createdAt ?? null,
        legacyTweet.capturedAt,
        legacyTweet.conversationId ?? null,
        legacyTweet.capturedAt,
        JSON.stringify(legacyTweet),
      )
    legacyDb.close()

    const store = initTwitterArchiveSqliteStore(dbPath)
    try {
      expect(store.getTweet(legacyTweet.id)).toEqual(legacyTweet)

      const updatedTweet: ArchiveTweet = {
        ...legacyTweet,
        publicMetrics: { likes: 3 },
        capturedAt: "2026-06-18T00:05:00.000Z",
      }
      expect(store.upsertTweets([updatedTweet]).total).toBe(1)
      expect(store.getTweet(legacyTweet.id)).toEqual(updatedTweet)
    } finally {
      store.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
