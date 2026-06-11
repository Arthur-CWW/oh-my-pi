import { createHash } from "node:crypto"
import { z } from "zod"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient, type JimengFetch } from "./client"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { parseJimengApiEnvelope, parseJimengContract, parseJsonText } from "./schema"

const DEFAULT_QUERY = "aid=513695&web_version=7.5.0&da_version=3.3.17&aigc_features=app_lip_sync"
const OptionalString = z.string().nullable().optional()
const OptionalNumber = z.number().nullable().optional()

const VideoAssetWireSchema = z.object({
  vid: OptionalString,
  video_id: OptionalString,
  videoId: OptionalString,
  fps: OptionalNumber,
  width: OptionalNumber,
  height: OptionalNumber,
  duration: OptionalNumber,
  video_url: OptionalString,
  videoUrl: OptionalString,
  cover_url: OptionalString,
  coverUrl: OptionalString,
  format: OptionalString,
  definition: OptionalString,
  logo_type: OptionalString,
  logoType: OptionalString,
  encryption_key: OptionalString,
  encryptionKey: OptionalString,
  md5: OptionalString,
  size: OptionalNumber,
}).passthrough()

const VideoRecordWireSchema = z.object({
  origin_video: VideoAssetWireSchema.nullable().optional(),
  originVideo: VideoAssetWireSchema.nullable().optional(),
  transcoded_video: z.record(z.string(), VideoAssetWireSchema).nullable().optional(),
  transcodedVideo: z.record(z.string(), VideoAssetWireSchema).nullable().optional(),
}).passthrough()

const VideoInfoBodySchema = z.object({
  vid2video: z.record(z.string(), VideoRecordWireSchema).nullable().optional(),
  vid2Video: z.record(z.string(), VideoRecordWireSchema).nullable().optional(),
}).passthrough()

export interface JimengVideoInfoQuery {
  vids: string[]
}

export interface JimengVideoVariant {
  definition: string
  vid: string | null
  videoId: string | null
  durationSec: number | null
  width: number | null
  height: number | null
  fps: number | null
  format: string | null
  logoType: string | null
  md5: string | null
  sizeBytes: number | null
  videoUrlPresent: boolean
  coverUrlPresent: boolean
}

export interface JimengVideoInfoItem {
  lookupVid: string
  vid: string | null
  videoId: string | null
  durationSec: number | null
  width: number | null
  height: number | null
  fps: number | null
  format: string | null
  definition: string | null
  logoType: string | null
  md5: string | null
  sizeBytes: number | null
  videoUrlPresent: boolean
  coverUrlPresent: boolean
  transcodedDefinitions: string[]
  variants: JimengVideoVariant[]
}

export interface JimengVideoInfoResult {
  endpoint: "/mweb/v1/get_video_by_vid"
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  videos: JimengVideoInfoItem[]
  body: JsonValue
}

export function buildJimengVideoInfoRequest(query: JimengVideoInfoQuery): JsonObject {
  const vids = normalizeVids(query.vids)
  if (vids.length === 0) {
    throw jimengError({
      category: "validation",
      code: "VIDEO_INFO_VIDS_REQUIRED",
      message: "At least one video vid is required.",
      retryable: false,
    })
  }
  return { vids }
}

export async function fetchJimengVideoInfo(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  query: JimengVideoInfoQuery
}): Promise<JimengVideoInfoResult> {
  const request = buildJimengVideoInfoRequest(input.query)
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const response = await client.requestText(buildVideoInfoUrl(), {
    method: "POST",
    headers: buildVideoInfoHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = parseJsonText(response.text, "video info")
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "video info")

  return {
    endpoint: "/mweb/v1/get_video_by_vid",
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    videos: parseJimengVideoInfoBody(body),
    body,
  }
}

export function parseJimengVideoInfoBody(body: JsonValue): JimengVideoInfoItem[] {
  const parsed = parseJimengContract(VideoInfoBodySchema, body, "video info")
  const records = asRecord(parsed.vid2video as JsonValue) ?? asRecord(parsed.vid2Video as JsonValue) ?? {}
  return Object.entries(records)
    .map(([lookupVid, value]) => parseVideoInfoItem(lookupVid, value as JsonValue))
    .filter((item): item is JimengVideoInfoItem => !!item)
}

export function summarizeJimengVideoInfo(result: JimengVideoInfoResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    video_count: result.videos.length,
    videos: result.videos.slice(0, 20).map((video) => ({
      lookup_vid: video.lookupVid,
      vid: video.vid,
      video_id: video.videoId,
      duration_sec: video.durationSec,
      width: video.width,
      height: video.height,
      fps: video.fps,
      format: video.format,
      definition: video.definition,
      logo_type: video.logoType,
      md5: video.md5,
      size_bytes: video.sizeBytes,
      video_url_present: video.videoUrlPresent,
      cover_url_present: video.coverUrlPresent,
      transcoded_definitions: video.transcodedDefinitions,
      variants: video.variants.map((variant) => ({
        definition: variant.definition,
        vid: variant.vid,
        video_id: variant.videoId,
        duration_sec: variant.durationSec,
        width: variant.width,
        height: variant.height,
        fps: variant.fps,
        format: variant.format,
        logo_type: variant.logoType,
        md5: variant.md5,
        size_bytes: variant.sizeBytes,
        video_url_present: variant.videoUrlPresent,
        cover_url_present: variant.coverUrlPresent,
      })),
    })),
  }
}

export function parseJimengVidCsvFlag(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  return normalizeVids(value.split(",").map((item) => item.trim()).filter(Boolean))
}

function parseVideoInfoItem(lookupVid: string, value: JsonValue): JimengVideoInfoItem | null {
  const record = asRecord(value)
  if (!record) return null
  const origin = asRecord(record.origin_video) ?? asRecord(record.originVideo)
  const transcoded = asRecord(record.transcoded_video) ?? asRecord(record.transcodedVideo) ?? {}
  const variants = Object.entries(transcoded)
    .map(([definition, variant]) => parseVideoVariant(definition, variant as JsonValue))
    .filter((variant): variant is JimengVideoVariant => !!variant)

  return {
    lookupVid,
    vid: stringValue(origin?.vid) ?? lookupVid,
    videoId: stringValue(origin?.video_id) ?? stringValue(origin?.videoId) ?? stringValue(origin?.vid) ?? lookupVid,
    durationSec: numberValue(origin?.duration),
    width: numberValue(origin?.width),
    height: numberValue(origin?.height),
    fps: numberValue(origin?.fps),
    format: stringValue(origin?.format),
    definition: stringValue(origin?.definition),
    logoType: stringValue(origin?.logo_type) ?? stringValue(origin?.logoType),
    md5: stringValue(origin?.md5),
    sizeBytes: numberValue(origin?.size),
    videoUrlPresent: !!(stringValue(origin?.video_url) ?? stringValue(origin?.videoUrl)),
    coverUrlPresent: !!(stringValue(origin?.cover_url) ?? stringValue(origin?.coverUrl)),
    transcodedDefinitions: Object.keys(transcoded).sort(),
    variants,
  }
}

function parseVideoVariant(definition: string, value: JsonValue): JimengVideoVariant | null {
  const variant = asRecord(value)
  if (!variant) return null
  return {
    definition,
    vid: stringValue(variant.vid),
    videoId: stringValue(variant.video_id) ?? stringValue(variant.videoId) ?? stringValue(variant.vid),
    durationSec: numberValue(variant.duration),
    width: numberValue(variant.width),
    height: numberValue(variant.height),
    fps: numberValue(variant.fps),
    format: stringValue(variant.format),
    logoType: stringValue(variant.logo_type) ?? stringValue(variant.logoType),
    md5: stringValue(variant.md5),
    sizeBytes: numberValue(variant.size),
    videoUrlPresent: !!(stringValue(variant.video_url) ?? stringValue(variant.videoUrl)),
    coverUrlPresent: !!(stringValue(variant.cover_url) ?? stringValue(variant.coverUrl)),
  }
}

function normalizeVids(values: string[] | undefined): string[] {
  const normalized = (values ?? []).map((value) => value.trim()).filter(Boolean)
  const seen = new Set<string>()
  for (const value of normalized) {
    if (!/^[0-9A-Za-z_-]+$/.test(value)) {
      throw jimengError({
        category: "validation",
        code: "VIDEO_INFO_VID_INVALID",
        message: "Vids must be non-empty strings containing letters, numbers, underscores, or hyphens.",
        retryable: false,
        details: { vid: value },
      })
    }
    seen.add(value)
  }
  return [...seen]
}

function buildVideoInfoHeaders(session: JimengSessionBundle): Record<string, string> {
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

function buildVideoInfoUrl(): string {
  const params = new URLSearchParams(DEFAULT_QUERY)
  params.set("device_platform", "web")
  params.set("region", "CN")
  return `https://jimeng.jianying.com/mweb/v1/get_video_by_vid?${params.toString()}`
}

function assertJimengSuccess(body: JsonValue, operation: string): void {
  const envelope = parseJimengApiEnvelope(body, operation)
  const ret = envelope.ret ?? null
  if (ret === "0" || ret === 0) return
  throw jimengError({
    category: "upstream",
    code: "JIMENG_API_REJECTED",
    message: `${operation} failed (ret=${String(ret ?? "missing")}, errmsg=${envelope.errmsg ?? "missing"})`,
    retryable: false,
    details: { ret, errmsg: envelope.errmsg ?? null },
  })
}

function retValue(body: JsonValue): string | number | null {
  const value = asRecord(body)?.ret
  return typeof value === "string" || typeof value === "number" ? value : null
}

function errmsgValue(body: JsonValue): string | null {
  return stringValue(asRecord(body)?.errmsg)
}

function asRecord(value: JsonValue | undefined): JsonObject | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value : null
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
