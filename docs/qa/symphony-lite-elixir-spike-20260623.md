# Symphony Lite Elixir/OTP spike proof — 2026-06-23

Claim: `packages/symphony-lite-elixir` provides the first local Elixir/OTP substrate spike behind the Symphony Lite JSON/SQLite/API boundary, without live Pi/OMP/Codex mutation.

## Implemented surface

- `packages/symphony-lite-elixir/`
  - Mix app `:symphony_lite_elixir`, `elixir: "~> 1.20"`.
  - Escript CLI `bin/symphony_lite_elixir`.
  - `spike --root <dir> --task-list <path> --json`.
  - `import --root <dir> --task-list <path> --json`.
  - `next --root <dir> --json`.
  - `claim --root <dir> --packet <id> --owner <name> --json`.
  - `paths --root <dir> --packet <id> --json`.
  - `proof add --root <dir> --packet <id> --path <proof-path> --kind <kind> --json`.
  - `status --root <dir> --json`.
  - `runner --kind <dry-run|pi-rpc|omp-cli> --prompt <path> --json`.
- Durable state uses SQLite at `<root>/symphony.sqlite` via `/usr/bin/sqlite3`.
- JSON uses Erlang/OTP `:json` through Elixir 1.20 / OTP 28.
- Runner command construction is modeled only; no live Pi/OMP/Codex command is executed.
- OpenAI Symphony upstream mirror: `vendor/openai/symphony`.
- OpenAI Symphony reuse map: `docs/research/openai-codex-symphony/reuse-map.md`.
- Jido evaluation note: `docs/research/openai-codex-symphony/jido-note.md`.

## Verification

```bash
cd packages/symphony-lite-elixir && mise exec erlang@28.5 elixir@1.20.1-otp-28 -- mix format --check-formatted
```

Result: passed after adding `.formatter.exs` and formatting the package.

```bash
mise run symphony-elixir-check
```

Result: passed, 10 tests, including packet import/next/claim/paths/proof/status behavior, positive proof IDs, and no packet ID reuse after deletion.

```bash
mise run symphony-elixir-build
```

Result: passed; generated `packages/symphony-lite-elixir/bin/symphony_lite_elixir` locally.

```bash
rm -rf data/symphony-lite-elixir-spike/run && mise run symphony-elixir-spike
```

Result: passed. The spike emitted a JSON envelope and persisted:

- `workflows = 1`
- `agents = 3`
- `done = 1`
- `blocked = 1`
- `failed = 1`
- `external_sessions = 1`
- `events = 10`

```bash
cd packages/symphony-lite-elixir && \
  mise exec erlang@28.5 elixir@1.20.1-otp-28 -- \
  ./bin/symphony_lite_elixir status \
  --root ../../data/symphony-lite-elixir-spike/run \
  --json
```

Result: passed. Status JSON showed events including:

- `workflow.spike.started`
- `agent.planned`
- `agent.status`
- `agent.crash_simulated`
- `session.observed`
- `workflow.status`

```bash
mise run symphony-elixir-build
```

Result: passed; generated `packages/symphony-lite-elixir/bin/symphony_lite_elixir` locally.

```bash
rm -rf data/symphony-lite-elixir-packets/run && mkdir -p data/symphony-lite-elixir-packets && \
  printf '%s\n' 'Packet ledger CLI smoke' 'Local task import smoke' 'Proof attachment smoke' > data/symphony-lite-elixir-packets/tasks.txt && \
  cd packages/symphony-lite-elixir && \
  ROOT=../../data/symphony-lite-elixir-packets/run && \
  TASKS=../../data/symphony-lite-elixir-packets/tasks.txt && \
  mise exec erlang@28.5 elixir@1.20.1-otp-28 -- ./bin/symphony_lite_elixir import --root "$ROOT" --task-list "$TASKS" --json && \
  mise exec erlang@28.5 elixir@1.20.1-otp-28 -- ./bin/symphony_lite_elixir next --root "$ROOT" --json && \
  mise exec erlang@28.5 elixir@1.20.1-otp-28 -- ./bin/symphony_lite_elixir claim --root "$ROOT" --packet packet-1 --owner Main --json && \
  mise exec erlang@28.5 elixir@1.20.1-otp-28 -- ./bin/symphony_lite_elixir paths --root "$ROOT" --packet packet-1 --json && \
  mise exec erlang@28.5 elixir@1.20.1-otp-28 -- ./bin/symphony_lite_elixir proof add --root "$ROOT" --packet packet-1 --path docs/qa/symphony-lite-elixir-packet-ledger-20260623.md --kind qa-note --json && \
  mise exec erlang@28.5 elixir@1.20.1-otp-28 -- ./bin/symphony_lite_elixir paths --root "$ROOT" --packet packet-1 --json && \
  mise exec erlang@28.5 elixir@1.20.1-otp-28 -- ./bin/symphony_lite_elixir status --root "$ROOT" --json
```

Result: passed. The packet smoke showed `owner_paths:["Main"]`, proof id `1`, persisted proof hints under `paths`, and status previews for `packet_events`, `packet_ownership`, and `packet_proofs`.

```bash
cargo test --manifest-path packages/symphony-lite-rs/Cargo.toml
```

Result: passed, 9 tests. Rust baseline remains green.

## Rerun notes

Use `mise`; do not call bare `mix`, `elixir`, or `escript` unless the shell already has the correct versions selected.

Expected toolchain command pattern:

```bash
mise exec erlang@28.5 elixir@1.20.1-otp-28 -- mix test
```

`data/symphony-lite-elixir-spike/` is local proof data. Recreate `tasks.txt` with at least two non-empty, non-comment lines before running `mise run symphony-elixir-spike`.

## Monitoring and opening

The Elixir spike does not include an open/restart bridge. After running the spike, switch to the Rust CLI/TUI or the Pi/OMP bridge to inspect and open targets:

- Inspect state: `cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- --root data/symphonyx-spike/run status --json`
- TUI: `cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- --root data/symphonyx-spike/run tui`, then `o` to open or `R` to restart a terminal agent.
- Pi/OMP bridge: `/symphonyx-open agent <id>` (or `/symphonyx-open session <provider> <id>`). Resolves through `symphonyx open ... --json` and opens via OMP's `openPath`; falls back to `cargo run --manifest-path packages/symphony-lite-rs/Cargo.toml -- open ... --json` if `symphonyx` is not on PATH. Verified by `bun test packages/web-access/test/symphonyx-open.test.ts`.
