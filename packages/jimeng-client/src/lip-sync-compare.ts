import { createHash } from "node:crypto"
import { z } from "zod"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { JimengJsonObjectSchema, JimengJsonValueSchema } from "./schema"

const LIP_SYNC_SUBMIT_PATH = "/mweb/v1/aigc_draft/generate"
const URL_LIKE_RE = /https?:\/\/|byteimg|douyinpic|vlabvod|x-signature|x-expires|expire_time/i

const RawNetworkCdpEventSchema = z.object({
  kind: z.literal("cdpEvent"),
  method: z.string().optional(),
  params: JimengJsonObjectSchema.optional(),
}).passthrough()

const CaptureTemplateSchema = z.object({
  entries: z.array(z.object({
    kind: z.string(),
    url: z.string().optional().nullable(),
    postData: z.string().optional().nullable(),
  }).passthrough()),
}).passthrough()

export type JimengLipSyncCompareMode = "image" | "video" | "undetected"

export interface JimengLipSyncCompareDifference {
  path: string
  kind: "missing" | "mismatch" | "array_length"
  expected: JsonObject
  actual: JsonObject
}

export interface JimengLipSyncCompareCandidate {
  index: number
  mode: JimengLipSyncCompareMode
  request_id: string | null
  url_pathname: string
  submit_id_present: boolean
  model_req_key_match: boolean
  provider_input_match: boolean
  matched_path_count: number
  difference_count: number
  differences: JimengLipSyncCompareDifference[]
}

export interface JimengLipSyncCompareResult {
  mode: JimengLipSyncCompareMode
  match: boolean
  plan_model_req_key: string | null
  candidate_count: number
  candidates: JimengLipSyncCompareCandidate[]
}

interface CapturedSubmitRequest {
  requestId: string | null
  url: string
  postData: string
}

interface CapturedProviderInput {
  submitId: string | null
  modelReqKey: string | null
  videoGenInput: JsonObject | null
}

interface ExpectedProviderInput {
  mode: JimengLipSyncCompareMode
  modelReqKey: string | null
  videoGenInputs: JsonObject
}

export function compareJimengLipSyncPlanWithRawNetwork(input: {
  dryRunPlanText: string
  rawNetworkText: string
}): JimengLipSyncCompareResult {
  return compareJimengLipSyncPlanWithRequests({
    dryRunPlanText: input.dryRunPlanText,
    requests: extractLipSyncSubmitRequestsFromRawNetwork(input.rawNetworkText),
  })
}

export function compareJimengLipSyncPlanWithCaptureTemplate(input: {
  dryRunPlanText: string
  captureTemplateText: string
}): JimengLipSyncCompareResult {
  return compareJimengLipSyncPlanWithRequests({
    dryRunPlanText: input.dryRunPlanText,
    requests: extractLipSyncSubmitRequestsFromCaptureTemplate(input.captureTemplateText),
  })
}

export function compareJimengLipSyncPlanWithRequests(input: {
  dryRunPlanText: string
  requests: CapturedSubmitRequest[]
}): JimengLipSyncCompareResult {
  const expected = parseExpectedProviderInput(input.dryRunPlanText)
  const candidates = input.requests.map((request, index) => compareCapturedRequest(expected, request, index))
  const best = candidates.find((candidate) => candidate.model_req_key_match && candidate.provider_input_match)
  return {
    mode: expected.mode,
    match: !!best,
    plan_model_req_key: expected.modelReqKey,
    candidate_count: candidates.length,
    candidates,
  }
}

export function summarizeJimengLipSyncCompare(result: JimengLipSyncCompareResult): JsonObject {
  return {
    mode: result.mode,
    match: result.match,
    plan_model_req_key: result.plan_model_req_key,
    candidate_count: result.candidate_count,
    candidates: result.candidates.map((candidate) => ({
      index: candidate.index,
      mode: candidate.mode,
      request_id_present: candidate.request_id !== null,
      url_pathname: candidate.url_pathname,
      submit_id_present: candidate.submit_id_present,
      model_req_key_match: candidate.model_req_key_match,
      provider_input_match: candidate.provider_input_match,
      matched_path_count: candidate.matched_path_count,
      difference_count: candidate.difference_count,
      differences: candidate.differences.slice(0, 20).map((difference) => ({
        path: difference.path,
        kind: difference.kind,
        expected: difference.expected,
        actual: difference.actual,
      })),
    })),
  }
}

function compareCapturedRequest(expected: ExpectedProviderInput, request: CapturedSubmitRequest, index: number): JimengLipSyncCompareCandidate {
  const captured = parseCapturedProviderInput(request.postData)
  const differences: JimengLipSyncCompareDifference[] = []
  const matchedPathCount = compareSubset(expected.videoGenInputs, captured.videoGenInput, "videoGenInputs", differences)
  const modelReqKeyMatch = expected.modelReqKey !== null && captured.modelReqKey === expected.modelReqKey
  const mode = detectMode(captured.videoGenInput)
  if (!modelReqKeyMatch) {
    differences.unshift({
      path: "modelReqKey",
      kind: captured.modelReqKey === null ? "missing" : "mismatch",
      expected: describeValue(expected.modelReqKey),
      actual: describeValue(captured.modelReqKey),
    })
  }
  return {
    index,
    mode,
    request_id: request.requestId,
    url_pathname: pathnameValue(request.url),
    submit_id_present: captured.submitId !== null,
    model_req_key_match: modelReqKeyMatch,
    provider_input_match: differences.length === 0,
    matched_path_count: matchedPathCount,
    difference_count: differences.length,
    differences,
  }
}

function parseExpectedProviderInput(text: string): ExpectedProviderInput {
  const root = parseJsonObject(text, "lip-sync dry-run plan")
  const plan = recordValue(root.plan) ?? root
  const providerInput = recordValue(plan.providerInput)
  const videoGenInputs = recordValue(providerInput?.videoGenInputs)
  if (!providerInput || !videoGenInputs) {
    throw jimengError({
      category: "validation",
      code: "LIP_SYNC_PLAN_PROVIDER_INPUT_MISSING",
      message: "Lip-sync dry-run plan is missing providerInput.videoGenInputs.",
      retryable: false,
    })
  }
  return {
    mode: detectMode(videoGenInputs),
    modelReqKey: stringValue(providerInput.modelReqKey),
    videoGenInputs,
  }
}

function parseCapturedProviderInput(postData: string): CapturedProviderInput {
  const body = parseJsonObject(postData, "captured lip-sync submit body")
  const draftText = stringValue(body.draft_content)
  if (!draftText) return { submitId: stringValue(body.submit_id), modelReqKey: null, videoGenInput: null }
  const draft = parseJsonObject(draftText, "captured lip-sync draft_content")
  const firstComponent = recordValue(arrayValue(draft.component_list)[0])
  const abilities = recordValue(firstComponent?.abilities)
  const genVideo = recordValue(abilities?.gen_video)
  const textToVideo = recordValue(genVideo?.text_to_video_params)
  const firstInput = recordValue(arrayValue(textToVideo?.video_gen_inputs)[0])
  return {
    submitId: stringValue(body.submit_id),
    modelReqKey: stringValue(textToVideo?.model_req_key),
    videoGenInput: firstInput,
  }
}

function extractLipSyncSubmitRequestsFromRawNetwork(text: string): CapturedSubmitRequest[] {
  const requests: CapturedSubmitRequest[] = []
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  for (const [index, line] of lines.entries()) {
    const event = parseRawNetworkCdpEvent(line, index + 1)
    if (!event || event.method !== "Network.requestWillBeSent") continue
    const params = event.params
    const request = recordValue(params?.request)
    const url = stringValue(request?.url)
    const postData = stringValue(request?.postData)
    if (!url || !postData || !url.includes(LIP_SYNC_SUBMIT_PATH)) continue
    requests.push({
      requestId: stringValue(params?.requestId),
      url,
      postData,
    })
  }
  return requests
}

function extractLipSyncSubmitRequestsFromCaptureTemplate(text: string): CapturedSubmitRequest[] {
  const parsed = CaptureTemplateSchema.safeParse(parseJsonValue(text, "capture template"))
  if (!parsed.success) {
    throw jimengError({
      category: "validation",
      code: "LIP_SYNC_CAPTURE_TEMPLATE_CHANGED",
      message: "Capture template does not match the expected entries contract.",
      retryable: false,
      details: { issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message })) },
    })
  }
  return parsed.data.entries.flatMap((entry, index) => {
    if (entry.kind !== "request" || !entry.url || !entry.postData || !entry.url.includes(LIP_SYNC_SUBMIT_PATH)) return []
    return [{ requestId: `capture-template-${index}`, url: entry.url, postData: entry.postData }]
  })
}

function parseRawNetworkCdpEvent(line: string, lineNumber: number): z.infer<typeof RawNetworkCdpEventSchema> | null {
  const value = parseJsonValue(line, `raw-network line ${lineNumber}`)
  const record = recordValue(value)
  if (record?.kind !== "cdpEvent") return null
  const parsed = RawNetworkCdpEventSchema.safeParse(value)
  if (parsed.success) return parsed.data
  throw jimengError({
    category: "validation",
    code: "LIP_SYNC_RAW_NETWORK_EVENT_CHANGED",
    message: "Raw network CDP event did not match the expected contract.",
    retryable: false,
    details: { line: lineNumber, issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message })) },
  })
}

function compareSubset(expected: JsonValue, actual: JsonValue | null, pathKey: string, differences: JimengLipSyncCompareDifference[]): number {
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

  if (scalarEqual(expected, actual)) return 1
  differences.push({ path: pathKey, kind: "mismatch", expected: describeValue(expected), actual: describeValue(actual) })
  return 0
}

function scalarEqual(left: JsonValue, right: JsonValue): boolean {
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) < 0.001
  return left === right
}

function detectMode(videoGenInputs: JsonObject | null): JimengLipSyncCompareMode {
  if (recordValue(recordValue(videoGenInputs?.i2vOpt)?.realmanAvatar)) return "image"
  if (recordValue(recordValue(videoGenInputs?.v2vOpt)?.lipSyncUserVideo)) return "video"
  return "undetected"
}

function parseJsonObject(text: string, operation: string): JsonObject {
  const value = parseJsonValue(text, operation)
  const record = recordValue(value)
  if (record) return record
  throw jimengError({
    category: "validation",
    code: "LIP_SYNC_JSON_OBJECT_REQUIRED",
    message: `${operation} must be a JSON object.`,
    retryable: false,
  })
}

function parseJsonValue(text: string, operation: string): JsonValue {
  try {
    return JimengJsonValueSchema.parse(JSON.parse(text))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "validation",
      code: "LIP_SYNC_JSON_PARSE_FAILED",
      message: `${operation} was not valid JSON.`,
      retryable: false,
      details: { message },
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

function arrayValue(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
