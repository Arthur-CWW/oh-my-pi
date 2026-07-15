import type { Database } from "bun:sqlite"
import { Schema } from "effect"

import { ensureReadingTables } from "./reading-store"

export type EnrichmentStatus = "ok" | "error"
export type EnrichmentLabelVerdict = "keep" | "cut" | "edit"

const PositiveInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
const NonNegativeInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const NullableString = Schema.NullOr(Schema.String)
const EnrichmentStatusSchema = Schema.Union([Schema.Literal("ok"), Schema.Literal("error")])
const EnrichmentLabelVerdictSchema = Schema.Union([Schema.Literal("keep"), Schema.Literal("cut"), Schema.Literal("edit")])
const SourceSchema = Schema.Union([Schema.Literal("cedict"), Schema.Literal("cedict-extended"), Schema.Literal("inferred")])
const ConfidenceSchema = Schema.Union([Schema.Literal("high"), Schema.Literal("medium"), Schema.Literal("low")])

const MorphemeComponentSchema = Schema.Struct({ char: Schema.String, gloss: Schema.String })
const MorphemeNoteSchema = Schema.Struct({
  components: Schema.Array(MorphemeComponentSchema),
  note: Schema.String,
  predicted_confusion: Schema.String,
  source: Schema.Literal("ids+inferred"),
})
const ContrastSchema = Schema.Struct({
  confusable_with: Schema.String,
  trigger: Schema.String,
  distinction: Schema.String,
  source: Schema.Literal("inferred"),
})

const SenseDisambiguationSchema = Schema.Struct({
  cedict_definitions: Schema.Array(Schema.String),
  selected_sense_index: NonNegativeInteger,
  selected_sense: Schema.String,
  evidence_quote: Schema.String,
  gloss_in_context: Schema.String,
  source: SourceSchema,
  confidence: ConfidenceSchema,
  note: NullableString,
})
const ExampleSchema = Schema.Struct({
  sentence: Schema.String,
  pinyin: Schema.String,
  translation: Schema.String,
  uses_sense_index: NonNegativeInteger,
  unknown_tokens: Schema.Array(Schema.String).check(Schema.isMaxLength(1)),
  known_token_ratio: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
})
const ReviewTargetSchema = Schema.Struct({
  durable_candidate: Schema.Boolean,
  retrieval_target: NullableString,
  why: Schema.String,
  note: Schema.String,
})
const SelfAuditSchema = Schema.Struct({
  no_empty_filler_fields: Schema.Boolean,
  sense_selected_not_dumped: Schema.Boolean,
  answer_not_leaked_into_target: Schema.Boolean,
  examples_within_unknown_budget: Schema.Boolean,
  omissions: Schema.Array(Schema.String),
})

export const EnrichmentOutputSchema = Schema.Struct({
  enrichment_version: Schema.Literal("v0"),
  item: Schema.Struct({ queue_item_id: PositiveInteger, word: Schema.String, pinyin: Schema.String }),
  provenance: Schema.Struct({
    source_sentence: Schema.String,
    doc_id: PositiveInteger,
    doc_title: Schema.String,
    paragraph_idx: NonNegativeInteger,
    mark_id: NonNegativeInteger,
    quote_verified: Schema.Boolean,
  }),
  sense_disambiguation: SenseDisambiguationSchema,
  examples: Schema.Array(ExampleSchema).check(Schema.isMinLength(2), Schema.isMaxLength(3)),
  morpheme_note: Schema.NullOr(MorphemeNoteSchema),
  contrast: Schema.NullOr(ContrastSchema),
  review_target: ReviewTargetSchema,
  self_audit: SelfAuditSchema,
})

export type EnrichmentOutput = Schema.Schema.Type<typeof EnrichmentOutputSchema>

const RawEnrichmentRowSchema = Schema.Struct({
  id: PositiveInteger,
  queue_item_id: PositiveInteger,
  model: NullableString,
  prompt_version: Schema.String,
  output: NullableString,
  status: EnrichmentStatusSchema,
  error: NullableString,
  elapsed_ms: Schema.NullOr(NonNegativeInteger),
  created_at: Schema.String,
})

const RawEnrichmentIdSchema = Schema.Struct({ id: PositiveInteger })
type RawEnrichmentRow = Schema.Schema.Type<typeof RawEnrichmentRowSchema>
type RawEnrichmentId = Schema.Schema.Type<typeof RawEnrichmentIdSchema>

const RawLabelRowSchema = Schema.Struct({
  id: PositiveInteger,
  enrichment_id: PositiveInteger,
  field: Schema.String,
  verdict: EnrichmentLabelVerdictSchema,
  edited: NullableString,
  note: NullableString,
  created_at: Schema.String,
})
type RawLabelRow = Schema.Schema.Type<typeof RawLabelRowSchema>

type NoRows = Record<string, never>

export interface EnrichmentLabel {
  id: number
  enrichmentId: number
  field: string
  verdict: EnrichmentLabelVerdict
  edited: string | null
  note: string | null
  createdAt: string
}

export interface EnrichmentRecord {
  id: number
  queueItemId: number
  model: string | null
  promptVersion: string
  output: EnrichmentOutput | null
  status: EnrichmentStatus
  error: string | null
  elapsedMs: number | null
  createdAt: string
  labels: EnrichmentLabel[]
}

export interface InsertEnrichmentInput {
  queueItemId: number
  model?: string | null
  promptVersion?: string
  output?: EnrichmentOutput | null
  status: EnrichmentStatus
  error?: string | null
  elapsedMs?: number | null
}

export interface AddEnrichmentLabelInput {
  enrichmentId: number
  field: string
  verdict: EnrichmentLabelVerdict
  edited?: string | null
  note?: string | null
}

export function ensureEnrichTables(db: Database): void {
  ensureReadingTables(db)
  db.exec("PRAGMA foreign_keys = ON")
  db.exec(`
CREATE TABLE IF NOT EXISTS enrichments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_item_id INTEGER NOT NULL REFERENCES queue_items(id),
  model TEXT,
  prompt_version TEXT NOT NULL DEFAULT 'v0',
  output TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  error TEXT,
  elapsed_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS enrichments_queue_item_idx ON enrichments(queue_item_id, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS enrichment_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrichment_id INTEGER NOT NULL REFERENCES enrichments(id),
  field TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('keep', 'cut', 'edit')),
  edited TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS enrichment_labels_enrichment_idx ON enrichment_labels(enrichment_id, created_at DESC, id DESC);
`)
}

export function insertEnrichment(db: Database, input: InsertEnrichmentInput): EnrichmentRecord {
  ensureEnrichTables(db)
  const output = input.output === undefined || input.output === null ? null : JSON.stringify(input.output)
  const result = db
    .query<NoRows, [number, string | null, string, string | null, EnrichmentStatus, string | null, number | null, string]>(
      `INSERT INTO enrichments (queue_item_id, model, prompt_version, output, status, error, elapsed_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.queueItemId,
      input.model ?? null,
      input.promptVersion ?? "v0",
      output,
      input.status,
      input.error ?? null,
      input.elapsedMs ?? null,
      new Date().toISOString(),
    )
  const inserted = getEnrichmentById(db, Number(result.lastInsertRowid))
  if (inserted === null) throw new Error("failed to read inserted enrichment")
  return inserted
}

export function listEnrichments(db: Database, queueItemId?: number): EnrichmentRecord[] {
  ensureEnrichTables(db)
  const rows = queueItemId === undefined
    ? db.query<RawEnrichmentRow, []>("SELECT id, queue_item_id, model, prompt_version, output, status, error, elapsed_ms, created_at FROM enrichments ORDER BY datetime(created_at) DESC, id DESC").all()
    : db.query<RawEnrichmentRow, [number]>("SELECT id, queue_item_id, model, prompt_version, output, status, error, elapsed_ms, created_at FROM enrichments WHERE queue_item_id = ? ORDER BY datetime(created_at) DESC, id DESC").all(queueItemId)
  const labels = listLabels(db)
  const labelsByEnrichment = new Map<number, EnrichmentLabel[]>()
  for (const label of labels) {
    const existing = labelsByEnrichment.get(label.enrichmentId)
    if (existing === undefined) labelsByEnrichment.set(label.enrichmentId, [label])
    else existing.push(label)
  }
  return rows.map((row) => decodeEnrichmentRow(row, labelsByEnrichment.get(row.id) ?? []))
}

export function getEnrichmentById(db: Database, id: number): EnrichmentRecord | null {
  ensureEnrichTables(db)
  const row = db.query<RawEnrichmentRow, [number]>("SELECT id, queue_item_id, model, prompt_version, output, status, error, elapsed_ms, created_at FROM enrichments WHERE id = ?").get(id)
  if (row === null) return null
  const labels = db.query<RawLabelRow, [number]>("SELECT id, enrichment_id, field, verdict, edited, note, created_at FROM enrichment_labels WHERE enrichment_id = ? ORDER BY datetime(created_at) DESC, id DESC").all(id)
  return decodeEnrichmentRow(row, labels.map(decodeLabelRow))
}

export function addLabel(db: Database, input: AddEnrichmentLabelInput): EnrichmentLabel {
  ensureEnrichTables(db)
  const enrichment = db.query<RawEnrichmentId, [number]>("SELECT id FROM enrichments WHERE id = ?").get(input.enrichmentId)
  if (enrichment === null) throw new Error("unknown enrichment")
  Schema.decodeUnknownSync(RawEnrichmentIdSchema)(enrichment)
  const result = db
    .query<NoRows, [number, string, EnrichmentLabelVerdict, string | null, string | null, string]>(
      `INSERT INTO enrichment_labels (enrichment_id, field, verdict, edited, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.enrichmentId, input.field, input.verdict, input.edited ?? null, input.note ?? null, new Date().toISOString())
  const row = db.query<RawLabelRow, [number]>("SELECT id, enrichment_id, field, verdict, edited, note, created_at FROM enrichment_labels WHERE id = ?").get(Number(result.lastInsertRowid))
  if (row === null) throw new Error("failed to read inserted label")
  return decodeLabelRow(row)
}

function listLabels(db: Database): EnrichmentLabel[] {
  return db.query<RawLabelRow, []>("SELECT id, enrichment_id, field, verdict, edited, note, created_at FROM enrichment_labels ORDER BY datetime(created_at) DESC, id DESC").all().map(decodeLabelRow)
}

function decodeEnrichmentRow(row: RawEnrichmentRow, labels: EnrichmentLabel[]): EnrichmentRecord {
  const decoded = Schema.decodeUnknownSync(RawEnrichmentRowSchema)(row)
  let output: EnrichmentOutput | null = null
  if (decoded.output !== null) output = Schema.decodeUnknownSync(EnrichmentOutputSchema)(JSON.parse(decoded.output))
  return {
    id: decoded.id,
    queueItemId: decoded.queue_item_id,
    model: decoded.model,
    promptVersion: decoded.prompt_version,
    output,
    status: decoded.status,
    error: decoded.error,
    elapsedMs: decoded.elapsed_ms,
    createdAt: decoded.created_at,
    labels,
  }
}

function decodeLabelRow(row: RawLabelRow): EnrichmentLabel {
  const decoded = Schema.decodeUnknownSync(RawLabelRowSchema)(row)
  return {
    id: decoded.id,
    enrichmentId: decoded.enrichment_id,
    field: decoded.field,
    verdict: decoded.verdict,
    edited: decoded.edited,
    note: decoded.note,
    createdAt: decoded.created_at,
  }
}
