---
name: agent-skill-vendoring
description: "Vendor third-party Agent Skills into the agents repo, wire them into OMP/Pi discovery, and consolidate global symlinks without duplicate skill copies."
---

# Agent Skill Vendoring

Use when installing third-party Agent Skills that Arthur wants committed into `~/agents` and available to OMP/Pi without duplicate local copies.

## Procedure

1. Inspect the source before installing:
   - `npx skills add <repo-url> --list`
   - `read` the repo README/SKILL.md when available.
2. Install globally only when the user wants cross-project availability:
   - `npx skills add <repo-url> -g -y --skill <name>`
3. Vendor the installed skill directory into this repo under a source-owned path, usually:
   - `vendor/<owner>/<repo>/<skill-name>/`
4. Update `.gitignore` to unignore only that vendor subtree. Keep broad `vendor/*` ignores intact.
5. Wire repo discovery with the root `package.json` `pi.skills` list using concrete skill directories. This avoids editing OMP YAML for repo-local use.
6. Consolidate duplicates:
   - Remove accidental project `.agents/skills/<name>` copies unless deliberately used for auto-discovery.
   - If global availability is still needed, replace `~/.agents/skills/<name>` with a symlink to the vendored copy so global and repo use share one source.
7. Verify:
   - `python3 -m json.tool package.json` when `package.json` changed.
   - `pi --help` to ensure the root Pi package still loads.
   - `find`/`read` the vendored `SKILL.md` files; do not rely on memory.

## OMP discovery facts

- OMP discovers skills one level under `skills/`: `<skills-root>/<skill>/SKILL.md`.
- Built-in providers include `.omp`, extension/plugin `skills/`, Claude/Codex/Agents providers, and `.github/skills`.
- The canonical OMP-native global/project provider is `.agent[s]/skills` (`~/.agents/skills`, `.agents/skills`, etc.).
- Dedup key is the skill name; higher-priority/earlier provider wins. Identical realpaths are de-duplicated, so symlinking global skills to vendored repo copies avoids multiple physical versions.
- Root `package.json` `pi.skills` is this repo's existing explicit skill-pack mechanism.
