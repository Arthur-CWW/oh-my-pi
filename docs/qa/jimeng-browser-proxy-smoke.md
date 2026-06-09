# Jimeng Browser Proxy Smoke

Date: 2026-06-09

## Claim

The logged-in background Jimeng browser profile can be used as a session holder while the local CLI prepares/direct-submits current workbench image-generation requests. The old direct client was fixed to support the current `/mweb/v1/aigc_draft/generate` text-to-image path and `get_asset_list` polling.

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

## Verification

```bash
bun run jimeng:typecheck
bun run jimeng:test
```

Result:

```txt
typecheck passed
15 tests passed, 0 failed
```

## Follow-Up

Next useful captures:

- reference image upload
- image-to-image / byte edit
- subject/persona creation
- pose/style/depth/canny reference controls
- image-to-video first-frame
- multimodal/all-around reference video
- video text generation through the current unified app route
- canvas edit tools
