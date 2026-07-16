#!/usr/bin/env python3
import json
import threading
import time
from pathlib import Path

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
SCRIPT = (
    "Honestly, labs is such bullshit. What lab? Why are we calling it a lab? "
    "It is a trillion-dollar corporation with five thousand people building a superweapon in secrecy, "
    "dropping hints from time to time. DeepSeek is a lab. This is a ticking time bomb. "
    "Imagine if Los Alamos were a private actor, guarding its cute know-hows, never publishing anything. "
    "But that is exactly what they say it is. And I don't see how a nation-state lets that be anything "
    "more than a facade, in the long run."
)
# Both references are the same script. Their 29-second slices omit only the tail,
# so this aligned prompt transcript intentionally stops before the final clause.
REF_TEXT = (
    "Honestly, labs is such bullshit. What lab? Why are we calling it a lab? "
    "It is a trillion-dollar corporation with five thousand people building a superweapon in secrecy, "
    "dropping hints from time to time. DeepSeek is a lab. This is a ticking time bomb. "
    "Imagine if Los Alamos were a private actor, guarding its cute know-hows, never publishing anything. "
    "But that is exactly what they say it is."
)


def used_vram_mib() -> float:
    free, total = torch.cuda.mem_get_info()
    return (total - free) / 1024 / 1024


def main() -> None:
    root = Path.home() / "tts-lab" / "fish"
    output = root / "output"
    output.mkdir(parents=True, exist_ok=True)
    refs = {
        "jimeng": root / "input" / "jimeng-what-lab-ref-29s.wav",
        "kokoro-am_michael": root / "input" / "kokoro-am_michael-what-lab-ref-29s.wav",
    }
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required")

    samples: list[float] = []
    stop = threading.Event()

    def monitor() -> None:
        while not stop.wait(0.05):
            samples.append(used_vram_mib())

    baseline = used_vram_mib()
    thread = threading.Thread(target=monitor, daemon=True)
    thread.start()
    load_started = time.perf_counter()
    model = Qwen3TTSModel.from_pretrained(
        MODEL_ID,
        device_map="cuda:0",
        dtype=torch.bfloat16,
        attn_implementation="sdpa",
    )
    load_seconds = time.perf_counter() - load_started
    after_load = used_vram_mib()

    results = []
    try:
        for slug, ref_audio in refs.items():
            torch.cuda.reset_peak_memory_stats()
            torch.cuda.synchronize()
            started = time.perf_counter()
            wavs, sample_rate = model.generate_voice_clone(
                text=SCRIPT,
                language="English",
                ref_audio=str(ref_audio),
                ref_text=REF_TEXT,
            )
            torch.cuda.synchronize()
            elapsed = time.perf_counter() - started
            target = output / f"what-lab-qwen3-1.7b-clone-{slug}.wav"
            sf.write(target, wavs[0], sample_rate, subtype="PCM_16")
            duration = len(wavs[0]) / sample_rate
            results.append(
                {
                    "voice": slug,
                    "reference": str(ref_audio),
                    "output": str(target),
                    "sample_rate": sample_rate,
                    "duration_seconds": duration,
                    "generation_seconds": elapsed,
                    "realtime_factor": elapsed / duration,
                    "times_realtime": duration / elapsed,
                    "torch_peak_allocated_mib": torch.cuda.max_memory_allocated() / 1024 / 1024,
                }
            )
    finally:
        stop.set()
        thread.join()

    metrics = {
        "model": MODEL_ID,
        "dtype": "bfloat16",
        "attention": "sdpa",
        "gpu": torch.cuda.get_device_name(0),
        "baseline_used_vram_mib": baseline,
        "model_loaded_used_vram_mib": after_load,
        "observed_peak_total_used_vram_mib": max(samples, default=after_load),
        "load_seconds": load_seconds,
        "script": SCRIPT,
        "reference_text": REF_TEXT,
        "results": results,
    }
    (output / "clone-metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
