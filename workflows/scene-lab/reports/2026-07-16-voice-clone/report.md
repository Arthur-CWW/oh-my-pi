---
title: Zero-shot voice cloning proof on desktop 3090
date: 2026-07-16
agent: VoiceCloneFinish
status: done
---

# Zero-shot voice cloning proof

## Goal

Prove a local, repeatable zero-shot cloning pipeline with two owned reference voices, measure it on the desktop RTX 3090, and restore the pre-existing Kokoro CUDA environment.

## Decision

**Chosen clone candidate: Qwen3-TTS 1.7B Base.** Fish Speech S2 Pro advertises strong 10–30 second cloning and leading similarity/quality, but its current open model is a 4B system whose documented fast paths target SGLang/vLLM and H200-class serving. Qwen3-TTS has a smaller 1.7B clone model, supports short references, ships a maintained `qwen-tts` package, and exposes a direct local `generate_voice_clone` API. The isolated clone environment is `~/tts-lab/fish/.venv` with `qwen-tts==0.1.1`, `torch==2.9.1+cu128`, and `torchaudio==2.9.1+cu128`.

The proof completed, but the two references produced materially different reliability. The Kokoro-reference clone was bounded and usable for evaluation; the Jimeng-reference run failed to terminate naturally at the end of the supplied text and produced 655.28 seconds from a roughly 31-second script. Qwen therefore remains a candidate rather than the production default.

## Inputs

- Jimeng narrator reference: `workflows/scene-lab/assets/narration/what-lab.mp3` (owned project asset; 31.208 seconds; clone prompt used the first 29 seconds, resampled to 24 kHz mono).
- Kokoro reference: `workflows/scene-lab/reports/2026-07-15-local-tts/what-lab-am_michael.wav` (owned locally generated asset; 33.100 seconds; clone prompt used the first 29 seconds).
- Common generation text: the full “What Lab?” passage from `docs/research/power-posting-sources/vibe-brief.md`.
- Model: `Qwen/Qwen3-TTS-12Hz-1.7B-Base`, bfloat16, PyTorch SDPA. `flash-attn` was not installed and was not added for this proof.

Both calls received the identical full script. The aligned reference transcript intentionally stopped at the end of the first 29 seconds.

## Verified outputs

| Artifact | ffprobe result |
|---|---|
| `what-lab-qwen3-1.7b-clone-jimeng.wav` | PCM s16le, 24 kHz, mono, 655.280 s, 31,453,484 bytes |
| `what-lab-qwen3-1.7b-clone-kokoro-am_michael.wav` | PCM s16le, 24 kHz, mono, 28.080 s, 1,347,884 bytes |
| `kokoro-regression-am_michael.wav` | PCM s16le, 24 kHz, mono, 3.300 s, 158,444 bytes |

The two clone renders both have an audio stream and exceed the required 10 seconds. Local measurement artifacts are `clone-metrics.json`, `nvidia-smi.csv`, `clone-audio-analysis.json`, and `kokoro-regression-metrics.json`.

## GPU and speed measurements

The 100 ms `nvidia-smi` poll collected 15,837 samples from 01:00:26.266 through 01:26:51.580 and observed a total-device peak of **8,162 MiB** and peak utilization of 100%. Torch reported 263.125 MiB used before load and 4,439.125 MiB after model load. Initial load took 646.063 seconds because it included the first download of the approximately 3.9 GB model snapshot; warm runs should not use that number as model-load latency.

| Render | Audio duration | Generation | RTF | x realtime | Torch peak allocated | Outcome |
|---|---:|---:|---:|---:|---:|---|
| Qwen clone, Jimeng ref | 655.280 s | 896.933 s | 1.369 | 0.731x | 6,000.6 MiB | runaway audio duration; did not stop near expected length |
| Qwen clone, Kokoro ref | 28.080 s | 37.048 s | 1.319 | 0.758x | 4,815.8 MiB | bounded render |
| Kokoro regression, `am_michael` | 3.300 s | 0.775 s | 0.235 | 4.256x | 622.1 MiB | passed on CUDA |

The Qwen total-device peak stayed well below 20 GB. On these runs Kokoro generated about 5.6 times as much audio per wall-clock second as the bounded Qwen clone (4.256x versus 0.758x), though the regression line is shorter and this is not a controlled long-form benchmark.

## Clone-fidelity review

No auditory playback surface was available to this worker, so the qualitative judgments below are deliberately grounded in duration, pitch, voicing, spectral, and clipping inspection rather than presented as a fabricated listening test. `clone-audio-analysis.json` contains the measurements; a human listening pass remains the final adoption gate.

### Jimeng reference clone

- **Timbre match:** mixed. The first-minute spectral centroid stayed close to the reference (3,003 Hz versus 2,938 Hz), which is consistent with retaining some brightness, but median voiced pitch shifted sharply upward (184.9 Hz versus 122.0 Hz). This is not evidence of a stable speaker match.
- **Prosody:** poor. Pitch spread expanded from a 33.0 Hz interquartile range to 126.2 Hz, and detected voiced-frame share fell from 68.2% to 18.8%. The 655.28-second result is 21 times the full reference duration for the same passage, so pacing and termination are decisively wrong.
- **Artifacts:** severe sequence-level artifact. The generated audio lasted 655.28 seconds instead of ending near the roughly 31-second supplied script. There was no hard clipping, but the runaway duration alone makes this render unusable without transcript-completeness and duration verification. Its exact audible continuation content was not auditioned, so the report does not claim whether it repeated text, produced non-speech audio, or did both.

### Kokoro `am_michael` reference clone

- **Timbre match:** directionally plausible but not identical. Median pitch remained near the reference (103.2 Hz versus 113.8 Hz), while the clone's spectral centroid was lower (1,955 Hz versus 2,566 Hz), indicating a darker/less bright realization.
- **Prosody:** good relative stability. The 28.08-second clone is close to the 29-second aligned prompt and shorter than the 33.10-second full Kokoro baseline. Pitch spread narrowed from 32.6 Hz to 24.4 Hz, consistent with a somewhat flatter delivery rather than the Jimeng run's instability.
- **Artifacts:** no clipping and no duration runaway. Pause-frame share was lower than the reference (12.6% versus 20.1%), so the clone likely packs phrases more tightly. Signal inspection found no comparable catastrophic artifact.

### Comparison with the Kokoro baseline

The direct Kokoro baseline remains the operational winner: it is dramatically faster, uses far less VRAM, is deterministic enough for batch narration, and the repaired environment reproduced a clean CUDA render. The Qwen Kokoro-reference clone is interesting when identity transfer matters, but for this same synthetic source voice it adds latency and changes brightness/pacing without an obvious workflow benefit. Qwen's value is cloning a character voice unavailable as a native Kokoro preset, not re-cloning Kokoro itself.

## Kokoro regression repair

The existing `~/tts-lab/.venv` had drifted to `torch==2.13.0` with CUDA 13.0 and `torch.cuda.is_available() == False`; the installed driver supports CUDA 12.8, as proven by the clone environment. The fish environment's installed pair was checked first: `torch==2.9.1+cu128` and `torchaudio==2.9.1+cu128`. The Kokoro environment did not contain torchaudio, so only its existing Torch dependency was replaced:

```bash
ssh desktop 'bash -lc '\''~/.local/bin/uv pip install --python ~/tts-lab/.venv/bin/python "torch==2.9.1+cu128" --index-url https://download.pytorch.org/whl/cu128'\'''
```

Post-repair CUDA check:

```text
torch 2.9.1+cu128 cuda 12.8 available True device NVIDIA GeForce RTX 3090
```

The one-line regression text was “What lab? Why are we calling it a lab?” The generator always emits the named primary and comparison voices for its required `the-number-with-no-name` key; the primary `am_michael` result completed in 0.775 seconds for 3.300 seconds of audio at 4.256x realtime. The fresh primary WAV is copied beside this report and was ffprobe-verified.

## Exact rerun commands

From the Mac repository root:

```bash
scp workflows/scene-lab/reports/2026-07-16-voice-clone/generate_clones.py desktop:tts-lab/fish/
scp workflows/scene-lab/reports/2026-07-16-voice-clone/run-clones.sh desktop:tts-lab/fish/
ssh desktop 'bash -lc '\''ffmpeg -y -loglevel error -i ~/tts-lab/fish/input/jimeng-what-lab.mp3 -t 29 -ar 24000 -ac 1 ~/tts-lab/fish/input/jimeng-what-lab-ref-29s.wav; ffmpeg -y -loglevel error -i ~/tts-lab/fish/input/kokoro-am_michael-what-lab.wav -t 29 -ar 24000 -ac 1 ~/tts-lab/fish/input/kokoro-am_michael-what-lab-ref-29s.wav'\'''
ssh desktop 'bash -lc '\''chmod +x ~/tts-lab/fish/run-clones.sh; tmux new-session -d -s voice-clone ~/tts-lab/fish/run-clones.sh'\'''
```

After tmux `voice-clone` exits:

```bash
scp desktop:tts-lab/fish/output/what-lab-qwen3-1.7b-clone-jimeng.wav workflows/scene-lab/reports/2026-07-16-voice-clone/
scp desktop:tts-lab/fish/output/what-lab-qwen3-1.7b-clone-kokoro-am_michael.wav workflows/scene-lab/reports/2026-07-16-voice-clone/
scp desktop:tts-lab/fish/output/clone-metrics.json workflows/scene-lab/reports/2026-07-16-voice-clone/
scp desktop:tts-lab/fish/logs/nvidia-smi.csv workflows/scene-lab/reports/2026-07-16-voice-clone/
for f in workflows/scene-lab/reports/2026-07-16-voice-clone/what-lab-qwen3-1.7b-clone-*.wav; do ffprobe -v error -show_entries stream=codec_name,sample_rate,channels -show_entries format=duration,size -of json "$f"; done
```

Kokoro repair and regression rerun:

```bash
ssh desktop 'bash -lc '\''~/.local/bin/uv pip install --python ~/tts-lab/.venv/bin/python "torch==2.9.1+cu128" --index-url https://download.pytorch.org/whl/cu128'\'''
scp workflows/scene-lab/reports/2026-07-16-voice-clone/kokoro-regression.json desktop:tts-lab/fish/input/
scp workflows/scene-lab/reports/2026-07-16-voice-clone/run-kokoro-regression.sh desktop:tts-lab/fish/
ssh desktop 'bash -lc '\''chmod +x ~/tts-lab/fish/run-kokoro-regression.sh; tmux new-session -d -s voice-clone ~/tts-lab/fish/run-kokoro-regression.sh'\'''
```

## Recommendation

**Keep Kokoro as the default recurring narration engine now. Pilot Qwen3-TTS 1.7B only for recurring characters whose identity cannot be covered by a native Kokoro voice.** For a Qwen character, compute and retain the reusable clone prompt once, generate lines in bounded chunks, and reject any output whose duration/text coverage falls outside an expected range. The Jimeng runaway means an explicit generation-token cap plus transcript/duration QA is required before unattended batches.

A future character-reference sourcing pass should:

1. use only owned or explicitly licensed material;
2. collect one clean, dry, single-speaker 10–30 second clip per character, without music, overlapping dialogue, reverb, or effects;
3. preserve the exact transcript, source/license provenance, character/actor identity, language/accent, emotional register, and audio normalization metadata beside the asset;
4. prefer a neutral reference for the reusable identity prompt, with separately labeled emotional references only when the workflow needs them;
5. evaluate each candidate against fixed held-out lines for speaker similarity, text completeness, pacing, pronunciation, noise, and termination before promoting it to the recipe catalog; and
6. retain Kokoro as fallback when a character clip fails those gates.

No fine-tuning or character-clip scraping was performed.
