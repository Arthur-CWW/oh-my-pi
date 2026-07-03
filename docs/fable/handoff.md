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

## Retrieve on demand

- Harness iteration: [`harness-brief.md`](harness-brief.md), then [`harness-slimming.md`](harness-slimming.md).
- Previous sessions: [`session-index.md`](session-index.md) → `data/fable-prep/`.
- Dictation ambiguity: [`transcription-notes.md`](transcription-notes.md).
- Creative north star: `docs/state/creative-framing.md`, `docs/state/video-creative-direction.md`.

Superseded docs (`context.md`, `preferences.md`, `workstream-map.md`, `model-routing.md`) were collapsed into charter + atlas + harness-brief on 2026-07-03; recover from git history if needed.
