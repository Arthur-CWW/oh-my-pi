import { randomUUID } from "node:crypto"
import { Schema } from "effect"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"

export const JIMENG_VIDEO_DIRECT_ENDPOINT = "/mweb/v1/aigc_draft/generate" as const
export const JIMENG_VIDEO_DIRECT_QUERY = "aid=513695&device_platform=web&region=cn&da_version=3.3.9&os=mac&web_component_open_flag=1&web_version=7.5.0&aigc_features=app_lip_sync" as const

export const JIMENG_VIDEO_MODEL_REQ_KEYS: Record<string, string> = {
  "jimeng-video-3.0-fast": "dreamina_ic_generate_video_model_vgfm_3.0_fast",
  "3.0fast": "dreamina_ic_generate_video_model_vgfm_3.0_fast",
  "3.0_fast": "dreamina_ic_generate_video_model_vgfm_3.0_fast",
  vgfm30fast: "dreamina_ic_generate_video_model_vgfm_3.0_fast",
  "vgfm_3.0_fast": "dreamina_ic_generate_video_model_vgfm_3.0_fast",
  dreamina_ic_generate_video_model_vgfm_3_0_fast: "dreamina_ic_generate_video_model_vgfm_3.0_fast",
  "dreamina_ic_generate_video_model_vgfm_3.0_fast": "dreamina_ic_generate_video_model_vgfm_3.0_fast",
} as const

const DEFAULT_MODEL_VERSION = "jimeng-video-3.0-fast"
const DRAFT_VERSION = "3.3.9"
const DRAFT_MIN_VERSION = "3.0.5"
const COMPONENT_MIN_VERSION = "1.0.0"

export type JimengVideoResolution = "480p" | "720p" | "1080p"
export type JimengVideoRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "21:9"

export interface JimengVideoPlanInput {
  prompt: string
  modelVersion?: string
  modelReqKey?: string
  ratio?: string
  videoResolution?: string
  durationSec?: number
  fps?: number
  videoMode?: number
  seed?: number
  submitId?: string
  nowMs?: number
  firstFrameUri?: string
  lastFrameUri?: string
}

export interface JimengVideoDirectPlan {
  endpoint: typeof JIMENG_VIDEO_DIRECT_ENDPOINT
  method: "POST"
  query: typeof JIMENG_VIDEO_DIRECT_QUERY
  submitId: string
  modelVersion: string
  modelReqKey: string
  ratio: JimengVideoRatio
  videoResolution: JimengVideoResolution
  durationSec: number
  fps: number
  videoMode: number
  promptLength: number
  hasFirstFrame: boolean
  hasLastFrame: boolean
  request: JsonObject
  draftContent: JsonObject
  metricsExtra: JsonObject
}

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))

const VideoSubmitBodySchema = Schema.Struct({
  extend: Schema.Struct({
    root_model: NonEmptyString,
    m_video_commerce_info: Schema.Struct({
      benefit_type: NonEmptyString,
      resource_id: NonEmptyString,
      resource_id_type: NonEmptyString,
      resource_sub_type: NonEmptyString,
    }),
    m_video_commerce_info_list: Schema.NonEmptyArray(Schema.Struct({
      benefit_type: NonEmptyString,
      resource_id: NonEmptyString,
      resource_id_type: NonEmptyString,
      resource_sub_type: NonEmptyString,
    })),
  }),
  submit_id: NonEmptyString,
  metrics_extra: NonEmptyString,
  draft_content: NonEmptyString,
  http_common_info: Schema.Struct({
    aid: Schema.Number,
  }),
})

const VideoDraftSchema = Schema.Struct({
  type: Schema.Literal("draft"),
  version: NonEmptyString,
  main_component_id: NonEmptyString,
  component_list: Schema.NonEmptyArray(Schema.Struct({
    type: Schema.Literal("video_base_component"),
    aigc_mode: Schema.Literal("workbench"),
    generate_type: Schema.Literal("gen_video"),
    abilities: Schema.Struct({
      gen_video: Schema.Struct({
        text_to_video_params: Schema.Struct({
          video_gen_inputs: Schema.NonEmptyArray(Schema.Struct({
            prompt: NonEmptyString,
            video_mode: Schema.Number,
            fps: Schema.Number,
            duration_ms: Schema.Number,
            resolution: NonEmptyString,
            seed: Schema.Number,
            first_frame_image: Schema.optional(NonEmptyString),
            end_frame_image: Schema.optional(NonEmptyString),
          })),
          video_aspect_ratio: NonEmptyString,
          seed: Schema.Number,
          model_req_key: NonEmptyString,
          priority: Schema.Number,
        }),
        video_task_extra: NonEmptyString,
      }),
    }),
  })),
})

const VideoMetricsSchema = Schema.Struct({
  promptSource: Schema.Literal("custom"),
  isDefaultSeed: Schema.Number,
  originSubmitId: NonEmptyString,
  isRegenerate: Schema.Literal(false),
  enterFrom: Schema.Literal("click"),
  position: Schema.Literal("page_bottom_box"),
  functionMode: Schema.Literal("first_last_frames"),
  sceneOptions: NonEmptyString,
})

const VideoSceneOptionsSchema = Schema.NonEmptyArray(Schema.Struct({
  type: Schema.Literal("video"),
  scene: Schema.Literal("BasicVideoGenerateButton"),
  resolution: NonEmptyString,
  modelReqKey: NonEmptyString,
  videoDuration: Schema.Number,
  reportParams: Schema.Struct({
    enterSource: Schema.Literal("generate"),
    vipSource: Schema.Literal("generate"),
    extraVipFunctionKey: NonEmptyString,
    useVipFunctionDetailsReporterHoc: Schema.Literal(true),
  }),
  materialTypes: Schema.Array(Schema.String),
}))

export function buildJimengVideoDirectPlan(input: JimengVideoPlanInput): JimengVideoDirectPlan {
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error("text2video-plan requires a non-empty prompt")
  const modelVersion = input.modelVersion?.trim() || DEFAULT_MODEL_VERSION
  const modelReqKey = input.modelReqKey?.trim() || modelVersionToDirectVideoReqKey(modelVersion)
  const ratio = parseRatio(input.ratio)
  const videoResolution = parseResolution(input.videoResolution)
  const durationSec = parseDurationSec(input.durationSec)
  const fps = parseFps(input.fps)
  const videoMode = parseVideoMode(input.videoMode)
  const seed = parseSeed(input.seed)
  const submitId = input.submitId?.trim() || randomUUID()
  const componentId = randomUUID()
  const draftId = randomUUID()
  const nowMs = Math.floor(input.nowMs ?? Date.now())

  const videoInput: JsonObject = {
    type: "",
    id: randomUUID(),
    min_version: DRAFT_MIN_VERSION,
    prompt,
    video_mode: videoMode,
    fps,
    duration_ms: durationSec * 1000,
    resolution: videoResolution,
    idip_meta_list: [],
    seed,
  }
  if (input.firstFrameUri?.trim()) videoInput.first_frame_image = input.firstFrameUri.trim()
  if (input.lastFrameUri?.trim()) videoInput.end_frame_image = input.lastFrameUri.trim()

  const sceneOptions: JsonObject[] = [{
    type: "video",
    scene: "BasicVideoGenerateButton",
    resolution: videoResolution,
    modelReqKey,
    videoDuration: durationSec,
    reportParams: {
      enterSource: "generate",
      vipSource: "generate",
      extraVipFunctionKey: `${modelReqKey}-${videoResolution}`,
      useVipFunctionDetailsReporterHoc: true,
    },
    materialTypes: [],
  }]
  const metricsExtra: JsonObject = {
    promptSource: "custom",
    isDefaultSeed: input.seed === undefined ? 1 : 0,
    originSubmitId: submitId,
    isRegenerate: false,
    enterFrom: "click",
    position: "page_bottom_box",
    functionMode: "first_last_frames",
    sceneOptions: JSON.stringify(sceneOptions),
  }
  const draftContent: JsonObject = {
    type: "draft",
    id: draftId,
    min_version: DRAFT_MIN_VERSION,
    min_features: [],
    is_from_tsn: true,
    version: DRAFT_VERSION,
    main_component_id: componentId,
    component_list: [{
      type: "video_base_component",
      id: componentId,
      min_version: COMPONENT_MIN_VERSION,
      aigc_mode: "workbench",
      metadata: {
        type: "",
        id: randomUUID(),
        created_platform: 3,
        created_platform_version: "",
        created_time_in_ms: String(nowMs),
        created_did: "",
      },
      generate_type: "gen_video",
      abilities: {
        type: "",
        id: randomUUID(),
        gen_video: {
          type: "",
          id: randomUUID(),
          text_to_video_params: {
            type: "",
            id: randomUUID(),
            video_gen_inputs: [videoInput],
            video_aspect_ratio: ratio,
            seed,
            model_req_key: modelReqKey,
            priority: 0,
          },
          video_task_extra: JSON.stringify(metricsExtra),
        },
      },
      process_type: 1,
    }],
  }
  const request: JsonObject = {
    extend: {
      root_model: modelReqKey,
      m_video_commerce_info: defaultVideoCommerceInfo(),
      m_video_commerce_info_list: [defaultVideoCommerceInfo()],
    },
    submit_id: submitId,
    metrics_extra: JSON.stringify(metricsExtra),
    draft_content: JSON.stringify(draftContent),
    http_common_info: {
      aid: 513695,
    },
  }

  validateJimengVideoDirectRequest(request)

  return {
    endpoint: JIMENG_VIDEO_DIRECT_ENDPOINT,
    method: "POST",
    query: JIMENG_VIDEO_DIRECT_QUERY,
    submitId,
    modelVersion,
    modelReqKey,
    ratio,
    videoResolution,
    durationSec,
    fps,
    videoMode,
    promptLength: prompt.length,
    hasFirstFrame: !!videoInput.first_frame_image,
    hasLastFrame: !!videoInput.end_frame_image,
    request,
    draftContent,
    metricsExtra,
  }
}

export function summarizeJimengVideoDirectPlan(plan: JimengVideoDirectPlan): JsonObject {
  return {
    endpoint: plan.endpoint,
    method: plan.method,
    query: plan.query,
    submit_id: plan.submitId,
    model_version: plan.modelVersion,
    model_req_key: plan.modelReqKey,
    ratio: plan.ratio,
    video_resolution: plan.videoResolution,
    duration_sec: plan.durationSec,
    fps: plan.fps,
    video_mode: plan.videoMode,
    prompt_length: plan.promptLength,
    has_first_frame: plan.hasFirstFrame,
    has_last_frame: plan.hasLastFrame,
    has_metrics_extra: typeof plan.request.metrics_extra === "string",
    has_draft_content: typeof plan.request.draft_content === "string",
    live_submit: false,
  }
}

export function validateJimengVideoDirectRequest(request: JsonObject): void {
  const body = decodeVideoContract(VideoSubmitBodySchema, request, "video direct submit request")
  const draft = parseJsonObjectText(body.draft_content, "video direct draft_content")
  decodeVideoContract(VideoDraftSchema, draft, "video direct draft_content")
  const metrics = parseJsonObjectText(body.metrics_extra, "video direct metrics_extra")
  const parsedMetrics = decodeVideoContract(VideoMetricsSchema, metrics, "video direct metrics_extra")
  const sceneOptions = parseJsonTextValue(parsedMetrics.sceneOptions, "video direct sceneOptions")
  decodeVideoContract(VideoSceneOptionsSchema, sceneOptions, "video direct sceneOptions")
}

export function modelVersionToDirectVideoReqKey(modelVersion: string): string {
  const key = JIMENG_VIDEO_MODEL_REQ_KEYS[modelVersion.trim()]
  if (!key) {
    throw new Error(`No direct video model_req_key mapping for modelVersion=${modelVersion}`)
  }
  return key
}

function defaultVideoCommerceInfo(): JsonObject {
  return {
    benefit_type: "basic_video_operation_vgfm_v_three",
    resource_id: "generate_video",
    resource_id_type: "str",
    resource_sub_type: "aigc",
  }
}

function parseResolution(value: string | undefined): JimengVideoResolution {
  const resolution = value?.trim() || "720p"
  if (resolution === "480p" || resolution === "720p" || resolution === "1080p") return resolution
  throw new Error(`Unsupported video resolution: ${resolution}`)
}

function parseRatio(value: string | undefined): JimengVideoRatio {
  const ratio = value?.trim() || "9:16"
  if (ratio === "1:1" || ratio === "4:3" || ratio === "3:4" || ratio === "16:9" || ratio === "9:16" || ratio === "21:9") {
    return ratio
  }
  throw new Error(`Unsupported video ratio: ${ratio}`)
}

function parseDurationSec(value: number | undefined): number {
  if (value === undefined) return 3
  if (Number.isInteger(value) && value >= 1 && value <= 15) return value
  throw new Error("--durationSec must be an integer from 1 to 15")
}

function parseFps(value: number | undefined): number {
  if (value === undefined) return 24
  if (Number.isInteger(value) && value >= 1 && value <= 60) return value
  throw new Error("--fps must be an integer from 1 to 60")
}

function parseVideoMode(value: number | undefined): number {
  if (value === undefined) return 2
  if (Number.isInteger(value) && value >= 0) return value
  throw new Error("--videoMode must be a non-negative integer")
}

function parseSeed(value: number | undefined): number {
  if (value === undefined) return Math.floor(Math.random() * 4294967296)
  if (Number.isInteger(value) && value >= 0 && value <= 4294967295) return value
  throw new Error("--seed must be an integer from 0 to 4294967295")
}

function parseJsonObjectText(text: string, operation: string): JsonObject {
  const parsed = parseJsonTextValue(text, operation)
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
  throw new Error(`${operation} must parse to a JSON object`)
}

function parseJsonTextValue(text: string, operation: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${operation} was not valid JSON: ${message}`)
  }
}

function decodeVideoContract<A>(schema: Schema.Decoder<A>, value: JsonValue, operation: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "upstream",
      code: "JIMENG_VIDEO_CONTRACT_CHANGED",
      message: `${operation}: Jimeng video direct request did not match required fields.`,
      retryable: false,
      details: {
        operation,
        error: message,
      },
    })
  }
}
