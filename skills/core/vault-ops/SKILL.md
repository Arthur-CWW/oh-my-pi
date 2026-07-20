---
name: vault-ops
description: Dormant operating rules for retrieving, digesting, or preparing reviewed changes to Arthur's personal Obsidian vault. Use only when a task explicitly names ~/agents/vault or ~/vault.
---

# Vault Ops

[`streams/gardener/GOAL.md`](../../../streams/gardener/GOAL.md) is the canonical doctrine and ownership boundary. This dormant rules skill governs sessions that explicitly need vault material; it does not activate a maintenance process.

## Hard boundaries

- Treat `~/agents/vault` (the repo symlink to `~/vault`) as Arthur's read-mostly personal corpus, never as an agent scratchpad.
- Edit the personal vault only when Arthur explicitly asks for a vault edit. Raw-capture authorship remains Arthur's.
- Never scatter generated notes through Arthur's personal notes. Agent-authored output belongs in the task-designated repo or workspace path.
- Never copy secrets, passwords, tokens, cookies, private keys, `.env` values, or browser/session exports into the vault or repo docs.
- The retired June scaffold directories still exist on disk pending cleanup; do not use them.

## Retrieval

- Prefer narrow retrieval over bulk injection: locate the smallest relevant note set by path, title, heading, internal link, or front matter, then read only the needed ranges.
- Use `vault/...` when working from `~/agents`; use an absolute path only when a tool requires one.
- Preserve provenance for every durable claim: source path or URL, source range when practical, retrieval date, authorship status, uncertainty, missing evidence, and open questions.
- Do not add an indexer or semantic-search layer until plain paths, headings, manifests, and front matter demonstrably stop being enough.

## Digesting and reformatting

- Follow the charter's voice-preservation doctrine for Arthur-authored run-ons: structure, group, dedupe, and annotate provenance without polishing his phrasing.
- Agent-produced research may be resynthesized and refined.
- Keep generated digests, ledgers, indexes, reformat candidates, and cleanup manifests in the task-designated repo path until Arthur reviews any personal-vault change.

## Review and promotion

- Promotion into the personal vault requires Arthur's review and an explicit target path.
- Prepare compact, sourced candidates outside the personal vault; never copy them into `~/vault` merely because they appear useful.
- A cleanup or consolidation manifest is a proposal, not permission to execute it.
