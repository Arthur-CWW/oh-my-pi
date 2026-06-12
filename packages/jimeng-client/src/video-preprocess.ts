import { Schema } from "effect"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"

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
}

export interface JimengVideoPreprocessQueryPlan {
  endpoint: typeof JIMENG_VIDEO_PREPROCESS_RESULT_ENDPOINT
  method: "POST"
  request: JsonObject
  submitIds: string[]
}

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))

const GenericTaskSchema = Schema.Struct({
  submit_id: NonEmptyString,
  scene: Schema.Number,
})

const VideoPreprocessRequestSchema = Schema.Struct({
  input_list: Schema.NonEmptyArray(GenericTaskSchema),
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
    live_submit: false,
    next_compare_command: "jimeng-browser-proxy request-plan-compare --plan <video-preprocess-plan.json> --rawNetwork <capture>/raw-network.jsonl",
  }
}

export function summarizeJimengVideoPreprocessQueryPlan(plan: JimengVideoPreprocessQueryPlan): JsonObject {
  return {
    endpoint: plan.endpoint,
    method: plan.method,
    submit_id_count: plan.submitIds.length,
    request_keys: Object.keys(plan.request).sort(),
    live_submit: false,
    next_compare_command: "jimeng-browser-proxy request-plan-compare --plan <video-preprocess-query-plan.json> --rawNetwork <capture>/raw-network.jsonl",
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
  if (scene === JimengVideoPreprocessScene.ImageCreateAvatar && !hasNestedObject(task, "image_create_avatar")) {
    throw validationError("ImageCreateAvatar task requires image_create_avatar.")
  }
  if (scene === JimengVideoPreprocessScene.LipSyncVoiceRecommendation && !hasNestedObject(task, "lip_sync_voice_match")) {
    throw validationError("LipSyncVoiceRecommendation task requires lip_sync_voice_match.")
  }
  if (scene === JimengVideoPreprocessScene.LipSyncAudioDetect && !hasNestedObject(task, "lip_sync_audio_detect")) {
    throw validationError("LipSyncAudioDetect task requires lip_sync_audio_detect.")
  }
  if (scene === JimengVideoPreprocessScene.LipSyncAudioSilence && !hasNestedObject(task, "lip_sync_audio_silence")) {
    throw validationError("LipSyncAudioSilence task requires lip_sync_audio_silence.")
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
