from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pypinyin import Style, lazy_pinyin

from .models import AlignmentV1, cjk_chars

_SENTENCE_END_RE = re.compile(r"[。！？；?!;]")
_SPECIAL_TOKEN_RE = re.compile(r"<\|[^>]+\|>")
_CACHE_DIR = Path(os.environ.get("SHADOW_ALIGN_CACHE_DIR", Path.home() / ".cache" / "shadowing-pipeline"))
_DEFAULT_WHISPER_MODEL = "large-v3"

FIRERED_UNAVAILABLE = (
    "FireRedASR2S is not enabled on this Apple Silicon host: upstream requirements.txt "
    "pins torch==2.1.0+cu118 and torchaudio==2.1.0+cu118 from the CUDA 11.8 "
    "PyTorch index. The AED model can emit Chinese character timestamps in return_timestamp "
    "mode, but the published install path is CUDA/Linux-oriented. Use the local fallback "
    "engine 'whisper' here."
)


class EngineUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class WordTiming:
    text: str
    start_ms: int
    end_ms: int


@dataclass(frozen=True)
class SegmentTiming:
    text: str
    start_ms: int
    end_ms: int
    words: list[WordTiming]


@dataclass(frozen=True)
class Transcription:
    asr_id: str
    segments: list[SegmentTiming]
    runtime_s: float
    device: str
    model: str


def align_media(
    media_path: str | Path,
    output_path: str | Path,
    *,
    engine: str = "whisper",
    publish: bool = False,
) -> AlignmentV1:
    media = Path(media_path).expanduser().resolve()
    output = Path(output_path).expanduser().resolve()
    if not media.exists():
        raise FileNotFoundError(f"media file not found: {media}")

    duration_ms = probe_duration_ms(media)
    with tempfile.TemporaryDirectory(prefix="shadow-align-") as tmpdir:
        wav_path = Path(tmpdir) / f"{media.stem}.16k.wav"
        extract_wav(media, wav_path)
        transcription = transcribe(wav_path, engine=engine)

    alignment = build_alignment(media, duration_ms, transcription)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(alignment.model_dump(exclude_none=True), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    if publish:
        publish_alignment(media, output)

    return alignment


def build_alignment(media_path: Path, duration_ms: int, transcription: Transcription) -> AlignmentV1:
    sentence_blocks: list[dict[str, Any]] = []
    for segment in transcription.segments:
        sentence_blocks.extend(_sentences_from_segment(segment, len(sentence_blocks)))

    if not sentence_blocks:
        raise RuntimeError("ASR produced no Mandarin sentence text")

    data = {
        "version": 1,
        "media": {
            "file": str(media_path),
            "durationMs": duration_ms,
            "lang": "zh",
            "asr": transcription.asr_id,
        },
        "sentences": sentence_blocks,
    }
    return AlignmentV1.model_validate(data)


def transcribe(wav_path: Path, *, engine: str) -> Transcription:
    normalized = engine.strip().lower()
    if normalized in {"fireredasr2s", "firered", "fireredasr2"}:
        raise EngineUnavailable(FIRERED_UNAVAILABLE)
    if normalized not in {"auto", "whisper", "faster-whisper", "whisper-base", "whisper-large-v3"}:
        raise ValueError(f"unknown engine '{engine}'; supported: whisper, fireredasr2s")

    model_name = _whisper_model_name(normalized)
    return _transcribe_with_faster_whisper(wav_path, model_name=model_name)


def _whisper_model_name(engine: str) -> str:
    env_model = os.environ.get("SHADOW_ALIGN_WHISPER_MODEL", "").strip()
    if env_model:
        return env_model
    if engine == "whisper-large-v3":
        return "large-v3"
    if engine == "whisper-base":
        return "base"
    return _DEFAULT_WHISPER_MODEL


def _transcribe_with_faster_whisper(wav_path: Path, *, model_name: str) -> Transcription:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise EngineUnavailable("faster-whisper is not installed; run through `uv run shadow-align`") from exc

    local_model = Path(model_name).expanduser()
    model_ref = str(local_model) if local_model.exists() else model_name
    model_kwargs: dict[str, Any] = {}
    if not local_model.exists():
        model_cache = _CACHE_DIR / "faster-whisper"
        model_cache.mkdir(parents=True, exist_ok=True)
        model_kwargs["download_root"] = str(model_cache)

    device = os.environ.get("SHADOW_ALIGN_WHISPER_DEVICE", "auto")
    compute_type = os.environ.get("SHADOW_ALIGN_WHISPER_COMPUTE", "int8")
    started = time.perf_counter()
    model = WhisperModel(
        model_ref,
        device=device,
        compute_type=compute_type,
        **model_kwargs,
    )
    segments_iter, _info = model.transcribe(
        str(wav_path),
        language="zh",
        beam_size=1,
        vad_filter=True,
        word_timestamps=True,
    )

    segments: list[SegmentTiming] = []
    for raw_segment in segments_iter:
        text = _clean_asr_text(getattr(raw_segment, "text", ""))
        if not text or not cjk_chars(text):
            continue
        start_ms = _seconds_to_ms(getattr(raw_segment, "start", 0.0))
        end_ms = max(start_ms + 1, _seconds_to_ms(getattr(raw_segment, "end", 0.0)))
        words: list[WordTiming] = []
        for raw_word in getattr(raw_segment, "words", None) or []:
            word_text = _clean_asr_text(getattr(raw_word, "word", ""))
            if not cjk_chars(word_text):
                continue
            word_start = _seconds_to_ms(getattr(raw_word, "start", start_ms / 1000))
            word_end = _seconds_to_ms(getattr(raw_word, "end", end_ms / 1000))
            word_start = min(max(start_ms, word_start), end_ms)
            word_end = min(max(word_start + 1, word_end), end_ms)
            words.append(WordTiming(word_text, word_start, word_end))
        segments.append(SegmentTiming(text=text, start_ms=start_ms, end_ms=end_ms, words=words))

    runtime_s = time.perf_counter() - started
    return Transcription(
        asr_id=f"faster-whisper-{model_name}",
        segments=segments,
        runtime_s=runtime_s,
        device=device,
        model=model_name,
    )


def _sentences_from_segment(segment: SegmentTiming, first_idx: int) -> list[dict[str, Any]]:
    chunks = _split_segment_text(segment.text)
    flat_word_chars = _flatten_word_chars(segment.words)
    flat_index = 0
    sentence_blocks: list[dict[str, Any]] = []

    for chunk in chunks:
        chunk_chars = cjk_chars(chunk)
        if not chunk_chars:
            continue
        chunk_timings = flat_word_chars[flat_index : flat_index + len(chunk_chars)]
        flat_index += len(chunk_chars)
        if len(chunk_timings) != len(chunk_chars) or [item[0] for item in chunk_timings] != chunk_chars:
            chunk_timings = _uniform_char_timings(chunk_chars, segment.start_ms, segment.end_ms)

        char_blocks = []
        for ch, start_ms, end_ms in chunk_timings:
            char_blocks.append(
                {
                    "ch": ch,
                    "pinyin": _pinyin_for_char(ch),
                    "startMs": start_ms,
                    "endMs": end_ms,
                }
            )

        sentence_start = min(item["startMs"] for item in char_blocks)
        sentence_end = max(item["endMs"] for item in char_blocks)
        sentence_blocks.append(
            {
                "idx": first_idx + len(sentence_blocks),
                "text": chunk,
                "pinyin": _pinyin_for_text(chunk),
                "startMs": sentence_start,
                "endMs": sentence_end,
                "charTiming": "interpolated",
                "chars": char_blocks,
            }
        )

    return sentence_blocks


def _flatten_word_chars(words: list[WordTiming]) -> list[tuple[str, int, int]]:
    result: list[tuple[str, int, int]] = []
    previous_end = 0
    for word in words:
        chars = cjk_chars(word.text)
        if not chars:
            continue
        word_floor_end = max(word.end_ms, word.start_ms + len(chars))
        span = word_floor_end - word.start_ms
        for index, ch in enumerate(chars):
            start_ms = word.start_ms + round(index * span / len(chars))
            end_ms = word.start_ms + round((index + 1) * span / len(chars))
            start_ms = min(max(previous_end, start_ms), word_floor_end - 1)
            end_ms = min(max(start_ms + 1, end_ms), word_floor_end)
            result.append((ch, start_ms, end_ms))
            previous_end = end_ms
    return result


def _uniform_char_timings(chars: list[str], start_ms: int, end_ms: int) -> list[tuple[str, int, int]]:
    span = max(len(chars), end_ms - start_ms)
    result: list[tuple[str, int, int]] = []
    previous_end = start_ms
    for index, ch in enumerate(chars):
        char_start = start_ms + round(index * span / len(chars))
        char_end = start_ms + round((index + 1) * span / len(chars))
        char_start = max(previous_end, char_start)
        char_end = max(char_start + 1, char_end)
        result.append((ch, char_start, char_end))
        previous_end = char_end
    return result


def _split_segment_text(text: str) -> list[str]:
    chunks: list[str] = []
    start = 0
    for match in _SENTENCE_END_RE.finditer(text):
        end = match.end()
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = end
    tail = text[start:].strip()
    if tail:
        chunks.append(tail)
    return chunks


def _clean_asr_text(text: str) -> str:
    without_tokens = _SPECIAL_TOKEN_RE.sub("", text)
    return "".join(without_tokens.split())


def _pinyin_for_text(text: str) -> str:
    cjk_text = "".join(cjk_chars(text))
    if not cjk_text:
        return ""
    return " ".join(lazy_pinyin(cjk_text, style=Style.TONE, neutral_tone_with_five=False))


def _pinyin_for_char(ch: str) -> str:
    values = lazy_pinyin(ch, style=Style.TONE, neutral_tone_with_five=False)
    return values[0] if values else ch


def _seconds_to_ms(value: Any) -> int:
    try:
        return max(0, round(float(value) * 1000))
    except (TypeError, ValueError):
        return 0


def probe_duration_ms(media_path: Path) -> int:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise RuntimeError("ffprobe not found; install ffmpeg via brew before running shadow-align")
    result = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(media_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    duration = float(result.stdout.strip())
    if duration <= 0:
        raise RuntimeError(f"ffprobe returned non-positive duration for {media_path}")
    return round(duration * 1000)


def extract_wav(media_path: Path, wav_path: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found; install ffmpeg via brew before running shadow-align")
    subprocess.run(
        [
            ffmpeg,
            "-nostdin",
            "-y",
            "-i",
            str(media_path),
            "-ar",
            "16000",
            "-ac",
            "1",
            "-acodec",
            "pcm_s16le",
            "-f",
            "wav",
            str(wav_path),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        check=True,
    )


def publish_alignment(media_path: Path, output_path: Path) -> Path:
    slug = media_path.stem
    publish_dir = Path("data") / "primer" / "shadowing" / slug
    publish_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(media_path, publish_dir / media_path.name)
    shutil.copy2(output_path, publish_dir / "alignment.json")
    return publish_dir
