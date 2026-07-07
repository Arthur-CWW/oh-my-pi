# Harness stream — handoff (2026-07-04, evening)

Boot doc for the next orchestrator session on this stream. Predecessor: Fable-orchestrated harness lane, 2026-07-04 (fork reinstall + control-plane M1; commits `b401a47f`..this doc).

## Boot sequence

1. Read `streams/harness/GOAL.md`, then `docs/plans/pi-agent-control-plane.md` (**spec v1 — the load-bearing artifact**; open questions 1–2 now settled, new binding sections: "Testing strategy: scaled-down DST" and "Durability and ingestion contract"), then `docs/plans/control-plane-m1.md` (COMPLETE — the M1 implementation contract, still the schema/wire reference), then `docs/state/harness-friction.md` and `docs/state/side-quests.md`.
2. Check `irc list` and `cmux list-workspaces` — sibling sessions may be live; do not disturb their streams.
3. You orchestrate at `:medium`. All implementation → GPT-5.5 lanes. Design/UI → designer. Research/retrieval → kimi lanes. You write code only for trivial inline fixes.

## State (what is done)

- **Fork reinstall DONE** (`b401a47f`): installed binary is `omp/16.0.1+fork.8a2fc866881f`; mise tasks repointed at `vendor/oh-my-pi` (fork moved under vendor/); retired stale spec-driven-overlays skill link/check; `mise run omp-doctor` green; one-shot `omp irc list` exits <1s. Live sessions register on the external bus as they restart onto the new binary.
- **Control-plane M1 COMPLETE** (`d6804889`, `3ab250ef`; contract `docs/plans/control-plane-m1.md`): `packages/control-plane` — Drizzle+bun:sqlite ledger (9 row families, idempotent INSERT OR IGNORE writes, WAL+NORMAL), Effect `LedgerStore` service/Layer, telemetry lib (`withModelCall`/`withProviderCall`), OMP publisher extension (outbox JSONL, never touches SQLite), idempotent outbox ingest with rawRequest artifact materialization, `status/model-calls/events/ingest` CLI with `--json` parity. Gate: `bun run check` (10 tests / 165 assertions). Acceptance: `bun run proof` — publisher→outbox→ingest→CLI chain, 0 malformed, model-calls JSON carries tokens/cost/latency/outcome + rawRequestArtifact ids, re-ingest fully ignored.
- **Scout map**: `docs/research/pi-agent-control-plane/omp-publisher-seams.md` — OMP extension API/hooks/telemetry facts with file:line evidence. Load-bearing for M2 live wiring.
- **Research landed**: `docs/plans/harness-research.md`, `docs/research/dst-scaled-down.md` (day-one DST rules now in spec + M1 contract).
- **Budget**: fable overlay `task.softRequestBudget` raised 40→80. CAVEAT: config is read at spawn — a raise never protects already-running workers (P1 died at 60 anyway; survived via files on disk + coordinator gate).
- **Subagent model hot-swap SHIPPED** (2026-07-07, `b5d9db5a`): `hotswapAgentModel` primitive (`vendor/oh-my-pi/packages/coding-agent/src/task/hotswap.ts`) + `job setModel {id, model, reason?}` op. Boundary semantics (idle immediate / streaming agent_end, last-wins), JSONL role `hotswap`, child gets a hidden next-turn notice, park→revive restores swapped model + persisted thinking (auth-gated). Spec v1 hot-swap contract's "durable swap metadata + agent must know" satisfied for subagents; pause-at-boundary for the MAIN agent and control-plane `hotswap` event rows remain M4. NOT in the installed binary yet — needs a fork rebuild/reinstall to take effect in live sessions.
- **Per-provider fast mode SHIPPED** (2026-07-07, `781cf956`): `/fast on gpt`, `/fast off claude`, bare `/fast gpt`; `setFastMode(enabled, scope?)` set arithmetic over service tiers, session-scoped, never writes `fastModeScope`. Same rebuild caveat.
- **Control-primitives batch SHIPPED** (2026-07-07, tracker `docs/plans/harness-control-primitives.md`): resume robustness (`ca51962d` — persisted `leaf_change` active-leaf metadata fixes wrong-branch-on-resume AND the broken tree view; `--continue` same-cwd breadcrumb fallback + provenance notice; discovery skip diagnostics), `job interrupt` + fresh woken-agent results (`f5c07cdb`). Full friction triage with dispositions lives in the tracker; cross-session command channel is DESIGNED (envelope over irc SQLite bus, ask-gated) but awaits Arthur's surface approval. Everything needs the fork rebuild/reinstall to reach live sessions.

## Next work: M2 (status/query API + first HTML viewer)

Per spec v1 milestones: daemon/API over the same LedgerStore, HTML log/session viewer reading the same rows (high-level board → drill into one session → open a raw model request), SSE updates during a fixture run. Notes:

- Daemon is the sole ledger writer tailing outboxes (ingestion contract in spec); M1 shipped the one-shot `ingest` — M2 makes it a supervised loop.
- Wait-on-row/change sourcing decision queued in side-quests: daemon owns writes → in-process PubSub + SSE; no DB-level CDC.
- Review surface must be portless (`bunx portless <name> …`), Chrome app-mode (cmux WKWebView breaks real apps — see friction log), one error log per app, dev server supervised.
- **Live publisher wiring is opt-in and NOT yet done**: the extension ships at `packages/control-plane/src/omp-publisher.ts` (declared in the package's `omp.extensions`); wire a live session via project `.omp/settings.json#extensions` → `~/agents/packages/control-plane` or `omp -e`. Decide with a live smoke before making it default for all sessions. Outbox lands in `~/.agent-control-plane/outbox/` (env `AGENT_CONTROL_PLANE_OUTBOX_DIR`).
- Known M1 residue: publisher fills `machine/effort/promptHash/systemPromptHash/skillProfile/contextManifest` with `"unknown"` placeholders (real capture needs deeper OMP seams — scout report Q3); `rawResponseArtifact` not yet captured; provider_calls path unexercised by the publisher (telemetry lib covers it).

## Operating contract (Arthur, 2026-07-04)

- **Commit per block of work.** Focused messages; never commit red.
- **Checkpoint Arthur ONLY at playable artifacts** — something he can click/run/put input into (the M2 HTML viewer is the next such artifact). Everything below that bar: test it yourself.
- **Subagent packets**: report/output file FIRST, append incrementally; workers do not run package commands — the coordinator gates in the parent shell (subagent sandbox blocks SQLite/tmp writes anyway).
- **Woken-agent results go stale**: after `irc` re-wake, `job poll` returns the pre-wake payload forever — read the report file / worktree / `history://<id>`.
- **Seam lesson (M1)**: two parallel packets sharing a wire format WILL drift — require an integration test that drives producer output through the consumer (`test/publisher-ingest.test.ts` is the pattern) and gate on it.
- Self-contained packages (own package.json, no root edits), portless for any web surface, no WebKit/cmux fixes, no sudo, no secrets in commits.

## Open questions for Arthur (raise only in decision mode)

- Turso/libSQL trigger condition (spec open question 3).
- Onboarding interview formalization depth (spec open question 4).
- When (if ever) the OMP publisher becomes default-on for all sessions vs opt-in per project.
