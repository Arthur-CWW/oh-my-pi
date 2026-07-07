import { Effect, Result, Schema } from "effect"
import type { HttpClient } from "effect/unstable/http"
import { HttpClient as HttpClientService } from "effect/unstable/http"
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { mkdir, open, rename, rm, stat } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import { BlockedError, DownloadError, FetchError, ParseError } from "./errors"
import { discoverOpenSlumMirrors, isChallengeOrErrorHtml, type OpenSlumDiscoveryOptions } from "./mirrors"
import { BookFormatSchema, type BookFormat, type BookResult, type DownloadResult } from "./schemas"

const DEFAULT_BASE_URL = "https://libgen.li"
const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
}
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const BOOK_FORMAT_EXTENSIONS = new Set(["pdf", "epub", "mobi", "azw3", "djvu", "txt"])
const HTML_ERROR_MARKERS = [
  "<!doctype html",
  "<html",
  "<title>",
  "captcha",
  "checking your browser",
  "cloudflare",
  "access denied",
  "not found",
  "temporarily unavailable",
]

export interface SearchPreferences {
  preferredAuthors?: readonly string[]
  preferredTranslators?: readonly string[]
  preferredFormats?: readonly BookFormat[]
  preferredLanguages?: readonly string[]
  preferredKeywords?: readonly string[]
}

export interface SearchOptions extends SearchPreferences {
  query: string
  limit?: number
  baseUrl?: string
  baseUrls?: readonly string[]
  retries?: number
  mirrorDiscovery?: boolean | OpenSlumDiscoveryOptions
}

export interface DownloadOptions {
  result: BookResult
  outDir?: string
  baseUrl?: string
  retries?: number
}

function resolveBaseUrl(baseUrl?: string): string {
  return normalizeBaseUrl(baseUrl ?? DEFAULT_BASE_URL)
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
  return { ...(mirrorDiscovery === true ? {} : mirrorDiscovery), groups: ["libgen"] }
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

function normalizeFormat(ext: string | undefined): BookFormat {
  const normalized = (ext ?? "unknown").toLowerCase().replace(/^\./, "").trim()
  const parsed = Schema.decodeUnknownOption(BookFormatSchema)(normalized)
  return parsed._tag === "Some" ? parsed.value : "unknown"
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 160)
    .trim()
  return cleaned || "book"
}

function decodeMaybeEncodedFilename(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function getHeader(headers: Record<string, string | undefined>, name: string): string | undefined {
  const direct = headers[name]
  if (direct) return direct
  const lowerName = name.toLowerCase()
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === lowerName)
  return entry?.[1]
}

function filenameFromContentDisposition(contentDisposition: string | undefined): string | undefined {
  if (!contentDisposition) return undefined
  const encoded = contentDisposition.match(/filename\*=UTF-8''([^;\n]+)/i)?.[1]
  if (encoded) return decodeMaybeEncodedFilename(encoded.replace(/^["']|["']$/g, ""))
  return contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i)?.[1]?.replace(/^["']|["']$/g, "")
}

function filenameFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    const name = basename(parsed.pathname)
    return name && name !== "/" ? decodeMaybeEncodedFilename(name) : undefined
  } catch {
    const name = url.split("/").pop()?.split("?")[0]
    return name ? decodeMaybeEncodedFilename(name) : undefined
  }
}

function formatFromContentType(contentType: string | undefined): BookFormat {
  const normalized = (contentType ?? "").toLowerCase()
  if (normalized.includes("pdf")) return "pdf"
  if (normalized.includes("epub")) return "epub"
  if (normalized.includes("mobipocket")) return "mobi"
  if (normalized.includes("djvu")) return "djvu"
  if (normalized.startsWith("text/plain")) return "txt"
  return "unknown"
}

function inferFormat(result: BookResult, downloadUrl: string, headers: Record<string, string | undefined> = {}): BookFormat {
  const headerName = filenameFromContentDisposition(getHeader(headers, "content-disposition"))
  const headerFormat = normalizeFormat(extname(headerName ?? ""))
  if (headerFormat !== "unknown") return headerFormat

  const urlFormat = normalizeFormat(extname(filenameFromUrl(downloadUrl) ?? ""))
  if (urlFormat !== "unknown") return urlFormat

  if (result.format !== "unknown") return result.format

  return formatFromContentType(getHeader(headers, "content-type"))
}

function resolveDownloadTarget(
  result: BookResult,
  dir: string,
  downloadUrl: string,
  headers: Record<string, string | undefined> = {},
): { filePath: string; fileName: string; format: BookFormat } {
  const format = inferFormat(result, downloadUrl, headers)
  const extension = format === "unknown" ? "bin" : format
  const headerName = filenameFromContentDisposition(getHeader(headers, "content-disposition"))
  const urlName = filenameFromUrl(downloadUrl)
  const rawName =
    headerName ??
    (normalizeFormat(extname(urlName ?? "")) !== "unknown" ? urlName : undefined) ??
    `${result.title}_${result.id.slice(0, 8)}`

  let fileName = sanitizeFilename(rawName)
  const currentExtension = extname(fileName)
  const currentFormat = normalizeFormat(currentExtension)
  if (currentFormat === "unknown" || currentFormat !== extension) {
    if (currentExtension && BOOK_FORMAT_EXTENSIONS.has(currentExtension.slice(1).toLowerCase())) {
      fileName = fileName.slice(0, -currentExtension.length)
    }
    fileName = `${fileName}.${extension}`
  }

  return { filePath: join(dir, fileName), fileName, format }
}

function looksLikeHtmlOrError(bytes: Uint8Array, contentType?: string): boolean {
  if ((contentType ?? "").toLowerCase().includes("text/html")) return true
  const sample = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, Math.min(bytes.length, 4096)))
  const normalized = sample.trimStart().toLowerCase()
  return HTML_ERROR_MARKERS.some((marker) => normalized.includes(marker))
}

function hasBinaryByte(bytes: Uint8Array): boolean {
  return bytes.some((byte) => byte === 0 || (byte < 7 && byte !== 9 && byte !== 10 && byte !== 13))
}

function validateBookBytes(bytes: Uint8Array, format: BookFormat, contentType?: string): string | undefined {
  if (bytes.byteLength === 0) return "download body is empty"
  if (looksLikeHtmlOrError(bytes, contentType)) return "download body looks like an HTML/error page"

  const textSample = new TextDecoder("latin1", { fatal: false }).decode(bytes.slice(0, Math.min(bytes.length, 8192)))
  switch (format) {
    case "pdf":
      return textSample.startsWith("%PDF-") ? undefined : "download body is not a PDF"
    case "epub":
      return bytes[0] === 0x50 && bytes[1] === 0x4b ? undefined : "download body is not an EPUB/ZIP container"
    case "mobi":
    case "azw3":
      return textSample.includes("BOOKMOBI") || textSample.includes("MOBI") ? undefined : "download body is not a MOBI/AZW3 file"
    case "djvu":
      return textSample.startsWith("AT&TFORM") && /DJV[UM]/.test(textSample) ? undefined : "download body is not a DJVU file"
    case "txt":
      return hasBinaryByte(bytes.slice(0, Math.min(bytes.length, 4096))) ? "download body is not plain text" : undefined
    case "unknown":
      return undefined
  }
}

async function readFilePrefix(filePath: string, length = 8192): Promise<{ bytes: Uint8Array; size: number }> {
  const file = await open(filePath, "r")
  try {
    const info = await file.stat()
    const buffer = new Uint8Array(Math.min(length, info.size))
    await file.read(buffer, 0, buffer.byteLength, 0)
    return { bytes: buffer, size: info.size }
  } finally {
    await file.close()
  }
}

function isMissingFileError(cause: object): boolean {
  return "code" in cause && cause.code === "ENOENT"
}

async function validExistingFile(filePath: string, format: BookFormat): Promise<{ bytes: number } | undefined> {
  try {
    const { bytes, size } = await readFilePrefix(filePath)
    const invalidReason = validateBookBytes(bytes, format)
    return invalidReason ? undefined : { bytes: size }
  } catch (cause) {
    if (cause && typeof cause === "object" && isMissingFileError(cause)) return undefined
    throw cause
  }
}

async function writeFileAtomically(filePath: string, bytes: Uint8Array, format: BookFormat): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  try {
    await Bun.write(tempPath, bytes)
    const { bytes: prefix } = await readFilePrefix(tempPath)
    const invalidReason = validateBookBytes(prefix, format)
    if (invalidReason) throw new Error(invalidReason)
    await rename(tempPath, filePath)
  } catch (cause) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw cause
  }
}

function getWithRetry(
  url: string,
  options: { timeout: "15 seconds" | "60 seconds"; retries: number; label: string; errorKind: "fetch" },
): Effect.Effect<HttpClientResponse.HttpClientResponse, FetchError, HttpClient.HttpClient>
function getWithRetry(
  url: string,
  options: { timeout: "15 seconds" | "60 seconds"; retries: number; label: string; errorKind: "download" },
): Effect.Effect<HttpClientResponse.HttpClientResponse, DownloadError, HttpClient.HttpClient>
function getWithRetry(
  url: string,
  options: { timeout: "15 seconds" | "60 seconds"; retries: number; label: string; errorKind: "fetch" | "download" },
): Effect.Effect<HttpClientResponse.HttpClientResponse, FetchError | DownloadError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    let lastFailureMessage = "request failed"
    const attempts = Math.max(0, options.retries) + 1
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const requestResult = yield* Effect.result(
        HttpClientService.get(url, { headers: DEFAULT_HEADERS }).pipe(Effect.timeout(options.timeout)),
      )
      if (Result.isSuccess(requestResult)) {
        const response = requestResult.success
        if (TRANSIENT_STATUSES.has(response.status) && attempt < attempts) continue
        return response
      }
      lastFailureMessage = String(requestResult.failure)
    }

    const message = `${options.label} request failed after ${attempts} attempt(s): ${lastFailureMessage}`
    if (options.errorKind === "download") {
      return yield* new DownloadError({ message })
    }
    return yield* new FetchError({ message })
  })
}

function hasSearchPreferences(options: SearchPreferences): boolean {
  return Boolean(
    options.preferredAuthors?.length ||
      options.preferredTranslators?.length ||
      options.preferredFormats?.length ||
      options.preferredLanguages?.length ||
      options.preferredKeywords?.length,
  )
}

function includesAny(haystack: string, needles: readonly string[] | undefined): boolean {
  if (!needles?.length) return false
  const normalizedHaystack = haystack.toLowerCase()
  return needles.some((needle) => normalizedHaystack.includes(needle.toLowerCase()))
}

function scoreResult(result: BookResult, options: SearchPreferences): number {
  const title = result.title.toLowerCase()
  const authors = result.authors.join(" ").toLowerCase()
  const language = (result.language ?? "").toLowerCase()
  const haystack = `${title} ${authors}`
  let score = 0

  if (options.preferredFormats?.includes(result.format)) score += 40
  if (includesAny(authors, options.preferredAuthors)) score += 30
  if (includesAny(haystack, options.preferredTranslators)) score += 20
  if (includesAny(language, options.preferredLanguages)) score += 15
  if (includesAny(haystack, options.preferredKeywords)) score += 10

  return score
}

function rankResults(results: BookResult[], options: SearchPreferences): BookResult[] {
  if (!hasSearchPreferences(options)) return results
  return results
    .map((result, index) => ({ result, index, score: scoreResult(result, options) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ result }) => result)
}

function parseSize(sizeText: string | undefined): string | undefined {
  if (!sizeText) return undefined
  const match = sizeText.match(/([0-9.]+\s*[KMGT]?B)/i)
  return match ? match[1] : sizeText.trim() || undefined
}

function parseHtmlResults(html: string, resolvedBase: string, limit: number, defaultUrl: string): BookResult[] {
  const tableMatch = html.match(/<table[^>]*id="tablelibgen"[^>]*>([\s\S]*?)<\/table>/i)
  if (!tableMatch) return []
  const tableContent = tableMatch[1]!

  const rowMatches = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || []
  const results: BookResult[] = []

  for (const rowContent of rowMatches) {
    if (results.length >= limit) break
    if (rowContent.includes("<th")) continue

    const cellMatches = rowContent.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []
    if (cellMatches.length < 8) continue

    const titleCell = cellMatches[0]!
    const hrefMatch = titleCell.match(/href="edition\.php\?id=([^"]+)"/i)
    if (!hrefMatch) continue
    const titleId = hrefMatch[1]!
    const titleMatch = titleCell.match(/<a[\s\S]*?href="edition\.php\?id=[^"]+"[\s\S]*?>([\s\S]*?)<\/a>/i)
    const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, "").trim() : ""
    if (!title) continue

    const editionUrl = `${resolvedBase}/edition.php?id=${titleId}`

    const authorsCell = cellMatches[1]!
    const authorsText = authorsCell.replace(/<[^>]*>/g, "").trim()
    const authors = authorsText ? authorsText.split(/[,;&]/).map((a) => a.trim()).filter(Boolean) : ["Unknown"]

    const yearCell = cellMatches[3]!
    const yearMatch = yearCell.match(/\d{4}/)
    const year = yearMatch ? Number(yearMatch[0]) : undefined

    const langCell = cellMatches[4]!
    const language = langCell.replace(/<[^>]*>/g, "").trim() || undefined

    const sizeCell = cellMatches[6]!
    const sizeText = sizeCell.replace(/<[^>]*>/g, "").trim()

    const formatCell = cellMatches[7]!
    const formatText = formatCell.replace(/<[^>]*>/g, "").trim()
    const md5Match = rowContent.match(/href="\/?ads\.php\?md5=([^"]+)"/i)
    const id = md5Match ? md5Match[1]! : titleId
    const sourceUrl = md5Match ? `${resolvedBase}/ads.php?md5=${id}` : editionUrl

    results.push({
      id,
      title,
      authors,
      year,
      language,
      format: normalizeFormat(formatText),
      size: parseSize(sizeText),
      source: "borges_library",
      sourceUrl,
    })
  }

  return results
}

function parseGetHref(html: string): string | undefined {
  const anchorRegex = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = anchorRegex.exec(html)) !== null) {
    const href = m[1]!
    const text = m[2]!.replace(/<[^>]*>/g, "").trim().toUpperCase()
    if (href.startsWith("get.php")) {
      return href
    }
    if (text === "GET") {
      return href
    }
  }
  return undefined
}

function searchLibraryGenesisFromBase(
  options: SearchOptions,
  resolvedBase: string,
): Effect.Effect<BookResult[], FetchError | ParseError | BlockedError, HttpClient.HttpClient> {
  const { query, limit = 10, retries = 2 } = options
  const encodedQuery = encodeURIComponent(query)
  const url =
    `${resolvedBase}/index.php?req=${encodedQuery}` +
    "&columns%5B%5D=t&columns%5B%5D=a&columns%5B%5D=s&columns%5B%5D=y&columns%5B%5D=p&columns%5B%5D=i" +
    "&objects%5B%5D=f&objects%5B%5D=e&objects%5B%5D=s&objects%5B%5D=a&objects%5B%5D=w&objects%5B%5D=r" +
    "&topics%5B%5D=l&topics%5B%5D=c&topics%5B%5D=f&topics%5B%5D=s&topics%5B%5D=m&topics%5B%5D=r&topics%5B%5D=e" +
    `&res=${Math.min(Math.max(limit, 1), 100)}&filesuns=all`

  return Effect.gen(function* () {
    const response = yield* getWithRetry(url, {
      timeout: "15 seconds",
      retries,
      label: `Search (${resolvedBase})`,
      errorKind: "fetch",
    })


    const textResult = yield* Effect.result(response.text)
    if (!Result.isSuccess(textResult)) {
      return yield* new FetchError({ message: `Failed to read search response body from ${resolvedBase}: ${String(textResult.failure)}` })
    }
    const html = textResult.success

    if (isChallengeOrErrorHtml(html, response.status)) {
      return yield* new BlockedError({ message: `Search mirror blocked by CAPTCHA/challenge/error page: ${resolvedBase}` })
    }

    if (response.status < 200 || response.status >= 300) {
      return yield* new FetchError({ message: `Search request failed for ${resolvedBase} with status: ${response.status}` })
    }

    const results = rankResults(parseHtmlResults(html, resolvedBase, limit, url), options)
    if (results.length === 0 && html.includes("tablelibgen") === false) {
      return yield* new ParseError({ message: `Could not find results table in Borges Library response from ${resolvedBase}` })
    }

    return results
  })
}

export function searchLibraryGenesis(
  options: SearchOptions,
): Effect.Effect<BookResult[], FetchError | ParseError | BlockedError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const baseUrls = yield* resolveSearchBaseUrls(options)
    let lastFailure: FetchError | ParseError | BlockedError | undefined

    for (const resolvedBase of baseUrls) {
      const result = yield* Effect.result(searchLibraryGenesisFromBase(options, resolvedBase))
      if (Result.isSuccess(result)) return result.success
      lastFailure = result.failure
    }

    if (lastFailure) return yield* lastFailure
    return yield* new FetchError({ message: "No Borges Library search mirrors were available" })
  })
}

export function downloadLibraryGenesis(
  options: DownloadOptions,
): Effect.Effect<DownloadResult, FetchError | ParseError | DownloadError | BlockedError, HttpClient.HttpClient> {
  const { result, outDir, baseUrl, retries = 2 } = options
  const resolvedBase = resolveBaseUrl(baseUrl)

  return Effect.gen(function* () {
    const adsUrl = result.sourceUrl.startsWith("http") ? result.sourceUrl : `${resolvedBase}/${result.sourceUrl.replace(/^\//, "")}`
    const dir = outDir ?? `${process.env.HOME ?? "."}/.borges-library/downloads`

    yield* Effect.tryPromise({
      try: () => mkdir(dir, { recursive: true }),
      catch: (cause) => new DownloadError({ message: `Failed to create download directory: ${String(cause)}` }),
    })

    const adsResponse = yield* getWithRetry(adsUrl, {
      timeout: "15 seconds",
      retries,
      label: "Download page",
      errorKind: "fetch",
    })

    const adsTextResult = yield* Effect.result(adsResponse.text)
    if (!Result.isSuccess(adsTextResult)) {
      return yield* new FetchError({ message: `Failed to read download page response: ${String(adsTextResult.failure)}` })
    }
    const adsHtml = adsTextResult.success

    if (isChallengeOrErrorHtml(adsHtml, adsResponse.status)) {
      return yield* new BlockedError({ message: `Download page blocked by CAPTCHA/challenge/error page: ${adsUrl}` })
    }

    if (adsResponse.status < 200 || adsResponse.status >= 300) {
      return yield* new FetchError({ message: `Download page request failed with status: ${adsResponse.status}` })
    }

    const getHref = parseGetHref(adsHtml)
    if (!getHref) {
      return yield* new ParseError({ message: "Could not find GET download link on Borges Library download page" })
    }

    const downloadUrl = getHref.startsWith("http") ? getHref : `${resolvedBase}/${getHref.replace(/^\//, "")}`
    const initialTarget = resolveDownloadTarget(result, dir, downloadUrl)
    const initialExisting = yield* Effect.tryPromise({
      try: () => validExistingFile(initialTarget.filePath, initialTarget.format),
      catch: (cause) => new DownloadError({ message: `Failed to inspect existing file: ${String(cause)}` }),
    })
    if (initialExisting) {
      return {
        id: result.id,
        title: result.title,
        downloadedPath: initialTarget.filePath,
        downloadUrl,
        filename: initialTarget.fileName,
        bytes: initialExisting.bytes,
        format: initialTarget.format,
        skippedExisting: true,
        validated: true,
      }
    }

    const fileResponse = yield* getWithRetry(downloadUrl, {
      timeout: "60 seconds",
      retries,
      label: "Download",
      errorKind: "download",
    })

    if (fileResponse.status < 200 || fileResponse.status >= 300) {
      return yield* new DownloadError({ message: `Download request failed with status: ${fileResponse.status}` })
    }

    const responseHeaders = fileResponse.headers as Record<string, string | undefined>
    const target = resolveDownloadTarget(result, dir, downloadUrl, responseHeaders)
    const existing = yield* Effect.tryPromise({
      try: () => validExistingFile(target.filePath, target.format),
      catch: (cause) => new DownloadError({ message: `Failed to inspect existing file: ${String(cause)}` }),
    })
    if (existing) {
      return {
        id: result.id,
        title: result.title,
        downloadedPath: target.filePath,
        downloadUrl,
        filename: target.fileName,
        bytes: existing.bytes,
        format: target.format,
        skippedExisting: true,
        validated: true,
      }
    }

    const bufferResult = yield* Effect.result(fileResponse.arrayBuffer)
    if (!Result.isSuccess(bufferResult)) {
      return yield* new DownloadError({ message: `Failed to read download body: ${String(bufferResult.failure)}` })
    }
    const bytes = new Uint8Array(bufferResult.success)
    const bodySample = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, Math.min(bytes.length, 8192)))
    if (isChallengeOrErrorHtml(bodySample, fileResponse.status)) {
      return yield* new BlockedError({ message: `Download blocked by CAPTCHA/challenge/error page: ${downloadUrl}` })
    }
    const invalidReason = validateBookBytes(bytes, target.format, getHeader(responseHeaders, "content-type"))
    if (invalidReason) {
      return yield* new DownloadError({ message: `Rejected download: ${invalidReason}` })
    }

    yield* Effect.tryPromise({
      try: () => writeFileAtomically(target.filePath, bytes, target.format),
      catch: (cause) => new DownloadError({ message: `Failed to write file atomically: ${String(cause)}` }),
    })

    const written = yield* Effect.tryPromise({
      try: () => stat(target.filePath),
      catch: (cause) => new DownloadError({ message: `Failed to inspect written file: ${String(cause)}` }),
    })

    return {
      id: result.id,
      title: result.title,
      downloadedPath: target.filePath,
      downloadUrl,
      filename: target.fileName,
      bytes: written.size,
      format: target.format,
      skippedExisting: false,
      validated: true,
    }
  })
}
