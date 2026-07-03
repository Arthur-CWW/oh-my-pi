# Harness hot reload

OMP session state lives in the session JSONL; the CLI process is disposable. `/restart` saves and flushes the current session, clears the draft, spawns a replacement process, and shuts the old one down. The replacement process reuses the same executable prefix, cwd, environment, stdio, config flags, and model flags, then appends `--resume <live-session-id>` so it reattaches to the same JSONL.

Use `/reload-config` when only config changed and the running process can reread it. Use rebuild plus `/restart` when TypeScript/runtime code changed: rebuild the fork, then restart the pane process so the new executable code is loaded while the session resumes from JSONL.

cmux keeps the pane alive while OMP replaces itself. In the normal path the pane remains attached because the child inherits stdin/stdout/stderr and the old process exits after spawning it. If the pane ends up dead or detached, use cmux's respawn-pane as the fallback and resume the same session manually.

What is lost across `/restart` is anything held only in the old process. `spawnRestartProcess` starts a detached `Bun.spawn` with inherited stdio, env, and cwd, then `unref()`s it; it does not transfer JS heap objects, child-process handles, job registries, MCP client/server instances, or editor buffers. Practically, this loses:

- background bash jobs and any outputs that had not already been persisted to the session transcript;
- in-flight task subagents and tool jobs owned by the old process;
- MCP server/client runtime state held by the old process;
- unsaved TUI input, because `/restart` clears the editor and saves an empty draft before spawning.
