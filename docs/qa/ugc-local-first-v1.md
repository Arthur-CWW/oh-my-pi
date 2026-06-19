# UGC Local-First V1 Proof Ledger

Date: 2026-06-19

Scope: current Slotok/UGC Studio V1 local-first proof ledger. This page summarizes the proof target; parent verification owns the actual gates for this phase.

## Product Lanes

Slotok V1 now treats two lanes as first-class local-first workflows:

- Brainrot creation: Pleometric-style short-form creative exploration, remixing, review, branching, and export.
- UGC Studio for ads: persona/profile-bible exploration, clean-room reference mechanics, provider jobs, batch review, final editing, and export manifests for ad production.

Both lanes use the same SQLite-canonical workspace ledger, provider job queue, branch/review mechanics, final-editor persistence, and proof gates.

## Canonical Local State

- SQLite is the canonical V1 workspace store at `data/ugc-studio/workspaces/<workspace_id>/workspace.sqlite`.
- JSON remains allowed only at explicit boundaries: workspace bundle import/export, backup/compatibility fixtures, and human-inspectable proof artifacts.
- The workspace must not rely on transient renderer state for personas, branches, candidates, notes, provider jobs, reference archives, exports, research targets, template mining jobs, or final-editor state.
- Preferred local reference catalog roots for the current phase are:
  - `data/tiktok-catalogue/pleometric`
  - `data/tiktok-catalogue/mynameissico`
- Missing reference catalog folders must degrade to an empty/local-fixture path; absence of those roots is not permission to call a live provider.

## Implemented / Previously Proved V1 Slices

Historical proof reports under `docs/qa/ugc-studio-*.md` and `docs/qa/slotok-v1-goal-proof.md` record these completed local-first slices:

- Open a local UGC workspace through the React route and daemon-backed `/api/ugc/*` routes.
- Create and edit persona profile-bible fields.
- Archive clean-room reference mechanics without scraping, cloning, or storing third-party source media.
- Export/import workspace bundles with dry-run validation and object/asset manifests.
- Create and inspect local provider job records.
- Review candidate batches with persistent verdicts and notes.
- Fork, mark, and roll back creative branches with visible decision logs.
- Persist final-editor layer/timeline edits and export manifests.
- Inspect a developer graph derived from local workspace state.

## Current Phase Proof Checklist

Use this checklist for the SQLite-canonical/current-scope validation after the code workers finish:

- [ ] Confirm `/api/ugc/workspace` reads the selected workspace from `workspace.sqlite`, with JSON only used for explicit bundle/import/export compatibility.
- [ ] Confirm persona edits persist through daemon routes, survive reload, and update SQLite-backed state.
- [ ] Confirm reference mechanics archives persist and reload, and reference catalog import paths can point at `data/tiktok-catalogue/pleometric` and `data/tiktok-catalogue/mynameissico`.
- [ ] Confirm workspace bundle export/import includes workspace, personas, branches, candidates, notes, provider jobs, reference archives, exports, final-editor state, research/template records, and asset manifest paths.
- [ ] Confirm provider jobs are visible as local records with request/response JSON, artifact paths, status, dry-run/live mode, and spend cap fields.
- [ ] Confirm Batch Review persists selected-set verdicts and note history.
- [ ] Confirm Campaign Branch Map supports fork, rollback/select-active, promising/dead-end status, and decision-log persistence.
- [ ] Confirm Final Layer Editor persists selected candidate, track visibility/lock state, clip timing/text/caption payloads, JSON diff preview, and export manifests.
- [ ] Confirm Developer Graph derives nodes/edges from actual local state and exposes selected-node raw JSON.

## Visual Dev Server Convention

Manual QA should use the already-running local servers when present:

- Renderer route: `http://127.0.0.1:47521/ugc-studio/`
- Daemon URL: `http://127.0.0.1:47522`
- PID files: `artifacts/slotok-dev/renderer.pid`, `artifacts/slotok-dev/daemon.pid`
- Logs: `artifacts/slotok-dev/renderer.log`, `artifacts/slotok-dev/daemon.log`

Do not inspect credentials/cookies while using the dev servers.

## Provider Policy

- Codex media analysis and KIE generation are dry-run-first.
- Live provider work requires an explicit live/capped action, local provider-job record, request/response persistence, and spend cap.
- This proof ledger does not claim KIE, Gemini, Jimeng, or Codex live provider execution for the current phase.

## Parent Validation Commands / Manual QA

Run from repo root unless noted:

```bash
bun run slotok:typecheck
bun run slotok:test
bun run slotok:build
cd apps/slotok-workbench && /Users/arthur/.bun/bin/bun scripts/visual-qa.ts
```

Manual QA:

1. Open `http://127.0.0.1:47521/ugc-studio/`.
2. Exercise the checklist above across Persona Atlas, Reference Archive, Batch Review, Campaign Branch Map, Final Layer Editor, Developer Graph, and KIE/Codex provider areas.
3. Reload after each write-heavy flow and confirm state comes back from the local daemon/SQLite path.
4. Check `artifacts/slotok-dev/*.log` only for server status/errors; do not inspect credentials or cookies.
