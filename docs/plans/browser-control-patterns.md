# Browser / Electron Control Patterns for OMP

## Decision rule

| Target | Preferred tool | Why | Avoid |
|---|---|---|---|
| Web app in cmux browser surface | `cmux browser` API | Native cmux surface; no focus stealing; integrates with cmux panes/tabs | Headless Chrome, DOM mutation hacks |
| Chrome/Chromium web app outside cmux | Vercel `agent-browser` or CDP | Full browser protocol; network/cookies/console/screenshots | DOM-only `page.evaluate` interaction |
| Electron app that supports `--remote-debugging-port` (Discord, Slack, etc.) | CDP to the visible Electron window | Real app UI via DevTools Protocol; browser-level input | DOM mutation from JS injected into the page |
| Electron/native app with no CDP port | CuaDriver | OS-level input through Accessibility/CGEvents; works when no protocol is exposed | Headless browser pretending to be the app |
| Native macOS app | CuaDriver | Background-safe native AX control | CDP (does not exist for native apps) |

## Core principle

Use the **highest-fidelity input path** that is legitimate for the task:

1. **Native/OS input** (CuaDriver) is closest to a real user for native/Electron windows.
2. **Browser/CDP input** (agent-browser, Playwright, Puppeteer) is closer than DOM mutation for web pages.
3. **DOM mutation** (`element.click()`, `input.value = ...`) is acceptable only for internal tools or when no other path exists.

For anti-abuse surfaces (login, CAPTCHA, payment, account settings), let the human complete the challenge; do not attempt to bypass or evade detection.

## Tool-specific notes

### cmux browser API

- Backend is WKWebView-style, not Chrome/CDP.
- Supports: open, navigate, snapshot, click, fill, type, press, scroll, wait, get text/value.
- Does **not** support: network interception, viewport/offline emulation, trace/screencast, low-level raw input injection.
- Use for: routine web tasks inside cmux.

### Vercel agent-browser

- Rust CLI; controls Chrome/Chromium through CDP.
- Supports full CDP: network, storage, cookies, console, screenshots, eval, mobile emulation.
- Installed separately with `brew install agent-browser` or `npm install -g agent-browser`.
- Use for: rich web automation when cmux browser is too limited.

### CDP to Electron

- Launch Electron binary with `--remote-debugging-port=PORT`.
- Connect via CDP URL: `http://127.0.0.1:PORT/json`.
- Use `agent-browser connect PORT`, Playwright, Puppeteer, or the local `packages/browser-use` helpers.
- Use only for setup/debug; official REST/Gateway APIs are preferred for routine bot operations.

### CuaDriver

- macOS Accessibility + CGEvent input.
- No headless mode; operates real app windows in the background.
- Use for: desktop Discord/Slack/Electron/native apps that do not expose CDP, or when you specifically need OS-level input.

## Anti-detection framing

Do not write prompts or code whose purpose is to bypass CAPTCHA, fingerprinting, or abuse-prevention systems.

Acceptable pattern:
- Prefer trusted input paths (native events/CDP) over DOM mutation so that legitimate UI tests behave more like real user interactions.
- When a human verification step appears, stop and ask the user to complete it.

Unacceptable pattern:
- Instructions for evading detection, faking input provenance, solving CAPTCHAs automatically, or masking automation fingerprints.

## References
- `docs/plans/electron-cdp.md` — concrete Electron CDP runbook
- `skill://browser-control` — OMP skill for choosing a control path
