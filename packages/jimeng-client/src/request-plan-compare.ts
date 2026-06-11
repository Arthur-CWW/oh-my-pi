import { createHash } from "node:crypto"
import { Schema } from "effect"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"

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

export interface JimengRequestPlanCompareDifference {
  path: string
  kind: "missing" | "mismatch" | "array_length"
  expected: JsonObject
  actual: JsonObject
}

export interface JimengRequestPlanCompareCandidate {
  index: number
  request_id: string | null
  url_pathname: string
  endpoint_match: boolean
  request_match: boolean
  query_match: boolean | null
  matched_path_count: number
  difference_count: number
  differences: JimengRequestPlanCompareDifference[]
}

export interface JimengRequestPlanCompareResult {
  match: boolean
  plan_endpoint: string
  plan_request_keys: string[]
  candidate_count: number
  candidates: JimengRequestPlanCompareCandidate[]
}

interface CapturedRequest {
  requestId: string | null
  url: string
  postData: string
}

interface ParsedRequestPlan {
  endpoint: string
  request: JsonObject
  queryParams: JsonObject | null
}

export function compareJimengRequestPlanWithRawNetwork(input: {
  dryRunPlanText: string
  rawNetworkText: string
  endpoint?: string
}): JimengRequestPlanCompareResult {
  const expected = parseExpectedRequestPlan(input.dryRunPlanText, input.endpoint)
  return compareJimengRequestPlanWithRequests({
    expected,
    requests: extractRequestsFromRawNetwork(input.rawNetworkText, expected.endpoint),
  })
}

export function compareJimengRequestPlanWithCaptureTemplate(input: {
  dryRunPlanText: string
  captureTemplateText: string
  endpoint?: string
}): JimengRequestPlanCompareResult {
  const expected = parseExpectedRequestPlan(input.dryRunPlanText, input.endpoint)
  return compareJimengRequestPlanWithRequests({
    expected,
    requests: extractRequestsFromCaptureTemplate(input.captureTemplateText, expected.endpoint),
  })
}

export function compareJimengRequestPlanWithRequests(input: {
  expected: ParsedRequestPlan
  requests: CapturedRequest[]
}): JimengRequestPlanCompareResult {
  const candidates = input.requests.map((request, index) => compareCapturedRequest(input.expected, request, index))
  return {
    match: candidates.some((candidate) => candidate.endpoint_match && candidate.request_match && candidate.query_match !== false),
    plan_endpoint: input.expected.endpoint,
    plan_request_keys: Object.keys(input.expected.request).sort(),
    candidate_count: candidates.length,
    candidates,
  }
}

export function summarizeJimengRequestPlanCompare(result: JimengRequestPlanCompareResult): JsonObject {
  return {
    match: result.match,
    plan_endpoint: result.plan_endpoint,
    plan_request_keys: result.plan_request_keys,
    candidate_count: result.candidate_count,
    candidates: result.candidates.map((candidate) => ({
      index: candidate.index,
      request_id_present: candidate.request_id !== null,
      url_pathname: candidate.url_pathname,
      endpoint_match: candidate.endpoint_match,
      request_match: candidate.request_match,
      query_match: candidate.query_match,
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

function compareCapturedRequest(expected: ParsedRequestPlan, request: CapturedRequest, index: number): JimengRequestPlanCompareCandidate {
  const actualEndpoint = endpointPath(request.url)
  const actualBody = parseJsonObject(request.postData, "captured request postData")
  const actualQuery = expected.queryParams ? queryParamsObject(request.url) : null
  const differences: JimengRequestPlanCompareDifference[] = []
  let matchedPathCount = 0

  matchedPathCount += compareScalar(expected.endpoint, actualEndpoint, "endpoint", differences)
  matchedPathCount += compareSubset(expected.request, actualBody, "request", differences)
  if (expected.queryParams) matchedPathCount += compareSubset(expected.queryParams, actualQuery, "query", differences)
  const queryDifferences = differences.some((difference) => difference.path === "query" || difference.path.startsWith("query."))

  return {
    index,
    request_id: request.requestId,
    url_pathname: actualEndpoint,
    endpoint_match: expected.endpoint === actualEndpoint,
    request_match: !differences.some((difference) => difference.path === "request" || difference.path.startsWith("request.")),
    query_match: expected.queryParams ? !queryDifferences : null,
    matched_path_count: matchedPathCount,
    difference_count: differences.length,
    differences,
  }
}

function parseExpectedRequestPlan(text: string, endpointOverride: string | undefined): ParsedRequestPlan {
  const root = parseJsonObject(text, "dry-run request plan")
  const nestedPlan = recordValue(root.plan)
  const request = recordValue(root.request) ?? recordValue(nestedPlan?.request)
  if (!request) {
    throw jimengError({
      category: "validation",
      code: "REQUEST_PLAN_REQUEST_REQUIRED",
      message: "Dry-run request plan must include a request object.",
      retryable: false,
    })
  }
  return {
    endpoint: inferPlanEndpoint(root, nestedPlan, endpointOverride),
    request,
    queryParams: recordValue(root.query_params) ?? recordValue(root.queryParams) ?? recordValue(nestedPlan?.query_params) ?? recordValue(nestedPlan?.queryParams),
  }
}

function inferPlanEndpoint(root: JsonObject, nestedPlan: JsonObject | null, endpointOverride: string | undefined): string {
  if (endpointOverride) return endpointPath(endpointOverride)

  const endpoints = uniqueStrings([
    stringValue(root.endpoint),
    stringValue(nestedPlan?.endpoint),
    ...stringArrayValue(root.endpoint_sequence),
    ...stringArrayValue(nestedPlan?.endpoint_sequence),
  ]).map(endpointPath)

  if (endpoints.length === 1) return endpoints[0]!
  if (endpoints.length > 1) {
    throw jimengError({
      category: "validation",
      code: "REQUEST_PLAN_ENDPOINT_AMBIGUOUS",
      message: "Dry-run request plan has multiple endpoints; pass --endpoint for request-plan-compare.",
      retryable: false,
      details: { endpoints },
    })
  }
  throw jimengError({
    category: "validation",
    code: "REQUEST_PLAN_ENDPOINT_REQUIRED",
    message: "Dry-run request plan must include endpoint or endpoint_sequence, or request-plan-compare must receive --endpoint.",
    retryable: false,
  })
}

function extractRequestsFromRawNetwork(text: string, endpoint: string): CapturedRequest[] {
  const requests: CapturedRequest[] = []
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  for (const [index, line] of lines.entries()) {
    const event = parseRawNetworkCdpEvent(line, index + 1)
    if (!event || event.method !== "Network.requestWillBeSent") continue
    const params = unknownRecord(event.params)
    const request = unknownRecord(params?.request)
    const url = unknownString(request?.url)
    const postData = unknownString(request?.postData)
    if (!url || !postData || endpointPath(url) !== endpoint) continue
    requests.push({
      requestId: unknownString(params?.requestId),
      url,
      postData,
    })
  }
  return requests
}

function extractRequestsFromCaptureTemplate(text: string, endpoint: string): CapturedRequest[] {
  const parsed = decodeCaptureContract(CaptureTemplateSchema, parseUnknownJson(text, "capture template"), "capture template")
  return parsed.entries.flatMap((entry, index) => {
    if (entry.kind !== "request" || !entry.url || !entry.postData || endpointPath(entry.url) !== endpoint) return []
    return [{ requestId: `capture-template-${index}`, url: entry.url, postData: entry.postData }]
  })
}

function parseRawNetworkCdpEvent(line: string, lineNumber: number): { method?: string, params?: Record<string, unknown> } | null {
  const value = parseUnknownJson(line, `raw-network line ${lineNumber}`)
  const record = unknownRecord(value)
  if (record?.kind !== "cdpEvent") return null
  return decodeCaptureContract(RawNetworkCdpEventSchema, value, `raw-network line ${lineNumber}`)
}

function compareSubset(
  expected: JsonValue,
  actual: JsonValue | null | undefined,
  pathKey: string,
  differences: JimengRequestPlanCompareDifference[],
): number {
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
    for (let i = 0; i < expected.length; i += 1) matched += compareSubset(expected[i]!, actual[i], `${pathKey}.${i}`, differences)
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

function compareScalar(
  expected: JsonValue | string | undefined | null,
  actual: JsonValue | string | undefined | null,
  pathKey: string,
  differences: JimengRequestPlanCompareDifference[],
): number {
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
    code: "REQUEST_PLAN_JSON_OBJECT_REQUIRED",
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
      code: "REQUEST_PLAN_JSON_PARSE_FAILED",
      message: `${operation} was not valid JSON.`,
      retryable: false,
      details: { message },
    })
  }
}

function decodeCaptureContract<A>(schema: Schema.Decoder<A>, value: unknown, operation: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "validation",
      code: "REQUEST_PLAN_CAPTURE_CONTRACT_CHANGED",
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

function queryParamsObject(value: string): JsonObject {
  try {
    const params = new URL(value).searchParams
    const output: JsonObject = {}
    for (const [key, paramValue] of params.entries()) output[key] = paramValue
    return output
  } catch {
    const query = value.split("?")[1] ?? ""
    const params = new URLSearchParams(query)
    const output: JsonObject = {}
    for (const [key, paramValue] of params.entries()) output[key] = paramValue
    return output
  }
}

function recordValue(value: JsonValue | undefined | null): JsonObject | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null
}

function stringArrayValue(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function unknownRecord(value: unknown): Record<string, unknown> | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function unknownString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)))
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
