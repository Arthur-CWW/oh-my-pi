# Slotok Workstream Ledger

## Orchestrator contract

Arthur wants this run as an ongoing orchestrated workstream: decompose work, dispatch subagents in parallel where safe, verify once per phase, and commit focused feature slices. Do not stop at phase boundaries.

## Product lanes

Slotok has two first-class lanes:

- `brainrot` — Pleometric-style surreal/postmodern meme-video creation and decomposition.
- `ugc-ads` — UGC Studio for making ads: personas, hooks, product demos, proof slots, CTAs, review/fork/export.

These lanes should exist in data/model facets, reference tags, filters, prompts, provider defaults, and UI copy. Do not hardcode them only as labels.

## Running dev surface

Renderer:

```txt
http://127.0.0.1:47521/ugc-studio/
```

Daemon:

```txt
http://127.0.0.1:47522
GET /api/ugc/workspace
```

Runtime files:

```txt
artifacts/slotok-dev/renderer.pid
artifacts/slotok-dev/daemon.pid
artifacts/slotok-dev/renderer.log
artifacts/slotok-dev/daemon.log
```

Stop/restart by killing the PIDs above, then restarting `bun run dev:daemon` and `bun run dev:renderer` from `apps/slotok-workbench/`.

Provider/media proof routes:

```txt
POST /api/ugc/codex/plan
POST /api/ugc/codex/jobs
POST /api/ugc/codex/candidates/<candidate_id>/analyze-video
POST /api/ugc/kie/analysis-to-kie        parent verifies when backend route lands; otherwise use KIE dry-run plan with Codex context
POST /api/ugc/reference-catalog/plan     parent verifies pending manifestPaths extension; current fallback is roots + direct manifest inspection
POST /api/ugc/reference-catalog/import   parent verifies pending manifestPaths extension; apply only after dry-run preview exists
```

## Current parallel agents

- `CoreBackendData` — reference catalog import + bundle/backend tests.
- `CoreWorkflowUI` — completed React V1 workflow UI slice; parent must verify.
- `CoreDocsProof` — completed proof/goal ledger update; parent must verify.
- `HiggsfieldAssetScout` — public Higgsfield/Supercomputer inspiration assets under `data/ugc-studio/reference-assets/higgsfield/`.
- `ArcadsAssetScout` — public Arcads inspiration assets under `data/ugc-studio/reference-assets/arcads/`.

## Reference roots

Local TikTok catalog roots:

```txt
data/tiktok-catalogue/pleometric      61 mp4 / 61 info.json / 61 jpg
data/tiktok-catalogue/mynameissico   281 mp4 / 281 info.json / 281 jpg
data/tiktok-catalogue/staceypilled   153 mp4 / 153 info.json / 153 jpg
```

Public vendor inspiration assets are reference/inspiration only unless a manifest explicitly marks reuse allowed. Store provenance and rights notes.

Public reference asset manifests for current proof:

```txt
data/ugc-studio/reference-assets/higgsfield/manifest.json
data/ugc-studio/reference-assets/arcads/manifest.json
```

Those manifests are local reference/inspiration inputs only. Preserve provenance and rights notes; do not feed Higgsfield/Arcads public assets into generation unless a manifest explicitly marks reuse allowed.

## Pi/OMP workflow telemetry lane

Arthur may run creative execution as Pi/OMP dynamic workflows instead of forcing every creative step through the Slotok daemon. Treat their returned JSON-safe handoff payloads as workflow results backed by Slotok state and documented in `workflows/slotok-creative-agents/README.md`; do not claim the daemon directly launches `runWorkflow` unless a backend worker route exists.

Decision: Slotok owns the browser telemetry/import contract. `workflowEvents` is the append-only event log, and `workflowRuns` is the durable derived run snapshot. Pi/OMP personas, dynamic-workflow callback telemetry, daemon imports, and provider-job links are sources into that stream; `providerJobs` remain provider execution artifacts, not the workflow status model.

- Callback telemetry mapping: `onPhase` -> literal `phase`, `onLog` -> literal `message`, `onAgentStart` -> literal `started` with `payload.kind = "agent-start"`, and `onAgentEnd` -> literal `message` with `payload.kind = "agent-end"`.
- Browser read/stream contract:
  - `GET /api/ugc/workflows`
  - `GET /api/ugc/workflows?lane=ugc-ads&status=running&limit=25`
  - `POST /api/ugc/workflows`
  - `POST /api/ugc/workflows/demo`
  - `GET /api/ugc/workflows/<run_id>`
  - `GET /api/ugc/workflows/<run_id>/events?after=<event_id>&limit=100`
  - `POST /api/ugc/workflows/<run_id>/events`
  - `POST /api/ugc/workflows/<run_id>/import` — implemented handoff dry-run/apply route
  - `GET /api/ugc/workflows/events/stream`
  - `GET /api/ugc/workflows/events/stream?runId=<run_id>&after=<event_id>`
- Demo launcher target for this phase: the Local Workspace Graph workflow telemetry panel shows the header `Deterministic local demo workflow launcher`, helper copy `Start here: click Run both demos, clean-room local only, no live providers/OMP RPC/background subagents.`, and buttons `Run brainrot demo`, `Run UGC ads demo`, and `Run both demos`; the daemon route is `POST /api/ugc/workflows/demo` with `{ "lane": "brainrot" | "ugc-ads" | "all" }`; the companion command is `bun run demo:workflows [brainrot|ugc-ads|all]` from `apps/slotok-workbench`. This surface is deterministic clean-room local planning only: no real Pi/OMP RPC, no background subagents, no live provider calls. It must create browser-visible runs, queued/phase/message/completed/import/result events, and imported local records through SQLite-backed workflow state.
- Demo run invariant: the launcher appends a `completed` event, but the durable run snapshot uses `status: succeeded` with `currentPhase: "completed"` rather than a `completed` run status.
- Handoff import contract: request top level accepts only `payload` and `apply`; payload has `lane`, `sourcePolicy`, optional `records`, `providerJobs`, `candidatePatches`, `referenceArchives`, `notes`, `artifactPaths`, `result`, and `metadata`. Dry-run is default unless `apply: true` and returns HTTP `200`; valid apply returns HTTP `201`, imports safe provider jobs/reference archives/notes/candidate note-status patches, appends `import`/`result` workflow events, and updates imported record ids/artifact paths/result summary.
- Clean-room guardrails: `metadata-only` and `abstract-mechanics` public/inspiration sources cannot become direct generation input; direct generation input requires `rights-cleared-source`; unknown or extra request/payload keys and unknown candidate/reference/note/provider targets reject; credential-like payload keys are redacted before persistence.
- Browser behavior: subscribe by polling-backed SSE when available, retain the last event id, and fall back to polling the run events route with `after=<event_id>` without losing the timeline on reload.
- Historical adapter only: OMP `omp stats` / `omp-stats` server (`/api/stats`, `/api/sync`) is usage-history/cost/sync data, not live workflow state.
- Future adapter only: OMP `--mode rpc` can be normalized into `workflowEvents` when Slotok owns the child process; wrap it behind the Slotok daemon and never expose stdio directly to the browser. Do not claim this adapter is implemented until it exists.
- Future adapter only: Pi/OMP session JSONL, output artifacts, plans, and resource files can be polled/tail-imported later into the same event table as delayed observations.

Manual QA and exact route examples live in `docs/qa/slotok-workflow-telemetry.md`. Store this as event sourcing, not only current snapshots. Current agent status is derived from latest events, while raw event history remains inspectable for proof/replay.

Slotok remains the local-first state viewer/reviewer. Pi/OMP personas perform creative operations and import structured JSON-safe results through daemon routes after dry-run review; SQLite/local state remains the source of truth.

## Commit boundaries

Commit after green verification for each coherent slice:

1. Core local-first V1 workflows.
2. Public inspiration asset capture/manifests.
3. Codex/KIE execution pipeline.
4. Final visual QA/proof pass.

Current proof docs:

```txt
docs/qa/slotok-provider-pipeline.md
docs/research/slotok-reference-assets.md
docs/qa/slotok-analysis-results-ui.md
docs/qa/ugc-local-first-v1.md
docs/qa/slotok-workflow-telemetry.md
```

## Verification gates

```bash
bun run slotok:typecheck
bun run slotok:test
bun run slotok:build
bun run lint:unsafe-types
cd apps/slotok-workbench && bun run visual:qa
```

## Manual visual QA checklist

Parent should use the exact checklists in `docs/qa/slotok-provider-pipeline.md` for the provider/media pass and `docs/qa/slotok-workflow-telemetry.md` for the workflow telemetry pass:

1. Open `http://127.0.0.1:47521/ugc-studio/` and confirm daemon `http://127.0.0.1:47522`.
2. Use `artifacts/slotok-dev/renderer.pid`, `daemon.pid`, `renderer.log`, and `daemon.log` only for dev-server status/errors.
3. Confirm Codex analysis creates dry-run local provider jobs with frame/artifact metadata and survives reload.
4. Confirm live Codex remains explicit and capped: route validation requires `live: true` plus `maxSpendUsd`, then delegates auth to the runtime resolver/runner. The resolver supports API-key mode (`apiKey`, `CODEX_API_KEY`, `OPENAI_API_KEY`) and Codex ChatGPT OAuth session mode (`~/.codex/auth.json`, override `CODEX_AUTH_FILE`) as separate paths; do not treat OAuth access tokens as OpenAI API keys. Mark multimodal live OAuth analysis blocked/unsupported until parent validates a real Codex/ChatGPT backend endpoint.
5. Confirm analysis-to-KIE is dry-run planning only, using the backend route when present or existing KIE plan/create surfaces with Codex context while the route is pending.
6. Confirm Higgsfield/Arcads `manifestPaths` plan/import keeps assets reference-only with provenance and rights notes once that extension lands; while pending, inspect manifests directly and verify existing `roots` planning does not live-scrape or promote public assets into provider inputs.
7. Confirm no live provider success is claimed unless parent explicitly runs a live/capped action and records that proof separately.
8. Confirm workflow status comes from `workflowRuns` plus append-only `workflowEvents`, not provider-job status.
9. Confirm the merged build exposes the deterministic local demo launcher surface: Local Workspace Graph header/copy, buttons `Run brainrot demo` / `Run UGC ads demo` / `Run both demos`, daemon route `POST /api/ugc/workflows/demo`, companion command `bun run demo:workflows [brainrot|ugc-ads|all]`, and clear copy that this is clean-room local planning only, not Pi/OMP RPC or live provider execution.
10. Confirm clicking the demo buttons creates browser-visible runs/events/results/imported records for `brainrot`, `ugc-ads`, and `all`, including queued/phase/message/completed/import/result events and derived run snapshots with `status: succeeded`, `currentPhase: "completed"`, imported ids, artifact paths, and result summary.
11. Confirm the selected demo run accepts `Sample payload`, `Dry-run validate`, and `Apply import`, with dry-run returning `valid: true` plus planned changes and apply persisting the local planned provider job/note/artifact/result plus appended `import`/`result` events across refresh/reload.
12. Confirm dynamic-workflow callbacks map into events with literal `phase`/`message`/`started` types and `payload.kind` for agent start/end, OMP stats are historical only, and OMP RPC/artifact polling/direct dynamic execution are not claimed as implemented unless real daemon adapters/routes exist.
