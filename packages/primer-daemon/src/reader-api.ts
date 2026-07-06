import { Database } from "bun:sqlite"
import { Schema } from "effect"

import { CedictNotBuiltError, lookupCedictBest, lookupCedictExact, listKnownWords } from "./dict"
import { openLedger } from "./ledger"
import type { DaemonPaths } from "./paths"
import {
  createReadingDoc,
  createReadingMark,
  deleteReadingMark,
  getReadingDoc,
  listQueueItems,
  listReadingDocs,
  setQueueItemStatus,
  type QueueStatus,
  type ReadingMarkKind,
} from "./reading-store"

const PositiveInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
const NonNegativeInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const PositiveIntegerFromString = Schema.NumberFromString.pipe(
  Schema.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
)
const MarkKindSchema = Schema.Union([Schema.Literal("lookup"), Schema.Literal("manual")])
const QueueStatusSchema = Schema.Union([
  Schema.Literal("new"),
  Schema.Literal("keep"),
  Schema.Literal("discarded"),
  Schema.Literal("known"),
])
const QueueStatusFilterSchema = Schema.Union([QueueStatusSchema, Schema.Literal("all")])

const CreateDocBodySchema = Schema.Struct({
  title: Schema.String,
  text: Schema.String,
  lang: Schema.optionalKey(Schema.String),
})

const CreateMarkBodySchema = Schema.Struct({
  docId: PositiveInteger,
  paragraphIdx: NonNegativeInteger,
  start: NonNegativeInteger,
  end: NonNegativeInteger,
  surface: Schema.String,
  sentence: Schema.String,
  kind: Schema.optionalKey(MarkKindSchema),
})

const QueueStatusBodySchema = Schema.Struct({ status: QueueStatusSchema })
const IdParamSchema = Schema.Struct({ id: PositiveIntegerFromString })
const DictWordParamSchema = Schema.Struct({ word: Schema.String })
const DictBestQuerySchema = Schema.Struct({ text: Schema.String })
const QueueQuerySchema = Schema.Struct({
  status: Schema.optionalKey(QueueStatusFilterSchema),
  limit: Schema.optionalKey(PositiveIntegerFromString),
})

type CreateDocBody = Schema.Schema.Type<typeof CreateDocBodySchema>
type CreateMarkBody = Schema.Schema.Type<typeof CreateMarkBodySchema>
type QueueStatusBody = Schema.Schema.Type<typeof QueueStatusBodySchema>
type IdParam = Schema.Schema.Type<typeof IdParamSchema>
type DictWordParam = Schema.Schema.Type<typeof DictWordParamSchema>
type DictBestQuery = Schema.Schema.Type<typeof DictBestQuerySchema>
type QueueQuery = Schema.Schema.Type<typeof QueueQuerySchema>

export async function handleReaderApi(request: Request, paths: DaemonPaths): Promise<Response | null> {
  const url = new URL(request.url)
  const pathname = url.pathname

  try {
    if (request.method === "POST" && pathname === "/api/reader/docs") return handleCreateDoc(request, paths)
    if (request.method === "GET" && pathname === "/api/reader/docs") return handleListDocs(paths)
    if (request.method === "GET" && pathname.startsWith("/api/reader/docs/")) return handleGetDoc(pathname, paths)
    if (request.method === "POST" && pathname === "/api/reader/marks") return handleCreateMark(request, paths)
    if (request.method === "DELETE" && pathname.startsWith("/api/reader/marks/")) return handleDeleteMark(pathname, paths)
    if (request.method === "GET" && pathname === "/api/reader/known-words") return jsonResponse(listKnownWords(paths.cedictDb))
    if (request.method === "GET" && pathname === "/api/dict/best") return handleDictBest(url, paths)
    if (request.method === "GET" && pathname.startsWith("/api/dict/")) return handleDictExact(pathname, paths)
    if (request.method === "GET" && pathname === "/api/queue") return handleQueueList(url, paths)
    if (request.method === "POST" && pathname.startsWith("/api/queue/") && pathname.endsWith("/status")) {
      return handleQueueStatus(request, pathname, paths)
    }
  } catch (error) {
    if (error instanceof CedictNotBuiltError) return jsonError(error.message, 503)
    if (error instanceof BadRequestError) return jsonError(error.message, 400)
    if (error instanceof NotFoundError) return jsonError(error.message, 404)
    throw error
  }

  return null
}

async function handleCreateDoc(request: Request, paths: DaemonPaths): Promise<Response> {
  const body = await decodeJson(request, CreateDocBodySchema)
  return withLedger(paths, (db) => jsonResponse(createReadingDoc(db, normalizeDocBody(body))))
}

function handleListDocs(paths: DaemonPaths): Response {
  return withLedger(paths, (db) => jsonResponse(listReadingDocs(db)))
}

function handleGetDoc(pathname: string, paths: DaemonPaths): Response {
  const id = decodeIdFromSuffix(pathname, "/api/reader/docs/")
  return withLedger(paths, (db) => {
    const doc = getReadingDoc(db, id)
    if (doc === null) throw new NotFoundError("unknown reading doc")
    return jsonResponse(doc)
  })
}

async function handleCreateMark(request: Request, paths: DaemonPaths): Promise<Response> {
  const body = await decodeJson(request, CreateMarkBodySchema)
  const enrichment = enrichWord(paths.cedictDb, body.surface)
  return withLedger(paths, (db) =>
    jsonResponse(
      createReadingMark(db, {
        docId: body.docId,
        paragraphIdx: body.paragraphIdx,
        start: body.start,
        end: body.end,
        surface: body.surface,
        sentence: body.sentence,
        kind: body.kind as ReadingMarkKind | undefined,
        pinyin: enrichment.pinyin,
        gloss: enrichment.gloss,
      }),
    ),
  )
}

function handleDeleteMark(pathname: string, paths: DaemonPaths): Response {
  const id = decodeIdFromSuffix(pathname, "/api/reader/marks/")
  return withLedger(paths, (db) => {
    if (!deleteReadingMark(db, id)) throw new NotFoundError("unknown reading mark")
    return jsonResponse({ ok: true })
  })
}

function handleDictExact(pathname: string, paths: DaemonPaths): Response {
  const encodedWord = pathname.slice("/api/dict/".length)
  if (encodedWord.length === 0 || encodedWord.includes("/")) throw new NotFoundError("unknown route")
  const params = decodeUnknown(DictWordParamSchema, { word: decodeURIComponentSafe(encodedWord) }, "malformed dictionary word")
  return jsonResponse(lookupCedictExact(paths.cedictDb, params.word))
}

function handleDictBest(url: URL, paths: DaemonPaths): Response {
  const params = decodeUnknown(DictBestQuerySchema, Object.fromEntries(url.searchParams), "malformed dictionary query")
  return jsonResponse(lookupCedictBest(paths.cedictDb, params.text))
}

function handleQueueList(url: URL, paths: DaemonPaths): Response {
  const query = decodeUnknown(QueueQuerySchema, Object.fromEntries(url.searchParams), "malformed queue query")
  return withLedger(paths, (db) => jsonResponse(listQueueItems(db, query.status ?? "new", query.limit ?? 100)))
}

async function handleQueueStatus(request: Request, pathname: string, paths: DaemonPaths): Promise<Response> {
  const id = decodeQueueStatusId(pathname)
  const body = await decodeJson(request, QueueStatusBodySchema)
  return withLedger(paths, (db) => {
    const item = setQueueItemStatus(db, id, body.status as QueueStatus)
    if (item === null) throw new NotFoundError("unknown queue item")
    return jsonResponse(item)
  })
}

function normalizeDocBody(body: CreateDocBody): { title: string; text: string; lang?: string } {
  return body.lang === undefined ? { title: body.title, text: body.text } : { title: body.title, text: body.text, lang: body.lang }
}

function enrichWord(dbPath: string, word: string): { pinyin: string | null; gloss: string | null } {
  try {
    const entries = lookupCedictExact(dbPath, word).entries
    const first = entries[0]
    if (first === undefined) return { pinyin: null, gloss: null }
    return { pinyin: first.pinyin, gloss: first.definitions.join("; ") }
  } catch (error) {
    if (error instanceof CedictNotBuiltError) return { pinyin: null, gloss: null }
    throw error
  }
}

async function decodeJson<S extends Schema.ConstraintDecoder<unknown>>(request: Request, schema: S): Promise<S["Type"]> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new BadRequestError("malformed JSON body")
  }
  return decodeUnknown(schema, body, "malformed request body")
}

function decodeUnknown<S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown, message: string): S["Type"] {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch {
    throw new BadRequestError(message)
  }
}

function decodeIdFromSuffix(pathname: string, prefix: string): number {
  const encodedId = pathname.slice(prefix.length)
  if (encodedId.length === 0 || encodedId.includes("/")) throw new NotFoundError("unknown route")
  return decodeUnknown(IdParamSchema, { id: encodedId }, "malformed id").id
}

function decodeQueueStatusId(pathname: string): number {
  const middle = pathname.slice("/api/queue/".length, -"/status".length)
  if (middle.length === 0 || middle.includes("/")) throw new NotFoundError("unknown route")
  return decodeUnknown(IdParamSchema, { id: middle }, "malformed id").id
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new BadRequestError("malformed path segment")
  }
}

function withLedger<T>(paths: DaemonPaths, use: (db: Database) => T): T {
  const db = openLedger(paths.ledgerDb)
  try {
    return use(db)
  } finally {
    db.close()
  }
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
