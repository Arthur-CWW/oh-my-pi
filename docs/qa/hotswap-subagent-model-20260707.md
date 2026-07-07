# Hotswap subagent model QA

## What changed

### Slice 1 — primitive
- Added `src/task/hotswap.ts` with the public `HotswapArgs` / `HotswapResult` contract at `vendor/oh-my-pi/packages/coding-agent/src/task/hotswap.ts:13`.
- Implemented `hotswapAgentModel` at `vendor/oh-my-pi/packages/coding-agent/src/task/hotswap.ts:117`:
  - rejects unknown, non-subagent, aborted, disposed, or model-less targets;
  - revives parked subagents through `AgentLifecycleManager.ensureLive`;
  - resolves selectors through `resolveModelOverride` and pre-checks credentials through `modelRegistry.getApiKey`;
  - treats same-model/no-explicit-thinking requests as no-op applied results without calling `setModel`;
  - applies idle swaps immediately with `session.setModel(model, "hotswap")`, optional explicit thinking, and a hidden next-turn notice;
  - queues streaming swaps on `agent_end`, subscribes before the race re-check, and uses a per-agent pending-swap cancel map for last-wins semantics.
- Added `resolveRestorableSessionModel` test seam at `vendor/oh-my-pi/packages/coding-agent/src/task/hotswap.ts:99` for revive model restoration.

### Slice 2 — job tool surface
- Extended the `job` schema with `setModel?: { id: string; model: string; reason?: string }` at `vendor/oh-my-pi/packages/coding-agent/src/tools/job.ts:27`.
- Added owner-scoped dispatch to `hotswapAgentModel` at `vendor/oh-my-pi/packages/coding-agent/src/tools/job.ts:125`; non-owner/missing jobs are denied before the primitive is called.
- Added result rendering strings at `vendor/oh-my-pi/packages/coding-agent/src/tools/job.ts:325`:
  - `applied`: `Hot-swap applied: <id> now <to> (was <from>)`
  - `queued`: `Hot-swap queued: <id> will switch <from> → <to> at its next turn boundary`
  - `failed`: `Hot-swap failed: <error>`
- Updated the TUI call/result target to show `swap model of <id>` and a successful empty-job hotswap display (`vendor/oh-my-pi/packages/coding-agent/src/tools/job.ts:476`, `vendor/oh-my-pi/packages/coding-agent/src/tools/job.ts:508`).
- Updated the model-facing job prompt/discovery text at `vendor/oh-my-pi/packages/coding-agent/src/prompts/tools/job.md:1` and the `setModel` operation docs at `vendor/oh-my-pi/packages/coding-agent/src/prompts/tools/job.md:22`.

### Slice 3 — parked revive preserves hotswap
- `buildSubagentSessionOptions` now accepts an optional restored model/thinking override while preserving the default captured spawn options when absent (`vendor/oh-my-pi/packages/coding-agent/src/task/executor.ts:1938`).
- The lifecycle reviver reopens the JSONL, resolves restorable role-first model state through `resolveRestorableSessionModel`, and passes the restored model into `createAgentSession` (`vendor/oh-my-pi/packages/coding-agent/src/task/executor.ts:2016`).

### Slice 4 — tests
- Added `vendor/oh-my-pi/packages/coding-agent/test/task/hotswap.test.ts`.
- Coverage includes:
  - idle immediate apply + `hotswap` role + next-turn notice (`:168`);
  - streaming queued return, single boundary apply, unsubscribe (`:187`);
  - subscribe race guard (`:202`);
  - last-wins queued swaps (`:213`);
  - unknown, aborted, unresolvable, missing-auth failures without throw (`:228`);
  - no-op same model without redundant `setModel` (`:253`);
  - parked revive then apply (`:264`);
  - hotswap role restore precedence (`:277`);
  - job `setModel` routing, ownership denial, and applied/queued/failed output (`:295`).

## Job op contract

`job` now accepts:

```ts
setModel?: {
  id: string;      // task job id, equal to the spawned subagent id
  model: string;   // provider/model id, fuzzy selector, role, or optional :<thinking> suffix
  reason?: string; // included in the target notice
}
```

Rules:
- Cannot be combined with `list`, `poll`, or `cancel`.
- Requires the target job to be visible under the caller's owner id, matching existing poll/cancel ownership semantics.
- Calls `hotswapAgentModel({ agentId: id, model, reason, requestedBy: this.session.getAgentId?.() })`.
- Applies immediately when idle, otherwise queues for the next `agent_end` boundary.
- The target subagent receives a hidden `deliverAs: "nextTurn"` system warning and no extra turn is triggered.

## Post-review fixes

- Verified the SDK thinking restore branch: `createAgentSession` uses `options.thinkingLevel` first, then restores the last persisted `thinking_level_change` from reopened JSONL when the option is undefined (`vendor/oh-my-pi/packages/coding-agent/src/sdk.ts:1290`). The final fix reads `SessionContext.thinkingLevel` directly in `resolveRestorableSessionModel`, so revived hotswap overrides carry persisted thinking explicitly (`vendor/oh-my-pi/packages/coding-agent/src/task/hotswap.ts:144`).
- Static syntax smoke checks completed with `ast_grep` on `src/task/hotswap.ts` and `test/task/hotswap.test.ts`; both parsed and matched the requested symbols.

- Fixed same-model explicit-thinking hotswaps to avoid provider session reset while still recording role `hotswap` for revive precedence (`vendor/oh-my-pi/packages/coding-agent/src/task/hotswap.ts:105`, `vendor/oh-my-pi/packages/coding-agent/src/task/hotswap.ts:184`).
- Fixed revive restore auth gating: restorable hotswap candidates are iterated in order and skipped unless `modelRegistry.hasConfiguredAuth(model)` passes, with warn logging on skipped unauthenticated models (`vendor/oh-my-pi/packages/coding-agent/src/task/hotswap.ts:135`).
- Added post-review tests in `vendor/oh-my-pi/packages/coding-agent/test/task/hotswap.test.ts`: same-model thinking-only hotswap (`:279`), hotswap restore with persisted thinking (`:310`), same-model thinking restore (`:329`), no-hotswap default-path regression (`:343`), unauthenticated hotswap restore fallback (`:357`).

## Targeted test results

Not run by this implementation subagent. The assigned role explicitly forbids running tests, typecheck, lint, formatters, package managers, or project-wide commands; the parent coordinator owns verification.

Recommended parent validation command:

```bash
bun --cwd vendor/oh-my-pi/packages/coding-agent test test/task/hotswap.test.ts
```

## Open risks

- The job prompt file was edited because Main confirmed it is the real discovery surface and should be treated as an owner path.
- The job tests use `vi.spyOn` on the hotswap module export to isolate the job tool output contract; if Bun cannot patch that live binding in this graph, convert those job cases to register real `AgentRegistry` session stubs instead.
