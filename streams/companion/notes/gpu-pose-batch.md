# GPU corpus pose processor (RTX, RTMPose-wholebody)

Built 2026-07-15 in answer to "can we optimize to run NVIDIA / big batches / streaming data processor" — the CUDA-equivalent batch lane. Apple Vision itself cannot run on NVIDIA; this runs RTMPose-wholebody (body + 21-joint hands + face keypoints, COCO-wholebody 133) on the RTX 3090.

## What it is

- Desktop project `~/projects/model-bench/models/gpu-pose-batch/` (`process_corpus.py`, own uv venv): streaming pipeline — NVDEC hardware decode → rtmlib RTMPose-wholebody (`balanced`, yolox-m detector + rtmw-dw-x-l) on ONNXRuntime CUDA EP → per-clip JSONL `{frameIndex, ptsMs, body:{joints}, hands:{left,right}}` (normalized upper-left, named joints).
- Resumable, `--limit/--overwrite/--decode/--mode` flags; durable log `logs/gpu-pose-batch-full.log`.
- Mac-side converter `apps/ai-companion-rtc/scripts/apple-motion-oracle/convert-gpu-tracks.ts` reshapes JSONL → `data/gpu-pose-tracks/<clipId>.json` in the provider-compare ingest shape; the /lab Provider Compare player auto-discovers them (no UI changes).

## Measured (full sico corpus, 2026-07-15)

- **281/281 clips, 0 errors, 105,643 FULL frames in 48.3 min** — aggregate 36.5 fps, inference 41.8 fps, 5.8 clips/min. GPU: ~75-79% util, ~1.1GB VRAM, ~265W, 68-69°C. Decode: NVDEC.
- Comparison point: the Mac Apple Vision batch took 4.34h for 52,519 frames (every-2nd-frame, 3 Vision requests/frame incl. 3D). Per-frame, the GPU lane is ~22x faster (single 2D wholebody model; no 3D lane).
- Tracks live at `data/gpu-pose-tracks/` (605MB, 281 clips) and render side-by-side with Vision/MediaPipe in /lab.

## Operational lessons

- The agent-side tmux+tee launcher put uv/python into stopped (T) state twice; plain `nohup bash -c '… >> log 2>&1' & disown` from a bash login shell is the reliable desktop launch shape. Desktop default shell is fish — always wrap in `bash -lc`.

## Rerun (any corpus)

```bash
# desktop
cd ~/projects/model-bench && nohup bash -c "models/gpu-pose-batch/.venv/bin/python models/gpu-pose-batch/process_corpus.py --input-dir data/<corpus> --output-dir results/gpu-pose-batch/<run> --decode auto >> logs/gpu-pose-batch-<run>.log 2>&1" & disown
# mac: fetch + convert + auto-appear in /lab
rsync -q 'desktop:~/projects/model-bench/results/gpu-pose-batch/<run>/*' /tmp/<run>/
bun apps/ai-companion-rtc/scripts/apple-motion-oracle/convert-gpu-tracks.ts /tmp/<run> data/gpu-pose-tracks
```
