# TikTok recreate bootstrap QA — 2026-06-20

## Current status

The repo now has two proven layers of work:

1. **End-to-end vertical slice for one Korea sample**
   - download
   - Gemini/Antigravity decomposition
   - Jimeng synthetic persona
   - KIE plates
   - MiniMax TTS
   - Remotion render with audio
   - Slotok handoff/import

2. **Focused birthrate-video debugging stack** for `2026-05-20_7642101474981367054`
   - scene/chapter breakdown artifacts
   - Pipeline Debug view in Slotok
   - composable Remotion layer taxonomy
   - birthrate chapter manifest
   - birthrate layer plan
   - KIE birthrate plates
   - MiniMax birthrate narration
   - first layered render attempt

The second layer is the one currently being optimized. It is not final-quality yet.

## Proven end-to-end artifacts (earlier sample)

- `data/video-recreation/samuelszuchan/bootstrap-20260620/tts/2026-05-20_7641985194186001678/audio/narration.mp3`
- `data/video-recreation/samuelszuchan/bootstrap-20260620/renders/2026-05-20_7641985194186001678/recreate.mp4`
- `data/video-recreation/samuelszuchan/bootstrap-20260620/renders/2026-05-20_7641985194186001678-audio-manifest/recreate.mp4`
- Slotok import:
  - `workflow_omp_tiktok_recreate_bootstrap_v5_import_mqn3hhnn`

## Birthrate-video debugging artifacts

### Core source and understanding
- Sample id: `2026-05-20_7642101474981367054`
- Source MP4:
  - `data/source-archives/tiktok/samuelszuchan/videos/2026-05-20_7642101474981367054.mp4`
- VTT captions:
  - `data/source-archives/tiktok/samuelszuchan/videos/2026-05-20_7642101474981367054.eng-US.vtt`
- Original decomposition:
  - `data/video-recreation/samuelszuchan/bootstrap-20260620/antigravity-frame-decompositions/2026-05-20_7642101474981367054.json`
- Scene review:
  - `data/video-recreation/samuelszuchan/bootstrap-20260620/2026-05-20_7642101474981367054-scene-breakdown-v1.md`
  - `data/video-recreation/samuelszuchan/bootstrap-20260620/2026-05-20_7642101474981367054-video-understanding-review.md`
- Pass-1 prompt:
  - `data/video-recreation/samuelszuchan/bootstrap-20260620/decomposition-pass1-scenes.md`
- V2 prompt artifacts:
  - `docs/prompts/tiktok-video-decomposition-v2.md`
  - `data/video-recreation/samuelszuchan/bootstrap-20260620/decomposition-prompt-v2.md`
  - `data/video-recreation/samuelszuchan/bootstrap-20260620/johnny-harris-debug-prompt.md`

### Composable planning artifacts
- Chapter manifest:
  - `data/video-recreation/samuelszuchan/bootstrap-20260620/chapter-manifest-merged.json`
- Pipeline debug manifest:
  - `data/video-recreation/samuelszuchan/bootstrap-20260620/pipeline-debug-manifest.json`
- Layer taxonomy contract:
  - `docs/remotion-component-taxonomy.md`
- Birthrate layer plan:
  - `data/video-recreation/samuelszuchan/bootstrap-20260620/birthrate-layer-plan.json`
  - 32–35 beat-level layer stacks depending on generation revision

### Birthrate generated assets
- KIE documentary plates:
  - `data/video-recreation/samuelszuchan/bootstrap-20260620/plates-documentary/manifest.json`
  - summary observed: 5 prepared, 5 submitted, 5 completed, 0 failed
- MiniMax birthrate narration:
  - `data/video-recreation/samuelszuchan/bootstrap-20260620/tts-birthrate/2026-05-20_7642101474981367054/tts-manifest.json`
  - `data/video-recreation/samuelszuchan/bootstrap-20260620/tts-birthrate/2026-05-20_7642101474981367054/audio/narration.mp3`
  - observed: `male-qn-qingse`, `118512` ms, `1896237` bytes, `usageCharacters=1812`
- Birthrate render outputs:
  - coarse render: `data/video-recreation/samuelszuchan/bootstrap-20260620/renders/2026-05-20_7642101474981367054/recreate.mp4`
  - layered render attempt: `data/video-recreation/samuelszuchan/bootstrap-20260620/renders/2026-05-20_7642101474981367054-layered/recreate.mp4`

## Slotok / workbench proof

- `bun run slotok:typecheck` passes after adding the Pipeline Debug view and structured chapter/beat preview.
- The new Pipeline tab now targets the birthrate sample by default and can preview:
  - chapter manifest
  - layer plan
  - decomposition JSON
  - KIE plates
  - MiniMax audio
  - render MP4s
  - handoff payloads
- The structured preview surfaces `chapters` and `beats` as sidebar-like lists instead of only raw JSON.

## Commands run for the birthrate focus

```bash
bun run slotok:typecheck
bun scripts/eval-video-understanding.ts \
  --videos data/source-archives/tiktok/samuelszuchan/videos/2026-05-20_7642101474981367054.mp4 \
  --providers kie \
  --prompt-file data/video-recreation/samuelszuchan/bootstrap-20260620/decomposition-prompt-v2.md \
  --limit 1 --max-frames 8 --live --force \
  --out data/video-recreation/samuelszuchan/bootstrap-20260620/v2-decomposition
bun scripts/eval-video-understanding.ts \
  --videos data/source-archives/tiktok/samuelszuchan/videos/2026-05-20_7642101474981367054.mp4 \
  --providers kie \
  --prompt-file data/video-recreation/samuelszuchan/bootstrap-20260620/scene-pass1-prompt.md \
  --limit 1 --max-frames 8 --live --force \
  --max-output-tokens 4096 \
  --out data/video-recreation/samuelszuchan/bootstrap-20260620/scene-pass1
bun scripts/tiktok-recreate-kie-images.boundary.ts \
  --decomposition data/video-recreation/samuelszuchan/bootstrap-20260620/antigravity-frame-decompositions/2026-05-20_7642101474981367054.json \
  --manifest data/video-recreation/samuelszuchan/bootstrap-20260620/manifest.json \
  --outDir data/video-recreation/samuelszuchan/bootstrap-20260620/plates-documentary \
  --maxPrompts 5 --live --wait --maxSpendUsd 0.5 --pollIntervalSec 10 --maxPolls 30
bun run tiktok-recreate:tts \
  --decomposition data/video-recreation/samuelszuchan/bootstrap-20260620/antigravity-frame-decompositions/2026-05-20_7642101474981367054.json \
  --outDir data/video-recreation/samuelszuchan/bootstrap-20260620/tts-birthrate \
  --voice male-qn-qingse
bun run remotion-renderer:typecheck
bun run remotion-renderer:render \
  --manifest data/video-recreation/samuelszuchan/bootstrap-20260620/2026-05-20_7642101474981367054.context.json \
  --decomposition data/video-recreation/samuelszuchan/bootstrap-20260620/antigravity-frame-decompositions/2026-05-20_7642101474981367054.json \
  --persona-manifest data/video-recreation/samuelszuchan/bootstrap-20260620/jimeng-persona-manifest.json \
  --plates-manifest data/video-recreation/samuelszuchan/bootstrap-20260620/plates-documentary/manifest.json \
  --audio data/video-recreation/samuelszuchan/bootstrap-20260620/tts-birthrate/2026-05-20_7642101474981367054/audio/narration.mp3 \
  --out data/video-recreation/samuelszuchan/bootstrap-20260620/renders/2026-05-20_7642101474981367054
bun run remotion-renderer:render \
  --manifest data/video-recreation/samuelszuchan/bootstrap-20260620/2026-05-20_7642101474981367054.context.json \
  --layer-plan data/video-recreation/samuelszuchan/bootstrap-20260620/birthrate-layer-plan.json \
  --persona-manifest data/video-recreation/samuelszuchan/bootstrap-20260620/jimeng-persona-manifest.json \
  --plates-manifest data/video-recreation/samuelszuchan/bootstrap-20260620/plates-documentary/manifest.json \
  --out data/video-recreation/samuelszuchan/bootstrap-20260620/renders/2026-05-20_7642101474981367054-layered
ffprobe -v error -show_entries format=duration,size,bit_rate -show_streams -of json data/video-recreation/samuelszuchan/bootstrap-20260620/renders/2026-05-20_7642101474981367054-layered/recreate.mp4
```

## Results

### Good
- Slotok Pipeline Debug view compiles.
- Birthrate KIE plates succeeded.
- Birthrate MiniMax TTS succeeded.
- Coarse birthrate audio render succeeded.
- Layered birthrate render now completes without crashing and preserves full 129.8s duration with an AAC audio track.
- `ffprobe` on layered render confirms:
  - 1080×1920
  - 30 fps
  - 3895 frames
  - ~129.88s total duration
  - AAC stereo audio track present

### Not good enough yet
- The current layered render is still visually too sparse.
- A sampled frame from the layered output still looked like a black title-card-heavy frame, not a finished Johnny-Harris-style documentary explainer.
- So the composable architecture is now in place, but the specific layer implementations and/or layer-plan props still need artistic tuning.

## Current diagnosis

The main problem has shifted.

Before:
- we did not have enough structure to decompose the video into composable parts.

Now:
- we do have a chapter manifest, a layer taxonomy, a layer plan, a workbench view, generated plates, generated TTS, and a renderer that can consume the plan.
- but the actual visual output still needs better layer implementations, more motion density, and more refined mapping between the layer plan and what each primitive renders.

That is a much better failure mode: the pipeline is inspectable and tunable.

## Renderer/workflow comparison

- **License finding**: Remotion uses a custom license restricting derivative sublicensing (free for individuals/≤3 employees/nonprofits/evaluation; company license required otherwise); HyperFrames is Apache 2.0 with full copyright/patent grants and redistribution rights. HyperFrames is the preferred production path.
- **Text-in-post rule**: Original TikTok sample uses on-screen captions as the primary text delivery mechanism; recreation must match this text-in-post convention rather than relying on narration-only delivery.
- **HyperFrames preview/render/inspect loop**: HyperFrames supports `preview` (live HTML/CSS/GSAP preview server), `render` (CLI with deterministic Docker mode and batch rendering), and `inspect`/`validate`/`lint`/`doctor` for debugging. The planned loop: author → preview → inspect → render → validate → repeat.
- **OMP server/artifact stream plan**: OMP server orchestrates lane dispatch across the four comparison lanes. Each lane produces artifacts tracked through the pipeline-debug-manifest. The artifact stream flows: Gemini/Antigravity → visual decomposition → GPT-5.5 code authoring → HyperFrames render → Kimi clean-room review. Comparison artifacts are logged in `workflow-comparison.json` and surfaced in Slotok Pipeline Debug view.

## HyperFrames black-output debug — 2026-06-21

- **Root cause**: the comparison lane initially produced HyperFrames source only. Raw `index.html` is black because timed `.clip` elements stay hidden until the HyperFrames runtime drives the registered GSAP timeline.
- **Fix**: ran the local renderer path with `--render`, copied layer assets into the HyperFrames project, added `data-start="0"` on the root composition, replaced clip `data-end` with `data-duration`, registered `window.__timelines["<compositionId>"]`, and exposed the rendered MP4 in Pipeline Debug.
- **Proof artifacts**: `renders/2026-05-20_7642101474981367054-hyperframes/recreate.mp4`, `frame-003.png`, `frame-030.png`, and `manifest.json` (`renderRan: true`, `renderExitStatus: 0`).
- **Checks**: `npx hyperframes lint` reports 0 errors and duplicate-media warnings only; `npx hyperframes validate --no-contrast` reports no console errors; sampled frames are visible, not black.
- **Silent-video gap**: the initial black-output fix produced a visible MP4 with no audio track. The HyperFrames render path now muxes narration from the TTS manifest.

## Goal 5 ASMR reviewability update — 2026-06-24

- **Review surface added**: Goal 5 ASMR handoff artifacts now define an explicit artifact/layer/effect vocabulary in `goal5-layer-plan.json`, `goal5-workflow-handoff.json`, `hyperframes-animation-map.json`, and `reviewer-report.html`.
- **Artifact-library reuse field**: HyperFrames `hyperframes.json` and `manifest.json` now include `reviewSurface` with `layerTypes`, `effectVocabulary`, and `artifactLibraryRefs`. This lets reviewers distinguish reusable media artifacts (generated clip, placeholder SVG, spatial audio) from renderer-only layers/effects without reading generated HTML.
- **Invariant**: generated media remains text-free; text is represented as `TypographyLayer` / post-layer overlay data, and placeholder fallback remains explicit via `missingLiveMedia=true`.

Exact root verification command for this slice:

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

## Reconstruction working end-to-end — 2026-07-03

First working end-to-end recreation with side-by-side proof (playground stream first goal). The layered Remotion render previously produced 129.8s of black frames plus static chrome; root causes were in the renderer, not the assets or the layer plan.

### Root causes fixed (packages/remotion-renderer)

1. **Sequence-local frame double-offset.** Every layer primitive computed `localFrame = useCurrentFrame() - beatStartFrame` inside `<Sequence from={startFrame}>`, where `useCurrentFrame()` is already sequence-local. All beats with `startFrame > 0` spent their entire duration at negative local frames → enter-animation opacity ≤ 0 → invisible. Only beat 0 (0–2.52s) ever rendered.
2. **Native `<img>` tags (6 sites).** Remotion does not wait for native image loads before frame capture; replaced with Remotion `<Img>`.
3. **PlateLayer Ken Burns transform.** `translate(${x - 50}%, ${y - 50}%)` with centered offsets (x=0 at center) shifted plates half a screen up-left; fixed to `translate(${x}%, ${y}%)`.
4. **inputProps asset inlining.** Plates/persona were base64-inlined into `inputProps` and duplicated per beat (~292MB serialized for the 32-beat plan), killing the headless page at `selectComposition` (`ProtocolError: target closed`). Replaced with Remotion `publicDir` staging: local assets are copied to `<out>/public/assets/` once and referenced via `staticFile()` relative paths.

### New renderer capabilities

- `--captions <path.vtt>` + `--caption-style word|phrase` (default `word`): parses WEBVTT, distributes each cue's duration across its words, renders a TikTok-style one-word serif caption track lower-center; colliding plan `TypographyLayer` captions are suppressed.
- `--frame-range <start>-<end>`: renders a slice for fast iteration.
- PresenterLayer beats with `props.src: null` get the Jimeng persona image injected from `--persona-manifest` (synthetic narrator replaces original creator likeness).
- New side-by-side proof tool: `scripts/tiktok-recreate-side-by-side.boundary.ts` (`bun run tiktok-recreate:side-by-side`), ffmpeg hstack with ORIGINAL/RECREATION labels + run manifest.

### Proof artifacts (local, gitignored)

- Full recreation: `data/video-recreation/samuelszuchan/bootstrap-20260620/renders/2026-05-20_7642101474981367054-v2/recreate.mp4` (129.88s, 1080×1920, AAC narration)
- **Side-by-side proof**: `data/video-recreation/samuelszuchan/bootstrap-20260620/renders/2026-05-20_7642101474981367054-v2-side-by-side/side-by-side.mp4` (1080×960, original left / recreation right, run manifest alongside)
- Fix slice + inspected frames: `renders/2026-05-20_7642101474981367054-fix-slice/` (`frame-003s.png` … `frame-028s.png`)
- Before-state comparison (black render): `renders/2026-05-20_7642101474981367054-side-by-side-smoke/`

Visual QA sampled 7 timestamps across the full duration: every recreation frame composed (plates track the script — slipper/skyline/Maybach/wine cellar), per-word captions sync with the original (one word of drift at cue boundaries from even word distribution), CounterLayer renders the unemployment stat, synthetic persona appears in presenter beats.

### Rerun commands

```bash
bun run remotion-renderer:render -- \
  --manifest data/video-recreation/samuelszuchan/bootstrap-20260620/2026-05-20_7642101474981367054.context.json \
  --layer-plan data/video-recreation/samuelszuchan/bootstrap-20260620/birthrate-layer-plan.json \
  --persona-manifest data/video-recreation/samuelszuchan/bootstrap-20260620/jimeng-persona-manifest.json \
  --plates-manifest data/video-recreation/samuelszuchan/bootstrap-20260620/plates-documentary/manifest.json \
  --captions data/source-archives/tiktok/samuelszuchan/videos/2026-05-20_7642101474981367054.eng-US.vtt \
  --out data/video-recreation/samuelszuchan/bootstrap-20260620/renders/2026-05-20_7642101474981367054-v2

bun run tiktok-recreate:side-by-side -- \
  --original data/source-archives/tiktok/samuelszuchan/videos/2026-05-20_7642101474981367054.mp4 \
  --recreate data/video-recreation/samuelszuchan/bootstrap-20260620/renders/2026-05-20_7642101474981367054-v2/recreate.mp4 \
  --out data/video-recreation/samuelszuchan/bootstrap-20260620/renders/2026-05-20_7642101474981367054-v2-side-by-side
```

Remaining quality gaps (not blockers): only 5 unique plates rotate across 32 beats; presenter uses a static persona still (no motion/lipsync); caption word timing is evenly distributed within cues rather than ASR-aligned.
