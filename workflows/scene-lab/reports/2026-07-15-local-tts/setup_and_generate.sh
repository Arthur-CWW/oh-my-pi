#!/usr/bin/env bash
set -euo pipefail
cd "$HOME/tts-lab"
exec > >(tee run.log) 2>&1
trap 'rc=$?; printf "%s\n" "$rc" > exit-code.txt' EXIT
mkdir -p output evidence
nvidia-smi > evidence/nvidia-before.txt
start_epoch=$(date +%s)
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python kokoro soundfile 'misaki[en]'
.venv/bin/python generate_kokoro.py --scripts scripts.json --output output --voice am_michael --comparison-voice am_fenrir --speed 0.9 &
pid=$!
while kill -0 "$pid" 2>/dev/null; do
  nvidia-smi --query-gpu=timestamp,name,memory.used,memory.total,utilization.gpu --format=csv,noheader >> evidence/nvidia-during.csv
  sleep 0.25
done
wait "$pid"
end_epoch=$(date +%s)
printf '{"wall_clock_seconds": %s}\n' "$((end_epoch - start_epoch))" > evidence/wall-clock.json
nvidia-smi > evidence/nvidia-after.txt
uv pip freeze --python .venv/bin/python > evidence/requirements-lock.txt
