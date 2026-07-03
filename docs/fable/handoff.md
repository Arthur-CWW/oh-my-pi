# Fable → Next Session Handoff

Starting a Fable OMP session in `~/agents`:

```bash
omp --config ./.omp/fable-config.yml --model <fable-model-id>
```

(The overlay kills the advisor, binds `reviewer→GPT-5.5` and `designer→Opus`, disables autolearn. Without it, `pi/slow` lanes degrade through the fable-guard.)

## Read (in order, nothing else by default)

1. [`charter.md`](charter.md) — identity, priorities, routing, contracts, exclusions.
2. [`atlas.md`](atlas.md) — where everything lives: code, artifacts, sessions, config.
3. `TASKS.md` — active and next rows.
4. Whatever Arthur points at.

## Sharded sessions (one per stream)

Run parallel Fable sessions, one per stream, same launch command. First message convention:

> You own `streams/<companion|playground|primer|harness>/` — read the charter, then `streams/<x>/GOAL.md`, then atlas sections as needed.

Parallel etiquette:

- Stay inside your GOAL.md **owner paths**; its Excludes section is binding.
- Cross-stream reuse goes through `packages/` — graduate a shared lib, never reach into a sibling's paths.
- Shared-context changes (charter, framing, atlas) are committed promptly; pull before editing them.
- Coordinate via `TASKS.md` rows, not by editing another stream's files.
- Harness is background: any session may *log* friction, only the harness session lands harness changes.
- Model-role note: subagent lanes bind at session launch — config changes require a fresh session to take effect.

## Retrieve on demand

- Harness iteration: [`harness-brief.md`](harness-brief.md), then [`harness-slimming.md`](harness-slimming.md).
- Previous sessions: [`session-index.md`](session-index.md) → `data/fable-prep/`.
- Dictation ambiguity: [`transcription-notes.md`](transcription-notes.md).
- Creative north star: `docs/state/creative-framing.md`, `docs/state/video-creative-direction.md`.

Superseded docs (`context.md`, `preferences.md`, `workstream-map.md`, `model-routing.md`) were collapsed into charter + atlas + harness-brief on 2026-07-03; recover from git history if needed.
