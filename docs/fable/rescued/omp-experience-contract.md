> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-11T02-43-53-887Z_019f4f0f-599f-7000-827a-cb4f1ffded60/local/omp-experience-contract.md

# OMP Experience Contract (redesign, 2026-07-12)

Authored after Arthur's Fable swap-in request: step back, understand intent, redesign to fix the lived experience rather than broaden internal parity.

## Arthur's actual complaints (verbatim intent)

1. OMP is "super laggy with the beachball loading cursor" on interaction. — P0, live.
2. Buggy UI/UX in the TUI generally.
3. Still no HTML page.
4. Agent Hub: "scroll so far down through all the sub-agents that are parked" — active work buried under history.
5. "We keep forgetting different tasks that I ask for" — request memory is unreliable.
6. "Message delivery thing is still kind of broken."
7. Hot-swap system: unknown trustworthiness.
8. View changer / code reload: unknown trustworthiness.

## Product model

Primary object = **live workstream**, not session or agent:
- current conversation, active branches/agents
- unresolved requests (promises visible until completed or explicitly dropped)
- message/inbox state, runtime health
- recent completed/parked activity (collapsed, searchable)
- view/build revision

Three layers:
1. **Runtime** — durable sessions, queue-v2, jobs, ownership, model swaps. One authority. No view-owned state.
2. **Views** — TUI and HTML are disposable projections of the same runtime snapshots/event stream. Reloading view code never risks the session.
3. **Control experience** — active first; delivery states observable (queued → delivered → acknowledged); hot-swap shows requested/current/pending/failed.

## Priority order (supersedes prior phase ordering)

1. Beachball/input-latency diagnosis + fix (live process evidence, not speculation).
2. Message delivery observable & reliable (includes IRC revive P0, nested job lookup P0).
3. Agent Hub: active/recent/searchable sections; parked collapsed by default.
4. Minimal HTML workstream page (first-class, consumes runner projections).
5. Hot-swap + view reload proven from that page end-to-end.
6. Deeper terminal parity migration ONLY where the above experiences require it.

## Standing constraints

- Sol medium default for core; Luna xhigh peripheral/mechanical only.
- No mocks/fabricated evidence; process-level proof for runtime claims.
- Immutable binary promotion via canary readiness driver (existing blessed flow).
- Rich-terminal-port migration is PAUSED (interrupted 2026-07-12); its uncommitted state preserved in tree. Do not resume until priorities 1–5 demand it.

## Existing verified assets to reuse

- SessionRunner + queue-v2 + TerminalSessionController substrate (typechecked; 3 P2 semantic fixes landed: scoped cycleModel, reload cancellation, checkpoint invalidation — gates rerun pending).
- Collab v2 encrypted protocol + web client parity (49+27 tests) — natural transport for the HTML page.
- Phase3A operational evidence projection (78 tests, review PASS) — feeds diagnostics into web surface later.
- Canary/promotion machinery for safe binary promotion.

## Captured ideas (2026-07-12 interjection, not yet scheduled)

- **Forking experiments**: fork a subagent (or Main) into variations of one idea and compare — "the forking thing, and the forking sub-agents. Different variations of this idea. And being able to play around with this." Fits the branch/DAG model; UI space beyond the one-lane TUI.
- **Agent emotional states**: glanceable affect/health per agent ("view the different agents' emotional states") — could piggyback on renamer summaries (mood/health tag alongside name).
- **TUI feels one-dimensional**: "only one lane of work" — multi-lane cockpit direction; hub preview pane is step 1, tmux-like lanes are the continuation.
