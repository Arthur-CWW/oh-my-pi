import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  buildJimengMixAudioVideoPlan,
  parseJimengMixAudioInputListJson,
  parseJimengMixAudioJsonObject,
  summarizeJimengMixAudioVideoPlan,
  validateJimengMixAudioBatchRequest,
  validateJimengMixAudioSingleRequest,
  validateJimengMixAudioQueryParams,
  validateJimengMixAudioVideoPlanRequest,
  executeJimengMixAudioVideo,
  summarizeJimengMixAudioVideoResult,
  createJimengHttpTransport,
  type JsonObject,
} from "../src"

describe("Jimeng audio/video mix dry-run plan", () => {
  test("builds a single audio/video mix request and babi_param query", () => {
    const plan = buildJimengMixAudioVideoPlan({
      audioVid: "v0voice123",
      videoItemId: "generated-video-item-1",
      babiParam: {
        pf: "7",
        scene: "ugc_voice_over",
      },
    })

    expect(plan.endpoint).toBe("/mweb/v1/mix_audio_video")
    expect(plan.method).toBe("POST")
    expect(plan.mode).toBe("single")
    expect(plan.request).toEqual({
      input: {
        audio_vid: "v0voice123",
        video_item_id: "generated-video-item-1",
      },
    })
    expect(plan.queryParams).toEqual({
      babi_param: JSON.stringify({ pf: "7", scene: "ugc_voice_over" }),
    })
    expect(() => validateJimengMixAudioSingleRequest(plan.request)).not.toThrow()
    expect(() => validateJimengMixAudioVideoPlanRequest(plan.request, "single")).not.toThrow()
    expect(() => validateJimengMixAudioQueryParams(plan.queryParams ?? {})).not.toThrow()
    expect(summarizeJimengMixAudioVideoPlan(plan)).toMatchObject({
      endpoint: "/mweb/v1/mix_audio_video",
      input_count: 1,
      has_babi_param: true,
      live_submit: false,
      required_request_paths: ["request.input.audio_vid", "request.input.video_item_id"],
    })
  })

  test("builds a batch mix request from inputList rows", () => {
    const plan = buildJimengMixAudioVideoPlan({
      inputList: parseJimengMixAudioInputListJson([
        { audioVid: "v0voice-a", videoItemId: "video-item-a" },
        { audioVid: "v0voice-b", videoItemId: "video-item-b" },
      ]),
      babiParam: { pf: "7" },
    })

    expect(plan.endpoint).toBe("/mweb/v1/mix_audio_videos")
    expect(plan.mode).toBe("batch")
    expect(plan.request).toEqual({
      input_list: [
        { audio_vid: "v0voice-a", video_item_id: "video-item-a" },
        { audio_vid: "v0voice-b", video_item_id: "video-item-b" },
      ],
    })
    expect(plan.inputCount).toBe(2)
    expect(() => validateJimengMixAudioBatchRequest(plan.request)).not.toThrow()
  })

  test("validates observed single mix-audio dry-run request contract", () => {
    const plan = buildJimengMixAudioVideoPlan({
      audioVid: "v0personaVoiceAudio",
      videoItemId: "generated-video-item-123",
      babiParam: { pf: "7", scene: "ugc_voice_over" },
    })

    expect(plan.request).toEqual({
      input: {
        audio_vid: "v0personaVoiceAudio",
        video_item_id: "generated-video-item-123",
      },
    })
    expect(plan.queryParams).toEqual({
      babi_param: JSON.stringify({ pf: "7", scene: "ugc_voice_over" }),
    })
    expect(() => validateJimengMixAudioVideoPlanRequest(plan.request, "single")).not.toThrow()
    expect(() => validateJimengMixAudioQueryParams(plan.queryParams ?? {})).not.toThrow()
  })

  test("snake-cases raw frontend body JSON and rejects missing required paths", () => {
    const plan = buildJimengMixAudioVideoPlan({
      body: parseJimengMixAudioJsonObject({
        input: {
          audioVid: "v0voice123",
          videoItemId: "generated-video-item-1",
        },
        optionalFrontendField: true,
      }, "mix-audio body"),
      babiParam: { pf: "7", scene: "ugc_voice_over" },
    })

    expect(plan.request).toMatchObject({
      input: {
        audio_vid: "v0voice123",
        video_item_id: "generated-video-item-1",
      },
      optional_frontend_field: true,
    })

    expect(() => buildJimengMixAudioVideoPlan({
      body: { input: { audio_vid: "v0voice123" } } satisfies JsonObject,
      babiParam: { pf: "7", scene: "ugc_voice_over" },
    })).toThrow("mix_audio_video request did not match required fields")
    expect(() => buildJimengMixAudioVideoPlan({ audioVid: "v0voice123" })).toThrow("--videoItemId")
  })

  test("requires observed babi_param query contract", () => {
    expect(() => buildJimengMixAudioVideoPlan({
      audioVid: "v0voice123",
      videoItemId: "generated-video-item-1",
    })).toThrow("babiParam")
  })
})

const session = {
  cookie: "sessionid=test",
  userAgent: "Mozilla/5.0 Test",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/generate/",
}

function responseFromText(body: string) {
  const bytes = new TextEncoder().encode(body)
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => body,
    json: async () => JSON.parse(body),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

function mockFetch(body: string, requests: Array<{ url: string; init?: RequestInit }> = []) {
  return async (url: string, init?: RequestInit) => {
    requests.push({ url, init })
    return responseFromText(body)
  }
}

async function failIfLiveFetch(): Promise<never> {
  throw new Error("unexpected live fetch")
}

describe("Jimeng audio/video mix service execution", () => {
  test("single endpoint execution matches shape", async () => {
    const mockResponse = {
      ret: "0",
      errmsg: "success",
      data: {
        task_list: [
          {
            task_id: "mix-task-1",
            status: 20,
            video_item_id: "video-item-1",
            audio_vid: "audio-vid-1",
            result: {
              item_id: "mixed-video-item-1",
              video_url: "https://signed.example.invalid/video.mp4?x-signature=secret"
            }
          }
        ]
      }
    }

    const requests: Array<{ url: string; init?: RequestInit }> = []
    const result = await executeJimengMixAudioVideo({
      fetch: mockFetch(JSON.stringify(mockResponse), requests),
      session,
      mix: {
        audioVid: "v0voice123",
        videoItemId: "video-item-1",
        babiParam: { pf: "7", scene: "ugc_voice_over" },
      }
    })

    expect(requests).toHaveLength(1)
    const req = requests[0]
    expect(req.url).toContain("/mweb/v1/mix_audio_video")
    expect(req.url).toContain("babi_param")
    const body = JSON.parse(req.init?.body as string)
    expect(body).toEqual({
      input: {
        audio_vid: "v0voice123",
        video_item_id: "video-item-1",
      }
    })

    expect(result.ret).toBe("0")
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0]).toEqual({
      taskId: "mix-task-1",
      status: 20,
      videoItemId: "video-item-1",
      audioVid: "audio-vid-1",
      itemId: "mixed-video-item-1",
      videoUrl: "https://signed.example.invalid/video.mp4?x-signature=secret",
      errmsg: null,
      keys: ["audio_vid", "result", "status", "task_id", "video_item_id"],
    })
  })

  test("batch endpoint execution matches shape", async () => {
    const mockResponse = {
      ret: "0",
      errmsg: "success",
      data: {
        task_list: [
          {
            task_id: "mix-task-1",
            status: 20,
            video_item_id: "video-item-a",
            audio_vid: "v0voice-a",
          },
          {
            task_id: "mix-task-2",
            status: 20,
            video_item_id: "video-item-b",
            audio_vid: "v0voice-b",
          }
        ]
      }
    }

    const requests: Array<{ url: string; init?: RequestInit }> = []
    const result = await executeJimengMixAudioVideo({
      fetch: mockFetch(JSON.stringify(mockResponse), requests),
      session,
      mix: {
        inputList: [
          { audioVid: "v0voice-a", videoItemId: "video-item-a" },
          { audioVid: "v0voice-b", videoItemId: "video-item-b" },
        ],
        babiParam: { pf: "7", scene: "ugc_voice_over" },
      }
    })

    expect(requests).toHaveLength(1)
    const req = requests[0]
    expect(req.url).toContain("/mweb/v1/mix_audio_videos")
    const body = JSON.parse(req.init?.body as string)
    expect(body).toEqual({
      input_list: [
        { audio_vid: "v0voice-a", video_item_id: "video-item-a" },
        { audio_vid: "v0voice-b", video_item_id: "video-item-b" },
      ]
    })

    expect(result.ret).toBe("0")
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks[0].taskId).toBe("mix-task-1")
    expect(result.tasks[1].taskId).toBe("mix-task-2")
  })

  test("nonzero provider ret rejection", async () => {
    const mockResponse = {
      ret: "1000",
      errmsg: "invalid parameter"
    }

    await expect(executeJimengMixAudioVideo({
      fetch: mockFetch(JSON.stringify(mockResponse)),
      session,
      mix: {
        audioVid: "v0voice123",
        videoItemId: "video-item-1",
        babiParam: { pf: "7", scene: "ugc_voice_over" },
      }
    })).rejects.toThrow("returned ret=1000 errmsg=invalid parameter")
  })

  test("summary redaction does not leak signed URL and matches summary contract", async () => {
    const mockResponse = {
      ret: "0",
      errmsg: "success",
      data: {
        task_list: [
          {
            task_id: "mix-task-1",
            status: 20,
            video_item_id: "video-item-1",
            audio_vid: "audio-vid-1",
            result: {
              item_id: "mixed-video-item-1",
              video_url: "https://signed.example.invalid/video.mp4?x-signature=secret"
            }
          }
        ]
      }
    }

    const result = await executeJimengMixAudioVideo({
      fetch: mockFetch(JSON.stringify(mockResponse)),
      session,
      mix: {
        babiParam: {
          pf: "7",
          scene: "ugc_voice_over",
          signedUrl: "https://signed.example.invalid/video.mp4?x-signature=secret",
        },
        audioVid: "v0voice123",
        videoItemId: "video-item-1",
      }
    })

    const summary = summarizeJimengMixAudioVideoResult(result)

    expect(summary).toEqual({
      endpoint: "/mweb/v1/mix_audio_video",
      http_status: 200,
      ret: "0",
      errmsg: "success",
      response_text_sha256: result.responseTextSha256,
      request: {
        input: {
          audio_vid: "v0voice123",
          video_item_id: "video-item-1",
        }
      },
      query_params: {
        babi_param: "[SIGNED_URL_REDACTED]",
      },
      task_count: 1,
      tasks: [
        {
          task_id: "mix-task-1",
          status: 20,
          video_item_id: "video-item-1",
          audio_vid: "audio-vid-1",
          item_id: "mixed-video-item-1",
          video_url: "[SIGNED_URL_REDACTED]",
          errmsg: null,
          keys: ["audio_vid", "result", "status", "task_id", "video_item_id"],
        }
      ]
    })

    // Assert that the signed URL or query signature is not leaked anywhere in the summary JSON
    const summaryStr = JSON.stringify(summary)
    expect(summaryStr).not.toContain("https://signed.example.invalid")
    expect(summaryStr).not.toContain("x-signature=secret")
  })

  test("records and replays transport cassettes for mix audio", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-mix-audio-cassette-"))
    try {
      const cassettePath = path.join(dir, "mix-audio.json")
      const mockResponse = {
        ret: "0",
        errmsg: "success",
        data: {
          task_list: [
            {
              task_id: "mix-task-1",
              status: 20,
              video_item_id: "video-item-1",
              audio_vid: "audio-vid-1",
            }
          ]
        }
      }

      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: mockFetch(JSON.stringify(mockResponse)),
        nowIso: () => "2026-06-12T00:00:00.000Z",
      })

      const submitted = await executeJimengMixAudioVideo({
        fetch: recordTransport.fetch,
        session,
        mix: {
          audioVid: "v0voice123",
          videoItemId: "video-item-1",
          babiParam: { pf: "7", scene: "ugc_voice_over" },
        }
      })

      expect(submitted.ret).toBe("0")
      expect(submitted.tasks).toHaveLength(1)
      expect(submitted.tasks[0].taskId).toBe("mix-task-1")
      expect(existsSync(cassettePath)).toBe(true)

      const replayTransport = createJimengHttpTransport({
        mode: "replay",
        cassettePath,
        fetch: failIfLiveFetch,
      })

      const replayed = await executeJimengMixAudioVideo({
        fetch: replayTransport.fetch,
        session,
        mix: {
          audioVid: "v0voice123",
          videoItemId: "video-item-1",
          babiParam: { pf: "7", scene: "ugc_voice_over" },
        }
      })

      expect(replayed.responseTextSha256).toBe(submitted.responseTextSha256)
      expect(replayed.tasks).toEqual(submitted.tasks)
    } finally {
      // tmp directory cleaned up by OS
    }
  })
})
