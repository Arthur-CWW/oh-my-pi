# Proof — Media reader integration, video pipeline pilot, zh-zh dictionary (2026-07-16)

Review contract for the "old UI into the new one" wave. Everything at `http://primer.localhost:1355`.

## Shipped

1. **Media reader inside the daemon** (the hsk-deck reader UX, integrated): reading docs can carry audio/video with char-level alignment (shared `src/alignment.ts` contract, extracted from shadowing — v1 + optional `media.kind`). Reader media mode: **click a character → playback resumes from it** (video seeks + plays), Space play/pause, `P` pinyin ruby (per-char from alignment), `[`/`]` rate, ctrl/alt-click keeps the dictionary/queue loop, decode-state coloring intact, active sentence follows playback. Endpoints: `GET /api/reader/docs/:id/media{,/alignment,/file}` (Range-serving for video). CLI: `primer media import|attach|list`.
2. **UX control grammar** (`streams/primer/experiments/media-reader-ux/control-grammar.md`, Opus, 9-entry deviation ledger): hover = telegraph-only (literal hover-audio REJECTED — touch-blind, machine-gun, a11y), click = seek+play, alt-click = dictionary, arrows = per-sentence, and the load-bearing invariant: **visual confidence never exceeds data confidence** — amber char pill only on `charTiming:"native"` sentences; interpolated → sentence tint only.
3. **Video pipeline pilot — 大耳朵图图 S2E15《伟大的妈妈》** (doc 42): bilibili BV17Qjg6KEmZ → yt-dlp 720p → bilibili ai-zh subs → Qwen3-ForcedAligner char alignment with **char-identity validation** (Arthur's old-pipeline indexing/punctuation bugs guarded: identity mismatch → interpolation fallback, punctuation preserved untimed) → 275 sentences / 2,200 Han chars / 100% coverage / 0 mismatches → `primer media import`. Driver: `scripts/align-media.py`. Report: `streams/primer/research/video-pipeline-pilot.md`.
4. **Monolingual dictionary (zh-zh)**: `/api/zhdict/:word` — graded 例句 (1,044 indexed sentences from hsk-deck corpora, easiest-first by HSK coverage), cached LLM-generated simple-zh 释义 + 近义词 with usage notes (HSK1-3 vocabulary constraint), 字形拆解, EN demoted to a collapsed `··· en` disclosure. `ZhDictCard` now IS the reader word popup. CLI: `primer zhdict index`.
5. **Corpus**: 梁文锋 暗涌 2023+2024 (docs 20–25), CEO AGI manifestos — 唐杰《巨浪已来》, 杨植麟 AGI随笔 ×11, 吴泳铭 云栖 2025 (docs 26–41), Tutu episode (doc 42). Drama identified: **《庆余年》 Joy of Life** (~0.8 — plot matches exactly: modern literature-history student framing device, 猫腻 webnovel; the "lanyang wang" sound is a 《琅琊榜》 title-blend); official Tencent 46-ep page + official YouTube playlist located, zh CC unverified. Browser-history forensics found no vertical-drama trace (`research/browser-history-zh-media.md`).

## Evidence

- Gate: `bun run check` → **147 tests / 533 expects, 0 fail** across the union of 8 lanes.
- Browser QA (isolated `primer-qa5`, `local/primer-media-qa/REPORT.md`): all controls, dictionary, generation, no-media fallback, telemetry, teardown PASS; one defect **D1** — pilot alignment omitted `charTiming:"native"` markers, so char pills never showed. Fixed same session (driver + deployed asset patched: 201 native / 74 interpolated), verified live: native-char click → playback at char offset + amber pill (screenshot in transcript).
- Live: `/api/reader/docs/42/media` serves video meta; Range → 206; `/api/zhdict/学习` → zh-only gloss + 4 graded sentences + 2 synonyms.
- QA teardown pkill also killed the live daemon (pattern overlap) — restarted with `portless --force` over a defunct alias holder; future QA packets should kill by PID.

## Rerun

```bash
cd packages/primer-daemon && bun run check
open http://primer.localhost:1355/#/read/42   # click a character
bun src/cli.ts media list
bun src/cli.ts zhdict index                   # idempotent
```

## Next

Xi speech videos + 庆余年 ep 1 through the same pipeline (subtitle availability pending), GPU box migration of ASR+alignment (pilot bottleneck timings in the pilot report), FireRedASR2S for no-subtitle sources, Hanly etymology → simple-zh generation, Mochi-grid deck overview, zh question segmentation for ask.
