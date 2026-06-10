import { createHash } from "node:crypto"
import { z } from "zod"
import { buildCapCutSignedHeaders } from "./capcut-templates"
import { JimengClient } from "./client"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { JimengJsonValueSchema, parseJimengApiEnvelope, parseJimengContract, parseJsonText } from "./schema"

const CAPCUT_EDITOR_HOST = "https://edit-api-sg.capcut.com"
const CAPCUT_EDITOR_APP_VERSION = "999.999.999"
const CAPCUT_EDITOR_SDK_VERSION = "16.1.0"
const DEFAULT_PANEL = "fonts"
const DEFAULT_LANG = "en"
const DEFAULT_REGION = "US"

const OptionalStringish = z.union([z.string(), z.number()]).nullable().optional()
const OptionalString = z.string().nullable().optional()
const OptionalNumber = z.number().nullable().optional()
const OptionalBoolean = z.boolean().nullable().optional()

const LvBaseRespWireSchema = z.object({
  StatusCode: OptionalNumber,
  StatusMessage: OptionalString,
  Extra: JimengJsonValueSchema.nullable().optional(),
}).passthrough()

const LvFileRefWireSchema = z.object({
  Uri: OptionalString,
  UrlList: z.array(z.string()).nullable().optional(),
}).passthrough()

const LvEditorCategoryWireSchema = z.object({
  Id: OptionalStringish,
  Key: OptionalString,
  Name: OptionalString,
  Tags: z.array(JimengJsonValueSchema).nullable().optional(),
  ChildrenCategories: z.array(OptionalStringish).nullable().optional(),
}).passthrough()

const LvEditorEffectWireSchema = z.object({
  ResourceId: OptionalStringish,
  Id: OptionalStringish,
  EffectId: OptionalStringish,
  Name: OptionalString,
  Panel: OptionalString,
  SdkVersion: OptionalString,
  FileUrl: LvFileRefWireSchema.nullable().optional(),
  IconUrl: LvFileRefWireSchema.nullable().optional(),
  Tags: z.array(JimengJsonValueSchema).nullable().optional(),
  IsBusiness: OptionalBoolean,
}).passthrough()

const LvCategoryEffectsWireSchema = z.object({
  HasMore: OptionalBoolean,
  Cursor: OptionalNumber,
  SortingPosition: OptionalNumber,
  CategoryKey: OptionalString,
  Effects: z.array(LvEditorEffectWireSchema),
}).passthrough()

const LvEditorCatalogDataWireSchema = z.object({
  CategoryList: z.array(LvEditorCategoryWireSchema).nullable().optional(),
  CategoryEffects: LvCategoryEffectsWireSchema,
  UrlPrefix: z.array(z.string()).nullable().optional(),
}).passthrough()

const LvEditorCatalogBodyWireSchema = z.object({
  BaseResp: LvBaseRespWireSchema,
  data: LvEditorCatalogDataWireSchema,
}).passthrough()

const LvColorFeedBodyWireSchema = z.object({
  ret: z.union([z.string(), z.number()]).optional(),
  errmsg: OptionalString,
  data: z.object({
    palettes: z.array(z.array(z.array(z.number()))),
  }).passthrough(),
}).passthrough()

export type CapCutEditorCatalogEndpoint = "panel" | "effects" | "fonts" | "colors"

export interface CapCutEditorCatalogQuery {
  endpoints?: CapCutEditorCatalogEndpoint[]
  panel?: string
  category?: string
  limit?: number
  offset?: number
  lang?: string
  region?: string
  lan?: string
  loc?: string
}

export interface CapCutEditorCatalogCategory {
  id: string
  key: string | null
  name: string | null
  tagCount: number
  childCategoryCount: number
}

export interface CapCutEditorCatalogEffect {
  resourceId: string | null
  itemId: string | null
  effectId: string | null
  name: string | null
  panel: string | null
  sdkVersion: string | null
  fileUri: string | null
  fileUrlPresent: boolean
  iconUri: string | null
  iconUrlPresent: boolean
  tagCount: number
  isBusiness: boolean | null
}

export interface CapCutEditorCatalogPalette {
  colorCount: number
  colors: string[]
}

export interface CapCutEditorCatalogEndpointResult {
  endpointId: CapCutEditorCatalogEndpoint
  endpoint: string
  host: string
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  statusCode: number | null
  statusMessage: string | null
  categoryCount: number
  effectCount: number
  paletteCount: number
  hasMore: boolean | null
  cursor: number | null
  sortingPosition: number | null
  categoryKey: string | null
  categories: CapCutEditorCatalogCategory[]
  effects: CapCutEditorCatalogEffect[]
  palettes: CapCutEditorCatalogPalette[]
  body: JsonValue
}

export interface CapCutEditorCatalogResult {
  endpoints: CapCutEditorCatalogEndpoint[]
  results: CapCutEditorCatalogEndpointResult[]
}

export function parseCapCutEditorCatalogEndpoints(value: string | undefined): CapCutEditorCatalogEndpoint[] {
  const raw = value?.trim() ? value : "all"
  const endpoints = raw === "all" ? ["panel", "effects", "fonts", "colors"] : raw.split(",").map((item) => item.trim()).filter(Boolean)
  const allowed = new Set<CapCutEditorCatalogEndpoint>(["panel", "effects", "fonts", "colors"])
  const parsed: CapCutEditorCatalogEndpoint[] = []
  for (const endpoint of endpoints) {
    if (!allowed.has(endpoint as CapCutEditorCatalogEndpoint)) {
      throw jimengError({
        category: "validation",
        code: "CAPCUT_EDITOR_CATALOG_ENDPOINT_INVALID",
        message: `Unsupported capcut-editor-catalog endpoint: ${endpoint}`,
        retryable: false,
      })
    }
    parsed.push(endpoint as CapCutEditorCatalogEndpoint)
  }
  return Array.from(new Set(parsed))
}

export function buildCapCutEditorCatalogRequest(endpoint: CapCutEditorCatalogEndpoint, query: CapCutEditorCatalogQuery = {}): JsonObject {
  const panel = query.panel ?? DEFAULT_PANEL
  const lang = query.lang ?? query.lan ?? DEFAULT_LANG
  const region = query.region ?? query.loc?.toUpperCase() ?? DEFAULT_REGION
  const limit = query.limit ?? (endpoint === "fonts" ? 1000 : 20)
  const offset = query.offset ?? 0
  if (endpoint === "colors") return {}

  const base: JsonObject = {
    appVersion: CAPCUT_EDITOR_APP_VERSION,
    sdkVersion: CAPCUT_EDITOR_SDK_VERSION,
    enter_from: "image_editor",
    lang,
    region,
    panel,
    limit,
  }
  if (endpoint === "fonts") return base
  const request: JsonObject = {
    ...base,
    offset,
    sortingPosition: offset,
    hasCategoryEffects: endpoint === "panel",
  }
  if (endpoint === "effects") request.category = query.category ?? "all"
  return request
}

export function capCutEditorCatalogEndpointPath(endpoint: CapCutEditorCatalogEndpoint): string {
  switch (endpoint) {
    case "panel":
      return "/lv/v1/effect/get_panel_info"
    case "effects":
      return "/lv/v1/effect/get_category_effects"
    case "fonts":
      return "/lv/v1/effect/get_all_fonts"
    case "colors":
      return "/lv/v1/editor/plane/color/feed"
  }
}

export async function fetchCapCutEditorCatalog(input: {
  client?: JimengClient
  query?: CapCutEditorCatalogQuery
} = {}): Promise<CapCutEditorCatalogResult> {
  const client = input.client ?? new JimengClient()
  const endpoints = input.query?.endpoints ?? parseCapCutEditorCatalogEndpoints("all")
  const results: CapCutEditorCatalogEndpointResult[] = []

  for (const endpointId of endpoints) {
    const endpoint = capCutEditorCatalogEndpointPath(endpointId)
    const request = buildCapCutEditorCatalogRequest(endpointId, input.query)
    const response = await client.requestText(`${CAPCUT_EDITOR_HOST}${endpoint}`, {
      method: "POST",
      headers: buildCapCutSignedHeaders({
        path: endpoint,
        lan: input.query?.lan,
        loc: input.query?.loc,
      }),
      body: JSON.stringify(request),
    })
    const body = parseJsonText(response.text, `CapCut editor catalog ${endpointId}`)
    const parsed = endpointId === "colors"
      ? parseColorFeedEndpointResult({ endpointId, endpoint, httpStatus: response.status, responseText: response.text, request, body })
      : parseCatalogEndpointResult({ endpointId, endpoint, httpStatus: response.status, responseText: response.text, request, body })
    results.push(parsed)
  }

  return { endpoints, results }
}

export function summarizeCapCutEditorCatalog(result: CapCutEditorCatalogResult): JsonObject {
  return {
    endpoints: result.endpoints,
    endpoint_count: result.results.length,
    results: result.results.map((item) => ({
      endpoint_id: item.endpointId,
      endpoint: item.endpoint,
      host: item.host,
      http_status: item.httpStatus,
      ret: item.ret,
      errmsg: item.errmsg,
      response_text_sha256: item.responseTextSha256,
      request: item.request,
      status_code: item.statusCode,
      status_message: item.statusMessage,
      category_count: item.categoryCount,
      effect_count: item.effectCount,
      palette_count: item.paletteCount,
      has_more: item.hasMore,
      cursor: item.cursor,
      sorting_position: item.sortingPosition,
      category_key: item.categoryKey,
      categories: item.categories.map((category) => ({
        id: category.id,
        key: category.key,
        name: category.name,
        tag_count: category.tagCount,
        child_category_count: category.childCategoryCount,
      })),
      effects: item.effects.map((effect) => ({
        resource_id: effect.resourceId,
        item_id: effect.itemId,
        effect_id: effect.effectId,
        name: effect.name,
        panel: effect.panel,
        sdk_version: effect.sdkVersion,
        file_uri: effect.fileUri,
        file_url_present: effect.fileUrlPresent,
        icon_uri: effect.iconUri,
        icon_url_present: effect.iconUrlPresent,
        tag_count: effect.tagCount,
        is_business: effect.isBusiness,
      })),
      palettes: item.palettes.map((palette) => ({
        color_count: palette.colorCount,
        colors: palette.colors,
      })),
    })),
  }
}

function parseCatalogEndpointResult(input: {
  endpointId: CapCutEditorCatalogEndpoint
  endpoint: string
  httpStatus: number
  responseText: string
  request: JsonObject
  body: JsonValue
}): CapCutEditorCatalogEndpointResult {
  const parsed = parseJimengContract(LvEditorCatalogBodyWireSchema, input.body, `CapCut editor catalog ${input.endpointId}`)
  const statusCode = parsed.BaseResp.StatusCode ?? null
  const statusMessage = parsed.BaseResp.StatusMessage ?? null
  if (statusCode !== null && statusCode !== 0) {
    throw jimengError({
      category: "upstream",
      code: "CAPCUT_EDITOR_CATALOG_STATUS_ERROR",
      message: `CapCut editor catalog ${input.endpointId} returned StatusCode ${statusCode}: ${statusMessage ?? "unknown"}`,
      retryable: false,
      details: { endpoint: input.endpoint, status_code: statusCode, status_message: statusMessage },
    })
  }
  const effects = parsed.data.CategoryEffects
  return {
    endpointId: input.endpointId,
    endpoint: input.endpoint,
    host: CAPCUT_EDITOR_HOST,
    httpStatus: input.httpStatus,
    ret: null,
    errmsg: null,
    responseTextSha256: sha256(input.responseText),
    request: input.request,
    statusCode,
    statusMessage,
    categoryCount: parsed.data.CategoryList?.length ?? 0,
    effectCount: effects.Effects.length,
    paletteCount: 0,
    hasMore: effects.HasMore ?? null,
    cursor: effects.Cursor ?? null,
    sortingPosition: effects.SortingPosition ?? null,
    categoryKey: effects.CategoryKey ?? null,
    categories: (parsed.data.CategoryList ?? []).map(normalizeCategory),
    effects: effects.Effects.map(normalizeEffect),
    palettes: [],
    body: input.body,
  }
}

function parseColorFeedEndpointResult(input: {
  endpointId: CapCutEditorCatalogEndpoint
  endpoint: string
  httpStatus: number
  responseText: string
  request: JsonObject
  body: JsonValue
}): CapCutEditorCatalogEndpointResult {
  const parsed = parseJimengContract(LvColorFeedBodyWireSchema, input.body, "CapCut editor color feed")
  const envelope = parseJimengApiEnvelope(input.body, "CapCut editor color feed")
  if (String(envelope.ret ?? parsed.ret) !== "0") {
    throw jimengError({
      category: "upstream",
      code: "CAPCUT_EDITOR_COLOR_FEED_ERROR",
      message: `CapCut editor color feed returned ret=${String(envelope.ret ?? parsed.ret)}`,
      retryable: false,
      details: { endpoint: input.endpoint, ret: envelope.ret ?? parsed.ret, errmsg: envelope.errmsg ?? parsed.errmsg },
    })
  }
  const palettes = parsed.data.palettes.map((palette) => ({
    colorCount: palette.length,
    colors: palette.map(formatColor),
  }))
  return {
    endpointId: input.endpointId,
    endpoint: input.endpoint,
    host: CAPCUT_EDITOR_HOST,
    httpStatus: input.httpStatus,
    ret: envelope.ret ?? parsed.ret ?? null,
    errmsg: envelope.errmsg ?? parsed.errmsg ?? null,
    responseTextSha256: sha256(input.responseText),
    request: input.request,
    statusCode: null,
    statusMessage: null,
    categoryCount: 0,
    effectCount: 0,
    paletteCount: palettes.length,
    hasMore: null,
    cursor: null,
    sortingPosition: null,
    categoryKey: null,
    categories: [],
    effects: [],
    palettes,
    body: input.body,
  }
}

function normalizeCategory(category: z.infer<typeof LvEditorCategoryWireSchema>): CapCutEditorCatalogCategory {
  return {
    id: stringifyId(category.Id) ?? "",
    key: category.Key ?? null,
    name: category.Name ?? null,
    tagCount: category.Tags?.length ?? 0,
    childCategoryCount: category.ChildrenCategories?.length ?? 0,
  }
}

function normalizeEffect(effect: z.infer<typeof LvEditorEffectWireSchema>): CapCutEditorCatalogEffect {
  return {
    resourceId: stringifyId(effect.ResourceId) ?? null,
    itemId: stringifyId(effect.Id) ?? null,
    effectId: stringifyId(effect.EffectId) ?? null,
    name: effect.Name ?? null,
    panel: effect.Panel ?? null,
    sdkVersion: effect.SdkVersion ?? null,
    fileUri: effect.FileUrl?.Uri ?? null,
    fileUrlPresent: Boolean(effect.FileUrl?.UrlList?.length),
    iconUri: effect.IconUrl?.Uri ?? null,
    iconUrlPresent: Boolean(effect.IconUrl?.UrlList?.length),
    tagCount: effect.Tags?.length ?? 0,
    isBusiness: effect.IsBusiness ?? null,
  }
}

function stringifyId(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return String(value)
}

function formatColor(value: number[]): string {
  const [red = 0, green = 0, blue = 0, alpha = 1] = value
  return `rgba(${red},${green},${blue},${alpha})`
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
