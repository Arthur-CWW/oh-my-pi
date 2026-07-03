# Jimeng Frontend API Catalog

Captured from the logged-in Helium/CDP Jimeng profile on 2026-06-09. Raw captures and session bundles stay under ignored `data/**`; this file records only reusable contract facts.

## Architecture

Preferred operating shape:

```txt
background Jimeng browser profile
→ CDP session/cookie refresh
→ browser-proxy CLI prepares direct request
→ direct Jimeng client submits/polls/downloads
→ raw captures remain local-only
```

Use the browser as an authenticated session holder and API discovery surface. Move operations to direct `fetch` only after capture + dry-run prove the request contract.

## Confirmed Useful Endpoints

| Endpoint | Method | Use | Current status |
|---|---:|---|---|
| `/mweb/v1/workspace/list` | POST | Read current Jimeng workspace/project list for logged-in context. | Implemented as Effect Schema-backed no-spend `workspace-context`; live-proved with 2 workspaces |
| `/mweb/v1/workspace/get_by_ids` | POST | Look up workspace metadata by ids inferred from the list or supplied explicitly. | Implemented as Effect Schema-backed no-spend `workspace-context`; request body uses snake_case `workspace_ids`; live-proved with 1 returned workspace |
| `/mweb/search/v1/sug` | POST | Keyword suggestions for inspiration and short-film research channels. | Implemented as Effect Schema-backed no-spend `research-keywords`; asset suggestions are explicitly skipped after `ret=1000` proof |
| `/mweb/search/v1/guess` | POST | Guessed/trending keyword seeds for inspiration, short-film, and asset channels. | Implemented as Effect Schema-backed no-spend `research-keywords` |
| `/mweb/search/v1/search` | POST | Full keyword search across inspiration, short-film, and asset channels. | Implemented as Effect Schema-backed no-spend `research-search`, including the recovered frontend AES cache-token/media transform |
| `/mweb/search/v1/fetch_debug/search` | POST | Frontend debug wrapper adjacent to search implementation. | Blocked as non-production; do not substitute it for `/mweb/search/v1/search` |
| `/mweb/v1/get_user_info` | POST | Public reference-profile metadata by `sec_uid`. | Implemented as Effect Schema-backed no-spend `profile-research` |
| `/mweb/v1/get_homepage` | POST | Public profile work/homepage listing with pagination and media-type filters. | Implemented as `profile-research`; live proof returned a generated video with prompt, model, first-frame, media, and engagement metadata |
| `/mweb/v1/get_favorite_list` | POST | Public profile favorite/reference work listing. | Implemented as `profile-research`; live proof returned an image reference with prompt/model and engagement metadata |
| `/mweb/v1/get_follow_list` | POST | Logged-in account following or follower list via `list_type=1|2`. | Implemented as `profile-research`; this endpoint is current-account scoped and does not accept a target `sec_uid` |
| `/mweb/v1/get_item_info` | POST | Published work detail by `published_item_id`. | Implemented as `profile-research`; normalizes generation prompt/model/reference frame and video/image metadata |
| `/mweb/v1/get_user_story_list` | POST | Public profile story/archive list by `sec_uid`. | Implemented as `profile-research` endpoint `stories`; latest no-spend proof returned `ret=0` with an empty but valid `story_list` |
| `/mweb/v1/mget_item_info` | POST | Batch published work detail adjacent to frontend asset download/detail flows. | Implemented as `profile-research` endpoint `items`; read body uses `item_id_list`; download-oriented `pack_item_opt` variants probe successfully but are not exposed as CLI controls yet |
| `/mweb/v1/workspace/create` | POST | Creates a generation workspace/conversation. | Captured |
| `/mweb/v1/workspace/update` | POST | Renames/updates current workspace metadata. | Captured |
| `/mweb/v1/aigc_draft/generate` | POST | Unified workbench submit for current text-to-image, text-to-video, first-frame image-to-video, and lip-sync draft generation paths. | Paid-live proven for text-to-video and local-upload-backed image-to-video; no-spend direct `text2image-plan` submit body builder is Effect Schema-backed; stale text-to-image replay still returns `ret=3018 permission denied` and needs fresh background CDP capture before live claim; dry-run-proved for VOD and image/avatar lip-sync provider inputs |
| `/mweb/v1/get_asset_list` | POST | Poll/list workspace assets and completed image results. | Implemented for workbench text-to-image polling and no-spend `assets` listing |
| `/mweb/v1/get_local_item_list` | POST | Current-account unpublished/generated local item detail by generated item ids. | Implemented as Effect Schema-backed no-spend `local-items`; read body uses `item_id_list`; latest proof returned 2 generated image rows with prompt/model/provider URI metadata |
| `/mweb/v1/get_history` | POST | Paginated history list with `records_list`, `has_more`, and `next_offset`. | Implemented as Effect Schema-backed no-spend `history-list`; known live probes returned a valid empty `records_list`, so use `assets`/`history-records` for known-populated lookups |
| `/mweb/v1/get_history_by_ids` | POST | Older/general task polling and completed record lookup by `submit_id` or `history_id`. | Implemented for captured history-based templates and no-spend `history-records`; live-proved against the completed K-beauty image generation |
| `/mweb/v1/get_history_queue_info` | POST | Read-only queue/progress detail lookup for active or historical generation records. | Implemented as no-spend `history-queue`; live-proved against a completed image history id |
| `/mweb/v1/get_video_by_vid` | POST | Read-only VOD metadata lookup by uploaded/generated video `vid`. Useful for lip-sync/reference-video validation. | Implemented as schema-backed no-spend `video-info`; live-proved with body `{"vids":["..."]}` |
| `/mweb/v1/creation_agent/v2/conversation` | POST/SSE | Older agent text-to-image conversation submit. | Preserved |
| `/mweb/v1/creation_agent/v2/get_agent_config` | POST | Agent/tool configuration payload. | Implemented as schema-backed no-spend `agent-catalog` |
| `/mweb/v1/creation_agent/v2/skill/list` | POST | Available agent skills/tools. | Implemented as schema-backed no-spend `agent-catalog` |
| `/commerce/v1/benefits/user_credit` | POST | Signed read-only account credit balance. Useful for checking available quota before paid generation tests. | Implemented as schema-backed no-spend `account-credit`; latest proof returned total 3990 credits |
| `/commerce/v3/resource/benefit_metadata` | POST | Signed read-only benefit metadata for AIGC/function resource cost and pay-mode strategy mapping. | Implemented as schema-backed no-spend `commerce-benefits`; proved with snake_case `query_list` body |
| `/commerce/v3/benefits/batch_get_user_benefit` | POST | Signed read-only current user benefit/quota asset rows. Useful for spend gating and deciding whether features consume credits, subscription quota, or free limits. | Implemented as schema-backed no-spend `commerce-benefits`; latest proof returned 140 user benefit asset rows |
| `/mweb/v1/get_settings` | POST | Current-account custom settings for compliance, remix, sharing, watermark, and profile visibility flags. | Implemented as Effect Schema-backed no-spend `account-config`; empty body returns `user_custom_settings` |
| `/mweb/v1/get_ug_info` | POST | Current-account web registration state. | Implemented as `account-config`; empty body returns `is_web_registered` |
| `/mweb/v1/get_invite_status` | POST | Current-account invite status. | Implemented as `account-config`; empty body returns `invite_status` |
| `/mweb/v1/get_experiment_params` | POST | Frontend experiment parameter map. | Implemented as Effect Schema-backed no-spend `runtime-config`; empty body returns `data.params` |
| `/mweb/v1/get_home_header_banner_config` | POST | Home/workbench header banner runtime config. | Implemented as `runtime-config`; empty body returns banner items/panel/source fields |
| `/mweb/v1/get_help_desk_entrance` | POST | Help desk entrance URL. | Implemented as `runtime-config`; normalized output fingerprints the URL instead of storing the raw value |
| `/mweb/v1/speech/asr_token` | POST | Speech recognition websocket token/config. | Implemented as `runtime-config`; normalized output fingerprints `token`, `appkey`, and `ws_url` |
| `/mweb/v1/speech/asr_hotwords` | POST | Speech recognition hotword list. | Implemented as `runtime-config`; latest proof returned 142 hotwords |
| `/mweb/v1/video_generate/get_common_config` | POST | Video model/common configuration by scene, including lip-sync image/video scenes. | Implemented for config catalog |
| `/mweb/v1/get_user_local_item_list` | POST | User local/generated item lists; `effect_type=218` returns current user's cloned voices. | Implemented for config catalog and `voice-clones`; live-proved no-spend |
| `/mweb/v1/voice/submit_task` | POST | Custom voice clone / voice conversion task submit. | Voice-clone request shape dry-run-proved; live submit disabled pending approval/capture |
| `/mweb/v1/voice/query_task` | POST | Query voice clone/conversion task ids. | Implemented for `voice-clone-query`; live proof waits for a real task id |
| `/mweb/v1/voice/update` | POST | Rename/update a cloned voice asset. | Dry-run request shape only; live mutation disabled pending disposable fixture |
| `/mweb/v1/voice/delete` | POST | Delete a cloned voice asset. | Dry-run request shape only; live mutation disabled pending disposable fixture |
| `/mweb/v1/dreamina_subject/get` | POST | Saved subject/persona list. | Implemented as no-spend `subjects`; live-proved empty and non-empty filtered/list shapes |
| `/mweb/v1/dreamina_subject/create` | POST | Create saved subject/persona from a main reference image. | Implemented as no-spend `subject-create`; live-proved with local ImageX upload, audit, image lookup, and create |
| `/mweb/v1/dreamina_subject/update` | POST | Update saved subject/persona content. | Implemented as no-spend `subject-update`; live-proved on a temporary subject |
| `/mweb/v1/dreamina_subject/delete` | POST | Delete one or more saved subject/persona records. | Implemented as no-spend `subject-delete`; live-proved on a temporary subject |
| `/mweb/v1/dreamina_subject/generate_voice` | POST | Generate a subject voice from an image URI. | Dry-run request support only; live submit remains blocked pending explicit spend approval or captured UI submit |
| `/mweb/v1/feed` | POST | Explore/feed content; a signed `dreamina_tone` feed request returns the built-in voice library. Useful for research/template mining if handled carefully. | Implemented for voice library replay |
| `/mweb/v1/tts_generate` | POST | Built-in voice text-to-speech. Returns base64 MP3 in `data.data`. | Implemented and paid-live proven; latest subscription proof saved a playable `8.568s` MP3 |
| `/mweb/v1/get_upload_token` | POST | Temporary upload credentials for video/image/file scenes. Required before direct local reference-image/video upload. | Implemented and live-proved; local ImageX image upload is implemented via `upload-image`, local VOD video upload via `upload-video` |
| `/mweb/v1/get_explore` | POST | Explore examples, public creative templates, and short-video examples for prompt/template/reference mining. | Implemented as no-spend `templates` and `short-videos` |
| `/mweb/v1/feed_short_video` | POST | Overseas/alternate short-video feed for reference/profile mining. | Implemented as no-spend `overseas-short-videos` |
| `/mweb/v1/get_image_description` | POST | Image prompt/description extraction for uploaded provider image URIs. Useful for persona/reference inspection. | Implemented as no-spend `describe-image` |
| `/mweb/v1/face_recognize` | POST | Face/keypoint probe for uploaded provider image URIs. Useful for reference/persona validation before generation payloads. | Implemented as no-spend `describe-image` |
| `/mweb/v1/blend_preview` | POST | No-spend preview extraction for pose/depth/canny ControlNet reference images. | Implemented as `controlnet-preview`; pose/depth/canny live-proved |
| `/mweb/v1/pose_detect` | POST | Pose validation for ControlNet pose references. | Implemented as part of `controlnet-preview --control pose`; live-proved |
| `/mweb/v1/saliency_seg` | POST | Object/mask segmentation for reference-image object-detection and background-paint flows. | Implemented as no-spend `object-mask`; canvas/default modes live-proved |
| `/mweb/v1/get_unread_count` | POST | Notification count. | Low priority |

## Confirmed Voice / Audio Contracts

The built-in voice picker is not exposed through the same local-item endpoint as cloned voices. The useful current split is:

| Contract | Endpoint | Request source | Result |
|---|---|---|---|
| cloned voice assets | `/mweb/v1/get_user_local_item_list` with `effect_type=218` and `clone_voice_status` filter | direct JSON body | Empty list is valid when the account has no cloned voices. |
| built-in voice library | signed `/mweb/v1/feed` request whose body includes `dreamina_tone` | replay from captured frontend request | 142 built-in voice items in current replay; normalized id, title, tags, speaker id, emotions. |
| text-to-speech | `/mweb/v1/tts_generate` | direct JSON body | Base64 MP3 payload, validated as 24 kHz mono MP3 in smoke run. |
| custom voice clone submit | `/mweb/v1/voice/submit_task` | frontend request builder module `914178` | Dry-run-only request shape: `scene=1`, `voice_clone.audio`, `voice_clone.name`. |
| custom voice task query | `/mweb/v1/voice/query_task` | frontend request builder module `914178` | Implemented; live proof needs a real task id. |
| custom voice update/delete | `/mweb/v1/voice/update`, `/mweb/v1/voice/delete` | frontend request builder module `914178` | Dry-run-only mutation shapes: `local_item_id`, plus `name` for update. |

TTS body shape:

```json
{
  "text": "这条视频值得试一下。",
  "id_info": {
    "id": "7597003459665072686",
    "item_platform": 1
  },
  "audio_config": {
    "format": "mp3",
    "pitch_rate": 0,
    "sample_rate": 24000,
    "speech_rate": 0
  }
}
```

Current proof artifacts are intentionally ignored under:

```txt
data/jimeng-lab/voice-tts-smoke/
data/jimeng-lab/voice-library-samples/
```

The latest full voice sample run generated `142/142` MP3 files with concurrency `1` and no `1019` / `shark not pass` risk-control errors.

Latest direct subscription-account generation proof:

```txt
proof=data/jimeng-lab/proof-20260610-actual-api-generation-check/
tts=ret 0, 10.680000s MP3, 24 kHz mono
text2video=submitId 31ab1cf8-1548-46de-8419-b167bb813eb0, historyId 35936274855692, status 50, 704x1248 H.264 MP4, 3.016667s
image2video=submitId f9774f3b-84ce-4025-82c4-7a529d6e4409, historyId 35933448749068, status 50, 704x1248 H.264 MP4, 3.016667s
text2image=ret 3018, errmsg permission denied with stale capture data/jimeng-captures/20260609095503-text2image-submit/capture-template.raw.json
```

## Runtime Schema Validation

Provider JSON is not treated as trusted just because TypeScript interfaces compile. New direct-client endpoints should decode raw JSON at the boundary with permissive runtime schemas: keep `.passthrough()` or equivalent behavior for additive provider fields, but enforce the envelope and nested paths used by normalization, request construction, or downstream pipelines.

Preferred new validation stack: Effect v4 / Effect Schema. Existing Zod-backed endpoints can stay in place until touched, but new slices should use Effect Schema for boundary contracts unless there is a local reason not to.

Current shared helper:

```txt
packages/jimeng-client/src/schema.ts
```

Current schema-backed endpoints include `history-queue`, `history-records`, `video-info`, `agent-catalog`, `image-models`, `account-credit`, `commerce-benefits`, `workspace-context`, `research-keywords`, `text2image-plan`, and the envelope/timing layer used by `rate-probe`. If Jimeng changes `ret`/`errmsg`/`data` or the relied-on record/media/model/benefit/workspace/research/request paths, the CLI should fail with an explicit contract-changed error instead of silently normalizing stale shapes.

## Fast Hybrid Reversal Loop

Use dynamic and static tools together:

1. Record one UI action through background CDP with `network-recorder.ts`; do not foreground Arthur's browser.
2. Run `jimeng-browser-proxy capture-analyze` on `raw-network.jsonl` to rank endpoints, classify risk, summarize request/response shapes, and emit replay candidates.
3. Run `jimeng-browser-proxy discovery-worklist` on one or more analyzer outputs, optional raw probe candidates, and optional `--staticRoot` source/bundle roots to prioritize the next API slice without rereading large bundles.
4. Run `jimeng-browser-proxy static-locate` on the prioritized endpoints and source/bundle roots to recover files, redacted snippets, symbol hints, and mise-managed `ast-grep` follow-up commands.
5. Use `ast-grep`/targeted bundle search on the locator output when enum names, request-builder branches, or option semantics still need deeper structural evidence.
6. Replay only explicit candidate JSON bodies with `jimeng-browser-proxy endpoint-probe`; compare `ret`, `errmsg`, and summarized response shapes.
7. For read/config/list endpoints that need throughput data, use `jimeng-browser-proxy rate-probe` with bounded `--requests` and `--concurrency`. It stops on 429/auth/risk signals and records hashes/timing/status counts without full response bodies.
8. Promote stable read-only or approved contracts into dedicated typed CLI commands with runtime schemas and proof artifacts.

`capture-analyze`, `discovery-worklist`, `static-locate`, `endpoint-probe`, and `rate-probe` are intentionally not blind fuzzers. The analyzer turns CDP truth into ranked endpoint evidence, the worklist merges analyzer/static/probe evidence into a prioritized next-slice queue, the locator finds likely request-builder code, the probe replays candidate bodies found from CDP/static evidence, and the rate probe measures only bounded known-read endpoints unless explicitly overridden. Raw outputs stay under ignored `data/**`; normalized summaries are designed to be small enough to paste into agent context after redaction review.

Latest no-spend `/mweb/v1/get_common_config` rate sweep completed `2048/2048` read-only requests at concurrency `2048` with HTTP `200` and `ret=0`; no HTTP `429`, auth, or risk-control stop was observed on that endpoint, though tail latency stretched sharply at the top tier. The `2048` run used an IP/SNI override because the local macOS resolver temporarily had no DNS configuration. Treat this as a config-endpoint bound only; it is not a generation-submit limit. The external `iptag/jimeng-api` project does not publish a hard limit; it load-balances comma-separated bearer tokens randomly and uses polling/retry behavior.

The shared `JimengClient` request boundary now opens a local cooldown after `ret=1019` or raw `shark not pass` responses. Follow-up calls during cooldown fail locally as `RISK_CONTROL_COOLDOWN_ACTIVE`, which protects live reveng loops from repeatedly hitting provider risk control.

`iptag/jimeng-api` also confirmed a useful no-spend credit read endpoint, `/commerce/v1/benefits/user_credit`, with a required `sign` header derived from `md5("9e2c|<endpoint-last-7>|7|8.4.0|<device-time>||11ac")`. This is implemented as `jimeng-browser-proxy account-credit`. The mutating daily-claim endpoint `/commerce/v1/benefits/credit_receive` remains intentionally unimplemented.

Custom voice clone CLI coverage:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts voice-clones \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 50 \
  --outDir data/jimeng-lab/proof-20260610-voice-clone

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
```

Current proof facts:

```txt
proof=data/jimeng-lab/proof-20260610-voice-clone/
voice_clone_asset_ret=0
voice_clone_asset_errmsg=success
voice_clone_asset_count=0
voice_clone_asset_next_offset=50
voice_clone_asset_response_sha256=dd8e9025b1bf0d2f13556868f9a451984d6b1f9bd91647f8582d960c57788ee0
submit_request={"submit_id":"<uuid>","scene":1,"voice_clone":{"audio":{"vid":"v03870g10004d8k1u4nog65hb08dnhig","duration":3,"title":"kbeauty-reference.mp3"},"name":"Kbeauty reference voice"}}
query_request={"task_id_list":["task-voice-placeholder"]}
update_request={"local_item_id":"voice-placeholder","name":"Renamed Kbeauty voice"}
delete_request={"local_item_id":"voice-placeholder"}
```

Live voice-clone submit/update/delete remain disabled because they create or mutate account assets and may consume quota. Use background CDP capture plus explicit approval before enabling them.

## Confirmed Lip-Sync Planning Contracts

The frontend exposes two useful lip-sync branches under the same submit endpoint. Both are currently implemented as dry-run planning only; live generation remains disabled until a real UI submit is captured and compared.

| Branch | Model key | Provider-input path | Current proof |
|---|---|---|---|
| VOD/user-video lip-sync | `dreamina_lib_sync_base` | `videoGenInputs.v2vOpt.lipSyncUserVideo` | `data/jimeng-lab/proof-20260610-lip-sync-vod-plan/` |
| Image/avatar lip-sync | `dreamina_lib_sync_image_quick_1.5` | `videoGenInputs.i2vOpt.realmanAvatar` | `data/jimeng-lab/proof-20260610-lip-sync-image-plan/` |

Image/avatar dry-run command:

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

Observed safe image/avatar summary:

```txt
mode=image
image_uri=tos-cn-i-tb4s082cfz/487472ac3b204caa89fc1b2764c0aa1e.png
width=2048
height=2048
tts_source=text-to-speech
tone_id=7597003459665072686
summary_sha256=ed087e3df60ae9c30dc835d2d410867670229abfb115adb186846aa1aa631fc6
```

Local image/avatar mode uploads the image through the confirmed ImageX scene `2` path before writing the dry-run plan. Raw upload traces remain ignored under `data/**`.

## Confirmed Local Image Upload Contract

The next useful UGC slice was local media upload for image-to-video and reference/persona workflows. The ImageX image path is now confirmed end-to-end:

```txt
POST /mweb/v1/get_upload_token
GET  ImageX ApplyImageUpload
POST ImageX /upload/v1/{StoreUri}
POST ImageX CommitImageUpload
```

Request:

```json
{ "scene": 2 }
```

Observed scene mapping:

| Scene | Meaning from frontend bundle/use | Live status |
|---:|---|---|
| `1` | video/VOD upload token | Confirmed |
| `2` | image/ImageX upload token | Confirmed |
| `3` | file/audio-like upload token | Confirmed |

Scene `2` response summary from the CLI smoke:

```json
{
  "ret": "0",
  "errmsg": "success",
  "summary": {
    "scene": 2,
    "region": "cn",
    "spaceName": "tb4s082cfz",
    "uploadDomainPresent": true,
    "accessKeyPresent": true,
    "secretKeyPresent": true,
    "sessionTokenPresent": true,
    "expiredTimePresent": true,
    "currentTimePresent": true
  }
}
```

The raw token/apply responses include temporary credentials and upload authorization, so they must stay under ignored `data/**`.

Confirmed ImageX details from the frontend uploader SDK and live CLI proof:

- `scene=2` returns the ImageX token path for images.
- Jimeng's `region=cn` token value maps to ImageX signing region `cn-north-1`.
- The provider signer uses AWS4-style constants from the bundled uploader SDK:
  - `AWS4-HMAC-SHA256`
  - `X-Amz-Date`
  - `x-amz-security-token`
  - credential scope `YYYYMMDD/cn-north-1/imagex/aws4_request`
- `ApplyImageUpload` uses `ServiceId=tb4s082cfz`, `UploadNum=1`, optional `FileExtension`, and the frontend's random `s` query param.
- Small images direct-upload to `https://{UploadHosts[0]}/upload/v1/{StoreUri}` with `Authorization`, `Content-CRC32`, and `X-Storage-U`.
- `CommitImageUpload` posts `{"SessionKey":"..."}` and returns committed provider URIs such as `tos-cn-i-tb4s082cfz/...png`.

Current CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts upload-image \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --file data/jimeng-lab/image-upload-probe/aws4-live/proof-1x1.png \
  --outDir data/jimeng-lab/proof-20260609-image-upload
```

Result summary:

```txt
upload-image saved uri=tos-cn-i-tb4s082cfz/97c32453461a4041b4f6e20f1dc0a517.png
proof artifact: data/jimeng-lab/proof-20260609-image-upload/artifacts/proof-1x1.png
```

This URI can now be injected into first-frame image-to-video payloads:

```txt
draft_content.component_list[0].abilities.gen_video.text_to_video_params.video_gen_inputs[0].first_frame_image
```

## Confirmed Reference Image Inspection Contract

`jimeng-browser-proxy describe-image` is live-proved as a no-generation probe. It accepts either a local image file, uploaded through the confirmed ImageX scene `2` path, or an existing Jimeng/ImageX provider URI.

Description request:

```txt
POST /mweb/v1/get_image_description
```

```json
{ "file_uri": "tos-cn-i-tb4s082cfz/..." }
```

Face recognition request:

```txt
POST /mweb/v1/face_recognize
```

```json
{ "image_uri_list": ["tos-cn-i-tb4s082cfz/..."] }
```

Current CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts describe-image \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --outDir data/jimeng-lab/proof-20260610-reference-image-inspect
```

Safe summary:

```txt
image_uri=tos-cn-i-tb4s082cfz/b8f5124217774661b005916f6ca5bae8.png
description=黑发女人，白色背心。
description_sha256=77b52d1885139655c7279ebedd49c6000564c923af84db4ff812307de9628f5f
face_recognition_ret=0
face_recognition_sha256=aa358db205f856bbd3369effb85576c4a7b6f265f4bdd6a96a8f805ecaa35d03
face_count=0
summary=data/jimeng-lab/proof-20260610-reference-image-inspect/normalized/describe-image-20260609155534-q25boh-summary.json
```

Raw upload traces and response bodies may include signed upload/provider details. They remain ignored under `data/**`.

## Confirmed ControlNet Reference Preview Contract

`jimeng-browser-proxy controlnet-preview` is live-proved as a no-generation probe for Jimeng's reference-image ControlNet path. It accepts a local image, uploads it through the confirmed ImageX scene `2` path when needed, calls `/mweb/v1/blend_preview`, and downloads the returned preview image artifact when a preview URL is present. Pose, depth, and canny/outline controls are all live-proved with the same command.

Frontend bundle constants:

```txt
model=img2img_xl_sft
ability.name=control_net
control names=pose, depth, canny
default strength=60/100 = 0.6
fit modes=center_crop, adapt_to_canvas
```

Preview request:

```txt
POST /mweb/v1/blend_preview
```

```json
{
  "model": "img2img_xl_sft",
  "ability": {
    "name": "control_net",
    "image_uri_list": ["tos-cn-i-tb4s082cfz/..."],
    "control_net_list": [
      { "name": "pose", "strength": 0.6, "image_index": 0 }
    ]
  }
}
```

Pose validation request:

```txt
POST /mweb/v1/pose_detect
```

```json
{ "uri": "tos-cn-i-tb4s082cfz/..." }
```

Current CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts controlnet-preview \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --control pose \
  --outDir data/jimeng-lab/proof-20260610-controlnet-pose-preview
```

Safe summary:

```txt
pose:
image_uri=tos-cn-i-tb4s082cfz/2cb5efccab014a29b171719f4303cb21.png
control=pose
fit_mode=center_crop
strength=0.6
preview_image_uri=tos-cn-i-tb4s082cfz/222b232061324073accaf7992ec3ad87
pose_detected=true
preview_sha256=c9404ff104ba8c380eccada50e1526489b756a6c5380fe512da12ea76f1f0c65
pose_detect_sha256=4f9e4059d904fdb8f6fb8491eb79eab0e609e630dbbcfe29f4a76e53e5c91f5f
preview_artifact=data/jimeng-lab/proof-20260610-controlnet-pose-preview/artifacts/controlnet-preview-20260609162825-rvn7f6-pose-preview.png
summary=data/jimeng-lab/proof-20260610-controlnet-pose-preview/normalized/controlnet-preview-20260609162825-rvn7f6-summary.json

depth:
preview_image_uri=tos-cn-i-tb4s082cfz/df194e1d74a54982ae5ceb151e239c9c
preview_sha256=cfd5828742c4efcfe55608254088ddde59bc3dbd2ac4b49df7ba2dad86cbd396
preview_artifact=data/jimeng-lab/proof-20260610-controlnet-depth-preview/artifacts/controlnet-preview-20260609163638-wworll-depth-preview.png

canny:
preview_image_uri=tos-cn-i-tb4s082cfz/915b0cd6c0c943fc9ab24b5c12e5a26d
preview_sha256=ab6fbaa477cfe91545ede7a482ef319e8663ae2be96e05d1e1b0d3ff40ef6c45
preview_artifact=data/jimeng-lab/proof-20260610-controlnet-canny-preview/artifacts/controlnet-preview-20260609163709-xrv4zg-canny-preview.png
```

The preview artifacts are `1024x1024` PNG control maps: pose skeleton, grayscale depth, and canny outline. Raw blend-preview responses can contain signed preview URLs and remain ignored under `data/**`; normalized summaries intentionally record only provider URIs, booleans, hashes, request shapes, and local artifact paths.

## Confirmed Object/Saliency Segmentation Contract

`jimeng-browser-proxy object-mask` is live-proved as a no-generation probe for Jimeng's reference-image object detection and mask extraction path. It accepts a local image, uploads it through the confirmed ImageX scene `2` path when needed, calls `/mweb/v1/saliency_seg`, and downloads returned mask PNG artifacts when mask URLs are present.

Frontend bundle evidence:

```txt
getSaliencySEG({ imageUriList: [image], mode: "canvas" }, babi_param)
getSaliencySEG({ imageUriList: [image] }, babi_param)
feature_entrance_detail = <entrance>-referenceimage-object_detection
ret=2046 maps to NoSegmentObjectFoundError
ret=2047 maps to SegmentFailedError
```

Direct request shapes:

```txt
POST /mweb/v1/saliency_seg
```

```json
{ "image_uri_list": ["tos-cn-i-tb4s082cfz/..."], "mode": "canvas" }
```

```json
{ "image_uri_list": ["tos-cn-i-tb4s082cfz/..."] }
```

Current CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts object-mask \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --mode both \
  --outDir data/jimeng-lab/proof-20260610-object-mask
```

Safe summary:

```txt
image_uri=tos-cn-i-tb4s082cfz/080999a077994629bbec76c6f344a09a.png
canvas_mask_uri=tos-cn-i-tb4s082cfz/2b0258d421f14b02b6f20a23eeaae0ec
canvas_response_sha256=c903f33db56e3f156b6c9a37a61af8668b87169f1642ea6ac3ce7fee4db1c65a
canvas_artifact=data/jimeng-lab/proof-20260610-object-mask/artifacts/object-mask-20260609165112-8yjxpj-canvas-mask-01.png
default_mask_uri=tos-cn-i-tb4s082cfz/d6641d59e6de4d17be119c0b98506129
default_response_sha256=7c6f74cd237c1ed788e369300eb30ea8c4de67efe3ca5548db4abcaff9ab2abc
default_artifact=data/jimeng-lab/proof-20260610-object-mask/artifacts/object-mask-20260609165112-8yjxpj-default-mask-01.png
summary=data/jimeng-lab/proof-20260610-object-mask/normalized/object-mask-20260609165112-8yjxpj-summary.json
```

Both mask artifacts are `2048x2048` PNGs. Raw segmentation responses can contain signed mask URLs and remain ignored under `data/**`; normalized summaries intentionally record only provider URIs, booleans, hashes, request shapes, and local artifact paths.

## Confirmed Local Video Upload Contract

Local VOD upload is now confirmed end-to-end for small/direct reference clips:

```txt
POST /mweb/v1/get_upload_token
GET  VOD ApplyUploadInner
POST VOD /upload/v1/{StoreUri}
POST VOD CommitUploadInner
```

Request:

```json
{ "scene": 1 }
```

Confirmed VOD details from the frontend uploader SDK and live CLI proof:

- `scene=1` returns the VOD token path for videos.
- Jimeng's VOD token uses `space_name=dreamina`, `upload_domain=vod.bytedanceapi.com`, and `region=cn`.
- The bundled uploader calls `ApplyUploadInner` with `Version=2020-11-19`, `SpaceName=dreamina`, `FileType=video`, `IsInner=1`, `FileSize`, optional `FileExtension`, and random `s`.
- VOD signing uses the same AWS4-style signer shape with credential scope `YYYYMMDD/cn/vod/aws4_request`.
- Small video files direct-upload to `https://{UploadHost}/upload/v1/{StoreUri}` with `Authorization`, `Content-CRC32`, and `X-Storage-U`.
- `CommitUploadInner` posts `{"SessionKey":"...","Functions":[]}` and returns provider video references such as `Vid` plus `VideoMeta` fields including `Uri`, `Width`, `Height`, `Duration`, `Format`, `Codec`, and `Md5`.

Dry-run:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts upload-video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --file data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4 \
  --outDir data/jimeng-lab/proof-20260609-video-upload-dry-run \
  --dryRun
```

Live proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts upload-token \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --scene video \
  --outDir data/jimeng-lab/proof-20260609-video-upload-token

bun packages/jimeng-client/src/browser-proxy-cli.ts upload-video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --file data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4 \
  --outDir data/jimeng-lab/proof-20260609-video-upload-live
```

Proof result:

```txt
vid=v03870g10004d8k1u4nog65hb08dnhig
storeUri=tos-cn-v-148450/o4gBE1AAWbfiDDig6xEQ4KJhDHQvlExoFkFExB
source video=H.264 MP4, 704x1248, 5.016667s, 4,285,498 bytes
summary=data/jimeng-lab/proof-20260609-video-upload-live/normalized/upload-video-20260609141130-summary.json
```

Raw token/apply/commit responses include temporary credentials and provider upload authorization. They remain ignored under `data/**`.

## Lip-Sync Video Reference Dry-Run Contract

`jimeng-browser-proxy lip-sync` now writes a dry-run VOD video-reference lip-sync plan. Live submit is intentionally disabled until a real frontend lip-sync `/mweb/v1/aigc_draft/generate` request is captured and compared against the generated provider input.

Evidence from the 2026-06-09 frontend bundles:

- initial lip-sync generation builds `input.videoGenInputs.v2vOpt.lipSyncUserVideo`
- image/avatar mode builds `input.videoGenInputs.i2vOpt.realmanAvatar`
- both modes attach `ttsInfo`
- video mode requires `originVideo.originVideo.width` and `originVideo.originVideo.height`
- mock model records `generateType=LipSync`
- process flow is `DAVideoProcessType.LipSyncUserVideo` for VOD input and `DAVideoProcessType.LipSyncImage` for image/avatar input
- initial lip-sync submit query params use `scenario=image_video_generation`, `featureKey=text_to_video`; post-edit lip-sync snippets use `featureKey=to_video-lipsync`

Confirmed video-mode model catalog:

```txt
scene=lip_sync_video_generate_video
model_req_key=dreamina_lib_sync_base
model_name=基础模式
options=[]
model_tip=仅仅修改人物口型。适合演讲、对白
```

Focused no-spend config command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts lip-sync-config \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --outDir data/jimeng-lab/proof-20260610-lip-sync-config
```

Latest config proof:

```txt
image_models=dreamina_lib_sync_image_master_1.5:大师模式:input_media_type,audio_option | dreamina_lib_sync_image_quick_1.5:快速模式:input_media_type,audio_option
image_default_idx=1
video_models=dreamina_lib_sync_base:基础模式:仅仅修改人物口型。适合演讲、对白
video_default_idx=0
image_response_text_sha256=4ee64d934e475164c23f6c5ed3080a65e33bbe2f478152b4786b187fc24abc23
video_response_text_sha256=03cb4d200ad77f1e5bded4d6d558bf5f5798b991040ff621f28d74d65ab07ae0
raw=data/jimeng-lab/proof-20260610-lip-sync-config/raw/lip-sync-config-20260609232724.json
summary=data/jimeng-lab/proof-20260610-lip-sync-config/normalized/lip-sync-config-20260609232724-summary.json
```

Raw config responses include signed model-preview GIF URLs. Normalized summaries omit those URLs.

Dry-run proof command:

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

Dry-run plan facts:

```txt
status=dry-run-only
endpoint=/mweb/v1/aigc_draft/generate
model_req_key=dreamina_lib_sync_base
provider path=input.videoGenInputs.v2vOpt.lipSyncUserVideo
originVideo.vid=v03870g10004d8k1u4nog65hb08dnhig
originVideo.uri=tos-cn-v-148450/o4gBE1AAWbfiDDig6xEQ4KJhDHQvlExoFkFExB
originVideo.width=704
originVideo.height=1248
originVideo.duration=5.016667
ttsInfo.sourceType=text-to-speech
ttsInfo.toneId=7597003459665072686
```

Proof bundle:

```txt
data/jimeng-lab/proof-20260610-lip-sync-vod-plan/raw/lip-sync-20260609145310-83bdpg-dry-run-plan.json
data/jimeng-lab/proof-20260610-lip-sync-vod-plan/normalized/lip-sync-20260609145310-83bdpg-summary.json
```

Compare gate:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts lip-sync-compare \
  --plan data/jimeng-lab/proof-20260610-lip-sync-vod-plan/raw/lip-sync-20260609145310-83bdpg-dry-run-plan.json \
  --rawNetwork data/jimeng-captures/<lip-sync-capture>/raw-network.jsonl \
  --outDir data/jimeng-lab/proof-20260610-lip-sync-compare
```

Current no-capture proof against `data/jimeng-captures/20260610-subject-create-ui/raw-network.jsonl` returned `match=false`, `candidate_count=0`; a real background CDP lip-sync UI submit capture is still required before enabling live submit.

## Confirmed Image-To-Video First-Frame Contract

`jimeng-browser-proxy image2video` is live-proved for the UGC first-frame workflow:

```txt
local PNG/JPEG/WebP
→ ImageX scene=2 upload
→ tos-cn-i-tb4s082cfz/... provider URI
→ /mweb/v1/aigc_draft/generate with video_gen_inputs[0].first_frame_image
→ /mweb/v1/get_history_by_ids polling
→ signed MP4 download
```

Useful CLI flags now exposed:

```txt
--image <path>             local first-frame image; uploads before submit
--lastImage <path>         local end-frame image for frames2video; uploads before submit
--firstFrameUri <uri>      reuse an existing provider URI
--lastFrameUri <uri>       payload-level end-frame experiment
--durationSec <sec>
--ratio <ratio>
--videoResolution <value>
--modelVersion <value>
--modelReqKey <value>
--seed <n>
```

Dry-run with local upload:

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

Live proof:

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

Proof result:

```txt
firstFrameUri=tos-cn-i-tb4s082cfz/7abfa90c628d46859c32dc2feffcd2e1.png
submitId=aa83d0e1-a20c-4b85-ab59-ee3a7894296f
historyId=39156175522050
artifact=data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4
thumbnail=data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-thumb-2s.jpg
video=H.264 MP4, 704x1248, 5.016667s, 4.3 MB
```

Raw upload/apply/commit responses, signed artifact URLs, and generated media remain ignored under `data/**`.

### Frames-To-Video Dry-Run Proof

`jimeng-browser-proxy frames2video` now uploads a first-frame image and an end-frame image, then writes a patched no-generation plan with both provider URIs:

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

Dry-run proof facts:

```txt
first_frame_image=tos-cn-i-tb4s082cfz/5b31ee284d5c43eb8097bfc5818b584a.png
end_frame_image=tos-cn-i-tb4s082cfz/325213bd2b2049d3a65667350b72807e.jpg
first image=2048x2048 PNG, 2,913,365 bytes
end image=704x1248 JPEG, 58,126 bytes
duration_ms=5000
ratio=9:16
model_req_key=dreamina_ic_generate_video_model_vgfm_3.0_fast
plan=data/jimeng-lab/proof-20260609-frames2video-dry-run/raw/frames2video-20260609142243-t9emm5-dry-run-plan.json
```

This is dry-run-proved only. The next live-proof step should capture or select the frontend's explicit end-frame/multi-frame mode before spending generation quota.

## Confirmed Config Catalog Probes

`packages/jimeng-client/src/catalog.ts` has a broad non-generating catalog smoke probe for:

- `skill-list`: `/mweb/v1/creation_agent/v2/skill/list`
- `agent-config`: `/mweb/v1/creation_agent/v2/get_agent_config`
- `voice-assets`: `/mweb/v1/get_user_local_item_list`
- `lip-sync-image-config`: `/mweb/v1/video_generate/get_common_config` with `scene=lip_sync_image_generate_video`
- `lip-sync-video-config`: `/mweb/v1/video_generate/get_common_config` with `scene=lip_sync_video_generate_video`
- `subject-list`: `/mweb/v1/dreamina_subject/get`

These probes are useful for keeping the CLI/app aware of available models, lip-sync routes, saved subjects, and user voice assets without consuming generation credits.

The `skill-list` and `agent-config` subset is now promoted into the focused, schema-backed `jimeng-browser-proxy agent-catalog` command. Use that command for durable official-skill, image-model, video-model, option-enum, input-media-type, unified-edit, and image-control fields.

The direct image model common config is now promoted into the focused, schema-backed `jimeng-browser-proxy image-models` command. Use that command for `/mweb/v1/get_common_config` workbench/default image model keys, feature flags, blend controls, resolution presets, sample-step bounds, and commercial benefit/resource ids.

The two lip-sync config endpoints also have a focused command, `jimeng-browser-proxy lip-sync-config`, because they directly parameterize digital-human/image-avatar mode and VOD video lip-sync mode.

## Confirmed Saved Subject / Persona List Contract

`jimeng-browser-proxy subjects` calls `/mweb/v1/dreamina_subject/get` directly with the logged-in browser session. This is a no-generation, no-spend list probe for saved Jimeng subjects/personas.

Request shape:

```json
{
  "cursor": 0,
  "limit": 20,
  "subject_id_list": ["14204993143308"]
}
```

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts subjects \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 20 \
  --outDir data/jimeng-lab/proof-20260610-subjects-after-create
```

Observed proof facts:

```txt
http_status=200
ret=0
errmsg=success
cursor=0
limit=20
subject_count=3
has_more=false
next_cursor=1781049529864
top_subject_id=12352249053442
top_subject_name=CLI Kbeauty UGC 2
response_text_sha256=27e7441c6bd27520df457685986694753e5a100657bc9e5c30f6c04e78a892a6
proof=data/jimeng-lab/proof-20260610-subjects-after-create/
```

The older `data/jimeng-lab/proof-20260610-subjects/` proof returned zero subjects before the first CLI subject-create run. The later proof shows the non-empty account shape and confirms signed cover URLs are reduced to presence booleans. Normalized fields:

- `subject_id`
- `name`
- `description`
- `status`
- create/update timestamps
- cover image URI
- cover URL presence, without preserving the signed URL
- image URI count
- voice id count

## Confirmed Saved Subject / Persona Create Contract

`jimeng-browser-proxy subject-create` creates a saved Jimeng subject/persona directly from a local ImageX-uploaded or existing provider image. This is an asset CRUD path, not a generation submit.

Captured UI path:

```txt
资产 -> 主体 -> 创建主体 -> 从本地添加 -> 保存
```

Direct endpoint sequence for local-image mode:

```txt
/mweb/v1/get_upload_token scene=2
ImageX ApplyImageUpload
ImageX direct POST /upload/v1/{StoreUri}
ImageX CommitImageUpload
/mweb/v1/imagex/submit_audit_job
/mweb/v1/get_image_by_uri
/mweb/v1/dreamina_subject/create
```

Create request shape:

```json
{
  "content": {
    "name": "CLI Kbeauty UGC 2",
    "description": "韩系美妆健身UGC创作者，真实手机自拍参考图。",
    "main_image": {
      "width": 2048,
      "height": 2048,
      "image_uri": "tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png",
      "image_url": "<signed preview url>"
    }
  },
  "workspace_id": 14199856180236
}
```

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts subject-create \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --workspaceId 14199856180236 \
  --name "CLI Kbeauty UGC 2" \
  --description "韩系美妆健身UGC创作者，真实手机自拍参考图。" \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --outDir data/jimeng-lab/proof-20260610-subject-create-cli
```

Observed proof facts:

```txt
http_status=200
ret=0
errmsg=success
subject_id=12352249053442
data_id=12352249053698
main_image_uri=tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png
summary_sha256=52a8d7ba8acf00de72912228a5d1ab1ea0d96edea5adf8be44744d2092258dec
proof=data/jimeng-lab/proof-20260610-subject-create-cli/
```

Normalized summaries redact signed image URLs. Raw upload, lookup, and create responses stay ignored under `data/**`.

## Confirmed Saved Subject / Persona Update/Delete Contract

`jimeng-browser-proxy subject-update` and `jimeng-browser-proxy subject-delete` expose the other no-spend subject lifecycle endpoints. The frontend service maps camel-case calls to these wire shapes:

```json
{
  "subject_id": "14204993143308",
  "content": {
    "name": "CLI QA Updated",
    "description": "临时主体：update命令已验证，随后删除。",
    "main_image": {
      "width": 2048,
      "height": 2048,
      "image_uri": "tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png",
      "image_url": "<signed preview url>"
    }
  }
}
```

```json
{
  "subject_id": "14204993143308"
}
```

Proof sequence:

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
```

Observed proof facts:

```txt
created_subject_id=14204993143308
created_data_id=14204993143564
update_ret=0
update_errmsg=success
update_response_text_sha256=47168986f6e80a31c8f169afdb19755b4a08895f496292e988e6f1d88b6152c2
delete_ret=0
delete_errmsg=success
delete_response_text_sha256=8cc3d46d8dec2d339dc0e7fe2d338f0ac4946752fc276a0f9a508bcb7c1f52f8
post_delete_filtered_subject_count=0
proof=data/jimeng-lab/proof-20260610-subject-lifecycle/
```

`subject-generate-voice` has dry-run request support:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts subject-generate-voice \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --imageUri tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png \
  --outDir data/jimeng-lab/proof-20260610-subject-lifecycle \
  --dryRun
```

The request shape is `{"image_uri":"tos-cn-i-..."}`. Live submit remains disabled because it may consume generation quota and still needs explicit spend approval or a captured UI submit.

## Confirmed Explore / Template Mining Contract

`jimeng-browser-proxy templates` now calls `/mweb/v1/get_explore` directly with the logged-in browser session. This is a no-generation, no-spend endpoint for mining public creative examples, prompt structure, model keys, usage/favorite counts, and template feature labels.

Request shape:

```json
{
  "count": 5,
  "filter": {
    "work_type_list": ["image", "video", "canvas"]
  },
  "offset": 0,
  "image_info": {
    "width": 2048,
    "height": 2048,
    "format": "webp",
    "image_scene_list": [
      { "scene": "smart_crop", "width": 360, "height": 360, "format": "webp", "uniq_key": "smart_crop-w:360-h:360" },
      { "scene": "normal", "width": 2048, "height": 2048, "format": "webp", "uniq_key": "2048" }
    ]
  },
  "category_id": 11222,
  "feed_refer": "feed_refresh"
}
```

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts templates \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 5 \
  --category-id 11222 \
  --work-types image,video,canvas \
  --outDir data/jimeng-lab/proof-20260610-templates-explore
```

Observed proof facts:

```txt
http_status=200
ret=0
errmsg=success
requested_count=5
returned_total=40
next_offset=5
category_id=11222
by_template_type.image=40
by_ai_feature.text_generate_image=40
proof=data/jimeng-lab/proof-20260610-templates-explore/
```

The response embeds reusable prompt/model evidence in `aigc_draft.content.component_list[].abilities.generate.core_param`. The CLI normalizes:

- `prompt`
- `model_req_key`
- `seed`
- `image_ratio`
- template type / AI feature labels
- usage, favorite, and play counts
- cover dimensions/aspect ratio
- metadata template id/type

Quirk: the endpoint returned 40 items for a request with `count=5`, while still setting `next_offset=5`. Treat `count` as a paging hint, not a hard returned-item cap.

## Confirmed Short-Video Explore Mining Contract

`jimeng-browser-proxy short-videos` uses the same `/mweb/v1/get_explore` endpoint with `filter.work_type_list=["short_video"]`. This is a no-generation, no-spend path for mining public short-video examples, video metadata, and ranking signals that can seed reference-profile and niche research workflows.

Request shape:

```json
{
  "count": 5,
  "filter": {
    "work_type_list": ["short_video"]
  },
  "offset": 0,
  "image_info": {
    "width": 2048,
    "height": 2048,
    "format": "webp"
  },
  "category_id": 11222,
  "feed_refer": "feed_enterauto"
}
```

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts short-videos \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 5 \
  --category-id 11222 \
  --outDir data/jimeng-lab/proof-20260610-short-videos-explore
```

Observed proof facts:

```txt
http_status=200
ret=0
errmsg=success
requested_count=5
returned_total=20
next_offset=5
category_id=11222
feed_refer=feed_enterauto
top_play_num=1718727
top_video_duration=85s
top_video_resolution=1280x720
top_video_fps=15
top_video_has_audio=true
proof=data/jimeng-lab/proof-20260610-short-videos-explore/
```

The normalized short-video fields intentionally omit signed `video_url` values while retaining durable metadata:

- `video_id`
- `duration_sec` / `duration_ms`
- width, height, fps, definition, format, codec, size
- `has_audio` / `is_mute`
- available transcoded definitions
- play, favorite, comment, and share counts
- metadata effect id/type, currently including `gen_story` / `tool`

## Confirmed Overseas Short-Video Feed Contract

`jimeng-browser-proxy overseas-short-videos` calls `/mweb/v1/feed_short_video` directly with the logged-in browser session. This is a no-generation, no-spend path for an alternate short-video feed discovered in the frontend bundle as `GET_OVERSEAS_SHORT_VIDEO`.

Request shape:

```json
{
  "count": 5,
  "filter": {
    "work_type_list": ["short_video"]
  },
  "offset": 0,
  "image_info": {
    "width": 2048,
    "height": 2048,
    "format": "webp"
  },
  "category_id": 11222,
  "feed_refer": "feed_enterauto"
}
```

CLI proof:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts overseas-short-videos \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --limit 5 \
  --category-id 11222 \
  --outDir data/jimeng-lab/proof-20260610-overseas-short-videos
```

Observed proof facts:

```txt
http_status=200
ret=0
errmsg=success
requested_count=5
returned_total=4
next_offset=5
category_id=11222
feed_refer=feed_enterauto
top_play_num=2382533
top_video_duration=57s
top_video_resolution=3840x2160
top_video_fps=30
top_video_has_audio=true
response_text_sha256=dc3ef47f5dd45b9f2681da88f502f39f3ce0ac2b512259f375d70665f63c0487
proof=data/jimeng-lab/proof-20260610-overseas-short-videos/
```

The live response currently uses snake_case `data.item_list`, while the frontend bundle's domain path references camelCase `itemList`/`commonAttr`. The CLI parser accepts both. Normalized output redacts signed cover URLs from item lists while retaining durable cover presence/dimensions, video metadata, ranking signals, and metadata effect ids.

## Confirmed CapCut Template Category Contract

`jimeng-browser-proxy capcut-categories` calls the read-only CapCut editor API category endpoint discovered in the Jimeng/Dreamina frontend bundle. This endpoint does not consume generation quota and does not require CapCut cookies in the current proof; it uses the frontend's CapCut request signer with `pf=7`, `appvr=5.8.0`, `app-sdk-version=999.999.999`, and `sdk_version=16.1.0`.

Command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-categories \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --outDir data/jimeng-lab/proof-20260610-capcut-categories
```

Confirmed endpoint:

```txt
POST https://edit-api-sg.capcut.com/lv/v1/cc_web/plane/get_categories
request={"sdk_version":"16.1.0"}
```

Latest proof returned eight commercial template category groups:

```txt
Black Friday
Clothing and shoes
Cosmetic dailyization
Food beverages
Jewelry
Furniture
Consumer electronics
pets
response_text_sha256=27f4e1bc5a3ff2ddf94568b77d068db828807ab3aa12be3c484588b1b4ff3ea0
raw=data/jimeng-lab/proof-20260610-capcut-categories/raw/capcut-categories-20260609230631.json
summary=data/jimeng-lab/proof-20260610-capcut-categories/normalized/capcut-categories-20260609230631-summary.json
```

Related collection/template endpoints now have a split status:

- `/lv/v1/cc_web/replicate/search_templates`: blocked pending exact UI payload capture. Frontend method `searchTemplates(e)` maps `sdkVersion`, `searchId`, `enterFrom`, `categoryIds`, `sceneId`, `featureKey`, `colors`, and `graphNum` to `sdk_version`, `search_id`, `enter_from`, `category_ids`, `scene_id`, `strategy_extra`, `custom_colors`, and `graph_num`, while spreading remaining fields into the request body. Signed no-spend probes returned `ret=1000 param error` across 10 recovered keyword/category/search-id variants.
- `/lv/v1/cc_web/plane/get_collections`: implemented as `capcut-collections`; direct `{sdk_version:"16.1.0"}` returned the durable collection ids.
- `/lv/v1/cc_web/plane/get_collection_templates`: implemented as `capcut-collection-templates`; the stable body field is `id:<collectionId>`, not `category_id` or `collection_id`.
- `/lv/v1/cc_web/plane/get_template_detail`: implemented as `capcut-template-detail`; the stable id is the string `web_id` from template rows.
- `/lv/v1/cc_web/plane/batch_get_collection_templates`: blocked pending exact UI payload capture. Frontend method `getBatchTemplatesByCategory(e)` passes `e` through directly and expects an array response with per-category `item_list`; signed no-spend probes returned `ret=1000 param error` across 15 object/list/nested collection variants.
- `/lv/v1/cc_web/plane/get_collection_presets`: blocked pending exact UI payload and auth/header capture. Signed no-spend probes using confirmed collection ids returned `ret=1015 check login error` across 8 variants.
- `/lv/v1/cc_web/plane/preset_template_detail`: blocked until a real preset id and required preset UI context are captured.
- `/lv/v1/cc_web/plane/fuzzy_search_templates`: blocked pending non-empty UI capture. Frontend method `fuzzySearchTemplateByTitle(e)` passes `e` through directly and expects `data.item_list`. Direct no-spend probes returned `ret=0` but empty lists for guessed keyword/title bodies, so it is not exposed as useful yet.

Static method proof:

```txt
proof=data/jimeng-lab/proof-20260610-static-locate-capcut-methods/
summary=data/jimeng-lab/proof-20260610-static-locate-capcut-methods/normalized/static-locate-20260610042935-summary.json
terms=searchTemplates,getTemplateAccordCategory,getBatchTemplatesByCategory,fuzzySearchTemplateByTitle,getTemplateHotWords
occurrences=10
normalized_static_locate_capcut_method_proof_has_no_signed_urls_or_credentials=true
```

## Confirmed CapCut Template Collection/Row/Detail Contracts

`jimeng-browser-proxy capcut-collections`, `capcut-collection-templates`, and `capcut-template-detail` promote the no-spend collection browsing path into stable CLI commands. They use the same signed `edit-api-sg.capcut.com` request path as the category command and do not require a Jimeng browser session in the current proof.

Commands:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-collections \
  --outDir data/jimeng-lab/proof-20260610-capcut-collections

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-collection-templates \
  --collection-id 10034 \
  --limit 5 \
  --outDir data/jimeng-lab/proof-20260610-capcut-collection-templates

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-template-detail \
  --template-id 7369116096600771846 \
  --outDir data/jimeng-lab/proof-20260610-capcut-template-detail
```

Confirmed requests:

```txt
POST /lv/v1/cc_web/plane/get_collections
body={"sdk_version":"16.1.0"}

POST /lv/v1/cc_web/plane/get_collection_templates
body={"sdk_version":"16.1.0","enter_from":"feed","count":5,"lang":"en","id":10034}

POST /lv/v1/cc_web/plane/get_template_detail
body={"sdk_version":"16.1.0","enter_from":"feed","app_version":"5.8.0","lang":"en","region":"us","template_id":"7369116096600771846","need_draft":false}
```

Proof facts:

```txt
collections: ret=0 collection_count=35
collection_templates: ret=0 collection_id=10034 template_count=5 has_more=true new_cursor=5
first_template_web_id=7369116096600771846
first_template_title=FACEBOOK ADS - MARKETING POSTER - BEAUTY LIPSTIC - NEW COLLECTION - FB ADS POST
template_detail: ret=0 template_id=7369116096600771846 template_url_present=true template_version=1.4.3
template_detail_material_counts=effects:8,local_images:4,file_infos:1
normalized_outputs_have_no_signed_urls_or_credentials=true
```

`jimeng-browser-proxy capcut-probe` is now the signed no-spend replay tool for these remaining CapCut/LV endpoints. It does not load a Jimeng session or foreground a browser; it is guarded to signed read-oriented endpoints, rejects known mutating paths such as preset deletion, writes raw responses only under ignored `data/**`, and emits normalized request/response shape summaries without URL values. Template/editor reads go to `edit-api-sg.capcut.com`; `/lv/v2/cc_web_task/*` reads go to `feed-api-sg.capcut.com`.

Probe commands:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/cc_web/replicate/get_search_words \
  --body '{}' \
  --outDir data/jimeng-lab/proof-20260610-capcut-probe-hot-words

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/cc_web/plane/fuzzy_search_templates \
  --variants '{"variants":[{"name":"keyword-en","body":{"sdk_version":"16.1.0","keyword":"makeup"}},{"name":"keyword-zh","body":{"sdk_version":"16.1.0","keyword":"美妆"}},{"name":"title-en","body":{"sdk_version":"16.1.0","title":"makeup"}}]}' \
  --outDir data/jimeng-lab/proof-20260610-capcut-probe-fuzzy

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/cc_web/plane/get_collection_templates \
  --variants '{"variants":[{"name":"category_id","body":{"sdk_version":"16.1.0","enter_from":"feed","count":20,"lang":"en","category_id":0}},{"name":"collection_id","body":{"sdk_version":"16.1.0","enter_from":"feed","count":20,"lang":"en","collection_id":0}},{"name":"category_ids","body":{"sdk_version":"16.1.0","enter_from":"feed","count":20,"lang":"en","category_ids":[0]}}]}' \
  --outDir data/jimeng-lab/proof-20260610-capcut-probe-collection

bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe \
  --endpoint /lv/v1/cc_web/replicate/search_templates \
  --variants '{"variants":[{"name":"keyword","body":{"sdk_version":"16.1.0","enter_from":"feed","count":20,"lang":"en","keyword":"makeup"}},{"name":"search_word","body":{"sdk_version":"16.1.0","enter_from":"feed","count":20,"lang":"en","search_word":"makeup"}},{"name":"query","body":{"sdk_version":"16.1.0","enter_from":"feed","count":20,"lang":"en","query":"makeup"}}]}' \
  --outDir data/jimeng-lab/proof-20260610-capcut-probe-search
```

Latest no-spend probe facts:

```txt
/lv/v1/cc_web/replicate/get_search_words
  body -> ret=0 errmsg=success response_sha=b442e8144ac7...

/lv/v1/cc_web/plane/fuzzy_search_templates
  keyword-en -> ret=0 errmsg=success response_sha=f70060efdcf4...
  keyword-zh -> ret=0 errmsg=success response_sha=9770f85cc99b...
  title-en -> ret=0 errmsg=success response_sha=5075ed973ff4...
  all three returned data.item_list length 0 in the normalized shape

/lv/v1/cc_web/plane/get_collection_templates
  category_id -> ret=1000 errmsg="param error" response_sha=71cf86d7c28c...
  collection_id -> ret=1000 errmsg="param error" response_sha=c975fd67d155...
  category_ids -> ret=1000 errmsg="param error" response_sha=7e45dad2b470...

/lv/v1/cc_web/replicate/search_templates
  keyword -> ret=1000 errmsg="param error" response_sha=147d1c355511...
  search_word -> ret=1000 errmsg="param error" response_sha=b53c75bc5959...
  query -> ret=1000 errmsg="param error" response_sha=1f36fc8015f7...

blocked proof refresh:
  batch_get_collection_templates -> 15 variants, all ret=1000 param error
  search_templates -> 10 variants, all ret=1000 param error
  get_collection_presets -> 8 confirmed-collection variants, all ret=1015 check login error
  proof_dirs=data/jimeng-lab/proof-20260610-capcut-probe-batch-collection-templates*,data/jimeng-lab/proof-20260610-capcut-probe-search-templates-v2,data/jimeng-lab/proof-20260610-capcut-probe-presets-confirmed-collection
```

## Confirmed CapCut Public Template Metadata Contract

`jimeng-browser-proxy capcut-template-metadata` fetches two public static CapCut template metadata JSON files discovered in the same frontend bundle. This path does not require a Jimeng or CapCut session and does not consume generation quota.

Command:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-template-metadata \
  --outDir data/jimeng-lab/proof-20260610-capcut-template-metadata
```

Confirmed endpoints:

```txt
GET https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_49/bee_prod_49_bee_publish_709.json
GET https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod/biz_149/bee_prod_149_bee_publish_835.json
```

Frontend evidence:

```txt
GetAllTemplateRatio=url(k.U8.mercury + "/biz_49/bee_prod_49_bee_publish_709.json")
GetTemplateScenes=url(k.U8.mercury + "/biz_149/bee_prod_149_bee_publish_835.json")
k.U8.mercury="https://lf16-beecdn.ibytedtos.com/obj/ies-fe-bee-sg/bee_prod"
```

Latest proof:

```txt
ratio_count=6
scene_count=33
ratios_response_text_sha256=18b2d8e274f0a129fdbec437f5c9b28a2cfad89dd94807d63efb4325ed5ace41
scenes_response_text_sha256=aa409da2647ee22a9025d17835055ffd34450b1c07783ea54a1909fa367e286d
first_scenes=Instagram post:1080x1080 | Instagram story:1080x1920 | Instagram portrait:1080x1350 | Tiktok:1080x1920 | YouTube thumbnail:1280x720 | YouTube intro:1920x1080 | YouTube end screen:1920x1080 | Facebook post:940x788
raw=data/jimeng-lab/proof-20260610-capcut-template-metadata/raw/capcut-template-metadata-20260609231824.json
summary=data/jimeng-lab/proof-20260610-capcut-template-metadata/normalized/capcut-template-metadata-20260609231824-summary.json
```

## Discovered From Frontend Bundles

The 2026-06-09 JS bundle sweep found these useful endpoint groups. Treat rows without an implemented status as capture targets, not stable contracts, until a real UI flow and dry-run payload are recorded.

| Group | Endpoints |
|---|---|
| Agent skill/model catalog | `/mweb/v1/creation_agent/v2/skill/list`, `/mweb/v1/creation_agent/v2/get_agent_config`; implemented as no-spend `agent-catalog`, including official skills, image/video model keys, input media types, frame/fps/aspect options, unified-edit material limits, and image control feats |
| Voice cloning / custom voice | `/mweb/v1/voice/submit_task`, `/mweb/v1/voice/query_task`, `/mweb/v1/voice/update`, `/mweb/v1/voice/delete`; cloned voice listing is implemented as `voice-clones`, task query is implemented for real task ids, and submit/update/delete are dry-run-only until approved/captured |
| Subject/persona lifecycle | `/mweb/v1/dreamina_subject/get`, `/mweb/v1/dreamina_subject/create`, `/mweb/v1/dreamina_subject/update`, `/mweb/v1/dreamina_subject/delete`, `/mweb/v1/dreamina_subject/generate_voice`; list/create/update/delete are implemented, while generate_voice is dry-run-only until explicit spend approval or captured UI submit |
| Workspace context | `/mweb/v1/workspace/list` and `/mweb/v1/workspace/get_by_ids` are implemented as Effect Schema-backed no-spend `workspace-context` for logged-in workspace/project metadata reads; latest live proof returned 2 listed workspaces and 1 by-id workspace; workspace create/update/delete remain capture/disposable-fixture targets because they mutate account state |
| Reference-profile research | `/mweb/v1/get_user_info`, `/mweb/v1/get_homepage`, `/mweb/v1/get_favorite_list`, `/mweb/v1/get_user_story_list`, `/mweb/v1/get_follow_list`, `/mweb/v1/get_item_info`, and `/mweb/v1/mget_item_info` are implemented as Effect Schema-backed no-spend `profile-research`. Public profile/homepage/favorites/stories use `sec_uid`; single item detail uses `published_item_id`; batch item detail uses `item_id_list`; follow/follower reads are explicitly current-account scoped. |
| Infinite canvas | `/mweb/v1/infinite_canvas/list_project`, `/mweb/v1/infinite_canvas/project_detail`, `/mweb/v1/infinite_canvas/v1/get_canvas_custom_ratio`, and `/mweb/v1/infinite_canvas/get_conversation_list` are implemented as no-spend `infinite-canvas`; `/mweb/v1/infinite_canvas/fetch_conversation` needs a real conversation id from a non-empty list, while `/mweb/v1/infinite_canvas/create_project`, `/mweb/v1/infinite_canvas/conversation`, `/mweb/v1/infinite_canvas/edit`, `/mweb/v1/infinite_canvas/resume`, `/mweb/v1/infinite_canvas/stop_stream`, `/mweb/v1/infinite_canvas/v1/fetch_snapshot`, `/mweb/v1/infinite_canvas/v1/submit_changeset`, and `/mweb/v1/infinite_canvas/v1/fetch_changeset` remain capture/disposable-fixture targets |
| Reference/image tools | `/mweb/v1/get_common_config`, `/mweb/v1/get_image_description`, `/mweb/v1/get_upload_token`, `/mweb/v1/face_recognize`, `/mweb/v1/blend_preview`, `/mweb/v1/pose_detect`, `/mweb/v1/saliency_seg`, `/mweb/v1/algo_proxy`; image model common config is implemented as `image-models`; image upload, description, face recognition, ControlNet pose/depth/canny preview, pose detect, and object/saliency segmentation are now implemented, while style/reference payload tools still need CLI coverage |
| Account/runtime/quota reads | `/commerce/v1/benefits/user_credit` is implemented as signed no-spend `account-credit`; `/commerce/v3/resource/benefit_metadata` and `/commerce/v3/benefits/batch_get_user_benefit` are implemented as signed no-spend `commerce-benefits`, useful for quota/cost mapping before paid generation tests; `/mweb/v1/get_settings`, `/mweb/v1/get_ug_info`, and `/mweb/v1/get_invite_status` are implemented as no-spend `account-config` for account settings/registration/invite flags; `/mweb/v1/get_experiment_params`, `/mweb/v1/get_home_header_banner_config`, `/mweb/v1/get_help_desk_entrance`, `/mweb/v1/speech/asr_token`, and `/mweb/v1/speech/asr_hotwords` are implemented as no-spend `runtime-config` for frontend/runtime/audio support config with token and URL values redacted in normalized output. `/commerce/v1/benefits/credit_receive` is a mutation and remains unimplemented without explicit approval. |
| Video generation helpers | `/mweb/v1/video_generate/get_switch_model_queue_info`, `/mweb/v1/video_generate/pre_process`, `/mweb/v1/video_generate/mget_pre_process_result`, `/mweb/v1/video_generate/face_auth/skip`, `/mweb/v1/video_generate/face_auth/skip/query`, `/mweb/v1/aigc_draft/cancel_generate`, `/mweb/v1/aigc_draft/generate_accelerate`; these are blocked pending exact UI payload capture or disposable active-job context. Safe switch-model queue probes returned `ret=1000 invalid parameter` across empty/model/scene bodies. |
| Template/research mining | `/mweb/search/v1/sug`, `/mweb/search/v1/guess`, `/mweb/search/v1/search`, `/mweb/v1/feed`, `/mweb/v1/feed_short_video`, `/lv/v1/cc_web/plane/get_categories`, public CapCut `bee_prod` metadata JSON, `/lv/v1/cc_web/replicate/search_templates`, `/lv/v1/cc_web/plane/*`; keyword suggestions/guesses are implemented as `research-keywords`, full inspiration/short-film/workspace-asset search is implemented as `research-search`, `/mweb/v1/get_explore` is implemented for direct Explore templates and short-video examples, `/mweb/v1/feed_short_video` is implemented as `overseas-short-videos`, CapCut category catalog is implemented as `capcut-categories`, CapCut collection/row/detail browsing is implemented as `capcut-collections`, `capcut-collection-templates`, and `capcut-template-detail`, and public CapCut ratio/scene metadata is implemented as `capcut-template-metadata`; CapCut search, batch, and preset endpoints remain capture targets |
| Assets/upload/editor | `/mweb/v1/get_asset_list`, `/mweb/v1/get_local_item_list`, `/lv/v1/asset/*`, `/lv/v1/editor/image/*`, `/lv/v1/effect/*`, `/lv/v1/editor/template/*`, `/lv/v2/cc_web_task/*`; Jimeng workbench/history listing is implemented as no-spend `assets`; generated local item detail is implemented as no-spend `local-items`; LV editor catalog endpoints `/lv/v1/effect/get_panel_info`, `/lv/v1/effect/get_category_effects`, `/lv/v1/effect/get_all_fonts`, and `/lv/v1/editor/plane/color/feed` are implemented as no-spend `capcut-editor-catalog`; LV asset reads `/lv/v1/asset/list`, `/lv/v1/asset/query`, `/lv/v1/asset/detail`, and `/lv/v1/asset/query_process` are blocked pending exact workspace/space/session context after safe probes returned `ret=1014`; LV editor/template reads `/lv/v1/editor/template/recent_list`, `/lv/v1/editor/template/check_post_permission`, `/lv/v1/editor/draft/get_template_file`, `/lv/v1/editor/plane/intelligence/query_recommend_template`, and `/lv/v2/cc_web_task/get_task_draft` are blocked pending logged-in LV auth or real id/URI context; LV read-state paths such as editor effect recent lists, plane draft detail/content maps, EverPhoto user space/sync state, preset resources, and task multi-get are blocked pending exact LV auth, real ids, or non-empty UI capture; asset/template/history mutations are blocked unless using disposable fixtures or explicit approval |
| LV editor image AI helpers | `/lv/v1/editor/image/ai_model/submit_task`, `/lv/v1/editor/image/ai_model/batch_get_results`, `/lv/v1/editor/image/ai_model/materials`, `/lv/v1/editor/image/ai_model/create_cloth_mask`, `/lv/v1/editor/image/batch_get_url`, `/lv/v1/editor/image/embed_resource`, `/lv/v1/editor/image/gen_background`, `/lv/v1/editor/image/interactive_matting`, `/lv/v1/editor/image/saliency_seg`, `/api/biz/v1/image/entity_seg`; all are marked blocked until an exact editor UI payload is captured. LV `saliency_seg` is separate from implemented Jimeng `/mweb/v1/saliency_seg`. |
| Audio/video utility | `/mweb/v1/mix_audio_video`, `/mweb/v1/mix_audio_videos`, `/lv/v2/intelligence/tts/curl_sync_everphoto` |

The scan artifacts stay local-only under ignored:

```txt
data/jimeng-lab/js-sweep/endpoint-index.json
data/jimeng-lab/js-sweep/focused-snippets.json
```

## Current Text-To-Image Workbench Contract

Submit:

```txt
POST /mweb/v1/aigc_draft/generate
```

Key body fields:

- `submit_id`: UUID generated client-side.
- `extend.root_model`: e.g. `high_aes_general_v50`.
- `extend.workspace_id`: current workspace id.
- `metrics_extra`: JSON string; contains `generateId`, `sceneOptions`, generation metadata.
- `draft_content`: JSON string.
- Prompt path:

```txt
draft_content.component_list[0].abilities.generate.core_param.prompt
```

Model/resolution fields observed:

```txt
model: high_aes_general_v50
model_name: 图片5.0 Lite
resolution_type: 2k
intelligent_ratio: true
```

Submit response:

```txt
data.aigc_data.submit_id
data.aigc_data.history_record_id
data.aigc_data.status
data.aigc_data.queue_info
```

Poll/list:

```txt
POST /mweb/v1/get_asset_list
```

Current completion signal:

```txt
data.asset_list[0].image.status = 50
data.asset_list[0].image.finished_image_count = total_image_count
data.asset_list[0].image.item_list.length > 0
```

Image URL paths:

```txt
image.item_list[].image.large_images[].image_url
image.item_list[].common_attr.cover_url_map["4096" | "2400" | "1080"]
```

## Workbench Asset Listing

`jimeng-browser-proxy assets` directly calls `/mweb/v1/get_asset_list` as a reusable no-spend asset picker for the UGC pipeline.

Captured/default request shape:

```json
{
  "count": 5,
  "direction": 1,
  "mode": "workbench",
  "option": {
    "order_by": 0,
    "only_favorited": false,
    "end_time_stamp": 0,
    "hide_story_agent_result": true
  },
  "asset_type_list": [1, 2, 5, 6, 7, 8, 9, 10, 12],
  "workspace_id": 14199856180236
}
```

The CLI exposes the meaningful list controls:

- `--limit`
- `--asset-types`
- `--asset-mode`
- `--direction`
- `--order-by`
- `--endTimeStamp`
- `--onlyFavorite`
- `--includeStoryAgentResult`
- `--workspaceId`

Latest live proof:

```txt
proof_bundle=data/jimeng-lab/proof-20260610-assets/
ret=0
errmsg=success
asset_count=1
has_more=false
next_offset=1780998990927
first_asset_id=39148697060354
submit_id=a6bbee65-bed0-4e5b-aaf1-5ab466137b82
status=50
generated_item_count=4
model_req_key=high_aes_general_v50
response_sha256=5373ac3f6339e82f7f3090059b742d83b17b9b438151476993466ae6d105f312
normalized_summary_sha256=10ba3a679c2e7e472c20fb186dedbd5289687c2a5b0aba7e88a0509bf17a4af8
```

Normalized summaries retain durable provider URIs, IDs, prompts, model keys, status, dimensions, and URL-presence booleans. Signed media URLs remain only in ignored raw proof files under `data/**`.

`jimeng-browser-proxy local-items` calls `/mweb/v1/get_local_item_list` for richer detail on current-account generated item ids returned by asset listings.

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts local-items \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --itemIds 7649332406457060634,7649332406457077018 \
  --outDir data/jimeng-lab/proof-20260611-local-items-live
```

Latest live proof:

```txt
proof_bundle=data/jimeng-lab/proof-20260611-local-items-live/
ret=0
item_count=2
request_body={ item_id_list: [...] }
model_req_key=high_aes_general_v50
model_name=图片5.0 Lite
```

Normalized output keeps prompts, model keys/names, provider URIs, dimensions, author metadata, and media URL-presence booleans, but does not include signed URL values.

## History Queue Info

`jimeng-browser-proxy history-queue` directly calls `/mweb/v1/get_history_queue_info` as a no-spend status/progress probe for existing history ids. This is useful for future local job UX without starting the async daemon yet.

Frontend bundle evidence:

```txt
getHistoryQueueInfo({ historyIds })
→ POST /mweb/v1/get_history_queue_info
→ frontend JSON transform sends history_ids on the wire
```

Confirmed wire request:

```json
{
  "history_ids": ["39148697060354"]
}
```

Negative casing probe:

```txt
{"historyIds":["39148697060354"]} -> ret=1000, errmsg=invalid parameter
```

Normalized fields:

- per-history `status`
- `queue_info.queue_idx`
- `queue_info.priority`
- `queue_info.queue_status`
- `queue_info.queue_length`
- polling interval and timeout seconds
- queue display thresholds
- `forecast_cost_time` when present
- raw `debug_info` is not included in normalized output; only `debug_info_present` and `debug_info_sha256`

Latest live proof:

```txt
proof_bundle=data/jimeng-lab/proof-20260610-history-queue/
ret=0
errmsg=success
entry_count=1
history_id=39148697060354
status=0
queue_status=3
queue_length=0
polling_interval_seconds=30
polling_timeout_seconds=86400
response_sha256=292217828c13e57d7908a146e9496d36194c57ab075d547a24e74c7eb61ea8c0
debug_info_sha256=f71e62a6cfa3199b9974993f1774d6161383110784671d6fc9c3fa945072182e
```

The normalized proof was checked for signed URL and raw queue-debug leakage.

## Useful Future Capture Targets

The offline `static-inventory` proof now gives the broadest current static coverage map:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts static-inventory \
  --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \
  --limit 120 \
  --outDir data/jimeng-lab/proof-20260610-static-inventory
```

Latest proof found:

```txt
total_resources=251
included_review_limit=120
high_value_gaps=61
known_status_counts=unknown:125,partial:5,implemented:44,dry_run_only:4,blocked:70,captured_only:2,cataloged_only:1
top_gaps=subject generate_voice, voice clone submit/update/delete, aigc_draft generate capture/compare, LV asset/editor capture payloads, CapCut template search/batch/preset payloads
```

The inventory/worklist now distinguishes endpoints that were safely probed but did not return useful data:

- `/mweb/v1/get_history` is now implemented as `history-list`; `ret=0` with an empty `records_list` is treated as a valid no-spend read response. Keep using `assets`, `history-records`, and `history-queue` for richer known-populated lookups until a non-empty UI capture proves broader pagination scope.
- Ten LV editor image helper endpoints are marked `blocked` until exact editor payloads are captured: AI task submit/result/material/cloth-mask helpers, URL/embed-resource helpers, background generation, interactive matting, LV cutout, and `/api/biz/v1/image/entity_seg`.
- Four LV asset read endpoints are marked `blocked` until exact workspace and space context is captured: `/lv/v1/asset/list`, `/lv/v1/asset/query`, `/lv/v1/asset/detail`, and `/lv/v1/asset/query_process`. The supporting workspace endpoint `/cc/v1/workspace/get_user_workspaces` also returned `ret=1014` with count/cursor and `lite_aid=513695` probes, but `/cc/v1` is outside the static-inventory namespace count.
- Six LV editor/template endpoints are marked `blocked` until exact auth or id context is captured: `/lv/v1/cc_web/plane/del_presets_template` is a mutating preset-delete path rejected by the probe, `/lv/v1/editor/template/recent_list` and `/lv/v1/editor/template/check_post_permission` returned `ret=1015 check login error`, `/lv/v1/editor/draft/get_template_file` returned `ret=1016 ERR_PARAM` for empty `uris`, `/lv/v1/editor/plane/intelligence/query_recommend_template` returned `ret=-3 bad request` for a no-asset body, and `/lv/v2/cc_web_task/get_task_draft` returned `ret=1015 check login error` from the signed feed-api host.
- Fourteen mutation endpoints are marked `blocked` without replay until a disposable fixture or explicit approval is available: LV asset copy/create/cloud-create/delete/export-label/upload-prepare/rename, LV editor template add/add_async/add_query, EverPhoto batch sync/promote, and Jimeng workbench `remove_history` / `update_video_default_bgm`.
- LV editor font/effect/color catalogs are implemented as no-spend `capcut-editor-catalog`; the latest proof returned 14 categories, 745 font/effect rows, and 20 palettes from `/lv/v1/effect/get_panel_info`, `/lv/v1/effect/get_category_effects`, `/lv/v1/effect/get_all_fonts`, and `/lv/v1/editor/plane/color/feed`.
- Nine LV read-state endpoints are marked `blocked` after signed no-spend probes: editor effect recent lists and EverPhoto state paths returned `ret=1015`, plane draft content map returned `ret=1016`, common recent list returned `ret=0` with empty `item_list`, preset resources returned `ret=-1 system busy`, and task multi-get returned `ret=1015`; promotion needs exact auth/id/non-empty UI captures.
- `/lv/v1/cc_web/replicate/get_search_words`: signed no-spend probes returned `ret=0` but only `data.region`, not keyword rows. Keep it blocked until a UI call returns usable search-word payloads.
- `/mweb/search/v1/sug` and `/mweb/search/v1/guess` are implemented as `research-keywords`; `/mweb/search/v1/search` is implemented as `research-search` with the recovered frontend AES cache-token/media transform, and `/mweb/search/v1/fetch_debug/search` is a blocked debug wrapper.
- Public Jimeng reference-profile reads are implemented as `profile-research`: profile, homepage, favorites, stories, single item detail, and batch item detail preserve prompts/model keys/reference media/story metadata in normalized output without signed URL values; following/follower lists are labeled current-account scoped. Batch `/mweb/v1/mget_item_info` uses `item_id_list`, recovered from frontend `getWorkDetails({ itemIdList })` callers before snake-case conversion.
- Current-account generated local item detail is implemented as `local-items`: `/mweb/v1/get_local_item_list` uses `item_id_list` and preserves prompts/model keys/provider URIs/dimensions without signed URL values.

Capture one flow at a time:

- richer image reference controls
- image-to-image / byte edit
- subject/persona generate_voice live submit after explicit spend approval or captured UI submit
- voice cloning and subject voice generation
- pose/style/depth/canny reference controls
- image-to-video end-frame and multi-frame controls
- multimodal/all-around reference video
- video text generation with current unified app route
- lip sync and voice/digital-human tools
- canvas edit operations: inpaint, erase, expand, cutout
- asset library search/import/export
- model/config endpoints for available GenAI tools
- explore/feed/template detail endpoints for niche research and template mining

## Safety Notes

- Keep generation concurrency at `1`.
- Use `rate-probe` only for read/config/list endpoints by default; paid generation, upload, and mutation concurrency require explicit capped approval.
- Dry-run before live submit.
- Stop on auth challenges, CAPTCHA, `ret=1019`, or `shark not pass`.
- Do not commit raw captures, session bundles, cookies, signed URLs, or generated media.
- Treat signed artifact URLs as expiring; download immediately into ignored `data/**`.
