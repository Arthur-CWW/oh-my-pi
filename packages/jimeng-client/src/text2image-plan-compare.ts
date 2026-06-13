import { createHash } from "node:crypto"
import { Schema } from "effect"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { JIMENG_TEXT2IMAGE_DIRECT_ENDPOINT } from "./text2image-plan"

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

export interface JimengText2ImageDirectCompareDifference {
  path: string
  kind: "missing" | "mismatch" | "array_length"
  expected: JsonObject
  actual: JsonObject
}

export interface JimengText2ImageDirectCompareCandidate {
  index: number
  request_id: string | null
  url_pathname: string
  submit_id_present: boolean
  endpoint_match: boolean
  root_model_match: boolean
  model_req_key_match: boolean
  core_param_match: boolean
  metrics_match: boolean
  matched_path_count: number
  difference_count: number
  differences: JimengText2ImageDirectCompareDifference[]
}

export interface JimengText2ImageDirectCompareResult {
  match: boolean
  plan_endpoint: string
  plan_model_req_key: string | null
  candidate_count: number
  candidates: JimengText2ImageDirectCompareCandidate[]
}

interface CapturedSubmitRequest {
  requestId: string | null
  url: string
  postData: string
}

interface ParsedText2ImageDirectBody {
  submitId: string | null
  endpoint: string
  rootModel: string | null
  modelReqKey: string | null
  coreParam: JsonObject | null
  metricsExtra: JsonObject | null
}

export function compareJimengText2ImageDirectPlanWithRawNetwork(input: {
  dryRunPlanText: string
  rawNetworkText: string
}): JimengText2ImageDirectCompareResult {
  return compareJimengText2ImageDirectPlanWithRequests({
    dryRunPlanText: input.dryRunPlanText,
    requests: extractText2ImageDirectSubmitRequestsFromRawNetwork(input.rawNetworkText),
  })
}

export function compareJimengText2ImageDirectPlanWithCaptureTemplate(input: {
  dryRunPlanText: string
  captureTemplateText: string
}): JimengText2ImageDirectCompareResult {
  return compareJimengText2ImageDirectPlanWithRequests({
    dryRunPlanText: input.dryRunPlanText,
    requests: extractText2ImageDirectSubmitRequestsFromCaptureTemplate(input.captureTemplateText),
  })
}

export function compareJimengText2ImageDirectPlanWithRequests(input: {
  dryRunPlanText: string
  requests: CapturedSubmitRequest[]
}): JimengText2ImageDirectCompareResult {
  const expected = parseExpectedText2ImageDirectBody(input.dryRunPlanText)
  const candidates = input.requests.map((request, index) => compareCapturedRequest(expected, request, index))
  const match = candidates.some((candidate) =>
    candidate.endpoint_match
    && candidate.root_model_match
    && candidate.model_req_key_match
    && candidate.core_param_match
    && candidate.metrics_match
  )
  return {
    match,
    plan_endpoint: expected.endpoint,
    plan_model_req_key: expected.modelReqKey,
    candidate_count: candidates.length,
    candidates,
  }
}

export function summarizeJimengText2ImageDirectCompare(result: JimengText2ImageDirectCompareResult): JsonObject {
  return {
    match: result.match,
    plan_endpoint: result.plan_endpoint,
    plan_model_req_key: result.plan_model_req_key,
    candidate_count: result.candidate_count,
    candidates: result.candidates.map((candidate) => ({
      index: candidate.index,
      request_id_present: candidate.request_id !== null,
      url_pathname: candidate.url_pathname,
      submit_id_present: candidate.submit_id_present,
      endpoint_match: candidate.endpoint_match,
      root_model_match: candidate.root_model_match,
      model_req_key_match: candidate.model_req_key_match,
      core_param_match: candidate.core_param_match,
      metrics_match: candidate.metrics_match,
      matched_path_count: candidate.matched_path_count,
      difference_count: candidate.difference_count,
      differences: candidate.differences.slice(0, 30).map((difference) => ({
        path: difference.path,
        kind: difference.kind,
        expected: difference.expected,
        actual: difference.actual,
      })),
    })),
  }
}

function compareCapturedRequest(expected: ParsedText2ImageDirectBody, request: CapturedSubmitRequest, index: number): JimengText2ImageDirectCompareCandidate {
  const captured = parseCapturedText2ImageDirectBody(request.postData, pathnameValue(request.url))
  const differences: JimengText2ImageDirectCompareDifference[] = []
  let matchedPathCount = 0

  matchedPathCount += compareScalar(expected.endpoint, captured.endpoint, "endpoint", differences)
  matchedPathCount += compareScalar(expected.rootModel, captured.rootModel, "extend.root_model", differences)
  matchedPathCount += compareScalar(expected.modelReqKey, captured.modelReqKey, "core_param.model", differences)
  matchedPathCount += compareCoreParam(expected.coreParam, captured.coreParam, differences)
  matchedPathCount += compareMetricsExtra(expected.metricsExtra, captured.metricsExtra, differences)

  return {
    index,
    request_id: request.requestId,
    url_pathname: captured.endpoint,
    submit_id_present: captured.submitId !== null,
    endpoint_match: expected.endpoint === captured.endpoint,
    root_model_match: expected.rootModel !== null && captured.rootModel === expected.rootModel,
    model_req_key_match: expected.modelReqKey !== null && captured.modelReqKey === expected.modelReqKey,
    core_param_match: !differences.some((difference) => difference.path.startsWith("core_param.")),
    metrics_match: !differences.some((difference) => difference.path.startsWith("metrics_extra.")),
    matched_path_count: matchedPathCount,
    difference_count: differences.length,
    differences,
  }
}

function parseExpectedText2ImageDirectBody(text: string): ParsedText2ImageDirectBody {
  const root = parseJsonObject(text, "text2image direct dry-run plan")
  const request = recordValue(root.request) ?? recordValue(recordValue(root.plan)?.request) ?? root
  const endpoint = stringValue(root.endpoint) ?? stringValue(recordValue(root.plan)?.endpoint) ?? JIMENG_TEXT2IMAGE_DIRECT_ENDPOINT
  return parseText2ImageDirectBody(request, endpoint, "text2image direct dry-run request")
}

function parseCapturedText2ImageDirectBody(postData: string, endpoint: string): ParsedText2ImageDirectBody {
  return parseText2ImageDirectBody(parseJsonObject(postData, "captured text2image direct submit body"), endpoint, "captured text2image direct submit body")
}

function parseText2ImageDirectBody(body: JsonObject, endpoint: string, operation: string): ParsedText2ImageDirectBody {
  const draftText = stringValue(body.draft_content)
  if (!draftText) {
    return {
      submitId: stringValue(body.submit_id),
      endpoint,
      rootModel: stringValue(recordValue(body.extend)?.root_model),
      modelReqKey: null,
      coreParam: null,
      metricsExtra: parseJsonObjectString(body.metrics_extra, `${operation} metrics_extra`, false),
    }
  }
  const draft = parseJsonObject(draftText, `${operation} draft_content`)
  const component = recordValue(arrayValue(draft.component_list)[0])
  const generate = recordValue(recordValue(component?.abilities)?.generate)
  const coreParam = recordValue(generate?.core_param)
  return {
    submitId: stringValue(body.submit_id),
    endpoint,
    rootModel: stringValue(recordValue(body.extend)?.root_model),
    modelReqKey: stringValue(coreParam?.model),
    coreParam,
    metricsExtra: parseJsonObjectString(body.metrics_extra, `${operation} metrics_extra`, false),
  }
}

function extractText2ImageDirectSubmitRequestsFromRawNetwork(text: string): CapturedSubmitRequest[] {
  const requests: CapturedSubmitRequest[] = []
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  for (const [index, line] of lines.entries()) {
    const event = parseRawNetworkCdpEvent(line, index + 1)
    if (!event || event.method !== "Network.requestWillBeSent") continue
    const params = unknownRecord(event.params)
    const request = unknownRecord(params?.request)
    const url = unknownString(request?.url)
    const postData = unknownString(request?.postData)
    if (!url || !postData || pathnameValue(url) !== JIMENG_TEXT2IMAGE_DIRECT_ENDPOINT) continue
    requests.push({
      requestId: unknownString(params?.requestId),
      url,
      postData,
    })
  }
  return requests
}

function extractText2ImageDirectSubmitRequestsFromCaptureTemplate(text: string): CapturedSubmitRequest[] {
  const parsed = decodeCaptureContract(CaptureTemplateSchema, parseUnknownJson(text, "capture template"), "capture template")
  return parsed.entries.flatMap((entry, index) => {
    if (entry.kind !== "request" || !entry.url || !entry.postData || pathnameValue(entry.url) !== JIMENG_TEXT2IMAGE_DIRECT_ENDPOINT) return []
    return [{ requestId: `capture-template-${index}`, url: entry.url, postData: entry.postData }]
  })
}

function parseRawNetworkCdpEvent(line: string, lineNumber: number): { method?: string, params?: Record<string, unknown> } | null {
  const value = parseUnknownJson(line, `raw-network line ${lineNumber}`)
  const record = unknownRecord(value)
  if (record?.kind !== "cdpEvent") return null
  return decodeCaptureContract(RawNetworkCdpEventSchema, value, `raw-network line ${lineNumber}`)
}

function compareCoreParam(expected: JsonObject | null, actual: JsonObject | null, differences: JimengText2ImageDirectCompareDifference[]): number {
  if (!expected || !actual) return compareOptionalObject(expected, actual, "core_param", differences)
  let matched = 0
  for (const key of ["model", "prompt", "sample_strength", "intelligent_ratio"]) {
    matched += compareScalar(expected[key], actual[key], `core_param.${key}`, differences)
  }
  matched += compareOptionalField(expected, actual, "image_ratio", differences)
  matched += compareOptionalTextField(expected, actual, "negative_prompt", differences)
  matched += compareLargeImageInfo(recordValue(expected.large_image_info), recordValue(actual.large_image_info), differences)
  return matched
}

function compareMetricsExtra(expected: JsonObject | null, actual: JsonObject | null, differences: JimengText2ImageDirectCompareDifference[]): number {
  return compareOptionalObject(omitVolatileFields(expected, ["generateId"]), omitVolatileFields(actual, ["generateId"]), "metrics_extra", differences)
}

function compareLargeImageInfo(expected: JsonObject | null, actual: JsonObject | null, differences: JimengText2ImageDirectCompareDifference[]): number {
  return compareOptionalObject(omitVolatileFields(expected, ["id", "min_version"]), omitVolatileFields(actual, ["id", "min_version"]), "core_param.large_image_info", differences)
}

function omitVolatileFields(value: JsonObject | null, keys: string[]): JsonObject | null {
  if (!value) return value
  const output: JsonObject = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!keys.includes(key)) output[key] = entry
  }
  return output
}

function compareOptionalTextField(expected: JsonObject, actual: JsonObject, key: string, differences: JimengText2ImageDirectCompareDifference[]): number {
  const expectedValue = expected[key]
  const actualValue = actual[key]
  const expectedEmpty = expectedValue === undefined || expectedValue === null || expectedValue === ""
  const actualEmpty = actualValue === undefined || actualValue === null || actualValue === ""
  if (expectedEmpty && actualEmpty) return 1
  if (expectedEmpty !== actualEmpty) {
    differences.push({
      path: `core_param.${key}`,
      kind: expectedEmpty ? "mismatch" : "missing",
      expected: expectedEmpty ? { kind: "absent" } : describeValue(expectedValue!),
      actual: actualEmpty ? { kind: "absent" } : describeValue(actualValue!),
    })
    return 0
  }
  return compareScalar(expectedValue, actualValue, `core_param.${key}`, differences)
}

function compareOptionalField(expected: JsonObject, actual: JsonObject, key: string, differences: JimengText2ImageDirectCompareDifference[]): number {
  const expectedHas = expected[key] !== undefined && expected[key] !== null
  const actualHas = actual[key] !== undefined && actual[key] !== null
  if (expectedHas !== actualHas) {
    differences.push({
      path: `core_param.${key}`,
      kind: expectedHas ? "missing" : "mismatch",
      expected: expectedHas ? describeValue(expected[key]!) : { kind: "absent" },
      actual: actualHas ? describeValue(actual[key]!) : { kind: "absent" },
    })
    return 0
  }
  if (!expectedHas) return 1
  return compareScalar(expected[key], actual[key], `core_param.${key}`, differences)
}

function compareOptionalObject(
  expected: JsonObject | null,
  actual: JsonObject | null,
  pathKey: string,
  differences: JimengText2ImageDirectCompareDifference[],
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

function compareSubset(expected: JsonValue, actual: JsonValue | null, pathKey: string, differences: JimengText2ImageDirectCompareDifference[]): number {
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
    for (let i = 0; i < expected.length; i += 1) matched += compareSubset(expected[i]!, actual[i] ?? null, `${pathKey}.${i}`, differences)
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
      matched += compareSubset(expectedRecord[key]!, actualRecord[key] ?? null, `${pathKey}.${key}`, differences)
    }
    return matched
  }
  return compareScalar(expected, actual, pathKey, differences)
}

function compareScalar(expected: JsonValue | undefined | string | null, actual: JsonValue | undefined | string | null, pathKey: string, differences: JimengText2ImageDirectCompareDifference[]): number {
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

function scalarEqual(left: JsonValue | string, right: JsonValue | string): boolean {
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) < 0.001
  return left === right
}

function parseJsonObject(text: string, operation: string): JsonObject {
  const value = parseUnknownJson(text, operation)
  const record = unknownRecord(value)
  if (record) return record as JsonObject
  throw jimengError({
    category: "validation",
    code: "TEXT2IMAGE_DIRECT_JSON_OBJECT_REQUIRED",
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
      code: "TEXT2IMAGE_DIRECT_JSON_PARSE_FAILED",
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
      code: "TEXT2IMAGE_DIRECT_JSON_STRING_REQUIRED",
      message: `${operation} must be a JSON string.`,
      retryable: false,
    })
  }
  return parseJsonObject(value, operation)
}

function decodeCaptureContract<A>(schema: Schema.Decoder<A>, value: unknown, operation: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "validation",
      code: "TEXT2IMAGE_DIRECT_CAPTURE_CONTRACT_CHANGED",
      message: `${operation} did not match the expected capture contract.`,
      retryable: false,
      details: { operation, error: message },
    })
  }
}

function describeValue(value: JsonValue | string | number | null): JsonObject {
  if (value === null || value === undefined) return { kind: "null" }
  if (typeof value === "string") return { kind: "string", length: value.length, sha256: sha256(value), url_like: URL_LIKE_RE.test(value) }
  if (typeof value === "number") return { kind: "number", value }
  if (typeof value === "boolean") return { kind: "boolean", value }
  if (Array.isArray(value)) return { kind: "array", length: value.length }
  return { kind: "object", keys: Object.keys(value).sort() }
}

function pathnameValue(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url.split("?")[0] || url
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

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null
}

function unknownString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
