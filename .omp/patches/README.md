# OMP patch overlays

This directory tracks repo-owned behavior that sits on top of upstream OMP without maintaining a full OMP fork.

## Pattern: extension-first spec overlay

Rule: if OMP can support the behavior through an extension/plugin/skill/tool, do that instead of patching upstream source.

Escalation order:

1. **Extension/plugin** — preferred. Own the code in this repo and load it through OMP config. Example: Kagi browser-session search lives in `packages/web-access`, not in an OMP fork.
2. **Dependency patch** — acceptable when the behavior lives below OMP in a bundled third-party package and no OMP extension seam can intercept it. Example: `beautiful-mermaid`.
3. **Source patch** — last resort when OMP has no extension API for the surface. Example: Agent Hub scoped key handling.
4. **Spec-driven self-heal** — every non-extension overlay gets a small behavioral spec. Deterministic patches run first; when upstream changes break them, `mise run omp-agent-heal` gives OMP's default agent the spec and current source so it can re-implement against the new upstream.

Maintenance loop:

1. `omp update` runs upstream OMP's updater through the repo wrapper.
2. After a successful upstream update, `.omp/bin/omp-post-update` runs automatically.
3. Post-update maintenance re-links repo-owned files with `mise run omp-link`.
4. It applies deterministic self-heal patches.
5. If a deterministic patch fails, it immediately runs `mise run omp-doctor` and exits nonzero so the failure is visible.
6. `omp-doctor` classifies overlays as present, obsolete/upstreamed, or needing repair.
7. If repair is needed and no extension path exists, the repair command is `mise run omp-agent-heal`.

LLM repair is intentionally a named task, not silent update behavior. Deterministic patching is automatic; agentic source editing stays explicit unless a future daily maintenance workflow opts into it.

## Actual inventory

### OMP source patch: Agent Hub explicit parked revive

Spec: `agent-hub-r-revive.md`

Status: applied to the active global OMP 16.2.6 source and bundle after upstream update. The maintained check is:

- `.omp/patches/agent-hub-r-revive-check.ts`

The stale `oh-my-pi/` tree still contains the older reference patch/test in:

- `oh-my-pi/packages/coding-agent/src/modes/components/agent-hub.ts`
- `oh-my-pi/packages/coding-agent/test/agent-hub-activate.test.ts`

Reason it is a patch: OMP extensions cannot hook Agent Hub's scoped key handling today.

### Dotfile self-heal: cmux OMP resume PATH

Spec: `cmux-omp-resume-env.md`

Status: maintained through `~/.omp/agent/bin/omp-self-heal`, `mise run cmux-omp-resume-doctor`, and `mise run cmux-omp-resume-agent-heal`.

Reason it is not a cmux patch: cmux restore launchers read `.zshenv`; putting mise shims there makes `/usr/bin/env bun` work without forking/rebuilding cmux or editing Bun-managed OMP binaries.

### Application-file self-heal: cmux shell integration noclobber

Spec: `cmux-shell-noclobber.md`

Status: maintained through `~/.omp/agent/bin/omp-self-heal`, `mise run omp-doctor`, `mise run cmux-shell-noclobber-doctor`, and `mise run cmux-shell-noclobber-agent-heal`.

Reason it is a patch: the redirection lives inside cmux's injected shell integration; no OMP extension or dotfile can intercept the `_cmux_install_cli_command_shim` function before it writes the shim.

### Dependency patch: beautiful-mermaid CJK/emoji widths

Spec: `beautiful-mermaid-cjk.md`
Patch: `.omp/agent/patches/beautiful-mermaid@1.1.3.patch`

Status: applied to the global Bun install by `~/.omp/agent/bin/omp-self-heal`, which is repo-owned and symlinked by `mise run omp-link`.

Reason it is a patch: OMP extensions cannot intercept internal `render_mermaid` dependency code.

### Not an OMP patch: Kagi browser-session search

Spec: `kagi-browser-session.md`

Status: maintained as repo-owned extension/tool code in `packages/web-access/src/kagi.ts`, not as an upstream OMP source patch. The stale `oh-my-pi/` tree also happens to contain older upstream Kagi browser-session code, but `git diff -- oh-my-pi` shows we did not modify Kagi files there.
