---
name: wrapped-commentary-learning-card-db
description: Rebuild and verify the wrapped-commentary-reader local learning-card SQLite seed for Justin/Math Academy/HSK frontier work.
---

# Wrapped Commentary Reader learning-card DB workflow

Use this when working in `/Users/arthur/exploratory/systems/wrapped-commentary-reader` on Arthur's Justin/Math Academy learning-card apparatus.

## Key artifacts

- Seed DB builder: `scripts/build-learning-card-system-db.ts`
- Output DB: `artifacts/learning-card-system/learning-card-system.sqlite`
- Inputs:
  - `artifacts/learning-card-system/math-academy-graph.sqlite`
  - `artifacts/learning-card-system/card-candidates-golden-nuggets.json`
  - `artifacts/learning-card-system/tacit-moves-golden-nuggets.json`
  - `artifacts/learning-card-system/card-compiler.schema.json`
- Docs:
  - `docs/research/justin-math-learning/learning-card-system-sqlite.md`
  - `docs/research/justin-math-learning/boundary-frontier-query-playbook.md`
  - `docs/research/justin-math-learning/ai-teacher-harness-synthesis.md`

## Rebuild

From repo root:

```bash
bun scripts/build-learning-card-system-db.ts
bun run source:library
```

Do not modify `package.json` just to run this; it may contain unrelated in-flight user/Codex edits.

## Expected seed counts

Query `learning-card-system.sqlite` and verify:

- `graph_courses`: 8
- `graph_topics`: 194
- `graph_edges`: 285
- `concept_nodes`: 10
- `concept_prerequisites`: 17
- `tacit_moves`: 48
- `card_candidates`: 20
- `card_target_concepts`: 21
- `card_prerequisites`: 22
- `card_tacit_moves`: 15
- `attempt_log`: 0
- `hsk_unknown_word_budget`: 0
- `learner_frontier`: 0
- `concept_mastery` view: 10 rows
- `frontier_ready_cards` view: 0 rows in the empty-frontier seed

## Invariants

- HSK repo is linked at `external/hsk-deck`; treat it as read-only.
- Preserve rejected cards in the DB for audit, but schedule only `status_decision = 'keep'`.
- Correctness is not mastery: `concept_mastery` downgrades reference reliance, guesses, slow solves, and wrong answers.
- Source registry files are generated from `references/source-acquisition-queue.json`; after queue/library-source edits run `bun run source:library` and stage the generated `artifacts/library/source-library.*` if relevant.

## Verification snippets

Use Python/SQLite or Bun to assert table counts and run at least one remediation query against a temporary failed attempt, rolling back afterward. A known sample: insert a failed attempt for `C001`; remediation should include prerequisite `derivatives`, tacit move `TM-001`, and the gradient-ascent common wrong answer.
