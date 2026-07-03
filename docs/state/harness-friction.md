# Harness friction log

Running ledger of OMP/harness papercuts and maintenance tasks. Any session may append; the harness stream batches fixes. Format: date · status · entry.

## Open

- 2026-07-03 · open · **Role-indirection opacity.** Agent file → role → role → guard → fallback chains are invisible at spawn time; nobody can tell what model a lane resolves to without reading the child JSONL. Want: task tool result surfaces the resolved model per subagent (TUI badge exists; tool result doesn't).
- 2026-07-03 · open · **`task` tool has no per-spawn model override.** Only the eval bridge `agent(model=…)` accepts an explicit model; during the stale-roles incident this was the sole working lane. Consider a `model` field on task params.
- 2026-07-03 · open · **Runtime model-role overrides need a `/reload`-visible surface.** After the setModelRole fix, disk reload works, but genuine CLI overrides (`--slow` etc.) still shadow disk silently — fine by design, but nothing shows *that* an override is active.
- 2026-07-03 · open · **cmux markdown link rendering.** Some relative links in repo docs don't resolve/click in cmux surfaces. Partially self-inflicted (`agent://` pseudo-links, since removed); rest may be a cmux renderer limitation — reproduce and file.
- 2026-07-03 · open · **`/export` default path policy undocumented.** Fixed in code (export/html default fallback), never documented in fable docs.
- 2026-07-03 · open · **Eval-bridge `agent()` abort quirk.** Explicit-model probe completed (stopReason stop) but bridge raised "subagent 'task' failed" after an abort event; result was usable on retry. Reproduce, fix error propagation.
- 2026-07-03 · open · **Advisory reliability.** During this session the advisor injected several confidently wrong advisories (nonexistent commit hash, respawn-completed-work, fabricated user preferences). Advisor-for-subagents is now the policy; consider a calibration prompt for the advisor role.

## Done

- 2026-07-03 · done · **Stale subagent model roles** — `setModelRole` mirrored persisted writes into runtime overrides which shadow every `reloadFromDisk`; all subagents resolved old-role Kimi regardless of config refresh. Fixed in fork (`90c64256`), regression-tested.
- 2026-07-03 · done · **Advisor polarity** — `advisor.enabled: false` killed subagent advisors too; no way to express "advise workers, not the Fable main". New `shouldEnableAdvisor` gate: Fable-model sessions never advised; main via `enabled`, subagents via `subagents` independently (`90c64256`).
- 2026-07-03 · done · **Install pipeline patched upstream instead of the fork** — `omp-install` now builds from `oh-my-pi` source with a `+fork.<hash>` version stamp; patch flow retired (`omp-agent-heal` no-op, patches dir = history); `omp-update` prints fork-merge instructions. Plan: `docs/plans/omp-fork-install.md`.
- 2026-07-03 · done · **Skill leak** — multi-source discovery loaded ~64 skills vs 20 intended; global dirs + autolearn `managed-skills` archived reversibly (ledger in `docs/fable/harness-slimming.md`).
- 2026-07-03 · done · **`gpt-implementer` pinned to `pi/default`** — broke when default became Fable (guard → Kimi); now pinned `openai-codex/gpt-5.5:high`.
