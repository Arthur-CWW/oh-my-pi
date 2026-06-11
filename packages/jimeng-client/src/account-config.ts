import { createHash } from "node:crypto"
import { Schema } from "effect"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient, type JimengFetch } from "./client"
import { buildJimengEndpointProbeHeaders } from "./endpoint-probe"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { parseJimengApiEnvelope, parseJimengDataMap, parseJsonText } from "./schema"

const DEFAULT_QUERY = "aid=513695&device_platform=web&region=CN&web_version=7.5.0&da_version=3.3.17"
const OptionalBoolean = Schema.optional(Schema.NullOr(Schema.Boolean))
const OptionalNumber = Schema.optional(Schema.NullOr(Schema.Number))

const UserCustomSettingsWireSchema = Schema.Struct({
  aigc_compliance_confirmed: Schema.Boolean,
  allow_remake: Schema.Boolean,
  close_watermark: Schema.Boolean,
  work_sharing_allowed: Schema.Boolean,
  work_remix_permission: OptionalNumber,
  work_sequel_permission: OptionalNumber,
  show_favorites: OptionalBoolean,
  show_followers: OptionalBoolean,
  show_following: OptionalBoolean,
  show_likes: OptionalBoolean,
})

const AccountSettingsDataWireSchema = Schema.Struct({
  user_custom_settings: UserCustomSettingsWireSchema,
})

const UgInfoDataWireSchema = Schema.Struct({
  is_web_registered: Schema.Boolean,
})

const InviteStatusDataWireSchema = Schema.Struct({
  invite_status: Schema.Number,
})

export type JimengAccountConfigEndpoint = "settings" | "ug-info" | "invite-status"

export interface JimengAccountConfigQuery {
  endpoints?: JimengAccountConfigEndpoint[]
}

export interface JimengAccountConfigResult {
  endpoint: "/mweb/v1/get_settings" | "/mweb/v1/get_ug_info" | "/mweb/v1/get_invite_status"
  endpointId: JimengAccountConfigEndpoint
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  body: JsonValue
  data: JsonObject
}

export interface JimengAccountConfigBundle {
  endpoints: JimengAccountConfigEndpoint[]
  results: JimengAccountConfigResult[]
}

export function parseJimengAccountConfigEndpoints(value: string | undefined): JimengAccountConfigEndpoint[] {
  if (!value || value === "all") return ["settings", "ug-info", "invite-status"]
  const allowed = new Set<JimengAccountConfigEndpoint>(["settings", "ug-info", "invite-status"])
  const endpoints: JimengAccountConfigEndpoint[] = []
  for (const part of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    if (!allowed.has(part as JimengAccountConfigEndpoint)) {
      throw jimengError({
        category: "validation",
        code: "ACCOUNT_CONFIG_ENDPOINT_INVALID",
        message: "account-config --endpoints must be settings, ug-info, invite-status, or all.",
        retryable: false,
        details: { endpoint: part, allowed: Array.from(allowed) },
      })
    }
    endpoints.push(part as JimengAccountConfigEndpoint)
  }
  return Array.from(new Set(endpoints))
}

export function buildJimengAccountConfigRequest(_endpoint: JimengAccountConfigEndpoint): JsonObject {
  return {}
}

export async function fetchJimengAccountConfig(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  query?: JimengAccountConfigQuery
}): Promise<JimengAccountConfigBundle> {
  const endpoints = input.query?.endpoints ?? parseJimengAccountConfigEndpoints(undefined)
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const results: JimengAccountConfigResult[] = []
  for (const endpoint of endpoints) {
    results.push(await fetchAccountConfigEndpoint({ client, session: input.session, endpoint }))
  }
  return { endpoints, results }
}

export function summarizeJimengAccountConfig(bundle: JimengAccountConfigBundle): JsonObject {
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

async function fetchAccountConfigEndpoint(input: {
  client: JimengClient
  session: JimengSessionBundle
  endpoint: JimengAccountConfigEndpoint
}): Promise<JimengAccountConfigResult> {
  const endpointPath = endpointPathForId(input.endpoint)
  const request = buildJimengAccountConfigRequest(input.endpoint)
  const response = await input.client.requestText(`https://jimeng.jianying.com${endpointPath}?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildJimengEndpointProbeHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = parseJsonText(response.text, input.endpoint)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, endpointPath)
  const data = parseJimengDataMap(body, input.endpoint)
  decodeAccountConfigData(input.endpoint, data)
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

function decodeAccountConfigData(endpoint: JimengAccountConfigEndpoint, data: JsonValue): void {
  try {
    if (endpoint === "settings") {
      Schema.decodeUnknownSync(AccountSettingsDataWireSchema)(data)
    } else if (endpoint === "ug-info") {
      Schema.decodeUnknownSync(UgInfoDataWireSchema)(data)
    } else {
      Schema.decodeUnknownSync(InviteStatusDataWireSchema)(data)
    }
  } catch (error) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_ACCOUNT_CONFIG_CONTRACT_CHANGED",
      message: `${endpoint}: Jimeng account config response did not match required fields.`,
      retryable: false,
      details: { endpoint, error: error instanceof Error ? error.message : String(error) },
    })
  }
}

function summarizeEndpointData(result: JimengAccountConfigResult): JsonObject {
  if (result.endpointId === "settings") return summarizeSettings(result.data)
  if (result.endpointId === "ug-info") {
    return { is_web_registered: booleanValue(result.data.is_web_registered) }
  }
  return { invite_status: numberValue(result.data.invite_status) }
}

function summarizeSettings(data: JsonObject): JsonObject {
  const settings = objectValue(data.user_custom_settings)
  const settingsExtra = objectValue(data.settings_extra)
  const permissionSettings = arrayValue(settingsExtra?.permission_settings)
  return {
    user_custom_settings: settings ? {
      aigc_compliance_confirmed: booleanValue(settings.aigc_compliance_confirmed),
      allow_remake: booleanValue(settings.allow_remake),
      close_watermark: booleanValue(settings.close_watermark),
      work_sharing_allowed: booleanValue(settings.work_sharing_allowed),
      work_remix_permission: numberValue(settings.work_remix_permission),
      work_sequel_permission: numberValue(settings.work_sequel_permission),
      show_favorites: booleanValue(settings.show_favorites),
      show_followers: booleanValue(settings.show_followers),
      show_following: booleanValue(settings.show_following),
      show_likes: booleanValue(settings.show_likes),
    } : null,
    permission_setting_count: permissionSettings?.length ?? null,
  }
}

function endpointPathForId(endpoint: JimengAccountConfigEndpoint): JimengAccountConfigResult["endpoint"] {
  if (endpoint === "settings") return "/mweb/v1/get_settings"
  if (endpoint === "ug-info") return "/mweb/v1/get_ug_info"
  return "/mweb/v1/get_invite_status"
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

function booleanValue(value: JsonValue | undefined): boolean | null {
  return typeof value === "boolean" ? value : null
}

function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
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
