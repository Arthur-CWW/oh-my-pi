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

## Endpoint catalog (confirmed)

### 1) Image submit (agent path)
- `POST https://jimeng.jianying.com/mweb/v1/creation_agent/v2/conversation`
- Request shape:
  - `conversation_id`
  - `messages[0].content.content_parts[0].text` = prompt
- Response type:
  - `text/event-stream`
- Follow-up:
  - parse stream for submit info, then poll `get_history_by_ids`
- current utility: `src/shared/jimeng-sse.ts` (`extractSubmitIdFromSseText`) for resilient submit-id extraction

### 2) Video submit (workbench path)
- `POST https://jimeng.jianying.com/mweb/v1/aigc_draft/generate`
- Request shape:
  - `submit_id`
  - `metrics_extra` (JSON string)
  - `draft_content` (JSON string)
  - `http_common_info.aid`
- Prompt field location:
  - `draft_content.component_list[0].abilities.gen_video.text_to_video_params.video_gen_inputs[0].prompt`
- Duration field location:
  - `...video_gen_inputs[0].duration_ms`
- First/last frame fields (if used):
  - `...video_gen_inputs[0].first_frame_image`
  - `...video_gen_inputs[0].end_frame_image`

### 3) Poll status/results
- `POST https://jimeng.jianying.com/mweb/v1/get_history_by_ids`
- Payload variants observed:
  - `{ "submit_ids": ["<submit_id>"] }`
  - `{ "submit_ids": ["<submit_id>"], "need_batch": true, "history_ids": [] }`
- Terminal success seen:
  - video: `status = 50`
  - image: `status = 45` (observed in earlier image path)

### 4) Optional queue status
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

## Current CLI entrypoint
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

Supports optional frame URI injection for video payload patching:
- `--firstFrameUri <uri>`
- `--lastFrameUri <uri>`

> Note: this is payload-level injection only; direct upload-to-URI mapping still needs reversing.

## Next reverse target (immediate)
1. Capture and isolate asset upload endpoint used before first/last frame submit.
2. Confirm direct upload response shape (expected URI/object key fields).
3. Inject returned upload identifiers into `video_gen_inputs[0].first_frame_image`/`end_frame_image` and replay without browser runtime.
4. Add strict `1019` shark breaker/cooldown budgets to the consolidated CLI path.
