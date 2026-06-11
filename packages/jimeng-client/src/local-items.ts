import { createHash } from "node:crypto"
import { Schema } from "effect"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient, type JimengFetch } from "./client"
import { buildJimengEndpointProbeHeaders } from "./endpoint-probe"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import {
  JimengResearchItemWireSchema,
  normalizeJimengResearchItem,
  summarizeJimengResearchItem,
  type JimengResearchSearchItem,
} from "./research-search"
import { parseJimengApiEnvelope, parseJimengDataMap, parseJsonText } from "./schema"

const DEFAULT_QUERY = "aid=513695&device_platform=web&region=CN&web_version=7.5.0&da_version=3.3.17"

const LocalItemsDataWireSchema = Schema.Struct({
  item_list: Schema.Array(JimengResearchItemWireSchema),
})

export interface JimengLocalItemsResult {
  endpoint: "/mweb/v1/get_local_item_list"
  request: JsonObject
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  items: JimengResearchSearchItem[]
  body: JsonValue
}

export function parseJimengLocalItemIds(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const ids = normalizeLocalItemIds(value.split(","))
  if (ids.length === 0) {
    throw validationError("local-items --itemIds must include at least one item id", { value })
  }
  return ids
}

export function buildJimengLocalItemsRequest(itemIds: string[]): JsonObject {
  const ids = normalizeLocalItemIds(itemIds)
  if (ids.length === 0) {
    throw validationError("local-items --itemIds must include at least one item id", {})
  }
  return { item_id_list: ids }
}

export async function fetchJimengLocalItems(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  itemIds: string[]
}): Promise<JimengLocalItemsResult> {
  const request = buildJimengLocalItemsRequest(input.itemIds)
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/get_local_item_list?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildJimengEndpointProbeHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = parseJsonText(response.text, "local-items")
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body)
  const data = decodeLocalItemsData(parseJimengDataMap(body, "local-items"))

  return {
    endpoint: "/mweb/v1/get_local_item_list",
    request,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    items: data.item_list.map(normalizeJimengResearchItem),
    body,
  }
}

export function summarizeJimengLocalItems(result: JimengLocalItemsResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    item_count: result.items.length,
    items: result.items.map(summarizeJimengResearchItem),
  }
}

function decodeLocalItemsData(value: JsonValue): Schema.Schema.Type<typeof LocalItemsDataWireSchema> {
  try {
    return Schema.decodeUnknownSync(LocalItemsDataWireSchema)(value)
  } catch (error) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_LOCAL_ITEMS_CONTRACT_CHANGED",
      message: "/mweb/v1/get_local_item_list response did not match required item_list fields.",
      retryable: false,
      details: { error: error instanceof Error ? error.message : String(error) },
    })
  }
}

function assertJimengSuccess(body: JsonValue): void {
  const envelope = parseJimengApiEnvelope(body, "local-items")
  if (envelope.ret === undefined || envelope.ret === null || envelope.ret === "0" || envelope.ret === 0) return
  throw jimengError({
    category: "upstream",
    code: "JIMENG_RESPONSE_RET_NONZERO",
    message: `/mweb/v1/get_local_item_list returned ret=${String(envelope.ret)} errmsg=${envelope.errmsg ?? "unknown"}.`,
    retryable: false,
    details: { ret: envelope.ret, errmsg: envelope.errmsg ?? null },
  })
}

function normalizeLocalItemIds(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function retValue(body: JsonValue): string | number | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  return typeof body.ret === "string" || typeof body.ret === "number" ? body.ret : null
}

function errmsgValue(body: JsonValue): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  return typeof body.errmsg === "string" ? body.errmsg : null
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function validationError(message: string, details: JsonObject): ReturnType<typeof jimengError> {
  return jimengError({
    category: "validation",
    code: "LOCAL_ITEMS_INPUT_INVALID",
    message,
    retryable: false,
    details,
  })
}
