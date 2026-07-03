# tiktok-recreate

Clean-room TikTok recreation bootstrap workflow for a public profile. Given a source profile URL, a bootstrap manifest of archived reference videos, and pre-computed Antigravity decompositions, the workflow fans out research, script analysis, visual decomposition, Jimeng synthetic-persona design, KIE image-plate planning, MiniMax synthetic-narration audio planning, Remotion layout planning, and final review into a JSON-safe Slotok handoff payload.

## Pipeline

```
args.sourceProfile
args.manifestPath
args.decompositionPaths
        │
        ▼
   ┌─────────┐
   │ Intake  │  validate args, model, lane
   └────┬────┘
        │
        ▼
   ┌─────────────┐
   │  Decompose  │  parallel()
   │             │
   │ • script    │  hook patterns, pacing,
   │   analyst   │  retention, caption style
   │             │
   │ • visual    │  shots, transitions,
   │   decomposer│  text overlays, color mood
   │             │
   │ • native    │  MP4 probe technical brief
   │   probe     │
   │   reviewer  │
   └────┬────────┘
        │
        ▼
   ┌─────────┐
   │ Persona │  Jimeng synthetic-person lane
   │ Design  │  args.jimengPersonaMode
   └────┬────┘
        │
        ▼
   ┌─────────┐
   │  Plan   │  parallel()
   │         │
   │ • research│  rights-safe research slots
   │   fuel    │
   │         │
   │ • Remotion│  composition, captions,
   │   planner │  layers, provider routes
   │         │
   │ • KIE     │  image-text prompts per
   │   plates  │  visual asset slot
   │         │
   │ • MiniMax │  synthetic narration audio
   │   TTS     │  per video
   └────┬────┘
        │
        ▼
   ┌───────────┐
   │ Synthesize│  reviewer/synthesizer:
   │           │  clean-room handoff payload
   │           │  + KIE + MiniMax jobs
   │           │  + render expectations
   └───────────┘
```

## Artifact layout

The workflow expects a bootstrap directory matching the current `data/video-recreation/samuelszuchan/bootstrap-20260620/` layout (see `args.example.json`):

```
bootstrap-20260620/
├── manifest.json                                    # video metadata + transcripts
├── <video_id>.context.json                          # per-video context
├── antigravity-native-video-probe-summary.json
├── antigravity-native-video-probe/
│   └── <video_id>.stdout.json                       # native MP4 probe
├── antigravity-frame-decompositions-summary.json
├── antigravity-frame-decompositions/
│   └── <video_id>.json                              # frame/VTT decomposition
├── antigravity-decomposition-prompt.md              # prompt used for decompositions
├── frames/
│   └── <video_id>/
│       └── frame_001.jpg .. frame_008.jpg
├── plates/                                          # KIE-generated image assets
│   ├── manifest.json                                # run manifest with per-slide jobs
│   ├── requests/<video_id>_slide_<idx>_request.json
│   ├── responses/<video_id>_slide_<idx>_response.json
│   └── plates/<video_id>_slide_<idx>/
│       └── <n>.<ext>
├── jimeng-persona/                                  # Jimeng synthetic-persona outputs
│   ├── raw/
│   ├── normalized/
│   └── artifacts/
├── jimeng-persona-manifest.json                     # persona manifest for Remotion
├── tts/                                             # MiniMax TTS narration audio
│   └── <video_id>/
│       ├── audio/
│       │   ├── narration.mp3
│       │   └── narration.response.json
│       └── tts-manifest.json
└── renders/                                         # Remotion final renders
    └── <video_id>/
        ├── recreate.mp4
        └── manifest.json

Output is a JSON-safe handoff payload conforming to the Slotok import contract: `lane`, `sourcePolicy`, `records`, `providerJobs`, `candidatePatches`, `referenceArchives`, `notes`, `artifactPaths`, `result`.

## Antigravity model/account routing

Antigravity (Gemini Flash) calls are routed through `args.model`. The bootstrap data was produced with `google-antigravity/gemini-3.5-flash-low`. The workflow passes the same `model` value to each subagent so the OMP daemon can resolve account/project routing; the script itself does not handle credentials or API keys.

## Native full-video upload is blocked

Direct native full-video Gemini analysis is still blocked in this bootstrap. The workflow therefore relies on the pre-computed frame/VTT and native MP4 probe lanes, and does not upload source videos to any live provider. Any future full-video lane must remain opt-in with a spend cap and bounded polling.

## Two decomposition lanes

### Lane A: Frame/VTT via OMP

Reads per-video VTT transcript plus Antigravity frame-decomposition JSONs. This lane extracts abstract mechanics: hook patterns, script structure, caption style, pacing notes, retention devices, and timeline segments. It never reproduces exact frames or copyrighted visuals.

### Lane B: Native MP4 probe

Reads the Antigravity native-video-probe stdout/summary (format family, codec info, bitrate profile, scene cuts). Provides technical constraints for Remotion encoding: resolution, frame rate, keyframe cadence, and any anomalies.

Both lanes run inside `parallel()` and merge into the Remotion and KIE planning phases.

## Jimeng synthetic-person lane

The persona designer agent produces a Jimeng-compatible synthetic-person prompt in zh-CN. `args.jimengPersonaMode` selects the generation strategy; the default is `synthetic-narrator`.

The persona is an on-screen narrator/presenter that replaces the original creator's likeness. It must not resemble any real person and must carry no branding or voice imitation of the source creator.

## KIE image-plate lane

The KIE plate planner turns each visual asset slot into a clean-room image-text prompt. The resulting plate manifest is consumed by `scripts/tiktok-recreate-kie-images.boundary.ts`.

### Dry-run (default)

```bash
bun run tiktok-recreate:kie-images \
  --decomposition data/video-recreation/samuelszuchan/bootstrap-20260620/antigravity-frame-decompositions/2026-05-20_7641985194186001678.json \
  --outDir data/video-recreation/samuelszuchan/bootstrap-20260620/plates
```

Dry-run prepares per-slide request payloads under `plates/requests/` but does not spend or download images.

### Live with bounded polling

```bash
bun run tiktok-recreate:kie-images \
  --decomposition data/video-recreation/samuelszuchan/bootstrap-20260620/antigravity-frame-decompositions/2026-05-20_7641985194186001678.json \
  --outDir data/video-recreation/samuelszuchan/bootstrap-20260620/plates \
  --live \
  --wait \
  --maxSpendUsd 0.25
```

## MiniMax TTS narration lane

Narration audio is synthesized via the MiniMax TTS API through `scripts/tiktok-recreate-tts.boundary.ts`.

### Setup

1. Ensure `scripts/tiktok-recreate-tts.boundary.ts` exists (created by the MiniMax TTS lane).
2. MiniMax credentials are read from `process.env` first, then fall back to `../apps/hsk-deck/.env` for `MINIMAX_API_KEY_2`, `MINIMAX_API_KEY`, `MINIMAX_API_MODEL`, `MINIMAX_API_T2A_URL`, and `MINIMAX_TTS_VOICE_ID` by key name only.
3. Default synthetic voice: `Bashful Girl` (voiceId `289066744107112`), model `speech-2.8-turbo`.

### Dry-run (plan jobs)

The handoff boundary script can plan MiniMax TTS jobs without calling the API:

```bash
bun run tiktok-recreate:handoff \
  --manifest data/video-recreation/samuelszuchan/bootstrap-20260620/manifest.json \
  --decompositions data/video-recreation/samuelszuchan/bootstrap-20260620/antigravity-frame-decompositions \
  --out data/video-recreation/samuelszuchan/bootstrap-20260620/slotok-handoff.json \
  --lane ugc-ads \
  --sourcePolicy abstract-mechanics \
  --minimaxMode dry-run \
  --minimaxOutDir data/video-recreation/samuelszuchan/bootstrap-20260620/tts
```

This emits planned `provider=local` / `operation=minimax-tts` jobs with expected artifact paths under `tts/<videoId>/`.

### Live synthesis per video

```bash
bun run tiktok-recreate:tts \
  --decomposition data/video-recreation/samuelszuchan/bootstrap-20260620/antigravity-frame-decompositions/2026-05-20_7641985194186001678.json \
  --outDir data/video-recreation/samuelszuchan/bootstrap-20260620/tts \
  --voice 289066744107112
```

Outputs `audio/narration.mp3`, `audio/narration.response.json`, and `tts-manifest.json` under `<outDir>/<videoId>/`.

### Passing --audio-manifest to the renderer

After TTS synthesis, pass the per-video audio manifest to the Remotion renderer:

```bash
bun run remotion-renderer:render \
  --manifest data/video-recreation/samuelszuchan/bootstrap-20260620/2026-05-20_7641985194186001678.context.json \
  --decomposition data/video-recreation/samuelszuchan/bootstrap-20260620/antigravity-frame-decompositions/2026-05-20_7641985194186001678.json \
  --persona-manifest data/video-recreation/samuelszuchan/bootstrap-20260620/jimeng-persona-manifest.json \
  --out data/video-recreation/samuelszuchan/bootstrap-20260620/renders/2026-05-20_7641985194186001678 \
  --plates-manifest data/video-recreation/samuelszuchan/bootstrap-20260620/plates/manifest.json \
  --audio-manifest data/video-recreation/samuelszuchan/bootstrap-20260620/tts/2026-05-20_7641985194186001678/tts-manifest.json
```

Expected TTS artifacts per video:

- `tts/<videoId>/audio/narration.mp3` — synthesized narration audio.
- `tts/<videoId>/audio/narration.response.json` — MiniMax response record.
- `tts/<videoId>/tts-manifest.json` — per-video TTS run manifest.

## Remotion / Slotok output

The Remotion renderer produces final MP4s and manifests under `bootstrap-20260620/renders/<video_id>/`.

```bash
bun run remotion-renderer:render \
  --manifest data/video-recreation/samuelszuchan/bootstrap-20260620/2026-05-20_7641985194186001678.context.json \
  --decomposition data/video-recreation/samuelszuchan/bootstrap-20260620/antigravity-frame-decompositions/2026-05-20_7641985194186001678.json \
  --persona-manifest data/video-recreation/samuelszuchan/bootstrap-20260620/jimeng-persona-manifest.json \
  --out data/video-recreation/samuelszuchan/bootstrap-20260620/renders/2026-05-20_7641985194186001678 \
  --plates-manifest data/video-recreation/samuelszuchan/bootstrap-20260620/plates/manifest.json \
  --audio-manifest data/video-recreation/samuelszuchan/bootstrap-20260620/tts/2026-05-20_7641985194186001678/tts-manifest.json
```

The Remotion planner produces:

- A composition spec (duration, resolution, fps, background).
- Caption layer definitions (font family, position, animation, timing per segment).
- Slide/visual layer specs referencing generated assets.
- Provider routes mapping each visual layer to a primary provider and fallbacks.
- A Slotok artifact list with `kind`, `path_or_role`, and `viewer_hint`.

Expected render artifacts:

- `renders/<video_id>/recreate.mp4` — final recreated video.
- `renders/<video_id>/manifest.json` — render manifest describing the output.

All paths in output are relative to the bootstrap directory. Slotok imports the handoff payload through `POST /api/ugc/workflows/<run_id>/import`.

## Goal 5 ASMR + Seedance handoff

Goal 5 adds a deterministic handoff layer for the accepted ASMR companion DAG. It consumes:

- Goal 4 planning bundle: `data/asmr-companion/goal4-planning/goal4-pipeline-handoff.bundle.json`
- Goal 2 generated clip manifest: `data/asmr-companion/goal2/seedance-parent-proof/normalized/generated-video-clips.v1.json`
- Goal 3 spatial render-output manifest: `data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json`

Materialize the reviewer-rerunnable proof bundle:

```bash
bun workflows/tiktok-recreate/goal5-asmr-handoff.ts \
  --handoff data/asmr-companion/goal4-planning/goal4-pipeline-handoff.bundle.json \
  --generated-clips data/asmr-companion/goal2/seedance-parent-proof/normalized/generated-video-clips.v1.json \
  --spatial-render-output data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json \
  --outDir data/asmr-companion/goal5-pipeline-proof \
  --createdAt 2026-06-24T00:00:00.000Z \
  --proofId goal5-asmr-seedance-render-proof-001
```

The proof directory includes `reviewer-report.html`, `goal5-workflow-handoff.json`, `goal5-layer-plan.json`, `generated-clips.resolved.json`, `hyperframes-animation-map.json`, and a human-openable placeholder SVG at `media/first-frame-candidate-seedance-dry-run.placeholder.svg`.

Because the accepted Goal 2 artifact is a dry-run manifest, no live Seedance MP4 exists at the planned MP4 path. The layer plan makes this explicit with `ClipLayer.props.missingLiveMedia=true`, retains the planned MP4 path for rerun/provider-swap metadata, and points both Remotion and HyperFrames at the deterministic placeholder media.

### Goal 5 review vocabulary

The ASMR handoff now carries a compact artifact/layer/effect vocabulary in `goal5-layer-plan.json`, `goal5-workflow-handoff.json`, `hyperframes-animation-map.json`, and the generated `reviewer-report.html`.

- **Artifact** means a reusable media/proof file with provenance: Seedance generated clip MP4s when present, deterministic placeholder SVGs when live media is absent, Goal 3 spatial audio, and renderer outputs. Artifact-library consumers should key on these paths before looking at renderer implementation details.
- **Layer** means a renderer primitive in the layer plan. `ClipLayer` and placeholder media are artifact-backed; `TypographyLayer` is post-render text; `BackgroundLayer`, `GridOverlay`, and `FlashOverlay` are renderer-generated clean-room layers.
- **Effect** means renderer behavior that changes presentation without becoming a reusable source asset: fade transitions, placeholder fallback, audio holds, grid depth cues, and flash/glow overlays.

The HyperFrames renderer also emits `reviewSurface` in both `hyperframes.json` and `manifest.json`, including `layerTypes`, `effectVocabulary`, and `artifactLibraryRefs` so reviewers can inventory reusable artifacts without reading the generated HTML.


Render commands from the materialized handoff:

```bash
bun run remotion-renderer:render -- \
  --manifest data/asmr-companion/goal5-pipeline-proof/remotion-context.json \
  --layer-plan data/asmr-companion/goal5-pipeline-proof/goal5-layer-plan.json \
  --persona-manifest data/asmr-companion/goal5-pipeline-proof/persona-manifest.json \
  --out data/asmr-companion/goal5-pipeline-proof/remotion-render \
  --audio-manifest data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json \
  --generated-clips-manifest data/asmr-companion/goal2/seedance-parent-proof/normalized/generated-video-clips.v1.json

bun run tiktok-recreate:hyperframes -- \
  --layer-plan data/asmr-companion/goal5-pipeline-proof/goal5-layer-plan.json \
  --out data/asmr-companion/goal5-pipeline-proof/hyperframes \
  --audio data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.wav
```

Review-surface verification command from the repo root (dry-run renderer project write; no provider spend):

```bash
bun test workflows/tiktok-recreate/goal5-asmr-handoff.test.ts && \
bun workflows/tiktok-recreate/goal5-asmr-handoff.ts \
  --handoff data/asmr-companion/goal4-planning/goal4-pipeline-handoff.bundle.json \
  --generated-clips data/asmr-companion/goal2/seedance-parent-proof/normalized/generated-video-clips.v1.json \
  --spatial-render-output data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json \
  --outDir data/asmr-companion/goal5-pipeline-proof \
  --createdAt 2026-06-24T00:00:00.000Z \
  --proofId goal5-asmr-seedance-render-proof-001 && \
bun run tiktok-recreate:hyperframes -- \
  --layer-plan data/asmr-companion/goal5-pipeline-proof/goal5-layer-plan.json \
  --out data/asmr-companion/goal5-pipeline-proof/hyperframes-review-surface \
  --audio data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.wav && \
bun -e 'const fs = require("node:fs"); const handoff = JSON.parse(fs.readFileSync("data/asmr-companion/goal5-pipeline-proof/goal5-workflow-handoff.json", "utf8")); const manifest = JSON.parse(fs.readFileSync("data/asmr-companion/goal5-pipeline-proof/hyperframes-review-surface/manifest.json", "utf8")); const refs = manifest.reviewSurface?.artifactLibraryRefs ?? []; if (!handoff.reviewSurface?.vocabulary) throw new Error("missing handoff reviewSurface vocabulary"); if (!refs.some((ref) => String(ref.pathOrUrl).includes("goal3-close-whisper-binaural.wav"))) throw new Error("missing spatial audio artifact ref"); if (!refs.some((ref) => String(ref.pathOrUrl).includes(".placeholder.svg"))) throw new Error("missing placeholder artifact ref");'
```


## Handoff generation

```bash
bun run tiktok-recreate:handoff \
  --manifest data/video-recreation/samuelszuchan/bootstrap-20260620/manifest.json \
  --decompositions data/video-recreation/samuelszuchan/bootstrap-20260620/antigravity-frame-decompositions \
  --out data/video-recreation/samuelszuchan/bootstrap-20260620/slotok-handoff.json \
  --lane ugc-ads \
  --sourcePolicy abstract-mechanics
```

The handoff payload now includes planned KIE image-generation jobs and MiniMax TTS narration jobs alongside Jimeng persona and Remotion render jobs, plus artifact paths for `plates/`, `tts/`, and `renders/`.

## Clean-room rules

1. **No likeness reuse.** The original creator's face, voice, branding, and exact media are never preserved or imitated.
2. **Abstract mechanics only.** Hook patterns, script structure, visual rhythm, and pacing are extracted as abstract descriptions, not as frame copies.
3. **Transcript as source material.** The VTT-derived transcript informs content structure; notable ASR uncertainties are flagged.
4. **Synthetic replacement.** A Jimeng synthetic person replaces the original presenter; MiniMax TTS synthesizes a wholly synthetic narration voice; KIE regenerates all plates; Remotion regenerates all captions, slides, and layouts.
5. **Provenance tracking.** Every output record includes source provenance and a rights note.
6. **Source policy.** The handoff payload carries `sourcePolicy: "abstract-mechanics"`.

## OMP RPC monitoring note

Live OMP RPC monitoring is a future adapter only. When Slotok owns an `omp --mode rpc` child process, the daemon can normalize stdio `AgentSessionEvent` and subagent progress frames into workflow events. Until that adapter exists, this workflow reads pre-computed OMP artifacts (frame decompositions, native probe) from disk and does not make live provider calls. Use `omp stats` / `omp-stats` routes such as `/api/stats` and `/api/sync` for historical usage/cost tracking only.

---

## Renderer comparison experiment & OMP server mode

**Goal.** Narrow experiment: one sample, identical input artifacts (decomposition, persona, plates, TTS). Compare Remotion as research/reference implementation against HyperFrames as production candidate. Measure fidelity, render speed, and operational ergonomics per renderer.

**OMP server mode event model.** In `omp --mode server`, each phase and subagent emits workflow events; artifact paths stream into Slotok's artifact registry so downstream consumers subscribe to completion. SQLite is the planned durable event/artifact ledger; this slice uses JSON manifests on disk as a lightweight stand-in. Agents collaborate over the same artifact tree without a central scheduler.

**Text-free asset policy.** Generated media assets (KIE plates, Jimeng persona outputs, MiniMax TTS audio) MUST contain no embedded text. All subtitles, captions, labels, and text overlays are applied in post via Remotion `TypographyLayer` components or HyperFrames HTML/GSAP overlay layers. This keeps source plates reusable and avoids text-rasterization artifacts across render targets.

**Preview / render / QA loops.**

| Capability | Remotion | HyperFrames |
|---|---|---|
| Interactive preview | Studio UI, Player | `npx hyperframes preview` |
| Composition selection | `selectComposition` | CLI args + animation map |
| Production render | `renderMedia` | `npx hyperframes render` |
| Environment check | — | `npx hyperframes doctor` |
| Composition lint | — | `npx hyperframes lint` |
| Artifact integrity | — | `npx hyperframes validate` |
| Frame-level debug | — | `npx hyperframes inspect` |
| Deterministic repro | — | Optional Docker render (bit-exact) |
| Pipeline tab preview | Existing Pipeline tab | — |
| QA export | — | Animation map |

**License risk flag (engineering).** Remotion's custom company license introduces a dependency risk for production deployment. HyperFrames (Apache 2.0) offers a license-clean local CLI path and is the preferred path for production exploration. Flagged as an engineering constraint, not legal advice.
