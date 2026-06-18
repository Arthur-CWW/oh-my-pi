# CuaDriver Window Internals Notes

Source: `raw/inside-macos-window-internals.md` archived from trycua/cua on 2026-06-09.

## Main Takeaway

CuaDriver exists to let agents control real macOS apps in the background without moving the human's cursor, raising target windows, or dragging the user across Spaces. It combines public Accessibility inspection, screenshots, app/window addressing, and a maintained private macOS event path behind the `cua-driver` interface.

## Design Implications For This Repo

- Prefer `cua-driver` as the local GUI automation boundary. Do not copy private SkyLight calls into this repo.
- Use `pid` + `window_id` + `element_index` when AX exposes meaningful controls.
- Use screenshot plus pixel fallback only when AX is sparse or the target is custom-rendered.
- Use CDP only for browser protocol needs, not as the default way to “click around” visible logged-in browsers.
- Retire the old focus-steal mitigation approach as a primary architecture. Reactive guards are safety nets, not the desired automation control plane.

## Terms

- **Control plane**: the daemon/API boundary that queues, schedules, and dispatches work to automation workers.
- **Worker pool**: the limited set of concurrently running browser/app sessions.
- **Protocol automation**: CDP/Playwright/Puppeteer style DOM, network, and target control.
- **GUI automation**: CuaDriver style AX/screenshot/window control of real Mac apps.
