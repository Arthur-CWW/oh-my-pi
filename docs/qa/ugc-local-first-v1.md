# UGC Local-First V1 Proof

Generated during the React data-binding/local-first workstream.

## Claims Covered

- UGC Studio has a repo-local JSON store for workspace, personas, branches, candidates, notes, provider jobs, reference archives, and export manifests.
- The daemon exposes local-first UGC routes under `/api/ugc/*`.
- The React route loads `/api/ugc/workspace` when the daemon is available and falls back to the fixture when it is not.
- Review, persona/profile-bible, branch note/status, provider, reference archive, and export-manifest actions write back through daemon routes.
- The visible workspace includes Persona Atlas, Exploration Board, Batch Review, Campaign Branch Map, Reference Archive, Final Layer Editor, Developer Graph, and KIE Proxy views.
- The inspector exposes editable persona profile-bible fields for niche, voice style, accent, and energy, plus editable campaign branch decision notes.

## Verification

- `bun run slotok:typecheck` — passed.
- `bun run slotok:test` — passed.
- `bun run slotok:build` — passed.
- `cd apps/slotok-workbench && bun run visual:qa` — passed with `40/40` checks.

## Visual Artifacts

See `docs/qa/slotok-visual-qa.md`.

Screenshots are written under ignored local artifacts:

- `artifacts/slotok-visual-qa/latest/01-persona-atlas.png`
- `artifacts/slotok-visual-qa/latest/02-exploration-board.png`
- `artifacts/slotok-visual-qa/latest/03-batch-review.png`
- `artifacts/slotok-visual-qa/latest/04-campaign-map.png`
- `artifacts/slotok-visual-qa/latest/05-reference-archive.png`
- `artifacts/slotok-visual-qa/latest/06-final-editor.png`
- `artifacts/slotok-visual-qa/latest/07-developer-graph.png`
- `artifacts/slotok-visual-qa/latest/08-kie-proxy.png`

## Local Data Artifacts

The visual QA daemon creates ignored local JSON under:

- `data/ugc-studio/workspaces/workspace_protein_bar_ads/state.json`
- `data/ugc-studio/workspaces/workspace_protein_bar_ads/workspace.json`

The store also writes object shards under:

- `personas/`
- `campaigns/`
- `branches/`
- `candidates/`
- `notes/`
- `provider-jobs/`
- `reference-archives/`
- `exports/`
- `assets/{source,generated,exports}/`

## Cost / Provider Policy

Provider calls remain dry-run-first. The UI can call KIE with explicit live cap, but this proof did not spend KIE, Gemini, or Jimeng credits.
