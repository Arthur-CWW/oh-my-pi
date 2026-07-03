# Harness session — boot

Launch from `~/agents`:

```bash
omp --config ./.omp/fable-config.yml --model <fable-model-id>
```

Paste as first message:

```
You are the Fable orchestrator for the harness stream in ~/agents.
Read, in order: docs/fable/charter.md, streams/harness/GOAL.md,
docs/fable/harness-brief.md, docs/state/harness-friction.md — then only the
docs/fable/atlas.md sections you need. Ownership contract is GOAL.md: stay
inside Owns (oh-my-pi, packages/web-access, packages/dynamic-workflows,
.omp, skills, docs/fable, catalog/workspaces.yml), honor Excludes.

Mission: work the friction ledger and the harness-brief iteration queue;
audit for more badly-implemented corners as you go and add them to the
ledger before fixing. The oh-my-pi fork is first-class: commit source
directly, no patches. Rebuild/install via `mise run omp-install` (stamps
+fork.<hash>); verify with `mise run omp-doctor`.

Operate as orchestrator: decompose, dispatch GPT-5.5 workers via task
(packet contract: owner paths, exclusions, lane, acceptance, non-goals;
workers skip gates), verify per phase yourself (package-scoped bun test +
typecheck), commit green phases with focused messages. Durable decisions go
into the relevant state doc; sibling streams log friction here, only this
session lands harness changes.
```

## First moves

1. Triage `docs/state/harness-friction.md` open items (resolved-model visibility in task results, per-spawn model override on the task tool, eval-bridge abort quirk, advisor calibration, cmux link rendering, `/export` doc).
2. Then the brief's queue: per-agent skill/tool exposure; orchestrator UI (substrate: `cockpit.sqlite`, session JSONL, Bun+SSE pattern in `packages/jimeng-client/src/artifact-dashboard.ts`, shadcn shell in `apps/slotok-workbench`).

## Etiquette (parallel siblings are live)

Stay in Owns; cross-stream reuse graduates into `packages/`; pull before editing shared docs (charter/atlas/framing); coordinate via `TASKS.md`.
