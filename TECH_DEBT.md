# Tech Debt

Last updated: 2026-06-09

This is the short, top-level scratchpad for repo/workflow cleanup. Keep details in `docs/plans/*` when they need more analysis.

## Skills / Pi resource loading

- The project skill list is now curated in `package.json` and `packages/web-access/package.json`, but Pi still loads many **global** skills from `~/.pi/agent/git/github.com/mitsuhiko/agent-stuff/skills` and `~/.agents/skills`.
  - Examples still visible globally: `anachb`, `apple-mail`, `oebb-scotty`, `openscad`, `sentry`, `web-browser`, `native-web-search`, etc.
  - Decide whether to move these into a curated personal package, mark niche ones `disable-model-invocation: true`, or remove them from global discovery.
- The old symlinked `packages/web-access/skills/pi-skills -> ~/.pi/skills/pi-skills` and ignored `chrome-devtools-mcp/` checkout should not live under a package skill directory long term.
- Consolidate overlapping skill families:
  - browser: `background-browser-automation`, `browser-tools`, `web-browser`, `chrome-devtools`, `a11y-debugging`, `debug-optimize-lcp`
  - research: `librarian`, `native-web-search`, `brave-search`, `summarize`, `youtube-transcript`, `source-archive`
  - personal data: `gmcli`, `gdcli`, `gccli`, `google-workspace`, `apple-mail`
- Decide whether to delete `agent-communication` or move the useful coordination protocol into `AGENTS.md` / `docs/coordination/agent-edit-log.md`.
- See `docs/plans/skill-inventory-and-rationalization.md` for the full inventory and usage scan.

## Package / folder organization

- `packages/web-access` is doing too much: web search, fetch, cookies, YouTube, Codex session import, frontend LLM browser, vim-lite, cockpit, and assorted skills.
- The repo name/package naming is misleading: this is now closer to `pi-workflows` / personal Pi platform tooling than just web access.
- Consider splitting when stable:
  - `packages/web-access` — web search/fetch/cookies/transcripts only
  - `packages/frontend-llm-browser` — ChatGPT/AI Studio/Grok browser automation
  - `packages/pi-editor-tools` — `vim-lite`
  - `packages/pi-cockpit` — agent cockpit/session registry
  - `packages/computer-use` — CuaDriver wrapper + macOS UI skills
  - `packages/personal-core-skills` — commit/uv/tmux/github/etc.

## Codex plugin import

- `.pi/extensions/codex-plugin-manager/` is untracked. Decide whether to commit it as the official opt-in UI for vendored Codex plugin skills.
- Keep Codex plugin skills opt-in; do not make all router skills global. macOS/iOS app skills are useful, finance/sales/etc. should be enabled only per project.

## AltTab quality-of-life

- AltTab preferences are stored in macOS defaults, not a plain repo JSON file:
  - domain: `com.lwouis.alt-tab-macos`
  - plist: `~/Library/Preferences/com.lwouis.alt-tab-macos.plist`
  - key: `exceptions` is a JSON string.
- Current `exceptions` already hide/ignore several apps. To hide another app from AltTab, add an entry like:

```json
{"bundleIdentifier":"com.example.App","hide":"1","ignore":"0"}
```

- Need decide which app/window should be hidden (CuaDriver? Ghostty/Pi? automation browser? another app) before editing the defaults value.
