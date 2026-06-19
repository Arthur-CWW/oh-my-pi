# Slotok Workflow Telemetry Proof Ledger

Date: 2026-06-19

Scope: workflow telemetry contract and parent manual QA target for the Slotok workbench browser. This document covers `workflowRuns`, `workflowEvents`, SSE live updates, polling fallback, dynamic-workflows callback ingestion, and the structured workflow handoff import contract.

This proof ledger does not claim that OMP RPC, Pi/OMP artifact-polling adapters, or direct dynamic workflow execution are implemented. It also does not claim live provider execution. Provider jobs remain local provider execution artifacts; workflow status is derived from workflow telemetry. The workflow handoff import store/type contract and daemon route are present; parent owns active-daemon QA.

## Local Dev Surface

Use the running local workbench when present:

- Renderer: `http://127.0.0.1:47521/ugc-studio/`
- Daemon: `http://127.0.0.1:47522`
- Renderer PID: `artifacts/slotok-dev/renderer.pid`
- Daemon PID: `artifacts/slotok-dev/daemon.pid`
- Renderer log: `artifacts/slotok-dev/renderer.log`
- Daemon log: `artifacts/slotok-dev/daemon.log`

PID and log files are for local dev-server status only. Do not inspect credentials, cookies, provider account state, or unrelated private browser data during this QA pass.

## Contract

Workflow telemetry is event-sourced: `workflowEvents` is append-only, and `workflowRuns` is the durable run snapshot derived from the event stream.

- `workflowRuns` stores the durable run snapshot: run id, lane (`brainrot` or `ugc-ads`), source, status, definition/script id, args summary, current phase, counters, imported record ids, artifact paths, result/import summary, error summary, and timestamps.
- `workflowEvents` stores the raw event history. Events are never edited in place; later events supersede earlier derived state.
- The workbench derives current status, active agents, current phase, artifacts, imports, and errors from the latest event sequence.
- Dynamic workflows, daemon import routes, and provider-job links are sources into this event stream. They are not separate workflow status models.
- `providerJobs` remain provider execution artifacts with request/response JSON, spend caps, live/dry-run mode, artifacts, and provider status. They can be linked from workflow import results/events but must not replace `workflowRuns`/`workflowEvents` as the workflow status model.

Expected event families:

| Event family | Source | Required invariant |
|---|---|---|
| `phase` | dynamic-workflows `onPhase` | Updates the run's current phase and appends a phase transition event. |
| `message` | dynamic-workflows `onLog`, `onAgentEnd`, and daemon/system notes | Appends progress or completion text without mutating prior logs. Agent end uses `agentLabel` plus `payload.kind = "agent-end"`. |
| `started` | dynamic-workflows `onAgentStart` | Marks an agent/persona as active with `agentLabel`, phase, and `payload.kind = "agent-start"`. |
| `artifact` | daemon artifact discovery/import | Links local artifact paths or manifest ids without embedding large media payloads. |
| `import` / `result` | daemon handoff import | Records structured workflow outputs and imported Slotok records. Imported provider-job detail remains in `providerJobs`. |
| `status` / `completed` / `blocked` / `canceled` | daemon status updates | Derives status fields on the run snapshot without deleting prior events. |
| `error` | daemon/dynamic-workflow failures | Records failure state and derives failed run status from the event stream. |

## Exact Route Examples

Implemented telemetry and handoff/import routes for parent QA:

```txt
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

Expected SSE shape:

```txt
event: workflow-event
id: <event_id>
data: {"runId":"<run_id>","eventId":"<event_id>","type":"phase","createdAt":"<iso8601>","phase":"Script"}
```

Polling fallback invariant:

1. The browser first attempts `GET /api/ugc/workflows/events/stream`.
2. If SSE is unavailable, closes, or returns a non-event-stream response, the browser polls `GET /api/ugc/workflows/<run_id>/events?after=<last_event_id>&limit=100`.
3. Polling uses the last seen event id and appends only newer events.
4. A reload can reconstruct the same visible timeline from `workflowRuns` plus `workflowEvents` without relying on renderer memory.

## Handoff Import Contract

Implemented daemon route:

```txt
POST http://127.0.0.1:47522/api/ugc/workflows/<run_id>/import
```

Request body:

```json
{
  "payload": {
    "lane": "ugc-ads",
    "sourcePolicy": "abstract-mechanics",
    "records": [],
    "providerJobs": [],
    "candidatePatches": [],
    "referenceArchives": [],
    "notes": [],
    "artifactPaths": [],
    "result": {},
    "metadata": {}
  },
  "apply": false
}
```

Dry-run/apply invariant:

- Dry-run is default: missing `apply`, `apply: false`, or a dry-run UI action validates the payload and returns HTTP `200` with `schemaVersion: "ugc-studio.workflow-import-result.v1"`, `dryRun: true`, `valid`, `imported: false`, `plannedChanges`, warnings, errors, `workflowRun: null`, and `events: []`.
- Apply requires `apply: true`. A valid apply returns HTTP `201`, mutates Slotok state, updates the workflow run result/imported ids/artifact paths, and returns/broadcasts appended `import` plus `result` workflow events.
- Invalid dry-run or apply must not mutate local state.

Import behavior:

- `providerJobs` become provider-job records with redacted request/response payloads, target ids, mode/status, spend cap/cost, artifact paths, and errors. They stay provider artifacts, not workflow status.
- `candidatePatches` may update status and append agent review notes only for existing candidate ids.
- `referenceArchives` may upsert clean-room archive data for existing reference profile ids.
- `notes` create review notes attached to existing Slotok objects.
- `artifactPaths`, `records`, `result`, and `metadata` are summarized into workflow import result telemetry without embedding large media bytes.

Clean-room validation:

- `lane` must be `brainrot` or `ugc-ads`.
- `sourcePolicy` must be `metadata-only`, `abstract-mechanics`, or `rights-cleared-source`.
- `metadata-only` and `abstract-mechanics` handoffs cannot mark public/inspiration source material as direct generation input.
- Direct generation inputs require `rights-cleared-source`.
- Unknown workflow run ids, candidate ids, reference profile ids, note attachments, or provider-job target ids reject the import.
- Credential-like keys are redacted before persistence.
- Unknown top-level keys outside `payload`/`apply`, and unknown keys inside the handoff payload or nested import records, are rejected by the route decoder.

## Adapter Policy

Callback source contract:

- Dynamic-workflow callback telemetry maps as: `onPhase` -> `phase`, `onLog` -> `message`, `onAgentStart` -> `started` with `payload.kind = "agent-start"`, and `onAgentEnd` -> `message` with `payload.kind = "agent-end"`. This ledger does not claim the daemon directly starts `runWorkflow` unless a backend worker route is present.

Future adapter policy:

- OMP RPC adapter: future only. When Slotok owns an `omp --mode rpc` child process, the daemon may normalize live `AgentSessionEvent` and subagent progress frames into `workflowEvents`. Do not expose stdio directly to the browser, and do not document this as implemented until the adapter exists.
- OMP artifact polling adapter: future only. Pi/OMP session JSONL, output artifacts, plan files, and resource files may be tailed or polled into `workflowEvents` when Slotok did not launch the process. Do not claim live status from artifacts alone; imported artifact events are delayed observations.
- OMP stats: historical only. `omp stats` / `omp-stats` routes such as `/api/stats` and `/api/sync` are usage-history/cost/sync surfaces, not live workflow telemetry and not the source of truth for active workflow state.

## Manual QA Checklist

Parent should perform this exact manual checklist after backend/UI workers finish and before claiming browser workflow telemetry/import:

1. Open `http://127.0.0.1:47521/ugc-studio/` and confirm the workbench loads from daemon `http://127.0.0.1:47522`.
2. Confirm `artifacts/slotok-dev/renderer.pid` and `artifacts/slotok-dev/daemon.pid` identify the intended local dev servers; use `renderer.log` and `daemon.log` only for server status/errors.
3. Confirm the workbench has a native Slotok workflow/proof surface, not a generic dashboard, and that workflow status is shown as run phase, agent activity, event timeline, artifacts/imports, and errors.
4. Request `GET http://127.0.0.1:47522/api/ugc/workflows` and confirm it returns workflow run snapshots or an empty list with a stable shape.
5. Create a run through the implemented UI/backend path or `POST http://127.0.0.1:47522/api/ugc/workflows`, then capture its `<run_id>`.
6. Confirm `workflowRuns` reflects the run id, lane, source, status, current phase, counters, imported record ids, artifact paths, timestamps, and result/error summary.
7. Append test events through `POST http://127.0.0.1:47522/api/ugc/workflows/<run_id>/events` or observe callback-derived events from a real runner when one is present.
8. Confirm callback event wording: `onPhase` creates `phase`; `onLog` creates `message`; `onAgentStart` creates `started` with `payload.kind = "agent-start"`; `onAgentEnd` creates `message` with `payload.kind = "agent-end"`.
9. Open `GET http://127.0.0.1:47522/api/ugc/workflows/<run_id>/events?after=<event_id>&limit=100` and confirm polling after the last seen event returns only newer events.
10. Open `GET http://127.0.0.1:47522/api/ugc/workflows/events/stream?runId=<run_id>&after=<event_id>` and confirm polling-backed SSE emits `workflow-event` frames with stable ids.
11. Simulate SSE absence by using a browser/network path where the stream is unavailable, or by validating the UI fallback state if the stream closes; confirm the UI polls events instead of losing the run timeline.
12. Reload the workbench and confirm the same run timeline reconstructs from daemon state rather than renderer memory.
13. Verify the active daemon exposes `POST /api/ugc/workflows/<run_id>/import` and accepts only `{ "payload": <handoff>, "apply": <boolean> }` at the top level.
14. Dry-run a handoff import with `{ "payload": { "lane": "ugc-ads", "sourcePolicy": "abstract-mechanics", "candidatePatches": [], "providerJobs": [], "referenceArchives": [], "notes": [] }, "apply": false }`; confirm `dryRun: true`, `imported: false`, planned changes, and no state mutation.
15. Apply a valid handoff with `apply: true` that imports a safe local provider job, candidate note/status patch for an existing candidate, reference archive data, artifact path, and result metadata; confirm imported records persist through reload.
16. Confirm apply appends `import` and `result` workflow events and updates the run's imported record ids, artifact paths, and result summary.
17. Confirm invalid candidate ids, reference profile ids, note attachments, or provider target ids reject without mutating state.
18. Confirm `metadata-only` and `abstract-mechanics` source policies reject direct generation input, while `rights-cleared-source` is required before source material can be used that way.
19. Confirm credential-like keys in handoff records, provider-job requests/responses, result, or metadata are redacted before persistence.
20. Confirm provider-job links stay links: provider execution detail remains in `providerJobs`, while workflow progress/status stays in `workflowRuns`/`workflowEvents`.
21. Confirm OMP stats, if inspected, are treated as historical usage only and do not drive live active-agent or run status UI.
22. Confirm no UI copy claims OMP RPC, Pi/OMP artifact polling, or direct dynamic workflow execution are implemented unless real daemon adapters/routes/processes exist in the active build.
23. Confirm no live provider success is claimed unless the parent deliberately ran an explicit live/capped action and recorded that proof separately.

## Verification Status

No gates, formatters, package-manager commands, project-wide commands, visual QA automation, or live provider calls were run by this documentation-maintenance slice. Parent owns validation.
