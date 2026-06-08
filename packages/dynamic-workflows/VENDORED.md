# Vendored pi-dynamic-workflows overview

Source: `pi-dynamic-workflows@1.0.1` from npm / <https://pi.dev/packages/pi-dynamic-workflows> / <https://github.com/Michaelliv/pi-dynamic-workflows>.

This package is vendored so it can be inspected, adapted, and tested inside this monorepo instead of being loaded as an opaque installed Pi package.

## What it implements

It adds one Pi tool: `workflow`.

The parent Pi assistant writes a deterministic JavaScript workflow script and passes it to the tool. The script can then fan out isolated subagent runs and return a JSON-serializable result.

Core globals available inside a workflow script:

- `agent(prompt, opts)` — run one isolated in-memory Pi subagent and return its final text, or structured JSON when `opts.schema` is supplied.
- `parallel(thunks)` — run `() => agent(...)` thunks concurrently and return results in input order.
- `pipeline(items, ...stages)` — run each item through sequential async stages while multiple items fan out concurrently.
- `phase(title)` — mark a live progress group.
- `log(message)` — append a workflow log line.
- `args` — optional JSON passed through the tool.
- `cwd` / `process.cwd()` — current working directory.
- `budget` — simple estimated token budget tracker.

## Script shape

A workflow script must start with literal metadata:

```js
export const meta = {
  name: 'short_snake_case',
  description: 'what this workflow does',
}

phase('Scan')
const scan = await agent('Inspect the relevant files.', { label: 'repo scan' })

phase('Review')
const critiques = await parallel([
  () => agent('Critique correctness using this scan:\n' + scan, { label: 'correctness critic' }),
  () => agent('Critique tests using this scan:\n' + scan, { label: 'test critic' }),
])

return { scan, critiques }
```

The metadata parser deliberately only accepts literal values. Spreads, computed keys, function calls, and template interpolation in `meta` are rejected.

## Runtime architecture

- `extensions/workflow.ts` registers the `workflow` tool and activates it on `session_start`.
- `src/workflow-tool.ts` defines the Pi tool schema, prompt guidelines, live rendering, abort handling, and final tool result.
- `src/workflow.ts` parses/validates scripts with `acorn`, evaluates the body inside a Node `vm` context, and implements `agent`, `parallel`, `pipeline`, `phase`, `log`, and `budget`.
- `src/agent.ts` implements `WorkflowAgent`: each `agent()` call creates a fresh in-memory Pi session with normal coding tools, then prompts it with the subtask.
- `src/structured-output.ts` adds a terminating `structured_output` tool for schema-constrained subagent returns.
- `src/display.ts` maintains compact workflow progress snapshots and renders tool output.

## Isolation model

Subagents are not shell subprocesses in this implementation. They are fresh in-memory Pi SDK sessions in the same Node process. That gives them separate conversation context windows while sharing the same working directory and normal Pi coding tools.

The workflow script itself runs in a restricted `vm` sandbox: no `require`, no imports, no fs/network APIs, no `Date.now()`, no `new Date()`, and no `Math.random()`.

## Failure behavior

- Failed `agent()` calls return `null` and log the failure, unless the whole workflow was aborted.
- Failed branches in `parallel()` / `pipeline()` also become `null`.
- The final result must be structured-cloneable; forgetting to `await agent()`/`parallel()`/`pipeline()` is detected.
- A workflow that never calls `agent()` is rejected by the tool.

## Current limitations from upstream

- Prototype status.
- No persisted/resumable workflow runs.
- No `/workflows` manager.
- Subagents share the same filesystem/worktree unless the prompts themselves avoid mutation.

## Local additions

- Added package-local parser/runtime tests under `test/workflow.test.ts`.
- Added `/adversarial-review` prompt template that asks the parent assistant to use `workflow` for a two-plus-critic review pass after a feature is completed.
