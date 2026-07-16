# Playground session — boot

Launch from `~/agents` (playground overlay config):

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

Read, in order: `docs/fable/charter.md`, `streams/playground/GOAL.md` (esp. § engine-recreation frame), `docs/research/power-posting-sources/ontology.md` § two-layer model, this doc's **State** and **Continuation** sections, then only the `docs/fable/atlas.md` sections you need. `docs/state/video-creative-direction.md` and `docs/plans/scene-lab.md` when you touch those lanes.

**Literary/source index**: before any source mining, read `docs/research/power-posting-sources/SOURCE-INDEX.md` — it maps the durable feedstock shelves: **Calibre** (`~/Calibre Library/`), **Primer processed books** (`streams/primer/wrapped-commentary-reader/` — read-only, another stream's owner path), and **Borges Library downloads** (`~/.borges-library/downloads/`, incl. the Deleuze/Guattari shelf). Never duplicate whole copyrighted books into Playground docs — archive only public sources or short attributed excerpts/analysis.

## State (as of 2026-07-15, session 5)

### The frame (Arthur steer, load-bearing — read before planning)
- **Two-layer model** (`ontology.md` § two-layer model): the engine's product is the **presentation/stylization layer**; semantic registers (theoryposting, AGI econ, brainrot) are composable plug-ins. Coupling is the art; decoupled pure-brainrot is an explicit goal.
- **Engine-recreation** (`GOAL.md` § engine-recreation frame): recreate pleometric's engine locally as mutable, recombinable layers. Companion's pose-transfer/VR/Live2D are future components (via `packages/`, never companion paths).
- **Voice**: NOT one narrator egregore — a few custom/recurring characters (Peter Griffin, Aschenbrenner, Jensen Huang, Trump, flower Claude) + brainrot characters + one-off joke voices → **voice cloning is the confirmed TTS direction**. Profanity: per-piece call. Length: default 25–50s, nothing set in stone.
- **Personal Pleometric**: his tacit knowledge is indexed VERBATIM, never summarized — "his tweets are not that compressible." Ongoing duty as corpus grows.

### Session 5 shipped
- **Personal-Pleometric archive**: `pleometric-meta-index.md` (49 rows: date/URL/category/verbatim opening line) + 42 full-thread verbatim captures (120 statuses) in `pleometric-longposts.md`. 43 manifest IDs absent from archive — rerun after bookmark enrichment.
- **Referential-mirrors bundle** (`workflows/scene-lab/reports/2026-07-15-corpus-sync/referential-mirrors/`): the "infinite referential mirrors" essay video + 3 thread images + sources.md. 20 conversation tweets archived.
- **Corpus expansion**: Arthur's bookmarks synced (135 records, `x-bookmark-sync-devtools` lane, 135 status jobs pending enrichment); new handles medjedowo (26) + norvid_studies (29), text-first (`--media-max-items 0`).
- **Reference catalog**: 30 → ~280 entries (full corpus incl. SkyeSharkie/poetengineer__/abelian_soup/voooooogel) via Antigravity Gemini, $0. Resumable driver: `workflows/scene-lab/reference_catalog_full.py` (+ `progress.json`).
- **Style recipes v1**: `docs/research/style-recipes.md` — 10 named presentation-layer recipes with ≥2 exemplars each and exact scene.v1 implementability/gap maps; vocabulary index appended to `docs/plans/scene-lab.md`. Built from 56-entry snapshot — refresh against full catalog is cheap and worthwhile.
- **Local TTS ADOPTED (baseline)**: Kokoro-82M on the 3090 (`~/tts-lab/`, uv venv) — 5 WAVs (am_michael ×4 scripts, am_fenrir ×1), 132–148× realtime, 1.8GB VRAM, $0. Samples + comparison vs Jimeng: `workflows/scene-lab/reports/2026-07-15-local-tts/`.
- **Sonic first-light: NEGATIVE for figurines**: pipeline works end-to-end (`~/sonic-lab/Sonic`, 16.6GB VRAM, 5m46s for 10s @512²) but on the glossy figurine identity drifts and the mouth barely articulates. Verdict + stills: `workflows/scene-lab/reports/2026-07-15-sonic-first-light/`. Untested hypothesis: photoreal/humanlike portraits may work — one cheap test before abandoning.
- **Recovery**: scene dev server restored (`cd apps/scene-playground && nohup ./scripts/dev-up.sh > /tmp/scene-dev-up.log 2>&1 &`); playground overlay Terra pins → luna:xhigh.

### Still Arthur-gated
- **Labeling**: labels.sqlite still has only 5 old `rhythm` labels; ~193-item LABEL corpus waits at scene.localhost:1355.
- **Found-audio + register-collapse taste questions**: Arthur had lost context — re-ask only with a concrete playable example, never abstractly.

## Standing directives (carried + session-5 additions)

- **Conserve Fable**: orchestrate only; delegate implementation AND checking.
- **Routing (2026-07-15)**: NEVER Terra. Bounded → `openai-codex/gpt-5.6-luna:xhigh`; GPU/pipeline debugging, synthesis, load-bearing → `openai-codex/gpt-5.6-sol:medium+`. Antigravity Gemini (`omp -p --model google-antigravity/gemini-3.5-flash @frames…`) reserved for vision/video understanding; subscription over API, always.
- **uv for venvs**, **tmux for SSH desktop work**, check `nvidia-smi` before GPU runs (desktop tmux sessions belonging to companion: companion-extract/provision, gvhmr-setup, gpu-queue — never touch).
- **Portless everywhere**, vim-native UIs, SQLite everywhere, check `data/scene-lab/errors.log` before claiming done, keep the dev server running.
- Subagent facts (session-5 evidence): workers hit soft request budgets mid-GPU-work — demand report-file-first + incremental writes; **revived (parked→woken) agents can land in a restricted sandbox (EPERM on repo writes)** — rerun their resumable scripts coordinator-side; **task results are sometimes never delivered while agents park** — poll `job list`, then read `agent://<id>` + report dirs on disk as ground truth; verify worker-refactored long-run scripts actually run one item before detaching (session 5: dropped parse line = silent 100% failure loop).

## Continuation (in order)

1. **Check the catalog driver finished** (`progress.json` ~280/280, `stopped_on_rate_limit` false; resume: `python3 workflows/scene-lab/reference_catalog_full.py`). Commit final catalog + report.
2. **Voice cloning on the 3090** — Fish Speech or Qwen3-TTS in `~/tts-lab` (uv+tmux): clone 2–3 recurring-character voices, render one vibe-brief script per voice, compare against Kokoro baseline. This unlocks Arthur's recurring-character direction.
3. **First recipe-driven piece**: pick 1–2 recipes from `style-recipes.md` expressible in scene.v1 today, author a short (25–50s) piece with Kokoro narration muxed, render chunked, ship to the feed. This closes the full local loop: corpus → recipe → scene → local TTS → video, $0.
4. **Lip-sync decision**: one cheap Sonic test with a photoreal/humanlike portrait (not a figurine). If still bad, survey alternatives briefly and park the lane with evidence.
5. **Refresh style recipes against the full catalog** (~280 entries vs the 56-entry snapshot) — cheap delegated pass.
6. **Bookmark enrichment + meta-index rerun**: drain the 135 pending status jobs, extend media sync for medjedowo/norvid_studies, rerun the meta-index scan (43 absent IDs + new bookmark content).
7. **Renderer gaps**: top-ranked gaps in `2026-07-15-style-recipes/report.md` (incl. known: sprite rotation.z ignored, halftone mix/opacity) — schedule fixes when a recipe-driven piece needs them.
8. **Arthur labels the corpus** (his gate; ping once with the dev-server URL when he's around).

## Review etiquette

Every finished slice → proof report dir in `workflows/scene-lab/reports/` (front matter: title/date/agent/status) → shows up in Arthur's feed. He reviews products, not commits. Screenshots > prose; playable > screenshots.

## Etiquette (parallel siblings are live)

Stay in Owns (see GOAL.md); companion consumes the engine via `packages/`; **`packages/twitter-archive` is shared** — session 5 saw a sibling actively editing it (Lina_Hoshino handle); use its existing tools, coordinate before source changes. Pull before editing shared docs (TASKS.md, AGENTS.md, friction log); log harness papercuts to `docs/state/harness-friction.md` — never fix the harness here.
