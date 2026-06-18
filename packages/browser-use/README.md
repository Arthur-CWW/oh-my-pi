# pi-browser-use-cleanroom

Clean-room Browser Use tools for Pi CLI. This is **not** copied from Codex; it is an independent CDP/Puppeteer implementation inspired by the observed tool shape.

On macOS, the default browser app is Helium and launch uses `open -g -na` so the automation profile can run without stealing focus.

For visual/browser GUI automation on Arthur's Mac, prefer CuaDriver first. Use this package when the task specifically needs CDP: DOM JavaScript, network capture, cookies, target/session control, or provider frontend adapters.

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
pi -e ./packages/browser-use/index.ts
```

Or copy this folder into a Pi package/extension location.

## Background launcher

Start or reuse the default Helium CDP profile:

```bash
bun run browser-use:helium
```

Open a URL as a CDP background target:

```bash
bun run browser-use:helium -- https://example.com/
```

The script uses:

- app: `PI_BROWSER_USE_APP` or `Helium`
- port: `PI_BROWSER_USE_PORT` or `9344`
- profile: `PI_BROWSER_USE_PROFILE_DIR` or `~/.pi/pi-browser-use/profile`

## Browser selection

Defaults to a dedicated CDP profile. On macOS, prefer Helium because it is separate from the user's daily Chrome profile.

Options/env:

- `browserPath` parameter or `PI_BROWSER_USE_EXECUTABLE`
- `browserApp` parameter on macOS, e.g. `Helium`, `Google Chrome`, `Chromium`, `Brave Browser`
- `port` parameter or default `9344`
- `profileDir` parameter or `~/.pi/pi-browser-use/profile`

## Focus safety

The tools avoid `page.bringToFront()` and create new tabs with CDP `Target.createTarget({ background: true })`. Do not add foreground activation calls unless the user explicitly wants to watch or manually interact with the browser.

## Typical flow

1. `browser_open({ url: "https://example.com" })`
2. `browser_snapshot({ includeImage: true })`
3. Use refs like `e1`, `e2` returned by snapshot:
   - `browser_click({ ref: "e3" })`
   - `browser_type({ ref: "e7", text: "hello" })`
   - `browser_key({ key: "Enter" })`

Call `browser_snapshot` after page changes to refresh refs.
