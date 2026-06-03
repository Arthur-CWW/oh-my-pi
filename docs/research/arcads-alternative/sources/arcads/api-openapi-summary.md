# Arcads External API OpenAPI Summary

Source: https://external-api.arcads.ai/docs

Paths: 62
Schemas: 73

## Endpoints

### Actors

- `GET /v1/actors` — Get paginated actors w/ filters
- `GET /v1/actors/{actorId}/situations` — Get all situations for given actor

### Any Assets

- `POST /v1/assets/add-to-project` — Add an asset to a project
  - Associates an existing video asset with a project. **Features:** - Links a video asset to a specific project - Validates asset and project ownership - Supports both public and workspace-owned assets **Authentication:** Requires Basic Auth with client credentials **Note:** The asset must exist and be accessible to the workspace, and the project must belong to the workspace.
- `POST /v1/assets/remove-from-project` — Remove an asset from a project
  - Removes the association between a video asset and a project. **Features:** - Unlinks a video asset from a specific project - Validates asset and project ownership - Supports both public and workspace-owned assets **Authentication:** Requires Basic Auth with client credentials **Note:** The asset must exist and be accessible to the workspace, and the project must belong to the workspace. If the asset is not associated with the project, the operation will still succeed.
- `GET /v1/assets/{id}` — Get a video asset by ID
  - Retrieves a video asset by its unique identifier. **Features:** - Returns complete video asset information - Supports both public and workspace-owned assets - Includes URLs for video, thumbnail, and metadata **Authentication:** Requires Basic Auth with client credentials **Note:** The asset must exist and be accessible to the workspace (either owned by the workspace or public).
- `GET /v1/assets/{id}/watch` — Get asset watch link
  - Retrieves a direct download link for a video asset if it's fully generated. **Features:** - Returns a signed URL for direct download - Supports both public and workspace-owned assets - Validates asset generation status **Authentication:** Requires Basic Auth with client credentials **Note:** The asset must be fully generated (status: GENERATED) to get the download link.

### AudioDriven

- `POST /v1/audio-driven` — Trigger Audio driven generation

### B-Roll Assets

- `POST /v1/b-roll` — Create a B-roll video asset
  - Generate a B-roll video asset based on the provided prompt and parameters. **Features:** - Generate videos from text prompts - Support for reference images (base64 encoded) - Support for start frame images (base64 encoded) - Multiple aspect ratios (16:9, 1:1, 9:16) - Video durations of 5 or 10 seconds **Authentication:** Requires Basic Auth with client credentials **Note:** Either refImageAsBase64 OR startFrameAsBase64 can be provided, but not both.

### ElevenLabs

- `POST /v1/elevenlabs/credentials` — Create credentials for a workspace
  - Create credentials for a workspace
- `GET /v1/elevenlabs/credentials` — Get credentials for a workspace
  - Get credentials for a workspace
- `DELETE /v1/elevenlabs/credentials` — Delete ElevenLabs credentials for a workspace
  - Delete ElevenLabs credentials for a workspace
- `POST /v1/elevenlabs/trigger-import` — Trigger import of voices from ElevenLabs
  - Trigger import of voices from ElevenLabs

### File Upload

- `POST /v1/file-upload/get-presigned-url` — Generate presigned URL for file upload
- `POST /v1/file-upload/create-asset` — Create an asset from an uploaded file
  - Creates a media library asset from a file previously uploaded via the get-presigned-url endpoint. **Usage flow:** 1. Call `POST /v1/file-upload/get-presigned-url` to get a presigned URL and `filePath` 2. Upload the file directly to S3 using the presigned URL (PUT request) 3. Call this endpoint with the returned `filePath` and a `productId` to register the file as an asset **Authentication:** Requires Basic Auth with client credentials

### Folders

- `GET /v1/folders/{folderId}/scripts` — Get paginated scripts for given folder
- `GET /v1/folders/{folderId}` — Get folder by ID
- `PUT /v1/folders/{folderId}` — Update folder with given ID
- `DELETE /v1/folders/{folderId}` — Delete folder by ID
- `POST /v1/folders` — Create new folder within product

### Health

- `GET /health` — 
- `GET /health/release` — 
- `GET /health/timeout-test` — 

### Images v2

- `POST /v2/images/generate` — Trigger image generation

### OmniHuman

- `POST /v1/omnihuman` — Trigger Omnihuman generation

### Presets

- `GET /v1/presets` — List available preset types
- `GET /v1/presets/{presetType}/templates` — List available templates for a preset type
- `POST /v1/presets/camera-movement/generate` — Trigger Camera Movement preset generation
- `POST /v1/presets/fashion-tryon/generate` — Trigger Fashion Try-On preset generation
- `POST /v1/presets/gestures/generate` — Trigger Gestures preset generation
- `POST /v1/presets/product-showcase/generate` — Trigger Product Showcase preset generation
- `POST /v1/presets/showyourapp/generate` — Trigger Showyourapp preset generation
- `POST /v1/presets/unboxing-pov/generate` — Trigger Unboxing POV preset generation
- `POST /v1/presets/gameplay-ad/generate` — Trigger Gameplay Ad preset generation

### Products

- `GET /v1/products/{productId}/folders` — Get paginated folders for given product
- `GET /v1/products` — Get paginated products for your workspace
- `POST /v1/products` — Create new product
- `GET /v1/products/{productId}` — Get product by ID
- `PUT /v1/products/{productId}` — Update product with given ID
- `DELETE /v1/products/{productId}` — Delete product by ID

### Projects

- `POST /v1/projects` — Create a new project
  - Create a new project within a specified folder.
- `GET /v1/projects/{projectId}` — Get project by ID
  - Retrieve a project by its ID.
- `PUT /v1/projects/{projectId}` — Update project
  - Update an existing project name.
- `DELETE /v1/projects/{projectId}` — Delete project
  - Delete an existing project and all its associated scripts.

### Scene Assets

- `POST /v1/scene` — Create a scene video asset
  - Generate a scene video asset based on the provided script, prompt and parameters. **Features:** - Generate videos from text scripts and prompts - Support for context scripts and prompts for continuity - Support for reference images (base64 encoded) - Support for start frame images (base64 encoded) - Multiple aspect ratios (16:9, 1:1, 9:16) - Optional project association **Authentication:** Requires Basic Auth with client credentials **Note:** Either refImageAsBase64 OR startFrameAsBase64 can be …

### Scripts

- `GET /v1/scripts/{scriptId}/videos` — Get videos for given script
- `GET /v1/scripts/{scriptId}` — Get script by ID
- `PUT /v1/scripts/{scriptId}` — Update script with given ID
- `DELETE /v1/scripts/{scriptId}` — Delete script by ID
- `POST /v1/scripts` — Create new script within folder or project
  - Create a new script. You can specify either: - folderId only: A new project will be created in that folder - projectId only: The script will be added to the existing project - Both folderId and projectId: The script will be added to the project, but only if the project belongs to that folder At least one of folderId or projectId must be provided.
- `POST /v1/scripts/{scriptId}/generate` — Trigger videos generation for the given script
- `POST /v1/scripts/{scriptId}/duplicate` — Duplicate script w/ given ID
- `POST /v1/scripts/{scriptId}/new-version` — Create new version of script w/ given ID
- `POST /v1/scripts/{scriptId}/generate-omnihuman` — Trigger omnihuman generation for the given script

### Situations

- `GET /v1/situations` — Get paginated situations w/ filters
- `GET /v1/situations/mine` — Get paginated situations linked to workspace
- `GET /v1/situations/{situationId}` — Get situation by ID

### Sora2

- `POST /v1/sora2/generate/video` — Trigger Sora2 text-to-video generation
  - Optional reference image: either upload via `POST /v1/file-upload/get-presigned-url` and pass `refImageFilePath`, or pass `refImageAsBase64`. When both are sent, `refImageFilePath` wins.
- `POST /v1/sora2/remix/video` — Trigger Sora2 video-to-video remix

### Talking Actors v2

- `POST /v2/talking-actors/generate` — Generate talking actor videos
- `GET /v2/talking-actors/{id}` — Get talking actor generation status
- `GET /v2/talking-actors/{id}/watch` — Get talking actor watch URL

### Veo31

- `POST /v1/veo31/generate/video` — Trigger Veo31 text-to-video generation

### Videos

- `GET /v1/videos/{videoId}` — Get video by ID
- `PUT /v1/videos/{videoId}` — Update video with given ID
- `DELETE /v1/videos/{videoId}` — Delete video by ID
- `POST /v1/videos` — Create new video for given script
- `GET /v1/videos/{videoId}/watch` — Get video watch link

### Videos v2

- `POST /v2/videos/generate` — Trigger video generation

### Voices

- `GET /v1/voices/{voiceId}` — Get voice by ID
- `GET /v1/voices` — Get paginated voices w/ filters
- `DELETE /v1/voices/mine` — Delete all workspace voices

### WorkflowRunsPublic

- `GET /v1/workflows/runs/{runId}` — 

### WorkflowWebhook

- `POST /v1/workflows/{workflowId}/webhook` — 

### Workflows

- `GET /v1/workflows/{workflowId}/runs` — 
- `POST /v1/workflows/notion/generate-video-from-script-template` — 

## Model/enums clues

- `sora2` appears in OpenAPI spec
- `sora2-pro` appears in OpenAPI spec
- `veo31` appears in OpenAPI spec
- `kling-2.6` appears in OpenAPI spec
- `kling-3.0` appears in OpenAPI spec
- `grok-video` appears in OpenAPI spec
- `seedance` appears in OpenAPI spec
- `seedance-2.0` appears in OpenAPI spec
- `omnihuman` appears in OpenAPI spec
- `audio-driven` appears in OpenAPI spec
- `elevenlabs` appears in OpenAPI spec

## Key schema details for replication

### Image generation (`POST /v2/images/generate` / `CreateImageDto`)

Models exposed by Arcads API:

- `gpt-image`
- `gpt-image-2`
- `nano-banana`
- `nano-banana-2`
- `soul`
- `grok_image`
- `seedream`
- `seedream_5_lite`

Reference image limits listed in the API schema:

- `gpt-image`: 5
- `gpt-image-2`: 5
- `nano-banana`: 14
- `nano-banana-2`: 14
- `soul`: 0
- `grok_image`: 1
- `seedream`: 4
- `seedream_5_lite`: 4

### Video generation (`POST /v2/videos/generate` / `CreateVideoDto`)

Models exposed by Arcads API:

- `sora2`
- `sora2-pro`
- `veo31`
- `kling-2.6`
- `kling-3.0`
- `grok-video`
- `seedance`
- `seedance-2.0`
- `happy-horse`

Model-specific constraints from the schema:

- Duration: `sora2/sora2-pro` = 4/8/12/16/20s; `kling-2.6` = 5/10s; `kling-3.0` = 3-15s; `grok-video` = 1-15s; `seedance` = 4-12s; `seedance-2.0` = 4-15s; `veo31` not applicable.
- Resolution: `sora2/sora2-pro` = 720p/1080p; `veo31` = 720p/1080p/4K; `grok-video` = 480p/720p; `seedance` = 480p/720p/1080p; `seedance-2.0` = 480p/720p.
- Reference images: `sora2` = 1; `sora2-pro` = 1; `veo31` = 3; `seedance` = 1; `seedance-2.0` = 3; `happy-horse` = 1.
- Reference videos/audio: `seedance-2.0` only, max 3 each.
- Start frame supported by: `veo31`, `kling-2.6`, `kling-3.0`, `grok-video`.
- End frame supported by: `veo31`, `kling-2.6`, `kling-3.0`, `seedance`.
- `seedance-2.0` has optional `audioEnabled`.

### Talking actors (`POST /v2/talking-actors/generate`)

Talking-actor models exposed by API:

- `arcads_1.0`
- `audio_driven`
- `omnihuman`

Input structure:

- `script` or `referenceAudios`
- `actors[]` with `situationId` and `voiceId`
- `autoAddScriptEmotion`

Voice IDs can be internal or external provider IDs such as ElevenLabs.

### Preset/template categories

API exposes presets for:

- camera movement
- fashion try-on
- gestures
- product showcase
- show-your-app
- unboxing POV
- gameplay ad

Situation/template metadata includes tags, emotions, accessories, camera angle, actor association, and booleans such as `talkingActorEnabled`, `showYourAppEnabled`, `unboxingPovEnabled`, `brollSora2Enabled`, `fashionTryOnEnabled`, `productShowcaseEnabled`, `gesturesEnabled`, and `cameraMovementEnabled`.
