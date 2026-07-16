# Video-derived semantic motion pilot

## Scope and source handling

This is a local prototype for translating Arthur's own saved TikToks into the companion's closed semantic motion vocabulary. The source MP4s and thumbnails remain under `data/tiktok-catalogue/mynameissico/`; they are not redistributable project assets. Saving a TikTok locally does not grant a license to republish the video, likeness, music, choreography, or a derived animation. Keep source media, generated timelines, screenshots, and future skeletal traces local unless the depicted creator and other rights holders explicitly permit publication. Do not copy Grok, LADS, or VTuber assets; they are behavioral references only.

The existing avatar/source license inventory remains in [avatar-landscape.md](./avatar-landscape.md). This note adds no avatar asset or competing license table.

## Pilot selection

The catalogue metadata was scanned for short descriptions and durations, then 1 fps contact sheets were inspected for observable framing and motion.

| TikTok id | Duration | Description | Selection finding |
|---|---:|---|---|
| `7476646361144872223` | 11.7 s | “I love cosplays that are easy to move in, ignore my bad dance moves …” | Selected. Mostly full-body outdoor dance: arm sweeps, side steps, torso turns, pivot, raised-knee pose, forward bend. Opening crop and subject scale changes are limitations. |
| `7476939340967382303` | 14.0 s | “Not a perfect dancer but hope you can enjoy …” | Screened candidate, excluded from the two-clip output set after Gemini repeatedly omitted a required boundary field. The clip visibly contains arm raises, steps, crossed-leg poses, weight shifts, and a turn, but no invalid timeline was saved. |
| `7591510153501887774` | 13.7 s | “pretend i did the dance …” | Selected. Clear dance/pose sequence with arm extensions, side leans, wide stance, steps, crouches, and rise; opening and low crouches are partly cropped. |

`7638349019953040671` was rejected: its visible movement is upper-body only (head-to-hips/upper-thigh framing), not the requested full-body reference.

## Gemini findings (2026-07-14)

`apps/ai-companion-rtc/src/llm-cca.ts` mints credentials synchronously with:

```text
omp token google-antigravity --raw
```

The returned JSON supplies `token`, `projectId`, and `expiresAt`. Requests use bearer auth and the internal SSE endpoint `/v1internal:streamGenerateContent?alt=sse`, preferring `daily-cloudcode-pa.sandbox.googleapis.com` and falling back to the daily host on HTTP 404. Antigravity wire model ids are effort-suffixed for Gemini 3.5.

Observed, not inferred:

- `gemini-3.5-flash-low` returned HTTP 429 `RESOURCE_EXHAUSTED` (“Individual quota reached… Resets in 66h34m28s”). That probe could not establish whether this subscription lane accepts video.
- `gemini-3-flash` accepted an `inlineData` part with `mimeType: video/mp4` on the same subscription endpoint and returned timeline JSON from the actual MP4. Successful saved outputs report `source.extraction: "gemini-video"`.
- The first `gemini-3-flash` response for `7476646361144872223` violated the declared TTL maximum and was rejected by boundary validation. A subsequent response passed. For `7476939340967382303`, repeated responses omitted `intensity`; both were rejected and no output was fabricated.
- Frame fallback was not needed for the two saved timelines. `scripts/video-motion.ts --frames` implements the fallback explicitly: ffmpeg samples 2 fps JPEGs at 512 px width, labels every image with its absolute 500 ms timestamp, then submits the image sequence. Automatic fallback occurs only for an explicit media/inline-data/unsupported error, not quota or malformed model output.

Run shape:

```bash
bun scripts/video-motion.ts \
  --model gemini-3-flash \
  --input data/tiktok-catalogue/mynameissico/<date>_<id>.mp4 \
  --output data/motion-timelines/<id>.json
```

The script owns the closed vocabulary in its prompt and validator. It rejects unknown gesture, affect, action, phase, lane, or channel names; unordered/out-of-range absolute `atMs` anchors; invalid intensity/VAD/TTL/crossfade values; duplicate gesture channels; and affect mixes that do not total approximately 1. Saved files contain source description and an embedded local thumbnail for the lab vibe check.

Current semantic projection is intentionally coarse. Gesture events use L0 `handleBody`; affect events use `setAffect`; optional action events call `playAction` only when the active handle exposes it. Missing action names or an absent action API degrade by skipping that action while subsequent gesture and affect events continue. This pilot does not claim joint-level mocap or choreography fidelity.

## Motion Lab timeline player

In `/lab`, **Timeline** loads one generated JSON file locally. Play/pause uses `performance.now()` as the wall-clock source; scrub resets the event cursor to the first event at or after the chosen absolute position. The thumbnail and saved description remain visible beside the transport for a side-by-side vibe check. The panel reports the most recently dispatched ontology event and skipped action degradation.

The timeline file remains the evidence record. A screen capture should show the selected clip thumbnail, description, moving playhead, and the avatar responding to at least one semantic event.

## Phase 2: Ubuntu RTX skeletal extraction (plan only)

No desktop job was run in this pilot. The next phase should preserve the semantic timeline as a review/control layer while adding a separate joint-level path:

1. Decode the exact source MP4 to timestamped frames without changing cadence.
2. Extract 2D whole-body keypoints with DWPose or RTMPose. Use 4D-Humans when temporal SMPL body recovery and depth/occlusion robustness justify its heavier runtime.
3. Stabilize confidence-gated tracks, solve root translation and joint rotations, and preserve source timestamps. Never hallucinate low-confidence hidden joints; interpolate only bounded gaps and mark degradation.
4. Retarget the solved rotations to a declared VRM humanoid skeleton with an explicit source-to-target rest-pose calibration, coordinate-system conversion, joint limits, foot locking, and root-motion policy.
5. Export `.vrma`, validate it on the target VRM in the browser, and compare it against the source video and semantic timeline for foot slide, twist, contact, silhouette, timing-anchor alignment, and uncanny motion.

### What must already exist on the desktop

Manual GPU dispatch installs nothing. Before any run, the Ubuntu desktop must already have:

- a documented absolute project checkout and an executable project-owned runner (for example `./scripts/extract-video-motion.sh`);
- a working project venv/runtime with CUDA-compatible PyTorch and the chosen pinned extractor already installed;
- model weights already present with source URL, license, checksum, and redistribution constraints recorded (DWPose/RTMPose or 4D-Humans plus any SMPL body-model files required by that implementation);
- ffmpeg/ffprobe, retarget/export code, a pinned VRM/VRMA mapping, and a validation script already present;
- the exact input MP4 at a declared remote path with checksum;
- explicit remote output paths for keypoints, rotations, confidence/degradation report, `.vrma`, preview render, and logs;
- enough checked disk space and no active conflicting NVIDIA compute process; ComfyUI must remain inactive and must not be mutated by this workflow.

If any item is absent, the job is **not dispatchable with manual v1**. Preparation is a separate, reviewed operation; dispatch must not clone, install, pull, build a runtime, or alter drivers/services.

### Exact future dispatch contract

Fill every placeholder from current desktop evidence before preflight; do not infer old paths:

```bash
HOST=<explicit-ssh-alias>
PROJECT=companion-video-motion
CWD=/absolute/existing/project
SESSION="gpu-${PROJECT}-$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$CWD/.runs/gpu/$SESSION"
MAX_RUNTIME=2h
INPUTS=/absolute/input/7476646361144872223.mp4
OUTPUTS=/absolute/existing/project/out/7476646361144872223
ARTIFACTS=/absolute/existing/project/out/7476646361144872223
COMMAND=(./scripts/extract-video-motion.sh \
  --input "$INPUTS" \
  --output "$OUTPUTS" \
  --extractor dwpose \
  --target-rig /absolute/existing/project/rigs/<target>.vrm \
  --export-vrma "$OUTPUTS/7476646361144872223.vrma")
```

Then follow `skill://gpu-workload-dispatch` exactly: validate names and absolute paths; run the fixed desktop health check; inspect `nvidia-smi` and compute processes; check ComfyUI read-only; verify the existing script/runtime/input/run directory; launch exactly one bounded tmux session with the array command; use `status.txt` plus `EXIT=0` as authority; verify declared artifacts; create remote checksums; retrieve only the declared run evidence and artifacts; compare local and remote hashes. Never claim the job was queued, never auto-retry, and never kill unrelated sessions or GPU processes.
