# Primer — stream charter

The perfect-tutor stream (Diamond Age). Owned by one Fable session at a time; read with [`docs/fable/charter.md`](../../docs/fable/charter.md) and [`docs/state/creative-framing.md`](../../docs/state/creative-framing.md).

## Goal

The archive (Twitter/X, browser history, transcripts, SRS, library) is the **substrate**; the product is a tutor that pushes Arthur's frontier — **Chinese (HSK), maths, physics, deep engagement** — and gives agents the same queryable shared memory. Reading without memory isn't accretive ("just vibes"); the Primer exists so engagement compounds. Funes is the warning: structured memory (SRS, annotation, compression), never raw recall.

## Non-functional requirements

- Memory must be *structured*: cards, annotations, concept compression — accretion over collection.
- The **dæmon** substrate (browser history, Tree Style Tab trees, attention events → queryable SQLite) feeds all streams; it lives here.
- Local-first, provenance-preserving (Nelson-style: everything linked to its source).
- Respectful capture: low concurrency, dedupe, no private/locked content (existing twitter-archive rules).

## Open questions

- SRS loop built into this ecosystem vs generating cards into mochi-lite/anki? (leaning: feed existing apps first; the substrate is the moat, not the review UI)
- First interface: agent-queryable (tool/MCP) or Arthur-browsable (UI)?

## First goal

**The dæmon answers.** An agent that can be asked "what have I been reading about X?" and answers from the substrate (browser-context SQLite + wrapped-commentary-reader artifacts + twitter archive), with sources linked — then writes one useful thing back (an annotation or a card candidate). Query path before review UI. Proof: transcript of three real questions answered with provenance + rerun command.

## Owns

`packages/twitter-archive/`, `packages/borges-library/`, `browser-extensions/extensions/twitter-archive-firefox/`, `data/twitter-archive/`, `docs/plans/primer-intuitions.md`, `docs/twitter-archive-plan.md`, this directory (incl. the relocated `wrapped-commentary-reader/`).

## Excludes

Other `streams/*`. External learning apps (`~/apps/mochi-lite`, `~/apps/hsk-deck`, …) are read/feed targets, not owned code — edit them only in their own sessions.

## Map

Distilled session intuitions: `docs/plans/primer-intuitions.md`. Annotation reader + saved transcript/podcast artifacts: `wrapped-commentary-reader/` (relocated here from `~/exploratory/systems/`). Dæmon prototype: `~/exploratory/browser-context-sync/` (vision, Arthur-Primer ontology, source-trust docs; sync SQLite at `~/state/browser-context/browser_context.sqlite`). Feedstock and linked repos: [`INDEX.md`](INDEX.md); fuller externals in [`docs/fable/external-inventory.md`](../../docs/fable/external-inventory.md). Skills: `browser-context-sync`, `sideline-annotation-card`, `wrapped-commentary-learning-card-db`, `audio-diarization-pipeline`.
