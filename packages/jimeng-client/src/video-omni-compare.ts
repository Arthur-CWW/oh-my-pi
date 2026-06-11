import { createHash } from "node:crypto"
import { Schema } from "effect"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { JIMENG_VIDEO_DIRECT_ENDPOINT } from "./video-plan"

const URL_LIKE_RE = /https?:\/\/|byteimg|douyinpic|vlabvod|tos-cn-[iv]|x-signature|x-expires|expire_time/i

const OptionalString = Schema.optional(Schema.NullOr(Schema.String))
const JsonRecordWireSchema = Schema.Record(Schema.String, Schema.Unknown)

const RawNetworkCdpEventSchema = Schema.Struct({
  kind: Schema.Literal("cdpEvent"),
  method: Schema.optional(Schema.String),
  params: Schema.optional(JsonRecordWireSchema),
})

const CaptureTemplateSchema = Schema.Struct({
  entries: Schema.Array(Schema.Struct({
    kind: Schema.String,
    url: OptionalString,
    postData: OptionalString,
  })),
})

export interface JimengVideoOmniCompareDifference {
  path: string
  kind: "missing" | "mismatch" | "array_length"
  expected: JsonObject
  actual: JsonObject
}

export interface JimengVideoOmniCompareCandidate {
  index: number
  request_id: string | null
  url_pathname: string
  submit_id_present: boolean
  endpoint_match: boolean
  root_model_match: boolean
  model_req_key_match: boolean
  ratio_match: boolean
  draft_features_match: boolean
  video_input_match: boolean
  material_list_match: boolean
  meta_list_match: boolean
  metrics_match: boolean
  video_task_extra_match: boolean
  matched_path_count: number
  difference_count: number
  differences: JimengVideoOmniCompareDifference[]
}

export interface JimengVideoOmniCompareResult {
  match: boolean
  plan_endpoint: string
  plan_model_req_key: string | null
  plan_material_count: number
  plan_meta_count: number
  candidate_count: number
  candidates: JimengVideoOmniCompareCandidate[]
}

interface CapturedSubmitRequest {
  requestId: string | null
  url: string
  postData: string
}

interface ParsedOmniVideoBody {
  submitId: string | null
  endpoint: string
  rootModel: string | null
  modelReqKey: string | null
  ratio: string | null
  seed: number | null
  minFeatures: JsonValue[]
  videoInput: JsonObject | null
  materialList: JsonObject[]
  metaList: JsonObject[]
  metricsExtra: JsonObject | null
  videoTaskExtra: JsonObject | null
}

export function compareJimengVideoOmniPlanWithRawNetwork(input: {
  dryRunPlanText: string
  rawNetworkText: string
}): JimengVideoOmniCompareResult {
  return compareJimengVideoOmniPlanWithRequests({
    dryRunPlanText: input.dryRunPlanText,
    requests: extractOmniSubmitRequestsFromRawNetwork(input.rawNetworkText),
  })
}

export function compareJimengVideoOmniPlanWithCaptureTemplate(input: {
  dryRunPlanText: string
  captureTemplateText: string
}): JimengVideoOmniCompareResult {
  return compareJimengVideoOmniPlanWithRequests({
    dryRunPlanText: input.dryRunPlanText,
    requests: extractOmniSubmitRequestsFromCaptureTemplate(input.captureTemplateText),
  })
}

export function compareJimengVideoOmniPlanWithRequests(input: {
  dryRunPlanText: string
  requests: CapturedSubmitRequest[]
}): JimengVideoOmniCompareResult {
  const expected = parseExpectedOmniVideoBody(input.dryRunPlanText)
  const candidates = input.requests.map((request, index) => compareCapturedRequest(expected, request, index))
  const match = candidates.some((candidate) =>
    candidate.endpoint_match
    && candidate.root_model_match
    && candidate.model_req_key_match
    && candidate.ratio_match
    && candidate.draft_features_match
    && candidate.video_input_match
    && candidate.material_list_match
    && candidate.meta_list_match
    && candidate.metrics_match
    && candidate.video_task_extra_match
  )
  return {
    match,
    plan_endpoint: expected.endpoint,
    plan_model_req_key: expected.modelReqKey,
    plan_material_count: expected.materialList.length,
    plan_meta_count: expected.metaList.length,
    candidate_count: candidates.length,
    candidates,
  }
}

export function summarizeJimengVideoOmniCompare(result: JimengVideoOmniCompareResult): JsonObject {
  return {
    match: result.match,
    plan_endpoint: result.plan_endpoint,
    plan_model_req_key: result.plan_model_req_key,
    plan_material_count: result.plan_material_count,
    plan_meta_count: result.plan_meta_count,
    candidate_count: result.candidate_count,
    candidates: result.candidates.map((candidate) => ({
      index: candidate.index,
      request_id_present: candidate.request_id !== null,
      url_pathname: candidate.url_pathname,
      submit_id_present: candidate.submit_id_present,
      endpoint_match: candidate.endpoint_match,
      root_model_match: candidate.root_model_match,
      model_req_key_match: candidate.model_req_key_match,
      ratio_match: candidate.ratio_match,
      draft_features_match: candidate.draft_features_match,
      video_input_match: candidate.video_input_match,
      material_list_match: candidate.material_list_match,
      meta_list_match: candidate.meta_list_match,
      metrics_match: candidate.metrics_match,
      video_task_extra_match: candidate.video_task_extra_match,
      matched_path_count: candidate.matched_path_count,
      difference_count: candidate.difference_count,
      differences: candidate.differences.slice(0, 50).map((difference) => ({
        path: difference.path,
        kind: difference.kind,
        expected: difference.expected,
        actual: difference.actual,
      })),
    })),
  }
}

function compareCapturedRequest(expected: ParsedOmniVideoBody, request: CapturedSubmitRequest, index: number): JimengVideoOmniCompareCandidate {
  const captured = parseCapturedOmniVideoBody(request.postData, endpointPath(request.url))
  const differences: JimengVideoOmniCompareDifference[] = []
  let matchedPathCount = 0

  matchedPathCount += compareScalar(expected.endpoint, captured.endpoint, "endpoint", differences)
  matchedPathCount += compareScalar(expected.rootModel, captured.rootModel, "extend.root_model", differences)
  matchedPathCount += compareScalar(expected.modelReqKey, captured.modelReqKey, "text_to_video_params.model_req_key", differences)
  matchedPathCount += compareScalar(expected.ratio, captured.ratio, "text_to_video_params.video_aspect_ratio", differences)
  matchedPathCount += compareScalar(expected.seed, captured.seed, "text_to_video_params.seed", differences)
  matchedPathCount += compareSubset(expected.minFeatures, captured.minFeatures, "draft.min_features", differences)
  matchedPathCount += compareVideoInput(expected.videoInput, captured.videoInput, differences)
  matchedPathCount += compareMaterialList(expected.materialList, captured.materialList, differences)
  matchedPathCount += compareMetaList(expected.metaList, captured.metaList, differences)
  matchedPathCount += compareMetrics(expected.metricsExtra, captured.metricsExtra, "metrics_extra", differences)
  matchedPathCount += compareMetrics(expected.videoTaskExtra, captured.videoTaskExtra, "video_task_extra", differences)

  return {
    index,
    request_id: request.requestId,
    url_pathname: captured.endpoint,
    submit_id_present: captured.submitId !== null,
    endpoint_match: expected.endpoint === captured.endpoint,
    root_model_match: expected.rootModel !== null && captured.rootModel === expected.rootModel,
    model_req_key_match: expected.modelReqKey !== null && captured.modelReqKey === expected.modelReqKey,
    ratio_match: expected.ratio !== null && captured.ratio === expected.ratio,
    draft_features_match: !hasDifferenceUnder(differences, "draft."),
    video_input_match: !hasDifferenceUnder(differences, "videoInput.") && !hasExactDifference(differences, "text_to_video_params.seed"),
    material_list_match: !hasDifferenceUnder(differences, "material_list"),
    meta_list_match: !hasDifferenceUnder(differences, "meta_list"),
    metrics_match: !hasDifferenceUnder(differences, "metrics_extra."),
    video_task_extra_match: !hasDifferenceUnder(differences, "video_task_extra."),
    matched_path_count: matchedPathCount,
    difference_count: differences.length,
    differences,
  }
}

function parseExpectedOmniVideoBody(text: string): ParsedOmniVideoBody {
  const root = parseJsonObject(text, "video omni dry-run plan")
  const request = recordValue(root.request) ?? recordValue(recordValue(root.plan)?.request) ?? root
  const endpoint = stringValue(root.endpoint) ?? stringValue(recordValue(root.plan)?.endpoint) ?? JIMENG_VIDEO_DIRECT_ENDPOINT
  return parseOmniVideoBody(request, endpoint, "video omni dry-run request")
}

function parseCapturedOmniVideoBody(postData: string, endpoint: string): ParsedOmniVideoBody {
  return parseOmniVideoBody(parseJsonObject(postData, "captured video omni submit body"), endpoint, "captured video omni submit body")
}

function parseOmniVideoBody(body: JsonObject, endpoint: string, operation: string): ParsedOmniVideoBody {
  const draftText = stringValue(body.draft_content)
  const metricsExtra = parseJsonObjectString(body.metrics_extra, `${operation} metrics_extra`, false)
  if (!draftText) {
    return {
      submitId: stringValue(body.submit_id),
      endpoint,
      rootModel: stringValue(recordValue(body.extend)?.root_model),
      modelReqKey: null,
      ratio: null,
      seed: null,
      minFeatures: [],
      videoInput: null,
      materialList: [],
      metaList: [],
      metricsExtra,
      videoTaskExtra: null,
    }
  }
  const draft = parseJsonObject(draftText, `${operation} draft_content`)
  const component = recordValue(arrayValue(draft.component_list)[0])
  const genVideo = recordValue(recordValue(component?.abilities)?.gen_video)
  const params = recordValue(genVideo?.text_to_video_params)
  const videoInput = recordValue(arrayValue(params?.video_gen_inputs)[0])
  const unifiedEdit = recordValue(videoInput?.unified_edit_input)
  return {
    submitId: stringValue(body.submit_id),
    endpoint,
    rootModel: stringValue(recordValue(body.extend)?.root_model),
    modelReqKey: stringValue(params?.model_req_key),
    ratio: stringValue(params?.video_aspect_ratio),
    seed: numberValue(params?.seed),
    minFeatures: arrayValue(draft.min_features),
    videoInput,
    materialList: arrayObjectValue(unifiedEdit?.material_list),
    metaList: arrayObjectValue(unifiedEdit?.meta_list),
    metricsExtra,
    videoTaskExtra: parseJsonObjectString(genVideo?.video_task_extra, `${operation} video_task_extra`, false),
  }
}

function extractOmniSubmitRequestsFromRawNetwork(text: string): CapturedSubmitRequest[] {
  const requests: CapturedSubmitRequest[] = []
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  for (const [index, line] of lines.entries()) {
    const event = parseRawNetworkCdpEvent(line, index + 1)
    if (!event || event.method !== "Network.requestWillBeSent") continue
    const params = unknownRecord(event.params)
    const request = unknownRecord(params?.request)
    const url = unknownString(request?.url)
    const postData = unknownString(request?.postData)
    if (!url || !postData || endpointPath(url) !== JIMENG_VIDEO_DIRECT_ENDPOINT) continue
    requests.push({
      requestId: unknownString(params?.requestId),
      url,
      postData,
    })
  }
  return requests
}

function extractOmniSubmitRequestsFromCaptureTemplate(text: string): CapturedSubmitRequest[] {
  const parsed = decodeCaptureContract(CaptureTemplateSchema, parseUnknownJson(text, "capture template"), "capture template")
  return parsed.entries.flatMap((entry, index) => {
    if (entry.kind !== "request" || !entry.url || !entry.postData || endpointPath(entry.url) !== JIMENG_VIDEO_DIRECT_ENDPOINT) return []
    return [{ requestId: `capture-template-${index}`, url: entry.url, postData: entry.postData }]
  })
}

function parseRawNetworkCdpEvent(line: string, lineNumber: number): { method?: string, params?: Record<string, unknown> } | null {
  const value = parseUnknownJson(line, `raw-network line ${lineNumber}`)
  const record = unknownRecord(value)
  if (record?.kind !== "cdpEvent") return null
  return decodeCaptureContract(RawNetworkCdpEventSchema, value, `raw-network line ${lineNumber}`)
}

function compareVideoInput(expected: JsonObject | null, actual: JsonObject | null, differences: JimengVideoOmniCompareDifference[]): number {
  if (!expected || !actual) return compareOptionalObject(expected, actual, "videoInput", differences)
  let matched = 0
  for (const key of ["prompt", "video_mode", "fps", "duration_ms"]) {
    matched += compareScalar(expected[key], actual[key], `videoInput.${key}`, differences)
  }
  matched += compareRequiredObject(recordValue(expected.unified_edit_input), recordValue(actual.unified_edit_input), "videoInput.unified_edit_input", differences)
  return matched
}

function compareMaterialList(expected: JsonObject[], actual: JsonObject[], differences: JimengVideoOmniCompareDifference[]): number {
  let matched = 0
  if (actual.length !== expected.length) {
    differences.push({ path: "material_list", kind: "array_length", expected: describeValue(expected.length), actual: describeValue(actual.length) })
  }
  for (let index = 0; index < expected.length; index += 1) {
    const expectedMaterial = expected[index]
    const actualMaterial = actual[index]
    if (!expectedMaterial || !actualMaterial) {
      differences.push({ path: `material_list.${index}`, kind: "missing", expected: expectedMaterial ? describeValue(expectedMaterial) : { kind: "missing" }, actual: actualMaterial ? describeValue(actualMaterial) : { kind: "missing" } })
      continue
    }
    const pathKey = `material_list.${index}`
    matched += compareScalar(expectedMaterial.material_type, actualMaterial.material_type, `${pathKey}.material_type`, differences)
    if (expectedMaterial.material_type === "image") {
      matched += compareMaterialInfo(recordValue(expectedMaterial.image_info), recordValue(actualMaterial.image_info), `${pathKey}.image_info`, ["source_from", "image_uri", "uri", "width", "height"], ["format"], differences)
      continue
    }
    if (expectedMaterial.material_type === "video") {
      matched += compareMaterialInfo(recordValue(expectedMaterial.video_info), recordValue(actualMaterial.video_info), `${pathKey}.video_info`, ["source_from", "vid", "width", "height", "duration"], [], differences)
    }
  }
  return matched
}

function compareMaterialInfo(
  expected: JsonObject | null,
  actual: JsonObject | null,
  pathKey: string,
  requiredKeys: string[],
  optionalNonEmptyKeys: string[],
  differences: JimengVideoOmniCompareDifference[],
): number {
  if (!expected || !actual) return compareOptionalObject(expected, actual, pathKey, differences)
  let matched = 0
  for (const key of requiredKeys) matched += compareScalar(expected[key], actual[key], `${pathKey}.${key}`, differences)
  for (const key of optionalNonEmptyKeys) {
    const expectedValue = expected[key]
    if (expectedValue !== undefined && expectedValue !== null && expectedValue !== "") {
      matched += compareScalar(expectedValue, actual[key], `${pathKey}.${key}`, differences)
    }
  }
  return matched
}

function compareMetaList(expected: JsonObject[], actual: JsonObject[], differences: JimengVideoOmniCompareDifference[]): number {
  let matched = 0
  if (actual.length !== expected.length) {
    differences.push({ path: "meta_list", kind: "array_length", expected: describeValue(expected.length), actual: describeValue(actual.length) })
  }
  for (let index = 0; index < expected.length; index += 1) {
    const expectedMeta = expected[index]
    const actualMeta = actual[index]
    if (!expectedMeta || !actualMeta) {
      differences.push({ path: `meta_list.${index}`, kind: "missing", expected: expectedMeta ? describeValue(expectedMeta) : { kind: "missing" }, actual: actualMeta ? describeValue(actualMeta) : { kind: "missing" } })
      continue
    }
    const pathKey = `meta_list.${index}`
    const expectedType = expectedMeta.meta_type
    matched += compareScalar(expectedType, actualMeta.meta_type, `${pathKey}.meta_type`, differences)
    if (expectedType === "text") {
      matched += compareScalar(expectedMeta.text, actualMeta.text, `${pathKey}.text`, differences)
      continue
    }
    matched += compareScalar(recordValue(expectedMeta.material_ref)?.material_idx, recordValue(actualMeta.material_ref)?.material_idx, `${pathKey}.material_ref.material_idx`, differences)
  }
  return matched
}

function compareMetrics(expected: JsonObject | null, actual: JsonObject | null, pathKey: string, differences: JimengVideoOmniCompareDifference[]): number {
  if (!expected || !actual) return compareOptionalObject(expected, actual, pathKey, differences)
  let matched = 0
  matched += compareScalar(expected.functionMode, actual.functionMode, `${pathKey}.functionMode`, differences)
  matched += compareScalar(expected.isDefaultSeed, actual.isDefaultSeed, `${pathKey}.isDefaultSeed`, differences)
  const expectedScene = recordValue(arrayValue(parseJsonStringValue(expected.sceneOptions, `${pathKey}.sceneOptions`))[0])
  const actualScene = recordValue(arrayValue(parseJsonStringValue(actual.sceneOptions, `${pathKey}.sceneOptions`))[0])
  matched += compareRequiredObject(expectedScene, actualScene, `${pathKey}.sceneOptions.0`, differences)
  if (expectedScene && actualScene) {
    for (const key of ["type", "scene", "modelReqKey", "videoDuration"]) {
      matched += compareScalar(expectedScene[key], actualScene[key], `${pathKey}.sceneOptions.0.${key}`, differences)
    }
    matched += compareSubset(arrayValue(expectedScene.materialTypes), arrayValue(actualScene.materialTypes), `${pathKey}.sceneOptions.0.materialTypes`, differences)
  }
  return matched
}

function compareOptionalObject(
  expected: JsonObject | null,
  actual: JsonObject | null,
  pathKey: string,
  differences: JimengVideoOmniCompareDifference[],
): number {
  if (!expected || !actual) {
    if (expected === actual) return 1
    differences.push({
      path: pathKey,
      kind: expected ? "missing" : "mismatch",
      expected: expected ? describeValue(expected) : { kind: "null" },
      actual: actual ? describeValue(actual) : { kind: "null" },
    })
    return 0
  }
  return compareSubset(expected, actual, pathKey, differences)
}

function compareRequiredObject(
  expected: JsonObject | null,
  actual: JsonObject | null,
  pathKey: string,
  differences: JimengVideoOmniCompareDifference[],
): number {
  if (expected && actual) return 1
  differences.push({
    path: pathKey,
    kind: expected ? "missing" : "mismatch",
    expected: expected ? describeValue(expected) : { kind: "null" },
    actual: actual ? describeValue(actual) : { kind: "null" },
  })
  return 0
}

function compareSubset(expected: JsonValue, actual: JsonValue | null | undefined, pathKey: string, differences: JimengVideoOmniCompareDifference[]): number {
  if (actual === null || actual === undefined) {
    differences.push({ path: pathKey, kind: "missing", expected: describeValue(expected), actual: { kind: "missing" } })
    return 0
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      differences.push({ path: pathKey, kind: "mismatch", expected: describeValue(expected), actual: describeValue(actual) })
      return 0
    }
    let matched = 0
    if (actual.length !== expected.length) {
      differences.push({ path: pathKey, kind: "array_length", expected: describeValue(expected.length), actual: describeValue(actual.length) })
    }
    for (let index = 0; index < expected.length; index += 1) matched += compareSubset(expected[index]!, actual[index], `${pathKey}.${index}`, differences)
    return matched
  }
  const expectedRecord = recordValue(expected)
  if (expectedRecord) {
    const actualRecord = recordValue(actual)
    if (!actualRecord) {
      differences.push({ path: pathKey, kind: "mismatch", expected: describeValue(expected), actual: describeValue(actual) })
      return 0
    }
    let matched = 0
    for (const key of Object.keys(expectedRecord).sort()) {
      matched += compareSubset(expectedRecord[key]!, actualRecord[key], `${pathKey}.${key}`, differences)
    }
    return matched
  }
  return compareScalar(expected, actual, pathKey, differences)
}

function compareScalar(expected: JsonValue | string | undefined | null, actual: JsonValue | string | undefined | null, pathKey: string, differences: JimengVideoOmniCompareDifference[]): number {
  if (expected === undefined || expected === null) {
    if (actual === undefined || actual === null) return 1
    differences.push({ path: pathKey, kind: "mismatch", expected: { kind: "null" }, actual: describeValue(actual) })
    return 0
  }
  if (actual === undefined || actual === null) {
    differences.push({ path: pathKey, kind: "missing", expected: describeValue(expected), actual: { kind: "missing" } })
    return 0
  }
  if (scalarEqual(expected, actual)) return 1
  differences.push({ path: pathKey, kind: "mismatch", expected: describeValue(expected), actual: describeValue(actual) })
  return 0
}

function parseJsonObject(text: string, operation: string): JsonObject {
  const value = parseUnknownJson(text, operation)
  const record = unknownRecord(value)
  if (record) return record as JsonObject
  throw jimengError({
    category: "validation",
    code: "VIDEO_OMNI_JSON_OBJECT_REQUIRED",
    message: `${operation} must be a JSON object.`,
    retryable: false,
  })
}

function parseUnknownJson(text: string, operation: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "validation",
      code: "VIDEO_OMNI_JSON_PARSE_FAILED",
      message: `${operation} was not valid JSON.`,
      retryable: false,
      details: { message },
    })
  }
}

function parseJsonObjectString(value: JsonValue | undefined, operation: string, required: boolean): JsonObject | null {
  if (typeof value !== "string") {
    if (!required) return null
    throw jimengError({
      category: "validation",
      code: "VIDEO_OMNI_JSON_STRING_REQUIRED",
      message: `${operation} must be a JSON string.`,
      retryable: false,
    })
  }
  return parseJsonObject(value, operation)
}

function parseJsonStringValue(value: JsonValue | undefined, operation: string): JsonValue {
  if (typeof value !== "string") return null
  try {
    return JSON.parse(value) as JsonValue
  } catch {
    return null
  }
}

function decodeCaptureContract<A>(schema: Schema.Decoder<A>, value: unknown, operation: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "validation",
      code: "VIDEO_OMNI_CAPTURE_CONTRACT_CHANGED",
      message: `${operation} did not match the expected capture contract.`,
      retryable: false,
      details: { operation, error: message },
    })
  }
}

function describeValue(value: JsonValue | string | number | null | undefined): JsonObject {
  if (value === null || value === undefined) return { kind: "null" }
  if (typeof value === "string") return { kind: "string", length: value.length, sha256: sha256(value), url_like: URL_LIKE_RE.test(value) }
  if (typeof value === "number") return { kind: "number", value }
  if (typeof value === "boolean") return { kind: "boolean", value }
  if (Array.isArray(value)) return { kind: "array", length: value.length }
  return { kind: "object", keys: Object.keys(value).sort() }
}

function endpointPath(value: string): string {
  try {
    return new URL(value).pathname
  } catch {
    return value.split("?")[0] || value
  }
}

function recordValue(value: JsonValue | undefined | null): JsonObject | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function unknownRecord(value: unknown): Record<string, unknown> | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function arrayValue(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : []
}

function arrayObjectValue(value: JsonValue | undefined): JsonObject[] {
  return arrayValue(value).flatMap((item) => {
    const record = recordValue(item)
    return record ? [record] : []
  })
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null
}

function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === "number" ? value : null
}

function unknownString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function scalarEqual(left: JsonValue | string, right: JsonValue | string): boolean {
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) < 0.001
  return left === right
}

function hasDifferenceUnder(differences: JimengVideoOmniCompareDifference[], pathPrefix: string): boolean {
  return differences.some((difference) => difference.path === pathPrefix || difference.path.startsWith(pathPrefix))
}

function hasExactDifference(differences: JimengVideoOmniCompareDifference[], path: string): boolean {
  return differences.some((difference) => difference.path === path)
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
