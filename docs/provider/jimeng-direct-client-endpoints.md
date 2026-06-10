# Jimeng Direct Client Endpoint Spec (Fetch-first)

## Goal
Use browser session refresh as a separate step, then call Jimeng endpoints directly from local CLI/app via `fetch`.

## Two-step architecture

### Step A — Session refresh/capture (browser/extension/helper)
Capture and persist:
- `cookie` header string (required)
- `user-agent`
- `origin`
- `referer`
- optional: `xmst` (maps to msToken usage), `web_id`

Suggested local file:
- `data/jimeng-lab/raw/session-bundle.json`

### Step B — Direct API client (no Playwright)
Load session bundle and call endpoints with `fetch`.

---

## Official CLI capability inventory (2026-06-03)

Help-only inspection of the installed official `dreamina` CLI confirmed these generator commands are exposed locally:

- `text2image`
- `image2image`
- `text2video`
- `image2video`
- `frames2video`
- `multiframe2video`
- `multimodal2video`
- `image_upscale`

Important capability notes from help output:

- `image2video` uploads one local image automatically and treats ratio as inferred from the input image. Advanced controls expose `--duration`, `--video_resolution`, and `--model_version` with `3.0`, `3.0fast`, `3.0pro`, `3.5pro`, and `seedance2.0` variants.
- `multimodal2video` maps to Dreamina Web `全能参考` / all-around reference mode. It uploads local image/video/audio references automatically, requires at least one image or video, and supports Seedance 2.0 variants.
- `text2video` supports Seedance 2.0 variants, duration `4..15`, and ratios `1:1`, `3:4`, `16:9`, `4:3`, `9:16`, `21:9`.
- `text2image` supports model versions `3.0`, `3.1`, `4.0`, `4.1`, `4.5`, `4.6`, `5.0`.
- `image2image` supports 1-10 local input images and model versions `4.0`, `4.1`, `4.5`, `4.6`, `5.0`.
- All generation operations can consume credits. Some high-risk/content-safety model paths may require one-time Dreamina Web authorization (`AigcComplianceConfirmationRequired`).

---

## Endpoint catalog (confirmed)

### 1) Image submit (agent path, older)
- `POST https://jimeng.jianying.com/mweb/v1/creation_agent/v2/conversation`
- Request shape:
  - `conversation_id`
  - `messages[0].content.content_parts[0].text` = prompt
- Response type:
  - `text/event-stream`
- Follow-up:
  - parse stream for submit info, then poll `get_history_by_ids`
- current utility: `packages/jimeng-client/src/sse.ts` (`extractSubmitIdFromSseText`) for resilient submit-id extraction

### 2) Workbench submit (current image path and video path)
- `POST https://jimeng.jianying.com/mweb/v1/aigc_draft/generate`
- Shared request shape:
  - `submit_id`
  - `metrics_extra` (JSON string)
  - `draft_content` (JSON string)
  - `http_common_info.aid`
- Video prompt field location:
  - `draft_content.component_list[0].abilities.gen_video.text_to_video_params.video_gen_inputs[0].prompt`
- Video duration field location:
  - `...video_gen_inputs[0].duration_ms`
- First/last frame fields (if used):
  - `...video_gen_inputs[0].first_frame_image`
  - `...video_gen_inputs[0].end_frame_image`
- Image-to-video first-frame status:
  - implemented in `jimeng-browser-proxy image2video`
  - local `--image` uploads through ImageX scene `2`, then patches the resulting provider URI into `first_frame_image`
  - live proof saved under `data/jimeng-lab/proof-20260609-image2video-live/`
  - latest subscription-account direct API proof saved `data/jimeng-lab/proof-20260610-subscription-api-live-check/image2video/artifacts/6c83d6bd-d8f6-4b69-a6b9-1d05088312a3-00.mp4`
- Current text-to-image prompt field location:
  - `draft_content.component_list[0].abilities.generate.core_param.prompt`
- Current text-to-image model field observed:
  - `draft_content.component_list[0].abilities.generate.core_param.model = high_aes_general_v50`
- Current text-to-image output mode:
  - poll/list workspace assets via `get_asset_list`, not only `get_history_by_ids`

### 3) Poll status/results by submit id
- `POST https://jimeng.jianying.com/mweb/v1/get_history_by_ids`
- Implemented read-only lookup:
  - `jimeng-browser-proxy history-records`
  - uses schema-backed response decoding and URL-safe normalization
- Payload variants observed:
  - `{ "submit_ids": ["<submit_id>"] }`
  - `{ "submit_ids": ["<submit_id>"], "need_batch": true, "history_ids": [] }`
  - `{ "submit_ids": [], "need_batch": true, "history_ids": ["<history_id>"] }`
- Terminal success seen:
  - video: `status = 50`
  - image: `status = 45` (observed in earlier image path)
  - completed workbench image record: `status = 50`, `task.status = 50`
- Latest no-spend proof:
  - submit id `a6bbee65-bed0-4e5b-aaf1-5ab466137b82` returned history record `39148697060354`
  - history id `39148697060354` returned the same completed record
  - `generate_type=1`, `mode=workbench`, `model_req_key=high_aes_general_v50`, `model_name=图片5.0 Lite`, `seed=105719980`
  - `total_image_count=4`, `finished_image_count=4`, `item_count=4`
  - proof bundles `data/jimeng-lab/proof-20260610-history-records/` and `data/jimeng-lab/proof-20260610-history-records-by-history-id/`
  - normalized summaries omit signed image/video URLs and keep URL-presence booleans only

### 3.1) Resolve VOD metadata by vid
- `POST https://jimeng.jianying.com/mweb/v1/get_video_by_vid`
- Implemented read-only lookup:
  - `jimeng-browser-proxy video-info`
  - schema-backed response decoding and URL-safe normalization
- Confirmed wire body:

```json
{ "vids": ["v03870g10004d8k1u4nog65hb08dnhig"] }
```

- Negative proof:
  - `{ "vid": "v03870g10004d8k1u4nog65hb08dnhig" }` returned `ret=1000`, `errmsg=invalid parameter`
  - `{ "video_id": "..." }` and `{ "video_ids": ["..."] }` also returned `ret=1000`
- Latest no-spend proof:
  - `ret=0`, `errmsg=success`
  - `vid=v03870g10004d8k1u4nog65hb08dnhig`
  - `duration=5s`, `width=704`, `height=1248`, `fps=24`, `format=mp4`, `definition=720p`
  - `size_bytes=4285498`
  - `transcoded_definitions=["720p"]`
  - response hash `06ae536f69e703297f9cba1988665d0dcf4ad7c05bc117f79332931ec010a17d`
  - proof bundle `data/jimeng-lab/proof-20260610-video-info/`
  - normalized summary keeps `video_url_present` and `cover_url_present` booleans but omits signed URLs

### 4) Workspace asset list / current image polling
- `POST https://jimeng.jianying.com/mweb/v1/get_asset_list`
- Request shape observed:
  - `count`
  - `direction`
  - `mode`
  - `option`
  - `asset_type_list`
  - `workspace_id`
- Current text-to-image terminal success:
  - `data.asset_list[0].image.status = 50`
  - `data.asset_list[0].image.task.status = 50`
  - `data.asset_list[0].image.finished_image_count = data.asset_list[0].image.total_image_count`
- Artifact URL paths:
  - `data.asset_list[].image.item_list[].image.large_images[].image_url`
  - `data.asset_list[].image.item_list[].common_attr.cover_url_map.*`

### 5) Optional queue status
- `POST https://jimeng.jianying.com/mweb/v1/get_history_queue_info`
- Implemented as `jimeng-browser-proxy history-queue`.
- No-spend/read-only status probe for existing history ids.
- Frontend service takes camelCase `getHistoryQueueInfo({ historyIds })`, but the wire body must be snake_case:

```json
{ "history_ids": ["39148697060354"] }
```

- Negative proof: posting `historyIds` returned `ret=1000`, `errmsg=invalid parameter`.
- Latest proof returned:
  - `ret=0`, `errmsg=success`
  - `history_id=39148697060354`
  - `status=0`
  - `queue_status=3`
  - `queue_length=0`
  - `polling_interval_seconds=30`
  - `polling_timeout_seconds=86400`
  - proof bundle `data/jimeng-lab/proof-20260610-history-queue/`

### 6) Non-generating model/tool/persona/voice catalog
- `POST https://jimeng.jianying.com/mweb/v1/creation_agent/v2/skill/list`
- `POST https://jimeng.jianying.com/mweb/v1/creation_agent/v2/get_agent_config`
- `POST https://jimeng.jianying.com/mweb/v1/get_common_config`
- `POST https://jimeng.jianying.com/mweb/v1/get_user_local_item_list`
- `POST https://jimeng.jianying.com/mweb/v1/video_generate/get_common_config`
- `POST https://jimeng.jianying.com/mweb/v1/dreamina_subject/get`

Current utility:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts catalog \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --outDir data/jimeng-lab/cli-catalog-smoke
```

Validated endpoint ids:

- `skill-list`
- `agent-config`
- `voice-assets`
- `lip-sync-image-config`
- `lip-sync-video-config`
- `subject-list`

The agent skill/model subset now has a dedicated schema-backed command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts agent-catalog \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoints skills,config \
  --outDir data/jimeng-lab/proof-20260610-agent-catalog
```

Latest proof returned 4 official skills, 8 image models, and 5 video models. Normalized output records model request keys, image control feats, blend controls, resolution presets, frame/fps/aspect option enums, input media types, unified-edit material limits, max batch counts, compliance flags, and task-cancel support without signed URLs. High-value video input media types included `prompt`, `first_frame`, `end_frame`, `multi_frame`, and `unified_edit`.

The direct image model common-config subset also has a dedicated schema-backed command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts image-models \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --outDir data/jimeng-lab/proof-20260610-image-models
```

Request:

```json
{
  "isClientFilter": true,
  "needBetaModel": true
}
```

Query defaults:

```txt
needCache=true
needRefresh=false
```

Latest proof returned 8 image models, default index `0`, and first selected workbench model `high_aes_general_v50` / `图片5.0 Lite`. Normalized output records feature flags, blend controls, feature-config keys, resolution presets, sample-step bounds, commercial benefit/resource ids, model source, max batch count, compliance flags, and task-cancel support without signed URLs.

These probes are read/config/list calls and should not consume generation credits. They still require a live logged-in session bundle.

### 6.1) Saved subject/persona list
- `POST https://jimeng.jianying.com/mweb/v1/dreamina_subject/get`
- Status:
  - implemented as `jimeng-browser-proxy subjects`
  - no-generation/no-spend list path
  - live-proved with empty, non-empty, and subject-id filtered list shapes
- Request:

```json
{
  "cursor": 0,
  "limit": 20,
  "subject_id_list": ["14204993143308"]
}
```

Current utility:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts subjects \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 20 \
  --outDir data/jimeng-lab/proof-20260610-subjects-after-create
```

Proof facts:

```txt
http_status=200
ret=0
errmsg=success
subject_count=0
has_more=false
next_cursor=0
response_text_sha256=618858c54ed5d0b298cf37ed03bf29d27042f54e3e999bb143932cec6a3ef31f
summary=data/jimeng-lab/proof-20260610-subjects/normalized/subjects-20260609222826-summary.json
```

Later non-empty proof after `subject-create`:

```txt
subject_count=3
has_more=false
next_cursor=1781049529864
top_subject_id=12352249053442
top_subject_name=CLI Kbeauty UGC 2
response_text_sha256=27e7441c6bd27520df457685986694753e5a100657bc9e5c30f6c04e78a892a6
summary=data/jimeng-lab/proof-20260610-subjects-after-create/normalized/subjects-20260610002633-summary.json
```

Normalized item fields for future non-empty accounts:

```ts
interface JimengSubjectItem {
  subjectId: string
  name: string | null
  description: string | null
  status: number | null
  createTime: string | null
  updateTime: string | null
  coverImageUri: string | null
  coverImageUrl: string | null
  imageUris: string[]
  voiceIds: string[]
}
```

Normalized summaries redact signed cover URLs into a boolean presence field. Raw responses stay ignored under `data/**`.

### 6.2) Subject/persona create
- `POST https://jimeng.jianying.com/mweb/v1/dreamina_subject/create`
- Status:
  - implemented as `jimeng-browser-proxy subject-create`
  - no-generation/no-spend asset create path
  - live-proved with a local ImageX-uploaded persona reference image
- Supporting calls for local-image mode:
  - `/mweb/v1/get_upload_token` scene `2`
  - ImageX `ApplyImageUpload`
  - direct `POST /upload/v1/{StoreUri}`
  - ImageX `CommitImageUpload`
  - `/mweb/v1/imagex/submit_audit_job`
  - `/mweb/v1/get_image_by_uri`
- Request:

```json
{
  "content": {
    "name": "CLI Kbeauty UGC 2",
    "description": "韩系美妆健身UGC创作者，真实手机自拍参考图。",
    "main_image": {
      "width": 2048,
      "height": 2048,
      "image_uri": "tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png",
      "image_url": "<signed preview url>"
    }
  },
  "workspace_id": 14199856180236
}
```

Current utility:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts subject-create \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --workspaceId 14199856180236 \
  --name "CLI Kbeauty UGC 2" \
  --description "韩系美妆健身UGC创作者，真实手机自拍参考图。" \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --outDir data/jimeng-lab/proof-20260610-subject-create-cli
```

Proof facts:

```txt
http_status=200
ret=0
errmsg=success
subject_id=12352249053442
data_id=12352249053698
main_image_uri=tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png
main_image_size=2048x2048
summary_sha256=52a8d7ba8acf00de72912228a5d1ab1ea0d96edea5adf8be44744d2092258dec
summary=data/jimeng-lab/proof-20260610-subject-create-cli/normalized/subject-create-20260610001348-mm0zq8-summary.json
```

Normalized summaries replace signed media URLs with presence booleans or `[SIGNED_URL_REDACTED]`. Raw upload, lookup, and create responses stay ignored under `data/**`.

### 6.3) Subject/persona update/delete and voice-generation planning
- `POST https://jimeng.jianying.com/mweb/v1/dreamina_subject/update`
- `POST https://jimeng.jianying.com/mweb/v1/dreamina_subject/delete`
- `POST https://jimeng.jianying.com/mweb/v1/dreamina_subject/generate_voice`
- Status:
  - `subject-update` implemented and live-proved on a temporary subject
  - `subject-delete` implemented and live-proved on the same temporary subject
  - `subject-generate-voice` dry-run request planning implemented; live submit disabled pending explicit spend approval or captured UI submit
- Frontend bundle evidence:
  - repo service calls `updateSubject({subjectId, content})`
  - repo service calls `deleteSubject({subjectId})` or batch `deleteSubjects({subjectIdList})`
  - repo service calls `generateSubjectVoice({imageUri})`

Update request:

```json
{
  "subject_id": "14204993143308",
  "content": {
    "name": "CLI QA Updated",
    "description": "临时主体：update命令已验证，随后删除。",
    "main_image": {
      "width": 2048,
      "height": 2048,
      "image_uri": "tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png",
      "image_url": "<signed preview url>"
    }
  }
}
```

Delete request:

```json
{
  "subject_id": "14204993143308"
}
```

Generate-voice dry-run request:

```json
{
  "image_uri": "tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png"
}
```

Proof facts:

```txt
proof=data/jimeng-lab/proof-20260610-subject-lifecycle/
created_subject_id=14204993143308
created_data_id=14204993143564
update_ret=0
update_errmsg=success
update_response_text_sha256=47168986f6e80a31c8f169afdb19755b4a08895f496292e988e6f1d88b6152c2
delete_ret=0
delete_errmsg=success
delete_response_text_sha256=8cc3d46d8dec2d339dc0e7fe2d338f0ac4946752fc276a0f9a508bcb7c1f52f8
post_delete_filtered_subject_count=0
subject_voice_plan=data/jimeng-lab/proof-20260610-subject-lifecycle/raw/subject-generate-voice-20260610003459-kj65qh-dry-run-plan.json
```

### 7) Built-in voice library
- `POST https://jimeng.jianying.com/mweb/v1/feed`
- Request source:
  - replay a captured, signed frontend request whose body includes `dreamina_tone`
  - default capture path currently used by CLI:

```txt
data/jimeng-captures/20260603090356-home-session-smoke/capture-template.raw.json
```

Current utility:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts voices \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-captures/20260603090356-home-session-smoke/capture-template.raw.json \
  --outDir data/jimeng-lab/cli-voices-smoke
```

Current normalized item shape:

```ts
interface JimengVoiceCatalogItem {
  id: string
  title: string
  itemPlatform: number
  effectType: number | null
  lokiEffectId: string | null
  speakerId: string | null
  tags: Array<{ type: string; value: string }>
  emotions: Array<{ emotion: string; speakerId: string }>
}
```

Latest live replay found 142 built-in voices. First known sample:

```txt
title: 直爽女大
id: 7597003459665072686
speaker_id: saturn_6967e2f6bd5f2b43
```

### 8) Text-to-speech
- `POST https://jimeng.jianying.com/mweb/v1/tts_generate`
- Response:
  - `data.data` is base64 MP3
  - smoke artifact validated as 24 kHz mono MP3

Request body:

```json
{
  "text": "这条视频值得试一下。",
  "id_info": {
    "id": "7597003459665072686",
    "item_platform": 1
  },
  "audio_config": {
    "format": "mp3",
    "pitch_rate": 0,
    "sample_rate": 24000,
    "speech_rate": 0
  }
}
```

One voice sample:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts tts \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --voice-id 7597003459665072686 \
  --voice-title '直爽女大' \
  --text '这条视频值得试一下。' \
  --outDir data/jimeng-lab/cli-tts-smoke
```

Sequential library sampling:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts sample-voices \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-captures/20260603090356-home-session-smoke/capture-template.raw.json \
  --text '这条视频值得试一下。' \
  --limit 2 \
  --outDir data/jimeng-lab/cli-sample-voices-smoke
```

Full current proof run generated 142/142 MP3s under ignored:

```txt
data/jimeng-lab/voice-library-samples/artifacts/
data/jimeng-lab/voice-library-samples/manifest.json
```

### 9) Discovered voice/persona/canvas endpoints needing flow captures

Frontend bundle scan found these UGC-useful groups, but they are not yet direct-client contracts:

- voice clone/custom voice: `/mweb/v1/voice/submit_task`, `/mweb/v1/voice/query_task`, `/mweb/v1/voice/update`, `/mweb/v1/voice/delete`
- subject/persona CRUD and voice: `/mweb/v1/dreamina_subject/get`, `/mweb/v1/dreamina_subject/create`, `/mweb/v1/dreamina_subject/update`, `/mweb/v1/dreamina_subject/delete`, `/mweb/v1/dreamina_subject/generate_voice`; list/create/update/delete are implemented, while generate_voice is dry-run-only until explicit spend approval or UI capture
- infinite canvas: `/mweb/v1/infinite_canvas/create_project`, `/mweb/v1/infinite_canvas/conversation`, `/mweb/v1/infinite_canvas/edit`, `/mweb/v1/infinite_canvas/resume`, `/mweb/v1/infinite_canvas/stop_stream`, `/mweb/v1/infinite_canvas/v1/fetch_snapshot`, `/mweb/v1/infinite_canvas/v1/submit_changeset`, `/mweb/v1/infinite_canvas/v1/fetch_changeset`
- reference/image tools: `/mweb/v1/get_common_config`, `/mweb/v1/get_image_description`, `/mweb/v1/get_upload_token`, `/mweb/v1/face_recognize`, `/mweb/v1/blend_preview`, `/mweb/v1/pose_detect`, `/mweb/v1/saliency_seg`, `/mweb/v1/algo_proxy`; image model common config is implemented as `image-models`; upload, description, face recognition, ControlNet pose/depth/canny preview, pose detect, and object/saliency segmentation are now direct-client commands, while style/reference payload tools remain capture targets
- template/research mining: `/mweb/v1/feed`, `/mweb/v1/get_explore`, `/mweb/v1/feed_short_video`, `/lv/v1/cc_web/plane/get_categories`, public CapCut `bee_prod` metadata JSON, `/lv/v1/cc_web/replicate/search_templates`, `/lv/v1/cc_web/plane/*`; direct `/mweb/v1/get_explore` support is implemented for both templates and short-video examples, `/mweb/v1/feed_short_video` is implemented as `overseas-short-videos`, CapCut category catalog is implemented as `capcut-categories`, CapCut collection/row/detail browsing is implemented as `capcut-collections`, `capcut-collection-templates`, and `capcut-template-detail`, and public CapCut ratio/scene metadata is implemented as `capcut-template-metadata`; CapCut search, batch, and preset payloads still need real UI capture

Next step is to drive those UI flows one at a time with background CDP recording, then create dry-run patchers before live calls.

### 9.1) ControlNet reference preview
- `POST https://jimeng.jianying.com/mweb/v1/blend_preview`
- `POST https://jimeng.jianying.com/mweb/v1/pose_detect`
- Status:
  - implemented as `jimeng-browser-proxy controlnet-preview`
  - no-generation/no-spend preview path
  - pose live-proved with local ImageX upload, preview-image download, and pose-detect response
  - depth and canny live-proved with local ImageX upload and preview-image download
- Frontend constants:
  - `model = img2img_xl_sft`
  - `ability.name = control_net`
  - `control_net_list[].name = pose | depth | canny`
  - frontend slider default `60`, serialized strength `0.6`
  - save patch fit modes `center_crop | adapt_to_canvas`

Preview request:

```json
{
  "model": "img2img_xl_sft",
  "ability": {
    "name": "control_net",
    "image_uri_list": ["tos-cn-i-tb4s082cfz/..."],
    "control_net_list": [
      { "name": "pose", "strength": 0.6, "image_index": 0 }
    ]
  }
}
```

Pose-detect request:

```json
{ "uri": "tos-cn-i-tb4s082cfz/..." }
```

The helper also records the frontend save-param shape for later generation payload patching:

```json
{
  "model": {
    "abilityName": "control_net",
    "controlNet": {
      "name": "pose",
      "strength": 0.6,
      "imageIndex": 0,
      "pose": {
        "image": {},
        "originImage": { "imageUri": "tos-cn-i-tb4s082cfz/...", "imageUrl": "" },
        "previewImage": { "imageUri": "tos-cn-i-tb4s082cfz/...", "imageUrl": "" }
      }
    },
    "extra": { "name": "pose", "fitMode": "center_crop", "imageIndex": 0 }
  }
}
```

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts controlnet-preview \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --control pose \
  --outDir data/jimeng-lab/proof-20260610-controlnet-pose-preview
```

Observed safe summary:

```txt
pose:
image_uri=tos-cn-i-tb4s082cfz/2cb5efccab014a29b171719f4303cb21.png
preview_image_uri=tos-cn-i-tb4s082cfz/222b232061324073accaf7992ec3ad87
pose_detected=true
preview_artifact=data/jimeng-lab/proof-20260610-controlnet-pose-preview/artifacts/controlnet-preview-20260609162825-rvn7f6-pose-preview.png
preview_png=1024x1024
summary=data/jimeng-lab/proof-20260610-controlnet-pose-preview/normalized/controlnet-preview-20260609162825-rvn7f6-summary.json

depth:
preview_image_uri=tos-cn-i-tb4s082cfz/df194e1d74a54982ae5ceb151e239c9c
preview_artifact=data/jimeng-lab/proof-20260610-controlnet-depth-preview/artifacts/controlnet-preview-20260609163638-wworll-depth-preview.png
preview_png=1024x1024
summary=data/jimeng-lab/proof-20260610-controlnet-depth-preview/normalized/controlnet-preview-20260609163638-wworll-summary.json

canny:
preview_image_uri=tos-cn-i-tb4s082cfz/915b0cd6c0c943fc9ab24b5c12e5a26d
preview_artifact=data/jimeng-lab/proof-20260610-controlnet-canny-preview/artifacts/controlnet-preview-20260609163709-xrv4zg-canny-preview.png
preview_png=1024x1024
summary=data/jimeng-lab/proof-20260610-controlnet-canny-preview/normalized/controlnet-preview-20260609163709-xrv4zg-summary.json
```

Raw responses may contain signed preview URLs and upload traces; keep them under ignored `data/**`.

### 9.2) Object/saliency segmentation
- `POST https://jimeng.jianying.com/mweb/v1/saliency_seg`
- Status:
  - implemented as `jimeng-browser-proxy object-mask`
  - no-generation/no-spend reference-image mask path
  - canvas and default modes live-proved with local ImageX upload and mask PNG downloads
- Frontend evidence:
  - canvas request originates as `getSaliencySEG({ imageUriList: [image], mode: "canvas" }, babiParam)`
  - default request originates as `getSaliencySEG({ imageUriList: [image] }, babiParam)`
  - `ret=2046` is treated by the frontend as `NoSegmentObjectFoundError`
  - `ret=2047` is treated by the frontend as `SegmentFailedError`

Direct request shapes:

```json
{ "image_uri_list": ["tos-cn-i-tb4s082cfz/..."], "mode": "canvas" }
```

```json
{ "image_uri_list": ["tos-cn-i-tb4s082cfz/..."] }
```

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts object-mask \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --mode both \
  --outDir data/jimeng-lab/proof-20260610-object-mask
```

Observed safe summary:

```txt
image_uri=tos-cn-i-tb4s082cfz/080999a077994629bbec76c6f344a09a.png
canvas_mask_uri=tos-cn-i-tb4s082cfz/2b0258d421f14b02b6f20a23eeaae0ec
canvas_artifact=data/jimeng-lab/proof-20260610-object-mask/artifacts/object-mask-20260609165112-8yjxpj-canvas-mask-01.png
canvas_png=2048x2048 RGBA
default_mask_uri=tos-cn-i-tb4s082cfz/d6641d59e6de4d17be119c0b98506129
default_artifact=data/jimeng-lab/proof-20260610-object-mask/artifacts/object-mask-20260609165112-8yjxpj-default-mask-01.png
default_png=2048x2048 RGBA
summary=data/jimeng-lab/proof-20260610-object-mask/normalized/object-mask-20260609165112-8yjxpj-summary.json
```

Raw responses may contain signed mask URLs and upload traces; keep them under ignored `data/**`.

### 10) Explore/template mining
- `POST https://jimeng.jianying.com/mweb/v1/get_explore`
- Status:
  - live-proved without generation spend
  - implemented as `jimeng-browser-proxy templates`
  - typed parser in `packages/jimeng-client/src/explore.ts`
  - tests in `packages/jimeng-client/test/explore.test.ts`
- Request controls:
  - `--limit <n>` maps to `count`
  - `--offset <n>` maps to `offset`
  - `--category-id <n>` maps to `category_id` (current proof uses `11222`)
  - `--work-types image,video,canvas` maps to `filter.work_type_list`
  - `--feed-refer <value>` maps to `feed_refer`

Request:

```json
{
  "count": 5,
  "filter": {
    "work_type_list": ["image", "video", "canvas"]
  },
  "offset": 0,
  "image_info": {
    "width": 2048,
    "height": 2048,
    "format": "webp",
    "image_scene_list": [
      { "scene": "smart_crop", "width": 360, "height": 360, "format": "webp", "uniq_key": "smart_crop-w:360-h:360" },
      { "scene": "normal", "width": 2048, "height": 2048, "format": "webp", "uniq_key": "2048" }
    ]
  },
  "category_id": 11222,
  "feed_refer": "feed_refresh"
}
```

Normalized fields:

```txt
id
templateType
aiFeature
featureTypes
usageNum / favoriteNum / playNum
coverUrl / coverWidth / coverHeight / aspectRatio
draftUri / draftVersion
prompt
modelReqKey
seed
imageRatio
metadataEffectId / metadataEffectType
```

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts templates \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 5 \
  --category-id 11222 \
  --work-types image,video,canvas \
  --outDir data/jimeng-lab/proof-20260610-templates-explore
```

Observed safe summary:

```txt
http_status=200
ret=0
errmsg=success
requested_count=5
returned_total=40
next_offset=5
category_id=11222
by_template_type.image=40
by_ai_feature.text_generate_image=40
raw=data/jimeng-lab/proof-20260610-templates-explore/raw/templates-20260609151716.json
summary=data/jimeng-lab/proof-20260610-templates-explore/normalized/templates-20260609151716-summary.json
```

Quirk: Jimeng returned 40 items even though the request sent `count=5`, but it set `next_offset=5`. Treat `count` as a paging hint and keep downstream caps client-side.

### 10.1) Short-video Explore reference mining
- `POST https://jimeng.jianying.com/mweb/v1/get_explore`
- Status:
  - live-proved without generation spend
  - implemented as `jimeng-browser-proxy short-videos`
  - reuses `packages/jimeng-client/src/explore.ts`
- Request controls:
  - `--limit <n>` maps to `count`
  - `--offset <n>` maps to `offset`
  - `--category-id <n>` maps to `category_id`
  - `--feed-refer <value>` maps to `feed_refer`; default is `feed_enterauto` for offset `0` and `feed_loadmore` for later pages
  - `filter.work_type_list` is fixed to `["short_video"]`

Request:

```json
{
  "count": 5,
  "filter": {
    "work_type_list": ["short_video"]
  },
  "offset": 0,
  "image_info": {
    "width": 2048,
    "height": 2048,
    "format": "webp"
  },
  "category_id": 11222,
  "feed_refer": "feed_enterauto"
}
```

Normalized fields:

```txt
id / effectId / effectType
metadataEffectId / metadataEffectType
title / description
playNum / favoriteNum / commentNum / shareNum
videoId
videoDurationSec / videoDurationMs
videoWidth / videoHeight / videoFps
videoDefinition / videoFormat / videoCodec / videoSize
videoHasAudio / videoIsMute
transcodedDefinitions
```

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts short-videos \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 5 \
  --category-id 11222 \
  --outDir data/jimeng-lab/proof-20260610-short-videos-explore
```

Observed safe summary:

```txt
http_status=200
ret=0
errmsg=success
requested_count=5
returned_total=20
next_offset=5
category_id=11222
top_by_play[0].play_num=1718727
top_by_play[0].duration_sec=85
top_by_play[0].resolution=1280x720
top_by_play[0].transcoded_definitions=360p,480p,720p
raw=data/jimeng-lab/proof-20260610-short-videos-explore/raw/short-videos-20260609153530.json
summary=data/jimeng-lab/proof-20260610-short-videos-explore/normalized/short-videos-20260609153530-summary.json
```

The raw response contains signed media URLs. Keep raw and normalized proof outputs under ignored `data/**`; tracked docs should only include durable metadata and hashes.

### 10.2) Overseas short-video feed reference mining
- `POST https://jimeng.jianying.com/mweb/v1/feed_short_video`
- Status:
  - live-proved without generation spend
  - implemented as `jimeng-browser-proxy overseas-short-videos`
  - reuses `packages/jimeng-client/src/explore.ts`
  - parser accepts both the live snake_case response shape and the camelCase frontend/domain model shape
- Request controls:
  - `--limit <n>` maps to `count`
  - `--offset <n>` maps to `offset`
  - `--category-id <n>` maps to `category_id`
  - `--feed-refer <value>` maps to `feed_refer`; default is `feed_enterauto` for offset `0` and `feed_loadmore` for later pages
  - `filter.work_type_list` is fixed to `["short_video"]`

Frontend bundle evidence:

```txt
GET_OVERSEAS_SHORT_VIDEO="/mweb/v1/feed_short_video"
queryParams={ imageInfo, categoryId, count:20, feedRefer:"feed_enterauto", filter:{ workTypeList:["short_video"] } }
```

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts overseas-short-videos \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 5 \
  --category-id 11222 \
  --outDir data/jimeng-lab/proof-20260610-overseas-short-videos
```

Observed safe summary:

```txt
http_status=200
ret=0
errmsg=success
requested_count=5
returned_total=4
next_offset=5
category_id=11222
top_by_play[0].play_num=2382533
top_by_play[0].duration_sec=57
top_by_play[0].resolution=3840x2160
top_by_play[0].fps=30
top_by_play[0].transcoded_definitions=360p,480p,720p,1080p
response_text_sha256=dc3ef47f5dd45b9f2681da88f502f39f3ce0ac2b512259f375d70665f63c0487
raw=data/jimeng-lab/proof-20260610-overseas-short-videos/raw/overseas-short-videos-20260609224456.json
summary=data/jimeng-lab/proof-20260610-overseas-short-videos/normalized/overseas-short-videos-20260609224456-summary.json
```

Raw responses contain signed media URLs. Normalized item lists redact signed cover URLs to `coverUrlPresent` while keeping durable cover dimensions and video/ranking metadata.

### 10.3) CapCut commercial template categories
- `POST https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_categories`
- Status:
  - live-proved without generation spend
  - implemented as `jimeng-browser-proxy capcut-categories`
  - uses the CapCut frontend request signer found in `data/jimeng-lab/js-sweep/files/9111.65b2a25f8b.js`
  - no CapCut cookies were required in the current proof
- Request controls:
  - `--capcut-lan <value>` maps to signed request header `lan` (default `en`)
  - `--capcut-loc <value>` maps to signed request header `loc` (default `us`)
  - body is currently fixed to `{ "sdk_version": "16.1.0" }`

Frontend bundle evidence:

```txt
GetBatchCategories="/lv/v1/cc_web/plane/get_categories"
body={sdk_version:"16.1.0"}
sign=md5("9e2c|"+pathname.slice(-7)+"|7|5.8.0|"+deviceTime+"||11ac")
```

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-categories \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --outDir data/jimeng-lab/proof-20260610-capcut-categories
```

Observed safe summary:

```txt
http_status=200
ret=0
errmsg=success
category_count=8
categories=Black Friday, Clothing and shoes, Cosmetic dailyization, Food beverages, Jewelry, Furniture, Consumer electronics, pets
response_text_sha256=27f4e1bc5a3ff2ddf94568b77d068db828807ab3aa12be3c484588b1b4ff3ea0
raw=data/jimeng-lab/proof-20260610-capcut-categories/raw/capcut-categories-20260609230631.json
summary=data/jimeng-lab/proof-20260610-capcut-categories/normalized/capcut-categories-20260609230631-summary.json
```

### 10.4) CapCut template collections, rows, and detail
- `POST https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_collections`
- `POST https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_collection_templates`
- `POST https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_template_detail`
- Status:
  - live-proved without generation spend
  - implemented as `jimeng-browser-proxy capcut-collections`, `capcut-collection-templates`, and `capcut-template-detail`
  - uses the same recovered CapCut frontend request signer as `capcut-categories`
  - no Jimeng or CapCut cookies were required in the current proof
- Request controls:
  - `--collection-id <n>` maps to the stable row-list body field `id`
  - `--template-id <id>` must be the string template `web_id`, not the rounded numeric `id`
  - `--limit`, `--cursor`, `--capcut-lan`, and `--capcut-loc` cover row pagination and signed request locale headers
  - `--needDraft` is supported for detail requests but the current safe proof used `need_draft:false`

Frontend bundle evidence:

```txt
GetCategories="/lv/v1/cc_web/plane/get_collections"
GetTemplatesAccordCategory="/lv/v1/cc_web/plane/get_collection_templates"
GetTemplateDetail="/lv/v1/cc_web/plane/get_template_detail"
getTemplateAccordCategory(e) injects {sdk_version, enter_from:"feed", count:20, lang}, then spreads e
getTemplateDetail(e) sends template_id:e.templateId and need_draft:e.needDraft
```

CLI proof:

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

Observed safe summary:

```txt
collections: http_status=200 ret=0 collection_count=35
collection_templates: http_status=200 ret=0 collection_id=10034 template_count=5 has_more=true cursor=5
first_template_web_id=7369116096600771846
first_template_canvas=1200x628
first_template_tags=beauty & personal care,Promotion1/New discount,Social media/Facebook,simple
template_detail: http_status=200 ret=0 template_id=7369116096600771846 template_url_present=true template_version=1.4.3
template_detail_material_counts=effects:8,local_images:4,file_infos:1
raw=data/jimeng-lab/proof-20260610-capcut-{collections,collection-templates,template-detail}/raw/
summary=data/jimeng-lab/proof-20260610-capcut-{collections,collection-templates,template-detail}/normalized/
normalized_outputs_have_no_signed_urls_or_credentials=true
```

### 10.5) CapCut public template ratio and scene metadata
- `GET https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_49/bee_prod_49_bee_publish_709.json`
- `GET https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_149/bee_prod_149_bee_publish_835.json`
- Status:
  - live-proved without generation spend
  - implemented as `jimeng-browser-proxy capcut-template-metadata`
  - public static JSON; no Jimeng or CapCut session is required
  - frontend bundle evidence: `GetAllTemplateRatio` and `GetTemplateScenes` concatenate `k.U8.mercury` with the two `bee_prod` paths; `k.U8.mercury` resolves to `https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod`

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-template-metadata \
  --outDir data/jimeng-lab/proof-20260610-capcut-template-metadata
```

Observed safe summary:

```txt
ratio_count=6
scene_count=33
ratios_response_text_sha256=18b2d8e274f0a129fdbec437f5c9b28a2cfad89dd94807d63efb4325ed5ace41
scenes_response_text_sha256=aa409da2647ee22a9025d17835055ffd34450b1c07783ea54a1909fa367e286d
first_scenes=Instagram post:1080x1080 | Instagram story:1080x1920 | Instagram portrait:1080x1350 | Tiktok:1080x1920 | YouTube thumbnail:1280x720 | YouTube intro:1920x1080 | YouTube end screen:1920x1080 | Facebook post:940x788
raw=data/jimeng-lab/proof-20260610-capcut-template-metadata/raw/capcut-template-metadata-20260609231824.json
summary=data/jimeng-lab/proof-20260610-capcut-template-metadata/normalized/capcut-template-metadata-20260609231824-summary.json
```

Remaining CapCut template endpoints are discovered and method-level request builders are recovered, but not implemented as stable search/preset/batch commands:

- `/lv/v1/cc_web/replicate/search_templates`
  - frontend method: `searchTemplates(e)`
  - maps `sdkVersion`, `searchId`, `enterFrom`, `categoryIds`, `sceneId`, `featureKey`, `colors`, and `graphNum` into snake_case API fields, then spreads remaining `e` fields into the body
  - blocked: signed no-spend probes returned `ret=1000 param error` across 10 recovered keyword/category/search-id variants; capture the actual UI call before exposing it
- `/lv/v1/cc_web/plane/batch_get_collection_templates`
  - frontend method: `getBatchTemplatesByCategory(e)`
  - passes `e` through directly and expects an array response with per-category `item_list`
  - blocked: signed no-spend probes returned `ret=1000 param error` across 15 object/list/nested collection variants
- `/lv/v1/cc_web/plane/get_collection_presets`
  - frontend method: `getPresets(e)`
  - blocked: signed no-spend probes using confirmed collection ids returned `ret=1015 check login error` across 8 variants; capture a real preset UI call and auth/header context before exposing it
- `/lv/v1/cc_web/plane/preset_template_detail`
  - frontend method: `presetTemplateDetail(e)`
  - blocked: needs a real preset id from a successful presets response or UI call; current presets listing is blocked
- `/lv/v1/cc_web/plane/fuzzy_search_templates`
  - frontend method: `fuzzySearchTemplateByTitle(e)`
  - passes `e` through directly and expects `data.item_list`
  - blocked: accepted direct no-spend POSTs but returned empty lists for guessed keyword/title bodies; capture a non-empty UI call before claiming useful template search

Method-level static proof:

```txt
proof=data/jimeng-lab/proof-20260610-static-locate-capcut-methods/
summary=data/jimeng-lab/proof-20260610-static-locate-capcut-methods/normalized/static-locate-20260610042935-summary.json
terms=searchTemplates,getTemplateAccordCategory,getBatchTemplatesByCategory,fuzzySearchTemplateByTitle,getTemplateHotWords
occurrences=10
normalized_static_locate_capcut_method_proof_has_no_signed_urls_or_credentials=true
```

### 10.6) CapCut signed endpoint probe
- `jimeng-browser-proxy capcut-probe`
- Status:
  - implemented as a session-free no-spend probe tool for the remaining CapCut row/search endpoints
  - guarded to `https://edit-api-sg.capcut.com/lv/v1/cc_web/*`
  - signs each replay with the recovered frontend CapCut signer
  - writes raw variant bodies/responses under ignored `data/**`
  - writes normalized shape summaries without signed URL values

Useful flags:

```txt
--endpoint <path|url>
--body <json>
--variants <json|file>
--method <GET|POST>
--capcut-lan <value>
--capcut-loc <value>
--dryRun
```

Live no-spend proof commands:

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

Current proof facts:

```txt
hot_words: body -> ret=0 errmsg=success response_sha=b442e8144ac7..., but data only contained region metadata
fuzzy_search_templates: keyword-en/keyword-zh/title-en -> ret=0 errmsg=success, but item_list length 0
get_collection_templates: old category_id/collection_id/category_ids guesses -> ret=1000 errmsg="param error"; superseded by confirmed body field id:<collectionId>
search_templates: keyword/search_word/query -> ret=1000 errmsg="param error"
batch_get_collection_templates: 15 object/list/nested collection variants -> ret=1000 errmsg="param error"
get_collection_presets: 8 confirmed-collection variants -> ret=1015 errmsg="check login error"
blocked_refresh_proofs=data/jimeng-lab/proof-20260610-capcut-probe-batch-collection-templates*,data/jimeng-lab/proof-20260610-capcut-probe-search-templates-v2,data/jimeng-lab/proof-20260610-capcut-probe-presets-confirmed-collection
normalized_capcut_probe_proofs_have_no_signed_urls_or_credentials=true
```

Follow-up no-spend variants for `/lv/v1/cc_web/replicate/get_search_words` with `{}`, `sdk_version`, locale, scene, and category bodies also returned only `{"region":"AU"}`. The endpoint is now classified as blocked/probed-metadata-only until a real UI call returns search terms.

### 11) Upload token for local reference media
- `POST https://jimeng.jianying.com/mweb/v1/get_upload_token`
- Status:
  - live-proved for scenes `1`, `2`, and `3`
  - implemented as `jimeng-browser-proxy upload-token`
- Request:

```json
{ "scene": 2 }
```

Observed scene mapping:

| scene | frontend use | response space observed |
|---:|---|---|
| `1` | video/VOD upload token | `dreamina` |
| `2` | image/ImageX upload token | `tb4s082cfz` |
| `3` | file/audio-like upload token | `jj1ywxzpdk` |

Safe summary fields:

```ts
interface JimengUploadTokenSummary {
  scene: 1 | 2 | 3
  region: string | null
  spaceName: string | null
  uploadDomainPresent: boolean
  accessKeyPresent: boolean
  secretKeyPresent: boolean
  sessionTokenPresent: boolean
  expiredTimePresent: boolean
  currentTimePresent: boolean
  dataKeys: string[]
}
```

CLI proof:

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
spaceName=tb4s082cfz
region=cn
```

The raw response includes temporary upload credentials and must not be committed. Store it only under ignored `data/**`.

The `/lv/v1/asset/prepare_upload_cloud` endpoint appears in frontend bundles but returned `404` from the Jimeng domain with a straightforward replay body; it may belong to a CapCut/LV asset domain or require signed LV headers. Do not depend on it for the Jimeng direct-client path yet.

### 12) Local image upload to ImageX provider URI
- Status:
  - live-proved with `jimeng-browser-proxy upload-image`
  - implemented in `packages/jimeng-client/src/upload.ts`
  - tested with deterministic AWS4 signer and mocked token/apply/upload/commit sequence
- Provider sequence:

```txt
POST /mweb/v1/get_upload_token { "scene": 2 }
GET  https://imagex.bytedanceapi.com/?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=tb4s082cfz&UploadNum=1&FileExtension=.png&s=<random>
POST https://{UploadHosts[0]}/upload/v1/{StoreUri}
POST https://imagex.bytedanceapi.com/?Action=CommitImageUpload&Version=2018-08-01&ServiceId=tb4s082cfz
```

Confirmed signer:

```txt
algorithm: AWS4-HMAC-SHA256
date header: X-Amz-Date
token header: x-amz-security-token
scope: YYYYMMDD/cn-north-1/imagex/aws4_request
signed headers for apply: x-amz-date;x-amz-security-token
```

Direct upload headers:

```txt
Authorization: StoreInfos[0].Auth
Content-CRC32: <crc32 hex of bytes>
X-Storage-U: <encoded user id, empty string works in current proof>
```

Commit body:

```json
{ "SessionKey": "<UploadAddress.SessionKey>" }
```

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts upload-image \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --file data/jimeng-lab/image-upload-probe/aws4-live/proof-1x1.png \
  --outDir data/jimeng-lab/proof-20260609-image-upload
```

Observed safe summary:

```txt
imageUris[0]=tos-cn-i-tb4s082cfz/97c32453461a4041b4f6e20f1dc0a517.png
uploadStatus=200
uploadCrc32=9050a959
ImageWidth=1
ImageHeight=1
```

Raw token/apply responses contain temporary credentials and provider auth. Keep them only under ignored `data/**`.

### 12.1) Reference image inspection
- Status:
  - live-proved without generation spend with `jimeng-browser-proxy describe-image`
  - implemented in `packages/jimeng-client/src/reference-image.ts`
  - tested with mocked description/face-recognition response shapes in `packages/jimeng-client/test/reference-image.test.ts`
- Provider sequence for local files:

```txt
POST /mweb/v1/get_upload_token { "scene": 2 }
GET  ImageX ApplyImageUpload
POST ImageX direct /upload/v1/{StoreUri}
POST ImageX CommitImageUpload
POST /mweb/v1/get_image_description
POST /mweb/v1/face_recognize
```

Description request:

```json
{ "file_uri": "tos-cn-i-tb4s082cfz/..." }
```

Face-recognition request:

```json
{ "image_uri_list": ["tos-cn-i-tb4s082cfz/..."] }
```

CLI controls:

```txt
--image <path>       local PNG/JPEG/WebP; uploaded before inspection
--file <path>        alias for local image/file input
--imageUri <uri>     existing tos-cn-i-* provider URI
--noDescription      skip /mweb/v1/get_image_description
--noFaces            skip /mweb/v1/face_recognize
```

Live proof command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts describe-image \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --outDir data/jimeng-lab/proof-20260610-reference-image-inspect
```

Observed safe summary:

```txt
image_uri=tos-cn-i-tb4s082cfz/b8f5124217774661b005916f6ca5bae8.png
description=黑发女人，白色背心。
description_ret=0
description_sha256=77b52d1885139655c7279ebedd49c6000564c923af84db4ff812307de9628f5f
face_recognition_ret=0
face_recognition_sha256=aa358db205f856bbd3369effb85576c4a7b6f265f4bdd6a96a8f805ecaa35d03
face_count=0
summary=data/jimeng-lab/proof-20260610-reference-image-inspect/normalized/describe-image-20260609155534-q25boh-summary.json
```

The face-recognition endpoint succeeded but returned no faces for this specific generated reference image. Treat that as input-dependent, not an API failure. Raw upload/response traces remain ignored under `data/**`.

### 13) Local video upload to VOD provider reference
- Status:
  - live-proved with `jimeng-browser-proxy upload-video`
  - implemented in `packages/jimeng-client/src/upload.ts`
  - tested with mocked token/apply/upload/commit sequence
- Provider sequence:

```txt
POST /mweb/v1/get_upload_token { "scene": 1 }
GET  https://vod.bytedanceapi.com/?Action=ApplyUploadInner&Version=2020-11-19&SpaceName=dreamina&FileType=video&IsInner=1&FileSize=<bytes>&FileExtension=.mp4&s=<random>
POST https://{UploadHost}/upload/v1/{StoreUri}
POST https://vod.bytedanceapi.com/?Action=CommitUploadInner&Version=2020-11-19&SpaceName=dreamina
```

Confirmed signer:

```txt
algorithm: AWS4-HMAC-SHA256
date header: X-Amz-Date
token header: x-amz-security-token
scope: YYYYMMDD/cn/vod/aws4_request
signed headers for apply: x-amz-date;x-amz-security-token
```

Direct upload headers:

```txt
Authorization: StoreInfos[0].Auth
Content-CRC32: <crc32 hex of bytes>
X-Storage-U: <encoded user id, empty string works in current proof>
```

Apply response shape from the active frontend uploader SDK:

```txt
Result.InnerUploadAddress.UploadNodes[0].SessionKey
Result.InnerUploadAddress.UploadNodes[0].UploadHost
Result.InnerUploadAddress.UploadNodes[0].UploadHeader
Result.InnerUploadAddress.UploadNodes[0].StoreInfos[0].StoreUri
Result.InnerUploadAddress.UploadNodes[0].StoreInfos[0].Auth
```

Commit body:

```json
{ "SessionKey": "<UploadNode.SessionKey>", "Functions": [] }
```

Live proof commands:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts upload-video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --file data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4 \
  --outDir data/jimeng-lab/proof-20260609-video-upload-live
```

Observed safe summary:

```txt
vid=v03870g10004d8k1u4nog65hb08dnhig
storeUri=tos-cn-v-148450/o4gBE1AAWbfiDDig6xEQ4KJhDHQvlExoFkFExB
spaceName=dreamina
uploadStatus=200
uploadCrc32=1929b92c
source mp4=H.264, 704x1248, 5.016667s, 4,285,498 bytes
```

Raw token/apply responses contain temporary credentials and provider auth. Keep them only under ignored `data/**`.

### 14) Lip-sync VOD video-reference dry-run plan
- Status:
  - dry-run-proved with `jimeng-browser-proxy lip-sync`
  - implemented in `packages/jimeng-client/src/lip-sync.ts`
  - CLI wiring in `packages/jimeng-client/src/browser-proxy-cli.ts`
  - tested with provider-input snapshot assertions in `packages/jimeng-client/test/lip-sync.test.ts`
  - live submit intentionally disabled until a frontend lip-sync `/mweb/v1/aigc_draft/generate` request is captured and compared
- Frontend bundle evidence:

```txt
generateType: LipSync
model_req_key: dreamina_lib_sync_base
input.videoGenInputs.v2vOpt.lipSyncUserVideo.originVideo.originVideo
input.videoGenInputs.v2vOpt.lipSyncUserVideo.ttsInfo
processFlows[0].curProcessFlows[0]: DAVideoProcessType.LipSyncUserVideo
submit query: scenario=image_video_generation, featureKey=text_to_video
```

Provider-input shape prepared by the CLI:

```txt
videoGenInputs.v2vOpt.lipSyncUserVideo.originVideo.originVideo.vid
videoGenInputs.v2vOpt.lipSyncUserVideo.originVideo.originVideo.uri
videoGenInputs.v2vOpt.lipSyncUserVideo.originVideo.originVideo.width
videoGenInputs.v2vOpt.lipSyncUserVideo.originVideo.originVideo.height
videoGenInputs.v2vOpt.lipSyncUserVideo.originVideo.originVideo.duration
videoGenInputs.v2vOpt.lipSyncUserVideo.ttsInfo.text
videoGenInputs.v2vOpt.lipSyncUserVideo.ttsInfo.toneId
videoGenInputs.v2vOpt.lipSyncUserVideo.ttsInfo.speed
```

Proof command:

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

Proof files:

```txt
data/jimeng-lab/proof-20260610-lip-sync-vod-plan/raw/lip-sync-20260609145310-83bdpg-dry-run-plan.json
data/jimeng-lab/proof-20260610-lip-sync-vod-plan/normalized/lip-sync-20260609145310-83bdpg-summary.json
```

This is deliberately a no-spend planning command. Before enabling live generation, capture a real UI lip-sync submit and compare the converted `draft_content` with the dry-run `providerInput` using `lip-sync-compare`:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts lip-sync-compare \
  --plan data/jimeng-lab/proof-20260610-lip-sync-vod-plan/raw/lip-sync-20260609145310-83bdpg-dry-run-plan.json \
  --rawNetwork data/jimeng-captures/<lip-sync-capture>/raw-network.jsonl \
  --outDir data/jimeng-lab/proof-20260610-lip-sync-compare
```

Current no-capture proof against the subject-create capture returned `match=false`, `candidate_count=0` under `data/jimeng-lab/proof-20260610-lip-sync-compare-no-capture/`, confirming the comparator is wired but still waiting for a real lip-sync UI submit capture.

### 14.1) Lip-sync image/avatar dry-run plan
- Status:
  - dry-run-proved with `jimeng-browser-proxy lip-sync --image`
  - implemented in `packages/jimeng-client/src/lip-sync.ts`
  - CLI wiring in `packages/jimeng-client/src/browser-proxy-cli.ts`
  - tested with provider-input assertions in `packages/jimeng-client/test/lip-sync.test.ts`
  - live submit intentionally disabled until a frontend image/avatar lip-sync `/mweb/v1/aigc_draft/generate` request is captured and compared
- Frontend bundle evidence:

```txt
generateType: LipSync
model_req_key: dreamina_lib_sync_image_quick_1.5
input.videoGenInputs.i2vOpt.realmanAvatar.originImage.imageUri
input.videoGenInputs.i2vOpt.realmanAvatar.originImage.width
input.videoGenInputs.i2vOpt.realmanAvatar.originImage.height
input.videoGenInputs.i2vOpt.realmanAvatar.supportedModes
input.videoGenInputs.i2vOpt.realmanAvatar.ttsInfo
processFlows[0].curProcessFlows[0]: DAVideoProcessType.LipSyncImage
submit query: scenario=image_video_generation, featureKey=text_to_video
```

Provider-input shape prepared by the CLI:

```txt
videoGenInputs.i2vOpt.realmanAvatar.originImage.imageUri
videoGenInputs.i2vOpt.realmanAvatar.originImage.imageUrl
videoGenInputs.i2vOpt.realmanAvatar.originImage.width
videoGenInputs.i2vOpt.realmanAvatar.originImage.height
videoGenInputs.i2vOpt.realmanAvatar.supportedModes
videoGenInputs.i2vOpt.realmanAvatar.ttsInfo.text
videoGenInputs.i2vOpt.realmanAvatar.ttsInfo.toneId
videoGenInputs.i2vOpt.realmanAvatar.ttsInfo.speed
```

Proof command:

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

Proof files:

```txt
data/jimeng-lab/proof-20260610-lip-sync-image-plan/raw/lip-sync-20260609233956-n72ys1-dry-run-plan.json
data/jimeng-lab/proof-20260610-lip-sync-image-plan/raw/lip-sync-20260609233956-n72ys1-reference-upload-0-raw.json
data/jimeng-lab/proof-20260610-lip-sync-image-plan/normalized/lip-sync-20260609233956-n72ys1-summary.json
data/jimeng-lab/proof-20260610-lip-sync-image-plan/artifacts/lip-sync-20260609233956-n72ys1-lip_sync_image-jimeng-kbeauty-01.png
```

Observed safe summary:

```txt
mode=image
model_req_key=dreamina_lib_sync_image_quick_1.5
image_uri=tos-cn-i-tb4s082cfz/487472ac3b204caa89fc1b2764c0aa1e.png
width=2048
height=2048
supported_modes=avatar
summary_sha256=ed087e3df60ae9c30dc835d2d410867670229abfb115adb186846aa1aa631fc6
dry_run_plan_sha256=5386ac4dd343228680dc66395faade92dfbd225d4968baa3f2e2decba248dea4
```

This is deliberately a no-spend planning command. Local image mode still uploads the reference image to ImageX first so the provider URI/dimensions match frontend payloads; it does not submit generation.

### 14.2) Lip-sync and digital-human model config
- `POST https://jimeng.jianying.com/mweb/v1/video_generate/get_common_config`
- Status:
  - live-proved without generation spend
  - implemented as `jimeng-browser-proxy lip-sync-config`
  - wraps the two confirmed scenes already present in the generic catalog probe:
    - `lip_sync_image_generate_video`
    - `lip_sync_video_generate_video`
- Raw responses include signed model-preview GIF URLs. Keep raw files under ignored `data/**`; normalized summaries omit signed media URLs and keep durable model keys, labels, options, tips, commercial config, response hashes, and default indices.

Dry-run command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts lip-sync-config \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --outDir data/jimeng-lab/proof-20260610-lip-sync-config-dry-run \
  --dryRun
```

Live proof command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts lip-sync-config \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --outDir data/jimeng-lab/proof-20260610-lip-sync-config
```

Observed safe summary:

```txt
image_models=dreamina_lib_sync_image_master_1.5:大师模式:input_media_type,audio_option | dreamina_lib_sync_image_quick_1.5:快速模式:input_media_type,audio_option
image_default_idx=1
video_models=dreamina_lib_sync_base:基础模式:仅仅修改人物口型。适合演讲、对白
video_default_idx=0
image_response_text_sha256=4ee64d934e475164c23f6c5ed3080a65e33bbe2f478152b4786b187fc24abc23
video_response_text_sha256=03cb4d200ad77f1e5bded4d6d558bf5f5798b991040ff621f28d74d65ab07ae0
raw=data/jimeng-lab/proof-20260610-lip-sync-config/raw/lip-sync-config-20260609232724.json
summary=data/jimeng-lab/proof-20260610-lip-sync-config/normalized/lip-sync-config-20260609232724-summary.json
```

### 15) Local-image image-to-video
- Status:
  - live-proved with `jimeng-browser-proxy image2video`
  - dry-run-proved with `jimeng-browser-proxy frames2video` for local first/end-frame upload and payload patching
  - implemented in `packages/jimeng-client/src/browser-proxy-cli.ts`
  - payload patching covered by `packages/jimeng-client/test/capture.test.ts`
- Provider sequence:

```txt
POST /mweb/v1/get_upload_token { "scene": 2 }
GET  ImageX ApplyImageUpload
POST ImageX direct /upload/v1/{StoreUri}
POST ImageX CommitImageUpload
POST /mweb/v1/aigc_draft/generate
POST /mweb/v1/get_history_by_ids until status=50
GET signed MP4 artifact URL
```

Local upload dry-run command:

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

Dry-run proof facts:

```txt
uploaded firstFrameUri=tos-cn-i-tb4s082cfz/7abfa90c628d46859c32dc2feffcd2e1.png
reference image=2048x2048 PNG, 2,913,365 bytes
patched duration_ms=5000
patched ratio=9:16
patched model_req_key=dreamina_ic_generate_video_model_vgfm_3.0_fast
patched seed=20260609
```

Live proof command:

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

Live proof facts:

```txt
submitId=aa83d0e1-a20c-4b85-ab59-ee3a7894296f
historyId=39156175522050
poll trace count=5
artifact=data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4
thumbnail=data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-thumb-2s.jpg
ffprobe=H.264 MP4, 704x1248, 5.016667s, 4,285,498 bytes
```

Current exposed parameterization:

```txt
--image
--lastImage
--firstFrameUri
--lastFrameUri
--durationSec
--ratio
--videoResolution
--modelVersion
--modelReqKey
--seed
```

Frames-to-video dry-run command:

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

Frames-to-video dry-run facts:

```txt
first_frame_image=tos-cn-i-tb4s082cfz/5b31ee284d5c43eb8097bfc5818b584a.png
end_frame_image=tos-cn-i-tb4s082cfz/325213bd2b2049d3a65667350b72807e.jpg
first image=2048x2048 PNG
end image=704x1248 JPEG
generation submit skipped
```

---

## Minimal headers (validated baseline)

For direct replay in this lab, these were sufficient in successful runs:
- `content-type: application/json`
- `cookie: <full cookie header>`
- `user-agent: <browser UA>`
- optionally `referer` (recommended)

Often optional in successful replay runs:
- `sign`, `device-time`
- `msToken`, `a_bogus`
- full `sec-ch-ua*`

> Note: anti-bot behavior is dynamic; keep an easy switch to add full browser-like headers when needed.

## Runtime response contracts

All new Jimeng/CapCut provider integrations should decode external JSON at the boundary with runtime schemas before normalizing. The schemas should be permissive to extra fields because the frontend payloads are broad and provider-owned, but strict for the paths this repo relies on.

Current helper:

```txt
packages/jimeng-client/src/schema.ts
```

Current schema-backed commands:

- `jimeng-browser-proxy history-queue`
- `jimeng-browser-proxy history-records`
- `jimeng-browser-proxy video-info`
- `jimeng-browser-proxy agent-catalog`

Expected drift behavior: additive fields should continue working, while missing or incompatible envelope/data/record paths should fail with explicit `JIMENG_RESPONSE_ENVELOPE_CHANGED`, `JIMENG_RESPONSE_DATA_MAP_CHANGED`, or `JIMENG_RESPONSE_CONTRACT_CHANGED` errors.

---

## Status mapping (working assumptions)

Observed values in current captures/polls:

| operation | pending/in-progress | terminal-success |
|---|---:|---:|
| video | varies (`20`, `30` seen in some traces) | `50` |
| image | varies | `45` |
| current asset-list image task | varies | `50` |
| TTS | n/a | `ret = 0`, base64 MP3 in `data.data` |

Treat all non-terminal values as transient and rely on:
1) explicit terminal success code, or
2) timeout budget + structured error.

---

## Response extraction

### Image assets
Look for signed URLs in:
- `item_list[].common_attr.cover_url`
- `item_list[].common_attr.cover_url_map.*`
- `item_list[].image.large_images[].image_url`

### Video assets
Look for signed URLs in priority order:
- `item_list[].video.transcoded_video.origin.video_url`
- `item_list[].video.play_url`
- `item_list[].video.download_url`
- `item_list[].video.url`

Download immediately (signed URLs expire).

---

## Direct-client type sketch (for provider adapter)

```ts
export type JimengOperation = "image_text" | "video_text" | "video_first_last";

export interface JimengSessionBundle {
  cookie: string;
  userAgent: string;
  origin?: string;
  referer?: string;
  msToken?: string;
  webId?: string;
  capturedAtIso?: string;
}

export interface JimengSubmitResult {
  submitId: string;
  historyId?: string;
  rawHttpStatus: number;
}

export interface JimengPollResult {
  submitId: string;
  status: number;
  terminal: boolean;
  itemCount: number;
  rawRecord: unknown;
}

export interface JimengArtifact {
  kind: "image" | "video";
  url: string;
  expiresAtIso?: string;
}

export interface JimengRunOutcome {
  submit: JimengSubmitResult;
  finalStatus: number;
  artifacts: JimengArtifact[];
  pollTrace: Array<{ atIso: string; status: number | null; itemCount: number; httpStatus: number }>;
}

export interface JimengRiskPolicy {
  concurrency: 1;
  pollIntervalMs: number; // >= 2500
  maxPolls: number;
  sharkStopThreshold: number; // e.g. 2
}
```

---

## Structured error categories (recommended)

```ts
export type JimengErrorCategory =
  | "auth"
  | "risk_control"
  | "rate_limit"
  | "validation"
  | "transport"
  | "upstream"
  | "timeout";

export interface JimengError {
  category: JimengErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

Mapping guidance:
- `ret=1019` + `shark not pass` => `risk_control`, `retryable=false` until cooldown/session refresh.
- Missing/expired cookie => `auth`, `retryable=true` after session refresh.
- Poll exceeded budget => `timeout`, `retryable=true` with new submit (not blind repoll forever).

---

## Risk controls (must keep)
- concurrency = 1
- bounded polling interval (>= 2.5s)
- stop on repeated `1019 shark not pass`
- avoid extra credit/history spam endpoints
- short duration default for video: 3s (current CLI accepts 1..15s; prefer short values)

---

## Troubleshooting notes (pitfall prevention)
- If upload flow hangs, check for UI ownership confirmation popup (“do you own this asset?”) and confirm it.
- If page appears blank or controls disappear, refresh page before capture and re-check prompt textarea visibility.
- If repeated `1019 shark not pass`, stop and cooldown (do not brute-force retries).
- If capture file misses final URLs, raise `--max-body` and recover final artifact via direct poll using `submit_id`.
- Keep prompt variants; avoid sending same prompt repeatedly in a tight window.

## Known gaps to keep in TODO list
- deterministic submit mapping for all image conversation stream variants
- long-run requirement matrix for `sign/device-time/msToken/a_bogus`
- region variants (US/HK/JP/SG) requirement differences
- end-frame image-to-video live proof using committed ImageX URIs
- multi-frame/reference-role payload captures for pose/style/depth/canny/character controls
- VOD multipart/chunked upload for large reference videos; small/direct VOD upload is implemented and live-proved
- voice/配音 + digital-human + motion-mimic endpoint mapping

## Current CLI entrypoints

### Low-level direct CLI

- `packages/jimeng-client/src/cli.ts`
- package alias: `bun --cwd packages/jimeng-client run src/cli.ts -- ...`

Examples:
```bash
# video (direct submit+poll+download)
bun --cwd packages/jimeng-client run src/cli.ts -- \
  --op video \
  --capture ../../data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --session-bundle ../../data/jimeng-lab/raw/session-bundle.json \
  --prompt "一只柴犬在海边冲浪，电影感，16:9" \
  --durationSec 3

# image (SSE submit parse + poll + download)
bun --cwd packages/jimeng-client run src/cli.ts -- \
  --op image \
  --capture ../../data/jimeng-lab/raw/jimeng-network-capture-image-01.json \
  --session-bundle ../../data/jimeng-lab/raw/session-bundle.json \
  --prompt "请生成一张搞笑梗图：程序员深夜调试终于成功，夸张幽默，电影感，高清"
```

### Browser-backed proxy CLI

- `packages/jimeng-client/src/browser-proxy-cli.ts`
- package alias: `jimeng-browser-proxy`

The proxy refreshes the session from the logged-in background Jimeng browser profile and then uses the direct client. This is the preferred path while endpoint contracts are still being stabilized.

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts session \
  --cdp http://127.0.0.1:9340 \
  --target-url jimeng.jianying.com \
  --session-out data/jimeng-lab/raw/session-bundle-current.json

bun packages/jimeng-client/src/browser-proxy-cli.ts text2image \
  --cdp http://127.0.0.1:9340 \
  --target-url "type=image" \
  --capture data/jimeng-captures/<run>/capture-template.raw.json \
  --prompt "韩系美妆健身UGC创作者，手机自拍，无文字，无水印" \
  --dryRun
```

Supports local first-frame upload and optional frame URI injection for video payload patching:
- `image2video --image <path>`
- `frames2video --image <path> --lastImage <path>`
- `--firstFrameUri <uri>`
- `--lastFrameUri <uri>`
- `upload-video --file <path>`

For `image2video --dryRun --image`, the CLI still uploads the local image to obtain a real provider URI, then skips the generation submit.
For `frames2video --dryRun --image --lastImage`, the CLI uploads both local images to obtain real provider URIs, then skips the generation submit.

Upload-token probe:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts upload-token \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --scene image \
  --outDir data/jimeng-lab/upload-token-cli-smoke
```

### Dreamina-compatible direct CLI

- `packages/jimeng-client/src/dreamina-compatible-cli.ts`
- package bin: `jimeng-dreamina`

Goal: mirror the official `dreamina` command vocabulary, but use reversed web endpoints and local capture/session templates instead of the VIP-gated official generator command path.

Important behavior: compat commands submit live by default and can consume credits, matching normal generation tooling. `--dryRun` is the explicit no-spend flag.

Current support matrix:

| command | status | notes |
|---|---|---|
| `text2video` | implemented | Uses captured `/mweb/v1/aigc_draft/generate`; confirmed paid-live with `dreamina_ic_generate_video_model_vgfm_3.0_fast`. Latest proof: `submitId=0a829552-fe6a-4f2f-b8d2-8bd6d4ec6fb2`, `historyId=35934031025164`, 704x1248 H.264 MP4, 3.016667s. |
| `text2image` | blocked pending fresh capture | Stale workbench capture `data/jimeng-captures/20260609095503-text2image-submit/capture-template.raw.json` now returns `ret=3018`, `errmsg=permission denied`; recapture current frontend submit before claiming support. |
| `image2video` | implemented in `jimeng-browser-proxy`; partial in low-level compat helper | Browser proxy can upload local `--image`, inject `first_frame_image`, submit/poll/download MP4. Latest paid-live proof: `submitId=6c83d6bd-d8f6-4b69-a6b9-1d05088312a3`, `historyId=35931512058892`, 704x1248 H.264 MP4, 3.016667s. Low-level helper accepts confirmed `--firstFrameUri`. |
| `frames2video` | dry-run-proved in `jimeng-browser-proxy`; partial in low-level compat helper | Browser proxy can upload local `--image` and `--lastImage`, inject `first_frame_image`/`end_frame_image`, and write a no-generation plan. Live proof still needs explicit frontend end-frame mode evidence. |
| `lip-sync-config` | implemented in `jimeng-browser-proxy` | No-spend direct lip-sync/digital-human model config for image/avatar and video modes. |
| `lip-sync` | dry-run-proved in `jimeng-browser-proxy` | Browser proxy can prepare VOD-reference and image/avatar lip-sync provider inputs from VOD/ImageX provider references plus TTS voice flags. Live submit still needs a frontend submit capture/compare. |
| `lip-sync-compare` | implemented in `jimeng-browser-proxy` | Offline compare gate for lip-sync live enablement: checks dry-run provider input and model key against captured `/mweb/v1/aigc_draft/generate` requests from `raw-network.jsonl` or `capture-template.raw.json`. |
| `assets` | implemented in `jimeng-browser-proxy` | No-spend direct `/mweb/v1/get_asset_list` workspace/workbench asset history with request flags for count, asset types, mode, direction, order, timestamp cursor, favorite filter, story-agent visibility, and workspace id. Latest proof returned one completed image asset with four generated image items and no signed URLs in normalized output. |
| `history-queue` | implemented in `jimeng-browser-proxy` | No-spend direct `/mweb/v1/get_history_queue_info` lookup with `--historyId`/`--historyIds`; latest proof returned queue status `3`, polling interval `30s`, and no raw debug info in normalized output. |
| `history-records` | implemented in `jimeng-browser-proxy` | No-spend direct `/mweb/v1/get_history_by_ids` lookup by submit id or history id with schema-backed normalization. |
| `video-info` | implemented in `jimeng-browser-proxy` | No-spend direct `/mweb/v1/get_video_by_vid` VOD metadata lookup by `vid`; latest proof confirmed `{"vids":[...]}` and returned `704x1248`, `5s`, `24fps`, `720p`. |
| `capture-analyze` | implemented in `jimeng-browser-proxy` | Offline CDP `raw-network.jsonl` analyzer/ranker with risk classes, shape summaries, static endpoint string hints, sanitized markdown/JSON, and local `endpoint-probe` replay candidates. |
| `discovery-worklist` | implemented in `jimeng-browser-proxy` | Offline merge/ranking layer over one or more `capture-analyze` outputs, raw probe candidates, and static source/bundle roots. Emits next-slice actions and raw per-endpoint replay variant files without loading a browser session. |
| `static-locate` | implemented in `jimeng-browser-proxy` | Offline source/bundle locator for endpoint request builders; writes redacted snippets, symbol hints, and mise-managed `ast-grep` follow-up commands without loading a browser session. |
| `endpoint-probe` | implemented in `jimeng-browser-proxy` | Generic explicit replay/probe helper for candidate JSON body variants; writes raw local response plus normalized request/response shape summaries for faster promotion into typed commands. |
| `agent-catalog` | implemented in `jimeng-browser-proxy` | No-spend schema-backed `/mweb/v1/creation_agent/v2/skill/list` and `/mweb/v1/creation_agent/v2/get_agent_config` catalog for official agent skills, image/video model request keys, option enums, input media types, unified-edit material limits, and image control features. |
| `image-models` | implemented in `jimeng-browser-proxy` | No-spend schema-backed `/mweb/v1/get_common_config` catalog for image model keys, default workbench model, feature flags, blend controls, resolution presets, sample-step bounds, and commercial benefit/resource ids. |
| `templates` | implemented in `jimeng-browser-proxy` | No-spend direct `/mweb/v1/get_explore` template mining with prompt/model/usage normalization. |
| `overseas-short-videos` | implemented in `jimeng-browser-proxy` | No-spend direct `/mweb/v1/feed_short_video` short-video/reference mining with ranking and video metadata normalization. |
| `capcut-categories` | implemented in `jimeng-browser-proxy` | No-spend signed CapCut `/lv/v1/cc_web/plane/get_categories` commercial template category catalog. |
| `capcut-collections` | implemented in `jimeng-browser-proxy` | No-spend signed CapCut `/lv/v1/cc_web/plane/get_collections` collection id catalog. |
| `capcut-collection-templates` | implemented in `jimeng-browser-proxy` | No-spend signed CapCut `/lv/v1/cc_web/plane/get_collection_templates` row listing by collection `id`. |
| `capcut-template-detail` | implemented in `jimeng-browser-proxy` | No-spend signed CapCut `/lv/v1/cc_web/plane/get_template_detail` lookup by string template `web_id`. |
| `capcut-template-metadata` | implemented in `jimeng-browser-proxy` | No-session public CapCut `bee_prod` ratio and scene metadata catalogs. |
| `subjects` | implemented in `jimeng-browser-proxy` | No-spend direct `/mweb/v1/dreamina_subject/get`; empty, non-empty, and subject-id filtered list shapes are live-proved. |
| `subject-create` | implemented in `jimeng-browser-proxy` | No-spend direct subject/persona create from a local ImageX-uploaded or existing provider image. |
| `subject-update` | implemented in `jimeng-browser-proxy` | No-spend direct subject/persona content update, live-proved on a temporary subject. |
| `subject-delete` | implemented in `jimeng-browser-proxy` | No-spend direct subject/persona delete, live-proved on the same temporary subject. |
| `subject-generate-voice` | dry-run-only in `jimeng-browser-proxy` | Request shape is known as `image_uri`; live submit disabled pending explicit spend approval or captured UI submit. |
| `voice-clones` | implemented in `jimeng-browser-proxy` | No-spend direct cloned voice asset list via `/mweb/v1/get_user_local_item_list` with `effect_type=218`; latest proof returned zero account voices. |
| `voice-clone-query` | implemented in `jimeng-browser-proxy` | Direct `/mweb/v1/voice/query_task` helper and CLI; dry-run-proved request shape, live proof waits for a real task id. |
| `voice-clone-submit` | dry-run-only in `jimeng-browser-proxy` | Request shape known as `/mweb/v1/voice/submit_task` with `scene=1`, `voice_clone.audio`, and `voice_clone.name`; live disabled pending approval/capture. |
| `voice-clone-update` / `voice-clone-delete` | dry-run-only in `jimeng-browser-proxy` | Mutation request shapes known as `local_item_id` and `local_item_id + name`; live disabled pending a disposable cloned voice fixture. |
| `image2image` | needs capture | Need image reference upload + image edit submit capture. |
| `multiframe2video` | needs capture | Need multi-frame upload/reference payload capture. |
| `multimodal2video` | needs capture | Need `全能参考` mixed image/video/audio reference payload capture. |
| `image_upscale` | needs capture | Need upscale submit/result capture. |

Examples:

```bash
# support matrix
bun packages/jimeng-client/src/dreamina-compatible-cli.ts capabilities

# no-spend request patch
bun packages/jimeng-client/src/dreamina-compatible-cli.ts text2video \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --session-bundle data/jimeng-lab/raw/session-bundle.json \
  --prompt "赛博海豹，电影感，无文字" \
  --duration=3 \
  --ratio=16:9 \
  --model_version=3.0fast \
  --dryRun
```

## Background network recorder

A passive CDP recorder is available at:

```txt
packages/jimeng-client/src/network-recorder.ts
```

It connects to the dedicated Jimeng frontend CDP profile (`http://127.0.0.1:9340` by default), opens new targets with `Target.createTarget({ background: true })` when needed, and never calls `Target.activateTarget`, `page.bringToFront`, or DevTools UI methods.

Help-only run:

```bash
bun packages/jimeng-client/src/network-recorder.ts --help
```

Capture examples:

```bash
# Create a background Jimeng target and record for 3 minutes.
bun packages/jimeng-client/src/network-recorder.ts \
  --flow image2video-upload \
  --durationSec 180

# Attach to an already-open Jimeng tab and record until Ctrl-C.
bun packages/jimeng-client/src/network-recorder.ts \
  --target-url jimeng.jianying.com \
  --flow manual-upload \
  --durationSec 0
```

Default output path:

```txt
data/jimeng-captures/<timestamp>-<flow>/
  raw-network.jsonl            # raw local-only CDP events; may contain cookies/signatures
  capture-template.raw.json    # request-template shape consumed by direct-client patching helpers
  redacted-summary.md          # reviewable summary with headers/signatures/query values redacted
```

Do not commit raw captures or generated media. If a redacted summary is promoted into tracked docs, manually review it first for cookies, reusable signatures, signed URL values, account IDs, and private prompt/media content.

## Endpoint replay/probe accelerator

`jimeng-browser-proxy capture-analyze`, `jimeng-browser-proxy discovery-worklist`, `jimeng-browser-proxy static-inventory`, `jimeng-browser-proxy static-locate`, and `jimeng-browser-proxy endpoint-probe` are the first "tool that builds the tool" layer for this reversal workflow. `capture-analyze` turns CDP `raw-network.jsonl` into ranked endpoint evidence with risk classes, request/response shape summaries, initiator hints, and local replay candidate JSON. `discovery-worklist` merges one or more analyzer outputs with raw probe candidates and static source/bundle hints into a prioritized next-slice queue. `static-inventory` scans saved frontend bundles/source roots into a coverage map of implemented, partial, dry-run, captured-only, and unknown resources. `static-locate` turns endpoints from `--endpoint` or analyzer files into local source/bundle occurrences, redacted snippets, symbol hints, and mise-managed `ast-grep` follow-up commands. `endpoint-probe` then replays explicit candidate JSON bodies against one endpoint, stores raw local responses under ignored `data/**`, and writes a normalized shape summary that is small enough to paste into agent context.

Use these tools after a real CDP capture; do not use them as blind fuzzers against write/generate/payment endpoints.

Capture analyzer example:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts capture-analyze \
  --rawNetwork data/jimeng-captures/20260610-subject-create-ui/raw-network.jsonl \
  --staticRoot packages/jimeng-client/src \
  --outDir data/jimeng-lab/proof-20260610-capture-analyze-subject-create-v3 \
  --limit 20
```

Latest proof analyzed 138 events / 27 requests into 5 ranked candidates and 1 safe replay candidate. The top endpoints were `/mweb/v1/imagex/submit_audit_job` (`upload`, not replay-safe), `/mweb/v1/get_unread_count` (`read`, replay-safe), and `/mweb/v1/get_upload_token` (`upload`, not replay-safe). Normalized proof files contain no signed URL values.

Discovery worklist example:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts discovery-worklist \
  --analysis data/jimeng-lab/proof-20260610-capture-analyze-subject-create-v3/normalized/capture-analyze-20260610024757-analysis.json \
  --probeCandidates data/jimeng-lab/proof-20260610-capture-analyze-subject-create-v3/raw/capture-analyze-20260610024757-endpoint-probe-candidates.json \
  --staticRoot packages/jimeng-client/src \
  --outDir data/jimeng-lab/proof-20260610-discovery-worklist-subject-create-v3
```

Latest proof produced 18 prioritized work items, skipped 2 already-covered capture endpoints by default, and exported one raw per-endpoint replay variant file for `/mweb/v1/get_unread_count`. The historical top useful gaps were subject/persona `generate_voice`, custom voice clone mutations, CapCut template row/search/collection payload capture, remaining `/mweb/v1/aigc_draft/generate` modes, and older agent/feed/workspace surfaces; the CapCut collection/row/detail part has since been promoted, leaving search/batch/preset capture as the CapCut gap. Normalized proof files contain no signed URL values or raw probe bodies.

Static inventory example:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts static-inventory \
  --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \
  --limit 120 \
  --outDir data/jimeng-lab/proof-20260610-static-inventory
```

Latest proof found 247 static frontend/API resources, included 200 non-implemented resources, skipped 29 implemented endpoints, and counted 61 high-value gaps after the CapCut collection/row/detail endpoints were promoted. Known status counts are `unknown=200`, `partial=4`, `implemented=29`, `dry_run_only=4`, `blocked=7`, `captured_only=2`, and `cataloged_only=1`. The remaining CapCut template search/batch/preset endpoints are now explicitly blocked with replay evidence and recommended action `capture_exact_payload`. Normalized proof files contain no credential markers.

Static locator example:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts static-locate \
  --analysis data/jimeng-lab/proof-20260610-capture-analyze-subject-create-v3/normalized/capture-analyze-20260610024757-analysis.json \
  --staticRoot packages/jimeng-client/src \
  --outDir data/jimeng-lab/proof-20260610-static-locate-subject-create \
  --limit 4
```

Latest proof derived 4 API endpoints from the subject-create capture analysis and found 16 local source occurrences. Normalized proof files include redacted snippets and `mise x ast-grep -- ast-grep ...` follow-up commands, and contain no signed URLs or credentials.

Example:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts endpoint-probe \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --endpoint /mweb/v1/get_video_by_vid \
  --variants '[{"name":"vids","body":{"vids":["v03870g10004d8k1u4nog65hb08dnhig"]}},{"name":"vid","body":{"vid":"v03870g10004d8k1u4nog65hb08dnhig"}}]' \
  --outDir data/jimeng-lab/proof-20260610-endpoint-probe-video-info
```

Latest proof:

```txt
vids -> ret=0, errmsg=success, response has vid2video shape and URL-like raw tokens
vid  -> ret=1000, errmsg=invalid parameter
normalized summary contains host/path/query keys, request/response shape summaries, hashes, and URL-like booleans; no signed URL values
```

The recommended fast loop is:

1. **Dynamic:** capture one UI action with CDP, saving raw network and redacted summary.
2. **Analyze:** run `capture-analyze` to rank endpoints, classify risk, summarize shapes, and produce safe replay candidates.
3. **Prioritize:** run `discovery-worklist` across analyzer outputs, raw probe candidates, and static roots to choose the next small slice.
4. **Inventory:** run `static-inventory` periodically on saved bundle roots to detect uncovered API resources and keep the coverage map honest.
5. **Locate:** run `static-locate` to find likely request-builder snippets and get `ast-grep` follow-up commands.
6. **Static:** use `ast-grep` or targeted bundle search around endpoint names, initiator bundle paths, enum names, and request builder constants when the locator still needs semantic labels.
7. **Replay:** run `endpoint-probe` with 2-4 likely body variants to identify exact casing and required fields.
8. **Promote:** implement a dedicated typed CLI command with permissive schema validation and a live/dry-run proof.

## Next reverse target (immediate)
1. Capture real frontend VOD and image/avatar lip-sync submits and compare them against the dry-run provider-input plans before enabling live generation.
2. Use the VOD upload path to unlock reference-video and multimodal/all-around reference flows.
3. Capture the frontend's explicit end-frame/multi-frame mode and live-prove `frames2video` only after confirming the mode-specific payload contract.
4. Expand template/research mining beyond direct Explore/feed_short_video with CapCut template search, batch, and preset endpoints.
5. Add strict `1019` shark breaker/cooldown budgets to the consolidated CLI path.
6. Capture/approve subject/persona `generate_voice` live submit and custom voice clone submit/mutation flows.
7. Add multipart/chunked VOD upload only when large reference videos require it.
