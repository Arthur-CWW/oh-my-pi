# Proof — Chinese loop scheduler, priority queue, promotion bridge (2026-07-15)

Review contract for the FSRS review scheduler wave in `packages/primer-daemon`. Read this instead of the code.

## What shipped

Arthur's 2026-07-10 binding directive ("scheduling within scheduling"), implemented:

1. **FSRS scheduler, borrowed never invented** — `src/review-store.ts` uses the `ts-fsrs` package for all scheduling math. `review_state` (due/stability/difficulty/reps/lapses/state, monotonic `state_version`) + append-only `review_events` (grade, prior/derived state version — never mutated), per `streams/primer/CARD-PROMOTION.md` stage 8. Item identity is `item_kind` + `item_id`, so queue words and ledger cards share ONE review stream.
2. **Priority queue** — `queue_items.priority` (idempotent migration). Priority reorders **NEW-item introduction only**; due timing is FSRS-owned and untouched. `POST /api/queue/:id/priority`.
3. **Interleave guard** — session ordering forces same-headword/shared-character words apart (false-familiarity guard).
4. **Word-select → priority push** — reader popup: `p` (or button) pushes/increments priority, marked with a restrained underline state; no reload.
5. **Graded review session** — `#/review` session mode: large hanzi, space to reveal, grades 1/2/3/4 (again/hard/good/easy), phase + priority badges, provenance link that anchors the reader at the exact mark (`?mark=<id>`, scroll + flash). Triage tabs unchanged.
6. **Promotion bridge** — `enrollCardCandidate`: explicit, idempotent enrollment of APPROVED `card_candidates` into the same stream (approval never auto-enrolls, per contract). Card items carry `itemKind: "card_candidate"` + `front`/`back`. CLI: `primer review enroll <cardId>`, `primer review due`.
7. **Cards evidence substrate exposed in web UI** — `EvidenceSource` gained `"cards"` (label `cards`, violet dot); URL-less card hits render as non-link rows.

API: `GET /api/review/session?limit=N` → `{ items }`; `POST /api/review/grade` `{ queueItemId, grade, itemKind? }`; `POST /api/queue/:id/priority` `{ priority }`.

## Evidence

- **Gate**: `cd packages/primer-daemon && bun run check` → typecheck + web build + **131 tests / 457 expects, 0 fail** (2026-07-15).
- **Isolated browser QA** (never against the live instance; `PRIMER_LEDGER_DB` temp copy on `primer-qa.localhost:1355`): `local/primer-scheduler-qa/REPORT.md` + step screenshots — 10/11 PASS, zero console/network errors. Full loop exercised: seeded doc → word click → priority push ×2 → 5-word queue → triage keys → session (priority-pushed word introduced first) → reveal/grade → completion counts → card enrollment surfaced with front/back → API 400s on bad grade/negative priority → CLI counts consistent.
- **Defects found by QA, both fixed and re-gated same session**:
  1. Provenance dropped the mark anchor (ReviewView navigated to `#/read/<docId>` without `?mark=`). Fixed: `markId` now flows queue SQL → provenance → both navigate calls; reader scrolls + flashes the mark. Test asserts `provenance.markId`.
  2. Dashboard logged a hard-coded `meltdown` alias registration error on isolated startup. Fixed: best-effort quiet claim, `PRIMER_MELTDOWN_ALIAS=0` opt-out (the reader dev supervisor legitimately owns the alias when running).

## Rerun

```bash
cd packages/primer-daemon && bun run check       # full gate
bun test test/review-store.test.ts test/review-card.test.ts
open http://primer.localhost:1355/#/read         # 3 seeded zh docs (ids 1-3)
bun src/cli.ts review due                        # scheduler counts
```

## Companion deliverables (same wave, design-only)

- `streams/primer/experiments/queue-enrichment/` — enrichment prompt v0 + intent brief (the "agent enriches" step; first-10 calibration gated on Arthur labels).
- `streams/primer/experiments/scheduler-dependency-gating/design-brief-v0.md` — dependency gating as fail-open admission policy over FSRS, Skycak-primitive-cited.
- `streams/primer/research/chinese-seed-corpus.md` — corpus survey; 3 seeded docs (Rust By Example zh, 87–91% HSK1-5 coverage; no local narrative prose found — paste-first covers the gap).
- `READER/experiments/meltdown-machinic/runs/2026-07-11…/labels-arthur-TODO.md` — calibration sheet gating prompt-v1 / Meltdown import / annotation waves.

## Known limits

- Dependency gating designed, not implemented (fail-open brief only).
- Enrichment prompt designed, not wired (queue rows carry CEDICT gloss only).
- No mobile/sync; review is desktop dashboard only (direction per VISION).
- Live ledger has 0 reading marks — first real signal arrives when Arthur reads a seeded/pasted chapter.
