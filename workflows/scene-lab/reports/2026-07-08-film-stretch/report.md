---
title: "FILM stretch for render2_pulse"
date: 2026-07-08
agent: FilmStretch
status: blocker
---

## What was attempted

- **Source:** `~/latwalk-lab/generations/render2_pulse.mp4` — 30.0 s, 30 fps, 720×720, 900 frames.
- **Target recipe:** downsample to 512×512, run at `--source-fps 12 --factor 2`, producing a 24 fps smoothed MP4.

1. Created a tmux session `film` on the desktop RTX 3090 and installed `tensorflow[and-cuda]==2.16.2` + `tensorflow-hub==0.16.1` into `~/latwalk-lab/venv` (the shared latwalk environment). The install completed after ~20 minutes of downloads, but importing TensorFlow failed with a numpy/scipy mismatch:
   ```
   AttributeError: module 'numpy' has no attribute 'long'. Did you mean: 'log'?
   ```
   The TF install pinned numpy to 1.26.4 while the shared venv still had scipy 1.18.0, which requires numpy 2.x.
2. A second tmux session `film2` was started with a dependency-fix script (`numpy==1.26.4 scipy==1.13.1`). Before it could finish, the run was aborted after guidance from Main to use a separate `venv-film` and not touch the shared venv.
3. Attempting to restore the shared venv (reinstall numpy 2.5.1, scipy 1.18.0, protobuf 6.33.6, uninstall TensorFlow) revealed deeper damage: the initial TF install had overwritten the CUDA 12.4 / cuDNN 9 pip packages required by torch 2.5.1+cu124 with TensorFlow's CUDA 12.3 / cuDNN 8.9 packages. `import torch` now fails:
   ```
   ImportError: libcudnn.so.9: cannot open shared object file: No such file or directory
   ```

## Blocker

The shared `~/latwalk-lab/venv` is no longer able to import PyTorch. Running FILM inside this venv is not possible without repairing the environment, and the current directive is to keep the shared venv untouched. The next attempt must be in an isolated `~/latwalk-lab/venv-film`.

## No deliverables produced

- No interpolated MP4.
- No before/after still pairs.
- Wall time / VRAM not measured because the interpolation never started.

## Verdict

**Not adoptable in the current pipeline** until the shared venv is restored and FILM is isolated in its own environment. TensorFlow's CUDA packaging is too invasive to share with the torch-based latwalk pipeline.

## Rerun commands (recommended isolated approach)

```bash
ssh desktop
cd ~/latwalk-lab

# Create an isolated FILM environment
python -m venv venv-film
source venv-film/bin/activate
pip install numpy==1.26.4 scipy==1.13.1 Pillow tensorflow==2.16.2 tensorflow-hub==0.16.1

# Extract frames and audio with system ffmpeg
mkdir -p .film_work/render2_pulse_film/{input_frames,output_frames}
ffmpeg -y -i generations/render2_pulse.mp4 \
  -an -vf "fps=12,scale=512:512:flags=lanczos" -pix_fmt rgb24 \
  .film_work/render2_pulse_film/input_frames/%08d.png
ffmpeg -y -i generations/render2_pulse.mp4 -vn -c:a copy \
  .film_work/render2_pulse_film/audio.m4a

# Run the latwalk FILM wrapper in the isolated venv
python latwalk/film_interpolate.py \
  --input generations/render2_pulse.mp4 \
  --output generations/render2_pulse_film.mp4 \
  --source-fps 12 --factor 2 --width 512 --height 512 --overwrite
```

## Desktop cleanup

- No stray tmux sessions remain (`tmux ls` reports "no server running").
- The broken `~/latwalk-lab/venv` still needs repair; suggested restoration is to reinstall the CUDA 12.4 / cuDNN 9 pip packages required by torch 2.5.1+cu124.

## Log tails

See attached files:
- `film.log` — first install + TF import failure in shared venv.
- `film_v2.log` — second attempt and discovery of the torch/cuDNN breakage.

Tail of `film_v2.log` showing the torch import failure after the first install:
```
ImportError: libcudnn.so.9: cannot open shared object file: No such file or directory
```

Tail of `film.log` showing the original TF/numpy failure:
```
AttributeError: module 'numpy' has no attribute 'long'. Did you mean: 'log'?
Command exited with non-zero status 1
```
