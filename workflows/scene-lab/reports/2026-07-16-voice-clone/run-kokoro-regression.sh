#!/usr/bin/env bash
set -uo pipefail
cd "$HOME/tts-lab"
.venv/bin/python -c 'import torch; print("torch", torch.__version__, "cuda", torch.version.cuda, "available", torch.cuda.is_available(), "device", torch.cuda.get_device_name(0)); assert torch.cuda.is_available()' 2>&1 | tee fish/logs/kokoro-cuda-check.log
cuda_rc=${PIPESTATUS[0]}
if (( cuda_rc != 0 )); then
  exit "$cuda_rc"
fi
.venv/bin/python generate_kokoro.py --scripts fish/input/kokoro-regression.json --output fish/output/kokoro-regression --voice am_michael --comparison-voice am_fenrir 2>&1 | tee fish/logs/kokoro-regression.log
exit "${PIPESTATUS[0]}"
