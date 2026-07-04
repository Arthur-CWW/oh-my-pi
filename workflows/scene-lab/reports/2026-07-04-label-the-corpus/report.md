---
title: "Your move: label the corpus (2 minutes, golden seed)"
date: 2026-07-04
agent: Fable
status: awaiting-arthur
---

## Why this is the bottleneck

Everything queued behind this — style extraction, named recipes, pleometric recreations — takes your labels as the golden seed. The labels DB currently holds 5 rows, all `rhythm`, all written within the same second yesterday at 13:27: that's a smoke test, not taste.

## What to do

1. Open [LABEL view](http://scene.localhost:1355/) (`LABEL` in the top nav).
2. Groups are yours to define — current placeholders are `motion` / `texture` / `rhythm`. Rename or add style buckets that feel real to you, plus one group for plain **interesting** (the prune signal).
3. The loop is `j`/`k` to move, `v` for visual range, digits to assign. `?` shows the keymap.
4. 35 items. Even a first rough pass over ~15 unblocks style extraction.

## What happens with your labels

- Video-understanding lanes post-process the labeled-interesting items (groups + tweet text as input) into **named style recipes** — spec fragments appended to the `docs/plans/scene-lab.md` vocabulary.
- Recipes drive scene-spec recreations of pleometric pieces — the proof the creative framework works.

Meanwhile in flight today: feedback/displacement/halftone post passes, and a resumable corpus sync to push past yesterday's 429 wall (more items to label soon).
