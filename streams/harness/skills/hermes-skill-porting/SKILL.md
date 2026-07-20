---
name: hermes-skill-porting
description: "Map Hermes skills to OMP agents/tools. Use filesystem paths for Obsidian vault in headless mode. Port research, automation, and agent workflows from Hermes to OMP."
globs: []
alwaysApply: false
---

# Hermes skill porting and OMP vault workflow

Hermes has 70+ built-in and local skills. This skill describes how to inspect them, adapt useful ones to OMP primitives, and work with the Obsidian vault without depending on the Obsidian GUI.

## Hermes skill inventory

Hermes is installed at `/Users/arthur/.local/bin/hermes`. Skills live under `~/.hermes/skills/`.

```bash
# List all installed skills
hermes skills list

# Read a skill's source
read ~/.hermes/skills/<category>/<skill-name>/SKILL.md
```

Categories: autonomous-ai-agents, creative, data-science, email, github, media, mlops, note-taking, productivity, red-teaming, research, smart-home, social-media, software-development, devops.

## Vault access

### Filesystem paths (preferred for headless)

The vault is at `~/vault/`. Use direct filesystem paths for all read/write:

```
~/vault/wiki/
~/vault/sources/
~/vault/sources/clippings/YYYY/MM/
~/vault/templates/
~/vault/indexes/
~/vault/library/
```

This works instantly in headless mode — no Obsidian process needed.

### vault:// URIs (slow, needs Obsidian GUI)

`vault://` spawns the full Obsidian Electron app in CLI mode. Startup takes 10-30s and may fail without a display. Only use `vault://` for Obsidian-specific queries:

```
vault://                        # list known vaults
vault://_/                      # active vault root listing
vault://_/?op=search&q=...      # search
vault://_/?op=backlinks&path=... # backlinks for a file
vault://_/?op=daily             # today's daily note
vault://_/?op=tasks             # open tasks
vault://_/path/to/file.md       # read a file (use fs path instead)
vault://_/path/to/file.md?op=tags # tags on a file
```

When `vault://` times out, fall back to filesystem paths. The same data is there.

## Mapping Hermes skills to OMP

Not every Hermes skill needs a dedicated OMP route. Most map to a bundled agent plus a narrowly scoped tool set.

### Direct agent equivalents

| Hermes skill | OMP approach |
|---|---|
| `claude-code`, `codex`, `opencode` | `task` with an implementation specialist role and a bounded task packet |
| `plan` | `plan` for architecture and sequencing |
| `systematic-debugging` | `task` with a debugging specialist role and LSP/debug tools |
| `test-driven-development` | `task` with a testing specialist role and targeted checks |
| `requesting-code-review` | `reviewer` for code review |
| `simplify-code` | `task` with a maintenance specialist role and the affected files only |
| `spike` | `explore` for a read-only source survey, or `librarian` for source distillation |
| `hermes-agent-skill-authoring` | This skill — port workflows into bundled routes |

### Tools, not custom routes

| Hermes skill | OMP equivalent |
|---|---|
| `github-auth` | `task` with an authentication specialist role and a bounded task packet; allow only the required `github` or `bash` auth commands |
| `github-code-review` | `reviewer` for review; `task` with a release specialist role for any state-changing `github` action |
| `github-issues` | `issue://` URIs, `github` tool `op: search_issues` |
| `github-pr-workflow` | `task` with a release specialist role and only `github` actions `op: pr_create`, `op: pr_checkout` |
| `github-repo-management` | `task` with a repository-maintenance specialist role, `github` tool `op: repo_view`, and only needed `bash` git commands |
| `obsidian` | Filesystem paths to `~/vault/`; use a bounded `task` packet for writes |
| `apple-notes`, `apple-reminders` | `task` with an Apple automation specialist role and `bash` limited to the required AppleScript or Shortcut |
| `blogwatcher` | `task` with a feed-maintenance specialist role, `bash`, and the exact feed paths it may change |
| `jupyter-live-kernel` | `eval` tool with `language: "py"` |
| `youtube-content` | `librarian` or `explore` for read-only source distillation; allow `read` for the URL and `browser` only for JS-heavy pages |
| `nano-pdf`, `ocr-and-documents` | `librarian` or `explore` for read-only source distillation; allow `read`, which handles PDFs natively |
| `excalidraw`, `design-md` | `task` with a design-maintenance specialist role using `write` and preview, or `render_mermaid` |
| `songwriting-and-ai-music` | `task` with a media-tool integration specialist role and `bash` limited to the required audiocraft commands |

### Research and source distillation

| Hermes skill | OMP route |
|---|---|
| `llm-wiki` | `librarian` to distill the supplied sources; `task` writes the resulting vault pages when needed |
| `arxiv` | `librarian` with `web_search` and `read` on PDF URLs |
| `research-paper-writing` | `librarian` for literature; `task` with a writing specialist role for mutable manuscript work |
| `polymarket` | `librarian` with `web_search` and `browser` |
| `huggingface-hub` | `librarian` with `web_search` |

### Bounded prose replacement

| Hermes skill | OMP route |
|---|---|
| `humanizer` | `task` with a prose-maintenance specialist role for bounded editing; name owned and excluded documents, allow only `read` and `edit`, and request a configured model selection (optional model override) only when needed |

### Not porting

| Hermes skill | Reason |
|---|---|
| `godmode` | Model jailbreak — not applicable as an OMP workflow |
| `songsee`, `heartmula` | Media/music skills — domain-specific, keep in Hermes |
| `comfyui`, `touchdesigner-mcp` | Creative tools — keep in Hermes, not the OMP coding workflow |

## Workflow: porting a Hermes skill to OMP

1. **Read the Hermes SKILL.md:** `read ~/.hermes/skills/<category>/<name>/SKILL.md`
2. **Identify the core workflow:** What does the skill actually do? What tools does it need?
3. **Map to OMP primitives:** Choose a bundled agent, a least-privilege tool allowlist, and an assignment template.
4. **If it's a tool:** Read-only CLI use may be tool-based; installation, configuration, or other state changes go through the bounded `task` packet.
5. **If it's knowledge or source analysis:** Route read-only distillation to `librarian` or a code survey to `explore`.
6. **If it changes files or external state:** Route it to `task` with a specialist role, owned files, excluded files, a least-privilege tool allowlist, and an optional requested model selection (model override) that the parent applies through supported task configuration.
7. **If it's an ongoing workflow:** Document the bounded task packet here so it is repeatable.

### Bounded mutable task packet

```
Agent: task
Role: <specialist discipline>
Owned files: <exact paths this task may change>
Excluded files: <paths or areas this task must not change>
Tools: <least-privilege allowlist, for example read, edit, lsp, bash>
Requested model selection (optional model override): <approved selector; parent applies through supported task configuration>
Assignment: <concrete outcome, constraints, and acceptance criteria>
```

## Concrete ported workflows

### llm-wiki → librarian distillation and task write

```
Agent: librarian
Assignment:
  Distill the supplied sources for a Karpathy-style wiki at ~/wiki covering <domain>.
  Read the schema conventions from skill://hermes-skill-porting/references/llm-wiki-conventions.md.
  Return the source-backed page outline and facts for SCHEMA.md, index.md, log.md,
  and entity/concept pages.

Agent: task
Role: vault knowledge-base maintainer
Owned files: ~/wiki/SCHEMA.md, ~/wiki/index.md, ~/wiki/log.md, ~/wiki/<entity-and-concept-pages>
Excluded files: all paths outside ~/wiki
Tools: read, edit, write
Requested model selection (optional model override): <approved selector; parent applies through supported task configuration>
Assignment:
  Materialize the approved distilled outline and facts in the owned wiki files.
```

### blogwatcher → task feed-maintenance packet

```
Agent: task
Role: feed-maintenance specialist
Owned files: /usr/local/bin/blogwatcher-cli, <blogwatcher configuration and feed-state paths>
Excluded files: all other paths
Tools: bash
Requested model selection (optional model override): <approved selector; parent applies through supported task configuration>
Assignment:
  Install and operate blogwatcher-cli only for the owned feed configuration.
  Use these commands as needed:

  # Install (macOS Apple Silicon)
  curl -sL https://github.com/JulienTant/blogwatcher-cli/releases/latest/download/blogwatcher-cli_darwin_arm64.tar.gz | tar xz -C /usr/local/bin blogwatcher-cli

  # Add feeds
  blogwatcher-cli add "Blog Name" https://example.com

  # Scan and read
  blogwatcher-cli scan
  blogwatcher-cli articles
```

### codebase-inspection → explore or task

```
Agent: explore (for a read-only source code survey)
Assignment:
  Inspect <target>.
  Report: architecture, key modules, dependencies, anti-patterns, technical debt.
  Do not edit files.

Agent: task (for debugging, reverse engineering, authentication, migration, or prose maintenance that changes files)
Role: <debugging, reverse-engineering, authentication, migration, or prose-maintenance specialist>
Owned files: <exact target paths>
Excluded files: <all non-target paths>
Tools: <least-privilege allowlist, for example read, search, lsp, debug, edit>
Requested model selection (optional model override): <approved selector; parent applies through supported task configuration>
Assignment:
  Complete <concrete mutable outcome> only within the owned files.
```

### Systematic debugging → task

```
Agent: task
Role: debugging specialist
Owned files: <exact files needed for the minimal fix>
Excluded files: <all unrelated files>
Tools: read, search, lsp, debug, edit, bash
Requested model selection (optional model override): <approved selector; parent applies through supported task configuration>
Assignment:
  Bug: <description with reproduction steps>
  1. Reproduce via the steps provided.
  2. Instrument the likely code path with targeted logging.
  3. Identify root cause.
  4. Apply minimal fix only in the owned files.
  5. Recommend parent validation commands.
```

## Skill directory layout

```
~/.omp/agent/skills/hermes-skill-porting/
  SKILL.md           # this file
  references/        # detailed convention docs for ported workflows
```

## References

- Hermes help: `hermes --help`, `hermes <command> --help`
- OMP docs: `omp://`
- Vault root: `~/vault/`
- OMP config: `~/.omp/agent/config.yml`
