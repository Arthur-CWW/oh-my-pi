import { createHash, randomUUID } from "node:crypto"
import { Schema } from "effect"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient, type JimengFetch } from "./client"
import { jimengError } from "./errors"

const DEFAULT_QUERY = "aid=513695&device_platform=web&region=CN&web_version=7.5.0&da_version=3.3.17&aigc_features=app_lip_sync"
const CLONED_VOICE_EFFECT_TYPE = 218

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))
const OptionalNonEmptyString = Schema.optional(NonEmptyString)
const PositiveNumber = Schema.Number.check(Schema.isGreaterThan(0))
const VoiceAudioRequestSchema = Schema.Struct({
  vid: NonEmptyString,
  audio_url: OptionalNonEmptyString,
  duration: PositiveNumber,
  title: NonEmptyString,
})
const VoiceCloneSubmitRequestSchema = Schema.Struct({
  submit_id: NonEmptyString,
  scene: Schema.Literal(1),
  voice_clone: Schema.Struct({
    audio: VoiceAudioRequestSchema,
    name: NonEmptyString,
  }),
})
const VoiceTaskQueryRequestSchema = Schema.Struct({
  task_id_list: Schema.NonEmptyArray(NonEmptyString),
})
const ClonedVoiceUpdateRequestSchema = Schema.Struct({
  local_item_id: NonEmptyString,
  name: NonEmptyString,
})
const ClonedVoiceDeleteRequestSchema = Schema.Struct({
  local_item_id: NonEmptyString,
})

export const JimengCloneVoiceStatus = {
  Generating: 1,
  Success: 2,
  Fail: 3,
} as const

export type JimengCloneVoiceStatusValue = typeof JimengCloneVoiceStatus[keyof typeof JimengCloneVoiceStatus]

export const JimengVoiceTaskScene = {
  VoiceCloning: 1,
  VoiceConversion: 2,
} as const

export interface JimengClonedVoicesQuery {
  offset?: number
  limit?: number
  statuses?: JimengCloneVoiceStatusValue[]
  needFavoriteInfo?: boolean
}

export interface JimengVoiceAudioReference {
  vid: string
  audioUrl?: string
  duration?: number
  title?: string
}

export interface JimengVoiceCloneSubmitInput {
  submitId?: string
  audio: JimengVoiceAudioReference
  name: string
}

export interface JimengVoiceTaskQueryInput {
  taskIds: string[]
}

export interface JimengClonedVoiceUpdateInput {
  voiceId: string
  name: string
}

export interface JimengClonedVoiceDeleteInput {
  voiceId: string
}

export interface JimengClonedVoice {
  id: string
  name: string
  isFavorite: boolean
  effectType: number | null
  itemPlatform: number
  status: number | null
  failCode: number | null
}

export interface JimengClonedVoicesResult {
  endpoint: "/mweb/v1/get_user_local_item_list"
  request: Record<string, unknown>
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  body: unknown
  voices: JimengClonedVoice[]
  hasMore: boolean | null
  nextOffset: number | null
}

export interface JimengVoiceCloneSubmitResult {
  endpoint: "/mweb/v1/voice/submit_task"
  request: Record<string, unknown>
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  body: unknown
  status: number | null
  failCode: number | null
  voice: JimengClonedVoice | null
}

export interface JimengVoiceTaskQueryResult {
  endpoint: "/mweb/v1/voice/query_task"
  request: Record<string, unknown>
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  body: unknown
  tasks: Array<Record<string, unknown>>
}

export interface JimengClonedVoiceMutationResult {
  endpoint: "/mweb/v1/voice/update" | "/mweb/v1/voice/delete"
  request: Record<string, unknown>
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  body: unknown
  voice: JimengClonedVoice | null
}

export function buildJimengClonedVoicesRequest(input: JimengClonedVoicesQuery = {}): Record<string, unknown> {
  const offset = input.offset ?? 0
  const limit = input.limit ?? 50
  const statuses = input.statuses ?? [JimengCloneVoiceStatus.Generating, JimengCloneVoiceStatus.Success]
  assertNonNegativeInteger(offset, "offset")
  assertPositiveInteger(limit, "limit")
  if (limit > 100) {
    throw jimengError({
      category: "validation",
      code: "VOICE_CLONE_LIMIT_OUT_OF_RANGE",
      message: "voice clone list limit must be <= 100",
      retryable: false,
      details: { limit },
    })
  }
  if (statuses.length === 0) {
    throw jimengError({
      category: "validation",
      code: "VOICE_CLONE_STATUS_REQUIRED",
      message: "at least one clone voice status is required",
      retryable: false,
    })
  }
  return {
    offset,
    count: limit,
    effect_type: CLONED_VOICE_EFFECT_TYPE,
    filter_opt: { clone_voice_status: uniqueStatuses(statuses) },
    pack_local_item_opt: { need_favorite_info: input.needFavoriteInfo ?? true },
  }
}

export function buildJimengVoiceCloneSubmitRequest(input: JimengVoiceCloneSubmitInput): Record<string, unknown> {
  const name = input.name.trim()
  if (!name) {
    throw jimengError({
      category: "validation",
      code: "VOICE_CLONE_NAME_REQUIRED",
      message: "voice clone name is required",
      retryable: false,
    })
  }
  const audio = buildVoiceAudio(input.audio)
  const request = {
    submit_id: input.submitId ?? randomUUID(),
    scene: JimengVoiceTaskScene.VoiceCloning,
    voice_clone: {
      audio,
      name,
    },
  }
  validateJimengVoiceCloneSubmitRequest(request)
  return request
}

export function buildJimengVoiceTaskQueryRequest(input: JimengVoiceTaskQueryInput): Record<string, unknown> {
  const taskIds = uniqueStrings(input.taskIds)
  if (taskIds.length === 0) {
    throw jimengError({
      category: "validation",
      code: "VOICE_TASK_IDS_REQUIRED",
      message: "at least one voice task id is required",
      retryable: false,
    })
  }
  const request = { task_id_list: taskIds }
  validateJimengVoiceTaskQueryRequest(request)
  return request
}

export function buildJimengClonedVoiceUpdateRequest(input: JimengClonedVoiceUpdateInput): Record<string, unknown> {
  const voiceId = input.voiceId.trim()
  const name = input.name.trim()
  if (!voiceId || !name) {
    throw jimengError({
      category: "validation",
      code: "VOICE_CLONE_UPDATE_INVALID",
      message: "voice update requires voice id and name",
      retryable: false,
      details: { voiceIdPresent: !!voiceId, namePresent: !!name },
    })
  }
  const request = { local_item_id: voiceId, name }
  validateJimengClonedVoiceUpdateRequest(request)
  return request
}

export function buildJimengClonedVoiceDeleteRequest(input: JimengClonedVoiceDeleteInput): Record<string, unknown> {
  const voiceId = input.voiceId.trim()
  if (!voiceId) {
    throw jimengError({
      category: "validation",
      code: "VOICE_CLONE_DELETE_ID_REQUIRED",
      message: "voice delete requires voice id",
      retryable: false,
    })
  }
  const request = { local_item_id: voiceId }
  validateJimengClonedVoiceDeleteRequest(request)
  return request
}

export function validateJimengVoiceCloneSubmitRequest(request: Record<string, unknown>): void {
  decodeVoiceCloneContract(VoiceCloneSubmitRequestSchema, request, "Jimeng voice clone submit request")
}

export function validateJimengVoiceTaskQueryRequest(request: Record<string, unknown>): void {
  decodeVoiceCloneContract(VoiceTaskQueryRequestSchema, request, "Jimeng voice task query request")
}

export function validateJimengClonedVoiceUpdateRequest(request: Record<string, unknown>): void {
  decodeVoiceCloneContract(ClonedVoiceUpdateRequestSchema, request, "Jimeng cloned voice update request")
}

export function validateJimengClonedVoiceDeleteRequest(request: Record<string, unknown>): void {
  decodeVoiceCloneContract(ClonedVoiceDeleteRequestSchema, request, "Jimeng cloned voice delete request")
}

export async function fetchJimengClonedVoices(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  query?: JimengClonedVoicesQuery
}): Promise<JimengClonedVoicesResult> {
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const request = buildJimengClonedVoicesRequest(input.query)
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/get_user_local_item_list?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildVoiceCloneHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "cloned-voices")
  const data = asRecord(asRecord(body)?.data)
  return {
    endpoint: "/mweb/v1/get_user_local_item_list",
    request,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    body,
    voices: asArray(data?.item_list ?? data?.itemList).map(parseClonedVoice).filter(isNotNull),
    hasMore: booleanValue(data?.has_more ?? data?.hasMore),
    nextOffset: numberValue(data?.next_offset ?? data?.nextOffset),
  }
}

export async function submitJimengVoiceClone(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  voiceClone: JimengVoiceCloneSubmitInput
}): Promise<JimengVoiceCloneSubmitResult> {
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const request = buildJimengVoiceCloneSubmitRequest(input.voiceClone)
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/voice/submit_task?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildVoiceCloneHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "voice-clone-submit")
  const data = asRecord(asRecord(body)?.data)
  const result = asRecord(data?.voice_clone_result ?? data?.voiceCloneResult)
  const item = asRecord(result?.item)
  return {
    endpoint: "/mweb/v1/voice/submit_task",
    request,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    body,
    status: numberValue(data?.status),
    failCode: numberValue(data?.fail_code ?? data?.failCode),
    voice: item ? parseClonedVoice(item) : null,
  }
}

export async function queryJimengVoiceTasks(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  taskIds: string[]
}): Promise<JimengVoiceTaskQueryResult> {
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const request = buildJimengVoiceTaskQueryRequest({ taskIds: input.taskIds })
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/voice/query_task?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildVoiceCloneHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "voice-task-query")
  const data = asRecord(asRecord(body)?.data)
  return {
    endpoint: "/mweb/v1/voice/query_task",
    request,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    body,
    tasks: asArray(data?.task_list ?? data?.taskList).map(toJsonRecord),
  }
}

export async function updateJimengClonedVoice(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  voice: JimengClonedVoiceUpdateInput
}): Promise<JimengClonedVoiceMutationResult> {
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const request = buildJimengClonedVoiceUpdateRequest(input.voice)
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/voice/update?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildVoiceCloneHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "voice-clone-update")
  const item = asRecord(asRecord(asRecord(body)?.data)?.item)
  return {
    endpoint: "/mweb/v1/voice/update",
    request,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    body,
    voice: item ? parseClonedVoice(item) : null,
  }
}

export async function deleteJimengClonedVoice(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  voiceId: string
}): Promise<JimengClonedVoiceMutationResult> {
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const request = buildJimengClonedVoiceDeleteRequest({ voiceId: input.voiceId })
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/voice/delete?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildVoiceCloneHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "voice-clone-delete")
  return {
    endpoint: "/mweb/v1/voice/delete",
    request,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    body,
    voice: null,
  }
}

export function summarizeJimengClonedVoices(result: JimengClonedVoicesResult): Record<string, unknown> {
  return {
    endpoint: result.endpoint,
    request: result.request,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    voice_count: result.voices.length,
    has_more: result.hasMore,
    next_offset: result.nextOffset,
    by_status: countBy(result.voices.map((voice) => statusLabel(voice.status))),
    voices: result.voices.map(summarizeClonedVoice),
  }
}

export function summarizeJimengVoiceCloneSubmit(result: JimengVoiceCloneSubmitResult): Record<string, unknown> {
  return {
    endpoint: result.endpoint,
    request: result.request,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    status: result.status,
    fail_code: result.failCode,
    voice: result.voice ? summarizeClonedVoice(result.voice) : null,
  }
}

export function summarizeJimengVoiceTaskQuery(result: JimengVoiceTaskQueryResult): Record<string, unknown> {
  return {
    endpoint: result.endpoint,
    request: result.request,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    task_count: result.tasks.length,
    tasks: result.tasks.map(summarizeVoiceTask),
  }
}

export function summarizeJimengClonedVoiceMutation(result: JimengClonedVoiceMutationResult): Record<string, unknown> {
  return {
    endpoint: result.endpoint,
    request: result.request,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    voice: result.voice ? summarizeClonedVoice(result.voice) : null,
  }
}

function buildVoiceAudio(input: JimengVoiceAudioReference): Record<string, unknown> {
  const vid = input.vid.trim()
  const title = input.title?.trim() ?? ""
  if (!vid) {
    throw jimengError({
      category: "validation",
      code: "VOICE_AUDIO_VID_REQUIRED",
      message: "voice clone audio vid is required",
      retryable: false,
    })
  }
  if (input.duration === undefined || input.duration <= 0 || !Number.isFinite(input.duration) || !title) {
    throw jimengError({
      category: "validation",
      code: "VOICE_AUDIO_METADATA_REQUIRED",
      message: "voice clone audio duration and title are required",
      retryable: false,
      details: { durationPresent: input.duration !== undefined, titlePresent: !!title },
    })
  }
  return {
    vid,
    ...(input.audioUrl ? { audio_url: input.audioUrl } : {}),
    duration: input.duration,
    title,
  }
}

function parseClonedVoice(value: unknown): JimengClonedVoice | null {
  const item = asRecord(value)
  if (!item) return null
  const common = asRecord(item.common_attr ?? item.commonAttr)
  const extra = asRecord(item.extra)
  const clone = asRecord(item.clone_voice_info ?? item.cloneVoiceInfo)
  const id = stringValue(common?.id ?? item.id)
  if (!id) return null
  return {
    id,
    name: stringValue(common?.title ?? item.title) ?? "",
    isFavorite: booleanValue(extra?.is_favorite ?? extra?.isFavorite) ?? false,
    effectType: numberValue(common?.effect_type ?? common?.effectType),
    itemPlatform: 2,
    status: numberValue(clone?.status),
    failCode: numberValue(clone?.fail_code ?? clone?.failCode),
  }
}

function summarizeClonedVoice(voice: JimengClonedVoice): Record<string, unknown> {
  return {
    id: voice.id,
    name: voice.name,
    is_favorite: voice.isFavorite,
    effect_type: voice.effectType,
    item_platform: voice.itemPlatform,
    status: voice.status,
    status_label: statusLabel(voice.status),
    fail_code: voice.failCode,
  }
}

function summarizeVoiceTask(value: Record<string, unknown>): Record<string, unknown> {
  const conversion = asRecord(value.voice_conversion_result ?? value.voiceConversionResult)
  const clone = asRecord(value.voice_clone_result ?? value.voiceCloneResult)
  return {
    task_id: stringValue(value.task_id ?? value.taskId ?? conversion?.task_id ?? conversion?.taskId),
    status: numberValue(value.status),
    fail_code: numberValue(value.fail_code ?? value.failCode),
    has_voice_conversion_result: !!conversion,
    has_voice_clone_result: !!clone,
  }
}

function buildVoiceCloneHeaders(session: JimengSessionBundle): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/plain, */*",
    "user-agent": session.userAgent ?? "Mozilla/5.0",
    origin: session.origin ?? "https://jimeng.jianying.com",
    referer: session.referer ?? "https://jimeng.jianying.com/ai-tool/home/",
    cookie: session.cookie,
    lan: "zh-Hans",
    pf: "7",
    loc: "cn",
    appid: "513695",
    appvr: "8.4.0",
    "app-sdk-version": "48.0.0",
    "x-platform": "pc",
  }
}

function uniqueStatuses(values: JimengCloneVoiceStatusValue[]): JimengCloneVoiceStatusValue[] {
  const seen = new Set<number>()
  const out: JimengCloneVoiceStatusValue[] = []
  for (const value of values) {
    if (!Object.values(JimengCloneVoiceStatus).includes(value)) {
      throw jimengError({
        category: "validation",
        code: "VOICE_CLONE_STATUS_UNKNOWN",
        message: `unknown clone voice status: ${String(value)}`,
        retryable: false,
        details: { valid: Object.values(JimengCloneVoiceStatus) },
      })
    }
    if (!seen.has(value)) {
      seen.add(value)
      out.push(value)
    }
  }
  return out
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function statusLabel(value: number | null): string {
  if (value === JimengCloneVoiceStatus.Generating) return "generating"
  if (value === JimengCloneVoiceStatus.Success) return "success"
  if (value === JimengCloneVoiceStatus.Fail) return "fail"
  return "unknown"
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw jimengError({
      category: "validation",
      code: "VOICE_CLONE_INVALID_NUMBER",
      message: `${field} must be a non-negative integer`,
      retryable: false,
      details: { field, value },
    })
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw jimengError({
      category: "validation",
      code: "VOICE_CLONE_INVALID_NUMBER",
      message: `${field} must be a positive integer`,
      retryable: false,
      details: { field, value },
    })
  }
}

function decodeVoiceCloneContract<A>(schema: Schema.Decoder<A>, value: unknown, operation: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "validation",
      code: "JIMENG_VOICE_CLONE_CONTRACT_CHANGED",
      message: `${operation} did not match required fields.`,
      retryable: false,
      details: { operation, error: message },
    })
  }
}

function assertJimengSuccess(body: unknown, operation: string): void {
  const ret = retValue(body)
  if (ret !== null && String(ret) !== "0") {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_REQUEST_FAILED",
      message: `${operation} failed (ret=${String(ret)}, errmsg=${errmsgValue(body) ?? "unknown"})`,
      retryable: false,
      details: { operation, ret, errmsg: errmsgValue(body) },
    })
  }
}

function retValue(body: unknown): string | number | null {
  const root = asRecord(body)
  const ret = root?.ret
  return typeof ret === "string" || typeof ret === "number" ? ret : null
}

function errmsgValue(body: unknown): string | null {
  return stringValue(asRecord(body)?.errmsg)
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
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

function toJsonRecord(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? { value }
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

function isNotNull<T>(value: T | null): value is T {
  return value !== null
}
