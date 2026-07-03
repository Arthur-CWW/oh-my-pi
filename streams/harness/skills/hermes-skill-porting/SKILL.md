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

Not every Hermes skill needs a dedicated OMP persona. Most map to an agent + tools combination.

### Direct agent equivalents

| Hermes skill | OMP approach |
|---|---|
| `claude-code`, `codex`, `opencode` | OMP's bundled `task` agent or custom `kimi-implementer` |
| `plan` | OMP's bundled `plan` agent |
| `systematic-debugging` | `gpt-implementer` with LSP, debug tools |
| `test-driven-development` | `kimi-implementer` — follow the plan, run only targeted checks |
| `requesting-code-review` | OMP's bundled `reviewer` agent |
| `simplify-code` | `kimi-implementer` — the system prompt already prefers minimal/boring |
| `spike` | `kimi-researcher` — research + report, no edits |
| `hermes-agent-skill-authoring` | This skill — port workflows, not the authoring meta-skill |

### Tools, not personas

| Hermes skill | OMP equivalent |
|---|---|
| `github-auth` | `omp token github` or `gh auth status` |
| `github-code-review` | `reviewer` agent + `github` tool `op: pr_create` |
| `github-issues` | `issue://` URIs, `github` tool `op: search_issues` |
| `github-pr-workflow` | `github` tool `op: pr_create`, `op: pr_checkout` |
| `github-repo-management` | `github` tool `op: repo_view`, `bash` for git commands |
| `obsidian` | Filesystem paths to `~/vault/` |
| `apple-notes`, `apple-reminders` | `bash` with AppleScript/Shortcuts |
| `blogwatcher` | Install `blogwatcher-cli`, run via `bash`. See its `SKILL.md`. |
| `jupyter-live-kernel` | `eval` tool with `language: "py"` |
| `youtube-content` | `read` the URL, `browser` for JS-heavy pages |
| `nano-pdf`, `ocr-and-documents` | `read` handles PDFs natively |
| `excalidraw`, `design-md` | `write` + preview, or skip and use Mermaid via `render_mermaid` |
| `songwriting-and-ai-music` | `bash` with audiocraft, or skip |

### Research personas

| Hermes skill | OMP agent + assignment |
|---|---|
| `llm-wiki` | `kimi-researcher`: "Build a Karpathy-style wiki at ~/wiki using SCHEMA.md conventions. Ingest these sources..." |
| `arxiv` | `kimi-researcher` + `web_search` + `read` on PDF URLs |
| `research-paper-writing` | `gpt-implementer` for LaTeX, `kimi-researcher` for literature |
| `polymarket` | `kimi-researcher` + `web_search` + `browser` |
| `huggingface-hub` | `kimi-researcher` + `web_search` |

### Not porting

| Hermes skill | Reason |
|---|---|
| `godmode` | Model jailbreak — not applicable as OMP workflow |
| `humanizer` | Text paraphrasing — use the session model directly |
| `songsee`, `heartmula` | Media/music skills — domain-specific, keep in Hermes |
| `comfyui`, `touchdesigner-mcp` | Creative tools — keep in Hermes, not OMP coding workflow |

## Workflow: porting a Hermes skill to OMP

1. **Read the Hermes SKILL.md:** `read ~/.hermes/skills/<category>/<name>/SKILL.md`
2. **Identify the core workflow:** What does the skill actually do? What tools does it need?
3. **Map to OMP primitives:** Agent persona + tools + assignment template
4. **If it's a tool:** Install the CLI, use via `bash`
5. **If it's knowledge:** Write it as an AGENTS.md rule or a one-shot prompt
6. **If it's an agent:** Create a persona file in `~/.omp/agent/agents/` or assign the task to an existing persona
7. **If it's an ongoing workflow:** Document the assignment template here so it's repeatable

## Concrete ported workflows

### llm-wiki → kimi-researcher assignment

```
Agent: kimi-researcher
Assignment:
  Build a Karpathy-style wiki at ~/wiki covering <domain>.
  Read the schema conventions from skill://hermes-skill-porting/references/llm-wiki-conventions.md.
  Ingest these sources: <list URLs or paths>.
  Create SCHEMA.md, index.md, log.md, and entity/concept pages.
```

### blogwatcher → bash tool

```bash
# Install (macOS Apple Silicon)
curl -sL https://github.com/JulienTant/blogwatcher-cli/releases/latest/download/blogwatcher-cli_darwin_arm64.tar.gz | tar xz -C /usr/local/bin blogwatcher-cli

# Add feeds
blogwatcher-cli add "Blog Name" https://example.com

# Scan and read
blogwatcher-cli scan
blogwatcher-cli articles
```

### codebase-inspection → reveng-scout-kimi or explore

```
Agent: reveng-scout-kimi (for binary/packet analysis)
       explore (for source code survey)

Assignment:
  Inspect <target>.
  Report: architecture, key modules, dependencies, anti-patterns, technical debt.
  Do not edit files.
```

### Systematic debugging → gpt-implementer

```
Agent: gpt-implementer
Assignment:
  Bug: <description with reproduction steps>
  1. Reproduce via the steps provided.
  2. Instrument the likely code path with targeted logging.
  3. Identify root cause.
  4. Apply minimal fix.
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
- OMP personas: `~/.omp/agent/agents/*.md`
- OMP config: `~/.omp/agent/config.yml`
