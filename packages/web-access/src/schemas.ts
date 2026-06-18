import { Schema } from "effect"

// ─── Errors ───────────────────────────────────────────────────────────

export class SearchError extends Schema.TaggedErrorClass<SearchError>()("SearchError", {
  reason: Schema.String,
}) {}

export class GeminiError extends Schema.TaggedErrorClass<GeminiError>()("GeminiError", {
  reason: Schema.String,
}) {}

export class ChatGptHandoffError extends Schema.TaggedErrorClass<ChatGptHandoffError>()("ChatGptHandoffError", {
  reason: Schema.String,
}) {}

export class FrontendBrowserError extends Schema.TaggedErrorClass<FrontendBrowserError>()("FrontendBrowserError", {
  reason: Schema.String,
}) {}

export class CuaDriverError extends Schema.TaggedErrorClass<CuaDriverError>()("CuaDriverError", {
  reason: Schema.String,
}) {}
// ─── Content ──────────────────────────────────────────────────────────

export const ExtractedContent = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  content: Schema.String,
  error: Schema.Union([Schema.String, Schema.Null]),
})
export type ExtractedContent = typeof ExtractedContent.Type

// ─── Search ───────────────────────────────────────────────────────────

export const SearchResult = Schema.Struct({
  title: Schema.String,
  url: Schema.String,
  snippet: Schema.String,
})
export type SearchResult = typeof SearchResult.Type

export const SearchResponse = Schema.Struct({
  answer: Schema.String,
  results: Schema.Array(SearchResult),
  providerUsed: Schema.Union([Schema.Literal("kagi"), Schema.Literal("gemini")]),
})
export type SearchResponse = typeof SearchResponse.Type

// ─── Cookies ──────────────────────────────────────────────────────────

export type CookieMap = Record<string, string>

export const CookieReadResult = Schema.Struct({
  cookies: Schema.Record(Schema.String, Schema.String),
  warnings: Schema.Array(Schema.String),
  source: Schema.Union([Schema.Literal("legacy"), Schema.Literal("devtools"), Schema.Literal("none")]),
})
export type CookieReadResult = typeof CookieReadResult.Type

// ─── Stored results ───────────────────────────────────────────────────

export const StoredQuery = Schema.Struct({
  query: Schema.String,
  answer: Schema.String,
  results: Schema.Array(SearchResult),
  error: Schema.Union([Schema.String, Schema.Null]),
})

export const StoredSearch = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("search"),
  timestamp: Schema.Number,
  queries: Schema.Array(StoredQuery),
})

export const StoredFetch = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("fetch"),
  timestamp: Schema.Number,
  urls: Schema.Array(ExtractedContent),
})

export const StoredData = Schema.Union([StoredSearch, StoredFetch])
export type StoredData = typeof StoredData.Type

// ─── Tool params ──────────────────────────────────────────────────────

export const SearchParams = Schema.Struct({
  query: Schema.String,
  provider: Schema.optional(Schema.Union([Schema.Literal("kagi"), Schema.Literal("gemini")])),
})

export const FetchParams = Schema.Struct({
  url: Schema.optional(Schema.String),
  urls: Schema.optional(Schema.Array(Schema.String)),
  prompt: Schema.optional(Schema.String),
})

export const StoredParams = Schema.Struct({
  responseId: Schema.String,
  queryIndex: Schema.optional(Schema.Number),
  urlIndex: Schema.optional(Schema.Number),
})

// ─── Util ─────────────────────────────────────────────────────────────

export function toErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "reason" in err) {
    const reason = (err as { reason?: unknown }).reason
    if (typeof reason === "string") return reason
  }
  if (err instanceof Error) return err.message
  return String(err)
}
