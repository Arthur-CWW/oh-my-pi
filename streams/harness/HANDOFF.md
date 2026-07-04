# Harness stream — handoff (2026-07-04)

Boot doc for the next orchestrator session on this stream. Predecessor: Opus-orchestrated harness lane, 2026-07-04 (session notes in commits `8556386b`..`2069638d` + this doc's State section).

## Boot sequence

1. Read `streams/harness/GOAL.md`, then `docs/plans/pi-agent-control-plane.md` (**spec v1 — the load-bearing artifact**), then `docs/state/harness-friction.md`, then `docs/state/side-quests.md`.
2. Check `irc list` and `cmux list-workspaces` — sibling sessions may be live; do not disturb their streams.
3. You orchestrate at `:medium`. All implementation → GPT-5.5 lanes. Design/UI → designer. Research/retrieval → kimi lanes. You write code only for trivial inline fixes.

## State (what is done)

- **Control-plane spec v1** at `docs/plans/pi-agent-control-plane.md`: L0-L4 layers, settled decisions (Bun+Effect v4, SQLite, harness-agnostic, no OTel), model_calls-first telemetry with session-mutation events + per-turn fatigue proxies + affect channels, hypotheses-as-acceptance, provenance (commit trailers), fork/hot-swap/steer contracts, M1-M4 with click/run proofs, influences section.
- **Fork batch landed** (`vendor/oh-my-pi`, commits `8556386b`, `6d9d767a`): omp irc CLI hang fixed, mid-turn ask presence, task `timeoutSec` + timeout partial results, per-spawn `model` override with resolved-chain receipts. Package check green, 230/230 targeted tests.
- **Research**: `docs/research/opencode-vs-omp.md` (verdict: keep OMP as L1, adopt OpenCode server/plugin/observability layers piecemeal), `docs/research/xjdr/` (jj/SCM/scaling archive + synthesis), DST research in flight → `docs/research/dst-scaled-down.md`.
- **Fork reinstall PENDING**: installed omp binary (`fork.90c64256`) predates today's fixes and external-bus peer registration; reinstall per `docs/plans/omp-fork-install.md` so `omp irc list` sees live sessions. Do this early — it unblocks cross-session messaging.

## Next work: M1 (event ledger + model-call telemetry)

Per spec v1 milestones. Recommendation already in spec open-questions: new `packages/control-plane` package, `packages/web-access/src/agent-cockpit*` as donor code only. First slice:

1. Decide typed-DB (`@effect/sql` vs Drizzle+Effect wrapper) — criterion in spec; document the rejected option.
2. Schema + migrations for `sessions/branches/turns/events/model_calls/artifacts` (open-union events).
3. Effect instrumentation lib (custom exporter Layer → ledger rows, NOT OTLP).
4. OMP publisher extension writing rows from a live session.
5. CLI `status --json` / `model-calls --json`.
Acceptance proof (from spec): fixture or live-session run producing queryable rows + CLI output showing model/provider/tokens/cost/latency/outcome + raw-request artifact linkage.

## Operating contract (Arthur, 2026-07-04)

- **Commit per block of work.** Focused messages; never commit red.
- **Checkpoint Arthur ONLY at playable artifacts** — something he can click/run/put input into (e.g. the M2 HTML viewer). He polls asynchronously; do not ping for intermediate states. Everything below that bar: figure out how to test it yourself. Testing is very important.
- **Subagent budget**: `task.softRequestBudget: 40` in `.omp/*-config.yml` → soft notice at 40 req, HARD CANCEL at 60 (evicts agent, no output). Slice packets to fit; every packet writes its report/output file FIRST and appends incrementally; raise the setting deliberately only for a packet class that needs it.
- **Woken-agent results go stale**: after `irc` re-wake, `job poll` returns the pre-wake payload forever — read the report file / worktree / `history://<id>` instead.
- Self-contained packages (own package.json, no root edits), portless for any web surface, no WebKit/cmux fixes, no sudo, no secrets in commits.

## Open questions for Arthur (raise only in decision mode, not creative mode)

- Typed-DB choice if the criterion doesn't decide it cleanly.
- Turso/libSQL trigger condition.
- GOAL.md-level: none new; spec v1 open-questions section is the list.
