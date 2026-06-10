import { createHash } from "node:crypto"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient } from "./client"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"

const DEFAULT_QUERY = "aid=513695&device_platform=web&region=cn&da_version=3.1.3"

export interface JimengHistoryQueueInfoQuery {
  historyIds: string[]
}

export interface JimengQueueInfoSummary {
  queueIdx: number | null
  priority: number | null
  queueStatus: number | null
  queueLength: number | null
  pollingIntervalSeconds: number | null
  pollingTimeoutSeconds: number | null
  vipQueuingTimeThreshold: number | null
  waitingTimeThreshold: number | null
  debugInfoPresent: boolean
  debugInfoSha256: string | null
}

export interface JimengForecastCostTimeSummary {
  forecastGenerateCost: number | null
  forecastQueueCost: number | null
}

export interface JimengHistoryQueueInfoEntry {
  historyId: string
  status: number | null
  failCode: string | number | null
  failMsg: string | null
  queueInfo: JimengQueueInfoSummary | null
  forecastCostTime: JimengForecastCostTimeSummary | null
}

export interface JimengHistoryQueueInfoResult {
  endpoint: "/mweb/v1/get_history_queue_info"
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  entries: JimengHistoryQueueInfoEntry[]
  body: JsonValue
}

export function buildJimengHistoryQueueInfoRequest(query: JimengHistoryQueueInfoQuery): JsonObject {
  return {
    history_ids: normalizeHistoryIds(query.historyIds),
  }
}

export async function fetchJimengHistoryQueueInfo(input: {
  client?: JimengClient
  session: JimengSessionBundle
  historyIds: string[]
}): Promise<JimengHistoryQueueInfoResult> {
  const request = buildJimengHistoryQueueInfoRequest({ historyIds: input.historyIds })
  const client = input.client ?? new JimengClient()
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/get_history_queue_info?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildHistoryQueueHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "history queue info")

  return {
    endpoint: "/mweb/v1/get_history_queue_info",
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    entries: parseJimengHistoryQueueInfoBody(body),
    body,
  }
}

export function parseJimengHistoryQueueInfoBody(body: JsonValue): JimengHistoryQueueInfoEntry[] {
  const data = asRecord(asRecord(body)?.data)
  if (!data) return []
  return Object.entries(data)
    .map(([historyId, value]) => parseHistoryQueueEntry(historyId, value))
    .filter((entry): entry is JimengHistoryQueueInfoEntry => !!entry)
}

export function summarizeJimengHistoryQueueInfo(result: JimengHistoryQueueInfoResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    entry_count: result.entries.length,
    by_status: countBy(result.entries.map((entry) => entry.status).filter((value): value is number => typeof value === "number").map(String)),
    by_queue_status: countBy(result.entries.map((entry) => entry.queueInfo?.queueStatus).filter((value): value is number => typeof value === "number").map(String)),
    entries: result.entries.map((entry) => ({
      history_id: entry.historyId,
      status: entry.status,
      fail_code: entry.failCode,
      fail_msg: entry.failMsg,
      queue_info: entry.queueInfo ? {
        queue_idx: entry.queueInfo.queueIdx,
        priority: entry.queueInfo.priority,
        queue_status: entry.queueInfo.queueStatus,
        queue_length: entry.queueInfo.queueLength,
        polling_interval_seconds: entry.queueInfo.pollingIntervalSeconds,
        polling_timeout_seconds: entry.queueInfo.pollingTimeoutSeconds,
        vip_queuing_time_threshold: entry.queueInfo.vipQueuingTimeThreshold,
        waiting_time_threshold: entry.queueInfo.waitingTimeThreshold,
        debug_info_present: entry.queueInfo.debugInfoPresent,
        debug_info_sha256: entry.queueInfo.debugInfoSha256,
      } : null,
      forecast_cost_time: entry.forecastCostTime ? {
        forecast_generate_cost: entry.forecastCostTime.forecastGenerateCost,
        forecast_queue_cost: entry.forecastCostTime.forecastQueueCost,
      } : null,
    })),
  }
}

export function parseJimengHistoryIdsFlag(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  return normalizeHistoryIds(value.split(",").map((item) => item.trim()).filter(Boolean))
}

function parseHistoryQueueEntry(historyId: string, value: JsonValue): JimengHistoryQueueInfoEntry | null {
  const record = asRecord(value)
  if (!record) return null
  return {
    historyId,
    status: numberValue(record.status),
    failCode: stringOrNumberValue(record.fail_code) ?? stringOrNumberValue(record.failCode),
    failMsg: stringValue(record.fail_msg) ?? stringValue(record.failMsg),
    queueInfo: parseQueueInfo(asRecord(record.queue_info) ?? asRecord(record.queueInfo)),
    forecastCostTime: parseForecastCostTime(asRecord(record.forecast_cost_time) ?? asRecord(record.forecastCostTime)),
  }
}

function parseQueueInfo(queueInfo: JsonObject | null): JimengQueueInfoSummary | null {
  if (!queueInfo) return null
  const pollingConfig = asRecord(queueInfo.polling_config) ?? asRecord(queueInfo.pollingConfig)
  const threshold = asRecord(queueInfo.priority_queue_display_threshold) ?? asRecord(queueInfo.priorityQueueDisplayThreshold)
  const debugInfo = stringValue(queueInfo.debug_info) ?? stringValue(queueInfo.debugInfo)
  return {
    queueIdx: numberValue(queueInfo.queue_idx) ?? numberValue(queueInfo.queueIdx),
    priority: numberValue(queueInfo.priority),
    queueStatus: numberValue(queueInfo.queue_status) ?? numberValue(queueInfo.queueStatus),
    queueLength: numberValue(queueInfo.queue_length) ?? numberValue(queueInfo.queueLength),
    pollingIntervalSeconds: numberValue(pollingConfig?.interval_seconds) ?? numberValue(pollingConfig?.intervalSeconds),
    pollingTimeoutSeconds: numberValue(pollingConfig?.timeout_seconds) ?? numberValue(pollingConfig?.timeoutSeconds),
    vipQueuingTimeThreshold: numberValue(threshold?.vip_queuing_time_threshold) ?? numberValue(threshold?.vipQueuingTimeThreshold),
    waitingTimeThreshold: numberValue(threshold?.waiting_time_threshold) ?? numberValue(threshold?.waitingTimeThreshold),
    debugInfoPresent: !!debugInfo,
    debugInfoSha256: debugInfo ? sha256(debugInfo) : null,
  }
}

function parseForecastCostTime(forecastCostTime: JsonObject | null): JimengForecastCostTimeSummary | null {
  if (!forecastCostTime) return null
  return {
    forecastGenerateCost: numberValue(forecastCostTime.forecast_generate_cost) ?? numberValue(forecastCostTime.forecastGenerateCost),
    forecastQueueCost: numberValue(forecastCostTime.forecast_queue_cost) ?? numberValue(forecastCostTime.forecastQueueCost),
  }
}

function normalizeHistoryIds(values: string[]): string[] {
  const normalized = values.map((value) => value.trim()).filter(Boolean)
  if (normalized.length === 0) {
    throw jimengError({
      category: "validation",
      code: "HISTORY_QUEUE_IDS_REQUIRED",
      message: "At least one history id is required.",
      retryable: false,
    })
  }
  const seen = new Set<string>()
  for (const value of normalized) {
    if (!/^[0-9A-Za-z_-]+$/.test(value)) {
      throw jimengError({
        category: "validation",
        code: "HISTORY_QUEUE_ID_INVALID",
        message: "History ids must be non-empty id strings.",
        retryable: false,
        details: { historyId: value },
      })
    }
    seen.add(value)
  }
  return [...seen]
}

function buildHistoryQueueHeaders(session: JimengSessionBundle): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/plain, */*",
    "user-agent": session.userAgent ?? "Mozilla/5.0",
    origin: session.origin ?? "https://jimeng.jianying.com",
    referer: session.referer ?? "https://jimeng.jianying.com/ai-tool/generate/",
    cookie: session.cookie,
    lan: "zh-Hans",
    pf: "7",
    loc: "cn",
    appid: "513695",
    appvr: "8.4.0",
    "app-sdk-version": "48.0.0",
    "x-platform": "pc",
  }
}

function assertJimengSuccess(body: JsonValue, operation: string): void {
  const ret = retValue(body)
  if (ret === "0" || ret === 0) return
  throw jimengError({
    category: "upstream",
    code: "JIMENG_API_REJECTED",
    message: `${operation} failed (ret=${String(ret ?? "unknown")}, errmsg=${errmsgValue(body) ?? "unknown"})`,
    retryable: false,
    details: { ret, errmsg: errmsgValue(body) },
  })
}

function countBy(values: string[]): JsonObject {
  const counts: JsonObject = {}
  for (const value of values) counts[value] = Number(counts[value] ?? 0) + 1
  return counts
}

function retValue(body: JsonValue): string | number | null {
  const value = asRecord(body)?.ret
  return typeof value === "string" || typeof value === "number" ? value : null
}

function errmsgValue(body: JsonValue): string | null {
  return stringValue(asRecord(body)?.errmsg)
}

function safeJson(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue
  } catch {
    return value
  }
}

function asRecord(value: JsonValue | undefined): JsonObject | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function stringOrNumberValue(value: JsonValue | undefined): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null
}

function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
