import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"

import { recentTweets, searchTwitter } from "../src/substrate/twitter"

const tempDirs: string[] = []
const TEST_TMP_ROOT = new URL(".tmp/", import.meta.url).pathname

function makeTempDir(prefix: string): string {
  mkdirSync(TEST_TMP_ROOT, { recursive: true })
  return mkdtempSync(join(TEST_TMP_ROOT, prefix))
}


const TWEETS_SCHEMA = `CREATE TABLE tweets (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  username TEXT,
  url TEXT NOT NULL,
  created_at TEXT,
  captured_at TEXT NOT NULL,
  conversation_id TEXT,
  updated_at TEXT NOT NULL,
  data_json TEXT NOT NULL
, captured_metrics_json TEXT, lifecycle_status TEXT NOT NULL DEFAULT 'captured', thread_status TEXT NOT NULL DEFAULT 'unknown', quote_status TEXT NOT NULL DEFAULT 'unknown', quote_unavailable_reason TEXT, provenance_json TEXT, source_lane TEXT NOT NULL DEFAULT 'unknown', source_url TEXT, import_batch_id TEXT);`

const TWEETS_INDEX = `CREATE INDEX tweets_author_created_at_idx
  ON tweets (author_id, created_at DESC);`

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("twitter substrate search", () => {
  test("matches tweet text inside data_json and windows snippets", () => {
    const dbPath = createTwitterFixture()

    const result = searchTwitter(dbPath, ["needle"])

    expect(result.skipped).toBeUndefined()
    expect(result.hits.map((hit) => hit.ref)).toEqual([
      "twitter:tweets:3",
      "twitter:tweets:1",
    ])
    const longSnippet = result.hits.find((hit) => hit.ref === "twitter:tweets:1")?.snippet
    expect(longSnippet?.startsWith("…")).toBe(true)
    expect(longSnippet?.length).toBeLessThanOrEqual(240)
    expect(longSnippet).toContain("needle")
  })

  test("matches usernames and returns recent tweets by captured_at", () => {
    const dbPath = createTwitterFixture()

    const usernameResult = searchTwitter(dbPath, ["matuschak"])
    expect(usernameResult.hits.map((hit) => hit.ref)).toEqual(["twitter:tweets:2"])

    const recentResult = recentTweets(dbPath, 2)
    expect(recentResult.hits.map((hit) => hit.ref)).toEqual([
      "twitter:tweets:3",
      "twitter:tweets:2",
    ])
  })

  test("skips a missing twitter database", () => {
    const result = searchTwitter(join(TEST_TMP_ROOT, "missing-primer-twitter.sqlite"), ["test"])

    expect(result.hits).toEqual([])
    expect(result.skipped).toContain("missing twitter DB")
  })
})

function createTwitterFixture(): string {
  const dir = makeTempDir("primer-twitter-")
  tempDirs.push(dir)
  const dbPath = join(dir, "twitter.sqlite")
  const db = new Database(dbPath)
  try {
    db.exec(`${TWEETS_SCHEMA}\n${TWEETS_INDEX}`)
    insertTweet(db, {
      id: "1",
      username: "alice",
      text: `${"padding ".repeat(40)}needle appears after a long prefix for snippet testing`,
      capturedAt: "2026-01-01T00:00:00.000Z",
    })
    insertTweet(db, {
      id: "2",
      username: "andy_matuschak",
      text: "ordinary archived tweet",
      capturedAt: "2026-02-01T00:00:00.000Z",
    })
    insertTweet(db, {
      id: "3",
      username: "bob",
      text: "needle appears in a newer tweet",
      capturedAt: "2026-03-01T00:00:00.000Z",
    })
  } finally {
    db.close()
  }
  return dbPath
}

function insertTweet(
  db: Database,
  tweet: { id: string; username: string; text: string; capturedAt: string },
): void {
  db.query(
    `INSERT INTO tweets (id, author_id, username, url, created_at, captured_at, updated_at, data_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    tweet.id,
    `${tweet.username}-author`,
    tweet.username,
    `https://x.com/${tweet.username}/status/${tweet.id}`,
    tweet.capturedAt,
    tweet.capturedAt,
    tweet.capturedAt,
    JSON.stringify({ text: tweet.text }),
  )
}
