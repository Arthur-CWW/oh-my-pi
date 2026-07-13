> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-10T00-06-24-364Z_019f4958-cd6c-7000-b731-fd40d40b2e74/local/reader-design-sol/report.md

# Wrapped-commentary reader proposal

## Run metadata

- Model: `openai-codex/gpt-5.6-sol`
- Wall-clock duration: unavailable
- Input tokens: unavailable
- Output tokens: unavailable
- Cache tokens: unavailable
- Actual cost: unavailable
- Build, formatter, tests, and browser QA: not run, per benchmark constraints

## Files and symbols changed

- `candidate/reader.tsx`
  - `App`: calmer two-level masthead, responsive reader shell, stable feedback footer
  - `UnifiedReadingCanvas`: fluid editorial three-column measure, reduced gutter chrome, clearer chapter/page hierarchy
  - `AnnotationCard`: title and explanation lead; metadata, provenance, and actions recede into expanded marginalia
  - `FeedbackToolbar`: fixed overlay replaced by an in-flow footer edge
  - `SelectionToolbar`: slim context dock with inspect/remove, concise provenance, quiet instruction, Copy OMP, and secondary actions behind disclosure
  - Diff: +117 / -163 lines
- `candidate/index.css`
  - Added editorial layout, interaction, responsive, terminal-preserving, and reduced-motion rules
  - Diff: +201 / -0 lines
- `proposal.patch`
  - Unified baseline-to-candidate patch; 575 lines

## Design rationale

The proposal treats the authored page as the visual ground and annotations as pencil-like editorial apparatus rather than miniature CRM cards. The center measure grows and gains calmer leading; block boundaries become faint paper rules rather than repeated three-lane dividers. Margin notes lose card fills and permanent action clusters. Their titles and claims read first, while explanation, source, taxonomy, locate, and OMP controls appear only when opened. The same active treatment now joins text and note through the primary-colored rail without adding a second card frame.

The masthead is deliberately book-first: title is set as the primary line; author, chapter, and page form the subordinate bibliographic line. Search, graph, theme, and metadata remain intact but visually quieter. The context attachment behaves like a docked structured chip: exact book/unit/block/range and quote are always visible, provenance is bounded, the instruction stays single-line and quiet, and Copy OMP remains the primary action. Save/Note/Vocab/Concept/Quote/Card move behind “More actions.” Feedback labels occupy a stable footer and never cover prose.

At 900px and below the map and marginal columns disappear so prose receives the viewport. At phone width the context dock becomes a wrapping three-column arrangement with its instruction on a full row. Terminal mode retains the existing token palette, monospace inheritance, square corners, and shadow suppression. Motion is restrained and disabled under reduced-motion preferences.

## Deliberate tradeoffs

- Mobile hides marginal columns rather than reflowing every note under its source block. This protects reading flow and preserves all annotation data/functions for wider layouts, but mobile annotation discovery remains dependent on the existing alternate surfaces.
- The context dock remains fixed so selection context stays actionable while scrolling; unlike the previous form, its collapsed height is small and feedback remains in document layout.
- Native `details` provides keyboard-operable disclosures with minimal new state. It keeps provenance and secondary actions independent, at the cost of browser-native disclosure semantics rather than a custom coordinated accordion.
- Existing category color rails remain because they encode meaning across themes, but fills and chips are substantially quieter.

## Remaining debt

- This benchmark candidate has not been built or visually inspected by this designer, as required by the portfolio constraints. Main should specifically inspect long annotation text, open provenance plus open secondary actions, 900px transition behavior, 390px wrapping, keyboard focus, and terminal mode.
- The mobile experience still lacks an explicit marginalia drawer; adding one would exceed the no-redesign constraint and should only follow evidence that mobile note access is inadequate.
- CSS `:has()` is used only to place the Copy button in the phone dock. Chromium supports it; if broader legacy browser support becomes a requirement, give the button a stable class instead.
