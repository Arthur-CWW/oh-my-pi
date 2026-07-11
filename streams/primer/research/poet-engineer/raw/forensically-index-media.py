#!/usr/bin/env python3
"""Generate reproducible, non-destructive forensic metadata and contact sheets."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "raw" / "media"
OUT = MEDIA / "forensics"

def command(args):
    return subprocess.run(args, check=True, text=True, capture_output=True)

def main():
    OUT.mkdir(exist_ok=True)
    videos = []
    for video in sorted(MEDIA.glob("*.mp4")):
        probe = json.loads(command(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video)]).stdout)
        duration = float(probe["format"].get("duration", 0))
        video_stream = next(stream for stream in probe["streams"] if stream["codec_type"] == "video")
        audio_streams = [stream for stream in probe["streams"] if stream["codec_type"] == "audio"]
        sheet = OUT / f"{video.stem}-contact.jpg"
        interval = max(duration / 5, 0.5)
        command(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-vf", f"fps=1/{interval},scale=320:-2,tile=5x1:padding=4:margin=4", "-frames:v", "1", str(sheet)])
        videos.append({
            "file": video.name,
            "bytes": video.stat().st_size,
            "durationSeconds": round(duration, 3),
            "dimensions": {"width": video_stream.get("width"), "height": video_stream.get("height")},
            "videoCodec": video_stream.get("codec_name"),
            "audioStreams": [{"codec": stream.get("codec_name"), "channels": stream.get("channels"), "sampleRate": stream.get("sample_rate")} for stream in audio_streams],
            "contactSheet": str(sheet.relative_to(MEDIA)),
            "transcript": "Not generated: no local speech-to-text capability was configured; audio presence alone does not establish speech.",
        })
    (MEDIA / "forensics.json").write_text(json.dumps({"method": "ffprobe stream inspection and ffmpeg evenly sampled five-frame contact sheets", "videos": videos}, indent=2) + "\n")
    print(f"Indexed {len(videos)} videos")

if __name__ == "__main__":
    main()
