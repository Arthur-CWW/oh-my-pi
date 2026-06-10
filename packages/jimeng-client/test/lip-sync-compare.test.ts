import { describe, expect, test } from "bun:test"
import {
  buildJimengLipSyncImagePlan,
  buildJimengLipSyncVideoPlan,
  compareJimengLipSyncPlanWithCaptureTemplate,
  compareJimengLipSyncPlanWithRawNetwork,
  summarizeJimengLipSyncCompare,
} from "../src"

describe("Jimeng lip-sync capture compare", () => {
  test("matches a VOD lip-sync dry-run plan against raw-network submit capture", () => {
    const plan = buildJimengLipSyncVideoPlan({
      video: videoReference(),
      ttsInfo: ttsInfo(),
    })
    const submitBody = submitBodyFromVideoInput(plan.providerInput.modelReqKey, plan.providerInput.videoGenInputs)
    const result = compareJimengLipSyncPlanWithRawNetwork({
      dryRunPlanText: JSON.stringify({ plan }),
      rawNetworkText: jsonl(rawRequestEvent("req-1", submitBody)),
    })

    expect(result.match).toBe(true)
    expect(result.mode).toBe("video")
    expect(result.candidates[0]?.model_req_key_match).toBe(true)
    expect(result.candidates[0]?.provider_input_match).toBe(true)
    expect(result.candidates[0]?.difference_count).toBe(0)
  })

  test("reports path-level mismatches without raw provider URL values", () => {
    const plan = buildJimengLipSyncVideoPlan({
      video: videoReference(),
      ttsInfo: ttsInfo(),
    })
    const changedInput = {
      ...plan.providerInput.videoGenInputs,
      v2vOpt: {
        lipSyncUserVideo: {
          ...plan.providerInput.videoGenInputs.v2vOpt.lipSyncUserVideo,
          ttsInfo: {
            ...plan.providerInput.videoGenInputs.v2vOpt.lipSyncUserVideo.ttsInfo,
            toneId: "different-tone",
          },
        },
      },
    }
    const result = compareJimengLipSyncPlanWithRawNetwork({
      dryRunPlanText: JSON.stringify({ plan }),
      rawNetworkText: jsonl(rawRequestEvent("req-1", submitBodyFromVideoInput(plan.providerInput.modelReqKey, changedInput))),
    })
    const summary = summarizeJimengLipSyncCompare(result)

    expect(result.match).toBe(false)
    expect(result.candidates[0]?.differences.map((difference) => difference.path)).toContain("videoGenInputs.v2vOpt.lipSyncUserVideo.ttsInfo.toneId")
    expect(JSON.stringify(summary)).not.toContain("tos-cn-v-148450")
    expect(JSON.stringify(summary)).not.toContain("https://signed.example.invalid")
  })

  test("matches an image/avatar dry-run plan against capture-template request", () => {
    const plan = buildJimengLipSyncImagePlan({
      image: {
        uri: "tos-cn-i-demo/avatar.png",
        width: 1024,
        height: 1024,
      },
      ttsInfo: ttsInfo(),
    })
    const captureTemplate = {
      entries: [
        {
          kind: "request",
          url: "https://jimeng.jianying.com/mweb/v1/aigc_draft/generate?aid=513695",
          postData: JSON.stringify(submitBodyFromVideoInput(plan.providerInput.modelReqKey, plan.providerInput.videoGenInputs)),
        },
      ],
    }

    const result = compareJimengLipSyncPlanWithCaptureTemplate({
      dryRunPlanText: JSON.stringify({ plan }),
      captureTemplateText: JSON.stringify(captureTemplate),
    })

    expect(result.match).toBe(true)
    expect(result.mode).toBe("image")
    expect(result.candidates[0]?.mode).toBe("image")
  })
})

function ttsInfo() {
  return {
    sourceType: "text-to-speech" as const,
    text: "三秒告诉你为什么这款补水精华适合熬夜后的底妆。",
    speed: 1,
    toneId: "7597003459665072686",
    toneKey: "清爽女声",
  }
}

function videoReference() {
  return {
    vid: "v03870g10004d8k1u4nog65hb08dnhig",
    uri: "tos-cn-v-148450/o4gBE1AAWbfiDDig6xEQ4KJhDHQvlExoFkFExB",
    width: 704,
    height: 1248,
    duration: 5.016667,
  }
}

function submitBodyFromVideoInput(modelReqKey: string, videoInput: object) {
  return {
    submit_id: "ui-submit-id",
    draft_content: JSON.stringify({
      component_list: [
        {
          abilities: {
            gen_video: {
              text_to_video_params: {
                model_req_key: modelReqKey,
                video_gen_inputs: [videoInput],
              },
            },
          },
        },
      ],
    }),
  }
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
