import { createHash } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"
import { type JimengOp, type PreparedJimengRun } from "./capture"
import { jimengError } from "./errors"
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
    large_images?: Array<{ image_url?: string | null }> | null
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
}

export class JimengClient {
  #fetch: JimengFetch

  constructor(options: JimengClientOptions = {}) {
    this.#fetch = options.fetch ?? (fetch as unknown as JimengFetch)
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

    const responseBody = safeJson(response.text)
    assertNoRiskError(responseBody, response.text)

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
      submitId: submitId ?? input.submitId,
      historyId: historyId ?? null,
      httpStatus: response.status,
      responseBody,
      responseTextSha256: sha256(response.text),
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

  async pollUntilTerminal(input: {
    pollUrl: string
    pollHeaders: Record<string, string>
    submitId: string
    terminalStatus: number
    pollKind?: PreparedJimengRun["pollKind"]
    pollBody?: Record<string, unknown>
    pollIntervalMs: number
    maxPolls: number
  }): Promise<JimengPollResult> {
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

  async runPrepared(input: {
    prepared: PreparedJimengRun
    pollIntervalMs?: number
    maxPolls?: number
    downloadArtifacts?: boolean
  }): Promise<JimengRunResult> {
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
      const response = await this.#fetch(url, init)
      return { status: response.status, text: await response.text() }
    } catch (error) {
      throw jimengError({
        category: "transport",
        code: "HTTP_REQUEST_FAILED",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
        details: { url },
      })
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
}

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
    if (item.common_attr?.cover_url) urls.push(item.common_attr.cover_url)
    if (item.common_attr?.cover_url_map) urls.push(...Object.values(item.common_attr.cover_url_map))
    if (item.image?.large_images) {
      for (const image of item.image.large_images) {
        if (image.image_url) urls.push(image.image_url)
      }
    }
  }

  return [...new Set(urls)]
}

export function assertNoRiskError(body: unknown, rawText: string): void {
  const parsed = asRecord(body)
  const ret = parsed?.ret
  const errmsg = typeof parsed?.errmsg === "string" ? parsed.errmsg : ""
  const combined = `${errmsg} ${rawText}`.toLowerCase()

  if (ret === 1019 || ret === "1019" || combined.includes("shark not pass")) {
    throw jimengError({
      category: "risk_control",
      code: "SHARK_NOT_PASS",
      message: "risk_control: shark not pass",
      retryable: false,
    })
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
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
