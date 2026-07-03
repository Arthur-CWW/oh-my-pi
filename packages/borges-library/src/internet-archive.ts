import { Effect, Result } from "effect"
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

export interface InternetArchiveSearchOptions {
  query: string
  limit?: number
  timeoutMs?: number
}

interface ArchiveSearchDoc {
  identifier?: unknown
  title?: unknown
  creator?: unknown
  date?: unknown
  year?: unknown
  language?: unknown
}

interface ArchiveFile {
  name?: unknown
  format?: unknown
  size?: unknown
  source?: unknown
}

interface ArchiveMetadata {
  files?: unknown
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number") return String(value)
  return undefined
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asString).filter(Boolean) as string[]
  const single = asString(value)
  if (!single) return []
  return single.split(/[,;]|\band\b/iu).map((part) => part.trim()).filter(Boolean)
}

function parseYear(...values: unknown[]): number | undefined {
  for (const value of values) {
    const text = asString(value)
    const year = text?.match(/\b(1[5-9]\d{2}|20\d{2})\b/u)?.[1]
    if (year) return Number(year)
  }
  return undefined
}

function normalizeFormatFromName(name: string, format: unknown): BookFormat {
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

function chooseDownloadableFile(files: unknown, query: string): { name: string; format: BookFormat; size?: string } | undefined {
  if (!Array.isArray(files)) return undefined
  const tokens = queryTokens(query)
  const candidates = files
    .map((file) => asRecord(file) as ArchiveFile | undefined)
    .filter(Boolean)
    .map((file) => {
      const name = asString(file?.name)
      if (!name || isLikelyDerivativeNoise(name)) return undefined
      const lowerName = name.toLowerCase()
      const format = normalizeFormatFromName(name, file?.format)
      if (!DOWNLOADABLE_FORMATS.has(format)) return undefined
      const size = asString(file?.size)
      const source = asString(file?.source)?.toLowerCase()
      const tokenHits = tokens.filter((token) => lowerName.includes(token)).length
      const score =
        (format === "pdf" ? 30 : 20) +
        (source === "original" ? 10 : 0) +
        (/text|scan|itemimage/iu.test(name) ? 0 : 5) +
        tokenHits * 20 +
        (lowerName.includes("two") && lowerName.includes("essays") ? 80 : 0)
      return { name, format, size, score }
    })
    .filter(Boolean) as Array<{ name: string; format: BookFormat; size?: string; score: number }>

  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return candidates[0]
}

function archiveDownloadUrl(identifier: string, fileName: string): string {
  const encodedIdentifier = encodeURIComponent(identifier)
  const encodedFileName = fileName.split("/").map((segment) => encodeURIComponent(segment)).join("/")
  return `${DOWNLOAD_BASE_URL}/${encodedIdentifier}/${encodedFileName}`
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
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

function docsFromSearchPayload(payload: unknown): ArchiveSearchDoc[] {
  const response = asRecord(asRecord(payload)?.response)
  const docs = response?.docs
  if (!Array.isArray(docs)) return []
  return docs.map((doc) => asRecord(doc) as ArchiveSearchDoc | undefined).filter(Boolean) as ArchiveSearchDoc[]
}

function metadataFiles(payload: unknown): unknown {
  return (asRecord(payload) as ArchiveMetadata | undefined)?.files
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

      results.push({
        id: `internet_archive:${identifier}:${file.name}`,
        title: asString(doc.title) ?? identifier,
        authors: asStringArray(doc.creator).length > 0 ? asStringArray(doc.creator) : ["Unknown"],
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
