import { createHash } from "node:crypto"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient } from "./client"
import { jimengError } from "./errors"

const DEFAULT_QUERY = "aid=513695&web_version=7.5.0&da_version=3.3.17&aigc_features=app_lip_sync"

export type JimengUploadTokenScene = 1 | 2 | 3

export interface JimengUploadTokenInput {
  scene: JimengUploadTokenScene
}

export interface JimengUploadTokenResult {
  scene: JimengUploadTokenScene
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  body: unknown
  summary: JimengUploadTokenSummary
}

export interface JimengUploadTokenSummary {
  scene: JimengUploadTokenScene
  region: string | null
  spaceName: string | null
  uploadDomainPresent: boolean
  accessKeyPresent: boolean
  secretKeyPresent: boolean
  sessionTokenPresent: boolean
  expiredTimePresent: boolean
  currentTimePresent: boolean
  dataKeys: string[]
}

export async function getJimengUploadToken(input: {
  client?: JimengClient
  session: JimengSessionBundle
  token: JimengUploadTokenInput
}): Promise<JimengUploadTokenResult> {
  const client = input.client ?? new JimengClient()
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/get_upload_token?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildUploadTokenHeaders(input.session),
    body: JSON.stringify({ scene: input.token.scene }),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "upload-token")
  return {
    scene: input.token.scene,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    body,
    summary: summarizeUploadTokenBody(input.token.scene, body),
  }
}

export function parseUploadTokenScene(value: string | undefined): JimengUploadTokenScene {
  if (!value || value === "image") return 2
  if (value === "video") return 1
  if (value === "file" || value === "audio") return 3
  const numeric = Number(value)
  if (numeric === 1 || numeric === 2 || numeric === 3) return numeric
  throw jimengError({
    category: "validation",
    code: "UNKNOWN_UPLOAD_TOKEN_SCENE",
    message: `Unknown Jimeng upload-token scene: ${value}`,
    retryable: false,
    details: { valid: ["video", "image", "file", "1", "2", "3"] },
  })
}

export function summarizeUploadTokenBody(scene: JimengUploadTokenScene, body: unknown): JimengUploadTokenSummary {
  const data = asRecord(asRecord(body)?.data)
  return {
    scene,
    region: stringValue(data?.region),
    spaceName: stringValue(data?.space_name) ?? stringValue(data?.spaceName),
    uploadDomainPresent: !!stringValue(data?.upload_domain),
    accessKeyPresent: !!(stringValue(data?.access_key_id) ?? stringValue(data?.accessKeyId)),
    secretKeyPresent: !!(stringValue(data?.secret_access_key) ?? stringValue(data?.secretAccessKey)),
    sessionTokenPresent: !!(stringValue(data?.session_token) ?? stringValue(data?.sessionToken)),
    expiredTimePresent: typeof (data?.expired_time ?? data?.expiredTime) === "string" || typeof (data?.expired_time ?? data?.expiredTime) === "number",
    currentTimePresent: typeof (data?.current_time ?? data?.currentTime) === "string" || typeof (data?.current_time ?? data?.currentTime) === "number",
    dataKeys: Object.keys(data ?? {}),
  }
}

function buildUploadTokenHeaders(session: JimengSessionBundle): Record<string, string> {
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

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
