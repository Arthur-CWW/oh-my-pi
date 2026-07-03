# OpenAI Symphony → OMP/SymphonyX reuse map

Arthur's question: **"How much is already implemented in the Symphony repo and can we use it?"**

Short answer: OpenAI ships a complete, language-agnostic `SPEC.md` plus a working Elixir/OTP reference implementation. The architecture maps cleanly to our control-plane-core needs, but the reference code is Linear-only, prototype-quality, and stores blocked state only in memory. We should treat it as a design reference and initial code scaffold, not a dependency we import blindly.

## What upstream already implements

| Capability | Evidence in repo |
|------------|------------------|
| **Language-agnostic spec** | `SPEC.md` defines workflow file format, issue model, orchestrator state machine, polling/reconciliation, workspace lifecycle, and retry/backoff. |
| **Elixir/OTP orchestrator** | `lib/symphony_elixir.ex` starts a `Supervisor` with `Phoenix.PubSub`, `Task.Supervisor`, `WorkflowStore`, `Orchestrator`, `HttpServer`, and `StatusDashboard`. |
| **Linear polling** | `Orchestrator` ticks on `polling.interval_ms`, fetches candidate issues via `Tracker.fetch_candidate_issues/0`, and refreshes running/blocked issue states every tick. |
| **Workspace per issue** | `Workspace.create_for_issue/2` builds `<workspace.root>/<sanitized_issue_identifier>` and runs `after_create`/`before_run`/`after_run` hooks. |
| **Codex app-server runner** | `AgentRunner.run/3` launches `codex app-server` via `SymphonyElixir.Codex.AppServer`, runs up to `agent.max_turns` continuation turns, and streams worker updates back to the orchestrator. |
| **Blocked-state handling** | `Orchestrator` detects `:turn_input_required`, `:approval_required`, and `mcpServer/elicitation/request`, then parks the issue in an in-memory `blocked` map with a human-readable error. |
| **Phoenix LiveView + JSON API** | `DashboardLive` renders `/`; `ObservabilityApiController` exposes `/api/v1/state`, `/api/v1/<issue_identifier>`, and `/api/v1/refresh`; `Presenter` projects orchestrator snapshots into shared payloads. |
| **Terminal dashboard (TUI)** | `StatusDashboard` draws an ANSI status view: running agents, retry queue, token throughput, rate limits, and next poll countdown. |
| **`make all` / CI** | `elixir/Makefile` has `all: ci`, plus `test`, `coverage`, `dialyzer`, and `e2e` targets. |
| **Optional live E2E** | `make e2e` runs real `codex app-server` sessions against disposable Linear resources and optional SSH workers. |
| **Test memory tracker** | `SymphonyElixir.Tracker.Memory` is an in-memory adapter that returns configured issues and emits state-update/comment events, useful for unit tests and local dry runs. |

Sources: [SPEC.md](https://github.com/openai/symphony/blob/main/SPEC.md), [Elixir README](https://github.com/openai/symphony/blob/main/elixir/README.md), [`application.ex`](https://github.com/openai/symphony/blob/main/elixir/lib/symphony_elixir.ex), [`orchestrator.ex`](https://github.com/openai/symphony/blob/main/elixir/lib/symphony_elixir/orchestrator.ex), [`agent_runner.ex`](https://github.com/openai/symphony/blob/main/elixir/lib/symphony_elixir/agent_runner.ex), [`status_dashboard.ex`](https://github.com/openai/symphony/blob/main/elixir/lib/symphony_elixir/status_dashboard.ex), [`presenter.ex`](https://github.com/openai/symphony/blob/main/elixir/lib/symphony_elixir_web/presenter.ex), [`observability_api_controller.ex`](https://github.com/openai/symphony/blob/main/elixir/lib/symphony_elixir_web/controllers/observability_api_controller.ex), [`dashboard_live.ex`](https://github.com/openai/symphony/blob/main/elixir/lib/symphony_elixir_web/live/dashboard_live.ex), [`memory.ex`](https://github.com/openai/symphony/blob/main/elixir/lib/symphony_elixir/tracker/memory.ex), [`Makefile`](https://github.com/openai/symphony/blob/main/elixir/Makefile).

## What we should reuse conceptually

| Concept | Why it fits OMP/SymphonyX | Where it lives upstream |
|---------|---------------------------|------------------------|
| **Supervision tree shape** | One orchestrator GenServer owns scheduling state; `Task.Supervisor` owns ephemeral agent runners; PubSub broadcasts observability updates; HTTP server and dashboard are siblings. This isolates crashes and makes restarts explicit. | `lib/symphony_elixir.ex` |
| **Runner lifecycle** | Workspace create → hook(s) → start Codex session → turn loop → stop session → after_run hook. The continuation-turn logic (`turn 1` full prompt, later turns continuation guidance only) is a good default. | `agent_runner.ex` |
| **Status API / presenter** | A single `Presenter.state_payload/2` projection feeds both the JSON API and the LiveView dashboard. We can copy the payload schema (`counts`, `running`, `retrying`, `blocked`, `codex_totals`, `rate_limits`) as our JSON/SQLite/control API contract. | `presenter.ex`, `observability_api_controller.ex` |
| **Dashboard patterns** | Counts cards → running table → blocked table → retry queue. The per-row fields (issue id, state badge, session id, runtime/turns, last event, tokens) are exactly what a Rust TUI or web client should render. | `dashboard_live.ex`, `status_dashboard.ex` |
| **Workflow prompt contract** | YAML-front-matter + Markdown-body `WORKFLOW.md` with `issue` and `attempt` template variables. This keeps runtime policy in-repo and versioned. | `SPEC.md` §5, `prompt_builder.ex` |
| **Test memory adapter** | Swapping the tracker adapter for an in-memory issue list lets us run the orchestrator loop in tests without Linear credentials. | `tracker/memory.ex` |

## What we should not copy blindly

| Risk | Upstream reality | Our mitigation |
|------|------------------|----------------|
| **Linear-only assumptions** | Tracker client is hard-coded for Linear GraphQL; issue model includes `branch_name`, `blocked_by`, Linear-style states. | Treat tracker as an adapter boundary. Implement `local-file` and `TASKS.md` adapters first; keep Linear adapter optional. |
| **Prototype / trusted-env warning** | README: *"Symphony Elixir is prototype software intended for evaluation only and is presented as-is."* CLI requires `--i-understand-that-this-will-be-running-without-the-usual-guardrails`. | Borrow architecture, not trust posture. Our spike defaults to dry-run child agents and explicit runner approval policies. |
| **In-memory blocked map as source of truth** | `blocked` lives in the orchestrator GenServer state and is lost on restart. Elixir README explicitly says: *"Blocked entries are in memory only; restarting the orchestrator clears that blocked map."* | Persist blocked/running/retry state to the SQLite ledger. In-memory maps are live caches, not truth. |
| **Repo-specific skills / status names** | `WORKFLOW.md`, `linear_graphql` tool, and skills like `commit`, `push`, `pull`, `land`, `linear` are tailored to OpenAI's harness-engineering workflow. | Keep skill names and workflow prompt out of the runtime core; load them as repo-local config. |
| **No Pi / OMP adapter** | Upstream only knows `codex app-server`. There is no Pi agent, OMP subagent, or Zellij/tmux materialization path. | Add runner adapters for `pi --mode rpc`, OMP collab attach/watch/steer, and dry-run stub runners. |
| **No durable ledger** | Restart recovery is tracker/filesystem-driven; exact scheduler state is intentionally not restored. | Our control-plane-core keeps SQLite as source of truth for workflow runs, subagent starts, events, and task packets. |

## Our target adaptations

| Layer | Upstream | OMP/SymphonyX target |
|-------|----------|----------------------|
| **Task source adapters** | `tracker.kind: linear` only | `local-file` (TASKS.md / JSONL / YAML issue list) as first-class adapter; Linear adapter kept optional. |
| **Durable truth** | In-memory orchestrator state + Linear queries | SQLite ledger for workflows, sessions, events, task packets, blocked/retry state, and attach handles. |
| **Runner adapters** | `codex app-server` only | `codex app-server` retained; add `pi --mode rpc`; add OMP collab attach/watch/steer; add dry-run/no-op runner for spike acceptance. |
| **UI clients** | Phoenix LiveView + JSON API | LiveView/TS/Rust UIs are all clients of the same JSON/SQLite/control API. Rust ratatui TUI is not subordinate to Elixir. |
| **Dream memory** | None | Separate `dream-memory` workstream that reads completed control-plane events as evidence, scores patterns, stages candidates, and materializes memory/docs/lints/skills only after review. |
| **Workspace / isolation** | Filesystem directory per issue | Same idea, but add optional git worktree isolation and lazy tmux/Zellij session materialization for human attach/debugging. |
| **Blocked handling** | In-memory blocked map | Persist blocked state to ledger; expose explicit `ask_arthur` / human-in-loop queue; unblock via API/CLI, not restart loss. |

## Verdict

**Reuse the spec and architecture, reimplement or adapt the code.**

- `SPEC.md` is the most reusable artifact: it already defines the problem, state machine, and config contract we need.
- The Elixir reference proves the supervision-tree approach works and gives us working `codex app-server` integration, dashboard payload shapes, and test patterns.
- Our spike should copy the *shape* (orchestrator + runner + presenter + dashboard) but replace the *policy* (Linear-only, in-memory state, prototype guardrails) with our own (SQLite ledger, local task sources, Pi/OMP adapters, dry-run first).

This keeps Symphony as a reference and scaffold, not a runtime dependency.
