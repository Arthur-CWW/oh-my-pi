import { existsSync, readdirSync, statSync } from "node:fs"
import { basename, extname, join, resolve, sep } from "node:path"

import { AlignmentReadError, readAlignment, type Alignment } from "./alignment"
import type { DaemonPaths } from "./paths"

interface ShadowingAssetOk {
  slug: string
  mediaFile: string
  durationMs: number
  sentenceCount: number
  asr: string
  createdAt: string
}

interface ShadowingAssetWarning {
  slug: string
  mediaFile: null
  durationMs: null
  sentenceCount: null
  asr: null
  createdAt: string | null
  warning: string
}

type ShadowingAssetSummary = ShadowingAssetOk | ShadowingAssetWarning

interface RangeBounds {
  start: number
  end: number
}

export async function handleShadowingApi(request: Request, paths: DaemonPaths): Promise<Response | null> {
  const pathname = new URL(request.url).pathname

  try {
    if (request.method === "GET" && pathname === "/api/shadowing/assets") return handleAssetList(paths)
    if (request.method === "GET" && pathname.startsWith("/api/shadowing/assets/")) {
      return handleAssetDetail(request, pathname, paths)
    }
  } catch (error) {
    if (error instanceof AlignmentReadError) return jsonError(error.message, 400)
    if (error instanceof BadRequestError) return jsonError(error.message, 400)
    if (error instanceof NotFoundError) return jsonError(error.message, 404)
    throw error
  }

  return null
}

function handleAssetList(paths: DaemonPaths): Response {
  if (!existsSync(paths.shadowingDir)) return jsonResponse([])

  const entries = readdirSync(paths.shadowingDir, { withFileTypes: true })
  const assets: ShadowingAssetSummary[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const slug = entry.name
    const assetDir = join(paths.shadowingDir, slug)
    assets.push(readAssetSummary(slug, assetDir))
  }
  assets.sort((left, right) => left.slug.localeCompare(right.slug))
  return jsonResponse(assets)
}

function handleAssetDetail(request: Request, pathname: string, paths: DaemonPaths): Response {
  if (pathname.endsWith("/alignment")) {
    const slug = decodeSlug(pathname.slice("/api/shadowing/assets/".length, -"/alignment".length))
    const asset = readAsset(slug, paths)
    return jsonResponse(asset.alignment)
  }

  if (pathname.endsWith("/media")) {
    const slug = decodeSlug(pathname.slice("/api/shadowing/assets/".length, -"/media".length))
    const asset = readAsset(slug, paths)
    return serveMedia(request, asset.mediaPath)
  }

  throw new NotFoundError("unknown route")
}

function readAssetSummary(slug: string, assetDir: string): ShadowingAssetSummary {
  try {
    const alignmentPath = join(assetDir, "alignment.json")
    const alignment = readAlignment(alignmentPath)
    const mediaPath = resolveMediaPath(assetDir, alignment)
    return {
      slug,
      mediaFile: basename(mediaPath),
      durationMs: alignment.media.durationMs,
      sentenceCount: alignment.sentences.length,
      asr: alignment.media.asr,
      createdAt: statSync(alignmentPath).mtime.toISOString(),
    }
  } catch (error) {
    return {
      slug,
      mediaFile: null,
      durationMs: null,
      sentenceCount: null,
      asr: null,
      createdAt: safeCreatedAt(assetDir),
      warning: error instanceof Error ? error.message : "malformed shadowing asset",
    }
  }
}

function readAsset(slug: string, paths: DaemonPaths): { alignment: Alignment; mediaPath: string } {
  const assetDir = resolveInside(paths.shadowingDir, slug)
  const alignmentPath = join(assetDir, "alignment.json")
  const alignment = readAlignment(alignmentPath)
  return { alignment, mediaPath: resolveMediaPath(assetDir, alignment) }
}

function resolveMediaPath(assetDir: string, alignment: Alignment): string {
  const expectedName = basename(alignment.media.file)
  const expectedPath = join(assetDir, expectedName)
  if (existsSync(expectedPath) && statSync(expectedPath).isFile()) return expectedPath

  const mediaFiles = readdirSync(assetDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== "alignment.json" && isMediaExtension(entry.name))
    .map((entry) => join(assetDir, entry.name))

  if (mediaFiles.length === 1) return mediaFiles[0]
  if (mediaFiles.length === 0) throw new NotFoundError("shadowing media file missing")
  throw new BadRequestError("shadowing asset has multiple media files")
}

function serveMedia(request: Request, mediaPath: string): Response {
  const stat = statSync(mediaPath)
  if (!stat.isFile()) throw new NotFoundError("shadowing media file missing")

  const contentType = mediaContentType(mediaPath)
  const file = Bun.file(mediaPath)
  const range = request.headers.get("range")
  if (range === null) {
    return new Response(file, {
      headers: {
        "accept-ranges": "bytes",
        "content-length": String(stat.size),
        "content-type": contentType,
      },
    })
  }

  const bounds = parseRange(range, stat.size)
  if (bounds === null) {
    return new Response(null, {
      status: 416,
      headers: {
        "accept-ranges": "bytes",
        "content-range": `bytes */${stat.size}`,
      },
    })
  }

  return new Response(file.slice(bounds.start, bounds.end + 1), {
    status: 206,
    headers: {
      "accept-ranges": "bytes",
      "content-length": String(bounds.end - bounds.start + 1),
      "content-range": `bytes ${bounds.start}-${bounds.end}/${stat.size}`,
      "content-type": contentType,
    },
  })
}

function parseRange(header: string, size: number): RangeBounds | null {
  if (!header.startsWith("bytes=") || size <= 0) return null
  const spec = header.slice("bytes=".length)
  if (spec.includes(",")) return null

  const dash = spec.indexOf("-")
  if (dash < 0) return null

  const startText = spec.slice(0, dash)
  const endText = spec.slice(dash + 1)
  if (startText.length === 0) {
    const suffixLength = parseRangeNumber(endText)
    if (suffixLength === null || suffixLength === 0) return null
    const start = Math.max(size - suffixLength, 0)
    return { start, end: size - 1 }
  }

  const start = parseRangeNumber(startText)
  if (start === null || start >= size) return null
  const explicitEnd = endText.length === 0 ? size - 1 : parseRangeNumber(endText)
  if (explicitEnd === null || explicitEnd < start) return null
  return { start, end: Math.min(explicitEnd, size - 1) }
}

function parseRangeNumber(text: string): number | null {
  if (text.length === 0) return null
  for (const char of text) {
    if (char < "0" || char > "9") return null
  }
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value < 0) return null
  return value
}

function decodeSlug(encoded: string): string {
  if (encoded.length === 0 || encoded.includes("/")) throw new NotFoundError("unknown route")

  let slug: string
  try {
    slug = decodeURIComponent(encoded)
  } catch {
    throw new BadRequestError("malformed slug")
  }

  if (slug.length === 0 || slug.includes("/") || slug.includes(sep)) throw new NotFoundError("unknown route")
  return slug
}

function resolveInside(root: string, child: string): string {
  const rootPath = resolve(root)
  const childPath = resolve(rootPath, child)
  if (childPath !== rootPath && childPath.startsWith(`${rootPath}${sep}`)) return childPath
  throw new NotFoundError("unknown route")
}

function safeCreatedAt(assetDir: string): string | null {
  try {
    return statSync(assetDir).mtime.toISOString()
  } catch {
    return null
  }
}

function isMediaExtension(path: string): boolean {
  const extension = extname(path).toLowerCase()
  return extension === ".mp3" || extension === ".wav" || extension === ".m4a" || extension === ".mp4"
}

function mediaContentType(path: string): string {
  const extension = extname(path).toLowerCase()
  if (extension === ".mp3") return "audio/mpeg"
  if (extension === ".wav") return "audio/wav"
  if (extension === ".m4a") return "audio/mp4"
  if (extension === ".mp4") return "video/mp4"
  return "application/octet-stream"
}

function jsonResponse(body: object | readonly object[], status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

function jsonError(error: string, status: number): Response {
  return jsonResponse({ error }, status)
}

class BadRequestError extends Error {}
class NotFoundError extends Error {}
