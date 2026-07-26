# Harness lineage integration receipt — 2026-07-26

## Ancestry finding

`main` was `ttlznwvkuyty` / `f3139cb2ba11`. It was not an ancestor of any listed harness head: `jj log -r 'main & ancestors(LISTED_HEADS)'` returned the empty set. For every listed head, `jj log -r 'heads(ancestors(main) & ancestors(HEAD))'` returned the same merge-base, `xnvuspywkvrw` / `45fede40d4f2` (`docs(infra): garden JetKVM desktop recovery`). The histories therefore diverged; they were neither descendant nor unrelated.

The main-only side of that divergence was exactly, in order:

1. `npuukwsvrkxt` / `b47ada785571` — `fix(omp): isolate upstream launcher as omp-old`
2. `ttlznwvkuyty` / `f3139cb2ba11` — `fix(omp): block upstream self-update on fork command`

The common ancestor of all listed harness heads was `lroqtnlyznwk` / `20cf0e537656`. The deepest pre-existing verified harness point used as the first landing base was `xqwrqwpwttnu` / `07b0556d6418` (`harness-blitz-tip`). Its focused browser ownership/reclaim suite passed 3 tests, 0 failures, 63 expectations; coding-agent and AI `check:types` both exited 0.

## Chosen base and first landing

A merge, rather than cherry-picking leaf patches onto stale main, joined `xqwrqwpwttnu` and `ttlznwvkuyty`. This preserved both sides' existing change identities. The merge is `vysstlmsvtqq` / `12495ff80017`, `harness: unite trunk with harness lineage`.

The `.mise.toml` deletion from the harness lineage was retained rather than resurrecting the obsolete 449-line task file. The added `.omp/bin/omp-old` launcher remains. The `.omp/bin/omp` resolution preserves harness workstream multiplexing and main's upstream self-update block. Focused launcher proof: `bash -n .omp/bin/omp .omp/bin/omp-old`; `OMP_REAL=/usr/bin/true bash .omp/bin/omp update` exited 2; passthrough exited 0.

## Ordered integrated changes

Existing harness ancestry retained intact, ancestor-first:

1. `xspvwumuowqp/9569ed7289b9` — inherited multi-stream workspace intake
2. `qmrmlkuoxtno/99d91535c6c9` — migrate eligible automation to Nushell
3. `vpnrurxvowys/10e2fd46c568` — routing trial
4. `lroqtnlyznwk/20cf0e537656` — exocortex session artifacts
5. `mykssrrlpwpl/69ef5cfd4ecf` — VoiceInk registration
6. `pokszsrwvkwr/d1f29ae534b4` — VoiceInk backup proof
7. `mwvwnwwnszuv/f861dd2858ab` — pre-Nu remote-auth snapshot
8. `nllkllvwuntq/29a977d500cc` — remote-auth browser automation
9. `kwnwwtswrryo/94e5eb9443ec` — desktop browser automation skill
10. `tlmrxuonytuu/436aa338b8e8` — jj ownership policy
11. `owuukyqzmmky/da30210fb86d` — local disposability/promotion policy
12. `lzolwwpvmsqs/0425dc219156` — desktop browser architecture
13. `oztxlqnorkkt/a7ec1c895d5c` — worker reap/admission cancellation
14. `zpqmytylnkzm/7da23c1bbcba` — external IRC agent IDs
15. `twwqotkrupkl/f8832c988726` — bounded automation daemon
16. `vnptoqlkrkwl/423e9468d116` — stale lifecycle row retirement
17. `ypowwqrumrsl/21bea2b196f7` — owner-proof typing
18. `klkotkozxmpw/ca4b15372147` — child browser-tab release
19. `oymuqtmmwqyy/4189f14ab91b` — tiered host-memory reclaim
20. `xyrkprrrpqxo/7edfe079e5f8` — child re-adoption
21. `xrtzuvmqnrvy/ea01ec361adc` — bounded image restore
22. `lvvupnwkwvum/14b7be59420a` — bounded CPU profiling
23. `mmlwwqskqnom/1ad9d05bb98d` — process-tree memory attribution
24. `wntlrzxnpqtv/e60d2e90d21a` — live config defaults
25. `oquykmnsnqrk/ef5f1ef3c491` — newest compatible binary resume
26. `nptsslyrrwps/a35eb5017983` — config-root test isolation
27. `kxtmmtowwxkm/b96d4de32552` — host-scoped child admission
28. `wzmqrpsxtwos/52b0e3a8c6c2` — host memory budget
29. `pnpzrmztvkmx/fb5d503d5fca` — authoritative child journal delivery
30. `vxnworlopnpp/7b620a5e5fba` — subagent progress status
31. `yoyorxwpwulz/a88680c051d2` — process identity unification
32. `nysymqulqnty/d575e61f7c3c` — provider failure detail
33. `rouquoqmppmt/3edd21223d4f` — parent child-completion receipts
34. `ntsomkxwklmy/f9e02803f5a0` — owner-socket runner protocol
35. `ntwlmmrxrmqo/ef80140a0c93` — shared LSP clients
36. `wxknrqwsxrun/91badd04b684` — browser workstream groups
37. `usnyzxzszrsy/8e6aaec92a08` — idle-session reclaim
38. `tvnkyypoulrw/b54a7bf70416` — test/import baseline retirement
39. `xqwrqwpwttnu/07b0556d6418` — workstream tab ownership fence
40. `npuukwsvrkxt/b47ada785571` and `ttlznwvkuyty/f3139cb2ba11` — retained as the other parent of the lineage merge

## Excluded from this landing

The requester instructed the integration to wrap after completing the first verified landing. Consequently the remaining session tips were not rewritten or force-merged: `skyqtmrt`, `lvowwnyt`, `zupzwxov`, `nmmrwrnu -> ulsysvyz`, `wwuyxvul`, `kykzxomn`, `nzvvwyxw`, `vqqopsnn`, `qnnskttx`, `uyyrmqpo`, `ltxokyyn`, `tkuzrpsv`, `mtpvzwxw`, `mloznxmw`, `lytwvqvw/835542980966`, `wuxylmtv`, `znrulyrx -> lnlnmqrk`, `stssxsor/e7cef9b1`, and `wlzlpqmm`. They have no green union evidence on this merge and are excluded rather than asserted safe.

Proven duplicate losers remain excluded: `ruxxltns` (survivor `wlzlpqmm`), `nqzsksmo` (survivor `vqqopsnn`), `rxqzrmpm` (survivor `tkuzrpsv`), and `stssxsor/764449bc` (survivor `stssxsor/e7cef9b1`). Active `pzyxsmrz`, `uwornqxy`, `pzxymppy`, and `rvzlvzuk` remain excluded by ownership instruction. The nested cmux and separate dotfiles repositories were not touched.

## Union gates

Run from the sparse integration workspace after this receipt was written:

- `cd vendor/oh-my-pi/packages/coding-agent && bun run check:types`
  - `$ tsgo -p tsconfig.json --noEmit`
  - exit 0
- `cd vendor/oh-my-pi/packages/ai && bun run check:types`
  - `$ tsgo -p tsconfig.json --noEmit`
  - exit 0
- `HOME=\"$STATE/home\" OMP_IRC_DB=\"$STATE/irc.sqlite\" OMP_SESSION_CONTROL_DB=\"$STATE/control.sqlite\" OMP_FLEET_REGISTER=0 bun test test/tools/browser-child-tab-ownership.test.ts test/resource/host-reclaim.test.ts`
  - `3 pass`, `0 fail`, `63 expect() calls`; two files; exit 0
- `bash -n .omp/bin/omp .omp/bin/omp-old`
  - exit 0
- `OMP_REAL=/usr/bin/true bash .omp/bin/omp update`
  - printed the three-line fork self-update refusal and exited 2, as required
- `OMP_REAL=/usr/bin/true bash .omp/bin/omp --help`
  - exit 0
