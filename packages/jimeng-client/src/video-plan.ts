import { randomUUID } from "node:crypto"
import { Schema } from "effect"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"

export const JIMENG_VIDEO_DIRECT_ENDPOINT = "/mweb/v1/aigc_draft/generate" as const
export const JIMENG_VIDEO_DIRECT_QUERY = "aid=513695&device_platform=web&region=cn&da_version=3.3.9&os=mac&web_component_open_flag=1&web_version=7.5.0&aigc_features=app_lip_sync" as const
export const JIMENG_VIDEO_OMNI_QUERY = "aid=513695&device_platform=web&region=cn&da_version=3.3.17&os=mac&web_component_open_flag=1&web_version=7.5.0&aigc_features=app_lip_sync" as const

export const JIMENG_VIDEO_MODEL_REQ_KEYS: Record<string, string> = {
  "jimeng-video-3.0-fast": "dreamina_ic_generate_video_model_vgfm_3.0_fast",
  "3.0fast": "dreamina_ic_generate_video_model_vgfm_3.0_fast",
  "3.0_fast": "dreamina_ic_generate_video_model_vgfm_3.0_fast",
  vgfm30fast: "dreamina_ic_generate_video_model_vgfm_3.0_fast",
  "vgfm_3.0_fast": "dreamina_ic_generate_video_model_vgfm_3.0_fast",
  dreamina_ic_generate_video_model_vgfm_3_0_fast: "dreamina_ic_generate_video_model_vgfm_3.0_fast",
  "dreamina_ic_generate_video_model_vgfm_3.0_fast": "dreamina_ic_generate_video_model_vgfm_3.0_fast",
  "jimeng-video-seedance-2.0": "dreamina_seedance_40_pro",
  "seedance2.0": "dreamina_seedance_40_pro",
  "seedance-2.0": "dreamina_seedance_40_pro",
  seedance20: "dreamina_seedance_40_pro",
  dreamina_seedance_40_pro: "dreamina_seedance_40_pro",
  "jimeng-video-seedance-2.0-fast": "dreamina_seedance_40",
  "seedance2.0-fast": "dreamina_seedance_40",
  "seedance-2.0-fast": "dreamina_seedance_40",
  seedance20fast: "dreamina_seedance_40",
  dreamina_seedance_40: "dreamina_seedance_40",
} as const

const DEFAULT_MODEL_VERSION = "jimeng-video-3.0-fast"
const DEFAULT_OMNI_MODEL_VERSION = "jimeng-video-seedance-2.0"
const DRAFT_VERSION = "3.3.9"
const OMNI_DRAFT_VERSION = "3.3.17"
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
  idFactory?: () => string
}

export type JimengVideoOmniMaterialKind = "image" | "video" | 1 | 2

export interface JimengVideoOmniMaterialInput {
  type: JimengVideoOmniMaterialKind
  fieldName?: string
  uri?: string
  vid?: string
  width?: number
  height?: number
  durationSec?: number
  format?: string
  name?: string
  originalFilename?: string
}

export interface JimengVideoOmniReferencePlanInput {
  prompt: string
  materials: JimengVideoOmniMaterialInput[]
  modelVersion?: string
  modelReqKey?: string
  ratio?: string
  durationSec?: number
  fps?: number
  seed?: number
  submitId?: string
  nowMs?: number
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

export interface JimengVideoOmniReferencePlan {
  endpoint: typeof JIMENG_VIDEO_DIRECT_ENDPOINT
  method: "POST"
  query: typeof JIMENG_VIDEO_OMNI_QUERY
  submitId: string
  modelVersion: string
  modelReqKey: string
  ratio: JimengVideoRatio
  durationSec: number
  fps: number
  promptLength: number
  materialList: JsonObject[]
  metaList: JsonObject[]
  materialCounts: Record<"image" | "video", number>
  materialTypes: number[]
  request: JsonObject
  draftContent: JsonObject
  metricsExtra: JsonObject
}

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))

const VideoOmniMaterialInputSchema = Schema.Struct({
  type: Schema.Union([Schema.Literal("image"), Schema.Literal("video"), Schema.Literal(1), Schema.Literal(2)]),
  fieldName: Schema.optional(Schema.String),
  uri: Schema.optional(Schema.String),
  vid: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
  durationSec: Schema.optional(Schema.Number),
  format: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  originalFilename: Schema.optional(Schema.String),
})

const VideoOmniMaterialInputListSchema = Schema.NonEmptyArray(VideoOmniMaterialInputSchema)

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

const VideoOmniDraftSchema = Schema.Struct({
  type: Schema.Literal("draft"),
  version: NonEmptyString,
  min_features: Schema.Array(Schema.String),
  main_component_id: NonEmptyString,
  component_list: Schema.NonEmptyArray(Schema.Struct({
    type: Schema.Literal("video_base_component"),
    aigc_mode: Schema.Literal("workbench"),
    generate_type: Schema.Literal("gen_video"),
    abilities: Schema.Struct({
      gen_video: Schema.Struct({
        text_to_video_params: Schema.Struct({
          video_gen_inputs: Schema.NonEmptyArray(Schema.Struct({
            prompt: Schema.Literal(""),
            video_mode: Schema.Number,
            fps: Schema.Number,
            duration_ms: Schema.Number,
            unified_edit_input: Schema.Struct({
              material_list: Schema.NonEmptyArray(Schema.Struct({
                material_type: Schema.Union([Schema.Literal("image"), Schema.Literal("video")]),
              })),
              meta_list: Schema.NonEmptyArray(Schema.Struct({
                meta_type: NonEmptyString,
              })),
            }),
            idip_meta_list: Schema.Array(Schema.Any),
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

const VideoOmniMetricsSchema = Schema.Struct({
  position: Schema.Literal("page_bottom_box"),
  isDefaultSeed: Schema.Number,
  originSubmitId: NonEmptyString,
  isRegenerate: Schema.Literal(false),
  enterFrom: Schema.Literal("click"),
  functionMode: Schema.Literal("omni_reference"),
  sceneOptions: NonEmptyString,
})

const VideoOmniSceneOptionsSchema = Schema.NonEmptyArray(Schema.Struct({
  type: Schema.Literal("video"),
  scene: Schema.Literal("BasicVideoGenerateButton"),
  modelReqKey: NonEmptyString,
  videoDuration: Schema.Number,
  materialTypes: Schema.NonEmptyArray(Schema.Number),
  reportParams: Schema.Struct({
    enterSource: Schema.Literal("generate"),
    vipSource: Schema.Literal("generate"),
    extraVipFunctionKey: NonEmptyString,
    useVipFunctionDetailsReporterHoc: Schema.Literal(true),
  }),
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
  const makeId = input.idFactory ?? randomUUID
  const submitId = input.submitId?.trim() || makeId()
  const componentId = makeId()
  const draftId = makeId()
  const nowMs = Math.floor(input.nowMs ?? Date.now())

  const videoInput: JsonObject = {
    type: "",
    id: makeId(),
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
        id: makeId(),
        created_platform: 3,
        created_platform_version: "",
        created_time_in_ms: String(nowMs),
        created_did: "",
      },
      generate_type: "gen_video",
      abilities: {
        type: "",
        id: makeId(),
        gen_video: {
          type: "",
          id: makeId(),
          text_to_video_params: {
            type: "",
            id: makeId(),
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

export function parseJimengVideoOmniMaterialsJson(value: JsonValue): JimengVideoOmniMaterialInput[] {
  return decodeVideoContract(
    VideoOmniMaterialInputListSchema,
    value,
    "video omni-reference material list",
  ).map((material) => ({ ...material }))
}

export function buildJimengVideoOmniReferencePlan(input: JimengVideoOmniReferencePlanInput): JimengVideoOmniReferencePlan {
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error("omni-video-plan requires a non-empty prompt")
  const modelVersion = input.modelVersion?.trim() || DEFAULT_OMNI_MODEL_VERSION
  const modelReqKey = input.modelReqKey?.trim() || modelVersionToDirectVideoReqKey(modelVersion)
  assertOmniVideoModel(modelReqKey)
  const ratio = parseRatio(input.ratio)
  const durationSec = parseDurationSec(input.durationSec ?? 5)
  const fps = parseFps(input.fps)
  const seed = parseSeed(input.seed)
  const submitId = input.submitId?.trim() || randomUUID()
  const componentId = randomUUID()
  const draftId = randomUUID()
  const nowMs = Math.floor(input.nowMs ?? Date.now())
  const materials = normalizeOmniMaterials(input.materials)
  const materialList = materials.map((material) => material.request)
  const metaList = buildOmniMetaList(prompt, materials)
  const materialTypes = materials.map((material) => material.materialType)
  const benefitType = omniBenefitType(modelReqKey)

  const sceneOptions: JsonObject[] = [{
    type: "video",
    scene: "BasicVideoGenerateButton",
    modelReqKey,
    videoDuration: durationSec,
    materialTypes,
    reportParams: {
      enterSource: "generate",
      vipSource: "generate",
      extraVipFunctionKey: modelReqKey,
      useVipFunctionDetailsReporterHoc: true,
    },
  }]
  const metricsExtra: JsonObject = {
    position: "page_bottom_box",
    isDefaultSeed: input.seed === undefined ? 1 : 0,
    originSubmitId: submitId,
    isRegenerate: false,
    enterFrom: "click",
    functionMode: "omni_reference",
    sceneOptions: JSON.stringify(sceneOptions),
  }
  const draftContent: JsonObject = {
    type: "draft",
    id: draftId,
    min_version: OMNI_DRAFT_VERSION,
    min_features: ["AIGC_Video_UnifiedEdit"],
    is_from_tsn: true,
    version: OMNI_DRAFT_VERSION,
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
            video_gen_inputs: [{
              type: "",
              id: randomUUID(),
              min_version: OMNI_DRAFT_VERSION,
              prompt: "",
              video_mode: 2,
              fps,
              duration_ms: durationSec * 1000,
              unified_edit_input: {
                type: "",
                id: randomUUID(),
                material_list: materialList,
                meta_list: metaList,
              },
              idip_meta_list: [],
            }],
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
      m_video_commerce_info: {
        benefit_type: benefitType,
        resource_id: "generate_video",
        resource_id_type: "str",
        resource_sub_type: "aigc",
      },
      m_video_commerce_info_list: [{
        benefit_type: benefitType,
        resource_id: "generate_video",
        resource_id_type: "str",
        resource_sub_type: "aigc",
      }],
    },
    submit_id: submitId,
    metrics_extra: JSON.stringify(metricsExtra),
    draft_content: JSON.stringify(draftContent),
    http_common_info: {
      aid: 513695,
    },
  }

  validateJimengVideoOmniReferenceRequest(request)

  return {
    endpoint: JIMENG_VIDEO_DIRECT_ENDPOINT,
    method: "POST",
    query: JIMENG_VIDEO_OMNI_QUERY,
    submitId,
    modelVersion,
    modelReqKey,
    ratio,
    durationSec,
    fps,
    promptLength: prompt.length,
    materialList,
    metaList,
    materialCounts: countOmniMaterials(materials),
    materialTypes,
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

export function summarizeJimengVideoOmniReferencePlan(plan: JimengVideoOmniReferencePlan): JsonObject {
  return {
    endpoint: plan.endpoint,
    method: plan.method,
    query: plan.query,
    submit_id: plan.submitId,
    model_version: plan.modelVersion,
    model_req_key: plan.modelReqKey,
    ratio: plan.ratio,
    duration_sec: plan.durationSec,
    fps: plan.fps,
    function_mode: "omni_reference",
    prompt_length: plan.promptLength,
    material_count: plan.materialList.length,
    material_counts: plan.materialCounts,
    material_types: plan.materialTypes,
    meta_count: plan.metaList.length,
    meta_types: plan.metaList.map((meta) => meta.meta_type),
    has_metrics_extra: typeof plan.request.metrics_extra === "string",
    has_draft_content: typeof plan.request.draft_content === "string",
    live_submit: false,
    next_compare_command: "jimeng-browser-proxy omni-video-compare --plan <dry-run-plan.json> --rawNetwork <capture>/raw-network.jsonl",
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

export function validateJimengVideoOmniReferenceRequest(request: JsonObject): void {
  const body = decodeVideoContract(VideoSubmitBodySchema, request, "video omni-reference submit request")
  const draft = parseJsonObjectText(body.draft_content, "video omni-reference draft_content")
  decodeVideoContract(VideoOmniDraftSchema, draft, "video omni-reference draft_content")
  const metrics = parseJsonObjectText(body.metrics_extra, "video omni-reference metrics_extra")
  const parsedMetrics = decodeVideoContract(VideoOmniMetricsSchema, metrics, "video omni-reference metrics_extra")
  const sceneOptions = parseJsonTextValue(parsedMetrics.sceneOptions, "video omni-reference sceneOptions")
  decodeVideoContract(VideoOmniSceneOptionsSchema, sceneOptions, "video omni-reference sceneOptions")
}

export function modelVersionToDirectVideoReqKey(modelVersion: string): string {
  const key = JIMENG_VIDEO_MODEL_REQ_KEYS[modelVersion.trim()]
  if (!key) {
    throw new Error(`No direct video model_req_key mapping for modelVersion=${modelVersion}`)
  }
  return key
}

interface NormalizedOmniMaterial {
  kind: "image" | "video"
  fieldName: string
  aliases: string[]
  request: JsonObject
  materialType: 1 | 2
}

function normalizeOmniMaterials(materials: JimengVideoOmniMaterialInput[]): NormalizedOmniMaterial[] {
  if (materials.length === 0) throw new Error("omni-video-plan requires at least one image or video material")
  if (materials.length > 12) throw new Error("omni-video-plan supports at most 12 total materials")
  const normalized: NormalizedOmniMaterial[] = []
  let imageIndex = 1
  let videoIndex = 1
  let totalVideoDurationSec = 0

  for (const material of materials) {
    const kind = normalizeOmniMaterialKind(material.type)
    if (kind === "image") {
      if (imageIndex > 9) throw new Error("omni-video-plan supports at most 9 image materials")
      const fieldName = normalizeOmniFieldName(material.fieldName, `image_file_${imageIndex}`)
      const uri = normalizeProviderRef(material.uri, `${fieldName} image uri`)
      const width = normalizePixelDimension(material.width, `${fieldName} width`)
      const height = normalizePixelDimension(material.height, `${fieldName} height`)
      const format = material.format?.trim() ?? ""
      const name = material.name?.trim() ?? ""
      normalized.push({
        kind,
        fieldName,
        aliases: omniAliases(fieldName, material),
        materialType: 1,
        request: {
          type: "",
          id: randomUUID(),
          material_type: "image",
          image_info: {
            type: "image",
            id: randomUUID(),
            source_from: "upload",
            platform_type: 1,
            name,
            image_uri: uri,
            width,
            height,
            format,
            uri,
          },
        },
      })
      imageIndex += 1
      continue
    }

    if (videoIndex > 3) throw new Error("omni-video-plan supports at most 3 video materials")
    const fieldName = normalizeOmniFieldName(material.fieldName, `video_file_${videoIndex}`)
    const vid = normalizeProviderRef(material.vid ?? material.uri, `${fieldName} vid`)
    const width = normalizePixelDimension(material.width, `${fieldName} width`)
    const height = normalizePixelDimension(material.height, `${fieldName} height`)
    const durationSec = normalizeDurationForMaterial(material.durationSec, `${fieldName} durationSec`)
    totalVideoDurationSec += durationSec
    if (totalVideoDurationSec > 15.4) throw new Error("omni-video-plan supports at most 15.4 total reference-video seconds")
    normalized.push({
      kind,
      fieldName,
      aliases: omniAliases(fieldName, material),
      materialType: 2,
      request: {
        type: "",
        id: randomUUID(),
        material_type: "video",
        video_info: {
          type: "video",
          id: randomUUID(),
          source_from: "upload",
          name: material.name?.trim() ?? "",
          vid,
          fps: 0,
          width,
          height,
          duration: Math.round(durationSec * 1000),
        },
      },
    })
    videoIndex += 1
  }
  return normalized
}

function normalizeOmniMaterialKind(type: JimengVideoOmniMaterialKind): "image" | "video" {
  if (type === "image" || type === 1) return "image"
  if (type === "video" || type === 2) return "video"
  throw new Error(`Unsupported omni material type: ${String(type)}`)
}

function normalizeOmniFieldName(value: string | undefined, fallback: string): string {
  const fieldName = value?.trim() || fallback
  if (!/^(image_file|video_file)(_\d+)?$/.test(fieldName)) {
    throw new Error("--materials fieldName must look like image_file_1 or video_file_1 for omni-video-plan")
  }
  return fieldName
}

function normalizeProviderRef(value: string | undefined, label: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function normalizePixelDimension(value: number | undefined, label: string): number {
  if (value === undefined) return 0
  if (Number.isInteger(value) && value >= 0 && value <= 8192) return value
  throw new Error(`${label} must be an integer from 0 to 8192`)
}

function normalizeDurationForMaterial(value: number | undefined, label: string): number {
  if (value === undefined) return 0
  if (Number.isFinite(value) && value >= 0 && value <= 15.4) return value
  throw new Error(`${label} must be a number from 0 to 15.4`)
}

function omniAliases(fieldName: string, material: JimengVideoOmniMaterialInput): string[] {
  return sortedUnique([
    fieldName,
    material.originalFilename?.trim(),
    material.name?.trim(),
  ].filter((value): value is string => !!value))
}

function buildOmniMetaList(prompt: string, materials: NormalizedOmniMaterial[]): JsonObject[] {
  const aliasEntries = materials.flatMap((material, materialIndex) =>
    material.aliases.map((alias) => ({ alias, material, materialIndex })),
  )
  if (aliasEntries.length === 0) return [{ meta_type: "text", text: prompt }]
  const pattern = new RegExp(`@(${aliasEntries.map((entry) => escapeRegExp(entry.alias)).sort((left, right) => right.length - left.length).join("|")})`, "g")
  const metaList: JsonObject[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null = pattern.exec(prompt)
  while (match) {
    if (match.index > lastIndex) {
      const text = prompt.slice(lastIndex, match.index)
      if (text) metaList.push({ meta_type: "text", text })
    }
    const alias = match[1] ?? ""
    const entry = aliasEntries.find((candidate) => candidate.alias === alias)
    if (entry) {
      metaList.push({
        meta_type: entry.material.kind,
        text: "",
        material_ref: {
          material_idx: entry.materialIndex,
        },
      })
    }
    lastIndex = pattern.lastIndex
    match = pattern.exec(prompt)
  }
  if (lastIndex < prompt.length) {
    const text = prompt.slice(lastIndex)
    if (text) metaList.push({ meta_type: "text", text })
  }
  return metaList.length > 0 ? metaList : [{ meta_type: "text", text: prompt }]
}

function countOmniMaterials(materials: NormalizedOmniMaterial[]): Record<"image" | "video", number> {
  const counts = { image: 0, video: 0 }
  for (const material of materials) counts[material.kind] += 1
  return counts
}

function assertOmniVideoModel(modelReqKey: string): void {
  if (modelReqKey === "dreamina_seedance_40_pro" || modelReqKey === "dreamina_seedance_40") return
  throw new Error("omni-video-plan requires Seedance 2.0 modelReqKey dreamina_seedance_40_pro or dreamina_seedance_40")
}

function omniBenefitType(modelReqKey: string): string {
  return modelReqKey === "dreamina_seedance_40" ? "dreamina_seedance_20_fast_with_video" : "dreamina_video_seedance_20_video_add"
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
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
