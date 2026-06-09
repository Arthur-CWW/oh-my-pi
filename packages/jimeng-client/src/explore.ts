import { createHash } from "node:crypto"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient } from "./client"
import { jimengError } from "./errors"

const DEFAULT_QUERY = "aid=513695&web_version=7.5.0&da_version=3.3.17&aigc_features=app_lip_sync"
const DEFAULT_EXPLORE_CATEGORY_ID = 11222
const DEFAULT_EXPLORE_COUNT = 20

export type JimengExploreWorkType = "video" | "image" | "canvas"

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

export async function fetchExploreTemplates(input: {
  client?: JimengClient
  session: JimengSessionBundle
  query?: JimengExploreQuery
}): Promise<JimengExploreTemplatesResult> {
  const client = input.client ?? new JimengClient()
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

export function parseExploreWorkTypes(value: string | undefined): JimengExploreWorkType[] | undefined {
  if (!value) return undefined
  const parsed = value.split(",").map((part) => part.trim()).filter(Boolean)
  const valid = new Set<JimengExploreWorkType>(["video", "image", "canvas"])
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

function parseExploreTemplateItem(value: unknown): JimengExploreTemplateItem | null {
  const item = asRecord(value)
  const common = asRecord(item?.common_attr)
  const id = stringValue(common?.id)
  if (!item || !common || !id) return null

  const draft = asRecord(item.aigc_draft)
  const content = parseDraftContent(stringValue(draft?.content))
  const coreParam = findGenerateCoreParam(content)
  const metadata = asRecord(safeJson(stringValue(item.metadata_param) ?? ""))
  const extra = asRecord(item.extra)
  const aiFeature = asRecord(item.ai_feature)

  return {
    id,
    effectId: stringValue(common.effect_id),
    effectType: numberValue(common.effect_type),
    title: stringValue(common.title),
    description: stringValue(common.description),
    templateType: stringValue(extra?.template_type),
    aiFeature: stringValue(extra?.ai_feature),
    featureTypes: asArray(aiFeature?.features).map((feature) => stringValue(asRecord(feature)?.type)).filter((type): type is string => !!type),
    coverUrl: stringValue(common.cover_url),
    coverWidth: numberValue(common.cover_width),
    coverHeight: numberValue(common.cover_height),
    aspectRatio: numberValue(common.aspect_ratio),
    usageNum: numberValue(asRecord(item.statistic)?.usage_num),
    favoriteNum: numberValue(asRecord(item.statistic)?.favorite_num),
    playNum: numberValue(asRecord(item.statistic)?.play_num),
    createTime: numberValue(common.create_time),
    categoryIds: asArray(item.category_id_list).filter((entry): entry is number => typeof entry === "number"),
    draftUri: stringValue(draft?.uri),
    draftVersion: stringValue(draft?.version),
    prompt: stringValue(coreParam?.prompt),
    modelReqKey: stringValue(coreParam?.model),
    seed: numberValue(coreParam?.seed),
    imageRatio: numberValue(coreParam?.image_ratio),
    metadataEffectId: stringValue(metadata?.effect_id),
    metadataEffectType: stringValue(metadata?.effect_type),
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
