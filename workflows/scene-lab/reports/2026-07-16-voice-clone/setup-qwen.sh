#!/usr/bin/env bash
set -euo pipefail
export UV_HTTP_TIMEOUT=600
export UV_HTTP_RETRIES=10

LAB="$HOME/tts-lab/fish"
mkdir -p "$LAB" "$LAB/input" "$LAB/output" "$LAB/logs"
cd "$LAB"

if [[ ! -x .venv/bin/python ]]; then
  uv venv --python 3.12 .venv
fi
uv pip install --python .venv/bin/python qwen-tts huggingface_hub soundfile
uv pip install --python .venv/bin/python --reinstall \
  torch==2.9.1 torchaudio==2.9.1 \
  --index https://download.pytorch.org/whl/cu128

.venv/bin/python - <<'PY'
import qwen_tts, torch
print(f"qwen_tts={qwen_tts.__file__}")
print(f"torch={torch.__version__} cuda={torch.version.cuda} available={torch.cuda.is_available()}")
if not torch.cuda.is_available():
    raise SystemExit("CUDA is unavailable in the isolated Qwen environment")
PY
