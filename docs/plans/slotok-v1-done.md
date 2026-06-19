# Slotok V1 Done Goal

## Mission

Ship one honest local-first Slotok V1 for both `brainrot` and `ugc-ads`: the parent can open UGC Studio, exercise the core workflow end-to-end against SQLite-backed state, and verify every claimed surface without pretending live provider success or Pi/OMP execution adapters that are not actually wired.

## How this doc is used

- This is the active Slotok V1 finish line.
- `docs/plans/slotok-gold-doc.md` remains the product and architecture source-of-truth.
- `docs/plans/slotok-workstream.md` remains the execution and QA routing ledger.
- V1 is not done while any blocker below is still true or while parent proof for the checklist is still missing.

## Concrete definition of done

Slotok V1 is done only when all of the following are true:

1. Parent verifies the product works as two first-class lanes, `brainrot` and `ugc-ads`, sharing one local workspace ledger.
2. SQLite is the canonical workspace store, the daemon-backed workspace loads from it, and the claimed write-heavy surfaces survive reload.
3. Reference ingestion, provider jobs, workflow telemetry, workflow import, demo runs, batch review, branch workflow, final editor, developer graph, and export manifests all behave as documented against persisted local state.
4. Provider behavior is dry-run-first and honest: live paths are explicit, capped, recorded, and never claimed as successful without separate proof.
5. Workflow telemetry is honest: local demo runs are clearly local-only, and Pi/OMP adapters are not claimed unless real daemon-backed adapters exist.
6. Parent records the final proof in the QA docs and signs off without relying on historical slices or fixture-only behavior.
7. The final V1 cut stays scoped to Slotok files and does not stage unrelated repo dirt.

## Feature checklist

### Workspace

- [ ] `brainrot` and `ugc-ads` are first-class lanes in workspace data, filters, prompts, provider defaults, and UI copy.
- [ ] `data/ugc-studio/workspaces/<workspace_id>/workspace.sqlite` is the canonical workspace store; JSON is limited to bundle import/export, backups, compatibility fixtures, and inspectable proof artifacts.
- [ ] `GET /api/ugc/workspace` opens the active workspace from the daemon-backed SQLite path rather than renderer-only memory or fixture state.
- [ ] Persona/profile-bible edits, branch state, candidate notes, provider links, and developer-graph data survive reload from local state.
- [ ] Workspace bundle export/import round-trips the SQLite-backed workspace, including assets and manifests needed by the V1 surfaces.

### Reference ingestion

- [ ] Preferred local catalog roots `data/tiktok-catalogue/pleometric` and `data/tiktok-catalogue/mynameissico` import/select correctly and degrade safely when roots are missing.
- [ ] Reference archive edits persist as abstract mechanics with clean-room guardrails, not source-media cloning.
- [ ] Higgsfield and Arcads manifest planning/import stays reference-only, preserves provenance and rights notes, and never promotes public assets into direct generation inputs unless a manifest explicitly allows that.

### Provider pipeline

- [ ] Codex analysis creates dry-run local provider jobs with target links, request/response JSON, prepared frame/artifact metadata, artifact paths, and reload persistence.
- [ ] Analysis-to-KIE remains dry-run planning unless the user explicitly chooses the separate live/capped KIE create path.
- [ ] KIE and Codex live paths require explicit live intent, spend cap, and auth; no live provider work is triggered implicitly.
- [ ] No Slotok UI or proof doc claims live provider success unless the parent deliberately ran that live/capped flow and recorded separate proof.

### Workflow telemetry

- [ ] `workflowEvents` is the append-only event log and `workflowRuns` is the durable derived run snapshot; provider jobs remain linked artifacts, not workflow status.
- [ ] `GET /api/ugc/workflows`, filtered list reads, per-run event reads/appends, and `GET /api/ugc/workflows/events/stream` with polling fallback all work against persisted state.
- [ ] Demo/imported workflow data survives refresh and reload without losing the run timeline.
- [ ] Dynamic-workflow callback mappings stay literal (`phase`, `message`, `started`) when a real runner supplies them, and OMP stats stay historical only.

### Workflow import

- [ ] `POST /api/ugc/workflows/<run_id>/import` accepts only top-level `payload` and `apply`.
- [ ] Dry-run validate returns planned changes without mutation; apply persists safe provider jobs, reference archives, notes, candidate patches, artifact paths, and result summary while appending `import` and `result` events.
- [ ] Import guardrails reject unknown keys and unknown targets, redact credential-like keys, and prevent `metadata-only` or `abstract-mechanics` public assets from becoming direct generation inputs.

### Demo launcher

- [ ] The Local Workspace Graph workflow panel exposes the dedicated launcher header `Deterministic local demo workflow launcher`, the helper copy, and buttons `Run brainrot demo`, `Run UGC ads demo`, and `Run both demos`.
- [ ] `POST /api/ugc/workflows/demo` and `bun run demo:workflows [brainrot|ugc-ads|all]` create the same browser-visible local runs.
- [ ] Demo runs create queued/phase/message/completed/import/result events and durable run snapshots that end at `status: succeeded` and `currentPhase: "completed"`.
- [ ] The surface is explicit that this is deterministic clean-room local planning only, not Pi/OMP RPC, background-subagent execution, or live provider execution.

### Export / review / editor

- [ ] Batch review verdicts, filters, keyboard controls, and note history persist through SQLite reload.
- [ ] Branch fork/promising/dead-end/rollback-active flows and decision logs persist through SQLite reload.
- [ ] Final editor selected candidate, layer visibility/lock, clip timing, labels, caption/text payload, JSON diff preview, and export manifests persist through SQLite reload.
- [ ] Developer graph nodes/edges and selected-node JSON derive from real workspace state rather than stale fixture-only data.

## Explicit blockers

1. **Live Codex multimodal OAuth path is unverified.** The current ledgers allow explicit live gating and separate API-key versus ChatGPT OAuth session modes, but they also say multimodal live OAuth analysis stays blocked/unsupported until the parent validates a real Codex/ChatGPT backend endpoint.
2. **Real Pi/OMP execution adapters are not wired behind the Slotok daemon.** The workflow surface can store/import telemetry, but OMP RPC execution and Pi/OMP artifact-polling adapters are still future-only; the demo launcher is deterministic local planning, not real Pi/OMP execution.
3. **The merged build still needs parent cutover proof for the dedicated workflow/demo surfaces and SQLite persistence.** Current QA ledgers explicitly say not to sign off if the active build still shows the older single-button demo flow, and V1 also still depends on parent confirming that any remaining placeholder reference/demo content is not being mistaken for finished product behavior.
4. **Reference/public asset ingestion still must be proven end-to-end as reference-only.** Higgsfield and Arcads manifests carry provenance/rights constraints and cannot count as direct generation inputs or as proof of a live provider integration.

## Non-goals / future work

- Direct Slotok browser-to-OMP RPC execution or exposing OMP stdio to the browser.
- Pi/OMP artifact polling, JSONL tailing, or delayed session import as a claimed live workflow adapter before a real daemon adapter exists.
- Treating live Codex, KIE, Gemini, Jimeng, Higgsfield, or Arcads provider success as baseline V1 proof.
- Live scraping, creator cloning, or rights-unvetted reuse of public reference assets.
- Expanding V1 into a broader research-mining or autonomous-agent platform beyond the documented local workbench, dry-run provider flows, and verified import/telemetry surfaces.
