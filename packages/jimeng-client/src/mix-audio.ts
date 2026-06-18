import { createHash } from "node:crypto"
import { Schema } from "effect"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient, type JimengFetch } from "./client"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { parseJimengApiEnvelope, parseJsonText } from "./schema"

export const JIMENG_MIX_AUDIO_VIDEO_ENDPOINT = "/mweb/v1/mix_audio_video" as const
export const JIMENG_MIX_AUDIO_VIDEOS_ENDPOINT = "/mweb/v1/mix_audio_videos" as const

export type JimengMixAudioMode = "single" | "batch"

export interface JimengMixAudioVideoInput {
  mode?: JimengMixAudioMode
  audioVid?: string
  videoItemId?: string
  inputList?: Array<{ audioVid: string, videoItemId: string }>
  body?: JsonObject
  babiParam?: JsonObject
}

export interface JimengMixAudioVideoPlan {
  endpoint: typeof JIMENG_MIX_AUDIO_VIDEO_ENDPOINT | typeof JIMENG_MIX_AUDIO_VIDEOS_ENDPOINT
  method: "POST"
  mode: JimengMixAudioMode
  request: JsonObject
  queryParams: JsonObject | null
  inputCount: number
  hasBabiParam: boolean
}

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))
const MixInputSchema = Schema.Struct({
  audio_vid: NonEmptyString,
  video_item_id: NonEmptyString,
})
const MixSingleRequestSchema = Schema.Struct({
  input: MixInputSchema,
})
const MixBatchRequestSchema = Schema.Struct({
  input_list: Schema.NonEmptyArray(MixInputSchema),
})
const MixAudioQueryParamsSchema = Schema.Struct({
  babi_param: NonEmptyString,
})

export function buildJimengMixAudioVideoPlan(input: JimengMixAudioVideoInput): JimengMixAudioVideoPlan {
  const mode = input.mode ?? (input.inputList ? "batch" : "single")
  const request = input.body
    ? snakeCaseJsonObject(input.body)
    : buildMixRequestFromInputs(input, mode)
  const queryParams = buildMixAudioQueryParams(input.babiParam)

  validateJimengMixAudioVideoPlanRequest(request, mode)
  validateJimengMixAudioQueryParams(queryParams)

  return {
    endpoint: mode === "single" ? JIMENG_MIX_AUDIO_VIDEO_ENDPOINT : JIMENG_MIX_AUDIO_VIDEOS_ENDPOINT,
    method: "POST",
    mode,
    request,
    queryParams,
    inputCount: countMixInputs(request, mode),
    hasBabiParam: !!queryParams,
  }
}

export function parseJimengMixAudioInputListJson(value: JsonValue): Array<{ audioVid: string, videoItemId: string }> {
  const parsed = decodeMixAudioContract(
    Schema.NonEmptyArray(Schema.Struct({
      audioVid: NonEmptyString,
      videoItemId: NonEmptyString,
    })),
    value,
    "mix-audio input list",
  )
  return parsed.map((item) => ({ ...item }))
}

export function parseJimengMixAudioJsonObject(value: JsonValue, operation: string): JsonObject {
  if (isJsonObject(value)) return { ...value }
  throw jimengError({
    category: "validation",
    code: "JIMENG_MIX_AUDIO_CONTRACT_CHANGED",
    message: `${operation} did not match required fields.`,
    retryable: false,
    details: { operation, error: "Expected a JSON object." },
  })
}

export function summarizeJimengMixAudioVideoPlan(plan: JimengMixAudioVideoPlan): JsonObject {
  return {
    endpoint: plan.endpoint,
    method: plan.method,
    mode: plan.mode,
    request_keys: Object.keys(plan.request).sort(),
    required_request_paths: mixAudioRequestPaths(plan.request, plan.mode),
    input_count: plan.inputCount,
    has_babi_param: plan.hasBabiParam,
    query_param_keys: plan.queryParams ? Object.keys(plan.queryParams).sort() : [],
    live_submit: false,
    next_compare_command: "jimeng-browser-proxy request-plan-compare --plan <mix-audio-plan.json> --rawNetwork <capture>/raw-network.jsonl",
  }
}

export function validateJimengMixAudioSingleRequest(request: JsonObject): void {
  decodeMixAudioContract(MixSingleRequestSchema, request, "Jimeng mix_audio_video request")
}

export function validateJimengMixAudioBatchRequest(request: JsonObject): void {
  decodeMixAudioContract(MixBatchRequestSchema, request, "Jimeng mix_audio_videos request")
}

export function validateJimengMixAudioVideoPlanRequest(request: JsonObject, mode: JimengMixAudioMode): void {
  if (mode === "single") validateJimengMixAudioSingleRequest(request)
  else validateJimengMixAudioBatchRequest(request)
}

export function validateJimengMixAudioQueryParams(queryParams: JsonObject): void {
  decodeMixAudioContract(MixAudioQueryParamsSchema, queryParams, "Jimeng mix_audio query params")
}

function buildMixRequestFromInputs(input: JimengMixAudioVideoInput, mode: JimengMixAudioMode): JsonObject {
  if (mode === "single") {
    const audioVid = input.audioVid?.trim()
    const videoItemId = input.videoItemId?.trim()
    if (!audioVid) throw new Error("mix-audio-plan single mode requires --audioVid or --body")
    if (!videoItemId) throw new Error("mix-audio-plan single mode requires --videoItemId or --body")
    return {
      input: {
        audio_vid: audioVid,
        video_item_id: videoItemId,
      },
    }
  }

  const inputList = input.inputList
  if (!inputList?.length) throw new Error("mix-audio-plan batch mode requires --inputList or --body")
  return {
    input_list: inputList.map((item) => ({
      audio_vid: item.audioVid.trim(),
      video_item_id: item.videoItemId.trim(),
    })),
  }
}

function buildMixAudioQueryParams(babiParam: JsonObject | undefined): JsonObject {
  if (!babiParam) {
    throw jimengError({
      category: "validation",
      code: "JIMENG_MIX_AUDIO_BABI_PARAM_REQUIRED",
      message: "mix-audio requires babiParam so the request matches the observed frontend endpoint contract.",
      retryable: false,
    })
  }
  return { babi_param: JSON.stringify(babiParam) }
}

function snakeCaseJsonObject(value: JsonObject): JsonObject {
  const converted = snakeCaseJsonValue(value)
  if (converted && typeof converted === "object" && !Array.isArray(converted)) return converted
  throw new Error("snakeCaseJsonObject expected an object")
}

function snakeCaseJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(snakeCaseJsonValue)
  if (value && typeof value === "object") {
    const output: JsonObject = {}
    for (const [key, item] of Object.entries(value)) output[toSnakeCase(key)] = snakeCaseJsonValue(item)
    return output
  }
  return value
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase()
}

function mixAudioRequestPaths(request: JsonObject, mode: JimengMixAudioMode): string[] {
  if (mode === "single" && isJsonObject(request.input)) {
    return ["request.input.audio_vid", "request.input.video_item_id"].filter((path) => {
      const key = path.endsWith("audio_vid") ? "audio_vid" : "video_item_id"
      return typeof (request.input as JsonObject)[key] === "string"
    })
  }
  if (mode === "batch" && Array.isArray(request.input_list) && request.input_list.length > 0) {
    return ["request.input_list[].audio_vid", "request.input_list[].video_item_id"]
  }
  return []
}

function countMixInputs(request: JsonObject, mode: JimengMixAudioMode): number {
  if (mode === "single") return 1
  return Array.isArray(request.input_list) ? request.input_list.length : 0
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function decodeMixAudioContract<A>(schema: Schema.Decoder<A>, value: JsonValue, operation: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "validation",
      code: "JIMENG_MIX_AUDIO_CONTRACT_CHANGED",
      message: `${operation} did not match required fields.`,
      retryable: false,
      details: { operation, error: message },
    })
  }
}

export interface JimengMixAudioTaskSummary {
  taskId: string | null
  status: string | number | null
  videoItemId: string | null
  audioVid: string | null
  itemId: string | null
  videoUrl: string | null
  errmsg: string | null
  keys: string[]
}

export interface JimengMixAudioVideoResult {
  endpoint: typeof JIMENG_MIX_AUDIO_VIDEO_ENDPOINT | typeof JIMENG_MIX_AUDIO_VIDEOS_ENDPOINT
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  queryParams: JsonObject | null
  tasks: JimengMixAudioTaskSummary[]
  body: JsonValue
}

export async function executeJimengMixAudioVideo(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  mix: JimengMixAudioVideoInput
}): Promise<JimengMixAudioVideoResult> {
  const plan = buildJimengMixAudioVideoPlan(input.mix)
  const client = input.client ?? new JimengClient({ fetch: input.fetch })

  const DEFAULT_QUERY = "aid=513695&device_platform=web&region=cn&da_version=3.1.3"
  const params = new URLSearchParams(DEFAULT_QUERY)
  if (plan.queryParams && plan.queryParams.babi_param) {
    params.set("babi_param", plan.queryParams.babi_param as string)
  }
  const url = `https://jimeng.jianying.com${plan.endpoint}?${params.toString()}`

  const response = await client.requestText(url, {
    method: "POST",
    headers: buildMixAudioHeaders(input.session),
    body: JSON.stringify(plan.request),
  })

  const body = parseMixAudioResponse(response.text, "mix-audio submit")

  return {
    endpoint: plan.endpoint,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request: plan.request,
    queryParams: plan.queryParams,
    tasks: summarizeMixAudioTaskLikeRows(body),
    body,
  }
}

export function summarizeJimengMixAudioVideoResult(result: JimengMixAudioVideoResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: redactSensitiveJsonObject(result.request),
    query_params: result.queryParams ? redactSensitiveJsonObject(result.queryParams) : null,
    task_count: result.tasks.length,
    tasks: result.tasks.map(summarizeMixAudioTask),
  }
}

function summarizeMixAudioTask(task: JimengMixAudioTaskSummary): JsonObject {
  return {
    task_id: task.taskId,
    status: task.status,
    video_item_id: task.videoItemId,
    audio_vid: task.audioVid,
    item_id: task.itemId,
    video_url: task.videoUrl ? "[SIGNED_URL_REDACTED]" : null,
    errmsg: task.errmsg,
    keys: task.keys,
  }
}
function redactSensitiveJsonObject(value: JsonObject): JsonObject {
  const redacted = redactSensitiveJsonValue(value)
  return isJsonObject(redacted) ? redacted : {}
}

function redactSensitiveJsonValue(value: JsonValue): JsonValue {
  if (typeof value === "string") return shouldRedactString(value) ? "[SIGNED_URL_REDACTED]" : value
  if (Array.isArray(value)) return value.map(redactSensitiveJsonValue)
  if (isJsonObject(value)) {
    const output: JsonObject = {}
    for (const [key, item] of Object.entries(value)) output[key] = redactSensitiveJsonValue(item)
    return output
  }
  return value
}

function shouldRedactString(value: string): boolean {
  return (value.includes("http://") || value.includes("https://"))
    && (value.includes("?") || value.includes("sign=") || value.includes("signature") || value.includes("X-Amz-"))
}


function parseMixAudioResponse(text: string, operation: string): JsonValue {
  const body = parseJsonText(text, operation)
  assertNoRiskError(body, text)
  const envelope = parseJimengApiEnvelope(body, operation)
  if (envelope.ret !== undefined && String(envelope.ret) !== "0") {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_MIX_AUDIO_UPSTREAM_ERROR",
      message: `${operation} returned ret=${String(envelope.ret)} errmsg=${envelope.errmsg ?? "unknown"}.`,
      retryable: false,
      details: { ret: envelope.ret, errmsg: envelope.errmsg ?? null },
    })
  }
  return body
}

function buildMixAudioHeaders(session: JimengSessionBundle): Record<string, string> {
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
  }
}

function summarizeMixAudioTaskLikeRows(body: JsonValue): JimengMixAudioTaskSummary[] {
  const data = isJsonObject(body) ? body.data : undefined
  const rows: JimengMixAudioTaskSummary[] = []
  collectMixAudioTaskRows(data, rows)
  return rows.slice(0, 40)
}

function collectMixAudioTaskRows(value: JsonValue | undefined, rows: JimengMixAudioTaskSummary[]): void {
  if (value === undefined || rows.length >= 40) return
  if (Array.isArray(value)) {
    for (const entry of value) collectMixAudioTaskRows(entry, rows)
    return
  }
  if (!isJsonObject(value)) return

  const taskId = stringValue(value.task_id) ?? stringValue(value.taskId)
  const status = stringValue(value.status) ?? numberValue(value.status)
  const videoItemId = stringValue(value.video_item_id) ?? stringValue(value.videoItemId)
  const audioVid = stringValue(value.audio_vid) ?? stringValue(value.audioVid)

  if (taskId || status !== null || videoItemId || audioVid) {
    const resultObj = isJsonObject(value.result) ? value.result : undefined
    const itemId = resultObj ? (stringValue(resultObj.item_id) ?? stringValue(resultObj.itemId)) : null
    const videoUrl = resultObj ? (stringValue(resultObj.video_url) ?? stringValue(resultObj.videoUrl)) : null
    const errmsg = stringValue(value.errmsg) ?? stringValue(value.error_msg) ?? stringValue(value.errorMsg)

    rows.push({
      taskId,
      status,
      videoItemId,
      audioVid,
      itemId,
      videoUrl,
      errmsg,
      keys: Object.keys(value).sort(),
    })
  }

  for (const entry of Object.values(value)) {
    if (entry === value.result) continue
    collectMixAudioTaskRows(entry, rows)
  }
}

function retValue(body: JsonValue): string | number | null {
  return isJsonObject(body) && (typeof body.ret === "string" || typeof body.ret === "number") ? body.ret : null
}

function errmsgValue(body: JsonValue): string | null {
  return isJsonObject(body) && typeof body.errmsg === "string" ? body.errmsg : null
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
