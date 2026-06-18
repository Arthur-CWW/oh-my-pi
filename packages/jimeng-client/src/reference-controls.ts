import { createHash } from "node:crypto"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient, type JimengFetch } from "./client"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue, parseImageUri } from "./reference-image"

const DEFAULT_QUERY = "aid=513695&web_version=7.5.0&da_version=3.3.17&aigc_features=app_lip_sync"
const CONTROL_NET_MODEL = "img2img_xl_sft"
const CONTROL_NET_ABILITY_NAME = "control_net"
const CONTROL_NET_DEFAULT_STRENGTH = 0.6
const CONTROL_NET_DEFAULT_FIT_MODE = "center_crop"

export type JimengControlNetKind = "pose" | "depth" | "canny"
export type JimengReferenceControlKind = JimengControlNetKind | "style"
export type JimengReferenceControlEvidenceStatus = "observed_provider_contract" | "catalog_only_missing_capture"
export const JIMENG_CONTROL_NET_KINDS: readonly JimengControlNetKind[] = ["pose", "depth", "canny"]
export const JIMENG_REFERENCE_CONTROL_KINDS: readonly JimengReferenceControlKind[] = ["pose", "depth", "canny", "style"]
export type JimengControlNetFitMode = "center_crop" | "adapt_to_canvas"

export interface JimengControlNetPreviewResult {
  endpoint: "/mweb/v1/blend_preview"
  imageUri: string
  control: JimengControlNetKind
  strength: number
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  previewImageUri: string | null
  previewImageUrl: string | null
  body: JsonValue
}

export interface JimengPoseDetectResult {
  endpoint: "/mweb/v1/pose_detect"
  imageUri: string
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  isPose: boolean | null
  body: JsonValue
}

export interface JimengControlNetReferenceInspection {
  imageUri: string
  control: JimengControlNetKind
  fitMode: JimengControlNetFitMode
  preview: JimengControlNetPreviewResult
  poseDetection: JimengPoseDetectResult | null
  saveParams: JsonObject
}

export interface JimengReferenceControlEvidence {
  control: JimengReferenceControlKind
  previewSupported: boolean
  status: JimengReferenceControlEvidenceStatus
  providerEvidence: string
  gap: string | null
}

export function parseJimengReferenceControlKind(value: string | undefined): JimengReferenceControlKind {
  const normalized = (value ?? "pose").trim().toLowerCase()
  if (isJimengReferenceControlKind(normalized)) return normalized
  throw jimengError({
    category: "validation",
    code: "REFERENCE_CONTROL_KIND_INVALID",
    message: "--control must be one of: pose, depth, canny, style.",
    retryable: false,
    details: { control: value ?? null },
  })
}

export function jimengReferenceControlEvidence(control: JimengReferenceControlKind): JimengReferenceControlEvidence {
  if (control === "style") {
    return {
      control,
      previewSupported: false,
      status: "catalog_only_missing_capture",
      providerEvidence: "agent catalog high-value feat only",
      gap: "No observed /mweb/v1/blend_preview style request/response or generation save_params capture is represented in source fixtures/tests.",
    }
  }
  return {
    control,
    previewSupported: true,
    status: "observed_provider_contract",
    providerEvidence: "/mweb/v1/blend_preview request shape and save_params are represented in source fixtures/tests.",
    gap: null,
  }
}

function isJimengReferenceControlKind(value: string): value is JimengReferenceControlKind {
  return (JIMENG_REFERENCE_CONTROL_KINDS as readonly string[]).includes(value)
}

export function parseJimengControlNetKind(value: string | undefined): JimengControlNetKind {
  const normalized = (value ?? "pose").trim().toLowerCase()
  if ((JIMENG_CONTROL_NET_KINDS as readonly string[]).includes(normalized)) return normalized as JimengControlNetKind
  throw jimengError({
    category: "validation",
    code: "CONTROL_NET_KIND_INVALID",
    message: "--control must be one of the observed provider preview controls: pose, depth, canny. style is catalog-only until a provider preview capture is available.",
    retryable: false,
    details: { control: value ?? null },
  })
}

export function parseJimengControlNetFitMode(value: string | undefined): JimengControlNetFitMode {
  const normalized = (value ?? CONTROL_NET_DEFAULT_FIT_MODE).trim().toLowerCase()
  if (normalized === "center_crop" || normalized === "adapt_to_canvas") return normalized
  throw jimengError({
    category: "validation",
    code: "CONTROL_NET_FIT_MODE_INVALID",
    message: "--fitMode must be center_crop or adapt_to_canvas.",
    retryable: false,
    details: { fitMode: value ?? null },
  })
}

export function normalizeJimengControlNetStrength(value: number | undefined): number {
  if (value === undefined) return CONTROL_NET_DEFAULT_STRENGTH
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    throw jimengError({
      category: "validation",
      code: "CONTROL_NET_STRENGTH_INVALID",
      message: "--strength must be a number from 0.01..1 or 1..100.",
      retryable: false,
      details: { strength: value },
    })
  }
  const normalized = value <= 1 ? value : value / 100
  return Math.round(normalized * 10000) / 10000
}

export function buildJimengControlNetPreviewRequest(input: {
  imageUri: string
  control: JimengControlNetKind
  strength?: number
}): JsonObject {
  const imageUri = parseImageUri(input.imageUri)
  const strength = normalizeJimengControlNetStrength(input.strength)
  return {
    model: CONTROL_NET_MODEL,
    ability: {
      name: CONTROL_NET_ABILITY_NAME,
      image_uri_list: [imageUri],
      control_net_list: [{
        name: input.control,
        strength,
        image_index: 0,
      }],
    },
  }
}

export function buildJimengControlNetSaveParams(input: {
  imageUri: string
  control: JimengControlNetKind
  strength?: number
  previewImageUri?: string | null
  previewImageUrl?: string | null
  originImageUrl?: string | null
  fitMode?: JimengControlNetFitMode
}): JsonObject {
  const imageUri = parseImageUri(input.imageUri)
  const strength = normalizeJimengControlNetStrength(input.strength)
  const fitMode = input.fitMode ?? CONTROL_NET_DEFAULT_FIT_MODE
  const referenceImage = {
    image: {},
    originImage: {
      imageUri,
      imageUrl: input.originImageUrl ?? "",
    },
    previewImage: {
      imageUri: input.previewImageUri ?? "",
      imageUrl: input.previewImageUrl ?? "",
    },
  }
  return {
    model: {
      abilityName: CONTROL_NET_ABILITY_NAME,
      controlNet: {
        name: input.control,
        strength,
        imageIndex: 0,
        [input.control]: referenceImage,
      },
      extra: {
        name: input.control,
        fitMode,
        imageIndex: 0,
      },
    },
  }
}

export async function generateJimengControlNetPreview(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  imageUri: string
  control: JimengControlNetKind
  strength?: number
  babiParam?: JsonObject
}): Promise<JimengControlNetPreviewResult> {
  const imageUri = parseImageUri(input.imageUri)
  const strength = normalizeJimengControlNetStrength(input.strength)
  const request = buildJimengControlNetPreviewRequest({ imageUri, control: input.control, strength })
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const response = await client.requestText(buildReferenceControlUrl("/mweb/v1/blend_preview", input.babiParam), {
    method: "POST",
    headers: buildReferenceControlHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "controlnet preview")
  const preview = previewImageValue(body)

  return {
    endpoint: "/mweb/v1/blend_preview",
    imageUri,
    control: input.control,
    strength,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    previewImageUri: preview.imageUri,
    previewImageUrl: preview.imageUrl,
    body,
  }
}

export async function detectJimengPose(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  imageUri: string
  babiParam?: JsonObject
}): Promise<JimengPoseDetectResult> {
  const imageUri = parseImageUri(input.imageUri)
  const request = { uri: imageUri }
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const response = await client.requestText(buildReferenceControlUrl("/mweb/v1/pose_detect", input.babiParam), {
    method: "POST",
    headers: buildReferenceControlHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "pose detection")

  return {
    endpoint: "/mweb/v1/pose_detect",
    imageUri,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    isPose: poseDetectedValue(body),
    body,
  }
}

export function defaultControlNetPreviewBabiParam(control: JimengControlNetKind): JsonObject {
  return {
    scenario: "image_video_generation",
    feature_key: "to_image_referenceimage",
    feature_entrance: "browser_proxy_cli",
    feature_entrance_detail: `browser_proxy_cli-referenceimage-${control}`,
  }
}

export function defaultPoseDetectBabiParam(): JsonObject {
  return {
    scenario: "image_video_generation",
    feature_key: "to_image_referenceimage",
    feature_entrance: "browser_proxy_cli",
    feature_entrance_detail: "browser_proxy_cli-referenceimage-pose_detection",
  }
}

export function summarizeControlNetReferenceInspection(result: JimengControlNetReferenceInspection): JsonObject {
  return {
    image_uri: result.imageUri,
    control: result.control,
    fit_mode: result.fitMode,
    strength: result.preview.strength,
    preview_image_uri: result.preview.previewImageUri,
    preview_image_url_present: !!result.preview.previewImageUrl,
    preview_response_sha256: result.preview.responseTextSha256,
    pose_detected: result.poseDetection?.isPose ?? null,
    pose_detect_response_sha256: result.poseDetection?.responseTextSha256 ?? null,
    save_params: stripImageUrls(result.saveParams),
  }
}

function buildReferenceControlUrl(path: string, babiParam: JsonObject | undefined): string {
  const params = new URLSearchParams(DEFAULT_QUERY)
  if (babiParam) params.set("babi_param", JSON.stringify(babiParam))
  return `https://jimeng.jianying.com${path}?${params.toString()}`
}

function buildReferenceControlHeaders(session: JimengSessionBundle): Record<string, string> {
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

function previewImageValue(body: JsonValue): { imageUri: string | null; imageUrl: string | null } {
  const root = asRecord(body)
  const data = asRecord(root?.data) ?? root
  const ability = asRecord(data?.ability)
  const candidates = [
    asArray(ability?.large_image_list),
    asArray(ability?.largeImageList),
    asArray(data?.large_image_list),
    asArray(data?.largeImageList),
  ].find((entries) => entries.length > 0) ?? []
  const first = asRecord(candidates[0])
  return {
    imageUri: stringValue(first?.image_uri) ?? stringValue(first?.imageUri),
    imageUrl: stringValue(first?.image_url) ?? stringValue(first?.imageUrl),
  }
}

function poseDetectedValue(body: JsonValue): boolean | null {
  const root = asRecord(body)
  const data = asRecord(root?.data) ?? root
  const value = data?.is_pose ?? data?.isPose
  return typeof value === "boolean" ? value : null
}

function stripImageUrls(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(stripImageUrls)
  const record = asRecord(value)
  if (!record) return value
  const output: JsonObject = {}
  for (const [key, entry] of Object.entries(record)) {
    output[key] = key === "imageUrl" || key === "image_url" ? "" : stripImageUrls(entry)
  }
  return output
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

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
