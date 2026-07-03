import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Database } from "bun:sqlite"
import { Schema } from "effect"

import { extractTerms } from "./cli"
import { renderDashboardPage } from "./dashboard-page"
import { askEvidence } from "./evidence"
import {
  addProgress,
  listCards,
  listNotes,
  listProgress,
  openLedger,
  setCardStatus,
  type CardStatus,
} from "./ledger"
import { resolveDaemonPaths, type DaemonPaths } from "./paths"

export interface DashboardOptions {
  port: number
  paths: DaemonPaths
}

export type DashboardServer = Bun.Server<undefined>

interface CountRow {
  count: number
}

interface ProofSummary {
  name: string
  title: string
  mtime: string
}

interface ProofEntry extends ProofSummary {
  path: string
}

interface SubstrateStatus {
  name: "browser" | "twitter" | "reader"
  path: string
  exists: boolean
  mtime: string | null
}

const DEFAULT_ASK_LIMIT = 30
const DEFAULT_NOTE_LIMIT = 50
const DEFAULT_CARD_LIMIT = 100
const DEFAULT_PROGRESS_LIMIT = 100
const PACKAGE_DIR = fileURLToPath(new URL("../", import.meta.url))
const PROOF_DIR = resolve(PACKAGE_DIR, "../../docs/qa")
const PositiveInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))

const AskRequestSchema = Schema.Struct({
  question: Schema.String,
  limit: Schema.optionalKey(PositiveInteger),
})

const CardStatusSchema = Schema.Union([
  Schema.Literal("candidate"),
  Schema.Literal("approved"),
  Schema.Literal("rejected"),
])

const CardStatusRequestSchema = Schema.Struct({
  id: PositiveInteger,
  status: CardStatusSchema,
})

const ProgressRequestSchema = Schema.Struct({
  kind: Schema.String,
  title: Schema.String,
  body: Schema.optionalKey(Schema.String),
  refs: Schema.optionalKey(Schema.Array(Schema.String)),
})

type AskRequest = Schema.Schema.Type<typeof AskRequestSchema>
type CardStatusRequest = Schema.Schema.Type<typeof CardStatusRequestSchema>
type ProgressRequest = Schema.Schema.Type<typeof ProgressRequestSchema>

export function startDashboard(options: DashboardOptions): DashboardServer {
  return Bun.serve({
    port: options.port,
    async fetch(request) {
      try {
        return await handleRequest(request, options.paths)
      } catch (error) {
        return jsonError(error instanceof Error ? error.message : "internal server error", 500)
      }
    },
  })
}

async function handleRequest(request: Request, paths: DaemonPaths): Promise<Response> {
  const url = new URL(request.url)
  const pathname = url.pathname

  if (request.method === "GET" && pathname === "/") {
    return new Response(renderDashboardPage(), {
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  }

  if (request.method === "GET" && pathname === "/api/status") return handleStatus(paths)
  if (request.method === "POST" && pathname === "/api/ask") return handleAsk(request, paths)
  if (request.method === "GET" && pathname === "/api/notes") return handleNotes(url, paths)
  if (request.method === "GET" && pathname === "/api/cards") return handleCards(url, paths)
  if (request.method === "POST" && pathname === "/api/cards/status") return handleCardStatus(request, paths)
  if (request.method === "GET" && pathname === "/api/progress") return handleProgressList(url, paths)
  if (request.method === "POST" && pathname === "/api/progress") return handleProgressCreate(request, paths)
  if (request.method === "GET" && pathname === "/api/proofs") {
    return jsonResponse(scanProofs().map(({ name, title, mtime }) => ({ name, title, mtime })))
  }
  if (request.method === "GET" && pathname.startsWith("/api/proofs/")) return handleProof(pathname)

  return jsonError("unknown route", 404)
}

function handleStatus(paths: DaemonPaths): Response {
  return withLedger(paths, (db) =>
    jsonResponse({
      generatedAt: new Date().toISOString(),
      substrates: substrateStatuses(paths),
      ledger: {
        path: paths.ledgerDb,
        notes: countRows(db, "notes"),
        cards: countRows(db, "card_candidates"),
        progress: countRows(db, "progress"),
      },
    }),
  )
}

async function handleAsk(request: Request, paths: DaemonPaths): Promise<Response> {
  const body = await decodeJson(request, AskRequestSchema)
  if (body instanceof Response) return body

  const terms = extractTerms(body.question)
  const evidence = askEvidence(paths, terms, body.limit ?? DEFAULT_ASK_LIMIT)
  return jsonResponse({
    question: body.question,
    terms,
    hits: evidence.hits,
    skipped: evidence.skipped,
  })
}

function handleNotes(url: URL, paths: DaemonPaths): Response {
  const limit = parseLimit(url, DEFAULT_NOTE_LIMIT)
  if (limit === null) return jsonError("invalid limit", 400)
  return withLedger(paths, (db) => jsonResponse(listNotes(db, limit)))
}

function handleCards(url: URL, paths: DaemonPaths): Response {
  const limit = parseLimit(url, DEFAULT_CARD_LIMIT)
  if (limit === null) return jsonError("invalid limit", 400)
  return withLedger(paths, (db) => jsonResponse(listCards(db, limit)))
}

async function handleCardStatus(request: Request, paths: DaemonPaths): Promise<Response> {
  const body = await decodeJson(request, CardStatusRequestSchema)
  if (body instanceof Response) return body

  return withLedger(paths, (db) => {
    const updated = setCardStatus(db, body.id, body.status as CardStatus)
    if (updated === null) return jsonError("unknown card id", 404)
    return jsonResponse(updated)
  })
}

function handleProgressList(url: URL, paths: DaemonPaths): Response {
  const limit = parseLimit(url, DEFAULT_PROGRESS_LIMIT)
  if (limit === null) return jsonError("invalid limit", 400)
  return withLedger(paths, (db) => jsonResponse(listProgress(db, limit)))
}

async function handleProgressCreate(request: Request, paths: DaemonPaths): Promise<Response> {
  const body = await decodeJson(request, ProgressRequestSchema)
  if (body instanceof Response) return body

  return withLedger(paths, (db) =>
    jsonResponse(
      addProgress(db, {
        kind: body.kind,
        title: body.title,
        body: body.body,
        refs: body.refs === undefined ? undefined : [...body.refs],
      }),
    ),
  )
}

function handleProof(pathname: string): Response {
  const encodedName = pathname.slice("/api/proofs/".length)
  if (encodedName.length === 0 || encodedName.includes("/")) return jsonError("unknown proof", 404)

  const name = decodePathSegment(encodedName)
  if (name === null) return jsonError("unknown proof", 404)

  const proofs = new Map(scanProofs().map((proof) => [proof.name, proof]))
  const proof = proofs.get(name)
  if (proof === undefined) return jsonError("unknown proof", 404)

  return jsonResponse({ name: proof.name, markdown: readFileSync(proof.path, "utf8") })
}

async function decodeJson<S extends Schema.ConstraintDecoder<unknown>>(request: Request, schema: S): Promise<S["Type"] | Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError("malformed JSON body", 400)
  }

  try {
    return Schema.decodeUnknownSync(schema)(body)
  } catch {
    return jsonError("malformed request body", 400)
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

function countRows(db: Database, table: "notes" | "card_candidates" | "progress"): number {
  const row = db.query<CountRow, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()
  return row?.count ?? 0
}

function substrateStatuses(paths: DaemonPaths): SubstrateStatus[] {
  return [
    substrateStatus("browser", paths.browserDb),
    substrateStatus("twitter", paths.twitterDb),
    substrateStatus("reader", paths.readerDb),
  ]
}

function substrateStatus(name: SubstrateStatus["name"], path: string): SubstrateStatus {
  try {
    const stat = statSync(path)
    return { name, path, exists: true, mtime: stat.mtime.toISOString() }
  } catch {
    return { name, path, exists: false, mtime: null }
  }
}

function parseLimit(url: URL, defaultLimit: number): number | null {
  const raw = url.searchParams.get("limit")
  if (raw === null) return defaultLimit
  const limit = Number(raw)
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) return null
  return limit
}

function scanProofs(): ProofEntry[] {
  if (!existsSync(PROOF_DIR)) return []

  return readdirSync(PROOF_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const path = resolve(PROOF_DIR, entry.name)
      const stat = statSync(path)
      return {
        name: entry.name,
        path,
        title: proofTitle(path, entry.name),
        mtime: stat.mtime.toISOString(),
      }
    })
    .sort((left, right) => right.mtime.localeCompare(left.mtime) || left.name.localeCompare(right.name))
}

function proofTitle(path: string, fallback: string): string {
  const markdown = readFileSync(path, "utf8")
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("# ")) return line.slice(2).trim() || fallback
  }
  return fallback
}

function decodePathSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
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

if (import.meta.main) {
  const server = startDashboard({
    port: Number(process.env.PORT ?? 4177),
    paths: resolveDaemonPaths(process.env),
  })
  console.log(`Primer dashboard listening on http://localhost:${server.port}`)
}
