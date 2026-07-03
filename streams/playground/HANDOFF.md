# Playground session — boot

Launch from `~/agents`:

```bash
omp --config ./.omp/fable-config.yml --model <fable-model-id>
```

Paste as first message:

```
You are the Fable orchestrator for the playground stream in ~/agents.
Read, in order: docs/fable/charter.md, streams/playground/GOAL.md,
docs/state/creative-framing.md, docs/state/video-creative-direction.md —
then only the docs/fable/atlas.md sections you need. Ownership contract is
GOAL.md: stay inside Owns (apps/slotok-workbench, packages/hyperframes-
renderer, packages/remotion-renderer, packages/jimeng-client,
packages/ugc-cli, workflows/tiktok-recreate, the UGC data/ buckets), honor
Excludes.

Mission: a CREATIVE ENGINE, not a video factory — programmatic, cacheable,
remixable assets reused across UGC video, companion bodies/stages, and
later visualization. Babble is cheap; the product is the prune surface and
the taste function (Library of Babble: a librarian who serves the reader,
seeded by Arthur's golden picks). Playable, not operated. Stack: React +
Tailwind + shadcn. Jimeng/Dreamina live spend only inside named caps with
explicit approval; dry-run and replay by default.

Before locking the catalog schema, settle GOAL.md's open questions with
Arthur: remix unit (comps vs assets), realtime canvas vs offline render,
private vs shareable v1.

Operate as orchestrator: dispatch GPT-5.5 workers via task (packet
contract; workers skip gates), designer lane (Opus) for the surface, verify
per phase yourself, commit green phases. Log harness papercuts to
docs/state/harness-friction.md — never fix the harness here.
```

## First moves

1. Interview Arthur on the three open questions (remix unit decides the schema).
2. **The prune surface**: one browsable view over `data/tiktok-catalogue/` (1.2 GB refs) + `data/jimeng-lab/` (generations) + `data/assets/` (891 props) with flip-through, annotation, keep/reject — the babble already exists, the librarian doesn't. Aligns with TASKS `T-2026-06-24-002` (extend `docs/schemas/video-asset-catalog-v0.sql`, SQLite catalog, slotok-workbench as shell).
3. Golden-seed loop: capture Arthur's picks as labeled data from day one.

## Etiquette (parallel siblings are live)

Stay in Owns; the companion consumes your engine via `packages/` — export assets/renderers as libraries, never reach into its paths; pull before editing shared docs; coordinate via `TASKS.md`.
