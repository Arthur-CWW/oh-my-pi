import { randomBytes, timingSafeEqual } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { extname, normalize, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import type { Database } from "bun:sqlite"
import { Schema } from "effect"

import { resolveAskSynthesisConfig, streamSynthesis, synthesizeAnswer } from "./ask-synthesis"
import { extractTerms } from "./cli"
import { askEvidence } from "./evidence"
import { appendAppError, appendBackendError, decodeBrowserErrorPayload } from "./error-log"
import {
  addProgress,
  listCards,
  listCardsWithEnrollment,
  listNotes,
  listProgress,
  openLedger,
  setCardStatus,
  type CardListStatus,
  type CardStatus,
} from "./ledger"
import {
  addExposureEvents,
  ExposureRequestSchema,
  exposureStats,
  MAX_EXPOSURE_BATCH,
} from "./exposure-store"
import { handleEnrichApi } from "./enrich-api"
import {
  addFeedback,
  addUiEvents,
  FeedbackInputSchema,
  listFeedback,
  listUiEvents,
  pipelineStats,
  UiEventsRequestSchema,
} from "./feedback-store"
import { handleGenerationApi } from "./generation-api"
import { handleReaderMediaApi } from "./reader-media"
import { handleReaderApi } from "./reader-api"
import { handleZhDictApi } from "./zhdict-api"
import { handleShadowingApi } from "./shadowing-api"
import { CardCandidateNotApprovedError, CardCandidateNotFoundError, enrollCardCandidate } from "./review-store"
import {
  appendReviewFeedAnswer,
  readReviewFeed,
  ReviewFeedAnswerSchema,
  ReviewFeedAnswerValidationError,
  ReviewFeedTargetAnsweredError,
  ReviewFeedTargetNotFoundError,
  ReviewFeedTargetNotPendingError,
  ReviewFeedTargetNotPrimerError,
} from "./review-feed"
import { startBrowserContextRuntime } from "./browser-context/runtime"
import type { BrowserContextClient } from "./browser-context/types"
import { handleTabsApi, type TabsApiAuthentication } from "./tabs-api"
import { readDaemonOwnerSecret, resolveDaemonPaths, type DaemonPaths } from "./paths"

export interface DashboardOptions {
  port: number
  paths: DaemonPaths
  env?: Record<string, string | undefined>
}

export type DashboardServer = Omit<Bun.Server<undefined>, "stop"> & {
  stop(closeActiveConnections?: boolean): Promise<void>
}

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
  name: "browser" | "twitter" | "reader" | "cards"
  path: string
  exists: boolean
  mtime: string | null
}

const DEFAULT_ASK_LIMIT = 30
const DEFAULT_NOTE_LIMIT = 50
const DEFAULT_CARD_LIMIT = 100
const DEFAULT_PROGRESS_LIMIT = 100
const DEFAULT_FEEDBACK_LIMIT = 50
const DEFAULT_UI_EVENT_LIMIT = 100
const PACKAGE_DIR = fileURLToPath(new URL("../", import.meta.url))
const DEFAULT_PROOF_DIR = resolve(PACKAGE_DIR, "../../docs/qa")
const DEFAULT_WEB_DIST = resolve(PACKAGE_DIR, "web/dist")
const WEB_BUILD_ERROR = "web ui not built — run bun run web:build"
const MAX_ANSWER_ERROR_LENGTH = 500
const TABS_BOOTSTRAP_PARAMETER = "tabs-session"
const TABS_SESSION_COOKIE = "primer_tabs_session"
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

const ReviewEnrollRequestSchema = Schema.Struct({ cardId: PositiveInteger })

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
  const env = options.env ?? process.env
  const tabsAuthentication: TabsApiAuthentication = {
    ownerSecret: readDaemonOwnerSecret(options.paths),
    sessionSecret: randomBytes(32).toString("base64url"),
  }
  let runtime!: ReturnType<typeof startBrowserContextRuntime>
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    async fetch(request) {
      try {
        const browserContext = await runtime
        return await handleRequest(request, options.paths, env, browserContext.client, tabsAuthentication)
      } catch (error) {
        appendBackendError(options.paths.errorLog, error, `${request.method} ${new URL(request.url).pathname}`)
        return jsonError(error instanceof Error ? error.message : "internal server error", 500)
      }
    },
  })
  runtime = startBrowserContextRuntime({ paths: options.paths })
  return new Proxy(server, {
    get(target, property) {
      if (property === "stop") {
        return async (closeActiveConnections?: boolean): Promise<void> => {
          target.stop(closeActiveConnections)
          const browserContext = await runtime
          await browserContext.close()
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  }) as DashboardServer
}

async function handleRequest(
  request: Request,
  paths: DaemonPaths,
  env: Record<string, string | undefined>,
  browserContextClient: BrowserContextClient,
  tabsAuthentication: TabsApiAuthentication,
): Promise<Response> {
  const url = new URL(request.url)
  const pathname = url.pathname
  if (request.method === "GET" && pathname === "/" && url.searchParams.has(TABS_BOOTSTRAP_PARAMETER)) {
    return handleTabsSessionBootstrap(url, tabsAuthentication)
  }
  const readerMediaApiResponse = await handleReaderMediaApi(request, paths)
  if (readerMediaApiResponse !== null) return readerMediaApiResponse
  const readerApiResponse = await handleReaderApi(request, paths)
  if (readerApiResponse !== null) return readerApiResponse
  const zhDictApiResponse = await handleZhDictApi(request, paths, { env })
  if (zhDictApiResponse !== null) return zhDictApiResponse

  const shadowingApiResponse = await handleShadowingApi(request, paths)
  if (shadowingApiResponse !== null) return shadowingApiResponse

  const generationApiResponse = await handleGenerationApi(request, paths)
  if (generationApiResponse !== null) return generationApiResponse
  const enrichApiResponse = await handleEnrichApi(request, paths)
  if (enrichApiResponse !== null) return enrichApiResponse

  const exposureApiResponse = await handleExposureApi(request, paths)
  if (exposureApiResponse !== null) return exposureApiResponse
  const feedbackApiResponse = await handleFeedbackApi(request, paths)
  if (feedbackApiResponse !== null) return feedbackApiResponse
  const reviewFeedApiResponse = await handleReviewFeedApi(request, pathname, paths)
  if (reviewFeedApiResponse !== null) return reviewFeedApiResponse
  const tabsApiResponse = await handleTabsApi(request, browserContextClient, tabsAuthentication)
  if (tabsApiResponse !== null) return tabsApiResponse
  if (request.method === "POST" && pathname === "/api/errors/browser") {
    return handleBrowserError(request, paths)
  }
  if (isReaderHost(request)) return handleReaderSite(request, pathname, paths)

  if (request.method === "GET" && pathname === "/") return handleWebIndex(env)

  if (request.method === "GET" && pathname === "/api/status") return handleStatus(paths)
  if (request.method === "GET" && pathname === "/api/ask/config") return handleAskConfig(env)
  if (request.method === "POST" && pathname === "/api/ask/stream") return handleAskStream(request, paths, env)
  if (request.method === "POST" && pathname === "/api/ask") return handleAsk(request, paths, env)
  if (request.method === "GET" && pathname === "/api/notes") return handleNotes(url, paths)
  if (request.method === "GET" && pathname === "/api/cards") return handleCards(url, paths)
  if (request.method === "POST" && pathname === "/api/cards/status") return handleCardStatus(request, paths)
  if (request.method === "POST" && pathname === "/api/review/enroll") return handleCardEnroll(request, paths)
  if (request.method === "GET" && pathname === "/api/progress") return handleProgressList(url, paths)
  if (request.method === "POST" && pathname === "/api/progress") return handleProgressCreate(request, paths)
  if (request.method === "GET" && pathname === "/api/proofs") {
    return jsonResponse(scanProofs(env).map(({ name, title, mtime }) => ({ name, title, mtime })))
  }
  if (request.method === "GET" && pathname.startsWith("/api/proofs/")) return handleProof(pathname, env)
  if (request.method === "GET" && pathname.startsWith("/assets/")) return handleWebAsset(pathname, env)


  return jsonError("unknown route", 404)
}

function handleTabsSessionBootstrap(url: URL, authentication: TabsApiAuthentication): Response {
  const supplied = url.searchParams.get(TABS_BOOTSTRAP_PARAMETER)
  if (
    supplied === null
    || url.searchParams.size !== 1
    || !secretEquals(supplied, authentication.ownerSecret)
  ) {
    return jsonError("invalid dashboard owner credential", 403)
  }
  return new Response(null, {
    status: 303,
    headers: {
      "cache-control": "no-store",
      location: "/",
      "referrer-policy": "no-referrer",
      "set-cookie": `${TABS_SESSION_COOKIE}=${authentication.sessionSecret}; HttpOnly; SameSite=Strict; Path=/`,
      "x-frame-options": "DENY",
    },
  })
}

function secretEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8")
  const rightBytes = Buffer.from(right, "utf8")
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

async function handleBrowserError(request: Request, paths: DaemonPaths): Promise<Response> {
  try {
    const payload = decodeBrowserErrorPayload(await request.json())
    appendAppError(paths.errorLog, { source: "browser", ...payload })
  } catch {
    // The browser cannot safely report a failure from its own error reporter.
  }
  return new Response(null, { status: 204 })
}

function isReaderHost(request: Request): boolean {
  const host = request.headers.get("host")
  if (host === null) return false

  const hostname = host.trim().toLowerCase().split(":")[0] ?? ""
  const firstLabel = hostname.split(".")[0]
  return firstLabel === "meltdown" || firstLabel === "reader"
}

function handleReaderSite(request: Request, pathname: string, paths: DaemonPaths): Response {
  if (request.method !== "GET" && request.method !== "HEAD") return jsonError("unknown route", 404)
  if (pathname.startsWith("/api/")) return jsonError("unknown route", 404)

  const readerRoot = resolve(paths.readerSite)
  const filePath = pathname === "/" ? resolve(readerRoot, "index.html") : resolveReaderFile(readerRoot, pathname)
  if (filePath === null) return jsonError("unknown route", 404)
  if (filePath !== readerRoot && !filePath.startsWith(`${readerRoot}${sep}`)) return jsonError("unknown route", 404)
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return jsonError("unknown route", 404)

  return new Response(Bun.file(filePath))
}

function resolveReaderFile(readerRoot: string, pathname: string): string | null {
  let decodedPathname = ""
  try {
    decodedPathname = decodeURIComponent(pathname)
  } catch {
    return null
  }

  return resolve(readerRoot, normalize(`.${decodedPathname}`))
}

function handleWebIndex(env: Record<string, string | undefined>): Response {
  const distDir = resolveWebDist(env)
  const indexPath = resolve(distDir, "index.html")
  if (!existsSync(indexPath)) return jsonError(WEB_BUILD_ERROR, 503)

  return serveWebFile(indexPath, "text/html; charset=utf-8")
}

function handleWebAsset(pathname: string, env: Record<string, string | undefined>): Response {
  const distDir = resolveWebDist(env)
  const filePath = resolve(distDir, `.${pathname}`)
  if (filePath !== distDir && !filePath.startsWith(`${distDir}${sep}`)) return jsonError("unknown route", 404)
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return jsonError("unknown route", 404)

  return serveWebFile(filePath, webContentType(filePath))
}

function resolveWebDist(env: Record<string, string | undefined>): string {
  return resolve(env.PRIMER_WEB_DIST ?? DEFAULT_WEB_DIST)
}

function serveWebFile(path: string, contentType: string): Response {
  return new Response(Bun.file(path), {
    headers: { "content-type": contentType },
  })
}

function webContentType(path: string): string {
  switch (extname(path)) {
    case ".css":
      return "text/css; charset=utf-8"
    case ".js":
      return "text/javascript; charset=utf-8"
    case ".svg":
      return "image/svg+xml"
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".webp":
      return "image/webp"
    default:
      return "application/octet-stream"
  }
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

async function handleAsk(request: Request, paths: DaemonPaths, env: Record<string, string | undefined>): Promise<Response> {
  const body = await decodeJson(request, AskRequestSchema)
  if (body instanceof Response) return body

  const terms = extractTerms(body.question, paths.cedictDb)
  const evidence = askEvidence(paths, terms, body.limit ?? DEFAULT_ASK_LIMIT)
  const config = resolveAskSynthesisConfig(env)
  let answer: { text: string; model: string; elapsedMs: number } | null = null
  let answerError: string | null = null

  if (!config.enabled) {
    answerError = "synthesis disabled"
  } else if (evidence.hits.length === 0) {
    answerError = "no evidence hits"
  } else {
    try {
      answer = await synthesizeAnswer(body.question, evidence.hits, config)
    } catch (error) {
      appendBackendError(paths.errorLog, error, "POST /api/ask synthesis")
      answerError = answerFailure(error)
    }
  }

  return jsonResponse({
    question: body.question,
    terms,
    hits: evidence.hits,
    skipped: evidence.skipped,
    answer,
    answerError,
  })
}

async function handleAskStream(request: Request, paths: DaemonPaths, env: Record<string, string | undefined>): Promise<Response> {
  const body = await decodeJson(request, AskRequestSchema)
  if (body instanceof Response) return body

  const terms = extractTerms(body.question, paths.cedictDb)
  const evidence = askEvidence(paths, terms, body.limit ?? DEFAULT_ASK_LIMIT)
  const config = resolveAskSynthesisConfig(env)
  const meta = {
    question: body.question,
    terms,
    hits: evidence.hits,
    skipped: evidence.skipped,
    model: config.model,
    synthesisEnabled: config.enabled,
  }
  const encoder = new TextEncoder()
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = (): void => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          closed = true
        }
      }
      const send = (event: string, data: object): boolean => {
        if (closed || request.signal.aborted) return false
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
          return true
        } catch {
          closed = true
          return false
        }
      }
      const abort = (): void => close()
      request.signal.addEventListener("abort", abort, { once: true })

      try {
        if (!send("meta", meta)) return
        if (!config.enabled || evidence.hits.length === 0) {
          send("done", { elapsedMs: 0 })
          return
        }

        try {
          const { elapsedMs } = await streamSynthesis(body.question, evidence.hits, config, (text) => {
            if (!send("delta", { text })) throw new Error("client aborted")
          })
          send("done", { elapsedMs })
        } catch (error) {
          if (!closed && !request.signal.aborted) {
            appendBackendError(paths.errorLog, error, "POST /api/ask/stream synthesis")
            send("error", { message: answerFailure(error) })
          }
        }
      } finally {
        request.signal.removeEventListener("abort", abort)
        close()
      }
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
  })
}

function handleAskConfig(env: Record<string, string | undefined>): Response {
  const config = resolveAskSynthesisConfig(env)
  return jsonResponse({ model: config.model, synthesisEnabled: config.enabled })
}

async function handleFeedbackApi(request: Request, paths: DaemonPaths): Promise<Response | null> {
  const url = new URL(request.url)
  const pathname = url.pathname
  if (request.method === "POST" && pathname === "/api/feedback") return handleFeedbackCreate(request, paths)
  if (request.method === "GET" && pathname === "/api/feedback") {
    const limit = parseLimit(url, DEFAULT_FEEDBACK_LIMIT)
    if (limit === null) return jsonError("invalid limit", 400)
    return withLedger(paths, (db) => jsonResponse(listFeedback(db, limit)))
  }
  if (request.method === "POST" && pathname === "/api/events") return handleUiEventsCreate(request, paths)
  if (request.method === "GET" && pathname === "/api/events") {
    const limit = parseLimit(url, DEFAULT_UI_EVENT_LIMIT)
    if (limit === null) return jsonError("invalid limit", 400)
    return withLedger(paths, (db) => jsonResponse(listUiEvents(db, url.searchParams.get("kind") ?? undefined, limit)))
  }
  if (request.method === "GET" && pathname === "/api/pipeline/stats") {
    return withLedger(paths, (db) => jsonResponse(pipelineStats(db)))
  }
  return null
}

async function handleExposureApi(request: Request, paths: DaemonPaths): Promise<Response | null> {
  const url = new URL(request.url)
  const pathname = url.pathname
  if (request.method === "POST" && pathname === "/api/exposure") {
    const body = await decodeJson(request, ExposureRequestSchema)
    if (body instanceof Response) return body
    if (body.events.length > MAX_EXPOSURE_BATCH) return jsonError(`exposure batch exceeds ${MAX_EXPOSURE_BATCH} events`, 400)
    if (body.events.some((event) => event.word.length === 0)) return jsonError("exposure word must not be empty", 400)
    return withLedger(paths, (db) => jsonResponse(addExposureEvents(db, body.events)))
  }
  if (request.method === "GET" && pathname === "/api/exposure/stats") {
    return withLedger(paths, (db) => jsonResponse(exposureStats(db)))
  }
  return null
}

async function handleFeedbackCreate(request: Request, paths: DaemonPaths): Promise<Response> {
  const body = await decodeJson(request, FeedbackInputSchema)
  if (body instanceof Response) return body
  return withLedger(paths, (db) => jsonResponse(addFeedback(db, body)))
}

async function handleUiEventsCreate(request: Request, paths: DaemonPaths): Promise<Response> {
  const body = await decodeJson(request, UiEventsRequestSchema)
  if (body instanceof Response) return body
  return withLedger(paths, (db) => jsonResponse({ count: addUiEvents(db, body.events) }))
}

function handleNotes(url: URL, paths: DaemonPaths): Response {
  const limit = parseLimit(url, DEFAULT_NOTE_LIMIT)
  if (limit === null) return jsonError("invalid limit", 400)
  return withLedger(paths, (db) => jsonResponse(listNotes(db, limit)))
}

function handleCards(url: URL, paths: DaemonPaths): Response {
  const limit = parseLimit(url, DEFAULT_CARD_LIMIT)
  if (limit === null) return jsonError("invalid limit", 400)
  const status = url.searchParams.get("status")
  if (status === null) return withLedger(paths, (db) => jsonResponse(listCards(db, limit)))
  if (status !== "candidate" && status !== "approved" && status !== "rejected" && status !== "enrolled" && status !== "all") {
    return jsonError("invalid status", 400)
  }
  return withLedger(paths, (db) => jsonResponse(listCardsWithEnrollment(db, limit, status as CardListStatus)))
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

async function handleCardEnroll(request: Request, paths: DaemonPaths): Promise<Response> {
  const body = await decodeJson(request, ReviewEnrollRequestSchema)
  if (body instanceof Response) return body
  return withLedger(paths, (db) => {
    try {
      return jsonResponse(enrollCardCandidate(db, body.cardId))
    } catch (error) {
      if (error instanceof CardCandidateNotFoundError) return jsonError(error.message, 404)
      if (error instanceof CardCandidateNotApprovedError) return jsonError(error.message, 409)
      throw error
    }
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

function handleProof(pathname: string, env: Record<string, string | undefined>): Response {
  const encodedName = pathname.slice("/api/proofs/".length)
  if (encodedName.length === 0 || encodedName.includes("/")) return jsonError("unknown proof", 404)

  const name = decodePathSegment(encodedName)
  if (name === null) return jsonError("unknown proof", 404)

  const proofs = new Map(scanProofs(env).map((proof) => [proof.name, proof]))
  const proof = proofs.get(name)
  if (proof === undefined) return jsonError("unknown proof", 404)

  return jsonResponse({ name: proof.name, markdown: readFileSync(proof.path, "utf8") })
}

async function handleReviewFeedApi(request: Request, pathname: string, paths: DaemonPaths): Promise<Response | null> {
  if (request.method === "GET" && pathname === "/api/review-feed") {
    return jsonResponse(readReviewFeed(paths.reviewFeed))
  }

  if (request.method !== "POST") return null
  const match = /^\/api\/review-feed\/([^/]+)\/answer$/u.exec(pathname)
  if (match === null) return null
  const targetId = decodePathSegment(match[1] ?? "")
  if (targetId === null || targetId.length === 0) return jsonError("unknown review feed target", 404)

  const body = await decodeJson(request, ReviewFeedAnswerSchema)
  if (body instanceof Response) return body
  if (body.summary.trim().length === 0) return jsonError("summary must not be blank", 400)

  try {
    return jsonResponse(appendReviewFeedAnswer(paths.reviewFeed, targetId, body.summary))
  } catch (error) {
    if (error instanceof ReviewFeedTargetNotFoundError) return jsonError(error.message, 404)
    if (error instanceof ReviewFeedTargetNotPrimerError) return jsonError(error.message, 400)
    if (error instanceof ReviewFeedTargetAnsweredError) return jsonError(error.message, 409)
    if (error instanceof ReviewFeedTargetNotPendingError || error instanceof ReviewFeedAnswerValidationError) {
      return jsonError(error.message, 400)
    }
    throw error
  }
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
    substrateStatus("cards", paths.learningCardsDb),
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

function scanProofs(env: Record<string, string | undefined>): ProofEntry[] {
  const proofDir = env.PRIMER_PROOFS_DIR ?? DEFAULT_PROOF_DIR
  if (!existsSync(proofDir)) return []

  return readdirSync(proofDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^primer-.*\.md$/u.test(entry.name))
    .map((entry) => {
      const path = resolve(proofDir, entry.name)
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

function answerFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, MAX_ANSWER_ERROR_LENGTH)
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

function registerPortlessAlias(port: number, env: Record<string, string | undefined>): void {
  if (env.PORTLESS_URL === undefined) return
  // Best-effort fallback claim: the wrapped-commentary-reader dev supervisor owns
  // `meltdown` when running and takes the alias over; losing the race is expected.
  if (env.PRIMER_MELTDOWN_ALIAS === "0") return

  try {
    const child = Bun.spawn(["bunx", "portless@latest", "alias", "meltdown", String(port)], {
      stdout: "ignore",
      stderr: "ignore",
    })
    child.exited.then(
      (exitCode) => {
        if (exitCode === 0) {
          console.log(`Registered https://meltdown.localhost for port ${port}`)
        } else {
          console.log(`meltdown portless alias not claimed (exit ${exitCode}) — reader supervisor likely owns it; set PRIMER_MELTDOWN_ALIAS=0 to skip`)
        }
      },
      () => {
        console.log("meltdown portless alias registration unavailable — skipping (set PRIMER_MELTDOWN_ALIAS=0 to silence)")
      },
    )
  } catch {
    console.log("meltdown portless alias registration unavailable — skipping (set PRIMER_MELTDOWN_ALIAS=0 to silence)")
  }
}

if (import.meta.main) {
  const paths = resolveDaemonPaths(process.env)
  const server = startDashboard({
    port: Number(process.env.PORT ?? 4177),
    paths,
    env: process.env,
  })
  const actualPort = server.port ?? Number(process.env.PORT ?? 4177)
  const ownerSecret = readDaemonOwnerSecret(paths)
  console.log(`Primer dashboard listening on http://localhost:${actualPort}/?${TABS_BOOTSTRAP_PARAMETER}=${encodeURIComponent(ownerSecret)}`)
  registerPortlessAlias(actualPort, process.env)
}
