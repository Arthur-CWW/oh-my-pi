import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengDiscoveryWorklist,
  readJimengCaptureAnalysisFile,
  readJimengEndpointProbeCandidateFile,
  summarizeJimengDiscoveryWorklist,
  type JsonObject,
  writeJimengDiscoveryWorklistMarkdown,
} from "../src"

describe("Jimeng discovery worklist", () => {
  test("prioritizes uncovered read-safe endpoints and hides already-covered captures by default", () => {
    const staticRoot = mkdtempSync(path.join(tmpdir(), "jimeng-discovery-worklist-"))
    try {
      writeFileSync(
        path.join(staticRoot, "bundle.js"),
        [
          `fetch("/mweb/v1/reference_profile/list")`,
          `fetch("/mweb/v1/get_history")`,
          `fetch("/mweb/v1/dreamina_subject/generate_voice")`,
          `fetch("/lv/v1/cc_web/replicate/search_templates")`,
          `fetch("/lv/v1/cc_web/plane/batch_get_collection_templates")`,
          `fetch("/lv/v1/cc_web/plane/get_collection_presets")`,
          `fetch("/mweb/v1/video_generate/get_switch_model_queue_info")`,
          `fetch("/mweb/v1/video_generate/pre_process")`,
          `fetch("/mweb/v1/video_generate/mget_pre_process_result")`,
          `fetch("/mweb/v1/video_generate/face_auth/skip")`,
          `fetch("/mweb/v1/video_generate/face_auth/skip/query")`,
          `fetch("/mweb/v1/aigc_draft/cancel_generate")`,
          `fetch("/mweb/v1/aigc_draft/generate_accelerate")`,
          `fetch("/lv/v1/asset/list")`,
          `fetch("/lv/v1/asset/query")`,
          `fetch("/lv/v1/asset/detail")`,
          `fetch("/lv/v1/asset/query_process")`,
          `fetch("/lv/v1/editor/image/ai_model/submit_task")`,
          `fetch("/lv/v1/editor/image/ai_model/batch_get_results")`,
          `fetch("/lv/v1/editor/image/gen_background")`,
          `fetch("/lv/v1/editor/image/saliency_seg")`,
          `fetch("/api/biz/v1/image/entity_seg")`,
          `fetch("/lv/v1/cc_web/plane/del_presets_template")`,
          `fetch("/lv/v1/editor/template/recent_list")`,
          `fetch("/lv/v1/editor/template/check_post_permission")`,
          `fetch("/lv/v1/editor/draft/get_template_file")`,
          `fetch("/lv/v1/editor/plane/intelligence/query_recommend_template")`,
          `fetch("/lv/v2/cc_web_task/get_task_draft")`,
          `fetch("/lv/v1/asset/copy")`,
          `fetch("/lv/v1/asset/create")`,
          `fetch("/lv/v1/asset/create_cloud_asset")`,
          `fetch("/lv/v1/asset/delete")`,
          `fetch("/lv/v1/asset/label_as_exported")`,
          `fetch("/lv/v1/asset/prepare_upload_cloud")`,
          `fetch("/lv/v1/asset/rename")`,
          `fetch("/lv/v1/editor/template/add")`,
          `fetch("/lv/v1/editor/template/add_async")`,
          `fetch("/lv/v1/editor/template/add_query")`,
          `fetch("/lv/v1/ever_photo/batch_sync_asset")`,
          `fetch("/lv/v1/ever_photo/promote_asset")`,
          `fetch("/mweb/v1/remove_history")`,
          `fetch("/mweb/v1/update_video_default_bgm")`,
          `fetch("/commerce/v1/subscription/price_list")`,
          `fetch("/commerce/v1/purchase/price_list")`,
          `fetch("/commerce/v1/subscription/cc_price_list")`,
          `fetch("/commerce/v1/subscription/get_change_plan_info")`,
          `fetch("/commerce/v3/trade/query_trade")`,
          `fetch("/commerce/v3/trade/user/can_refund_list")`,
          `fetch("/commerce/v3/trade/user/refund_record_list")`,
          `fetch("/mweb/v1/get_notice_list")`,
          `fetch("/mweb/v1/get_panel_info")`,
          `fetch("/mweb/v1/get_short_url")`,
          `fetch("/mweb/v1/get_weekly_challenge_list")`,
          `fetch("/mweb/v1/get_weekly_challenge_detail")`,
          `fetch("/mweb/v1/get_weekly_challenge_work_list")`,
          `fetch("/mweb/v1/cc_data_sync/get_account_info")`,
          `fetch("/mweb/v1/cc_data_sync/get_account_token")`,
          `fetch("/lv/v1/user/get_enable_list")`,
          `fetch("/lv/v1/web/get_lite_user")`,
          `fetch("/lv/v1/ad_maker/user/get_enable_list")`,
          `fetch("/lv/v1/commerce/get_entrances")`,
          `fetch("/lv/v1/platform/query_auth_status")`,
          `fetch("/lv/v1/editor/draft/get_version_list")`,
          `fetch("/mweb/search/v1/sug")`,
          `fetch("/mweb/search/v1/guess")`,
          `fetch("/mweb/search/v1/search")`,
          `fetch("/mweb/search/v1/fetch_debug/search")`,
          `fetch("/lv/v1/effect/get_panel_info")`,
          `fetch("/lv/v1/effect/get_category_effects")`,
          `fetch("/lv/v1/effect/get_all_fonts")`,
          `fetch("/lv/v1/editor/plane/color/feed")`,
          `fetch("/lv/v1/editor/effect/recent_list")`,
          `fetch("/lv/v2/editor/effect/recent_list")`,
          `fetch("/lv/v1/editor/plane/common/recent_list")`,
          `fetch("/lv/v1/editor/plane_draft/get_content_map")`,
          `fetch("/lv/v1/editor/plane_draft/get_draft_detail")`,
          `fetch("/lv/v1/ever_photo/batch_get_sync_state")`,
          `fetch("/lv/v1/ever_photo/get_user_space")`,
          `fetch("/lv/v1/intelligence/preset_resource_list")`,
          `fetch("/lv/v2/task/multi_get_tasks")`,
        ].join("\n"),
        "utf8",
      )

      const worklist = buildJimengDiscoveryWorklist({
        analyses: [analysisFixture()],
        probeCandidates: [probeCandidateFixture()],
        staticRoots: [staticRoot],
        nowIso: "2026-06-10T00:00:00.000Z",
      })

      expect(worklist.skipped_known_count).toBe(3)
      expect(worklist.items.some((item) => item.endpoint === "/mweb/v1/get_history_by_ids")).toBe(false)
      expect(worklist.items.some((item) => item.endpoint === "/mweb/search/v1/sug")).toBe(false)
      expect(worklist.items.some((item) => item.endpoint === "/mweb/search/v1/guess")).toBe(false)
      expect(worklist.items.some((item) => item.endpoint === "/mweb/search/v1/search")).toBe(false)
      expect(worklist.items.some((item) => item.endpoint === "/commerce/v1/subscription/price_list")).toBe(false)
      expect(worklist.items.some((item) => item.endpoint === "/commerce/v1/purchase/price_list")).toBe(false)
      expect(worklist.items.some((item) => item.endpoint === "/lv/v1/effect/get_all_fonts")).toBe(false)
      expect(worklist.items.find((item) => item.endpoint === "/mweb/search/v1/fetch_debug/search")?.known_status).toBe("blocked")
      const weeklyList = worklist.items.find((item) => item.endpoint === "/mweb/v1/get_weekly_challenge_list")
      expect(weeklyList?.known_status).toBe("cataloged_only")
      expect(weeklyList?.recommended_action).toBe("document_low_value_or_risky")
      expect(weeklyList?.reason).toContain("Back burner")
      const weeklyDetail = worklist.items.find((item) => item.endpoint === "/mweb/v1/get_weekly_challenge_detail")
      expect(weeklyDetail?.known_status).toBe("cataloged_only")
      expect(weeklyDetail?.recommended_action).toBe("document_low_value_or_risky")
      expect(weeklyDetail?.reason).toContain("not core UGC workflow")
      const weeklyWorkList = worklist.items.find((item) => item.endpoint === "/mweb/v1/get_weekly_challenge_work_list")
      expect(weeklyWorkList?.known_status).toBe("cataloged_only")
      expect(weeklyWorkList?.recommended_action).toBe("document_low_value_or_risky")
      expect(weeklyWorkList?.reason).toContain("trend mining")
      const readGap = worklist.items.find((item) => item.endpoint === "/mweb/v1/reference_profile/list")
      expect(readGap?.recommended_action).toBe("probe_then_promote_cli")
      expect(readGap?.has_probe_variants).toBe(true)
      expect(readGap?.probe_variant_count).toBe(1)
      expect(worklist.items.find((item) => item.endpoint === "/mweb/v1/get_history")).toBeUndefined()
      const capcutSearch = worklist.items.find((item) => item.endpoint === "/lv/v1/cc_web/replicate/search_templates")
      expect(capcutSearch?.known_status).toBe("blocked")
      expect(capcutSearch?.recommended_action).toBe("static_capture_needed")
      expect(capcutSearch?.reason).toContain("ret=1000")
      const capcutBatch = worklist.items.find((item) => item.endpoint === "/lv/v1/cc_web/plane/batch_get_collection_templates")
      expect(capcutBatch?.known_status).toBe("blocked")
      expect(capcutBatch?.reason).toContain("object, list, and nested collection variants")
      const capcutPresets = worklist.items.find((item) => item.endpoint === "/lv/v1/cc_web/plane/get_collection_presets")
      expect(capcutPresets?.known_status).toBe("blocked")
      expect(capcutPresets?.reason).toContain("ret=1015")
      const switchQueue = worklist.items.find((item) => item.endpoint === "/mweb/v1/video_generate/get_switch_model_queue_info")
      expect(switchQueue?.known_status).toBe("blocked")
      expect(switchQueue?.reason).toContain("ret=1000 invalid parameter")
      const preProcess = worklist.items.find((item) => item.endpoint === "/mweb/v1/video_generate/pre_process")
      expect(preProcess?.known_status).toBe("blocked")
      expect(preProcess?.recommended_action).toBe("static_capture_needed")
      expect(preProcess?.reason).toContain("background CDP preflight now proves")
      const preProcessResult = worklist.items.find((item) => item.endpoint === "/mweb/v1/video_generate/mget_pre_process_result")
      expect(preProcessResult?.known_status).toBe("blocked")
      expect(preProcessResult?.recommended_action).toBe("static_capture_needed")
      expect(preProcessResult?.reason).toContain("task ids")
      const faceAuthSkip = worklist.items.find((item) => item.endpoint === "/mweb/v1/video_generate/face_auth/skip")
      expect(faceAuthSkip?.known_status).toBe("blocked")
      expect(faceAuthSkip?.reason).toContain("task state")
      const faceAuthSkipQuery = worklist.items.find((item) => item.endpoint === "/mweb/v1/video_generate/face_auth/skip/query")
      expect(faceAuthSkipQuery?.known_status).toBe("blocked")
      expect(faceAuthSkipQuery?.reason).toContain("depends on a task id")
      const cancelGenerate = worklist.items.find((item) => item.endpoint === "/mweb/v1/aigc_draft/cancel_generate")
      expect(cancelGenerate?.known_status).toBe("blocked")
      expect(cancelGenerate?.reason).toContain("Cancels an in-flight generation")
      const generateAccelerate = worklist.items.find((item) => item.endpoint === "/mweb/v1/aigc_draft/generate_accelerate")
      expect(generateAccelerate?.known_status).toBe("blocked")
      expect(generateAccelerate?.reason).toContain("may spend quota")
      const lvAssetList = worklist.items.find((item) => item.endpoint === "/lv/v1/asset/list")
      expect(lvAssetList?.known_status).toBe("blocked")
      expect(lvAssetList?.reason).toContain("workspace_id/space_id")
      const lvAssetQuery = worklist.items.find((item) => item.endpoint === "/lv/v1/asset/query")
      expect(lvAssetQuery?.known_status).toBe("blocked")
      expect(lvAssetQuery?.reason).toContain("ret=1014")
      const lvAssetDetail = worklist.items.find((item) => item.endpoint === "/lv/v1/asset/detail")
      expect(lvAssetDetail?.known_status).toBe("blocked")
      expect(lvAssetDetail?.reason).toContain("asset ids")
      const lvAssetQueryProcess = worklist.items.find((item) => item.endpoint === "/lv/v1/asset/query_process")
      expect(lvAssetQueryProcess?.known_status).toBe("blocked")
      expect(lvAssetQueryProcess?.reason).toContain("process_id")
      const lvAiSubmit = worklist.items.find((item) => item.endpoint === "/lv/v1/editor/image/ai_model/submit_task")
      expect(lvAiSubmit?.known_status).toBe("blocked")
      expect(lvAiSubmit?.reason).toContain("task submit")
      const lvAiResults = worklist.items.find((item) => item.endpoint === "/lv/v1/editor/image/ai_model/batch_get_results")
      expect(lvAiResults?.known_status).toBe("blocked")
      expect(lvAiResults?.reason).toContain("depends on task ids")
      const lvBackground = worklist.items.find((item) => item.endpoint === "/lv/v1/editor/image/gen_background")
      expect(lvBackground?.known_status).toBe("blocked")
      expect(lvBackground?.reason).toContain("AI background generation")
      const lvSaliency = worklist.items.find((item) => item.endpoint === "/lv/v1/editor/image/saliency_seg")
      expect(lvSaliency?.known_status).toBe("blocked")
      expect(lvSaliency?.reason).toContain("distinct from implemented Jimeng")
      const entitySeg = worklist.items.find((item) => item.endpoint === "/api/biz/v1/image/entity_seg")
      expect(entitySeg?.known_status).toBe("blocked")
      expect(entitySeg?.reason).toContain("auto-selection")
      const lvDeletePreset = worklist.items.find((item) => item.endpoint === "/lv/v1/cc_web/plane/del_presets_template")
      expect(lvDeletePreset?.known_status).toBe("blocked")
      expect(lvDeletePreset?.reason).toContain("mutating path")
      const lvRecentList = worklist.items.find((item) => item.endpoint === "/lv/v1/editor/template/recent_list")
      expect(lvRecentList?.known_status).toBe("blocked")
      expect(lvRecentList?.reason).toContain("ret=1015")
      const lvPermission = worklist.items.find((item) => item.endpoint === "/lv/v1/editor/template/check_post_permission")
      expect(lvPermission?.known_status).toBe("blocked")
      expect(lvPermission?.reason).toContain("check login")
      const lvTemplateFile = worklist.items.find((item) => item.endpoint === "/lv/v1/editor/draft/get_template_file")
      expect(lvTemplateFile?.known_status).toBe("blocked")
      expect(lvTemplateFile?.reason).toContain("real template file URIs")
      const lvRecommendTemplate = worklist.items.find((item) => item.endpoint === "/lv/v1/editor/plane/intelligence/query_recommend_template")
      expect(lvRecommendTemplate?.known_status).toBe("blocked")
      expect(lvRecommendTemplate?.reason).toContain("ret=-3")
      const lvTaskDraft = worklist.items.find((item) => item.endpoint === "/lv/v2/cc_web_task/get_task_draft")
      expect(lvTaskDraft?.known_status).toBe("blocked")
      expect(lvTaskDraft?.reason).toContain("commercial-photo task id")
      for (const endpoint of [
        "/mweb/v1/get_notice_list",
        "/mweb/v1/get_panel_info",
        "/mweb/v1/cc_data_sync/get_account_token",
        "/lv/v1/user/get_enable_list",
        "/lv/v1/web/get_lite_user",
        "/lv/v1/ad_maker/user/get_enable_list",
        "/lv/v1/commerce/get_entrances",
        "/lv/v1/platform/query_auth_status",
        "/lv/v1/editor/draft/get_version_list",
        "/commerce/v1/subscription/cc_price_list",
        "/commerce/v1/subscription/get_change_plan_info",
        "/commerce/v3/trade/query_trade",
        "/commerce/v3/trade/user/can_refund_list",
        "/commerce/v3/trade/user/refund_record_list",
        "/lv/v1/asset/copy",
        "/lv/v1/asset/create",
        "/lv/v1/asset/create_cloud_asset",
        "/lv/v1/asset/delete",
        "/lv/v1/asset/label_as_exported",
        "/lv/v1/asset/prepare_upload_cloud",
        "/lv/v1/asset/rename",
        "/lv/v1/editor/template/add",
        "/lv/v1/editor/template/add_async",
        "/lv/v1/editor/template/add_query",
        "/lv/v1/ever_photo/batch_sync_asset",
        "/lv/v1/ever_photo/promote_asset",
        "/mweb/v1/remove_history",
        "/mweb/v1/update_video_default_bgm",
      ]) {
        expect(worklist.items.find((item) => item.endpoint === endpoint)?.known_status).toBe("blocked")
      }
      expect(worklist.items.find((item) => item.endpoint === "/mweb/v1/get_short_url")?.known_status).toBe("cataloged_only")
      expect(worklist.items.find((item) => item.endpoint === "/mweb/v1/cc_data_sync/get_account_info")?.known_status).toBe("cataloged_only")
      expect(worklist.items.find((item) => item.endpoint === "/mweb/v1/cc_data_sync/get_account_token")?.reason).toContain("credentials")
      expect(worklist.items.find((item) => item.endpoint === "/lv/v1/editor/draft/get_version_list")?.reason).toContain("draft id")
      expect(worklist.items.find((item) => item.endpoint === "/lv/v1/asset/copy")?.reason).toContain("disposable workspace")
      expect(worklist.items.find((item) => item.endpoint === "/lv/v1/editor/template/add")?.reason).toContain("template state")
      expect(worklist.items.find((item) => item.endpoint === "/mweb/v1/remove_history")?.reason).toContain("history ids")
      const lvEffectRecent = worklist.items.find((item) => item.endpoint === "/lv/v1/editor/effect/recent_list")
      expect(lvEffectRecent?.known_status).toBe("blocked")
      expect(lvEffectRecent?.reason).toContain("ret=1015")
      const lvEffectRecentV2 = worklist.items.find((item) => item.endpoint === "/lv/v2/editor/effect/recent_list")
      expect(lvEffectRecentV2?.known_status).toBe("blocked")
      expect(lvEffectRecentV2?.reason).toContain("ret=1015")
      const lvCommonRecent = worklist.items.find((item) => item.endpoint === "/lv/v1/editor/plane/common/recent_list")
      expect(lvCommonRecent?.known_status).toBe("blocked")
      expect(lvCommonRecent?.reason).toContain("empty item_list")
      const lvContentMap = worklist.items.find((item) => item.endpoint === "/lv/v1/editor/plane_draft/get_content_map")
      expect(lvContentMap?.known_status).toBe("blocked")
      expect(lvContentMap?.reason).toContain("ret=1016")
      const lvDraftDetail = worklist.items.find((item) => item.endpoint === "/lv/v1/editor/plane_draft/get_draft_detail")
      expect(lvDraftDetail?.known_status).toBe("blocked")
      expect(lvDraftDetail?.reason).toContain("ret=1015")
      const lvSyncState = worklist.items.find((item) => item.endpoint === "/lv/v1/ever_photo/batch_get_sync_state")
      expect(lvSyncState?.known_status).toBe("blocked")
      expect(lvSyncState?.reason).toContain("real asset ids")
      const lvUserSpace = worklist.items.find((item) => item.endpoint === "/lv/v1/ever_photo/get_user_space")
      expect(lvUserSpace?.known_status).toBe("blocked")
      expect(lvUserSpace?.reason).toContain("auth context")
      const lvPresetResource = worklist.items.find((item) => item.endpoint === "/lv/v1/intelligence/preset_resource_list")
      expect(lvPresetResource?.known_status).toBe("blocked")
      expect(lvPresetResource?.reason).toContain("ret=-1")
      const lvMultiGetTasks = worklist.items.find((item) => item.endpoint === "/lv/v2/task/multi_get_tasks")
      expect(lvMultiGetTasks?.known_status).toBe("blocked")
      expect(lvMultiGetTasks?.reason).toContain("real task ids")
      expect(worklist.items.find((item) => item.endpoint === "/mweb/v1/aigc_draft/generate")).toBeUndefined()
      expect(worklist.items.find((item) => item.endpoint === "/mweb/v1/dreamina_subject/generate_voice")?.recommended_action).toBe("static_capture_needed")
      expect(worklist.probe_variant_exports).toHaveLength(1)
      expect(worklist.probe_variant_exports[0]?.endpoint).toBe("/mweb/v1/reference_profile/list")
    } finally {
      rmSync(staticRoot, { recursive: true, force: true })
    }
  })

  test("can include already-covered endpoints for audit views", () => {
    const worklist = buildJimengDiscoveryWorklist({
      analyses: [analysisFixture()],
      includeKnown: true,
      nowIso: "2026-06-10T00:00:00.000Z",
    })

    const covered = worklist.items.find((item) => item.endpoint === "/mweb/v1/get_history_by_ids")
    expect(covered?.recommended_action).toBe("already_covered")
    expect(covered?.known_command).toBe("history-records")
    const coveredHistoryList = worklist.items.find((item) => item.endpoint === "/mweb/v1/get_history")
    expect(coveredHistoryList?.recommended_action).toBe("already_covered")
    expect(coveredHistoryList?.known_command).toBe("history-list")
  })

  test("validates saved analysis/probe files and renders normalized summaries without probe bodies", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-discovery-worklist-files-"))
    try {
      const analysisFile = path.join(dir, "analysis.json")
      const probeFile = path.join(dir, "probe-candidates.json")
      writeFileSync(analysisFile, JSON.stringify(analysisFixture()), "utf8")
      writeFileSync(probeFile, JSON.stringify({ candidates: [probeCandidateFixture()] }), "utf8")

      const analysis = readJimengCaptureAnalysisFile(analysisFile)
      const probeCandidates = readJimengEndpointProbeCandidateFile(probeFile)
      const worklist = buildJimengDiscoveryWorklist({
        analyses: [analysis],
        analysisFiles: [analysisFile],
        probeCandidates,
        nowIso: "2026-06-10T00:00:00.000Z",
      })
      const summary = summarizeJimengDiscoveryWorklist(worklist)
      const markdown = writeJimengDiscoveryWorklistMarkdown(worklist)

      expect(markdown).toContain("Jimeng Discovery Worklist")
      expect(markdown).toContain("/mweb/v1/reference_profile/list")
      expect(JSON.stringify(summary)).not.toContain("secret-style-reference")
      expect(worklist.probe_variant_exports[0]?.variants[0]?.body).toEqual({ cursor: 0, keyword: "secret-style-reference" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function analysisFixture() {
  return {
    source_path: "/tmp/raw-network.jsonl",
    analyzed_at_iso: "2026-06-10T00:00:00.000Z",
    total_events: 9,
    total_requests: 3,
    candidates: [
      candidateFixture({
        rank: 1,
        endpoint: "/mweb/v1/reference_profile/list",
        riskClass: "read",
        replaySafe: true,
        requestShape: { kind: "object", keys: ["cursor", "keyword"] },
      }),
      candidateFixture({
        rank: 2,
        endpoint: "/mweb/v1/aigc_draft/generate",
        riskClass: "generate",
        replaySafe: false,
        requestShape: { kind: "object", keys: ["draft_content", "submit_id"] },
      }),
      candidateFixture({
        rank: 3,
        endpoint: "/mweb/v1/get_history",
        riskClass: "read",
        replaySafe: true,
        requestShape: { kind: "object", keys: ["offset", "count", "direction"] },
      }),
      candidateFixture({
        rank: 4,
        endpoint: "/mweb/v1/get_history_by_ids",
        riskClass: "read",
        replaySafe: true,
        requestShape: { kind: "object", keys: ["submit_ids"] },
      }),
    ],
  }
}

function candidateFixture(input: {
  rank: number
  endpoint: string
  riskClass: "read" | "generate"
  replaySafe: boolean
  requestShape: JsonObject
}) {
  return {
    rank: input.rank,
    method: "POST",
    endpoint: input.endpoint,
    url_host: "jimeng.jianying.com",
    url_pathname: input.endpoint,
    status: 200,
    risk_class: input.riskClass,
    replay_safe_by_default: input.replaySafe,
    score: 120 - input.rank,
    reasons: ["same-origin", "mweb-api", "json-request"],
    request_body_sha256: `request-${input.rank}`,
    response_text_sha256: `response-${input.rank}`,
    response_ret: "0",
    response_errmsg: "success",
    request_shape: input.requestShape,
    response_shape: { kind: "object", keys: ["ret", "errmsg", "data"] },
    initiator_functions: ["requestBuilder"],
    initiator_scripts: ["static/js/demo.js"],
    static_hints: [],
  }
}

function probeCandidateFixture() {
  return {
    name: "reference-profile-list",
    endpoint: "/mweb/v1/reference_profile/list",
    method: "POST" as const,
    query: null,
    risk_class: "read" as const,
    replay_safe_by_default: true,
    variants: [
      {
        name: "captured",
        body: { cursor: 0, keyword: "secret-style-reference" },
      },
    ],
  }
}
