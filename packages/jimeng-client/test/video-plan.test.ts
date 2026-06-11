import { describe, expect, test } from "bun:test"
import {
  buildJimengVideoDirectPlan,
  buildJimengVideoOmniReferencePlan,
  modelVersionToDirectVideoReqKey,
  parseJimengVideoOmniMaterialsJson,
  summarizeJimengVideoDirectPlan,
  summarizeJimengVideoOmniReferencePlan,
  validateJimengVideoDirectRequest,
  validateJimengVideoOmniReferenceRequest,
} from "../src/video-plan"

describe("Jimeng direct video plan", () => {
  test("builds a direct text-to-video submit body with required nested draft and metrics paths", () => {
    const plan = buildJimengVideoDirectPlan({
      prompt: "韩系美妆UGC创作者在明亮卧室里展示补水精华，真实手机自拍质感，无字幕，无水印",
      ratio: "9:16",
      durationSec: 5,
      videoResolution: "720p",
      seed: 20260611,
      submitId: "submit-video-1",
      nowMs: 1781073939000,
    })

    expect(plan.endpoint).toBe("/mweb/v1/aigc_draft/generate")
    expect(plan.modelReqKey).toBe("dreamina_ic_generate_video_model_vgfm_3.0_fast")
    expect(plan.durationSec).toBe(5)
    expect(plan.hasFirstFrame).toBe(false)
    expect(plan.hasLastFrame).toBe(false)

    const draft = JSON.parse(String(plan.request.draft_content))
    const metrics = JSON.parse(String(plan.request.metrics_extra))
    const component = draft.component_list[0]
    const params = component.abilities.gen_video.text_to_video_params
    const videoInput = params.video_gen_inputs[0]
    const sceneOptions = JSON.parse(metrics.sceneOptions)

    expect(plan.request.extend).toMatchObject({
      root_model: "dreamina_ic_generate_video_model_vgfm_3.0_fast",
      m_video_commerce_info: {
        benefit_type: "basic_video_operation_vgfm_v_three",
        resource_id: "generate_video",
      },
    })
    expect(component).toMatchObject({
      type: "video_base_component",
      aigc_mode: "workbench",
      generate_type: "gen_video",
      process_type: 1,
    })
    expect(videoInput).toMatchObject({
      prompt: "韩系美妆UGC创作者在明亮卧室里展示补水精华，真实手机自拍质感，无字幕，无水印",
      duration_ms: 5000,
      resolution: "720p",
      fps: 24,
      seed: 20260611,
    })
    expect(params).toMatchObject({
      video_aspect_ratio: "9:16",
      model_req_key: "dreamina_ic_generate_video_model_vgfm_3.0_fast",
      priority: 0,
    })
    expect(sceneOptions[0]).toMatchObject({
      type: "video",
      scene: "BasicVideoGenerateButton",
      resolution: "720p",
      videoDuration: 5,
      materialTypes: [],
    })
    expect(summarizeJimengVideoDirectPlan(plan)).toMatchObject({
      live_submit: false,
      has_first_frame: false,
      has_last_frame: false,
    })
  })

  test("adds first and end frame provider URIs for image/video frame workflows", () => {
    const plan = buildJimengVideoDirectPlan({
      prompt: "产品特写转场到人物自拍视频",
      firstFrameUri: "tos-cn-i-tb4s082cfz/start.png",
      lastFrameUri: "tos-cn-i-tb4s082cfz/end.png",
      ratio: "16:9",
      durationSec: 3,
      seed: 7,
      submitId: "submit-video-frames",
    })
    const draft = JSON.parse(String(plan.request.draft_content))
    const videoInput = draft.component_list[0].abilities.gen_video.text_to_video_params.video_gen_inputs[0]

    expect(videoInput.first_frame_image).toBe("tos-cn-i-tb4s082cfz/start.png")
    expect(videoInput.end_frame_image).toBe("tos-cn-i-tb4s082cfz/end.png")
    expect(plan.hasFirstFrame).toBe(true)
    expect(plan.hasLastFrame).toBe(true)
  })

  test("validates required Effect Schema paths while tolerating additive provider fields", () => {
    const plan = buildJimengVideoDirectPlan({
      prompt: "测试视频",
      seed: 1,
      submitId: "submit-video-extra",
    })
    const request = {
      ...plan.request,
      provider_added_field: true,
    }

    expect(() => validateJimengVideoDirectRequest(request)).not.toThrow()

    const broken = {
      ...plan.request,
      draft_content: JSON.stringify({ type: "draft", component_list: [] }),
    }
    expect(() => validateJimengVideoDirectRequest(broken)).toThrow("Jimeng video direct request did not match required fields")
  })

  test("rejects unsupported direct model aliases before building a request", () => {
    expect(modelVersionToDirectVideoReqKey("3.0fast")).toBe("dreamina_ic_generate_video_model_vgfm_3.0_fast")
    expect(() => buildJimengVideoDirectPlan({ prompt: "x", modelVersion: "unknown" })).toThrow("No direct video model_req_key mapping")
    expect(() => buildJimengVideoDirectPlan({ prompt: "x", durationSec: 0 })).toThrow("--durationSec")
  })

  test("builds a Seedance omni-reference plan for persona plus reference-video transfer", () => {
    const plan = buildJimengVideoOmniReferencePlan({
      prompt: "@image_file_1 as the new Korean beauty host, mimic the timing and hand motion from @video_file_1, swap the hook to a cushion foundation CTA",
      materials: parseJimengVideoOmniMaterialsJson([
        {
          type: "image",
          fieldName: "image_file_1",
          uri: "tos-cn-i-tb4s082cfz/persona.png",
          width: 1080,
          height: 1920,
          format: "png",
        },
        {
          type: "video",
          fieldName: "video_file_1",
          vid: "v03870g10004d8k1u4nog65hb08dnhig",
          width: 1080,
          height: 1920,
          durationSec: 8,
        },
      ]),
      modelVersion: "jimeng-video-seedance-2.0",
      ratio: "9:16",
      durationSec: 8,
      fps: 24,
      seed: 42,
      submitId: "submit-omni-reference",
      nowMs: 1781073939000,
    })

    const draft = JSON.parse(String(plan.request.draft_content))
    const metrics = JSON.parse(String(plan.request.metrics_extra))
    const params = draft.component_list[0].abilities.gen_video.text_to_video_params
    const videoInput = params.video_gen_inputs[0]
    const unifiedEdit = videoInput.unified_edit_input
    const sceneOptions = JSON.parse(metrics.sceneOptions)

    expect(plan.endpoint).toBe("/mweb/v1/aigc_draft/generate")
    expect(plan.query).toContain("da_version=3.3.17")
    expect(plan.modelReqKey).toBe("dreamina_seedance_40_pro")
    expect(plan.request.extend).toMatchObject({
      root_model: "dreamina_seedance_40_pro",
      m_video_commerce_info: {
        benefit_type: "dreamina_video_seedance_20_video_add",
      },
    })
    expect(draft.min_features).toEqual(["AIGC_Video_UnifiedEdit"])
    expect(videoInput).toMatchObject({
      prompt: "",
      duration_ms: 8000,
      fps: 24,
    })
    expect(unifiedEdit.material_list).toHaveLength(2)
    expect(unifiedEdit.material_list[0]).toMatchObject({
      material_type: "image",
      image_info: {
        image_uri: "tos-cn-i-tb4s082cfz/persona.png",
        width: 1080,
        height: 1920,
      },
    })
    expect(unifiedEdit.material_list[1]).toMatchObject({
      material_type: "video",
      video_info: {
        vid: "v03870g10004d8k1u4nog65hb08dnhig",
        duration: 8000,
      },
    })
    expect(unifiedEdit.meta_list).toEqual([
      { meta_type: "image", text: "", material_ref: { material_idx: 0 } },
      { meta_type: "text", text: " as the new Korean beauty host, mimic the timing and hand motion from " },
      { meta_type: "video", text: "", material_ref: { material_idx: 1 } },
      { meta_type: "text", text: ", swap the hook to a cushion foundation CTA" },
    ])
    expect(sceneOptions[0]).toMatchObject({
      materialTypes: [1, 2],
      modelReqKey: "dreamina_seedance_40_pro",
      videoDuration: 8,
    })
    expect(metrics).toMatchObject({
      functionMode: "omni_reference",
      isDefaultSeed: 0,
      originSubmitId: "submit-omni-reference",
    })
    expect(summarizeJimengVideoOmniReferencePlan(plan)).toMatchObject({
      function_mode: "omni_reference",
      material_counts: { image: 1, video: 1 },
      material_types: [1, 2],
      meta_types: ["image", "text", "video", "text"],
      live_submit: false,
    })
  })

  test("validates omni-reference required paths and rejects unsupported models", () => {
    const plan = buildJimengVideoOmniReferencePlan({
      prompt: "@image_file_1 as first frame",
      materials: parseJimengVideoOmniMaterialsJson([
        { type: 1, uri: "tos-cn-i-tb4s082cfz/persona.png" },
      ]),
      seed: 1,
      submitId: "submit-omni-extra",
    })
    expect(() => validateJimengVideoOmniReferenceRequest({
      ...plan.request,
      provider_added_field: true,
    })).not.toThrow()
    expect(() => buildJimengVideoOmniReferencePlan({
      prompt: "x",
      materials: parseJimengVideoOmniMaterialsJson([{ type: "image", uri: "tos-cn-i-tb4s082cfz/persona.png" }]),
      modelVersion: "jimeng-video-3.0-fast",
    })).toThrow("omni-video-plan requires Seedance 2.0")
    expect(() => buildJimengVideoOmniReferencePlan({
      prompt: "x",
      materials: parseJimengVideoOmniMaterialsJson([{ type: "video", vid: "v1", durationSec: 20 }]),
    })).toThrow("durationSec must be a number from 0 to 15.4")
  })
})
