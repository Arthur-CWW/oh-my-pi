---
name: vault-ops
description: Dormant operating rules for using Arthur's Obsidian vault from agent sessions. Use only when a task explicitly asks to read, index, distill, or promote material from ~/agents/vault or ~/vault.
---

# Vault Ops

Arthur's Obsidian vault is available from this repo at `~/agents/vault` (symlink to `~/vault`). Treat it as source material, not an agent scratchpad.

## Boundary

- Personal vault: `~/agents/vault` (`~/vault`). Read-mostly.
- Obsidian-side agent copy: `~/vault/_agent/AGENTS.vault-agent.md`. This repo skill is canonical for agent sessions.
- Legacy agent workspace: `~/vault-agent`, if a task explicitly uses it.
- Edit `~/agents/vault` / `~/vault` only when Arthur explicitly asks for a vault edit.
- Generated output belongs in repo-local docs, an assigned workspace, or `~/vault-agent` when the task names that workspace. Never scatter generated notes through Arthur's personal notes.
- Never copy secrets, passwords, tokens, cookies, private keys, `.env` values, or browser/session exports into either the vault or repo docs.

## Retrieval

- Prefer narrow retrieval over bulk injection: search titles, headings, wikilinks, front matter, and filenames first, then read only the needed ranges.
- Use the repo symlink path (`vault/...`) when working from `~/agents`; use absolute `~/vault/...` only when a tool needs it.
- Preserve provenance for every durable claim: source file or URL, source line/range when practical, retrieval/update date, authorship status, uncertainty, missing evidence, and open questions.
- Add SQLite/vector search only after plain text paths, headings, manifests, and front matter stop being enough.

## Outputs and promotion

- Durable agent-authored research should live in `docs/research/`, `docs/plans/`, `docs/state/`, or the task-designated workspace, with provenance in the file.
- Task-specific answers may live in the session output; do not create vault notes unless asked.
- Promotion into the personal vault requires review. Prepare compact, sourced promotion candidates with a proposed target path; do not copy them into `~/vault` unless Arthur explicitly asks.

## Existing vault-agent scripts

Do not rewrite the Obsidian-side scripts. Reference or run them only when the task calls for the legacy `~/vault-agent` workspace:

- `~/vault/scripts/agent/new-note`: creates templated `wiki`, `query`, `promote`, or `raw` notes.
- `~/vault/scripts/agent/build-source-map`: builds an index/count map for `~/vault` into the current workspace.
- `~/vault/scripts/agent/lint-vault`: checks generated `raw`, `wiki`, `queries`, and `promote` notes for front matter and provenance.

## Default workflow

1. Clarify the source boundary: personal vault read-only unless the task names an edit.
2. Locate the smallest relevant note set with file/path/heading search.
3. Read only the needed ranges.
4. Write synthesized output to repo docs or the assigned agent workspace, with provenance.
5. If material should enter the personal vault, stage a reviewed promotion candidate instead of editing the vault directly.
