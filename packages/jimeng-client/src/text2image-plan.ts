import { randomUUID } from "node:crypto"
import { Schema } from "effect"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"

export const JIMENG_TEXT2IMAGE_DIRECT_ENDPOINT = "/mweb/v1/aigc_draft/generate" as const
export const JIMENG_TEXT2IMAGE_DIRECT_QUERY = "aid=513695&web_version=7.5.0&da_version=3.3.9&aigc_features=app_lip_sync" as const

export const JIMENG_TEXT2IMAGE_MODEL_REQ_KEYS: Record<string, string> = {
  "jimeng-5.0": "high_aes_general_v50",
  "jimeng-4.6": "high_aes_general_v42",
  "jimeng-4.5": "high_aes_general_v40l",
  "jimeng-4.1": "high_aes_general_v41",
  "jimeng-4.0": "high_aes_general_v40",
  "jimeng-3.1": "high_aes_general_v30l_art_fangzhou:general_v3.0_18b",
  "jimeng-3.0": "high_aes_general_v30l:general_v3.0_18b",
} as const

const DEFAULT_MODEL_VERSION = "jimeng-5.0"
const DRAFT_VERSION = "3.3.9"
const DRAFT_MIN_VERSION = "3.0.2"

const RESOLUTION_TABLE = {
  "1k": {
    "1:1": { width: 1024, height: 1024, imageRatio: 1 },
    "4:3": { width: 768, height: 1024, imageRatio: 4 },
    "3:4": { width: 1024, height: 768, imageRatio: 2 },
    "16:9": { width: 1024, height: 576, imageRatio: 3 },
    "9:16": { width: 576, height: 1024, imageRatio: 5 },
    "3:2": { width: 1024, height: 682, imageRatio: 7 },
    "2:3": { width: 682, height: 1024, imageRatio: 6 },
    "21:9": { width: 1195, height: 512, imageRatio: 8 },
  },
  "2k": {
    "1:1": { width: 2048, height: 2048, imageRatio: 1 },
    "4:3": { width: 2304, height: 1728, imageRatio: 4 },
    "3:4": { width: 1728, height: 2304, imageRatio: 2 },
    "16:9": { width: 2560, height: 1440, imageRatio: 3 },
    "9:16": { width: 1440, height: 2560, imageRatio: 5 },
    "3:2": { width: 2496, height: 1664, imageRatio: 7 },
    "2:3": { width: 1664, height: 2496, imageRatio: 6 },
    "21:9": { width: 3024, height: 1296, imageRatio: 8 },
  },
  "4k": {
    "1:1": { width: 4096, height: 4096, imageRatio: 101 },
    "4:3": { width: 4608, height: 3456, imageRatio: 104 },
    "3:4": { width: 3456, height: 4608, imageRatio: 102 },
    "16:9": { width: 5120, height: 2880, imageRatio: 103 },
    "9:16": { width: 2880, height: 5120, imageRatio: 105 },
    "3:2": { width: 4992, height: 3328, imageRatio: 107 },
    "2:3": { width: 3328, height: 4992, imageRatio: 106 },
    "21:9": { width: 6048, height: 2592, imageRatio: 108 },
  },
} as const

export type JimengText2ImageResolution = keyof typeof RESOLUTION_TABLE
export type JimengText2ImageRatio = keyof typeof RESOLUTION_TABLE["2k"]

export interface JimengText2ImagePlanInput {
  prompt: string
  modelVersion?: string
  modelReqKey?: string
  resolution?: string
  ratio?: string
  sampleStrength?: number
  negativePrompt?: string
  intelligentRatio?: boolean
  seed?: number
  submitId?: string
  nowMs?: number
}

export interface JimengText2ImageDirectPlan {
  endpoint: typeof JIMENG_TEXT2IMAGE_DIRECT_ENDPOINT
  method: "POST"
  query: typeof JIMENG_TEXT2IMAGE_DIRECT_QUERY
  submitId: string
  modelVersion: string
  modelReqKey: string
  resolution: JimengText2ImageResolution
  ratio: JimengText2ImageRatio
  width: number
  height: number
  imageRatio: number
  promptLength: number
  request: JsonObject
  draftContent: JsonObject
  metricsExtra: JsonObject
}

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))

const Text2ImageSubmitBodySchema = Schema.Struct({
  extend: Schema.Struct({
    root_model: NonEmptyString,
  }),
  submit_id: NonEmptyString,
  metrics_extra: NonEmptyString,
  draft_content: NonEmptyString,
  http_common_info: Schema.Struct({
    aid: Schema.Number,
  }),
})

const Text2ImageDraftSchema = Schema.Struct({
  type: Schema.Literal("draft"),
  version: NonEmptyString,
  main_component_id: NonEmptyString,
  component_list: Schema.NonEmptyArray(Schema.Struct({
    type: Schema.Literal("image_base_component"),
    aigc_mode: Schema.Literal("workbench"),
    generate_type: Schema.Literal("generate"),
    abilities: Schema.Struct({
      generate: Schema.Struct({
        core_param: Schema.Struct({
          model: NonEmptyString,
          prompt: NonEmptyString,
          sample_strength: Schema.Number,
          image_ratio: Schema.optional(Schema.Number),
          intelligent_ratio: Schema.Boolean,
          large_image_info: Schema.Struct({
            width: Schema.Number,
            height: Schema.Number,
            resolution_type: NonEmptyString,
          }),
        }),
      }),
    }),
  })),
})

const Text2ImageMetricsSchema = Schema.Struct({
  promptSource: Schema.Literal("custom"),
  generateCount: Schema.Number,
  enterFrom: Schema.Literal("click"),
  sceneOptions: NonEmptyString,
  generateId: NonEmptyString,
  isRegenerate: Schema.Literal(false),
})

const Text2ImageSceneOptionsSchema = Schema.NonEmptyArray(Schema.Struct({
  type: Schema.Literal("image"),
  scene: Schema.Literal("ImageBasicGenerate"),
  modelReqKey: NonEmptyString,
  resolutionType: NonEmptyString,
  benefitCount: Schema.Number,
  reportParams: Schema.Struct({
    enterSource: Schema.Literal("generate"),
    vipSource: Schema.Literal("generate"),
    extraVipFunctionKey: NonEmptyString,
    useVipFunctionDetailsReporterHoc: Schema.Literal(true),
  }),
}))

export function buildJimengText2ImageDirectPlan(input: JimengText2ImagePlanInput): JimengText2ImageDirectPlan {
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error("text2image-plan requires a non-empty prompt")
  const resolution = parseResolution(input.resolution)
  const ratio = parseRatio(input.ratio)
  const size = RESOLUTION_TABLE[resolution][ratio]
  const modelVersion = input.modelVersion?.trim() || DEFAULT_MODEL_VERSION
  const modelReqKey = input.modelReqKey?.trim() || modelVersionToImageReqKey(modelVersion)
  const sampleStrength = parseSampleStrength(input.sampleStrength)
  const seed = parseSeed(input.seed)
  const submitId = input.submitId?.trim() || randomUUID()
  const componentId = randomUUID()
  const draftId = randomUUID()
  const nowMs = Math.floor(input.nowMs ?? Date.now())
  const intelligentRatio = input.intelligentRatio === true

  const coreParam: JsonObject = {
    type: "",
    id: randomUUID(),
    model: modelReqKey,
    prompt,
    sample_strength: sampleStrength,
    large_image_info: {
      type: "",
      id: randomUUID(),
      min_version: DRAFT_MIN_VERSION,
      height: size.height,
      width: size.width,
      resolution_type: resolution,
    },
    intelligent_ratio: intelligentRatio,
    seed,
  }
  if (!intelligentRatio) coreParam.image_ratio = size.imageRatio
  if (input.negativePrompt !== undefined) coreParam.negative_prompt = input.negativePrompt

  const sceneOptions: JsonObject[] = [{
    type: "image",
    scene: "ImageBasicGenerate",
    modelReqKey,
    resolutionType: resolution,
    abilityList: [],
    benefitCount: 4,
    reportParams: {
      enterSource: "generate",
      vipSource: "generate",
      extraVipFunctionKey: `${modelReqKey}-${resolution}`,
      useVipFunctionDetailsReporterHoc: true,
    },
  }]
  const metricsExtra: JsonObject = {
    promptSource: "custom",
    generateCount: 1,
    enterFrom: "click",
    sceneOptions: JSON.stringify(sceneOptions),
    generateId: submitId,
    isRegenerate: false,
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
      type: "image_base_component",
      id: componentId,
      min_version: DRAFT_MIN_VERSION,
      aigc_mode: "workbench",
      metadata: {
        type: "",
        id: randomUUID(),
        created_platform: 3,
        created_platform_version: "",
        created_time_in_ms: String(nowMs),
        created_did: "",
      },
      generate_type: "generate",
      abilities: {
        type: "",
        id: randomUUID(),
        generate: {
          type: "",
          id: randomUUID(),
          core_param: coreParam,
          gen_option: {
            type: "",
            id: randomUUID(),
            generate_all: false,
          },
        },
      },
    }],
  }
  const request: JsonObject = {
    extend: {
      root_model: modelReqKey,
    },
    submit_id: submitId,
    metrics_extra: JSON.stringify(metricsExtra),
    draft_content: JSON.stringify(draftContent),
    http_common_info: {
      aid: 513695,
    },
  }

  validateJimengText2ImageDirectRequest(request)

  return {
    endpoint: JIMENG_TEXT2IMAGE_DIRECT_ENDPOINT,
    method: "POST",
    query: JIMENG_TEXT2IMAGE_DIRECT_QUERY,
    submitId,
    modelVersion,
    modelReqKey,
    resolution,
    ratio,
    width: size.width,
    height: size.height,
    imageRatio: size.imageRatio,
    promptLength: prompt.length,
    request,
    draftContent,
    metricsExtra,
  }
}

export function summarizeJimengText2ImageDirectPlan(plan: JimengText2ImageDirectPlan): JsonObject {
  return {
    endpoint: plan.endpoint,
    method: plan.method,
    query: plan.query,
    submit_id: plan.submitId,
    model_version: plan.modelVersion,
    model_req_key: plan.modelReqKey,
    resolution: plan.resolution,
    ratio: plan.ratio,
    width: plan.width,
    height: plan.height,
    image_ratio: plan.imageRatio,
    prompt_length: plan.promptLength,
    has_metrics_extra: typeof plan.request.metrics_extra === "string",
    has_draft_content: typeof plan.request.draft_content === "string",
    live_submit: false,
  }
}

export function validateJimengText2ImageDirectRequest(request: JsonObject): void {
  const body = decodeText2ImageContract(Text2ImageSubmitBodySchema, request, "text2image direct submit request")
  const draft = parseJsonObjectText(body.draft_content, "text2image direct draft_content")
  decodeText2ImageContract(Text2ImageDraftSchema, draft, "text2image direct draft_content")
  const metrics = parseJsonObjectText(body.metrics_extra, "text2image direct metrics_extra")
  const parsedMetrics = decodeText2ImageContract(Text2ImageMetricsSchema, metrics, "text2image direct metrics_extra")
  const sceneOptions = parseJsonTextValue(parsedMetrics.sceneOptions, "text2image direct sceneOptions")
  decodeText2ImageContract(Text2ImageSceneOptionsSchema, sceneOptions, "text2image direct sceneOptions")
}

export function modelVersionToImageReqKey(modelVersion: string): string {
  const key = JIMENG_TEXT2IMAGE_MODEL_REQ_KEYS[modelVersion.trim()]
  if (!key) {
    throw new Error(`No direct text2image model_req_key mapping for modelVersion=${modelVersion}`)
  }
  return key
}

function parseResolution(value: string | undefined): JimengText2ImageResolution {
  const resolution = value?.trim() || "2k"
  if (resolution === "1k" || resolution === "2k" || resolution === "4k") return resolution
  throw new Error(`Unsupported text2image resolution: ${resolution}`)
}

function parseRatio(value: string | undefined): JimengText2ImageRatio {
  const ratio = value?.trim() || "1:1"
  if (ratio === "1:1" || ratio === "4:3" || ratio === "3:4" || ratio === "16:9" || ratio === "9:16" || ratio === "3:2" || ratio === "2:3" || ratio === "21:9") {
    return ratio
  }
  throw new Error(`Unsupported text2image ratio: ${ratio}`)
}

function parseSampleStrength(value: number | undefined): number {
  if (value === undefined) return 0.5
  if (Number.isFinite(value) && value >= 0 && value <= 1) return value
  throw new Error("--sampleStrength must be a number from 0 to 1")
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

function decodeText2ImageContract<A>(schema: Schema.Decoder<A>, value: JsonValue, operation: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "upstream",
      code: "JIMENG_TEXT2IMAGE_CONTRACT_CHANGED",
      message: `${operation}: Jimeng text-to-image direct request did not match required fields.`,
      retryable: false,
      details: {
        operation,
        error: message,
      },
    })
  }
}
