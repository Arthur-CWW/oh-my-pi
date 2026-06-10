import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { JimengJsonObjectSchema, JimengJsonValueSchema } from "./schema"

const URL_LIKE_RE = /https?:\/\/|byteimg|douyinpic|vlabvod|x-signature|x-expires|expire_time/i
const DEFAULT_LIMIT = 30
const MAX_STATIC_FILE_BYTES = 2_000_000
const STATIC_FILE_RE = /\.(?:[cm]?[jt]sx?|json|html|css|map|txt)$/i
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage"])

const RawNetworkCdpEventSchema = z.object({
  atIso: z.string().optional(),
  kind: z.literal("cdpEvent"),
  method: z.string().optional(),
  sessionId: z.string().optional(),
  params: JimengJsonObjectSchema.optional(),
}).passthrough()

const RawNetworkResponseBodySchema = z.object({
  atIso: z.string().optional(),
  kind: z.literal("responseBody"),
  requestId: z.string(),
  url: z.string(),
  status: z.number().optional().nullable(),
  mimeType: z.string().optional().nullable(),
  base64Encoded: z.boolean().optional(),
  truncatedBytes: z.boolean().optional(),
  body: z.string(),
}).passthrough()

const RawNetworkEventSchema = z.discriminatedUnion("kind", [
  RawNetworkCdpEventSchema,
  RawNetworkResponseBodySchema,
])

type RawNetworkEvent = z.infer<typeof RawNetworkEventSchema>

export type JimengCaptureRiskClass = "read" | "mutate" | "upload" | "generate" | "payment" | "analytics" | "third_party" | "unclassified"

interface CapturedRequestState {
  requestId: string
  startedAtIso: string | null
  method: string
  url: string
  type: string | null
  status: number | null
  mimeType: string | null
  requestHeaders: Record<string, string>
  responseHeaders: Record<string, string>
  postData: string | null
  responseBody: string | null
  responseBodySha256: string | null
  responseBodyTruncated: boolean
  initiatorScripts: string[]
  initiatorFunctions: string[]
  documentUrl: string | null
}

export interface JimengStaticHint {
  file: string
  line: number
  column: number
}

export interface JimengCaptureCandidate {
  rank: number
  request_id: string
  method: string
  endpoint: string
  url_host: string
  url_pathname: string
  url_query_keys: string[]
  status: number | null
  type: string | null
  mime_type: string | null
  risk_class: JimengCaptureRiskClass
  replay_safe_by_default: boolean
  score: number
  reasons: string[]
  request_body_sha256: string | null
  response_text_sha256: string | null
  response_text_has_url_like_tokens: boolean
  response_ret: string | number | null
  response_errmsg: string | null
  request_shape: JsonObject | null
  response_shape: JsonObject | null
  initiator_scripts: string[]
  initiator_functions: string[]
  static_hints: JimengStaticHint[]
}

export interface JimengEndpointProbeCandidate {
  name: string
  endpoint: string
  method: "GET" | "POST"
  query: string | null
  risk_class: JimengCaptureRiskClass
  replay_safe_by_default: boolean
  variants: Array<{ name: string; body: JsonValue }>
}

export interface JimengCaptureAnalysis {
  source_path: string | null
  analyzed_at_iso: string
  total_events: number
  total_requests: number
  candidates: JimengCaptureCandidate[]
  endpoint_probe_candidates: JimengEndpointProbeCandidate[]
}

export function analyzeJimengNetworkCaptureFile(input: {
  rawNetworkFile: string
  staticRoots?: string[]
  limit?: number
  includeRisky?: boolean
}): JimengCaptureAnalysis {
  const file = path.resolve(input.rawNetworkFile)
  const text = readFileSync(file, "utf8")
  return analyzeJimengNetworkCapture({
    rawNetworkText: text,
    sourcePath: file,
    staticRoots: input.staticRoots,
    limit: input.limit,
    includeRisky: input.includeRisky,
  })
}

export function analyzeJimengNetworkCapture(input: {
  rawNetworkText: string
  sourcePath?: string
  staticRoots?: string[]
  limit?: number
  includeRisky?: boolean
}): JimengCaptureAnalysis {
  const states = new Map<string, CapturedRequestState>()
  const lines = input.rawNetworkText.split(/\r?\n/).filter((line) => line.trim().length > 0)
  let totalEvents = 0

  for (const [index, line] of lines.entries()) {
    const event = parseRawNetworkEvent(line, index + 1)
    totalEvents += 1
    applyRawNetworkEvent(states, event)
  }

  const limit = input.limit ?? DEFAULT_LIMIT
  const allCandidates = Array.from(states.values())
    .filter((state) => state.url && state.method)
    .map(buildCandidate)
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.url_pathname.localeCompare(b.url_pathname))

  const endpoints = new Set(allCandidates.map((candidate) => candidate.url_pathname))
  const staticHints = collectStaticHints(input.staticRoots ?? [], endpoints)
  const candidates = allCandidates
    .slice(0, limit)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      static_hints: staticHints.get(candidate.url_pathname) ?? [],
    }))

  return {
    source_path: input.sourcePath ?? null,
    analyzed_at_iso: new Date().toISOString(),
    total_events: totalEvents,
    total_requests: states.size,
    candidates,
    endpoint_probe_candidates: candidates
      .filter((candidate) => input.includeRisky === true || candidate.replay_safe_by_default)
      .flatMap((candidate) => buildProbeCandidate(states.get(candidate.request_id), candidate)),
  }
}

export function writeJimengCaptureAnalysisMarkdown(analysis: JimengCaptureAnalysis): string {
  const lines: string[] = []
  lines.push("# Jimeng Capture Analysis")
  lines.push("")
  lines.push(`- Source: ${analysis.source_path ?? "inline"}`)
  lines.push(`- Analyzed at: ${analysis.analyzed_at_iso}`)
  lines.push(`- Events: ${analysis.total_events}`)
  lines.push(`- Requests: ${analysis.total_requests}`)
  lines.push(`- Ranked candidates: ${analysis.candidates.length}`)
  lines.push(`- Replay candidates: ${analysis.endpoint_probe_candidates.length}`)
  lines.push("")
  lines.push("## Ranked Endpoints")
  lines.push("")
  lines.push("| Rank | Score | Risk | Method | Endpoint | Status | Safe Replay | Reasons |")
  lines.push("| ---: | ---: | --- | --- | --- | ---: | --- | --- |")
  for (const candidate of analysis.candidates) {
    lines.push([
      candidate.rank,
      candidate.score,
      candidate.risk_class,
      candidate.method,
      `\`${candidate.url_pathname}\``,
      candidate.status ?? "",
      candidate.replay_safe_by_default ? "yes" : "no",
      candidate.reasons.join(", "),
    ].join(" | "))
  }
  lines.push("")
  lines.push("Probe bodies are written only to local JSON artifacts. Re-check risk class before replaying generate, upload, mutate, or payment endpoints.")
  return `${lines.join("\n")}\n`
}

function parseRawNetworkEvent(line: string, lineNumber: number): RawNetworkEvent {
  let json: JsonValue
  try {
    json = JimengJsonValueSchema.parse(JSON.parse(line))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "validation",
      code: "RAW_NETWORK_JSON_INVALID",
      message: "Raw network JSONL line was not valid JSON.",
      retryable: false,
      details: { line: lineNumber, message },
    })
  }
  const parsed = RawNetworkEventSchema.safeParse(json)
  if (parsed.success) return parsed.data
  throw jimengError({
    category: "validation",
    code: "RAW_NETWORK_EVENT_CHANGED",
    message: "Raw network JSONL line did not match the supported recorder event contract.",
    retryable: false,
    details: {
      line: lineNumber,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      })),
    },
  })
}

function applyRawNetworkEvent(states: Map<string, CapturedRequestState>, event: RawNetworkEvent): void {
  if (event.kind === "responseBody") {
    const state = ensureRequestState(states, event.requestId, event.atIso ?? null)
    state.url = event.url || state.url
    state.status = event.status ?? state.status
    state.mimeType = event.mimeType ?? state.mimeType
    state.responseBody = event.body
    state.responseBodySha256 = sha256(event.body)
    state.responseBodyTruncated = event.truncatedBytes === true
    return
  }

  const requestId = stringValue(event.params?.requestId)
  if (!requestId || !event.method) return
  const state = ensureRequestState(states, requestId, event.atIso ?? null)

  if (event.method === "Network.requestWillBeSent") {
    const request = recordValue(event.params?.request)
    state.url = stringValue(request?.url) ?? state.url
    state.method = stringValue(request?.method) ?? state.method
    state.type = stringValue(event.params?.type) ?? state.type
    state.documentUrl = stringValue(event.params?.documentURL) ?? state.documentUrl
    state.postData = stringValue(request?.postData) ?? state.postData
    state.requestHeaders = { ...state.requestHeaders, ...headersValue(request?.headers) }
    const initiator = collectInitiator(event.params?.initiator)
    state.initiatorScripts = mergeUnique(state.initiatorScripts, initiator.scripts)
    state.initiatorFunctions = mergeUnique(state.initiatorFunctions, initiator.functions)
    return
  }

  if (event.method === "Network.requestWillBeSentExtraInfo") {
    state.requestHeaders = { ...state.requestHeaders, ...headersValue(event.params?.headers) }
    return
  }

  if (event.method === "Network.responseReceived") {
    const response = recordValue(event.params?.response)
    state.status = numberValue(response?.status) ?? state.status
    state.mimeType = stringValue(response?.mimeType) ?? state.mimeType
    state.responseHeaders = { ...state.responseHeaders, ...headersValue(response?.headers) }
    return
  }

  if (event.method === "Network.responseReceivedExtraInfo") {
    state.status = numberValue(event.params?.statusCode) ?? state.status
    state.responseHeaders = { ...state.responseHeaders, ...headersValue(event.params?.headers) }
  }
}

function ensureRequestState(states: Map<string, CapturedRequestState>, requestId: string, atIso: string | null): CapturedRequestState {
  const existing = states.get(requestId)
  if (existing) return existing
  const created: CapturedRequestState = {
    requestId,
    startedAtIso: atIso,
    method: "",
    url: "",
    type: null,
    status: null,
    mimeType: null,
    requestHeaders: {},
    responseHeaders: {},
    postData: null,
    responseBody: null,
    responseBodySha256: null,
    responseBodyTruncated: false,
    initiatorScripts: [],
    initiatorFunctions: [],
    documentUrl: null,
  }
  states.set(requestId, created)
  return created
}

function buildCandidate(state: CapturedRequestState): JimengCaptureCandidate {
  const parsedUrl = parseUrl(state.url)
  const requestBody = parseOptionalJson(state.postData)
  const responseBody = parseOptionalJson(state.responseBody)
  const riskClass = classifyRisk(state, parsedUrl, requestBody)
  const scoring = scoreRequest(state, parsedUrl, requestBody, responseBody, riskClass)
  const envelope = envelopeValues(responseBody)
  return {
    rank: 0,
    request_id: state.requestId,
    method: state.method || "GET",
    endpoint: parsedUrl.host === "jimeng.jianying.com" ? parsedUrl.pathname : `${parsedUrl.host}${parsedUrl.pathname}`,
    url_host: parsedUrl.host,
    url_pathname: parsedUrl.pathname,
    url_query_keys: parsedUrl.queryKeys,
    status: state.status,
    type: state.type,
    mime_type: state.mimeType,
    risk_class: riskClass,
    replay_safe_by_default: isReplaySafe(riskClass),
    score: scoring.score,
    reasons: scoring.reasons,
    request_body_sha256: state.postData ? sha256(state.postData) : null,
    response_text_sha256: state.responseBodySha256,
    response_text_has_url_like_tokens: state.responseBody ? URL_LIKE_RE.test(state.responseBody) : false,
    response_ret: envelope.ret,
    response_errmsg: envelope.errmsg,
    request_shape: requestBody ? summarizeJsonShape(requestBody) : null,
    response_shape: responseBody ? summarizeJsonShape(responseBody) : null,
    initiator_scripts: state.initiatorScripts.slice(0, 12),
    initiator_functions: state.initiatorFunctions.slice(0, 24),
    static_hints: [],
  }
}

function buildProbeCandidate(state: CapturedRequestState | undefined, candidate: JimengCaptureCandidate): JimengEndpointProbeCandidate[] {
  if (!state) return []
  if (!isProbeableEndpoint(candidate.url_pathname)) return []
  const method = candidate.method.toUpperCase() === "GET" ? "GET" : "POST"
  const body = parseOptionalJson(state.postData) ?? {}
  return [{
    name: candidate.url_pathname.replace(/^\/+/, "").replace(/[^0-9A-Za-z_.-]+/g, "-") || "root",
    endpoint: candidate.url_host === "jimeng.jianying.com" ? candidate.url_pathname : `https://${candidate.url_host}${candidate.url_pathname}`,
    method,
    query: candidate.url_pathname.startsWith("/mweb/") ? null : "",
    risk_class: candidate.risk_class,
    replay_safe_by_default: candidate.replay_safe_by_default,
    variants: [{ name: "captured", body }],
  }]
}

function isProbeableEndpoint(pathname: string): boolean {
  return /^\/(?:mweb|api|commerce|lv|webcast|aweme)\//.test(pathname)
}

function parseUrl(url: string): { host: string; pathname: string; queryKeys: string[] } {
  if (!/^https?:\/\//i.test(url)) {
    return { host: "non-http", pathname: url.split(":", 1)[0] || "non-http", queryKeys: [] }
  }
  try {
    const parsed = new URL(url)
    return {
      host: parsed.host,
      pathname: parsed.pathname || "/",
      queryKeys: Array.from(parsed.searchParams.keys()).sort(),
    }
  } catch {
    return { host: "invalid-url", pathname: url.split("?")[0] || "", queryKeys: [] }
  }
}

function classifyRisk(state: CapturedRequestState, parsedUrl: { host: string; pathname: string }, requestBody: JsonValue | null): JimengCaptureRiskClass {
  const haystack = `${parsedUrl.host} ${parsedUrl.pathname} ${state.method} ${state.mimeType ?? ""} ${requestBody ? JSON.stringify(summarizeJsonShape(requestBody)) : ""}`.toLowerCase()
  const pathText = parsedUrl.pathname.toLowerCase()
  if (/pay|payment|vip|order|checkout|subscribe|wallet|billing|credit/.test(haystack)) return "payment"
  if (/mcs\.|analytics|slardar|collect|beacon|event|log|report|monitor/.test(haystack)) return "analytics"
  if (parsedUrl.host && parsedUrl.host !== "jimeng.jianying.com" && !parsedUrl.host.endsWith(".jianying.com")) return "third_party"
  if (/upload|imagex|tos|applyupload|commitupload|submit_audit/.test(haystack)) return "upload"
  if (state.method.toUpperCase() === "GET" || /get_|\/get|list|query|feed|search|config|categories|metadata|history|asset|explore/.test(pathText)) return "read"
  if (/aigc_draft\/generate|creation_agent|generate|submit|task|lip.?sync|text.?to.?video|image.?to.?video|conversation/.test(haystack)) return "generate"
  if (/create|update|delete|save|favorite|publish|edit/.test(haystack)) return "mutate"
  return "unclassified"
}

function scoreRequest(
  state: CapturedRequestState,
  parsedUrl: { host: string; pathname: string },
  requestBody: JsonValue | null,
  responseBody: JsonValue | null,
  riskClass: JimengCaptureRiskClass,
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []
  const pathText = parsedUrl.pathname.toLowerCase()
  if (parsedUrl.host === "jimeng.jianying.com") add(20, "same-origin")
  if (pathText.startsWith("/mweb/")) add(60, "mweb-api")
  if (state.method.toUpperCase() === "POST") add(20, "post")
  if (requestBody) add(25, "json-request")
  if (responseBody) add(25, "json-response")
  if (envelopeValues(responseBody).ret !== null) add(15, "jimeng-envelope")
  if (/video|image|voice|subject|persona|template|explore|asset|history|lip|control|mask|pose/.test(pathText)) add(35, "ugc-relevant")
  if (riskClass === "read") add(20, "safe-read")
  if (riskClass === "generate") add(10, "generation-api")
  if (riskClass === "upload") add(5, "upload-api")
  if (riskClass === "analytics") add(-90, "analytics")
  if (riskClass === "payment") add(-120, "payment-risk")
  if (riskClass === "third_party") add(-70, "third-party")
  if (parsedUrl.host === "non-http" || parsedUrl.host === "invalid-url") add(-150, "non-http")
  return { score, reasons }

  function add(delta: number, reason: string): void {
    score += delta
    reasons.push(reason)
  }
}

function isReplaySafe(riskClass: JimengCaptureRiskClass): boolean {
  return riskClass === "read"
}

function envelopeValues(value: JsonValue | null): { ret: string | number | null; errmsg: string | null } {
  const record = recordValue(value)
  return {
    ret: stringValue(record?.ret) ?? numberValue(record?.ret),
    errmsg: stringValue(record?.errmsg),
  }
}

function parseOptionalJson(text: string | null): JsonValue | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed || !(trimmed.startsWith("{") || trimmed.startsWith("["))) return null
  const parsed = JimengJsonValueSchema.safeParse(JSON.parse(trimmed))
  return parsed.success ? parsed.data : null
}

function summarizeJsonShape(value: JsonValue, depth = 0): JsonObject {
  if (value === null) return { kind: "null" }
  if (typeof value === "string") return { kind: "string", length: value.length, url_like: URL_LIKE_RE.test(value) }
  if (typeof value === "number") return { kind: "number" }
  if (typeof value === "boolean") return { kind: "boolean" }
  if (Array.isArray(value)) {
    return {
      kind: "array",
      length: value.length,
      first: depth >= 3 || value.length === 0 ? null : summarizeJsonShape(value[0]!, depth + 1),
    }
  }
  const keys = Object.keys(value).sort()
  const fields: JsonObject = {}
  if (depth < 3) {
    for (const key of keys.slice(0, 16)) fields[key] = summarizeJsonShape(value[key], depth + 1)
  }
  return { kind: "object", key_count: keys.length, keys: keys.slice(0, 64), fields }
}

function collectInitiator(value: JsonValue | undefined): { scripts: string[]; functions: string[] } {
  const scripts: string[] = []
  const functions: string[] = []
  const initiator = recordValue(value)
  collectStack(recordValue(initiator?.stack), scripts, functions)
  return { scripts, functions }
}

function collectStack(stack: JsonObject | null, scripts: string[], functions: string[]): void {
  if (!stack) return
  const frames = arrayValue(stack.callFrames)
  for (const frameValue of frames) {
    const frame = recordValue(frameValue)
    const url = stringValue(frame?.url)
    const functionName = stringValue(frame?.functionName)
    if (url) scripts.push(stripUrlQuery(url))
    if (functionName) functions.push(functionName)
  }
  collectStack(recordValue(stack.parent), scripts, functions)
}

function collectStaticHints(roots: string[], endpoints: Set<string>): Map<string, JimengStaticHint[]> {
  const hints = new Map<string, JimengStaticHint[]>()
  const normalizedRoots = roots.map((root) => path.resolve(root)).filter((root) => existsSync(root))
  if (normalizedRoots.length === 0 || endpoints.size === 0) return hints
  for (const root of normalizedRoots) {
    for (const file of walkStaticFiles(root)) {
      const text = readFileSync(file, "utf8")
      for (const endpoint of endpoints) {
        const index = text.indexOf(endpoint)
        if (index < 0) continue
        const hint = indexToLineColumn(text, index)
        const list = hints.get(endpoint) ?? []
        if (list.length < 8) list.push({ file, line: hint.line, column: hint.column })
        hints.set(endpoint, list)
      }
    }
  }
  return hints
}

function walkStaticFiles(root: string): string[] {
  const found: string[] = []
  visit(root)
  return found

  function visit(target: string): void {
    const stat = statSync(target)
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(path.basename(target))) return
      for (const entry of readdirSync(target)) visit(path.join(target, entry))
      return
    }
    if (!stat.isFile()) return
    if (stat.size > MAX_STATIC_FILE_BYTES) return
    if (!STATIC_FILE_RE.test(target)) return
    found.push(target)
  }
}

function indexToLineColumn(text: string, index: number): { line: number; column: number } {
  const prefix = text.slice(0, index)
  const lines = prefix.split("\n")
  return { line: lines.length, column: lines[lines.length - 1]!.length + 1 }
}

function headersValue(value: JsonValue | undefined): Record<string, string> {
  const record = recordValue(value)
  if (!record) return {}
  const headers: Record<string, string> = {}
  for (const [key, child] of Object.entries(record)) {
    const stringChild = stringValue(child)
    const numberChild = numberValue(child)
    const boolChild = booleanValue(child)
    if (stringChild !== null) headers[key.toLowerCase()] = stringChild
    else if (numberChild !== null) headers[key.toLowerCase()] = String(numberChild)
    else if (boolChild !== null) headers[key.toLowerCase()] = String(boolChild)
  }
  return headers
}

function recordValue(value: JsonValue | undefined | null): JsonObject | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function arrayValue(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null
}

function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === "number" ? value : null
}

function booleanValue(value: JsonValue | undefined): boolean | null {
  return typeof value === "boolean" ? value : null
}

function mergeUnique(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right])).filter(Boolean)
}

function stripUrlQuery(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}`
  } catch {
    return url
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
