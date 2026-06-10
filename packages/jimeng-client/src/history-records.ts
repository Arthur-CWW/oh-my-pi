import { createHash } from "node:crypto"
import { z } from "zod"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient } from "./client"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { parseJimengApiEnvelope, parseJimengContract, parseJimengDataMap, parseJsonText } from "./schema"

const DEFAULT_QUERY = "aid=513695&device_platform=web&region=cn&da_version=3.1.3"
const OptionalString = z.string().nullable().optional()
const OptionalNumber = z.number().nullable().optional()
const OptionalStringMap = z.record(z.string(), z.string()).nullable().optional()

const CommonAttrWireSchema = z.object({
  id: OptionalString,
  effect_id: OptionalString,
  effectId: OptionalString,
  effect_type: OptionalNumber,
  effectType: OptionalNumber,
  status: OptionalNumber,
  cover_uri: OptionalString,
  coverUri: OptionalString,
  cover_url: OptionalString,
  coverUrl: OptionalString,
  cover_url_map: OptionalStringMap,
  coverUrlMap: OptionalStringMap,
}).passthrough()

const LargeImageWireSchema = z.object({
  image_uri: OptionalString,
  imageUri: OptionalString,
  image_url: OptionalString,
  imageUrl: OptionalString,
  width: OptionalNumber,
  height: OptionalNumber,
  format: OptionalString,
}).passthrough()

const ImageWireSchema = z.object({
  image_uri: OptionalString,
  imageUri: OptionalString,
  image_url: OptionalString,
  imageUrl: OptionalString,
  width: OptionalNumber,
  height: OptionalNumber,
  format: OptionalString,
  large_images: z.array(LargeImageWireSchema).nullable().optional(),
  largeImages: z.array(LargeImageWireSchema).nullable().optional(),
}).passthrough()

const OriginVideoWireSchema = z.object({
  video_url: OptionalString,
  videoUrl: OptionalString,
  width: OptionalNumber,
  height: OptionalNumber,
  fps: OptionalNumber,
  definition: OptionalString,
  format: OptionalString,
}).passthrough()

const VideoWireSchema = z.object({
  video_id: OptionalString,
  videoId: OptionalString,
  duration: OptionalNumber,
  play_url: OptionalString,
  playUrl: OptionalString,
  download_url: OptionalString,
  downloadUrl: OptionalString,
  url: OptionalString,
  origin_video: OriginVideoWireSchema.nullable().optional(),
  originVideo: OriginVideoWireSchema.nullable().optional(),
  transcoded_video: z.record(z.string(), z.object({}).passthrough()).nullable().optional(),
  transcodedVideo: z.record(z.string(), z.object({}).passthrough()).nullable().optional(),
}).passthrough()

const HistoryItemWireSchema = z.object({
  id: OptionalString,
  status: OptionalNumber,
  common_attr: CommonAttrWireSchema.nullable().optional(),
  commonAttr: CommonAttrWireSchema.nullable().optional(),
  image: ImageWireSchema.nullable().optional(),
  video: VideoWireSchema.nullable().optional(),
}).passthrough()

const HistoryTaskWireSchema = z.object({
  submit_id: OptionalString,
  submitId: OptionalString,
  status: OptionalNumber,
  finish_time: OptionalNumber,
  finishTime: OptionalNumber,
}).passthrough()

const HistoryRecordWireSchema = z.object({
  generate_type: OptionalNumber,
  generateType: OptionalNumber,
  history_record_id: OptionalString,
  historyRecordId: OptionalString,
  origin_history_record_id: OptionalString,
  originHistoryRecordId: OptionalString,
  submit_id: OptionalString,
  submitId: OptionalString,
  created_time: OptionalNumber,
  createdTime: OptionalNumber,
  finish_time: OptionalNumber,
  finishTime: OptionalNumber,
  item_list: z.array(HistoryItemWireSchema).nullable().optional(),
  itemList: z.array(HistoryItemWireSchema).nullable().optional(),
  task: HistoryTaskWireSchema.nullable().optional(),
  mode: OptionalString,
  status: OptionalNumber,
  history_group_key: OptionalString,
  historyGroupKey: OptionalString,
  draft_content: OptionalString,
  draftContent: OptionalString,
  total_image_count: OptionalNumber,
  totalImageCount: OptionalNumber,
  finished_image_count: OptionalNumber,
  finishedImageCount: OptionalNumber,
}).passthrough()

const HistoryRecordsDataMapSchema = z.record(z.string(), HistoryRecordWireSchema)

export interface JimengHistoryRecordsQuery {
  submitIds?: string[]
  historyIds?: string[]
  needBatch?: boolean
}

export interface JimengHistoryMediaItem {
  id: string | null
  effectId: string | null
  effectType: number | null
  status: number | null
  coverUri: string | null
  coverUrlPresent: boolean
  coverMapKeys: string[]
  imageUri: string | null
  imageUrlPresent: boolean
  imageWidth: number | null
  imageHeight: number | null
  imageFormat: string | null
  videoId: string | null
  videoDurationSec: number | null
  videoWidth: number | null
  videoHeight: number | null
  videoFps: number | null
  videoDefinition: string | null
  videoFormat: string | null
  videoUrlPresent: boolean
  transcodedDefinitions: string[]
}

export interface JimengHistoryRecordEntry {
  lookupKey: string
  historyRecordId: string | null
  originHistoryRecordId: string | null
  submitId: string | null
  status: number | null
  taskStatus: number | null
  generateType: number | null
  mode: string | null
  createdTime: number | null
  finishTime: number | null
  prompt: string | null
  modelReqKey: string | null
  modelName: string | null
  seed: number | null
  totalImageCount: number | null
  finishedImageCount: number | null
  itemCount: number
  items: JimengHistoryMediaItem[]
}

export interface JimengHistoryRecordsResult {
  endpoint: "/mweb/v1/get_history_by_ids"
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  records: JimengHistoryRecordEntry[]
  body: JsonValue
}

export function buildJimengHistoryRecordsRequest(query: JimengHistoryRecordsQuery): JsonObject {
  const submitIds = normalizeOptionalIds(query.submitIds, "HISTORY_RECORD_SUBMIT_ID_INVALID")
  const historyIds = normalizeOptionalIds(query.historyIds, "HISTORY_RECORD_HISTORY_ID_INVALID")
  if (submitIds.length === 0 && historyIds.length === 0) {
    throw jimengError({
      category: "validation",
      code: "HISTORY_RECORD_IDS_REQUIRED",
      message: "At least one submit id or history id is required.",
      retryable: false,
    })
  }
  return {
    submit_ids: submitIds,
    need_batch: query.needBatch ?? true,
    history_ids: historyIds,
  }
}

export async function fetchJimengHistoryRecords(input: {
  client?: JimengClient
  session: JimengSessionBundle
  query: JimengHistoryRecordsQuery
}): Promise<JimengHistoryRecordsResult> {
  const request = buildJimengHistoryRecordsRequest(input.query)
  const client = input.client ?? new JimengClient()
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/get_history_by_ids?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildHistoryRecordsHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = parseJsonText(response.text, "history records")
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "history records")

  return {
    endpoint: "/mweb/v1/get_history_by_ids",
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    records: parseJimengHistoryRecordsBody(body),
    body,
  }
}

export function parseJimengHistoryRecordsBody(body: JsonValue): JimengHistoryRecordEntry[] {
  const data = parseJimengContract(HistoryRecordsDataMapSchema, parseJimengDataMap(body, "history records"), "history records")
  return Object.entries(data)
    .map(([lookupKey, value]) => parseHistoryRecord(lookupKey, value as JsonValue))
    .filter((entry): entry is JimengHistoryRecordEntry => !!entry)
}

export function summarizeJimengHistoryRecords(result: JimengHistoryRecordsResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    record_count: result.records.length,
    by_status: countBy(result.records.map((record) => record.status).filter((value): value is number => typeof value === "number").map(String)),
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
      items: record.items.slice(0, 8).map(summarizeMediaItem),
    })),
  }
}

export function parseJimengIdCsvFlag(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  return normalizeOptionalIds(value.split(",").map((item) => item.trim()).filter(Boolean), "HISTORY_RECORD_ID_INVALID")
}

function parseHistoryRecord(lookupKey: string, value: JsonValue): JimengHistoryRecordEntry | null {
  const record = asRecord(value)
  if (!record) return null
  const task = asRecord(record.task)
  const items = asArray(record.item_list ?? record.itemList).map(parseMediaItem).filter((item): item is JimengHistoryMediaItem => !!item)
  const draftCoreParam = findGenerateCoreParam(safeJson(stringValue(record.draft_content) ?? stringValue(record.draftContent) ?? ""))
  const text2ImageParams = asRecord(asRecord(record.aigc_image_params)?.text2image_params) ?? asRecord(asRecord(record.aigcImageParams)?.text2imageParams)
  const modelConfig = asRecord(text2ImageParams?.model_config) ?? asRecord(text2ImageParams?.modelConfig)
  const modelInfo = asRecord(record.model_info) ?? asRecord(record.modelInfo)

  return {
    lookupKey,
    historyRecordId: stringValue(record.history_record_id) ?? stringValue(record.historyRecordId),
    originHistoryRecordId: stringValue(record.origin_history_record_id) ?? stringValue(record.originHistoryRecordId),
    submitId: stringValue(record.submit_id) ?? stringValue(record.submitId) ?? stringValue(task?.submit_id) ?? stringValue(task?.submitId),
    status: numberValue(record.status),
    taskStatus: numberValue(task?.status),
    generateType: numberValue(record.generate_type) ?? numberValue(record.generateType),
    mode: stringValue(record.mode),
    createdTime: numberValue(record.created_time) ?? numberValue(record.createdTime),
    finishTime: numberValue(record.finish_time) ?? numberValue(record.finishTime) ?? numberValue(task?.finish_time) ?? numberValue(task?.finishTime),
    prompt: stringValue(record.history_group_key) ?? stringValue(record.historyGroupKey) ?? stringValue(text2ImageParams?.prompt) ?? stringValue(draftCoreParam?.prompt),
    modelReqKey: stringValue(modelInfo?.model_req_key) ?? stringValue(modelInfo?.modelReqKey) ?? stringValue(modelConfig?.model_req_key) ?? stringValue(modelConfig?.modelReqKey) ?? stringValue(draftCoreParam?.model),
    modelName: stringValue(modelInfo?.model_name) ?? stringValue(modelInfo?.modelName) ?? stringValue(modelConfig?.model_name) ?? stringValue(modelConfig?.modelName),
    seed: numberValue(text2ImageParams?.seed) ?? numberValue(draftCoreParam?.seed),
    totalImageCount: numberValue(record.total_image_count) ?? numberValue(record.totalImageCount),
    finishedImageCount: numberValue(record.finished_image_count) ?? numberValue(record.finishedImageCount),
    itemCount: items.length,
    items,
  }
}

function parseMediaItem(value: JsonValue): JimengHistoryMediaItem | null {
  const item = asRecord(value)
  if (!item) return null
  const common = asRecord(item.common_attr) ?? asRecord(item.commonAttr)
  const image = asRecord(item.image)
  const firstImage = asRecord(asArray(image?.large_images ?? image?.largeImages)[0])
  const video = asRecord(item.video)
  const originVideo = asRecord(video?.origin_video) ?? asRecord(video?.originVideo)
  const transcodedVideo = asRecord(video?.transcoded_video) ?? asRecord(video?.transcodedVideo)

  return {
    id: stringValue(common?.id) ?? stringValue(item.id),
    effectId: stringValue(common?.effect_id) ?? stringValue(common?.effectId),
    effectType: numberValue(common?.effect_type) ?? numberValue(common?.effectType),
    status: numberValue(common?.status) ?? numberValue(item.status),
    coverUri: stringValue(common?.cover_uri) ?? stringValue(common?.coverUri),
    coverUrlPresent: !!(stringValue(common?.cover_url) ?? stringValue(common?.coverUrl)),
    coverMapKeys: Object.keys(asRecord(common?.cover_url_map) ?? asRecord(common?.coverUrlMap) ?? {}).sort(),
    imageUri: stringValue(firstImage?.image_uri) ?? stringValue(firstImage?.imageUri) ?? stringValue(image?.image_uri) ?? stringValue(image?.imageUri),
    imageUrlPresent: !!(stringValue(firstImage?.image_url) ?? stringValue(firstImage?.imageUrl) ?? stringValue(image?.image_url) ?? stringValue(image?.imageUrl)),
    imageWidth: numberValue(firstImage?.width) ?? numberValue(image?.width),
    imageHeight: numberValue(firstImage?.height) ?? numberValue(image?.height),
    imageFormat: stringValue(firstImage?.format) ?? stringValue(image?.format),
    videoId: stringValue(video?.video_id) ?? stringValue(video?.videoId),
    videoDurationSec: numberValue(video?.duration),
    videoWidth: numberValue(originVideo?.width),
    videoHeight: numberValue(originVideo?.height),
    videoFps: numberValue(originVideo?.fps),
    videoDefinition: stringValue(originVideo?.definition),
    videoFormat: stringValue(originVideo?.format),
    videoUrlPresent: !!(
      stringValue(video?.play_url)
      ?? stringValue(video?.playUrl)
      ?? stringValue(video?.download_url)
      ?? stringValue(video?.downloadUrl)
      ?? stringValue(video?.url)
      ?? stringValue(originVideo?.video_url)
      ?? stringValue(originVideo?.videoUrl)
    ),
    transcodedDefinitions: Object.keys(transcodedVideo ?? {}).sort(),
  }
}

function summarizeMediaItem(item: JimengHistoryMediaItem): JsonObject {
  return {
    id: item.id,
    effect_id: item.effectId,
    effect_type: item.effectType,
    status: item.status,
    cover_uri: item.coverUri,
    cover_url_present: item.coverUrlPresent,
    cover_map_keys: item.coverMapKeys,
    image_uri: item.imageUri,
    image_url_present: item.imageUrlPresent,
    image_width: item.imageWidth,
    image_height: item.imageHeight,
    image_format: item.imageFormat,
    video_id: item.videoId,
    video_duration_sec: item.videoDurationSec,
    video_width: item.videoWidth,
    video_height: item.videoHeight,
    video_fps: item.videoFps,
    video_definition: item.videoDefinition,
    video_format: item.videoFormat,
    video_url_present: item.videoUrlPresent,
    transcoded_definitions: item.transcodedDefinitions,
  }
}

function findGenerateCoreParam(content: JsonValue): JsonObject | null {
  const root = asRecord(content)
  const components = asArray(root?.component_list ?? root?.componentList)
  for (const component of components) {
    const abilities = asRecord(asRecord(component)?.abilities)
    const generate = asRecord(abilities?.generate)
    const genVideo = asRecord(abilities?.gen_video) ?? asRecord(abilities?.genVideo)
    const coreParam = asRecord(generate?.core_param) ?? asRecord(generate?.coreParam) ?? asRecord(genVideo?.core_param) ?? asRecord(genVideo?.coreParam)
    if (coreParam) return coreParam
  }
  return null
}

function normalizeOptionalIds(values: string[] | undefined, code: string): string[] {
  const normalized = (values ?? []).map((value) => value.trim()).filter(Boolean)
  const seen = new Set<string>()
  for (const value of normalized) {
    if (!/^[0-9A-Za-z_-]+$/.test(value)) {
      throw jimengError({
        category: "validation",
        code,
        message: "IDs must be non-empty strings containing letters, numbers, underscores, or hyphens.",
        retryable: false,
        details: { id: value },
      })
    }
    seen.add(value)
  }
  return [...seen]
}

function buildHistoryRecordsHeaders(session: JimengSessionBundle): Record<string, string> {
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

function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
