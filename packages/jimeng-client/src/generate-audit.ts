import { Schema } from "effect"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"

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
