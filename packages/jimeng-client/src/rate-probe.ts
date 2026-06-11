import { createHash } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"
import { JimengClient, type JimengFetch } from "./client"
import {
  buildJimengEndpointProbeHeaders,
  buildJimengEndpointProbeUrl,
  type JimengEndpointProbeVariant,
} from "./endpoint-probe"
import { JimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { parseJimengApiEnvelope, parseJsonText } from "./schema"
import { type JimengSessionBundle } from "./capture"

const URL_LIKE_RE = /https?:\/\/|byteimg|douyinpic|vlabvod|x-signature|x-expires|expire_time/i
const RISKY_ENDPOINT_RE = /\/(?:aigc_draft\/generate|submit|create|update|delete|upload|tts_generate|voice_clone|generate_voice)\b/i

export interface JimengRateProbeInput {
  endpoint: string
  method?: "GET" | "POST"
  query?: string
  host?: string
  variants: JimengEndpointProbeVariant[]
  requestCount: number
  concurrency: number
  delayMs?: number
  includeRisky?: boolean
}

export interface JimengRateProbeAttempt {
  index: number
  worker: number
  variantName: string
  startedAtIso: string
  finishedAtIso: string
  durationMs: number
  httpStatus: number | null
  ret: string | number | null
  errmsg: string | null
  ok: boolean
  errorCode: string | null
  errorCategory: string | null
  errorMessage: string | null
  responseTextSha256: string | null
  responseTextHasUrlLikeTokens: boolean
  topLevelKeys: string[]
}

export interface JimengRateProbeResult {
  endpoint: string
  url: string
  method: "GET" | "POST"
  requestCount: number
  concurrency: number
  delayMs: number
  includeRisky: boolean
  startedAtIso: string
  finishedAtIso: string
  elapsedMs: number
  stopped: boolean
  stopReason: string | null
  attempts: JimengRateProbeAttempt[]
}

export async function runJimengRateProbe(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  probe: JimengRateProbeInput
}): Promise<JimengRateProbeResult> {
  const requestCount = positiveInteger(input.probe.requestCount, "requestCount")
  const concurrency = Math.min(positiveInteger(input.probe.concurrency, "concurrency"), requestCount)
  const method = input.probe.method ?? "POST"
  const delayMs = Math.max(0, input.probe.delayMs ?? 0)
  const variants = input.probe.variants
  if (variants.length === 0) throw new Error("rate-probe requires at least one variant")
  assertRateProbeEndpointAllowed(input.probe.endpoint, input.probe.includeRisky === true)

  const url = buildJimengEndpointProbeUrl(input.probe)
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const headers = buildJimengEndpointProbeHeaders(input.session)
  const attempts: JimengRateProbeAttempt[] = []
  const startedAtMs = Date.now()
  const startedAtIso = new Date(startedAtMs).toISOString()
  let nextIndex = 0
  let stopped = false
  let stopReason: string | null = null

  async function worker(workerIndex: number): Promise<void> {
    while (true) {
      if (stopped) return
      const index = nextIndex
      nextIndex += 1
      if (index >= requestCount) return
      if (delayMs > 0 && index > 0) await sleep(delayMs)
      if (stopped) return

      const variant = variants[index % variants.length]!
      const attempt = await runAttempt({
        client,
        url,
        method,
        headers,
        body: variant.body,
        index,
        worker: workerIndex,
        variantName: variant.name,
      })
      attempts.push(attempt)

      const reason = classifyStopReason(attempt)
      if (reason && !stopped) {
        stopped = true
        stopReason = reason
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index + 1)))
  attempts.sort((left, right) => left.index - right.index)
  const finishedAtMs = Date.now()
  return {
    endpoint: input.probe.endpoint,
    url,
    method,
    requestCount,
    concurrency,
    delayMs,
    includeRisky: input.probe.includeRisky === true,
    startedAtIso,
    finishedAtIso: new Date(finishedAtMs).toISOString(),
    elapsedMs: finishedAtMs - startedAtMs,
    stopped,
    stopReason,
    attempts,
  }
}

export function summarizeJimengRateProbe(result: JimengRateProbeResult): JsonObject {
  const url = new URL(result.url)
  const durations = result.attempts.map((attempt) => attempt.durationMs).sort((left, right) => left - right)
  const completed = result.attempts.length
  const elapsedSec = Math.max(result.elapsedMs / 1000, 0.001)
  return {
    endpoint: result.endpoint,
    url_host: url.host,
    url_pathname: url.pathname,
    url_query_keys: Array.from(url.searchParams.keys()).sort(),
    method: result.method,
    requested_count: result.requestCount,
    completed_count: completed,
    concurrency: result.concurrency,
    delay_ms: result.delayMs,
    include_risky: result.includeRisky,
    stopped: result.stopped,
    stop_reason: result.stopReason,
    elapsed_ms: result.elapsedMs,
    throughput_per_sec: round(completed / elapsedSec),
    latency_ms: {
      min: durations[0] ?? null,
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      max: durations[durations.length - 1] ?? null,
    },
    http_status_counts: countBy(result.attempts.map((attempt) => attempt.httpStatus === null ? "none" : String(attempt.httpStatus))),
    ret_counts: countBy(result.attempts.map((attempt) => attempt.ret === null ? "none" : String(attempt.ret))),
    error_counts: countBy(result.attempts.map((attempt) => attempt.errorCode ?? "none")),
    variant_counts: countBy(result.attempts.map((attempt) => attempt.variantName)),
    response_url_like_count: result.attempts.filter((attempt) => attempt.responseTextHasUrlLikeTokens).length,
    attempts: result.attempts.map((attempt) => ({
      index: attempt.index,
      worker: attempt.worker,
      variant_name: attempt.variantName,
      duration_ms: attempt.durationMs,
      http_status: attempt.httpStatus,
      ret: attempt.ret,
      errmsg: attempt.errmsg,
      ok: attempt.ok,
      error_code: attempt.errorCode,
      error_category: attempt.errorCategory,
      response_text_sha256: attempt.responseTextSha256,
      response_text_has_url_like_tokens: attempt.responseTextHasUrlLikeTokens,
      top_level_keys: attempt.topLevelKeys,
    })),
  }
}

function assertRateProbeEndpointAllowed(endpoint: string, includeRisky: boolean): void {
  if (includeRisky) return
  const pathname = endpoint.startsWith("http://") || endpoint.startsWith("https://")
    ? new URL(endpoint).pathname
    : endpoint.split("?")[0] ?? endpoint
  if (!RISKY_ENDPOINT_RE.test(pathname)) return
  throw new Error("rate-probe rejects likely mutating/generating endpoints unless --includeRisky is passed")
}

async function runAttempt(input: {
  client: JimengClient
  url: string
  method: "GET" | "POST"
  headers: Record<string, string>
  body: JsonValue
  index: number
  worker: number
  variantName: string
}): Promise<JimengRateProbeAttempt> {
  const startedAtMs = Date.now()
  const startedAtIso = new Date(startedAtMs).toISOString()
  try {
    const response = await input.client.requestText(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.method === "GET" ? undefined : JSON.stringify(input.body),
    })
    const body = parseJsonText(response.text, `rate probe ${input.index}`)
    const envelope = parseOptionalEnvelope(body)
    return {
      index: input.index,
      worker: input.worker,
      variantName: input.variantName,
      startedAtIso,
      finishedAtIso: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      httpStatus: response.status,
      ret: envelope.ret,
      errmsg: envelope.errmsg,
      ok: response.status >= 200 && response.status < 300 && (envelope.ret === null || envelope.ret === "0" || envelope.ret === 0),
      errorCode: null,
      errorCategory: null,
      errorMessage: null,
      responseTextSha256: sha256(response.text),
      responseTextHasUrlLikeTokens: URL_LIKE_RE.test(response.text),
      topLevelKeys: Object.keys(asRecord(body) ?? {}).sort(),
    }
  } catch (error) {
    return {
      index: input.index,
      worker: input.worker,
      variantName: input.variantName,
      startedAtIso,
      finishedAtIso: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      httpStatus: null,
      ret: null,
      errmsg: null,
      ok: false,
      errorCode: error instanceof JimengError ? error.code : "REQUEST_FAILED",
      errorCategory: error instanceof JimengError ? error.category : "unknown",
      errorMessage: error instanceof Error ? error.message : String(error),
      responseTextSha256: null,
      responseTextHasUrlLikeTokens: false,
      topLevelKeys: [],
    }
  }
}

function classifyStopReason(attempt: JimengRateProbeAttempt): string | null {
  if (attempt.httpStatus === 429) return "http_429_rate_limited"
  if (attempt.httpStatus === 401 || attempt.httpStatus === 403) return `http_${attempt.httpStatus}_auth`
  if (attempt.errorCategory === "risk_control") return "risk_control"
  if (attempt.errorCategory === "auth") return "auth_error"
  const ret = attempt.ret === null ? "" : String(attempt.ret)
  if (ret === "1019") return "ret_1019_risk_control"
  if (ret === "1015" || ret === "1017") return `ret_${ret}_auth`
  const message = `${attempt.errmsg ?? ""} ${attempt.errorMessage ?? ""}`.toLowerCase()
  if (message.includes("shark") || message.includes("risk")) return "risk_message"
  if (message.includes("captcha") || message.includes("verify")) return "verification_message"
  if (message.includes("login") || message.includes("auth")) return "auth_message"
  return null
}

function parseOptionalEnvelope(body: JsonValue): { ret: string | number | null; errmsg: string | null } {
  try {
    const envelope = parseJimengApiEnvelope(body, "rate probe")
    return {
      ret: envelope.ret ?? null,
      errmsg: envelope.errmsg ?? null,
    }
  } catch {
    return { ret: null, errmsg: null }
  }
}

function positiveInteger(value: number, name: string): number {
  if (Number.isInteger(value) && value > 0) return value
  throw new Error(`${name} must be a positive integer`)
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null
  const index = Math.ceil(values.length * ratio) - 1
  return values[Math.max(0, Math.min(index, values.length - 1))] ?? null
}

function countBy(values: string[]): JsonObject {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

function asRecord(value: JsonValue | undefined): JsonObject | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
