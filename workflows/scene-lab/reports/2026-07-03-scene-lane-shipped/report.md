title: Scene lane shipped: renderer, playground, tools
date: 2026-07-03
agent: Fable
status: shipped

The code-driven video lane is live end-to-end. One declarative `scene.v1` JSON spec drives two hosts: this playground (live Three.js preview, spec editor, asset browser, this reports feed) and a deterministic offline renderer (headless frame-stepped capture, ffmpeg mux, audio).

What exists now:

- `packages/scene-renderer` — Effect-Schema spec validation with prescriptive errors (`check` CLI), asset staging (images, audio, mp4-to-frame-sequences), puppeteer capture, `render` CLI with `--still` and `--frame-range` for fast iteration. Runtime bundle: clone systems (grid/orbit/spiral/line/scatter, seeded), beat-synced timeline (bpm grid or explicit beats; keyframes/osc/beat-envelope tracks), camera rig, canvas typography, and four hand-rolled shader passes: bloom, chromatic aberration, VHS, glitch — all beat-reactive.
- `apps/scene-playground` — this app. Serves on 4600. Watches specs/renders/reports over SSE; edits hot-reload the preview.
- Utility CLIs in `scripts/`: video contact sheets, audio beat grids (bpm or crude onset detection), creative asset inventory JSON for spec authoring.
- `docs/plans/scene-lab.md` — the agent cookbook: five valid example specs (clone grid, orbit halo, Y2K chrome text, 2000s-ad style transplant, video wall) with exact commands. Cheaper models author from it without reading source.

Proof: the First Light report below this one — three specs authored by a subagent from the cookbook alone, rendered to MP4 with narration, frames verified non-black with correct content (clone grid + VHS, persona orbit + bloom, chrome text + RGB split).

Iteration loop: `bun run --cwd packages/scene-renderer check -- --scene <spec>` then `render -- --still <sec>` then full render. Renders land in the renders strip in the studio; reports land here.

Known gaps (honest): pass tuning is crude (VHS is heavy); videoFrames assets are offline-only in the live preview; caption/typography parity with the recreate lane is basic; in fully occluded panes (RAF suspended) initial autoplay can need one play-button toggle, and the frame counter only updates on scrub. Remotion stays on the recreate lane; this lane is MIT-clean Three.js end-to-end.
