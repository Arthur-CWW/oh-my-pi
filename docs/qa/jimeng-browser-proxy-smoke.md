# Jimeng Browser Proxy Smoke

Date: 2026-06-09

## Claim

The logged-in background Jimeng browser profile can be used as a session holder while the local CLI prepares/direct-submits current workbench image-generation requests. The old direct client was fixed to support the current `/mweb/v1/aigc_draft/generate` text-to-image path and `get_asset_list` polling.

The same session-refresh/direct-fetch shape now also works for non-generating config probes, built-in voice library replay, and direct MP3 text-to-speech generation through Jimeng frontend APIs.

## Live Capture

Captured the logged-in image generation page:

```bash
bun packages/jimeng-client/src/network-recorder.ts \
  --cdp http://127.0.0.1:9340 \
  --target-url 'type=image' \
  --flow text2image-submit \
  --outDir data/jimeng-captures/20260609095503-text2image-submit \
  --durationSec 95
```

Useful captured endpoints:

- `POST /mweb/v1/workspace/create`
- `POST /mweb/v1/workspace/update`
- `POST /mweb/v1/aigc_draft/generate`
- `POST /mweb/v1/get_asset_list`

Raw capture is local-only under ignored `data/jimeng-captures/20260609095503-text2image-submit/`.

## Prompt

```txt
韩系美妆健身UGC创作者，K-pop偶像感但真实自然，浅色运动背心，柔和室内光，手机自拍构图，干净背景，可用于AI UGC角色参考图，无文字，无水印，高级真实感
```

## Proxy Dry-Run

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts text2image \
  --cdp http://127.0.0.1:9340 \
  --target-url 'type=image' \
  --capture data/jimeng-captures/20260609095503-text2image-submit/capture-template.raw.json \
  --prompt '韩系美妆健身UGC创作者，K-pop偶像感但真实自然，浅色运动背心，柔和室内光，手机自拍构图，干净背景，可用于AI UGC角色参考图，无文字，无水印，高级真实感' \
  --outDir data/jimeng-lab/browser-proxy-ugc-image \
  --dryRun
```

Output:

```txt
data/jimeng-lab/browser-proxy-ugc-image/raw/text2image-20260609100550-ulbulf-dry-run-plan.json
```

The plan redacts cookies and confirms:

- `submit_kind = workbench_json`
- `poll_kind = asset_list_first_image`
- `submit_url` contains `/mweb/v1/aigc_draft/generate`
- `poll_url` contains `/mweb/v1/get_asset_list`

## Direct Text-to-Image Plan Smoke

No-spend direct request-body planning with Effect Schema contract validation:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts text2image-plan \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --prompt "韩系美妆达人在自然光卧室里展示补水精华，真实手机自拍感，无文字，无水印" \
  --modelVersion jimeng-5.0 \
  --resolution 2k \
  --ratio 9:16 \
  --sampleStrength 0.5 \
  --seed 123456 \
  --outDir data/jimeng-lab/proof-20260610-text2image-plan-direct
```

Result:

```txt
text2image-plan saved model=high_aes_general_v50 resolution=2k ratio=9:16 live_submit=false
endpoint=/mweb/v1/aigc_draft/generate
width=1440
height=2560
image_ratio=5
has_metrics_extra=true
has_draft_content=true
```

Proof files:

```txt
data/jimeng-lab/proof-20260610-text2image-plan-direct/raw/text2image-plan-20260610122304-dry-run-plan.json
data/jimeng-lab/proof-20260610-text2image-plan-direct/normalized/text2image-plan-20260610122304-summary.json
```

Credential leak check:

```bash
rg -n -P 'authorization|cookie|sessionid|sid=|msToken|verifyFp|device-time|tdid' \
  data/jimeng-lab/proof-20260610-text2image-plan-direct/normalized
```

Expected result: no matches. The raw plan includes only a redacted cookie placeholder in `browser_session`.

## Generated Artifacts

The live UI submit completed with `status = 50`, `total_image_count = 4`, `finished_image_count = 4`.

Downloaded files:

```txt
data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png
data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-02.png
data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-03.png
data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-04.png
```

Manifest:

```txt
data/jimeng-lab/ugc-studio-kbeauty-image/manifest.json
```

These generated media files are intentionally kept under ignored `data/**`.

## Workbench Asset Listing Smoke

Dry-run request-shape proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts assets \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 5 \
  --outDir data/jimeng-lab/proof-20260610-assets \
  --dryRun
```

Live no-spend proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts assets \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 5 \
  --outDir data/jimeng-lab/proof-20260610-assets
```

Result:

```txt
assets saved count=1 nextOffset=1780998990927 hasMore=false
ret=0
errmsg=success
response_sha256=5373ac3f6339e82f7f3090059b742d83b17b9b438151476993466ae6d105f312
normalized_summary_sha256=10ba3a679c2e7e472c20fb186dedbd5289687c2a5b0aba7e88a0509bf17a4af8
first_asset_id=39148697060354
submit_id=a6bbee65-bed0-4e5b-aaf1-5ab466137b82
status=50
model_req_key=high_aes_general_v50
generated_item_count=4
```

The normalized summary was checked for signed media URL leakage:

```bash
rg -n "https://|x-signature|x-expires|byteimg|SIGNED_URL" \
  data/jimeng-lab/proof-20260610-assets/normalized
```

Expected result: no matches.

## History Queue Info Smoke

Dry-run request-shape proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts history-queue \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --historyId 39148697060354 \
  --outDir data/jimeng-lab/proof-20260610-history-queue \
  --dryRun
```

Live no-spend proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts history-queue \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --historyId 39148697060354 \
  --outDir data/jimeng-lab/proof-20260610-history-queue
```

Result:

```txt
history-queue saved count=1 statuses=39148697060354:3
ret=0
errmsg=success
response_sha256=292217828c13e57d7908a146e9496d36194c57ab075d547a24e74c7eb61ea8c0
history_id=39148697060354
status=0
queue_status=3
queue_length=0
polling_interval_seconds=30
polling_timeout_seconds=86400
debug_info_sha256=f71e62a6cfa3199b9974993f1774d6161383110784671d6fc9c3fa945072182e
```

Confirmed wire casing:

```txt
{"history_ids":["39148697060354"]} -> ret=0, errmsg=success
{"historyIds":["39148697060354"]} -> ret=1000, errmsg=invalid parameter
```

The normalized summary was checked for signed URL and raw queue-debug leakage:

```bash
rg -n "https://|x-signature|byteimg|internal-queue-name|dreamina_matrix_queue_name|debug_info\"" \
  data/jimeng-lab/proof-20260610-history-queue/normalized
```

Expected result: no matches.

## History Records Smoke

This is the read-only `/mweb/v1/get_history_by_ids` path used to recover completed generation records by submit id or history id. The implementation validates the response through permissive Zod boundary schemas before normalization, so additive provider fields are accepted but required contract paths fail clearly.

Dry-run request-shape proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts history-records \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --submitId a6bbee65-bed0-4e5b-aaf1-5ab466137b82 \
  --outDir data/jimeng-lab/proof-20260610-history-records \
  --dryRun
```

Live no-spend proof by submit id:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts history-records \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --submitId a6bbee65-bed0-4e5b-aaf1-5ab466137b82 \
  --outDir data/jimeng-lab/proof-20260610-history-records
```

Live no-spend proof by history id:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts history-records \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --historyId 39148697060354 \
  --outDir data/jimeng-lab/proof-20260610-history-records-by-history-id
```

Result:

```txt
history-records saved count=1 statuses=a6bbee65-bed0-4e5b-aaf1-5ab466137b82:50
history-records saved count=1 statuses=39148697060354:50
ret=0
errmsg=success
submit_id=a6bbee65-bed0-4e5b-aaf1-5ab466137b82
history_record_id=39148697060354
status=50
task_status=50
generate_type=1
mode=workbench
model_req_key=high_aes_general_v50
model_name=图片5.0 Lite
seed=105719980
total_image_count=4
finished_image_count=4
item_count=4
submit_lookup_response_sha256=2da0421296eb99f5c3e14b4ac543d800481a4f875e8b7c555f6404ef903bd413
history_lookup_response_sha256=77079fffff13a0c230698d7032bacd8a9784bbf9e8184e4685dd37e324aea8a6
```

The normalized summaries were checked for signed URL leakage:

```bash
if rg -n "https://|x-signature|x-expires|byteimg|SIGNED_URL" \
  data/jimeng-lab/proof-20260610-history-records/normalized \
  data/jimeng-lab/proof-20260610-history-records-by-history-id/normalized; then
  exit 1
else
  echo "normalized history-records proofs have no signed URLs"
fi
```

Expected result:

```txt
normalized history-records proofs have no signed URLs
```

## Capture Analyzer Smoke

`capture-analyze` is the offline ranking step between passive CDP capture and endpoint replay. It does not load a browser session or spend generation quota.

Proof command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts capture-analyze \
  --rawNetwork data/jimeng-captures/20260610-subject-create-ui/raw-network.jsonl \
  --staticRoot packages/jimeng-client/src \
  --outDir data/jimeng-lab/proof-20260610-capture-analyze-subject-create-v3 \
  --limit 20
```

Result:

```txt
capture-analyze saved candidates=5 replay=1
events=138
requests=27
top_1=/mweb/v1/imagex/submit_audit_job risk=upload safe_replay=false
top_2=/mweb/v1/get_unread_count risk=read safe_replay=true
top_3=/mweb/v1/get_upload_token risk=upload safe_replay=false
safe_replay_candidate=/mweb/v1/get_unread_count
```

Proof files:

```txt
data/jimeng-lab/proof-20260610-capture-analyze-subject-create-v3/normalized/capture-analyze-20260610024757-summary.md
data/jimeng-lab/proof-20260610-capture-analyze-subject-create-v3/normalized/capture-analyze-20260610024757-analysis.json
data/jimeng-lab/proof-20260610-capture-analyze-subject-create-v3/raw/capture-analyze-20260610024757-endpoint-probe-candidates.json
```

The normalized analyzer output was checked for signed URL leakage:

```bash
if rg -n "https://|x-signature|x-expires|expire_time|byteimg|douyinpic|vlabvod" \
  data/jimeng-lab/proof-20260610-capture-analyze-subject-create-v3/normalized; then
  exit 1
else
  echo "normalized capture-analysis proof has no signed URLs"
fi
```

Expected result:

```txt
normalized capture-analysis proof has no signed URLs
```

## Discovery Worklist Smoke

`discovery-worklist` is the offline prioritization step after `capture-analyze`. It does not load a browser session or spend generation quota. It merges analyzer output, optional raw replay candidates, and optional static source/bundle roots into a small next-slice queue.

Proof command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts discovery-worklist \
  --analysis data/jimeng-lab/proof-20260610-capture-analyze-subject-create-v3/normalized/capture-analyze-20260610024757-analysis.json \
  --probeCandidates data/jimeng-lab/proof-20260610-capture-analyze-subject-create-v3/raw/capture-analyze-20260610024757-endpoint-probe-candidates.json \
  --staticRoot packages/jimeng-client/src \
  --outDir data/jimeng-lab/proof-20260610-discovery-worklist-subject-create-v3
```

Result:

```txt
discovery-worklist saved items=18 probe_exports=1
captured_endpoints=4
static_endpoints=39
already_covered_capture_endpoints_skipped=2
raw_probe_variant_export=/mweb/v1/get_unread_count
top_gap_1=/mweb/v1/dreamina_subject/generate_voice action=approval_or_disposable_fixture
top_gap_2=/mweb/v1/voice/submit_task action=approval_or_disposable_fixture
top_gap_3=/lv/v1/cc_web/plane/get_collection_templates action=static_capture_needed
superseded_note=Later CapCut static/probe work promoted this endpoint with body field id:<collectionId>.
```

Proof files:

```txt
data/jimeng-lab/proof-20260610-discovery-worklist-subject-create-v3/normalized/discovery-worklist-20260610032849-summary.md
data/jimeng-lab/proof-20260610-discovery-worklist-subject-create-v3/normalized/discovery-worklist-20260610032849-summary.json
data/jimeng-lab/proof-20260610-discovery-worklist-subject-create-v3/raw/discovery-worklist-20260610032849.json
data/jimeng-lab/proof-20260610-discovery-worklist-subject-create-v3/raw/discovery-worklist-20260610032849-mweb-v1-get_unread_count-variants.json
```

The normalized worklist output was checked for signed URL and raw probe-body leakage:

```bash
if rg -n "https://|x-signature|x-expires|expire_time|byteimg|douyinpic|vlabvod|secret-style-reference" \
  data/jimeng-lab/proof-20260610-discovery-worklist-subject-create-v3/normalized; then
  exit 1
else
  echo "normalized discovery-worklist proof has no signed URLs or raw variant bodies"
fi
```

Expected result:

```txt
normalized discovery-worklist proof has no signed URLs or raw variant bodies
```

## Static Locator Smoke

`static-locate` is the offline bridge between a prioritized endpoint and the code that likely builds its request. It does not load a browser session or spend generation quota.

Proof command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts static-locate \
  --analysis data/jimeng-lab/proof-20260610-capture-analyze-subject-create-v3/normalized/capture-analyze-20260610024757-analysis.json \
  --staticRoot packages/jimeng-client/src \
  --outDir data/jimeng-lab/proof-20260610-static-locate-subject-create \
  --limit 4
```

Result:

```txt
static-locate saved endpoints=4 occurrences=16
endpoint_count=4
top_1=/mweb/v1/get_upload_token occurrences=9 files=3
top_2=/mweb/v1/imagex/submit_audit_job occurrences=6 files=3
top_3=/mweb/v1/get_unread_count occurrences=1 files=1
```

Proof files:

```txt
data/jimeng-lab/proof-20260610-static-locate-subject-create/raw/static-locate-20260610040116.json
data/jimeng-lab/proof-20260610-static-locate-subject-create/normalized/static-locate-20260610040116-summary.json
data/jimeng-lab/proof-20260610-static-locate-subject-create/normalized/static-locate-20260610040116-summary.md
```

The normalized static locator output was checked for signed URL and credential leakage:

```bash
latest=$(find data/jimeng-lab/proof-20260610-static-locate-subject-create/normalized -name 'static-locate-*-summary.json' | sort | tail -1)
if rg -n "https://|x-signature|x-expires|expire_time|byteimg|douyinpic|vlabvod|cookie|authorization" "$latest"; then
  exit 1
else
  echo "normalized static-locate proof has no signed URLs or credentials"
fi
```

Expected result:

```txt
normalized static-locate proof has no signed URLs or credentials
```

Symbol-search proof for CapCut template endpoints:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts static-locate \
  --endpoint /lv/v1/cc_web/replicate/search_templates,/lv/v1/cc_web/plane/get_collection_templates,/lv/v1/cc_web/plane/batch_get_collection_templates,/lv/v1/cc_web/plane/fuzzy_search_templates \
  --symbol SearchTemplates,GetTemplatesAccordCategory,GetBatchTemplatesByCategory,FuzzySearchTemplateByTitle,GetTemplateHotWords,GetCategories \
  --staticRoot data/jimeng-lab/js-sweep/files \
  --outDir data/jimeng-lab/proof-20260610-static-locate-capcut-templates-symbols \
  --limit 8 \
  --contextLines 1
```

Result:

```txt
static-locate saved endpoints=4 occurrences=24
endpoint_count=4
query_count=6
search_term_count=10
```

Proof files:

```txt
data/jimeng-lab/proof-20260610-static-locate-capcut-templates-symbols/raw/static-locate-20260610041211.json
data/jimeng-lab/proof-20260610-static-locate-capcut-templates-symbols/normalized/static-locate-20260610041211-summary.json
data/jimeng-lab/proof-20260610-static-locate-capcut-templates-symbols/normalized/static-locate-20260610041211-summary.md
```

The normalized CapCut symbol-search output was checked for signed URL and credential leakage:

```bash
if rg -n "https?://[^\"'\`[:space:])]+|x-signature=|msToken=|cookie=|authorization=|token=|secret=" \
  data/jimeng-lab/proof-20260610-static-locate-capcut-templates-symbols/normalized; then
  exit 1
else
  echo "normalized static-locate capcut-symbol proof has no signed URLs or credentials"
fi
```

Direct no-spend API probe notes:

- `/lv/v1/cc_web/replicate/get_search_words` returned `ret: "0"` with region-only data.
- `/lv/v1/cc_web/plane/fuzzy_search_templates` returned `ret: "0"` with an empty `item_list` for the simple `keyword` body.
- `/lv/v1/cc_web/replicate/search_templates` and early `/lv/v1/cc_web/plane/get_collection_templates` guessed bodies returned `ret: "1000"` / `errmsg: "param error"`. This collection-template note is superseded by the later confirmed `id:<collectionId>` body and `capcut-collection-templates` command; search still needs exact UI-captured payloads or deeper static call-site recovery.
- No image/video/voice generation job was submitted during this proof.

## Agent Catalog Smoke

`agent-catalog` is the schema-backed, no-spend model/tool catalog for the older creation-agent surface. It promotes the generic catalog probes into normalized fields that later generation commands can use for flags and validation.

Proof command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts agent-catalog \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoints skills,config \
  --outDir data/jimeng-lab/proof-20260610-agent-catalog
```

Result:

```txt
agent-catalog saved endpoints=skills,config imageModels=8 videoModels=5
skill_count=4
image_model_count=8
video_model_count=5
video_input_media_types=end_frame,first_frame,multi_frame,prompt,unified_edit
video_option_keys=fps,frames,input_media_type,multi_frames,resolution,unified_edit,video_aspect_ratio
```

Proof files:

```txt
data/jimeng-lab/proof-20260610-agent-catalog/raw/agent-catalog-20260610034941.json
data/jimeng-lab/proof-20260610-agent-catalog/normalized/agent-catalog-20260610034941-summary.json
```

The normalized agent-catalog output was checked for signed URL leakage:

```bash
if rg -n "https://|x-signature|x-expires|expire_time|byteimg|douyinpic|vlabvod" \
  data/jimeng-lab/proof-20260610-agent-catalog/normalized; then
  exit 1
else
  echo "normalized agent-catalog proof has no signed URLs"
fi
```

Expected result:

```txt
normalized agent-catalog proof has no signed URLs
```

## Image Models Common Config Smoke

`image-models` is the schema-backed, no-spend model catalog for the direct image common-config surface. It uses `/mweb/v1/get_common_config` rather than the older creation-agent config wrapper.

Proof command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts image-models \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --outDir data/jimeng-lab/proof-20260610-image-models
```

Result:

```txt
image-models saved models=8 default=0
model_count=8
default_model_index=0
first_selected_model.workbench=high_aes_general_v50
first_model=图片5.0 Lite
first_model_sample_steps=16,min=10,max=41
first_model_resolution_keys=2k,4k
```

High-value flags observed:

```txt
control_or_reference_feats=bg_paint,byte_edit,byte_edit_with_custom_ratio,byte_edit_with_empty_prompt,canny,character,depth,face_swap,ip_keep,pose,refuse_image,smart_scale,support_subject
blend_controls=bg_paint,canny,depth,face_swap,pose
commercial_benefit_types=image_basic_generate_piece,image_basic_generate_plus,image_basic_v41_2k,image_basic_v41_4k,image_basic_v43_2k,image_basic_v43_4k,image_basic_v46_2k,image_basic_v46_4k,image_basic_v4_pro_2k,image_basic_v4_pro_4k,image_basic_v5_2k,image_basic_v5_4k,image_blend_piece,image_blend_plus,image_inpainting_eraser_piece,image_inpainting_repaint_byteedit_piece,image_inpainting_repaint_piece,image_uhd,image_uhd_4k
```

Proof files:

```txt
data/jimeng-lab/proof-20260610-image-models/raw/image-models-20260610063039.json
data/jimeng-lab/proof-20260610-image-models/normalized/image-models-20260610063039-summary.json
```

The normalized image-models output was checked for signed URL or credential leakage:

```bash
if rg -n 'https?://|x-signature|x-expires|sessionid|sid_guard|msToken|odin_tt|passport|cookie|authorization|token=|secret=' \
  data/jimeng-lab/proof-20260610-image-models/normalized; then
  exit 1
else
  echo "normalized image-models proof has no signed URL or credential markers"
fi
```

Expected result:

```txt
normalized image-models proof has no signed URL or credential markers
```

## Endpoint Probe / VOD Metadata Smoke

`endpoint-probe` is the faster replay step for future reversal work. It does not guess or fuzz automatically; it replays explicit JSON body variants from CDP/static evidence, then writes raw local bodies plus normalized request/response shape summaries.

Variant proof for `/mweb/v1/get_video_by_vid`:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts endpoint-probe \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoint /mweb/v1/get_video_by_vid \
  --variants '[{"name":"vids","body":{"vids":["v03870g10004d8k1u4nog65hb08dnhig"]}},{"name":"vid","body":{"vid":"v03870g10004d8k1u4nog65hb08dnhig"}}]' \
  --outDir data/jimeng-lab/proof-20260610-endpoint-probe-video-info
```

Result:

```txt
endpoint-probe saved variants=2 rets=vids:0,vid:1000
```

Promoted typed command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts video-info \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --vid v03870g10004d8k1u4nog65hb08dnhig \
  --outDir data/jimeng-lab/proof-20260610-video-info
```

Result:

```txt
video-info saved count=1 vids=v03870g10004d8k1u4nog65hb08dnhig:720p
ret=0
errmsg=success
response_sha256=06ae536f69e703297f9cba1988665d0dcf4ad7c05bc117f79332931ec010a17d
duration=5s
resolution=704x1248
fps=24
format=mp4
definition=720p
size_bytes=4285498
transcoded_definitions=720p
```

The normalized summaries were checked for signed URL leakage:

```bash
if rg -n "https://|x-signature|x-expires|expire_time|byteimg|douyinpic|vlabvod|SIGNED_URL" \
  data/jimeng-lab/proof-20260610-endpoint-probe-video-info/normalized \
  data/jimeng-lab/proof-20260610-video-info/normalized; then
  exit 1
else
  echo "normalized endpoint-probe/video-info proofs have no signed URLs"
fi
```

Expected result:

```txt
normalized endpoint-probe/video-info proofs have no signed URLs
```

## Voice / TTS Smoke

Refreshed the logged-in session from the background Jimeng browser:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts session \
  --cdp http://127.0.0.1:9340 \
  --target-url jimeng.jianying.com \
  --session-out data/jimeng-lab/raw/session-bundle-current.json
```

Catalog probe:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts catalog \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --outDir data/jimeng-lab/cli-catalog-smoke
```

Result:

```txt
catalog saved endpoints=6
```

Confirmed catalog ids:

- `skill-list`
- `agent-config`
- `voice-assets`
- `lip-sync-image-config`
- `lip-sync-video-config`
- `subject-list`

Voice library replay:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts voices \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-captures/20260603090356-home-session-smoke/capture-template.raw.json \
  --outDir data/jimeng-lab/cli-voices-smoke-2
```

Result:

```txt
voices saved count=142
```

TTS dry-run:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts tts \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --voice-id 7597003459665072686 \
  --voice-title '直爽女大' \
  --text '这条视频值得试一下。' \
  --outDir data/jimeng-lab/cli-tts-dry-run \
  --dryRun
```

TTS live sample:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts tts \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --voice-id 7597003459665072686 \
  --voice-title '直爽女大' \
  --text '这条视频值得试一下。' \
  --outDir data/jimeng-lab/cli-tts-smoke
```

Result artifact:

```txt
data/jimeng-lab/cli-tts-smoke/artifacts/直爽女大-7597003459665072686.mp3
```

The saved-session path was also exercised independently with `--session ... --dryRun`, confirming the direct API commands can run without refreshing CDP on every call when a fresh session bundle already exists.

Sequential voice sampling proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts sample-voices \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-captures/20260603090356-home-session-smoke/capture-template.raw.json \
  --text '这条视频值得试一下。' \
  --limit 2 \
  --outDir data/jimeng-lab/cli-sample-voices-smoke
```

Full current library sample run:

```txt
generated: 142/142
artifact dir: data/jimeng-lab/voice-library-samples/artifacts/
manifest: data/jimeng-lab/voice-library-samples/manifest.json
risk-control: no 1019 / shark-not-pass errors observed
```

All raw session bundles, captures, manifests, and MP3s stay under ignored `data/**`.

## Playable Proof Bundle

For Jimeng provider work, proof of work is both:

- tests for the TypeScript client/contract helpers
- actual local media artifacts that can be opened/listened to

Current proof bundle:

```txt
data/jimeng-lab/proof-20260609-voice-video/
  manifest.json
  artifacts/jimeng-direct-video-proof.mp4
  artifacts/直爽女大-7597003459665072686.mp3
  normalized/video-result.json
```

TTS command used for the proof bundle:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts tts \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --voice-id 7597003459665072686 \
  --voice-title '直爽女大' \
  --text '这条视频值得试一下。这个声音可以直接用在UGC广告里。' \
  --outDir data/jimeng-lab/proof-20260609-voice-video
```

Video proof source:

```txt
data/jimeng-lab/live-smoke/20260603-direct-video/artifacts/9122d120-d898-4a3f-a2b6-e80b4ac93557-00.mp4
```

Copied proof artifact:

```txt
data/jimeng-lab/proof-20260609-voice-video/artifacts/jimeng-direct-video-proof.mp4
```

Original video-generation command recorded in the proof manifest:

```bash
bun packages/jimeng-client/src/dreamina-compatible-cli.ts text2video \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --session-bundle data/jimeng-lab/raw/session-bundle.json \
  --prompt '赛博霓虹背景中，一只可爱的卡通海豹像金融主播一样严肃点头，镜头缓慢推进，绿色折线和小火箭轻微漂浮，电影感，无文字，无字幕，无水印' \
  --duration=3 \
  --ratio=16:9 \
  --model_version=3.0fast \
  --outDir data/jimeng-lab/live-smoke/20260603-direct-video
```

File validation:

```txt
audio: MPEG ADTS MP3, 96 kbps, 24 kHz, mono
video: ISO Media MP4
```

Generated media remains ignored under `data/**`; only commands and contract facts should be committed.

## Upload Token Smoke

The next useful API for UGC reference workflows is upload-token retrieval, because image-to-video needs a local reference image to become a Jimeng provider URI.

Command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts upload-token \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --scene image \
  --outDir data/jimeng-lab/upload-token-cli-smoke
```

Result:

```txt
upload-token saved scene=2
ret=0
region=cn
spaceName=tb4s082cfz
accessKeyPresent=true
secretKeyPresent=true
sessionTokenPresent=true
```

Raw token responses include temporary credentials and are intentionally local-only under ignored `data/**`.

## ImageX Upload Smoke

Local reference-image upload is now live-proved. This is the required bridge from local files to provider URIs for first-frame image-to-video and reference/persona workflows.

Command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts upload-image \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --file data/jimeng-lab/image-upload-probe/aws4-live/proof-1x1.png \
  --outDir data/jimeng-lab/proof-20260609-image-upload
```

Result:

```txt
upload-image saved uri=tos-cn-i-tb4s082cfz/97c32453461a4041b4f6e20f1dc0a517.png
artifact=data/jimeng-lab/proof-20260609-image-upload/artifacts/proof-1x1.png
summary=data/jimeng-lab/proof-20260609-image-upload/normalized/upload-image-20260609123111-summary.json
```

Safe summary fields:

```txt
storeUri=tos-cn-i-tb4s082cfz/97c32453461a4041b4f6e20f1dc0a517.png
uploadStatus=200
uploadCrc32=9050a959
ImageWidth=1
ImageHeight=1
ImageFormat=png
```

Raw token/apply responses include temporary credentials and upload authorization. They are intentionally local-only under ignored `data/**`.

## Reference Image Inspect Smoke

`jimeng-browser-proxy describe-image` uploads a local reference image when needed, then calls Jimeng's no-generation image-description and face-recognition endpoints.

Command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts describe-image \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --outDir data/jimeng-lab/proof-20260610-reference-image-inspect
```

Result:

```txt
raw=data/jimeng-lab/proof-20260610-reference-image-inspect/raw/describe-image-20260609155534-q25boh-raw.json
summary=data/jimeng-lab/proof-20260610-reference-image-inspect/normalized/describe-image-20260609155534-q25boh-summary.json
image_uri=tos-cn-i-tb4s082cfz/b8f5124217774661b005916f6ca5bae8.png
description=黑发女人，白色背心。
description_ret=0
description_sha256=77b52d1885139655c7279ebedd49c6000564c923af84db4ff812307de9628f5f
face_recognition_ret=0
face_recognition_sha256=aa358db205f856bbd3369effb85576c4a7b6f265f4bdd6a96a8f805ecaa35d03
face_count=0
```

The face-recognition endpoint completed successfully but found no face on this generated input. Raw upload traces and response bodies remain under ignored `data/**`.

## ControlNet Reference Preview Smoke

`jimeng-browser-proxy controlnet-preview` uploads a local reference image when needed, then calls Jimeng's no-generation ControlNet preview endpoint. For `--control pose`, it also calls `pose_detect` and saves the returned preview skeleton/control-map image.

Pose command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts controlnet-preview \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --control pose \
  --outDir data/jimeng-lab/proof-20260610-controlnet-pose-preview
```

Result:

```txt
raw=data/jimeng-lab/proof-20260610-controlnet-pose-preview/raw/controlnet-preview-20260609162825-rvn7f6-raw.json
summary=data/jimeng-lab/proof-20260610-controlnet-pose-preview/normalized/controlnet-preview-20260609162825-rvn7f6-summary.json
source_copy=data/jimeng-lab/proof-20260610-controlnet-pose-preview/artifacts/controlnet-preview-20260609162825-rvn7f6-controlnet_reference-jimeng-kbeauty-01.png
preview_artifact=data/jimeng-lab/proof-20260610-controlnet-pose-preview/artifacts/controlnet-preview-20260609162825-rvn7f6-pose-preview.png
image_uri=tos-cn-i-tb4s082cfz/2cb5efccab014a29b171719f4303cb21.png
preview_image_uri=tos-cn-i-tb4s082cfz/222b232061324073accaf7992ec3ad87
control=pose
strength=0.6
fit_mode=center_crop
pose_detected=true
preview_response_sha256=c9404ff104ba8c380eccada50e1526489b756a6c5380fe512da12ea76f1f0c65
pose_detect_response_sha256=4f9e4059d904fdb8f6fb8491eb79eab0e609e630dbbcfe29f4a76e53e5c91f5f
preview_file=PNG image data, 1024 x 1024, 8-bit/color RGB, non-interlaced
```

Depth command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts controlnet-preview \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --control depth \
  --outDir data/jimeng-lab/proof-20260610-controlnet-depth-preview
```

Depth result:

```txt
summary=data/jimeng-lab/proof-20260610-controlnet-depth-preview/normalized/controlnet-preview-20260609163638-wworll-summary.json
preview_artifact=data/jimeng-lab/proof-20260610-controlnet-depth-preview/artifacts/controlnet-preview-20260609163638-wworll-depth-preview.png
preview_image_uri=tos-cn-i-tb4s082cfz/df194e1d74a54982ae5ceb151e239c9c
preview_response_sha256=cfd5828742c4efcfe55608254088ddde59bc3dbd2ac4b49df7ba2dad86cbd396
preview_file=PNG image data, 1024 x 1024, 8-bit/color RGB, non-interlaced
```

Canny command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts controlnet-preview \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --control canny \
  --outDir data/jimeng-lab/proof-20260610-controlnet-canny-preview
```

Canny result:

```txt
summary=data/jimeng-lab/proof-20260610-controlnet-canny-preview/normalized/controlnet-preview-20260609163709-xrv4zg-summary.json
preview_artifact=data/jimeng-lab/proof-20260610-controlnet-canny-preview/artifacts/controlnet-preview-20260609163709-xrv4zg-canny-preview.png
preview_image_uri=tos-cn-i-tb4s082cfz/915b0cd6c0c943fc9ab24b5c12e5a26d
preview_response_sha256=ab6fbaa477cfe91545ede7a482ef319e8663ae2be96e05d1e1b0d3ff40ef6c45
preview_file=PNG image data, 1024 x 1024, 8-bit/color RGB, non-interlaced
```

Normalized summary files were checked for signed URL leakage:

```bash
rg -n "X-Amz|signed|http[s]?://" \
  data/jimeng-lab/proof-20260610-controlnet-pose-preview/normalized \
  data/jimeng-lab/proof-20260610-controlnet-depth-preview/normalized \
  data/jimeng-lab/proof-20260610-controlnet-canny-preview/normalized
```

Result: no matches.

Raw upload/preview responses may contain signed URLs and temporary upload traces. They remain under ignored `data/**`.

## Object Mask Segmentation Smoke

`jimeng-browser-proxy object-mask` uploads a local reference image when needed, then calls Jimeng's no-generation `/mweb/v1/saliency_seg` endpoint. The frontend calls both the `canvas` mode request and the default request for object detection, so the smoke uses `--mode both`.

Command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts object-mask \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --mode both \
  --outDir data/jimeng-lab/proof-20260610-object-mask
```

Result:

```txt
raw=data/jimeng-lab/proof-20260610-object-mask/raw/object-mask-20260609165112-8yjxpj-raw.json
summary=data/jimeng-lab/proof-20260610-object-mask/normalized/object-mask-20260609165112-8yjxpj-summary.json
source_copy=data/jimeng-lab/proof-20260610-object-mask/artifacts/object-mask-20260609165112-8yjxpj-object_mask_reference-jimeng-kbeauty-01.png
image_uri=tos-cn-i-tb4s082cfz/080999a077994629bbec76c6f344a09a.png
canvas_mask_uri=tos-cn-i-tb4s082cfz/2b0258d421f14b02b6f20a23eeaae0ec
canvas_mask_artifact=data/jimeng-lab/proof-20260610-object-mask/artifacts/object-mask-20260609165112-8yjxpj-canvas-mask-01.png
canvas_response_sha256=c903f33db56e3f156b6c9a37a61af8668b87169f1642ea6ac3ce7fee4db1c65a
default_mask_uri=tos-cn-i-tb4s082cfz/d6641d59e6de4d17be119c0b98506129
default_mask_artifact=data/jimeng-lab/proof-20260610-object-mask/artifacts/object-mask-20260609165112-8yjxpj-default-mask-01.png
default_response_sha256=7c6f74cd237c1ed788e369300eb30ea8c4de67efe3ca5548db4abcaff9ab2abc
mask_files=PNG image data, 2048 x 2048, 8-bit/color RGBA, non-interlaced
```

Normalized summary files were checked for signed URL leakage:

```bash
rg -n 'X-Amz|signed|https?://' \
  data/jimeng-lab/proof-20260610-object-mask/normalized
```

Result: no matches.

Raw upload/segmentation responses may contain signed mask URLs and temporary upload traces. They remain under ignored `data/**`.

## Image-To-Video First-Frame Smoke

Local-upload-backed image-to-video is now live-proved through the browser-proxy front door.

Dry-run with a real Korean-beauty UGC reference image:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts image2video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --prompt '韩系美妆达人自拍风格，干净卧室自然光，镜头轻微推进，创作者像真实TikTok种草视频一样自然开场，前三秒有明确痛点钩子，无字幕，无水印，不要生成可读文字。' \
  --durationSec 5 \
  --ratio 9:16 \
  --videoResolution 720p \
  --modelVersion 3.0fast \
  --seed 20260609 \
  --dryRun \
  --outDir data/jimeng-lab/proof-20260609-image2video-local-upload
```

Dry-run result:

```txt
upload URI=tos-cn-i-tb4s082cfz/7abfa90c628d46859c32dc2feffcd2e1.png
plan=data/jimeng-lab/proof-20260609-image2video-local-upload/raw/image2video-20260609132522-77co2l-dry-run-plan.json
raw upload trace=data/jimeng-lab/proof-20260609-image2video-local-upload/raw/image2video-20260609132522-77co2l-reference-upload-0-raw.json
reference copy=data/jimeng-lab/proof-20260609-image2video-local-upload/artifacts/image2video-20260609132522-77co2l-first_frame-jimeng-kbeauty-01.png
```

Patched payload facts:

```txt
first_frame_image=tos-cn-i-tb4s082cfz/7abfa90c628d46859c32dc2feffcd2e1.png
prompt=韩系美妆达人自拍风格...
duration_ms=5000
ratio=9:16
videoResolution=720p
model_req_key=dreamina_ic_generate_video_model_vgfm_3.0_fast
seed=20260609
```

Live command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts image2video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --firstFrameUri tos-cn-i-tb4s082cfz/7abfa90c628d46859c32dc2feffcd2e1.png \
  --prompt '韩系美妆达人自拍风格，干净卧室自然光，镜头轻微推进，创作者像真实TikTok种草视频一样自然开场，前三秒有明确痛点钩子，无字幕，无水印，不要生成可读文字。' \
  --durationSec 5 \
  --ratio 9:16 \
  --videoResolution 720p \
  --modelVersion 3.0fast \
  --seed 20260609 \
  --pollIntervalMs 10000 \
  --maxPolls 30 \
  --outDir data/jimeng-lab/proof-20260609-image2video-live
```

Live result:

```txt
submitId=aa83d0e1-a20c-4b85-ab59-ee3a7894296f
historyId=39156175522050
status=50
poll trace count=5
video=data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4
thumbnail=data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-thumb-2s.jpg
normalized=data/jimeng-lab/proof-20260609-image2video-live/normalized/image2video-20260609132811-kongh1-result.json
```

Media validation:

```bash
ffprobe -v error \
  -show_entries stream=codec_type,codec_name,width,height,avg_frame_rate,duration:format=duration,size,format_name \
  -of json \
  data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4
```

Validation result:

```txt
codec=h264
resolution=704x1248
duration=5.016667s
size=4285498 bytes
format=mov,mp4,m4a,3gp,3g2,mj2
```

Thumbnail extraction:

```bash
ffmpeg -y \
  -i data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4 \
  -ss 00:00:02 \
  -frames:v 1 \
  data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-thumb-2s.jpg
```

## VOD Video Upload Smoke

Local VOD upload is now live-proved for small/direct reference clips. This is the bridge from local MP4 files to Jimeng video references for reference-video, multimodal/all-around reference, and lip-sync payloads.

Dry-run command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts upload-video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --file data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4 \
  --outDir data/jimeng-lab/proof-20260609-video-upload-dry-run \
  --dryRun
```

Preflight token command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts upload-token \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --scene video \
  --outDir data/jimeng-lab/proof-20260609-video-upload-token
```

Live upload command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts upload-video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --file data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4 \
  --outDir data/jimeng-lab/proof-20260609-video-upload-live
```

Live result:

```txt
vid=v03870g10004d8k1u4nog65hb08dnhig
storeUri=tos-cn-v-148450/o4gBE1AAWbfiDDig6xEQ4KJhDHQvlExoFkFExB
summary=data/jimeng-lab/proof-20260609-video-upload-live/normalized/upload-video-20260609141130-summary.json
raw=data/jimeng-lab/proof-20260609-video-upload-live/raw/upload-video-20260609141130-raw.json
artifact=data/jimeng-lab/proof-20260609-video-upload-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4
```

Media validation:

```bash
ffprobe -v error \
  -show_entries format=duration,size:stream=codec_name,width,height,duration \
  -of json \
  data/jimeng-lab/proof-20260609-video-upload-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4
```

Validation result:

```txt
codec=h264
resolution=704x1248
duration=5.016667s
size=4285498 bytes
uploadCrc32=1929b92c
```

Raw token/apply/commit responses include temporary credentials and provider auth. They are intentionally local-only under ignored `data/**`.

## Lip-Sync VOD Plan Smoke

`jimeng-browser-proxy lip-sync` now prepares the VOD-reference lip-sync provider input without live submit. This uses the already live-proved VOD `vid` and raw `VideoMeta` fields from the upload proof, so it does not spend generation quota or perform another upload.

Command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts lip-sync \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --vid v03870g10004d8k1u4nog65hb08dnhig \
  --videoUri tos-cn-v-148450/o4gBE1AAWbfiDDig6xEQ4KJhDHQvlExoFkFExB \
  --videoWidth 704 \
  --videoHeight 1248 \
  --videoDurationSec 5.016667 \
  --voice-id 7597003459665072686 \
  --tone-key 清爽女声 \
  --text 三秒告诉你为什么这款补水精华适合熬夜后的底妆。 \
  --outDir data/jimeng-lab/proof-20260610-lip-sync-vod-plan \
  --dryRun
```

Result:

```txt
plan=data/jimeng-lab/proof-20260610-lip-sync-vod-plan/raw/lip-sync-20260609145310-83bdpg-dry-run-plan.json
summary=data/jimeng-lab/proof-20260610-lip-sync-vod-plan/normalized/lip-sync-20260609145310-83bdpg-summary.json
status=dry-run-only
model_req_key=dreamina_lib_sync_base
provider path=input.videoGenInputs.v2vOpt.lipSyncUserVideo
process flow=DAVideoProcessType.LipSyncUserVideo
ttsInfo.sourceType=text-to-speech
```

The command is intentionally dry-run-only. Live submit still needs a captured frontend lip-sync `/mweb/v1/aigc_draft/generate` request so the final converted `draft_content` can be compared before spending quota.

## Lip-Sync Compare Smoke

`jimeng-browser-proxy lip-sync-compare` is the offline gate for enabling live lip-sync submit. It compares a dry-run `providerInput.videoGenInputs` and `modelReqKey` against captured `/mweb/v1/aigc_draft/generate` UI submits from `raw-network.jsonl` or `capture-template.raw.json`.

Current proof uses the existing subject-create capture, which should not contain a lip-sync submit:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts lip-sync-compare \
  --plan data/jimeng-lab/proof-20260610-lip-sync-vod-plan/raw/lip-sync-20260609145310-83bdpg-dry-run-plan.json \
  --rawNetwork data/jimeng-captures/20260610-subject-create-ui/raw-network.jsonl \
  --outDir data/jimeng-lab/proof-20260610-lip-sync-compare-no-capture
```

Result:

```txt
lip-sync-compare saved match=false candidates=0
mode=video
plan_model_req_key=dreamina_lib_sync_base
```

Proof files:

```txt
data/jimeng-lab/proof-20260610-lip-sync-compare-no-capture/raw/lip-sync-compare-20260610030130.json
data/jimeng-lab/proof-20260610-lip-sync-compare-no-capture/normalized/lip-sync-compare-20260610030130-summary.json
```

Signed URL marker check:

```bash
if rg -n "https://|x-signature|x-expires|expire_time|byteimg|douyinpic|vlabvod" \
  data/jimeng-lab/proof-20260610-lip-sync-compare-no-capture/normalized; then
  exit 1
else
  echo "normalized lip-sync-compare proof has no signed URLs"
fi
```

Expected result:

```txt
normalized lip-sync-compare proof has no signed URLs
```

## Lip-Sync Image/Avatar Plan Smoke

`jimeng-browser-proxy lip-sync --image` now prepares the image/avatar lip-sync provider input without live submit. It uploads the local reference image through ImageX first, then writes the dry-run plan using the frontend `i2vOpt.realmanAvatar` payload shape. This consumes upload API calls but does not submit generation.

Command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts lip-sync \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --voice-id 7597003459665072686 \
  --tone-key 清爽女声 \
  --text '三秒告诉你为什么这款补水精华适合熬夜后的底妆。' \
  --outDir data/jimeng-lab/proof-20260610-lip-sync-image-plan \
  --dryRun
```

Result:

```txt
plan=data/jimeng-lab/proof-20260610-lip-sync-image-plan/raw/lip-sync-20260609233956-n72ys1-dry-run-plan.json
summary=data/jimeng-lab/proof-20260610-lip-sync-image-plan/normalized/lip-sync-20260609233956-n72ys1-summary.json
reference_upload=data/jimeng-lab/proof-20260610-lip-sync-image-plan/raw/lip-sync-20260609233956-n72ys1-reference-upload-0-raw.json
artifact_copy=data/jimeng-lab/proof-20260610-lip-sync-image-plan/artifacts/lip-sync-20260609233956-n72ys1-lip_sync_image-jimeng-kbeauty-01.png
status=dry-run-only
mode=image
model_req_key=dreamina_lib_sync_image_quick_1.5
provider path=input.videoGenInputs.i2vOpt.realmanAvatar
process flow=DAVideoProcessType.LipSyncImage
image_uri=tos-cn-i-tb4s082cfz/487472ac3b204caa89fc1b2764c0aa1e.png
dimensions=2048x2048
summary_sha256=ed087e3df60ae9c30dc835d2d410867670229abfb115adb186846aa1aa631fc6
dry_run_plan_sha256=5386ac4dd343228680dc66395faade92dfbd225d4968baa3f2e2decba248dea4
```

Normalized token/signed URL marker check:

```bash
rg -n 'X-Amz|x-signature|x-expires|sessionid|sid_guard|msToken' \
  data/jimeng-lab/proof-20260610-lip-sync-image-plan/normalized
```

Expected result: no matches.

## Lip-Sync Config Smoke

`jimeng-browser-proxy lip-sync-config` fetches the no-spend model configs for digital-human/image-avatar lip sync and video lip sync.

Dry run:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts lip-sync-config \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --outDir data/jimeng-lab/proof-20260610-lip-sync-config-dry-run \
  --dryRun
```

Live command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts lip-sync-config \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --outDir data/jimeng-lab/proof-20260610-lip-sync-config
```

Result:

```txt
raw=data/jimeng-lab/proof-20260610-lip-sync-config/raw/lip-sync-config-20260609232724.json
summary=data/jimeng-lab/proof-20260610-lip-sync-config/normalized/lip-sync-config-20260609232724-summary.json
image_models=dreamina_lib_sync_image_master_1.5:大师模式:input_media_type,audio_option | dreamina_lib_sync_image_quick_1.5:快速模式:input_media_type,audio_option
image_default_idx=1
video_models=dreamina_lib_sync_base:基础模式:仅仅修改人物口型。适合演讲、对白
video_default_idx=0
image_response_text_sha256=4ee64d934e475164c23f6c5ed3080a65e33bbe2f478152b4786b187fc24abc23
video_response_text_sha256=03cb4d200ad77f1e5bded4d6d558bf5f5798b991040ff621f28d74d65ab07ae0
```

Raw config responses include signed model-preview GIF URLs. Normalized proof is checked separately:

```bash
rg -n 'X-Amz|x-signature|x-expires|sessionid|sid_guard|msToken' \
  data/jimeng-lab/proof-20260610-lip-sync-config/normalized \
  data/jimeng-lab/proof-20260610-lip-sync-config-dry-run/raw
```

Expected result: no matches.

## Frames-To-Video Dry-Run Smoke

End-frame payload patching is now CLI-accessible through `frames2video`. This run uploads both local images to ImageX, patches `first_frame_image` and `end_frame_image`, and skips generation submit.

Command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts frames2video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --lastImage data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-thumb-2s.jpg \
  --prompt '韩系美妆达人从自然自拍开场走到精华产品特写，真实手机拍摄感，动作自然连贯，前三秒有明确痛点钩子，无字幕，无水印，不要生成可读文字。' \
  --durationSec 5 \
  --ratio 9:16 \
  --videoResolution 720p \
  --modelVersion 3.0fast \
  --seed 20260610 \
  --dryRun \
  --outDir data/jimeng-lab/proof-20260609-frames2video-dry-run
```

Result:

```txt
plan=data/jimeng-lab/proof-20260609-frames2video-dry-run/raw/frames2video-20260609142243-t9emm5-dry-run-plan.json
first_frame_image=tos-cn-i-tb4s082cfz/5b31ee284d5c43eb8097bfc5818b584a.png
end_frame_image=tos-cn-i-tb4s082cfz/325213bd2b2049d3a65667350b72807e.jpg
first image=2048x2048 PNG, 2913365 bytes
end image=704x1248 JPEG, 58126 bytes
duration_ms=5000
ratio=9:16
model_req_key=dreamina_ic_generate_video_model_vgfm_3.0_fast
```

This is dry-run-proved only. Capture/live-proof the frontend end-frame or multi-frame mode before spending generation quota.

## Explore / Template Mining Smoke

`jimeng-browser-proxy templates` calls `/mweb/v1/get_explore` directly with the logged-in browser session. This is a no-generation, no-spend probe for prompt/template mining.

Command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts templates \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 5 \
  --category-id 11222 \
  --work-types image,video,canvas \
  --outDir data/jimeng-lab/proof-20260610-templates-explore
```

Result:

```txt
raw=data/jimeng-lab/proof-20260610-templates-explore/raw/templates-20260609151716.json
summary=data/jimeng-lab/proof-20260610-templates-explore/normalized/templates-20260609151716-summary.json
http_status=200
ret=0
errmsg=success
requested_count=5
returned_total=40
next_offset=5
category_id=11222
by_template_type.image=40
by_ai_feature.text_generate_image=40
```

Normalized examples include `prompt`, `model_req_key`, `seed`, `image_ratio`, template metadata, and usage/favorite counters. The endpoint returned 40 items for `count=5` while setting `next_offset=5`, so downstream UGC mining should treat the count flag as a paging hint and cap locally when needed.

## Short-Video Explore Mining Smoke

`jimeng-browser-proxy short-videos` calls `/mweb/v1/get_explore` with `filter.work_type_list=["short_video"]`. This is a no-generation, no-spend probe for reference-video/profile mining.

Command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts short-videos \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 5 \
  --category-id 11222 \
  --outDir data/jimeng-lab/proof-20260610-short-videos-explore
```

Result:

```txt
raw=data/jimeng-lab/proof-20260610-short-videos-explore/raw/short-videos-20260609153530.json
summary=data/jimeng-lab/proof-20260610-short-videos-explore/normalized/short-videos-20260609153530-summary.json
http_status=200
ret=0
errmsg=success
requested_count=5
returned_total=20
next_offset=5
category_id=11222
feed_refer=feed_enterauto
top_by_play[0].play_num=1718727
top_by_play[0].favorite_num=5082
top_by_play[0].comment_num=167
top_by_play[0].share_num=231
top_by_play[0].duration_sec=85
top_by_play[0].resolution=1280x720
top_by_play[0].fps=15
top_by_play[0].has_audio=true
```

Normalized examples include durable video metadata and ranking signals but omit signed video URLs. Raw responses still contain signed URLs and stay under ignored `data/**`.

## Overseas Short-Video Feed Smoke

`jimeng-browser-proxy overseas-short-videos` calls `/mweb/v1/feed_short_video` with `filter.work_type_list=["short_video"]`. This is a no-generation, no-spend probe for the bundle-discovered overseas/alternate short-video reference feed.

Command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts overseas-short-videos \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 5 \
  --category-id 11222 \
  --outDir data/jimeng-lab/proof-20260610-overseas-short-videos
```

Result:

```txt
raw=data/jimeng-lab/proof-20260610-overseas-short-videos/raw/overseas-short-videos-20260609224456.json
summary=data/jimeng-lab/proof-20260610-overseas-short-videos/normalized/overseas-short-videos-20260609224456-summary.json
http_status=200
ret=0
errmsg=success
requested_count=5
returned_total=4
next_offset=5
category_id=11222
feed_refer=feed_enterauto
top_by_play[0].play_num=2382533
top_by_play[0].favorite_num=3656
top_by_play[0].comment_num=154
top_by_play[0].share_num=319
top_by_play[0].duration_sec=57
top_by_play[0].resolution=3840x2160
top_by_play[0].fps=30
top_by_play[0].has_audio=true
response_text_sha256=dc3ef47f5dd45b9f2681da88f502f39f3ce0ac2b512259f375d70665f63c0487
```

Normalized examples include durable video metadata and ranking signals. Signed cover URLs are redacted to `coverUrlPresent`; raw responses still contain signed media URLs and stay under ignored `data/**`. URL leak check:

```bash
rg -n 'X-Amz|x-signature|x-expires|https?://' data/jimeng-lab/proof-20260610-overseas-short-videos/normalized
```

Result: no matches.

## Saved Subject / Persona List Smoke

`jimeng-browser-proxy subjects` calls `/mweb/v1/dreamina_subject/get` directly with the logged-in browser session. This is a no-generation, no-spend probe for saved subject/persona records.

Command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts subjects \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 20 \
  --outDir data/jimeng-lab/proof-20260610-subjects
```

Result:

```txt
raw=data/jimeng-lab/proof-20260610-subjects/raw/subjects-20260609222826.json
summary=data/jimeng-lab/proof-20260610-subjects/normalized/subjects-20260609222826-summary.json
http_status=200
ret=0
errmsg=success
cursor=0
limit=20
subject_count=0
has_more=false
next_cursor=0
response_text_sha256=618858c54ed5d0b298cf37ed03bf29d27042f54e3e999bb143932cec6a3ef31f
```

That earlier account snapshot had no saved subjects, so the returned empty list was expected. The normalized summary still proves the endpoint contract and omits signed URLs. URL leak check:

```bash
rg -n 'X-Amz|signed|https?://' data/jimeng-lab/proof-20260610-subjects/normalized
```

Result: no matches.

## Saved Subject / Persona Create Smoke

`jimeng-browser-proxy subject-create` creates a saved Jimeng subject/persona directly from a local ImageX-uploaded or existing provider image. This is a no-generation, no-spend asset lifecycle command.

Dry-run:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts subject-create \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --workspaceId 14199856180236 \
  --name "CLI Kbeauty UGC" \
  --description "韩系美妆健身UGC创作者，真实手机自拍参考图。" \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --outDir data/jimeng-lab/proof-20260610-subject-create-cli \
  --dryRun
```

Live proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts subject-create \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --workspaceId 14199856180236 \
  --name "CLI Kbeauty UGC 2" \
  --description "韩系美妆健身UGC创作者，真实手机自拍参考图。" \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --outDir data/jimeng-lab/proof-20260610-subject-create-cli
```

Result:

```txt
subject_id=12352249053442
data_id=12352249053698
main_image_uri=tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png
main_image_size=2048x2048
audit_ret=0
image_lookup_ret=0
create_ret=0
summary=data/jimeng-lab/proof-20260610-subject-create-cli/normalized/subject-create-20260610001348-mm0zq8-summary.json
summary_sha256=52a8d7ba8acf00de72912228a5d1ab1ea0d96edea5adf8be44744d2092258dec
```

Normalized leak check:

```bash
rg -n 'X-Amz|x-signature|x-expires|sessionid|sid_guard|msToken|signed.example' \
  data/jimeng-lab/proof-20260610-subject-create-cli/normalized
```

Result: no matches.

## Saved Subject / Persona Lifecycle Smoke

`jimeng-browser-proxy subject-update` and `jimeng-browser-proxy subject-delete` complete the no-generation subject CRUD path. The proof creates a temporary subject from an existing provider image, updates it, deletes it, then verifies a subject-id filtered list returns zero results.

Dry-run plans:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts subject-update \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --subjectId 12352249053442 \
  --name "CLI Kbeauty tuned" \
  --description "韩系美妆健身UGC创作者，真实手机自拍参考图。" \
  --imageUri tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png \
  --imageWidth 2048 \
  --imageHeight 2048 \
  --outDir data/jimeng-lab/proof-20260610-subject-lifecycle \
  --dryRun

bun packages/jimeng-client/src/browser-proxy-cli.ts subject-delete \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --subjectId 12352249053442 \
  --outDir data/jimeng-lab/proof-20260610-subject-lifecycle \
  --dryRun

bun packages/jimeng-client/src/browser-proxy-cli.ts subject-generate-voice \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --imageUri tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png \
  --outDir data/jimeng-lab/proof-20260610-subject-lifecycle \
  --dryRun
```

Live no-generation proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts subject-create \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --workspaceId 14199856180236 \
  --name "CLI QA Temp" \
  --description "临时主体：用于CLI生命周期验证，随后删除。" \
  --imageUri tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png \
  --imageWidth 2048 \
  --imageHeight 2048 \
  --outDir data/jimeng-lab/proof-20260610-subject-lifecycle

bun packages/jimeng-client/src/browser-proxy-cli.ts subject-update \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --subjectId 14204993143308 \
  --name "CLI QA Updated" \
  --description "临时主体：update命令已验证，随后删除。" \
  --imageUri tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png \
  --imageWidth 2048 \
  --imageHeight 2048 \
  --outDir data/jimeng-lab/proof-20260610-subject-lifecycle

bun packages/jimeng-client/src/browser-proxy-cli.ts subject-delete \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --subjectId 14204993143308 \
  --outDir data/jimeng-lab/proof-20260610-subject-lifecycle

bun packages/jimeng-client/src/browser-proxy-cli.ts subjects \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 20 \
  --subjectIds 14204993143308 \
  --outDir data/jimeng-lab/proof-20260610-subject-lifecycle
```

Result:

```txt
created_subject_id=14204993143308
created_data_id=14204993143564
update_ret=0
update_errmsg=success
delete_ret=0
delete_errmsg=success
post_delete_filtered_subject_count=0
proof=data/jimeng-lab/proof-20260610-subject-lifecycle/
```

Subject voice generation is intentionally dry-run-only:

```txt
request={"image_uri":"tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png"}
status=dry-run-only
reason=live generation may consume quota and still needs explicit spend approval or captured UI submit
```

Normalized signed URL leak check:

```bash
rg -n 'X-Amz|x-signature|x-expires|sessionid|sid_guard|msToken|signed.example' \
  data/jimeng-lab/proof-20260610-subject-lifecycle/normalized
```

Result: no matches.

## Jimeng Custom Voice Clone Smoke

`jimeng-browser-proxy voice-clones` calls the no-spend cloned voice asset list endpoint. The frontend request-builder module also confirms custom voice clone submit/query/update/delete request shapes; submit/update/delete are intentionally dry-run-only until Arthur approves creating or mutating account voice assets.

Live no-spend asset list:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts voice-clones \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 50 \
  --outDir data/jimeng-lab/proof-20260610-voice-clone
```

Dry-run request-shape proofs:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts voice-clone-submit \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --audioVid v03870g10004d8k1u4nog65hb08dnhig \
  --audioDurationSec 3 \
  --audioTitle kbeauty-reference.mp3 \
  --name "Kbeauty reference voice" \
  --outDir data/jimeng-lab/proof-20260610-voice-clone \
  --dryRun

bun packages/jimeng-client/src/browser-proxy-cli.ts voice-clone-query \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --taskIds task-voice-placeholder \
  --outDir data/jimeng-lab/proof-20260610-voice-clone \
  --dryRun

bun packages/jimeng-client/src/browser-proxy-cli.ts voice-clone-update \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --voice-id voice-placeholder \
  --name "Renamed Kbeauty voice" \
  --outDir data/jimeng-lab/proof-20260610-voice-clone \
  --dryRun

bun packages/jimeng-client/src/browser-proxy-cli.ts voice-clone-delete \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --voice-id voice-placeholder \
  --outDir data/jimeng-lab/proof-20260610-voice-clone \
  --dryRun
```

Expected artifact layout:

```txt
data/jimeng-lab/proof-20260610-voice-clone/
  raw/voice-clones-20260610005945.json
  normalized/voice-clones-20260610005945-summary.json
  raw/voice-clone-submit-20260610005945-ctwq0l-dry-run-plan.json
  raw/voice-clone-query-20260610010112-w1953e-dry-run-plan.json
  raw/voice-clone-update-20260610010002-yx13s5-dry-run-plan.json
  raw/voice-clone-delete-20260610010002-qc9nno-dry-run-plan.json
```

Current proof facts:

```txt
voice_clone_asset_ret=0
voice_clone_asset_errmsg=success
voice_clone_asset_count=0
voice_clone_asset_has_more=false
voice_clone_asset_next_offset=50
voice_clone_asset_response_sha256=dd8e9025b1bf0d2f13556868f9a451984d6b1f9bd91647f8582d960c57788ee0
submit_scene=1
submit_audio_vid=v03870g10004d8k1u4nog65hb08dnhig
query_task_id_list=task-voice-placeholder
update_request=local_item_id+name
delete_request=local_item_id
```

Secret/signed URL marker check:

```bash
rg -n 'X-Amz|x-signature|x-expires|sessionid|sid_guard|msToken' \
  data/jimeng-lab/proof-20260610-voice-clone/normalized
```

Result: no live secret values. Dry-run summaries include only redacted cookie placeholders such as `"[REDACTED 3544 chars]"`.

## CapCut Commercial Template Category Smoke

`jimeng-browser-proxy capcut-categories` calls the signed read-only CapCut commercial template category endpoint discovered in the Jimeng/Dreamina frontend bundle. This is a no-generation, no-spend probe and did not require CapCut cookies in the current proof.

Command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-categories \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --outDir data/jimeng-lab/proof-20260610-capcut-categories
```

Expected artifact layout:

```txt
raw=data/jimeng-lab/proof-20260610-capcut-categories/raw/capcut-categories-20260609230631.json
summary=data/jimeng-lab/proof-20260610-capcut-categories/normalized/capcut-categories-20260609230631-summary.json
```

Current proof facts:

```txt
endpoint=https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_categories
request={"sdk_version":"16.1.0"}
ret=0
errmsg=success
category_count=8
categories=Black Friday, Clothing and shoes, Cosmetic dailyization, Food beverages, Jewelry, Furniture, Consumer electronics, pets
response_text_sha256=27f4e1bc5a3ff2ddf94568b77d068db828807ab3aa12be3c484588b1b4ff3ea0
```

URL leak check:

```bash
rg -n 'X-Amz|x-signature|x-expires' data/jimeng-lab/proof-20260610-capcut-categories/normalized
```

Expected result: no matches.

## CapCut Template Collection/Row/Detail Smoke

`jimeng-browser-proxy capcut-collections`, `capcut-collection-templates`, and `capcut-template-detail` call signed read-only CapCut editor API endpoints. These are no-generation, no-spend probes and did not require a Jimeng or CapCut browser session in the current proof.

Commands:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-collections \
  --outDir data/jimeng-lab/proof-20260610-capcut-collections

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-collection-templates \
  --collection-id 10034 \
  --limit 5 \
  --outDir data/jimeng-lab/proof-20260610-capcut-collection-templates

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-template-detail \
  --template-id 7369116096600771846 \
  --outDir data/jimeng-lab/proof-20260610-capcut-template-detail
```

Expected artifact layout:

```txt
collections_raw=data/jimeng-lab/proof-20260610-capcut-collections/raw/capcut-collections-20260610070639.json
collections_summary=data/jimeng-lab/proof-20260610-capcut-collections/normalized/capcut-collections-20260610070639-summary.json
rows_raw=data/jimeng-lab/proof-20260610-capcut-collection-templates/raw/capcut-collection-templates-20260610070639.json
rows_summary=data/jimeng-lab/proof-20260610-capcut-collection-templates/normalized/capcut-collection-templates-20260610070639-summary.json
detail_raw=data/jimeng-lab/proof-20260610-capcut-template-detail/raw/capcut-template-detail-20260610070639.json
detail_summary=data/jimeng-lab/proof-20260610-capcut-template-detail/normalized/capcut-template-detail-20260610070639-summary.json
```

Current proof facts:

```txt
get_collections_ret=0
collection_count=35
useful_collections=Product Display:10031, Beauty Care:10034, Foods & Beverage:10035, Workout and fitness:12007
get_collection_templates_ret=0
request_body_uses_id=10034
template_count=5
has_more=true
new_cursor=5
first_template_web_id=7369116096600771846
first_template_title=FACEBOOK ADS - MARKETING POSTER - BEAUTY LIPSTIC - NEW COLLECTION - FB ADS POST
first_template_canvas=1200x628
get_template_detail_ret=0
template_detail_template_id=7369116096600771846
template_url_present=true
template_data_present=false
draft_data_present=false
template_version=1.4.3
material_counts=effects:8,local_images:4,file_infos:1,replaceable_images:0,yk_images:0
```

Signed URL/credential leak check:

```bash
rg -n 'https?://|x-signature|x-expires|byteimg|ibyteimg|signed|token|cookie|sid=' \
  data/jimeng-lab/proof-20260610-capcut-collections/normalized \
  data/jimeng-lab/proof-20260610-capcut-collection-templates/normalized \
  data/jimeng-lab/proof-20260610-capcut-template-detail/normalized
```

Expected result: no matches.

## CapCut Public Template Metadata Smoke

`jimeng-browser-proxy capcut-template-metadata` fetches public static CapCut template ratio and scene metadata discovered in the Jimeng/Dreamina frontend bundle. This is a no-generation, no-spend probe and does not require a browser session.

Dry run:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-template-metadata \
  --outDir data/jimeng-lab/proof-20260610-capcut-template-metadata-dry-run \
  --dryRun
```

Live command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-template-metadata \
  --outDir data/jimeng-lab/proof-20260610-capcut-template-metadata
```

Expected artifact layout:

```txt
raw=data/jimeng-lab/proof-20260610-capcut-template-metadata/raw/capcut-template-metadata-20260609231824.json
summary=data/jimeng-lab/proof-20260610-capcut-template-metadata/normalized/capcut-template-metadata-20260609231824-summary.json
```

Current proof facts:

```txt
ratio_count=6
scene_count=33
ratios_response_text_sha256=18b2d8e274f0a129fdbec437f5c9b28a2cfad89dd94807d63efb4325ed5ace41
scenes_response_text_sha256=aa409da2647ee22a9025d17835055ffd34450b1c07783ea54a1909fa367e286d
first_scenes=Instagram post:1080x1080 | Instagram story:1080x1920 | Instagram portrait:1080x1350 | Tiktok:1080x1920 | YouTube thumbnail:1280x720 | YouTube intro:1920x1080 | YouTube end screen:1920x1080 | Facebook post:940x788
```

Token/signed URL marker check:

```bash
rg -n 'X-Amz|x-signature|x-expires|sessionid|sid_guard|msToken' \
  data/jimeng-lab/proof-20260610-capcut-template-metadata \
  data/jimeng-lab/proof-20260610-capcut-template-metadata-dry-run
```

Expected result: no matches.

## CapCut Signed Endpoint Probe Smoke

`jimeng-browser-proxy capcut-probe` signs explicit read-oriented CapCut/LV replay variants with the recovered CapCut frontend signer. It is session-free, no-spend, and intended for quickly testing search/batch/preset/editor payload hypotheses before promoting a stable CLI command. The command rejects known mutating paths such as preset deletion, and routes `/lv/v2/cc_web_task/*` probes to the CapCut feed API host.

Commands:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/cc_web/replicate/get_search_words \
  --body '{}' \
  --outDir data/jimeng-lab/proof-20260610-capcut-probe-hot-words

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/cc_web/plane/fuzzy_search_templates \
  --variants '{"variants":[{"name":"keyword-en","body":{"sdk_version":"16.1.0","keyword":"makeup"}},{"name":"keyword-zh","body":{"sdk_version":"16.1.0","keyword":"美妆"}},{"name":"title-en","body":{"sdk_version":"16.1.0","title":"makeup"}}]}' \
  --outDir data/jimeng-lab/proof-20260610-capcut-probe-fuzzy

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/cc_web/plane/get_collection_templates \
  --variants '{"variants":[{"name":"category_id","body":{"sdk_version":"16.1.0","enter_from":"feed","count":20,"lang":"en","category_id":0}},{"name":"collection_id","body":{"sdk_version":"16.1.0","enter_from":"feed","count":20,"lang":"en","collection_id":0}},{"name":"category_ids","body":{"sdk_version":"16.1.0","enter_from":"feed","count":20,"lang":"en","category_ids":[0]}}]}' \
  --outDir data/jimeng-lab/proof-20260610-capcut-probe-collection

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/cc_web/replicate/search_templates \
  --variants '{"variants":[{"name":"keyword","body":{"sdk_version":"16.1.0","enter_from":"feed","count":20,"lang":"en","keyword":"makeup"}},{"name":"search_word","body":{"sdk_version":"16.1.0","enter_from":"feed","count":20,"lang":"en","search_word":"makeup"}},{"name":"query","body":{"sdk_version":"16.1.0","enter_from":"feed","count":20,"lang":"en","query":"makeup"}}]}' \
  --outDir data/jimeng-lab/proof-20260610-capcut-probe-search
```

Results:

```txt
hot_words: body -> ret=0 errmsg=success response_sha=b442e8144ac7..., but data only contained region metadata
fuzzy_search_templates: keyword-en -> ret=0 errmsg=success response_sha=f70060efdcf4...
fuzzy_search_templates: keyword-zh -> ret=0 errmsg=success response_sha=9770f85cc99b...
fuzzy_search_templates: title-en -> ret=0 errmsg=success response_sha=5075ed973ff4...
get_collection_templates: old category_id -> ret=1000 errmsg="param error" response_sha=71cf86d7c28c...
get_collection_templates: old collection_id -> ret=1000 errmsg="param error" response_sha=c975fd67d155...
get_collection_templates: old category_ids -> ret=1000 errmsg="param error" response_sha=7e45dad2b470...
get_collection_templates_superseded_by=confirmed id:<collectionId> body in capcut-collection-templates
search_templates: keyword -> ret=1000 errmsg="param error" response_sha=147d1c355511...
search_templates: search_word -> ret=1000 errmsg="param error" response_sha=b53c75bc5959...
search_templates: query -> ret=1000 errmsg="param error" response_sha=1f36fc8015f7...
```

Blocked search/batch/preset refresh:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/cc_web/plane/batch_get_collection_templates \
  --variants '<id/ids/category_ids/array variants>' \
  --outDir data/jimeng-lab/proof-20260610-capcut-probe-batch-collection-templates

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/cc_web/plane/batch_get_collection_templates \
  --variants '<collection_ids/id_list/category_list/nested collection variants>' \
  --outDir data/jimeng-lab/proof-20260610-capcut-probe-batch-collection-templates-v2

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/cc_web/plane/get_collection_presets \
  --variants '<confirmed collection id/category id/list variants>' \
  --outDir data/jimeng-lab/proof-20260610-capcut-probe-presets-confirmed-collection

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/cc_web/replicate/search_templates \
  --variants '<keyword/query/search_word/category/scene/cursor variants>' \
  --outDir data/jimeng-lab/proof-20260610-capcut-probe-search-templates-v2
```

```txt
batch_get_collection_templates v1: 5 variants, all ret=1000, errmsg=param error
batch_get_collection_templates v2: 10 variants, all ret=1000, errmsg=param error
get_collection_presets: 8 confirmed-collection variants, all ret=1015, errmsg=check login error
search_templates v2: 10 variants, all ret=1000, errmsg=param error
classification=blocked until exact non-empty UI calls are captured for search, batch rows, collection presets, and preset detail
```

Additional no-spend classification probes:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts endpoint-probe \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoint /mweb/v1/get_history \
  --variants '<plain/frontend-derived/workspace-scoped variants>' \
  --outDir data/jimeng-lab/proof-20260610-history-list-probe

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/cc_web/replicate/get_search_words \
  --variants '<empty/sdk/locale/scene/category variants>' \
  --outDir data/jimeng-lab/proof-20260610-capcut-search-words-probe
```

```txt
get_history: all tested variants -> ret=0 errmsg=success records_list=0 has_more=false next_offset=0
get_search_words: empty/sdk/locale/scene/category variants -> ret=0 errmsg=success data={"region":"AU"}
classification=blocked until a non-empty UI capture proves useful payloads
```

Normalized proof files:

```txt
data/jimeng-lab/proof-20260610-capcut-probe-hot-words/normalized/capcut-probe-20260610044826-summary.json
data/jimeng-lab/proof-20260610-capcut-probe-fuzzy/normalized/capcut-probe-20260610044826-summary.json
data/jimeng-lab/proof-20260610-capcut-probe-collection/normalized/capcut-probe-20260610044826-summary.json
data/jimeng-lab/proof-20260610-capcut-probe-search/normalized/capcut-probe-20260610044826-summary.json
data/jimeng-lab/proof-20260610-capcut-probe-batch-collection-templates/normalized/capcut-probe-20260610072411-summary.json
data/jimeng-lab/proof-20260610-capcut-probe-batch-collection-templates-v2/normalized/capcut-probe-20260610072524-summary.json
data/jimeng-lab/proof-20260610-capcut-probe-presets-confirmed-collection/normalized/capcut-probe-20260610072539-summary.json
data/jimeng-lab/proof-20260610-capcut-probe-search-templates-v2/normalized/capcut-probe-20260610072556-summary.json
data/jimeng-lab/proof-20260610-history-list-probe/normalized/endpoint-probe-20260610055200-summary.json
data/jimeng-lab/proof-20260610-capcut-search-words-probe/normalized/capcut-probe-20260610055357-summary.json
```

Leak check:

```bash
rg -n 'X-Amz|x-signature|x-expires|cookie|session|authorization|msToken|verifyFp' \
  data/jimeng-lab/proof-20260610-capcut-probe-*/normalized
```

Result:

```txt
normalized capcut-probe proofs have no signed URLs or credentials
```

## Static Inventory Proof

Offline command, no browser session and no network replay:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts static-inventory \
  --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \
  --outDir data/jimeng-lab/proof-20260610-static-inventory
```

Result:

```txt
resources=247
included=200
skipped_implemented=29
high_value_gaps=61
known_status_counts=unknown:200,partial:4,implemented:29,dry_run_only:4,blocked:7,captured_only:2,cataloged_only:1
blocked_capcut_search_batch_preset:
  /lv/v1/cc_web/plane/batch_get_collection_templates -> capture_exact_payload
  /lv/v1/cc_web/plane/fuzzy_search_templates -> capture_exact_payload
  /lv/v1/cc_web/plane/get_collection_presets -> capture_exact_payload
  /lv/v1/cc_web/plane/preset_template_detail -> capture_exact_payload
  /lv/v1/cc_web/replicate/search_templates -> capture_exact_payload
```

After classifying video-generation helper endpoints:

```txt
resources=247
included=200
skipped_implemented=29
high_value_gaps=61
known_status_counts=unknown:193,partial:4,implemented:29,dry_run_only:4,blocked:14,captured_only:2,cataloged_only:1
blocked_video_generate_helpers:
  /mweb/v1/video_generate/get_switch_model_queue_info -> capture_exact_payload
  /mweb/v1/video_generate/pre_process -> capture_exact_payload
  /mweb/v1/video_generate/mget_pre_process_result -> capture_exact_payload
  /mweb/v1/video_generate/face_auth/skip -> capture_exact_payload
  /mweb/v1/video_generate/face_auth/skip/query -> capture_exact_payload
  /mweb/v1/aigc_draft/cancel_generate -> capture_exact_payload
  /mweb/v1/aigc_draft/generate_accelerate -> capture_exact_payload
```

After classifying LV editor image helper endpoints:

```txt
resources=247
included=200
skipped_implemented=29
high_value_gaps=61
known_status_counts=unknown:183,partial:4,implemented:29,dry_run_only:4,blocked:24,captured_only:2,cataloged_only:1
blocked_lv_editor_image_helpers:
  /lv/v1/editor/image/ai_model/submit_task -> capture_exact_payload
  /lv/v1/editor/image/ai_model/batch_get_results -> capture_exact_payload
  /lv/v1/editor/image/ai_model/materials -> capture_exact_payload
  /lv/v1/editor/image/ai_model/create_cloth_mask -> capture_exact_payload
  /lv/v1/editor/image/batch_get_url -> capture_exact_payload
  /lv/v1/editor/image/embed_resource -> capture_exact_payload
  /lv/v1/editor/image/gen_background -> capture_exact_payload
  /lv/v1/editor/image/interactive_matting -> capture_exact_payload
  /lv/v1/editor/image/saliency_seg -> capture_exact_payload
  /api/biz/v1/image/entity_seg -> capture_exact_payload
```

After classifying LV workspace/asset read endpoints:

```txt
resources=247
included=200
skipped_implemented=29
high_value_gaps=61
known_status_counts=unknown:179,partial:4,implemented:29,dry_run_only:4,blocked:28,captured_only:2,cataloged_only:1
blocked_lv_asset_reads:
  /lv/v1/asset/list -> capture_exact_payload
  /lv/v1/asset/query -> capture_exact_payload
  /lv/v1/asset/detail -> capture_exact_payload
  /lv/v1/asset/query_process -> capture_exact_payload
blocked_supporting_context_not_counted_by_static_inventory:
  /cc/v1/workspace/get_user_workspaces -> capture_exact_payload
```

After classifying LV editor/template read endpoints:

```txt
resources=247
included=200
skipped_implemented=29
high_value_gaps=61
known_status_counts=unknown:173,partial:4,implemented:29,dry_run_only:4,blocked:34,captured_only:2,cataloged_only:1
blocked_lv_editor_template_reads:
  /lv/v1/cc_web/plane/del_presets_template -> capture_exact_payload
  /lv/v1/editor/template/recent_list -> capture_exact_payload
  /lv/v1/editor/template/check_post_permission -> capture_exact_payload
  /lv/v1/editor/draft/get_template_file -> capture_exact_payload
  /lv/v1/editor/plane/intelligence/query_recommend_template -> capture_exact_payload
  /lv/v2/cc_web_task/get_task_draft -> capture_exact_payload
```

After classifying LV asset/template/history mutation endpoints:

```txt
resources=247
included=200
skipped_implemented=29
high_value_gaps=61
known_status_counts=unknown:159,partial:4,implemented:29,dry_run_only:4,blocked:48,captured_only:2,cataloged_only:1
blocked_mutations_no_replay:
  /lv/v1/asset/copy -> disposable_fixture_or_approval
  /lv/v1/asset/create -> disposable_fixture_or_approval
  /lv/v1/asset/create_cloud_asset -> disposable_fixture_or_approval
  /lv/v1/asset/delete -> disposable_fixture_or_approval
  /lv/v1/asset/label_as_exported -> disposable_fixture_or_approval
  /lv/v1/asset/prepare_upload_cloud -> disposable_fixture_or_approval
  /lv/v1/asset/rename -> disposable_fixture_or_approval
  /lv/v1/editor/template/add -> disposable_fixture_or_approval
  /lv/v1/editor/template/add_async -> disposable_fixture_or_approval
  /lv/v1/editor/template/add_query -> capture_matching_async_flow
  /lv/v1/ever_photo/batch_sync_asset -> disposable_fixture_or_approval
  /lv/v1/ever_photo/promote_asset -> disposable_fixture_or_approval
  /mweb/v1/remove_history -> disposable_fixture_or_approval
  /mweb/v1/update_video_default_bgm -> disposable_fixture_or_approval
```

After adding LV editor font/effect/color catalog CLI support:

```txt
resources=247
included=200
skipped_implemented=33
high_value_gaps=61
known_status_counts=unknown:155,partial:4,implemented:33,dry_run_only:4,blocked:48,captured_only:2,cataloged_only:1
implemented_lv_editor_catalog:
  /lv/v1/effect/get_panel_info -> capcut-editor-catalog panel categories/effects
  /lv/v1/effect/get_category_effects -> capcut-editor-catalog category effect rows
  /lv/v1/effect/get_all_fonts -> capcut-editor-catalog all font rows
  /lv/v1/editor/plane/color/feed -> capcut-editor-catalog color palettes
```

After classifying additional LV read-state endpoints:

```txt
resources=247
included=200
skipped_implemented=33
high_value_gaps=61
known_status_counts=unknown:146,partial:4,implemented:33,dry_run_only:4,blocked:57,captured_only:2,cataloged_only:1
blocked_lv_read_state:
  /lv/v1/editor/effect/recent_list -> capture_exact_payload
  /lv/v2/editor/effect/recent_list -> capture_exact_payload
  /lv/v1/editor/plane/common/recent_list -> capture_exact_payload
  /lv/v1/editor/plane_draft/get_content_map -> capture_exact_payload
  /lv/v1/editor/plane_draft/get_draft_detail -> capture_exact_payload
  /lv/v1/ever_photo/batch_get_sync_state -> capture_exact_payload
  /lv/v1/ever_photo/get_user_space -> capture_exact_payload
  /lv/v1/intelligence/preset_resource_list -> capture_exact_payload
  /lv/v2/task/multi_get_tasks -> capture_exact_payload
```

Normalized proof:

```txt
data/jimeng-lab/proof-20260610-static-inventory/normalized/static-inventory-20260610094928-summary.json
data/jimeng-lab/proof-20260610-static-inventory/normalized/static-inventory-20260610094928-summary.md
```

Video helper proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts static-locate \
  --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \
  --endpoint /mweb/v1/video_generate/get_switch_model_queue_info,/mweb/v1/video_generate/mget_pre_process_result,/mweb/v1/video_generate/pre_process,/mweb/v1/video_generate/face_auth/skip,/mweb/v1/video_generate/face_auth/skip/query \
  --outDir data/jimeng-lab/proof-20260610-static-locate-video-generate-helpers

bun packages/jimeng-client/src/browser-proxy-cli.ts endpoint-probe \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoint /mweb/v1/video_generate/get_switch_model_queue_info \
  --variants '[{"name":"empty","body":{}},{"name":"current-fast-model","body":{"model_req_key":"dreamina_ic_generate_video_model_vgfm_3.0_fast"}},{"name":"current-fast-model-snake-list","body":{"model_req_keys":["dreamina_ic_generate_video_model_vgfm_3.0_fast"]}},{"name":"video-scene","body":{"scene":"text_to_video","model_req_key":"dreamina_ic_generate_video_model_vgfm_3.0_fast"}}]' \
  --outDir data/jimeng-lab/proof-20260610-switch-model-queue-probe
```

```txt
static-locate-video-generate-helpers: 5 endpoints, 6 occurrences, no credential markers in normalized output
switch-model-queue-probe: 4 variants, all ret=1000, errmsg=invalid parameter
```

LV editor image helper proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts static-locate \
  --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \
  --endpoint /lv/v1/editor/image/ai_model/submit_task,/lv/v1/editor/image/ai_model/batch_get_results,/lv/v1/editor/image/batch_get_url,/lv/v1/editor/image/ai_model/materials,/lv/v1/editor/image/embed_resource,/lv/v1/editor/image/gen_background,/lv/v1/editor/image/interactive_matting,/lv/v1/editor/image/saliency_seg,/lv/v1/editor/image/ai_model/create_cloth_mask \
  --outDir data/jimeng-lab/proof-20260610-static-locate-lv-editor-image-helpers

bun packages/jimeng-client/src/browser-proxy-cli.ts static-locate \
  --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \
  --endpoint /api/biz/v1/image/entity_seg \
  --outDir data/jimeng-lab/proof-20260610-static-locate-lv-editor-image-entity-seg
```

```txt
static-locate-lv-editor-image-helpers: 9 endpoints, 9 occurrences, no credential markers in normalized output
static-locate-lv-editor-image-entity-seg: 1 endpoint, 1 occurrence, no credential markers in normalized output
```

LV workspace/asset read proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts static-locate \
  --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \
  --endpoint /lv/v1/asset/list,/lv/v1/asset/detail,/lv/v1/asset/query,/lv/v1/asset/query_process \
  --outDir data/jimeng-lab/proof-20260610-static-locate-lv-asset-read

bun packages/jimeng-client/src/browser-proxy-cli.ts static-locate \
  --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \
  --endpoint /cc/v1/workspace/get_user_workspaces \
  --outDir data/jimeng-lab/proof-20260610-static-locate-lv-workspace-list

bun packages/jimeng-client/src/browser-proxy-cli.ts endpoint-probe \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoint /lv/v1/asset/query \
  --variants '[{"name":"workspace-basic","body":{"count":5,"asset_types":[1,2,3,4,5,6,7,8,9,10,12],"parent_id":"0","is_cross_folder":true,"order_by":0,"order":1,"offset":0,"workspace_id":14199856180236}},{"name":"workspace-no-parent","body":{"count":5,"asset_types":[1,2,5,6,7,8,9,10,12],"is_cross_folder":true,"order_by":0,"order":1,"offset":0,"workspace_id":14199856180236}},{"name":"workspace-minimal","body":{"count":5,"offset":0,"workspace_id":14199856180236}}]' \
  --outDir data/jimeng-lab/proof-20260610-lv-asset-query-probe

bun packages/jimeng-client/src/browser-proxy-cli.ts endpoint-probe \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoint /cc/v1/workspace/get_user_workspaces \
  --query 'lite_aid=513695' \
  --variants '[{"name":"count-only-lite","body":{"count":100}},{"name":"cursor-convert-lite","body":{"count":100,"cursor":"0","need_convert_workspace":true}}]' \
  --outDir data/jimeng-lab/proof-20260610-lv-workspace-list-lite-aid-probe
```

```txt
static-locate-lv-asset-read: 4 endpoints, 5 occurrences, no credential markers in normalized output
static-locate-lv-workspace-list: 1 endpoint, 1 occurrence, no credential markers in normalized output
lv-asset-query-probe: 3 variants, all ret=1014, errmsg=system busy
lv-asset-query-aid-probe: 1 variant, ret=1014, errmsg=system busy
lv-workspace-list-probe: 3 variants, all ret=1014, errmsg=system busy
lv-workspace-list-lite-aid-probe: 2 variants, all ret=1014, errmsg=system busy
```

LV editor/template read proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts static-locate \
  --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \
  --endpoint /lv/v1/editor/draft/get_template_file,/lv/v1/editor/plane/intelligence/query_recommend_template,/lv/v1/editor/template/check_post_permission,/lv/v1/editor/template/recent_list,/lv/v2/cc_web_task/get_task_draft \
  --outDir data/jimeng-lab/proof-20260610-static-locate-lv-editor-template-reads

bun packages/jimeng-client/src/browser-proxy-cli.ts static-locate \
  --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \
  --endpoint /lv/v1/cc_web/plane/del_presets_template \
  --outDir data/jimeng-lab/proof-20260610-static-locate-lv-preset-delete

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/editor/template/recent_list \
  --variants '[{"name":"recent-count-lang","body":{"count":5,"lang":"en"}},{"name":"recent-cursor","body":{"count":5,"lang":"en","cursor":0}}]' \
  --outDir data/jimeng-lab/proof-20260610-lv-editor-template-recent-probe

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/editor/template/check_post_permission \
  --variants '[{"name":"empty","body":{}}]' \
  --outDir data/jimeng-lab/proof-20260610-lv-template-permission-probe

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/editor/draft/get_template_file \
  --variants '[{"name":"empty-uris","body":{"uris":[]}}]' \
  --outDir data/jimeng-lab/proof-20260610-lv-template-file-probe

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/editor/plane/intelligence/query_recommend_template \
  --variants '[{"name":"no-assets-916","body":{"asset_type":"image","input_text":"protein bar UGC ad","assets":[],"workspace_id":"","lang":"en","region":"us","aspect_ratio":["9:16"]}}]' \
  --outDir data/jimeng-lab/proof-20260610-lv-query-recommend-template-probe

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v2/cc_web_task/get_task_draft \
  --variants '[{"name":"empty-task","body":{"task_id":"","app_id":348188}},{"name":"zero-task","body":{"task_id":"0","app_id":348188}}]' \
  --outDir data/jimeng-lab/proof-20260610-lv-task-draft-probe
```

```txt
static-locate-lv-editor-template-reads: 5 endpoints, 5 occurrences, no credential markers in normalized output
static-locate-lv-preset-delete: 1 endpoint, 1 occurrence, no credential markers in normalized output
lv-editor-template-recent-probe: 2 variants, all ret=1015, errmsg=check login error
lv-template-permission-probe: 1 variant, ret=1015, errmsg=check login error
lv-template-file-probe: 1 variant, ret=1016, errmsg=ERR_PARAM
lv-query-recommend-template-probe: 1 variant, ret=-3, errmsg=bad request
lv-task-draft-probe: 2 variants, all ret=1015, errmsg=check login error
```

LV mutation blocker proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts static-locate \
  --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \
  --endpoint /lv/v1/asset/copy,/lv/v1/asset/create,/lv/v1/asset/create_cloud_asset,/lv/v1/asset/delete,/lv/v1/asset/label_as_exported,/lv/v1/asset/prepare_upload_cloud,/lv/v1/asset/rename,/lv/v1/editor/template/add,/lv/v1/editor/template/add_async,/lv/v1/editor/template/add_query,/lv/v1/ever_photo/batch_sync_asset,/lv/v1/ever_photo/promote_asset,/mweb/v1/remove_history,/mweb/v1/update_video_default_bgm \
  --outDir data/jimeng-lab/proof-20260610-static-locate-lv-mutation-blockers
```

```txt
static-locate-lv-mutation-blockers: 14 endpoints, 20 occurrences, no credential markers in normalized output
mutation replay: skipped intentionally because these endpoints create, delete, rename, publish, sync, promote, remove, or otherwise mutate account/workspace state
```

LV editor catalog proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts static-locate \
  --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \
  --endpoint /lv/v1/effect/get_panel_info,/lv/v1/effect/get_category_effects,/lv/v1/effect/get_all_fonts,/lv/v1/editor/plane/color/feed \
  --outDir data/jimeng-lab/proof-20260610-static-locate-lv-editor-catalog-reads

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-editor-catalog \
  --endpoints all \
  --panel fonts \
  --category all \
  --limit 20 \
  --offset 0 \
  --outDir data/jimeng-lab/proof-20260610-lv-editor-catalog-cli
```

```txt
static-locate-lv-editor-catalog-reads: 12 endpoints, 18 occurrences, no credential markers in normalized output
capcut-editor-catalog saved endpoints=panel,effects,fonts,colors categories=14 effects=745 palettes=20
summary=data/jimeng-lab/proof-20260610-lv-editor-catalog-cli/normalized/capcut-editor-catalog-20260610093259-summary.json
```

LV read-state blocker proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts static-locate \
  --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \
  --endpoint /lv/v1/editor/effect/recent_list,/lv/v2/editor/effect/recent_list,/lv/v1/editor/plane/common/recent_list,/lv/v1/editor/plane_draft/get_content_map,/lv/v1/editor/plane_draft/get_draft_detail,/lv/v1/ever_photo/batch_get_sync_state,/lv/v1/ever_photo/get_user_space,/lv/v1/intelligence/preset_resource_list,/lv/v2/task/multi_get_tasks \
  --outDir data/jimeng-lab/proof-20260610-static-locate-lv-read-state

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/editor/plane/common/recent_list \
  --variants '[{"name":"empty","body":{}},{"name":"image-editor","body":{"enter_from":"image_editor","limit":20,"offset":0}},{"name":"with-type","body":{"type":"template","limit":20,"offset":0}}]' \
  --outDir data/jimeng-lab/proof-20260610-lv-plane-common-recent-probe
```

```txt
static-locate-lv-read-state: 9 endpoints, 18 occurrences, no credential markers in normalized output
lv-editor-effect-recent-probe: ret=1015 check login error across empty/fonts/effects variants
lv-v2-editor-effect-recent-probe: ret=1015 check login error across empty/fonts/effects variants
lv-plane-common-recent-probe: ret=0 SUCCESS but item_list=[] across empty/image-editor/type variants
lv-plane-draft-content-map-probe: ret=1016 ERR_PARAM across empty/empty-ids/zero-id variants
lv-plane-draft-detail-probe: ret=1015 check login error across empty/empty-id/zero-id variants
lv-ever-photo-sync-state-probe: ret=1015 check login error across empty/empty-ids/empty-uris variants
lv-ever-photo-user-space-probe: ret=1015 check login error across empty/count/app-id variants
lv-preset-resource-list-probe: ret=-1 system busy across empty/image-editor/query variants
lv-multi-get-tasks-probe: ret=1015 check login error across empty/empty-task-ids/zero-task-id variants
```

Leak check:

```bash
rg -n -P 'x-signature|authorization|cookie|sessionid|sid=|msToken|verifyFp|X-Kagi|x-expires' \
  data/jimeng-lab/proof-20260610-lv-editor-catalog-cli/normalized \
  data/jimeng-lab/proof-20260610-static-inventory/normalized/static-inventory-20260610094928-summary.json \
  data/jimeng-lab/proof-20260610-static-locate-lv-editor-catalog-reads/normalized \
  data/jimeng-lab/proof-20260610-static-locate-lv-read-state/normalized \
  data/jimeng-lab/proof-20260610-lv-{editor-effect-recent,v2-editor-effect-recent,plane-common-recent,plane-draft-content-map,plane-draft-detail,ever-photo-sync-state,ever-photo-user-space,preset-resource-list,multi-get-tasks}-probe/normalized
```

Result:

```txt
normalized LV editor catalog and static-inventory proofs have no credential markers
```

## Read-Only Rate Probe Smoke

This proof measures a no-spend/read-only config endpoint. It does not authorize or establish a safe paid-generation concurrency limit.

Command pattern:

```bash
for c in 1 3 6; do
  bun packages/jimeng-client/src/browser-proxy-cli.ts rate-probe \
    --session data/jimeng-lab/raw/session-bundle-current.json \
    --endpoint /mweb/v1/get_common_config \
    --body '{"is_client_filter":true,"need_beta_model":true,"need_cache":true,"need_refresh":false}' \
    --requests 12 \
    --concurrency "$c" \
    --outDir "data/jimeng-lab/proof-20260610-rate-probe-common-config-c$c"
done

for c in 10 16; do
  bun packages/jimeng-client/src/browser-proxy-cli.ts rate-probe \
    --session data/jimeng-lab/raw/session-bundle-current.json \
    --endpoint /mweb/v1/get_common_config \
    --body '{"is_client_filter":true,"need_beta_model":true,"need_cache":true,"need_refresh":false}' \
    --requests 24 \
    --concurrency "$c" \
    --outDir "data/jimeng-lab/proof-20260610-rate-probe-common-config-c$c"
done

bun packages/jimeng-client/src/browser-proxy-cli.ts rate-probe \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoint /mweb/v1/get_common_config \
  --body '{"is_client_filter":true,"need_beta_model":true,"need_cache":true,"need_refresh":false}' \
  --requests 64 \
  --concurrency 32 \
  --outDir data/jimeng-lab/proof-20260610-rate-probe-common-config-c32

bun packages/jimeng-client/src/browser-proxy-cli.ts rate-probe \
  --endpoint /mweb/v1/get_common_config \
  --method POST \
  --body '{}' \
  --requests 512 \
  --concurrency 256 \
  --outDir data/jimeng-lab/proof-20260610-rate-probe-common-config-c256

for c in 512 768 1024; do
  bun packages/jimeng-client/src/browser-proxy-cli.ts rate-probe \
    --session data/jimeng-lab/raw/session-bundle-current.json \
    --endpoint /mweb/v1/get_common_config \
    --method POST \
    --body '{}' \
    --requests "$c" \
    --concurrency "$c" \
    --outDir "data/jimeng-lab/proof-20260610-rate-probe-common-config-c$c"
done

bun packages/jimeng-client/src/browser-proxy-cli.ts rate-probe \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoint /mweb/v1/get_common_config \
  --body '{"isClientFilter":true,"needBetaModel":true}' \
  --requests 1536 \
  --concurrency 1536 \
  --outDir data/jimeng-lab/proof-20260610-rate-probe-common-config-c1536
```

The `2048` tier used a one-off Node `https.request` IP/SNI transport because the local macOS resolver temporarily returned no DNS configuration for terminal processes. It kept `servername` and `Host` as `jimeng.jianying.com`, wrote hashes/status/latency only, and saved proof under:

```txt
data/jimeng-lab/proof-20260610-rate-probe-common-config-c2048-ip-sni/
```

Measured summaries:

```txt
concurrency=1  requests=12  completed=12  stopped=false  elapsed=10009ms  p50=639ms  p95=2147ms  http=200x12  ret=0x12
concurrency=3  requests=12  completed=12  stopped=false  elapsed=3685ms   p50=875ms  p95=1160ms  http=200x12  ret=0x12
concurrency=6  requests=12  completed=12  stopped=false  elapsed=1418ms   p50=406ms  p95=943ms   http=200x12  ret=0x12
concurrency=10 requests=24  completed=24  stopped=false  elapsed=1277ms   p50=289ms  p95=757ms   http=200x24  ret=0x24
concurrency=16 requests=24  completed=24  stopped=false  elapsed=653ms    p50=352ms  p95=395ms   http=200x24  ret=0x24
concurrency=32 requests=64  completed=64  stopped=false  elapsed=720ms    p50=304ms  p95=414ms   http=200x64  ret=0x64
concurrency=64 requests=128 completed=128 stopped=false elapsed=800ms    p50=337ms  p95=458ms   http=200x128 ret=0x128
concurrency=96 requests=192 completed=192 stopped=false elapsed=953ms    p50=414ms  p95=523ms   http=200x192 ret=0x192
concurrency=128 requests=256 completed=256 stopped=false elapsed=983ms   p50=369ms  p95=625ms   http=200x256 ret=0x256
concurrency=192 requests=384 completed=384 stopped=false elapsed=1260ms  p50=362ms  p95=966ms   http=200x384 ret=0x384
concurrency=256 requests=512 completed=512 stopped=false elapsed=1626ms  p50=388ms  p95=1406ms  http=200x512 ret=0x512
concurrency=512 requests=512 completed=512 stopped=false elapsed=1465ms  p50=916ms  p95=1441ms  max=1463ms  http=200x512  ret=0x512
concurrency=768 requests=768 completed=768 stopped=false elapsed=2447ms  p50=1157ms p95=1835ms  max=2446ms  http=200x768  ret=0x768
concurrency=1024 requests=1024 completed=1024 stopped=false elapsed=5837ms p50=1942ms p95=2893ms max=5831ms http=200x1024 ret=0x1024
concurrency=1536 requests=1536 completed=1536 stopped=false elapsed=5318ms p50=2602ms p95=3809ms max=5306ms http=200x1536 ret=0x1536
concurrency=2048 requests=2048 completed=2048 stopped=false elapsed=28165ms p50=10283ms p95=15822ms max=28013ms http=200x2048 ret=0x2048
concurrency=3072 requests=3072 completed=3072 stopped=false elapsed=36287ms p50=10828ms p95=18176ms max=36240ms http=200x3071,none x1 ret=0x3071,none x1 error=ECONNRESETx1
```

Result:

```txt
No Jimeng-side rate/auth/risk stop was observed for /mweb/v1/get_common_config through concurrency 3072.
The iptag/jimeng-api reference does not publish a hard rate limit; it supports comma-separated bearer tokens and randomly samples tokens per request, plus long polling/retry behavior, and does not enforce a local image/video generation concurrency cap.
Tail latency degraded materially at concurrency 1024, 1536, 2048, and 3072; the 3072 tier also produced one local/network transport reset before any Jimeng `429`, auth, or `1019`/shark signal. This is a read-config endpoint ceiling observation, not a recommended generation-submit setting.
```

Leak check:

```bash
rg -n -P 'x-signature|authorization|cookie|sessionid|sid=|msToken|verifyFp|X-Kagi|x-expires|device-time|sign-ver|\bsign\b|tdid' \
  data/jimeng-lab/proof-20260610-rate-probe-common-config-c{1,3,6,10,16,32,64,96,128,192,256,512,768,1024,1536}/normalized \
  data/jimeng-lab/proof-20260610-rate-probe-common-config-c2048-ip-sni/normalized \
  data/jimeng-lab/proof-20260610-rate-probe-common-config-c3072-ip-sni/normalized
```

Expected result: no matches.

## Risk-Control Breaker Smoke

No-spend unit proof for local `1019` / `shark not pass` cooldown behavior:

```bash
mkdir -p data/jimeng-lab/proof-20260610-risk-control-breaker
bun test packages/jimeng-client/test/client.test.ts \
  | tee data/jimeng-lab/proof-20260610-risk-control-breaker/client-test.log
```

Result:

```txt
8 tests passed, including:
- requestText opens a risk-control cooldown after a shark response
- risk-control breaker respects configurable consecutive hit budget
```

Default behavior: `JimengClient.requestText` opens a 10 minute local cooldown after the first consecutive `ret=1019` / `shark not pass` response. During cooldown, follow-up calls fail locally as `RISK_CONTROL_COOLDOWN_ACTIVE` and do not call Jimeng again.

## Paid-Live Generation Smoke

Arthur explicitly approved a small paid/subscription-account smoke on 2026-06-10. This proof distinguishes **paid-live generation** from read-only/config/upload live API calls.

Session refresh:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts session \
  --session-out data/jimeng-lab/raw/session-bundle-current.json
```

TTS command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts tts \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --voice-id 7597003459665072686 \
  --voice-title '直爽女大' \
  --text '三秒告诉你，为什么这款补水精华适合熬夜后的底妆。质地轻薄，不搓泥，早八也能快速出门。' \
  --outDir data/jimeng-lab/proof-20260610-paid-generation-smoke/tts
```

Text-to-video command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts text2video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --prompt '韩系美妆达人在干净卧室用手机自拍，前三秒拿起补水精华说今天底妆不服帖就看这个，镜头轻微推进，真实UGC广告感，自然表情，无字幕，无水印，不要生成可读文字。' \
  --durationSec 3 \
  --ratio 9:16 \
  --videoResolution 720p \
  --modelVersion 3.0fast \
  --seed 20260610 \
  --pollIntervalMs 10000 \
  --maxPolls 40 \
  --outDir data/jimeng-lab/proof-20260610-paid-generation-smoke/text2video
```

Image-to-video command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts image2video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --prompt '韩系美妆达人手机自拍风格，拿着补水精华自然转身靠近镜头，像真实TikTok种草开场，动作轻微自然，干净卧室自然光，无字幕，无水印，不要生成可读文字。' \
  --durationSec 3 \
  --ratio 9:16 \
  --videoResolution 720p \
  --modelVersion 3.0fast \
  --seed 20260611 \
  --pollIntervalMs 10000 \
  --maxPolls 40 \
  --outDir data/jimeng-lab/proof-20260610-paid-generation-smoke/image2video
```

Results:

```txt
tts: ret=0, errmsg=success, artifact=data/jimeng-lab/proof-20260610-paid-generation-smoke/tts/artifacts/直爽女大-7597003459665072686.mp3, duration=9.768s, codec=mp3
text2video: submitId=3f1c75b2-897c-4861-8c5c-92e744301e57, historyId=35925875166732, status=50, artifact=data/jimeng-lab/proof-20260610-paid-generation-smoke/text2video/artifacts/3f1c75b2-897c-4861-8c5c-92e744301e57-00.mp4, 704x1248 h264, duration=3.016667s
image2video: submitId=a12f868d-69ca-4886-9be0-29247d81b3a6, historyId=35925049076492, status=50, artifact=data/jimeng-lab/proof-20260610-paid-generation-smoke/image2video/artifacts/a12f868d-69ca-4886-9be0-29247d81b3a6-00.mp4, 704x1248 h264, duration=3.016667s
manifest=data/jimeng-lab/proof-20260610-paid-generation-smoke/manifest.md
```

Current blocked paid-live replay:

```txt
text2image with data/jimeng-captures/20260609095503-text2image-submit/capture-template.raw.json now returns ret=3018, errmsg=permission denied, even after session refresh.
next_action=recapture current frontend text-to-image submit through background CDP before claiming paid-live CLI support for this path.
```

## Subscription-Account Live Generation Refresh

Arthur explicitly approved another small live/subscription-account smoke on 2026-06-10 to confirm the current logged-in account still produces actual media artifacts.

Manifest:

```txt
data/jimeng-lab/proof-20260610-subscription-live-generation-refresh/manifest.md
```

Commands rerun:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts session \
  --session-out data/jimeng-lab/raw/session-bundle-current.json

bun packages/jimeng-client/src/browser-proxy-cli.ts tts \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --voice-id 7597003459665072686 \
  --voice-title "直爽女大" \
  --text "三秒告诉你为什么这个蛋白棒适合下午三点犯困的时候。第一口像甜点，但配料表很干净。" \
  --outDir data/jimeng-lab/proof-20260610-subscription-live-generation-refresh/tts

bun packages/jimeng-client/src/browser-proxy-cli.ts text2video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --prompt "韩系美妆健身UGC创作者在明亮厨房里拿起蛋白棒，真实手机自拍质感，前三秒展示下午犯困痛点，动作自然，画面干净，无字幕，无水印，不要生成可读文字。" \
  --durationSec 3 \
  --ratio 9:16 \
  --videoResolution 720p \
  --modelVersion 3.0fast \
  --seed 2026061001 \
  --outDir data/jimeng-lab/proof-20260610-subscription-live-generation-refresh/text2video \
  --pollIntervalMs 10000 \
  --maxPolls 40

bun packages/jimeng-client/src/browser-proxy-cli.ts image2video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --prompt "韩系美妆达人手机自拍风格，手里拿着蛋白棒自然靠近镜头，像真实TikTok种草开场，动作轻微自然，明亮厨房自然光，无字幕，无水印，不要生成可读文字。" \
  --durationSec 3 \
  --ratio 9:16 \
  --videoResolution 720p \
  --modelVersion 3.0fast \
  --seed 2026061002 \
  --outDir data/jimeng-lab/proof-20260610-subscription-live-generation-refresh/image2video \
  --pollIntervalMs 10000 \
  --maxPolls 40
```

Results:

```txt
tts: ret=0, errmsg=success, artifact=data/jimeng-lab/proof-20260610-subscription-live-generation-refresh/tts/artifacts/直爽女大-7597003459665072686.mp3, mp3 audio, duration=8.616000s
text2video: submitId=0781e145-8ead-45e0-8ba7-5a4feb7ee95d, historyId=35925877254412, status=50, artifact=data/jimeng-lab/proof-20260610-subscription-live-generation-refresh/text2video/artifacts/0781e145-8ead-45e0-8ba7-5a4feb7ee95d-00.mp4, 704x1248 h264, duration=3.016667s
image2video: submitId=87b264f4-4997-4390-a0fe-e5d06948a759, historyId=35924034178572, status=50, artifact=data/jimeng-lab/proof-20260610-subscription-live-generation-refresh/image2video/artifacts/87b264f4-4997-4390-a0fe-e5d06948a759-00.mp4, 704x1248 h264, duration=3.016667s
thumbnails=data/jimeng-lab/proof-20260610-subscription-live-generation-refresh/_validation/{text2video-thumb-1s.jpg,image2video-thumb-1s.jpg}
```

Current blocked paid-live replay:

```txt
text2image with data/jimeng-captures/20260609095503-text2image-submit/capture-template.raw.json still returns ret=3018, errmsg=permission denied.
next_action=recapture current frontend text-to-image submit through background CDP before claiming paid-live CLI support for this path.
```

## Subscription API Live Check

Arthur explicitly approved using the subscription account again on 2026-06-10 to verify that direct API generation still produces actual playable artifacts, not only accepted API responses.

Proof directory:

```txt
data/jimeng-lab/proof-20260610-subscription-api-live-check/
```

Commands:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts session \
  --session-out data/jimeng-lab/raw/session-bundle-current.json

bun packages/jimeng-client/src/browser-proxy-cli.ts tts \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --voice-id 7597003459665072686 \
  --voice-title "直爽女大" \
  --text "这是一次订阅账号直连接口测试。我们正在验证语音、文生视频和图生视频都能真实生成素材。" \
  --outDir data/jimeng-lab/proof-20260610-subscription-api-live-check/tts

bun packages/jimeng-client/src/browser-proxy-cli.ts text2video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --prompt "韩系美妆健身UGC创作者在明亮厨房里用手机自拍，手里拿着一支补水精华，前三秒说熬夜后底妆卡粉就看这个，真实TikTok种草开场，自然表情，轻微手持晃动，无字幕，无水印，不要生成可读文字。" \
  --durationSec 3 \
  --ratio 9:16 \
  --videoResolution 720p \
  --modelVersion 3.0fast \
  --seed 2026061011 \
  --pollIntervalMs 10000 \
  --maxPolls 40 \
  --outDir data/jimeng-lab/proof-20260610-subscription-api-live-check/text2video

bun packages/jimeng-client/src/browser-proxy-cli.ts image2video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --prompt "韩系美妆达人手机自拍风格，手里拿着补水精华自然靠近镜头，像真实TikTok种草广告开场，动作轻微自然，明亮厨房自然光，无字幕，无水印，不要生成可读文字。" \
  --durationSec 3 \
  --ratio 9:16 \
  --videoResolution 720p \
  --modelVersion 3.0fast \
  --seed 2026061012 \
  --pollIntervalMs 10000 \
  --maxPolls 40 \
  --outDir data/jimeng-lab/proof-20260610-subscription-api-live-check/image2video

bun packages/jimeng-client/src/browser-proxy-cli.ts text2image \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-captures/20260609095503-text2image-submit/capture-template.raw.json \
  --prompt "韩系美妆健身UGC创作者，手机自拍，明亮厨房自然光，手持补水精华，真实TikTok种草封面，无文字，无水印。" \
  --outDir data/jimeng-lab/proof-20260610-subscription-api-live-check/text2image \
  --pollIntervalMs 10000 \
  --maxPolls 10
```

Results:

```txt
tts: ret=0, errmsg=success, artifact=data/jimeng-lab/proof-20260610-subscription-api-live-check/tts/artifacts/直爽女大-7597003459665072686.mp3, mp3 audio, duration=8.568000s
text2video: submitId=0a829552-fe6a-4f2f-b8d2-8bd6d4ec6fb2, historyId=35934031025164, status=50, artifact=data/jimeng-lab/proof-20260610-subscription-api-live-check/text2video/artifacts/0a829552-fe6a-4f2f-b8d2-8bd6d4ec6fb2-00.mp4, 704x1248 h264, duration=3.016667s
image2video: submitId=6c83d6bd-d8f6-4b69-a6b9-1d05088312a3, historyId=35931512058892, status=50, artifact=data/jimeng-lab/proof-20260610-subscription-api-live-check/image2video/artifacts/6c83d6bd-d8f6-4b69-a6b9-1d05088312a3-00.mp4, 704x1248 h264, duration=3.016667s
thumbnails=data/jimeng-lab/proof-20260610-subscription-api-live-check/_validation/{text2video-thumb-1s.jpg,image2video-thumb-1s.jpg}
text2image: blocked; stale capture returned ret=3018, errmsg=permission denied
```

Validation:

```bash
ffprobe -v error -show_entries format=duration,format_name:stream=codec_name,codec_type,width,height -of json <artifact>
ffmpeg -y -v error -ss 1 -i <video> -frames:v 1 <thumb.jpg>
rg -n -P '"cookie"\s*:\s*"(?!\[REDACTED)|x-signature|x-expires|authorization|msToken|verifyFp|sessionid|sid=' \
  data/jimeng-lab/proof-20260610-subscription-api-live-check/{tts,text2video,image2video}/normalized \
  data/jimeng-lab/proof-20260610-subscription-api-live-check/_validation || true
```

Result:

```txt
ffprobe confirmed playable MP3/H.264 MP4 artifacts.
thumbnail JPGs were extracted from both generated videos.
strict leak check returned no unredacted credential markers.
```

## Actual Subscription API Generation Check

Arthur asked whether the actual subscription account/API had really been tested, not merely called. A fresh bounded run on 2026-06-10 generated one artifact per implemented paid-live mode.

Manifest:

```txt
data/jimeng-lab/proof-20260610-actual-api-generation-check/manifest.md
```

Commands:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts tts \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --voice-id 7597003459665072686 \
  --voice-title '直爽女大' \
  --text '这是一次真实订阅账号接口测试。我们要确认语音、文生视频、图生视频都能生成可用素材。' \
  --outDir data/jimeng-lab/proof-20260610-actual-api-generation-check/tts

bun packages/jimeng-client/src/browser-proxy-cli.ts text2video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --prompt '韩系美妆UGC创作者在明亮厨房里用手机自拍，手里拿着一瓶补水精华，前三秒说熬夜后底妆卡粉就看这个，真实TikTok种草开场，自然表情，轻微手持晃动，无字幕，无水印，不要生成可读文字。' \
  --durationSec 3 \
  --ratio 9:16 \
  --videoResolution 720p \
  --modelVersion 3.0fast \
  --seed 2026061013 \
  --pollIntervalMs 10000 \
  --maxPolls 40 \
  --outDir data/jimeng-lab/proof-20260610-actual-api-generation-check/text2video

bun packages/jimeng-client/src/browser-proxy-cli.ts image2video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --prompt '韩系美妆达人手机自拍风格，手里拿着补水精华自然靠近镜头，像真实TikTok种草广告开场，动作轻微自然，明亮厨房自然光，无字幕，无水印，不要生成可读文字。' \
  --durationSec 3 \
  --ratio 9:16 \
  --videoResolution 720p \
  --modelVersion 3.0fast \
  --seed 2026061014 \
  --pollIntervalMs 10000 \
  --maxPolls 40 \
  --outDir data/jimeng-lab/proof-20260610-actual-api-generation-check/image2video
```

Results:

```txt
tts: ret=0, errmsg=success, artifact=data/jimeng-lab/proof-20260610-actual-api-generation-check/tts/artifacts/直爽女大-7597003459665072686.mp3, mp3 audio, 24 kHz mono, duration=10.680000s
text2video: submitId=31ab1cf8-1548-46de-8419-b167bb813eb0, historyId=35936274855692, status=50, artifact=data/jimeng-lab/proof-20260610-actual-api-generation-check/text2video/artifacts/31ab1cf8-1548-46de-8419-b167bb813eb0-00.mp4, 704x1248 h264, duration=3.016667s
image2video: submitId=f9774f3b-84ce-4025-82c4-7a529d6e4409, historyId=35933448749068, status=50, artifact=data/jimeng-lab/proof-20260610-actual-api-generation-check/image2video/artifacts/f9774f3b-84ce-4025-82c4-7a529d6e4409-00.mp4, 704x1248 h264, duration=3.016667s
thumbnails=data/jimeng-lab/proof-20260610-actual-api-generation-check/_validation/{text2video-thumb-1s.jpg,image2video-thumb-1s.jpg}
```

Validation:

```bash
ffprobe -v error -show_entries stream=codec_name,width,height -show_entries format=duration -of json \
  data/jimeng-lab/proof-20260610-actual-api-generation-check/text2video/artifacts/31ab1cf8-1548-46de-8419-b167bb813eb0-00.mp4

ffprobe -v error -show_entries stream=codec_name,width,height -show_entries format=duration -of json \
  data/jimeng-lab/proof-20260610-actual-api-generation-check/image2video/artifacts/f9774f3b-84ce-4025-82c4-7a529d6e4409-00.mp4

ffprobe -v error -show_entries stream=codec_name,sample_rate,channels -show_entries format=duration -of json \
  data/jimeng-lab/proof-20260610-actual-api-generation-check/tts/artifacts/直爽女大-7597003459665072686.mp3

rg -n -P '"cookie"\s*:\s*"(?!\[REDACTED)|x-signature|x-expires|authorization|msToken|verifyFp|sessionid|sid=' \
  data/jimeng-lab/proof-20260610-actual-api-generation-check/*/normalized || true
```

Result:

```txt
ffprobe confirmed playable MP3/H.264 MP4 artifacts.
thumbnail JPGs were extracted from both generated videos.
normalized proof leak check returned no unredacted credential markers.
```

## Infinite Canvas Read Metadata

No-spend direct project/detail/ratio/conversation-list reads were promoted into `jimeng-browser-proxy infinite-canvas`.

Static evidence:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts static-locate \
  --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \
  --endpoint /mweb/v1/infinite_canvas/list_project,/mweb/v1/infinite_canvas/project_detail,/mweb/v1/infinite_canvas/v1/get_canvas_custom_ratio,/mweb/v1/infinite_canvas/get_conversation_list \
  --symbol listProject,projectDetail,getCanvasCustomRatio,getConversationList,customRatio,InfiniteCanvas \
  --outDir data/jimeng-lab/proof-20260610-static-locate-infinite-canvas-reads
```

Contract probes:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts endpoint-probe \
  --endpoint /mweb/v1/infinite_canvas/list_project \
  --variants '[{"name":"frontend_list","body":{"cursor":0,"limit":20,"imageInfo":true,"onlyFavorite":false}},{"name":"minimal_page","body":{"cursor":0,"limit":20}},{"name":"empty","body":{}}]' \
  --outDir data/jimeng-lab/proof-20260610-infinite-canvas-list-probe

bun packages/jimeng-client/src/browser-proxy-cli.ts endpoint-probe \
  --endpoint /mweb/v1/infinite_canvas/project_detail \
  --variants '[{"name":"snake_detail_no_resource","body":{"project_id":"8544774599436","option":{"need_draft_resource":false}}}]' \
  --outDir data/jimeng-lab/proof-20260610-infinite-canvas-detail-probe

bun packages/jimeng-client/src/browser-proxy-cli.ts endpoint-probe \
  --endpoint /mweb/v1/infinite_canvas/v1/get_canvas_custom_ratio \
  --variants '[{"name":"snake_user","body":{"user_id":"<creator_user_id_from_list_project>"}}]' \
  --outDir data/jimeng-lab/proof-20260610-infinite-canvas-ratios-probe

bun packages/jimeng-client/src/browser-proxy-cli.ts endpoint-probe \
  --endpoint /mweb/v1/infinite_canvas/get_conversation_list \
  --method POST \
  --variants '[{"name":"project_page","body":{"project_id":"8544774599436","offset":0,"count":20}},{"name":"project_id_only","body":{"project_id":"8544774599436"}}]' \
  --outDir data/jimeng-lab/proof-20260610-infinite-canvas-conversation-list-probe
```

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts infinite-canvas \
  --endpoints all \
  --limit 20 \
  --outDir data/jimeng-lab/proof-20260610-infinite-canvas-conversations-cli
```

Result:

```txt
infinite-canvas saved endpoints=projects,detail,ratios,conversations projects=1 detail=yes ratios=0 conversations=0 skipped=0
project_count=1
detail_mode=1
ratio_count=0
conversation_count=0
project_id=8544774599436
draft_id=8448339004172
draft_meta_version=0.0.1
layer_count=0
reference_count=0
```

Validation:

```bash
rg -n "cookie|sid=|session|msToken|x-signature|sign|authorization|<creator_user_id>|byteimg|tos-cn" \
  data/jimeng-lab/proof-20260610-infinite-canvas-conversations-cli/normalized \
  data/jimeng-lab/proof-20260610-infinite-canvas-conversations-cli-dry-run/normalized || true
```

Result: no matches. Normalized proof hashes creator user ids and stores draft JSON only as a SHA-256/count summary. `fetch_conversation` remains blocked until a non-empty conversation list returns a real `conversation_id`.

## Account Credit Smoke

No-spend signed account credit read:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts account-credit \
  --dryRun \
  --outDir data/jimeng-lab/proof-20260610-account-credit-cli-dry-run

bun packages/jimeng-client/src/browser-proxy-cli.ts account-credit \
  --outDir data/jimeng-lab/proof-20260610-account-credit-cli
```

Result:

```txt
account-credit saved total=3990 gift=0 purchase=0 vip=3990
```

Validation:

```bash
rg -n -P 'x-signature|authorization|cookie|sessionid|sid=|msToken|verifyFp|sign|device-time|tdid' \
  data/jimeng-lab/proof-20260610-account-credit-cli/normalized \
  data/jimeng-lab/proof-20260610-account-credit-cli-dry-run/normalized || true
```

Result: no matches in normalized output. Raw ignored proof contains the provider response body only; request headers/cookies are not persisted.

## Commerce Benefits Smoke

No-spend signed benefit metadata and current user benefit rows:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts commerce-benefits \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoints metadata,user-benefits \
  --outDir data/jimeng-lab/proof-20260610-commerce-benefits-cli
```

Result:

```txt
commerce-benefits saved metadata=12 user_assets=140
resource_ids=common_ai,generate_agent,generate_audio,generate_cast,generate_img,generate_music,generate_video,intergen,lip_sync,queue_speed,remove_watermark,xuelei
pay_modes=LimitFree,Subscribe,UserCredit
```

Supporting static evidence and failed guess:

```txt
data/jimeng-lab/proof-20260610-commerce-static-locate-v2/
data/jimeng-lab/proof-20260610-commerce-catalog-probe/
```

The first camelCase `queryList` probe returned `ret=1000`; the frontend serializer evidence showed the correct wire body is snake_case `query_list`.

Refreshed inventory after promotion:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts static-inventory \
  --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \
  --outDir data/jimeng-lab/proof-20260610-static-inventory-commerce-benefits \
  --limit 80
```

Result:

```txt
resources=247
skipped_implemented=40
known_status_counts=unknown:127,partial:4,implemented:40,dry_run_only:4,blocked:69,captured_only:2,cataloged_only:1
```

Normalized leak check:

```bash
rg -n -P 'authorization|cookie|sessionid|sid=|msToken|verifyFp|device-time|tdid' \
  data/jimeng-lab/proof-20260610-commerce-benefits-cli/normalized || true
```

Result: no matches in normalized output. Raw ignored proof contains provider response bodies, including upstream response `sign` fields, but no request headers or cookies.

## Workspace Context Smoke

No-spend workspace/project metadata reads:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts static-locate \
  --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \
  --endpoint /mweb/v1/workspace/list,/mweb/v1/workspace/get_by_ids \
  --outDir data/jimeng-lab/proof-20260610-static-locate-workspace-context \
  --contextLines 5

bun packages/jimeng-client/src/browser-proxy-cli.ts workspace-context \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoints list,get-by-ids \
  --limit 20 \
  --dryRun \
  --outDir data/jimeng-lab/proof-20260610-workspace-context-dry-run

bun packages/jimeng-client/src/browser-proxy-cli.ts workspace-context \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoints list,get-by-ids \
  --limit 20 \
  --outDir data/jimeng-lab/proof-20260610-workspace-context-live

bun packages/jimeng-client/src/browser-proxy-cli.ts static-inventory \
  --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \
  --outDir data/jimeng-lab/proof-20260610-static-inventory-workspace-context \
  --limit 120
```

Result:

```txt
static-locate-workspace-context: endpoints=2 occurrences=2
workspace-context dry run saved endpoints=list,get-by-ids
workspace-context saved endpoints=list,get-by-ids listed=2 by_ids=1 skipped=0
static-inventory: resources=247 skipped_implemented=42 high_value_gaps=61
known_status_counts=unknown:125,partial:4,implemented:42,dry_run_only:4,blocked:69,captured_only:2,cataloged_only:1
```

Static frontend evidence:

```txt
workspace/list body: { offset, limit }
workspace/get_by_ids wire body: { workspace_ids: [...] }
```

Live no-spend proof:

```txt
data/jimeng-lab/proof-20260610-workspace-context-live/normalized/workspace-context-20260610124419-summary.json
list ret=0 workspace_count=2 total=0 has_more=false
get_by_ids ret=0 workspace_count=1
listed workspace names: default, 韩系美妆健身自拍参考图
response hashes:
  list=220409f83176bba37c9ebd8c2f3275dedf57186c82b292f538c51359848975bf
  get_by_ids=02f52f72aa95ffa0f754e03776be0be4efbe064eaa81de7c2bd68e1b6a2e9674
```

The live response included numeric `workspace_id=0` for the default workspace, so the boundary schema accepts string or number ids and normalizes ids to strings. Normalized proof files contain no credential markers or signed media URLs; raw ignored proof can contain signed `cover_image` URLs.

## Research Keywords Smoke

No-spend Jimeng keyword discovery:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts research-keywords \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoints suggest,guess \
  --channels inspiration,short-film,asset \
  --keyword '韩系美妆' \
  --limit 10 \
  --dryRun \
  --outDir data/jimeng-lab/proof-20260610-research-keywords-cli-dry-run

bun packages/jimeng-client/src/browser-proxy-cli.ts research-keywords \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoints suggest,guess \
  --channels inspiration,short-film,asset \
  --keyword '韩系美妆' \
  --limit 10 \
  --outDir data/jimeng-lab/proof-20260610-research-keywords-cli-live
```

Result:

```txt
dry-run planned requests=5
live results=5 items=30 skipped=1
suggest/inspiration ret=0 items=10
suggest/short-film ret=0 items=10
suggest/asset skipped after prior ret=1000 invalid parameter proof
guess/inspiration ret=0 items=10
guess/short-film ret=0 items=0
guess/asset ret=0 items=0
```

The Effect Schema boundary requires `data.suggest_list` or `data.guess_list`, accepts additive provider fields, and rejects nonzero `ret`. Suggestion `gid` values arrive as JSON numbers larger than JavaScript's safe integer range, so normalized output marks them as unsafe and does not claim an exact id. Normalized dry-run/live proofs contain no credentials or signed URLs.

Static inventory was also fixed to recognize `/mweb/search/v1/*`:

```txt
resources=251
skipped_implemented=44
known_status_counts=unknown:125,partial:5,implemented:44,dry_run_only:4,blocked:70,captured_only:2,cataloged_only:1
```

Full `/mweb/search/v1/search` is now implemented as no-spend `research-search`.

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts research-search \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --channel inspiration \
  --keyword '韩系美妆' \
  --limit 6 \
  --outDir data/jimeng-lab/proof-20260611-research-search-cli-inspiration

bun packages/jimeng-client/src/browser-proxy-cli.ts research-search \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --channel short-film \
  --keyword '韩系美妆' \
  --limit 6 \
  --outDir data/jimeng-lab/proof-20260611-research-search-cli-short-film

bun packages/jimeng-client/src/browser-proxy-cli.ts research-search \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --channel asset \
  --assetType image \
  --workspaceId 0 \
  --limit 4 \
  --outDir data/jimeng-lab/proof-20260611-research-search-cli-asset-v3
```

Result:

```txt
inspiration: ret=0, items=6, has_more=true, next_cursor=6
short-film: ret=0, items=6, has_more=true, first video=1920x1080, 65.8s
asset: ret=0, assets=1, generated_items=4, has_more=false
```

Effect Schema validates the required envelope and selected nested item/asset paths while accepting additive provider fields. The frontend cache-token/media transform was recovered as AES-256-CBC and is covered by a synthetic encrypted-response test. Current live responses had no `cache_sync_token`, so no live decryption was needed. Normalized proofs omit signed media URLs and contain no credential markers.

Refreshed static inventory:

```txt
resources=251
skipped_implemented=45
known_status_counts=unknown:125,partial:4,implemented:45,dry_run_only:4,blocked:70,captured_only:2,cataloged_only:1
```

`/mweb/search/v1/fetch_debug/search` remains classified as a blocked debug wrapper rather than a production API.

Public/reference profile research is implemented as no-spend `profile-research`.

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts profile-research \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoints all \
  --secUid MS4wLjABAAAAtvo4sAxmw1TCTwfvBOl5rVIowjDJGQ64fvQbkpapMY8 \
  --publishedItemId 7524730786826751247 \
  --limit 6 \
  --dryRun \
  --outDir data/jimeng-lab/proof-20260611-profile-research-cli-dry-run

bun packages/jimeng-client/src/browser-proxy-cli.ts profile-research \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoints all \
  --secUid MS4wLjABAAAAtvo4sAxmw1TCTwfvBOl5rVIowjDJGQ64fvQbkpapMY8 \
  --publishedItemId 7524730786826751247 \
  --limit 6 \
  --outDir data/jimeng-lab/proof-20260611-profile-research-cli-live
```

Result:

```txt
profile-research saved results=6 items=3 profiles=7 skipped=0
public profile: ret=0, followers=595, material favorites=3715
homepage: ret=0, items=1, video=704x1248, duration_ms=5042
favorites: ret=0, items=1, favorite_count=1113, usage_count=201
following: ret=0, profiles=6, has_more=true
followers: ret=0, profiles=0
item detail: ret=0, prompt/model/first-frame/video metadata decoded
```

The command distinguishes public-profile and current-account scopes. Effect Schema requires the relied-on profile/list/item fields while tolerating additive fields. Normalized proof files contain provider URIs and URL-presence booleans, but no signed URL values or credential markers.

Public story/archive listing was added as the `stories` endpoint on the same command.

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts profile-research \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoints stories \
  --secUid MS4wLjABAAAAtvo4sAxmw1TCTwfvBOl5rVIowjDJGQ64fvQbkpapMY8 \
  --limit 6 \
  --dryRun \
  --outDir data/jimeng-lab/proof-20260611-profile-research-stories-dryrun

bun packages/jimeng-client/src/browser-proxy-cli.ts profile-research \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoints stories \
  --secUid MS4wLjABAAAAtvo4sAxmw1TCTwfvBOl5rVIowjDJGQ64fvQbkpapMY8 \
  --limit 6 \
  --outDir data/jimeng-lab/proof-20260611-profile-research-stories-live
```

Result:

```txt
profile-research dry run saved requests=1
profile-research saved results=1 items=0 profiles=0 skipped=0
stories: ret=0, story_count=0, has_more=false, next_offset=0
```

Note: the CLI flag parser accepts `--dryRun`, not `--dry-run`; a mistakenly named `proof-20260611-profile-research-stories-dry-run` directory contains a live no-spend read because the kebab-case flag was ignored. Use `proof-20260611-profile-research-stories-dryrun/` for the clean dry-run manifest.

Batch item detail `/mweb/v1/mget_item_info` remains blocked. No-spend probes under `data/jimeng-lab/proof-20260611-probe-mget-item-info/` returned `ret=1000 invalid parameter` for `published_item_ids`, `item_ids`, `ids`, and `published_item_id_list`; static evidence shows a frontend conversion layer around `getWorkDetails`, so the next step is recovering an exact caller payload or UI capture.

Refreshed static inventory:

```txt
resources=251
known_status_counts=unknown:118,partial:4,implemented:51,dry_run_only:4,blocked:71,captured_only:2,cataloged_only:1
```

## Verification

```bash
bun run jimeng:typecheck
bun run jimeng:test
mise x ast-grep -- ast-grep scan --config sgconfig.yml packages/jimeng-client/src/profile-research.ts packages/jimeng-client/src/research-search.ts packages/jimeng-client/test/profile-research.test.ts
mise x ast-grep -- ast-grep scan --config sgconfig.yml packages/jimeng-client/src/profile-research.ts packages/jimeng-client/src/browser-proxy-cli.ts packages/jimeng-client/src/discovery-worklist.ts packages/jimeng-client/test/profile-research.test.ts
bun packages/jimeng-client/src/browser-proxy-cli.ts --help | rg 'static-inventory|account-credit|commerce-benefits|workspace-context|research-keywords|research-search|profile-research|lip-sync-config|voice-clones|voice-clone-submit|capcut-probe|capcut-template-metadata|capcut-categories|capcut-collections|capcut-collection-templates|capcut-template-detail|capcut-editor-catalog|infinite-canvas|overseas-short-videos|subject-create|subject-update|subject-delete|subject-generate-voice|subjects|templates|short-videos'
```

Result:

```txt
typecheck passed
173 tests passed, 0 failed
scoped ast-grep unsafe-type rules passed with zero findings
browser-proxy help listed static-inventory, account-credit, commerce-benefits, workspace-context, research-keywords, research-search, profile-research, CapCut collection/detail/editor-catalog, and infinite-canvas commands
paid smoke normalized files have no live token markers
```

Repo-wide `bun run lint:unsafe-types` remains red on 370 unrelated Slotok/workbench findings plus one stale baseline entry; no finding is in the changed Jimeng files.

## Follow-Up

Next useful captures:

- image-to-image / byte edit
- subject/persona generate_voice live submit after explicit spend approval or captured UI submit
- style reference controls
- additional template/research endpoints: CapCut template search, batch, and preset endpoints
- image-to-video end-frame and multi-frame live proof with explicit frontend mode capture
- multimodal/all-around reference video
- lip-sync live submit capture/compare before enabling generation
- video text generation through the current unified app route
- voice clone live submit/mutation and subject/persona voice generation
- canvas edit tools
