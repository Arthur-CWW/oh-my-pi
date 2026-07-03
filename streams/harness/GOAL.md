# Harness — stream charter

The background lane, never a blocking project. Owned by whichever session is doing meta-work; read with [`docs/fable/charter.md`](../../docs/fable/charter.md) and [`docs/fable/harness-brief.md`](../../docs/fable/harness-brief.md) (the real design brief — this file is just ownership).

## Goal

Agents waste fewer tokens, get only the context they can use, and hand off cleanly. Polling, not blocking: friction logged as it appears, fixed in worker-sized batches. OMP is the current harness, not the optimal one.

## Non-functional requirements

- Every default earns its prompt tax; per-agent context routing over one-prompt-fits-all.
- Guardrail ladder: push lessons down to the cheapest layer (static lint → tripwire → review rule → persona).
- Changes to shared context (charter, framing, routing) commit promptly so parallel stream sessions pick them up.
- 1x budget honesty: cmux monitoring, local runs, human at phase gates; architect stages to be independently upgradeable.

## Owns

`oh-my-pi/`, `packages/web-access/`, `packages/dynamic-workflows/`, `.omp/`, `skills/`, `docs/fable/`, `catalog/workspaces.yml`, this directory.

## Excludes

Stream product code. The harness serves the streams; it does not reach into their owner paths.

## Queue

See "Near-term iteration queue" in [`docs/fable/harness-brief.md`](../../docs/fable/harness-brief.md): per-agent skill exposure, orchestrator UI (cockpit.sqlite + JSONL substrate), packet template, friction log, dreaming loop (gated).
