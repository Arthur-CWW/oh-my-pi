import { createHash } from "node:crypto"
import { Schema } from "effect"
import { buildJimengCommerceSignedHeaders } from "./account-credit"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient, type JimengFetch } from "./client"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { parseJimengApiEnvelope, parseJsonText } from "./schema"

export const JIMENG_COMMERCE_VIP_PRICE_LIST_ENDPOINT = "/commerce/v1/subscription/price_list"
export const JIMENG_COMMERCE_CREDIT_PRICE_LIST_ENDPOINT = "/commerce/v1/purchase/price_list"

export type JimengCommercePricingEndpoint = "vip" | "credit"

const OptionalString = Schema.optional(Schema.NullOr(Schema.String))
const OptionalNumber = Schema.optional(Schema.NullOr(Schema.Number))
const OptionalBoolean = Schema.optional(Schema.NullOr(Schema.Boolean))

const VipUserCreditWireSchema = Schema.Struct({
  amount: OptionalNumber,
  description: OptionalString,
})

const VipBenefitPackageWireSchema = Schema.Struct({
  user_credit: Schema.optional(Schema.NullOr(VipUserCreditWireSchema)),
  benefit_texts: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
})

const PriceItemWireSchema = Schema.Struct({
  product_id: OptionalString,
  total_amount: OptionalNumber,
  currency_code: OptionalString,
  currency_tips: OptionalString,
  price_tips: OptionalString,
  price_type: OptionalString,
  subscribe_cycle: OptionalNumber,
  cycle_unit: OptionalString,
  change_type: OptionalString,
  can_trial: OptionalBoolean,
  vip_benefit_package: Schema.optional(Schema.NullOr(VipBenefitPackageWireSchema)),
})

const PriceTabWireSchema = Schema.Struct({
  product_ids: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  tab_name: OptionalString,
  as_default: OptionalBoolean,
})

const VipPricePayloadWireSchema = Schema.Struct({
  vip_price_list: Schema.Array(PriceItemWireSchema),
  all_price_list: Schema.optional(Schema.NullOr(Schema.Array(PriceItemWireSchema))),
  tab_list: Schema.optional(Schema.NullOr(Schema.Array(PriceTabWireSchema))),
  default_product_id: OptionalString,
  default_unauto_product_id: OptionalString,
})

const CreditPricePayloadWireSchema = Schema.Struct({
  price_list: Schema.Array(PriceItemWireSchema),
})

type PriceItemWire = Schema.Schema.Type<typeof PriceItemWireSchema>
type PriceTabWire = Schema.Schema.Type<typeof PriceTabWireSchema>

export interface JimengCommercePricingQuery {
  endpoints?: JimengCommercePricingEndpoint[]
}

export interface JimengCommercePriceItem {
  productId: string | null
  totalAmount: number | null
  currencyCode: string | null
  currencyTips: string | null
  priceTips: string | null
  priceType: string | null
  subscribeCycle: number | null
  cycleUnit: string | null
  changeType: string | null
  canTrial: boolean | null
  vipCreditAmount: number | null
  vipCreditDescription: string | null
  benefitTexts: string[]
}

export interface JimengCommercePriceTab {
  tabName: string | null
  asDefault: boolean | null
  productIds: string[]
}

export interface JimengCommercePricingResult {
  endpoint: typeof JIMENG_COMMERCE_VIP_PRICE_LIST_ENDPOINT | typeof JIMENG_COMMERCE_CREDIT_PRICE_LIST_ENDPOINT
  endpointId: JimengCommercePricingEndpoint
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  body: JsonValue
  payload: JsonObject
  items: JimengCommercePriceItem[]
  tabs: JimengCommercePriceTab[]
  defaultProductId: string | null
  defaultUnautoProductId: string | null
}

export interface JimengCommercePricingBundle {
  endpoints: JimengCommercePricingEndpoint[]
  results: JimengCommercePricingResult[]
}

export function parseJimengCommercePricingEndpoints(value: string | undefined): JimengCommercePricingEndpoint[] {
  if (!value || value === "all") return ["vip", "credit"]
  const allowed = new Set<JimengCommercePricingEndpoint>(["vip", "credit"])
  const endpoints: JimengCommercePricingEndpoint[] = []
  for (const part of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    if (!allowed.has(part as JimengCommercePricingEndpoint)) {
      throw jimengError({
        category: "validation",
        code: "COMMERCE_PRICING_ENDPOINT_INVALID",
        message: "commerce-pricing --endpoints must be vip, credit, or all.",
        retryable: false,
        details: { endpoint: part, allowed: Array.from(allowed) },
      })
    }
    endpoints.push(part as JimengCommercePricingEndpoint)
  }
  return Array.from(new Set(endpoints))
}

export function buildJimengCommercePricingRequest(endpoint: JimengCommercePricingEndpoint): JsonObject {
  if (endpoint === "vip") {
    return { aid: 513695, region: "cn", platform: 7, scene: "vip" }
  }
  return { goodsTypes: ["credit"] }
}

export async function fetchJimengCommercePricing(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  query?: JimengCommercePricingQuery
  nowMs?: number
}): Promise<JimengCommercePricingBundle> {
  const endpoints = input.query?.endpoints ?? parseJimengCommercePricingEndpoints(undefined)
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const results: JimengCommercePricingResult[] = []
  for (const endpoint of endpoints) {
    results.push(await fetchCommercePricingEndpoint({
      client,
      session: input.session,
      endpoint,
      nowMs: input.nowMs,
    }))
  }
  return { endpoints, results }
}

export function summarizeJimengCommercePricing(bundle: JimengCommercePricingBundle): JsonObject {
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
      item_count: result.items.length,
      tab_count: result.tabs.length,
      default_product_id: result.defaultProductId,
      default_unauto_product_id: result.defaultUnautoProductId,
      product_ids: sortedUnique(result.items.map((item) => item.productId).filter((value): value is string => !!value)),
      price_types: sortedUnique(result.items.map((item) => item.priceType).filter((value): value is string => !!value)),
      cycle_units: sortedUnique(result.items.map((item) => item.cycleUnit).filter((value): value is string => !!value)),
      currency_codes: sortedUnique(result.items.map((item) => item.currencyCode).filter((value): value is string => !!value)),
      total_amount_min: numberMin(result.items.map((item) => item.totalAmount)),
      total_amount_max: numberMax(result.items.map((item) => item.totalAmount)),
      vip_credit_amount_max: numberMax(result.items.map((item) => item.vipCreditAmount)),
      tabs: result.tabs.map((tab) => ({
        tab_name: tab.tabName,
        as_default: tab.asDefault,
        product_ids: tab.productIds,
      })),
      items: result.items.map((item) => ({
        product_id: item.productId,
        total_amount: item.totalAmount,
        currency_code: item.currencyCode,
        currency_tips: item.currencyTips,
        price_tips: item.priceTips,
        price_type: item.priceType,
        subscribe_cycle: item.subscribeCycle,
        cycle_unit: item.cycleUnit,
        change_type: item.changeType,
        can_trial: item.canTrial,
        vip_credit_amount: item.vipCreditAmount,
        vip_credit_description: item.vipCreditDescription,
        benefit_text_count: item.benefitTexts.length,
        benefit_text_samples: item.benefitTexts.slice(0, 8),
      })),
    })),
  }
}

async function fetchCommercePricingEndpoint(input: {
  client: JimengClient
  session: JimengSessionBundle
  endpoint: JimengCommercePricingEndpoint
  nowMs?: number
}): Promise<JimengCommercePricingResult> {
  const endpointPath = endpointPathForId(input.endpoint)
  const request = buildJimengCommercePricingRequest(input.endpoint)
  const response = await input.client.requestText(`https://jimeng.jianying.com${endpointPath}`, {
    method: "POST",
    headers: buildJimengCommerceSignedHeaders(input.session, { endpoint: endpointPath, nowMs: input.nowMs }),
    body: JSON.stringify(request),
  })
  const body = parseJsonText(response.text, input.endpoint)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, endpointPath)
  const payload = parseCommerceResponsePayload(body, input.endpoint)
  const parsed = decodeCommercePricingPayload(input.endpoint, payload)
  return {
    endpoint: endpointPath,
    endpointId: input.endpoint,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    body,
    payload,
    ...parsed,
  }
}

function decodeCommercePricingPayload(endpoint: JimengCommercePricingEndpoint, payload: JsonObject): {
  items: JimengCommercePriceItem[]
  tabs: JimengCommercePriceTab[]
  defaultProductId: string | null
  defaultUnautoProductId: string | null
} {
  try {
    if (endpoint === "vip") {
      const decoded = Schema.decodeUnknownSync(VipPricePayloadWireSchema)(payload)
      return {
        items: decoded.vip_price_list.map(normalizePriceItem),
        tabs: (decoded.tab_list ?? []).map(normalizePriceTab),
        defaultProductId: cleanString(decoded.default_product_id),
        defaultUnautoProductId: cleanString(decoded.default_unauto_product_id),
      }
    }
    const decoded = Schema.decodeUnknownSync(CreditPricePayloadWireSchema)(payload)
    return {
      items: decoded.price_list.map(normalizePriceItem),
      tabs: [],
      defaultProductId: null,
      defaultUnautoProductId: null,
    }
  } catch (error) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_COMMERCE_PRICING_CONTRACT_CHANGED",
      message: `${endpoint}: Jimeng commerce pricing response did not match required fields.`,
      retryable: false,
      details: { endpoint, error: error instanceof Error ? error.message : String(error) },
    })
  }
}

function parseCommerceResponsePayload(body: JsonValue, operation: string): JsonObject {
  const record = objectValue(body)
  const response = record?.response
  if (typeof response === "string" && response.trim()) {
    const parsed = parseJsonText(response, `${operation} response`)
    const payload = objectValue(parsed)
    if (payload) return payload
  }
  const data = objectValue(record?.data)
  if (data) return data
  throw jimengError({
    category: "upstream",
    code: "JIMENG_COMMERCE_PRICING_PAYLOAD_MISSING",
    message: `${operation}: commerce pricing response did not include object data or response JSON.`,
    retryable: false,
    details: { operation, response_kind: kindOf(response), data_kind: kindOf(record?.data) },
  })
}

function normalizePriceItem(item: PriceItemWire): JimengCommercePriceItem {
  const benefitPackage = item.vip_benefit_package ?? null
  const userCredit = benefitPackage?.user_credit ?? null
  return {
    productId: cleanString(item.product_id),
    totalAmount: finiteNumber(item.total_amount),
    currencyCode: cleanString(item.currency_code),
    currencyTips: cleanString(item.currency_tips),
    priceTips: cleanString(item.price_tips),
    priceType: cleanString(item.price_type),
    subscribeCycle: finiteNumber(item.subscribe_cycle),
    cycleUnit: cleanString(item.cycle_unit),
    changeType: cleanString(item.change_type),
    canTrial: typeof item.can_trial === "boolean" ? item.can_trial : null,
    vipCreditAmount: finiteNumber(userCredit?.amount),
    vipCreditDescription: cleanString(userCredit?.description),
    benefitTexts: Array.from(benefitPackage?.benefit_texts ?? []),
  }
}

function normalizePriceTab(tab: PriceTabWire): JimengCommercePriceTab {
  return {
    tabName: cleanString(tab.tab_name),
    asDefault: typeof tab.as_default === "boolean" ? tab.as_default : null,
    productIds: Array.from(tab.product_ids ?? []),
  }
}

function endpointPathForId(endpoint: JimengCommercePricingEndpoint): JimengCommercePricingResult["endpoint"] {
  return endpoint === "vip" ? JIMENG_COMMERCE_VIP_PRICE_LIST_ENDPOINT : JIMENG_COMMERCE_CREDIT_PRICE_LIST_ENDPOINT
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

function objectValue(value: JsonValue | undefined | null): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function cleanString(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function numberMin(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  return finite.length > 0 ? Math.min(...finite) : null
}

function numberMax(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  return finite.length > 0 ? Math.max(...finite) : null
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort()
}

function kindOf(value: JsonValue | undefined | null): string | null {
  if (value === undefined) return null
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

function retValue(body: JsonValue): string | number | null {
  const value = objectValue(body)?.ret
  return typeof value === "string" || typeof value === "number" ? value : null
}

function errmsgValue(body: JsonValue): string | null {
  const value = objectValue(body)?.errmsg
  return typeof value === "string" ? value : null
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
