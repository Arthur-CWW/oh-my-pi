# OMP fork-based install pipeline

> **Status 2026-07-03:** Plan approved by Arthur; execution delegated to a GPT-5.5 worker. Fork-first, no patching.

## Why

`mise run omp-install` currently installs **upstream** OMP with bun and applies local patches (spec-driven-overlays model). Arthur has retired that approach: `~/agents/oh-my-pi` is a first-class fork and the source of truth; local behavior lives as direct commits (e.g. `90c64256` fixes stale subagent model-role resolution + advisor gating). Those fixes are dormant until the installed binary (`~/.bun/bin/omp`, a compiled bundle) is rebuilt **from the fork** — and the current pipeline would overwrite them with upstream+patches.

## Target state

1. **`mise run omp-build-fork`** (new task): build the binary from `~/agents/oh-my-pi/packages/coding-agent` (`bun run build`, i.e. `bun scripts/build-binary.ts`; inspect that script for the output artifact path and any required env), back up the current binary to `~/.bun/bin/omp.bak-<yyyymmdd-HHMMSS>`, install the fresh artifact to `~/.bun/bin/omp` (the path `~/.local/bin/omp` wrapper expects via `REAL_OMP`), then run the existing `omp-link` task.
2. **`omp-install` becomes fork-based**: repoint it at `omp-build-fork` (keep the name so muscle memory and the wrapper's error hints stay valid). The upstream-download+patch flow moves to a clearly named legacy task (`omp-install-upstream-legacy`) or is deleted if nothing references it — check references first (wrapper scripts, docs, other mise tasks like `omp-agent-heal`, `omp-doctor`, `omp-update`).
3. **`omp-update` semantics change**: updating now means merging upstream into the fork (a git operation), not downloading a binary. Repoint the task to print a short instruction (fetch upstream remote, merge/rebase, run tests, `mise run omp-install`) rather than silently doing the old thing. Do not automate the merge.
4. **`omp-doctor`** updated: verify wrapper symlinks + that the installed binary was built from the fork (embed/check a build stamp if the build script supports it — e.g. version suffix `+fork.<shorthash>`; if trivial to add to `build-binary.ts`, add it).
5. **Patch-model retirement**: `omp-agent-heal` (spec-driven overlay repair) marked legacy/no-op with a pointer to the fork; `.omp/agent/patches/` left in place as history but no longer applied by install.

## Constraints

- Never leave `~/.bun/bin/omp` missing or non-executable; backup before replace; restore on failed build.
- The `~/.local/bin/omp` wrapper contract is unchanged.
- Verify after install: `omp --version` works, and a fresh `omp --print "reply ok"`-style smoke (or cheapest equivalent) confirms the binary runs. Deeper proof that fork code is live: the build stamp, or grep the bundle for a string unique to the new code (`shouldEnableAdvisor`).
- mise task definitions live wherever the existing `omp-*` tasks are defined (`.mise.toml` / `mise.toml` / `.config/mise/` in ~/agents — locate, follow conventions).
- No formatters; no project-wide test suites; the orchestrator gates.

## Acceptance

- `mise run omp-install` builds from the fork and installs; old flow renamed/retired; `omp-doctor` passes; installed bundle contains `shouldEnableAdvisor`; backup exists; report lists every task/file touched.
