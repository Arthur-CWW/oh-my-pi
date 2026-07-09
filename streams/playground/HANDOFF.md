# Playground session — boot

Launch from `~/agents` (playground overlay config — designer=Opus, workers=GPT-5.5):

```bash
omp --config ./.omp/playground-config.yml
```

Paste as first message (`@path` expands the file into the prompt — omp convention; type `@` in the composer for the file picker):

```
You are the Fable orchestrator for the PLAYGROUND stream in ~/agents.
Boot from @streams/playground/HANDOFF.md — follow its read order, honor the
standing directives, and continue at the Continuation section's next
unfinished step. Do not touch other streams' owner paths.
```

Read, in order: `docs/fable/charter.md`, `streams/playground/GOAL.md`, this doc's **State** and **Continuation** sections, then only the `docs/fable/atlas.md` sections you need. `docs/state/video-creative-direction.md` and `docs/plans/scene-lab.md` when you touch those lanes.

## State (as of 2026-07-08, session 3)

Session 3 shipped seven waves across three substreams:

### Scene-renderer extensions
- **Three new post passes** (feedback/displacement/halftone): Opus-built, GPT-reviewed, Fable-caught tonality inversion. Demo specs + stills + cookbook §F/G/H.
- **First original pieces**: three Opus-authored scene.v1 pieces on real pleo audio (clone-field-pulse, feedback-tunnel, type-glitch + playable artifact.html toy). All live in STUDIO.
- **First concept video**: "The Number With No Name" — 46s portrait power-post, narration timing table ready for MiniMax mux.
- Findings: sprite `rotation.z` silently ignored (gap); halftone needs mix/opacity uniform; 1380-frame renders need `--frame-range` chunking.

### Corpus + cataloging
- **Pleometric**: 35→133 items (429-wall pushed back twice). Sync script: resumable, `--handle`, incremental writes, no-shrink guard, **case-insensitive username fix** (was silently dropping mixed-case handles).
- **New handles**: abelian_soup (57), SkyeSharkie (60), poetengineer__ (60), voooooogel (3).
- **Theoryposters text**: @repligate (65), @lumpenspace (95), @teortaxesTex (122), @tenobrus (60), @tszzl (60), @xenocosmography (127), @doomslide (79) — all in twitter-archive sqlite.
- **Reference catalog**: 30 videos via Antigravity subscription (gemini-3.5-flash, $0), `docs/research/pleometric-reference-catalog.md`.
- **Transcripts**: 39 videos whispered (faster-whisper large-v3-turbo on 3090), 16 with substantial dialogue at `data/inspiration/pleometric/transcripts.json`.

### Power-posting lane (NEW — theoryposting video format)
- **Ontology + vibe brief**: `docs/research/power-posting-sources/` — Meltdown (full verbatim), teortaxes/apralky/repligate/xenocosmography longposts, pleometric practitioner threads, Borges/Nietzsche/anime influence stack, `ontology.md` (invariants + wings table), `vibe-brief.md` (294 lines: format dissection, six registers, do/never, four TTS-ready scripts, six taste questions for Arthur).
- **Character mashups**: 6/6 glossy 3D figurines via jimeng-5.0 (aschenbrenner×orange, gigachad sonic, suit claude, shiny peach, cat-mouse duo, pernicious penguin). Prompting playbook at `docs/research/jimeng-prompting-playbook.md`.
- **latwalk first-light**: both renders shipped on desktop 3090 (DINO localnn + middlepath beat-sync pulse). Pleo latent remix: 1077 corpus frames walked to pleometric's own audio (glitch + pulse-negative variants).

### Playground app
- **GALLERY view** (NEW): all artifacts navigable — 10 videos + 1 toy, vim-native j/k/h/l, autoplay, Enter overlay with sound, filter cycle, ? help. Front-matter `---` fence parsing bug fixed.
- **LABEL**: P0 silent-label-loss fixed (fire-and-forget → allSettled + revert + red status + errors.log beacon); `interesting` group (key 4) auto-seeded; `g`/`:group` creation; `p` autoplay. **Arthur must re-label** (old marks unrecoverable). Corpus now 193 items (pleometric 133 + others).
- **Reference notes** (`n` key): inline annotations in GALLERY + LABEL, server-confirmed save, dictation-first (VoiceInk → cmd+Enter).
- **Desktop**: SSH hardened (MagicDNS + multiplexing + fallbacks), sudo paste block for Arthur in feed report; uv installed.

### Routing
**GPT-5.5 lanes DOWN** (OpenAI Pro degraded to free tier). `oracle` + `llm-frontend-browser` archived in `skills-attic/disabled-20260708/`. Charter routing override: Opus creates+reviews, Kimi mechanical, Antigravity via `omp token`/`omp -p` — never KIE/API keys.

## Standing directives (session 3 — all promoted to charter/AGENTS.md)

- **Conserve Fable**: orchestrate only; delegate implementation AND checking. **Opus creates AND reviews** (two Opus instances with different roles). Kimi = mechanical/pipeline/retrieval. Gemini Flash (Antigravity subscription) = bounded vision one-shots.
- **Subscription over API, always** — use `omp token`/`omp -p` for Antigravity; never KIE credits or API keys when a subscription exists (Arthur, 2026-07-08, hard rule).
- **uv for venvs** on the desktop — never pip directly; uv resolves conflicts faster.
- **tmux for SSH desktop work** — not bare nohup.
- **Portless everywhere**, self-contained package.json, one HTML + one Bun server per app.
- **Vim-native UIs**, visible shortcut hints, Bret Victor alive-software, SQLite everywhere.
- **Check `data/<app>/errors.log` before claiming done.** Keep the dev server running always.
- **WebKit/cmux panes broken** — Chrome app-mode windows; cmux→Chromium queued.
- Subagent facts: ~400s wall cap (report-file-first); kimi sandboxed (stage scripts, coordinator fires); workers skip gates (coordinator gates); OMP restart wipes roster.

## Continuation (in order)

1. **Arthur labels the corpus** — 193 items in LABEL, `interesting` key 4 seeded, autoplay + notes ready. Labels are the golden seed for everything below. Nudge him.
2. **MiniMax narration** — blocked on API key (`omp token minimax` empty; Arthur needs to paste `MINIMAX_API_KEY` into `.env` or `omp auth`). Four scripts ready; concept video timed for mux.
3. **Taste questions** — six in `2026-07-08-power-posting-brief` feed report. Load-bearing: profanity policy, found-audio lane mode, voice identity (consistent egregore vs per-piece).
4. **Style extraction** from labeled-interesting items → named style recipes → `docs/plans/scene-lab.md` vocabulary. Video-understanding (Antigravity via `omp -p @frames`) + transcripts + tweet text as input.
5. **Full reference catalog** — extend the 30-video pass to the full 193-item corpus (same Antigravity pipeline).
6. **Concept video v2**: mux narration audio into "The Number With No Name" spec once MiniMax lands; iterate timing.
7. **Character scale-up**: Jimeng Helium re-login → more figurines from catalog backlog; explore trellis2 for 3D mesh route (per Abel's Jun 3 thread).
8. **FILM interpolation**: isolated `~/latwalk-lab/venv-film` via uv (TF ↔ torch CUDA conflict documented; recipe in `2026-07-08-film-stretch` report).
9. **Persona/lip-sync**: pose-transfer pipeline (TASKS T-2026-06-09-101) + MiniMax TTS character voice → lip-synced narrator.
10. **Studio v3** when friction demands: undo stack, in-canvas gizmos, provenance badges UI, halftone mix uniform.

## Review etiquette

Every finished slice → proof report dir in `workflows/scene-lab/reports/` (front matter: title/date/agent/status) → shows up in Arthur's feed. He reviews products, not commits. Screenshots > prose; playable > screenshots.

## Etiquette (parallel siblings are live)

Stay in Owns (see GOAL.md; now includes `apps/scene-playground`, `packages/scene-renderer`, `workflows/scene-lab`); companion consumes the engine via `packages/`; pull before editing shared docs (TASKS.md, AGENTS.md, friction log); log harness papercuts to `docs/state/harness-friction.md` — never fix the harness here.
