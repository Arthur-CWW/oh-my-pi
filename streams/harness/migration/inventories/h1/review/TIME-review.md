# TIME review ledger

## Verdict

**H1ReviewResConcTime:** NOT port-wave-ready before correction. The original schedule rows treated whole-run timeout wrappers and monitor `finish` cleanup as sufficient, omitted a persistence timestamp, and left the post-yield timeout hazard understated.
**Cross-review status:** Both reviewers, **H1ReviewErrCancel** and **H1ReviewResConcTime**, judged the H1 inventories NOT port-wave-ready before corrections; this ledger attributes the TIME findings to H1ReviewResConcTime.

## Corrections applied

| Finding | Inventory row | One-clause reason |
|---|---|---|
| Monitor finish has no reachable callsite | `TIME.tsv:8,16-17` (`executor.ts:1162`, release lines `1637/1641`) | `finish` is defined but never invoked, so runtime/progress timer releases are unreachable and the runtime timer can fire after park. |
| Runtime timeout can override yield | `TIME.tsv:8` (`executor.ts:1933-1945` noted) | Finalization unconditionally treats `runtimeLimitExceeded` as failure even when `yieldCalled()` became true during teardown. |
| Timeout must be active-turn scoped | `TIME.tsv:8` (`executor.ts:1162`) and `TIME.tsv:51` (`spawn-worker-client.ts:363`) | Both target schedules now require the literal policy `timeout scoped to active turn, disarmed at yieldWritten/before park`, rather than a whole-run timeout. |
| Quota timestamp omitted | `TIME.tsv:64` (`task/quota-admission.ts:218`) | `createQuotaAdmissionStateRecord` defaults persisted `updatedAtMs` from an independent `Date.now()` boundary. |

Source verification covered executor `1160-1171`, monitor definition `1633-1644`, finalization `1933-1952`, worker-client `352-369` and `449-469`, and quota-admission `212-220`.

## Disagreements and retractions

No TIME finding was rejected or retracted. The duplicate timeout-overrides-result record was applied once in `CONCURRENCY.tsv:29`; the retracted recovery fd-leak suspicion is recorded in `RESOURCES-review.md`.

## Residual uncertainty

No TestClock or runtime gate was run because this assignment forbids project gates. The time inventory now states the required active-turn/disarm contract without modifying source behavior.
