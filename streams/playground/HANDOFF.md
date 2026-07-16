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
- **Labeling**: labels.sqlite still has only 5 old `rhythm` labels; ~193-item LABEL corpus waits at https://scene.localhost (portless moved to 443/HTTP2 on 2026-07-16; old :1355 URLs are dead; service registered in root `services.yml` — `mise run up playground`).
- **Found-audio + register-collapse taste questions**: Arthur had lost context — re-ask only with a concrete playable example, never abstractly.

## Standing directives (carried + session-5 additions)

- **Conserve Fable**: orchestrate only; delegate implementation AND checking.
- **Routing (2026-07-15)**: NEVER Terra. Bounded → `openai-codex/gpt-5.6-luna:xhigh`; GPU/pipeline debugging, synthesis, load-bearing → `openai-codex/gpt-5.6-sol:medium+`. Antigravity Gemini (`omp -p --model google-antigravity/gemini-3.5-flash @frames…`) reserved for vision/video understanding; subscription over API, always.
- **uv for venvs**, **tmux for SSH desktop work**, check `nvidia-smi` before GPU runs (desktop tmux sessions belonging to companion: companion-extract/provision, gvhmr-setup, gpu-queue — never touch).
- **Portless everywhere**, vim-native UIs, SQLite everywhere, check `data/scene-lab/errors.log` before claiming done, keep the dev server running.
- Subagent facts (session-5 evidence): workers hit soft request budgets mid-GPU-work — demand report-file-first + incremental writes; **revived (parked→woken) agents can land in a restricted sandbox (EPERM on repo writes)** — rerun their resumable scripts coordinator-side; **task results are sometimes never delivered while agents park** — poll `job list`, then read `agent://<id>` + report dirs on disk as ground truth; verify worker-refactored long-run scripts actually run one item before detaching (session 5: dropped parse line = silent 100% failure loop).

## Continuation (in order)

0. **Read `docs/research/power-posting-sources/pleorama-synthesis.md` first** — the 2026-07-16 dialogue synthesis (two-optimization-surfaces model, liquidity order book, operator/無心 problem) reframes priorities 2–7 below; its § sync-requirements is a handoff packet owned by the corpus/stema orchestrator (relay it if not yet delivered — no stema peer was on the IRC bus when written). Catalog driver FINISHED (307/307, 0 failures, committed).
1. ~~Check the catalog driver finished~~ — done, committed `a1b1ecb95`.
2. ~~Voice cloning~~ — DONE overnight 2026-07-16 (`2026-07-16-voice-clone/`): Qwen3-TTS 1.7B zero-shot in `~/tts-lab/fish/.venv`. Verdict: **Kokoro stays default**; Qwen only for characters Kokoro can't cover, with mandatory generation-token cap + duration QA (one runaway documented). Kokoro venv repaired (torch cu128) + regression pass. Next: character-reference sourcing pass (licensing rules in report).
3. ~~First recipe-driven piece~~ — DONE: **"What Lab?"** (`2026-07-16-first-recipe-piece/what-lab.mp4`, spec in `specs/`). Full local loop closed: corpus → recipe → scene.v1 → Kokoro → video, $0. Next pieces: use the new halftone mix + audio-cue snap; re-render candidate noted in its report.
4. ~~Lip-sync decision~~ — RESOLVED: **lane PARKED** (`2026-07-16-sonic-photoreal/`): Sonic fails photoreal too (identity warp doubles by 8s, plosives never close, 13 jump cuts). Evidence bar for any future alternative is in the report.
5. ~~Recipe refresh~~ — DONE: 12 recipes vs full 307-entry catalog, kinesis primitive threaded in.
6. **Bookmark enrichment + meta-index rerun** — now owned by the corpus/stema orchestrator (pleorama-synthesis packet); playground reruns `pleometric-meta-index.md` + `pleo-reader/` refresh AFTER their sync lands.
7. ~~Renderer gaps (first slice)~~ — DONE: halftone `mix`, sprite `rotation.z`, audio-cue pipeline (`analyze-audio.ts`, `scene.cues.v1`, snap mode). Remaining from gap #1: dense-cluster, accelerate-to-hit, downbeat classification; gaps #2–#4 (typography/compositing/sequencing) untouched — schedule when a piece needs them.
8. **Arthur labels the corpus** (his gate; ping once with the dev-server URL when he's around).

## Review etiquette

Every finished slice → proof report dir in `workflows/scene-lab/reports/` (front matter: title/date/agent/status) → shows up in Arthur's feed. He reviews products, not commits. Screenshots > prose; playable > screenshots.

## Etiquette (parallel siblings are live)

Stay in Owns (see GOAL.md); companion consumes the engine via `packages/`; **`packages/twitter-archive` is shared** — session 5 saw a sibling actively editing it (Lina_Hoshino handle); use its existing tools, coordinate before source changes. Pull before editing shared docs (TASKS.md, AGENTS.md, friction log); log harness papercuts to `docs/state/harness-friction.md` — never fix the harness here.
