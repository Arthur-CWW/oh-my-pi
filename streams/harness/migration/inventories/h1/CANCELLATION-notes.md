# CANCELLATION inventory notes

## Coverage
- TSV: `CANCELLATION.tsv`
- Header: `site mechanism cleanup_guarantee double_fire_hazard interruptible_region notes`
- Row count (excluding header): 69
- Scoped files with sites: executor.ts, index.ts, spawn-worker-client.ts, spawn-worker-entry.ts, parallel.ts, subagent-worker-pool.ts, subagent-worker-entry.ts, subprocess-tool-registry.ts

## Zero-site scoped files
The following scoped files contain no executable cancellation/interruption creation/listen/fire/abort/timeout/kill/dispose/teardown path in this inventory:
- `task/child-lifecycle.ts`
- `task/re-adopt.ts`
- `task/quota-admission.ts` (the `signal` parameter is `QuotaRetrySignal`, not `AbortSignal`)
- `task/subagent-worker-protocol.ts` (`finally` at line 87 is a decode recursion guard, not a cancel cleanup)
- `task/auto-resume.ts` (`timeoutMs` is a deadline loop, not an abort path)
- `task/output-manager.ts`

## Five worst double-fire/cleanup hazards

1. `task/spawn-worker-client.ts:361` (signal listener) + `task/spawn-worker-client.ts:362` (timeout)
   - Both fire `failAndKill`, which calls `killProcessTree` (process group SIGKILL then `proc.kill("SIGKILL")`).
   - The `once` listener and the timeout can fire in the same abort/timeout race; `failAndKill` is not idempotent and will re-issue kills.
   - Cleanup finally removes the listener and clears the timeout, but the kill may already be in flight.

2. `task/spawn-worker-client.ts:365` (RSS limit `onExceeded`)
   - The RSS sampler calls `onExceeded` every 250 ms while RSS stays above the cap.
   - Each callback calls `failAndKill`, so the worker can be killed multiple times before the finally block stops the watch.

3. `task/executor.ts:1146` (external signal listener) + `task/executor.ts:1162` (runtime timeout) + `task/executor.ts:1460` (budget abort)
   - All three converge on `requestAbort`. `abortSent` prevents a second `abortController.abort()`, but the guard at line 1131 intentionally upgrades a non-signal reason to `signal`, so the final `abortReason` can change under a race.
   - Double interruption is not idempotent in terms of the reported reason; the active session `session.abort()` may also be called repeatedly from the listener and the manual mirror.

4. `task/executor.ts:2714` and `task/executor.ts:2728` (`untilAborted(AbortSignal.timeout(5000), () => session.dispose(...))`)
   - The cleanup action itself is wrapped in an abortable timeout: if dispose takes longer than 5 s, the timeout fires and the dispose promise is aborted.
   - This means session/resource cleanup is **not guaranteed** to finish; partial dispose leaves orphaned processes/FDs.

5. `task/executor.ts:2656` (outer `finally` of `runSubprocess`)
   - A single `finally` block performs: lifecycle journal append (`appendLifecycleState`), interrupt message send, `session.dispose`, `AgentLifecycleManager.adopt`/`park`.
   - If the parent process or caller aborts this finalizer, the journal may be written but the session not disposed, or vice versa. This is the canonical H1 "cleanup must be uninterruptible" region.

## Other notable patterns
- `task/executor.ts:2550` and `task/executor.ts:2560` are the listener + manual mirror for `session.abort()`; they avoid the missing-event race but can both call `session.abort()` if the signal fires between the listener registration and the manual check.
- `task/parallel.ts:39`/`task/parallel.ts:40`/`task/parallel.ts:60` combine an internal `AbortController`, an external signal via `AbortSignal.any`, and a fail-fast `abortController.abort()`. The composite `workerSignal` can fire from either direction, and an external abort arriving while an internal error fires can produce a race in which the error is swallowed.
- `task/spawn-worker-client.ts:412` (`proc.kill()` after result) can race with the abort/timeout kills, especially when the result arrives just as the caller cancels.
- `task/spawn-worker-entry.ts:70` drains the `BoundedJsonlWriter` queue in a `finally`; because the process can be SIGKILLed at any time, this queue drain is marked `uninterruptible` in the target design even though it is not currently guarded by an abort handler.
