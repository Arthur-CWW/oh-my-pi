import { createHash } from "node:crypto"
import { z } from "zod"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient, type JimengFetch } from "./client"
import { jimengError } from "./errors"
import { jimengReferenceControlEvidence, JIMENG_REFERENCE_CONTROL_KINDS, type JimengReferenceControlKind } from "./reference-controls"
import { type JsonObject, type JsonValue } from "./reference-image"
import { JimengJsonObjectSchema, JimengJsonValueSchema, parseJimengApiEnvelope, parseJimengContract, parseJsonText } from "./schema"

const DEFAULT_QUERY = "aid=513695&web_version=7.5.0&da_version=3.3.17&aigc_features=app_lip_sync"
const OptionalString = z.string().nullable().optional()
const OptionalNumber = z.number().nullable().optional()
const OptionalBoolean = z.boolean().nullable().optional()

const AgentSkillWireSchema = z.object({
  id: OptionalString,
  name: OptionalString,
  default_title: OptionalString,
  defaultTitle: OptionalString,
  default_desc: OptionalString,
  defaultDesc: OptionalString,
  default_guide_text: OptionalString,
  defaultGuideText: OptionalString,
}).passthrough()

const AgentSkillDataWireSchema = z.object({
  official_skills: z.array(AgentSkillWireSchema).nullable().optional(),
  officialSkills: z.array(AgentSkillWireSchema).nullable().optional(),
  skills: z.array(AgentSkillWireSchema).nullable().optional(),
  total_count: OptionalNumber,
  totalCount: OptionalNumber,
  has_more: OptionalBoolean,
  hasMore: OptionalBoolean,
  next_offset: OptionalNumber,
  nextOffset: OptionalNumber,
}).passthrough()

const EnumValueWireSchema = z.object({
  enum_type: OptionalString,
  enumType: OptionalString,
  string_value: z.array(z.string()).nullable().optional(),
  stringValue: z.array(z.string()).nullable().optional(),
  int_value: z.array(z.number()).nullable().optional(),
  intValue: z.array(z.number()).nullable().optional(),
  double_value: z.array(z.number()).nullable().optional(),
  doubleValue: z.array(z.number()).nullable().optional(),
  default_val_idx: OptionalNumber,
  defaultValIdx: OptionalNumber,
}).passthrough()

const MaterialLimitWireSchema = z.object({
  max_count: OptionalNumber,
  maxCount: OptionalNumber,
  min_duration: OptionalNumber,
  minDuration: OptionalNumber,
  max_duration: OptionalNumber,
  maxDuration: OptionalNumber,
  min_width: OptionalNumber,
  minWidth: OptionalNumber,
  max_width: OptionalNumber,
  maxWidth: OptionalNumber,
  min_height: OptionalNumber,
  minHeight: OptionalNumber,
  max_height: OptionalNumber,
  maxHeight: OptionalNumber,
  max_file_size: OptionalNumber,
  maxFileSize: OptionalNumber,
}).passthrough()

const SupportedMaterialWireSchema = z.object({
  material_type: OptionalNumber,
  materialType: OptionalNumber,
  limit: MaterialLimitWireSchema.nullable().optional(),
}).passthrough()

const RequiredMaterialTypesWireSchema = z.object({
  any_of: z.array(z.number()).nullable().optional(),
  anyOf: z.array(z.number()).nullable().optional(),
}).passthrough()

const UnifiedEditConfigWireSchema = z.object({
  supported_materials: z.array(SupportedMaterialWireSchema).nullable().optional(),
  supportedMaterials: z.array(SupportedMaterialWireSchema).nullable().optional(),
  max_total_count: OptionalNumber,
  maxTotalCount: OptionalNumber,
  max_total_video_duration: OptionalNumber,
  maxTotalVideoDuration: OptionalNumber,
  max_total_audio_duration: OptionalNumber,
  maxTotalAudioDuration: OptionalNumber,
  required_material_types: RequiredMaterialTypesWireSchema.nullable().optional(),
  requiredMaterialTypes: RequiredMaterialTypesWireSchema.nullable().optional(),
}).passthrough()

const ModelOptionWireSchema = z.object({
  key: OptionalString,
  value_type: OptionalString,
  valueType: OptionalString,
  enum_val: EnumValueWireSchema.nullable().optional(),
  enumVal: EnumValueWireSchema.nullable().optional(),
  forbidden_display: OptionalBoolean,
  forbiddenDisplay: OptionalBoolean,
  unified_edit_config: UnifiedEditConfigWireSchema.nullable().optional(),
  unifiedEditConfig: UnifiedEditConfigWireSchema.nullable().optional(),
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

const SampleStepsWireSchema = z.object({
  steps: OptionalNumber,
  min_steps: OptionalNumber,
  minSteps: OptionalNumber,
  max_steps: OptionalNumber,
  maxSteps: OptionalNumber,
}).passthrough()

const ModelExtraWireSchema = z.object({
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

const AgentModelWireSchema = z.object({
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
  options: z.array(ModelOptionWireSchema).nullable().optional(),
  blend_enable: z.record(z.string(), z.boolean()).nullable().optional(),
  blendEnable: z.record(z.string(), z.boolean()).nullable().optional(),
  feat_config: JimengJsonObjectSchema.nullable().optional(),
  featConfig: JimengJsonObjectSchema.nullable().optional(),
  resolution_map: z.record(z.string(), ResolutionWireSchema).nullable().optional(),
  resolutionMap: z.record(z.string(), ResolutionWireSchema).nullable().optional(),
  sample_steps: SampleStepsWireSchema.nullable().optional(),
  sampleSteps: SampleStepsWireSchema.nullable().optional(),
  extra: ModelExtraWireSchema.nullable().optional(),
}).passthrough()

const AgentModelDataWireSchema = z.object({
  model_list: z.array(AgentModelWireSchema).nullable().optional(),
  modelList: z.array(AgentModelWireSchema).nullable().optional(),
  default_model_index: OptionalNumber,
  defaultModelIndex: OptionalNumber,
  default_model_idx: OptionalNumber,
  defaultModelIdx: OptionalNumber,
  first_selected_model: JimengJsonValueSchema.nullable().optional(),
  firstSelectedModel: JimengJsonValueSchema.nullable().optional(),
}).passthrough()

const AgentConfigDataWireSchema = z.object({
  image_data: AgentModelDataWireSchema.nullable().optional(),
  imageData: AgentModelDataWireSchema.nullable().optional(),
  video_data: AgentModelDataWireSchema.nullable().optional(),
  videoData: AgentModelDataWireSchema.nullable().optional(),
  skill_data: JimengJsonValueSchema.nullable().optional(),
  skillData: JimengJsonValueSchema.nullable().optional(),
  user_custom_skills_config: JimengJsonValueSchema.nullable().optional(),
  userCustomSkillsConfig: JimengJsonValueSchema.nullable().optional(),
}).passthrough()

export type JimengAgentCatalogEndpoint = "skills" | "config"

export interface JimengAgentSkill {
  id: string
  name: string | null
  title: string | null
  description: string | null
  guideText: string | null
}

export interface JimengAgentModelOption {
  key: string
  valueType: string | null
  enumType: string | null
  stringValues: string[]
  intValues: number[]
  doubleValues: number[]
  defaultValue: string | number | null
  forbiddenDisplay: boolean | null
  supportedMaterials: Array<{
    materialType: number | null
    maxCount: number | null
    minDurationSec: number | null
    maxDurationSec: number | null
    maxWidth: number | null
    maxHeight: number | null
    maxFileSizeMb: number | null
  }>
  maxTotalCount: number | null
  maxTotalVideoDurationSec: number | null
  maxTotalAudioDurationSec: number | null
  requiredMaterialTypesAnyOf: number[]
}

export interface JimengAgentModel {
  modelReqKey: string
  modelName: string | null
  modelTip: string | null
  modelStatus: number | null
  generationCategoryName: string | null
  feats: string[]
  optionKeys: string[]
  options: JimengAgentModelOption[]
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
  modelSource: string | null
  maxBatchGenCount: number | null
  complianceConfirmationRequired: boolean | null
  taskCancelEnabled: boolean | null
}

export interface JimengAgentCatalogResult {
  endpoint: "/mweb/v1/creation_agent/v2/skill/list" | "/mweb/v1/creation_agent/v2/get_agent_config"
  endpointId: JimengAgentCatalogEndpoint
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  skills?: JimengAgentSkill[]
  customSkillCount?: number | null
  imageModels?: JimengAgentModel[]
  videoModels?: JimengAgentModel[]
  body: JsonValue
}

export interface JimengAgentCatalogBundle {
  endpoints: JimengAgentCatalogEndpoint[]
  results: JimengAgentCatalogResult[]
}

export function parseJimengAgentCatalogEndpoints(value: string | undefined): JimengAgentCatalogEndpoint[] {
  if (!value || value === "all") return ["skills", "config"]
  const values = value.split(",").map((part) => part.trim()).filter(Boolean)
  const allowed = new Set<JimengAgentCatalogEndpoint>(["skills", "config"])
  const endpoints: JimengAgentCatalogEndpoint[] = []
  for (const value of values) {
    if (!allowed.has(value as JimengAgentCatalogEndpoint)) {
      throw jimengError({
        category: "validation",
        code: "AGENT_CATALOG_ENDPOINT_INVALID",
        message: "agent-catalog --endpoints must be skills, config, or all.",
        retryable: false,
        details: { endpoint: value, allowed: Array.from(allowed) },
      })
    }
    endpoints.push(value as JimengAgentCatalogEndpoint)
  }
  return Array.from(new Set(endpoints))
}

export function buildJimengAgentSkillsRequest(): JsonObject {
  return { offset: 0, limit: 300, need_official_skills: true }
}

export function buildJimengAgentConfigRequest(): JsonObject {
  return {}
}

export async function fetchJimengAgentCatalog(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  endpoints?: JimengAgentCatalogEndpoint[]
}): Promise<JimengAgentCatalogBundle> {
  const endpoints = input.endpoints ?? ["skills", "config"]
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const results: JimengAgentCatalogResult[] = []
  for (const endpoint of endpoints) {
    if (endpoint === "skills") {
      results.push(await fetchAgentSkills({ client, session: input.session }))
    } else {
      results.push(await fetchAgentConfig({ client, session: input.session }))
    }
  }
  return { endpoints, results }
}

export function summarizeJimengAgentCatalog(bundle: JimengAgentCatalogBundle): JsonObject {
  const skills = bundle.results.find((result) => result.endpointId === "skills")
  const config = bundle.results.find((result) => result.endpointId === "config")
  const imageModels = config?.imageModels ?? []
  const videoModels = config?.videoModels ?? []
  return {
    endpoints: bundle.endpoints,
    result_count: bundle.results.length,
    skills: skills ? {
      http_status: skills.httpStatus,
      ret: skills.ret,
      errmsg: skills.errmsg,
      response_text_sha256: skills.responseTextSha256,
      skill_count: skills.skills?.length ?? 0,
      custom_skill_count: skills.customSkillCount ?? null,
      items: (skills.skills ?? []).map((skill) => ({
        id: skill.id,
        name: skill.name,
        title: skill.title,
        description: skill.description,
        guide_text: skill.guideText,
      })),
    } : null,
    config: config ? {
      http_status: config.httpStatus,
      ret: config.ret,
      errmsg: config.errmsg,
      response_text_sha256: config.responseTextSha256,
      image_model_count: imageModels.length,
      video_model_count: videoModels.length,
      image_models: imageModels.map(summarizeModel),
      video_models: videoModels.map(summarizeModel),
      high_value_flags: {
        image_control_feats: sortedUnique(imageModels.flatMap((model) =>
          model.feats.filter((feat) => /character|face_swap|bg_paint|ip_keep|byte_edit|pose|canny|depth|support_subject|style/i.test(feat))
        )),
        image_blend_controls: sortedUnique(imageModels.flatMap((model) => model.blendControls)),
        image_reference_controls: summarizeReferenceControlCoverage(imageModels),
        video_option_keys: sortedUnique(videoModels.flatMap((model) => model.optionKeys)),
        video_input_media_types: sortedUnique(videoModels.flatMap((model) =>
          model.options.find((option) => option.key === "input_media_type")?.stringValues ?? []
        )),
        video_models_with_multi_frames: videoModels
          .filter((model) => model.optionKeys.includes("multi_frames"))
          .map((model) => model.modelReqKey),
        video_models_with_unified_edit: videoModels
          .filter((model) => model.optionKeys.includes("unified_edit"))
          .map((model) => model.modelReqKey),
      },
    } : null,
  }
}

function summarizeReferenceControlCoverage(imageModels: JimengAgentModel[]): JsonObject[] {
  return JIMENG_REFERENCE_CONTROL_KINDS.map((control) => {
    const evidence = jimengReferenceControlEvidence(control)
    return {
      control,
      preview_supported: evidence.previewSupported,
      evidence_status: evidence.status,
      provider_evidence: evidence.providerEvidence,
      gap: evidence.gap,
      catalog_feat_models: modelsWithFeat(imageModels, control),
      catalog_blend_models: modelsWithBlendControl(imageModels, control),
      catalog_feat_config_models: modelsWithFeatConfig(imageModels, control),
    }
  })
}

async function fetchAgentSkills(input: {
  client: JimengClient
  session: JimengSessionBundle
}): Promise<JimengAgentCatalogResult> {
  const request = buildJimengAgentSkillsRequest()
  const endpoint = "/mweb/v1/creation_agent/v2/skill/list"
  const response = await input.client.requestText(`https://jimeng.jianying.com${endpoint}?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildAgentCatalogHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = parseJsonText(response.text, "agent skills")
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "agent skills")
  return {
    endpoint,
    endpointId: "skills",
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    ...parseAgentSkills(body),
    body,
  }
}

async function fetchAgentConfig(input: {
  client: JimengClient
  session: JimengSessionBundle
}): Promise<JimengAgentCatalogResult> {
  const request = buildJimengAgentConfigRequest()
  const endpoint = "/mweb/v1/creation_agent/v2/get_agent_config"
  const response = await input.client.requestText(`https://jimeng.jianying.com${endpoint}?needCache=true&needRefresh=false&${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildAgentCatalogHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = parseJsonText(response.text, "agent config")
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "agent config")
  return {
    endpoint,
    endpointId: "config",
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    ...parseAgentConfig(body),
    body,
  }
}

function parseAgentSkills(body: JsonValue): { skills: JimengAgentSkill[]; customSkillCount: number | null } {
  const data = parseDataObject(body, AgentSkillDataWireSchema, "agent skills")
  const officialSkills = data.official_skills ?? data.officialSkills ?? []
  const customSkills = data.skills ?? []
  return {
    skills: [...officialSkills, ...customSkills].map(parseSkill).filter((skill): skill is JimengAgentSkill => !!skill),
    customSkillCount: numberValue(data.total_count) ?? numberValue(data.totalCount),
  }
}

function parseAgentConfig(body: JsonValue): { imageModels: JimengAgentModel[]; videoModels: JimengAgentModel[] } {
  const data = parseDataObject(body, AgentConfigDataWireSchema, "agent config")
  const imageData = data.image_data ?? data.imageData
  const videoData = data.video_data ?? data.videoData
  return {
    imageModels: parseModelList(imageData?.model_list ?? imageData?.modelList ?? []),
    videoModels: parseModelList(videoData?.model_list ?? videoData?.modelList ?? []),
  }
}

function parseDataObject<T>(body: JsonValue, schema: z.ZodType<T>, operation: string): T {
  const envelope = parseJimengApiEnvelope(body, operation)
  if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_RESPONSE_DATA_MAP_CHANGED",
      message: `${operation} response data was not an object map.`,
      retryable: false,
      details: { operation },
    })
  }
  return parseJimengContract(schema, envelope.data, operation)
}

function parseSkill(skill: z.infer<typeof AgentSkillWireSchema>): JimengAgentSkill | null {
  const id = stringValue(skill.id)
  if (!id) return null
  return {
    id,
    name: stringValue(skill.name),
    title: stringValue(skill.default_title) ?? stringValue(skill.defaultTitle),
    description: stringValue(skill.default_desc) ?? stringValue(skill.defaultDesc),
    guideText: stringValue(skill.default_guide_text) ?? stringValue(skill.defaultGuideText),
  }
}

function parseModelList(models: Array<z.infer<typeof AgentModelWireSchema>>): JimengAgentModel[] {
  return models.map(parseModel).filter((model): model is JimengAgentModel => !!model)
}

function parseModel(model: z.infer<typeof AgentModelWireSchema>): JimengAgentModel | null {
  const modelReqKey = stringValue(model.model_req_key) ?? stringValue(model.modelReqKey)
  if (!modelReqKey) return null
  const resolutionMap = model.resolution_map ?? model.resolutionMap ?? {}
  const sampleSteps = model.sample_steps ?? model.sampleSteps
  const extra = model.extra
  return {
    modelReqKey,
    modelName: stringValue(model.model_name) ?? stringValue(model.modelName),
    modelTip: stringValue(model.model_tip) ?? stringValue(model.modelTip),
    modelStatus: numberValue(model.model_status) ?? numberValue(model.modelStatus),
    generationCategoryName: stringValue(model.generation_category_name) ?? stringValue(model.generationCategoryName),
    feats: sortedUnique(model.feats ?? []),
    optionKeys: sortedUnique((model.options ?? []).map((option) => stringValue(option.key)).filter((key): key is string => !!key)),
    options: (model.options ?? []).map(parseModelOption).filter((option): option is JimengAgentModelOption => !!option),
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
    modelSource: stringValue(extra?.model_source) ?? stringValue(extra?.modelSource) ?? stringValue(extra?.raw_model_source) ?? stringValue(extra?.rawModelSource),
    maxBatchGenCount: numberValue(extra?.max_batch_gen_count) ?? numberValue(extra?.maxBatchGenCount),
    complianceConfirmationRequired: booleanValue(extra?.aigc_compliance_confirmation_required) ?? booleanValue(extra?.aigcComplianceConfirmationRequired),
    taskCancelEnabled: booleanValue(extra?.enable_task_cancel) ?? booleanValue(extra?.enableTaskCancel),
  }
}

function parseModelOption(option: z.infer<typeof ModelOptionWireSchema>): JimengAgentModelOption | null {
  const key = stringValue(option.key)
  if (!key) return null
  const enumValue = option.enum_val ?? option.enumVal
  const unifiedEdit = option.unified_edit_config ?? option.unifiedEditConfig
  const stringValues = enumValue?.string_value ?? enumValue?.stringValue ?? []
  const intValues = enumValue?.int_value ?? enumValue?.intValue ?? []
  const doubleValues = enumValue?.double_value ?? enumValue?.doubleValue ?? []
  const defaultIndex = numberValue(enumValue?.default_val_idx) ?? numberValue(enumValue?.defaultValIdx)
  return {
    key,
    valueType: stringValue(option.value_type) ?? stringValue(option.valueType),
    enumType: stringValue(enumValue?.enum_type) ?? stringValue(enumValue?.enumType),
    stringValues,
    intValues,
    doubleValues,
    defaultValue: defaultValueForIndex({ stringValues, intValues, doubleValues, defaultIndex }),
    forbiddenDisplay: booleanValue(option.forbidden_display) ?? booleanValue(option.forbiddenDisplay),
    supportedMaterials: (unifiedEdit?.supported_materials ?? unifiedEdit?.supportedMaterials ?? []).map(parseSupportedMaterial),
    maxTotalCount: numberValue(unifiedEdit?.max_total_count) ?? numberValue(unifiedEdit?.maxTotalCount),
    maxTotalVideoDurationSec: numberValue(unifiedEdit?.max_total_video_duration) ?? numberValue(unifiedEdit?.maxTotalVideoDuration),
    maxTotalAudioDurationSec: numberValue(unifiedEdit?.max_total_audio_duration) ?? numberValue(unifiedEdit?.maxTotalAudioDuration),
    requiredMaterialTypesAnyOf: unifiedEdit?.required_material_types?.any_of
      ?? unifiedEdit?.requiredMaterialTypes?.anyOf
      ?? unifiedEdit?.requiredMaterialTypes?.any_of
      ?? [],
  }
}

function parseSupportedMaterial(material: z.infer<typeof SupportedMaterialWireSchema>): JimengAgentModelOption["supportedMaterials"][number] {
  const limit = material.limit
  return {
    materialType: numberValue(material.material_type) ?? numberValue(material.materialType),
    maxCount: numberValue(limit?.max_count) ?? numberValue(limit?.maxCount),
    minDurationSec: numberValue(limit?.min_duration) ?? numberValue(limit?.minDuration),
    maxDurationSec: numberValue(limit?.max_duration) ?? numberValue(limit?.maxDuration),
    maxWidth: numberValue(limit?.max_width) ?? numberValue(limit?.maxWidth),
    maxHeight: numberValue(limit?.max_height) ?? numberValue(limit?.maxHeight),
    maxFileSizeMb: numberValue(limit?.max_file_size) ?? numberValue(limit?.maxFileSize),
  }
}

function parseResolutionPreset(key: string, value: z.infer<typeof ResolutionWireSchema>): JimengAgentModel["resolutionPresets"][number] {
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

function summarizeModel(model: JimengAgentModel): JsonObject {
  return {
    model_req_key: model.modelReqKey,
    model_name: model.modelName,
    model_tip: model.modelTip,
    model_status: model.modelStatus,
    generation_category_name: model.generationCategoryName,
    feats: model.feats,
    option_keys: model.optionKeys,
    options: model.options.map((option) => ({
      key: option.key,
      value_type: option.valueType,
      enum_type: option.enumType,
      string_values: option.stringValues,
      int_values: option.intValues,
      double_values: option.doubleValues,
      default_value: option.defaultValue,
      forbidden_display: option.forbiddenDisplay,
      supported_materials: option.supportedMaterials,
      max_total_count: option.maxTotalCount,
      max_total_video_duration_sec: option.maxTotalVideoDurationSec,
      max_total_audio_duration_sec: option.maxTotalAudioDurationSec,
      required_material_types_any_of: option.requiredMaterialTypesAnyOf,
    })),
    blend_controls: model.blendControls,
    feat_config_keys: model.featConfigKeys,
    resolution_keys: model.resolutionKeys,
    resolution_presets: model.resolutionPresets,
    sample_steps: model.sampleSteps,
    model_source: model.modelSource,
    max_batch_gen_count: model.maxBatchGenCount,
    compliance_confirmation_required: model.complianceConfirmationRequired,
    task_cancel_enabled: model.taskCancelEnabled,
  }
}

function modelsWithFeat(models: JimengAgentModel[], control: JimengReferenceControlKind): string[] {
  return models
    .filter((model) => model.feats.includes(control))
    .map((model) => model.modelReqKey)
    .sort()
}

function modelsWithBlendControl(models: JimengAgentModel[], control: JimengReferenceControlKind): string[] {
  return models
    .filter((model) => model.blendControls.includes(control))
    .map((model) => model.modelReqKey)
    .sort()
}

function modelsWithFeatConfig(models: JimengAgentModel[], control: JimengReferenceControlKind): string[] {
  return models
    .filter((model) => model.featConfigKeys.includes(control))
    .map((model) => model.modelReqKey)
    .sort()
}

function defaultValueForIndex(input: {
  stringValues: string[]
  intValues: number[]
  doubleValues: number[]
  defaultIndex: number | null
}): string | number | null {
  if (input.defaultIndex === null || input.defaultIndex < 0) return null
  return input.stringValues[input.defaultIndex] ?? input.intValues[input.defaultIndex] ?? input.doubleValues[input.defaultIndex] ?? null
}

function buildAgentCatalogHeaders(session: JimengSessionBundle): Record<string, string> {
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
