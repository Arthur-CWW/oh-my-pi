import type { Database } from "bun:sqlite"
import { Schema } from "effect"

import { getReviewDueCounts } from "./review-store"
import { ensureReadingTables, type QueueStatus } from "./reading-store"

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export const JsonValueSchema: Schema.Codec<JsonValue> = Schema.suspend((): Schema.Codec<JsonValue> =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.Array(JsonValueSchema),
    Schema.Record(Schema.String, JsonValueSchema),
  ]),
)

export const FeedbackVerdictSchema = Schema.Union([
  Schema.Literal("good"),
  Schema.Literal("wrong"),
  Schema.Literal("confusing"),
  Schema.Literal("idea"),
])

export const FeedbackInputSchema = Schema.Struct({
  surface: Schema.String,
  verdict: FeedbackVerdictSchema,
  note: Schema.optionalKey(Schema.String),
  context: Schema.optionalKey(JsonValueSchema),
})

export const UiEventInputSchema = Schema.Struct({
  kind: Schema.String,
  payload: Schema.optionalKey(JsonValueSchema),
})

export const UiEventsRequestSchema = Schema.Struct({
  events: Schema.Array(UiEventInputSchema),
})

type RawFeedbackEvent = Schema.Schema.Type<typeof RawFeedbackEventSchema>
type RawUiEvent = Schema.Schema.Type<typeof RawUiEventSchema>
type RawCountRow = Schema.Schema.Type<typeof CountRowSchema>
type RawTableNameRow = Schema.Schema.Type<typeof TableNameRowSchema>

export type FeedbackInput = Schema.Schema.Type<typeof FeedbackInputSchema>
export type UiEventInput = Schema.Schema.Type<typeof UiEventInputSchema>
export type FeedbackVerdict = Schema.Schema.Type<typeof FeedbackVerdictSchema>

export interface FeedbackEvent {
  id: number
  surface: string
  verdict: FeedbackVerdict
  context: JsonValue | null
  note: string | null
  createdAt: string
}

export interface UiEvent {
  id: number
  kind: string
  payload: JsonValue | null
  createdAt: string
}

export interface PipelineStats {
  docs: number
  marks: number
  queue: {
    new: number
    keep: number
    known: number
    discarded: number
  }
  priorityPushed: number
  enrolledQueue: number
  enrolledCards: number
  dueNow: number
  newAvailable: number
  reviewEvents: number
  feedbackCount: number
  enrichmentCount: number
}

const PositiveInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
const NonNegativeInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const NullableString = Schema.NullOr(Schema.String)
const RawFeedbackEventSchema = Schema.Struct({
  id: PositiveInteger,
  surface: Schema.String,
  verdict: FeedbackVerdictSchema,
  context: NullableString,
  note: NullableString,
  created_at: Schema.String,
})
const RawUiEventSchema = Schema.Struct({
  id: PositiveInteger,
  kind: Schema.String,
  payload: NullableString,
  created_at: Schema.String,
})
const CountRowSchema = Schema.Struct({ count: NonNegativeInteger })
const TableNameRowSchema = Schema.Struct({ name: Schema.String })
const DEFAULT_FEEDBACK_LIMIT = 50
const DEFAULT_UI_EVENT_LIMIT = 100
const QUEUE_STATUSES: readonly QueueStatus[] = ["new", "keep", "known", "discarded"]

type NoRows = Record<string, never>

export function ensureFeedbackTables(db: Database): void {
  db.exec("PRAGMA foreign_keys = ON")
  db.exec(`
CREATE TABLE IF NOT EXISTS feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  surface TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('good', 'wrong', 'confusing', 'idea')),
  context TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ui_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_events_created_idx ON feedback_events(created_at, id);
CREATE INDEX IF NOT EXISTS ui_events_created_idx ON ui_events(created_at, id);
CREATE INDEX IF NOT EXISTS ui_events_kind_created_idx ON ui_events(kind, created_at, id);
`)
}

export function addFeedback(db: Database, input: FeedbackInput): { id: number } {
  ensureFeedbackTables(db)
  const feedback = Schema.decodeUnknownSync(FeedbackInputSchema)(input)
  const result = db
    .query<NoRows, [string, FeedbackVerdict, string | null, string | null, string]>(
      "INSERT INTO feedback_events (surface, verdict, context, note, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      feedback.surface,
      feedback.verdict,
      feedback.context === undefined ? null : JSON.stringify(feedback.context) ?? "null",
      feedback.note ?? null,
      new Date().toISOString(),
    )
  return { id: Number(result.lastInsertRowid) }
}

export function listFeedback(db: Database, limit = DEFAULT_FEEDBACK_LIMIT): FeedbackEvent[] {
  ensureFeedbackTables(db)
  const rows = db
    .query<RawFeedbackEvent, [number]>(
      `SELECT id, surface, verdict, context, note, created_at
       FROM feedback_events
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT ?`,
    )
    .all(Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : DEFAULT_FEEDBACK_LIMIT)
  return rows.map(decodeFeedbackEvent)
}

export function addUiEvents(db: Database, inputs: readonly UiEventInput[]): number {
  ensureFeedbackTables(db)
  const events = Schema.decodeUnknownSync(Schema.Array(UiEventInputSchema))(inputs)
  const insert = db.query<NoRows, [string, string | null, string]>(
    "INSERT INTO ui_events (kind, payload, created_at) VALUES (?, ?, ?)",
  )
  return db.transaction((batch: readonly UiEventInput[]) => {
    const createdAt = new Date().toISOString()
    for (const event of batch) {
      insert.run(event.kind, event.payload === undefined ? null : JSON.stringify(event.payload) ?? "null", createdAt)
    }
    return batch.length
  })(events)
}

export function listUiEvents(db: Database, kind?: string, limit = DEFAULT_UI_EVENT_LIMIT): UiEvent[] {
  ensureFeedbackTables(db)
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : DEFAULT_UI_EVENT_LIMIT
  const rows = kind === undefined
    ? db
        .query<RawUiEvent, [number]>(
          `SELECT id, kind, payload, created_at
           FROM ui_events
           ORDER BY datetime(created_at) DESC, id DESC
           LIMIT ?`,
        )
        .all(normalizedLimit)
    : db
        .query<RawUiEvent, [string, number]>(
          `SELECT id, kind, payload, created_at
           FROM ui_events
           WHERE kind = ?
           ORDER BY datetime(created_at) DESC, id DESC
           LIMIT ?`,
        )
        .all(kind, normalizedLimit)
  return rows.map(decodeUiEvent)
}

export function pipelineStats(db: Database): PipelineStats {
  ensureFeedbackTables(db)
  ensureReadingTables(db)
  const dueCounts = getReviewDueCounts(db)
  return {
    docs: countQuery(db, "SELECT COUNT(*) AS count FROM reading_docs"),
    marks: countQuery(db, "SELECT COUNT(*) AS count FROM reading_marks"),
    queue: {
      new: countQueueStatus(db, "new"),
      keep: countQueueStatus(db, "keep"),
      known: countQueueStatus(db, "known"),
      discarded: countQueueStatus(db, "discarded"),
    },
    priorityPushed: countQuery(db, "SELECT COUNT(*) AS count FROM queue_items WHERE priority > 0"),
    enrolledQueue: countQuery(db, "SELECT COUNT(*) AS count FROM review_state WHERE item_kind = 'queue_item'"),
    enrolledCards: countQuery(db, "SELECT COUNT(*) AS count FROM review_state WHERE item_kind = 'card_candidate'"),
    dueNow: dueCounts.dueNow,
    newAvailable: dueCounts.newAvailable,
    reviewEvents: countQuery(db, "SELECT COUNT(*) AS count FROM review_events"),
    feedbackCount: countQuery(db, "SELECT COUNT(*) AS count FROM feedback_events"),
    enrichmentCount: hasTable(db, "enrichments") ? countQuery(db, "SELECT COUNT(*) AS count FROM enrichments") : 0,
  }
}

function decodeFeedbackEvent(row: RawFeedbackEvent): FeedbackEvent {
  const feedback = Schema.decodeUnknownSync(RawFeedbackEventSchema)(row)
  return {
    id: feedback.id,
    surface: feedback.surface,
    verdict: feedback.verdict,
    context: parseJsonOrNull(feedback.context, "feedback context"),
    note: feedback.note,
    createdAt: feedback.created_at,
  }
}

function decodeUiEvent(row: RawUiEvent): UiEvent {
  const event = Schema.decodeUnknownSync(RawUiEventSchema)(row)
  return {
    id: event.id,
    kind: event.kind,
    payload: parseJsonOrNull(event.payload, "ui event payload"),
    createdAt: event.created_at,
  }
}

function parseJsonOrNull(value: string | null, field: string): JsonValue | null {
  if (value === null) return null
  try {
    return Schema.decodeUnknownSync(JsonValueSchema)(JSON.parse(value))
  } catch {
    throw new Error(`invalid JSON in ${field}`)
  }
}

function countQueueStatus(db: Database, status: QueueStatus): number {
  if (!QUEUE_STATUSES.includes(status)) throw new Error(`invalid queue status: ${status}`)
  const row = db
    .query<RawCountRow, [QueueStatus]>("SELECT COUNT(*) AS count FROM queue_items WHERE status = ?")
    .get(status)
  return decodeCount(row)
}

function countQuery(db: Database, sql: string): number {
  const row = db.query<RawCountRow, []>(sql).get()
  return decodeCount(row)
}

function decodeCount(row: RawCountRow | null): number {
  if (row === null) return 0
  return Schema.decodeUnknownSync(CountRowSchema)(row).count
}

function hasTable(db: Database, name: string): boolean {
  const row = db
    .query<RawTableNameRow, [string]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name)
  if (row === null) return false
  return Schema.decodeUnknownSync(TableNameRowSchema)(row).name === name
}

