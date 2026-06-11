import { createHash } from "node:crypto"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient, type JimengFetch } from "./client"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { parseJimengApiEnvelope, parseJsonText } from "./schema"

const DEFAULT_QUERY = "aid=513695&device_platform=web&region=CN&web_version=7.5.0&da_version=3.3.17"
const URL_LIKE_RE = /https?:\/\/|byteimg|douyinpic|vlabvod|x-signature|x-expires|expire_time/i

export interface JimengEndpointProbeVariant {
  name: string
  body: JsonValue
}

export interface JimengEndpointProbeInput {
  endpoint: string
  method?: "GET" | "POST"
  query?: string
  host?: string
  variants: JimengEndpointProbeVariant[]
}

export interface JimengEndpointProbeVariantResult {
  name: string
  requestBody: JsonValue
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  responseTextHasUrlLikeTokens: boolean
  topLevelKeys: string[]
  body: JsonValue
}

export interface JimengEndpointProbeResult {
  endpoint: string
  url: string
  method: "GET" | "POST"
  results: JimengEndpointProbeVariantResult[]
}

export function buildJimengEndpointProbeUrl(input: {
  endpoint: string
  host?: string
  query?: string
}): string {
  const base = input.host ?? "https://jimeng.jianying.com"
  const url = input.endpoint.startsWith("http://") || input.endpoint.startsWith("https://")
    ? new URL(input.endpoint)
    : new URL(input.endpoint, base)
  const query = input.query ?? (url.search ? "" : input.endpoint.startsWith("/mweb/") ? DEFAULT_QUERY : "")
  if (query) {
    const params = new URLSearchParams(query)
    for (const [key, value] of params) url.searchParams.set(key, value)
  }
  return url.toString()
}

export function parseJimengEndpointProbeVariants(text: string): JimengEndpointProbeVariant[] {
  const parsed = parseJsonText(text, "endpoint probe variants")
  const root = asRecord(parsed)
  const source = asArray(parsed) ?? asArray(root?.variants)
  if (!source || source.length === 0) {
    throw jimengError({
      category: "validation",
      code: "ENDPOINT_PROBE_VARIANTS_INVALID",
      message: "Endpoint probe variants must be a JSON array or an object with a variants array.",
      retryable: false,
    })
  }
  return source.map((value, index) => {
    const record = asRecord(value)
    if (!record) {
      throw jimengError({
        category: "validation",
        code: "ENDPOINT_PROBE_VARIANT_INVALID",
        message: "Each endpoint probe variant must be an object.",
        retryable: false,
        details: { index },
      })
    }
    const name = stringValue(record.name) ?? `variant-${index + 1}`
    if (!/^[0-9A-Za-z_.-]+$/.test(name)) {
      throw jimengError({
        category: "validation",
        code: "ENDPOINT_PROBE_VARIANT_NAME_INVALID",
        message: "Endpoint probe variant names may contain only letters, numbers, dot, dash, or underscore.",
        retryable: false,
        details: { name },
      })
    }
    return { name, body: record.body ?? {} }
  })
}

export function buildSingleEndpointProbeVariant(text: string): JimengEndpointProbeVariant[] {
  return [{ name: "body", body: parseJsonText(text, "endpoint probe body") }]
}

export async function runJimengEndpointProbe(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  probe: JimengEndpointProbeInput
}): Promise<JimengEndpointProbeResult> {
  const method = input.probe.method ?? "POST"
  const url = buildJimengEndpointProbeUrl(input.probe)
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const results: JimengEndpointProbeVariantResult[] = []
  for (const variant of input.probe.variants) {
    const response = await client.requestText(url, {
      method,
      headers: buildEndpointProbeHeaders(input.session),
      body: method === "GET" ? undefined : JSON.stringify(variant.body),
    })
    const body = parseJsonText(response.text, `endpoint probe ${variant.name}`)
    assertNoRiskError(body, response.text)
    const envelope = parseOptionalEnvelope(body, variant.name)
    results.push({
      name: variant.name,
      requestBody: variant.body,
      httpStatus: response.status,
      ret: envelope.ret,
      errmsg: envelope.errmsg,
      responseTextSha256: sha256(response.text),
      responseTextHasUrlLikeTokens: URL_LIKE_RE.test(response.text),
      topLevelKeys: Object.keys(asRecord(body) ?? {}).sort(),
      body,
    })
  }
  return { endpoint: input.probe.endpoint, url, method, results }
}

export function summarizeJimengEndpointProbe(result: JimengEndpointProbeResult): JsonObject {
  const url = new URL(result.url)
  return {
    endpoint: result.endpoint,
    url_host: url.host,
    url_pathname: url.pathname,
    url_query_keys: Array.from(url.searchParams.keys()).sort(),
    method: result.method,
    variant_count: result.results.length,
    results: result.results.map((item) => ({
      name: item.name,
      http_status: item.httpStatus,
      ret: item.ret,
      errmsg: item.errmsg,
      response_text_sha256: item.responseTextSha256,
      response_text_has_url_like_tokens: item.responseTextHasUrlLikeTokens,
      top_level_keys: item.topLevelKeys,
      request_shape: summarizeJsonShape(item.requestBody),
      response_shape: summarizeJsonShape(item.body),
    })),
  }
}

export function buildJimengEndpointProbeHeaders(session: JimengSessionBundle): Record<string, string> {
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

const buildEndpointProbeHeaders = buildJimengEndpointProbeHeaders

function parseOptionalEnvelope(body: JsonValue, name: string): { ret: string | number | null; errmsg: string | null } {
  try {
    const envelope = parseJimengApiEnvelope(body, `endpoint probe ${name}`)
    return {
      ret: envelope.ret ?? null,
      errmsg: envelope.errmsg ?? null,
    }
  } catch {
    return { ret: null, errmsg: null }
  }
}

function summarizeJsonShape(value: JsonValue, depth = 0): JsonObject {
  if (value === null) return { kind: "null" }
  if (typeof value === "string") {
    return {
      kind: "string",
      length: value.length,
      url_like: URL_LIKE_RE.test(value),
    }
  }
  if (typeof value === "number") return { kind: "number" }
  if (typeof value === "boolean") return { kind: "boolean" }
  if (Array.isArray(value)) {
    return {
      kind: "array",
      length: value.length,
      first: depth >= 3 || value.length === 0 ? null : summarizeJsonShape(value[0]!, depth + 1),
    }
  }
  const keys = Object.keys(value).sort()
  const fields: JsonObject = {}
  if (depth < 3) {
    for (const key of keys.slice(0, 16)) fields[key] = summarizeJsonShape(value[key], depth + 1)
  }
  return {
    kind: "object",
    key_count: keys.length,
    keys: keys.slice(0, 64),
    fields,
  }
}

function asRecord(value: JsonValue | undefined): JsonObject | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function asArray(value: JsonValue | undefined): JsonValue[] | null {
  return Array.isArray(value) ? value : null
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
