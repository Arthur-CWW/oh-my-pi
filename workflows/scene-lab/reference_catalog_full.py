#!/usr/bin/env python3
"""Incrementally catalog the visual reference corpus through Antigravity."""
from __future__ import annotations

import json
import os
import random
import re
import subprocess
import tempfile
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORT_DIR = ROOT / "workflows/scene-lab/reports/2026-07-15-reference-catalog-full"
PROGRESS_PATH = REPORT_DIR / "progress.json"
REPORT_PATH = REPORT_DIR / "report.md"
CATALOG_PATH = ROOT / "docs/research/pleometric-reference-catalog.md"
PROMPT_PATH = ROOT / "docs/prompts/pleometric-reference-catalog-prompt.md"
HANDLES = [h for h in os.environ.get(
    "CATALOG_HANDLES", "pleometric,SkyeSharkie,poetengineer__,abelian_soup,voooooogel"
).split(",") if h]
MAX_ITEMS = int(os.environ.get("CATALOG_MAX_ITEMS", "0"))
JITTER_MIN = float(os.environ.get("CATALOG_JITTER_MIN", "1.0"))
JITTER_MAX = float(os.environ.get("CATALOG_JITTER_MAX", "3.0"))


def load_json(path: Path, fallback):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return fallback


def save_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(path)


def video_id(item: dict) -> str:
    return Path(str(item["file"])).stem


def tweet_id(item: dict) -> str:
    return str(item["tweetId"])


def catalog_ids() -> set[str]:
    text = CATALOG_PATH.read_text()
    return set(re.findall(r"\| \*\*([0-9]+-\d+)\*\* \|", text))


def existing_tweet_ids() -> set[str]:
    return {x.split("-", 1)[0] for x in catalog_ids()}


def date_label(raw: str) -> str:
    return str(raw).split(" · ", 1)[0]


def clean_cell(value: object) -> str:
    return str(value).replace("|", "/").replace("\r", " ").replace("\n", " ").strip()


def result_cell(result: dict) -> tuple[str, str, str, str]:
    refs = result.get("references") or []
    ref_text = []
    for ref in refs:
        if not isinstance(ref, dict):
            continue
        name = clean_cell(ref.get("name", "unknown"))
        kind = clean_cell(ref.get("kind", "meme"))
        try:
            confidence = f"{float(ref.get('confidence', 0.0)):.2f}".rstrip("0").rstrip(".")
        except (TypeError, ValueError):
            confidence = "0"
        ref_text.append(f"{name} ({kind}, {confidence})")
    techniques = ", ".join(clean_cell(x) for x in (result.get("techniques") or []))
    tags = ", ".join(clean_cell(x) for x in (result.get("style_tags") or []))
    one_line = clean_cell(result.get("one_line", ""))
    return one_line, "; ".join(ref_text), techniques, tags


def append_catalog(item: dict, result: dict) -> None:
    one_line, refs, techniques, tags = result_cell(result)
    row = "| **%s** | %s | %s | %s | %s | %s |\n" % (
        clean_cell(video_id(item)),
        clean_cell(date_label(item.get("date", ""))),
        one_line,
        refs,
        clean_cell(techniques),
        clean_cell(tags),
    )
    with CATALOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(row)


def parse_json_output(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", text):
        try:
            value, _ = decoder.raw_decode(text[match.start():])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and "one_line" in value:
            return value
    raise ValueError("No catalog JSON object found in provider output")


def transcript_excerpt(handle: str, item: dict) -> str:
    path = ROOT / "data/inspiration" / handle / "transcripts.json"
    if not path.exists():
        return ""
    data = load_json(path, {})
    key = video_id(item)
    value = data.get(key, {}) if isinstance(data, dict) else {}
    if isinstance(value, dict):
        return str(value.get("text", ""))[:1200]
    return str(value)[:1200]


def make_frames(media: Path, duration: float, frame_dir: Path) -> list[Path]:
    frame_dir.mkdir(parents=True, exist_ok=True)
    duration = max(0.1, duration)
    times = [0.0, duration / 3.0, duration * 2.0 / 3.0, max(0.0, duration - 0.05)]
    frames: list[Path] = []
    for index, seconds in enumerate(times, start=1):
        out = frame_dir / f"frame{index}.jpg"
        command = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-ss", f"{seconds:.3f}", "-i", str(media), "-frames:v", "1",
            "-vf", "scale='min(640,iw)':-2", str(out),
        ]
        proc = subprocess.run(command, text=True, capture_output=True)
        if proc.returncode == 0 and out.exists():
            frames.append(out)
        elif len(frames) < 3 and index < 4:
            raise RuntimeError(f"ffmpeg failed at frame {index}: {proc.stderr[-500:]}")
    if len(frames) < 3:
        raise RuntimeError("ffmpeg produced fewer than three usable frames")
    return frames


def call_provider(frames: list[Path], prompt: str) -> tuple[str, int]:
    command = [
        "omp", "-p", "--model", "google-antigravity/gemini-3.5-flash",
        "--no-tools", "--no-session",
        *(f"@{frame}" for frame in frames),
        prompt,
    ]
    try:
        proc = subprocess.run(command, text=True, capture_output=True, timeout=180)
    except subprocess.TimeoutExpired:
        return "omp timed out after 180 seconds", -124
    raw = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
    return raw, proc.returncode


def is_rate_limit(raw: str, code: int) -> bool:
    lower = raw.lower()
    return code in (429, 408) or any(token in lower for token in (
        "rate limit", "rate_limit", "quota", "resource exhausted", "too many requests", "429",
    ))


def refresh_report(progress: dict, total: int, unique_total: int, skipped_dedup: int) -> None:
    completed = progress.get("completed_ids", [])
    counts = progress.get("handles", {})
    failures = progress.get("failed", [])
    skips = progress.get("skipped", [])
    status = "done" if len(completed) + len(failures) + len(skips) >= unique_total else "partial"
    if progress.get("stopped_on_rate_limit"):
        status = "partial"
    lines = [
        "---",
        'title: "Full Corpus Visual Reference Catalog Report"',
        "date: 2026-07-15",
        'agent: "RefCatalog"',
        f"status: {status}",
        "---",
        "",
        "# Full Corpus Visual Reference Catalog",
        "",
        "## Progress",
        "",
        f"- Manifest items discovered: {total}.",
        f"- Unique tweet IDs after media-variant dedupe: {unique_total}.",
        f"- Prior catalog entries skipped: {len(progress.get('prior_catalog_ids', []))}.",
        f"- Items covered in this run: {len(completed)}.",
        f"- Failed: {len(failures)}; skipped: {len(skips)}.",
        "- Cost: $0.00 expected/observed; Antigravity subscription lane only.",
        "",
        "### Per-handle counts",
        "",
        "| Handle | Discovered | Completed | Failed | Skipped |",
        "|---|---:|---:|---:|---:|",
    ]
    for handle in sorted(counts):
        c = counts.get(handle, {})
        lines.append(f"| {handle} | {c.get('discovered', 0)} | {c.get('completed', 0)} | {c.get('failed', 0)} | {c.get('skipped', 0)} |")
    lines += [
        "",
        "## Failures / skips",
        "",
    ]
    if not failures and not skips:
        lines.append("None recorded.")
    else:
        for entry in failures:
            lines.append(f"- FAILED `{entry.get('id')}` ({entry.get('handle')}): {entry.get('reason')}")
        for entry in skips:
            lines.append(f"- SKIPPED `{entry.get('id')}` ({entry.get('handle')}): {entry.get('reason')}")
    if progress.get("rate_limit_events"):
        lines += ["", "### Rate-limit events", ""]
        for event in progress["rate_limit_events"]:
            lines.append(f"- {event}")
    lines += [
        "",
        "## Exact resume command",
        "",
        "```bash",
        "python3 workflows/scene-lab/reference_catalog_full.py",
        "```",
        "",
        "## Artifacts",
        "",
        "- `progress.json` tracks completed tweet/video IDs and failures.",
        "- `results/` contains the raw and parsed per-video provider envelopes.",
        "- Catalog rows are appended immediately after each successful pass.",
        "",
    ]
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")


def choose_items() -> tuple[list[tuple[str, dict]], int, int, int]:
    all_items: list[tuple[str, dict]] = []
    for handle in HANDLES:
        manifest = ROOT / "data/inspiration" / handle / "manifest.json"
        data = load_json(manifest, {})
        for item in data.get("items", []):
            all_items.append((handle, item))
    total = len(all_items)
    by_tweet: dict[str, list[tuple[str, dict]]] = {}
    for pair in all_items:
        by_tweet.setdefault(tweet_id(pair[1]), []).append(pair)
    selected: list[tuple[str, dict]] = []
    for tid, variants in by_tweet.items():
        variants.sort(key=lambda pair: (0 if Path(pair[1]["file"]).name == f"{tid}-1.mp4" else 1, video_id(pair[1])))
        selected.append(variants[0])
    selected.sort(key=lambda pair: (HANDLES.index(pair[0]), video_id(pair[1])))
    return selected, total, len(selected), total - len(selected)


def main() -> int:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    progress = load_json(PROGRESS_PATH, {})
    if not progress.get("prior_catalog_ids"):
        progress["prior_catalog_ids"] = sorted(catalog_ids() - set(progress.get("completed_ids", [])))
    progress.setdefault("completed_ids", [])
    progress.setdefault("failed", [])
    progress.setdefault("skipped", [])
    progress.setdefault("handles", {})
    progress.setdefault("rate_limit_events", [])
    selected, total, unique_total, skipped_dedup = choose_items()
    for handle in HANDLES:
        progress["handles"].setdefault(handle, {"discovered": 0, "completed": 0, "failed": 0, "skipped": 0})
        progress["handles"][handle]["discovered"] = 0
    for handle, item in selected:
        progress["handles"][handle]["discovered"] += 1
    refresh_report(progress, total, unique_total, skipped_dedup)
    prompt_base = PROMPT_PATH.read_text(encoding="utf-8")
    completed = set(progress["completed_ids"])
    prior_tweets = {x.split("-", 1)[0] for x in progress["prior_catalog_ids"]}
    failed_ids = set()
    skipped_ids = {x.get("id") for x in progress["skipped"]}
    processed_this_run = 0
    for handle, item in selected:
        vid = video_id(item)
        tid = tweet_id(item)
        if tid in prior_tweets:
            if vid not in skipped_ids:
                progress["skipped"].append({"id": vid, "handle": handle, "reason": "already present in prior catalog (tweet ID dedupe)"})
                progress["handles"][handle]["skipped"] += 1
            skipped_ids.add(vid)
            continue
        if vid in completed or vid in skipped_ids:
            continue
        if MAX_ITEMS and processed_this_run >= MAX_ITEMS:
            break
        media = ROOT / "data/inspiration" / handle / str(item["file"])
        if not media.exists():
            progress["failed"].append({"id": vid, "handle": handle, "reason": f"missing media file: {media}"})
            progress["handles"][handle]["failed"] += 1
            failed_ids.add(vid)
            save_json(PROGRESS_PATH, progress)
            refresh_report(progress, total, unique_total, skipped_dedup)
            continue
        tweet_text = str(item.get("text", ""))[:3000]
        transcript = transcript_excerpt(handle, item)
        prompt = prompt_base + "\n\nTweet text from manifest:\n" + tweet_text
        if transcript:
            prompt += "\n\nTranscript excerpt (when available):\n" + transcript
        try:
            with tempfile.TemporaryDirectory(prefix=f"reference-catalog-{vid}-") as tmp:
                frames = make_frames(media, float(item.get("durationSeconds") or 1.0), Path(tmp))
                raw, code = call_provider(frames, prompt)
                attempts = 1
                if is_rate_limit(raw, code):
                    event = f"first rate-limit/quota response at {vid}; backing off 60 seconds and retrying once"
                    progress["rate_limit_events"].append(event)
                    save_json(PROGRESS_PATH, progress)
                    refresh_report(progress, total, unique_total, skipped_dedup)
                    time.sleep(60)
                    raw, code = call_provider(frames, prompt)
                    attempts = 2
                    if is_rate_limit(raw, code):
                        progress["rate_limit_events"].append(f"second rate-limit/quota response at {vid}; stopped cleanly")
                        progress["stopped_on_rate_limit"] = True
                        progress["last_processed_id"] = vid
                        save_json(PROGRESS_PATH, progress)
                        refresh_report(progress, total, unique_total, skipped_dedup)
                        return 0
                if code != 0:
                    raise RuntimeError(f"omp exited {code}: {raw[-240:].replace(chr(10), ' ')}")
                result = parse_json_output(raw)
                append_catalog(item, result)
                result_path = REPORT_DIR / "results" / f"{vid}.json"
                result_path.parent.mkdir(parents=True, exist_ok=True)
                save_json(result_path, {
                    "id": vid,
                    "handle": handle,
                    "status": "ok",
                    "date": date_label(item.get("date", "")),
                    "tweet_text": tweet_text,
                    "transcript_excerpt": transcript,
                    "raw_output": raw,
                    "result": result,
                    "attempts": attempts,
                })
            progress["failed"] = [entry for entry in progress.get("failed", []) if entry.get("id") != vid]
            progress["completed_ids"].append(vid)
            progress["handles"][handle]["completed"] += 1
            progress["handles"][handle]["failed"] = sum(1 for entry in progress.get("failed", []) if entry.get("handle") == handle)
            progress["last_processed_id"] = vid
            processed_this_run += 1
            save_json(PROGRESS_PATH, progress)
            refresh_report(progress, total, unique_total, skipped_dedup)
            time.sleep(random.uniform(JITTER_MIN, JITTER_MAX))
        except Exception as exc:
            progress["failed"] = [entry for entry in progress.get("failed", []) if entry.get("id") != vid]
            progress["failed"].append({"id": vid, "handle": handle, "reason": str(exc)})
            progress["handles"][handle]["failed"] = sum(1 for entry in progress.get("failed", []) if entry.get("handle") == handle)
            progress["last_processed_id"] = vid
            save_json(PROGRESS_PATH, progress)
            refresh_report(progress, total, unique_total, skipped_dedup)
    progress["stopped_on_rate_limit"] = False
    save_json(PROGRESS_PATH, progress)
    refresh_report(progress, total, unique_total, skipped_dedup)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
