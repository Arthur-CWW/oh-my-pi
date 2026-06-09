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
| `/mweb/v1/workspace/create` | POST | Creates a generation workspace/conversation. | Captured |
| `/mweb/v1/workspace/update` | POST | Renames/updates current workspace metadata. | Captured |
| `/mweb/v1/aigc_draft/generate` | POST | Unified workbench submit for current text-to-image and text/video draft generation paths. | Implemented for workbench text-to-image and existing text-to-video templates |
| `/mweb/v1/get_asset_list` | POST | Poll/list workspace assets and completed image results. | Implemented for workbench text-to-image |
| `/mweb/v1/get_history_by_ids` | POST | Older/general task polling by `submit_id`. | Implemented for captured history-based templates |
| `/mweb/v1/creation_agent/v2/conversation` | POST/SSE | Older agent text-to-image conversation submit. | Preserved |
| `/mweb/v1/creation_agent/v2/get_agent_config` | POST | Agent/tool configuration payload. | Cataloged only |
| `/mweb/v1/creation_agent/v2/skill/list` | POST | Available agent skills/tools. | Cataloged only |
| `/mweb/v1/video_generate/get_common_config` | POST | Video model/common configuration by scene, including lip-sync image/video scenes. | Implemented for config catalog |
| `/mweb/v1/get_user_local_item_list` | POST | User local/generated item lists; `effect_type=218` returns current user's cloned voices. | Implemented for config catalog |
| `/mweb/v1/dreamina_subject/get` | POST | Saved subject/persona list. | Implemented for config catalog |
| `/mweb/v1/feed` | POST | Explore/feed content; a signed `dreamina_tone` feed request returns the built-in voice library. Useful for research/template mining if handled carefully. | Implemented for voice library replay |
| `/mweb/v1/tts_generate` | POST | Built-in voice text-to-speech. Returns base64 MP3 in `data.data`. | Implemented and live-proved |
| `/mweb/v1/get_upload_token` | POST | Temporary upload credentials for video/image/file scenes. Required before direct local reference-image upload. | Implemented and live-proved for token step |
| `/mweb/v1/get_explore` | POST | Explore examples and public creative templates. | Cataloged only |
| `/mweb/v1/get_unread_count` | POST | Notification count. | Low priority |

## Confirmed Voice / Audio Contracts

The built-in voice picker is not exposed through the same local-item endpoint as cloned voices. The useful current split is:

| Contract | Endpoint | Request source | Result |
|---|---|---|---|
| cloned voice assets | `/mweb/v1/get_user_local_item_list` with `effect_type=218` and `clone_voice_status` filter | direct JSON body | Empty list is valid when the account has no cloned voices. |
| built-in voice library | signed `/mweb/v1/feed` request whose body includes `dreamina_tone` | replay from captured frontend request | 142 built-in voice items in current replay; normalized id, title, tags, speaker id, emotions. |
| text-to-speech | `/mweb/v1/tts_generate` | direct JSON body | Base64 MP3 payload, validated as 24 kHz mono MP3 in smoke run. |

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

## Confirmed Upload Token Contract

The next useful UGC slice is local media upload for image-to-video and reference/persona workflows. The first step is confirmed:

```txt
POST /mweb/v1/get_upload_token
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

The raw response includes temporary upload credentials, so it must stay under ignored `data/**`. The next missing piece is using those credentials with the frontend's ImageX/VOD upload SDK behavior to turn a local file into a provider URI that can be injected into:

```txt
draft_content.component_list[0].abilities.gen_video.text_to_video_params.video_gen_inputs[0].first_frame_image
```

## Confirmed Config Catalog Probes

`packages/jimeng-client/src/catalog.ts` now has a non-generating catalog probe for:

- `skill-list`: `/mweb/v1/creation_agent/v2/skill/list`
- `agent-config`: `/mweb/v1/creation_agent/v2/get_agent_config`
- `voice-assets`: `/mweb/v1/get_user_local_item_list`
- `lip-sync-image-config`: `/mweb/v1/video_generate/get_common_config` with `scene=lip_sync_image_generate_video`
- `lip-sync-video-config`: `/mweb/v1/video_generate/get_common_config` with `scene=lip_sync_video_generate_video`
- `subject-list`: `/mweb/v1/dreamina_subject/get`

These probes are useful for keeping the CLI/app aware of available models, lip-sync routes, saved subjects, and user voice assets without consuming generation credits.

## Discovered From Frontend Bundles, Not Yet Live-Proved

The 2026-06-09 JS bundle sweep found these useful endpoint groups. Treat them as capture targets, not stable contracts, until a real UI flow and dry-run payload are recorded.

| Group | Endpoints |
|---|---|
| Voice cloning / custom voice | `/mweb/v1/voice/submit_task`, `/mweb/v1/voice/query_task`, `/mweb/v1/voice/update`, `/mweb/v1/voice/delete` |
| Subject/persona lifecycle | `/mweb/v1/dreamina_subject/create`, `/mweb/v1/dreamina_subject/update`, `/mweb/v1/dreamina_subject/delete`, `/mweb/v1/dreamina_subject/generate_voice` |
| Infinite canvas | `/mweb/v1/infinite_canvas/create_project`, `/mweb/v1/infinite_canvas/conversation`, `/mweb/v1/infinite_canvas/edit`, `/mweb/v1/infinite_canvas/resume`, `/mweb/v1/infinite_canvas/stop_stream`, `/mweb/v1/infinite_canvas/v1/fetch_snapshot`, `/mweb/v1/infinite_canvas/v1/submit_changeset`, `/mweb/v1/infinite_canvas/v1/fetch_changeset` |
| Reference/image tools | `/mweb/v1/get_common_config`, `/mweb/v1/get_image_description`, `/mweb/v1/get_upload_token`, `/mweb/v1/face_recognize`, `/mweb/v1/algo_proxy` |
| Template/research mining | `/mweb/v1/feed`, `/mweb/v1/get_explore`, `/mweb/v1/feed_short_video`, `/lv/v1/cc_web/replicate/search_templates`, `/lv/v1/cc_web/plane/*` |
| Assets/upload/editor | `/lv/v1/asset/*`, `/lv/v1/editor/image/*` |
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

## Useful Future Capture Targets

Capture one flow at a time:

- image reference upload
- image-to-image / byte edit
- subject/persona creation
- voice cloning and subject voice generation
- pose/style/depth/canny reference controls
- image-to-video first-frame
- multimodal/all-around reference video
- video text generation with current unified app route
- lip sync and voice/digital-human tools
- canvas edit operations: inpaint, erase, expand, cutout
- asset library search/import/export
- model/config endpoints for available GenAI tools
- explore/feed/template detail endpoints for niche research and template mining

## Safety Notes

- Keep generation concurrency at `1`.
- Dry-run before live submit.
- Stop on auth challenges, CAPTCHA, `ret=1019`, or `shark not pass`.
- Do not commit raw captures, session bundles, cookies, signed URLs, or generated media.
- Treat signed artifact URLs as expiring; download immediately into ignored `data/**`.
