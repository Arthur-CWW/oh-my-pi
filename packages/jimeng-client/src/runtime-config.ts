import { createHash } from "node:crypto"
import { Schema } from "effect"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient } from "./client"
import { buildJimengEndpointProbeHeaders } from "./endpoint-probe"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { parseJimengApiEnvelope, parseJimengDataMap, parseJsonText } from "./schema"

const DEFAULT_QUERY = "aid=513695&device_platform=web&region=CN&web_version=7.5.0&da_version=3.3.17"
const OptionalString = Schema.optional(Schema.NullOr(Schema.String))

const JsonRecordWireSchema = Schema.Record(Schema.String, Schema.Unknown)

const ExperimentParamsDataWireSchema = Schema.Struct({
  params: JsonRecordWireSchema,
})

const HomeHeaderBannerItemWireSchema = Schema.Record(Schema.String, Schema.Unknown)

const HomeHeaderBannerDataWireSchema = Schema.Struct({
  items: Schema.Array(HomeHeaderBannerItemWireSchema),
  panel_key: OptionalString,
  source: OptionalString,
})

const HelpDeskEntranceDataWireSchema = Schema.Struct({
  url: Schema.String,
})

const AsrTokenDataWireSchema = Schema.Struct({
  appkey: Schema.String,
  expire_at: Schema.Number,
  token: Schema.String,
  ws_url: Schema.String,
})

const AsrHotwordsDataWireSchema = Schema.Struct({
  hot_word_info: Schema.Struct({
    today_word: Schema.Array(Schema.Unknown),
  }),
})

export type JimengRuntimeConfigEndpoint =
  | "experiment-params"
  | "home-header-banner"
  | "help-desk-entrance"
  | "asr-token"
  | "asr-hotwords"

export interface JimengRuntimeConfigQuery {
  endpoints?: JimengRuntimeConfigEndpoint[]
}

export interface JimengRuntimeConfigResult {
  endpoint:
    | "/mweb/v1/get_experiment_params"
    | "/mweb/v1/get_home_header_banner_config"
    | "/mweb/v1/get_help_desk_entrance"
    | "/mweb/v1/speech/asr_token"
    | "/mweb/v1/speech/asr_hotwords"
  endpointId: JimengRuntimeConfigEndpoint
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  body: JsonValue
  data: JsonObject
}

export interface JimengRuntimeConfigBundle {
  endpoints: JimengRuntimeConfigEndpoint[]
  results: JimengRuntimeConfigResult[]
}

export function parseJimengRuntimeConfigEndpoints(value: string | undefined): JimengRuntimeConfigEndpoint[] {
  if (!value || value === "all") {
    return ["experiment-params", "home-header-banner", "help-desk-entrance", "asr-token", "asr-hotwords"]
  }
  const allowed = new Set<JimengRuntimeConfigEndpoint>([
    "experiment-params",
    "home-header-banner",
    "help-desk-entrance",
    "asr-token",
    "asr-hotwords",
  ])
  const endpoints: JimengRuntimeConfigEndpoint[] = []
  for (const part of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    if (!allowed.has(part as JimengRuntimeConfigEndpoint)) {
      throw jimengError({
        category: "validation",
        code: "RUNTIME_CONFIG_ENDPOINT_INVALID",
        message: "runtime-config --endpoints must be experiment-params, home-header-banner, help-desk-entrance, asr-token, asr-hotwords, or all.",
        retryable: false,
        details: { endpoint: part, allowed: Array.from(allowed) },
      })
    }
    endpoints.push(part as JimengRuntimeConfigEndpoint)
  }
  return Array.from(new Set(endpoints))
}

export function buildJimengRuntimeConfigRequest(_endpoint: JimengRuntimeConfigEndpoint): JsonObject {
  return {}
}

export async function fetchJimengRuntimeConfig(input: {
  client?: JimengClient
  session: JimengSessionBundle
  query?: JimengRuntimeConfigQuery
}): Promise<JimengRuntimeConfigBundle> {
  const endpoints = input.query?.endpoints ?? parseJimengRuntimeConfigEndpoints(undefined)
  const client = input.client ?? new JimengClient()
  const results: JimengRuntimeConfigResult[] = []
  for (const endpoint of endpoints) {
    results.push(await fetchRuntimeConfigEndpoint({ client, session: input.session, endpoint }))
  }
  return { endpoints, results }
}

export function summarizeJimengRuntimeConfig(bundle: JimengRuntimeConfigBundle): JsonObject {
  return {
    endpoints: bundle.endpoints,
    result_count: bundle.results.length,
    results: bundle.results.map((result) => ({
      endpoint: result.endpoint,
      endpoint_id: result.endpointId,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      ...summarizeEndpointData(result),
    })),
  }
}

async function fetchRuntimeConfigEndpoint(input: {
  client: JimengClient
  session: JimengSessionBundle
  endpoint: JimengRuntimeConfigEndpoint
}): Promise<JimengRuntimeConfigResult> {
  const endpointPath = endpointPathForId(input.endpoint)
  const request = buildJimengRuntimeConfigRequest(input.endpoint)
  const response = await input.client.requestText(`https://jimeng.jianying.com${endpointPath}?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildJimengEndpointProbeHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = parseJsonText(response.text, input.endpoint)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, endpointPath)
  const data = parseJimengDataMap(body, input.endpoint)
  decodeRuntimeConfigData(input.endpoint, data)
  return {
    endpoint: endpointPath,
    endpointId: input.endpoint,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    body,
    data,
  }
}

function decodeRuntimeConfigData(endpoint: JimengRuntimeConfigEndpoint, data: JsonValue): void {
  try {
    if (endpoint === "experiment-params") {
      Schema.decodeUnknownSync(ExperimentParamsDataWireSchema)(data)
    } else if (endpoint === "home-header-banner") {
      Schema.decodeUnknownSync(HomeHeaderBannerDataWireSchema)(data)
    } else if (endpoint === "help-desk-entrance") {
      Schema.decodeUnknownSync(HelpDeskEntranceDataWireSchema)(data)
    } else if (endpoint === "asr-token") {
      Schema.decodeUnknownSync(AsrTokenDataWireSchema)(data)
    } else {
      Schema.decodeUnknownSync(AsrHotwordsDataWireSchema)(data)
    }
  } catch (error) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_RUNTIME_CONFIG_CONTRACT_CHANGED",
      message: `${endpoint}: Jimeng runtime config response did not match required fields.`,
      retryable: false,
      details: { endpoint, error: error instanceof Error ? error.message : String(error) },
    })
  }
}

function summarizeEndpointData(result: JimengRuntimeConfigResult): JsonObject {
  if (result.endpointId === "experiment-params") return summarizeExperimentParams(result.data)
  if (result.endpointId === "home-header-banner") return summarizeHomeHeaderBanner(result.data)
  if (result.endpointId === "help-desk-entrance") return summarizeHelpDeskEntrance(result.data)
  if (result.endpointId === "asr-token") return summarizeAsrToken(result.data)
  return summarizeAsrHotwords(result.data)
}

function summarizeExperimentParams(data: JsonObject): JsonObject {
  const params = objectValue(data.params)
  const keys = Object.keys(params ?? {}).sort()
  return {
    params_kind: params ? "object" : kindOf(data.params),
    params_key_count: keys.length,
    params_keys: keys.slice(0, 50),
  }
}

function summarizeHomeHeaderBanner(data: JsonObject): JsonObject {
  const items = arrayValue(data.items) ?? []
  const bannerKeys = sortedUnique(items.map((item) => stringFromObjectField(item, "banner_key")))
  const itemCodes = sortedUnique(items.map((item) => stringFromObjectField(item, "item_code")))
  return {
    item_count: items.length,
    panel_key: stringValue(data.panel_key),
    source: stringValue(data.source),
    banner_keys: bannerKeys.slice(0, 50),
    item_codes: itemCodes.slice(0, 50),
  }
}

function summarizeHelpDeskEntrance(data: JsonObject): JsonObject {
  return {
    url: stringFingerprint(data.url),
  }
}

function summarizeAsrToken(data: JsonObject): JsonObject {
  return {
    appkey: stringFingerprint(data.appkey),
    expire_at: numberValue(data.expire_at),
    token: stringFingerprint(data.token),
    token_present: typeof data.token === "string" && data.token.length > 0,
    ws_url: stringFingerprint(data.ws_url),
  }
}

function summarizeAsrHotwords(data: JsonObject): JsonObject {
  const info = objectValue(data.hot_word_info)
  const todayWords = arrayValue(info?.today_word)
  return {
    hot_word_info_keys: info ? Object.keys(info).sort() : [],
    today_word_count: todayWords?.length ?? null,
  }
}

function endpointPathForId(endpoint: JimengRuntimeConfigEndpoint): JimengRuntimeConfigResult["endpoint"] {
  if (endpoint === "experiment-params") return "/mweb/v1/get_experiment_params"
  if (endpoint === "home-header-banner") return "/mweb/v1/get_home_header_banner_config"
  if (endpoint === "help-desk-entrance") return "/mweb/v1/get_help_desk_entrance"
  if (endpoint === "asr-token") return "/mweb/v1/speech/asr_token"
  return "/mweb/v1/speech/asr_hotwords"
}

function assertJimengSuccess(body: JsonValue, operation: string): void {
  const envelope = parseJimengApiEnvelope(body, operation)
  if (envelope.ret === undefined || envelope.ret === null || envelope.ret === "0" || envelope.ret === 0) return
  throw jimengError({
    category: "upstream",
    code: "JIMENG_RESPONSE_RET_NONZERO",
    message: `${operation} returned ret=${String(envelope.ret)} errmsg=${envelope.errmsg ?? "unknown"}.`,
    retryable: false,
    details: { ret: envelope.ret, errmsg: envelope.errmsg ?? null },
  })
}

function objectValue(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function arrayValue(value: JsonValue | undefined): JsonValue[] | null {
  return Array.isArray(value) ? value : null
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null
}

function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stringFingerprint(value: JsonValue | undefined): JsonObject | null {
  if (typeof value !== "string") return null
  return {
    length: value.length,
    sha256: sha256(value),
  }
}

function stringFromObjectField(value: JsonValue, key: string): string | null {
  const object = objectValue(value)
  return object ? stringValue(object[key]) : null
}

function sortedUnique(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value))).sort()
}

function kindOf(value: JsonValue | undefined): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

function retValue(body: JsonValue): string | number | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const ret = body.ret
  return typeof ret === "string" || typeof ret === "number" ? ret : null
}

function errmsgValue(body: JsonValue): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  return typeof body.errmsg === "string" ? body.errmsg : null
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
