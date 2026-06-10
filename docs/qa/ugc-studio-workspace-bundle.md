# UGC Studio Workspace Bundle QA

Date: 2026-06-10

Scope: Workspace Import/Export Bundle V1 for Slotok/UGC Studio.

## What Changed

- Added a local workspace bundle schema:
  - workspace summary
  - object counts
  - shard manifest
  - asset manifest paths
  - full local state payload
- Added local JSON store methods for:
  - exporting the current workspace bundle to `data/ugc-studio/workspaces/<workspace>/bundles/*.json`
  - validating a supplied bundle in dry-run mode
  - applying a supplied bundle only when `dryRun: false`
- Added daemon routes:
  - `POST /api/ugc/workspace/bundles/export`
  - `POST /api/ugc/workspace/bundles/import`
- Added a Developer Graph control to export the current workspace bundle from the UI.

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
- Vitest passed: 4 files, 8 tests.
- Production renderer and Electron build passed.
- Visual QA passed: 40/40 checks.

Generated fixture artifacts:

- `artifacts/ugc-studio-workspace-bundle/latest/workspace-bundle.json`
- `artifacts/ugc-studio-workspace-bundle/latest/import-validation.json`

Visual artifacts:

- `artifacts/slotok-visual-qa/latest/07-developer-graph.png`
- `docs/qa/slotok-visual-qa.md`

Persistence proof:

- `apps/slotok-workbench/src/daemon/ugc-json-store.test.ts` verifies bundle file creation, object counts, shard manifest paths, dry-run validation, and explicit import application.
- `apps/slotok-workbench/src/daemon/ugc-routes.test.ts` verifies daemon export and dry-run import validation routes.
