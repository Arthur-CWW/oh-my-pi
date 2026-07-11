#!/usr/bin/env python3
"""Bounded unauthenticated recovery from known canonical X status URLs."""
import hashlib
import json
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "raw" / "media"
STATUS_IDS = [
 "1821654144958202077", "1873264289626374353", "2066924260317147488", "2066924263190184355", "2066924266000384244", "2067341526229733876", "2067413840359251985", "2067415820112667045", "2067420147602620830", "2067422633059029414", "2067427745538167237", "2067513358660616634", "2068419118655529130", "2068790638699528490", "2068790640041726347", "2068790642852122808", "2068790698610983051", "2068817177902244345", "2070184648265597188", "2070249914127323286", "2071356280355148161", "2072826940407316628", "2073103304612012202", "2073104284212687138", "2073107415277441487", "2074189012378464436", "2074189077214052396", "2074432243829780985", "2074594976218993114", "2074886581953990888", "2075264760136749101", "2075584325043503144",
]

def media_files(before):
    return [
        path
        for path in MEDIA.iterdir()
        if path.is_file() and path not in before and path.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov", ".jpg", ".jpeg", ".png", ".webp", ".gif"}
    ]
def main():
    MEDIA.mkdir(parents=True, exist_ok=True)
    result = {"retrievedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "method": "yt-dlp against each canonical public X status URL; no browser-cookie extraction, cookies, auth headers, or account interaction", "statuses": [], "files": []}
    for index, status_id in enumerate(STATUS_IDS):
        canonical_url = f"https://x.com/poetengineer__/status/{status_id}"
        before = set(MEDIA.iterdir())
        completed = subprocess.run([
            "yt-dlp", "--no-update", "--no-playlist", "--write-info-json",
            "--output", "%(id)s.%(ext)s", canonical_url,
        ], cwd=MEDIA, text=True, capture_output=True, timeout=180)
        files = media_files(before)
        row = {"statusId": status_id, "canonicalUrl": canonical_url, "method": "yt-dlp canonical status", "exitCode": completed.returncode, "files": []}
        for path in files:
            payload = path.read_bytes()
            item = {"file": path.name, "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
            row["files"].append(item)
            result["files"].append({"statusId": status_id, **item})
        if completed.returncode:
            row["failure"] = completed.stderr.strip() or completed.stdout.strip()
        elif not files:
            row["gap"] = "No downloadable media exposed by the public canonical status."
        result["statuses"].append(row)
        if index + 1 < len(STATUS_IDS):
            time.sleep(1)
    (MEDIA / "public-recovery.json").write_text(json.dumps(result, indent=2) + "\n")

if __name__ == "__main__":
    main()
