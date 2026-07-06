# Primer — stream charter

The perfect-tutor stream (Diamond Age). Owned by one Fable session at a time; read with [`docs/fable/charter.md`](../../docs/fable/charter.md) and [`docs/state/creative-framing.md`](../../docs/state/creative-framing.md).

## Goal

The archive (Twitter/X, browser history, transcripts, SRS, library) is the **substrate**; the product is a tutor that pushes Arthur's frontier — **Chinese (HSK), maths, physics, deep engagement** — and gives agents the same queryable shared memory. Reading without memory isn't accretive ("just vibes"); the Primer exists so engagement compounds. Funes is the warning: structured memory (SRS, annotation, compression), never raw recall.

## Non-functional requirements

- Memory must be *structured*: cards, annotations, concept compression — accretion over collection.
- The **dæmon** substrate (browser history, Tree Style Tab trees, attention events → queryable SQLite) feeds all streams; it lives here.
- Local-first, provenance-preserving (Nelson-style: everything linked to its source).
- Respectful capture: low concurrency, dedupe, no private/locked content (existing twitter-archive rules).

## Settled (2026-07-06, Arthur)

- **Own the SRS surface** — reverses the earlier "feed mochi/anki" leaning. Anki's ceiling (no popup dictionary, dead shortcuts, atomic-only, no context tie-back) was the real constraint on the HSK deck. Deck material linked under `decks/` (hsk-deck, mochi exports, yomitan); we design on our own reader/queue/review loop.
- First interface: agent-queryable, then Arthur-browsable — both shipped (daemon CLI + dashboard).
- **Vertical one: Chinese** (paste-first reading environment); math/PreTeXt second. Scheduler borrowed (hashcards/FSRS), never invented. No Yomitan fork — in-reader dictionary. Mobile via Tailscale, no public UUID URLs.
- Full design space and vibe record: [`VISION.md`](VISION.md).

## First goal

**The dæmon answers.** DONE 2026-07-03 — see `docs/qa/primer-daemon-first-answers.md`. Second surface (dashboard + streaming + reader re-mount) DONE 2026-07-06 — `docs/qa/primer-dashboard.md`. Next arc: the Chinese reading loop (VISION.md §Sequencing).

## Owns

`packages/twitter-archive/`, `packages/borges-library/`, `packages/primer-daemon/`, `browser-extensions/extensions/twitter-archive-firefox/`, `data/twitter-archive/`, `data/primer/` (daemon ledger, gitignored), `docs/plans/primer-intuitions.md`, `docs/twitter-archive-plan.md`, this directory (incl. the relocated `wrapped-commentary-reader/`).

## Excludes

Other `streams/*`. External learning apps (`~/apps/mochi-lite`, `~/apps/hsk-deck`, …) are read/feed targets, not owned code — edit them only in their own sessions.

## Map

Distilled session intuitions: `docs/plans/primer-intuitions.md`. Annotation reader + saved transcript/podcast artifacts: `wrapped-commentary-reader/` (relocated here from `~/exploratory/systems/`). Dæmon prototype: `~/exploratory/browser-context-sync/` (vision, Arthur-Primer ontology, source-trust docs; sync SQLite at `~/state/browser-context/browser_context.sqlite`). **Dæmon query path: `packages/primer-daemon/`** — `bun run cli ask "..."` (in-package; dashboard: `bun run dev` → http://primer.localhost:1355) answers from browser-context + twitter archive + reader annotations with provenance; write-back ledger at `data/primer/daemon-ledger.sqlite`; proof: `docs/qa/primer-daemon-first-answers.md`. Feedstock and linked repos: [`INDEX.md`](INDEX.md); fuller externals in [`docs/fable/external-inventory.md`](../../docs/fable/external-inventory.md). Skills: `browser-context-sync`, `sideline-annotation-card`, `wrapped-commentary-learning-card-db`, `audio-diarization-pipeline`.
