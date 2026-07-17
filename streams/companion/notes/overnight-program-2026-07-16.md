# Overnight program — 2026-07-16 (living doc)

## Morning summary (for Arthur)

All six deliverables plus your three pre-sleep backlog items landed. Nested checkpoints `0a69024` and `93593ab`; validation floor ratcheted **489 → 508**, all gates green; outer evidence commit `79a574386`. Live stack healthy (last 30 consecutive soak cycles green, RSS flat; the 12h unhealthy window in the soak file was the pre-session portless `:1355` outage). Error log has no new entries.

**Play:** [companion.localhost/lab](https://companion.localhost/lab) — badges now score agreement from real GPU↔Vision evidence (281 clips, hands included); provider-compare reason strings show the new per-side hand calibration live.

**Xanadu:** proof card `d7f8fc3d`; two new taste questions awaiting you — `9abd415e` (which expressive gap earns the next contract review) and `e00ebefd` (which connection mechanism to taste-test first). Still pending from before: `f2114ebc` (v2 retirement) and `0357400a` (model/rig direction).

**Headline verdicts:** per-side hand calibration is evidence-backed (apple-vision L .811 / R .806, gpu L .845 / R .835; mediapipe hands stay neutral for lack of a hand corpus). Direct 3D retarget is smoother on stable clips but **stays shadow-only** — 57/1,979 raw transitions still teleport >12 m/s (`retarget-3d-evaluation.md`). Xiaomi referent is Xiaomi-Robotics-0 (arXiv:2602.12684); its lesson reinforces, not changes, the L0 never-awaits contract (`xiaomi-robotics-distillation.md`).

**Cross-stream:** playground's desktop-model-infra consolidation proposal reviewed as queue-kernel owner — accepted with four amendments (no back-compat aliases, data continuity for existing results, licensed preflights unchanged, no kinds.sh edits until this program wrapped): `docs/plans/desktop-model-infra.md` §Review.

**Post-wrap addendum (late-night bus traffic):**
- **Dating-sim referent upgraded:** a straggler scout surfaced *Lunar Romance* (App Store id1586821762) — its official copy contains **"a text based romance otome game in a light novel game style" verbatim** plus a K-drama-episodes review; I re-verified the listing and reranked it #1 (Medium-high, unconfirmed) in `dating-sim-connection-research.md`. Question `e00ebefd`'s menu row A now includes it.
- **Desktop model-infra:** playground shipped steps 1–4 (DISK.md ledger, env manifests, playground kinds appended with byte-exact-prefix proof, `fetch` subcommand resolving pre-migration job ids). Step 5 (companion kind renames, clean cutover) is **cleared post-wrap** with the review protocol recorded in `docs/plans/desktop-model-infra.md` §Review addendum — the next companion session reviews the diff.
- **OMP rollout hold released:** dotfiles shell-env matrix is GREEN and its cutover is live (their master 9a2c874..9cf6da6), so the inherited hold on OMP redeploy is lifted; agents-e0g9qf is promoting build 0ad0c4202 (SessionManager.list hang fix).
- **Power alert resolved as stale:** a 5%-battery report named the motion-oracle sidecar; live check showed 70% charging, sidecar at normal 16.6% CPU — left up per stream contract. CuaDriver (45.8% CPU, 1.5 days) is not companion-owned; redirected to its owner.

## Status

Complete. Objective and constraints inherited from [`HANDOFF-OVERNIGHT2.md`](../HANDOFF-OVERNIGHT2.md); measured outcomes and checkpoint evidence per wave below.

## Objective

1. Measure GPU-vs-Apple Vision hand agreement and replace neutral hand calibration with per-side evidence-backed weights.
2. Run body-and-hand GPU-vs-Vision agreement over all 281 clips and feed it into clip-quality derivation.
3. Evaluate a bone-normalized, velocity-gated 3D retarget prototype offline on the 10 most-stable clips; metrics and recommendation only.
4. Add production-path arbiter and lab-state coverage for reviewer-flagged edge cases.
5. Commit the prior untracked companion evidence notes as one evidence-of-record change.
6. Publish soak evidence, one Xanadu proof card, and a handoff back to Arthur.
7. Audit AniChat against the shipped expressive stack, identify the top three genuine gaps, and post a bounded taste question; no rig build.
8. Distill the recent Xiaomi robotics work into an evidence-backed architecture mapping; no architecture change.
9. Research dating-sim/light-novel connection mechanisms, derive companion implications, and post one bounded taste question; no dialogue-system build.

## Operating record

- Arthur input: none overnight. Taste forks become Xanadu questions.
- One implementation wave at a time, at most five workers.
- Nested gate: `cd apps/ai-companion-rtc && bun scripts/validate.ts`; `--fast` during a wave, full `--checkpoint` only at ship points.
- Outer commits include only companion-owned paths; never broad-stage the outer repository.
- Live companion, motion-oracle, soak watcher, and GPU queue remain running; workers use private instances and clean them up.
- Excluded work remains excluded: model/rig generation, v2 replay retirement, OMP rollout, licensed WiLoR/GVHMR lanes, and live-camera calibration.

## Wave log

### Boot — DONE

- Read the charter, epistemics covenant, companion goal, 2026-07-15 overnight program, current handoff, active companion task row, and proof-of-work QA contract.
- Goal created for all six named deliverables plus Arthur's three-item pre-sleep backlog extension.
- Four read-only scouts mapped hand calibration, full-corpus agreement, offline retarget metrics, and reviewer/notes seams before implementation packets were dispatched.

### Wave 1 — Motion evidence — DONE (nested checkpoint `0a69024`; floor 489 → 501)

| Slice | Outcome |
|---|---|
| GPU↔Vision comparison | New `scripts/apple-motion-oracle/compare-gpu-vision.ts`: 281/281 intersecting clips, 35,273 aligned frames, 1,373,675 compared joint samples; body 17 joints + Hand-21 per side → `data/apple-vision-tracks/gpu-comparison-summary.json` |
| Calibration v2 | `derive-calibration.ts` + `public/motion-calibration.ts` at `v2-p95-availability`: apple-vision body .891 / L .811 / R .806; gpu body .912 / L .845 / R .835; mediapipe hands stay 1.0 with explicit no-hand-corpus provenance |
| Clip quality cutover | `derive-clip-quality.ts` reads the GPU summary; body + both hand sides in agreement; 281 rows regenerated, 276 numeric agreement scores |
| Offline 3D retarget | New `scripts/evaluate-3d-retarget.ts` over the 10 stable clips: direct median meanJerk 47.81 vs baseline 63.07 rad/s², peak 54 vs 114 rad/s, but 57/1,979 raw transitions still >12 m/s and direct coverage includes hold output. **Verdict: direct 3D stays shadow-only.** Note `retarget-3d-evaluation.md` |
| Orchestrator fixes | HAND_MAPPING tsc conversion, stable-candidate rank narrowing, and test-fixture chirality (Apple body3d convention: providerPoseLandmarks negates x) |

### Wave 2 — Coverage + notes hygiene — DONE (nested checkpoint `93593ab`; floor 501 → 508)

- Production-path coverage: 7 new tests, no `advanceCaptureArbiterForTest` in new code — arbiter hysteresis boundary (exact delta 0.10 holds; strict `< margin`), unregister-during-pending-promotion, model-swap latch race (one null-release per lane, second settle re-evaluates), lab-state real stale transition, rejecting-stream 400, invalid-UTF-8 400, and a real child-process `/api/debug/lab-state` POST→GET round-trip. Focused run 66/0 across the three files.
- Notes hygiene DONE: outer commit `79a574386` — 15 prior evidence notes + investigation bundle committed unchanged except two dead session-dump links in `iteration-infra.md` marked not-retained; INDEX gains `retarget-3d-evaluation.md` and this program doc.

### Wave 3 — Backlog extension (Arthur pre-sleep items 7–9) — DONE

- `anichat-gap-audit.md` (Luna): shipped/partial/missing matrix with file:line evidence. Verdict on the emotion-vector suspicion: wrong for the frozen contract (AffectVector/EmotionMix/setAffect shipped), right about the remaining gap (audio/history-conditioned regional residuals, material regions/masks, secondary motion). Top-3 gap milestone plans are review-only. Xanadu question `9abd415e`.
- `xiaomi-robotics-distillation.md` (Sol): referent identified as Xiaomi-Robotics-0 (arXiv:2602.12684v2, confidence 0.90; MiMo-Embodied and U0 ranked as alternates). Applies/does-not-apply/later-benchmark table; no architecture changes.
- `dating-sim-connection-research.md` (Sol): ranked referent candidates (Five Hearts Under One Roof, Motesolo, Cheongchunhyang Jeon, Mystic Messenger), seven mechanism→layer mappings, three bounded taste experiments. Xanadu question `e00ebefd`.
- Orchestrator posted all Xanadu entries (single-writer): proof `d7f8fc3d` + the two questions above.

## Checkpoints

- Nested `0a69024` — motion evidence wave, validation GREEN 4/4 gates, 501 pass / 0 fail, floor ratcheted 489 → 501.
- Nested `93593ab` — coverage wave, validation GREEN 4/4 gates, 508 pass / 0 fail, floor ratcheted 501 → 508.
- Outer `79a574386` — companion notes evidence-of-record commit (23 files, additions only).

## Proof and rerun commands

- Full gate: `cd apps/ai-companion-rtc && bun scripts/validate.ts` — last observed GREEN 4/4, 508/0.
- GPU↔Vision agreement: `cd apps/ai-companion-rtc && bun scripts/apple-motion-oracle/compare-gpu-vision.ts` → `data/apple-vision-tracks/gpu-comparison-summary.json` (281 clips, 35,273 aligned frames).
- Calibration: `bun scripts/apple-motion-oracle/derive-calibration.ts` → `data/motion-calibration/weights.json` (v2-p95-availability).
- Clip quality: `bun scripts/derive-clip-quality.ts` → `data/clip-quality/quality.json` (281 rows, 276 numeric agreement).
- 3D retarget evaluation: `bun scripts/evaluate-3d-retarget.ts` → `local/retarget-3d-evaluation/metrics.json`.
- Soak (2026-07-16T15:45Z): watcher live in tmux `soak-watch`; last 30 consecutive cycles healthy (13:21→15:45Z), RSS trend −0.029 MB/cycle; the 145-cycle unhealthy run 00:55→12:55Z predates this session and is the portless `:1355` migration outage, fixed with static aliases at 13:00Z.
