# Research Docs

Research docs are for findings that are useful beyond the current chat but are not durable operating preferences.

Use this directory for:

- GPT-Pro / deep-research outputs
- vendor/provider comparisons and price tables
- source digests and public-source notes
- prompts used for expensive research runs
- session URLs, retrieval notes, and follow-up questions
- summaries of paid/quota-consuming experiments

Some research artifacts are expensive or slow to reproduce. If they are useful, safe, and not huge, keep them in git so changes can be tracked over time.

## What to commit

Commit:

- concise research outputs and syntheses (`*.md`)
- prompts that produced important outputs
- source URL lists / source digests
- small structured artifacts needed to reproduce or audit findings
- notes about provider prices, reliability, and API behavior

Do not commit:

- API keys, cookies, browser profiles, private captures, or account data
- generated media, raw screenshots, large downloads, or local databases
- noisy runtime logs unless they are intentionally part of a reproducibility record

For large or sensitive artifacts, store them under ignored `data/` and commit a small manifest or summary in `docs/research/`.

## Relationship to state docs

`docs/state/` stores compressed operating memory: preferences and defaults that should guide many future sessions.

`docs/research/` stores evidence and context: useful findings that agents can consult, but should not blindly treat as permanent preference.
