#!/usr/bin/env bash
set -euo pipefail

APP="${PI_BROWSER_USE_APP:-Helium}"
PORT="${PI_BROWSER_USE_PORT:-9344}"
PROFILE_DIR="${PI_BROWSER_USE_PROFILE_DIR:-$HOME/.pi/pi-browser-use/profile}"
CDP_URL="${PI_BROWSER_USE_CDP_URL:-http://127.0.0.1:${PORT}}"

wait_for_cdp() {
  local deadline=$((SECONDS + 12))
  while (( SECONDS < deadline )); do
    if curl -fsS "${CDP_URL}/json/version" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

if ! curl -fsS "${CDP_URL}/json/version" >/dev/null 2>&1; then
  mkdir -p "${PROFILE_DIR}"
  open -g -na "${APP}" --args \
    "--remote-debugging-port=${PORT}" \
    "--user-data-dir=${PROFILE_DIR}" \
    --no-first-run \
    --no-default-browser-check \
    --disable-background-timer-throttling \
    --disable-renderer-backgrounding \
    --disable-backgrounding-occluded-windows \
    about:blank

  if ! wait_for_cdp; then
    echo "Timed out waiting for ${APP} CDP at ${CDP_URL}" >&2
    exit 1
  fi
fi

echo "CDP ready: ${CDP_URL}"
echo "Profile: ${PROFILE_DIR}"

if [[ $# -gt 0 ]]; then
  TARGET_URL="$1"
  PI_BROWSER_USE_TARGET_URL="${TARGET_URL}" PI_BROWSER_USE_CDP_URL="${CDP_URL}" bun --eval '
    const puppeteer = await import("puppeteer-core")
    const cdpUrl = process.env.PI_BROWSER_USE_CDP_URL
    const url = process.env.PI_BROWSER_USE_TARGET_URL
    const browser = await puppeteer.default.connect({ browserURL: cdpUrl })
    try {
      const browserTarget = browser.targets().find((target) => target.type() === "browser")
      if (!browserTarget) throw new Error("No browser target")
      const client = await browserTarget.createCDPSession()
      try {
        const created = await client.send("Target.createTarget", { url, background: true })
        console.log(`Background target: ${created.targetId}`)
      } finally {
        await client.detach()
      }
    } finally {
      await browser.disconnect()
    }
  '
fi
