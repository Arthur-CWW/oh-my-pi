# UGC Studio Reference Archive QA

Date: 2026-06-10

Scope: Reference Archive V1 for Slotok/UGC Studio.

## What Changed

- Reference archive records now include:
  - source policy
  - archive status
  - preserved mechanics JSON
  - sample clip IDs
  - swapped fields
  - blocked fields
  - clean-room guardrails
  - candidate format outputs
  - notes
- The local JSON store migrates older archive records on read by backfilling missing sample clip IDs and format outputs from the workspace reference profile.
- Daemon routes now support:
  - `GET /api/ugc/reference-archives`
  - `POST /api/ugc/reference-archives`
  - `POST /api/ugc/reference-archives/:id/delete`
- The React Reference Archive view now has a real editor for reference selection, source policy, archive status, mechanics JSON, swap/block/guardrail lists, notes, derived outputs, sample clips, save, delete, and local dry-run remix planning.

## Clean-Room Boundary

This slice does not scrape, download, clone, or store real third-party profile media. It only persists abstract reference mechanics and local fixture metadata already present in the workspace model.

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
- Vitest passed: 4 files, 7 tests.
- Production renderer and Electron build passed.
- Visual QA passed: 40/40 checks.

Visual artifacts:

- `artifacts/slotok-visual-qa/latest/05-reference-archive.png`
- `artifacts/ugc-studio-reference-archive/latest/reference-archive.png`
- `artifacts/ugc-studio-reference-archive/latest/video/*.webm`
- `docs/qa/slotok-visual-qa.md`

Persistence proof:

- `apps/slotok-workbench/src/daemon/ugc-json-store.test.ts` reloads archive records from disk and verifies the `reference-archives/*.json` shard contains candidate format outputs.
- `apps/slotok-workbench/src/daemon/ugc-routes.test.ts` verifies list, upsert, and delete behavior through the daemon route layer.
