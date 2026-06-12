# Jimeng/Dreamina Frontend API Reversal Plan

## Goal

Map the real Jimeng/Dreamina frontend APIs well enough to support reliable direct-client workflows in `packages/jimeng-client`, especially true image-to-video / first-frame / multimodal video generation.

The immediate fix is to stop reusing stale templates for operations whose frontend contracts have moved. Current architecture should use the background Jimeng browser profile as a session/token holder, then graduate stable captured contracts into direct `fetch` clients.

Current method: use the packet factory in [`jimeng-fast-contract-extraction.md`](./jimeng-fast-contract-extraction.md), not endpoint-by-endpoint manual reversal. A session should select a value-ranked packet, write a packet manifest, gather only the required live/passive/replay samples, run `contract-infer`, promote generated schema/client/CLI/test/registry/docs drafts, then verify with replay/Vitest/typecheck.

For the long-running `/goal` spec, priority model, proof rules, and copy/paste command, see [`jimeng-dreamina-cli-goal.md`](./jimeng-dreamina-cli-goal.md) and [`jimeng-dreamina-cli-goal-command.md`](./jimeng-dreamina-cli-goal-command.md).

## Current Status

2026-06-09 first proxy slice:

- Added `jimeng-browser-proxy` CLI for background CDP session refresh plus direct-client generation.
- Captured current `/ai-tool/generate/?type=image` workbench text-to-image flow.
- Implemented current image submit through `/mweb/v1/aigc_draft/generate`.
- Implemented current image polling/download through `/mweb/v1/get_asset_list`.
- Preserved older `/mweb/v1/creation_agent/v2/conversation` SSE image path.
- Added endpoint catalog at `docs/provider/jimeng-frontend-api-catalog.md`.
- Smoke proof at `docs/qa/jimeng-browser-proxy-smoke.md`.

2026-06-09 voice/API catalog slice:

- Added `packages/jimeng-client/src/catalog.ts` for non-generating Jimeng catalog probes.
- Added `catalog`, `voices`, `tts`, and `sample-voices` commands to `browser-proxy-cli`.
- Confirmed direct config/list probes for agent skills, agent model config, cloned voice assets, lip-sync image/video config, and subject list.
- Replayed a captured signed `dreamina_tone` `/mweb/v1/feed` request to normalize the built-in voice library.
- Confirmed `/mweb/v1/tts_generate` direct TTS with a built-in voice id; response is base64 MP3 in `data.data`.
- Generated the current built-in voice sample set, 142/142 MP3s, under ignored `data/jimeng-lab/voice-library-samples/`.
- Scanned current frontend JS bundles and recorded additional UGC-useful endpoint groups for voice cloning, subject/persona lifecycle, infinite canvas, reference/image tools, templates, assets, and audio/video utilities.

2026-06-09 upload-token slice:

- Added `upload-token` to `browser-proxy-cli`.
- Confirmed `/mweb/v1/get_upload_token` for scenes `1`, `2`, and `3`.
- Scene `2` is the ImageX upload-token path needed for local reference images; observed `region=cn`, `spaceName=tb4s082cfz`.
- Added a proof bundle with playable TTS + video artifacts at `data/jimeng-lab/proof-20260609-voice-video/`.
- `/lv/v1/asset/prepare_upload_cloud` returned `404` from the Jimeng domain with a simple replay; keep it as a CapCut/LV-domain or signed-header lead, not the current Jimeng path.

2026-06-09 ImageX upload slice:

- Added ImageX AWS4-style signing, `ApplyImageUpload`, direct `/upload/v1/{StoreUri}` byte upload, and `CommitImageUpload` helpers to `packages/jimeng-client/src/upload.ts`.
- Added `jimeng-browser-proxy upload-image --file <path>`.
- Live-proved a local PNG to committed ImageX URI:
  `tos-cn-i-tb4s082cfz/97c32453461a4041b4f6e20f1dc0a517.png`.
- Proof bundle:
  `data/jimeng-lab/proof-20260609-image-upload/`.
- This unblocks first-frame image-to-video payload patching with real provider URIs.

2026-06-09 image-to-video first-frame slice:

- Added `jimeng-browser-proxy image2video`.
- `--image <path>` uploads a local first-frame image through the confirmed ImageX scene `2` path before patching `first_frame_image`.
- `--firstFrameUri <uri>` reuses an existing provider URI without another upload.
- Exposed video parameter flags for later pipeline use: `--durationSec`, `--ratio`, `--videoResolution`, `--modelVersion`, `--modelReqKey`, and `--seed`.
- Live-proved a Korean-beauty UGC reference image to MP4:
  `data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4`.
- Next slice is VOD/video upload, then end-frame/multi-frame/reference controls.

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

Current implementation:

```txt
packages/jimeng-client/src/network-recorder.ts
```

Help-only run:

```bash
bun packages/jimeng-client/src/network-recorder.ts --help
```

Store raw traces only under ignored paths:

```txt
data/jimeng-captures/<timestamp>-<flow>/raw-network.jsonl
data/jimeng-captures/<timestamp>-<flow>/capture-template.raw.json
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
| Upload token | Done | `/mweb/v1/get_upload_token` scenes `1`/`2`/`3`; scene `2` is image upload token |
| Text-to-image | Medium | current workbench path implemented; keep cataloging model/config variants |
| Text-to-video | Medium | current template parity and task statuses |
| Image-to-video / first-frame | Highest | correct first-frame payload field(s), asset IDs, abilities path |
| Multimodal/reference-to-video | Highest | reference image arrays, strength/role fields, generation mode |
| Task history/status | High | polling endpoint variants, terminal statuses, queue info |
| Artifact download | High | highest-quality video URL fields, expiry behavior |
| Persona/subject/character tools | High | subject model lifecycle, reference storage, persona-like reusable assets |
| Built-in voice library + TTS | Done | signed voice feed replay and direct `/mweb/v1/tts_generate` MP3 generation |
| Voice cloning / subject voice generation | High | custom voice submit/query, persona voice generation, required upload/audio contracts |
| Lip sync / digital human config | Medium | config probes implemented; generation flow still needs capture |
| Canvas edit tools | Medium | inpaint, erase, expand, cutout, local edit payloads |
| Explore/template mining | Medium | public template/feed detail endpoints for clean-room format abstraction |

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

- `catalog.ts` for stable non-generating config/list and voice/TTS helpers (implemented in current slice)
- `upload.ts` for upload-token retrieval and later reference image upload/session asset handling (token step implemented; byte upload still pending)
- stronger `capture.ts` template extraction and patching helpers
- operation types:
  - `image_text`
  - `video_text`
  - `video_image_first_frame`
  - `video_multimodal_reference`
  - `audio_tts`
  - `voice_clone`
  - `subject_create`
  - `canvas_edit`
- CLI flags:
  - `--op video-image`
  - `--image <path>`
  - `--reference-role first-frame|style|character`
  - `--dryRun`
  - `--capture <redacted-or-local-capture>`
- redacted fixture tests close to existing tests

Do not run live submits until dry-run payloads match captured frontend requests.

Current implemented helpers:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts catalog
bun packages/jimeng-client/src/browser-proxy-cli.ts voices --capture <capture-template.raw.json>
bun packages/jimeng-client/src/browser-proxy-cli.ts tts --voice-id <id> --text <zh-text> --dryRun
bun packages/jimeng-client/src/browser-proxy-cli.ts sample-voices --limit 2 --dryRun
bun packages/jimeng-client/src/browser-proxy-cli.ts upload-token --scene image
```

`catalog` and `voices` are read/replay paths, but still require a valid session. `tts` and `sample-voices` create audio artifacts and may consume quota; keep concurrency `1`.
`upload-token` is a read/token path whose raw response contains temporary credentials; keep raw output under ignored `data/**`.

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

Events worth recording and currently covered by `network-recorder.ts`:

- `Network.requestWillBeSent`
- `Network.requestWillBeSentExtraInfo`
- `Network.responseReceived`
- `Network.responseReceivedExtraInfo`
- `Network.loadingFinished`
- `Network.getResponseBody`
- `Network.getRequestPostData`
- `Network.webSocketFrameReceived`
- `Network.webSocketFrameSent`

Preferred attach modes:

```bash
# Attach to an existing Jimeng tab; useful when Arthur is manually driving the UI.
bun packages/jimeng-client/src/network-recorder.ts \
  --target-url jimeng.jianying.com \
  --flow image2video-upload \
  --durationSec 0

# Create a background target; useful for passive page-load/session endpoint capture.
bun packages/jimeng-client/src/network-recorder.ts \
  --flow session-refresh \
  --durationSec 180
```

## Handoff prompt for a worker agent

```txt
You are the Jimeng/Dreamina API reversal lane in /Users/arthur/projects/pi-web-access.
Read docs/plans/README.md and docs/plans/jimeng-frontend-api-reversal.md.
Only edit packages/jimeng-client/**, docs/provider/**, and docs/plans/jimeng-frontend-api-reversal.md unless explicitly handed off.
Current direct-client baseline includes workbench text-to-image, config catalog probes, signed built-in voice feed replay, direct TTS, ImageX local image upload, and first-frame image-to-video with MP4 proof.
Next capture targets are VOD/video upload, end-frame/multi-frame image-to-video, pose/style/depth/canny reference controls, voice clone submit/query, dreamina_subject create/update/generate_voice, multimodal video, lip sync generation, infinite canvas edits, and template mining.
Use the background-CDP network recorder for one flow at a time. Dry-run payloads before live calls; keep concurrency 1; stop on 1019/shark-not-pass. Do not commit cookies, captures, session bundles, signed URLs, or generated media.
```
