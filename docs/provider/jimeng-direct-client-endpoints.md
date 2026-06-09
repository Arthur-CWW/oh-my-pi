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
- full first/last frame direct upload path without browser-assisted upload
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

Supports optional frame URI injection for video payload patching:
- `--firstFrameUri <uri>`
- `--lastFrameUri <uri>`

> Note: this is payload-level injection only; direct upload-to-URI mapping still needs reversing.

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
| `image2video` | partial | Can inject confirmed `--firstFrameUri`; local file upload-to-URI still needs reversal. |
| `frames2video` | partial | Can inject confirmed `--firstFrameUri`/`--lastFrameUri`; local frame upload still needs reversal. |
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
1. Capture and isolate asset upload endpoint used before first/last frame submit.
2. Confirm direct upload response shape (expected URI/object key fields).
3. Inject returned upload identifiers into `video_gen_inputs[0].first_frame_image`/`end_frame_image` and replay without browser runtime.
4. Add strict `1019` shark breaker/cooldown budgets to the consolidated CLI path.
