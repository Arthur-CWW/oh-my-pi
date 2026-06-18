import { createHash } from "node:crypto"
import { mkdir, stat, writeFile } from "node:fs/promises"
import { extname, join, resolve } from "node:path"

import { appendTwitterArchiveJsonlLog, type JsonlLogDetails, type JsonlLogLevel, type TwitterArchiveLogEvent } from "./jsonl-log"

import type { ArchiveMedia, ArchiveMediaType } from "./schema"
import type { TwitterArchiveSqliteStore } from "./sqlite-store"

export const MEDIA_DOWNLOAD_DEFAULT_MEDIA_ROOT = "data/twitter-archive/media"
export const MEDIA_DOWNLOAD_DEFAULT_CONCURRENCY = 2
export const MEDIA_DOWNLOAD_HARD_MAX_CONCURRENCY = 4
export const MEDIA_DOWNLOAD_DEFAULT_MAX_ITEMS = 25

export type MediaDownloadStatus = "downloaded" | "skipped-existing" | "skipped-no-url" | "skipped-blocked-url" | "failed"
export type MediaDownloadLogLevel = JsonlLogLevel
export type MediaDownloadLogEntry = TwitterArchiveLogEvent & { component: "media-download" }

export interface MediaDownloadFetchRequestInit {
  headers?: Record<string, string>
  signal?: AbortSignal
}

export interface MediaDownloadResponseLike {
  ok: boolean
  status: number
  url?: string
  headers?: {
    get(name: string): string | null
  }
  arrayBuffer(): Promise<ArrayBuffer>
}

export type MediaDownloadFetchFunction = (
  url: string,
  init: MediaDownloadFetchRequestInit,
) => Promise<MediaDownloadResponseLike>


export type MediaDownloadLogger = (entry: MediaDownloadLogEntry) => void | Promise<void>

export interface DownloadArchivedMediaOptions {
  store: TwitterArchiveSqliteStore
  mediaRoot?: string
  fetchFn?: MediaDownloadFetchFunction
  logger?: MediaDownloadLogger
  logPath?: string
  runId?: string
  jobId?: string
  maxItems?: number
  concurrency?: number
  signal?: AbortSignal
  now?: () => string
}

export interface MediaDownloadItemResult {
  mediaId: string
  status: MediaDownloadStatus
  remoteUrl?: string
  localPath?: string
  contentType?: string
  contentHash?: string
  bytes?: number
  error?: string
}

export interface MediaDownloadCounts {
  total: number
  downloaded: number
  skippedExisting: number
  skippedNoUrl: number
  skippedBlockedUrl: number
  failed: number
}

export interface DownloadArchivedMediaResult {
  mediaRoot: string
  requestedMaxItems: number
  maxItems: number
  requestedConcurrency: number
  concurrency: number
  counts: MediaDownloadCounts
  items: MediaDownloadItemResult[]
}

interface DownloadCandidate {
  url: string
  contentType?: string
}

export async function downloadArchivedMedia(options: DownloadArchivedMediaOptions): Promise<DownloadArchivedMediaResult> {
  const mediaRoot = resolve(options.mediaRoot ?? MEDIA_DOWNLOAD_DEFAULT_MEDIA_ROOT)
  const fetchFn = options.fetchFn ?? defaultFetch
  const requestedMaxItems = options.maxItems ?? MEDIA_DOWNLOAD_DEFAULT_MAX_ITEMS
  const maxItems = normalizeMaxItems(requestedMaxItems)
  const requestedConcurrency = options.concurrency ?? MEDIA_DOWNLOAD_DEFAULT_CONCURRENCY
  const concurrency = clampConcurrency(requestedConcurrency)
  const now = options.now ?? (() => new Date().toISOString())
  const media = options.store.listMedia({ limit: maxItems })
  const items: MediaDownloadItemResult[] = new Array(media.length)

  await mkdir(mediaRoot, { recursive: true })
  await logMediaDownload(options, now, "info", "media-download.started", {
    mediaRoot,
    maxItems,
    concurrency,
    queued: media.length,
  })

  let nextIndex = 0
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex
      nextIndex += 1
      if (index >= media.length) {
        return
      }
      items[index] = await downloadMediaItem(media[index], {
        store: options.store,
        mediaRoot,
        fetchFn,
        logger: options.logger,
        logPath: options.logPath,
        runId: options.runId,
        jobId: options.jobId,
        signal: options.signal,
        now,
      })
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, media.length) }, () => worker()))
  const counts = countResults(items)
  await logMediaDownload(options, now, counts.failed > 0 ? "warn" : "info", "media-download.completed", {
    mediaRoot,
    total: counts.total,
    downloaded: counts.downloaded,
    skippedExisting: counts.skippedExisting,
    skippedNoUrl: counts.skippedNoUrl,
    skippedBlockedUrl: counts.skippedBlockedUrl,
    failed: counts.failed,
  })

  return {
    mediaRoot,
    requestedMaxItems,
    maxItems,
    requestedConcurrency,
    concurrency,
    counts,
    items,
  }
}

interface DownloadMediaItemOptions {
  store: TwitterArchiveSqliteStore
  mediaRoot: string
  fetchFn: MediaDownloadFetchFunction
  logger?: MediaDownloadLogger
  logPath?: string
  runId?: string
  jobId?: string
  signal?: AbortSignal
  now: () => string
}

async function downloadMediaItem(media: ArchiveMedia, options: DownloadMediaItemOptions): Promise<MediaDownloadItemResult> {
  if (media.localPath && (await fileExists(media.localPath))) {
    await logMediaDownload(options, options.now, "info", "media-download.skipped-existing", {
      mediaId: media.id,
      localPath: media.localPath,
    })
    return { mediaId: media.id, status: "skipped-existing", localPath: media.localPath }
  }

  const candidates = downloadCandidatesForMedia(media)
  const candidate = candidates.find((entry) => !isBlockedXApiUrl(entry.url))
  if (!candidate) {
    const status: MediaDownloadStatus = candidates.length === 0 ? "skipped-no-url" : "skipped-blocked-url"
    await logMediaDownload(options, options.now, status === "skipped-no-url" ? "warn" : "error", `media-download.${status}`, {
      mediaId: media.id,
      candidateCount: candidates.length,
    })
    return { mediaId: media.id, status }
  }

  try {
    const response = await options.fetchFn(candidate.url, {
      headers: { accept: acceptHeaderForMedia(media.type) },
      signal: options.signal,
    })
    if (!response.ok) {
      throw new Error(`Media fetch failed with HTTP ${response.status}`)
    }

    const body = new Uint8Array(await response.arrayBuffer())
    const contentHash = createHash("sha256").update(body).digest("hex")
    const contentType = normalizeContentType(response.headers?.get("content-type") ?? candidate.contentType)
    const localPath = join(
      mediaDirectoryForType(options.mediaRoot, media.type),
      `${safeFileStem(media.id)}-${contentHash.slice(0, 16)}${extensionForMedia(contentType, response.url ?? candidate.url, media.type)}`,
    )

    await mkdir(mediaDirectoryForType(options.mediaRoot, media.type), { recursive: true })
    await writeFile(localPath, body)
    options.store.updateMediaLocalPath(media.id, localPath, options.now())
    await logMediaDownload(options, options.now, "info", "media-download.downloaded", {
      mediaId: media.id,
      remoteUrl: candidate.url,
      localPath,
      contentHash,
      bytes: body.byteLength,
    })

    return {
      mediaId: media.id,
      status: "downloaded",
      remoteUrl: candidate.url,
      localPath,
      contentType,
      contentHash,
      bytes: body.byteLength,
    }
  } catch (error) {
    const message = errorMessage(error as Error | string | null | undefined)
    await logMediaDownload(options, options.now, "error", "media-download.failed", {
      mediaId: media.id,
      remoteUrl: candidate.url,
      error: message,
    })
    return { mediaId: media.id, status: "failed", remoteUrl: candidate.url, error: message }
  }
}

function downloadCandidatesForMedia(media: ArchiveMedia): DownloadCandidate[] {
  const candidates: DownloadCandidate[] = []
  const seen = new Set<string>()

  if (media.type === "video" || media.type === "gif") {
    for (const variant of [...(media.variants ?? [])].sort((left, right) => (right.bitrate ?? 0) - (left.bitrate ?? 0))) {
      addCandidate(candidates, seen, variant.url, variant.contentType)
    }
  }

  addCandidate(candidates, seen, media.remoteUrl)
  addCandidate(candidates, seen, media.previewImageUrl)
  return candidates
}

function addCandidate(candidates: DownloadCandidate[], seen: Set<string>, url: string | undefined, contentType?: string): void {
  if (!url || seen.has(url)) {
    return
  }
  seen.add(url)
  candidates.push({ url, contentType })
}

function countResults(items: readonly MediaDownloadItemResult[]): MediaDownloadCounts {
  const counts: MediaDownloadCounts = {
    total: items.length,
    downloaded: 0,
    skippedExisting: 0,
    skippedNoUrl: 0,
    skippedBlockedUrl: 0,
    failed: 0,
  }

  for (const item of items) {
    switch (item.status) {
      case "downloaded":
        counts.downloaded += 1
        break
      case "skipped-existing":
        counts.skippedExisting += 1
        break
      case "skipped-no-url":
        counts.skippedNoUrl += 1
        break
      case "skipped-blocked-url":
        counts.skippedBlockedUrl += 1
        break
      case "failed":
        counts.failed += 1
        break
    }
  }

  return counts
}

function clampConcurrency(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1
  }
  return Math.min(MEDIA_DOWNLOAD_HARD_MAX_CONCURRENCY, Math.floor(value))
}

function normalizeMaxItems(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Media download maxItems must be a non-negative finite number")
  }
  return Math.floor(value)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const existing = await stat(filePath)
    return existing.isFile()
  } catch (error) {
    if (isErrno(error as Error | string | object | null | undefined, "ENOENT")) {
      return false
    }
    throw error
  }
}

function mediaDirectoryForType(mediaRoot: string, type: ArchiveMediaType): string {
  if (type === "image") {
    return join(mediaRoot, "images")
  }
  if (type === "video" || type === "gif") {
    return join(mediaRoot, "videos")
  }
  return mediaRoot
}

function extensionForMedia(contentType: string | undefined, url: string, mediaType: ArchiveMediaType): string {
  const contentTypeExtension = contentType ? extensionForContentType(contentType) : undefined
  if (contentTypeExtension) {
    return contentTypeExtension
  }

  const urlExtension = extensionFromUrl(url)
  if (urlExtension) {
    return urlExtension
  }

  if (mediaType === "image") {
    return ".jpg"
  }
  if (mediaType === "gif") {
    return ".gif"
  }
  if (mediaType === "video") {
    return ".mp4"
  }
  return ".bin"
}

function extensionForContentType(contentType: string): string | undefined {
  switch (normalizeContentType(contentType)) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg"
    case "image/png":
      return ".png"
    case "image/gif":
      return ".gif"
    case "image/webp":
      return ".webp"
    case "video/mp4":
      return ".mp4"
    case "video/webm":
      return ".webm"
    case "video/quicktime":
      return ".mov"
    default:
      return undefined
  }
}

function extensionFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    const format = parsed.searchParams.get("format")
    if (format) {
      return safeExtension(format)
    }
    return safeExtension(extname(parsed.pathname))
  } catch {
    return safeExtension(extname(url))
  }
}

function safeExtension(extension: string): string | undefined {
  const normalized = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`
  switch (normalized) {
    case ".jpg":
    case ".jpeg":
      return ".jpg"
    case ".png":
    case ".gif":
    case ".webp":
    case ".mp4":
    case ".webm":
    case ".mov":
    case ".m4v":
      return normalized
    default:
      return undefined
  }
}

function normalizeContentType(contentType: string | undefined): string | undefined {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase()
}

function safeFileStem(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "")
  return safe.length > 0 ? safe : "media"
}

function acceptHeaderForMedia(type: ArchiveMediaType): string {
  if (type === "image") {
    return "image/*,*/*;q=0.8"
  }
  if (type === "video" || type === "gif") {
    return "video/*,image/gif,*/*;q=0.8"
  }
  return "*/*"
}

function isBlockedXApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    if (host === "api.x.com" || host === "api.twitter.com") {
      return true
    }
    if ((host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) && parsed.pathname.startsWith("/i/api/")) {
      return true
    }
    return false
  } catch {
    return true
  }
}

async function logMediaDownload(
  options: Pick<DownloadArchivedMediaOptions, "logger" | "logPath" | "runId" | "jobId">,
  now: () => string,
  level: MediaDownloadLogLevel,
  event: string,
  details: JsonlLogDetails,
): Promise<void> {
  const input = {
    component: "media-download",
    level,
    event,
    runId: options.runId,
    jobId: options.jobId,
    details,
  }

  if (options.logPath) {
    await appendTwitterArchiveJsonlLog(options.logPath, input)
  }

  if (options.logger) {
    await options.logger({ ...input, component: "media-download", timestamp: now() })
  }
}

function errorMessage(error: Error | string | null | undefined): string {
  return error instanceof Error ? error.message : String(error)
}

function isErrno(error: Error | string | object | null | undefined, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === code
}

async function defaultFetch(url: string, init: MediaDownloadFetchRequestInit): Promise<MediaDownloadResponseLike> {
  return fetch(url, init)
}
