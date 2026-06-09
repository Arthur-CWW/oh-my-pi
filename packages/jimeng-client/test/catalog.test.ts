import { describe, expect, test } from "bun:test"
import {
  fetchVoiceLibraryFromCapture,
  generateTextToSpeech,
  parseCatalogEndpointIds,
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
