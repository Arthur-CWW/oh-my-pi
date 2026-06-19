# Slotok Analysis Results UI QA

Date: 2026-06-19

Scope: selected-candidate analysis-results UI for Slotok's two primary lanes — Pleometric-style brainrot creation and UGC Studio ads — plus local Codex media-analysis dry runs, provider-job artifact inspection, and current V1 dry-run/live-cap policy.

## Preconditions

- Start or reuse the Slotok workbench renderer at `http://127.0.0.1:47521/ugc-studio/`.
- Reuse the local daemon at `http://127.0.0.1:47522`.
- Dev server PID/log convention:
  - `artifacts/slotok-dev/renderer.pid`
  - `artifacts/slotok-dev/daemon.pid`
  - `artifacts/slotok-dev/renderer.log`
  - `artifacts/slotok-dev/daemon.log`
- Keep provider analysis in dry-run mode. Do not trigger live provider calls.
- Preferred local reference roots for richer candidate/reference context are `data/tiktok-catalogue/pleometric` and `data/tiktok-catalogue/mynameissico`; the flow must still work when either folder is absent.

## Manual Flow

1. Open Batch Review and select a candidate from the queue or thumbnail strip.
2. Confirm the central artifact remains the selected vertical candidate preview and the inspector reflects that candidate.
3. Trigger the Codex analyze dry-run action for the selected candidate.
4. Confirm a local provider job is created for Codex media analysis with dry-run mode and no live spend.
5. Select the created job in the local provider/results area.
6. Confirm the job detail shows:
   - provider/job identity and status,
   - selected candidate linkage,
   - request payload JSON,
   - `request.framePreparation` metadata for prepared frames,
   - `artifactPaths` for local frame/output references,
   - `response: null` for the dry-run job until a real response is explicitly recorded,
   - error JSON only when present.
7. Reload the workbench and confirm the provider job still appears from the local workspace store.

## Contract Checks

- PASS when dry-run Codex analysis creates only local provider-job state; no credentials are required.
- PASS when missing `data/tiktok-catalogue/pleometric` or `data/tiktok-catalogue/mynameissico` media does not break selected-candidate analysis.
- PASS when frame/artifact entries are references to local prepared assets, not embedded raw HTML or remote-only state.
- PASS when provider-job request details are inspectable as JSON from the UI.
- PASS when a live KIE or Codex path is unavailable unless the user chooses an explicit live/capped action.
- FAIL if the UI performs a live provider request without an explicit live/capped action and local provider-job record.
- FAIL if analysis results are represented only as transient renderer state and do not survive reload through the local workspace store.

## Current Phase Proof Checklist

- [ ] Confirm Codex dry-run job records persist in the SQLite-canonical workspace store after the current backend/data slice lands.
- [ ] Confirm request/response/artifact JSON remains viewable from the provider job detail after reload.
- [ ] Confirm no KIE, Gemini, Jimeng, or Codex live spend occurs during this QA pass.
- [ ] Confirm dev-server logs under `artifacts/slotok-dev/` show only server status/errors needed for QA.

## Focused Test Coverage

No renderer helper test was added in this slice because the Codex frame/artifact extraction helper is not exported as a public pure helper from the UI module. The QA contract therefore stays at the manual flow/status level and avoids broad snapshots or full raw HTML rendering.

## Verification Status

No gates, formatters, provider calls, project-wide commands, or visual QA runs were executed by this documentation-maintenance slice.
