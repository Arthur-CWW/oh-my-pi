# OMP Design QA Workflow

## Problem

Recent Slotok UI work exposed a repeated failure mode: agents can pass typecheck, visual QA, and detector checks while still shipping obvious UX bugs.

Concrete failures observed:

- Drawer had no opaque surface, no visible overlay assertion, and no animation proof; the page showed through the drawer.
- Visual QA checked reachability and overflow but not actual opened interactive states.
- The agent introduced local mini-components instead of starting from established shadcn/Radix components.
- Screenshot inspection happened late and informally, not as a required gate.
- Detector findings were treated as “design quality” proof, but Impeccable detect is a technical lint, not a full critique.
- Responsive QA proved “no document overflow,” but not whether the resulting layout was useful or visually coherent.

## Decision

Use Impeccable as a per-project design context and detector layer, not as a monorepo-wide brand. Use shadcn/Radix primitives before local custom UI. Require visual-state QA for the actual interaction states that changed.

This workflow applies to OMP agents doing UI work.

## Per-project context

Every UI project gets its own context files near the app root:

- `PRODUCT.md`: users, purpose, register, risks, anti-references.
- `DESIGN.md`: tokens, component rules, motion rules, responsive rules.
- optional `.impeccable/config.json`: detector ignores and hook settings for that project only.

Do not put `PRODUCT.md` or `DESIGN.md` at the monorepo root unless the monorepo is itself the product.

For Slotok:

- `apps/slotok-workbench/PRODUCT.md`
- `apps/slotok-workbench/DESIGN.md`

Run design commands from `apps/slotok-workbench` or set `IMPECCABLE_CONTEXT_DIR=apps/slotok-workbench`.

## Agent workflow for UI tasks

### 1. Shape before implementation

Before editing UI, the coordinator must answer or infer:

- Product register: product, app, website, internal tool, dashboard, marketing page, etc.
- Primary user job.
- Primary surface and interaction state.
- Anti-references.
- Existing component system.
- Target viewports.
- What “done” means visually, not just functionally.

If this context is absent, run an Impeccable-style interview and write/update `PRODUCT.md` and `DESIGN.md` first.

### 2. Prefer proven primitives

Default order for UI primitives:

1. Existing project component.
2. shadcn/Radix component copied/adapted locally.
3. Native HTML with design-system classes.
4. New custom component only when the primitive truly does not exist.

For overlays, drawers, popovers, menus, dialogs, selects, tabs, accordions, and sidebars: use shadcn/Radix patterns first.

Do not build a mini drawer/sidebar/popover from raw divs unless the task explicitly requires a novel interaction.

### 3. Implement in inspectable chunks

A UI implementation slice should name the user-visible state it changes:

- default state
- selected state
- empty state
- loading/running state
- error state
- mobile/tablet/desktop state
- opened/closed overlay state
- keyboard/focus state

Each state must have either a screenshot, a browser assertion, or a deliberate non-goal.

### 4. Run three kinds of QA

#### Mechanical QA

- typecheck
- unit/component tests
- build
- unsafe-type lint
- Impeccable detector

Mechanical QA catches implementation drift. It does not prove UX quality.

#### Browser-state QA

For every changed interaction, test the real state in browser automation:

- open drawer/dialog/popover/menu at every viewport where that interaction exists, not only mobile
- assert overlay exists when needed
- assert overlay covers the viewport
- assert overlay visually dims the page via computed style, not class name
- assert surface is opaque via computed style, not class name
- assert z-index ordering
- assert animation or reduced-motion behavior
- assert focus trap / Escape close when applicable
- assert no document-level x overflow at desktop, tablet, and phone sizes
- assert local scroll ownership for logs/tables/inspectors
- assert button/control computed styles do not leak browser defaults: no `appearance: auto`, no `border-style: outset/inset/ridge/groove`, and no missing visible hit target for active controls

#### Human visual QA

A screenshot audit can be done by a reviewer agent or an image inspector, but the prompt must ask for blocker/medium issues, not generic praise.

## OMP harness integration

### Immediate path

Add project scripts:

```json
{
  "design:detect": "bunx --bun impeccable detect src/renderer"
}
```

Run it manually during UI work. Treat non-zero detector output as advisory until the project has cleaned or ignored legacy findings.

### Better path: advisor-style design hook

Add an OMP post-edit hook for UI files:

Inputs:

- changed file path
- current working directory
- nearest `PRODUCT.md` / `DESIGN.md`
- optional `.impeccable/config.json`

Behavior:

1. Resolve nearest project context by walking upward from the changed file.
2. If no context exists, emit: “No design context found; initialize PRODUCT.md/DESIGN.md before broad UI work.”
3. Run `impeccable detect` on changed UI files.
4. Inject concise advisor-style findings into the agent context.
5. Do not auto-fix.
6. Never apply monorepo-root Slotok context to other apps.

Suggested hook event:

- after `edit`/`write`/`ast_edit` touching `.tsx`, `.jsx`, `.css`, `.scss`, `.html`, `.vue`, `.svelte`, `.astro`

Suggested output format:

```text
Design hook findings for apps/foo/src/Button.tsx:
- [warning] side-tab: avoid thick side accent border; use fill/outline state.
- [warning] non-token color: #e4d3c6 is not in DESIGN.md.
Next: run browser-state QA for changed interactive states.
```

### Best path: design gate before final handoff

Before a UI task is considered complete, the coordinator must attach:

- command output from app CI
- Impeccable detector result or explicit reason it is advisory-only
- screenshot paths for affected states
- browser assertions for changed interactive states
- reviewer/image-inspection result for screenshots

The final handoff must say which states were inspected.

## Slotok-specific additions

Slotok visual QA should cover:

- Desktop, tablet, phone viewport.
- Drawer open state: overlay mounted, overlay visible, drawer opaque, drawer animated, drawer above overlay.
- Inspector open/closed state.
- Command bar docking, not overlapping stage content.
- Workflow telemetry state because Slotok’s center priority is workflow/chat log.
- Mobile navigation reachability through the drawer/sheet.
- Persona/candidate cards not stretched into useless empty canvas.

## Prompt rules for GPT UI work

Use this prompt contract for UI agents:

```text
You are editing UI. Before code, read nearest PRODUCT.md and DESIGN.md. Use existing project components or shadcn/Radix primitives before custom components. Do not create raw overlay/drawer/popover/menu behavior. For every changed interaction state, add or run browser QA that opens that state and asserts surface, overlay, focus/keyboard behavior, responsive layout, and no document overflow. Include screenshots. Do not claim visual quality from typecheck or detector alone.
```

## Non-goals

- Do not make every project share Slotok’s style.
- Do not make Impeccable findings hard-fail all legacy UI immediately.
- Do not block backend-only changes on design QA.
- Do not vendor copyrighted design-book content into prompts or skills.

## Next implementation steps

1. Add OMP nearest-context resolver for `PRODUCT.md` / `DESIGN.md`.
2. Add optional post-edit design hook for UI files.
3. Add `design:detect` script to each UI app that opts in.
4. Update UI task templates/subagent prompts with the prompt contract above.
5. Extend visual QA helpers with reusable assertions for drawer/dialog/popover states.
