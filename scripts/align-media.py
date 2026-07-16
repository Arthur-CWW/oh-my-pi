#!/usr/bin/env python3
"""Build Primer v1 video alignments from timed Chinese subtitles.

Run from hsk-deck so qwen-asr and pypinyin resolve:
  cd ~/apps/hsk-deck && uv run --with pypinyin python ~/agents/scripts/align-media.py \
    --audio .../episode-16k-mono.wav --media .../episode.mp4 \
    --srt .../episode.ai-zh.srt --out .../alignment.json
"""
from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from pypinyin import Style, pinyin

CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002a6df\U0002f800-\U0002fa1f]")
SRT_TIME_RE = re.compile(
    r"(?P<start>\d{2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(?P<end>\d{2}:\d{2}:\d{2}[,.]\d{3})"
)
PUNCTUATION = "，。！？；：、,.!?;:()（）【】“”‘’「」《》…—-"


def time_seconds(value: str) -> float:
    hh, mm, rest = value.replace(",", ".").split(":")
    ss = float(rest)
    return int(hh) * 3600 + int(mm) * 60 + ss


def parse_srt(path: Path, *, max_end_sec: float) -> list[dict[str, Any]]:
    raw = path.read_text(encoding="utf-8-sig")
    blocks = re.split(r"\n\s*\n", raw.strip())
    rows: list[dict[str, Any]] = []
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if len(lines) < 3:
            continue
        match = next((found for line in lines[:3] if (found := SRT_TIME_RE.search(line))), None)
        if match is None:
            continue
        start = time_seconds(match.group("start"))
        end = time_seconds(match.group("end"))
        if start >= max_end_sec:
            continue
        text = clean_text("".join(lines[lines.index(match.group(0)) + 1 :]))
        if not text:
            continue
        rows.append({"start": max(0.0, start), "end": min(max_end_sec, max(start, end)), "text": text})
    return rows


def clean_text(text: str) -> str:
    text = html.unescape(text)
    text = re.sub(r"<[^>]*>", "", text)
    text = text.replace("\u200b", "").replace("\ufeff", "")
    text = text.replace("佩琪", "佩奇")
    text = re.sub(r"\s+", "", text)
    # The AI subtitle has occasional English laughter/filler. Keep Chinese speech,
    # remove only ASCII artifacts that cannot be aligned as Mandarin characters.
    text = re.sub(r"[A-Za-z]+", "", text)
    text = re.sub(r"[。！？!?]+", "。", text)
    text = re.sub(r"，+", "，", text)
    if not text:
        return ""
    if text[-1] not in PUNCTUATION:
        if text.endswith(("吗", "呢", "什么", "怎么", "好不好", "对不对", "是不是", "哪")):
            text += "？"
        else:
            text += "。"
    return text


def hanzi(text: str) -> list[str]:
    return CJK_RE.findall(text)


def pinyin_for_hanzi(text: str) -> list[str]:
    chars = hanzi(text)
    if not chars:
        return []
    values = pinyin("".join(chars), style=Style.TONE, heteronym=False, strict=False)
    return [tokens[0] if tokens else "" for tokens in values]


def sentence_pinyin(text: str) -> str:
    return " ".join(pinyin_for_hanzi(text))


def media_duration(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def make_slice(source: Path, start: float, end: float, target: Path) -> None:
    # A little context lets the forced aligner hear onset/consonants at cue edges.
    pad = 0.12
    slice_start = max(0.0, start - pad)
    slice_end = end + pad
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-ss", f"{slice_start:.3f}", "-to", f"{slice_end:.3f}", "-i", str(source), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(target)],
        check=True,
    )


def flattened_items(result: Any) -> list[tuple[str, float, float]]:
    flattened: list[tuple[str, float, float]] = []
    for item in getattr(result, "items", []):
        token = str(getattr(item, "text", ""))
        chars = hanzi(token)
        if not chars:
            continue
        start = float(getattr(item, "start_time", 0.0))
        end = max(start, float(getattr(item, "end_time", start)))
        duration = (end - start) / len(chars)
        for index, char in enumerate(chars):
            flattened.append((char, start + index * duration, start + (index + 1) * duration))
    return flattened


def interpolate(start: float, end: float, count: int) -> list[tuple[float, float]]:
    if count <= 0:
        return []
    duration = max(0.001, end - start)
    step = duration / count
    return [(start + index * step, start + (index + 1) * step) for index in range(count)]


def aligned_chars(
    expected: list[str], result: Any, *, absolute_start: float, sentence_start: float, sentence_end: float, sentence_idx: int
) -> tuple[list[tuple[str, float, float]], str]:
    observed = flattened_items(result)
    observed_chars = [char for char, _start, _end in observed]
    if observed_chars != expected:
        print(
            f"alignment mismatch sentence={sentence_idx}: expected={''.join(expected)!r} observed={''.join(observed_chars)!r}; interpolating",
            file=sys.stderr,
        )
        return [(char, start, end) for char, (start, end) in zip(expected, interpolate(sentence_start, sentence_end, len(expected)))], "interpolated"
    absolute: list[tuple[str, float, float]] = []
    for char, start, end in observed:
        absolute.append((char, absolute_start + start, absolute_start + end))
    # Qwen can place a token into the 120 ms context padding. Such a span is
    # identity-safe but not contract-safe for this sentence; interpolate the
    # whole sentence rather than clipping one token and breaking monotonicity.
    if any(start < sentence_start or end > sentence_end for _char, start, end in absolute):
        print(f"out-of-bounds timing sentence={sentence_idx}; interpolating", file=sys.stderr)
        return [
            (char, start, end)
            for char, (start, end) in zip(expected, interpolate(sentence_start, sentence_end, len(expected)))
        ], "interpolated"
    return absolute, "qwen"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--media", type=Path, required=True)
    parser.add_argument("--srt", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--max-end-sec", type=float, default=620.0)
    parser.add_argument("--batch-size", type=int, default=8)
    args = parser.parse_args()

    duration = media_duration(args.media)
    rows = parse_srt(args.srt, max_end_sec=min(duration, args.max_end_sec))
    if not rows:
        raise SystemExit("No timed Chinese subtitles found")

    # Keep cues ordered and non-overlapping at the sentence boundary. The source
    # is an AI subtitle, so cue timings are intentionally retained as rough spans.
    previous_start = 0.0
    for row in rows:
        row["start"] = max(float(row["start"]), previous_start)
        row["end"] = max(float(row["end"]), row["start"] + 0.001)
        previous_start = row["start"]

    from qwen_asr import Qwen3ForcedAligner

    print(f"Loading Qwen3-ForcedAligner-0.6B for {len(rows)} subtitle cues...", flush=True)
    model = Qwen3ForcedAligner.from_pretrained("Qwen/Qwen3-ForcedAligner-0.6B", device_map=None)

    sentences: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="primer-tutu-align-") as temp_name:
        temp_dir = Path(temp_name)
        slices: list[tuple[dict[str, Any], Path, float]] = []
        for idx, row in enumerate(rows):
            slice_start = max(0.0, float(row["start"]) - 0.12)
            target = temp_dir / f"{idx:04d}.wav"
            make_slice(args.audio, float(row["start"]), float(row["end"]), target)
            slices.append((row, target, slice_start))

        for batch_start in range(0, len(slices), args.batch_size):
            batch = slices[batch_start : batch_start + args.batch_size]
            try:
                results = model.align(
                    audio=[str(target) for _row, target, _offset in batch],
                    text=[str(row["text"]) for row, _target, _offset in batch],
                    language=["Chinese"] * len(batch),
                )
            except Exception as exc:
                print(f"Qwen batch {batch_start} failed ({exc}); interpolating batch", file=sys.stderr)
                results = [None] * len(batch)

            for offset, ((row, _target, slice_start), result) in enumerate(zip(batch, results)):
                idx = batch_start + offset
                text = str(row["text"])
                expected = hanzi(text)
                sentence_start_ms = int(round(float(row["start"]) * 1000))
                sentence_end_ms = int(round(float(row["end"]) * 1000))
                if result is None:
                    timings = interpolate(sentence_start_ms / 1000.0, sentence_end_ms / 1000.0, len(expected))
                    aligned = [(char, start, end) for char, (start, end) in zip(expected, timings)]
                    timing_kind = "interpolated"
                else:
                    aligned, timing_kind = aligned_chars(
                        expected,
                        result,
                        absolute_start=slice_start,
                        sentence_start=sentence_start_ms / 1000.0,
                        sentence_end=sentence_end_ms / 1000.0,
                        sentence_idx=idx,
                    )
                chars: list[dict[str, Any]] = []
                last_start = sentence_start_ms
                for char, start, end in aligned:
                    start_ms = max(sentence_start_ms, min(sentence_end_ms, int(round(start * 1000))))
                    end_ms = max(start_ms + 1, min(sentence_end_ms, int(round(end * 1000))))
                    start_ms = max(last_start, start_ms)
                    end_ms = max(start_ms + 1, end_ms)
                    chars.append({"ch": char, "pinyin": pinyin_for_hanzi(char)[0], "startMs": start_ms, "endMs": end_ms})
                    last_start = start_ms
                sentence: dict[str, Any] = {
                    "idx": idx,
                    "text": text,
                    "pinyin": sentence_pinyin(text),
                    "startMs": sentence_start_ms,
                    "endMs": sentence_end_ms,
                    "chars": chars,
                }
                sentence["charTiming"] = "interpolated" if timing_kind == "interpolated" else "native"
                sentences.append(sentence)
            print(f"aligned {min(batch_start + args.batch_size, len(slices))}/{len(slices)}", flush=True)

    output = {
        "version": 1,
        "media": {
            "file": args.media.name,
            "durationMs": int(round(duration * 1000)),
            "lang": "zh",
            "asr": "bilibili-ai-zh-subtitles",
            "kind": "video",
        },
        "sentences": sentences,
    }
    args.out.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.out} ({len(sentences)} sentences, {sum(len(item['chars']) for item in sentences)} Han chars)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
