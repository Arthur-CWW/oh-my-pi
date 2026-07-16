#!/usr/bin/env bash
set -uo pipefail
cd "$HOME/tts-lab/fish"
nvidia-smi --query-gpu=timestamp,memory.used,utilization.gpu --format=csv,noheader,nounits -lms 100 -f logs/nvidia-smi.csv &
poll_pid=$!
cleanup() {
  kill "$poll_pid" || true
  wait "$poll_pid" || true
}
trap cleanup EXIT
.venv/bin/python generate_clones.py 2>&1 | tee logs/generate.log
exit "${PIPESTATUS[0]}"
