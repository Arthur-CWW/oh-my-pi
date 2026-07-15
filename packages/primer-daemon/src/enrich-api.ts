import { Schema } from "effect"
import { openLedger } from "./ledger"
import type { DaemonPaths } from "./paths"
import { getQueueItemById } from "./reading-store"
import { addLabel, listEnrichments, type EnrichmentLabelVerdict } from "./enrich-store"
import { runEnrichment } from "./enrich-runner"
import { Database } from "bun:sqlite"

const PositiveInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
const PositiveIntegerFromString = Schema.NumberFromString.pipe(Schema.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)))
const LabelVerdictSchema = Schema.Union([Schema.Literal("keep"), Schema.Literal("cut"), Schema.Literal("edit")])
const EnrichmentQuerySchema = Schema.Struct({ queueItemId: Schema.optionalKey(PositiveIntegerFromString) })
const LabelBodySchema = Schema.Struct({
  field: Schema.String,
  verdict: LabelVerdictSchema,
  edited: Schema.optionalKey(Schema.NullOr(Schema.String)),
  note: Schema.optionalKey(Schema.NullOr(Schema.String)),
})
const IdParamSchema = Schema.Struct({ id: PositiveIntegerFromString })
type EnrichmentQuery = Schema.Schema.Type<typeof EnrichmentQuerySchema>
type LabelBody = Schema.Schema.Type<typeof LabelBodySchema>
type IdParam = Schema.Schema.Type<typeof IdParamSchema>

export async function handleEnrichApi(request: Request, paths: DaemonPaths): Promise<Response | null> {
  const url = new URL(request.url)
  const pathname = url.pathname
  try {
    if (request.method === "POST" && pathname.startsWith("/api/enrich/") && !pathname.includes("/labels")) {
      return await handleRunEnrichment(pathname, paths)
    }
    if (request.method === "GET" && pathname === "/api/enrichments") return handleListEnrichments(url, paths)
    if (request.method === "POST" && pathname.startsWith("/api/enrichments/") && pathname.endsWith("/labels")) {
      return await handleAddLabel(request, pathname, paths)
    }
  } catch (error) {
    if (error instanceof BadRequestError) return jsonError(error.message, 400)
    if (error instanceof NotFoundError) return jsonError(error.message, 404)
    throw error
  }
  return null
}

async function handleRunEnrichment(pathname: string, paths: DaemonPaths): Promise<Response> {
  const id = decodeIdFromSuffix(pathname, "/api/enrich/")
  return withLedgerAsync(paths, async (db) => {
    if (getQueueItemById(db, id) === null) throw new NotFoundError("unknown queue item")
    const enrichment = await runEnrichment(db, paths, id)
    return jsonResponse({ enrichment })
  })
}

function handleListEnrichments(url: URL, paths: DaemonPaths): Response {
  const query = decodeUnknown(EnrichmentQuerySchema, Object.fromEntries(url.searchParams), "malformed enrichment query")
  return withLedger(paths, (db) => jsonResponse(listEnrichments(db, (query as EnrichmentQuery).queueItemId)))
}

async function handleAddLabel(request: Request, pathname: string, paths: DaemonPaths): Promise<Response> {
  const id = decodeIdFromSuffix(pathname.slice(0, -"/labels".length), "/api/enrichments/")
  const body = await decodeJson(request, LabelBodySchema)
  return withLedger(paths, (db) => {
    const label = addLabel(db, {
      enrichmentId: id,
      field: body.field,
      verdict: body.verdict as EnrichmentLabelVerdict,
      edited: body.edited,
      note: body.note,
    })
    return jsonResponse({ id: label.id })
  })
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
  return (decodeUnknown(IdParamSchema, { id: encodedId }, "malformed id") as IdParam).id
}

function withLedger<T>(paths: DaemonPaths, use: (db: Database) => T): T {
  const db = openLedger(paths.ledgerDb)
  try {
    return use(db)
  } finally {
    db.close()
  }
}

async function withLedgerAsync<T>(paths: DaemonPaths, use: (db: Database) => Promise<T>): Promise<T> {
  const db = openLedger(paths.ledgerDb)
  try {
    return await use(db)
  } finally {
    db.close()
  }
}

function jsonResponse(body: object | readonly object[], status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } })
}

function jsonError(error: string, status: number): Response {
  return jsonResponse({ error }, status)
}

class BadRequestError extends Error {}
class NotFoundError extends Error {}
