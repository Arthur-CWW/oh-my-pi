import { Schema } from "effect"

export const FeedKindSchema = Schema.Literals(["nitter-handle", "rss", "page-hash"])
export type FeedKind = typeof FeedKindSchema.Type

export const FeedConfigEntrySchema = Schema.Struct({
  name: Schema.NonEmptyString,
  kind: FeedKindSchema,
  target: Schema.NonEmptyString,
  cadence: Schema.Literals(["hourly", "daily"]),
  classifierProfile: Schema.NonEmptyString,
})
export type FeedConfigEntry = typeof FeedConfigEntrySchema.Type

export const FeedRegistrySchema = Schema.Struct({ feeds: Schema.Array(FeedConfigEntrySchema) })
export type FeedRegistry = typeof FeedRegistrySchema.Type

export interface FeedItem {
  readonly id: string
  readonly observedAt: string
  readonly source: string
  readonly handle?: string
  readonly text: string
  readonly url: string
}

export interface CandidateFact {
  readonly itemId: string
  readonly observedAt: string
  readonly source: string
  readonly handle?: string
  readonly quote: string
  readonly url: string
  readonly matchedTerms: readonly string[]
}

export const AvailabilityStateSchema = Schema.Struct({
  lastSyncAt: Schema.String,
  perSource: Schema.Record(Schema.String, Schema.Struct({
    lastItemAt: Schema.String,
    lastResetMentionAt: Schema.optional(Schema.String),
    lastResetQuote: Schema.optional(Schema.String),
  })),
})
export type AvailabilityState = typeof AvailabilityStateSchema.Type

const availabilityTerms = [
  ["reset", /reset/i],
  ["limit", /limit/i],
  ["quota", /quota/i],
  ["rate limit", /rate.?limit/i],
  ["weekly", /weekly/i],
  ["5 hour", /5.?hour/i],
  ["fable", /fable/i],
  ["deprecate", /deprecat/i],
  ["sunset", /sunset/i],
  ["retire", /retir/i],
  ["subscription", /subscription/i],
] as const

export type Classifier = (item: FeedItem) => CandidateFact | undefined

export const classifierProfiles: Readonly<Record<string, Classifier>> = {
  availability: (item) => {
    const matchedTerms = availabilityTerms.filter(([, regex]) => regex.test(item.text)).map(([term]) => term)
    if (matchedTerms.length === 0) return undefined
    const firstMatch = Math.min(...availabilityTerms.flatMap(([, regex]) => {
      const match = regex.exec(item.text)
      return match ? [match.index] : []
    }))
    return {
      itemId: item.id,
      observedAt: item.observedAt,
      source: item.source,
      handle: item.handle,
      quote: quoteAround(item.text, firstMatch),
      url: item.url,
      matchedTerms,
    }
  },
}

function quoteAround(text: string, matchAt: number): string {
  const normalized = decodeEntities(text).replace(/\s+/g, " ").trim()
  if (normalized.length <= 280) return normalized
  const start = Math.max(0, Math.min(matchAt - 80, normalized.length - 277))
  const prefix = start > 0 ? "…" : ""
  const suffix = start + 278 < normalized.length ? "…" : ""
  return `${prefix}${normalized.slice(start, start + 280 - prefix.length - suffix.length)}${suffix}`
}

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/gi, "'")
}
