# Proof — Primer playground layer: pipeline map, scheduler X-ray, enrichment playground, feedback/telemetry (2026-07-15)

Review contract for the interaction/vibe-check wave over the Chinese loop. All at `http://primer.localhost:1355`. Stack unchanged: React 19 + Tailwind 4 + shadcn-style/Radix, vim keys, no chart libraries (hand-rolled SVG/CSS).

## Surfaces

- **`#/pipeline`** — the spine as connected stage cards with live counts (docs → marks → queue strata → enrich → review → events), click-through to each surface; latest feedback + recent ui-events tail below ("what Arthur did" panel).
- **`#/scheduler`** — scheduler X-ray: next-session preview strip where every item carries **explanation badges** (overdue delta / priority jump / interleave shift — visual proof the ordering logic is right); queue strata bars; **FSRS trajectory simulator** (grade keys 1-4 + presets build a sequence, interval bars grow per ts-fsrs — feel what `again` vs `easy` does); recent review-events tail.
- **`#/enrich`** — enrichment playground: pick a queued word → live prompt-v0 run on the cheap lane (`PRIMER_ENRICH_MODEL`, forbidden-model guard, ~13s) → visual render (sense disambiguation with source-quote highlight, coverage-colored example tokens, review-target badge, self-audit stats, collapsible raw JSON) → **per-field keep/cut/edit labels** persisted as `enrichment_labels` — this is the first-10 calibration instrument from `streams/primer/experiments/queue-enrichment/intent-brief.md` (counter in header).
- **Feedback + telemetry (global)** — `!` on any surface opens verdict (good/wrong/confusing/idea) + note with auto-captured route context → `feedback_events`. Interaction telemetry (nav, word_lookup, priority_push, triage_status, session_grade, session_complete, feedback_submitted) batches to `ui_events` every 5s + on tab hide (sendBeacon).

## Feedback harvest (how the agent reads Arthur's play sessions)

```bash
cd packages/primer-daemon
bun src/cli.ts feedback list --json     # explicit verdicts + notes with route context
bun src/cli.ts events tail --json       # interaction telemetry
curl -s http://primer.localhost:1355/api/pipeline/stats
```

## API added

`POST/GET /api/feedback`, `POST/GET /api/events`, `GET /api/pipeline/stats`, `GET /api/review/session?explain=1` (placement reasons), `POST /api/review/simulate`, `GET /api/review/events`, `POST /api/enrich/:queueItemId`, `GET /api/enrichments`, `POST /api/enrichments/:id/labels`. New tables (append-only): `feedback_events`, `ui_events`, `enrichments`, `enrichment_labels`.

## Evidence

- Gate: `bun run check` → **140 tests / 485 expects, 0 fail**, tsc + web build clean.
- Isolated browser QA, two passes (`local/primer-playground-qa/REPORT.md` + screenshots): pipeline counts/click-through PASS; feedback dialog → API row with route context PASS; telemetry kinds observed after play PASS; scheduler preview badges + monotonic FSRS simulator + events tail PASS; enrich stored render + labels persisted (2/10 counter) + one live enrichment (文件, ok) PASS. Zero console/page/backend errors both passes; live instance untouched (isolated `PRIMER_LEDGER_DB` copies, teardown verified 502).
- Live smoke on the real instance: `/api/pipeline/stats` serving (3 docs, 8 queued, 1 enrichment at ship time).

## Rerun

```bash
cd packages/primer-daemon && bun run check
open http://primer.localhost:1355/#/pipeline   # then ! for feedback, #/scheduler, #/enrich
```

## Known limits

- Enrichment runs one item per click (no batch — deliberate until first-10 calibration labels exist).
- Telemetry is client-batched; a hard browser kill can drop ≤5s of events.
- Simulator models a fresh card only (no per-item parameter replay).
