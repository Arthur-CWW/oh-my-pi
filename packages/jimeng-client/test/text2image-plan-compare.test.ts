import { describe, expect, test } from "bun:test"
import {
  buildJimengText2ImageDirectPlan,
  compareJimengText2ImageDirectPlanWithCaptureTemplate,
  compareJimengText2ImageDirectPlanWithRawNetwork,
  summarizeJimengText2ImageDirectCompare,
} from "../src"

describe("Jimeng direct text2image plan capture compare", () => {
  test("matches a direct text-to-image dry-run plan against raw-network submit capture", () => {
    const plan = buildJimengText2ImageDirectPlan({
      prompt: "韩系美妆达人在自然光卧室里展示补水精华",
      modelVersion: "jimeng-5.0",
      resolution: "2k",
      ratio: "9:16",
      sampleStrength: 0.7,
      negativePrompt: "文字，水印",
      seed: 123_456,
      submitId: "submit-text2image-compare-1",
      nowMs: 1_771_234_567_000,
    })
    const result = compareJimengText2ImageDirectPlanWithRawNetwork({
      dryRunPlanText: JSON.stringify(planOutput(plan)),
      rawNetworkText: jsonl(rawRequestEvent("req-1", plan.request)),
    })

    expect(result.match).toBe(true)
    expect(result.plan_model_req_key).toBe("high_aes_general_v50")
    expect(result.candidates[0]?.endpoint_match).toBe(true)
    expect(result.candidates[0]?.model_req_key_match).toBe(true)
    expect(result.candidates[0]?.core_param_match).toBe(true)
    expect(result.candidates[0]?.metrics_match).toBe(true)
    expect(result.candidates[0]?.difference_count).toBe(0)
  })

  test("matches a dry-run plan against a capture-template request", () => {
    const plan = buildJimengText2ImageDirectPlan({
      prompt: "真实手机自拍感",
      resolution: "1k",
      ratio: "1:1",
      intelligentRatio: true,
      seed: 1,
      submitId: "submit-text2image-capture-template",
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

    const result = compareJimengText2ImageDirectPlanWithCaptureTemplate({
      dryRunPlanText: JSON.stringify(planOutput(plan)),
      captureTemplateText: JSON.stringify(captureTemplate),
    })

    expect(result.match).toBe(true)
    expect(result.candidates[0]?.core_param_match).toBe(true)
  })

  test("ignores provider-volatile direct-image ids and empty optional prompt fields", () => {
    const plan = buildJimengText2ImageDirectPlan({
      prompt: "韩系美妆达人在自然光卧室里展示补水精华",
      modelVersion: "jimeng-5.0",
      resolution: "2k",
      ratio: "1:1",
      sampleStrength: 0.5,
      submitId: "submit-text2image-volatile-plan",
      seed: 123_456,
    })
    const captured = JSON.parse(JSON.stringify(plan.request))
    captured.submit_id = "submit-text2image-volatile-capture"
    const capturedDraft = JSON.parse(captured.draft_content)
    const capturedCore = capturedDraft.component_list[0].abilities.generate.core_param
    capturedCore.seed = 987_654
    capturedCore.negative_prompt = ""
    capturedCore.large_image_info.id = "captured-large-image-id"
    delete capturedCore.large_image_info.min_version
    captured.draft_content = JSON.stringify(capturedDraft)
    const capturedMetrics = JSON.parse(captured.metrics_extra)
    capturedMetrics.generateId = "submit-text2image-volatile-capture"
    captured.metrics_extra = JSON.stringify(capturedMetrics)

    const result = compareJimengText2ImageDirectPlanWithRawNetwork({
      dryRunPlanText: JSON.stringify(planOutput(plan)),
      rawNetworkText: jsonl(rawRequestEvent("req-volatile", captured)),
    })

    expect(result.match).toBe(true)
    expect(result.candidates[0]?.difference_count).toBe(0)
  })

  test("reports path-level direct-image mismatches without leaking prompt text", () => {
    const plan = buildJimengText2ImageDirectPlan({
      prompt: "private product concept with exact brand phrasing",
      modelVersion: "jimeng-5.0",
      resolution: "2k",
      ratio: "9:16",
      sampleStrength: 0.7,
      negativePrompt: "secret negative prompt",
      seed: 123_456,
      submitId: "submit-text2image-compare-mismatch",
    })
    const captured = mutateCoreParam(plan.request, {
      prompt: "different private prompt text",
      sample_strength: 0.4,
      negative_prompt: "changed private negative prompt",
    })
    const result = compareJimengText2ImageDirectPlanWithRawNetwork({
      dryRunPlanText: JSON.stringify(planOutput(plan)),
      rawNetworkText: jsonl(rawRequestEvent("req-1", captured)),
    })
    const summary = summarizeJimengText2ImageDirectCompare(result)

    expect(result.match).toBe(false)
    expect(result.candidates[0]?.differences.map((difference) => difference.path)).toContain("core_param.prompt")
    expect(result.candidates[0]?.differences.map((difference) => difference.path)).toContain("core_param.sample_strength")
    expect(result.candidates[0]?.differences.map((difference) => difference.path)).toContain("core_param.negative_prompt")
    expect(JSON.stringify(summary)).not.toContain("private product concept")
    expect(JSON.stringify(summary)).not.toContain("different private prompt")
    expect(JSON.stringify(summary)).not.toContain("secret negative prompt")
  })
})

function planOutput(plan: ReturnType<typeof buildJimengText2ImageDirectPlan>) {
  return {
    command: "text2image-plan",
    endpoint: plan.endpoint,
    method: plan.method,
    query: plan.query,
    request: plan.request,
    draft_content: plan.draftContent,
    metrics_extra: plan.metricsExtra,
    live_submit: false,
  }
}

function mutateCoreParam(request: object, patch: Record<string, string | number | boolean>) {
  const next = JSON.parse(JSON.stringify(request))
  const draft = JSON.parse(next.draft_content)
  Object.assign(draft.component_list[0].abilities.generate.core_param, patch)
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
