# Symphony Lite / control-plane-core goal

Build a repo-local, SQLite-first orchestration core for Pi/OMP/Codex-like agent child runs. The runtime is implemented in Elixir/OTP behind stable JSON/SQLite/API boundaries so that Rust TUI, TypeScript/Pi extension, web control panel, and future GUI clients are stateless clients. Local files and `TASKS.md` are first-class task sources. Dream memory is a separate delayed evidence/promotion stream that consumes control-plane events but never owns runtime state.

## Orchestrator operating model

For this workstream, the active orchestrator session acts as project lead:

1. Pull the next concrete packet from this goal doc, `TASKS.md`, or the SQLite packet ledger.
2. Fan implementation/review work out to subagents when slices are parallelizable.
3. Require intermediate artifacts for every packet: code, ledger rows, QA proof, and rerun commands.
4. Run the verification gates centrally with mise/Elixir 1.20, not in every subagent.
5. Add reviewer passes for code quality, architecture boundaries, and reward-hacking/hacky shortcuts before marking packets done.
6. Commit only green, focused phases with proof paths in the message.
7. Record recurring workflow issues as docs, lints, skills, or future packet work only after evidence.

## Outcome

- A runnable Elixir/OTP orchestration service in `packages/symphony-lite-elixir` that owns workflow runs, task packets, subagent starts, events, and human-in-loop questions in a local SQLite ledger.
- Control of child agents through runner adapters: Pi/OMP `pi --mode rpc` (first), dry-run/no-op (default for tests), and later `codex app-server --listen stdio://`.
- A stable JSON CLI and API contract (`symphonyx` / `symphony_lite`) used by the central Pi orchestrator, Rust TUI, TypeScript/Pi extension, and any future GUI.
- Local files and `TASKS.md` imported as task sources so agents can keep working from the repo's own tracker without Arthur restating the goal.
- Bounded previews, deterministic idempotent commands, and append-only events so a parent orchestrator can recover after compaction by calling `status`.
- A separate `dream-memory` stream that reads completed control-plane sessions/events as evidence, scores repeated patterns, stages candidates, and materializes memory/docs/lints/skills only after review.

## Non-negotiable boundaries

1. **SQLite ledger is the source of truth.** Workflow runs, task packets, subagent starts, events, external sessions, and human questions are durable rows/events first; in-memory caches are disposable views.
2. **OTP processes are live controllers only.** An Elixir `GenServer`/supervisor tree can hold ephemeral runtime handles, timers, and child process monitors, but it rehydrates authority from SQLite on restart and writes every state change back to SQLite before acknowledging it.
3. **UI clients do not own state.** Rust TUI, TypeScript/Pi extension, web control panel, and future GUI read and command through JSON/SQLite/API; they do not maintain parallel truth.
4. **OMP collab is optional attach/watch/steer transport only.** It is useful for live attach to a running child agent, watching progress, and steering/interruption within runner-native capability. It is not the source of truth, registry, database, durable transcript store, task queue, or learning store.
5. **No live paid or provider mutation without explicit approval.** Dry-run/no-op runner is the default in tests and local dev. Any live Pi/Codex/provider call requires an explicit approval gate logged as an event.
6. **Use mise and Elixir 1.20.** All Erlang/Elixir tooling runs through `mise exec erlang@28.5 elixir@1.20.1-otp-28 -- ...`; prefer the `symphony-elixir-test`, `symphony-elixir-build`, and `symphony-elixir-spike` mise tasks for verification.

## Layer map

| Layer | Responsibility | Repo location / examples |
|---|---|---|
| **Knowledge / policy** | Source-of-truth docs, goals, plans, SOPs, reviewer personas, tool profiles. | `docs/plans/symphony-lite-goal.md`, `docs/plans/symphony-lite.md`, `docs/state/symphony-lite-direction.md`, `docs/review-agents/**` |
| **Contracts** | Stable JSON schemas, CLI grammar, API routes, idempotency keys, envelopes, bounded preview shapes. | `packages/symphony-lite-elixir/lib/symphony_lite/contracts/**`, OpenAPI/JSON schema drafts under `docs/plans/` |
| **Config / capability** | Runtime config, tool profiles, runner profiles, secrets/credential references, spend caps, feature flags. | `packages/symphony-lite-elixir/config/`, repo-local `.env`/credential refs, `tool_profile` rows |
| **Ledger** | SQLite tables: workflow runs, task packets, packet ownership, packet proofs, packet events, subagents, external sessions, ask_arthur questions, events. | `packages/symphony-lite-elixir/priv/symphony_lite.sqlite3` or repo-local `data/symphony-lite/` |
| **Task-source adapters** | Import tasks from `TASKS.md`, local packet manifests, JSON/YAML task lists, and future issue trackers. | `SymphonyLite.TaskSources.TasksMd`, `SymphonyLite.TaskSources.PacketManifest` |
| **Coordination / control** | GenServer supervisors, registries, process monitors, restart policy, work queue, claim/next dispatch. | `SymphonyLite.Orchestration.*`, `SymphonyLite.Registry`, `SymphonyLite.Supervisor` |
| **Runner adapters** | Spawn and monitor child processes: dry-run, Pi/OMP RPC, later Codex app-server stdio. | `SymphonyLite.Runners.*` |
| **Observability / proof** | Event logging, bounded status/proof previews, QA proof docs, smoke commands, snapshot tests. | `docs/qa/symphony-lite-*`, `data/symphony-lite/proof/`, `mix test`, `mix symphony.smoke` |
| **Human surfaces** | CLI, JSON API, optional LiveView web surface, Rust TUI client, TypeScript/Pi extension client. | `packages/symphony-lite-elixir/lib/symphony_lite_web/`, `packages/symphony-lite-rs/`, `packages/web-access/src/agent-cockpit*` |
| **Dream-memory** | Delayed evidence/promotion stream: evidence tables, candidate scoring, proposal staging, reviewed materialization. | Future `docs/plans/dream-memory/**`, `data/dream-memory/**` or equivalent ledger |

## Done criteria

- [ ] `next` command/endpoint returns the next ready task packet with bounded preview and claim window.
- [ ] `claim` reserves a packet for a worker/agent and records ownership in the ledger.
- [x] `paths` prints the canonical paths for a packet: source doc, proof folder, artifact root, session link.
- [ ] `proof add` attaches an evidence artifact or QA note to a packet and emits a `packet_proofs` row.
- [ ] `status` shows the orchestration state with bounded previews and `--json` for machine consumption.
- [ ] Dry-run local task orchestration works end-to-end: import a task list, run a dry-run child, mark done/blocked, query status.
- [ ] Pi/OMP runner command construction is implemented and logged before any real process spawn (live spawn approval-gated).
- [ ] Codex app-server runner adapter is sketched or stubbed with a clear interface; not required to run live for the first done slice.
- [ ] All JSON responses use bounded previews (handles/IDs, short summaries, not full transcripts).
- [ ] QA proof docs exist for the packet-ledger commands and one dry-run orchestration run.

## Active packets

These are the immediate implementation packets, in order. Status moves in `TASKS.md` and the SQLite task packet ledger.

1. **Packet-ledger CLI** — SQLite schema (`task_packets`, `packet_ownership`, `packet_proofs`, `packet_events`) and the `next`, `claim`, `paths`, `proof add`, `status` commands.
2. **Local / `TASKS.md` import** — adapter that reads the repo's `TASKS.md` and optional packet manifests into the ledger as task packets.
3. **Runner execution boundary** — dry-run/no-op runner plus Pi/OMP RPC command construction; approval gate for any live spawn; process monitor and event logging.
4. **`ask_arthur` queue** — structured human-in-loop questions persisted to the ledger, with blocking/non-blocking severity and timeout/default behavior.
5. **Status / API projection** — JSON API endpoint (`/api/state` or `status --json`) with bounded previews and external-session integration.
6. **LiveView or web / TUI surface** — minimal Phoenix LiveView or CLI-driven web view for the packet queue and workflow status; Rust TUI remains a client.
7. **Dream evidence store** — first SQLite evidence/candidate/proposal tables and an adapter that consumes control-plane events for later promotion.

## Intermediate artifacts

- Goal doc: `docs/plans/symphony-lite-goal.md`
- Workstream plan: `docs/plans/symphony-lite.md`
- Living direction / care log: `docs/state/symphony-lite-direction.md`
- Control-plane planning: `docs/plans/pi-agent-control-plane.md`
- QA proof notes: `docs/qa/symphony-lite-<slice>.md`
- Local data root: `data/symphony-lite/` (SQLite, proof bundles, session refs)
- Package path: `packages/symphony-lite-elixir/`
- Upstream reuse map: `docs/research/openai-codex-symphony/reuse-map.md`
- Jido note: `docs/research/openai-codex-symphony/jido-note.md`
- OpenAI Symphony mirror: `vendor/openai/symphony/`
