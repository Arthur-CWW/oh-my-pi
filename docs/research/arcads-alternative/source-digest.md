# Arcads Alternative Research Digest

Generated: 2026-06-04 local / 2026-06-03 UTC.

This is the handoff digest for GPT Pro / future Pi sessions. It summarizes the local Markdown archive and public evidence collected so far.

## Source archive

- Arcads source archive: `docs/research/arcads-alternative/sources/arcads/README.md`
- Arcads external API OpenAPI summary: `docs/research/arcads-alternative/sources/arcads/api-openapi-summary.md`
- Raw Arcads external OpenAPI JSON: `docs/research/arcads-alternative/sources/arcads/raw-api/openapi.json`
- Alex Nguyen X article archive: `docs/research/arcads-alternative/sources/alex/README.md`
- Source URL manifest: `docs/research/arcads-alternative/arcads-source-urls.txt`

## Clean-room constraint

Build a similar/better modular workflow from public behavior, public docs, public API descriptions, and first principles. Do not steal code, bypass paywalls, clone private identities, copy trademarks, or re-upload/copy protected videos. For UGC/reference-video work, clone structure/format mechanics, not exact identity/media.

## Arcads product claims and feature surface

Public Arcads pages and help center indicate Arcads is an all-in-one AI ad/video platform for performance marketers, D2C/ecommerce, mobile apps, SaaS, and agencies.

Core user-facing claims/features:

- Create better video ads with AI.
- Library of 1,000+ AI actors, plus custom AI avatar/actor creation.
- Generate a face and make it hold your product, show your app, or wear your clothes.
- Choose model based on creative goal: cinematic video, realistic product visuals, talking actors, etc.
- Edit/translate/extend/subtitle/upscale/remix videos with AI tools.
- Start from proven ad formats/presets.
- Add B-rolls, music, captions, and transitions in one click.
- Emotion control: write how the actor should behave/speak.
- Localize/translate into 30+ languages with lip-sync.
- Batch variant generation and workflows for scale.
- Workflow canvas/node system for automating content pipelines.
- Marketing agent / tools that repurpose winning Facebook ads, run spy-agent style competitor analysis, generate hook variants, and generate UGC packages.
- Blog claims: founded in 2024, $16M seed, 6,000+ clients worldwide, focused on automated marketing videos from AI actors.

## Arcads help-center workflow decomposition

Getting Started flow:

1. Upload product image.
2. Generate images in desired context/aesthetic.
3. Turn images into talking videos via Talking Actor.
4. Add movement or create B-roll clips.
5. Translate/localize content.
6. Use Workflows to automate production at scale.

Workflow feature:

- Workflows are built from nodes: inputs, models, tools.
- Reuse assets: actors, products, prompts.
- Example workflows include:
  - Generate multiple UGC ads automatically from one actor/product/script across voices/languages.
  - Recreate one video with multiple actors.
  - Recreate B-roll with multiple actor faces.
  - Generate B-roll ideas/prompts from talking-head ads via LLM.
  - Cinematic transitions using start/end frames.
  - Batch character replacement: one source video -> 4 new AI characters, same script/timing, different faces/voices.
  - UGC content engine: one script + one product image -> 20 clips across 10 characters and 2 languages.
  - Clothing brand film from product/lifestyle images using start/end frames.
  - Creator cloner / digital twin.

Important product-specific features from help center:

- Product-in-video: create custom actor holding product; use audio-driven talking actor, Sora 2 Pro, Veo 3.1 depending on use case.
- Show-your-app: actor presenting app screen / app screenshot.
- Extend video: model length limits; stitch/extend clips.
- Captions: automatic captions.
- Unboxing POV: single product image -> realistic unboxing video in first-person/creator POV templates.
- Fashion try-on.
- Skin enhancer for AI faces.
- Clone yourself/custom talking actor from video, PRO plan; appearance + voice; training takes ~2-4 hours.
- Custom talking actor from generated image, prompt, or clone option.
- Kling o1 video editor for adding/swapping/removing elements.
- Background removal for image/video.
- Hook repurposer to recreate proven viral hooks with own product/brand.
- Replace Actor: swap subject in existing video while preserving motion/timing/background/camera movement.
- Languages/translation and pronunciation guide.
- Gestures: preset expressive motion clips for hooks/B-roll/reactions.
- Multiple camera angles from reference image.
- UGC Studio: generate aesthetic organic-looking UGC creators, then turn into videos with Veo 3.1.
- Credits model across tools.

## Arcads exposed API / model evidence

Arcads public external API docs at `https://external-api.arcads.ai/docs` embed an OpenAPI spec. Local extraction saved it.

Architectural API objects/endpoints:

- Products, folders, projects, scripts, videos.
- Actors and situations/templates.
- Voices, including ElevenLabs credentials import.
- Assets, presigned upload, direct watch/download links.
- Image generation, video generation, talking actors, audio-driven, omnihuman, b-roll, scene assets.
- Presets: camera movement, fashion try-on, gestures, product showcase, show-your-app, unboxing POV, gameplay ad.
- Workflow runs and workflow webhooks.

Image models exposed by API:

- `gpt-image`
- `gpt-image-2`
- `nano-banana`
- `nano-banana-2`
- `soul`
- `grok_image`
- `seedream`
- `seedream_5_lite`

Video models exposed by API:

- `sora2`
- `sora2-pro`
- `veo31`
- `kling-2.6`
- `kling-3.0`
- `grok-video`
- `seedance`
- `seedance-2.0`
- `happy-horse`

Talking actor models exposed by API:

- `arcads_1.0`
- `audio_driven`
- `omnihuman`

Other model/tool evidence from docs:

- ElevenLabs voice import/credentials are exposed.
- Kling o1 video editor is named in help center for add/swap/remove video edits.
- Help docs mention Sora 2/Sora 2 Pro, Veo 3.1, Kling 2.6/3.0, Seedance 1.5/2.0, Happy Horse, OmniHuman 1.5, Audio-Driven, Arcads 1.0.
- API schema mentions `prompt_enhancer` and says enhance costs additional credits and is done by Claude.

Useful constraints from OpenAPI:

- Video durations: Sora2/Sora2 Pro 4/8/12/16/20s; Kling 2.6 5/10s; Kling 3.0 3-15s; Grok Video 1-15s; Seedance 4-12s; Seedance 2.0 4-15s.
- Resolutions: Sora2/Sora2 Pro 720p/1080p; Veo31 720p/1080p/4K; Grok 480p/720p; Seedance 480p/720p/1080p; Seedance 2.0 480p/720p.
- Start frame: Veo31, Kling 2.6/3.0, Grok Video.
- End frame: Veo31, Kling 2.6/3.0, Seedance.
- Seedance 2.0 supports reference videos/audio and optional audio output.
- Talking actors take script or reference audio plus actor situation IDs and voice IDs.

## Initial Arcads replication thesis

Arcads is likely not one model. It is a model-router + asset/project system + template/situation library + video workflow canvas + editor/compositor + batch generation UX.

The core moat is probably:

- curated actor/situation/template library;
- reliable UX around model quirks;
- batch workflow/orchestration;
- performance-marketer-specific presets;
- fast iteration from product/ad idea to many variants;
- asset organization and reuse;
- integrations with voice, localization, captioning, and downloads.

Prototype advantage for us: build graph/layer architecture from the start, preserve provenance, use local asset catalog, make format templates reusable, and choose cheaper/open models per node.

## Alex Nguyen article archive / pipeline summaries

These X articles were recovered from Arthur's Firefox open tabs/history and downloaded as Markdown via X article GraphQL. Key files are in `docs/research/arcads-alternative/sources/alex/`.

### AI influencer realism

`2020883184922324994-how-to-generate-ai-influencers-that-actually-look-real.md`

- Uses Grok Imagine + Arcads as a combo.
- Reality > perfection: avoid polished AI-face gloss; use imperfect creator-style framing.
- Prompting framework: lock identity, environment, camera/lighting, realistic details.
- JSON prompt format for AI influencer portraits.

### OpenClaw AI influencer factory

`2027386287091777694-how-to-create-ai-influencer-content-at-scale-with-openclaw-step-by-step.md`

- Arcads for video production, OpenClaw for orchestration.
- Persona blueprints: identity, belief system, voice/tone, signature hooks.
- Content pillars with 20-50 angles, hook formats, CTAs.
- Batching actors/hooks/scripts.
- Phases: validate one persona -> actor variation -> persona expansion -> multi-niche scaling.

### OpenClaw + Arcads + Postiz content automation

`2029237187599036671-automating-tiktok-instargram-content-with-openclaw-a-step-by-step-workflow.md`

- Pipeline: OpenClaw generates scripts and manages strategy; Arcads API creates realistic UGC videos; Postiz schedules/cross-posts.
- Phases: content strategy/script generation -> video generation -> scheduling/publishing -> analytics/optimization.
- This is close to a productized Arcads alternative architecture.

### Claude Cowork + Arcads + Postiz

`2032116202517250523-automating-tiktok-instargram-youtube-short-content-with-claude-cowork-a-step-by-.md`

- Claude Cowork as content strategist with web/local files.
- Arcads as virtual production studio: talking heads, actors, languages, batch creation.
- Postiz as distribution command center.
- Trend research, batch scripts, script optimization, actor selection, scheduling.

### TikTok phone/account setup

`2043742702349758728-step-by-step-phone-setup-for-tiktok-to-target-us-or-any-country-users-and-proper.md`

- Mostly operational/platform-targeting tactics and account warmup.
- For our system, treat this as risk context only. Do not implement platform evasion or ToS-violating fake geography/account farming. Extract only safe principles: don't spam, publish like a normal human, use drafts/manual review for new accounts, monitor account health.

### AI cost/routing playbook

`2044454751556014113-my-2-apps-have-390k-users-with-ai-and-my-total-bill-is-only-1-679-month-here-s-m.md`

- Route simple tasks to cheap models, medium tasks to mid models, complex tasks to frontier.
- Cache, batch, debounce, self-host where appropriate.
- Prompt engineering is cost engineering.
- DeepInfra for speech models mentioned.
- Useful for prototype cost design.

### Slideshow automation: Claude Opus 4.7 / 4.8 / Codex GPT-5.5 / Hermes

Key files:

- `2044820024695947654-how-to-automate-tiktok-slideshow-content-creation-with-claude-opus-4-7-step-by-s.md`
- `2047715075457507452-automating-tiktok-slideshow-content-with-codex-gpt-5-5-and-chatgpt-images-2-0-st.md`
- `2054605442945569184-how-to-automate-tiktok-slideshow-content-creation-with-hermes-agent-step-by-step.md`
- `2061841430684016678-how-to-create-tiktok-slideshow-content-with-claude-opus-4-8-step-by-step-guide.md`

Common pipeline:

1. Find viral slideshow examples.
2. Download/decompose slides (`snaptik` in articles).
3. Ask LLM to extract hook structure, slide text, visual style, image descriptions, caption/hashtags.
4. Make every slide a mini-hook.
5. Generate key images with ChatGPT/GPT image; use Pinterest/real photos/stock for vibe slides to reduce AI slop and cost.
6. Compose slides deterministically with Canvas/Sharp/Canva; never ask image model to render final text.
7. Schedule via Postiz, usually drafts for safety/manual review.
8. Use format schemas and queues to scale variations.

Important for our project: the slideshow pipeline is exactly a format-template/asset-layer pipeline.

### Easiest AI influencer that sells product/app

`2045853080034672683-the-easiest-way-to-build-an-ai-influencer-that-sells-your-app-or-any-product.md`

- Build a consistent character with JSON prompt from Nano Banana/reverse-engineered successful accounts.
- Animate with restraint in Veo 3: micro-motion, not dramatic AI slop.
- Add hook/voice in Arcads.
- Funnel: AI influencer -> hook -> app/product reason -> installs.

### Multiple AI influencers for TikTok

`2050691099241668993-how-to-create-multiple-ai-influencers-to-market-on-tiktok-step-by-step-simple-gu.md`

- Organic content requires high volume; create many AI influencers/personas.
- Nano Banana/Grok Imagine/Arcads used for unique faces/personas.
- Realism beats perfection.
- Prompt like an engineer with structured JSON.
- Turn images into videos; remix proven hooks, don't copy exact posts.

### Massive AI influencer content / case study

`2056060717942677643-how-to-create-massive-ai-influencer-content-at-scale-step-by-step-guide-case-stu.md`

- Create realistic AI influencers with JSON prompts.
- Build full workflow inside Arcads.
- Start with proven reference video.
- Use Kling Motion Control inside Arcads.
- Match AI character to reference video.
- Generate before/after variants, multiple hooks, app as reason behind result.

### AI UGC/brainrot system with Hermes

`2059393202080407726-how-to-build-an-ai-ugc-brainrot-system-that-can-generate-100m-views-with-hermes-.md`

- Analyze winning videos, extract reusable templates, generate hundreds of variations across subjects/personas.
- Agent handles prompt libraries, captions/CTAs, production queues, performance tracking, and self-improving loop.
- Important for brainrot/StudyTok/productized format cloning.

## Suggested research decomposition for GPT Pro

Queue separate prompts instead of one giant one:

1. Arcads product/stack/model teardown.
2. Open/open-API replication architecture and prototype plan.
3. Alex pipeline/UGC format factory synthesis.
4. Model/API vendor menu and cost/quality/speed tradeoffs.
5. Product boundaries, defensible strategy, and moat.

## Desired output style from GPT Pro

Ask GPT Pro to separate:

- public evidence;
- inference;
- speculation;
- confidence levels;
- what to verify manually.

Ask for feature-by-feature tables and implementation tasks for this repo.
