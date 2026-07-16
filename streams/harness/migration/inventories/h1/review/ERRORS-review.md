# ERRORS review ledger

## Verdict

**H1ReviewErrCancel:** NOT port-wave-ready before correction. The reviewer identified swallowed delivery errors and unhandled async rejection paths that the original ERRORS inventory misclassified or omitted.
**Cross-review status:** Both reviewers, **H1ReviewErrCancel** and **H1ReviewResConcTime**, judged the H1 inventories NOT port-wave-ready before corrections; this ledger attributes the ERRORS findings to H1ReviewErrCancel.

## Corrections applied

| Finding | Inventory row | One-clause reason |
|---|---|---|
| IRC follow-up delivery classified as expected | `ERRORS.tsv:4` (`task/executor.ts:213`) | A rejected send only logs and is neither retried nor typed to the parent monitor, so it is `DEFECT/yes`. |
| ACK-send failure strands a worker | `ERRORS.tsv:114` (`task/subagent-worker-pool.ts:228`) | The catch marks an already-cleared worker retiring without killing or removing the still-live worker, so it is `DEFECT/yes`. |
| Artifact-directory read errors were treated as missing-directory success | `ERRORS.tsv:138` (`task/output-manager.ts:48`) | Only `ENOENT` is benign; other `readdir` failures can reuse an existing artifact id, so it is `DEFECT/yes`. |
| Floating abort promises omitted | `ERRORS.tsv:24` (`task/executor.ts:1141`), `:39` (`:2553`), `:40` (`:2561`) | Each `void session.abort()` has no rejection handler and can produce an unhandled abort failure, so each is `DEFECT/yes`. |
| Floating RSS sample promise omitted | `ERRORS.tsv:68` (`task/spawn-worker-client.ts:232`) | The interval callback discards `sampleWorkerRss()` rejection, so it is `DEFECT/yes`. |
| Floating replacement drain omitted | `ERRORS.tsv:83` (`task/spawn-worker-entry.ts:72`) | The writer's `finally` starts a replacement drain without awaiting or handling it, so it is `DEFECT/yes`. |
| Catch-callback send failure misclassified | `ERRORS.tsv:118` (`task/subagent-worker-entry.ts:77`) | The rejected-turn callback calls unguarded `send`, so an IPC failure bypasses the controlled exit path and is `DEFECT/yes`. |

All cited source sites were checked in `vendor/oh-my-pi/packages/coding-agent/src/task/`: executor lines 206-213 and 1139-1142/2550-2562, worker client 229-241, worker entry 60-73, subagent entry 70-83, pool 193-230, and output manager 38-50.

## Disagreements and retractions

No ERRORS finding was rejected or retracted. The topology reviewer supplied no separate ERRORS finding; the corrections above are attributed to **H1ReviewErrCancel**.

## Residual uncertainty

These are source-grounded inventory corrections only; no runtime gates were run under the assignment's no-gates constraint. The tagged error names describe the required error channel and remain implementation targets for the migration.
