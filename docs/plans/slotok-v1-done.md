# Slotok V1 Done Goal

## Mission

Ship one honest local-first Slotok V1 for both `brainrot` and `ugc-ads`: Arthur can open UGC Studio, run something useful from the browser, inspect real local state in SQLite, and verify every claimed surface end-to-end without pretending live provider success or Pi/OMP execution adapters that are not actually wired.

## Release tiers

### V1-local

This is the current primary target.

Slotok V1-local is done when Arthur can:

- open the browser app
- trigger deterministic local demo workflows and reviewed handoff imports from the UI
- inspect demo/import workflow telemetry, provider plans, references, review state, editor state, and exports
- reload and keep working from SQLite-backed state

Without claiming:

- real Pi/OMP execution behind the daemon
- live Codex multimodal success
- live provider success as default behavior

### V1-live-provider

Adds verified live provider proof on top of V1-local:

- explicit live Codex/KIE paths
- explicit spend caps
- verified auth path
- recorded proof of successful live execution

### V2-agent-adapters

Adds real daemon-owned agent execution:

- Pi/OMP execution launched or supervised by Slotok
- live agent telemetry from real runs, not only deterministic demos/imports
- import of artifacts/results from real adapters

## How this doc is used

- `V1-local` is the active release gate unless Arthur explicitly promotes the target.
- `docs/plans/slotok-gold-doc.md` is the product/architecture source of truth.
- `docs/plans/slotok-workstream.md` is the execution and QA routing ledger.
- A higher tier does not block a lower tier from being called done.

## Product promise

Slotok should feel honest:

- no fake chrome
- no dead controls presented as real features
- no hidden live spend
- no “magic agent” claims unless the daemon actually runs them

## Concrete definition of done for V1-local

### A. Browser product loop

- [ ] Arthur can open `http://127.0.0.1:47521/ugc-studio/` and use the app without hand-driven Python.
- [ ] The browser exposes a deterministic local demo workflow launcher that visibly creates runs, events, and imported records.
- [ ] Workflow import can be driven from the browser: paste payload, dry-run, apply, see result/event updates.
- [ ] Core review/edit surfaces are real: batch review, branch map, reference archive, final editor, developer graph, provider queue.

### B. Honest UI

- [ ] Fake shell chrome is removed or replaced by real state-derived values.
- [ ] Visual QA fails when known placeholder chrome returns.
- [ ] View labels, lane copy, and workflow messaging match actual capabilities.
- [ ] Surfaces that are still thin are described honestly as local/demo/proof-only rather than pretending to be full agent execution.

### C. Persistence and local state

- [ ] `brainrot` and `ugc-ads` are first-class lanes in workspace data, filters, prompts, provider defaults, and UI copy.
- [ ] `data/ugc-studio/workspaces/<workspace_id>/workspace.sqlite` is the canonical workspace store; JSON is limited to bundle import/export, backups, compatibility fixtures, and inspectable proof artifacts.
- [ ] `GET /api/ugc/workspace` opens the active workspace from the daemon-backed SQLite path rather than renderer-only memory or fixture state.
- [ ] Persona/profile-bible edits, branch state, candidate notes, provider links, workflow runs/events, and developer-graph data survive reload from local state.
- [ ] Workspace bundle export/import round-trips the SQLite-backed workspace, including assets and manifests needed by the V1 surfaces.


#### 2026-06-24 V1-local persistence/API slice

- Candidate annotations now have a daemon API: `GET /api/ugc/candidates/<candidate_id>/annotations` lists local note history, and `POST /api/ugc/candidates/<candidate_id>/annotations` creates a local `ReviewNote` attached to an existing candidate.
- The write path is local-only: no provider, Pi, or OMP adapter is invoked; omitted verdicts default to `watch-again`; unknown candidate ids return before mutation; SQLite-backed stores persist the annotation in the `notes` object collection.
- Targeted reviewer command: `cd apps/slotok-workbench && bunx --bun vitest run src/daemon/ugc-routes.test.ts -t "persists candidate annotations through SQLite-backed route state"`.

### D. Reference ingestion

- [ ] Preferred local catalog roots `data/tiktok-catalogue/pleometric` and `data/tiktok-catalogue/mynameissico` import/select correctly and degrade safely when roots are missing.
- [ ] Reference archive edits persist as abstract mechanics with clean-room guardrails, not source-media cloning.
- [ ] Higgsfield and Arcads manifest planning/import stays reference-only, preserves provenance and rights notes, and never promotes public assets into direct generation inputs unless a manifest explicitly allows that.

### E. Provider pipeline

- [ ] Codex analysis creates dry-run local provider jobs with target links, request/response JSON, prepared frame/artifact metadata, artifact paths, and reload persistence.
- [ ] Analysis-to-KIE remains dry-run planning unless the user explicitly chooses the separate live/capped KIE create path.
- [ ] KIE and Codex live paths require explicit live intent, spend cap, and auth; no live provider work is triggered implicitly.
- [ ] No Slotok UI or proof doc claims live provider success unless the parent deliberately ran that live/capped flow and recorded separate proof.

### F. Workflow telemetry

- [ ] `workflowEvents` is the append-only event log and `workflowRuns` is the durable derived run snapshot; provider jobs remain linked artifacts, not workflow status.
- [ ] `GET /api/ugc/workflows`, filtered list reads, per-run event reads/appends, and `GET /api/ugc/workflows/events/stream` with polling fallback all work against persisted state.
- [ ] Demo/imported workflow data survives refresh and reload without losing the run timeline.
- [ ] Dynamic-workflow callback mappings stay literal (`phase`, `message`, `started`) when a real runner supplies them, and OMP stats stay historical only.

### G. Workflow import

- [ ] `POST /api/ugc/workflows/<run_id>/import` accepts only top-level `payload` and `apply`.
- [ ] Dry-run validate returns planned changes without mutation; apply persists safe provider jobs, reference archives, notes, candidate patches, artifact paths, and result summary while appending `import` and `result` events.
- [ ] Import guardrails reject unknown keys and unknown targets, redact credential-like keys, and prevent `metadata-only` or `abstract-mechanics` public assets from becoming direct generation inputs.

### H. Demo launcher

- [ ] The Local Workspace Graph workflow panel exposes the dedicated launcher header `Deterministic local demo workflow launcher`, helper copy, and buttons `Run brainrot demo`, `Run UGC ads demo`, and `Run both demos`.
- [ ] `POST /api/ugc/workflows/demo` and `bun run demo:workflows [brainrot|ugc-ads|all]` create the same browser-visible local runs.
- [ ] Demo runs create queued/phase/message/completed/import/result events and durable run snapshots that end at `status: succeeded` and `currentPhase: "completed"`.
- [ ] The surface is explicit that this is deterministic clean-room local planning only, not Pi/OMP RPC, background-subagent execution, or live provider execution.

### I. Export / review / editor

- [ ] Batch review verdicts, filters, keyboard controls, and note history persist through SQLite reload.
- [ ] Branch fork/promising/dead-end/rollback-active flows and decision logs persist through SQLite reload.
- [ ] Final editor selected candidate, layer visibility/lock, clip timing, labels, caption/text payload, JSON diff preview, and export manifests persist through SQLite reload.
- [ ] Developer graph nodes/edges and selected-node JSON derive from real workspace state rather than stale fixture-only data.

## Blockers by tier

### V1-local blockers

1. The merged build still needs parent cutover proof for the dedicated workflow/demo surfaces and SQLite persistence.
2. Reference/public asset ingestion still must be proven end-to-end as reference-only.

### V1-live-provider blockers

1. Live Codex multimodal OAuth path is unverified.
2. Live provider proof has not yet been recorded end-to-end by parent.

### V2-agent-adapters blockers

1. Real Pi/OMP execution adapters are not wired behind the Slotok daemon.
2. OMP RPC execution and Pi/OMP artifact-polling adapters remain future-only.

## Completion proof required from parent

For `V1-local`, parent must verify:

1. Open the running app and exercise the main browser loop.
2. Run the deterministic demo launcher from browser and CLI.
3. Reload and confirm persistence from SQLite-backed state.
4. Run the full gates:
   - `bun run slotok:typecheck`
   - `bun run slotok:test`
   - `bun run slotok:build`
   - `bun run lint:unsafe-types`
   - `cd apps/slotok-workbench && bun run visual:qa`
5. Confirm no unrelated repo dirt was staged into the Slotok cut.

## Non-goals / future work

- Direct Slotok browser-to-OMP RPC execution or exposing OMP stdio to the browser.
- Pi/OMP artifact polling, JSONL tailing, or delayed session import as a claimed live workflow adapter before a real daemon adapter exists.
- Treating live Codex, KIE, Gemini, Jimeng, Higgsfield, or Arcads provider success as baseline V1-local proof.
- Live scraping, creator cloning, or rights-unvetted reuse of public reference assets.
- Expanding V1-local into a broader research-mining or autonomous-agent platform beyond the documented local workbench, dry-run provider flows, and verified import/telemetry surfaces.
