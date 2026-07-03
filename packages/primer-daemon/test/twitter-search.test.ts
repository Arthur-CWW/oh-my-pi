import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"

import { searchTwitter } from "../src/substrate/twitter"

function withTwitterDb(run: (dbPath: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "primer-twitter-search-"))
  try {
    const dbPath = join(root, "twitter-archive.sqlite")
    const db = new Database(dbPath)
    try {
      db.exec(`
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
, captured_metrics_json TEXT, lifecycle_status TEXT NOT NULL DEFAULT 'captured', thread_status TEXT NOT NULL DEFAULT 'unknown', quote_status TEXT NOT NULL DEFAULT 'unknown', quote_unavailable_reason TEXT, provenance_json TEXT, source_lane TEXT NOT NULL DEFAULT 'unknown', source_url TEXT, import_batch_id TEXT);
`)
      insertTweet(
        db,
        "t1",
        "alice",
        "2026-06-18T05:40:59.120Z",
        `${"context ".repeat(35)}spaced repetition makes review schedules visible and durable`,
      )
      insertTweet(
        db,
        "t2",
        "memorysmith",
        "2026-06-19T05:40:59.120Z",
        "A thread about notebooks and durable personal archives.",
      )
      insertTweet(
        db,
        "t3",
        "gardenbot",
        "2026-06-20T05:40:59.120Z",
        "Seedlings and irrigation notes from the greenhouse.",
      )
      insertTweet(
        db,
        "t4",
        "cyberneticist",
        "2026-06-21T05:40:59.120Z",
        "Control loops and feedback in small teams.",
      )
    } finally {
      db.close()
    }

    run(dbPath)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function insertTweet(db: Database, id: string, username: string, capturedAt: string, text: string): void {
  const dataJson = JSON.stringify({ id, username, url: `https://x.example/${username}/status/${id}`, text })
  db.query(
    `INSERT INTO tweets (id, author_id, username, url, created_at, captured_at, updated_at, data_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, `${username}-author`, username, `https://x.example/${username}/status/${id}`, capturedAt, capturedAt, capturedAt, dataJson)
}

describe("searchTwitter", () => {
  test("matches terms inside data_json text with a bounded snippet", () => {
    withTwitterDb((dbPath) => {
      const result = searchTwitter(dbPath, ["repetition"], 10)
      const hit = result.hits[0]

      expect(result.skipped).toBeUndefined()
      expect(result.hits).toHaveLength(1)
      expect(hit?.ref).toBe("twitter:tweets:t1")
      expect(hit?.snippet).toContain("repetition")
      expect((hit?.snippet ?? "").length).toBeLessThanOrEqual(240)
    })
  })

  test("matches username even when tweet text does not contain the term", () => {
    withTwitterDb((dbPath) => {
      const result = searchTwitter(dbPath, ["memorysmith"], 10)

      expect(result.hits.map((hit) => hit.ref)).toEqual(["twitter:tweets:t2"])
      expect(result.hits[0]?.title).toBe("@memorysmith")
    })
  })
})
