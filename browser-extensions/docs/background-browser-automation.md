# Background Browser Automation

Use this when an agent needs to attach to a logged-in browser without interrupting the user's flow.

## Preferred browser setup

Use a dedicated Chromium-family app/profile for automation. Helium is a good candidate because it can be separate from the user's normal Chrome profile.

```bash
open -g -na "Helium" --args \
  --remote-debugging-port=9338 \
  --user-data-dir="$HOME/.browser-extensions/profiles/helium-agent" \
  --no-first-run \
  --no-default-browser-check \
  about:blank
```

Details:

- `-g` asks macOS not to bring the browser to the foreground.
- `-n` opens a separate app instance.
- `--remote-debugging-port` exposes CDP.
- `--user-data-dir` keeps agent cookies/session state in a dedicated profile.

Before launching, check if CDP is already alive:

```bash
curl -fsS http://127.0.0.1:9338/json/version >/dev/null
```

## CDP pattern

Create tabs in the background through the browser target. Do not activate them.

```ts
const version = await fetch("http://127.0.0.1:9338/json/version").then((r) => r.json())
const browserWs = new WebSocket(version.webSocketDebuggerUrl)

// Send Target.createTarget with { background: true }
```

Avoid:

- `Target.activateTarget`
- `page.bringToFront()`
- `browser.newPage()` if it selects the new tab
- AppleScript `activate`
- Accessibility clicks/keystrokes

Prefer:

- `Target.createTarget({ url, background: true })`
- DOM evaluation
- CDP `Input.insertText`
- existing-target reuse

## AeroSpace quarantine strategy

Some browser windows will still appear or steal focus. The low-effort long-term mitigation is a window-manager quarantine, not a browser fork.

Use AeroSpace rules to:

- float automation browser windows,
- move them to a dedicated workspace such as `d` or `agent`,
- optionally restore focus when those apps steal focus.

A practical rule looks like:

```toml
[[on-window-detected]]
if.app-id = "net.imput.helium"
if.window-title-regex-substring = "DevTools|about:blank|Chrome DevTools|X Bookmark Sync"
run = ["layout floating", "move-node-to-workspace d"]
```

If this is too broad for your daily Helium use, create a copied/renamed automation app bundle with a distinct bundle id, then target only that app id.

## Recommendation

Do not fork AeroSpace first. Start with config-level quarantine and focus restoration. Forking a WM is only worth it if we need a new primitive like "ignore/manage-never-focus windows matching this app/title" that AeroSpace cannot express.
