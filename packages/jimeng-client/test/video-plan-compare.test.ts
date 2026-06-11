import { describe, expect, test } from "bun:test"
import {
  buildJimengVideoDirectPlan,
  compareJimengVideoDirectPlanWithCaptureTemplate,
  compareJimengVideoDirectPlanWithRawNetwork,
  summarizeJimengVideoDirectCompare,
} from "../src"

describe("Jimeng direct video plan capture compare", () => {
  test("matches a direct text-to-video dry-run plan against raw-network submit capture", () => {
    const plan = buildJimengVideoDirectPlan({
      prompt: "韩系美妆UGC创作者手机自拍视频，展示补水精华，真实自然光",
      ratio: "9:16",
      videoResolution: "720p",
      durationSec: 5,
      seed: 20260611,
      submitId: "submit-direct-video-1",
      nowMs: 1781073939000,
    })
    const result = compareJimengVideoDirectPlanWithRawNetwork({
      dryRunPlanText: JSON.stringify(planOutput(plan)),
      rawNetworkText: jsonl(rawRequestEvent("req-1", plan.request)),
    })

    expect(result.match).toBe(true)
    expect(result.plan_model_req_key).toBe("dreamina_ic_generate_video_model_vgfm_3.0_fast")
    expect(result.candidates[0]?.endpoint_match).toBe(true)
    expect(result.candidates[0]?.model_req_key_match).toBe(true)
    expect(result.candidates[0]?.video_input_match).toBe(true)
    expect(result.candidates[0]?.metrics_match).toBe(true)
    expect(result.candidates[0]?.video_task_extra_match).toBe(true)
    expect(result.candidates[0]?.difference_count).toBe(0)
  })

  test("matches a first/end-frame dry-run plan against a capture-template request", () => {
    const plan = buildJimengVideoDirectPlan({
      prompt: "从产品特写转场到人物自拍视频",
      firstFrameUri: "tos-cn-i-demo/start.png",
      lastFrameUri: "tos-cn-i-demo/end.png",
      ratio: "16:9",
      durationSec: 3,
      seed: 7,
      submitId: "submit-direct-video-frames",
    })
    const captureTemplate = {
      entries: [
        {
          kind: "request",
          url: "https://jimeng.jianying.com/mweb/v1/aigc_draft/generate?aid=513695",
          postData: JSON.stringify(plan.request),
        },
      ],
    }

    const result = compareJimengVideoDirectPlanWithCaptureTemplate({
      dryRunPlanText: JSON.stringify(planOutput(plan)),
      captureTemplateText: JSON.stringify(captureTemplate),
    })

    expect(result.match).toBe(true)
    expect(result.candidates[0]?.video_input_match).toBe(true)
  })

  test("reports path-level direct-video mismatches without leaking provider URI values", () => {
    const plan = buildJimengVideoDirectPlan({
      prompt: "产品特写转场到人物自拍视频",
      firstFrameUri: "tos-cn-i-secret/start.png",
      lastFrameUri: "tos-cn-i-secret/end.png",
      ratio: "16:9",
      durationSec: 3,
      seed: 7,
      submitId: "submit-direct-video-frames",
    })
    const captured = mutateDraftVideoInput(plan.request, {
      first_frame_image: "https://signed.example.invalid/private-start.png?x-signature=secret",
      resolution: "1080p",
    })
    const result = compareJimengVideoDirectPlanWithRawNetwork({
      dryRunPlanText: JSON.stringify(planOutput(plan)),
      rawNetworkText: jsonl(rawRequestEvent("req-1", captured)),
    })
    const summary = summarizeJimengVideoDirectCompare(result)

    expect(result.match).toBe(false)
    expect(result.candidates[0]?.differences.map((difference) => difference.path)).toContain("videoInput.first_frame_image")
    expect(result.candidates[0]?.differences.map((difference) => difference.path)).toContain("videoInput.resolution")
    expect(JSON.stringify(summary)).not.toContain("tos-cn-i-secret")
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).not.toContain("x-signature")
  })
})

function planOutput(plan: ReturnType<typeof buildJimengVideoDirectPlan>) {
  return {
    command: "text2video-plan",
    endpoint: plan.endpoint,
    method: plan.method,
    query: plan.query,
    request: plan.request,
    draft_content: plan.draftContent,
    metrics_extra: plan.metricsExtra,
    live_submit: false,
  }
}

function mutateDraftVideoInput(request: object, patch: Record<string, string | number>) {
  const next = JSON.parse(JSON.stringify(request))
  const draft = JSON.parse(next.draft_content)
  Object.assign(draft.component_list[0].abilities.gen_video.text_to_video_params.video_gen_inputs[0], patch)
  next.draft_content = JSON.stringify(draft)
  return next
}

function rawRequestEvent(requestId: string, submitBody: object) {
  return {
    kind: "cdpEvent",
    method: "Network.requestWillBeSent",
    params: {
      requestId,
      request: {
        url: "https://jimeng.jianying.com/mweb/v1/aigc_draft/generate?aid=513695",
        method: "POST",
        postData: JSON.stringify(submitBody),
      },
    },
  }
}

function jsonl(...events: object[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`
}
