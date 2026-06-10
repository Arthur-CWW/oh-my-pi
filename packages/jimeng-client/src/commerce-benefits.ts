import { createHash } from "node:crypto"
import { z } from "zod"
import { buildJimengCommerceSignedHeaders } from "./account-credit"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient } from "./client"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { parseJimengApiEnvelope, parseJimengContract, parseJsonText } from "./schema"

export const JIMENG_COMMERCE_BENEFIT_METADATA_ENDPOINT = "/commerce/v3/resource/benefit_metadata"
export const JIMENG_COMMERCE_USER_BENEFIT_ENDPOINT = "/commerce/v3/benefits/batch_get_user_benefit"

export type JimengCommerceBenefitEndpointId = "metadata" | "user-benefits"

const OptionalString = z.string().nullable().optional()
const OptionalNumber = z.number().nullable().optional()
const OptionalBoolean = z.boolean().nullable().optional()

const BenefitQueryItemWireSchema = z.object({
  resource_type: z.string(),
  resource_id: z.string(),
  benefit_type_list: z.array(z.string()).optional(),
}).passthrough()

const BenefitQueryRequestWireSchema = z.object({
  query_list: z.array(BenefitQueryItemWireSchema).min(1),
}).passthrough()

const BenefitPayStrategyWireSchema = z.object({
  benefit_type: OptionalString,
  benefit_id: OptionalNumber,
  unit: OptionalString,
  use_mode: OptionalString,
}).passthrough()

const MetadataItemWireSchema = z.object({
  resource_type: OptionalString,
  resource_id: OptionalString,
  benefits_pay_strategy: z.array(BenefitPayStrategyWireSchema).nullable().optional(),
  benefits_display_resource: z.array(z.unknown()).nullable().optional(),
}).passthrough()

const MetadataDataWireSchema = z.object({
  metadata_list: z.array(MetadataItemWireSchema),
}).passthrough()

const AssetDetailWireSchema = z.object({
  pay_mode: OptionalString,
  quota_all: OptionalNumber,
  quota_left: OptionalNumber,
  role: OptionalString,
}).passthrough()

const UserBenefitAssetWireSchema = z.object({
  resource_type: OptionalString,
  resource_id: OptionalString,
  benefit_type: OptionalString,
  benefit_item_id: OptionalNumber,
  quota_all: OptionalNumber,
  quota_left: OptionalNumber,
  asset_details: z.array(AssetDetailWireSchema).nullable().optional(),
}).passthrough()

const UserBenefitDataWireSchema = z.object({
  asset_list: z.array(UserBenefitAssetWireSchema),
  total_credits: OptionalNumber,
  credits_detail: z.unknown().nullable().optional(),
  enable_preview: OptionalBoolean,
}).passthrough()

export interface JimengCommerceBenefitQueryItem {
  resourceType: string
  resourceId: string
  benefitTypeList: string[]
}

export interface JimengCommerceBenefitMetadataItem {
  resourceType: string
  resourceId: string
  benefitTypes: string[]
  benefitIds: number[]
  units: string[]
  useModes: string[]
  payStrategyCount: number
  displayResourceCount: number
}

export interface JimengCommerceUserBenefitAsset {
  resourceType: string
  resourceId: string
  benefitType: string
  benefitItemId: number | null
  quotaAll: number | null
  quotaLeft: number | null
  payModes: string[]
  roles: string[]
}

export interface JimengCommerceBenefitMetadataResult {
  endpoint: typeof JIMENG_COMMERCE_BENEFIT_METADATA_ENDPOINT
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  metadataCount: number
  items: JimengCommerceBenefitMetadataItem[]
  body: JsonValue
}

export interface JimengCommerceUserBenefitResult {
  endpoint: typeof JIMENG_COMMERCE_USER_BENEFIT_ENDPOINT
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  totalCredits: number | null
  enablePreview: boolean | null
  creditsDetailKind: string | null
  assetCount: number
  assets: JimengCommerceUserBenefitAsset[]
  body: JsonValue
}

export interface JimengCommerceBenefitsResult {
  requestedEndpoints: JimengCommerceBenefitEndpointId[]
  request: JsonObject
  metadata: JimengCommerceBenefitMetadataResult | null
  userBenefits: JimengCommerceUserBenefitResult | null
}

export function parseJimengCommerceBenefitEndpoints(value: string | undefined): JimengCommerceBenefitEndpointId[] {
  const raw = (value ?? "all").split(",").map((item) => item.trim()).filter(Boolean)
  const expanded = raw.includes("all") ? ["metadata", "user-benefits"] : raw
  const ids: JimengCommerceBenefitEndpointId[] = []
  for (const item of expanded) {
    if (item === "metadata" || item === "user-benefits") ids.push(item)
    else {
      throw jimengError({
        category: "validation",
        code: "UNKNOWN_COMMERCE_BENEFIT_ENDPOINT",
        message: `Unknown commerce-benefits endpoint: ${item}`,
        retryable: false,
        details: { endpoint: item },
      })
    }
  }
  return Array.from(new Set(ids))
}

export function buildJimengCommerceBenefitsRequest(input?: {
  queryItems?: JimengCommerceBenefitQueryItem[]
}): JsonObject {
  const queryItems = input?.queryItems ?? [
    { resourceType: "aigc", resourceId: "get_all", benefitTypeList: [] },
    { resourceType: "normal_func", resourceId: "get_all", benefitTypeList: [] },
  ]
  return {
    query_list: queryItems.map((item) => ({
      resource_type: item.resourceType,
      resource_id: item.resourceId,
      benefit_type_list: item.benefitTypeList,
    })),
  }
}

export async function fetchJimengCommerceBenefits(input: {
  client?: JimengClient
  session: JimengSessionBundle
  endpoints?: JimengCommerceBenefitEndpointId[]
  request?: JsonObject
  nowMs?: number
}): Promise<JimengCommerceBenefitsResult> {
  const client = input.client ?? new JimengClient()
  const request = input.request ?? buildJimengCommerceBenefitsRequest()
  parseJimengContract(BenefitQueryRequestWireSchema, request, "commerce benefits request")
  const endpoints = input.endpoints ?? ["metadata", "user-benefits"]
  return {
    requestedEndpoints: endpoints,
    request,
    metadata: endpoints.includes("metadata")
      ? await fetchMetadata({ client, session: input.session, request, nowMs: input.nowMs })
      : null,
    userBenefits: endpoints.includes("user-benefits")
      ? await fetchUserBenefits({ client, session: input.session, request, nowMs: input.nowMs })
      : null,
  }
}

export function parseJimengCommerceBenefitMetadataBody(body: JsonValue): {
  metadataCount: number
  items: JimengCommerceBenefitMetadataItem[]
} {
  const envelope = parseJimengApiEnvelope(body, "commerce benefit metadata")
  if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
    throw dataMapError("commerce benefit metadata", envelope.data)
  }
  const data = parseJimengContract(MetadataDataWireSchema, envelope.data, "commerce benefit metadata")
  const items = data.metadata_list.map(parseMetadataItem).filter((item): item is JimengCommerceBenefitMetadataItem => !!item)
  return { metadataCount: data.metadata_list.length, items }
}

export function parseJimengCommerceUserBenefitBody(body: JsonValue): {
  totalCredits: number | null
  enablePreview: boolean | null
  creditsDetailKind: string | null
  assetCount: number
  assets: JimengCommerceUserBenefitAsset[]
} {
  const envelope = parseJimengApiEnvelope(body, "commerce user benefits")
  if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
    throw dataMapError("commerce user benefits", envelope.data)
  }
  const data = parseJimengContract(UserBenefitDataWireSchema, envelope.data, "commerce user benefits")
  const assets = data.asset_list.map(parseUserBenefitAsset).filter((item): item is JimengCommerceUserBenefitAsset => !!item)
  return {
    totalCredits: numberValue(data.total_credits),
    enablePreview: booleanValue(data.enable_preview),
    creditsDetailKind: kindOf(data.credits_detail),
    assetCount: data.asset_list.length,
    assets,
  }
}

export function summarizeJimengCommerceBenefits(result: JimengCommerceBenefitsResult): JsonObject {
  return {
    endpoints: result.requestedEndpoints,
    request: result.request,
    metadata: result.metadata ? {
      endpoint: result.metadata.endpoint,
      http_status: result.metadata.httpStatus,
      ret: result.metadata.ret,
      errmsg: result.metadata.errmsg,
      response_text_sha256: result.metadata.responseTextSha256,
      metadata_count: result.metadata.metadataCount,
      resource_ids: sortedUnique(result.metadata.items.map((item) => item.resourceId)),
      benefit_types: sortedUnique(result.metadata.items.flatMap((item) => item.benefitTypes)),
      units: sortedUnique(result.metadata.items.flatMap((item) => item.units)),
      use_modes: sortedUnique(result.metadata.items.flatMap((item) => item.useModes)),
      items: result.metadata.items.map((item) => ({
        resource_type: item.resourceType,
        resource_id: item.resourceId,
        benefit_types: item.benefitTypes,
        benefit_ids: item.benefitIds,
        units: item.units,
        use_modes: item.useModes,
        pay_strategy_count: item.payStrategyCount,
        display_resource_count: item.displayResourceCount,
      })),
    } : null,
    user_benefits: result.userBenefits ? {
      endpoint: result.userBenefits.endpoint,
      http_status: result.userBenefits.httpStatus,
      ret: result.userBenefits.ret,
      errmsg: result.userBenefits.errmsg,
      response_text_sha256: result.userBenefits.responseTextSha256,
      total_credits: result.userBenefits.totalCredits,
      enable_preview: result.userBenefits.enablePreview,
      credits_detail_kind: result.userBenefits.creditsDetailKind,
      asset_count: result.userBenefits.assetCount,
      resource_ids: sortedUnique(result.userBenefits.assets.map((asset) => asset.resourceId)),
      benefit_types: sortedUnique(result.userBenefits.assets.map((asset) => asset.benefitType)),
      pay_modes: sortedUnique(result.userBenefits.assets.flatMap((asset) => asset.payModes)),
      roles: sortedUnique(result.userBenefits.assets.flatMap((asset) => asset.roles)),
      assets: result.userBenefits.assets.map((asset) => ({
        resource_type: asset.resourceType,
        resource_id: asset.resourceId,
        benefit_type: asset.benefitType,
        benefit_item_id: asset.benefitItemId,
        quota_all: asset.quotaAll,
        quota_left: asset.quotaLeft,
        pay_modes: asset.payModes,
        roles: asset.roles,
      })),
    } : null,
  }
}

async function fetchMetadata(input: {
  client: JimengClient
  session: JimengSessionBundle
  request: JsonObject
  nowMs?: number
}): Promise<JimengCommerceBenefitMetadataResult> {
  const response = await requestCommerceEndpoint(input.client, input.session, JIMENG_COMMERCE_BENEFIT_METADATA_ENDPOINT, input.request, input.nowMs)
  const body = parseJsonText(response.text, "commerce benefit metadata")
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "commerce benefit metadata")
  const parsed = parseJimengCommerceBenefitMetadataBody(body)
  return {
    endpoint: JIMENG_COMMERCE_BENEFIT_METADATA_ENDPOINT,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request: input.request,
    ...parsed,
    body,
  }
}

async function fetchUserBenefits(input: {
  client: JimengClient
  session: JimengSessionBundle
  request: JsonObject
  nowMs?: number
}): Promise<JimengCommerceUserBenefitResult> {
  const response = await requestCommerceEndpoint(input.client, input.session, JIMENG_COMMERCE_USER_BENEFIT_ENDPOINT, input.request, input.nowMs)
  const body = parseJsonText(response.text, "commerce user benefits")
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "commerce user benefits")
  const parsed = parseJimengCommerceUserBenefitBody(body)
  return {
    endpoint: JIMENG_COMMERCE_USER_BENEFIT_ENDPOINT,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request: input.request,
    ...parsed,
    body,
  }
}

async function requestCommerceEndpoint(
  client: JimengClient,
  session: JimengSessionBundle,
  endpoint: string,
  request: JsonObject,
  nowMs?: number,
) {
  return await client.requestText(`https://jimeng.jianying.com${endpoint}`, {
    method: "POST",
    headers: buildJimengCommerceSignedHeaders(session, { endpoint, nowMs }),
    body: JSON.stringify(request),
  })
}

function parseMetadataItem(item: z.infer<typeof MetadataItemWireSchema>): JimengCommerceBenefitMetadataItem | null {
  const resourceType = stringValue(item.resource_type)
  const resourceId = stringValue(item.resource_id)
  if (!resourceType || !resourceId) return null
  const strategies = item.benefits_pay_strategy ?? []
  return {
    resourceType,
    resourceId,
    benefitTypes: sortedUnique(strategies.map((strategy) => stringValue(strategy.benefit_type)).filter((value): value is string => !!value)),
    benefitIds: sortedUniqueNumbers(strategies.map((strategy) => numberValue(strategy.benefit_id)).filter((value): value is number => value !== null)),
    units: sortedUnique(strategies.map((strategy) => stringValue(strategy.unit)).filter((value): value is string => !!value)),
    useModes: sortedUnique(strategies.map((strategy) => stringValue(strategy.use_mode)).filter((value): value is string => !!value)),
    payStrategyCount: strategies.length,
    displayResourceCount: item.benefits_display_resource?.length ?? 0,
  }
}

function parseUserBenefitAsset(item: z.infer<typeof UserBenefitAssetWireSchema>): JimengCommerceUserBenefitAsset | null {
  const resourceType = stringValue(item.resource_type)
  const resourceId = stringValue(item.resource_id)
  const benefitType = stringValue(item.benefit_type)
  if (!resourceType || !resourceId || !benefitType) return null
  const assetDetails = item.asset_details ?? []
  return {
    resourceType,
    resourceId,
    benefitType,
    benefitItemId: numberValue(item.benefit_item_id),
    quotaAll: numberValue(item.quota_all),
    quotaLeft: numberValue(item.quota_left),
    payModes: sortedUnique(assetDetails.map((detail) => stringValue(detail.pay_mode)).filter((value): value is string => !!value)),
    roles: sortedUnique(assetDetails.map((detail) => stringValue(detail.role)).filter((value): value is string => !!value)),
  }
}

function assertJimengSuccess(body: JsonValue, operation: string): void {
  const ret = retValue(body)
  if (ret === "0" || ret === 0) return
  throw jimengError({
    category: "upstream",
    code: "JIMENG_API_REJECTED",
    message: `${operation} failed (ret=${String(ret ?? "missing")}, errmsg=${errmsgValue(body) ?? "missing"})`,
    retryable: false,
    details: { operation, ret, errmsg: errmsgValue(body) },
  })
}

function dataMapError(operation: string, data: JsonValue | undefined | null) {
  return jimengError({
    category: "upstream",
    code: "JIMENG_RESPONSE_DATA_MAP_CHANGED",
    message: `${operation} response data was not an object map.`,
    retryable: false,
    details: { operation, data_kind: Array.isArray(data) ? "array" : typeof data },
  })
}

function retValue(body: JsonValue): string | number | null {
  const value = asRecord(body)?.ret
  return typeof value === "string" || typeof value === "number" ? value : null
}

function errmsgValue(body: JsonValue): string | null {
  return stringValue(asRecord(body)?.errmsg)
}

function asRecord(value: JsonValue | undefined | null): JsonObject | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function stringValue(value: JsonValue | undefined | null): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function numberValue(value: JsonValue | undefined | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanValue(value: JsonValue | undefined | null): boolean | null {
  return typeof value === "boolean" ? value : null
}

function kindOf(value: unknown): string | null {
  if (value === undefined) return null
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort()
}

function sortedUniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values)).sort((left, right) => left - right)
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
