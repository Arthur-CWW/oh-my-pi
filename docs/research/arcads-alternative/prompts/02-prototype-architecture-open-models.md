# GPT Pro Prompt 02 — Build an Arcads-like prototype with open models/APIs

You are my senior AI video systems architect. I want a concrete, buildable blueprint for a fast Arcads.ai-style alternative using open models and commodity APIs, designed for a modular graph/layer video pipeline.

Use deep research/web browsing as needed. Be practical and opinionated.

## Repo context

TypeScript/Bun monorepo. Relevant current packages:

- `packages/web-access`: Pi tools for web search, fetching content, YouTube transcripts, Chrome cookies, frontend LLM browser sessions, Codex imports.
- `packages/jimeng-client`: Jimeng/Dreamina direct API helpers.
- `packages/twitter-archive`: local-first Twitter/X archive package skeleton.
- `apps/tweet-viewer`: future archive viewer.

Video direction:

- Build modular, editable, reversible video-generation pipeline.
- More like ComfyUI graph nodes + video-editor layers than one-shot prompt.
- Components must be separately editable, inspectable, replaceable, cacheable, reusable.
- Never ask image/video models to render final readable text; captions/text overlays happen in post.
- Every asset should carry metadata/provenance/model/prompt/tags/vibe/intended use.
- Future asset DB target: SQLite catalog.

Desired pipeline:

inspiration archive -> format decomposition -> script/hook/dialogue -> character/persona assets -> product assets -> backgrounds/scenes -> motion/video generation -> TTS/audio -> lipsync/fake mouth motion -> subtitles/text overlays -> filters/effects -> final render -> model/human analysis -> remix.

## Arcads evidence already found

Arcads public API/docs expose:

- Product/project/folder/script/video/asset model.
- Actors + situations/templates.
- Voices, including ElevenLabs credential import.
- Presigned upload + asset watch/download links.
- Workflows/runs/webhooks.
- Presets: camera movement, fashion try-on, gestures, product showcase, show-your-app, unboxing POV, gameplay ad.
- Image models: `gpt-image`, `gpt-image-2`, `nano-banana`, `nano-banana-2`, `soul`, `grok_image`, `seedream`, `seedream_5_lite`.
- Video models: `sora2`, `sora2-pro`, `veo31`, `kling-2.6`, `kling-3.0`, `grok-video`, `seedance`, `seedance-2.0`, `happy-horse`.
- Talking actor models: `arcads_1.0`, `audio_driven`, `omnihuman`.
- Prompt enhancer uses Claude.
- Voice IDs support internal IDs or external provider IDs like ElevenLabs.

Arcads product features:

- 1,000+ actor library;
- custom actors / clone yourself;
- product in hand / show app / wear clothes;
- talking actors up to long-ish videos;
- B-roll, captions, music, transitions;
- translations/localization;
- unboxing POV;
- replace actor;
- workflow node canvas;
- batch variants;
- ad hook/repurposer tools;
- marketing agent / competitor ad repurposer.

## My resources/preferences

- Main Mac is source-of-truth dev machine.
- RTX 3090 desktop can be used later for local ComfyUI/open model experiments.
- Existing Jimeng/Dreamina direct client work exists.
- TypeScript/Bun preferred.
- Avoid native modules unless isolated.
- SQLite for local asset catalog.
- Use post-production text/captions with ffmpeg/Remotion-like rendering.

## Deliverables

Design a practical implementation blueprint.

### 1. Proposed architecture

Give a clean system design:

- packages/apps to add in this repo;
- services/modules;
- local data directories;
- SQLite schema concepts;
- job queue/orchestration;
- provider abstraction;
- rendering/compositing;
- asset catalog;
- workflow graph format.

Use a graph/layer architecture, not monolithic SaaS slop.

### 2. Feature-by-feature implementation matrix

Table:

Feature | MVP behavior | Internal graph nodes | Data model | API/open model options | Fastest prototype | Better v1 | Difficulty | Risks

Include:

- product URL/page ingestion;
- product image upload;
- script/hook generator;
- format/template library;
- reference-video/slideshow decomposition;
- AI persona/actor library;
- custom actor image generation;
- user-uploaded actor video ingestion;
- talking-head/lipsync;
- voice/TTS/voice clone;
- product-in-hand image/video;
- app-screen video;
- unboxing POV;
- B-roll generator;
- captions/subtitles;
- translations;
- replace actor / character swap;
- batch variants;
- workflow canvas/CLI recipes;
- final render/export;
- metadata/provenance;
- analytics feedback loop.

### 3. Model/API menu

For each task rank:

1. fastest viable prototype;
2. best quality API;
3. best open/local option;
4. cheapest scalable option.

Tasks:

- LLM planning/script/hooks;
- product page parsing;
- image generation/editing/consistent character;
- video generation/image-to-video;
- video-to-video/control/reference motion;
- talking-head/lipsync;
- TTS;
- voice cloning;
- captions/transcription;
- translation;
- segmentation/background removal;
- compositing/rendering;
- analytics/scoring.

Include specific vendors/open models: OpenAI, Anthropic, Gemini, Replicate/Fal/Runpod, ElevenLabs, PlayHT/Cartesia, Whisper, Coqui/XTTS, SadTalker/Wav2Lip/LivePortrait/MuseTalk/etc if relevant, Wan/Seedance/Kling/Veo/Sora/Higgsfield/Dreamina/Jimeng/ComfyUI candidates, Remotion/ffmpeg, etc. Be current and verify.

### 4. 48-hour prototype

Goal: demo end-to-end product -> 3-5 vertical AI UGC ad variants.

Give:

- exact scope;
- CLI commands to build;
- providers to use;
- folder/data layout;
- minimal schema;
- video recipe format;
- render stack;
- expected output;
- shortcuts.

### 5. 1-week prototype

Goal: real internal tool with reusable assets/templates, queue, metadata, repeatable renders.

Give milestones/day-by-day.

### 6. 1-month MVP

Goal: Arcads-like internal product with persona library, templates, batch variants, editor-lite/workflow-lite.

Give architecture and roadmap.

### 7. Concrete repo tasks

Return the next 20 engineering tasks in dependency order, with file/package names.

Assume I can implement in TypeScript/Bun. Include example schemas/YAML where helpful.

Be very specific. Avoid generic architecture fluff.
