import type { Database } from "bun:sqlite"
import { Schema } from "effect"

export const MAX_EXPOSURE_BATCH = 200

const PositiveInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
const NonNegativeInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

export const ExposureSourceSchema = Schema.Union([Schema.Literal("read"), Schema.Literal("media")])
export const ExposureEventSchema = Schema.Struct({
  docId: PositiveInteger,
  paragraphIdx: NonNegativeInteger,
  word: Schema.String,
  source: ExposureSourceSchema,
})
export const ExposureRequestSchema = Schema.Struct({ events: Schema.Array(ExposureEventSchema) })

export type ExposureSource = Schema.Schema.Type<typeof ExposureSourceSchema>
export type ExposureEventInput = Schema.Schema.Type<typeof ExposureEventSchema>
export type ExposureRequest = Schema.Schema.Type<typeof ExposureRequestSchema>

type NoRows = Record<string, never>
interface CountRow {
  count: number
}

export function ensureExposureTables(db: Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS exposure_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL,
  paragraph_idx INTEGER NOT NULL,
  word TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('read', 'media')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS exposure_events_doc_idx ON exposure_events(doc_id, paragraph_idx, id);
CREATE INDEX IF NOT EXISTS exposure_events_word_idx ON exposure_events(word, created_at, id);
`)
}

export function addExposureEvents(db: Database, inputs: readonly ExposureEventInput[]): { count: number } {
  ensureExposureTables(db)
  const events = Schema.decodeUnknownSync(Schema.Array(ExposureEventSchema))(inputs)
  if (events.length > MAX_EXPOSURE_BATCH) {
    throw new Error(`exposure batch exceeds ${MAX_EXPOSURE_BATCH} events`)
  }
  for (const event of events) {
    if (event.word.length === 0) throw new Error("exposure word must not be empty")
  }

  const unique = new Map<string, ExposureEventInput>()
  for (const event of events) {
    const key = `${event.docId}\u0000${event.paragraphIdx}\u0000${event.word}\u0000${event.source}`
    if (!unique.has(key)) unique.set(key, event)
  }
  const insert = db.query<NoRows, [number, number, string, ExposureSource, string]>(
    "INSERT INTO exposure_events (doc_id, paragraph_idx, word, source, created_at) VALUES (?, ?, ?, ?, ?)",
  )
  const createdAt = new Date().toISOString()
  return db.transaction((deduped: readonly ExposureEventInput[]) => {
    for (const event of deduped) insert.run(event.docId, event.paragraphIdx, event.word, event.source, createdAt)
    return { count: deduped.length }
  })([...unique.values()])
}

export function exposureStats(db: Database): { count: number } {
  ensureExposureTables(db)
  const row = db.query<CountRow, []>("SELECT COUNT(*) AS count FROM exposure_events").get()
  return { count: row?.count ?? 0 }
}
