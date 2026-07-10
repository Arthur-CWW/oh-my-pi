# Primer annotation factory — proof of work (2026-07-10)

Session: Fable orchestrator, continuation of `streams/primer/HANDOFF-LIVE-2026-07-09.md`. All generation on delegated Opus 4.8 workers (orchestrator never annotated); validation gated centrally.

## Annotation waves (all validator-clean)

`READER = streams/primer/wrapped-commentary-reader`. Validator: `bun scripts/validate-annotation-batches.ts <staging> --book <book>` (reader-ir mode; meltdown mode for site). Every dir below reports **0 hard failures** on its final run.

| Book | Batch files | Cards | Staging dir |
|---|---|---|---|
| accelerando-v2 (Stross) | 106 | 800 | accelerando-v2-2026-07-06 |
| man-and-his-symbols (Jung) | 55 | 473 | man-and-his-symbols-2026-07-06 |
| xunzi | 24 | 275 | xunzi-2026-07-06 |
| nietzsche-genealogy-of-morals (Kaufmann) | 21 | 160 | nietzsche-genealogy-of-morals-2026-07-09 |
| analects (Legge) | 20 | 150 | analects-2026-07-06 |
| han-feizi (Watson) | 21 | 141 | han-feizi-2026-07-06 |
| art-of-war-lord-shang | 24 | 140 | art-of-war-lord-shang-2026-07-06 |
| the-prince | 15 | 124 | the-prince-2026-07-06 |
| accelerando (legacy sections) | 4 | 32 | accelerando-2026-07-06 |
| **meltdown-deep (staged, NOT imported)** | 12 | 45 | meltdown-deep-2026-07-10 |

Total: 2,295 book cards + 54 meltdown (imported) + 45 staged meltdown supplements = 2,394 in the library index. Process: variant-B (adopted per A/B verdict 2026-07-09), tier semantics restated per packet, anchors verified verbatim (incl. newlines) against `.input.json`/source blocks, per-unit retrieval-target dedup < 0.85.

Notable repairs during the run:
- Accelerando placeholder gaps (troubadour-10, halo-01) detected via 0-row ingest and regenerated — filename presence ≠ content.
- han-feizi legacy u-001–u-003: 19 anchors missing literal line-wrap newlines; repaired, dir now 21/21 clean.
- Meltdown merged import candidates: 13 non-verbatim anchors fixed (2 pure case, 1 matches a source typo verbatim). Remaining validator noise on merged files is schema strictness only (`verdict`/`reason`/`block_key` — fields the importer does not consume). **Import still Arthur-gated.**

## Generation store (data/primer/generation-store.sqlite)

`cd packages/primer-daemon && bun scripts/ingest-generation.ts stats`:
- annotation-rewrite: **306 batches / 2,408 rows**; rubric-verdict: 54; hsk-cards: 369 (T2=369).
- **Ingest reconciliation defect found+fixed**: row identity is (batch_id, word, card_type, front); repaired fronts orphaned 36 stale rows (405 vs 369 in files, 13 stale T3). `ingest-generation.ts` now deletes per-batch rows absent from the source file (`deleted` count added; tests in `test/ingest-generation.test.ts`, 5 pass). Second run provably no-op.
- `bun run check` (primer-daemon): green (typecheck + web build + 115 tests) — run before the reader work; rerun pending final Phase B UI merge.

## HSK5 pipeline (end-to-end live)

- 30 audit failures repaired (unknown-budget + front-leak), headwords intact; auditor **369/369 pass**.
- Tier normalization: T3 128 → 0 (all were atomic single-headword cards; T3 = cross-unit synthesis only).
- `cards:promote` run LIVE: 369 ledger candidates inserted; rerun idempotent (369 skipped).

## Reader (browse surface)

- Multi-book: `#/` library home, `#/book/<slug>` reader; 11 library entries (meltdown, meltdown-deep staged, 9 books). IR pipeline: `bun run export:books` → `site/books/<slug>/reader-ir.json` + `index.json` (anchor re-verified at merge; 0 dropped on final build).
- QA screenshots: `READER/artifacts/tmp/reader-multibook-qa/` (v1), `reader-theme-qa/` (6 theme shots), `reader-phaseb-qa/` (per-view), `reader-final-qa/` (release sweep 01–09).
- **Release QA (kimi lane, 2026-07-10): 8/8 PASS** — 11 covers + totals, genealogy reader (185 margin cards), meltdown-deep staged (45/45 rendered), review session graded live, scan triage verdicts persisted, theme cycle readable, zero window errors, write-back rows verified (review_grade + annotation_triage, work_slug-tagged).
- Published via `bun run portless` → http://meltdown.localhost:1355/ (library home now multi-book).
- Write-back: all interaction tables carry `work_slug`; reviewed rows proven in sqlite (e.g. `stage_card_for_agent`, work_slug `the-prince`).

## References captured

- Arthur×Claude Meltdown chat → `READER/references/arthur-meltdown-claude-chat-2026-07.md` (drives meltdown-deep pass).
- Skycak knowledge-graph/scheduling threads + distillation → `streams/primer/research/skycak-*.md` (11 primitive groups, quote-anchored; replies unrenderable via occluded WKWebView — documented in-file).

## Open gates for Arthur

1. Meltdown import go/no-go (54 rewritten + 45 deep staged; importer REPLACES whole units; back up site/meltdown-annotations.sqlite first, then `export:ir`).
2. Validator strictness for meltdown legacy formats (schema fields the importer ignores).
3. Next annotation waves (Bloom/Shakespeare, Gay Science) — **parked until GPT sub returns; Opus throttled per Arthur 2026-07-10**.
4. Scheduler design (FSRS + priority queue + interleaving + knowledge-graph gating) — design doc next, built on Skycak primitives.
