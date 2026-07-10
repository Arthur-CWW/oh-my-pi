# Fable Guard Leak Fix — QA Report

## Leak A: empty model patterns bypass the guard

**File:** `vendor/oh-my-pi/packages/coding-agent/src/config/model-resolver.ts`
**Function:** `resolveModelOverrideWithAuthFallback` (line ~985)

**Mechanism:** When `modelPatterns` is `[]` (empty array), `resolveModelOverride([])` returns
`{ explicitThinkingLevel: false }` with `model: undefined` (line 921 early-return).
The blocked-model guard at line ~997 (`if (primary.model && isBlockedSubagentModel(primary.model))`)
never fires because `primary.model` is falsy. The early-return at line ~1024
(`if (!primary.model || !parentActiveModelPattern)`) triggers, returning
`{ model: undefined, authFallbackUsed: false }`. Downstream session creation
then inherits the parent model — which can be Fable or any orchestrator-only model.

**Fix:** After the primary resolution, when `primary.model` is undefined AND
`parentActiveModelPattern` is set, resolve the parent pattern and run it through
`isBlockedSubagentModel`. If allowed, return the parent model as the explicit
resolution (`authFallbackUsed: false`). If blocked, enter the fallback chain
(pi/task, pi/smol, pi/slow). If no fallback found, return `blocked: true`.

## Leak B: guard exhaustion silently defaults to Fable downstream

**File:** `vendor/oh-my-pi/packages/coding-agent/src/config/model-resolver.ts` (line ~1058)
**Callsite:** `vendor/oh-my-pi/packages/coding-agent/src/task/executor.ts` (line ~1934)

**Mechanism:** When the Fable guard exhausts all fallback patterns without finding
a non-blocked alternative, it returned `{ model: undefined, authFallbackUsed: false }`
(no distinguishing marker). The executor checked `authFallbackUsed && model` — false.
Then `if (model)` — false. Execution proceeded unblocked; `createAgentSession`
received `model: undefined` and defaulted to the parent model, which is the blocked model.

**Fix:** Added `blocked: boolean` field to the return type. When the guard exhausts
all fallbacks, returns `{ blocked: true, model: undefined, ... }`.
At the executor callsite (line ~1948), when `blocked` is true, throws:
`"Subagent model resolution blocked: requested/inherited model is not allowed for subagents and no fallback role is configured — set modelRoles.task"`

## Config-driven guard (scope update)

**`isBlockedSubagentModel`** is now config-driven via `task.orchestratorOnlyModels`
(string[] setting, default `["*fable*"]`). Patterns are matched case-insensitively
against `provider/id` using simple glob matching (`*` = any chars). The hard-coded
`fable` substring check is retained as a built-in floor regardless of settings.

**Affected callsites:**
- `model-resolver.ts`: `resolveModelOverrideWithAuthFallback` — settings already threaded
- `hotswap.ts:138`: `resolveRestorableSessionModel` — `settings` param already available
- `hotswap.ts:184`: `hotswapAgentModel` — `session.settings` used

## Files changed

| File | Change |
|------|--------|
| `src/config/settings-schema.ts` | Added `task.orchestratorOnlyModels` array setting with default `["*fable*"]` |
| `src/config/model-resolver.ts` | `isBlockedSubagentModel` now config-driven; `resolveModelOverrideWithAuthFallback` fixes Leak A (empty patterns + blocked parent), Leak B (`blocked` marker), threads settings |
| `src/task/executor.ts` | Destructures `blocked` from resolver; throws on `blocked: true` |
| `src/task/hotswap.ts` | Threads `settings` into both `isBlockedSubagentModel` calls |
| `test/model-resolver.test.ts` | 5 new tests in existing `resolveModelOverrideWithAuthFallback` describe block |

## Tests

| # | Name | Covers |
|---|------|--------|
| 1 | empty patterns + fable parent + configured pi/task role resolves the task role | Leak A: inherits parent blocked, falls back to task role |
| 2 | empty patterns + fable parent + no roles returns blocked marker | Leak A+B: no fallback available, blocked marker set |
| 3 | empty patterns + non-fable parent returns parent model unchanged | Leak A: non-blocked parent is inherited directly |
| 4 | non-fable model blocked via orchestratorOnlyModels setting triggers fallback | Config-driven: explicit patterns with direct resolution |
| 5 | non-fable model blocked via setting with empty patterns inherits fallback | Config-driven: blocked parent inheritance via setting |
| existing | blocks Fable for subagents and falls back to a non-Fable task lane | Regression: existing test unchanged |

## Recommended validation commands

```bash
cd vendor/oh-my-pi/packages/coding-agent && bun test test/model-resolver.test.ts
cd vendor/oh-my-pi/packages/coding-agent && bun test test/issue-985-subagent-auth-fallback.test.ts
cd vendor/oh-my-pi/packages/coding-agent && bun test test/task/task-model-override.test.ts
```

## Non-goals (confirmed unchanged)

- No changes to main-session model logic
- hotswap.ts: only `isBlockedSubagentModel` calls updated (settings threaded), no other changes
