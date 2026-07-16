# H1 TIME inventory notes

Produced by `H1ScoutTime` over the scoped task/ files.

## Row count

- Header: 1 line
- Data rows: 85
- Total lines in `TIME.tsv`: 86

## Zero-sites files

These scoped files contain no time constructs:

- `task/subagent-worker-pool.ts`
- `task/subprocess-tool-registry.ts`
- `task/output-manager.ts`

All other scoped files are represented by at least one row.

## I3 timeout-scope hazard class

Timers that can fire on a yielded or parked child (per H1 contract I3: timeout must be unreachable from yielded/parked states):

- `task/executor.ts:1162` — subagent wall-clock runtime limit (`maxRuntimeMs`).
  Cleared in `monitor.finish()`, but the H1 port must prove it is disarmed before the child reaches yielded/parked.
- `task/spawn-worker-client.ts:363` — subprocess wall-clock timeout (`options.timeoutMs`).
  Armed for the duration of `runRequest`, which waits for `proc.exited`. If the child yields and then lingers, the timeout can fire after yield but before exit.
- `task/index.ts:408` and `task/index.ts:1733` — `timeoutSec` parameter/conversion that feeds the two timers above.
  These are source-value sites, not timers themselves, but the I3 invariant is determined by how the downstream timers are disarmed.

## Out-of-scope delegation notes

Park TTL values are read in scope but enforced by `AgentLifecycleManager` (out of scope):

- `task/executor.ts:2115` — `agentIdleTtlMs` setting passed to `AgentLifecycleManager.global().adopt()` / `park()`.
- `task/re-adopt.ts:65` — `idleTtlMs` option passed into `reAdoptDirectChildren()`.
- `task/re-adopt.ts:388` — `lifecycle.adopt(child.id, { idleTtlMs: options.idleTtlMs, ... })`.

## TestClock/wall-clock caveats

- `task/spawn-worker-entry.ts:118` uses a `performance.now()` busy loop for synthetic CPU load. Virtual-time advancement does not execute actual CPU work, so this must remain wall-clock in real tests (only the synthetic workload path).
- `task/index.ts:149` uses `stat.mtime.toISOString()` for the spawn guide cache. This is filesystem metadata and should stay wall-clock.
- `task/quota-admission.ts` and lifecycle/re-adopt timestamps are journal/metadata records; they read wall-clock but do not drive scheduling beyond age filtering.
