# AniChat / Grok companion pipeline recon

Date: 2026-07-14

## Scope, provenance, and legal boundary

This is a behavioral/technical read of locally installed Unity metadata and a prior scout trail. **No mesh, texture, shader, animation, model weight, or other binary was copied or extracted.** Techniques and architecture only.

Evidence labels:

- **Observed**: readable manifest, catalog, or CoreML metadata says this directly.
- **Inferred**: the installed components strongly imply it, but no runtime or decompiled method proved the exact wiring.
- **Unknown**: not recoverable from the readable artifacts without extracting proprietary bundles/code.

Two related bundles exist and must not be conflated:

1. `ai.x.GrokApp.app` is the installed Grok client. Its Unity catalog names `Ani`, `Fox`, and `Valentine`, but their scene bundles are remote/not cached locally.
2. `inc.animation.ios.app` is the older AniChat/Animation Inc. app. It contains the fuller local scene catalogs and on-device motion CoreML packages. It is the strongest predecessor/implementation reference, **not proof that current Grok Ani uses every same motion component**.

## Located artifacts — skip the hunt next time

### Current Grok client

- App bundle: `/Users/arthur/Library/Containers/io.playcover.PlayCover/Applications/ai.x.GrokApp.app/`
- Unity framework/data: `.../ai.x.GrokApp.app/Frameworks/UnityFramework.framework/Data/`
- Addressables catalog: `.../Data/Raw/aa/catalog.json`
  - Observed remote scene bundle IDs: `AssetBundles/ani_scenes_all.bundle`, `fox_scenes_all.bundle`, `valentine_scenes_all.bundle`.
  - Observed scenes: `Assets/Scenes/Ani.unity`, `Chad.unity`, `Fox.unity`.
  - Those three bundles were **not found locally** in the app, Grok container, or PlayCover caches.
- Assembly manifest: `.../Data/ScriptingAssemblies.json`
- IL2CPP metadata: `.../Data/Managed/Metadata/global-metadata.dat`
- Current Grok support container: `/Users/arthur/Library/Containers/ai.x.GrokApp/` (no locally cached avatar bundles found).

### Older AniChat predecessor — fullest local evidence

- App bundle: `/Users/arthur/Library/Containers/io.playcover.PlayCover/Applications/inc.animation.ios.app/`
- Unity framework/data: `.../inc.animation.ios.app/Frameworks/UnityFramework.framework/Data/`
- Addressables catalog and locally present bundles: `.../Data/Raw/aa/`
  - Local groups include `fox`, `her`, and `miso`; readable catalog preserves original logical asset names.
- Assembly manifest: `.../Data/ScriptingAssemblies.json`
- CoreML motion packages at app root: `jit_audio_enc.mlmodelc`, `jit_{face,body,wrist}_{embedding,denoiser,dec}.mlmodelc`.
- Per-model readable I/O/operation metadata: each package's `metadata.json`.
- Cached product/character configuration: `/Users/arthur/Library/Containers/inc.animation.ios/Data/Library/Application Support/characters.json`
- IL2CPP metadata: `.../Data/Managed/Metadata/global-metadata.dat`.

### Prior scout/research trail

- Saved GitHub page: `/Users/arthur/Downloads/_Organized/Web_Saves/anichat.html` — this is `ummjevel/anichat`, an unrelated 2023 Korean chatbot/TTS student project, not xAI/Animation Inc. implementation documentation.
- Preliminary repo scout transcript: `/Users/arthur/.omp/agent/sessions/-agents/2026-07-03T10-24-50-856Z_019f2782-7ca8-7000-90d2-9a3f05f24f5c/GrokToolsScout.md` — correctly establishes that `~/github/grok-tools` contains no avatar implementation.
- Adjacent web-research capture: same session directory, `260.read.log`; useful only for generic VRM/uLipSync context, not Ani internals.

## Pipeline digest

### Rendering: why it looks expensive

**Observed stack:** Unity URP, NiloToon URP shader/runtime, NiloToon anime post, NiloToon bloom, motion blur/Kino Motion, uber-post, Cinemachine, volumetric light beams, Bakery runtime, Lux URP wind assets, MagicaCloth 2, and LWGUI. The same core assembly set appears in both the Grok and older AniChat Unity manifests.

The older Miso catalog exposes the material recipe without copying it: separate face/body/hair/clothes/stockings/metal materials; albedo, AO, normal, opacity, face-shadow, hair-specular and dress-specular masks; multiple material-specific matcaps; both `materials(lilToon)` and production material variants. Her uses albedo/transparency, metallic-smoothness, normal, AO and hair masks. Fox has separate body/head/fur/eyes materials.

**Conclusion:** the premium look is not one magic shader and probably not high polygon count alone. It is authored, region-specific material response + face/hair shadow masks + matcaps/specular control + controlled URP lighting + post bloom/motion blur + secondary cloth/hair motion. NiloToon post resources are explicitly present. The exact outline method is **unknown** from the catalog; do not claim inverted hull or screen-space Sobel as fact. It is NiloToon-owned rather than VRM MToon-owned.

### Face system

- `uLipSync.Runtime` and its animator/VRM sample assemblies are installed in both apps. uLipSync is an MFCC/audio-analysis lip-sync path; exact production component wiring is **inferred**, not proven by the assembly list alone.
- The older neural face decoder emits `[1, 8, 52]` float frames from a 128-D latent plus two-frame latent history. This is **exactly 52 output scalars per frame**, but no readable channel-name table proves these are Apple's canonical ARKit-52 names. Treat it as a custom 52-DOF face vector until naming is verified.
- Face diffusion/denoising is audio-conditioned: the face denoiser accepts 128-D noisy latent, two-frame history, a 256-D `body_motion_latent`, timestep, integer `class_labels`, and `[1,10,256]` audio features. This explicitly couples face to body latent, style/class, history, and audio rather than treating lips as a detached amplitude meter.
- Face generation uses 5 denoise steps in every one of the eight cached character configs; `cfgFace=1`. Each character selects a named `faceAnimationStyle` (e.g. Princess, Glamorous Diva, Villain Male).
- Authored eye/blink clips and controllers coexist with generated face motion (`Fox_Blink`, `Fox_Eyes`, `Her_blink`, `Eyes_Her`). **Inferred layering:** authored blink/eye state overlays or constrains the generated face stream.
- Expression composition details, shape names, viseme inventory, and override rules are **unknown**. There is no local evidence of Perfect Sync naming or ARKit semantic layering.

### Body animation

- This is hybrid authored + generated motion, not a giant clip jukebox.
- Older body decoder: 256-D latent + two-frame history → `[1,8,211]` output. Wrist has its own embedding/denoiser/decoder family with the same large decoder class, so hands/wrists are modeled separately rather than left entirely to retargeted body motion.
- Cached configs select `animationStyle`, `faceAnimationStyle`, and `idleAnimationStyle` independently; all use 5 body and 5 face denoise steps, CFG 1. Old sway flags exist for body/face/wrist but are false in the cached production configs.
- Catalog exposes at least nine authored BVHs in the locally present subset: six Miso gestures, `Her_loop`, `gogo_sample`, and `Fox_loop`. It also exposes explicit tap/peek, spin, sway, tease and command variants. This is a lower bound, not total library size.
- **Inferred runtime structure:** authored idle/command/interaction clips provide dependable state transitions; audio-conditioned short-horizon neural output supplies continuous conversational body/face/wrist motion; history inputs maintain continuity; style labels select character mannerisms.
- MagicaCloth 2 supplies secondary cloth/hair/accessory motion. Lux wind support is present. No VRM Spring Bone dependency appears in the assembly manifest; this is a Unity rig/cloth solution, not a portable VRM spring setup.

### Model and rig specs / dimension matching

- Models are scene-specific FBX rigs (`Miso.fbx`, `HER.fbx`, `Fox.fbx`) rather than a uniform VRM catalog. Miso even contains distinct rig/source FBXs. That favors bespoke per-character calibration over interchangeability.
- **Unknown:** triangle count, vertex count, texture pixel dimensions, exact deform-bone count, total transform count, and measured body proportions. Readable catalogs expose names and material decomposition, not those values. Any numeric budget here would be fabricated.
- Practical lesson for Arthur's dimension-matching question: match the generator/retargeter to a canonical semantic skeleton and measured humanoid proportions, then keep a per-character output projection. AniChat's 211-D body output is not evidence that models share identical bone dimensions; it is evidence of a fixed motion representation decoded into character-specific rigs.
- The expensive look is compatible with moderate geometry if face topology, normals, masks, silhouette, hair cards, cloth weights, and shader authoring are excellent. Budget review should therefore score deform quality and material regions, not only triangles.

### State, emotion, voice

- Cached character records jointly select: system prompt/persona, `voice`, `voice_instruct`, animation style, face style, idle style, scene, ambient audio, and music. This is a product-level character bundle, not a fully generic avatar swap.
- Neural denoisers take integer `class_labels`; cached style names likely map to those classes. Audio features drive motion while voice instructions drive speech delivery. **Observed coupling is character/style + audio + body latent**, not a semantic emotion event bus.
- No readable evidence shows explicit VAD/emotion vectors, named emotion events, or one emotion object atomically controlling face + body + voice. The coupling is coarser but coherent: one character preset chooses all three domains, and audio prosody conditions generated motion.
- This makes style consistency strong but hot-swap/model neutrality weak compared with our architecture.

### Realtime / latency / LOD

- Motion is decoded in short 8-frame blocks with two-block/history features; face conditioning sees 10 audio feature steps. This is a bounded rolling-window design, suitable for streaming and continuity.
- Five denoise steps is a conspicuously small fixed sampling budget. CoreML packages target iOS 17 and carry TorchScript/coremltools 8.1 provenance, so the older app pushes motion inference onto Apple accelerators rather than waiting for a server.
- Approximate major weight sizes: face decoder 3.1 MB + face denoiser 3.6 MB; body decoder 24.3 MB + denoiser 25.7 MB; wrist decoder 24.3 MB + denoiser 25.9 MB; audio encoder 3.5 MB, plus embeddings. Separate modules allow independent loading/failure/quality tiers **in principle**; actual runtime LOD switching is unproven.
- Current Grok bundle does not contain those `jit_*` packages at its root. It may have changed delivery/inference strategy; no current-motion equivalence is claimed.
- No observed mesh LOD groups, texture streaming policy, dynamic resolution rule, or measured motion latency. Addressables clearly separate character scenes/bundles, which is useful load isolation, not proof of geometric LOD.

## Comparison with our stack

| Axis | AniChat / Grok reference does better | Our stack does better | Legally clean adoption |
|---|---|---|---|
| Anime rendering | Purpose-built NiloToon/URP art pipeline; per-region masks, matcaps, face shadows, bloom/motion blur, authored lighting | Portable three-vrm MToon, inspectable Web renderer, model hot-swap | Add an original, renderer-owned anime polish pass and material-profile schema; copy no shader/assets |
| Outline/post | Integrated toon post resources and cinematic camera/post stack | MToon portability and simpler predictable cost | A/B original screen-space silhouette/contact-line pass; retain MToon outline fallback |
| Face | Audio + history + style + body-latent short-horizon face generation; authored blink/eyes coexist | Verified canonical ARKit-52/Perfect Sync donors, named channels, graceful degradation, capture inverse tests | Keep ARKit semantics; add low-rank residual performance over deterministic projection |
| Body | Separate generated body and wrist motion; class/style-conditioned 8-frame chunks; authored clips underneath | Deterministic five-pass L0, bounded semantic primitives, arbitration, cancellation, no model dependency | Optional residual lane below semantics and above rig projection, never a second writer |
| Secondary motion | Production MagicaCloth + wind, scene-tuned per character | Portable VRM spring groups and channel manifests | Author intent-grouped spring/cloth profiles and browser budget tiers |
| State/emotion | One character preset coherently bundles voice, face/body style, scene and music | Typed semantic lanes, VAD/affect mix, source identity, playback anchors, hot-swap, inspectability | Add a style preset as parameters to existing lanes, not as a new authority |
| Realtime | On-device CoreML, 5-step diffusion, fixed 8-frame chunks/history | Zero-await 60 Hz L0 continues through model/network failure | Optional ahead-of-playhead local worker with deadline/drop/decay contract |
| Models | Bespoke rigs/materials maximize hero-character finish | VRM interchangeability, measured manifests, Perfect Sync profiles | Keep model-neutral contract; permit hero-specific shader/proportion profiles |

## Top five concrete adoptions

Effort assumes one engineer familiar with the current app; ranges include focused tests and lab controls, not asset authoring time.

1. **Original anime material-profile + post stack — M, 5–8 engineer-days.** Extend `apps/ai-companion-rtc/public/rig-profiles.ts` shader capabilities/safety ranges; implement original rim/matcap/face-shadow-mask controls and conservative bloom/color shaping in `public/vrm-body.ts`; expose A/B controls in `public/lab/controls.tsx`. Preserve MToon as base and fallback. Biggest immediate visual return.
2. **Mask-aware character authoring contract — S/M, 3–5 days plus art.** Extend the local avatar catalog/inspection pipeline (`public/avatar-catalog.ts`, Blender tooling under `packages/blender-cli/`) to report/validate optional face-shadow, hair-specular, matcap, AO and opacity roles, texture dimensions, triangles, deform bones, and humanoid proportions. This answers dimension matching with measurements rather than guesses.
3. **Audio-conditioned residual motion worker — L, 15–25 days after a prototype model exists.** Add a Web Worker module beside `public/vrm-body.ts` that predicts short head/torso/hand residual chunks from actual-played audio + two-chunk history. Feed results into a new lowest-authority bounded residual input inside the existing five-pass L0; semantic lanes remain authoritative and L0 remains sole writer. Deadline miss = drop/decay, never queue.
4. **Character style bundle — M, 5–7 days.** Add typed `motionStyle`, `faceStyle`, `idleStyle`, `voiceStyle`, and environment-lighting parameters to persona/catalog configuration; project them through existing `AffectMix`, motion primitives, TTS voice controls, and rig profiles. Land schema/server pieces in `src/personas.ts` / protocol types and projection in `public/vrm-body.ts`; do not add opaque class labels as a parallel emotion system.
5. **Authored-command + generated-continuation layering — M/L, 8–12 days.** Keep reliable authored VRMA/social primitives for onset/semantic beats, then blend a generated or procedural continuation only during hold/release and speech idle. Implement masks, interruption, and phase ownership in `public/vrm-body.ts`; author/inspect clips via the existing motion lab. This captures AniChat's dependability + fluidity without proprietary clips or models.

## Bottom line

The most valuable clean-room lesson is architectural: **hero-grade authored materials and secondary motion, dependable authored state clips, then a small history-aware audio-conditioned residual generator for continuous life.** Do not copy the predecessor's monolithic character bundles or opaque 52/211-channel representations. Our named semantics, Perfect Sync channels, deterministic arbitration, and model-neutral manifests are the stronger control plane; the gap is art-directed rendering and short-horizon motion richness.
