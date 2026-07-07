# Harness control primitives — tracker & triage

Status: living tracker
Date: 2026-07-07 (created; update in place, reconcile don't append)
Owner: harness stream
Reads with: `docs/plans/pi-agent-control-plane.md` (spec v1 — the L2/L3 contracts these primitives feed), `docs/state/harness-friction.md` (papercut ledger), `docs/fable/harness-brief.md` (iteration queue).

## North star

Agents are manageable processes: any live agent — subagent or session — can be **inspected, interrupted, resumed, hot-swapped, and attributed** without losing its context. Each primitive lands OMP-native first (usable today), with contracts shaped so control-plane M2–M4 can absorb them as ledger rows/commands instead of rewrites.

## Primitives

| Primitive | Status | Where | Next |
|---|---|---|---|
| Hot-swap subagent model | **SHIPPED** 2026-07-07 (`b5d9db5a`) | `job setModel {id, model, reason?}`; `src/task/hotswap.ts`; boundary apply, JSONL role `hotswap`, child notified, revive-safe | Rebuild/reinstall fork binary to activate in live sessions |
| Per-provider fast mode | **SHIPPED** 2026-07-07 (`781cf956`) | `/fast on gpt`, `/fast off claude`; `setFastMode(enabled, scope?)` | Same rebuild caveat |
| Hot-swap MAIN agent of another session | QUEUED — scouting | irc external bus (SQLite, `agents-xxxxxx` peers) carries text only today | Scout: structured command envelope over the bus + receiving-side handler/allowlist; decide surface before building (`ControlSeamScout`) |
| Interrupt subagent (abort turn, keep alive + addressable) | IN PROGRESS — scouting | today only `job cancel` (hard) and irc steer (message injection) | Add `job interrupt` (or equivalent): abort in-flight turn, session stays idle/registered, optional steer note; scout maps `session.abort` semantics first |
| Interrupt another session | QUEUED | irc steer messages only | Same command-envelope design as cross-session swap; one mechanism for both |
| Resume session (`--resume`/`--continue`) | **BROKEN** (friction 2026-07-04, no repro) — root-causing now | known: `--continue` keyed to terminal-ID breadcrumb invalidated by force-closed terminals; single-writer JSONL lock suspects | `ResumeRootCause` scout → fix top causes this batch |
| Resume/revive subagent | WORKS | park→revive (`AgentLifecycleManager`), keep-alive after timeout (`timeoutSec` fix 2026-07-04), hotswap survives revive | — |
| Session fork / tree view | DEGRADED (friction 2026-07-04: "concept loved, behavior kind of broken") | candidates: stale tree state, wrong branch selection on resume | Same scout; fix if root cause surfaces, else capture exact repro next occurrence |
| Fresh results from woken agents | **BROKEN** (friction 2026-07-04, observed 3× + again 2026-07-07) | `job poll` returns pre-wake payload forever; truth only in report files/`history://` | Fix this batch: re-bind job result on later yields (`ControlSeamScout` maps the seam) |
| Transcript provenance (which agent wrote what) | PARTIAL | in-session: JSONL `model_change` roles, custom-message `attribution`, irc sender ids, task spawn records. Cross-session/commit: control-plane M1 ledger shipped (sessions/branches/turns/events rows); commit trailers + `commits` table = M3 | Don't build ad-hoc: M2 viewer exposes rows; M3 adds commit provenance. Scout inventories what's already answerable from a session file |
| Attach/steer live subagent | WORKS | irc injection (step-boundary fold-in), `history://` transcripts | Absorbed by control-plane L2 bus contract later |

## Friction triage (open items → disposition)

From `docs/state/harness-friction.md` Open, 2026-07-07 pass:

**Fix this batch (worker-sized, harness lane):**
- Session resume broken + fork/tree misbehavior — see primitives table.
- Stale job results after irc wake — see primitives table.

**Queued worker fixes (next batches, in rough priority order):**
1. Per-spawn budget override on `task` (`SpawnPacket.budget` in spec v1) + cancelled agents should park with report path instead of evict — pairs with the interrupt primitive.
2. Role-indirection opacity: spawn-time resolved-model visibility (task results now carry `resolvedModel`; surface it in spawn receipts + roster).
3. Runtime model-role overrides need a `/reload`-visible surface (CLI overrides silently shadow disk).
4. Eval-bridge `agent()` abort quirk (bridge raises "subagent failed" after abort despite completion).
5. Ctrl-S swallowed when parent TTY has software flow control pre-raw-mode.
6. Codex two-account rotation for explicit refreshes (`codex-refresh-policy.ts` has no rotation).
7. Auth-broker readline Escape handling (not TUI-keybinding hosted). Low.
8. `/export` default path policy docs. Low.

**Design first (no code until decided):**
- Cross-session command channel (swap/interrupt/status of another session's main agent) — smallest honest surface over the existing irc bus; receiving-side approval model. Scout in flight.
- Advisory reliability (confidently wrong advisories) — tuning/eval question, route to reviewer-lane checklist not code.
- Functional-emotion indicator — prefer instrumented signals (telemetry exists in control-plane M1); design in M2 viewer context.
- Cross-session memory — evaluate OMP `memory.md`/mnemosyne backends BEFORE building (explicit friction-log constraint); legible/auditable channel only.

**Routed elsewhere / not harness code:**
- cmux WKWebView breaks apps → interim stands (Chrome app-mode); real fix is vendored-cmux Swift work or upstream ask. Parked.
- cmux markdown link rendering. Parked with above.
- Subagent sandbox blocks SQLite/tmp writes → sandbox policy decision, workaround stands (coordinator gates, repo-local `test/.tmp`).
- Anthropic content-filter kills on large single-file HTML emissions → practice stands (chunked writes <~150 lines); candidate first-mistake tripwire, guardrail-ladder rung 2.
- Root `package.json` collision point → migrate to workspace-filtered scripts after per-package gate audit; coordinate cross-stream, not a solo harness change.
- Borges local catalog → primer stream backlog, not harness.

**High-level queue (unchanged, lives in `docs/fable/harness-brief.md`):** per-agent skill/tool exposure; orchestrator UI = control-plane M2 (status/query API + HTML viewer + SSE); packet template as first-class dispatch; dreaming loop (gated). M2 is the next big slice after this control-primitives batch.

## Commit plan (this batch)

1. ~~`omp fork: hot-swap subagent models via job setModel`~~ — `b5d9db5a`
2. ~~`omp fork: /fast accepts a provider scope`~~ — `781cf956`
3. This tracker doc.
4. `omp fork: resume robustness` — per `ResumeRootCause` findings (breadcrumb fallback + top failure modes). Separate commit per independent cause if they don't share code.
5. `omp fork: job results refresh on woken-agent yields`.
6. `omp fork: job interrupt — abort turn, keep subagent alive`.
7. Cross-session command channel: design note first (append here), implementation only after surface is settled.
