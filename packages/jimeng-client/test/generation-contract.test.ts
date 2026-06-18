import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengGenerationContractReport,
  buildJimengGenerationHeaders,
  buildJimengText2ImageDirectPlan,
  executeJimengText2ImageSubmit,
  executeJimengVideoDirectSubmit,
  parseJimengGenerationProof,
  prepareDreaminaCompat,
  summarizeJimengGenerationProof,
  writeJimengGenerationContractReportMarkdown,
  type CaptureFile,
  type JimengFetch,
  type JsonObject,
} from "../src"
import { type JsonValue } from "../src/reference-image"

const fixtureRoot = path.resolve(import.meta.dir, "fixtures/contract-infer/live-matrix-mini")
const text2VideoFixture = path.join(fixtureRoot, "text2video-kbeauty-hook/normalized/text2video-result.json")

describe("Jimeng generation contract", () => {
  test("parses a normalized live generation proof and summarizes relied-on paths", () => {
    const proof = parseJimengGenerationProof(readJson(text2VideoFixture), "text2video fixture", "text2video-result.json")
    const summary = summarizeJimengGenerationProof(proof)

    expect(summary).toMatchObject({
      source_file: "text2video-result.json",
      command: "text2video",
      op: "video",
      submit_kind: "workbench_json",
      poll_kind: "history_by_submit_id",
      ret: "0",
      submit_ret: "0",
      terminal_status: 50,
      latest_poll_status: 50,
      final_status: 20,
      generate_type: 10,
      model_req_key: "dreamina_ic_generate_video_model_vgfm_3.0_fast",
      function_mode: "first_last_frames",
      ratio: "9:16",
      resolution: "720p",
      duration_ms: 3000,
      fps: 24,
      seed: 2026061201,
      artifact_count: 1,
      artifact_kinds: ["video"],
    })
    expect(summary.prompt).toContain("韩系美妆UGC创作者")
    expect(proof.submitDraftContent.component_list).toBeArray()
    expect(proof.finalAigcData?.model_info).toBeDefined()
  })

  test("reports all generation proof fixtures without accepting TTS-only fixtures", () => {
    const report = buildJimengGenerationContractReport(fixtureRoot)

    expect(report.proof_count).toBe(1)
    expect(report.skipped_json_count).toBe(0)
    expect(report.summaries.map((summary) => summary.command)).toEqual(["text2video"])
    expect(writeJimengGenerationContractReportMarkdown(report)).toContain("Jimeng Generation Contract Report")
  })

  test("rejects drift in required generation proof paths", () => {
    const value = readJson(text2VideoFixture)
    if (value && typeof value === "object" && !Array.isArray(value)) {
      delete value.plan
    }

    expect(() => parseJimengGenerationProof(value, "broken fixture")).toThrow("Jimeng generation proof contract did not match required fields")
  })
})

describe("Jimeng direct submit execution", () => {
  const session = {
    cookie: "session_cookie_123",
    userAgent: "custom-ua",
    referer: "custom-ref",
    origin: "custom-origin",
    msToken: "ms_token_abc",
    webId: "web_id_xyz",
  }

  test("buildJimengGenerationHeaders maps all session fields correctly", () => {
    const headers = buildJimengGenerationHeaders(session)
    expect(headers).toEqual({
      "content-type": "application/json",
      "user-agent": "custom-ua",
      "referer": "custom-ref",
      "origin": "custom-origin",
      "cookie": "session_cookie_123",
      "msToken": "ms_token_abc",
      "web_id": "web_id_xyz",
    })
  })

  test("buildJimengGenerationHeaders uses sensible defaults for missing fields", () => {
    const headers = buildJimengGenerationHeaders({ cookie: "only_cookie" })
    expect(headers.cookie).toBe("only_cookie")
    expect(headers["content-type"]).toBe("application/json")
    expect(headers["user-agent"]).toContain("Mozilla")
    expect(headers.referer).toContain("jimeng.jianying.com")
    expect(headers.origin).toBe("https://jimeng.jianying.com")
    expect(headers.msToken).toBeUndefined()
    expect(headers.web_id).toBeUndefined()
  })

  test("executeJimengVideoDirectSubmit handles a successful submit flow", async () => {
    const successResponse = {
      ret: 0,
      errmsg: "success",
      data: {
        aigc_data: {
          submit_id: "video_submit_999",
          history_record_id: "video_history_888",
        },
      },
    }

    const { fetchFn, calls } = createMockFetch(200, JSON.stringify(successResponse))

    const result = await executeJimengVideoDirectSubmit({
      fetch: fetchFn,
      session,
      config: {
        prompt: "A beautiful cinematic landscape of Jeju Island",
        ratio: "16:9",
        durationSec: 5,
      },
    })

    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain("https://jimeng.jianying.com/mweb/v1/aigc_draft/generate")
    expect(calls[0].init?.method).toBe("POST")
    expect(calls[0].init?.headers).toMatchObject({
      cookie: "session_cookie_123",
      msToken: "ms_token_abc",
    })

    expect(result).toMatchObject({
      endpoint: "/mweb/v1/aigc_draft/generate",
      httpStatus: 200,
      ret: 0,
      errmsg: "success",
      submitId: "video_submit_999",
      historyId: "video_history_888",
    })
    expect(result.responseTextSha256).toBeDefined()
    expect(result.request).toBeDefined()
    expect(result.body).toEqual(successResponse)
  })

  test("executeJimengVideoDirectSubmit rejects non-zero provider ret", async () => {
    const errorResponse = {
      ret: 1002,
      errmsg: "invalid model request parameter",
    }

    const { fetchFn } = createMockFetch(200, JSON.stringify(errorResponse))

    let threw = false
    try {
      await executeJimengVideoDirectSubmit({
        fetch: fetchFn,
        session,
        config: {
          prompt: "Failing prompt",
        },
      })
    } catch (error) {
      threw = true
      expect(error).toMatchObject({
        category: "upstream",
        code: "GENERATION_SUBMIT_FAILED",
      })
      const message = error instanceof Error ? error.message : String(error)
      expect(message).toContain("ret=1002")
      expect(message).toContain("invalid model request parameter")
    }
    expect(threw).toBe(true)
  })

  test("executeJimengVideoDirectSubmit handles risk control (shark not pass)", async () => {
    const riskResponse = {
      ret: 1019,
      errmsg: "risk control trigger",
    }

    const { fetchFn } = createMockFetch(200, JSON.stringify(riskResponse))

    let threw = false
    try {
      await executeJimengVideoDirectSubmit({
        fetch: fetchFn,
        session,
        config: {
          prompt: "Sensitive prompt",
        },
      })
    } catch (error) {
      threw = true
      expect(error).toMatchObject({
        category: "risk_control",
        code: "SHARK_NOT_PASS",
      })
    }
    expect(threw).toBe(true)
  })

  test("executeJimengText2ImageSubmit handles a successful submit flow", async () => {
    const successResponse = {
      ret: 0,
      errmsg: "success",
      data: {
        aigc_data: {
          submit_id: "image_submit_777",
          history_record_id: "image_history_666",
        },
      },
    }

    const { fetchFn, calls } = createMockFetch(200, JSON.stringify(successResponse))

    const result = await executeJimengText2ImageSubmit({
      fetch: fetchFn,
      session,
      config: {
        prompt: "A cute orange cat drinking boba",
        ratio: "1:1",
      },
    })

    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain("https://jimeng.jianying.com/mweb/v1/aigc_draft/generate")
    expect(calls[0].init?.method).toBe("POST")

    expect(result).toMatchObject({
      endpoint: "/mweb/v1/aigc_draft/generate",
      httpStatus: 200,
      ret: 0,
      errmsg: "success",
      submitId: "image_submit_777",
      historyId: "image_history_666",
    })
    expect(result.responseTextSha256).toBeDefined()
    expect(result.request).toBeDefined()
    expect(result.body).toEqual(successResponse)
  })

  test("executeJimengText2ImageSubmit throws on JSON parse failure", async () => {
    const { fetchFn } = createMockFetch(200, "{invalid-json-body")

    let threw = false
    try {
      await executeJimengText2ImageSubmit({
        fetch: fetchFn,
        session,
        config: {
          prompt: "Broke JSON",
        },
      })
    } catch (error) {
      threw = true
      expect(error).toMatchObject({
        category: "upstream",
        code: "JIMENG_GENERATION_RESPONSE_PARSE_FAILED",
      })
    }
    expect(threw).toBe(true)
  })
})


describe("Dreamina-compatible text2image prepare", () => {
  const session = {
    cookie: "session_cookie_123",
    userAgent: "custom-ua",
    referer: "custom-ref",
    origin: "custom-origin",
  }

  test("uses the direct workbench text2image capture instead of a stale conversation template", () => {
    const capture = text2ImageDirectCapture({ includeStaleConversation: true })
    const prepared = prepareDreaminaCompat({
      command: "text2image",
      capture,
      session,
      prompt: "new image prompt",
      seed: 42,
    })

    expect(prepared.op).toBe("image")
    expect(prepared.submitKind).toBe("workbench_json")
    expect(prepared.pollKind).toBe("asset_list_first_image")
    expect(prepared.submitUrl).toContain("/mweb/v1/aigc_draft/generate")
    expect(prepared.submitUrl).not.toContain("/mweb/v1/creation_agent/v2/conversation")
    expect(prepared.submitBody.submit_id).toBe(prepared.submitId)

    const draft = JSON.parse(String(prepared.submitBody.draft_content)) as JsonObject
    const componentList = draft.component_list as JsonObject[]
    const component = componentList[0]!
    const abilities = component.abilities as JsonObject
    const generate = abilities.generate as JsonObject
    const coreParam = generate.core_param as JsonObject
    expect(coreParam.prompt).toBe("new image prompt")
    expect(coreParam.seed).toBe(42)
  })

  test("rejects stale conversation-only captures with an explicit direct-capture blocker", () => {
    const capture: CaptureFile = {
      entries: [
        {
          kind: "request",
          url: "https://jimeng.jianying.com/mweb/v1/creation_agent/v2/conversation",
          postData: JSON.stringify({
            messages: [{ content: { content_parts: [{ text: "old agent prompt" }] } }],
          }),
        },
        {
          kind: "request",
          url: "https://jimeng.jianying.com/mweb/v1/get_asset_list",
          postData: JSON.stringify({}),
        },
      ],
    }

    let threw = false
    try {
      prepareDreaminaCompat({
        command: "text2image",
        capture,
        session,
        prompt: "new image prompt",
      })
    } catch (error) {
      threw = true
      expect(error).toMatchObject({
        category: "validation",
        code: "DREAMINA_TEXT2IMAGE_DIRECT_CAPTURE_REQUIRED",
      })
      expect(error instanceof Error ? error.message : String(error)).toContain("/mweb/v1/aigc_draft/generate")
    }
    expect(threw).toBe(true)
  })
})

function text2ImageDirectCapture(options: { includeStaleConversation?: boolean } = {}): CaptureFile {
  const plan = buildJimengText2ImageDirectPlan({
    prompt: "old image prompt",
    submitId: "old-image-submit",
    seed: 7,
  })
  const entries: CaptureFile["entries"] = []
  if (options.includeStaleConversation) {
    entries.push({
      kind: "request",
      url: "https://jimeng.jianying.com/mweb/v1/creation_agent/v2/conversation",
      postData: JSON.stringify({
        messages: [{ content: { content_parts: [{ text: "old agent prompt" }] } }],
      }),
    })
  }
  entries.push(
    {
      kind: "request",
      url: "https://jimeng.jianying.com/mweb/v1/aigc_draft/generate",
      postData: JSON.stringify(plan.request),
    },
    {
      kind: "request",
      url: "https://jimeng.jianying.com/mweb/v1/get_asset_list",
      postData: JSON.stringify({}),
    },
  )
  return { entries }
}

function createMockFetch(status: number, responseText: string, ok = true) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchFn: JimengFetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return {
      ok,
      status,
      async text() {
        return responseText
      },
      async arrayBuffer() {
        return new ArrayBuffer(0)
      },
    }
  }
  return { fetchFn, calls }
}

function readJson(file: string): JsonValue {
  return JSON.parse(readFileSync(file, "utf8")) as JsonValue
}

