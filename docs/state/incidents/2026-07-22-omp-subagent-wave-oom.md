# Incident — OMP subagent wave memory blow-up — 2026-07-22

> **Status:** Open P0 investigation (HR-246); no root cause yet.
> **Affected coordinator:** session `019f8864-b33f-7691-b13f-37c25fa788c6`, PID 40251, tab `workspace:5/pane:9/surface:298`.
> **User impact:** Arthur observed system memory around 70GB; coordinator shell reported `terminated by signal SIGKILL (Forced quit)`; desktop/apps crashed or were disrupted.

## Trigger

The full-stream successor launched approximately five scouting workers, then four implementation workers (`ImplementHR238`, `ImplementHR239`, `ImplementHR240`, `ImplementHR243`; HR205 work also existed). Some children may have launched or retained additional processes/resources; this is not yet proven.

## Evidence retained

- Arthur's Activity Monitor observation: approximately 70GB system/process memory near failure.
- Coordinator PID 40251 disappeared with shell SIGKILL message.
- After failure, `cmux top --workspace workspace:5 --processes --flat` reported ~3.67GB total workspace RSS; former coordinator absent. This is post-crash only, not peak evidence.
- macOS unified logs around the incident contain memory-pressure/jetsam activity and references to PID 40251, but no captured OMP heap/process-tree attribution proving which allocation was killed.
- No current DiagnosticReports crash file for this event (SIGKILL commonly leaves no user crash report).
- Current code: `spawn-worker-client.ts` samples each **direct worker PID** every 250ms with a default 1.5GiB cap and kills its process group on exceed. The existing evidence does not show that descendant processes (LSP/browser/etc.), coordinator retention, or aggregate wave RSS were budgeted.
- Project config at incident time allowed `task.maxConcurrency: 8`, `maxLiveChildren: 6`, root `maxRecursionDepth: 3`; stream overlays contain `maxRecursionDepth: -1`. These are conditions, not established causes.

## Unknowns

- Peak RSS per coordinator/worker/descendant and exact kill timestamp.
- Whether each worker started independent LSP/index/runtime services.
- Whether large tool/IRC outputs or child result graphs accumulated in coordinator JSC/native memory.
- Whether descendants escaped the direct-PID RSS guard or process-group cleanup.
- Whether nested worker fan-out occurred.
- Whether Bun/JSC retained worker/result buffers after terminal delivery.
- Whether cmux/WebKit or unrelated apps materially contributed to the 70GB observation.

## Investigation order

1. Preserve current source, journals, process metadata, and scout receipts; do not restart a broad wave.
2. Implement cross-session profiler HR-247: coordinator JSC/RSS, full process tree, child/LSP/browser ownership, job/agent IDs, context/output sizes, build and model route.
3. Profile one normal worker under a hard aggregate safety abort; capture before/during/after GC and worker completion.
4. Increase controlled width 1→2→3 only when previous run reclaims below watermark; never reproduce five-plus blindly.
5. At suspicious growth, trigger target memory report/heap snapshot and process samples before abort.
6. Tie retained bytes/processes to owners; only then choose pooling, cleanup, admission or concurrency changes.
7. Add regression proving aggregate boundedness and reclamation; attach fixed digest and recurrence rule.

## Temporary operating posture

Do not make permanent concurrency/config changes from this incident without evidence. Avoid broad local nested waves until profiling exists. Prefer sequential/small-width work or the future large server; preserve failed sessions for review.
