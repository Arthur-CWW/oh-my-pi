# UGC Studio Developer Graph QA

Date: 2026-06-10

Scope: Developer Graph From Real State V1 for Slotok/UGC Studio.

## What Changed

- Added a pure graph derivation module for local UGC state:
  - product brief
  - personas
  - reference archives
  - branch snapshots
  - candidates
  - provider jobs
  - export manifests
  - research targets
  - template mining jobs
- Derived graph edges for:
  - brief to persona lanes
  - persona/reference to candidates
  - branch forks and selected candidates
  - provider job targets
  - candidate exports
  - research target to template mining jobs
  - template output to candidates
- Rebuilt the Developer Graph view as a grouped node browser.
- Added selected-node raw JSON, connected-edge list, input/output/artifact counts, and workspace bundle export.

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
- Vitest passed: 5 files, 13 tests.
- Production renderer and Electron build passed.
- Visual QA passed: 40/40 checks.

Focused UI artifacts:

- `artifacts/ugc-studio-developer-graph/latest/developer-graph.png`
- `artifacts/ugc-studio-developer-graph/latest/video/*.webm`

Visual QA artifacts:

- `artifacts/slotok-visual-qa/latest/07-developer-graph.png`
- `docs/qa/slotok-visual-qa.md`

Persistence/derivation proof:

- `apps/slotok-workbench/src/ugc/developer-graph.test.ts` verifies provider-job, export, research-target, and template-output edges are derived from real local workspace state.
