# Harness lineage integration receipt — 2026-07-26

## Ancestry finding

The old `main` was `ttlznwvkuyty` / `f3139cb2ba11`. It was **not** an ancestor of any listed harness head: `jj log -r 'main & ancestors(LISTED_HEADS)'` returned the empty set. For every listed head, `jj log -r 'heads(ancestors(main) & ancestors(HEAD))'` returned `xnvuspywkvrw` / `45fede40d4f2` (`docs(infra): garden JetKVM desktop recovery`). The histories therefore diverged; they were not unrelated.

The old-main-only side was exactly:

1. `npuukwsvrkxt` / `b47ada785571` — `fix(omp): isolate upstream launcher as omp-old`
2. `ttlznwvkuyty` / `f3139cb2ba11` — `fix(omp): block upstream self-update on fork command`

The common ancestor of every listed harness head was `lroqtnlyznwk` / `20cf0e537656`. The deepest shared harness point selected for the first landing was `xqwrqwpwttnu` / `07b0556d6418` (`harness-blitz-tip`). Its coding-agent and AI typechecks exited 0; its focused ownership/reclaim suite passed 3 tests, 0 failures, 63 expectations.

## Integration base

`vysstlmsvtqq` / `12495ff80017` merged `xqwrqwpwttnu/07b0556d6418` with `ttlznwvkuyty/f3139cb2ba11`. This preserved both sides' existing change identities instead of cherry-picking leaves onto stale main.

The merge retained the harness deletion of obsolete `.mise.toml`, kept `.omp/bin/omp-old`, and combined workstream multiplexing in `.omp/bin/omp` with the fork self-update refusal. Shell proof: both launchers passed `bash -n`; `OMP_REAL=/usr/bin/true bash .omp/bin/omp update` exited 2 with the fork refusal; normal passthrough exited 0.

## Integrated session changes after the base

Ancestor-first, each identity preserved:

1. `wuxylmtvksvl` / `c773783ec29e` — show usage reset deadlines
2. `koxrsktltmys` / `7ce3e572e6bb` — IRC inbound-message hygiene; inserted as the missing foundation required by provider recovery (18 focused tests passed)
3. `mtpvzwxwsxqz` / `d57eb5316a08` — resume children after provider recovery
4. `mloznxmwttrl` / `768ca00c74c5` — make ownership loss terminal-safe
5. `stssxsorqtou` / `4ccccfb40e71` — recover provider refusals automatically
6. `lytwvqvwzxvo` / `d74f74ebdbcb` — repair refused prompt context safely
7. `vqqopsnnwnlx` / `3ef9c75aaf58` — stall-reporting identity retained as an empty change because the landing base already contained the superseding HUD implementation
8. `wwuyxvulslnq` / `bfed6cacda99` — parse history URL selectors
9. `kykzxomnnpsz` / `00ccf87864f1` — advertise executable task capabilities
10. `nzvvwyxwspts` / `70fea8bb3241` — close tool issue reports
11. `tkuzrpsvvzzn` / `84210f3c5bb2` — finish local view over remote engine
12. `uyyrmqpoxovt` / `e0001a821cbb` — periodic fleet state replication
13. `ltxokyyntrsl` / `c860ef3776d5` — inspect and sync remote routing safely
14. `qnnskttxrowx` / `e59b3808cfc1` — derive host resource admission dynamically
15. `pzyxsmrzuvqp` / `c42309335cba` — bound and reclaim durable control-plane outboxes; canonical reviewed head `c4f412c16fb0` rebased onto the verified union tip, retaining all seven newly tracked sources required by `index.ts`
16. `nmmrwrnuutur` / `7edacc24d46d` — enforce exact responsibility routes; its earlier false red was caused by disabling real fleet registration in the test process
17. `ulsysvyzulll` / `7a612258e865` — calibrate all 12 explicit responsibility routes: Luna 5.6 medium for quick task/explore/librarian/reviewer/QA/task, Sol 5.6 medium for plan/implementer/oracle/operator/synthesizer, and Opus 5 medium for designer; no high/xhigh default
18. `skyqtmrtxpqn` / `1539e5a04366` — resume interrupted subagents in place; the integration also treats a schema-less optional fleet index as absent instead of leaking SQLite's `no such table`
19. `tzpkrnzttmwm` / `2f6e9105a332` — ENOSPC-safe atomic config writes, the required foundation for reset redemption
20. `zupzwxovtkvq` / `2d78c9708681` — report and salvage expiring Codex reset credits
21. `znrulyrxqlxy` / `9dd9a9fc49af` — bound control-plane storage; reviewed outbox implementations win overlapping files while this identity adds the cold tier, daemon, CLI, and launchd policy
22. `lnlnmqrkpxxl` / `a92e6332d53c` — guard heavy work under disk pressure
23. `lvowwnytwqzm` / `4cdd8b89d58d` — coalesce remote tmux workstreams natively; routing proof was updated to the required Opus 5 calibrated route
24. `wlzlpqmmprwt` / `d870c8492ab5` — Majordomo directory and fenced migration control; preserves both IRC direct-audience hygiene and host identity
25. `pzxymppyxtmm` / `b2978574b582` — Agent Hub panel focus, chord coverage, effort rendering, and `g i` route explanations; reconciled to mandatory explicit-effort routing and current model-context metadata
26. `rvzlvzukkpsw` / `a8bc441e1378` — externalize the shared release registry and untrack 113 duplicate payload/receipt files without deleting the five existing 5.83 GiB on-disk copies

The pre-existing ancestry from `xnvuspywkvrw` through `xqwrqwpwttnu`, plus the two old-main commits on the merge's other parent, remains intact. No leaf copy replaced those identities.

## Excluded with evidence

All six previously blocked priority units are now integrated and green. Their earlier failures were traced to omitted lineage foundations, intentionally disabled fleet registration in tests that exercise registration, or stale routing expectations—not accepted as permanent exclusions.
- Duplicate losers remain excluded: `ruxxltns` (survivor `wlzlpqmm`), `nqzsksmo` (survivor `vqqopsnn`), `rxqzrmpm` (survivor `tkuzrpsv`), and `stssxsor/764449bc` (survivor `stssxsor/e7cef9b1`).
- Active-owner exclusion remains untouched: `uwornqxy`.
- The nested cmux and separate dotfiles repositories were not touched. No remote push or deployment occurred; only the requested local OMP bless/rollout path ran.

## Final union gates

This receipt was written before the final union run. Observed commands and output:

- `cd vendor/oh-my-pi/packages/coding-agent && bun run check:types`
  - `$ tsgo -p tsconfig.json --noEmit`
  - exit 0
- `cd vendor/oh-my-pi/packages/ai && bun run check:types`
  - `$ tsgo -p tsconfig.json --noEmit`
  - exit 0
- `cd packages/control-plane && bun run typecheck`
  - `$ tsc --noEmit`
  - exit 0
- With `HOME`, `TMPDIR`, `AGENT_CONTROL_PLANE_OUTBOX_DIR`, `AGENT_CONTROL_PLANE_RAW_DIR`, and `OMP_SESSION_CONTROL_DB` under one fresh package-local directory: `bun test ./test/ingest-raw-reference.test.ts ./test/ingest.test.ts ./test/omp-publisher.test.ts ./test/outbox-limits.test.ts ./test/outbox-migrate.test.ts ./test/outbox-retention.test.ts ./test/publisher-ingest.test.ts ./test/raw-capture.test.ts ./test/storage.test.ts`
  - 45 passed, 0 failed, 286 expectations
  - exit 0
- Thirteen isolated legacy-focused coding-agent invocations covering the 27 pre-wave-3 files, each with fresh HOME/TMPDIR/session-control state. Task-spawn fixtures set test-only low disk thresholds so the real 17 GiB host guard does not mask the behavior under test.
  - 219 passed, 0 failed, 852 expectations
  - exit 0
- Routing enforcement group: responsibility enforcement, route resolution, spawn receipts, Agent Hub provenance, and policy CLI
  - 54 passed, 0 failed, 275 expectations
  - exit 0
- Config durability group: atomic writer and live reload
  - 8 passed, 0 failed, 38 expectations
  - exit 0
- Codex reset automation group in coding-agent
  - 41 passed, 0 failed, 85 expectations
  - exit 0
- `cd packages/ai && bun test ./test/auth-storage-reset-expiry.test.ts`
  - 2 passed, 0 failed, 6 expectations
  - exit 0
- Disk-pressure guard with production defaults
  - 6 passed, 0 failed, 24 expectations
  - exit 0
- Child resume plus history routing
  - 29 passed, 0 failed, 135 expectations
  - exit 0
- Majordomo migration core plus session directory
  - 14 passed, 0 failed, 57 expectations
  - exit 0
- Agent Hub interaction contract, key grammar, route provenance/inspector, HUD, dual-lane, activation, and model-selector effort rendering
  - 68 passed, 0 failed, 447 expectations
  - exit 0
- Release registry/storage path and link-OMP boundary tests
  - 11 passed, 0 failed, 130 expectations
  - exit 0
- `cd packages/fleet-sync && bun test ./test/fleet-sync.test.ts`
  - 5 passed, 0 failed, 30 expectations
  - exit 0
- `nu scripts/remote-workspace.test.nu && nu scripts/remote-routing.test.nu`
  - `remote routing inspection and synchronization boundary checks passed`
  - `remote routing projection and atomic publish checks passed`
  - exit 0

## Local promotion

The parity-only first attempt correctly returned `no new commits`, but the installed artifact's command list lacked `omp disk`; source-tree parity was therefore insufficient artifact evidence. The promotion path gained an explicit, tested `--force` control (18 tests, 0 failures, 43 expectations) and rebuilt from the verified tip.

First forced bless before the final release-storage landing:

- version `16.0.1+fork.bd213ec5eccc`
- digest `328c11ffc0107d0e6adffb67207dd28bce56869ea4a7f4b89edc631ccec5ccf8`
- readiness receipt digest `1e1ee34d8f2227c37f77800af791113ca33707c84ce2424590c5bc13ae092f57`
- rollout: 2 restarted, 19 skipped (13 unresponsive, 5 legacy), 0 remaining

The final release-storage-tip promotion (`9ef678d34399`) completed install, generation, typecheck, native build, link tests, and bundle, then stopped safely at candidate install:

`link-omp: immutable releases is workspace-local state; run 'omp workspace storage migrate --dry-run' before linking`

The requested dry-run completed against `/Users/arthur/agents` and produced guarded migration/rollback commands (plan digest `b7baa5b18adfd0cf44ba022363607bc70a7f51e67e55d7c522acaaa16cea41fa`). No migration command ran and the five 5.83 GiB copies remain untouched. The active blessed build therefore remains `16.0.1+fork.bd213ec5eccc` / `328c11ffc0107d0e6adffb67207dd28bce56869ea4a7f4b89edc631ccec5ccf8`; `omp --help` confirms that this running artifact contains `disk` and the landed resume/routing command surface. Only the release-storage landing itself awaits reviewed execution of its generated migration plan before it can be blessed.
