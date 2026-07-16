# Static findings — AniChat / Grok pose investigation

> **Scope:** Stages 1–2 only. Static architecture and metadata; no model execution, no runtime capture, no runs claimed.  
> **Evidence labels:** **Observed** = readable local metadata/file identity; **Inferred** = reasoned implication; **Unknown** = not recoverable from permitted evidence.  
> **Sources:** mandatory note `streams/companion/notes/anichat-pipeline-recon.md`; scout outputs `history://CurrentGrokScout`, `history://OlderAniScout`, `history://CoreMLScout`, `history://CompanionArchScout`.

## 1. Generation-separated artifact comparison

| Aspect | Current Grok `ai.x.GrokApp.app` | Older AniChat `inc.animation.ios.app` |
|---|---|---|
| **App identity** | Bundle ID `ai.x.GrokApp`, display name `Grok`, short version `1.1.27`, build `571`, min iOS 11 (**Observed**: `Info.plist`) | Bundle ID `inc.animation.ios`, display name `Anichat`, version `2.2.3`, build `134`, min iOS 11 (**Observed**: `Info.plist`) |
| **Install path** | `/Users/arthur/Library/Containers/io.playcover.PlayCover/Applications/ai.x.GrokApp.app/` | `/Users/arthur/Library/Containers/io.playcover.PlayCover/Applications/inc.animation.ios.app/` |
| **Unity build GUID** | `dc6ee664b3644ef39a4a27c9124f1e33` (**Observed**: `boot.config`) | Not recorded in this scope |
| **Addressables version** | `1.22.3`, target `iOS` (**Observed**: `Data/Raw/aa/settings.json`) | `1.22.3`, target `iOS` (**Observed**: `Data/Raw/aa/settings.json`) |
| **Catalog build hashes** | `m_SettingsHash` = `7e0ed9306ce7b251a6c2233b2c5ce756`; `m_BuildResultHash` = `8604e2976dfdeeba4980906939db98c3` (**Observed**) | `m_SettingsHash` = `0d2e51d92470034431aa9a18dfaf8ea0`; `m_BuildResultHash` = `265680c2b2d53a2c5e13dd0a821bbabb` (**Observed**) |
| **Visible scene bundle IDs** | `AssetBundles/ani_scenes_all.bundle`, `AssetBundles/fox_scenes_all.bundle`, `AssetBundles/valentine_scenes_all.bundle` (**Observed**: `catalog.json` `m_InternalIds`) | Logical scene/asset paths and `fox`/`her`/`miso` group prefixes observed in catalog internal IDs; exact names not identical to current Grok (**Observed**) |
| **Scenes named in catalog** | `Assets/Scenes/Ani.unity`, `Chad.unity`, `Fox.unity` (**Observed**) | Scene assets observed in `m_InternalIds` (e.g., `Assets/Scenes/` paths) (**Observed**) |
| **Local character bundles** | **Absent** from local `iOS/` bundle dir, support container, and PlayCover cache (**Observed**: scoped absence) | Present: 8 named local bundles in `Data/Raw/aa/iOS/` (**Observed**: directory listing) |
| **Core ML motion packages** | **Absent** from app root and searched paths (**Observed**: scoped absence) | 10 `jit_*.mlmodelc` packages at app root (**Observed**: directory listing + `metadata.json`) |
| **Character config** | No readable local character config found | `characters.json` with 8 enabled records, scene/style/voice/audio/animation fields (**Observed**: JSON) |
| **Debug config** | Not inspected | `debug_config.json` with `status`/`config` and `classicModeConfig` (**Observed**) |
| **Assembly manifest** | 148 entries; Addressables, ResourceManager, MagicaCloth, NiloToon, uLipSync, Animation.Rigging, Cinemachine, VLB, URP, Bakery (**Observed**: `ScriptingAssemblies.json`) | 148 entries; same broad families plus project-specific and uLipSync sample/VRM/animator assemblies (**Observed**: `ScriptingAssemblies.json`) |
| **IL2CPP metadata** | Version 31; 11,455 type, 50,574 field, and 75,567 method identities indexed (**Observed**). Runtime behavior/call graph **Unknown**. | Version 31; 11,354 type, 50,178 field, and 74,692 method identities indexed (**Observed**). Runtime behavior/call graph **Unknown**. |
| **Rendering resource types** | `IAssetBundleResource`, `CharactersBuildConfig`, `SceneInstance`, `GameObject`, `Texture2D`, `Material`, `TMP_FontAsset`, `TextAsset`, `Shader`, `Mesh`, `Texture3D`, `TMP_SpriteAsset`, `TMP_StyleSheet`, `TMP_Settings`, `VLB.Config` (**Observed**: `catalog.json` `m_resourceTypes`) | 20+ resource types covering config, GameObject/SceneInstance, materials, meshes, textures, animation/controller assets, text, URP volume assets, VLB config (**Observed**: catalog `m_resourceTypes`) |
| **Current/older equivalence** | — | Shared Unity Addressables 1.22.3 and overlapping vendor assemblies are **Inferred** continuity hints, **not proof** of identical runtime wiring or model payloads. The two generations must be indexed separately. |

## 2. Exact model I/O (older AniChat Core ML)

All data below are read from each package's `metadata.json` only. No weight, `.mil`, or `coremldata.bin` contents were read, and no model was executed.

| Model | Role | Inputs (name, dtype, shape) | Outputs (name, dtype, shape) | Size / provenance |
|---|---|---|---|---|
| `jit_audio_enc.mlmodelc` | Audio feature encoder | `input` F32 `[1,1,80,40]` (flexible second axis `[1,4096]`) | `linear_0` F32 `[]` | metadata 1.9 KB, `model.mil` 18.1 KB, weight.bin 3.5 MB (**Observed**) |
| `jit_face_embedding.mlmodelc` | Face latent projection | `input_1` F32 `[1,2,52]` | `linear_0` F32 `[1,2,128]` | metadata 1.5 KB, `model.mil` 934 B, weight.bin 26.7 KB (**Observed**) |
| `jit_face_denoiser.mlmodelc` | Face diffusion denoising | `noised_latent_1` F32 `[1,128]`, `history_features_1` F32 `[1,2,128]`, `body_motion_latent_1` F32 `[1,256]`, `times_1` F32 `[1]`, `class_labels_1` Int32 `[1]`, `audio_1` F32 `[1,10,256]` | `var_647` F32 `[1,128]`, `var_648` F32 `[1,128]` | metadata 3.7 KB, `model.mil` 64.4 KB, weight.bin 3.6 MB (**Observed**) |
| `jit_face_dec.mlmodelc` | Face decoder | `z_1` F32 `[1,128]`, `history_embed_1` F32 `[1,2,128]` | `linear_27` F32 `[1,8,52]` | metadata 2.3 KB, `model.mil` 91.8 KB, weight.bin 3.1 MB (**Observed**) |
| `jit_body_embedding.mlmodelc` | Body latent projection | `input_1` F32 `[1,2,211]` | `linear_0` F32 `[1,2,256]` | metadata 1.5 KB, `model.mil` 938 B, weight.bin 212.2 KB (**Observed**) |
| `jit_body_denoiser.mlmodelc` | Body diffusion denoising | `noised_latent_1` F32 `[1,256]`, `history_features_1` F32 `[1,2,256]`, `times_1` F32 `[1]`, `class_labels_1` Int32 `[1]`, `audio_1` F32 `[1,10,256]`, `gaze_dir_1` F32 `[1,3]` | `var_1189` F32 `[1,256]`, `var_1190` F32 `[1,256]` | metadata 3.7 KB, `model.mil` 114.5 KB, weight.bin 25.7 MB (**Observed**; corrected: `body_motion_latent_1` removed — not present in body_denoiser metadata; see `runtime-findings.md` §8) |
| `jit_body_dec.mlmodelc` | Body decoder | `z_1` F32 `[1,256]`, `history_embed_1` F32 `[1,2,256]` | `linear_55` F32 `[1,8,211]` | metadata 2.3 KB, `model.mil` 180.7 KB, weight.bin 24.3 MB (**Observed**) |
| `jit_wrist_embedding.mlmodelc` | Wrist latent projection | `input_1` F32 `[1,2,225]` | `linear_0` F32 `[1,2,256]` | metadata 1.5 KB, `model.mil` 938 B, weight.bin 226.2 KB (**Observed**) |
| `jit_wrist_denoiser.mlmodelc` | Wrist diffusion denoising | `noised_latent_1` F32 `[1,2,256]`, `history_features_1` F32 `[1,4,256]`, `body_motion_latent_1` F32 `[1,256]`, `times_1` F32 `[1]`, `class_labels_1` Int32 `[1]`, `audio_1` F32 `[1,10,256]` | `var_1206` F32 `[1,2,256]`, `var_1207` F32 `[1,2,256]` | metadata 3.8 KB, `model.mil` 118.3 KB, weight.bin 25.9 MB (**Observed**) |
| `jit_wrist_dec.mlmodelc` | Wrist decoder | `z_1` F32 `[1,256]`, `history_embed_1` F32 `[1,2,256]` | `linear_55` F32 `[1,8,225]` | metadata 2.3 KB, `model.mil` 180.7 KB, weight.bin 24.3 MB (**Observed**) |

### Model graph notes

- **Runtime provenance:** every package is Core ML MLProgram specification 8, Float32 storage, TorchScript source (`torch==2.5.1`, `coremltools==8.1`), advertised availability macOS 14 / iOS 17 (**Observed**: `metadata.json`).
- **State/history:** all packages have empty `stateSchema` and empty `modelParameters`; history is supplied as explicit input tensors, not as Core ML state (**Observed**: `metadata.json`).
- **Family separation:** face, body, and wrist each have `embedding → denoiser → decoder` triplets. Wrist has a distinct input dimension (`225`) and history length (`4`), so it must **not** be folded into the 211-D body output.
- **Edge confidence:**
  - Embedding → denoiser and denoiser → decoder are **Inferred** role hypotheses from dimensionality and generated names, **not proven** chains.
  - The audio encoder output shape is `[]` while denoiser `audio_1` is `[1,10,256]`; the audio-feature bridge is **Unknown**.
- **Channel semantics:** 52, 211, and 225 output dimensions are anonymous indexed values until a verified channel map is observed. The 52-D face output is **not proven** to be canonical ARKit-52 names.

## 3. State and authority

- **Older AniChat:** `characters.json` records select `sceneIndex`, `animationStyle`, `faceAnimationStyle`, `idleAnimationStyle`, `voice`, `voice_instruct`, `ambient`, `music`, and `systemPrompt` together (**Observed**). This is product-level co-selection, not evidence of a single atomic emotion/event bus (**Inferred**). The exact runtime state machine (idle, listening, thinking, speaking, interruption, command/gesture, tap/peek) is **Unknown** without `global-metadata.dat` parsing or runtime observation.
- **Current Grok:** Catalog references scene and character resources, but no runtime state machine evidence is readable. `global-metadata.dat` is opaque. Runtime state and authority are **Unknown**.
- **Companion architecture (adoption boundary):** upper layers emit typed `MotionPrimitive` / `AffectEvent` values; only browser L0 writes bones, expressions, shaders, and output gains (**Observed**: `streams/companion/HANDOFF-BEHAVIOR.md`, `apps/ai-companion-rtc/src/server-protocol.ts`, `apps/ai-companion-rtc/public/vrm-body.ts`). Lanes are `sync > react > async`; source is `self|user|world`; L1 filters `self`; sync anchors to actual-played audio offsets; cancellation clears targeted acts by utterance/epoch; L1 drops rather than queues (**Observed**).

## 4. Scoped absences

All absences are scoped to the exact locations searched; they are not whole-device guarantees.

| Searched scope | Absent item | Generation | Implication |
|---|---|---|---|
| `ai.x.GrokApp.app/Data/Raw/aa/iOS/` | `ani_scenes_all.bundle`, `fox_scenes_all.bundle`, `valentine_scenes_all.bundle` | Current Grok | Character scene bundles are not bundled locally; remote delivery is **Inferred** but unproven. |
| `/Users/arthur/Library/Containers/ai.x.GrokApp/` (support container: `Application Support/GrokApp`, `Caches`, `Documents`, `SystemData`, `HTTPStorages`) | Any avatar/scene bundle-like files; local caches empty of scene content | Current Grok | No local cached copies of the referenced bundles were found. |
| `/Users/arthur/Library/Containers/io.playcover.PlayCover/` (PlayCover cache) | `AssetBundles` directory containing current Grok scene names | Current Grok | Scoped absence in PlayCover-managed cache. |
| `ai.x.GrokApp.app/**` recursive | `jit_*.mlmodelc` Core ML packages | Current Grok | No on-device motion model equivalent to older `jit_*` family was found. |
| Older app local bundles | Current Grok scene names (`Ani.unity`, `Chad.unity`, `Fox.unity` bundles) | Older AniChat | Expected separate product; confirms non-equivalence of asset names. |

## 5. Exact blockers

| # | Blocker | Checked | Impact | Constraint | Lawful next step |
|---|---|---|---|---|---|
| 1 | Current Grok character scene bundles are not locally present. | App local `iOS/` bundle dir, support container, PlayCover cache searched. | Blocks current-generation scene/model/animation inspection and any current-Grok model equivalence claim. | Cannot fetch remote Addressables. | Observe lawfully cached content at runtime in a controlled session; do not bypass controls. |
| 2 | ~~`global-metadata.dat` (both apps) is unreadable by permitted tools.~~ **Superseded:** IL2CPP v31 parser (`src/il2cpp.ts`) now reads both files in-place. Current: 11,455 types / 50,574 fields / 75,567 methods; Older: 11,354 / 50,178 / 74,692. Names observed; call behavior/state machine remain **Unknown**. See `runtime-findings.md` §9. | Parsed by `src/il2cpp.ts`; results in ledger `types_symbols`. | ~~Blocks IL2CPP type/method/state-machine extraction.~~ Type/method/field names extracted; runtime behavior still Unknown. | Clean-room parser; no decompilation. | Names indexed. Runtime tracing would require separate lawful observation. |
| 3 | Core ML preprocessing and scheduler are unknown. | `metadata.json` contains no audio sample rate, hop, normalization, mel/dim, noise schedule, 5-step math, CFG details, history init/rollover, frame rate, or overlap. | Blocks Stage 3–4 chained execution and any semantic correctness claim. | No proprietary code/assets may be copied. | Inspect any readable config/plist for preprocessor parameters; build a metadata-only harness first. |
| 4 | Audio encoder output shape `[]` vs denoiser `audio_1` `[1,10,256]`. | Exact I/O shapes from metadata. | Blocks direct audio → denoiser edge claim. | — | Identify intermediate audio-feature module in catalog or runtime. |
| 5 | No current Grok `jit_*` packages found. | Recursive search of current app. | Blocks claim that current Grok uses the same on-device motion model family. | — | Inspect remote bundle payloads when lawfully cached; compare catalog resource types. |
| 6 | Face/body/wrist output channel semantics are unknown. | 52/211/225 output shapes observed; no channel-name table in readable metadata. | Blocks semantic labeling, retargeting, and ARKit mapping. | No bundle payload extraction. | Verify against local Perfect Sync channel maps or clean-room calibration data. |
| 7 | ~~Model execution not performed in this session.~~ **Superseded:** All 10 older AniChat `jit_*.mlmodelc` packages loaded and predicted. See `runtime-findings.md` §1–4. | 10/10 shape smokes (seed-17), 10/10 benchmarks (seed-23), 2 deterministic runs (seed-101), 2 cancellation tests. | ~~No runtime latency data.~~ Latency, memory, output shape, and determinism data captured. ANE/CPU utilization still **Unknown**. | Models loaded in-place; no weights copied; no model chaining. | Capture compute-unit utilization via Instruments or `powermetrics` if needed. |

## 6. FaceKit sibling status (compact)

A separate macOS FaceKit sidecar is already working locally without an iPhone. **Observed** in sibling work: AppleCVA API 42 loads inside an ordinary app-bundle wrapper (`apps/ai-companion-rtc/scripts/apple-face-oracle-macos/FaceKitProbe.m`); the MacBook webcam delivers 640×480 full-range bi-planar Y′CbCr frames; Vision rectangle detection feeds FaceKit's color-only tracker; the callback returns 51 float blendshapes plus separate tongue, finite detector head angles, confidence/failure, gaze/eyes, and 132 landmark scalars; output is forwarded over UDP to the Motion Lab as provider `facekit-macos`. No FaceKit code was modified or run in this AniChat/Grok investigation. (Sources: `apps/ai-companion-rtc/docs/face-mirror.md`, `apps/ai-companion-rtc/scripts/apple-face-oracle-macos/FaceKitProbe.m`, `docs/research/hoshino-lina-facekit/cleaned/public-facekit-observations.md`.)

## 7. Static adoption notes for Companion

- Keep Companion's typed semantic lanes (`sync > react > async`) and the single-L0-writer invariant.
- Treat predecessor outputs (52/211/225) as anonymous indexed vectors until a channel map is demonstrated.
- If an audio-conditioned residual worker is added, place it as the **lowest-authority** lane below semantic arbitration, with a strict contract: deadline miss → drop/decay, never queue.
- Use style/class presets as parameters to existing lanes, not as a parallel emotion authority.
- Preserve actual-played audio offsets and `source: self|user|world` identity; assistant output must never become user input.
- Do not copy proprietary weights, bundles, or assets into the repo or any deliverable.

## 8. Source index

- `streams/companion/notes/anichat-pipeline-recon.md` — mandatory starting map.
- `history://CurrentGrokScout` — current Grok app identity, Addressables, scoped absences.
- `history://OlderAniScout` — older AniChat catalog, bundles, `characters.json`, `ScriptingAssemblies.json`.
- `history://CoreMLScout` — exact Core ML signatures, provenance, model graph roles.
- `history://CompanionArchScout` — Companion typed semantic/L0 architecture, protocol, timing, cancellation.
- `streams/companion/HANDOFF-BEHAVIOR.md` — Companion load-bearing invariants.
- `apps/ai-companion-rtc/src/server-protocol.ts` — frozen wire types.
- `docs/prompts/anichat-grok-pose-system-investigation.md` — investigation prompt and acceptance criteria.
- `runtime-findings.md` — runtime execution evidence, benchmarks, IL2CPP parsing, corrections to this document.
- `reproduction-index.md` — reproduction commands, receipt manifest, ledger queries, adoption summary.
- `packages/anichat-motion-lab/data/runs/*.json` — all execution receipts.
- `packages/anichat-motion-lab/data/ledger.sqlite` — structured ledger database.
