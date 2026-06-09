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
- Current text-to-image prompt field location:
  - `draft_content.component_list[0].abilities.generate.core_param.prompt`
- Current text-to-image model field observed:
  - `draft_content.component_list[0].abilities.generate.core_param.model = high_aes_general_v50`
- Current text-to-image output mode:
  - poll/list workspace assets via `get_asset_list`, not only `get_history_by_ids`

### 3) Poll status/results by submit id
- `POST https://jimeng.jianying.com/mweb/v1/get_history_by_ids`
- Payload variants observed:
  - `{ "submit_ids": ["<submit_id>"] }`
  - `{ "submit_ids": ["<submit_id>"], "need_batch": true, "history_ids": [] }`
- Terminal success seen:
  - video: `status = 50`
  - image: `status = 45` (observed in earlier image path)

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
- Not required for minimal direct client; useful for UX progress.

### 6) Non-generating model/tool/persona/voice catalog
- `POST https://jimeng.jianying.com/mweb/v1/creation_agent/v2/skill/list`
- `POST https://jimeng.jianying.com/mweb/v1/creation_agent/v2/get_agent_config`
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

These probes are read/config/list calls and should not consume generation credits. They still require a live logged-in session bundle.

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
- subject/persona CRUD and voice: `/mweb/v1/dreamina_subject/create`, `/mweb/v1/dreamina_subject/update`, `/mweb/v1/dreamina_subject/delete`, `/mweb/v1/dreamina_subject/generate_voice`
- infinite canvas: `/mweb/v1/infinite_canvas/create_project`, `/mweb/v1/infinite_canvas/conversation`, `/mweb/v1/infinite_canvas/edit`, `/mweb/v1/infinite_canvas/resume`, `/mweb/v1/infinite_canvas/stop_stream`, `/mweb/v1/infinite_canvas/v1/fetch_snapshot`, `/mweb/v1/infinite_canvas/v1/submit_changeset`, `/mweb/v1/infinite_canvas/v1/fetch_changeset`
- reference/image tools: `/mweb/v1/get_common_config`, `/mweb/v1/get_image_description`, `/mweb/v1/get_upload_token`, `/mweb/v1/face_recognize`, `/mweb/v1/algo_proxy`
- template/research mining: `/mweb/v1/feed`, `/mweb/v1/get_explore`, `/mweb/v1/feed_short_video`, `/lv/v1/cc_web/replicate/search_templates`, `/lv/v1/cc_web/plane/*`

Next step is to drive those UI flows one at a time with background CDP recording, then create dry-run patchers before live calls.

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

This is deliberately a no-spend planning command. Before enabling live generation, capture a real UI lip-sync submit and compare the converted `draft_content` with the dry-run `providerInput`.

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
| `text2video` | implemented | Uses captured `/mweb/v1/aigc_draft/generate`; confirmed live with `dreamina_ic_generate_video_model_vgfm_3.0_fast`. |
| `text2image` | implemented when image capture is supplied | Uses captured `/mweb/v1/creation_agent/v2/conversation`; needs current local image capture fixture/session. |
| `image2video` | implemented in `jimeng-browser-proxy`; partial in low-level compat helper | Browser proxy can upload local `--image`, inject `first_frame_image`, submit/poll/download MP4. Low-level helper accepts confirmed `--firstFrameUri`. |
| `frames2video` | dry-run-proved in `jimeng-browser-proxy`; partial in low-level compat helper | Browser proxy can upload local `--image` and `--lastImage`, inject `first_frame_image`/`end_frame_image`, and write a no-generation plan. Live proof still needs explicit frontend end-frame mode evidence. |
| `lip-sync` | dry-run-proved in `jimeng-browser-proxy` | Browser proxy can prepare the VOD-reference lip-sync provider input from a VOD `vid`/metadata plus TTS voice flags. Live submit still needs a frontend submit capture/compare. |
| `templates` | implemented in `jimeng-browser-proxy` | No-spend direct `/mweb/v1/get_explore` template mining with prompt/model/usage normalization. |
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

## Next reverse target (immediate)
1. Capture a real frontend lip-sync submit and compare it against the VOD dry-run provider-input plan before enabling live generation.
2. Use the VOD upload path to unlock reference-video and multimodal/all-around reference flows.
3. Capture the frontend's explicit end-frame/multi-frame mode and live-prove `frames2video` only after confirming the mode-specific payload contract.
4. Expand template/research mining beyond direct Explore with `feed_short_video`, CapCut template search, and plane endpoints.
5. Add strict `1019` shark breaker/cooldown budgets to the consolidated CLI path.
6. Add multipart/chunked VOD upload only when large reference videos require it.
