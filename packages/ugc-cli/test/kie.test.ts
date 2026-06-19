import { describe, expect, test } from "bun:test"
import { createKieTask, planKieFromAnalysis, prepareKieTask } from "../src/kie"

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


  test("plans a dry-run KIE request from Codex analysis ingredients", () => {
    const request = planKieFromAnalysis({
      lane: "brainrot",
      target: {
        kind: "candidate",
        id: "candidate_hook",
        title: "Cold open test",
        summary: "Messy desk hook with fast caption cadence.",
        lane: "brainrot",
        notes: ["preserve chaotic timing", "swap source identity"],
      },
      codexRequest: {
        provider: "codex",
        operation: "video-understand",
        payload: {
          messages: [
            { role: "system", content: "stub" },
            { role: "user", content: [{ type: "text", text: "Extract reusable hook mechanics." }] },
          ],
          metadata: {
            mediaUrl: "file:///tmp/demo.mp4",
            referenceFrameUrls: ["file:///tmp/frame-01.jpg", "file:///tmp/frame-02.jpg"],
          },
        },
      },
      codexResponse: {
        choices: [{ message: { content: "Three quick cuts, creator points at product, caption lands before CTA." } }],
      },
    })

    expect(request.operation).toBe("video-text")
    expect(request.prompt).toContain("Product lane: brainrot")
    expect(request.prompt).toContain("Extract reusable hook mechanics.")
    expect(request.prompt).toContain("Three quick cuts")
    expect(request.referenceImageUrls).toBeUndefined()
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
