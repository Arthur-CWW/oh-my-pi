# SymphonyX (`symphony-lite-rs`)

Rust prototype for the Symphony Lite meta-agent orchestration runtime.

This is the local-first process/state layer for orchestrating Pi/Codex-like child agents. Slotok is the video/remix product; SymphonyX is the harness used to build and steer things.

Planning docs:

- [`docs/plans/symphony-lite.md`](../../docs/plans/symphony-lite.md) — architecture and workstreams
- [`docs/state/symphony-lite-direction.md`](../../docs/state/symphony-lite-direction.md) — living direction and care log
- [`docs/plans/pi-agent-control-plane.md`](../../docs/plans/pi-agent-control-plane.md) — control-plane/core planning

## Current capabilities

Implemented:

- `symphonyx init` — create SQLite schema.
- `symphonyx status --json` — compact AI-friendly state summary.
- `symphonyx up/down` — repo-local singleton daemon stub with PID/stop files.
- `symphonyx run --dry-run` — create workflow/subagent rows and events.
- `symphonyx run` — launch one child via `--runner pi-rpc` (default) or `--runner codex-app-server`, send a prompt, persist structured events in SQLite, and return a bounded final-message preview when available.
- `symphonyx spike --task-list <path> --json` — local runtime-substrate spike proof: creates done/blocked/failed dry-run workers, persists SQLite workflow/session/event rows, and returns bounded status JSON without TUI.
- `symphonyx sync` — index local external agent sessions into SQLite; currently scans Codex history from `~/.codex/sessions/**/*.jsonl`.
- `symphonyx watch` — lightweight text monitor backed by SQLite (Ctrl-C to exit); auto-syncs local sessions before rendering.
- `symphonyx tui` — ratatui/crossterm terminal UI with keyboard navigation; auto-starts the repo-local daemon and auto-syncs local sessions before attaching.
- `symphonyx open agent <id> [--json]` / `symphonyx open session <provider> <id> [--json]` — resolve a local agent or session target; `--json` returns canonical path/handles for OMP or another opener to consume, default invokes the OS opener.
- `symphonyx restart --agent <id> --json` — safe local replay of a terminal agent from its persisted prompt artifact; creates a new run without mutating history and rejects running/planned agents.
- `/symphonyx-open agent <id>` (Pi/OMP bridge) — resolve a local agent or session target through the Rust CLI `open ... --json` output, then open it via OMP's existing `openPath` (`@oh-my-pi/pi-coding-agent/utils/open`). Falls back to `cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- open ... --json` if `symphonyx` is not on PATH.
- `symphonyx events tail --json` — bounded SQLite event polling.
- `symphonyx search --json` — simple SQLite + file search.
- `symphonyx ask list/answer --json` — early human-question queue shape.

This package is the current working prototype, not a final runtime commitment; the control-plane contract must remain portable to a possible Elixir/OTP orchestration core.

## Usage

All commands below run from repo root and use `cargo run` so they stay rerunnable without a separate build step.

### Run a local spike and check JSON status

```bash
mkdir -p /tmp/symphonyx-spike
printf "First task\nSecond task\n" > /tmp/symphonyx-spike/tasks.txt

cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root /tmp/symphonyx-spike/run \
  spike \
  --task-list /tmp/symphonyx-spike/tasks.txt \
  --json

cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root /tmp/symphonyx-spike/run \
  status --json
```

The spike creates one workflow, three dry-run subagents (done, blocked, simulated crash), one external session row, and events. `status --json` returns bounded counts and recommended actions.

### Monitor with `watch`

```bash
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root /tmp/symphonyx-spike/run \
  watch --interval 1 --limit 20
```

`watch` is the non-interactive monitor. It auto-syncs local Codex sessions and prints a text dashboard. Ctrl-C to exit.

### Launch the TUI

```bash
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root /tmp/symphonyx-spike/run \
  tui --interval 1 --limit 20
```

The TUI auto-starts the repo-local daemon and auto-syncs external sessions before attaching.

### TUI views and keys

- `j/k` or `↑/↓` — move selection
- `g/G` — jump top/bottom
- `Tab` — cycle view
- `w` — workflows
- `a` — agents
- `s` — sessions
- `e` — events
- `Enter` — filter events to selected workflow
- `c` — clear workflow filter
- `r` — refresh now
- `o` — open selected agent/session target (local control)
- `R` — restart selected terminal agent from its persisted prompt artifact (local control)
- `?` or `h` — help
- `q` / `Esc` / `Ctrl-C` — quit

### Local control: `open` and `restart`

`symphonyx open` resolves a local target and either returns JSON for OMP/another opener or invokes the OS opener directly.

Capture an agent ID from the spike output (requires `jq`):

```bash
DONE_ID=$(cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root /tmp/symphonyx-spike/run \
  status --json | jq -r '.data.agents[0].id')
```

Then open or restart it:

```bash
# JSON: returns local path/handles that OMP can consume
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root /tmp/symphonyx-spike/run \
  open agent "$DONE_ID" --json

# Default: invokes OS opener (open on macOS, xdg-open on Linux, cmd /C start on Windows)
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root /tmp/symphonyx-spike/run \
  open agent "$DONE_ID"

# Restart from the persisted prompt artifact (safe local replay)
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root /tmp/symphonyx-spike/run \
  restart --agent "$DONE_ID" --json
```
`symphonyx restart --agent <id> --json` restarts only terminal/local agents where a prompt artifact exists. It creates a new run from the original prompt, runner, tool profile, and metadata without mutating history. Running or planned agents are rejected. This is **not** a live restart of an arbitrary Pi/OMP session.

### Open from Pi/OMP

Inside a Pi/OMP session you can also open a SymphonyX target directly:

```text
/symphonyx-open agent <id>
/symphonyx-open session <provider> <id>
```

The bridge runs `symphonyx open ... --json` under the hood and opens the returned path/handle via OMP's `openPath` (`@oh-my-pi/pi-coding-agent/utils/open`). If `symphonyx` is not on PATH, it falls back to `cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- open ... --json`. This is the same resolution path used by the CLI `open` command and the TUI `o` key; parser/bridge coverage lives in `packages/web-access/test/symphonyx-open.test.ts`.


You can also use the IDs printed by the spike command, or pipe `status --json` through `jq` to pick a specific agent by index or role.

## Upcoming workstreams

- `control-plane-core`: runtime substrate spike (existing Rust/TS path vs minimal Elixir/OTP orchestrator); richer ratatui actions/detail panes beyond the current read-only dashboard; Unix-socket/control API server; long-lived child continuation/steering after `run`; worktree isolation; Pi extension tool bridge; long-lived Codex app-server steer/interrupt/fork controls; reliable arbitrary live Pi-session discovery via heartbeat/cockpit plugin bridge
- `dream-memory`: delayed evidence/promotion stream for Dream/auto-learn (plan-level; not currently implemented in this package)

## Build/test

```bash
cargo test --manifest-path packages/symphony-lite-rs/Cargo.toml
```

## Examples

Use a temp root:

```bash
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root /tmp/symphonyx init --json

cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root /tmp/symphonyx status --json
```

Dry run:

```bash
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root /tmp/symphonyx \
  run \
  --prompt data/coordination/symphony-lite-subagents/workflow-v2.prompt.md \
  --title "dry worker" \
  --tool-profile reviewer-readonly \
  --dry-run \
  --json
```

Codex app-server runner (uses `codex app-server --listen stdio://`; set `SYMPHONYX_CODEX_BIN` if needed):

```bash
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root /tmp/symphonyx \
  run \
  --runner codex-app-server \
  --prompt data/coordination/symphony-lite-subagents/workflow-v2.prompt.md \
  --tool-profile reviewer-readonly \
  --json
```

Sync external sessions and monitor/TUI:

```bash
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root /tmp/symphonyx sync --json

cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root /tmp/symphonyx status --json

cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root /tmp/symphonyx tui --interval 1 --limit 20

# non-interactive fallback
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root /tmp/symphonyx watch --interval 1 --limit 20

cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root /tmp/symphonyx events tail --json --limit 50
```

TUI keys: `j/k` move, `g/G` top/bottom, `w/a/s/e` workflows/agents/sessions/events, `Enter` filter to selected workflow, `c` clear filter, `r` refresh, `o` open selected agent/session target, `R` restart selected terminal agent, `?` help, `q` quit. See [TUI views and keys](#tui-views-and-keys) above for details.

Session visibility notes:

- SymphonyX-launched Pi/Codex children are tracked as `subagents` with `session_id`, `session_file`, and live status.
- Historical Codex sessions do **not** need a plugin: `sync` reads local Codex JSONL session files and stores them in `external_sessions`.
- Historical Pi sessions can use the same `external_sessions` table once a Pi session-file scanner is added.
- Arbitrary currently-running Pi sessions need a heartbeat source (for example a small Pi extension/cockpit publisher) if SymphonyX did not launch them; file scans alone can only infer “recent/historical”, not reliable liveness.

Daemon stub:

```bash
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- --root /tmp/symphonyx up --json
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- --root /tmp/symphonyx status --json
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- --root /tmp/symphonyx down --json
```

## Design rules

- AI-first, not TUI-first.
- Humans and AI agents use the same CLI/API.
- SQLite is source of truth for important state: workflow/subagent status, external session index, structured protocol events, final previews, session ids, and searchable payloads.
- JSONL/stdout/stderr sidecar logs are **opt-in** with `--file-logs`; use them only for raw forensic/debug exports.
- One-shot child runs have an overall process-group watchdog (`--timeout-seconds`, default 900) so a stalled protocol read cannot hang forever.
- JSON output uses `{ ok, data, error }` envelopes.
- Status/event/artifact commands must return bounded previews and handles, not giant transcripts.
- Prefer Pi RPC or Codex app-server over tmux by default; tmux should be lazy materialization/debugging later.
- Enforce tool profiles with runner-native controls where available: Pi `--tools`; Codex sandbox/approval policy plus developer instructions.
- Use `insta` snapshot tests for stable CLI/API JSON shapes and event schemas when that provides better regression coverage than hand-written assertions.

## Runtime layout

Default root:

```txt
data/symphonyx/
  symphony.sqlite
  run/
    symphonyx.pid
    stop
  logs/
    daemon.log
  runs/<workflow-id>/<agent-id>/
    prompt.md
    # only when --file-logs is passed:
    events.jsonl
    transcript.jsonl
    stdout.log
    stderr.log
```

`data/` is gitignored.
