> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-10T00-06-24-364Z_019f4958-cd6c-7000-b731-fd40d40b2e74/local/reader-design-opus/report.md

# Reader Design Portfolio — Opus Candidate

## Model
anthropic/claude-opus-4-6

## Metrics
- Wall-clock duration: single-pass implementation (no build/QA)
- Input/output/cache tokens: unavailable (no token introspection in this harness)
- Actual cost: unavailable

## Files changed
| File | Lines added | Lines removed | Net |
|------|------------|--------------|-----|
| reader.tsx | +171 | -172 | -1 |
| index.css | +107 | -6 | +101 |
| **Total** | **+278** | **-178** | **+100** |

## Symbols changed
- `App` render (header, layout grid, footer placement)
- `UnifiedReadingCanvas` (grid dimensions, sticky sub-header)
- `AnnotationCard` (full visual redesign)
- `ConceptCard` (matching visual redesign)
- `MapLane` (tighter layout for narrower column)
- `SelectionToolbar` (restructured as slim docked composer)
- `FeedbackToolbar` (moved from fixed overlay to inline footer)
- `categoryTone` (added `iconColor` field)
- CSS: added responsive breakpoints, annotation hover states, composer shadow, masthead typography, active text block treatment

## Design rationale

### Aesthetic direction
**Editorial marginalia** — the reader should feel like a well-typeset book with careful pencil notes in the margins, not a CRM dashboard with a prose column in the middle.

### 1. Calm masthead (header)
- Removed the verbose subtitle string "Unified reading canvas · annotations · feedback labels" — reader chrome should not describe itself.
- Book title uses CSS `small-caps` with gentle tracking for editorial gravitas without shouting uppercase.
- Author shown as "— Author" in a quiet subordinate position, hidden on small screens.
- Utilities (search, graph, theme, meta-labels) grouped right as ghost buttons — they recede until needed.
- Search input narrowed from w-64 to w-48 with shorter placeholder.
- Header height reduced from 44px to 40px.
- Graph toggle loses its bordered container; tags button uses ghost variant instead of outline/default toggle.

### 2. Editorial marginalia (annotations)
- **Removed card chrome**: no `bg-card/55` background, no `rounded-sm` border. Annotations are now transparent elements with only their left accent rail providing visual identity. The margin itself is their container.
- **Icon simplified**: removed the colored icon-box backgrounds (`bg-rose-100`, etc.). Icons now appear as small tinted inline glyphs next to the title, matching the rail color via new `iconColor` token.
- **Title and explanation first**: the title (10.5px semibold) and front-claim (10px) remain primary. The claim text uses `text-foreground/80` for a softer editorial tone.
- **Tags reduced**: only the category chip is shown on the summary; ontology and refs chips move inside the expanded `<details>` body.
- **Actions hidden until hover**: Eye icon removed entirely (the `<details>` open/close already reveals the back). Crosshair and Sparkles actions wrapped in `.annotation-actions` class that fades in on hover, focus-within, open, or active. This removes visual clutter from the default state.
- **Active pairing improved**: active annotation gets a left box-shadow (a thicker rail effect) and a subtle primary-tinted background. The source text block gets a matching `reader-text-active` class using `color-mix` for a 2.5% primary tint — creating a clear bidirectional pairing.
- **Border-t rules removed** from margin columns — the prose rhythm is no longer interrupted by horizontal rules extending into the gutters.

### 3. Slim docked context composer (SelectionToolbar)
- **Default state**: a slim two-part bar. The top portion shows: FileText icon + monospaced reference path + truncated quote + "Copy OMP" button + close. This is the context chip — inspectable at a glance, removable, functional.
- **Expanded state**: toggled by clicking the chip. Reveals: instruction textarea, payload preview toggle, and the full mark/candidate action row (Save, Note, Vocab, Concept, Quote, Card).
- **Width**: reduced from 820px to 780px max.
- **Height**: bounded even when expanded — payload textarea capped at `max-h-36`.
- **Position**: fixed at `bottom-7` (just above the feedback footer), centered.
- **Shadow**: a soft upward shadow via CSS `.reader-context-composer` for depth separation from the reading surface.

### 4. Feedback labels as stable footer
- **Moved from floating card** (`fixed bottom-2 left-2`) **to inline footer** — a `<footer>` element in the flex column, part of the document flow.
- **Removed card chrome**: no Card wrapper, no emerald-700 left border, no shadow, no backdrop-blur. Just a `border-t border-border/25` separator.
- **Compressed**: buttons replaced with plain `<button>` elements (no Button component overhead), h-5 height, 9px text. Input narrowed to w-36 h-5.
- **Min-height 28px**: stable visual anchor at the bottom of the screen.

### 5. Layout measure
- **Outer grid**: `grid-cols-[96px_1fr]` (was `[112px_1220px]`). Map lane narrows by 16px.
- **Inner grid**: `grid-cols-[220px_660px_260px]` (was `[260px_620px_320px]`). Prose column widens by 40px for a better reading measure (~66ch at 15.5px serif). Both margins narrow.
- **Min-width**: 1280px (was 1360px).
- **Gap**: reduced from `gap-x-4` to `gap-x-3` on the outer grid.
- **Page number**: smaller (9px vs 10px), uses `tabular-nums` and primary/70 opacity for subtlety.

### 6. Responsive behavior
- **<=900px**: Map lane hidden. Unified canvas collapses to single-column prose. Margin columns hidden. Sticky sub-header collapses to single column. Prose gets inline padding.
- **<=420px**: Context composer takes full width minus 0.5rem. Feedback footer wraps. Flex children wrap.
- **Terminal theme**: all existing terminal overrides preserved. Added square-corners rule for the new context composer.

### 7. MapLane tightening
- Removed "Map" heading label.
- Removed `short_summary` preview line — at 96px width, summaries truncated to unintelligibility anyway.
- Page numbers use mono 8px tabular-nums.
- Tighter vertical rhythm (py-0.5, space-y-0.5).

## Deliberate tradeoffs
1. **Eye icon removed from annotation summary**: the details/summary disclosure already serves as "reveal answer." One fewer icon reduces clutter at the cost of an explicit affordance for users who don't discover the click-to-expand pattern.
2. **Tags deferred to expanded state**: only the category chip shows on the summary. Ontology and refs are discoverable but not immediately visible. Prioritizes reading flow over metadata density.
3. **Feedback labels are no longer overlay**: moving them to a stable footer means they consume ~28px of vertical space permanently. This is a net win — a fixed overlay that obscures prose is worse than a thin stable footer.
4. **No inline annotations on mobile**: at <=900px, margin annotations are hidden entirely. A proper mobile annotation drawer would be the next step, but this brief forbids canvas rewrites. The functional capability is preserved via the graph view and the selection toolbar.
5. **MapLane lost its summaries**: at 96px, the one-line summaries were mostly visual noise. The chapter titles alone are a better wayfinding signal at this column width.

## Remaining debt
- Mobile annotation drawer: at <=900px, annotations are currently hidden. A bottom sheet or inline-beneath-block disclosure would serve mobile readers without a canvas rewrite.
- Keyboard navigation for annotation actions: the hover-reveal pattern works for mouse users; keyboard users rely on focus-within, which may not trigger on all assistive technology configurations.
- Reading-position indicator: the sticky sub-header shows page + chapter but a more editorial scroll-position treatment (e.g., a thin progress rail replacing the map lane on narrow viewports) would complete the responsive story.
- Annotation-to-text linking on narrow viewports: without margin columns, the bidirectional active-pairing between notes and source text loses its spatial relationship. Inline annotations below blocks (collapsed by default) would restore this.
