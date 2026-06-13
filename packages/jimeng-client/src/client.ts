import { createHash } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"
import { Effect } from "effect"
import { type JimengOp, type PreparedJimengRun } from "./capture"
import { JimengError, jimengError } from "./errors"
import { extractImageSubmitInfoFromSseText, extractSubmitIdFromSseText } from "./sse"

export interface JimengFetchResponse {
  ok: boolean
  status: number
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

export type JimengFetch = (url: string, init?: RequestInit) => Promise<JimengFetchResponse>

export interface JimengSubmitResult {
  submitId: string
  historyId: string | null
  httpStatus: number
  responseBody: unknown
  responseTextSha256: string
}
export interface ParseJimengWorkbenchSubmitResponseInput {
  text: string
  fallbackSubmitId: string
}

export interface ParsedJimengWorkbenchSubmitResponse {
  submitId: string
  historyId: string | null
  responseBody: unknown
  responseTextSha256: string
}

export interface JimengPollTraceEntry {
  atIso: string
  status: number | null
  itemCount: number
  httpStatus: number
}

export interface JimengHistoryVideo {
  transcoded_video?: { origin?: { video_url?: string | null } | null } | null
  play_url?: string | null
  download_url?: string | null
  url?: string | null
}

export interface JimengHistoryItem {
  video?: JimengHistoryVideo | null
  common_attr?: {
    cover_url?: string | null
    cover_url_map?: Record<string, string> | null
  } | null
  image?: {
    large_images?: Array<{ image_url?: string | null; width?: number | null; height?: number | null }> | null
  } | null
  [key: string]: unknown
}

export interface JimengHistoryRecord {
  status?: number | null
  item_list?: JimengHistoryItem[] | null
  total_image_count?: number | null
  finished_image_count?: number | null
  task?: {
    status?: number | null
    [key: string]: unknown
  } | null
  [key: string]: unknown
}

export interface JimengPollResult {
  record: JimengHistoryRecord
  trace: JimengPollTraceEntry[]
}

export interface JimengArtifact {
  kind: "video" | "image"
  url: string
  bytes: Uint8Array
}

export interface JimengRunResult {
  submit: JimengSubmitResult
  poll: JimengPollResult
  artifacts: JimengArtifact[]
}

export interface JimengClientOptions {
  fetch?: JimengFetch
  riskControlBreaker?: JimengRiskControlBreakerOptions
}

export interface JimengPollUntilTerminalInput {
  pollUrl: string
  pollHeaders: Record<string, string>
  submitId: string
  terminalStatus: number
  pollKind?: PreparedJimengRun["pollKind"]
  pollBody?: Record<string, unknown>
  pollIntervalMs: number
  maxPolls: number
}

export interface JimengRunPreparedInput {
  prepared: PreparedJimengRun
  pollIntervalMs?: number
  maxPolls?: number
  downloadArtifacts?: boolean
}

export interface JimengRiskControlBreakerOptions {
  maxConsecutiveHits?: number
  cooldownMs?: number
  nowMs?: () => number
}

export interface JimengRiskControlBreakerState {
  consecutiveHits: number
  cooldownUntilMs: number
  cooldownRemainingMs: number
}

export class JimengClient {
  #fetch: JimengFetch
  #riskControlHits = 0
  #riskControlCooldownUntilMs = 0
  #riskControlMaxHits: number
  #riskControlCooldownMs: number
  #nowMs: () => number

  constructor(options: JimengClientOptions = {}) {
    this.#fetch = options.fetch ?? (fetch as unknown as JimengFetch)
    this.#riskControlMaxHits = positiveInteger(options.riskControlBreaker?.maxConsecutiveHits ?? 1, "riskControlBreaker.maxConsecutiveHits")
    this.#riskControlCooldownMs = nonNegativeInteger(options.riskControlBreaker?.cooldownMs ?? 10 * 60_000, "riskControlBreaker.cooldownMs")
    this.#nowMs = options.riskControlBreaker?.nowMs ?? Date.now
  }

  async submitPrepared(prepared: PreparedJimengRun): Promise<JimengSubmitResult> {
    return prepared.submitKind === "conversation_sse" ? this.submitImageConversation(prepared) : this.submitWorkbench(prepared)
  }

  async submitWorkbench(input: Pick<PreparedJimengRun, "submitUrl" | "submitHeaders" | "submitBody" | "submitId">): Promise<JimengSubmitResult> {
    const response = await this.requestText(input.submitUrl, {
      method: "POST",
      headers: input.submitHeaders,
      body: JSON.stringify(input.submitBody),
    })
    const parsed = parseJimengWorkbenchSubmitResponse({
      text: response.text,
      fallbackSubmitId: input.submitId,
    })
    return {
      ...parsed,
      httpStatus: response.status,
    }
  }

  async submitVideo(input: Pick<PreparedJimengRun, "submitUrl" | "submitHeaders" | "submitBody" | "submitId">): Promise<JimengSubmitResult> {
    return this.submitWorkbench(input)
  }

  async submitImage(input: Pick<PreparedJimengRun, "submitUrl" | "submitHeaders" | "submitBody">): Promise<JimengSubmitResult> {
    return this.submitImageConversation(input)
  }

  async submitImageConversation(input: Pick<PreparedJimengRun, "submitUrl" | "submitHeaders" | "submitBody">): Promise<JimengSubmitResult> {
    const response = await this.requestText(input.submitUrl, {
      method: "POST",
      headers: input.submitHeaders,
      body: JSON.stringify(input.submitBody),
    })

    const responseBody = safeJson(response.text)
    assertNoRiskError(responseBody, response.text)

    const submitInfo = extractImageSubmitInfoFromSseText(response.text)
    if (submitInfo && submitInfo.code !== 0) {
      throw jimengError({
        category: submitInfo.code === 1017 ? "auth" : "upstream",
        code: "IMAGE_SUBMIT_REJECTED",
        message: `Image submit rejected (code=${submitInfo.code}, msg=${submitInfo.msg ?? "unknown"})`,
        retryable: false,
        details: {
          submit_info_code: submitInfo.code,
          submit_info_msg: submitInfo.msg,
        },
      })
    }

    const submitId = extractSubmitIdFromSseText(response.text)
    if (!submitId) {
      throw jimengError({
        category: "validation",
        code: "IMAGE_SUBMIT_ID_MISSING",
        message: "Image SSE submit response missing submit_id",
        retryable: false,
      })
    }

    return {
      submitId,
      historyId: null,
      httpStatus: response.status,
      responseBody,
      responseTextSha256: sha256(response.text),
    }
  }

  async pollUntilTerminal(input: JimengPollUntilTerminalInput): Promise<JimengPollResult> {
    const trace: JimengPollTraceEntry[] = []

    for (let attempt = 0; attempt < input.maxPolls; attempt += 1) {
      const response = await this.requestText(input.pollUrl, {
        method: "POST",
        headers: input.pollHeaders,
        body: JSON.stringify(buildPollBody(input)),
      })

      const responseBody = safeJson(response.text)
      assertNoRiskError(responseBody, response.text)

      const record = extractPollRecord(responseBody, input)
      const status = typeof record?.status === "number" ? record.status : null
      const itemCount = record?.item_list?.length ?? 0

      trace.push({
        atIso: new Date().toISOString(),
        status,
        itemCount,
        httpStatus: response.status,
      })

      if (status === input.terminalStatus && itemCount > 0 && record) {
        return { record, trace }
      }

      if (attempt < input.maxPolls - 1 && input.pollIntervalMs > 0) {
        await sleep(input.pollIntervalMs)
      }
    }

    throw jimengError({
      category: "timeout",
      code: "POLL_BUDGET_EXCEEDED",
      message: "Operation did not complete within poll budget",
      retryable: true,
      details: {
        submitId: input.submitId,
        maxPolls: input.maxPolls,
        pollIntervalMs: input.pollIntervalMs,
        maxDurationMs: input.maxPolls * input.pollIntervalMs,
      },
    })
  }

  async runPrepared(input: JimengRunPreparedInput): Promise<JimengRunResult> {
    const submit = await this.submitPrepared(input.prepared)
    const poll = await this.pollUntilTerminal({
      pollUrl: input.prepared.pollUrl,
      pollHeaders: input.prepared.pollHeaders,
      submitId: submit.submitId,
      terminalStatus: input.prepared.terminalStatus,
      pollKind: input.prepared.pollKind,
      pollBody: input.prepared.pollBody,
      pollIntervalMs: input.pollIntervalMs ?? 3000,
      maxPolls: input.maxPolls ?? 30,
    })
    const artifacts = input.downloadArtifacts === false ? [] : await this.downloadArtifacts(input.prepared.op, poll.record)
    return { submit, poll, artifacts }
  }

  async downloadArtifacts(op: JimengOp, record: JimengHistoryRecord): Promise<JimengArtifact[]> {
    if (op === "video") {
      const url = pickVideoUrl(record)
      if (!url) {
        throw jimengError({
          category: "upstream",
          code: "VIDEO_URL_MISSING",
          message: "Completed video record missing URL",
          retryable: false,
        })
      }
      return [{ kind: "video", url, bytes: await this.download(url) }]
    }

    const urls = collectImageUrls(record)
    if (urls.length === 0) {
      throw jimengError({
        category: "upstream",
        code: "IMAGE_URL_MISSING",
        message: "Completed image record missing URLs",
        retryable: false,
      })
    }

    return Promise.all(urls.map(async (url) => ({ kind: "image" as const, url, bytes: await this.download(url) })))
  }

  async requestText(url: string, init: RequestInit): Promise<{ status: number; text: string }> {
    try {
      this.#assertRiskControlCooldown(url)
      const response = await this.#fetch(url, init)
      const text = await response.text()
      this.#observeRiskControlText(url, text)
      return { status: response.status, text }
    } catch (error) {
      if (error instanceof JimengError) throw error
      throw jimengError({
        category: "transport",
        code: "HTTP_REQUEST_FAILED",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
        details: { url },
      })
    }
  }

  getRiskControlBreakerState(): JimengRiskControlBreakerState {
    const nowMs = this.#nowMs()
    const remaining = Math.max(0, this.#riskControlCooldownUntilMs - nowMs)
    return {
      consecutiveHits: this.#riskControlHits,
      cooldownUntilMs: remaining > 0 ? this.#riskControlCooldownUntilMs : 0,
      cooldownRemainingMs: remaining,
    }
  }

  async download(url: string): Promise<Uint8Array> {
    try {
      const response = await this.#fetch(url)
      if (!response.ok) throw new Error(`Download failed: ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    } catch (error) {
      throw jimengError({
        category: "transport",
        code: "HTTP_DOWNLOAD_FAILED",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
        details: { url },
      })
    }
  }

  #assertRiskControlCooldown(url: string): void {
    const nowMs = this.#nowMs()
    if (this.#riskControlCooldownUntilMs <= nowMs) {
      this.#riskControlCooldownUntilMs = 0
      return
    }

    throw jimengError({
      category: "risk_control",
      code: "RISK_CONTROL_COOLDOWN_ACTIVE",
      message: "Jimeng risk-control cooldown is active; refusing to send another request.",
      retryable: false,
      details: {
        url,
        consecutiveRiskControlHits: this.#riskControlHits,
        cooldownUntilMs: this.#riskControlCooldownUntilMs,
        cooldownRemainingMs: this.#riskControlCooldownUntilMs - nowMs,
      },
    })
  }

  #observeRiskControlText(url: string, text: string): void {
    const signal = detectRiskControlSignal(safeJson(text), text)
    if (!signal) {
      this.#riskControlHits = 0
      return
    }

    this.#riskControlHits += 1
    const nowMs = this.#nowMs()
    let cooldownUntilMs = 0
    if (this.#riskControlCooldownMs > 0 && this.#riskControlHits >= this.#riskControlMaxHits) {
      cooldownUntilMs = nowMs + this.#riskControlCooldownMs
      this.#riskControlCooldownUntilMs = cooldownUntilMs
    }

    throw jimengError({
      category: "risk_control",
      code: "SHARK_NOT_PASS",
      message: "risk_control: shark not pass",
      retryable: false,
      details: {
        url,
        ret: signal.ret ?? null,
        errmsg: signal.errmsg ?? null,
        consecutiveRiskControlHits: this.#riskControlHits,
        cooldownUntilMs: cooldownUntilMs || null,
      },
    })
  }
}
export function parseJimengWorkbenchSubmitResponse(input: ParseJimengWorkbenchSubmitResponseInput): ParsedJimengWorkbenchSubmitResponse {
  const responseBody = safeJson(input.text)
  assertNoRiskError(responseBody, input.text)
  const record = asRecord(responseBody)
  const data = asRecord(record?.data)
  const aigc = asRecord(data?.aigc_data)
  const task = asRecord(aigc?.task)
  const submitId = asString(aigc?.submit_id) ?? asString(task?.submit_id)
  const historyId = asString(aigc?.history_record_id)
  const ret = record?.ret
  const errmsg = record?.errmsg

  if (!submitId && !historyId) {
    throw jimengError({
      category: "upstream",
      code: "WORKBENCH_SUBMIT_MISSING_IDS",
      message: `Workbench submit did not return submit/history id (ret=${String(ret ?? "unknown")}, errmsg=${String(errmsg ?? "unknown")})`,
      retryable: false,
      details: { ret: ret ?? null, errmsg: errmsg ?? null },
    })
  }

  return {
    submitId: submitId ?? input.fallbackSubmitId,
    historyId: historyId ?? null,
    responseBody,
    responseTextSha256: sha256(input.text),
  }
}

export const submitPreparedEffect = Effect.fn("submitPreparedEffect")(function* (
  client: JimengClient,
  prepared: PreparedJimengRun,
) {
  return yield* Effect.tryPromise({
    try: () => client.submitPrepared(prepared),
    catch: effectError,
  })
})

export const pollUntilTerminalEffect = Effect.fn("pollUntilTerminalEffect")(function* (
  client: JimengClient,
  input: JimengPollUntilTerminalInput,
) {
  return yield* Effect.tryPromise({
    try: () => client.pollUntilTerminal(input),
    catch: effectError,
  })
})

export const downloadArtifactsEffect = Effect.fn("downloadArtifactsEffect")(function* (
  client: JimengClient,
  op: JimengOp,
  record: JimengHistoryRecord,
) {
  return yield* Effect.tryPromise({
    try: () => client.downloadArtifacts(op, record),
    catch: effectError,
  })
})

export const runPreparedEffect = Effect.fn("runPreparedEffect")(function* (
  client: JimengClient,
  input: JimengRunPreparedInput,
) {
  return yield* Effect.tryPromise({
    try: () => client.runPrepared(input),
    catch: effectError,
  })
})

export function pickVideoUrl(record: JimengHistoryRecord): string | null {
  const firstItem = record.item_list?.[0]
  if (!firstItem?.video) return null

  return (
    firstItem.video.transcoded_video?.origin?.video_url ??
    firstItem.video.play_url ??
    firstItem.video.download_url ??
    firstItem.video.url ??
    null
  )
}

export function collectImageUrls(record: JimengHistoryRecord): string[] {
  const urls: string[] = []
  const items = record.item_list ?? []

  for (const item of items) {
    const bestLargeImage = pickBestLargeImageUrl(item.image?.large_images ?? null)
    if (bestLargeImage) {
      urls.push(bestLargeImage)
      continue
    }
    const bestCover = pickBestCoverUrl(item.common_attr?.cover_url ?? null, item.common_attr?.cover_url_map ?? null)
    if (bestCover) urls.push(bestCover)
  }

  return [...new Set(urls)]
}

function pickBestLargeImageUrl(images: Array<{ image_url?: string | null; width?: number | null; height?: number | null }> | null): string | null {
  if (!images || images.length === 0) return null
  const candidates = images.filter((image): image is { image_url: string; width?: number | null; height?: number | null } => typeof image.image_url === "string" && image.image_url.length > 0)
  if (candidates.length === 0) return null
  const best = candidates.reduce((current, candidate) => imageArea(candidate) >= imageArea(current) ? candidate : current)
  return best.image_url
}

function pickBestCoverUrl(coverUrl: string | null | undefined, coverUrlMap: Record<string, string> | null | undefined): string | null {
  const entries = Object.entries(coverUrlMap ?? {}).filter(([, value]) => typeof value === "string" && value.length > 0)
  if (entries.length > 0) {
    const best = entries.reduce((current, candidate) => numericKey(candidate[0]) >= numericKey(current[0]) ? candidate : current)
    return best[1]
  }
  return coverUrl ?? null
}

function imageArea(value: { width?: number | null; height?: number | null }): number {
  const width = typeof value.width === "number" ? value.width : 0
  const height = typeof value.height === "number" ? value.height : 0
  return width * height
}

function numericKey(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function assertNoRiskError(body: unknown, rawText: string): void {
  const signal = detectRiskControlSignal(body, rawText)
  if (signal) {
    throw jimengError({
      category: "risk_control",
      code: "SHARK_NOT_PASS",
      message: "risk_control: shark not pass",
      retryable: false,
    })
  }
}

export function detectRiskControlSignal(body: unknown, rawText: string): { ret: unknown; errmsg: string | null } | null {
  const parsed = asRecord(body)
  const ret = parsed?.ret
  const errmsg = typeof parsed?.errmsg === "string" ? parsed.errmsg : null
  const combined = `${errmsg ?? ""} ${rawText}`.toLowerCase()

  if (ret === 1019 || ret === "1019" || combined.includes("shark not pass")) {
    return { ret, errmsg }
  }
  return null
}

function positiveInteger(value: number, name: string): number {
  if (Number.isInteger(value) && value > 0) return value
  throw new Error(`${name} must be a positive integer`)
}

function nonNegativeInteger(value: number, name: string): number {
  if (Number.isInteger(value) && value >= 0) return value
  throw new Error(`${name} must be a non-negative integer`)
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function effectError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function asHistoryRecord(value: unknown): JimengHistoryRecord | null {
  return asRecord(value) as JimengHistoryRecord | null
}

function buildPollBody(input: {
  submitId: string
  pollKind?: PreparedJimengRun["pollKind"]
  pollBody?: Record<string, unknown>
}): Record<string, unknown> {
  if (input.pollKind === "asset_list_first_image" && input.pollBody) return input.pollBody
  return { submit_ids: [input.submitId], need_batch: true, history_ids: [] }
}

function extractPollRecord(
  responseBody: unknown,
  input: { submitId: string; pollKind?: PreparedJimengRun["pollKind"] },
): JimengHistoryRecord | null {
  const response = asRecord(responseBody)
  const data = asRecord(response?.data)
  if (input.pollKind === "asset_list_first_image") {
    const assets = Array.isArray(data?.asset_list) ? data.asset_list : []
    const matchingAsset = assets
      .map(asRecord)
      .find((asset) => asRecord(asset?.image)?.submit_id === input.submitId || String(asset?.id ?? "") === input.submitId)
    const firstAsset = matchingAsset ?? asRecord(assets[0])
    return asHistoryRecord(firstAsset?.image)
  }

  return asHistoryRecord(data?.[input.submitId])
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
