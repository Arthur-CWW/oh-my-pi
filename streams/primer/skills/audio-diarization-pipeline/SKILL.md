---
name: audio-diarization-pipeline
description: "Assess and run a reproducible audio transcription plus speaker diarization workflow for podcasts/interviews, with provenance, speaker labels, and future OMP skill standardization."
---

# Audio Diarization Pipeline

Use this when Arthur asks whether we have diarization, wants multi-speaker podcast/interview transcripts, or wants to standardize speech-to-text with speaker labels.

## Current state

- Existing `transcribe` skill in `/Users/arthur/agents/vendor/badlogic/pi-skills/transcribe/` calls Groq Whisper (`whisper-large-v3-turbo`) and returns plain text only.
- OMP local STT lives under `/Users/arthur/agents/oh-my-pi/packages/coding-agent/src/stt/` and supports local Whisper/Parakeet transcription, including streaming segments, but not speaker diarization.
- YouTube transcript tooling can fetch captions, but captions are not diarized.
- If cleaned transcripts contain generic `speaker-0` / `speaker-1` labels, treat them as evidence of an external/undocumented diarization run unless provenance is recorded.

## Recommended workflow

1. Prefer existing public transcripts/captions when they are canonical and adequate.
2. For new multi-speaker audio/video with no transcript:
   - acquire audio with `yt-dlp` or use a local file;
   - normalize with `ffmpeg` to 16 kHz mono WAV;
   - run ASR with `faster-whisper` using word timestamps;
   - run speaker segmentation/clustering with `pyannote.audio` (`pyannote/speaker-diarization-3.1` or newer);
   - merge word timestamps with diarization turns;
   - emit raw JSON plus cleaned Markdown with provenance.
3. Rename generic speakers only after evidence:
   - user-provided speaker roster,
   - known host/guest order,
   - repeated self-identification in transcript,
   - or an explicit LLM-assisted mapping marked as inferred.

## Output contract

Every diarized transcript should include a provenance header:

```yaml
source_url: ...
retrieved: YYYY-MM-DD
source_audio: local path or URL
asr_model: ...
diarization_model: ...
speaker_count: auto | N
speaker_map: speaker-0=..., speaker-1=...
limitations: ...
```

Store artifacts like source archives:

- `raw/`: audio metadata, raw ASR JSON, raw diarization turns, merged segment JSON.
- `cleaned/`: readable Markdown transcript with `Speaker (MM:SS)` turns.

## Quality checklist

- Timestamps monotonic.
- Speaker labels switch plausibly at conversational turns.
- No claimed speaker names without evidence.
- Mark overlap/noisy sections as uncertain instead of forcing labels.
- Keep WER/DER claims out unless measured on a ground-truth sample.

## Skill-standardization target

A future repo skill should expose:

```bash
audio-diarization check
audio-diarization transcribe <url-or-file> --output transcript.md
audio-diarization transcribe <url-or-file> --speakers 2 --format json
audio-diarization rename <transcript.md> --map speaker-0=Justin,speaker-1=Host
```

Dependencies to pin: `faster-whisper`, `pyannote.audio`, `torch`, `torchaudio`, `ffmpeg`, `yt-dlp`. Apple Silicon / CPU must remain supported.

## Evidence trail

The first repo-local assessment was written at `docs/research/audio-diarization-pipeline/diarization-pipeline-assessment.md` in `wrapped-commentary-reader` on 2026-06-30.
