# Slotok Workflow Telemetry Proof Ledger

Date: 2026-06-19

Scope: workflow telemetry contract and parent manual QA target for the Slotok workbench browser. This document covers `workflowRuns`, `workflowEvents`, SSE live updates, polling fallback, dynamic-workflows callback ingestion, and future Pi/OMP adapters.

This proof ledger does not claim that OMP RPC or artifact-polling adapters are implemented. It also does not claim live provider execution. Provider jobs remain local provider execution artifacts; workflow status is derived from workflow telemetry.

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

- `workflowRuns` stores the durable run snapshot: run id, lane (`brainrot` or `ugc-ads`), source, status, definition/script id, args summary, current phase, counters, imported records/result summary, error summary, and timestamps.
- `workflowEvents` stores the raw event history. Events are never edited in place; later events supersede earlier derived state.
- The workbench derives current status, active agents, current phase, artifacts, imports, and errors from the latest event sequence.
- Dynamic workflows, Pi/OMP personas, daemon import routes, and provider-job side effects are sources into this event stream. They are not separate workflow status models.
- `providerJobs` remain provider execution artifacts with request/response JSON, spend caps, live/dry-run mode, artifacts, and provider status. They can be linked from workflow events but must not replace `workflowRuns`/`workflowEvents` as the workflow status model.

Expected event families:

| Event family | Source | Required invariant |
|---|---|---|
| `phase` | dynamic-workflows `onPhase` | Updates the run's current phase and appends a phase transition event. |
| `log` | dynamic-workflows `onLog` and daemon/system notes | Appends human-readable progress without mutating prior logs. |
| `agent-start` | dynamic-workflows `onAgentStart` | Marks an agent/persona as active with label, phase, and safe prompt summary. |
| `agent-end` | dynamic-workflows `onAgentEnd` | Marks that agent/persona complete and records a JSON-safe result summary or null result. |
| `artifact` | daemon import/artifact discovery | Links local artifact paths or manifest ids without embedding large media payloads. |
| `provider-job` | provider routes | Links provider job ids while leaving provider execution detail in `providerJobs`. |
| `result` / `import` | daemon import routes | Records structured workflow outputs and imported Slotok records. |
| `error` | daemon/dynamic-workflow failures | Records failure state and derives failed run status from the event stream. |

## Exact Route Examples

Implemented backend telemetry route examples for parent QA. The core read/write routes are `GET/POST /workflows` and `GET/POST /workflows/<run_id>/events`; the browser stream route is polling-backed SSE.

```txt
GET http://127.0.0.1:47522/api/ugc/workflows
GET http://127.0.0.1:47522/api/ugc/workflows?lane=ugc-ads&status=running&limit=25
POST http://127.0.0.1:47522/api/ugc/workflows
GET http://127.0.0.1:47522/api/ugc/workflows/<run_id>
GET http://127.0.0.1:47522/api/ugc/workflows/<run_id>/events?after=<event_id>&limit=100
POST http://127.0.0.1:47522/api/ugc/workflows/<run_id>/events
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

## Adapter Policy

Callback source contract:

- `packages/dynamic-workflows` is the primary live source for Slotok-owned dynamic runs. Its `runWorkflow` callback surface (`onLog`, `onPhase`, `onAgentStart`, `onAgentEnd`) is the required mapping into `workflowEvents` and derived `workflowRuns` fields.

Future adapter policy:

- OMP RPC adapter: future only. When Slotok owns an `omp --mode rpc` child process, the daemon may normalize live `AgentSessionEvent` and subagent progress frames into `workflowEvents`. Do not expose stdio directly to the browser, and do not document this as implemented until the adapter exists.
- OMP artifact polling adapter: future only. Pi/OMP session JSONL, output artifacts, plan files, and resource files may be tailed or polled into `workflowEvents` when Slotok did not launch the process. Do not claim live status from artifacts alone; imported artifact events are delayed observations.
- OMP stats: historical only. `omp stats` / `omp-stats` routes such as `/api/stats` and `/api/sync` are usage-history/cost/sync surfaces, not live workflow telemetry and not the source of truth for active workflow state.

## Manual QA Checklist

Parent should perform this exact manual checklist after backend/UI workers finish and before claiming browser workflow telemetry:

1. Open `http://127.0.0.1:47521/ugc-studio/` and confirm the workbench loads from daemon `http://127.0.0.1:47522`.
2. Confirm `artifacts/slotok-dev/renderer.pid` and `artifacts/slotok-dev/daemon.pid` identify the intended local dev servers; use `renderer.log` and `daemon.log` only for server status/errors.
3. Confirm the workbench has a native Slotok workflow/proof surface, not a generic dashboard, and that workflow status is shown as run phase, agent activity, event timeline, artifacts/imports, and errors.
4. Request `GET http://127.0.0.1:47522/api/ugc/workflows` and confirm it returns workflow run snapshots or an empty list with a stable shape.
5. Create a run through the implemented UI/backend path or `POST http://127.0.0.1:47522/api/ugc/workflows`, then capture its `<run_id>`.
6. Confirm `workflowRuns` reflects the run id, lane, source, status, current phase, counters, timestamps, and result/error summary.
7. Append or observe run events through the implemented dynamic-workflow path or `POST http://127.0.0.1:47522/api/ugc/workflows/<run_id>/events`.
8. Confirm `workflowEvents` receives append-only events for phase changes, logs, agent start/end, result/import, artifact/provider-job links, and errors when those occur.
9. Open `GET http://127.0.0.1:47522/api/ugc/workflows/<run_id>/events?after=<event_id>&limit=100` and confirm polling after the last seen event returns only newer events.
10. Open `GET http://127.0.0.1:47522/api/ugc/workflows/events/stream?runId=<run_id>&after=<event_id>` and confirm polling-backed SSE emits `workflow-event` frames with stable ids.
11. Simulate SSE absence by using a browser/network path where the stream is unavailable, or by validating the UI fallback state if the stream closes; confirm the UI polls events instead of losing the run timeline.
12. Reload the workbench and confirm the same run timeline reconstructs from daemon state rather than renderer memory.
13. Confirm dynamic-workflows callbacks map correctly: `onPhase` to phase events, `onLog` to log events, `onAgentStart` to active agent events, and `onAgentEnd` to completion/result events.
14. Confirm provider-job links stay links: provider execution detail remains in `providerJobs`, while workflow progress/status stays in `workflowRuns`/`workflowEvents`.
15. Confirm OMP stats, if inspected, are treated as historical usage only and do not drive live active-agent or run status UI.
16. Confirm no UI copy claims OMP RPC or artifact-polling adapters are implemented unless a real adapter route/process exists in the active daemon build.
17. Confirm no live provider success is claimed unless the parent deliberately ran an explicit live/capped action and recorded that proof separately.

## Verification Status

No gates, formatters, package-manager commands, project-wide commands, visual QA automation, or live provider calls were run by this documentation-maintenance slice. Parent owns validation.
