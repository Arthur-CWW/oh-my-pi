import { createHash } from "node:crypto"
import { Schema } from "effect"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient } from "./client"
import { buildJimengEndpointProbeHeaders } from "./endpoint-probe"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { parseJsonText } from "./schema"

const DEFAULT_QUERY = "aid=513695&device_platform=web&region=CN&web_version=7.5.0&da_version=3.3.17"
const OptionalId = Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number])))
const OptionalString = Schema.optional(Schema.NullOr(Schema.String))
const OptionalDisplayInfo = Schema.optional(Schema.NullOr(Schema.Struct({
  display_type: OptionalString,
})))

const ResearchKeywordItemWireSchema = Schema.Struct({
  gid: OptionalId,
  word: Schema.String,
  display_info: OptionalDisplayInfo,
})

const ResearchEnvelopeBase = {
  ret: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
  errmsg: OptionalString,
}

const ResearchSuggestEnvelopeSchema = Schema.Struct({
  ...ResearchEnvelopeBase,
  data: Schema.Struct({
    suggest_list: Schema.Array(ResearchKeywordItemWireSchema),
  }),
})

const ResearchGuessEnvelopeSchema = Schema.Struct({
  ...ResearchEnvelopeBase,
  data: Schema.Struct({
    guess_list: Schema.Array(ResearchKeywordItemWireSchema),
  }),
})

type ResearchKeywordItemWire = Schema.Schema.Type<typeof ResearchKeywordItemWireSchema>

export type JimengResearchKeywordEndpoint = "suggest" | "guess"
export type JimengResearchKeywordChannel = "inspiration" | "short-film" | "asset"
type JimengResearchKeywordWireChannel = "inspiration" | "short_film" | "asset"

export interface JimengResearchKeywordQuery {
  endpoints?: JimengResearchKeywordEndpoint[]
  channels?: JimengResearchKeywordChannel[]
  keyword?: string
  count?: number
}

export interface JimengResearchKeywordItem {
  gid: string | null
  gidWasUnsafeNumber: boolean
  word: string
  displayType: string | null
}

export interface JimengResearchKeywordResult {
  endpoint: "/mweb/search/v1/sug" | "/mweb/search/v1/guess"
  endpointId: JimengResearchKeywordEndpoint
  channel: JimengResearchKeywordChannel
  wireChannel: JimengResearchKeywordWireChannel
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  body: JsonValue
  items: JimengResearchKeywordItem[]
}

export interface JimengResearchKeywordBundle {
  endpoints: JimengResearchKeywordEndpoint[]
  channels: JimengResearchKeywordChannel[]
  keyword: string | null
  count: number
  results: JimengResearchKeywordResult[]
  skipped: Array<{
    endpoint: JimengResearchKeywordEndpoint
    channel: JimengResearchKeywordChannel
    reason: string
  }>
}

export function parseJimengResearchKeywordEndpoints(value: string | undefined): JimengResearchKeywordEndpoint[] {
  if (!value || value === "all") return ["suggest", "guess"]
  return parseEnumCsv({
    value,
    allowed: ["suggest", "guess"],
    code: "RESEARCH_KEYWORD_ENDPOINT_INVALID",
    message: "research-keywords --endpoints must be suggest, guess, or all.",
  })
}

export function parseJimengResearchKeywordChannels(value: string | undefined): JimengResearchKeywordChannel[] {
  if (!value || value === "all") return ["inspiration", "short-film", "asset"]
  return parseEnumCsv({
    value,
    allowed: ["inspiration", "short-film", "asset"],
    code: "RESEARCH_KEYWORD_CHANNEL_INVALID",
    message: "research-keywords --channels must be inspiration, short-film, asset, or all.",
  })
}

export function buildJimengResearchSuggestRequest(
  channel: JimengResearchKeywordChannel,
  keyword: string,
): JsonObject {
  const normalizedKeyword = keyword.trim()
  if (!normalizedKeyword) {
    throw jimengError({
      category: "validation",
      code: "RESEARCH_KEYWORD_REQUIRED",
      message: "research-keywords requires a non-empty --keyword when suggest is selected.",
      retryable: false,
    })
  }
  return {
    search_channel: toWireChannel(channel),
    keyword: normalizedKeyword,
  }
}

export function buildJimengResearchGuessRequest(
  channel: JimengResearchKeywordChannel,
  count = 10,
): JsonObject {
  assertCount(count)
  return {
    search_channel: toWireChannel(channel),
    count,
  }
}

export async function fetchJimengResearchKeywords(input: {
  client?: JimengClient
  session: JimengSessionBundle
  query?: JimengResearchKeywordQuery
}): Promise<JimengResearchKeywordBundle> {
  const endpoints = input.query?.endpoints ?? parseJimengResearchKeywordEndpoints(undefined)
  const channels = input.query?.channels ?? parseJimengResearchKeywordChannels(undefined)
  const keyword = input.query?.keyword?.trim() || null
  const count = input.query?.count ?? 10
  assertCount(count)
  if (endpoints.includes("suggest") && !keyword) {
    throw jimengError({
      category: "validation",
      code: "RESEARCH_KEYWORD_REQUIRED",
      message: "research-keywords requires a non-empty --keyword when suggest is selected.",
      retryable: false,
    })
  }

  const client = input.client ?? new JimengClient()
  const results: JimengResearchKeywordResult[] = []
  const skipped: JimengResearchKeywordBundle["skipped"] = []

  for (const endpoint of endpoints) {
    for (const channel of channels) {
      if (endpoint === "suggest" && channel === "asset") {
        skipped.push({
          endpoint,
          channel,
          reason: "Jimeng returns ret=1000 invalid parameter for asset suggestions; asset guesses remain supported",
        })
        continue
      }
      const request = endpoint === "suggest"
        ? buildJimengResearchSuggestRequest(channel, keyword ?? "")
        : buildJimengResearchGuessRequest(channel, count)
      results.push(await requestResearchKeywords({
        client,
        session: input.session,
        endpoint,
        channel,
        request,
      }))
    }
  }

  return {
    endpoints,
    channels,
    keyword,
    count,
    results,
    skipped,
  }
}

export function summarizeJimengResearchKeywords(bundle: JimengResearchKeywordBundle): JsonObject {
  return {
    endpoints: bundle.endpoints,
    channels: bundle.channels,
    keyword: bundle.keyword,
    count: bundle.count,
    result_count: bundle.results.length,
    skipped: bundle.skipped,
    results: bundle.results.map((result) => ({
      endpoint: result.endpoint,
      endpoint_id: result.endpointId,
      channel: result.channel,
      wire_channel: result.wireChannel,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      item_count: result.items.length,
      items: result.items.map((item) => ({
        gid: item.gid,
        gid_was_unsafe_number: item.gidWasUnsafeNumber,
        word: item.word,
        display_type: item.displayType,
      })),
    })),
  }
}

async function requestResearchKeywords(input: {
  client: JimengClient
  session: JimengSessionBundle
  endpoint: JimengResearchKeywordEndpoint
  channel: JimengResearchKeywordChannel
  request: JsonObject
}): Promise<JimengResearchKeywordResult> {
  const endpoint = input.endpoint === "suggest"
    ? "/mweb/search/v1/sug" as const
    : "/mweb/search/v1/guess" as const
  const response = await input.client.requestText(`https://jimeng.jianying.com${endpoint}?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildJimengEndpointProbeHeaders(input.session),
    body: JSON.stringify(input.request),
  })
  const body = parseJsonText(response.text, endpoint)
  assertNoRiskError(body, response.text)
  if (input.endpoint === "suggest") {
    const decoded = decodeResearchContract(ResearchSuggestEnvelopeSchema, body, "research keyword suggestions")
    assertJimengSuccess(decoded.ret, decoded.errmsg, endpoint)
    return buildResearchKeywordResult({
      input,
      endpoint,
      response,
      body,
      ret: decoded.ret,
      errmsg: decoded.errmsg,
      items: decoded.data.suggest_list,
    })
  }
  const decoded = decodeResearchContract(ResearchGuessEnvelopeSchema, body, "research keyword guesses")
  assertJimengSuccess(decoded.ret, decoded.errmsg, endpoint)
  return buildResearchKeywordResult({
    input,
    endpoint,
    response,
    body,
    ret: decoded.ret,
    errmsg: decoded.errmsg,
    items: decoded.data.guess_list,
  })
}

function buildResearchKeywordResult(input: {
  input: {
    endpoint: JimengResearchKeywordEndpoint
    channel: JimengResearchKeywordChannel
    request: JsonObject
  }
  endpoint: JimengResearchKeywordResult["endpoint"]
  response: { status: number; text: string }
  body: JsonValue
  ret: string | number | null | undefined
  errmsg: string | null | undefined
  items: readonly ResearchKeywordItemWire[]
}): JimengResearchKeywordResult {
  return {
    endpoint: input.endpoint,
    endpointId: input.input.endpoint,
    channel: input.input.channel,
    wireChannel: toWireChannel(input.input.channel),
    httpStatus: input.response.status,
    ret: input.ret ?? null,
    errmsg: input.errmsg ?? null,
    responseTextSha256: sha256(input.response.text),
    request: input.input.request,
    body: input.body,
    items: input.items.map(normalizeResearchKeywordItem),
  }
}

function normalizeResearchKeywordItem(item: ResearchKeywordItemWire): JimengResearchKeywordItem {
  const gidWasUnsafeNumber = typeof item.gid === "number" && !Number.isSafeInteger(item.gid)
  return {
    gid: typeof item.gid === "string"
      ? item.gid
      : typeof item.gid === "number" && Number.isSafeInteger(item.gid)
        ? String(item.gid)
        : null,
    gidWasUnsafeNumber,
    word: item.word.trim(),
    displayType: item.display_info?.display_type ?? null,
  }
}

function toWireChannel(channel: JimengResearchKeywordChannel): JimengResearchKeywordWireChannel {
  return channel === "short-film" ? "short_film" : channel
}

function parseEnumCsv<const T extends string>(input: {
  value: string
  allowed: readonly T[]
  code: string
  message: string
}): T[] {
  const values = input.value.split(",").map((part) => part.trim()).filter(Boolean)
  if (values.length === 0) {
    throw jimengError({
      category: "validation",
      code: input.code,
      message: input.message,
      retryable: false,
    })
  }
  const allowed = new Set<string>(input.allowed)
  for (const value of values) {
    if (!allowed.has(value)) {
      throw jimengError({
        category: "validation",
        code: input.code,
        message: input.message,
        retryable: false,
        details: { value, allowed: input.allowed },
      })
    }
  }
  return Array.from(new Set(values)) as T[]
}

function assertCount(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw jimengError({
      category: "validation",
      code: "RESEARCH_KEYWORD_COUNT_INVALID",
      message: "research-keywords --limit must be an integer from 1 to 50.",
      retryable: false,
      details: { count },
    })
  }
}

function decodeResearchContract<A>(schema: Schema.Decoder<A>, value: JsonValue, operation: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_RESEARCH_KEYWORD_CONTRACT_CHANGED",
      message: `${operation}: Jimeng research keyword response did not match required fields.`,
      retryable: false,
      details: {
        operation,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

function assertJimengSuccess(
  ret: string | number | null | undefined,
  errmsg: string | null | undefined,
  operation: string,
): void {
  if (ret === undefined || ret === null || ret === "0" || ret === 0) return
  throw jimengError({
    category: "upstream",
    code: "JIMENG_RESPONSE_RET_NONZERO",
    message: `${operation} returned ret=${String(ret)} errmsg=${errmsg ?? "unknown"}.`,
    retryable: false,
    details: { ret, errmsg: errmsg ?? null },
  })
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
