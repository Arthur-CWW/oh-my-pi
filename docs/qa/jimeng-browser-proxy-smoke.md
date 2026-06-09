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

## Verification

```bash
bun run jimeng:typecheck
bun run jimeng:test
```

Result:

```txt
typecheck passed
23 tests passed, 0 failed
```

## Follow-Up

Next useful captures:

- image-to-image / byte edit
- subject/persona creation
- pose/style/depth/canny reference controls
- image-to-video first-frame
- multimodal/all-around reference video
- video text generation through the current unified app route
- voice cloning and subject/persona voice generation
- canvas edit tools
