import { describe, expect, test } from "bun:test"
import {
  buildJimengText2ImageDirectPlan,
  JimengError,
  modelVersionToImageReqKey,
  summarizeJimengText2ImageDirectPlan,
  validateJimengText2ImageDirectRequest,
  type JimengText2ImageDirectPlan,
  type JsonObject,
} from "../src"

describe("Jimeng direct text2image plan", () => {
  test("builds a direct submit request with required nested draft and metrics paths", () => {
    const plan = buildJimengText2ImageDirectPlan({
      prompt: "韩系美妆达人在自然光卧室里展示补水精华",
      modelVersion: "jimeng-5.0",
      resolution: "2k",
      ratio: "9:16",
      sampleStrength: 0.7,
      negativePrompt: "文字，水印",
      seed: 123_456,
      submitId: "submit-unit-test",
      nowMs: 1_771_234_567_000,
    })

    expect(plan.endpoint).toBe("/mweb/v1/aigc_draft/generate")
    expect(plan.method).toBe("POST")
    expect(plan.query).toContain("aid=513695")
    expect(plan.modelReqKey).toBe("high_aes_general_v50")
    expect(plan.width).toBe(1440)
    expect(plan.height).toBe(2560)
    expect(plan.imageRatio).toBe(5)
    expect(plan.request).toMatchObject({
      extend: { root_model: "high_aes_general_v50" },
      submit_id: "submit-unit-test",
      http_common_info: { aid: 513695 },
    })

    const coreParam = coreParamFromPlan(plan)
    expect(coreParam).toMatchObject({
      model: "high_aes_general_v50",
      prompt: "韩系美妆达人在自然光卧室里展示补水精华",
      sample_strength: 0.7,
      image_ratio: 5,
      intelligent_ratio: false,
      seed: 123_456,
      negative_prompt: "文字，水印",
    })
    expect(coreParam.large_image_info).toMatchObject({
      width: 1440,
      height: 2560,
      resolution_type: "2k",
    })

    const metrics = JSON.parse(String(plan.request.metrics_extra)) as JsonObject
    const sceneOptions = JSON.parse(String(metrics.sceneOptions)) as JsonObject[]
    expect(metrics).toMatchObject({
      promptSource: "custom",
      generateCount: 1,
      enterFrom: "click",
      generateId: "submit-unit-test",
      isRegenerate: false,
    })
    expect(sceneOptions[0]).toMatchObject({
      type: "image",
      scene: "ImageBasicGenerate",
      modelReqKey: "high_aes_general_v50",
      resolutionType: "2k",
      benefitCount: 4,
    })

    expect(summarizeJimengText2ImageDirectPlan(plan)).toMatchObject({
      model_version: "jimeng-5.0",
      model_req_key: "high_aes_general_v50",
      resolution: "2k",
      ratio: "9:16",
      live_submit: false,
    })
  })

  test("omits image_ratio when intelligent ratio is enabled", () => {
    const plan = buildJimengText2ImageDirectPlan({
      prompt: "真实手机自拍感",
      intelligentRatio: true,
      submitId: "submit-intelligent-ratio",
      seed: 1,
    })

    const coreParam = coreParamFromPlan(plan)
    expect(coreParam.intelligent_ratio).toBe(true)
    expect("image_ratio" in coreParam).toBe(false)
    validateJimengText2ImageDirectRequest(plan.request)
  })

  test("validates only relied-on Effect Schema paths and tolerates extra provider fields", () => {
    const plan = buildJimengText2ImageDirectPlan({
      prompt: "补水精华产品展示",
      submitId: "submit-extra-fields",
      seed: 2,
    })
    const draft = JSON.parse(String(plan.request.draft_content)) as JsonObject
    draft.new_provider_field = { ok: true }
    const componentList = draft.component_list as JsonObject[]
    componentList[0]!.new_component_field = "allowed"

    const request = {
      ...plan.request,
      new_submit_field: true,
      draft_content: JSON.stringify(draft),
    }

    expect(() => validateJimengText2ImageDirectRequest(request)).not.toThrow()
  })

  test("fails loudly when required contract paths disappear", () => {
    const plan = buildJimengText2ImageDirectPlan({
      prompt: "补水精华产品展示",
      submitId: "submit-broken",
      seed: 3,
    })
    const draft = JSON.parse(String(plan.request.draft_content)) as JsonObject
    const coreParam = coreParamFromDraft(draft)
    delete coreParam.model

    expect(() => validateJimengText2ImageDirectRequest({
      ...plan.request,
      draft_content: JSON.stringify(draft),
    })).toThrow(JimengError)
  })

  test("rejects unmapped model versions before building a request", () => {
    expect(() => modelVersionToImageReqKey("jimeng-unknown")).toThrow("No direct text2image model_req_key mapping")
    expect(() => buildJimengText2ImageDirectPlan({
      prompt: "补水精华产品展示",
      modelVersion: "jimeng-unknown",
    })).toThrow("No direct text2image model_req_key mapping")
  })
})

function coreParamFromPlan(plan: JimengText2ImageDirectPlan): JsonObject {
  const draft = JSON.parse(String(plan.request.draft_content)) as JsonObject
  return coreParamFromDraft(draft)
}

function coreParamFromDraft(draft: JsonObject): JsonObject {
  const componentList = draft.component_list as JsonObject[]
  const component = componentList[0]!
  const abilities = component.abilities as JsonObject
  const generate = abilities.generate as JsonObject
  return generate.core_param as JsonObject
}
