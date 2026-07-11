# Primer Stream Index

## Reading order

Successor sessions should read these in order. Status matters: durable doctrine, living design space, dated implementation state, and situated research are different kinds of authority.

1. [`INTENT.md`](INTENT.md) — durable, revisable theory of Arthur’s aims and the product’s boundaries.
2. [`LINEAGE.md`](LINEAGE.md) — predecessor evidence, correction/delta ontology, and explicit recovery gaps.
3. [`GOAL.md`](GOAL.md) — stream charter, ownership, and settled constraints.
4. [`VISION.md`](VISION.md) — living design space and dated decisions; broader than the current experiment.
5. [`HANDOFF-LIVE-2026-07-10.md`](HANDOFF-LIVE-2026-07-10.md) — current shipped/staged state, including the 2026-07-11 continuation. Consult [`HANDOFF.md`](HANDOFF.md) for canonical boot/ownership context; older live handoffs are historical.
6. [`research/learning-sources/system-synthesis.md`](research/learning-sources/system-synthesis.md) — source-grounded synthesis for the current one-chapter workbench, explicitly not universal pedagogy.
7. [`DESIGN-LOG.md`](DESIGN-LOG.md) — append-oriented dated decisions, hypotheses, alternatives, and deferred debt.
8. [`docs/plans/primer-intuitions.md`](../../docs/plans/primer-intuitions.md) — earlier direct-quote dossier and exact predecessor-session inventory; use as evidence, not a rigid specification.

For the current task, the handoff wins on implementation status. For durable product interpretation, start with INTENT and preserve corrections through LINEAGE and the design log.

## Symlinked repos

| Name | Original absolute path | Action | Description |
| --- | --- | --- | --- |
| mochi-lite | /Users/arthur/apps/mochi-lite | symlink | Mochi-lite app repository for spaced repetition and primer-adjacent study workflows. |
| hsk-deck | /Users/arthur/apps/hsk-deck | symlink | HSK deck app repository for Chinese learning deck material. |
| japanese-vocab | /Users/arthur/apps/japanese-vocab | symlink | Japanese vocabulary app repository. |
| minimal-srs | /Users/arthur/apps/minimal-srs | symlink | Minimal spaced-repetition system repository. |
| ultimate-chinese | /Users/arthur/apps/ultimate-chinese | symlink | Chinese learning application repository. |
| yomitan | /Users/arthur/apps/yomitan | symlink | Yomitan reference repository for dictionary/lookup tooling. |
| hashcards | /Users/arthur/github/hashcards | symlink | Hashcards repository for card/annotation experiments. |

## Feedstock

| Name | Original absolute path | Action | Description |
| --- | --- | --- | --- |
| Books_Papers_Research | /Users/arthur/Downloads/_Organized/Books_Papers_Research | symlink | Organized books, papers, and research corpus. |
| Zotero | /Users/arthur/Zotero | symlink | Zotero library storage and research attachments. |
| mochi | /Users/arthur/Documents/mochi | symlink | Mochi document exports and study materials. |
| papers | /Users/arthur/Documents/papers | symlink | Local paper collection. |
| algorithms | /Users/arthur/Documents/algorithms | symlink | Algorithm notes and reference material. |
| library | /Users/arthur/vault/library | symlink | Vault library notes and resources. |
| Clippings | /Users/arthur/vault/Clippings | symlink | Vault clipping inbox/reference notes. |
| gay-primer | /Users/arthur/archives/gay-primer | symlink | Archived gay-primer reference material. |
| youtube-transcripts | /Users/arthur/archives/youtube-transcripts | symlink | Archived YouTube transcript feedstock. |

## Nested in-repo checkout

| Name | Repository path | Action | Description |
| --- | --- | --- | --- |
| wrapped-commentary-reader | `streams/primer/wrapped-commentary-reader/` | nested git checkout | Reader, annotation workbench, prompt experiments, and source-local reference artifacts. Commit separately from the outer repo. |

## In-repo material

| Name | Original absolute path | Action | Description |
| --- | --- | --- | --- |
| packages/twitter-archive | /Users/arthur/agents/packages/twitter-archive | in-repo | Twitter archive package for archive parsing/reader workflows. |
| packages/borges-library | /Users/arthur/agents/packages/borges-library | in-repo | Borges library package for book/source retrieval workflows. |
| browser-extensions/extensions/twitter-archive-firefox | /Users/arthur/agents/browser-extensions/extensions/twitter-archive-firefox | in-repo | Firefox extension for Twitter archive workflows. |
| data/twitter-archive | /Users/arthur/agents/data/twitter-archive | in-repo | 130M Twitter archive data. |
| streams/primer/INTENT.md | /Users/arthur/agents/streams/primer/INTENT.md | in-repo | Durable, revisable project intent and Arthur-prior boundaries. |
| streams/primer/LINEAGE.md | /Users/arthur/agents/streams/primer/LINEAGE.md | in-repo | Intellectual/document lineage, predecessor sessions, corrections, and recovery gaps. |
| streams/primer/DESIGN-LOG.md | /Users/arthur/agents/streams/primer/DESIGN-LOG.md | in-repo | Append-oriented design decisions, hypotheses, alternatives, and debt. |
| streams/primer/research/learning-sources/cleaned/hashcards-design-notes.md | /Users/arthur/agents/streams/primer/research/learning-sources/cleaned/hashcards-design-notes.md | in-repo | Source-grounded Hashcards behavior and Primer borrow/adapt/reject notes. |
| docs/plans/primer-intuitions.md | /Users/arthur/agents/docs/plans/primer-intuitions.md | in-repo | Quote-preserving predecessor-session distillation and source inventory. |

## Missing

None.

## Reversal

Symlinks: rm the link. Moves: mv back to original path.
