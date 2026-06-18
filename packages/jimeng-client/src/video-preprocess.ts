import { createHash } from "node:crypto"
import { Schema } from "effect"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient, type JimengFetch } from "./client"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { parseJimengApiEnvelope, parseJsonText } from "./schema"

export const JIMENG_VIDEO_PREPROCESS_ENDPOINT = "/mweb/v1/video_generate/pre_process" as const
export const JIMENG_VIDEO_PREPROCESS_RESULT_ENDPOINT = "/mweb/v1/video_generate/mget_pre_process_result" as const

export const JimengVideoPreprocessScene = {
  ImageFaceDetect: 1,
  ImageCreateAvatar: 2,
  VideoTemplateImageDetect: 3,
  VideoTemplateVideoDetect: 4,
  LipSyncAudioDetect: 5,
  LipSyncAudioSilence: 6,
  LipSyncVoiceRecommendation: 7,
} as const

export type JimengVideoPreprocessSceneName = keyof typeof JimengVideoPreprocessScene

export type JimengVideoPreprocessMode =
  | "image-create-avatar"
  | "voice-recommendation"
  | "audio-detect"
  | "audio-silence"
  | "raw"

export interface JimengVideoPreprocessInput {
  mode?: JimengVideoPreprocessMode
  submitId?: string
  submitIdPrefix?: string
  imageUri?: string
  imageUris?: string[]
  audioVid?: string
  prompt?: string
  detectionScene?: number | string
  body?: JsonObject
}

export interface JimengVideoPreprocessPlan {
  endpoint: typeof JIMENG_VIDEO_PREPROCESS_ENDPOINT
  method: "POST"
  mode: JimengVideoPreprocessMode
  request: JsonObject
  inputList: JsonObject[]
  inputCount: number
  scenes: number[]
  liveSubmit: JimengVideoPreprocessLiveSubmitStatus
}

export interface JimengVideoPreprocessQueryPlan {
  endpoint: typeof JIMENG_VIDEO_PREPROCESS_RESULT_ENDPOINT
  method: "POST"
  request: JsonObject
  submitIds: string[]
  liveSubmit: JimengVideoPreprocessLiveSubmitStatus
}

export interface JimengVideoPreprocessLiveSubmitStatus {
  supported: boolean
  status: "observed-helper" | "dry-run-plan"
  endpoint: typeof JIMENG_VIDEO_PREPROCESS_ENDPOINT | typeof JIMENG_VIDEO_PREPROCESS_RESULT_ENDPOINT
  reason: string
}

export interface JimengVideoPreprocessTaskSummary {
  submitId: string | null
  scene: number | null
  status: string | number | null
  errmsg: string | null
  keys: string[]
}

export interface JimengVideoPreprocessSubmitResult {
  endpoint: typeof JIMENG_VIDEO_PREPROCESS_ENDPOINT
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  tasks: JimengVideoPreprocessTaskSummary[]
  body: JsonValue
}

export interface JimengVideoPreprocessResultLookupResult {
  endpoint: typeof JIMENG_VIDEO_PREPROCESS_RESULT_ENDPOINT
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  tasks: JimengVideoPreprocessTaskSummary[]
  body: JsonValue
}

const DEFAULT_QUERY = "aid=513695&device_platform=web&region=cn&da_version=3.1.3"

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))

const ImageCreateAvatarTaskSchema = Schema.Struct({
  submit_id: NonEmptyString,
  scene: Schema.Literal(JimengVideoPreprocessScene.ImageCreateAvatar),
  image_create_avatar: Schema.Struct({
    image: Schema.Struct({
      image_uri: NonEmptyString,
    }),
    detection_scene: Schema.Union([NonEmptyString, Schema.Number]),
  }),
})

const LipSyncVoiceRecommendationTaskSchema = Schema.Struct({
  submit_id: NonEmptyString,
  scene: Schema.Literal(JimengVideoPreprocessScene.LipSyncVoiceRecommendation),
  lip_sync_voice_match: Schema.Struct({
    image_list: Schema.NonEmptyArray(Schema.Struct({
      image_uri: NonEmptyString,
    })),
  }),
})

const LipSyncAudioDetectTaskSchema = Schema.Struct({
  submit_id: NonEmptyString,
  scene: Schema.Literal(JimengVideoPreprocessScene.LipSyncAudioDetect),
  lip_sync_audio_detect: Schema.Struct({
    audio: Schema.Struct({
      vid: NonEmptyString,
    }),
  }),
})

const LipSyncAudioSilenceTaskSchema = Schema.Struct({
  submit_id: NonEmptyString,
  scene: Schema.Literal(JimengVideoPreprocessScene.LipSyncAudioSilence),
  lip_sync_audio_silence: Schema.Struct({
    prompt: NonEmptyString,
  }),
})

const GenericTaskSchema = Schema.Struct({
  submit_id: NonEmptyString,
  scene: Schema.Number,
})

const VideoPreprocessTaskSchema = Schema.Union([
  ImageCreateAvatarTaskSchema,
  LipSyncVoiceRecommendationTaskSchema,
  LipSyncAudioDetectTaskSchema,
  LipSyncAudioSilenceTaskSchema,
  GenericTaskSchema,
])

const VideoPreprocessRequestSchema = Schema.Struct({
  input_list: Schema.NonEmptyArray(VideoPreprocessTaskSchema),
})

const VideoPreprocessQueryRequestSchema = Schema.Struct({
  submit_id_list: Schema.NonEmptyArray(NonEmptyString),
})

export function buildJimengVideoPreprocessPlan(input: JimengVideoPreprocessInput): JimengVideoPreprocessPlan {
  const mode = input.mode ?? "image-create-avatar"
  const request = input.body ? snakeCaseJsonObject(input.body) : buildVideoPreprocessRequestFromInput(input, mode)
  validateJimengVideoPreprocessRequest(request)
  const inputList = request.input_list as JsonObject[]

  return {
    endpoint: JIMENG_VIDEO_PREPROCESS_ENDPOINT,
    method: "POST",
    mode,
    request,
    inputList,
    inputCount: inputList.length,
    scenes: inputList.map((task) => task.scene as number),
    liveSubmit: preprocessLiveSubmitStatus(JIMENG_VIDEO_PREPROCESS_ENDPOINT, false),
  }
}

export function buildJimengVideoPreprocessQueryPlan(submitIds: string[]): JimengVideoPreprocessQueryPlan {
  const normalized = normalizeSubmitIds(submitIds)
  const request = {
    submit_id_list: normalized,
  }
  validateJimengVideoPreprocessQueryRequest(request)
  return {
    endpoint: JIMENG_VIDEO_PREPROCESS_RESULT_ENDPOINT,
    method: "POST",
    request,
    submitIds: normalized,
    liveSubmit: preprocessLiveSubmitStatus(JIMENG_VIDEO_PREPROCESS_RESULT_ENDPOINT, false),
  }
}

export async function submitJimengVideoPreprocess(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  preprocess: JimengVideoPreprocessInput
}): Promise<JimengVideoPreprocessSubmitResult> {
  const plan = buildJimengVideoPreprocessPlan(input.preprocess)
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const response = await client.requestText(`https://jimeng.jianying.com${JIMENG_VIDEO_PREPROCESS_ENDPOINT}?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildVideoPreprocessHeaders(input.session),
    body: JSON.stringify(plan.request),
  })
  const body = parseVideoPreprocessResponse(response.text, "video preprocess submit")

  return {
    endpoint: JIMENG_VIDEO_PREPROCESS_ENDPOINT,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request: plan.request,
    tasks: summarizeTaskLikeRows(body),
    body,
  }
}

export async function fetchJimengVideoPreprocessResults(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  submitIds: string[]
}): Promise<JimengVideoPreprocessResultLookupResult> {
  const plan = buildJimengVideoPreprocessQueryPlan(input.submitIds)
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const response = await client.requestText(`https://jimeng.jianying.com${JIMENG_VIDEO_PREPROCESS_RESULT_ENDPOINT}?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildVideoPreprocessHeaders(input.session),
    body: JSON.stringify(plan.request),
  })
  const body = parseVideoPreprocessResponse(response.text, "video preprocess result lookup")

  return {
    endpoint: JIMENG_VIDEO_PREPROCESS_RESULT_ENDPOINT,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request: plan.request,
    tasks: summarizeTaskLikeRows(body),
    body,
  }
}

export function parseJimengVideoPreprocessBodyJson(value: JsonValue): JsonObject {
  if (isJsonObject(value)) return { ...value }
  throw jimengError({
    category: "validation",
    code: "JIMENG_VIDEO_PREPROCESS_CONTRACT_CHANGED",
    message: "video-preprocess body must be a JSON object.",
    retryable: false,
  })
}

export function parseJimengVideoPreprocessImageUris(value: JsonValue): string[] {
  return decodeVideoPreprocessContract(
    Schema.NonEmptyArray(NonEmptyString),
    value,
    "video-preprocess image URI list",
  ).map((uri) => uri.trim())
}

export function summarizeJimengVideoPreprocessPlan(plan: JimengVideoPreprocessPlan): JsonObject {
  return {
    endpoint: plan.endpoint,
    method: plan.method,
    mode: plan.mode,
    input_count: plan.inputCount,
    scenes: plan.scenes,
    scene_names: plan.scenes.map((scene) => sceneNameFromValue(scene) ?? `unknown:${scene}`),
    request_keys: Object.keys(plan.request).sort(),
    task_shapes: plan.inputList.map(summarizePreprocessTaskShape),
    live_submit: summarizePreprocessLiveSubmitStatus(plan.liveSubmit),
    next_compare_command: "jimeng-browser-proxy request-plan-compare --plan <video-preprocess-plan.json> --rawNetwork <capture>/raw-network.jsonl",
  }
}

export function summarizeJimengVideoPreprocessQueryPlan(plan: JimengVideoPreprocessQueryPlan): JsonObject {
  return {
    endpoint: plan.endpoint,
    method: plan.method,
    submit_id_count: plan.submitIds.length,
    request_keys: Object.keys(plan.request).sort(),
    live_submit: summarizePreprocessLiveSubmitStatus(plan.liveSubmit),
    next_compare_command: "jimeng-browser-proxy request-plan-compare --plan <video-preprocess-query-plan.json> --rawNetwork <capture>/raw-network.jsonl",
  }
}

export function summarizeJimengVideoPreprocessSubmitResult(result: JimengVideoPreprocessSubmitResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    task_count: result.tasks.length,
    tasks: result.tasks.map(summarizeTask),
  }
}

export function summarizeJimengVideoPreprocessResultLookup(result: JimengVideoPreprocessResultLookupResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    task_count: result.tasks.length,
    tasks: result.tasks.map(summarizeTask),
  }
}

export function validateJimengVideoPreprocessRequest(request: JsonObject): void {
  decodeVideoPreprocessContract(VideoPreprocessRequestSchema, request, "video-preprocess request")
  for (const task of request.input_list as JsonObject[]) validateVideoPreprocessTask(task)
}

export function validateJimengVideoPreprocessQueryRequest(request: JsonObject): void {
  decodeVideoPreprocessContract(VideoPreprocessQueryRequestSchema, request, "video-preprocess query request")
}

function buildVideoPreprocessRequestFromInput(input: JimengVideoPreprocessInput, mode: JimengVideoPreprocessMode): JsonObject {
  if (mode === "raw") throw validationError("video-preprocess raw mode requires --body")

  const submitId = normalizeSubmitId(input.submitId ?? `${input.submitIdPrefix ?? "jimeng-pre"}-1`)

  if (mode === "image-create-avatar") {
    const imageUri = normalizeRequiredString(input.imageUri, "--imageUri")
    return {
      input_list: [
        {
          submit_id: submitId,
          scene: JimengVideoPreprocessScene.ImageCreateAvatar,
          image_create_avatar: {
            image: {
              image_uri: imageUri,
            },
            detection_scene: input.detectionScene ?? "ugc_lip_sync_avatar",
          },
        },
      ],
    }
  }

  if (mode === "voice-recommendation") {
    const imageUris = normalizeImageUris(input.imageUris ?? (input.imageUri ? [input.imageUri] : []))
    return {
      input_list: [
        {
          submit_id: submitId,
          scene: JimengVideoPreprocessScene.LipSyncVoiceRecommendation,
          lip_sync_voice_match: {
            image_list: imageUris.map((imageUri) => ({ image_uri: imageUri })),
          },
        },
      ],
    }
  }

  if (mode === "audio-detect") {
    return {
      input_list: [
        {
          submit_id: submitId,
          scene: JimengVideoPreprocessScene.LipSyncAudioDetect,
          lip_sync_audio_detect: {
            audio: {
              vid: normalizeRequiredString(input.audioVid, "--audioVid"),
            },
          },
        },
      ],
    }
  }

  return {
    input_list: [
      {
        submit_id: submitId,
        scene: JimengVideoPreprocessScene.LipSyncAudioSilence,
        lip_sync_audio_silence: {
          prompt: normalizeRequiredString(input.prompt, "--prompt"),
        },
      },
    ],
  }
}

function validateVideoPreprocessTask(task: JsonObject): void {
  const scene = task.scene
  if (scene === JimengVideoPreprocessScene.ImageCreateAvatar) {
    if (!hasNestedObject(task, "image_create_avatar")) throw validationError("ImageCreateAvatar task requires image_create_avatar.")
    decodeVideoPreprocessContract(ImageCreateAvatarTaskSchema, task, "ImageCreateAvatar video-preprocess task")
    return
  }
  if (scene === JimengVideoPreprocessScene.LipSyncVoiceRecommendation) {
    if (!hasNestedObject(task, "lip_sync_voice_match")) throw validationError("LipSyncVoiceRecommendation task requires lip_sync_voice_match.")
    decodeVideoPreprocessContract(LipSyncVoiceRecommendationTaskSchema, task, "LipSyncVoiceRecommendation video-preprocess task")
    return
  }
  if (scene === JimengVideoPreprocessScene.LipSyncAudioDetect) {
    if (!hasNestedObject(task, "lip_sync_audio_detect")) throw validationError("LipSyncAudioDetect task requires lip_sync_audio_detect.")
    decodeVideoPreprocessContract(LipSyncAudioDetectTaskSchema, task, "LipSyncAudioDetect video-preprocess task")
    return
  }
  if (scene === JimengVideoPreprocessScene.LipSyncAudioSilence) {
    if (!hasNestedObject(task, "lip_sync_audio_silence")) throw validationError("LipSyncAudioSilence task requires lip_sync_audio_silence.")
    decodeVideoPreprocessContract(LipSyncAudioSilenceTaskSchema, task, "LipSyncAudioSilence video-preprocess task")
  }
}

function normalizeImageUris(values: string[]): string[] {
  if (values.length === 0) throw validationError("voice-recommendation mode requires --imageUri or --imageUris")
  return values.map((value) => normalizeRequiredString(value, "image URI"))
}

function normalizeSubmitIds(values: string[]): string[] {
  const normalized = values.map(normalizeSubmitId)
  if (normalized.length === 0) throw validationError("video-preprocess-query-plan requires --submitIds")
  return normalized
}

function normalizeSubmitId(value: string): string {
  return normalizeRequiredString(value, "submit id")
}

function normalizeRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim()
  if (!normalized) throw validationError(`${label} is required.`)
  return normalized
}

function sceneNameFromValue(value: number): JimengVideoPreprocessSceneName | undefined {
  for (const [key, sceneValue] of Object.entries(JimengVideoPreprocessScene)) {
    if (sceneValue === value) return key as JimengVideoPreprocessSceneName
  }
  return undefined
}

function snakeCaseJsonObject(value: JsonObject): JsonObject {
  const converted = snakeCaseJsonValue(value)
  if (isJsonObject(converted)) return converted
  throw validationError("video-preprocess body must be a JSON object.")
}

function snakeCaseJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(snakeCaseJsonValue)
  if (isJsonObject(value)) {
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

function hasNestedObject(task: JsonObject, key: string): boolean {
  return isJsonObject(task[key])
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function validationError(message: string): Error {
  return jimengError({
    category: "validation",
    code: "JIMENG_VIDEO_PREPROCESS_CONTRACT_CHANGED",
    message,
    retryable: false,
  })
}

function decodeVideoPreprocessContract<A>(schema: Schema.Decoder<A>, value: JsonValue, operation: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "validation",
      code: "JIMENG_VIDEO_PREPROCESS_CONTRACT_CHANGED",
      message: `${operation} did not match required fields.`,
      retryable: false,
      details: { operation, error: message },
    })
  }
}

function parseVideoPreprocessResponse(text: string, operation: string): JsonValue {
  const body = parseJsonText(text, operation)
  assertNoRiskError(body, text)
  const envelope = parseJimengApiEnvelope(body, operation)
  if (envelope.ret !== undefined && String(envelope.ret) !== "0") {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_VIDEO_PREPROCESS_UPSTREAM_ERROR",
      message: `${operation} returned ret=${String(envelope.ret)} errmsg=${envelope.errmsg ?? "unknown"}.`,
      retryable: false,
      details: { ret: envelope.ret, errmsg: envelope.errmsg ?? null },
    })
  }
  return body
}

function summarizeTaskLikeRows(body: JsonValue): JimengVideoPreprocessTaskSummary[] {
  const data = isJsonObject(body) ? body.data : undefined
  const rows: JimengVideoPreprocessTaskSummary[] = []
  collectTaskLikeRows(data, rows)
  return rows.slice(0, 40)
}

function collectTaskLikeRows(value: JsonValue | undefined, rows: JimengVideoPreprocessTaskSummary[]): void {
  if (value === undefined || rows.length >= 40) return
  if (Array.isArray(value)) {
    for (const entry of value) collectTaskLikeRows(entry, rows)
    return
  }
  if (!isJsonObject(value)) return

  const submitId = stringValue(value.submit_id) ?? stringValue(value.submitId)
  const scene = numberValue(value.scene)
  const status = stringValue(value.status) ?? numberValue(value.status)
  if (submitId || scene !== null || status !== null) {
    rows.push({
      submitId,
      scene,
      status,
      errmsg: stringValue(value.errmsg) ?? stringValue(value.error_msg) ?? stringValue(value.errorMsg),
      keys: Object.keys(value).sort(),
    })
  }

  for (const entry of Object.values(value)) collectTaskLikeRows(entry, rows)
}

function buildVideoPreprocessHeaders(session: JimengSessionBundle): Record<string, string> {
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

function summarizePreprocessLiveSubmitStatus(status: JimengVideoPreprocessLiveSubmitStatus): JsonObject {
  return {
    supported: status.supported,
    status: status.status,
    endpoint: status.endpoint,
    reason: status.reason,
  }
}

function preprocessLiveSubmitStatus(
  endpoint: typeof JIMENG_VIDEO_PREPROCESS_ENDPOINT | typeof JIMENG_VIDEO_PREPROCESS_RESULT_ENDPOINT,
  supported: boolean,
): JimengVideoPreprocessLiveSubmitStatus {
  return {
    supported,
    status: supported ? "observed-helper" : "dry-run-plan",
    endpoint,
    reason: supported
      ? "OMP helper can submit with an injected authenticated session and transport."
      : "OMP fixture evidence covers request construction only; parent validation must use focused replay/compare before any live call.",
  }
}

function summarizePreprocessTaskShape(task: JsonObject): JsonObject {
  const scene = numberValue(task.scene)
  return {
    submit_id_present: !!stringValue(task.submit_id),
    scene,
    scene_name: scene === null ? null : sceneNameFromValue(scene) ?? `unknown:${scene}`,
    has_image_create_avatar: hasNestedObject(task, "image_create_avatar"),
    has_lip_sync_voice_match: hasNestedObject(task, "lip_sync_voice_match"),
    has_lip_sync_audio_detect: hasNestedObject(task, "lip_sync_audio_detect"),
    has_lip_sync_audio_silence: hasNestedObject(task, "lip_sync_audio_silence"),
  }
}

function summarizeTask(task: JimengVideoPreprocessTaskSummary): JsonObject {
  return {
    submit_id: task.submitId,
    scene: task.scene,
    status: task.status,
    errmsg: task.errmsg,
    keys: task.keys,
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
