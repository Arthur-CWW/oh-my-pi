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
    })

    const draft = JSON.parse(String(prepared.submitBody.draft_content))
    const metrics = JSON.parse(String(prepared.submitBody.metrics_extra))
    const sceneOptions = JSON.parse(String(metrics.sceneOptions))
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
    expect(typeof input.seed).toBe("number")
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
    expect(prepared.terminalStatus).toBe(45)
    expect(part.text).toBe("make a funny image")
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
          metrics_extra: JSON.stringify({ sceneOptions: JSON.stringify([{ videoDuration: 3 }]), keep: true }),
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

function pollRequest() {
  return {
    kind: "request",
    url: "https://jimeng.jianying.com/mweb/v1/get_history_by_ids",
    headers: { "user-agent": "CapturedUA" },
    postData: JSON.stringify({ submit_ids: [] }),
  }
}
