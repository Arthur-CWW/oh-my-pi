---
name: impeccable-design-review
description: Use when designing, reviewing, or fixing frontend UI in OMP. Enforces per-project Impeccable context, shadcn/Radix-first primitives, interaction-state browser QA, screenshot review, and computed-style checks so GPT design work does not ship obvious UI/UX bugs.
---

# Impeccable Design Review for OMP

Use this skill for any UI/UX work in OMP: redesigns, layout fixes, responsive fixes, drawers/dialogs/popovers, dashboards, app shells, visual polish, or design QA.

This skill complements Impeccable. It tells the agent how to use Impeccable inside OMP without accidentally applying one app's style to every project.

## Core rule

Do not claim UI quality from typecheck, build, or detector output alone.

A UI change is complete only when the changed interaction states are opened in a browser, asserted mechanically, and inspected visually.

## Per-project context

Resolve design context from the current app/project directory, not the monorepo root.

Look upward from the edited file for:

- `PRODUCT.md`
- `DESIGN.md`
- optional `.impeccable/config.json`

If no nearby context exists and the task is broad UI work, initialize one before redesigning. Ask only for preferences that cannot be inferred from existing docs/screenshots.

Never apply Slotok's `PRODUCT.md` or `DESIGN.md` to another app.

## Implementation order

Use this order for UI primitives:

1. Existing app component.
2. shadcn/Radix primitive copied/adapted locally.
3. Native HTML with design-system classes.
4. New custom component only when no primitive fits.

For these components, default to shadcn/Radix patterns and do not hand-roll behavior:

- Sidebar
- Sheet / drawer
- Dialog
- Popover
- Dropdown menu
- Select
- Tabs
- Accordion / collapsible
- Tooltip
- Toast
- Command palette

If a custom component is unavoidable, explain what existing primitive failed and add browser QA for the behavior the primitive would normally guarantee.

## Required design QA states

For every UI change, enumerate affected states before final handoff.

Common states:

- default
- selected / active
- empty
- loading / running
- error
- disabled
- open / closed overlay
- focused / keyboard
- desktop
- tablet
- phone

Each changed state needs at least one of:

- browser assertion
- screenshot
- reviewer/image inspection
- explicit non-goal

## Browser QA assertions

### Global layout

Run at the relevant viewports, usually:

- desktop: 1280×720 or wider
- tablet: 1024×768
- phone: 390×844

Assert:

- `document.documentElement.scrollWidth <= window.innerWidth`
- document vertical overflow is intentional or absent
- long tables/logs/maps own local scroll
- primary navigation remains reachable
- command bars do not cover the work surface unless intentionally floating

### Drawers / sheets / sidebars

For every viewport where a drawer/sheet can open, assert the opened state, not just the closed page.

Required checks:

- overlay is mounted when expected
- overlay covers the viewport
- overlay visually dims the page: computed background is not transparent and opacity is not zero
- drawer/sheet surface is opaque: computed background is not transparent
- drawer/sheet stacks above overlay
- drawer/sheet has animation or a reduced-motion fallback
- Escape closes it
- focus moves into it or remains keyboard-reachable
- no underlying page text visually competes through the surface

Do not run this only on mobile if desktop has a collapsible sidebar or drawer-like behavior.

### Buttons and controls

Computed-style checks should catch browser-default leakage and inconsistent primitives.

For visible buttons and button-like controls, flag:

- `appearance` is `auto` or browser-default where the design system expects reset styling
- `border-style` is `outset`, `inset`, `ridge`, or `groove`
- border radius is `0px` unless intentionally square
- touch target is below 44×44 on phone unless it is an icon in a dense desktop-only toolbar
- background is transparent when the control needs a visible hit target
- active/selected controls lack a persistent visual state

### Screenshot review

Use image inspection or a reviewer agent on screenshots. Ask for blocker/medium issues only.

Prompt shape:

```text
Inspect this UI screenshot for blocker/medium UI/UX bugs. Focus on overflow, clipped text, random native styling, overlay/drawer opacity, control hierarchy, and whether the changed interaction state is visually coherent. Ignore nits.
```

Do not accept generic praise. A good review names exact visible defects.

## Impeccable usage

From the app directory:

```bash
bunx --bun impeccable detect src
```

or use the app script if present:

```bash
bun run design:detect
```

Interpretation:

- Impeccable detector is technical lint: anti-patterns, colors, radii, fonts, tokens.
- It is not a full visual critique.
- Non-zero exit means findings exist; it may be advisory while legacy CSS is being cleaned.
- Do not suppress findings without user/project approval.

## OMP hook design

A future OMP design hook should run after edits/writes to UI files:

- `.tsx`, `.jsx`, `.css`, `.scss`, `.html`, `.vue`, `.svelte`, `.astro`

Hook behavior:

1. Resolve nearest `PRODUCT.md` / `DESIGN.md`.
2. Run Impeccable detector on changed UI files.
3. Inject concise advisor-style findings.
4. Add a reminder to open and screenshot changed interaction states.
5. Never auto-fix.
6. Never apply a monorepo-root design identity unless the repo is itself the product.

Example reminder:

```text
Design hook: drawer/sheet code changed. Open the drawer at desktop, tablet, and phone widths. Assert overlay opacity, opaque sheet surface, z-index, animation/reduced-motion, Escape close, and no document overflow.
```

## Agent handoff checklist

Before final handoff for UI work, include:

- changed states inspected
- viewports tested
- commands run
- screenshots/artifacts paths
- detector status
- visual review result
- known non-goals or remaining design debt

If the user complains about visible UI bugs after a green CI run, assume the QA rubric was insufficient. Add the missing state/assertion first, then fix the UI.
