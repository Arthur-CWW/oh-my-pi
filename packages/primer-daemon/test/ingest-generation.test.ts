import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getGenerationStatsFromDb, ingestGenerationWithDb, initializeGenerationStore } from "../scripts/ingest-generation"
import type { IngestGenerationResult } from "../scripts/ingest-generation"

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
      expect(second.files.every((file) => file.deleted === 0)).toBe(true)

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
      expect(
        db
          .query<{ prompt_version: string | null }, [string]>(
            "SELECT prompt_version FROM generation_batches WHERE source_file LIKE ?",
          )
          .get("%accelerando-v2-2026-07-06/%")?.prompt_version,
      ).toBe("accelerando-v2-2026-07-06")
    } finally {
      db.close()
    }
  })
})

interface TestCard {
  type: string
  front: string
  back: string
  retrievalTarget: string
  tier: string
}

const HSK_REL = "streams/primer/hsk-cards/gen-2026-07-06"
const ANNOTATION_REL = "streams/primer/wrapped-commentary-reader/artifacts/generation/quality-pass-2026-07-06"

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "primer-ingest-recon-"))
}

function writeHskFile(root: string, cards: TestCard[]): void {
  const dir = join(root, HSK_REL)
  mkdirSync(dir, { recursive: true })
  const entry = { word: "将", pinyin: "jiàng", gloss: "general; to command", cards }
  writeFileSync(join(dir, "hsk5-recon.json"), JSON.stringify([entry]))
}

function writeAnnotationFile(root: string, annotations: Array<{ ann_id: string; note: string }>): void {
  const dir = join(root, ANNOTATION_REL)
  mkdirSync(dir, { recursive: true })
  const envelope = { slice: "a", unit_batches: [{ unit_key: "u-001", annotations }] }
  writeFileSync(join(dir, "slice-a.json"), JSON.stringify(envelope))
}

function hskResult(result: IngestGenerationResult): IngestGenerationResult["files"][number] {
  const file = result.files.find((entry) => entry.kind === "hsk-cards")
  if (file === undefined) throw new Error("expected an hsk-cards file result")
  return file
}

function hskRowCount(db: Database): number {
  return db.query<{ count: number }, []>("SELECT count(*) AS count FROM hsk_cards").get()?.count ?? 0
}

function hskFronts(db: Database): string[] {
  return db.query<{ front: string }, []>("SELECT front FROM hsk_cards ORDER BY front").all().map((row) => row.front)
}

const cardA1: TestCard = { type: "disambiguation", front: "front-A-v1", back: "back A", retrievalTarget: "target A", tier: "T2" }
const cardA2: TestCard = { type: "disambiguation", front: "front-A-v2", back: "back A", retrievalTarget: "target A", tier: "T2" }
const cardB: TestCard = { type: "production", front: "front-B", back: "back B", retrievalTarget: "target B", tier: "T2" }

describe("generation ingest reconciliation", () => {
  test("re-ingest after a card front changes drops the stale row and keeps the file count", async () => {
    const root = makeRoot()
    const db = new Database(":memory:")
    try {
      initializeGenerationStore(db)
      writeHskFile(root, [cardA1, cardB])
      await ingestGenerationWithDb(db, { rootDir: root, storePath: ":memory:" })
      expect(hskRowCount(db)).toBe(2)

      writeHskFile(root, [cardA2, cardB])
      const second = hskResult(await ingestGenerationWithDb(db, { rootDir: root, storePath: ":memory:" }))
      expect(second).toMatchObject({ inserted: 1, updated: 0, skippedDup: 1, deleted: 1, malformed: 0 })

      expect(hskRowCount(db)).toBe(2)
      expect(hskFronts(db)).toEqual(["front-A-v2", "front-B"])
    } finally {
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("re-ingest after a card is removed from the file deletes its row", async () => {
    const root = makeRoot()
    const db = new Database(":memory:")
    try {
      initializeGenerationStore(db)
      writeHskFile(root, [cardA1, cardB])
      await ingestGenerationWithDb(db, { rootDir: root, storePath: ":memory:" })
      expect(hskRowCount(db)).toBe(2)

      writeHskFile(root, [cardA1])
      const second = hskResult(await ingestGenerationWithDb(db, { rootDir: root, storePath: ":memory:" }))
      expect(second).toMatchObject({ inserted: 0, updated: 0, skippedDup: 1, deleted: 1, malformed: 0 })

      expect(hskRowCount(db)).toBe(1)
      expect(hskFronts(db)).toEqual(["front-A-v1"])
    } finally {
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("unchanged re-ingest deletes nothing and skips every row as a duplicate", async () => {
    const root = makeRoot()
    const db = new Database(":memory:")
    try {
      initializeGenerationStore(db)
      writeHskFile(root, [cardA1, cardB])
      await ingestGenerationWithDb(db, { rootDir: root, storePath: ":memory:" })

      const second = hskResult(await ingestGenerationWithDb(db, { rootDir: root, storePath: ":memory:" }))
      expect(second).toMatchObject({ inserted: 0, updated: 0, skippedDup: 2, deleted: 0, malformed: 0 })
      expect(hskRowCount(db)).toBe(2)
    } finally {
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("re-ingest after an annotation is removed deletes the orphaned annotation row", async () => {
    const root = makeRoot()
    const db = new Database(":memory:")
    try {
      initializeGenerationStore(db)
      writeAnnotationFile(root, [
        { ann_id: "ann-1", note: "first" },
        { ann_id: "ann-2", note: "second" },
      ])
      await ingestGenerationWithDb(db, { rootDir: root, storePath: ":memory:" })
      expect(db.query<{ count: number }, []>("SELECT count(*) AS count FROM annotations").get()?.count).toBe(2)

      writeAnnotationFile(root, [{ ann_id: "ann-1", note: "first" }])
      const result = await ingestGenerationWithDb(db, { rootDir: root, storePath: ":memory:" })
      const annFile = result.files.find((entry) => entry.kind === "annotation-rewrite")
      expect(annFile).toMatchObject({ inserted: 0, updated: 0, skippedDup: 1, deleted: 1, malformed: 0 })

      const remaining = db.query<{ ann_id: string }, []>("SELECT ann_id FROM annotations").all().map((row) => row.ann_id)
      expect(remaining).toEqual(["ann-1"])
    } finally {
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
