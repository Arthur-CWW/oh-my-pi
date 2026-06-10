# UGC Studio Research Queue QA

Date: 2026-06-10

Scope: Niche/Template Research Queue V1 for Slotok/UGC Studio.

## What Changed

- Added local-first research target records:
  - platform
  - niche
  - query
  - status
  - priority
  - source policy
  - notes
  - linked template jobs
- Added local-first template mining job records with clean-room template specs:
  - preserved abstract mechanics
  - swap slots
  - blocked fields
  - proof notes
  - candidate links
- Added daemon routes:
  - `GET /api/ugc/research-targets`
  - `POST /api/ugc/research-targets`
  - `POST /api/ugc/research-targets/:id`
  - `POST /api/ugc/template-mining-jobs`
  - `POST /api/ugc/template-mining-jobs/:id`
- Added queue/status UI inside Reference Archive.
- Added workspace bundle and shard coverage for research targets and template mining jobs.
- No live scraping or provider calls were added.

## Proof

Commands run from repo root:

```bash
bun run slotok:typecheck
bun run slotok:test
bun run slotok:build
cd apps/slotok-workbench && /Users/arthur/.bun/bin/bun scripts/visual-qa.ts
```

Results:

- TypeScript passed.
- Vitest passed: 4 files, 12 tests.
- Production renderer and Electron build passed.
- Visual QA passed: 40/40 checks.

Focused UI artifacts:

- `artifacts/ugc-studio-research-queue/latest/research-queue.png`
- `artifacts/ugc-studio-research-queue/latest/video/*.webm`

Visual QA artifacts:

- `artifacts/slotok-visual-qa/latest/05-reference-archive.png`
- `docs/qa/slotok-visual-qa.md`

Persistence proof:

- `apps/slotok-workbench/src/daemon/ugc-json-store.test.ts` verifies research targets, template mining jobs, template-job linking, shard writes, and bundle manifest inclusion.
- `apps/slotok-workbench/src/daemon/ugc-routes.test.ts` verifies route-level create/patch behavior for both research targets and template jobs.
