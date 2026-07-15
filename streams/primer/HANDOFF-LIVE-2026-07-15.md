# Primer live handoff — 2026-07-15

Supersedes `HANDOFF-LIVE-2026-07-10.md` for live status. Read GOAL.md + VISION.md + INTENT.md after this. Doctrine layer: `PREFERENCES.md` (CEV backward frame, evidence ladder) landed 2026-07-14 via the system-overhaul session's PrimerDoctrineWriter; committed `5ddf0c4` with INTENT/LINEAGE updates.

## Where the stream is

Four sub-workstreams, current state:

1. **Chinese reading loop** (VISION §Sequencing 1) — skeleton shipped 2026-07-06; Arthur's scheduler directive SHIPPED 2026-07-15 (proof `docs/qa/primer-scheduler.md`): FSRS via ts-fsrs, priority = NEW-intro order only, append-only `review_events` per CARD-PROMOTION stage 8, same-headword interleave guard, word-select → priority push (`p`), graded session mode, promotion bridge (`primer review enroll <cardId>` — approval never auto-enrolls). **Playground layer SHIPPED same day** (proof `docs/qa/primer-playgrounds.md`): `#/pipeline` live-count spine map, `#/scheduler` X-ray (placement-explanation badges + FSRS trajectory simulator), `#/enrich` live prompt-v0 enrichment runs with per-field keep/cut/edit calibration labels, global `!` feedback dialog + interaction telemetry (append-only `feedback_events`/`ui_events`). Harvest Arthur's play sessions: `bun src/cli.ts feedback list --json` / `events tail --json`. 3 seeded zh docs live (ids 1-3, Rust By Example zh).
2. **Calibration gate (philosophy reader)** — prompt-v0 run `READER/experiments/meltdown-machinic/runs/2026-07-11T04-34-08-344Z-03383117/` still unlabeled by Arthur. Prompt-v1 remains design notes only, gated on the 10 acceptance questions. **In flight 2026-07-15:** `labels-arthur-TODO.md` sheet in the run dir so Arthur can answer inline in ~15 min. Gate outputs: prompt-v1 go, Meltdown staged import (45 cards) go/no-go, annotation-wave resume.
3. **Atlas of Inquiry** — PARKED by Arthur 2026-07-15 ("okay state, later"). State: DOM-card hybrid confirmed + implemented (reader commits `308798d`, `1303813`), typography-first, round-2 punch list partially done. Resume point: `research/inquiry-world/ATLAS-THREE-WORLD.md` §Iteration infrastructure (visual-regression states, specimen page, permalinks, corpus lint, feedback ledger).
4. **Card promotion / ledger** — `CARD-PROMOTION.md` contract is authoritative (8 stages, explanation ≠ review atom ≠ approval ≠ export ≠ scheduling). 370 `card_candidates` in ledger (HSK5). Stage 8 implemented 2026-07-15: promotion bridge enrolls approved cards into the ONE review stream (`item_kind='card_candidate'`); enrollment is explicit, never automatic on approval.

## Splitting across two orchestrator sessions (Arthur asked 2026-07-15)

Supported. Path-scoped ownership split; both stay inside the primer Owns set, coordinate via TASKS.md and this handoff:

- **Session A — product build**: owns `packages/primer-daemon/**` + daemon-facing docs. Lanes: Chinese loop/scheduler, promotion bridges, dashboard.
- **Session B — reading/annotation lab**: owns `streams/primer/wrapped-commentary-reader/**` (nested git repo, commits separately) + `experiments/`, annotation prompts, Atlas when unparked. Mostly Arthur-interactive; boot only when he wants a live reading/calibration companion.

Boot either with `streams/primer/boot.sh` and state the sub-scope in the first message. Rule: neither session edits the other's owned paths; shared docs (HANDOFF-LIVE, TASKS.md) are pull-before-edit.

## Operational

- Dashboard: `http://primer.localhost:1355` (restarted 2026-07-15, nohup from `packages/primer-daemon`, `bun run dev`).
- Talmudic reader: `http://meltdown.localhost:1355` — supervisor restarted 2026-07-15 (`cd READER && nohup bun scripts/dev-supervisor.mjs &`; PID file `data/meltdown-reader/dev-up.pid`; survives shell exit, not reboot).
- CEDICT built at `data/primer/cedict.sqlite` (30MB, with cjkvi IDS).
- READER is a nested git repo; outer repo gitignores it; commit separately, scope outer `git add` to primer paths.
- Model routing: resolve from the session overlay + `docs/fable/routing-doctrine.md`; never spawn Fable; never Terra (gpt-5.6-terra — Arthur, 2026-07-15).

## Next (priority order)

1. Gate + land the in-flight scheduler/UI/calibration slices (orchestrator gates: `cd packages/primer-daemon && bun run check`, browser QA via subagent, proof doc `docs/qa/primer-scheduler.md`, progress ledger entry).
2. Arthur: fill `labels-arthur-TODO.md` → prompt-v1 fork decision + Meltdown import go/no-go.
3. First real Chinese session: Arthur pastes a chapter, reads, pushes words — validates the loop with live data (metric: time-to-comprehension trending down).
4. Promotion bridge: enroll approved `card_candidates` into the review stream (`item_kind='card_candidate'`), per CARD-PROMOTION stages 5–8.
5. Atlas iteration infra (when unparked).
6. Deferred as before: knowledge-graph dependency gating, mobile sync, bulk annotation waves (behind calibration gate).
