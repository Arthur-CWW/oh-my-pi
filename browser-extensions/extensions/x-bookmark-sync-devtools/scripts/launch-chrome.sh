#!/usr/bin/env bash
set -euo pipefail

EXT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILT_EXT_DIR="$EXT_DIR/dist"
CHROME_PROFILE="${CHROME_PROFILE:-$HOME/.chrome-x-bookmark-sync}"
URL="${1:-https://x.com/i/bookmarks}"

if [[ ! -f "$BUILT_EXT_DIR/manifest.json" ]]; then
  echo "Built extension missing. Run: pnpm build" >&2
  exit 1
fi

mkdir -p "$CHROME_PROFILE"

ARGS=(
  --user-data-dir="$CHROME_PROFILE"
  --load-extension="$BUILT_EXT_DIR"
  --auto-open-devtools-for-tabs
  "$URL"
)

if [[ -n "${CHROME_BIN:-}" ]]; then
  if [[ ! -x "$CHROME_BIN" ]]; then
    echo "Chrome/Chromium binary not executable: $CHROME_BIN" >&2
    exit 1
  fi
  exec "$CHROME_BIN" "${ARGS[@]}"
fi

if [[ -n "${CHROME_APP:-}" ]]; then
  exec open -g -na "$CHROME_APP" --args "${ARGS[@]}"
fi

for app in "Google Chrome" "Chromium" "Google Chrome Canary"; do
  if [[ -d "/Applications/$app.app" ]]; then
    exec open -g -na "$app" --args "${ARGS[@]}"
  fi
done

for candidate in google-chrome chromium chrome; do
  if command -v "$candidate" >/dev/null 2>&1; then
    exec "$candidate" "${ARGS[@]}"
  fi
done

echo "Chrome/Chromium not found." >&2
echo "Set CHROME_APP='Google Chrome' for a macOS app name, or CHROME_BIN=/path/to/chrome." >&2
exit 1
