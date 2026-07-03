# Messaging running OMP sessions

One mechanism: the **IRC bus** — SQLite at `~/.omp/agent/irc-bus.sqlite` (WAL). Every OMP session registers as a peer (name from `irc.peerName`, default derived from cwd); messages are injected into the receiving session at its next step boundary through the same aside path as in-process IRC.

| Who | How |
|---|---|
| Agent → agent (same process) | `irc` tool, unchanged (`await:true` supported) |
| Agent → agent (different OMP instance) | `irc` tool — external peers appear in `op:list` as `[external]`; `await:true` is in-process-only |
| Human / script / cmux → session | `omp irc send <peer> "<message>" [--from <name>]` · `omp irc list` · `omp irc inbox <peer> [--peek]` |

Do **not** use `tmux send-keys` / `cmux send` to talk to a session — that types into the TUI input and races whatever the agent is doing. The bus injects cleanly between steps.

Retired: `omp-mail` (stopgap SQLite mailbox) — script archived at `skills-attic/omp-mail.ts`, skill at `~/.omp/agent/skills-archive/omp-mail/`. The old `scripts/omp-mail.ts` path prints a pointer to `omp irc` and exits 1.

Verification note (2026-07-03): CLI core round-trip verified against a temp bus (send → inbox → list). Direct `bun main.ts` invocation is silent in dev; the command works through the built `omp` binary.
