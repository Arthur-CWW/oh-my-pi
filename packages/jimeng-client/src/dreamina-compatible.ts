import { jimengError } from "./errors"
import {
  prepareFromCapture,
  VIDEO_MODEL_REQ_KEYS,
  type CaptureFile,
  type JimengSessionBundle,
  type PreparedJimengRun,
} from "./capture"

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
    status: "implemented",
    directOp: "image",
    notes: "Uses captured /mweb/v1/creation_agent/v2/conversation template when an image capture is supplied.",
  },
  {
    command: "image2video",
    status: "partial",
    directOp: "video",
    notes: "Can inject a confirmed firstFrameUri into the video template. Local file upload-to-URI still needs upload endpoint reversal.",
  },
  {
    command: "frames2video",
    status: "partial",
    directOp: "video",
    notes: "Can inject confirmed firstFrameUri/lastFrameUri into the video template. Local file upload-to-URI still needs reversal.",
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
      return prepareFromCapture({
        op: "image",
        capture: input.capture,
        session: input.session,
        prompt: input.prompt,
      })

    case "image2video":
      if (input.localImages?.length) {
        throw needsUploadReversal(input.command, "local --image upload-to-URI is not reversed yet; pass --firstFrameUri from a confirmed upload capture")
      }
      if (!input.firstFrameUri) {
        throw needsUploadReversal(input.command, "image2video currently requires --firstFrameUri because local image upload is not reversed yet")
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
        throw needsUploadReversal(input.command, "local frame upload-to-URI is not reversed yet; pass confirmed --firstFrameUri/--lastFrameUri values")
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
