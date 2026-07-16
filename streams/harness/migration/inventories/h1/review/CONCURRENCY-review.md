# CONCURRENCY review ledger

## Verdict

**H1ReviewResConcTime:** NOT port-wave-ready before correction. Shared-map rejection mutation, recursive writer draining, and worker result/timeout ordering were incomplete; the runtime monitor also allowed timeout state to override a yielded result.
**Cross-review status:** Both reviewers, **H1ReviewErrCancel** and **H1ReviewResConcTime**, judged the H1 inventories NOT port-wave-ready before corrections; this ledger attributes the CONCURRENCY findings to H1ReviewResConcTime.

## Corrections applied

| Finding | Inventory row | One-clause reason |
|---|---|---|
| Discovery rejection callback omitted | `CONCURRENCY.tsv:19` (`index.ts:657`, callback `671-673`) | The floating catch mutates the module-level memo asynchronously; the identity guard prevents deleting a replacement promise but does not remove the race site. |
| Recursive writer drain beyond flush | `CONCURRENCY.tsv:30` (`spawn-worker-entry.ts:25`, drain `56-73`) | `flush` awaits only the current drain while `finally` can recursively start another drain after the queue is repopulated. |
| Timeout can override received worker result (deduplicated) | `CONCURRENCY.tsv:29` (`spawn-worker-client.ts:452-466`) | The result is assigned before `proc.kill`, but timeout can set `terminalError` during `proc.exited` wait and terminalError wins at line 453. |
| Monitor runtime timeout/yield race | `CONCURRENCY.tsv:3` (`executor.ts:1160`; finalization `1933-1945`) | `runtimeLimitExceeded` can override a successful yield, and monitor finish is never called to close the race. |

The two identical timeout-overrides-result JSON findings were applied exactly once to row 29; the source was verified at worker-client `409-415` and `449-469`. Other source checks covered index `657-675`, writer `56-73`, and executor `1933-1945`.

## Disagreements and retractions

No concurrency finding was rejected or retracted. The recovery-manager retraction is recorded in `RESOURCES-review.md`; it does not change this topology ledger. Monitor finalization and yield-priority observations overlap the CANCELLATION/TIME ledgers and were not duplicated as extra source rows.

## Residual uncertainty

No runtime race harness or project gate was run under the assignment constraints. The corrected rows preserve the existing target primitives while explicitly recording the ordering hazards that the Effect migration must solve.
