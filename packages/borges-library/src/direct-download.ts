import { Effect } from "effect"
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, extname, join } from "node:path"
import { DownloadError } from "./errors"
import { type BookFormat, type BookResult, type DownloadResult } from "./schemas"

const BOOK_FORMAT_EXTENSIONS = new Set(["pdf", "epub", "mobi", "azw3", "djvu", "txt"])
const HTML_ERROR_MARKERS = [
  "<!doctype html",
  "<html",
  "<title>",
  "captcha",
  "checking your browser",
  "cloudflare",
  "access denied",
  "forbidden",
]

export interface DirectDownloadOptions {
  result: BookResult
  outDir?: string
  retries?: number
  timeoutMs?: number
}

function normalizeFormat(ext: string | undefined): BookFormat {
  const normalized = (ext ?? "unknown").toLowerCase().replace(/^\./, "").trim()
  switch (normalized) {
    case "pdf":
    case "epub":
    case "mobi":
    case "azw3":
    case "djvu":
    case "txt":
      return normalized
    default:
      return "unknown"
  }
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

function getHeader(headers: Headers, name: string): string | undefined {
  return headers.get(name) ?? undefined
}

function filenameFromContentDisposition(contentDisposition: string | undefined): string | undefined {
  if (!contentDisposition) return undefined
  const encoded = contentDisposition.match(/filename\*=UTF-8''([^;\n]+)/i)?.[1]
  if (encoded) return decodeMaybeEncodedFilename(encoded.replace(/^["']|["']$/g, ""))
  return contentDisposition.match(/filename[^;=\n]*=((["']).*?\2|[^;\n]*)/i)?.[1]?.replace(/^["']|["']$/g, "")
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

function inferFormat(result: BookResult, downloadUrl: string, headers?: Headers): BookFormat {
  const headerName = filenameFromContentDisposition(headers ? getHeader(headers, "content-disposition") : undefined)
  const headerFormat = normalizeFormat(extname(headerName ?? ""))
  if (headerFormat !== "unknown") return headerFormat

  const urlFormat = normalizeFormat(extname(filenameFromUrl(downloadUrl) ?? ""))
  if (urlFormat !== "unknown") return urlFormat

  if (result.format !== "unknown") return result.format

  return formatFromContentType(headers ? getHeader(headers, "content-type") : undefined)
}

function resolveDownloadTarget(result: BookResult, dir: string, downloadUrl: string, headers?: Headers): { filePath: string; fileName: string; format: BookFormat } {
  const format = inferFormat(result, downloadUrl, headers)
  const extension = format === "unknown" ? "bin" : format
  const headerName = filenameFromContentDisposition(headers ? getHeader(headers, "content-disposition") : undefined)
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

export function validateDirectBookBytes(bytes: Uint8Array, format: BookFormat, contentType?: string): string | undefined {
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
    const invalidReason = validateDirectBookBytes(bytes, format)
    return invalidReason ? undefined : { bytes: size }
  } catch (cause) {
    if (cause && typeof cause === "object" && isMissingFileError(cause)) return undefined
    throw cause
  }
}

async function writeFileAtomically(filePath: string, bytes: Uint8Array, format: BookFormat): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  try {
    await writeFile(tempPath, bytes)
    const { bytes: prefix } = await readFilePrefix(tempPath)
    const invalidReason = validateDirectBookBytes(prefix, format)
    if (invalidReason) throw new Error(invalidReason)
    await rename(tempPath, filePath)
  } catch (cause) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw cause
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BorgesLibrary/1.0)" },
    })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchWithRetry(url: string, retries: number, timeoutMs: number): Promise<Response> {
  let lastErrorMessage = "request failed"
  const attempts = Math.max(0, retries) + 1
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchWithTimeout(url, timeoutMs)
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) return response
    } catch (cause) {
      lastErrorMessage = String(cause)
    }
  }
  throw new Error(lastErrorMessage)
}

export function downloadDirectFile(options: DirectDownloadOptions): Effect.Effect<DownloadResult, DownloadError> {
  const { result, outDir, retries = 2, timeoutMs = 60_000 } = options
  const downloadUrl = result.sourceUrl

  return Effect.gen(function* () {
    if (!downloadUrl.startsWith("http://") && !downloadUrl.startsWith("https://")) {
      return yield* new DownloadError({ message: `Direct download sourceUrl is not absolute: ${downloadUrl}` })
    }

    const dir = outDir ?? `${process.env.HOME ?? "."}/.borges-library/downloads`
    yield* Effect.tryPromise({
      try: () => mkdir(dir, { recursive: true }),
      catch: (cause) => new DownloadError({ message: `Failed to create download directory: ${String(cause)}` }),
    })

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

    const response = yield* Effect.tryPromise({
      try: () => fetchWithRetry(downloadUrl, retries, timeoutMs),
      catch: (cause) => new DownloadError({ message: `Direct download request failed: ${String(cause)}` }),
    })
    if (response.status < 200 || response.status >= 300) {
      return yield* new DownloadError({ message: `Direct download request failed with status: ${response.status}` })
    }

    const target = resolveDownloadTarget(result, dir, downloadUrl, response.headers)
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

    const bytes = yield* Effect.tryPromise({
      try: async () => new Uint8Array(await response.arrayBuffer()),
      catch: (cause) => new DownloadError({ message: `Failed to read direct download body: ${String(cause)}` }),
    })
    const invalidReason = validateDirectBookBytes(bytes, target.format, getHeader(response.headers, "content-type"))
    if (invalidReason) {
      return yield* new DownloadError({ message: `Rejected direct download: ${invalidReason}` })
    }

    yield* Effect.tryPromise({
      try: () => writeFileAtomically(target.filePath, bytes, target.format),
      catch: (cause) => new DownloadError({ message: `Failed to write direct file atomically: ${String(cause)}` }),
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
