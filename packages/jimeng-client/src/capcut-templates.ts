import { createHash } from "node:crypto"
import { type JimengSessionBundle } from "./capture"
import { JimengClient } from "./client"
import { jimengError } from "./errors"

const CAPCUT_TEMPLATE_HOST = "https://edit-api-sg.capcut.com"
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

function retValue(body: unknown): string | number | null {
  const value = asRecord(body)?.ret
  return typeof value === "string" || typeof value === "number" ? value : null
}

function errmsgValue(body: unknown): string | null {
  return stringValue(asRecord(body)?.errmsg)
}
