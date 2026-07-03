# Playground — stream charter

The pleasure-dome / creative-engine stream. Owned by one Fable session at a time; read with [`docs/fable/charter.md`](../../docs/fable/charter.md) and [`docs/state/creative-framing.md`](../../docs/state/creative-framing.md).

## Goal

A **creative engine**, closer to a game engine than a video pipeline: programmatic, cacheable, remixable assets (characters, props, audio, effects, shaders) reused across UGC video, companion bodies/stages, and later algorithm/RL visualization. The Library of Babble with a librarian who serves the reader: babble wide, prune by a taste function seeded with Arthur's golden picks.

## Non-functional requirements

- **Playable, not operated**: instrument feel; flip through candidates fast; fine controls only late.
- **Cache validated layers**: replay/snapshots/fixtures; live provider calls only for new contracts or drift.
- **Human-as-golden-seed**: Arthur annotates few; the selection function scales the judgment.
- Stack: React + Tailwind + shadcn (Solid retired 2026-06-09); Jimeng/Dreamina spend only inside named caps.
- Keep the weird energy: brainrot, cute-menace, abstract-Chinese-internet are load-bearing lanes.

## Open questions

- Remix unit: whole videos, layered comps, or asset-level? (determines catalog schema)
- Realtime canvas or seconds-per-candidate offline render for v1?
- Private instrument first, or shareable outputs from v1?

## First goal

**Make reconstruction actually work.** The video-recreation pipeline has never produced a working end-to-end result. One reference TikTok from `data/video-recreation/` decomposed and rebuilt — plates, props, captions, TTS — into a rendered candidate, side-by-side with the original. Fix or bypass whatever is broken in `workflows/tiktok-recreate/`; goal over implementation. Proof: side-by-side video + rerun command.

## Owns

`apps/slotok-workbench/`, `packages/hyperframes-renderer/`, `packages/remotion-renderer/`, `packages/jimeng-client/`, `packages/ugc-cli/`, `workflows/tiktok-recreate/`, `data/{ugc-studio,assets,tiktok-catalogue,jimeng-lab,video-recreation,workflow-runs,dreamina}/`, this directory.

## Excludes

Other `streams/*`, harness internals. The companion's stages/bodies are *consumers* of this engine — coordinate via `packages/`, not by editing companion paths.

## Map

Live taste docs: `docs/state/video-creative-direction.md`, `docs/state/ugc-studio-style-direction.md`. Historical (banner-marked): `docs/plans/slotok-workbench.md`, `docs/plans/ugc-studio-workstreams.md`. External: `~/ComfyUI` (symlinked in `repos/`). Material inventory: [`INDEX.md`](INDEX.md) and the artifacts table in [`docs/fable/atlas.md`](../../docs/fable/atlas.md).
