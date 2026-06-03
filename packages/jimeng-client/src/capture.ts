import { randomUUID } from "node:crypto"
import { jimengError } from "./errors"

export type JimengOp = "video" | "image"

export interface JimengSessionBundle {
  cookie: string
  userAgent?: string
  origin?: string
  referer?: string
  msToken?: string
  webId?: string
  capturedAtIso?: string
}

export interface CaptureRequestEntry {
  kind: string
  url?: string | null
  headers?: Record<string, string> | null
  postData?: string | null
}

export interface CaptureFile {
  entries: CaptureRequestEntry[]
}

export interface PrepareFromCaptureInput {
  op: JimengOp
  capture: CaptureFile
  session: JimengSessionBundle
  prompt?: string
  durationSec?: number
  firstFrameUri?: string
  lastFrameUri?: string
}

export interface PreparedJimengRun {
  op: JimengOp
  submitId: string
  prompt: string
  submitUrl: string
  pollUrl: string
  submitHeaders: Record<string, string>
  pollHeaders: Record<string, string>
  submitBody: Record<string, unknown>
  terminalStatus: number
}

const VIDEO_SUBMIT_PATH = "/mweb/v1/aigc_draft/generate"
const IMAGE_SUBMIT_PATH = "/mweb/v1/creation_agent/v2/conversation"
const POLL_PATH = "/mweb/v1/get_history_by_ids"

export function prepareFromCapture(input: PrepareFromCaptureInput): PreparedJimengRun {
  const durationSec = normalizeDuration(input.durationSec ?? 3)
  const submitPath = input.op === "video" ? VIDEO_SUBMIT_PATH : IMAGE_SUBMIT_PATH
  const submitReq = findRequest(input.capture, submitPath)
  const pollReq = findRequest(input.capture, POLL_PATH)

  if (!submitReq?.url || !submitReq.postData || !pollReq?.url) {
    throw jimengError({
      category: "validation",
      code: "CAPTURE_MISSING_REQUIRED_REQUESTS",
      message: `Capture missing required requests for op=${input.op}`,
      retryable: false,
      details: { submitPath, pollPath: POLL_PATH },
    })
  }

  const submitBody = parseJsonRecord(submitReq.postData, "submit request postData")
  const submitId = randomUUID()
  const prompt = input.prompt ?? (input.op === "video" ? extractVideoPrompt(submitBody) : extractImagePrompt(submitBody)) ?? defaultPrompt(input.op)

  patchSubmitPayload(
    {
      op: input.op,
      durationSec,
      firstFrameUri: input.firstFrameUri,
      lastFrameUri: input.lastFrameUri,
    },
    submitBody,
    prompt,
    submitId,
  )

  return {
    op: input.op,
    submitId,
    prompt,
    submitUrl: submitReq.url,
    pollUrl: pollReq.url,
    submitHeaders: buildHeaders(submitReq, input.session),
    pollHeaders: buildHeaders(pollReq, input.session),
    submitBody,
    terminalStatus: input.op === "video" ? 50 : 45,
  }
}

export function findRequest(capture: CaptureFile, pathPart: string): CaptureRequestEntry | undefined {
  return capture.entries.find((entry) => entry.kind === "request" && typeof entry.url === "string" && entry.url.includes(pathPart))
}

export function buildHeaders(req: CaptureRequestEntry, session: JimengSessionBundle): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": session.userAgent ?? req.headers?.["user-agent"] ?? "Mozilla/5.0",
    referer: session.referer ?? req.headers?.referer ?? "https://jimeng.jianying.com/",
    origin: session.origin ?? req.headers?.origin ?? "https://jimeng.jianying.com",
    cookie: session.cookie,
  }

  if (session.msToken) headers.msToken = session.msToken
  if (session.webId) headers.web_id = session.webId
  return headers
}

export function buildCookieHeaderFromCookieList(source: string): string {
  return source
    .split(/\r?\n/)
    .flatMap((line) => {
      if (!line || line.startsWith("  ")) return [] as string[]
      const idx = line.indexOf(": ")
      if (idx <= 0) return [] as string[]
      return [`${line.slice(0, idx)}=${line.slice(idx + 2)}`]
    })
    .join("; ")
}

export function patchSubmitPayload(
  args: { op: JimengOp; durationSec: number; firstFrameUri?: string; lastFrameUri?: string },
  body: Record<string, unknown>,
  prompt: string,
  submitId: string,
): void {
  // Treat captured submit templates as opaque provider contracts.
  // Only patch leaves we control and preserve all unknown keys/strings.
  if (args.op === "image") {
    const firstPart = getImagePromptPart(body)
    if (firstPart) firstPart.text = prompt
    return
  }

  body.submit_id = submitId

  if (typeof body.metrics_extra === "string") {
    const metrics = safeJson(body.metrics_extra)
    if (isRecord(metrics)) {
      metrics.originSubmitId = submitId

      if (typeof metrics.sceneOptions === "string") {
        const sceneOptions = safeJson(metrics.sceneOptions)
        if (Array.isArray(sceneOptions)) {
          const firstScene = asRecord(sceneOptions[0])
          if (firstScene) {
            firstScene.videoDuration = args.durationSec
            metrics.sceneOptions = JSON.stringify(sceneOptions)
          }
        }
      }

      body.metrics_extra = JSON.stringify(metrics)
    }
  }

  if (typeof body.draft_content !== "string") return

  const draft = safeJson(body.draft_content)
  if (!isRecord(draft)) return

  const firstInput = getFirstVideoInput(draft)
  if (!firstInput) return

  firstInput.prompt = prompt
  firstInput.seed = Math.floor(Math.random() * 4294967296)
  firstInput.duration_ms = args.durationSec * 1000

  if (args.firstFrameUri) firstInput.first_frame_image = args.firstFrameUri
  if (args.lastFrameUri) firstInput.end_frame_image = args.lastFrameUri

  const genVideo = getGenVideo(draft)
  if (genVideo && typeof genVideo.video_task_extra === "string") {
    const taskExtra = safeJson(genVideo.video_task_extra)
    if (isRecord(taskExtra)) {
      taskExtra.originSubmitId = submitId
      genVideo.video_task_extra = JSON.stringify(taskExtra)
    }
  }

  body.draft_content = JSON.stringify(draft)
}

export function extractVideoPrompt(body: Record<string, unknown>): string | null {
  if (typeof body.draft_content !== "string") return null
  const draft = safeJson(body.draft_content)
  if (!isRecord(draft)) return null
  const prompt = getFirstVideoInput(draft)?.prompt
  return typeof prompt === "string" ? prompt : null
}

export function extractImagePrompt(body: Record<string, unknown>): string | null {
  const prompt = getImagePromptPart(body)?.text
  return typeof prompt === "string" ? prompt : null
}

export function defaultPrompt(op: JimengOp): string {
  return op === "video"
    ? "一只柴犬在海边冲浪，电影感，16:9"
    : "请生成一张搞笑梗图：程序员深夜调试终于成功，夸张幽默，电影感，高清"
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = /cookie|token|auth|sign|bogus/i.test(key) ? "[REDACTED]" : value
  }
  return out
}

export function parseJsonRecord(text: string, label: string): Record<string, unknown> {
  const parsed = safeJson(text)
  if (!isRecord(parsed)) {
    throw jimengError({
      category: "validation",
      code: "JSON_OBJECT_EXPECTED",
      message: `${label} is not a JSON object`,
      retryable: false,
      details: { label },
    })
  }
  return parsed
}

function normalizeDuration(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 15) {
    throw jimengError({
      category: "validation",
      code: "DURATION_INVALID",
      message: "durationSec must be an integer from 1 to 15",
      retryable: false,
      details: { durationSec: value },
    })
  }
  return value
}

function getImagePromptPart(body: Record<string, unknown>): Record<string, unknown> | null {
  const firstMessage = asRecord(asArray(body.messages)[0])
  const content = asRecord(firstMessage?.content)
  return asRecord(asArray(content?.content_parts)[0])
}

function getGenVideo(draft: Record<string, unknown>): Record<string, unknown> | null {
  const firstComponent = asRecord(asArray(draft.component_list)[0])
  const abilities = asRecord(firstComponent?.abilities)
  return asRecord(abilities?.gen_video)
}

function getFirstVideoInput(draft: Record<string, unknown>): Record<string, unknown> | null {
  const genVideo = getGenVideo(draft)
  const textToVideo = asRecord(genVideo?.text_to_video_params)
  return asRecord(asArray(textToVideo?.video_gen_inputs)[0])
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
