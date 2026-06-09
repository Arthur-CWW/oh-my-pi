import { createHash } from "node:crypto"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient } from "./client"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"

const DEFAULT_QUERY = "aid=513695&web_version=7.5.0&da_version=3.3.17&aigc_features=app_lip_sync"

export interface JimengSubjectsQuery {
  cursor?: number
  limit?: number
}

export interface JimengSubjectItem {
  subjectId: string | null
  name: string | null
  description: string | null
  status: string | number | null
  createTime: string | number | null
  updateTime: string | number | null
  coverImageUri: string | null
  coverImageUrl: string | null
  imageUris: string[]
  voiceIds: string[]
}

export interface JimengSubjectsResult {
  endpoint: "/mweb/v1/dreamina_subject/get"
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  subjects: JimengSubjectItem[]
  hasMore: boolean | null
  nextCursor: number | null
  body: JsonValue
}

export function buildJimengSubjectsRequest(query: JimengSubjectsQuery = {}): JsonObject {
  const cursor = normalizeCursor(query.cursor)
  const limit = normalizeLimit(query.limit)
  return { cursor, limit }
}

export async function fetchJimengSubjects(input: {
  client?: JimengClient
  session: JimengSessionBundle
  query?: JimengSubjectsQuery
}): Promise<JimengSubjectsResult> {
  const request = buildJimengSubjectsRequest(input.query)
  const client = input.client ?? new JimengClient()
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/dreamina_subject/get?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildSubjectsHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body)
  const data = asRecord(asRecord(body)?.data)

  return {
    endpoint: "/mweb/v1/dreamina_subject/get",
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    subjects: subjectsValue(body),
    hasMore: booleanValue(data?.has_more) ?? booleanValue(data?.hasMore),
    nextCursor: numberValue(data?.next_cursor) ?? numberValue(data?.nextCursor),
    body,
  }
}

export function summarizeJimengSubjects(result: JimengSubjectsResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    subject_count: result.subjects.length,
    has_more: result.hasMore,
    next_cursor: result.nextCursor,
    subjects: result.subjects.map((subject) => ({
      subject_id: subject.subjectId,
      name: subject.name,
      description: subject.description,
      status: subject.status,
      create_time: subject.createTime,
      update_time: subject.updateTime,
      cover_image_uri: subject.coverImageUri,
      cover_image_url_present: !!subject.coverImageUrl,
      image_uris: subject.imageUris,
      image_count: subject.imageUris.length,
      voice_ids: subject.voiceIds,
      voice_count: subject.voiceIds.length,
    })),
  }
}

function subjectsValue(body: JsonValue): JimengSubjectItem[] {
  const root = asRecord(body)
  const data = asRecord(root?.data)
  const candidates = [
    asArray(data?.data_list),
    asArray(data?.dataList),
    asArray(data?.subject_list),
    asArray(data?.subjectList),
    asArray(data?.subjects),
  ].find((entries) => entries.length > 0) ?? []

  return candidates.map(parseSubject).filter((subject): subject is JimengSubjectItem => !!subject)
}

function parseSubject(value: JsonValue): JimengSubjectItem | null {
  const subject = asRecord(value)
  if (!subject) return null
  const subjectData = asRecord(subject.subject_data) ?? asRecord(subject.subjectData) ?? subject
  const cover = asRecord(subjectData.cover)
    ?? asRecord(subjectData.cover_image)
    ?? asRecord(subjectData.coverImage)
    ?? asRecord(subjectData.avatar)
    ?? asRecord(subjectData.image)
  const imageUris = collectImageUris(subjectData)
  const voiceIds = collectVoiceIds(subjectData)

  return {
    subjectId: stringValue(subjectData.subject_id)
      ?? stringValue(subjectData.subjectId)
      ?? stringValue(subjectData.id)
      ?? stringValue(subject.id),
    name: stringValue(subjectData.name)
      ?? stringValue(subjectData.title)
      ?? stringValue(subject.name)
      ?? stringValue(subject.title),
    description: stringValue(subjectData.description)
      ?? stringValue(subjectData.desc)
      ?? stringValue(subject.description)
      ?? stringValue(subject.desc),
    status: stringOrNumber(subjectData.status) ?? stringOrNumber(subject.status),
    createTime: stringOrNumber(subjectData.create_time)
      ?? stringOrNumber(subjectData.createTime)
      ?? stringOrNumber(subject.create_time)
      ?? stringOrNumber(subject.createTime),
    updateTime: stringOrNumber(subjectData.update_time)
      ?? stringOrNumber(subjectData.updateTime)
      ?? stringOrNumber(subject.update_time)
      ?? stringOrNumber(subject.updateTime),
    coverImageUri: stringValue(cover?.image_uri)
      ?? stringValue(cover?.imageUri)
      ?? stringValue(cover?.uri)
      ?? stringValue(subjectData.cover_image_uri)
      ?? stringValue(subjectData.coverImageUri),
    coverImageUrl: stringValue(cover?.image_url)
      ?? stringValue(cover?.imageUrl)
      ?? stringValue(cover?.url)
      ?? stringValue(subjectData.cover_image_url)
      ?? stringValue(subjectData.coverImageUrl),
    imageUris,
    voiceIds,
  }
}

function collectImageUris(subject: JsonObject): string[] {
  const seen = new Set<string>()
  const add = (value: JsonValue | undefined) => {
    const text = stringValue(value)
    if (text?.startsWith("tos-cn-i-")) seen.add(text)
  }
  add(subject.image_uri)
  add(subject.imageUri)
  add(subject.cover_image_uri)
  add(subject.coverImageUri)

  for (const key of ["image_list", "imageList", "images", "materials", "material_list", "materialList"]) {
    for (const entry of asArray(subject[key])) {
      const image = asRecord(entry)
      if (!image) continue
      add(image.image_uri)
      add(image.imageUri)
      add(image.uri)
      const nested = asRecord(image.image) ?? asRecord(image.material) ?? asRecord(image.cover)
      add(nested?.image_uri)
      add(nested?.imageUri)
      add(nested?.uri)
    }
  }

  return [...seen]
}

function collectVoiceIds(subject: JsonObject): string[] {
  const seen = new Set<string>()
  const add = (value: JsonValue | undefined) => {
    const text = stringValue(value)
    if (text) seen.add(text)
  }
  add(subject.voice_id)
  add(subject.voiceId)
  add(subject.tone_id)
  add(subject.toneId)

  for (const key of ["voice_list", "voiceList", "voices", "tones", "tone_list", "toneList"]) {
    for (const entry of asArray(subject[key])) {
      const voice = asRecord(entry)
      if (!voice) continue
      add(voice.voice_id)
      add(voice.voiceId)
      add(voice.tone_id)
      add(voice.toneId)
      add(voice.id)
      const idInfo = asRecord(voice.id_info) ?? asRecord(voice.idInfo)
      add(idInfo?.id)
    }
  }

  return [...seen]
}

function normalizeCursor(value: number | undefined): number {
  if (value === undefined) return 0
  if (!Number.isInteger(value) || value < 0) {
    throw jimengError({
      category: "validation",
      code: "SUBJECT_CURSOR_INVALID",
      message: "--cursor must be a non-negative integer.",
      retryable: false,
      details: { cursor: value },
    })
  }
  return value
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 20
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw jimengError({
      category: "validation",
      code: "SUBJECT_LIMIT_INVALID",
      message: "--limit must be an integer from 1 to 100.",
      retryable: false,
      details: { limit: value },
    })
  }
  return value
}

function buildSubjectsHeaders(session: JimengSessionBundle): Record<string, string> {
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

function assertJimengSuccess(body: JsonValue): void {
  const ret = retValue(body)
  if (ret === "0" || ret === 0) return
  throw jimengError({
    category: "upstream",
    code: "JIMENG_API_REJECTED",
    message: `subjects request failed (ret=${String(ret ?? "unknown")}, errmsg=${errmsgValue(body) ?? "unknown"})`,
    retryable: false,
    details: { ret, errmsg: errmsgValue(body) },
  })
}

function retValue(body: JsonValue): string | number | null {
  const value = asRecord(body)?.ret
  return typeof value === "string" || typeof value === "number" ? value : null
}

function errmsgValue(body: JsonValue): string | null {
  return stringValue(asRecord(body)?.errmsg)
}

function safeJson(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue
  } catch {
    return value
  }
}

function asRecord(value: JsonValue | undefined): JsonObject | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function stringOrNumber(value: JsonValue | undefined): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null
}

function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanValue(value: JsonValue | undefined): boolean | null {
  return typeof value === "boolean" ? value : null
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
