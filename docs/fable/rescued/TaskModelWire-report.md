> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-04T06-00-08-576Z_019f2bb6-8080-7000-8a22-156408ea1a65/local/TaskModelWire-report.md

# TaskModelWire report

## Root cause
- `params.model` was present in task item schema/types and `spawnParamsFor`, but the async scheduling receipt path was not resolving it before job registration, so invalid per-spawn model selectors were only discovered later in execution and receipts had no resolved model chain.
- `#resolveSpawnModel` and `formatModelChain` existed but were unused, leaving the scheduling path and receipt formatter unwired.

## Changes file:line
- `vendor/oh-my-pi/packages/coding-agent/src/task/index.ts:127-156` exports model-chain/error formatting helpers and defines the `SpawnModelResolution` seam.
- `vendor/oh-my-pi/packages/coding-agent/src/task/index.ts:552-559` adds `#preResolvedModels`, keyed by agent id, so schedule-time model resolution is consumed by `#runSpawn` instead of repeated.
- `vendor/oh-my-pi/packages/coding-agent/src/task/index.ts:763-779` resolves each async spawn's model before scheduling, marks invalid overrides failed without registering a job, records `modelOverride`/`resolvedModel` on progress, stores successful resolutions for execution, and builds receipt model chains.
- `vendor/oh-my-pi/packages/coding-agent/src/task/index.ts:813-847` includes resolved chains in single-spawn and multi-spawn receipts.
- `vendor/oh-my-pi/packages/coding-agent/src/task/index.ts:1136-1137,1197-1198` consumes schedule-time resolution when `preAllocatedId` is present, otherwise falls back to inline resolution for sync paths.
- `vendor/oh-my-pi/packages/coding-agent/src/task/index.ts:1322-1325` seeds initial progress with the pre-resolved display model.
- `vendor/oh-my-pi/packages/coding-agent/test/task/task-model-override.test.ts:1-145` adds focused coverage for chain formatting, receipt text, and invalid-model schedule failure without a live LLM call.
- `vendor/oh-my-pi/packages/coding-agent/CHANGELOG.md:5-7` documents per-spawn `model` overrides and resolved-chain receipts under `[Unreleased]`.

## Verification
- Passed: `bun --cwd=vendor/oh-my-pi/packages/coding-agent test test/task/task-model-override.test.ts`.
- Observed output: 3 pass, 0 fail, 10 expect() calls.

## Open risks
- Full repo formatting/lint/typecheck were intentionally not run per assignment constraints; coordinator owns broader gates.
