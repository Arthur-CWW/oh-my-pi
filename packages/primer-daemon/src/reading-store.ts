import type { Database } from "bun:sqlite"
import { Schema } from "effect"

export type ReadingMarkKind = "lookup" | "manual"
export type QueueStatus = "new" | "keep" | "discarded" | "known"

export interface CreateReadingDocInput {
  title: string
  text: string
  lang?: string
  source?: string | null
}

export interface ReadingDocSummary {
  id: number
  title: string
  lang: string
  createdAt: string
  paragraphCount: number
  markCount: number
}

export interface ReadingMark {
  id: number
  paragraphIdx: number
  start: number
  end: number
  surface: string
  kind: ReadingMarkKind
}

export interface ReadingDocDetail {
  id: number
  title: string
  lang: string
  createdAt: string
  paragraphs: string[]
  marks: ReadingMark[]
}

export interface CreateReadingMarkInput {
  docId: number
  paragraphIdx: number
  start: number
  end: number
  surface: string
  sentence: string
  kind?: ReadingMarkKind
  pinyin?: string | null
  gloss?: string | null
}

export interface QueueProvenance {
  docId: number
  docTitle: string
  paragraphIdx: number
  start: number
  end: number
  sentence: string
}

export interface QueueItem {
  id: number
  word: string
  pinyin: string | null
  gloss: string | null
  status: QueueStatus
  lookupCount: number
  createdAt: string
  updatedAt: string
  provenance: QueueProvenance | null
}

export interface CreatedReadingMark {
  markId: number
  queueItem: QueueItem
}

const PositiveInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
const NonNegativeInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const NullableString = Schema.NullOr(Schema.String)
const QueueStatusSchema = Schema.Union([
  Schema.Literal("new"),
  Schema.Literal("keep"),
  Schema.Literal("discarded"),
  Schema.Literal("known"),
])
const ReadingMarkKindSchema = Schema.Union([Schema.Literal("lookup"), Schema.Literal("manual")])

const RawDocSummarySchema = Schema.Struct({
  id: PositiveInteger,
  title: Schema.String,
  lang: Schema.String,
  created_at: Schema.String,
  paragraph_count: NonNegativeInteger,
  mark_count: NonNegativeInteger,
})

type RawDocSummary = Schema.Schema.Type<typeof RawDocSummarySchema>

const RawDocRowSchema = Schema.Struct({
  id: PositiveInteger,
  title: Schema.String,
  lang: Schema.String,
  created_at: Schema.String,
})

type RawDocRow = Schema.Schema.Type<typeof RawDocRowSchema>

const RawParagraphRowSchema = Schema.Struct({
  idx: NonNegativeInteger,
  text: Schema.String,
})

type RawParagraphRow = Schema.Schema.Type<typeof RawParagraphRowSchema>

const RawMarkRowSchema = Schema.Struct({
  id: PositiveInteger,
  doc_id: PositiveInteger,
  paragraph_idx: NonNegativeInteger,
  start: NonNegativeInteger,
  end: NonNegativeInteger,
  surface: Schema.String,
  sentence: Schema.String,
  kind: ReadingMarkKindSchema,
})

type RawMarkRow = Schema.Schema.Type<typeof RawMarkRowSchema>

const RawQueueRowSchema = Schema.Struct({
  id: PositiveInteger,
  word: Schema.String,
  pinyin: NullableString,
  gloss: NullableString,
  status: QueueStatusSchema,
  lookup_count: PositiveInteger,
  created_at: Schema.String,
  updated_at: Schema.String,
  doc_id: Schema.NullOr(PositiveInteger),
  doc_title: NullableString,
  paragraph_idx: Schema.NullOr(NonNegativeInteger),
  start: Schema.NullOr(NonNegativeInteger),
  end: Schema.NullOr(NonNegativeInteger),
  sentence: NullableString,
})

type RawQueueRow = Schema.Schema.Type<typeof RawQueueRowSchema>
const RawQueuePointerSchema = Schema.Struct({
  id: PositiveInteger,
  mark_id: Schema.NullOr(PositiveInteger),
})

type RawQueuePointer = Schema.Schema.Type<typeof RawQueuePointerSchema>


const RawMarkWordSchema = Schema.Struct({
  id: PositiveInteger,
  surface: Schema.String,
})

type RawMarkWord = Schema.Schema.Type<typeof RawMarkWordSchema>

const CountRowSchema = Schema.Struct({ count: NonNegativeInteger })
type CountRow = Schema.Schema.Type<typeof CountRowSchema>

type NoRows = Record<string, never>

const DEFAULT_QUEUE_LIMIT = 100

export function ensureReadingTables(db: Database): void {
  db.exec("PRAGMA foreign_keys = ON")
  db.exec(`
CREATE TABLE IF NOT EXISTS reading_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'zh',
  source TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reading_paragraphs (
  doc_id INTEGER NOT NULL REFERENCES reading_docs(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (doc_id, idx)
);
CREATE TABLE IF NOT EXISTS reading_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL REFERENCES reading_docs(id) ON DELETE CASCADE,
  paragraph_idx INTEGER NOT NULL,
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  surface TEXT NOT NULL,
  sentence TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'lookup',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS queue_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mark_id INTEGER REFERENCES reading_marks(id),
  word TEXT NOT NULL UNIQUE,
  pinyin TEXT,
  gloss TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  lookup_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reading_marks_doc_idx ON reading_marks(doc_id, paragraph_idx, start);
CREATE INDEX IF NOT EXISTS reading_marks_surface_idx ON reading_marks(surface);
CREATE INDEX IF NOT EXISTS queue_items_status_idx ON queue_items(status, updated_at);
`)
}

export function splitReadingParagraphs(text: string): string[] {
  return text
    .split(/\r?\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
}

export function createReadingDoc(db: Database, input: CreateReadingDocInput): { id: number; paragraphCount: number } {
  ensureReadingTables(db)
  const paragraphs = splitReadingParagraphs(input.text)
  return db.transaction((doc: CreateReadingDocInput, docParagraphs: string[]) => {
    const createdAt = nowIso()
    const result = db
      .query<NoRows, [string, string, string | null, string]>(
        "INSERT INTO reading_docs (title, lang, source, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(doc.title, doc.lang ?? "zh", doc.source ?? null, createdAt)
    const id = Number(result.lastInsertRowid)
    const insertParagraph = db.query<NoRows, [number, number, string]>(
      "INSERT INTO reading_paragraphs (doc_id, idx, text) VALUES (?, ?, ?)",
    )
    for (const [idx, paragraph] of docParagraphs.entries()) insertParagraph.run(id, idx, paragraph)
    return { id, paragraphCount: docParagraphs.length }
  })(input, paragraphs)
}

export function listReadingDocs(db: Database): ReadingDocSummary[] {
  ensureReadingTables(db)
  return db
    .query<RawDocSummary, []>(
      `SELECT rd.id,
              rd.title,
              rd.lang,
              rd.created_at,
              COUNT(DISTINCT rp.idx) AS paragraph_count,
              COUNT(DISTINCT rm.id) AS mark_count
       FROM reading_docs rd
       LEFT JOIN reading_paragraphs rp ON rp.doc_id = rd.id
       LEFT JOIN reading_marks rm ON rm.doc_id = rd.id
       GROUP BY rd.id
       ORDER BY datetime(rd.created_at) DESC, rd.id DESC`,
    )
    .all()
    .map((row) => decodeDocSummary(row))
}

export function getReadingDoc(db: Database, id: number): ReadingDocDetail | null {
  ensureReadingTables(db)
  const docRow = db
    .query<RawDocRow, [number]>("SELECT id, title, lang, created_at FROM reading_docs WHERE id = ?")
    .get(id)
  if (docRow === null) return null
  const doc = Schema.decodeUnknownSync(RawDocRowSchema)(docRow)
  const paragraphRows = db
    .query<RawParagraphRow, [number]>("SELECT idx, text FROM reading_paragraphs WHERE doc_id = ? ORDER BY idx ASC")
    .all(id)
    .map((row) => Schema.decodeUnknownSync(RawParagraphRowSchema)(row))
  const marks = db
    .query<RawMarkRow, [number]>(
      `SELECT id, doc_id, paragraph_idx, start, end, surface, sentence, kind
       FROM reading_marks
       WHERE doc_id = ?
       ORDER BY id ASC`,
    )
    .all(id)
    .map((row) => decodeMark(row))
  return {
    id: doc.id,
    title: doc.title,
    lang: doc.lang,
    createdAt: doc.created_at,
    paragraphs: paragraphRows.map((row) => row.text),
    marks,
  }
}

export function createReadingMark(db: Database, input: CreateReadingMarkInput): CreatedReadingMark {
  ensureReadingTables(db)
  return db.transaction((mark: CreateReadingMarkInput) => {
    assertParagraphSpan(db, mark)
    const createdAt = nowIso()
    const result = db
      .query<NoRows, [number, number, number, number, string, string, ReadingMarkKind, string]>(
        `INSERT INTO reading_marks (doc_id, paragraph_idx, start, end, surface, sentence, kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(mark.docId, mark.paragraphIdx, mark.start, mark.end, mark.surface, mark.sentence, mark.kind ?? "lookup", createdAt)
    const markId = Number(result.lastInsertRowid)
    const updatedAt = nowIso()
    const insertResult = db
      .query<NoRows, [number, string, string | null, string | null, string, string]>(
        `INSERT OR IGNORE INTO queue_items (mark_id, word, pinyin, gloss, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(markId, mark.surface, mark.pinyin ?? null, mark.gloss ?? null, updatedAt, updatedAt)
    if (insertResult.changes === 0) {
      db.query<NoRows, [string, number, string]>(
        `UPDATE queue_items
         SET lookup_count = lookup_count + 1,
             updated_at = ?,
             mark_id = COALESCE(mark_id, ?)
         WHERE word = ?`,
      ).run(updatedAt, markId, mark.surface)
    }
    const queueItem = getQueueItemByWord(db, mark.surface)
    if (queueItem === null) throw new Error("queue item could not be reloaded")
    return { markId, queueItem }
  })(input)
}

export function deleteReadingMark(db: Database, id: number): boolean {
  ensureReadingTables(db)
  return db.transaction((markId: number) => {
    const markRow = db.query<RawMarkWord, [number]>("SELECT id, surface FROM reading_marks WHERE id = ?").get(markId)
    if (markRow === null) return false
    const mark = Schema.decodeUnknownSync(RawMarkWordSchema)(markRow)
    const remainingBeforeDelete = countMarksForWord(db, mark.surface)
    const queueItemRow = db.query<RawQueuePointer, [string]>("SELECT id, mark_id FROM queue_items WHERE word = ?").get(mark.surface)
    const queueItem = queueItemRow === null ? null : Schema.decodeUnknownSync(RawQueuePointerSchema)(queueItemRow)

    if (queueItem !== null && remainingBeforeDelete <= 1) {
      db.query<NoRows, [string]>("DELETE FROM queue_items WHERE word = ?").run(mark.surface)
    } else if (queueItem !== null) {
      const nextMark = db
        .query<RawMarkWord, [string, number]>(
          "SELECT id, surface FROM reading_marks WHERE surface = ? AND id <> ? ORDER BY id ASC LIMIT 1",
        )
        .get(mark.surface, mark.id)
      const nextMarkId = nextMark === null ? null : Schema.decodeUnknownSync(RawMarkWordSchema)(nextMark).id
      db.query<NoRows, [number, number | null, string, string]>(
        `UPDATE queue_items
         SET mark_id = CASE WHEN mark_id = ? THEN ? ELSE mark_id END,
             lookup_count = CASE WHEN lookup_count > 1 THEN lookup_count - 1 ELSE 1 END,
             updated_at = ?
         WHERE word = ?`,
      ).run(mark.id, nextMarkId, nowIso(), mark.surface)
    }

    db.query<NoRows, [number]>("DELETE FROM reading_marks WHERE id = ?").run(mark.id)
    return true
  })(id)
}

export function listQueueItems(db: Database, status: QueueStatus | "all" = "new", limit = DEFAULT_QUEUE_LIMIT): QueueItem[] {
  ensureReadingTables(db)
  const normalizedLimit = normalizeLimit(limit)
  if (status === "all") {
    return db.query<RawQueueRow, [number]>(`${queueItemSelectSql()} ORDER BY datetime(qi.updated_at) DESC, qi.id DESC LIMIT ?`)
      .all(normalizedLimit)
      .map((row) => decodeQueueRow(row))
  }
  return db
    .query<RawQueueRow, [QueueStatus, number]>(
      `${queueItemSelectSql()} WHERE qi.status = ? ORDER BY datetime(qi.updated_at) DESC, qi.id DESC LIMIT ?`,
    )
    .all(status, normalizedLimit)
    .map((row) => decodeQueueRow(row))
}

export function setQueueItemStatus(db: Database, id: number, status: QueueStatus): QueueItem | null {
  ensureReadingTables(db)
  const result = db
    .query<NoRows, [QueueStatus, string, number]>("UPDATE queue_items SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, nowIso(), id)
  if (result.changes === 0) return null
  return getQueueItemById(db, id)
}

export function getQueueItemById(db: Database, id: number): QueueItem | null {
  ensureReadingTables(db)
  const row = db.query<RawQueueRow, [number]>(`${queueItemSelectSql()} WHERE qi.id = ?`).get(id)
  return row === null ? null : decodeQueueRow(row)
}

export function getQueueItemByWord(db: Database, word: string): QueueItem | null {
  ensureReadingTables(db)
  const row = db.query<RawQueueRow, [string]>(`${queueItemSelectSql()} WHERE qi.word = ?`).get(word)
  return row === null ? null : decodeQueueRow(row)
}

function assertParagraphSpan(db: Database, mark: CreateReadingMarkInput): void {
  const paragraph = db
    .query<RawParagraphRow, [number, number]>("SELECT idx, text FROM reading_paragraphs WHERE doc_id = ? AND idx = ?")
    .get(mark.docId, mark.paragraphIdx)
  if (paragraph === null) throw new Error("unknown reading paragraph")
  const decoded = Schema.decodeUnknownSync(RawParagraphRowSchema)(paragraph)
  if (mark.start > mark.end || mark.end > decoded.text.length) throw new Error("mark span outside paragraph")
}

function countMarksForWord(db: Database, word: string): number {
  const row = db.query<CountRow, [string]>("SELECT COUNT(*) AS count FROM reading_marks WHERE surface = ?").get(word)
  return row === null ? 0 : Schema.decodeUnknownSync(CountRowSchema)(row).count
}

function queueItemSelectSql(): string {
  return `SELECT qi.id,
                 qi.word,
                 qi.pinyin,
                 qi.gloss,
                 qi.status,
                 qi.lookup_count,
                 qi.created_at,
                 qi.updated_at,
                 rd.id AS doc_id,
                 rd.title AS doc_title,
                 rm.paragraph_idx,
                 rm.start,
                 rm.end,
                 rm.sentence
          FROM queue_items qi
          LEFT JOIN reading_marks rm ON rm.id = qi.mark_id
          LEFT JOIN reading_docs rd ON rd.id = rm.doc_id`
}

function normalizeLimit(limit: number): number {
  return Number.isFinite(limit) && Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_QUEUE_LIMIT
}

function decodeDocSummary(row: RawDocSummary): ReadingDocSummary {
  const doc = Schema.decodeUnknownSync(RawDocSummarySchema)(row)
  return {
    id: doc.id,
    title: doc.title,
    lang: doc.lang,
    createdAt: doc.created_at,
    paragraphCount: doc.paragraph_count,
    markCount: doc.mark_count,
  }
}

function decodeMark(row: RawMarkRow): ReadingMark {
  const mark = Schema.decodeUnknownSync(RawMarkRowSchema)(row)
  return {
    id: mark.id,
    paragraphIdx: mark.paragraph_idx,
    start: mark.start,
    end: mark.end,
    surface: mark.surface,
    kind: mark.kind,
  }
}

function decodeQueueRow(row: RawQueueRow): QueueItem {
  const item = Schema.decodeUnknownSync(RawQueueRowSchema)(row)
  return {
    id: item.id,
    word: item.word,
    pinyin: item.pinyin,
    gloss: item.gloss,
    status: item.status,
    lookupCount: item.lookup_count,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    provenance:
      item.doc_id === null ||
      item.doc_title === null ||
      item.paragraph_idx === null ||
      item.start === null ||
      item.end === null ||
      item.sentence === null
        ? null
        : {
            docId: item.doc_id,
            docTitle: item.doc_title,
            paragraphIdx: item.paragraph_idx,
            start: item.start,
            end: item.end,
            sentence: item.sentence,
          },
  }
}

function nowIso(): string {
  return new Date().toISOString()
}
