# Apple Vision body3d stability

Read-only analysis of all 281 `data/apple-vision-tracks/*.jsonl` files. The deterministic analyzer is `apps/ai-companion-rtc/scripts/apple-motion-oracle/analyze-body3d-stability.ts`; output is `data/apple-vision-tracks/body3d-stability.json`.

## Method and schema

- 52,886 JSONL frames, 36,896 body3d frames, 281 clips.
- Joint names were read from the first body3d-bearing track (`7201654498715159854.jsonl`) and schema-checked: `centerHead`, `centerShoulder`, `leftAnkle`, `leftElbow`, `leftHip`, `leftKnee`, `leftShoulder`, `leftWrist`, `rightAnkle`, `rightElbow`, `rightHip`, `rightKnee`, `rightShoulder`, `rightWrist`, `root`, `spine`, `topHead`.
- The 16-edge tree is explicitly recorded in the JSON: root→left/right hip and spine; spine→centerShoulder→centerHead→topHead; centerShoulder→left/right shoulder→elbow→wrist; hips→knees→ankles.
- Bone lengths are Euclidean meters. Per-bone CV is population standard deviation / mean over valid body3d frames. A depth-flip event is a >30% one-transition change in one bone length. Symmetric ratios are max(left,right) / min(left,right), so 1.0 is perfect equality. Joint velocities use consecutive body3d `ptsMs`; the plausibility cap is 12 m/s.

## Aggregate results

| metric | result |
|---|---:|
| body3d availability, frame-weighted | 36,896 / 52,886 = **69.77%** |
| body3d availability, clip mean | **73.44%** (median 82.58%, p95 98.84%) |
| clips with any body3d | 279 / 281 |
| clips with zero body3d | 2 (`7499761853183167774`, `7623614449370467615`) |
| depth-flip events (>30% bone-length change) | **0 bone / 0 frame** |
| bodyHeight frame distribution | mean **1.800000 m**, CV **0**, min=max 1.800000 m |
| joint-velocity samples | 622,489 |
| joint-velocity samples >12 m/s | 9,046 (**1.453%**) |
| transitions with any joint >12 m/s | 4,796 (**13.10%** of 36,617 transitions) |
| clips with at least one velocity outlier | 262 / 281 |

### Bone lengths

The tiny CVs are consistent with Apple's body-relative model preserving a fixed skeleton. Values below show aggregate mean length, aggregate all-frame CV, and the distribution of per-clip CVs (mean / p95).

| bone | mean m | all-frame CV | clip CV mean | clip CV p95 |
|---|---:|---:|---:|---:|
| root-leftHip | 0.156500 | 6.57e-8 | 6.51e-8 | 7.52e-8 |
| root-rightHip | 0.156500 | 6.74e-8 | 6.67e-8 | 7.57e-8 |
| root-spine | 0.272200 | 8.19e-8 | 8.07e-8 | 9.13e-8 |
| spine-centerShoulder | 0.282600 | 1.35e-7 | 1.33e-7 | 1.49e-7 |
| centerShoulder-centerHead | 0.121300 | 3.37e-7 | 3.33e-7 | 3.79e-7 |
| centerHead-topHead | 0.117600 | 3.78e-7 | 3.73e-7 | 4.20e-7 |
| centerShoulder-leftShoulder | 0.173200 | 8.62e-8 | 8.58e-8 | 1.02e-7 |
| centerShoulder-rightShoulder | 0.173200 | 9.24e-8 | 9.31e-8 | 1.24e-7 |
| leftShoulder-leftElbow | 0.316500 | 9.40e-8 | 9.21e-8 | 1.07e-7 |
| leftElbow-leftWrist | 0.247500 | 8.29e-8 | 8.09e-8 | 1.01e-7 |
| rightShoulder-rightElbow | 0.316500 | 8.96e-8 | 8.70e-8 | 1.02e-7 |
| rightElbow-rightWrist | 0.247500 | 8.42e-8 | 8.26e-8 | 1.06e-7 |
| leftHip-leftKnee | 0.470500 | 6.38e-8 | 6.30e-8 | 7.20e-8 |
| leftKnee-leftAnkle | 0.484900 | 7.89e-8 | 7.71e-8 | 9.12e-8 |
| rightHip-rightKnee | 0.470500 | 6.40e-8 | 6.30e-8 | 7.08e-8 |
| rightKnee-rightAnkle | 0.484900 | 8.01e-8 | 7.73e-8 | 9.17e-8 |

### Symmetric-pair ratios

| pair | mean ratio | p95 | max | ratio >1.3 |
|---|---:|---:|---:|---:|
| root-hip | 1.000000024 | 1.000000104 | 1.000000309 | 0 |
| shoulder-offset | 1.000000090 | 1.000000224 | 1.000001381 | 0 |
| shoulder-elbow | 1.000000094 | 1.000000233 | 1.000000504 | 0 |
| elbow-wrist | 1.000000084 | 1.000000215 | 1.000000978 | 0 |
| hip-knee | 1.000000059 | 1.000000145 | 1.000000708 | 0 |
| knee-ankle | 1.000000078 | 1.000000199 | 1.000000479 | 0 |

### Velocity outlier concentration

| joint | mean m/s | p95 | max | >12 m/s |
|---|---:|---:|---:|---:|
| leftAnkle | 4.645 | 14.583 | 27.215 | 3,462 |
| rightAnkle | 4.680 | 14.224 | 28.034 | 3,410 |
| leftKnee | 3.141 | 10.499 | 17.954 | 931 |
| rightKnee | 3.100 | 10.267 | 17.565 | 771 |
| leftWrist | 2.652 | 7.435 | 23.805 | 182 |
| rightWrist | 2.537 | 7.267 | 20.260 | 184 |
| topHead | 1.370 | 4.196 | 17.995 | 51 |
| other 10 joints | — | — | — | 55 |

The full per-joint table and every per-clip value are in the JSON. The outlier burden is dominated by ankles (6,872 / 9,046 samples, 75.96%) and knees (1,702 / 9,046, 18.82%).

## Ten most stable clips

Candidates are ranked by the analyzer's deterministic score: 40% availability, 25% low mean bone CV, 15% low depth-flip frame rate, 10% low velocity-outlier rate, and 10% low bodyHeight CV. A score of zero is forced for clips with no body3d.

| rank | clipId | score | availability | mean bone CV | velocity outlier rate |
|---:|---|---:|---:|---:|---:|
| 1 | 7629802112033017102 | 0.999999878 | 100.00% | 1.22e-7 | 0.00% |
| 2 | 7542605848300817695 | 0.997800050 | 99.56% | 1.20e-7 | 0.11% |
| 3 | 7626433199165541663 | 0.997517665 | 99.52% | 1.16e-7 | 0.14% |
| 4 | 7591593470926540063 | 0.997415721 | 100.00% | 1.24e-7 | 0.65% |
| 5 | 7591554233606884639 | 0.996835125 | 99.33% | 1.19e-7 | 0.12% |
| 6 | 7593896147672960286 | 0.995826976 | 99.12% | 1.22e-7 | 0.16% |
| 7 | 7635004398111837454 | 0.995490422 | 99.11% | 1.27e-7 | 0.24% |
| 8 | 7626020526351305997 | 0.994374135 | 98.84% | 1.11e-7 | 0.24% |
| 9 | 7476939340967382303 | 0.993942934 | 98.57% | 1.19e-7 | 0.09% |
| 10 | 7632074642944970014 | 0.993133351 | 99.00% | 1.21e-7 | 0.72% |

## Failure taxonomy

1. **Availability gaps:** 2 clips have no body3d; weighted availability is 69.77%, despite a 73.44% clip mean. Fifty clips are below 50% availability. Any direct lane must explicitly hold/reject missing observations.
2. **Temporal articulation jumps:** no length-changing depth-flip events were observed, but 4,796 transitions have at least one >12 m/s joint (13.10%); ankles and knees account for 8,574 / 9,046 sample outliers. This is the dominant direct-rotation risk.
3. **Model-invariant geometry:** all six symmetric ratios are effectively exactly 1.0 and every bone CV is <5e-7. This demonstrates fixed body-relative bone geometry, not that every recovered orientation/depth is correct. The zero depth-flip count is therefore a weak sanity check, not a clean bill of health for temporal rotation.
4. **bodyHeight:** every emitted height is exactly 1.799999952 m (frame and cross-clip CV 0). This is useful scale metadata but is not an independent cross-clip measurement; it should not be used to claim performer-scale validation.

## Bounded recommendation

**Use body3d only as a depth prior for the 2D lane for now, not as an unfiltered direct rotation driver.** The geometry is unusually clean (all 16 edge CVs around 6e-8–3.8e-7, symmetric ratios within 1e-6 of 1, and zero >30% length jumps), but the temporal evidence is not yet direct-drive clean: 13.10% of body3d transitions contain a joint above the 12 m/s cap, 262/281 clips contain at least one such sample, and usable availability is only 69.77% frame-weighted / 73.44% clip-mean. Feed 3D depth/orientation proposals into the existing 2D motion/filter lane with outlier rejection and fallback on missing frames; promote to direct rotations only after a separate temporal-jump gate proves those ankle/knee excursions are acceptable in rendered motion.

## Rerun

```bash
bun apps/ai-companion-rtc/scripts/apple-motion-oracle/analyze-body3d-stability.ts
```

The script writes the same JSON structure on every run (no timestamps or random values). No source files other than the new analyzer were modified.
