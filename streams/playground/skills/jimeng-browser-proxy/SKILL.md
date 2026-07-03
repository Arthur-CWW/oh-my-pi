---
name: jimeng-browser-proxy
description: Use the logged-in background Jimeng/Dreamina browser profile as a session holder, then run the local Jimeng proxy/direct CLI for image, video, reference, persona, and GenAI API reversal workflows.
---

# Jimeng Browser Proxy

Use this skill when Arthur asks to generate with Jimeng/Dreamina, reverse Jimeng APIs, refresh Jimeng tokens, or expose Jimeng generation from CLI/agent workflows.

## Operating Model

Preferred path:

```txt
logged-in background Helium Jimeng profile
→ passive CDP capture for unknown flows
→ browser-proxy CLI refreshes session bundle
→ direct client submits/polls/downloads
```

Do not foreground the browser. Use CDP/background automation and keep live generation concurrency at `1`.

## Safety Rules

- Run dry-runs before live submits.
- Stop on auth challenges, CAPTCHA, new terms prompts, `ret=1019`, or `shark not pass`.
- Do not brute-force retries.
- Do not commit raw captures, cookies, session bundles, signed URLs, or generated media.
- Store runtime captures/media under ignored `data/**`.

## Session Setup

Open or reuse the dedicated profile:

```bash
bun packages/web-access/src/frontend-browser-cli.ts open --provider jimeng --background
```

Check status:

```bash
bun packages/web-access/src/frontend-browser-cli.ts status --provider jimeng
```

If logged out, Arthur must log into the dedicated Helium profile. Do not automate OAuth, QR login, CAPTCHA, passkeys, or 2FA.

Refresh a session bundle from the browser:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts session \
  --cdp http://127.0.0.1:9340 \
  --target-url jimeng.jianying.com \
  --session-out data/jimeng-lab/raw/session-bundle-current.json
```

## Capture Unknown Flows

Record one flow at a time:

```bash
bun packages/jimeng-client/src/network-recorder.ts \
  --cdp http://127.0.0.1:9340 \
  --target-url jimeng.jianying.com \
  --flow text2image-submit \
  --durationSec 90
```

Then inspect:

```bash
rg -n "aigc_draft|creation_agent|get_asset_list|get_history|upload|subject|pose|video" \
  data/jimeng-captures/<run>/redacted-summary.md
```

## Text-To-Image Proxy

Dry-run first:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts text2image \
  --cdp http://127.0.0.1:9340 \
  --target-url "type=image" \
  --capture data/jimeng-captures/<run>/capture-template.raw.json \
  --prompt "韩系美妆健身UGC创作者，手机自拍，无文字，无水印" \
  --outDir data/jimeng-lab/browser-proxy-ugc-image \
  --dryRun
```

Live submit only when intended:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts text2image \
  --cdp http://127.0.0.1:9340 \
  --target-url "type=image" \
  --capture data/jimeng-captures/<run>/capture-template.raw.json \
  --prompt "韩系美妆健身UGC创作者，手机自拍，无文字，无水印" \
  --outDir data/jimeng-lab/browser-proxy-ugc-image \
  --pollIntervalMs 3000 \
  --maxPolls 30
```

## API Catalog

Maintain confirmed endpoint facts in:

```txt
docs/provider/jimeng-frontend-api-catalog.md
docs/provider/jimeng-direct-client-endpoints.md
```

For the UGC app, prioritize APIs for:

- text-to-image
- text-to-video
- image-to-image/reference image
- image-to-video first-frame/pose/style
- persona/subject/character generation
- asset library and workspace assets
- canvas edit tools
- template/explore/feed mining
