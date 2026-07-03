---
name: cmux-browser-drive
description: Drive cmux browser/WebView surfaces. Use when you need to open sites, navigate, interact with pages, wait for state changes, and extract data from cmux browser surfaces — but not when you need CDP/network interception or headless Chromium automation.
---

# cmux Browser Drive

Use this skill for browser tasks inside cmux WebView surfaces.

## When to Use cmux Browser

| Scenario | Use | Why |
|---|---|---|
| Web page inside a cmux browser surface | `cmux browser` API | Native cmux surface; no focus stealing; integrates with cmux panes/tabs |
| Web page in Chrome/Chromium outside cmux | Vercel `agent-browser`, Playwright, Puppeteer, or CDP | Full CDP: network, cookies, console, screenshots, emulation |
| Electron app with `--remote-debugging-port` | CDP to the visible Electron window | Real app UI via DevTools Protocol; browser-level input |
| Electron/native app with no CDP port | CuaDriver | OS-level input through Accessibility/CGEvents |
| Native macOS app | CuaDriver | Background-safe native AX control |

cmux browser is backed by WKWebView. WKWebView does **not** expose a Chrome DevTools Protocol equivalent, so the supported WebView control surface is the `cmux browser` API. Use CDP only with Chrome/Chromium or Electron targets that explicitly expose a CDP endpoint.

## Stable Agent Loop

Every interaction follows this cycle:

```text
1. Open or target a surface       cmux browser open <url>
2. Verify navigation               cmux browser <surface> get url
3. Wait for readiness               cmux browser <surface> wait --load-state complete
4. Snapshot for refs                cmux browser <surface> snapshot --interactive
5. Act by refs                      cmux browser <surface> click|fill|type|select|press <ref>
6. Re-snapshot after DOM changes    cmux browser <surface> snapshot --interactive
```

Never act on stale refs. Always re-snapshot after navigation, modal open/close, tab switches, or any DOM-mutating action.

### Concrete Loop

```bash
cmux --json browser open https://example.com
# → surface:7

cmux browser surface:7 get url
cmux browser surface:7 wait --load-state complete --timeout-ms 15000
cmux browser surface:7 snapshot --interactive
# → refs: e1, e2, e3, ...

cmux --json browser surface:7 click e5 --snapshot-after
cmux browser surface:7 snapshot --interactive
```

Use `--snapshot-after` on mutating actions to get a fresh post-action snapshot in one step. For critical verification, re-run `snapshot --interactive` explicitly.

## Read-Only Extraction Mode

When the task is read-only and must not execute page JavaScript, prefer these commands:

```bash
cmux browser surface:7 get text body     # visible text, no JS injection
cmux browser surface:7 get html body     # full HTML, no JS injection
```

**Warning:** `snapshot --interactive` and `eval` inject JavaScript into the page to build the interactive element tree or evaluate expressions. Do **not** use them when the task forbids page-code injection or when the page's CSP/security model prohibits it.

If `snapshot --interactive` returns `js_error`, fall back to `get text body` / `get html body`:

```bash
cmux browser surface:7 get url              # confirm the page actually loaded
cmux browser surface:7 get text body        # safe fallback
cmux browser surface:7 get html body        # safe fallback
```

For targeted extraction without `snapshot --interactive`:

```bash
cmux browser surface:7 get text "#main-content"
cmux browser surface:7 get value "#email"
cmux browser surface:7 get attr "#submit" --attr placeholder
cmux browser surface:7 get count ".row"
cmux browser surface:7 get box "#submit"
```

## Input Fidelity and Human-Owned Flows

Use the **highest-fidelity supported input path** that is legitimate for the task:

1. cmux browser input (`click`, `fill`, `press`, `scroll`) — supported for WKWebView surfaces and preferred over page-code mutation.
2. Native/OS input (CuaDriver through AX/CGEvents) — closest to a real user for native or Electron windows.
3. Browser/CDP input (agent-browser, Playwright, Puppeteer) — use only for Chrome/Chromium or Electron targets exposing a CDP endpoint.
4. DOM mutation (`element.click()`, `input.value = ...`) — acceptable only for internal tools or when no supported input path exists.

For account-owned or sensitive flows, operate only within the requested visible page state. If the page needs a human decision or credential the agent does not have, report the state and wait for user direction.

## Surface Targeting

```bash
# identify current context
cmux identify --json

# open in the caller's workspace (uses CMUX_WORKSPACE_ID)
cmux browser open https://example.com --json

# open routed to a specific topology target
cmux browser open https://example.com --workspace workspace:2 --window window:1 --json

# navigate an existing surface
cmux browser surface:7 goto https://example.com/dashboard

# get current URL
cmux browser surface:7 get url
```

Notes:
- CLI output defaults to short refs (`surface:N`, `pane:N`, `workspace:N`, `window:N`).
- UUIDs are still accepted on input; request UUID output only when needed (`--id-format uuids|both`).
- Keep one task per surface to avoid ref churn.
- `browser open` targets the workspace of the terminal where the command is run, even if a different workspace is currently focused. Use `--workspace` to override.

## Common Command Patterns

### Form Fill and Submit

```bash
cmux --json browser open https://example.com/signup
cmux browser surface:7 get url
cmux browser surface:7 wait --load-state complete --timeout-ms 15000
cmux browser surface:7 snapshot --interactive
cmux browser surface:7 fill e1 "Jane Doe"
cmux browser surface:7 fill e2 "jane@example.com"
cmux --json browser surface:7 click e3 --snapshot-after
cmux browser surface:7 wait --url-contains "/welcome" --timeout-ms 15000
cmux browser surface:7 snapshot --interactive
```

### Clear an Input

```bash
cmux browser surface:7 fill e11 "" --snapshot-after --json
cmux browser surface:7 get value e11 --json
```

### Wait Patterns

```bash
cmux browser surface:7 wait --selector "#ready" --timeout-ms 10000
cmux browser surface:7 wait --text "Success" --timeout-ms 10000
cmux browser surface:7 wait --url-contains "/dashboard" --timeout-ms 10000
cmux browser surface:7 wait --load-state complete --timeout-ms 15000
cmux browser surface:7 wait --function "document.readyState === 'complete'" --timeout-ms 10000
```

### Parallel Multi-Site Extraction

```bash
cmux browser open https://site-a.example --json
cmux browser open https://site-b.example --json
cmux browser open https://site-c.example --json

cmux browser surface:11 get text body > /tmp/a.txt
cmux browser surface:12 get text body > /tmp/b.txt
cmux browser surface:13 get text body > /tmp/c.txt
```

### State Save/Load (Reuse Auth Across Surfaces)

```bash
cmux browser open https://app.example.com/account --json
# establish the desired signed-in state on surface:7 ...
cmux browser surface:7 state save /tmp/auth.json

cmux browser open https://app.example.com --json
# → surface:8
cmux browser surface:8 state load /tmp/auth.json
cmux browser surface:8 goto https://app.example.com/dashboard
```

### Scoped Snapshots for Large Pages

```bash
cmux browser surface:7 snapshot --selector "form#checkout" --interactive
cmux browser surface:7 snapshot --interactive --compact --max-depth 3
```

## Troubleshooting

### Stale Refs (`not_found`)

Refs are invalidated when the page structure changes. Re-snapshot:

```bash
cmux browser surface:7 snapshot --interactive
# use fresh refs from the new snapshot
```

### Blank or `about:blank` Surface

If `get url` returns empty or `about:blank`, the surface hasn't navigated yet. Navigate first — do not wait on load state:

```bash
cmux browser surface:7 goto https://example.com
cmux browser surface:7 get url
cmux browser surface:7 wait --load-state complete --timeout-ms 15000
```

### `js_error` on `snapshot --interactive` or `eval`

Some complex pages reject or break the JavaScript used for rich snapshots and ad-hoc evaluation:

```bash
cmux browser surface:7 get url                # confirm navigation
cmux browser surface:7 get text body          # safe fallback
cmux browser surface:7 get html body          # safe fallback
```

If the page is still failing, navigate to a simpler intermediate page and retry from there.

### Element Missing Due to Visibility/Timing

```bash
cmux browser surface:7 wait --selector "#target" --timeout-ms 10000
cmux browser surface:7 scroll --dy 400
cmux browser surface:7 snapshot --interactive
```

### Unsupported WKWebView Features

These commands return `not_supported` because they rely on Chrome/CDP-only APIs not exposed by WKWebView:

- `browser.viewport.set`
- `browser.geolocation.set`
- `browser.offline.set`
- `browser.trace.start|stop`
- `browser.network.route|unroute|requests`
- `browser.screencast.start|stop`
- `browser.input_mouse|input_keyboard|input_touch`

Use supported high-level commands (`click`, `fill`, `press`, `scroll`, `wait`, `snapshot`) instead. If you need network interception, viewport emulation, or screencast recording, switch to a CDP-based tool (Playwright, Puppeteer, or agent-browser).

## References

- `skill://cmux-browser` — upstream cmux browser skill (vendored at `vendor/manaflow-ai/cmux/skills/cmux-browser/SKILL.md`)
- `skill://browser-control` — tool-choice decision guide
- `skill://cua-driver` — native macOS app automation
- `skill://background-browser-automation` — CDP/Playwright background patterns
- `docs/plans/browser-control-patterns.md` — decision rules and fidelity order
