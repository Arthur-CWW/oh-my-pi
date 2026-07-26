import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

import { Context, Effect, Option, Schema } from "effect"

import {
  getAgentRouteTimeline,
  getAgentTimeline,
  getCurrentAgentStates,
  getPacketRouteTimeline,
  getResolvedRoute,
} from "./agent-timeline"
import { PapercutInputSchema, PapercutSeveritySchema, PapercutStatusSchema } from "./schema"
import { LedgerStore, type LedgerStoreShape, type TimelineSourceCursor } from "./ledger"
import { queryUsageByAgent, queryUsageByLaneHour, queryUsageBySession } from "./stats"

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
const MAX_IDENTIFIER_LENGTH = 256
const MAX_CLIENT_ERROR_BODY_BYTES = 16_384
const MAX_PAPERCUT_BODY_BYTES = 16_384

const ClientErrorSchema = Schema.Struct({
  message: Schema.String,
  stack: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Int),
  column: Schema.optional(Schema.Int),
  timestamp: Schema.optional(Schema.Int),
})

export interface ControlPlaneApiOptions {
  readonly ledger: LedgerStoreShape
  readonly clientErrorLogPath: string
  readonly pollIntervalMs?: number
  readonly subscriberQueueSize?: number
}

export interface ControlPlaneApiShape {
  readonly fetch: (request: Request) => Promise<Response>
}

export class ControlPlaneApi extends Context.Service<ControlPlaneApi, ControlPlaneApiShape>()("ControlPlane/HttpApi") {}

export function makeControlPlaneApi(options: ControlPlaneApiOptions) {
  const pollIntervalMs = boundedInteger(options.pollIntervalMs, 1, 60_000) ?? 1_000
  const subscriberQueueSize = boundedInteger(options.subscriberQueueSize, 1, 1_000) ?? 64
  const run = <A, E>(effect: Effect.Effect<A, E, LedgerStore>) => Effect.runPromise(effect.pipe(Effect.provideService(LedgerStore, options.ledger)))

  const fetch = async (request: Request) => {
    const origin = request.headers.get("origin")
    if (origin !== null && !isLocalOrigin(origin)) return jsonError(403, "forbidden_origin")
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) })

    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return jsonError(400, "invalid_url", origin)
    }

    try {
      if (request.method === "GET" && url.pathname === "/healthz") {
        const status = await run(options.ledger.statusSummary())
        return json({ ok: true, status }, 200, origin)
      }
      if (request.method === "GET" && url.pathname === "/api/agents") {
        const parentAgentId = optionalIdentifier(url.searchParams.get("parentAgentId"))
        if (parentAgentId === undefined && url.searchParams.has("parentAgentId")) return jsonError(400, "invalid_parent_agent_id", origin)
        return json({ agents: await run(getCurrentAgentStates(parentAgentId ?? undefined)) }, 200, origin)
      }
      if (request.method === "GET" && url.pathname.startsWith("/api/agents/")) {
        const parts = pathParts(url.pathname)
        if (parts === undefined || parts.length < 3) return jsonError(400, "malformed_path", origin)
        const agentId = identifier(parts[2])
        if (agentId === undefined) return jsonError(400, "invalid_agent_id", origin)
        if (parts.length === 4 && parts[3] === "timeline") {
          const afterAgentSeq = nonNegativeInteger(url.searchParams.get("afterAgentSeq"))
          const limit = boundedInteger(url.searchParams.get("limit") ?? undefined, 1, 1_000)
          if ((url.searchParams.has("afterAgentSeq") && afterAgentSeq === undefined) || (url.searchParams.has("limit") && limit === undefined)) return jsonError(400, "invalid_query", origin)
          return json(await run(getAgentTimeline(agentId, afterAgentSeq, limit)), 200, origin)
        }
        if (parts.length === 4 && parts[3] === "routes") return json({ routes: await run(getAgentRouteTimeline(agentId)) }, 200, origin)
        return jsonError(404, "not_found", origin)
      }
      if (request.method === "GET" && url.pathname.startsWith("/api/routes/")) {
        const parts = pathParts(url.pathname)
        if (parts === undefined || parts.length !== 3) return jsonError(400, "malformed_path", origin)
        const routeId = identifier(parts[2])
        if (routeId === undefined) return jsonError(400, "invalid_route_id", origin)
        const route = await run(getResolvedRoute(routeId))
        return route === undefined ? jsonError(404, "not_found", origin) : json(route, 200, origin)
      }
      if (request.method === "GET" && url.pathname.startsWith("/api/packets/")) {
        const parts = pathParts(url.pathname)
        if (parts === undefined || parts.length !== 4 || parts[3] !== "routes") return jsonError(400, "malformed_path", origin)
        const packetId = identifier(parts[2])
        if (packetId === undefined) return jsonError(400, "invalid_packet_id", origin)
        return json({ routes: await run(getPacketRouteTimeline(packetId)) }, 200, origin)
      }
      if (request.method === "GET" && url.pathname === "/api/stats") {
        const sinceTs = nonNegativeInteger(url.searchParams.get("sinceTs"))
        if (url.searchParams.has("sinceTs") && sinceTs === undefined) return jsonError(400, "invalid_query", origin)
        const filters = sinceTs === undefined ? {} : { sinceTs }
        const [byLaneHour, byAgent, bySession] = await Promise.all([
          Effect.runPromise(queryUsageByLaneHour(options.ledger.dbPath, filters)),
          Effect.runPromise(queryUsageByAgent(options.ledger.dbPath, filters)),
          Effect.runPromise(queryUsageBySession(options.ledger.dbPath, filters)),
        ])
        return json({ byLaneHour, byAgent, bySession }, 200, origin)
      }
      if (request.method === "GET" && (url.pathname === "/api/papercuts" || url.pathname === "/api/papercuts/recurring")) {
        const filters = papercutFilters(url, url.pathname === "/api/papercuts/recurring")
        if (filters === undefined) return jsonError(400, "invalid_query", origin)
        return json({ papercuts: await run(options.ledger.listPapercuts(filters)) }, 200, origin)
      }
      if (request.method === "GET" && url.pathname === "/events") {
        const cursor = parseEventCursor(request.headers.get("last-event-id"))
        if (cursor === null && request.headers.has("last-event-id")) return jsonError(400, "invalid_last_event_id", origin)
        return sseResponse(options.ledger, cursor ?? undefined, pollIntervalMs, subscriberQueueSize, origin)
      }
      if (request.method === "POST" && url.pathname === "/api/client-errors") {
        const clientError = await clientErrorPayload(request)
        if (clientError === undefined) return jsonError(400, "invalid_client_error", origin)
        mkdirSync(dirname(options.clientErrorLogPath), { recursive: true })
        appendFileSync(options.clientErrorLogPath, `${JSON.stringify(clientError)}\n`, "utf8")
        return json({ accepted: true }, 202, origin)
      }
      if (request.method === "POST" && url.pathname === "/api/papercuts") {
        const papercut = await papercutPayload(request)
        if (papercut === undefined) return jsonError(400, "invalid_papercut", origin)
        return json(await run(options.ledger.reportPapercut({ ...papercut, timestamp: Date.now() })), 202, origin)
      }
      return jsonError(404, "not_found", origin)
    } catch {
      return jsonError(503, "service_unavailable", origin)
    }
  }

  return { fetch }
}

export function makeControlPlaneApiService(options: ControlPlaneApiOptions) {
  return Effect.sync(() => makeControlPlaneApi(options))
}

function json(value: object, status: number, origin: string | null) {
  return new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...corsHeaders(origin) } })
}

function jsonError(status: number, code: string, origin: string | null = null) {
  return json({ error: { code } }, status, origin)
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (origin !== null && isLocalOrigin(origin)) {
    return { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, last-event-id", vary: "origin" }
  }
  return {}
}

function isLocalOrigin(origin: string) {
  try {
    const hostname = new URL(origin).hostname
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  } catch {
    return false
  }
}

function pathParts(pathname: string) {
  try {
    return pathname.split("/").slice(1).map(decodeURIComponent)
  } catch {
    return undefined
  }
}

function identifier(value: string) {
  return value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined
}

function optionalIdentifier(value: string | null) {
  return value === null ? undefined : identifier(value)
}

function nonNegativeInteger(value: string | null) {
  if (value === null || !/^(0|[1-9]\d*)$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function boundedInteger(value: string | number | undefined, minimum: number, maximum: number) {
  const text = typeof value === "number" ? String(value) : value
  const parsed = nonNegativeInteger(text ?? null)
  return parsed !== undefined && parsed >= minimum && parsed <= maximum ? parsed : undefined
}

function papercutFilters(url: URL, recurringOnly: boolean) {
  const severityValue = url.searchParams.get("severity")
  const statusValue = url.searchParams.get("status")
  const severity = severityValue === null ? undefined : decodePapercutSeverity(severityValue)
  const status = statusValue === null ? undefined : decodePapercutStatus(statusValue)
  const limit = boundedInteger(url.searchParams.get("limit") ?? undefined, 1, 1_000)
  if ((severityValue !== null && severity === undefined) || (statusValue !== null && status === undefined) || (url.searchParams.has("limit") && limit === undefined) || (recurringOnly && status !== undefined && status !== "recurring")) return undefined
  return { severity, status: recurringOnly ? "recurring" as const : status, limit }
}

function decodePapercutSeverity(value: string) {
  const decoded = Schema.decodeUnknownOption(PapercutSeveritySchema)(value)
  return Option.isSome(decoded) ? decoded.value : undefined
}

function decodePapercutStatus(value: string) {
  const decoded = Schema.decodeUnknownOption(PapercutStatusSchema)(value)
  return Option.isSome(decoded) ? decoded.value : undefined
}


function parseEventCursor(value: string | null) {
  if (value === null) return undefined
  const separator = value.lastIndexOf(":")
  if (separator <= 0) return null
  try {
    const sourceSessionId = identifier(decodeURIComponent(value.slice(0, separator)))
    const sourceSeq = nonNegativeInteger(value.slice(separator + 1))
    return sourceSessionId === undefined || sourceSeq === undefined ? null : { sourceSessionId, sourceSeq }
  } catch {
    return null
  }
}

function sseResponse(ledger: LedgerStoreShape, initialCursor: TimelineSourceCursor | undefined, pollIntervalMs: number, queueSize: number, origin: string | null) {
  let timer: ReturnType<typeof setInterval> | undefined
  let cursor = initialCursor
  let polling = false
  let closed = false
  const encoder = new TextEncoder()
  const pending: Uint8Array[] = []
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        closed = true
        clearInterval(timer)
      }
      const flush = () => {
        while (pending.length > 0 && (controller.desiredSize ?? 0) > 0) controller.enqueue(pending.shift()!)
      }
      const publish = (frame: string) => {
        if (closed) return
        const encoded = encoder.encode(frame)
        if ((controller.desiredSize ?? 0) > 0) {
          controller.enqueue(encoded)
          return
        }
        if (pending.length >= queueSize) {
          closed = true
          clearInterval(timer)
          controller.enqueue(encoder.encode("event: error\ndata: {\"code\":\"subscriber_backpressure\"}\n\n"))
          controller.close()
          return
        }
        pending.push(encoded)
      }
      const poll = async () => {
        if (closed || polling) return
        polling = true
        try {
          const rows = await Effect.runPromise(ledger.listTimelineRowsAfterSource(cursor, Math.min(queueSize + 2, 1_000)))
          if (rows.length > queueSize + 1) {
            closed = true
            clearInterval(timer)
            controller.enqueue(encoder.encode("event: error\ndata: {\"code\":\"subscriber_backpressure\"}\n\n"))
            controller.close()
            return
          }
          for (const row of rows) {
            const source = { sourceSessionId: row.sourceSessionId, sourceSeq: row.sourceSeq }
            publish(`id: ${encodeURIComponent(source.sourceSessionId)}:${source.sourceSeq}\nevent: agent-timeline\ndata: ${JSON.stringify({ eventId: row.id, occurredAt: row.ts, agentId: row.agentId, agentSeq: row.agentSeq, kind: row.kind, fromState: row.fromState, toState: row.toState, packetId: row.packetId, routeResolutionId: row.routeResolutionId, source })}\n\n`)
            cursor = source
          }
          flush()
        } catch {
          publish("event: error\ndata: {\"code\":\"service_unavailable\"}\n\n")
        } finally {
          polling = false
        }
      }
      void poll()
      timer = setInterval(() => {
        void poll()
        publish(": heartbeat\n\n")
        flush()
      }, pollIntervalMs)
      return close
    },
    pull(controller) {
      while (pending.length > 0 && (controller.desiredSize ?? 0) > 0) controller.enqueue(pending.shift()!)
    },
    cancel() {
      closed = true
      clearInterval(timer)
    },
  })
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...corsHeaders(origin) } })
}

async function clientErrorPayload(request: Request) {
  const text = await request.text()
  if (text.length === 0 || text.length > MAX_CLIENT_ERROR_BODY_BYTES) return undefined
  try {
    const decoded = Schema.decodeUnknownOption(ClientErrorSchema)(JSON.parse(text))
    if (Option.isNone(decoded)) return undefined
    const parsed = decoded.value
    if (parsed.message.length === 0 || parsed.message.length > 4_000) return undefined
    if (parsed.stack !== undefined && parsed.stack.length > 8_000) return undefined
    if (parsed.source !== undefined && parsed.source.length > 2_048) return undefined
    if (parsed.line !== undefined && parsed.line < 0) return undefined
    if (parsed.column !== undefined && parsed.column < 0) return undefined
    if (parsed.timestamp !== undefined && parsed.timestamp < 0) return undefined
    return { timestamp: parsed.timestamp ?? Date.now(), message: redact(parsed.message), stack: parsed.stack === undefined ? undefined : redact(parsed.stack), source: parsed.source === undefined ? undefined : redact(parsed.source), line: parsed.line, column: parsed.column }
  } catch {
    return undefined
  }
}

async function papercutPayload(request: Request) {
  const text = await request.text()
  if (text.length === 0 || text.length > MAX_PAPERCUT_BODY_BYTES) return undefined
  try {
    const decoded = Schema.decodeUnknownOption(PapercutInputSchema)(JSON.parse(text))
    if (Option.isNone(decoded)) return undefined
    const parsed = decoded.value
    if (parsed.message.trim().length === 0 || parsed.message.length > 4_000) return undefined
    if ([parsed.commandOrTool, parsed.cwdOrPackage, parsed.evidenceArtifactId].some((value) => value !== undefined && (value.trim().length === 0 || value.length > 2_048))) return undefined
    if (parsed.suggestedFix !== undefined && (parsed.suggestedFix.trim().length === 0 || parsed.suggestedFix.length > 4_000)) return undefined
    return {
      ...parsed,
      message: redact(parsed.message),
      commandOrTool: parsed.commandOrTool === undefined ? undefined : redact(parsed.commandOrTool),
      cwdOrPackage: parsed.cwdOrPackage === undefined ? undefined : redact(parsed.cwdOrPackage),
      evidenceArtifactId: parsed.evidenceArtifactId === undefined ? undefined : redact(parsed.evidenceArtifactId),
      suggestedFix: parsed.suggestedFix === undefined ? undefined : redact(parsed.suggestedFix),
    }
  } catch {
    return undefined
  }
}

function redact(value: string) {
  return value.replace(/(authorization|bearer|token|api[_-]?key|password)=?\s*[^\s&]+/gi, "$1=[REDACTED]")
}
