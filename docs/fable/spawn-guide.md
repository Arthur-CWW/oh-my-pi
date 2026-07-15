# Spawn Guide

Apply this doctrine to every task spawn.

- Isolate all test state under a fresh tmpdir: swap `HOME`, inject an `IrcExternalBus` database path, and set `OMP_SESSION_CONTROL_DB` to a tmpdir database. HOME swapping alone is insufficient.
- Never commit, clean, or reset repository state. Preserve the working tree for the coordinator.
- Run focused gates only: the named/new tests and the required package typecheck. Do not repair foreign failures.
- IRC before editing a shared file; identify the current owner and exact seam first.
- Do not use mocks. Exercise real behavior and isolate dependencies with tmpdirs or injected seams.
- Report evidence as: root cause (`file:line`), change, and test command/output proving the behavior.
- Any deviation from this guide requires an IRC message before proceeding; record the decision in the final report.
