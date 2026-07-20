---
name: hermes-omp-bridge
description: Port useful Hermes skills into OMP workflows, use the Obsidian vault headlessly, and choose the right bundled OMP role for recurring tasks.
---

# Hermes → OMP Bridge

Use this skill when the user mentions Hermes skills, asks to port a Hermes workflow into OMP, asks how to access `~/vault` from OMP/headless mode, or wants to turn repeated local workflows into OMP skills, bundled-role task packets, or automations.

## Local Hermes layout on this machine

Known local paths:

```text
Hermes CLI: ~/.local/bin/hermes
Hermes app: /Applications/Hermes.app
Hermes skills: ~/.hermes/skills
Hermes app state: ~/Library/Application Support/Hermes
```

Useful commands:

```bash
~/.local/bin/hermes skills list
~/.local/bin/hermes skills info <skill-name>
~/.local/bin/hermes --help
```

Inspect skill files directly with OMP tools, not shell paging:

```text
~/.hermes/skills/research/llm-wiki/SKILL.md
~/.hermes/skills/research/blogwatcher/SKILL.md
~/.hermes/skills/note-taking/obsidian/SKILL.md
~/.hermes/skills/software-development/systematic-debugging/SKILL.md
```

Do not assume Hermes category nesting maps to OMP skill discovery. OMP native skills are one directory deep under `~/.omp/agent/skills/`.

## OMP skill layout

Create OMP skills here:

```text
~/.omp/agent/skills/<skill-name>/SKILL.md
```

Required frontmatter:

```yaml
---
name: skill-name
description: Short actionable description used for discovery.
---
```

Do not nest skills under category directories unless `skills.customDirectories` is explicitly pointed at that category parent. OMP's native provider discovers only:

```text
~/.omp/agent/skills/foo/SKILL.md
```

Not:

```text
~/.omp/agent/skills/research/foo/SKILL.md
```

Reference skill assets with:

```text
skill://<skill-name>/relative/file.md
```

## Headless Obsidian / vault access

Preferred in OMP: use direct filesystem paths.

```text
~/vault
~/vault/wiki
~/vault/sources
~/vault/sources/clippings
~/vault/inbox
~/vault/Clippings
```

Direct paths are instant, work headlessly, and do not require Obsidian to be running.

Use `vault://` only for Obsidian-specific operations such as backlinks, tags, tasks, daily note lookup, and vault search. Current OMP `vault://` support shells out to the Obsidian Electron app; that can take 10-30s and may timeout in headless contexts.

If `vault://` times out:

1. Fall back to direct filesystem paths for file read/write.
2. Use OMP `search` over `~/vault` for content lookup.
3. Use OMP `find` over `~/vault` for path discovery.
4. Use vault-specific ops only when the Obsidian app/CLI is responsive.

Example replacements:

```text
Instead of: vault://_/wiki/foo.md
Use:        ~/vault/wiki/foo.md

Instead of: vault://_/?op=search&q=trading
Use:        search pattern="trading" paths="~/vault"
```

## Hermes skills worth adapting

### llm-wiki

Hermes path:

```text
~/.hermes/skills/research/llm-wiki/SKILL.md
```

Use when the user wants a compounding markdown knowledge base. Good OMP adaptation:

- raw sources under `~/vault/sources/`
- synthesized pages under `~/vault/wiki/`
- query outputs under `~/vault/queries/`
- index/log under `~/vault/indexes/` or a dedicated wiki root

Use `librarian` or `explore` for ingestion/retrieval and source distillation. Route mutable index repair, stale-source detection, and duplicate cleanup to `task` with a maintenance specialist role.

### blogwatcher

Hermes path:

```text
~/.hermes/skills/research/blogwatcher/SKILL.md
```

Use for recurring RSS/blog monitoring. Best OMP form is an automation plus a small skill:

- Install/use `blogwatcher-cli`.
- Store DB under `~/state/blogwatcher/blogwatcher-cli.db`.
- Export useful unread items into `~/vault/inbox/captures/` or `~/vault/sources/clippings/YYYY/MM/`.
Route mutable capture triage into wiki/source folders to `task` with a vault-triage specialist role.

### obsidian

Prefer direct filesystem operations on `~/vault`. Use Obsidian-specific APIs only for graph semantics: backlinks, unresolved links, tags, tasks, recents, templates, daily notes.

### github/codebase-inspection/github-code-review

Map to OMP native tools:

- `github` tool for PR/issues/actions.
- `lsp` for symbol-aware refs/renames/actions.
- `search/find/read` for scoped code inspection.
- `reviewer` for complex review; route any resulting mutable fix to `task` with an implementation specialist role.

### systematic-debugging / python-debugpy / node-inspect-debugger

Map to OMP `debug` tool when stepping, stack inspection, breakpoints, variables, or interrupting hangs is needed. Use `bash` only for running tests/commands, not for debugger state.

### plan / spike / test-driven-development

Map to bundled OMP roles:

- `plan` for architecture decisions.
- `task` with a bounded implementation specialist role for code changes.
- `reviewer` for review after the implementation is available.
- `designer` for UI/UX decisions and interface implementation.
- `quick_task` only for strictly mechanical, low-reasoning updates.

### arxiv / research-paper-writing / youtube-content / polymarket

Map to `librarian` or `explore` for retrieval and source distillation. Save sources into `~/vault/sources/` and syntheses into `~/vault/wiki/` or `~/vault/queries/`.

### autonomous agent workflows

Use when comparing agent outputs or delegating bounded work. In OMP, use bundled roles and task packets rather than branded-agent routes.

## Recurring Arthur workflows and recommended form

| Workflow | Best OMP form | Bounded route |
|---|---|---|
| Repo/git garbage collection | Bounded mutable task | `task`: repository-maintenance specialist; own only named repo paths; exclude unrelated worktrees; `read`, `bash` |
| Vault inbox/clippings triage | Bounded mutable task or automation | `task`: vault-triage specialist; own named inbox/source paths; exclude wiki/indexes; `read`, `find`, `edit`, `write` |
| Research and source distillation | Read-only investigation | `librarian` or `explore` |
| Authenticated browser extraction | Bounded mutable task | `task`: authenticated-browser extraction specialist; own named output paths; exclude credentials and unrelated accounts; `browser`, `read`, `write` |
| Reverse engineering apps/providers | Read-only investigation or bounded mutation | `explore` or `librarian` for analysis; `task`: reverse-engineering specialist for approved changes, with owned paths, exclusions, and `read`, `search`, `debug`, `edit` only as needed |
| Bounded code edits from plan | Bounded mutable task | `task`: implementation specialist; own named files; exclude non-target modules; `read`, `lsp`, `edit`, `bash` |
| Complex architecture/migrations | Architecture, then mutable task | `plan`, then `task`: migration specialist; own migration paths; exclude unrelated data/code; `read`, `lsp`, `edit`, `bash` |
| Prose maintenance | Bounded mutable task | `task`: prose-maintenance specialist; own named documents; exclude source evidence and unrelated documents; `read`, `edit` |
| RSS/blog monitoring | Automation | `blogwatcher-cli`; route mutable triage to `task` with named vault paths and `read`, `find`, `edit`, `write` |
| Trading bot planning | Plan + research | `librarian` or `explore`, then `plan` |

## Choosing skill vs subagent vs automation

Create a skill when the value is a reusable playbook or source-aware procedure.

Create a bounded `task` packet when the value is mutable work with a stable contract and repeatable delegation target.

Create an automation when the workflow runs on a schedule or watches for new inputs: RSS, inbox cleanup, stale branch reports, vault lint, download folder reports.

Skip packaging when the task is one-off, lacks stable inputs, or has no clear stopping condition.

## Mutable task packet

For mutable work, dispatch `task` with a concrete assignment packet. State the specialist role, a bounded task, owned and excluded paths, the least-privilege tool allowlist, and completion criteria. When the configured task route supports it, include an optional requested model selection (model override) for mutable `task`, `designer`, or `oracle` work when the default is unsuitable; the parent applies it through the supported task configuration.

```yaml
agent: task
role: vault-triage specialist
task: Move reviewed captures into their correct vault folders.
owns:
  - ~/vault/inbox/captures/
  - ~/vault/sources/clippings/
excludes:
  - ~/vault/wiki/
  - ~/vault/queries/
  - ~/vault/indexes/
tools:
  - read
  - find
  - bash
done: Every reviewed capture is filed or explicitly left in place with its reason.
# requested model selection (optional model override); parent applies it only through supported task configuration
```

Use `quick_task` only for a strictly mechanical slice. Use `plan`, `reviewer`, and `designer` for their normal architecture, review, and UI/UX duties; use `librarian` or read-only `explore` for source investigation rather than edits.

## Practical packaging procedure

1. Inspect recent evidence: OMP sessions, Hermes sessions, vault tasks, repo trackers.
2. Identify workflows that happened at least twice or are clearly recurring and costly.
3. Check existing assets first: `~/.omp/agent/skills`, `~/.hermes/skills`, `~/automations`.
4. Choose the smallest form: skill, bounded task packet, automation, extend existing, or skip.
5. Write the asset narrowly.
6. Test with one real task.
7. Keep an audit trail in `~/vault/queries/` or the relevant repo tracker when useful.

## Safety and secrets hygiene

Do not paste or export raw cookies, tokens, session headers, OAuth credentials, API keys, or private account settings. Treat auth as ambient access through the browser/profile/tooling. Save outputs and provenance, not secrets.

For legitimate browser or retrieval work that needs a different route, use the bounded `task` assignment packet: name the retrieval or authenticated-browser specialist role, owned output paths, excluded credential/account areas, and only the required `browser`, `read`, or `write` tools. When supported by the configured task route, include an optional requested model selection (model override) for the parent to apply; preserve safety constraints rather than routing around them.
