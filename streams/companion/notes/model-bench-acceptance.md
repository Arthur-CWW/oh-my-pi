# Desktop model-bench acceptance

Finished session. The `model-bench` tmux session on the Ubuntu desktop ran to completion (EXIT=0, 2026-07-14T10:10:36Z) and is not running. All nine cells of the three-model by three-clip matrix produced `track.json`, `preview.mp4`, and `manifest.json` under `data/model-bench/`.

## Matrix

Three clip IDs, each sourced at 30 fps:

| clip | frames |
|---|---:|
| `7200911766728002858` | 497 |
| `7211743634759175470` | 283 |
| `7479225467057229086` | 819 |

### mediapipe-face (kind: face)

| clip | FPS | runtime (s) | VRAM (MiB) |
|---|---:|---:|---:|
| `7200911766728002858` | 29.771 | 16.7 | 0 |
| `7211743634759175470` | 12.955 | 21.8 | 0 |
| `7479225467057229086` | 17.780 | 46.1 | 0 |

CPU-only. Native 52 ARKit-like blendshape coefficients per frame. Environment ~1.0 GB.

### face-alignment (kind: face)

| clip | FPS | runtime (s) | VRAM (MiB) |
|---|---:|---:|---:|
| `7200911766728002858` | 4.693 | 105.9 | 1272 |
| `7211743634759175470` | 2.881 | 98.2 | 1616 |
| `7479225467057229086` | 2.761 | 296.6 | 1672 |

GPU (FAN). The 52-track projection is heuristic from 2D landmarks, not a learned ARKit regressor. Chosen after SMIRK/EMOCA/3DDFA-v3 setup rejects. Environment ~5.8 GB.

### rtmpose-body (kind: body)

| clip | FPS | runtime (s) | VRAM (MiB) |
|---|---:|---:|---:|
| `7200911766728002858` | 0.696 | 713.9 | 0 |
| `7211743634759175470` | 0.859 | 329.4 | 0 |
| `7479225467057229086` | 0.988 | 829.1 | 0 |

COCO-17 whole-body keypoint baseline. Rotations in the track are **image-plane direction quaternions only**, not calibrated SMPL or VRM local joint rotations. This entry does not produce animation-ready body data; it establishes that the bench harness handles a body model and records image-plane landmark throughput. Environment ~887 MB.

## Output paths

Every cell writes three files:

```
data/model-bench/<model>/<clipId>/track.json
data/model-bench/<model>/<clipId>/preview.mp4
data/model-bench/<model>/<clipId>/manifest.json
```

Preview videos are directly playable for visual review. Manifests carry `companion-model-bench-manifest-v1` schema with measured FPS, runtime, frame count, VRAM, and environment size.

## What this proves

- The bench harness creates isolated per-model uv environments, dispatches a matrix of clips in a named tmux session, and writes durable logs, manifests, and preview renders for each cell.
- MediaPipe face tracking runs at real-time-or-faster throughput on CPU with native blendshape output.
- face-alignment produces GPU-accelerated 2D landmarks with a heuristic 52-track projection at roughly 3-5 fps on RTX.
- RTMPose runs COCO-17 body keypoint detection end-to-end through the same harness.

## What this does not prove

- **No quality ranking.** Throughput differences across models and kinds (face vs. body) do not imply quality ordering. MediaPipe's higher FPS does not mean it is better than face-alignment for any particular downstream task.
- **RTMPose rotations are not animation-ready.** The image-plane quaternions are a COCO-17 baseline, not calibrated VRM/SMPL local rotations. They cannot drive a rig without a separate retargeting and calibration step.
- **face-alignment blendshapes are heuristic.** The 52-coefficient projection from 2D FAN landmarks is not a learned ARKit mapping.
- **No perceptual or accuracy metrics.** The bench measures throughput and confirms output shape; it does not evaluate landmark precision, temporal jitter, occlusion robustness, or blendshape fidelity.

## GVHMR blocker

GVHMR is listed as an adoption-only entry in the bench project. It points at `/home/arthur/projects/GVHMR/.venv` after licensed SMPL/SMPL-X body-model assets land. The bench harness never provisions that environment or duplicates those licensed assets. Until the SMPL license is fulfilled and the external venv is ready, GVHMR is not dispatchable.

## Rerun

The bench project lives at `local/companion-model-bench/project/`. Environment: Python 3.11 via mise, uv, shared HuggingFace and uv caches on the desktop. The `bench` CLI handles setup, single runs, and matrix dispatch. Per-model runners follow the contract `models/<name>/runner.py run --input <clip.mp4> --out <dir>`. Logs are under `.runs/`; results stage under `results/` before explicit sync to `data/model-bench/`.
