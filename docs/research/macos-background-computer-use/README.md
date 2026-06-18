# macOS Background Computer Use

Local archive and notes for background-safe macOS automation, especially CuaDriver.

## Sources

| Source | Local copy | Notes |
|---|---|---|
| trycua/cua: “Inside macOS Window Internals” | `raw/inside-macos-window-internals.md` | Technical write-up on using CuaDriver, SkyLight `SLEventPostToPid`, AX state, and focus-without-raise patterns to drive windows without stealing focus. |

## Working Notes

- CuaDriver is the preferred local control plane for native macOS GUI automation and visual/browser interaction that must not disturb Arthur's foreground work.
- CDP remains useful for browser protocol work: DOM execution, network/API inspection, cookies, and provider-specific frontend adapters.
- The old AeroSpace PID guard is reactive. It can remain as a safety net, but new workflows should use CuaDriver or protocol-level automation instead of relying on focus being stolen and restored.
- For browser tasks, choose the addressing mode by app/page:
  - rich browser DOM/network need: CDP/Playwright/Puppeteer
  - real logged-in browser GUI/visual state need: CuaDriver `page` or `get_window_state`
  - native Mac app with good AX: CuaDriver element indices
  - custom-rendered app with sparse AX: CuaDriver screenshots plus careful pixel fallback

## Local Verification

On 2026-06-09, CuaDriver `0.5.1` was installed at `/Applications/CuaDriver.app/Contents/MacOS/cua-driver`, daemon status was healthy, and Accessibility + Screen Recording permissions were granted. A Calculator launch/snapshot test confirmed `self_activation_suppressed: true`.
