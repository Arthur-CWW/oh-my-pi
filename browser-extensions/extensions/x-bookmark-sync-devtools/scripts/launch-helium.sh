#!/usr/bin/env bash
set -euo pipefail

EXT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILT_EXT_DIR="$EXT_DIR/dist"
HELIUM_BIN="${HELIUM_BIN:-/Applications/Helium.app/Contents/MacOS/Helium}"
HELIUM_PROFILE="${HELIUM_PROFILE:-$HOME/.helium-x-bookmark-sync}"
URL="${1:-https://x.com/i/bookmarks}"

if [[ ! -x "$HELIUM_BIN" ]]; then
  echo "Helium binary not found: $HELIUM_BIN" >&2
  echo "Set HELIUM_BIN=/path/to/Chromium-like-browser" >&2
  exit 1
fi

if [[ ! -f "$BUILT_EXT_DIR/manifest.json" ]]; then
  echo "Built extension missing. Run: pnpm build" >&2
  exit 1
fi

mkdir -p "$HELIUM_PROFILE"

exec "$HELIUM_BIN" \
  --user-data-dir="$HELIUM_PROFILE" \
  --load-extension="$BUILT_EXT_DIR" \
  --auto-open-devtools-for-tabs \
  "$URL"
