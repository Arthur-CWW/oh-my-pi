# slotok-creative-agents

Pi/OMP workflow direction for Slotok creative execution.

## Decision

Slotok does not need to force every creative step through the app daemon. Treat Pi/OMP as an execution lane: launch persona/tool workflows that read Slotok workspace context, run creative/research/provider tasks, and write structured results back as local provider jobs, reference archives, candidates, or export manifests.

The Slotok app remains the local-first workbench and state viewer. Pi/OMP agents are the creative operators.

Use the existing `packages/dynamic-workflows` primitive (`parseWorkflowScript` / `runWorkflow`) rather than inventing a second workflow DSL. Slotok-specific workflow definitions should be persisted wrappers around dynamic-workflow scripts, arguments, results, and imported records.

## Product lanes

- `brainrot` — Pleometric-style surreal/postmodern shortform creation.
- `ugc-ads` — UGC Studio for making ads: personas, hooks, product demo, proof, CTA, variants, review.

Every workflow prompt should carry one lane and preserve it in output metadata.

## Workflow roles

Recommended personas:

1. **Reference miner**
   - Inputs: local catalog roots, public inspiration manifests, X/article URLs.
   - Output: clean-room mechanics only; no direct reuse of protected pixels/audio/likeness.

2. **Codex analyst**
   - Inputs: prepared frame refs, candidate preview metadata, reference archive metadata.
   - Output: structured observations: hook, pacing, product visibility, caption mechanics, retention risks, reusable mechanics.
   - Auth: prefer Codex/OAuth-capable Pi/OMP runtime when available; do not paste tokens into prompts.

3. **Creative strategist**
   - Inputs: analysis records, product lane, target audience, constraints.
   - Output: angles, scripts, shot lists, prompts, critique notes.

4. **KIE image/video operator**
   - Inputs: approved prompt/spec only; never raw provider inspiration assets unless rights-cleared.
   - Output: provider job records and artifact paths.

5. **Reviewer/editor**
   - Inputs: generated candidates and analysis.
   - Output: verdicts, notes, branch decisions, final timeline/export manifests.

## Slotok handoff/import contract

Each workflow returns one JSON-safe handoff payload. Slotok imports that payload through the daemon persistence boundary, never by direct SQLite edits.

```json
{
  "lane": "brainrot | ugc-ads",
  "sourcePolicy": "metadata-only | abstract-mechanics | rights-cleared-source",
  "records": [],
  "providerJobs": [],
  "candidatePatches": [],
  "referenceArchives": [],
  "notes": [],
  "artifactPaths": [],
  "result": {}
}
```

Implemented daemon import route:

```text
POST /api/ugc/workflows/<run_id>/import
```

Request shape:

```json
{
  "payload": { "lane": "ugc-ads", "sourcePolicy": "abstract-mechanics" },
  "apply": false
}
```

Dry-run is the default. The route accepts only top-level `payload` and `apply` keys; omit `apply` or set `apply: false` to validate and receive `200` with `schemaVersion: "ugc-studio.workflow-import-result.v1"`, `plannedChanges`, `workflowRun: null`, and `events: []` without mutating local state. Set `apply: true` only after reviewing the dry-run summary; valid apply returns `201`, imports safe provider-job records, candidate status/note patches for existing candidates, reference archives, notes, artifact paths, and result metadata, then appends workflow `import`/`result` telemetry and updates the run's imported ids, artifacts, and result summary.

Clean-room guardrails:

- `lane` must be `brainrot` or `ugc-ads`.
- `sourcePolicy` must be `metadata-only`, `abstract-mechanics`, or `rights-cleared-source`.
- Unknown top-level request keys and unknown handoff payload keys are rejected by the route decoder.
- Public/inspiration material with `metadata-only` or `abstract-mechanics` policy may become metadata, notes, mechanics, references, or provider-job context only; it must not become direct generation input.
- Direct generation inputs require `rights-cleared-source`.
- Candidate patches must reference existing candidate ids; unknown ids reject the import instead of creating detached state.
- Provider-job payloads remain provider artifacts and should store redacted request/response JSON, mode, status, target ids, spend cap, artifacts, and errors. Do not use provider-job status as workflow status.
- Credential-like keys in imported payloads are redacted before persistence.

## Telemetry contract

Use event sourcing as the browser contract:

- `workflowRuns` stores the durable run snapshot: id, lane, source, status, script/definition id, args summary, current phase, counters, result/import summary, error summary, and timestamps.
- `workflowEvents` is append-only: literal `phase`, `message`, `started`, `artifact`, `status`, `result`, `import`, `error`, `completed`, `blocked`, and `canceled` events are linked by `runId` and ordered by event id. Agent starts/ends are represented through `agentLabel` and `payload.kind`; do not rewrite prior events to hide state changes.
- The workbench derives "what agents are doing right now" from the latest events instead of trusting one mutable status blob.
- `providerJobs` remain provider execution artifacts. A workflow event may link to a provider job id, but provider job status is not the workflow status model.
- The Slotok daemon browser contract exposes SSE for live viewing and polling for fallback/replay.

Exact route examples for QA:

Core workflow telemetry and handoff/import routes are daemon routes; parent QA verifies them against the active daemon build.

```text
GET http://127.0.0.1:47522/api/ugc/workflows
GET http://127.0.0.1:47522/api/ugc/workflows?lane=ugc-ads&status=running&limit=25
POST http://127.0.0.1:47522/api/ugc/workflows
GET http://127.0.0.1:47522/api/ugc/workflows/<run_id>
GET http://127.0.0.1:47522/api/ugc/workflows/<run_id>/events?after=<event_id>&limit=100
POST http://127.0.0.1:47522/api/ugc/workflows/<run_id>/events
POST http://127.0.0.1:47522/api/ugc/workflows/<run_id>/import
GET http://127.0.0.1:47522/api/ugc/workflows/events/stream
GET http://127.0.0.1:47522/api/ugc/workflows/events/stream?runId=<run_id>&after=<event_id>
```

Browser behavior:

- Subscribe to `/api/ugc/workflows/events/stream` by polling-backed SSE when available.
- Keep the last event id from SSE/polling.
- Fall back to `GET /api/ugc/workflows/<run_id>/events?after=<event_id>&limit=100` when SSE is unavailable or closes.
- Rebuild the visible timeline from `workflowRuns` plus `workflowEvents` after reload; do not rely on renderer memory.

Event wording:

- Dynamic-workflow `onPhase` appends a literal `phase` event.
- Dynamic-workflow `onLog` appends a literal `message` event.
- Dynamic-workflow `onAgentStart` appends a literal `started` event with `agentLabel` and `payload.kind = "agent-start"`.
- Dynamic-workflow `onAgentEnd` appends a literal `message` event with `agentLabel` and `payload.kind = "agent-end"`.
- Handoff apply appends workflow import/result telemetry while keeping imported provider-job detail in `providerJobs`.

Adapters:

- Dynamic workflows: when a Pi/OMP workflow or future backend worker runs `runWorkflow`, map callbacks (`onLog`, `onPhase`, `onAgentStart`, `onAgentEnd`) directly into events and derived run snapshots. This document does not claim the daemon directly launches dynamic workflows until a worker route exists.
- OMP RPC: future adapter only. When Slotok owns an `omp --mode rpc` child process, normalize stdio `AgentSessionEvent` and subagent progress frames into events behind the daemon. Do not expose stdio to the browser or claim this adapter is implemented before it exists.
- OMP stats: historical only. Use `omp stats` / `omp-stats` routes such as `/api/stats` and `/api/sync` for usage/cost history, not live progress.
- Artifact polling: future adapter only. Tail Pi/OMP session JSONL, plans, and artifact dirs into the same event table when Slotok did not launch the process; treat these as delayed observations.

## Prompt skeleton

```text
You are a Slotok creative operator.

Lane: <brainrot|ugc-ads>
Workspace: <workspace id>
Inputs:
- <candidate/reference/provider job ids>
- <local manifest paths or prepared frame refs>

Rules:
- Use clean-room mechanics, not direct copying.
- Preserve provenance and rights notes.
- Do not make live provider calls unless live=true, cap is explicit, and the command records a provider job.
- Return JSON-safe output matching the Slotok handoff/import contract.

Task:
<analysis / creative strategy / generation planning / review>
```

## Implementation path

1. Store Slotok workflow definitions as wrappers around `packages/dynamic-workflows` scripts plus args/result metadata.
2. Keep daemon routes as the persistence boundary for imported workflow outputs.
3. Use `POST /api/ugc/workflows/<run_id>/import` for dry-run/apply handoff import; never edit SQLite directly.
4. Let Pi/OMP dynamic workflows fan out agents and tools outside the browser; Slotok visualizes, imports, and reviews the results through daemon state.
5. Use the running workbench at `http://127.0.0.1:47521/ugc-studio/` for manual QA.
