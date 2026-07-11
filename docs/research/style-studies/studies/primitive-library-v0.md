# Style Studies primitive library v0

A primitive is a parameterized rule, not a copied motif. Evidence labels refer either to item IDs in [source-evidence-index.json](source-evidence-index.json) or to named PE/NR cluster sections in the two source studies; recipes should resolve them to exact item IDs before generation. Every primitive must expose its data/method and retain meaning in reduced motion, high contrast, keyboard, touch, and non-spatial alternatives.

## P01 — Tri-role typography

- **Purpose:** separate authored/editorial reading, operational signals, and metadata.
- **Inputs/parameters:** `{editorial_face, signal_face, mono_face, size_scale, measure, script_coverage, numeral_style}`.
- **Grammar:** editorial serif or humane text face for sustained reading; severe/squared display only for short signals; mono for locators, commands, measurements, and code. Mixed scripts use fonts with verified glyph coverage.
- **Motion/interaction:** type itself stays stable; headings may enter with their content module, never scramble.
- **Accessible fallback:** user text scaling; minimum essential-text size; plain labels alongside symbols.
- **Failure modes:** microtype for essential claims; monospace everywhere; faux-terminal prose; random glyphs.
- **Evidence:** PE-SEMANTIC, PE-HYPO, NR-RELEASE, NR-EDITORIAL. **Streams:** all.

## P02 — Calibrated viewport

- **Purpose:** inspect one object, concept, or state with truthful coordinates/scale.
- **Inputs:** `{subject, axes?, units?, bounds, view, overlays, evidence}`.
- **Grammar:** bounded field, restrained ticks/rules, one focal specimen, peripheral metadata.
- **Motion:** rotate, transform, or change parameter while axes remain stable.
- **Interaction:** keyboard/touch view changes; reset; inspect overlay provenance.
- **Fallback:** ordered parameter table plus static orthographic frames.
- **Failure modes:** decorative coordinates, uncontrolled camera, unlabeled units, essential content only in 3D.
- **Evidence:** PE-POSSIBILITY, NR-SPECIMEN. **Streams:** Primer, Companion, Playground.

## P03 — Provenance trace

- **Purpose:** show ordered events and recover the record behind every mark.
- **Inputs:** `{events[id,time,kind,source,confidence], encoding, focus, truncation}`.
- **Grammar:** stable authored/clock axis; color/size only for declared fields; selected mark opens exact record and method.
- **Motion:** accumulate in order or replay at controlled speed; no autonomous endless drift.
- **Fallback:** sortable ordered event list with identical records.
- **Failure modes:** semantic distance presented as objective; missing raw event; 3D occlusion; animation changes order.
- **Evidence:** PE-CREATIVITY, PE-GRAPH, graph prototype brief. **Streams:** all.

## P04 — Bounded evidence neighborhood

- **Purpose:** answer “what is directly connected, and how?” without global graph spectacle.
- **Inputs:** `{focus_id, typed_relations, hop_limit, method_filters, limit}`.
- **Grammar:** one pinned focus, relations grouped/labeled by predicate and method, stable survivors on expansion.
- **Motion:** deliberate one-group/one-hop reveal.
- **Interaction:** pin, expand/collapse, filter, back-to-source, copy manifest.
- **Fallback:** typed relation rows or matrix.
- **Failure modes:** all nodes at once; nearness as meaning; mixed edge types; hover-only focus.
- **Evidence:** PE-ARENA, PE-CREATIVITY, graph creation-engine contract. **Streams:** Primer, Companion.

## P05 — Radial scope map

- **Purpose:** show bounded corpus location and loaded scope, not importance.
- **Inputs:** `{ordered_groups, loaded_segments, focus, density, media_refs}`.
- **Grammar:** concentric or orbital bands correspond to explicit grouping; side rail/grid holds selected items.
- **Motion:** focus transition keeps ring assignment stable; loaded bands draw in once.
- **Fallback:** nested outline and thumbnail/list rail.
- **Failure modes:** radial distance implying importance; illegible labels; infinite zoom; decorative orbits.
- **Evidence:** PE-ARENA recovered frames. **Streams:** Primer, Playground.

## P06 — Seeded field / parameter sweep

- **Purpose:** compare a generator’s behavior rather than cherry-pick one output.
- **Inputs:** `{generator_version, seed, parameters, constraints, source_snapshot}`.
- **Grammar:** output plus visible seed/parameter manifest; comparison grid changes one variable at a time.
- **Motion:** scrub, replay, regenerate; deterministic where promised.
- **Fallback:** representative stills and parameter/delta table.
- **Failure modes:** seed hidden; uncontrolled randomness; outputs mistaken for facts; copied source imagery.
- **Evidence:** PE-HYPO, PE-POSSIBILITY, Poet’s explicit generative-system guidance. **Streams:** Playground, Companion experiments.

## P07 — Gesture trail instrument

- **Purpose:** make continuous input and system response jointly visible.
- **Inputs:** `{input_stream, transform, smoothing, decay, bounds, latency_budget}`.
- **Grammar:** current gesture, recent trail, and transformed field are distinguishable; color encodes state only when labeled.
- **Motion:** low-latency trace with adjustable decay; no ornamental idle animation.
- **Interaction:** direct manipulation, pause, clear, record/replay, inspect transform.
- **Fallback:** keyboard sliders and recorded-step playback; static before/after.
- **Failure modes:** lag, motion sickness, unbounded particles, inaccessible gesture-only control.
- **Evidence:** PE-GESTURE and PE-POSSIBILITY recovered frames. **Streams:** Companion, Playground.

## P08 — Modular instrument panel

- **Purpose:** sequence capability/state/evidence inside a stable shell.
- **Inputs:** `{title, status, modules[], accent_role, progress?, provenance}`.
- **Grammar:** stable frame and anchors; one claim per module; essential content at readable size; ornament follows actual state.
- **Motion:** content-module substitution or progressive disclosure; focus is preserved.
- **Fallback:** semantic headings and stacked sections; reduced motion uses instant replacement plus status announcement.
- **Failure modes:** fake restricted labels, meaningless telemetry, warning theater, nested panels.
- **Evidence:** NR-RELEASE, NR-CAPABILITY. **Streams:** Companion, Playground; sparingly Primer.

## P09 — Specimen + evidence windows

- **Purpose:** pair a focal artifact with supporting observations.
- **Inputs:** `{specimen, windows[type,content,source], measurements, selected_window}`.
- **Grammar:** dominant central field; asymmetric peripheral windows; crisp overlays over media; visible origin for each window.
- **Motion:** scan/focus or swap windows; never degrade essential text.
- **Fallback:** figure with captioned evidence list.
- **Failure modes:** surveillance mood without evidence; unlabeled imagery; grain hiding detail; too many windows.
- **Evidence:** NR-SPECIMEN. **Streams:** Primer reference desk, Companion artifact review, Playground.

## P10 — Scan / radar / trace motion

- **Purpose:** reveal acquisition, traversal, or change over time.
- **Inputs:** `{domain, current_position, history, rate, completion, uncertainty}`.
- **Grammar:** moving indicator only when a real process advances; history remains as trace; uncertainty has a separate treatment.
- **Motion:** linear scan, radial sweep, route highlight, or field accumulation chosen by data topology.
- **Fallback:** progress/state text, ordered steps, completed/pending marks.
- **Failure modes:** perpetual sweep, false progress, seizure risk, color-only status.
- **Evidence:** PE-GRAPH, PE-POSSIBILITY, NR-SPECIMEN, NR-RELEASE. **Streams:** all.

## P11 — Dossier / source scrap

- **Purpose:** place exact excerpts, commentary, metadata, and unresolved references together without confusing provenance.
- **Inputs:** `{kind, exact_text?, commentary?, locator, author, method, confidence, acquired}`.
- **Grammar:** visibly distinct scrap kinds; locator and evidence tier persist; texture belongs to container/media, not body text.
- **Motion/interaction:** expand one scrap; compare; jump to source; copy citation.
- **Fallback:** semantic article/list with explicit kind headings.
- **Failure modes:** commentary styled as quotation; random rotation; illegible xerox effect; source absent.
- **Evidence:** NR-SPECIMEN/EDITORIAL and Primer Source Genealogy Desk. **Streams:** Primer, Companion.

## P12 — Stateful ambient avatar

- **Purpose:** make background agent state perceptible without demanding attention.
- **Inputs:** `{state: idle|working|waiting|done|failed, label, last_event, reduced_motion}`.
- **Grammar:** shape/pose plus text/icon; optional character skin is replaceable and non-semantic.
- **Motion:** brief state transition, then still or very low-rate ambient behavior.
- **Fallback:** textual status, icon, timestamp; live-region announcements only for meaningful changes.
- **Failure modes:** copied mascot, constant motion, cute failure ambiguity, state conveyed only by color.
- **Evidence:** NR-PETS. **Streams:** Companion, Playground.

## P13 — Terminal/codegen cue

- **Purpose:** expose real commands, generated code, logs, transforms, or diffs.
- **Inputs:** `{mode: command|log|code|diff, content, execution_state, provenance}`.
- **Grammar:** mono type, syntax roles, copy/run only where safe, clear separation of input/output.
- **Motion:** stream real events; pause/autoscroll controls; completion state.
- **Fallback:** preformatted text with accessible labels and downloadable artifact.
- **Failure modes:** fake commands, decorative cursor, uncontrolled streaming, terminal vocabulary for ordinary settings.
- **Evidence:** PE-HYPO source-code artifact; NR-CAPABILITY real terminal/desktop demonstrations. **Streams:** Companion, Playground; Primer provenance details only.

## P14 — Editorial diagram plate

- **Purpose:** explain a method or compare evidence with publication-grade hierarchy.
- **Inputs:** `{claim, figure, legend, caption, caveat, sources, palette_family}`.
- **Grammar:** ruled grid, one dominant figure, serif/sans/mono role contrast, explicit legend and caveat.
- **Motion:** staged annotation or figure-state comparison; no chart junk.
- **Fallback:** static figure, data table, caption.
- **Failure modes:** campaign headline replacing evidence; unlabeled wireframe; inaccessible cobalt contrast; decorative metrics.
- **Evidence:** NR-EDITORIAL and PE-CREATIVITY. **Streams:** all.

## Composition rules

Primitives combine only when their semantics remain independently inspectable. A `DossierScrap` may open from a `ProvenanceTrace`; a `CalibratedViewport` may host a `SeededField`; an `InstrumentPanel` may contain a real `TerminalCue`. Do not stack visual signifiers merely for density. Each recipe declares: question, source records, encodings, palette family, type roles, motion recipe, accessibility projection, omissions, and source snapshot.
