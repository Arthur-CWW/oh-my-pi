import { createHash } from "node:crypto"
import { Schema } from "effect"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient, type JimengFetch } from "./client"
import { jimengError } from "./errors"
import { parseJimengHistoryRecordEntry, type JimengHistoryRecordEntry, type JimengHistoryMediaItem } from "./history-records"
import { type JsonObject, type JsonValue } from "./reference-image"
import { parseJimengApiEnvelope, parseJsonText } from "./schema"

const DEFAULT_QUERY = "aid=513695&device_platform=web&region=CN&web_version=7.5.0&da_version=3.3.17"

const OptionalBoolean = Schema.optional(Schema.NullOr(Schema.Boolean))
const OptionalNumber = Schema.optional(Schema.NullOr(Schema.Number))
const JsonRecordWireSchema = Schema.Record(Schema.String, Schema.Unknown)

const HistoryListDataWireSchema = Schema.Struct({
  has_more: OptionalBoolean,
  hasMore: OptionalBoolean,
  next_offset: OptionalNumber,
  nextOffset: OptionalNumber,
  records_list: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
  recordsList: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
  agent_conversation_session_map: Schema.optional(Schema.NullOr(JsonRecordWireSchema)),
  agentConversationSessionMap: Schema.optional(Schema.NullOr(JsonRecordWireSchema)),
})

const HistoryListBodyWireSchema = Schema.Struct({
  data: HistoryListDataWireSchema,
})

export interface JimengHistoryListQuery {
  offset?: number
  limit?: number
  direction?: number
  workspaceId?: number
  filterTypeList?: number[]
  orderBy?: number
  hideStoryAgentResult?: boolean
  imageResolutionStrategy?: {
    enableCommon?: boolean
    enableSmartCrop?: boolean
  }
}

export interface JimengHistoryListResult {
  endpoint: "/mweb/v1/get_history"
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  records: JimengHistoryRecordEntry[]
  hasMore: boolean | null
  nextOffset: number | null
  agentConversationSessionCount: number
  body: JsonValue
}

export function buildJimengHistoryListRequest(query: JimengHistoryListQuery = {}): JsonObject {
  const offset = normalizeNonNegativeInteger(query.offset ?? 0, "offset")
  const count = normalizePositiveInteger(query.limit ?? 20, "limit")
  if (count > 100) {
    throw jimengError({
      category: "validation",
      code: "HISTORY_LIST_LIMIT_OUT_OF_RANGE",
      message: "history-list limit must be <= 100",
      retryable: false,
      details: { limit: count },
    })
  }

  const request: JsonObject = {
    offset,
    count,
    direction: normalizeDirection(query.direction ?? 1),
  }

  if (query.workspaceId !== undefined) request.workspace_id = normalizePositiveInteger(query.workspaceId, "workspaceId")
  if (query.filterTypeList && query.filterTypeList.length > 0) request.filter_type_list = normalizeIntegerList(query.filterTypeList, "filterTypeList")
  if (query.orderBy !== undefined) request.order_by = normalizeNonNegativeInteger(query.orderBy, "orderBy")
  if (query.hideStoryAgentResult !== undefined) request.hide_story_agent_result = query.hideStoryAgentResult

  const imageResolutionStrategy = query.imageResolutionStrategy
  if (imageResolutionStrategy) {
    request.image_resolution_strategy = {
      enable_common: imageResolutionStrategy.enableCommon ?? true,
      enable_smart_crop: imageResolutionStrategy.enableSmartCrop ?? true,
    }
  }

  return request
}

export async function fetchJimengHistoryList(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  query?: JimengHistoryListQuery
}): Promise<JimengHistoryListResult> {
  const request = buildJimengHistoryListRequest(input.query)
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/get_history?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildHistoryListHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = parseJsonText(response.text, "history list")
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "history list")
  const parsed = parseJimengHistoryListBody(body)

  return {
    endpoint: "/mweb/v1/get_history",
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    records: parsed.records,
    hasMore: parsed.hasMore,
    nextOffset: parsed.nextOffset,
    agentConversationSessionCount: parsed.agentConversationSessionCount,
    body,
  }
}

export function parseJimengHistoryListBody(body: JsonValue): {
  records: JimengHistoryRecordEntry[]
  hasMore: boolean | null
  nextOffset: number | null
  agentConversationSessionCount: number
} {
  const decoded = decodeHistoryListContract(body)
  if (decoded.data.records_list === undefined && decoded.data.recordsList === undefined) {
    throw jimengError({
      category: "upstream",
      code: "HISTORY_LIST_RECORDS_LIST_MISSING",
      message: "history list response data did not include records_list.",
      retryable: false,
    })
  }
  const recordsList = decoded.data.records_list ?? decoded.data.recordsList ?? []
  const agentMap = decoded.data.agent_conversation_session_map ?? decoded.data.agentConversationSessionMap ?? null
  return {
    records: recordsList
      .map((value, index) => parseJimengHistoryRecordEntry(historyListLookupKey(value, index), value as JsonValue))
      .filter((entry): entry is JimengHistoryRecordEntry => !!entry),
    hasMore: decoded.data.has_more ?? decoded.data.hasMore ?? null,
    nextOffset: decoded.data.next_offset ?? decoded.data.nextOffset ?? null,
    agentConversationSessionCount: agentMap ? Object.keys(agentMap).length : 0,
  }
}

export function summarizeJimengHistoryList(result: JimengHistoryListResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    record_count: result.records.length,
    has_more: result.hasMore,
    next_offset: result.nextOffset,
    agent_conversation_session_count: result.agentConversationSessionCount,
    by_status: countBy(result.records.map((record) => record.status).filter((value): value is number => typeof value === "number").map(String)),
    by_generate_type: countBy(result.records.map((record) => record.generateType).filter((value): value is number => typeof value === "number").map(String)),
    media_counts: summarizeMediaCounts(result.records.flatMap((record) => record.items)),
    records: result.records.slice(0, 20).map((record) => ({
      lookup_key: record.lookupKey,
      history_record_id: record.historyRecordId,
      origin_history_record_id: record.originHistoryRecordId,
      submit_id: record.submitId,
      status: record.status,
      task_status: record.taskStatus,
      generate_type: record.generateType,
      mode: record.mode,
      created_time: record.createdTime,
      finish_time: record.finishTime,
      prompt: record.prompt,
      model_req_key: record.modelReqKey,
      model_name: record.modelName,
      seed: record.seed,
      total_image_count: record.totalImageCount,
      finished_image_count: record.finishedImageCount,
      item_count: record.itemCount,
    })),
  }
}

export function parseJimengHistoryFilterTypeListFlag(value: string | undefined): number[] | undefined {
  if (!value) return undefined
  return normalizeIntegerList(value.split(",").map((item) => Number(item.trim())).filter((item) => Number.isFinite(item)), "filterTypeList")
}

function historyListLookupKey(value: unknown, index: number): string {
  const record = asRecord(value)
  const submitId = stringValue(record?.submit_id) ?? stringValue(record?.submitId)
  const historyRecordId = stringValue(record?.history_record_id) ?? stringValue(record?.historyRecordId)
  return submitId ?? historyRecordId ?? `records_list.${index}`
}

function summarizeMediaCounts(items: JimengHistoryMediaItem[]): JsonObject {
  return {
    total: items.length,
    images: items.filter((item) => !!item.imageUri).length,
    videos: items.filter((item) => !!item.videoId || item.videoUrlPresent).length,
    cover_urls_present: items.filter((item) => item.coverUrlPresent).length,
    image_urls_present: items.filter((item) => item.imageUrlPresent).length,
    video_urls_present: items.filter((item) => item.videoUrlPresent).length,
  }
}

function decodeHistoryListContract(body: JsonValue): Schema.Schema.Type<typeof HistoryListBodyWireSchema> {
  try {
    return Schema.decodeUnknownSync(HistoryListBodyWireSchema)(body)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "upstream",
      code: "HISTORY_LIST_CONTRACT_CHANGED",
      message: "history list response did not match required data.records_list contract.",
      retryable: false,
      details: { error: message },
    })
  }
}

function buildHistoryListHeaders(session: JimengSessionBundle): Record<string, string> {
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
  const envelope = parseJimengApiEnvelope(body, operation)
  const ret = envelope.ret ?? null
  if (ret === "0" || ret === 0) return
  throw jimengError({
    category: "upstream",
    code: "JIMENG_API_REJECTED",
    message: `${operation} failed (ret=${String(ret ?? "missing")}, errmsg=${errmsgValue(body) ?? "missing"})`,
    retryable: false,
    details: { ret, errmsg: envelope.errmsg ?? null },
  })
}

function countBy(values: string[]): JsonObject {
  const counts: JsonObject = {}
  for (const value of values) counts[value] = Number(counts[value] ?? 0) + 1
  return counts
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw jimengError({
      category: "validation",
      code: "HISTORY_LIST_POSITIVE_INTEGER_REQUIRED",
      message: `${label} must be a positive integer.`,
      retryable: false,
      details: { [label]: value },
    })
  }
  return value
}

function normalizeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw jimengError({
      category: "validation",
      code: "HISTORY_LIST_NON_NEGATIVE_INTEGER_REQUIRED",
      message: `${label} must be a non-negative integer.`,
      retryable: false,
      details: { [label]: value },
    })
  }
  return value
}

function normalizeDirection(value: number): number {
  if (value !== 1 && value !== 2) {
    throw jimengError({
      category: "validation",
      code: "HISTORY_LIST_DIRECTION_INVALID",
      message: "history-list direction must be 1 or 2.",
      retryable: false,
      details: { direction: value },
    })
  }
  return value
}

function normalizeIntegerList(values: number[], label: string): number[] {
  const seen = new Set<number>()
  for (const value of values) {
    if (!Number.isInteger(value) || value < 0) {
      throw jimengError({
        category: "validation",
        code: "HISTORY_LIST_INTEGER_LIST_INVALID",
        message: `${label} must contain non-negative integers.`,
        retryable: false,
        details: { [label]: values },
      })
    }
    seen.add(value)
  }
  return [...seen]
}

function retValue(body: JsonValue): string | number | null {
  const value = asRecord(body)?.ret
  return typeof value === "string" || typeof value === "number" ? value : null
}

function errmsgValue(body: JsonValue): string | null {
  return stringValue(asRecord(body)?.errmsg)
}

function asRecord(value: unknown): JsonObject | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
