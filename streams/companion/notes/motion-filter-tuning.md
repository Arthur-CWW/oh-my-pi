# Motion-filter tuning

Run date: 2026-07-15. Command: `bun run apps/ai-companion-rtc/scripts/tune-motion-filter.ts` from the workspace root (or `bun run scripts/tune-motion-filter.ts` from `apps/ai-companion-rtc`). The script is deterministic: sorted corpus filenames, stable energy ordering, stable quintile strata, and stable config tie-breaks.

## Corpus selection

281 valid GPU RTMPose-wholebody tracks were discovered. Four clips were selected from each motion-energy quintile (mean 3D normalized joint velocity), for 20 total clips:

| Quintile | Rank | Clip | Mean joint velocity |
|---:|---:|---|---:|
| 1 | 1 | 7632850932195134734 | 0.334801 |
| 1 | 2 | 7519629053893053726 | 0.551876 |
| 1 | 3 | 7476645592249257247 | 0.659144 |
| 1 | 4 | 7605518285991382302 | 0.757747 |
| 2 | 1 | 7501861902323059999 | 0.836704 |
| 2 | 2 | 7641984768766266654 | 0.922286 |
| 2 | 3 | 7479225467057229086 | 0.990250 |
| 2 | 4 | 7587408099762261278 | 1.054799 |
| 3 | 1 | 7628453417425423629 | 1.150449 |
| 3 | 2 | 7636452174238633229 | 1.187023 |
| 3 | 3 | 7636823726834699534 | 1.241411 |
| 3 | 4 | 7591240976614690078 | 1.300193 |
| 4 | 1 | 7600681977821367582 | 1.434305 |
| 4 | 2 | 7639448826587204877 | 1.509664 |
| 4 | 3 | 7635358130062380301 | 1.609503 |
| 4 | 4 | 7633522267405733133 | 1.674309 |
| 5 | 1 | 7480696375659793694 | 1.764208 |
| 5 | 2 | 7620290322131651854 | 1.866189 |
| 5 | 3 | 7635794022405131550 | 2.072591 |
| 5 | 4 | 7500936109078088991 | 2.799624 |

## Objective and sweep

At 60 Hz, each configuration was evaluated per clip after interpolation, confidence hysteresis, One-Euro filtering, hip filtering, and retargeting. Jerk is the mean absolute frame-to-frame angular-velocity change. Peak-velocity loss is the percentage decrease from the raw stream. Effective lag is the signed cross-correlation delay of raw and filtered rotation-activity streams, searched over ±200 ms; feasibility uses its absolute median.

The coarse grid was 5 × 5 × 3 = 75 points:

- minCutoff: 0.65, 0.95, 1.35, 1.75, 2.25 Hz
- beta: 5, 10, 20, 30, 45
- hip damping: 0.7, 1.0, 1.3 (hip cutoff = 0.85 / damping)

A local 5 × 5 × 5 refinement around the best coarse feasible cell evaluated 124 new points (199 unique points total). Feasibility: median peak-velocity loss ≤10% and absolute median lag ≤33 ms. Objective: maximize median jerk reduction; no penalty term is used.

## Feasible Pareto frontier

| minCutoff | beta | hip damping | Median jerk reduction | Median peak loss | Median lag (ms) |
|---:|---:|---:|---:|---:|---:|
| 2.60 | 55 | 1.2 | 47.44% | 2.19% | 0.0 |
| 2.60 | 55 | 0.5 | 47.53% | 2.35% | 0.0 |
| 2.25 | 45 | 1.3 | 47.98% | 2.71% | 0.0 |
| 2.25 | 45 | 1.0 | 48.42% | 2.75% | 0.0 |
| 1.35 | 30 | 0.7 | 49.60% | 3.58% | 0.0 |
| 1.75 | 30 | 0.7 | 49.61% | 3.60% | 0.0 |
| 2.25 | 30 | 0.7 | 49.61% | 3.71% | 0.0 |
| 2.25 | 30 | 1.0 | 49.97% | 4.09% | 0.0 |
| 0.65 | 20 | 1.3 | 51.70% | 5.59% | 0.0 |
| 0.95 | 20 | 1.3 | 51.70% | 5.66% | 0.0 |
| 1.75 | 20 | 1.3 | 51.72% | 5.70% | 0.0 |
| 1.35 | 20 | 1.0 | 52.10% | 5.73% | 0.0 |
| 1.75 | 20 | 1.0 | 52.11% | 6.01% | 0.0 |
| 0.80 | 14 | 0.5 | 54.46% | 7.04% | 0.0 |
| 0.50 | 14 | 0.5 | 54.46% | 7.05% | 0.0 |
| 0.65 | 10 | 1.0 | 57.31% | 8.35% | 0.0 |
| 0.95 | 10 | 1.3 | 57.42% | 8.40% | 0.0 |
| 0.80 | 10 | 1.3 | 57.44% | 8.44% | 0.0 |
| 0.65 | 10 | 1.3 | 57.45% | 8.64% | 0.0 |
| 0.50 | 10 | 1.3 | 57.46% | 8.85% | 0.0 |
| 0.45 | 10 | 1.3 | 57.47% | 8.92% | 0.0 |
| 0.45 | 10 | 1.4 | 57.50% | 9.07% | 0.0 |
| **0.45** | **10** | **1.5** | **57.54%** | **9.10%** | **0.0** |

## Chosen point and production update

The chosen point is minCutoff **0.45 Hz**, beta **10**, and hip damping **1.5**. It improves median jerk reduction from **52.10%** with the prior constants (1.35 / 20 / 1.0) to **57.54%**: **+5.44 percentage points**, while remaining within the strict median constraints (9.10% peak loss, 0 ms lag). `HIP_ONE_EURO_MIN_CUTOFF` remains 0.85 Hz and `HIP_ONE_EURO_BETA` remains 0.18; production hip cutoff is now `0.85 / 1.5` Hz. Confidence hysteresis remains 0.20 enter / 0.12 exit because hysteresis was held fixed in this 3D parameter sweep and existing direction tests cover its behavior.

## Original two regression clips

These rows compare the prior production constants (`before`) with the chosen point (`after`); raw values are included for context. The acceptance constraint is the 20-clip median, so an individual clip may exceed 10% peak loss.

| Clip | Raw mean jerk | Before mean jerk | After mean jerk | Before jerk reduction | After jerk reduction | Before peak loss | After peak loss | Before lag | After lag |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 7640921695418617101 | 286.12 | 134.93 | 121.19 | 52.84% | 57.64% | 3.70% | 11.75% | 0.0 ms | 0.0 ms |
| 7642719452148157710 | 401.12 | 161.82 | 141.30 | 59.66% | 64.77% | 6.18% | 8.57% | 16.7 ms | 16.7 ms |

The tuning harness does not change production defaults by itself; rerunning the command reproduces selection, metrics, frontier, and chosen point. 

## Supersession addendum: guarded rig output

The corpus sweep above measured pre-guard retarget streams. The shipping acceptance gate instead replays the two named real GPU tracks at 60 Hz through the production `ProviderReplayPipeline`, including interpolation, hysteresis, retargeting, pre-guard One-Euro filtering, and the frozen `PoseGuard`. That post-guard stream is what reaches the rig, and guard clamps/holds materially change the tuning result.

For this end-to-end basis, minCutoff **0.45 Hz**, beta **1**, and hip damping **1.5** supersede the pre-guard beta-10 selection:

| Guarded-output metric | Raw | Filtered | Delta |
|---|---:|---:|---:|
| Aggregate mean angular jerk | 105.9 rad/s³ | 77.5 rad/s³ | **-26.8%** |
| Clip 7640921695418617101 peak angular velocity | 146.1 rad/s | 144.0 rad/s | **-1.5%** |
| Clip 7642719452148157710 peak angular velocity | 132.0 rad/s | 142.9 rad/s | **+8.2%** |
| Clip 7640921695418617101 hip jitter | 25.52 | 1.03 | **-96.0%** |
| Clip 7642719452148157710 hip jitter | 56.99 | 2.17 | **-96.2%** |

The causal filter still buffers no frames (0 ms added scheduling latency). `test/track-motion-filter.test.ts` asserts the aggregate ≥25% guarded-output jerk reduction and per-clip expressiveness direction. The pre-guard corpus study remains useful diagnostic evidence, but post-guard rig output is authoritative for production constants.
