# Apple Vision offline batch over the sico corpus

Completed 2026-07-15 10:39 (Mac M4 Max, single process, detached tmux `sico-vision-batch`). Log: `local/apple-vision-sico/batch.log`. Requested by Arthur: "run the apple arkit vision one on sico."

## Configuration

- Executable: `apps/ai-companion-rtc/scripts/apple-motion-oracle/AppleMotionOracleBatch.swift` (AVAssetReader; per frame: VNDetectHumanBodyPoseRequest rev2 + hands with the live association policy + VNDetectHumanBodyPose3DRequest). No UDP; JSONL per clip.
- Corpus: `data/tiktok-catalogue/mynameissico` — 281 mp4 clips (507MB).
- Sampling: `--every-nth 2` (per the >90-minute wall-clock rule; full-frame projected far above it). All rates below are over sampled frames.
- Runner: `apps/ai-companion-rtc/scripts/apple-motion-oracle/run-sico-batch.ts`, resumable from `data/apple-vision-tracks/manifest.json`.

## Results

- 279/280 manifest entries `ok`, 1 `empty` (honest zero-detection clip), 0 errors. 52,519 sampled frames, 4.34h total wall (~55s/clip).
- body2d: mean 0.688 / median 0.745 of sampled frames (4 zero clips) — the 2D lane's full-core gate (nose/ears required) rejects partial bodies.
- hands: mean 0.634 / median 0.691 (4 zero clips) — dance-video distance; distal-finger quality unassessed here (close-hand live calibration is a separate pending gate).
- body3d: mean 0.736 / median 0.826 (1 zero clip) — 3D availability beats 2D because VNDetectHumanBodyPose3DRequest tolerates partial bodies.

## Vision vs MediaPipe (same clips)

`bun apps/ai-companion-rtc/scripts/apple-motion-oracle/compare-sico-mediapipe.ts` → `data/apple-vision-tracks/comparison-summary.json` (73 intersecting clips with v2 body-tracks, alignment window 50ms).

- 12,591 aligned frames, 102,268 compared joint samples. Overall mean normalized delta 0.080, p95 0.356.
- Head/face joints: mean delta 0.023–0.029, p95 ≤ 0.060 — tight consensus where both providers detect.
- Availability asymmetry: Vision ~0.56 on head joints vs MediaPipe 1.0 — MediaPipe emits a full skeleton always; Vision withholds under uncertainty. Vision confidence is the more honest arbitration gate; weight MediaPipe by its own confidence before parity comparisons.
- Mapping: explicit Vision-19 → MediaPipe-33 index table inside the summary JSON; unmapped Vision joints declared, never guessed.

## Failure taxonomy

- 1 clip zero-everything (`empty`), 4 clips zero body2d, 4 zero hands, 1 zero body3d — all honest no-detection outcomes on hard content (fast cuts / occlusion / non-frontal). 0 decode/tool errors after resume.
- Operational: the batch runner was killed twice by dying agent shells (nohup trap); the detached tmux session finished it. Resume-from-manifest worked as designed both times.

## Overlays (peak-detection frames)

`data/apple-vision-tracks/overlays/{7640921695418617101,7593135012170534174,7630618588805745933}.jpg`

## Rerun

```bash
bun apps/ai-companion-rtc/scripts/apple-motion-oracle/run-sico-batch.ts --every-nth 2   # resumable
bun apps/ai-companion-rtc/scripts/apple-motion-oracle/compare-sico-mediapipe.ts
```

Sibling lane: the CUDA equivalent (RTMPose-wholebody on the RTX, full-frame) lands at `data/gpu-pose-tracks/` — see `streams/companion/notes/gpu-pose-batch.md`.
