> Rescued 2026-07-13 from /Users/arthur/agents/local/spawn-overlay-verification-contract.md

# Spawn Overlay and Feature-Pod Verification Contract

Status: implementation-ready design  
Date: 2026-07-10  
Scope: `vendor/oh-my-pi/packages/coding-agent` task spawns only

Reads with `/Users/arthur/.omp/agent/sessions/-agents/2026-07-10T03-31-32-592Z_019f4a14-9c70-7000-abd0-20957c2aad05/SpawnOverlayMap.md`, `docs/plans/pi-agent-control-plane.md` §L3/Feature-pod verification, `docs/plans/harness-control-primitives.md`, `docs/fable/priors.md:125`, and `local/resolved-route-events-contract.md`.

## Summary

Extend each existing `task` spawn item with a bounded execution budget, narrowing-only tool and skill policies, a small typed settings overlay, and a declarative feature-pod verification manifest. Checks still run through the child's normal approved tools: the task executor never evaluates packet strings or creates another shell/process surface. The executor records observed owner self-checks or independent reviewer reruns into a derived report beside the existing task output. An explicitly cancelled non-isolated child with a durable journal is parked and revivable under its stable id, with report and `history://` paths returned. Omitted fields preserve current behavior.

## Assumptions

1. Per-spawn budget follows the L3 `SpawnPacket.budget` dimensions already measured by the executor: assistant requests, cumulative non-cache-read tokens, USD cost, tool calls, and wall clock.
2. An overlay may only narrow authority. It cannot grant a tool excluded by the effective agent or plan mode, re-enable recursion/LSP/MCP/eval/bash, enable a disabled skill, or change auth/model/routing/isolation/approval/discovery paths.
3. Verification commands are instructions and observation matchers, not commands automatically executed by the harness. The child invokes existing `bash`, `eval`, or other tool surfaces normally.
4. “Cancelled → parked” means explicit caller/job hard cancellation after a non-isolated child session and journal exist. Budget exhaustion remains terminal. Current non-isolated wall-clock timeout keep-alive and isolated transcript-only behavior remain unchanged. Cancellation before allocation cannot create a parked child.
5. Session JSONL and tool events remain source truth. The report is a derived index, not a second ledger.

## Changes

### 1. Frozen task-item schema

In `vendor/oh-my-pi/packages/coding-agent/src/task/types.ts`, add strict Zod schemas and exported types, then add the five optional fields to flat/batch item shapes and `TaskItem`/`TaskParams`:

```ts
interface SpawnBudget {
  /** 0 disables only the existing request guard. */
  readonly requests?: number
  readonly tokens?: number
  readonly costUsd?: number
  readonly toolCalls?: number
  readonly wallClockSec?: number
}

interface SpawnNamePolicy {
  readonly allow?: readonly string[]
  readonly deny?: readonly string[]
}

type SpawnSettingsOverlay = Readonly<{
  "read.defaultLimit"?: number
  "read.summarize.enabled"?: boolean
  "read.summarize.prose"?: boolean
  "read.summarize.minBodyLines"?: number
  "read.summarize.minCommentLines"?: number
  "read.summarize.minTotalLines"?: number
  "read.summarize.unfoldUntil"?: number
  "read.summarize.unfoldLimit"?: number
  "read.toolResultPreview"?: boolean
  "tools.format"?:
    | "auto" | "native" | "glm" | "hermes" | "kimi" | "xml"
    | "anthropic" | "deepseek" | "harmony" | "pi" | "qwen3"
    | "gemini" | "gemma"
}>

type VerificationPhase = "owner-self-check" | "reviewer-rerun"
type VerificationSurface = "bash" | "eval" | "tool"

type JsonValue =
  | null | boolean | number | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

interface VerificationCheck {
  readonly id: string
  readonly label: string
  readonly surface: VerificationSurface
  /** Exact canonical active tool name. */
  readonly tool: string
  /** Exact JSON-compatible args matched against observed tool events. */
  readonly args: Readonly<Record<string, JsonValue>>
  readonly expected: string
}

interface VerificationScenario {
  readonly id: string
  readonly setup: string
  readonly action: string
  readonly expected: string
  /** Checks that constitute observed coverage of this scenario. */
  readonly checkIds: readonly string[]
}

interface OwnerVerificationSource {
  readonly agentId: string
  readonly reportPath: string
}

interface SpawnVerificationSpec {
  readonly phase: VerificationPhase
  readonly checks: readonly VerificationCheck[]
  readonly scenarios?: readonly VerificationScenario[]
  /** Required only for reviewer-rerun; forbidden for owner-self-check. */
  readonly ownerSource?: OwnerVerificationSource
}

interface TaskItem {
  // existing fields unchanged
  readonly budget?: SpawnBudget
  readonly tools?: SpawnNamePolicy
  readonly skills?: SpawnNamePolicy
  readonly settings?: SpawnSettingsOverlay
  readonly verification?: SpawnVerificationSpec
}
```

#### Validation and defaults

- Every nested object is `.strict()`; unknown keys reject rather than being silently stripped.
- `budget` must contain at least one field. `requests`, `tokens`, `toolCalls` are integers in `0..1_000_000`; `costUsd` is finite in `0..1_000_000`; `wallClockSec` is an integer in `60..3600`.
- Omitted `budget.requests` preserves current `task.softRequestBudget` and bundled `explore`/`quick_task` behavior. A provided value replaces it for this spawn. Steering occurs once at the cap and graceful abort at `ceil(cap × 1.5)`; `requests: 0` disables both, matching current semantics.
- `tokens: 0`, `costUsd: 0`, and `toolCalls: 0` are hard caps reached at the first observed unit; omitted means no new cap.
- Existing `timeoutSec` remains supported. `budget.wallClockSec` supplies the same executor wall-clock value. If both are present and unequal, reject before agent allocation; if equal, accept. Otherwise precedence is `budget.wallClockSec`, then `timeoutSec`, then `task.maxRuntimeMs`.
- Name arrays contain 1–64 trimmed values, each 1–128 code points, unique after trimming. Empty policy objects reject. Unknown names reject after fresh agent/skill discovery with field-specific diagnostics.
- `deny` wins over `allow`. Tool policy is narrowing-only: allow is intersected with the effective agent/plan-mode base. Tool deny-only is rejected if that base is implicit/unbounded; skills may use deny-only because the parent-discovered skill set is enumerable.
- Tool policy uses canonical active names. `exec` is rejected in packet policy; use `bash` and/or `eval`. `yield` and `irc` are executor invariants and reject in `deny`.
- Settings bounds: `read.defaultLimit` 1–5000; body/comment/total thresholds 0–100000; `unfoldUntil` 0–5000; `unfoldLimit` 1–5000; require `unfoldUntil <= unfoldLimit`. Empty overlays reject. No other setting key is accepted.
- Verification ids match `^[A-Za-z][A-Za-z0-9._-]{0,63}$` and are unique. Text fields are trimmed, non-empty, and at most 2000 characters. Checks contain 1–32 items; scenarios 1–32 when present; every scenario `checkId` must name a declared check.
- Reviewer phase requires `ownerSource`; owner phase forbids it. Reviewer `ownerSource.agentId` must differ case-insensitively from the requested reviewer id. `reportPath` accepts existing `agent://`, `artifact://`, or absolute task-artifact paths and must decode as a version-1 owner report before allocation.
- All defaults are absence: no budget override, tool/skill filtering, settings overlay, or verification capture. Parent `Settings`, tools, and skills are never mutated or persisted.

### 2. Spawn normalization and resolution

In `vendor/oh-my-pi/packages/coding-agent/src/task/index.ts`:

- Extend `resolveSpawnItems` and `spawnParamsFor` to copy all five fields without materializing absent keys. In batch mode they are per-item only; no top-level defaults.
- Validate discovered tool and skill names before worktree/artifact/session allocation.
- Resolve the tool base after plan-mode restrictions and effective agent selection. Intersect allow, subtract deny, then retain existing max-depth removal and executor/SDK invariants. The overlay never adds authority.
- Filter `availableSkills` with allow/deny, then resolve `agent.autoloadSkills` against the filtered list so denied skills are neither advertised nor injected.
- Render a bounded `# Verification` prompt block only when requested. It identifies phase/checks/scenarios and owner report for reviewers, instructs the child to use ordinary tools, and forbids claiming unobserved passes. Serialize args as escaped JSON; never concatenate them into a shell command.
- Pass resolved tools/skills plus budget/settings/verification as typed `ExecutorOptions`. Do not mutate agent definitions or session-global settings.
- Change `#registerSpawnJob` follow-up rendering to accept the settled `SingleResult`, not only `aborted: boolean`. When `parkedReportPath` exists, the cancelled result text must say the stable child is parked, include that exact path and `history://<id>`, and avoid the current terminal “was aborted” wording. This text is what the existing async job record retains after settlement.

### 3. Executor budget and evidence

In `vendor/oh-my-pi/packages/coding-agent/src/task/executor.ts`:

- Add `budget?`, resolved `toolNames?`, filtered `skills`, `settingsOverlay?`, and `verification?` to `ExecutorOptions`.
- Apply the overlay through `createSubagentSettings`. Packet values are merged before the existing forced child values (`async.enabled=false`, `bash.autoBackground.enabled=false`, `tools.approvalMode=yolo`) so packets cannot override those invariants. Reuse the schema allowlist defensively.
- Use the already-resolved canonical whitelist. Preserve current frontmatter `exec` expansion, max-depth gate, IRC addition, SDK yield injection, and current LSP/MCP/settings gates.
- Extend `createSubagentRunMonitor` to check cumulative counters after each `message_end` and `tool_execution_end`. Abort once when `tokens >= cap`, `cost >= cap`, or completed `toolCount >= cap`; wall clock reuses the existing timer. Store a stable code:

```ts
type SpawnAbortCode =
  | "budget_requests" | "budget_tokens" | "budget_cost"
  | "budget_tool_calls" | "timeout" | "caller_cancel"
```

If caps cross together, precedence is timeout, requests, tokens, cost, tool calls. Preserve a human abort reason as well.

- Capture verification only from actual `tool_execution_start/end` events. Match exact canonical tool name plus deep-equal normalized args. A check passes only when exactly one matching call completes non-error and, for bash, has observed exit code 0. Duplicate matches are `ambiguous`; a start without an end is `aborted`; assistant prose never passes a check.
- Write `<id>.verification.json` after the current `<id>.md` output. It is derived evidence. Write failure is non-fatal but returns `report_write_failed`; never invent a path.

```ts
type VerificationCheckStatus =
  | "passed" | "failed" | "not_run" | "aborted" | "ambiguous"

interface VerificationCheckResult {
  readonly id: string
  readonly status: VerificationCheckStatus
  readonly toolCallIds: readonly string[]
  readonly startedAtMs: number | null
  readonly endedAtMs: number | null
  readonly exitCode: number | null
  readonly isError: boolean | null
  readonly artifactPaths: readonly string[]
}

interface VerificationRunReport {
  readonly version: 1
  readonly phase: VerificationPhase
  readonly agentId: string
  readonly sessionFile: string
  readonly taskOutputPath: string
  readonly ownerSource: OwnerVerificationSource | null
  readonly startedAtMs: number
  readonly endedAtMs: number
  readonly outcome: "passed" | "failed" | "incomplete" | "cancelled"
  readonly checks: readonly VerificationCheckResult[]
  readonly scenarios: readonly {
    readonly id: string
    readonly status: "covered" | "not_covered"
    readonly checkIds: readonly string[]
  }[]
  readonly budget: {
    readonly requests: number
    readonly tokens: number
    readonly costUsd: number
    readonly toolCalls: number
    readonly durationMs: number
    readonly abortCode: SpawnAbortCode | null
  }
}
```

Add to `SingleResult`:

```ts
verification?: {
  phase: VerificationPhase
  outcome: VerificationRunReport["outcome"]
  status: "written" | "report_write_failed"
  reportPath?: string
  ownerAgentId?: string
}
/** Caller-cancelled child retained as parked. */
parkedReportPath?: string
abortCode?: SpawnAbortCode
```

Owner metadata proves only an observed self-check. Reviewer metadata proves a distinct session reran the declared checks and links, but never overwrites, the owner report. Coordinator aggregation is outside this feature.

### 4. Explicit cancellation parks a durable child

Keep lifecycle truth in current session JSONL, `AgentRegistry`, and `AgentLifecycleManager`.

For `caller_cancel` after a non-isolated session has `sessionFile` and `reviveSession`:

1. capture salvage and finalize task/verification reports;
2. dispose the live session to close the JSONL writer;
3. detach it, retain the same registry ref/session file, set status `parked`, then register the already-parked handle through the new lifecycle API below;
4. return `parkedReportPath = verification.reportPath ?? outputPath` and `history://<id>` in the cancelled job result;
5. later IRC/`ensureLive` reopens the same journal and returns the same stable id to idle.

Freeze this lifecycle expansion in `agent-lifecycle.ts`:

```ts
/** Register a child which the executor has already disposed and marked parked. */
adoptParked(id: string, opts: AdoptOptions): void
```

`adoptParked` requires a non-main registry ref with `status === "parked"`, `session === null`, a non-null `sessionFile`, and `opts.revive`; it throws on invariant violation. It records the same `AdoptedAgent` state as `adopt` but deliberately does not arm a timer or change status. `opts.idleTtlMs` is retained: after `ensureLive` revives the child and emits `idle`, the existing registry listener arms the normal configured idle TTL. Executor calls `adoptParked(id, { idleTtlMs: agentIdleTtlMs, revive: reviveSession })` only after dispose/detach/status ordering completes.

Do not misuse existing `adopt`: its public contract requires the caller to have set `idle`, and `idleTtlMs <= 0` means “never auto-park,” not “register a parked child.” Do not call `park` before adoption either; it is a no-op for an unadopted child. Do not add `cancelled` to `AgentStatus`; the source-first timeline may emit `cancel` then `park`, while the usable in-process handle is `parked`.

Isolated children remain non-revivable parked transcript references because their worktree is merged/cleaned. Budget abort remains `aborted`/disposed but returns output/report path when writing succeeds. Wall-clock timeout and soft interrupt keep current behavior. Before-start cancellation returns `Cancelled before start`, no report path, and no registry ref.

### 5. Security invariants

- Packet handling never calls `Bun.spawn`, `$`, `child_process`, or a shell. It only exposes declarative checks to the child and observes normal tool events.
- `surface=bash` requires `tool=bash`; `surface=eval` requires `tool=eval`. `surface=tool` rejects `bash`, `eval`, `exec`, `task`, `irc`, and `yield`.
- A check whose tool is unavailable after policy resolution rejects the spawn. There is no fallback to bash.
- Paths/cwd/commands are neither normalized nor executed by the verifier. Exact args are rendered as escaped JSON and matched as data. Quoting remains inside the existing approved bash call.
- The settings overlay cannot touch `tools.approval*`, `bash.*`, `eval.*`, `mcp.*`, `skills.*`, `task.*`, auth, model, environment, extension/custom-tool paths, filesystem roots, telemetry, or isolation.
- Plan mode is applied before overlays; a packet cannot regain write/command tools.

## Sequence

1. Freeze schema/types and flat/batch propagation tests.
2. Implement runtime settings/tool/skill policy, budget guards, event observation, report writing, and result metadata as one executor pod; never split `executor.ts` among workers.
3. After report paths exist, implement explicit caller-cancel parking/revival and result rendering.
4. Preserve cancelled jobs until their run settles, then expose the parked report through normal `job poll`; this depends on the prior two pods.
5. The implementation owner runs focused checks and produces the owner report. A different stable agent id receives the same manifest as `reviewer-rerun`, reruns checks, and adds adversarial cases.
6. The coordinator alone runs the final package gate. Only after smoke behavior works, update task docs/CHANGELOG if repository convention requires it.

## Disjoint implementation ownership

### Pod A — packet schema (4 files)

- `vendor/oh-my-pi/packages/coding-agent/src/task/types.ts`
- `vendor/oh-my-pi/packages/coding-agent/src/task/index.ts`
- `vendor/oh-my-pi/packages/coding-agent/test/task/task-schema.test.ts`
- `vendor/oh-my-pi/packages/coding-agent/test/task/task-batch.test.ts`

Owns types/Zod, flat/batch copy, discovered-name validation, prompt rendering, and forwarding. Does not edit executor/lifecycle.

### Pod B — runtime and verification (4 files)

- `vendor/oh-my-pi/packages/coding-agent/src/task/executor.ts`
- `vendor/oh-my-pi/packages/coding-agent/test/task/task-guards.test.ts`
- `vendor/oh-my-pi/packages/coding-agent/test/task/executor-pass-through.test.ts`
- `vendor/oh-my-pi/packages/coding-agent/test/task/autoload-skills.test.ts`

Owns settings clone, tool/skill pass-through, counters, check matching, JSON report, cancellation branch, and result metadata. This is the sole executor owner.

### Pod C — lifecycle proof (3 files)

- `vendor/oh-my-pi/packages/coding-agent/src/registry/agent-lifecycle.ts`
- `vendor/oh-my-pi/packages/coding-agent/test/registry/agent-lifecycle.test.ts`
- `vendor/oh-my-pi/packages/coding-agent/test/task/executor-wall-clock.test.ts`

Own the required `adoptParked(id, opts)` lifecycle expansion and its invariant tests: rejects main/unknown/live/non-parked/missing-journal/missing-reviver refs; registers without a timer or status mutation; revives through `ensureLive`; and uses the configured positive idle TTL after revival. The wall-clock test freezes the non-change that timeout remains idle/revivable rather than entering the caller-cancel branch. Do not weaken or overload existing `adopt`, and do not reopen schema/report logic.

### Pod D — cancelled job report delivery (4 files)

- `vendor/oh-my-pi/packages/coding-agent/src/async/job-manager.ts`
- `vendor/oh-my-pi/packages/coding-agent/src/tools/job.ts`
- `vendor/oh-my-pi/packages/coding-agent/test/async-job-manager.test.ts`
- `vendor/oh-my-pi/packages/coding-agent/test/task/job-interrupt-fresh-results.test.ts`

`cancel()` still changes status and aborts immediately, but it must not schedule eviction until the run promise settles. The cancelled settle branch stores the task result/error text containing `parkedReportPath`, then starts the existing eviction TTL. `job cancel` returns `status: cancelled`, `reportPending: true`, and an instruction to poll the same id; `job poll` exposes the settled result/error text and path. Do not deliver cancelled completion asynchronously and do not add another job/result store.

No pod edits control-plane storage, `AgentRegistry`, `SessionManager`, `sdk.ts`, settings schema, agent definitions, or root scripts.

Dependencies: Pod B consumes Pod A's frozen types; Pod C consumes Pod B's abort code/report path; Pod D depends on Pod A's result-text formatting and Pod B's settled path. Route publisher v7 may later attach owner output as `taskOutput` and reviewer evidence as `review`, but is not a dependency for local correctness.

## Edge Cases

- Omitted fields must be behavior-equivalent to current spawns, including explore/quick-task request defaults, inherited skills, plan mode, and timeouts.
- Batch items may differ; never mutate/share policy arrays or objects across concurrent runs.
- Unknown, case-mismatched, duplicate, denied-autoload, unavailable LSP/MCP, and `exec` policy names fail before start.
- Empty resolved tool sets still receive executor invariants only; a verification check for an unavailable tool fails preflight.
- Crossing a cap while a tool is in flight sends one abort and follows existing cleanup; no second check or double dispose.
- Cache-read tokens remain excluded. Cost compares unrounded cumulative USD.
- Duplicate matching calls are ambiguous. Started-only calls are aborted. “Tests pass” prose without tool evidence is `not_run`.
- Missing, unreadable, wrong-phase, or same-agent owner reports reject reviewer spawn. Owner/reviewer reports remain immutable peers.
- Cancellation during session creation must dispose any late-resolving session and must not claim a journal/reviver/report that does not exist.
- Close JSONL before revival. Report-write failure never deletes the transcript and falls back only to an actually written task output path.
- Isolated cancellation never claims revivability; budget/timeout are not relabeled as caller cancellation.

## Verification

From `vendor/oh-my-pi/packages/coding-agent`, using the existing approved bash surface:

### Implementation-owner self-check

1. `bun test test/task/task-schema.test.ts test/task/task-batch.test.ts`
   - flat and batch shapes expose fields only per spawn;
   - strict nested objects reject unknown keys, bounds, duplicates, reserved tools, timeout conflicts, and invalid reviewer linkage;
   - absent fields preserve old behavior.
2. `bun test test/task/task-guards.test.ts test/task/executor-pass-through.test.ts test/task/autoload-skills.test.ts`
   - every budget dimension aborts at its boundary with the correct code;
   - request steer fires once and hard stop remains 1.5×;
   - only child settings change; parent remains unchanged;
   - tool intersection/deny, plan-mode non-escalation, skill filtering, denied autoload, and legacy frontmatter `exec` behavior are exact;
   - evidence comes only from real tool events and report schema/path is returned.
3. `bun test test/task/job-interrupt-fresh-results.test.ts test/registry/agent-lifecycle.test.ts`
   - explicit cancel yields parked/ref/sessionFile/report/history and can revive;
   - budget remains terminal; timeout/soft interrupt behavior is unchanged; isolated cancellation is not revivable.
4. `bun run check:types` after focused behavior passes.

### Independent reviewer rerun

Use a fresh stable agent id with `phase=reviewer-rerun` and the owner report. Rerun the same focused commands, then add these adversarial scenarios:

- plan-mode `tools.allow=["bash"]` cannot escalate;
- denied agent-autoload skill produces no hidden skill custom message;
- shell metacharacters in bash args are only rendered/matched, never executor-run;
- cancel between session creation and first prompt disposes once and parks only with a valid journal/reviver;
- token and tool-call caps crossed together use deterministic abort precedence and one abort;
- tampered owner report phase/id fails reviewer preflight.

Reviewer report must contain distinct agent/session identity, owner linkage, observed tool call ids, timestamps, exit/error metadata, and artifact paths. Coordinator then runs the existing final package gate once: `bun run check`.

## Critical Files

- `vendor/oh-my-pi/packages/coding-agent/src/task/types.ts:70-190,280-410` — item schemas, `TaskParams`, progress/result contracts.
- `vendor/oh-my-pi/packages/coding-agent/src/task/index.ts:350-410,1150-1440` — normalization, plan-mode agent, discovery, executor forwarding.
- `vendor/oh-my-pi/packages/coding-agent/src/task/executor.ts:707-730,800-1010,1611-1795,1810-1930,2075-2190,2299-2420` — settings clone, monitor, finalization, tool selection, session creation, autoload, teardown.
- `vendor/oh-my-pi/packages/coding-agent/src/registry/agent-lifecycle.ts:1-210` and `src/registry/agent-registry.ts:1-180` — idle/park/revive and stable refs.
- `vendor/oh-my-pi/packages/coding-agent/test/task/task-batch.test.ts`, `task-guards.test.ts`, `job-interrupt-fresh-results.test.ts`, and `test/registry/agent-lifecycle.test.ts` — nearest behavioral contracts.
- `docs/plans/pi-agent-control-plane.md:399-428`, `docs/plans/harness-control-primitives.md:12-78`, `docs/fable/priors.md:125` — packet and feature-pod doctrine.

## Alternatives rejected

- Persistent per-agent profiles: hidden mutable state and duplicate truth.
- An automatic verification command runner: arbitrary process injection that bypasses normal tool authorization/audit.
- Prompt-only pass claims: prose is not evidence.
- A new verification ledger: session JSONL/artifacts/registry and v7 artifact roles already provide truth and handles.
- Parking every abort: budget, timeout, isolation, startup race, and explicit cancellation have different recovery guarantees.

## Deferrals

- Budget UI/presets and visualization.
- Automatic owner/reviewer lane assignment and coordinator scheduling.
- Control-plane ingestion/export and aggregate release verdicts.
- Arbitrary argv/process execution outside current bash/eval/tool surfaces.
- Restoring isolated worktrees or in-flight turns after cancellation/restart.
