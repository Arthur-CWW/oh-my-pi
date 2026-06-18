import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Effect } from "effect"

import {
  appendTwitterArchiveJsonlLog,
  initTwitterArchiveSqliteStore,
  startDevUiServer,
  buildTweetGroupMarkdown,
  type ArchiveMedia,
  type ArchiveUser,
  type ArchiveTweet,
  type DevUiProfileView,
  type DevUiState,
  type SqliteArchiveJob,
  type RunningDevUiServer,
} from "../src"

describe("Twitter archive dev UI server", () => {
  test("serves health and SQLite-derived archive state", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-dev-ui-"))
    const dbPath = join(tempDir, "archive.sqlite")
    const logPath = join(tempDir, "twitter-archive.jsonl")
    const mediaRoot = join(tempDir, "media")
    const imagePath = join(mediaRoot, "images", "media.png")
    const imageBytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
      31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0,
      0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ])
    await mkdir(join(mediaRoot, "images"), { recursive: true })
    await writeFile(imagePath, imageBytes)
    const port = 31_000 + Math.floor(Math.random() * 8_000)
    let server: RunningDevUiServer | undefined

    const store = initTwitterArchiveSqliteStore(dbPath)
    try {
      const user: ArchiveUser = {
        id: "user-1",
        username: "communalAI",
        displayName: "Communal AI",
        profileUrl: "https://x.com/communalAI",
        description: "Local public archive seed",
        capturedAt: "2026-06-18T00:00:00.000Z",
      }
      const quotedUser: ArchiveUser = {
        id: "user-quoted",
        username: "teortaxes",
        displayName: "T. E. Ortaxes",
        profileUrl: "https://x.com/teortaxes",
        capturedAt: "2026-06-17T23:59:00.000Z",
      }
      const parentTweet: ArchiveTweet = {
        id: "tweet-1",
        authorId: "user-1",
        username: "communalAI",
        url: "https://x.com/communalAI/status/1",
        text: "Parent tweet",
        createdAt: "2026-06-18T00:00:00.000Z",
        conversationId: "thread-1",
        mediaIds: ["media-1"],
        quotedTweetId: "quoted-1",
        quotedTweetUrl: "https://x.com/teortaxes/status/quoted-1",
        capturedAt: "2026-06-18T00:00:01.000Z",
        source: "tool",
      }
      const replyTweet: ArchiveTweet = {
        id: "tweet-2",
        authorId: "user-1",
        username: "communalAI",
        url: "https://x.com/communalAI/status/2",
        text: "Reply tweet",
        createdAt: "2026-06-18T00:01:00.000Z",
        conversationId: "thread-1",
        inReplyToTweetId: "tweet-1",
        mediaIds: [],
        capturedAt: "2026-06-18T00:01:01.000Z",
        source: "tool",
      }
      const externalReplyTweet: ArchiveTweet = {
        id: "tweet-3",
        authorId: "user-1",
        username: "communalAI",
        url: "https://x.com/communalAI/status/3",
        text: "Reply to another account",
        createdAt: "2026-06-18T00:00:20.000Z",
        conversationId: "external-thread",
        inReplyToTweetId: "other-1",
        replyToUsername: "otherUser",
        mediaIds: [],
        capturedAt: "2026-06-18T00:00:21.000Z",
        source: "tool",
      }
      const unresolvedQuoteTweet: ArchiveTweet = {
        id: "tweet-4",
        authorId: "user-1",
        username: "communalAI",
        url: "https://x.com/communalAI/status/4",
        text: "Quote reference without stored content",
        createdAt: "2026-06-18T00:00:30.000Z",
        quotedTweetId: "missing-quote",
        quotedTweetUrl: "https://x.com/missing/status/missing-quote",
        mediaIds: [],
        capturedAt: "2026-06-18T00:00:31.000Z",
        source: "tool",
      }
      const quotedTweet: ArchiveTweet = {
        id: "quoted-1",
        authorId: "user-quoted",
        username: "teortaxes",
        url: "https://x.com/teortaxes/status/quoted-1",
        text: "Actual stored quoted text",
        createdAt: "2026-06-17T23:59:30.000Z",
        mediaIds: ["quote-media-1"],
        publicMetrics: { replies: 1, reposts: 2, likes: 3, quotes: 4, views: 50 },
        capturedAt: "2026-06-18T00:00:00.500Z",
        source: "tool",
      }
      const media: ArchiveMedia = {
        id: "media-1",
        tweetId: "tweet-1",
        type: "image",
        remoteUrl: "https://example.test/media.png",
        localPath: imagePath,
        capturedAt: "2026-06-18T00:00:02.000Z",
        source: "tool",
      }
      const quoteMedia: ArchiveMedia = {
        id: "quote-media-1",
        tweetId: "quoted-1",
        type: "image",
        remoteUrl: "https://example.test/quote-media.png",
        localPath: imagePath,
        altText: "quoted media",
        capturedAt: "2026-06-18T00:00:00.600Z",
        source: "tool",
      }

      store.upsertUsers([user, quotedUser])
      store.upsertTweets([parentTweet, replyTweet, externalReplyTweet, unresolvedQuoteTweet, quotedTweet])
      store.upsertMedia([media, quoteMedia])
      store.upsertTweetTimelineProvenance([
        {
          tweetId: "tweet-1",
          sourceLane: "nitter",
          observedAt: "2026-06-18T00:00:05.000Z",
          retweetedByUsername: "communalAI",
          retweetedByDisplayName: "Communal AI",
        },
      ])
      store.enqueueJob({ source: "nitter", target: "@communalAI", requestHash: "job-hash", stage: "timeline" })
      store.enqueueArchiveJob({
        sourceLane: "browser-history",
        targetType: "profile",
        targetValue: "communalAI",
        priority: 3,
        createdAt: "2026-06-18T00:02:00.000Z",
      })
    } finally {
      store.close()
    }

    await appendTwitterArchiveJsonlLog(logPath, {
      component: "test",
      level: "info",
      event: "seeded",
      details: { account: "communalAI" },
    })

    try {
      server = await Effect.runPromise(
        startDevUiServer({
          env: {
            TWITTER_ARCHIVE_DB: dbPath,
            TWITTER_ARCHIVE_LOG: logPath,
            TWITTER_ARCHIVE_PORT: String(port),
            TWITTER_ARCHIVE_MEDIA_ROOT: mediaRoot,
          },
        }),
      )

      const health = (await fetch(`${server.url}/api/health`).then((response) => response.json())) as { ok: boolean }
      expect(health.ok).toBe(true)


      const html = await fetch(server.url).then((response) => response.text())
      expect(html).toContain("/assets/dev-ui.css")
      expect(html).not.toContain("<style>")

      const stylesheet = await fetch(`${server.url}/assets/dev-ui.css`).then((response) => response.text())
      expect(stylesheet).toContain(".controls-panel[hidden]")
      expect(stylesheet).toContain(".media-grid-count-4")
      expect(stylesheet).toContain(".quote-card-resolved")
      expect(stylesheet).toContain(".quote-card-unresolved")
      const clientScript = await fetch(`${server.url}/assets/dev-ui-client.js`).then((response) => response.text())
      expect(clientScript).toContain("author-button")
      expect(clientScript).toContain("profile=")
      expect(clientScript).toContain("Move selected tweet group down")
      expect(clientScript).toContain("quote-card-resolved")
      expect(clientScript).toContain("media-grid")
      expect(clientScript).toContain("retweet-context")
      expect(clientScript).toContain("controlsExpanded = false")
      expect(clientScript).toContain("controlsElement.hidden = activeLane !== \"tweets\" || !controlsExpanded")
      expect(clientScript).toContain("Toggle filters (f), open search (/)")
      expect(clientScript).toContain("Toggle search and filters")
      expect(clientScript).toContain("Copy selected tweet/thread Markdown")
      expect(clientScript).toContain("Sort")
      const state = (await fetch(`${server.url}/api/state`).then((response) => response.json())) as DevUiState
      expect(state.summary.counts.tweets).toBe(5)
      expect(state.summary.counts.media).toBe(2)
      expect(state.summary.jobs.pending).toBe(1)
      expect(state.summary.counts.users).toBe(2)
      expect(state.summary.counts.archiveJobs).toBe(1)
      expect(state.users).toHaveLength(2)
      expect(state.users[0]?.id).toBe("user-1")
      expect(state.users[0]?.displayName).toBe("Communal AI")
      expect(state.users[0]?.tweetCount).toBe(4)
      expect(state.users[0]?.latestTweetAt).toBe("2026-06-18T00:01:00.000Z")
      const users = (await fetch(`${server.url}/api/users`).then((response) => response.json())) as DevUiState["users"]
      expect(users[0]?.username).toBe("communalAI")
      expect(users[0]?.tweetCount).toBe(4)
      const profile = (await fetch(`${server.url}/api/profile?userId=user-1`).then((response) => response.json())) as DevUiProfileView
      expect(profile.user.displayName).toBe("Communal AI")
      expect(profile.user.tweetCount).toBe(4)
      expect(profile.tweetGroups).toHaveLength(3)
      const profileThread = profile.tweetGroups.find((group) => group.tweets.some((tweet) => tweet.id === "tweet-1"))
      expect(profileThread?.tweets.map((tweet) => tweet.id)).toEqual(["tweet-1", "tweet-2"])
      expect(state.tweetGroups).toHaveLength(4)
      const threadGroup = state.tweetGroups.find((group) => group.tweets.some((tweet) => tweet.id === "tweet-1"))
      expect(threadGroup?.kind).toBe("thread")
      expect(threadGroup?.tweets.map((tweet) => tweet.id)).toEqual(["tweet-1", "tweet-2"])
      const externalReplyGroup = state.tweetGroups.find((group) => group.tweets.some((tweet) => tweet.id === "tweet-3"))
      expect(externalReplyGroup?.kind).toBe("reply")
      expect(externalReplyGroup?.tweets).toHaveLength(1)
      expect(externalReplyGroup?.tweets[0]?.replyToUsername).toBe("otherUser")
      const unresolvedQuoteView = state.tweetGroups.flatMap((group) => group.tweets).find((tweet) => tweet.id === "tweet-4")
      expect(unresolvedQuoteView?.quotedTweetId).toBe("missing-quote")
      expect(unresolvedQuoteView?.quotedTweet).toBeUndefined()
      const parentView = threadGroup?.tweets[0]
      expect(parentView?.retweetedBy).toEqual({ username: "communalAI", displayName: "Communal AI" })
      expect({
        thread: {
          kind: threadGroup?.kind,
          tweetIds: threadGroup?.tweets.map((tweet) => tweet.id),
        },
        externalReply: {
          kind: externalReplyGroup?.kind,
          tweetIds: externalReplyGroup?.tweets.map((tweet) => tweet.id),
          replyingTo: externalReplyGroup?.tweets[0]?.replyToUsername,
        },
        unresolvedQuote: {
          quotedTweetId: unresolvedQuoteView?.quotedTweetId,
          hasQuotedTweet: Boolean(unresolvedQuoteView?.quotedTweet),
        },
        retweet: parentView?.retweetedBy,
      }).toMatchSnapshot()
      expect(parentView?.media[0]?.downloadStatus).toBe("downloaded")
      expect(parentView?.quotedTweetId).toBe("quoted-1")
      expect(parentView?.quotedTweetUrl).toBe("https://x.com/teortaxes/status/quoted-1")
      expect(parentView?.quotedTweet?.username).toBe("teortaxes")
      expect(parentView?.quotedTweet?.displayName).toBe("T. E. Ortaxes")
      expect(parentView?.quotedTweet?.text).toBe("Actual stored quoted text")
      expect(parentView?.quotedTweet?.publicMetrics?.likes).toBe(3)
      expect(parentView?.quotedTweet?.media[0]?.id).toBe("quote-media-1")
      expect(parentView?.quotedTweet?.media[0]?.downloadStatus).toBe("downloaded")
      const primaryMedia = state.media.find((entry) => entry.id === "media-1")
      expect(primaryMedia?.previewUrl?.startsWith("/media-file?path=")).toBe(true)
      expect(parentView?.media[0]?.previewUrl).toBe(primaryMedia?.previewUrl)

      const previewUrl = primaryMedia?.previewUrl
      if (!previewUrl) throw new Error("Expected local media preview URL")
      const mediaResponse = await fetch(`${server.url}${previewUrl}`)
      expect(mediaResponse.status).toBe(200)
      expect(mediaResponse.headers.get("content-type")).toBe("image/png")
      expect(Array.from(new Uint8Array(await mediaResponse.arrayBuffer()))).toEqual(Array.from(imageBytes))

      const traversalResponse = await fetch(`${server.url}/media-file?path=${encodeURIComponent(join(mediaRoot, "..", "outside.png"))}`)
      expect(traversalResponse.status).toBe(403)

      const archiveJobs = (await fetch(`${server.url}/api/archive-jobs`).then((response) => response.json())) as SqliteArchiveJob[]
      expect(archiveJobs.map((job) => [job.sourceLane, job.targetType, job.targetValue])).toEqual([
        ["browser-history", "profile", "communalAI"],
      ])
      const enqueueResponse = await fetch(`${server.url}/api/archive-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceLane: "browser-history",
          targetType: "status",
          targetValue: "https://x.com/communalAI/status/123",
          priority: 5,
        }),
      })
      expect(enqueueResponse.status).toBe(202)
      const statusJobs = (await fetch(`${server.url}/api/archive-jobs?targetType=status`).then((response) => response.json())) as SqliteArchiveJob[]
      expect(statusJobs[0]).toMatchObject({
        sourceLane: "browser-history",
        targetType: "status",
        targetValue: "https://x.com/communalAI/status/123",
        status: "pending",
      })

      const noteResponse = await fetch(`${server.url}/api/tweet-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tweetId: "tweet-1", note: "local note" }),
      })
      expect(noteResponse.status).toBe(202)
      const attributeResponse = await fetch(`${server.url}/api/tweet-attributes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tweetId: "tweet-1", attribute: "bookmark", value: true }),
      })
      expect(attributeResponse.status).toBe(202)
      const annotatedState = (await fetch(`${server.url}/api/state`).then((response) => response.json())) as DevUiState
      expect(annotatedState.tweetGroups[0]?.tweets[0]?.annotation.note).toBe("local note")
      expect(annotatedState.tweetGroups[0]?.tweets[0]?.annotation.bookmarked).toBe(true)
      const clearAttributeResponse = await fetch(`${server.url}/api/tweet-attributes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tweetId: "tweet-1", attribute: "bookmark", value: false }),
      })
      expect(clearAttributeResponse.status).toBe(202)
      const clearedState = (await fetch(`${server.url}/api/state`).then((response) => response.json())) as DevUiState
      expect(clearedState.tweetGroups[0]?.tweets[0]?.annotation.bookmarked).toBe(false)
      expect(state.events.some((event) => event.event === "seeded")).toBe(true)
    } finally {
      await server?.stop()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("ingests x-bookmark-sync snapshots into archive jobs and Markdown", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-x-sync-"))
    const dbPath = join(tempDir, "archive.sqlite")
    const logPath = join(tempDir, "twitter-archive.jsonl")
    const mediaRoot = join(tempDir, "media")
    const port = 31_000 + Math.floor(Math.random() * 8_000)
    let server: RunningDevUiServer | undefined

    try {
      server = await Effect.runPromise(
        startDevUiServer({
          env: {
            TWITTER_ARCHIVE_DB: dbPath,
            TWITTER_ARCHIVE_LOG: logPath,
            TWITTER_ARCHIVE_PORT: String(port),
            TWITTER_ARCHIVE_MEDIA_ROOT: mediaRoot,
          },
        }),
      )

      const snapshot = {
        source: {
          extension: "x-bookmark-sync-devtools",
          version: "0.1.0",
          inspectedTabId: 42,
        },
        generatedAt: "2026-06-18T00:10:00.000Z",
        incremental: true,
        captures: [
          {
            id: "capture-1",
            capturedAt: "2026-06-18T00:10:01.000Z",
            inspectedTabId: 42,
            request: {
              method: "GET",
              url: "https://x.com/i/api/graphql/bookmarks",
              headers: [{ name: "authorization", value: "Bearer private-token" }],
              postData: "auth_token=private",
            },
            response: {
              status: 200,
              statusText: "OK",
              mimeType: "application/json",
              bodySize: 512,
              encoding: "utf8",
              headers: [
                { name: "content-type", value: "application/json" },
                { name: "set-cookie", value: "auth_token=private" },
              ],
            },
            timing: {
              startedDateTime: "2026-06-18T00:10:00.900Z",
              time: 25,
            },
            tags: ["bookmarks", "tweet-like"],
            tweetLike: [
              {
                rest_id: "12345",
                id_str: "12345",
                full_text: "Captured bookmark tweet",
                created_at: "Wed Jun 17 20:00:00 +0000 2026",
                screen_name: "communalAI",
                path: "data.tweet",
              },
            ],
            body: JSON.stringify({ token: "private-token", url: "https://x.com/communalAI/status/12345" }),
          },
        ],
      }

      const ingestResponse = await fetch(`${server.url}/api/x-bookmark-sync/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      })
      expect(ingestResponse.status).toBe(202)
      expect(await ingestResponse.json()).toMatchObject({
        capturesReceived: 1,
        tweetLikeRecords: 1,
        archiveJobsEnqueued: 1,
        markdownFilesWritten: 2,
      })

      const archiveJobs = (await fetch(`${server.url}/api/archive-jobs?targetType=status`).then((response) => response.json())) as SqliteArchiveJob[]
      expect(archiveJobs).toHaveLength(1)
      expect(archiveJobs[0]).toMatchObject({
        sourceLane: "x-bookmark-sync-devtools",
        targetType: "status",
        targetValue: "https://x.com/communalAI/status/12345",
        status: "pending",
      })

      const state = (await fetch(`${server.url}/api/state`).then((response) => response.json())) as DevUiState
      const tweet = state.tweetGroups.flatMap((group) => group.tweets).find((entry) => entry.id === "12345")
      expect(tweet).toMatchObject({
        username: "communalAI",
        url: "https://x.com/communalAI/status/12345",
        text: "Captured bookmark tweet",
      })

      const tweetMarkdown = await readFile(join(tempDir, "markdown", "bookmarks", "communalai-12345.md"), "utf8")
      expect(tweetMarkdown).toContain("Captured bookmark tweet")
      expect(tweetMarkdown).toContain("- URL: https://x.com/communalAI/status/12345")
      expect(tweetMarkdown).toContain("- Source: x-bookmark-sync-devtools")
      expect(tweetMarkdown).toContain("- Captured at: 2026-06-18T00:10:01.000Z")
      expect(tweetMarkdown).toContain("- Request URL: https://x.com/i/api/graphql/bookmarks")
      expect(tweetMarkdown).not.toContain("private-token")
      expect(tweetMarkdown).not.toContain("auth_token")

      const indexMarkdown = await readFile(join(tempDir, "markdown", "bookmarks", "index.md"), "utf8")
      expect(indexMarkdown).toContain("[@communalAI status 12345](communalai-12345.md)")

      const rawDb = new Database(dbPath, { readonly: true })
      try {
        const rawPage = rawDb.query("SELECT headers_json, body FROM raw_pages").get() as { headers_json: string; body: string }
        expect(rawPage.headers_json).toContain("[REDACTED]")
        expect(rawPage.body).toContain("[REDACTED]")
        expect(rawPage.body).not.toContain("private-token")
        expect(rawPage.body).not.toContain("auth_token")
      } finally {
        rawDb.close()
      }
    } finally {
      await server?.stop()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("builds Markdown for selected tweet groups", () => {
    const markdown = buildTweetGroupMarkdown({
      groupId: "thread-1",
      kind: "reply",
      title: "Thread from @communalAI",
      latestAt: "2026-06-18T00:01:00.000Z",
      tweets: [
        {
          id: "tweet-1",
          authorId: "user-1",
          username: "communalAI",
          url: "https://x.com/communalAI/status/1",
          text: "Parent tweet",
          createdAt: "2026-06-18T00:00:00.000Z",
          conversationId: "thread-1",
          mediaIds: ["media-1"],
          media: [
            {
              id: "media-1",
              tweetId: "tweet-1",
              type: "image",
              localPath: "/archive/media.png",
              remoteUrl: "https://example.test/media.png",
              downloadStatus: "downloaded",
              capturedAt: "2026-06-18T00:00:02.000Z",
              source: "tool",
            },
          ],
          quotedTweetId: "quoted-1",
          quotedTweetUrl: "https://x.com/teortaxes/status/quoted-1",
          quotedTweet: {
            id: "quoted-1",
            authorId: "user-quoted",
            username: "teortaxes",
            displayName: "T. E. Ortaxes",
            url: "https://x.com/teortaxes/status/quoted-1",
            text: "Actual stored quoted text",
            createdAt: "2026-06-17T23:59:30.000Z",
            mediaIds: [],
            media: [],
            publicMetrics: { replies: 1, reposts: 2, likes: 3, quotes: 4, views: 50 },
            capturedAt: "2026-06-18T00:00:00.500Z",
            source: "tool",
          },
          publicMetrics: { replies: 5, reposts: 6, likes: 7, quotes: 8, views: 90 },
          capturedAt: "2026-06-18T00:00:01.000Z",
          source: "tool",
          replyDepth: 0,
          annotation: { tweetId: "tweet-1", note: "local note", bookmarked: true, attributed: true },
        },
        {
          id: "tweet-2",
          authorId: "user-1",
          username: "communalAI",
          url: "https://x.com/communalAI/status/2",
          text: "Reply tweet",
          createdAt: "2026-06-18T00:01:00.000Z",
          conversationId: "thread-1",
          inReplyToTweetId: "tweet-1",
          mediaIds: [],
          media: [],
          capturedAt: "2026-06-18T00:01:01.000Z",
          source: "tool",
          replyDepth: 1,
          annotation: { tweetId: "tweet-2", bookmarked: false, attributed: false },
        },
      ],
    })

    expect(markdown).toContain("# Thread from @communalAI")
    expect(markdown).toContain("- URL: https://x.com/communalAI/status/1")
    expect(markdown).toContain("- Metrics: replies 5 · reposts 6 · likes 7 · quotes 8 · views 90")
    expect(markdown).toContain("- image; local /archive/media.png; remote https://example.test/media.png")
    expect(markdown).toContain("Actual stored quoted text")
    expect(markdown).toContain("Reply tweet")
    expect(markdown).toContain("- Local annotations: local bookmark; archive attribute; note: local note")
  })

  test("ingests x-bookmark-sync capture signals", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-x-signals-"))
    const dbPath = join(tempDir, "archive.sqlite")
    const logPath = join(tempDir, "twitter-archive.jsonl")
    const mediaRoot = join(tempDir, "media")
    const port = 31_000 + Math.floor(Math.random() * 8_000)
    let server: RunningDevUiServer | undefined

    try {
      server = await Effect.runPromise(
        startDevUiServer({
          env: {
            TWITTER_ARCHIVE_DB: dbPath,
            TWITTER_ARCHIVE_LOG: logPath,
            TWITTER_ARCHIVE_PORT: String(port),
            TWITTER_ARCHIVE_MEDIA_ROOT: mediaRoot,
          },
        }),
      )

      const snapshot = {
        source: {
          extension: "x-bookmark-sync-devtools",
          version: "0.2.0",
          inspectedTabId: 7,
        },
        generatedAt: "2026-06-18T01:00:00.000Z",
        captures: [
          {
            id: "capture-signal-1",
            capturedAt: "2026-06-18T01:00:01.000Z",
            inspectedTabId: 7,
            request: {
              method: "GET",
              url: "https://x.com/communalAI/status/98765",
            },
            response: {
              status: 200,
              statusText: "OK",
              mimeType: "text/html",
              headers: [{ name: "content-type", value: "text/html" }],
            },
            tags: ["signal-test"],
            visibleTweets: [
              {
                fullText: "Signal test tweet",
                url: "https://x.com/communalAI/status/98765",
                username: "communalAI",
              },
            ],
            signals: [
              {
                signalId: "sig-1",
                kind: "tweet_visible",
                observedAt: "2026-06-18T01:00:02.000Z",
                pageUrl: "https://x.com/communalAI/status/98765",
                tweetId: "98765",
                profileHandle: "communalAI",
                confidence: 0.9,
              },
            ],
          },
        ],
        signals: [
          {
            signalId: "sig-global-1",
            kind: "tab_visible",
            observedAt: "2026-06-18T01:00:00.000Z",
            pageUrl: "https://x.com/home",
          },
        ],
      }

      const ingestResponse = await fetch(`${server.url}/api/x-bookmark-sync/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      })
      expect(ingestResponse.status).toBe(202)
      expect(await ingestResponse.json()).toMatchObject({
        capturesReceived: 1,
        signalsReceived: 2,
      })

      const rawDb = new Database(dbPath, { readonly: true })
      try {
        const rows = rawDb
          .query("SELECT id, kind, observed_at, page_url, tweet_id, profile_handle, confidence FROM interaction_signals ORDER BY observed_at")
          .all() as Array<{
            id: string
            kind: string
            observed_at: string
            page_url: string | null
            tweet_id: string | null
            profile_handle: string | null
            confidence: number | null
          }>
        expect(rows).toHaveLength(2)
        expect(rows[0]).toMatchObject({
          id: "sig-global-1",
          kind: "tab_visible",
          page_url: "https://x.com/home",
        })
        expect(rows[1]).toMatchObject({
          id: "sig-1",
          kind: "tweet_visible",
          tweet_id: "98765",
          profile_handle: "communalAI",
          confidence: 0.9,
        })
      } finally {
        rawDb.close()
      }
    } finally {
      await server?.stop()
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
