import { Database } from "bun:sqlite"
import { Schema } from "effect"

import {
  CardStatusSchema,
  PositiveInteger,
  listCards,
  listCardsWithEnrollment,
  openLedger,
  setCardStatus,
  type CardListStatus,
  type CardStatus,
} from "./ledger"
import type { DaemonPaths } from "./paths"
import type { PrimerClock } from "./reader-api"
import { CardCandidateNotApprovedError, CardCandidateNotFoundError, enrollCardCandidate } from "./review-store"

const DEFAULT_CARD_LIMIT = 100
const SYSTEM_CLOCK: PrimerClock = () => new Date()

const CardStatusRequestSchema = Schema.Struct({
  id: PositiveInteger,
  status: CardStatusSchema,
})

const ReviewEnrollRequestSchema = Schema.Struct({ cardId: PositiveInteger })

/**
 * Card candidate listing, approval, and review enrollment.
 *
 * Returns `null` when the request is not a card route so a host server can
 * continue matching. `clock` is the single time seam: enrollment stamps the
 * initial scheduler card, so a caller that needs a deterministic due time
 * supplies its own clock instead of the wall clock.
 */
export async function handleCardApi(
  request: Request,
  url: URL,
  paths: DaemonPaths,
  clock: PrimerClock = SYSTEM_CLOCK,
): Promise<Response | null> {
  const pathname = url.pathname
  if (request.method === "GET" && pathname === "/api/cards") return handleCards(url, paths)
  if (request.method === "POST" && pathname === "/api/cards/status") return await handleCardStatus(request, paths)
  if (request.method === "POST" && pathname === "/api/review/enroll") return await handleCardEnroll(request, paths, clock)
  return null
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

async function handleCardEnroll(request: Request, paths: DaemonPaths, clock: PrimerClock): Promise<Response> {
  const body = await decodeJson(request, ReviewEnrollRequestSchema)
  if (body instanceof Response) return body
  return withLedger(paths, (db) => {
    try {
      return jsonResponse(enrollCardCandidate(db, body.cardId, clock()))
    } catch (error) {
      if (error instanceof CardCandidateNotFoundError) return jsonError(error.message, 404)
      if (error instanceof CardCandidateNotApprovedError) return jsonError(error.message, 409)
      throw error
    }
  })
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

function parseLimit(url: URL, defaultLimit: number): number | null {
  const raw = url.searchParams.get("limit")
  if (raw === null) return defaultLimit
  const limit = Number(raw)
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) return null
  return limit
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
