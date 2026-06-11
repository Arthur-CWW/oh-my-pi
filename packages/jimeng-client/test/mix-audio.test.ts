import { describe, expect, test } from "bun:test"
import {
  buildJimengMixAudioVideoPlan,
  parseJimengMixAudioInputListJson,
  parseJimengMixAudioJsonObject,
  summarizeJimengMixAudioVideoPlan,
  validateJimengMixAudioBatchRequest,
  validateJimengMixAudioSingleRequest,
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
    expect(summarizeJimengMixAudioVideoPlan(plan)).toMatchObject({
      endpoint: "/mweb/v1/mix_audio_video",
      input_count: 1,
      has_babi_param: true,
      live_submit: false,
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

  test("snake-cases raw frontend body JSON and rejects missing required paths", () => {
    const plan = buildJimengMixAudioVideoPlan({
      body: parseJimengMixAudioJsonObject({
        input: {
          audioVid: "v0voice123",
          videoItemId: "generated-video-item-1",
        },
        optionalFrontendField: true,
      }, "mix-audio body"),
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
    })).toThrow("mix_audio_video request did not match required fields")
    expect(() => buildJimengMixAudioVideoPlan({ audioVid: "v0voice123" })).toThrow("--videoItemId")
  })
})
