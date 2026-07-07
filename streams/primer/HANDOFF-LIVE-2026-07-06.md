# Primer live handoff — 2026-07-06 late session (Fable → successor orchestrator)

Continuation packet for a NON-Fable orchestrator (GPT-5.5:high or Opus; boot: `omp --config .omp/primer-config.yml --model <lane> @streams/primer/HANDOFF-LIVE-2026-07-06.md "continue the primer session per this handoff"`). Read GOAL.md + VISION.md after this. HARD RULE (Arthur): never spawn anything on anthropic/claude-fable-5 — every spawn carries an explicit model override (GPT-5.5 for logic/annotation, Opus for UI, kimi lanes for retrieval/maintenance). Orchestrator edits files only when tiny; everything else delegated. Subagent packets must be COMPLETE and self-contained (no "same as slice A" cross-references — siblings can't see each other's assignments).

## What shipped today (all gated green unless noted)

1. **Chinese reading loop skeleton** — reader/review/queue + CEDICT (202,906 entries; 4,240 known words) + 4th substrate (learning-card-system). Proof: docs/qa/primer-chinese-loop.md. Live at primer.localhost:1355 (detached nohup process; log /tmp/primer-dev.log).
2. **Shadowing v1** — packages/shadowing-pipeline (faster-whisper large-v3; FireRedASR2S is CUDA-pinned upstream = v1.5 with MFA phonemes) + #/shadow surface + batch mode: **40 aligned assets** at data/primer/shadowing/. Asset API routes (list/alignment/media+Range) in src/shadowing-api.ts, tested. Proof: docs/qa/primer-shadowing-v1.md (pre-batch; update worthwhile).
3. **Generation store (SQLite, Arthur directive: sqlite not markdown)** — data/primer/generation-store.sqlite via `cd packages/primer-daemon && bun run ingest:generation` (idempotent; `stats` subcommand). Current: 531 annotation rows / 54 rubric verdicts / 375 HSK cards. Read-only API: /api/generation/* (src/generation-api.ts, tested).
4. **Meltdown quality pass** — 54 cards audited by 2 judges (canonical tiers: T0=2/T1=31/T2=21) + 4 rewriters; merged per-unit batches at READER/artifacts/generation/quality-pass-2026-07-06/merged/ (READER = streams/primer/wrapped-commentary-reader). `bun scripts/merge-quality-pass.ts` = dry-run against a COPY, accounting verified (moved_in/out columns). **LIVE IMPORT NOT DONE** — decision gate: run import per merged unit only after AbJudge verdict + Arthur nod; site/ files still untouched.
5. **Accelerando fully annotated** (9 clean chapter units, artifacts/books/accelerando-v2): ~470 cards staged in accelerando-v2-2026-07-06/. AnchorValidator (scripts/validate-annotation-batches.ts) found 28 bad anchors; AccelAnno1+2 repaired them (claimed DONE — **rerun the validator to confirm 0 hard failures before any import**). Known gaps: troubadour 09-10, halo 01-02 (inert placeholder files exist — delete + regenerate).
6. **Philosophy library prepped** (clean chapters + prompt files under READER/artifacts/books/): han-feizi (13u/21p), xunzi (11u/24p), analects (20u/20p, Gutenberg Legge), the-prince (10u/15p), art-of-war-lord-shang (18u/24p), man-and-his-symbols (6u/55p), nietzsche-genealogy-of-morals (4u/21p, Kaufmann). Prep pattern documented in the spawn context (pandoc -t plain, TOC-dupe trap, audit-then-fire for sandboxed workers).
7. **HSK5 cards**: 375 in store (words 1-360), mechanical unknown-budget auditor (packages/primer-daemon/scripts/audit-hsk-cards.ts): 91.9% pass, 30 failures listed in streams/primer/hsk-cards/gen-2026-07-06/audit-report.json → queue a repair worker. Tier self-grading drifted in 2 slices (T3-heavy) — normalize at review, don't trust worker tiers.
8. **Prompt-craft doctrine** — READER/references/prompt-craft-tacit-knowledge.md (Fable-authored; binding for all generation packets: process-not-wording, structural A/B only, restate tier semantics inline in EVERY judge/writer packet — drift observed twice).
9. **cards:promote** bridge (store→ledger candidates, dry-run verified 112 T2) — not yet run live.
10. Corpus pass: streams/primer/research/{skycak-pedagogy,corpus-triage,recoveries}.md; VISION.md heavily iterated (shadowing build target, Bloom/Shakespeare lane, HSK progressive-disclosure rule, Cantonese vocab-mismatch lane).

## In flight at handoff (check job/irc/staging dirs; artifacts land on disk even if agents die)

- **AbJudge** (gpt:high) — scoring 3 A/B process arms at READER/artifacts/generation/prompt-ab-2026-07-06/; its RECOMMENDATION decides the standard generation process. On yield: adopt recommendation into prompt-craft doc + use for all future annotation packets.
- **Philosophy annotators** (gpt:medium): AnnoHanFeizi (revived after timeout; entries 1-7), AnnoAnalects (Books I-VII), AnnoPrince (redo against rebuilt 15-file index), AnnoArtOfWar (1-8), AnnoXunzi (1-8), AnnoJung (1-6) → staging READER/artifacts/generation/<slug>-2026-07-06/. On yield: run AnchorValidator per book (`bun scripts/validate-annotation-batches.ts <staging> --book artifacts/books/<slug>`), dispatch anchor repairs to the same (idle) worker, then ingest (NOTE: ingest-generation.ts scans only quality-pass + accelerando dirs — needs the philosophy dirs added; small worker task).
- **KimiBooks** (kimi lane — NOT fable; model role pi/research → kimi-code/kimi-for-coding) — fetching Fanged Noumena, CCRU, Bloom "Shakespeare: The Invention of the Human", acquisition-queue top items → READER/artifacts/library/ + download report.

## Queued next (in priority order)

1. Gate in-flight yields as above; rerun AnchorValidator on accelerando (confirm repairs), fill troubadour/halo gaps (one gpt worker, explicit file list).
2. `bun run check` in packages/primer-daemon (typecheck+web:build+tests) — expected green; a build-cedict.ts syntax race was observed mid-session, now resolved; re-verify.
3. Commit primer paths (pull --rebase first; sibling sessions share the tree — commit with explicit pathspec: packages/primer-daemon packages/shadowing-pipeline streams/primer docs/qa/primer-* TASKS.md). Reader .gitignore correctly excludes artifacts/books|generation (data lives in the sqlite store).
4. Meltdown live import (after AbJudge + Arthur): import merged/*.json via scripts/import-annotation-batch.mjs semantics — MUST merge-per-unit, importer REPLACES whole units; back up site/meltdown-annotations.sqlite first; then rebuild reader IR (export-reader-ir.mjs) so meltdown.localhost shows the upgraded margins.
5. HSK card repair worker (30 audit failures + tier normalization), then cards:promote live.
6. Philosophy annotation waves continue (remaining prompt files per book); Bloom/Shakespeare prep when KimiBooks lands it.
7. Proof docs: primer-annotation-factory.md (store stats, A/B verdict, audit numbers, screenshots) + progress ledger entries (`bun src/cli.ts progress add --kind milestone --title ... --body ... --ref ...`).
8. Deferred decisions for Arthur: meltdown import go/no-go; whether Banks/Gay Science get annotation waves; validator strictness calibration for meltdown legacy anchors.

## Operational notes

- Workers' sandboxes often EPERM on subprocess/fs writes → audit-then-fire: they IRC exact commands, orchestrator fires in parent shell, they verify. Budget for this.
- GPT workers yield then get harness-retried — a final "nothing more needed, park" IRC message stops the loop.
- Never touch primer.localhost:1355 for QA (Arthur's surface); workers boot own ports.
- Live server currently runs from a detached nohup (dies on reboot); Arthur's tmux should run `cd packages/primer-daemon && bun run dev`.
