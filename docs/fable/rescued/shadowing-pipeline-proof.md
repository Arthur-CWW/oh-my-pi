> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-06T07-53-32-097Z_019f366b-08c1-7000-b479-8aaa760c2c42/local/shadowing-pipeline-proof.md

# shadowing-pipeline proof

## Environment checks

- `ffmpeg` found at `/Users/arthur/.local/share/mise/installs/ffmpeg/latest/.mise-bins/ffmpeg`.
- FireRedASR2S research found upstream CUDA-pinned requirements: `torch==2.1.0+cu118` and `torchaudio==2.1.0+cu118`; not runnable as-published on Apple Silicon. FireRedASR2-AED is documented upstream as the timestamp-capable variant, including Chinese character timestamps in `return_timestamp=True` examples.
- Fallback engine implemented: `faster-whisper` word timestamps with per-word Mandarin character interpolation. Package default is `large-v3`; the smoke run used locally cached `base` via the HSK deck venv to avoid a new model download during implementation.

## Real input runs observed

Whisper command equivalent run from the existing HSK deck environment:

```bash
/Users/arthur/apps/hsk-deck/.venv/bin/python -c 'from faster_whisper import WhisperModel; ... model.transcribe(..., language="zh", beam_size=1, vad_filter=True, word_timestamps=True)'
```

Inputs:

- `/Users/arthur/apps/hsk-deck/audio/sentences/hsk1_00001_sentence.mp3` duration 2.472938s
- `/Users/arthur/apps/hsk-deck/audio/sentences/hsk1_00002_sentence.mp3` duration 1.834406s
- `/Users/arthur/apps/hsk-deck/audio/sentences/hsk1_00003_sentence.mp3` duration 2.217531s

Observed transcripts/timings:

```text
hsk1_00001_sentence.mp3 runtime=0.473s
SEG 0.0 2.12 '我今天想去超市买东西'
WORD 0.0 0.24 '我'
WORD 0.24 0.58 '今天'
WORD 0.58 0.94 '想'
WORD 0.94 1.08 '去'
WORD 1.08 1.26 '超'
WORD 1.26 1.46 '市'
WORD 1.46 1.66 '买'
WORD 1.66 1.82 '东'
WORD 1.82 2.12 '西'

hsk1_00002_sentence.mp3 runtime=0.400s
SEG 0.0 1.56 '他今天買了七本書'
WORD 0.0 0.26 '他'
WORD 0.26 0.54 '今天'
WORD 0.54 0.74 '買'
WORD 0.74 0.84 '了'
WORD 0.84 1.06 '七'
WORD 1.06 1.24 '本'
WORD 1.24 1.56 '書'

hsk1_00003_sentence.mp3 runtime=0.416s
SEG 0.0 1.12 '這件事我不了'
WORD 0.0 0.22 '這'
WORD 0.22 0.38 '件'
WORD 0.38 0.6 '事'
WORD 0.6 0.88 '我不'
WORD 0.88 1.12 '了'
SEG 1.12 1.92 '不了'
WORD 1.12 1.7 '不'
WORD 1.7 1.92 '了'
```

Native char timestamps obtained: no. `faster-whisper` provided word timestamps; committed JSON examples mark every sentence with `"charTiming": "interpolated"`.

## JSON validation observed

Valid examples were checked through the package Pydantic validator using the HSK deck Python environment with `PYTHONPATH=/Users/arthur/agents/packages/shadowing-pipeline/src`:

```text
examples/hsk1_00001_sentence.json 1 faster-whisper-base OK
examples/hsk1_00002_sentence.json 1 faster-whisper-base OK
examples/hsk1_00003_sentence.json 2 faster-whisper-base OK
```

Validate CLI was also exercised on one valid example:

```text
valid alignment JSON: examples/hsk1_00001_sentence.json (1 sentences, asr=faster-whisper-base)
```

Mutated-invalid JSON rejection was exercised by deleting required character coverage for `我今天`:

```text
EXIT 1
alignment JSON is invalid:
- sentences.0: Value error, chars must cover every CJK char in text in order, excluding punctuation
```

## Tooling limitation observed

Direct `uv run` from the subprocess sandbox could not complete because child processes were denied filesystem writes for uv cache/temp setup:

```text
error: Failed to initialize cache at `/Users/arthur/.cache/uv`
Caused by: failed to open file `/Users/arthur/.cache/uv/sdists-v9/.git`: Operation not permitted (os error 1)
```

Further attempts with alternate `UV_CACHE_DIR`, `UV_NO_CACHE`, and repo-local `.uv-cache` hit the same subprocess write restriction. The parent orchestrator should rerun the uv commands outside this restricted child-process environment.
