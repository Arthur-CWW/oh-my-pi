import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"

import { searchReader } from "../src/substrate/reader"

function withReaderDb(run: (dbPath: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "primer-reader-search-"))
  try {
    const dbPath = join(root, "meltdown-annotations.sqlite")
    const db = new Database(dbPath)
    try {
      db.exec(`
CREATE TABLE works (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  container_title TEXT,
  first_presented TEXT,
  first_published TEXT,
  pdf_page_start INTEGER,
  pdf_page_end INTEGER,
  note TEXT
);
CREATE TABLE source_blocks (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id),
  block_key TEXT NOT NULL UNIQUE,
  reading_unit_key TEXT NOT NULL,
  pdf_page INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  block_type TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE TABLE annotations (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id),
  pdf_page INTEGER NOT NULL,
  anchor TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  tags TEXT NOT NULL,
  note TEXT NOT NULL,
  refs TEXT,
  neoliberalism TEXT,
  created_at TEXT NOT NULL
, category TEXT, ontology TEXT, question TEXT, why_reference TEXT, reading_unit_key TEXT, front_claim TEXT);
CREATE TABLE concepts (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  lane TEXT NOT NULL,
  ontology TEXT NOT NULL,
  reader_question TEXT NOT NULL,
  short_note TEXT NOT NULL,
  long_note TEXT NOT NULL,
  key_terms TEXT,
  references_text TEXT
, front_claim TEXT);
`)
      for (const work of [
        [1, "Acceleration Reader"],
        [2, "Memory Reader"],
        [3, "Archive Reader"],
      ] as const) {
        db.query("INSERT INTO works (id, title) VALUES (?, ?)").run(...work)
      }

      insertSourceBlock(db, 10, 1, "sb-10", "A source passage says metacognition shapes the reader's next question.")
      insertSourceBlock(db, 11, 2, "sb-11", "A paragraph about scheduling and review cadence.")
      insertSourceBlock(db, 12, 3, "sb-12", "Archive practice makes provenance visible.")
      insertAnnotation(db, 20, 1, "Feedback Note", "This note uses palimpsest as a metaphor for layered marginalia.")
      insertAnnotation(db, 21, 2, "Review Note", "Spacing changes the felt cost of returning to a claim.")
      insertAnnotation(db, 22, 3, "Archive Note", "References should remain close to the statement they support.")
      insertConcept(db, 30, "consolidation", "Memory Consolidation", "The long note says consolidation depends on revisiting claims with evidence.")
      insertConcept(db, 31, "attention", "Attention", "A long note about noticing changes across sessions.")
      insertConcept(db, 32, "indexing", "Indexing", "A long note about building durable cross references.")
    } finally {
      db.close()
    }

    run(dbPath)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function insertSourceBlock(db: Database, id: number, workId: number, blockKey: string, text: string): void {
  db.query(
    `INSERT INTO source_blocks (id, work_id, block_key, reading_unit_key, pdf_page, sequence, block_type, text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, workId, blockKey, `unit-${workId}`, workId, id, "paragraph", text)
}

function insertAnnotation(db: Database, id: number, workId: number, title: string, note: string): void {
  db.query(
    `INSERT INTO annotations (id, work_id, pdf_page, anchor, title, kind, tags, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, workId, workId, `anchor-${id}`, title, "note", "reader,test", note, `2026-06-${workId + 10}T00:00:00.000Z`)
}

function insertConcept(db: Database, id: number, slug: string, title: string, longNote: string): void {
  db.query(
    `INSERT INTO concepts (id, slug, title, lane, ontology, reader_question, short_note, long_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, slug, title, "memory", "concept", "What does it explain?", "Short supporting note.", longNote)
}

describe("searchReader", () => {
  test("returns annotation, source block, and concept provenance refs from matched columns", () => {
    withReaderDb((dbPath) => {
      const annotation = searchReader(dbPath, ["palimpsest"], 10).hits[0]
      const sourceBlock = searchReader(dbPath, ["metacognition"], 10).hits[0]
      const concept = searchReader(dbPath, ["consolidation"], 10).hits[0]

      expect(annotation?.ref).toBe("reader:annotations:20")
      expect(annotation?.snippet).toContain("palimpsest")
      expect(sourceBlock?.ref).toBe("reader:source_blocks:10")
      expect(sourceBlock?.snippet).toContain("metacognition")
      expect(concept?.ref).toBe("reader:concepts:30")
      expect(concept?.snippet).toContain("consolidation")
    })
  })
})
