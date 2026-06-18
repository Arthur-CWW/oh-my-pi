import { createHash } from "node:crypto"
import { Schema } from "effect"
import { z } from "zod"
import { type JimengSessionBundle } from "./capture"
import { JimengClient, type JimengFetch } from "./client"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { JimengJsonValueSchema, parseJsonText } from "./schema"

const CAPCUT_TEMPLATE_HOST = "https://edit-api-sg.capcut.com"
const CAPCUT_FEED_API_HOST = "https://feed-api-sg.capcut.com"
const CAPCUT_TEMPLATE_MERCURY_BASE = "https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod"
const CAPCUT_TEMPLATE_RATIO_CATALOG_URL = `${CAPCUT_TEMPLATE_MERCURY_BASE}/biz_49/bee_prod_49_bee_publish_709.json`
const CAPCUT_TEMPLATE_SCENE_CATALOG_URL = `${CAPCUT_TEMPLATE_MERCURY_BASE}/biz_149/bee_prod_149_bee_publish_835.json`
const CAPCUT_TEMPLATE_SDK_VERSION = "16.1.0"
const CAPCUT_TEMPLATE_APP_VERSION = "5.8.0"
const CAPCUT_TEMPLATE_PF = "7"
const CAPCUT_TEMPLATE_APP_SDK_VERSION = "999.999.999"
const CAPCUT_TEMPLATE_SIGN_SECRET_PREFIX = "9e2c"
const CAPCUT_TEMPLATE_SIGN_SECRET_SUFFIX = "11ac"
const CAPCUT_TEMPLATE_COLLECTIONS_ENDPOINT = "/lv/v1/cc_web/plane/get_collections"
const CAPCUT_TEMPLATE_COLLECTION_TEMPLATES_ENDPOINT = "/lv/v1/cc_web/plane/get_collection_templates"
const CAPCUT_TEMPLATE_DETAIL_ENDPOINT = "/lv/v1/cc_web/plane/get_template_detail"
const CAPCUT_FEED_API_ENDPOINT_RE = /^\/lv\/v2\/(?:cc_web_task|task)\//
const CAPCUT_MUTATING_PROBE_ENDPOINTS = new Set([
  "/lv/v1/cc_web/plane/del_presets_template",
])
const CAPCUT_SIGNED_READ_PROBE_ENDPOINTS = new Set([
  "/lv/v1/editor/draft/get_template_file",
  "/lv/v1/editor/draft/get_version_list",
  "/lv/v1/editor/effect/recent_list",
  "/lv/v1/editor/plane/common/recent_list",
  "/lv/v1/editor/plane/color/feed",
  "/lv/v1/editor/plane/intelligence/query_recommend_template",
  "/lv/v1/editor/plane_draft/get_draft_detail",
  "/lv/v1/editor/plane_draft/get_content_map",
  "/lv/v1/editor/template/check_post_permission",
  "/lv/v1/editor/template/recent_list",
  "/lv/v1/effect/get_all_fonts",
  "/lv/v1/effect/get_category_effects",
  "/lv/v1/effect/get_panel_info",
  "/lv/v1/ever_photo/batch_get_sync_state",
  "/lv/v1/ever_photo/get_user_space",
  "/lv/v1/intelligence/preset_resource_list",
  "/lv/v2/cc_web_task/get_task_draft",
  "/lv/v2/editor/effect/recent_list",
  "/lv/v2/task/multi_get_tasks",
])

export interface CapCutTemplateCategory {
  categoryId: number
  starlingKey: string | null
  displayName: string | null
}

export interface CapCutTemplateCategoriesQuery {
  lan?: string
  loc?: string
}

export interface CapCutTemplateCollectionsQuery {
  categoryType?: string | number
  scale?: number
  canvasWidth?: number
  canvasHeight?: number
  lan?: string
  loc?: string
}

export interface CapCutTemplateCollection {
  id: number
  displayName: string | null
  rootCategory: string | null
  starlingKey: string | null
  resourceLen: number | null
  categoryType: number | null
  direction: number | null
  isEcomCategory: boolean | null
  capsuleCount: number
}

export interface CapCutTemplateCollectionsResult {
  endpoint: typeof CAPCUT_TEMPLATE_COLLECTIONS_ENDPOINT
  host: string
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  logId: string | null
  responseTextSha256: string
  request: Record<string, unknown>
  collections: CapCutTemplateCollection[]
  templateSource: string | null
  body: unknown
}

export interface CapCutCollectionTemplatesQuery {
  collectionId: number
  count?: number
  cursor?: number
  lang?: string
  lan?: string
  loc?: string
}

export interface CapCutCollectionTemplateItem {
  id: string
  numericId: string | null
  title: string | null
  shortTitle: string | null
  itemType: number | null
  status: number | null
  coverUrlPresent: boolean
  coverSize: { width: number; height: number } | null
  optimizedCoverUrlKeys: string[]
  categoryIds: number[]
  author: {
    uid: string | null
    name: string | null
    role: number | null
  }
  featureCount: number
  templateVersion: string | null
  tags: string[]
  sceneIds: number[]
  canvasSize: { width: number; height: number } | null
  isMultiLang: boolean | null
  textThemeCoverCount: number
  textThemeEffectCount: number
}

export type CapCutTemplateMiningEndpoint =
  | "/lv/v1/cc_web/replicate/search_templates"
  | "/lv/v1/cc_web/plane/fuzzy_search_templates"
  | "/lv/v1/cc_web/plane/batch_get_collection_templates"

export interface CapCutTemplateMiningParseResult {
  endpoint: CapCutTemplateMiningEndpoint | null
  ret: string | number | null
  errmsg: string | null
  blockedReason: string | null
  cursor: number | null
  hasMore: boolean | null
  templateSource: string | null
  templateRowsPath: "data.item_list" | "data.template_list" | "data.templates" | null
  dataKeys: string[]
  templates: CapCutCollectionTemplateItem[]
}

export interface CapCutCollectionTemplatesResult {
  endpoint: typeof CAPCUT_TEMPLATE_COLLECTION_TEMPLATES_ENDPOINT
  host: string
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  logId: string | null
  responseTextSha256: string
  request: Record<string, unknown>
  collectionId: number
  cursor: number | null
  hasMore: boolean | null
  templateSource: string | null
  templates: CapCutCollectionTemplateItem[]
  body: unknown
}

export interface CapCutTemplateDetailQuery {
  templateId: string
  needDraft?: boolean
  lang?: string
  region?: string
  lan?: string
  loc?: string
}

export interface CapCutTemplateDetail {
  templateId: string
  templateUrlPresent: boolean
  templateDataPresent: boolean
  draftDataPresent: boolean
  templateVersion: string | null
  materialCounts: Record<string, number>
  creatorSubmitType: number | null
  extraKeys: string[]
  multiLangKeys: string[]
  textThemeCoverCount: number
  textThemeEffectCount: number
  themeDataPresent: boolean
}

export interface CapCutTemplateDetailResult {
  endpoint: typeof CAPCUT_TEMPLATE_DETAIL_ENDPOINT
  host: string
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  logId: string | null
  responseTextSha256: string
  request: Record<string, unknown>
  detail: CapCutTemplateDetail
  body: unknown
}

export interface CapCutTemplateCategoriesResult {
  endpoint: "/lv/v1/cc_web/plane/get_categories"
  host: string
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  logId: string | null
  responseTextSha256: string
  request: Record<string, unknown>
  categories: CapCutTemplateCategory[]
  body: unknown
}

export interface CapCutTemplateRatio {
  serverScaleType: number
  size: {
    width: number
    height: number
  }
  range: {
    min: number | null
    max: number | null
  }
  aspectRatio: number | null
}

export interface CapCutTemplateScene {
  id: number
  sceneId: string
  name: string | null
  sizeUnit: string | null
  size: {
    width: number
    height: number
  } | null
  display: boolean | null
  index: number | null
  searchTemplateVisible: boolean | null
  publishTemplateVisible: boolean | null
  iconUrl: string | null
}

export interface CapCutTemplateStaticCatalogResult {
  ratioCatalogUrl: string
  sceneCatalogUrl: string
  ratiosHttpStatus: number
  scenesHttpStatus: number
  ratiosResponseTextSha256: string
  scenesResponseTextSha256: string
  ratios: CapCutTemplateRatio[]
  scenes: CapCutTemplateScene[]
  ratiosBody: unknown
  scenesBody: unknown
}

export interface CapCutEndpointProbeVariant {
  name: string
  body: JsonValue
}

export interface CapCutEndpointProbeInput {
  endpoint: string
  method?: "GET" | "POST"
  variants: CapCutEndpointProbeVariant[]
  lan?: string
  loc?: string
  userAgent?: string | null
}

export interface CapCutEndpointProbeVariantResult {
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

export interface CapCutEndpointProbeResult {
  endpoint: string
  url: string
  method: "GET" | "POST"
  results: CapCutEndpointProbeVariantResult[]
}

export interface CapCutSignedHeaderOptions {
  path: string
  nowSec?: number
  lan?: string
  loc?: string
  userAgent?: string | null
}

export function buildCapCutTemplateCategoriesRequest(): Record<string, unknown> {
  return { sdk_version: CAPCUT_TEMPLATE_SDK_VERSION }
}

export function buildCapCutTemplateCollectionsRequest(query: CapCutTemplateCollectionsQuery = {}): Record<string, unknown> {
  return omitUndefined({
    sdk_version: CAPCUT_TEMPLATE_SDK_VERSION,
    category_type: query.categoryType,
    scale: query.scale,
    canvas_width: query.canvasWidth,
    canvas_height: query.canvasHeight,
  })
}

export function buildCapCutCollectionTemplatesRequest(query: CapCutCollectionTemplatesQuery): Record<string, unknown> {
  return omitUndefined({
    sdk_version: CAPCUT_TEMPLATE_SDK_VERSION,
    enter_from: "feed",
    count: query.count ?? 20,
    lang: query.lang ?? query.lan ?? "en",
    id: query.collectionId,
    cursor: query.cursor,
  })
}

export function buildCapCutTemplateDetailRequest(query: CapCutTemplateDetailQuery): Record<string, unknown> {
  return omitUndefined({
    sdk_version: CAPCUT_TEMPLATE_SDK_VERSION,
    enter_from: "feed",
    app_version: CAPCUT_TEMPLATE_APP_VERSION,
    lang: query.lang ?? query.lan ?? "en",
    region: query.region ?? query.loc ?? "us",
    template_id: query.templateId,
    need_draft: query.needDraft ?? false,
  })
}

export function capCutTemplateStaticCatalogUrls(): { ratioCatalogUrl: string; sceneCatalogUrl: string } {
  return {
    ratioCatalogUrl: CAPCUT_TEMPLATE_RATIO_CATALOG_URL,
    sceneCatalogUrl: CAPCUT_TEMPLATE_SCENE_CATALOG_URL,
  }
}

export function parseCapCutEndpointProbeVariants(text: string): CapCutEndpointProbeVariant[] {
  const parsed = parseJsonText(text, "CapCut endpoint probe variants")
  const root = asJsonRecord(parsed)
  const source = asJsonArray(parsed) ?? asJsonArray(root?.variants)
  if (!source || source.length === 0) {
    throw jimengError({
      category: "validation",
      code: "CAPCUT_ENDPOINT_PROBE_VARIANTS_INVALID",
      message: "CapCut endpoint probe variants must be a JSON array or an object with a variants array.",
      retryable: false,
    })
  }

  return source.map((value, index) => {
    const record = asJsonRecord(value)
    if (!record) {
      throw jimengError({
        category: "validation",
        code: "CAPCUT_ENDPOINT_PROBE_VARIANT_INVALID",
        message: "Each CapCut endpoint probe variant must be an object.",
        retryable: false,
        details: { index },
      })
    }
    const name = stringValue(record.name) ?? `variant-${index + 1}`
    if (!/^[0-9A-Za-z_.-]+$/.test(name)) {
      throw jimengError({
        category: "validation",
        code: "CAPCUT_ENDPOINT_PROBE_VARIANT_NAME_INVALID",
        message: "CapCut endpoint probe variant names may contain only letters, numbers, dot, dash, or underscore.",
        retryable: false,
        details: { name },
      })
    }
    return { name, body: JimengJsonValueSchema.parse(record.body ?? {}) }
  })
}

export function buildSingleCapCutEndpointProbeVariant(text: string): CapCutEndpointProbeVariant[] {
  return [{ name: "body", body: parseJsonText(text, "CapCut endpoint probe body") }]
}

export function buildCapCutSignedHeaders(options: CapCutSignedHeaderOptions): Record<string, string> {
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000)
  const signInput = [
    CAPCUT_TEMPLATE_SIGN_SECRET_PREFIX,
    options.path.slice(-7),
    CAPCUT_TEMPLATE_PF,
    CAPCUT_TEMPLATE_APP_VERSION,
    String(nowSec),
    "",
    CAPCUT_TEMPLATE_SIGN_SECRET_SUFFIX,
  ].join("|")

  return {
    "content-type": "application/json",
    accept: "application/json, text/plain, */*",
    "user-agent": options.userAgent ?? "Mozilla/5.0",
    origin: "https://www.capcut.com",
    referer: "https://www.capcut.com/",
    lan: options.lan ?? "en",
    loc: options.loc ?? "us",
    "app-sdk-version": CAPCUT_TEMPLATE_APP_SDK_VERSION,
    sign: createHash("md5").update(signInput).digest("hex").toLowerCase(),
    "device-time": String(nowSec),
    "sign-ver": "1",
    pf: CAPCUT_TEMPLATE_PF,
    appvr: CAPCUT_TEMPLATE_APP_VERSION,
  }
}

export async function fetchCapCutTemplateCategories(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session?: Pick<JimengSessionBundle, "userAgent">
  query?: CapCutTemplateCategoriesQuery
} = {}): Promise<CapCutTemplateCategoriesResult> {
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const endpoint = "/lv/v1/cc_web/plane/get_categories"
  const request = buildCapCutTemplateCategoriesRequest()
  const response = await client.requestText(`${CAPCUT_TEMPLATE_HOST}${endpoint}`, {
    method: "POST",
    headers: buildCapCutSignedHeaders({
      path: endpoint,
      lan: input.query?.lan,
      loc: input.query?.loc,
      userAgent: input.session?.userAgent,
    }),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertCapCutSuccess(body, "CapCut template categories")

  return {
    endpoint,
    host: CAPCUT_TEMPLATE_HOST,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    logId: stringValue(asRecord(body)?.log_id),
    responseTextSha256: sha256(response.text),
    request,
    categories: parseCapCutTemplateCategoriesBody(body),
    body,
  }
}

export async function fetchCapCutTemplateCollections(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session?: Pick<JimengSessionBundle, "userAgent">
  query?: CapCutTemplateCollectionsQuery
} = {}): Promise<CapCutTemplateCollectionsResult> {
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const endpoint = CAPCUT_TEMPLATE_COLLECTIONS_ENDPOINT
  const request = buildCapCutTemplateCollectionsRequest(input.query)
  const response = await client.requestText(`${CAPCUT_TEMPLATE_HOST}${endpoint}`, {
    method: "POST",
    headers: buildCapCutSignedHeaders({
      path: endpoint,
      lan: input.query?.lan,
      loc: input.query?.loc,
      userAgent: input.session?.userAgent,
    }),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertCapCutSuccess(body, "CapCut template collections")
  const parsed = parseCapCutTemplateCollectionsBody(body)

  return {
    endpoint,
    host: CAPCUT_TEMPLATE_HOST,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    logId: stringValue(asRecord(body)?.log_id),
    responseTextSha256: sha256(response.text),
    request,
    collections: parsed.collections,
    templateSource: parsed.templateSource,
    body,
  }
}

export async function fetchCapCutCollectionTemplates(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session?: Pick<JimengSessionBundle, "userAgent">
  query: CapCutCollectionTemplatesQuery
}): Promise<CapCutCollectionTemplatesResult> {
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const endpoint = CAPCUT_TEMPLATE_COLLECTION_TEMPLATES_ENDPOINT
  const request = buildCapCutCollectionTemplatesRequest(input.query)
  const response = await client.requestText(`${CAPCUT_TEMPLATE_HOST}${endpoint}`, {
    method: "POST",
    headers: buildCapCutSignedHeaders({
      path: endpoint,
      lan: input.query.lan,
      loc: input.query.loc,
      userAgent: input.session?.userAgent,
    }),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertCapCutSuccess(body, "CapCut collection templates")
  const parsed = parseCapCutCollectionTemplatesBody(body)

  return {
    endpoint,
    host: CAPCUT_TEMPLATE_HOST,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    logId: stringValue(asRecord(body)?.log_id),
    responseTextSha256: sha256(response.text),
    request,
    collectionId: input.query.collectionId,
    cursor: parsed.cursor,
    hasMore: parsed.hasMore,
    templateSource: parsed.templateSource,
    templates: parsed.templates,
    body,
  }
}

export async function fetchCapCutTemplateDetail(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session?: Pick<JimengSessionBundle, "userAgent">
  query: CapCutTemplateDetailQuery
}): Promise<CapCutTemplateDetailResult> {
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const endpoint = CAPCUT_TEMPLATE_DETAIL_ENDPOINT
  const request = buildCapCutTemplateDetailRequest(input.query)
  const response = await client.requestText(`${CAPCUT_TEMPLATE_HOST}${endpoint}`, {
    method: "POST",
    headers: buildCapCutSignedHeaders({
      path: endpoint,
      lan: input.query.lan,
      loc: input.query.loc,
      userAgent: input.session?.userAgent,
    }),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertCapCutSuccess(body, "CapCut template detail")

  return {
    endpoint,
    host: CAPCUT_TEMPLATE_HOST,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    logId: stringValue(asRecord(body)?.log_id),
    responseTextSha256: sha256(response.text),
    request,
    detail: parseCapCutTemplateDetailBody(body),
    body,
  }
}

export async function fetchCapCutTemplateStaticCatalog(input: {
  client?: JimengClient
  fetch?: JimengFetch
  userAgent?: string | null
} = {}): Promise<CapCutTemplateStaticCatalogResult> {
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const headers = {
    accept: "application/json, text/plain, */*",
    "user-agent": input.userAgent ?? "Mozilla/5.0",
  }
  const ratiosResponse = await client.requestText(CAPCUT_TEMPLATE_RATIO_CATALOG_URL, { method: "GET", headers })
  const scenesResponse = await client.requestText(CAPCUT_TEMPLATE_SCENE_CATALOG_URL, { method: "GET", headers })
  const ratiosBody = safeJson(ratiosResponse.text)
  const scenesBody = safeJson(scenesResponse.text)
  assertHttpSuccess(ratiosResponse.status, ratiosBody, "CapCut template ratio catalog")
  assertHttpSuccess(scenesResponse.status, scenesBody, "CapCut template scene catalog")

  return {
    ratioCatalogUrl: CAPCUT_TEMPLATE_RATIO_CATALOG_URL,
    sceneCatalogUrl: CAPCUT_TEMPLATE_SCENE_CATALOG_URL,
    ratiosHttpStatus: ratiosResponse.status,
    scenesHttpStatus: scenesResponse.status,
    ratiosResponseTextSha256: sha256(ratiosResponse.text),
    scenesResponseTextSha256: sha256(scenesResponse.text),
    ratios: parseCapCutTemplateRatioCatalogBody(ratiosBody),
    scenes: parseCapCutTemplateSceneCatalogBody(scenesBody),
    ratiosBody,
    scenesBody,
  }
}

export async function runCapCutEndpointProbe(input: {
  client?: JimengClient
  fetch?: JimengFetch
  probe: CapCutEndpointProbeInput
}): Promise<CapCutEndpointProbeResult> {
  const endpoint = normalizeCapCutProbeEndpoint(input.probe.endpoint)
  const method = input.probe.method ?? "POST"
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const url = `${capCutProbeHostForEndpoint(endpoint)}${endpoint}`
  const results: CapCutEndpointProbeVariantResult[] = []

  for (const variant of input.probe.variants) {
    const response = await client.requestText(url, {
      method,
      headers: buildCapCutSignedHeaders({
        path: endpoint,
        lan: input.probe.lan,
        loc: input.probe.loc,
        userAgent: input.probe.userAgent,
      }),
      body: method === "GET" ? undefined : JSON.stringify(variant.body),
    })
    const body = parseJsonText(response.text, `CapCut endpoint probe ${variant.name}`)
    const envelope = parseCapCutEnvelope(body)
    results.push({
      name: variant.name,
      requestBody: variant.body,
      httpStatus: response.status,
      ret: envelope.ret,
      errmsg: envelope.errmsg,
      responseTextSha256: sha256(response.text),
      responseTextHasUrlLikeTokens: URL_LIKE_RE.test(response.text),
      topLevelKeys: Object.keys(asJsonRecord(body) ?? {}).sort(),
      body,
    })
  }

  return { endpoint, url, method, results }
}

function capCutProbeHostForEndpoint(endpoint: string): string {
  if (CAPCUT_FEED_API_ENDPOINT_RE.test(endpoint)) {
    return CAPCUT_FEED_API_HOST
  }
  return CAPCUT_TEMPLATE_HOST
}

export function parseCapCutTemplateCategoriesBody(body: unknown): CapCutTemplateCategory[] {
  return asArray(asRecord(body)?.data)
    .map((value) => {
      const record = asRecord(value)
      const categoryId = numberValue(record?.category_id)
      if (!record || categoryId === null) return null
      return {
        categoryId,
        starlingKey: stringValue(record.starling_key),
        displayName: stringValue(record.default_display_name),
      }
    })
    .filter((category): category is CapCutTemplateCategory => !!category)
}

export function parseCapCutTemplateCollectionsBody(body: unknown): { collections: CapCutTemplateCollection[]; templateSource: string | null } {
  const envelope = parseCapCutEnvelopeBody(body, "CapCut template collections")
  const data = CapCutCollectionsDataSchema.parse(envelope.data)
  return {
    templateSource: stringValue(data.template_source),
    collections: data.collections.map((collection) => ({
      id: collection.id,
      displayName: stringValue(collection.display_name),
      rootCategory: stringValue(collection.root_category),
      starlingKey: stringValue(collection.starling_key),
      resourceLen: numberValue(collection.resource_len),
      categoryType: numberValue(collection.category_type),
      direction: numberValue(collection.direction),
      isEcomCategory: booleanValue(collection.is_ecom_category),
      capsuleCount: asArray(collection.capsules).length,
    })),
  }
}

export function parseCapCutCollectionTemplatesBody(body: unknown): {
  cursor: number | null
  hasMore: boolean | null
  templateSource: string | null
  templates: CapCutCollectionTemplateItem[]
} {
  const envelope = parseCapCutEnvelopeBody(body, "CapCut collection templates")
  const data = CapCutCollectionTemplatesDataSchema.parse(envelope.data)
  return {
    cursor: numberValue(data.new_cursor),
    hasMore: booleanValue(data.has_more),
    templateSource: stringValue(data.template_source),
    templates: data.item_list.map(parseCapCutCollectionTemplateItem),
  }
}

export function parseCapCutTemplateMiningBody(body: unknown, endpoint: CapCutTemplateMiningEndpoint | null = null): CapCutTemplateMiningParseResult {
  const envelope = decodeCapCutMiningContract(CapCutTemplateMiningEnvelopeWireSchema, body, "CapCut template mining")
  const data = envelope.data ?? null
  const rows = data ? pickCapCutTemplateMiningRows(data) : { path: null, items: [] }
  const ret = envelope.ret ?? null
  const errmsg = envelope.errmsg ?? null
  return {
    endpoint,
    ret,
    errmsg,
    blockedReason: capCutTemplateMiningBlockedReason(ret, errmsg),
    cursor: data ? numberValue(data.new_cursor ?? data.cursor) : null,
    hasMore: data ? booleanValue(data.has_more) : null,
    templateSource: data ? stringValue(data.template_source) : null,
    templateRowsPath: rows.path,
    dataKeys: data ? Object.keys(data).sort() : [],
    templates: rows.items.map(parseCapCutCollectionTemplateItem),
  }
}


export function parseCapCutTemplateDetailBody(body: unknown): CapCutTemplateDetail {
  const envelope = parseCapCutEnvelopeBody(body, "CapCut template detail")
  const data = CapCutTemplateDetailDataSchema.parse(envelope.data)
  const mainVersion = stringOrNumber(data.main_version)
  const featureVersion = stringOrNumber(data.feature_version)
  const reviseVersion = stringOrNumber(data.revise_version)
  const materials = asRecord(data.materials)
  return {
    templateId: String(data.template_id),
    templateUrlPresent: !!stringValue(data.template_url),
    templateDataPresent: !!stringValue(data.template_data),
    draftDataPresent: !!stringValue(data.draft_data),
    templateVersion: [mainVersion, featureVersion, reviseVersion].every((value) => value !== null)
      ? `${mainVersion}.${featureVersion}.${reviseVersion}`
      : null,
    materialCounts: materials ? countMaterialCollections(materials) : {},
    creatorSubmitType: numberValue(asRecord(data.creator_info)?.submit_type),
    extraKeys: Object.keys(asRecord(data.extra_v2) ?? {}).sort(),
    multiLangKeys: Object.keys(asRecord(data.multi_langs) ?? {}).sort(),
    textThemeCoverCount: asArray(data.text_theme_covers).length,
    textThemeEffectCount: asArray(data.text_theme_effects).length,
    themeDataPresent: !!stringValue(data.theme_data),
  }
}

export function parseCapCutTemplateRatioCatalogBody(body: unknown): CapCutTemplateRatio[] {
  return asArray(body)
    .map((value) => {
      const record = asRecord(value)
      const serverScaleType = numberValue(record?.serverScaleType)
      const size = asArray(record?.size)
      const width = numberValue(size[0])
      const height = numberValue(size[1])
      if (!record || serverScaleType === null || width === null || height === null) return null
      const range = asRecord(record.range)
      return {
        serverScaleType,
        size: { width, height },
        range: {
          min: numberValue(range?.min),
          max: numberValue(range?.max),
        },
        aspectRatio: height === 0 ? null : roundRatio(width / height),
      }
    })
    .filter((ratio): ratio is CapCutTemplateRatio => !!ratio)
}

export function parseCapCutTemplateSceneCatalogBody(body: unknown): CapCutTemplateScene[] {
  return asArray(asRecord(body)?.data)
    .map((value) => {
      const record = asRecord(value)
      const id = numberValue(record?.id)
      const sceneId = stringValue(record?.sceneId)
      if (!record || id === null || sceneId === null) return null
      const size = asRecord(record.size)
      const width = numberValue(size?.width)
      const height = numberValue(size?.height)
      return {
        id,
        sceneId,
        name: stringValue(record.name),
        sizeUnit: stringValue(record.sizeUnit),
        size: width === null || height === null ? null : { width, height },
        display: booleanValue(record.display),
        index: numberValue(record.index),
        searchTemplateVisible: booleanValue(record.searchTemplateVIsible),
        publishTemplateVisible: booleanValue(record.publishTemplateVIsible),
        iconUrl: stringValue(record.icon),
      }
    })
    .filter((scene): scene is CapCutTemplateScene => !!scene)
}

export function summarizeCapCutTemplateCategories(result: Pick<CapCutTemplateCategoriesResult, "categories" | "logId" | "responseTextSha256">): Record<string, unknown> {
  return {
    category_count: result.categories.length,
    log_id: result.logId,
    response_text_sha256: result.responseTextSha256,
    categories: result.categories.map((category) => ({
      category_id: category.categoryId,
      starling_key: category.starlingKey,
      display_name: category.displayName,
    })),
  }
}

export function summarizeCapCutTemplateCollections(result: Pick<
  CapCutTemplateCollectionsResult,
  "collections" | "logId" | "responseTextSha256" | "request" | "templateSource"
>): Record<string, unknown> {
  return {
    collection_count: result.collections.length,
    log_id: result.logId,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    template_source: result.templateSource,
    collections: result.collections.map((collection) => ({
      id: collection.id,
      display_name: collection.displayName,
      root_category: collection.rootCategory,
      starling_key: collection.starlingKey,
      resource_len: collection.resourceLen,
      category_type: collection.categoryType,
      direction: collection.direction,
      is_ecom_category: collection.isEcomCategory,
      capsule_count: collection.capsuleCount,
    })),
  }
}

export function summarizeCapCutCollectionTemplates(result: Pick<
  CapCutCollectionTemplatesResult,
  "collectionId" | "cursor" | "hasMore" | "templateSource" | "templates" | "logId" | "responseTextSha256" | "request"
>): Record<string, unknown> {
  return {
    collection_id: result.collectionId,
    template_count: result.templates.length,
    cursor: result.cursor,
    has_more: result.hasMore,
    template_source: result.templateSource,
    log_id: result.logId,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    templates: result.templates.map((template) => ({
      id: template.id,
      numeric_id: template.numericId,
      title: template.title,
      short_title: template.shortTitle,
      item_type: template.itemType,
      status: template.status,
      cover_url_present: template.coverUrlPresent,
      cover_size: template.coverSize,
      optimized_cover_url_keys: template.optimizedCoverUrlKeys,
      category_ids: template.categoryIds,
      author: template.author,
      feature_count: template.featureCount,
      template_version: template.templateVersion,
      tags: template.tags,
      scene_ids: template.sceneIds,
      canvas_size: template.canvasSize,
      is_multi_lang: template.isMultiLang,
      text_theme_cover_count: template.textThemeCoverCount,
      text_theme_effect_count: template.textThemeEffectCount,
    })),
  }
}

export function summarizeCapCutTemplateMining(result: Pick<
  CapCutTemplateMiningParseResult,
  "endpoint" | "ret" | "errmsg" | "blockedReason" | "cursor" | "hasMore" | "templateSource" | "templateRowsPath" | "dataKeys" | "templates"
>): Record<string, unknown> {
  return {
    endpoint: result.endpoint,
    status: result.blockedReason ? "blocked" : "ok",
    ret: result.ret,
    errmsg: result.errmsg,
    blocked_reason: result.blockedReason,
    cursor: result.cursor,
    has_more: result.hasMore,
    template_source: result.templateSource,
    template_rows_path: result.templateRowsPath,
    data_keys: result.dataKeys,
    template_count: result.templates.length,
    templates: result.templates.map((template) => ({
      id: template.id,
      numeric_id: template.numericId,
      title: template.title,
      short_title: template.shortTitle,
      item_type: template.itemType,
      status: template.status,
      cover_url_present: template.coverUrlPresent,
      cover_size: template.coverSize,
      optimized_cover_url_keys: template.optimizedCoverUrlKeys,
      category_ids: template.categoryIds,
      author: template.author,
      feature_count: template.featureCount,
      template_version: template.templateVersion,
      tags: template.tags,
      scene_ids: template.sceneIds,
      canvas_size: template.canvasSize,
      is_multi_lang: template.isMultiLang,
      text_theme_cover_count: template.textThemeCoverCount,
      text_theme_effect_count: template.textThemeEffectCount,
    })),
  }
}


export function summarizeCapCutTemplateDetail(result: Pick<
  CapCutTemplateDetailResult,
  "detail" | "logId" | "responseTextSha256" | "request"
>): Record<string, unknown> {
  return {
    log_id: result.logId,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    detail: {
      template_id: result.detail.templateId,
      template_url_present: result.detail.templateUrlPresent,
      template_data_present: result.detail.templateDataPresent,
      draft_data_present: result.detail.draftDataPresent,
      template_version: result.detail.templateVersion,
      material_counts: result.detail.materialCounts,
      creator_submit_type: result.detail.creatorSubmitType,
      extra_keys: result.detail.extraKeys,
      multi_lang_keys: result.detail.multiLangKeys,
      text_theme_cover_count: result.detail.textThemeCoverCount,
      text_theme_effect_count: result.detail.textThemeEffectCount,
      theme_data_present: result.detail.themeDataPresent,
    },
  }
}

export function summarizeCapCutTemplateStaticCatalog(result: Pick<
  CapCutTemplateStaticCatalogResult,
  "ratioCatalogUrl" | "sceneCatalogUrl" | "ratiosResponseTextSha256" | "scenesResponseTextSha256" | "ratios" | "scenes"
>): Record<string, unknown> {
  return {
    ratio_catalog_url: result.ratioCatalogUrl,
    scene_catalog_url: result.sceneCatalogUrl,
    ratio_count: result.ratios.length,
    scene_count: result.scenes.length,
    ratios_response_text_sha256: result.ratiosResponseTextSha256,
    scenes_response_text_sha256: result.scenesResponseTextSha256,
    ratios: result.ratios.map((ratio) => ({
      server_scale_type: ratio.serverScaleType,
      size: ratio.size,
      aspect_ratio: ratio.aspectRatio,
      range: ratio.range,
    })),
    scenes: result.scenes.map((scene) => ({
      id: scene.id,
      scene_id: scene.sceneId,
      name: scene.name,
      size_unit: scene.sizeUnit,
      size: scene.size,
      display: scene.display,
      index: scene.index,
      search_template_visible: scene.searchTemplateVisible,
      publish_template_visible: scene.publishTemplateVisible,
      icon_url_present: !!scene.iconUrl,
    })),
  }
}

export function summarizeCapCutEndpointProbe(result: CapCutEndpointProbeResult): JsonObject {
  const url = new URL(result.url)
  return {
    endpoint: result.endpoint,
    url_host: url.host,
    url_pathname: url.pathname,
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

function assertCapCutSuccess(body: unknown, operation: string): void {
  const ret = retValue(body)
  if (ret === "0" || ret === 0) return
  throw jimengError({
    category: "upstream",
    code: "CAPCUT_API_REJECTED",
    message: `${operation} failed (ret=${String(ret ?? "unknown")}, errmsg=${errmsgValue(body) ?? "unknown"})`,
    retryable: false,
    details: { operation, ret, errmsg: errmsgValue(body) },
  })
}

function assertHttpSuccess(status: number, body: unknown, operation: string): void {
  if (status >= 200 && status < 300) return
  throw jimengError({
    category: "upstream",
    code: "CAPCUT_STATIC_CATALOG_REJECTED",
    message: `${operation} failed (http_status=${status})`,
    retryable: false,
    details: { operation, http_status: status, body },
  })
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const URL_LIKE_RE = /https?:\/\/|byteimg|douyinpic|vlabvod|x-signature|x-expires|expire_time/i

const CapCutEnvelopeSchema = z.object({
  ret: z.union([z.string(), z.number()]).nullable().optional(),
  errmsg: z.string().nullable().optional(),
  log_id: z.string().nullable().optional(),
  data: z.unknown().optional(),
}).passthrough()

const CapCutCollectionsDataSchema = z.object({
  collections: z.array(z.object({
    id: z.number(),
    display_name: z.string().nullable().optional(),
    root_category: z.string().nullable().optional(),
    direction: z.number().nullable().optional(),
    starling_key: z.string().nullable().optional(),
    resource_len: z.number().nullable().optional(),
    category_type: z.number().nullable().optional(),
    is_ecom_category: z.boolean().nullable().optional(),
    capsules: z.array(z.unknown()).nullable().optional(),
  }).passthrough()),
  template_source: z.string().nullable().optional(),
}).passthrough()

const CapCutCollectionTemplatesDataSchema = z.object({
  item_list: z.array(z.object({
    id: z.union([z.string(), z.number()]).optional(),
    web_id: z.string().optional(),
  }).passthrough()),
  has_more: z.boolean().nullable().optional(),
  new_cursor: z.number().nullable().optional(),
  template_source: z.string().nullable().optional(),
}).passthrough()

const CapCutTemplateDetailDataSchema = z.object({
  template_id: z.union([z.string(), z.number()]),
}).passthrough()

const OptionalCapCutString = Schema.optional(Schema.NullOr(Schema.String))
const OptionalCapCutNumber = Schema.optional(Schema.NullOr(Schema.Number))
const OptionalCapCutBoolean = Schema.optional(Schema.NullOr(Schema.Boolean))
const CapCutStringOrNumberWireSchema = Schema.Union([Schema.String, Schema.Number])
const CapCutTemplateMiningDataWireSchema = Schema.Struct({
  item_list: Schema.optional(Schema.Array(Schema.Unknown)),
  template_list: Schema.optional(Schema.Array(Schema.Unknown)),
  templates: Schema.optional(Schema.Array(Schema.Unknown)),
  has_more: OptionalCapCutBoolean,
  new_cursor: OptionalCapCutNumber,
  cursor: OptionalCapCutNumber,
  template_source: OptionalCapCutString,
})
const CapCutTemplateMiningEnvelopeWireSchema = Schema.Struct({
  ret: Schema.optional(Schema.NullOr(CapCutStringOrNumberWireSchema)),
  errmsg: OptionalCapCutString,
  data: Schema.optional(Schema.NullOr(CapCutTemplateMiningDataWireSchema)),
})
type CapCutTemplateMiningDataWire = Schema.Schema.Type<typeof CapCutTemplateMiningDataWireSchema>



const CapCutProbeEndpointSchema = z.string()
  .min(1)
  .transform((value) => {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      const url = new URL(value)
      const allowedHosts = new Set([
        new URL(CAPCUT_TEMPLATE_HOST).host,
        new URL(CAPCUT_FEED_API_HOST).host,
      ])
      if (!allowedHosts.has(url.host)) {
        throw new Error("CapCut endpoint probe only supports known CapCut API hosts")
      }
      return url.pathname
    }
    return value
  })
  .refine((value) => !CAPCUT_MUTATING_PROBE_ENDPOINTS.has(value), "CapCut endpoint probe rejects known mutating endpoints")
  .refine((value) => value.startsWith("/lv/v1/cc_web/") || CAPCUT_SIGNED_READ_PROBE_ENDPOINTS.has(value), "CapCut endpoint probe only supports signed read-oriented CapCut/LV endpoints")

function normalizeCapCutProbeEndpoint(endpoint: string): string {
  try {
    return CapCutProbeEndpointSchema.parse(endpoint)
  } catch (error) {
    const parsedError = error instanceof Error ? error : new Error(String(error))
    throw jimengError({
      category: "validation",
      code: "CAPCUT_ENDPOINT_PROBE_UNSAFE",
      message: "CapCut endpoint probe accepts only signed read-oriented CapCut/LV endpoints.",
      retryable: false,
      details: { endpoint, message: parsedError.message },
    })
  }
}

function parseCapCutEnvelopeBody(body: unknown, operation: string): z.infer<typeof CapCutEnvelopeSchema> {
  try {
    return CapCutEnvelopeSchema.parse(body)
  } catch (error) {
    const parsedError = error instanceof Error ? error : new Error(String(error))
    throw jimengError({
      category: "validation",
      code: "CAPCUT_RESPONSE_CONTRACT_CHANGED",
      message: `${operation} response no longer matches the expected envelope.`,
      retryable: false,
      details: { operation, message: parsedError.message },
    })
  }
}

function parseCapCutEnvelope(body: JsonValue): { ret: string | number | null; errmsg: string | null } {
  const record = asJsonRecord(body)
  return {
    ret: typeof record?.ret === "string" || typeof record?.ret === "number" ? record.ret : null,
    errmsg: stringValue(record?.errmsg),
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

function asJsonRecord(value: JsonValue | undefined): JsonObject | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function asJsonArray(value: JsonValue | undefined): JsonValue[] | null {
  return Array.isArray(value) ? value : null
}

function omitUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))
}

function pickCapCutTemplateMiningRows(data: CapCutTemplateMiningDataWire): {
  path: CapCutTemplateMiningParseResult["templateRowsPath"]
  items: readonly unknown[]
} {
  if (data.item_list) return { path: "data.item_list", items: data.item_list }
  if (data.template_list) return { path: "data.template_list", items: data.template_list }
  if (data.templates) return { path: "data.templates", items: data.templates }
  return { path: null, items: [] }
}

function capCutTemplateMiningBlockedReason(ret: string | number | null, errmsg: string | null): string | null {
  if (ret === null || ret === "0" || ret === 0) return null
  return errmsg ? `ret=${ret}: ${errmsg}` : `ret=${ret}`
}

function decodeCapCutMiningContract<A>(schema: Schema.Decoder<A>, value: unknown, operation: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    throw jimengError({
      category: "upstream",
      code: "CAPCUT_TEMPLATE_MINING_CONTRACT_CHANGED",
      message: `${operation} response no longer matches the expected typed mining contract.`,
      retryable: false,
      details: {
        operation,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

function parseCapCutCollectionTemplateItem(item: unknown): CapCutCollectionTemplateItem {
  const record = asRecord(item) ?? {}
  const numericId = stringOrNumber(record.id)
  const id = stringValue(record.web_id) ?? numericId
  if (!id) {
    throw jimengError({
      category: "validation",
      code: "CAPCUT_TEMPLATE_ITEM_ID_MISSING",
      message: "CapCut collection template row did not include web_id or id.",
      retryable: false,
    })
  }
  const extra = asRecord(record.extra_v2)
  const hypicExtra = asRecord(record.hypic_extra)
  const author = asRecord(record.author)
  const canvasWidth = numberFromStringOrNumber(extra?.canvas_width)
  const canvasHeight = numberFromStringOrNumber(extra?.canvas_height)
  return {
    id,
    numericId,
    title: stringValue(record.title),
    shortTitle: stringValue(record.short_title),
    itemType: numberValue(record.item_type),
    status: numberValue(record.status),
    coverUrlPresent: !!stringValue(record.cover_url),
    coverSize: readSize(record.cover_width, record.cover_height),
    optimizedCoverUrlKeys: Object.keys(asRecord(record.optimized_cover_url) ?? {}).sort(),
    categoryIds: asArray(record.category_id_list).map(numberValue).filter((value): value is number => value !== null),
    author: {
      uid: stringValue(author?.web_uid) ?? stringOrNumber(author?.uid),
      name: stringValue(author?.name),
      role: numberValue(author?.role),
    },
    featureCount: asArray(hypicExtra?.features).length,
    templateVersion: stringValue(hypicExtra?.template_version),
    tags: asArray(record.template_tags_v2).map(stringValue).filter((value): value is string => value !== null),
    sceneIds: parseNumberJsonArrayField(extra?.scene_ids),
    canvasSize: canvasWidth === null || canvasHeight === null ? null : { width: canvasWidth, height: canvasHeight },
    isMultiLang: booleanValue(record.is_multi_lang),
    textThemeCoverCount: asArray(record.text_theme_covers).length,
    textThemeEffectCount: asArray(record.text_theme_effects).length,
  }
}

function countMaterialCollections(materials: Record<string, unknown>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [key, value] of Object.entries(materials)) {
    if (Array.isArray(value)) counts[key] = value.length
  }
  return counts
}

function parseNumberJsonArrayField(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(numberValue).filter((item): item is number => item !== null)
  if (typeof value !== "string" || value.length === 0) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(numberValue).filter((item): item is number => item !== null) : []
  } catch {
    return []
  }
}

function readSize(widthValue: unknown, heightValue: unknown): { width: number; height: number } | null {
  const width = numberFromStringOrNumber(widthValue)
  const height = numberFromStringOrNumber(heightValue)
  return width === null || height === null ? null : { width, height }
}

function stringOrNumber(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function numberFromStringOrNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

function roundRatio(value: number): number {
  return Math.round(value * 10000) / 10000
}

function retValue(body: unknown): string | number | null {
  const value = asRecord(body)?.ret
  return typeof value === "string" || typeof value === "number" ? value : null
}

function errmsgValue(body: unknown): string | null {
  return stringValue(asRecord(body)?.errmsg)
}
