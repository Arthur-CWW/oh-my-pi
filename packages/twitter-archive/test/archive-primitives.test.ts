import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  appendJsonl,
  archivePaths,
  createArchiveRun,
  dedupeById,
  ensureArchiveLayout,
  JsonlParseError,
  parseLocalSearchQuery,
  readJsonl,
  readJsonlById,
  resolveArchiveRoot,
  sanitizeArchiveTarget,
  tweetMatchesSearch,
  upsertJsonlById,
  writePlannedArchiveRun,
  type ArchiveMedia,
  type ArchiveRun,
  type ArchiveTweet,
} from "../src"

interface FixtureRecord {
  id: string
  value: number
}

describe("archive path helpers", () => {
  test("sanitize target names and create the local archive layout", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-paths-"))
    try {
      expect(sanitizeArchiveTarget("@Pleometric Media!!")).toBe("pleometric-media")
      expect(() => sanitizeArchiveTarget(" @@@ ")).toThrow("Archive target cannot be empty")

      const root = resolveArchiveRoot({ baseDir: tempDir, target: "@Pleometric" })
      expect(root).toBe(join(tempDir, "pleometric"))

      const paths = archivePaths(root)
      expect(paths.entityFiles.archiveRuns).toBe(join(root, "entities", "archive-runs.jsonl"))
      expect(paths.rawFrontendDir).toBe(join(root, "raw", "frontend"))
      expect(paths.videosDir).toBe(join(root, "media", "videos"))

      await ensureArchiveLayout(paths)
      for (const dir of [
        paths.rawFrontendDir,
        paths.rawToolRunsDir,
        paths.rawApiDir,
        paths.entitiesDir,
        paths.imagesDir,
        paths.videosDir,
        paths.indexesDir,
        paths.cacheDir,
        paths.logsDir,
      ]) {
        expect((await stat(dir)).isDirectory()).toBe(true)
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

describe("JSONL helpers", () => {
  test("read, append, upsert, map by id, and dedupe records", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-jsonl-"))
    try {
      const filePath = join(tempDir, "entities", "tweets.jsonl")

      expect(await readJsonl<FixtureRecord>(filePath)).toEqual([])

      await appendJsonl(filePath, { id: "a", value: 1 })
      await appendJsonl(filePath, [
        { id: "b", value: 2 },
        { id: "a", value: 3 },
      ])

      expect(await readJsonl<FixtureRecord>(filePath)).toEqual([
        { id: "a", value: 1 },
        { id: "b", value: 2 },
        { id: "a", value: 3 },
      ])
      expect(dedupeById(await readJsonl<FixtureRecord>(filePath))).toEqual([
        { id: "a", value: 3 },
        { id: "b", value: 2 },
      ])

      expect(
        await upsertJsonlById(filePath, [
          { id: "b", value: 20 },
          { id: "c", value: 30 },
        ]),
      ).toEqual({ inserted: 1, updated: 1, total: 3 })

      expect(await readJsonl<FixtureRecord>(filePath)).toEqual([
        { id: "a", value: 3 },
        { id: "b", value: 20 },
        { id: "c", value: 30 },
      ])

      const byId = await readJsonlById<FixtureRecord>(filePath)
      expect(byId.get("b")).toEqual({ id: "b", value: 20 })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("reports JSONL parse line numbers", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-jsonl-error-"))
    try {
      const filePath = join(tempDir, "bad.jsonl")
      await writeFile(filePath, '{"id":"ok"}\nnot-json\n')

      try {
        await readJsonl<FixtureRecord>(filePath)
        throw new Error("Expected JSONL parse to fail")
      } catch (error) {
        expect(error).toBeInstanceOf(JsonlParseError)
        expect((error as JsonlParseError).lineNumber).toBe(2)
        expect((error as JsonlParseError).filePath).toBe(filePath)
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

describe("local search query parsing and matching", () => {
  const videoMedia = new Map<string, ArchiveMedia>([
    ["m-video", { id: "m-video", tweetId: "t-1", type: "video" }],
    ["m-image", { id: "m-image", tweetId: "t-2", type: "image" }],
  ])

  const baseTweet: ArchiveTweet = {
    id: "t-1",
    authorId: "u-pleometric",
    username: "pleometric",
    url: "https://x.com/pleometric/status/1",
    text: "Automation ate the post labor market. The underclass is permanent, anon.",
    createdAt: "2025-06-01T12:00:00.000Z",
    mediaIds: ["m-video"],
    capturedAt: "2026-06-03T00:00:00.000Z",
  }

  test("parses supported Twitter-style local operators", () => {
    expect(
      parseLocalSearchQuery(
        'from:@Pleometric to:@SomeUser since:2025-01-01 until:2026-01-01 filter:videos filter:media label:keeper category:brainrot has:note "post labor" automation',
      ),
    ).toEqual({
      from: "pleometric",
      to: "someuser",
      since: "2025-01-01",
      until: "2026-01-01",
      filters: ["videos", "media"],
      labels: ["keeper"],
      categories: ["brainrot"],
      hasNote: true,
      phrases: ["post labor"],
      terms: ["automation"],
    })
  })

  test("matches text, dates, authors, replies, quotes, and media filters", () => {
    expect(tweetMatchesSearch(baseTweet, parseLocalSearchQuery('from:pleometric filter:videos "post labor"'), videoMedia)).toBe(
      true,
    )
    expect(tweetMatchesSearch(baseTweet, parseLocalSearchQuery("from:someoneelse filter:videos"), videoMedia)).toBe(false)
    expect(tweetMatchesSearch(baseTweet, parseLocalSearchQuery("until:2025-01-01"), videoMedia)).toBe(false)
    expect(tweetMatchesSearch(baseTweet, parseLocalSearchQuery("filter:images"), videoMedia)).toBe(false)

    const replyTweet: ArchiveTweet = {
      ...baseTweet,
      id: "t-reply",
      inReplyToTweetId: "t-parent",
      replyToUsername: "someuser",
    }
    expect(tweetMatchesSearch(replyTweet, parseLocalSearchQuery("to:@SomeUser filter:replies"), videoMedia)).toBe(true)

    const quoteTweet: ArchiveTweet = {
      ...baseTweet,
      id: "t-quote",
      quotedTweetId: "t-quoted",
    }
    expect(tweetMatchesSearch(quoteTweet, parseLocalSearchQuery("filter:quotes"), videoMedia)).toBe(true)
  })
})

describe("planned archive run records", () => {
  test("create and persist planned run records without scraping", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-runs-"))
    try {
      const paths = archivePaths(resolveArchiveRoot({ baseDir: tempDir, target: "pleometric" }))
      const startedAt = "2026-06-03T01:02:03.000Z"
      const run = createArchiveRun({
        target: "pleometric",
        query: "from:pleometric filter:videos",
        source: "tool",
        tool: "unit-test",
        scope: { replies: false },
        startedAt,
      })

      expect(run.id).toMatch(/^run_20260603010203_[a-f0-9]{10}$/)
      expect(run.status).toBe("planned")
      expect(run.scope).toEqual({ tweets: true, replies: false, quotes: true, media: true, excludeLikesBookmarks: true })
      expect(run.tweetIds).toEqual([])
      expect(run.userIds).toEqual([])
      expect(run.mediaIds).toEqual([])

      const first = await writePlannedArchiveRun(paths, { ...run, id: run.id })
      expect(first.filePath).toBe(paths.entityFiles.archiveRuns)
      expect(first.inserted).toBe(1)
      expect(first.updated).toBe(0)

      const saved = await readJsonl<ArchiveRun>(paths.entityFiles.archiveRuns)
      expect(saved).toEqual([run])

      const second = await writePlannedArchiveRun(paths, { ...run, id: run.id })
      expect(second.inserted).toBe(0)
      expect(second.updated).toBe(1)
      expect(second.total).toBe(1)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
