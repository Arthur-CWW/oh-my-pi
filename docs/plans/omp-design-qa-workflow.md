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

## Private design-skill layer

`T-2026-06-13-003` adds a private design-heuristics layer derived from Arthur's owned local design references, especially a possible local *Refactoring UI* ebook/PDF. This layer must be clean-room summarized:

- find source locally before extraction: `~/Downloads/`, `~/Documents/`, `~/Desktop/`, `~/Library/Mobile Documents/`, `~/Library/CloudStorage/`, and Apple Books storage under `~/Library/Containers/com.apple.BKAgentService/Data/Documents/iBooks/Books/`
- compare against existing skill-shaped local references: `vendor/mitsuhiko/agent-stuff/skills/frontend-design/SKILL.md` and `tmp/open-design/skills/`
- write managed output to the private skills repo, not this repo: `pi-personal-core-skills/skills/refactoring-ui-private/`
- if globally loaded, expose it through a symlink at `~/.agents/skills/refactoring-ui-private`
- never commit protected page text, screenshots, chapter examples, or long quotations

The private skill should emit short original checklists for hierarchy, spacing, typography, contrast, grouping, affordances, forms, tables, empty states, and responsive composition. UI workers may cite checklist item names, but final repo docs should not contain source-derived prose.

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


## Reviewer persona split

`T-2026-06-13-004` splits design QA into focused reviewer personas. The coordinator assigns only the lenses that match the diff; implementation workers should not review their own UI as the only visual proof.

| Persona | Reviews | Required inputs | Output |
|---|---|---|---|
| Visual hierarchy / composition | density, grouping, scan path, typography, contrast, affordance priority, generic-design slop | screenshots for changed states, nearest `PRODUCT.md` / `DESIGN.md`, optional private checklist names | blocker/medium issues with exact visible locations |
| Accessibility / keyboard | semantic controls, labels, focus order, Escape/Tab behavior, reduced motion, contrast risks | browser-state assertions, DOM snapshot or accessibility tree when available | pass/fail findings plus missing assertions |
| State / data wiring | loading, empty, error, selected, disabled, stale-data, optimistic and permission states | state matrix, fixture path or app route, changed components | untested state list and user-visible failure modes |
| Performance / static analysis | heavy render paths, layout thrash, large assets, detector output, component anti-patterns | changed files, detector output, bundle/perf notes when available | concrete code-level risks, not aesthetic critique |
| Proof artifact reviewer | whether the proof actually demonstrates the claimed UI behavior | commands, screenshots/videos, artifact paths, skipped checks | reviewer-rerunnable proof verdict and exact gaps |

Default split:

1. UI implementer changes the code and produces screenshots/browser assertions for named states.
2. Visual hierarchy reviewer inspects screenshots and private-checklist item names only; no protected source text enters the prompt.
3. Accessibility reviewer exercises keyboard/open-overlay states when controls or overlays changed.
4. State/data reviewer checks non-happy-path states when data fetching, permissions, or async actions changed.
5. Proof reviewer checks the final QA report for cwd, commands, artifacts, and skipped live/expensive checks.

For small cosmetic changes, visual hierarchy plus proof review is enough. For drawers, dialogs, navigation, forms, tables, or async workflows, add accessibility and state/data reviewers.

Reusable reviewer brief shape:

```text
You are the <persona> design QA reviewer. Inspect only the assigned files, screenshots, browser-state assertions, and artifact paths. Use nearest PRODUCT.md/DESIGN.md plus private checklist category names if supplied. Do not quote protected design-source text. Return blocker/medium findings, exact evidence path or state, and the smallest next proof/fix. Do not praise; do not review unrelated code.
```

Coordinator routing:

- **Visual-only diff:** visual hierarchy reviewer, then proof artifact reviewer.
- **Overlay/navigation/form diff:** visual hierarchy plus accessibility/keyboard reviewers, then proof artifact reviewer.
- **Data-fetching or workflow-state diff:** state/data wiring reviewer first, then visual hierarchy reviewer for captured states.
- **Large component or styling-system diff:** performance/static-analysis reviewer before visual hierarchy so avoidable rendering/static risks are caught before screenshot critique.
- **Provider/live/paid UI proof:** proof artifact reviewer must check skipped live/paid steps, approval state, and the exact manual rerun command.

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

## Prompt rules for LLM-assisted UI work

Use this prompt contract for UI agents:

```text
You are editing UI. Before code, read nearest PRODUCT.md and DESIGN.md. Use existing project components or shadcn/Radix primitives before custom components. Do not create raw overlay/drawer/popover/menu behavior. For every changed interaction state, add or run browser QA that opens that state and asserts surface, overlay, focus/keyboard behavior, responsive layout, and no document overflow. Include screenshots. Do not claim visual quality from typecheck or detector alone.
```

For long GPT/Oracle-assisted UI critique, use the same recoverable bundle convention as frontend LLM research: include `PRODUCT.md`, `DESIGN.md`, changed UI files, and screenshot paths as `@file` / `--file` references; persist the session id, conversation URL, output path, and retry-after blocker text in the async run ledger. Do not attach cookies, tokens, or browser profile files.

Model routing follows T-2026-06-13-006: use Gemini Flash for bounded non-core UI workers first; escalate to GPT-5.5/Oracle for fallback critique, reviewer passes, or reasoning-heavy recovery while subscription impact remains acceptable. Do not route UI workers to Kimi by default; treat Kimi as an explicit last-resort/unavailable fallback. This is operational guidance only, not an OMP config change.

## Non-goals

- Do not make every project share Slotok’s style.
- Do not make Impeccable findings hard-fail all legacy UI immediately.
- Do not block backend-only changes on design QA.
- Do not vendor protected design-book content into prompts or skills.

## Next implementation steps

1. Add OMP nearest-context resolver for `PRODUCT.md` / `DESIGN.md`.
2. Add optional post-edit design hook for UI files.
3. Add `design:detect` script to each UI app that opts in.
4. Update UI task templates/subagent prompts with the prompt contract above.
5. Extend visual QA helpers with reusable assertions for drawer/dialog/popover states.
