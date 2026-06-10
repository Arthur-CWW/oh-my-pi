# Jimeng/Dreamina CLI Extraction Goal

## Outcome

Reverse engineer Jimeng/Dreamina's logged-in frontend GenAI surface into a truthful, tested local CLI surface first. A daemon-backed async job orchestrator is an optimization phase after the API surface settles; do not jump to it yet.

Keep going until every high-value UGC capability reachable from Arthur's logged-in Jimeng frontend is either:

- implemented as a typed CLI command with proof artifacts, or
- documented as blocked/unknown with captured evidence, exact UI path, request traces, and the next probe.

This goal is intentionally coverage-and-proof driven. Do not claim completion because one endpoint works. Completion means the useful reachable frontend surface has been systematically explored, implemented where possible, proven where implemented, and honestly documented where blocked.

## Current Continuation State

As of 2026-06-10, the committed Jimeng CLI baseline is:

- `65a67bd Add Jimeng browser proxy client`
- `6ba0ae9 Add Jimeng voice catalog and TTS CLI`
- `4567ca0 Add Jimeng upload token probe`
- `6fb9c61 Add Jimeng ImageX image upload CLI`
- `f683706 Update Jimeng CLI extraction goal`
- `35d9171 Add Jimeng image-to-video CLI proof`
- `28fc0cf Add Jimeng VOD video upload CLI proof`
- `0bb9bb5 Add Jimeng frames-to-video dry-run CLI`
- `86ff779 Add Jimeng lip-sync VOD dry-run plan`
- `5c7887a Add Jimeng Explore templates CLI`
- `594d5d0 Add Jimeng short-video Explore CLI`
- `3434225 Add Jimeng reference image inspect CLI`
- `e442938 Add Jimeng ControlNet preview CLI`
- `858eab2 Document Jimeng ControlNet preview proofs`
- `3e3bde2 Add Jimeng object mask CLI`
- `00c4aca Add Jimeng subjects CLI`
- `44dd492 Add Jimeng feed short video CLI`
- `aa0eafb Add CapCut template metadata CLI`
- `c7b55b1 Add Jimeng lip sync config CLI`
- `4936bc7 Add Jimeng lip sync image planning`
- `cf2b953 Document background Jimeng automation preference`
- `e5e3539 Add Jimeng subject lifecycle CLI`
- `6fc9948 Add Jimeng voice clone CLI coverage`
- `e8313de Add Jimeng workbench assets CLI`
- `736ed98 Add Jimeng history queue CLI`
- `858dcb0 Add schema-backed Jimeng history records CLI`
- `1edef0e Add Jimeng endpoint probe and video info CLI`
- `401a6c1 Add Jimeng capture analyzer CLI`
- `64b66e2 Add Jimeng lip-sync compare gate`
- `b77cf2c Add Jimeng discovery worklist CLI`

If the thread goal object lags behind this file after a pause, resume from this document and the latest Git checkpoint. The active working rule is: background-only reversal, direct/API-first implementation, small proven CLI slices, tests and proof artifacts before each commit, and no async daemon until the API surface is settled.

ImageX local image upload is now committed and live-proved:

- `jimeng-browser-proxy upload-image`
- local ImageX image upload via:
  - `/mweb/v1/get_upload_token` scene `2`
  - ImageX `ApplyImageUpload`
  - direct `POST /upload/v1/{StoreUri}`
  - ImageX `CommitImageUpload`
- tests for deterministic AWS4-style ImageX signing and mocked token/apply/upload/commit sequence
- docs and QA notes showing a live proof URI and local artifact under ignored `data/**`

First-frame image-to-video is now committed and live-proved:

- `jimeng-browser-proxy image2video`
- local first-frame upload via ImageX scene `2`, provider URI injection into `first_frame_image`, submit/poll/download through `/mweb/v1/aigc_draft/generate` and `/mweb/v1/get_history_by_ids`
- useful flags exposed for later parameterization: `--image`, `--firstFrameUri`, `--lastFrameUri`, `--durationSec`, `--ratio`, `--videoResolution`, `--modelVersion`, `--modelReqKey`, `--seed`
- proof bundle:
  - dry-run/local upload: `data/jimeng-lab/proof-20260609-image2video-local-upload/`
  - live MP4: `data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4`
  - thumbnail: `data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-thumb-2s.jpg`

VOD/video upload is now implemented and live-proved:

- `jimeng-browser-proxy upload-video`
- local MP4 upload via:
  - `/mweb/v1/get_upload_token` scene `1`
  - VOD `ApplyUploadInner`
  - direct `POST /upload/v1/{StoreUri}`
  - VOD `CommitUploadInner`
- useful provider references exposed for later payloads: `vid` and `tos-cn-v-*` store URI
- proof bundle:
  - dry-run: `data/jimeng-lab/proof-20260609-video-upload-dry-run/`
  - live proof: `data/jimeng-lab/proof-20260609-video-upload-live/`
  - `vid=v03870g10004d8k1u4nog65hb08dnhig`
  - `storeUri=tos-cn-v-148450/o4gBE1AAWbfiDDig6xEQ4KJhDHQvlExoFkFExB`

First/end-frame image-to-video is now dry-run-proved:

- `jimeng-browser-proxy frames2video`
- local first-frame and end-frame ImageX uploads
- patched `video_gen_inputs[0].first_frame_image` and `video_gen_inputs[0].end_frame_image`
- proof bundle: `data/jimeng-lab/proof-20260609-frames2video-dry-run/`
- `first_frame_image=tos-cn-i-tb4s082cfz/5b31ee284d5c43eb8097bfc5818b584a.png`
- `end_frame_image=tos-cn-i-tb4s082cfz/325213bd2b2049d3a65667350b72807e.jpg`
- live generation is intentionally not claimed yet; first capture or select the frontend's explicit end-frame/multi-frame mode.

Lip-sync VOD video-reference planning is now dry-run-proved:

- `jimeng-browser-proxy lip-sync`
- accepts an existing VOD `vid`/URI/metadata or can upload a local video to VOD first
- builds `videoGenInputs.v2vOpt.lipSyncUserVideo.originVideo.originVideo`
- attaches `ttsInfo` with text, `toneId`, optional tone metadata, and speed
- uses frontend bundle evidence for `model_req_key=dreamina_lib_sync_base`, `generateType=LipSync`, and `DAVideoProcessType.LipSyncUserVideo`
- proof bundle: `data/jimeng-lab/proof-20260610-lip-sync-vod-plan/`
- live generation is intentionally disabled until a real frontend lip-sync submit is captured and compared.

Lip-sync image/avatar planning is now dry-run-proved:

- `jimeng-browser-proxy lip-sync --image` / `--imageUri`
- local avatar/reference images upload through the confirmed ImageX scene `2` path first unless an existing provider URI and dimensions are supplied
- builds `videoGenInputs.i2vOpt.realmanAvatar.originImage`
- attaches `ttsInfo` with text, `toneId`, optional tone metadata, and speed
- uses frontend bundle evidence for `model_req_key=dreamina_lib_sync_image_quick_1.5`, `generateType=LipSync`, and `DAVideoProcessType.LipSyncImage`
- proof bundle: `data/jimeng-lab/proof-20260610-lip-sync-image-plan/`
- latest proof uploaded `image_uri=tos-cn-i-tb4s082cfz/487472ac3b204caa89fc1b2764c0aa1e.png`, `width=2048`, `height=2048`
- summary hash: `ed087e3df60ae9c30dc835d2d410867670229abfb115adb186846aa1aa631fc6`
- dry-run plan hash: `5386ac4dd343228680dc66395faade92dfbd225d4968baa3f2e2decba248dea4`
- live generation is intentionally disabled until a real frontend image/avatar lip-sync submit is captured and compared.

Lip-sync/digital-human model config is now live-proved without generation spend:

- `jimeng-browser-proxy lip-sync-config`
- direct `/mweb/v1/video_generate/get_common_config` for scenes `lip_sync_image_generate_video` and `lip_sync_video_generate_video`
- image/avatar models:
  - `dreamina_lib_sync_image_master_1.5` / `大师模式`
  - `dreamina_lib_sync_image_quick_1.5` / `快速模式`
- video model:
  - `dreamina_lib_sync_base` / `基础模式`
- image-mode options include `input_media_type` and `audio_option`
- proof bundle: `data/jimeng-lab/proof-20260610-lip-sync-config/`
- raw config responses include signed preview GIF URLs, while normalized summaries omit them.

Agent skill/model catalog is now live-proved without generation spend and schema-backed:

- `jimeng-browser-proxy agent-catalog`
- direct `/mweb/v1/creation_agent/v2/skill/list` and `/mweb/v1/creation_agent/v2/get_agent_config` with logged-in browser session headers
- useful flags: `--endpoints skills,config,all`
- normalizes official agent skills, image model keys, video model keys, image control feats, image blend controls, resolution presets, sample-step bounds, video option keys, frame counts, fps, aspect ratios, input media types, unified-edit material limits, compliance confirmation flags, cancel support, and max batch counts
- proof bundle: `data/jimeng-lab/proof-20260610-agent-catalog/`
- latest proof returned 4 skills, 8 image models, and 5 video models
- high-value flags included image controls `bg_paint`, `byte_edit`, `canny`, `depth`, `face_swap`, `ip_keep`, `pose`, `support_subject`; video options `fps`, `frames`, `input_media_type`, `multi_frames`, `resolution`, `unified_edit`, `video_aspect_ratio`; and video input media types `prompt`, `first_frame`, `end_frame`, `multi_frame`, and `unified_edit`

Explore/template mining is now live-proved without generation spend:

- `jimeng-browser-proxy templates`
- direct `/mweb/v1/get_explore` with logged-in browser session headers
- useful flags: `--limit`, `--offset`, `--category-id`, `--work-types`, `--feed-refer`
- normalizes Explore examples into prompt, model key, seed, image ratio, template metadata, usage/favorite counters, and cover dimensions
- proof bundle: `data/jimeng-lab/proof-20260610-templates-explore/`
- observed quirk: the endpoint returned 40 items for a request with `count=5`, while setting `next_offset=5`; downstream pipelines should apply local caps.

Short-video Explore mining is now live-proved without generation spend:

- `jimeng-browser-proxy short-videos`
- direct `/mweb/v1/get_explore` with `filter.work_type_list=["short_video"]`
- useful flags: `--limit`, `--offset`, `--category-id`, `--feed-refer`
- normalizes public short-video examples into durable video metadata and ranking signals: `video_id`, duration, width, height, fps, definition, format, audio/mute flags, transcoded definitions, play/favorite/comment/share counts, and metadata effect id/type
- signed video URLs are intentionally not normalized into durable fields; raw responses remain ignored under `data/**`
- proof bundle: `data/jimeng-lab/proof-20260610-short-videos-explore/`
- latest proof returned 20 short-video items for `count=5`, `next_offset=5`, top play count `1718727`, and top video metadata `1280x720`, `85s`, `15fps`, with audio.

Overseas short-video feed mining is now live-proved without generation spend:

- `jimeng-browser-proxy overseas-short-videos`
- direct `/mweb/v1/feed_short_video` with `filter.work_type_list=["short_video"]`
- useful flags: `--limit`, `--offset`, `--category-id`, `--feed-refer`
- frontend bundle evidence: `GET_OVERSEAS_SHORT_VIDEO="/mweb/v1/feed_short_video"` and the same short-video query token shape as the Explore short-video lane
- parser accepts both snake_case live responses and camelCase frontend/domain model shapes
- normalized output redacts signed cover URLs from item lists while retaining cover URL presence, dimensions, video metadata, ranking signals, and effect/template ids
- proof bundle: `data/jimeng-lab/proof-20260610-overseas-short-videos/`
- latest proof returned 4 items for `count=5`, `next_offset=5`, top play count `2382533`, and top video metadata `3840x2160`, `57s`, `30fps`, with audio.

CapCut commercial template category mining is now live-proved without generation spend:

- `jimeng-browser-proxy capcut-categories`
- signed direct `https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_categories`
- frontend bundle evidence: `GetBatchCategories="/lv/v1/cc_web/plane/get_categories"`, body `{sdk_version:"16.1.0"}`, and signer `md5("9e2c|"+pathname.slice(-7)+"|7|5.8.0|"+deviceTime+"||11ac")`
- useful flags: `--capcut-lan`, `--capcut-loc`
- normalized output records durable category ids, starling keys, display names, log id, and response hash without signed media URLs
- proof bundle: `data/jimeng-lab/proof-20260610-capcut-categories/`
- latest proof returned 8 commercial template categories: Black Friday, Clothing and shoes, Cosmetic dailyization, Food beverages, Jewelry, Furniture, Consumer electronics, and pets.
- related CapCut template search/collection endpoints are discovered but not implemented: guessed payloads for `/lv/v1/cc_web/replicate/search_templates`, `/lv/v1/cc_web/plane/get_collection_templates`, and `/lv/v1/cc_web/plane/batch_get_collection_templates` returned `ret=1000 param error`; `/lv/v1/cc_web/plane/fuzzy_search_templates` returned success but empty lists for tested English title/query fields. Capture real UI payloads before exposing those as CLI commands.

CapCut public template ratio/scene metadata is now live-proved without generation spend and without a browser session:

- `jimeng-browser-proxy capcut-template-metadata`
- public static JSON endpoints:
  - `https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_49/bee_prod_49_bee_publish_709.json`
  - `https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_149/bee_prod_149_bee_publish_835.json`
- frontend bundle evidence: `GetAllTemplateRatio`, `GetTemplateScenes`, and `k.U8.mercury="https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod"`
- proof bundle: `data/jimeng-lab/proof-20260610-capcut-template-metadata/`
- latest proof returned 6 ratio presets and 33 scene formats; first scenes include Instagram post, Instagram story, Instagram portrait, Tiktok, YouTube thumbnail, YouTube intro, YouTube end screen, and Facebook post.

Reference-image inspection is now live-proved without generation spend:

- `jimeng-browser-proxy describe-image`
- direct `/mweb/v1/get_image_description` and `/mweb/v1/face_recognize` with logged-in browser session headers
- local images are uploaded through the live-proved ImageX scene `2` path first, unless an existing `--imageUri` is supplied
- useful flags: `--image`, `--file`, `--imageUri`, `--noDescription`, `--noFaces`
- normalized proof records provider URI, description presence/length, response hashes, and face count without signed upload traces
- proof bundle: `data/jimeng-lab/proof-20260610-reference-image-inspect/`
- latest proof produced description `黑发女人，白色背心。`; face recognition returned `ret=0`, `errmsg=success`, and `face_count=0` for that input image.

ControlNet reference preview is now live-proved without generation spend:

- `jimeng-browser-proxy controlnet-preview`
- direct `/mweb/v1/blend_preview` with frontend constants `model=img2img_xl_sft`, `ability.name=control_net`, `control_net_list[].name=pose|depth|canny`, and default strength `0.6`
- pose mode also calls `/mweb/v1/pose_detect`
- local images are uploaded through the live-proved ImageX scene `2` path first, unless an existing `--imageUri` is supplied
- useful flags: `--image`, `--file`, `--imageUri`, `--control`, `--strength`, `--fitMode`, `--noPoseDetect`, `--noDownload`
- normalized proof records provider URI, preview provider URI, pose-detect result, frontend save-param patch, response hashes, and a local preview PNG path without signed URLs
- proof bundles:
  - pose: `data/jimeng-lab/proof-20260610-controlnet-pose-preview/`
  - depth: `data/jimeng-lab/proof-20260610-controlnet-depth-preview/`
  - canny: `data/jimeng-lab/proof-20260610-controlnet-canny-preview/`
- latest pose proof produced `preview_image_uri=tos-cn-i-tb4s082cfz/222b232061324073accaf7992ec3ad87`, `pose_detected=true`, and a `1024x1024` pose skeleton PNG at `data/jimeng-lab/proof-20260610-controlnet-pose-preview/artifacts/controlnet-preview-20260609162825-rvn7f6-pose-preview.png`.
- latest depth proof produced `preview_image_uri=tos-cn-i-tb4s082cfz/df194e1d74a54982ae5ceb151e239c9c` and a `1024x1024` grayscale depth PNG at `data/jimeng-lab/proof-20260610-controlnet-depth-preview/artifacts/controlnet-preview-20260609163638-wworll-depth-preview.png`.
- latest canny proof produced `preview_image_uri=tos-cn-i-tb4s082cfz/915b0cd6c0c943fc9ab24b5c12e5a26d` and a `1024x1024` outline PNG at `data/jimeng-lab/proof-20260610-controlnet-canny-preview/artifacts/controlnet-preview-20260609163709-xrv4zg-canny-preview.png`.

Object/saliency segmentation is now live-proved without generation spend:

- `jimeng-browser-proxy object-mask`
- direct `/mweb/v1/saliency_seg` using frontend-derived request shapes:
  - canvas mode: `{"image_uri_list":["tos-cn-i-..."],"mode":"canvas"}`
  - default mode: `{"image_uri_list":["tos-cn-i-..."]}`
- local images are uploaded through the live-proved ImageX scene `2` path first, unless an existing `--imageUri` is supplied
- useful flags: `--image`, `--file`, `--imageUri`, `--mode canvas|default|both`, `--noDownload`
- normalized proof records provider URI, request shapes, response hashes, mask provider URIs, URL-presence booleans, and local mask PNG paths without signed URLs
- proof bundle: `data/jimeng-lab/proof-20260610-object-mask/`
- latest proof produced `image_uri=tos-cn-i-tb4s082cfz/080999a077994629bbec76c6f344a09a.png`, one `canvas` mask and one `default` mask:
  - canvas mask URI `tos-cn-i-tb4s082cfz/2b0258d421f14b02b6f20a23eeaae0ec`, artifact `data/jimeng-lab/proof-20260610-object-mask/artifacts/object-mask-20260609165112-8yjxpj-canvas-mask-01.png`
  - default mask URI `tos-cn-i-tb4s082cfz/d6641d59e6de4d17be119c0b98506129`, artifact `data/jimeng-lab/proof-20260610-object-mask/artifacts/object-mask-20260609165112-8yjxpj-default-mask-01.png`
  - both mask artifacts are `2048x2048` PNGs.

Saved subject/persona listing is now live-proved without generation spend:

- `jimeng-browser-proxy subjects`
- direct `/mweb/v1/dreamina_subject/get` with logged-in browser session headers
- useful flags: `--cursor`, `--limit`
- normalizes durable subject fields: `subject_id`, `name`, `description`, `status`, create/update timestamps, cover image URI, cover URL presence, image URI count, and voice id count
- normalized summaries intentionally omit signed cover URLs and raw responses remain ignored under `data/**`
- proof bundle: `data/jimeng-lab/proof-20260610-subjects/`
- latest proof returned `ret=0`, `errmsg=success`, `subject_count=0`, `has_more=false`, `next_cursor=0`, and response hash `618858c54ed5d0b298cf37ed03bf29d27042f54e3e999bb143932cec6a3ef31f`.

Subject/persona creation is now live-proved without generation spend:

- `jimeng-browser-proxy subject-create`
- confirmed from asset library `主体 -> 创建主体` UI capture, then implemented as direct background API calls
- local images upload through the confirmed ImageX scene `2` path, then call:
  - `/mweb/v1/imagex/submit_audit_job`
  - `/mweb/v1/get_image_by_uri`
  - `/mweb/v1/dreamina_subject/create`
- create payload shape: `content.name`, `content.description`, `content.main_image.{width,height,image_uri,image_url}`, and `workspace_id`
- useful flags: `--workspaceId`, `--name`, `--description`, `--image`, `--file`, `--imageUri`, `--imageWidth`, `--imageHeight`, `--imageUrl`
- proof bundle: `data/jimeng-lab/proof-20260610-subject-create-cli/`
- latest proof created `subject_id=12352249053442`, `data_id=12352249053698`, using `image_uri=tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png`, `2048x2048`, with summary hash `52a8d7ba8acf00de72912228a5d1ab1ea0d96edea5adf8be44744d2092258dec`
- normalized summaries intentionally omit signed image URLs; raw upload/create responses remain ignored under `data/**`

Subject/persona update/delete is now live-proved without generation spend:

- `jimeng-browser-proxy subject-update`
- `jimeng-browser-proxy subject-delete`
- direct `/mweb/v1/dreamina_subject/update` and `/mweb/v1/dreamina_subject/delete` with logged-in browser session headers
- frontend bundle evidence maps `updateSubject({subjectId, content})`, `deleteSubject({subjectId})`, and batch `deleteSubjects({subjectIdList})` through the same JSON casing transform as create/list
- useful flags: `--subjectId`, `--subjectIds`, `--name`, `--description`, `--image`, `--file`, `--imageUri`, `--imageWidth`, `--imageHeight`, `--imageUrl`
- proof bundle: `data/jimeng-lab/proof-20260610-subject-lifecycle/`
- latest proof created temporary `subject_id=14204993143308`, updated it to `CLI QA Updated`, deleted it, then verified `subjects --subjectIds 14204993143308` returned `subject_count=0`
- update response hash: `47168986f6e80a31c8f169afdb19755b4a08895f496292e988e6f1d88b6152c2`
- delete response hash: `8cc3d46d8dec2d339dc0e7fe2d338f0ac4946752fc276a0f9a508bcb7c1f52f8`
- normalized summaries intentionally omit signed image URLs; raw responses remain ignored under `data/**`

Subject/persona voice generation is request-shaped but not live-submitted:

- `jimeng-browser-proxy subject-generate-voice --dryRun`
- frontend bundle evidence maps `generateSubjectVoice({imageUri})` to `/mweb/v1/dreamina_subject/generate_voice` with request body `{"image_uri":"tos-cn-i-..."}`
- proof bundle: `data/jimeng-lab/proof-20260610-subject-lifecycle/`
- live submit is disabled because it may consume generation quota and still needs explicit spend approval or a captured UI submit

Custom voice clone coverage is now partially implemented and proved:

- `jimeng-browser-proxy voice-clones`
- `jimeng-browser-proxy voice-clone-submit`
- `jimeng-browser-proxy voice-clone-query`
- `jimeng-browser-proxy voice-clone-update`
- `jimeng-browser-proxy voice-clone-delete`
- frontend bundle evidence maps:
  - cloned voice assets: `/mweb/v1/get_user_local_item_list` with `effect_type=218`, `filter_opt.clone_voice_status=[1,2]`
  - voice clone submit: `/mweb/v1/voice/submit_task` with `scene=1`, `voice_clone.audio`, `voice_clone.name`
  - voice task query: `/mweb/v1/voice/query_task` with `task_id_list`
  - voice update/delete: `/mweb/v1/voice/update` and `/mweb/v1/voice/delete` with `local_item_id`
- live no-spend asset proof returned `ret=0`, `errmsg=success`, `voice_count=0`, `next_offset=50`
- proof bundle: `data/jimeng-lab/proof-20260610-voice-clone/`
- submit/update/delete remain dry-run-only because they may create or mutate account assets; enable live only after background CDP capture and explicit approval or a disposable fixture

Workspace/workbench asset listing is now live-proved without generation spend:

- `jimeng-browser-proxy assets`
- direct `/mweb/v1/get_asset_list` with logged-in browser session headers
- frontend capture evidence: text-to-image workbench polling used `count`, `direction=1`, `mode=workbench`, `option.image_info`, `option.origin_image_info`, `option.order_by`, `option.only_favorited`, `option.end_time_stamp`, `option.hide_story_agent_result`, `asset_type_list=[1,2,5,6,7,8,9,10,12]`, and `workspace_id`
- useful flags: `--limit`, `--asset-types`, `--asset-mode`, `--direction`, `--order-by`, `--endTimeStamp`, `--onlyFavorite`, `--includeStoryAgentResult`, `--workspaceId`
- session referer workspace inference is supported when `--workspaceId` is omitted
- normalized summaries keep durable asset ids, submit/history ids, status, prompt, model key/name, seed, provider image/video URIs, dimensions, generated item counts, and URL-presence booleans while omitting signed media URLs
- proof bundle: `data/jimeng-lab/proof-20260610-assets/`
- latest proof returned `asset_count=1`, `has_more=false`, `next_offset=1780998990927`, first `asset_id=39148697060354`, `submit_id=a6bbee65-bed0-4e5b-aaf1-5ab466137b82`, `status=50`, `generated_item_count=4`, `model_req_key=high_aes_general_v50`, response hash `5373ac3f6339e82f7f3090059b742d83b17b9b438151476993466ae6d105f312`, and normalized summary hash `10ba3a679c2e7e472c20fb186dedbd5289687c2a5b0aba7e88a0509bf17a4af8`

History queue/status lookup is now live-proved without generation spend:

- `jimeng-browser-proxy history-queue`
- direct `/mweb/v1/get_history_queue_info` with logged-in browser session headers
- frontend bundle evidence maps `getHistoryQueueInfo({historyIds})`; direct wire body must be `history_ids`
- useful flags: `--historyId`, `--historyIds`
- negative casing proof: `{"historyIds":["39148697060354"]}` returned `ret=1000`, `errmsg=invalid parameter`
- normalized summaries keep per-history status, queue index/status/length, priority, polling interval/timeout, display thresholds, forecast cost time when present, and debug-info hashes while omitting raw queue debug strings
- proof bundle: `data/jimeng-lab/proof-20260610-history-queue/`
- latest proof returned `entry_count=1`, `history_id=39148697060354`, `status=0`, `queue_status=3`, `queue_length=0`, `polling_interval_seconds=30`, `polling_timeout_seconds=86400`, response hash `292217828c13e57d7908a146e9496d36194c57ab075d547a24e74c7eb61ea8c0`, and debug-info hash `f71e62a6cfa3199b9974993f1774d6161383110784671d6fc9c3fa945072182e`

History record lookup is now live-proved without generation spend and schema-backed:

- `jimeng-browser-proxy history-records`
- direct `/mweb/v1/get_history_by_ids` with logged-in browser session headers
- useful flags: `--submitId`, `--submitIds`, `--historyId`, `--historyIds`
- request shape: `{"submit_ids":["..."],"need_batch":true,"history_ids":["..."]}`
- response contract is decoded through permissive Zod schemas before normalization; additive provider fields are allowed, while the relied-on `ret`/`errmsg`/`data` map and history record/media paths produce explicit contract-drift errors if changed
- normalized summaries keep lookup key, history id, submit id, status/task status, prompt, model key/name, seed, generated item count, provider image/video URIs, dimensions, and URL-presence booleans while omitting signed media URLs
- proof bundles: `data/jimeng-lab/proof-20260610-history-records/` and `data/jimeng-lab/proof-20260610-history-records-by-history-id/`
- latest submit-id proof returned `record_count=1`, `lookup_key=a6bbee65-bed0-4e5b-aaf1-5ab466137b82`, `history_record_id=39148697060354`, `status=50`, `task_status=50`, `generate_type=1`, `mode=workbench`, `model_req_key=high_aes_general_v50`, `model_name=图片5.0 Lite`, `seed=105719980`, `total_image_count=4`, `finished_image_count=4`, response hash `2da0421296eb99f5c3e14b4ac543d800481a4f875e8b7c555f6404ef903bd413`
- latest history-id proof returned the same completed record for lookup key `39148697060354`, response hash `77079fffff13a0c230698d7032bacd8a9784bbf9e8184e4685dd37e324aea8a6`

Endpoint replay/probing is now available to speed future slices:

- `jimeng-browser-proxy endpoint-probe`
- replays explicit JSON body variants against one endpoint using saved/background session headers
- writes raw local response bodies under ignored `data/**`
- writes normalized request/response shape summaries with hashes, `ret`/`errmsg`, and URL-like-token booleans; signed URL values are not included in normalized summaries
- latest proof used `/mweb/v1/get_video_by_vid` to compare `{"vids":["v03870g10004d8k1u4nog65hb08dnhig"]}` vs `{"vid":"v03870g10004d8k1u4nog65hb08dnhig"}`; `vids` returned `ret=0`, singular `vid` returned `ret=1000`
- proof bundle: `data/jimeng-lab/proof-20260610-endpoint-probe-video-info/`

VOD video metadata lookup is now live-proved without generation spend and schema-backed:

- `jimeng-browser-proxy video-info`
- direct `/mweb/v1/get_video_by_vid` with logged-in browser session headers
- confirmed request shape: `{"vids":["..."]}`
- useful flags: `--vid`, `--vids`
- normalized summaries keep VOD id, duration, dimensions, fps, format, definition, md5, size, transcoded definitions, and URL-presence booleans while omitting signed video/cover URLs
- proof bundle: `data/jimeng-lab/proof-20260610-video-info/`
- latest proof returned `vid=v03870g10004d8k1u4nog65hb08dnhig`, `duration=5s`, `width=704`, `height=1248`, `fps=24`, `format=mp4`, `definition=720p`, `size_bytes=4285498`, response hash `06ae536f69e703297f9cba1988665d0dcf4ad7c05bc117f79332931ec010a17d`

Capture analysis/ranking is now available as the repeatable "tool that builds the tool" stage:

- `jimeng-browser-proxy capture-analyze`
- offline; does not load a browser session or foreground any UI
- input: `raw-network.jsonl` from `jimeng-network-recorder`, either via `--rawNetwork` or `--captureDir`
- useful flags: `--staticRoot`, `--limit`, `--includeRisky`
- decodes recorder events with permissive Zod schemas so additive CDP/provider fields do not break analysis, while unsupported event shapes fail explicitly
- normalized output ranks endpoints by UGC usefulness, classifies risk (`read`, `upload`, `generate`, `mutate`, `payment`, etc.), summarizes request/response shapes, keeps `ret`/`errmsg` and hashes, and records static endpoint string hints without signed URLs
- raw local output writes replay candidate JSON for `endpoint-probe`; only read/API-like endpoints are included by default, and risky replay candidates require `--includeRisky`
- proof bundle: `data/jimeng-lab/proof-20260610-capture-analyze-subject-create-v3/`
- latest proof analyzed 138 events / 27 requests into 5 ranked candidates and 1 safe replay candidate (`/mweb/v1/get_unread_count`); top ranked endpoint was upload/audit `/mweb/v1/imagex/submit_audit_job`, correctly not replay-safe by default

Discovery worklists are now available as the next token-efficient planning layer:

- `jimeng-browser-proxy discovery-worklist`
- offline; does not load a browser session, foreground UI, or spend generation quota
- input: one or more `capture-analyze` normalized analysis JSON files via `--analysis`, optional raw endpoint-probe candidate JSON via `--probeCandidates`, and optional source/bundle roots via `--staticRoot`
- useful flags: `--includeKnown` for audit views that include already-covered endpoints
- decodes analysis/probe JSON with permissive runtime schemas and emits a prioritized worklist of next API slices: replay/promote, capture request builder, compare dry-run before live, approval/disposable fixture, already-covered, or low-value/risky documentation
- writes normalized markdown/JSON summaries without raw probe bodies; raw per-endpoint replay variant files stay under ignored `data/**`
- proof bundle: `data/jimeng-lab/proof-20260610-discovery-worklist-subject-create-v3/`
- latest proof merged the subject-create capture analysis with static source hints into 18 work items, skipped 2 already-covered capture endpoints, exported 1 raw replay variant for `/mweb/v1/get_unread_count`, and highlighted the real next gaps: subject `generate_voice`, voice clone mutations, CapCut template row/search/collection payload capture, remaining `/mweb/v1/aigc_draft/generate` modes, and older agent/feed/workspace surfaces

Static request-builder localization is now available as the bridge between worklist and implementation:

- `jimeng-browser-proxy static-locate`
- offline; does not load a browser session, foreground UI, or spend generation quota
- input: endpoints via `--endpoint` or one or more `capture-analyze` normalized analysis JSON files via `--analysis`, plus source/bundle roots via `--staticRoot`
- useful flags: `--limit` for occurrences per endpoint, `--contextLines` for snippet size, `--symbol` for frontend request-builder names, and `--staticQuery` for arbitrary bundle/source search terms
- writes raw local snippets under ignored `data/**`
- writes normalized summaries with occurrence counts, files, redacted snippets, nearby symbol/identifier/string hints, and mise-managed `ast-grep` follow-up commands; normalized snippets redact URL query strings and credential-like assignments
- proof bundle: `data/jimeng-lab/proof-20260610-static-locate-subject-create/`
- latest proof used the subject-create capture analysis and local Jimeng client source, derived 4 API endpoints, found 16 local occurrences, and had no signed URLs or credentials in normalized output
- symbol-search proof bundle: `data/jimeng-lab/proof-20260610-static-locate-capcut-templates-symbols/`
- latest symbol-search proof searched CapCut template endpoints plus `SearchTemplates`, `GetTemplatesAccordCategory`, `GetBatchTemplatesByCategory`, `FuzzySearchTemplateByTitle`, `GetTemplateHotWords`, and `GetCategories`, found 24 occurrences, and had no signed URLs or credentials in normalized output

Lip-sync submit comparison is now available as the live-generation gate:

- `jimeng-browser-proxy lip-sync-compare`
- offline; does not load a browser session or foreground any UI
- input: a `lip-sync --dryRun` plan via `--plan`, plus captured UI submit evidence via `--rawNetwork`, `--captureDir`, or `--capture`
- extracts `/mweb/v1/aigc_draft/generate` requests, parses `draft_content.component_list[0].abilities.gen_video.text_to_video_params.video_gen_inputs[0]`, and compares it against `plan.providerInput.videoGenInputs`
- compares `text_to_video_params.model_req_key` against `plan.providerInput.modelReqKey`
- output reports path-level match/mismatch summaries and hashes/shape descriptors without raw media URL values
- proof bundle: `data/jimeng-lab/proof-20260610-lip-sync-compare-no-capture/`
- latest proof against the existing subject-create capture correctly returned `match=false`, `candidate_count=0`; next proof should use a real background CDP lip-sync UI submit capture

The next slice is **lip-sync submit capture and reference-video consumers**. Use the VOD provider reference, ImageX avatar reference, and frontend captures to unlock live lip-sync, reference-video, multimodal/all-around reference, pose/style/depth/canny controls, and live end-frame/multi-frame image-to-video paths.

Immediate next slices:

1. Capture frontend VOD and image/avatar lip-sync submits and compare the converted `draft_content` with the dry-run `providerInput`; enable live submit only if it matches.
2. Capture the frontend's explicit end-frame/multi-frame mode and live-prove `frames2video` only if the payload contract matches.
3. Map style/reference roles and the new object-mask provider references into generation payload patches.
4. Implement digital-human generation using the confirmed VOD reference path where applicable.
5. Capture real CapCut template row/search/collection payloads, then expand no-spend research/template coverage beyond the confirmed CapCut category and public metadata catalogs.
6. Capture/approve subject/persona `generate_voice` live submit and custom voice clone live submit/mutation once those UI/API flows are captured.
7. Keep each slice small enough to prove and commit before moving on.

Do not start the async daemon while these API contracts are still moving.

## Optimization Target

Maximize useful API coverage and proof quality while keeping live submissions controlled:

- generation submission concurrency is `1` for now
- polling, downloads, passive capture, and local processing can run in the background when safe
- default to background automation; do not foreground Arthur's browser, steal focus, or use visible UI automation while Arthur is using the machine unless he explicitly asks
- prefer direct Jimeng APIs, saved sessions, CDP network/DOM calls, CuaDriver/background browser-use, and other non-interruptive automation paths over `bringToFront`, visible tab clicks, or Computer Use interactions that move the active cursor/window
- if a frontend-only Jimeng flow truly requires visible UI interaction, first try to reproduce it through background CDP or CuaDriver; if that still cannot work, record the blocked path and ask before interrupting Arthur's flow
- for unknown frontend flows, prefer a faster hybrid reversal loop over long manual bundle reading or purely dynamic clicking: run background CDP/passive network capture first, use `ast-grep`/targeted structural search to locate the frontend request builder, then replay/compare the direct API request with saved session headers
- choose static or dynamic evidence by expected leverage, not ideology: use CDP/network truth for actual request bodies and response shapes, use stronger static tools for enum names, option semantics, request-builder branches, and dead-end avoidance
- promote the hybrid loop into tooling: CDP recorder for dynamic truth, `capture-analyze` for endpoint ranking, `discovery-worklist` for next-slice prioritization, `static-locate --symbol`/`--staticQuery` plus mise-managed `ast-grep` for request-builder semantics, `endpoint-probe` for explicit body replay, then dedicated schema-backed commands for stable contracts
- run `capture-analyze` after every meaningful `jimeng-network-recorder` capture, then run `discovery-worklist` before opening frontend bundles by hand
- use mise-managed developer CLIs such as `ast-grep` when available; install missing local CLIs with `mise` first unless the tool must be a repo/CI dependency
- validate external Jimeng/CapCut/provider JSON at the boundary with permissive runtime schemas; allow additive extra fields but fail clearly when relied-on response paths drift
- live generation prompts should be Chinese and in-distribution for the UGC use case
- test/proof prompts should generate actually useful Korean-beauty, UGC ad, persona, TikTok-profile, reference-upload, or campaign assets, not toy demos
- map the product's actual account/UI limits and encode them in docs/code
- document observed rate limits, VIP gates, risk gates, payload constraints, model options, option menus, and UI affordances
- expose meaningful API properties as flags so later pipelines can parameterize them; for large enum sets like voices or styles, prove one or two representative values rather than exhausting every individual item
- do not spam servers or brute-force controls
- do not commit cookies, raw captures, signed URLs, upload credentials, session bundles, or generated media

## Complete Enough Definition

For this project, "complete enough" means each useful API has enough surface area exposed that future pipelines can parameterize it without another frontend reverse-engineering pass.

That means:

- every independent property class gets represented as a CLI flag, typed option, or documented blocked field
- important mode switches are covered, such as text/image/video input source, duration, ratio, resolution, model version, seed, reference role, voice mode, character/persona id, template id, and upload source type
- enum-heavy fields do not need exhaustive live proof; list the catalog when available and prove one or two representative values
- option sets should be explored by property type and API behavior, not by burning quota on every cosmetic choice; for example, testing that voice selection is parameterized matters more than generating every voice
- gated, VIP, risk-blocked, or unclear options are still recorded with the exact UI path, trace evidence, and next probe
- request/response shapes that affect later automation get fixture or snapshot coverage
- live proof creates useful UGC/Korean-beauty/persona/campaign artifacts, not synthetic placeholder demos

## CLI Shape

Near-term CLI work should prioritize API coverage and proof over orchestration. Do **not** implement the daemon, background worker, full async job queue, or session-refresh scheduler until the high-value API surface is settled.

Current ownership:

- `jimeng-browser-proxy` is the user-facing front door for logged-in Jimeng/Dreamina work and should receive new commands by default.
- `jimeng-dreamina` is lower-level Dreamina-compatible plumbing from the earlier direct-client path. Keep it for compatibility tests, payload experiments, and shared helpers, but do not grow it into a second competing product CLI.
- Avoid creating more parallel CLIs. Prefer adding new commands to `jimeng-browser-proxy`, while reusing shared helpers underneath.
- Later cleanup can combine the two surfaces or make their relationship explicit enough that users never wonder which one to run. The target user experience is one obvious CLI surface.
- New user-facing docs and proof commands should prefer `jimeng-browser-proxy` unless the slice is explicitly testing compatibility with the older direct-client path.

Future async direction, deferred:

Default behavior after the daemon/job phase:

- submit returns a local job id
- command writes job JSON under `data/jimeng-lab/jobs/<job-id>/`
- raw provider responses and artifacts stay under ignored `data/**`
- stdout should be concise and machine-readable when `--json` is passed

Current blocking behavior:

- direct generation commands may block while submitting/polling/downloading, as long as concurrency is `1` and polling is bounded
- `--wait` or `--sync` can be introduced when the job model exists
- `--noDownload` submits/polls without downloading final media
- do not add daemon-only flags or lifecycle commands during the API catalog phase unless the command also works in the current blocking CLI model

Common flags:

- `--session <file>`
- `--capture <file>`
- `--outDir <dir>`
- `--json`
- `--dryRun`
- `--wait` / `--sync`
- `--noDownload`

Current and near-term commands:

```bash
jimeng-browser-proxy session
jimeng-browser-proxy catalog
jimeng-browser-proxy agent-catalog
jimeng-browser-proxy voices
jimeng-browser-proxy tts
jimeng-browser-proxy sample-voices
jimeng-browser-proxy upload-token
jimeng-browser-proxy upload-image
jimeng-browser-proxy subjects
jimeng-browser-proxy describe-image
jimeng-browser-proxy controlnet-preview
jimeng-browser-proxy object-mask
jimeng-browser-proxy text2image
jimeng-browser-proxy text2video
jimeng-browser-proxy image2video
jimeng-browser-proxy frames2video
jimeng-browser-proxy lip-sync
jimeng-browser-proxy lip-sync-compare
jimeng-browser-proxy voice-clone
jimeng-browser-proxy persona
jimeng-browser-proxy subject
jimeng-browser-proxy templates
jimeng-browser-proxy short-videos
jimeng-browser-proxy overseas-short-videos
jimeng-browser-proxy assets
jimeng-browser-proxy history-queue
jimeng-browser-proxy history-records
jimeng-browser-proxy capture-analyze
jimeng-browser-proxy discovery-worklist
jimeng-browser-proxy static-locate
jimeng-browser-proxy endpoint-probe
jimeng-browser-proxy video-info
jimeng-browser-proxy canvas
```

It is fine for commands to land progressively. Missing commands should be represented in the endpoint catalog as `unknown`, `captured`, `needs-live-proof`, or `blocked-*`.

## Proof Standard

For each implemented API:

- exact runnable command
- normalized JSON output
- typed helper and CLI command
- runtime schema/decoder for external JSON contracts, permissive to extra fields and strict for paths the CLI relies on
- automated tests close to `packages/jimeng-client/test/`
- snapshot or fixture-style tests where request/response shape matters
- redacted docs in `docs/provider/`
- QA/proof note in `docs/qa/`
- local proof bundle under ignored `data/**`
- command log or manifest that records the important commands needed to recreate artifacts
- git commit for the finished feature slice before moving to the next coherent API section

For media:

- audio: save MP3/WAV, validate file metadata, transcribe back with the available STT/internal transcription path when available, and compare transcript against the expected Chinese script
- video: save MP4, validate duration/resolution/codec, extract thumbnails or frames when useful, and record playable artifact paths
- image: save image, validate dimensions/content type, record prompt/options/model/provider URI
- if automated semantic validation is weak, still save the artifact and make it easy for Arthur to inspect

Proof prompts should be useful and in distribution. Avoid placeholder prompts like "make a test video." Prefer prompts that exercise the actual product:

```txt
韩系美妆达人自拍风格，干净卧室自然光，语气像真实 TikTok 种草视频，展示一款补水精华，前三秒有明确痛点钩子，无字幕，无水印，不要生成可读文字。
```

```txt
健身蛋白棒 UGC 广告，年轻女性创作者手持产品，对镜头自然介绍口感和低糖卖点，节奏像短视频开箱测评，画面真实手机拍摄感，无字幕，无水印。
```

## Checkpoint Rule

Work in feature slices. After finishing one coherent API section, stop and git checkpoint before moving to the next section.

A slice is checkpoint-ready only when:

- API contract is documented
- CLI command exists or the feature is explicitly documented as blocked/unknown
- tests pass for the helper/CLI contract
- live or dry-run proof exists as appropriate
- proof artifacts are saved locally under ignored `data/**`
- `TASKS.md` and relevant state/plan docs are updated
- important rerun commands are recorded in the QA note or proof manifest
- the feature slice has its own git commit

Dirty worktree rule:

- inspect `git status --short` before staging
- stage only files that belong to the current feature slice
- never revert unrelated user or generated changes while checkpointing this goal
- keep raw captures, cookies, credentials, signed URLs, and generated media under ignored `data/**`

Suggested slice order:

1. session/background proxy
2. text-to-image
3. voice catalog and TTS
4. upload-token
5. local ImageX image upload
6. image-to-video with uploaded first-frame URI
7. VOD/video upload
8. reference controls: pose, style, depth, canny, character/reference roles
9. lip-sync and digital-human generation
10. voice clone live submit/mutation and subject/persona voice generation
11. persona/subject/character lifecycle
12. templates, explore/feed mining, assets, canvas/editing, export utilities

## Discovery Order

1. Build and maintain the UI fuzzing and network capture harness.
2. Enumerate frontend API surface: image, video, image-to-video, reference upload, pose/reference controls, TTS, voice clone, lip-sync, persona/subject/character, templates, assets, canvas/editing, export.
3. Promote stable contracts into `packages/jimeng-client`.
4. Add CLI commands and flags for the useful API properties.
5. Add proof validators and useful Chinese UGC prompts.
6. Measure rate limits carefully and encode safe defaults.
7. Only after the API surface is stable, convert to daemon: queue, job ids, status, retries, rate limits, session refresh, artifact persistence, `submit/watch/cancel/inspect`.

## Endpoint Catalog Requirements

Maintain `docs/provider/jimeng-frontend-api-catalog.md` and `docs/provider/jimeng-direct-client-endpoints.md`.

Every discovered capability should have a status:

- `implemented`
- `captured`
- `needs-live-proof`
- `blocked-vip`
- `blocked-risk`
- `blocked-auth`
- `unknown`

Each endpoint entry should capture:

- endpoint path and method
- UI path that triggered it
- request shape
- response shape
- required session/header fields without raw secrets
- quota/risk behavior
- artifact extraction paths
- associated CLI command if implemented
- proof bundle path if live-proved

## Daemon Phase

After the CLI surface is stable, implement a daemon/orchestrator.

The daemon should:

- maintain one repo-local process per workspace
- own session refresh
- queue jobs
- enforce generation submission concurrency `1`
- separate rate limits for submission, polling, downloads, and capture
- retry with capped backoff only where safe
- persist status, request/response JSON, artifacts, logs, and normalized summaries
- support CLI commands like `submit`, `watch`, `cancel`, `inspect`, `tail`, `status`

The daemon is not the first milestone. The first milestone is a truthful, tested, artifact-proven CLI surface.

## Completion Harness

The long-running goal is complete only when:

```bash
bun run jimeng:typecheck
bun run jimeng:test
bun packages/jimeng-client/src/browser-proxy-cli.ts --help
```

all succeed, and:

- CLI help lists the implemented commands
- endpoint catalog is current
- every implemented generator has real proof artifacts
- every blocked/gated feature has evidence and next-step notes
- no raw cookies, session bundles, upload credentials, signed URLs, raw private captures, or generated media are committed
- each completed feature slice has its own git checkpoint before the next slice began
