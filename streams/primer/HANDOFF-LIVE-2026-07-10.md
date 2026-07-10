# Primer live handoff — 2026-07-10 (Fable orchestrator session)

Supersedes HANDOFF-LIVE-2026-07-09.md. Read GOAL.md + VISION.md after this.

## HARD CONSTRAINTS (Arthur, this session)
- **Opus throttled**: 5h quota nearly dry. Opus ONLY for design/UI-UX work, small doses. **Kimi lanes for any logic task** (kimi-implementer etc.). Annotation waves PARKED until Arthur's GPT sub returns (~few days) — then resume "going ham".
- Never spawn on anthropic/claude-fable-5. Workers self-validate only their slice; orchestrator gates.

## Shipped this session (all gated green)

1. **Annotation waves 1+2 complete** — 9 books validator-clean (0 hard failures everywhere): accelerando-v2 800 (106 files — placeholders troubadour-10/halo-01 detected via 0-row ingest and regenerated), man-and-his-symbols 473, xunzi 275, genealogy-of-morals 160, analects 150, han-feizi 141 (19 legacy newline-anchor repairs), art-of-war-lord-shang 140, the-prince 124, legacy accelerando 32. Process: variant-B + Arthur depth directive ("too basic" → intellectual genealogy / cross-tradition contrast / etymology).
2. **Meltdown deep pass STAGED** (artifacts/generation/meltdown-deep-2026-07-10, 45 cards, 12 units, 0 hard failures, ≤0.58 overlap with existing 54) — keyed to Arthur's Claude-chat gaps (references/arthur-meltdown-claude-chat-2026-07.md, extracted via cmux). Import remains Arthur-gated; reviewable in-app as "Meltdown — deep pass (staged)". Meltdown merged quality-pass import candidates: 13 real anchor fails FIXED; remaining validator noise is schema-strictness on fields the importer ignores (verdict/reason/block_key).
3. **Multi-book reader shipped** (READER = streams/primer/wrapped-commentary-reader; nested git repo, committed): library home #/ (Apple-Books typographic-cover shelf + list toggle), #/book/<slug> Talmudic reader, #/review (Anki-style, no-adjacent-unit interleave, grades→feedback_signals), #/scan (keyboard triage j/k a/r/f/x n g, verdicts→feedback_signals, flagged-JSON export). Theme system: token-driven light/dark/terminal, auto-follows system dark/light, manual cycle persisted. All write-back tables carry work_slug (Arthur's label stream is book-attributed). IR pipeline: `bun run export:books` → site/books/. `bun run portless` chains export:ir && export:books && build && publish.
4. **HSK5 end-to-end live**: 30 audit failures repaired, tiers normalized (T3 128→0), auditor 369/369, `cards:promote` LIVE → 369 ledger candidates (idempotent rerun proven).
5. **Ingest reconciliation fix** (packages/primer-daemon/scripts/ingest-generation.ts): per-batch stale-row deletion + `deleted` count + tests (119 pass). Store: 306 batches / 2,408 annotation rows. `bun run check` green.
6. **Skycak scheduling/knowledge-graph threads** extracted (authenticated cmux; replies unrenderable — occluded WKWebView, documented) + distilled: streams/primer/research/skycak-scheduling-primitives-distilled.md (11 primitive groups, quote-anchored, 2 [AMBIGUOUS] flags).
7. Proof doc: docs/qa/primer-annotation-factory.md. Progress ledger entries 14-16. Both repos committed (reader repo + outer primer paths).

## Arthur's product directives (2026-07-10, binding for next sessions)

- **Scheduler** ("scheduling within scheduling"): ONE review stream with correct FSRS timing; priority queue = user-pushed items jump NEW-card introduction order, never corrupt due timing; interleaving = same-lemma/sibling variations forced apart (false-familiarity guard); dependency gating from a knowledge graph (Skycak primitives are the spine — read the distillation).
- **Word-select → priority queue** in the reader (HSK/Chinese first): select word in sentence → queue faster / see further context. queue_items already exists (reading marks auto-queue); missing: priority column + UI push + scheduler.
- **Knowledge graph for everything** (maths, Chinese, philosophy): units broken exactly to dependencies, small enough to "just make sense"; generate with SEVERAL models cross-validating edges; disagreements go to Arthur's scan/review surface.
- **Philosophy canon policy**: don't read whole earlier texts; explain references in place (current margin system validated) + "expand reference" affordance later. Arthur may do a full Western-canon reading LATER — don't over-build for it now.
- **Mobile + sync**: end product must be reviewable on mobile (sync engine, syncs everywhere); local data-viewer surfaces exempt. Direction only — nothing built.
- Taste: bespoke/typographic/reader-first; NEVER generic AI-app React look. Terminal theme exists so Arthur can feel the TUI direction.

## In flight / next (priority order)

1. **FinalReaderQa2** (kimi) — release QA sweep on :4797 with screenshots → then `bun run portless` publish (NOT yet run) + update proof doc with QA results.
2. **Scheduler design doc** (kimi or GPT when back; NOT Opus): FSRS + priority + interleave + dependency gating against skycak-scheduling-primitives-distilled.md; then smallest slice = priority column + word-select push in primer-daemon Chinese reader.
3. Meltdown import go/no-go (Arthur): 54 rewritten units + 45 deep staged; importer REPLACES whole units; back up site/meltdown-annotations.sqlite; then export:ir.
4. Annotation waves (Bloom/Shakespeare — epub landed; Gay Science; Banks) — PARKED until GPT sub returns.
5. Knowledge-graph lane: start from HSK vocab variations + annotation refs fields; multi-model edge validation; surfaces exist (scan view) for disagreement review.
6. legacy accelerando (32 section cards) kept in index, retitled "Accelerando (legacy sections)" — Arthur may drop it.

## Operational notes

- READER is a NESTED git repo inside streams/primer (outer repo gitignores it). Commit separately.
- site/books/ is generated+gitignored; rebuild with `bun run export:books` (idempotent; re-verifies anchors at merge).
- QA server pattern: PORT=479x bun serve.mjs (never Arthur's 4173/1355). Dev server for Arthur: cd READER && bun run serve (4173) after portless publish.
- Shared eval/node_repl kernels get clobbered across parallel workers — packets should tell workers to namespace or use file snapshots (observed twice).
- GPT/kimi workers: send a final "park" message to stop harness retry loops.
