#!/bin/sh
# Supervised portless dev server: restarts on crash, logs to data/scene-lab/.
# Usage: nohup ./scripts/dev-up.sh >/dev/null 2>&1 &   (or via `bun run dev:up`)
cd "$(dirname "$0")/.." || exit 1
mkdir -p ../../data/scene-lab
LOG=../../data/scene-lab/dev-server.log
echo "[dev-up] supervisor start $(date -u +%FT%TZ)" >> "$LOG"
while true; do
  bunx portless scene bun --watch src/server.ts >> "$LOG" 2>&1
  echo "[dev-up] server exited ($?) — restarting in 2s $(date -u +%FT%TZ)" >> "$LOG"
  sleep 2
done
