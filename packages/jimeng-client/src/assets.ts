import { createHash } from "node:crypto"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient } from "./client"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"

const DEFAULT_QUERY = "aid=513695&web_version=7.5.0&da_version=3.3.17&aigc_features=app_lip_sync"
const DEFAULT_ASSET_TYPES = [1, 2, 5, 6, 7, 8, 9, 10, 12]

export interface JimengAssetsQuery {
  count?: number
  direction?: number
  mode?: string
  assetTypes?: number[]
  workspaceId?: number
  orderBy?: number
  onlyFavorited?: boolean
  endTimeStamp?: number
  hideStoryAgentResult?: boolean
}

export interface JimengAssetGeneratedItem {
  id: string | null
  effectId: string | null
  effectType: number | null
  status: number | null
  createTime: number | null
  updateTime: number | null
  coverUri: string | null
  coverUrlPresent: boolean
  coverMapKeys: string[]
  coverWidth: number | null
  coverHeight: number | null
  imageUri: string | null
  imageUrlPresent: boolean
  imageWidth: number | null
  imageHeight: number | null
  imageFormat: string | null
  videoId: string | null
  videoDurationSec: number | null
  videoDurationMs: number | null
  videoWidth: number | null
  videoHeight: number | null
  videoFps: number | null
  videoDefinition: string | null
  videoFormat: string | null
  videoHasAudio: boolean | null
  videoIsMute: boolean | null
  videoUrlPresent: boolean
  transcodedDefinitions: string[]
}

export interface JimengAssetMediaSummary {
  status: number | null
  taskStatus: number | null
  historyRecordId: string | null
  submitId: string | null
  createdTime: number | null
  finishTime: number | null
  workspaceId: number | null
  mode: string | null
  generateType: number | null
  totalImageCount: number | null
  finishedImageCount: number | null
  prompt: string | null
  modelReqKey: string | null
  modelName: string | null
  seed: number | null
  hasFavorited: boolean | null
}

export interface JimengAssetItem {
  assetId: string | null
  uid: string | null
  assetType: number | null
  mediaKind: "image" | "video" | "unknown"
  image: JimengAssetMediaSummary | null
  video: JimengAssetMediaSummary | null
  generatedItems: JimengAssetGeneratedItem[]
}

export interface JimengAssetsResult {
  endpoint: "/mweb/v1/get_asset_list"
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  hasMore: boolean | null
  nextOffset: number | null
  assets: JimengAssetItem[]
  body: JsonValue
}

export function buildJimengAssetsRequest(query: JimengAssetsQuery = {}): JsonObject {
  const count = normalizeCount(query.count)
  const direction = normalizeInteger(query.direction ?? 1, "ASSET_DIRECTION_INVALID", "--direction must be an integer.")
  const orderBy = normalizeInteger(query.orderBy ?? 0, "ASSET_ORDER_BY_INVALID", "--order-by must be an integer.")
  const endTimeStamp = normalizeNonNegativeNumber(query.endTimeStamp ?? 0, "ASSET_END_TIME_INVALID", "--endTimeStamp must be a non-negative number.")
  const assetTypes = normalizeAssetTypes(query.assetTypes)

  const request: JsonObject = {
    count,
    direction,
    mode: query.mode ?? "workbench",
    option: {
      image_info: defaultAssetImageInfo(2048, 2048),
      origin_image_info: defaultAssetImageInfo(96, 2048),
      order_by: orderBy,
      only_favorited: query.onlyFavorited ?? false,
      end_time_stamp: endTimeStamp,
      hide_story_agent_result: query.hideStoryAgentResult ?? true,
    },
    asset_type_list: assetTypes,
  }
  if (query.workspaceId !== undefined) request.workspace_id = normalizeWorkspaceId(query.workspaceId)
  return request
}

export async function fetchJimengAssets(input: {
  client?: JimengClient
  session: JimengSessionBundle
  query?: JimengAssetsQuery
}): Promise<JimengAssetsResult> {
  const request = buildJimengAssetsRequest(input.query)
  const client = input.client ?? new JimengClient()
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/get_asset_list?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildAssetsHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "asset list")
  const parsed = parseJimengAssetsBody(body)

  return {
    endpoint: "/mweb/v1/get_asset_list",
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    ...parsed,
    body,
  }
}

export function parseJimengAssetsBody(body: JsonValue): Pick<JimengAssetsResult, "hasMore" | "nextOffset" | "assets"> {
  const data = asRecord(asRecord(body)?.data)
  return {
    hasMore: booleanValue(data?.has_more) ?? booleanValue(data?.hasMore),
    nextOffset: numberValue(data?.next_offset) ?? numberValue(data?.nextOffset),
    assets: asArray(data?.asset_list ?? data?.assetList).map(parseAsset).filter((asset): asset is JimengAssetItem => !!asset),
  }
}

export function summarizeJimengAssets(result: JimengAssetsResult): JsonObject {
  const byAssetType = countBy(result.assets.map((asset) => asset.assetType).filter((value): value is number => value !== null).map(String))
  const byMediaKind = countBy(result.assets.map((asset) => asset.mediaKind))
  const statusValues = result.assets
    .map((asset) => asset.image?.status ?? asset.video?.status)
    .filter((value): value is number => typeof value === "number")
    .map(String)
  const byStatus = countBy(statusValues)

  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    has_more: result.hasMore,
    next_offset: result.nextOffset,
    asset_count: result.assets.length,
    by_asset_type: byAssetType,
    by_media_kind: byMediaKind,
    by_status: byStatus,
    assets: result.assets.slice(0, 20).map((asset) => ({
      asset_id: asset.assetId,
      asset_type: asset.assetType,
      media_kind: asset.mediaKind,
      uid: asset.uid,
      status: asset.image?.status ?? asset.video?.status ?? null,
      task_status: asset.image?.taskStatus ?? asset.video?.taskStatus ?? null,
      submit_id: asset.image?.submitId ?? asset.video?.submitId ?? null,
      history_record_id: asset.image?.historyRecordId ?? asset.video?.historyRecordId ?? null,
      workspace_id: asset.image?.workspaceId ?? asset.video?.workspaceId ?? null,
      prompt: asset.image?.prompt ?? asset.video?.prompt ?? null,
      model_req_key: asset.image?.modelReqKey ?? asset.video?.modelReqKey ?? null,
      model_name: asset.image?.modelName ?? asset.video?.modelName ?? null,
      seed: asset.image?.seed ?? asset.video?.seed ?? null,
      generated_item_count: asset.generatedItems.length,
      finished_image_count: asset.image?.finishedImageCount ?? null,
      total_image_count: asset.image?.totalImageCount ?? null,
      generated_items: asset.generatedItems.slice(0, 8).map(summarizeGeneratedItem),
    })),
  }
}

export function parseJimengAssetTypes(value: string | undefined): number[] | undefined {
  if (!value) return undefined
  const parsed = value.split(",").map((part) => Number(part.trim()))
  if (parsed.some((part) => !Number.isFinite(part))) {
    throw jimengError({
      category: "validation",
      code: "ASSET_TYPE_INVALID",
      message: "Asset types must be comma-separated positive integers.",
      retryable: false,
      details: { value },
    })
  }
  return parsed.length > 0 ? normalizeAssetTypes(parsed) : undefined
}

export function workspaceIdFromJimengSession(session: JimengSessionBundle): number | undefined {
  const referer = session.referer
  if (!referer) return undefined
  try {
    const url = new URL(referer)
    const workspace = url.searchParams.get("workspace")
    if (!workspace) return undefined
    const id = Number(workspace)
    return Number.isInteger(id) && id > 0 ? id : undefined
  } catch {
    return undefined
  }
}

function parseAsset(value: JsonValue): JimengAssetItem | null {
  const asset = asRecord(value)
  if (!asset) return null
  const image = asRecord(asset.image)
  const video = asRecord(asset.video)
  const mediaKind = image ? "image" : video ? "video" : "unknown"

  return {
    assetId: stringValue(asset.id),
    uid: stringValue(asset.uid),
    assetType: numberValue(asset.type),
    mediaKind,
    image: image ? parseMediaSummary(image) : null,
    video: video ? parseMediaSummary(video) : null,
    generatedItems: collectGeneratedItems(image, video),
  }
}

function parseMediaSummary(media: JsonObject): JimengAssetMediaSummary {
  const task = asRecord(media.task)
  const assetOption = asRecord(media.asset_option) ?? asRecord(media.assetOption)
  const draftCoreParam = findGenerateCoreParam(safeJson(stringValue(media.draft_content) ?? stringValue(media.draftContent) ?? ""))
  const text2ImageParams = asRecord(asRecord(media.aigc_image_params)?.text2image_params) ?? asRecord(asRecord(media.aigcImageParams)?.text2imageParams)
  const modelConfig = asRecord(text2ImageParams?.model_config) ?? asRecord(text2ImageParams?.modelConfig)
  const modelInfo = asRecord(media.model_info) ?? asRecord(media.modelInfo)

  return {
    status: numberValue(media.status),
    taskStatus: numberValue(task?.status),
    historyRecordId: stringValue(media.history_record_id) ?? stringValue(media.historyRecordId),
    submitId: stringValue(media.submit_id) ?? stringValue(media.submitId) ?? stringValue(task?.submit_id) ?? stringValue(task?.submitId),
    createdTime: numberValue(media.created_time) ?? numberValue(media.createdTime),
    finishTime: numberValue(media.finish_time) ?? numberValue(media.finishTime) ?? numberValue(task?.finish_time) ?? numberValue(task?.finishTime),
    workspaceId: numberValue(media.workspace_id) ?? numberValue(media.workspaceId),
    mode: stringValue(media.mode),
    generateType: numberValue(media.generate_type) ?? numberValue(media.generateType),
    totalImageCount: numberValue(media.total_image_count) ?? numberValue(media.totalImageCount),
    finishedImageCount: numberValue(media.finished_image_count) ?? numberValue(media.finishedImageCount),
    prompt: stringValue(media.history_group_key) ?? stringValue(media.historyGroupKey) ?? stringValue(text2ImageParams?.prompt) ?? stringValue(draftCoreParam?.prompt),
    modelReqKey: stringValue(modelInfo?.model_req_key) ?? stringValue(modelInfo?.modelReqKey) ?? stringValue(modelConfig?.model_req_key) ?? stringValue(modelConfig?.modelReqKey) ?? stringValue(draftCoreParam?.model),
    modelName: stringValue(modelInfo?.model_name) ?? stringValue(modelInfo?.modelName) ?? stringValue(modelConfig?.model_name) ?? stringValue(modelConfig?.modelName),
    seed: numberValue(text2ImageParams?.seed) ?? numberValue(draftCoreParam?.seed),
    hasFavorited: booleanValue(assetOption?.has_favorited) ?? booleanValue(assetOption?.hasFavorited),
  }
}

function collectGeneratedItems(image: JsonObject | null, video: JsonObject | null): JimengAssetGeneratedItem[] {
  const items = [
    ...asArray(image?.item_list ?? image?.itemList),
    ...asArray(video?.item_list ?? video?.itemList),
  ]
  return items.map(parseGeneratedItem).filter((item): item is JimengAssetGeneratedItem => !!item)
}

function parseGeneratedItem(value: JsonValue): JimengAssetGeneratedItem | null {
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
    createTime: numberValue(common?.create_time) ?? numberValue(common?.createTime),
    updateTime: numberValue(common?.update_time) ?? numberValue(common?.updateTime),
    coverUri: stringValue(common?.cover_uri) ?? stringValue(common?.coverUri),
    coverUrlPresent: !!(stringValue(common?.cover_url) ?? stringValue(common?.coverUrl)),
    coverMapKeys: Object.keys(asRecord(common?.cover_url_map) ?? asRecord(common?.coverUrlMap) ?? {}).sort(),
    coverWidth: numberValue(common?.cover_width) ?? numberValue(common?.coverWidth),
    coverHeight: numberValue(common?.cover_height) ?? numberValue(common?.coverHeight),
    imageUri: stringValue(firstImage?.image_uri) ?? stringValue(firstImage?.imageUri) ?? stringValue(image?.image_uri) ?? stringValue(image?.imageUri),
    imageUrlPresent: !!(stringValue(firstImage?.image_url) ?? stringValue(firstImage?.imageUrl) ?? stringValue(image?.image_url) ?? stringValue(image?.imageUrl)),
    imageWidth: numberValue(firstImage?.width) ?? numberValue(image?.width),
    imageHeight: numberValue(firstImage?.height) ?? numberValue(image?.height),
    imageFormat: stringValue(firstImage?.format) ?? stringValue(image?.format),
    videoId: stringValue(video?.video_id) ?? stringValue(video?.videoId),
    videoDurationSec: numberValue(video?.duration),
    videoDurationMs: numberValue(video?.duration_ms) ?? numberValue(video?.durationMs),
    videoWidth: numberValue(originVideo?.width),
    videoHeight: numberValue(originVideo?.height),
    videoFps: numberValue(originVideo?.fps),
    videoDefinition: stringValue(originVideo?.definition),
    videoFormat: stringValue(originVideo?.format),
    videoHasAudio: booleanValue(video?.has_audio) ?? booleanValue(video?.hasAudio),
    videoIsMute: booleanValue(video?.is_mute) ?? booleanValue(video?.isMute),
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

function summarizeGeneratedItem(item: JimengAssetGeneratedItem): JsonObject {
  return {
    id: item.id,
    effect_id: item.effectId,
    effect_type: item.effectType,
    status: item.status,
    create_time: item.createTime,
    update_time: item.updateTime,
    cover_uri: item.coverUri,
    cover_url_present: item.coverUrlPresent,
    cover_map_keys: item.coverMapKeys,
    cover_width: item.coverWidth,
    cover_height: item.coverHeight,
    image_uri: item.imageUri,
    image_url_present: item.imageUrlPresent,
    image_width: item.imageWidth,
    image_height: item.imageHeight,
    image_format: item.imageFormat,
    video_id: item.videoId,
    video_duration_sec: item.videoDurationSec,
    video_duration_ms: item.videoDurationMs,
    video_width: item.videoWidth,
    video_height: item.videoHeight,
    video_fps: item.videoFps,
    video_definition: item.videoDefinition,
    video_format: item.videoFormat,
    video_has_audio: item.videoHasAudio,
    video_is_mute: item.videoIsMute,
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
    const coreParam = asRecord(generate?.core_param) ?? asRecord(generate?.coreParam)
    if (coreParam) return coreParam
  }
  return null
}

function defaultAssetImageInfo(width: number, height: number): JsonObject {
  return {
    width,
    height,
    format: "webp",
    image_scene_list: [
      { scene: "normal", width: 2400, height: 2400, uniq_key: "2400", format: "webp" },
      { scene: "loss", width: 1080, height: 1080, uniq_key: "1080", format: "webp" },
      { scene: "loss", width: 900, height: 900, uniq_key: "900", format: "webp" },
      { scene: "loss", width: 720, height: 720, uniq_key: "720", format: "webp" },
      { scene: "loss", width: 480, height: 480, uniq_key: "480", format: "webp" },
      { scene: "loss", width: 360, height: 360, uniq_key: "360", format: "webp" },
    ],
  }
}

function buildAssetsHeaders(session: JimengSessionBundle): Record<string, string> {
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

function normalizeCount(value: number | undefined): number {
  if (value === undefined) return 20
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw jimengError({
      category: "validation",
      code: "ASSET_COUNT_INVALID",
      message: "--limit must be an integer from 1 to 100.",
      retryable: false,
      details: { count: value },
    })
  }
  return value
}

function normalizeAssetTypes(values: number[] | undefined): number[] {
  const assetTypes = values ?? DEFAULT_ASSET_TYPES
  const seen = new Set<number>()
  for (const value of assetTypes) {
    if (!Number.isInteger(value) || value < 1) {
      throw jimengError({
        category: "validation",
        code: "ASSET_TYPE_INVALID",
        message: "Asset types must be positive integers.",
        retryable: false,
        details: { assetType: value },
      })
    }
    seen.add(value)
  }
  return [...seen]
}

function normalizeWorkspaceId(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw jimengError({
      category: "validation",
      code: "ASSET_WORKSPACE_ID_INVALID",
      message: "--workspaceId must be a positive integer.",
      retryable: false,
      details: { workspaceId: value },
    })
  }
  return value
}

function normalizeInteger(value: number, code: string, message: string): number {
  if (!Number.isInteger(value)) {
    throw jimengError({
      category: "validation",
      code,
      message,
      retryable: false,
      details: { value },
    })
  }
  return value
}

function normalizeNonNegativeNumber(value: number, code: string, message: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw jimengError({
      category: "validation",
      code,
      message,
      retryable: false,
      details: { value },
    })
  }
  return value
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

function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanValue(value: JsonValue | undefined): boolean | null {
  return typeof value === "boolean" ? value : null
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
