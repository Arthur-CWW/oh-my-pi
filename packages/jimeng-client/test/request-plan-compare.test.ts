import { describe, expect, test } from "bun:test"
import {
  buildJimengSubjectVoiceRequest,
  buildJimengVoiceCloneSubmitRequest,
  compareJimengRequestPlanWithCaptureTemplate,
  compareJimengRequestPlanWithRawNetwork,
  summarizeJimengRequestPlanCompare,
} from "../src"

describe("Jimeng generic request-plan capture compare", () => {
  test("matches a subject voice dry-run plan against raw-network traffic", () => {
    const request = buildJimengSubjectVoiceRequest({
      imageUri: "tos-cn-i-private-avatar-asset/avatar-secret.png",
    })
    const captured = {
      ...request,
      provider_added_optional_field: "ignored",
    }

    const result = compareJimengRequestPlanWithRawNetwork({
      dryRunPlanText: JSON.stringify(dryRunPlan("subject-generate-voice", "/mweb/v1/dreamina_subject/generate_voice", request)),
      rawNetworkText: jsonl(
        rawRequestEvent("ignored", "/mweb/v1/get_user_local_item_list", { effect_type: 218 }),
        rawRequestEvent("subject-voice-1", "/mweb/v1/dreamina_subject/generate_voice", captured),
      ),
    })

    expect(result.match).toBe(true)
    expect(result.plan_endpoint).toBe("/mweb/v1/dreamina_subject/generate_voice")
    expect(result.plan_request_keys).toEqual(["image_uri"])
    expect(result.candidate_count).toBe(1)
    expect(result.candidates[0]?.endpoint_match).toBe(true)
    expect(result.candidates[0]?.request_match).toBe(true)
    expect(result.candidates[0]?.difference_count).toBe(0)
  })

  test("matches a voice clone submit plan against a capture-template request", () => {
    const request = buildJimengVoiceCloneSubmitRequest({
      submitId: "submit-voice-clone-compare-1",
      audio: {
        vid: "v03870g10004d8k1u4nog65hb08dnhig",
        audioUrl: "https://vlabvod.example/private/audio.mp3?x-signature=secret",
        duration: 8.2,
        title: "reference voice",
      },
      name: "Kbeauty reference voice",
    })
    const result = compareJimengRequestPlanWithCaptureTemplate({
      dryRunPlanText: JSON.stringify(dryRunPlan("voice-clone-submit", "/mweb/v1/voice/submit_task", request)),
      captureTemplateText: JSON.stringify({
        entries: [
          {
            kind: "request",
            url: "https://jimeng.jianying.com/mweb/v1/voice/submit_task?aid=513695",
            postData: JSON.stringify(request),
          },
        ],
      }),
    })

    expect(result.match).toBe(true)
    expect(result.plan_request_keys).toEqual(["scene", "submit_id", "voice_clone"])
    expect(result.candidates[0]?.request_id).toBe("capture-template-0")
  })

  test("reports request drift without leaking provider asset strings", () => {
    const request = buildJimengSubjectVoiceRequest({
      imageUri: "tos-cn-i-private-avatar-asset/avatar-secret.png",
    })
    const result = compareJimengRequestPlanWithRawNetwork({
      dryRunPlanText: JSON.stringify(dryRunPlan("subject-generate-voice", "/mweb/v1/dreamina_subject/generate_voice", request)),
      rawNetworkText: jsonl(rawRequestEvent("subject-voice-drift", "/mweb/v1/dreamina_subject/generate_voice", {
        image_uri: "tos-cn-i-private-avatar-asset/different-secret.png",
      })),
    })
    const summary = summarizeJimengRequestPlanCompare(result)
    const summaryText = JSON.stringify(summary)

    expect(result.match).toBe(false)
    expect(result.candidates[0]?.differences.map((difference) => difference.path)).toContain("request.image_uri")
    expect(summaryText).not.toContain("avatar-secret")
    expect(summaryText).not.toContain("different-secret")
    expect(summaryText).toContain("sha256")
  })

  test("requires an endpoint override for ambiguous request plans", () => {
    const plan = {
      command: "multi-step-plan",
      endpoint_sequence: ["/mweb/v1/voice/update", "/mweb/v1/voice/delete"],
      request: { local_item_id: "voice-id-1" },
    }

    expect(() => compareJimengRequestPlanWithRawNetwork({
      dryRunPlanText: JSON.stringify(plan),
      rawNetworkText: jsonl(rawRequestEvent("voice-delete-1", "/mweb/v1/voice/delete", { local_item_id: "voice-id-1" })),
    })).toThrow("multiple endpoints")

    const result = compareJimengRequestPlanWithRawNetwork({
      dryRunPlanText: JSON.stringify(plan),
      endpoint: "/mweb/v1/voice/delete",
      rawNetworkText: jsonl(rawRequestEvent("voice-delete-1", "/mweb/v1/voice/delete", { local_item_id: "voice-id-1" })),
    })
    expect(result.match).toBe(true)
  })
})

function dryRunPlan(command: string, endpoint: string, request: object) {
  return {
    command,
    status: "dry-run-only",
    endpoint_sequence: [endpoint],
    request,
    browser_session_required: false,
  }
}

function rawRequestEvent(requestId: string, endpoint: string, submitBody: object) {
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
