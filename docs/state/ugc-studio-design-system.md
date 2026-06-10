# UGC Studio Design System

UGC Studio should use a small owned shadcn-style design system instead of screen-specific CSS as the default implementation path.

## Stack

- Base primitives: shadcn/ui pattern, Radix-compatible React components, Tailwind, CVA variants.
- Owned primitives live in `apps/slotok-workbench/src/renderer/components/ui/`.
- UGC-specific composed components live in `apps/slotok-workbench/src/renderer/design-system/`.
- `components.json` in `apps/slotok-workbench/` documents the shadcn contract for this Vite app.

Do not treat shadcn as a dependency that hides styling. The project owns the copied/source components and styles them to match the UGC workbench.

## Visual Contract

- Native workbench, not SaaS dashboard.
- Compact by default: 8px controls, 11-12px labels, restrained weights, no oversized cards.
- Surfaces are mostly off-white, zinc, and pale warm gray with sparse blue selection.
- Borders and surface tint first; shallow shadows only for floating command surfaces and selected objects.
- Radius scale: controls `6px`, panels `8px`, larger canvas/floating surfaces `10-12px`.
- Letter spacing stays `0`.

## Component Rules

- New UI should start from primitives in `components/ui/` and composed workbench components in `design-system/workbench.tsx`.
- Add variants to components before introducing one-off classes.
- Prefer `Button` variants (`workbench`, `selected`, `subtle`, `ghost`, `outline`) over custom button CSS.
- Prefer `PanelCard`, `PanelHeader`, `SidebarRow`, `MetricRow`, `ScoreMeter`, `StatusBadge`, `ToolbarCluster`, and `CommandSurface` for repeated UGC workspace patterns.
- Use Tailwind overrides at call sites only for local layout. Avoid adding new `.rugc-*` selectors unless the behavior is genuinely screen-specific and not a reusable pattern.
- Raw CSS remains acceptable for complex media/timeline geometry, but basic spacing, typography, panel chrome, controls, and status states should live in variants.

## Migration Path

1. Keep current React UGC route visually stable.
2. Refactor the shell and repeated UI chunks into `WorkbenchShell`, `WorkbenchSidebar`, `WorkbenchTopbar`, `WorkbenchContent`, `WorkbenchCanvas`, and `InspectorPanel`.
3. Replace custom sidebar rows, toolbar buttons, inspector cards, score rows, and command bar with design-system components.
4. Move remaining custom CSS toward timeline/canvas/media-only responsibilities.
5. Add snapshot coverage when introducing or changing variants.

## Current Migration Status

- Route-level shell, sidebar navigation, topbar, view toolbar, inspector rail, inspector cards, metric rows, score rows, status badges, and floating command surface now use owned workbench/shadcn-style components.
- Remaining `.rugc-*` CSS in `ReactUgcStudio` should be treated as view-specific geometry for Atlas, Exploration Board, Batch Review, Campaign Map, Provider, and Final Editor internals until those patterns are promoted into reusable variants.
- New reusable chrome should not add fresh `.rugc-*` selectors; extend `components/ui/` or `design-system/workbench.tsx` first.

## Current Baseline

The first baseline components are:

- `components/ui/button.tsx`
- `components/ui/badge.tsx`
- `components/ui/card.tsx`
- `components/ui/tabs.tsx`
- `components/ui/input.tsx`
- `components/ui/select.tsx`
- `components/ui/textarea.tsx`
- `design-system/tokens.ts`
- `design-system/workbench.tsx`
- `design-system/workbench.test.tsx`
