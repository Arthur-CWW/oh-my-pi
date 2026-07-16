# H1 Resource Inventory Notes

## Scope
This inventory covers `vendor/oh-my-pi/packages/coding-agent/src/task/` files in the H1 hotspot: spawn/worker lifecycle and report delivery.

## Zero-sites files
These scoped files contain no direct acquire/release pairs for the tracked resource categories (child processes, ptys, pipes/sockets/fds, DB handles, file locks/leases, temp dirs/files, long-lived event listeners, intervals/watchers):

- `task/child-lifecycle.ts` — pure functions that append/read child lifecycle records via a passed-in `SessionManager`.
- `task/quota-admission.ts` — pure quota decision logic; no I/O or resource ownership.
- `task/spawn-worker-protocol.ts` — types and decoders only.
- `task/subagent-worker-protocol.ts` — types and decoders only.
- `task/subprocess-tool-registry.ts` — singleton `Map` of tool handlers; no acquire/release lifecycle.

## Delegations to out-of-scope managers
Several scoped callsites hand resource ownership to managers outside the scout file scope:

- `task/executor.ts:2740` (`AgentLifecycleManager.adopt`) and `task/re-adopt.ts:388`/`task/re-adopt.ts:187`/`task/re-adopt.ts:411` delegate child session lifetime, TTL timers, and park/revive/release to `registry/agent-lifecycle.ts`.
- `task/index.ts:1206` (`AsyncJobManager.register`) delegates async job lifetime to `async/job-manager.ts`.
- `task/re-adopt.ts:204`, `task/re-adopt.ts:363`, `task/auto-resume.ts:99` validate a passed-in `SessionOwnershipHandle` (lease file/socket in `session/session-ownership.ts`) but do not acquire or release it in scope.
- `task/re-adopt.ts:125`/`task/auto-resume.ts:125` use a passed-in `decisionJournal` (`SessionManager`) for append-only durable writes but do not own the handle.

## High-hazard resources
Resources with multiple release paths or mechanism `none` are the primary porting targets:

1. **Child processes** (`spawn-worker-client.ts:43`, `subagent-worker-pool.ts:121`) have multiple kill paths and process-exit cleanup.
2. **AgentSession / child SessionManager** (`executor.ts:2432`, `executor.ts:2328`) dispose through four distinct call sites depending on abort/park/lifecycle path.
3. **Session lifecycle delegation** (`executor.ts:2740`, `re-adopt.ts:388`) crosses into `AgentLifecycleManager`, which owns TTL timers and subscriptions.
4. **Temp dirs and worktrees** (`index.ts:1583`, `index.ts:1817`) rely on `finally` cleanup and must outlive the child session until after result capture/merge.
5. **Event listeners** (`subagent-worker-entry.ts:70`) are never unregistered; process exit is the only release.
6. **Leaked process/fd hazards** map to known issues: `HR-163 report-on-exit` for journal/pipe ordering, `HR-141 kernel leaks` for the RSS sampling interval.

## Row count
TSV contains 1 header row + 50 data rows = 51 total rows.

## Resources with >1 release path or mechanism `none`
See `RESOURCES.tsv` rows where `release_sites` contains commas or `current_mechanism` is `none`. These are the rows that must be converted to `Effect.acquireRelease` / `Effect.scoped` during the H1 port.
