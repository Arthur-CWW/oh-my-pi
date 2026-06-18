# Pi Resources Inventory

Date: 2026-06-09

This explains what the skills/extensions in the current Pi startup list do and where they come from.

## How Pi loads these

Pi loads resources from:

- global settings: `~/.pi/agent/settings.json`
- project settings: `.pi/settings.json`
- auto-discovered global/project skill and extension directories
- package `pi` manifests

Current important settings:

```json
// ~/.pi/agent/settings.json
{
  "packages": [
    "/Users/arthur/agents/web-access/packages/web-access/src/codex-usage-status.ts",
    {
      "source": "/Users/arthur/agents/web-access",
      "extensions": ["packages/web-access/src/index.ts"],
      "prompts": [],
      "themes": []
    },
    "git:git@github.com:Arthur-CWW/pi-personal-core-skills@main"
  ]
}

// .pi/settings.json
{
  "packages": ["..", "npm:pi-dynamic-workflows"]
}
```

The broad global `agent-stuff` package used to be why skills like `anachb`, `oebb-scotty`, `apple-mail`, and `openscad` still appeared after this repo's project skill manifest was curated. On 2026-06-09, global settings were changed to remove that broad git package and install the private `git:git@github.com:Arthur-CWW/pi-personal-core-skills@main` package instead.

## Active startup skills

### Project-local / this repo

| Skill | What it does | Source path | Keep? |
|---|---|---|---|
| `background-browser-automation` | CuaDriver-first browser automation guidance plus CDP/Playwright/Puppeteer safety rules for protocol work without stealing focus. | `packages/web-access/skills/background-browser-automation` | Keep project/global core. |
| `librarian` | Open-source/library research with source-backed GitHub permalinks. | `packages/web-access/skills/librarian` | Keep. High usage. |
| `llm-frontend-browser` | ChatGPT/AI Studio/Grok frontend sessions through `llm_frontend_browser`. | `packages/web-access/skills/llm-frontend-browser` | Keep; async-first design still needs daemon/queue later. |
| `macos-computer-use` | Background-safe native macOS GUI loops with CuaDriver. | `packages/web-access/skills/macos-computer-use` | Keep for VoiceInk/macOS validation. |
| `rubber-duck-adversarial` | Cross-cutting critique/sanity-check mode. | `packages/web-access/skills/rubber-duck-adversarial` | Keep, if it does not over-trigger. |
| `source-archive` | Archive public articles/videos/transcripts into repo-local research docs. | `packages/web-access/skills/source-archive` | Keep for research-heavy workflows. |

### Former global `agent-stuff` skills

Source: formerly `git:github.com/mitsuhiko/agent-stuff`; a reference snapshot is now vendored at `vendor/mitsuhiko/agent-stuff`, and the globally installed core-skill package is the private repo `git:git@github.com:Arthur-CWW/pi-personal-core-skills@main`.

| Skill | What it does | Recommendation |
|---|---|---|
| `anachb` | Austrian VOR public transport: departures, stations/stops, routes, disruptions. | Personal/travel opt-in only; not global. |
| `apple-mail` | Search/read local Apple Mail storage and attachments. | Sensitive personal-data opt-in only. |
| `commit` | Commit workflow; read before making git commits. | Keep as global core; included in `pi-personal-core-skills`. |
| `frontend-design` | Distinctive frontend/UI design guidance. | Keep as global core; included in `pi-personal-core-skills`. |
| `ghidra` | Headless Ghidra reverse engineering. | Specialist opt-in only. |
| `github` | Use `gh` CLI for issues, PRs, runs, and API calls. | Keep as global core; included in `pi-personal-core-skills`. |
| `google-workspace` | Google Drive/Docs/Calendar/Gmail/Sheets/etc. via local helper scripts. | Useful but personal-data opt-in only. Prefer this over separate `gmcli`/`gdcli`/`gccli`. |
| `mermaid` | Mermaid chart creation/editing with validation. | Keep as global core; included in `pi-personal-core-skills`. |
| `native-web-search` | Trigger native web search with concise summaries and source URLs. | Optional; overlaps with `web_search`/research workflows. Not in the private core package. |
| `oebb-scotty` | Austrian ÖBB train planning/departures/disruptions. | Personal/travel opt-in only. |
| `openscad` | Create/render OpenSCAD models and export STL. | Specialist opt-in only. |
| `pi-share` | Parse pi-share/buildwithpi session URLs and transcripts. | Niche opt-in. Not in the private core package. |
| `sentry` | Fetch/analyze Sentry issues, events, transactions, logs. | Project-specific only when Sentry is configured. |
| `summarize` | Convert URL/local files to Markdown via `uvx markitdown`, optional summary. | Optional; overlaps with fetch/source-archive. Not in the private core package. |
| `tmux` | Remote-control tmux sessions by keystrokes and pane capture. | Keep as global core; included in `pi-personal-core-skills`. |
| `update-changelog` | Changelog update workflow. | Release-only manual skill; not global. |
| `uv` | Python `uv` workflows. | Keep as global core; included in `pi-personal-core-skills`. |
| `web-browser` | Visible Chrome/Chromium CDP browsing/clicking/screenshot workflow. | Optional; useful but should be subordinate to background-safe rules. Vendored as optional candidate. |

### Global `~/.agents/skills`

| Skill | What it does | Recommendation |
|---|---|---|
| `codex-system` | Hidden personal/system defaults: mac/Homebrew assumption, TS/Python/bash preferences, explanation style. | Keep hidden or migrate durable parts to global `AGENTS.md`/state docs. |
| `find-skills` | Uses the `npx skills` ecosystem search/install flow. | Keep only if actively installing external skills; otherwise manual. |
| `reflect` | Hidden writing/style reflection prompt. | Keep hidden/manual, not auto-invoked. |

### Project Codex plugin router skills

Loaded by `.pi/extensions/codex-plugin-manager/index.ts` from `vendor/openai/codex-plugin-router-skills` based on `~/.pi/agent/codex-plugin-manager.json`.

Current default enables:

| Skill | What it does | Recommendation |
|---|---|---|
| `codex-plugin-build-macos-apps` | Codex macOS app workflows: Xcode, SwiftUI, AppKit interop, logs, test/debug/instrumentation. | Keep opt-in/project-local; useful for VoiceInk. |
| `codex-plugin-build-ios-apps` | Codex iOS workflows: App Intents, SwiftUI, simulator/debug/perf/leaks. | Keep opt-in/project-local. |

Other vendored router skills available but should remain disabled unless needed:

| Skill | What it does | Recommendation |
|---|---|---|
| `codex-plugin-browser` | Codex in-app browser control for local pages/files. | Disabled; overlaps with browser tools. |
| `codex-plugin-computer-use` | Codex desktop computer-use workflows. | Disabled; CuaDriver path is preferred here. |
| `codex-plugin-creative-production` | Campaigns, images, mood boards, product placements, visual styles. | Maybe reference for future media workflows. |
| `codex-plugin-data-analytics` | Data quality, dashboards, KPI/report/notebook workflows. | Disabled unless data-analysis project. |
| `codex-plugin-fal` | Fal AI media workflows. | Reference for future KIE/Kier/Fal replacement design. |
| `codex-plugin-figma` | Figma design-to-code, variables, diagrams, components. | Disabled unless using Figma. |
| `codex-plugin-investment-banking` | M&A/valuation/pitch/deal workflows. | Disable. |
| `codex-plugin-product-design` | Product idea/prototype/audit/research workflows. | Possibly useful, but not default. |
| `codex-plugin-public-equity-investing` | Public equity research/modeling workflows. | Disable. |
| `codex-plugin-sales` | Sales meeting/account/deal/CRM workflows. | Disable. |

## Skills that used to appear but are no longer project-loaded

These came from `packages/web-access/skills/pi-skills -> ~/.pi/skills/pi-skills`. The broad project skill directory was narrowed, so they no longer appear in this repo startup unless loaded elsewhere.

Source repo: `Arthur-CWW/skills` fork of `badlogic/pi-skills` at `/Users/arthur/.pi/skills/pi-skills`.

| Skill | What it does | Recommendation |
|---|---|---|
| `brave-search` | Brave Search API web search/content extraction. | Do not load; this repo has `web_search`/`fetch_content`. |
| `browser-tools` | Interactive visible CDP browser automation. | Fold into one browser skill if needed. |
| `gccli` | Google Calendar CLI: list calendars/events, create/update events, availability. | Do not global-load; personal-data opt-in. |
| `gdcli` | Google Drive CLI: list/search/upload/download/share. | Do not global-load; personal-data opt-in. |
| `gmcli` | Gmail CLI: search/read/send/drafts/labels/attachments. | Do not global-load; personal-data opt-in. |
| `transcribe` | Groq Whisper transcription for audio files. | Media opt-in only. |
| `vscode` | VS Code file/diff helper. | Optional if VS Code is the chosen UI. |
| `youtube-transcript` | Fetch YouTube transcripts. | Usually use repo `youtube_transcript` tool/skill docs instead. |

## Active startup extensions

| Extension | What it does | Source | Keep? |
|---|---|---|---|
| `browser-automation-guard.ts` | Global safety extension: injects browser-background policy and blocks focus-stealing browser commands/code unless `AGENT_ALLOW_FOREGROUND_BROWSER=1`. | `~/.pi/agent/extensions/browser-automation-guard.ts` | Keep as a seatbelt; prefer CuaDriver or CDP background targets as the primary solution. |
| `codex-plugin-manager` | `/codex-plugins` UI; dynamically loads vendored Codex plugin router/direct skills. | `.pi/extensions/codex-plugin-manager/index.ts` | Track in repo if kept. |
| `codex-usage-status.ts` | TUI footer for Codex usage/model/context/cost info. | `packages/web-access/src/codex-usage-status.ts` via global package entry | Keep if useful; move out of `web-access` eventually. |
| `mermaid-preview/src` | Renders Mermaid diagrams in Pi messages as previews. | `packages/mermaid-preview/src/index.ts` | Keep; already separate package. |
| `pi-dynamic-workflows:workflow.ts` | Adds deterministic workflow/fan-out tool and prompt templates from `pi-dynamic-workflows`. | `.pi/npm/node_modules/pi-dynamic-workflows` | Keep until local vendored dynamic workflow replaces it. |
| `web-access/src` | Registers web search/content fetch/cookies/YouTube/CuaDriver/Codex session/frontend LLM/cockpit/vim-lite tools and commands. | `packages/web-access/src/index.ts` | Keep, but split later. |

## Recommended final startup shape

Default global skills have been shrunk to roughly:

- `commit`
- `uv`
- `tmux`
- `github`
- `mermaid`
- `frontend-design`
- hidden `codex-system` / `reflect` if still desired

Default project skills in this repo should stay:

- `background-browser-automation`
- `librarian`
- `llm-frontend-browser`
- `macos-computer-use`
- `rubber-duck-adversarial`
- `source-archive`

Everything else should be opt-in by project or explicit `/skill:name` path.
