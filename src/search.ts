import { Effect, Result, Schedule } from "effect"
import { runSearch as kagiSearch } from "./kagi"
import { queryApi } from "./gemini"
import { type SearchResponse, toErrorMessage } from "./schemas"

// ─── Gemini search ────────────────────────────────────────────────────

function buildPrompt(query: string, opts?: { recencyFilter?: string; domainFilter?: string[] }): string {
  let p = `Search the web and answer this question. Include source URLs as markdown links.\n\nQuestion: ${query}`
  if (opts?.recencyFilter) {
    const m: Record<string, string> = { day: "past 24h", week: "past week", month: "past month", year: "past year" }
    p += `\n\nOnly include results from the ${m[opts.recencyFilter] ?? opts.recencyFilter}.`
  }
  if (opts?.domainFilter?.length) {
    const inc = opts.domainFilter.filter((d) => !d.startsWith("-"))
    const exc = opts.domainFilter.filter((d) => d.startsWith("-")).map((d) => d.slice(1))
    if (inc.length) p += `\n\nOnly cite sources from: ${inc.join(", ")}`
    if (exc.length) p += `\n\nDo not cite sources from: ${exc.join(", ")}`
  }
  return p
}

function extractUrls(md: string): Array<{ title: string; url: string; snippet: string }> {
  const seen = new Set<string>()
  const out: Array<{ title: string; url: string; snippet: string }> = []
  for (const m of md.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)) {
    if (!m[1] || !m[2] || seen.has(m[2])) continue
    seen.add(m[2])
    out.push({ title: m[1], url: m[2], snippet: "" })
  }
  return out
}

const geminiSearch = Effect.fn("geminiSearch")(function* (
  query: string,
  opts?: { recencyFilter?: string; domainFilter?: string[] },
) {
  const answer = yield* queryApi(buildPrompt(query, opts), { grounding: true })
  return {
    answer,
    results: extractUrls(answer),
    providerUsed: "gemini" as const,
  } satisfies SearchResponse
})

// ─── Unified search ───────────────────────────────────────────────────

export interface SearchOpts {
  provider?: "kagi" | "gemini"
  recencyFilter?: string
  domainFilter?: string[]
}

export const search = Effect.fn("search")(function* (
  query: string,
  opts: SearchOpts = {},
) {
  const q = query.trim()
  if (!q) return yield* Effect.fail(new Error("Empty search query"))

  if (opts.provider === "gemini") {
    return yield* geminiSearch(q, { recencyFilter: opts.recencyFilter, domainFilter: opts.domainFilter })
  }

  // Default: Kagi with Gemini fallback
  const kagiResult = yield* Effect.result(
    kagiSearch(q).pipe(Effect.retry(Schedule.recurs(1))),
  )
  if (Result.isSuccess(kagiResult)) return kagiResult.success
  yield* Effect.logWarning(`Kagi failed, trying Gemini: ${toErrorMessage(kagiResult.failure)}`)

  return yield* geminiSearch(q, { recencyFilter: opts.recencyFilter, domainFilter: opts.domainFilter })
})
