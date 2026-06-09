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
| `/mweb/v1/video_generate/get_common_config` | POST | Video model/common configuration by scene. | Cataloged only |
| `/mweb/v1/get_user_local_item_list` | POST | User local/generated item lists. | Cataloged only |
| `/mweb/v1/feed` | POST | Explore/feed content. Useful for research/template mining if handled carefully. | Cataloged only |
| `/mweb/v1/get_explore` | POST | Explore examples and public creative templates. | Cataloged only |
| `/mweb/v1/get_unread_count` | POST | Notification count. | Low priority |

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
