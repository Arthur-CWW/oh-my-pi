import { Effect } from "effect"
import { afterEach, describe, expect, test } from "bun:test"
import { executeCodexAnalyze, prepareCodexAnalyze, resolveCodexApiKey, type CodexFetch } from "../src/codex"

const ORIGINAL_CODEX_API_KEY = process.env.CODEX_API_KEY
const ORIGINAL_OPENAI_API_KEY = process.env.OPENAI_API_KEY

describe("codex media analysis adapter", () => {
  afterEach(() => {
    restoreEnv("CODEX_API_KEY", ORIGINAL_CODEX_API_KEY)
    restoreEnv("OPENAI_API_KEY", ORIGINAL_OPENAI_API_KEY)
  })

  test("builds an image-understand payload without a live call", () => {
    const prepared = prepareCodexAnalyze({
      operation: "image-understand",
      mediaUrl: "file:///tmp/frames/hook.jpg",
      prompt: "Describe the hook frame and product visibility.",
      workspaceId: "workspace_test",
      targetIds: ["candidate_1"],
    })

    expect(prepared.provider).toBe("codex")
    expect(prepared.endpoint).toBe("POST /v1/chat/completions")
    expect(prepared.operation).toBe("image-understand")
    expect(prepared.estimatedCostUsd).toBe(0.01)
    expect(prepared.payload.metadata).toEqual({
      provider: "codex",
      operation: "image-understand",
      mediaUrl: "file:///tmp/frames/hook.jpg",
      workspaceId: "workspace_test",
      targetIds: ["candidate_1"],
    })
    expect(prepared.payload.messages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Describe the hook frame and product visibility." },
        { type: "image_url", image_url: { url: "file:///tmp/frames/hook.jpg" } },
      ],
    })
  })

  test("builds a video-understand payload from prepared reference frames only", () => {
    const prepared = prepareCodexAnalyze({
      operation: "video-understand",
      mediaUrl: "file:///tmp/private/local-video.mp4",
      prompt: "Describe the hook and scene flow.",
      referenceFrameUrls: [
        "file:///tmp/frames/frame-01.jpg",
        "file:///tmp/frames/frame-02.jpg",
      ],
    })

    expect(prepared.payload.metadata.referenceFrameUrls).toEqual([
      "file:///tmp/frames/frame-01.jpg",
      "file:///tmp/frames/frame-02.jpg",
    ])
    expect(prepared.payload.messages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Describe the hook and scene flow.\n\nVideo URL: file:///tmp/private/local-video.mp4" },
        { type: "image_url", image_url: { url: "file:///tmp/frames/frame-01.jpg" } },
        { type: "image_url", image_url: { url: "file:///tmp/frames/frame-02.jpg" } },
      ],
    })
  })

  test("rejects video-understand payloads without prepared reference frames", () => {
    expect(() => prepareCodexAnalyze({
      operation: "video-understand",
      mediaUrl: "file:///tmp/private/local-video.mp4",
    })).toThrow("prepared referenceFrameUrls")
  })

  test("rejects raw video mediaUrl as a prepared reference frame", () => {
    expect(() => prepareCodexAnalyze({
      operation: "video-understand",
      mediaUrl: "file:///tmp/private/local-video.mp4",
      referenceFrameUrls: ["file:///tmp/private/local-video.mp4"],
    })).toThrow("not the raw mediaUrl")
  })

  test("live execution rejects spend caps before requiring credentials", async () => {
    delete process.env.CODEX_API_KEY
    delete process.env.OPENAI_API_KEY

    await expect(Effect.runPromise(executeCodexAnalyze({
      operation: "video-understand",
      mediaUrl: "file:///tmp/private/local-video.mp4",
      referenceFrameUrls: ["file:///tmp/frames/frame-01.jpg"],
    }, {
      maxSpendUsd: 0.01,
      fetch: failIfCalled,
    }))).rejects.toThrow("exceeds max $0.01")
  })

  test("resolves CODEX_API_KEY before OPENAI_API_KEY", () => {
    process.env.CODEX_API_KEY = "codex-test-key"
    process.env.OPENAI_API_KEY = "openai-test-key"

    expect(resolveCodexApiKey()).toBe("codex-test-key")
  })

  test("live execution uses the injected fetch client", async () => {
    delete process.env.CODEX_API_KEY
    process.env.OPENAI_API_KEY = "openai-stub-key"
    const calls: string[] = []
    const stubFetch: CodexFetch = async (_input, init) => {
      calls.push(String(init?.headers instanceof Headers ? init.headers.get("Authorization") : (init?.headers as Record<string, string> | undefined)?.Authorization))
      return new Response(JSON.stringify({ id: "chatcmpl_stub", choices: [] }), { status: 200 })
    }

    const result = await Effect.runPromise(executeCodexAnalyze({
      operation: "image-understand",
      mediaUrl: "file:///tmp/frames/demo.jpg",
    }, {
      maxSpendUsd: 0.25,
      fetch: stubFetch,
    }))

    expect(result.mode).toBe("live")
    expect(result.prepared.provider).toBe("codex")
    expect(result.response).toEqual({ id: "chatcmpl_stub", choices: [] })
    expect(calls).toEqual(["Bearer openai-stub-key"])
  })
})

function restoreEnv(name: "CODEX_API_KEY" | "OPENAI_API_KEY", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

const failIfCalled: CodexFetch = async () => {
  throw new Error("network must not be called")
}
