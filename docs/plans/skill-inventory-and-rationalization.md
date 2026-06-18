# Skill Inventory and Rationalization

Date: 2026-06-09

## Why this exists

The current skill surface has grown from several sources: this repo, Pi skills, Mitsuhiko's `agent-stuff`, local `~/.agents`, ignored local checkouts, and vendored OpenAI Codex plugins. The result is too many globally-visible skills, overlapping browser/search/mail workflows, and some stale tool-specific prompts.

Goal: keep the default skill list small, vendor or package skills that are genuinely useful, and make niche/personal/domain skills explicit opt-ins.

## Usage signal used here

I scanned Pi and Codex session files for explicit `SKILL.md` loads or `/skill:name` invocations. This is a conservative signal: it misses cases where a skill was useful from just its description, but it avoids counting every skill merely because it appeared in a system prompt.

Columns below:

- `Pi` / `Codex`: number of session files with explicit skill loads.
- `Recommendation`: what to do with the skill in this repo / global setup.

## Immediate cleanup already applied

- Removed `packages/web-access/skills/dreamina-cli/`.
- Changed root `package.json` and `packages/web-access/package.json` so the web-access package only auto-loads the curated core skills:
  - `background-browser-automation`
  - `librarian`
  - `llm-frontend-browser`
  - `macos-computer-use`
  - `rubber-duck-adversarial`
  - `source-archive`

This stops ignored local checkouts such as `chrome-devtools-mcp/` and symlinked `pi-skills/` from being accidentally pulled into the project skill list through the broad `./skills` directory entry.

## High-level recommendation

### Keep auto-loaded in this repo

These are directly tied to current repo tools/workflows and have enough reuse:

- `librarian` — source-backed open-source/library research.
- `llm-frontend-browser` — ChatGPT/AI Studio/Grok frontend sessions.
- `background-browser-automation` — background CDP/Playwright safety rules.
- `macos-computer-use` — CuaDriver background macOS UI loops.
- `source-archive` — archive source material into repo-local research docs.
- `rubber-duck-adversarial` — critique/sanity-check mode.

### Keep globally, but ideally in a small personal core-skills package

These are generally useful across repos and should not live as random global checkouts forever. They now live in the private repo `git:git@github.com:Arthur-CWW/pi-personal-core-skills@main`, whose package root has a top-level `skills/` directory:

- `commit`
- `uv`
- `tmux`
- `github`
- `mermaid`
- `frontend-design`

Optional copied candidates in that package, not default-loaded:

- `native-web-search`
- `summarize`
- `web-browser`
- `pi-share`

### Make opt-in / project-specific

Useful, but noisy if global:

- Google/Gmail/Drive/Calendar/Apple Mail skills.
- Austrian transport skills.
- Sentry, Ghidra, OpenSCAD.
- Used-hardware buying research.
- `emusks-research` and similar unofficial/private API research skills — local opt-in only, never auto-loaded.
- Codex plugin router skills except in projects that need them.

### Consolidate overlapping skill families

1. **Browser family**: `background-browser-automation`, `browser-tools`, `web-browser`, `chrome-devtools`, `a11y-debugging`, `debug-optimize-lcp` should become one stronger `browser-automation` skill with modes:
   - static fetch/search first
   - background CDP target
   - headed visible browser only when explicitly allowed
   - DevTools/a11y/perf references as sub-sections or references
2. **Research family**: `librarian`, `native-web-search`, `brave-search`, `summarize`, `youtube-transcript`, `source-archive` should become one research/source workflow, with `librarian` kept as the code-source submode.
3. **Workspace/personal data family**: `gmcli`, `gdcli`, `gccli`, `google-workspace`, `apple-mail` should become one opt-in personal-data skill, disabled by default.
4. **Media generation family**: removed Dreamina-specific skill. If needed later, create a provider-neutral `ai-media-generation` skill in `packages/ugc-cli` or a media package, not in web-access.

## Inventory

| Skill | What it does | Source | Pi | Codex | Recommendation |
|---|---|---:|---:|---:|---|
| `a11y-debugging` | Chrome DevTools MCP accessibility audit workflow. | ignored local `chrome-devtools-mcp` checkout | 1 | 0 | Fold into browser/devtools reference; do not auto-load. |
| `agent-communication` | Simple cross-agent repo-state coordination log protocol. | repo skill | 2 | 0 | Retire as a skill; keep protocol in `AGENTS.md`/docs if still wanted. |
| `anachb` | Austrian VOR public-transport queries. | global `agent-stuff` | 0 | 0 | Personal/travel opt-in only. |
| `apple-mail` | Search/read local Apple Mail and attachments. | global `agent-stuff` | 0 | 0 | Sensitive personal-data opt-in; not global. |
| `background-browser-automation` | Background-safe Playwright/Puppeteer/CDP rules. | repo skill | 13 | 1 | Keep as canonical browser safety skill. |
| `brave-search` | Brave Search CLI/API workflow. | symlinked `pi-skills` | 6 | 0 | Replace with repo `web_search`/research skill; do not auto-load. |
| `browser-tools` | Visible/interactive browser automation via CDP. | symlinked `pi-skills` | 9 | 2 | Fold into browser skill; visible browser only opt-in. |
| `chrome-devtools` | Chrome DevTools MCP debugging/automation. | ignored local `chrome-devtools-mcp` checkout | 4 | 0 | Keep as explicit MCP reference, not default skill. |
| `codex-plugin-build-ios-apps` | OpenAI Codex iOS app build/debug workflows. | vendored OpenAI router skill | 0 | 0 | Enable via Codex plugin manager only in iOS projects. |
| `codex-plugin-build-macos-apps` | OpenAI Codex macOS app build/debug workflows. | vendored OpenAI router skill | 1 | 0 | Useful for VoiceInk/macOS projects; plugin-manager opt-in. |
| `codex-system` | Personal style/platform defaults; hidden from model invocation. | global `~/.agents` | 1 | 0 | Keep hidden/manual, or move to global AGENTS preferences. |
| `commit` | Conventional commit workflow. | global `agent-stuff` | 21 | 0 | Keep global core; maybe vendor into personal core package. |
| `debug-optimize-lcp` | DevTools MCP LCP/Core Web Vitals workflow. | ignored local `chrome-devtools-mcp` checkout | 1 | 0 | Fold into browser/perf reference; not default. |
| `dreamina-cli` | Dreamina-specific image/video CLI prompt. | repo skill | 3 | 0 | Removed. Recreate later as provider-neutral media skill if needed. |
| `emusks-research` | Local opt-in research skill for unofficial/private X APIs & scraper compliance. | repo local `skills/` | 0 | 0 | Local opt-in only; niche research, not default loaded. |
| `find-skills` | Find/install skills. | global `~/.agents` | 1 | 0 | Keep manual/global if actively installing skills; otherwise disable. |
| `frontend-design` | Distinctive frontend UI design guidance. | global `agent-stuff` | 4 | 0 | Keep global or vendor into frontend package; useful. |
| `gccli` | Google Calendar CLI. | symlinked `pi-skills` | 0 | 0 | Merge into opt-in personal Google Workspace skill. |
| `gdcli` | Google Drive CLI. | symlinked `pi-skills` | 0 | 0 | Merge into opt-in personal Google Workspace skill. |
| `ghidra` | Ghidra headless binary reverse engineering. | global `agent-stuff` | 1 | 0 | Specialist opt-in; not global. |
| `github` | `gh` CLI issue/PR/run/API workflows. | global `agent-stuff` | 1 | 0 | Keep global core despite low explicit loads; broadly useful. |
| `gmcli` | Gmail CLI. | symlinked `pi-skills` | 1 | 0 | Merge into opt-in personal Google Workspace skill. |
| `google-workspace` | Direct Google Workspace APIs helper. | global `agent-stuff` | 1 | 0 | Prefer this over separate gc/gd/gm skills; opt-in due personal data. |
| `librarian` | Evidence-backed OSS/library research with permalinks. | repo skill | 26 | 0 | Keep auto-loaded. High signal. |
| `llm-frontend-browser` | ChatGPT/AI Studio/frontend LLM browser automation. | repo skill | 14 | 1 | Keep, but improve async/non-blocking API. |
| `macos-computer-use` | CuaDriver background native macOS GUI automation. | repo skill | 1 | 0 | Keep for VoiceInk/macOS UI validation. |
| `mermaid` | Mermaid chart authoring/validation. | global `agent-stuff` | 2 | 0 | Keep global core or move to docs/diagram package. |
| `native-web-search` | Native web search trigger. | global `agent-stuff` | 9 | 0 | Consolidate with research skill; avoid duplicate search skills. |
| `oebb-scotty` | Austrian ÖBB train planner. | global `agent-stuff` | 0 | 0 | Personal/travel opt-in only. |
| `openscad` | OpenSCAD modeling/rendering. | global `agent-stuff` | 0 | 0 | Specialist opt-in only. |
| `pi-share` | Parse pi-share session URLs/transcripts. | global `agent-stuff` | 0 | 0 | Pi-dev opt-in; maybe useful, not global. |
| `reflect` | Hidden writing/style reflection prompt. | global `~/.agents` | 1 | 0 | Keep hidden/manual, not auto-invoked. |
| `rubber-duck-adversarial` | Cross-cutting critique/sanity-check mode. | repo skill | 1 | 0 | Keep; useful if description is sharp enough not to over-trigger. |
| `sentry` | Fetch/analyze Sentry issues/events/logs. | global `agent-stuff` | 0 | 0 | Project-specific when a repo has Sentry configured. |
| `source-archive` | Archive original public sources into repo research docs. | repo skill | 4 | 0 | Keep for research-heavy repo workflows. |
| `summarize` | URL/local-file to Markdown via `markitdown`. | global `agent-stuff` | 2 | 0 | Consolidate into research/source skill. |
| `tmux` | Control tmux panes for interactive CLIs. | global `agent-stuff` | 14 | 0 | Keep global core; useful operational skill. |
| `transcribe` | Groq Whisper transcription. | symlinked `pi-skills` | 2 | 0 | Media opt-in; not web-access default. |
| `update-changelog` | Changelog update rules. | global `agent-stuff` | 0 | 0 | Manual/release-only; not global. |
| `used-hardware-buying-research` | Used/refurb hardware buying research workflow. | repo skill | 1 | 0 | Move to personal/domain package; not web-access default. |
| `uv` | Python `uv` workflows. | global `agent-stuff` | 13 | 0 | Keep global core. |
| `vscode` | VS Code diff/view integration. | symlinked `pi-skills` | 0 | 0 | Not default; use only if VS Code is the chosen UI. |
| `web-browser` | CDP web-page interaction via Chrome/Chromium. | global `agent-stuff` | 13 | 0 | Consolidate with browser skill; avoid duplicate browser instructions. |
| `youtube-transcript` | Fetch YouTube transcripts. | symlinked `pi-skills` | 4 | 0 | Consolidate with research/source skill or keep as tool docs only. |

## Proposed skill package layout

```txt
packages/
  web-access/skills/
    background-browser-automation/    # keep
    librarian/                        # keep
    llm-frontend-browser/             # keep
    macos-computer-use/               # keep
    rubber-duck-adversarial/          # keep
    source-archive/                   # keep

  # moved out to private repo: git@github.com:Arthur-CWW/pi-personal-core-skills.git
  # repo root:
  skills/
    emusks-research/                  # opt-in local research skill for unofficial X API ecosystems
    commit/
    uv/
    tmux/
    github/
    mermaid/
    frontend-design/

  personal-data-skills/               # opt-in only
    google-workspace/                 # includes Gmail/Drive/Calendar modes
    apple-mail/

  browser-skills/                     # optional future consolidation
    browser-automation/               # includes CDP, visible browser, DevTools, a11y, LCP refs

  media-workflows/skills/             # future, if needed
    ai-media-generation/              # provider-neutral, not Dreamina-specific
```

## Open decisions

1. Should `agent-communication` be deleted outright, or should its useful parts move into `AGENTS.md` / `docs/coordination/agent-edit-log.md` and then delete the skill?
2. Should `used-hardware-buying-research` become its own personal package, or remain in this monorepo but disabled from auto-load?
3. Global settings have switched from broad `git:github.com/mitsuhiko/agent-stuff` to private `git:git@github.com:Arthur-CWW/pi-personal-core-skills@main`.
4. Should the ignored `chrome-devtools-mcp` checkout be removed from `packages/web-access/skills/` entirely and reintroduced only as a proper vendored package when needed?
5. Should the untracked `.pi/extensions/codex-plugin-manager/` be committed as the official way to opt into Codex plugin skills?
