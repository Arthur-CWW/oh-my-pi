# Slotok Gold Doc

This is the project source-of-truth for continuing Slotok and UGC Studio implementation. Read this before editing Slotok UI, daemon, local state, provider-job, or UGC workflow code.

## Product Thesis

Slotok is a local-first AI video and UGC workbench.

It is not a simple ad generator. It is closer to:

```txt
Cursor/Zed for AI TikTok, UGC, video-understanding, provider jobs, and infinite creative remixing.
```

Primary product lanes:

- Brainrot creation: Pleometric-style short-form idea generation, remixing, batch review, branch exploration, final editing, and export.
- UGC Studio for ads: persona/profile-bible exploration, clean-room reference mechanics, ad candidate batches, provider jobs, final editing, and export manifests.

Both lanes share Slotok's local SQLite workspace ledger, provider job queue, branch/review model, developer graph, and proof discipline.

Slotok owns the creative and media pipeline:

- product and niche briefs
- reference profiles and abstract format mechanics
- synthetic personas and profile bibles
- generated candidates, batches, and review decisions
- branch snapshots, forks, notes, dead ends, and metrics
- provider requests, responses, artifacts, spend caps, and retries
- final layer/timeline editing and export manifests
- developer/provider graph inspection

Symphony Lite or future agent orchestration may operate Slotok, but Slotok is the product/workbench surface and the local creative database.

## Current Maintained Surface

Primary route:

```txt
http://127.0.0.1:47521/ugc-studio/
```

Local daemon:

```txt
http://127.0.0.1:47522
```

Dev server PID/log convention:

```txt
artifacts/slotok-dev/renderer.pid
artifacts/slotok-dev/daemon.pid
artifacts/slotok-dev/renderer.log
artifacts/slotok-dev/daemon.log
```

Main app:

```txt
apps/slotok-workbench/
```

The maintained UGC Studio stack is:

- React
- Tailwind
- owned shadcn-style primitives
- owned workbench design-system components
- Electron shell plus local Bun daemon

Do not reintroduce a parallel Solid UGC Studio surface. React/shadcn/Tailwind is the current maintained path.

## Non-Negotiables

### Local-first

Every important creative object must be locally persisted first. Network and provider calls are explicit jobs, not invisible app state.

Current local data root:

```txt
data/ugc-studio/workspaces/<workspace_id>/
```

Canonical workspace database:

```txt
data/ugc-studio/workspaces/<workspace_id>/workspace.sqlite
```

SQLite is canonical for the V1 workspace ledger. JSON is retained only for bundle import/export, backups, compatibility fixtures, and inspectable proof artifacts.

Current object families:

- workspace
- personas
- campaigns
- branches
- candidates
- notes
- provider jobs
- reference archives
- export manifests
- final editor state
- research targets
- template mining jobs
- assets
- workflow runs
- workflow events

### Agent-directed creative search

The main workflow is:

```txt
brief -> generate many directions -> review quickly -> annotate -> fork -> revise -> select winners -> polish/export
```

The user directs one agent to generate, critique, fork, and revise selected sets. Manual editing exists, but the product should not assume users want to hand-edit every attribute up front.

### Whole profile, not one clip

A UGC persona is a TikTok-profile-like collection:

- appearance and genre lane
- voice, accent, energy, speaking style
- interests, niche, mannerisms, posting cadence
- sample clips
- non-CTA posts for persona building
- CTA/conversion posts
- continuity JSON
- branch and candidate history

### Clean-room reference remix

Reference-profile workflows should preserve abstract mechanics and swap identity/product/copy.

Preserve:

- pose and timing mechanics
- gesture rhythm
- shot structure
- edit cadence
- hook/template grammar
- caption layout mechanics
- CTA pattern

Swap:

- recognizable face/body identity
- voice
- exact phrasing
- product/demo slot
- captions/rendered text
- brand marks
- source pixels/audio unless rights-cleared

Use public, user-owned, rights-cleared, or faceless sources first. Do not clone a real creator's recognizable face, voice, private identity, exact captions, copyrighted media, or brand marks without consent.

### Provider spend policy

Provider work must be dry-run-first. Live calls need explicit capped actions and local job records.

Current useful provider direction:

- KIE is the cheap/default UGC generation provider in the app, but live KIE calls are never routine proof work.
- Codex media analysis is represented as dry-run-first local provider jobs unless the user explicitly chooses a live/capped path.
- Jimeng/Dreamina reversal is a separate workstream. Consume it through contracts and local job records; do not edit its reversal code from Slotok UI slices unless explicitly assigned.
- Gemini and KIE credits are limited. Be frugal and do not run live generation for routine UI/proof work.

## Design System Direction

Read these before UI work:

- `docs/state/slotok-design-language.md`
- `docs/state/ugc-studio-style-direction.md`
- `docs/state/ugc-studio-design-system.md`

Visual target:

```txt
Native calm workbench
```

Use:

- Codex-like light workbench shell
- Chorus/Conductor-like compact agent workspace feel
- off-white surfaces, pale sidebars, thin borders
- compact typography and 6-10px radii
- sparse blue selection/accent
- dark editor surfaces only where media/layers benefit

Avoid:

- generic SaaS dashboard
- neon/cyberpunk
- card soup
- oversized hero/marketing UI
- making ComfyUI graph the default surface
- making timeline editing the first/default view during exploration

Implementation rule:

- reusable chrome goes into `components/ui/` or `design-system/workbench.tsx`
- `.rugc-*` CSS should shrink toward view-specific media, canvas, timeline, and graph geometry
- do not add fresh reusable `.rugc-*` selectors for buttons, cards, toolbars, panels, badges, metrics, forms, or command surfaces

## Current Implementation Status

Historical V1 proof reports show the local-first workflow slices are implemented:

- React UGC Studio route with eight views:
  - Persona Atlas
  - Exploration Board
  - Batch Review
  - Campaign Branch Map
  - Reference Archive
  - Final Layer Editor
  - Developer Graph
  - KIE Proxy / provider jobs
- daemon-backed local workspace loading with fixture fallback
- persona profile-bible edits for niche, voice style, accent, and energy
- reference mechanics archive editing with clean-room guardrails
- workspace bundle export/import with dry-run validation and object/asset manifests
- provider job records with statuses, request/response JSON, artifact paths, dry-run/live mode, and spend caps
- candidate batch selected-set status actions, keyboard review controls, filters/sorts, and note history
- creative branch fork, active/rollback selection, promising/dead-end marking, and decision logs
- final-editor selected candidate, layer visibility/lock, clip timing/text/caption payload, JSON diff preview, and export manifests
- developer graph derived from local workspace state with selected-node JSON
- KIE dry-run/live-capped plan/create UI path
- Codex image/video media-analysis planning with dry-run provider job persistence, selected-candidate analysis-results UI, prepared frame/artifact visibility, analysis-to-KIE dry-run planning contract, and explicit live API-key/spend gates

Current phase ledger delta:

- SQLite is the canonical workspace store under `data/ugc-studio/workspaces/<workspace_id>/workspace.sqlite`; JSON remains compatibility/export/import/backup only.
- Preferred local reference catalog roots are `data/tiktok-catalogue/pleometric` and `data/tiktok-catalogue/mynameissico`.
- Visual/manual QA should use `http://127.0.0.1:47521/ugc-studio/`, daemon `http://127.0.0.1:47522`, and the PID/log files under `artifacts/slotok-dev/`.
- Public Higgsfield and Arcads assets are local reference/inspiration manifests only; pending reference-catalog `manifestPaths` planning/import should preserve provenance and rights notes and must not treat those assets as generation inputs unless a manifest explicitly allows it.
- Workflow telemetry/import contract: `workflowEvents` is append-only, `workflowRuns` is the durable derived snapshot, core read/write routes include `GET/POST /api/ugc/workflows`, `GET/POST /api/ugc/workflows/<run_id>/events`, and `POST /api/ugc/workflows/<run_id>/import`; the browser stream route is polling-backed SSE at `GET /api/ugc/workflows/events/stream`; dynamic-workflow callback telemetry maps to literal `phase`/`message`/`started` events. Handoff import is dry-run by default (`200`) and applies only via `apply: true` (`201`), with clean-room `sourcePolicy` guardrails, unknown-key/id rejection, provider-job/reference-archive/candidate-note import behavior, returned `plannedChanges`/`workflowRun`/`events`, and credential-like key redaction. OMP RPC, Pi/OMP artifact polling, and direct dynamic workflow execution are future adapters only; OMP stats are historical usage data only.
- The current phase still needs parent verification after the active backend/data workers finish; do not treat this ledger update as a fresh passing gate.

Proof files:

- `docs/qa/ugc-local-first-v1.md`
- `docs/qa/slotok-visual-qa.md`
- `docs/qa/slotok-analysis-results-ui.md`
- `docs/qa/slotok-v1-goal-proof.md`
- `docs/qa/slotok-provider-pipeline.md`
- `docs/research/slotok-reference-assets.md`
- `docs/qa/ugc-studio-reference-archive.md`
- `docs/qa/ugc-studio-workspace-bundle.md`
- `docs/qa/ugc-studio-provider-jobs.md`
- `docs/qa/ugc-studio-batch-review.md`
- `docs/qa/ugc-studio-branch-workflow.md`
- `docs/qa/ugc-studio-final-editor.md`
- `docs/qa/ugc-studio-developer-graph.md`
- `docs/qa/slotok-workflow-telemetry.md`

Current proof command set for the parent orchestrator:

```bash
bun run slotok:typecheck
bun run slotok:test
bun run slotok:build
cd apps/slotok-workbench && /Users/arthur/.bun/bin/bun scripts/visual-qa.ts
```

## V1 Scope Ledger

Work in small, proven, committed slices. After each slice:

1. Run the narrow tests for that slice.
2. Run Slotok typecheck/test/build when UI/daemon code changes.
3. Run visual QA for meaningful UI changes.
4. Write or update a proof doc under `docs/qa/`.
5. Commit only the scoped files.

### SQLite Canonical Workspace

Status: current phase proof target.

- [ ] Parent verifies `workspace.sqlite` is the canonical source for workspace, personas, branches, candidates, notes, provider jobs, reference archives, exports, final-editor state, research targets, template mining jobs, and asset manifests.
- [ ] Parent verifies JSON paths are limited to import/export/backup/compatibility fixtures.
- [ ] Parent verifies reload reads from the local daemon/SQLite path, not renderer memory.

### Reference Catalog Roots

Status: current phase proof target.

- [ ] Parent verifies reference catalog import/selection can use `data/tiktok-catalogue/pleometric` and `data/tiktok-catalogue/mynameissico`.
- [ ] Parent verifies missing catalog roots degrade safely without live scraping or provider calls.
- [x] Historical proof covers clean-room reference mechanics archive editing without source-media cloning: `docs/qa/ugc-studio-reference-archive.md`.
- [ ] Parent verifies public Higgsfield/Arcads manifests can be planned/imported through `POST /api/ugc/reference-catalog/plan` and `POST /api/ugc/reference-catalog/import` after the pending `manifestPaths` extension lands; while pending, parent inspects manifests directly and verifies existing reference-catalog `roots` planning does not live-scrape or promote public assets into provider inputs.

### Workspace Import/Export Bundle

Status: implemented in the historical V1 slice; re-verify against SQLite canonical storage in the current phase.

- [x] Bundle export writes a manifest with workspace summary, object counts, shard manifest, asset paths, and full local state payload.
- [x] Bundle import has a dry-run validation path before explicit apply.
- [ ] Parent verifies bundle export/import now round-trips through the SQLite-canonical workspace and preserves final-editor/provider/reference state.

### Provider Job Queue

Status: implemented in the historical V1 slice; re-verify against current provider queue UI and storage.

- [x] Local provider jobs include statuses, target links, request/response JSON, artifact paths, error text, dry-run/live mode, and spend cap.
- [x] KIE live generation remains explicit and capped.
- [x] Codex media analysis is represented as a dry-run-first provider job with prepared frame/artifact metadata.
- [ ] Parent verifies no KIE, Gemini, Jimeng, or Codex live spend occurs during current proof unless explicitly triggered through a live/capped action.
- [ ] Parent verifies `POST /api/ugc/kie/analysis-to-kie` produces a dry-run KIE plan from selected candidate/Codex provider-job context after the route lands; while pending, parent verifies the same dry-run invariant through existing KIE plan/create surfaces without live generation.
- [ ] Parent verifies Codex live analysis remains gated by explicit live intent, spend cap, API key, and reachable frame references; this phase does not claim live Codex success unless parent runs it separately.

### Workflow Telemetry

Status: current phase proof target.

- [ ] Parent verifies workflow status is represented by `workflowRuns` as durable derived snapshots and `workflowEvents` as append-only event history, not by provider-job status.
- [ ] Parent verifies the browser uses polling-backed SSE when available through `GET /api/ugc/workflows/events/stream` or `GET /api/ugc/workflows/events/stream?runId=<run_id>&after=<event_id>`.
- [ ] Parent verifies the browser falls back to polling `GET /api/ugc/workflows/<run_id>/events?after=<event_id>&limit=100` and preserves the timeline across reloads.
- [ ] Parent verifies `GET/POST /api/ugc/workflows` exposes run snapshots, `GET /api/ugc/workflows?lane=ugc-ads&status=running&limit=25` filters snapshots, and `GET/POST /api/ugc/workflows/<run_id>/events` reads/appends event history with lane, status, current phase, counters, imported record ids, artifact paths, timestamps, result/error summaries, and source metadata available in the derived run state.
- [ ] Parent verifies dynamic-workflow callback telemetry maps into events: `onPhase` -> literal `phase`, `onLog` -> literal `message`, `onAgentStart` -> literal `started` with `payload.kind = "agent-start"`, and `onAgentEnd` -> literal `message` with `payload.kind = "agent-end"`; do not claim daemon-launched `runWorkflow` until a backend worker route exists.
- [ ] Parent verifies `POST /api/ugc/workflows/<run_id>/import` accepts only top-level `payload` and `apply`, dry-run is default and returns HTTP `200` with `schemaVersion: "ugc-studio.workflow-import-result.v1"`, `plannedChanges`, `workflowRun`, and `events`, valid apply returns HTTP `201`, imports safe provider jobs/reference archives/notes/candidate status-note patches, appends `import`/`result` events, and updates run imported ids/artifacts/result.
- [ ] Parent verifies clean-room import guardrails: `metadata-only` and `abstract-mechanics` public/inspiration sources cannot become direct generation inputs; direct generation input requires `rights-cleared-source`; unknown or extra request/payload keys and unknown candidate/reference/note/provider targets reject without mutation; credential-like keys are redacted.
- [ ] Parent verifies provider jobs are linked from workflow imports/events when relevant but remain provider execution artifacts, not workflow status.
- [ ] Parent verifies OMP stats (`/api/stats`, `/api/sync`) are treated as historical usage/cost data only.
- [ ] Parent verifies no UI/docs claim OMP RPC, Pi/OMP artifact-polling adapters, or direct dynamic workflow execution are implemented until real adapters/routes/processes exist behind the Slotok daemon.

### Batch Review Workflow

Status: implemented in the historical V1 slice; re-verify against current workspace state.

- [x] Selected-set actions persist verdict/status changes.
- [x] Keyboard-friendly review controls, filters/sorts, note draft, and note history are visible.
- [ ] Parent verifies candidate verdicts and notes survive reload through SQLite.

### Branch / Fork / Rollback

Status: implemented in the historical V1 slice; re-verify against current workspace state.

- [x] Campaign branches can be forked and linked to parent snapshots.
- [x] Branches can be marked promising, dead-end, or active/rollback-selected.
- [x] Campaign map/inspector exposes a decision log.
- [ ] Parent verifies branch changes survive reload through SQLite.

### Final Editor Persistence

Status: implemented in the historical V1 slice; re-verify against current workspace state.

- [x] Selected candidate, track visibility/lock, clip timing, clip labels, and caption/text payload JSON can be edited.
- [x] Export manifests capture the full current timeline JSON.
- [x] Inspector shows a JSON diff preview.
- [ ] Parent verifies final-editor edits and export manifests survive reload through SQLite.

### Developer Graph

Status: implemented in the historical V1 slice; re-verify against current workspace state.

- [x] Graph nodes derive from product brief, personas, reference archives, branches, candidates, provider jobs, exports, research targets, and template mining jobs.
- [x] Graph edges show inputs, outputs, artifacts, forks, provider targets, and exports.
- [x] Selected graph nodes expose raw JSON.
- [ ] Parent verifies graph contents update from actual SQLite-backed workspace state after edits.

### Visual Dev Server / Proof Convention

Status: current phase convention.

- [ ] Parent opens `http://127.0.0.1:47521/ugc-studio/`.
- [ ] Parent confirms daemon health at `http://127.0.0.1:47522`.
- [ ] Parent uses `artifacts/slotok-dev/renderer.pid`, `daemon.pid`, `renderer.log`, and `daemon.log` for local dev-server status only.
- [ ] Parent does not inspect credentials/cookies and does not run live provider work during proof unless explicitly live/capped.

## File Ownership Guide

Safe Slotok owner paths:

```txt
apps/slotok-workbench/src/renderer/ReactUgcStudio.tsx
apps/slotok-workbench/src/renderer/ugcStudioModel.ts
apps/slotok-workbench/src/renderer/design-system/**
apps/slotok-workbench/src/renderer/components/ui/**
apps/slotok-workbench/src/renderer/styles.css
apps/slotok-workbench/src/daemon/ugc-*.ts
apps/slotok-workbench/src/ugc/**
apps/slotok-workbench/scripts/visual-qa.ts
docs/plans/slotok-gold-doc.md
docs/plans/ugc-studio-workstreams.md
docs/state/slotok-design-language.md
docs/state/ugc-studio-*.md
docs/qa/ugc-*.md
docs/qa/slotok-visual-qa.md
```

Coordinate before touching:

```txt
packages/jimeng-client/**
packages/browser-use/**
packages/web-access/**
apps/slotok-workbench/src/daemon/eval-store.ts
apps/slotok-workbench/src/types.ts
package.json
AGENTS.md
```

Those files are often active in other concurrent workstreams.

## Commit Discipline

Use one commit per proven feature slice.

Commit message shape:

```txt
Add UGC reference archive editor
Persist UGC workspace bundles
Add provider job queue UI
```

Do not stage unrelated dirty files. The repo often has parallel Codex sessions editing Jimeng, browser, Cua, or shared docs.

## Completion Definition

This goal is complete when the current V1 proof ledger shows:

1. [ ] Slotok treats Pleometric-style brainrot creation and UGC Studio ads as first-class product lanes sharing the same local workspace ledger.
2. [ ] SQLite is the canonical local workspace store and JSON is limited to bundle/import/export/backup compatibility.
3. [ ] the local workspace opens from the daemon-backed SQLite path.
4. [ ] persona profile-bible edits persist and reload.
5. [ ] abstract reference mechanics archives persist and can use the preferred catalog roots `data/tiktok-catalogue/pleometric` and `data/tiktok-catalogue/mynameissico`; after the pending manifest import extension is verified, public Higgsfield/Arcads manifests import only as reference/inspiration records with rights/provenance notes.
6. [ ] provider jobs are dry-run-first local records with request/response JSON, artifact paths, status, live mode, and spend cap fields; Codex analysis, analysis-to-KIE planning, and KIE generation require explicit live/capped gates before any provider spend.
7. [ ] candidate batch review persists selected-set verdicts and notes.
8. [ ] creative branches can fork, mark promising/dead-end, rollback/select active, and retain decision logs.
9. [ ] final editor timeline/layer edits and export manifests persist.
10. [ ] the developer graph derives from real local workspace state and exposes selected-node JSON.
11. [ ] workspace bundles export/import the SQLite-backed workspace with object and asset manifests.
12. [ ] workflow telemetry uses `workflowEvents` as append-only event history and `workflowRuns` as derived run snapshots; the browser uses SSE with polling fallback; handoff import has dry-run/apply guardrails through `POST /api/ugc/workflows/<run_id>/import`; dynamic-workflow callbacks feed telemetry only when a real runner provides them; OMP RPC/artifact polling/direct dynamic execution remain future adapters unless implemented; OMP stats remain historical only.
13. [ ] typecheck, tests, build, visual QA, and manual proof steps are run by the parent and recorded in proof docs.
