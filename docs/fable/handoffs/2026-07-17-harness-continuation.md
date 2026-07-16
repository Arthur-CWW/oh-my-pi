# Handoff: harness continuation (2026-07-17)

**From**: Main session `019f6446-20de` (Fable orchestrator, ~36h run). **Read order for the successor**: this file → `docs/fable/handoffs/2026-07-16-overnight-harness-goal.md` (detailed wave-by-wave ledger) → `git log --oneline -25` → `omp fleet status`.

## Ground state
- HEAD `bae1926df`+; **blessed `16.0.1+fork.b97c2a1cb3c0`** (digest b4f0e59d…). Working tree may carry LabelCopyFix's in-flight edits (see below). Everything else is committed and promoted.
- ~30 commits landed 07-15→07-17 covering HR-113/121/122/124/125/126/127/128/129(s1+s2)/130/132/135/136/139/140/141/142/143/144/146/147/149/150/151/152/156 + fleet dogfood closure (live rollout proven, incl. automatic bridged-session upgrades during promote).
- Register (`docs/fable/harness-request-register.md`) is the authority on every row's status + evidence. TASKS.md T-2026-07-11-001 points at the ledgers.

## In flight RIGHT NOW
- **LabelCopyFix** (HR-158: fuse effort suffix `OX5.6solh`, effort on every row incl. cursor row, consistent segment colors, vim-`c`/`C` system-clipboard copy). Spawned from the OLD session — a new session cannot adopt it. Salvage protocol: check `git status` for its edits (model-selector-abbreviation.ts, agent-hub key/copy paths, tests) and its yield in `~/.omp/agent/sessions/-agents/2026-07-15T05-35-45-374Z_019f6446-*/LabelCopyFix.jsonl` (yields survive even when the wall-clock kills the report — this is ROUTINE, see death modes below). Gate: model-selector-abbreviation + agent-hub key/copy suites + check:types both packages, then checkpoint+promote.

## Next-wave queue (priority order)
1. **HR-158** finish/gate (above).
2. **HR-026 detach survival implementation** — design B approved-by-evidence (`docs/fable/drafts/2026-07-16-detach-survival-design.md`): per-session runner daemon + disposable view clients; the in-process seam is proven insufficient. Biggest slice; Arthur's tab-close pain.
3. **HR-148 slice 2** — migrate `:tools` + Agent Hub onto `TablePreviewComponent`; remove transcript history-dumping per the inventory in `local/hr148-scout-packet.json`.
4. **HR-153 / HR-155 v1** — context surgery + stream categorization; decision-ready designs in `docs/fable/drafts/` — **get Arthur's read first**.
5. **HR-137** (/restart reexecs stale execPath — blocks manual upgrades), **HR-138** (idle peers drop from roster ~40min; also behind the dotfiles-9yuh4d rollout recovery timeout), **HR-157** (8 pre-existing tui timing tests), **HR-152** preview-effort verify (subsumed by HR-158 likely).
6. HR-129 slices 3-5 (Control Plane UI, full YAML cutover), HR-145 Scope slices (opportunistic), HR-133 paging (needs Arthur's direction from the probe), HR-134→133 follow-ons.

## Operating knowledge the successor MUST have
- **Worker death modes (all routine, none lose work)**: (1) subprocess wall-clock fires AFTER yield — salvage the yield from the child's jsonl in this session's dir; (2) parked agents are unreachable ("no reviver registered") and REVIVED-from-park agents lose write tools on pre-dc0a754e binaries — spawn fresh instead; (3) yield reports get swallowed — silence ≠ death, check `git status` + journals before respawning (I duplicated a live worker once; cost a 3-way collision).
- **Fresh binaries only via fresh `omp` launch** (HR-137): /restart reexecs the old image.
- **Test isolation law**: inject `IrcExternalBus(dbPath)` + `OMP_SESSION_CONTROL_DB` under tmpdirs; HOME-swap alone leaks the global bus singleton (pattern: test/task/park-revive-followup.test.ts). Leaked peers = gate failure; purge with targeted sqlite deletes.
- **Protected regions**: agent-session.ts durable-input/abort (~2691-2727, 6086-6104, 7040-7440, 8249-8290) — surgical, sign-off required.
- **Gates**: focused suites only per slice; coordinator runs union + `scripts/checkpoint-gate.sh` (staged-snapshot) before every commit; `bun scripts/omp-promote.ts` after (retries on the lockfile are normal). Spawn timeoutSec 3600 minimum on Sol lane; codex ran ~15 tok/s all day.
- **Routing posture**: Sol = synthesis/lifecycle/architecture; Luna xhigh = bounded; Kimi approved by Arthur but quota-gated; never Terra; spawn with `agent: "implementer"` (task = deprecated alias). Responsibility templates + policy journal routing are LIVE (your own spawns exercise HR-122/129).
- **Arthur's UX doctrine** (recurring, apply to any TUI work): compress proportional to information density; never below legibility (no single-letter variants); semantic elements get hierarchy and/or color; no decorative spacers; views are screens/overlays, never transcript dumps; Esc dismisses, Ctrl-Q interrupts; vim semantics everywhere.
- **Register discipline**: every new ask gets an HR row before/with implementation; receipts with file:line + test counts on flip; checkpoint reference per D-010.

## Fleet notes
- Rollout is production-real: promote runs a wave; bridged idle sessions upgrade automatically; failures are typed and bounded. Old canaries: ws:22 (668, bootstrap-legacy specimen), session 019f66bf (cmux ws:fleet-canary-2d68) — the live-proof canary, reusable.
- `omp doctor` for hygiene (peer prune, dead locks, orphan kernels); `omp fleet errors` for the ErrorInbox ledger.
