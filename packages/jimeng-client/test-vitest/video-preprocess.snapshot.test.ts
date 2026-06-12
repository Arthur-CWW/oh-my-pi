import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  buildJimengVideoPreprocessPlan,
  buildJimengVideoPreprocessQueryPlan,
  summarizeJimengVideoPreprocessPlan,
  summarizeJimengVideoPreprocessQueryPlan,
} from "../src"

describe("Jimeng video preprocess snapshots", () => {
  it.effect("snapshots lip-sync/digital-human preprocess request plans", () =>
    Effect.sync(() => {
      const avatar = buildJimengVideoPreprocessPlan({
        mode: "image-create-avatar",
        submitId: "snapshot-avatar-detect",
        imageUri: "tos-cn-i-tb4s082cfz/kbeauty-host.png",
        detectionScene: "ugc_lip_sync_avatar",
      })
      const voice = buildJimengVideoPreprocessPlan({
        mode: "voice-recommendation",
        submitId: "snapshot-voice-match",
        imageUris: [
          "tos-cn-i-tb4s082cfz/kbeauty-host.png",
          "tos-cn-i-tb4s082cfz/kbeauty-profile.png",
        ],
      })
      const audio = buildJimengVideoPreprocessPlan({
        mode: "audio-detect",
        submitId: "snapshot-audio-detect",
        audioVid: "v0audio123",
      })
      const silence = buildJimengVideoPreprocessPlan({
        mode: "audio-silence",
        submitId: "snapshot-audio-silence",
        prompt: "三秒告诉你为什么熬夜后底妆会卡粉。",
      })
      const query = buildJimengVideoPreprocessQueryPlan([
        avatar.inputList[0]?.submit_id as string,
        voice.inputList[0]?.submit_id as string,
        audio.inputList[0]?.submit_id as string,
        silence.inputList[0]?.submit_id as string,
      ])

      expect({
        plans: [avatar, voice, audio, silence].map((plan) => ({
          summary: summarizeJimengVideoPreprocessPlan(plan),
          request: plan.request,
        })),
        query: {
          summary: summarizeJimengVideoPreprocessQueryPlan(query),
          request: query.request,
        },
      }).toMatchSnapshot()
    }))
})
