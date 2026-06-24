# ASMR Companion + Seedance Video Pipeline

Generated: 2026-06-24

## Scope

Design a modular pipeline for:

1. an Airi-like AI companion / AI girlfriend with realtime voice, avatar, memory, and ASMR-style 3D audio; and
2. an offline short-video pipeline that uses Seedance/Dreamina/Jimeng for image-to-video while removing the quality-degrading Gemini/SynthID-style image tagging or pixel round-trip before video generation.

Authorization / source posture: public open-source repositories, public docs, local repo docs/data, local browser history metadata, and local tweet archives only. No provider calls, no paid generation, and no authenticated scraping were run during this planning pass. reverse-SynthID/Synthid-Bypass were inspected as open-source references for a future image-conditioning stage.

## Inputs inspected

- Project AIRI: `https://github.com/moeru-ai/airi`
- Sonic talking portrait: `https://github.com/jixiaozhong/Sonic`
- SynthID research history entries:
  - `https://github.com/aloshdenny/reverse-SynthID`
  - `https://github.com/cebeuq/Synthid-Bypass`
  - `https://github.com/00quebec/Synthid-Bypass`
- Pleometric post: `https://x.com/pleometric/status/2055420576714408309`
- Local Pleometric report: `data/twitter-archive/pleometric-research/workflow-findings.md`
- Existing workflow: `workflows/tiktok-recreate/README.md`, `workflows/tiktok-recreate/workflow.js`
- Existing renderer: `packages/remotion-renderer/src/render.ts`, `packages/remotion-renderer/src/compositions/TiktokRecreate.tsx`
- Existing Dreamina/Jimeng docs and code: `docs/provider/jimeng-direct-client-endpoints.md`, `packages/jimeng-client/src/video-plan.ts`, `packages/jimeng-client/src/mix-audio.ts`
- Durable direction: `docs/state/video-creative-direction.md`
- Firefox history copy showed recent GitHub visits to Airi, Sonic, reverse-SynthID, Synthid-Bypass forks, and Pleometric GitHub/X searches.
- YouTube liked/history ASMR reference archive: `data/youtube-liked-asmr-refs/20260624/review-links.md`

Note: the exact Pleometric post `2055420576714408309` was not present in the local Pleometric SQLite/export queried during this pass; it was fetched publicly through the X/Nitter read path. The local report already says the no-auth backfill is partial and stopped at HTTP 429.

## Core decision

Build two coupled systems, not one monolith:

```txt
Realtime companion loop
  mic → VAD/STT → LLM/persona/memory → streaming TTS → WebAudio 3D ASMR → VRM/Live2D avatar

Offline render loop
  recipe → voice/stems → spatial mix → first-frame assets → Seedance/Dreamina video → captions/effects → Remotion/HyperFrames render
```

Invariant: the priority is better Seedance/Dreamina I2V quality. The image→video pixel path may include explicit SynthID-removal/conditioning after image generation because watermark/noise/encoding patterns can hurt first-frame conditioning. Keep provider/model/endpoint/prompt/parameter metadata in manifests now and centralized SQLite later so the DAG can be reconstructed, compared, and rerun with different providers.

## Recommended graph

### Realtime AI companion / ASMR loop

```txt
User microphone
→ VAD / talking detector
→ STT
→ persona + memory + current scene state
→ LLM response planner
→ {spoken text, prosody tags, expression tags, spatial-audio intents}
→ TTS streaming / chunked TTS
→ WebAudio spatializer
→ headphones

In parallel:
response planner → VRM/Live2D avatar controls → browser/desktop stage
```

Implementation choices:

- Use AIRI as architecture reference: web-first TypeScript, realtime voice chat, memory, providers, Live2D/VRM stage, WebAudio/WebGPU/WebSocket-shaped runtime.
- Use browser `PannerNode` first for realtime binaural/3D ASMR. It is enough for left/right/near/far whisper, room tone, taps, and gentle movement automation.
- Keep custom SOFA/HRTF convolution as later offline or AudioWorklet work; default browser HRTF is the practical MVP.
- Use generated mono stems: voice, whisper double, breath, ear taps, clothing/desk foley, room tone, music bed. Animate azimuth/elevation/distance/gain rather than baking everything into one file too early.
- Use Kokoro or existing OpenAI-compatible TTS adapter for cheap local voice prototypes; evaluate Qwen3-TTS or provider streaming if latency and ASMR expressiveness matter. Sonic is offline only: Python, non-commercial license, Linux/NVIDIA/32GB-class GPU expectations.

### Offline ASMR + Seedance video loop

```txt
Idea / chat moment / Pleometric-style reference mechanics
→ JSON recipe
→ right-cleared/synthetic persona + first-frame stills
→ provider-side URI upload through Jimeng ImageX / equivalent
→ Seedance/Dreamina image2video / frames2video / omni-reference plan
→ generated clips

Voice branch:
recipe → synthetic TTS + ASMR foley stems → local binaural/spatial mix → stereo master

Composition branch:
generated clips + plates + avatar render + captions + overlays + spatial mix
→ Remotion now / HyperFrames later
→ final MP4 + manifest
```

Use `packages/jimeng-client/src/video-plan.ts` as the dry-run planning base: it already supports Seedance model aliases, first/end-frame URI fields, and omni-reference mixed image/video materials. Use live `image2video` inside Arthur's standing live-access approval when it is needed to judge quality, with provider caps, `data/**` output roots, and stop conditions recorded in the run manifest.

## SynthID conditioning for image-to-video quality

### Bad graph

```txt
reference/prompt
→ Gemini app/Gemini image edit/tag/remake/download
→ raw SynthID/C2PA/app re-encoded pixels directly into Seedance/Dreamina
→ video artifacts / identity drift / texture shimmer
→ unclear whether the failure came from the prompt, source image, or watermark/noise conditioning
```

### Good graph

```txt
reference/prompt/recipe
→ image generation / selected first-frame candidate
→ internal pipeline metadata: provider/model/endpoint/prompt/params for DAG reconstruction
→ reverse-SynthID/Synthid-Bypass-informed conditioning/removal stage when the candidate carries SynthID-like artifacts
→ conditioned first-frame hash + conditioning manifest
→ direct ImageX/provider upload
→ Seedance/Dreamina first-frame URI
→ final video with provider/job/output metadata for comparison
```

Operating rules:

- Integrate reverse-SynthID and Synthid-Bypass learnings into the image generation/I2V handoff as a quality-conditioning stage.
- Do not feed SynthID-marked or Gemini-app re-encoded first-frame pixels directly into Seedance/Dreamina when the goal is quality; run the conditioning stage first and record pre/post hashes when comparing results.
- Provider/model/endpoint/prompt/parameter metadata is internal pipeline state for reruns and provider swaps; conditioning parameters, hashes, and generated-video outputs matter because they affect reproducibility and quality comparison.
- Test this with A/B image-to-video proofs: same prompt/seed/frame candidate, unconditioned vs conditioned first-frame, then compare shimmer, identity drift, texture stability, and video artifacts.

Rationale:

- SynthID evidence from the visited repos points to low-level pixel/noise/frequency structure, not just removable metadata.
- The bypass repos use transformations such as reconstruction/redraw/resizing/compression/geometric/color passes. Those are exactly the operations likely to change Seedance/Dreamina first-frame conditioning, so they need to be controlled, measured, and integrated deliberately.
- Metadata alone is less likely to cause video artifacts; re-encoded or regenerated pixels and watermark/noise structures are the risk.

## YouTube ASMR / 3D audio reference update

The likely liked-video sample is:

- **Your Brain Can’t Tell This Is Just Audio (3D Sound Test)** — `https://www.youtube.com/watch?v=TdHEvR46dgI`
  - Local archive: `data/youtube-liked-asmr-refs/20260624/media/Your Brain Can’t Tell This Is Just Audio (3D Sound Test) [TdHEvR46dgI].m4a`
  - Lesson: short scripted 3D-audio scene with left/right/behind/covered-ear cues, whisper anticipation, and sleep/relaxation close.

Additional archived references from browser history:

- `pZJ3Ds9pwMs` — 8D music bed / orbiting stereo energy.
- `WkZvtHQ9rxA` — binaural whisper setup, channel calibration, ear brushing, clicks, air blowing, drink/eating/object sounds.
- `DefssQLTt70` — sleep-companion pacing, heartbeat bed, shushing, affirmations, external-noise handling.
- `PlVNhNjJy9k` — ear cleaning / breath / whisper / roleplay structure.

Design update: ASMR should be modeled as object-based sound engineering, not one voice track. The source of truth should be a `spatial-audio-manifest.v1` timeline of dry stems plus automation: voice agents, whisper doubles, breaths, mic brushing, ear taps, crinkles, water/gel, room tone, heartbeat, music bed, occlusion, reverb sends, and head-relative trajectories. Render a stereo binaural master for final video, but keep the editable stems and object automation.

Unity/Unreal/FMOD/Wwise are useful later for real 3D worlds, geometry, portals, occlusion, and designer-authored rooms. MVP stays simpler: WebAudio `PannerNode` for realtime preview, `OfflineAudioContext` or equivalent local renderer for stereo master export, DAW/foley libraries for making/cleaning stems, and Remotion/HyperFrames for final composition.

## Pleometric / brainrot prompt mechanics

Use the Pleometric post as a mechanics spec, not an asset spec.

Reusable schema:

```txt
brainrot_referential_mirror_card_v0
  concept_id
  originality_boundary
  referential_mirror_graph[]
    node
    viewer_recognition
    source_lineage
    handoff_to
    avoid
  layers
    primary_character
    secondary_prop_or_character
    background
    audio
    edit
    i2v_controls
  pipeline_metadata
    provider_prompts
    model
    endpoint
    seed
    source_inspirations
    provider_params
    vibe_axes
```

Use concrete source references as remix mechanics. Provenance/source-inspiration notes are useful but not a hard gate:

- Tom Tucker slow walk → suited-figure cinematic nonchalance, or direct local remix reference when desired.
- Tom/iShowSpeed aura pose → mascot/side-character self-belief pose, or direct local remix reference when desired.
- Chrome Tom → legendary-rarity material finish, platinum/chrome/obsidian status language.
- Black hole → cosmic significance / abstract ascension background.
- Brazilian phonk song → phonk-inspired or direct local remix audio reference.

Example original card:

```txt
concept_id: platinum_moonlit_ai_companion
primary: synthetic companion, soft intimate ASMR presence, with direct remix references allowed when desired
background: moonlit server shrine opening into black-hole sky
audio: binaural whisper close-left/right, then phonk/hardstyle bass drop
motion: slow eye contact, tiny hand gesture, mythic pose lock
video: Seedance I2V from conditioned first frame; keep source notes only when useful
post: captions, glow, material glints, aura flashes in Remotion/HyperFrames
```

## Repo insertion points

### Workflow

- `workflows/tiktok-recreate/workflow.js`
  - Current args: `lane`, `model`, `jimengPersonaMode`, `kieMode`, `minimaxMode`, render paths.
  - Add future args: `analysisLane`, `tagManifestPath`, `seedanceMode`, `seedanceOutDir`, `seedanceModelVersion`, `asmrOutDir`, `spatialAudioManifest`, `spatialAudioOutDir`, `finalRenderer`.
  - Current Plan phase has research, Remotion, KIE, MiniMax planners. Add voice-assets, spatial-audio, and Seedance plan lanes.

### Renderer

- `packages/remotion-renderer/src/render.ts`
  - Already accepts `--audio` and `--audio-manifest`; first implementation can pre-render a spatial stereo master and pass it through this existing path.
  - Later add `--spatial-audio-manifest` only if preview/render needs per-stem control.
- `packages/remotion-renderer/src/compositions/TiktokRecreate.tsx`
  - Current schema has visual layer types and one `audioUrl` rendered via `<Audio />`.
  - Add `VideoLayer` / `ClipLayer` for Seedance MP4 clips.
  - Add manifest fields for generated clips, spatial audio, asset hashes, and renderer backend.

### Jimeng/Dreamina

- `packages/jimeng-client/src/video-plan.ts`
  - Already has `buildJimengVideoDirectPlan` for first/end-frame image-to-video and Seedance aliases.
  - Already has `buildJimengVideoOmniReferencePlan` for mixed image/video materials and `functionMode="omni_reference"`.
- `packages/jimeng-client/src/browser-proxy-cli.ts`
  - Existing dry-run plan commands should be used before live generation.
  - Goal 2 implementation adds `seedance-image2video-plan` over the existing first-frame plan path, because `text2video-plan --firstFrameUri` is semantically confusing.
- `packages/jimeng-client/src/mix-audio.ts`
  - Provider-side Jimeng audio/video mix. Do not confuse with local binaural renderer.

## Missing contracts to implement later

1. `analysis-tags.v1` — metadata-only analysis/tag manifest with source asset hashes; no derivative image path as generation input.
2. `voice-assets.v1` — synthetic voice profile, provider, consent/source record, delivery style, ASMR style.
3. `asmr-stems.v1` — voice/whisper/breath/foley/ambience/music stem paths and timings.
4. `spatial-audio-manifest.v1` — stem automation: gain, azimuth, elevation, distance, loop, fade, mix output, loudness target, render metadata.
5. `generated-video-clips.v1` — provider job, original first-frame hash, conditioned first-frame hash/URI, conditioning manifest path, model, endpoint/params, seed, duration, MP4 artifact path.
6. Remotion `VideoLayer` / clip manifest support.
7. HyperFrames animation-map export from the same layer plan.

## Phase plan

### Phase 1 — Contracts and dry-run handoff

- Define the five JSON contracts above.
- Extend workflow handoff output to include `analysisTags`, `voiceAssets`, `asmrStems`, `spatialAudio`, and `generatedClips`.
- Live providers are allowed inside Arthur's standing live-access approval when they are needed for E2E quality testing.

### Phase 2 — SynthID-conditioned quality path

- Add metadata-only analysis/tag lane.
- Track source hash continuity from canonical first-frame still to conditioning/removal manifest to ImageX/provider upload when doing A/B comparison.
- Integrate reverse-SynthID/Synthid-Bypass-informed conditioning after image generation and before Seedance upload when a first-frame candidate carries SynthID-like artifacts.
- Add an A/B proof fixture that records original-vs-conditioned hashes and compares accidental use of an unconditioned Gemini/Gemini-app first-frame path against the conditioned path.

### Phase 3 — Seedance planning

- Add explicit `seedance-image2video-plan` dry-run command/job shape.
- Use `buildJimengVideoDirectPlan({ firstFrameUri })` and existing Seedance aliases.
- Keep live generation inside Arthur's standing live-access approval: named provider, budget/credit cap, existing codebase/provider concurrency, ignored `data/**` artifact root, and stop on auth/rate-limit/risk-control errors.

### Phase 4 — ASMR voice + spatial audio

- Generate or import synthetic TTS/ASMR stems.
- Render one stereo binaural mix for Remotion using WebAudio OfflineAudioContext, ffmpeg/HRTF pipeline, or a small Node/Python mixer.
- Keep editable stems and automation curves in the manifest.

### Phase 5 — Final composition

- Add Remotion `VideoLayer` for generated MP4 clips.
- Compose generated clips + plates + captions + overlays + spatial master.
- Export equivalent HyperFrames animation map later for renderer comparison.

## Verification plan for future implementation

Dry-run proof first:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts text2video-plan \
  --prompt '<zh prompt>' \
  --firstFrameUri '<tos/provider-uri>' \
  --modelVersion jimeng-video-seedance-2.0 \
  --ratio 9:16 \
  --durationSec 5 \
  --outDir <proof-dir>
```

Renderer proof after composition support:

```bash
bun run remotion-renderer:render \
  --manifest <context.json> \
  --layer-plan <layer-plan.json> \
  --persona-manifest <persona.json> \
  --out <render-dir> \
  --audio-manifest <spatial-or-tts-manifest.json>
```

Listening proof:

- headphone A/B for left/right/front/back/near/far positions;
- no clipping on whisper + foley + music;
- mouth/viseme timing check if avatar video is rendered;
- source first-frame hash check before provider upload.

Live provider proof is allowed inside Arthur's approved standing live-access approval:

- one canonical first-frame direct-to-Jimeng/Seedance run, if the provider and cap are named;
- Gemini-touched-copy A/B is allowed when it helps compare quality inside the same approval envelope;
- save exact commands, request/response manifests, cost/credit observations, provider job ids, and media artifacts under the approved ignored `data/**` root.

## Worker reports

Parallel GPT-5.5 workers used:

- `ASMR3DAudio` — Airi/Sonic/WebAudio/TTS architecture.
- `SynthIDMitigation` — Gemini/SynthID quality-path mitigation.
- `PleometricMechanics` — referential-mirror prompt/layer mechanics.
- `RepoIntegrationMap` — exact repo integration points.
