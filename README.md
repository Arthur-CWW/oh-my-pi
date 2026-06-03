# pi-workflows

Monorepo for Pi extensions, skills, and local-first AI workflows.

Current focus:

- `packages/web-access` — existing Pi web/search/fetch/YouTube/frontend-LLM tools.
- `packages/browser-use` — clean-room CDP browser-use extension prototype.
- `packages/twitter-archive` — planned local X/Twitter archive capture + normalization.
- `apps/tweet-viewer` — planned local searchable archive viewer.
- `workflows/*` — planned shortform-video archive, analysis, and generation pipelines.

## Pi project package

The repo root is now a Pi package. The local project setting `.pi/settings.json` points at `..`, so `pi` from this directory loads the root `pi` manifest and registers the web-access extension.

Quick checks:

```bash
pi --help
bun run typecheck
bun run test
```

## Structure

```txt
packages/
  web-access/        # Pi web access extension moved from repo root
  browser-use/       # CDP browser automation extension prototype
  twitter-archive/  # local archive model/capture package skeleton
apps/
  tweet-viewer/      # local archive browser/search UI skeleton
workflows/
  archive-pleometric/
  analyze-videos/
  generate-shortform/
docs/
  twitter-archive-plan.md
  browser-background-automation-howto.md
```

## Archive/workflow direction

The Twitter/X archive should stay local-first and respectful: low concurrency, jittered delays, request/entity cache, no private/locked content, and durable local storage under ignored `data/` or `artifacts/`.

For X/Twitter frontend capture, scope DOM inspection to the main content column/tweet component and search input only. Ignore sidebars, trends, DMs, ads, and unrelated navigation chrome.

See `docs/twitter-archive-plan.md` for the implementation plan.
