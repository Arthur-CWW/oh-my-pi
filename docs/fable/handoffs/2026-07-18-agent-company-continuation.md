# Handoff: agent-company execution + harness continuation (2026-07-18)

## Provenance

- Predecessor: the 2026-07-17/18 overnight+day session (Fable Main, cwd `~/agents`, peer `agents-1gep50`), successor of `2026-07-17-hr164-overnight.md`.
- Written by the predecessor at handoff time; this doc is the live handoff — anything older is history.
- Binary at handoff: `16.0.1+fork.2f994a44a240` (blessed). Branch `main` at `69f460041`+.
- The full day's trail: register HR-165..HR-204, `git log --oneline` 2026-07-17..18, `streams/harness/migration/STATUS.md`.

## Read first, in order

1. `docs/fable/drafts/2026-07-18-agent-company-design.md` — THE plan (org model, state docs, error ladder, interfaces §8, execution order §7, Arthur's 10 open questions §9).
2. `docs/fable/drafts/2026-07-18-capability-architecture.md` — the four-layer model + HR-196 contract sketch (companion doc).
3. `docs/fable/harness-request-register.md` — rows HR-165..204 are this session's; HR-188/199..204 are HELD awaiting Arthur.
4. `local/fleet-triage/BRIEF-2026-07-17.md` — fleet triage (mostly still valid; ~10 real sessions).

## Hard gates (unchanged, all Arthur's)

- H1 contract approval → Effect port fan-out (trial exemplar on branch `hr164-h1-trial`, report `streams/harness/migration/notes/h1-trial-report.md`).
- H2 contract read (`CONTRACTS/h2-mailbox-park-revive.md`, 9 in-doc questions).
- Design-doc rulings: the 10 questions in agent-company §9 (includes Symphony-mode, delivery adapter target, dailies fusion).
- Catalog drift adoption: `local/catalog-sync/2026-07-18.md` (21 model additions incl. claude-opus-4.7/4.8-fast; models.json drift deliberately uncommitted).
- IMPLEMENTATION HOLD: Arthur's "don't implement this stuff yet" covers HR-188+204 (vim-lite/undo/paste — FIRST pickup when lifted) and HR-199..204. Lifting words: his rulings or "go".

## Queue once the hold lifts (design doc §7, verbatim order)

0. HR-188+204 vim-lite→core (undo + paste-across-modes correct; extension at `~/.omp/agent/extensions/vim-lite.ts` is the spec, NEVER edit ~/.omp; retirement steps reported for Arthur).
1. HR-198 global `history://<session-id>/<agent-id>` (read-only, sessions-index resolution).
2. HR-199 observer/summarizer (state docs per §8.5 shape, change-detection, label write-back).
3. Morning brief fleet-wide (`/brief` exists — `skills/fleet/thread-brief` + `.omp/commands/brief.md`; generalize per §7.3).
4. Report ladder v1 (`report_friction` + typed store + aggregation views).
5. HR-200 Kanban board (Symphony dispatch semantics per §8.2 if Arthur says yes to Q6).
6. HR-182B chief-of-staff thread. 7. HR-181 ownership claims + GC.

## Ground rules (proven this session — keep verbatim)

- Gate ritual per slice: stage exact files → `vendor/oh-my-pi/scripts/checkpoint-gate.sh -- <focused suites>` → commit with proof → `bun scripts/omp-promote.ts` when binary-affecting → register/STATUS flip. Workers never gate/git; coordinator does.
- Known gate-worktree limitations (pre-existing, documented in commits): session-runner live-shell specs, catalog package (cross-repo vendor/openai import), subprocess-spawning tests — prove those on the live tree; when staging non-coding-agent packages, run `bun --cwd=packages/coding-agent run generate` inside the gate command.
- `agent-session.ts` protected ranges (~2691–2727, 6086–6104, 7040–7440, 8249–8290) sign-off-only. Check every hunk.
- Test isolation LAW: tmpdir HOME + `OMP_SESSION_CONTROL_DB` + injected `IrcExternalBus(dbPath)`; `externalIrcBus` into every test AgentSession (pattern: test/agent-session-handoff.test.ts). One leak polluted the machine roster for every session — do not repeat.
- Routing: gpt-5.6 burn directive expires ~2026-07-18 evening (docs/state/model-availability.md); after that, Sol high = load-bearing, Luna xhigh = bounded; Opus 4.6 NEVER for important work (tier A), cross-family review only; Kimi RETIRED (sub stopped, do not retry); never Terra; never claude via antigravity/gcp (policy journal txn `4c79ef3f` enforces at routing).
- Quota admission is DISABLED in `.omp/config.yml` (dated comment) pending HR-183 — re-enable when it lands. Worker request caps kill big finishers at ~120 requests: size packets 1-2 files, use the finisher pattern on cancellation (check the tree first — twice tonight the work was COMPLETE, just unreported).
- Silence ≠ death: before respawning any worker, check git status + its transcript (`history://<id>`).
- Register discipline: every Arthur ask gets an HR row with his words as provenance; ids — CHECK FOR COLLISIONS across all sections first (tonight's 173-177 collided with old rows; renumbered 190-194; pre-existing HR-149 duplicate still unadjudicated).

## Live loose ends

- `agents-ndnvmf` (ADB thread): holds Arthur's iOS/relay questions; wedged state command clears on its next `/restart`.
- `agents-jx58zj`: broken twitter-sync tick (bun not found, every 45min) — Arthur to kill or fix; legacy binary, rollouts skip it.
- Trial branch `hr164-h1-trial` + worktree `local/hr164-trial` (keep until Arthur's H1 verdict; HR-191 touched spawn-worker-client.ts on main — rebase needed if the branch merges).
- HR-180 overview arg-validation small fix still owed (Sol review finding #5, deferred behind commands/fleet.ts contention — now free).
- Rollout bootstrap lag: the first promote of the next session rolls with the HR-179 skip logic; expect it to finally complete cleanly.

## What the successor should do first

1. `goal create` workstream harness, objective: "Execute the agent-company plan (drafts/2026-07-18-agent-company-design.md §7) and the held register queue as Arthur's rulings unlock them; keep gating and promoting per the ritual."
2. Give Arthur the AWAY-BRIEF (`/brief` schema): the §9 questions + hard gates ARE his decision queue.
3. On "go" or rulings: execute §7 in order, fan out per the packet discipline above.
