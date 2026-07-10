# Primer live handoff — 2026-07-09 (Fable → reloaded session)

Boot: `omp --config .omp/primer-config.yml @streams/primer/HANDOFF-LIVE-2026-07-09.md "continue the primer session per this handoff"`. Supersedes HANDOFF-LIVE-2026-07-06.md (read it only for background). Read GOAL.md + VISION.md after this.

**Routing (Arthur, 2026-07-09): OpenAI account still down** (Pro shows Free after reinstatement; case 11129100 escalated — watcher log `local/openai_pro_mail_watcher.log`). `.omp/primer-config.yml` worker roles now pin **Opus 4.8 as the hands** (smol/task/maintenance low–medium, implementer/complex/plan/slow high); Kimi keeps retrieval niches; vision stays Gemini Flash. HARD RULE unchanged: never spawn on `anthropic/claude-fable-5`; config roles now carry the override, but explicit `model:` on spawns remains good hygiene. Revert config to GPT-5.5 lanes when the account recovers.

## Gates resolved 2026-07-09 (this session, evidence on disk)

1. **A/B verdict: variant-B ADOPTED.** AbJudge died without an arm-level recommendation; computed from its 82 per-card verdicts (`READER/artifacts/generation/prompt-ab-2026-07-06/judge-verdicts.jsonl`; READER = streams/primer/wrapped-commentary-reader): baseline 13/30 keep, 17 giveaways; v2 22/30, 8; **variant-B 18/22 (82%), 4** — lower count = coverage-ledger dedupe, a feature. Recorded in `READER/references/prompt-craft-tacit-knowledge.md` §"A/B verdict". Every generation packet now carries the variant-B numbered steps (thesis cache → coverage ledger → target-before-fields → fields render → self-audit) plus tier semantics inline (T2 = target tier; T3 = rare cross-unit synthesis; plausible-T1 stays out).
2. **Accelerando repairs confirmed**: validator report 2026-07-07 = 52 files / 431 annotations / **0 hard failures**. BUT coverage is 52/106 prompt files — the 07-06 handoff's "fully annotated" was overclaimed. Missing: u-002 p09, u-004 p02, u-005 p17, ALL of u-006 (12), u-007 (17), u-008 (13), u-009 (9) = 54 prompts.
3. **Philosophy staging validated clean** (0 hard failures each): analects 7f/57a, xunzi 8f/71a, art-of-war-lord-shang 8f/51a, man-and-his-symbols 6f/59a. **han-feizi**: 4 files staged, NO validation report — validate before ingest counts. **the-prince**: staging empty (worker died, nothing landed).
4. **quality-pass meltdown-mode validation FAILS**: 4/4 files failed, 84 hard failures (`quality-pass-2026-07-06/validation-report.json`) — merged batches don't validate against site/ under current strictness. Meltdown live import stays BLOCKED on validator-strictness calibration + Arthur go/no-go.
5. **KimiBooks landed** in `READER/artifacts/library/`: CCRU Writings, Bloom Western Canon, RSC Shakespeare Complete Works (73MB epub), OpenIntro Stats + download reports. (Bloom "Invention of the Human" specifically — check reports before assuming.)
6. **07-07 session** (commit 07d9a21b) generalized `ingest-generation.ts` — scans ALL dated `READER/artifacts/generation/*-20??-??-??` dirs (excludes prompt-ab). Store: 804 annotation rows / 93 batches / 375 HSK / 54 rubric (`cd packages/primer-daemon && bun scripts/ingest-generation.ts stats`). All primer paths were committed; working tree clean at boot.

## Wave 1 — ready to fire on reload (7 parallel workers, one task call)

Exact missing-prompt lists verified against `books/<slug>/prompts/` minus staged `*.batch.json`; prompt md files are self-contained (rules + input blocks embedded; sibling `.input.json` has block texts for anchor verification).

| worker | slice | prompts |
|---|---|---|
| AccelNightfall | u-006 all + gaps u-002-p09, u-004-p02, u-005-p17 | 15 |
| AccelCurator | u-007 p01–17 | 17 |
| AccelElectorSurvivor | u-008 p01–13 + u-009 p01–09 | 22 |
| AnnoPrince | the-prince all (staging `the-prince-2026-07-06/` exists, empty) | 15 |
| AnnoGenealogy | nietzsche-genealogy-of-morals all (create `nietzsche-genealogy-of-morals-2026-07-09/`) | 21 |
| AnnoHanFeizi2 | han-feizi u-004…u-013 (17 files; u-001–003 staged) | 17 |
| HskRepair | 30 failures in `streams/primer/hsk-cards/gen-2026-07-06/audit-report.json` + tier normalization (T3=128/375 = drift; auditor `packages/primer-daemon/scripts/audit-hsk-cards.ts`); edit batch files, never the sqlite | — |

Packet invariants (all annotation workers): output `<prompt-basename>.batch.json` into the book's staging dir, shape matched to a staged exemplar (e.g. `accelerando-v2-2026-07-06/u-005-chapter-5-router-part-02.batch.json`); anchors are VERBATIM substrings of block text incl. newlines; variant-B steps + tier semantics restated inline; self-run `bun scripts/validate-annotation-batches.ts <staging> --book artifacts/books/<slug>` (from READER) to 0 hard failures; no project-wide gates (orchestrator gates once).

## After wave 1 (priority order)

1. Gate: rerun AnchorValidator per book yourself; re-ingest (`bun run ingest:generation`), verify stats deltas.
2. HSK: rerun auditor to ~100%, then `cards:promote` LIVE (dry-run previously verified 112 T2; promote makes candidates, not irreversible).
3. `bun run check` in packages/primer-daemon — NOT yet run this session; expected green.
4. Wave 2 annotation: analects VIII–XX (13), xunzi (16), art-of-war (16), jung (49 — split into ≥3 workers).
5. Proof doc `docs/qa/primer-annotation-factory.md` (store stats, A/B table, audit numbers) + progress ledger entries (`bun src/cli.ts progress add ...`).
6. Commit primer paths with explicit pathspec (pull --rebase first; sibling sessions share the tree).

## Arthur decisions pending

- Meltdown live import go/no-go + validator strictness calibration for legacy anchors (see gate 4 — currently hard-blocked regardless).
- Banks / Gay Science annotation waves.
- Bloom/Shakespeare prep lane now that the books landed.

## Operational notes (carried forward)

- Workers may EPERM on subprocess/fs in sandboxes → audit-then-fire via IRC; task-tool in-process workers usually fine.
- Never QA against primer.localhost:1355 (Arthur's surface); live server is a detached nohup, Arthur's tmux should run `cd packages/primer-daemon && bun run dev`.
- Prompt-craft doctrine is binding for every generation/judge packet: `READER/references/prompt-craft-tacit-knowledge.md`.
