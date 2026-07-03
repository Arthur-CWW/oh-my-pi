---
name: browser-control
description: Choose the right browser/Electron/native UI control tool for a task. Use when the user asks to automate, drive, or inspect a web page, Electron app, or native Mac app.
---

# Browser / Electron / Native UI Control

Use this skill to pick the right control layer.

## Quick decision

1. **Target is a web page inside a cmux browser pane**
   - Use: `cmux browser` API.
   - Example: `cmux browser open https://example.com`, `cmux browser surface:N snapshot --interactive`.

2. **Target is a web page in Chrome/Chromium outside cmux**
   - Use: Vercel `agent-browser` or CDP-based tools (`packages/browser-use`, Playwright, Puppeteer).
   - Prefer visible/non-headless mode.

3. **Target is an Electron app that supports `--remote-debugging-port`**
   - Use: CDP to the visible Electron window.
   - Only for setup/debug; prefer official APIs for routine bot work.
   - Works for Discord, Slack, VS Code, or any other Electron app you can relaunch with the flag.

4. **Target is an Electron/native app with no CDP port**
   - Use: CuaDriver.
   - Example: desktop Discord, Slack, native macOS apps.

## CDP with an Electron app

If the Electron binary supports `--remote-debugging-port=PORT`:

```bash
/Applications/MyApp.app/Contents/MacOS/MyApp --remote-debugging-port=9222
```

Then connect via CDP:

```bash
agent-browser connect 9222
agent-browser get url
agent-browser snapshot -i
```

Or with local browser-use:

```bash
PI_BROWSER_USE_PORT=9222 bun packages/browser-use/index.ts
```

If the app is already running, close it normally first; the flag only takes effect at launch.

## Fidelity order

For legitimate UI testing, prefer input paths closer to real user interaction:

1. Native/OS input (CuaDriver CGEvent/Accessibility)
2. Browser/CDP input (agent-browser, Playwright, Puppeteer)
3. DOM mutation (`page.evaluate` clicks) — only when other paths are unavailable

## Headless rule

Avoid headless browser automation unless the user explicitly asks for it. Use visible windows and real apps.

## Human-verification rule

If a login, CAPTCHA, payment, account, or permission dialog appears, stop and ask the user to complete it. Do not attempt to bypass verification systems.

## References

- `docs/plans/browser-control-patterns.md`
- `docs/plans/electron-cdp.md`
