import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"

import { getGenerationStatsFromDb, ingestGenerationWithDb, initializeGenerationStore } from "../scripts/ingest-generation"

const FIXTURE_ROOT = new URL("fixtures/generation-staging/", import.meta.url).pathname

describe("generation ingest", () => {
  test("ingests fixture staging files idempotently and reports stats", async () => {
    const db = new Database(":memory:")
    try {
      initializeGenerationStore(db)

      const first = await ingestGenerationWithDb(db, {
        rootDir: FIXTURE_ROOT,
        storePath: ":memory:",
        now: () => new Date("2026-07-07T00:00:00.000Z"),
      })
      expect(first.files.map((file) => [file.kind, file.inserted, file.updated, file.skippedDup, file.malformed])).toEqual([
        ["annotation-rewrite", 2, 0, 0, 0],
        ["annotation-rewrite", 1, 0, 0, 0],
        ["rubric-verdict", 1, 0, 0, 0],
        ["hsk-cards", 1, 0, 0, 0],
      ])

      const second = await ingestGenerationWithDb(db, {
        rootDir: FIXTURE_ROOT,
        storePath: ":memory:",
        now: () => new Date("2026-07-07T00:01:00.000Z"),
      })
      expect(second.files.map((file) => [file.kind, file.inserted, file.updated, file.skippedDup, file.malformed])).toEqual([
        ["annotation-rewrite", 0, 0, 2, 0],
        ["annotation-rewrite", 0, 0, 1, 0],
        ["rubric-verdict", 0, 0, 1, 0],
        ["hsk-cards", 0, 0, 1, 0],
      ])

      const stats = getGenerationStatsFromDb(db, ":memory:")
      expect(stats.kinds).toEqual([
        { kind: "annotation-rewrite", batches: 2, rows: 3 },
        { kind: "rubric-verdict", batches: 1, rows: 1 },
        { kind: "hsk-cards", batches: 1, rows: 1 },
      ])
      expect(stats.tierHistograms).toEqual([
        { kind: "hsk-cards", tier: "T2", rows: 1 },
        { kind: "rubric-verdict", tier: "T3", rows: 1 },
      ])
      expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(1)
      expect(db.query<{ raw_json: string }, []>("SELECT raw_json FROM annotations LIMIT 1").get()?.raw_json).toContain(
        "un espejo y de una enciclopedia",
      )
      const hskRaw = db.query<{ raw_json: string }, []>("SELECT raw_json FROM hsk_cards LIMIT 1").get()?.raw_json
      expect(hskRaw === undefined ? undefined : JSON.parse(hskRaw).card.reason).toBe("Targets the polyphonic contrast directly.")
    } finally {
      db.close()
    }
  })
})
