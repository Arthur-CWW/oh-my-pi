> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-06-22T02-26-51-811Z_019eed26-ed22-7000-9996-63de9ee63627/local/agent-tools-skill-reorg.md

# Goal
Move passive skills out of the overloaded `packages/web-access` tree and make OMP global skill loading convention-based.

# Decisions
- Do not rename `packages/web-access` in this pass: `@wirebabel/pi-web-access` is published at npm version 0.10.3, so package renaming needs a separate release/deprecation migration.
- Use `skills/<skill-dir>/SKILL.md` as the repo-level global skill convention. OMP scans customDirectories one level deep, so a single `skills` parent works only if skill directories are direct children.
- Move `packages/web-access/skills/*` to `skills/*`.
- Move imported `skills/pi-skills/*` skill directories to `skills/*` so `skills` alone covers them. Leave non-skill metadata in `skills/pi-skills/` unless it becomes empty.
- Keep package-specific skills in their owning package for now: `packages/borges-library/skills`, `browser-extensions/skills`, `vphone-cli/skills`.
- Update user OMP config to load `/Users/arthur/agents/skills` once via `skills.customDirectories` and stop listing package web-access skill paths in root manifests.

# Extension decision
- Keep `/Users/arthur/agents/packages/web-access/src/index.ts` as the active OMP extension path in this pass.
- Future package-level migration: split or rename `packages/web-access` after deciding published package compatibility.

# Verification
- Run `pi --help` and the package-local web-access typecheck/test after edits.
- Verify OMP skill discovery by running a targeted OMP/Pi command if available, or by exercising `pi --help` plus static config/path checks.
