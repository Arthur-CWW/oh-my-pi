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

The pre-existing ancestry from `xnvuspywkvrw` through `xqwrqwpwttnu`, plus the two old-main commits on the merge's other parent, remains intact. No leaf copy replaced those identities.

## Excluded with evidence

- `nmmrwrnu` — excluded. `provider-policy-cli.test.ts` reproducibly failed: 6 passed, 1 failed; the expected drift row (`appliedSequence: 1`, `headSequence: 2`) was `[]`.
- `ulsysvyz` — excluded with its mandatory parent pair because `nmmrwrnu` was not green. Therefore no partial YAML calibration was landed; the main `.omp/*.yml` files remain the prior verified configuration rather than a half-applied pair.
- `zupzwxov` — excluded. On the actual `main + wuxylmtv` parent, the focused run ended 5 passed, 2 failed, 2 import errors: `codex-expiry-reset.ts` could not resolve `../config/atomic-config-writer`.
- `znrulyrx` — excluded. The control-plane suite ended 15 passed, 17 failed, 17 import errors; `src/outbox.ts` could not resolve `./relay-schema`, and the package also lacked required `http-api`/`drizzle-orm` resolution on this lineage.
- `lnlnmqrk` — excluded with its required `znrulyrx` parent because the storage-bound foundation was not green.
- `skyqtmrt` — excluded. The focused child/history suite reproducibly ended 27 passed, 1 failed; `history://NeverReserved` produced `no such table: peers` instead of `Unknown agent: NeverReserved` under isolated HOME/control state.
- `lvowwnyt` — excluded. Both changed paths (`catalog/remote-workspaces.yml`, `scripts/remote-workspace.nu`) were deletion conflicts because its required remote-routing foundation had not yet landed at its prescribed position; resolving it there would have silently imported `ltxokyyn` under the wrong identity.
- `wlzlpqmm` — excluded. Its four-way union resolution failed coding-agent `check:types`: `agent-session.ts(12410,6)` supplied `audience`, but the rebased `IrcExternalBus.sendMessage` input no longer accepted that field. Landing it would delete the sibling audience-boundary behavior.
- Duplicate losers remain excluded: `ruxxltns` (survivor `wlzlpqmm`), `nqzsksmo` (survivor `vqqopsnn`), `rxqzrmpm` (survivor `tkuzrpsv`), and `stssxsor/764449bc` (survivor `stssxsor/e7cef9b1`).
- Active-owner exclusions remain untouched: `uwornqxy`, `pzxymppy`, and `rvzlvzuk`.
- The nested cmux and separate dotfiles repositories were not touched. No push and no deploy occurred.

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
- Thirteen isolated `bun test` invocations covering all 27 focused coding-agent files touched by the integrated changes, each with a fresh HOME and session-control database
  - 218 passed, 0 failed, 846 expectations
  - exit 0
- `cd packages/fleet-sync && bun test ./test/fleet-sync.test.ts`
  - 5 passed, 0 failed, 30 expectations
  - exit 0
- `nu scripts/remote-workspace.test.nu && nu scripts/remote-routing.test.nu`
  - `remote routing inspection and synchronization boundary checks passed`
  - `remote routing projection and atomic publish checks passed`
  - exit 0
