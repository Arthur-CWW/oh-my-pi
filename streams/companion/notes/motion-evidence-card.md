# Motion evidence card — Apple Vision body/hands lanes

Status: PUBLISHED 2026-07-15 with one declared gap — live calibrated close-hand clips (needs Arthur, ~2 min on camera). The batch and comparison sections below are final; the GPU corpus processor (RTX, RTMPose-wholebody) is being built and will add a third track set at `data/gpu-pose-tracks/`.

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

## Sico corpus batch (FINAL — 281 clips, completed 2026-07-15 10:39)

- 279/280 manifest entries ok, 1 honest empty (no detections), 0 errors; 52,519 sampled frames (every 2nd), 4.34h single-process wall on the M4 Max.
- Detection rates over sampled frames: body2d mean 0.69 / median 0.75 (4 zero clips); hands mean 0.63 / median 0.69 (4 zero); body3d mean 0.74 / median 0.83 (1 zero). 3D outperforming 2D on availability is consistent — VNDetectHumanBodyPose3DRequest tolerates partial bodies the 2D full-core gate rejects.
- Same-clip Vision-vs-MediaPipe (73 clips, 12,591 aligned frames within 50ms, 102,268 joint samples): overall mean normalized delta 0.080, p95 0.356. Head/face joints (nose/eyes/ears) agree at mean ~0.023–0.029 with p95 ≤ 0.060 — tight cross-provider consensus where both detect. The overall mean is dominated by limb divergence on low-confidence/occluded frames; per-joint table in `data/apple-vision-tracks/comparison-summary.json` (explicit Vision→MediaPipe index mapping + unmapped joints declared).
- Vision availability vs MediaPipe: Vision reports ~0.56 availability on head joints where MediaPipe claims 1.0 — MediaPipe always hallucinates a full skeleton; Vision withholds. Calibration implication: Vision confidence is the more honest gate; MediaPipe availability must be confidence-weighted before arbitration parity.
- Overlays (eyeball intuition): `data/apple-vision-tracks/overlays/{7640921695418617101,7593135012170534174,7630618588805745933}.jpg`. Batch note: `streams/companion/notes/vision-sico-batch.md`.

## Coverage evidence

- Browser QA: `local/motion-oracle-qa/report.md` (+ fixes: lab-state whitelist seam, replay geometry, panel source/age).
- Motion Debug stage evidence: `local/motion-debug-qa/report.md`.
- Arbitration: `test/capture-arbiter.test.ts` (8 tests incl. production-path swap latch + hysteresis deadline); reviewer transcript ArbiterReview (fix-first findings closed).

## Live calibration *(pending — requires Arthur, ~2 min on camera)*

Full retarget core incl. nose/ears, both hands close for distal fingers, occlusion, motion blur, enter/leave frame, mirrored preview. Runbook: `apps/ai-companion-rtc/docs/motion-capture-comparison.md`. Until recorded: no close-hand live claim is made; the standalone-hand fallback is proven only synthetic + batch-offline.

## WiLoR challenger (desktop, provisioned)

- Env + weights cached on RTX 3090; detector-only GPU smoke passed (3 frames, 0.8s). Full 3D runner fail-closes on licensed `MANO_RIGHT.pkl` — blocked on Arthur's MPI registration (same session as SMPL/SMPLX/FLAME). Rerun note: desktop `~/projects/model-bench/models/wilor/README.md`.

## Bounded recommendation (grounded in the 281-clip batch)

- Apple Vision 2D is a credible arbitrated live lane: cross-provider consensus with MediaPipe is tight on confidently-detected joints (head mean delta ≤0.03), and its honest availability gating (withholds where MediaPipe hallucinates) makes it the better confidence authority. Keep it tier-1 behind the arbiter with its own confidence as the gate.
- Hands: 0.63 mean sampled-frame availability at dance-video distance is usable for shadow/A-B but NOT yet for close-range drive claims — that verdict waits on the 2-minute live calibration pass and, for the SOTA ceiling, WiLoR (MANO-blocked).
- 3D lane: 0.74 availability with meters-scale output justifies designing a 3D retargeter next; until then it stays shadow-only. Depth QUALITY (vs image-plane) is still unquantified — the 3D retarget design should start with a bone-length-stability analysis over the batch's body3d tracks.
- Calibration weights for the arbiter's per-provider multiplier should come from the per-joint comparison table, not global means: face/head near 1.0 parity, limbs discounted by their per-joint p95 divergence.
- No product-taste decision from synthetic packets; the one open evidence gap is declared above.

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
