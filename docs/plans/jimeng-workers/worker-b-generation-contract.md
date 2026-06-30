# Worker B: Generation Contract Promotion Plan

Brief version: `2026-06-12.wave1.b`

Repo: `/Users/arthur/agents`

Mode: read-only. Do not edit files.

## Read First

- `docs/plans/jimeng-dreamina-cli-goal.md`
- `docs/plans/jimeng-fast-contract-extraction.md`
- `docs/provider/jimeng-api-triage.md`
- `TASKS.md`

## Task

Plan the smallest useful no-live-spend implementation slice for promoting saved `/mweb/v1/aigc_draft/generate` live matrix proofs into a cleaner typed submit/poll/artifact client surface.

This is part of the `gen-parity` packet.

## Inspect

- `packages/jimeng-client/src/generation-contract.ts`
- `packages/jimeng-client/test/generation-contract.test.ts`
- `packages/jimeng-client/src/client.ts`
- `packages/jimeng-client/src/capture.ts`
- generation-related sections of `packages/jimeng-client/src/browser-proxy-cli.ts`
- saved proof bundle, if present:
  - `data/jimeng-lab/proof-20260612-live-generation-matrix/`

## Return

Write:

```txt
data/jimeng-lab/worker-results/generation-contract-plan.md
```

Include:

- current typed generation surfaces
- exact missing surface
- smallest no-live-spend implementation slice
- proposed API names/types/functions
- exact files a later implementation worker should own
- tests to add/update
- acceptance commands
- risks or reasons not to implement yet
- agent id, model, brief version

Do not modify source files.
