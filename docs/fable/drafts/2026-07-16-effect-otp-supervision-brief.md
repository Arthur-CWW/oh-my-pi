# Effect-first, OTP-shaped robustness redesign (draft for Arthur's read)

Provenance: Arthur, 2026-07-16 — "how can we make everything more robust, feeling like migrating fully to effect is probably worth it, we want it to be closer to elixir otp. could we redesign with effect first". Authored by Fable same day, grounded in the 2026-07-16 subprocess failure cluster (HR-163 investigation) and the live tree.

## Diagnosis: what actually keeps failing

The recurring incidents (worker death modes 1–3, today's cluster) are not typing gaps. They are two architectural debts:

1. **Ambient authority.** `IrcBus.global()`, `Settings.getInstance()`, `AgentLifecycleManager.global()` — 36 files reach for process-local singletons. A subprocess child inherits *none* of them, so tools break (`edit` → "Settings not initialized"), local IRC sends fail into the external SQLite bus (loopback echo from other sessions), and nobody notices until a worker is mid-task.
2. **Lifecycle coupling.** A child's completion report is delivered on subprocess *exit*, not at yield time. A parked child holds its own report hostage until the wall-clock (observed: two reports delivered at exactly `timeoutSec`, one successful yield converted into `SpawnWorkerError` at timeout+grace). Silence is ambiguous: dead, parked, or just slow — the parent cannot tell.

OTP's cure for both is a discipline, not a language: every unit of work is a *named, monitored process*; state lives inside supervised processes reached only by messages; silence is impossible (monitors deliver `DOWN`); restart policy is declared, not improvised.

## What maps to our runtime — and what does not

| OTP concept | Honest JS/Effect analog | Notes |
|---|---|---|
| BEAM process (preemptive, isolated heap) | **subprocess** (session runner, `task.isolateSetup`) | Fibers are NOT isolation: shared heap, cooperative scheduling — a hot loop stalls every fiber (that's why the loop watchdog exists). Keep the process boundary. |
| Node / distribution | the typed JSONL pipe (`runner/protocol.ts`, spawn pipe) | Already Effect-schema'd on the runner side. Treat the pipe as distribution: correlated request/reply, heartbeats, monitors. |
| Lightweight process within a node | Effect **Fiber** under a **Scope** | Guaranteed finalizers, interruption on scope close — probe test already pins these APIs. |
| Supervisor tree | Layer graph + Fiber supervision (in-process) + a small cross-process supervisor protocol (spawn/monitor/DOWN/restart-policy) | The Agent Hub / Control Plane renders this tree — supervision and observability become the same structure (feeds HR-129/HR-133/HR-162). |
| GenServer call/cast | typed mailbox `Queue` + `Deferred` reply | IRC bus and session-control already want exactly this shape. |
| `Process.monitor` / `DOWN` | monitor record per spawned child; yield/park/crash/timeout each emit a typed terminal or transition message | Kills "silence ≠ death" archaeology permanently. |

## Position

**Yes to Effect-first for the concurrency/lifecycle organs; no to a big-bang rewrite.** The harness is live and self-hosting; a wholesale rewrite of the 14.2k-line `agent-session.ts` would freeze the stream for weeks and bless nothing. The value concentrates in four organs that produce ~all incidents. Strangle those, in order, each phase shippable and blessed:

### P0 — stop the bleeding (in flight, HR-163)
Targeted fix: deliver the yield report at yield time; decouple park-lingering from result delivery; never convert a journaled successful yield into a timeout error; Settings/bus bootstrap in subprocess children. No redesign required.

### P1 — AgentCell: supervised child lifecycle (the OTP core)
One typed owner per spawned child: `spawn → monitor → (progress|yield|crash|timeout|park) → release`. Implemented as an Effect Service; every child gets a monitor whose terminal message is mandatory (Deferred). Parent `job` resolution consumes monitor messages, with the child journal as the durable fallback read. Blast radius: `task/index.ts` (~2k lines) + the spawn-process runner. Death modes 1–3 become structurally impossible rather than "routine".

### P2 — capabilities instead of singletons
`IrcBus`, `Settings`, lifecycle registry, session-control become Context.Services provided by Layers at each entry point: main-process layer (today's behavior), subprocess layer (bridged implementations routing over the pipe). A child's `irc` send then either delivers via the parent or fails with a typed refusal — never silently falls through to the external bus. Ratchet: lint forbidding new `.global()`/`getInstance()` callsites (guardrail ladder; 36 files burn down gradually).

### P3 — GenServer-ify the buses
IRC bus and session-control as mailbox services: bounded queues (backpressure instead of silent drops), correlated call/cast, park/revive as an explicit state machine with monitor notifications. External SQLite bus stays the inter-session transport; it stops being an accidental fallback.

### P4 — interruption core (last, riskiest)
The protected depth-counted abort gates in `agent-session.ts` (~2691–2727, 6086–6104, 7040–7440, 8249–8290) are hand-rolled structured concurrency. Replace with Effect interruption regions + Scope only after P1–P3 have soaked, under the existing protected-region sign-off ritual. Until then: do not touch.

## Risks, named

- **Effect v4 is beta** (beta.92). The API probe test is the canary; pin exact versions; expect churn until GA.
- **Fibers ≠ isolation.** Anything CPU-hot or crash-risky stays behind the subprocess boundary. The TUI render loop stays out of Effect entirely (allocation-heavy combinators in hot paths are a regression, not robustness).
- **Legibility for agents.** Mitigated: AGENTS.md already mandates Effect v4 idioms (`Effect.fn`, `Schema.TaggedErrorClass`); 28 files already model the style; new organs converge on one convention instead of two.
- **Migration honesty.** Each phase must delete the code it replaces (no dual paths, no shims). A phase that can't finish its cutover doesn't ship.

## Non-goals

- Rewriting tools, TUI components, or rendering in Effect.
- Emulating BEAM preemption or per-fiber heaps.
- Any new runtime dependency beyond `effect`.

## Decision needed from Arthur

1. Bless the strangler sequencing (P1→P4) vs. narrower (P1+P2 only).
2. Whether P1 lands as part of the HR-163 follow-up wave or as its own HR with a design pass on the AgentCell message vocabulary first.
