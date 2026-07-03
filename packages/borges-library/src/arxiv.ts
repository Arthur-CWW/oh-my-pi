import { Effect } from "effect"
import { DownloadError, FetchError, ParseError } from "./errors"
import { downloadDirectFile, type DirectDownloadOptions } from "./direct-download"
import type { BookResult, DownloadResult } from "./schemas"

const ARXIV_API_URL = "http://export.arxiv.org/api/query"
const DEFAULT_TIMEOUT_MS = 15_000

export interface ArxivSearchOptions {
  query: string
  limit?: number
  timeoutMs?: number
}

interface ArxivEntry {
  id: string
  title: string
  authors: string[]
  published?: string
  pdfUrl: string
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function compactXmlText(value: string): string {
  return decodeXmlEntities(value.replace(/<[^>]+>/gu, "").replace(/\s+/gu, " ").trim())
}

function firstTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "iu"))
  return match?.[1] ? compactXmlText(match[1]) : undefined
}

function tagValues(block: string, tag: string): string[] {
  const values: string[] = []
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "giu")
  let match: RegExpExecArray | null
  while ((match = regex.exec(block)) !== null) {
    if (match[1]) values.push(compactXmlText(match[1]))
  }
  return values
}

function arxivIdFromAbsUrl(absUrl: string): string {
  const raw = absUrl.replace(/^https?:\/\/arxiv\.org\/abs\//iu, "").trim()
  return raw || absUrl.trim()
}

function normalizePdfUrl(url: string, id: string): string {
  const raw = decodeXmlEntities(url).replace(/^http:\/\//iu, "https://")
  if (raw.includes("/pdf/")) return raw
  return `https://arxiv.org/pdf/${encodeURIComponent(id)}.pdf`
}

function pdfUrlFromEntry(block: string, id: string): string {
  const linkRegex = /<link\b([^>]*?)\/?>(?:<\/link>)?/giu
  let match: RegExpExecArray | null
  while ((match = linkRegex.exec(block)) !== null) {
    const attrs = match[1] ?? ""
    if (!/title=["']pdf["']/iu.test(attrs) && !/type=["']application\/pdf["']/iu.test(attrs)) continue
    const href = attrs.match(/href=["']([^"']+)["']/iu)?.[1]
    if (href) return normalizePdfUrl(href, id)
  }
  return `https://arxiv.org/pdf/${encodeURIComponent(id)}.pdf`
}

function parsePublishedYear(value: string | undefined): number | undefined {
  const year = value?.match(/^(\d{4})/u)?.[1]
  return year ? Number(year) : undefined
}

function parseEntries(xml: string, limit: number): ArxivEntry[] {
  const entries: ArxivEntry[] = []
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/giu
  let match: RegExpExecArray | null
  while ((match = entryRegex.exec(xml)) !== null) {
    if (entries.length >= limit) break
    const block = match[1] ?? ""
    const absUrl = firstTag(block, "id")
    const title = firstTag(block, "title")
    if (!absUrl || !title) continue
    const id = arxivIdFromAbsUrl(absUrl)
    const authors = tagValues(block, "name")
    entries.push({
      id,
      title,
      authors: authors.length > 0 ? authors : ["Unknown"],
      published: firstTag(block, "published"),
      pdfUrl: pdfUrlFromEntry(block, id),
    })
  }
  return entries
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BorgesLibrary/1.0; mailto:research@example.invalid)" },
    })
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

function searchUrl(query: string, limit: number): string {
  const params = new URLSearchParams()
  params.set("search_query", `all:"${query.replace(/"/gu, " ").trim()}"`)
  params.set("start", "0")
  params.set("max_results", String(Math.max(1, Math.min(limit, 50))))
  return `${ARXIV_API_URL}?${params.toString()}`
}

export function searchArxiv(options: ArxivSearchOptions): Effect.Effect<BookResult[], FetchError | ParseError> {
  const { query, limit = 10, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const boundedLimit = Math.max(1, Math.min(limit, 50))
  return Effect.gen(function* () {
    const xml = yield* Effect.tryPromise({
      try: () => fetchText(searchUrl(query, boundedLimit), timeoutMs),
      catch: (cause) => new FetchError({ message: `arXiv search failed: ${String(cause)}` }),
    })
    const entries = parseEntries(xml, boundedLimit)
    if (entries.length === 0 && !xml.includes("<feed")) {
      return yield* new ParseError({ message: "arXiv response was not an Atom feed" })
    }
    return entries.map((entry): BookResult => ({
      id: `arxiv:${entry.id}`,
      title: entry.title,
      authors: entry.authors,
      year: parsePublishedYear(entry.published),
      language: "English",
      format: "pdf",
      source: "arxiv",
      sourceUrl: entry.pdfUrl,
    }))
  })
}

export function downloadArxiv(options: DirectDownloadOptions): Effect.Effect<DownloadResult, DownloadError> {
  return downloadDirectFile(options)
}
