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
      writeFileSync(
        path.join(dir, "bundle.js"),
        [
          `const implemented = "/mweb/v1/get_history_by_ids";`,
          `const dryRunOnly = "/mweb/v1/dreamina_subject/generate_voice";`,
          `const probedEmpty = "/mweb/v1/get_history";`,
          `const metadataOnly = "/lv/v1/cc_web/replicate/get_search_words";`,
          `const capcutSearchBlocked = "/lv/v1/cc_web/replicate/search_templates";`,
          `const capcutBatchBlocked = "/lv/v1/cc_web/plane/batch_get_collection_templates";`,
          `const capcutPresetsBlocked = "/lv/v1/cc_web/plane/get_collection_presets";`,
          `const capcutFuzzyBlocked = "/lv/v1/cc_web/plane/fuzzy_search_templates";`,
          `const capcutPresetDetailBlocked = "/lv/v1/cc_web/plane/preset_template_detail";`,
          `const switchModelQueueBlocked = "/mweb/v1/video_generate/get_switch_model_queue_info";`,
          `const preProcessBlocked = "/mweb/v1/video_generate/pre_process";`,
          `const preProcessResultBlocked = "/mweb/v1/video_generate/mget_pre_process_result";`,
          `const faceAuthSkipBlocked = "/mweb/v1/video_generate/face_auth/skip";`,
          `const faceAuthSkipQueryBlocked = "/mweb/v1/video_generate/face_auth/skip/query";`,
          `const cancelGenerateBlocked = "/mweb/v1/aigc_draft/cancel_generate";`,
          `const generateAccelerateBlocked = "/mweb/v1/aigc_draft/generate_accelerate";`,
          `const lvAssetListBlocked = "/lv/v1/asset/list";`,
          `const lvAssetQueryBlocked = "/lv/v1/asset/query";`,
          `const lvAssetDetailBlocked = "/lv/v1/asset/detail";`,
          `const lvAssetQueryProcessBlocked = "/lv/v1/asset/query_process";`,
          `const lvAiSubmitBlocked = "/lv/v1/editor/image/ai_model/submit_task";`,
          `const lvAiResultsBlocked = "/lv/v1/editor/image/ai_model/batch_get_results";`,
          `const lvAiMaterialsBlocked = "/lv/v1/editor/image/ai_model/materials";`,
          `const lvAiClothMaskBlocked = "/lv/v1/editor/image/ai_model/create_cloth_mask";`,
          `const lvBatchUrlBlocked = "/lv/v1/editor/image/batch_get_url";`,
          `const lvEmbedResourceBlocked = "/lv/v1/editor/image/embed_resource";`,
          `const lvGenBackgroundBlocked = "/lv/v1/editor/image/gen_background";`,
          `const lvInteractiveMattingBlocked = "/lv/v1/editor/image/interactive_matting";`,
          `const lvSaliencyBlocked = "/lv/v1/editor/image/saliency_seg";`,
          `const lvEntitySegBlocked = "/api/biz/v1/image/entity_seg";`,
          `const lvDeletePresetBlocked = "/lv/v1/cc_web/plane/del_presets_template";`,
          `const lvTemplateRecentBlocked = "/lv/v1/editor/template/recent_list";`,
          `const lvTemplatePermissionBlocked = "/lv/v1/editor/template/check_post_permission";`,
          `const lvTemplateFileBlocked = "/lv/v1/editor/draft/get_template_file";`,
          `const lvRecommendTemplateBlocked = "/lv/v1/editor/plane/intelligence/query_recommend_template";`,
          `const lvTaskDraftBlocked = "/lv/v2/cc_web_task/get_task_draft";`,
          `const lvAssetCopyBlocked = "/lv/v1/asset/copy";`,
          `const lvAssetCreateBlocked = "/lv/v1/asset/create";`,
          `const lvAssetCreateCloudBlocked = "/lv/v1/asset/create_cloud_asset";`,
          `const lvAssetDeleteBlocked = "/lv/v1/asset/delete";`,
          `const lvAssetLabelExportedBlocked = "/lv/v1/asset/label_as_exported";`,
          `const lvAssetPrepareUploadBlocked = "/lv/v1/asset/prepare_upload_cloud";`,
          `const lvAssetRenameBlocked = "/lv/v1/asset/rename";`,
          `const lvTemplateAddBlocked = "/lv/v1/editor/template/add";`,
          `const lvTemplateAddAsyncBlocked = "/lv/v1/editor/template/add_async";`,
          `const lvTemplateAddQueryBlocked = "/lv/v1/editor/template/add_query";`,
          `const everPhotoBatchSyncBlocked = "/lv/v1/ever_photo/batch_sync_asset";`,
          `const everPhotoPromoteBlocked = "/lv/v1/ever_photo/promote_asset";`,
          `const removeHistoryBlocked = "/mweb/v1/remove_history";`,
          `const updateVideoDefaultBgmBlocked = "/mweb/v1/update_video_default_bgm";`,
          `const lvEditorPanelImplemented = "/lv/v1/effect/get_panel_info";`,
          `const lvEditorEffectsImplemented = "/lv/v1/effect/get_category_effects";`,
          `const lvEditorFontsImplemented = "/lv/v1/effect/get_all_fonts";`,
          `const lvEditorColorsImplemented = "/lv/v1/editor/plane/color/feed";`,
          `const unknownRead = "https://jimeng.jianying.com/mweb/v1/template/search?token=secret";`,
          `const unknownGenerate = "/mweb/v1/avatar/generate";`,
          `const capcutCatalog = "https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_49/bee_prod_49_bee_publish_709.json?x-signature=secret";`,
        ].join("\n"),
        "utf8",
      )

      const result = inventoryJimengStaticApis({
        staticRoots: [dir],
        nowIso: "2026-06-10T00:00:00.000Z",
      })
      const summary = summarizeJimengStaticInventory(result)
      const markdown = writeJimengStaticInventoryMarkdown(result)

      expect(result.totalResourceCount).toBe(57)
      expect(result.skippedImplementedCount).toBe(6)
      expect(result.items.map((item) => item.resource)).not.toContain("/mweb/v1/get_history_by_ids")
      expect(result.items.map((item) => item.resource)).not.toContain("/lv/v1/effect/get_all_fonts")
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
      writeFileSync(
        path.join(dir, "bundle.js"),
        [
          `fetch("/mweb/v1/get_history_by_ids");`,
          `fetch("/lv/v1/cc_web/replicate/search_templates");`,
          `fetch("/lv/v1/cc_web/plane/get_collection_templates");`,
          `fetch("/lv/v1/effect/get_all_fonts");`,
          `fetch("/lv/v1/asset/create");`,
          `fetch("/lv/v1/editor/template/recent_list");`,
          `fetch("/mweb/v1/voice/query_task");`,
        ].join("\n"),
        "utf8",
      )

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
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
