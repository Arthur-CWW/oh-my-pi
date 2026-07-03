# Fable → Next Session Handoff

Starting a Fable OMP session in `~/agents`:

```bash
omp --config ./.omp/fable-config.yml --model <fable-model-id>
```

(The overlay kills the advisor, binds worker lanes to GPT-5.5 medium/high, `designer→Opus`, keeps Kimi only for feedstock retrieval, disables autolearn. Without it, `pi/slow` lanes degrade through the fable-guard.)

## Read (in order, nothing else by default)

1. [`charter.md`](charter.md) — identity, priorities, routing, contracts, exclusions.
2. [`atlas.md`](atlas.md) — where everything lives: code, artifacts, sessions, config.
3. `TASKS.md` — active and next rows.
4. Whatever Arthur points at.

## Per-stream sessions (sharding)

Fable shards into parallel sessions, **one per stream**, each owning one lane:

| Stream | First read after charter |
|---|---|
| Companion | [`streams/companion/GOAL.md`](../../streams/companion/GOAL.md) |
| Playground | [`streams/playground/GOAL.md`](../../streams/playground/GOAL.md) |
| Primer | [`streams/primer/GOAL.md`](../../streams/primer/GOAL.md) |
| Harness (background) | [`streams/harness/GOAL.md`](../../streams/harness/GOAL.md) |

Rules for a sharded session:

- **Own your lane.** Stay inside your GOAL.md's owner paths. Cross-stream reusables graduate into `packages/` — never reach into a sibling's paths.
- **Shared context is charter + framing.** Changes to them (or anything under `docs/fable/`, `docs/state/`) are harness-lane work: commit promptly so sibling sessions pick them up; keep such edits rare and deliberate.
- **Coordinate via artifacts, not memory.** TASKS.md rows, committed docs, and `streams/<x>/INDEX.md` are the interfaces between sessions.
- Each stream dir colocates its material: `GOAL.md` (goals/NFRs), `INDEX.md` (tracked index of everything), `repos/` (symlinks to external repos), `inspiration/`, `feedstock/` (gitignored; originals logged in INDEX.md).

## Retrieve on demand

- Harness iteration: [`harness-brief.md`](harness-brief.md), then [`harness-slimming.md`](harness-slimming.md).
- Previous sessions: [`session-index.md`](session-index.md) → `data/fable-prep/` (records now carry a `model` field — Fable vs GPT-5.5 vs Kimi attribution).
- External resources: [`external-inventory.md`](external-inventory.md).
- Dictation ambiguity: [`transcription-notes.md`](transcription-notes.md).
- Creative north star: `docs/state/creative-framing.md`, `docs/state/video-creative-direction.md`.

Superseded docs (`context.md`, `preferences.md`, `workstream-map.md`, `model-routing.md`) were collapsed into charter + atlas + harness-brief on 2026-07-03; recover from git history if needed.
