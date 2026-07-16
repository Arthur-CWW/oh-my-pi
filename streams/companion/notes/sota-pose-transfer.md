# SOTA pose transfer: video motion for the live VRM rig

**Decision, 2026-07-14:** stand up **GVHMR** first, pinned to [`zju3dv/GVHMR@6ec3ca39336c50492c0fae65fba2fb831fc7d866`](https://github.com/zju3dv/GVHMR/tree/6ec3ca39336c50492c0fae65fba2fb831fc7d866). It is the shortest credible route from a monocular dance clip to temporally coherent, world-grounded SMPL-X motion that can be retargeted into our live VRM rig. Do not use a video-diffusion character animator as the live-rig motion source.

This is an analysis and pilot decision, not a claim that GVHMR has run on Arthur's desktop. Resource figures labeled **estimate** below must be replaced with measurements from the sibling-owned GPU pilot.

## What problem are we solving?

There are two different product families hiding under “pose transfer.” They do not produce interchangeable artifacts.

1. **Video → rig motion** recovers a body model, joint rotations and usually root/camera trajectory. That output can drive our existing `three.js` + `@pixiv/three-vrm` avatar every frame, be edited, blended with L0, and exported as `.vrma` or a body track.
2. **Video → video character animation** synthesizes pixels of a chosen character following a driving performance. It is appropriate for rendered content, but produces no dependable humanoid control stream for the live companion.

Our current browser capture is **MediaPipe PoseLandmarker Full / BlazePose GHUM**: a lightweight, real-time, on-device model whose 33-landmark design dates to the 2021-era BlazePose GHUM line, not current offline human-motion recovery. Google describes the model as BlazePose GHUM with 33 landmarks ([MediaPipe pose guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker); [BlazePose GHUM announcement](https://blog.tensorflow.org/2021/08/3d-pose-detection-with-mediapipe-blazepose-ghum-tfjs.html)). It is a sensible interactive fallback. It is not a SOTA dance-mocap extractor. The custom five-pass L0 animation blender and MToon renderer are downstream of capture and are not the limiting component here.

## Family A — monocular video → SMPL/SMPL-X → VRM

| Method | What it actually returns | World grounding | Practical fit for Sico dance | License / operational cost | Decision |
|---|---|---|---|---|---|
| **GVHMR** (SIGGRAPH Asia 2024) | Per-frame in-camera and global SMPL-X parameters plus camera intrinsics and intermediate predictions. The pinned demo saves both `smpl_params_global` and `smpl_params_incam` ([prediction contract](https://github.com/zju3dv/GVHMR/blob/6ec3ca39336c50492c0fae65fba2fb831fc7d866/hmr4d/model/gvhmr/gvhmr_pl_demo.py#L37-L44)). | Yes: gravity-view coordinates and camera rotation from SimpleVO by default; static-camera mode can skip VO. The demo records measured inference time separately from preprocessing/rendering ([demo](https://github.com/zju3dv/GVHMR/blob/6ec3ca39336c50492c0fae65fba2fb831fc7d866/tools/demo/demo.py#L305-L323)). | Best first fit: coherent global root, body shape, smooth temporal motion, and a direct parametric skeleton. SimpleVO is materially easier than a compiled SLAM stack. | Code is **research/education/non-profit only**, modifications must be open-source, commercial use requires permission ([license](https://github.com/zju3dv/GVHMR/blob/6ec3ca39336c50492c0fae65fba2fb831fc7d866/LICENSE)). SMPL and SMPL-X downloads require separate registrations; checkpoints have their own terms ([install](https://github.com/zju3dv/GVHMR/blob/6ec3ca39336c50492c0fae65fba2fb831fc7d866/docs/INSTALL.md)). **Pilot estimate:** 12–16 GB peak VRAM, roughly 0.25–1.0× real-time end-to-end on an RTX 4090-class card depending on resolution and VO; not an observed number. | **First pipeline.** |
| **WHAM** (CVPR 2024) | Temporal SMPL pose and global trajectory, with optional temporal SMPLify refinement. | Yes, using camera angular velocity and SLAM; can run camera-relative only. | Good control baseline and the cleanest permissive-code fallback. Older than GVHMR; optional fitting adds time. | MIT code; separate SMPL/SMPLify registration and third-party weight/license checks. [Official repository](https://github.com/yohanshin/WHAM). | Second benchmark, not first install. |
| **TRAM** (2024) | Global trajectory and SMPL motion from a staged tracker + Masked DROID-SLAM + VIMO pipeline. | Yes; explicitly estimates camera, gravity/floor and metric scale using several subsystems. | Strong world-motion candidate, especially moving-camera footage, but more integration surface and compiled SLAM risk than GVHMR. | MIT code; separate SMPL and third-party model terms. Its official demo is three sequential stages ([repository](https://github.com/yufu-wang/tram)). | Benchmark only if GVHMR root/ground contact fails. |
| **4D-Humans / HMR 2.0** (ICCV 2023) | Per-person SMPL pose/shape and PHALP tracklets (`.pkl`) from frames/video. | Primarily camera-relative; tracking is strong, but world trajectory/ground is not the core deliverable. | Useful detector/initializer and occlusion fallback; insufficient alone for faithful travelling dance/root motion. | MIT code; separate SMPL terms. Official tracking output contains tracklets with 3D pose and shape ([repository](https://github.com/shubham-goel/4D-Humans)). | Component/baseline, not the final pipeline. |

### Why GVHMR wins the first slot

- It solves the part BlazePose does not: temporal, parametric, world-grounded motion rather than independent lightweight landmarks.
- It emits both camera-frame and global SMPL-X parameters, so we can inspect whether errors come from body recovery or world/root recovery.
- The current pinned revision defaults to SimpleVO; DPVO remains optional. That lowers installation and maintenance risk while retaining moving-camera support ([README](https://github.com/zju3dv/GVHMR/tree/6ec3ca39336c50492c0fae65fba2fb831fc7d866#quick-start)).
- It is an offline extractor. That is correct for the clip library; BlazePose remains the latency-first live mirror.

The blocker is licensing, not architecture: GVHMR is acceptable for this local private non-commercial research pilot, but it cannot silently become a commercial production dependency. WHAM is the permissive-code fallback, although the SMPL assets and all downloaded checkpoints still need independent review.

### Exact pilot contract

**Repository:** `https://github.com/zju3dv/GVHMR`  
**Commit:** `6ec3ca39336c50492c0fae65fba2fb831fc7d866` (verified GitHub commit dated 2026-05-21)  
**Mode:** use `--static_cam` only for a genuinely fixed camera; otherwise default SimpleVO. Do not start with DPVO.  
**Inputs:** the original MP4, source checksum, declared fps and orientation.  
**Required raw artifact:** `hmr4d_results.pt`, not merely a rendered preview. Preserve `smpl_params_global`, `smpl_params_incam`, `K_fullimg`, fps and source timestamps.  
**Pilot quality report:** 2D reprojection error, foot skating during inferred contacts, root drift on stationary intervals, left/right swaps, twist spikes, dropped/occluded frames, wall time and peak VRAM.

No official GVHMR VRAM or end-to-end RTX runtime number was found in its repository. The 12–16 GB / 0.25–1.0× estimates above are scheduling bounds, not evidence. The first desktop run must record `nvidia-smi` peak memory and stage timings. For context, the project reports training the release checkpoint with two 4090s, but that says nothing precise about inference memory ([README](https://github.com/zju3dv/GVHMR/tree/6ec3ca39336c50492c0fae65fba2fb831fc7d866#reproduce)).

## Retarget and artifact flow

GVHMR does not directly output VRM animation. The conversion seam should be explicit and deterministic:

1. Read per-frame `smpl_params_global`: body shape, global orientation, articulated pose and translation. Preserve the original timestamps instead of assuming an output cadence.
2. Run SMPL-X forward kinematics once per frame. Convert from GVHMR/SMPL coordinates to the declared VRM coordinate basis.
3. Calibrate one neutral frame: source rest-local rotation → target VRM humanoid rest-local rotation. Retarget rotations hierarchically, distribute spine/neck rotation, preserve hinge axes, clamp impossible twist and keep quaternion continuity (`dot(q[t], q[t-1]) >= 0`).
4. Solve contacts after retargeting, not before: infer left/right foot contacts from global ankle/toe velocity and height, then correct pelvis/root to hold planted feet. This is where world-grounded recovery matters.
5. Export two artifacts from the same solved frames:
   - `.vrma`: humanoid bone rotations plus hips translation for portable review.
   - our body track: map onto the existing 13-bone order (`hips`, `spine`, `chest`, `neck`, `head`, bilateral upper/lower arms and legs), quantize normalized quaternions with the current scale 32767, preserve per-region confidence, source fps and `tMs`.

**Schema truth:** body-track v1 can carry the 13 local rotations and confidence, but it has no root translation, foot-contact bits, body shape or source-coordinate metadata. A v1 converter can therefore drive the live rig, but it discards the principal world-grounding advantage. A future v2 should add at least `rootTranslation`, `contacts`, `sourceModel`, `coordinateBasis`, and a degradation/confidence channel. Until then, retain the raw `.pt` and `.vrma` beside v1 JSON so the information is not destroyed.

## Family B — driving video + character image → generated video

These models synthesize final pixels. They are useful for authored Pleometric-style content, not as the control source for a realtime VRM.

| Method | Strength | Published resource signal | License | Why it is not the live-rig answer |
|---|---|---|---|---|
| **Wan2.2-Animate / Wan-Animate 14B** | Current strongest listed option here for holistic character animation/replacement: consumes a reference image plus pose and face videos, supports animation and replacement modes. [Official pipeline example](https://github.com/Wan-Video/Wan2.2/blob/main/README.md#2-run-in-animation-mode). | Official 14B single-GPU examples are heavyweight; the base Wan2.2 README says its 14B single-GPU path needs at least 80 GB before aggressive community quantization/offload. The 5B TI2V model is different and takes under nine minutes for a five-second 720p clip on a consumer GPU. Treat 24 GB Animate workflows as optimized community deployments, not the official baseline. | Apache-2.0 for repository/models, subject to model and input-content terms ([official repository](https://github.com/Wan-Video/Wan2.2)). | Output is an MP4, with generative identity/detail changes and no authoritative joint/root stream. |
| **MimicMotion** | Long, smooth human image animation using confidence-aware DWPose guidance and progressive latent fusion. | Official README: 72-frame model uses 16 GB; a 35-second demo takes 20 minutes on a 4090 ([repository](https://github.com/Tencent/MimicMotion#vram-requirement-and-runtime)). | Apache-2.0 except listed third-party components ([license](https://github.com/Tencent/MimicMotion/blob/main/LICENSE)). | Slow pixel synthesis; pose video is conditioning, not an exported rig solution. |
| **UniAnimate** | Consistent long human-image animation; first-frame conditioning can extend sequences. | About 12 GB for 32 frames at 768×512 with CLIP/VAE offload ([repository](https://github.com/ali-vilab/UniAnimate)). | The repository does not expose a top-level license in its current file listing; company/model-weight terms must be checked before use. | DWPose-derived raster guidance and generated pixels, no SMPL/VRM motion artifact. |
| **Animate-X** | Universal animation across human and anthropomorphic character types; less strict pose alignment than earlier human-only methods. | Default output is 32 frames, 768×512 at 8 fps; no authoritative official VRAM figure in the README. | Apache-2.0 ([repository](https://github.com/antgroup/animate-x)). | Useful for rendered character shots; not temporally editable humanoid control. |

The categories can be chained—e.g. GVHMR for an editable rig proof and Wan-Animate for a polished pixel render—but one must not be evaluated as if it proves the other.

## Sico body-track measurement study

### Important data-quality finding

The existing JSONs are **not world-landmark tracks**, despite the intended analysis seam. In the current capture path, `result.worldLandmarks` drives `retargetPose`, but `quantizePoseFrame` is passed `image`, and the stored `landmarks` are normalized image landmarks ([capture call](../../../apps/ai-companion-rtc/public/pose-transfer.ts#L303-L310); [quantizer](../../../apps/ai-companion-rtc/public/pose-transfer.ts#L126-L139)). The values confirm it: x/y are normalized image coordinates and z is MediaPipe's image-relative depth, not metric world x/y/z.

All **44** files currently under `data/body-tracks/` were audited: every file is v1, every populated frame has 33 stored landmarks, and the corpus contains 14,643 frames across five image dimensions. The storage finding is corpus-wide, not inferred from one clip.

Therefore true camera-invariant anthropometry and absolute stature cannot be computed from these files. The calculations below are the strongest honest proxy available, not “world measurements.” They are useful for diagnosing relative proportions and capture consistency only.

### Method

Five clips were chosen because each had at least 97 frames where all required face, shoulder, elbow, wrist, hip, knee and ankle landmarks had both visibility and presence ≥ 0.30. For each accepted frame:

- convert x and z to image-width units and y to the same units by multiplying normalized y by `imageHeight / imageWidth`;
- calculate 3D Euclidean segment lengths in that aspect-corrected image space;
- `leg = mean(left and right (hip→knee + knee→ankle))`;
- `torso = distance(mid-shoulders, mid-hips)`;
- `head/neck proxy = distance(mid-shoulders, mid-ears)`;
- `tracked-height proxy = leg + torso + head/neck proxy` (no crown or foot thickness exists in the 33 landmarks);
- `arm-span proxy = shoulder width + both shoulder→elbow and elbow→wrist chains`;
- take the median ratio over accepted frames in each clip, then compare clips.

Summed segment lengths reduce pose dependence, and the aspect correction removes portrait-pixel anisotropy. Perspective, foreshortening, weak z, crop, clothing and landmark bias remain. “Arm span” is consequently noisier than leg/torso ratios.

### Results

| Sico clip id | Accepted frames | Leg / tracked height | Arm span / tracked height | Torso / leg | Tracked-height proxy (image-width units) |
|---|---:|---:|---:|---:|---:|
| `7637362262214298911` | 97 | 0.550 | 0.853 | 0.530 | 1.794 |
| `7638755622774787341` | 167 | 0.556 | 1.067 | 0.559 | 1.547 |
| `7639721560881892639` | 154 | 0.546 | 0.858 | 0.552 | 1.920 |
| `7640204475411614989` | 329 | 0.546 | 1.073 | 0.569 | 1.494 |
| `7641308000510037261` | 317 | 0.560 | 1.018 | 0.528 | 1.560 |
| **Across-clip mean ± sample SD** | — | **0.552 ± 0.007** | **0.974 ± 0.110** | **0.548 ± 0.018** | **1.663 ± 0.184** |
| **Across-clip CV** | — | **1.2%** | **11.3%** | **3.3%** | **11.1%** |

The leg/height and torso/leg proxies are notably consistent across these five clips. Arm span and apparent overall scale are not: framing/foreshortening moves them by roughly 11%. This is exactly why normalized image landmarks must not be treated as metric world points.

### Can this test the “about 175 cm” claim?

**No.** A single uncalibrated monocular video has an unavoidable person-size/depth/scale ambiguity. These saved coordinates add no known camera intrinsics, known-size object, floor calibration, stereo baseline or metric world landmarks. The 1.49–1.92 “height” range above is in image-width units; interpreting it as metres would be a category error. Even GVHMR's learned body shape and world trajectory do not by themselves turn an identity's claimed stature into a tape-measure result without scale evidence.

What the clips support is narrower: Sico's relative leg/torso ratios are repeatable under the proxy. To validate 175 cm, provide one metric anchor (known camera/floor geometry, a measured object in the same plane, or an explicit entered height) and use full-body, low-foreshortening frames. The number should remain user-supplied metadata until then.

### Active-avatar comparison and calibration recommendation

The lab proof at `local/companion-motion-lab/lab-system-1440x900.png` shows **Alicia Solid** active. Rest-pose humanoid node positions in `alicia-solid.vrm`, measured with the same chain definitions as closely as the rigs permit, give:

| Subject | Leg / tracked height | Arm span / tracked height | Torso / leg |
|---|---:|---:|---:|
| Sico five-clip proxy | 0.552 | 0.974 | 0.548 |
| Alicia Solid rest skeleton | 0.676 | 0.858 | 0.382 |

Alicia has a much longer-leg/shorter-torso silhouette than the measured Sico proxy. A uniform scale cannot fix that proportion mismatch. The existing five-segment calibration (upper arm, lower arm, upper leg, lower leg, torso) scores this sample at approximately **66.5% fit**. Source vs Alicia normalized five-segment shares are:

| Segment | Sico proxy | Alicia | Alicia / Sico |
|---|---:|---:|---:|
| upper arm | 0.147 | 0.153 | 1.04 |
| lower arm | 0.162 | 0.159 | 0.98 |
| upper leg | 0.182 | 0.265 | 1.45 |
| lower leg | 0.261 | 0.307 | 1.17 |
| torso | 0.247 | 0.116 | 0.47 |

**Concrete seam recommendation:** keep rotational retargeting scale-invariant; do not deform Alicia from these image-landmark proxies. If 175 cm is supplied as trusted calibration metadata, use Sico's median leg share only to scale **root translation**, not bones: estimated source leg = `1.75 m × 0.552 = 0.966 m`; Alicia's rest leg chain is `0.784 m`; therefore start with root-motion/contact displacement scale **0.784 / 0.966 = 0.812**. Tune against foot contacts, and store the scale with the source/target pair. Do not apply `0.812` to the avatar mesh.

Before any per-bone proportion correction, change future extraction artifacts to preserve actual `worldLandmarks` or, preferably, GVHMR SMPL-X joints. Then calibrate on median segment lengths from several straight, visible frames. If matching Sico's silhouette matters, choose a target avatar with a closer rest skeleton instead of stretching Alicia's upper legs by the inverse of a noisy image-space estimate.

## Twitter/archive result and the Pleometric cross-stream pointer

The local search covered:

- `packages/twitter-archive/data/twitter-corpus/corpus.sqlite`: 3,285 corpus rows, searched across exact-token and substring variants of `wan`, `wan2`, `animate`, `animation`, `pose`, `mocap`, `motion`, `retarget`, `SMPL`, `pipeline`, `pleometric` and the remembered wording;
- `packages/twitter-archive/data/twitter-archive/twitter-archive.sqlite`: 121 captured tweets, including all 57 locally captured `@pleometric` rows, with the same terms;
- cached public-source payloads under `data/twitter-corpus/cache`.

The half-remembered Pleometric/Wan reproduction post is **not present in either local database**, and neither schema contains a bookmarks/likes relation that could prove how a captured tweet entered the corpus. Do not label the corpus rows “Arthur's bookmarks” or “likes.”

Arthur subsequently recovered the May 16 thread text manually. The thread involved `@Algon_33` / `@norvid_studies` discussing Pleometric, with the reproduction guess attributed to `@FleischmanMena`. Status IDs are unavailable, so these are quoted exactly from Arthur's recovered text rather than falsely assigned IDs:

> “image gen of choice for base actors; i2v local wan2/seedance/sora/etc for vidgen w/ prompts 'man sings, walks left'; vtuber live2d to pose long dialogue; solid color bg in imgs to composite (note tom's pixel fuzz); adobe AE for final merge”
>
> — `@FleischmanMena`, May 16 thread; status id unavailable

Two related posts actually present in the local capture database are:

> “Kling motion control backrooms video has the comments section furiously debating whether it’s AI or not.\n1.2m views”
>
> — `@pleometric`, id [`2064168715000627239`](https://x.com/pleometric/status/2064168715000627239), 2026-06-09

> “interesting trend of people saying the latest batch of animated films "look like AI", when it's in fact the other way around: AI looks like animated film! Transferring negative reactions from the simulation to the original... meanwhile, tung sahur ascends into beloved mascot.”
>
> — `@pleometric`, id [`2067345793942540309`](https://x.com/pleometric/status/2067345793942540309), 2026-06-17

### Pleometric reproduction stack — pointer to Playground, not a Companion plan

This belongs to Arthur's **Playground** stream. Minimal stage → tooling sketch only:

1. Base actors → Playground image-generation lane.
2. Short prompted motion → Wan2/Seedance I2V on the RTX desktop through the shared, pilot-owned ComfyUI/Wan environment.
3. Long dialogue pose → our VRM/Live2D rig can render a deterministic performance instead of an opaque generic Live2D stage.
4. Solid-background plates → key/mask composite, preserving edge/pixel-fuzz review.
5. Final merge → prefer a TS-native Remotion/Hyperframe-style renderer for reproducible proofs; DaVinci Resolve scripting is capable but adds GUI/project-state and licensing/automation friction. Adobe After Effects is not required.

Companion reuses only the shared RTX environment if the GPU pilot establishes it and, possibly, the Remotion-style proof-video renderer. It does not adopt this pixel-content stack as its live motion architecture.

## Final recommendation

1. Pin and pilot GVHMR at the exact commit above on five representative Sico clips: fixed camera, moving camera, spin, crouch/occlusion and travelling steps.
2. Retarget the preserved global SMPL-X solution to the active VRM with explicit rest-pose calibration, quaternion continuity and post-retarget foot locking.
3. Export `.vrma` plus body-track v1 for immediate playback, but retain raw results and plan a v2 that preserves root translation and contacts.
4. Keep MediaPipe Full for realtime/live capture and fallback, while describing it honestly as a fast 33-landmark model rather than SOTA mocap.
5. Keep Wan/MimicMotion/UniAnimate/Animate-X in the separate pixel-generation lane. They may produce compelling videos; they do not prove or drive the live rig.
