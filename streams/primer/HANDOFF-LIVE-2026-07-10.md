> **SUPERSEDED — history, not instruction.** The highest-dated `streams/primer/HANDOFF-LIVE-*.md` is the live handoff; never boot from this file. Routing/status claims below were true on 2026-07-10/11 only.

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

## 2026-07-11 minimal-workbench continuation

- **Prior-session/source recovery complete**: consolidated entry point at `streams/primer/research/learning-sources/system-synthesis.md`; canonical manifest links saved Skycak threads, Matuschak prompt essay/research trail, Kirkby+Matuschak Memory Machines, and Grant Sanderson/Dwarkesh transcript. Historical OMP evidence recovered from handoffs plus ReaderMultiBook/BookIrBuilder/MeltdownDeep/ReviewView/ScanView histories. Per-card model provenance remains incomplete in old batches.
- **One-chapter annotation workbench shipped in nested READER**: `scripts/annotation-workbench.ts` + `experiments/meltdown-machinic/`. Commands prepare/record/label/compare create atomic, content-hashed Markdown/JSON runs; no model/API execution or DB. Opus 4.6 produced `intent-brief.md` + editable `prompt-v0.md` once. First isolated GPT-5.6 run recorded as `2026-07-11T04-34-08-344Z-03383117`; Arthur feedback still pending.
- **Reader side-chat clean cutover**: fake Agent sidebar and `/api/chat` frontend flow removed. Exact block-local DOM Range selection now creates a removable Zed-style `ReaderContextReference` chip and deterministic `OmpRequestPacket` for clipboard/manual copy; UTF-16 offsets, work/unit/block/page, exact quote, surrounding source, IR identity, capture provenance. Cross-block/source-false selections rejected. Existing mark/candidate actions retained. Functional prototype only: expanded composer still visually heavy/overlays reading; polish deferred.
- **Global card CLI completed**: existing `primer card add --front --back --source-ref --url` remains canonical SQLite inbox creation path; added `primer card status <id> candidate|approved|rejected`, including idempotent migration for legacy ledgers lacking `status`. Do not create a competing Markdown/global store; Hashcards Markdown remains downstream approved content and Hashcards SQLite remains FSRS state.
- **Gates**: READER focused tests 10/10 + Vite production build; primer-daemon focused CLI tests 4/4 + full typecheck/web build/123 tests. Kimi browser QA after rebuild: 9/9 context-chip flow pass, zero window/network errors, screenshots under `READER/artifacts/tmp/context-chip-qa/`.

## Arthur's product directives (2026-07-10, binding for next sessions)

- **Scheduler** ("scheduling within scheduling"): ONE review stream with correct FSRS timing; priority queue = user-pushed items jump NEW-card introduction order, never corrupt due timing; interleaving = same-lemma/sibling variations forced apart (false-familiarity guard); dependency gating from a knowledge graph (Skycak primitives are the spine — read the distillation).
- **Word-select → priority queue** in the reader (HSK/Chinese first): select word in sentence → queue faster / see further context. queue_items already exists (reading marks auto-queue); missing: priority column + UI push + scheduler.
- **Knowledge graph for everything** (maths, Chinese, philosophy): units broken exactly to dependencies, small enough to "just make sense"; generate with SEVERAL models cross-validating edges; disagreements go to Arthur's scan/review surface.
- **Philosophy canon policy**: don't read whole earlier texts; explain references in place (current margin system validated) + "expand reference" affordance later. Arthur may do a full Western-canon reading LATER — don't over-build for it now.
- **Mobile + sync**: end product must be reviewable on mobile (sync engine, syncs everywhere); local data-viewer surfaces exempt. Direction only — nothing built.
- Taste: bespoke/typographic/reader-first; NEVER generic AI-app React look. Terminal theme exists so Arthur can feel the TUI direction.

## Next (priority order)

1. **Arthur calibration**: review first GPT-5.6 Machinic Synthesis run at `READER/experiments/meltdown-machinic/runs/2026-07-11T04-34-08-344Z-03383117/response.md`; label chapter model, four proposed interventions, and exclusions through the workbench. Briefly reread only this unit and its existing annotations—not all books.
2. Fork prompt v0 only after Arthur labels attention/explanation failures. Keep one chapter, static prompt, OMP interaction; no batch regeneration/import.
3. Define explicit promotion contract from useful explanation → reader-local candidate → global daemon ledger. Do not promise rubric-tier auto-promotion: annotation and rubric batches lack a proven collision-safe join key. Manual `primer card add` works now.
4. UI debt after calibration: dock/collapse context composer, hide raw packet behind details, clarify UTF-16 range label, move Note/Vocab/Concept/Quote/Card into overflow. Do not spend a design wave before the prompt loop proves useful.
5. Vim-style reader shortcuts are a deferred side quest; preserve native selection/composer keys first.
6. Meltdown import go/no-go, scheduler/knowledge graph, mobile sync, and further annotation waves remain deferred as described below.

## Operational notes

- READER is a NESTED git repo inside streams/primer (outer repo gitignores it). Commit separately.
- site/books/ is generated+gitignored; rebuild with `bun run export:books` (idempotent; re-verifies anchors at merge).
- **Reader viewer is persistently supervised** at `https://meltdown.localhost` (current supervisor PID in `data/meltdown-reader/dev-up.pid`; health `/api/health`; one log `data/meltdown-reader/errors.log`). Runtime lives in nested READER `scripts/dev-supervisor.mjs`: atomic PID/identity lock, backend + Vite/portless detached groups, paired restart, TERM→KILL escalation, HMR, safe static-alias takeover. Start after reboot/session loss with `mise run up primer`; stop with `/bin/kill -TERM "$(cat data/meltdown-reader/dev-up.pid)"` from outer repo. Session-level only: survives shell exit, not reboot.
- Shared eval/node_repl kernels get clobbered across parallel workers — packets should tell workers to namespace or use file snapshots (observed twice).
- GPT/kimi workers: send a final "park" message to stop harness retry loops.
