# Primer live handoff — 2026-07-15

Supersedes `HANDOFF-LIVE-2026-07-10.md` for live status. Read GOAL.md + VISION.md + INTENT.md after this. Doctrine layer: `PREFERENCES.md` (CEV backward frame, evidence ladder) landed 2026-07-14 via the system-overhaul session's PrimerDoctrineWriter; committed `5ddf0c4` with INTENT/LINEAGE updates.

## Where the stream is

Four sub-workstreams, current state:

1. **Chinese reading loop** (VISION §Sequencing 1) — skeleton shipped 2026-07-06; Arthur's scheduler directive SHIPPED 2026-07-15 (proof `docs/qa/primer-scheduler.md`): FSRS via ts-fsrs, priority = NEW-intro order only, append-only `review_events` per CARD-PROMOTION stage 8, same-headword interleave guard, word-select → priority push (`p`), graded session mode, promotion bridge (`primer review enroll <cardId>` — approval never auto-enrolls). **Playground layer SHIPPED same day** (proof `docs/qa/primer-playgrounds.md`): `#/pipeline` live-count spine map, `#/scheduler` X-ray (placement-explanation badges + FSRS trajectory simulator), `#/enrich` live prompt-v0 enrichment runs with per-field keep/cut/edit calibration labels, global `!` feedback dialog + interaction telemetry (append-only `feedback_events`/`ui_events`). Harvest Arthur's play sessions: `bun src/cli.ts feedback list --json` / `events tail --json`. 3 seeded zh docs live (ids 1-3, Rust By Example zh).
1b. **Media reader + video pipeline + zh-zh dictionary SHIPPED 2026-07-16** (proof `docs/qa/primer-media-reader.md`): docs carry char-aligned audio/video (alignment contract shared with shadowing; `primer media import`); click-char-resumes-playback reader per `experiments/media-reader-ux/control-grammar.md` (visual confidence never exceeds data confidence); pilot 大耳朵图图 S2E15 = doc 42 (bilibili → yt-dlp → ai-zh subs → Qwen aligner w/ char-identity validation, driver `scripts/align-media.py`); word popup is now monolingual `ZhDictCard` (`/api/zhdict/:word`, graded 例句, cached simple-zh 释义/近义词, EN collapsed). Corpus through doc 48 (Liang complete sweep incl. 金牛奖 2019, CEO manifestos, drama = 庆余年). Old apps still parallel-parked at `https://hsk-reader.localhost`/`https://mochi-lite.localhost`.
2. **Calibration gate (philosophy reader)** — prompt-v0 run `READER/experiments/meltdown-machinic/runs/2026-07-11T04-34-08-344Z-03383117/` still unlabeled by Arthur. Prompt-v1 remains design notes only, gated on the 10 acceptance questions. **In flight 2026-07-15:** `labels-arthur-TODO.md` sheet in the run dir so Arthur can answer inline in ~15 min. Gate outputs: prompt-v1 go, Meltdown staged import (45 cards) go/no-go, annotation-wave resume.
3. **Atlas of Inquiry** — PARKED by Arthur 2026-07-15 ("okay state, later"). State: DOM-card hybrid confirmed + implemented (reader commits `308798d`, `1303813`), typography-first, round-2 punch list partially done. Resume point: `research/inquiry-world/ATLAS-THREE-WORLD.md` §Iteration infrastructure (visual-regression states, specimen page, permalinks, corpus lint, feedback ledger).
4. **Card promotion / ledger** — `CARD-PROMOTION.md` contract is authoritative (8 stages, explanation ≠ review atom ≠ approval ≠ export ≠ scheduling). 370 `card_candidates` in ledger (HSK5). Stage 8 implemented 2026-07-15: promotion bridge enrolls approved cards into the ONE review stream (`item_kind='card_candidate'`); enrollment is explicit, never automatic on approval.

## Stema and social-source continuation — 2026-07-16

Stema replaced Borges Library at `packages/stema`. It is the shared, provenance-preserving corpus substrate: content-addressed originals, SQLite-backed staged jobs with fenced renewable leases, native PDF Markdown/page derivatives, capability-ranked local/Tailscale/remote processors, immutable Primer manifests, one typed CLI/tool, and a long-lived daemon. Durable rationale:

- `packages/stema/README.md`
- `packages/stema/docs/design-principles.md` — name/background, non-functional goals, scope, ownership
- `packages/stema/docs/architecture.md` — agreed architecture and operational model
- `packages/stema/skills/stema/SKILL.md`

Verification observed in the implementation session: `cd packages/stema && bun run check` passed 13 tests / 151 assertions with TypeScript clean; a live BERT `stema add … --wait` selected the correct arXiv work and completed acquisition, native derivative, and Primer publication.

### Twitter/social adapter handoff

Do not migrate `packages/twitter-archive` into Stema immediately. Improve its existing SQLite and proven capture lanes first, then expose a typed snapshot/publication adapter to Stema. Shared substrate later; tweets keep their own account/post/conversation/bookmark/list domain.

The originating synthesis and exact sync gap are in `docs/research/power-posting-sources/pleorama-synthesis.md` § “Sync-improvement requirements.” Key requirements:

1. Preserve source verbatim; summaries are navigation only.
2. Capture conversations, including target-authored replies in other accounts' threads and worthwhile interlocutor branches around target posts.
3. Model three separate things:
   - **relationship prior**: ambient followed → repeatedly attended/bookmarked/read → explicit requested → canonical source;
   - **purpose lists**: why the account matters, with multi-membership and provenance;
   - **capture contract**: bounded timeline, authored-reply path, full branch, or full historical/conversation sync.
4. Manual intent outranks inference. A follow is a low prior; explicit sync, high regard, repeated reading/liking/saving, bookmarks, and list placement are stronger evidence. Persist the generator, timestamp, scope, and provenance rather than a bare score.
5. Conversation expansion:
   - unknown/unfollowed interlocutor → target-authored path only;
   - followed/ambient → surrounding branch;
   - watched or purpose-listed → full branch;
   - canonical/explicit thread request → full conversation.
   Store the reason: `followed-interlocutor`, `shared-purpose-list`, `bookmarked-root`, `repeated-attention`, `explicit-thread-request`, or `canonical-source-policy`.
6. Capture Arthur's following list through the existing supervised read-only lane. Replies between followed people are lower-prior but valuable. Purpose lists must become first-class list/membership records, not only `interaction_signals.listId`.
7. Normalize conversations in existing Twitter SQLite: conversation row/root/status plus reply edges/participant position, and attach capture scope/reason to durable jobs.
8. Drain the 135 pending bookmark status jobs; then re-run `baudrillard|simulacr|hyperreal|debord|spectacle|girard|lacan|mcluhan|mimesis` and refresh `pleometric-meta-index.md` + `pleo-reader/`.

Evidence-backed source inventory from Playground:

- canonical/full-sync current example: `pleometric`;
- theoryposting: `teortaxesTex`, `repligate`, `xenocosmography`, `tszzl`/roon, `lumpenspace`, `tenobrus`, `apralky`, `doomslide`;
- visual/persona: `pleometric`, `abelian_soup`, `SkyeSharkie`, `poetengineer__`;
- artist/engineer bridge: `voooooogel`;
- norvid sphere seed: `norvid_studies`, `medjedowo`, overlapping with `voooooogel` and `abelian_soup`.

These are purpose-list seeds, not proof that Arthur currently follows every account or wants every one fully synced. Actual following/list membership and golden status must come from explicit Arthur input or authenticated observed signals. Current archive evidence: 666 Pleometric rows, only 11 conversation IDs, one complete thread, and 655 rows without conversation identity.

Operational constraints: existing SQLite remains authoritative; use low-concurrency Nitter detail capture with jitter and durable resume; stop cleanly on the second 429; authenticated bookmark/following ingest remains a narrow supervised read-only exception and does not weaken the global public-only or no-mutation policy.

## Splitting across two orchestrator sessions (Arthur asked 2026-07-15)

Supported. Path-scoped ownership split; both stay inside the primer Owns set, coordinate via TASKS.md and this handoff:

- **Session A — product build**: owns `packages/primer-daemon/**` + daemon-facing docs. Lanes: Chinese loop/scheduler, promotion bridges, dashboard.
- **Session B — reading/annotation lab**: owns `streams/primer/wrapped-commentary-reader/**` (nested git repo, commits separately) + `experiments/`, annotation prompts, Atlas when unparked. Mostly Arthur-interactive; boot only when he wants a live reading/calibration companion.

Boot either with `streams/primer/boot.sh` and state the sub-scope in the first message. Rule: neither session edits the other's owned paths; shared docs (HANDOFF-LIVE, TASKS.md) are pull-before-edit.

## Operational

- Dashboard: `https://primer.localhost` (restarted 2026-07-15, supervised by `mise run up primer` with service `primer-daemon`).
- Talmudic reader: `https://meltdown.localhost` — supervisor managed by `mise run up primer` (`cd streams/primer/wrapped-commentary-reader && bun run dev:up`); PID file `data/meltdown-reader/dev-up.pid`; survives shell exit, not reboot.
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
