# UGC Studio Provider Jobs QA

Date: 2026-06-10

Scope: Provider Job Queue V1 for Slotok/UGC Studio.

## What Changed

- Provider jobs now support visible queue states:
  - `planned`
  - `queued`
  - `running`
  - `succeeded`
  - `failed`
  - `blocked`
  - legacy `completed`
- Added a local provider job patch path for status, cached response, artifact paths, and error text.
- Added daemon route support for `POST /api/ugc/provider-jobs/:id`.
- Reworked the KIE Proxy view into a local provider job queue with:
  - job list
  - selected job detail
  - status transition buttons
  - artifact references
  - cached request/response JSON
  - KIE task polling button when a cached task id is available
- Live generation remains explicit and capped at `$0.05`.

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
- Vitest passed: 4 files, 9 tests.
- Production renderer and Electron build passed.
- Visual QA passed: 40/40 checks.

Focused UI artifacts:

- `artifacts/ugc-studio-provider-jobs/latest/provider-jobs.png`
- `artifacts/ugc-studio-provider-jobs/latest/video/*.webm`

Visual QA artifacts:

- `artifacts/slotok-visual-qa/latest/08-kie-proxy.png`
- `docs/qa/slotok-visual-qa.md`

Persistence proof:

- `apps/slotok-workbench/src/daemon/ugc-json-store.test.ts` verifies provider job status, response, artifact, and error patching.
- `apps/slotok-workbench/src/daemon/ugc-routes.test.ts` verifies provider job creation and route-level patching.
