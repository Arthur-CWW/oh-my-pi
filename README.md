# pi-workflows

Monorepo for Pi extensions, skills, and local-first AI workflows.

Current focus:

- `packages/web-access` — existing Pi web/search/fetch/YouTube/frontend-LLM tools.
- `packages/dynamic-workflows` — vendored `pi-dynamic-workflows` source/tests plus adversarial-review prompt template; the released npm package is installed project-locally for the active workflow tool.
- `packages/browser-use` — clean-room CDP browser-use extension prototype.
- `packages/twitter-archive` — planned local X/Twitter archive capture + normalization.
- `packages/jimeng-client` — Jimeng/Dreamina direct API helpers ported from Slotok reverse engineering.
- `apps/tweet-viewer` — planned local searchable archive viewer.
- `workflows/*` — planned shortform-video archive, analysis, and generation pipelines.

## Pi project package

The repo root is now a Pi package. The local project setting `.pi/settings.json` points at `..` and `npm:pi-dynamic-workflows`, so `pi` from this directory loads the root `pi` manifest plus the released workflow extension.

Quick checks:

```bash
pi --help
bun run lint
bun run typecheck
bun run test
```

## Structure

```txt
packages/
  web-access/        # Pi web access extension moved from repo root
  dynamic-workflows/ # vendored workflow source/tests and adversarial-review prompt
  browser-use/       # CDP browser automation extension prototype
  twitter-archive/  # local archive model/capture package skeleton
  jimeng-client/    # Jimeng direct client helpers
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

## Jimeng quick review from repo root

Useful root commands:

```bash
# Start the SQLite-backed artifact/packet dashboard
bun run jimeng:dashboard

# Inspect packet queue state
bun run jimeng:packet:next
bun run jimeng:packet:get -- --id lip-sync-human

# Re-materialize keep-family coverage into ignored review artifacts
bun run jimeng:coverage

# Run Jimeng package validation
bun run jimeng:test
bun run jimeng:typecheck

# Direct CLIs from the repo root
bun run jimeng:browser-proxy -- --help
bun run jimeng:dreamina -- --help
bun run jimeng:artifacts -- --help
```

Main review surfaces:

- Dashboard: `http://127.0.0.1:4188/`
- Packet/status ledger: `data/jimeng-lab/artifact-log.sqlite`
- Current completion audit coverage: `data/jimeng-lab/completion-audit-keep-coverage-v3/normalized/triage-coverage-20260613175434-summary.json`
- Main QA/proof note: `docs/qa/jimeng-live-effect-generation-20260613.md`
- Current triage/blocked-next-work note: `docs/provider/jimeng-api-triage.md`

Useful proof artifacts:

- Browser-backed text2image success report:
  - `data/jimeng-lab/proof-20260613-goal-text2image-cdp-ui/report/index.html`
  - `data/jimeng-lab/proof-20260613-goal-text2image-cdp-ui/report/functions/text2image-image.html`
- Current lip-sync blocker screenshot:
  - `data/jimeng-lab/packet-20260613-lip-sync-human-unblock/lip-sync-generic-composer-blocker.png`

Current status:

- `gen-parity`, `persona-voice`, `reference-controls`, `template-mining`: done
- `lip-sync-human`: blocked on locating/capturing the real lip-sync/digital-human workbench state; current `?type=lip_sync` route still renders a generic composer

The Slotok `reverse-jimeng` direct API notes/client were brought over into `packages/jimeng-client` plus `docs/provider/jimeng-direct-client-endpoints.md`.
