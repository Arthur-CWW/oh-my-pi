# shadowing-pipeline

Local Mandarin media-to-character alignment for the primer shadowing tool.

## Install/run

```bash
cd packages/shadowing-pipeline
uv run shadow-align /Users/arthur/apps/hsk-deck/audio/sentences/hsk1_00001_sentence.mp3 -o out.json
uv run shadow-align validate out.json
```

CLI:

```bash
uv run shadow-align <media.(wav|mp3|mp4|m4a)> -o <out.json> [--engine whisper] [--publish]
uv run shadow-align validate <alignment.json>
uv run shadow-align batch <dir> [--limit N] [--publish-root <dir>] [--engine whisper]
```

`--publish` copies the source media and `alignment.json` to `data/primer/shadowing/<media-stem>/`. `batch` aligns each `.mp3`/`.wav` in the input directory, writes `<publish-root>/<media-stem>/alignment.json`, copies the source media beside it, skips already-published stems, logs per-file errors, and finishes with `batch summary: aligned=<n> skipped=<n> failed=<n>`.

## Output contract

The JSON validates against `local://shadowing-contract.md` v1:

- `media.file`, `durationMs`, `lang: "zh"`, and actual `media.asr` engine id.
- ASR segment boundaries are primary sentence boundaries, then text is split on `。！？；?!;`.
- `sentences[].chars` covers every CJK character in `text` in order; punctuation is kept in `text` when ASR emits it but is not included in `chars`.
- `pinyin` is tone-marked via `pypinyin`.
- `phones` are intentionally omitted in v1. MFA phoneme alignment is v1.5.

## Engine notes

### FireRedASR2S research

FireRedASR2S offers two ASR variants:

- `FireRedASR2-AED`: Mandarin/dialect/English/code-switching ASR. Its Python API supports `return_timestamp=True`; upstream examples show Chinese output timestamps at character granularity and English at word granularity.
- `FireRedASR2-LLM`: higher-capability LLM ASR, but upstream examples do not expose timestamps.

Weights are published on HuggingFace under the `FireRedTeam/FireRedASR2S` collection, including `FireRedTeam/FireRedASR2-AED`, `FireRedTeam/FireRedASR2-LLM`, `FireRedTeam/FireRedVAD`, `FireRedTeam/FireRedLID`, and `FireRedTeam/FireRedPunc`.

FireRed was not used as the runnable engine in this package because upstream `requirements.txt` pins CUDA wheels:

```text
--extra-index-url https://download.pytorch.org/whl/cu118
torch==2.1.0+cu118
torchaudio==2.1.0+cu118
```

That install path is CUDA/Linux-oriented and is not feasible on this Apple Silicon M4 Max host without replacing upstream's pinned runtime. The repository README also notes FireRedASR2S has only been tested on Ubuntu 22.04. This package therefore follows the fallback policy.

### Implemented fallback

Default engine: `faster-whisper` with Whisper `large-v3`, word timestamps, and Mandarin language forcing.

- Default model: `large-v3`.
- Override for smoke tests: `SHADOW_ALIGN_WHISPER_MODEL=base` or another faster-whisper model/path.
- Device default: `auto`; override with `SHADOW_ALIGN_WHISPER_DEVICE=cpu` or another CTranslate2-supported device.
- Compute default: `int8`; override with `SHADOW_ALIGN_WHISPER_COMPUTE`.
- Model cache: `~/.cache/shadowing-pipeline/faster-whisper/` by default; override with `SHADOW_ALIGN_CACHE_DIR`.

Timing granularity actually obtained from faster-whisper is word-level. Mandarin character spans are interpolated within each word span and every produced sentence is marked:

```json
"charTiming": "interpolated"
```

## Examples

`examples/` contains three real HSK sentence outputs generated from local files under:

```text
/Users/arthur/apps/hsk-deck/audio/sentences/
```

The source MP3s are referenced rather than copied into this package.

Observed smoke-test ASR text with the locally cached `faster-whisper-base` model:

- `hsk1_00001_sentence.mp3`: `我今天想去超市买东西` — runtime 0.473s
- `hsk1_00002_sentence.mp3`: `他今天買了七本書` — runtime 0.400s
- `hsk1_00003_sentence.mp3`: `這件事我不了` / `不了` — runtime 0.416s

Large-v3 remains the package default for production-quality Mandarin accuracy; the base-model examples are committed only as small proof artifacts from the model already present on this host.
