import { createHash, createHmac } from "node:crypto"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient } from "./client"
import { jimengError } from "./errors"

const DEFAULT_QUERY = "aid=513695&web_version=7.5.0&da_version=3.3.17&aigc_features=app_lip_sync"
const UNSIGNABLE_IMAGEX_HEADERS = new Set([
  "authorization",
  "content-type",
  "content-length",
  "user-agent",
  "presigned-expires",
  "expect",
  "x-amzn-trace-id",
])

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

export interface JimengImageUploadInput {
  fileName: string
  bytes: Uint8Array
  contentType?: string
  serviceId?: string
  userId?: string
}

export interface JimengImageUploadResult {
  token: JimengUploadTokenResult
  apply: JimengImageXApplyResult
  upload: JimengImageXDirectUploadResult
  commit: JimengImageXCommitResult
  summary: JimengImageUploadSummary
}

export interface JimengImageXApplyResult {
  httpStatus: number
  responseTextSha256: string
  body: unknown
  uploadHost: string
  storeUri: string
  authorization: string
  sessionKey: string
  uploadHeader: Record<string, string>
}

export interface JimengImageXDirectUploadResult {
  httpStatus: number
  responseTextSha256: string
  body: unknown
  crc32: string
}

export interface JimengImageXCommitResult {
  httpStatus: number
  responseTextSha256: string
  body: unknown
  imageUris: string[]
  pluginResults: Array<Record<string, unknown>>
}

export interface JimengImageUploadSummary {
  fileName: string
  contentType: string | null
  bytes: number
  serviceId: string | null
  storeUri: string
  imageUris: string[]
  uploadStatus: number
  uploadCrc32: string
  pluginResults: Array<{
    imageUri: string | null
    imageWidth: number | null
    imageHeight: number | null
    imageFormat: string | null
    imageSize: number | null
  }>
}

export interface JimengImageXSignInput {
  method: "GET" | "POST"
  host: string
  pathname?: string
  region: string
  service: "imagex" | "vod"
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  params: Record<string, string | string[]>
  headers?: Record<string, string>
  body?: string
  date?: Date
}

export interface JimengImageXSignedRequest {
  url: string
  headers: Record<string, string>
  signedHeaders: string
  canonicalRequestSha256: string
}

export interface JimengImageUploadCredentials {
  host: string
  region: string
  serviceId: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
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

export async function uploadJimengImage(input: {
  client?: JimengClient
  session: JimengSessionBundle
  image: JimengImageUploadInput
}): Promise<JimengImageUploadResult> {
  const client = input.client ?? new JimengClient()
  const token = await getJimengUploadToken({ client, session: input.session, token: { scene: 2 } })
  const credentials = parseImageUploadCredentials(token.body, input.image.serviceId)
  const contentType = input.image.contentType ?? contentTypeFromFileName(input.image.fileName)
  const apply = await applyJimengImageUpload({
    client,
    credentials,
    fileExtension: fileExtension(input.image.fileName),
  })
  const upload = await uploadJimengImageBytes({
    client,
    apply,
    bytes: input.image.bytes,
    userId: input.image.userId,
  })
  const commit = await commitJimengImageUpload({ client, credentials, sessionKey: apply.sessionKey })

  return {
    token,
    apply,
    upload,
    commit,
    summary: summarizeJimengImageUpload({
      fileName: input.image.fileName,
      contentType,
      bytes: input.image.bytes.byteLength,
      serviceId: credentials.serviceId,
      apply,
      upload,
      commit,
    }),
  }
}

export async function applyJimengImageUpload(input: {
  client?: JimengClient
  credentials: JimengImageUploadCredentials
  fileExtension?: string
}): Promise<JimengImageXApplyResult> {
  const client = input.client ?? new JimengClient()
  const params: Record<string, string> = {
    Action: "ApplyImageUpload",
    Version: "2018-08-01",
    ServiceId: input.credentials.serviceId,
    UploadNum: "1",
    s: Math.random().toString(36).substring(2),
  }
  if (input.fileExtension) params.FileExtension = input.fileExtension

  const signed = signJimengImageXRequest({
    method: "GET",
    host: input.credentials.host,
    region: input.credentials.region,
    service: "imagex",
    accessKeyId: input.credentials.accessKeyId,
    secretAccessKey: input.credentials.secretAccessKey,
    sessionToken: input.credentials.sessionToken,
    params,
  })
  const response = await client.requestText(signed.url, { method: "GET", headers: signed.headers })
  const body = safeJson(response.text)
  assertImageXSuccess(body, "ApplyImageUpload")
  const parsed = parseApplyImageUploadBody(body)
  return {
    httpStatus: response.status,
    responseTextSha256: sha256(response.text),
    body,
    ...parsed,
  }
}

export async function uploadJimengImageBytes(input: {
  client?: JimengClient
  apply: Pick<JimengImageXApplyResult, "uploadHost" | "storeUri" | "authorization" | "uploadHeader">
  bytes: Uint8Array
  userId?: string
}): Promise<JimengImageXDirectUploadResult> {
  const client = input.client ?? new JimengClient()
  const crc32 = crc32Hex(input.bytes)
  const bodyBuffer = new ArrayBuffer(input.bytes.byteLength)
  new Uint8Array(bodyBuffer).set(input.bytes)
  const response = await client.requestText(`https://${input.apply.uploadHost}/upload/v1/${input.apply.storeUri}`, {
    method: "POST",
    headers: {
      Authorization: input.apply.authorization,
      "Content-CRC32": crc32,
      "X-Storage-U": encodeURIComponent(input.userId ?? ""),
      ...input.apply.uploadHeader,
    },
    body: new Blob([bodyBuffer]),
  })
  const body = safeJson(response.text)
  assertDirectUploadSuccess(body)
  return {
    httpStatus: response.status,
    responseTextSha256: sha256(response.text),
    body,
    crc32,
  }
}

export async function commitJimengImageUpload(input: {
  client?: JimengClient
  credentials: JimengImageUploadCredentials
  sessionKey: string
}): Promise<JimengImageXCommitResult> {
  const client = input.client ?? new JimengClient()
  const params = {
    Action: "CommitImageUpload",
    Version: "2018-08-01",
    ServiceId: input.credentials.serviceId,
  }
  const bodyText = JSON.stringify({ SessionKey: input.sessionKey })
  const signed = signJimengImageXRequest({
    method: "POST",
    host: input.credentials.host,
    region: input.credentials.region,
    service: "imagex",
    accessKeyId: input.credentials.accessKeyId,
    secretAccessKey: input.credentials.secretAccessKey,
    sessionToken: input.credentials.sessionToken,
    params,
    headers: { "Content-Type": "application/json" },
    body: bodyText,
  })
  const response = await client.requestText(signed.url, {
    method: "POST",
    headers: signed.headers,
    body: bodyText,
  })
  const body = safeJson(response.text)
  assertImageXSuccess(body, "CommitImageUpload")
  const parsed = parseCommitImageUploadBody(body)
  return {
    httpStatus: response.status,
    responseTextSha256: sha256(response.text),
    body,
    ...parsed,
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

export function signJimengImageXRequest(input: JimengImageXSignInput): JimengImageXSignedRequest {
  const host = normalizeUploadHost(input.host)
  const pathname = input.pathname ?? "/"
  const date = input.date ?? new Date()
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "")
  const dateStamp = amzDate.slice(0, 8)
  const headers: Record<string, string> = {
    ...(input.headers ?? {}),
    "X-Amz-Date": amzDate,
    "x-amz-security-token": input.sessionToken,
  }
  if (input.body !== undefined) headers["X-Amz-Content-Sha256"] = sha256(input.body)

  const signedHeaderNames = Object.keys(headers)
    .filter(isImageXSignableHeader)
    .sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()))
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name.toLowerCase()}:${headers[name]!.replace(/\s+/g, " ").trim()}`)
    .join("\n")
  const signedHeaders = signedHeaderNames.map((name) => name.toLowerCase()).join(";")
  const bodyHash = headers["X-Amz-Content-Sha256"] ?? sha256("")
  const canonicalRequest = [
    input.method,
    pathname,
    canonicalQueryString(input.params),
    `${canonicalHeaders}\n`,
    signedHeaders,
    bodyHash,
  ].join("\n")
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n")
  const signature = hmacHex(
    hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), input.service), "aws4_request"),
    stringToSign,
  )

  return {
    url: `${host}${pathname}?${frontendQueryString(input.params)}`,
    headers: {
      ...headers,
      Authorization: [
        `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}`,
        `SignedHeaders=${signedHeaders}`,
        `Signature=${signature}`,
      ].join(", "),
    },
    signedHeaders,
    canonicalRequestSha256: sha256(canonicalRequest),
  }
}

function parseImageUploadCredentials(body: unknown, overrideServiceId: string | undefined): JimengImageUploadCredentials {
  const data = asRecord(asRecord(body)?.data)
  const serviceId = overrideServiceId ?? stringValue(data?.space_name) ?? stringValue(data?.spaceName)
  const host = stringValue(data?.upload_domain) ?? stringValue(data?.uploadDomain)
  const accessKeyId = stringValue(data?.access_key_id) ?? stringValue(data?.accessKeyId)
  const secretAccessKey = stringValue(data?.secret_access_key) ?? stringValue(data?.secretAccessKey)
  const sessionToken = stringValue(data?.session_token) ?? stringValue(data?.sessionToken)
  const rawRegion = stringValue(data?.region) ?? "cn-north-1"

  if (!serviceId || !host || !accessKeyId || !secretAccessKey || !sessionToken) {
    throw jimengError({
      category: "validation",
      code: "UPLOAD_TOKEN_MISSING_IMAGE_CREDENTIALS",
      message: "Upload token response missing ImageX credentials",
      retryable: false,
      details: {
        serviceIdPresent: !!serviceId,
        hostPresent: !!host,
        accessKeyPresent: !!accessKeyId,
        secretKeyPresent: !!secretAccessKey,
        sessionTokenPresent: !!sessionToken,
      },
    })
  }

  return {
    host,
    region: normalizeImageXRegion(rawRegion),
    serviceId,
    accessKeyId,
    secretAccessKey,
    sessionToken,
  }
}

function parseApplyImageUploadBody(body: unknown): Omit<JimengImageXApplyResult, "httpStatus" | "responseTextSha256" | "body"> {
  const address = asRecord(asRecord(asRecord(body)?.Result)?.UploadAddress)
  const uploadHosts = asArray(address?.UploadHosts)
  const storeInfos = asArray(address?.StoreInfos).map(asRecord).filter(isRecord)
  const firstHost = stringValue(uploadHosts[0])
  const firstStore = storeInfos[0]
  const storeUri = stringValue(firstStore?.StoreUri)
  const authorization = stringValue(firstStore?.Auth)
  const sessionKey = stringValue(address?.SessionKey)

  if (!firstHost || !storeUri || !authorization || !sessionKey) {
    throw jimengError({
      category: "upstream",
      code: "IMAGE_APPLY_RESPONSE_MISSING_UPLOAD_FIELDS",
      message: "ApplyImageUpload response missing upload host, store uri, auth, or session key",
      retryable: false,
      details: {
        uploadHostPresent: !!firstHost,
        storeUriPresent: !!storeUri,
        authorizationPresent: !!authorization,
        sessionKeyPresent: !!sessionKey,
      },
    })
  }

  return {
    uploadHost: firstHost,
    storeUri,
    authorization,
    sessionKey,
    uploadHeader: stringRecord(address?.UploadHeader),
  }
}

function parseCommitImageUploadBody(body: unknown): Pick<JimengImageXCommitResult, "imageUris" | "pluginResults"> {
  const result = asRecord(asRecord(body)?.Result)
  const results = asArray(result?.Results).map(asRecord).filter(isRecord)
  const pluginResults = asArray(result?.PluginResult).map(asRecord).filter(isRecord)
  const imageUris = results
    .map((item) => stringValue(item.Uri))
    .filter(isString)

  if (imageUris.length === 0) {
    throw jimengError({
      category: "upstream",
      code: "IMAGE_COMMIT_RESPONSE_MISSING_URI",
      message: "CommitImageUpload response missing committed image URI",
      retryable: false,
    })
  }

  return { imageUris, pluginResults }
}

function summarizeJimengImageUpload(input: {
  fileName: string
  contentType: string | null
  bytes: number
  serviceId: string
  apply: JimengImageXApplyResult
  upload: JimengImageXDirectUploadResult
  commit: JimengImageXCommitResult
}): JimengImageUploadSummary {
  return {
    fileName: input.fileName,
    contentType: input.contentType,
    bytes: input.bytes,
    serviceId: input.serviceId,
    storeUri: input.apply.storeUri,
    imageUris: input.commit.imageUris,
    uploadStatus: input.upload.httpStatus,
    uploadCrc32: input.upload.crc32,
    pluginResults: input.commit.pluginResults.map((item) => ({
      imageUri: stringValue(item.ImageUri),
      imageWidth: numberValue(item.ImageWidth),
      imageHeight: numberValue(item.ImageHeight),
      imageFormat: stringValue(item.ImageFormat),
      imageSize: numberValue(item.ImageSize),
    })),
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

function assertImageXSuccess(body: unknown, operation: string): void {
  const error = asRecord(asRecord(body)?.ResponseMetadata)?.Error
  if (!error) return
  const record = asRecord(error)
  throw jimengError({
    category: "upstream",
    code: `IMAGEX_${operation.toUpperCase()}_FAILED`,
    message: `${operation} failed (${stringValue(record?.Code) ?? "unknown"}: ${stringValue(record?.Message) ?? "unknown"})`,
    retryable: false,
    details: {
      operation,
      code: stringValue(record?.Code),
      message: stringValue(record?.Message),
      codeN: record?.CodeN ?? null,
    },
  })
}

function assertDirectUploadSuccess(body: unknown): void {
  const code = asRecord(body)?.code
  if (code === 2000 || code === "2000") return
  throw jimengError({
    category: "upstream",
    code: "IMAGEX_DIRECT_UPLOAD_FAILED",
    message: `ImageX direct upload failed (code=${String(code ?? "unknown")})`,
    retryable: false,
    details: { code: code ?? null, message: asRecord(body)?.message ?? null },
  })
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

function isRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return value !== null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value)
  if (!record) return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") out[key] = item
  }
  return out
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function isString(value: string | null): value is string {
  return value !== null
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function normalizeUploadHost(host: string): string {
  const withScheme = host.startsWith("http://") || host.startsWith("https://") ? host : `https://${host}`
  return withScheme.replace(/\/+$/, "")
}

function normalizeImageXRegion(region: string): string {
  return region === "cn" ? "cn-north-1" : region
}

function fileExtension(fileName: string): string | undefined {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName)
  return match ? `.${match[1]}` : undefined
}

function contentTypeFromFileName(fileName: string): string | null {
  const ext = fileExtension(fileName)?.toLowerCase()
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".webp") return "image/webp"
  if (ext === ".gif") return "image/gif"
  return null
}

function isImageXSignableHeader(header: string): boolean {
  const lower = header.toLowerCase()
  return lower.startsWith("x-amz-") || !UNSIGNABLE_IMAGEX_HEADERS.has(lower)
}

function frontendQueryString(params: Record<string, string | string[]>): string {
  return Object.keys(params)
    .map((key) => {
      const value = params[key]
      if (Array.isArray(value)) return value.map((item) => `${key}=${encodeURIComponent(item)}`).join("&")
      return `${key}=${encodeURIComponent(value ?? "")}`
    })
    .join("&")
}

function canonicalQueryString(params: Record<string, string | string[]>): string {
  return Object.keys(params)
    .sort()
    .map((key) => {
      const encodedKey = encodeRfc3986(key)
      const value = params[key]
      if (Array.isArray(value)) return `${encodedKey}=${value.map(encodeRfc3986).sort().join(`&${encodedKey}=`)}`
      return `${encodedKey}=${encodeRfc3986(value ?? "")}`
    })
    .filter((value) => value.length > 0)
    .join("&")
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function hmac(key: string | Uint8Array, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest()
}

function hmacHex(key: string | Uint8Array, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex")
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function crc32Hex(bytes: Uint8Array): string {
  let crc = ~0
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return ((~crc) >>> 0).toString(16).padStart(8, "0")
}
