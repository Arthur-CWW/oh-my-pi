# cmux OMP resume PATH repair

## Kind

Dotfile/self-heal overlay. Prefer fixing the shell environment over patching cmux or OMP source.

## Symptom

After cmux restarts and auto-resumes OMP sessions, panes can show:

```txt
env: bun: No such file or directory
```

## Root cause

cmux agent-hook resume bindings can restore through a generated `#!/bin/zsh` launcher script (`SurfaceResumeBindingScriptStore.writeLauncherScript` in vendored cmux). That script is non-interactive, so it reads `~/.zshenv` but does not run the normal interactive `.zshrc` path where mise activation previously happened.

The restored command may execute `~/.bun/bin/omp`, whose shebang is `#!/usr/bin/env bun`. If `bun` is only available through mise shims added later in `.zshrc`, `/usr/bin/env bun` fails.

## Desired fix

Keep `~/.local/share/mise/shims` on PATH from `~/.zshenv`, before any non-interactive zsh script executes OMP. Do not patch cmux.app or the Bun-managed `~/.bun/bin/omp` unless this dotfile fix cannot work.

Current expected line in repo-owned `dotfiles/shell/.zshenv`:

```zsh
export PATH="$HOME/.local/share/mise/shims:$HOME/.opencode/bin:$PATH"
```

If that exact line has changed, the invariant is still: `.zshenv` must add `$HOME/.local/share/mise/shims` before OMP restore launchers can hit an `/usr/bin/env bun` shebang.

## Deterministic self-heal

`~/.omp/agent/bin/omp-self-heal` is repo-owned and symlinked by `mise run omp-link`. It must:

1. Ensure `.zshenv` contains `.local/share/mise/shims`.
2. Run a sparse-environment simulation:

```sh
env -i HOME="$HOME" PATH=/usr/bin:/bin /bin/zsh /tmp/cmux-omp-resume-test.zsh
```

where the script checks `command -v bun` and `~/.bun/bin/omp --version`.

## Repair command

If deterministic self-heal or doctor checks fail and the cause is not obvious, run:

```sh
mise run cmux-omp-resume-agent-heal
```

That command gives OMP this spec and asks it to repair only the cmux OMP resume PATH invariant.
