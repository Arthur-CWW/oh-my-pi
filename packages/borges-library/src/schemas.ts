import { Schema } from "effect"

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))
const OptionalNonEmptyString = Schema.optional(NonEmptyString)

export const BookFormatSchema = Schema.Union([
  Schema.Literal("pdf"),
  Schema.Literal("epub"),
  Schema.Literal("mobi"),
  Schema.Literal("azw3"),
  Schema.Literal("djvu"),
  Schema.Literal("txt"),
  Schema.Literal("unknown"),
])
export type BookFormat = Schema.Schema.Type<typeof BookFormatSchema>

export const BookResultSchema = Schema.Struct({
  id: NonEmptyString,
  title: NonEmptyString,
  authors: Schema.Array(NonEmptyString),
  year: Schema.optional(Schema.Number),
  language: OptionalNonEmptyString,
  format: BookFormatSchema,
  size: OptionalNonEmptyString,
  source: NonEmptyString,
  sourceUrl: NonEmptyString,
})
export type BookResult = Schema.Schema.Type<typeof BookResultSchema>

export const DownloadResultSchema = Schema.Struct({
  id: NonEmptyString,
  title: NonEmptyString,
  downloadedPath: NonEmptyString,
  downloadUrl: NonEmptyString,
  filename: NonEmptyString,
  bytes: Schema.Number,
  format: BookFormatSchema,
  skippedExisting: Schema.optional(Schema.Boolean),
  validated: Schema.optional(Schema.Boolean),
})
export type DownloadResult = Schema.Schema.Type<typeof DownloadResultSchema>

export const SearchResponseSchema = Schema.Struct({
  query: NonEmptyString,
  results: Schema.Array(BookResultSchema),
})
export type SearchResponse = Schema.Schema.Type<typeof SearchResponseSchema>

export const BookResultFromJsonStringSchema = Schema.fromJsonString(BookResultSchema)
