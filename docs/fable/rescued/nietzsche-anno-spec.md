> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-10T00-06-24-364Z_019f4958-cd6c-7000-b731-fd40d40b2e74/local/nietzsche-anno-spec.md

# Nietzsche Genealogy of Morals — margin-annotation generation spec (shared)

You are generating dense sideline margin-annotation batches for Nietzsche's *On the Genealogy of Morals* (Walter Kaufmann translation). Absolute paths:

- READER root: `/Users/arthur/agents/streams/primer/wrapped-commentary-reader`
- Book dir: `<READER>/artifacts/books/nietzsche-genealogy-of-morals`
- Prompts dir: `<READER>/artifacts/books/nietzsche-genealogy-of-morals/prompts`
- Staging dir (WRITE HERE): `<READER>/artifacts/generation/nietzsche-genealogy-of-morals-2026-07-09`

## What to produce
For each prompt file `<basename>.md` assigned to you, write exactly one file `<basename>.batch.json` into the staging dir. Each prompt `.md` embeds its full generation rules + reader profile + JSON schema + input blocks; a sibling `<basename>.input.json` carries the exact block texts for anchor verification. READ BOTH before writing.

## Output file shape (MATCH EXACTLY — validator-critical)
```json
{
  "version": "wrapped-commentary/v0",
  "work": {"title": "On the Genealogy of Morals", "author": "Friedrich Nietzsche"},
  "unit_key": "<the reading_unit unit_key from the prompt input>",
  "reading_unit_key": "<same unit_key>",
  "annotations": [ { ...annotation... } ],
  "concepts": []
}
```
Every annotation object MUST contain ALL of these fields (validator hard-fails on any missing/null):
- `block_key` — a REAL block_key from that prompt's input blocks
- `reading_unit_key` — the unit_key (must match top-level unit_key)
- `pdf_page` — integer (use the block's pdf_page; preface=1, first essay=2, second essay=3, third essay=4)
- `anchor` — VERBATIM substring of that block's text (see ANCHOR RULE)
- `title` — 2-5 words, non-empty
- `reader_question` — deliberative review question, non-empty
- `front_claim` — short missing-context claim, non-empty
- `category` — one of: glossary | history | philosophy | bibliography | political economy | tech / biology
- `ontology` — narrow concept type (e.g. "etymology / Latin", "slave revolt in morality")
- `why_reference` — why this exact reference appears here, non-empty
- `note` — the missing context (etymology / history / philosophy prerequisite / genealogy / mechanism), non-empty; MUST NOT start by repeating front_claim or the source sentence
- `refs` — compact references
- `verdict` — the string `"new"`
- `kind` — the string `"sideline"`
- `reason` — a one-line retrieval-target sentence, e.g. "Retrieve X as Y." NON-EMPTY.

Visible fields (`title`, `front_claim`, `reader_question`, `note`, `why_reference`) MUST be non-empty and need NO ellipsis.

## ANCHOR RULE (hard failure if violated)
Each `anchor` MUST be an EXACT substring of the referenced block's text, INCLUDING any interior newlines `\n`. The validator trims leading/trailing whitespace of both block text and anchor, so interior newlines matter but edge whitespace doesn't. PREFER short anchors (2-8 words) that sit on a single line to avoid newline mismatches — but multi-line anchors are fine if you copy the `\n` exactly from the input.json text. `block_key` must be a real key from that part's blocks, and the anchor must be inside THAT block.

## Variant-B generation process (run per unit, in order)
1. Write the unit-thesis cache FIRST (1-3 lines) and quote it before generating any card.
2. Coverage ledger: list candidate anchors → one-line retrieval target per anchor → dedupe targets across the whole unit (across ALL parts you own — reasons must not be near-duplicates of each other; validator flags dice/jaccard >= 0.85 within the same unit_key).
3. Per card, state the retrieval target BEFORE writing fields.
4. Fields render the target.
5. Self-audit: restate the target from the finished card (mismatch → drop); no null/empty visible fields; front must not give away the back; no reused question-stem within a unit.

## TIER SEMANTICS
- T2 = target tier: stable, atomic, retrieval-worthy, anchored to a specific text moment. AIM HERE.
- T3 = rare cross-unit synthesis; do not force.
- Plausible-T1 (roughly on-topic but vague/shallow/wordy/ambiguous/redundant) STAYS OUT. When unsure, DROP the card.

## Reader profile (who these are for)
Strong maths/CS reader, Australian early-twenties. Do NOT explain basic CS. DO supply philosophical / historical / etymological / Marx–D&G / genealogical context. Likes compressed syntax (arrows, slashes, fragments OK in `note`).

## Nietzsche-specific guidance
This is a work of moral genealogy and philology. High-value annotation targets:
- Etymologies Nietzsche leans on: `gut/schlecht/böse` (good/bad/evil), `schuld` (guilt = debt), `bonus`, `malus`, German/Latin/Greek word roots he cites.
- Named interlocutors & sources: Dr. Paul Rée, Schopenhauer, the "English psychologists"/genealogists, Darwin, Herbert Spencer, Kant, Plato, Spinoza, La Rochefoucauld, Theognis, Tertullian, Aquinas, Dante, Luther.
- Core concepts: ressentiment, slave revolt in morality, master vs slave morality, will to power, ascetic ideal, bad conscience, the sovereign individual, "beyond good and evil", the blond beast, internalization of instinct, creditor/debtor, the priestly caste.
- Historical/philological allusions: Roman vs Judea, the etymological derivation of value-words from social rank, the reference apparatus (Kaufmann's editorial footnotes carry `bibliography` cards).
- Do NOT paraphrase the visible sentence. Add the missing genealogy/etymology/prerequisite/mechanism.

## Volume
Aim for roughly 5-8 high-quality T2 annotations per part file (fewer if the part is short, e.g. the final short parts). Quality over quantity; drop weak cards.

## Do NOT
- Do NOT run project gates, formatters, linters, or the validator (the orchestrator gates once at the end).
- Do NOT edit any sqlite db or touch any live server.
- Do NOT create .md docs.

## Self-check before finishing
Programmatically verify EACH anchor is a substring of its block text from the `.input.json`. A quick way (node/bun):
read the input.json, build `text = block.text` for the block_key, assert `text.includes(anchor)`. Fix any miss by trimming the anchor to a clean verbatim single-line phrase. Report any anchor you could not place.
