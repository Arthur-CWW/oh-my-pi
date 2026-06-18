import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengAgentConfigRequest,
  buildJimengAgentSkillsRequest,
  createJimengHttpTransport,
  fetchJimengAgentCatalog,
  parseJimengAgentCatalogEndpoints,
  readJimengHttpCassette,
  summarizeJimengAgentCatalog,
  type JimengFetch,
  JimengClient,
  type JimengSessionBundle,
  type JsonObject,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}
describe("Jimeng agent catalog helpers", () => {
  test("parses agent catalog endpoint flags", () => {
    expect(parseJimengAgentCatalogEndpoints(undefined)).toEqual(["skills", "config"])
    expect(parseJimengAgentCatalogEndpoints("config,skills,config")).toEqual(["config", "skills"])
    expect(() => parseJimengAgentCatalogEndpoints("voice-assets")).toThrow("agent-catalog --endpoints must be skills, config, or all")
  })

  test("builds frontend-compatible read-only requests", () => {
    expect(buildJimengAgentSkillsRequest()).toEqual({ offset: 0, limit: 300, need_official_skills: true })
    expect(buildJimengAgentConfigRequest()).toEqual({})
  })

  test("fetches and summarizes skills and model options without signed URLs", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify(skillListBody()),
        JSON.stringify(agentConfigBody()),
      ], requests),
    })

    const result = await fetchJimengAgentCatalog({ client, session, endpoints: ["skills", "config"] })
    const summary = summarizeJimengAgentCatalog(result)

    expect(requests.map((request) => request.url)).toEqual([
      expect.stringContaining("/mweb/v1/creation_agent/v2/skill/list"),
      expect.stringContaining("/mweb/v1/creation_agent/v2/get_agent_config"),
    ])
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ offset: 0, limit: 300, need_official_skills: true })
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({})
    expect(summary).toMatchObject({
      skills: {
        skill_count: 1,
        items: [
          {
            id: "web_agent_skill_ecommerce",
            title: "电商套图",
          },
        ],
      },
      config: {
        image_model_count: 1,
        video_model_count: 1,
        high_value_flags: {
          image_control_feats: ["byte_edit", "canny", "depth", "pose", "style", "support_subject"],
          image_blend_controls: ["canny", "pose"],
          image_reference_controls: [
            {
              control: "pose",
              preview_supported: true,
              evidence_status: "observed_provider_contract",
              catalog_feat_models: ["high_aes_general_v50"],
              catalog_blend_models: ["high_aes_general_v50"],
              catalog_feat_config_models: ["high_aes_general_v50"],
              gap: null,
            },
            {
              control: "depth",
              preview_supported: true,
              evidence_status: "observed_provider_contract",
              catalog_feat_models: ["high_aes_general_v50"],
              catalog_blend_models: [],
              catalog_feat_config_models: [],
              gap: null,
            },
            {
              control: "canny",
              preview_supported: true,
              evidence_status: "observed_provider_contract",
              catalog_feat_models: ["high_aes_general_v50"],
              catalog_blend_models: ["high_aes_general_v50"],
              catalog_feat_config_models: ["high_aes_general_v50"],
              gap: null,
            },
            {
              control: "style",
              preview_supported: false,
              evidence_status: "catalog_only_missing_capture",
              catalog_feat_models: ["high_aes_general_v50"],
              catalog_blend_models: [],
              catalog_feat_config_models: [],
              gap: expect.stringContaining("No observed /mweb/v1/blend_preview style"),
            },
          ],
          video_input_media_types: ["end_frame", "first_frame", "prompt", "unified_edit"],
          video_models_with_multi_frames: ["dreamina_ic_generate_video_model_vgfm_3.0_fast"],
          video_models_with_unified_edit: ["dreamina_ic_generate_video_model_vgfm_3.0_fast"],
        },
      },
    })
    expect(JSON.stringify(summary)).not.toContain("byteimg")
    expect(JSON.stringify(summary)).not.toContain("x-signature")
  })

  test("can fetch through recorded and replayed HTTP transport cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-agent-catalog-cassette-"))
    try {
      const cassettePath = path.join(dir, "agent-catalog.json")
      const requests: Array<{ url: string; init?: RequestInit }> = []
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: mockFetchSequence([
          JSON.stringify(skillListBody()),
          JSON.stringify(agentConfigBody()),
        ], requests),
        nowIso: () => "2026-06-11T00:00:00.000Z",
      })
      const endpoints = ["skills", "config"] as const

      const recorded = await fetchJimengAgentCatalog({
        fetch: recordTransport.fetch,
        session,
        endpoints: [...endpoints],
      })

      expect(recorded.results).toHaveLength(2)
      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(2)
      expect(requests).toHaveLength(2)

      const replayTransport = createJimengHttpTransport({
        mode: "replay",
        cassettePath,
      })
      const replayed = await fetchJimengAgentCatalog({
        fetch: replayTransport.fetch,
        session,
        endpoints: [...endpoints],
      })

      expect(summarizeJimengAgentCatalog(replayed)).toMatchObject({
        result_count: 2,
        skills: { skill_count: 1 },
        config: {
          image_model_count: 1,
          video_model_count: 1,
        },
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function mockFetchSequence(texts: string[], requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url, init) => {
    requests.push({ url, init })
    const text = texts.shift()
    return new Response(text ?? "{}", { status: 200 })
  }
}

function skillListBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      total_count: 0,
      official_skills: [
        {
          id: "web_agent_skill_ecommerce",
          name: "电商套图",
          default_title: "电商套图",
          default_desc: "生成风格统一的商品全套视觉素材",
          default_guide_text: "上传商品图",
        },
      ],
    },
  }
}

function agentConfigBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      image_data: {
        default_model_index: 0,
        model_list: [
          {
            model_req_key: "high_aes_general_v50",
            model_name: "图片5.0 Lite",
            model_tip: "指令响应更精准",
            feats: ["t2i", "byte_edit", "support_subject", "pose", "canny", "depth", "style"],
            blend_enable: { pose: true, canny: true, depth: false, style: false },
            feat_config: { pose: { strength: 0.6 }, canny: { strength: 0.6 } },
            sample_steps: { steps: 16, min_steps: 10, max_steps: 41 },
            resolution_map: {
              "2k": {
                resolution_name: "高清 2K",
                image_ratio_sizes: [{ ratio_type: 1, width: 2048, height: 2048 }],
              },
            },
            extra: { model_source: "by Seedream 5.0 Lite" },
            icon_url_svg: "https://p11-dreamina-sign.byteimg.com/model.svg?x-signature=secret",
          },
        ],
      },
      video_data: {
        default_model_idx: 0,
        model_list: [
          {
            model_req_key: "dreamina_ic_generate_video_model_vgfm_3.0_fast",
            model_name: "即梦 Seedance 1.0 Fast",
            model_tip: "快速生成",
            options: [
              {
                key: "multi_frames",
                value_type: "bool",
                forbidden_display: false,
              },
              {
                key: "input_media_type",
                value_type: "enum",
                enum_val: {
                  enum_type: "string",
                  string_value: ["prompt", "first_frame", "end_frame", "unified_edit"],
                  default_val_idx: 1,
                },
              },
              {
                key: "frames",
                value_type: "enum",
                enum_val: {
                  enum_type: "int",
                  int_value: [96, 120],
                  default_val_idx: 0,
                },
              },
              {
                key: "unified_edit",
                value_type: "unified_edit",
                unified_edit_config: {
                  supported_materials: [
                    { material_type: 1, limit: { max_count: 9 } },
                    { material_type: 2, limit: { max_count: 3, min_duration: 2, max_duration: 15.4, max_width: 2160, max_height: 2160, max_file_size: 50 } },
                  ],
                  max_total_count: 12,
                  max_total_video_duration: 15.4,
                  required_material_types: { any_of: [1, 2] },
                },
              },
            ],
            extra: {
              max_batch_gen_count: 4,
              aigc_compliance_confirmation_required: true,
              enable_task_cancel: true,
            },
          },
        ],
      },
    },
  }
}
