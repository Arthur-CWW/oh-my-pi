# @wirebabel/control-plane

## Routing knowledge store

The routing store is a machine-global SQLite substrate for empirical lane routing decisions. It lives in the same database as the ledger by default (`AGENT_CONTROL_PLANE_DB` or `~/.agent-control-plane/ledger.sqlite`) but has a different write contract: ledger event ingestion remains daemon/single-writer, while `routing_observations` and `lane_state` are low-rate shared-state tables that sessions may update directly.

### CLI examples

```sh
bun src/cli.ts routing seed --db test/.tmp/routing.sqlite --json
bun src/cli.ts routing observe --db test/.tmp/routing.sqlite --lane openai-codex/gpt-5.5 --work-type session-lifecycle-code --verdict strength --note "Completed a literal packet cleanly." --confidence 0.8 --json
bun src/cli.ts routing log --db test/.tmp/routing.sqlite --lane openai-codex/gpt-5.5 --limit 5 --json
bun src/cli.ts routing lanes --db test/.tmp/routing.sqlite
bun src/cli.ts routing brief --db test/.tmp/routing.sqlite --lane openai-codex/gpt-5.5 --json
```

`routing observe` accepts caller-supplied `--id` for idempotent `INSERT OR IGNORE`; without it the CLI generates a UUID-backed id. `routing seed` is idempotent and installs the 2026-07-03 temperament hypotheses plus the 2026-07-07 current account state.
