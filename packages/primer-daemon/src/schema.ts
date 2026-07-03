import { Schema } from "effect"

const NullableString = Schema.NullOr(Schema.String)
const NullableNumber = Schema.NullOr(Schema.Number)

export const EvidenceSourceSchema = Schema.Union([
  Schema.Literal("browser"),
  Schema.Literal("twitter"),
  Schema.Literal("reader"),
])
export type EvidenceSource = Schema.Schema.Type<typeof EvidenceSourceSchema>

export const EvidenceHitSchema = Schema.Struct({
  source: EvidenceSourceSchema,
  kind: Schema.String,
  ref: Schema.String,
  url: NullableString,
  title: Schema.String,
  snippet: NullableString,
  timestamp: NullableString,
  score: Schema.Number,
})
export type EvidenceHit = Schema.Schema.Type<typeof EvidenceHitSchema>

export const BrowserRowSchema = Schema.Struct({
  kind: Schema.Union([Schema.Literal("tab_entry"), Schema.Literal("event")]),
  id: Schema.Number,
  url: NullableString,
  title: NullableString,
  timestampMs: NullableNumber,
})
export type BrowserRow = Schema.Schema.Type<typeof BrowserRowSchema>

export const TwitterRowSchema = Schema.Struct({
  id: Schema.String,
  username: NullableString,
  url: NullableString,
  text: NullableString,
  capturedAt: Schema.String,
})
export type TwitterRow = Schema.Schema.Type<typeof TwitterRowSchema>

export const ReaderRowSchema = Schema.Struct({
  kind: Schema.Union([
    Schema.Literal("annotation"),
    Schema.Literal("source_block"),
    Schema.Literal("concept"),
  ]),
  id: Schema.Number,
  url: NullableString,
  title: NullableString,
  text: NullableString,
  note: NullableString,
  tags: NullableString,
  shortNote: NullableString,
  longNote: NullableString,
  timestamp: NullableString,
})
export type ReaderRow = Schema.Schema.Type<typeof ReaderRowSchema>

export interface SearchResult {
  hits: EvidenceHit[]
  skipped?: string
}

export function decodeEvidenceHit(value: unknown): EvidenceHit {
  return Schema.decodeUnknownSync(EvidenceHitSchema)(value)
}

export function decodeBrowserRow(value: unknown): BrowserRow {
  return Schema.decodeUnknownSync(BrowserRowSchema)(value)
}

export function decodeTwitterRow(value: unknown): TwitterRow {
  return Schema.decodeUnknownSync(TwitterRowSchema)(value)
}

export function decodeReaderRow(value: unknown): ReaderRow {
  return Schema.decodeUnknownSync(ReaderRowSchema)(value)
}
