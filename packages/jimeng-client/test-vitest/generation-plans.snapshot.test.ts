import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  buildJimengText2ImageDirectPlan,
  buildJimengVideoDirectPlan,
  buildJimengVideoOmniReferencePlan,
  parseJimengVideoOmniMaterialsJson,
  summarizeJimengText2ImageDirectPlan,
  summarizeJimengVideoDirectPlan,
  summarizeJimengVideoOmniReferencePlan,
  type JimengText2ImageDirectPlan,
  type JimengVideoDirectPlan,
  type JimengVideoOmniReferencePlan,
  type JsonObject,
  type JsonValue,
} from "../src"

interface GenerationPlanSnapshot {
  readonly workflow: string
  readonly valueRank: number
  readonly productUse: string
  readonly cliExample: string
  readonly summary: JsonObject
  readonly contract: JsonObject
}

describe("Jimeng generation plan snapshots", () => {
  it.effect("snapshots representative high-value UGC generation request contracts", () =>
    Effect.sync(() => {
      expect(buildGenerationPlanSnapshots()).toMatchSnapshot()
    }))
})

function buildGenerationPlanSnapshots(): readonly GenerationPlanSnapshot[] {
  return [
    text2ImageSnapshot(
      "korean-beauty-persona-still",
      "Persona/avatar exploration still for a reusable Korean beauty UGC host.",
      "jimeng-browser-proxy text2image-plan --prompt '韩系美妆UGC创作者在自然光卧室里展示补水精华，真实手机自拍视频感，无文字，无水印' --modelVersion jimeng-5.0 --resolution 2k --ratio 9:16 --sampleStrength 0.62",
      buildJimengText2ImageDirectPlan({
        prompt: "韩系美妆UGC创作者在自然光卧室里展示补水精华，真实手机自拍视频感，无文字，无水印",
        modelVersion: "jimeng-5.0",
        resolution: "2k",
        ratio: "9:16",
        sampleStrength: 0.62,
        negativePrompt: "字幕，水印，品牌logo，过度磨皮，塑料皮肤",
        seed: 2_026_061_101,
        submitId: "snapshot-text2image-kbeauty",
        nowMs: 1_781_234_567_000,
      }),
    ),
    text2VideoSnapshot(
      "faceless-protein-bar-hook-video",
      "Faceless product hook video for rapid ad-format exploration.",
      "jimeng-browser-proxy text2video-plan --prompt '竖屏手机广告，蛋白棒从包装里掰开，镜头切到巧克力夹心拉丝，前三秒强钩子，真实UGC产品测评风格' --ratio 9:16 --videoResolution 720p --durationSec 5 --fps 24",
      buildJimengVideoDirectPlan({
        prompt: "竖屏手机广告，蛋白棒从包装里掰开，镜头切到巧克力夹心拉丝，前三秒强钩子，真实UGC产品测评风格",
        ratio: "9:16",
        videoResolution: "720p",
        durationSec: 5,
        fps: 24,
        seed: 2_026_061_102,
        submitId: "snapshot-text2video-protein-hook",
        nowMs: 1_781_234_568_000,
      }),
    ),
    text2VideoSnapshot(
      "reference-profile-pose-transfer-frames",
      "First/end-frame plan for copying a reference profile pose/timing template while swapping the product/person.",
      "jimeng-browser-proxy text2video-plan --prompt '保留参考视频的手势节奏和镜头推进，换成新护肤品展示，自拍视频质感，轻微手持晃动，自然口播停顿' --firstFrameUri tos-cn-i-tb4s082cfz/reference-start.png --lastFrameUri tos-cn-i-tb4s082cfz/reference-end.png --ratio 9:16 --videoResolution 1080p --durationSec 5",
      buildJimengVideoDirectPlan({
        prompt: "保留参考视频的手势节奏和镜头推进，换成新护肤品展示，自拍视频质感，轻微手持晃动，自然口播停顿",
        firstFrameUri: "tos-cn-i-tb4s082cfz/reference-start.png",
        lastFrameUri: "tos-cn-i-tb4s082cfz/reference-end.png",
        ratio: "9:16",
        videoResolution: "1080p",
        durationSec: 5,
        fps: 24,
        seed: 2_026_061_103,
        submitId: "snapshot-frames-reference-transfer",
        nowMs: 1_781_234_569_000,
      }),
    ),
    omniVideoSnapshot(
      "omni-reference-profile-transfer",
      "All-around reference plan for swapping a new persona into a reference profile's timing, pose, and hand-motion template.",
      "jimeng-browser-proxy omni-video-plan --prompt '@image_file_1 as the new Korean beauty host, mimic timing and hand gestures from @video_file_1, swap the hook to a cushion foundation CTA' --materials '[{\"type\":\"image\",\"fieldName\":\"image_file_1\",\"uri\":\"tos-cn-i-tb4s082cfz/kbeauty-persona.png\",\"width\":1080,\"height\":1920},{\"type\":\"video\",\"fieldName\":\"video_file_1\",\"vid\":\"v03870g10004d8k1u4nog65hb08dnhig\",\"width\":1080,\"height\":1920,\"durationSec\":8}]' --modelVersion jimeng-video-seedance-2.0 --durationSec 8",
      buildJimengVideoOmniReferencePlan({
        prompt: "@image_file_1 as the new Korean beauty host, mimic timing and hand gestures from @video_file_1, swap the hook to a cushion foundation CTA",
        materials: parseJimengVideoOmniMaterialsJson([
          {
            type: "image",
            fieldName: "image_file_1",
            uri: "tos-cn-i-tb4s082cfz/kbeauty-persona.png",
            width: 1080,
            height: 1920,
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
        seed: 2_026_061_104,
        submitId: "snapshot-omni-reference-transfer",
        nowMs: 1_781_234_570_000,
      }),
    ),
  ]
}

function text2ImageSnapshot(
  workflow: string,
  productUse: string,
  cliExample: string,
  plan: JimengText2ImageDirectPlan,
): GenerationPlanSnapshot {
  const component = firstComponent(plan.draftContent)
  const abilities = objectField(component, "abilities")
  const generate = objectField(abilities, "generate")
  const coreParam = objectField(generate, "core_param")
  const largeImageInfo = objectField(coreParam, "large_image_info")
  const sceneOption = firstArrayObject(parseJsonStringField(plan.metricsExtra, "sceneOptions"))

  return {
    workflow,
    valueRank: 1,
    productUse,
    cliExample,
    summary: summarizeJimengText2ImageDirectPlan(plan),
    contract: {
      request_keys: sortedKeys(plan.request),
      extend_keys: sortedKeys(objectField(plan.request, "extend")),
      draft: {
        type: plan.draftContent.type,
        version: plan.draftContent.version,
        component_type: component.type,
        aigc_mode: component.aigc_mode,
        generate_type: component.generate_type,
      },
      core_param: {
        model: coreParam.model,
        prompt: coreParam.prompt,
        sample_strength: coreParam.sample_strength,
        image_ratio: coreParam.image_ratio,
        intelligent_ratio: coreParam.intelligent_ratio,
        seed: coreParam.seed,
        negative_prompt: coreParam.negative_prompt,
        large_image_info: {
          width: largeImageInfo.width,
          height: largeImageInfo.height,
          resolution_type: largeImageInfo.resolution_type,
        },
      },
      scene_option: {
        type: sceneOption.type,
        scene: sceneOption.scene,
        modelReqKey: sceneOption.modelReqKey,
        resolutionType: sceneOption.resolutionType,
        benefitCount: sceneOption.benefitCount,
      },
    },
  }
}

function text2VideoSnapshot(
  workflow: string,
  productUse: string,
  cliExample: string,
  plan: JimengVideoDirectPlan,
): GenerationPlanSnapshot {
  const component = firstComponent(plan.draftContent)
  const abilities = objectField(component, "abilities")
  const genVideo = objectField(abilities, "gen_video")
  const params = objectField(genVideo, "text_to_video_params")
  const videoInput = firstArrayObject(arrayField(params, "video_gen_inputs"))
  const sceneOption = firstArrayObject(parseJsonStringField(plan.metricsExtra, "sceneOptions"))
  const extend = objectField(plan.request, "extend")

  return {
    workflow,
    valueRank: 1,
    productUse,
    cliExample,
    summary: summarizeJimengVideoDirectPlan(plan),
    contract: {
      request_keys: sortedKeys(plan.request),
      extend_keys: sortedKeys(extend),
      draft: {
        type: plan.draftContent.type,
        version: plan.draftContent.version,
        component_type: component.type,
        aigc_mode: component.aigc_mode,
        generate_type: component.generate_type,
        process_type: component.process_type,
      },
      commerce: {
        benefit_type: objectField(extend, "m_video_commerce_info").benefit_type,
        resource_id: objectField(extend, "m_video_commerce_info").resource_id,
      },
      text_to_video_params: {
        video_aspect_ratio: params.video_aspect_ratio,
        model_req_key: params.model_req_key,
        priority: params.priority,
      },
      video_input: {
        prompt: videoInput.prompt,
        video_mode: videoInput.video_mode,
        fps: videoInput.fps,
        duration_ms: videoInput.duration_ms,
        resolution: videoInput.resolution,
        seed: videoInput.seed,
        first_frame_image: videoInput.first_frame_image ?? null,
        end_frame_image: videoInput.end_frame_image ?? null,
      },
      scene_option: {
        type: sceneOption.type,
        scene: sceneOption.scene,
        modelReqKey: sceneOption.modelReqKey,
        resolution: sceneOption.resolution,
        videoDuration: sceneOption.videoDuration,
        materialTypes: sceneOption.materialTypes,
      },
    },
  }
}

function omniVideoSnapshot(
  workflow: string,
  productUse: string,
  cliExample: string,
  plan: JimengVideoOmniReferencePlan,
): GenerationPlanSnapshot {
  const component = firstComponent(plan.draftContent)
  const abilities = objectField(component, "abilities")
  const genVideo = objectField(abilities, "gen_video")
  const params = objectField(genVideo, "text_to_video_params")
  const videoInput = firstArrayObject(arrayField(params, "video_gen_inputs"))
  const unifiedEdit = objectField(videoInput, "unified_edit_input")
  const sceneOption = firstArrayObject(parseJsonStringField(plan.metricsExtra, "sceneOptions"))
  const extend = objectField(plan.request, "extend")

  return {
    workflow,
    valueRank: 1,
    productUse,
    cliExample,
    summary: summarizeJimengVideoOmniReferencePlan(plan),
    contract: {
      request_keys: sortedKeys(plan.request),
      extend_keys: sortedKeys(extend),
      draft: {
        type: plan.draftContent.type,
        version: plan.draftContent.version,
        min_features: plan.draftContent.min_features,
        component_type: component.type,
        aigc_mode: component.aigc_mode,
        generate_type: component.generate_type,
        process_type: component.process_type,
      },
      commerce: {
        benefit_type: objectField(extend, "m_video_commerce_info").benefit_type,
        resource_id: objectField(extend, "m_video_commerce_info").resource_id,
      },
      text_to_video_params: {
        video_aspect_ratio: params.video_aspect_ratio,
        model_req_key: params.model_req_key,
        priority: params.priority,
      },
      video_input: {
        prompt: videoInput.prompt,
        fps: videoInput.fps,
        duration_ms: videoInput.duration_ms,
        has_unified_edit_input: !!videoInput.unified_edit_input,
      },
      unified_edit_input: {
        material_types: arrayField(unifiedEdit, "material_list").map((material) => objectValue(material, "material").material_type),
        material_count: arrayField(unifiedEdit, "material_list").length,
        meta_list: arrayField(unifiedEdit, "meta_list").map((meta) => {
          const metaObject = objectValue(meta, "meta")
          const materialRef = metaObject.material_ref && typeof metaObject.material_ref === "object" && !Array.isArray(metaObject.material_ref)
            ? metaObject.material_ref
            : null
          return {
            meta_type: metaObject.meta_type,
            text_present: typeof metaObject.text === "string" && metaObject.text.length > 0,
            material_idx: materialRef?.material_idx ?? null,
          }
        }),
      },
      scene_option: {
        type: sceneOption.type,
        scene: sceneOption.scene,
        modelReqKey: sceneOption.modelReqKey,
        videoDuration: sceneOption.videoDuration,
        materialTypes: sceneOption.materialTypes,
      },
      metrics: {
        functionMode: plan.metricsExtra.functionMode,
        isDefaultSeed: plan.metricsExtra.isDefaultSeed,
      },
    },
  }
}

function firstComponent(draftContent: JsonObject): JsonObject {
  return firstArrayObject(arrayField(draftContent, "component_list"))
}

function parseJsonStringField(object: JsonObject, key: string): JsonValue {
  const value = object[key]
  if (typeof value !== "string") throw new Error(`${key} must be a JSON string`)
  return JSON.parse(value) as JsonValue
}

function objectField(object: JsonObject, key: string): JsonObject {
  const value = object[key]
  if (value && typeof value === "object" && !Array.isArray(value)) return value
  throw new Error(`${key} must be an object`)
}

function arrayField(object: JsonObject, key: string): JsonValue[] {
  const value = object[key]
  if (Array.isArray(value)) return value
  throw new Error(`${key} must be an array`)
}

function firstArrayObject(value: JsonValue): JsonObject {
  if (!Array.isArray(value)) throw new Error("value must be an array")
  const [first] = value
  if (first && typeof first === "object" && !Array.isArray(first)) return first
  throw new Error("first array item must be an object")
}

function objectValue(value: JsonValue, label: string): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) return value
  throw new Error(`${label} must be an object`)
}

function sortedKeys(object: JsonObject): string[] {
  return Object.keys(object).sort()
}
