# ERRORS inventory notes

## Scope
This inventory covers the H1 scout file scope under `vendor/oh-my-pi/packages/coding-agent/src/task/`.
It lists every `throw`, `Promise.reject`, `reject`, `catch`, `.catch(...)`, and silent-swallow site in those files.

## Ambiguous classifications

- `task/executor.ts:1742` and `task/executor.ts:1780` are catch blocks with two
  semantic branches: an expected `ToolAbortError`/abort path and a defect path
  for unexpected prompt/run failures. They are listed once with `EXPECTED` for
  the abort branch noted in the `notes` column.
- `task/executor.ts:753` is a catch that either rethrows `ToolAbortError` or
  converts other MCP failures into a tool result with `isError: true`. It is
  listed as a single `catch` site with `McpToolError`.
- `task/executor.ts:2650` is the outer `runSubagent` catch. The abort branch is
  expected; non-abort failures are treated as defects. The outcome is surfaced,
  so `swallow_hazard` is `no`.
- `task/index.ts:689` swallows the abort branch and rethrows non-abort errors.
  It is listed as a single `catch` site.
- `task/parallel.ts:75` returns partial results on abort and rethrows real
  worker errors. Both branches are expected domain behavior.
- `task/subagent-worker-pool.ts:239` is the single reject point for outcomes
  produced elsewhere: `WorkerPoolClosedError` created at L92 and
  `WorkerCrashedError` created at L255. The `error_today` column reflects this.

## Files with zero error-channel sites

- `task/child-lifecycle.ts`
- `task/quota-admission.ts`
- `task/auto-resume.ts`
- `task/subprocess-tool-registry.ts`

These are represented in the TSV with a `site` ending in `:0` and `construct: none`.

## Five highest-risk swallow sites

1. `task/executor.ts:2440` — `.catch(() => {})` on a raced session `dispose`.
   A failed dispose after an aborted startup is silently ignored, risking orphan
   LSP/MCP child processes and I8 resource reclamation.
2. `task/executor.ts:1928` — `catch { // Non-fatal }` on output artifact write.
   The result is delivered to the parent while the artifact may be missing,
   breaking I8-style ownership honesty for the output file.
3. `task/executor.ts:1579` — `catch` around `processEvent` logs and terminates.
   The original subagent event-processing error is replaced by a generic abort,
   losing the diagnostic the parent needs and attacking I1/I9 visibility.
4. `task/spawn-worker-client.ts:333` — `catch { return undefined; }` in
   `recoverSpawnWorkerResultFromJournal`. A journal that cannot be read is
   converted to `undefined`, which can lead to a `protocol` error instead of the
   journaled terminal outcome, violating I4 recoverability.
5. `task/executor.ts:213` — `.catch(...)` on IRC follow-up result delivery.
   A failed follow-up delivery is logged at WARN but not surfaced to the parent,
   so the parent may believe a follow-up result was delivered when it was not.

## Error-message string matching

No error-message string matching (`.message.includes`, `.message.startsWith`,
`===`, etc.) was found in the scoped files.
