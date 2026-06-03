# pi-browser-use-cleanroom

Clean-room Browser Use tools for Pi CLI. This is **not** copied from Codex; it is an independent CDP/Puppeteer implementation inspired by the observed tool shape.

## Tools

- `browser_open` — launch/connect to a dedicated Chrome/Chromium profile
- `browser_tabs` — list/select/new/close tabs
- `browser_navigate` — navigate the active tab
- `browser_snapshot` — save screenshot + collect page title, URL, viewport, accessibility snapshot, and ref-indexed DOM elements
- `browser_click` — click by `ref`, CSS selector, or coordinates
- `browser_type` — type into a `ref`/selector or focused element
- `browser_key` — press key/chord (`Meta+L`, `Control+A`, `Enter`, etc.)
- `browser_scroll` — scroll page or element
- `browser_wait` — wait for time/selector/text

State, profile and screenshots live under `~/.pi/pi-browser-use/` by default.

## Run

From this repository:

```bash
pi -e ./browser-use-pi/index.ts
```

Or copy this folder into a Pi package/extension location.

## Browser selection

Defaults to a visible Chrome/Chromium-compatible browser and a dedicated CDP profile.

Options/env:

- `browserPath` parameter or `PI_BROWSER_USE_EXECUTABLE`
- `browserApp` parameter on macOS, e.g. `Google Chrome`, `Chromium`, `Brave Browser`, `Helium`
- `port` parameter or default `9344`
- `profileDir` parameter or `~/.pi/pi-browser-use/profile`

## Typical flow

1. `browser_open({ url: "https://example.com" })`
2. `browser_snapshot({ includeImage: true })`
3. Use refs like `e1`, `e2` returned by snapshot:
   - `browser_click({ ref: "e3" })`
   - `browser_type({ ref: "e7", text: "hello" })`
   - `browser_key({ key: "Enter" })`

Call `browser_snapshot` after page changes to refresh refs.
