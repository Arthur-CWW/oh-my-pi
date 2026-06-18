import { createHash } from "node:crypto"
import { Schema } from "effect"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient, type JimengFetch } from "./client"
import { jimengError } from "./errors"
import { parseImageUri, type JsonObject, type JsonValue } from "./reference-image"
import { type JimengImageUploadSummary } from "./upload"

const DEFAULT_QUERY = "aid=513695&web_version=7.5.0&da_version=3.3.17&aigc_features=app_lip_sync"
const DEFAULT_WEB_ID = "7647092336736290330"

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))
const SubjectVoiceRequestSchema = Schema.Struct({
  image_uri: NonEmptyString,
})

export interface JimengSubjectsQuery {
  cursor?: number
  limit?: number
  keyword?: string
  subjectIds?: string[]
  onlyFavorite?: boolean
  workspaceId?: number
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

export interface JimengSubjectImageReference {
  imageUri: string
  width: number
  height: number
  imageUrl?: string
}

export interface JimengSubjectCreateInput {
  name: string
  description?: string
  workspaceId: number
  mainImage: JimengSubjectImageReference
}

export interface JimengSubjectContentInput {
  name?: string
  description?: string
  mainImage?: JimengSubjectImageReference
}

export interface JimengSubjectCreateResult {
  endpoint: "/mweb/v1/dreamina_subject/create"
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  subject: JimengSubjectItem | null
  subjectId: string | null
  dataId: string | null
  body: JsonValue
}

export interface JimengSubjectUpdateInput {
  subjectId: string
  content: JimengSubjectContentInput
}

export interface JimengSubjectUpdateResult {
  endpoint: "/mweb/v1/dreamina_subject/update"
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  subject: JimengSubjectItem | null
  subjectId: string | null
  body: JsonValue
}

export interface JimengSubjectDeleteInput {
  subjectIds: string[]
}

export interface JimengSubjectDeleteResult {
  endpoint: "/mweb/v1/dreamina_subject/delete"
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  deletedSubjectIds: string[]
  body: JsonValue
}

export interface JimengSubjectVoiceInput {
  imageUri: string
}

export interface JimengSubjectVoiceInfo {
  vid: string | null
  audioUrl: string | null
  duration: number | null
  durationMs: number | null
}

export interface JimengSubjectVoiceResult {
  endpoint: "/mweb/v1/dreamina_subject/generate_voice"
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  audioInfo: JimengSubjectVoiceInfo | null
  body: JsonValue
}

export interface JimengImageAuditResult {
  endpoint: "/mweb/v1/imagex/submit_audit_job"
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  body: JsonValue
}

export interface JimengImageByUriItem {
  imageUri: string
  imageUrl: string | null
  width: number | null
  height: number | null
  format: string | null
}

export interface JimengImageByUriResult {
  endpoint: "/mweb/v1/get_image_by_uri"
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  images: JimengImageByUriItem[]
  body: JsonValue
}

export function buildJimengSubjectsRequest(query: JimengSubjectsQuery = {}): JsonObject {
  const cursor = normalizeCursor(query.cursor)
  const limit = normalizeLimit(query.limit)
  const request: JsonObject = { cursor, limit }
  const keyword = normalizeOptionalText(query.keyword)
  if (keyword !== undefined) request.keyword = keyword
  const subjectIds = normalizeSubjectIds(query.subjectIds)
  if (subjectIds.length > 0) request.subject_id_list = subjectIds
  if (query.onlyFavorite !== undefined) request.only_favorite = query.onlyFavorite
  if (query.workspaceId !== undefined) request.workspace_id = normalizeWorkspaceId(query.workspaceId)
  return request
}

export function buildJimengSubjectCreateRequest(input: JimengSubjectCreateInput): JsonObject {
  const workspaceId = normalizeWorkspaceId(input.workspaceId)
  const content = buildJimengSubjectContent({
    name: input.name,
    description: input.description,
    mainImage: input.mainImage,
  })

  return {
    content,
    workspace_id: workspaceId,
  }
}

export function buildJimengSubjectContent(input: JimengSubjectContentInput): JsonObject {
  const content: JsonObject = {}
  if (input.name !== undefined) content.name = normalizeSubjectName(input.name)
  if (input.description !== undefined) content.description = input.description
  if (input.mainImage) content.main_image = buildJimengSubjectMainImage(input.mainImage)
  if (Object.keys(content).length === 0) {
    throw jimengError({
      category: "validation",
      code: "SUBJECT_CONTENT_REQUIRED",
      message: "Subject content must include at least one editable field.",
      retryable: false,
    })
  }
  return content
}

export function buildJimengSubjectMainImage(reference: JimengSubjectImageReference): JsonObject {
  const image = normalizeSubjectImageReference(reference)
  const mainImage: JsonObject = {
    width: image.width,
    height: image.height,
    image_uri: image.imageUri,
  }
  if (image.imageUrl) mainImage.image_url = image.imageUrl
  return mainImage
}

export function buildJimengSubjectUpdateRequest(input: JimengSubjectUpdateInput): JsonObject {
  return {
    subject_id: normalizeSubjectId(input.subjectId),
    content: buildJimengSubjectContent(input.content),
  }
}

export function buildJimengSubjectDeleteRequest(input: JimengSubjectDeleteInput): JsonObject {
  const subjectIds = normalizeSubjectIds(input.subjectIds)
  if (subjectIds.length === 0) {
    throw jimengError({
      category: "validation",
      code: "SUBJECT_DELETE_IDS_REQUIRED",
      message: "At least one subject id is required for subject delete.",
      retryable: false,
    })
  }
  return subjectIds.length === 1 ? { subject_id: subjectIds[0] } : { subject_id_list: subjectIds }
}

export function buildJimengSubjectVoiceRequest(input: JimengSubjectVoiceInput): JsonObject {
  const request = { image_uri: parseImageUri(input.imageUri) }
  validateJimengSubjectVoiceRequest(request)
  return request
}

export function validateJimengSubjectVoiceRequest(request: JsonObject): void {
  decodeSubjectContract(SubjectVoiceRequestSchema, request, "Jimeng subject voice request")
}

export async function fetchJimengSubjects(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  query?: JimengSubjectsQuery
}): Promise<JimengSubjectsResult> {
  const request = buildJimengSubjectsRequest(input.query)
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
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

export async function submitJimengImageAuditJob(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  imageUris: string[]
}): Promise<JimengImageAuditResult> {
  const imageUris = input.imageUris.map(parseImageUri)
  if (imageUris.length === 0) {
    throw jimengError({
      category: "validation",
      code: "IMAGE_AUDIT_URIS_REQUIRED",
      message: "At least one provider image URI is required for image audit.",
      retryable: false,
    })
  }
  const request = { uri_list: imageUris }
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/imagex/submit_audit_job?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildSubjectsHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "image audit")

  return {
    endpoint: "/mweb/v1/imagex/submit_audit_job",
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    body,
  }
}

export async function fetchJimengImagesByUri(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  imageUris: string[]
}): Promise<JimengImageByUriResult> {
  const imageUris = input.imageUris.map(parseImageUri)
  if (imageUris.length === 0) {
    throw jimengError({
      category: "validation",
      code: "IMAGE_LOOKUP_URIS_REQUIRED",
      message: "At least one provider image URI is required for image lookup.",
      retryable: false,
    })
  }
  const request = { uris: imageUris }
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const response = await client.requestText(buildGetImageByUriUrl(input.session), {
    method: "POST",
    headers: buildSubjectsHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "image lookup")

  return {
    endpoint: "/mweb/v1/get_image_by_uri",
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    images: imageByUriItems(body, imageUris),
    body,
  }
}

export async function createJimengSubject(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  subject: JimengSubjectCreateInput
}): Promise<JimengSubjectCreateResult> {
  const request = buildJimengSubjectCreateRequest(input.subject)
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/dreamina_subject/create?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildSubjectsHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "subject create")
  const data = asRecord(asRecord(body)?.data)
  const subject = parseSubject(data) ?? null

  return {
    endpoint: "/mweb/v1/dreamina_subject/create",
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    subject,
    subjectId: stringValue(data?.subject_id) ?? subject?.subjectId ?? null,
    dataId: stringValue(data?.data_id),
    body,
  }
}

export async function updateJimengSubject(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  subject: JimengSubjectUpdateInput
}): Promise<JimengSubjectUpdateResult> {
  const request = buildJimengSubjectUpdateRequest(input.subject)
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/dreamina_subject/update?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildSubjectsHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "subject update")
  const data = asRecord(asRecord(body)?.data)
  const subject = parseSubject(data) ?? null

  return {
    endpoint: "/mweb/v1/dreamina_subject/update",
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    subject,
    subjectId: stringValue(data?.subject_id) ?? subject?.subjectId ?? stringValue(request.subject_id),
    body,
  }
}

export async function deleteJimengSubjects(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  subjectIds: string[]
}): Promise<JimengSubjectDeleteResult> {
  const request = buildJimengSubjectDeleteRequest({ subjectIds: input.subjectIds })
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/dreamina_subject/delete?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildSubjectsHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "subject delete")

  return {
    endpoint: "/mweb/v1/dreamina_subject/delete",
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    deletedSubjectIds: normalizeSubjectIds(input.subjectIds),
    body,
  }
}

export async function generateJimengSubjectVoice(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  imageUri: string
}): Promise<JimengSubjectVoiceResult> {
  const request = buildJimengSubjectVoiceRequest({ imageUri: input.imageUri })
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/dreamina_subject/generate_voice?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildSubjectsHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "subject voice generation")

  return {
    endpoint: "/mweb/v1/dreamina_subject/generate_voice",
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    audioInfo: subjectVoiceInfo(body),
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

export function summarizeJimengSubjectCreate(result: JimengSubjectCreateResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: redactSubjectCreateRequest(result.request),
    subject_id: result.subjectId,
    data_id: result.dataId,
    subject: result.subject ? {
      subject_id: result.subject.subjectId,
      name: result.subject.name,
      description: result.subject.description,
      status: result.subject.status,
      create_time: result.subject.createTime,
      update_time: result.subject.updateTime,
      cover_image_uri: result.subject.coverImageUri,
      cover_image_url_present: !!result.subject.coverImageUrl,
      image_uris: result.subject.imageUris,
      image_count: result.subject.imageUris.length,
      voice_ids: result.subject.voiceIds,
      voice_count: result.subject.voiceIds.length,
    } : null,
  }
}

export function summarizeJimengSubjectUpdate(result: JimengSubjectUpdateResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: redactSubjectContentRequest(result.request),
    subject_id: result.subjectId,
    subject: result.subject ? summarizeSubject(result.subject) : null,
  }
}

export function summarizeJimengSubjectDelete(result: JimengSubjectDeleteResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    deleted_subject_ids: result.deletedSubjectIds,
    deleted_subject_count: result.deletedSubjectIds.length,
  }
}

export function summarizeJimengSubjectVoice(result: JimengSubjectVoiceResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    audio_info: result.audioInfo ? {
      vid: result.audioInfo.vid,
      audio_url_present: !!result.audioInfo.audioUrl,
      duration: result.audioInfo.duration,
      duration_ms: result.audioInfo.durationMs,
    } : null,
  }
}

export function summarizeJimengImageByUri(result: JimengImageByUriResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    images: result.images.map((image) => ({
      image_uri: image.imageUri,
      image_url_present: !!image.imageUrl,
      width: image.width,
      height: image.height,
      format: image.format,
    })),
  }
}

export function subjectImageReferenceFromUploadSummary(
  summary: JimengImageUploadSummary,
  imageUrl?: string,
): JimengSubjectImageReference {
  const plugin = summary.pluginResults.find((item) => item.imageUri === summary.imageUris[0]) ?? summary.pluginResults[0]
  const imageUri = summary.imageUris[0] ?? plugin?.imageUri
  const width = plugin?.imageWidth
  const height = plugin?.imageHeight
  if (!imageUri || !width || !height) {
    throw jimengError({
      category: "validation",
      code: "SUBJECT_IMAGE_UPLOAD_MISSING_DIMENSIONS",
      message: "Image upload summary missing subject image URI, width, or height.",
      retryable: false,
      details: {
        imageUriPresent: !!imageUri,
        widthPresent: !!width,
        heightPresent: !!height,
      },
    })
  }
  return normalizeSubjectImageReference({ imageUri, width, height, ...(imageUrl ? { imageUrl } : {}) })
}

export function normalizeSubjectImageReference(reference: JimengSubjectImageReference): JimengSubjectImageReference {
  const imageUri = parseImageUri(reference.imageUri)
  if (!Number.isInteger(reference.width) || reference.width < 1) {
    throw jimengError({
      category: "validation",
      code: "SUBJECT_IMAGE_WIDTH_INVALID",
      message: "Subject image width must be a positive integer.",
      retryable: false,
      details: { width: reference.width },
    })
  }
  if (!Number.isInteger(reference.height) || reference.height < 1) {
    throw jimengError({
      category: "validation",
      code: "SUBJECT_IMAGE_HEIGHT_INVALID",
      message: "Subject image height must be a positive integer.",
      retryable: false,
      details: { height: reference.height },
    })
  }
  return {
    imageUri,
    width: reference.width,
    height: reference.height,
    ...(reference.imageUrl ? { imageUrl: reference.imageUrl } : {}),
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
  const subjectData = asRecord(subject.subject_data) ?? asRecord(subject.subjectData) ?? asRecord(subject.content) ?? subject
  const subjectControl = asRecord(subject.subject_control) ?? asRecord(subject.subjectControl)
  const cover = asRecord(subjectData.cover)
    ?? asRecord(subjectData.cover_image)
    ?? asRecord(subjectData.coverImage)
    ?? asRecord(subjectData.avatar)
    ?? asRecord(subjectData.main_image)
    ?? asRecord(subjectData.mainImage)
    ?? asRecord(subjectData.image)
  const imageUris = collectImageUris(subjectData)
  const voiceIds = collectVoiceIds(subjectData)

  return {
    subjectId: stringValue(subjectData.subject_id)
      ?? stringValue(subjectData.subjectId)
      ?? stringValue(subjectData.id)
      ?? stringValue(subject.subject_id)
      ?? stringValue(subject.subjectId)
      ?? stringValue(subject.id),
    name: stringValue(subjectData.name)
      ?? stringValue(subjectData.title)
      ?? stringValue(subject.name)
      ?? stringValue(subject.title),
    description: stringValue(subjectData.description)
      ?? stringValue(subjectData.desc)
      ?? stringValue(subject.description)
      ?? stringValue(subject.desc),
    status: stringOrNumber(subjectData.status) ?? stringOrNumber(subject.status) ?? stringOrNumber(subjectControl?.status),
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

function summarizeSubject(subject: JimengSubjectItem): JsonObject {
  return {
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
  const mainImage = asRecord(subject.main_image) ?? asRecord(subject.mainImage)
  add(mainImage?.image_uri)
  add(mainImage?.imageUri)
  add(mainImage?.uri)

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

function imageByUriItems(body: JsonValue, requestedUris: string[]): JimengImageByUriItem[] {
  const root = asRecord(body)
  const map = asRecord(root?.uri2image) ?? asRecord(asRecord(root?.data)?.uri2image)
  return requestedUris.map((uri) => {
    const image = asRecord(map?.[uri])
    return {
      imageUri: stringValue(image?.image_uri) ?? stringValue(image?.imageUri) ?? uri,
      imageUrl: stringValue(image?.image_url) ?? stringValue(image?.imageUrl),
      width: positiveNumberValue(image?.width),
      height: positiveNumberValue(image?.height),
      format: stringValue(image?.format),
    }
  })
}

function normalizeSubjectName(value: string): string {
  const name = value.trim()
  if (name.length < 1 || name.length > 20) {
    throw jimengError({
      category: "validation",
      code: "SUBJECT_NAME_INVALID",
      message: "Subject name must be 1 to 20 characters.",
      retryable: false,
      details: { length: name.length },
    })
  }
  return name
}

function normalizeSubjectId(value: string | undefined): string {
  const subjectId = value?.trim()
  if (!subjectId) {
    throw jimengError({
      category: "validation",
      code: "SUBJECT_ID_REQUIRED",
      message: "A subject id is required.",
      retryable: false,
    })
  }
  return subjectId
}

function normalizeSubjectIds(values: string[] | undefined): string[] {
  if (!values) return []
  const seen = new Set<string>()
  for (const value of values) {
    const subjectId = normalizeSubjectId(value)
    seen.add(subjectId)
  }
  return [...seen]
}

function normalizeWorkspaceId(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw jimengError({
      category: "validation",
      code: "SUBJECT_WORKSPACE_ID_INVALID",
      message: "Subject workspace id must be a positive integer.",
      retryable: false,
      details: { workspaceId: value },
    })
  }
  return value
}

function redactSubjectCreateRequest(request: JsonObject): JsonObject {
  return redactSubjectContentRequest(request)
}

function redactSubjectContentRequest(request: JsonObject): JsonObject {
  const content = asRecord(request.content)
  const mainImage = asRecord(content?.main_image)
  const redactedContent: JsonObject = { ...(content ?? {}) }
  if (mainImage) {
    const redactedMainImage: JsonObject = {
      ...mainImage,
      image_url_present: !!mainImage.image_url,
    }
    if (mainImage.image_url) redactedMainImage.image_url = "[SIGNED_URL_REDACTED]"
    redactedContent.main_image = redactedMainImage
  }
  return {
    ...request,
    content: redactedContent,
  }
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const text = value.trim()
  return text ? text : undefined
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

function subjectVoiceInfo(body: JsonValue): JimengSubjectVoiceInfo | null {
  const root = asRecord(body)
  const data = asRecord(root?.data)
  const audioInfo = asRecord(data?.audio_info)
    ?? asRecord(data?.audioInfo)
    ?? asRecord(root?.audio_info)
    ?? asRecord(root?.audioInfo)
    ?? data
  if (!audioInfo) return null
  return {
    vid: stringValue(audioInfo.vid) ?? stringValue(audioInfo.id),
    audioUrl: stringValue(audioInfo.audio_url) ?? stringValue(audioInfo.audioUrl) ?? stringValue(audioInfo.url),
    duration: numberValue(audioInfo.duration),
    durationMs: numberValue(audioInfo.duration_ms) ?? numberValue(audioInfo.durationMs),
  }
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

function buildGetImageByUriUrl(session: JimengSessionBundle): string {
  const params = new URLSearchParams(DEFAULT_QUERY)
  params.set("device_platform", "web")
  params.set("region", "CN")
  params.set("web_id", extractCookieValue(session.cookie, "_tea_web_id") ?? session.webId ?? DEFAULT_WEB_ID)
  return `https://jimeng.jianying.com/mweb/v1/get_image_by_uri?${params.toString()}`
}

function extractCookieValue(cookie: string, name: string): string | null {
  const parts = cookie.split(";")
  for (const part of parts) {
    const [rawKey, ...rawValue] = part.trim().split("=")
    if (rawKey === name) return decodeURIComponent(rawValue.join("="))
  }
  return null
}

function decodeSubjectContract<A>(schema: Schema.Decoder<A>, value: JsonValue, operation: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "validation",
      code: "JIMENG_SUBJECT_CONTRACT_CHANGED",
      message: `${operation} did not match required fields.`,
      retryable: false,
      details: { operation, error: message },
    })
  }
}

function assertJimengSuccess(body: JsonValue, operation = "subjects request"): void {
  const ret = retValue(body)
  if (ret === "0" || ret === 0) return
  throw jimengError({
    category: "upstream",
    code: "JIMENG_API_REJECTED",
    message: `${operation} failed (ret=${String(ret ?? "unknown")}, errmsg=${errmsgValue(body) ?? "unknown"})`,
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

function positiveNumberValue(value: JsonValue | undefined): number | null {
  const number = numberValue(value)
  return number && number > 0 ? number : null
}

function booleanValue(value: JsonValue | undefined): boolean | null {
  return typeof value === "boolean" ? value : null
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
