import { createHash } from "node:crypto"
import { Schema } from "effect"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient, type JimengFetch } from "./client"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { parseJimengApiEnvelope, parseJsonText } from "./schema"

export const JIMENG_GENERATE_AUDIT_ENDPOINT = "/mweb/v1/execute_generate_audit" as const
export const JIMENG_GENERATE_AUDIT_QUERY = "aid=513695&web_version=7.5.0&da_version=3.3.17&aigc_features=app_lip_sync" as const

export const JimengGenerateAuditMaterialType = {
  Image: 1,
  Video: 2,
  Audio: 3,
  Subject: 4,
} as const

export type JimengGenerateAuditMaterialKind =
  | "image"
  | "video"
  | "audio"
  | "subject"
  | 1
  | 2
  | 3
  | 4

export interface JimengGenerateAuditMaterialInput {
  type: JimengGenerateAuditMaterialKind
  uri?: string
  itemId?: string | number
  subjectDataId?: string | number
}

export interface JimengGenerateAuditPlanInput {
  materials: JimengGenerateAuditMaterialInput[]
  extraRequest?: JsonObject
}

export interface JimengGenerateAuditPlan {
  endpoint: typeof JIMENG_GENERATE_AUDIT_ENDPOINT
  method: "POST"
  query: typeof JIMENG_GENERATE_AUDIT_QUERY
  request: JsonObject
  materialList: JsonObject[]
  materialCounts: Record<"image" | "video" | "audio" | "subject", number>
}

export interface JimengGenerateAuditMaterialSummary {
  materialType: number | null
  uri: string | null
  vid: string | null
  itemId: string | number | null
  subjectDataId: string | number | null
  status: string | number | boolean | null
  auditStatus: string | number | boolean | null
  rejectReason: string | null
  keys: string[]
}

export interface JimengGenerateAuditResult {
  endpoint: typeof JIMENG_GENERATE_AUDIT_ENDPOINT
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  materialResults: JimengGenerateAuditMaterialSummary[]
  body: JsonValue
}

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))
const StringOrNumber = Schema.Union([Schema.String, Schema.Number])

const GenerateAuditMaterialInputSchema = Schema.Struct({
  type: Schema.Union([
    Schema.Literal("image"),
    Schema.Literal("video"),
    Schema.Literal("audio"),
    Schema.Literal("subject"),
    Schema.Literal(1),
    Schema.Literal(2),
    Schema.Literal(3),
    Schema.Literal(4),
  ]),
  uri: Schema.optional(Schema.String),
  itemId: Schema.optional(StringOrNumber),
  subjectDataId: Schema.optional(StringOrNumber),
})

const GenerateAuditMaterialInputListSchema = Schema.NonEmptyArray(GenerateAuditMaterialInputSchema)

const GenerateAuditMaterialRequestSchema = Schema.Struct({
  material_type: Schema.Number,
  uri: Schema.optional(NonEmptyString),
  vid: Schema.optional(NonEmptyString),
  item_id: Schema.optional(StringOrNumber),
  subject_data_id: Schema.optional(StringOrNumber),
})

const GenerateAuditRequestSchema = Schema.Struct({
  material_list: Schema.NonEmptyArray(GenerateAuditMaterialRequestSchema),
})

export function parseJimengGenerateAuditMaterialsJson(value: JsonValue): JimengGenerateAuditMaterialInput[] {
  return decodeGenerateAuditContract(
    GenerateAuditMaterialInputListSchema,
    value,
    "generate-audit material list",
  ).map((material) => ({ ...material }))
}

export function buildJimengGenerateAuditPlan(input: JimengGenerateAuditPlanInput): JimengGenerateAuditPlan {
  if (input.materials.length === 0) {
    throw jimengError({
      category: "validation",
      code: "GENERATE_AUDIT_MATERIALS_REQUIRED",
      message: "generate-audit-plan requires at least one material.",
      retryable: false,
    })
  }

  const extraRequest = input.extraRequest ?? {}
  if ("material_list" in extraRequest || "materialList" in extraRequest) {
    throw jimengError({
      category: "validation",
      code: "GENERATE_AUDIT_MATERIAL_LIST_RESERVED",
      message: "generate-audit-plan owns material_list; put only additional top-level fields in --body.",
      retryable: false,
    })
  }

  const materialList = input.materials.map(normalizeGenerateAuditMaterial)
  const request: JsonObject = {
    ...extraRequest,
    material_list: materialList,
  }

  validateJimengGenerateAuditRequest(request)

  return {
    endpoint: JIMENG_GENERATE_AUDIT_ENDPOINT,
    method: "POST",
    query: JIMENG_GENERATE_AUDIT_QUERY,
    request,
    materialList,
    materialCounts: countGenerateAuditMaterials(materialList),
  }
}

export async function executeJimengGenerateAudit(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  audit: JimengGenerateAuditPlanInput
}): Promise<JimengGenerateAuditResult> {
  const plan = buildJimengGenerateAuditPlan(input.audit)
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const response = await client.requestText(`https://jimeng.jianying.com${JIMENG_GENERATE_AUDIT_ENDPOINT}?${JIMENG_GENERATE_AUDIT_QUERY}`, {
    method: "POST",
    headers: buildGenerateAuditHeaders(input.session),
    body: JSON.stringify(plan.request),
  })
  const body = parseGenerateAuditResponse(response.text, "generate audit")

  return {
    endpoint: JIMENG_GENERATE_AUDIT_ENDPOINT,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request: plan.request,
    materialResults: summarizeAuditMaterialRows(body),
    body,
  }
}

export function summarizeJimengGenerateAuditPlan(plan: JimengGenerateAuditPlan): JsonObject {
  return {
    endpoint: plan.endpoint,
    method: plan.method,
    query: plan.query,
    request_keys: Object.keys(plan.request).sort(),
    material_count: plan.materialList.length,
    material_counts: plan.materialCounts,
    material_types: plan.materialList.map((material) => material.material_type),
    live_submit: false,
    next_compare_command: "jimeng-browser-proxy request-plan-compare --plan <dry-run-plan.json> --rawNetwork <capture>/raw-network.jsonl",
  }
}

export function summarizeJimengGenerateAuditResult(result: JimengGenerateAuditResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    material_result_count: result.materialResults.length,
    material_results: result.materialResults.map(summarizeAuditMaterial),
  }
}

export function validateJimengGenerateAuditRequest(request: JsonObject): void {
  decodeGenerateAuditContract(GenerateAuditRequestSchema, request, "generate-audit request")

  for (const material of request.material_list as JsonObject[]) {
    const type = material.material_type
    if (type === JimengGenerateAuditMaterialType.Image && typeof material.uri !== "string") {
      throw invalidMaterial("Image audit material requires uri.")
    }
    if ((type === JimengGenerateAuditMaterialType.Video || type === JimengGenerateAuditMaterialType.Audio) && typeof material.vid !== "string") {
      throw invalidMaterial("Video and audio audit materials require vid.")
    }
    if (type === JimengGenerateAuditMaterialType.Subject && material.subject_data_id === undefined) {
      throw invalidMaterial("Subject audit material requires subject_data_id.")
    }
  }
}

function parseGenerateAuditResponse(text: string, operation: string): JsonValue {
  const body = parseJsonText(text, operation)
  assertNoRiskError(body, text)
  const envelope = parseJimengApiEnvelope(body, operation)
  if (envelope.ret !== undefined && String(envelope.ret) !== "0") {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_GENERATE_AUDIT_UPSTREAM_ERROR",
      message: `${operation} returned ret=${String(envelope.ret)} errmsg=${envelope.errmsg ?? "unknown"}.`,
      retryable: false,
      details: { ret: envelope.ret, errmsg: envelope.errmsg ?? null },
    })
  }
  return body
}

function summarizeAuditMaterialRows(body: JsonValue): JimengGenerateAuditMaterialSummary[] {
  const data = isJsonObject(body) ? body.data : undefined
  const rows: JimengGenerateAuditMaterialSummary[] = []
  collectAuditMaterialRows(data, rows)
  return rows.slice(0, 40)
}

function collectAuditMaterialRows(value: JsonValue | undefined, rows: JimengGenerateAuditMaterialSummary[]): void {
  if (value === undefined || rows.length >= 40) return
  if (Array.isArray(value)) {
    for (const entry of value) collectAuditMaterialRows(entry, rows)
    return
  }
  if (!isJsonObject(value)) return

  const uri = stringValue(value.uri) ?? stringValue(value.image_uri) ?? stringValue(value.imageUri)
  const vid = stringValue(value.vid) ?? stringValue(value.video_id) ?? stringValue(value.videoId)
  const itemId = stringValue(value.item_id) ?? numberValue(value.item_id) ?? stringValue(value.itemId) ?? numberValue(value.itemId)
  const subjectDataId = stringValue(value.subject_data_id)
    ?? numberValue(value.subject_data_id)
    ?? stringValue(value.subjectDataId)
    ?? numberValue(value.subjectDataId)
  const materialType = numberValue(value.material_type)
    ?? numberValue(value.materialType)
    ?? (subjectDataId !== null ? JimengGenerateAuditMaterialType.Subject : null)
  const status = stringValue(value.status) ?? numberValue(value.status) ?? booleanValue(value.status)
  const auditStatus = stringValue(value.audit_status)
    ?? numberValue(value.audit_status)
    ?? booleanValue(value.audit_status)
    ?? stringValue(value.auditStatus)
    ?? numberValue(value.auditStatus)
    ?? booleanValue(value.auditStatus)
  const rejectReason = stringValue(value.reject_reason) ?? stringValue(value.rejectReason) ?? stringValue(value.reason)

  if (materialType !== null || uri || vid || itemId !== null || subjectDataId !== null || status !== null || auditStatus !== null) {
    rows.push({
      materialType,
      uri,
      vid,
      itemId,
      subjectDataId,
      status,
      auditStatus,
      rejectReason,
      keys: Object.keys(value).sort(),
    })
  }

  for (const entry of Object.values(value)) collectAuditMaterialRows(entry, rows)
}

function summarizeAuditMaterial(material: JimengGenerateAuditMaterialSummary): JsonObject {
  return {
    material_type: material.materialType,
    uri_present: material.uri !== null,
    vid: material.vid,
    item_id: material.itemId,
    subject_data_id: material.subjectDataId,
    status: material.status,
    audit_status: material.auditStatus,
    reject_reason: material.rejectReason,
    keys: material.keys,
  }
}

function buildGenerateAuditHeaders(session: JimengSessionBundle): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/plain, */*",
    "user-agent": session.userAgent ?? "Mozilla/5.0",
    origin: session.origin ?? "https://jimeng.jianying.com",
    referer: session.referer ?? "https://jimeng.jianying.com/ai-tool/generate/",
    cookie: session.cookie,
    lan: "zh-Hans",
    pf: "7",
    loc: "cn",
    appid: "513695",
  }
}

function retValue(body: JsonValue): string | number | null {
  return isJsonObject(body) && (typeof body.ret === "string" || typeof body.ret === "number") ? body.ret : null
}

function errmsgValue(body: JsonValue): string | null {
  return isJsonObject(body) && typeof body.errmsg === "string" ? body.errmsg : null
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanValue(value: JsonValue | undefined): boolean | null {
  return typeof value === "boolean" ? value : null
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function normalizeGenerateAuditMaterial(input: JimengGenerateAuditMaterialInput): JsonObject {
  const materialType = normalizeMaterialType(input.type)
  const itemId = normalizeOptionalId(input.itemId, "itemId")

  if (materialType === JimengGenerateAuditMaterialType.Image) {
    return withOptionalItemId({
      material_type: materialType,
      uri: normalizeUri(input.uri, "image material uri"),
    }, itemId)
  }
  if (materialType === JimengGenerateAuditMaterialType.Video) {
    return withOptionalItemId({
      material_type: materialType,
      vid: normalizeUri(input.uri, "video material uri"),
    }, itemId)
  }
  if (materialType === JimengGenerateAuditMaterialType.Audio) {
    return withOptionalItemId({
      material_type: materialType,
      vid: normalizeUri(input.uri, "audio material vid"),
    }, itemId)
  }

  const subjectDataId = normalizeOptionalId(input.subjectDataId, "subjectDataId")
  if (subjectDataId === undefined) {
    throw invalidMaterial("Subject audit material requires subjectDataId.")
  }
  return {
    material_type: materialType,
    subject_data_id: subjectDataId,
  }
}

function withOptionalItemId(material: JsonObject, itemId: string | number | undefined): JsonObject {
  if (itemId === undefined) return material
  return {
    ...material,
    item_id: itemId,
  }
}

function normalizeMaterialType(type: JimengGenerateAuditMaterialKind): number {
  if (type === "image" || type === JimengGenerateAuditMaterialType.Image) return JimengGenerateAuditMaterialType.Image
  if (type === "video" || type === JimengGenerateAuditMaterialType.Video) return JimengGenerateAuditMaterialType.Video
  if (type === "audio" || type === JimengGenerateAuditMaterialType.Audio) return JimengGenerateAuditMaterialType.Audio
  if (type === "subject" || type === JimengGenerateAuditMaterialType.Subject) return JimengGenerateAuditMaterialType.Subject
  throw invalidMaterial(`Unsupported material type: ${String(type)}`)
}

function normalizeUri(value: string | undefined, label: string): string {
  const normalized = value?.trim()
  if (!normalized) throw invalidMaterial(`${label} is required.`)
  return normalized
}

function normalizeOptionalId(value: string | number | undefined, label: string): string | number | undefined {
  if (value === undefined) return undefined
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value
    throw invalidMaterial(`${label} must be finite.`)
  }
  const normalized = value.trim()
  if (!normalized) throw invalidMaterial(`${label} must not be empty.`)
  return normalized
}

function countGenerateAuditMaterials(materialList: JsonObject[]): Record<"image" | "video" | "audio" | "subject", number> {
  const counts = { image: 0, video: 0, audio: 0, subject: 0 }
  for (const material of materialList) {
    if (material.material_type === JimengGenerateAuditMaterialType.Image) counts.image += 1
    if (material.material_type === JimengGenerateAuditMaterialType.Video) counts.video += 1
    if (material.material_type === JimengGenerateAuditMaterialType.Audio) counts.audio += 1
    if (material.material_type === JimengGenerateAuditMaterialType.Subject) counts.subject += 1
  }
  return counts
}

function invalidMaterial(message: string): Error {
  return jimengError({
    category: "validation",
    code: "GENERATE_AUDIT_MATERIAL_INVALID",
    message,
    retryable: false,
  })
}

function decodeGenerateAuditContract<A>(schema: Schema.Decoder<A>, value: JsonValue, operation: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "upstream",
      code: "JIMENG_GENERATE_AUDIT_CONTRACT_CHANGED",
      message: `${operation}: Jimeng generate-audit request did not match required fields.`,
      retryable: false,
      details: {
        operation,
        error: message,
      },
    })
  }
}
