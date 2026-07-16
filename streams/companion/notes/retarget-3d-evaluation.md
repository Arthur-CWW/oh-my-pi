# Offline 3D retarget evaluation

Deterministic offline comparison of the ten ranked `stableCandidates` from `data/apple-vision-tracks/body3d-stability.json`. This is evidence only; no shipped rig/runtime path changed.

## Method and policy

| item | decision |
|---|---|
| Source lanes | Apple Vision `body2d` baseline versus the same clip's real `body3d` direct lane |
| Sampling | One shared media-time grid at 60 Hz; nearest observed source frame within 50 ms, ties choose the earlier timestamp |
| Baseline | Shipped `ProviderReplayPipeline`, smoothing/filter/guard enabled, sign-only depth prior enabled from the Apple Vision 3D lane |
| Direct | `providerPoseLandmarks` → `retargetPose` on real 3D landmarks → `TrackMotionFilter.filterBody` → `PoseGuard`; no mock or direct interpolation |
| Raw transition gate | Required-joint speed >12 m/s rejects the destination source frame; rejected frames enter `PoseGuard` hold/decay and are never interpolated across |
| Hold/decay | 200 ms hold, then 350 ms decay to neutral, matching `PoseGuard`; held and decayed outputs are counted separately |
| Metrics | Shortest-arc quaternion angular velocity (`rad/s`), existing `meanJerk` field retained but measured honestly as mean absolute angular acceleration (`rad/s²`), peak angular velocity (`rad/s`) |
| Hip jitter | Mean norm of hip-midpoint second difference divided by one fixed per-clip median valid Apple Vision body3D edge length; gaps do not cross; normalized value is dimensionless per frame² |
| Loading | Every non-empty selected JSONL line parsed; all ten report `providerLoading.truncated: false` |

## Per-clip observed values

`coverage` is output grid frames / input grid frames. Gate rejects are source transitions; one rejected source transition can affect multiple 60 Hz grid samples.

| rank | clip | grid | baseline coverage | direct coverage | gate rejects | baseline meanJerk / peak / hip jitter | direct meanJerk / peak / hip jitter |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | 7629802112033017102 | 848 | 830/848 (97.9%) | 848/848 (100%) | 0 | 56.927 / 108.000 / 0.002315 | 29.347 / 12.000 / 0.000005 |
| 2 | 7542605848300817695 | 897 | 825/897 (92.0%) | 897/897 (100%) | 3 | 134.586 / 120.000 / 0.023972 | 50.739 / 60.000 / 0.000007 |
| 3 | 7626433199165541663 | 833 | 305/833 (36.6%) | 833/833 (100%) | 3 | 23.199 / 108.000 / 0.002469 | 50.191 / 32.174 / 0.000010 |
| 4 | 7591593470926540063 | 693 | 687/693 (99.1%) | 693/693 (100%) | 10 | 68.610 / 100.128 / 0.007860 | 42.944 / 48.000 / 0.000005 |
| 5 | 7591554233606884639 | 593 | 506/593 (85.3%) | 593/593 (100%) | 3 | 46.420 / 96.000 / 0.002802 | 35.175 / 32.196 / 0.000009 |
| 6 | 7593896147672960286 | 900 | 890/900 (98.9%) | 900/900 (100%) | 5 | 87.425 / 140.620 / 0.005483 | 48.033 / 60.000 / 0.000007 |
| 7 | 7635004398111837454 | 897 | 897/897 (100%) | 897/897 (100%) | 7 | 87.596 / 156.000 / 0.003729 | 47.592 / 89.673 / 0.000005 |
| 8 | 7626020526351305997 | 685 | 0/685 (0%; sparse) | 685/685 (100%) | 5 | 0 / 0 / 0 | 56.994 / 60.000 / 0.000009 |
| 9 | 7476939340967382303 | 837 | 751/837 (89.7%) | 837/837 (100%) | 2 | 57.525 / 132.000 / 0.003382 | 32.282 / 48.000 / 0.000006 |
| 10 | 7632074642944970014 | 797 | 763/797 (95.7%) | 797/797 (100%) | 19 | 93.810 / 156.000 / 0.007100 | 69.247 / 76.878 / 0.000006 |

Units in the metric columns are `rad/s² / rad/s / dimensionless per frame²`; `meanJerk` is not physical jerk despite the retained field name.

## Aggregate headline

| aggregate | baseline | direct | direct − baseline |
|---|---:|---:|---:|
| Median per-clip meanJerk (`rad/s²`) | 63.0675 | 47.8125 | -25.4544 |
| Median per-clip peak (`rad/s`) | 114.000 | 54.000 | -71.0767 |
| Median per-clip normalized hip jitter | 0.00355538 | 0.00000648681 | -0.00354954 |
| Median output coverage | 93.85% | 100.00% | — |
| Weighted meanJerk (`rad/s²`) | 78.6865 | 46.3660 | -32.3205 |
| Weighted peak (`rad/s`) | 156.000 | 89.6727 | -66.3273 |
| Weighted normalized hip jitter | 0.00704963 | 0.00000693200 | -0.00704269 |
| Weighted input / output / paired frames | 7,980 / 6,454 / 6,454 | 7,980 / 7,980 / 6,454 | — |

The direct lane rejected 57 of 1,979 checked body3D transitions (maximum observed required-joint speed 16.8933 m/s). At the shared grid this produced 228 rejected samples, 247 held samples, 19 missing samples, and no decayed samples. The 100% direct output coverage therefore includes held output, not uninterrupted direct observations.

## Limitations and bounded recommendation

| limitation | consequence |
|---|---|
| 2D coordinates are normalized upper-left while Apple body3D coordinates are body-relative meters | Fixed bone normalization makes the hip-jitter comparison repeatable, but it is not camera-calibrated physical displacement equivalence |
| The grid is sampled offline and the direct lane uses nearest observed frames | Results measure retarget-stream behavior, not rendered avatar quality, latency, or temporal perception |
| The 12 m/s gate is evaluated on required-joint raw transitions | It removes observed teleports from the direct lane; it does not prove that remaining 3D orientation is semantically correct |
| Hold/decay makes direct coverage look complete | Coverage must be read with rejected/held/missing counts and paired coverage, not as direct-observation availability |
| Clip 8 has no usable baseline output on this grid | Its direct-vs-baseline metric delta is sparse evidence, not a corpus-wide win |

**Recommendation:** keep direct 3D **shadow-only**. The gate is operational and all ten files loaded untruncated, but 57/1,979 source transitions still exceed 12 m/s and direct output coverage is partly hold output. A promotion review should require a follow-up rendered-motion/semantic agreement gate with zero unexplained required-joint teleports after the accepted-transition policy, plus explicit handling for sparse baseline clips. Continue using the shipped 2D + sign-only depth-prior lane for runtime behavior.

## Exact rerun

```bash
cd apps/ai-companion-rtc && bun scripts/evaluate-3d-retarget.ts
```

Output: `local/retarget-3d-evaluation/metrics.json`.
