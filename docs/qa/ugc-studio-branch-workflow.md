# UGC Studio Branch Workflow QA

Date: 2026-06-10

Scope: Branch/Fork/Rollback Workflow V1 for Slotok/UGC Studio.

## What Changed

- Added a local branch creation input and store transaction for campaign forks.
- Added daemon route support for `POST /api/ugc/branches`.
- Linked forked branches back to their parent snapshot through `childIds`.
- Upgraded the Campaign Branch Map inspector with:
  - `Fork branch`
  - `Mark promising`
  - `Set active`
  - the existing dead-end marking action
  - a compact decision log of recent branch snapshots
- Kept branch operations local-first and JSON-backed.

## Proof

Commands run from repo root:

```bash
bun run slotok:typecheck
bun run slotok:test
bun run slotok:build
cd apps/slotok-workbench && bun run visual:qa
```

Results:

- TypeScript passed.
- Vitest passed: 4 files, 11 tests.
- Production renderer and Electron build passed.
- Visual QA passed: 40/40 checks.

Focused UI artifacts:

- `artifacts/ugc-studio-branch-workflow/latest/campaign-branch-map.png`
- `artifacts/ugc-studio-branch-workflow/latest/video/*.webm`

Visual QA artifacts:

- `artifacts/slotok-visual-qa/latest/04-campaign-map.png`
- `docs/qa/slotok-visual-qa.md`

Persistence proof:

- `apps/slotok-workbench/src/daemon/ugc-json-store.test.ts` verifies a fork is created and linked to its parent branch.
- `apps/slotok-workbench/src/daemon/ugc-routes.test.ts` verifies route-level branch creation.
