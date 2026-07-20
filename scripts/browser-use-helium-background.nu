#!/usr/bin/env -S nu --no-config-file

# Start or reuse the dedicated Helium CDP profile without stealing focus, then
# optionally open a URL as a background CDP target.
#
# Contract (PI_BROWSER_USE_*):
#   PI_BROWSER_USE_APP          browser app to launch          (default: Helium)
#   PI_BROWSER_USE_PORT         remote debugging port          (default: 9344)
#   PI_BROWSER_USE_PROFILE_DIR  profile directory              (default: ~/.pi/pi-browser-use/profile)
#   PI_BROWSER_USE_CDP_URL      CDP base URL                   (default: http://127.0.0.1:<port>)

# First non-empty value, mirroring bash `${VAR:-default}` (unset or empty both
# fall back to the default).
def or-default [value: any, fallback: string] {
    if ($value | is-empty) { $fallback } else { $value }
}

# True when the CDP endpoint answers /json/version.
def cdp-ready [cdp_url: string]: nothing -> bool {
    try {
        http get $"($cdp_url)/json/version" | ignore
        true
    } catch {
        false
    }
}

# Poll the CDP endpoint until it is ready or the 12s deadline elapses.
def wait-for-cdp [cdp_url: string]: nothing -> bool {
    let deadline = (date now) + 12sec
    mut ready = false
    while (date now) < $deadline {
        if (cdp-ready $cdp_url) {
            $ready = true
            break
        }
        sleep 200ms
    }
    $ready
}

def main [target_url?: string] {
    let app = (or-default $env.PI_BROWSER_USE_APP? "Helium")
    let port = (or-default $env.PI_BROWSER_USE_PORT? "9344")
    let profile_dir = (or-default $env.PI_BROWSER_USE_PROFILE_DIR? $"($env.HOME)/.pi/pi-browser-use/profile")
    let cdp_url = (or-default $env.PI_BROWSER_USE_CDP_URL? $"http://127.0.0.1:($port)")

    if not (cdp-ready $cdp_url) {
        mkdir $profile_dir
        (^open -g -na $app --args
            $"--remote-debugging-port=($port)"
            $"--user-data-dir=($profile_dir)"
            --no-first-run
            --no-default-browser-check
            --disable-background-timer-throttling
            --disable-renderer-backgrounding
            --disable-backgrounding-occluded-windows
            "about:blank")

        if not (wait-for-cdp $cdp_url) {
            print -e $"Timed out waiting for ($app) CDP at ($cdp_url)"
            exit 1
        }
    }

    print $"CDP ready: ($cdp_url)"
    print $"Profile: ($profile_dir)"

    if $target_url != null {
        let payload = '
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
        with-env {PI_BROWSER_USE_TARGET_URL: $target_url, PI_BROWSER_USE_CDP_URL: $cdp_url} {
            ^bun --eval $payload
        }
    }
}
