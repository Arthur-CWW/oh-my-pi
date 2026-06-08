# Slotok Design Language State

Durable UI/design preference ledger for Slotok Workbench.

## Maintenance rule

Update this when Arthur gives durable product/UI taste direction for Slotok. Keep it opinionated and compact. Do not let future agents drift back into generic dashboard, neon cyberpunk, or chunky AI-generated card soup.

## Current north star

Slotok should visually feel much closer to the **Codex light workbench UI** than the first dark/orange scaffold.

Primary reference:

```txt
docs/design/slotok/references/codex-light-workbench-sidebar.png
```

Secondary references for dense AI-eval/product workflows:

```txt
docs/design/slotok/references/arcads-logs-dark-split-pane.png
docs/design/slotok/references/arcads-playground-dark-columns.png
```

## Design language

Name:

```txt
Native calm workbench
```

One-line vibe:

```txt
A clean, native-feeling AI engineering workspace: light, quiet, fast, text-first, with just enough structure to review lots of artifacts without feeling like an analytics dashboard.
```

## What Arthur prefers

- The **Codex-style light UI is the preferred direction**.
- Left project/session sidebar with soft gray background.
- Main canvas is mostly white/off-white, spacious, readable, and document-like.
- The **central selected data must dominate the screen**. Slotok is closer to a data-labeling/review tool than a marketing dashboard: when flipping through elements, the user is trying to inspect the primary artifact/data at a glance.
- Sidebars are supporting context only. Left/right rails may contain navigation, run lists, metrics, paths, and actions, but they must not compete with the center canvas.
- Thin borders, subtle cards, restrained shadows.
- Rounded but not bubbly: medium radii, native macOS-ish restraint.
- Text-first hierarchy; content should do the work, not decorative panels.
- Sparse accent color, used for selected items, links, status dots, and small affordances.
- Floating/right-side environment or inspector panel is good when it feels lightweight.
- File/change/result cards like Codex are good references for artifacts, diffs, run outputs, and generated assets.
- Dense information is fine, but it should feel like a polished editor/workbench, not a BI dashboard.

## What to avoid

- The current dark Slotok shell aesthetic: orange/gold accents, heavy black panels, oversized metric cards, generic “AI dashboard” energy.
- Neon/cyberpunk gradients unless a specific media preview demands it.
- Big ornamental hero panels.
- Oversized central cards for non-primary metadata, run summaries, shortcuts, or metrics.
- Making the element list/detail chrome larger than the media/provider output being reviewed.
- Chunky high-contrast cards everywhere.
- Overdesigned brand marks and decorative chrome.
- “Analytics dashboard” layout as the default mental model.

## How to use the references

### Codex light workbench — primary

Use for:

- app shell proportions
- sidebar density
- typography tone
- artifact/change cards
- conversation/document-like center column
- native macOS visual restraint
- light theme defaults

Translate to Slotok as:

```txt
left nav / project tree / compact element queue
+ central review canvas where selected input/artifact/provider output is huge
+ right inspector/environment/actions panel
+ bottom command/input/rerun bar later
```

The center should answer first: “what am I labeling/reviewing right now?” Everything else is secondary.

### Arcads logs dark split-pane — secondary

Use only for specific dense eval/log modes:

- table + detail split-pane pattern
- trace/thread/timeline tabs
- compact filtering toolbar
- selected row/detail relationship

Do not copy the overall darkness as the default Slotok identity.

### Arcads playground dark columns — secondary

Use for:

- provider/model comparison columns
- experiment variants
- side-by-side prompt/system/user blocks

This may become a dark comparison mode or embedded eval view, not the main app default.

## Practical Slotok redesign target

For the next UI pass:

1. Keep the Codex-like light frame.
2. Treat the middle as a **review canvas**, not a dashboard/document landing page.
3. Put the selected element's primary artifact/input data in the center at the largest useful size: video/frames/image/output first, metadata second.
4. Move element navigation to a compact queue/filmstrip/list that supports fast `j/k` flipping without taking over the canvas.
5. Keep sidebars for navigation, run context, metrics, paths, and actions only.
6. Make metric data quiet and inline instead of giant cards.
7. Keep keyboard-first behavior, but visually hide shortcut noise unless helpful.

## Dated notes

### 2026-06-08

Arthur said the generated Slotok design was “super ugly” and explicitly preferred the third provided screenshot, clarified as **Codex**. The Codex light workbench screenshot is now the primary visual reference for Slotok.
