# Harness friction log

Running ledger of OMP/harness papercuts and maintenance tasks. Any session may append; the harness stream batches fixes.

## Open

| Date | Symptom | Suspected cause file:line | Severity |
| --- | --- | --- | --- |
| 2026-07-03 | Ctrl-S can still be swallowed before OMP if the parent TTY has software flow control enabled before raw mode is active; OMP-side binding conflicts are fixed. | vendor/oh-my-pi/packages/tui/src/terminal.ts:451 | medium |
| 2026-07-03 | TUI not malleable enough — keybinding remap support is partial outside the TUI keybinding manager. The auth broker readline prompt still treats literal Escape as cancel because it is not hosted by the TUI keybinding layer. | vendor/oh-my-pi/packages/coding-agent/src/cli/auth-broker-cli.ts:271 | low |
| 2026-07-03 | Role-indirection opacity. Agent file → role → role → guard → fallback chains are invisible at spawn time; nobody can tell what model a lane resolves to without reading the child JSONL. | n/a | medium |
| 2026-07-03 | `task` tool has no per-spawn model override. Only the eval bridge `agent(model=…)` accepts an explicit model; during the stale-roles incident this was the sole working lane. | n/a | medium |
| 2026-07-03 | Runtime model-role overrides need a `/reload`-visible surface. CLI overrides still shadow disk silently. | n/a | low |
| 2026-07-03 | cmux markdown link rendering. Some relative links in repo docs do not resolve/click in cmux surfaces. | n/a | low |
| 2026-07-03 | `/export` default path policy undocumented. Fixed in code; fable docs still missing the behavior. | n/a | low |
| 2026-07-03 | Eval-bridge `agent()` abort quirk. Explicit-model probe completed but bridge raised `subagent 'task' failed` after an abort event. | n/a | medium |
| 2026-07-03 | Advisory reliability. Advisor injected confidently wrong advisories during harness work. | n/a | medium |
| 2026-07-03 | `task` subagent runs hit a hard ~400s wall-clock cap ("The operation timed out", exit 1) with no partial-result surfacing in the job result; a gpt-implementer packet of ~15 file writes at current lane latency (~30s/tool-call) cannot fit. Workaround: slice packets to <10 tool calls or re-wake the idle agent via irc. Wanted: configurable per-spawn timeout and a timeout result that lists files already written. | n/a | medium |

## Fixed

| Date | Symptom | Fix commit/file |
| --- | --- | --- |
| 2026-07-03 | Escape remapped to Ctrl-Q orphaned cancel/clear/close paths that hardcoded Escape. Fixed TUI-hosted paths to resolve through `app.interrupt`. | vendor/oh-my-pi/packages/coding-agent/src/modes/components/agent-hub.ts:566; vendor/oh-my-pi/packages/coding-agent/src/modes/components/agent-hub.ts:858; vendor/oh-my-pi/packages/coding-agent/src/modes/components/hook-editor.ts:100; vendor/oh-my-pi/packages/coding-agent/src/tools/bash-interactive.ts:204; vendor/oh-my-pi/packages/coding-agent/src/debug/log-viewer.ts:497; vendor/oh-my-pi/packages/coding-agent/src/debug/raw-sse.ts:95; vendor/oh-my-pi/packages/coding-agent/src/autoresearch/dashboard.ts:95; vendor/oh-my-pi/packages/coding-agent/src/modes/components/plugin-settings.ts:46; vendor/oh-my-pi/packages/coding-agent/src/modes/setup-wizard/wizard-overlay.ts:106; vendor/oh-my-pi/packages/coding-agent/src/modes/setup-wizard/scenes/sign-in.ts:66 |
| 2026-07-03 | Word-left / word-right after typing failed on Ghostty macOS Option-arrow because the terminal reports Option-arrow as `super+alt+left/right`, while defaults only included alt/ctrl variants. | vendor/oh-my-pi/packages/tui/src/keybindings.ts:69; vendor/oh-my-pi/packages/tui/src/keybindings.ts:73; vendor/oh-my-pi/packages/tui/test/keybindings.test.ts:55 |
| 2026-07-03 | Ctrl-S appeared broken in OMP because `app.session.observe` and unused `app.session.toggleSort` both defaulted to Ctrl-S. Moved toggleSort to Ctrl-Shift-S and moved dead tree defaults off editor word-navigation chords. | vendor/oh-my-pi/packages/coding-agent/src/config/keybindings.ts:175; vendor/oh-my-pi/packages/coding-agent/src/config/keybindings.ts:183; vendor/oh-my-pi/packages/coding-agent/src/config/keybindings.ts:199; vendor/oh-my-pi/packages/coding-agent/test/keybindings-display.test.ts:29 |
| 2026-07-03 | Stale subagent model roles — `setModelRole` mirrored persisted writes into runtime overrides which shadow every `reloadFromDisk`; all subagents resolved old-role Kimi regardless of config refresh. | fork commit 90c64256 |
| 2026-07-03 | Advisor polarity — `advisor.enabled: false` killed subagent advisors too; no way to express "advise workers, not the Fable main". | fork commit 90c64256 |
| 2026-07-03 | Install pipeline patched upstream instead of the fork. | docs/plans/omp-fork-install.md |
| 2026-07-03 | Skill leak — multi-source discovery loaded about 64 skills vs 20 intended. | docs/fable/harness-slimming.md |
| 2026-07-03 | `gpt-implementer` pinned to `pi/default`, breaking when default became Fable. | role config |
