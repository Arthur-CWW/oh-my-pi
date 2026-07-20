# OMP Fork Runtime Map

> **Class:** Derived code map — current source locators, not architecture authority.
> **Owner:** harness stream.
> **Authority:** [federated-control-plane.md](federated-control-plane.md), runtime contracts, and live code/config.
> **Refresh request:** HR-243. Symbol/link checks should eventually generate this map's locator layer without rewriting human explanations.

## One-screen flow

```text
CLI / terminal / collab input
  → AgentSession owns provider turn + active message state
  → SessionManager owns journal/branch/lease publication
  → task tool reserves child identity + async job
  → executor creates/runs child AgentSession
  → AgentRegistry owns live/idle/parked identity
  → AgentLifecycleManager revives/reconciles/parks/stops
  → journals + IRC + job receipts expose evidence
  → SessionObserverRegistry / HUD / Agent Hub project state
  → candidate build → readiness → bless; live sessions never auto-restart
```

## Source owners

| Concern | Owner/source |
|---|---|
| CLI entry/dispatch | `vendor/oh-my-pi/packages/coding-agent/src/cli.ts`, `src/cli-commands.ts` |
| Provider turn, messages, context accounting | `src/session/agent-session.ts` |
| Journal, branch, lease, session discovery | `src/session/session-manager.ts` |
| Task tool schema, spawn admission, starting reservation | `src/task/index.ts` |
| Child session execution/model route/finalization | `src/task/executor.ts` |
| Background job state/poll/cancel/interrupt | `src/async/job-manager.ts` |
| Agent identity and status | `src/registry/agent-registry.ts`, `agent-ref.ts` |
| Revive/park/kill/stale reconciliation | `src/registry/agent-lifecycle.ts` |
| Restart child handoff | `src/session/restart-child-manifest.ts`, `src/task/re-adopt.ts` |
| Inter-agent delivery | `src/irc/bus.ts`, `src/tools/irc.ts` |
| Transcript resolution | `src/internal-urls/history-protocol.ts` |
| HUD projection | `src/modes/session-observer-registry.ts`, `src/modes/components/subagent-hud.ts` |
| Full operator cockpit | `src/modes/components/agent-hub.ts` |
| Statusline context usage | `src/modes/components/status-line/component.ts`, `src/session/agent-session.ts::getContextUsage` |
| `/context` diagnostic projection | `src/modes/utils/context-usage.ts`, command controller |
| Tool-call rendering | `src/modes/components/tool-execution.ts`, `src/tools/tool-headline.ts`, `src/tui/output-block.ts` |
| Candidate/promotion pipeline | `scripts/omp-promote.ts`, release registry under `~/.omp/` |
| Service placement/status | `services.yml`, `scripts/streams.ts`, root `mise.toml` |

## State authorities

- **Provider attempt/current prompt usage:** `AgentSession`.
- **Transcript/branch/lease:** `SessionManager` JSONL + ownership store.
- **Async operation:** `AsyncJobManager`; not AgentRegistry.
- **Agent identity/addressability:** `AgentRegistry`; not HUD/IRC.
- **Lifecycle transitions:** `AgentLifecycleManager` plus durable journal evidence.
- **Task/attention/routing queue:** `packages/control-plane` SQLite.
- **UI:** projection only; it never repairs truth by itself.

A task can exist before a live child session. The registry must reserve `starting` before `task` returns. A terminal journal plus no live job/model turn is stale-orphan evidence and must reconcile before HUD/shutdown decisions (HR-236).

## Operator inspection

```text
omp fleet overview --json        sessions/hosts/workstream projection
omp irc list                     live/idle/parked addressability
job list                         background operation state
history://<agent>                current-session transcript projection
history://<session>/<agent>      cross-session transcript projection
/context                         current provider usage + diagnostic estimates
/runtime-memory                  process/JSC/native memory view
omp grievances list --json       local automated tool issues
omp friction stats --json        local symptom aggregates
mise run status <workspace>      declared service/process/health state
mise run doctor                  environment/readiness invariants
```

Agent Hub is the interactive cockpit. If job, registry, IRC, history, and HUD disagree, inspect the owning source above; do not trust the prettiest projection.

## Common failure map

| Symptom | Likely seam |
|---|---|
| Job exists; history/IRC says unknown | starting reservation: task/index → AgentRegistry |
| HUD says RUN after worker died | lifecycle reconciliation → SessionObserverRegistry |
| Shutdown asks to kill a dead child | input-controller preflight + AgentLifecycleManager |
| Job poll has stale child output | AsyncJobManager refresh/adoption path |
| IRC send fails to a listed child | registry identity vs live-session/reviver binding |
| Transcript missing after completion | journal path, parked projection, history protocol |
| `/context` differs from statusline | retained-text estimate vs provider-anchored usage (HR-241) |
| Tool prompt unreadable after Ctrl+O | tool-headline expanded arg formatting (HR-235) |
| Long path hidden in tool heading | output-block width/title layout (HR-242) |
| Fix exists in source but UI still broken | installed blessed digest is older; candidate has not been promoted/restarted |

## Change and rollout loop

1. Worker owns one behavioral jj change; no shared bookmark movement.
2. Coordinator integrates and runs focused union gates.
3. Build candidate; run readiness with copied/forked state.
4. Bless with `--no-rollout`; retain N−1 and receipt.
5. Never restart live sessions automatically. Arthur receives the fix on an explicit restart/reattach.

## Keeping this map honest

A future `mise run info` or OMP skill/command should:

- validate every source path and named symbol through LSP;
- derive current commands from package/mise/service schemas;
- flag missing or duplicate owner claims;
- link focused proof tests for each failure seam;
- update locator tables only—never rewrite decisions or evidence prose.
