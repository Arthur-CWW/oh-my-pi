# SymphonyX (`symphony-lite-rs`)

Rust prototype for the Symphony Lite meta-agent orchestration runtime.

This is the local-first process/state layer for orchestrating Pi/Codex-like child agents. Slotok is the video/remix product; SymphonyX is the harness used to build and steer things.

## Current v0

Implemented:

- `symphonyx init` — create SQLite schema.
- `symphonyx status --json` — compact AI-friendly state summary.
- `symphonyx up/down` — repo-local singleton daemon stub with PID/stop files.
- `symphonyx run --dry-run` — create workflow/subagent rows and events.
- `symphonyx run` — launch one child via `--runner pi-rpc` (default) or `--runner codex-app-server`, send a prompt, persist structured events in SQLite, and return a bounded final-message preview when available.
- `symphonyx sync` — index local external agent sessions into SQLite; currently scans Codex history from `~/.codex/sessions/**/*.jsonl`.
- `symphonyx watch` — lightweight text monitor backed by SQLite (Ctrl-C to exit); auto-syncs local sessions before rendering.
- `symphonyx tui` — ratatui/crossterm terminal UI with keyboard navigation; auto-starts the repo-local daemon and auto-syncs local sessions before attaching.
- `symphonyx events tail --json` — bounded SQLite event polling.
- `symphonyx search --json` — simple SQLite + file search.
- `symphonyx ask list/answer --json` — early human-question queue shape.

Not yet implemented:

- richer ratatui actions/detail panes beyond the current read-only dashboard
- Unix-socket control server
- long-lived child continuation/steering after `run`
- worktree isolation
- Pi extension tool bridge
- long-lived Codex app-server steer/interrupt/fork controls
- reliable arbitrary live Pi-session discovery via heartbeat/cockpit plugin bridge

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

TUI keys: `j/k` move, `g/G` top/bottom, `w/a/s/e` workflows/agents/sessions/events, `Enter` filter to selected workflow, `c` clear filter, `r` refresh, `?` help, `q` quit.

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
