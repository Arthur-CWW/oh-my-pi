# @wirebabel/control-plane

> **Class:** Implementation facts — this documents the **actual current** CLI and SQLite stores of the
> `@wirebabel/control-plane` package as they exist in `src/`. It is not an architecture spec and defines
> no policy. The control-plane / federated-workspace **architecture authority** (data taxonomy, where each
> store's authority sits, one accountable owner vs. run provenance) is
> [`docs/fable/federated-control-plane.md`](../../docs/fable/federated-control-plane.md), which names this
> package as the canonical home for the queue / attention / routing / claims ledger (§2). The stores below
> are that home in code — not a second lifecycle, task, or wiki authority.

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

## Life queue

The life queue is durable shared state in the control-plane SQLite database. Queue writes are low-rate direct writes, separate from the daemon-owned event ledger.

```sh
bun src/cli.ts queue add --title "Follow up" --intent "Reach a resolution" --priority p1 --source manual --context-packet path/to/packet
bun src/cli.ts queue list --status paused --source session-scan
bun src/cli.ts queue show <id>
bun src/cli.ts queue start <id>
bun src/cli.ts queue pause <id>
bun src/cli.ts queue done <id>
bun src/cli.ts queue drop <id>
bun src/cli.ts queue triage
bun src/cli.ts queue scan-sessions
```

`queue triage` lists inbox items oldest-first. `queue list` filters by `--priority`, `--source`, `--status`, and `--owning-agent`; add `--oldest-first`, `--limit`, or `--json` as needed.

The abandoned-session intake scans top-level `.jsonl` and `.jsonl.zst` session logs under `~/.omp/agent/sessions/-agents/`. Its v0 heuristic treats a session as abandoned when its newest recorded timestamp is more than 48 hours old and its final message is not an error-free assistant message with `stopReason: "stop"`. Thus a final user/tool message, aborted or errored assistant message, or missing final message is considered resumable. It derives an at-most-80-character title from the first user message without an LLM call and uses `session:<session-id>` as the queue id, making reruns idempotent.

## GPT-5.6 release evidence

The package-local curator converts `../../local/gpt56-release-evidence.json` into the reproducible typed fixture. It retains only exact numeric observations, preserves extraction provenance, and records known gaps in notes rather than inventing values.

The fixture also records the official token-based Codex credit rate card. Sol's listed rates equal GPT-5.5's; Terra is one half of Sol for the same input, cached-input, and output token mix. These metered rates do not prove fixed message limits, account-specific pool/reset allowances, API price equivalence, or subscription-cost frontier equivalence.

```sh
# From packages/control-plane
bun run evidence:curate:gpt56

OUT=test/.tmp
mkdir -p "$OUT"
DB=$OUT/gpt56-release.sqlite
FIXTURE=fixtures/gpt56-release-2026-07-10.json
SCORE='["definition-deepswe-v1-1","benchmark.deepswe.pass-at-1","%","maximize","latest","point"]'
COST='[null,"cost.usd","USD","minimize","latest","point"]'

bun run src/evidence-cli.ts ingest --db "$DB" --from "$FIXTURE" --json
bun run src/evidence-cli.ts frontier --db "$DB" --work-class software-engineering --task-modality repository --axis=definition-deepswe-v1-1:benchmark.deepswe.pass-at-1:%:maximize:latest:point --axis=-:cost.usd:USD:minimize:latest:point --json
bun run src/evidence-cli.ts export --db "$DB" --work-class software-engineering --task-modality repository --axis=definition-deepswe-v1-1:benchmark.deepswe.pass-at-1:%:maximize:latest:point --axis=-:cost.usd:USD:minimize:latest:point --format json --out "$OUT/gpt56-frontier.json"
bun run src/evidence-cli.ts export --db "$DB" --work-class software-engineering --task-modality repository --axis=definition-deepswe-v1-1:benchmark.deepswe.pass-at-1:%:maximize:latest:point --axis=-:cost.usd:USD:minimize:latest:point --format csv --out "$OUT/gpt56-frontier.csv"
bun run src/evidence-cli.ts export --db "$DB" --work-class software-engineering --task-modality repository --axis=definition-deepswe-v1-1:benchmark.deepswe.pass-at-1:%:maximize:latest:point --axis=-:cost.usd:USD:minimize:latest:point --format svg --x "$COST" --y "$SCORE" --out "$OUT/gpt56-frontier.svg"
```

For later releases, append only a named benchmark catalog row when an official source identifies it. An unreleased row carries no metric definition, run, or measurement until exact release-window evidence exists.
