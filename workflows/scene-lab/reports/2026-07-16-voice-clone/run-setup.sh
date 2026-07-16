#!/usr/bin/env bash
set -uo pipefail
LAB="$HOME/tts-lab/fish"
cd "$LAB"
set +e
bash ./setup-qwen.sh 2>&1 | tee "$LAB/logs/setup.log"
status=${PIPESTATUS[0]}
set -e
STATUS="$status" "$HOME/tts-lab/fish/.venv/bin/python" -c 'import os; from pathlib import Path; Path.home().joinpath("tts-lab/fish/setup.exit").write_text(os.environ["STATUS"] + "\n")' 2>/dev/null || python3 -c 'import os; from pathlib import Path; Path.home().joinpath("tts-lab/fish/setup.exit").write_text(os.environ["STATUS"] + "\n")'
exit "$status"
