> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-10T00-06-24-364Z_019f4958-cd6c-7000-b731-fd40d40b2e74/local/reader-design-terra/report.md

# Terra editorial reader proposal

## Portfolio metadata

- Model identifier observed: `openai-codex/gpt-5.6-terra`
- Wall-clock duration: unavailable
- Input tokens: unavailable
- Output tokens: unavailable
- Cache tokens: unavailable
- Actual cost: unavailable

## Files and symbols changed

- `candidate/reader.tsx`
  - `App`: replaces the utility-heavy header with a book-first masthead and responsive reader spread.
  - `UnifiedReadingCanvas`: widens the prose measure, removes repeated text/gutter card treatment, and makes the chapter/marginalia hierarchy explicit.
  - `AnnotationCard`: makes title and explanatory claim primary; keeps source metadata and actions quiet; gives the active source-note relationship a clear editorial rail.
  - `SelectionToolbar`: preserves all context, OMP packet, mark, candidate, and save actions while making the default state a compact attachment dock; secondary authoring actions sit behind a disclosure.
  - `FeedbackToolbar`: converts the floating label tray into a stable footer strip.
- `candidate/index.css`
  - Adds the reader-room layout, marginalia, context dock, responsive, terminal-compatible, and reduced-motion rules using the existing token vocabulary.
- `proposal.patch`: unified diff from the supplied private baseline.

## Diff size

- Added lines: 346
- Removed lines: 83
- Unified diff lines: 587

## Design rationale

The proposal treats the source as a continuous reading surface rather than a dashboard center column. The masthead retains book identity and author while allowing search, graph, theme, and metadata controls to recede. A wider serif measure and less frequent rule work create a reading-room rhythm. Marginal notes now read as annotations attached to the prose: their explanatory claim comes before category and source chips, and the active note uses one precise rail rather than a card-like halo.

The selection state uses a compact, Zed-like attachment chip showing the work, unit, block, exact range, and quoted selection. It remains removable and inspectable; inspecting exposes the bounded deterministic OMP payload. The default action row is intentionally quiet: optional instruction and Copy OMP stay present, while save/mark/candidate operations remain available in a compact disclosure without changing their handlers or packet semantics. Feedback is footer-bound, so it no longer occludes the text.

Responsive rules remove the map before prose at narrow widths, retain marginalia after the reading flow, and make the context dock wrap at phone width. Terminal rules remain authoritative because this proposal uses existing color tokens and does not add light-only color values; the existing square/monospace terminal overrides continue to apply.

## Deliberate tradeoffs

- At widths below 900px, annotations move after the prose in reading order rather than attempting a cramped side-by-side margin. This preserves access and makes prose the priority.
- The context composer remains a fixed dock only while a selection exists. This retains immediate selection affordance without the baseline's large, always visually dominant form.
- Existing Radix/Tailwind primitives and all callbacks are retained; the change focuses on structure and presentation rather than introducing new interaction state or dependencies.

## Remaining debt

- No build, test, formatter, browser QA, or git command was run, as required for this portfolio assignment.
- A live implementation pass should visually tune annotation density against real long chapters and verify the disclosure menu placement with actual browser focus behavior.
