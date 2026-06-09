# Jimeng Frontend API Catalog

Captured from the logged-in Helium/CDP Jimeng profile on 2026-06-09. Raw captures and session bundles stay under ignored `data/**`; this file records only reusable contract facts.

## Architecture

Preferred operating shape:

```txt
background Jimeng browser profile
→ CDP session/cookie refresh
→ browser-proxy CLI prepares direct request
→ direct Jimeng client submits/polls/downloads
→ raw captures remain local-only
```

Use the browser as an authenticated session holder and API discovery surface. Move operations to direct `fetch` only after capture + dry-run prove the request contract.

## Confirmed Useful Endpoints

| Endpoint | Method | Use | Current status |
|---|---:|---|---|
| `/mweb/v1/workspace/create` | POST | Creates a generation workspace/conversation. | Captured |
| `/mweb/v1/workspace/update` | POST | Renames/updates current workspace metadata. | Captured |
| `/mweb/v1/aigc_draft/generate` | POST | Unified workbench submit for current text-to-image, text-to-video, and first-frame image-to-video draft generation paths. | Implemented for workbench text-to-image, text-to-video templates, and local-upload-backed image-to-video |
| `/mweb/v1/get_asset_list` | POST | Poll/list workspace assets and completed image results. | Implemented for workbench text-to-image |
| `/mweb/v1/get_history_by_ids` | POST | Older/general task polling by `submit_id`. | Implemented for captured history-based templates |
| `/mweb/v1/creation_agent/v2/conversation` | POST/SSE | Older agent text-to-image conversation submit. | Preserved |
| `/mweb/v1/creation_agent/v2/get_agent_config` | POST | Agent/tool configuration payload. | Cataloged only |
| `/mweb/v1/creation_agent/v2/skill/list` | POST | Available agent skills/tools. | Cataloged only |
| `/mweb/v1/video_generate/get_common_config` | POST | Video model/common configuration by scene, including lip-sync image/video scenes. | Implemented for config catalog |
| `/mweb/v1/get_user_local_item_list` | POST | User local/generated item lists; `effect_type=218` returns current user's cloned voices. | Implemented for config catalog |
| `/mweb/v1/dreamina_subject/get` | POST | Saved subject/persona list. | Implemented for config catalog |
| `/mweb/v1/feed` | POST | Explore/feed content; a signed `dreamina_tone` feed request returns the built-in voice library. Useful for research/template mining if handled carefully. | Implemented for voice library replay |
| `/mweb/v1/tts_generate` | POST | Built-in voice text-to-speech. Returns base64 MP3 in `data.data`. | Implemented and live-proved |
| `/mweb/v1/get_upload_token` | POST | Temporary upload credentials for video/image/file scenes. Required before direct local reference-image/video upload. | Implemented and live-proved; local ImageX image upload is implemented via `upload-image`, local VOD video upload via `upload-video` |
| `/mweb/v1/get_explore` | POST | Explore examples and public creative templates. | Cataloged only |
| `/mweb/v1/get_unread_count` | POST | Notification count. | Low priority |

## Confirmed Voice / Audio Contracts

The built-in voice picker is not exposed through the same local-item endpoint as cloned voices. The useful current split is:

| Contract | Endpoint | Request source | Result |
|---|---|---|---|
| cloned voice assets | `/mweb/v1/get_user_local_item_list` with `effect_type=218` and `clone_voice_status` filter | direct JSON body | Empty list is valid when the account has no cloned voices. |
| built-in voice library | signed `/mweb/v1/feed` request whose body includes `dreamina_tone` | replay from captured frontend request | 142 built-in voice items in current replay; normalized id, title, tags, speaker id, emotions. |
| text-to-speech | `/mweb/v1/tts_generate` | direct JSON body | Base64 MP3 payload, validated as 24 kHz mono MP3 in smoke run. |

TTS body shape:

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

Current proof artifacts are intentionally ignored under:

```txt
data/jimeng-lab/voice-tts-smoke/
data/jimeng-lab/voice-library-samples/
```

The latest full voice sample run generated `142/142` MP3 files with concurrency `1` and no `1019` / `shark not pass` risk-control errors.

## Confirmed Local Image Upload Contract

The next useful UGC slice was local media upload for image-to-video and reference/persona workflows. The ImageX image path is now confirmed end-to-end:

```txt
POST /mweb/v1/get_upload_token
GET  ImageX ApplyImageUpload
POST ImageX /upload/v1/{StoreUri}
POST ImageX CommitImageUpload
```

Request:

```json
{ "scene": 2 }
```

Observed scene mapping:

| Scene | Meaning from frontend bundle/use | Live status |
|---:|---|---|
| `1` | video/VOD upload token | Confirmed |
| `2` | image/ImageX upload token | Confirmed |
| `3` | file/audio-like upload token | Confirmed |

Scene `2` response summary from the CLI smoke:

```json
{
  "ret": "0",
  "errmsg": "success",
  "summary": {
    "scene": 2,
    "region": "cn",
    "spaceName": "tb4s082cfz",
    "uploadDomainPresent": true,
    "accessKeyPresent": true,
    "secretKeyPresent": true,
    "sessionTokenPresent": true,
    "expiredTimePresent": true,
    "currentTimePresent": true
  }
}
```

The raw token/apply responses include temporary credentials and upload authorization, so they must stay under ignored `data/**`.

Confirmed ImageX details from the frontend uploader SDK and live CLI proof:

- `scene=2` returns the ImageX token path for images.
- Jimeng's `region=cn` token value maps to ImageX signing region `cn-north-1`.
- The provider signer uses AWS4-style constants from the bundled uploader SDK:
  - `AWS4-HMAC-SHA256`
  - `X-Amz-Date`
  - `x-amz-security-token`
  - credential scope `YYYYMMDD/cn-north-1/imagex/aws4_request`
- `ApplyImageUpload` uses `ServiceId=tb4s082cfz`, `UploadNum=1`, optional `FileExtension`, and the frontend's random `s` query param.
- Small images direct-upload to `https://{UploadHosts[0]}/upload/v1/{StoreUri}` with `Authorization`, `Content-CRC32`, and `X-Storage-U`.
- `CommitImageUpload` posts `{"SessionKey":"..."}` and returns committed provider URIs such as `tos-cn-i-tb4s082cfz/...png`.

Current CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts upload-image \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --file data/jimeng-lab/image-upload-probe/aws4-live/proof-1x1.png \
  --outDir data/jimeng-lab/proof-20260609-image-upload
```

Result summary:

```txt
upload-image saved uri=tos-cn-i-tb4s082cfz/97c32453461a4041b4f6e20f1dc0a517.png
proof artifact: data/jimeng-lab/proof-20260609-image-upload/artifacts/proof-1x1.png
```

This URI can now be injected into first-frame image-to-video payloads:

```txt
draft_content.component_list[0].abilities.gen_video.text_to_video_params.video_gen_inputs[0].first_frame_image
```

## Confirmed Local Video Upload Contract

Local VOD upload is now confirmed end-to-end for small/direct reference clips:

```txt
POST /mweb/v1/get_upload_token
GET  VOD ApplyUploadInner
POST VOD /upload/v1/{StoreUri}
POST VOD CommitUploadInner
```

Request:

```json
{ "scene": 1 }
```

Confirmed VOD details from the frontend uploader SDK and live CLI proof:

- `scene=1` returns the VOD token path for videos.
- Jimeng's VOD token uses `space_name=dreamina`, `upload_domain=vod.bytedanceapi.com`, and `region=cn`.
- The bundled uploader calls `ApplyUploadInner` with `Version=2020-11-19`, `SpaceName=dreamina`, `FileType=video`, `IsInner=1`, `FileSize`, optional `FileExtension`, and random `s`.
- VOD signing uses the same AWS4-style signer shape with credential scope `YYYYMMDD/cn/vod/aws4_request`.
- Small video files direct-upload to `https://{UploadHost}/upload/v1/{StoreUri}` with `Authorization`, `Content-CRC32`, and `X-Storage-U`.
- `CommitUploadInner` posts `{"SessionKey":"...","Functions":[]}` and returns provider video references such as `Vid` plus `VideoMeta` fields including `Uri`, `Width`, `Height`, `Duration`, `Format`, `Codec`, and `Md5`.

Dry-run:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts upload-video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --file data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4 \
  --outDir data/jimeng-lab/proof-20260609-video-upload-dry-run \
  --dryRun
```

Live proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts upload-token \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --scene video \
  --outDir data/jimeng-lab/proof-20260609-video-upload-token

bun packages/jimeng-client/src/browser-proxy-cli.ts upload-video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --file data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4 \
  --outDir data/jimeng-lab/proof-20260609-video-upload-live
```

Proof result:

```txt
vid=v03870g10004d8k1u4nog65hb08dnhig
storeUri=tos-cn-v-148450/o4gBE1AAWbfiDDig6xEQ4KJhDHQvlExoFkFExB
source video=H.264 MP4, 704x1248, 5.016667s, 4,285,498 bytes
summary=data/jimeng-lab/proof-20260609-video-upload-live/normalized/upload-video-20260609141130-summary.json
```

Raw token/apply/commit responses include temporary credentials and provider upload authorization. They remain ignored under `data/**`.

## Lip-Sync Video Reference Dry-Run Contract

`jimeng-browser-proxy lip-sync` now writes a dry-run VOD video-reference lip-sync plan. Live submit is intentionally disabled until a real frontend lip-sync `/mweb/v1/aigc_draft/generate` request is captured and compared against the generated provider input.

Evidence from the 2026-06-09 frontend bundles:

- initial lip-sync generation builds `input.videoGenInputs.v2vOpt.lipSyncUserVideo`
- image/avatar mode builds `input.videoGenInputs.i2vOpt.realmanAvatar`
- both modes attach `ttsInfo`
- video mode requires `originVideo.originVideo.width` and `originVideo.originVideo.height`
- mock model records `generateType=LipSync`
- process flow is `DAVideoProcessType.LipSyncUserVideo` for VOD input and `DAVideoProcessType.LipSyncImage` for image/avatar input
- initial lip-sync submit query params use `scenario=image_video_generation`, `featureKey=text_to_video`; post-edit lip-sync snippets use `featureKey=to_video-lipsync`

Confirmed video-mode model catalog:

```txt
scene=lip_sync_video_generate_video
model_req_key=dreamina_lib_sync_base
model_name=基础模式
options=[]
model_tip=仅仅修改人物口型。适合演讲、对白
```

Dry-run proof command:

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

Dry-run plan facts:

```txt
status=dry-run-only
endpoint=/mweb/v1/aigc_draft/generate
model_req_key=dreamina_lib_sync_base
provider path=input.videoGenInputs.v2vOpt.lipSyncUserVideo
originVideo.vid=v03870g10004d8k1u4nog65hb08dnhig
originVideo.uri=tos-cn-v-148450/o4gBE1AAWbfiDDig6xEQ4KJhDHQvlExoFkFExB
originVideo.width=704
originVideo.height=1248
originVideo.duration=5.016667
ttsInfo.sourceType=text-to-speech
ttsInfo.toneId=7597003459665072686
```

Proof bundle:

```txt
data/jimeng-lab/proof-20260610-lip-sync-vod-plan/raw/lip-sync-20260609145310-83bdpg-dry-run-plan.json
data/jimeng-lab/proof-20260610-lip-sync-vod-plan/normalized/lip-sync-20260609145310-83bdpg-summary.json
```

Next probe: capture the Jimeng lip-sync UI submit request and compare the converted `draft_content` with the dry-run `providerInput` before enabling live submit.

## Confirmed Image-To-Video First-Frame Contract

`jimeng-browser-proxy image2video` is live-proved for the UGC first-frame workflow:

```txt
local PNG/JPEG/WebP
→ ImageX scene=2 upload
→ tos-cn-i-tb4s082cfz/... provider URI
→ /mweb/v1/aigc_draft/generate with video_gen_inputs[0].first_frame_image
→ /mweb/v1/get_history_by_ids polling
→ signed MP4 download
```

Useful CLI flags now exposed:

```txt
--image <path>             local first-frame image; uploads before submit
--lastImage <path>         local end-frame image for frames2video; uploads before submit
--firstFrameUri <uri>      reuse an existing provider URI
--lastFrameUri <uri>       payload-level end-frame experiment
--durationSec <sec>
--ratio <ratio>
--videoResolution <value>
--modelVersion <value>
--modelReqKey <value>
--seed <n>
```

Dry-run with local upload:

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

Live proof:

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

Proof result:

```txt
firstFrameUri=tos-cn-i-tb4s082cfz/7abfa90c628d46859c32dc2feffcd2e1.png
submitId=aa83d0e1-a20c-4b85-ab59-ee3a7894296f
historyId=39156175522050
artifact=data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4
thumbnail=data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-thumb-2s.jpg
video=H.264 MP4, 704x1248, 5.016667s, 4.3 MB
```

Raw upload/apply/commit responses, signed artifact URLs, and generated media remain ignored under `data/**`.

### Frames-To-Video Dry-Run Proof

`jimeng-browser-proxy frames2video` now uploads a first-frame image and an end-frame image, then writes a patched no-generation plan with both provider URIs:

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

Dry-run proof facts:

```txt
first_frame_image=tos-cn-i-tb4s082cfz/5b31ee284d5c43eb8097bfc5818b584a.png
end_frame_image=tos-cn-i-tb4s082cfz/325213bd2b2049d3a65667350b72807e.jpg
first image=2048x2048 PNG, 2,913,365 bytes
end image=704x1248 JPEG, 58,126 bytes
duration_ms=5000
ratio=9:16
model_req_key=dreamina_ic_generate_video_model_vgfm_3.0_fast
plan=data/jimeng-lab/proof-20260609-frames2video-dry-run/raw/frames2video-20260609142243-t9emm5-dry-run-plan.json
```

This is dry-run-proved only. The next live-proof step should capture or select the frontend's explicit end-frame/multi-frame mode before spending generation quota.

## Confirmed Config Catalog Probes

`packages/jimeng-client/src/catalog.ts` now has a non-generating catalog probe for:

- `skill-list`: `/mweb/v1/creation_agent/v2/skill/list`
- `agent-config`: `/mweb/v1/creation_agent/v2/get_agent_config`
- `voice-assets`: `/mweb/v1/get_user_local_item_list`
- `lip-sync-image-config`: `/mweb/v1/video_generate/get_common_config` with `scene=lip_sync_image_generate_video`
- `lip-sync-video-config`: `/mweb/v1/video_generate/get_common_config` with `scene=lip_sync_video_generate_video`
- `subject-list`: `/mweb/v1/dreamina_subject/get`

These probes are useful for keeping the CLI/app aware of available models, lip-sync routes, saved subjects, and user voice assets without consuming generation credits.

## Discovered From Frontend Bundles, Not Yet Live-Proved

The 2026-06-09 JS bundle sweep found these useful endpoint groups. Treat them as capture targets, not stable contracts, until a real UI flow and dry-run payload are recorded.

| Group | Endpoints |
|---|---|
| Voice cloning / custom voice | `/mweb/v1/voice/submit_task`, `/mweb/v1/voice/query_task`, `/mweb/v1/voice/update`, `/mweb/v1/voice/delete` |
| Subject/persona lifecycle | `/mweb/v1/dreamina_subject/create`, `/mweb/v1/dreamina_subject/update`, `/mweb/v1/dreamina_subject/delete`, `/mweb/v1/dreamina_subject/generate_voice` |
| Infinite canvas | `/mweb/v1/infinite_canvas/create_project`, `/mweb/v1/infinite_canvas/conversation`, `/mweb/v1/infinite_canvas/edit`, `/mweb/v1/infinite_canvas/resume`, `/mweb/v1/infinite_canvas/stop_stream`, `/mweb/v1/infinite_canvas/v1/fetch_snapshot`, `/mweb/v1/infinite_canvas/v1/submit_changeset`, `/mweb/v1/infinite_canvas/v1/fetch_changeset` |
| Reference/image tools | `/mweb/v1/get_common_config`, `/mweb/v1/get_image_description`, `/mweb/v1/get_upload_token`, `/mweb/v1/face_recognize`, `/mweb/v1/algo_proxy` |
| Template/research mining | `/mweb/v1/feed`, `/mweb/v1/get_explore`, `/mweb/v1/feed_short_video`, `/lv/v1/cc_web/replicate/search_templates`, `/lv/v1/cc_web/plane/*` |
| Assets/upload/editor | `/lv/v1/asset/*`, `/lv/v1/editor/image/*` |
| Audio/video utility | `/mweb/v1/mix_audio_video`, `/mweb/v1/mix_audio_videos`, `/lv/v2/intelligence/tts/curl_sync_everphoto` |

The scan artifacts stay local-only under ignored:

```txt
data/jimeng-lab/js-sweep/endpoint-index.json
data/jimeng-lab/js-sweep/focused-snippets.json
```

## Current Text-To-Image Workbench Contract

Submit:

```txt
POST /mweb/v1/aigc_draft/generate
```

Key body fields:

- `submit_id`: UUID generated client-side.
- `extend.root_model`: e.g. `high_aes_general_v50`.
- `extend.workspace_id`: current workspace id.
- `metrics_extra`: JSON string; contains `generateId`, `sceneOptions`, generation metadata.
- `draft_content`: JSON string.
- Prompt path:

```txt
draft_content.component_list[0].abilities.generate.core_param.prompt
```

Model/resolution fields observed:

```txt
model: high_aes_general_v50
model_name: 图片5.0 Lite
resolution_type: 2k
intelligent_ratio: true
```

Submit response:

```txt
data.aigc_data.submit_id
data.aigc_data.history_record_id
data.aigc_data.status
data.aigc_data.queue_info
```

Poll/list:

```txt
POST /mweb/v1/get_asset_list
```

Current completion signal:

```txt
data.asset_list[0].image.status = 50
data.asset_list[0].image.finished_image_count = total_image_count
data.asset_list[0].image.item_list.length > 0
```

Image URL paths:

```txt
image.item_list[].image.large_images[].image_url
image.item_list[].common_attr.cover_url_map["4096" | "2400" | "1080"]
```

## Useful Future Capture Targets

Capture one flow at a time:

- richer image reference controls
- image-to-image / byte edit
- subject/persona creation
- voice cloning and subject voice generation
- pose/style/depth/canny reference controls
- image-to-video end-frame and multi-frame controls
- multimodal/all-around reference video
- video text generation with current unified app route
- lip sync and voice/digital-human tools
- canvas edit operations: inpaint, erase, expand, cutout
- asset library search/import/export
- model/config endpoints for available GenAI tools
- explore/feed/template detail endpoints for niche research and template mining

## Safety Notes

- Keep generation concurrency at `1`.
- Dry-run before live submit.
- Stop on auth challenges, CAPTCHA, `ret=1019`, or `shark not pass`.
- Do not commit raw captures, session bundles, cookies, signed URLs, or generated media.
- Treat signed artifact URLs as expiring; download immediately into ignored `data/**`.
