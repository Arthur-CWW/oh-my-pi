import { createHash } from "node:crypto"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient, type JimengFetch } from "./client"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue, parseImageUri } from "./reference-image"

const DEFAULT_QUERY = "aid=513695&web_version=7.5.0&da_version=3.3.17&aigc_features=app_lip_sync"

export type JimengObjectSegmentationMode = "canvas" | "default"
export type JimengObjectSegmentationCommandMode = JimengObjectSegmentationMode | "both"

export interface JimengObjectSegmentationMask {
  maskUri: string | null
  maskUrl: string | null
  bbox: number[]
  score: number | null
  label: string | null
}

export interface JimengObjectSegmentationResult {
  endpoint: "/mweb/v1/saliency_seg"
  imageUri: string
  mode: JimengObjectSegmentationMode
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  masks: JimengObjectSegmentationMask[]
  body: JsonValue
}

export function parseJimengObjectSegmentationCommandMode(value: string | undefined): JimengObjectSegmentationCommandMode {
  const normalized = (value ?? "both").trim().toLowerCase()
  if (normalized === "canvas" || normalized === "default" || normalized === "both") return normalized
  throw jimengError({
    category: "validation",
    code: "OBJECT_SEGMENTATION_MODE_INVALID",
    message: "--mode must be canvas, default, or both.",
    retryable: false,
    details: { mode: value ?? null },
  })
}

export function jimengObjectSegmentationModes(mode: JimengObjectSegmentationCommandMode): JimengObjectSegmentationMode[] {
  return mode === "both" ? ["canvas", "default"] : [mode]
}

export function buildJimengObjectSegmentationRequest(input: {
  imageUri: string
  mode: JimengObjectSegmentationMode
}): JsonObject {
  const imageUri = parseImageUri(input.imageUri)
  return input.mode === "canvas"
    ? { image_uri_list: [imageUri], mode: "canvas" }
    : { image_uri_list: [imageUri] }
}

export async function segmentJimengObject(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  imageUri: string
  mode: JimengObjectSegmentationMode
  babiParam?: JsonObject
}): Promise<JimengObjectSegmentationResult> {
  const imageUri = parseImageUri(input.imageUri)
  const request = buildJimengObjectSegmentationRequest({ imageUri, mode: input.mode })
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const response = await client.requestText(buildObjectSegmentationUrl(input.babiParam), {
    method: "POST",
    headers: buildObjectSegmentationHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSegmentationSuccess(body)

  return {
    endpoint: "/mweb/v1/saliency_seg",
    imageUri,
    mode: input.mode,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    masks: objectSegmentationMasksValue(body),
    body,
  }
}

export function defaultObjectSegmentationBabiParam(): JsonObject {
  return {
    scenario: "image_video_generation",
    feature_key: "to_image_referenceimage",
    feature_entrance: "browser_proxy_cli",
    feature_entrance_detail: "browser_proxy_cli-referenceimage-object_detection",
  }
}

export function summarizeObjectSegmentation(results: JimengObjectSegmentationResult[]): JsonObject {
  return {
    image_uri: results[0]?.imageUri ?? null,
    modes: results.map((result) => ({
      mode: result.mode,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      mask_count: result.masks.length,
      masks: result.masks.map((mask) => ({
        mask_uri: mask.maskUri,
        mask_url_present: !!mask.maskUrl,
        bbox: mask.bbox,
        score: mask.score,
        label: mask.label,
      })),
    })),
  }
}

function buildObjectSegmentationUrl(babiParam: JsonObject | undefined): string {
  const params = new URLSearchParams(DEFAULT_QUERY)
  if (babiParam) params.set("babi_param", JSON.stringify(babiParam))
  return `https://jimeng.jianying.com/mweb/v1/saliency_seg?${params.toString()}`
}

function buildObjectSegmentationHeaders(session: JimengSessionBundle): Record<string, string> {
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

function assertJimengSegmentationSuccess(body: JsonValue): void {
  const ret = retValue(body)
  if (ret === "0" || ret === 0) return
  const code = Number(ret)
  throw jimengError({
    category: "upstream",
    code: code === 2046 ? "JIMENG_SEGMENT_NO_OBJECT" : code === 2047 ? "JIMENG_SEGMENT_FAILED" : "JIMENG_API_REJECTED",
    message: `object segmentation failed (ret=${String(ret ?? "unknown")}, errmsg=${errmsgValue(body) ?? "unknown"})`,
    retryable: false,
    details: { ret, errmsg: errmsgValue(body) },
  })
}

function objectSegmentationMasksValue(body: JsonValue): JimengObjectSegmentationMask[] {
  const root = asRecord(body)
  const rawData = root?.data ?? body
  const data = asRecord(rawData)
  const candidates = [
    Array.isArray(rawData) ? rawData : [],
    asArray(data?.mask_list),
    asArray(data?.maskList),
    asArray(data?.masks),
    asArray(data?.value),
    asArray(data?.result),
    data?.mask ? [data] : [],
  ].find((entries) => entries.length > 0) ?? []

  return candidates.map(parseObjectSegmentationMask).filter((mask): mask is JimengObjectSegmentationMask => !!mask)
}

function parseObjectSegmentationMask(value: JsonValue): JimengObjectSegmentationMask | null {
  const entry = asRecord(value)
  if (!entry) return null
  const mask = asRecord(entry.mask) ?? entry
  const maskUri = stringValue(mask.mask_uri)
    ?? stringValue(mask.maskUri)
    ?? stringValue(mask.image_uri)
    ?? stringValue(mask.imageUri)
    ?? stringValue(mask.uri)
  const maskUrl = stringValue(mask.mask_url)
    ?? stringValue(mask.maskUrl)
    ?? stringValue(mask.image_url)
    ?? stringValue(mask.imageUrl)
    ?? stringValue(mask.url)
  if (!maskUri && !maskUrl) return null
  return {
    maskUri,
    maskUrl,
    bbox: numberArray(entry.bbox ?? entry.box ?? entry.rect ?? mask.bbox ?? mask.box ?? mask.rect),
    score: numberValue(entry.score) ?? numberValue(entry.confidence) ?? numberValue(mask.score),
    label: stringValue(entry.label) ?? stringValue(entry.name) ?? stringValue(mask.label) ?? stringValue(mask.name),
  }
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

function numberArray(value: JsonValue | undefined): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => typeof entry === "number" ? entry : Number(entry))
    .filter((entry) => Number.isFinite(entry))
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
