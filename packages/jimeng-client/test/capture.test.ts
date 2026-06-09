import { describe, expect, test } from "bun:test"
import { prepareFromCapture, type CaptureFile, type JimengSessionBundle } from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("prepareFromCapture", () => {
  test("patches video prompt, duration, submit id, and frame URIs", () => {
    const capture = videoCapture()
    const prepared = prepareFromCapture({
      op: "video",
      capture,
      session,
      prompt: "new prompt",
      durationSec: 4,
      firstFrameUri: "tos://first",
      lastFrameUri: "tos://last",
      ratio: "9:16",
      videoResolution: "720p",
      modelVersion: "3.0fast",
      seed: 12345,
    })

    const draft = JSON.parse(String(prepared.submitBody.draft_content))
    const metrics = JSON.parse(String(prepared.submitBody.metrics_extra))
    const sceneOptions = JSON.parse(String(metrics.sceneOptions))
    const textToVideo = draft.component_list[0].abilities.gen_video.text_to_video_params
    const input = draft.component_list[0].abilities.gen_video.text_to_video_params.video_gen_inputs[0]
    const taskExtra = JSON.parse(draft.component_list[0].abilities.gen_video.video_task_extra)

    expect(prepared.submitUrl).toContain("/mweb/v1/aigc_draft/generate")
    expect(prepared.pollUrl).toContain("/mweb/v1/get_history_by_ids")
    expect(prepared.terminalStatus).toBe(50)
    expect(prepared.submitHeaders.cookie).toBe("sid=test")
    expect(prepared.submitBody.submit_id).toBe(prepared.submitId)
    expect(metrics.originSubmitId).toBe(prepared.submitId)
    expect(sceneOptions[0].videoDuration).toBe(4)
    expect(input.prompt).toBe("new prompt")
    expect(input.duration_ms).toBe(4000)
    expect(input.first_frame_image).toBe("tos://first")
    expect(input.end_frame_image).toBe("tos://last")
    expect(input.resolution).toBe("720p")
    expect(input.seed).toBe(12345)
    expect(textToVideo.video_aspect_ratio).toBe("9:16")
    expect(textToVideo.model_req_key).toBe("dreamina_ic_generate_video_model_vgfm_3.0_fast")
    expect(textToVideo.seed).toBe(12345)
    expect(sceneOptions[0].resolution).toBe("720p")
    expect(sceneOptions[0].modelReqKey).toBe("dreamina_ic_generate_video_model_vgfm_3.0_fast")
    expect(sceneOptions[0].reportParams.extraVipFunctionKey).toBe("dreamina_ic_generate_video_model_vgfm_3.0_fast-720p")
    expect(taskExtra.originSubmitId).toBe(prepared.submitId)
  })

  test("patches image prompt in conversation request", () => {
    const prepared = prepareFromCapture({
      op: "image",
      capture: imageCapture(),
      session,
      prompt: "make a funny image",
    })

    const part = ((prepared.submitBody.messages as any[])[0].content.content_parts as any[])[0]
    expect(prepared.submitUrl).toContain("/mweb/v1/creation_agent/v2/conversation")
    expect(prepared.submitKind).toBe("conversation_sse")
    expect(prepared.pollKind).toBe("history_by_submit_id")
    expect(prepared.terminalStatus).toBe(45)
    expect(part.text).toBe("make a funny image")
  })

  test("patches current workbench image prompt and asset-list poll body", () => {
    const prepared = prepareFromCapture({
      op: "image",
      capture: workbenchImageCapture(),
      session,
      prompt: "new workbench image",
    })

    const draft = JSON.parse(String(prepared.submitBody.draft_content))
    const metrics = JSON.parse(String(prepared.submitBody.metrics_extra))
    const coreParam = draft.component_list[0].abilities.generate.core_param

    expect(prepared.submitUrl).toContain("/mweb/v1/aigc_draft/generate")
    expect(prepared.submitKind).toBe("workbench_json")
    expect(prepared.pollUrl).toContain("/mweb/v1/get_asset_list")
    expect(prepared.pollKind).toBe("asset_list_first_image")
    expect(prepared.terminalStatus).toBe(50)
    expect(prepared.submitBody.submit_id).toBe(prepared.submitId)
    expect(metrics.generateId).toBe(prepared.submitId)
    expect(coreParam.prompt).toBe("new workbench image")
    expect(typeof coreParam.seed).toBe("number")
    expect(prepared.pollBody).toEqual({ count: 20, workspace_id: 123 })
  })
})

function videoCapture(): CaptureFile {
  const draft = {
    component_list: [
      {
        abilities: {
          gen_video: {
            text_to_video_params: {
              video_gen_inputs: [
                {
                  prompt: "old prompt",
                  duration_ms: 3000,
                  keep_unknown: true,
                },
              ],
            },
            video_task_extra: JSON.stringify({ keep: "yes" }),
          },
        },
      },
    ],
  }

  return {
    entries: [
      {
        kind: "request",
        url: "https://jimeng.jianying.com/mweb/v1/aigc_draft/generate",
        headers: { "user-agent": "CapturedUA", origin: "https://jimeng.jianying.com" },
        postData: JSON.stringify({
          submit_id: "old-submit",
          metrics_extra: JSON.stringify({ sceneOptions: JSON.stringify([{ videoDuration: 3, reportParams: {} }]), keep: true }),
          draft_content: JSON.stringify(draft),
        }),
      },
      pollRequest(),
    ],
  }
}

function imageCapture(): CaptureFile {
  return {
    entries: [
      {
        kind: "request",
        url: "https://jimeng.jianying.com/mweb/v1/creation_agent/v2/conversation",
        headers: { "user-agent": "CapturedUA" },
        postData: JSON.stringify({
          messages: [
            {
              content: {
                content_parts: [{ text: "old image prompt", type: "text" }],
              },
            },
          ],
        }),
      },
      pollRequest(),
    ],
  }
}

function workbenchImageCapture(): CaptureFile {
  const draft = {
    component_list: [
      {
        abilities: {
          generate: {
            core_param: {
              model: "high_aes_general_v50",
              prompt: "old workbench image",
              seed: 1,
            },
          },
        },
      },
    ],
  }

  return {
    entries: [
      {
        kind: "request",
        url: "https://jimeng.jianying.com/mweb/v1/aigc_draft/generate",
        headers: { "user-agent": "CapturedUA" },
        postData: JSON.stringify({
          submit_id: "old-submit",
          metrics_extra: JSON.stringify({ generateId: "old-submit", keep: true }),
          draft_content: JSON.stringify(draft),
        }),
      },
      {
        kind: "request",
        url: "https://jimeng.jianying.com/mweb/v1/get_asset_list",
        headers: { "user-agent": "CapturedUA" },
        postData: JSON.stringify({ count: 20, workspace_id: 123 }),
      },
    ],
  }
}

function pollRequest() {
  return {
    kind: "request",
    url: "https://jimeng.jianying.com/mweb/v1/get_history_by_ids",
    headers: { "user-agent": "CapturedUA" },
    postData: JSON.stringify({ submit_ids: [] }),
  }
}
