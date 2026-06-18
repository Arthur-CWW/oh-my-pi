#!/usr/bin/env bash
set -euo pipefail

EXT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILT_EXT_DIR="$EXT_DIR/dist"
URL="${1:-https://x.com/i/bookmarks}"

cd "$EXT_DIR"

cleanup() {
  if [[ -n "${WATCH_PID:-}" ]]; then
    kill "$WATCH_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

bun run dev &
WATCH_PID=$!

for _ in {1..120}; do
  if [[ -f "$BUILT_EXT_DIR/manifest.json" ]]; then
    break
  fi
  sleep 0.25
done

if [[ ! -f "$BUILT_EXT_DIR/manifest.json" ]]; then
  echo "Timed out waiting for Vite watch build at $BUILT_EXT_DIR" >&2
  exit 1
fi

echo "Vite watch running as PID $WATCH_PID"
echo "Launching Chrome with unpacked extension: $BUILT_EXT_DIR"
echo "Panel asset changes: reopen/reload the DevTools panel. Manifest/background changes: reload the extension on chrome://extensions."

bash "$EXT_DIR/scripts/launch-chrome.sh" "$URL"

wait "$WATCH_PID"
