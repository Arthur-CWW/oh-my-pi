import { createHash } from "node:crypto"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient, type JimengFetch } from "./client"
import { jimengError } from "./errors"

const DEFAULT_QUERY = "aid=513695&web_version=7.5.0&da_version=3.3.17&aigc_features=app_lip_sync"

type JsonScalar = string | number | boolean | null
export type JsonValue = JsonScalar | JsonValue[] | JsonObject
export interface JsonObject {
  [key: string]: JsonValue
}

export interface JimengImageDescriptionResult {
  endpoint: "/mweb/v1/get_image_description"
  imageUri: string
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  description: string | null
  body: JsonValue
}

export interface JimengFaceRecognizeResult {
  endpoint: "/mweb/v1/face_recognize"
  imageUri: string
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  faces: JimengRecognizedFace[]
  body: JsonValue
}

export interface JimengRecognizedFace {
  faceKey: string | null
  faceRect: number[]
  keypoint: number[]
  score: number | null
  label: string | null
}

export interface JimengReferenceImageInspectionResult {
  imageUri: string
  description: JimengImageDescriptionResult | null
  faceRecognition: JimengFaceRecognizeResult | null
}

export function buildJimengImageDescriptionRequest(input: { imageUri: string }): JsonObject {
  return { file_uri: parseImageUri(input.imageUri) }
}

export function buildJimengFaceRecognizeRequest(input: { imageUri: string }): JsonObject {
  return { image_uri_list: [parseImageUri(input.imageUri)] }
}

export async function describeJimengImage(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  imageUri: string
  babiParam?: JsonObject
}): Promise<JimengImageDescriptionResult> {
  const imageUri = parseImageUri(input.imageUri)
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const request = buildJimengImageDescriptionRequest({ imageUri })
  const response = await client.requestText(buildReferenceImageUrl("/mweb/v1/get_image_description", input.babiParam), {
    method: "POST",
    headers: buildReferenceImageHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "image description")

  return {
    endpoint: "/mweb/v1/get_image_description",
    imageUri,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    description: descriptionValue(body),
    body,
  }
}

export async function recognizeJimengImageFaces(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  imageUri: string
  babiParam?: JsonObject
}): Promise<JimengFaceRecognizeResult> {
  const imageUri = parseImageUri(input.imageUri)
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const request = buildJimengFaceRecognizeRequest({ imageUri })
  const response = await client.requestText(buildReferenceImageUrl("/mweb/v1/face_recognize", input.babiParam), {
    method: "POST",
    headers: buildReferenceImageHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "face recognition")

  return {
    endpoint: "/mweb/v1/face_recognize",
    imageUri,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    faces: recognizedFacesValue(body),
    body,
  }
}

export function parseImageUri(value: string | undefined): string {
  const imageUri = value?.trim()
  if (!imageUri) {
    throw jimengError({
      category: "validation",
      code: "IMAGE_URI_REQUIRED",
      message: "A Jimeng/ImageX provider image URI is required.",
      retryable: false,
    })
  }
  if (!imageUri.startsWith("tos-cn-i-")) {
    throw jimengError({
      category: "validation",
      code: "IMAGE_URI_INVALID",
      message: "Image URI must be a Jimeng/ImageX provider URI starting with tos-cn-i-.",
      retryable: false,
      details: { imageUri },
    })
  }
  return imageUri
}

export function summarizeReferenceImageInspection(result: JimengReferenceImageInspectionResult): JsonObject {
  return {
    image_uri: result.imageUri,
    description_present: !!result.description?.description,
    description_length: result.description?.description?.length ?? 0,
    face_count: result.faceRecognition?.faces.length ?? 0,
    faces: result.faceRecognition?.faces.map((face) => ({
      face_key: face.faceKey,
      face_rect: face.faceRect,
      keypoint_count: face.keypoint.length,
      score: face.score,
      label: face.label,
    })) ?? [],
  }
}

export function defaultImageDescriptionBabiParam(): JsonObject {
  return {
    scenario: "image_video_generation",
    feature_key: "aigc_to_image",
    feature_entrance: "browser_proxy_cli",
    feature_entrance_detail: "browser_proxy_cli-get_image_description",
  }
}

export function defaultFaceRecognizeBabiParam(): JsonObject {
  return {
    scenario: "image_video_generation",
    feature_key: "to_image_referenceimage",
    feature_entrance: "browser_proxy_cli",
    feature_entrance_detail: "browser_proxy_cli-referenceimage-human_face",
  }
}

function buildReferenceImageUrl(path: string, babiParam: JsonObject | undefined): string {
  const params = new URLSearchParams(DEFAULT_QUERY)
  if (babiParam) params.set("babi_param", JSON.stringify(babiParam))
  return `https://jimeng.jianying.com${path}?${params.toString()}`
}

function buildReferenceImageHeaders(session: JimengSessionBundle): Record<string, string> {
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

function assertJimengSuccess(body: JsonValue, operation: string): void {
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

function descriptionValue(body: JsonValue): string | null {
  const data = asRecord(asRecord(body)?.data)
  return stringValue(data?.description)
    ?? stringValue(data?.prompt)
    ?? stringValue(data?.text)
    ?? stringValue(data?.caption)
    ?? null
}

function recognizedFacesValue(body: JsonValue): JimengRecognizedFace[] {
  const root = asRecord(body)
  const rawData = root?.data ?? body
  const data = asRecord(rawData) ?? root
  const candidates = [
    asArray(data?.face_list),
    asArray(data?.faceList),
    asArray(data?.face_info_list),
    asArray(data?.faceInfoList),
    asArray(data?.face_recognize_list),
    asArray(data?.faceRecognizeList),
    asArray(data?.faces),
    Array.isArray(rawData) ? rawData : [],
  ].find((entries) => entries.length > 0) ?? []

  return candidates.map(parseRecognizedFace).filter((face): face is JimengRecognizedFace => !!face)
}

function parseRecognizedFace(value: JsonValue): JimengRecognizedFace | null {
  const face = asRecord(value)
  if (!face) return null
  const faceRect = numberArray(face.face_rect ?? face.faceRect ?? face.rect ?? face.bbox)
  const keypoint = numberArray(face.keypoint ?? face.keypoints ?? face.landmark ?? face.landmarks)
  if (faceRect.length === 0 && keypoint.length === 0) return null
  return {
    faceKey: stringValue(face.face_key) ?? stringValue(face.faceKey) ?? stringValue(face.key) ?? stringValue(face.id),
    faceRect,
    keypoint,
    score: numberValue(face.score) ?? numberValue(face.confidence),
    label: stringValue(face.label) ?? stringValue(face.name),
  }
}

function numberArray(value: JsonValue | undefined): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => typeof entry === "number" ? entry : Number(entry))
    .filter((entry) => Number.isFinite(entry))
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
