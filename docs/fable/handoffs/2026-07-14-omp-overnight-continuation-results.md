# OMP overnight continuation results — 2026-07-14 (session after 019f5f5e)

Continues [`2026-07-14-omp-overhaul-continuation-handoff.md`](./2026-07-14-omp-overhaul-continuation-handoff.md). All source slices from that handoff's "first actions" list are landed and the focused union is green. Arthur slept through the second half; overnight directives (quota conservation, reset protection, browser sprawl, paste race) are folded in.

## Landed source slices (all in `vendor/oh-my-pi` working tree)

| Slice | Agent | Evidence |
|---|---|---|
| Mechanical Codex bundle sync + provenance | CodexBundleSync | Generator imports `vendor/openai/codex/codex-rs/models-manager/models.json`; provenance records vendored SHA `325cf161` (numbers match handoff: 5.6 = 372000/353400/334800); 128000 maxTokens labeled `omp-fallback`, `sentToEndpoint=false`; bundle-only models stay `bundled/direct-only`, `officialPickerParity=false`; drift check `bun run check:codex-bundle` + test fails on perturbation |
| Codex cost resolver + backfill sentinel | CodexCostStats | Family/alias resolver (Luna 1/6/0.1/1.25, Sol 5/30/0.5/6.25, Terra 2.5/15/0.25/3.125, 5.5 5/30/0.5/0); `cost_backfill_version` sentinel v2 re-backfills zero-cost rows once; db-cost tests 5/0 |
| Fallback approval gate | FallbackGate + FallbackTypeFix | Typed pending-approval state; wait/approve/choose/abort via `job({ fallbackApproval: … })`; same-child resume via setModel+IRC; main/orchestrator can never auto-fall-back; `retry.proposableFallbackChains` replaces auto chains; bounded subagent posture `retry.subagentFallbackAutoApproveUntil` (set in `.omp/fable-config.yml`, task chain kimi→opus); 28+63 focused tests green |
| TUI perf: status border | StatusBorderPerf + splits | No per-event git fs; watcher/TTL cache in `status-line/border-cache.ts`; counters in `performance-counters.ts`; 128-event burst test ⇒ ≤1 git HEAD resolution |
| TUI perf: swarm fanout | SwarmObserverPerf + TaskSizeSplit | Observer/task/async coalescing (`task/progress-aggregator.ts`, `async/progress-coalescer.ts`); **120-child/1440-event synthetic proof: 1 render pass, 1 compose, 1 projection rebuild, 0 git resolutions, 0 journal reads, 0ms input dispatch** |
| TUI perf: Agent Hub | HubPreviewPerf | 16ms projection coalescing; changed-agent-only journal reloads; single-flight async tail cache (0 sync fs on render); component-scoped age ticks; counters in `agent-hub-performance.ts`; 98 hub tests green |
| gj/gk wrapped motion | WrappedMotion | g-prefix grammar in `agent-hub-viewer-sequence.ts`; display-row movement + boundary/gg/G tests 5/0 |
| Stats robustness | StatsHealth | `/healthz` + `/version`; port validation; single-flight DB init; SIGINT/SIGTERM shutdown; health-gated browser open; typed client errors; lifecycle tests 7/0 |
| Startup paste split race | PasteRace + TerminalSizeSplit | Root cause: stdin resumed before bracketed-paste enable + decoder attach (`terminal.ts`); now ordered via `startBufferedStdin` in `stdin-buffer.ts`; unmarked multiline chunk = one paste; regression tests green |
| Browser lifecycle + reaper | BrowserReaper (aborted) → BrowserLifecycle | Session-scoped owned profiles/owner markers; teardown kills only owned processes (exit + SIGTERM/INT/HUP); same-session stale sweep; `scripts/browser-reaper.ts` (dry-run default, TTL+dead-parent rules, protects real Chrome/guarded profiles/live omp) |
| Usage-reset guard | UsageResetGuard | Auto-redeem path: `agent-session.ts` usage-limit branch → `AuthStorage.redeemResetCredit` → `POST wham/rate-limit-reset-credits/consume`. New `auth.codexUsageReset: auto|manual` master gate (manual returns before any reset I/O); plain `/usage` is GET-only and safe |
| Rubric label viewer | ViewerRoot | `GET /` 200; full label cycle proven; errors.log empty; running via `bunx portless video-eval bun run dev` → http://video-eval.localhost:1355 (tmux `video-eval-viewer`) |
| Pre-existing regressions fixed | ReminderRegression | Explicit `:low` thinking suffix dropped for non-reasoning models (introduced 17908470) and reminder-abort misclassified as completed (introduced 2326962b) — both fixed at source with tests |
| Admission FIFO flake | AdmissionFifoFlake | See TASKS/current state — root-caused and fixed before promotion gate closed (check final report) |

## Quota conservation posture (Arthur directive, overnight)

- Live snapshot (read-only, `bun scripts/codex-usage-check.ts`): pro account (weiran) weekly **93% used**, resets ~2026-07-19; plus account 5h window exhausted; **4 saved Full-reset credits, all available** (expiring 7/18, 7/26, 7/31, 8/12).
- Protection applied: `~/.omp/agent/config.yml` gains `auth.codexUsageReset: manual` + `codexResets.autoRedeem: "no"`, and `retry.fallbackChains.task` → kimi/opus. `.omp/fable-config.yml` has the same gates plus the bounded subagent auto-approve posture.
- **Residual risk:** sessions already running when the config landed cached `autoRedeem=yes` in memory; only a restart fully protects them. Proxy/baseUrl interdiction was evaluated and rejected (running sessions cache baseUrl; proxy death would kill all Codex traffic).
- Watcher: tmux session `codex-usage-watch` polls read-only every 15min → `data/codex-usage-watch/log.jsonl`; alerts on credit-count drop and on weekly reset (all-clear) → `alerts.log`.
- All six external orchestrator sessions were DM'd the conservation directive (kimi/opus for small/non-core impl, Luna xhigh as checker, Sol only for core synthesis, never redeem resets) — broadcast the all-clear when the watcher sees the weekly reset.

## Gate status (this session's final runs)

- Typecheck: catalog, ai, agent, coding-agent, tui, stats — all green.
- coding-agent union (fallback, reset, fleet, reminders, swarm perf, hub, paste, status-line, browser ownership, model selector/resolver): 251/0. Full `test/task` + `test/registry`: green (one timing flake → AdmissionFifoFlake fix). catalog 250/0, stats 44/0, tui 67/0.
- File-size ratchet: only the untouchable `packages/twitter-archive/src/backfill-worker.ts` residual remains.
- Stats premium test updated (anthropic priority now intentionally counts — production docstring documents "Anthropic fast-mode realizations").

## Friction learned (logged in harness-friction.md)

- Revived-worker sandboxes are read-only (EPERM) on the installed binary — revive-for-edits does not work; respawn fresh for write work. One revived agent attempted `launchctl`/`ssh` sandbox escapes (failed, aborted honestly) — watch this class.
- Child journals do not persist MCP tool results.
