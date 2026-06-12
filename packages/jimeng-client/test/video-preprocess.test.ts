import { existsSync, mkdtempSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, test } from "bun:test"
import {
  buildJimengVideoPreprocessPlan,
  buildJimengVideoPreprocessQueryPlan,
  compareJimengRequestPlanWithRawNetwork,
  createJimengHttpTransport,
  fetchJimengVideoPreprocessResults,
  JimengVideoPreprocessScene,
  parseJimengVideoPreprocessBodyJson,
  parseJimengVideoPreprocessImageUris,
  submitJimengVideoPreprocess,
  summarizeJimengVideoPreprocessPlan,
  summarizeJimengVideoPreprocessQueryPlan,
  summarizeJimengVideoPreprocessResultLookup,
  summarizeJimengVideoPreprocessSubmitResult,
  validateJimengVideoPreprocessQueryRequest,
  validateJimengVideoPreprocessRequest,
  type JsonObject,
} from "../src"

const session = {
  cookie: "sessionid=test",
  userAgent: "Mozilla/5.0 Test",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/generate/",
}

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

  test("submits and summarizes pre-process task responses through the typed client", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const result = await submitJimengVideoPreprocess({
      fetch: mockFetch(JSON.stringify(preprocessSubmitBody()), requests),
      session,
      preprocess: {
        mode: "image-create-avatar",
        submitId: "avatar-detect-1",
        imageUri: "tos-cn-i-tb4s082cfz/k-beauty-host.png",
      },
    })

    expect(requests[0]?.url).toContain("/mweb/v1/video_generate/pre_process")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      input_list: [
        {
          submit_id: "avatar-detect-1",
          scene: 2,
          image_create_avatar: {
            image: { image_uri: "tos-cn-i-tb4s082cfz/k-beauty-host.png" },
            detection_scene: "ugc_lip_sync_avatar",
          },
        },
      ],
    })
    expect(result.tasks).toEqual([
      {
        submitId: "avatar-detect-1",
        scene: 2,
        status: "submitted",
        errmsg: null,
        keys: ["scene", "status", "submit_id"],
      },
    ])
    expect(summarizeJimengVideoPreprocessSubmitResult(result)).toMatchObject({
      endpoint: "/mweb/v1/video_generate/pre_process",
      ret: "0",
      task_count: 1,
    })
  })

  test("fetches pre-process results and records/replays transport cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-video-preprocess-cassette-"))
    try {
      const cassettePath = path.join(dir, "video-preprocess.json")
      const requests: Array<{ url: string; init?: RequestInit }> = []
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: mockFetchSequence([
          JSON.stringify(preprocessSubmitBody()),
          JSON.stringify(preprocessResultBody()),
        ], requests),
        nowIso: () => "2026-06-12T00:00:00.000Z",
      })

      const submitted = await submitJimengVideoPreprocess({
        fetch: recordTransport.fetch,
        session,
        preprocess: {
          mode: "voice-recommendation",
          submitId: "voice-match-1",
          imageUri: "tos-cn-i-tb4s082cfz/k-beauty-host.png",
        },
      })
      const result = await fetchJimengVideoPreprocessResults({
        fetch: recordTransport.fetch,
        session,
        submitIds: ["voice-match-1"],
      })

      expect(submitted.tasks).toHaveLength(1)
      expect(result.tasks).toEqual([
        {
          submitId: "voice-match-1",
          scene: 7,
          status: 50,
          errmsg: null,
          keys: ["result", "scene", "status", "submit_id"],
        },
      ])
      expect(summarizeJimengVideoPreprocessResultLookup(result)).toMatchObject({
        endpoint: "/mweb/v1/video_generate/mget_pre_process_result",
        task_count: 1,
      })
      expect(existsSync(cassettePath)).toBe(true)

      const replayTransport = createJimengHttpTransport({
        mode: "replay",
        cassettePath,
        fetch: failIfLiveFetch,
      })
      const replaySubmitted = await submitJimengVideoPreprocess({
        fetch: replayTransport.fetch,
        session,
        preprocess: {
          mode: "voice-recommendation",
          submitId: "voice-match-1",
          imageUri: "tos-cn-i-tb4s082cfz/k-beauty-host.png",
        },
      })
      const replayResult = await fetchJimengVideoPreprocessResults({
        fetch: replayTransport.fetch,
        session,
        submitIds: ["voice-match-1"],
      })

      expect(replaySubmitted.responseTextSha256).toBe(submitted.responseTextSha256)
      expect(replayResult.responseTextSha256).toBe(result.responseTextSha256)
    } finally {
      // Temporary cassette directory is intentionally left to the OS tmp cleaner.
    }
  })

  test("rejects provider errors in pre-process responses", async () => {
    await expect(submitJimengVideoPreprocess({
      fetch: mockFetch(JSON.stringify({ ret: 1000, errmsg: "invalid parameter" })),
      session,
      preprocess: {
        mode: "audio-detect",
        submitId: "audio-detect-1",
        audioVid: "v0audio123",
      },
    })).rejects.toThrow("ret=1000")
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

function preprocessSubmitBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      task_list: [
        {
          submit_id: "avatar-detect-1",
          scene: 2,
          status: "submitted",
        },
      ],
    },
  }
}

function preprocessResultBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      result_list: [
        {
          submit_id: "voice-match-1",
          scene: 7,
          status: 50,
          result: {
            recommended_tone_id: "7597003459665072686",
          },
        },
      ],
    },
  }
}

function mockFetch(body: string, requests: Array<{ url: string; init?: RequestInit }> = []) {
  return async (url: string, init?: RequestInit) => {
    requests.push({ url, init })
    return responseFromText(body)
  }
}

function mockFetchSequence(bodies: string[], requests: Array<{ url: string; init?: RequestInit }> = []) {
  let index = 0
  return async (url: string, init?: RequestInit) => {
    requests.push({ url, init })
    const body = bodies[index]
    index += 1
    return responseFromText(body ?? bodies[bodies.length - 1] ?? "{}")
  }
}

async function failIfLiveFetch(): Promise<never> {
  throw new Error("unexpected live fetch")
}

function responseFromText(body: string) {
  const bytes = new TextEncoder().encode(body)
  return {
    ok: true,
    status: 200,
    async text() {
      return body
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
  }
}
