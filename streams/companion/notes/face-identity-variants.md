# Face identity variants — acceptance note

## Corpus

Desktop extraction selected 208 source clips and wrote 190 schema-v2 face tracks. 18 clips were rejected; every rejection reason is exactly "MediaPipe found no complete face frames" (the headless FaceLandmarker returned zero detections for every sampled frame of those clips). Accepted tracks contain 3,343 frames; 1,721 individual samples were rejected within accepted clips (partial or absent MediaPipe output at a single time step).

All 190 accepted tracks are present in `data/face-tracks-v2/` as full schema-v2 aggregation inputs.

## Schema and evidence contract

Every artifact in the pipeline carries `schemaVersion: 2`. The contract chain is:

1. **extract.ts** writes per-clip JSON tracks: `schemaVersion: 2`, exactly 52 finite blendshapes, exactly 468 finite `{x, y, z}` landmarks, and a 16-element row-major `facialTransformationMatrix` per accepted frame.
2. **aggregate.ts** reads only `schemaVersion: 2` tracks. It validates each frame's shape (52 blendshapes, 468 landmarks, 16-element matrix, all finite). Output: `neutral-landmarks.json`, `proportions.json`, and `reconstruction-report.json`, each stamped `schemaVersion: 2` with a shared `reconstructionId`.
3. **bake-variants.ts** requires `proportions.json` with `schemaVersion: 2`, `status: "ok"`, `evidence.trackSchemaVersion: 2`, and a matching `reconstruction-report.json` with `schemaVersion: 2`, `status: "ok"`, and identical `reconstructionId`.

If any gate fails, `reconstruction-blocker.json` is written and stale success artifacts are removed. No variant can be generated from stale or blocked evidence.

## Reconstruction checkpoint

The current aggregation produced:

- 190 inlier clips, 0 outlier clips
- 488 selected neutral frames (lowest 35th-percentile blendshape RMS activity ∩ camera-normalized landmark velocity)
- 3,343 valid frames total
- Per-region variance reported for six semantic groups: faceOval (36 landmarks), jaw (21), leftEye (16), rightEye (16), nose (23), lips (40)
- Outlier rejection: median distance + 3.5 × 1.4826 × MAD; MAD-zero clips use numerical epsilon to avoid rejecting identical shapes

## Shared semantic-region measurement convention

Both the TypeScript aggregator (`aggregate.ts`) and the Python mesh deformer (`bake-variants.py`) compute each facial proportion metric using the same operation over corresponding semantic groups:

| Metric | Operation | TS coordinates | Mesh coordinates |
|---|---|---|---|
| Eye spacing ratio | Region-center x-distance / face width | x/y (y-down) | x/z (z-up) |
| Canthal tilt (L/R) | Least-squares tilt: atan2(−Σ(x−μx)(y−μy), Σ(x−μx)²) | x/y | x/z |
| Nose width/length | Region-bounds extent / face dimension | x/y | x/z |
| Mouth width, lip height | Region-bounds extent / face width | x/y | x/z |
| Jaw width | Jaw-region x-extent / face width | x/y | x/z |

Negating y aligns the anatomically-up sign convention. "Observed minus base" compares the same feature definition across both topologies.

Eight metrics are measured: `eyeSpacingRatio`, `leftCanthalTiltDegrees`, `rightCanthalTiltDegrees`, `noseWidthRatio`, `noseLengthRatio`, `mouthWidthRatio`, `lipHeightRatio`, `jawWidthRatio`.

Each metric has a hard deformation limit (e.g. eye spacing ±0.025, canthal tilt ±4.0°, jaw width ±0.030). Deltas beyond the limit are clamped before vertex displacement.

## Three variant strengths

| Strength | Evidence render | VRM path |
|---|---|---|
| 0.35 | `local/companion-face-identity/kamatte-sico-strength-0.35.png` | `variants/strength-0.35/kamatte-ps-sico.vrm` |
| 0.60 | `local/companion-face-identity/kamatte-sico-strength-0.6.png` | `variants/strength-0.6/kamatte-ps-sico.vrm` |
| 0.85 | `local/companion-face-identity/kamatte-sico-strength-0.85.png` | `variants/strength-0.85/kamatte-ps-sico.vrm` |

Each variant's `morph-report.json` records `observedMetrics`, `baseMetrics`, `appliedDeltas`, deformation bounds, and expression inventory before/after.

## Exact 52/52 invariant and selection rule

The base KAMATTE Perfect Sync VRM has exactly 52 shape keys and 52 VRM 1.0 expressions with morph binds. The pipeline enforces this invariant at three points:

1. Before deformation: base inventory must be 52/52 or the run aborts.
2. After deformation: inventory must equal the pre-deformation inventory or the run aborts.
3. After VRM re-export and re-import: the exported file is re-imported and its inventory must be 52/52 or the run aborts.

**Selection rule:** Among variants that preserve exact 52/52 coverage, the wrapper selects the one with the highest expression coverage. Ties prefer the strength nearest 0.6. If no variant achieves 52/52, the pipeline errors and no model is published. The selected variant is copied to the public model path.

## Desktop model bench

Three clips were benchmarked across three models under `data/model-bench/`. Each model directory contains `track.json`, `preview.mp4` (not generated here), and `manifest.json` per clip.

Clip IDs: `7200911766728002858`, `7211743634759175470`, `7479225467057229086`.

| Model | Kind | Clip 1 FPS | Clip 2 FPS | Clip 3 FPS |
|---|---|---|---|---|
| mediapipe-face | face | 29.771 | 12.955 | 17.780 |
| face-alignment | face | 4.693 | 2.881 | 2.761 |
| rtmpose-body | body | 0.696 | 0.859 | 0.988 |

RTMPose outputs COCO-17 image-plane keypoints only; it is not a calibrated VRM/SMPL rotation estimator. Its measured FPS reflects single-frame CPU inference without batching.

## Limitations

- Reconstruction quality depends on the neutral-frame selection heuristic (lowest-activity blendshapes ∩ lowest-velocity landmarks). Clips with sustained expression or rapid motion contribute fewer or no neutral samples.
- Semantic-region vertex weighting uses shape-key activation as a proxy for region membership. Vertices not meaningfully moved by any region key receive zero weight and are excluded from that region's metrics.
- Deformation limits are manually tuned constants, not derived from perceptual studies.
- FLAME/MICA 3D morphable model reconstruction remains separately blocked on Arthur's licensed FLAME model files. It was not substituted, approximated, or worked around in any part of this pipeline.

## License boundary

All KAMATTE-derived assets (base VRM, Perfect Sync variant, identity-deformed variants, evidence renders) are private, non-commercial, no redistribution. The `public/` directory copy is a local runtime working file only; `public` does not imply permission to publish. At runtime the model remains passive: only L0 writes its blendshape and bone channels.
