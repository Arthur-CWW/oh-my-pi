import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs"
import { basename, extname, join, resolve, sep } from "node:path"
import type { Database } from "bun:sqlite"

import { readAlignment, type Alignment } from "./alignment"
import { openLedger } from "./ledger"
import type { DaemonPaths } from "./paths"
import { ensureReadingTables, getReadingDoc } from "./reading-store"

export type ReaderMediaKind = "audio" | "video"

export interface ImportReaderMediaInput {
  sourceDir: string
  title: string
  kind?: ReaderMediaKind
}

export interface AttachReaderMediaInput {
  docId: number
  sourceDir: string
  kind?: ReaderMediaKind
}

export interface ReaderMediaRecord {
  id: number
  docId: number
  slug: string
  kind: ReaderMediaKind
  file: string
  durationMs: number
  asr: string
  sentenceCount: number
  createdAt: string
}

export interface ReaderMediaSource {
  directory: string
  alignmentPath: string
  mediaPath: string
  alignment: Alignment
}

type NoRows = Record<string, never>
type RawReaderMediaRow = {
  id: number
  doc_id: number
  slug: string
  kind: string
  created_at: string
  file: string
  duration_ms: number
  asr: string
  sentence_count: number
}

const MEDIA_EXTENSIONS: Record<string, true> = {
  ".aac": true,
  ".flac": true,
  ".m4a": true,
  ".mkv": true,
  ".mov": true,
  ".mp3": true,
  ".mp4": true,
  ".ogg": true,
  ".wav": true,
  ".webm": true,
}

export function ensureReaderMediaTable(db: Database): void {
  ensureReadingTables(db)
  db.exec("PRAGMA foreign_keys = ON")
  db.exec(`
CREATE TABLE IF NOT EXISTS reader_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL UNIQUE REFERENCES reading_docs(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reader_media_doc_idx ON reader_media(doc_id);
`)
}

export function validateReaderMediaSource(sourceDir: string): ReaderMediaSource {
  const directory = resolve(sourceDir)
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`reader media source directory not found: ${sourceDir}`)
  }

  const alignmentPath = resolveInside(directory, "alignment.json")
  if (!existsSync(alignmentPath) || !statSync(alignmentPath).isFile()) {
    throw new Error("reader media source is missing alignment.json")
  }

  let alignment: Alignment
  try {
    alignment = readAlignment(alignmentPath)
  } catch (error) {
    throw new Error(`invalid alignment.json: ${error instanceof Error ? error.message : String(error)}`)
  }

  const mediaName = basename(alignment.media.file)
  if (mediaName.length === 0) {
    throw new Error("alignment media.file must name a file in the source directory")
  }
  const mediaPath = resolveInside(directory, mediaName)
  if (!existsSync(mediaPath) || !statSync(mediaPath).isFile()) {
    throw new Error(`reader media source is missing media file: ${mediaName}`)
  }
  if (!isMediaExtension(mediaPath)) {
    throw new Error(`unsupported reader media file type: ${extname(mediaPath) || "unknown"}`)
  }

  const files = readdirSync(directory, { withFileTypes: true })
  for (const entry of files) {
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`reader media source contains unsupported entry: ${entry.name}`)
    }
  }
  const mediaEntries = files.filter((entry) => entry.isFile() && isMediaExtension(entry.name))
  if (mediaEntries.length !== 1 || mediaEntries[0]!.name !== mediaName) {
    throw new Error("reader media source must contain exactly one media file matching alignment.json")
  }
  return { directory, alignmentPath, mediaPath, alignment }
}

export function importReaderMedia(paths: DaemonPaths, input: ImportReaderMediaInput): { docId: number; slug: string } {
  const title = input.title.trim()
  if (title.length === 0) throw new Error("reader media title must not be empty")
  if (input.kind !== undefined && input.kind !== "audio" && input.kind !== "video") {
    throw new Error("reader media kind must be audio or video")
  }

  const source = validateReaderMediaSource(input.sourceDir)
  const kind = input.kind ?? alignmentKind(source.alignment, source.mediaPath)
  const slug = makeSlug(title, source)
  const destination = resolveInside(paths.readerMediaDir, slug)
  if (existsSync(destination)) throw new Error(`reader media slug already exists: ${slug}`)

  mkdirSync(paths.readerMediaDir, { recursive: true })
  const db = openLedger(paths.ledgerDb)
  let copied = false
  try {
    ensureReaderMediaTable(db)
    if (db.query<{ id: number }, [string]>("SELECT id FROM reader_media WHERE slug = ?").get(slug) !== null) {
      throw new Error(`reader media slug already exists: ${slug}`)
    }
    copySource(source, destination)
    copied = true
    const result = db.transaction(() => {
      const createdAt = new Date().toISOString()
      const docResult = db
        .query<NoRows, [string, string, string | null, string]>(
          "INSERT INTO reading_docs (title, lang, source, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(title, "zh", `reader-media:${slug}`, createdAt)
      const docId = Number(docResult.lastInsertRowid)
      const insertParagraph = db.query<NoRows, [number, number, string]>(
        "INSERT INTO reading_paragraphs (doc_id, idx, text) VALUES (?, ?, ?)",
      )
      for (const [idx, sentence] of source.alignment.sentences.entries()) insertParagraph.run(docId, idx, sentence.text)
      db
        .query<NoRows, [number, string, string, string]>(
          "INSERT INTO reader_media (doc_id, slug, kind, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(docId, slug, kind, createdAt)
      return { docId, slug }
    })()
    return result
  } catch (error) {
    if (copied) rmSync(destination, { recursive: true, force: true })
    throw error
  } finally {
    db.close()
  }
}

export function attachReaderMedia(paths: DaemonPaths, input: AttachReaderMediaInput): { docId: number; slug: string } {
  if (!Number.isSafeInteger(input.docId) || input.docId <= 0) throw new Error("docId must be a positive integer")
  if (input.kind !== undefined && input.kind !== "audio" && input.kind !== "video") {
    throw new Error("reader media kind must be audio or video")
  }

  const source = validateReaderMediaSource(input.sourceDir)
  const db = openLedger(paths.ledgerDb)
  let destination: string | null = null
  try {
    ensureReaderMediaTable(db)
    const doc = getReadingDoc(db, input.docId)
    if (doc === null) throw new Error(`unknown reading doc: ${input.docId}`)
    const existing = db.query<{ id: number }, [number]>("SELECT id FROM reader_media WHERE doc_id = ?").get(input.docId)
    if (existing !== null) throw new Error(`reading doc already has attached media: ${input.docId}`)
    if (doc.paragraphs.length !== source.alignment.sentences.length) {
      throw new Error("alignment sentences do not exactly match reading document paragraphs")
    }
    for (const [idx, sentence] of source.alignment.sentences.entries()) {
      if (doc.paragraphs[idx] !== sentence.text) {
        throw new Error(`alignment sentence ${idx} does not exactly match reading document paragraph`)
      }
    }

    const kind = input.kind ?? alignmentKind(source.alignment, source.mediaPath)
    const slug = makeSlug(doc.title, source)
    destination = resolveInside(paths.readerMediaDir, slug)
    if (existsSync(destination)) throw new Error(`reader media slug already exists: ${slug}`)
    mkdirSync(paths.readerMediaDir, { recursive: true })
    copySource(source, destination)
    const createdAt = new Date().toISOString()
    db
      .query<NoRows, [number, string, string, string]>(
        "INSERT INTO reader_media (doc_id, slug, kind, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(input.docId, slug, kind, createdAt)
    return { docId: input.docId, slug }
  } catch (error) {
    if (destination !== null) rmSync(destination, { recursive: true, force: true })
    throw error
  } finally {
    db.close()
  }
}

export function listReaderMedia(paths: DaemonPaths): ReaderMediaRecord[] {
  const db = openLedger(paths.ledgerDb)
  try {
    ensureReaderMediaTable(db)
    const rows = db
      .query<Pick<RawReaderMediaRow, "id" | "doc_id" | "slug" | "kind" | "created_at">, []>(
        "SELECT id, doc_id, slug, kind, created_at FROM reader_media ORDER BY datetime(created_at) DESC, id DESC",
      )
      .all()
    return rows.map((row) => {
      const stored = readStoredSource(paths, row.slug)
      return {
        id: row.id,
        docId: row.doc_id,
        slug: row.slug,
        kind: asReaderMediaKind(row.kind),
        file: basename(stored.mediaPath),
        durationMs: stored.alignment.media.durationMs,
        asr: stored.alignment.media.asr,
        sentenceCount: stored.alignment.sentences.length,
        createdAt: row.created_at,
      }
    })
  } finally {
    db.close()
  }
}

export async function handleReaderMediaApi(request: Request, paths: DaemonPaths): Promise<Response | null> {
  if (request.method !== "GET") return null
  const pathname = new URL(request.url).pathname
  const match = /^\/api\/reader\/docs\/([^/]+)\/(media|media\/alignment|media\/file)$/u.exec(pathname)
  if (match === null) return null
  try {
    const docId = parseDocId(match[1]!)
    const media = readMediaRecord(paths, docId)
    if (match[2] === "media") {
      return jsonResponse({
        slug: media.slug,
        kind: media.kind,
        file: media.file,
        durationMs: media.durationMs,
        asr: media.asr,
        sentenceCount: media.sentenceCount,
      })
    }
    const stored = readStoredSource(paths, media.slug)
    if (match[2] === "media/alignment") return jsonResponse(stored.alignment)
    return serveMedia(request, stored.mediaPath)
  } catch (error) {
    if (error instanceof BadRequestError) return jsonError(error.message, 400)
    if (error instanceof NotFoundError) return jsonError(error.message, 404)
    throw error
  }
}

function readMediaRecord(paths: DaemonPaths, docId: number): ReaderMediaRecord {
  const db = openLedger(paths.ledgerDb)
  try {
    ensureReaderMediaTable(db)
    const row = db
      .query<RawReaderMediaRow, [number]>(
        `SELECT rm.id, rm.doc_id, rm.slug, rm.kind, rm.created_at,
                rm.slug AS file, 0 AS duration_ms, '' AS asr, 0 AS sentence_count
         FROM reader_media rm WHERE rm.doc_id = ?`,
      )
      .get(docId)
    if (row === null) throw new NotFoundError("reader media not found")
    const stored = readStoredSource(paths, row.slug)
    const alignment = stored.alignment
    return {
      id: row.id,
      docId: row.doc_id,
      slug: row.slug,
      kind: asReaderMediaKind(row.kind),
      file: basename(stored.mediaPath),
      durationMs: alignment.media.durationMs,
      asr: alignment.media.asr,
      sentenceCount: alignment.sentences.length,
      createdAt: row.created_at,
    }
  } finally {
    db.close()
  }
}

function readStoredSource(paths: DaemonPaths, slug: string): ReaderMediaSource {
  const directory = resolveInside(paths.readerMediaDir, slug)
  if (!existsSync(directory) || !statSync(directory).isDirectory()) throw new NotFoundError("reader media not found")
  try {
    const source = validateReaderMediaSource(directory)
    return source
  } catch (error) {
    throw new BadRequestError(error instanceof Error ? error.message : "malformed reader media")
  }
}

function copySource(source: ReaderMediaSource, destination: string): void {
  mkdirSync(destination, { recursive: false })
  copyFileSync(source.alignmentPath, join(destination, "alignment.json"))
  copyFileSync(source.mediaPath, join(destination, basename(source.mediaPath)))
}

function makeSlug(title: string, source: ReaderMediaSource): string {
  const kebab = title
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64)
    .replace(/-+$/u, "")
  const safeTitle = kebab.length > 0 ? kebab : "reader-media"
  const hash = createHash("sha256")
    .update(title)
    .update("\0")
    .update(readFileSync(source.alignmentPath))
    .update("\0")
    .update(basename(source.mediaPath))
    .update(String(statSync(source.mediaPath).size))
    .digest("hex")
    .slice(0, 10)
  return `${safeTitle}-${hash}`
}

function alignmentKind(alignment: Alignment, _mediaPath: string): ReaderMediaKind {
  return alignment.media.kind ?? "audio"
}

function decodeMediaRow(row: RawReaderMediaRow): ReaderMediaRecord {
  return {
    id: row.id,
    docId: row.doc_id,
    slug: row.slug,
    kind: asReaderMediaKind(row.kind),
    file: row.file,
    durationMs: row.duration_ms,
    asr: row.asr,
    sentenceCount: row.sentence_count,
    createdAt: row.created_at,
  }
}

function asReaderMediaKind(kind: string): ReaderMediaKind {
  if (kind === "audio" || kind === "video") return kind
  throw new Error(`invalid reader media kind in database: ${kind}`)
}

function parseDocId(encoded: string): number {
  let value: string
  try {
    value = decodeURIComponent(encoded)
  } catch {
    throw new BadRequestError("malformed reader document id")
  }
  if (!/^[1-9]\d*$/u.test(value)) throw new BadRequestError("malformed reader document id")
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new BadRequestError("malformed reader document id")
  return id
}

function resolveInside(root: string, child: string): string {
  const rootPath = resolve(root)
  const childPath = resolve(rootPath, child)
  if (childPath !== rootPath && childPath.startsWith(`${rootPath}${sep}`)) return childPath
  throw new NotFoundError("reader media not found")
}

function serveMedia(request: Request, mediaPath: string): Response {
  const stat = statSync(mediaPath)
  if (!stat.isFile()) throw new NotFoundError("reader media file not found")
  const file = Bun.file(mediaPath)
  const headers = {
    "accept-ranges": "bytes",
    "content-type": mediaContentType(mediaPath),
  }
  const rangeHeader = request.headers.get("range")
  if (rangeHeader === null) return new Response(file, { headers: { ...headers, "content-length": String(stat.size) } })
  const range = parseRange(rangeHeader, stat.size)
  if (range === null) {
    return new Response(null, {
      status: 416,
      headers: { "accept-ranges": "bytes", "content-range": `bytes */${stat.size}` },
    })
  }
  const length = range.end - range.start + 1
  return new Response(file.slice(range.start, range.end + 1), {
    status: 206,
    headers: {
      ...headers,
      "content-length": String(length),
      "content-range": `bytes ${range.start}-${range.end}/${stat.size}`,
    },
  })
}

function parseRange(header: string, size: number): { start: number; end: number } | null {
  if (!header.startsWith("bytes=") || size <= 0) return null
  const spec = header.slice("bytes=".length)
  if (spec.includes(",")) return null
  const dash = spec.indexOf("-")
  if (dash < 0) return null
  const startText = spec.slice(0, dash)
  const endText = spec.slice(dash + 1)
  if (startText.length === 0) {
    const suffix = parseRangeNumber(endText)
    if (suffix === null || suffix === 0) return null
    return { start: Math.max(size - suffix, 0), end: size - 1 }
  }
  const start = parseRangeNumber(startText)
  if (start === null || start >= size) return null
  const end = endText.length === 0 ? size - 1 : parseRangeNumber(endText)
  if (end === null || end < start) return null
  return { start, end: Math.min(end, size - 1) }
}

function parseRangeNumber(value: string): number | null {
  if (value.length === 0 || !/^\d+$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function mediaContentType(path: string): string {
  const extension = extname(path).toLowerCase()
  if (extension === ".mp3") return "audio/mpeg"
  if (extension === ".wav") return "audio/wav"
  if (extension === ".m4a") return "audio/mp4"
  if (extension === ".aac") return "audio/aac"
  if (extension === ".flac") return "audio/flac"
  if (extension === ".mkv") return "video/x-matroska"
  if (extension === ".ogg") return "audio/ogg"
  if (extension === ".webm") return "video/webm"
  if (extension === ".mp4") return "video/mp4"
  if (extension === ".mov") return "video/quicktime"
  return "application/octet-stream"
}

function isMediaExtension(path: string): boolean {
  return MEDIA_EXTENSIONS[extname(path).toLowerCase()] === true
}

function jsonResponse(body: unknown, status = 200): Response {
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
