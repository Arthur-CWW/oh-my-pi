# Jimeng/Dreamina CLI Extraction Goal

## Outcome

Build a fast, truthful Jimeng/Dreamina client for high-value UGC workflows. This is prototype infrastructure, not a stable public SDK: prefer clean architecture and working coverage over backwards-compatible incremental layering.

Keep going until every high-value UGC capability reachable from Arthur's logged-in Jimeng frontend is either implemented through typed services/CLI or honestly classified in the endpoint registry.

The goal is product-value driven, then coverage-driven. Choose the next work by the highest-value UGC workflow it unlocks, not by which endpoint is safest or cheapest to touch. Speed, no-spend status, and implementation size are tie-breakers after product value and user usefulness. The specific anti-pattern to avoid is picking the fastest no-spend W6 block while generation, persona/voice, lip-sync, reference-control, or template-mining work remains higher value; no-spend is not a substitute priority. Avoid ceremony that does not improve confidence. Do not require a local proof bundle for every backend refactor. Do not manually maintain walls of assertions when snapshot fixtures or structured endpoint registries would prove the same thing faster.

## Operating Model

- Use `docs/plans/jimeng-fast-contract-extraction.md` as the default implementation loop: bounded live/passive matrix, saved raw and normalized JSON plus artifacts, contract inference, generated wrappers/tests/registry drafts, then replayed fixture proof.
- Use a single HTTP boundary abstraction for Jimeng/CapCut calls with transport modes: `live`, `record`, `replay`, and `fixture`.
- Decode external JSON at the boundary with permissive Effect Schema contracts: allow additive fields, fail clearly when paths we rely on drift.
- Put auth headers, risk detection, response redaction, cassette recording, and replay caching in the transport/client layer, not scattered through CLI commands.
- Use dependency injection through Effect `Context`/`Layer` or a thin equivalent where migration is still in progress. Tests should swap the HTTP transport, clock, filesystem, and logger rather than adding command-specific proof flags.
- Prefer Effect CLI for new or substantially refactored command surfaces. Do not keep growing hand-written argument parsing if a command is already being rewritten.
- Treat live no-spend calls as cassette refreshes or provider-drift checks, not as the default way to choose work. After one part of the stack is validated, replay cached fixtures for speed.
- Do not let no-spend availability pull the workstream toward low-value endpoints. If the highest-value API requires paid generation, account mutation, or visible UI, stop and ask for explicit approval with the exact planned command, spend/risk, and proof artifact path rather than silently switching to lower-value no-spend work.
- If approval is needed for the top-value live step, the safe fallback is adjacent prep inside that same high-value family, such as request builders, compare gates, schema fixtures, cassettes, and useful example plans. Do not jump to unrelated supporting reads just because they are cheaper.
- Test useful workflows and representative examples, not just endpoint existence. A good slice proves a real UGC pipeline step we would actually use: generating or remixing a persona clip, cloning or applying a voice, lip-syncing a host, transferring pose/reference controls, mining a template/hook, or polling/downloading the resulting artifact.
- Prefer approved bounded live/capture matrices over manually adding more one-off dry-run planners. Dry-run planners are fallback or compare-gate tools when live capture is unavailable, risky, or not yet approved.
- Build tooling that generates the next layer from observed contracts: schema drafts, wrapper drafts, CLI flag suggestions, endpoint-registry patches, replay fixtures, and Vitest snapshots should come from saved JSON/cassettes whenever possible.
- Use Vitest snapshots plus fixtures for inventory, worklist, request/response shape, endpoint registry gaps, cassette metadata, CLI summaries, and generated reports instead of long assertion walls. Prefer file snapshots for generated Markdown or large reports, object snapshots for normalized JSON contracts, and direct assertions only for small behavior branches.
- Move endpoint status/progress into a structured registry and, later, a small SQLite run log if needed. Docs should index the state and decisions, not duplicate every raw progress event.
- Work in larger coherent refactor chunks when that is more efficient. Small slices are still useful for risky paid/mutating work, but they are not a hard rule for prototype cleanup.
- No backwards compatibility burden unless a current repo test or workflow depends on it. Delete useless tests and stale code when they slow the loop without protecting behavior.

## Work Chunk Queue

This is the current queue for breaking down the Jimeng/Dreamina workstream. Prefer these chunks over one-endpoint-at-a-time slices unless a step touches paid generation, account mutation, unsafe credentials, or visible UI.

| ID | Chunk | Size | Depends On | Parallelizable? | Notes |
|---|---|---:|---|---|---|
| W0 | Park `weekly-challenges` and clean dirty state | S | none | No | Weekly challenges are contest/activity metadata, not a core UGC generation surface. Keep them cataloged only in `docs/provider/jimeng-api-triage.md` and the endpoint registry, but remove the active CLI/test slice. |
| W1 | Shared Jimeng HTTP transport with `live`/`record`/`replay`/`fixture` modes | L | W0 decision | Mostly no | Foundation chunk. Owns auth/session headers, risk detection, redaction, cassette read/write, cache paths, and DI boundary. Do this locally or with one worker; other chunks should not edit the same files until the interface is clear. |
| W2 | Endpoint registry plus static-inventory/discovery Vitest snapshot tests | M/L | W0 decision; can start after W1 interface sketch | Yes, if files are disjoint | Replace giant inline fixtures and repeated known-status assertions with structured registry data and Vitest snapshot/fixture tests. Use file snapshots for Markdown reports and object snapshots for normalized JSON contract output. This can run beside W1 if one owner only touches registry/analyzer files. |
| W3 | Effect CLI front door | L | W1 interface sketch | Partly | Replace hand-written parsing for new/refactored commands. Do not migrate every command blindly; start with a command family that benefits from transport/cassette reuse. |
| W4 | Migrate existing read/research command families to shared transport and cassettes | L | W1, W2 | Yes by command family | Batch similar read-only commands together: account/runtime/workspace/profile/research/catalog/history. Each worker needs a disjoint command family and test files. |
| W5 | Bounded live/capture matrices for high-value workflows | M/L | W1 | Partly | Use the fast loop in `docs/plans/jimeng-fast-contract-extraction.md`. Keep generation/mutation concurrency at 1, cap approved spend, save raw/normalized JSON, commands, credit before/after, and media artifacts. |
| W6 | Contract inference and scaffold generation | L | W5 samples; W1 transport | Yes, if output dirs are disjoint | Build `contract-infer` to turn saved JSON/cassettes into Effect Schema drafts, wrapper/CLI/test/registry patch drafts, replay fixtures, and Vitest snapshots. This should replace manual field-by-field schema writing for most new APIs. |
| W7 | Promote generated scaffolds into typed client/CLI surface | L | W6 | Yes by API family | Hand-tighten required paths, flag semantics, redaction, and error handling, then land replay tests/snapshots. Work by high-value family: generation, persona/voice, lip-sync, reference controls, template mining. |
| W8 | Optional SQLite progress/run log | M | W2 or W6 | Yes | Only add this if the registry/snapshot/proof-bundle approach still leaves progress hard to inspect. It should track runs and endpoint status without turning docs into a database. |

Parallel-agent rule: use sub-agents only when the write scopes are disjoint and the parent thread is not blocked on the result. Good splits are W1 vs W2 after the transport interface is sketched, or W4 command-family migrations after W1 lands. Bad splits are two agents editing the central CLI parser, endpoint registry, or transport at the same time.

## Value-First W6 Queue

When resuming W6, rank work by the workflow value below. Do not pick a lower-value endpoint merely because it is no-spend or easy. A "fastest no-spend W6" choice is wrong unless it is also the highest-value available slice or directly unblocks that slice.

1. Generation parity: fresh text-to-image, text-to-video, image-to-video, first/end-frame, multi-frame, reference-image/multimodal generation, submit/poll/download, and example commands that create useful UGC artifacts.
2. Persona and voice: subject/persona voice generation, custom voice clone submit/query/update/delete, applying voices to scripts, and representative examples for reusable persona profiles.
3. Lip-sync / digital human: image/avatar and VOD lip-sync submit parity, pre-process and task result flows, and examples that produce talking-head UGC assets.
4. Reference controls: pose, depth, canny, image/style/reference transfer, masks, face/reference validation, and workflows that let us swap the person while keeping timing/pose/template structure.
5. Template and niche mining: CapCut/Jimeng search, batch, presets, template detail, hook/caption extraction, and examples for faceless profile/template copying.
6. Supporting reads: history, assets, story/archive, config, runtime, quota, notices, panels, and other metadata. These matter when they unblock a higher-value workflow; otherwise keep them cataloged rather than pulling them to the front.

For each value-ranked slice, build a small useful example workflow and record the command(s), fixture/cassette, and expected artifact or normalized output. If live spend or mutation is needed, ask for approval at that point with the exact command and expected quota/account impact.

## Current Continuation State

As of 2026-06-10, the committed Jimeng CLI baseline is:

- `65a67bd Add Jimeng browser proxy client`
- `6ba0ae9 Add Jimeng voice catalog and TTS CLI`
- `4567ca0 Add Jimeng upload token probe`
- `6fb9c61 Add Jimeng ImageX image upload CLI`
- `f683706 Update Jimeng CLI extraction goal`
- `35d9171 Add Jimeng image-to-video CLI proof`
- `28fc0cf Add Jimeng VOD video upload CLI proof`
- `0bb9bb5 Add Jimeng frames-to-video dry-run CLI`
- `86ff779 Add Jimeng lip-sync VOD dry-run plan`
- `5c7887a Add Jimeng Explore templates CLI`
- `594d5d0 Add Jimeng short-video Explore CLI`
- `3434225 Add Jimeng reference image inspect CLI`
- `e442938 Add Jimeng ControlNet preview CLI`
- `858eab2 Document Jimeng ControlNet preview proofs`
- `3e3bde2 Add Jimeng object mask CLI`
- `00c4aca Add Jimeng subjects CLI`
- `44dd492 Add Jimeng feed short video CLI`
- `aa0eafb Add CapCut template metadata CLI`
- `c7b55b1 Add Jimeng lip sync config CLI`
- `4936bc7 Add Jimeng lip sync image planning`
- `cf2b953 Document background Jimeng automation preference`
- `e5e3539 Add Jimeng subject lifecycle CLI`
- `6fc9948 Add Jimeng voice clone CLI coverage`
- `e8313de Add Jimeng workbench assets CLI`
- `736ed98 Add Jimeng history queue CLI`
- `858dcb0 Add schema-backed Jimeng history records CLI`
- `1edef0e Add Jimeng endpoint probe and video info CLI`
- `401a6c1 Add Jimeng capture analyzer CLI`
- `64b66e2 Add Jimeng lip-sync compare gate`
- `b77cf2c Add Jimeng discovery worklist CLI`
- `67527ea Add Jimeng agent catalog CLI`
- `b5fc63f Add Jimeng static locator CLI`
- `aa6a97e Enhance Jimeng static locator symbols`
- `302e088 Document CapCut template method contracts`
- `8c3dd42 Add signed CapCut endpoint probe`
- `4d117a2 Recheck Jimeng live generation`
- `abcc9ca Classify LV mutation blockers`
- `c09bb7d Add LV editor catalog CLI`
- `a124c30 Classify LV read-state blockers`
- `1d423bd Add Jimeng rate probe CLI`
- `52b0724 Use Effect Schema for Jimeng workspace context`
- current checkpoint: Effect Schema-backed no-spend `profile-research` for public reference profiles/works/stories/item details and current-account follow lists, current-account generated `local-items`, no-spend `account-config`, no-spend `runtime-config`, guarded story/archive export reads (`story-records`, `async-tasks`, and dry-run-only `story-export-plan`), signed no-spend commerce price reads (`commerce-pricing`), and static/probe classification for media helper, adjacent commerce, panel, and notice blockers (`mix_audio_video`, `mix_audio_videos`, `mpack_image`, `execute_generate_audit`, `submit_survey`, overseas/change-plan/trade/refund commerce endpoints, `get_notice_list`, and `get_panel_info`); static inventory now reports `implemented=63`, `partial=6`, `dry_run_only=5`, `blocked=85`, `unknown=89`
- W1 started: added a shared Effect Schema-validated Jimeng HTTP cassette transport with `live`, `record`, `replay`, and `fixture` modes. It records method, URL, body hash, status, and base64 response bodies without headers or raw request bodies. `endpoint-probe` is the first CLI consumer via `--transport` and `--cassette`; broader read/research command migration is still pending under W4.
- W2 started: static-inventory coverage tests were rewritten from a large wall of one-off assertions into explicit fixture endpoint arrays plus table-driven status/command/action/risk expectations. Endpoint ownership now lives in `endpoint-registry.ts`, with triage-family coverage helpers/tests that map keep/maybe/skip families to endpoint statuses. Current keep-family coverage: 62 unique endpoints, 0 missing registry rows; pending work is visible by family status counts rather than manual doc scanning.
- W2 continuation: `jimeng-browser-proxy triage-coverage --decisions keep` now materializes the endpoint registry into JSON/Markdown without loading a browser session. Current keep-family coverage is 40 implemented, 4 partial, 4 dry-run-only, 15 blocked, and 0 missing. Use this report before choosing the next W5/W6 chunk.
- W2 continuation: Jimeng registry report testing now uses Vitest snapshots. Unfinished keep-family endpoint rows carry registry-level `evidence` paths and `nextProbe` actions; Bun guard tests enforce that every not-implemented keep-family endpoint remains auditable, while Vitest object/file snapshots cover the normalized gap object and generated Markdown report.
- W2/W6 continuation: `triage-coverage` now emits a value-ranked remaining-work list in both JSON and Markdown. The top ranked gaps are generation parity (`/mweb/v1/aigc_draft/generate`, `/mweb/v1/execute_generate_audit`, `/mweb/v1/mpack_image`) followed by persona/voice (`/mweb/v1/feed`, `/mweb/v1/voice/query_task`, `/mweb/v1/dreamina_subject/generate_voice`, voice clone mutations), so future runs should not pick supporting story/archive reads merely because they are no-spend.
- W6/G1 continuation: representative generation-plan Vitest snapshots now cover three useful UGC workflows without spend: Korean beauty persona still (`text2image-plan`), faceless protein-bar hook video (`text2video-plan`), and reference-profile first/end-frame pose/timing transfer (`text2video-plan`). See `docs/qa/jimeng-generation-plan-snapshots-20260611.md`. Next live progress remains approval-gated generation capture/compare; if approval is unavailable, stay inside G1 with request builders, compare gates, schemas, and fixtures.
- W6/G1 continuation: `generate-audit-plan` now builds the dry-run `/mweb/v1/execute_generate_audit` material pre-audit body for image/video/audio/subject inputs and uses the generic `request-plan-compare` gate for passive UI capture parity. See `docs/qa/jimeng-generate-audit-plan-20260611.md`. Live replay remains blocked until a fresh frontend generation capture confirms the extra top-level fields for the actual submit context.
- W6/G1 continuation: `omni-video-plan` now builds the dry-run Seedance `/mweb/v1/aigc_draft/generate` all-around reference body for mixed image/video references, and `omni-video-compare` provides a semantic capture gate that ignores generated UUIDs while checking stable `unified_edit_input.material_list`, `meta_list`, model, scene-option, and `functionMode="omni_reference"` paths. This is the main reference-profile/persona-swap motion-transfer path. See `docs/qa/jimeng-omni-video-plan-20260611.md`. Live replay remains blocked until passive all-around-reference capture compare passes and spend is approved.
- W6/V1 continuation: `mix-audio-plan` now builds dry-run `/mweb/v1/mix_audio_video` and `/mweb/v1/mix_audio_videos` request plans for applying generated voice/audio to generated video items. It models the frontend transform that snake-cases the body and sends `babiParam` as query `babi_param`; `request-plan-compare` now validates optional query params as well as POST body paths. See `docs/qa/jimeng-mix-audio-plan-20260611.md`. Live replay remains blocked until passive UI capture compare passes and task-state mutation is approved.
- W6 fast-loop pivot: Arthur approved bounded account spend for real generation exploration. The 2026-06-12 live matrix under `data/jimeng-lab/proof-20260612-live-generation-matrix/manifest.md` spent 24 credits, generated one TTS MP3 and four MP4s, and verified the videos with `ffprobe`. Future work should use this proof-bundle pattern as contract-inference input instead of adding more manual dry-run planners by default.
- W6 audit note: `R1 /mweb/v1/mget_story` has extra evidence from running `profile-research --endpoints stories` against three existing followed profiles using the saved session bundle and cassette `record` mode. All three returned `ret=0` with `story_count=0`, so `story-records` remains partial until a public profile/UI capture with a non-empty story list is available. This is audit evidence only; do not let supporting story/archive reads outrank higher-value generation, persona/voice, lip-sync, reference-control, or template-mining work.
- W4 started: `account-config`, `runtime-config`, `workspace-context`, `agent-catalog`, `image-models`, `research-keywords`, `research-search`, `profile-research`, `local-items`, `story-records`, `async-tasks`, `infinite-canvas`, `assets`, `history-queue`, `history-records`, `video-info`, `describe-image`, `controlnet-preview`, `object-mask`, `subjects`, `subject-create`, `subject-update`, `subject-delete`, `voice-clones`, `voice-clone-query`, `catalog`, `voices`, `tts`, `sample-voices`, `lip-sync-config`, `templates`, `short-videos`, `overseas-short-videos`, `capcut-categories`, `capcut-collections`, `capcut-collection-templates`, `capcut-template-detail`, `capcut-template-metadata`, `capcut-editor-catalog`, `capcut-probe`, `account-credit`, `commerce-benefits`, `commerce-pricing`, `endpoint-probe`, `rate-probe`, `upload-token`, `upload-image`, and `upload-video` now accept the shared Jimeng fetch transport and the CLI passes `--transport`/`--cassette` through to record/replay/fixture modes where safe. Each service test records a cassette and replays it without re-hitting a provider; `workspace-context` covers the dependent list-to-get-by-ids path, `agent-catalog` covers skills plus agent model config, `image-models` covers common image model config, `research-keywords` covers supported guesses while preserving the skipped asset-suggestion case, `research-search` covers the inspiration-search normalization path, `profile-research` covers the full public profile/works/favorites/stories/follows/item/batch-items sequence, `local-items` covers generated-item lookup, `story-records`/`async-tasks` cover read-only archive/export status lookups while `story-export-plan` stays dry-run-only, `infinite-canvas` covers project list, inferred project detail, custom ratios, and conversation list, the history/assets/video batch covers workbench asset list, queue state, completed history lookup, and VOD metadata, the reference batch covers image description/face recognition, ControlNet blend preview/pose detection, and saliency segmentation, the subject/persona batch covers list, image audit, image lookup, create, update, delete, and `subject-generate-voice` helper replay while keeping CLI voice generation dry-run-only, the voice-clone batch covers cloned-voice listing, task query, submit/update/delete helper replay while keeping submit/update/delete CLI commands dry-run-only, the voice catalog batch covers lip-sync image/video config, signed voice-library feed replay, and TTS audio decoding, the Explore batch covers image templates, short-video templates, and overseas short-video feed reads, the CapCut/LV template batch covers commercial categories, collections, collection rows, template detail, public ratio/scene metadata, editor effect/font/color catalogs, and guarded signed probe replay, the commerce/account batch covers credit balance, benefit metadata/user-benefit rows, and VIP/credit price lists, the probe batch covers generic endpoint and bounded rate probes, and the upload batch covers upload credentials plus mocked ImageX/VOD apply/direct/commit flows.
- Remaining plain `new JimengClient()` construction is classified and guarded by `packages/jimeng-client/test/client-seams.test.ts`. The allowed seams are: signed artifact downloads inside `controlnet-preview` and `object-mask` when `--noDownload` is not set; the explicitly live submit/poll/download path for generation commands, which remains paid/mutating and approval-gated; and the legacy `jimeng-direct` / `jimeng-dreamina` CLI compatibility wrappers. New read/research/provider-contract code should use injected fetch/transport instead of adding another plain client.

If the thread goal object lags behind this file after a pause, resume from this document and the latest Git checkpoint. The active working rule is: background-only reversal, direct/API-first implementation, cached live/record/replay transport, tests and fixtures for backend proof, and no async daemon until the API client surface is settled.

ImageX local image upload is now committed and live-proved:

- `jimeng-browser-proxy upload-image`
- local ImageX image upload via:
  - `/mweb/v1/get_upload_token` scene `2`
  - ImageX `ApplyImageUpload`
  - direct `POST /upload/v1/{StoreUri}`
  - ImageX `CommitImageUpload`
- tests for deterministic AWS4-style ImageX signing and mocked token/apply/upload/commit sequence
- transport: `upload-token`, `upload-image`, and upload helper services support `--transport live|record|replay|fixture`/`--cassette` where safe; backend proof records/replays mocked ImageX upload without storing request headers or raw request bodies
- live `upload-image` creates a remote provider object and still needs explicit approval in unattended/live runs
- docs and QA notes showing a live proof URI and local artifact under ignored `data/**`

First-frame image-to-video is now committed and live-proved:

- `jimeng-browser-proxy image2video`
- local first-frame upload via ImageX scene `2`, provider URI injection into `first_frame_image`, submit/poll/download through `/mweb/v1/aigc_draft/generate` and `/mweb/v1/get_history_by_ids`
- useful flags exposed for later parameterization: `--image`, `--firstFrameUri`, `--lastFrameUri`, `--durationSec`, `--ratio`, `--videoResolution`, `--modelVersion`, `--modelReqKey`, `--seed`
- proof bundle:
  - dry-run/local upload: `data/jimeng-lab/proof-20260609-image2video-local-upload/`
  - live MP4: `data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4`
  - thumbnail: `data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-thumb-2s.jpg`

VOD/video upload is now implemented and live-proved:

- `jimeng-browser-proxy upload-video`
- local MP4 upload via:
  - `/mweb/v1/get_upload_token` scene `1`
  - VOD `ApplyUploadInner`
  - direct `POST /upload/v1/{StoreUri}`
  - VOD `CommitUploadInner`
- useful provider references exposed for later payloads: `vid` and `tos-cn-v-*` store URI
- transport: `upload-video` and upload helper services support `--transport live|record|replay|fixture`/`--cassette` where safe; backend proof records/replays mocked VOD upload without storing request headers or raw request bodies
- live `upload-video` creates a remote provider object and still needs explicit approval in unattended/live runs
- proof bundle:
  - dry-run: `data/jimeng-lab/proof-20260609-video-upload-dry-run/`
  - live proof: `data/jimeng-lab/proof-20260609-video-upload-live/`
  - `vid=v03870g10004d8k1u4nog65hb08dnhig`
  - `storeUri=tos-cn-v-148450/o4gBE1AAWbfiDDig6xEQ4KJhDHQvlExoFkFExB`

First/end-frame image-to-video is now dry-run-proved:

- `jimeng-browser-proxy frames2video`
- local first-frame and end-frame ImageX uploads
- patched `video_gen_inputs[0].first_frame_image` and `video_gen_inputs[0].end_frame_image`
- proof bundle: `data/jimeng-lab/proof-20260609-frames2video-dry-run/`
- `first_frame_image=tos-cn-i-tb4s082cfz/5b31ee284d5c43eb8097bfc5818b584a.png`
- `end_frame_image=tos-cn-i-tb4s082cfz/325213bd2b2049d3a65667350b72807e.jpg`
- live generation is intentionally not claimed yet; first capture or select the frontend's explicit end-frame/multi-frame mode.

Lip-sync VOD video-reference planning is now dry-run-proved:

- `jimeng-browser-proxy lip-sync`
- accepts an existing VOD `vid`/URI/metadata or can upload a local video to VOD first
- builds `videoGenInputs.v2vOpt.lipSyncUserVideo.originVideo.originVideo`
- attaches `ttsInfo` with text, `toneId`, optional tone metadata, and speed
- uses frontend bundle evidence for `model_req_key=dreamina_lib_sync_base`, `generateType=LipSync`, and `DAVideoProcessType.LipSyncUserVideo`
- proof bundle: `data/jimeng-lab/proof-20260610-lip-sync-vod-plan/`
- live generation is intentionally disabled until a real frontend lip-sync submit is captured and compared.

Lip-sync image/avatar planning is now dry-run-proved:

- `jimeng-browser-proxy lip-sync --image` / `--imageUri`
- local avatar/reference images upload through the confirmed ImageX scene `2` path first unless an existing provider URI and dimensions are supplied
- builds `videoGenInputs.i2vOpt.realmanAvatar.originImage`
- attaches `ttsInfo` with text, `toneId`, optional tone metadata, and speed
- uses frontend bundle evidence for `model_req_key=dreamina_lib_sync_image_quick_1.5`, `generateType=LipSync`, and `DAVideoProcessType.LipSyncImage`
- proof bundle: `data/jimeng-lab/proof-20260610-lip-sync-image-plan/`
- latest proof uploaded `image_uri=tos-cn-i-tb4s082cfz/487472ac3b204caa89fc1b2764c0aa1e.png`, `width=2048`, `height=2048`
- summary hash: `ed087e3df60ae9c30dc835d2d410867670229abfb115adb186846aa1aa631fc6`
- dry-run plan hash: `5386ac4dd343228680dc66395faade92dfbd225d4968baa3f2e2decba248dea4`
- live generation is intentionally disabled until a real frontend image/avatar lip-sync submit is captured and compared.

Lip-sync/digital-human model config is now live-proved without generation spend:

- `jimeng-browser-proxy lip-sync-config`
- direct `/mweb/v1/video_generate/get_common_config` for scenes `lip_sync_image_generate_video` and `lip_sync_video_generate_video`
- image/avatar models:
  - `dreamina_lib_sync_image_master_1.5` / `大师模式`
  - `dreamina_lib_sync_image_quick_1.5` / `快速模式`
- video model:
  - `dreamina_lib_sync_base` / `基础模式`
- image-mode options include `input_media_type` and `audio_option`
- proof bundle: `data/jimeng-lab/proof-20260610-lip-sync-config/`
- raw config responses include signed preview GIF URLs, while normalized summaries omit them.

Agent skill/model catalog is now live-proved without generation spend and schema-backed:

- `jimeng-browser-proxy agent-catalog`
- direct `/mweb/v1/creation_agent/v2/skill/list` and `/mweb/v1/creation_agent/v2/get_agent_config` with logged-in browser session headers
- useful flags: `--endpoints skills,config,all`
- normalizes official agent skills, image model keys, video model keys, image control feats, image blend controls, resolution presets, sample-step bounds, video option keys, frame counts, fps, aspect ratios, input media types, unified-edit material limits, compliance confirmation flags, cancel support, and max batch counts
- proof bundle: `data/jimeng-lab/proof-20260610-agent-catalog/`
- latest proof returned 4 skills, 8 image models, and 5 video models
- high-value flags included image controls `bg_paint`, `byte_edit`, `canny`, `depth`, `face_swap`, `ip_keep`, `pose`, `support_subject`; video options `fps`, `frames`, `input_media_type`, `multi_frames`, `resolution`, `unified_edit`, `video_aspect_ratio`; and video input media types `prompt`, `first_frame`, `end_frame`, `multi_frame`, and `unified_edit`

Direct image model config is now live-proved without generation spend and schema-backed:

- `jimeng-browser-proxy image-models`
- direct `/mweb/v1/get_common_config` with frontend-derived body `{ "isClientFilter": true, "needBetaModel": true }` and query flags `needCache` / `needRefresh`
- useful flags: `--isClientFilter`, `--needBetaModel`, `--needCache`, `--needRefresh`
- normalizes image model request keys, feature flags, blend controls, feature-config keys, resolution presets, sample-step bounds, commercial benefit/resource ids, model source, max batch count, compliance confirmation flags, and task-cancel support
- proof bundle: `data/jimeng-lab/proof-20260610-image-models/`
- latest proof returned 8 image models; default workbench model was `high_aes_general_v50` / `图片5.0 Lite`
- high-value flags included `bg_paint`, `byte_edit`, `byte_edit_with_custom_ratio`, `byte_edit_with_empty_prompt`, `canny`, `depth`, `face_swap`, `ip_keep`, `pose`, `refuse_image`, `smart_scale`, and `support_subject`

Direct text-to-image submit body planning is now no-spend dry-run-proved and Effect Schema-backed:

- `jimeng-browser-proxy text2image-plan`
- `jimeng-browser-proxy text2image-compare`
- builds the current direct `/mweb/v1/aigc_draft/generate` workbench submit body without sending it
- this command now runs without loading a browser session; it is local request-builder proof only
- compares that dry-run body offline against a passive raw CDP network capture or capture-template request before live submit is claimed
- uses frontend/static evidence from the current workbench path and `iptag/jimeng-api`-style direct request structure
- useful flags: `--prompt`, `--modelVersion`, `--modelReqKey`, `--resolution`, `--ratio`, `--sampleStrength`, `--negativePrompt`, `--intelligentRatio`, `--seed`, and `--submitId`
- validates the relied-on nested `extend`, `metrics_extra`, `draft_content`, `core_param`, `large_image_info`, and `sceneOptions` contract paths with Effect v4 / Effect Schema while tolerating additive provider fields
- proof bundle: `data/jimeng-lab/proof-20260610-text2image-plan-direct/`
- latest proof produced model `high_aes_general_v50`, resolution `2k`, ratio `9:16`, size `1440x2560`, `image_ratio=5`, and `live_submit=false`
- compare proof command: `jimeng-browser-proxy text2image-compare --plan data/jimeng-lab/<proof>/raw/<text2image-plan>-dry-run-plan.json --rawNetwork data/jimeng-captures/<capture>/raw-network.jsonl --outDir data/jimeng-lab/text2image-compare`
- live text-to-image generation is still not claimed; a fresh background CDP frontend submit capture should be compared before enabling/claiming paid live direct text-to-image submit.

Direct text/image/frame-to-video submit body planning is now no-spend dry-run-proved and Effect Schema-backed:

- `jimeng-browser-proxy text2video-plan`
- `jimeng-browser-proxy text2video-compare`
- builds the current direct `/mweb/v1/aigc_draft/generate` workbench video submit body without sending it or loading a browser session
- compares that dry-run body offline against a passive raw CDP network capture or capture-template request before any live submit is claimed
- uses local live-proof payload evidence from the current workbench path and keeps the request shape aligned with `BasicVideoGenerateButton`, `text_to_video_params`, `video_gen_inputs`, and `video_task_extra`
- useful flags: `--prompt`, `--modelVersion`, `--modelReqKey`, `--ratio`, `--videoResolution`, `--durationSec`, `--fps`, `--videoMode`, `--seed`, `--submitId`, `--firstFrameUri`, and `--lastFrameUri`
- validates the relied-on nested `extend`, `metrics_extra`, `draft_content`, `text_to_video_params`, `video_gen_inputs`, and `sceneOptions` contract paths with Effect v4 / Effect Schema while tolerating additive provider fields
- local proof command: `jimeng-browser-proxy text2video-plan --prompt ... --ratio 9:16 --durationSec 5 --firstFrameUri ... --lastFrameUri ...`
- compare proof command: `jimeng-browser-proxy text2video-compare --plan data/jimeng-lab/<proof>/raw/<text2video-plan>-dry-run-plan.json --rawNetwork data/jimeng-captures/<capture>/raw-network.jsonl --outDir data/jimeng-lab/text2video-compare`
- live submit is still not claimed by this planner; paid/live generation remains behind explicit approval and the existing capture/compare gates.

Signed account credit balance is now live-proved without generation spend and schema-backed:

- `jimeng-browser-proxy account-credit`
- direct `/commerce/v1/benefits/user_credit`
- uses frontend-compatible `device-time` / `sign` / `sign-ver` commerce headers recovered from `iptag/jimeng-api`
- normalizes `gift_credit`, `purchase_credit`, `vip_credit`, and `total_credit`
- transport: supports `--transport live|record|replay|fixture` and `--cassette`; backend proof is a single-read record/replay cassette test
- proof bundle: `data/jimeng-lab/proof-20260610-account-credit-cli/`
- latest proof returned total `3990` credits, all from VIP credits
- related `/commerce/v1/benefits/credit_receive` is a mutating daily-claim endpoint and remains out of scope without explicit approval

Signed commerce benefit metadata and current user benefit rows are now live-proved without generation spend and schema-backed:

- `jimeng-browser-proxy commerce-benefits`
- direct `/commerce/v3/resource/benefit_metadata` and `/commerce/v3/benefits/batch_get_user_benefit`
- uses the same frontend-compatible `device-time` / `sign` / `sign-ver` commerce headers as `account-credit`
- static frontend evidence showed the wire body must be snake_case `query_list`, not the service-layer camelCase `queryList`
- default request queries `aigc/get_all` and `normal_func/get_all`
- normalizes resource ids, benefit types, units, use modes, pay modes, roles, quotas, `total_credits`, and `enable_preview`
- transport: supports `--transport live|record|replay|fixture` and `--cassette`; backend proof is a two-read record/replay cassette test
- proof bundle: `data/jimeng-lab/proof-20260610-commerce-benefits-cli/`
- latest proof returned `12` metadata rows and `140` current user benefit asset rows; pay modes included `LimitFree`, `Subscribe`, and `UserCredit`

No-spend workspace context reads are now live-proved:

- `jimeng-browser-proxy workspace-context`
- endpoints:
  - `/mweb/v1/workspace/list`
  - `/mweb/v1/workspace/get_by_ids`
- static frontend evidence shows list bodies use `{ offset, limit }`, and by-id lookup uses snake_case wire body `{ workspace_ids: [...] }`
- useful flags: `--endpoints list,get-by-ids`, `--limit`, `--offset`, and `--workspaceIds`
- proof bundles:
  - `data/jimeng-lab/proof-20260610-static-locate-workspace-context/`
  - `data/jimeng-lab/proof-20260610-workspace-context-dry-run/`
  - `data/jimeng-lab/proof-20260610-workspace-context-live/`
  - `data/jimeng-lab/proof-20260610-static-inventory-workspace-context/`
- latest live proof returned `2` listed workspaces and `1` by-id workspace, both with `ret=0`; the live response also showed numeric default workspace ids, so the boundary schema accepts string or number ids and normalizes them to strings

No-spend direct endpoint concurrency probing is now live-proved:

- `jimeng-browser-proxy rate-probe`
- defaults to rejecting likely paid/mutating/generating endpoints unless explicitly overridden
- records bounded worker concurrency, latency percentiles, HTTP status counts, `ret` counts, stop reasons, and response hashes without persisting response bodies
- transport: supports `--transport live|record|replay|fixture` and `--cassette`; backend proof is a bounded sequential record/replay cassette test
- stop conditions include HTTP `429`, `401`, `403`, auth-ish `ret=1015/1017`, risk `ret=1019`, shark/risk/captcha/verify/login messages, and transport/schema errors
- reference implementation note from `iptag/jimeng-api`: it does not publish a hard Jimeng rate limit; it supports comma-separated bearer tokens and randomly samples one per image/video request, plus long polling/retry behavior and no local image/video generation concurrency cap
- latest read-only `/mweb/v1/get_common_config` proof found no Jimeng-side `429`, auth, or `1019`/shark stop through concurrency `3072`: the `3072` IP/SNI tier completed `3071/3072` HTTP `200`, `ret=0` responses and one transport `ECONNRESET`; tail latency rose sharply at the highest tiers, so this is now network/transport-bound before a provider rate-limit signal
- proof bundles: `data/jimeng-lab/proof-20260610-rate-probe-common-config-c{1,3,6,10,16,32,64,96,128,192,256,512,768,1024,1536}/`, `data/jimeng-lab/proof-20260610-rate-probe-common-config-c2048-ip-sni/`, and `data/jimeng-lab/proof-20260610-rate-probe-common-config-c3072-ip-sni/`
- this is a read-only config endpoint bound, not a safe generation-submit limit. Keep paid generation submission concurrency at `1` until an explicitly approved capped test says otherwise.

Shared Jimeng risk-control breaker is now implemented in the consolidated client path:

- `JimengClient.requestText` detects provider `ret=1019` and raw `shark not pass` text before downstream endpoint parsers run
- default breaker opens a 10 minute cooldown after the first consecutive risk-control hit
- the budget is configurable with `riskControlBreaker.maxConsecutiveHits`, `cooldownMs`, and `nowMs` for tests
- follow-up requests during cooldown fail locally as `RISK_CONTROL_COOLDOWN_ACTIVE`, without calling the provider again
- focused proof: `data/jimeng-lab/proof-20260610-risk-control-breaker/client-test.log`

Infinite canvas project metadata is now live-proved without generation spend and schema-backed:

- `jimeng-browser-proxy infinite-canvas`
- direct `/mweb/v1/infinite_canvas/list_project`, `/mweb/v1/infinite_canvas/project_detail`, `/mweb/v1/infinite_canvas/v1/get_canvas_custom_ratio`, and `/mweb/v1/infinite_canvas/get_conversation_list`
- useful flags: `--endpoints projects,detail,ratios,conversations,all`, `--cursor`, `--limit`, `--offset`, `--imageInfo`, `--onlyFavorite`, `--projectId`, `--userId`, and `--needDraftResource`
- frontend bundle evidence:
  - project list sends frontend object fields `cursor`, `limit`, `imageInfo`, and `onlyFavorite`
  - project detail frontend callers use camelCase, but safe probes proved the wire body is `project_id` plus `option.need_draft_resource`
  - custom ratios frontend callers use camelCase, but safe probes proved the wire body is `user_id`
  - conversation list uses `project_id`, `offset`, and `count`; empty/page-only bodies return `ret=1000`, while project-scoped bodies return `ret=0`
- normalized output hashes creator user ids, summarizes draft JSON by hash/counts, and omits raw draft JSON, cookies, and signed media URLs
- proof bundle: `data/jimeng-lab/proof-20260610-infinite-canvas-conversations-cli/`
- latest proof returned one canvas project, one detail record, `mode=1`, draft version `0.0.1`, zero layers/references, zero custom ratios, zero conversations, and no skipped endpoints

Explore/template mining is now live-proved without generation spend:

- `jimeng-browser-proxy templates`
- direct `/mweb/v1/get_explore` with logged-in browser session headers
- useful flags: `--limit`, `--offset`, `--category-id`, `--work-types`, `--feed-refer`
- normalizes Explore examples into prompt, model key, seed, image ratio, template metadata, usage/favorite counters, and cover dimensions
- proof bundle: `data/jimeng-lab/proof-20260610-templates-explore/`
- observed quirk: the endpoint returned 40 items for a request with `count=5`, while setting `next_offset=5`; downstream pipelines should apply local caps.

Short-video Explore mining is now live-proved without generation spend:

- `jimeng-browser-proxy short-videos`
- direct `/mweb/v1/get_explore` with `filter.work_type_list=["short_video"]`
- useful flags: `--limit`, `--offset`, `--category-id`, `--feed-refer`
- normalizes public short-video examples into durable video metadata and ranking signals: `video_id`, duration, width, height, fps, definition, format, audio/mute flags, transcoded definitions, play/favorite/comment/share counts, and metadata effect id/type
- signed video URLs are intentionally not normalized into durable fields; raw responses remain ignored under `data/**`
- proof bundle: `data/jimeng-lab/proof-20260610-short-videos-explore/`
- latest proof returned 20 short-video items for `count=5`, `next_offset=5`, top play count `1718727`, and top video metadata `1280x720`, `85s`, `15fps`, with audio.

Overseas short-video feed mining is now live-proved without generation spend:

- `jimeng-browser-proxy overseas-short-videos`
- direct `/mweb/v1/feed_short_video` with `filter.work_type_list=["short_video"]`
- useful flags: `--limit`, `--offset`, `--category-id`, `--feed-refer`
- frontend bundle evidence: `GET_OVERSEAS_SHORT_VIDEO="/mweb/v1/feed_short_video"` and the same short-video query token shape as the Explore short-video lane
- parser accepts both snake_case live responses and camelCase frontend/domain model shapes
- normalized output redacts signed cover URLs from item lists while retaining cover URL presence, dimensions, video metadata, ranking signals, and effect/template ids
- proof bundle: `data/jimeng-lab/proof-20260610-overseas-short-videos/`
- latest proof returned 4 items for `count=5`, `next_offset=5`, top play count `2382533`, and top video metadata `3840x2160`, `57s`, `30fps`, with audio.

CapCut commercial template category mining is now live-proved without generation spend:

- `jimeng-browser-proxy capcut-categories`
- signed direct `https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_categories`
- frontend bundle evidence: `GetBatchCategories="/lv/v1/cc_web/plane/get_categories"`, body `{sdk_version:"16.1.0"}`, and signer `md5("9e2c|"+pathname.slice(-7)+"|7|5.8.0|"+deviceTime+"||11ac")`
- useful flags: `--capcut-lan`, `--capcut-loc`
- transport: supports `--transport live|record|replay|fixture` and `--cassette`; backend proof is a record/replay cassette test
- normalized output records durable category ids, starling keys, display names, log id, and response hash without signed media URLs
- proof bundle: `data/jimeng-lab/proof-20260610-capcut-categories/`
- latest proof returned 8 commercial template categories: Black Friday, Clothing and shoes, Cosmetic dailyization, Food beverages, Jewelry, Furniture, Consumer electronics, and pets.

CapCut template collection, row, and detail browsing is now live-proved without generation spend:

- `jimeng-browser-proxy capcut-collections`
- `jimeng-browser-proxy capcut-collection-templates`
- `jimeng-browser-proxy capcut-template-detail`
- signed direct `https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_collections`
- signed direct `https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_collection_templates`
- signed direct `https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_template_detail`
- useful flags: `--collection-id`, `--template-id`, `--limit`, `--cursor`, `--needDraft`, `--capcut-lan`, `--capcut-loc`
- transport: supports `--transport live|record|replay|fixture` and `--cassette`; backend proof is a record/replay cassette test covering collections, rows, details, static metadata, and guarded CapCut probe replay
- confirmed row body uses `id:<collectionId>`; guessed `category_id` and `collection_id` bodies were wrong
- confirmed detail body uses the string template `web_id`; rounded numeric ids are not stable enough
- proof bundles:
  - `data/jimeng-lab/proof-20260610-capcut-collections/`
  - `data/jimeng-lab/proof-20260610-capcut-collection-templates/`
  - `data/jimeng-lab/proof-20260610-capcut-template-detail/`
- latest proof returned 35 collections, 5 Beauty Care templates for `collection_id=10034`, and detail for `template_id=7369116096600771846` with `template_url_present=true`, version `1.4.3`, and material counts `effects:8`, `local_images:4`, `file_infos:1`
- remaining related endpoints are now explicitly blocked on exact UI payload capture:
  - `/lv/v1/cc_web/replicate/search_templates`: no-spend direct probes returned `ret=1000 param error` across 10 recovered keyword/category/search-id variants
  - `/lv/v1/cc_web/plane/batch_get_collection_templates`: no-spend direct probes returned `ret=1000 param error` across 15 object/list/nested collection variants
  - `/lv/v1/cc_web/plane/get_collection_presets`: no-spend direct probes with confirmed collection ids returned `ret=1015 check login error` across 8 variants
  - `/lv/v1/cc_web/plane/preset_template_detail`: depends on a real preset id from the currently blocked preset-listing path
  - `/lv/v1/cc_web/plane/fuzzy_search_templates`: no-spend direct probes returned `ret=0` with empty lists for guessed keyword/title bodies
  - proof bundles: `data/jimeng-lab/proof-20260610-capcut-probe-batch-collection-templates*/`, `data/jimeng-lab/proof-20260610-capcut-probe-search-templates-v2/`, and `data/jimeng-lab/proof-20260610-capcut-probe-presets-confirmed-collection/`

CapCut public template ratio/scene metadata is now live-proved without generation spend and without a browser session:

- `jimeng-browser-proxy capcut-template-metadata`
- public static JSON endpoints:
  - `https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_49/bee_prod_49_bee_publish_709.json`
  - `https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_149/bee_prod_149_bee_publish_835.json`
- frontend bundle evidence: `GetAllTemplateRatio`, `GetTemplateScenes`, and `k.U8.mercury="https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod"`
- transport: supports `--transport live|record|replay|fixture` and `--cassette`
- proof bundle: `data/jimeng-lab/proof-20260610-capcut-template-metadata/`
- latest proof returned 6 ratio presets and 33 scene formats; first scenes include Instagram post, Instagram story, Instagram portrait, Tiktok, YouTube thumbnail, YouTube intro, YouTube end screen, and Facebook post.

Reference-image inspection is now live-proved without generation spend:

- `jimeng-browser-proxy describe-image`
- direct `/mweb/v1/get_image_description` and `/mweb/v1/face_recognize` with logged-in browser session headers
- local images are uploaded through the live-proved ImageX scene `2` path first, unless an existing `--imageUri` is supplied
- useful flags: `--image`, `--file`, `--imageUri`, `--noDescription`, `--noFaces`
- normalized proof records provider URI, description presence/length, response hashes, and face count without signed upload traces
- proof bundle: `data/jimeng-lab/proof-20260610-reference-image-inspect/`
- latest proof produced description `黑发女人，白色背心。`; face recognition returned `ret=0`, `errmsg=success`, and `face_count=0` for that input image.

ControlNet reference preview is now live-proved without generation spend:

- `jimeng-browser-proxy controlnet-preview`
- direct `/mweb/v1/blend_preview` with frontend constants `model=img2img_xl_sft`, `ability.name=control_net`, `control_net_list[].name=pose|depth|canny`, and default strength `0.6`
- pose mode also calls `/mweb/v1/pose_detect`
- local images are uploaded through the live-proved ImageX scene `2` path first, unless an existing `--imageUri` is supplied
- useful flags: `--image`, `--file`, `--imageUri`, `--control`, `--strength`, `--fitMode`, `--noPoseDetect`, `--noDownload`
- normalized proof records provider URI, preview provider URI, pose-detect result, frontend save-param patch, response hashes, and a local preview PNG path without signed URLs
- proof bundles:
  - pose: `data/jimeng-lab/proof-20260610-controlnet-pose-preview/`
  - depth: `data/jimeng-lab/proof-20260610-controlnet-depth-preview/`
  - canny: `data/jimeng-lab/proof-20260610-controlnet-canny-preview/`
- latest pose proof produced `preview_image_uri=tos-cn-i-tb4s082cfz/222b232061324073accaf7992ec3ad87`, `pose_detected=true`, and a `1024x1024` pose skeleton PNG at `data/jimeng-lab/proof-20260610-controlnet-pose-preview/artifacts/controlnet-preview-20260609162825-rvn7f6-pose-preview.png`.
- latest depth proof produced `preview_image_uri=tos-cn-i-tb4s082cfz/df194e1d74a54982ae5ceb151e239c9c` and a `1024x1024` grayscale depth PNG at `data/jimeng-lab/proof-20260610-controlnet-depth-preview/artifacts/controlnet-preview-20260609163638-wworll-depth-preview.png`.
- latest canny proof produced `preview_image_uri=tos-cn-i-tb4s082cfz/915b0cd6c0c943fc9ab24b5c12e5a26d` and a `1024x1024` outline PNG at `data/jimeng-lab/proof-20260610-controlnet-canny-preview/artifacts/controlnet-preview-20260609163709-xrv4zg-canny-preview.png`.

Object/saliency segmentation is now live-proved without generation spend:

- `jimeng-browser-proxy object-mask`
- direct `/mweb/v1/saliency_seg` using frontend-derived request shapes:
  - canvas mode: `{"image_uri_list":["tos-cn-i-..."],"mode":"canvas"}`
  - default mode: `{"image_uri_list":["tos-cn-i-..."]}`
- local images are uploaded through the live-proved ImageX scene `2` path first, unless an existing `--imageUri` is supplied
- useful flags: `--image`, `--file`, `--imageUri`, `--mode canvas|default|both`, `--noDownload`
- normalized proof records provider URI, request shapes, response hashes, mask provider URIs, URL-presence booleans, and local mask PNG paths without signed URLs
- proof bundle: `data/jimeng-lab/proof-20260610-object-mask/`
- latest proof produced `image_uri=tos-cn-i-tb4s082cfz/080999a077994629bbec76c6f344a09a.png`, one `canvas` mask and one `default` mask:
  - canvas mask URI `tos-cn-i-tb4s082cfz/2b0258d421f14b02b6f20a23eeaae0ec`, artifact `data/jimeng-lab/proof-20260610-object-mask/artifacts/object-mask-20260609165112-8yjxpj-canvas-mask-01.png`
  - default mask URI `tos-cn-i-tb4s082cfz/d6641d59e6de4d17be119c0b98506129`, artifact `data/jimeng-lab/proof-20260610-object-mask/artifacts/object-mask-20260609165112-8yjxpj-default-mask-01.png`
  - both mask artifacts are `2048x2048` PNGs.

Saved subject/persona listing is now live-proved without generation spend:

- `jimeng-browser-proxy subjects`
- direct `/mweb/v1/dreamina_subject/get` with logged-in browser session headers
- useful flags: `--cursor`, `--limit`
- normalizes durable subject fields: `subject_id`, `name`, `description`, `status`, create/update timestamps, cover image URI, cover URL presence, image URI count, and voice id count
- normalized summaries intentionally omit signed cover URLs and raw responses remain ignored under `data/**`
- proof bundle: `data/jimeng-lab/proof-20260610-subjects/`
- latest proof returned `ret=0`, `errmsg=success`, `subject_count=0`, `has_more=false`, `next_cursor=0`, and response hash `618858c54ed5d0b298cf37ed03bf29d27042f54e3e999bb143932cec6a3ef31f`.

Subject/persona creation is now live-proved without generation spend:

- `jimeng-browser-proxy subject-create`
- confirmed from asset library `主体 -> 创建主体` UI capture, then implemented as direct background API calls
- local images upload through the confirmed ImageX scene `2` path, then call:
  - `/mweb/v1/imagex/submit_audit_job`
  - `/mweb/v1/get_image_by_uri`
  - `/mweb/v1/dreamina_subject/create`
- create payload shape: `content.name`, `content.description`, `content.main_image.{width,height,image_uri,image_url}`, and `workspace_id`
- useful flags: `--workspaceId`, `--name`, `--description`, `--image`, `--file`, `--imageUri`, `--imageWidth`, `--imageHeight`, `--imageUrl`
- proof bundle: `data/jimeng-lab/proof-20260610-subject-create-cli/`
- latest proof created `subject_id=12352249053442`, `data_id=12352249053698`, using `image_uri=tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png`, `2048x2048`, with summary hash `52a8d7ba8acf00de72912228a5d1ab1ea0d96edea5adf8be44744d2092258dec`
- normalized summaries intentionally omit signed image URLs; raw upload/create responses remain ignored under `data/**`

Subject/persona update/delete is now live-proved without generation spend:

- `jimeng-browser-proxy subject-update`
- `jimeng-browser-proxy subject-delete`
- direct `/mweb/v1/dreamina_subject/update` and `/mweb/v1/dreamina_subject/delete` with logged-in browser session headers
- frontend bundle evidence maps `updateSubject({subjectId, content})`, `deleteSubject({subjectId})`, and batch `deleteSubjects({subjectIdList})` through the same JSON casing transform as create/list
- useful flags: `--subjectId`, `--subjectIds`, `--name`, `--description`, `--image`, `--file`, `--imageUri`, `--imageWidth`, `--imageHeight`, `--imageUrl`
- proof bundle: `data/jimeng-lab/proof-20260610-subject-lifecycle/`
- latest proof created temporary `subject_id=14204993143308`, updated it to `CLI QA Updated`, deleted it, then verified `subjects --subjectIds 14204993143308` returned `subject_count=0`
- update response hash: `47168986f6e80a31c8f169afdb19755b4a08895f496292e988e6f1d88b6152c2`
- delete response hash: `8cc3d46d8dec2d339dc0e7fe2d338f0ac4946752fc276a0f9a508bcb7c1f52f8`
- normalized summaries intentionally omit signed image URLs; raw responses remain ignored under `data/**`

Subject/persona voice generation is request-shaped but not live-submitted:

- `jimeng-browser-proxy subject-generate-voice --dryRun`
- frontend bundle evidence maps `generateSubjectVoice({imageUri})` to `/mweb/v1/dreamina_subject/generate_voice` with request body `{"image_uri":"tos-cn-i-..."}`
- proof bundle: `data/jimeng-lab/proof-20260610-subject-lifecycle/`
- this dry-run plan is now sessionless/no-browser; latest smoke proof: `data/jimeng-lab/cli-sessionless-dryruns/`
- use `jimeng-browser-proxy request-plan-compare --plan <subject-generate-voice-dry-run-plan.json> --rawNetwork <capture>/raw-network.jsonl` to compare this simple request shape against passive UI traffic before enabling live submit
- live submit is disabled because it may consume generation quota and still needs explicit spend approval or a captured UI submit

Custom voice clone coverage is now partially implemented and proved:

- `jimeng-browser-proxy voice-clones`
- `jimeng-browser-proxy voice-clone-submit`
- `jimeng-browser-proxy voice-clone-query`
- `jimeng-browser-proxy voice-clone-update`
- `jimeng-browser-proxy voice-clone-delete`
- frontend bundle evidence maps:
  - cloned voice assets: `/mweb/v1/get_user_local_item_list` with `effect_type=218`, `filter_opt.clone_voice_status=[1,2]`
  - voice clone submit: `/mweb/v1/voice/submit_task` with `scene=1`, `voice_clone.audio`, `voice_clone.name`
  - voice task query: `/mweb/v1/voice/query_task` with `task_id_list`
- voice update/delete: `/mweb/v1/voice/update` and `/mweb/v1/voice/delete` with `local_item_id`
- live no-spend asset proof returned `ret=0`, `errmsg=success`, `voice_count=0`, `next_offset=50`
- proof bundle: `data/jimeng-lab/proof-20260610-voice-clone/`
- submit/query dry-run/update/delete request plans are now sessionless/no-browser; latest smoke proof: `data/jimeng-lab/cli-sessionless-dryruns/`
- use `jimeng-browser-proxy request-plan-compare --plan <voice-clone-*-dry-run-plan.json> --rawNetwork <capture>/raw-network.jsonl` for submit/query/update/delete capture parity checks; pass `--endpoint` only for ambiguous multi-endpoint plans
- submit/update/delete remain dry-run-only because they may create or mutate account assets; enable live only after background CDP capture and explicit approval or a disposable fixture

Workspace/workbench asset listing is now live-proved without generation spend:

- `jimeng-browser-proxy assets`
- direct `/mweb/v1/get_asset_list` with logged-in browser session headers
- frontend capture evidence: text-to-image workbench polling used `count`, `direction=1`, `mode=workbench`, `option.image_info`, `option.origin_image_info`, `option.order_by`, `option.only_favorited`, `option.end_time_stamp`, `option.hide_story_agent_result`, `asset_type_list=[1,2,5,6,7,8,9,10,12]`, and `workspace_id`
- useful flags: `--limit`, `--asset-types`, `--asset-mode`, `--direction`, `--order-by`, `--endTimeStamp`, `--onlyFavorite`, `--includeStoryAgentResult`, `--workspaceId`
- session referer workspace inference is supported when `--workspaceId` is omitted
- normalized summaries keep durable asset ids, submit/history ids, status, prompt, model key/name, seed, provider image/video URIs, dimensions, generated item counts, and URL-presence booleans while omitting signed media URLs
- proof bundle: `data/jimeng-lab/proof-20260610-assets/`
- latest proof returned `asset_count=1`, `has_more=false`, `next_offset=1780998990927`, first `asset_id=39148697060354`, `submit_id=a6bbee65-bed0-4e5b-aaf1-5ab466137b82`, `status=50`, `generated_item_count=4`, `model_req_key=high_aes_general_v50`, response hash `5373ac3f6339e82f7f3090059b742d83b17b9b438151476993466ae6d105f312`, and normalized summary hash `10ba3a679c2e7e472c20fb186dedbd5289687c2a5b0aba7e88a0509bf17a4af8`

History list lookup is now implemented without generation spend:

- `jimeng-browser-proxy history-list`
- direct `/mweb/v1/get_history` with logged-in browser session headers
- request shape: `offset`, `count`, `direction`, optional `workspace_id`, optional `filter_type_list`, optional `image_resolution_strategy`, optional `order_by`, and optional `hide_story_agent_result`
- response contract is decoded through Effect Schema; empty `records_list` is valid, while missing `records_list` is treated as provider contract drift
- useful flags: `--limit`, `--offset`, `--direction`, `--workspaceId`, `--filter-types`, `--order-by`, `--hideStoryAgentResult`
- known live probes returned `ret=0` with empty `records_list`; use `assets`, `history-records`, and `history-queue` for richer known-populated lookups until a non-empty UI capture proves broader pagination scope

History queue/status lookup is now live-proved without generation spend:

- `jimeng-browser-proxy history-queue`
- direct `/mweb/v1/get_history_queue_info` with logged-in browser session headers
- frontend bundle evidence maps `getHistoryQueueInfo({historyIds})`; direct wire body must be `history_ids`
- useful flags: `--historyId`, `--historyIds`
- negative casing proof: `{"historyIds":["39148697060354"]}` returned `ret=1000`, `errmsg=invalid parameter`
- normalized summaries keep per-history status, queue index/status/length, priority, polling interval/timeout, display thresholds, forecast cost time when present, and debug-info hashes while omitting raw queue debug strings
- proof bundle: `data/jimeng-lab/proof-20260610-history-queue/`
- latest proof returned `entry_count=1`, `history_id=39148697060354`, `status=0`, `queue_status=3`, `queue_length=0`, `polling_interval_seconds=30`, `polling_timeout_seconds=86400`, response hash `292217828c13e57d7908a146e9496d36194c57ab075d547a24e74c7eb61ea8c0`, and debug-info hash `f71e62a6cfa3199b9974993f1774d6161383110784671d6fc9c3fa945072182e`

History record lookup is now live-proved without generation spend and schema-backed:

- `jimeng-browser-proxy history-records`
- direct `/mweb/v1/get_history_by_ids` with logged-in browser session headers
- useful flags: `--submitId`, `--submitIds`, `--historyId`, `--historyIds`
- request shape: `{"submit_ids":["..."],"need_batch":true,"history_ids":["..."]}`
- response contract is decoded through permissive Zod schemas before normalization; additive provider fields are allowed, while the relied-on `ret`/`errmsg`/`data` map and history record/media paths produce explicit contract-drift errors if changed
- normalized summaries keep lookup key, history id, submit id, status/task status, prompt, model key/name, seed, generated item count, provider image/video URIs, dimensions, and URL-presence booleans while omitting signed media URLs
- proof bundles: `data/jimeng-lab/proof-20260610-history-records/` and `data/jimeng-lab/proof-20260610-history-records-by-history-id/`
- latest submit-id proof returned `record_count=1`, `lookup_key=a6bbee65-bed0-4e5b-aaf1-5ab466137b82`, `history_record_id=39148697060354`, `status=50`, `task_status=50`, `generate_type=1`, `mode=workbench`, `model_req_key=high_aes_general_v50`, `model_name=图片5.0 Lite`, `seed=105719980`, `total_image_count=4`, `finished_image_count=4`, response hash `2da0421296eb99f5c3e14b4ac543d800481a4f875e8b7c555f6404ef903bd413`
- latest history-id proof returned the same completed record for lookup key `39148697060354`, response hash `77079fffff13a0c230698d7032bacd8a9784bbf9e8184e4685dd37e324aea8a6`

Endpoint replay/probing is now available to speed future slices:

- `jimeng-browser-proxy endpoint-probe`
- replays explicit JSON body variants against one endpoint using saved/background session headers
- writes raw local response bodies under ignored `data/**`
- writes normalized request/response shape summaries with hashes, `ret`/`errmsg`, and URL-like-token booleans; signed URL values are not included in normalized summaries
- transport: supports `--transport live|record|replay|fixture` and `--cassette`; backend proof is a multi-variant record/replay cassette test
- latest proof used `/mweb/v1/get_video_by_vid` to compare `{"vids":["v03870g10004d8k1u4nog65hb08dnhig"]}` vs `{"vid":"v03870g10004d8k1u4nog65hb08dnhig"}`; `vids` returned `ret=0`, singular `vid` returned `ret=1000`
- proof bundle: `data/jimeng-lab/proof-20260610-endpoint-probe-video-info/`

VOD video metadata lookup is now live-proved without generation spend and schema-backed:

- `jimeng-browser-proxy video-info`
- direct `/mweb/v1/get_video_by_vid` with logged-in browser session headers
- confirmed request shape: `{"vids":["..."]}`
- useful flags: `--vid`, `--vids`
- normalized summaries keep VOD id, duration, dimensions, fps, format, definition, md5, size, transcoded definitions, and URL-presence booleans while omitting signed video/cover URLs
- proof bundle: `data/jimeng-lab/proof-20260610-video-info/`
- latest proof returned `vid=v03870g10004d8k1u4nog65hb08dnhig`, `duration=5s`, `width=704`, `height=1248`, `fps=24`, `format=mp4`, `definition=720p`, `size_bytes=4285498`, response hash `06ae536f69e703297f9cba1988665d0dcf4ad7c05bc117f79332931ec010a17d`

Capture analysis/ranking is now available as the repeatable "tool that builds the tool" stage:

- `jimeng-browser-proxy capture-analyze`
- offline; does not load a browser session or foreground any UI
- input: `raw-network.jsonl` from `jimeng-network-recorder`, either via `--rawNetwork` or `--captureDir`
- useful flags: `--staticRoot`, `--limit`, `--includeRisky`
- decodes recorder events with permissive Zod schemas so additive CDP/provider fields do not break analysis, while unsupported event shapes fail explicitly
- normalized output ranks endpoints by UGC usefulness, classifies risk (`read`, `upload`, `generate`, `mutate`, `payment`, etc.), summarizes request/response shapes, keeps `ret`/`errmsg` and hashes, and records static endpoint string hints without signed URLs
- raw local output writes replay candidate JSON for `endpoint-probe`; only read/API-like endpoints are included by default, and risky replay candidates require `--includeRisky`
- proof bundle: `data/jimeng-lab/proof-20260610-capture-analyze-subject-create-v3/`
- latest proof analyzed 138 events / 27 requests into 5 ranked candidates and 1 safe replay candidate (`/mweb/v1/get_unread_count`); top ranked endpoint was upload/audit `/mweb/v1/imagex/submit_audit_job`, correctly not replay-safe by default

Discovery worklists are now available as the next token-efficient planning layer:

- `jimeng-browser-proxy discovery-worklist`
- offline; does not load a browser session, foreground UI, or spend generation quota
- input: one or more `capture-analyze` normalized analysis JSON files via `--analysis`, optional raw endpoint-probe candidate JSON via `--probeCandidates`, and optional source/bundle roots via `--staticRoot`
- useful flags: `--includeKnown` for audit views that include already-covered endpoints
- decodes analysis/probe JSON with permissive runtime schemas and emits a prioritized worklist of next API slices: replay/promote, capture request builder, compare dry-run before live, approval/disposable fixture, already-covered, or low-value/risky documentation
- writes normalized markdown/JSON summaries without raw probe bodies; raw per-endpoint replay variant files stay under ignored `data/**`
- proof bundle: `data/jimeng-lab/proof-20260610-discovery-worklist-subject-create-v3/`
- latest proof merged the subject-create capture analysis with static source hints into 18 work items, skipped 2 already-covered capture endpoints, exported 1 raw replay variant for `/mweb/v1/get_unread_count`, and historically highlighted subject `generate_voice`, voice clone mutations, CapCut template row/search/collection payload capture, remaining `/mweb/v1/aigc_draft/generate` modes, and older agent/feed/workspace surfaces; the CapCut collection/row/detail part has since been promoted, leaving search/batch/preset capture as the CapCut gap

Static request-builder localization is now available as the bridge between worklist and implementation:

- `jimeng-browser-proxy static-locate`
- offline; does not load a browser session, foreground UI, or spend generation quota
- input: endpoints via `--endpoint` or one or more `capture-analyze` normalized analysis JSON files via `--analysis`, plus source/bundle roots via `--staticRoot`
- useful flags: `--limit` for occurrences per endpoint, `--contextLines` for snippet size, `--symbol` for frontend request-builder names, and `--staticQuery` for arbitrary bundle/source search terms
- writes raw local snippets under ignored `data/**`
- writes normalized summaries with occurrence counts, files, redacted snippets, nearby symbol/identifier/string hints, and mise-managed `ast-grep` follow-up commands; normalized snippets redact URL query strings and credential-like assignments
- proof bundle: `data/jimeng-lab/proof-20260610-static-locate-subject-create/`
- latest proof used the subject-create capture analysis and local Jimeng client source, derived 4 API endpoints, found 16 local occurrences, and had no signed URLs or credentials in normalized output
- symbol-search proof bundle: `data/jimeng-lab/proof-20260610-static-locate-capcut-templates-symbols/`
- latest symbol-search proof searched CapCut template endpoints plus `SearchTemplates`, `GetTemplatesAccordCategory`, `GetBatchTemplatesByCategory`, `FuzzySearchTemplateByTitle`, `GetTemplateHotWords`, and `GetCategories`, found 24 occurrences, and had no signed URLs or credentials in normalized output

Static API inventory is now available as the systematic coverage map:

- `jimeng-browser-proxy static-inventory`
- offline; does not load a browser session, foreground UI, or spend generation quota
- input: one or more saved frontend bundle/source roots via `--staticRoot`
- useful flags: `--limit` and `--includeKnown`
- scans API endpoint strings and public CapCut `bee_prod` catalog URLs, classifies read/generate/upload/mutate/payment/analytics risk, joins the existing known-command map, and ranks uncovered resources for the next slice
- default output skips fully implemented endpoints so it stays focused on gaps; `--includeKnown` produces an audit inventory
- proof bundle: `data/jimeng-lab/proof-20260610-static-inventory/`
- latest proof scanned `data/jimeng-lab/js-sweep/files` plus `packages/jimeng-client/src`, found 247 resources, included 120 items at the current review limit, skipped 42 implemented endpoints, and counted 61 high-value gaps after the CapCut collection/row/detail, LV editor catalog, infinite-canvas read, account credit, commerce-benefit, and workspace-context commands were promoted
- known status counts are now `unknown=125`, `partial=4`, `implemented=42`, `dry_run_only=4`, `blocked=69`, `captured_only=2`, and `cataloged_only=1`; the five CapCut search/batch/preset-related endpoints above are blocked with exact replay evidence and recommended action `capture_exact_payload`
- seven video-generation helper endpoints are also now explicitly blocked/capture-needed instead of generic unknowns:
  - `/mweb/v1/video_generate/get_switch_model_queue_info`: safe no-spend probes with empty, `model_req_key`, `model_req_keys`, and scene bodies returned `ret=1000 invalid parameter`
  - `/mweb/v1/video_generate/pre_process` and `/mweb/v1/video_generate/mget_pre_process_result`: frontend task submit/result pair; capture exact UI payload and task ids before promotion
  - `/mweb/v1/video_generate/face_auth/skip` and `/mweb/v1/video_generate/face_auth/skip/query`: Seedance face-auth skip task submit/query pair; capture exact UI payload and task id before promotion
  - `/mweb/v1/aigc_draft/cancel_generate`: mutates an in-flight provider job; use only with an active disposable job or exact UI capture
  - `/mweb/v1/aigc_draft/generate_accelerate`: may spend quota or alter queue priority; require exact UI capture and explicit approval before live replay
- proof bundles: `data/jimeng-lab/proof-20260610-static-locate-video-generate-helpers/`, `data/jimeng-lab/proof-20260610-switch-model-queue-probe/`, and refreshed `data/jimeng-lab/proof-20260610-static-inventory/`
- ten CapCut/LV editor image helper endpoints are now explicitly blocked/capture-needed instead of generic unknowns:
  - `/lv/v1/editor/image/ai_model/submit_task`: image AI model task submit; capture exact UI payload and approval context before live replay
  - `/lv/v1/editor/image/ai_model/batch_get_results`: result lookup depends on task ids from `ai_model/submit_task`
  - `/lv/v1/editor/image/ai_model/materials`: needs exact model/material UI context
  - `/lv/v1/editor/image/ai_model/create_cloth_mask`: cloth-mask task endpoint may create provider-side task state
  - `/lv/v1/editor/image/batch_get_url`: needs exact resource id/URI list and auth context
  - `/lv/v1/editor/image/embed_resource`: needs exact source resource payload
  - `/lv/v1/editor/image/gen_background`: AI background generation; capture exact UI payload and approval context
  - `/lv/v1/editor/image/interactive_matting`: needs exact brush/image payload
  - `/lv/v1/editor/image/saliency_seg`: distinct from implemented Jimeng `/mweb/v1/saliency_seg`; capture exact LV editor payload
  - `/api/biz/v1/image/entity_seg`: auto-selection entity segmentation; capture exact editor UI payload
- proof bundles: `data/jimeng-lab/proof-20260610-static-locate-lv-editor-image-helpers/`, `data/jimeng-lab/proof-20260610-static-locate-lv-editor-image-entity-seg/`, and refreshed `data/jimeng-lab/proof-20260610-static-inventory/`
- four LV asset read endpoints are now explicitly blocked/capture-needed instead of generic read probes:
  - `/lv/v1/asset/list`: EverCloud material list needs exact `workspace_id`/`space_id` from the workspace service
  - `/lv/v1/asset/query`: user asset list returned `ret=1014 system busy` across workspace basic/no-parent/minimal bodies and a Jimeng query-param retry
  - `/lv/v1/asset/detail`: material detail depends on asset ids plus workspace/space ids from a successful LV asset list/query capture
  - `/lv/v1/asset/query_process`: async process status depends on `process_id` values from mutating copy/create/upload flows
- `/cc/v1/workspace/get_user_workspaces` is not counted by the current static-inventory namespace extractor, but static-locate found the frontend builder and no-spend probes with count/cursor plus `lite_aid=513695` returned `ret=1014 system busy`; keep it as blocked supporting context until exact UI capture proves the gateway/query params
- proof bundles: `data/jimeng-lab/proof-20260610-static-locate-lv-asset-read/`, `data/jimeng-lab/proof-20260610-static-locate-lv-workspace-list/`, `data/jimeng-lab/proof-20260610-lv-asset-query-probe/`, `data/jimeng-lab/proof-20260610-lv-asset-query-aid-probe/`, `data/jimeng-lab/proof-20260610-lv-workspace-list-probe/`, `data/jimeng-lab/proof-20260610-lv-workspace-list-lite-aid-probe/`, and refreshed `data/jimeng-lab/proof-20260610-static-inventory/`
- signed `capcut-probe` now supports an explicit allowlist of read-oriented LV editor endpoints and routes `/lv/v2/cc_web_task/*` probes to `https://feed-api-sg.capcut.com`; it rejects known mutating paths such as `/lv/v1/cc_web/plane/del_presets_template`
- six LV editor/template endpoints are now explicitly blocked/capture-needed instead of generic read probes:
  - `/lv/v1/cc_web/plane/del_presets_template`: mutates saved preset-template state; signed probe rejects it without disposable fixture or approval
  - `/lv/v1/editor/template/recent_list`: signed no-session probes with count/lang and cursor bodies returned `ret=1015 check login error`
  - `/lv/v1/editor/template/check_post_permission`: signed no-session probe returned `ret=1015 check login error`
  - `/lv/v1/editor/draft/get_template_file`: signed probe with empty `uris` returned `ret=1016 ERR_PARAM`; needs real template file URIs
  - `/lv/v1/editor/plane/intelligence/query_recommend_template`: signed no-asset probe returned `ret=-3 bad request`; needs exact workspace/assets/aspect-ratio payload
  - `/lv/v2/cc_web_task/get_task_draft`: signed feed-api probes with empty/zero task ids returned `ret=1015 check login error`
- proof bundles: `data/jimeng-lab/proof-20260610-static-locate-lv-editor-template-reads/`, `data/jimeng-lab/proof-20260610-static-locate-lv-preset-delete/`, `data/jimeng-lab/proof-20260610-lv-editor-template-recent-probe/`, `data/jimeng-lab/proof-20260610-lv-template-permission-probe/`, `data/jimeng-lab/proof-20260610-lv-template-file-probe/`, `data/jimeng-lab/proof-20260610-lv-query-recommend-template-probe/`, `data/jimeng-lab/proof-20260610-lv-task-draft-probe/`, and refreshed `data/jimeng-lab/proof-20260610-static-inventory/`
- fourteen asset/template/history mutation endpoints are now explicitly blocked on disposable fixtures or approval instead of generic unknowns:
  - LV asset mutation/upload state: `/lv/v1/asset/copy`, `/lv/v1/asset/create`, `/lv/v1/asset/create_cloud_asset`, `/lv/v1/asset/delete`, `/lv/v1/asset/label_as_exported`, `/lv/v1/asset/prepare_upload_cloud`, and `/lv/v1/asset/rename`
  - LV editor template publish/status: `/lv/v1/editor/template/add`, `/lv/v1/editor/template/add_async`, and `/lv/v1/editor/template/add_query`
  - EverPhoto/LV sync/promote: `/lv/v1/ever_photo/batch_sync_asset` and `/lv/v1/ever_photo/promote_asset`
  - Jimeng workbench mutations: `/mweb/v1/remove_history` and `/mweb/v1/update_video_default_bgm`
- proof bundle: `data/jimeng-lab/proof-20260610-static-locate-lv-mutation-blockers/`; no live mutation requests were sent
- `jimeng-browser-proxy capcut-editor-catalog` is now live-proved without generation spend or browser foregrounding for LV editor catalog data:
  - implemented endpoints: `/lv/v1/effect/get_panel_info`, `/lv/v1/effect/get_category_effects`, `/lv/v1/effect/get_all_fonts`, and `/lv/v1/editor/plane/color/feed`
  - useful flags: `--endpoints panel,effects,fonts,colors,all`, `--panel`, `--category`, `--limit`, `--offset`, `--lang`, `--region`, `--capcut-lan`, and `--capcut-loc`
  - transport: supports `--transport live|record|replay|fixture` and `--cassette`; backend proof is a four-endpoint record/replay cassette test
  - latest proof returned 14 font categories, 745 font/effect rows, and 20 color palettes
  - proof bundles: `data/jimeng-lab/proof-20260610-static-locate-lv-editor-catalog-reads/`, `data/jimeng-lab/proof-20260610-lv-editor-catalog-probe-{panel-info,category-effects,all-fonts,color-feed}/`, `data/jimeng-lab/proof-20260610-lv-editor-catalog-cli/`, and refreshed `data/jimeng-lab/proof-20260610-static-inventory/`
- nine additional LV read-state endpoints are now explicitly blocked/capture-needed instead of generic read probes:
  - `/lv/v1/editor/effect/recent_list` and `/lv/v2/editor/effect/recent_list`: signed probes with empty/fonts/effects bodies returned `ret=1015 check login error`
  - `/lv/v1/editor/plane/common/recent_list`: signed probes returned `ret=0` but empty `item_list`; needs a non-empty UI capture before promotion
  - `/lv/v1/editor/plane_draft/get_content_map`: signed probes with empty/empty-id/zero-id bodies returned `ret=1016 ERR_PARAM`; needs a real draft/content-map id
  - `/lv/v1/editor/plane_draft/get_draft_detail`: signed probes with empty/empty-id/zero-id bodies returned `ret=1015 check login error`
  - `/lv/v1/ever_photo/batch_get_sync_state` and `/lv/v1/ever_photo/get_user_space`: signed probes returned `ret=1015 check login error`; need exact EverPhoto/LV auth context and real asset ids where applicable
  - `/lv/v1/intelligence/preset_resource_list`: signed probes with empty/image-editor/query bodies returned `ret=-1 system busy`; needs exact UI payload
  - `/lv/v2/task/multi_get_tasks`: signed feed-api probes with empty/empty-list/zero task ids returned `ret=1015 check login error`
- proof bundles: `data/jimeng-lab/proof-20260610-static-locate-lv-read-state/`, `data/jimeng-lab/proof-20260610-lv-editor-effect-recent-probe/`, `data/jimeng-lab/proof-20260610-lv-v2-editor-effect-recent-probe/`, `data/jimeng-lab/proof-20260610-lv-plane-common-recent-probe/`, `data/jimeng-lab/proof-20260610-lv-plane-draft-content-map-probe/`, `data/jimeng-lab/proof-20260610-lv-plane-draft-detail-probe/`, `data/jimeng-lab/proof-20260610-lv-ever-photo-sync-state-probe/`, `data/jimeng-lab/proof-20260610-lv-ever-photo-user-space-probe/`, `data/jimeng-lab/proof-20260610-lv-preset-resource-list-probe/`, `data/jimeng-lab/proof-20260610-lv-multi-get-tasks-probe/`, and refreshed `data/jimeng-lab/proof-20260610-static-inventory/`
- `/mweb/v1/get_history` is now covered by `jimeng-browser-proxy history-list`; safe direct probes with plain, frontend-derived, and explicit `workspace_id=14199856180236` bodies returned `ret=0` with empty `records_list`, which is valid but not yet a rich proof of pagination scope.
- normalized proof files contain no credential markers

Signed CapCut endpoint replay is now available for no-spend template payload discovery:

- `jimeng-browser-proxy capcut-probe`
- session-free; it signs requests with the recovered CapCut frontend signer and never opens or foregrounds a browser
- guarded to signed read-oriented CapCut/LV endpoints only; `edit-api-sg.capcut.com` is used for template/editor reads and `feed-api-sg.capcut.com` is used for `/lv/v2/cc_web_task/*` task reads
- input: `--endpoint`, `--body`, or `--variants`, plus optional `--capcut-lan` and `--capcut-loc`
- transport: supports `--transport live|record|replay|fixture` and `--cassette`
- writes raw variant bodies/responses under ignored `data/**`
- writes normalized shape summaries with `ret`, `errmsg`, response hashes, top-level keys, URL-like booleans, and request/response shape descriptors without signed URL values
- proof bundles:
  - `data/jimeng-lab/proof-20260610-capcut-probe-hot-words/`
  - `data/jimeng-lab/proof-20260610-capcut-probe-fuzzy/`
  - `data/jimeng-lab/proof-20260610-capcut-probe-collection/`
  - `data/jimeng-lab/proof-20260610-capcut-probe-search/`
- latest no-spend probes confirmed `/lv/v1/cc_web/replicate/get_search_words` returns `ret=0` but only region metadata for tested variants, `/lv/v1/cc_web/plane/fuzzy_search_templates` returns `ret=0` with empty lists for guessed keyword/title bodies, `/lv/v1/cc_web/replicate/search_templates` returns `ret=1000` across 10 guessed/recovered variants, `/lv/v1/cc_web/plane/batch_get_collection_templates` returns `ret=1000` across 15 variants, and `/lv/v1/cc_web/plane/get_collection_presets` returns `ret=1015` across 8 confirmed-collection variants. `/lv/v1/cc_web/plane/get_collection_templates` is promoted using the confirmed `id:<collectionId>` body; the blocked search/batch/preset endpoints need exact UI-captured payloads before CLI promotion

Lip-sync submit comparison is now available as the live-generation gate:

- `jimeng-browser-proxy lip-sync-compare`
- offline; does not load a browser session or foreground any UI
- input: a `lip-sync --dryRun` plan via `--plan`, plus captured UI submit evidence via `--rawNetwork`, `--captureDir`, or `--capture`
- extracts `/mweb/v1/aigc_draft/generate` requests, parses `draft_content.component_list[0].abilities.gen_video.text_to_video_params.video_gen_inputs[0]`, and compares it against `plan.providerInput.videoGenInputs`
- compares `text_to_video_params.model_req_key` against `plan.providerInput.modelReqKey`
- output reports path-level match/mismatch summaries and hashes/shape descriptors without raw media URL values
- proof bundle: `data/jimeng-lab/proof-20260610-lip-sync-compare-no-capture/`
- latest proof against the existing subject-create capture correctly returned `match=false`, `candidate_count=0`; next proof should use a real background CDP lip-sync UI submit capture

Paid-live generation smoke is now proven against the subscription account with explicit approval:

- proof bundle: `data/jimeng-lab/proof-20260610-paid-generation-smoke/`
- exact rerun commands are recorded in `data/jimeng-lab/proof-20260610-paid-generation-smoke/manifest.md` and `docs/qa/jimeng-browser-proxy-smoke.md`
- `jimeng-browser-proxy tts` returned `ret=0`, saved `直爽女大-7597003459665072686.mp3`, and validated as `9.768s` MP3 audio
- `jimeng-browser-proxy text2video` live-submitted `submitId=3f1c75b2-897c-4861-8c5c-92e744301e57`, reached terminal `status=50`, saved a `704x1248` H.264 MP4, and validated as `3.016667s`
- `jimeng-browser-proxy image2video` live-submitted `submitId=a12f868d-69ca-4886-9be0-29247d81b3a6`, reached terminal `status=50`, saved a `704x1248` H.264 MP4, and validated as `3.016667s`
- stale workbench `text2image` capture `data/jimeng-captures/20260609095503-text2image-submit/capture-template.raw.json` now returns `ret=3018`, `errmsg=permission denied` even after session refresh; recapture the current frontend text-to-image submit before claiming paid-live CLI support for that path
- use precise proof labels from here on: `paid-live generation`, `read-only live`, `upload live`, `mutate live`, or `dry-run`

Fresh subscription-account generation was rechecked on 2026-06-10 with explicit approval:

- proof bundle: `data/jimeng-lab/proof-20260610-subscription-live-generation-refresh/`
- `jimeng-browser-proxy tts` returned `ret=0`, saved `直爽女大-7597003459665072686.mp3`, and validated as `8.616000s` MP3 audio
- `jimeng-browser-proxy text2video` live-submitted `submitId=0781e145-8ead-45e0-8ba7-5a4feb7ee95d`, reached terminal `status=50`, saved a `704x1248` H.264 MP4, and validated as `3.016667s`
- `jimeng-browser-proxy image2video` live-submitted `submitId=87b264f4-4997-4390-a0fe-e5d06948a759`, reached terminal `status=50`, saved a `704x1248` H.264 MP4, and validated as `3.016667s`
- current text-to-image replay against `data/jimeng-captures/20260609095503-text2image-submit/capture-template.raw.json` still returns `ret=3018`, `errmsg=permission denied`; the next action is still a fresh background CDP frontend submit capture

Current subscription API generation was rechecked again on 2026-06-10 with explicit approval:

- proof bundle: `data/jimeng-lab/proof-20260610-subscription-api-live-check/`
- `jimeng-browser-proxy tts` returned `ret=0`, saved `直爽女大-7597003459665072686.mp3`, and validated as `8.568000s` MP3 audio
- `jimeng-browser-proxy text2video` live-submitted `submitId=0a829552-fe6a-4f2f-b8d2-8bd6d4ec6fb2`, `historyId=35934031025164`, reached terminal `status=50`, saved a `704x1248` H.264 MP4, and validated as `3.016667s`
- `jimeng-browser-proxy image2video` live-submitted `submitId=6c83d6bd-d8f6-4b69-a6b9-1d05088312a3`, `historyId=35931512058892`, reached terminal `status=50`, saved a `704x1248` H.264 MP4, and validated as `3.016667s`
- `text2image` was retried against `data/jimeng-captures/20260609095503-text2image-submit/capture-template.raw.json` and still returns `ret=3018`, `errmsg=permission denied`; do not claim current paid-live text-to-image support until a fresh background CDP submit is captured and compared
- strict proof leak check found no unredacted credential markers in normalized results or validation metadata

Actual subscription API generation was rechecked again on 2026-06-10 after the user asked whether the API had really been tested with the subscription account:

- proof bundle: `data/jimeng-lab/proof-20260610-actual-api-generation-check/`
- exact commands: `data/jimeng-lab/proof-20260610-actual-api-generation-check/manifest.md`
- `jimeng-browser-proxy tts` returned `ret=0`, saved `直爽女大-7597003459665072686.mp3`, and validated as `10.680000s`, `24 kHz`, mono MP3 audio
- `jimeng-browser-proxy text2video` live-submitted `submitId=31ab1cf8-1548-46de-8419-b167bb813eb0`, `historyId=35936274855692`, reached terminal `status=50`, saved a `704x1248` H.264 MP4, and validated as `3.016667s`
- `jimeng-browser-proxy image2video` live-submitted `submitId=f9774f3b-84ce-4025-82c4-7a529d6e4409`, `historyId=35933448749068`, reached terminal `status=50`, saved a `704x1248` H.264 MP4, and validated as `3.016667s`
- validation thumbnails were saved under `data/jimeng-lab/proof-20260610-actual-api-generation-check/_validation/`
- normalized proof leak check found no unredacted credential markers

Jimeng keyword research is now live-proved without generation spend:

- `jimeng-browser-proxy research-keywords`
- frontend-derived channels: `inspiration`, `short-film` (`short_film` on the wire), and `asset`
- `/mweb/search/v1/sug` returns suggestions for inspiration and short-film; asset suggestions are skipped because a direct proof returned `ret=1000 invalid parameter`
- `/mweb/search/v1/guess` supports all three channels; the current inspiration proof returned 10 guessed terms while short-film and asset returned valid empty lists
- Effect Schema validates the relied-on `data.suggest_list` / `data.guess_list` paths while allowing additive provider fields
- live proof: `data/jimeng-lab/proof-20260610-research-keywords-cli-live/`
- latest result: 5 successful sequential reads, 30 normalized keywords, 1 documented skip, and no credential markers in normalized output
- static inventory recognizes `/mweb/search/v1/*`; `/mweb/search/v1/fetch_debug/search` remains classified as a non-production debug wrapper

Full Jimeng research search is now live-proved without generation spend:

- `jimeng-browser-proxy research-search`
- supports `inspiration`, `short-film` (`short_film` on the wire), and workspace `asset` search
- the request surface exposes keyword, pagination/search id, workspace, intention-mark, asset type, favorites, show-type, insert-frame, story-agent, and timestamp controls
- Effect Schema enforces the relied-on result envelope and item/asset paths while tolerating additive provider fields
- the frontend AES-256-CBC cache-token/media-URL transform was recovered and reproduced in a deterministic unit test; current live responses returned already-signed URLs without a cache token
- dry-run proof: `data/jimeng-lab/proof-20260611-research-search-cli-dry-run/`
- live inspiration proof: `data/jimeng-lab/proof-20260611-research-search-cli-inspiration/` returned 6 image/template results
- live short-film proof: `data/jimeng-lab/proof-20260611-research-search-cli-short-film/` returned 6 playable video results with dimensions, durations, and engagement metrics
- live asset proof: `data/jimeng-lab/proof-20260611-research-search-cli-asset-v3/` returned 1 image asset containing 4 generated items
- refreshed inventory proof: `data/jimeng-lab/proof-20260611-static-inventory-research-search/` reports `implemented=45`, `partial=4`, and `skipped_implemented=45`
- normalized proofs contain no credential markers or signed media URL values

Jimeng reference-profile research is now live-proved without generation spend:

- `jimeng-browser-proxy profile-research`
- public target reads: profile metadata, homepage works, favorites, stories, single published item detail, and batch published item detail
- current-account reads: following and followers; the frontend request does not include a target `sec_uid`, so normalized output labels these results `current-account`
- useful flags: `--endpoints`, `--secUid`, `--publishedItemId`, `--publishedItemIds`, `--limit`, `--offset`, `--imageTypeList`, and `--feed-refer`
- Effect Schema enforces the relied-on profile/list/item paths while accepting additive provider fields
- normalized works include generation prompt, model key/name, generate type, aspect ratio, seed, first-frame provider URI/dimensions, image/video dimensions and duration, hashtags, and engagement counters
- dry-run proof: `data/jimeng-lab/proof-20260611-profile-research-cli-dry-run/`
- story dry-run proof: `data/jimeng-lab/proof-20260611-profile-research-stories-dryrun/`
- story live proof: `data/jimeng-lab/proof-20260611-profile-research-stories-live/` returned one successful story-list result with `story_count=0`, `has_more=false`, and `next_offset=0`
- live proof: `data/jimeng-lab/proof-20260611-profile-research-cli-live/` returned 6 successful endpoint results, 3 work/detail rows, and 7 profile rows before the story endpoint was added
- batch dry-run proof: `data/jimeng-lab/proof-20260611-profile-research-batch-items-dryrun/`
- batch live proof: `data/jimeng-lab/proof-20260611-profile-research-batch-items-live/` returned one successful batch result with 2 normalized work rows
- current-account local item dry-run proof: `data/jimeng-lab/proof-20260611-local-items-dryrun/`
- current-account local item live proof: `data/jimeng-lab/proof-20260611-local-items-live/` returned 2 generated image rows from `/mweb/v1/get_local_item_list` using `item_id_list`
- account-config dry-run proof: `data/jimeng-lab/proof-20260611-account-config-dryrun/`
- account-config live proof: `data/jimeng-lab/proof-20260611-account-config-live/` returned current-account settings, `is_web_registered=true`, and `invite_status=1` from empty-body reads
- runtime-config dry-run proof: `data/jimeng-lab/proof-20260611-runtime-config-dryrun/`
- runtime-config live proof: `data/jimeng-lab/proof-20260611-runtime-config-live/` returned 5 successful empty-body reads for experiment params, home header banner config, helpdesk entrance, ASR token config, and ASR hotwords; normalized output fingerprints token/appkey/ws_url/helpdesk URL values
- story/archive dry-run proof: `data/jimeng-lab/proof-20260611-story-archive-dryrun/` records guarded wire bodies for `story-records` (`/mweb/v1/mget_story` with `story_id_list`), `async-tasks` (`/mweb/v1/mget_async_task` with `task_id_list`), and dry-run-only `story-export-plan` (`/mweb/v1/submit_async_task` with `type=pack_story_mode`, `submit_id`, and a stringified payload)
- media helper static-locate proof: `data/jimeng-lab/proof-20260611-static-locate-media-helper-blockers/` found `mix_audio_video`, `mix_audio_videos`, `mpack_image`, `execute_generate_audit`, and `submit_survey` call sites; they are blocked until exact UI payload capture or explicit mutation/generation approval
- commerce-pricing dry-run proof: `data/jimeng-lab/proof-20260611-commerce-pricing-cli-dryrun/` records signed no-spend request bodies for `/commerce/v1/subscription/price_list` (`aid=513695`, `region=cn`, `platform=7`, `scene=vip`) and `/commerce/v1/purchase/price_list` (`goodsTypes=["credit"]`)
- commerce-pricing live proof: `data/jimeng-lab/proof-20260611-commerce-pricing-cli-live/` returned `ret=0` for both signed no-spend reads, with `11` VIP price rows, `3` tabs, and `0` credit purchase rows
- commerce-pricing transport proof: supports `--transport live|record|replay|fixture` and `--cassette`; backend proof is a two-read record/replay cassette test
- commerce-pricing static-locate proof: `data/jimeng-lab/proof-20260611-static-locate-commerce-pricing/` found price-list, overseas price-list, change-plan, trade, and refund endpoint call sites; overseas `cc_price_list`, plan-change, trade, and refund endpoints remain blocked on gateway/selected-plan/order context
- panel/notice static-locate proof: `data/jimeng-lab/proof-20260611-static-locate-safe-read-gaps/` found `get_notice_list` and `get_panel_info` call sites; no-spend probes under `data/jimeng-lab/proof-20260611-probe-get-notice-list/` and `data/jimeng-lab/proof-20260611-probe-get-panel-info/` returned `ret=1000` and `ret=2012` respectively for safe guessed bodies, so both remain blocked on exact UI request capture
- refreshed inventory proof: `data/jimeng-lab/proof-20260611-static-inventory-panel-notice-blockers/` reports `implemented=63`, `unknown=89`, `partial=6`, `dry_run_only=5`, and `blocked=85`
- successful batch probe: `data/jimeng-lab/proof-20260611-probe-mget-item-info-item-id-list/` shows `/mweb/v1/mget_item_info` accepts `item_id_list`; earlier guessed-field probes under `data/jimeng-lab/proof-20260611-probe-mget-item-info/` are superseded
- successful local item probe: `data/jimeng-lab/proof-20260611-probe-local-item-list-generated-items/` shows `/mweb/v1/get_local_item_list` accepts generated asset item ids in `item_id_list`; the earlier asset-wrapper-id probe under `data/jimeng-lab/proof-20260611-probe-local-item-list/` returned `ret=3005`
- successful account-config probes: `data/jimeng-lab/proof-20260611-probe-account-config-get-{settings,ug-info,invite-status}/` show empty POST bodies return `ret=0`; `data/jimeng-lab/proof-20260611-probe-account-config-get-panel-info/` returned `ret=2012` for guessed bodies and remains an exact-body recovery target
- successful runtime-config probes: `data/jimeng-lab/proof-20260611-probe-{home-header-banner,help-desk-entrance,experiment-params,asr-token,asr-hotwords}/` show empty POST bodies return `ret=0`; `/lv/v1/user/get_enable_list` remains blocked on exact LV auth/context after empty and null probes returned `ret=1014`
- normalized proofs contain no credential markers or signed media URL values

Older endpoint-level next steps are now inputs to the **Work Chunk Queue** above. Do not resume one-endpoint-at-a-time work by default. Batch related capabilities into the queued chunks, especially W5/W6 for lip-sync, fresh text-to-image, end-frame/multi-frame, reference controls, voice/persona generation, CapCut search/batch/preset, and real story/task ids.

Do not start the async daemon while the API client, transport, registry, and generation compare gates are still moving.

## Optimization Target

Maximize useful API coverage and proof quality while keeping live submissions controlled:

- generation submission concurrency is `1` for now
- polling, downloads, passive capture, and local processing can run in the background when safe
- default to background automation; do not foreground Arthur's browser, steal focus, or use visible UI automation while Arthur is using the machine unless he explicitly asks
- prefer direct Jimeng APIs, saved sessions, CDP network/DOM calls, CuaDriver/background browser-use, and other non-interruptive automation paths over `bringToFront`, visible tab clicks, or Computer Use interactions that move the active cursor/window
- if a frontend-only Jimeng flow truly requires visible UI interaction, first try to reproduce it through background CDP or CuaDriver; if that still cannot work, record the blocked path and ask before interrupting Arthur's flow
- choose the next endpoint family by UGC workflow value first, then implementation speed; no-spend/ease is only a tie-breaker or approval gate. If the top-value slice needs paid/mutating/capture approval, ask for that approval or do prep inside that same family instead of moving to lower-value supporting reads.
- when bounded spend/capture is approved, prefer a small matrix of real useful examples first, then infer contracts and generate scaffolds from the saved JSON/artifacts. Do not manually write another dry-run planner if the matrix can produce better contracts faster.
- build and use `jimeng-browser-proxy contract-infer` before growing more hand-written request planners. The tool should generate schema drafts, wrapper/test/registry drafts, fixture snapshots, and flag suggestions from raw/normalized proof bundles.
- for unknown frontend flows, prefer a faster hybrid reversal loop over long manual bundle reading or purely dynamic clicking: run background CDP/passive network capture first, use `ast-grep`/targeted structural search to locate the frontend request builder, then replay/compare the direct API request with saved session headers
- choose static or dynamic evidence by expected leverage, not ideology: use CDP/network truth for actual request bodies and response shapes, use stronger static tools for enum names, option semantics, request-builder branches, and dead-end avoidance
- promote the hybrid loop into tooling: CDP recorder for dynamic truth, `capture-analyze` for endpoint ranking, `discovery-worklist` and `static-inventory` for next-slice prioritization and coverage audits, `static-locate --symbol`/`--staticQuery` plus mise-managed `ast-grep` for request-builder semantics, `endpoint-probe` for explicit body replay, then dedicated schema-backed commands for stable contracts
- run `capture-analyze` after every meaningful `jimeng-network-recorder` capture, then run `discovery-worklist` before opening frontend bundles by hand
- use mise-managed developer CLIs such as `ast-grep` when available; install missing local CLIs with `mise` first unless the tool must be a repo/CI dependency
- validate external Jimeng/CapCut/provider JSON at the boundary with permissive runtime schemas; allow additive extra fields but fail clearly when relied-on response paths drift
- live generation prompts should be Chinese and in-distribution for the UGC use case
- test/proof prompts should generate actually useful Korean-beauty, UGC ad, persona, TikTok-profile, reference-upload, or campaign assets, not toy demos
- map the product's actual account/UI limits and encode them in docs/code
- document observed rate limits, VIP gates, risk gates, payload constraints, model options, option menus, and UI affordances
- expose meaningful API properties as flags so later pipelines can parameterize them; for large enum sets like voices or styles, prove one or two representative values rather than exhausting every individual item
- do not spam servers or brute-force controls
- do not commit cookies, raw captures, signed URLs, upload credentials, session bundles, or generated media

## Complete Enough Definition

For this project, "complete enough" means each useful API has enough surface area exposed that future pipelines can parameterize it without another frontend reverse-engineering pass.

That means:

- every independent property class gets represented as a CLI flag, typed option, or documented blocked field
- important mode switches are covered, such as text/image/video input source, duration, ratio, resolution, model version, seed, reference role, voice mode, character/persona id, template id, and upload source type
- enum-heavy fields do not need exhaustive live proof; list the catalog when available and prove one or two representative values
- option sets should be explored by property type and API behavior, not by burning quota on every cosmetic choice; for example, testing that voice selection is parameterized matters more than generating every voice
- gated, VIP, risk-blocked, or unclear options are still recorded with the exact UI path, trace evidence, and next probe
- request/response shapes that affect later automation get fixture, cassette, or snapshot coverage
- request/response shapes should come from saved live/capture matrices when practical; contract inference plus hand-tightening is preferred over manual schema construction from scratch
- live provider calls are used to discover/refresh contracts or create approved media artifacts, not as a mandatory ritual for every backend change
- live media proof creates useful UGC/Korean-beauty/persona/campaign artifacts, not synthetic placeholder demos
- examples are part of the acceptance criteria for high-value APIs: test representative workflows we would actually use, such as persona clips, voice/script application, lip-sync hosts, pose/reference transfer, and hook/template mining.

## CLI Shape

Near-term CLI work should prioritize API coverage, clean transport boundaries, and fast replayable tests over orchestration. Do **not** implement the daemon, background worker, full async job queue, or session-refresh scheduler until the high-value API surface and transport model are settled.

Current ownership:

- `jimeng-browser-proxy` is the user-facing front door for logged-in Jimeng/Dreamina work and should receive new commands by default.
- `jimeng-dreamina` is lower-level Dreamina-compatible plumbing from the earlier direct-client path. Keep it for compatibility tests, payload experiments, and shared helpers, but do not grow it into a second competing product CLI.
- Avoid creating more parallel CLIs. Prefer one obvious user-facing command surface, backed by shared typed services.
- For new/refactored surfaces, prefer Effect CLI over hand-written command parsing.
- Later cleanup can combine the two surfaces or make their relationship explicit enough that users never wonder which one to run.
- New user-facing docs and proof commands should prefer `jimeng-browser-proxy` unless the slice is explicitly testing compatibility with the older direct-client path.

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
- do not add daemon-only flags or lifecycle commands during the API catalog phase unless the command also works in the current blocking CLI model

Common flags:

- `--session <file>`
- `--capture <file>`
- `--outDir <dir>`
- `--json`
- `--transport live|record|replay|fixture` once the shared transport lands
- `--cassette <file-or-dir>` once the shared transport lands
- `--dryRun` only for mutation/generation planning where no live request should be made
- `--wait` / `--sync`
- `--noDownload`

Current and near-term commands:

```bash
jimeng-browser-proxy session
jimeng-browser-proxy catalog
jimeng-browser-proxy agent-catalog
jimeng-browser-proxy image-models
jimeng-browser-proxy voices
jimeng-browser-proxy tts
jimeng-browser-proxy sample-voices
jimeng-browser-proxy upload-token
jimeng-browser-proxy upload-image
jimeng-browser-proxy subjects
jimeng-browser-proxy describe-image
jimeng-browser-proxy controlnet-preview
jimeng-browser-proxy object-mask
jimeng-browser-proxy text2image
jimeng-browser-proxy text2video
jimeng-browser-proxy image2video
jimeng-browser-proxy frames2video
jimeng-browser-proxy lip-sync
jimeng-browser-proxy lip-sync-compare
jimeng-browser-proxy voice-clone
jimeng-browser-proxy persona
jimeng-browser-proxy subject
jimeng-browser-proxy templates
jimeng-browser-proxy short-videos
jimeng-browser-proxy overseas-short-videos
jimeng-browser-proxy assets
jimeng-browser-proxy history-queue
jimeng-browser-proxy history-records
jimeng-browser-proxy capture-analyze
jimeng-browser-proxy discovery-worklist
jimeng-browser-proxy static-locate
jimeng-browser-proxy static-inventory
jimeng-browser-proxy endpoint-probe
jimeng-browser-proxy video-info
jimeng-browser-proxy canvas
```

It is fine for commands to land progressively. Missing commands should be represented in the endpoint catalog as `unknown`, `captured`, `needs-live-proof`, or `blocked-*`.

## Proof Standard

Backend/API refactors:

- passing focused tests and package typecheck are enough
- request/response contracts use Effect Schema or equivalent runtime decoding at the provider boundary
- fixtures, cassettes, or snapshots cover the shapes relied on by later automation
- live calls are not required unless the contract is new, stale, suspicious, or provider drift is being checked

New or changed provider contracts:

- exact runnable command
- normalized JSON output
- typed helper and CLI command
- runtime schema/decoder for external JSON contracts, permissive to extra fields and strict for paths the CLI relies on
- automated tests close to `packages/jimeng-client/test/`
- snapshot or fixture-style tests where request/response shape matters
- record/replay cassette or fixture under ignored `data/**` when live provider verification is needed
- concise doc/TASKS update only when state or operating instructions change

Media generation:

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

Work in coherent chunks. Prefer larger cleanup/refactor chunks when they reduce repeated manual work, and smaller slices only when risk, paid quota, mutation, or visible UI interruption makes that safer.

A chunk is checkpoint-ready when:

- API contract or architecture decision is documented when new
- CLI command exists or the feature is explicitly documented as blocked/unknown
- tests/typecheck pass for the changed contract
- live cassette/proof exists only when external contract verification was required
- `TASKS.md` and relevant state/plan docs are updated when the work changes the active state
- important rerun commands are recorded in a fixture/cassette manifest or concise QA note
- the coherent chunk has its own git commit

Dirty worktree rule:

- inspect `git status --short` before staging
- stage only files that belong to the current feature slice
- never revert unrelated user or generated changes while checkpointing this goal
- keep raw captures, cookies, credentials, signed URLs, and generated media under ignored `data/**`

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
10. voice clone live submit/mutation and subject/persona voice generation
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
