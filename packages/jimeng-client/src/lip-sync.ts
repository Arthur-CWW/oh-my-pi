import { randomUUID } from "node:crypto"
import { jimengError } from "./errors"
import { type JimengImageUploadSummary, type JimengVideoUploadSummary } from "./upload"

export const DEFAULT_LIP_SYNC_VIDEO_MODEL_REQ_KEY = "dreamina_lib_sync_base"
export const DEFAULT_LIP_SYNC_IMAGE_MODEL_REQ_KEY = "dreamina_lib_sync_image_quick_1.5"
export const DEFAULT_LIP_SYNC_VIDEO_MODE = "avatar"

export interface JimengLipSyncImageReference {
  uri: string
  url?: string | null
  width: number
  height: number
}

export interface JimengLipSyncVideoReference {
  vid: string
  uri: string | null
  width: number
  height: number
  duration: number
  posterUri?: string | null
  format?: string | null
  codec?: string | null
  md5?: string | null
}

export interface JimengLipSyncTtsInfo {
  sourceType: "text-to-speech" | "upload-audio"
  text?: string
  speed: number
  toneId?: string
  toneKey?: string
  toneCategoryId?: string
  toneCategoryKey?: string
  toneEmotion?: { emotion: string; speakerId?: string }
  audioVid?: string
  originAudio?: {
    vid?: string
    uri?: string
    duration?: number
  }
}

export interface BuildJimengLipSyncVideoPlanInput {
  submitId?: string
  workspaceId?: string | number
  prompt?: string
  modelReqKey?: string
  videoMode?: string
  video: JimengLipSyncVideoReference
  ttsInfo: JimengLipSyncTtsInfo
}

export interface BuildJimengLipSyncImagePlanInput {
  submitId?: string
  workspaceId?: string | number
  prompt?: string
  modelReqKey?: string
  videoMode?: string
  image: JimengLipSyncImageReference
  supportedModes?: string[]
  ttsInfo: JimengLipSyncTtsInfo
}

export interface JimengLipSyncVideoPlan {
  command: "lip-sync"
  mode: "video"
  status: "dry-run-only"
  reason: string
  submitId: string
  endpoint: "/mweb/v1/aigc_draft/generate"
  modelReqKey: string
  workspaceId?: string | number
  providerInput: {
    videoGenInputs: {
      videoMode: string
      prompt: string
      v2vOpt: {
        lipSyncUserVideo: {
          originVideo: {
            originVideo: JimengLipSyncVideoReference
            duration: number
          }
          ttsInfo: JimengLipSyncTtsInfo
        }
      }
    }
    modelReqKey: string
  }
  mockModelEvidence: {
    generateType: "LipSync"
    processFlows: Array<{ curProcessFlows: ["DAVideoProcessType.LipSyncUserVideo"] }>
    submitQueryParams: {
      babiParam: {
        scenario: "image_video_generation"
        featureKey: "text_to_video"
        featureEntranceDetail: "to-generate-text_to_video"
      }
    }
  }
  nextProbe: string
}

export interface JimengLipSyncImagePlan {
  command: "lip-sync"
  mode: "image"
  status: "dry-run-only"
  reason: string
  submitId: string
  endpoint: "/mweb/v1/aigc_draft/generate"
  modelReqKey: string
  workspaceId?: string | number
  providerInput: {
    videoGenInputs: {
      videoMode: string
      prompt: string
      i2vOpt: {
        realmanAvatar: {
          originImage: {
            imageUri: string
            imageUrl?: string | null
            width: number
            height: number
          }
          supportedModes: string[]
          ttsInfo: JimengLipSyncTtsInfo
        }
      }
    }
    modelReqKey: string
  }
  mockModelEvidence: {
    generateType: "LipSync"
    processFlows: Array<{ curProcessFlows: ["DAVideoProcessType.LipSyncImage"] }>
    submitQueryParams: {
      babiParam: {
        scenario: "image_video_generation"
        featureKey: "text_to_video"
        featureEntranceDetail: "to-generate-text_to_video"
      }
    }
  }
  nextProbe: string
}

export function buildJimengLipSyncImagePlan(input: BuildJimengLipSyncImagePlanInput): JimengLipSyncImagePlan {
  const image = normalizeLipSyncImageReference(input.image)
  const submitId = input.submitId ?? randomUUID()
  const modelReqKey = input.modelReqKey ?? DEFAULT_LIP_SYNC_IMAGE_MODEL_REQ_KEY
  const prompt = input.prompt ?? "对参考人物图片进行口型同步，保持人物身份、镜头构图和真实自拍视频质感。"
  const videoMode = input.videoMode ?? DEFAULT_LIP_SYNC_VIDEO_MODE
  const supportedModes = input.supportedModes?.length ? input.supportedModes : [videoMode]

  return {
    command: "lip-sync",
    mode: "image",
    status: "dry-run-only",
    reason: "Frontend bundle confirms the image/avatar lip-sync model shape, but live submit is deferred until a real /aigc_draft/generate request is captured.",
    submitId,
    endpoint: "/mweb/v1/aigc_draft/generate",
    modelReqKey,
    workspaceId: input.workspaceId,
    providerInput: {
      videoGenInputs: {
        videoMode,
        prompt,
        i2vOpt: {
          realmanAvatar: {
            originImage: {
              imageUri: image.uri,
              ...(image.url ? { imageUrl: image.url } : {}),
              width: image.width,
              height: image.height,
            },
            supportedModes,
            ttsInfo: normalizeTtsInfo(input.ttsInfo),
          },
        },
      },
      modelReqKey,
    },
    mockModelEvidence: {
      generateType: "LipSync",
      processFlows: [{ curProcessFlows: ["DAVideoProcessType.LipSyncImage"] }],
      submitQueryParams: {
        babiParam: {
          scenario: "image_video_generation",
          featureKey: "text_to_video",
          featureEntranceDetail: "to-generate-text_to_video",
        },
      },
    },
    nextProbe: "Capture the Jimeng image/avatar lip-sync UI submit request and compare its converted draft_content against providerInput before enabling live submit.",
  }
}

export function buildJimengLipSyncVideoPlan(input: BuildJimengLipSyncVideoPlanInput): JimengLipSyncVideoPlan {
  const video = normalizeLipSyncVideoReference(input.video)
  const submitId = input.submitId ?? randomUUID()
  const modelReqKey = input.modelReqKey ?? DEFAULT_LIP_SYNC_VIDEO_MODEL_REQ_KEY
  const prompt = input.prompt ?? "对参考视频进行口型同步，保持原视频人物动作、镜头节奏和画面构图。"
  const videoMode = input.videoMode ?? DEFAULT_LIP_SYNC_VIDEO_MODE

  return {
    command: "lip-sync",
    mode: "video",
    status: "dry-run-only",
    reason: "Frontend bundle confirms the lip-sync model shape, but live submit is deferred until a real /aigc_draft/generate lip-sync request is captured.",
    submitId,
    endpoint: "/mweb/v1/aigc_draft/generate",
    modelReqKey,
    workspaceId: input.workspaceId,
    providerInput: {
      videoGenInputs: {
        videoMode,
        prompt,
        v2vOpt: {
          lipSyncUserVideo: {
            originVideo: {
              originVideo: video,
              duration: video.duration,
            },
            ttsInfo: normalizeTtsInfo(input.ttsInfo),
          },
        },
      },
      modelReqKey,
    },
    mockModelEvidence: {
      generateType: "LipSync",
      processFlows: [{ curProcessFlows: ["DAVideoProcessType.LipSyncUserVideo"] }],
      submitQueryParams: {
        babiParam: {
          scenario: "image_video_generation",
          featureKey: "text_to_video",
          featureEntranceDetail: "to-generate-text_to_video",
        },
      },
    },
    nextProbe: "Capture the Jimeng lip-sync UI submit request and compare its converted draft_content against providerInput before enabling live submit.",
  }
}

export function lipSyncImageReferenceFromUploadSummary(summary: JimengImageUploadSummary): JimengLipSyncImageReference {
  const uri = summary.imageUris[0]
  const plugin = summary.pluginResults.find((item) => item.imageUri === uri) ?? summary.pluginResults[0]
  const width = plugin?.imageWidth ?? null
  const height = plugin?.imageHeight ?? null
  if (!uri || !width || !height) {
    throw jimengError({
      category: "validation",
      code: "LIP_SYNC_IMAGE_UPLOAD_METADATA_MISSING",
      message: "Image upload summary is missing URI, width, or height needed by image/avatar lip-sync.",
      retryable: false,
      details: {
        uriPresent: !!uri,
        widthPresent: !!width,
        heightPresent: !!height,
      },
    })
  }
  return {
    uri,
    width,
    height,
  }
}

export function lipSyncVideoReferenceFromUploadSummary(summary: JimengVideoUploadSummary): JimengLipSyncVideoReference {
  if (!summary.vid || !summary.width || !summary.height || !summary.duration) {
    throw jimengError({
      category: "validation",
      code: "LIP_SYNC_VIDEO_UPLOAD_METADATA_MISSING",
      message: "VOD upload summary is missing vid, width, height, or duration needed by lip-sync.",
      retryable: false,
      details: {
        vidPresent: !!summary.vid,
        widthPresent: !!summary.width,
        heightPresent: !!summary.height,
        durationPresent: !!summary.duration,
      },
    })
  }

  return {
    vid: summary.vid,
    uri: summary.uri ?? summary.sourceUri,
    width: summary.width,
    height: summary.height,
    duration: summary.duration,
    posterUri: summary.posterUri,
    format: summary.format,
    codec: summary.codec,
    md5: summary.md5,
  }
}

export function normalizeLipSyncImageReference(input: JimengLipSyncImageReference): JimengLipSyncImageReference {
  if (!input.uri || input.width <= 0 || input.height <= 0) {
    throw jimengError({
      category: "validation",
      code: "LIP_SYNC_IMAGE_REFERENCE_INVALID",
      message: "lip-sync image reference requires provider URI, positive width, and positive height.",
      retryable: false,
      details: {
        uriPresent: !!input.uri,
        width: input.width,
        height: input.height,
      },
    })
  }
  return {
    uri: input.uri,
    ...(input.url ? { url: input.url } : {}),
    width: input.width,
    height: input.height,
  }
}

export function normalizeLipSyncVideoReference(input: JimengLipSyncVideoReference): JimengLipSyncVideoReference {
  if (!input.vid || input.width <= 0 || input.height <= 0 || input.duration <= 0) {
    throw jimengError({
      category: "validation",
      code: "LIP_SYNC_VIDEO_REFERENCE_INVALID",
      message: "lip-sync video reference requires vid, positive width, positive height, and positive duration.",
      retryable: false,
      details: {
        vidPresent: !!input.vid,
        width: input.width,
        height: input.height,
        duration: input.duration,
      },
    })
  }

  return {
    vid: input.vid,
    uri: input.uri,
    width: input.width,
    height: input.height,
    duration: input.duration,
    posterUri: input.posterUri,
    format: input.format,
    codec: input.codec,
    md5: input.md5,
  }
}

export function normalizeTtsInfo(input: JimengLipSyncTtsInfo): JimengLipSyncTtsInfo {
  if (input.sourceType === "text-to-speech" && (!input.text || !input.toneId)) {
    throw jimengError({
      category: "validation",
      code: "LIP_SYNC_TTS_INFO_INVALID",
      message: "text-to-speech lip-sync requires text and toneId.",
      retryable: false,
      details: {
        textPresent: !!input.text,
        toneIdPresent: !!input.toneId,
      },
    })
  }

  if (input.sourceType === "upload-audio" && !input.audioVid && !input.originAudio?.vid) {
    throw jimengError({
      category: "validation",
      code: "LIP_SYNC_AUDIO_INFO_INVALID",
      message: "upload-audio lip-sync requires audioVid or originAudio.vid.",
      retryable: false,
    })
  }

  return {
    ...input,
    speed: normalizeSpeed(input.speed),
  }
}

function normalizeSpeed(value: number): number {
  if (!Number.isFinite(value) || value < 0.5 || value > 2) {
    throw jimengError({
      category: "validation",
      code: "LIP_SYNC_SPEED_INVALID",
      message: "lip-sync speed must be a number from 0.5 to 2.",
      retryable: false,
      details: { speed: value },
    })
  }
  return Math.round(value * 10) / 10
}
