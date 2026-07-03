# Harness friction log

Running ledger of OMP/harness papercuts and maintenance tasks. Any session may append; the harness stream batches fixes.

## Open

| Date | Symptom | Suspected cause file:line | Severity |
| --- | --- | --- | --- |
| 2026-07-03 | Ctrl-S may still be swallowed before OMP when the parent TTY has software flow control enabled before raw mode is active. In OMP itself Ctrl-S is bound to the agent hub. | vendor/oh-my-pi/packages/tui/src/terminal.ts:451 and vendor/oh-my-pi/packages/coding-agent/src/config/keybindings.ts:174 | medium |
| 2026-07-03 | TUI not malleable enough — keybinding remap support is partial. Some debug/setup/autoresearch overlays still hardcode Escape or q because they do not receive the app keybinding manager. | vendor/oh-my-pi/packages/coding-agent/src/debug/log-viewer.ts:503; vendor/oh-my-pi/packages/coding-agent/src/autoresearch/dashboard.ts:93 | medium |
| 2026-07-03 | Role-indirection opacity. Agent file → role → role → guard → fallback chains are invisible at spawn time; nobody can tell what model a lane resolves to without reading the child JSONL. | n/a | medium |
| 2026-07-03 | `task` tool has no per-spawn model override. Only the eval bridge `agent(model=…)` accepts an explicit model; during the stale-roles incident this was the sole working lane. | n/a | medium |
| 2026-07-03 | Runtime model-role overrides need a `/reload`-visible surface. CLI overrides still shadow disk silently. | n/a | low |
| 2026-07-03 | cmux markdown link rendering. Some relative links in repo docs do not resolve/click in cmux surfaces. | n/a | low |
| 2026-07-03 | `/export` default path policy undocumented. Fixed in code; fable docs still missing the behavior. | n/a | low |
| 2026-07-03 | Eval-bridge `agent()` abort quirk. Explicit-model probe completed but bridge raised `subagent 'task' failed` after an abort event. | n/a | medium |
| 2026-07-03 | Advisory reliability. Advisor injected confidently wrong advisories during harness work. | n/a | medium |

## Fixed

| Date | Symptom | Fix commit/file |
| --- | --- | --- |
| 2026-07-03 | Escape remapped to Ctrl-Q orphaned agent hub table/chat close and prompt-style hook cancel because those paths hardcoded Escape. | vendor/oh-my-pi/packages/coding-agent/src/modes/components/agent-hub.ts:566; vendor/oh-my-pi/packages/coding-agent/src/modes/components/agent-hub.ts:858; vendor/oh-my-pi/packages/coding-agent/src/modes/components/hook-editor.ts:100 |
| 2026-07-03 | Word-left / word-right after typing failed on Ghostty macOS Option-arrow because the terminal reports Option-arrow as `super+alt+left/right`, while defaults only included alt/ctrl variants. | vendor/oh-my-pi/packages/tui/src/keybindings.ts:69; vendor/oh-my-pi/packages/tui/src/keybindings.ts:73; vendor/oh-my-pi/packages/tui/test/keybindings.test.ts:55 |
| 2026-07-03 | Ctrl-S appeared unbound from the main prompt. It is bound to the agent hub; no code change for XOFF because OMP already enters raw mode through `process.stdin.setRawMode(true)`, which is the tractable in-process control. | vendor/oh-my-pi/packages/coding-agent/src/config/keybindings.ts:174; vendor/oh-my-pi/packages/coding-agent/src/modes/controllers/input-controller.ts:342 |
| 2026-07-03 | Stale subagent model roles — `setModelRole` mirrored persisted writes into runtime overrides which shadow every `reloadFromDisk`; all subagents resolved old-role Kimi regardless of config refresh. | fork commit 90c64256 |
| 2026-07-03 | Advisor polarity — `advisor.enabled: false` killed subagent advisors too; no way to express "advise workers, not the Fable main". | fork commit 90c64256 |
| 2026-07-03 | Install pipeline patched upstream instead of the fork. | docs/plans/omp-fork-install.md |
| 2026-07-03 | Skill leak — multi-source discovery loaded about 64 skills vs 20 intended. | docs/fable/harness-slimming.md |
| 2026-07-03 | `gpt-implementer` pinned to `pi/default`, breaking when default became Fable. | role config |
