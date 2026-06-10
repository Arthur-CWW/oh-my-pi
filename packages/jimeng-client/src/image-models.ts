import { createHash } from "node:crypto"
import { z } from "zod"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient } from "./client"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { JimengJsonObjectSchema, JimengJsonValueSchema, parseJimengApiEnvelope, parseJimengContract, parseJsonText } from "./schema"

const DEFAULT_QUERY = "aid=513695&web_version=7.5.0&da_version=3.3.17&aigc_features=app_lip_sync"
const OptionalString = z.string().nullable().optional()
const OptionalNumber = z.number().nullable().optional()
const OptionalBoolean = z.boolean().nullable().optional()

const SampleStepsWireSchema = z.object({
  steps: OptionalNumber,
  min_steps: OptionalNumber,
  minSteps: OptionalNumber,
  max_steps: OptionalNumber,
  maxSteps: OptionalNumber,
}).passthrough()

const ImageRatioSizeWireSchema = z.object({
  ratio_type: OptionalNumber,
  ratioType: OptionalNumber,
  width: OptionalNumber,
  height: OptionalNumber,
}).passthrough()

const ResolutionWireSchema = z.object({
  resolution_name: OptionalString,
  resolutionName: OptionalString,
  image_ratio_sizes: z.array(ImageRatioSizeWireSchema).nullable().optional(),
  imageRatioSizes: z.array(ImageRatioSizeWireSchema).nullable().optional(),
}).passthrough()

const ImageModelExtraWireSchema = z.object({
  model_source: OptionalString,
  modelSource: OptionalString,
  raw_model_source: OptionalString,
  rawModelSource: OptionalString,
  max_batch_gen_count: OptionalNumber,
  maxBatchGenCount: OptionalNumber,
  aigc_compliance_confirmation_required: OptionalBoolean,
  aigcComplianceConfirmationRequired: OptionalBoolean,
  enable_task_cancel: OptionalBoolean,
  enableTaskCancel: OptionalBoolean,
}).passthrough()

const ImageModelWireSchema = z.object({
  model_req_key: OptionalString,
  modelReqKey: OptionalString,
  model_name: OptionalString,
  modelName: OptionalString,
  model_tip: OptionalString,
  modelTip: OptionalString,
  model_status: OptionalNumber,
  modelStatus: OptionalNumber,
  generation_category_name: OptionalString,
  generationCategoryName: OptionalString,
  feats: z.array(z.string()).nullable().optional(),
  blend_enable: z.record(z.string(), z.boolean()).nullable().optional(),
  blendEnable: z.record(z.string(), z.boolean()).nullable().optional(),
  feat_config: JimengJsonObjectSchema.nullable().optional(),
  featConfig: JimengJsonObjectSchema.nullable().optional(),
  resolution_map: z.record(z.string(), ResolutionWireSchema).nullable().optional(),
  resolutionMap: z.record(z.string(), ResolutionWireSchema).nullable().optional(),
  sample_steps: SampleStepsWireSchema.nullable().optional(),
  sampleSteps: SampleStepsWireSchema.nullable().optional(),
  commercial_config: JimengJsonObjectSchema.nullable().optional(),
  commercialConfig: JimengJsonObjectSchema.nullable().optional(),
  extra: ImageModelExtraWireSchema.nullable().optional(),
}).passthrough()

const ImageModelConfigDataWireSchema = z.object({
  model_list: z.array(ImageModelWireSchema).nullable().optional(),
  modelList: z.array(ImageModelWireSchema).nullable().optional(),
  default_model_index: OptionalNumber,
  defaultModelIndex: OptionalNumber,
  first_selected_model: JimengJsonValueSchema.nullable().optional(),
  firstSelectedModel: JimengJsonValueSchema.nullable().optional(),
  is_internal: OptionalBoolean,
  isInternal: OptionalBoolean,
  disable_multi_model: OptionalBoolean,
  disableMultiModel: OptionalBoolean,
}).passthrough()

export interface JimengImageModelsQuery {
  isClientFilter?: boolean
  needBetaModel?: boolean
  needCache?: boolean
  needRefresh?: boolean
}

export interface JimengImageModel {
  modelReqKey: string
  modelName: string | null
  modelTip: string | null
  modelStatus: number | null
  generationCategoryName: string | null
  feats: string[]
  highValueFeats: string[]
  blendControls: string[]
  featConfigKeys: string[]
  resolutionKeys: string[]
  resolutionPresets: Array<{
    key: string
    name: string | null
    ratioCount: number
    firstRatio: { ratioType: number | null; width: number | null; height: number | null } | null
  }>
  sampleSteps: { steps: number | null; minSteps: number | null; maxSteps: number | null } | null
  commercialBenefitTypes: string[]
  commercialResourceIds: string[]
  modelSource: string | null
  maxBatchGenCount: number | null
  complianceConfirmationRequired: boolean | null
  taskCancelEnabled: boolean | null
}

export interface JimengImageModelsResult {
  endpoint: "/mweb/v1/get_common_config"
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  query: JsonObject
  modelCount: number
  defaultModelIndex: number | null
  firstSelectedModel: JsonValue
  isInternal: boolean | null
  disableMultiModel: boolean | null
  models: JimengImageModel[]
  body: JsonValue
}

export function buildJimengImageModelsRequest(query: JimengImageModelsQuery = {}): JsonObject {
  return {
    isClientFilter: query.isClientFilter ?? true,
    needBetaModel: query.needBetaModel ?? true,
  }
}

export async function fetchJimengImageModels(input: {
  client?: JimengClient
  session: JimengSessionBundle
  query?: JimengImageModelsQuery
}): Promise<JimengImageModelsResult> {
  const request = buildJimengImageModelsRequest(input.query)
  const query = buildQuery(input.query)
  const client = input.client ?? new JimengClient()
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/get_common_config?${query.toString()}`, {
    method: "POST",
    headers: buildImageModelsHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = parseJsonText(response.text, "image models")
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "image models")
  const parsed = parseJimengImageModelsBody(body)
  return {
    endpoint: "/mweb/v1/get_common_config",
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    query: Object.fromEntries(query.entries()),
    ...parsed,
    body,
  }
}

export function parseJimengImageModelsBody(body: JsonValue): Omit<
  JimengImageModelsResult,
  "endpoint" | "httpStatus" | "ret" | "errmsg" | "responseTextSha256" | "request" | "query" | "body"
> {
  const envelope = parseJimengApiEnvelope(body, "image models")
  if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_RESPONSE_DATA_MAP_CHANGED",
      message: "image models response data was not an object map.",
      retryable: false,
      details: { operation: "image models" },
    })
  }
  const data = parseJimengContract(ImageModelConfigDataWireSchema, envelope.data, "image models")
  const modelList = data.model_list ?? data.modelList
  if (!modelList) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_RESPONSE_MODEL_LIST_CHANGED",
      message: "image models response did not include data.model_list.",
      retryable: false,
      details: { operation: "image models" },
    })
  }
  const models = modelList.map(parseImageModel).filter((model): model is JimengImageModel => !!model)
  return {
    modelCount: models.length,
    defaultModelIndex: numberValue(data.default_model_index) ?? numberValue(data.defaultModelIndex),
    firstSelectedModel: data.first_selected_model ?? data.firstSelectedModel ?? null,
    isInternal: booleanValue(data.is_internal) ?? booleanValue(data.isInternal),
    disableMultiModel: booleanValue(data.disable_multi_model) ?? booleanValue(data.disableMultiModel),
    models,
  }
}

export function summarizeJimengImageModels(result: JimengImageModelsResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    query: result.query,
    model_count: result.modelCount,
    default_model_index: result.defaultModelIndex,
    first_selected_model: result.firstSelectedModel,
    is_internal: result.isInternal,
    disable_multi_model: result.disableMultiModel,
    model_req_keys: result.models.map((model) => model.modelReqKey),
    high_value_flags: {
      control_or_reference_feats: sortedUnique(result.models.flatMap((model) => model.highValueFeats)),
      blend_controls: sortedUnique(result.models.flatMap((model) => model.blendControls)),
      commercial_benefit_types: sortedUnique(result.models.flatMap((model) => model.commercialBenefitTypes)),
    },
    models: result.models.map((model) => ({
      model_req_key: model.modelReqKey,
      model_name: model.modelName,
      model_tip: model.modelTip,
      model_status: model.modelStatus,
      generation_category_name: model.generationCategoryName,
      feats: model.feats,
      high_value_feats: model.highValueFeats,
      blend_controls: model.blendControls,
      feat_config_keys: model.featConfigKeys,
      resolution_keys: model.resolutionKeys,
      resolution_presets: model.resolutionPresets,
      sample_steps: model.sampleSteps,
      commercial_benefit_types: model.commercialBenefitTypes,
      commercial_resource_ids: model.commercialResourceIds,
      model_source: model.modelSource,
      max_batch_gen_count: model.maxBatchGenCount,
      compliance_confirmation_required: model.complianceConfirmationRequired,
      task_cancel_enabled: model.taskCancelEnabled,
    })),
  }
}

function parseImageModel(model: z.infer<typeof ImageModelWireSchema>): JimengImageModel | null {
  const modelReqKey = stringValue(model.model_req_key) ?? stringValue(model.modelReqKey)
  if (!modelReqKey) return null
  const feats = sortedUnique(model.feats ?? [])
  const resolutionMap = model.resolution_map ?? model.resolutionMap ?? {}
  const sampleSteps = model.sample_steps ?? model.sampleSteps
  const extra = model.extra
  const commercialConfig = model.commercial_config ?? model.commercialConfig ?? {}
  return {
    modelReqKey,
    modelName: stringValue(model.model_name) ?? stringValue(model.modelName),
    modelTip: stringValue(model.model_tip) ?? stringValue(model.modelTip),
    modelStatus: numberValue(model.model_status) ?? numberValue(model.modelStatus),
    generationCategoryName: stringValue(model.generation_category_name) ?? stringValue(model.generationCategoryName),
    feats,
    highValueFeats: feats.filter((feat) => /character|face_swap|bg_paint|ip_keep|byte_edit|pose|canny|depth|support_subject|style|refuse_image|smart_scale/i.test(feat)),
    blendControls: Object.entries(model.blend_enable ?? model.blendEnable ?? {})
      .filter((entry) => entry[1])
      .map((entry) => entry[0])
      .sort(),
    featConfigKeys: Object.keys(model.feat_config ?? model.featConfig ?? {}).sort(),
    resolutionKeys: Object.keys(resolutionMap).sort(),
    resolutionPresets: Object.entries(resolutionMap).map(([key, value]) => parseResolutionPreset(key, value)).sort((left, right) => left.key.localeCompare(right.key)),
    sampleSteps: sampleSteps ? {
      steps: numberValue(sampleSteps.steps),
      minSteps: numberValue(sampleSteps.min_steps) ?? numberValue(sampleSteps.minSteps),
      maxSteps: numberValue(sampleSteps.max_steps) ?? numberValue(sampleSteps.maxSteps),
    } : null,
    commercialBenefitTypes: sortedUnique(collectCommercialStrings(commercialConfig, "benefit_type")),
    commercialResourceIds: sortedUnique(collectCommercialStrings(commercialConfig, "resource_id")),
    modelSource: stringValue(extra?.model_source) ?? stringValue(extra?.modelSource) ?? stringValue(extra?.raw_model_source) ?? stringValue(extra?.rawModelSource),
    maxBatchGenCount: numberValue(extra?.max_batch_gen_count) ?? numberValue(extra?.maxBatchGenCount),
    complianceConfirmationRequired: booleanValue(extra?.aigc_compliance_confirmation_required) ?? booleanValue(extra?.aigcComplianceConfirmationRequired),
    taskCancelEnabled: booleanValue(extra?.enable_task_cancel) ?? booleanValue(extra?.enableTaskCancel),
  }
}

function parseResolutionPreset(key: string, value: z.infer<typeof ResolutionWireSchema>): JimengImageModel["resolutionPresets"][number] {
  const ratios = value.image_ratio_sizes ?? value.imageRatioSizes ?? []
  const firstRatio = ratios[0]
  return {
    key,
    name: stringValue(value.resolution_name) ?? stringValue(value.resolutionName),
    ratioCount: ratios.length,
    firstRatio: firstRatio ? {
      ratioType: numberValue(firstRatio.ratio_type) ?? numberValue(firstRatio.ratioType),
      width: numberValue(firstRatio.width),
      height: numberValue(firstRatio.height),
    } : null,
  }
}

function buildQuery(query: JimengImageModelsQuery = {}): URLSearchParams {
  const params = new URLSearchParams(DEFAULT_QUERY)
  params.set("needCache", String(query.needCache ?? true))
  params.set("needRefresh", String(query.needRefresh ?? false))
  return params
}

function buildImageModelsHeaders(session: JimengSessionBundle): Record<string, string> {
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

function collectCommercialStrings(value: JsonValue, targetKey: string): string[] {
  const found: string[] = []
  visit(value)
  return found

  function visit(current: JsonValue): void {
    if (!current || typeof current !== "object") return
    if (Array.isArray(current)) {
      for (const item of current) visit(item)
      return
    }
    for (const [key, child] of Object.entries(current)) {
      if (key === targetKey && typeof child === "string" && child.length > 0) found.push(child)
      visit(child)
    }
  }
}

function assertJimengSuccess(body: JsonValue, operation: string): void {
  const ret = retValue(body)
  if (ret === "0" || ret === 0) return
  throw jimengError({
    category: "upstream",
    code: "JIMENG_API_REJECTED",
    message: `${operation} failed (ret=${String(ret ?? "missing")}, errmsg=${errmsgValue(body) ?? "missing"})`,
    retryable: false,
    details: { operation, ret, errmsg: errmsgValue(body) },
  })
}

function retValue(body: JsonValue): string | number | null {
  const value = asRecord(body)?.ret
  return typeof value === "string" || typeof value === "number" ? value : null
}

function errmsgValue(body: JsonValue): string | null {
  return stringValue(asRecord(body)?.errmsg)
}

function asRecord(value: JsonValue | undefined | null): JsonObject | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanValue(value: JsonValue | undefined): boolean | null {
  return typeof value === "boolean" ? value : null
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort()
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
