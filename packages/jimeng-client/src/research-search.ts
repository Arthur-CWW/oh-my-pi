import { createDecipheriv, createHash } from "node:crypto"
import { Schema } from "effect"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient } from "./client"
import { buildJimengEndpointProbeHeaders } from "./endpoint-probe"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { parseJsonText } from "./schema"

const DEFAULT_QUERY = "aid=513695&device_platform=web&region=CN&web_version=7.5.0&da_version=3.3.17"
const SEARCH_MEDIA_KEY = Buffer.from("9f2b4c7a65d1e3f827b5a3cfd4e9c1a0ff4b2d6e7a9c8b2f0d1e3f4c9a2b5d6c", "hex")
const OptionalString = Schema.optional(Schema.NullOr(Schema.String))
const OptionalNumber = Schema.optional(Schema.NullOr(Schema.Number))
const OptionalBoolean = Schema.optional(Schema.NullOr(Schema.Boolean))
const OptionalId = Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number])))

const SearchCommonAttrWireSchema = Schema.Struct({
  id: OptionalId,
  published_item_id: OptionalId,
  title: OptionalString,
  description: OptionalString,
  cover_uri: OptionalString,
  cover_url: OptionalString,
  cover_width: OptionalNumber,
  cover_height: OptionalNumber,
  effect_id: OptionalId,
  effect_type: OptionalNumber,
  create_time: OptionalNumber,
  update_time: OptionalNumber,
})

const SearchImageResourceWireSchema = Schema.Struct({
  image_uri: OptionalString,
  image_url: OptionalString,
  width: OptionalNumber,
  height: OptionalNumber,
  format: OptionalString,
})

const SearchImageWireSchema = Schema.Struct({
  large_images: Schema.optional(Schema.NullOr(Schema.Array(SearchImageResourceWireSchema))),
})

const SearchOriginVideoWireSchema = Schema.Struct({
  vid: OptionalString,
  video_id: OptionalString,
  video_url: OptionalString,
  cover_url: OptionalString,
  width: OptionalNumber,
  height: OptionalNumber,
  duration: OptionalNumber,
  duration_ms: OptionalNumber,
  fps: OptionalNumber,
  definition: OptionalString,
  format: OptionalString,
})

const SearchVideoWireSchema = Schema.Struct({
  video_id: OptionalString,
  cover_uri: OptionalString,
  cover_url: OptionalString,
  duration: OptionalNumber,
  duration_ms: OptionalNumber,
  has_audio: OptionalBoolean,
  is_mute: OptionalBoolean,
  origin_video: Schema.optional(Schema.NullOr(SearchOriginVideoWireSchema)),
  transcoded_video: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, SearchOriginVideoWireSchema))),
})

const SearchAuthorWireSchema = Schema.Struct({
  uid: OptionalId,
  sec_uid: OptionalString,
  name: OptionalString,
  avatar_url: OptionalString,
})

const SearchStatisticWireSchema = Schema.Struct({
  play_num: OptionalNumber,
  favorite_num: OptionalNumber,
  usage_num: OptionalNumber,
  comment_num: OptionalNumber,
  share_num: OptionalNumber,
})

const SearchSharingInfoWireSchema = Schema.Struct({
  hash_tags: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({
    id: OptionalId,
    tag_id: OptionalId,
    name: OptionalString,
  })))),
})

const SearchModelConfigWireSchema = Schema.Struct({
  model_req_key: OptionalString,
  model_name: OptionalString,
})

const SearchTextToImageParamsWireSchema = Schema.Struct({
  prompt: OptionalString,
  model_config: Schema.optional(Schema.NullOr(SearchModelConfigWireSchema)),
})

const SearchVideoInputWireSchema = Schema.Struct({
  prompt: OptionalString,
  first_frame_image: Schema.optional(Schema.NullOr(SearchImageResourceWireSchema)),
})

const SearchTextToVideoParamsWireSchema = Schema.Struct({
  model_req_key: OptionalString,
  model_config: Schema.optional(Schema.NullOr(SearchModelConfigWireSchema)),
  video_aspect_ratio: OptionalString,
  seed: OptionalNumber,
  video_gen_inputs: Schema.optional(Schema.NullOr(Schema.Array(SearchVideoInputWireSchema))),
})

const SearchAigcImageParamsWireSchema = Schema.Struct({
  generate_type: OptionalNumber,
  first_generate_type: OptionalNumber,
  image_type: OptionalNumber,
  reference_prompt: OptionalString,
  template_id: OptionalId,
  text2image_params: Schema.optional(Schema.NullOr(SearchTextToImageParamsWireSchema)),
  text2video_params: Schema.optional(Schema.NullOr(SearchTextToVideoParamsWireSchema)),
})

export const JimengResearchItemWireSchema = Schema.Struct({
  common_attr: SearchCommonAttrWireSchema,
  image: Schema.optional(Schema.NullOr(SearchImageWireSchema)),
  video: Schema.optional(Schema.NullOr(SearchVideoWireSchema)),
  author: Schema.optional(Schema.NullOr(SearchAuthorWireSchema)),
  statistic: Schema.optional(Schema.NullOr(SearchStatisticWireSchema)),
  sharing_info: Schema.optional(Schema.NullOr(SearchSharingInfoWireSchema)),
  aigc_image_params: Schema.optional(Schema.NullOr(SearchAigcImageParamsWireSchema)),
})

const SearchAssetMediaWireSchema = Schema.Struct({
  status: OptionalNumber,
  submit_id: OptionalString,
  history_record_id: OptionalId,
  workspace_id: OptionalNumber,
  generate_type: OptionalNumber,
  mode: OptionalString,
  item_list: Schema.optional(Schema.NullOr(Schema.Array(JimengResearchItemWireSchema))),
})

const SearchAssetWireSchema = Schema.Struct({
  id: OptionalId,
  uid: OptionalId,
  type: OptionalNumber,
  image: Schema.optional(Schema.NullOr(SearchAssetMediaWireSchema)),
  video: Schema.optional(Schema.NullOr(SearchAssetMediaWireSchema)),
  audio: Schema.optional(Schema.NullOr(SearchAssetMediaWireSchema)),
  story: Schema.optional(Schema.NullOr(SearchAssetMediaWireSchema)),
  canvas: Schema.optional(Schema.NullOr(SearchAssetMediaWireSchema)),
  canvas_project: Schema.optional(Schema.NullOr(SearchAssetMediaWireSchema)),
  document: Schema.optional(Schema.NullOr(SearchAssetMediaWireSchema)),
})

const SearchRowWireSchema = Schema.Struct({
  item: Schema.optional(Schema.NullOr(JimengResearchItemWireSchema)),
  asset: Schema.optional(Schema.NullOr(SearchAssetWireSchema)),
  rel_score: OptionalNumber,
  search_item_type: OptionalNumber,
})

const ResearchSearchEnvelopeSchema = Schema.Struct({
  ret: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
  errmsg: OptionalString,
  logid: OptionalString,
  log_id: OptionalString,
  cache_sync_token: OptionalString,
  data: Schema.Struct({
    data_list: Schema.Array(SearchRowWireSchema),
    search_id: Schema.String,
    has_more: Schema.Boolean,
    next_cursor: Schema.Number,
    can_search_deeper: OptionalBoolean,
  }),
})

export type JimengResearchItemWire = Schema.Schema.Type<typeof JimengResearchItemWireSchema>
type SearchAssetWire = Schema.Schema.Type<typeof SearchAssetWireSchema>
type SearchAssetMediaWire = Schema.Schema.Type<typeof SearchAssetMediaWireSchema>

export type JimengResearchSearchChannel = "inspiration" | "short-film" | "asset"
type JimengResearchSearchWireChannel = "inspiration" | "short_film" | "asset"
export type JimengResearchAssetType = "image" | "video" | "story" | "canvas" | "audio" | "document" | "canvas-project"

const ASSET_TYPE_IDS: Record<JimengResearchAssetType, number> = {
  image: 1,
  video: 2,
  story: 3,
  canvas: 4,
  audio: 6,
  document: 12,
  "canvas-project": 20,
}

export interface JimengResearchSearchQuery {
  channel: JimengResearchSearchChannel
  keyword?: string
  count?: number
  cursor?: number
  searchId?: string
  source?: string
  workspaceId?: number
  needIntentionMark?: boolean
  assetType?: JimengResearchAssetType | number
  blockIndex?: number
  onlyFavorited?: boolean
  showTypeList?: number[]
  isInsertFrame?: boolean
  hideStoryAgentResult?: boolean
  beginTimeStamp?: number
  endTimeStamp?: number
}

export interface JimengResearchSearchItem {
  id: string | null
  idWasUnsafeNumber: boolean
  title: string | null
  description: string | null
  prompt: string | null
  templateId: string | null
  modelReqKey: string | null
  modelName: string | null
  generateType: number | null
  firstGenerateType: number | null
  imageType: number | null
  videoAspectRatio: string | null
  seed: number | null
  firstFrameImageUri: string | null
  firstFrameImageUrl: string | null
  firstFrameImageWidth: number | null
  firstFrameImageHeight: number | null
  authorId: string | null
  authorIdWasUnsafeNumber: boolean
  authorName: string | null
  authorSecUid: string | null
  coverUri: string | null
  coverUrl: string | null
  coverWidth: number | null
  coverHeight: number | null
  imageUri: string | null
  imageUrl: string | null
  imageWidth: number | null
  imageHeight: number | null
  imageFormat: string | null
  videoId: string | null
  videoUrl: string | null
  videoCoverUrl: string | null
  videoWidth: number | null
  videoHeight: number | null
  videoDuration: number | null
  videoDurationMs: number | null
  videoFps: number | null
  videoDefinition: string | null
  videoFormat: string | null
  videoHasAudio: boolean | null
  videoIsMute: boolean | null
  playCount: number | null
  favoriteCount: number | null
  usageCount: number | null
  commentCount: number | null
  shareCount: number | null
  hashTags: string[]
}

export interface JimengResearchSearchAsset {
  id: string | null
  idWasUnsafeNumber: boolean
  uid: string | null
  uidWasUnsafeNumber: boolean
  assetType: number | null
  mediaKind: string | null
  status: number | null
  submitId: string | null
  historyRecordId: string | null
  historyRecordIdWasUnsafeNumber: boolean
  workspaceId: number | null
  generateType: number | null
  mode: string | null
  generatedItems: JimengResearchSearchItem[]
}

export interface JimengResearchSearchResult {
  endpoint: "/mweb/search/v1/search"
  channel: JimengResearchSearchChannel
  wireChannel: JimengResearchSearchWireChannel
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  searchId: string
  hasMore: boolean
  nextCursor: number
  canSearchDeeper: boolean | null
  logId: string | null
  cacheSyncTokenPresent: boolean
  decryptionApplied: boolean
  items: JimengResearchSearchItem[]
  assets: JimengResearchSearchAsset[]
  body: JsonValue
}

export function parseJimengResearchSearchChannel(value: string | undefined): JimengResearchSearchChannel {
  const normalized = value?.trim() || "inspiration"
  if (normalized === "inspiration" || normalized === "short-film" || normalized === "asset") return normalized
  throw jimengError({
    category: "validation",
    code: "RESEARCH_SEARCH_CHANNEL_INVALID",
    message: "research-search --channel must be inspiration, short-film, or asset.",
    retryable: false,
    details: { value: normalized },
  })
}

export function parseJimengResearchAssetType(value: string | number | undefined): JimengResearchAssetType | number {
  if (value === undefined || value === "") return "image"
  if (typeof value === "number") return normalizePositiveInteger(value, "RESEARCH_SEARCH_ASSET_TYPE_INVALID", "--assetType")
  const normalized = value.trim().toLowerCase()
  if (normalized in ASSET_TYPE_IDS) return normalized as JimengResearchAssetType
  const numeric = Number(normalized)
  if (Number.isInteger(numeric) && numeric > 0) return numeric
  throw jimengError({
    category: "validation",
    code: "RESEARCH_SEARCH_ASSET_TYPE_INVALID",
    message: "research-search --assetType must be image, video, story, canvas, audio, document, canvas-project, or a positive integer.",
    retryable: false,
    details: { value },
  })
}

export function parseJimengResearchShowTypeList(value: string | undefined): number[] | undefined {
  if (!value) return undefined
  const values = value.split(",").map((part) => Number(part.trim()))
  if (values.length === 0 || values.some((item) => !Number.isInteger(item) || item < 0)) {
    throw jimengError({
      category: "validation",
      code: "RESEARCH_SEARCH_SHOW_TYPE_INVALID",
      message: "research-search --showTypeList must be comma-separated non-negative integers.",
      retryable: false,
      details: { value },
    })
  }
  return Array.from(new Set(values))
}

export function buildJimengResearchSearchRequest(query: JimengResearchSearchQuery): JsonObject {
  const keyword = query.keyword?.trim() ?? ""
  const count = normalizeCount(query.count)
  const cursor = normalizeNonNegativeInteger(query.cursor ?? 0, "RESEARCH_SEARCH_CURSOR_INVALID", "--cursor")
  const source = query.source?.trim() || "search"
  const wireChannel = toWireChannel(query.channel)
  const request: JsonObject = {
    keyword,
    count,
    search_channel: wireChannel,
    cursor,
    source,
    image_info: {},
  }

  if (query.channel === "asset") {
    const assetType = query.assetType ?? "image"
    const assetTypeId = typeof assetType === "number" ? assetType : ASSET_TYPE_IDS[assetType]
    const condition: JsonObject = {
      asset_type: normalizePositiveInteger(assetTypeId, "RESEARCH_SEARCH_ASSET_TYPE_INVALID", "--assetType"),
      block_index: normalizeNonNegativeInteger(query.blockIndex ?? 0, "RESEARCH_SEARCH_BLOCK_INDEX_INVALID", "--blockIndex"),
    }
    if (query.onlyFavorited !== undefined) condition.only_favorited = query.onlyFavorited
    if (query.showTypeList?.length) condition.show_type_list = query.showTypeList
    if (query.isInsertFrame !== undefined) condition.is_insert_frame = query.isInsertFrame
    if (query.hideStoryAgentResult !== undefined) condition.hide_story_agent_result = query.hideStoryAgentResult
    if (query.beginTimeStamp !== undefined) condition.begin_time_stamp = normalizeNonNegativeNumber(query.beginTimeStamp, "RESEARCH_SEARCH_BEGIN_TIME_INVALID", "--beginTimeStamp")
    if (query.endTimeStamp !== undefined) condition.end_time_stamp = normalizeNonNegativeNumber(query.endTimeStamp, "RESEARCH_SEARCH_END_TIME_INVALID", "--endTimeStamp")
    request.search_id = query.searchId?.trim() ?? ""
    request.cond = condition
    request.workspace_id = normalizeWorkspaceId(query.workspaceId ?? 0)
    return request
  }

  request.pack_item_opt = {
    need_intention_mark: query.needIntentionMark ?? true,
  }
  if (query.searchId?.trim()) request.search_id = query.searchId.trim()
  if (query.workspaceId !== undefined) request.workspace_id = normalizeWorkspaceId(query.workspaceId)
  return request
}

export async function fetchJimengResearchSearch(input: {
  client?: JimengClient
  session: JimengSessionBundle
  query: JimengResearchSearchQuery
}): Promise<JimengResearchSearchResult> {
  const request = buildJimengResearchSearchRequest(input.query)
  const client = input.client ?? new JimengClient()
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/search/v1/search?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildJimengEndpointProbeHeaders(input.session),
    body: JSON.stringify(request),
  })
  const parsedBody = parseJsonText(response.text, "/mweb/search/v1/search")
  assertNoRiskError(parsedBody, response.text)
  const transformed = decryptJimengResearchSearchMedia(parsedBody)
  const decoded = decodeResearchSearchContract(transformed.body)
  assertJimengSuccess(decoded.ret, decoded.errmsg)

  const items: JimengResearchSearchItem[] = []
  const assets: JimengResearchSearchAsset[] = []
  for (const row of decoded.data.data_list) {
    if (row.item) items.push(normalizeJimengResearchItem(row.item))
    if (row.asset) assets.push(normalizeSearchAsset(row.asset))
  }
  if (input.query.channel === "asset" && decoded.data.data_list.length > 0 && assets.length === 0) {
    throw researchContractError("asset search rows did not include data.data_list[].asset")
  }
  if (input.query.channel !== "asset" && decoded.data.data_list.length > 0 && items.length === 0) {
    throw researchContractError("inspiration/short-film search rows did not include data.data_list[].item")
  }

  return {
    endpoint: "/mweb/search/v1/search",
    channel: input.query.channel,
    wireChannel: toWireChannel(input.query.channel),
    httpStatus: response.status,
    ret: decoded.ret ?? null,
    errmsg: decoded.errmsg ?? null,
    responseTextSha256: sha256(response.text),
    request,
    searchId: decoded.data.search_id,
    hasMore: decoded.data.has_more,
    nextCursor: decoded.data.next_cursor,
    canSearchDeeper: decoded.data.can_search_deeper ?? null,
    logId: decoded.logid ?? decoded.log_id ?? null,
    cacheSyncTokenPresent: !!decoded.cache_sync_token,
    decryptionApplied: transformed.decryptionApplied,
    items,
    assets,
    body: transformed.body,
  }
}

export function summarizeJimengResearchSearch(result: JimengResearchSearchResult): JsonObject {
  return {
    endpoint: result.endpoint,
    channel: result.channel,
    wire_channel: result.wireChannel,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    search_id: result.searchId,
    has_more: result.hasMore,
    next_cursor: result.nextCursor,
    can_search_deeper: result.canSearchDeeper,
    log_id: result.logId,
    cache_sync_token_present: result.cacheSyncTokenPresent,
    decryption_applied: result.decryptionApplied,
    item_count: result.items.length,
    asset_count: result.assets.length,
    items: result.items.map(summarizeJimengResearchItem),
    assets: result.assets.map((asset) => ({
      id: asset.id,
      id_was_unsafe_number: asset.idWasUnsafeNumber,
      uid: asset.uid,
      uid_was_unsafe_number: asset.uidWasUnsafeNumber,
      asset_type: asset.assetType,
      media_kind: asset.mediaKind,
      status: asset.status,
      submit_id: asset.submitId,
      history_record_id: asset.historyRecordId,
      history_record_id_was_unsafe_number: asset.historyRecordIdWasUnsafeNumber,
      workspace_id: asset.workspaceId,
      generate_type: asset.generateType,
      mode: asset.mode,
      generated_item_count: asset.generatedItems.length,
      generated_items: asset.generatedItems.map(summarizeJimengResearchItem),
    })),
  }
}

export function decryptJimengResearchSearchMedia(body: JsonValue): {
  body: JsonValue
  decryptionApplied: boolean
} {
  const clone = structuredClone(body)
  const root = asRecord(clone)
  const cacheSyncToken = stringValue(root?.cache_sync_token)
  if (!cacheSyncToken) return { body: clone, decryptionApplied: false }
  const logId = stringValue(root?.logid) ?? stringValue(root?.log_id)
  if (!logId) throw researchContractError("encrypted search response omitted logid/log_id")
  const responseIv = decodeHexIv(logId, "search log id")
  const mediaIvHex = decryptAesCbc(cacheSyncToken, responseIv, "hex")
  const mediaIv = decodeHexIv(mediaIvHex, "search cache sync token")
  const rows = asArray(asRecord(root?.data)?.data_list)
  for (const rowValue of rows) {
    const row = asRecord(rowValue)
    decryptSearchItem(asRecord(row?.item), mediaIv)
    decryptSearchAsset(asRecord(row?.asset), mediaIv)
  }
  return { body: clone, decryptionApplied: true }
}

function decryptSearchAsset(asset: JsonObject | null, iv: Buffer): void {
  if (!asset) return
  for (const key of ["image", "video", "audio", "story", "canvas", "canvas_project", "document"]) {
    const media = asRecord(asset[key])
    for (const item of asArray(media?.item_list)) decryptSearchItem(asRecord(item), iv)
  }
}

function decryptSearchItem(item: JsonObject | null, iv: Buffer): void {
  if (!item) return
  decryptStringField(asRecord(item.common_attr), "cover_url", iv)
  const coverMap = asRecord(asRecord(item.common_attr)?.cover_url_map)
  if (coverMap) {
    for (const key of Object.keys(coverMap)) decryptStringField(coverMap, key, iv)
  }
  const itemUrls = asArray(asRecord(item.common_attr)?.item_urls)
  for (let index = 0; index < itemUrls.length; index += 1) {
    const value = itemUrls[index]
    if (typeof value === "string" && value && !value.startsWith("https://")) itemUrls[index] = decryptAesCbc(value, iv, "utf8")
  }
  for (const image of asArray(asRecord(item.image)?.large_images)) decryptStringField(asRecord(image), "image_url", iv)
  const video = asRecord(item.video)
  decryptStringField(video, "cover_url", iv)
  const originVideo = asRecord(video?.origin_video)
  decryptStringField(originVideo, "video_url", iv)
  decryptStringField(originVideo, "cover_url", iv)
  const transcoded = asRecord(video?.transcoded_video)
  if (transcoded) {
    for (const value of Object.values(transcoded)) {
      const rendition = asRecord(value)
      decryptStringField(rendition, "video_url", iv)
      decryptStringField(rendition, "cover_url", iv)
    }
  }
  decryptStringField(asRecord(item.author), "avatar_url", iv)
}

function decryptStringField(record: JsonObject | null, key: string, iv: Buffer): void {
  if (!record) return
  const value = record[key]
  if (typeof value !== "string" || !value || value.startsWith("https://")) return
  record[key] = decryptAesCbc(value, iv, "utf8")
}

function decryptAesCbc(value: string, iv: Buffer, outputEncoding: "hex" | "utf8"): string {
  try {
    const decipher = createDecipheriv("aes-256-cbc", SEARCH_MEDIA_KEY, iv)
    return Buffer.concat([decipher.update(Buffer.from(value, "base64")), decipher.final()]).toString(outputEncoding)
  } catch (error) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_RESEARCH_SEARCH_DECRYPT_FAILED",
      message: "Jimeng research search media decryption failed.",
      retryable: false,
      details: { error: error instanceof Error ? error.message : String(error) },
    })
  }
}

function decodeHexIv(value: string, operation: string): Buffer {
  if (!/^[0-9a-f]{32}$/i.test(value)) {
    throw researchContractError(`${operation} did not decode to a 16-byte hex IV`)
  }
  return Buffer.from(value, "hex")
}

export function normalizeJimengResearchItem(item: JimengResearchItemWire): JimengResearchSearchItem {
  const id = normalizeId(item.common_attr.published_item_id ?? item.common_attr.id)
  const authorId = normalizeId(item.author?.uid)
  const templateId = normalizeId(item.aigc_image_params?.template_id)
  const firstImage = item.image?.large_images?.[0]
  const originVideo = item.video?.origin_video ?? firstVideoRendition(item.video?.transcoded_video)
  const textToImage = item.aigc_image_params?.text2image_params
  const textToVideo = item.aigc_image_params?.text2video_params
  const firstVideoInput = textToVideo?.video_gen_inputs?.[0]
  const firstFrameImage = firstVideoInput?.first_frame_image
  return {
    id: id.value,
    idWasUnsafeNumber: id.unsafe,
    title: cleanString(item.common_attr.title),
    description: cleanString(item.common_attr.description),
    prompt: cleanString(textToImage?.prompt) ?? cleanString(firstVideoInput?.prompt) ?? cleanString(item.aigc_image_params?.reference_prompt),
    templateId: templateId.value,
    modelReqKey: cleanString(textToImage?.model_config?.model_req_key)
      ?? cleanString(textToVideo?.model_req_key)
      ?? cleanString(textToVideo?.model_config?.model_req_key),
    modelName: cleanString(textToImage?.model_config?.model_name) ?? cleanString(textToVideo?.model_config?.model_name),
    generateType: finiteNumber(item.aigc_image_params?.generate_type),
    firstGenerateType: finiteNumber(item.aigc_image_params?.first_generate_type),
    imageType: finiteNumber(item.aigc_image_params?.image_type),
    videoAspectRatio: cleanString(textToVideo?.video_aspect_ratio),
    seed: finiteNumber(textToVideo?.seed),
    firstFrameImageUri: cleanString(firstFrameImage?.image_uri),
    firstFrameImageUrl: cleanString(firstFrameImage?.image_url),
    firstFrameImageWidth: finiteNumber(firstFrameImage?.width),
    firstFrameImageHeight: finiteNumber(firstFrameImage?.height),
    authorId: authorId.value,
    authorIdWasUnsafeNumber: authorId.unsafe,
    authorName: cleanString(item.author?.name),
    authorSecUid: cleanString(item.author?.sec_uid),
    coverUri: cleanString(item.common_attr.cover_uri) ?? cleanString(item.video?.cover_uri),
    coverUrl: cleanString(item.common_attr.cover_url) ?? cleanString(item.video?.cover_url),
    coverWidth: finiteNumber(item.common_attr.cover_width),
    coverHeight: finiteNumber(item.common_attr.cover_height),
    imageUri: cleanString(firstImage?.image_uri),
    imageUrl: cleanString(firstImage?.image_url),
    imageWidth: finiteNumber(firstImage?.width),
    imageHeight: finiteNumber(firstImage?.height),
    imageFormat: cleanString(firstImage?.format),
    videoId: cleanString(originVideo?.vid) ?? cleanString(originVideo?.video_id) ?? cleanString(item.video?.video_id),
    videoUrl: cleanString(originVideo?.video_url),
    videoCoverUrl: cleanString(originVideo?.cover_url),
    videoWidth: finiteNumber(originVideo?.width),
    videoHeight: finiteNumber(originVideo?.height),
    videoDuration: finiteNumber(originVideo?.duration) ?? finiteNumber(item.video?.duration),
    videoDurationMs: finiteNumber(originVideo?.duration_ms) ?? finiteNumber(item.video?.duration_ms),
    videoFps: finiteNumber(originVideo?.fps),
    videoDefinition: cleanString(originVideo?.definition),
    videoFormat: cleanString(originVideo?.format),
    videoHasAudio: booleanValue(item.video?.has_audio),
    videoIsMute: booleanValue(item.video?.is_mute),
    playCount: finiteNumber(item.statistic?.play_num),
    favoriteCount: finiteNumber(item.statistic?.favorite_num),
    usageCount: finiteNumber(item.statistic?.usage_num),
    commentCount: finiteNumber(item.statistic?.comment_num),
    shareCount: finiteNumber(item.statistic?.share_num),
    hashTags: item.sharing_info?.hash_tags?.flatMap((tag) => cleanString(tag.name) ? [cleanString(tag.name)!] : []) ?? [],
  }
}

function normalizeSearchAsset(asset: SearchAssetWire): JimengResearchSearchAsset {
  const id = normalizeId(asset.id)
  const uid = normalizeId(asset.uid)
  const mediaEntry = firstAssetMedia(asset)
  const historyRecordId = normalizeId(mediaEntry.media?.history_record_id)
  return {
    id: id.value,
    idWasUnsafeNumber: id.unsafe,
    uid: uid.value,
    uidWasUnsafeNumber: uid.unsafe,
    assetType: finiteNumber(asset.type),
    mediaKind: mediaEntry.kind,
    status: finiteNumber(mediaEntry.media?.status),
    submitId: cleanString(mediaEntry.media?.submit_id),
    historyRecordId: historyRecordId.value,
    historyRecordIdWasUnsafeNumber: historyRecordId.unsafe,
    workspaceId: finiteNumber(mediaEntry.media?.workspace_id),
    generateType: finiteNumber(mediaEntry.media?.generate_type),
    mode: cleanString(mediaEntry.media?.mode),
    generatedItems: mediaEntry.media?.item_list?.map(normalizeJimengResearchItem) ?? [],
  }
}

function firstAssetMedia(asset: SearchAssetWire): { kind: string | null; media: SearchAssetMediaWire | null } {
  const candidates: Array<[string, SearchAssetMediaWire | null | undefined]> = [
    ["image", asset.image],
    ["video", asset.video],
    ["audio", asset.audio],
    ["story", asset.story],
    ["canvas", asset.canvas],
    ["canvas-project", asset.canvas_project],
    ["document", asset.document],
  ]
  const found = candidates.find((entry) => !!entry[1])
  return found ? { kind: found[0], media: found[1] ?? null } : { kind: null, media: null }
}

export function summarizeJimengResearchItem(item: JimengResearchSearchItem): JsonObject {
  return {
    id: item.id,
    id_was_unsafe_number: item.idWasUnsafeNumber,
    title: item.title,
    description: item.description,
    prompt: item.prompt,
    template_id: item.templateId,
    model_req_key: item.modelReqKey,
    model_name: item.modelName,
    generate_type: item.generateType,
    first_generate_type: item.firstGenerateType,
    image_type: item.imageType,
    video_aspect_ratio: item.videoAspectRatio,
    seed: item.seed,
    first_frame_image_uri: item.firstFrameImageUri,
    first_frame_image_url_present: !!item.firstFrameImageUrl,
    first_frame_image_width: item.firstFrameImageWidth,
    first_frame_image_height: item.firstFrameImageHeight,
    author_id: item.authorId,
    author_id_was_unsafe_number: item.authorIdWasUnsafeNumber,
    author_name: item.authorName,
    author_sec_uid: item.authorSecUid,
    cover_uri: item.coverUri,
    cover_url_present: !!item.coverUrl,
    cover_width: item.coverWidth,
    cover_height: item.coverHeight,
    image_uri: item.imageUri,
    image_url_present: !!item.imageUrl,
    image_width: item.imageWidth,
    image_height: item.imageHeight,
    image_format: item.imageFormat,
    video_id: item.videoId,
    video_url_present: !!item.videoUrl,
    video_cover_url_present: !!item.videoCoverUrl,
    video_width: item.videoWidth,
    video_height: item.videoHeight,
    video_duration: item.videoDuration,
    video_duration_ms: item.videoDurationMs,
    video_fps: item.videoFps,
    video_definition: item.videoDefinition,
    video_format: item.videoFormat,
    video_has_audio: item.videoHasAudio,
    video_is_mute: item.videoIsMute,
    play_count: item.playCount,
    favorite_count: item.favoriteCount,
    usage_count: item.usageCount,
    comment_count: item.commentCount,
    share_count: item.shareCount,
    hash_tags: item.hashTags,
  }
}

function firstVideoRendition(
  renditions: Record<string, Schema.Schema.Type<typeof SearchOriginVideoWireSchema>> | null | undefined,
): Schema.Schema.Type<typeof SearchOriginVideoWireSchema> | null {
  if (!renditions) return null
  return renditions.origin ?? Object.values(renditions)[0] ?? null
}

function decodeResearchSearchContract(value: JsonValue): Schema.Schema.Type<typeof ResearchSearchEnvelopeSchema> {
  try {
    return Schema.decodeUnknownSync(ResearchSearchEnvelopeSchema)(value)
  } catch (error) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_RESEARCH_SEARCH_CONTRACT_CHANGED",
      message: "Jimeng research search response did not match required fields.",
      retryable: false,
      details: { error: error instanceof Error ? error.message : String(error) },
    })
  }
}

function assertJimengSuccess(
  ret: string | number | null | undefined,
  errmsg: string | null | undefined,
): void {
  if (ret === undefined || ret === null || ret === "0" || ret === 0) return
  throw jimengError({
    category: "upstream",
    code: "JIMENG_RESPONSE_RET_NONZERO",
    message: `/mweb/search/v1/search returned ret=${String(ret)} errmsg=${errmsg ?? "unknown"}.`,
    retryable: false,
    details: { ret, errmsg: errmsg ?? null },
  })
}

function researchContractError(message: string): ReturnType<typeof jimengError> {
  return jimengError({
    category: "upstream",
    code: "JIMENG_RESEARCH_SEARCH_CONTRACT_CHANGED",
    message,
    retryable: false,
  })
}

function toWireChannel(channel: JimengResearchSearchChannel): JimengResearchSearchWireChannel {
  return channel === "short-film" ? "short_film" : channel
}

function normalizeCount(value = 20): number {
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw jimengError({
      category: "validation",
      code: "RESEARCH_SEARCH_COUNT_INVALID",
      message: "research-search --limit must be an integer from 1 to 50.",
      retryable: false,
      details: { value },
    })
  }
  return value
}

function normalizeWorkspaceId(value: number): number {
  return normalizeNonNegativeInteger(value, "RESEARCH_SEARCH_WORKSPACE_INVALID", "--workspaceId")
}

function normalizePositiveInteger(value: number, code: string, flag: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw jimengError({
      category: "validation",
      code,
      message: `research-search ${flag} must be a positive integer.`,
      retryable: false,
      details: { value },
    })
  }
  return value
}

function normalizeNonNegativeInteger(value: number, code: string, flag: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw jimengError({
      category: "validation",
      code,
      message: `research-search ${flag} must be a non-negative integer.`,
      retryable: false,
      details: { value },
    })
  }
  return value
}

function normalizeNonNegativeNumber(value: number, code: string, flag: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw jimengError({
      category: "validation",
      code,
      message: `research-search ${flag} must be a non-negative number.`,
      retryable: false,
      details: { value },
    })
  }
  return value
}

function normalizeId(value: string | number | null | undefined): { value: string | null; unsafe: boolean } {
  if (typeof value === "string" && value.length > 0) return { value, unsafe: false }
  if (typeof value === "number" && Number.isSafeInteger(value)) return { value: String(value), unsafe: false }
  return { value: null, unsafe: typeof value === "number" && Number.isFinite(value) }
}

function cleanString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanValue(value: boolean | null | undefined): boolean | null {
  return typeof value === "boolean" ? value : null
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function asRecord(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : []
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
