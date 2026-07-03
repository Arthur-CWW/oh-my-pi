# SymphonyX runtime substrate spike proof — 2026-06-23

Claim: the current Rust/SQLite SymphonyX prototype can prove the first `control-plane-core` vertical-slice path without TUI or live Pi/Codex runners.

## Changed surface

- `packages/symphony-lite-rs/src/main.rs`
  - Added `symphonyx spike --task-list <path> --json`.
  - Reads a local task list.
  - Persists one workflow row, three subagent rows, prompt artifacts, one external session row, and events.
  - Produces one done dry-run worker, one blocked dry-run worker, and one simulated crashed worker with explicit failed state.
  - Returns bounded `StatusOutput` in the JSON envelope.
- `packages/symphony-lite-rs/README.md`
  - Lists the new spike command under current capabilities.

## Verification commands

```bash
cargo test --manifest-path packages/symphony-lite-rs/Cargo.toml
```

Result: passed, 9 tests.

```bash
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root data/symphonyx-spike/run \
  spike \
  --task-list data/symphonyx-spike/tasks.txt \
  --json
```

Result: passed. Output JSON included:

- `counts.workflows = 1`
- `counts.agents_done = 1`
- `counts.agents_blocked = 1`
- `counts.agents_failed = 1`
- `counts.external_sessions = 1`
- workflow status `blocked`
- agents: `spike-done-worker`, `spike-blocked-worker`, `spike-crash-simulation`

```bash
cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- \
  --root data/symphonyx-spike/run \
  events tail --json --limit 20
```

Result: passed. Event stream included:

- `workflow.spike.started`
- `agent.planned`
- `agent.status` with `running`, `done`, `blocked`, and `failed`
- `agent.crash_simulated`
- `session.observed`
- `workflow.status`

`data/symphonyx-spike/` is ignored local proof data. Recreate the proof input with any two non-empty task lines, then rerun the smoke command above with a fresh `--root` directory.

No Elixir/Pi/Codex install was required. If a later spike needs a toolchain install, use `mise` per Arthur's 2026-06-23 instruction.

## Monitoring and opening

After the spike, choose one of these surfaces:

- Inspect state: `cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- --root data/symphonyx-spike/run status --json`
- TUI: `cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- --root data/symphonyx-spike/run tui`, then `o` to open the selected target or `R` to restart a terminal agent.
- Pi/OMP bridge: `/symphonyx-open agent <id>` (or `/symphonyx-open session <provider> <id>`). The bridge resolves through `symphonyx open ... --json` and opens the result via OMP's `openPath`; if `symphonyx` is not on PATH, it falls back to `cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- open ... --json`. Verified by `bun test packages/web-access/test/symphonyx-open.test.ts`.
