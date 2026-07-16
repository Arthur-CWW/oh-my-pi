---
title: Local Kokoro TTS on RTX 3090
date: 2026-07-15
agent: DesktopGPUFinisher
status: done
---

# Local TTS proof

## Result

Kokoro generated all four narration scripts plus a second-voice comparison on the desktop RTX 3090. The Mac copies are 24 kHz mono PCM WAVs and all pass local `ffprobe` with an audio stream and duration greater than 10 seconds.

The original failure was a CUDA/driver mismatch: `~/tts-lab/.venv` had `torch 2.13.0+cu130` (CUDA 13.0), while driver 570.172.08 advertises CUDA 12.8; `torch.cuda.is_available()` was false. A known-working desktop environment reports `torch 2.7.1+cu126`, CUDA 12.6, and the RTX 3090 available. Two direct cu128/cu126 reinstalls were attempted, but NVIDIA wheel fetches timed out. Generation therefore used the isolated Kokoro environment with the proven CUDA runtime placed first on `PYTHONPATH`; the measured render reports `torch 2.7.1+cu126` and CUDA 12.6.

## Artifacts and measurements

| Script / voice | Kokoro duration | Jimeng duration | Kokoro size | Render time | Speed |
|---|---:|---:|---:|---:|---:|
| `nothing-human-makes-it-out` / `am_michael` | 38.250 s | 36.595 s | 1,836,044 B | 4.672 s cold | 8.19× realtime |
| `what-lab` / `am_michael` | 33.100 s | 31.208 s | 1,588,844 B | 0.223 s warm | 148.66× realtime |
| `the-number-with-no-name` / `am_michael` | 40.225 s | 37.477 s | 1,930,844 B | 0.304 s warm | 132.53× realtime |
| `not-a-serious-species` / `am_michael` | 32.450 s | 33.994 s | 1,557,644 B | 0.224 s warm | 145.13× realtime |
| `the-number-with-no-name` / `am_fenrir` | 31.150 s | 37.477 s | 1,495,244 B | 3.385 s voice-cold | 9.20× realtime |

End-to-end wall clock was 75 s including model/voice acquisition and startup. CUDA allocator peak was 1,170 MiB; `nvidia-smi` observed a 1,774 MiB process peak and 100% utilization. Signal checks found peaks from -6.7 to -4.7 dBFS for `am_michael` and -2.7 dBFS for `am_fenrir`, with no clipping.

Supporting files: `generation-metrics.json`, `generation-recovery.log`, `nvidia-during-recovery.csv`, and `wall-clock-recovery.json`.

## Comparison with Jimeng

This harness did not expose an audio-monitoring channel, so subjective items are deliberately conservative and marked as inference rather than fabricated listening results.

| Axis | Kokoro baseline vs Jimeng |
|---|---|
| Pronunciation / jargon | The supplied four scripts do **not** contain “Kolmogorov,” so that requested stress case was not exercised. The text does exercise `BB of n`, `DeepSeek`, `Los Alamos`, `Neo-China`, `hypersynthetic`, `nanospasm`, and `UBI`; an auditory pronunciation verdict remains unverified. |
| Pacing | Objectively, `am_michael` is 1.06–1.07× Jimeng duration on three scripts and 0.95× on `not-a-serious-species`; `am_fenrir` is much brisker at 0.83× Jimeng on its comparison script. `am_michael` is therefore the safer baseline for the incantatory lane. |
| Gravitas | [INFERENCE] `am_michael` is the better fit because its slower measured delivery leaves more rhetorical space; `am_fenrir` is brighter/louder by level and substantially faster. A listening review is still required before editorial use. |
| Artifacts | Objective decode and signal checks are clean: continuous PCM, valid mono streams, no clipping, and no container errors. This does not rule out prosody or phoneme artifacts. |

## Recommendation

**Adopt with caveats as a fast, free baseline**, using `am_michael` at speed 0.9 for scratch narration and layout timing. Do not treat a preset Kokoro voice as the presentation-layer product. Arthur's direction calls for a few custom recurring characters; voice cloning with Fish Speech or Qwen3-TTS is the confirmed next step. No cloning model was installed in this pass.

## Exact rerun

```bash
ssh desktop
cd ~/tts-lab

# Driver/runtime diagnosis
nvidia-smi
.venv/bin/python -c 'import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())'
$HOME/.venv/bin/python -c 'import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())'

# Uses the already-proven cu126 runtime without duplicating multi-GB wheels.
mkdir -p output evidence
PYTHONPATH="$HOME/.venv/lib/python3.12/site-packages" \
  .venv/bin/python generate_kokoro.py --scripts scripts.json --output output \
  --voice am_michael --comparison-voice am_fenrir --speed 0.9
```

Local verification used:

```bash
for f in workflows/scene-lab/reports/2026-07-15-local-tts/*.wav; do
  ffprobe -v error -show_entries stream=index,codec_type,codec_name,sample_rate,channels,duration \
    -show_entries format=duration,size -of json "$f"
done
```
