import { Schema } from "effect"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"

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

export function buildJimengMixAudioVideoPlan(input: JimengMixAudioVideoInput): JimengMixAudioVideoPlan {
  const mode = input.mode ?? (input.inputList ? "batch" : "single")
  const request = input.body
    ? snakeCaseJsonObject(input.body)
    : buildMixRequestFromInputs(input, mode)
  const queryParams = input.babiParam ? { babi_param: JSON.stringify(input.babiParam) } : null

  if (mode === "single") validateJimengMixAudioSingleRequest(request)
  else validateJimengMixAudioBatchRequest(request)

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
