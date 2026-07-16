# CANCELLATION review ledger

## Verdict

**H1ReviewErrCancel:** NOT port-wave-ready before correction. Timeout cleanup was overstated, monitor/session abort paths could dispatch twice, fanout disposal could be skipped, monitor finalization was unreachable, and worker-pool kill branches were not idempotent.
**Cross-review status:** Both reviewers, **H1ReviewErrCancel** and **H1ReviewResConcTime**, judged the H1 inventories NOT port-wave-ready before corrections; this ledger attributes the CANCELLATION findings to H1ReviewErrCancel.

## Corrections applied

| Finding | Inventory row | One-clause reason |
|---|---|---|
| MCP timeout cleanup overstated | `CANCELLATION.tsv:3-5` (`task/executor.ts:294/315/318`) | Timeout rejects only the wrapper while listener/timer cleanup remains attached to the underlying promise's `finally`, which may never settle. |
| Monitor/session abort can double-fire | `CANCELLATION.tsv:10-11,26-27` (`task/executor.ts:1139/1146/2550/2560`) | `requestAbort` directly aborts the active session, then controller/listener or already-aborted mirror can call `session.abort()` again without an AgentSession once guard. |
| Monitor finish is unreachable | `CANCELLATION.tsv:16` (`task/executor.ts:1633`) | `finish()` clears listener/timer resources but `runSubprocess` has no callsite, leaving late aborts and timers armed. |
| Fanout aggregator disposal can be skipped | `CANCELLATION.tsv:40` (`task/index.ts:1378`) | A rejected `mapWithConcurrencyLimit` exits before `flush`/`dispose`, leaving aggregator state and its scheduled timer live. |
| Worker-pool kill branches are non-idempotent | `CANCELLATION.tsv:61-64` (`task/subagent-worker-pool.ts:172/178/187/203`) | Membership is checked but `worker.retiring` is not, so late duplicate IPC can issue repeated SIGKILL before `onExit` removes the worker. |

Source verification covered executor lines 1123-1153 and 1633-1644, index lines 1350-1380, and worker-pool lines 165-205. A search of executor found no `monitor.finish` callsite; only the definition is present.

## Disagreements and retractions

No cancellation finding was rejected or retracted. The monitor-finalizer observation also appears in **H1ReviewResConcTime** and was applied once to the shared monitor behavior plus its CANCELLATION/TIME/RESOURCES rows.

## Residual uncertainty

No runtime tests or project gates were run because this assignment forbids them. The inventory records the observed non-idempotence and deferred cleanup; it does not change source behavior.
