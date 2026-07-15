# Motion evidence card — Apple Vision body/hands lanes

Status: DRAFT — sico batch in flight; live calibrated clips pending Arthur. Numbers marked *(interim)* update when the batch completes; sections marked *(pending)* are honestly absent, not implied.

## Sources and versions

- Host: macOS 26.5.1, M4 Max. No public TypeScript ARKit/Vision SDK — Swift sidecars emit typed loopback UDP.
- 2D live: `AppleMotionOracle` — VNDetectHumanBodyPoseRequest **revision 2** (19 joints), body-associated hands + standalone two-hand fallback **revision 1** (21 joints/side), 640×480 @ ~30fps, busy-gate frame dropping. Wire: `companion.motion-oracle/1` / `apple-vision-body2d-r2` / `body+hands`.
- 3D live (shadow-only): `AppleMotionOracle3D` — VNDetectHumanBodyPose3DRequest **revision 1**, 17 joints, meters, model-space relative to root, bodyHeight + cameraOriginMatrix; per-joint confidence not provided by the API (honestly absent). Wire: `companion.motion-oracle-3d/1` / `apple-vision-body3d-r1` / `body3d`.
- Offline batch: `AppleMotionOracleBatch` — AVAssetReader iteration sampled at every 2nd frame (`--every-nth 2`, per the >90-minute wall-clock rule), same joint vocabularies + association policy, JSONL per clip (no UDP). Rates below are over sampled frames.
- Baselines: MediaPipe pose/hands (browser, thresholds 0.40 detect / 0.45 retarget), 73 existing v2 body-tracks (`data/body-tracks/`). RTMPose remains a COCO-17 image-plane desktop baseline.

## Live-path rates (observed)

- 20s bounded live run: 135 accepted body observations, packets 2.9–3.8 KiB, honest dropout when subject left frame.
- Oracle retarget thresholds 0.45 arms/torso/head, 0.60 legs; stale release 420ms; PoseGuard 12 rad/s cap; HandGuard 9 rad/s, hold 100ms/decay 250ms/reset 350ms.
- Synthetic replay now carries full 19-joint body + both Hand-21 hands: drive-motion provable end-to-end without a camera (test-asserted through parse → PoseGuard → retarget).

## Sico corpus batch *(interim — 74/281 clips at draft time)*

- body2d: mean 0.62 / median 0.65 of sampled frames; hands: mean 0.54; body3d: mean 0.71 / median 0.78. Zero-detection clips: 2/74. ~57s wall per clip at every-2nd-frame sampling, single process.
- Same-clip Vision-vs-MediaPipe comparison over the 73 body-track clips: *(fills in from `data/apple-vision-tracks/comparison-summary.json`)*.
- Failure taxonomy + overlays: *(fills in from `streams/companion/notes/vision-sico-batch.md`)*.

## Coverage evidence

- Browser QA: `local/motion-oracle-qa/report.md` (+ fixes: lab-state whitelist seam, replay geometry, panel source/age).
- Motion Debug stage evidence: `local/motion-debug-qa/report.md`.
- Arbitration: `test/capture-arbiter.test.ts` (8 tests incl. production-path swap latch + hysteresis deadline); reviewer transcript ArbiterReview (fix-first findings closed).

## Live calibration *(pending — requires Arthur, ~2 min on camera)*

Full retarget core incl. nose/ears, both hands close for distal fingers, occlusion, motion blur, enter/leave frame, mirrored preview. Runbook: `apps/ai-companion-rtc/docs/motion-capture-comparison.md`. Until recorded: no close-hand live claim is made; the standalone-hand fallback is proven only synthetic + batch-offline.

## WiLoR challenger (desktop, provisioned)

- Env + weights cached on RTX 3090; detector-only GPU smoke passed (3 frames, 0.8s). Full 3D runner fail-closes on licensed `MANO_RIGHT.pkl` — blocked on Arthur's MPI registration (same session as SMPL/SMPLX/FLAME). Rerun note: desktop `~/projects/model-bench/models/wilor/README.md`.

## Bounded recommendation *(finalize with batch numbers)*

- Apple Vision 2D is a credible live shadow/drive lane behind the arbiter; hands at dance-video distance are weak *(interim 0.54 frame rate, low confidence at distance)* — close-range hands remain MediaPipe's to lose until live calibration + WiLoR measurements exist.
- 3D lane stays shadow-only until a 3D retargeter is designed against real depth quality data from the batch.
- No product-taste decision is made from synthetic packets; taste follows this card once the two pending sections fill.

## Rerun commands

```bash
# live 2D + 3D sidecars
cd apps/ai-companion-rtc && bun run oracle:motion:run -- --host 127.0.0.1 --port 49982
bun run oracle:motion3d:run -- --port 49913 --debug
# sico batch (resumable)
bun scripts/apple-motion-oracle/run-sico-batch.ts
# comparison
bun scripts/apple-motion-oracle/compare-sico-mediapipe.ts
```
