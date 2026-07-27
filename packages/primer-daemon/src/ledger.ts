import { existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Database } from "bun:sqlite"
import { Schema } from "effect"
import { ensureReadingTables } from "./reading-store"

export interface NoteInput {
  question: string
  body: string
  sources: Array<{ ref: string; url?: string; title?: string }>
}

export interface CardInput {
  front: string
  back: string
  sourceRef?: string
  url?: string
}

export type CardStatus = "candidate" | "approved" | "rejected"
export type CardListStatus = CardStatus | "enrolled" | "all"

export interface ProgressInput {
  kind: string
  title: string
  body?: string
  refs?: string[]
}

export interface NoteSourceRow {
  id: number
  ref: string
  url: string | null
  title: string | null
}

export interface NoteRow {
  id: number
  question: string
  body: string
  createdAt: string
  sources: NoteSourceRow[]
}

export interface CardRow {
  id: number
  front: string
  back: string
  sourceRef: string | null
  url: string | null
  status: CardStatus
  createdAt: string
}

export interface ProgressRow {
  id: number
  kind: string
  title: string
  body: string | null
  refs: string[]
  createdAt: string
}

export const PositiveInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
const NullableString = Schema.NullOr(Schema.String)
export const CardStatusSchema = Schema.Union([Schema.Literal("candidate"), Schema.Literal("approved"), Schema.Literal("rejected")])
const StringArraySchema = Schema.Array(Schema.String)

const RawNoteRowSchema = Schema.Struct({
  id: PositiveInteger,
  question: Schema.String,
  body: Schema.String,
  created_at: Schema.String,
})

type RawNoteRow = Schema.Schema.Type<typeof RawNoteRowSchema>

const RawNoteSourceRowSchema = Schema.Struct({
  id: PositiveInteger,
  note_id: PositiveInteger,
  ref: Schema.String,
  url: NullableString,
  title: NullableString,
})

type RawNoteSourceRow = Schema.Schema.Type<typeof RawNoteSourceRowSchema>

const RawCardRowSchema = Schema.Struct({
  id: PositiveInteger,
  front: Schema.String,
  back: Schema.String,
  source_ref: NullableString,
  url: NullableString,
  status: CardStatusSchema,
  created_at: Schema.String,
})

type RawCardRow = Schema.Schema.Type<typeof RawCardRowSchema>

const RawCardEnrollmentRowSchema = Schema.Struct({
  id: PositiveInteger,
  front: Schema.String,
  back: Schema.String,
  source_ref: NullableString,
  url: NullableString,
  status: CardStatusSchema,
  created_at: Schema.String,
  enrolled: Schema.Number,
})

type RawCardEnrollmentRow = Schema.Schema.Type<typeof RawCardEnrollmentRowSchema>

const RawProgressRowSchema = Schema.Struct({
  id: PositiveInteger,
  kind: Schema.String,
  title: Schema.String,
  body: NullableString,
  refs_json: Schema.String,
  created_at: Schema.String,
})

type RawProgressRow = Schema.Schema.Type<typeof RawProgressRowSchema>
type NoRows = Record<string, never>

const DEFAULT_LIMIT = 20
const DEFAULT_PROGRESS_LIMIT = 100

export function openLedger(path: string): Database {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.exec("PRAGMA foreign_keys = ON")
  db.exec(`
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS note_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  url TEXT,
  title TEXT
);
CREATE TABLE IF NOT EXISTS card_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  source_ref TEXT,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  refs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`)
  const cardColumns = db
    .query<{ name: string }, []>("PRAGMA table_info(card_candidates)")
    .all()
  if (!cardColumns.some((column) => column.name === "status")) {
    db.exec("ALTER TABLE card_candidates ADD COLUMN status TEXT NOT NULL DEFAULT 'candidate'")
  }
  return db
}

export function addNote(db: Database, input: NoteInput): { id: number } {
  return db.transaction((note: NoteInput) => {
    const result = db
      .query<NoRows, [string, string]>("INSERT INTO notes (question, body) VALUES (?, ?)")
      .run(note.question, note.body)
    const id = Number(result.lastInsertRowid)

    const insertSource = db.query<NoRows, [number, string, string | null, string | null]>(
      "INSERT INTO note_sources (note_id, ref, url, title) VALUES (?, ?, ?, ?)",
    )
    for (const source of note.sources) {
      insertSource.run(id, source.ref, source.url ?? null, source.title ?? null)
    }

    return { id }
  })(input)
}

export function listNotes(db: Database, limit = DEFAULT_LIMIT): NoteRow[] {
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : DEFAULT_LIMIT
  const noteRows = db
    .query<RawNoteRow, [number]>(
      `SELECT id, question, body, created_at
       FROM notes
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT ?`,
    )
    .all(normalizedLimit)
    .map((row) => Schema.decodeUnknownSync(RawNoteRowSchema)(row))

  const sourceQuery = db.query<RawNoteSourceRow, [number]>(
    `SELECT id, note_id, ref, url, title
     FROM note_sources
     WHERE note_id = ?
     ORDER BY id ASC`,
  )

  return noteRows.map((note) => {
    const sources = sourceQuery.all(note.id).map((row) => {
      const source = Schema.decodeUnknownSync(RawNoteSourceRowSchema)(row)
      return {
        id: source.id,
        ref: source.ref,
        url: source.url,
        title: source.title,
      }
    })

    return {
      id: note.id,
      question: note.question,
      body: note.body,
      createdAt: note.created_at,
      sources,
    }
  })
}

export function addCard(db: Database, input: CardInput, now: Date = new Date()): { id: number } {
  const result = db
    .query<NoRows, [string, string, string | null, string | null, string]>(
      "INSERT INTO card_candidates (front, back, source_ref, url, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(input.front, input.back, input.sourceRef ?? null, input.url ?? null, now.toISOString())
  return { id: Number(result.lastInsertRowid) }
}

export function listCards(db: Database, limit = DEFAULT_LIMIT): CardRow[] {
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : DEFAULT_LIMIT
  return db
    .query<RawCardRow, [number]>(
      `SELECT id, front, back, source_ref, url, status, created_at
       FROM card_candidates
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT ?`,
    )
    .all(normalizedLimit)
    .map((row) => decodeCardRow(row))
}

export interface CardListRow extends CardRow {
  enrolled: boolean
}

export function listCardsWithEnrollment(db: Database, limit = DEFAULT_LIMIT, status: CardListStatus = "all"): CardListRow[] {
  ensureReadingTables(db)
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : DEFAULT_LIMIT
  const rows = db
    .query<RawCardEnrollmentRow, [CardListStatus, CardListStatus, CardListStatus, CardListStatus, number]>(
      `SELECT cc.id, cc.front, cc.back, cc.source_ref, cc.url, cc.status, cc.created_at,
              CASE WHEN EXISTS (
                SELECT 1 FROM review_state rs
                WHERE rs.item_kind = 'card_candidate' AND rs.item_id = cc.id
              ) THEN 1 ELSE 0 END AS enrolled
       FROM card_candidates cc
       WHERE (
         ? = 'all'
         OR (? = 'enrolled' AND EXISTS (
           SELECT 1 FROM review_state rs
           WHERE rs.item_kind = 'card_candidate' AND rs.item_id = cc.id
         ))
         OR (? IN ('candidate', 'approved', 'rejected') AND cc.status = ? AND NOT EXISTS (
           SELECT 1 FROM review_state rs
           WHERE rs.item_kind = 'card_candidate' AND rs.item_id = cc.id
         ))
       )
       ORDER BY datetime(cc.created_at) DESC, cc.id DESC
       LIMIT ?`,
    )
    .all(status, status, status, status, normalizedLimit)
  return rows.map((row) => {
    const card = decodeCardEnrollmentRow(row)
    return { ...card, enrolled: row.enrolled !== 0 }
  })
}

export function setCardStatus(db: Database, id: number, status: CardStatus): CardRow | null {
  const result = db
    .query<NoRows, [CardStatus, number]>(
      `UPDATE card_candidates
       SET status = ?
       WHERE id = ?`,
    )
    .run(status, id)
  if (result.changes === 0) return null

  const row = db
    .query<RawCardRow, [number]>(
      `SELECT id, front, back, source_ref, url, status, created_at
       FROM card_candidates
       WHERE id = ?`,
    )
    .get(id)
  if (row === null) throw new Error("updated card could not be reloaded")
  return decodeCardRow(row)
}

export function addProgress(db: Database, input: ProgressInput): ProgressRow {
  const refsJson = JSON.stringify(input.refs ?? []) ?? "[]"
  const row = db
    .query<RawProgressRow, [string, string, string | null, string]>(
      `INSERT INTO progress (kind, title, body, refs_json)
       VALUES (?, ?, ?, ?)
       RETURNING id, kind, title, body, refs_json, created_at`,
    )
    .get(input.kind, input.title, input.body ?? null, refsJson)
  if (row === null) throw new Error("progress insert did not return a row")
  return decodeProgressRow(row)
}

export function listProgress(db: Database, limit = DEFAULT_PROGRESS_LIMIT): ProgressRow[] {
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : DEFAULT_PROGRESS_LIMIT
  return db
    .query<RawProgressRow, [number]>(
      `SELECT id, kind, title, body, refs_json, created_at
       FROM progress
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT ?`,
    )
    .all(normalizedLimit)
    .map((row) => decodeProgressRow(row))
}

function decodeCardRow(row: RawCardRow): CardRow {
  const card = Schema.decodeUnknownSync(RawCardRowSchema)(row)
  return {
    id: card.id,
    front: card.front,
    back: card.back,
    sourceRef: card.source_ref,
    url: card.url,
    status: card.status,
    createdAt: card.created_at,
  }
}

function decodeCardEnrollmentRow(row: RawCardEnrollmentRow): CardRow {
  const card = Schema.decodeUnknownSync(RawCardEnrollmentRowSchema)(row)
  return {
    id: card.id,
    front: card.front,
    back: card.back,
    sourceRef: card.source_ref,
    url: card.url,
    status: card.status,
    createdAt: card.created_at,
  }
}

function decodeProgressRow(row: RawProgressRow): ProgressRow {
  const progress = Schema.decodeUnknownSync(RawProgressRowSchema)(row)
  const parsedRefs: unknown = JSON.parse(progress.refs_json)
  const refs = [...Schema.decodeUnknownSync(StringArraySchema)(parsedRefs)]
  return {
    id: progress.id,
    kind: progress.kind,
    title: progress.title,
    body: progress.body,
    refs,
    createdAt: progress.created_at,
  }
}

