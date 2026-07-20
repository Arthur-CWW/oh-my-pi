---
name: browser-control
description: Canonical chooser for browser, Electron, cmux WebView, and native Mac control. Load this first for any interactive surface, then dispatch to cmux-browser-drive for cmux, background-browser-automation for non-focus-stealing CDP/Playwright work, or the native computer-use bridge.
---

# Browser / Electron / Native UI Control

Use this skill to pick the right control layer.

## Quick decision

1. **Target is a web page inside a cmux browser pane**
   - Use: `cmux browser` API.
   - Example: `cmux browser open https://example.com`, `cmux browser surface:N snapshot --interactive`.

2. **Target is a web page in Chrome/Chromium outside cmux**
   - Use the OMP `browser` tool or CDP-based tools (`packages/browser-use`, Playwright, Puppeteer).
   - Prefer visible/non-headless mode.

3. **Target is an Electron app that supports `--remote-debugging-port`**
   - Use: CDP to the visible Electron window.
   - Only for setup/debug; prefer official APIs for routine bot work.
   - Works for Discord, Slack, VS Code, or any other Electron app you can relaunch with the flag.

4. **Target is an Electron/native app with no CDP port**
   - Use the installed `cua-driver` CLI and load `skill://cua-driver`.
   - Keep the inspect-act-verify loop and the skill's background/focus boundaries.

## CDP with an Electron app

If the Electron binary supports `--remote-debugging-port=PORT`:

```bash
/Applications/MyApp.app/Contents/MacOS/MyApp --remote-debugging-port=9222
```

Then connect via CDP:

Attach with the OMP `browser` tool using the app's explicit CDP URL, or use the local browser-use entry point below.

Local browser-use:

```bash
PI_BROWSER_USE_PORT=9222 bun packages/browser-use/index.ts
```

If the app is already running, close it normally first; the flag only takes effect at launch.

## Control-layer order

Use the least invasive layer that supplies the required truth:

1. Protocol/browser work: OMP `browser`, Playwright, Puppeteer, or explicit CDP for DOM, cookies, network, console, and Electron DevTools work.
2. Native GUI work: the installed `cua-driver` CLI under the `cua-driver` skill's policy.
3. DOM mutation (`page.evaluate` clicks) only when browser input APIs are unavailable.

Do not use a native GUI boundary for browser protocol work, and do not use CDP to control native menus or inspect macOS Accessibility state.

## Headless rule

Avoid headless browser automation unless the user explicitly asks for it. Use visible windows and real apps.

## Human-verification rule

If a login, CAPTCHA, payment, account, or permission dialog appears, stop and ask the user to complete it. Do not attempt to bypass verification systems.

## References

- `docs/plans/browser-control-patterns.md`
- `docs/plans/electron-cdp.md`
