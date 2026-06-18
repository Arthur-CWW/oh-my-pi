import { describe, expect, test } from "bun:test"
import {
  buildJimengLipSyncImagePlan,
  buildJimengLipSyncVideoPlan,
  JimengError,
  lipSyncImageReferenceFromUploadSummary,
  lipSyncVideoReferenceFromUploadSummary,
  normalizeTtsInfo,
  summarizeJimengLipSyncImagePlan,
  summarizeJimengLipSyncVideoPlan,
  validateJimengLipSyncImagePlan,
  validateJimengLipSyncVideoPlan,
  type JimengImageUploadSummary,
  type JimengVideoUploadSummary,
} from "../src"
describe("Jimeng lip-sync planning", () => {
  test("builds a dry-run image/avatar lip-sync provider input", () => {
    const plan = buildJimengLipSyncImagePlan({
      submitId: "submit-image-1",
      prompt: "让参考人物自然说出口播词。",
      image: {
        uri: "tos-cn-i-tb4s082cfz/reference.png",
        width: 1024,
        height: 1536,
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
    expect(plan.modelReqKey).toBe("dreamina_lib_sync_image_quick_1.5")
    expect(plan.providerInput.videoGenInputs.i2vOpt.realmanAvatar.originImage).toEqual({
      imageUri: "tos-cn-i-tb4s082cfz/reference.png",
      width: 1024,
      height: 1536,
    })
    expect(plan.providerInput.videoGenInputs.i2vOpt.realmanAvatar.supportedModes).toEqual(["avatar"])
    expect(plan.providerInput.videoGenInputs.i2vOpt.realmanAvatar.ttsInfo).toMatchObject({
      sourceType: "text-to-speech",
      text: "三秒告诉你这款补水精华为什么适合熬夜后使用。",
      toneId: "7597003459665072686",
    })
    expect(plan.mockModelEvidence.processFlows[0]?.curProcessFlows).toEqual(["DAVideoProcessType.LipSyncImage"])
    expect(summarizeJimengLipSyncImagePlan(plan)).toMatchObject({
      mode: "image",
      live_submit: { supported: false, code: "JIMENG_LIP_SYNC_LIVE_SUBMIT_UNSUPPORTED" },
      origin_image: { image_uri_present: true, width: 1024, height: 1536 },
      tts: { source_type: "text-to-speech", tone_id_present: true },
    })

    validateJimengLipSyncImagePlan(plan)
    expect(plan.liveSubmit).toMatchObject({
      supported: false,
      code: "JIMENG_LIP_SYNC_LIVE_SUBMIT_UNSUPPORTED",
      endpoint: "/mweb/v1/aigc_draft/generate",
    })
  })

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
    expect(summarizeJimengLipSyncVideoPlan(plan)).toMatchObject({
      mode: "video",
      live_submit: { supported: false, code: "JIMENG_LIP_SYNC_LIVE_SUBMIT_UNSUPPORTED" },
      origin_video: { vid_present: true, uri_present: true, width: 704, height: 1248, duration: 5.016667 },
      tts: { source_type: "text-to-speech", tone_id_present: true },
    })

    validateJimengLipSyncVideoPlan(plan)
    expect(plan.liveSubmit).toMatchObject({
      supported: false,
      code: "JIMENG_LIP_SYNC_LIVE_SUBMIT_UNSUPPORTED",
      endpoint: "/mweb/v1/aigc_draft/generate",
    })
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

  test("derives lip-sync image reference from ImageX upload summary", () => {
    const reference = lipSyncImageReferenceFromUploadSummary(imageUploadSummary())

    expect(reference).toEqual({
      uri: "tos-cn-i-tb4s082cfz/reference.png",
      width: 1024,
      height: 1536,
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

function imageUploadSummary(): JimengImageUploadSummary {
  return {
    fileName: "reference.png",
    contentType: "image/png",
    bytes: 1234,
    serviceId: "tb4s082cfz",
    storeUri: "tos-cn-i-tb4s082cfz/reference.png",
    imageUris: ["tos-cn-i-tb4s082cfz/reference.png"],
    uploadStatus: 200,
    uploadCrc32: "abc123",
    pluginResults: [
      {
        imageUri: "tos-cn-i-tb4s082cfz/reference.png",
        imageWidth: 1024,
        imageHeight: 1536,
        imageFormat: "png",
        imageSize: 1234,
      },
    ],
  }
}

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
