# Jimeng/Dreamina Frontend API Reversal Plan

## Goal

Map the real Jimeng/Dreamina frontend APIs well enough to support reliable direct-client workflows in `packages/jimeng-client`, especially true image-to-video / first-frame / multimodal video generation.

The immediate fix is to stop reusing the old text-to-video capture template for image-to-video runs.

## Owner paths

This lane may edit:

- `packages/jimeng-client/**`
- `docs/provider/**`
- `docs/plans/jimeng-frontend-api-reversal.md`

Runtime artifacts should stay ignored under:

- `data/jimeng-captures/**`
- `data/jimeng-lab/**`
- `data/coordination/jimeng-reversal.status.md`

Avoid editing root `package.json`, root configs, pipeline serialization docs, or Twitter archive files without handoff.

## Safety and quota policy

- Prefer help/inspection and dry-runs first.
- Live generation can consume paid quota: keep concurrency `1`.
- Stop on `ret=1019`, `shark not pass`, auth challenges, CAPTCHA, or new terms prompts.
- Do not brute-force retries.
- Do not commit cookies, session bundles, raw private captures, or generated media.
- Use background CDP capture only; do not open DevTools UI or steal focus.

## Phase 0: Official CLI capability inventory

Safe commands:

```bash
dreamina --help
dreamina image2video --help || true
dreamina text2video --help || true
dreamina multimodal2video --help || true
dreamina text2image --help || true
dreamina image2image --help || true
dreamina user_credit || true
```

Record findings in:

```txt
data/coordination/jimeng-reversal.status.md
```

Questions:

- Which commands exist?
- Which are blocked for the current `artisan` account vs `maestro vip`?
- Are any non-video commands usable and useful for reference assets?
- Does CLI expose upload or task-status endpoints?

## Phase 1: Background frontend network recorder

Use CDP in the dedicated frontend browser profile. Capture:

- request URL/method
- selected headers: content-type, user-agent, origin, referer, auth/cookie presence marker, not raw cookies in committed docs
- request body/post data
- response status/mime/body when JSON/SSE
- WebSocket sent/received frames
- timing and initiator stack if available

Store raw traces only under ignored paths:

```txt
data/jimeng-captures/<timestamp>-<flow>/raw-network.jsonl
data/jimeng-captures/<timestamp>-<flow>/redacted-summary.md
```

Redact before any committed docs/tests:

- cookies/session tokens
- signed URLs after preserving URL path shape and query key names
- account IDs if sensitive
- request signatures if reusable

## Phase 2: Flow matrix to capture

Capture one flow at a time and write a short redacted summary.

| Flow | Priority | Expected discoveries |
|---|---:|---|
| Account/credits/session refresh | High | auth bundle, app IDs, user tier, credit payload |
| Upload reference image | High | upload endpoint, object URI/id schema, signed upload/download URLs |
| Text-to-image | Medium | image submit path and polling result shape |
| Text-to-video | Medium | current template parity and task statuses |
| Image-to-video / first-frame | Highest | correct first-frame payload field(s), asset IDs, abilities path |
| Multimodal/reference-to-video | Highest | reference image arrays, strength/role fields, generation mode |
| Task history/status | High | polling endpoint variants, terminal statuses, queue info |
| Artifact download | High | highest-quality video URL fields, expiry behavior |

## Phase 3: Endpoint catalog updates

Update `docs/provider/jimeng-direct-client-endpoints.md` with confirmed facts only:

- endpoint
- method
- request shape
- response shape
- required headers/session fields
- status code mapping
- risk-control/auth errors
- artifact URL extraction paths

Keep speculative notes clearly labeled as speculation.

## Phase 4: Direct client implementation

Likely additions to `packages/jimeng-client`:

- `upload.ts` for reference image upload/session asset handling
- stronger `capture.ts` template extraction and patching helpers
- operation types:
  - `image_text`
  - `video_text`
  - `video_image_first_frame`
  - `video_multimodal_reference`
- CLI flags:
  - `--op video-image`
  - `--image <path>`
  - `--reference-role first-frame|style|character`
  - `--dryRun`
  - `--capture <redacted-or-local-capture>`
- redacted fixture tests close to existing tests

Do not run live submits until dry-run payloads match captured frontend requests.

## Phase 5: Validation run

A good validation run for the seal concept:

- Use reference image only as first-frame/visual reference.
- Prompt in Chinese.
- Ask for visuals only.
- Explicitly forbid readable text/subtitles/watermarks in generated video.
- Duration 5–6s.
- Do not ask Dreamina to generate audio.

Pass criteria:

- generated clip preserves the seal reference better than old text2video template
- no fake readable text appears
- artifact URLs downloaded immediately
- direct client manifest records operation, submit ID, poll trace, and artifact paths

## Background CDP recorder sketch

Use the background-safe pattern from `packages/web-access/skills/background-browser-automation/SKILL.md`.

Important: attach network listeners to the target page and avoid `Target.activateTarget`, `page.bringToFront`, or DevTools UI.

Events worth recording:

- `Network.requestWillBeSent`
- `Network.requestWillBeSentExtraInfo`
- `Network.responseReceived`
- `Network.responseReceivedExtraInfo`
- `Network.loadingFinished`
- `Network.getResponseBody`
- `Network.getRequestPostData`
- `Network.webSocketFrameReceived`
- `Network.webSocketFrameSent`

## Handoff prompt for a worker agent

```txt
You are the Jimeng/Dreamina API reversal lane in /Users/arthur/projects/pi-web-access.
Read docs/plans/README.md and docs/plans/jimeng-frontend-api-reversal.md.
Only edit packages/jimeng-client/**, docs/provider/**, and docs/plans/jimeng-frontend-api-reversal.md unless explicitly handed off.
First run safe dreamina --help/subcommand inspections and write findings to data/coordination/jimeng-reversal.status.md.
Then design a background-CDP network recorder for Jimeng frontend flows. Do not consume quota or run live generation without confirmation. Do not commit cookies or captures.
```
