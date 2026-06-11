import { createHash } from "node:crypto"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient, type JimengFetch } from "./client"
import { jimengError } from "./errors"

const DEFAULT_QUERY = "aid=513695&web_version=7.5.0&da_version=3.3.17&aigc_features=app_lip_sync"
const DEFAULT_EXPLORE_CATEGORY_ID = 11222
const DEFAULT_EXPLORE_COUNT = 20

export type JimengExploreWorkType = "video" | "image" | "canvas" | "short_video"

export type JimengShortVideoExploreQuery = Omit<JimengExploreQuery, "workTypes">
export type JimengOverseasShortVideoQuery = JimengShortVideoExploreQuery

export interface JimengExploreQuery {
  count?: number
  offset?: number
  categoryId?: number
  workTypes?: JimengExploreWorkType[]
  feedRefer?: string
}

export interface JimengExploreTemplateItem {
  id: string
  effectId: string | null
  effectType: number | null
  title: string | null
  description: string | null
  templateType: string | null
  aiFeature: string | null
  featureTypes: string[]
  coverUrl: string | null
  coverWidth: number | null
  coverHeight: number | null
  aspectRatio: number | null
  usageNum: number | null
  favoriteNum: number | null
  playNum: number | null
  commentNum: number | null
  shareNum: number | null
  createTime: number | null
  categoryIds: number[]
  draftUri: string | null
  draftVersion: string | null
  prompt: string | null
  modelReqKey: string | null
  seed: number | null
  imageRatio: number | null
  metadataEffectId: string | null
  metadataEffectType: string | null
  videoId: string | null
  videoDurationSec: number | null
  videoDurationMs: number | null
  videoWidth: number | null
  videoHeight: number | null
  videoFps: number | null
  videoDefinition: string | null
  videoFormat: string | null
  videoCodec: string | null
  videoSize: number | null
  videoHasAudio: boolean | null
  videoIsMute: boolean | null
  transcodedDefinitions: string[]
}

export interface JimengExploreTemplatesResult {
  endpoint: "/mweb/v1/get_explore"
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: Record<string, unknown>
  hasMore: boolean | null
  nextOffset: number | null
  categoryId: number | null
  requestId: string | null
  items: JimengExploreTemplateItem[]
  body: unknown
}

export interface JimengOverseasShortVideosResult {
  endpoint: "/mweb/v1/feed_short_video"
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: Record<string, unknown>
  hasMore: boolean | null
  nextOffset: number | null
  categoryId: number | null
  requestId: string | null
  items: JimengExploreTemplateItem[]
  body: unknown
}

export async function fetchExploreTemplates(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  query?: JimengExploreQuery
}): Promise<JimengExploreTemplatesResult> {
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const request = buildExploreRequestBody(input.query)
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/get_explore?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildExploreHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "explore templates")
  const parsed = parseExploreTemplatesBody(body)

  return {
    endpoint: "/mweb/v1/get_explore",
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    ...parsed,
    body,
  }
}

export async function fetchOverseasShortVideos(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  query?: JimengOverseasShortVideoQuery
}): Promise<JimengOverseasShortVideosResult> {
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const query = buildShortVideoExploreQuery(input.query)
  const request = buildExploreRequestBody(query)
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/feed_short_video?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildExploreHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "overseas short videos")
  const parsed = parseOverseasShortVideosBody(body, request)

  return {
    endpoint: "/mweb/v1/feed_short_video",
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    ...parsed,
    body,
  }
}

export function buildExploreRequestBody(query: JimengExploreQuery = {}): Record<string, unknown> {
  const count = query.count ?? DEFAULT_EXPLORE_COUNT
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw jimengError({
      category: "validation",
      code: "EXPLORE_COUNT_INVALID",
      message: "Explore count must be an integer from 1 to 100.",
      retryable: false,
      details: { count },
    })
  }

  const offset = query.offset ?? 0
  if (!Number.isInteger(offset) || offset < 0) {
    throw jimengError({
      category: "validation",
      code: "EXPLORE_OFFSET_INVALID",
      message: "Explore offset must be a non-negative integer.",
      retryable: false,
      details: { offset },
    })
  }

  const categoryId = query.categoryId ?? DEFAULT_EXPLORE_CATEGORY_ID
  if (!Number.isInteger(categoryId) || categoryId < 1) {
    throw jimengError({
      category: "validation",
      code: "EXPLORE_CATEGORY_INVALID",
      message: "Explore category id must be a positive integer.",
      retryable: false,
      details: { categoryId },
    })
  }

  return {
    count,
    filter: {
      work_type_list: query.workTypes ?? ["video", "image", "canvas"],
    },
    offset,
    image_info: defaultExploreImageInfo(),
    category_id: categoryId,
    feed_refer: query.feedRefer ?? (offset === 0 ? "feed_refresh" : "feed_loadmore"),
  }
}

export function buildShortVideoExploreQuery(query: JimengShortVideoExploreQuery = {}): JimengExploreQuery {
  return {
    ...query,
    workTypes: ["short_video"],
    feedRefer: query.feedRefer ?? ((query.offset ?? 0) > 0 ? "feed_loadmore" : "feed_enterauto"),
  }
}

export function parseExploreWorkTypes(value: string | undefined): JimengExploreWorkType[] | undefined {
  if (!value) return undefined
  const parsed = value.split(",").map((part) => part.trim()).filter(Boolean)
  const valid = new Set<JimengExploreWorkType>(["video", "image", "canvas", "short_video"])
  for (const workType of parsed) {
    if (!valid.has(workType as JimengExploreWorkType)) {
      throw jimengError({
        category: "validation",
        code: "EXPLORE_WORK_TYPE_INVALID",
        message: `Unknown explore work type: ${workType}`,
        retryable: false,
        details: { valid: [...valid] },
      })
    }
  }
  return parsed as JimengExploreWorkType[]
}

export function parseExploreTemplatesBody(body: unknown): Pick<JimengExploreTemplatesResult, "hasMore" | "nextOffset" | "categoryId" | "requestId" | "items"> {
  const data = asRecord(asRecord(body)?.data)
  return {
    hasMore: booleanValue(data?.has_more),
    nextOffset: numberValue(data?.next_offset),
    categoryId: numberValue(data?.category_id),
    requestId: stringValue(data?.request_id),
    items: asArray(data?.item_list).map(parseExploreTemplateItem).filter((item): item is JimengExploreTemplateItem => !!item),
  }
}

export function parseOverseasShortVideosBody(body: unknown, request: Record<string, unknown> = {}): Pick<JimengOverseasShortVideosResult, "hasMore" | "nextOffset" | "categoryId" | "requestId" | "items"> {
  const data = asRecord(asRecord(body)?.data) ?? asRecord(body)
  const requestCategoryId = numberValue(request.category_id) ?? numberValue(request.categoryId)
  return {
    hasMore: booleanValue(data?.has_more) ?? booleanValue(data?.hasMore),
    nextOffset: numberValue(data?.next_offset) ?? numberValue(data?.nextOffset),
    categoryId: numberValue(data?.category_id) ?? numberValue(data?.categoryId) ?? requestCategoryId,
    requestId: stringValue(data?.request_id) ?? stringValue(data?.requestId),
    items: asArray(data?.item_list ?? data?.itemList).map(parseExploreTemplateItem).filter((item): item is JimengExploreTemplateItem => !!item),
  }
}

export function summarizeExploreTemplates(result: Pick<JimengExploreTemplatesResult, "items" | "hasMore" | "nextOffset" | "categoryId" | "requestId">): Record<string, unknown> {
  const byTemplateType = countBy(result.items.map((item) => item.templateType).filter((value): value is string => !!value))
  const byAiFeature = countBy(result.items.map((item) => item.aiFeature).filter((value): value is string => !!value))
  const topByUsage = [...result.items]
    .sort((a, b) => (b.usageNum ?? 0) - (a.usageNum ?? 0))
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      template_type: item.templateType,
      ai_feature: item.aiFeature,
      usage_num: item.usageNum,
      favorite_num: item.favoriteNum,
      prompt: item.prompt,
      model_req_key: item.modelReqKey,
      aspect_ratio: item.aspectRatio,
    }))

  return {
    total: result.items.length,
    has_more: result.hasMore,
    next_offset: result.nextOffset,
    category_id: result.categoryId,
    request_id: result.requestId,
    by_template_type: byTemplateType,
    by_ai_feature: byAiFeature,
    top_by_usage: topByUsage,
  }
}

export function summarizeExploreShortVideos(result: Pick<JimengExploreTemplatesResult, "items" | "hasMore" | "nextOffset" | "categoryId" | "requestId">): Record<string, unknown> {
  const topByPlay = [...result.items]
    .sort((a, b) => (b.playNum ?? 0) - (a.playNum ?? 0))
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      effect_id: item.effectId,
      effect_type: item.effectType,
      title: item.title,
      metadata_effect_id: item.metadataEffectId,
      metadata_effect_type: item.metadataEffectType,
      play_num: item.playNum,
      favorite_num: item.favoriteNum,
      comment_num: item.commentNum,
      share_num: item.shareNum,
      video_id: item.videoId,
      duration_sec: item.videoDurationSec,
      duration_ms: item.videoDurationMs,
      width: item.videoWidth,
      height: item.videoHeight,
      fps: item.videoFps,
      definition: item.videoDefinition,
      format: item.videoFormat,
      has_audio: item.videoHasAudio,
      is_mute: item.videoIsMute,
      transcoded_definitions: item.transcodedDefinitions,
    }))

  return {
    total: result.items.length,
    has_more: result.hasMore,
    next_offset: result.nextOffset,
    category_id: result.categoryId,
    request_id: result.requestId,
    top_by_play: topByPlay,
  }
}

export function redactExploreTemplateItems(items: JimengExploreTemplateItem[]): Array<Record<string, unknown>> {
  return items.map((item) => {
    const { coverUrl: _coverUrl, ...safeItem } = item
    return {
      ...safeItem,
      coverUrlPresent: !!item.coverUrl,
    }
  })
}

function parseExploreTemplateItem(value: unknown): JimengExploreTemplateItem | null {
  const item = asRecord(value)
  const common = asRecord(item?.common_attr) ?? asRecord(item?.commonAttr)
  const id = stringValue(field(common, "id"))
  if (!item || !common || !id) return null

  const draft = asRecord(item.aigc_draft) ?? asRecord(item.aigcDraft)
  const content = parseDraftContent(stringValue(field(draft, "content")))
  const coreParam = findGenerateCoreParam(content)
  const metadata = asRecord(safeJson(stringValue(field(item, "metadata_param", "metadataParam")) ?? ""))
  const extra = asRecord(item.extra)
  const aiFeature = asRecord(item.ai_feature) ?? asRecord(item.aiFeature)
  const statistic = asRecord(item.statistic)
  const video = asRecord(item.video)
  const originVideo = asRecord(field(video, "origin_video", "originVideo"))
  const transcodedVideo = asRecord(field(video, "transcoded_video", "transcodedVideo"))

  return {
    id,
    effectId: stringValue(field(common, "effect_id", "effectId")),
    effectType: numberValue(field(common, "effect_type", "effectType")),
    title: stringValue(field(common, "title")),
    description: stringValue(field(common, "description")),
    templateType: stringValue(field(extra, "template_type", "templateType")),
    aiFeature: stringValue(field(extra, "ai_feature", "aiFeature")),
    featureTypes: asArray(field(aiFeature, "features")).map((feature) => stringValue(field(asRecord(feature), "type"))).filter((type): type is string => !!type),
    coverUrl: stringValue(field(common, "cover_url", "coverUrl")),
    coverWidth: numberValue(field(common, "cover_width", "coverWidth")),
    coverHeight: numberValue(field(common, "cover_height", "coverHeight")),
    aspectRatio: numberValue(field(common, "aspect_ratio", "aspectRatio")),
    usageNum: numberValue(field(statistic, "usage_num", "usageNum")),
    favoriteNum: numberValue(field(statistic, "favorite_num", "favoriteNum")),
    playNum: numberValue(field(statistic, "play_num", "playNum")),
    commentNum: numberValue(field(statistic, "comment_num", "commentNum")),
    shareNum: numberValue(field(statistic, "share_num", "shareNum")),
    createTime: numberValue(field(common, "create_time", "createTime")),
    categoryIds: asArray(field(item, "category_id_list", "categoryIdList")).filter((entry): entry is number => typeof entry === "number"),
    draftUri: stringValue(field(draft, "uri")),
    draftVersion: stringValue(field(draft, "version")),
    prompt: stringValue(field(coreParam, "prompt")),
    modelReqKey: stringValue(field(coreParam, "model")),
    seed: numberValue(field(coreParam, "seed")),
    imageRatio: numberValue(field(coreParam, "image_ratio", "imageRatio")),
    metadataEffectId: stringValue(field(metadata, "effect_id", "effectId")),
    metadataEffectType: stringValue(field(metadata, "effect_type", "effectType")),
    videoId: stringValue(field(video, "video_id", "videoId")),
    videoDurationSec: numberValue(field(video, "duration")),
    videoDurationMs: numberValue(field(video, "duration_ms", "durationMs")),
    videoWidth: numberValue(field(originVideo, "width")),
    videoHeight: numberValue(field(originVideo, "height")),
    videoFps: numberValue(field(originVideo, "fps")),
    videoDefinition: stringValue(field(originVideo, "definition")),
    videoFormat: stringValue(field(originVideo, "format")),
    videoCodec: stringValue(field(originVideo, "codec")),
    videoSize: numberValue(field(originVideo, "size")),
    videoHasAudio: booleanValue(field(video, "has_audio", "hasAudio")),
    videoIsMute: booleanValue(field(video, "is_mute", "isMute")),
    transcodedDefinitions: transcodedVideo ? Object.keys(transcodedVideo).sort() : [],
  }
}

function findGenerateCoreParam(content: unknown): Record<string, unknown> | null {
  const root = asRecord(content)
  const components = asArray(root?.component_list)
  for (const component of components) {
    const coreParam = asRecord(asRecord(asRecord(component)?.abilities)?.generate)?.core_param
    const record = asRecord(coreParam)
    if (record) return record
  }
  return null
}

function parseDraftContent(value: string | null): unknown {
  if (!value) return null
  return safeJson(value)
}

function defaultExploreImageInfo(): Record<string, unknown> {
  const scenes = [
    ["smart_crop", 360, 360, "smart_crop-w:360-h:360"],
    ["smart_crop", 480, 480, "smart_crop-w:480-h:480"],
    ["smart_crop", 720, 720, "smart_crop-w:720-h:720"],
    ["smart_crop", 720, 480, "smart_crop-w:720-h:480"],
    ["smart_crop", 360, 240, "smart_crop-w:360-h:240"],
    ["smart_crop", 240, 320, "smart_crop-w:240-h:320"],
    ["smart_crop", 480, 640, "smart_crop-w:480-h:640"],
    ["loss", 1080, 1080, "1080"],
    ["loss", 900, 900, "900"],
    ["loss", 720, 720, "720"],
    ["loss", 480, 480, "480"],
    ["loss", 360, 360, "360"],
    ["normal", 2048, 2048, "2048"],
  ] as const

  return {
    width: 2048,
    height: 2048,
    format: "webp",
    image_scene_list: scenes.map(([scene, width, height, uniqKey]) => ({
      scene,
      width,
      height,
      format: "webp",
      uniq_key: uniqKey,
    })),
  }
}

function buildExploreHeaders(session: JimengSessionBundle): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/plain, */*",
    "user-agent": session.userAgent ?? "Mozilla/5.0",
    origin: session.origin ?? "https://jimeng.jianying.com",
    referer: session.referer ?? "https://jimeng.jianying.com/ai-tool/home/",
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

function assertJimengSuccess(body: unknown, operation: string): void {
  const ret = retValue(body)
  if (ret === "0" || ret === 0) return
  throw jimengError({
    category: "upstream",
    code: "JIMENG_API_REJECTED",
    message: `${operation} failed (ret=${String(ret ?? "unknown")}, errmsg=${errmsgValue(body) ?? "unknown"})`,
    retryable: false,
    details: { operation, ret, errmsg: errmsgValue(body) },
  })
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function retValue(body: unknown): string | number | null {
  const value = asRecord(body)?.ret
  return typeof value === "string" || typeof value === "number" ? value : null
}

function errmsgValue(body: unknown): string | null {
  return stringValue(asRecord(body)?.errmsg)
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

function field(record: Record<string, unknown> | null, snakeKey: string, camelKey?: string): unknown {
  if (!record) return undefined
  return record[snakeKey] ?? (camelKey ? record[camelKey] : undefined)
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}
