# GPT Pro Prompt 01 — Arcads product/stack/model teardown

You are my senior AI product + systems research partner. Use web browsing/deep research. Be evidence-backed and clean-room.

I want to build an alternative to Arcads.ai: AI UGC ads, AI actors/influencers, product-to-video, template/format cloning, script/hook generation, captions, voices, lipsync, batch variants, workflows, and editor-lite.

## Repo/project context

I am working in a TypeScript/Bun monorepo (`pi-web-access` / `pi-workflows`) with web research tools, a Jimeng/Dreamina client, Twitter/X archive work, and future video asset catalog/workflow packages.

North star: modular graph/layer pipeline, closer to ComfyUI + video editor layers than a one-shot video generator.

Pipeline should separate:

- product intake / product page ingestion
- script/hook generation
- format/template decomposition
- persona/actor/character assets
- product images/app screenshots
- generated images / b-roll / scenes
- voice/TTS
- lipsync/talking-head generation
- captions/text overlays in post
- effects/transitions
- final render
- metadata/provenance/analytics

Clean-room constraints:

- Use public sources only.
- Do not infer private internals as fact.
- Separate evidence vs inference vs speculation.
- Clone high-level format mechanics and workflows, not private identities/protected media/trademarks.

## Public sources to browse first

Arcads official/public:

- https://www.arcads.ai/
- https://www.arcads.ai/features/ai-ugc-video
- https://www.arcads.ai/features/ai-avatars
- https://www.arcads.ai/features/text-to-speech
- https://www.arcads.ai/features/speech-to-speech
- https://www.arcads.ai/features/facebook-ai-ads-generator
- https://www.arcads.ai/features/ai-lipsync
- https://www.arcads.ai/features/ai-product-video-generator
- https://www.arcads.ai/features/batch-creations
- https://www.arcads.ai/features/ai-actors
- https://www.arcads.ai/features/ai-ads
- https://www.arcads.ai/features/ai-video-generator
- https://www.arcads.ai/features/ai-shorts-generator
- https://www.arcads.ai/features/ai-content-generator
- https://www.arcads.ai/features/ai-video-api
- https://www.arcads.ai/features/ai-lip-sync-api
- https://www.arcads.ai/features/talking-avatar-ai
- https://www.arcads.ai/use-cases/ad-creative-testing
- https://www.arcads.ai/industries/e-commerce
- https://www.arcads.ai/industries/saas
- https://www.arcads.ai/industries/mobile-apps
- https://www.arcads.ai/blog/arcads-raises-16m-seed
- https://external-api.arcads.ai/docs

Arcads help center:

- https://intercom.help/arcads/en/
- https://intercom.help/arcads/en/collections/7500987-how-to-use-arcads-platform
- https://intercom.help/arcads/en/collections/11661632-how-to-use-the-arcads-api
- https://intercom.help/arcads/en/articles/10538922-arcads-ai-api-documentation
- https://intercom.help/arcads/en/articles/14531683-getting-started-with-arcads
- https://intercom.help/arcads/en/articles/14284875-what-is-the-workflow-feature
- https://intercom.help/arcads/en/articles/13281882-how-to-show-a-product-in-a-video
- https://intercom.help/arcads/en/articles/13239650-how-to-create-a-talking-actor-video-no-product
- https://intercom.help/arcads/en/articles/13239662-how-to-clone-yourself-into-a-talking-actor
- https://intercom.help/arcads/en/articles/13240351-how-to-create-a-custom-talking-actor
- https://intercom.help/arcads/en/articles/13244238-how-to-replace-an-actor-from-an-existing-video
- https://intercom.help/arcads/en/articles/13573182-how-to-generate-ugc-studio-images
- https://intercom.help/arcads/en/articles/13725589-how-are-credits-counted

Arcads tools/funnels:

- https://get.arcads.ai/
- https://get.arcads.ai/hook-generator
- https://tools.arcads.ai/
- https://tools.arcads.ai/repurpose-facebook-ad
- https://tools.arcads.ai/spy-agent
- https://try.arcads.ai/ai-avatar-video-generator
- https://try.arcads.ai/ai-video-ads-generator

External reviews/comparisons to cross-check claims:

- https://creatify.ai/review/arcads-ai
- https://diyai.io/ai-tools/video-generation/reviews/arcads-review/
- https://www.marketermilk.com/blog/arcads-review
- https://www.eesel.ai/blog/arcads-ai-pricing
- https://www.airpost.ai/blog/arcads-features-pricing-and-alternatives
- https://www.gohighlevel.ai/reviews/arcads-review
- https://www.codingem.com/arcads-ai-review/
- https://genesysgrowth.com/blog/arcads-ai-vs-makeugc.ai-vs-affogato-ai
- https://www.ezugc.ai/blog/arcads-ai

## Evidence already found locally

Arcads public pages/help/API indicate:

- library of 1,000+ AI actors, custom AI avatars/actors;
- create actors holding products, showing apps, wearing clothes;
- choose AI model by creative goal;
- edit, translate, extend, subtitle, upscale, remix videos;
- ready-made ad presets/performance formats;
- B-rolls, music, captions, transitions;
- emotion control via prompt;
- translation/localization in 30+ languages;
- workflow canvas/node system;
- marketing agent/tools to repurpose winning Facebook ads and analyze competitor ads;
- blog says Arcads was founded in 2024, raised $16M seed, serves 6,000+ clients worldwide.

Arcads external API docs expose:

- Products, folders, projects, scripts, videos, actors, situations/templates, voices, assets, presigned uploads, workflows/webhooks.
- ElevenLabs credentials/import endpoints.
- Presets: camera movement, fashion try-on, gestures, product showcase, show-your-app, unboxing POV, gameplay ad.
- Image models: `gpt-image`, `gpt-image-2`, `nano-banana`, `nano-banana-2`, `soul`, `grok_image`, `seedream`, `seedream_5_lite`.
- Video models: `sora2`, `sora2-pro`, `veo31`, `kling-2.6`, `kling-3.0`, `grok-video`, `seedance`, `seedance-2.0`, `happy-horse`.
- Talking actor models: `arcads_1.0`, `audio_driven`, `omnihuman`.
- API schema says prompt enhancement uses Claude and costs extra credits.
- Talking actor generation takes script/reference audio + actors with `situationId` and `voiceId`.

## Deliverables

Produce an extensive but structured teardown.

### 1. Executive summary

- What Arcads is actually selling.
- What is commodity model aggregation vs product moat.
- What we should replicate first.

### 2. Product/workflow teardown

Feature-by-feature table:

Feature | User-facing behavior | Evidence/source | Likely backend objects | Likely models/vendors | Replication priority | Notes

Include:

- product upload/product-to-ad;
- AI actor library;
- custom actor/avatar;
- clone-yourself/talking actor;
- UGC Studio;
- product in hand / app screen;
- text-to-speech / speech-to-speech / voice cloning;
- lipsync/talking-head;
- captions/subtitles;
- translation/localization;
- B-roll generation;
- unboxing POV;
- replace actor;
- video editing/add-swap-remove;
- workflow canvas/nodes;
- API;
- batch creation;
- hook generator/repurposer;
- competitor-ad repurposer/spy agent;
- analytics/creative testing.

### 3. Likely technical architecture

Infer a clean architecture:

- frontend app/editor/workflow canvas;
- backend API;
- auth/org/workspaces/billing;
- products/projects/folders/scripts/videos/assets;
- object storage/CDN;
- job queue/orchestration;
- provider/model router;
- render/compositing;
- captions/text overlays;
- media processing;
- voice/TTS/lipsync;
- template/situation library;
- analytics/feedback;
- moderation/safety.

For each, give evidence vs inference and confidence.

### 4. Model/vendor map

For each task, list:

- what Arcads publicly exposes or probably uses;
- possible vendor/API behind it;
- open-source/local alternative;
- best prototype choice;
- cost/latency/quality tradeoff.

Tasks:

- LLM/script/hook generation;
- prompt enhancement;
- product-page ingestion;
- image generation;
- image editing;
- video generation;
- video-to-video/remix;
- start/end-frame video;
- talking-head/lipsync;
- TTS/voice cloning;
- captions/subtitles;
- translation;
- background removal/segmentation;
- object/video edit;
- render/composition.

### 5. What is important to replicate

Rank all features by impact for an Arcads alternative:

P0/P1/P2, with rationale.

### 6. Unknowns and manual checks

List what I should verify manually by signing up / using product / checking network / trying API docs.

Be opinionated. Cite sources. Do not hallucinate private internals.
