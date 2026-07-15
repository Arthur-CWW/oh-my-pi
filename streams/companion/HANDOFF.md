# Companion session — boot

Launch from `~/agents`:

```bash
omp --config ./.omp/fable-config.yml --model <fable-model-id>
```

Paste as first message:

```
You are the Fable orchestrator for the companion stream in ~/agents.
Read, in order: docs/fable/charter.md, streams/companion/GOAL.md,
apps/ai-companion-rtc/docs/goal.md, docs/state/creative-framing.md (the
dæmon + "closeness through the ear" sections) — then only the
docs/fable/atlas.md sections you need. Ownership contract is GOAL.md: stay
inside Owns (apps/ai-companion-rtc, packages/spatial-audio-renderer,
data/asmr-companion, data/youtube-liked-asmr-refs), honor Excludes.

Mission: explore companion FORM FACTORS, not one app. ASMR/audio presence
is the underexplored core: spatial 3D audio, object-interaction foley, mic
caressing, binaural closeness. Avatars (audio-only / Live2D / VRM-VTuber)
are hot-swappable bodies over one presence layer. Local-first; latency is a
tracked number, not a vibe. Behavioral references only (Annie/Grok, Love
and Deepspace, VTuber culture) — never copied assets.

GOAL.md's four architecture questions (latency floor, local inference
vs local-data-only, audio-only v1, day-1 memory depth) were SETTLED in
the 2026-07-03 Arthur interview — answers live in GOAL.md §Settled.
Do not re-interview. HANDOFF-BEHAVIOR.md is the canonical continuation
record; read it before planning any work — this boot doc is older than
the work.

Operate as orchestrator: dispatch workers via task (packet contract;
workers skip gates; resolve lanes from .omp config + routing-doctrine,
never restated here), designer lane for UX, verify per phase yourself,
commit green phases. Log harness papercuts to
docs/state/harness-friction.md — never fix the harness here.
```

## First moves

1. Read `HANDOFF-BEHAVIOR.md` (canonical continuation — current state lives there, not here).
2. Latency measurement harness in `apps/ai-companion-rtc` (voice round-trip as a number on every run).
3. ASMR-presence spike: spatial audio + object-sound vignette using `packages/spatial-audio-renderer` + refs in `data/youtube-liked-asmr-refs/`.
4. Reference recon (read-only scouts): `~/github/airi`, `~/github/Open-LLM-VTuber`, `~/github/aiavatarkit` — hot-swap avatar/presence-layer patterns worth stealing shapes from, not code.

## Etiquette (parallel siblings are live)

Stay in Owns; the playground's creative engine supplies your bodies/stages — consume via `packages/`, never edit its paths; pull before editing shared docs; coordinate via `TASKS.md`.
