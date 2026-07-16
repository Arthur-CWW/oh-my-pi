#!/usr/bin/env python3
import argparse
import json
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from kokoro import KModel, KPipeline


def render(pipeline, text: str, voice: str, output: Path, speed: float) -> dict:
    torch.cuda.reset_peak_memory_stats()
    torch.cuda.synchronize()
    started = time.perf_counter()
    chunks = []
    for _graphemes, _phonemes, audio in pipeline(text, voice=voice, speed=speed):
        if isinstance(audio, torch.Tensor):
            audio = audio.detach().cpu().numpy()
        chunks.append(np.asarray(audio, dtype=np.float32))
    torch.cuda.synchronize()
    elapsed = time.perf_counter() - started
    waveform = np.concatenate(chunks)
    sf.write(output, waveform, 24000, subtype="PCM_16")
    duration = len(waveform) / 24000
    return {
        "file": output.name,
        "voice": voice,
        "speed": speed,
        "duration_seconds": duration,
        "generation_seconds": elapsed,
        "realtime_factor": elapsed / duration,
        "times_realtime": duration / elapsed,
        "peak_vram_mib": torch.cuda.max_memory_allocated() / 1024 / 1024,
        "bytes": output.stat().st_size,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scripts", type=Path, default=Path("scripts.json"))
    parser.add_argument("--output", type=Path, default=Path("output"))
    parser.add_argument("--voice", default="am_michael")
    parser.add_argument("--comparison-voice", default="am_fenrir")
    parser.add_argument("--speed", type=float, default=0.9)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    scripts = json.loads(args.scripts.read_text())

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device != "cuda":
        raise RuntimeError("CUDA is required for this benchmark")
    model = KModel().to(device).eval()
    pipeline = KPipeline(lang_code="a", model=model)

    results = []
    for slug, text in scripts.items():
        results.append(render(pipeline, text, args.voice, args.output / f"{slug}-{args.voice}.wav", args.speed))
    comparison_slug = "the-number-with-no-name"
    results.append(render(
        pipeline,
        scripts[comparison_slug],
        args.comparison_voice,
        args.output / f"{comparison_slug}-{args.comparison_voice}.wav",
        args.speed,
    ))
    metadata = {
        "device": torch.cuda.get_device_name(0),
        "torch_version": torch.__version__,
        "cuda_version": torch.version.cuda,
        "sample_rate": 24000,
        "results": results,
    }
    (args.output / "generation-metrics.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
