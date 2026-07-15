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

**Literary/source index**: before any source mining, read `docs/research/power-posting-sources/SOURCE-INDEX.md` — it maps the durable feedstock shelves: **Calibre** (`~/Calibre Library/`), **Primer processed books** (`streams/primer/wrapped-commentary-reader/` — read-only, another stream's owner path), and **Borges Library downloads** (`~/.borges-library/downloads/`, incl. the Deleuze/Guattari shelf `deleuze-guattari/` — Anti-Oedipus + A Thousand Plateaus). Consult the index before mining sources. Never duplicate whole copyrighted books into Playground docs — archive only public sources or short attributed excerpts/analysis.

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

### In-flight from session 3 (check on boot — may have finished)
- **NarrationMux** (Opus designer): muxing `the-number-with-no-name.mp3` into the concept video spec → `workflows/scene-lab/reports/2026-07-08-number-no-name-v1/number-no-name-with-narration.mp4`. Check if the file exists; if yes, commit it.
- **DesktopUpdate** (Kimi task): mise/uv/tools update on desktop. Check `workflows/scene-lab/reports/2026-07-08-desktop-update/report.md` — if present, commit and run the sudo paste block if Arthur approves. Note: `~/desktop-update-sudo.sh` on the desktop has the apt upgrade commands.

### New session priorities (Arthur, end of session 3)
1. **Desktop server setup** — run `~/dotfiles` bootstrap (`cd ~/dotfiles && uv run scripts/dotfiles.py bootstrap`), set up local TTS model on the 3090 (Kokoro for preset English voices OR Fish Speech/Qwen3-TTS for voice cloning — all <4GB VRAM; 24GB free confirmed). Use uv + tmux.
2. **Local TTS pipeline** replaces all paid TTS: generate narration on the 3090, zero cost, no API keys, unlimited volume. Compare quality against Jimeng TTS samples already at `workflows/scene-lab/assets/narration/`.
3. **MiniMax narration** — SUPERSEDED by Jimeng TTS (proven working, $0, 4 scripts generated this session) + upcoming local TTS. MiniMax key still missing but no longer blocking.
4. **Narration mux** — if NarrationMux didn't finish: wire audio asset into `number-no-name.scene.json`, render chunked (browser crashes ~frame 679), verify ffprobe shows audio stream.
5. **Taste questions** — six in `2026-07-08-power-posting-brief` feed report. Load-bearing: profanity policy, found-audio lane mode, voice identity.
6. **Arthur labels the corpus** — 193 items in LABEL, `interesting` key 4 seeded, autoplay + notes ready.
7. **Style extraction** from labeled items → named style recipes → `docs/plans/scene-lab.md` vocabulary. Video-understanding (Antigravity via `omp -p @frames`) + transcripts + tweet text.
8. **Full reference catalog** — extend the 30-video Antigravity pass to all 193 items.
9. **Character scale-up**: more figurines from catalog backlog; explore trellis2/Sonic (open-source talking portrait on 3090) for 3D mesh + lip-sync route.
10. **Persona/lip-sync via local models**: Sonic (`github.com/jixiaozhong/Sonic`) on 3090 with character figurine + local TTS audio → talking-head video. Bypasses Jimeng lip-sync blocker entirely.
11. **FILM interpolation**: isolated `~/latwalk-lab/venv-film` via uv.
12. **Studio v3** when friction demands.

### Session 3 routing lessons
- **Jimeng TTS works and is free** — `/mweb/v1/tts_generate`, 142 voices, session bundle auth. Use before any paid TTS.
- **Antigravity = Gemini vision via `omp -p --model google-antigravity/gemini-3.5-flash @frame.jpg "prompt"`**. NOT for Cloud TTS. Never use KIE credits when subscription exists.
- **Kimi workers flail on adaptive debugging** (KIE 422 loops, sandbox write blocks). Route GPU/pipeline/debugging work to Opus.
- **Advisor claims about file contents are often fabricated** — always verify with actual reads before acting on them.

## Review etiquette

Every finished slice → proof report dir in `workflows/scene-lab/reports/` (front matter: title/date/agent/status) → shows up in Arthur's feed. He reviews products, not commits. Screenshots > prose; playable > screenshots.

## Etiquette (parallel siblings are live)

Stay in Owns (see GOAL.md; now includes `apps/scene-playground`, `packages/scene-renderer`, `workflows/scene-lab`); companion consumes the engine via `packages/`; pull before editing shared docs (TASKS.md, AGENTS.md, friction log); log harness papercuts to `docs/state/harness-friction.md` — never fix the harness here.
