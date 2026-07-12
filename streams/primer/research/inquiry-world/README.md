# Inquiry World research

This directory is the durable research home for Inquiry World: the shared representation contract, landscape research, interaction grammar, implementation briefs, and source archive.

## Reading order

1. `README.md` — orientation, file map, and current implementation scope.
2. `representation-landscape.md` — why this representation approach exists and what prior art it borrows or rejects.
3. `inquiry-world-contract.md` — durable objects, relations, provenance, lenses, routes, placements, and snapshots.
4. Chosen brief:
   - `atlas-of-inquiry-brief.md` for spatial exploration and orientation.
   - `argument-world-brief.md` for issue-centered disagreement and conceptual pressure.
   - `construction-studio-brief.md` for learner-authored source-backed construction.

The `sources/` folder is the evidence archive. Read it when checking provenance, not as the primary product specification.

## Flat file map

- `representation-landscape.md` — representation and epistemic-interface landscape.
- `didactic-jobs.md` — learning jobs and tool-for-thought requirements.
- `tactile-spatial-grammar.md` — tactile/spatial interaction grammar.
- `inquiry-world-contract.md` — canonical data and behavior contract.
- `atlas-of-inquiry-brief.md` — Atlas implementation brief.
- `argument-world-brief.md` — Argument World implementation brief.
- `construction-studio-brief.md` — Construction Studio implementation brief.
- `sources/manifest.md` — source archive manifest and coverage notes.
- `sources/bret-victor-explorable-explanations.md` — Bret Victor source archive.
- `sources/andy-matuschak-situated-ideas.md` — Andy Matuschak source archive.
- `sources/andy-matuschak-enabling-environments.md` — Andy Matuschak enabling-environments source archive.

## Implementation scope

The first implementation is desktop-first: the UI uses the full available desktop window and adapts to whatever viewport exists, while knowledge worlds remain unbounded 2D spaces that may extend beyond the viewport in both axes. Mobile requirements remain preserved in the design research and briefs, but mobile implementation is deferred rather than part of the first build.
