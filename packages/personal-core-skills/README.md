# Personal Core Skills

Curated Pi skills copied from external repositories so this repo can stop depending on broad global skill installs.

This package is **not loaded by the root Pi package today**. It is a candidate replacement for the noisy global `git:github.com/mitsuhiko/agent-stuff` package.

## Default skills in this package

These are the skills that should remain generally useful across repos:

| Skill | Purpose |
|---|---|
| `commit` | Read before making git commits; concise Conventional Commits-style commit workflow. |
| `uv` | Python `uv` workflows for deps, scripts, and one-off commands. |
| `tmux` | Drive tmux sessions by sending keystrokes and scraping pane output. |
| `github` | Use the `gh` CLI for issues, PRs, CI runs, and GitHub API calls. |
| `mermaid` | Create and validate Mermaid diagrams with a validation script. |
| `frontend-design` | Stronger frontend/UI design guidance for distinctive web interfaces. |

## Optional vendored candidates

`optional-skills/agent-stuff/` contains copied skills that may be useful, but should not be global by default because they overlap with this repo's own tools or require careful foreground/browser behavior:

| Skill | Why optional |
|---|---|
| `native-web-search` | Overlaps with `web_search` and research/source-archive workflows. |
| `summarize` | Useful for file/URL-to-Markdown, but overlaps with `fetch_content` and source archiving. |
| `web-browser` | Visible CDP browser automation; useful but should be subordinate to background-safe browser rules. |
| `pi-share` | Useful for parsing shared Pi sessions, but niche. |

## To try this package instead of global agent-stuff

Add it to user settings with a local source and remove or filter the broad `git:github.com/mitsuhiko/agent-stuff` entry:

```json
{
  "packages": [
    "/Users/arthur/projects/pi-web-access/packages/personal-core-skills"
  ]
}
```

Do not auto-load `optional-skills` until the specific skill is chosen.

## Source and license

See `SOURCE.md` and `LICENSE.agent-stuff`.
