# cmux shell integration noclobber repair

## Kind

Application-file self-heal overlay. Patches the installed cmux.app shell integration files when upstream uses a clobbering redirection that fails under `set -o noclobber`.

## Symptom

In a shell with `set -o noclobber` enabled, cmux's generated CLI shim (e.g., `claude`) is not rewritten on subsequent prompt invocations. The shim file already exists, so `>"$shim_path"` fails with:

```txt
zsh: file exists: /tmp/cmux-cli-shims/...
```

or in bash:

```txt
bash: /tmp/cmux-cli-shims/...: cannot overwrite existing file
```

## Root cause

`_cmux_install_cli_command_shim` writes the generated shim with `} >"$shim_path" 2>/dev/null || return 0`. When the user's shell has `noclobber` set, the `>` redirection refuses to overwrite the existing shim file, the function returns early, and the stale shim remains on `PATH`.

## Desired fix

Use the clobbering override operator `>|` instead of `>` so the redirection overwrites the existing shim regardless of the `noclobber` setting.

Target files in the installed cmux.app:

- `/Applications/cmux.app/Contents/Resources/shell-integration/cmux-zsh-integration.zsh`
- `/Applications/cmux.app/Contents/Resources/shell-integration/cmux-bash-integration.bash`

The expected marker in both files is:

```zsh
} >|"$shim_path" 2>/dev/null || return 0
```

replacing the old marker:

```zsh
} >"$shim_path" 2>/dev/null || return 0
```

Do not patch cmux source or rebuild the app unless this deterministic file edit cannot work.

## Deterministic self-heal

`~/.omp/agent/bin/omp-self-heal` is repo-owned and symlinked by `mise run omp-link`. It must:

1. For each target file that exists:
   - If the file already contains `} >|"$shim_path" 2>/dev/null || return 0`, report already-applied.
   - Else if it contains `} >"$shim_path" 2>/dev/null || return 0`, replace the old marker with the new marker and report applied.
   - Else report upstream-obsolete (the surrounding code changed and the spec needs re-evaluation).
2. Not require `sudo`; the installed app files are expected to be writable by the user.

## Repair command

If deterministic self-heal reports upstream-obsolete or otherwise fails, run:

```sh
mise run cmux-shell-noclobber-agent-heal
```

That command gives OMP this spec and asks it to repair only the cmux shell integration noclobber invariant.
