---
description: "Fleet MORNING BRIEF: every workstream's state + the one global decision queue, from observer digests — one command, under 60 lines"
---

Produce the fleet-wide morning brief (design doc §7.3; rulings §9a.3/§9a.8 — on-demand surface, separate from the artifact feed, joined by the index).

1. Substrate, in this order — never excavate transcripts:
   - The compact fleet block below (harness-computed; if it shows a literal `$NAME`, fall back to `omp fleet overview --json`):

$FLEET_COMPACT

   - `local/state-docs/INDEX.md` then each listed state doc's L0/L1 only (the HR-199 observer maintains these; note staleness stamps).
   - Only if a decision-relevant doc is missing or stale beyond its stamp: `history://<session-id>` (read-only) for that one thread.
2. Output, fixed shape, UNDER 60 LINES total:
   - Header: date + counts (live sessions, workstreams, stale digests).
   - Section 1 — GLOBAL DECISION QUEUE: every pending ask/gate/ruling across ALL workstreams, ranked by what each unlocks; one line each + where to act. This section exists so I can act without reading further.
   - Section 2 — per workstream (one block each, ≤6 lines): status word, what moved since last brief, what's next, blockers. Skip untouched workstreams with a single "— quiet" line.
   - Section 3 — incidents: DEAD/STALLED sessions, version skew, rollout failures, error-log spikes. "— none" when clean.
   - Footer: index pointers only (INDEX.md path, artifact feed location) — the brief never inlines bulk.
3. Ground every claim in a doc, overview row, or history:// read you actually made. Stale digest → say stale, don't guess.

$ARGUMENTS
