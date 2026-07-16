# Proof — Feedback wave: ask chat, retrievability scheduling, authentic corpus, reader recovery, doctrine (2026-07-15)

Review contract for the wave driven by Arthur's voice feedback (ask slow/ambiguous; boring corpus; DuChinese reader recovery; scheduler quirks; acquisition theory). Read this instead of the code.

## Shipped

1. **Ask → streaming chat** (`web/src/components/AskPanel.tsx` rebuilt). Root cause of "doesn't stream": SSE was already incremental — the dead air was evidence-retrieval + omp spawn latency with zero phase feedback. Now: chat history (user/assistant cards), immediate `searching evidence → found N hits → model thinking → streaming` phases, token cursor, Esc/Stop abort, example chips, elapsed ms, `ask_submit`/`ask_first_token` telemetry (the slowness is now measurable).
2. **Retrievability scheduling** (Arthur's post-lapse + tired-night asks — one mechanism):
   - Due items ordered by FSRS **retrievability ascending** (`ts-fsrs get_retrievability`) — young/low-stability cards surface first after a missed day (steepest decay first). Explain badges show `R n% · most at risk`.
   - **Quick sweep (tired mode)**: `?mode=quick` → due items with R ≥ 0.85 only, descending (easiest first), zero NEW items. Toggles in ReviewView session start + SchedulerXray.
3. **Authentic corpus** (12 docs, ids 4–14 + 19; originals archived with provenance in `streams/primer/feedstock/zh-corpus/`): T1 folk tales (白蛇传, 孟姜女, 牛郎织女), T2 political register (毛主席语录 ×4, 习近平新年贺词 ×2), T3 targets (论语 学而/为政, 韩非子 说难). Rust docs retained but demoted. Survey: `streams/primer/research/chinese-seed-corpus.md`.
4. **HSK reader + mochi-lite revived** (operator lane): `http://hsk-reader.localhost:1355` + `http://mochi-lite.localhost:1355`, running for Arthur. Rebuild contract (char-timestamp format, full keymap, Cantonese alignment mechanism, RadicalExplorer data source): `streams/primer/research/hsk-reader-recovery.md` + screenshots `local/hsk-reader-recovery/`.
5. **Acquisition doctrine** (`streams/primer/research/acquisition-doctrine.md`, Opus): word↔EN-dict rejection grounded in Arthur's own tweets (@pleometric = Arthur; ids cited), Cantonese-pivot mechanism, 5-rung monolingual ladder, per-surface do/don't table. **ASR recovery CLOSED**: FireRedASR2S (subtitles/alignment) + NVIDIA Parakeet (non-Mandarin) — VISION §Open recoveries #1. **Hanly is local**: `hsk-deck/hanly-re/output/hanly-content.sqlite` (characters/words/primitives/decomposition/etymology, 89–99% HSK coverage) — the radical/root data source for the reader rebuild. Plus `hsk-deck-index.md` (full doc index with stale flags).
6. **Scheduler v2 doctrine** (`streams/primer/experiments/scheduler-language-v2/design-brief.md`, Opus): retrievability spine (argues quick-sweep grades update FSRS normally — "a rep is a rep"), exposure crediting (recommends log-only v1; false-stability risk argued), failure-reason taxonomy (decode/slow/forgot → three different subsystems), card flatness, v2.1–v2.4 sequence, 5 taste forks for Arthur.

## Evidence

- Gate: `bun run check` → **142 tests / 501 expects, 0 fail** post-wave.
- `GET /api/review/session?mode=quick` echoes `{mode, threshold: 0.85}` live.
- Third-pass browser QA (ask streaming phases + mode toggles): `local/primer-playground-qa/REPORT.md`.
- Corpus verified via `GET /api/reader/docs` (15 docs total, Chinese titles).
- ZhCorpusCurator was budget-cancelled after archiving; orchestrator seeded the last doc (19) from its archive — no work lost.
- Third-pass browser QA caught a defect unit tests couldn't: the live answer arrived **atomically** — `omp -p` text mode prints only the final message after the turn resolves. Fixed same session: `ask-synthesis.ts` spawns `omp --mode json` and forwards `message_update/text_delta` events as SSE deltas (NDJSON line parser; lifecycle/thinking events filtered; non-JSON stdout noise never leaks into answers). Live verification: 14 discrete delta events, first at 4.6s.
- Known gap (next wave): Chinese-language questions yield no search terms (`extractTerms` doesn't segment Han text) → evidence-less short-circuit, no synthesis. Matters because doctrine is zh-first.

## Next wave (gated on this one)

Audio children's reader in the daemon (press-char-resume, space pause, pinyin toggles, ctrl-click-to-queue, Cantonese vertical alignment, decode-state coloring — per the recovery contract + acquisition doctrine), GPU forced-alignment service on the RTX box, Peppa Pig/bilibili ingestion, Mochi-style deck-overview grid, failure-reason capture (scheduler v2.2), exposure logging (v2.3).
