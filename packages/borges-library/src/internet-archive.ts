import { Effect, Result, Schema } from "effect"
import { DownloadError, FetchError, ParseError } from "./errors"
import { downloadDirectFile, type DirectDownloadOptions } from "./direct-download"
import type { BookFormat, BookResult, DownloadResult } from "./schemas"

const ADVANCED_SEARCH_URL = "https://archive.org/advancedsearch.php"
const METADATA_BASE_URL = "https://archive.org/metadata"
const DOWNLOAD_BASE_URL = "https://archive.org/download"
const DEFAULT_TIMEOUT_MS = 15_000
const DOWNLOADABLE_FORMATS = new Set<BookFormat>(["pdf", "epub"])

const QUERY_STOPWORDS = new Set([
  "and", "the", "for", "with", "vol", "volume", "collected", "works", "jung", "c", "g", "of", "in", "on",
])

const StringishSchema = Schema.Union([Schema.String, Schema.Number])
type Stringish = Schema.Schema.Type<typeof StringishSchema>

const StringishArraySchema = Schema.Array(StringishSchema)
type StringishArray = Schema.Schema.Type<typeof StringishArraySchema>

const ArchiveSearchDocSchema = Schema.Struct({
  identifier: Schema.optional(StringishSchema),
  title: Schema.optional(StringishSchema),
  creator: Schema.optional(Schema.Union([StringishSchema, StringishArraySchema])),
  date: Schema.optional(StringishSchema),
  year: Schema.optional(StringishSchema),
  language: Schema.optional(Schema.Union([StringishSchema, StringishArraySchema])),
})
type ArchiveSearchDoc = Schema.Schema.Type<typeof ArchiveSearchDocSchema>

const ArchiveSearchPayloadSchema = Schema.Struct({
  response: Schema.Struct({
    docs: Schema.Array(ArchiveSearchDocSchema),
  }),
})

const ArchiveFileSchema = Schema.Struct({
  name: Schema.optional(StringishSchema),
  format: Schema.optional(StringishSchema),
  size: Schema.optional(StringishSchema),
  source: Schema.optional(StringishSchema),
})
type ArchiveFile = Schema.Schema.Type<typeof ArchiveFileSchema>

const ArchiveMetadataSchema = Schema.Struct({
  files: Schema.Array(ArchiveFileSchema),
})

export interface InternetArchiveSearchOptions {
  query: string
  limit?: number
  timeoutMs?: number
}

function asString(value: Stringish | undefined): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number") return String(value)
  return undefined
}

function asStringArray(value: Stringish | StringishArray | undefined): string[] {
  if (Array.isArray(value)) return value.map(asString).filter((item): item is string => Boolean(item))
  const single = asString(value)
  if (!single) return []
  return single.split(/[,;]|\band\b/iu).map((part) => part.trim()).filter(Boolean)
}

function parseYear(...values: Array<Stringish | undefined>): number | undefined {
  for (const value of values) {
    const text = asString(value)
    const year = text?.match(/\b(1[5-9]\d{2}|20\d{2})\b/u)?.[1]
    if (year) return Number(year)
  }
  return undefined
}

function normalizeFormatFromName(name: string, format: Stringish | undefined): BookFormat {
  const normalizedFormat = asString(format)?.toLowerCase() ?? ""
  const lowerName = name.toLowerCase()
  if (lowerName.endsWith(".pdf") || normalizedFormat.includes("pdf")) return "pdf"
  if (lowerName.endsWith(".epub") || normalizedFormat.includes("epub")) return "epub"
  return "unknown"
}

function isLikelyDerivativeNoise(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith("_meta.pdf") || lower.endsWith("_bw.pdf") || lower.includes("_thumb") || lower.includes("_files")
}

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length >= 3 && !QUERY_STOPWORDS.has(token))
}

function chooseDownloadableFile(files: readonly ArchiveFile[], query: string): { name: string; format: BookFormat; size?: string } | undefined {
  const tokens = queryTokens(query)
  const candidates = files
    .map((file) => {
      const name = asString(file.name)
      if (!name || isLikelyDerivativeNoise(name)) return undefined
      const lowerName = name.toLowerCase()
      const format = normalizeFormatFromName(name, file.format)
      if (!DOWNLOADABLE_FORMATS.has(format)) return undefined
      const size = asString(file.size)
      const source = asString(file.source)?.toLowerCase()
      const tokenHits = tokens.filter((token) => lowerName.includes(token)).length
      const score =
        (format === "pdf" ? 30 : 20) +
        (source === "original" ? 10 : 0) +
        (/text|scan|itemimage/iu.test(name) ? 0 : 5) +
        tokenHits * 20 +
        (lowerName.includes("two") && lowerName.includes("essays") ? 80 : 0)
      return { name, format, size, score }
    })
    .filter((candidate): candidate is { name: string; format: BookFormat; size?: string; score: number } => Boolean(candidate))

  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return candidates[0]
}

function archiveDownloadUrl(identifier: string, fileName: string): string {
  const encodedIdentifier = encodeURIComponent(identifier)
  const encodedFileName = fileName.split("/").map((segment) => encodeURIComponent(segment)).join("/")
  return `${DOWNLOAD_BASE_URL}/${encodedIdentifier}/${encodedFileName}`
}

async function fetchJson(url: string, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BorgesLibrary/1.0)" },
    })
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function searchUrl(query: string, rows: number): string {
  const params = new URLSearchParams()
  params.set("q", `${query} AND mediatype:texts`)
  params.set("output", "json")
  params.set("rows", String(rows))
  params.set("page", "1")
  params.set("sort[]", "downloads desc")
  for (const field of ["identifier", "title", "creator", "date", "year", "language"]) {
    params.append("fl[]", field)
  }
  return `${ADVANCED_SEARCH_URL}?${params.toString()}`
}

function docsFromSearchPayload(payload: Awaited<ReturnType<typeof fetchJson>>): ArchiveSearchDoc[] {
  const parsed = Schema.decodeUnknownOption(ArchiveSearchPayloadSchema)(payload)
  return parsed._tag === "Some" ? [...parsed.value.response.docs] : []
}

function metadataFiles(payload: Awaited<ReturnType<typeof fetchJson>>): readonly ArchiveFile[] {
  const parsed = Schema.decodeUnknownOption(ArchiveMetadataSchema)(payload)
  return parsed._tag === "Some" ? parsed.value.files : []
}

export function searchInternetArchive(options: InternetArchiveSearchOptions): Effect.Effect<BookResult[], FetchError | ParseError> {
  const { query, limit = 10, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const boundedLimit = Math.max(1, Math.min(limit, 50))
  const metadataLimit = Math.max(boundedLimit, Math.min(boundedLimit * 3, 12))

  return Effect.gen(function* () {
    const searchPayload = yield* Effect.tryPromise({
      try: () => fetchJson(searchUrl(query, metadataLimit), timeoutMs),
      catch: (cause) => new FetchError({ message: `Internet Archive search failed: ${String(cause)}` }),
    })

    const docs = docsFromSearchPayload(searchPayload)
    const results: BookResult[] = []

    for (const doc of docs.slice(0, metadataLimit)) {
      if (results.length >= boundedLimit) break
      const identifier = asString(doc.identifier)
      if (!identifier) continue

      const metadataResult = yield* Effect.result(Effect.tryPromise({
        try: () => fetchJson(`${METADATA_BASE_URL}/${encodeURIComponent(identifier)}`, timeoutMs),
        catch: (cause) => new FetchError({ message: `Internet Archive metadata failed for ${identifier}: ${String(cause)}` }),
      }))
      if (!Result.isSuccess(metadataResult)) continue
      const file = chooseDownloadableFile(metadataFiles(metadataResult.success), query)
      if (!file) continue

      const authors = asStringArray(doc.creator)
      results.push({
        id: `internet_archive:${identifier}:${file.name}`,
        title: asString(doc.title) ?? identifier,
        authors: authors.length > 0 ? authors : ["Unknown"],
        year: parseYear(doc.year, doc.date),
        language: asStringArray(doc.language)[0],
        format: file.format,
        size: file.size,
        source: "internet_archive",
        sourceUrl: archiveDownloadUrl(identifier, file.name),
      })
    }

    return results
  })
}

export function downloadInternetArchive(options: DirectDownloadOptions): Effect.Effect<DownloadResult, DownloadError> {
  return downloadDirectFile(options)
}
