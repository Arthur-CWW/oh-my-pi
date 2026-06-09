# Jimeng/Dreamina CLI Extraction Goal

## Outcome

Reverse engineer Jimeng/Dreamina's logged-in frontend GenAI surface into a truthful, tested local CLI surface first. A daemon-backed async job orchestrator is an optimization phase after the API surface settles; do not jump to it yet.

Keep going until every high-value UGC capability reachable from Arthur's logged-in Jimeng frontend is either:

- implemented as a typed CLI command with proof artifacts, or
- documented as blocked/unknown with captured evidence, exact UI path, request traces, and the next probe.

This goal is intentionally coverage-and-proof driven. Do not claim completion because one endpoint works. Completion means the useful reachable frontend surface has been systematically explored, implemented where possible, proven where implemented, and honestly documented where blocked.

## Current Continuation State

As of 2026-06-09, the committed baseline is:

- `65a67bd Add Jimeng browser proxy client`
- `6ba0ae9 Add Jimeng voice catalog and TTS CLI`
- `4567ca0 Add Jimeng upload token probe`
- `6fb9c61 Add Jimeng ImageX image upload CLI`

ImageX local image upload is now committed and live-proved:

- `jimeng-browser-proxy upload-image`
- local ImageX image upload via:
  - `/mweb/v1/get_upload_token` scene `2`
  - ImageX `ApplyImageUpload`
  - direct `POST /upload/v1/{StoreUri}`
  - ImageX `CommitImageUpload`
- tests for deterministic AWS4-style ImageX signing and mocked token/apply/upload/commit sequence
- docs and QA notes showing a live proof URI and local artifact under ignored `data/**`

The next slice is **image-to-video with an uploaded first-frame URI**. Use `upload-image` to turn a real local UGC/Korean-beauty reference image into a `tos-cn-i-*` provider URI, inject it into `first_frame_image`, and prove the full image-to-video command.

## Optimization Target

Maximize useful API coverage and proof quality while keeping live submissions controlled:

- generation submission concurrency is `1` for now
- polling, downloads, passive capture, and local processing can run in the background when safe
- live generation prompts should be Chinese and in-distribution for the UGC use case
- test/proof prompts should generate actually useful Korean-beauty, UGC ad, persona, TikTok-profile, reference-upload, or campaign assets, not toy demos
- map the product's actual account/UI limits and encode them in docs/code
- document observed rate limits, VIP gates, risk gates, payload constraints, model options, option menus, and UI affordances
- expose meaningful API properties as flags so later pipelines can parameterize them; for large enum sets like voices or styles, prove one or two representative values rather than exhausting every individual item
- do not spam servers or brute-force controls
- do not commit cookies, raw captures, signed URLs, upload credentials, session bundles, or generated media

## CLI Shape

Near-term CLI work should prioritize API coverage and proof over orchestration. Do **not** implement the daemon or full async job queue until the high-value API surface is settled.

Current ownership:

- `jimeng-browser-proxy` is the user-facing front door for logged-in Jimeng/Dreamina work.
- `jimeng-dreamina` is lower-level Dreamina-compatible plumbing and may remain useful for compatibility tests and payload experiments.
- Avoid creating more parallel CLIs. Prefer adding new commands to `jimeng-browser-proxy`, while reusing shared helpers underneath.
- Later cleanup should consolidate the two surfaces or make their relationship explicit enough that users never wonder which one to run.

Future async direction, deferred:

Default behavior after the daemon/job phase:

- submit returns a local job id
- command writes job JSON under `data/jimeng-lab/jobs/<job-id>/`
- raw provider responses and artifacts stay under ignored `data/**`
- stdout should be concise and machine-readable when `--json` is passed

Current blocking behavior:

- direct generation commands may block while submitting/polling/downloading, as long as concurrency is `1` and polling is bounded
- `--wait` or `--sync` can be introduced when the job model exists
- `--noDownload` submits/polls without downloading final media

Common flags:

- `--session <file>`
- `--capture <file>`
- `--outDir <dir>`
- `--json`
- `--dryRun`
- `--wait` / `--sync`
- `--noDownload`

Current and near-term commands:

```bash
jimeng-browser-proxy session
jimeng-browser-proxy catalog
jimeng-browser-proxy voices
jimeng-browser-proxy tts
jimeng-browser-proxy sample-voices
jimeng-browser-proxy upload-token
jimeng-browser-proxy upload-image
jimeng-browser-proxy text2image
jimeng-browser-proxy text2video
jimeng-browser-proxy image2video
jimeng-browser-proxy frames2video
jimeng-browser-proxy lip-sync
jimeng-browser-proxy voice-clone
jimeng-browser-proxy persona
jimeng-browser-proxy subject
jimeng-browser-proxy templates
jimeng-browser-proxy assets
jimeng-browser-proxy canvas
```

It is fine for commands to land progressively. Missing commands should be represented in the endpoint catalog as `unknown`, `captured`, `needs-live-proof`, or `blocked-*`.

## Proof Standard

For each implemented API:

- exact runnable command
- normalized JSON output
- typed helper and CLI command
- automated tests close to `packages/jimeng-client/test/`
- snapshot or fixture-style tests where request/response shape matters
- redacted docs in `docs/provider/`
- QA/proof note in `docs/qa/`
- local proof bundle under ignored `data/**`
- command log or manifest that records the important commands needed to recreate artifacts

For media:

- audio: save MP3/WAV, validate file metadata, transcribe back with the available STT/internal transcription path when available, and compare transcript against the expected Chinese script
- video: save MP4, validate duration/resolution/codec, extract thumbnails or frames when useful, and record playable artifact paths
- image: save image, validate dimensions/content type, record prompt/options/model/provider URI
- if automated semantic validation is weak, still save the artifact and make it easy for Arthur to inspect

Proof prompts should be useful and in distribution. Avoid placeholder prompts like "make a test video." Prefer prompts that exercise the actual product:

```txt
韩系美妆达人自拍风格，干净卧室自然光，语气像真实 TikTok 种草视频，展示一款补水精华，前三秒有明确痛点钩子，无字幕，无水印，不要生成可读文字。
```

```txt
健身蛋白棒 UGC 广告，年轻女性创作者手持产品，对镜头自然介绍口感和低糖卖点，节奏像短视频开箱测评，画面真实手机拍摄感，无字幕，无水印。
```

## Checkpoint Rule

Work in feature slices. After finishing one coherent API section, stop and git checkpoint before moving to the next section.

A slice is checkpoint-ready only when:

- API contract is documented
- CLI command exists or the feature is explicitly documented as blocked/unknown
- tests pass for the helper/CLI contract
- live or dry-run proof exists as appropriate
- proof artifacts are saved locally under ignored `data/**`
- `TASKS.md` and relevant state/plan docs are updated
- important rerun commands are recorded in the QA note or proof manifest
- the feature slice has its own git commit

Suggested slice order:

1. session/background proxy
2. text-to-image
3. voice catalog and TTS
4. upload-token
5. local ImageX image upload
6. image-to-video with uploaded first-frame URI
7. VOD/video upload
8. reference controls: pose, style, depth, canny, character/reference roles
9. lip-sync and digital-human generation
10. voice clone and subject/persona voice generation
11. persona/subject/character lifecycle
12. templates, explore/feed mining, assets, canvas/editing, export utilities

## Discovery Order

1. Build and maintain the UI fuzzing and network capture harness.
2. Enumerate frontend API surface: image, video, image-to-video, reference upload, pose/reference controls, TTS, voice clone, lip-sync, persona/subject/character, templates, assets, canvas/editing, export.
3. Promote stable contracts into `packages/jimeng-client`.
4. Add CLI commands and flags for the useful API properties.
5. Add proof validators and useful Chinese UGC prompts.
6. Measure rate limits carefully and encode safe defaults.
7. Only after the API surface is stable, convert to daemon: queue, job ids, status, retries, rate limits, session refresh, artifact persistence, `submit/watch/cancel/inspect`.

## Endpoint Catalog Requirements

Maintain `docs/provider/jimeng-frontend-api-catalog.md` and `docs/provider/jimeng-direct-client-endpoints.md`.

Every discovered capability should have a status:

- `implemented`
- `captured`
- `needs-live-proof`
- `blocked-vip`
- `blocked-risk`
- `blocked-auth`
- `unknown`

Each endpoint entry should capture:

- endpoint path and method
- UI path that triggered it
- request shape
- response shape
- required session/header fields without raw secrets
- quota/risk behavior
- artifact extraction paths
- associated CLI command if implemented
- proof bundle path if live-proved

## Daemon Phase

After the CLI surface is stable, implement a daemon/orchestrator.

The daemon should:

- maintain one repo-local process per workspace
- own session refresh
- queue jobs
- enforce generation submission concurrency `1`
- separate rate limits for submission, polling, downloads, and capture
- retry with capped backoff only where safe
- persist status, request/response JSON, artifacts, logs, and normalized summaries
- support CLI commands like `submit`, `watch`, `cancel`, `inspect`, `tail`, `status`

The daemon is not the first milestone. The first milestone is a truthful, tested, artifact-proven CLI surface.

## Completion Harness

The long-running goal is complete only when:

```bash
bun run jimeng:typecheck
bun run jimeng:test
bun packages/jimeng-client/src/browser-proxy-cli.ts --help
```

all succeed, and:

- CLI help lists the implemented commands
- endpoint catalog is current
- every implemented generator has real proof artifacts
- every blocked/gated feature has evidence and next-step notes
- no raw cookies, session bundles, upload credentials, signed URLs, raw private captures, or generated media are committed
- each completed feature slice has its own git checkpoint before the next slice began
