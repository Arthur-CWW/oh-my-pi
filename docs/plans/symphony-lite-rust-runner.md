# SymphonyX / Symphony Lite Rust runner/TUI design

> **Status 2026-07-03:** Superseded by the Elixir/OTP decision (see `docs/plans/symphony-lite-goal.md` and `docs/state/symphony-lite-direction.md`). The Rust runner is a comparison baseline only.

This document maps OpenAI Symphony-style layers onto a small repo-local Rust implementation for Arthur's meta-agent orchestration harness.

Naming convention for now:

- **Symphony Lite** = descriptive architecture/pattern name: lightweight local adaptation of Symphony-style agent orchestration.
- **SymphonyX** = concrete tool/binary/product codename for our implementation. CLI examples should prefer `symphonyx` once the crate exists.
- **Slotok** = the AI video/TikTok/UGC remix product/workbench that SymphonyX may help build.

Do not block on the name. If the implementation starts under `symphony-lite-rs`, it can still expose a `symphonyx` binary.

## Verdict

Build the Symphony Lite runtime in Rust as a small local service + TUI backed by SQLite.

Do **not** make tmux the default execution substrate. Use Pi/Codex RPC/server modes as the normal child-agent interface. Materialize tmux only when a human needs a real terminal attachment or when debugging a broken child.

## Where it goes

Start here:

```txt
packages/symphony-lite-rs/   # crate can expose binary name `symphonyx`
  Cargo.toml
  src/
    main.rs              # CLI entrypoint: server, tui, run, status
    db.rs                # SQLite schema/migrations/store
    model.rs             # typed domain model
    rpc_pi.rs            # pi --mode rpc child process protocol
    runner.rs            # workflow/subagent lifecycle
    tui.rs               # ratatui UI
    server.rs            # local HTTP/SSE API
    tool_profiles.rs     # profile definitions
    personas.rs          # persona registry/loading
    events.rs            # append-only event model
```

Later, add a tiny Pi extension/tool wrapper in TypeScript:

```txt
packages/web-access/src/symphony-lite-extension.ts
```

or a dedicated package if it grows:

```txt
packages/symphony-lite-pi/
```

The Rust binary is the authority; the Pi tool is just a bridge.

## Symphony layer mapping

OpenAI Symphony spec layers map to our v0 like this:

| Symphony layer | Symphony Lite Rust v0 |
|---|---|
| Policy Layer | repo docs/prompts: `docs/plans/symphony-lite.md`, persona prompts, tool profile definitions, workflow recipe JSON/Markdown |
| Configuration Layer | Rust config loader: env + TOML/JSON + defaults; no giant config system at first |
| Coordination Layer | Rust orchestrator loop over SQLite rows: claim runnable nodes, spawn/stop/retry child agents |
| Execution Layer | child process runner for `pi --mode rpc` and one-shot `codex app-server`; optional tmux materialization |
| Integration Layer | adapters for Pi RPC, Codex server mode, git worktrees, maybe issue trackers later |
| Observability Layer | SQLite events + TUI + local HTTP/SSE + optional cockpit publishing |

## Core idea

The Rust service owns durable state. Child agents are cheap processes controlled through RPC.

```txt
symphonyx daemon
  ├─ SQLite store
  ├─ workflow scheduler
  ├─ child process table
  ├─ pi --mode rpc subprocesses
  ├─ append-only event/log writer
  ├─ Unix-socket control API
  ├─ TUI/status surface
  └─ optional HTTP/SSE API for future workbench/Pi extension
```

A child agent is usually not a tmux pane. It is:

```txt
pi --mode rpc --name <agent-name> --session-dir <run-session-dir> --tools <profile-tools>
```

The runner talks JSONL to stdin/stdout:

- `prompt`
- `steer`
- `follow_up`
- `abort`
- `get_state`
- `get_messages`
- `get_fork_messages`
- `fork`
- `clone`
- `switch_session`

## Why not tmux by default?

Tmux is useful for human attach/debugging, but it is a poor primary protocol:

- scraping panes is brittle
- steering is just keystroke injection
- structured events are lost unless separately logged
- prompt quoting is annoying
- process lifecycle is indirect

Pi RPC gives structured state and events. The TUI can render those events directly.

Keep tmux as:

```txt
symphony materialize-tmux <agent-id>
```

or as a fallback runner profile:

```txt
runner_kind = "tmux-pi"
```

## SQLite store

Yes, use SQLite. It is the source of truth.

Use Rust `rusqlite` for v0:

- simple
- fast enough
- low abstraction
- easy to vendor later
- works well with one local process

Avoid `sqlx` initially unless compile-time query checking becomes worth the extra setup.

Suggested project-local runtime root:

```txt
data/symphonyx/
```

Suggested DB/socket/log paths:

```txt
data/symphonyx/symphony.sqlite
data/symphonyx/run/symphonyx.sock
data/symphonyx/run/symphonyx.pid
data/symphonyx/runs/<workflow-id>/
data/symphonyx/artifacts/<sha256-prefix>/<sha256>
data/symphonyx/logs/
```

Compatibility note: older docs may mention `data/symphony-lite/`; prefer `data/symphonyx/` going forward.

### Tables v0

```sql
workflow_runs(
  id text primary key,
  created_at text not null,
  updated_at text not null,
  status text not null,
  title text,
  objective text,
  parent_session_file text,
  parent_checkpoint text,
  workdir text not null,
  config_json text not null
);

subagents(
  id text primary key,
  workflow_id text not null,
  created_at text not null,
  updated_at text not null,
  status text not null,
  role text not null,
  persona text,
  tool_profile text not null,
  model text,
  context_mode text not null,
  runner_kind text not null,
  pid integer,
  session_file text,
  session_id text,
  artifact_dir text not null,
  last_event_at text,
  summary text,
  foreign key(workflow_id) references workflow_runs(id)
);

agent_events(
  id integer primary key autoincrement,
  workflow_id text not null,
  subagent_id text,
  ts text not null,
  type text not null,
  payload_json text not null
);

artifacts(
  id text primary key,
  workflow_id text not null,
  subagent_id text,
  kind text not null,
  role text,
  path text not null,
  sha256 text,
  mime text,
  created_at text not null,
  meta_json text not null
);

human_questions(
  id text primary key,
  workflow_id text not null,
  subagent_id text,
  created_at text not null,
  updated_at text not null,
  severity text not null,
  status text not null,
  question text not null,
  context text,
  options_json text not null,
  recommended_option text,
  default_if_no_answer text,
  answer text,
  answered_at text
);
```

Add attempt/retry/worktree tables later.

## Central Pi / LLM orchestrator

There will still be a central Pi session acting as the human-facing orchestrator. The key design rule:

```txt
Pi orchestrator decides and explains.
Rust service owns state and process lifecycle.
```

The central Pi session should use a single tool/API to interact with Symphony Lite instead of manually spawning tmux sessions or scraping child logs.

Responsibilities:

- translate Arthur's intent into workflow/subagent specs
- choose personas and tool profiles
- start/stop/rerun/steer subagents through the Symphony Lite API
- inspect status/events/artifacts/questions
- synthesize child outputs into human-readable decisions
- ask Arthur questions when judgment/approval is needed

Non-responsibilities:

- storing canonical child state in parent context
- owning subprocess lifecycles directly
- pasting every child transcript into chat
- silently bypassing tool profiles or worktree isolation

The parent context should contain compact references:

```txt
workflow_id: wf_...
active agents: 3 running, 1 blocked
important artifacts: artifact://...
pending questions: ask_...
recommended next action: ...
```

Full event history lives in SQLite/artifacts.

## Orchestrator API design

Design this **AI-first, not TUI-first**.

Humans and AI agents must use the same underlying CLI/API. The TUI, Pi tool, scripts, and future Slotok/workbench UI are just different clients over the same operations and state.

The central Pi/LLM orchestrator will be the heaviest user, so the API must be easy for an agent to script reliably:

- stable nouns/actions
- JSON input/output everywhere
- compact status summaries
- handles/IDs instead of giant transcripts
- append-only events
- explicit state transitions
- idempotent commands where possible
- predictable error shapes
- no hidden TUI-only behavior

Expose one stable command/tool surface. Same concepts should work from:

- Rust CLI, with `--json` as a first-class/default-for-agents mode
- Rust TUI
- local HTTP/SSE server
- Pi extension tool
- scripts/workflows
- future Slotok/workbench UI

### Core nouns

```txt
workflow       a run/DAG owned by Symphony Lite
subagent       an agent process or planned agent task
persona        behavior/review lens
profile        enforced tool/capability profile
artifact       durable output from a subagent/workflow
question       ask_arthur human-input item
event          append-only state transition/log item
```

### CLI/API parity

Every important operation should be available three ways with the same schema:

```txt
CLI:       symphonyx agent spawn --json '{...}'
HTTP:      POST /api/agents/spawn  {...}
Pi tool:   {"action":"agent_spawn", ...}
```

Humans may use friendlier shorthand:

```bash
symphonyx status
symphonyx tui
symphonyx agent spawn --role reviewer --prompt plan.md
```

Agents should prefer machine-readable forms:

```bash
symphonyx status --json
symphonyx events tail wf_123 --since 42 --json
symphonyx artifact read artifact_abc --json
```

Output rule:

- default human output may be pretty tables
- `--json` must be complete, stable, and parseable
- JSON output should include `ok`, `data`, and `error` envelopes for scriptability

Example envelope:

```json
{
  "ok": true,
  "data": {"workflow_id": "wf_123"},
  "error": null
}
```

Error envelope:

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "unknown_tool_profile",
    "message": "Unknown tool profile: provider-eval",
    "retryable": false,
    "details": {"known_profiles": ["reviewer-readonly", "implementer-ts"]}
  }
}
```

### Minimal Pi tool API

Register one Pi tool, tentatively:

```txt
symphony_lite
```

Actions should be boring and explicit:

```txt
status              compact overview for the current workgroup/workflow
workflow_create     create a workflow/run record
workflow_get        fetch workflow detail
workflow_list       list workflows
agent_spawn         create/spawn a subagent
agent_steer         steer running agent after current tool turn
agent_follow_up     queue follow-up after agent stops
agent_abort         abort running child
agent_rerun         rerun/branch a child agent
artifact_list       list artifacts
artifact_read       read one artifact/preview
question_list       list ask_arthur questions
question_answer     answer an ask_arthur question
events_tail         recent events, optionally since event id
```

Prefer object input over stringly CLI-ish input. Example:

```json
{
  "action": "agent_spawn",
  "workflow_id": "wf_123",
  "role": "rubber-duck-reviewer",
  "persona": "rubber-duck-adversarial",
  "tool_profile": "reviewer-readonly",
  "context_mode": "summary",
  "prompt": "Review this plan and identify the smallest safe next slice...",
  "model": "default-cheap",
  "worktree": false,
  "blocking": false
}
```

The tool/CLI/API response should include handles, not giant transcripts:

```json
{
  "workflow_id": "wf_123",
  "subagent_id": "agent_456",
  "status": "running",
  "events_url": "http://127.0.0.1:.../api/workflows/wf_123/events",
  "artifact_dir": "data/symphonyx/runs/wf_123/agent_456"
}
```

### Good LLM-facing response shape

For `status`, return a compact, stable structure:

```json
{
  "workflow": {"id": "wf_123", "status": "running", "title": "..."},
  "counts": {"planned": 1, "running": 2, "blocked": 1, "done": 3, "failed": 0},
  "agents": [
    {"id": "agent_a", "role": "docs", "status": "done", "summary": "...", "latest_artifact": "..."},
    {"id": "agent_b", "role": "impl", "status": "running", "last_event": "tool read", "age_s": 42}
  ],
  "questions": [
    {"id": "ask_1", "severity": "blocking", "question": "...", "recommended_option": "..."}
  ],
  "recommended_actions": ["answer ask_1", "tail agent_b", "spawn security reviewer"]
}
```

This makes the central Pi orchestrator useful after compaction: it can recover by calling `status` rather than remembering everything.

### Agent scripting ergonomics

The API should assume an LLM will frequently do loops like:

```txt
status → inspect blocked agents/questions → answer/steer/spawn → tail events → summarize
```

So provide commands optimized for that loop:

```txt
status --json                         compact whole-system state
events tail <workflow-id> --since N    incremental event polling
agent get <agent-id> --json            one selected agent detail
artifact preview <artifact-id> --json  bounded preview, not huge file dump
question list --json                   pending ask_arthur queue
question answer <id> --json ...        answer with provenance
```

Bounded previews matter. Never force an agent to ingest a 200k-token transcript to learn whether a child is done. Provide summaries plus paths/IDs.

Recommended default limits:

```txt
status: max 20 agents + counts + top questions
events tail: max 100 events unless requested
artifact preview: max 8k chars by default
transcript preview: max 12k chars by default
```

For full data, return a path and require explicit `artifact read --full` or direct file read.

### State transitions

Use a finite set of states inspired by Symphony/k9s-style operators:

```txt
workflow: planned | running | paused | blocked | done | failed | cancelled
subagent: planned | queued | starting | running | idle | blocked | needs_human | done | failed | aborted | stale | offline
question: open | answered | timed_out | cancelled
artifact: planned | writing | ready | superseded | deleted
```

Important distinction:

- `blocked`: cannot continue due missing tool/auth/input.
- `needs_human`: waiting for Arthur/taste/approval but not necessarily an error.
- `stale`: process heartbeat/event age exceeded threshold; may need reconcile.
- `offline`: process gone; final status unknown until reconciliation.

## TUI shape

Use `ratatui` + `crossterm`.

The feel should be closer to **k9s** / **lazydocker** than a static dashboard: fast lists, live status, filters, logs, describe panes, actions on selected resources, and keyboard-first navigation.

Views:

```txt
1 dashboard   workflow list / running agents / questions
2 workflow    DAG/list of subagents for current workflow
3 agent       transcript/events for selected agent
4 artifacts   outputs/logs/patches/json
5 questions   ask_arthur inbox
6 logs        raw event stream
```

Resource list columns should prioritize operator decisions:

```txt
KIND   NAME/ROLE              STATUS       AGE   MODEL/PROFILE        COST  LAST EVENT        ARTIFACTS
wf     slotok-plan-review     running      3m    mixed                --    2 agents running  4
agent  rubber-duck-reviewer   done         48s   reviewer-readonly    --    artifact ready    1
agent  impl-scout             needs_human  2m    implementer-ts       --    ask_arthur        0
ask    ask_abc                open         2m    blocking             --    needs answer      0
```

Detail panes:

- summary/description
- latest events
- transcript preview
- artifacts
- questions
- actions available for selected resource

Vim-like keys:

```txt
j/k          move
h/l          switch pane / expand-collapse
/            search/filter
enter/o      open selected
r            rerun selected
s            steer/nudge selected agent
a            answer selected ask_arthur
A            open ask_arthur inbox
gd           dashboard
gw           workflow view
ga           agent view
gq           questions
gl           logs
q            quit/back
?            help
```

Actions should be explicit and visible:

```txt
s      steer selected agent
f      follow-up selected agent
a      answer selected question
r      rerun selected resource
x      abort/kill selected agent, with confirmation
m      materialize tmux for selected RPC child if supported
p      copy path/id
enter  describe/open selected
```

TUI must not be the only interface; it is an operator surface over the same SQLite/API state that Pi and future Slotok UI use.

## Singleton daemon / server shape

Make SymphonyX feel server-ish like tmux, but simpler:

```bash
symphonyx up              # start repo-local daemon if not running
symphonyx down            # stop daemon
symphonyx restart
symphonyx status --json   # works if daemon is up; may fall back to DB read if down
symphonyx tui             # foreground operator UI, attaches to daemon
symphonyx watch           # foreground text/event monitor
```

There should be **one daemon per project/runtime root**, identified by `data/symphonyx/run/symphonyx.sock` + PID/lock. This avoids multiple orchestrators fighting over child processes.

Default control path:

- CLI talks to daemon over Unix domain socket.
- If daemon is down, read-only commands may read SQLite directly.
- Mutating commands should either fail with `daemon_not_running` or start the daemon when `--auto-start` is passed.

HTTP/SSE is optional and mostly for future browser/workbench UI. Use Unix socket first for local CLI/tool reliability.

When HTTP/SSE is added, bind to `127.0.0.1` only:

```txt
GET  /health
GET  /api/workflows
GET  /api/workflows/:id
GET  /api/workflows/:id/events  (SSE)
POST /api/workflows
POST /api/subagents/:id/steer
POST /api/subagents/:id/follow-up
POST /api/subagents/:id/abort
POST /api/questions/:id/answer
```

Do not make the TUI the server. The TUI is just a client.

## Pi tool bridge

Eventually register a Pi tool:

```txt
symphony_lite
```

Actions:

```txt
status
run
spawn_agent
steer
follow_up
abort
ask
answer
artifacts
```

The tool should call the Rust server if running, else shell out to the Rust CLI.

This lets the parent Pi agent orchestrate without owning the child processes itself.

## Lazy materialization

Default lifecycle:

1. Create `workflow_run` row.
2. Create planned `subagents` rows.
3. Spawn a child process only when a row is claimed/runnable.
4. Store every RPC event in `agent_events`.
5. Write final output as an artifact.
6. Keep child process alive only when interactive/continuation is useful.
7. Rehydrate from SQLite after restart.

This avoids keeping tmux panes/processes for every conceptual node.

## Context modes

V0:

- `prompt-only` — task prompt + persona + tool profile.
- `summary` — task prompt + orchestrator-provided compact summary.

Later:

- `fork-current` — use Pi RPC/session APIs or SDK runtime to fork from a parent session/checkpoint.
- `worktree` — create isolated git worktree before write-capable tasks.

## Tool profiles

Do not pretend prompt text is permissions.

V0 should enforce tool profiles by launching Pi with allowlisted tools:

```txt
reviewer-readonly: --tools read,grep,find,ls
implementer-ts:    --tools read,bash,edit,write
research-web:      custom later
```

If a profile cannot be enforced, reject it or mark it `guidance-only` explicitly.

## Monitoring model

Use three monitoring layers, all reading the same state:

### 1. Background daemon

The daemon is nonblocking and always writes durable state:

- SQLite rows for current state and structured events
- SQLite-searchable payloads for protocol events, final previews, session ids, and process stderr lines
- artifact files for prompts/final outputs/patches/screenshots/metrics when those are more naturally files

SQLite is the source of truth for important state. Per-agent sidecar logs are opt-in debug/export artifacts via `--file-logs`:

```txt
data/symphonyx/runs/<workflow-id>/<agent-id>/events.jsonl
data/symphonyx/runs/<workflow-id>/<agent-id>/transcript.jsonl
data/symphonyx/runs/<workflow-id>/<agent-id>/stdout.log
data/symphonyx/runs/<workflow-id>/<agent-id>/stderr.log
```

### 2. Foreground monitor/TUI

Humans can run:

```bash
symphonyx tui
symphonyx watch
symphonyx events tail <workflow-id> --follow
```

This should not own child-agent lifecycle, but it should ensure the repo-local daemon is running before it attaches. In normal human use, `symphonyx tui` is the one command: auto-start daemon if needed, then attach like k9s/lazydocker attach to cluster/docker state.

### 3. AI/script polling

Agents should use bounded polling:

```bash
symphonyx status --json
symphonyx events tail wf_123 --since 42 --limit 100 --json
symphonyx agent get agent_456 --json
symphonyx artifact preview artifact_789 --json
```

This is the main path for central Pi orchestration after compaction.

## Search / log access

Keep this simple first: SQLite plus optional file exports.

V0:

- all structured events in SQLite `agent_events`
- normal search goes through `symphonyx search --json`
- sidecar JSONL/log files are opt-in with `--file-logs`, mainly for raw protocol replay or `rg`-first forensic debugging
- expose file paths only when sidecars/artifacts exist

Example:

```bash
symphonyx search "needs_human|failed|unknown_tool_profile" --json
```

V1:

Improve the convenience command beyond basic SQLite/file search:

```bash
symphonyx search "unknown_tool_profile" --json
symphonyx search --workflow wf_123 --agent agent_456 "MAX_TOKENS" --json
```

V2:

Only if needed, add SQLite FTS5 over event payloads, summaries, and artifact text previews. Do not build a search engine before `rg` + SQLite becomes painful.

## MVP CLI

First working command set:

```bash
symphonyx init
symphonyx up
symphonyx run --title "Rubber duck plan" --agent reviewer-readonly --prompt prompt.md --json
symphonyx status --json
symphonyx tui
symphonyx watch
symphonyx events tail <workflow-id> --json
symphonyx steer <agent-id> "..." --json
symphonyx abort <agent-id> --json
symphonyx ask list --json
symphonyx ask answer <question-id> "..." --json
symphonyx search "query" --json
```

## What not to build first

Do not start with:

- full graph editor
- Electron workbench
- Linear integration
- full long-lived Codex app-server control plane beyond the one-shot runner
- tmux-first orchestration
- arbitrary distributed workers
- complex plugin system

Start with one thing: a Rust process that can spawn one Pi RPC or Codex app-server child, stream events into SQLite, and expose AI-friendly `status/events/search` commands. Add TUI and long-lived steer/abort after the store/runner proves useful.

## First implementation slice

Implemented in `packages/symphony-lite-rs`:

1. Create `packages/symphony-lite-rs` crate exposing binary `symphonyx`.
2. Add `init` command that creates SQLite tables.
3. Add `run --prompt file --tool-profile reviewer-readonly` that spawns `pi --mode rpc --no-session`.
4. Add `run --runner codex-app-server` that drives `codex app-server --listen stdio://` through initialize/thread/start/turn/start and captures final-message previews.
5. Send one prompt/turn and stream important structured events into SQLite; keep JSONL/stdout/stderr sidecars opt-in via `--file-logs` for raw forensic/debug exports.
6. Add `status`, `watch`/`tui`, `events tail`, `search`, and early `ask list/answer` commands with JSON envelopes.
7. Add singleton daemon stub with `up/down/status` PID/stop-file behavior.
8. Add `insta` snapshots for stable status/run/event JSON shapes.

Still TODO:

- richer ratatui actions/detail panes beyond the current read-only dashboard
- Unix-socket daemon command server
- long-lived child steering/abort after `run`
- worktree isolation

Proof:

```bash
cargo test --manifest-path packages/symphony-lite-rs/Cargo.toml
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- --root /tmp/symphonyx init --json
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- --root /tmp/symphonyx run --prompt data/coordination/symphony-lite-subagents/workflow-v2.prompt.md --tool-profile reviewer-readonly --dry-run --json
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- --root /tmp/symphonyx run --runner codex-app-server --prompt /tmp/symphonyx-codex-smoke.prompt.md --tool-profile reviewer-readonly --json
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- --root /tmp/symphonyx status --json
```

## Open design questions

- Should v0 use persisted Pi sessions by default or `--no-session` plus our own event/artifact store?
- Should `fork-current` be implemented through Pi RPC subprocesses or Pi SDK runtime?
- Should the TUI be standalone or connect to the HTTP server even in local mode?
- How much of `agent_cockpit` should be mirrored vs reused directly?
