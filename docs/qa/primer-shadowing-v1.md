# Primer — Shadowing tool v1 (2026-07-06)

Arthur: *"we want to make something like the shadowing tool in the vid too … the point is so I can replay specific phonemes and replay from points in the sentence."* No prior implementation existed — this is the first cut of the promoted audio lane (VISION.md §Sequencing 2).

## What shipped

- **Alignment pipeline** (`packages/shadowing-pipeline/`, self-contained uv project): `uv run shadow-align <media> -o out.json` → contract-valid alignment JSON (sentences → chars → ms spans; optional phones array reserved for MFA v1.5). `shadow-align validate <json>` enforces the schema (chars must cover every CJK char in order, monotonic spans).
  - **Engine reality check**: FireRedASR2S (Arthur's pick) is CUDA-pinned upstream (`torch==2.1.0+cu118`) — not runnable as-published on Apple Silicon. Shipped engine: **faster-whisper large-v3** with word timestamps → char interpolation, honestly flagged `charTiming: "interpolated"` per sentence. FireRed integration and MFA phoneme-level alignment (bablefish's `forced-alignment-chinese` machinery) are the documented v1.5 path — phoneme replay needs MFA regardless of ASR engine.
- **Shadowing surface** (`#/shadow` in the primer dashboard): drop/pick an alignment JSON + audio file → sentence cards with tone-colored pinyin over hanzi; display modes 拼+汉/汉字/拼音 (`p`); speed rack 0.5–1×; **click any char to seek-and-play from that point**; `Enter` play sentence, `r` A–B loop, `h`/`l` jump sentence back/forward, `j`/`k` focus, `Space` play/pause; live char highlight during playback via timeupdate.

## Evidence

- Pipeline verified in a normal shell on real HSK deck audio: `hsk1_00001_sentence.mp3` → `我今天想去超市买东西` (asr=faster-whisper-large-v3), `validate` → OK. Committed examples: `packages/shadowing-pipeline/examples/hsk1_0000{1,2,3}_sentence.json`.
- Surface QA in live browser with the real `hsk1_00003` pair loaded: [dropzone](primer-shadowing-v1/qa-shadow-dropzone.png) · [loaded player](primer-shadowing-v1/qa-shadow-loaded.png) (2 sentences, 這件事我不了/不了, speed 0.8×, pinyin+hanzi mode, interpolated-timing tags visible).
- 32 alignment-helper unit tests + 33 segmentation tests in `packages/primer-daemon/test/`, all passing in the package gate (106 total).

## Rerun

```bash
cd packages/shadowing-pipeline
uv run shadow-align /Users/arthur/apps/hsk-deck/audio/sentences/hsk1_00001_sentence.mp3 -o /tmp/a.json
uv run shadow-align validate /tmp/a.json
# then open http://primer.localhost:1355/#/shadow and drop /tmp/a.json + the mp3
```

## v1.5 queue

MFA phoneme spans (`phones[]` — replay a single phoneme), FireRedASR2S via patched deps or ONNX, `--publish` asset library + server routes (drop the manual file-pair loading), cdrama/micro-drama ingestion (video → ffmpeg audio extract already supported), Cantonese lane (CC-CEDICT.Canto.zip is vendored).
