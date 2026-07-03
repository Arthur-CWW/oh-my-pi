---
name: hermes-omp-bridge
description: Port useful Hermes skills into OMP workflows, use the Obsidian vault headlessly, and choose the right OMP agent/persona for recurring tasks.
---

# Hermes → OMP Bridge

Use this skill when the user mentions Hermes skills, asks to port a Hermes workflow into OMP, asks how to access `~/vault` from OMP/headless mode, or wants to turn repeated local workflows into OMP skills, agents, or automations.

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

Use `kimi-researcher` for ingestion/retrieval and `maintenance-kimi` for periodic linting, index repair, stale source detection, and duplicate cleanup.

### blogwatcher

Hermes path:

```text
~/.hermes/skills/research/blogwatcher/SKILL.md
```

Use for recurring RSS/blog monitoring. Best OMP form is an automation plus a small skill:

- Install/use `blogwatcher-cli`.
- Store DB under `~/state/blogwatcher/blogwatcher-cli.db`.
- Export useful unread items into `~/vault/inbox/captures/` or `~/vault/sources/clippings/YYYY/MM/`.
- Let `maintenance-kimi` triage unread/new captures into wiki/source folders.

### obsidian

Prefer direct filesystem operations on `~/vault`. Use Obsidian-specific APIs only for graph semantics: backlinks, unresolved links, tags, tasks, recents, templates, daily notes.

### github/codebase-inspection/github-code-review

Map to OMP native tools:

- `github` tool for PR/issues/actions.
- `lsp` for symbol-aware refs/renames/actions.
- `search/find/read` for scoped code inspection.
- `reviewer` or `gpt-implementer` for complex review.

### systematic-debugging / python-debugpy / node-inspect-debugger

Map to OMP `debug` tool when stepping, stack inspection, breakpoints, variables, or interrupting hangs is needed. Use `bash` only for running tests/commands, not for debugger state.

### plan / spike / test-driven-development

Map to OMP agents:

- `plan` for architecture decisions.
- `kimi-implementer` for bounded implementation slices.
- `gpt-implementer` for shared abstractions, migrations, and complex architecture.
- `maintenance-kimi` for cleanup after the change works.

### arxiv / research-paper-writing / youtube-content / polymarket

Map to `kimi-researcher` for retrieval and source distillation. Save sources into `~/vault/sources/` and syntheses into `~/vault/wiki/` or `~/vault/queries/`.

### autonomous-ai-agents: codex, claude-code, opencode, hermes-agent

Use when comparing agent outputs or delegating to external CLIs. In OMP, prefer native `task` subagents first. Use external CLIs only when their auth/model/tooling materially differs.

## Recurring Arthur workflows and recommended form

| Workflow | Best OMP form | Default agent/model |
|---|---|---|
| Repo/git garbage collection | Custom subagent | `maintenance-kimi` |
| Vault inbox/clippings triage | Custom subagent or automation | `maintenance-kimi` |
| Research and source distillation | Custom subagent | `kimi-researcher` |
| Authenticated browser extraction | Custom subagent | `authenticated-web-kimi` |
| Reverse engineering apps/providers | Custom subagent + tooling skill | `reveng-scout-kimi` |
| Bounded code edits from plan | Custom subagent | `kimi-implementer` |
| Complex architecture/migrations | Custom subagent | `gpt-implementer` |
| RSS/blog monitoring | Automation | `blogwatcher-cli` + `maintenance-kimi` |
| Trading bot planning | Plan + research | `kimi-researcher`, then `gpt-implementer` |

## Choosing skill vs subagent vs automation

Create a skill when the value is a reusable playbook or source-aware procedure.

Create a custom subagent when the value is a bounded role with a stable contract and repeatable delegation target.

Create an automation when the workflow runs on a schedule or watches for new inputs: RSS, inbox cleanup, stale branch reports, vault lint, download folder reports.

Skip packaging when the task is one-off, lacks stable inputs, or has no clear stopping condition.

## Practical packaging procedure

1. Inspect recent evidence: OMP/Pi/Codex sessions, Hermes sessions, vault tasks, repo trackers.
2. Identify workflows that happened at least twice or are clearly recurring and costly.
3. Check existing assets first: `~/.omp/agent/skills`, `~/.omp/agent/agents`, `~/.hermes/skills`, `~/automations`.
4. Choose the smallest form: skill, subagent, automation, extend existing, or skip.
5. Write the asset narrowly.
6. Test with one real task.
7. Keep an audit trail in `~/vault/queries/` or the relevant repo tracker when useful.

## Safety and secrets hygiene

Do not paste or export raw cookies, tokens, session headers, OAuth credentials, API keys, or private account settings. Treat auth as ambient access through the browser/profile/tooling. Save outputs and provenance, not secrets.

For refusal-prone but legitimate browser/retrieval work, route to Kimi-backed personas (`kimi-researcher`, `authenticated-web-kimi`) instead of trying to alter another model's safety behavior.
