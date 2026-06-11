import { createHash, randomUUID } from "node:crypto"
import { Schema } from "effect"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient } from "./client"
import { buildJimengEndpointProbeHeaders } from "./endpoint-probe"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { parseJimengApiEnvelope, parseJimengDataMap, parseJsonText } from "./schema"

const DEFAULT_QUERY = "aid=513695&device_platform=web&region=CN&web_version=7.5.0&da_version=3.3.17"
const STORY_EXPORT_TASK_TYPE = "pack_story_mode"
const OptionalString = Schema.optional(Schema.NullOr(Schema.String))
const OptionalNumber = Schema.optional(Schema.NullOr(Schema.Number))
const OptionalId = Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number])))

const StoryCoverWireSchema = Schema.Struct({
  image_uri: OptionalString,
  image_url: OptionalString,
  uri: OptionalString,
  url: OptionalString,
  width: OptionalNumber,
  height: OptionalNumber,
  format: OptionalString,
})

const StoryWireSchema = Schema.Struct({
  story_id: OptionalId,
  storyId: OptionalId,
  id: OptionalId,
  draft_id: OptionalId,
  draftId: OptionalId,
  story_version: OptionalId,
  storyVersion: OptionalId,
  name: OptionalString,
  title: OptionalString,
  desc: OptionalString,
  description: OptionalString,
  cover: Schema.optional(Schema.NullOr(StoryCoverWireSchema)),
})

const StoryMapDataWireSchema = Schema.Struct({
  story_map: Schema.optional(Schema.Record(Schema.String, StoryWireSchema)),
  storyMap: Schema.optional(Schema.Record(Schema.String, StoryWireSchema)),
  story_list: Schema.optional(Schema.Array(StoryWireSchema)),
  storyList: Schema.optional(Schema.Array(StoryWireSchema)),
})

const AsyncTaskWireSchema = Schema.Struct({
  task_id: OptionalString,
  taskId: OptionalString,
  status: OptionalNumber,
  payload: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.Unknown)]))),
  errmsg: OptionalString,
  message: OptionalString,
})

const AsyncTaskMapDataWireSchema = Schema.Struct({
  task_map: Schema.optional(Schema.Record(Schema.String, AsyncTaskWireSchema)),
  taskMap: Schema.optional(Schema.Record(Schema.String, AsyncTaskWireSchema)),
  task_list: Schema.optional(Schema.Array(AsyncTaskWireSchema)),
  taskList: Schema.optional(Schema.Array(AsyncTaskWireSchema)),
})

type StoryWire = Schema.Schema.Type<typeof StoryWireSchema>
type AsyncTaskWire = Schema.Schema.Type<typeof AsyncTaskWireSchema>

export interface JimengStoryRecord {
  storyId: string | null
  storyIdWasUnsafeNumber: boolean
  draftId: string | null
  draftIdWasUnsafeNumber: boolean
  storyVersion: string | null
  storyVersionWasUnsafeNumber: boolean
  name: string | null
  description: string | null
  coverUri: string | null
  coverUrl: string | null
  coverWidth: number | null
  coverHeight: number | null
  coverFormat: string | null
}

export interface JimengStoryRecordsResult {
  endpoint: "/mweb/v1/mget_story"
  request: JsonObject
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  body: JsonValue
  stories: JimengStoryRecord[]
}

export interface JimengAsyncTaskRecord {
  taskId: string | null
  status: number | null
  payload: JsonObject | null
  payloadParseError: string | null
  message: string | null
  downloadUrlPresent: boolean
  missingMaterialCount: number | null
}

export interface JimengAsyncTasksResult {
  endpoint: "/mweb/v1/mget_async_task"
  request: JsonObject
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  body: JsonValue
  tasks: JimengAsyncTaskRecord[]
}

export interface JimengStoryExportPlanInput {
  submitId?: string
  storyIds?: string[]
  payload?: JsonObject
}

export interface JimengStoryExportPlan {
  endpoint: "/mweb/v1/submit_async_task"
  method: "POST"
  request: JsonObject
  payloadObject: JsonObject
}

export function parseJimengStoryIds(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const ids = uniqueText(value.split(","))
  if (ids.length === 0) {
    throw validationError("story id list must include at least one id", { value })
  }
  return ids
}

export function buildJimengStoryRecordsRequest(storyIds: string[]): JsonObject {
  const ids = requireIds(storyIds, "storyIds")
  return { story_id_list: ids }
}

export function buildJimengAsyncTasksRequest(taskIds: string[]): JsonObject {
  const ids = requireIds(taskIds, "taskIds")
  return { task_id_list: ids }
}

export function buildJimengStoryExportPlan(input: JimengStoryExportPlanInput = {}): JimengStoryExportPlan {
  const payloadObject = input.payload ?? { story_id_list: requireIds(input.storyIds ?? [], "storyIds") }
  const request = {
    type: STORY_EXPORT_TASK_TYPE,
    submit_id: input.submitId?.trim() || randomUUID(),
    payload: JSON.stringify(payloadObject),
  } satisfies JsonObject
  return {
    endpoint: "/mweb/v1/submit_async_task",
    method: "POST",
    request,
    payloadObject,
  }
}

export async function fetchJimengStoryRecords(input: {
  client?: JimengClient
  session: JimengSessionBundle
  storyIds: string[]
}): Promise<JimengStoryRecordsResult> {
  const client = input.client ?? new JimengClient()
  const request = buildJimengStoryRecordsRequest(input.storyIds)
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/mget_story?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildJimengEndpointProbeHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = parseJsonText(response.text, "story-records")
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "story-records")
  const data = parseJimengDataMap(body, "story-records")
  const decoded = decodeContract(StoryMapDataWireSchema, data, "story-records")
  return {
    endpoint: "/mweb/v1/mget_story",
    request,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    body,
    stories: storyRecordsFromData(decoded).map(normalizeStory),
  }
}

export async function fetchJimengAsyncTasks(input: {
  client?: JimengClient
  session: JimengSessionBundle
  taskIds: string[]
}): Promise<JimengAsyncTasksResult> {
  const client = input.client ?? new JimengClient()
  const request = buildJimengAsyncTasksRequest(input.taskIds)
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/mget_async_task?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildJimengEndpointProbeHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = parseJsonText(response.text, "async-tasks")
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "async-tasks")
  const data = parseJimengDataMap(body, "async-tasks")
  const decoded = decodeContract(AsyncTaskMapDataWireSchema, data, "async-tasks")
  return {
    endpoint: "/mweb/v1/mget_async_task",
    request,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    body,
    tasks: asyncTasksFromData(decoded).map(normalizeAsyncTask),
  }
}

export function summarizeJimengStoryRecords(result: JimengStoryRecordsResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    story_count: result.stories.length,
    stories: result.stories.map((story) => ({
      story_id: story.storyId,
      story_id_was_unsafe_number: story.storyIdWasUnsafeNumber,
      draft_id: story.draftId,
      draft_id_was_unsafe_number: story.draftIdWasUnsafeNumber,
      story_version: story.storyVersion,
      story_version_was_unsafe_number: story.storyVersionWasUnsafeNumber,
      name: story.name,
      description: story.description,
      cover_uri: story.coverUri,
      cover_url_present: !!story.coverUrl,
      cover_width: story.coverWidth,
      cover_height: story.coverHeight,
      cover_format: story.coverFormat,
    })),
  }
}

export function summarizeJimengAsyncTasks(result: JimengAsyncTasksResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    task_count: result.tasks.length,
    tasks: result.tasks.map((task) => ({
      task_id: task.taskId,
      status: task.status,
      message: task.message,
      payload_present: !!task.payload,
      payload_parse_error: task.payloadParseError,
      download_url_present: task.downloadUrlPresent,
      missing_material_count: task.missingMaterialCount,
    })),
  }
}

export function summarizeJimengStoryExportPlan(plan: JimengStoryExportPlan): JsonObject {
  return {
    endpoint: plan.endpoint,
    method: plan.method,
    request: plan.request,
    payload_object: plan.payloadObject,
    live_submit: false,
    warning: "Dry-run only. /mweb/v1/submit_async_task creates an export task and requires approval or a disposable fixture.",
  }
}

function storyRecordsFromData(data: Schema.Schema.Type<typeof StoryMapDataWireSchema>): ReadonlyArray<StoryWire> {
  if (data.story_map) return Object.values(data.story_map)
  if (data.storyMap) return Object.values(data.storyMap)
  if (data.story_list) return data.story_list
  if (data.storyList) return data.storyList
  return []
}

function asyncTasksFromData(data: Schema.Schema.Type<typeof AsyncTaskMapDataWireSchema>): ReadonlyArray<AsyncTaskWire> {
  if (data.task_map) return Object.entries(data.task_map).map(([taskId, task]) => ({ task_id: taskId, ...task }))
  if (data.taskMap) return Object.entries(data.taskMap).map(([taskId, task]) => ({ taskId, ...task }))
  if (data.task_list) return data.task_list
  if (data.taskList) return data.taskList
  return []
}

function normalizeStory(story: StoryWire): JimengStoryRecord {
  const storyId = normalizeOptionalId(story.story_id ?? story.storyId ?? story.id)
  const draftId = normalizeOptionalId(story.draft_id ?? story.draftId)
  const storyVersion = normalizeOptionalId(story.story_version ?? story.storyVersion)
  const cover = story.cover ?? null
  return {
    storyId: storyId.value,
    storyIdWasUnsafeNumber: storyId.unsafe,
    draftId: draftId.value,
    draftIdWasUnsafeNumber: draftId.unsafe,
    storyVersion: storyVersion.value,
    storyVersionWasUnsafeNumber: storyVersion.unsafe,
    name: cleanString(story.name ?? story.title),
    description: cleanString(story.desc ?? story.description),
    coverUri: cleanString(cover?.image_uri ?? cover?.uri),
    coverUrl: cleanString(cover?.image_url ?? cover?.url),
    coverWidth: finiteNumber(cover?.width),
    coverHeight: finiteNumber(cover?.height),
    coverFormat: cleanString(cover?.format),
  }
}

function normalizeAsyncTask(task: AsyncTaskWire): JimengAsyncTaskRecord {
  const payload = parsePayload(task.payload)
  const result = objectValue(payload.value?.result)
  const missMaterialItem = arrayValue(result?.miss_material_item ?? result?.missMaterialItem)
  return {
    taskId: cleanString(task.task_id ?? task.taskId),
    status: finiteNumber(task.status),
    payload: payload.value,
    payloadParseError: payload.error,
    message: cleanString(task.errmsg ?? task.message ?? stringValue(result?.message)),
    downloadUrlPresent: !!stringValue(result?.download_url ?? result?.downloadUrl),
    missingMaterialCount: missMaterialItem ? missMaterialItem.length : null,
  }
}

function parsePayload(value: AsyncTaskWire["payload"]): { value: JsonObject | null; error: string | null } {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as JsonValue
      return { value: objectValue(parsed), error: objectValue(parsed) ? null : "payload_json_not_object" }
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : String(error) }
    }
  }
  return { value: objectValue(value as JsonValue), error: value ? null : null }
}

function decodeContract<A>(schema: Schema.Decoder<A>, value: JsonValue, operation: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_STORY_ARCHIVE_CONTRACT_CHANGED",
      message: `${operation}: Jimeng story/archive response did not match required fields.`,
      retryable: false,
      details: { operation, error: error instanceof Error ? error.message : String(error) },
    })
  }
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

function requireIds(ids: string[], label: string): string[] {
  const normalized = uniqueText(ids)
  if (normalized.length > 0) return normalized
  throw validationError(`${label} must include at least one id`, { label })
}

function uniqueText(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function normalizeOptionalId(value: string | number | null | undefined): { value: string | null; unsafe: boolean } {
  if (typeof value === "string" && value.length > 0) return { value, unsafe: false }
  if (typeof value === "number" && Number.isSafeInteger(value)) return { value: String(value), unsafe: false }
  return { value: null, unsafe: typeof value === "number" && Number.isFinite(value) }
}

function objectValue(value: JsonValue | undefined | null): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function arrayValue(value: JsonValue | undefined | null): JsonValue[] | null {
  return Array.isArray(value) ? value : null
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function cleanString(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function retValue(body: JsonValue): string | number | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  return typeof body.ret === "string" || typeof body.ret === "number" ? body.ret : null
}

function errmsgValue(body: JsonValue): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  return typeof body.errmsg === "string" ? body.errmsg : null
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function validationError(message: string, details: JsonObject): ReturnType<typeof jimengError> {
  return jimengError({
    category: "validation",
    code: "STORY_ARCHIVE_INPUT_INVALID",
    message,
    retryable: false,
    details,
  })
}
