import { jimengError } from "./errors"
import {
  findRequest,
  prepareFromCapture,
  VIDEO_MODEL_REQ_KEYS,
  type CaptureFile,
  type JimengSessionBundle,
  type PreparedJimengRun,
} from "./capture"
import { JIMENG_TEXT2IMAGE_DIRECT_ENDPOINT, validateJimengText2ImageDirectRequest } from "./text2image-plan"
import { type JsonObject } from "./reference-image"

export type DreaminaCompatCommand =
  | "text2image"
  | "image2image"
  | "text2video"
  | "image2video"
  | "frames2video"
  | "multiframe2video"
  | "multimodal2video"
  | "image_upscale"

export type DreaminaCompatStatus = "implemented" | "partial" | "needs_capture"

export interface DreaminaCompatCapability {
  command: DreaminaCompatCommand
  status: DreaminaCompatStatus
  directOp?: "image" | "video"
  notes: string
}

export interface DreaminaCompatPrepareInput {
  command: DreaminaCompatCommand
  capture: CaptureFile
  session: JimengSessionBundle
  prompt?: string
  durationSec?: number
  ratio?: string
  videoResolution?: string
  modelVersion?: string
  modelReqKey?: string
  seed?: number
  firstFrameUri?: string
  lastFrameUri?: string
  localImages?: string[]
  localVideos?: string[]
  localAudio?: string[]
}

export const DREAMINA_COMPAT_CAPABILITIES: DreaminaCompatCapability[] = [
  {
    command: "text2video",
    status: "implemented",
    directOp: "video",
    notes: `Uses captured /mweb/v1/aigc_draft/generate template. Confirmed live with ${VIDEO_MODEL_REQ_KEYS.vgfm30Fast}.`,
  },
  {
    command: "text2image",
    status: "partial",
    directOp: "image",
    notes: "Requires a current /mweb/v1/aigc_draft/generate text-to-image workbench capture; older /creation_agent/v2/conversation templates are rejected.",
  },
  {
    command: "image2video",
    status: "partial",
    directOp: "video",
    notes: "Can inject a confirmed firstFrameUri into the video template. The jimeng-browser-proxy front door can upload a local --image first, then pass the provider URI here.",
  },
  {
    command: "frames2video",
    status: "partial",
    directOp: "video",
    notes: "Can inject confirmed firstFrameUri/lastFrameUri into the video template. End-frame local upload should be handled by the front-door CLI when implemented.",
  },
  {
    command: "image2image",
    status: "needs_capture",
    notes: "Needs frontend capture of image reference upload + image edit submit payload.",
  },
  {
    command: "multiframe2video",
    status: "needs_capture",
    notes: "Needs frontend capture of multi-frame upload/reference payload and submit operation.",
  },
  {
    command: "multimodal2video",
    status: "needs_capture",
    notes: "Needs frontend capture of 全能参考 mixed image/video/audio reference payload and submit operation.",
  },
  {
    command: "image_upscale",
    status: "needs_capture",
    notes: "Needs frontend capture of upscale submit and artifact polling shape.",
  },
]

export function prepareDreaminaCompat(input: DreaminaCompatPrepareInput): PreparedJimengRun {
  switch (input.command) {
    case "text2video":
      return prepareFromCapture({
        op: "video",
        capture: input.capture,
        session: input.session,
        prompt: input.prompt,
        durationSec: input.durationSec,
        ratio: input.ratio,
        videoResolution: input.videoResolution,
        modelVersion: input.modelVersion,
        modelReqKey: input.modelReqKey,
        seed: input.seed,
      })

    case "text2image":
      return prepareText2ImageCompat(input)

    case "image2video":
      if (input.localImages?.length) {
        throw needsUploadReversal(input.command, "local --image upload is handled by jimeng-browser-proxy; pass --firstFrameUri to this low-level helper")
      }
      if (!input.firstFrameUri) {
        throw needsUploadReversal(input.command, "image2video requires --firstFrameUri in this low-level helper")
      }
      return prepareFromCapture({
        op: "video",
        capture: input.capture,
        session: input.session,
        prompt: input.prompt,
        durationSec: input.durationSec,
        ratio: input.ratio,
        videoResolution: input.videoResolution,
        modelVersion: input.modelVersion,
        modelReqKey: input.modelReqKey,
        seed: input.seed,
        firstFrameUri: input.firstFrameUri,
      })

    case "frames2video":
      if (input.localImages?.length) {
        throw needsUploadReversal(input.command, "local frame upload is handled by jimeng-browser-proxy; pass confirmed --firstFrameUri/--lastFrameUri values")
      }
      if (!input.firstFrameUri && !input.lastFrameUri) {
        throw needsUploadReversal(input.command, "frames2video currently requires --firstFrameUri and/or --lastFrameUri")
      }
      return prepareFromCapture({
        op: "video",
        capture: input.capture,
        session: input.session,
        prompt: input.prompt,
        durationSec: input.durationSec,
        ratio: input.ratio,
        videoResolution: input.videoResolution,
        modelVersion: input.modelVersion,
        modelReqKey: input.modelReqKey,
        seed: input.seed,
        firstFrameUri: input.firstFrameUri,
        lastFrameUri: input.lastFrameUri,
      })

    case "image2image":
    case "multiframe2video":
    case "multimodal2video":
    case "image_upscale":
      throw needsCapture(input.command)
  }
}

export function getDreaminaCompatCapability(command: DreaminaCompatCommand): DreaminaCompatCapability {
  return DREAMINA_COMPAT_CAPABILITIES.find((capability) => capability.command === command) ?? {
    command,
    status: "needs_capture",
    notes: "Unknown command; capture and catalog before implementing.",
  }
}

const IMAGE_AGENT_SUBMIT_PATH = "/mweb/v1/creation_agent/v2/conversation"

function prepareText2ImageCompat(input: DreaminaCompatPrepareInput): PreparedJimengRun {
  const directSubmit = findRequest(input.capture, JIMENG_TEXT2IMAGE_DIRECT_ENDPOINT)
  if (!directSubmit?.postData) {
    const hasStaleConversation = !!findRequest(input.capture, IMAGE_AGENT_SUBMIT_PATH)
    throw text2ImageNeedsDirectCapture(hasStaleConversation
      ? "capture contains the older /mweb/v1/creation_agent/v2/conversation agent template, but Dreamina text2image compatibility now relies on the direct workbench /mweb/v1/aigc_draft/generate shape"
      : "capture is missing a /mweb/v1/aigc_draft/generate text-to-image submit request")
  }

  const submitBody = parseJsonObject(directSubmit.postData, "text2image direct submit request")
  try {
    validateJimengText2ImageDirectRequest(submitBody)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "validation",
      code: "DREAMINA_TEXT2IMAGE_CAPTURE_MISMATCH",
      message: `text2image requires a current direct workbench image capture; supplied /aigc_draft/generate body did not match the text-to-image contract: ${message}`,
      retryable: false,
      details: { command: "text2image", endpoint: JIMENG_TEXT2IMAGE_DIRECT_ENDPOINT },
    })
  }

  return prepareFromCapture({
    op: "image",
    capture: withoutConversationSubmit(input.capture),
    session: input.session,
    prompt: input.prompt,
    seed: input.seed,
  })
}

function withoutConversationSubmit(capture: CaptureFile): CaptureFile {
  return {
    entries: capture.entries.filter((entry) => typeof entry.url !== "string" || !entry.url.includes(IMAGE_AGENT_SUBMIT_PATH)),
  }
}
function parseJsonObject(text: string, label: string): JsonObject {
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as JsonObject
  } catch {
    // fall through to the schema-level validation error below
  }
  throw jimengError({
    category: "validation",
    code: "DREAMINA_TEXT2IMAGE_CAPTURE_MISMATCH",
    message: `${label} must be a JSON object from a direct text-to-image workbench submit capture.`,
    retryable: false,
    details: { command: "text2image", endpoint: JIMENG_TEXT2IMAGE_DIRECT_ENDPOINT },
  })
}

function text2ImageNeedsDirectCapture(reason: string) {
  return jimengError({
    category: "validation",
    code: "DREAMINA_TEXT2IMAGE_DIRECT_CAPTURE_REQUIRED",
    message: `text2image cannot be prepared from this capture: ${reason}. Refresh the UI capture for a text-to-image /mweb/v1/aigc_draft/generate submit before using Dreamina-compatible prepare.`,
    retryable: false,
    details: { command: "text2image", endpoint: JIMENG_TEXT2IMAGE_DIRECT_ENDPOINT },
  })
}

function needsCapture(command: DreaminaCompatCommand) {
  const capability = getDreaminaCompatCapability(command)
  return jimengError({
    category: "validation",
    code: "DREAMINA_COMPAT_NEEDS_CAPTURE",
    message: `${command} is not direct-compatible yet: ${capability.notes}`,
    retryable: false,
    details: { command, status: capability.status },
  })
}

function needsUploadReversal(command: DreaminaCompatCommand, message: string) {
  return jimengError({
    category: "validation",
    code: "DREAMINA_COMPAT_UPLOAD_NOT_REVERSED",
    message,
    retryable: false,
    details: { command },
  })
}
