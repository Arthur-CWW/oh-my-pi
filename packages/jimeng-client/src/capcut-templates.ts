import { createHash } from "node:crypto"
import { type JimengSessionBundle } from "./capture"
import { JimengClient } from "./client"
import { jimengError } from "./errors"

const CAPCUT_TEMPLATE_HOST = "https://edit-api-sg.capcut.com"
const CAPCUT_TEMPLATE_MERCURY_BASE = "https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod"
const CAPCUT_TEMPLATE_RATIO_CATALOG_URL = `${CAPCUT_TEMPLATE_MERCURY_BASE}/biz_49/bee_prod_49_bee_publish_709.json`
const CAPCUT_TEMPLATE_SCENE_CATALOG_URL = `${CAPCUT_TEMPLATE_MERCURY_BASE}/biz_149/bee_prod_149_bee_publish_835.json`
const CAPCUT_TEMPLATE_SDK_VERSION = "16.1.0"
const CAPCUT_TEMPLATE_APP_VERSION = "5.8.0"
const CAPCUT_TEMPLATE_PF = "7"
const CAPCUT_TEMPLATE_APP_SDK_VERSION = "999.999.999"
const CAPCUT_TEMPLATE_SIGN_SECRET_PREFIX = "9e2c"
const CAPCUT_TEMPLATE_SIGN_SECRET_SUFFIX = "11ac"

export interface CapCutTemplateCategory {
  categoryId: number
  starlingKey: string | null
  displayName: string | null
}

export interface CapCutTemplateCategoriesQuery {
  lan?: string
  loc?: string
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

export function capCutTemplateStaticCatalogUrls(): { ratioCatalogUrl: string; sceneCatalogUrl: string } {
  return {
    ratioCatalogUrl: CAPCUT_TEMPLATE_RATIO_CATALOG_URL,
    sceneCatalogUrl: CAPCUT_TEMPLATE_SCENE_CATALOG_URL,
  }
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
  session?: Pick<JimengSessionBundle, "userAgent">
  query?: CapCutTemplateCategoriesQuery
} = {}): Promise<CapCutTemplateCategoriesResult> {
  const client = input.client ?? new JimengClient()
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

export async function fetchCapCutTemplateStaticCatalog(input: {
  client?: JimengClient
  userAgent?: string | null
} = {}): Promise<CapCutTemplateStaticCatalogResult> {
  const client = input.client ?? new JimengClient()
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
