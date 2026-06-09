import { describe, expect, test } from "bun:test"
import {
  buildJimengLipSyncVideoPlan,
  JimengError,
  lipSyncVideoReferenceFromUploadSummary,
  normalizeTtsInfo,
  type JimengVideoUploadSummary,
} from "../src"

describe("Jimeng lip-sync planning", () => {
  test("builds a dry-run VOD lip-sync provider input", () => {
    const plan = buildJimengLipSyncVideoPlan({
      submitId: "submit-1",
      prompt: "保持原视频动作，只替换口型。",
      video: {
        vid: "v123",
        uri: "tos-cn-v/reference.mp4",
        width: 704,
        height: 1248,
        duration: 5.016667,
        format: "MP4",
        codec: "h264",
      },
      ttsInfo: {
        sourceType: "text-to-speech",
        text: "三秒告诉你这款补水精华为什么适合熬夜后使用。",
        speed: 1,
        toneId: "7597003459665072686",
        toneKey: "清爽女声",
      },
    })

    expect(plan.status).toBe("dry-run-only")
    expect(plan.modelReqKey).toBe("dreamina_lib_sync_base")
    expect(plan.providerInput.videoGenInputs.v2vOpt.lipSyncUserVideo.originVideo).toEqual({
      originVideo: {
        vid: "v123",
        uri: "tos-cn-v/reference.mp4",
        width: 704,
        height: 1248,
        duration: 5.016667,
        posterUri: undefined,
        format: "MP4",
        codec: "h264",
        md5: undefined,
      },
      duration: 5.016667,
    })
    expect(plan.providerInput.videoGenInputs.v2vOpt.lipSyncUserVideo.ttsInfo).toMatchObject({
      sourceType: "text-to-speech",
      text: "三秒告诉你这款补水精华为什么适合熬夜后使用。",
      toneId: "7597003459665072686",
      speed: 1,
    })
    expect(plan.mockModelEvidence.processFlows[0]?.curProcessFlows).toEqual(["DAVideoProcessType.LipSyncUserVideo"])
  })

  test("derives lip-sync video reference from VOD upload summary", () => {
    const reference = lipSyncVideoReferenceFromUploadSummary(uploadSummary())

    expect(reference).toEqual({
      vid: "v123",
      uri: "tos-cn-v/reference.mp4",
      width: 704,
      height: 1248,
      duration: 5.016667,
      posterUri: "tos-cn-v/reference-poster.jpg",
      format: "MP4",
      codec: "h264",
      md5: "video-md5",
    })
  })

  test("rejects incomplete video metadata", () => {
    const summary = { ...uploadSummary(), width: null }
    expect(() => lipSyncVideoReferenceFromUploadSummary(summary)).toThrow(JimengError)
  })

  test("validates text-to-speech plan fields", () => {
    expect(() => normalizeTtsInfo({ sourceType: "text-to-speech", speed: 1, text: "hello" })).toThrow(JimengError)
    expect(normalizeTtsInfo({ sourceType: "text-to-speech", speed: 1.04, text: "hello", toneId: "voice-1" }).speed).toBe(1)
  })
})

function uploadSummary(): JimengVideoUploadSummary {
  return {
    fileName: "reference.mp4",
    contentType: "video/mp4",
    bytes: 4285498,
    spaceName: "dreamina",
    storeUri: "tos-cn-v/reference.mp4",
    vid: "v123",
    mid: null,
    sourceUri: "tos-cn-v/reference.mp4",
    posterUri: "tos-cn-v/reference-poster.jpg",
    duration: 5.016667,
    width: 704,
    height: 1248,
    originWidth: 704,
    originHeight: 1248,
    bitrate: 6834016,
    format: "MP4",
    codec: "h264",
    md5: "video-md5",
    uri: "tos-cn-v/reference.mp4",
    runId: "run-123",
    uploadStatus: 200,
    uploadCrc32: "abc123",
  }
}
