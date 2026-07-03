import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"

import { searchReader } from "../src/substrate/reader"

const tempDirs: string[] = []
const TEST_TMP_ROOT = new URL(".tmp/", import.meta.url).pathname

function makeTempDir(prefix: string): string {
  mkdirSync(TEST_TMP_ROOT, { recursive: true })
  return mkdtempSync(join(TEST_TMP_ROOT, prefix))
}


const WORKS_SCHEMA = `CREATE TABLE works (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  container_title TEXT,
  first_presented TEXT,
  first_published TEXT,
  pdf_page_start INTEGER,
  pdf_page_end INTEGER,
  note TEXT
);`

const ANNOTATIONS_SCHEMA = `CREATE TABLE annotations (
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
, category TEXT, ontology TEXT, question TEXT, why_reference TEXT, reading_unit_key TEXT, front_claim TEXT);`

const SOURCE_BLOCKS_SCHEMA = `CREATE TABLE source_blocks (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id),
  block_key TEXT NOT NULL UNIQUE,
  reading_unit_key TEXT NOT NULL,
  pdf_page INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  block_type TEXT NOT NULL,
  text TEXT NOT NULL
);`

const CONCEPTS_SCHEMA = `CREATE TABLE concepts (
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
, front_claim TEXT);`

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("reader substrate search", () => {
  test("finds annotations by title and note", () => {
    const dbPath = createReaderFixture()

    const result = searchReader(dbPath, ["dialectic"])

    expect(result.hits.map((hit) => hit.ref)).toEqual(["reader:annotations:1"])
    expect(result.hits[0]?.kind).toBe("annotation")
    expect(result.hits[0]?.snippet).toContain("dialectic")
  })

  test("finds source blocks by text", () => {
    const dbPath = createReaderFixture()

    const result = searchReader(dbPath, ["machinic"])

    expect(result.hits.map((hit) => hit.ref)).toEqual(["reader:source_blocks:1"])
    expect(result.hits[0]?.title).toBe("Meltdown Notes")
  })

  test("finds concepts by short notes and skips missing DBs", () => {
    const dbPath = createReaderFixture()

    const result = searchReader(dbPath, ["runaway"])
    expect(result.hits.map((hit) => hit.ref)).toEqual(["reader:concepts:1"])

    const missing = searchReader(join(TEST_TMP_ROOT, "missing-primer-reader.sqlite"), ["test"])
    expect(missing.hits).toEqual([])
    expect(missing.skipped).toContain("missing reader DB")
  })
})

function createReaderFixture(): string {
  const dir = makeTempDir("primer-reader-")
  tempDirs.push(dir)
  const dbPath = join(dir, "reader.sqlite")
  const db = new Database(dbPath)
  try {
    db.exec(`${WORKS_SCHEMA}\n${ANNOTATIONS_SCHEMA}\n${SOURCE_BLOCKS_SCHEMA}\n${CONCEPTS_SCHEMA}`)
    db.query("INSERT INTO works (id, title, author) VALUES (1, 'Meltdown Notes', 'CCRU')").run()
    db.query(
      `INSERT INTO annotations (id, work_id, pdf_page, anchor, title, kind, tags, note, created_at)
       VALUES (?, 1, 1, ?, ?, 'concept', ?, ?, ?)`,
    ).run(1, "dialectic-anchor", "Dialectic Pressure", "hegel,marx", "A dialectic note with context.", "2026-06-01")
    db.query(
      `INSERT INTO annotations (id, work_id, pdf_page, anchor, title, kind, tags, note, created_at)
       VALUES (?, 1, 2, ?, ?, 'concept', ?, ?, ?)`,
    ).run(2, "other-anchor", "Cybernetic Aside", "systems", "Another annotation.", "2026-06-02")
    db.query(
      `INSERT INTO source_blocks (id, work_id, block_key, reading_unit_key, pdf_page, sequence, block_type, text)
       VALUES (?, 1, ?, ?, 3, 1, 'paragraph', ?)`,
    ).run(1, "block-1", "unit-1", "Machinic desire appears in the source passage.")
    db.query(
      `INSERT INTO source_blocks (id, work_id, block_key, reading_unit_key, pdf_page, sequence, block_type, text)
       VALUES (?, 1, ?, ?, 4, 2, 'paragraph', ?)`,
    ).run(2, "block-2", "unit-1", "A quiet unrelated passage.")
    db.query(
      `INSERT INTO concepts (id, slug, title, lane, ontology, reader_question, short_note, long_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      1,
      "technocapital",
      "Technocapital Singularity",
      "glossary",
      "capital",
      "What is the concept doing?",
      "Runaway feedback between markets and machines.",
      "A longer note about acceleration.",
    )
  } finally {
    db.close()
  }
  return dbPath
}
