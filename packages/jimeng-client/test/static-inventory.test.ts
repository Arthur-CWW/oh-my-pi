import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  inventoryJimengStaticApis,
  summarizeJimengStaticInventory,
  writeJimengStaticInventoryMarkdown,
  type JimengStaticInventoryItem,
  type JimengStaticInventoryRecommendedAction,
  type JimengStaticInventoryResult,
} from "../src"
import { type JimengDiscoveryRiskClass } from "../src/discovery-worklist"
import { type JimengDiscoveryKnownStatus } from "../src/endpoint-registry"

const STATIC_INVENTORY_ENDPOINTS = [
  "/mweb/v1/get_history_by_ids",
  "/mweb/v1/dreamina_subject/generate_voice",
  "/mweb/v1/get_history",
  "/lv/v1/cc_web/replicate/get_search_words",
  "/lv/v1/cc_web/replicate/search_templates",
  "/lv/v1/cc_web/plane/batch_get_collection_templates",
  "/lv/v1/cc_web/plane/get_collection_presets",
  "/lv/v1/cc_web/plane/fuzzy_search_templates",
  "/lv/v1/cc_web/plane/preset_template_detail",
  "/mweb/v1/video_generate/get_switch_model_queue_info",
  "/mweb/v1/video_generate/pre_process",
  "/mweb/v1/video_generate/mget_pre_process_result",
  "/mweb/v1/video_generate/face_auth/skip",
  "/mweb/v1/video_generate/face_auth/skip/query",
  "/mweb/v1/aigc_draft/cancel_generate",
  "/mweb/v1/aigc_draft/generate_accelerate",
  "/lv/v1/asset/list",
  "/lv/v1/asset/query",
  "/lv/v1/asset/detail",
  "/lv/v1/asset/query_process",
  "/lv/v1/editor/image/ai_model/submit_task",
  "/lv/v1/editor/image/ai_model/batch_get_results",
  "/lv/v1/editor/image/ai_model/materials",
  "/lv/v1/editor/image/ai_model/create_cloth_mask",
  "/lv/v1/editor/image/batch_get_url",
  "/lv/v1/editor/image/embed_resource",
  "/lv/v1/editor/image/gen_background",
  "/lv/v1/editor/image/interactive_matting",
  "/lv/v1/editor/image/saliency_seg",
  "/api/biz/v1/image/entity_seg",
  "/lv/v1/cc_web/plane/del_presets_template",
  "/lv/v1/editor/template/recent_list",
  "/lv/v1/editor/template/check_post_permission",
  "/lv/v1/editor/draft/get_template_file",
  "/lv/v1/editor/plane/intelligence/query_recommend_template",
  "/lv/v2/cc_web_task/get_task_draft",
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
  "/commerce/v1/subscription/price_list",
  "/commerce/v1/purchase/price_list",
  "/commerce/v1/subscription/cc_price_list",
  "/commerce/v1/subscription/get_change_plan_info",
  "/commerce/v3/trade/query_trade",
  "/commerce/v3/trade/user/can_refund_list",
  "/commerce/v3/trade/user/refund_record_list",
  "/mweb/v1/get_notice_list",
  "/mweb/v1/get_panel_info",
  "/mweb/v1/get_short_url",
  "/mweb/v1/get_weekly_challenge_list",
  "/mweb/v1/get_weekly_challenge_detail",
  "/mweb/v1/get_weekly_challenge_work_list",
  "/mweb/v1/cc_data_sync/get_account_info",
  "/mweb/v1/cc_data_sync/get_account_token",
  "/lv/v1/user/get_enable_list",
  "/lv/v1/web/get_lite_user",
  "/lv/v1/ad_maker/user/get_enable_list",
  "/lv/v1/commerce/get_entrances",
  "/lv/v1/platform/query_auth_status",
  "/lv/v1/editor/draft/get_version_list",
  "/mweb/search/v1/sug",
  "/mweb/search/v1/guess",
  "/mweb/search/v1/search",
  "/mweb/search/v1/fetch_debug/search",
  "/lv/v1/effect/get_panel_info",
  "/lv/v1/effect/get_category_effects",
  "/lv/v1/effect/get_all_fonts",
  "/lv/v1/editor/plane/color/feed",
  "/lv/v1/editor/effect/recent_list",
  "/lv/v2/editor/effect/recent_list",
  "/lv/v1/editor/plane/common/recent_list",
  "/lv/v1/editor/plane_draft/get_content_map",
  "/lv/v1/editor/plane_draft/get_draft_detail",
  "/lv/v1/ever_photo/batch_get_sync_state",
  "/lv/v1/ever_photo/get_user_space",
  "/lv/v1/intelligence/preset_resource_list",
  "/lv/v2/task/multi_get_tasks",
  "https://jimeng.jianying.com/mweb/v1/template/search?token=secret",
  "/mweb/v1/avatar/generate",
  "https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_49/bee_prod_49_bee_publish_709.json?x-signature=secret",
] as const

const INCLUDE_KNOWN_ENDPOINTS = [
  "/mweb/v1/get_history",
  "/mweb/v1/get_history_by_ids",
  "/lv/v1/cc_web/replicate/search_templates",
  "/lv/v1/cc_web/plane/get_collection_templates",
  "/lv/v1/effect/get_all_fonts",
  "/lv/v1/asset/create",
  "/lv/v1/editor/template/recent_list",
  "/mweb/v1/voice/query_task",
  "/mweb/search/v1/sug",
  "/mweb/search/v1/guess",
  "/mweb/search/v1/search",
  "/mweb/v1/get_user_info",
  "/mweb/v1/get_homepage",
  "/mweb/v1/get_favorite_list",
  "/mweb/v1/get_follow_list",
  "/mweb/v1/get_item_info",
  "/commerce/v1/subscription/price_list",
  "/commerce/v1/purchase/price_list",
  "/commerce/v3/trade/query_trade",
  "/mweb/v1/get_notice_list",
  "/mweb/v1/get_panel_info",
  "/mweb/v1/get_weekly_challenge_list",
  "/mweb/v1/get_weekly_challenge_detail",
  "/mweb/v1/get_weekly_challenge_work_list",
] as const

const DEFAULT_HIDDEN_IMPLEMENTED_ENDPOINTS = [
  "/mweb/v1/get_history",
  "/mweb/v1/get_history_by_ids",
  "/mweb/search/v1/sug",
  "/mweb/search/v1/guess",
  "/mweb/search/v1/search",
  "/commerce/v1/subscription/price_list",
  "/commerce/v1/purchase/price_list",
  "/lv/v1/effect/get_all_fonts",
] as const

const DEFAULT_STATUS_EXPECTATIONS: Partial<Record<string, JimengDiscoveryKnownStatus>> = {
  "/mweb/search/v1/fetch_debug/search": "blocked",
  "/lv/v1/cc_web/replicate/get_search_words": "blocked",
  "/lv/v1/cc_web/replicate/search_templates": "blocked",
  "/lv/v1/cc_web/plane/batch_get_collection_templates": "blocked",
  "/lv/v1/cc_web/plane/get_collection_presets": "blocked",
  "/lv/v1/cc_web/plane/preset_template_detail": "blocked",
  "/lv/v1/cc_web/plane/fuzzy_search_templates": "blocked",
  "/mweb/v1/video_generate/get_switch_model_queue_info": "blocked",
  "/mweb/v1/video_generate/pre_process": "blocked",
  "/mweb/v1/video_generate/mget_pre_process_result": "blocked",
  "/mweb/v1/video_generate/face_auth/skip": "blocked",
  "/mweb/v1/video_generate/face_auth/skip/query": "blocked",
  "/mweb/v1/aigc_draft/cancel_generate": "blocked",
  "/mweb/v1/aigc_draft/generate_accelerate": "blocked",
  "/mweb/v1/get_short_url": "cataloged_only",
  "/mweb/v1/get_weekly_challenge_list": "cataloged_only",
  "/mweb/v1/get_weekly_challenge_detail": "cataloged_only",
  "/mweb/v1/get_weekly_challenge_work_list": "cataloged_only",
  "/mweb/v1/cc_data_sync/get_account_info": "cataloged_only",
  "/mweb/v1/cc_data_sync/get_account_token": "blocked",
  "/lv/v1/user/get_enable_list": "blocked",
  "/lv/v1/web/get_lite_user": "blocked",
  "/lv/v1/ad_maker/user/get_enable_list": "blocked",
  "/lv/v1/commerce/get_entrances": "blocked",
  "/lv/v1/platform/query_auth_status": "blocked",
  "/lv/v1/editor/draft/get_version_list": "blocked",
  "/lv/v1/asset/list": "blocked",
  "/lv/v1/asset/query": "blocked",
  "/lv/v1/asset/detail": "blocked",
  "/lv/v1/asset/query_process": "blocked",
  "/lv/v1/editor/image/ai_model/submit_task": "blocked",
  "/lv/v1/editor/image/ai_model/batch_get_results": "blocked",
  "/lv/v1/editor/image/ai_model/materials": "blocked",
  "/lv/v1/editor/image/ai_model/create_cloth_mask": "blocked",
  "/lv/v1/editor/image/batch_get_url": "blocked",
  "/lv/v1/editor/image/embed_resource": "blocked",
  "/lv/v1/editor/image/gen_background": "blocked",
  "/lv/v1/editor/image/interactive_matting": "blocked",
  "/lv/v1/editor/image/saliency_seg": "blocked",
  "/api/biz/v1/image/entity_seg": "blocked",
  "/lv/v1/cc_web/plane/del_presets_template": "blocked",
  "/lv/v1/editor/template/recent_list": "blocked",
  "/lv/v1/editor/template/check_post_permission": "blocked",
  "/lv/v1/editor/draft/get_template_file": "blocked",
  "/lv/v1/editor/plane/intelligence/query_recommend_template": "blocked",
  "/lv/v2/cc_web_task/get_task_draft": "blocked",
  "/mweb/v1/get_notice_list": "blocked",
  "/mweb/v1/get_panel_info": "blocked",
  "/commerce/v1/subscription/cc_price_list": "blocked",
  "/commerce/v1/subscription/get_change_plan_info": "blocked",
  "/commerce/v3/trade/query_trade": "blocked",
  "/commerce/v3/trade/user/can_refund_list": "blocked",
  "/commerce/v3/trade/user/refund_record_list": "blocked",
  "/lv/v1/asset/copy": "blocked",
  "/lv/v1/asset/create": "blocked",
  "/lv/v1/asset/create_cloud_asset": "blocked",
  "/lv/v1/asset/delete": "blocked",
  "/lv/v1/asset/label_as_exported": "blocked",
  "/lv/v1/asset/prepare_upload_cloud": "blocked",
  "/lv/v1/asset/rename": "blocked",
  "/lv/v1/editor/template/add": "blocked",
  "/lv/v1/editor/template/add_async": "blocked",
  "/lv/v1/editor/template/add_query": "blocked",
  "/lv/v1/ever_photo/batch_sync_asset": "blocked",
  "/lv/v1/ever_photo/promote_asset": "blocked",
  "/mweb/v1/remove_history": "blocked",
  "/mweb/v1/update_video_default_bgm": "blocked",
  "/lv/v1/editor/effect/recent_list": "blocked",
  "/lv/v2/editor/effect/recent_list": "blocked",
  "/lv/v1/editor/plane/common/recent_list": "blocked",
  "/lv/v1/editor/plane_draft/get_content_map": "blocked",
  "/lv/v1/editor/plane_draft/get_draft_detail": "blocked",
  "/lv/v1/ever_photo/batch_get_sync_state": "blocked",
  "/lv/v1/ever_photo/get_user_space": "blocked",
  "/lv/v1/intelligence/preset_resource_list": "blocked",
  "/lv/v2/task/multi_get_tasks": "blocked",
}

const INCLUDE_KNOWN_STATUS_EXPECTATIONS: Partial<Record<string, JimengDiscoveryKnownStatus>> = {
  "/lv/v1/cc_web/replicate/search_templates": "blocked",
  "/mweb/v1/get_history": "implemented",
  "/mweb/search/v1/search": "implemented",
  "/commerce/v3/trade/query_trade": "blocked",
  "/mweb/v1/get_notice_list": "blocked",
  "/mweb/v1/get_panel_info": "blocked",
  "/mweb/v1/get_weekly_challenge_list": "cataloged_only",
  "/mweb/v1/get_weekly_challenge_detail": "cataloged_only",
  "/mweb/v1/get_weekly_challenge_work_list": "cataloged_only",
}

const INCLUDE_KNOWN_COMMAND_EXPECTATIONS: Partial<Record<string, string>> = {
  "/mweb/v1/get_history": "history-list",
  "/mweb/v1/get_history_by_ids": "history-records",
  "/lv/v1/effect/get_all_fonts": "capcut-editor-catalog",
  "/mweb/search/v1/sug": "research-keywords",
  "/mweb/search/v1/guess": "research-keywords",
  "/mweb/search/v1/search": "research-search",
  "/commerce/v1/subscription/price_list": "commerce-pricing",
  "/commerce/v1/purchase/price_list": "commerce-pricing",
  "/mweb/v1/get_user_info": "profile-research",
  "/mweb/v1/get_homepage": "profile-research",
  "/mweb/v1/get_favorite_list": "profile-research",
  "/mweb/v1/get_follow_list": "profile-research",
  "/mweb/v1/get_item_info": "profile-research",
}

describe("Jimeng static inventory", () => {
  test("inventories frontend endpoints and focuses default output on gaps", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-static-inventory-"))
    try {
      writeBundleFixture(dir, STATIC_INVENTORY_ENDPOINTS)

      const result = inventoryJimengStaticApis({
        staticRoots: [dir],
        nowIso: "2026-06-10T00:00:00.000Z",
      })
      const summary = summarizeJimengStaticInventory(result)
      const markdown = writeJimengStaticInventoryMarkdown(result)

      expect(result.totalResourceCount).toBe(91)
      expect(result.skippedImplementedCount).toBe(12)
      for (const endpoint of DEFAULT_HIDDEN_IMPLEMENTED_ENDPOINTS) {
        expect(result.items.map((item) => item.resource)).not.toContain(endpoint)
      }
      expectStatuses(result, DEFAULT_STATUS_EXPECTATIONS)
      expectAction(result, "/mweb/v1/dreamina_subject/generate_voice", "capture_exact_payload")
      expectAction(result, "/lv/v1/cc_web/replicate/search_templates", "capture_exact_payload")
      expectAction(result, "/lv/v1/cc_web/plane/batch_get_collection_templates", "capture_exact_payload")
      expectAction(result, "/mweb/v1/template/search", "probe_read_endpoint")
      expectRisk(result, "/mweb/v1/avatar/generate", "generate")
      expect(JSON.stringify(summary)).not.toContain("x-signature=secret")
      expect(markdown).toContain("Jimeng Static API Inventory")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("can include implemented endpoints for coverage audits", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-static-inventory-known-"))
    try {
      writeBundleFixture(dir, INCLUDE_KNOWN_ENDPOINTS)

      const result = inventoryJimengStaticApis({
        staticRoots: [dir],
        includeKnown: true,
        nowIso: "2026-06-10T00:00:00.000Z",
      })

      expect(result.skippedImplementedCount).toBe(0)
      expectStatuses(result, INCLUDE_KNOWN_STATUS_EXPECTATIONS)
      expectCommands(result, INCLUDE_KNOWN_COMMAND_EXPECTATIONS)
      expectAction(result, "/lv/v1/cc_web/replicate/search_templates", "capture_exact_payload")
      expectRisk(result, "/lv/v1/cc_web/plane/get_collection_templates", "read")
      expectRisk(result, "/lv/v1/asset/create", "mutate")
      expectRisk(result, "/mweb/v1/voice/query_task", "read")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function expectStatuses(result: JimengStaticInventoryResult, expectations: Partial<Record<string, JimengDiscoveryKnownStatus>>): void {
  for (const [endpoint, status] of Object.entries(expectations)) {
    if (!status) throw new Error(`Missing expected status for ${endpoint}`)
    expect(requireItem(result, endpoint).knownStatus).toBe(status)
  }
}

function expectCommands(result: JimengStaticInventoryResult, expectations: Partial<Record<string, string>>): void {
  for (const [endpoint, command] of Object.entries(expectations)) {
    if (!command) throw new Error(`Missing expected command for ${endpoint}`)
    expect(requireItem(result, endpoint).knownCommand).toBe(command)
  }
}

function expectAction(
  result: JimengStaticInventoryResult,
  endpoint: string,
  action: JimengStaticInventoryRecommendedAction,
): void {
  expect(requireItem(result, endpoint).recommendedAction).toBe(action)
}

function expectRisk(result: JimengStaticInventoryResult, endpoint: string, riskClass: JimengDiscoveryRiskClass): void {
  expect(requireItem(result, endpoint).riskClass).toBe(riskClass)
}

function requireItem(result: JimengStaticInventoryResult, endpoint: string): JimengStaticInventoryItem {
  const item = result.items.find((candidate) => candidate.resource === endpoint)
  if (!item) throw new Error(`Expected inventory item for ${endpoint}`)
  return item
}

function writeBundleFixture(dir: string, endpoints: readonly string[]): void {
  writeFileSync(
    path.join(dir, "bundle.js"),
    endpoints.map((endpoint) => JSON.stringify(endpoint)).join("\n"),
    "utf8",
  )
}
