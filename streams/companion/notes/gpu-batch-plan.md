# Companion SMPL GPU pilot and catalogue batch plan

## Decision and current status

Pipeline choice is **GVHMR** (SIGGRAPH Asia 2024). `SotaPoseResearch` did not provide a different decision before preflight; `SicoMotionPilot` confirmed there is no verified desktop GVHMR/SMPL checkout, executable runner, virtual environment, or output contract. Under `gpu-workload-dispatch` this makes the pilot **not dispatchable with manual v1**: that workflow may run only an already-installed project and forbids cloning, package installation, environment creation, and checkpoint downloads.

No GPU job was launched, no tmux session was created, and no clips were copied to the desktop. This is deliberate: staging without a valid CWD/command/output contract would leave unowned remote state. The precise provisioning list is in `local/companion-gpu-pilot/pilot-contract-blocked.txt`.

## Desktop health — 2026-07-14

The fixed dotfiles `health-check` passed over SSH alias `desktop`. The host runs kernel `6.8.0-134-generic`; SSH, Tailscale, and NetworkManager are enabled and active. The NVIDIA GeForce RTX 3090 reports driver 570.172.08 / CUDA 12.8, 1 MiB of 24,576 MiB used, 0% utilization, and no compute processes. ComfyUI's checker passed, but its user service is inactive and disabled; it was not changed. `/home/arthur` is on an 854 GiB filesystem with 53 GiB free and 94% used. That is sufficient for a three-short-clip pilot after an explicit output-size check, but it is too tight to assume a full catalogue's rendered videos can remain resident.

Machine-readable evidence: `local/companion-gpu-pilot/desktop-health-manifest.txt`.

## Resumed desktop provisioning state — 2026-07-14

Inspection found that the prior provisioning had progressed substantially beyond the earlier blocked record. `/home/arthur/projects/GVHMR` exists at commit `6ec3ca39336c50492c0fae65fba2fb831fc7d866`, with a clean working tree, a 5.9 GiB Python 3.10.16 virtual environment, CUDA-capable PyTorch 2.3.0+cu121, and all four public checkpoints named below. The checkout plus inputs occupies 12 GiB. The filesystem now has 39 GiB free at 96% used, so the raw-only three-clip pilot remains acceptable but rendered outputs and duplicate catalogues must not accumulate.

No durable prior provisioning session remained: an initial inspection briefly reported an attached tmux session named `0`, but the tmux server had exited by the next inspection. A home-directory search excluding caches, virtual environments, dependency trees, and VCS metadata found no licensed `SMPL_{GENDER}.pkl` or `SMPLX_{GENDER}.npz` files. The three declared pilot clips are now staged under `/home/arthur/projects/GVHMR/inputs/pilot/`. Session `gvhmr-setup` is retained with its durable log and status under `/home/arthur/projects/GVHMR/.runs/setup/gvhmr-setup/`.

GVHMR is precisely blocked on one operator action: place licensed `SMPL_NEUTRAL.pkl` at `/home/arthur/projects/GVHMR/inputs/checkpoints/body_models/smpl/SMPL_NEUTRAL.pkl` and licensed `SMPLX_NEUTRAL.npz` at `/home/arthur/projects/GVHMR/inputs/checkpoints/body_models/smplx/SMPLX_NEUTRAL.npz`, then restart the exact `gvhmr-setup` session. No sudo or unlicensed substitute is acceptable. Once those two files are present, the existing environment and public checkpoints can be re-verified and the documented folder runner can be dispatched for the raw three-clip pilot.

## Intended three-clip pilot

All clips are 30 fps and are selected to cover aspect ratios and duration:

| clip | dimensions | duration | bytes | SHA-256 |
|---|---:|---:|---:|---|
| `7200911766728002858` | 1080×1084 | 16.577 s | 1,493,953 | `4a8342f3ad1f5993054c374bb751a88e1e0e00c3d3e5539d8398f3b0a1e8eedc` |
| `7211743634759175470` | 1080×1920 | 9.449 s | 2,549,769 | `437f04b90f49b345358350ebaacd0f945b57b0ffb8f1b17a7e0049989081c055` |
| `7479225467057229086` | 1080×1920 | 27.305 s | 9,892,919 | `d48396a40eae4ec88e9fb63a5d00bea32fbe17ade726f35d4c38e181f3b47f10` |

Source paths are under `data/tiktok-catalogue/mynameissico/`; hashes are also in `local/companion-gpu-pilot/pilot-inputs.sha256`.

Once provisioning is complete, the dispatch contract must name the installed absolute CWD and its executable project-owned folder wrapper. The wrapper should invoke GVHMR's folder demo, preserve each `hmr4d_results.pt`, accept explicit input/output directories, and avoid rendering unless render evidence is deliberately declared; raw motion is the required artifact. Use SimpleVO for moving-camera clips. `-s` is valid only after confirming a static camera. The run gets one unique `gpu-gvhmr-sico-pilot-<UTC>` tmux session, a `<CWD>/.runs/gpu/<SESSION>` run directory, a finite `2h` timeout, explicit per-file remote inputs/outputs/artifacts, the skill's immutable manifest/status/log/PID files, post-run SHA-256 checks, and explicit sync-back into `local/companion-gpu-pilot/<SESSION>/`.

## Exact missing provisioning

Provisioning must happen outside `gpu-workload-dispatch`, then be verified read-only before a new launch contract:

1. Official `zju3dv/GVHMR` checkout at a declared absolute desktop path.
2. Its documented Python 3.10 runtime with requirements and editable project install, including CUDA-capable PyTorch.
3. Licensed SMPL-X `SMPLX_{GENDER}.npz` and SMPL `SMPL_{GENDER}.pkl` models in the documented checkpoint tree.
4. `gvhmr_siga24_release.ckpt`, HMR2 `epoch=10-step=25000.ckpt`, `vitpose-h-multi-coco.pth`, and `yolov8x.pt`. DPVO is optional and not recommended for the speed pilot.
5. An executable, project-owned folder runner with deterministic input→output naming and raw result preservation. An ad-hoc remote Python or bootstrap command does not satisfy the skill.

## Bridge: GVHMR SMPL rotations to body-track JSON

### Inputs and target contract

GVHMR's saved result is a Torch file containing `smpl_params_global` and `smpl_params_incam`. Each parameter dictionary includes `body_pose` as 21 local axis-angle rotations, `global_orient`, `betas`, and translation. Prefer `smpl_params_global` so camera motion is not baked into the performance. Convert axis-angle to normalized quaternions, enforce temporal sign continuity (`dot(q[t-1], q[t]) >= 0`), and sample at the source video timestamps.

The existing replay path consumes body-track version 1 with this exact 13-bone order:

`hips, spine, chest, neck, head, leftUpperArm, leftLowerArm, rightUpperArm, rightLowerArm, leftUpperLeg, leftLowerLeg, rightUpperLeg, rightLowerLeg`

Each frame stores `tMs`, 13 quaternions quantized by 32,767, four region confidences quantized by 65,535, and exactly 33 landmark tuples quantized by 10,000 / 65,535. The bridge output goes to `data/body-tracks/<clipId>.json`; no timeline format change is needed.

### Retarget map

Use the standard 22-joint SMPL chain (root plus 21 body joints). Preserve local rotations, composing joints that the target rig omits:

| body-track bone | SMPL source local rotation |
|---|---|
| hips | `global_orient` after world→three.js basis conversion |
| spine | compose `spine1` then `spine2` |
| chest | `spine3` |
| neck | `neck` |
| head | `head` |
| left/right upper arm | compose same-side `collar` then `shoulder` |
| left/right lower arm | same-side `elbow` |
| left/right upper leg | same-side `hip` |
| left/right lower leg | same-side `knee` |

Ankle/foot rotations cannot be represented by body-track v1 and must not be silently folded into the lower leg. If visible foot articulation is required, evolve the replay schema explicitly rather than corrupting this mapping.

Raw SMPL and VRM bone bases are not interchangeable. For each mapped joint, derive a constant rest-pose alignment from SMPL's neutral skeleton and the active VRM humanoid rest pose, then conjugate the local rotation: `R_vrm = A × R_smpl × A⁻¹`. For composed chains, multiply source rotations in parent-to-child order before alignment. Calibrate the global change-of-basis with a neutral T-pose and verify up/forward/left-right visually; do not hard-code an unverified sign flip.

### Landmarks and confidence

Replay v1/server validation requires 33 landmark rows even though playback uses the rotations. Run SMPL/SMPL-X forward kinematics with the predicted betas, project joints with `K_fullimg` for overlay coordinates, and map available joints to the MediaPipe 33 slots. Derived midpoints may fill shoulders/hips; unavailable face, finger, heel, and toe slots must be explicit zero-confidence placeholders, not invented high-confidence coordinates. Region confidence should be derived from detector/keypoint evidence retained in GVHMR (`kp2d`/tracking), aggregated with the same arms/torso/head/legs semantics. If that evidence is unavailable in the retrieved artifact, use conservative documented constants only for rotations and zero for unavailable landmark slots.

A converter prototype is intentionally not shipped without a real `hmr4d_results.pt`: key shapes, coordinate basis, projection, and end-to-end schema validation could not be exercised, and an untested converter would create plausible but false motion.

## Quality comparison

No numeric quality claim is made. There is neither a GVHMR result nor a MediaPipe body track for the same selected clip. `local/companion-gpu-pilot/quality-comparison.json` records the block and exact comparison protocol.

For the first completed clip, compare both tracks over identical source frames and mirroredness:

- **Joint smoothness:** median and p95 quaternion geodesic angular acceleration (rad/s²), plus p95 angular jerk (rad/s³), per mapped joint and aggregated. Lower is smoother.
- **Limb stability:** coefficient of variation of shoulder–elbow, elbow–wrist, hip–knee, and knee–ankle segment lengths across mutually valid frames. Lower is more stable.
- **Foot skate:** horizontal ankle speed during low-height contact candidates, after common root/coordinate alignment.
- **Coverage:** fraction of frames valid for every metric; reject comparisons with unequal effective coverage.

Report raw tracks and one identical filter setting. Never compare filtered SMPL against raw MediaPipe. SMPL's fixed-shape forward kinematics enforces stable bone lengths by construction, so limb-length stability alone is not evidence of better pose accuracy.

## Full-catalogue batch shape — follow-up, not launched

Current catalogue measurement is 495 MP4 clips totaling 7,707 seconds (2.141 hours), with metadata for all 495.

### Concurrency and sizing

Start with **one GVHMR process on the RTX 3090**, using the folder runner's batching rather than multiple competing CUDA processes. Increase the model's internal clip/frame batch only after pilot peak VRAM is recorded; keep at least 2 GiB headroom and stop scaling before allocator retries/OOM. A second concurrent process is not the default: tracker, ViTPose, feature extraction, and renderer have different memory peaks, and process concurrency duplicates model weights. If pilot telemetry proves peak use below roughly 10 GiB and no CPU/I/O contention, test exactly two processes in a separate, explicit experiment before adopting it.

Partition the catalogue into deterministic chunks of 25 clip IDs (20 chunks, final chunk 20), with a reviewed input manifest and expected artifact list per chunk. One manual dispatch owns one exact tmux session; this is not a scheduler or daemon. Do not run the full catalogue until the three-clip pilot is retrieved and compared.

### ETA

No wall-clock ETA is asserted before a successful pilot. From the pilot log, record preprocessing, inference, optional rendering, total wall time, and peak VRAM. Compute real-time factor `RTF = pilot wall seconds / 53.331 source seconds`. Then estimate compute as `7,707 × RTF`, add measured per-clip startup overhead for 495 clips, add 15% operational margin, and report both one-process and experimentally verified two-process cases. Rendering must be timed separately and excluded from the extraction ETA if raw SMPL is the catalogue artifact.

### Artifacts and sync-back

The authoritative per-clip GPU artifact is raw `hmr4d_results.pt` plus a small metadata record: source clip ID/hash, GVHMR revision, checkpoint hashes, source dimensions/fps/duration, command version, timings, and conversion status. Generate explicit remote SHA-256 files only after outputs exist. Sync each completed chunk immediately to a reviewed local destination, verify remote-to-local hash mappings, then convert into `data/body-tracks/<clipId>.json`. Do not retain rendered videos on the 94%-full desktop filesystem unless they are declared pilot evidence; never delete remote evidence automatically.

### Job-queue integration

Do not overload the current browser MediaPipe `pose-track-extract` meaning. The follow-up should add a distinct built-in kind, **`smpl-track-extract`**, with subject fields `clipId`, `batchId`, and immutable `sourceSha256`. Its handler should only consume a previously synced raw SMPL artifact and run the local converter; it must not SSH, provision the desktop, launch tmux, or create a hidden scheduler. Existing `tracks-extract` remains the browser MediaPipe pose+face path, and `face-track-extract` remains independent because GVHMR supplies body motion only. On successful conversion the normal `data/body-tracks/<clipId>.json` presence flag makes the lab replay/timeline path pick up the result without a second playback system.
