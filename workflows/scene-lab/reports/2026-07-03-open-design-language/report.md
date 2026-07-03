---
title: Open Design Language Extraction
date: 2026-07-03
agent: OpenDesignLanguage
status: shipped
---

# Open Design Language Extraction — Proof Report

## Extraction path

**Live boot succeeded.** Open Design daemon and Next.js web runtime started on
first attempt. Computed CSS custom properties extracted from the running
dark-mode page, supplemented by static analysis of design-systems/**.

### Boot commands

```bash
# 1. Install vendor dependencies (16s, Node 24.13.1 / pnpm 10.33.2):
cd vendor/nexu-io--open-design
PATH="/Users/arthur/.local/share/mise/installs/node/24.13.1/bin:$PATH" \
  pnpm install --frozen-lockfile

# 2. Start daemon + web:
cd ~/agents
OD_DATA_DIR="$PWD/data/open-design/default" \
  PATH="/Users/arthur/.local/share/mise/installs/node/24.13.1/bin:$PATH" \
  pnpm --dir vendor/nexu-io--open-design tools-dev start web --namespace agents-local
# → daemon: http://127.0.0.1:59424 (pid 41493)
# → web:    http://127.0.0.1:59425 (pid 42893)

# 3. Stop after extraction:
PATH="/Users/arthur/.local/share/mise/installs/node/24.13.1/bin:$PATH" \
  pnpm --dir vendor/nexu-io--open-design tools-dev stop --namespace agents-local
```

### Boot log

| Step | Result | Duration |
|------|--------|----------|
| `pnpm install --frozen-lockfile` | Success — 24 workspace packages | 16s |
| `tools-dev start web` | daemon pid 41493, web pid 42893 | 5s |
| Browser open | Welcome screen rendered (dark mode) | 3s |
| CSS extraction via `getComputedStyle` | 50+ tokens captured | <1s |
| `tools-dev stop` | Clean shutdown via IPC | 1.5s |

## Extracted data

- **Computed CSS tokens**: `getComputedStyle(document.documentElement)` on the
  dark-mode running page — `--bg` (#1a1917), `--bg-panel` (#222120),
  `--text` (#e8e4dc), `--border` (#333128), `--accent` (#c96442), semantic
  colors, shadow scale, radii, motion, font stacks
- **Static design systems studied**: Linear, Mission Control, HUD, Cursor —
  `tokens.css`, `DESIGN.md`, `components.html`
- **OD web app primitives**: button/input/select patterns from
  `primitives.css`, panel chrome from `drawer.css` / `shell.css`

## Screenshots (4 PNGs)

- `01-entry-screen.png` — Open Design Welcome screen, dark mode, tab chrome
- `02-entry-light.png` — Entry screen after light theme switch (#faf9f7 canvas)
- `03-byok-panel.png` — Bring-your-own-key configuration panel (light mode)
- `04-dark-mode.png` — Dark mode via data-theme="dark" (#1a1917 canvas)

## Deliverables

| File | Status | Description |
|------|--------|-------------|
| `docs/state/scene-studio-design-language.md` | shipped | Full design language with Bret Victor framing, palette, typography, spacing, controls, interaction patterns, adaptation notes |
| `apps/scene-playground/src/ui/tokens.css` | shipped | `:root` CSS custom properties — dark, dense, monospace adaptation |
| `apps/scene-playground/src/ui/index.html` | wired | tokens.css linked in `<head>` |
| IRC `StudioEditor` | sent | One message with path + all token names |
| This report | shipped | 4 screenshots, front matter, boot commands |
