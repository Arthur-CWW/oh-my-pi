# Style Studies creation-engine brief v0

## Objective

Encode evidence-backed style studies as inspectable parameters, tokens, and grammars—not a “Poet × Nous” theme. The engine should generate materially different prototypes from the same source observations while preserving provenance, semantic honesty, accessibility, and Arthur’s scoped labels.

This extends Primer’s [graph creation-engine brief](../../../../streams/primer/wrapped-commentary-reader/experiments/graph-creation-engine/prototype-brief.md): a view begins with a reader question and typed records; projection changes representation, not facts. Primer’s [intent](../../../../streams/primer/INTENT.md) keeps authored work central and Arthur’s prior plural/corrigible. The [design log](../../../../streams/primer/DESIGN-LOG.md) requires model portfolios rather than a single-model design assumption.

## Parameter model

```text
StudyManifest
  source_snapshot + rights/boundaries
  campaigns[] + collaborators[]
  observations[] { layer, claim, evidence_ids, confidence }
  hypotheses[] { lineage, evidence_for, counterevidence, status }

Grammar
  type_roles
  palette_family
  spatial_recipe
  diagram_semantics
  texture_policy
  temporal_recipe
  interaction_contract
  accessibility_projection

PrimitiveRecipe
  question + stream + records
  primitive_ids[] + parameter values
  forbidden_claims[] + omissions[]
  provenance_policy + responsive policy

PrototypeManifest
  recipe_hash + source_hashes + model + prompt/version
  generated_assets + runtime parameters
  screenshots/proof + Arthur labels
```

### Token families, not one skin

- **Type:** `editorial`, `signal`, `annotation`, `mono`, `script`; each has size/measure/weight and glyph-coverage constraints.
- **Palette families:** `ink-instrument`, `paper-cobalt`, `photographic-glyph`, `warm-gesture`; accents have semantic roles and contrast targets. No source logo colors are mandatory.
- **Spatial grammars:** `ordered-lanes`, `bounded-neighborhood`, `radial-scope`, `calibrated-viewport`, `specimen-windows`, `editorial-plate`.
- **Temporal grammars:** `accumulate`, `scan`, `route-highlight`, `parameter-morph`, `module-substitute`, `montage-resolve`, `state-transition`.
- **Texture:** separate `media_treatment` from `text_surface`; essential text never receives grain/dither/glitch.
- **Disclosure:** `overview → focus → evidence → source`, with explicit truncation and stable Back.

## Creation loop

1. **Source manifest:** register local/canonical path, author/collaborator, media type, hash, access boundary, and permitted analytical use.
2. **Observation cards:** atomize only observable claims across typography, composition, color, texture, time, interaction, and production. Attach frame/time ranges when available.
3. **Clustered grammar:** group repeated devices by function and campaign. Keep lineage hypotheses separate from formal resemblance.
4. **Primitive recipe:** choose primitives for one product question; declare exact inputs, encodings, parameters, fallback, and failure conditions.
5. **Generated prototype:** emit executable variant plus manifest. No copied source assets, marks, characters, or layout tracing.
6. **Model portfolio:** multiple models receive the same recipe/records; compare semantic fidelity, interaction, accessibility, and visual range—not only polish.
7. **Arthur label:** `keep`, `reject`, `edit`, `interesting_wrong`, with stream/task/date and free-text reason. Never collapse labels into a global taste score.
8. **Adoption:** promote only the successful primitive/parameter decisions into a stream-specific implementation with its own QA.

## Engine controls and inspectability

- Source/campaign filters; confidence floor; collaborator inclusion toggle.
- Question and semantic level before style controls.
- Primitive inclusion/exclusion and parameter diff.
- Seed lock; one-variable sweeps; reproducible recipe hash.
- Side-by-side semantic projection (spatial, list, matrix) over identical records.
- Motion timeline with reduced-motion preview.
- Palette/type contrast and text-scale checks before generation.
- “Why is this here?” on every derived mark.
- Exported omissions: unavailable media, unresolved source association, unsupported relation semantics.

## Bounded executable prototypes

### B1 — Primer / Passage Signal Plate

- **Question:** What evidence may help with this passage without displacing authored reading?
- **Primitives:** P01 Tri-role Typography, P09 Specimen + Evidence Windows, P11 Dossier Scrap, P14 Editorial Diagram Plate.
- **Interactions:** select passage; open one annotation/concept/source window; inspect reason/provenance; jump back; toggle all overlays off.
- **Data:** current Reader IR block, annotation anchors, concept anchors, raw refs, evidence tier. No generated excerpt.
- **Success:** source remains dominant; helper provenance is understood; one useful helper and return within two actions.
- **Failure:** commentary resembles source quotation; more than one screen before disclosure; mood texture impairs prose.
- **Mobile:** full-width passage with bottom-sheet tabs. **Reduced motion:** instant disclosure; no scan.

### B2 — Primer / Recurrence Orbit vs Lane

- **Question:** Does a radial scope map reveal recurrence without overclaiming better than an ordered lane?
- **Primitives:** P03 Provenance Trace, P05 Radial Scope Map, P10 Scan/Trace.
- **Interactions:** switch orbit/lane while preserving focus; filter match method; select occurrence; back-to-source; compare two terms.
- **Data:** deterministic literal matches, stored anchors, annotation refs, unit/page order, method labels.
- **Success:** users distinguish stored, literal, and heuristic occurrences and retain authored order.
- **Failure:** radius implies importance; empty units disappear; camera navigation replaces semantic zoom.
- **Mobile:** vertical sticky-unit lane is primary; orbit is an optional summary. **Reduced motion:** completed trace shown statically with current focus.

### B3 — Primer / Source Genealogy Worktable

- **Question:** Which source machinery is invoked here, and what evidence supports each resolution?
- **Primitives:** P04 Bounded Evidence Neighborhood, P09 Specimen Windows, P11 Dossier Scrap, P13 Terminal Cue only for real acquisition/provenance commands.
- **Interactions:** focus raw ref; accept/reject local candidate resolution; expand one typed neighbor; compare declared vs seed assertion; copy bibliographic query.
- **Data:** raw refs, seed entities/edges/why, local metadata, acquisition hints.
- **Success:** every connector exposes method; unresolved stays unresolved; source choice becomes easier.
- **Failure:** seed graph looks like verified intellectual history; commentary masquerades as excerpt; fake command output.
- **Mobile:** breadcrumb drill-down and stacked scraps. **Reduced motion:** no edge drawing; disclosure rows.

### B4 — Companion / Agent Process Observatory

- **Question:** Can process history and current state be ambiently legible without becoming a control-room costume?
- **Primitives:** P03 Provenance Trace, P08 Modular Instrument Panel, P10 Scan/Trace, P12 Stateful Ambient Avatar.
- **Interactions:** inspect current state; pause trace; open exact event/tool artifact; acknowledge waiting/failure; filter human vs agent events.
- **Data:** real session/job events, timestamps, tool/action kinds, decision gates, failures. No synthetic “confidence.”
- **Success:** current state and last meaningful event are legible at a glance; every mark resolves to an event.
- **Failure:** perpetual radar; mascot obscures failure; fake telemetry; attention demand while idle.
- **Mobile:** compact status header + event list; decision actions meet touch targets. **Reduced motion:** pose/icon/text changes only; no ambient loop.

### B5 — Companion / Fork Field Comparator

- **Question:** When models propose alternatives, can the interface expose breadth and provenance without pretending embedding distance equals value?
- **Primitives:** P02 Calibrated Viewport, P03 Provenance Trace, P06 Seeded Field, P14 Editorial Plate.
- **Interactions:** compare model outputs; select explicit dimensions; inspect source/prompt; label keep/reject/edit; switch geometry to table.
- **Data:** immutable run manifests, outputs, model/prompt versions, optional declared embeddings with method, Arthur labels.
- **Success:** users can explain every axis/volume; labels attach to exact run; table and spatial views contain the same facts.
- **Failure:** cube size becomes “creativity”; hidden normalization; 3D occlusion; portfolio collapsed to a winner without reasons.
- **Mobile:** comparison cards/table, no miniature 3D. **Reduced motion:** static parameter states and step controls.

### B6 — Playground / Generative Grammar Bench

- **Question:** Can distinct recipes produce diverse, recognizable behaviors without copying either source brand?
- **Primitives:** P01, P02, P06, P07 Gesture Trail, P08, P10, P13, P14.
- **Interactions:** choose question/grammar; lock seed; sweep one parameter; live gesture or recorded input; compare 3–4 outputs; inspect recipe/source evidence; export manifest.
- **Data:** synthetic geometry clearly labeled as demo data, or user-provided trace; no source media binaries/logos/glyph art.
- **Success:** variants differ in spatial/temporal grammar, not just palette; identical seed/recipe reproduces output; evidence and failures are visible.
- **Failure:** default converges on black/cyan HUD; copied calligraphy/mascot/logo; parameter labels have no perceptual consequence.
- **Mobile:** parameter groups as progressive disclosure; recorded gesture playback. **Reduced motion:** still keyframes and manual step/scrub.

## Evaluation and adoption gate

Each prototype records: task answer rate, encoding comprehension, provenance recovery, keyboard/touch completion, overflow at desktop/tablet/phone, contrast/text scaling, reduced-motion parity, and Arthur’s scoped label. A visually compelling result that invents semantics, loses authored order, lacks a non-spatial projection, or cannot explain source influence fails. Adoption extracts the minimum successful primitives and tokens; it never imports the whole prototype aesthetic.
