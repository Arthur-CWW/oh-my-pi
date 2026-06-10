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
| `/mweb/v1/aigc_draft/generate` | POST | Unified workbench submit for current text-to-image, text-to-video, first-frame image-to-video, and lip-sync draft generation paths. | Implemented for workbench text-to-image, text-to-video templates, and local-upload-backed image-to-video; dry-run-proved for VOD and image/avatar lip-sync provider inputs |
| `/mweb/v1/get_asset_list` | POST | Poll/list workspace assets and completed image results. | Implemented for workbench text-to-image |
| `/mweb/v1/get_history_by_ids` | POST | Older/general task polling by `submit_id`. | Implemented for captured history-based templates |
| `/mweb/v1/creation_agent/v2/conversation` | POST/SSE | Older agent text-to-image conversation submit. | Preserved |
| `/mweb/v1/creation_agent/v2/get_agent_config` | POST | Agent/tool configuration payload. | Cataloged only |
| `/mweb/v1/creation_agent/v2/skill/list` | POST | Available agent skills/tools. | Cataloged only |
| `/mweb/v1/video_generate/get_common_config` | POST | Video model/common configuration by scene, including lip-sync image/video scenes. | Implemented for config catalog |
| `/mweb/v1/get_user_local_item_list` | POST | User local/generated item lists; `effect_type=218` returns current user's cloned voices. | Implemented for config catalog |
| `/mweb/v1/dreamina_subject/get` | POST | Saved subject/persona list. | Implemented as no-spend `subjects`; current account returned zero saved subjects |
| `/mweb/v1/dreamina_subject/create` | POST | Create saved subject/persona from a main reference image. | Implemented as no-spend `subject-create`; live-proved with local ImageX upload, audit, image lookup, and create |
| `/mweb/v1/feed` | POST | Explore/feed content; a signed `dreamina_tone` feed request returns the built-in voice library. Useful for research/template mining if handled carefully. | Implemented for voice library replay |
| `/mweb/v1/tts_generate` | POST | Built-in voice text-to-speech. Returns base64 MP3 in `data.data`. | Implemented and live-proved |
| `/mweb/v1/get_upload_token` | POST | Temporary upload credentials for video/image/file scenes. Required before direct local reference-image/video upload. | Implemented and live-proved; local ImageX image upload is implemented via `upload-image`, local VOD video upload via `upload-video` |
| `/mweb/v1/get_explore` | POST | Explore examples, public creative templates, and short-video examples for prompt/template/reference mining. | Implemented as no-spend `templates` and `short-videos` |
| `/mweb/v1/feed_short_video` | POST | Overseas/alternate short-video feed for reference/profile mining. | Implemented as no-spend `overseas-short-videos` |
| `/mweb/v1/get_image_description` | POST | Image prompt/description extraction for uploaded provider image URIs. Useful for persona/reference inspection. | Implemented as no-spend `describe-image` |
| `/mweb/v1/face_recognize` | POST | Face/keypoint probe for uploaded provider image URIs. Useful for reference/persona validation before generation payloads. | Implemented as no-spend `describe-image` |
| `/mweb/v1/blend_preview` | POST | No-spend preview extraction for pose/depth/canny ControlNet reference images. | Implemented as `controlnet-preview`; pose/depth/canny live-proved |
| `/mweb/v1/pose_detect` | POST | Pose validation for ControlNet pose references. | Implemented as part of `controlnet-preview --control pose`; live-proved |
| `/mweb/v1/saliency_seg` | POST | Object/mask segmentation for reference-image object-detection and background-paint flows. | Implemented as no-spend `object-mask`; canvas/default modes live-proved |
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

## Confirmed Lip-Sync Planning Contracts

The frontend exposes two useful lip-sync branches under the same submit endpoint. Both are currently implemented as dry-run planning only; live generation remains disabled until a real UI submit is captured and compared.

| Branch | Model key | Provider-input path | Current proof |
|---|---|---|---|
| VOD/user-video lip-sync | `dreamina_lib_sync_base` | `videoGenInputs.v2vOpt.lipSyncUserVideo` | `data/jimeng-lab/proof-20260610-lip-sync-vod-plan/` |
| Image/avatar lip-sync | `dreamina_lib_sync_image_quick_1.5` | `videoGenInputs.i2vOpt.realmanAvatar` | `data/jimeng-lab/proof-20260610-lip-sync-image-plan/` |

Image/avatar dry-run command:

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

Observed safe image/avatar summary:

```txt
mode=image
image_uri=tos-cn-i-tb4s082cfz/487472ac3b204caa89fc1b2764c0aa1e.png
width=2048
height=2048
tts_source=text-to-speech
tone_id=7597003459665072686
summary_sha256=ed087e3df60ae9c30dc835d2d410867670229abfb115adb186846aa1aa631fc6
```

Local image/avatar mode uploads the image through the confirmed ImageX scene `2` path before writing the dry-run plan. Raw upload traces remain ignored under `data/**`.

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

## Confirmed Reference Image Inspection Contract

`jimeng-browser-proxy describe-image` is live-proved as a no-generation probe. It accepts either a local image file, uploaded through the confirmed ImageX scene `2` path, or an existing Jimeng/ImageX provider URI.

Description request:

```txt
POST /mweb/v1/get_image_description
```

```json
{ "file_uri": "tos-cn-i-tb4s082cfz/..." }
```

Face recognition request:

```txt
POST /mweb/v1/face_recognize
```

```json
{ "image_uri_list": ["tos-cn-i-tb4s082cfz/..."] }
```

Current CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts describe-image \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --outDir data/jimeng-lab/proof-20260610-reference-image-inspect
```

Safe summary:

```txt
image_uri=tos-cn-i-tb4s082cfz/b8f5124217774661b005916f6ca5bae8.png
description=黑发女人，白色背心。
description_sha256=77b52d1885139655c7279ebedd49c6000564c923af84db4ff812307de9628f5f
face_recognition_ret=0
face_recognition_sha256=aa358db205f856bbd3369effb85576c4a7b6f265f4bdd6a96a8f805ecaa35d03
face_count=0
summary=data/jimeng-lab/proof-20260610-reference-image-inspect/normalized/describe-image-20260609155534-q25boh-summary.json
```

Raw upload traces and response bodies may include signed upload/provider details. They remain ignored under `data/**`.

## Confirmed ControlNet Reference Preview Contract

`jimeng-browser-proxy controlnet-preview` is live-proved as a no-generation probe for Jimeng's reference-image ControlNet path. It accepts a local image, uploads it through the confirmed ImageX scene `2` path when needed, calls `/mweb/v1/blend_preview`, and downloads the returned preview image artifact when a preview URL is present. Pose, depth, and canny/outline controls are all live-proved with the same command.

Frontend bundle constants:

```txt
model=img2img_xl_sft
ability.name=control_net
control names=pose, depth, canny
default strength=60/100 = 0.6
fit modes=center_crop, adapt_to_canvas
```

Preview request:

```txt
POST /mweb/v1/blend_preview
```

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

Pose validation request:

```txt
POST /mweb/v1/pose_detect
```

```json
{ "uri": "tos-cn-i-tb4s082cfz/..." }
```

Current CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts controlnet-preview \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --control pose \
  --outDir data/jimeng-lab/proof-20260610-controlnet-pose-preview
```

Safe summary:

```txt
pose:
image_uri=tos-cn-i-tb4s082cfz/2cb5efccab014a29b171719f4303cb21.png
control=pose
fit_mode=center_crop
strength=0.6
preview_image_uri=tos-cn-i-tb4s082cfz/222b232061324073accaf7992ec3ad87
pose_detected=true
preview_sha256=c9404ff104ba8c380eccada50e1526489b756a6c5380fe512da12ea76f1f0c65
pose_detect_sha256=4f9e4059d904fdb8f6fb8491eb79eab0e609e630dbbcfe29f4a76e53e5c91f5f
preview_artifact=data/jimeng-lab/proof-20260610-controlnet-pose-preview/artifacts/controlnet-preview-20260609162825-rvn7f6-pose-preview.png
summary=data/jimeng-lab/proof-20260610-controlnet-pose-preview/normalized/controlnet-preview-20260609162825-rvn7f6-summary.json

depth:
preview_image_uri=tos-cn-i-tb4s082cfz/df194e1d74a54982ae5ceb151e239c9c
preview_sha256=cfd5828742c4efcfe55608254088ddde59bc3dbd2ac4b49df7ba2dad86cbd396
preview_artifact=data/jimeng-lab/proof-20260610-controlnet-depth-preview/artifacts/controlnet-preview-20260609163638-wworll-depth-preview.png

canny:
preview_image_uri=tos-cn-i-tb4s082cfz/915b0cd6c0c943fc9ab24b5c12e5a26d
preview_sha256=ab6fbaa477cfe91545ede7a482ef319e8663ae2be96e05d1e1b0d3ff40ef6c45
preview_artifact=data/jimeng-lab/proof-20260610-controlnet-canny-preview/artifacts/controlnet-preview-20260609163709-xrv4zg-canny-preview.png
```

The preview artifacts are `1024x1024` PNG control maps: pose skeleton, grayscale depth, and canny outline. Raw blend-preview responses can contain signed preview URLs and remain ignored under `data/**`; normalized summaries intentionally record only provider URIs, booleans, hashes, request shapes, and local artifact paths.

## Confirmed Object/Saliency Segmentation Contract

`jimeng-browser-proxy object-mask` is live-proved as a no-generation probe for Jimeng's reference-image object detection and mask extraction path. It accepts a local image, uploads it through the confirmed ImageX scene `2` path when needed, calls `/mweb/v1/saliency_seg`, and downloads returned mask PNG artifacts when mask URLs are present.

Frontend bundle evidence:

```txt
getSaliencySEG({ imageUriList: [image], mode: "canvas" }, babi_param)
getSaliencySEG({ imageUriList: [image] }, babi_param)
feature_entrance_detail = <entrance>-referenceimage-object_detection
ret=2046 maps to NoSegmentObjectFoundError
ret=2047 maps to SegmentFailedError
```

Direct request shapes:

```txt
POST /mweb/v1/saliency_seg
```

```json
{ "image_uri_list": ["tos-cn-i-tb4s082cfz/..."], "mode": "canvas" }
```

```json
{ "image_uri_list": ["tos-cn-i-tb4s082cfz/..."] }
```

Current CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts object-mask \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --mode both \
  --outDir data/jimeng-lab/proof-20260610-object-mask
```

Safe summary:

```txt
image_uri=tos-cn-i-tb4s082cfz/080999a077994629bbec76c6f344a09a.png
canvas_mask_uri=tos-cn-i-tb4s082cfz/2b0258d421f14b02b6f20a23eeaae0ec
canvas_response_sha256=c903f33db56e3f156b6c9a37a61af8668b87169f1642ea6ac3ce7fee4db1c65a
canvas_artifact=data/jimeng-lab/proof-20260610-object-mask/artifacts/object-mask-20260609165112-8yjxpj-canvas-mask-01.png
default_mask_uri=tos-cn-i-tb4s082cfz/d6641d59e6de4d17be119c0b98506129
default_response_sha256=7c6f74cd237c1ed788e369300eb30ea8c4de67efe3ca5548db4abcaff9ab2abc
default_artifact=data/jimeng-lab/proof-20260610-object-mask/artifacts/object-mask-20260609165112-8yjxpj-default-mask-01.png
summary=data/jimeng-lab/proof-20260610-object-mask/normalized/object-mask-20260609165112-8yjxpj-summary.json
```

Both mask artifacts are `2048x2048` PNGs. Raw segmentation responses can contain signed mask URLs and remain ignored under `data/**`; normalized summaries intentionally record only provider URIs, booleans, hashes, request shapes, and local artifact paths.

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

Focused no-spend config command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts lip-sync-config \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --outDir data/jimeng-lab/proof-20260610-lip-sync-config
```

Latest config proof:

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

Raw config responses include signed model-preview GIF URLs. Normalized summaries omit those URLs.

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

The two lip-sync config endpoints also have a focused command, `jimeng-browser-proxy lip-sync-config`, because they directly parameterize digital-human/image-avatar mode and VOD video lip-sync mode.

## Confirmed Saved Subject / Persona List Contract

`jimeng-browser-proxy subjects` calls `/mweb/v1/dreamina_subject/get` directly with the logged-in browser session. This is a no-generation, no-spend list probe for saved Jimeng subjects/personas.

Request shape:

```json
{
  "cursor": 0,
  "limit": 20
}
```

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts subjects \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 20 \
  --outDir data/jimeng-lab/proof-20260610-subjects
```

Observed proof facts:

```txt
http_status=200
ret=0
errmsg=success
cursor=0
limit=20
subject_count=0
has_more=false
next_cursor=0
response_text_sha256=618858c54ed5d0b298cf37ed03bf29d27042f54e3e999bb143932cec6a3ef31f
proof=data/jimeng-lab/proof-20260610-subjects/
```

The current account returned zero saved subjects, which is still a valid endpoint proof. The normalized fields are ready for future accounts with saved personas:

- `subject_id`
- `name`
- `description`
- `status`
- create/update timestamps
- cover image URI
- cover URL presence, without preserving the signed URL
- image URI count
- voice id count

## Confirmed Saved Subject / Persona Create Contract

`jimeng-browser-proxy subject-create` creates a saved Jimeng subject/persona directly from a local ImageX-uploaded or existing provider image. This is an asset CRUD path, not a generation submit.

Captured UI path:

```txt
资产 -> 主体 -> 创建主体 -> 从本地添加 -> 保存
```

Direct endpoint sequence for local-image mode:

```txt
/mweb/v1/get_upload_token scene=2
ImageX ApplyImageUpload
ImageX direct POST /upload/v1/{StoreUri}
ImageX CommitImageUpload
/mweb/v1/imagex/submit_audit_job
/mweb/v1/get_image_by_uri
/mweb/v1/dreamina_subject/create
```

Create request shape:

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

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts subject-create \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --workspaceId 14199856180236 \
  --name "CLI Kbeauty UGC 2" \
  --description "韩系美妆健身UGC创作者，真实手机自拍参考图。" \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --outDir data/jimeng-lab/proof-20260610-subject-create-cli
```

Observed proof facts:

```txt
http_status=200
ret=0
errmsg=success
subject_id=12352249053442
data_id=12352249053698
main_image_uri=tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png
summary_sha256=52a8d7ba8acf00de72912228a5d1ab1ea0d96edea5adf8be44744d2092258dec
proof=data/jimeng-lab/proof-20260610-subject-create-cli/
```

Normalized summaries redact signed image URLs. Raw upload, lookup, and create responses stay ignored under `data/**`.

## Confirmed Explore / Template Mining Contract

`jimeng-browser-proxy templates` now calls `/mweb/v1/get_explore` directly with the logged-in browser session. This is a no-generation, no-spend endpoint for mining public creative examples, prompt structure, model keys, usage/favorite counts, and template feature labels.

Request shape:

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

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts templates \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 5 \
  --category-id 11222 \
  --work-types image,video,canvas \
  --outDir data/jimeng-lab/proof-20260610-templates-explore
```

Observed proof facts:

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
proof=data/jimeng-lab/proof-20260610-templates-explore/
```

The response embeds reusable prompt/model evidence in `aigc_draft.content.component_list[].abilities.generate.core_param`. The CLI normalizes:

- `prompt`
- `model_req_key`
- `seed`
- `image_ratio`
- template type / AI feature labels
- usage, favorite, and play counts
- cover dimensions/aspect ratio
- metadata template id/type

Quirk: the endpoint returned 40 items for a request with `count=5`, while still setting `next_offset=5`. Treat `count` as a paging hint, not a hard returned-item cap.

## Confirmed Short-Video Explore Mining Contract

`jimeng-browser-proxy short-videos` uses the same `/mweb/v1/get_explore` endpoint with `filter.work_type_list=["short_video"]`. This is a no-generation, no-spend path for mining public short-video examples, video metadata, and ranking signals that can seed reference-profile and niche research workflows.

Request shape:

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

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts short-videos \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 5 \
  --category-id 11222 \
  --outDir data/jimeng-lab/proof-20260610-short-videos-explore
```

Observed proof facts:

```txt
http_status=200
ret=0
errmsg=success
requested_count=5
returned_total=20
next_offset=5
category_id=11222
feed_refer=feed_enterauto
top_play_num=1718727
top_video_duration=85s
top_video_resolution=1280x720
top_video_fps=15
top_video_has_audio=true
proof=data/jimeng-lab/proof-20260610-short-videos-explore/
```

The normalized short-video fields intentionally omit signed `video_url` values while retaining durable metadata:

- `video_id`
- `duration_sec` / `duration_ms`
- width, height, fps, definition, format, codec, size
- `has_audio` / `is_mute`
- available transcoded definitions
- play, favorite, comment, and share counts
- metadata effect id/type, currently including `gen_story` / `tool`

## Confirmed Overseas Short-Video Feed Contract

`jimeng-browser-proxy overseas-short-videos` calls `/mweb/v1/feed_short_video` directly with the logged-in browser session. This is a no-generation, no-spend path for an alternate short-video feed discovered in the frontend bundle as `GET_OVERSEAS_SHORT_VIDEO`.

Request shape:

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

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts overseas-short-videos \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 5 \
  --category-id 11222 \
  --outDir data/jimeng-lab/proof-20260610-overseas-short-videos
```

Observed proof facts:

```txt
http_status=200
ret=0
errmsg=success
requested_count=5
returned_total=4
next_offset=5
category_id=11222
feed_refer=feed_enterauto
top_play_num=2382533
top_video_duration=57s
top_video_resolution=3840x2160
top_video_fps=30
top_video_has_audio=true
response_text_sha256=dc3ef47f5dd45b9f2681da88f502f39f3ce0ac2b512259f375d70665f63c0487
proof=data/jimeng-lab/proof-20260610-overseas-short-videos/
```

The live response currently uses snake_case `data.item_list`, while the frontend bundle's domain path references camelCase `itemList`/`commonAttr`. The CLI parser accepts both. Normalized output redacts signed cover URLs from item lists while retaining durable cover presence/dimensions, video metadata, ranking signals, and metadata effect ids.

## Confirmed CapCut Template Category Contract

`jimeng-browser-proxy capcut-categories` calls the read-only CapCut editor API category endpoint discovered in the Jimeng/Dreamina frontend bundle. This endpoint does not consume generation quota and does not require CapCut cookies in the current proof; it uses the frontend's CapCut request signer with `pf=7`, `appvr=5.8.0`, `app-sdk-version=999.999.999`, and `sdk_version=16.1.0`.

Command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-categories \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --outDir data/jimeng-lab/proof-20260610-capcut-categories
```

Confirmed endpoint:

```txt
POST https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_categories
request={"sdk_version":"16.1.0"}
```

Latest proof returned eight commercial template category groups:

```txt
Black Friday
Clothing and shoes
Cosmetic dailyization
Food beverages
Jewelry
Furniture
Consumer electronics
pets
response_text_sha256=27f4e1bc5a3ff2ddf94568b77d068db828807ab3aa12be3c484588b1b4ff3ea0
raw=data/jimeng-lab/proof-20260610-capcut-categories/raw/capcut-categories-20260609230631.json
summary=data/jimeng-lab/proof-20260610-capcut-categories/normalized/capcut-categories-20260609230631-summary.json
```

Related bundle endpoints are discovered but not claimed as implemented yet:

- `/lv/v1/cc_web/replicate/search_templates`: helper contract found, but guessed keyword/query/search-word payloads returned `ret=1000 param error`; needs real UI capture.
- `/lv/v1/cc_web/plane/get_collection_templates` and `/lv/v1/cc_web/plane/batch_get_collection_templates`: helper contract found, but category-id guesses returned `ret=1000 param error`; needs real UI capture.
- `/lv/v1/cc_web/plane/fuzzy_search_templates`: accepts POSTs and returns success, but all tested English title/query fields returned empty lists, so it is not exposed as implemented.

## Confirmed CapCut Public Template Metadata Contract

`jimeng-browser-proxy capcut-template-metadata` fetches two public static CapCut template metadata JSON files discovered in the same frontend bundle. This path does not require a Jimeng or CapCut session and does not consume generation quota.

Command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-template-metadata \
  --outDir data/jimeng-lab/proof-20260610-capcut-template-metadata
```

Confirmed endpoints:

```txt
GET https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_49/bee_prod_49_bee_publish_709.json
GET https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_149/bee_prod_149_bee_publish_835.json
```

Frontend evidence:

```txt
GetAllTemplateRatio=url(k.U8.mercury + "/biz_49/bee_prod_49_bee_publish_709.json")
GetTemplateScenes=url(k.U8.mercury + "/biz_149/bee_prod_149_bee_publish_835.json")
k.U8.mercury="https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod"
```

Latest proof:

```txt
ratio_count=6
scene_count=33
ratios_response_text_sha256=18b2d8e274f0a129fdbec437f5c9b28a2cfad89dd94807d63efb4325ed5ace41
scenes_response_text_sha256=aa409da2647ee22a9025d17835055ffd34450b1c07783ea54a1909fa367e286d
first_scenes=Instagram post:1080x1080 | Instagram story:1080x1920 | Instagram portrait:1080x1350 | Tiktok:1080x1920 | YouTube thumbnail:1280x720 | YouTube intro:1920x1080 | YouTube end screen:1920x1080 | Facebook post:940x788
raw=data/jimeng-lab/proof-20260610-capcut-template-metadata/raw/capcut-template-metadata-20260609231824.json
summary=data/jimeng-lab/proof-20260610-capcut-template-metadata/normalized/capcut-template-metadata-20260609231824-summary.json
```

## Discovered From Frontend Bundles

The 2026-06-09 JS bundle sweep found these useful endpoint groups. Treat rows without an implemented status as capture targets, not stable contracts, until a real UI flow and dry-run payload are recorded.

| Group | Endpoints |
|---|---|
| Voice cloning / custom voice | `/mweb/v1/voice/submit_task`, `/mweb/v1/voice/query_task`, `/mweb/v1/voice/update`, `/mweb/v1/voice/delete` |
| Subject/persona lifecycle | `/mweb/v1/dreamina_subject/get`, `/mweb/v1/dreamina_subject/create`, `/mweb/v1/dreamina_subject/update`, `/mweb/v1/dreamina_subject/delete`, `/mweb/v1/dreamina_subject/generate_voice`; list is implemented as `subjects`, create is implemented as `subject-create`, while update/delete/generate_voice remain capture targets |
| Infinite canvas | `/mweb/v1/infinite_canvas/create_project`, `/mweb/v1/infinite_canvas/conversation`, `/mweb/v1/infinite_canvas/edit`, `/mweb/v1/infinite_canvas/resume`, `/mweb/v1/infinite_canvas/stop_stream`, `/mweb/v1/infinite_canvas/v1/fetch_snapshot`, `/mweb/v1/infinite_canvas/v1/submit_changeset`, `/mweb/v1/infinite_canvas/v1/fetch_changeset` |
| Reference/image tools | `/mweb/v1/get_common_config`, `/mweb/v1/get_image_description`, `/mweb/v1/get_upload_token`, `/mweb/v1/face_recognize`, `/mweb/v1/blend_preview`, `/mweb/v1/pose_detect`, `/mweb/v1/saliency_seg`, `/mweb/v1/algo_proxy`; image upload, description, face recognition, ControlNet pose/depth/canny preview, pose detect, and object/saliency segmentation are now implemented, while style/reference payload tools still need CLI coverage |
| Template/research mining | `/mweb/v1/feed`, `/mweb/v1/feed_short_video`, `/lv/v1/cc_web/plane/get_categories`, public CapCut `bee_prod` metadata JSON, `/lv/v1/cc_web/replicate/search_templates`, `/lv/v1/cc_web/plane/*`; `/mweb/v1/get_explore` is implemented for direct Explore templates and short-video examples, `/mweb/v1/feed_short_video` is implemented as `overseas-short-videos`, CapCut category catalog is implemented as `capcut-categories`, and public CapCut ratio/scene metadata is implemented as `capcut-template-metadata`; CapCut template rows/search/collection endpoints remain capture targets |
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
- subject/persona update/delete/generate_voice
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
