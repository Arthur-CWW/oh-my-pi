import { describe, expect, test } from "bun:test"
import {
  buildJimengVideoPreprocessPlan,
  buildJimengVideoPreprocessQueryPlan,
  compareJimengRequestPlanWithRawNetwork,
  JimengVideoPreprocessScene,
  parseJimengVideoPreprocessBodyJson,
  parseJimengVideoPreprocessImageUris,
  summarizeJimengVideoPreprocessPlan,
  summarizeJimengVideoPreprocessQueryPlan,
  validateJimengVideoPreprocessQueryRequest,
  validateJimengVideoPreprocessRequest,
  type JsonObject,
} from "../src"

describe("Jimeng video preprocess dry-run plans", () => {
  test("builds an image/avatar pre-process request for lip-sync host checks", () => {
    const plan = buildJimengVideoPreprocessPlan({
      mode: "image-create-avatar",
      submitId: "avatar-detect-1",
      imageUri: "tos-cn-i-tb4s082cfz/k-beauty-host.png",
      detectionScene: "ugc_lip_sync_avatar",
    })

    expect(plan.endpoint).toBe("/mweb/v1/video_generate/pre_process")
    expect(plan.method).toBe("POST")
    expect(plan.request).toEqual({
      input_list: [
        {
          submit_id: "avatar-detect-1",
          scene: JimengVideoPreprocessScene.ImageCreateAvatar,
          image_create_avatar: {
            image: { image_uri: "tos-cn-i-tb4s082cfz/k-beauty-host.png" },
            detection_scene: "ugc_lip_sync_avatar",
          },
        },
      ],
    })
    expect(() => validateJimengVideoPreprocessRequest(plan.request)).not.toThrow()
    expect(summarizeJimengVideoPreprocessPlan(plan)).toMatchObject({
      endpoint: "/mweb/v1/video_generate/pre_process",
      mode: "image-create-avatar",
      input_count: 1,
      scenes: [2],
      scene_names: ["ImageCreateAvatar"],
      live_submit: false,
    })
  })

  test("builds voice recommendation and audio pre-process task variants", () => {
    const voicePlan = buildJimengVideoPreprocessPlan({
      mode: "voice-recommendation",
      submitId: "voice-match-1",
      imageUris: parseJimengVideoPreprocessImageUris([
        "tos-cn-i-tb4s082cfz/ref-a.png",
        "tos-cn-i-tb4s082cfz/ref-b.png",
      ]),
    })
    const audioDetectPlan = buildJimengVideoPreprocessPlan({
      mode: "audio-detect",
      submitId: "audio-detect-1",
      audioVid: "v0audio123",
    })
    const silencePlan = buildJimengVideoPreprocessPlan({
      mode: "audio-silence",
      submitId: "silence-1",
      prompt: "测试这段口播是否有明显空白。",
    })

    expect(voicePlan.request).toMatchObject({
      input_list: [
        {
          scene: 7,
          lip_sync_voice_match: {
            image_list: [
              { image_uri: "tos-cn-i-tb4s082cfz/ref-a.png" },
              { image_uri: "tos-cn-i-tb4s082cfz/ref-b.png" },
            ],
          },
        },
      ],
    })
    expect(audioDetectPlan.scenes).toEqual([5])
    expect(silencePlan.scenes).toEqual([6])
  })

  test("snake-cases raw frontend bodies and validates required mode paths", () => {
    const plan = buildJimengVideoPreprocessPlan({
      mode: "raw",
      body: parseJimengVideoPreprocessBodyJson({
        inputList: [
          {
            submitId: "raw-1",
            scene: 5,
            lipSyncAudioDetect: {
              audio: { vid: "v0audio123" },
            },
          },
        ],
      }),
    })

    expect(plan.request).toEqual({
      input_list: [
        {
          submit_id: "raw-1",
          scene: 5,
          lip_sync_audio_detect: {
            audio: { vid: "v0audio123" },
          },
        },
      ],
    })

    expect(() => buildJimengVideoPreprocessPlan({
      mode: "audio-detect",
      submitId: "audio-detect-1",
    })).toThrow("--audioVid")
    expect(() => validateJimengVideoPreprocessRequest({
      input_list: [{ submit_id: "broken", scene: 5 }],
    } satisfies JsonObject)).toThrow("LipSyncAudioDetect task requires lip_sync_audio_detect")
  })

  test("builds result query request and can use generic request-plan compare", () => {
    const queryPlan = buildJimengVideoPreprocessQueryPlan(["avatar-detect-1", "voice-match-1"])

    expect(queryPlan.endpoint).toBe("/mweb/v1/video_generate/mget_pre_process_result")
    expect(queryPlan.request).toEqual({
      submit_id_list: ["avatar-detect-1", "voice-match-1"],
    })
    expect(() => validateJimengVideoPreprocessQueryRequest(queryPlan.request)).not.toThrow()
    expect(summarizeJimengVideoPreprocessQueryPlan(queryPlan)).toMatchObject({
      endpoint: "/mweb/v1/video_generate/mget_pre_process_result",
      submit_id_count: 2,
      live_submit: false,
    })

    const result = compareJimengRequestPlanWithRawNetwork({
      dryRunPlanText: JSON.stringify({
        command: "video-preprocess-query-plan",
        endpoint: queryPlan.endpoint,
        request: queryPlan.request,
      }),
      rawNetworkText: jsonl(rawRequestEvent("pre-result-1", queryPlan.endpoint, {
        ...queryPlan.request,
        provider_added_optional_field: true,
      })),
    })

    expect(result.match).toBe(true)
    expect(result.plan_endpoint).toBe("/mweb/v1/video_generate/mget_pre_process_result")
  })
})

function rawRequestEvent(requestId: string, endpoint: string, submitBody: JsonObject) {
  return {
    kind: "cdpEvent",
    method: "Network.requestWillBeSent",
    params: {
      requestId,
      request: {
        url: `https://jimeng.jianying.com${endpoint}?aid=513695`,
        method: "POST",
        postData: JSON.stringify(submitBody),
      },
    },
  }
}

function jsonl(...events: object[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`
}
