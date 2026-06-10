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

## Verification

```bash
bun run jimeng:typecheck
bun run jimeng:test
bun packages/jimeng-client/src/browser-proxy-cli.ts --help | rg 'lip-sync-config|voice-clones|voice-clone-submit|capcut-template-metadata|capcut-categories|overseas-short-videos|subject-create|subject-update|subject-delete|subject-generate-voice|subjects|templates|short-videos'
```

Result:

```txt
typecheck passed
80 tests passed, 0 failed
browser-proxy help listed lip-sync-config, voice-clones, voice-clone-submit, capcut-template-metadata, overseas-short-videos, capcut-categories, subject-create, subject-update, subject-delete, subject-generate-voice, subjects, templates, and short-videos
```

## Follow-Up

Next useful captures:

- image-to-image / byte edit
- subject/persona generate_voice live submit after explicit spend approval or captured UI submit
- style reference controls
- additional template/research endpoints: CapCut template search and plane row/collection endpoints
- image-to-video end-frame and multi-frame live proof with explicit frontend mode capture
- multimodal/all-around reference video
- lip-sync live submit capture/compare before enabling generation
- video text generation through the current unified app route
- voice clone live submit/mutation and subject/persona voice generation
- canvas edit tools
