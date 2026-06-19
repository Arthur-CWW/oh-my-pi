# Slotok Provider Pipeline Proof Ledger

Date: 2026-06-19

Scope: provider/media pipeline proof notes for the current Slotok UGC Studio phase: Codex live-gated media analysis, analysis-to-KIE dry-run planning, Higgsfield/Arcads reference-only asset ingestion, local dev server status, and manual visual QA.

This document is a proof ledger and parent QA checklist. It does not claim live provider success for KIE, Codex, Gemini, Jimeng, Higgsfield, or Arcads.

## Local Dev Surface

Use the running local workbench when present:

- Renderer: `http://127.0.0.1:47521/ugc-studio/`
- Daemon: `http://127.0.0.1:47522`
- Renderer PID: `artifacts/slotok-dev/renderer.pid`
- Daemon PID: `artifacts/slotok-dev/daemon.pid`
- Renderer log: `artifacts/slotok-dev/renderer.log`
- Daemon log: `artifacts/slotok-dev/daemon.log`

PID and log files are for local dev-server status only. Do not inspect credentials, cookies, provider account state, or unrelated private browser data during this QA pass.

## Provider Routes Under Proof

Current proof routes and expected policy:

| Flow | Route(s) | Expected proof behavior |
|---|---|---|
| Codex analysis plan | `POST /api/ugc/codex/plan` | Builds a local request plan and frame-preparation metadata without live provider spend. |
| Codex analysis job | `POST /api/ugc/codex/jobs`, `POST /api/ugc/codex/create`, `POST /api/ugc/codex/candidates/<candidate_id>/analyze-video` | Creates a local provider-job record in dry-run mode by default. Live mode is gated by explicit live intent, `maxSpendUsd`, API key, and reachable frame references. |
| Analysis-to-KIE plan | Planned route: `POST /api/ugc/kie/analysis-to-kie`; fallback proof path: existing `POST /api/ugc/kie/plan` with Codex/candidate context | Parent verifies this as a dry-run planner once the backend route lands. Until then, QA should prove the same invariant through existing KIE dry-run planning without submitting live generation. |
| KIE plan/create | `POST /api/ugc/kie/plan`, `POST /api/ugc/kie/create` | Plan is dry-run. Live create remains an explicit capped action and must persist a local provider-job record. |
| Reference manifest plan/import | `POST /api/ugc/reference-catalog/plan`, `POST /api/ugc/reference-catalog/import`; pending payload extension: `manifestPaths` | Parent verifies `manifestPaths` can include Higgsfield/Arcads manifests through the existing dry-run-first reference-catalog flow once the backend extension lands. Until then, QA should inspect the local manifests and existing reference-catalog behavior without pretending manifest import is complete. |
| Provider job ledger | `GET /api/ugc/provider-jobs`, `POST /api/ugc/provider-jobs`, `POST /api/ugc/provider-jobs/<job_id>` | Provider state remains inspectable as local records with status, mode, spend cap, target links, request/response JSON, and artifact paths. |

If a sibling route lands after this document is edited, parent QA should use the actual daemon route while preserving the same invariants: dry-run first, explicit live/capped gate, local provider-job persistence, and no unrecorded provider side effects. If the analysis-to-KIE route is still pending, do not fail the broader provider proof solely on route absence; verify that existing KIE dry-run planning can consume the selected candidate/Codex context without live generation.

## Codex Live-Gated Analysis Invariant

Codex media analysis has two separate proof states:

1. Dry-run planning/job creation: safe for routine proof. It prepares request JSON, frame metadata, artifact paths, target links, and a local provider job. No credential is required.
2. Live analysis: not routine proof. It must require explicit live intent, `maxSpendUsd`, an API key, and externally reachable frame references for video analysis. Local extracted frames are dry-run artifacts and must not be silently sent as live references.

This proof slice records the invariant only. It does not record a successful live Codex provider call.

## Analysis-to-KIE Dry-Run Planning Invariant

The analysis-to-KIE path should be treated as a planning bridge, not a provider shortcut:

- Input context comes from selected candidate state and/or persisted Codex provider-job request/response JSON.
- Output is a KIE request plan suitable for review in the provider workbench.
- Default mode is dry-run.
- Live KIE generation still requires the existing explicit live/capped action and a persisted provider-job record.
- If no Codex response exists yet, the UI should degrade to a plan using available candidate, reference, and provider-job metadata rather than pretending analysis succeeded.

## Reference-Only Asset Ingestion Invariant

Higgsfield and Arcads public assets are reference/inspiration material only unless a manifest explicitly grants reuse. Parent QA should use:

- `data/ugc-studio/reference-assets/higgsfield/manifest.json`
- `data/ugc-studio/reference-assets/arcads/manifest.json`

Expected behavior:

- The reference-catalog planner/importer reads manifest provenance, rights notes, local paths, source pages, blocked/failed asset entries, and media type metadata.
- Imported records are local reference/archive or research-target records, not provider inputs.
- Assets marked metadata-only, screenshot-evidence-only, blocked, failed, or not rights-cleared must not become generation inputs.
- Missing local asset files or absent manifest roots degrade to empty/error state that is visible in UI and logs without triggering live scraping/provider calls.

## Manual Visual QA Checklist

Parent should perform this exact manual checklist after backend/UI workers finish and before claiming the phase:

1. Open `http://127.0.0.1:47521/ugc-studio/` and confirm the workbench loads from daemon `http://127.0.0.1:47522`.
2. Confirm `artifacts/slotok-dev/renderer.pid` and `artifacts/slotok-dev/daemon.pid` identify the intended local dev servers; use `renderer.log` and `daemon.log` only for server status/errors.
3. In Batch Review, select a candidate with video preview metadata.
4. Trigger the Codex analysis dry-run action for the selected candidate.
5. Confirm a local `codex` provider job appears with mode `dry-run`, status `planned` or equivalent non-live status, target candidate linkage, request JSON, frame-preparation metadata, and artifact paths when frames were prepared.
6. Reload the workbench and confirm the Codex provider job still appears from local workspace state.
7. Open the provider/KIE workbench and select the Codex job or candidate context.
8. Trigger the analysis-to-KIE path through `POST /api/ugc/kie/analysis-to-kie` when present, or use the existing KIE dry-run plan UI/API with the selected Codex job or candidate context while that route is pending.
9. Confirm the analysis-to-KIE result is a dry-run KIE plan and does not submit live generation, poll a live task, or require provider credentials.
10. Confirm any live KIE control remains visibly capped and separate from dry-run planning.
11. Plan reference-catalog import with `manifestPaths` for the Higgsfield and Arcads manifests when the backend extension is present; while pending, inspect the local manifests and verify the UI/daemon does not treat them as direct generation inputs.
12. When a manifest import preview is available, confirm it distinguishes downloadable local reference assets from blocked, failed, metadata-only, or screenshot-evidence-only manifest entries.
13. Apply/import only when the manifest import extension is available and the UI clearly records provenance and rights notes; confirm imported entries are reference/archive or research records, not direct generation inputs.
14. Reload and confirm provider jobs and any imported reference records persist from the local workspace store.
15. Confirm no UI state claims successful live Codex, KIE, Gemini, Jimeng, Higgsfield, or Arcads provider execution unless the parent deliberately ran an explicit live/capped action and recorded that proof separately.

## Verification Status

No gates, formatters, package-manager commands, project-wide commands, visual QA automation, or live provider calls were run by this documentation-maintenance slice. Parent owns validation.