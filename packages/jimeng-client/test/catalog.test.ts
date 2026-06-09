import { describe, expect, test } from "bun:test"
import {
  fetchVoiceLibraryFromCapture,
  fetchLipSyncConfigs,
  generateTextToSpeech,
  parseCatalogEndpointIds,
  summarizeLipSyncConfigs,
  type CaptureFile,
  type JimengFetch,
  type JimengSessionBundle,
  JimengClient,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("Jimeng catalog helpers", () => {
  test("parses endpoint id lists", () => {
    expect(parseCatalogEndpointIds(undefined)).toContain("voice-assets")
    expect(parseCatalogEndpointIds("voice-assets,subject-list")).toEqual(["voice-assets", "subject-list"])
    expect(() => parseCatalogEndpointIds("missing")).toThrow("Unknown Jimeng catalog endpoint")
  })

  test("fetchVoiceLibraryFromCapture replays signed voice feed and normalizes voices", async () => {
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          item_list: [
            {
              common_attr: {
                id: "voice-001",
                title: "直爽女大",
                effect_type: 209,
                loki_effect_id: "178740584",
                web_extra: JSON.stringify({
                  tonetype: JSON.stringify({
                    tag_list: [
                      { type: "language", value: "普通话" },
                      { type: "gender", value: "女" },
                    ],
                    tts_model_info_map: {
                      tts_model_v3: {
                        speaker_id: "saturn-speaker",
                        emotion: [{ emotion: "happy", speaker_id: "saturn-happy" }],
                      },
                    },
                  }),
                }),
              },
            },
          ],
        },
      })),
    })

    const result = await fetchVoiceLibraryFromCapture({
      client,
      session,
      capture: voiceCapture(),
    })

    expect(result.voices).toEqual([
      {
        id: "voice-001",
        title: "直爽女大",
        itemPlatform: 1,
        effectType: 209,
        lokiEffectId: "178740584",
        speakerId: "saturn-speaker",
        tags: [
          { type: "language", value: "普通话" },
          { type: "gender", value: "女" },
        ],
        emotions: [{ emotion: "happy", speakerId: "saturn-happy" }],
      },
    ])
  })

  test("generateTextToSpeech decodes base64 mp3 payload", async () => {
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          data: Buffer.from("mp3-bytes").toString("base64"),
        },
      })),
    })

    const result = await generateTextToSpeech({
      client,
      session,
      tts: {
        text: "这条视频值得试一下。",
        voiceId: "voice-001",
        itemPlatform: 1,
      },
    })

    expect(new TextDecoder().decode(result.audioBytes)).toBe("mp3-bytes")
    expect(result.ret).toBe("0")
  })

  test("fetchLipSyncConfigs probes image and video model configs", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify(lipSyncImageConfigBody()),
        JSON.stringify(lipSyncVideoConfigBody()),
      ], requests),
    })

    const result = await fetchLipSyncConfigs({ client, session })
    const summary = summarizeLipSyncConfigs(result)

    expect(requests.map((request) => request.url)).toEqual([
      expect.stringContaining("/mweb/v1/video_generate/get_common_config"),
      expect.stringContaining("/mweb/v1/video_generate/get_common_config"),
    ])
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ scene: "lip_sync_image_generate_video", params: {} })
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({ scene: "lip_sync_video_generate_video", params: {} })
    expect(summary).toMatchObject({
      image: {
        endpoint: "lip-sync-image-config",
        summary: {
          models: [
            {
              model_req_key: "dreamina_lib_sync_image_quick_1.5",
              model_name: "快速模式",
              options: ["input_media_type", "audio_option"],
            },
          ],
          default_model_idx: 0,
        },
      },
      video: {
        endpoint: "lip-sync-video-config",
        summary: {
          models: [
            {
              model_req_key: "dreamina_lib_sync_base",
              model_name: "基础模式",
              model_tip: "仅仅修改人物口型。适合演讲、对白",
            },
          ],
          default_model_idx: 0,
        },
      },
    })
  })
})

function voiceCapture(): CaptureFile {
  return {
    entries: [
      {
        kind: "request",
        url: "https://jimeng.jianying.com/mweb/v1/feed?signed=true",
        headers: { "user-agent": "CapturedUA" },
        postData: JSON.stringify({ panel: "dreamina_tone" }),
      },
    ],
  }
}

function mockFetch(text: string): JimengFetch {
  return async () => new Response(text, { status: 200 })
}

function mockFetchSequence(texts: string[], requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url, init) => {
    requests.push({ url, init })
    const text = texts.shift()
    return new Response(text ?? "{}", { status: 200 })
  }
}

function lipSyncImageConfigBody(): Record<string, unknown> {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      default_model_idx: 0,
      model_list: [
        {
          model_req_key: "dreamina_lib_sync_image_quick_1.5",
          model_name: "快速模式",
          model_tip: "更低成本，快速生成",
          feats: [],
          options: [
            { key: "input_media_type" },
            { key: "audio_option" },
          ],
          commercial_config: {
            default: {
              benefit_type: "lip_sync_avatar_omni_15_quick",
              amount: 0,
            },
          },
        },
      ],
    },
  }
}

function lipSyncVideoConfigBody(): Record<string, unknown> {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      default_model_idx: 0,
      model_list: [
        {
          model_req_key: "dreamina_lib_sync_base",
          model_name: "基础模式",
          model_tip: "仅仅修改人物口型。适合演讲、对白",
          feats: [],
          options: [],
          commercial_config: {
            default: {
              benefit_type: "lip_sync_avatar_std",
              amount: 0,
            },
          },
        },
      ],
    },
  }
}
