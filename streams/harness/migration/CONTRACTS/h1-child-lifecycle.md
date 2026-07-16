# H1 contract: child lifecycle + report delivery (state machine + invariants)

Status: DRAFT for Arthur's approval — the taste gate before any H1 port packet spawns (HR-164 plan v2).
Authored by Fable, 2026-07-16, from journal evidence (HR-163 cluster) and the register/changelog incident record.
This document is the executable-model source of truth: `test/migration/model/h1-model.ts` implements it; the DST driver and trace-conformance checker enforce it; every intentional deviation from current behavior is a `DIVERGENCES.md` row citing a clause here.

## States

```
spawned ──admit──▶ running ──yield────▶ yielded ──park──▶ parked ──revive──▶ running
                    │                     │                 │
                    ├─crash──▶ crashed    │                 └─reap──▶ reaped
                    ├─interrupt▶ interrupted                (TTL / explicit)
                    └─timeout─▶ timedOut
yielded | crashed | interrupted | timedOut ──deliver──▶ (terminal outcome at parent)
```

- `spawned`: admission accepted (FIFO/live-cap), subprocess not necessarily started.
- `running`: turn in progress. Progress events (tokens, tool calls) are non-transitioning observations.
- `yielded`: child wrote its yield record. **This is the delivery event** (C2). The child MAY continue living (park) — delivery MUST NOT wait for exit.
- `crashed`: child process died without a yield record (exit code, signal, or torn pipe).
- `interrupted`: parent-initiated stop (cancel/interrupt), acknowledged by cleanup.
- `timedOut`: wall-clock elapsed while NOT `yielded` (C3 — timeout can never fire on a yielded child).
- `parked`: post-yield lingering, addressable for follow-up turns; a revive re-enters `running` for a new turn (same id, same journal).
- `reaped`: subprocess and resources released (TTL, explicit cancel, or terminal teardown).

## Events (every transition = one typed message to the parent monitor + one journal record)

`admitted, started, progress*, yieldWritten, delivered, crashed(cause), interruptRequested, interruptDone, timeoutFired, parked, reviveRequested, revived, reaped`.
Message and journal record carry: child id, monotonic sequence number, wall timestamp, cause. The journal record is written **before** the message is sent (durability precedes notification, C4).

## Invariants (each becomes a checker in the model + trace conformance)

- **I1 Terminal-exactly-once**: every `spawned` child yields exactly one terminal outcome at the parent — `result | typedError(cause) | cancelled` — never zero (no immortal jobs), never two.
- **I2 Yield-priority**: a journaled `yieldWritten` happens-before any teardown effect on the outcome. No sequence of park/exit/timeout/kill after `yieldWritten` may convert the outcome into an error. (The 2026-07-16 `SpawnWorkerError after successful yield` is the canonical violation.)
- **I3 Timeout scope**: `timeoutFired` is only reachable from `running` (never from `yielded`/`parked`).
- **I4 Durability**: the parent-visible outcome is reconstructible from the child journal alone — kill the pipe at ANY event boundary and I1 still holds (recovery path, shipped as HR-163's `recoverSpawnWorkerResultFromJournal`, is contract behavior, not fallback heroics).
- **I5 Delivery liveness**: `delivered` occurs within bounded delay of `yieldWritten` (bound = poll/monitor latency, NOT process lifetime; the pre-HR-163 "delivery at wall-clock" is the canonical violation).
- **I6 Monotonicity**: state transitions follow the machine above; no backward edges except `parked→running` via `revived`; sequence numbers strictly increase; a `reaped` child emits nothing further.
- **I7 Interrupt correctness**: `interruptRequested` in any non-terminal state leads to `interruptDone` with cleanup executed exactly once; the parent receives `cancelled`, never silence. Double-interrupt is idempotent (no counter discipline required by callers).
- **I8 Resource reclamation**: after a terminal outcome + reap, no orphan process/pty/fd/tmpdir attributable to the child (observable via ownership markers, `omp doctor` classes).
- **I9 Receipt honesty**: every parent-facing receipt (`spawn`, `poll`, `cancel`) reflects the journal state at read time — a `running` answer for a `yielded` child older than the I5 bound is a violation.

## Faults the DST driver MUST inject (each mapped to the invariant it attacks)

| Fault | Attacks |
|---|---|
| kill child at every event boundary (before/after `yieldWritten`, before/after journal flush) | I1, I2, I4 |
| pipe drop / duplicate / reorder / delay of monitor messages | I1, I5, I6, I9 |
| wall-clock firing racing `yieldWritten` | I2, I3 |
| interrupt racing yield, interrupt racing timeout, double interrupt | I7, I1 |
| park TTL racing revive; revive racing reap | I6, I1 |
| parent restart between `yieldWritten` and `delivered` | I4, I1 |

## Known intentional divergences from current behavior (seed rows for DIVERGENCES.md)

1. **Delivery at yield, not exit** (violates old behavior; cites I5). Partially shipped: HR-163 recovers on exit; full contract behavior = monitor message at yield time.
2. **Timeout unreachable after yield** (cites I3). Old behavior: wall-clock kills converted yielded children into `SpawnWorkerError`.
3. **Silence abolished** (cites I1/I9): `job` never reports `running` for a journal-terminal child beyond the I5 bound.

## Interface freeze for parallel workers (build against this, exactly)

```ts
// test/migration/model/h1-model.ts (pure, no IO, no Date.now)
export type H1StateName = "spawned" | "running" | "yielded" | "crashed" | "interrupted" | "timedOut" | "parked" | "reaped";
export interface H1Event { readonly kind: string; readonly childId: string; readonly seq: number; readonly at: number; readonly cause?: string }
export interface H1Snapshot { readonly state: H1StateName; readonly seq: number; readonly journal: readonly H1Event[]; readonly deliveredOutcome?: "result" | "typedError" | "cancelled" }
export type H1StepResult = { readonly ok: true; readonly next: H1Snapshot } | { readonly ok: false; readonly violation: H1Violation };
export interface H1Violation { readonly invariant: "I1"|"I2"|"I3"|"I4"|"I5"|"I6"|"I7"|"I8"|"I9"; readonly detail: string; readonly event: H1Event }
export function h1Step(snapshot: H1Snapshot, event: H1Event): H1StepResult;
export function h1CheckTrace(events: readonly H1Event[]): readonly H1Violation[];
```
