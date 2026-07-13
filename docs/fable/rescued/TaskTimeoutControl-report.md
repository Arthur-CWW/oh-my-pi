> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-04T06-00-08-576Z_019f2bb6-8080-7000-8a22-156408ea1a65/local/TaskTimeoutControl-report.md

# TaskTimeoutControl report

## Root cause
- Friction source: `docs/state/harness-friction.md:19` records `task` subagent runs hitting a hard ~400s wall-clock cap (`The operation timed out`, exit 1) with no partial-result surfacing.
- Runtime timeout path: `vendor/oh-my-pi/packages/coding-agent/src/task/executor.ts:802-818` installs the per-subagent wall-clock timer and aborts via `requestAbort("timeout")` when `maxRuntimeMs > 0`; `executor.ts:1650-1653` resolves that value from `options.maxRuntimeMs ?? settings.get("task.maxRuntimeMs") ?? 0`; `settings-schema.ts:3695-3711` defines `task.maxRuntimeMs` with default `0` (unlimited).
- ~400s candidate: parent checked no configured `task.maxRuntimeMs` in `~/.omp/agent/config.yml` or repo `.omp` configs. The checked-in default is unlimited, so the observed ~400s wall was the 420000ms `task.agentIdleTtlMs` (`settings-schema.ts:3714-3725`, consumed at `executor.ts:1656`) or older-build behavior. `task.agentIdleTtlMs` parks already-idle adopted subagents after completion; it is not the current active runtime abort path.
- Regression follow-up: timeout partial text initially injected multi-line timeout summaries into `rawOutput`, which broke existing abort-salvage contracts. The final fix keeps timeout progress in structured `SingleResult.timeoutPartial` and feeds salvage text into that field, without mutating legacy salvage output.

## Changes (file:line)
- `vendor/oh-my-pi/packages/coding-agent/src/task/types.ts`: added `timeoutSec` to the shared task item schema (propagates to flat and batch schemas), `TaskItem`, and `TaskParams`; added `TimeoutPartialProgress`; added `SingleResult.timeoutPartial`.
- `vendor/oh-my-pi/packages/coding-agent/src/task/index.ts`: flat spawns now preserve top-level `timeoutSec`, batch items pass per-item `timeoutSec`, and `#runSpawn` converts it to `maxRuntimeMs` so the existing executor timeout seam handles precedence over `task.maxRuntimeMs`.
- `vendor/oh-my-pi/packages/coding-agent/src/task/executor.ts`: added timeout partial-progress assembly helpers, collected subagent tool-call events in the run monitor, populated `SingleResult.timeoutPartial`, preserved legacy abort-salvage output, and keeps non-isolated runtime-timeout sessions on the keep-alive path when possible.
- `vendor/oh-my-pi/packages/coding-agent/test/task/timeout-partial.test.ts`: added synthetic session-log coverage for timeout partial assembly.
- `vendor/oh-my-pi/packages/coding-agent/test/task/executor-wall-clock.test.ts`: added mocked runSubprocess integration coverage proving wall-clock timeout results include `timeoutPartial`; mocked logger methods to avoid unrelated log-file EPERM in the focused test file.
- `vendor/oh-my-pi/packages/coding-agent/test/task/task-schema.test.ts`: added schema-bound coverage for `timeoutSec` accepted/rejected values.
- `vendor/oh-my-pi/packages/coding-agent/test/task/task-guards.test.ts`: mocked logger methods for the focused guard tests to avoid unrelated log-file EPERM while preserving existing salvage assertions.
- `vendor/oh-my-pi/packages/coding-agent/CHANGELOG.md`: added Unreleased entry.

## Verification
- `bun --cwd=vendor/oh-my-pi/packages/coding-agent test test/task/timeout-partial.test.ts test/task/task-schema.test.ts test/task/executor-wall-clock.test.ts`: 15 pass, 0 fail, 40 expect calls. stderr included a non-fatal mise cache warning (`Operation not permitted`).
- Regression gate requested by Main after salvage failures: `bun --cwd=vendor/oh-my-pi/packages/coding-agent test test/task/task-guards.test.ts test/task/timeout-partial.test.ts test/task/executor-wall-clock.test.ts`: 13 pass, 0 fail, 55 expect calls. stderr included the same non-fatal mise cache warning.
- Attempted LSP diagnostics on `src/task/executor.ts`; no language server was available.

## Open risks
- I did not run repo-wide build/test/lint/formatters per subagent constraints.
