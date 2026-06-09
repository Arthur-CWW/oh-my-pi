import { describe, expect, test } from "bun:test"
import { createKieTask, prepareKieTask } from "../src/kie"

describe("kie provider adapter", () => {
  test("builds a Seedream text-to-image payload without a live call", () => {
    const prepared = prepareKieTask({
      operation: "image-text",
      prompt: "韩系美妆UGC创作者，手机自拍构图，无文字，无水印",
      aspectRatio: "9:16",
      quality: "basic",
    })

    expect(prepared.provider).toBe("kie")
    expect(prepared.model).toBe("seedream/5-lite-text-to-image")
    expect(prepared.estimatedCostUsd).toBe(0.02)
    expect(prepared.payload).toEqual({
      model: "seedream/5-lite-text-to-image",
      input: {
        prompt: "韩系美妆UGC创作者，手机自拍构图，无文字，无水印",
        aspect_ratio: "9:16",
        quality: "basic",
        nsfw_checker: false,
      },
    })
  })

  test("dry-run create does not require an API key", async () => {
    const result = await createKieTask({
      operation: "video-text",
      prompt: "short UGC product demo, natural phone video",
      durationSec: 5,
      resolution: "720p",
    })

    expect(result.mode).toBe("dry-run")
    expect(result.prepared.model).toBe("bytedance/v1-lite-text-to-video")
  })

  test("live create blocks requests above the spend cap before reading credentials", async () => {
    await expect(createKieTask({
      operation: "image-text",
      prompt: "cheap image draft",
    }, {
      live: true,
      maxSpendUsd: 0.01,
    })).rejects.toThrow("exceeds max $0.01")
  })
})
