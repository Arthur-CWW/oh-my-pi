#!/usr/bin/env bun
import { createWriteStream, mkdirSync, writeFileSync, type WriteStream } from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { redactHeaders } from "./capture"

const DEFAULT_CDP_URL = "http://127.0.0.1:9340"
const DEFAULT_JIMENG_URL = "https://jimeng.jianying.com/"
const DEFAULT_DURATION_SEC = 300
const DEFAULT_MAX_BODY_BYTES = 250_000

const USAGE = `Usage: jimeng-network-recorder [options]

Passive background-CDP network recorder for Jimeng/Dreamina frontend reversal.
No DevTools UI is opened and Target.activateTarget/page.bringToFront are never used.

Options:
  --cdp <url>                 CDP HTTP URL (default: ${DEFAULT_CDP_URL})
  --url <url>                 URL for a new background target (default: ${DEFAULT_JIMENG_URL})
  --target-url <substring>    Attach to an existing page whose URL/title contains this text
  --no-create                 Fail instead of creating a background target when no existing target matches
  --flow <name>               Flow slug for output dir (default: manual)
  --outDir <dir>              Output dir (default: data/jimeng-captures/<timestamp>-<flow>)
  --durationSec <seconds>     Stop after N seconds; 0 waits for Ctrl-C (default: ${DEFAULT_DURATION_SEC})
  --maxBodyBytes <bytes>      Max request/response body bytes kept per JSONL body event (default: ${DEFAULT_MAX_BODY_BYTES})
  --include-all               Fetch bodies for all responses, not only JSON/SSE/API-looking ones
  --no-bypass-service-worker  Do not call Network.setBypassServiceWorker
  --help                      Show help

Examples:
  bun packages/jimeng-client/src/network-recorder.ts --flow image2video-upload --durationSec 180
  bun packages/jimeng-client/src/network-recorder.ts --target-url jimeng.jianying.com --flow manual-upload --durationSec 0
`

interface RecorderArgs {
  cdpUrl: string
  url: string
  targetUrl?: string
  createIfMissing: boolean
  flow: string
  outDir: string
  durationSec: number
  maxBodyBytes: number
  includeAll: boolean
  bypassServiceWorker: boolean
}

interface CdpTargetInfo {
  id: string
  type: string
  title: string
  url: string
}

interface CdpVersionInfo {
  webSocketDebuggerUrl?: string
}

interface CdpMessage {
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code?: number; message?: string; data?: string }
  sessionId?: string
}

interface RequestRecord {
  requestId: string
  url: string
  method: string
  type: string | null
  status: number | null
  mimeType: string | null
  requestHeaders: Record<string, string>
  responseHeaders: Record<string, string>
  postData: string | null
  responseBodyBytes: number | null
  responseBodySha256?: string
  encodedDataLength?: number
  startedAtIso: string
  finishedAtIso?: string
}

interface RecorderState {
  requests: Map<string, RequestRecord>
  bodyPromises: Promise<void>[]
}

class CdpConnection {
  #nextId = 1
  #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  #eventHandlers = new Set<(message: CdpMessage) => void>()

  constructor(private readonly ws: WebSocket) {
    this.ws.addEventListener("message", (event) => this.handleMessage(event.data))
    this.ws.addEventListener("close", () => {
      for (const [id, pending] of this.#pending) {
        pending.reject(new Error(`CDP socket closed with pending command id=${id}`))
      }
      this.#pending.clear()
    })
  }

  static async connect(webSocketDebuggerUrl: string): Promise<CdpConnection> {
    const ws = new WebSocket(webSocketDebuggerUrl)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true })
      ws.addEventListener("error", () => reject(new Error(`Failed to connect CDP websocket: ${webSocketDebuggerUrl}`)), { once: true })
    })
    return new CdpConnection(ws)
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = this.#nextId++
    const message = { id, method, params, ...(sessionId ? { sessionId } : {}) }

    const promise = new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: (value) => resolve(value as T), reject })
    })

    this.ws.send(JSON.stringify(message))
    return promise
  }

  onEvent(handler: (message: CdpMessage) => void): () => void {
    this.#eventHandlers.add(handler)
    return () => this.#eventHandlers.delete(handler)
  }

  close(): void {
    this.ws.close()
  }

  private handleMessage(data: unknown): void {
    const text = messageDataToString(data)
    const message = JSON.parse(text) as CdpMessage

    if (typeof message.id === "number") {
      const pending = this.#pending.get(message.id)
      if (!pending) return
      this.#pending.delete(message.id)

      if (message.error) {
        pending.reject(new Error(`CDP ${message.error.code ?? "error"}: ${message.error.message ?? "unknown"}${message.error.data ? ` (${message.error.data})` : ""}`))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    for (const handler of this.#eventHandlers) handler(message)
  }
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  mkdirSync(args.outDir, { recursive: true })

  const rawNetworkFile = path.join(args.outDir, "raw-network.jsonl")
  const captureTemplateFile = path.join(args.outDir, "capture-template.raw.json")
  const summaryFile = path.join(args.outDir, "redacted-summary.md")
  const raw = createWriteStream(rawNetworkFile, { flags: "a" })
  const state: RecorderState = { requests: new Map(), bodyPromises: [] }

  console.log(`[jimeng-recorder] CDP ${args.cdpUrl}`)
  console.log(`[jimeng-recorder] output ${args.outDir}`)
  console.log(`[jimeng-recorder] raw ${rawNetworkFile}`)

  const version = await fetchJson<CdpVersionInfo>(`${args.cdpUrl}/json/version`)
  if (!version.webSocketDebuggerUrl) throw new Error(`CDP endpoint missing webSocketDebuggerUrl: ${args.cdpUrl}/json/version`)
  const cdp = await CdpConnection.connect(version.webSocketDebuggerUrl)

  try {
    const target = await resolveTarget(cdp, args)
    const attached = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId: target.id, flatten: true })
    const sessionId = attached.sessionId
    if (!sessionId) throw new Error(`Target.attachToTarget did not return sessionId for target=${target.id}`)

    await cdp.send("Network.enable", {
      maxTotalBufferSize: 100_000_000,
      maxResourceBufferSize: 20_000_000,
      maxPostDataSize: args.maxBodyBytes,
    }, sessionId)
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId)
    if (args.bypassServiceWorker) {
      await cdp.send("Network.setBypassServiceWorker", { bypass: true }, sessionId).catch((error) => {
        console.warn(`[jimeng-recorder] Network.setBypassServiceWorker failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }

    const detachEvents = cdp.onEvent((message) => {
      if (message.sessionId !== sessionId || !message.method) return
      recordEvent(raw, message)
      handleNetworkEvent({ cdp, sessionId, message, state, raw, maxBodyBytes: args.maxBodyBytes, includeAll: args.includeAll })
    })

    console.log(`[jimeng-recorder] attached target=${target.id} type=${target.type} title=${JSON.stringify(target.title)} url=${target.url}`)
    console.log(args.durationSec === 0 ? "[jimeng-recorder] recording until Ctrl-C" : `[jimeng-recorder] recording for ${args.durationSec}s`)
    await waitForStop(args.durationSec)
    detachEvents()

    await Promise.allSettled(state.bodyPromises)
    writeCaptureTemplate(captureTemplateFile, state)
    writeSummary(summaryFile, args, target, state)
    await closeStream(raw)
    console.log(`[jimeng-recorder] wrote ${captureTemplateFile}`)
    console.log(`[jimeng-recorder] wrote ${summaryFile}`)
  } finally {
    cdp.close()
  }
}

function parseArgs(argv: string[]): RecorderArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE)
    process.exit(0)
  }

  const flags: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token?.startsWith("--")) continue

    const eq = token.indexOf("=")
    if (eq > 2) {
      flags[token.slice(2, eq)] = token.slice(eq + 1)
      continue
    }

    const key = token.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith("--")) {
      flags[key] = next
      i += 1
    } else {
      flags[key] = "true"
    }
  }

  const flow = flags.flow ?? "manual"
  const durationSec = Number(flags.durationSec ?? DEFAULT_DURATION_SEC)
  const maxBodyBytes = Number(flags.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES)
  if (!Number.isFinite(durationSec) || durationSec < 0) throw new Error("--durationSec must be a non-negative number")
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 0) throw new Error("--maxBodyBytes must be a non-negative integer")

  return {
    cdpUrl: normalizeCdpUrl(flags.cdp ?? DEFAULT_CDP_URL),
    url: flags.url ?? DEFAULT_JIMENG_URL,
    targetUrl: flags["target-url"],
    createIfMissing: flags["no-create"] !== "true",
    flow,
    outDir: flags.outDir ? path.resolve(flags.outDir) : path.resolve("data", "jimeng-captures", `${timestampSlug()}-${slug(flow)}`),
    durationSec,
    maxBodyBytes,
    includeAll: flags["include-all"] === "true",
    bypassServiceWorker: flags["no-bypass-service-worker"] !== "true",
  }
}

async function resolveTarget(cdp: CdpConnection, args: RecorderArgs): Promise<CdpTargetInfo> {
  if (args.targetUrl) {
    const match = await findExistingTarget(args.cdpUrl, args.targetUrl)
    if (match) return match
    if (!args.createIfMissing) throw new Error(`No existing page target matched --target-url=${args.targetUrl}`)
  }

  const created = await cdp.send<{ targetId: string }>("Target.createTarget", { url: args.url, background: true })
  if (!created.targetId) throw new Error("Target.createTarget did not return targetId")

  // Give /json/list a short moment to see the new page metadata.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const targets = await listTargets(args.cdpUrl).catch(() => [] as CdpTargetInfo[])
    const target = targets.find((candidate) => candidate.id === created.targetId)
    if (target) return target
    await sleep(100)
  }

  return { id: created.targetId, type: "page", title: "", url: args.url }
}

async function findExistingTarget(cdpUrl: string, needle: string): Promise<CdpTargetInfo | null> {
  const lowerNeedle = needle.toLowerCase()
  const targets = await listTargets(cdpUrl)
  return targets.find((target) => {
    if (target.type !== "page") return false
    return `${target.title}\n${target.url}`.toLowerCase().includes(lowerNeedle)
  }) ?? null
}

async function listTargets(cdpUrl: string): Promise<CdpTargetInfo[]> {
  const targets = await fetchJson<CdpTargetInfo[]>(`${cdpUrl}/json/list`)
  return targets.filter((target) => target.type === "page")
}

function handleNetworkEvent(input: {
  cdp: CdpConnection
  sessionId: string
  message: CdpMessage
  state: RecorderState
  raw: WriteStream
  maxBodyBytes: number
  includeAll: boolean
}): void {
  const params = input.message.params ?? {}
  const requestId = typeof params.requestId === "string" ? params.requestId : null

  if (input.message.method === "Network.requestWillBeSent" && requestId) {
    const request = asRecord(params.request)
    const record = ensureRequest(input.state, requestId)
    record.url = stringValue(request?.url) ?? record.url
    record.method = stringValue(request?.method) ?? record.method
    record.type = stringValue(params.type) ?? record.type
    record.requestHeaders = headersValue(request?.headers) ?? record.requestHeaders
    record.postData = stringValue(request?.postData) ?? record.postData
    return
  }

  if (input.message.method === "Network.requestWillBeSentExtraInfo" && requestId) {
    const record = ensureRequest(input.state, requestId)
    record.requestHeaders = { ...record.requestHeaders, ...(headersValue(params.headers) ?? {}) }
    return
  }

  if (input.message.method === "Network.responseReceived" && requestId) {
    const response = asRecord(params.response)
    const record = ensureRequest(input.state, requestId)
    record.status = numberValue(response?.status) ?? record.status
    record.mimeType = stringValue(response?.mimeType) ?? record.mimeType
    record.responseHeaders = headersValue(response?.headers) ?? record.responseHeaders
    return
  }

  if (input.message.method === "Network.responseReceivedExtraInfo" && requestId) {
    const record = ensureRequest(input.state, requestId)
    record.status = numberValue(params.statusCode) ?? record.status
    record.responseHeaders = { ...record.responseHeaders, ...(headersValue(params.headers) ?? {}) }
    return
  }

  if (input.message.method === "Network.loadingFinished" && requestId) {
    const record = ensureRequest(input.state, requestId)
    record.finishedAtIso = new Date().toISOString()
    record.encodedDataLength = numberValue(params.encodedDataLength) ?? record.encodedDataLength
    input.state.bodyPromises.push(fetchBodies(input.cdp, input.sessionId, requestId, record, input.raw, input.maxBodyBytes, input.includeAll))
  }

  if ((input.message.method === "Network.webSocketFrameSent" || input.message.method === "Network.webSocketFrameReceived") && requestId) {
    // Frame payloads are already present in raw-network.jsonl via recordEvent.
    ensureRequest(input.state, requestId)
  }
}

async function fetchBodies(
  cdp: CdpConnection,
  sessionId: string,
  requestId: string,
  record: RequestRecord,
  raw: WriteStream,
  maxBodyBytes: number,
  includeAll: boolean,
): Promise<void> {
  if (record.method !== "GET" && !record.postData) {
    await cdp.send<{ postData?: string }>("Network.getRequestPostData", { requestId }, sessionId)
      .then((result) => {
        if (result.postData) record.postData = truncateString(result.postData, maxBodyBytes)
      })
      .catch(() => undefined)
  }

  if (!includeAll && !shouldCaptureResponseBody(record)) return

  await cdp.send<{ body: string; base64Encoded?: boolean }>("Network.getResponseBody", { requestId }, sessionId)
    .then(async (result) => {
      const bodyText = result.base64Encoded ? Buffer.from(result.body, "base64").toString("utf8") : result.body
      const truncated = truncateString(bodyText, maxBodyBytes)
      record.responseBodyBytes = Buffer.byteLength(bodyText)
      record.responseBodySha256 = await sha256Hex(bodyText)
      writeJsonl(raw, {
        atIso: new Date().toISOString(),
        kind: "responseBody",
        requestId,
        url: record.url,
        status: record.status,
        mimeType: record.mimeType,
        base64Encoded: result.base64Encoded === true,
        truncatedBytes: Buffer.byteLength(bodyText) > maxBodyBytes,
        body: truncated,
      })
    })
    .catch(() => undefined)
}

function shouldCaptureResponseBody(record: RequestRecord): boolean {
  const haystack = `${record.method} ${record.url} ${record.mimeType ?? ""} ${record.type ?? ""}`.toLowerCase()
  if (haystack.includes("/mweb/")) return true
  if (haystack.includes("/api/")) return true
  if (haystack.includes("graphql")) return true
  if (haystack.includes("json")) return true
  if (haystack.includes("event-stream")) return true
  if (haystack.includes("text/")) return true
  return false
}

function ensureRequest(state: RecorderState, requestId: string): RequestRecord {
  const existing = state.requests.get(requestId)
  if (existing) return existing

  const created: RequestRecord = {
    requestId,
    url: "",
    method: "",
    type: null,
    status: null,
    mimeType: null,
    requestHeaders: {},
    responseHeaders: {},
    postData: null,
    responseBodyBytes: null,
    startedAtIso: new Date().toISOString(),
  }
  state.requests.set(requestId, created)
  return created
}

function recordEvent(raw: WriteStream, message: CdpMessage): void {
  writeJsonl(raw, {
    atIso: new Date().toISOString(),
    kind: "cdpEvent",
    method: message.method,
    sessionId: message.sessionId,
    params: message.params,
  })
}

function writeCaptureTemplate(file: string, state: RecorderState): void {
  const entries = Array.from(state.requests.values())
    .filter((request) => request.url && request.method)
    .map((request) => ({
      kind: "request",
      url: request.url,
      headers: request.requestHeaders,
      postData: request.postData,
    }))

  writeFileSync(file, `${JSON.stringify({ entries }, null, 2)}\n`, "utf8")
}

function writeSummary(file: string, args: RecorderArgs, target: CdpTargetInfo, state: RecorderState): void {
  const requests = Array.from(state.requests.values()).filter((request) => request.url && request.method)
  const interesting = requests.filter((request) => isInterestingRequest(request))
  const lines: string[] = []

  lines.push("# Jimeng Network Capture Redacted Summary")
  lines.push("")
  lines.push(`- Captured at: ${new Date().toISOString()}`)
  lines.push(`- Flow: ${args.flow}`)
  lines.push(`- CDP: ${args.cdpUrl}`)
  lines.push(`- Target: ${target.type} ${target.id}`)
  lines.push(`- Target URL: ${redactUrl(target.url)}`)
  lines.push(`- Total requests: ${requests.length}`)
  lines.push(`- Interesting requests: ${interesting.length}`)
  lines.push("")
  lines.push("Raw trace and capture template are intentionally local-only artifacts. Do not commit raw cookies, signed URLs, or request signatures.")
  lines.push("")
  lines.push("## Interesting requests")
  lines.push("")

  for (const request of interesting) {
    lines.push(`### ${request.method || "?"} ${redactUrl(request.url)}`)
    lines.push("")
    lines.push(`- status: ${request.status ?? "unknown"}`)
    lines.push(`- type: ${request.type ?? "unknown"}`)
    lines.push(`- mime: ${request.mimeType ?? "unknown"}`)
    if (request.encodedDataLength !== undefined) lines.push(`- encoded bytes: ${request.encodedDataLength}`)
    if (request.responseBodyBytes !== null) lines.push(`- response body bytes: ${request.responseBodyBytes}`)
    if (request.responseBodySha256) lines.push(`- response body sha256: ${request.responseBodySha256}`)
    lines.push("- request headers:")
    lines.push("  ```json")
    lines.push(indent(JSON.stringify(redactHeaders(request.requestHeaders), null, 2), "  "))
    lines.push("  ```")
    if (request.postData) {
      lines.push("- post data preview:")
      lines.push("  ```json")
      lines.push(indent(redactBodyPreview(request.postData), "  "))
      lines.push("  ```")
    }
    lines.push("")
  }

  writeFileSync(file, `${lines.join("\n")}\n`, "utf8")
}

function isInterestingRequest(request: RequestRecord): boolean {
  const haystack = `${request.method} ${request.url} ${request.mimeType ?? ""}`.toLowerCase()
  return request.method !== "GET" || haystack.includes("/mweb/") || haystack.includes("/api/") || haystack.includes("json") || haystack.includes("event-stream")
}

function redactBodyPreview(body: string): string {
  const truncated = truncateString(body, 20_000)
  try {
    return JSON.stringify(redactJson(JSON.parse(truncated)), null, 2)
  } catch {
    return truncated.replace(/(cookie|token|auth|sign|a_bogus|msToken)(["'=:\s]+)[^\s"'&,}]+/gi, "$1$2[REDACTED]")
  }
}

function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson)
  if (!value || typeof value !== "object") return value

  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (/cookie|token|auth|sign|bogus|msToken|session|secret|password/i.test(key)) {
      out[key] = "[REDACTED]"
    } else if (typeof child === "string" && child.length > 500) {
      out[key] = `${child.slice(0, 500)}…[TRUNCATED ${child.length} chars]`
    } else {
      out[key] = redactJson(child)
    }
  }
  return out
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    for (const key of Array.from(parsed.searchParams.keys())) {
      parsed.searchParams.set(key, "[REDACTED]")
    }
    return parsed.toString()
  } catch {
    return url
  }
}

function headersValue(value: unknown): Record<string, string> | null {
  const record = asRecord(value)
  if (!record) return null
  const headers: Record<string, string> = {}
  for (const [key, child] of Object.entries(record)) {
    if (typeof child === "string") headers[key.toLowerCase()] = child
    else if (typeof child === "number" || typeof child === "boolean") headers[key.toLowerCase()] = String(child)
  }
  return headers
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" ? value : null
}

function truncateString(value: string, maxBytes: number): string {
  if (maxBytes === 0) return ""
  const bytes = Buffer.byteLength(value)
  if (bytes <= maxBytes) return value
  return `${Buffer.from(value).subarray(0, maxBytes).toString("utf8")}\n[TRUNCATED ${bytes - maxBytes} bytes]`
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function writeJsonl(raw: WriteStream, value: unknown): void {
  raw.write(`${JSON.stringify(value)}\n`)
}

async function waitForStop(durationSec: number): Promise<void> {
  let resolveStop: (() => void) | null = null
  const stop = new Promise<void>((resolve) => {
    resolveStop = resolve
  })

  const onSignal = () => {
    console.log("\n[jimeng-recorder] stopping")
    resolveStop?.()
  }

  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)

  if (durationSec > 0) {
    await Promise.race([sleep(durationSec * 1000), stop])
  } else {
    await stop
  }

  process.off("SIGINT", onSignal)
  process.off("SIGTERM", onSignal)
}

async function closeStream(stream: WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.once("error", reject)
    stream.end(() => resolve())
  })
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
  return await response.json() as T
}

function normalizeCdpUrl(value: string): string {
  return value.replace(/\/$/, "")
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "manual"
}

function indent(value: string, prefix: string): string {
  return value.split("\n").map((line) => `${prefix}${line}`).join("\n")
}

function messageDataToString(data: unknown): string {
  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8")
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8")
  return String(data)
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
