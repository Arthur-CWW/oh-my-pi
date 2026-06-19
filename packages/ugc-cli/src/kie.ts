import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { JsonValue } from "./types"

type JsonRecord = { [key: string]: JsonValue }
export type KieOperation =
  | "image-text"
  | "image-to-image"
  | "video-text"
  | "image-to-video"
  | "reference-to-video"
  | "avatar"
  | "omni-video"
export interface KieCapability {
  operation: KieOperation
  model: string
  label: string
  family: "image" | "video" | "character"
  estimatedCostUsd: number
  frugal: boolean
  notes: string
}

export interface KieGenerateRequest {
  operation: KieOperation
  prompt: string
  aspectRatio?: string
  durationSec?: number
  resolution?: string
  quality?: "basic" | "standard" | "pro"
  imageUrl?: string
  endImageUrl?: string
  imageUrls?: string[]
  referenceImageUrls?: string[]
  referenceVideoUrls?: string[]
  referenceAudioUrl?: string
  audioUrl?: string
  callBackUrl?: string
  negativePrompt?: string
  seed?: number
  generateAudio?: boolean
  nsfwChecker?: boolean
}

export type KieProductLane = "brainrot" | "ugc-ads"
export type KieAnalysisPlanOperation = "video-text" | "image-text"


export interface KieAnalysisPlanTarget {
  readonly kind: "candidate" | "reference"
  readonly id: string
  readonly title: string
  readonly summary?: string
  readonly lane?: string
  readonly notes?: readonly string[]
  readonly metadata?: JsonValue
}

export interface KieAnalysisPlanInput {
  readonly lane: KieProductLane
  readonly target: KieAnalysisPlanTarget
  readonly codexRequest: JsonValue
  readonly codexResponse?: JsonValue | null
  readonly operation?: KieAnalysisPlanOperation
  readonly aspectRatio?: string
  readonly durationSec?: number
  readonly resolution?: string
  readonly quality?: "basic" | "standard" | "pro"
}

export interface KiePreparedTask {
  provider: "kie"
  endpoint: "POST /api/v1/jobs/createTask"
  model: string
  operation: KieOperation
  estimatedCostUsd: number
  frugal: boolean
  payload: JsonRecord
}

export interface KieCreateOptions {
  apiKey?: string
  envPath?: string
  live?: boolean
  maxSpendUsd?: number
}

export interface KieCreateResult {
  mode: "dry-run" | "live"
  prepared: KiePreparedTask
  taskId?: string
  response?: KieCreateTaskResponse
}

export interface KieCreateTaskResponse {
  code: number
  msg: string
  data?: {
    taskId?: string
  }
}

export interface KieCreditResponse {
  code: number
  msg: string
  data?: number
}

export interface KieTaskRecord {
  taskId?: string
  model?: string
  state?: "waiting" | "queuing" | "generating" | "success" | "fail" | string
  param?: string
  resultJson?: string
  failCode?: string
  failMsg?: string
  costTime?: number
  progress?: number
  creditsConsumed?: number
}

export interface KieTaskDetailResponse {
  code: number
  msg: string
  data?: KieTaskRecord
}

export interface KieTaskDetail {
  taskId: string
  response: KieTaskDetailResponse
  resultUrls: string[]
}

const CREATE_TASK_URL = "https://api.kie.ai/api/v1/jobs/createTask"
const TASK_DETAIL_URL = "https://api.kie.ai/api/v1/jobs/recordInfo"
const CREDIT_URL = "https://api.kie.ai/api/v1/chat/credit"

export const KIE_CAPABILITIES: KieCapability[] = [
  {
    operation: "image-text",
    model: "seedream/5-lite-text-to-image",
    label: "Seedream 5 Lite text-to-image",
    family: "image",
    estimatedCostUsd: 0.02,
    frugal: true,
    notes: "Default persona/reference still generation route. Uses basic quality unless overridden.",
  },
  {
    operation: "image-to-image",
    model: "seedream/5-lite-image-to-image",
    label: "Seedream 5 Lite image-to-image",
    family: "image",
    estimatedCostUsd: 0.03,
    frugal: true,
    notes: "Reference image edits for persona and style exploration.",
  },
  {
    operation: "video-text",
    model: "bytedance/v1-lite-text-to-video",
    label: "ByteDance V1 Lite text-to-video",
    family: "video",
    estimatedCostUsd: 0.18,
    frugal: true,
    notes: "Default cheap motion draft route. Keep duration short while credits are low.",
  },
  {
    operation: "image-to-video",
    model: "bytedance/v1-lite-image-to-video",
    label: "ByteDance V1 Lite image-to-video",
    family: "video",
    estimatedCostUsd: 0.2,
    frugal: true,
    notes: "Animate a persona/reference still. Requires imageUrl.",
  },
  {
    operation: "reference-to-video",
    model: "wan/2-7-r2v",
    label: "Wan 2.7 reference-to-video",
    family: "video",
    estimatedCostUsd: 0.35,
    frugal: false,
    notes: "More capable reference route. Use sparingly for stronger candidates.",
  },
  {
    operation: "avatar",
    model: "kling/ai-avatar-standard",
    label: "Kling avatar standard",
    family: "character",
    estimatedCostUsd: 0.25,
    frugal: false,
    notes: "Talking avatar route. Requires imageUrl and audioUrl.",
  },
  {
    operation: "omni-video",
    model: "gemini-omni-video",
    label: "Gemini Omni video",
    family: "video",
    estimatedCostUsd: 0.45,
    frugal: false,
    notes: "Multimodal route for combined image/video/audio references. Back-burner until a strong use case.",
  },
]

export function prepareKieTask(input: KieGenerateRequest): KiePreparedTask {
  const capability = requiredCapability(input.operation)
  const taskInput = buildInput(input)
  return {
    provider: "kie",
    endpoint: "POST /api/v1/jobs/createTask",
    model: capability.model,
    operation: input.operation,
    estimatedCostUsd: capability.estimatedCostUsd,
    frugal: capability.frugal,
    payload: {
      model: capability.model,
      ...(input.callBackUrl ? { callBackUrl: input.callBackUrl } : {}),
      input: taskInput,
    },
  }
}

export function planKieFromAnalysis(input: KieAnalysisPlanInput): KieGenerateRequest {
  const prompt = [
    `Product lane: ${input.lane}`,
    `Target: ${input.target.kind} ${input.target.id} — ${input.target.title}`,
    input.target.lane ? `Target lane: ${input.target.lane}` : "",
    input.target.summary ? `Target summary: ${input.target.summary}` : "",
    input.target.notes && input.target.notes.length > 0 ? `Target notes: ${input.target.notes.join("; ")}` : "",
    `Original analysis prompt: ${extractCodexPrompt(input.codexRequest) ?? "Summarize reusable UGC mechanics from the selected analysis."}`,
    `Media: ${extractCodexMediaSummary(input.codexRequest)}`,
    `Codex observations: ${extractCodexObservation(input.codexResponse) ?? "No live Codex response is attached yet; make a dry-run generation plan from the request context only."}`,
    "Generate a clean-room UGC concept. Use public/reference material only as inspiration, not as direct generation input. Avoid logos, watermarks, source faces, source voices, and copyrighted text.",
  ].filter((line) => line.length > 0).join("\n")

  return {
    operation: input.operation ?? "video-text",
    prompt,
    aspectRatio: input.aspectRatio ?? "9:16",
    durationSec: input.durationSec ?? 5,
    resolution: input.resolution ?? "720p",
    ...(input.quality ? { quality: input.quality } : {}),
  }
}

export async function createKieTask(input: KieGenerateRequest, options: KieCreateOptions = {}): Promise<KieCreateResult> {
  const prepared = prepareKieTask(input)
  if (!options.live) return { mode: "dry-run", prepared }

  const maxSpendUsd = options.maxSpendUsd ?? 0.25
  if (prepared.estimatedCostUsd > maxSpendUsd) {
    throw new Error(`KIE live request blocked: estimated $${prepared.estimatedCostUsd.toFixed(2)} exceeds max $${maxSpendUsd.toFixed(2)}`)
  }

  const apiKey = resolveKieApiKey(options)
  const response = await fetchJson<KieCreateTaskResponse>(CREATE_TASK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(prepared.payload),
  })
  const taskId = response.data?.taskId
  if (response.code !== 200 || !taskId) {
    throw new Error(`KIE createTask failed: code=${response.code} msg=${response.msg}`)
  }
  return { mode: "live", prepared, taskId, response }
}

export async function getKieTaskDetail(taskId: string, options: KieCreateOptions = {}): Promise<KieTaskDetail> {
  const apiKey = resolveKieApiKey(options)
  const response = await fetchJson<KieTaskDetailResponse>(`${TASK_DETAIL_URL}?taskId=${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  return { taskId, response, resultUrls: extractResultUrls(response.data?.resultJson) }
}

export async function getKieCredits(options: KieCreateOptions = {}): Promise<KieCreditResponse> {
  const apiKey = resolveKieApiKey(options)
  return fetchJson<KieCreditResponse>(CREDIT_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  })
}

export function resolveKieApiKey(options: Pick<KieCreateOptions, "apiKey" | "envPath"> = {}): string {
  const candidate = options.apiKey ?? process.env.KIE_API_KEY ?? readEnvValue(options.envPath, "KIE_API_KEY")
  if (!candidate) throw new Error("Missing KIE_API_KEY. Add it to .env or pass apiKey.")
  return candidate
}

function buildInput(input: KieGenerateRequest): JsonRecord {
  const aspectRatio = input.aspectRatio ?? "9:16"
  const duration = String(input.durationSec ?? 5)
  const nsfwChecker = input.nsfwChecker ?? false

  if (input.operation === "image-text") {
    return {
      prompt: input.prompt,
      aspect_ratio: aspectRatio,
      quality: input.quality ?? "basic",
      nsfw_checker: nsfwChecker,
    }
  }

  if (input.operation === "image-to-image") {
    const imageUrls = nonEmpty(input.imageUrls ?? input.referenceImageUrls ?? (input.imageUrl ? [input.imageUrl] : []), "image-to-image requires imageUrls or imageUrl")
    return {
      prompt: input.prompt,
      image_urls: imageUrls,
      aspect_ratio: aspectRatio,
      quality: input.quality ?? "basic",
      nsfw_checker: input.nsfwChecker ?? true,
    }
  }

  if (input.operation === "video-text") {
    return {
      prompt: input.prompt,
      aspect_ratio: aspectRatio,
      resolution: input.resolution ?? "720 p",
      duration,
      camera_fixed: false,
      seed: input.seed ?? -1,
      enable_safety_checker: true,
      nsfw_checker: nsfwChecker,
    }
  }

  if (input.operation === "image-to-video") {
    const imageUrl = requiredString(input.imageUrl, "image-to-video requires imageUrl")
    return {
      prompt: input.prompt,
      image_url: imageUrl,
      resolution: input.resolution ?? "720p",
      duration,
      camera_fixed: false,
      seed: input.seed ?? -1,
      enable_safety_checker: true,
      end_image_url: input.endImageUrl ?? "",
      nsfw_checker: nsfwChecker,
    }
  }

  if (input.operation === "reference-to-video") {
    return {
      prompt: input.prompt,
      negative_prompt: input.negativePrompt ?? "low resolution, malformed hands, extra fingers, bad proportions, unreadable text, watermark",
      reference_image: input.referenceImageUrls ?? input.imageUrls ?? [],
      reference_video: input.referenceVideoUrls ?? [],
      first_frame: input.imageUrl ?? "",
      reference_voice: input.referenceAudioUrl ?? "",
      resolution: input.resolution ?? "720p",
      aspect_ratio: aspectRatio,
      duration: input.durationSec ?? 5,
      prompt_extend: true,
      watermark: false,
      seed: input.seed ?? 0,
    }
  }

  if (input.operation === "avatar") {
    return {
      image_url: requiredString(input.imageUrl, "avatar requires imageUrl"),
      audio_url: requiredString(input.audioUrl, "avatar requires audioUrl"),
      prompt: input.prompt,
    }
  }

  return {
    prompt: input.prompt,
    image_urls: input.imageUrls ?? input.referenceImageUrls ?? [],
    video_list: (input.referenceVideoUrls ?? []).map((url) => ({ url, start: 0, ends: input.durationSec ?? 4 })),
    duration,
  }
}

function requiredCapability(operation: KieOperation): KieCapability {
  const capability = KIE_CAPABILITIES.find((item) => item.operation === operation)
  if (!capability) throw new Error(`Unsupported KIE operation: ${operation}`)
  return capability
}

function requiredString(value: string | undefined, message: string): string {
  if (!value?.trim()) throw new Error(message)
  return value
}

function nonEmpty(values: string[], message: string): string[] {
  const filtered = values.filter((value) => value.trim().length > 0)
  if (filtered.length === 0) throw new Error(message)
  return filtered
}

function extractCodexPrompt(requestValue: JsonValue): string | null {
  const request = jsonRecord(requestValue)
  const payload = jsonRecord(request?.payload)
  const messages = payload?.messages
  if (!Array.isArray(messages)) return null
  for (const messageValue of messages) {
    const message = jsonRecord(messageValue)
    if (message?.role !== "user") continue
    const content = message.content
    if (typeof content === "string") return content
    if (!Array.isArray(content)) continue
    for (const contentValue of content) {
      const contentItem = jsonRecord(contentValue)
      if (contentItem?.type === "text" && typeof contentItem.text === "string") return contentItem.text
    }
  }
  return null
}

function extractCodexMediaSummary(requestValue: JsonValue): string {
  const request = jsonRecord(requestValue)
  const payload = jsonRecord(request?.payload)
  const metadata = jsonRecord(payload?.metadata)
  const mediaUrl = typeof metadata?.mediaUrl === "string" ? metadata.mediaUrl : "not recorded"
  const referenceFrameUrls = metadata?.referenceFrameUrls
  const referenceFrameCount = Array.isArray(referenceFrameUrls) ? referenceFrameUrls.filter((url) => typeof url === "string").length : 0
  return referenceFrameCount > 0 ? `${mediaUrl} (${referenceFrameCount} prepared reference frames)` : mediaUrl
}

function extractCodexObservation(responseValue: JsonValue | null | undefined): string | null {
  const response = jsonRecord(responseValue)
  if (!response) return null
  if (typeof response.output_text === "string") return response.output_text
  const choices = response.choices
  if (!Array.isArray(choices)) return null
  for (const choiceValue of choices) {
    const choice = jsonRecord(choiceValue)
    const message = jsonRecord(choice?.message)
    if (typeof message?.content === "string") return message.content
  }
  return null
}

function jsonRecord(value: JsonValue | null | undefined): JsonRecord | null {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) return null
  return value
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const text = await response.text()
  if (!response.ok) throw new Error(`KIE HTTP ${response.status}: ${text.slice(0, 500)}`)
  return JSON.parse(text) as T
}

function extractResultUrls(resultJson: string | undefined): string[] {
  if (!resultJson) return []
  const parsed = parseJsonRecord(resultJson)
  const resultUrls = parsed?.resultUrls
  if (!Array.isArray(resultUrls)) return []
  return resultUrls.filter((url): url is string => typeof url === "string")
}

function parseJsonRecord(value: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(value) as JsonValue
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function readEnvValue(envPath: string | undefined, key: string): string | undefined {
  if (!envPath) return undefined
  const path = resolve(envPath)
  if (!existsSync(path)) return undefined
  const lines = readFileSync(path, "utf8").split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const index = trimmed.indexOf("=")
    if (index <= 0) continue
    if (trimmed.slice(0, index) !== key) continue
    return trimmed.slice(index + 1).replace(/^["']|["']$/g, "")
  }
  return undefined
}
