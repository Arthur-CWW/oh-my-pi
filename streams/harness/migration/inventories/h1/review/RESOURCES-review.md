# RESOURCES review ledger

## Verdict

**H1ReviewResConcTime:** NOT port-wave-ready before correction. The review found unreachable monitor releases, setup and pipe-rejection leaks, an outer temp-directory leak, omitted listeners, reviver subscription ownership gaps, and an unclosed journal-recovery manager.
**Cross-review status:** Both reviewers, **H1ReviewErrCancel** and **H1ReviewResConcTime**, judged the H1 inventories NOT port-wave-ready before corrections; this ledger attributes the RESOURCES findings to H1ReviewResConcTime.

## Corrections applied

| Finding | Inventory row | One-clause reason |
|---|---|---|
| Monitor releases have no reachable callsite | `RESOURCES.tsv:2-5` (`executor.ts:1100/1102/1160/1201`) | `monitor.finish` is only defined, so listener/controller/runtime/progress resources have no terminal release. |
| Setup-abort SessionManager leak | `RESOURCES.tsv:9` (`executor.ts:2328`) | `SessionManager.open` can succeed before inherit/artifact/session setup throws, and no `session.close()` is reached before an AgentSession exists. |
| Temp-artifact outer-error leak | `RESOURCES.tsv:23` (`index.ts:1583`, cleanup `1996-2000`) | Cleanup is normal-path code inside the outer try, while catch `2004-2008` returns without removing the post-mkdir directory. |
| Extension error listener omitted | `RESOURCES.tsv:15` (`executor.ts:2616`) | `onError` returns an unsubscribe closure, but the executor drops it and no in-scope release is recorded. |
| Reviver listeners omitted | `RESOURCES.tsv:13-14` (`executor.ts:868` and `:973`) | Both `session.subscribe` acquisitions delegate release through `AgentLifecycleManager.registerSubscription` at `agent-lifecycle.ts:461-468`. |
| Pipe-reader rejection release missing | `RESOURCES.tsv:26` (`spawn-worker-client.ts:43`) | `Promise.all` can reject from stderr/stdout before process exit and the `finally` clears watchers without calling `killProcessTree`. |
| Recursive writer drain resource race | `RESOURCES.tsv:35` (`spawn-worker-entry.ts:61`) | A recursive drain can begin after `flush` awaited the prior drain, leaving queued bytes and no explicit writer release. |
| Journal-recovery SessionManager | `RESOURCES.tsv:27` (`spawn-worker-client.ts:283`) | The persistent manager is opened for recovery and `session.close()` is absent on success, no-yield return, and catch. |

The monitor source was checked at executor `1633-1645` and terminal path `2763-2785`; setup at `2323-2333` and `2431-2441`; temp cleanup at index `1996-2008`; extension unsubscribe contract at runner `571-574`; reviver paths at executor `846-876` and `944-986`; pipe handling at worker client `449-469`; writer drain at worker entry `56-73`; and recovery at worker client `277-335`.

## Disagreement and retraction

**H1ReviewResConcTime** explains a RETRACTION: the earlier read-only recovery-SessionManager suspicion about a file-descriptor leak from lazy writer initialization should not be treated as that specific fd-leak claim. Direct code inspection resolves the discrepancy narrowly: `recoverSpawnWorkerResultFromJournal` opens `SessionManager` at line 283, returns `undefined` at line 297 or a result at lines 309-332, and catches at 333-335; there is no `session.close()` on any path. Therefore the fd-mechanism suspicion is rejected, but the separately reported unclosed-manager finding is applied as `RESOURCES.tsv:27`.

No other RESOURCES finding was rejected. The monitor finding overlaps H1ReviewErrCancel's CANCELLATION finding and was corrected once across the shared monitor rows.

## Residual uncertainty

This is a source-grounded ownership ledger, not a runtime leak measurement; no project gates were run under the assignment constraints. The recovery row intentionally records the missing close without asserting the retracted lazy-writer fd mechanism.
