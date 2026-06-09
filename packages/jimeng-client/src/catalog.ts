import { createHash, randomUUID } from "node:crypto"
import { type CaptureFile, type CaptureRequestEntry, type JimengSessionBundle, buildHeaders } from "./capture"
import { assertNoRiskError, JimengClient } from "./client"
import { jimengError } from "./errors"

const DEFAULT_QUERY = "aid=513695&web_version=7.5.0&da_version=3.3.17&aigc_features=app_lip_sync"
const DEFAULT_WEB_ID = "7647092336736290330"

export type JimengCatalogEndpointId =
  | "skill-list"
  | "agent-config"
  | "voice-assets"
  | "lip-sync-image-config"
  | "lip-sync-video-config"
  | "subject-list"

export interface JimengCatalogEndpoint {
  id: JimengCatalogEndpointId
  method: "POST"
  path: string
  body: Record<string, unknown>
  description: string
  direct: boolean
}

export interface JimengCatalogProbeResult {
  endpoint: JimengCatalogEndpointId
  description: string
  url: string
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  summary: Record<string, unknown>
  body: unknown
}

export interface JimengVoiceCatalogItem {
  id: string
  title: string
  itemPlatform: number
  effectType: number | null
  lokiEffectId: string | null
  speakerId: string | null
  tags: Array<{ type: string; value: string }>
  emotions: Array<{ emotion: string; speakerId: string }>
}

export interface JimengTtsInput {
  text: string
  voiceId: string
  itemPlatform?: number
  speed?: number
  emotion?: string
  emotionScale?: number
}

export interface JimengTtsResult {
  voiceId: string
  itemPlatform: number
  text: string
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  audioBytes: Uint8Array
  body: unknown
}

export const JIMENG_CATALOG_ENDPOINTS: readonly JimengCatalogEndpoint[] = [
  {
    id: "skill-list",
    method: "POST",
    path: `/mweb/v1/creation_agent/v2/skill/list?${DEFAULT_QUERY}`,
    body: { offset: 0, limit: 300, need_official_skills: true },
    description: "Agent skill list: story short, ecommerce set, poster, brand design.",
    direct: true,
  },
  {
    id: "agent-config",
    method: "POST",
    path: `/mweb/v1/creation_agent/v2/get_agent_config?needCache=true&needRefresh=false&${DEFAULT_QUERY}`,
    body: {},
    description: "Image/video model catalog, feature flags, model request keys, and agent config.",
    direct: true,
  },
  {
    id: "voice-assets",
    method: "POST",
    path: `/mweb/v1/get_user_local_item_list?aid=513695&device_platform=web&region=CN&web_id=${DEFAULT_WEB_ID}&web_version=7.5.0&da_version=3.3.17&aigc_features=app_lip_sync`,
    body: {
      offset: 0,
      count: 50,
      effect_type: 218,
      filter_opt: { clone_voice_status: [1, 2] },
      pack_local_item_opt: { need_favorite_info: true },
    },
    description: "Current user's cloned voice assets. Empty is valid when no voices have been cloned.",
    direct: true,
  },
  {
    id: "lip-sync-image-config",
    method: "POST",
    path: `/mweb/v1/video_generate/get_common_config?${DEFAULT_QUERY}`,
    body: { scene: "lip_sync_image_generate_video", params: {} },
    description: "Digital-human/lip-sync from image model config.",
    direct: true,
  },
  {
    id: "lip-sync-video-config",
    method: "POST",
    path: `/mweb/v1/video_generate/get_common_config?${DEFAULT_QUERY}`,
    body: { scene: "lip_sync_video_generate_video", params: {} },
    description: "Lip-sync from video model config.",
    direct: true,
  },
  {
    id: "subject-list",
    method: "POST",
    path: `/mweb/v1/dreamina_subject/get?${DEFAULT_QUERY}`,
    body: { cursor: 0, limit: 20 },
    description: "Saved subject/persona list.",
    direct: true,
  },
]

export function parseCatalogEndpointIds(value: string | undefined): JimengCatalogEndpointId[] {
  if (!value || value === "all") return JIMENG_CATALOG_ENDPOINTS.map((endpoint) => endpoint.id)
  const ids = value.split(",").map((part) => part.trim()).filter(Boolean)
  const known = new Set(JIMENG_CATALOG_ENDPOINTS.map((endpoint) => endpoint.id))
  for (const id of ids) {
    if (!known.has(id as JimengCatalogEndpointId)) {
      throw jimengError({
        category: "validation",
        code: "UNKNOWN_CATALOG_ENDPOINT",
        message: `Unknown Jimeng catalog endpoint: ${id}`,
        retryable: false,
        details: { valid: [...known] },
      })
    }
  }
  return ids as JimengCatalogEndpointId[]
}

export async function runCatalogProbe(input: {
  client?: JimengClient
  session: JimengSessionBundle
  endpointIds?: JimengCatalogEndpointId[]
}): Promise<JimengCatalogProbeResult[]> {
  const client = input.client ?? new JimengClient()
  const requested = new Set(input.endpointIds ?? JIMENG_CATALOG_ENDPOINTS.map((endpoint) => endpoint.id))
  const results: JimengCatalogProbeResult[] = []

  for (const endpoint of JIMENG_CATALOG_ENDPOINTS) {
    if (!requested.has(endpoint.id)) continue
    const url = new URL(endpoint.path, "https://jimeng.jianying.com").toString()
    const response = await client.requestText(url, {
      method: endpoint.method,
      headers: buildCatalogHeaders(input.session),
      body: JSON.stringify(endpoint.body),
    })
    const body = safeJson(response.text)
    assertNoRiskError(body, response.text)
    assertJimengSuccess(body, endpoint.id)
    results.push({
      endpoint: endpoint.id,
      description: endpoint.description,
      url,
      httpStatus: response.status,
      ret: retValue(body),
      errmsg: errmsgValue(body),
      responseTextSha256: sha256(response.text),
      summary: summarizeCatalogBody(endpoint.id, body),
      body,
    })
  }

  return results
}

export function findVoiceLibraryRequest(capture: CaptureFile): CaptureRequestEntry | undefined {
  return capture.entries.find((entry) =>
    entry.kind === "request"
    && typeof entry.url === "string"
    && entry.url.includes("/mweb/v1/feed")
    && typeof entry.postData === "string"
    && entry.postData.includes("dreamina_tone")
  )
}

export async function fetchVoiceLibraryFromCapture(input: {
  client?: JimengClient
  session: JimengSessionBundle
  capture: CaptureFile
}): Promise<{ request: CaptureRequestEntry; body: unknown; voices: JimengVoiceCatalogItem[]; responseTextSha256: string; httpStatus: number }> {
  const request = findVoiceLibraryRequest(input.capture)
  if (!request?.url || !request.postData) {
    throw jimengError({
      category: "validation",
      code: "VOICE_LIBRARY_REQUEST_MISSING",
      message: "Capture does not contain a signed /mweb/v1/feed dreamina_tone request",
      retryable: false,
    })
  }

  const client = input.client ?? new JimengClient()
  const response = await client.requestText(request.url, {
    method: "POST",
    headers: buildVoiceFeedHeaders(request, input.session),
    body: request.postData,
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "voice-library")
  return {
    request,
    body,
    voices: parseVoiceLibrary(body),
    responseTextSha256: sha256(response.text),
    httpStatus: response.status,
  }
}

export async function generateTextToSpeech(input: {
  client?: JimengClient
  session: JimengSessionBundle
  tts: JimengTtsInput
}): Promise<JimengTtsResult> {
  const client = input.client ?? new JimengClient()
  const itemPlatform = input.tts.itemPlatform ?? 1
  const response = await client.requestText(`https://jimeng.jianying.com/mweb/v1/tts_generate?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: {
      ...buildCatalogHeaders(input.session),
      ch: "online",
    },
    body: JSON.stringify(buildTtsBody({ ...input.tts, itemPlatform })),
  })
  const body = safeJson(response.text)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "tts")
  const audio = extractTtsAudio(body)
  return {
    voiceId: input.tts.voiceId,
    itemPlatform,
    text: input.tts.text,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    audioBytes: audio,
    body,
  }
}

export function getDefaultVoiceLibraryCapturePath(): string {
  return "data/jimeng-captures/20260603090356-home-session-smoke/capture-template.raw.json"
}

export function summarizeVoiceLibrary(voices: JimengVoiceCatalogItem[]): Record<string, unknown> {
  const byLanguage = countTags(voices, "language")
  const byGender = countTags(voices, "gender")
  const byAccent = countTags(voices, "accent")
  return {
    total: voices.length,
    by_language: byLanguage,
    by_gender: byGender,
    by_accent: byAccent,
    sample: voices.slice(0, 12),
  }
}

function buildCatalogHeaders(session: JimengSessionBundle): Record<string, string> {
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

function buildVoiceFeedHeaders(request: CaptureRequestEntry, session: JimengSessionBundle): Record<string, string> {
  return {
    ...buildHeaders(request, session),
    accept: "application/json, text/plain, */*",
    lan: "zh-Hans",
    pf: "7",
    loc: "cn",
    appid: "513695",
    appvr: "8.4.0",
    "app-sdk-version": "48.0.0",
  }
}

function buildTtsBody(input: JimengTtsInput & { itemPlatform: number }): Record<string, unknown> {
  const speed = input.speed ?? 1
  const audioConfig: Record<string, unknown> = {
    format: "mp3",
    pitch_rate: 0,
    sample_rate: 24_000,
    speech_rate: Math.round((speed - 1) * 100),
  }
  if (input.emotion) audioConfig.emotion = input.emotion
  if (typeof input.emotionScale === "number") audioConfig.emotion_scale = input.emotionScale

  return {
    text: input.text,
    id_info: {
      id: input.voiceId,
      item_platform: input.itemPlatform,
    },
    audio_config: audioConfig,
  }
}

function parseVoiceLibrary(body: unknown): JimengVoiceCatalogItem[] {
  const root = asRecord(body)
  const data = asRecord(root?.data)
  const items = asArray(data?.item_list)
  return items.flatMap((item) => {
    const common = asRecord(asRecord(item)?.common_attr)
    const id = stringValue(common?.id)
    const title = stringValue(common?.title)
    if (!common || !id || !title) return []

    const tone = parseToneType(common)
    return [{
      id,
      title,
      itemPlatform: 1,
      effectType: numberValue(common?.effect_type),
      lokiEffectId: stringValue(common?.loki_effect_id),
      speakerId: stringValue(asRecord(asRecord(tone.tts_model_info_map)?.tts_model_v3)?.speaker_id),
      tags: parseTags(tone.tag_list),
      emotions: parseEmotions(asRecord(asRecord(tone.tts_model_info_map)?.tts_model_v3)?.emotion),
    }]
  })
}

function parseToneType(common: Record<string, unknown>): Record<string, unknown> {
  const webExtraText = stringValue(common.web_extra)
  const webExtra = webExtraText ? asRecord(safeJson(webExtraText)) : null
  const toneText = stringValue(webExtra?.tonetype)
  return toneText ? asRecord(safeJson(toneText)) ?? {} : {}
}

function parseTags(value: unknown): Array<{ type: string; value: string }> {
  return asArray(value).flatMap((entry) => {
    const record = asRecord(entry)
    const type = stringValue(record?.type)
    const tagValue = stringValue(record?.value)
    return type && tagValue ? [{ type, value: tagValue }] : []
  })
}

function parseEmotions(value: unknown): Array<{ emotion: string; speakerId: string }> {
  return asArray(value).flatMap((entry) => {
    const record = asRecord(entry)
    const emotion = stringValue(record?.emotion)
    const speakerId = stringValue(record?.speaker_id)
    return emotion && speakerId ? [{ emotion, speakerId }] : []
  })
}

function extractTtsAudio(body: unknown): Uint8Array {
  const data = asRecord(asRecord(body)?.data)
  const encoded = stringValue(data?.data)
  if (!encoded) {
    throw jimengError({
      category: "upstream",
      code: "TTS_AUDIO_MISSING",
      message: "TTS response did not include data.data base64 audio",
      retryable: false,
      details: { ret: retValue(body), errmsg: errmsgValue(body) },
    })
  }
  return new Uint8Array(Buffer.from(encoded, "base64"))
}

function assertJimengSuccess(body: unknown, operation: string): void {
  const ret = retValue(body)
  if (ret === "0" || ret === 0) return
  throw jimengError({
    category: "upstream",
    code: "JIMENG_API_REJECTED",
    message: `${operation} failed (ret=${String(ret ?? "unknown")}, errmsg=${errmsgValue(body) ?? "unknown"})`,
    retryable: false,
    details: { operation, ret, errmsg: errmsgValue(body) },
  })
}

function summarizeCatalogBody(endpoint: JimengCatalogEndpointId, body: unknown): Record<string, unknown> {
  const data = asRecord(asRecord(body)?.data)
  if (!data) return { ret: retValue(body), errmsg: errmsgValue(body) }

  if (endpoint === "skill-list") {
    return {
      official_skills: asArray(data.official_skills).map(summarizeSkill).filter(isRecord),
      custom_skill_count: numberValue(data.total_count) ?? 0,
    }
  }
  if (endpoint === "agent-config") {
    return {
      image_models: asArray(asRecord(data.image_data)?.model_list).map(summarizeModel).filter(isRecord),
      video_models: asArray(asRecord(data.video_data)?.model_list).map(summarizeModel).filter(isRecord),
    }
  }
  if (endpoint === "voice-assets") {
    return {
      cloned_voice_count: asArray(data.item_list).length,
      has_more: booleanValue(data.has_more),
      next_offset: numberValue(data.next_offset),
    }
  }
  if (endpoint === "lip-sync-image-config" || endpoint === "lip-sync-video-config") {
    return {
      models: asArray(data.model_list).map(summarizeLipSyncModel).filter(isRecord),
      default_model_idx: numberValue(data.default_model_idx),
    }
  }
  if (endpoint === "subject-list") {
    return {
      subject_count: asArray(data.data_list).length,
      has_more: booleanValue(data.has_more),
      next_cursor: numberValue(data.next_cursor),
    }
  }
  return {}
}

function summarizeSkill(value: unknown): Record<string, unknown> | null {
  const skill = asRecord(value)
  if (!skill) return null
  return {
    id: stringValue(skill.id),
    name: stringValue(skill.name),
    title: stringValue(skill.default_title),
    description: stringValue(skill.default_desc),
  }
}

function summarizeModel(value: unknown): Record<string, unknown> | null {
  const model = asRecord(value)
  if (!model) return null
  return {
    model_req_key: stringValue(model.model_req_key),
    model_name: stringValue(model.model_name),
    feats: asArray(model.feats).filter((item): item is string => typeof item === "string"),
    options: asArray(model.options).map((option) => stringValue(asRecord(option)?.key)).filter((item): item is string => !!item),
  }
}

function summarizeLipSyncModel(value: unknown): Record<string, unknown> | null {
  const model = summarizeModel(value)
  const raw = asRecord(value)
  if (!model || !raw) return model
  return {
    ...model,
    model_tip: stringValue(raw.model_tip),
    commercial_config: raw.commercial_config ?? null,
  }
}

function countTags(voices: JimengVoiceCatalogItem[], tagType: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const voice of voices) {
    for (const tag of voice.tags) {
      if (tag.type !== tagType) continue
      counts[tag.value] = (counts[tag.value] ?? 0) + 1
    }
  }
  return counts
}

function retValue(body: unknown): string | number | null {
  const value = asRecord(body)?.ret
  return typeof value === "string" || typeof value === "number" ? value : null
}

function errmsgValue(body: unknown): string | null {
  return stringValue(asRecord(body)?.errmsg)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
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

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

export function newJimengSubmitId(): string {
  return randomUUID()
}
