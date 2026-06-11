import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  inventoryJimengStaticApis,
  summarizeJimengStaticInventory,
  writeJimengStaticInventoryMarkdown,
} from "../src"

describe("Jimeng static inventory", () => {
  test("inventories frontend endpoints and focuses default output on gaps", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-static-inventory-"))
    try {
      writeBundleFixture(dir, [
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
      ])

      const result = inventoryJimengStaticApis({
        staticRoots: [dir],
        nowIso: "2026-06-10T00:00:00.000Z",
      })
      const summary = summarizeJimengStaticInventory(result)
      const markdown = writeJimengStaticInventoryMarkdown(result)

      expect(result.totalResourceCount).toBe(91)
      expect(result.skippedImplementedCount).toBe(11)
      expect(result.items.map((item) => item.resource)).not.toContain("/mweb/v1/get_history_by_ids")
      expect(result.items.map((item) => item.resource)).not.toContain("/mweb/search/v1/sug")
      expect(result.items.map((item) => item.resource)).not.toContain("/mweb/search/v1/guess")
      expect(result.items.map((item) => item.resource)).not.toContain("/mweb/search/v1/search")
      expect(result.items.map((item) => item.resource)).not.toContain("/commerce/v1/subscription/price_list")
      expect(result.items.map((item) => item.resource)).not.toContain("/commerce/v1/purchase/price_list")
      expect(result.items.map((item) => item.resource)).not.toContain("/lv/v1/effect/get_all_fonts")
      expect(result.items.find((item) => item.resource === "/mweb/search/v1/fetch_debug/search")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/mweb/v1/dreamina_subject/generate_voice")?.recommendedAction).toBe("approval_or_disposable_fixture")
      expect(result.items.find((item) => item.resource === "/mweb/v1/get_history")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/mweb/v1/get_history")?.recommendedAction).toBe("capture_exact_payload")
      expect(result.items.find((item) => item.resource === "/lv/v1/cc_web/replicate/get_search_words")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/cc_web/replicate/search_templates")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/cc_web/replicate/search_templates")?.recommendedAction).toBe("capture_exact_payload")
      expect(result.items.find((item) => item.resource === "/lv/v1/cc_web/plane/batch_get_collection_templates")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/cc_web/plane/batch_get_collection_templates")?.recommendedAction).toBe("capture_exact_payload")
      expect(result.items.find((item) => item.resource === "/lv/v1/cc_web/plane/get_collection_presets")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/cc_web/plane/preset_template_detail")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/cc_web/plane/fuzzy_search_templates")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/mweb/v1/video_generate/get_switch_model_queue_info")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/mweb/v1/video_generate/pre_process")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/mweb/v1/video_generate/mget_pre_process_result")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/mweb/v1/video_generate/face_auth/skip")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/mweb/v1/video_generate/face_auth/skip/query")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/mweb/v1/aigc_draft/cancel_generate")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/mweb/v1/aigc_draft/generate_accelerate")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/mweb/v1/get_short_url")?.knownStatus).toBe("cataloged_only")
      expect(result.items.find((item) => item.resource === "/mweb/v1/get_weekly_challenge_list")?.knownStatus).toBe("cataloged_only")
      expect(result.items.find((item) => item.resource === "/mweb/v1/get_weekly_challenge_detail")?.knownStatus).toBe("cataloged_only")
      expect(result.items.find((item) => item.resource === "/mweb/v1/get_weekly_challenge_work_list")?.knownStatus).toBe("cataloged_only")
      expect(result.items.find((item) => item.resource === "/mweb/v1/cc_data_sync/get_account_info")?.knownStatus).toBe("cataloged_only")
      expect(result.items.find((item) => item.resource === "/mweb/v1/cc_data_sync/get_account_token")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/user/get_enable_list")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/web/get_lite_user")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/ad_maker/user/get_enable_list")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/commerce/get_entrances")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/platform/query_auth_status")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/editor/draft/get_version_list")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/asset/list")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/asset/query")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/asset/detail")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/asset/query_process")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/editor/image/ai_model/submit_task")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/editor/image/ai_model/batch_get_results")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/editor/image/ai_model/materials")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/editor/image/ai_model/create_cloth_mask")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/editor/image/batch_get_url")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/editor/image/embed_resource")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/editor/image/gen_background")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/editor/image/interactive_matting")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/editor/image/saliency_seg")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/api/biz/v1/image/entity_seg")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/cc_web/plane/del_presets_template")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/editor/template/recent_list")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/editor/template/check_post_permission")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/editor/draft/get_template_file")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/editor/plane/intelligence/query_recommend_template")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v2/cc_web_task/get_task_draft")?.knownStatus).toBe("blocked")
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
        "/lv/v1/editor/effect/recent_list",
        "/lv/v2/editor/effect/recent_list",
        "/lv/v1/editor/plane/common/recent_list",
        "/lv/v1/editor/plane_draft/get_content_map",
        "/lv/v1/editor/plane_draft/get_draft_detail",
        "/lv/v1/ever_photo/batch_get_sync_state",
        "/lv/v1/ever_photo/get_user_space",
        "/lv/v1/intelligence/preset_resource_list",
        "/lv/v2/task/multi_get_tasks",
      ]) {
        expect(result.items.find((item) => item.resource === endpoint)?.knownStatus).toBe("blocked")
      }
      expect(result.items.find((item) => item.resource === "/mweb/v1/template/search")?.recommendedAction).toBe("probe_read_endpoint")
      expect(result.items.find((item) => item.resource === "/mweb/v1/avatar/generate")?.riskClass).toBe("generate")
      expect(JSON.stringify(summary)).not.toContain("x-signature=secret")
      expect(markdown).toContain("Jimeng Static API Inventory")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("can include implemented endpoints for coverage audits", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-static-inventory-known-"))
    try {
      writeBundleFixture(dir, [
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
      ])

      const result = inventoryJimengStaticApis({
        staticRoots: [dir],
        includeKnown: true,
        nowIso: "2026-06-10T00:00:00.000Z",
      })

      expect(result.skippedImplementedCount).toBe(0)
      expect(result.items.find((item) => item.resource === "/mweb/v1/get_history_by_ids")?.knownCommand).toBe("history-records")
      expect(result.items.find((item) => item.resource === "/lv/v1/cc_web/replicate/search_templates")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/lv/v1/cc_web/replicate/search_templates")?.recommendedAction).toBe("capture_exact_payload")
      expect(result.items.find((item) => item.resource === "/lv/v1/cc_web/plane/get_collection_templates")?.riskClass).toBe("read")
      expect(result.items.find((item) => item.resource === "/lv/v1/effect/get_all_fonts")?.knownCommand).toBe("capcut-editor-catalog")
      expect(result.items.find((item) => item.resource === "/lv/v1/asset/create")?.riskClass).toBe("mutate")
      expect(result.items.find((item) => item.resource === "/lv/v1/editor/template/recent_list")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/mweb/v1/voice/query_task")?.riskClass).toBe("read")
      expect(result.items.find((item) => item.resource === "/mweb/search/v1/sug")?.knownCommand).toBe("research-keywords")
      expect(result.items.find((item) => item.resource === "/mweb/search/v1/guess")?.knownCommand).toBe("research-keywords")
      expect(result.items.find((item) => item.resource === "/mweb/search/v1/search")?.knownStatus).toBe("implemented")
      expect(result.items.find((item) => item.resource === "/mweb/search/v1/search")?.knownCommand).toBe("research-search")
      expect(result.items.find((item) => item.resource === "/commerce/v1/subscription/price_list")?.knownCommand).toBe("commerce-pricing")
      expect(result.items.find((item) => item.resource === "/commerce/v1/purchase/price_list")?.knownCommand).toBe("commerce-pricing")
      expect(result.items.find((item) => item.resource === "/commerce/v3/trade/query_trade")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/mweb/v1/get_notice_list")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/mweb/v1/get_panel_info")?.knownStatus).toBe("blocked")
      expect(result.items.find((item) => item.resource === "/mweb/v1/get_weekly_challenge_list")?.knownStatus).toBe("cataloged_only")
      expect(result.items.find((item) => item.resource === "/mweb/v1/get_weekly_challenge_detail")?.knownStatus).toBe("cataloged_only")
      expect(result.items.find((item) => item.resource === "/mweb/v1/get_weekly_challenge_work_list")?.knownStatus).toBe("cataloged_only")
      for (const endpoint of [
        "/mweb/v1/get_user_info",
        "/mweb/v1/get_homepage",
        "/mweb/v1/get_favorite_list",
        "/mweb/v1/get_follow_list",
        "/mweb/v1/get_item_info",
      ]) {
        expect(result.items.find((item) => item.resource === endpoint)?.knownCommand).toBe("profile-research")
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})


function writeBundleFixture(dir: string, endpoints: string[]): void {
  writeFileSync(
    path.join(dir, "bundle.js"),
    endpoints.map((endpoint) => JSON.stringify(endpoint)).join("\n"),
    "utf8",
  )
}
