import { Effect, Result, Schema } from "effect"
import type { HttpClient } from "effect/unstable/http"
import { HttpClient as HttpClientService } from "effect/unstable/http"
import { BlockedError, FetchError, NotFoundError, ParseError } from "./errors"
import { discoverOpenSlumMirrors, isChallengeOrErrorHtml, type OpenSlumDiscoveryOptions } from "./mirrors"
import { BookFormatSchema, type BookResult } from "./schemas"

const DEFAULT_BASE_URL = "https://annas-archive.org"

export interface SearchOptions {
  query: string
  limit?: number
  baseUrl?: string
  baseUrls?: readonly string[]
  mirrorDiscovery?: boolean | OpenSlumDiscoveryOptions
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "")
}

function dedupeBaseUrls(urls: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const url of urls) {
    if (!url) continue
    const normalized = normalizeBaseUrl(url)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function discoveryOptions(mirrorDiscovery: SearchOptions["mirrorDiscovery"]): OpenSlumDiscoveryOptions | undefined {
  if (!mirrorDiscovery) return undefined
  return { ...(mirrorDiscovery === true ? {} : mirrorDiscovery), groups: ["anna"] }
}

function resolveSearchBaseUrls(
  options: Pick<SearchOptions, "baseUrl" | "baseUrls" | "mirrorDiscovery">,
): Effect.Effect<string[], never, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const discovered: string[] = []
    const openSlumOptions = discoveryOptions(options.mirrorDiscovery)
    if (openSlumOptions) {
      const discoveryResult = yield* Effect.result(discoverOpenSlumMirrors(openSlumOptions))
      if (Result.isSuccess(discoveryResult)) {
        discovered.push(...discoveryResult.success.map((candidate) => candidate.url))
      }
    }

    return dedupeBaseUrls([options.baseUrl ?? DEFAULT_BASE_URL, ...(options.baseUrls ?? []), ...discovered])
  })
}

function parseAnnaResults(html: string, resolvedBase: string, limit: number, defaultUrl: string): BookResult[] {
  const anchorRegex = /<a[^>]*href="(\/md5\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  const results: BookResult[] = []
  let m: RegExpExecArray | null

  while ((m = anchorRegex.exec(html)) !== null) {
    if (results.length >= limit) break
    const href = m[1]!
    const rawTitle = m[2]!.replace(/<[^>]*>/g, "").trim()
    if (!rawTitle) continue

    const md5 = href.replace("/md5/", "").split("?")[0]!
    const sourceUrl = `${resolvedBase}${href}`

    // Parse mock or default values as search details are limited in table-less view
    results.push({
      id: md5,
      title: rawTitle,
      authors: ["Unknown"],
      format: "unknown",
      size: undefined,
      language: undefined,
      source: "borges_library",
      sourceUrl,
    })
  }

  // Also parse if it's a table layout
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    if (results.length >= limit) break
    const rowContent = rowMatch[1]!
    if (rowContent.includes("<th")) continue

    const cellMatches = rowContent.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []
    if (cellMatches.length < 4) continue

    const titleLinkMatch = cellMatches[0]!.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!titleLinkMatch) continue
    const href = titleLinkMatch[1]!
    const title = titleLinkMatch[2]!.replace(/<[^>]*>/g, "").trim()
    if (!title) continue

    const md5 = href.replace("/md5/", "").split("?")[0]!
    const sourceUrl = href.startsWith("http") ? href : `${resolvedBase}${href}`

    const authorsText = cellMatches[1]!.replace(/<[^>]*>/g, "").trim()
    const yearText = cellMatches[2]!.replace(/<[^>]*>/g, "").trim()
    const formatText = cellMatches[3]!.replace(/<[^>]*>/g, "").trim()
    const sizeText = cellMatches[4] ? cellMatches[4].replace(/<[^>]*>/g, "").trim() : undefined

    const normalizedFormat = formatText.toLowerCase().trim()
    const parsedFormat = Schema.decodeUnknownOption(BookFormatSchema)(normalizedFormat)
    const format = parsedFormat._tag === "Some" ? parsedFormat.value : "unknown"

    results.push({
      id: md5,
      title,
      authors: authorsText ? authorsText.split(/[,;&]/).map((a) => a.trim()).filter(Boolean) : ["Unknown"],
      year: /^\d{4}$/.test(yearText) ? Number(yearText) : undefined,
      language: undefined,
      format,
      size: sizeText,
      source: "borges_library",
      sourceUrl,
    })
  }

  return results
}

function searchAnnaArchiveFromBase(
  options: SearchOptions,
  resolvedBase: string,
): Effect.Effect<BookResult[], FetchError | ParseError | NotFoundError | BlockedError, HttpClient.HttpClient> {
  const { query, limit = 10 } = options
  const url = `${resolvedBase}/search?index=&page=1&q=${encodeURIComponent(query)}&display=table&sort=`

  return Effect.gen(function* () {
    const getResult = yield* Effect.result(
      HttpClientService.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BorgesLibrary/1.0)" },
      }).pipe(Effect.timeout("20 seconds")),
    )

    if (!Result.isSuccess(getResult)) {
      return yield* new NotFoundError({ message: `Anna's Archive mirror unreachable (${resolvedBase}): ${String(getResult.failure)}` })
    }
    const resp = getResult.success


    const textResult = yield* Effect.result(resp.text)
    if (!Result.isSuccess(textResult)) {
      return yield* new FetchError({ message: `Failed to read Anna Archive response from ${resolvedBase}: ${String(textResult.failure)}` })
    }
    const html = textResult.success

    if (isChallengeOrErrorHtml(html, resp.status)) {
      return yield* new BlockedError({ message: `Anna's Archive mirror blocked by CAPTCHA/challenge/error page: ${resolvedBase}` })
    }

    if (resp.status < 200 || resp.status >= 300) {
      return yield* new NotFoundError({ message: `Anna's Archive mirror returned status ${resp.status}: ${resolvedBase}` })
    }

    const results = parseAnnaResults(html, resolvedBase, limit, url)

    if (results.length === 0) {
      return yield* new NotFoundError({ message: `No results found on Anna's Archive mirror ${resolvedBase} for "${query}"` })
    }

    return results
  })
}

export function searchAnnaArchive(
  options: SearchOptions,
): Effect.Effect<BookResult[], FetchError | ParseError | NotFoundError | BlockedError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const baseUrls = yield* resolveSearchBaseUrls(options)
    let lastFailure: FetchError | ParseError | NotFoundError | BlockedError | undefined

    for (const resolvedBase of baseUrls) {
      const result = yield* Effect.result(searchAnnaArchiveFromBase(options, resolvedBase))
      if (Result.isSuccess(result)) return result.success
      lastFailure = result.failure
    }

    if (lastFailure) return yield* lastFailure
    return yield* new NotFoundError({ message: "No Anna's Archive mirrors were available" })
  })
}
