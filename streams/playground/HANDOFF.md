# Playground session — boot

Launch from `~/agents`:

```bash
omp --config ./.omp/fable-config.yml --model <fable-model-id>
```

Paste as first message:

```
You are the Fable orchestrator for the PLAYGROUND stream in ~/agents.
Boot: read streams/playground/HANDOFF.md and follow it (charter, GOAL.md,
then act). Coordinate with siblings via committed docs. Do not touch other
streams' owner paths.
```

Read, in order: `docs/fable/charter.md`, `streams/playground/GOAL.md`, this doc's **State** and **Continuation** sections, then only the `docs/fable/atlas.md` sections you need. `docs/state/video-creative-direction.md` and `docs/plans/scene-lab.md` when you touch those lanes.

## State (as of 2026-07-03, session 2)

Two waves shipped and committed (`07b6af4d`, `6429bb20`, `0cffd6b8`, `c6bc3eed`, `a726fc9a`):

1. **Recreation lane works end-to-end** (first goal, DONE): birthrate TikTok decomposed → plates/persona/TTS/VTT captions → Remotion render → side-by-side proof. Four renderer bugs root-caused; QA doc `docs/qa/tiktok-recreate-bootstrap-20260620.md` § 2026-07-03 has rerun commands.
2. **Scene lane** (the strategic direction, MIT-clean Three.js): `scene.v1` JSON specs → live playground preview AND deterministic offline MP4 via one runtime. `packages/scene-renderer` (schema/check/render CLIs, `--still`/`--frame-range`, clone fields, beat-synced tracks, bloom/chromAb/VHS/glitch passes), manual + cookbook at `docs/plans/scene-lab.md`.
3. **The playground app** = Arthur's standing review surface: `apps/scene-playground`, live at `http://scene.localhost:1355` (portless). Views: REPORTS feed (default; agents drop proof dirs in `workflows/scene-lab/reports/<date>-<slug>/report.md` + media, SSE-live), STUDIO (scene tree / inspector / timeline / source editor), LABEL (yazi-style vim labeler over the pleometric corpus, ffmpeg thumbnails, SQLite labels).
4. **Provenance + ops**: every spec/label edit lands in `data/scene-lab/ledger.sqlite` marked human|agent (entropy tracking; future: cursor-style edit prediction). Unified `data/scene-lab/errors.log` (backend + browser). Supervised dev server: `cd apps/scene-playground && bun run dev:up` (restart loop + `bun --watch` + `/healthz`).
5. **Pleometric corpus**: 35/150 media items + manifest at `data/inspiration/pleometric/` (429-walled, resume later), shader-account leads in `leads.json`. Arthur labels via LABEL view; labels DB `data/scene-lab/labels.sqlite`.

## Standing directives (Arthur, this session — most promoted to AGENTS.md/charter, honor them)

- **Conserve Fable**: orchestrate only; delegate implementation AND checking. GPT-5.5 = pedantic code review + logic; **Opus/designer = anything design/web-facing** (GPT UI = "functional-but-fucked"); Kimi/GPT = computer-use QA. Opus creates, GPT reviews.
- **Portless everywhere** (`bunx portless <name> <cmd>`), self-contained package.json (never root), one HTML + one Bun server per app.
- **Vim-native UIs**, visible shortcut hints, Bret Victor alive-software (immediate feedback, no staring at code), SQLite everywhere.
- **Check `data/<app>/errors.log` before claiming done.** Keep the dev server running always.
- **WebKit/cmux panes are broken** — do NOT fix apps for WebKit; interim is Chrome app-mode windows; cmux→Chromium queued in `docs/state/harness-friction.md` (high). Evidence: `workflows/scene-lab/reports/2026-07-03-webkit-pane-issue/`.
- Subagent facts: ~400s wall cap (slice packets; report-file-first so timeouts lose nothing); kimi/QA lanes are write-sandboxed (they stage `/tmp` driver scripts, YOU audit then fire); workers can't run gates (parent gates); wake parked agents via IRC instead of respawning (context reuse) — but an OMP restart wipes the roster, so treat parked context as disposable.

## Continuation (the exploration, in order)

1. **Arthur labels the corpus** (LABEL view; groups = style buckets + "interesting"). Nudge him; his labels are the golden seed.
2. **Style extraction** from labeled-interesting items → named style recipes (spec fragments) appended to the `docs/plans/scene-lab.md` vocabulary. Post-process with video-understanding lanes; the labeler's groups + tweet text are the input.
3. **Recreate pleometric pieces** as scene specs — the proof the creative framework works. Gaps to expect: more pass types (feedback/displacement/halftone), asset pipelines (3D via Gemini/Antigravity lane = `jimeng-gemini-worker`), audio-reactive beyond beat grid (use `scripts/audio-beat-grid.boundary.ts --detect`).
4. **Corpus expansion**: resume `PleometricCorpus`-style bounded backfill past the 429 wall (later window, same caps); mine `leads.json` accounts the same way.
5. **Two-layer framework** (person / hook): pose-transfer persona pipeline for TikToker recreation — swap person, swap hook. Ties to jimeng pose-transfer snapshot (TASKS T-2026-06-09-101) and the persona work in recreation lane. End goal: agent-crafted TikTok personas/accounts promoting our UGC.
6. **Studio v3** when friction demands: undo stack, in-canvas gizmos, provenance badges UI (ledger data has no UI surface yet — known gap), videoFrames in live preview.
7. **Open GOAL.md questions** still unsettled with Arthur: remix unit (comps vs assets), realtime vs offline emphasis, private vs shareable v1.

## Review etiquette

Every finished slice → proof report dir in `workflows/scene-lab/reports/` (front matter: title/date/agent/status) → shows up in Arthur's feed. He reviews products, not commits. Screenshots > prose; playable > screenshots.

## Etiquette (parallel siblings are live)

Stay in Owns (see GOAL.md; now includes `apps/scene-playground`, `packages/scene-renderer`, `workflows/scene-lab`); companion consumes the engine via `packages/`; pull before editing shared docs (TASKS.md, AGENTS.md, friction log); log harness papercuts to `docs/state/harness-friction.md` — never fix the harness here.
