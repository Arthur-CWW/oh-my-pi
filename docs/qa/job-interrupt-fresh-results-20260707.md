# Job interrupt and fresh results QA — 2026-07-07

## Per-slice file:line changes

### Slice 1 — fresh results from woken agents

- `src/async/job-manager.ts:306-312` adds `refreshResultText(id, text)`. It only accepts `completed`/`failed` jobs, replaces `resultText`, clears `errorText` with `= undefined`, and does not call delivery enqueue or eviction scheduling.
- `src/task/executor.ts:123-142` adds shared assistant-text extraction via `extractLastAssistantText()`; timeout partials and fresh-result refresh use the same extraction path.
- `src/task/executor.ts:333-334` adds optional `asyncJobManager`/`asyncJobId` executor inputs; `src/task/index.ts:1428-1429` threads the current async task job into non-isolated `runSubprocess` calls.
- `src/task/executor.ts:1831-1850` extends adopted-session status sync. Later `agent_end` events after `originalRunSettled` refresh terminal job text with `\n\n[refreshed after follow-up turn]`; `worktree !== undefined` is skipped.

### Slice 2 — `job interrupt`

- `src/async/job-manager.ts:23-42` defines the typed interrupt sentinel and guard; `src/task/executor.ts:865-893` maps that sentinel to monitor abort reason `interrupt`.
- `src/async/job-manager.ts:61-64` adds interrupt fields to `AsyncJob`; `src/async/job-manager.ts:249-252` records `interrupted` when an interrupted job completes.
- `src/async/job-manager.ts:293-303` adds `interrupt(id, filter?, reason?)`: owner-filtered, running/non-queued/not-already-interrupted only, aborts with `{ type: "omp:async-job-interrupt", requestedBy?, reason? }`.
- `src/task/executor.ts:1318-1325`, `1536-1573`, `1630-1640`, `2216-2253`, and `2292-2303` implement soft interrupt semantics: not an aborted run, exit code forced to 0, partial output prefixed, next-turn warning injected, and session kept alive/adopted.
- `src/tools/job.ts:27-31`, `188-229`, `347-374`, and `387-458` add the `interrupt` command, ownership/status gating, snapshot flag, output section, and details payload. `src/tools/job.ts:95-99` ensures interrupt outcomes are not treated as useless all-running polls.
- `src/prompts/tools/job.md:1-27` documents interrupt vs cancel.

## Interrupt semantics contract

| Operation | Job status | Job flags | Registry/session | Delivery/text |
|---|---|---|---|---|
| `job cancel` | `cancelled` | unchanged | `aborted`, disposed | no completion delivery |
| `job interrupt` | `completed` | `interruptRequested`, then `interrupted` | `idle`, adopted, irc-addressable | normal completion delivery with `[interrupted: reason]` prefix |
| normal completion | `completed` | no interrupt flags | `idle`, adopted | normal completion delivery |
| failure | `failed` | no interrupt flags unless future interrupted failure path occurs | `idle`, adopted | normal failure delivery |

Markers:
- Interrupt result text: `[interrupted${reason ? ": reason" : ""}]\n\n<partial>`.
- Follow-up refresh text: `<latest assistant text>\n\n[refreshed after follow-up turn]`.

## Tests added/updated

- `test/async-job-manager.test.ts:116-199`
  - terminal `refreshResultText` updates completed/failed jobs, clears `errorText`, and does not enqueue another delivery.
  - running `refreshResultText` is rejected/no-op.
  - `interrupt` enforces ownership, aborts with typed sentinel, sets flags, and lets the job complete/deliver normally.
- `test/task/job-interrupt-fresh-results.test.ts:148-279`
  - later `agent_end` refreshes completed task job text once per turn without re-delivery.
  - isolated/worktree task jobs are not refreshed.
  - soft interrupt leaves registry idle/adopted, preserves session, prefixes partial text, and injects next-turn note.
  - hard cancel remains terminal: job `cancelled`, registry `aborted`, session disposed, no interrupt note.
- `test/task/hotswap.test.ts:470-502`
  - `job interrupt` tool reports kept-alive message, records reason, enforces ownership, and rejects non-running jobs cleanly.

## Validation

Not run by this implementation subagent: the assigned role explicitly forbids running tests, typecheck, lint, package managers, or project-wide commands. Recommended coordinator validation:

- `bun test test/async-job-manager.test.ts`
- `bun test test/task/job-interrupt-fresh-results.test.ts`
- `bun test test/task/hotswap.test.ts`

## Risks / blockers

No known implementation blockers. Abort reasons are carried via `AbortController.abort(reason)` and read from `signal.reason`; the manager-level test asserts the sentinel is observable by the job body.

## Post-review fixes (round 2)

- `src/async/job-manager.ts:65-66`, `src/async/job-manager.ts:112-113`, `src/async/job-manager.ts:215-225`, and `src/async/job-manager.ts:282-304` add persistent job `hardCancelled`/`isolated` state, record isolated registration, mark interrupt-then-cancel as authoritative hard cancel, and make manager-level interrupts reject isolated jobs.
- `src/task/executor.ts:735`, `src/task/executor.ts:852-905`, `src/task/executor.ts:1334-1339`, and `src/task/executor.ts:1825-1847` thread the job hard-cancel predicate into teardown so a later hard cancel overrides the immutable interrupt abort reason before keep-alive decisions at `src/task/executor.ts:2237-2262`.
- `src/task/index.ts:793-803`, `src/task/index.ts:893-916`, and `src/task/index.ts:1006-1010` record per-spawn isolated-ness when registering background task jobs.
- `src/tools/job.ts:69`, `src/tools/job.ts:83-86`, and `src/tools/job.ts:199-215` reject `job interrupt` for isolated jobs with `Background job <id> is isolated — interrupt cannot keep it alive; use cancel.` while leaving `job cancel` unchanged.
- `test/async-job-manager.test.ts:201-243` covers manager-level interrupt-then-cancel suppression; `test/task/job-interrupt-fresh-results.test.ts:299-389` covers executor teardown, no interrupt note/delivery, isolated interrupt rejection, and isolated cancel.

Validation not run by this patch subagent per assignment constraints; targeted coordinator checks remain:

- `bun test test/async-job-manager.test.ts`
- `bun test test/task/job-interrupt-fresh-results.test.ts`
