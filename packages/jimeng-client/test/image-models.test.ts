import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengImageModelsRequest,
  createJimengHttpTransport,
  fetchJimengImageModels,
  JimengClient,
  JimengError,
  parseJimengImageModelsBody,
  readJimengHttpCassette,
  summarizeJimengImageModels,
  type JimengFetch,
  type JimengSessionBundle,
  type JsonObject,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("Jimeng image model config", () => {
  test("builds frontend-compatible request body", () => {
    expect(buildJimengImageModelsRequest()).toEqual({
      isClientFilter: true,
      needBetaModel: true,
    })
    expect(buildJimengImageModelsRequest({ isClientFilter: false, needBetaModel: false })).toEqual({
      isClientFilter: false,
      needBetaModel: false,
    })
  })

  test("parses and summarizes image model config without signed URLs", () => {
    const parsed = parseJimengImageModelsBody(imageModelsBody())

    expect(parsed.modelCount).toBe(1)
    expect(parsed.models[0]).toMatchObject({
      modelReqKey: "high_aes_general_v50",
      modelName: "图片5.0 Lite",
      highValueFeats: ["byte_edit", "pose", "support_subject"],
      blendControls: ["pose"],
      commercialBenefitTypes: ["image_basic_v5_2k"],
      commercialResourceIds: ["generate_img"],
      maxBatchGenCount: 4,
      complianceConfirmationRequired: true,
      taskCancelEnabled: true,
    })

    const summary = summarizeJimengImageModels({
      endpoint: "/mweb/v1/get_common_config",
      httpStatus: 200,
      ret: "0",
      errmsg: "success",
      responseTextSha256: "hash",
      request: buildJimengImageModelsRequest(),
      query: { needCache: "true", needRefresh: "false" },
      body: imageModelsBody(),
      ...parsed,
    })
    const summaryText = JSON.stringify(summary)
    expect(summary).toMatchObject({
      model_count: 1,
      model_req_keys: ["high_aes_general_v50"],
      high_value_flags: {
        control_or_reference_feats: ["byte_edit", "pose", "support_subject"],
        blend_controls: ["pose"],
        commercial_benefit_types: ["image_basic_v5_2k"],
      },
    })
    expect(summaryText).not.toContain("byteimg")
    expect(summaryText).not.toContain("x-signature")
  })

  test("fetches image model config with query flags", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify(imageModelsBody()), requests),
    })

    const result = await fetchJimengImageModels({
      client,
      session,
      query: {
        isClientFilter: false,
        needBetaModel: true,
        needCache: false,
        needRefresh: true,
      },
    })

    expect(requests[0]?.url).toContain("/mweb/v1/get_common_config")
    expect(requests[0]?.url).toContain("needCache=false")
    expect(requests[0]?.url).toContain("needRefresh=true")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      isClientFilter: false,
      needBetaModel: true,
    })
    expect(result.models.map((model) => model.modelReqKey)).toEqual(["high_aes_general_v50"])
  })

  test("can fetch through recorded and replayed HTTP transport cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-image-models-cassette-"))
    try {
      const cassettePath = path.join(dir, "image-models.json")
      const requests: Array<{ url: string; init?: RequestInit }> = []
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: mockFetch(JSON.stringify(imageModelsBody()), requests),
        nowIso: () => "2026-06-11T00:00:00.000Z",
      })
      const query = { isClientFilter: false, needBetaModel: true, needCache: false, needRefresh: true }

      const recorded = await fetchJimengImageModels({
        fetch: recordTransport.fetch,
        session,
        query,
      })

      expect(recorded.models).toHaveLength(1)
      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(1)
      expect(requests).toHaveLength(1)

      const replayTransport = createJimengHttpTransport({
        mode: "replay",
        cassettePath,
      })
      const replayed = await fetchJimengImageModels({
        fetch: replayTransport.fetch,
        session,
        query,
      })

      expect(summarizeJimengImageModels(replayed)).toMatchObject({
        endpoint: "/mweb/v1/get_common_config",
        model_count: 1,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("fails loudly when required model list disappears", () => {
    expect(() => parseJimengImageModelsBody({
      ret: "0",
      errmsg: "success",
      data: { extra_new_field: true },
    })).toThrow(JimengError)
  })
})

function imageModelsBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      model_list: [
        {
          model_req_key: "high_aes_general_v50",
          model_name: "图片5.0 Lite",
          model_tip: "指令响应更精准",
          model_status: 1,
          generation_category_name: "通用",
          feats: ["t2i", "byte_edit", "support_subject", "pose"],
          blend_enable: { pose: true, canny: false },
          feat_config: { pose: { strength: 0.6 } },
          resolution_map: {
            "2k": {
              resolution_name: "高清 2K",
              image_ratio_sizes: [{ ratio_type: 1, width: 2048, height: 2048 }],
            },
          },
          sample_steps: { steps: 16, min_steps: 10, max_steps: 41 },
          commercial_config: {
            image_model_commerce_config: {
              base: {
                default: {
                  benefit_type: "image_basic_v5_2k",
                  resource_id: "generate_img",
                },
              },
            },
          },
          extra: {
            model_source: "by Seedream 5.0 Lite",
            max_batch_gen_count: 4,
            aigc_compliance_confirmation_required: true,
            enable_task_cancel: true,
          },
          icon_url: "https://p11-dreamina-sign.byteimg.com/model.png?x-signature=secret",
        },
      ],
      default_model_index: 0,
      first_selected_model: { workbench: "high_aes_general_v50" },
      is_internal: false,
      disable_multi_model: false,
      new_provider_field: { keep: "allowed" },
    },
  }
}

function mockFetch(body: string, requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url: string, init?: RequestInit) => {
    requests.push({ url, init })
    return {
      ok: true,
      status: 200,
      text: async () => body,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    }
  }
}
