---
title: Sonic first-light on desktop RTX 3090
date: 2026-07-15
agent: DesktopGPUFinisher
status: done
---

# Sonic first-light

## Result

Sonic produced a 9.960-second first-light MP4 from the Claude suit-swag figurine and the 10-second `what-lab` narration. The file and three requested stills were copied to the Mac and verified locally.

The requirements install had failed while extracting `torch==2.2.1` because `/home/arthur/.cache/uv/.tmp.../torch/lib/libtorch_cpu.so` hit `No space left on device`. With 31 GB free, rerunning the same requirements completed. The resulting Python 3.10 environment reports `torch 2.2.1+cu121`, CUDA 12.1, and the RTX 3090 available. Sonic's requirements also omit OpenCV; `opencv-python-headless==4.10.0.84` and `numpy==1.26.4` were added.

The stylized figurine is outside YOLO-face's domain: no face was found even at confidence 0.01. Upstream Sonic then references an unbound `bbox_s`, and its tensor preprocessor returns `None`. The remote owner-path checkout was repaired with a full-frame crop fallback plus a measured face-mask fallback for this 2048×2048 asset (x=36%, y=25%, width=22%, height=22%). No weights were re-downloaded.

## Artifacts

- `sonic-claude-10s.mp4` — 578,641 B
- `still-02s.png`
- `still-05s.png`
- `still-08s.png`
- `inference.log`, `inference.exit`, `nvidia-inference.csv`, `install-recovery.log`

Local `ffprobe` evidence:

- video: H.264, 512×512, 9.960 s
- audio: AAC, 16 kHz mono, 9.920 s
- container: 9.960 s

Inference took 5:46.43 wall clock. `nvidia-smi` polling (660 samples at 0.5 s) observed 16,578 MiB peak VRAM and 100% peak GPU utilization. Maximum resident host memory was 15,819,728 KiB.

## Quality verdict

- **Identity preservation:** recognizable silhouette, suit, crossed arms, orange radial hair, and black eyes remain. However, the 8-second still shows visible face/hair pose and geometry drift relative to 2 and 5 seconds.
- **Mouth articulation:** ineffective for this asset. The 2, 5, and 8-second stills all retain essentially the same closed curved mouth; there is no convincing phoneme-scale articulation.
- **Artifacts:** temporal identity/pose drift is visible, while the background and body remain comparatively stable. The manual mask avoids a crash but does not make a human-face diffusion prior understand the toy's graphic mouth.

## Viability for the power-posting lane

**Not viable for the recurring stylized-character lane in its current form.** The pipeline technically runs and is useful as an engineering first-light, but a static-looking mouth defeats the presentation layer. This is a quality rejection, not a setup blocker. Keep the proof artifact; do not use it for production posting without a character-specific face/mouth strategy. No alternative lip-sync model was installed.

## Exact rerun

The remote checkout at `~/sonic-lab/Sonic` contains the two no-face fallbacks described above.

```bash
ssh desktop
cd ~/sonic-lab/Sonic

uv pip install --python .venv/bin/python -r requirements.txt
uv pip install --python .venv/bin/python \
  'opencv-python-headless==4.10.0.84' 'numpy==1.26.4'

/usr/bin/time -v .venv/bin/python demo.py \
  ~/sonic-lab/claude-suit-swag-00.png \
  ~/sonic-lab/what-lab-10s.wav \
  ~/sonic-lab/sonic-claude-10s.mp4 \
  --crop --seed 72589 2>&1 | tee ~/sonic-lab/inference.log
```

Local verification and still extraction:

```bash
ffprobe -v error \
  -show_entries stream=index,codec_type,codec_name,width,height,sample_rate,channels,duration \
  -show_entries format=duration,size -of json \
  workflows/scene-lab/reports/2026-07-15-sonic-first-light/sonic-claude-10s.mp4

for t in 2 5 8; do
  ffmpeg -hide_banner -y -ss "$t" \
    -i workflows/scene-lab/reports/2026-07-15-sonic-first-light/sonic-claude-10s.mp4 \
    -frames:v 1 "workflows/scene-lab/reports/2026-07-15-sonic-first-light/still-0${t}s.png"
done
```
