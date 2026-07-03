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
  - `cua-driver`
  - `rubber-duck-adversarial`
  - `source-archive`

This stops ignored local checkouts such as `chrome-devtools-mcp/` and symlinked `pi-skills/` from being accidentally pulled into the project skill list through the broad `./skills` directory entry.

## High-level recommendation

### Keep auto-loaded in this repo

These are directly tied to current repo tools/workflows and have enough reuse:

- `librarian` — source-backed open-source/library research.
- `llm-frontend-browser` — ChatGPT/AI Studio/Grok frontend sessions.
- `background-browser-automation` — background CDP/Playwright safety rules.
- `cua-driver` — CuaDriver background macOS UI loops (use the `computer_use` tool; raw `cua_driver` only for low-level/debug).
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

### Private design skill extraction

`T-2026-06-13-003` should produce a private, summarized design-review skill, not a committed copy of any protected design book. The source search starts on Arthur's machine, not in public shadow libraries:

- likely owned-source locations to check first: `~/Downloads/`, `~/Documents/`, `~/Desktop/`, `~/Library/Mobile Documents/`, `~/Library/CloudStorage/`, and Apple Books storage under `~/Library/Containers/com.apple.BKAgentService/Data/Documents/iBooks/Books/`
- supporting local design-skill references that are already skill-shaped: `vendor/mitsuhiko/agent-stuff/skills/frontend-design/SKILL.md` and the ignored local design-skill checkout under `tmp/open-design/skills/`
- do not use `packages/borges-library` or downloaded public-library copies as the basis for a private licensed-skill extraction

Extraction output should live outside this repo unless Arthur explicitly approves vendoring:

```txt
git@github.com:Arthur-CWW/pi-personal-core-skills.git
  skills/refactoring-ui-private/SKILL.md
  skills/refactoring-ui-private/checklists/design-review.md
```

If global availability is needed, make `~/.agents/skills/refactoring-ui-private` a symlink to that private repo checkout. This repo should only reference the private skill by name in worker briefs and workflow docs.

The extracted skill should summarize reusable heuristics in original wording:

- hierarchy and visual priority: size, weight, contrast, spacing, grouping, and affordance emphasis
- layout composition: spacing scale, alignment, density, empty-state shape, and responsive hierarchy
- component polish: borders, radius, shadows, icon/text balance, active states, and disabled/error treatments
- copy and data presentation: labels, numeric emphasis, table density, progressive disclosure, and scan paths
- anti-slop checklist: generic gradients, unmotivated decoration, weak contrast, inconsistent primitives, fake controls, and uninspected interaction states

Do not copy chapter text, screenshots, examples, tables, or proprietary phrasing. Keep any extraction notes under ignored `data/private-design-skills/refactoring-ui/` and redact source-page text from committed QA reports.

Next safe source-check command from `~/agents` records only metadata, not book text:

```bash
mkdir -p data/private-design-skills/refactoring-ui && python3 - <<'PY'
from pathlib import Path
import hashlib, json, time
roots = [Path.home() / p for p in [
    "Downloads",
    "Documents",
    "Desktop",
    "Library/Mobile Documents",
    "Library/CloudStorage",
    "Library/Containers/com.apple.BKAgentService/Data/Documents/iBooks/Books",
]]
rows = []
for root in roots:
    if not root.exists():
        continue
    for path in root.rglob("*"):
        name = path.name.lower()
        if path.is_file() and path.suffix.lower() in {".pdf", ".epub", ".mobi", ".azw3"} and "refactoring" in name and "ui" in name:
            h = hashlib.sha256()
            with path.open("rb") as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    h.update(chunk)
            st = path.stat()
            rows.append({
                "path": str(path),
                "bytes": st.st_size,
                "mtime": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(st.st_mtime)),
                "sha256": h.hexdigest(),
            })
out = Path("data/private-design-skills/refactoring-ui/source-candidates.json")
out.write_text(json.dumps(rows, indent=2) + "\n")
print(f"wrote {out} with {len(rows)} candidate(s)")
PY
```

`T-2026-06-13-004` should then split UI QA into reviewer personas that can be invoked independently from implementation workers:

1. visual hierarchy and composition reviewer
2. accessibility and keyboard reviewer
3. state/data wiring reviewer
4. performance and static-analysis reviewer
5. proof-artifact reviewer

Those personas are review lenses, not default blockers; the coordinator picks the lenses that match changed UI states and attaches their findings to the QA report.

## Inventory

| Skill | What it does | Source | Pi | Codex | Recommendation |
|---|---|---:|---:|---:|---|
| `a11y-debugging` | Chrome DevTools MCP accessibility audit workflow. | ignored local `chrome-devtools-mcp` checkout | 1 | 0 | Fold into browser/devtools reference; do not auto-load. |
| `agent-communication` | Simple cross-agent repo-state coordination log protocol. | former repo skill; deleted 2026-06-23 | 2 | 0 | Arthur chose deletion outright on 2026-06-23; no longer auto-loaded and not a repo skill. |
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
| `ghidra` | Ghidra headless binary reveng. | global `agent-stuff` | 1 | 0 | Specialist opt-in; not global. |
| `github` | `gh` CLI issue/PR/run/API workflows. | global `agent-stuff` | 1 | 0 | Keep global core despite low explicit loads; broadly useful. |
| `gmcli` | Gmail CLI. | symlinked `pi-skills` | 1 | 0 | Merge into opt-in personal Google Workspace skill. |
| `google-workspace` | Direct Google Workspace APIs helper. | global `agent-stuff` | 1 | 0 | Prefer this over separate gc/gd/gm skills; opt-in due personal data. |
| `librarian` | Evidence-backed OSS/library research with permalinks. | repo skill | 26 | 0 | Keep auto-loaded. High signal. |
| `llm-frontend-browser` | ChatGPT/AI Studio/frontend LLM browser automation. | repo skill | 14 | 1 | Keep, but improve async/non-blocking API. |
| `cua-driver` | CuaDriver background native macOS GUI automation. | repo skill | 1 | 0 | Keep for VoiceInk/macOS UI validation. |
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
  web-access/                         # currently published active extension/tool bundle; skills moved to repo root
    src/

 # repo root:
 skills/                               # repo-level global skill convention
  background-browser-automation/      # keep
  librarian/                          # keep
  llm-frontend-browser/               # keep
  cua-driver/                         # keep
  rubber-duck-adversarial/            # keep
  source-archive/                     # keep
  emusks-research/                    # opt-in local research skill for unofficial X API ecosystems

 # moved out to private repo: git@github.com:Arthur-CWW/pi-personal-core-skills.git
  commit/
  uv/
  tmux/
  github/
  mermaid/
  frontend-design/

 personal-data-skills/                 # opt-in only
  google-workspace/                   # includes Gmail/Drive/Calendar modes
  apple-mail/

 browser-skills/                       # optional future consolidation
  browser-automation/                 # includes CDP, visible browser, DevTools, a11y, LCP refs

 media-workflows/skills/               # future, if needed
  ai-media-generation/                # provider-neutral, not Dreamina-specific
```

## Resolved decisions

- 2026-06-23: Arthur chose deletion outright for `agent-communication`; the repo skill was removed and nothing was moved into `AGENTS.md` / `docs/coordination/agent-edit-log.md`.

## Open decisions

1. Should `used-hardware-buying-research` become its own personal package, or remain in this monorepo but disabled from auto-load?
2. Global settings have switched from broad `git:github.com/mitsuhiko/agent-stuff` to private `git:git@github.com:Arthur-CWW/pi-personal-core-skills@main`.
3. Should the ignored `chrome-devtools-mcp` checkout be removed from `packages/web-access/skills/` entirely and reintroduced only as a proper vendored package when needed?
4. Should the untracked `.pi/extensions/codex-plugin-manager/` be committed as the official way to opt into Codex plugin skills?
